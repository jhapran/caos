/**
 * IMP-042 (data-adapter slice) — Supabase My Work adapter contract test
 * (production path, network mocked).
 *
 * Pins the adapter to the API-R0-MWK / DEC-L read contract: it mocks the
 * browser client boundary (@/lib/supabaseClient), captures every table
 * read / rpc invocation, and asserts:
 *
 *   - the composition is plain RLS reads ONLY (tasks, review_items,
 *     firm_memberships, clients) — NO aggregate SECURITY DEFINER RPC, no
 *     writes of any kind (DM-X-02 precedent);
 *   - caller resolution: session user → live ACTIVE membership in the
 *     active-firm context; no session / no membership / no active firm /
 *     billing (or other non-staff) role → the empty four-bucket contract,
 *     never an error (API-ERR-02 collection semantics; DEC-L billing none);
 *   - own-assignment visibility: the caller's membership must be the task
 *     assignee or reviewer; terminal tasks (done/cancelled) are excluded;
 *   - Returned canonicalization: a task-linked returned ReviewItem claims
 *     its canonical TASK (marked returned, reviewItemId attached, never
 *     double-surfaced) only when that task is the caller's own work; a
 *     standalone returned ReviewItem surfaces only for its own submitter
 *     with next_action exactly "Address reviewer feedback";
 *   - Asia/Kolkata business-date boundaries against the REAL current time
 *     (TEN-22 — no fixture clock here), overdue-inclusive Today and the
 *     ISO-week-bounded This Week;
 *   - client display references resolve via a plain clients read;
 *     unresolvable names render null, never fail.
 *
 * The supabase adapter is imported DIRECTLY here (not via the
 * DATA_SOURCE-pinned selector) — a test-only reach into the implementation
 * module to verify the production contract without a backend.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearActiveFirm, setActiveFirm } from '@/data/context';

interface CapturedTable {
  table: string;
  verb?: 'insert' | 'update' | 'delete';
  eq: [string, unknown][];
}

const tableCalls: CapturedTable[] = [];
const rpcCalls: string[] = [];
let sessionUserId: string | null = 'user-1';
let membershipRow: unknown = { id: 'm-senior', role: 'senior', status: 'active' };
let tableRows: Record<string, unknown[]> = {};

vi.mock('@/lib/supabaseClient', () => ({
  getSupabaseClient: () => ({
    auth: {
      getUser: async () => ({
        data: { user: sessionUserId ? { id: sessionUserId } : null },
        error: null,
      }),
    },
    from: (table: string) => {
      const entry: CapturedTable = { table, eq: [] };
      tableCalls.push(entry);
      const builder: Record<string, unknown> = {
        select: () => builder,
        insert: () => {
          entry.verb = 'insert';
          return builder;
        },
        update: () => {
          entry.verb = 'update';
          return builder;
        },
        delete: () => {
          entry.verb = 'delete';
          return builder;
        },
        eq: (col: string, val: unknown) => {
          entry.eq.push([col, val]);
          return builder;
        },
        in: () => builder,
        order: () => builder,
        maybeSingle: async () => ({ data: membershipRow, error: null }),
        then: (resolve: (v: unknown) => void) =>
          resolve({ data: tableRows[table] ?? [], error: null }),
      };
      return builder;
    },
    rpc: async (name: string) => {
      rpcCalls.push(name);
      return { data: null, error: null };
    },
  }),
}));

import { supabaseMyWork } from '@/data/mywork/supabase';

/** 2026-09-06T18:30:00Z = 2026-09-07 00:00 IST (a Monday); the ISO week
 *  ends Sunday 2026-09-13. */
const NOW_IST_MONDAY = '2026-09-06T18:30:00.000Z';

const TASK = {
  id: 'task-1',
  client_id: 'client-1',
  title: 'GSTR-1 filing',
  next_action: 'Reconcile the sales register',
  status: 'in_progress',
  waiting_reason: null,
  due_date: '2026-09-07',
  priority: 'high',
  assignee_membership_id: 'm-senior',
  reviewer_membership_id: 'm-partner',
};

function taskRow(partial: Record<string, unknown>): Record<string, unknown> {
  return { ...TASK, ...partial };
}

