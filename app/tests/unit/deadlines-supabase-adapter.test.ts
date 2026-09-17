/**
 * IMP-051 (data-adapter slice) — Supabase Deadlines adapter contract test
 * (production path, network mocked).
 *
 * Pins the adapter to the API-R0-DLN read contract: it mocks the browser
 * client boundary (@/lib/supabaseClient), captures every table read / rpc
 * invocation, and asserts:
 *
 *   - plain RLS reads ONLY (DM-X-02 / My Work precedent): the two
 *     security_invoker views (deadline_board, client_dependency_board) plus
 *     plain base-table reads for the drill-down projections
 *     (compliance_instances + clients / legal_entities / compliance_types /
 *     firm_memberships ⋈ profiles staff-name resolution) — NO rpc, no writes
 *     of any kind;
 *   - projection A: deadline_board ordered by due_date ascending, snake_case
 *     → camelCase mapping (group_id→groupId, days_left→daysLeft,
 *     ready_to_file→readyToFile, under_review→underReview,
 *     not_started→notStarted, at_risk→atRisk, …), [] for an empty scope;
 *   - projection B: compliance_instances addressed by the parsed group id
 *     (eq compliance_type_id + eq due_date on the OPERATIVE due date), with
 *     the approved client/entity/type/assignee projection reads; daysLeft
 *     derived as due_date − the Asia/Kolkata business date against the REAL
 *     current time (TEN-22 — the clock is pinned here, no fixture clock);
 *     malformed group ids → [] with NO query issued; an empty instance list
 *     → [] with the projection reads skipped (API-ERR-02);
 *   - projection C: client_dependency_board ordered by age_days descending,
 *     full field mapping with NULL handling, [] for an empty scope;
 *   - error path: any read carrying { error } rejects through toApiError()
 *     (API-ERR-01) — no Supabase SDK/PostgREST type crosses the boundary.
 *
 * The supabase adapter is imported DIRECTLY here (not via the
 * DATA_SOURCE-pinned selector) — a test-only reach into the implementation
 * module to verify the production contract without a backend. Unlike the My
 * Work adapter, the deadlines adapter performs NO caller-membership
 * resolution (the views/base reads carry RLS themselves), so no auth or
 * active-firm context is mocked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface CapturedTable {
  table: string;
  verb?: 'insert' | 'update' | 'delete';
  eq: [string, unknown][];
  in: [string, unknown[]][];
  order: [string, unknown][];
}

const tableCalls: CapturedTable[] = [];
const rpcCalls: string[] = [];
let tableRows: Record<string, unknown[]> = {};
let readErrors: Record<string, unknown | null> = {};

vi.mock('@/lib/supabaseClient', () => ({
  getSupabaseClient: () => ({
    from: (table: string) => {
      const entry: CapturedTable = { table, eq: [], in: [], order: [] };
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
        in: (col: string, vals: unknown[]) => {
          entry.in.push([col, vals]);
          return builder;
        },
        order: (col: string, opts: unknown) => {
          entry.order.push([col, opts]);
          return builder;
        },
        maybeSingle: async () => ({ data: null, error: null }),
        then: (resolve: (v: unknown) => void) =>
          resolve({ data: tableRows[table] ?? [], error: readErrors[table] ?? null }),
      };
      return builder;
    },
    rpc: async (name: string) => {
      rpcCalls.push(name);
      return { data: null, error: null };
    },
  }),
}));

import { supabaseDeadlines } from '@/data/deadlines/supabase';

/** 2026-09-15T18:30:00Z = 2026-09-16 00:00 IST — the pinned Asia/Kolkata
 *  business date is 2026-09-16, so due 2026-09-30 has daysLeft 14. */
const NOW_IST = '2026-09-15T18:30:00.000Z';

const TYPE_ID = '11111111-1111-1111-1111-111111111111';
const GROUP_ID = `${TYPE_ID}::2026-09-30`;

const BOARD_ROW = {
  group_id: GROUP_ID,
  compliance_type_id: TYPE_ID,
  compliance_name: 'Tax Audit (44AB)',
  due_date: '2026-09-30',
  days_left: 14,
  total_clients: 3,
  filed: 1,
  ready_to_file: 1,
  in_progress: 0,
  waiting: 0,
  under_review: 1,
  not_started: 0,
  at_risk: 1,
};

