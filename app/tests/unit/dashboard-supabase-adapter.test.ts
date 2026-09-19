/**
 * IMP-060 — Supabase Dashboard adapter contract test (production path,
 * network mocked).
 *
 * Pins the adapter to the human-approved B-count architecture (API-OQ-03
 * resolved 2026-09-19, API-R0-DASH): it mocks the browser client boundary
 * (@/lib/supabaseClient), captures every table read / rpc invocation, and
 * asserts:
 *
 *   - EVERY scalar aggregate is a per-section EXACT-COUNT HEAD read
 *     (select('id', { count: 'exact', head: true })) — 8 task-state counts,
 *     10 instance-state counts, 1 review-pending count, 1 persisted-active
 *     alert count; NO row dataset is ever fetched to compute a scalar
 *     (B-fetch is NOT the aggregate implementation);
 *   - the ONLY row fetches are the two approved derivations: the limited
 *     snoozed-alert projection (exactly 'id, snoozed_until, acknowledged_at',
 *     TEST-API-18 read derivation) and the deadline_board at_risk column
 *     (IMP-051 view derivation, summed — never re-implemented);
 *   - NO rpc, NO writes, no composite/SECURITY DEFINER path (API-SEC-03);
 *   - the active-alert total = persisted-active exact count + snoozed rows
 *     whose TEST-API-18 effective status is 'active' (expired snooze with
 *     acknowledged_at NULL); expired-acknowledged and future snoozes do NOT
 *     count; one pinned clock reading per composition;
 *   - count mapping: each eq()-filtered count lands on its own state key;
 *   - no active-firm selector → the truthful empty contract with ZERO
 *     queries (RLS-CTX-01/02: context selection, never authorization);
 *   - error path: ANY failed read rejects through toApiError() — a failure
 *     is never reported as a zero and never falls back to fixtures
 *     (MIG-DS-05).
 *
 * The supabase adapter is imported DIRECTLY here (not via the
 * DATA_SOURCE-pinned selector) — a test-only reach into the implementation
 * module to verify the production contract without a backend.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface CapturedCall {
  table: string;
  columns?: string;
  options?: { count?: string; head?: boolean };
  eq: [string, unknown][];
  verb?: 'insert' | 'update' | 'delete';
}

const tableCalls: CapturedCall[] = [];
const rpcCalls: string[] = [];
/** Exact counts keyed `${table}|${eqCol}=${eqVal}`. */
let countMap: Record<string, number> = {};
/** Row payloads keyed by table (for the limited derivation fetches). */
let rowMap: Record<string, unknown[]> = {};
let readErrors: Record<string, unknown | null> = {};

vi.mock('@/lib/supabaseClient', () => ({
  getSupabaseClient: () => ({
    from: (table: string) => {
      const entry: CapturedCall = { table, eq: [] };
      tableCalls.push(entry);
      const builder: Record<string, unknown> = {
        select: (columns: string, options?: { count?: string; head?: boolean }) => {
          entry.columns = columns;
          entry.options = options;
          return builder;
        },
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
        then: (resolve: (v: unknown) => void) => {
          const eqKey = entry.eq.map(([c, v]) => `${c}=${String(v)}`).join('|');
          const count = countMap[`${table}|${eqKey}`] ?? 0;
          resolve({
            data: entry.options?.head ? null : (rowMap[table] ?? []),
            count,
            error: readErrors[table] ?? null,
          });
        },
      };
      return builder;
    },
    rpc: async (name: string) => {
      rpcCalls.push(name);
      return { data: null, error: null };
    },
  }),
}));

import { clearActiveFirm, setActiveFirm } from '@/data/context';
import { supabaseDashboard } from '@/data/dashboard/supabase';
import {
  DASHBOARD_INSTANCE_STATES,
  DASHBOARD_TASK_STATES,
  emptyDashboardAggregates,
} from '@/data/dashboard/types';

const FIRM = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

/** 2026-09-19T04:00:00Z — pinned composition clock for the snooze derivation. */
const NOW = '2026-09-19T04:00:00.000Z';
const PAST = '2026-09-18T04:00:00.000Z'; // before NOW → expired snooze
const FUTURE = '2026-09-20T04:00:00.000Z'; // after NOW → still snoozed

function countReadsFor(table: string): CapturedCall[] {
  return tableCalls.filter((c) => c.table === table && c.options?.head === true);
}