describe('supabase My Work adapter — caller resolution & eligibility', () => {
  beforeEach(() => {
    tableCalls.length = 0;
    rpcCalls.length = 0;
    sessionUserId = 'user-1';
    membershipRow = { id: 'm-senior', role: 'senior', status: 'active' };
    tableRows = {};
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW_IST_MONDAY));
    setActiveFirm('firm-1');
  });

  afterEach(() => {
    vi.useRealTimers();
    clearActiveFirm();
  });

  it('resolves the caller membership in the active-firm context (user + firm + active)', async () => {
    await supabaseMyWork.getMyWork();
    const membershipRead = tableCalls.find((c) => c.table === 'firm_memberships')!;
    expect(membershipRead.eq).toEqual([
      ['user_id', 'user-1'],
      ['firm_id', 'firm-1'],
      ['status', 'active'],
    ]);
  });

  it('billing has no My Work; no session / no membership / no firm context all yield the empty contract', async () => {
    const empty = { today: [], thisWeek: [], waiting: [], returned: [] };

    membershipRow = { id: 'm-billing', role: 'billing', status: 'active' };
    expect(await supabaseMyWork.getMyWork()).toEqual(empty);

    membershipRow = { id: 'm-ext', role: 'external_consultant', status: 'active' };
    expect(await supabaseMyWork.getMyWork()).toEqual(empty);

    membershipRow = null; // no live ACTIVE membership
    expect(await supabaseMyWork.getMyWork()).toEqual(empty);

    membershipRow = { id: 'm-senior', role: 'senior', status: 'active' };
    sessionUserId = null; // no session
    expect(await supabaseMyWork.getMyWork()).toEqual(empty);

    sessionUserId = 'user-1';
    clearActiveFirm(); // no active-firm selector context
    expect(await supabaseMyWork.getMyWork()).toEqual(empty);
    setActiveFirm('firm-1');

    // Billing never even issues the task/review reads.
    membershipRow = { id: 'm-billing', role: 'billing', status: 'active' };
    tableCalls.length = 0;
    await supabaseMyWork.getMyWork();
    expect(tableCalls.map((c) => c.table)).toEqual(['firm_memberships']);
  });

  it('composes plain RLS reads only — no RPC, no writes (DM-X-02)', async () => {
    tableRows['tasks'] = [TASK];
    await supabaseMyWork.getMyWork();
    expect(rpcCalls).toEqual([]);
    expect(tableCalls.every((c) => c.verb === undefined)).toBe(true);
    expect(new Set(tableCalls.map((c) => c.table))).toEqual(
      new Set(['firm_memberships', 'tasks', 'review_items', 'clients']),
    );
    // The returned-review read pins status='returned' server-side.
    const reviewRead = tableCalls.find((c) => c.table === 'review_items')!;
    expect(reviewRead.eq).toEqual([['status', 'returned']]);
  });
});