const INSTANCE_ROW = {
  id: 'inst-1',
  client_id: 'client-1',
  legal_entity_id: 'entity-1',
  compliance_type_id: TYPE_ID,
  period_label: 'FY 2025-26',
  state: 'information_requested',
  due_date: '2026-09-30',
  assignee_membership_id: 'm-1',
  reviewer_membership_id: 'm-2',
};

const DEPENDENCY_ROW = {
  kind: 'task',
  id: 'task-9',
  client_id: 'client-1',
  client_name: 'ABC Pvt Ltd',
  label: 'GSTR-1 reconciliation',
  period_label: null,
  waiting_reason: 'Awaiting bank statements',
  status: 'waiting',
  waiting_since: '2026-09-01T04:00:00.000Z',
  age_days: 15,
  due_date: '2026-09-20',
  assignee_membership_id: 'm-1',
  reviewer_membership_id: null,
};

describe('supabase deadlines adapter — projection A (deadline board view)', () => {
  beforeEach(() => {
    tableCalls.length = 0;
    rpcCalls.length = 0;
    tableRows = {};
    readErrors = {};
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW_IST));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reads deadline_board ordered by due_date ascending and maps snake_case → camelCase', async () => {
    tableRows['deadline_board'] = [BOARD_ROW];
    const groups = await supabaseDeadlines.listDeadlineGroups();

    expect(tableCalls).toHaveLength(1);
    const read = tableCalls[0];
    expect(read.table).toBe('deadline_board');
    expect(read.order).toEqual([
      ['due_date', { ascending: true }],
      ['compliance_type_id', { ascending: true }],
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]).toEqual({
      groupId: GROUP_ID,
      complianceTypeId: TYPE_ID,
      complianceName: 'Tax Audit (44AB)',
      dueDate: '2026-09-30',
      daysLeft: 14,
      totalClients: 3,
      filed: 1,
      readyToFile: 1,
      inProgress: 0,
      waiting: 0,
      underReview: 1,
      notStarted: 0,
      atRisk: 1,
    });
    // No snake_case key survives the mapping.
    expect(groups[0]).not.toHaveProperty('group_id');
    expect(groups[0]).not.toHaveProperty('days_left');
    expect(groups[0]).not.toHaveProperty('ready_to_file');
    expect(groups[0]).not.toHaveProperty('under_review');
    expect(groups[0]).not.toHaveProperty('not_started');
    expect(groups[0]).not.toHaveProperty('at_risk');
  });

  it('an empty board scope is [], never an error (API-ERR-02)', async () => {
    tableRows['deadline_board'] = [];
    await expect(supabaseDeadlines.listDeadlineGroups()).resolves.toEqual([]);
  });
});

