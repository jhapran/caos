/**
 * IMP-050 — recurrence generation contract against the REAL local stack
 * (AUTO-REC-01…10, AUTO-IDM-01, AUTO-AUD-01/02, AUTO-REC-08).
 *
 * Maps to spec 11 (IMP-050 contract closure 2026-09-12):
 *   TEST-AUTO-01 — evaluate_recurrence double-run idempotency: instance,
 *     publication and audit counts are unchanged by the second run;
 *   TEST-AUTO-02 — trigger points (a)/(b): the approval RPC materializes
 *     the current period immediately; reaching 'closed' via the transition
 *     RPC materializes + links the successor (copying assignee/reviewer/
 *     partner), creates it when absent and links the EXISTING look-ahead
 *     row when present (never a duplicate); proposed/suspended profiles
 *     generate nothing (DM-11);
 *   TEST-AUTO-03 — scope cardinality: a registration-scoped type with two
 *     registrations yields one instance per registration per period; an
 *     entity-scoped type yields one per entity per period;
 *   AUTO-REC-02 (SCH-01) — look-ahead configuration: the
 *     firm's recurrence_lookahead_days is honored (30 => fewer periods);
 *     invalid values (0, -3, "abc", 1.5) fail the run observably (SCH-34
 *     'failed' + per-firm error, zero new instances) — and the re-run
 *     after the config is fixed succeeds idempotently (TEST-OPS-07
 *     recurrence half);
 *   AUTO-REC-02 (independent-review correction M-1) — an ACTIVE applicable
 *     rule version whose due_rule is not machine-readable fails
 *     evaluate_recurrence observably (SCH-34 'failed' + firm-attributed
 *     error; other firms still run), generates NOTHING for that profile
 *     (no invented due date, no publication/audit side effect), and fails
 *     the activation RPC as an ATOMIC conflict — never a silent fallback;
 *   TEST-AUTO-12 immediate paths (independent-review correction L-3) —
 *     approval/closure-triggered materialization propagates the
 *     originating x-correlation-id request correlation (AUD-CTX-02) into
 *     its SCH-33 publications and generation audit rows; without a valid
 *     originating correlation exactly ONE server-side identity is minted
 *     for the immediate chain (AUTO-ENV-01, AUD-INV-06, AUTO-AUD-02);
 *   AUTO-REC-10  — business-date basis: generated periods/due dates are
 *     Asia/Kolkata business dates (expected values are computed SQL-side,
 *     never via JS date math);
 *   TEST-AUTO-09 — historical stability: rule succession (v2 with a
 *     DIFFERENT due_rule effective next period) leaves pre-existing
 *     instances pinned (rule_version_id/calculated_due_date/generated_at/
 *     period unchanged) while new periods use v2. Statutory-activation
 *     gate (DM-OQ-01): NOT re-asserted here — the RPC path requires an
 *     AAL2 ceremony and is covered by compliance-rules-rls.test.ts
 *     (TEST-SCH-07); IMP-050 changes nothing on that path.
 *   TEST-AUTO-10 — concurrency: two concurrent evaluate_recurrence runs
 *     produce exactly one instance per period and exactly one publication
 *     per instance (AUTO-REC-03 layer 4 / AUTO-REC-08 winner-only).
 *
 * Operator psql is used for fixture staging (active profiles are direct
 * INSERTs — the SCH-11 guard gates only UPDATE activation) and for
 * assertions; the approval/transition Layer-B commands are exercised
 * through PostgREST as a signed-in registry user (USER_A_SUPER_ADMIN).
 * Business-date expectations are computed SQL-side. Assertions are always
 * scoped by firm/profile/correlation — never global counts (the per-minute
 * outbox.drain cron and the daily sched.recurrence.evaluate cron run during
 * the suite).
 *
 * Deterministic ids in the 6f500000-… range; this suite owns four firms
 * (FA/FB/FC/FD — never the shared harness FIRM_A/FIRM_B); re-runnable;
 * teardown removes rows child → parent (successor links are unlinked
 * first — the composite self-FK is ON DELETE RESTRICT), the suite's
 * event_outbox/scheduler_dead_letters rows, the audit rows, and the
 * scheduler_job_runs rows created during the suite window.
 */
import { spawn } from 'node:child_process';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { api, psql, signIn, userEmail, userId } from '../helpers.mjs';

const FA = '6f500000-0000-4000-8000-000000000001';
const FB = '6f500000-0000-4000-8000-000000000002';
const FC = '6f500000-0000-4000-8000-000000000003'; // TEST-AUTO-09 isolated firm
const FD = '6f500000-0000-4000-8000-000000000004'; // AUTO-REC-02 look-ahead isolated firm
const ALL_FIRMS = [FA, FB, FC, FD];
const H = (firm: string) => ({ 'x-active-firm': firm });

