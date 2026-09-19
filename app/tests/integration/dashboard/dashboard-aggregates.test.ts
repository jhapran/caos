/**
 * IMP-060 — Command Centre & Morning Brief aggregate integration tests
 * (TEST-API-04…08, API-R0-DASH B-count, API-OQ-02/03 2026-09-19 rulings,
 * TEST-API-18 aggregate derivation, TEST-API-20 deadline alignment).
 *
 * Drives the REAL dashboardService.getDashboardAggregates() Supabase adapter
 * composition against the live local stack through authenticated
 * password-grant sessions (getSupabaseClient().auth) + setActiveFirm() —
 * exactly as application code does (the IMP-042 mywork / IMP-051 deadline
 * precedent), cross-checked against raw PostgREST exact-count reads with a
 * signed-in token + the untrusted x-active-firm selector (RLS-CTX-02).
 *
 * NO privileged SQL is a proof mechanism: operator psql is used only for
 * fixture seed/teardown and the TEST-API-06 catalog inventory. Proves:
 *   - TEST-API-04 role scope: partner/super_admin firm-wide; manager the
 *     portfolio slice (RLS-STF-03 — instances portfolio-only, tasks
 *     portfolio OR assignee/reviewer, review portfolio OR linked-task
 *     responsibility, alerts firm-wide per RLS-ALR-01); senior the assigned
 *     slice (tasks/instances assignee-or-reviewer; review own submissions;
 *     alerts exact-instance / client-assigned-work granularity); billing
 *     truthful ZEROS on every counter (no table access — the correct
 *     behavior, never an error, API-ERR-02 collection semantics); the
 *     TEST-API-04 revenue clause is NOT APPLICABLE in R0 (H5 — no approved
 *     billing data source, no live billing/revenue tile exists);
 *   - cross-firm isolation both directions and the forged-selector case: a
 *     caller with no live membership in the selected firm gets all zeros
 *     (the selector is context, never authorization, RLS-CTX-02);
 *   - TEST-API-18 at the aggregate: a persisted snoozed alert past
 *     snoozed_until with acknowledged_at NULL increments activeAlerts; one
 *     WITH acknowledgement history does NOT; a future snooze does NOT —
 *     proven against raw exact counts of the persisted statuses;
 *   - TEST-API-20 alignment: atRiskDeadlines equals the summed at_risk of
 *     deadlinesService.listDeadlineGroups() (the IMP-051 security_invoker
 *     deadline_board truth) for the SAME caller, per role;
 *   - TEST-API-07 (API-OQ-02 IMP-060 ruling): scalar aggregate counts need
 *     no pagination — 55 seeded 'open' tasks (more than a 50-row page)
 *     return the exact count 55 through the head-count path; existing list
 *     contracts keep their approved pagination (owned by their own suites —
 *     deliberately not re-tested here);
 *   - TEST-API-08: the read model is read-only — two consecutive identical
 *     reads are byte-identical (no side effects) and the service exposes no
 *     mutation surface;
 *   - TEST-API-06 evidence-by-absence: IMP-060 adds ZERO database objects —
 *     the public-schema SECURITY DEFINER inventory is exactly the accepted
 *     IMP-≤051 baseline and no function/view named dashboard/aggregate
 *     exists;
 *   - TEST-API-05 evidence-by-construction: every request in this suite is
 *     a password-grant user JWT through the anon-key client (the helpers.mjs
 *     convention); the client env exposes ONLY the publishable anon key;
 *   - anon (apikey only, no token) is refused 401/42501 on every underlying
 *     table and the deadline_board view — SELECT is authenticated-only; with
 *     no active-firm selector the adapter returns the truthful empty
 *     contract without any request (API-ERR-02 collection semantics).
 *
 * Fixture discipline (IMP-051 deadline-readmodel precedent): TWO dedicated
 * suite-owned firms in the 6f630000-… range (never the shared registry
 * FIRM_A/B), deterministic ids, force-reset on every run; fixture
 * audit/outbox noise removed as the operator, scoped to THESE two firm ids
 * only (AUD-INV-01). Non-default task/instance/review/alert states are
 * plain operator INSERTs (the DM-SM-04/05/06 and SCH-18 lifecycle guards
 * bind UPDATE only — the mywork/deadline/alert-suite precedent). Non-resolved
 * alert fixtures carry pair-wise distinct (client_id, compliance_instance_id)
 * subject combinations so the IMP-051 HRR-06=A structural dedupe index
 * (NULLS NOT DISTINCT) is respected with NULL alert_rule_id throughout.
 * Instance due dates are Asia/Kolkata business dates computed SQL-side
 * (seed) and via the shared kolkataBusinessDate() helper (assertions) —
 * the suite stays exact on any run date.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  DASHBOARD_INSTANCE_STATES,
  DASHBOARD_TASK_STATES,
  dashboardService,
  emptyDashboardAggregates,
  type DashboardAggregates,
} from '@/data';
import { clearActiveFirm, setActiveFirm } from '@/data/context';
// NAMING HAZARD: '@/data/deadlines' resolves to the LEGACY flat fixture
// module src/data/deadlines.ts — the live IMP-051 module is addressed
// through its explicit sub-barrel (the src/data/index.ts convention).
import { deadlinesService } from '@/data/deadlines/index';
import { kolkataBusinessDate } from '@/data/mywork';
import { getSupabaseClient } from '@/lib/supabaseClient';

import { api, localEnv, PASSWORD, psql, signIn, userEmail, userId } from '../helpers.mjs';

// This suite owns TWO dedicated firms — never the shared registry FIRM_A/B.
const FDA = '6f630000-0000-4000-8000-000000000001';
const FDB = '6f630000-0000-4000-8000-000000000002';
const ALL_FIRMS = [FDA, FDB];
const H = (firm: string) => ({ 'x-active-firm': firm });

// Seeded system reference type (supabase/seed.sql): 'Income Tax Return',
// entity-scoped — readable without any fixture compliance_types row (the
// deadline-suite precedent).
const SYS_ITR = '50000000-0000-4000-8000-000000000005';

const M = {
  superA: '6f630000-0000-4000-8000-000000000011',
  partnerA: '6f630000-0000-4000-8000-000000000012',
  managerA: '6f630000-0000-4000-8000-000000000013',
  seniorA: '6f630000-0000-4000-8000-000000000014',
  billingA: '6f630000-0000-4000-8000-000000000015',
  partnerB: '6f630000-0000-4000-8000-000000000016', // FDB partner
};
const C = {
  c1: '6f630000-0000-4000-8000-000000000021', // FDA — the manager's portfolio client
  c2: '6f630000-0000-4000-8000-000000000022', // FDA — NOT the manager's client
  cb: '6f630000-0000-4000-8000-000000000023', // FDB
};
const E = {
  e1: '6f630000-0000-4000-8000-000000000031', // C.c1
  e2: '6f630000-0000-4000-8000-000000000032', // C.c2
  eb: '6f630000-0000-4000-8000-000000000033', // C.cb
};
const I = {
  i1: '6f630000-0000-4000-8000-000000000041', // C1/E1 preparation, due TODAY (at-risk), assignee senior
  i2: '6f630000-0000-4000-8000-000000000042', // C1/E1 ready_to_file, due TODAY+3
  i3: '6f630000-0000-4000-8000-000000000043', // C2/E2 not_started, due TODAY+3 (outside the manager portfolio)
  i4: '6f630000-0000-4000-8000-000000000044', // C1/E1 filed, due TODAY (never at-risk)
  i5: '6f630000-0000-4000-8000-000000000045', // C1/E1 information_requested, due TODAY-2 (at-risk)
  i6: '6f630000-0000-4000-8000-000000000046', // C2/E2 preparation, due TODAY-1 (at-risk, non-portfolio)
  i7: '6f630000-0000-4000-8000-000000000047', // C1/E1 closed, due TODAY-30 (terminal, never at-risk)
  i8: '6f630000-0000-4000-8000-000000000048', // C2/E2 internal_review, due TODAY+10, REVIEWER senior
  ib1: '6f630000-0000-4000-8000-000000000049', // FDB preparation, due TODAY (cross-firm isolation)
};
const T = {
  // 55 'open' bulk tasks on C1 (TEST-API-07 volume) carry deterministic ids
  // 6f630000-…-001001…001037 generated SQL-side (see the seed).
  bulkPrefix: '6f630000-0000-4000-8000-0000000010',
  bulkCount: 55,
  t1: '6f630000-0000-4000-8000-000000000051', // C1 in_progress, assignee senior
  t2: '6f630000-0000-4000-8000-000000000052', // C1 submitted, REVIEWER senior
  t3: '6f630000-0000-4000-8000-000000000053', // C2 waiting, assignee MANAGER (non-portfolio, assignee branch)
  t4: '6f630000-0000-4000-8000-000000000054', // C2 returned
  t5: '6f630000-0000-4000-8000-000000000055', // C2 approved
  t6: '6f630000-0000-4000-8000-000000000056', // C2 done
  t7: '6f630000-0000-4000-8000-000000000057', // C2 cancelled
  tb1: '6f630000-0000-4000-8000-000000000058', // FDB open
};
const R = {
  r1: '6f630000-0000-4000-8000-000000000061', // C1 pending, submitted by senior
  r2: '6f630000-0000-4000-8000-000000000062', // C1 pending, submitted by partner
  r3: '6f630000-0000-4000-8000-000000000063', // C2 pending, submitted by partner (non-portfolio)
  r4: '6f630000-0000-4000-8000-000000000064', // C1 APPROVED (never counts as pending)
  rb1: '6f630000-0000-4000-8000-000000000065', // FDB pending
};
const A = {
  a1: '6f630000-0000-4000-8000-000000000071', // active, client C1 (senior has assigned C1 work)
  a2: '6f630000-0000-4000-8000-000000000072', // active, both subject refs NULL (senior-invisible, RLS-ALR-01 CASE C)
  a3: '6f630000-0000-4000-8000-000000000073', // snoozed, EXPIRED until, NO ack stamps, instance I.i1 → reads ACTIVE
  a4: '6f630000-0000-4000-8000-000000000074', // snoozed, EXPIRED until, ack stamps, instance I.i2 → reads ACKNOWLEDGED
  a5: '6f630000-0000-4000-8000-000000000075', // snoozed, FUTURE until, instance I.i3 → reads SNOOZED
  a6: '6f630000-0000-4000-8000-000000000076', // resolved (manual) — never active
  ab1: '6f630000-0000-4000-8000-000000000077', // FDB active
};

// The accepted IMP-≤051 public-schema SECURITY DEFINER inventory (pinned
// against the live catalog at suite authoring; identical to the
// rls-catalog.test.ts baseline). IMP-060 adds NO database objects.
const EXPECTED_DEFINER_FUNCTIONS = [
  'accept_invitation',
  'acknowledge_alert',
  'activate_compliance_rule_version',
  'active_membership_id',
  'active_membership_role',
  'add_task_dependency',
  'alerts_guard_write',
  'approve_client_compliance_profile',
  'audit_trg_row',
  'audit_write',
  'ccp_guard_write',
  'change_membership_role',
  'cin_guard_write',
  'cin_validate_assignments',
  'clients_validate_responsibility',
  'compliance_scope_validate',
  'compliance_types_enforce_governance_inheritance',
  'create_alert_rule',
  'crv_prepare_insert',
  'decide_review_item',
  'drain_event_outbox',
  'engagements_validate_responsibility',
  'evaluate_alerts',
  'evaluate_recurrence',
  'event_publish_trg',
  'generate_profile_instances',
  'generate_successor_instance',
  'invite_member',
  'list_client_identities',
  'list_engagement_letter_statuses',
  'mirror_login_history',
  'publish_domain_event',
  'recurrence_insert_instance',
  'recurrence_lookahead_days',
  'register_scheduler_jobs',
  'remove_membership',
  'remove_task_dependency',
  'requeue_dead_letter',
  'resolve_alert',
  'review_items_guard_write',
  'shares_active_firm_with',
  'snooze_alert',
  'submit_review_item',
  'suspend_membership',
  'task_client_in_assigned_scope',
  'tasks_guard_write',
  'transition_compliance_instance',
  'transition_task',
  'update_alert_rule',
  'write_audit_event',
  'write_audit_event_server',
];

const ZERO_TASKS: Record<string, number> = {
  open: 0,
  in_progress: 0,
  waiting: 0,
  submitted: 0,
  returned: 0,
  approved: 0,
  done: 0,
  cancelled: 0,
};
const ZERO_INSTANCES: Record<string, number> = {
  not_started: 0,
  information_requested: 0,
  information_received: 0,
  preparation: 0,
  internal_review: 0,
  client_approval: 0,
  ready_to_file: 0,
  filed: 0,
  acknowledgement_received: 0,
  closed: 0,
};

/** The full expected aggregate record per caller — every key always pinned
 *  (zero-filled), so an unexpected key drift fails loudly. */