describe('supabase deadlines adapter — projection B (group drill-down)', () => {
  beforeEach(() => {
    tableCalls.length = 0;
    rpcCalls.length = 0;
    tableRows = {};
    readErrors = {};
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW_IST));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('addresses compliance_instances by the parsed group id and composes the projection reads', async () => {
    tableRows['compliance_instances'] = [INSTANCE_ROW];
    tableRows['clients'] = [{ id: 'client-1', name: 'ABC Pvt Ltd' }];
    tableRows['legal_entities'] = [{ id: 'entity-1', legal_name: 'ABC Pvt Ltd (Main)' }];
    tableRows['compliance_types'] = [{ id: TYPE_ID, name: 'Tax Audit (44AB)' }];
    tableRows['firm_memberships'] = [
      { id: 'm-1', user_id: 'u-1' },
      { id: 'm-2', user_id: 'u-2' },
    ];
    tableRows['profiles'] = [
      { id: 'u-1', full_name: 'Priya Sharma' },
      { id: 'u-2', full_name: 'Rahul Verma' },
    ];

    const rows = await supabaseDeadlines.listDeadlineGroupInstances(GROUP_ID);

    // The group id is the drill-down address: eq on compliance_type_id and
    // the OPERATIVE due_date (calculated_due_date is never read).
    const instanceRead = tableCalls.find((c) => c.table === 'compliance_instances')!;
    expect(instanceRead.eq).toEqual([
      ['compliance_type_id', TYPE_ID],
      ['due_date', '2026-09-30'],
    ]);
    expect(instanceRead.order).toEqual([['id', { ascending: true }]]);

    // The projection reads are plain RLS base-table reads addressed by in().
    expect(tableCalls.find((c) => c.table === 'clients')!.in).toEqual([['id', ['client-1']]]);
    expect(tableCalls.find((c) => c.table === 'legal_entities')!.in).toEqual([['id', ['entity-1']]]);
    expect(tableCalls.find((c) => c.table === 'compliance_types')!.in).toEqual([['id', [TYPE_ID]]]);
    expect(tableCalls.find((c) => c.table === 'firm_memberships')!.in).toEqual([
      ['id', ['m-1', 'm-2']],
    ]);
    expect(tableCalls.find((c) => c.table === 'profiles')!.in).toEqual([
      ['id', ['u-1', 'u-2']],
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      id: 'inst-1',
      clientId: 'client-1',
      clientName: 'ABC Pvt Ltd',
      legalEntityId: 'entity-1',
      entityName: 'ABC Pvt Ltd (Main)',
      complianceTypeId: TYPE_ID,
      complianceName: 'Tax Audit (44AB)',
      periodLabel: 'FY 2025-26',
      state: 'information_requested',
      dueDate: '2026-09-30',
      // due_date − the pinned Asia/Kolkata business date (2026-09-16) = 14.
      daysLeft: 14,
      assigneeMembershipId: 'm-1',
      assigneeName: 'Priya Sharma',
      reviewerMembershipId: 'm-2',
      reviewerName: 'Rahul Verma',
    });
  });

  it('unresolvable projections render null, never fail; no staff reads when nobody is assigned', async () => {
    tableRows['compliance_instances'] = [
      {
        ...INSTANCE_ROW,
        id: 'inst-hidden',
        client_id: 'client-hidden',
        legal_entity_id: 'entity-hidden',
        assignee_membership_id: null,
        reviewer_membership_id: null,
      },
    ];
    // RLS-invisible client/entity/type rows: the projection reads return empty.
    tableRows['clients'] = [];
    tableRows['legal_entities'] = [];
    tableRows['compliance_types'] = [];

    const rows = await supabaseDeadlines.listDeadlineGroupInstances(GROUP_ID);
    expect(rows[0]).toMatchObject({
      id: 'inst-hidden',
      clientId: 'client-hidden',
      clientName: null,
      entityName: null,
      complianceName: null,
      assigneeMembershipId: null,
      assigneeName: null,
      reviewerMembershipId: null,
      reviewerName: null,
    });
    // membershipIds is empty → resolveStaffNames early-returns: NO
    // firm_memberships / profiles reads are issued.
    expect(tableCalls.map((c) => c.table).sort()).toEqual([
      'clients',
      'compliance_instances',
      'compliance_types',
      'legal_entities',
    ]);
  });

  it('a malformed group id is an empty drill-down with NO query issued', async () => {
    await expect(supabaseDeadlines.listDeadlineGroupInstances('malformed')).resolves.toEqual([]);
    await expect(supabaseDeadlines.listDeadlineGroupInstances('')).resolves.toEqual([]);
    expect(tableCalls).toHaveLength(0);
    expect(rpcCalls).toEqual([]);
  });

  it('an empty instance list is [] with the projection reads skipped (API-ERR-02)', async () => {
    tableRows['compliance_instances'] = [];
    await expect(supabaseDeadlines.listDeadlineGroupInstances(GROUP_ID)).resolves.toEqual([]);
    expect(tableCalls.map((c) => c.table)).toEqual(['compliance_instances']);
  });
});