const M = {
  superA: '6f500000-0000-4000-8000-000000000101',
  partnerA: '6f500000-0000-4000-8000-000000000102',
  managerA: '6f500000-0000-4000-8000-000000000103',
  seniorA: '6f500000-0000-4000-8000-000000000104',
  partnerB: '6f500000-0000-4000-8000-000000000105', // FB client owner (DM-04)
  partnerC: '6f500000-0000-4000-8000-000000000106', // FC client owner
  partnerD: '6f500000-0000-4000-8000-000000000107', // FD client owner
};
const C = {
  a: '6f500000-0000-4000-8000-000000000201',
  b: '6f500000-0000-4000-8000-000000000202',
  c: '6f500000-0000-4000-8000-000000000203',
  d: '6f500000-0000-4000-8000-000000000204',
};
const E = {
  idem: '6f500000-0000-4000-8000-000000000301', // AUTO-01
  prop: '6f500000-0000-4000-8000-000000000302', // AUTO-02 close-creates-successor
  prop2: '6f500000-0000-4000-8000-000000000303', // AUTO-02 close-links-lookahead
  inert: '6f500000-0000-4000-8000-000000000304', // AUTO-02 proposed/suspended
  ent: '6f500000-0000-4000-8000-000000000305', // AUTO-03 entity scope
  reg: '6f500000-0000-4000-8000-000000000306', // AUTO-03 registration scope
  race: '6f500000-0000-4000-8000-000000000307', // AUTO-10
  b1: '6f500000-0000-4000-8000-000000000308',
  hist: '6f500000-0000-4000-8000-000000000309', // AUTO-09 (FC)
  la: '6f500000-0000-4000-8000-00000000030a', // AUTO-04 (FD)
  proof: '6f500000-0000-4000-8000-00000000030b', // M-1 cross-firm continuation proof
  corrA: '6f500000-0000-4000-8000-00000000030c', // L-3 activation propagation
  corrB: '6f500000-0000-4000-8000-00000000030d', // L-3 closure propagation
  corrM: '6f500000-0000-4000-8000-00000000030e', // L-3 minted-identity path
  corrX: '6f500000-0000-4000-8000-00000000030f', // L-3 malformed-header path
};
const R = {
  gst1: '6f500000-0000-4000-8000-000000000401',
  gst2: '6f500000-0000-4000-8000-000000000402',
  gstInert: '6f500000-0000-4000-8000-000000000403', // E.inert GSTIN (P.susp binding)
};
const T = {
  monthly: '6f500000-0000-4000-8000-000000000c01', // FA monthly, entity scope
  reg: '6f500000-0000-4000-8000-000000000c02', // FA monthly, registration/GSTIN
  b: '6f500000-0000-4000-8000-000000000c03', // FB monthly, entity scope
  hist: '6f500000-0000-4000-8000-000000000c04', // FC monthly, entity scope
  la: '6f500000-0000-4000-8000-000000000c05', // FD monthly, entity scope
  bad: '6f500000-0000-4000-8000-000000000c06', // FD monthly, M-1 unparseable ACTIVE rule
};
const V = {
  monthly1: '6f500000-0000-4000-8000-000000000d01', // active, due = period_end + 10
  reg1: '6f500000-0000-4000-8000-000000000d02', // active, due = 11th of next month
  b1: '6f500000-0000-4000-8000-000000000d03', // active, due = period_end + 15
  hist1: '6f500000-0000-4000-8000-000000000d04', // active, due = period_end + 10
  hist2: '6f500000-0000-4000-8000-000000000d05', // DRAFT (activated in TEST-AUTO-09), due = period_end + 5
  la1: '6f500000-0000-4000-8000-000000000d06', // active, due = period_end + 10
  bad: '6f500000-0000-4000-8000-000000000d07', // active, due_rule NOT machine-readable (M-1)
};
const P = {
  idem: '6f500000-0000-4000-8000-000000000e01', // active — AUTO-01
  prop: '6f500000-0000-4000-8000-000000000e02', // proposed — AUTO-02 approval target
  prop2: '6f500000-0000-4000-8000-000000000e03', // proposed — AUTO-02 look-ahead link target
  proposedInert: '6f500000-0000-4000-8000-000000000e04', // never approved
  susp: '6f500000-0000-4000-8000-000000000e05', // staged suspended
  regGst1: '6f500000-0000-4000-8000-000000000e06', // active — AUTO-03
  regGst2: '6f500000-0000-4000-8000-000000000e07', // active — AUTO-03
  ent: '6f500000-0000-4000-8000-000000000e08', // active — AUTO-03
  race: '6f500000-0000-4000-8000-000000000e09', // staged inside TEST-AUTO-10
  b: '6f500000-0000-4000-8000-000000000e0a', // active (FB)
  hist: '6f500000-0000-4000-8000-000000000e0b', // staged inside TEST-AUTO-09 (FC)
  la: '6f500000-0000-4000-8000-000000000e0c', // staged inside the AUTO-REC-02 look-ahead block (FD)
  bad: '6f500000-0000-4000-8000-000000000e0d', // staged inside M-1 (FD, active, broken rule)
  badProp: '6f500000-0000-4000-8000-000000000e0e', // staged inside M-1 (FD, proposed)
  proof: '6f500000-0000-4000-8000-000000000e0f', // staged inside M-1 (FA, continuation)
  corrA: '6f500000-0000-4000-8000-000000000e10', // staged inside L-3 activation test
  corrB: '6f500000-0000-4000-8000-000000000e11', // staged inside L-3 closure test
  corrM: '6f500000-0000-4000-8000-000000000e12', // staged inside L-3 minted-identity test
  corrX: '6f500000-0000-4000-8000-000000000e13', // staged inside L-3 malformed-header test
};

// Fixed correlation ids for the L-3 immediate-path propagation assertions.
const CORR_A = '6f500000-0000-4000-8000-00000000c0a1';
const CORR_B = '6f500000-0000-4000-8000-00000000c0b1';

const SUPER_ADMIN_A = userId('USER_A_SUPER_ADMIN');
const PARTNER_A = userId('USER_A_PARTNER');
const MANAGER_A = userId('USER_A_MANAGER');
const SENIOR_A = userId('USER_A_SENIOR');
const PARTNER_B = userId('USER_B_PARTNER');

let superAdminA: string;
let suiteStart: string;

/** Expected monthly period count: month starts in [current month,
 *  business_date + N days] inclusive — the generator's candidate window. */
function expectedMonths(lookaheadDays: number): number {
  return Number(
    psql(`select count(*) from generate_series(
            date_trunc('month', (now() at time zone 'Asia/Kolkata')::date)::date,
            ((now() at time zone 'Asia/Kolkata')::date + ${lookaheadDays})::date,
            interval '1 month') s;`).trim(),
  );
}

function instanceCount(profileId: string): number {
  return Number(
    psql(`select count(*) from public.compliance_instances
          where client_compliance_profile_id = '${profileId}';`).trim(),
  );
}

function evaluate() {
  psql(`select public.evaluate_recurrence();`);
}

/** Latest sched.recurrence.evaluate job-run row (SCH-34). */
function lastRecurrenceRun(): { status: string; error: string | null; rows_affected: number | null; correlation_id: string } {
  const out = psql(`select row_to_json(r) from (
      select status, error, rows_affected, correlation_id
      from public.scheduler_job_runs
      where job_name = 'sched.recurrence.evaluate'
      order by started_at desc limit 1) r;`);
  return JSON.parse(out);
}

function cleanRows() {
  psql(`
    -- The composite successor self-FK is ON DELETE RESTRICT: unlink first.
    update public.compliance_instances set successor_instance_id = null
      where firm_id in (${ALL_FIRMS.map((f) => `'${f}'`).join(',')});
    delete from public.audit_log where firm_id in (${ALL_FIRMS.map((f) => `'${f}'`).join(',')});
    delete from public.event_outbox where firm_id in (${ALL_FIRMS.map((f) => `'${f}'`).join(',')});
    -- SCH-35 is append-only by trigger; harness teardown runs with the
    -- replication role so the synthetic rows can be removed (zero residue).
    begin;
    set local session_replication_role = 'replica';
    delete from public.scheduler_dead_letters where firm_id in (${ALL_FIRMS.map((f) => `'${f}'`).join(',')});
    commit;
    delete from public.scheduler_job_runs;
    delete from public.compliance_instances where firm_id in (${ALL_FIRMS.map((f) => `'${f}'`).join(',')});
    delete from public.client_compliance_profiles where firm_id in (${ALL_FIRMS.map((f) => `'${f}'`).join(',')});
    delete from public.compliance_rule_versions
      where compliance_type_id in ('${T.monthly}', '${T.reg}', '${T.b}', '${T.hist}', '${T.la}');
    delete from public.compliance_types
      where id in ('${T.monthly}', '${T.reg}', '${T.b}', '${T.hist}', '${T.la}');
    delete from public.registrations where firm_id in (${ALL_FIRMS.map((f) => `'${f}'`).join(',')});
    delete from public.legal_entities where firm_id in (${ALL_FIRMS.map((f) => `'${f}'`).join(',')});
    delete from public.clients where firm_id in (${ALL_FIRMS.map((f) => `'${f}'`).join(',')});
    delete from public.firm_memberships where firm_id in (${ALL_FIRMS.map((f) => `'${f}'`).join(',')});
  `);
}

