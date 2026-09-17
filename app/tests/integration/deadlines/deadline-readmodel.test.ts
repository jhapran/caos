/**
 * IMP-051 — Deadline read model integration tests
 * (TEST-API-20, API-R0-DLN, AUTO-DLN-01, API-ARCH-05, RLS-CIN-01).
 *
 * Drives the IMP-051 deadline read model against the REAL local stack two
 * ways, exactly as application code does:
 *   - raw PostgREST reads of the two security_invoker views
 *     (public.deadline_board / public.client_dependency_board — migration
 *     20260916000000_alert_evaluation.sql sections 5a/5b) with a signed-in
 *     token + the untrusted x-active-firm selector (RLS-CTX-02);
 *   - the REAL deadlinesService Supabase adapter composition through
 *     getSupabaseClient().auth password sign-in + setActiveFirm() (the
 *     IMP-042 mywork-scope.test.ts precedent).
 *
 * NO privileged SQL is a proof mechanism: operator psql is used only for
 * fixture seed/teardown. Proves:
 *   - board aggregation correctness: derived (compliance_type_id, due_date)
 *     groups over compliance_instances ONLY, the exact DM-SM-04 state-bucket
 *     counts, at_risk = pre-filing AND due on/before the Asia/Kolkata
 *     business date, days_left on the same basis (boundary: due today = 0),
 *     group_id '<compliance_type_id>::<YYYY-MM-DD>' (AUTO-DLN-01);
 *   - the OPERATIVE due_date is the grouping key: an instance whose
 *     calculated_due_date provenance differs by ten days still lands in the
 *     operative-due group; the calculated date never forms a group;
 *   - drill-down (projection B) returns exactly the group's instance rows
 *     with client/entity projections; service groups match the PostgREST
 *     board rows field-for-field; the client-dependency board (projection C)
 *     carries the information_requested instance AND the waiting task
 *     (tasks appear ONLY here) with waiting_reason and server-derived
 *     age_days (DM-X-03);
 *   - role scope IDENTICAL to the underlying reads (RLS-CIN-01 /
 *     RLS-TSK-01): manager reads are portfolio-scoped (the mixed-portfolio
 *     group counts only the portfolio instance); senior reads are
 *     assigned-only — the views LEFT JOIN their decorating tables
 *     (interpretation (k)), so a group/row containing senior-visible work
 *     stays present and only the name decoration degrades to NULL
 *     (compliance_types and clients are manager-plus reads in R0 —
 *     compliance_name on the board, client_name and the instance-kind
 *     label on the dependency board), while the aggregation counts run
 *     over ONLY the caller-visible rows; cross-firm zero both directions
 *     (the selector grants nothing);
 *   - truthful empty (API-ERR-02): billing gets empty collections from
 *     both views and all three service methods — never an error and never
 *     fabricated rows (RLS hides the base rows themselves);
 *   - anon (apikey only, no token) is refused 401 on both views — SELECT is
 *     granted to authenticated only.
 *
 * Fixture discipline (IMP-050 recurrence.test.ts precedent): TWO dedicated
 * suite-owned firms in the 6f620000-… range (never the shared registry
 * FIRM_A/B), deterministic ids, force-reset on every run; fixture
 * audit/outbox noise removed as the operator, scoped to THESE two firm ids
 * only (AUD-INV-01). The waiting task and the non-default instance states
 * are plain operator INSERTs (the DM-SM-04/05 guards bind UPDATE only; the
 * waiting-reason invariant is command-owned — the mywork fixture
 * precedent). Date fixtures are Asia/Kolkata business dates computed both
 * SQL-side (seed) and via the shared kolkataBusinessDate() helper
 * (assertions) — the suite stays exact on any run date.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { clearActiveFirm, setActiveFirm } from '@/data/context';
// NAMING HAZARD: '@/data/deadlines' resolves to the LEGACY flat fixture
// module src/data/deadlines.ts — the live IMP-051 module is addressed
// through its explicit sub-barrel (the src/data/index.ts convention).
import { deadlinesService, makeDeadlineGroupId } from '@/data/deadlines/index';
import type { DeadlineGroupRecord } from '@/data/deadlines/index';
import { kolkataBusinessDate } from '@/data/mywork';
import { getSupabaseClient } from '@/lib/supabaseClient';

import { api, localEnv, PASSWORD, psql, signIn, userEmail, userId } from '../helpers.mjs';

// This suite owns TWO dedicated firms — never the shared registry FIRM_A/B.
const FDA = '6f620000-0000-4000-8000-000000000001';
const FDB = '6f620000-0000-4000-8000-000000000002';
const ALL_FIRMS = [FDA, FDB];
const H = (firm: string) => ({ 'x-active-firm': firm });

// Seeded system reference type (supabase/seed.sql): 'Income Tax Return',
// entity-scoped — readable without any fixture compliance_types row.
const SYS_ITR = '50000000-0000-4000-8000-000000000005';

const M = {
  superA: '6f620000-0000-4000-8000-000000000011',
  partnerA: '6f620000-0000-4000-8000-000000000012',
  managerA: '6f620000-0000-4000-8000-000000000013',
  seniorA: '6f620000-0000-4000-8000-000000000014',
  billingA: '6f620000-0000-4000-8000-000000000015',
  partnerB: '6f620000-0000-4000-8000-000000000016', // FDB partner
};
const C = {
  c1: '6f620000-0000-4000-8000-000000000021', // FDA — the manager's portfolio client
  c2: '6f620000-0000-4000-8000-000000000022', // FDA — NOT the manager's client
  cb: '6f620000-0000-4000-8000-000000000023', // FDB
};
const E = {
  e1: '6f620000-0000-4000-8000-000000000031', // C.c1
  e2: '6f620000-0000-4000-8000-000000000032', // C.c2
  eb: '6f620000-0000-4000-8000-000000000033', // C.cb
};
const I = {
  i1: '6f620000-0000-4000-8000-000000000041', // C1/E1 preparation, due TODAY, assignee senior, calculated = today-10
  i2: '6f620000-0000-4000-8000-000000000042', // C1/E1 ready_to_file, due TODAY+3
  i3: '6f620000-0000-4000-8000-000000000043', // C2/E2 not_started, due TODAY+3 (outside the manager portfolio)
  i4: '6f620000-0000-4000-8000-000000000044', // C1/E1 filed, due TODAY
  i5: '6f620000-0000-4000-8000-000000000045', // C1/E1 information_requested, due TODAY-2 (overdue, dependency source)
  ib1: '6f620000-0000-4000-8000-000000000046', // FDB preparation, due TODAY (cross-firm isolation)
};
const T = {
  t1: '6f620000-0000-4000-8000-000000000051', // C1 waiting task linked to I.i1, assignee senior
};

// Asia/Kolkata business dates at run time (seed computes them SQL-side).
const shift = (date: string, days: number): string => {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const TODAY = kolkataBusinessDate();
const UPCOMING = shift(TODAY, 3);
const OVERDUE = shift(TODAY, -2);
const CALC_MINUS_10 = shift(TODAY, -10);

const GROUP_TODAY = makeDeadlineGroupId(SYS_ITR, TODAY);
const GROUP_UPCOMING = makeDeadlineGroupId(SYS_ITR, UPCOMING);
const GROUP_OVERDUE = makeDeadlineGroupId(SYS_ITR, OVERDUE);

interface BoardRow {
  group_id: string;
  firm_id: string;
  compliance_type_id: string;
  /** NULL when the caller cannot read the decorating compliance_types row
   *  (LEFT JOIN degradation, interpretation (k)) — e.g. senior/billing. */
  compliance_name: string | null;
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