function expected(
  tasks: Partial<Record<string, number>>,
  instances: Partial<Record<string, number>>,
  scalars: { atRiskDeadlines: number; reviewPending: number; activeAlerts: number },
): DashboardAggregates {
  return {
    taskCountsByState: { ...ZERO_TASKS, ...tasks },
    complianceInstanceCountsByState: { ...ZERO_INSTANCES, ...instances },
    ...scalars,
  } as DashboardAggregates;
}

// The pinned per-role truth of the suite fixture (see the seed below).
const EXPECTED_PARTNER_A = expected(
  { open: 55, in_progress: 1, waiting: 1, submitted: 1, returned: 1, approved: 1, done: 1, cancelled: 1 },
  { not_started: 1, information_requested: 1, preparation: 2, internal_review: 1, ready_to_file: 1, filed: 1, closed: 1 },
  { atRiskDeadlines: 3, reviewPending: 3, activeAlerts: 3 },
);
const EXPECTED_MANAGER_A = expected(
  { open: 55, in_progress: 1, submitted: 1, waiting: 1 },
  { preparation: 1, ready_to_file: 1, filed: 1, information_requested: 1, closed: 1 },
  { atRiskDeadlines: 2, reviewPending: 2, activeAlerts: 3 },
);
const EXPECTED_SENIOR_A = expected(
  { in_progress: 1, submitted: 1 },
  { preparation: 1, internal_review: 1 },
  { atRiskDeadlines: 1, reviewPending: 1, activeAlerts: 2 },
);
const EXPECTED_BILLING_A = expected({}, {}, { atRiskDeadlines: 0, reviewPending: 0, activeAlerts: 0 });
const EXPECTED_PARTNER_B = expected(
  { open: 1 },
  { preparation: 1 },
  { atRiskDeadlines: 1, reviewPending: 1, activeAlerts: 1 },
);

