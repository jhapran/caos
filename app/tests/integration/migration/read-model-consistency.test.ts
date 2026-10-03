/**
 * IMP-070 — TEST-MIG-04: read-model consistency spot checks. The IMP-060/051/
 * 061 read models are cross-checked against base-table derivations on the
 * suite-seeded dataset (fixture-setup.mjs), two ways exactly as application
 * code reads them:
 *   - the REAL Supabase adapters through an authenticated SDK session +
 *     setActiveFirm() (the dashboard/deadline-suite precedent);
 *   - raw PostgREST/RPC with a signed-in token + the untrusted
 *     x-active-firm selector (RLS-CTX-02), Prefer count=exact where useful.
 *
 * SPOT-CHECK scope: representative derivations, not exhaustive certification
 * (the owning IMP-051/060/061 suites carry the exhaustive contracts). Operator
 * psql is used only for fixture seed/teardown and the base-table derivation
 * truth — never as an RLS proof mechanism.
 *
 * Seeded truth this suite derives (see fixture-setup.mjs):
 *   tasks: 1 in_progress (t1) + 1 waiting (t2);
 *   instances: 1 preparation due TODAY+7 (i1) + 1 information_requested due
 *     TODAY-2 (i2 — the at-risk row and the dependency-board instance row);
 *   review: 1 pending; alerts: 1 persisted active + 1 EXPIRED unacknowledged
 *   snooze (TEST-API-18 reads it effectively active → activeAlerts = 2);
 *   deadline_board: 2 (type, due_date) groups; client_dependency_board: the
 *   i2 instance row + the t2 waiting-task row.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { clearActiveFirm, setActiveFirm } from '@/data/context';
import { supabaseDashboard } from '@/data/dashboard/supabase';
import { supabaseDeadlines } from '@/data/deadlines/supabase';
import type { DeadlineGroupRecord } from '@/data/deadlines/index';
import { getSupabaseClient } from '@/lib/supabaseClient';

import { api, PASSWORD, psql, signIn, userEmail } from '../helpers.mjs';
import {
  C,
  I,
  SUITE_FIRM,
  SYS_ITR,
  T,
  cleanMigrationFixture,
  seedMigrationFixture,
} from './fixture-setup.mjs';

const H = { 'x-active-firm': SUITE_FIRM };

const TASK_STATES = ['open', 'in_progress', 'waiting', 'submitted', 'returned', 'approved', 'done', 'cancelled'];
const INSTANCE_STATES = [
  'not_started',
  'information_requested',
  'information_received',
  'preparation',
  'internal_review',
  'client_approval',
  'ready_to_file',
  'filed',
  'acknowledgement_received',
  'closed',
];

async function tokenFor(userKey: string): Promise<string> {
  const s = await signIn(userEmail(userKey));
  if (!s.ok) throw new Error(`sign-in failed for ${userKey}: ${JSON.stringify(s.raw)}`);
  return s.token;
}

/** Raw-path exact count: a signed-in token + the untrusted selector,
 *  PostgREST count=exact (the dashboard-suite helper pattern). */
async function exactCount(token: string, path: string): Promise<number> {
  const res = await api(token, 'GET', path, { headers: { ...H, Prefer: 'count=exact' } });
  expect(res.status).toBe(200);
  const total = Number((res.contentRange ?? '').split('/')[1]);
  expect(Number.isInteger(total), `content-range ${res.contentRange}`).toBe(true);
  return total;
}

interface BoardRow {
  group_id: string;
  firm_id: string;
  compliance_type_id: string;
  due_date: string;
  days_left: number;
  total_clients: number;
  filed: number;
  ready_to_file: number;
  in_progress: number;
  waiting: number;
  under_review: number;
  not_started: number;
  at_risk: number;
}

interface DependencyRow {
  kind: 'instance' | 'task';
  id: string;
  firm_id: string;
  client_id: string;
  status: string;
}

beforeAll(async () => {
  seedMigrationFixture();
  const { error } = await getSupabaseClient().auth.signInWithPassword({
    email: userEmail('USER_A_PARTNER'),
    password: PASSWORD,
  });
  expect(error).toBeNull();
  setActiveFirm(SUITE_FIRM);
});

afterAll(async () => {
  clearActiveFirm();
  await getSupabaseClient().auth.signOut();
  cleanMigrationFixture();
});