function seedFixture() {
  cleanRows();
  psql(`
    insert into public.firms (id, name) values
      ('${FA}', 'IMP-050 AUTO Firm A'),
      ('${FB}', 'IMP-050 AUTO Firm B'),
      ('${FC}', 'IMP-050 AUTO Firm C'),
      ('${FD}', 'IMP-050 AUTO Firm D')
    on conflict (id) do nothing;

    insert into public.firm_memberships (id, firm_id, user_id, role, status) values
      ('${M.superA}',   '${FA}', '${SUPER_ADMIN_A}', 'super_admin', 'active'),
      ('${M.partnerA}', '${FA}', '${PARTNER_A}',     'partner',     'active'),
      ('${M.managerA}', '${FA}', '${MANAGER_A}',     'manager',     'active'),
      ('${M.seniorA}',  '${FA}', '${SENIOR_A}',      'senior',      'active'),
      ('${M.partnerB}', '${FB}', '${PARTNER_B}',     'partner',     'active'),
      ('${M.partnerC}', '${FC}', '${PARTNER_B}',     'partner',     'active'),
      ('${M.partnerD}', '${FD}', '${PARTNER_B}',     'partner',     'active')
    on conflict (firm_id, user_id) do nothing;

    insert into public.clients (id, firm_id, name, owner_partner_membership_id, manager_membership_id, status) values
      ('${C.a}', '${FA}', 'AUTO Client A', '${M.partnerA}', '${M.managerA}', 'active'),
      ('${C.b}', '${FB}', 'AUTO Client B', '${M.partnerB}', null,            'active'),
      ('${C.c}', '${FC}', 'AUTO Client C', '${M.partnerC}', null,            'active'),
      ('${C.d}', '${FD}', 'AUTO Client D', '${M.partnerD}', null,            'active');

    insert into public.legal_entities (id, firm_id, client_id, entity_type, legal_name) values
      ('${E.idem}', '${FA}', '${C.a}', 'private_limited', 'AUTO Entity Idem'),
      ('${E.prop}', '${FA}', '${C.a}', 'private_limited', 'AUTO Entity Prop'),
      ('${E.prop2}', '${FA}', '${C.a}', 'private_limited', 'AUTO Entity Prop2'),
      ('${E.inert}', '${FA}', '${C.a}', 'llp',             'AUTO Entity Inert'),
      ('${E.ent}',  '${FA}', '${C.a}', 'private_limited', 'AUTO Entity Ent'),
      ('${E.reg}',  '${FA}', '${C.a}', 'private_limited', 'AUTO Entity Reg'),
      ('${E.race}', '${FA}', '${C.a}', 'private_limited', 'AUTO Entity Race'),
      ('${E.b1}',   '${FB}', '${C.b}', 'private_limited', 'AUTO Entity B1'),
      ('${E.hist}', '${FC}', '${C.c}', 'private_limited', 'AUTO Entity Hist'),
      ('${E.la}',   '${FD}', '${C.d}', 'private_limited', 'AUTO Entity LA');

    insert into public.registrations (id, firm_id, legal_entity_id, type, value, state) values
      ('${R.gst1}', '${FA}', '${E.reg}', 'GSTIN', '27AUTO0000A1Z5', 'Maharashtra'),
      ('${R.gst2}', '${FA}', '${E.reg}', 'GSTIN', '27AUTO0000B1Z3', 'Maharashtra'),
      ('${R.gstInert}', '${FA}', '${E.inert}', 'GSTIN', '27AUTO0000C1Z1', 'Maharashtra');

    insert into public.compliance_types
      (id, firm_id, type_key, name, category, frequency, due_rule, workflow_template,
       scope_kind, registration_class, governance_class, four_eyes_required)
    values
      ('${T.monthly}', '${FA}', 'auto-monthly', 'AUTO Monthly', 'Certificates',
       'monthly', '{"description":"period end + 10"}', '{"states":["not_started","preparation","closed"]}',
       'entity', null, 'non_statutory', false),
      ('${T.reg}', '${FA}', 'auto-reg', 'AUTO Registration Monthly', 'GST',
       'monthly', '{"description":"11th of following month"}', '{"states":["not_started","preparation","closed"]}',
       'registration', 'GSTIN', 'non_statutory', false),
      ('${T.b}', '${FB}', 'auto-monthly-b', 'AUTO Monthly B', 'Certificates',
       'monthly', '{"description":"period end + 15"}', '{"states":["not_started","preparation","closed"]}',
       'entity', null, 'non_statutory', false),
      ('${T.hist}', '${FC}', 'auto-hist', 'AUTO History', 'Certificates',
       'monthly', '{"description":"succession probe"}', '{"states":["not_started","preparation","closed"]}',
       'entity', null, 'non_statutory', false),
      ('${T.la}', '${FD}', 'auto-la', 'AUTO Lookahead', 'Certificates',
       'monthly', '{"description":"period end + 10"}', '{"states":["not_started","preparation","closed"]}',
       'entity', null, 'non_statutory', false);

    -- Operator path: explicit ACTIVE lifecycle state (crv_prepare_insert
    -- validated); due_rule carries the machine-readable grammar the
    -- generator interprets (implementation interpretation (a)).
    insert into public.compliance_rule_versions
      (id, firm_id, compliance_type_id, version, effective_from, frequency, due_rule,
       status, domain_approval_status)
    values
      ('${V.monthly1}', '${FA}', '${T.monthly}', 1, '2026-04-01', 'monthly',
       '{"days_after_period_end": 10}', 'active', 'not_required'),
      ('${V.reg1}', '${FA}', '${T.reg}', 1, '2026-04-01', 'monthly',
       '{"due_day_of_month": 11, "months_after_period_end": 1}', 'active', 'not_required'),
      ('${V.b1}', '${FB}', '${T.b}', 1, '2026-04-01', 'monthly',
       '{"days_after_period_end": 15}', 'active', 'not_required'),
      ('${V.hist1}', '${FC}', '${T.hist}', 1, '2026-04-01', 'monthly',
       '{"days_after_period_end": 10}', 'active', 'not_required'),
      -- v2: DIFFERENT due_rule, effective from the NEXT Kolkata month
      -- (stays draft until TEST-AUTO-09 activates it under the command flag).
      ('${V.hist2}', '${FC}', '${T.hist}', 2,
       (date_trunc('month', (now() at time zone 'Asia/Kolkata')::date) + interval '1 month')::date,
       'monthly', '{"days_after_period_end": 5}', 'draft', 'not_required'),
      ('${V.la1}', '${FD}', '${T.la}', 1, '2026-04-01', 'monthly',
       '{"days_after_period_end": 10}', 'active', 'not_required');

    -- Active profiles are direct operator INSERTs (the SCH-11 guard gates
    -- UPDATE activation only); approved_at = now() => catch-up lower bound
    -- is the current Kolkata period. P.hist / P.la / P.race are staged
    -- lazily inside their tests so earlier evaluate runs never touch them.
    insert into public.client_compliance_profiles
      (id, firm_id, legal_entity_id, compliance_type_id, registration_id, status, approved_at)
    values
      ('${P.idem}',  '${FA}', '${E.idem}', '${T.monthly}', null,       'active',   now()),
      ('${P.prop}',  '${FA}', '${E.prop}', '${T.monthly}', null,       'proposed', null),
      ('${P.prop2}', '${FA}', '${E.prop2}', '${T.monthly}', null,      'proposed', null),
      ('${P.proposedInert}', '${FA}', '${E.inert}', '${T.monthly}', null, 'proposed', null),
      ('${P.susp}',  '${FA}', '${E.inert}', '${T.reg}',   '${R.gstInert}', 'suspended', now()),
      ('${P.regGst1}', '${FA}', '${E.reg}', '${T.reg}',    '${R.gst1}', 'active',  now()),
      ('${P.regGst2}', '${FA}', '${E.reg}', '${T.reg}',    '${R.gst2}', 'active',  now()),
      ('${P.ent}',   '${FA}', '${E.ent}',  '${T.monthly}', null,       'active',   now()),
      ('${P.b}',     '${FB}', '${E.b1}',   '${T.b}',       null,       'active',   now());
  `);
  // Fixture writes are operator rows; remove fixture audit/publication noise
  // so per-run correlation assertions read a clean table.
  psql(`
    delete from public.audit_log where firm_id in (${ALL_FIRMS.map((f) => `'${f}'`).join(',')});
    delete from public.event_outbox where firm_id in (${ALL_FIRMS.map((f) => `'${f}'`).join(',')});
  `);
}