describe('supabase deadlines adapter — projection C (client dependency view)', () => {
  beforeEach(() => {
    tableCalls.length = 0;
    rpcCalls.length = 0;
    tableRows = {};
    readErrors = {};
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW_IST));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reads client_dependency_board ordered by age_days descending and maps every field', async () => {
    tableRows['client_dependency_board'] = [
      DEPENDENCY_ROW,
      {
        ...DEPENDENCY_ROW,
        kind: 'instance',
        id: 'inst-7',
        label: 'Tax Audit (44AB)',
        period_label: 'FY 2025-26',
        waiting_reason: null,
        status: 'information_requested',
        age_days: 3,
      },
    ];
    const rows = await supabaseDeadlines.listClientDependencies();

    expect(tableCalls).toHaveLength(1);
    const read = tableCalls[0];
    expect(read.table).toBe('client_dependency_board');
    expect(read.order).toEqual([
      ['age_days', { ascending: false }],
      ['id', { ascending: true }],
    ]);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      kind: 'task',
      id: 'task-9',
      clientId: 'client-1',
      clientName: 'ABC Pvt Ltd',
      label: 'GSTR-1 reconciliation',
      periodLabel: null, // NULL passthrough — tasks carry no period
      waitingReason: 'Awaiting bank statements',
      status: 'waiting',
      waitingSince: '2026-09-01T04:00:00.000Z',
      ageDays: 15,
      dueDate: '2026-09-20',
      assigneeMembershipId: 'm-1',
      reviewerMembershipId: null,
    });
    // Instance provenance: period label present, waiting_reason NULL.
    expect(rows[1]).toMatchObject({
      kind: 'instance',
      periodLabel: 'FY 2025-26',
      waitingReason: null,
      status: 'information_requested',
      ageDays: 3,
    });
    expect(rows[0]).not.toHaveProperty('client_id');
    expect(rows[0]).not.toHaveProperty('waiting_reason');
    expect(rows[0]).not.toHaveProperty('age_days');
  });

  it('an empty dependency scope is [], never an error (API-ERR-02)', async () => {
    tableRows['client_dependency_board'] = [];
    await expect(supabaseDeadlines.listClientDependencies()).resolves.toEqual([]);
  });
});

describe('supabase deadlines adapter — plain-read posture & error translation', () => {
  beforeEach(() => {
    tableCalls.length = 0;
    rpcCalls.length = 0;
    tableRows = {};
    readErrors = {};
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW_IST));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('composes plain RLS reads only — no rpc, no writes (DM-X-02)', async () => {
    tableRows['deadline_board'] = [BOARD_ROW];
    tableRows['compliance_instances'] = [INSTANCE_ROW];
    tableRows['clients'] = [{ id: 'client-1', name: 'ABC Pvt Ltd' }];
    tableRows['legal_entities'] = [{ id: 'entity-1', legal_name: 'ABC Pvt Ltd (Main)' }];
    tableRows['compliance_types'] = [{ id: TYPE_ID, name: 'Tax Audit (44AB)' }];
    tableRows['firm_memberships'] = [
      { id: 'm-1', user_id: 'u-1' },
      { id: 'm-2', user_id: 'u-2' },
    ];
    tableRows['profiles'] = [
      { id: 'u-1', full_name: 'Priya Sharma' },
      { id: 'u-2', full_name: 'Rahul Verma' },
    ];
    tableRows['client_dependency_board'] = [DEPENDENCY_ROW];

    await supabaseDeadlines.listDeadlineGroups();
    await supabaseDeadlines.listDeadlineGroupInstances(GROUP_ID);
    await supabaseDeadlines.listClientDependencies();

    expect(rpcCalls).toEqual([]);
    expect(tableCalls.every((c) => c.verb === undefined)).toBe(true);
    expect(new Set(tableCalls.map((c) => c.table))).toEqual(
      new Set([
        'deadline_board',
        'client_dependency_board',
        'compliance_instances',
        'clients',
        'legal_entities',
        'compliance_types',
        'firm_memberships',
        'profiles',
      ]),
    );
  });

  it('a read carrying { error } rejects with an ApiError (toApiError, API-ERR-01)', async () => {
    // PostgreSQL insufficient_privilege (RLS denial surface) → unauthorized.
    readErrors['deadline_board'] = { message: 'permission denied for table', code: '42501' };
    await expect(supabaseDeadlines.listDeadlineGroups()).rejects.toMatchObject({
      name: 'ApiError',
      kind: 'unauthorized',
    });

    // The same translation applies to the drill-down and dependency reads.
    readErrors['compliance_instances'] = { message: 'boom', status: 500 };
    await expect(supabaseDeadlines.listDeadlineGroupInstances(GROUP_ID)).rejects.toMatchObject({
      name: 'ApiError',
      kind: 'internal',
    });
    readErrors['client_dependency_board'] = { message: 'permission denied', code: '42501' };
    await expect(supabaseDeadlines.listClientDependencies()).rejects.toMatchObject({
      name: 'ApiError',
      kind: 'unauthorized',
    });
  });
});