async function tokenFor(userKey: string): Promise<string> {
  const s = await signIn(userEmail(userKey));
  if (!s.ok) throw new Error(`sign-in failed for ${userKey}: ${JSON.stringify(s.raw)}`);
  return s.token;
}

/** Raw-path exact count: a signed-in token + the untrusted selector,
 *  PostgREST count=exact; the helper surfaces the content-range header. */
async function exactCount(userKey: string, firm: string, path: string): Promise<number> {
  const token = await tokenFor(userKey);
  const res = await api(token, 'GET', path, { headers: { ...H(firm), Prefer: 'count=exact' } });
  expect(res.status).toBe(200);
  const range = res.contentRange ?? '';
  const total = Number(range.split('/')[1]);
  expect(Number.isInteger(total), `content-range ${range}`).toBe(true);
  return total;
}

/** The adapter proof path: an authenticated session + the selector, then
 *  the REAL dashboardService composition (mywork/deadline precedent). */
async function aggregatesAs(userKey: string, firm: string): Promise<DashboardAggregates> {
  const { error } = await getSupabaseClient().auth.signInWithPassword({ email: userEmail(userKey), password: PASSWORD });
  expect(error).toBeNull();
  setActiveFirm(firm);
  return dashboardService.getDashboardAggregates();
}