describe('TEST-MIG-04 — dashboard aggregates vs base-table exact counts (API-R0-DASH B-count derivation)', () => {
  it('per-state task/instance counts, reviewPending and atRiskDeadlines match raw exact counts for the same caller', async () => {
    const token = await tokenFor('USER_A_PARTNER');
    const agg = await supabaseDashboard.getDashboardAggregates();

    // The adapter derivation (src/data/dashboard/supabase.ts): one exact
    // count per state, status/state equality — replicated verbatim here.
    for (const status of TASK_STATES) {
      expect(await exactCount(token, `tasks?select=id&status=eq.${status}`), `tasks ${status}`).toBe(
        agg.taskCountsByState[status as keyof typeof agg.taskCountsByState],
      );
    }
    for (const state of INSTANCE_STATES) {
      expect(
        await exactCount(token, `compliance_instances?select=id&state=eq.${state}`),
        `instances ${state}`,
      ).toBe(agg.complianceInstanceCountsByState[state as keyof typeof agg.complianceInstanceCountsByState]);
    }
    // Seeded truth: the non-zero buckets are exactly the fixture states.
    expect(agg.taskCountsByState.in_progress).toBe(1);
    expect(agg.taskCountsByState.waiting).toBe(1);
    expect(agg.complianceInstanceCountsByState.preparation).toBe(1);
    expect(agg.complianceInstanceCountsByState.information_requested).toBe(1);

    expect(await exactCount(token, 'review_items?select=id&status=eq.pending')).toBe(agg.reviewPending);
    expect(agg.reviewPending).toBe(1);

    // atRiskDeadlines is the summed at_risk of the deadline_board view rows
    // (the adapter never re-implements the formula).
    const board = await api(token, 'GET', 'deadline_board?select=at_risk', { headers: H });
    expect(board.status).toBe(200);
    const boardRisk = (board.body as Array<{ at_risk: number }>).reduce((sum, r) => sum + r.at_risk, 0);
    expect(agg.atRiskDeadlines).toBe(boardRisk);
    expect(boardRisk).toBe(1); // only the overdue information_requested instance
  });

  it('activeAlerts applies the TEST-API-18 derivation: persisted-active exact count + expired UNACKNOWLEDGED snoozes only', async () => {
    const token = await tokenFor('USER_A_PARTNER');
    // Raw persisted truth: 1 'active', 1 'snoozed' (expired, no ack history).
    expect(await exactCount(token, 'alerts?select=id&status=eq.active')).toBe(1);
    expect(await exactCount(token, 'alerts?select=id&status=eq.snoozed')).toBe(1);
    const snoozed = await api(token, 'GET', 'alerts?select=id,snoozed_until,acknowledged_at&status=eq.snoozed', {
      headers: H,
    });
    expect(snoozed.status).toBe(200);
    const rows = snoozed.body as Array<{ id: string; snoozed_until: string | null; acknowledged_at: string | null }>;
    const expiredUnacknowledged = rows.filter(
      (r) => r.snoozed_until !== null && new Date(r.snoozed_until) <= new Date() && r.acknowledged_at === null,
    ).length;
    expect(expiredUnacknowledged).toBe(1);

    const agg = await supabaseDashboard.getDashboardAggregates();
    expect(agg.activeAlerts).toBe(1 + expiredUnacknowledged);
  });
});

describe('TEST-MIG-04 — deadline_board view vs base compliance_instances derivation (AUTO-DLN-01)', () => {
  it('view rows equal the base-table grouping (same bucket filters as the view SQL), and the adapter agrees', async () => {
    const token = await tokenFor('USER_A_PARTNER');
    const view = await api(
      token,
      'GET',
      'deadline_board?select=group_id,firm_id,compliance_type_id,due_date,days_left,total_clients,filed,ready_to_file,in_progress,waiting,under_review,not_started,at_risk&order=due_date.asc',
      { headers: H },
    );
    expect(view.status).toBe(200);
    const rows = view.body as BoardRow[];
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.firm_id).toBe(SUITE_FIRM);
      expect(row.compliance_type_id).toBe(SYS_ITR);
    }

    // Base-table derivation with the SAME bucket filters as the view SQL
    // (migration 20260916000000_alert_evaluation.sql section 5a).
    const derived = psql(`
      select due_date || '|' || total_clients || '|' || filed || '|' || ready_to_file || '|' ||
             in_progress || '|' || waiting || '|' || under_review || '|' || not_started || '|' || at_risk
        from (
          select i.due_date,
                 count(*)::int as total_clients,
                 count(*) filter (where i.state in ('filed','acknowledgement_received','closed'))::int as filed,
                 count(*) filter (where i.state = 'ready_to_file')::int as ready_to_file,
                 count(*) filter (where i.state in ('information_received','preparation'))::int as in_progress,
                 count(*) filter (where i.state = 'information_requested')::int as waiting,
                 count(*) filter (where i.state in ('internal_review','client_approval'))::int as under_review,
                 count(*) filter (where i.state = 'not_started')::int as not_started,
                 count(*) filter (where i.state not in ('filed','acknowledgement_received','closed')
                                  and i.due_date <= (now() at time zone 'Asia/Kolkata')::date)::int as at_risk
            from public.compliance_instances i
           where i.firm_id = '${SUITE_FIRM}'
           group by i.due_date
        ) d order by due_date;
    `)
      .trim()
      .split('\n');
    const viewLines = rows.map((r) =>
      [r.due_date, r.total_clients, r.filed, r.ready_to_file, r.in_progress, r.waiting, r.under_review, r.not_started, r.at_risk].join('|'),
    );
    expect(viewLines).toEqual(derived);

    // The adapter composition reads the same view: identical group ids.
    const groups = await supabaseDeadlines.listDeadlineGroups();
    expect(groups.map((g: DeadlineGroupRecord) => g.groupId)).toEqual(rows.map((r) => r.group_id));
  });

  it('listDeadlineGroupInstances(groupId) returns exactly the underlying base-table instance ids', async () => {
    const groups = await supabaseDeadlines.listDeadlineGroups();
    for (const group of groups) {
      const instances = await supabaseDeadlines.listDeadlineGroupInstances(group.groupId);
      const base = psql(`
        select string_agg(id::text, ',' order by id) from public.compliance_instances
         where firm_id = '${SUITE_FIRM}'
           and compliance_type_id = '${group.complianceTypeId}'
           and due_date = '${group.dueDate}';
      `).trim();
      expect(instances.map((i) => i.id).sort().join(',')).toBe(base);
      expect(instances.length).toBeGreaterThan(0);
    }
    // The overdue group drills down to exactly the information_requested row.
    const overdue = groups.find((g) => g.atRisk === 1);
    expect(overdue).toBeDefined();
    const overdueInstances = await supabaseDeadlines.listDeadlineGroupInstances(overdue!.groupId);
    expect(overdueInstances.map((i) => i.id)).toEqual([I.i2]);
  });
});