const BOARD_COLUMNS =
  'group_id,firm_id,compliance_type_id,compliance_name,due_date,days_left,' +
  'total_clients,filed,ready_to_file,in_progress,waiting,under_review,not_started,at_risk';

async function tokenFor(userKey: string): Promise<string> {
  const s = await signIn(userEmail(userKey));
  if (!s.ok) throw new Error(`sign-in failed for ${userKey}: ${JSON.stringify(s.raw)}`);
  return s.token;
}

/** The view proof path: a signed-in token + the untrusted selector, raw
 *  PostgREST against the security_invoker board. */
async function board(userKey: string, firm: string): Promise<BoardRow[]> {
  const token = await tokenFor(userKey);
  const res = await api(token, 'GET', `deadline_board?select=${BOARD_COLUMNS}&order=due_date.asc`, {
    headers: H(firm),
  });
  expect(res.status).toBe(200);
  return res.body as BoardRow[];
}

/** The adapter proof path: an authenticated session + the selector, then
 *  the REAL deadlinesService composition (mywork precedent). */
async function serviceAs(userKey: string, firm: string) {
  const { error } = await getSupabaseClient().auth.signInWithPassword({ email: userEmail(userKey), password: PASSWORD });
  expect(error).toBeNull();
  setActiveFirm(firm);
  return deadlinesService;
}