function cleanRows() {
  psql(`
    delete from public.audit_log where firm_id in (${ALL_FIRMS.map((f) => `'${f}'`).join(',')});
    delete from public.event_outbox where firm_id in (${ALL_FIRMS.map((f) => `'${f}'`).join(',')});
    delete from public.alerts where firm_id in (${ALL_FIRMS.map((f) => `'${f}'`).join(',')});
    delete from public.review_items where firm_id in (${ALL_FIRMS.map((f) => `'${f}'`).join(',')});
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
      ('${FDA}', 'IMP-060 DASH Firm A'),
      ('${FDB}', 'IMP-060 DASH Firm B')
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
      ('${C.c1}', '${FDA}', 'DASH Client One', '${M.partnerA}', '${M.managerA}', 'active'),
      ('${C.c2}', '${FDA}', 'DASH Client Two', '${M.partnerA}', null,            'active'),
      ('${C.cb}', '${FDB}', 'DASH Client B',   '${M.partnerB}', null,            'active');

    insert into public.legal_entities (id, firm_id, client_id, entity_type, legal_name) values
      ('${E.e1}', '${FDA}', '${C.c1}', 'private_limited', 'DASH Entity One'),
      ('${E.e2}', '${FDA}', '${C.c2}', 'private_limited', 'DASH Entity Two'),
      ('${E.eb}', '${FDB}', '${C.cb}', 'private_limited', 'DASH Entity B');

    -- Instance fixtures are plain operator INSERTs: client_id is
    -- trigger-derived from the legal entity (SCH-A-02), and the state guard
    -- binds UPDATE only (DM-SM-04 transition legality is command-owned) —
    -- the deadline-suite precedent. Due dates are Asia/Kolkata business
    -- dates computed SQL-side so at-risk is exact on any run date.
    insert into public.compliance_instances
      (id, firm_id, legal_entity_id, compliance_type_id, period_start, period_end,
       period_label, due_date, state, assignee_membership_id, reviewer_membership_id)
    values
      ('${I.i1}', '${FDA}', '${E.e1}', '${SYS_ITR}', '2026-04-01', '2027-03-31', 'FY 2026-27',
       (now() at time zone 'Asia/Kolkata')::date, 'preparation', '${M.seniorA}', null),
      ('${I.i2}', '${FDA}', '${E.e1}', '${SYS_ITR}', '2027-04-01', '2028-03-31', 'FY 2027-28',
       ((now() at time zone 'Asia/Kolkata')::date + 3), 'ready_to_file', null, null),
      ('${I.i3}', '${FDA}', '${E.e2}', '${SYS_ITR}', '2026-04-01', '2027-03-31', 'FY 2026-27',
       ((now() at time zone 'Asia/Kolkata')::date + 3), 'not_started', null, null),
      ('${I.i4}', '${FDA}', '${E.e1}', '${SYS_ITR}', '2025-04-01', '2026-03-31', 'FY 2025-26',
       (now() at time zone 'Asia/Kolkata')::date, 'filed', null, null),
      ('${I.i5}', '${FDA}', '${E.e1}', '${SYS_ITR}', '2024-04-01', '2025-03-31', 'FY 2024-25',
       ((now() at time zone 'Asia/Kolkata')::date - 2), 'information_requested', null, null),
      ('${I.i6}', '${FDA}', '${E.e2}', '${SYS_ITR}', '2025-04-01', '2026-03-31', 'FY 2025-26',
       ((now() at time zone 'Asia/Kolkata')::date - 1), 'preparation', null, null),
      ('${I.i7}', '${FDA}', '${E.e1}', '${SYS_ITR}', '2023-04-01', '2024-03-31', 'FY 2023-24',
       ((now() at time zone 'Asia/Kolkata')::date - 30), 'closed', null, null),
      ('${I.i8}', '${FDA}', '${E.e2}', '${SYS_ITR}', '2024-04-01', '2025-03-31', 'FY 2024-25',
       ((now() at time zone 'Asia/Kolkata')::date + 10), 'internal_review', null, '${M.seniorA}'),
      ('${I.ib1}', '${FDB}', '${E.eb}', '${SYS_ITR}', '2026-04-01', '2027-03-31', 'FY 2026-27',
       (now() at time zone 'Asia/Kolkata')::date, 'preparation', null, null);

    -- TEST-API-07 volume fixture: 55 'open' tasks on the portfolio client —
    -- more than a 50-row page, proving the exact-count head path.
    insert into public.tasks (id, firm_id, client_id, title, next_action, status)
    select ('${T.bulkPrefix}' || lpad(to_hex(g), 2, '0'))::uuid,
           '${FDA}', '${C.c1}', 'DASH bulk open task ' || g, 'bulk action', 'open'
      from generate_series(1, ${T.bulkCount}) g;

    -- The remaining task fixtures are plain operator INSERTs (status is
    -- unguarded on INSERT — DM-SM-05 transition legality and the
    -- waiting-reason invariant are command-owned; the mywork precedent).
    insert into public.tasks
      (id, firm_id, client_id, title, next_action, status, waiting_reason,
       assignee_membership_id, reviewer_membership_id)
    values
      ('${T.t1}', '${FDA}', '${C.c1}', 'DASH senior in progress', 'complete the checklist', 'in_progress', null,
       '${M.seniorA}', null),
      ('${T.t2}', '${FDA}', '${C.c1}', 'DASH senior reviewed',    'review the draft',       'submitted',   null,
       null, '${M.seniorA}'),
      ('${T.t3}', '${FDA}', '${C.c2}', 'DASH manager waiting',    'chase client documents', 'waiting',     'client documents pending',
       '${M.managerA}', null),
      ('${T.t4}', '${FDA}', '${C.c2}', 'DASH returned',           'redo the reconciliation','returned',    null, null, null),
      ('${T.t5}', '${FDA}', '${C.c2}', 'DASH approved',           'archive the workpaper',  'approved',    null, null, null),
      ('${T.t6}', '${FDA}', '${C.c2}', 'DASH done',               'close the file',         'done',        null, null, null),
      ('${T.t7}', '${FDA}', '${C.c2}', 'DASH cancelled',          'discard the draft',      'cancelled',   null, null, null),
      ('${T.tb1}', '${FDB}', '${C.cb}', 'DASH firm B open',       'mirror prep',            'open',        null, null, null);

    -- Review fixtures are plain operator INSERTs (browser grants are
    -- SELECT-only; the DM-SM-06 decision CHECK requires decider + timestamp
    -- + non-empty rationale, decider ≠ submitter).
    insert into public.review_items
      (id, firm_id, client_id, type, title, status,
       submitted_by_membership_id, decided_by_membership_id, decided_at, decision_rationale)
    values
      ('${R.r1}', '${FDA}', '${C.c1}', 'gst_reconciliation', 'DASH pending senior',  'pending',  '${M.seniorA}',  null, null, null),
      ('${R.r2}', '${FDA}', '${C.c1}', 'tds_return',         'DASH pending partner', 'pending',  '${M.partnerA}', null, null, null),
      ('${R.r3}', '${FDA}', '${C.c2}', 'itr_computation',    'DASH pending other',   'pending',  '${M.partnerA}', null, null, null),
      ('${R.r4}', '${FDA}', '${C.c1}', 'financial_statements', 'DASH decided',       'approved',
       '${M.seniorA}', '${M.partnerA}', '2026-09-05T10:00:00+00:00', 'Reviewed and approved'),
      ('${R.rb1}', '${FDB}', '${C.cb}', 'gst_reconciliation', 'DASH firm B pending', 'pending',  '${M.partnerB}', null, null, null);

    -- Alert fixtures are plain operator INSERTs (the write guard restricts
    -- UPDATE only; alerts carry NO browser insert path at all); staged rows
    -- carry SCH-18 lifecycle-CHECK-consistent stamp sets. Snooze timestamps
    -- are computed SQL-side relative to now() so the TEST-API-18 expired /
    -- future shapes hold on any run date. Subject combinations are pair-wise
    -- distinct among the non-resolved rows (HRR-06=A dedupe index).
    insert into public.alerts
      (id, firm_id, severity, title, client_id, compliance_instance_id, status,
       acknowledged_by, acknowledged_at, snoozed_until, resolved_by, resolved_at, resolution_type)
    values
      ('${A.a1}', '${FDA}', 'warning',  'DASH active client',   '${C.c1}', null,    'active',
       null, null, null, null, null, null),
      ('${A.a2}', '${FDA}', 'info',     'DASH active unscoped', null,      null,    'active',
       null, null, null, null, null, null),
      ('${A.a3}', '${FDA}', 'warning',  'DASH expired snooze',  null,      '${I.i1}', 'snoozed',
       null, null, now() - interval '1 day', null, null, null),
      ('${A.a4}', '${FDA}', 'critical', 'DASH expired ack snooze', null,   '${I.i2}', 'snoozed',
       '${userId('USER_A_MANAGER')}', now() - interval '2 days', now() - interval '1 day', null, null, null),
      ('${A.a5}', '${FDA}', 'info',     'DASH future snooze',   null,      '${I.i3}', 'snoozed',
       null, null, now() + interval '30 days', null, null, null),
      ('${A.a6}', '${FDA}', 'warning',  'DASH resolved',        '${C.c1}', null,    'resolved',
       null, null, null, '${userId('USER_A_PARTNER')}', now() - interval '3 days', 'manual'),
      ('${A.ab1}', '${FDB}', 'warning', 'DASH firm B active',   '${C.cb}', null,    'active',
       null, null, null, null, null, null);
  `);
  // Fixture writes are operator/system-actor rows; remove fixture noise so
  // the table stays clean for other suites (IMP-031/040/041/042/051 precedent).
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

// ---------------------------------------------------------------------------
// TEST-API-04 — caller-scoped aggregates per role (API-R0-DASH, API-SEC-01/04)
// ---------------------------------------------------------------------------

describe('TEST-API-04 — dashboard aggregates are caller-scoped per role', () => {
  it('serves the shared contract in supabase mode (API-ARCH-02)', () => {
    expect(dashboardService.mode).toBe('supabase');
  });

  it('the aggregate record ALWAYS carries every approved key (zero-filled; no undefined counters)', async () => {
    const agg = await aggregatesAs('USER_A_PARTNER', FDA);
    expect(Object.keys(agg.taskCountsByState).sort()).toEqual([...DASHBOARD_TASK_STATES].sort());
    expect(Object.keys(agg.complianceInstanceCountsByState).sort()).toEqual([...DASHBOARD_INSTANCE_STATES].sort());
    expect(Object.keys(agg).sort()).toEqual(
      ['activeAlerts', 'atRiskDeadlines', 'complianceInstanceCountsByState', 'reviewPending', 'taskCountsByState'].sort(),
    );
  });

  it('partner reads the firm-wide totals (the pinned fixture truth)', async () => {
    expect(await aggregatesAs('USER_A_PARTNER', FDA)).toEqual(EXPECTED_PARTNER_A);
  });

  it('super_admin reads the identical firm-wide totals', async () => {
    expect(await aggregatesAs('USER_A_SUPER_ADMIN', FDA)).toEqual(EXPECTED_PARTNER_A);
  });

  it('manager reads the portfolio slice (RLS-STF-03): portfolio instances only; tasks portfolio OR direct responsibility; review portfolio; alerts firm-wide', async () => {
    expect(await aggregatesAs('USER_A_MANAGER', FDA)).toEqual(EXPECTED_MANAGER_A);
  });

  it('senior reads the assigned slice: assignee/reviewer tasks+instances, own review submissions, exact-instance/client-work alerts', async () => {
    expect(await aggregatesAs('USER_A_SENIOR', FDA)).toEqual(EXPECTED_SENIOR_A);
  });

  it('billing reads truthful ZEROS on every counter — no table access, never an error, never fabricated (API-ERR-02)', async () => {
    expect(await aggregatesAs('USER_A_BILLING', FDA)).toEqual(EXPECTED_BILLING_A);
  });

  it('cross-firm isolation: the FDB partner sees only FDB truth through their own selector', async () => {
    expect(await aggregatesAs('USER_B_PARTNER', FDB)).toEqual(EXPECTED_PARTNER_B);
  });

  it('the selector grants nothing (RLS-CTX-02): FDA data never crosses to the FDB partner, and a FORGED selector yields zeros both directions', async () => {
    // FDB partner selecting FDA — no live membership there: all zeros.
    expect(await aggregatesAs('USER_B_PARTNER', FDA)).toEqual(EXPECTED_BILLING_A);
    // FDA partner selecting FDB — the mirror image: FDB data never crosses.
    expect(await aggregatesAs('USER_A_PARTNER', FDB)).toEqual(EXPECTED_BILLING_A);
  });

  it('no active-firm selector → the truthful empty contract without any request (never an error)', async () => {
    const { error } = await getSupabaseClient().auth.signInWithPassword({
      email: userEmail('USER_A_PARTNER'),
      password: PASSWORD,
    });
    expect(error).toBeNull();
    clearActiveFirm();
    expect(await dashboardService.getDashboardAggregates()).toEqual(emptyDashboardAggregates());
    setActiveFirm(FDA); // restore for later tests in this file
  });
});

// ---------------------------------------------------------------------------
// TEST-API-18 — the aggregate applies the snooze-expiry read derivation
// (SCH-18; IMP-042/IMP-051 semantics unchanged; NO expiry writes)
// ---------------------------------------------------------------------------

describe('TEST-API-18 — active-alert aggregate derivation (expired snooze resurfacing)', () => {
  it('activeAlerts = persisted-active exact count + expired UNACKNOWLEDGED snoozes only — proven against raw persisted-status counts', async () => {
    // Raw truth under the partner's RLS: exactly 2 persisted 'active' and 3
    // persisted 'snoozed' rows in FDA (A.a3 expired/unack, A.a4 expired/acked,
    // A.a5 future).
    expect(await exactCount('USER_A_PARTNER', FDA, 'alerts?select=id&status=eq.active')).toBe(2);
    expect(await exactCount('USER_A_PARTNER', FDA, 'alerts?select=id&status=eq.snoozed')).toBe(3);

    const agg = await aggregatesAs('USER_A_PARTNER', FDA);
    // 2 persisted + exactly ONE derivation increment: A.a3 (expired, no ack
    // history) reads active. A.a4 (expired WITH acknowledgement history)
    // reads acknowledged and A.a5 (future until) stays snoozed — neither
    // increments the counter.
    expect(agg.activeAlerts).toBe(3);
  });

  it('the derivation is RLS-scoped: the senior sees only their visible alerts — the expired unacknowledged snooze on THEIR instance counts, the others never leak', async () => {
    // Senior-visible: A.a1 (client C1 — assigned-work scope) persisted
    // active; A.a3 (instance I.i1 assignee) expired-unack snooze. A.a2 is
    // both-NULL (CASE C invisible); A.a4/A.a5 sit on instances outside the
    // senior's assignments.
    expect(await exactCount('USER_A_SENIOR', FDA, 'alerts?select=id&status=eq.active')).toBe(1);
    expect(await exactCount('USER_A_SENIOR', FDA, 'alerts?select=id&status=eq.snoozed')).toBe(1);
    const agg = await aggregatesAs('USER_A_SENIOR', FDA);
    expect(agg.activeAlerts).toBe(2); // 1 persisted + 1 derivation
  });

  it('NO expiry writes: repeated aggregate reads leave the persisted snooze rows byte-identical', async () => {
    const before = psql(
      `select coalesce(string_agg(md5(row_to_json(a)::text), ',' order by a.id), '')
         from public.alerts a where a.firm_id = '${FDA}';`,
    ).trim();
    await aggregatesAs('USER_A_PARTNER', FDA);
    await aggregatesAs('USER_A_MANAGER', FDA);
    const after = psql(
      `select coalesce(string_agg(md5(row_to_json(a)::text), ',' order by a.id), '')
         from public.alerts a where a.firm_id = '${FDA}';`,
    ).trim();
    expect(after).toBe(before);
    // … and no audit row exists for the fixture alerts (no hidden
    // normalization write, AUD-INV-01: scoped to THIS suite's firm only).
    expect(
      psql(`select count(*) from public.audit_log
            where object_type = 'alert' and firm_id = '${FDA}';`).trim(),
    ).toBe('0');
  });
});

// ---------------------------------------------------------------------------
// TEST-API-20 — atRiskDeadlines is the IMP-051 deadline_board truth
// ---------------------------------------------------------------------------

describe('TEST-API-20 — atRiskDeadlines aligns with the deadline read model for the same caller', () => {
  it.each([
    ['USER_A_PARTNER', 3],
    ['USER_A_MANAGER', 2],
    ['USER_A_SENIOR', 1],
    ['USER_A_BILLING', 0],
  ] as Array<[string, number]>)('%s: the aggregate equals summed at_risk from deadlinesService.listDeadlineGroups()', async (userKey, expectedRisk) => {
    const { error } = await getSupabaseClient().auth.signInWithPassword({ email: userEmail(userKey), password: PASSWORD });
    expect(error).toBeNull();
    setActiveFirm(FDA);
    const groups = await deadlinesService.listDeadlineGroups();
    const boardTruth = groups.reduce((sum, g) => sum + g.atRisk, 0);
    expect(boardTruth).toBe(expectedRisk);
    const agg = await dashboardService.getDashboardAggregates();
    expect(agg.atRiskDeadlines).toBe(boardTruth);
  });

  it('the operative due_date drives at-risk (Asia/Kolkata business date): the seeded distribution is exact', async () => {
    // FDA at-risk rows: I.i1 (preparation, due today), I.i5
    // (information_requested, due −2), I.i6 (preparation, due −1). I.i4
    // (filed, due today) and I.i7 (closed, overdue) are post-filing and
    // never at-risk; I.i2/I.i3/I.i8 are due in the future.
    expect(kolkataBusinessDate()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const agg = await aggregatesAs('USER_A_PARTNER', FDA);
    expect(agg.atRiskDeadlines).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// TEST-API-07 — scalar aggregates need no pagination (API-OQ-02 IMP-060
// ruling): exact counts regardless of row volume
// ---------------------------------------------------------------------------

describe('TEST-API-07 — exact counts beyond a page of rows', () => {
  it('55 seeded open tasks (more than the API-CONV-02 default page of 50) return the EXACT count through the head-count path', async () => {
    // Raw-path proof first: PostgREST exact count over the caller's RLS.
    expect(await exactCount('USER_A_PARTNER', FDA, `tasks?select=id&status=eq.open`)).toBe(T.bulkCount);
    // Adapter-path proof: the same exact count, no pagination applied.
    const agg = await aggregatesAs('USER_A_PARTNER', FDA);
    expect(agg.taskCountsByState.open).toBe(T.bulkCount);
    // … and the portfolio manager gets the identical exact count (all 55
    // bulk tasks sit on the manager's portfolio client).
    const mgr = await aggregatesAs('USER_A_MANAGER', FDA);
    expect(mgr.taskCountsByState.open).toBe(T.bulkCount);
    // Existing list contracts keep their already-approved pagination —
    // owned by their own suites (IMP-020/040/041/042); deliberately not
    // re-tested here (API-OQ-02 IMP-060 ruling: scalar counts only).
  });
});

// ---------------------------------------------------------------------------
// TEST-API-08 — the read model is read-only (determinism, no mutation
// surface, no side effects)
// ---------------------------------------------------------------------------

describe('TEST-API-08 — read-only read model', () => {
  it('two consecutive identical reads return byte-identical results (no side effects)', async () => {
    const { error } = await getSupabaseClient().auth.signInWithPassword({
      email: userEmail('USER_A_PARTNER'),
      password: PASSWORD,
    });
    expect(error).toBeNull();
    setActiveFirm(FDA);
    const first = await dashboardService.getDashboardAggregates();
    const second = await dashboardService.getDashboardAggregates();
    expect(second).toEqual(first);
    expect(first).toEqual(EXPECTED_PARTNER_A);
  });

  it('the service exposes NO mutation surface (read-only contract)', () => {
    const fns = Object.entries(dashboardService).filter(([, v]) => typeof v === 'function').map(([k]) => k);
    expect(fns).toEqual(['getDashboardAggregates']);
  });
});

// ---------------------------------------------------------------------------
// TEST-API-06 — evidence-by-absence: IMP-060 adds ZERO database objects (no
// SECURITY DEFINER, no view, no RPC — B-count over existing RLS reads)
// ---------------------------------------------------------------------------

describe('TEST-API-06 — no new SECURITY DEFINER / database objects', () => {
  it('the public-schema SECURITY DEFINER inventory is exactly the accepted IMP-≤051 baseline', () => {
    const definer = psql(
      `select string_agg(proname, ',' order by proname) from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.prosecdef;`,
    ).trim();
    expect(definer.split(',')).toEqual(EXPECTED_DEFINER_FUNCTIONS);
  });

  it('no function or view references dashboard/aggregate — the read model is a client-side composition over existing RLS reads', () => {
    const offenders = psql(
      `select coalesce(string_agg(kind || ':' || name, ',' order by name), '')
         from (
           select 'function' as kind, p.proname as name from pg_proc p
             join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and (p.proname ilike '%dashboard%' or p.proname ilike '%aggregate%')
           union all
           select 'view', viewname from pg_views
            where schemaname = 'public' and (viewname ilike '%dashboard%' or viewname ilike '%aggregate%')
         ) o;`,
    ).trim();
    expect(offenders).toBe('');
    // The public view inventory is exactly the two IMP-051 security_invoker
    // read-model views — IMP-060 added none.
    const views = psql(
      `select string_agg(viewname, ',' order by viewname) from pg_views where schemaname = 'public';`,
    ).trim();
    expect(views.split(',')).toEqual(['client_dependency_board', 'deadline_board']);
  });
});

// ---------------------------------------------------------------------------
// TEST-API-05 — no browser service-role path (evidence-by-construction, the
// helpers.mjs convention): every suite request is a password-grant user JWT
// through the anon-key client; the client env exposes only the publishable key
// ---------------------------------------------------------------------------

describe('TEST-API-05 — no service-role in the browser path', () => {
  it('the pinned client env exposes ONLY the anon/publishable key — never the service-role key', () => {
    const { ANON_KEY, SERVICE_ROLE_KEY } = localEnv();
    // The integration env (tests/integration/setup-env.ts) pins exactly the
    // local anon key as the client-safe configuration.
    expect(import.meta.env.VITE_SUPABASE_ANON_KEY).toBe(ANON_KEY);
    expect(import.meta.env.VITE_SUPABASE_ANON_KEY).not.toBe(SERVICE_ROLE_KEY);
    expect(Object.keys(import.meta.env).some((k) => k.includes('SERVICE_ROLE'))).toBe(false);
    // Every request above went through signIn()/api() (password grant +
    // anon apikey) or the SDK client constructed from that same env.
  });
});

// ---------------------------------------------------------------------------
// Grant closure — anon (apikey only, no token) has nothing
// ---------------------------------------------------------------------------

describe('grant closure — anon is refused on every aggregate source', () => {
  it('anon (apikey only, no token) is refused 401/42501 on all four tables and the deadline view', async () => {
    const { API_URL, ANON_KEY } = localEnv();
    const sources: Array<[string, string]> = [
      ['tasks', 'id'],
      ['compliance_instances', 'id'],
      ['review_items', 'id'],
      ['alerts', 'id'],
      ['deadline_board', 'firm_id'], // the view's columns (no id) — the deadline-suite precedent
    ];
    for (const [source, column] of sources) {
      const res = await fetch(`${API_URL}/rest/v1/${source}?select=${column}`, { headers: { apikey: ANON_KEY } });
      expect(res.status, source).toBe(401);
      const body = (await res.json()) as { code?: string };
      expect(body.code, source).toBe('42501');
    }
  });
});