describe('supabase dashboard adapter — B-count query shape (API-OQ-03)', () => {
  beforeEach(() => {
    tableCalls.length = 0;
    rpcCalls.length = 0;
    countMap = {};
    rowMap = {};
    readErrors = {};
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
    setActiveFirm(FIRM);
  });

  afterEach(() => {
    clearActiveFirm();
    vi.useRealTimers();
  });

  it('every scalar is an exact-count HEAD read; only the two approved derivations fetch rows', async () => {
    await supabaseDashboard.getDashboardAggregates();

    // 8 task-state + 10 instance-state + 1 review-pending + 1 persisted-active
    // alert exact-count HEAD reads = 20 scalar reads, all select('id').
    const taskReads = countReadsFor('tasks');
    expect(taskReads).toHaveLength(8);
    expect(taskReads.map((r) => r.eq)).toEqual(
      DASHBOARD_TASK_STATES.map((s) => [['status', s]]),
    );
    const instanceReads = countReadsFor('compliance_instances');
    expect(instanceReads).toHaveLength(10);
    expect(instanceReads.map((r) => r.eq)).toEqual(
      DASHBOARD_INSTANCE_STATES.map((s) => [['state', s]]),
    );
    for (const r of [...taskReads, ...instanceReads]) {
      expect(r.columns).toBe('id');
      expect(r.options).toEqual({ count: 'exact', head: true });
    }
    const reviewReads = countReadsFor('review_items');
    expect(reviewReads).toHaveLength(1);
    expect(reviewReads[0].eq).toEqual([['status', 'pending']]);
    expect(reviewReads[0].options).toEqual({ count: 'exact', head: true });
    const activeAlertReads = tableCalls.filter(
      (c) => c.table === 'alerts' && c.options?.head === true,
    );
    expect(activeAlertReads).toHaveLength(1);
    expect(activeAlertReads[0].eq).toEqual([['status', 'active']]);

    // NO row fetch exists for any scalar: tasks / compliance_instances /
    // review_items are HEAD-only.
    expect(
      tableCalls.filter(
        (c) =>
          ['tasks', 'compliance_instances', 'review_items'].includes(c.table) &&
          c.options?.head !== true,
      ),
    ).toEqual([]);

    // Approved row fetch 1 — the limited snoozed-alert projection
    // (TEST-API-18): exactly the three derivation columns, no head flag.
    const snoozedFetch = tableCalls.filter(
      (c) => c.table === 'alerts' && c.options?.head !== true,
    );
    expect(snoozedFetch).toHaveLength(1);
    expect(snoozedFetch[0].columns).toBe('id, snoozed_until, acknowledged_at');
    expect(snoozedFetch[0].eq).toEqual([['status', 'snoozed']]);

    // Approved row fetch 2 — the deadline_board at_risk column (IMP-051 view
    // derivation; the adapter never recomputes at-risk).
    const boardFetch = tableCalls.filter((c) => c.table === 'deadline_board');
    expect(boardFetch).toHaveLength(1);
    expect(boardFetch[0].columns).toBe('at_risk');

    // No rpc, no writes, no other tables: exactly 22 reads per composition.
    expect(rpcCalls).toEqual([]);
    expect(tableCalls.every((c) => c.verb === undefined)).toBe(true);
    expect(tableCalls).toHaveLength(22);
  });

  it('maps each eq-filtered exact count to its own state key', async () => {
    countMap['tasks|status=open'] = 7;
    countMap['tasks|status=done'] = 3;
    countMap['compliance_instances|state=preparation'] = 5;
    countMap['compliance_instances|state=filed'] = 2;
    countMap['review_items|status=pending'] = 4;
    countMap['alerts|status=active'] = 6;

    const agg = await supabaseDashboard.getDashboardAggregates();
    expect(agg.taskCountsByState.open).toBe(7);
    expect(agg.taskCountsByState.done).toBe(3);
    expect(agg.taskCountsByState.in_progress).toBe(0);
    expect(agg.complianceInstanceCountsByState.preparation).toBe(5);
    expect(agg.complianceInstanceCountsByState.filed).toBe(2);
    expect(agg.reviewPending).toBe(4);
    expect(agg.activeAlerts).toBe(6); // no snoozed rows → no derivation increment
  });

  it('sums the deadline_board at_risk derivation (never recomputes it)', async () => {
    rowMap['deadline_board'] = [{ at_risk: 2 }, { at_risk: 5 }, { at_risk: 0 }];
    const agg = await supabaseDashboard.getDashboardAggregates();
    expect(agg.atRiskDeadlines).toBe(7);
  });

  it('active alerts = persisted-active count + TEST-API-18 snooze derivation', async () => {
    countMap['alerts|status=active'] = 2;
    rowMap['alerts'] = [
      // Expired snooze, never acknowledged → reads active (counts).
      { id: 'a1', snoozed_until: PAST, acknowledged_at: null },
      // Expired snooze WITH acknowledgement → reads acknowledged (not counted).
      { id: 'a2', snoozed_until: PAST, acknowledged_at: '2026-09-17T04:00:00.000Z' },
      // Future snooze → still snoozed (not counted).
      { id: 'a3', snoozed_until: FUTURE, acknowledged_at: null },
      // NULL snoozed_until → stays snoozed (not counted).
      { id: 'a4', snoozed_until: null, acknowledged_at: null },
    ];
    const agg = await supabaseDashboard.getDashboardAggregates();
    expect(agg.activeAlerts).toBe(3);
  });

  it('no active-firm selector → the truthful empty contract with ZERO queries', async () => {
    clearActiveFirm();
    const agg = await supabaseDashboard.getDashboardAggregates();
    expect(agg).toEqual(emptyDashboardAggregates());
    expect(tableCalls).toHaveLength(0);
    expect(rpcCalls).toEqual([]);
  });

  it('any failed read rejects through toApiError — never a fabricated zero', async () => {
    readErrors['tasks'] = { message: 'permission denied for table tasks', code: '42501' };
    await expect(supabaseDashboard.getDashboardAggregates()).rejects.toMatchObject({
      name: 'ApiError',
      kind: 'unauthorized',
    });

    readErrors['tasks'] = null;
    readErrors['review_items'] = { message: 'boom', status: 500 };
    await expect(supabaseDashboard.getDashboardAggregates()).rejects.toMatchObject({
      name: 'ApiError',
      kind: 'internal',
    });

    readErrors['review_items'] = null;
    readErrors['deadline_board'] = { message: 'permission denied', code: '42501' };
    await expect(supabaseDashboard.getDashboardAggregates()).rejects.toMatchObject({
      name: 'ApiError',
      kind: 'unauthorized',
    });
  });
});