beforeAll(async () => {
  suiteStart = psql(`select now();`).trim();
  seedFixture();
  const s = await signIn(userEmail('USER_A_SUPER_ADMIN'));
  if (!s.ok) throw new Error(`sign-in failed for USER_A_SUPER_ADMIN: ${JSON.stringify(s.raw)}`);
  superAdminA = s.token;
});

afterAll(() => {
  cleanRows();
  psql(`
    delete from public.scheduler_job_runs where started_at >= '${suiteStart}'::timestamptz;
    delete from public.firms where id in (${ALL_FIRMS.map((f) => `'${f}'`).join(',')})
      and not exists (select 1 from public.firm_memberships m where m.firm_id = firms.id)
      and not exists (select 1 from public.clients c where c.firm_id = firms.id);
    -- The firm DELETE itself lands a Layer-A audit row; sweep it last.
    delete from public.audit_log where firm_id in (${ALL_FIRMS.map((f) => `'${f}'`).join(',')});
  `);
});

// ---------------------------------------------------------------------------
// TEST-AUTO-01 — scheduler idempotency (AUTO-REC-03/08, AUTO-IDM-01)
// ---------------------------------------------------------------------------

describe('TEST-AUTO-01 — double-run idempotency', () => {
  it('a second evaluate_recurrence run creates nothing new (instances, publications, audit)', () => {
    expect(instanceCount(P.idem)).toBe(0); // pristine before the first run

    evaluate();
    const n1 = instanceCount(P.idem);
    expect(n1).toBe(expectedMonths(90));
    const scope = `firm_id = '${FA}' and payload ->> 'instance_id' in
      (select id::text from public.compliance_instances
       where client_compliance_profile_id = '${P.idem}')`;
    const events1 = Number(
      psql(`select count(*) from public.event_outbox
            where event_type = 'compliance_instance.created' and ${scope};`).trim(),
    );
    const audit1 = Number(
      psql(`select count(*) from public.audit_log
            where action = 'compliance_instance.generated' and firm_id = '${FA}'
              and object_id in (select id::text from public.compliance_instances
                                where client_compliance_profile_id = '${P.idem}');`).trim(),
    );
    expect(events1).toBe(n1); // winner-only publication, one per instance
    expect(audit1).toBe(n1); // winner-only audit, one per instance

    evaluate();
    expect(instanceCount(P.idem)).toBe(n1);
    expect(
      Number(
        psql(`select count(*) from public.event_outbox
              where event_type = 'compliance_instance.created' and ${scope};`).trim(),
      ),
    ).toBe(events1);
    expect(
      Number(
        psql(`select count(*) from public.audit_log
              where action = 'compliance_instance.generated' and firm_id = '${FA}'
                and object_id in (select id::text from public.compliance_instances
                                  where client_compliance_profile_id = '${P.idem}');`).trim(),
      ),
    ).toBe(audit1);
    // Exactly one publication per instance (no duplicate publication rows).
    expect(
      psql(`select payload ->> 'instance_id' from public.event_outbox
            where event_type = 'compliance_instance.created' and ${scope}
            group by 1 having count(*) <> 1;`).trim(),
    ).toBe('');
  });
});

// ---------------------------------------------------------------------------
// TEST-AUTO-02 — trigger points (a) approval and (b) closure (AUTO-REC-01)
// ---------------------------------------------------------------------------