describe('supabase My Work adapter — DEC-L semantics over RLS reads', () => {
  beforeEach(() => {
    tableCalls.length = 0;
    rpcCalls.length = 0;
    sessionUserId = 'user-1';
    membershipRow = { id: 'm-senior', role: 'senior', status: 'active' };
    tableRows = { clients: [{ id: 'client-1', name: 'ABC Pvt Ltd' }] };
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW_IST_MONDAY));
    setActiveFirm('firm-1');
  });

  afterEach(() => {
    vi.useRealTimers();
    clearActiveFirm();
  });

  it('own-assignment visibility: assignee OR reviewer; terminal tasks excluded', async () => {
    tableRows['tasks'] = [
      taskRow({ id: 'own-assignee', due_date: '2026-09-07' }),
      taskRow({
        id: 'own-reviewer',
        assignee_membership_id: 'm-other',
        reviewer_membership_id: 'm-senior',
        due_date: '2026-09-08',
      }),
      taskRow({
        id: 'not-own',
        assignee_membership_id: 'm-other',
        reviewer_membership_id: 'm-other2',
        due_date: '2026-09-07',
      }),
      taskRow({ id: 'done-task', status: 'done', due_date: '2026-09-07' }),
      taskRow({ id: 'cancelled-task', status: 'cancelled', due_date: '2026-09-07' }),
    ];
    const buckets = await supabaseMyWork.getMyWork();
    const all = [...buckets.today, ...buckets.thisWeek];
    expect(all.map((i) => i.id).sort()).toEqual(['own-assignee', 'own-reviewer']);
    expect(all.every((i) => i.kind === 'task')).toBe(true);
    expect(all.every((i) => i.clientName === 'ABC Pvt Ltd')).toBe(true);
  });

  it('Asia/Kolkata date windows against the REAL current date (TEN-22): overdue-inclusive Today, ISO-week This Week', async () => {
    tableRows['tasks'] = [
      taskRow({ id: 'overdue', due_date: '2026-08-01' }),
      taskRow({ id: 'due-today', due_date: '2026-09-07' }), // business date, inclusive
      taskRow({ id: 'week-end', due_date: '2026-09-13' }), // Sunday, inclusive
      taskRow({ id: 'beyond-week', due_date: '2026-09-14' }),
      taskRow({ id: 'no-date', due_date: null }),
    ];
    const buckets = await supabaseMyWork.getMyWork();
    expect(buckets.today.map((i) => i.id)).toEqual(['overdue', 'due-today']);
    expect(buckets.thisWeek.map((i) => i.id)).toEqual(['week-end']);
    // Beyond the ISO week end and NULL due_date surface in NO bucket here.
    expect(buckets.waiting).toEqual([]);
    expect(buckets.returned).toEqual([]);
  });

  it('Waiting takes precedence over Today and carries the blocker record', async () => {
    tableRows['tasks'] = [
      taskRow({
        id: 'waiting-overdue',
        status: 'waiting',
        waiting_reason: 'Awaiting client trial balance',
        due_date: '2026-08-01',
      }),
    ];
    const buckets = await supabaseMyWork.getMyWork();
    expect(buckets.today).toEqual([]);
    expect(buckets.waiting).toHaveLength(1);
    expect(buckets.waiting[0]).toMatchObject({
      id: 'waiting-overdue',
      waitingReason: 'Awaiting client trial balance',
      nextAction: 'Reconcile the sales register', // stored next_action, never rationale
    });
  });

  it('Returned canonicalization: a task-linked returned ReviewItem claims only its canonical task', async () => {
    tableRows['tasks'] = [
      taskRow({ id: 'task-returned', status: 'returned', due_date: '2026-09-07' }),
      taskRow({ id: 'task-other-owner', assignee_membership_id: 'm-other', reviewer_membership_id: null }),
    ];
    tableRows['review_items'] = [
      // Task-linked, caller's own task → the TASK is the Returned item.
      {
        id: 'ri-linked',
        client_id: 'client-1',
        task_id: 'task-returned',
        title: 'GSTR-1 review',
        priority: 'normal',
        submitted_by_membership_id: 'm-other',
      },
      // Task-linked to a task that is NOT the caller's own → not surfaced.
      {
        id: 'ri-not-own',
        client_id: 'client-1',
        task_id: 'task-other-owner',
        title: 'other review',
        priority: 'normal',
        submitted_by_membership_id: 'm-other',
      },
      // Standalone, the caller's OWN submission → standalone Returned item.
      {
        id: 'ri-standalone',
        client_id: 'client-1',
        task_id: null,
        title: 'ITR computation review',
        priority: 'high',
        submitted_by_membership_id: 'm-senior',
      },
      // Standalone, someone else's submission → not the caller's My Work.
      {
        id: 'ri-other-submitter',
        client_id: 'client-1',
        task_id: null,
        title: 'not mine',
        priority: 'normal',
        submitted_by_membership_id: 'm-other',
      },
    ];
    const buckets = await supabaseMyWork.getMyWork();

    expect(buckets.returned.map((i) => i.id).sort()).toEqual(['ri-standalone', 'task-returned']);
    // Canonical task: kind task, the stored next_action, traceability link.
    const canonical = buckets.returned.find((i) => i.id === 'task-returned')!;
    expect(canonical).toMatchObject({
      kind: 'task',
      returned: true,
      taskId: 'task-returned',
      reviewItemId: 'ri-linked',
      nextAction: 'Reconcile the sales register',
    });
    // Returned precedence: the canonical task is NOT also in Today despite
    // being due on the business date.
    expect(buckets.today).toEqual([]);
    // Standalone returned: the exact contract action — reviewer rationale is
    // never next_action (no rationale field is even read).
    const standalone = buckets.returned.find((i) => i.id === 'ri-standalone')!;
    expect(standalone).toMatchObject({
      kind: 'returned_review',
      status: 'returned',
      dueDate: null,
      priority: 'high',
      nextAction: 'Address reviewer feedback',
      taskId: null,
      reviewItemId: 'ri-standalone',
    });
    // The linked ReviewItem is never additionally surfaced; other people's
    // work never appears.
    const all = [...buckets.today, ...buckets.thisWeek, ...buckets.waiting, ...buckets.returned];
    expect(all.some((i) => i.id === 'ri-linked')).toBe(false);
    expect(all.some((i) => i.id === 'ri-not-own')).toBe(false);
    expect(all.some((i) => i.id === 'ri-other-submitter')).toBe(false);
    expect(all.some((i) => i.id === 'task-other-owner')).toBe(false);
  });

  it('unresolvable client names render null, never fail the read', async () => {
    tableRows['tasks'] = [taskRow({ id: 'task-1', client_id: 'client-hidden' })];
    tableRows['clients'] = []; // RLS-invisible client row
    const buckets = await supabaseMyWork.getMyWork();
    expect(buckets.today[0]).toMatchObject({ id: 'task-1', clientId: 'client-hidden', clientName: null });
  });
});