describe('TEST-MIG-04 — client_dependency_board vs base derivation (information_requested instances + waiting tasks)', () => {
  it('view rows equal the base-table union, and the adapter agrees', async () => {
    const token = await tokenFor('USER_A_PARTNER');
    const view = await api(token, 'GET', 'client_dependency_board?select=kind,id,firm_id,client_id,status&order=id.asc', {
      headers: H,
    });
    expect(view.status).toBe(200);
    const rows = view.body as DependencyRow[];
    for (const row of rows) expect(row.firm_id).toBe(SUITE_FIRM);

    // Base-table derivation with the SAME source filters as the view SQL
    // (migration 20260916000000 section 5b).
    const base = psql(`
      select string_agg(kind || ':' || id::text, ',' order by id) from (
        select 'instance' as kind, i.id from public.compliance_instances i
         where i.firm_id = '${SUITE_FIRM}' and i.state = 'information_requested'
        union all
        select 'task', t.id from public.tasks t
         where t.firm_id = '${SUITE_FIRM}' and t.status = 'waiting'
      ) u;
    `).trim();
    expect(rows.map((r) => `${r.kind}:${r.id}`).sort().join(',')).toBe(base);
    expect(rows.map((r) => r.id).sort()).toEqual([I.i2, T.t2].sort());

    const deps = await supabaseDeadlines.listClientDependencies();
    expect(deps.map((d) => d.id).sort()).toEqual([I.i2, T.t2].sort());
    expect(deps.find((d) => d.id === I.i2)?.kind).toBe('instance');
    expect(deps.find((d) => d.id === T.t2)?.kind).toBe('task');
    expect(deps.find((d) => d.id === T.t2)?.clientId).toBe(C.c1);
  });
});

describe('TEST-MIG-04 — structured_search hits exist in and are visible from the base tables (IMP061-R5 caps)', () => {
  const KIND_TABLE: Record<string, string> = {
    client: 'clients',
    legal_entity: 'legal_entities',
    registration: 'registrations',
    task: 'tasks',
    compliance_instance: 'compliance_instances',
    staff: 'firm_memberships',
  };

  it('every returned id re-fetches by id under the SAME caller RLS; caps 5/kind and 20/global hold', async () => {
    const token = await tokenFor('USER_A_PARTNER');
    const res = await api(token, 'POST', 'rpc/structured_search', { headers: H, body: { p_query: 'MIG070' } });
    expect(res.status).toBe(200);
    const hits = res.body as Array<{ kind: string; id: string; label: string }>;
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.length).toBeLessThanOrEqual(20); // IMP061-R5 global cap
    expect(hits.some((h) => h.kind === 'client' && h.id === C.c1)).toBe(true);

    const perKind = new Map<string, number>();
    for (const hit of hits) {
      perKind.set(hit.kind, (perKind.get(hit.kind) ?? 0) + 1);
      const table = KIND_TABLE[hit.kind];
      expect(table, `unknown kind ${hit.kind}`).toBeDefined();
      const refetch = await api(token, 'GET', `${table}?id=eq.${hit.id}&select=id`, { headers: H });
      expect(refetch.status).toBe(200);
      expect((refetch.body as Array<{ id: string }>).map((r) => r.id), `${hit.kind} ${hit.id}`).toEqual([hit.id]);
    }
    for (const [kind, count] of perKind) {
      expect(count, `${kind} per-kind cap`).toBeLessThanOrEqual(5); // IMP061-R5 per-kind cap
    }
  });
});