const byGroup = (rows: BoardRow[], groupId: string): BoardRow => {
  const row = rows.find((r) => r.group_id === groupId);
  expect(row, `board row ${groupId}`).toBeDefined();
  return row as BoardRow;
};

function cleanRows() {
  psql(`
    delete from public.audit_log where firm_id in (${ALL_FIRMS.map((f) => `'${f}'`).join(',')});
    delete from public.event_outbox where firm_id in (${ALL_FIRMS.map((f) => `'${f}'`).join(',')});
    delete from public.tasks where firm_id in (${ALL_FIRMS.map((f) => `'${f}'`).join(',')});
    delete from public.compliance_instances where firm_id in (${ALL_FIRMS.map((f) => `'${f}'`).join(',')});
    delete from public.legal_entities where firm_id in (${ALL_FIRMS.map((f) => `'${f}'`).join(',')});
    delete from public.clients where firm_id in (${ALL_FIRMS.map((f) => `'${f}'`).join(',')});
    delete from public.firm_memberships where firm_id in (${ALL_FIRMS.map((f) => `'${f}'`).join(',')});
  `);
}

beforeAll(() => {
  cleanRows();
  psql(`
    insert into public.firms (id, name) values
      ('${FDA}', 'IMP-051 DLN Firm A'),
      ('${FDB}', 'IMP-051 DLN Firm B')
    on conflict (id) do nothing;

    insert into public.firm_memberships (id, firm_id, user_id, role, status) values
      ('${M.superA}',   '${FDA}', '${userId('USER_A_SUPER_ADMIN')}', 'super_admin', 'active'),
      ('${M.partnerA}', '${FDA}', '${userId('USER_A_PARTNER')}',     'partner',     'active'),
      ('${M.managerA}', '${FDA}', '${userId('USER_A_MANAGER')}',     'manager',     'active'),
      ('${M.seniorA}',  '${FDA}', '${userId('USER_A_SENIOR')}',      'senior',      'active'),
      ('${M.billingA}', '${FDA}', '${userId('USER_A_BILLING')}',     'billing',     'active'),
      ('${M.partnerB}', '${FDB}', '${userId('USER_B_PARTNER')}',     'partner',     'active')
    on conflict (firm_id, user_id) do nothing;

    -- Force-reset mutable state so re-runs are deterministic even if a
    -- previous run left a membership mid-flight.
    update public.firm_memberships set status = 'active'
      where id in ('${M.superA}', '${M.partnerA}', '${M.managerA}', '${M.seniorA}',
                   '${M.billingA}', '${M.partnerB}');

    insert into public.clients (id, firm_id, name, owner_partner_membership_id, manager_membership_id, status) values
      ('${C.c1}', '${FDA}', 'DLN Client One', '${M.partnerA}', '${M.managerA}', 'active'),
      ('${C.c2}', '${FDA}', 'DLN Client Two', '${M.partnerA}', null,            'active'),
      ('${C.cb}', '${FDB}', 'DLN Client B',   '${M.partnerB}', null,            'active');

    insert into public.legal_entities (id, firm_id, client_id, entity_type, legal_name) values
      ('${E.e1}', '${FDA}', '${C.c1}', 'private_limited', 'DLN Entity One'),
      ('${E.e2}', '${FDA}', '${C.c2}', 'private_limited', 'DLN Entity Two'),
      ('${E.eb}', '${FDB}', '${C.cb}', 'private_limited', 'DLN Entity B');

    -- Instance fixtures are plain operator INSERTs: client_id is
    -- trigger-derived from the legal entity (SCH-A-02), and the state guard
    -- binds UPDATE only (DM-SM-04 transition legality is command-owned).
    -- I.i1's calculated_due_date provenance deliberately differs from its
    -- operative due_date by ten days — the board must group on due_date.
    insert into public.compliance_instances
      (id, firm_id, legal_entity_id, compliance_type_id, period_start, period_end,
       period_label, due_date, calculated_due_date, state, assignee_membership_id, updated_at)
    values
      ('${I.i1}', '${FDA}', '${E.e1}', '${SYS_ITR}', '2026-04-01', '2027-03-31', 'FY 2026-27',
       (now() at time zone 'Asia/Kolkata')::date,
       ((now() at time zone 'Asia/Kolkata')::date - 10),
       'preparation', '${M.seniorA}', null),
      ('${I.i2}', '${FDA}', '${E.e1}', '${SYS_ITR}', '2027-04-01', '2028-03-31', 'FY 2027-28',
       ((now() at time zone 'Asia/Kolkata')::date + 3), null, 'ready_to_file', null, null),
      ('${I.i3}', '${FDA}', '${E.e2}', '${SYS_ITR}', '2026-04-01', '2027-03-31', 'FY 2026-27',
       ((now() at time zone 'Asia/Kolkata')::date + 3), null, 'not_started', null, null),
      ('${I.i4}', '${FDA}', '${E.e1}', '${SYS_ITR}', '2025-04-01', '2026-03-31', 'FY 2025-26',
       (now() at time zone 'Asia/Kolkata')::date, null, 'filed', null, null),
      -- I.i5's updated_at is EXPLICIT and deterministic relative to the
      -- Asia/Kolkata business date (4 days waiting — entered
      -- information_requested before its due date passed 2 days ago): the
      -- dependency board derives waiting_since/age_days from it (DM-X-03).
      ('${I.i5}', '${FDA}', '${E.e1}', '${SYS_ITR}', '2024-04-01', '2025-03-31', 'FY 2024-25',
       ((now() at time zone 'Asia/Kolkata')::date - 2), null, 'information_requested', null,
       (((now() at time zone 'Asia/Kolkata')::date - 4)::timestamptz)),
      ('${I.ib1}', '${FDB}', '${E.eb}', '${SYS_ITR}', '2026-04-01', '2027-03-31', 'FY 2026-27',
       (now() at time zone 'Asia/Kolkata')::date, null, 'preparation', null, null);

    -- The waiting task is a plain operator INSERT (status is unguarded on
    -- INSERT — DM-SM-05 transition legality and the waiting-reason
    -- invariant are command-owned; the mywork fixture precedent). Its
    -- updated_at is EXPLICIT and deterministic (6 days waiting) — the same
    -- waiting_since/age_days derivation contract as I.i5.
    insert into public.tasks
      (id, firm_id, client_id, compliance_instance_id, title, next_action, status,
       waiting_reason, assignee_membership_id, updated_at)
    values
      ('${T.t1}', '${FDA}', '${C.c1}', '${I.i1}', 'DLN bank statement chase',
       'collect bank statements', 'waiting', 'bank statements', '${M.seniorA}',
       (((now() at time zone 'Asia/Kolkata')::date - 6)::timestamptz));
  `);
  // Fixture writes are operator/system-actor rows; remove fixture noise so
  // the table stays clean for other suites (IMP-031/040/041/042 precedent).
  psql(`
    delete from public.audit_log where firm_id in (${ALL_FIRMS.map((f) => `'${f}'`).join(',')});
    delete from public.event_outbox where firm_id in (${ALL_FIRMS.map((f) => `'${f}'`).join(',')});
  `);
});