describe('TEST-AUTO-02 — approval and closure trigger immediate materialization', () => {
  it('approval RPC materializes the CURRENT period immediately with automation actor/correlation stamps', async () => {
    const res = await api(superAdminA, 'POST', 'rpc/approve_client_compliance_profile', {
      headers: H(FA),
      body: { p_profile_id: P.prop },
    });
    expect(res.status).toBe(200);
    expect((res.body as { status: string }).status).toBe('approved');

    expect(instanceCount(P.prop)).toBe(1);
    // The materialized row is the current Kolkata month, pinned to v1,
    // recurrence-sourced, due = period_end + 10.
    expect(
      psql(`select bool_and(
              period_start = date_trunc('month', (now() at time zone 'Asia/Kolkata')::date)::date
              and period_end = (date_trunc('month', (now() at time zone 'Asia/Kolkata')::date) + interval '1 month' - interval '1 day')::date
              and due_date = period_end + 10
              and calculated_due_date = due_date
              and rule_version_id = '${V.monthly1}'
              and generation_source = 'recurrence'
              and generated_at is not null)
            from public.compliance_instances
            where client_compliance_profile_id = '${P.prop}';`).trim(),
    ).toBe('t');
    // Same-transaction publication + winner-only audit with the automation
    // actor model (AUD-ACT-02/05).
    expect(
      Number(
        psql(`select count(*) from public.event_outbox o
              where o.event_type = 'compliance_instance.created' and o.firm_id = '${FA}'
                and o.payload ->> 'instance_id' in (select id::text from public.compliance_instances
                                                    where client_compliance_profile_id = '${P.prop}');`).trim(),
      ),
    ).toBe(1);
    expect(
      Number(
        psql(`select count(*) from public.audit_log
              where action = 'compliance_instance.generated' and firm_id = '${FA}'
                and actor_type = 'system' and actor_user_id is null and service_name = 'recurrence'
                and object_id in (select id::text from public.compliance_instances
                                  where client_compliance_profile_id = '${P.prop}');`).trim(),
      ),
    ).toBe(1);
  });

  it('closure via the transition RPC materializes + links the successor, copying assignments', async () => {
    const inst = psql(
      `select id from public.compliance_instances where client_compliance_profile_id = '${P.prop}';`,
    ).trim();
    // Assign the current instance so the successor copy (PRD §29, DM-12) is observable.
    psql(`update public.compliance_instances
          set assignee_membership_id = '${M.seniorA}',
              reviewer_membership_id = '${M.managerA}',
              partner_membership_id = '${M.partnerA}'
          where id = '${inst}';`);

    const prep = await api(superAdminA, 'POST', 'rpc/transition_compliance_instance', {
      headers: H(FA),
      body: { p_instance_id: inst, p_to_state: 'preparation' },
    });
    expect((prep.body as { status: string }).status).toBe('transitioned');
    const close = await api(superAdminA, 'POST', 'rpc/transition_compliance_instance', {
      headers: H(FA),
      body: { p_instance_id: inst, p_to_state: 'closed' },
    });
    expect((close.body as { status: string }).status).toBe('transitioned');

    // No look-ahead existed yet (approval materializes only the current
    // period): closure itself created the successor and linked it.
    expect(instanceCount(P.prop)).toBe(2);
    const link = psql(`select successor_instance_id from public.compliance_instances where id = '${inst}';`).trim();
    expect(link).not.toBe('');
    expect(
      psql(`select bool_and(
              period_start = (date_trunc('month', (now() at time zone 'Asia/Kolkata')::date) + interval '1 month')::date
              and assignee_membership_id = '${M.seniorA}'
              and reviewer_membership_id = '${M.managerA}'
              and partner_membership_id = '${M.partnerA}'
              and rule_version_id = '${V.monthly1}'
              and generation_source = 'recurrence')
            from public.compliance_instances where id = '${link}';`).trim(),
    ).toBe('t');

    // The daily run is idempotent against the closure-created successor:
    // look-ahead fills the remaining periods, never duplicating the linked one.
    evaluate();
    expect(instanceCount(P.prop)).toBe(expectedMonths(90));
    expect(
      psql(`select period_start from public.compliance_instances
            where client_compliance_profile_id = '${P.prop}'
            group by period_start having count(*) <> 1;`).trim(),
    ).toBe('');
  });

  it('closure against an EXISTING look-ahead row links it without duplicating', async () => {
    const approve = await api(superAdminA, 'POST', 'rpc/approve_client_compliance_profile', {
      headers: H(FA),
      body: { p_profile_id: P.prop2 },
    });
    expect((approve.body as { status: string }).status).toBe('approved');
    evaluate(); // full look-ahead, including next month
    const total = instanceCount(P.prop2);
    expect(total).toBe(expectedMonths(90));
    const current = psql(`select id from public.compliance_instances
      where client_compliance_profile_id = '${P.prop2}'
        and period_start = date_trunc('month', (now() at time zone 'Asia/Kolkata')::date)::date;`).trim();
    const nextMonth = psql(`select id from public.compliance_instances
      where client_compliance_profile_id = '${P.prop2}'
        and period_start = (date_trunc('month', (now() at time zone 'Asia/Kolkata')::date) + interval '1 month')::date;`).trim();

    for (const to of ['preparation', 'closed']) {
      const res = await api(superAdminA, 'POST', 'rpc/transition_compliance_instance', {
        headers: H(FA),
        body: { p_instance_id: current, p_to_state: to },
      });
      expect((res.body as { status: string }).status).toBe('transitioned');
    }
    expect(psql(`select successor_instance_id from public.compliance_instances where id = '${current}';`).trim()).toBe(
      nextMonth,
    );
    expect(instanceCount(P.prop2)).toBe(total); // nothing new created
  });

  it('proposed and suspended profiles generate nothing (DM-11)', () => {
    evaluate();
    expect(instanceCount(P.proposedInert)).toBe(0);
    expect(instanceCount(P.susp)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// TEST-AUTO-03 — scope cardinality (entity vs registration)
// ---------------------------------------------------------------------------

describe('TEST-AUTO-03 — one instance per registration per period / per entity per period', () => {
  it('registration-scoped type with two registrations yields exactly two instances per period', () => {
    evaluate();
    const periods = expectedMonths(90);
    const rows = psql(`select count(*), count(distinct registration_id) from public.compliance_instances
      where client_compliance_profile_id in ('${P.regGst1}', '${P.regGst2}')
      group by period_start;`)
      .trim()
      .split('\n');
    expect(rows.length).toBe(periods);
    for (const row of rows) expect(row).toBe('2|2');
    // … and the pair is exactly the two staged registrations.
    expect(
      psql(`select string_agg(distinct registration_id::text, ',' order by registration_id::text)
            from public.compliance_instances
            where client_compliance_profile_id in ('${P.regGst1}', '${P.regGst2}');`).trim(),
    ).toBe([R.gst1, R.gst2].sort().join(','));
  });

  it('entity-scoped type yields exactly one instance per entity per period', () => {
    const rows = psql(`select count(*), count(distinct registration_id) from public.compliance_instances
      where client_compliance_profile_id = '${P.ent}'
      group by period_start;`)
      .trim()
      .split('\n');
    expect(rows.length).toBe(expectedMonths(90));
    // count(distinct registration_id) ignores NULLs: 1 instance, 0 registrations.
    for (const row of rows) expect(row).toBe('1|0');
  });
});

// ---------------------------------------------------------------------------
// AUTO-REC-02 (SCH-01) — look-ahead configuration + the
// TEST-OPS-07 recurrence half (failure is visible; the re-run after the
// fix is safe and idempotent)
// (Label correction, human ruling HRR-08=A 2026-09-14: this block was
// mislabeled TEST-AUTO-04; canonical TEST-AUTO-04 is alert dedupe +
// audit-logged auto-resolution per `11`/`09` and belongs to IMP-051.
// Label/comment metadata only — no execution, assertion, setup, or data
// change.)
// ---------------------------------------------------------------------------

describe('AUTO-REC-02 — per-firm look-ahead configuration', () => {
  it('a configured 30-day horizon yields fewer periods; invalid values fail the run observably; the fixed re-run succeeds', () => {
    try {
      psql(`update public.firms set settings = '{"recurrence_lookahead_days": 30}'::jsonb where id = '${FD}';`);
      psql(`insert into public.client_compliance_profiles
            (id, firm_id, legal_entity_id, compliance_type_id, status, approved_at)
            values ('${P.la}', '${FD}', '${E.la}', '${T.la}', 'active', now());`);

      evaluate();
      expect(instanceCount(P.la)).toBe(expectedMonths(30));
      expect(
        psql(`select coalesce(max(period_start) <= ((now() at time zone 'Asia/Kolkata')::date + 30), true)
              from public.compliance_instances where client_compliance_profile_id = '${P.la}';`).trim(),
      ).toBe('t');
      // The 30-day horizon is genuinely narrower than the default 90-day one.
      expect(instanceCount(P.la)).toBeLessThan(instanceCount(P.idem));

      // Invalid configuration values: the firm's subtransaction rolls back,
      // the run ends 'failed' with the firm id in the error, no new instances.
      for (const bad of ['0', '-3', '"abc"', '1.5']) {
        psql(`update public.firms set settings = jsonb_build_object('recurrence_lookahead_days', '${bad}'::jsonb) where id = '${FD}';`);
        const before = instanceCount(P.la);
        evaluate();
        const run = lastRecurrenceRun();
        expect(run.status).toBe('failed');
        expect(run.error).toContain(FD);
        expect(run.error).toContain('recurrence_lookahead_days');
        expect(instanceCount(P.la)).toBe(before);
      }

      // TEST-OPS-07 (recurrence half): once the configuration is fixed the
      // re-run succeeds and catches up exactly once (idempotent).
      psql(`update public.firms set settings = '{}'::jsonb where id = '${FD}';`);
      evaluate();
      expect(lastRecurrenceRun().status).toBe('succeeded');
      expect(instanceCount(P.la)).toBe(expectedMonths(90));
      evaluate();
      expect(instanceCount(P.la)).toBe(expectedMonths(90));
      expect(
        psql(`select period_start from public.compliance_instances
              where client_compliance_profile_id = '${P.la}'
              group by period_start having count(*) <> 1;`).trim(),
      ).toBe('');
    } finally {
      // Never let a mid-test failure poison later evaluate runs.
      psql(`update public.firms set settings = '{}'::jsonb where id = '${FD}';`);
    }
  });
});

// ---------------------------------------------------------------------------
// AUTO-REC-02 — an ACTIVE unparseable due_rule fails observably end-to-end
// (independent-review correction M-1): no silent fallback, no invented due
// date; the failure is visible through SCH-34 with correct firm attribution
// and the immediate activation path fails as an atomic conflict.
// ---------------------------------------------------------------------------

describe('AUTO-REC-02 — an ACTIVE rule version with an unparseable due_rule fails observably', () => {
  beforeAll(() => {
    // An ACTIVE version whose due_rule carries no machine-readable grammar
    // key (implementation interpretation (a)) — staged in FD so failure
    // attribution is isolated. No profile references it until a test
    // stages one, so other describes' evaluate runs never touch it.
    psql(`
      insert into public.compliance_types
        (id, firm_id, type_key, name, category, frequency, due_rule, workflow_template,
         scope_kind, registration_class, governance_class, four_eyes_required)
      values
        ('${T.bad}', '${FD}', 'auto-bad-rule', 'AUTO Bad Rule', 'Certificates',
         'monthly', '{"description":"7th of following month"}',
         '{"states":["not_started","preparation","closed"]}',
         'entity', null, 'non_statutory', false);
      insert into public.compliance_rule_versions
        (id, firm_id, compliance_type_id, version, effective_from, frequency, due_rule,
         status, domain_approval_status)
      values
        ('${V.bad}', '${FD}', '${T.bad}', 1, '2026-04-01', 'monthly',
         '{"description":"7th of following month"}', 'active', 'not_required');
    `);
  });

  afterAll(() => {
    psql(`
      delete from public.client_compliance_profiles where compliance_type_id = '${T.bad}';
      delete from public.compliance_rule_versions where id = '${V.bad}';
      delete from public.compliance_types where id = '${T.bad}';
    `);
  });

  it('evaluate_recurrence records the firm-attributed failure in SCH-34 and materializes nothing for the profile', () => {
    try {
      // A broken ACTIVE profile in FD (governing version unparseable)…
      psql(`insert into public.client_compliance_profiles
            (id, firm_id, legal_entity_id, compliance_type_id, status, approved_at)
            values ('${P.bad}', '${FD}', '${E.la}', '${T.bad}', 'active', now());`);
      // …plus a HEALTHY new active profile in FA, proving the run continues
      // for other firms (per-firm subtransactions, AUTO-PRIN-04).
      psql(`
        insert into public.legal_entities (id, firm_id, client_id, entity_type, legal_name)
        values ('${E.proof}', '${FA}', '${C.a}', 'private_limited', 'AUTO Entity Proof');
        insert into public.client_compliance_profiles
          (id, firm_id, legal_entity_id, compliance_type_id, status, approved_at)
        values ('${P.proof}', '${FA}', '${E.proof}', '${T.monthly}', 'active', now());
      `);

      evaluate();
      const run = lastRecurrenceRun();

      // Observable failure through the approved SCH-34 mechanism, correctly
      // attributed to FD (and ONLY FD).
      expect(run.status).toBe('failed');
      expect(run.error).toContain(FD);
      expect(run.error).toContain('not machine-readable');
      expect(run.error).not.toContain(FA);

      // No silent fallback: zero instances (no invented due date) and zero
      // publication/audit side effects for the failing firm under this run.
      expect(instanceCount(P.bad)).toBe(0);
      expect(
        psql(`select count(*) from public.event_outbox
              where firm_id = '${FD}' and correlation_id = '${run.correlation_id}';`).trim(),
      ).toBe('0');
      expect(
        psql(`select count(*) from public.audit_log
              where firm_id = '${FD}' and correlation_id = '${run.correlation_id}';`).trim(),
      ).toBe('0');

      // Cross-firm continuation: the healthy FA profile materialized fully
      // in the SAME failed run.
      expect(instanceCount(P.proof)).toBe(expectedMonths(90));
    } finally {
      // Full cleanup so no later evaluate run can ever see the broken rule.
      psql(`
        delete from public.compliance_instances
          where client_compliance_profile_id in ('${P.bad}', '${P.proof}');
        delete from public.client_compliance_profiles where id in ('${P.bad}', '${P.proof}');
        delete from public.legal_entities where id = '${E.proof}';
      `);
    }
  });

  it('the activation RPC over the unparseable ACTIVE rule fails as an ATOMIC conflict (approval rolled back, zero side effects)', async () => {
    const s = await signIn(userEmail('USER_B_PARTNER')); // partner membership in FD (M.partnerD)
    if (!s.ok) throw new Error(`sign-in failed for USER_B_PARTNER: ${JSON.stringify(s.raw)}`);
    try {
      psql(`insert into public.client_compliance_profiles
            (id, firm_id, legal_entity_id, compliance_type_id, status)
            values ('${P.badProp}', '${FD}', '${E.la}', '${T.bad}', 'proposed');`);
      const outboxBefore = psql(`select count(*) from public.event_outbox where firm_id = '${FD}';`).trim();
      const instBefore = psql(`select count(*) from public.compliance_instances where firm_id = '${FD}';`).trim();

      const res = await api(s.token, 'POST', 'rpc/approve_client_compliance_profile', {
        headers: H(FD),
        body: { p_profile_id: P.badProp },
      });
      expect(res.status).toBe(200);
      const body = res.body as { status: string; kind: string; message: string };
      expect(body.status).toBe('denied');
      expect(body.kind).toBe('conflict');
      expect(body.message).toContain('materialization failed');

      // Atomic: the profile never became active (the approval update rolled
      // back with the generation failure), no instance was materialized, no
      // publication was recorded — and the attempt is denial-audited
      // (AUD-FAIL-01).
      expect(
        psql(`select status || '|' || coalesce(approved_at::text, '<null>')
              from public.client_compliance_profiles where id = '${P.badProp}';`).trim(),
      ).toBe('proposed|<null>');
      expect(psql(`select count(*) from public.compliance_instances where firm_id = '${FD}';`).trim()).toBe(
        instBefore,
      );
      expect(psql(`select count(*) from public.event_outbox where firm_id = '${FD}';`).trim()).toBe(outboxBefore);
      expect(
        Number(
          psql(`select count(*) from public.audit_log
                where firm_id = '${FD}' and action = 'compliance_profile.approval_denied'
                  and object_id = '${P.badProp}';`).trim(),
        ),
      ).toBe(1);
    } finally {
      psql(`delete from public.client_compliance_profiles where id = '${P.badProp}';`);
    }
  });
});

// ---------------------------------------------------------------------------
// AUTO-REC-10 — Asia/Kolkata business-date basis
// ---------------------------------------------------------------------------

describe('AUTO-REC-10 — generated periods and due dates are Kolkata business dates', () => {
  it('monthly periods match the Kolkata-derived calendar exactly; due = period_end + 10', () => {
    const actual = psql(`select string_agg(period_start::text || '..' || period_end::text, ',' order by period_start)
      from public.compliance_instances where client_compliance_profile_id = '${P.idem}';`).trim();
    const expected = psql(`select string_agg(s::date::text || '..' || (s + interval '1 month' - interval '1 day')::date::text, ',' order by s)
      from generate_series(
        date_trunc('month', (now() at time zone 'Asia/Kolkata')::date)::date,
        ((now() at time zone 'Asia/Kolkata')::date + 90)::date,
        interval '1 month') s;`).trim();
    expect(actual).toBe(expected);
    expect(
      Number(
        psql(`select count(*) from public.compliance_instances
              where client_compliance_profile_id = '${P.idem}'
                and (due_date <> period_end + 10 or calculated_due_date <> due_date);`).trim(),
      ),
    ).toBe(0);
  });

  it('the due_day_of_month grammar lands on the 11th of the month following the period', () => {
    expect(
      Number(
        psql(`select count(*) from public.compliance_instances
              where client_compliance_profile_id = '${P.regGst1}'
                and due_date <> (date_trunc('month', period_end) + interval '1 month' + interval '10 days')::date;`).trim(),
      ),
    ).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// TEST-AUTO-12 (immediate paths; independent-review correction L-3) —
// originating-request correlation propagation for activation/closure-
// triggered materialization (AUTO-ENV-01, AUD-INV-06, AUTO-AUD-02,
// AUD-CTX-02). The scheduled-run half (one run correlation per run) lives
// in scheduler-mechanism.test.ts and is unchanged.
// ---------------------------------------------------------------------------

describe('TEST-AUTO-12 (immediate paths) — originating request correlation propagates into immediate materialization', () => {
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

  function publicationCorrelation(instanceId: string): string {
    return psql(`select correlation_id from public.event_outbox
      where event_type = 'compliance_instance.created'
        and payload ->> 'instance_id' = '${instanceId}';`).trim();
  }

  function generationAuditCorrelation(instanceId: string): string {
    return psql(`select correlation_id from public.audit_log
      where action = 'compliance_instance.generated' and object_id = '${instanceId}';`).trim();
  }

  it('profile activation with a valid x-correlation-id stamps the whole automation chain with it', async () => {
    try {
      psql(`
        insert into public.legal_entities (id, firm_id, client_id, entity_type, legal_name)
        values ('${E.corrA}', '${FA}', '${C.a}', 'private_limited', 'AUTO Entity CorrA');
        insert into public.client_compliance_profiles
          (id, firm_id, legal_entity_id, compliance_type_id, status)
        values ('${P.corrA}', '${FA}', '${E.corrA}', '${T.monthly}', 'proposed');
      `);
      const res = await api(superAdminA, 'POST', 'rpc/approve_client_compliance_profile', {
        headers: { ...H(FA), 'x-correlation-id': CORR_A },
        body: { p_profile_id: P.corrA },
      });
      expect((res.body as { status: string }).status).toBe('approved');
      expect(instanceCount(P.corrA)).toBe(1);
      const inst = psql(`select id from public.compliance_instances
        where client_compliance_profile_id = '${P.corrA}';`).trim();

      // SCH-33 publication, the generation audit row, AND the request's own
      // Layer-B mutation audit row all carry the originating correlation —
      // request -> mutation -> automation -> audit (AUTO-ENV-01).
      expect(publicationCorrelation(inst)).toBe(CORR_A);
      expect(generationAuditCorrelation(inst)).toBe(CORR_A);
      expect(
        psql(`select correlation_id from public.audit_log
              where action = 'compliance_profile.approve' and object_id = '${P.corrA}';`).trim(),
      ).toBe(CORR_A);
    } finally {
      psql(`
        delete from public.compliance_instances where client_compliance_profile_id = '${P.corrA}';
        delete from public.client_compliance_profiles where id = '${P.corrA}';
        delete from public.legal_entities where id = '${E.corrA}';
      `);
    }
  });

  it('instance closure with a valid x-correlation-id stamps the successor materialization chain with it', async () => {
    try {
      psql(`
        insert into public.legal_entities (id, firm_id, client_id, entity_type, legal_name)
        values ('${E.corrB}', '${FA}', '${C.a}', 'private_limited', 'AUTO Entity CorrB');
        insert into public.client_compliance_profiles
          (id, firm_id, legal_entity_id, compliance_type_id, status)
        values ('${P.corrB}', '${FA}', '${E.corrB}', '${T.monthly}', 'proposed');
      `);
      const approve = await api(superAdminA, 'POST', 'rpc/approve_client_compliance_profile', {
        headers: H(FA),
        body: { p_profile_id: P.corrB },
      });
      expect((approve.body as { status: string }).status).toBe('approved');
      const inst = psql(`select id from public.compliance_instances
        where client_compliance_profile_id = '${P.corrB}';`).trim();

      const prep = await api(superAdminA, 'POST', 'rpc/transition_compliance_instance', {
        headers: H(FA),
        body: { p_instance_id: inst, p_to_state: 'preparation' },
      });
      expect((prep.body as { status: string }).status).toBe('transitioned');
      const close = await api(superAdminA, 'POST', 'rpc/transition_compliance_instance', {
        headers: { ...H(FA), 'x-correlation-id': CORR_B },
        body: { p_instance_id: inst, p_to_state: 'closed' },
      });
      expect((close.body as { status: string }).status).toBe('transitioned');

      const succ = psql(`select successor_instance_id from public.compliance_instances where id = '${inst}';`).trim();
      expect(succ).not.toBe('');
      // The successor's SCH-33 publication and generation audit row carry
      // the closure request's correlation; the closing transition's own
      // Layer-B audit row shares it.
      expect(publicationCorrelation(succ)).toBe(CORR_B);
      expect(generationAuditCorrelation(succ)).toBe(CORR_B);
      expect(
        psql(`select correlation_id from public.audit_log
              where action = 'compliance_instance.transition' and object_id = '${inst}'
                and new_value ->> 'state' = 'closed';`).trim(),
      ).toBe(CORR_B);
    } finally {
      psql(`
        update public.compliance_instances set successor_instance_id = null
          where client_compliance_profile_id = '${P.corrB}';
        delete from public.compliance_instances where client_compliance_profile_id = '${P.corrB}';
        delete from public.client_compliance_profiles where id = '${P.corrB}';
        delete from public.legal_entities where id = '${E.corrB}';
      `);
    }
  });

  it('without a valid originating correlation the immediate chain shares ONE minted server-side identity; a malformed header never aborts the command', async () => {
    try {
      psql(`
        insert into public.legal_entities (id, firm_id, client_id, entity_type, legal_name) values
          ('${E.corrM}', '${FA}', '${C.a}', 'private_limited', 'AUTO Entity CorrM'),
          ('${E.corrX}', '${FA}', '${C.a}', 'private_limited', 'AUTO Entity CorrX');
        insert into public.client_compliance_profiles
          (id, firm_id, legal_entity_id, compliance_type_id, status) values
          ('${P.corrM}', '${FA}', '${E.corrM}', '${T.monthly}', 'proposed'),
          ('${P.corrX}', '${FA}', '${E.corrX}', '${T.monthly}', 'proposed');
      `);

      // No correlation header: publication and generation audit row share
      // exactly one freshly minted non-null identity.
      const minted = await api(superAdminA, 'POST', 'rpc/approve_client_compliance_profile', {
        headers: H(FA),
        body: { p_profile_id: P.corrM },
      });
      expect((minted.body as { status: string }).status).toBe('approved');
      const instM = psql(`select id from public.compliance_instances
        where client_compliance_profile_id = '${P.corrM}';`).trim();
      const pubCorr = publicationCorrelation(instM);
      expect(pubCorr).toMatch(UUID_RE);
      expect(generationAuditCorrelation(instM)).toBe(pubCorr);

      // A malformed (non-uuid) header is untrusted metadata (AUD-CTX-02):
      // the command still succeeds and the chain carries a minted uuid,
      // never the junk value.
      const malformed = await api(superAdminA, 'POST', 'rpc/approve_client_compliance_profile', {
        headers: { ...H(FA), 'x-correlation-id': 'not-a-uuid' },
        body: { p_profile_id: P.corrX },
      });
      expect((malformed.body as { status: string }).status).toBe('approved');
      const instX = psql(`select id from public.compliance_instances
        where client_compliance_profile_id = '${P.corrX}';`).trim();
      expect(publicationCorrelation(instX)).toMatch(UUID_RE);
      expect(generationAuditCorrelation(instX)).toBe(publicationCorrelation(instX));
    } finally {
      psql(`
        delete from public.compliance_instances where client_compliance_profile_id in ('${P.corrM}', '${P.corrX}');
        delete from public.client_compliance_profiles where id in ('${P.corrM}', '${P.corrX}');
        delete from public.legal_entities where id in ('${E.corrM}', '${E.corrX}');
      `);
    }
  });
});

// ---------------------------------------------------------------------------
// TEST-AUTO-09 — historical stability across rule succession (AUTO-REC-07)
// ---------------------------------------------------------------------------

describe('TEST-AUTO-09 — pre-existing instances stay pinned; new periods use the successor version', () => {
  it('succession to v2 (different due_rule, effective next period) never rewrites history', () => {
    try {
      // Materialize ONLY the current period under v1 (lookahead 1 day keeps
      // the horizon inside the current month).
      psql(`update public.firms set settings = '{"recurrence_lookahead_days": 1}'::jsonb where id = '${FC}';`);
      psql(`insert into public.client_compliance_profiles
            (id, firm_id, legal_entity_id, compliance_type_id, status, approved_at)
            values ('${P.hist}', '${FC}', '${E.hist}', '${T.hist}', 'active', now());`);
      evaluate();
      expect(instanceCount(P.hist)).toBe(1);
      const snapshot = psql(`select string_agg(
          id::text || '|' || period_start || '|' || period_end || '|' ||
          rule_version_id::text || '|' || calculated_due_date || '|' || generated_at, ',' order by period_start)
        from public.compliance_instances where client_compliance_profile_id = '${P.hist}';`).trim();

      // Genuine succession shape (SCH-32 touching half-open windows): v1's
      // window closes where v2 opens; the lifecycle UPDATE runs under the
      // transaction-local command flag (never reachable from PostgREST).
      const v2From = psql(`select effective_from from public.compliance_rule_versions where id = '${V.hist2}';`).trim();
      psql(`
        do $$ begin
          perform set_config('app.crv_lifecycle_command', '1', true);
          update public.compliance_rule_versions set effective_to = '${v2From}' where id = '${V.hist1}';
          update public.compliance_rule_versions set status = 'active' where id = '${V.hist2}';
        end $$;
      `);

      psql(`update public.firms set settings = '{"recurrence_lookahead_days": 90}'::jsonb where id = '${FC}';`);
      evaluate();

      // History is byte-stable: the pre-existing instance keeps version,
      // calculated due date, generated_at and period.
      expect(
        psql(`select string_agg(
            id::text || '|' || period_start || '|' || period_end || '|' ||
            rule_version_id::text || '|' || calculated_due_date || '|' || generated_at, ',' order by period_start)
          from public.compliance_instances
          where client_compliance_profile_id = '${P.hist}'
            and period_start < '${v2From}';`).trim(),
      ).toBe(snapshot);
      // New periods (>= v2 effective_from) are governed by v2 with ITS due rule.
      const expectedNew = Number(
        psql(`select count(*) from generate_series(
                '${v2From}'::date,
                ((now() at time zone 'Asia/Kolkata')::date + 90)::date,
                interval '1 month') s;`).trim(),
      );
      expect(expectedNew).toBeGreaterThan(0);
      expect(
        Number(
          psql(`select count(*) from public.compliance_instances
                where client_compliance_profile_id = '${P.hist}'
                  and period_start >= '${v2From}'
                  and rule_version_id = '${V.hist2}'
                  and calculated_due_date = period_end + 5;`).trim(),
        ),
      ).toBe(expectedNew);
      expect(instanceCount(P.hist)).toBe(1 + expectedNew);
    } finally {
      psql(`update public.firms set settings = '{}'::jsonb where id = '${FC}';`);
    }
  });
});

// ---------------------------------------------------------------------------
// TEST-AUTO-10 — concurrent scheduler runs (AUTO-REC-03 layer 4)
// ---------------------------------------------------------------------------

function evaluateAsync(): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(
      'docker',
      ['exec', '-i', 'supabase_db_app', 'psql', '-U', 'postgres', '-d', 'postgres',
       '-v', 'ON_ERROR_STOP=1', '-tA', '-c', 'select public.evaluate_recurrence();'],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let err = '';
    p.stderr.on('data', (d) => {
      err += d;
    });
    p.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`evaluate_recurrence exited ${code}: ${err}`)),
    );
    p.on('error', reject);
  });
}

describe('TEST-AUTO-10 — concurrent evaluate_recurrence runs race to one winner per period', () => {
  it('two parallel runs produce exactly one instance per period and one publication per instance', async () => {
    psql(`insert into public.client_compliance_profiles
          (id, firm_id, legal_entity_id, compliance_type_id, status, approved_at)
          values ('${P.race}', '${FA}', '${E.race}', '${T.monthly}', 'active', now());`);
    expect(instanceCount(P.race)).toBe(0);

    await Promise.all([evaluateAsync(), evaluateAsync()]);

    expect(instanceCount(P.race)).toBe(expectedMonths(90));
    expect(
      psql(`select period_start from public.compliance_instances
            where client_compliance_profile_id = '${P.race}'
            group by period_start having count(*) <> 1;`).trim(),
    ).toBe('');
    expect(
      psql(`select payload ->> 'instance_id' from public.event_outbox
            where event_type = 'compliance_instance.created' and firm_id = '${FA}'
              and payload ->> 'instance_id' in (select id::text from public.compliance_instances
                                                where client_compliance_profile_id = '${P.race}')
            group by 1 having count(*) <> 1;`).trim(),
    ).toBe('');
  });
});