afterAll(async () => {
  clearActiveFirm();
  await getSupabaseClient().auth.signOut();
  cleanRows();
  psql(`
    delete from public.firms where id in (${ALL_FIRMS.map((f) => `'${f}'`).join(',')})
      and not exists (select 1 from public.firm_memberships m where m.firm_id = firms.id)
      and not exists (select 1 from public.clients c where c.firm_id = firms.id);
    -- The firm DELETE itself lands a Layer-A audit row; sweep it last.
    delete from public.audit_log where firm_id in (${ALL_FIRMS.map((f) => `'${f}'`).join(',')});
  `);
});

describe('TEST-API-20 — API-R0-DLN deadline read model', () => {
  it('serves the shared contract in supabase mode (API-ARCH-02)', () => {
    expect(deadlinesService.mode).toBe('supabase');
  });

  // --- Board aggregation correctness (AUTO-DLN-01) ----------------------------

  it('board aggregation: exact bucket counts per derived group, group_id format, Kolkata days_left', async () => {
    const rows = await board('USER_A_PARTNER', FDA);

    // Exactly the three derived FDA groups, ascending due date — instances
    // ONLY (the waiting task never enters the board aggregation).
    expect(rows.map((r) => r.group_id)).toEqual([GROUP_OVERDUE, GROUP_TODAY, GROUP_UPCOMING]);
    expect(GROUP_TODAY).toBe(`${SYS_ITR}::${TODAY}`);
    for (const row of rows) {
      expect(row.firm_id).toBe(FDA);
      expect(row.compliance_type_id).toBe(SYS_ITR);
      expect(row.compliance_name).toBe('Income Tax Return');
    }

    // Today's group: I.i1 preparation -> in_progress (at_risk: due today and
    // pre-filing), I.i4 filed (never at_risk). Boundary: days_left = 0.
    const today = byGroup(rows, GROUP_TODAY);
    expect(today.total_clients).toBe(2);
    expect(today.in_progress).toBe(1);
    expect(today.filed).toBe(1);
    expect(today.ready_to_file).toBe(0);
    expect(today.waiting).toBe(0);
    expect(today.under_review).toBe(0);
    expect(today.not_started).toBe(0);
    expect(today.at_risk).toBe(1);
    expect(today.days_left).toBe(0);

    // Today+3 group aggregates across clients: I.i2 ready_to_file + I.i3
    // not_started; nothing due on/before the business date -> at_risk 0.
    const upcoming = byGroup(rows, GROUP_UPCOMING);
    expect(upcoming.total_clients).toBe(2);
    expect(upcoming.ready_to_file).toBe(1);
    expect(upcoming.not_started).toBe(1);
    expect(upcoming.filed).toBe(0);
    expect(upcoming.in_progress).toBe(0);
    expect(upcoming.waiting).toBe(0);
    expect(upcoming.under_review).toBe(0);
    expect(upcoming.at_risk).toBe(0);
    expect(upcoming.days_left).toBe(3);

    // Overdue group: I.i5 information_requested -> waiting bucket, at_risk.
    const overdue = byGroup(rows, GROUP_OVERDUE);
    expect(overdue.total_clients).toBe(1);
    expect(overdue.waiting).toBe(1);
    expect(overdue.at_risk).toBe(1);
    expect(overdue.days_left).toBe(-2);
  });

  // --- Operative due_date (AUTO-DLN-01; calculated_due_date never read) -------

  it('the board groups on the operative due_date — calculated_due_date provenance never forms a group', async () => {
    const rows = await board('USER_A_PARTNER', FDA);
    // I.i1's calculated_due_date is today-10; no group exists at that date.
    expect(rows.some((r) => r.due_date === CALC_MINUS_10)).toBe(false);

    // … and I.i1 drills down out of the TODAY group, due TODAY.
    const svc = await serviceAs('USER_A_PARTNER', FDA);
    const instances = await svc.listDeadlineGroupInstances(GROUP_TODAY);
    expect(instances.map((i) => i.id).sort()).toEqual([I.i1, I.i4].sort());
    const i1 = instances.find((i) => i.id === I.i1);
    expect(i1?.dueDate).toBe(TODAY);
    expect(i1?.daysLeft).toBe(0);
    expect(i1?.state).toBe('preparation');
  });

  // --- Drill-down + dependency projections through the real adapter -----------

  it('drill-down returns exactly the group members with projections; service groups match the view; dependencies carry instance + task rows', async () => {
    const svc = await serviceAs('USER_A_PARTNER', FDA);

    // Projection A through the adapter equals the raw view rows field-for-field.
    const groups = await svc.listDeadlineGroups();
    const rows = await board('USER_A_PARTNER', FDA);
    expect(groups.map((g) => g.groupId)).toEqual(rows.map((r) => r.group_id));
    const serviceShape = (g: DeadlineGroupRecord) => [
      g.complianceTypeId, g.complianceName, g.dueDate, g.daysLeft, g.totalClients,
      g.filed, g.readyToFile, g.inProgress, g.waiting, g.underReview, g.notStarted, g.atRisk,
    ];
    const rowShape = (r: BoardRow) => [
      r.compliance_type_id, r.compliance_name, r.due_date, r.days_left, r.total_clients,
      r.filed, r.ready_to_file, r.in_progress, r.waiting, r.under_review, r.not_started, r.at_risk,
    ];
    for (const g of groups) {
      expect(serviceShape(g), g.groupId).toEqual(rowShape(byGroup(rows, g.groupId)));
    }

    // Projection B: exactly I.i2 + I.i3 with client/entity projections.
    const instances = await svc.listDeadlineGroupInstances(GROUP_UPCOMING);
    expect(instances.map((i) => i.id).sort()).toEqual([I.i2, I.i3].sort());
    const i2 = instances.find((i) => i.id === I.i2);
    expect(i2?.clientId).toBe(C.c1);
    expect(i2?.clientName).toBe('DLN Client One');
    expect(i2?.entityName).toBe('DLN Entity One');
    expect(i2?.complianceName).toBe('Income Tax Return');
    expect(i2?.state).toBe('ready_to_file');
    expect(i2?.dueDate).toBe(UPCOMING);
    expect(i2?.daysLeft).toBe(3);
    const i3 = instances.find((i) => i.id === I.i3);
    expect(i3?.clientId).toBe(C.c2);
    expect(i3?.clientName).toBe('DLN Client Two');
    expect(i3?.entityName).toBe('DLN Entity Two');
    expect(i3?.state).toBe('not_started');
    expect(i3?.dueDate).toBe(UPCOMING);

    // A malformed/unknown group id is an empty drill-down, never an error.
    expect(await svc.listDeadlineGroupInstances('not-a-group-id')).toEqual([]);
    expect(await svc.listDeadlineGroupInstances(makeDeadlineGroupId(SYS_ITR, shift(TODAY, 30)))).toEqual([]);

    // Projection C: exactly the information_requested instance + the waiting
    // task (tasks appear ONLY in this projection).
    const deps = await svc.listClientDependencies();
    expect(deps.map((d) => d.id).sort()).toEqual([I.i5, T.t1].sort());
    const depInstance = deps.find((d) => d.id === I.i5);
    expect(depInstance?.kind).toBe('instance');
    expect(depInstance?.status).toBe('information_requested');
    expect(depInstance?.clientId).toBe(C.c1);
    expect(depInstance?.clientName).toBe('DLN Client One');
    expect(depInstance?.label).toBe('Income Tax Return');
    expect(depInstance?.periodLabel).toBe('FY 2024-25');
    expect(depInstance?.waitingReason).toBeNull();
    expect(depInstance?.dueDate).toBe(OVERDUE);
    // Deterministic ageing: updated_at = business_date − 4 (see fixtures).
    expect(depInstance?.waitingSince).not.toBeNull();
    expect(depInstance?.ageDays).toBe(4);
    const depTask = deps.find((d) => d.id === T.t1);
    expect(depTask?.kind).toBe('task');
    expect(depTask?.status).toBe('waiting');
    expect(depTask?.waitingReason).toBe('bank statements');
    expect(depTask?.periodLabel).toBeNull();
    expect(depTask?.label).toBe('DLN bank statement chase');
    expect(depTask?.clientName).toBe('DLN Client One');
    expect(depTask?.assigneeMembershipId).toBe(M.seniorA);
    // Deterministic ageing: updated_at = business_date − 6.
    expect(depTask?.waitingSince).not.toBeNull();
    expect(depTask?.ageDays).toBe(6);
  });

  // --- Role scope (RLS-CIN-01 / RLS-TSK-01) -----------------------------------

  it('manager scope: the mixed-portfolio today+3 group counts only the portfolio instance (RLS-STF-03)', async () => {
    const rows = await board('USER_A_MANAGER', FDA);
    // Both of today's instances belong to portfolio client C1 — same counts
    // as the partner read…
    const today = byGroup(rows, GROUP_TODAY);
    expect(today.total_clients).toBe(2);
    expect(today.in_progress).toBe(1);
    expect(today.filed).toBe(1);
    expect(today.at_risk).toBe(1);
    // … but the today+3 group drops I.i3 (C2 is NOT the manager's client).
    const upcoming = byGroup(rows, GROUP_UPCOMING);
    expect(upcoming.total_clients).toBe(1);
    expect(upcoming.ready_to_file).toBe(1);
    expect(upcoming.not_started).toBe(0);
    expect(upcoming.at_risk).toBe(0);
    // The overdue I.i5 is a portfolio-client row — still visible.
    expect(byGroup(rows, GROUP_OVERDUE).total_clients).toBe(1);
  });

  it('senior scope: assigned-only on the views (LEFT JOIN name degradation) and on the base-table drill-down', async () => {
    // The board's LEFT JOIN (interpretation (k)) keeps the group containing
    // the senior's assigned instance visible; the aggregation runs over
    // ONLY the senior-visible rows (I.i1 — I.i4 is not their work).
    const rows = await board('USER_A_SENIOR', FDA);
    expect(rows.map((r) => r.group_id)).toEqual([GROUP_TODAY]); // today+3 and overdue groups ABSENT
    const today = rows[0];
    expect(today.total_clients).toBe(1);
    expect(today.in_progress).toBe(1);
    expect(today.filed).toBe(0);
    expect(today.at_risk).toBe(1);
    expect(today.days_left).toBe(0);
    // compliance_types is a manager-plus read in R0: the decorating name
    // degrades to NULL, never hides the group.
    expect(today.compliance_name).toBeNull();
    expect(today.compliance_type_id).toBe(SYS_ITR);

    // The adapter's projection A/B read the same views under the senior's
    // session — same scope, same NULL degradation.
    const svc = await serviceAs('USER_A_SENIOR', FDA);
    const groups = await svc.listDeadlineGroups();
    expect(groups.map((g) => g.groupId)).toEqual([GROUP_TODAY]);
    expect(groups[0].complianceName).toBeNull();
    expect(groups[0].totalClients).toBe(1);
    expect(groups[0].inProgress).toBe(1);
    expect(groups[0].atRisk).toBe(1);

    // Projection C: the senior's assigned waiting task T.t1 surfaces;
    // clients is outside their read scope, so client_name degrades to NULL
    // (label is the task's own title — always present).
    const deps = await svc.listClientDependencies();
    expect(deps.map((d) => d.id)).toEqual([T.t1]);
    expect(deps[0].kind).toBe('task');
    expect(deps[0].status).toBe('waiting');
    expect(deps[0].waitingReason).toBe('bank statements');
    expect(deps[0].label).toBe('DLN bank statement chase');
    expect(deps[0].clientId).toBe(C.c1);
    expect(deps[0].clientName).toBeNull();

    // The senior's assigned-only scope is real at the base-table layer:
    // today's group drills down to exactly their assigned I.i1…
    const todayInstances = await svc.listDeadlineGroupInstances(GROUP_TODAY);
    expect(todayInstances.map((i) => i.id)).toEqual([I.i1]);
    // … with display references null under senior RLS (no client / reference
    // read in R0), never an error (DM-X-02 composition).
    expect(todayInstances[0].clientName).toBeNull();
    expect(todayInstances[0].entityName).toBeNull();
    expect(todayInstances[0].complianceName).toBeNull();
    expect(todayInstances[0].dueDate).toBe(TODAY);
    // … and the today+3 group (no senior assignment) is empty for them.
    expect(await svc.listDeadlineGroupInstances(GROUP_UPCOMING)).toEqual([]);
  });

  it('cross-firm isolation: the FDB partner sees only FDB rows; the FDA selector grants them nothing (RLS-CTX-02)', async () => {
    const rows = await board('USER_B_PARTNER', FDB);
    expect(rows).toHaveLength(1);
    expect(rows[0].firm_id).toBe(FDB);
    expect(rows[0].group_id).toBe(GROUP_TODAY); // I.ib1, preparation, due today
    expect(rows[0].total_clients).toBe(1);
    expect(rows[0].in_progress).toBe(1);
    expect(rows[0].at_risk).toBe(1);
    // Selecting FDA without a live membership there: empty, never an error.
    expect(await board('USER_B_PARTNER', FDA)).toEqual([]);
  });

  // --- Truthful empty (API-ERR-02 collection semantics) ------------------------

  it('billing scope: empty collections from both views and all three service methods — never an error', async () => {
    expect(await board('USER_A_BILLING', FDA)).toEqual([]);
    const token = await tokenFor('USER_A_BILLING');
    const deps = await api(token, 'GET', 'client_dependency_board?select=kind,id,status', {
      headers: H(FDA),
    });
    expect(deps.status).toBe(200);
    expect(deps.body).toEqual([]);

    const svc = await serviceAs('USER_A_BILLING', FDA);
    expect(await svc.listDeadlineGroups()).toEqual([]);
    expect(await svc.listDeadlineGroupInstances(GROUP_TODAY)).toEqual([]);
    expect(await svc.listClientDependencies()).toEqual([]);
  });

  it('senior on the client-dependency view: the assigned waiting task is visible with client_name NULL; the unassigned I.i5 is absent', async () => {
    const token = await tokenFor('USER_A_SENIOR');
    const res = await api(
      token,
      'GET',
      'client_dependency_board?select=kind,id,client_id,client_name,label,status,waiting_reason,age_days',
      { headers: H(FDA) },
    );
    expect(res.status).toBe(200);
    const rows = res.body as Array<{
      kind: string;
      id: string;
      client_id: string;
      client_name: string | null;
      label: string;
      status: string;
      waiting_reason: string | null;
      age_days: number;
    }>;
    // Exactly one row: T.t1 (assignee = senior). I.i5 is not the senior's
    // work and never surfaces.
    expect(rows.map((r) => r.id)).toEqual([T.t1]);
    expect(rows[0].kind).toBe('task');
    expect(rows[0].status).toBe('waiting');
    expect(rows[0].waiting_reason).toBe('bank statements');
    expect(rows[0].label).toBe('DLN bank statement chase'); // task title — base column, always present
    expect(rows[0].client_id).toBe(C.c1);
    // LEFT JOIN degradation (interpretation (k)): the decorating clients row
    // is outside the senior's read scope, so the name is NULL — the work
    // row itself stays visible.
    expect(rows[0].client_name).toBeNull();
    expect(rows[0].age_days).toBe(6); // deterministic: updated_at = business_date − 6
  });

  // --- Grant closure: anon has nothing -----------------------------------------

  it('anon (apikey only, no token) is refused 401 on both views — SELECT is authenticated-only', async () => {
    const { API_URL, ANON_KEY } = localEnv();
    for (const view of ['deadline_board', 'client_dependency_board']) {
      const res = await fetch(`${API_URL}/rest/v1/${view}?select=firm_id`, { headers: { apikey: ANON_KEY } });
      expect(res.status, view).toBe(401);
      const body = (await res.json()) as { code?: string };
      expect(body.code, view).toBe('42501');
    }
  });
});
