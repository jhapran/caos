/**
 * IMP-031 — Compliance profiles & instances: schema/invariant tests
 * (SCH-11, SCH-12, DM-27, DM-SM-04, AUTO-REC-03 layer 3, AUTO-REC-07).
 *
 * Maps to spec 11:
 *   TEST-SCH-04  registration-scope invariants (DM-27) incl. the TDS PAN
 *                exception — positive, negative, and non-generalization to
 *                other registration classes;
 *   TEST-SCH-05  NULLS NOT DISTINCT uniqueness on both tables; the instance
 *                key deliberately EXCLUDES rule_version_id (same period +
 *                type + entity with a different rule version still
 *                conflicts — SCH-12 / AUTO-REC-03 layer 3);
 *   TEST-SCH-08  instance provenance: recurrence CHECK requires
 *                rule_version_id + generated_at; provenance fields reject
 *                updates (AUTO-REC-07);
 *   TEST-SCH-09  state/status vocabularies and period_end >= period_start;
 *   TEST-SCH-12  client_id trigger-derived from the legal entity
 *                (SCH-A-02): forged values overwritten, UPDATE rejected,
 *                cross-entity consistency;
 *   TEST-SCH-13  four-eyes + transition authorization at the SQL/RPC level
 *                (RLS-CIN-01 T1, RLS-4EY-01/02) via simulated request
 *                contexts (request.jwt.claims/request.headers set locally,
 *                the audit.test.ts precedent — never reachable from
 *                PostgREST without a real JWT);
 *   TEST-SCH-14  instance rule-version pinning stability across a REAL
 *                succession performed through the IMP-030 Layer-B
 *                activation command (simulated aal2 partner context).
 *
 * All structural assertions run as the postgres operator via psql — the
 * owner role proves the invariant holds WITHOUT RLS (RLS is never the
 * integrity boundary). Request-context behavior over real JWTs lives in
 * rls/compliance-instances-rls.test.ts; audit assertions in
 * audit/compliance-instances-audit.test.ts.
 *
 * Deterministic ids in the 63000000-… range; force-reset per run so the
 * suite is re-runnable; fixture audit rows removed as the operator in
 * teardown (append-only applies to application roles, AUD-INV-01).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { FIRM_A, FIRM_B, psql, userId } from '../helpers.mjs';

// Seeded system-default compliance types (supabase/seed.sql — reference data).
const SYS_GSTR1 = '50000000-0000-4000-8000-000000000001'; // registration / GSTIN
const SYS_TDS24Q = '50000000-0000-4000-8000-000000000003'; // registration / TAN
const SYS_ITR = '50000000-0000-4000-8000-000000000005'; // entity scope
const SYS_CERT = '50000000-0000-4000-8000-00000000000e'; // configurable, non_statutory

const M = {
  partnerA: '63000000-0000-4000-8000-000000000001',
  managerA: '63000000-0000-4000-8000-000000000002',
  seniorA: '63000000-0000-4000-8000-000000000003',
  articleA: '63000000-0000-4000-8000-000000000004',
  billingA: '63000000-0000-4000-8000-000000000005',
  suspendedA: '63000000-0000-4000-8000-000000000006',
  partnerB: '63000000-0000-4000-8000-000000000007',
};
const C = {
  a1: '63000000-0000-4000-8000-000000000101', // manager = managerA
  a2: '63000000-0000-4000-8000-000000000102', // manager = null (out of portfolio)
  b1: '63000000-0000-4000-8000-000000000111',
};
const E = {
  a1: '63000000-0000-4000-8000-000000000201',
  a2: '63000000-0000-4000-8000-000000000202', // second entity of client a1
  u1: '63000000-0000-4000-8000-000000000203', // entity of the unmanaged client a2
  b1: '63000000-0000-4000-8000-000000000211',
};
const REG = {
  panA1: '63000000-0000-4000-8000-000000000301',
  tanA1: '63000000-0000-4000-8000-000000000302',
  gstA1: '63000000-0000-4000-8000-000000000303',
  gstA2: '63000000-0000-4000-8000-000000000304', // GSTIN of a DIFFERENT entity
  panB1: '63000000-0000-4000-8000-000000000311', // other firm
};
const T = {
  four: '63000000-0000-4000-8000-0000000000c1', // 4-eyes, client_approval SKIPPED in template
  full: '63000000-0000-4000-8000-0000000000c2', // 4-eyes, client_approval present
  plain: '63000000-0000-4000-8000-0000000000c3', // no four-eyes
  pin: '63000000-0000-4000-8000-0000000000c4', // TEST-SCH-14 pinning/succession
  b1: '63000000-0000-4000-8000-0000000000c5', // FIRM-B-owned (firm-binding probes)
};
const V = {
  pin1: '63000000-0000-4000-8000-0000000001d1', // active [2026-04-01, ∞)
  pin2: '63000000-0000-4000-8000-0000000001d2', // draft, effective 2027-04-01
  plain1: '63000000-0000-4000-8000-0000000001d3', // version OF T.plain (binding-consistent)
  b1: '63000000-0000-4000-8000-0000000001d4', // FIRM-B version of T.b1
};
const P = {
  scope: '63000000-0000-4000-8000-000000000401', // SCH-04/05 scratch profile
  uniqNull: '63000000-0000-4000-8000-000000000402',
  approve: '63000000-0000-4000-8000-000000000403', // SCH-13 approval command target
};
const I = {
  four: '63000000-0000-4000-8000-000000000501', // 4-eyes skip-path instance
  regress: '63000000-0000-4000-8000-000000000502', // regression actors
  nullReviewer: '63000000-0000-4000-8000-000000000503', // fail-closed review exit
  unassigned: '63000000-0000-4000-8000-000000000504', // senior/article scoping target
  guard: '63000000-0000-4000-8000-000000000505', // SCH-08/09/12 scratch instance
  pin: '63000000-0000-4000-8000-000000000506', // TEST-SCH-14 pinned instance
};

const PARTNER_A = userId('USER_A_PARTNER');
const MANAGER_A = userId('USER_A_MANAGER');
const SENIOR_A = userId('USER_A_SENIOR');
const ARTICLE_A = userId('USER_A_ARTICLE');
const BILLING_A = userId('USER_A_BILLING');
const SUSPENDED_A = userId('USER_A_SUSPENDED');
const PARTNER_B = userId('USER_B_PARTNER');

/** Run a DO-free SQL batch, returning { ok, code, detail } — never throws on
 *  SQL errors so denial assertions can inspect the SQLSTATE/DETAIL. */
function attempt(sql: string): { ok: boolean; code: string; detail: string } {
  try {
    psql(`\\set VERBOSITY verbose\n${sql}`);
    return { ok: true, code: '', detail: '' };
  } catch (e) {
    const msg = String((e as { stderr?: string })?.stderr ?? e);
    const code = msg.match(/ERROR:\s+([0-9A-Z]{5}):/)?.[1] ?? '';
    const detail = msg.match(/DETAIL:\s*(\S+)/)?.[1] ?? '';
    return { ok: false, code, detail };
  }
}

/** Invoke a Layer-B command under a SIMULATED request context (psql-only;
 *  request.jwt.claims / request.headers are transaction-local GUCs). Returns
 *  the command's jsonb result. */
function rpcAs(user: string, firm: string, call: string): Record<string, unknown> {
  const out = psql(`
    begin;
    set local request.jwt.claims = '{"sub":"${user}","aal":"aal2","role":"authenticated"}';
    set local request.headers = '{"x-active-firm":"${firm}"}';
    select ${call};
    commit;
  `);
  const line = out.trim().split('\n').find((l) => l.startsWith('{'));
  return line ? JSON.parse(line) : {};
}

const TYPE_COLS =
  '(id, firm_id, type_key, name, category, frequency, due_rule, workflow_template, scope_kind, registration_class, governance_class, four_eyes_required)';

function cleanFixture() {
  psql(`
    delete from public.audit_log where firm_id in ('${FIRM_A}', '${FIRM_B}');
    delete from public.compliance_instances where firm_id in ('${FIRM_A}', '${FIRM_B}');
    delete from public.client_compliance_profiles where firm_id in ('${FIRM_A}', '${FIRM_B}');
    delete from public.compliance_rule_versions
      where compliance_type_id in ('${T.four}', '${T.full}', '${T.plain}', '${T.pin}', '${T.b1}');
    delete from public.compliance_types
      where id in ('${T.four}', '${T.full}', '${T.plain}', '${T.pin}', '${T.b1}');
    delete from public.registrations where firm_id in ('${FIRM_A}', '${FIRM_B}');
    delete from public.legal_entities where firm_id in ('${FIRM_A}', '${FIRM_B}');
    delete from public.clients where firm_id in ('${FIRM_A}', '${FIRM_B}');
    delete from public.firm_memberships where id in
      ('${M.partnerA}','${M.managerA}','${M.seniorA}','${M.articleA}','${M.billingA}',
       '${M.suspendedA}','${M.partnerB}');
  `);
}

beforeAll(() => {
  cleanFixture();
  psql(`
    insert into public.firms (id, name) values
      ('${FIRM_A}', 'IMP-031 Schema Firm A'),
      ('${FIRM_B}', 'IMP-031 Schema Firm B')
    on conflict (id) do nothing;

    insert into public.firm_memberships (id, firm_id, user_id, role, status) values
      ('${M.partnerA}',   '${FIRM_A}', '${PARTNER_A}',   'partner',     'active'),
      ('${M.managerA}',   '${FIRM_A}', '${MANAGER_A}',   'manager',     'active'),
      ('${M.seniorA}',    '${FIRM_A}', '${SENIOR_A}',    'senior',      'active'),
      ('${M.articleA}',   '${FIRM_A}', '${ARTICLE_A}',   'article_executive', 'active'),
      ('${M.billingA}',   '${FIRM_A}', '${BILLING_A}',   'billing',     'active'),
      ('${M.suspendedA}', '${FIRM_A}', '${SUSPENDED_A}', 'manager',     'suspended'),
      ('${M.partnerB}',   '${FIRM_B}', '${PARTNER_B}',   'partner',     'active')
    on conflict (firm_id, user_id) do nothing;

    insert into public.clients (id, firm_id, name, owner_partner_membership_id, manager_membership_id) values
      ('${C.a1}', '${FIRM_A}', 'CIN Schema Client A1', '${M.partnerA}', '${M.managerA}'),
      ('${C.a2}', '${FIRM_A}', 'CIN Schema Client A2', '${M.partnerA}', null),
      ('${C.b1}', '${FIRM_B}', 'CIN Schema Client B1', '${M.partnerB}', null);

    insert into public.legal_entities (id, firm_id, client_id, entity_type, legal_name) values
      ('${E.a1}', '${FIRM_A}', '${C.a1}', 'private_limited', 'CIN Entity A1'),
      ('${E.a2}', '${FIRM_A}', '${C.a1}', 'llp',             'CIN Entity A2'),
      ('${E.u1}', '${FIRM_A}', '${C.a2}', 'partnership',     'CIN Entity U1'),
      ('${E.b1}', '${FIRM_B}', '${C.b1}', 'private_limited', 'CIN Entity B1');

    insert into public.registrations (id, firm_id, legal_entity_id, type, value, state) values
      ('${REG.panA1}', '${FIRM_A}', '${E.a1}', 'PAN',   'SCHMA0000A',    null),
      ('${REG.tanA1}', '${FIRM_A}', '${E.a1}', 'TAN',   'SCHM00000A',    null),
      ('${REG.gstA1}', '${FIRM_A}', '${E.a1}', 'GSTIN', '27SCHA0000A1Z5', 'Maharashtra'),
      ('${REG.gstA2}', '${FIRM_A}', '${E.a2}', 'GSTIN', '27SCHA0000B1Z3', 'Maharashtra'),
      ('${REG.panB1}', '${FIRM_B}', '${E.b1}', 'PAN',   'SCHMB0000B',    null);

    insert into public.compliance_types ${TYPE_COLS} values
      -- four-eyes, entity scope, template SKIPS client_approval (RLS-4EY-02
      -- still binds the internal_review -> ready_to_file jump)
      ('${T.four}', '${FIRM_A}', 'sch31-four', 'SCH31 Four-Eyes', 'Certificates',
       'custom', '{}', '{"states":["not_started","preparation","internal_review","ready_to_file","filed","closed"]}',
       'entity', null, 'non_statutory', true),
      -- four-eyes, entity scope, client_approval present (legality fence)
      ('${T.full}', '${FIRM_A}', 'sch31-full', 'SCH31 Full Path', 'Certificates',
       'custom', '{}', '{"states":["not_started","preparation","internal_review","client_approval","ready_to_file","closed"]}',
       'entity', null, 'non_statutory', true),
      -- no four-eyes
      ('${T.plain}', '${FIRM_A}', 'sch31-plain', 'SCH31 Plain', 'Certificates',
       'custom', '{}', '{"states":["not_started","preparation","internal_review","ready_to_file","closed"]}',
       'entity', null, 'non_statutory', false),
      -- TEST-SCH-14 succession carrier
      ('${T.pin}', '${FIRM_A}', 'sch31-pin', 'SCH31 Pinned', 'Certificates',
       'annual', '{}', '{"states":["not_started","preparation","closed"]}',
       'entity', null, 'non_statutory', false),
      -- FIRM-B-owned type: cross-firm binding probes (DM-X-01)
      ('${T.b1}', '${FIRM_B}', 'sch31-b1', 'SCH31 Firm B Type', 'Certificates',
       'custom', '{}', '{"states":["not_started","preparation","closed"]}',
       'entity', null, 'non_statutory', false);

    insert into public.compliance_rule_versions
      (id, firm_id, compliance_type_id, version, effective_from, frequency, due_rule)
    values
      ('${V.pin1}', '${FIRM_A}', '${T.pin}', 1, '2026-04-01', 'annual', '{"description":"pin v1"}'),
      ('${V.pin2}', '${FIRM_A}', '${T.pin}', 2, '2027-04-01', 'annual', '{"description":"pin v2"}'),
      ('${V.plain1}', '${FIRM_A}', '${T.plain}', 1, '2026-04-01', 'custom', '{"description":"plain v1"}'),
      ('${V.b1}', '${FIRM_B}', '${T.b1}', 1, '2026-04-01', 'custom', '{"description":"b1 v1"}');
    -- Stage pin1 ACTIVE the way the Layer-B command would (transaction-local
    -- flag inside a DO block — never reachable from PostgREST).
    do $$ begin
      perform set_config('app.crv_lifecycle_command', '1', true);
      update public.compliance_rule_versions set status = 'active' where id = '${V.pin1}';
    end $$;

    -- TEST-SCH-13 instances (state not_started unless moved by a test).
    insert into public.compliance_instances
      (id, firm_id, legal_entity_id, compliance_type_id, period_start, period_end,
       period_label, due_date, assignee_membership_id, reviewer_membership_id)
    values
      ('${I.four}',         '${FIRM_A}', '${E.a1}', '${T.four}',  '2026-04-01', '2026-06-30', 'FY26 Q1', '2026-07-31', '${M.seniorA}', '${M.articleA}'),
      ('${I.regress}',      '${FIRM_A}', '${E.a1}', '${T.four}',  '2026-07-01', '2026-09-30', 'FY26 Q2', '2026-10-31', '${M.seniorA}', '${M.articleA}'),
      ('${I.nullReviewer}', '${FIRM_A}', '${E.a1}', '${T.four}',  '2026-10-01', '2026-12-31', 'FY26 Q3', '2027-01-31', '${M.seniorA}', null),
      ('${I.unassigned}',   '${FIRM_A}', '${E.a1}', '${T.plain}', '2026-04-01', '2026-06-30', 'FY26 Q1', '2026-07-31', null, null),
      ('${I.guard}',        '${FIRM_A}', '${E.a1}', '${T.plain}', '2027-01-01', '2027-03-31', 'FY26 Q4', '2027-04-30', null, null);

    -- TEST-SCH-14: instance pinned to pin1 with full recurrence provenance.
    insert into public.compliance_instances
      (id, firm_id, legal_entity_id, compliance_type_id, period_start, period_end,
       period_label, due_date, rule_version_id, generation_source, generated_at, calculated_due_date)
    values
      ('${I.pin}', '${FIRM_A}', '${E.a1}', '${T.pin}', '2026-04-01', '2027-03-31',
       'FY 2026-27', '2027-04-30', '${V.pin1}', 'recurrence', '2026-04-01T00:00:00Z', '2027-04-30');
  `);
});

afterAll(() => {
  cleanFixture();
  psql(`
    delete from public.firms where id in ('${FIRM_A}', '${FIRM_B}')
      and not exists (select 1 from public.firm_memberships m where m.firm_id = firms.id)
      and not exists (select 1 from public.clients c where c.firm_id = firms.id);
  `);
});

// ---------------------------------------------------------------------------
// Structural contract
// ---------------------------------------------------------------------------

describe('structural contract (SCH-11/SCH-12)', () => {
  it('both tables exist with the spec columns and composite-FK parent keys', () => {
    const cols = psql(`
      select table_name || ':' || string_agg(column_name, ',' order by column_name)
      from information_schema.columns
      where table_schema = 'public'
        and table_name in ('client_compliance_profiles', 'compliance_instances')
      group by table_name order by table_name;
    `);
    expect(cols).toContain(
      'client_compliance_profiles:applicability_answers,approved_at,approved_by,compliance_type_id,' +
        'created_at,firm_id,id,legal_entity_id,registration_id,status,updated_at',
    );
    expect(cols).toContain(
      'compliance_instances:assignee_membership_id,calculated_due_date,client_compliance_profile_id,' +
        'client_id,closed_at,compliance_type_id,created_at,due_date,engagement_id,filed_at,firm_id,' +
        'generated_at,generation_source,id,legal_entity_id,partner_membership_id,period_end,period_label,' +
        'period_meta,period_start,priority,registration_id,reviewer_membership_id,risk_factors,risk_score,' +
        'rule_version_id,state,successor_instance_id,updated_at',
    );
    const uniques = psql(`
      select conrelid::regclass::text || ':' || conname from pg_constraint
      where connamespace = 'public'::regnamespace and contype = 'u'
        and conrelid in ('public.client_compliance_profiles'::regclass, 'public.compliance_instances'::regclass)
      order by 1;
    `);
    expect(uniques).toContain('client_compliance_profiles:ccp_obligation_unique');
    expect(uniques).toContain('client_compliance_profiles:ccp_firm_id_unique');
    expect(uniques).toContain('compliance_instances:cin_obligation_period_unique');
    expect(uniques).toContain('compliance_instances:cin_firm_id_unique');
  });

  it('composite same-firm FKs make cross-firm references impossible at the constraint layer (SCH-FK-01/02)', () => {
    // Profile pointing at another firm's legal entity.
    const pXfirm = attempt(`
      insert into public.client_compliance_profiles (firm_id, legal_entity_id, compliance_type_id)
      values ('${FIRM_A}', '${E.b1}', '${SYS_ITR}');
    `);
    expect(pXfirm.ok).toBe(false);
    expect(pXfirm.code).toBe('23503');
    // Instance pointing at another firm's client via a same-firm entity id
    // that does not exist in firm A at all.
    const iXfirm = attempt(`
      insert into public.compliance_instances
        (firm_id, legal_entity_id, compliance_type_id, period_start, period_end, period_label, due_date)
      values ('${FIRM_A}', '${E.b1}', '${SYS_ITR}', '2026-04-01', '2026-06-30', 'x', '2026-07-31');
    `);
    expect(iXfirm.ok).toBe(false);
    expect(iXfirm.code).toBe('23503');
    // Responsibility memberships of another firm are rejected (composite FK).
    const iXmem = attempt(`
      insert into public.compliance_instances
        (firm_id, legal_entity_id, compliance_type_id, period_start, period_end, period_label, due_date,
         assignee_membership_id)
      values ('${FIRM_A}', '${E.a1}', '${T.plain}', '2028-01-01', '2028-03-31', 'x', '2028-04-30', '${M.partnerB}');
    `);
    expect(iXmem.ok).toBe(false);
    expect(iXmem.code).toBe('23503');
  });
});

// ---------------------------------------------------------------------------
// TEST-SCH-04 — registration-scope invariants (DM-27)
// ---------------------------------------------------------------------------

describe('TEST-SCH-04 — registration scope (DM-27, SCOPE_VIOLATION markers)', () => {
  it('entity-scoped types must carry NO registration', () => {
    const res = attempt(`
      insert into public.client_compliance_profiles (firm_id, legal_entity_id, compliance_type_id, registration_id)
      values ('${FIRM_A}', '${E.a1}', '${SYS_ITR}', '${REG.panA1}');
    `);
    expect(res.ok).toBe(false);
    expect(res.code).toBe('23514');
    expect(res.detail).toBe('SCOPE_VIOLATION:entity_scope');
  });

  it('registration-scoped types require a registration of the declared class', () => {
    const missing = attempt(`
      insert into public.client_compliance_profiles (firm_id, legal_entity_id, compliance_type_id)
      values ('${FIRM_A}', '${E.a1}', '${SYS_GSTR1}');
    `);
    expect(missing.ok).toBe(false);
    expect(missing.detail).toBe('SCOPE_VIOLATION:registration_required');

    const wrongClass = attempt(`
      insert into public.client_compliance_profiles (firm_id, legal_entity_id, compliance_type_id, registration_id)
      values ('${FIRM_A}', '${E.a1}', '${SYS_GSTR1}', '${REG.panA1}');
    `);
    expect(wrongClass.ok).toBe(false);
    expect(wrongClass.detail).toBe('SCOPE_VIOLATION:registration_class');

    const ok = attempt(`
      insert into public.client_compliance_profiles (id, firm_id, legal_entity_id, compliance_type_id, registration_id)
      values ('${P.scope}', '${FIRM_A}', '${E.a1}', '${SYS_GSTR1}', '${REG.gstA1}');
    `);
    expect(ok.ok).toBe(true);
    psql(`delete from public.client_compliance_profiles where id = '${P.scope}';`);
  });

  it('a registration of a DIFFERENT legal entity (same firm) is rejected', () => {
    const res = attempt(`
      insert into public.client_compliance_profiles (firm_id, legal_entity_id, compliance_type_id, registration_id)
      values ('${FIRM_A}', '${E.a1}', '${SYS_GSTR1}', '${REG.gstA2}');
    `);
    expect(res.ok).toBe(false);
    expect(res.detail).toBe('SCOPE_VIOLATION:registration.legal_entity');
  });

  it('TDS exception (positive): a TAN-class type accepts a TAN registration, or a PAN of the same entity', () => {
    const tan = attempt(`
      insert into public.client_compliance_profiles (id, firm_id, legal_entity_id, compliance_type_id, registration_id)
      values ('${P.scope}', '${FIRM_A}', '${E.a1}', '${SYS_TDS24Q}', '${REG.tanA1}');
    `);
    expect(tan.ok).toBe(true);
    const pan = attempt(`
      update public.client_compliance_profiles set registration_id = '${REG.panA1}' where id = '${P.scope}';
    `);
    expect(pan.ok).toBe(true);
    expect(
      psql(`select registration_id from public.client_compliance_profiles where id = '${P.scope}';`).trim(),
    ).toBe(REG.panA1);
  });

  it('TDS exception is NOT generalised: TAN-class + GSTIN rejected; GST-class + PAN rejected (on profile AND instance)', () => {
    const tdsGstin = attempt(`
      update public.client_compliance_profiles set registration_id = '${REG.gstA1}' where id = '${P.scope}';
    `);
    expect(tdsGstin.ok).toBe(false);
    expect(tdsGstin.detail).toBe('SCOPE_VIOLATION:registration_class');

    const gstPanInstance = attempt(`
      insert into public.compliance_instances
        (firm_id, legal_entity_id, compliance_type_id, registration_id,
         period_start, period_end, period_label, due_date)
      values ('${FIRM_A}', '${E.a1}', '${SYS_GSTR1}', '${REG.panA1}',
              '2026-04-01', '2026-04-30', 'Apr 2026', '2026-05-11');
    `);
    expect(gstPanInstance.ok).toBe(false);
    expect(gstPanInstance.detail).toBe('SCOPE_VIOLATION:registration_class');
    // cleanup of the scratch profile happens in the next describe's setup
  });

  it('TDS NULL-with-reason exception: instances only, non-empty reason required; profiles have NO null path', () => {
    const instance = attempt(`
      insert into public.compliance_instances (id, firm_id, legal_entity_id, compliance_type_id, registration_id,
        period_start, period_end, period_label, period_meta, due_date)
      values (gen_random_uuid(), '${FIRM_A}', '${E.a1}', '${SYS_TDS24Q}', null,
        '2026-04-01', '2026-06-30', 'FY26 Q1', '{"tds_pan_exception":"no TAN — PAN-based deduction only"}'::jsonb, '2026-07-31');
    `);
    expect(instance.ok).toBe(true);

    const noReason = attempt(`
      insert into public.compliance_instances (firm_id, legal_entity_id, compliance_type_id, registration_id,
        period_start, period_end, period_label, due_date)
      values ('${FIRM_A}', '${E.a2}', '${SYS_TDS24Q}', null,
        '2026-04-01', '2026-06-30', 'FY26 Q1', '2026-07-31');
    `);
    expect(noReason.ok).toBe(false);
    expect(noReason.detail).toBe('SCOPE_VIOLATION:registration_required');

    const emptyReason = attempt(`
      insert into public.compliance_instances (firm_id, legal_entity_id, compliance_type_id, registration_id,
        period_start, period_end, period_label, period_meta, due_date)
      values ('${FIRM_A}', '${E.a2}', '${SYS_TDS24Q}', null,
        '2026-04-01', '2026-06-30', 'FY26 Q1', '{"tds_pan_exception":""}'::jsonb, '2026-07-31');
    `);
    expect(emptyReason.ok).toBe(false);
    expect(emptyReason.detail).toBe('SCOPE_VIOLATION:registration_required');

    // The exception key does not rescue other classes (GSTIN type + NULL
    // even WITH the key present).
    const gstNullKeyed = attempt(`
      insert into public.compliance_instances (firm_id, legal_entity_id, compliance_type_id, registration_id,
        period_start, period_end, period_label, period_meta, due_date)
      values ('${FIRM_A}', '${E.a1}', '${SYS_GSTR1}', null,
        '2026-05-01', '2026-05-31', 'May 2026', '{"tds_pan_exception":"irrelevant here"}'::jsonb, '2026-06-11');
    `);
    expect(gstNullKeyed.ok).toBe(false);
    expect(gstNullKeyed.detail).toBe('SCOPE_VIOLATION:registration_required');

    // Profiles (p_allow_tds_null = false): no NULL path for a TAN-class type.
    const profileNull = attempt(`
      insert into public.client_compliance_profiles (firm_id, legal_entity_id, compliance_type_id)
      values ('${FIRM_A}', '${E.u1}', '${SYS_TDS24Q}');
    `);
    expect(profileNull.ok).toBe(false);
    expect(profileNull.detail).toBe('SCOPE_VIOLATION:registration_required');
  });

  it('configurable scope allows either form, still same-entity pinned', () => {
    const withReg = attempt(`
      insert into public.client_compliance_profiles (id, firm_id, legal_entity_id, compliance_type_id, registration_id)
      values (gen_random_uuid(), '${FIRM_A}', '${E.a1}', '${SYS_CERT}', '${REG.panA1}');
    `);
    expect(withReg.ok).toBe(true);
    const noReg = attempt(`
      insert into public.client_compliance_profiles (id, firm_id, legal_entity_id, compliance_type_id)
      values (gen_random_uuid(), '${FIRM_A}', '${E.a1}', '${SYS_CERT}');
    `);
    expect(noReg.ok).toBe(true);
    const otherEntity = attempt(`
      insert into public.client_compliance_profiles (firm_id, legal_entity_id, compliance_type_id, registration_id)
      values ('${FIRM_A}', '${E.a1}', '${SYS_CERT}', '${REG.gstA2}');
    `);
    expect(otherEntity.ok).toBe(false);
    expect(otherEntity.detail).toBe('SCOPE_VIOLATION:registration.legal_entity');
  });
});

// ---------------------------------------------------------------------------
// TEST-SCH-05 — NULLS NOT DISTINCT uniqueness (SCH-A-03, AUTO-REC-03 layer 3)
// ---------------------------------------------------------------------------

describe('TEST-SCH-05 — obligation uniqueness (NULLS NOT DISTINCT)', () => {
  it('profiles: one row per (legal_entity, type, registration) — NULL registration is a single key value', () => {
    psql(`
      delete from public.client_compliance_profiles where id in ('${P.scope}', '${P.uniqNull}');
      insert into public.client_compliance_profiles (id, firm_id, legal_entity_id, compliance_type_id)
      values ('${P.uniqNull}', '${FIRM_A}', '${E.u1}', '${SYS_ITR}');
    `);
    const dupNull = attempt(`
      insert into public.client_compliance_profiles (firm_id, legal_entity_id, compliance_type_id)
      values ('${FIRM_A}', '${E.u1}', '${SYS_ITR}');
    `);
    expect(dupNull.ok).toBe(false);
    expect(dupNull.code).toBe('23505');
  });

  it('instances: one row per (type, entity, registration, period_start); rule_version_id is EXCLUDED from the key', () => {
    // The fixture I.guard already holds (T.plain, E.a1, NULL, 2027-01-01)
    // with rule_version_id NULL (manual). A recurrence row for the SAME
    // obligation+period carrying a rule version must still conflict.
    const dup = attempt(`
      insert into public.compliance_instances
        (firm_id, legal_entity_id, compliance_type_id, registration_id,
         period_start, period_end, period_label, due_date,
         rule_version_id, generation_source, generated_at)
      values ('${FIRM_A}', '${E.a1}', '${T.plain}', null,
              '2027-01-01', '2027-03-31', 'FY26 Q4 dup', '2027-04-30',
              '${V.plain1}', 'recurrence', now());
    `);
    expect(dup.ok).toBe(false);
    expect(dup.code).toBe('23505');
    // A different period_start for the same obligation is a different key.
    const otherPeriod = attempt(`
      insert into public.compliance_instances
        (id, firm_id, legal_entity_id, compliance_type_id, registration_id,
         period_start, period_end, period_label, due_date)
      values (gen_random_uuid(), '${FIRM_A}', '${E.a1}', '${T.plain}', null,
              '2027-04-01', '2027-06-30', 'FY27 Q1', '2027-07-31');
    `);
    expect(otherPeriod.ok).toBe(true);
    psql(`delete from public.compliance_instances where period_label = 'FY27 Q1' and firm_id = '${FIRM_A}';`);
  });
});

// ---------------------------------------------------------------------------
// IMP-031 security-review regressions — write-path firm binding (DM-X-01).
// The gaps these pin let the pre-review bugs through: a foreign firm-owned
// type/rule version could be bound into this firm's rows.
// ---------------------------------------------------------------------------

describe('reference-data firm binding (DM-X-01, SCOPE_VIOLATION markers)', () => {
  it('cross-firm compliance TYPE binding is rejected on BOTH tables; same-firm and system-default bind', () => {
    const profile = attempt(`
      insert into public.client_compliance_profiles (firm_id, legal_entity_id, compliance_type_id)
      values ('${FIRM_A}', '${E.u1}', '${T.b1}');
    `);
    expect(profile.ok).toBe(false);
    expect(profile.code).toBe('23514');
    expect(profile.detail).toBe('SCOPE_VIOLATION:type_firm_binding');

    const instance = attempt(`
      insert into public.compliance_instances
        (firm_id, legal_entity_id, compliance_type_id, period_start, period_end, period_label, due_date)
      values ('${FIRM_A}', '${E.a1}', '${T.b1}', '2032-01-01', '2032-03-31', 'x', '2032-04-30');
    `);
    expect(instance.ok).toBe(false);
    expect(instance.code).toBe('23514');
    expect(instance.detail).toBe('SCOPE_VIOLATION:type_firm_binding');

    // Positive controls: a same-firm type and a system-default type bind.
    const sameFirm = attempt(`
      insert into public.compliance_instances
        (firm_id, legal_entity_id, compliance_type_id, period_start, period_end, period_label, due_date)
      values ('${FIRM_A}', '${E.a1}', '${T.plain}', '2032-01-01', '2032-03-31', 'x', '2032-04-30');
    `);
    expect(sameFirm.ok).toBe(true);
    const system = attempt(`
      insert into public.client_compliance_profiles (id, firm_id, legal_entity_id, compliance_type_id)
      values (gen_random_uuid(), '${FIRM_A}', '${E.a2}', '${SYS_CERT}');
    `);
    expect(system.ok).toBe(true);
    psql(`
      delete from public.compliance_instances where firm_id = '${FIRM_A}' and period_start = '2032-01-01';
      delete from public.client_compliance_profiles where firm_id = '${FIRM_A}' and legal_entity_id = '${E.a2}'
        and compliance_type_id = '${SYS_CERT}';
    `);
  });

  it('cross-firm rule VERSION binding and version/type mismatch are rejected; same-firm same-type version binds', () => {
    // A firm-B rule version can never proveance a firm-A instance.
    const xFirm = attempt(`
      insert into public.compliance_instances
        (firm_id, legal_entity_id, compliance_type_id, period_start, period_end, period_label, due_date,
         rule_version_id, generation_source, generated_at)
      values ('${FIRM_A}', '${E.a1}', '${T.plain}', '2033-01-01', '2033-03-31', 'x', '2033-04-30',
              '${V.b1}', 'recurrence', now());
    `);
    expect(xFirm.ok).toBe(false);
    expect(xFirm.code).toBe('23514');
    expect(xFirm.detail).toBe('SCOPE_VIOLATION:rule_version_binding');

    // A same-firm version of a DIFFERENT type is equally invalid.
    const mismatch = attempt(`
      insert into public.compliance_instances
        (firm_id, legal_entity_id, compliance_type_id, period_start, period_end, period_label, due_date,
         rule_version_id, generation_source, generated_at)
      values ('${FIRM_A}', '${E.a1}', '${T.plain}', '2033-01-01', '2033-03-31', 'x', '2033-04-30',
              '${V.pin1}', 'recurrence', now());
    `);
    expect(mismatch.ok).toBe(false);
    expect(mismatch.code).toBe('23514');
    expect(mismatch.detail).toBe('SCOPE_VIOLATION:rule_version_binding');

    // Positive control: same-firm version OF the row's own type binds.
    const ok = attempt(`
      insert into public.compliance_instances
        (firm_id, legal_entity_id, compliance_type_id, period_start, period_end, period_label, due_date,
         rule_version_id, generation_source, generated_at)
      values ('${FIRM_A}', '${E.a1}', '${T.plain}', '2033-01-01', '2033-03-31', 'x', '2033-04-30',
              '${V.plain1}', 'recurrence', now());
    `);
    expect(ok.ok).toBe(true);
    psql(`delete from public.compliance_instances where firm_id = '${FIRM_A}' and period_start = '2033-01-01';`);
  });
});

// ---------------------------------------------------------------------------
// TEST-SCH-08 — recurrence provenance (SCH-12, AUTO-REC-07)
// ---------------------------------------------------------------------------

describe('TEST-SCH-08 — provenance presence and immutability', () => {
  it('generation_source=recurrence REQUIRES rule_version_id and generated_at (CHECK)', () => {
    const noVersion = attempt(`
      insert into public.compliance_instances
        (firm_id, legal_entity_id, compliance_type_id, period_start, period_end, period_label, due_date,
         generation_source, generated_at)
      values ('${FIRM_A}', '${E.a1}', '${T.plain}', '2028-04-01', '2028-06-30', 'x', '2028-07-31',
              'recurrence', now());
    `);
    expect(noVersion.ok).toBe(false);
    expect(noVersion.code).toBe('23514');
    const noTimestamp = attempt(`
      insert into public.compliance_instances
        (firm_id, legal_entity_id, compliance_type_id, period_start, period_end, period_label, due_date,
         rule_version_id, generation_source)
      values ('${FIRM_A}', '${E.a1}', '${T.plain}', '2028-04-01', '2028-06-30', 'x', '2028-07-31',
              '${V.plain1}', 'recurrence');
    `);
    expect(noTimestamp.ok).toBe(false);
    expect(noTimestamp.code).toBe('23514');
  });

  it('manual rows default generation_source=manual and carry no recurrence provenance', () => {
    const row = psql(`
      select generation_source || '|' || coalesce(rule_version_id::text, '<null>') || '|' ||
             coalesce(generated_at::text, '<null>') || '|' || coalesce(calculated_due_date::text, '<null>')
      from public.compliance_instances where id = '${I.guard}';
    `).trim();
    expect(row).toBe('manual|<null>|<null>|<null>');
    // The recurrence-pinned fixture carries the full provenance set (control).
    const pinned = psql(`
      select generation_source || '|' || (rule_version_id is not null) || '|' || (generated_at is not null) || '|' || (calculated_due_date is not null)
      from public.compliance_instances where id = '${I.pin}';
    `).trim();
    expect(pinned).toBe('recurrence|true|true|true');
  });

  it('provenance fields reject UPDATE (IMMUTABLE_FIELD marker, 23514)', () => {
    for (const [column, value] of [
      ['rule_version_id', `'${V.pin2}'`],
      ['generation_source', `'import'`],
      ['generated_at', `now()`],
      ['calculated_due_date', `'2027-05-31'`],
    ] as Array<[string, string]>) {
      const res = attempt(`update public.compliance_instances set ${column} = ${value} where id = '${I.pin}';`);
      expect(res.ok).toBe(false);
      expect(res.code).toBe('23514');
      expect(res.detail).toBe('IMMUTABLE_FIELD:compliance_instances.provenance');
    }
    // The pinned row is untouched.
    const intact = psql(`
      select rule_version_id || '|' || generation_source || '|' || calculated_due_date
      from public.compliance_instances where id = '${I.pin}';
    `).trim();
    expect(intact).toBe(`${V.pin1}|recurrence|2027-04-30`);
  });

  it('the OPERATIVE due_date stays mutable (statutory extensions); calculated_due_date preserves the rule output', () => {
    psql(`update public.compliance_instances set due_date = '2027-05-15' where id = '${I.pin}';`);
    const row = psql(
      `select due_date || '|' || calculated_due_date from public.compliance_instances where id = '${I.pin}';`,
    ).trim();
    expect(row).toBe('2027-05-15|2027-04-30');
    psql(`update public.compliance_instances set due_date = '2027-04-30' where id = '${I.pin}';`);
  });
});

// ---------------------------------------------------------------------------
// TEST-SCH-09 — vocabularies and period CHECK
// ---------------------------------------------------------------------------

describe('TEST-SCH-09 — lifecycle vocabularies and period ordering', () => {
  it('compliance_instances.state rejects values outside the DM-SM-04 10-state vocabulary', () => {
    const res = attempt(`
      insert into public.compliance_instances
        (firm_id, legal_entity_id, compliance_type_id, period_start, period_end, period_label, due_date, state)
      values ('${FIRM_A}', '${E.a1}', '${T.plain}', '2029-01-01', '2029-03-31', 'x', '2029-04-30', 'teleported');
    `);
    expect(res.ok).toBe(false);
    expect(res.code).toBe('23514');
  });

  it('generation_source rejects values outside recurrence/manual/import', () => {
    const res = attempt(`
      insert into public.compliance_instances
        (firm_id, legal_entity_id, compliance_type_id, period_start, period_end, period_label, due_date, generation_source)
      values ('${FIRM_A}', '${E.a1}', '${T.plain}', '2029-01-01', '2029-03-31', 'x', '2029-04-30', 'magic');
    `);
    expect(res.ok).toBe(false);
    expect(res.code).toBe('23514');
  });

  it('period_end >= period_start is enforced', () => {
    const res = attempt(`
      insert into public.compliance_instances
        (firm_id, legal_entity_id, compliance_type_id, period_start, period_end, period_label, due_date)
      values ('${FIRM_A}', '${E.a1}', '${T.plain}', '2029-03-31', '2029-01-01', 'x', '2029-04-30');
    `);
    expect(res.ok).toBe(false);
    expect(res.code).toBe('23514');
  });

  it('client_compliance_profiles.status rejects values outside proposed/active/suspended/ended', () => {
    const res = attempt(`
      insert into public.client_compliance_profiles (firm_id, legal_entity_id, compliance_type_id, status)
      values ('${FIRM_A}', '${E.u1}', '${SYS_CERT}', 'live');
    `);
    expect(res.ok).toBe(false);
    expect(res.code).toBe('23514');
  });
});

// ---------------------------------------------------------------------------
// TEST-SCH-12 — client_id is trigger-derived (SCH-A-02)
// ---------------------------------------------------------------------------

describe('TEST-SCH-12 — client_id derivation and immutability', () => {
  it('insert derives client_id from the legal entity; a forged value is silently overwritten', () => {
    psql(`
      delete from public.compliance_instances where period_label = 'SCH12 forged' and firm_id = '${FIRM_A}';
      insert into public.compliance_instances
        (firm_id, client_id, legal_entity_id, compliance_type_id, period_start, period_end, period_label, due_date)
      values ('${FIRM_A}', '${C.b1}', '${E.a2}', '${T.plain}', '2030-01-01', '2030-03-31', 'SCH12 forged', '2030-04-30');
    `);
    const row = psql(`
      select client_id from public.compliance_instances
      where firm_id = '${FIRM_A}' and period_label = 'SCH12 forged';
    `).trim();
    // E.a2 belongs to client C.a1 — the forged C.b1 (another FIRM's client)
    // never lands.
    expect(row).toBe(C.a1);
    psql(`delete from public.compliance_instances where firm_id = '${FIRM_A}' and period_label = 'SCH12 forged';`);
  });

  it('every fixture instance is consistent with its legal entity (cross-entity consistency)', () => {
    const mismatches = psql(`
      select count(*) from public.compliance_instances i
      join public.legal_entities le on le.firm_id = i.firm_id and le.id = i.legal_entity_id
      where i.firm_id in ('${FIRM_A}', '${FIRM_B}') and i.client_id is distinct from le.client_id;
    `).trim();
    expect(mismatches).toBe('0');
  });

  it('client_id and the identity/period set are insert-only (IMMUTABLE_FIELD marker)', () => {
    for (const [column, value] of [
      ['client_id', `'${C.a2}'`],
      ['firm_id', `'${FIRM_B}'`],
      ['legal_entity_id', `'${E.a2}'`],
      ['compliance_type_id', `'${T.four}'`],
      ['registration_id', `'${REG.panA1}'`],
      ['period_start', `'2027-02-01'`],
      ['period_end', `'2027-02-28'`],
    ] as Array<[string, string]>) {
      const res = attempt(`update public.compliance_instances set ${column} = ${value} where id = '${I.guard}';`);
      expect(res.ok).toBe(false);
      expect(res.code).toBe('23514');
      expect(res.detail).toBe('IMMUTABLE_FIELD:compliance_instances.identity');
    }
    const intact = psql(
      `select client_id || '|' || legal_entity_id || '|' || period_start from public.compliance_instances where id = '${I.guard}';`,
    ).trim();
    expect(intact).toBe(`${C.a1}|${E.a1}|2027-01-01`);
  });
});

// ---------------------------------------------------------------------------
// TEST-SCH-13 — four-eyes + transition authorization at the SQL/RPC level
// (RLS-CIN-01 T1, RLS-4EY-01/02; simulated request contexts, psql-only)
// ---------------------------------------------------------------------------

describe('TEST-SCH-13 — four-eyes and transition authorization (RPC level)', () => {
  it('write-time four-eyes: reviewer must differ from assignee where the type requires it (insert AND update)', () => {
    const insert = attempt(`
      insert into public.compliance_instances
        (firm_id, legal_entity_id, compliance_type_id, period_start, period_end, period_label, due_date,
         assignee_membership_id, reviewer_membership_id)
      values ('${FIRM_A}', '${E.a1}', '${T.four}', '2031-01-01', '2031-03-31', 'x', '2031-04-30',
              '${M.seniorA}', '${M.seniorA}');
    `);
    expect(insert.ok).toBe(false);
    expect(insert.detail).toBe('FOUR_EYES:compliance_instances.assignments');

    const update = attempt(`
      update public.compliance_instances set reviewer_membership_id = '${M.seniorA}' where id = '${I.four}';
    `);
    expect(update.ok).toBe(false);
    expect(update.detail).toBe('FOUR_EYES:compliance_instances.assignments');
  });

  it('non-ACTIVE responsibility memberships are rejected at write time (SCH-RESP-03)', () => {
    const res = attempt(`
      insert into public.compliance_instances
        (firm_id, legal_entity_id, compliance_type_id, period_start, period_end, period_label, due_date,
         assignee_membership_id)
      values ('${FIRM_A}', '${E.a1}', '${T.plain}', '2031-04-01', '2031-06-30', 'x', '2031-07-31',
              '${M.suspendedA}');
    `);
    expect(res.ok).toBe(false);
    expect(res.code).toBe('23503');
  });

  it('direct state UPDATE is denied even for the owner role (single-writer marker, INVALID_TRANSITION)', () => {
    const res = attempt(`update public.compliance_instances set state = 'preparation' where id = '${I.guard}';`);
    expect(res.ok).toBe(false);
    expect(res.code).toBe('23514');
    expect(res.detail).toBe('INVALID_TRANSITION:compliance_instances.state');
    const markers = attempt(`update public.compliance_instances set filed_at = now() where id = '${I.guard}';`);
    expect(markers.ok).toBe(false);
    expect(markers.detail).toBe('IMMUTABLE_FIELD:compliance_instances.lifecycle_markers');
    expect(psql(`select state from public.compliance_instances where id = '${I.guard}';`).trim()).toBe('not_started');
  });

  it('direct profile activation and approval-stamp writes are denied (INVALID_TRANSITION / IMMUTABLE_FIELD)', () => {
    psql(`
      delete from public.client_compliance_profiles where id = '${P.approve}';
      insert into public.client_compliance_profiles (id, firm_id, legal_entity_id, compliance_type_id)
      values ('${P.approve}', '${FIRM_A}', '${E.u1}', '${SYS_CERT}');
    `);
    const activate = attempt(`update public.client_compliance_profiles set status = 'active' where id = '${P.approve}';`);
    expect(activate.ok).toBe(false);
    expect(activate.detail).toBe('INVALID_TRANSITION:client_compliance_profiles.status');
    const stamp = attempt(`update public.client_compliance_profiles set approved_by = '${PARTNER_A}' where id = '${P.approve}';`);
    expect(stamp.ok).toBe(false);
    expect(stamp.detail).toBe('IMMUTABLE_FIELD:client_compliance_profiles.approval');
    // Non-active status moves remain ordinary updates.
    const suspend = attempt(`update public.client_compliance_profiles set status = 'suspended' where id = '${P.approve}';`);
    expect(suspend.ok).toBe(true);
    psql(`update public.client_compliance_profiles set status = 'proposed' where id = '${P.approve}';`);
  });

  it('happy path: assignee walks the instance into internal_review (senior, in scope as assignee)', () => {
    let res = rpcAs(SENIOR_A, FIRM_A, `public.transition_compliance_instance('${I.four}', 'preparation', null)`);
    expect(res.status).toBe('transitioned');
    res = rpcAs(SENIOR_A, FIRM_A, `public.transition_compliance_instance('${I.four}', 'internal_review', null)`);
    expect(res.status).toBe('transitioned');
    expect(psql(`select state from public.compliance_instances where id = '${I.four}';`).trim()).toBe('internal_review');
  });

  it('review exit by NON-reviewer is denied — no rank bypass for partner/manager, assignee included', () => {
    for (const [user, label] of [
      [PARTNER_A, 'partner'],
      [MANAGER_A, 'in-scope manager'],
      [SENIOR_A, 'assignee senior'],
    ] as Array<[string, string]>) {
      const res = rpcAs(user, FIRM_A, `public.transition_compliance_instance('${I.four}', 'ready_to_file', null)`);
      expect(res.status, label).toBe('denied');
      expect(res.kind, label).toBe('unauthorized');
      expect(String(res.message), label).toContain('assigned reviewer');
    }
    expect(psql(`select state from public.compliance_instances where id = '${I.four}';`).trim()).toBe('internal_review');
  });

  it('review exit by the ASSIGNED REVIEWER succeeds — including the client_approval-skip path (RLS-4EY-02)', () => {
    // T.four's template skips client_approval: internal_review ->
    // ready_to_file is the next template state and still reviewer-only.
    const res = rpcAs(ARTICLE_A, FIRM_A, `public.transition_compliance_instance('${I.four}', 'ready_to_file', 'sch13-mk-1')`);
    expect(res.status).toBe('transitioned');
    expect(res.from_state).toBe('internal_review');
    expect(res.to_state).toBe('ready_to_file');
  });

  it('mutation-key idempotency: replay against the current state returns already_applied, no second mutation', () => {
    const res = rpcAs(ARTICLE_A, FIRM_A, `public.transition_compliance_instance('${I.four}', 'ready_to_file', 'sch13-mk-1')`);
    expect(res.status).toBe('already_applied');
    // Same-state WITHOUT a key is an ordinary invalid transition (conflict).
    const noKey = rpcAs(ARTICLE_A, FIRM_A, `public.transition_compliance_instance('${I.four}', 'ready_to_file', null)`);
    expect(noKey.status).toBe('denied');
    expect(noKey.kind).toBe('conflict');
    expect(psql(`select state from public.compliance_instances where id = '${I.four}';`).trim()).toBe('ready_to_file');
  });

  it('non-review exits are not four-eyes bound: partner files and closes; lifecycle markers are stamped', () => {
    const filed = rpcAs(PARTNER_A, FIRM_A, `public.transition_compliance_instance('${I.four}', 'filed', null)`);
    expect(filed.status).toBe('transitioned');
    const inst = filed.instance as { filed_at: string | null };
    expect(inst.filed_at).not.toBeNull();
    const closed = rpcAs(PARTNER_A, FIRM_A, `public.transition_compliance_instance('${I.four}', 'closed', null)`);
    expect(closed.status).toBe('transitioned');
    expect((closed.instance as { closed_at: string | null }).closed_at).not.toBeNull();
  });

  it('regression internal_review -> preparation: assigned reviewer or in-scope manager+; assignee-only staff denied', () => {
    // Drive the regression fixture into internal_review.
    rpcAs(SENIOR_A, FIRM_A, `public.transition_compliance_instance('${I.regress}', 'preparation', null)`);
    rpcAs(SENIOR_A, FIRM_A, `public.transition_compliance_instance('${I.regress}', 'internal_review', null)`);
    // Assignee-only senior may NOT send work back.
    const byAssignee = rpcAs(SENIOR_A, FIRM_A, `public.transition_compliance_instance('${I.regress}', 'preparation', null)`);
    expect(byAssignee.status).toBe('denied');
    expect(byAssignee.kind).toBe('unauthorized');
    // The assigned reviewer may.
    const byReviewer = rpcAs(ARTICLE_A, FIRM_A, `public.transition_compliance_instance('${I.regress}', 'preparation', null)`);
    expect(byReviewer.status).toBe('transitioned');
    expect(byReviewer.to_state).toBe('preparation');
    // Back into review; an in-scope manager+ actor may also regress.
    rpcAs(SENIOR_A, FIRM_A, `public.transition_compliance_instance('${I.regress}', 'internal_review', null)`);
    const byManager = rpcAs(MANAGER_A, FIRM_A, `public.transition_compliance_instance('${I.regress}', 'preparation', null)`);
    expect(byManager.status).toBe('transitioned');
  });

  it('a NULL reviewer fail-closes the review exit until one is assigned', () => {
    rpcAs(SENIOR_A, FIRM_A, `public.transition_compliance_instance('${I.nullReviewer}', 'preparation', null)`);
    rpcAs(SENIOR_A, FIRM_A, `public.transition_compliance_instance('${I.nullReviewer}', 'internal_review', null)`);
    const res = rpcAs(PARTNER_A, FIRM_A, `public.transition_compliance_instance('${I.nullReviewer}', 'ready_to_file', null)`);
    expect(res.status).toBe('denied');
    expect(res.kind).toBe('unauthorized');
    // The permitted non-state update path assigns a reviewer (manager+).
    psql(`update public.compliance_instances set reviewer_membership_id = '${M.articleA}' where id = '${I.nullReviewer}';`);
    const ok = rpcAs(ARTICLE_A, FIRM_A, `public.transition_compliance_instance('${I.nullReviewer}', 'ready_to_file', null)`);
    expect(ok.status).toBe('transitioned');
  });

  it('legality: template states may be SKIPPED, never jumped over or reordered (DM-SM-04)', () => {
    // I.unassigned sits at not_started under T.plain
    // ([not_started, preparation, internal_review, ready_to_file, closed]).
    const skip = rpcAs(PARTNER_A, FIRM_A, `public.transition_compliance_instance('${I.unassigned}', 'internal_review', null)`);
    expect(skip.status).toBe('denied');
    expect(skip.kind).toBe('conflict'); // preparation is in the template and must be stepped through
    const backward = rpcAs(PARTNER_A, FIRM_A, `public.transition_compliance_instance('${I.unassigned}', 'information_received', null)`);
    expect(backward.status).toBe('denied'); // not in the template at all
    expect(backward.kind).toBe('conflict');
    const unknown = rpcAs(PARTNER_A, FIRM_A, `public.transition_compliance_instance('${I.unassigned}', 'teleported', null)`);
    expect(unknown.status).toBe('denied');
    expect(unknown.kind).toBe('validation'); // CA400 malformed input, un-audited
    const legal = rpcAs(PARTNER_A, FIRM_A, `public.transition_compliance_instance('${I.unassigned}', 'preparation', null)`);
    expect(legal.status).toBe('transitioned');
  });

  it('senior/article scope: transition rights only as the CURRENT assignee/reviewer (RLS-CIN-01 T1)', () => {
    // I.unassigned has no assignee/reviewer: senior is out of scope — a
    // PRE-authorization denial, so the API-ERR-02 not_found surface (the
    // IMP-031 security review closed the NULL-slot scope hole; existing-row
    // denials are audited server-side — see the audit suite).
    const res = rpcAs(SENIOR_A, FIRM_A, `public.transition_compliance_instance('${I.unassigned}', 'internal_review', null)`);
    expect(res.status).toBe('denied');
    expect(res.kind).toBe('not_found');
    // Billing has no transition right anywhere — same not_found surface.
    const billing = rpcAs(BILLING_A, FIRM_A, `public.transition_compliance_instance('${I.unassigned}', 'internal_review', null)`);
    expect(billing.status).toBe('denied');
    expect(billing.kind).toBe('not_found');
  });

  it('context discipline: foreign-firm selector or foreign instance is denied; all share ONE not_found surface (API-ERR-02)', () => {
    // I.guard is untouched by the lifecycle tests (state not_started), so a
    // context-mismatch denial cannot be masked by a same-state conflict.
    const wrongCtx = rpcAs(PARTNER_A, FIRM_B, `public.transition_compliance_instance('${I.guard}', 'preparation', null)`);
    expect(wrongCtx.status).toBe('denied');
    expect(wrongCtx.kind).toBe('not_found');
    const missing = rpcAs(PARTNER_A, FIRM_A, `public.transition_compliance_instance('99999999-9999-4999-8999-999999999999', 'preparation', null)`);
    expect(missing.status).toBe('denied');
    expect(missing.kind).toBe('not_found');
    // Existence-oracle uniformity: the wrong-context denial of an EXISTING
    // row is byte-identical to the nonexistent-id response.
    expect(JSON.stringify(wrongCtx)).toBe(JSON.stringify(missing));
  });

  it('approval command: proposed -> active stamps approved_by/approved_at and creates NO instances (C5 ruling)', () => {
    const before = psql(
      `select count(*) from public.compliance_instances where firm_id = '${FIRM_A}';`,
    ).trim();
    const res = rpcAs(PARTNER_A, FIRM_A, `public.approve_client_compliance_profile('${P.approve}')`);
    expect(res.status).toBe('approved');
    const profile = res.profile as { status: string; approved_by: string; approved_at: string | null };
    expect(profile.status).toBe('active');
    expect(profile.approved_by).toBe(PARTNER_A);
    expect(profile.approved_at).not.toBeNull();
    const after = psql(
      `select count(*) from public.compliance_instances where firm_id = '${FIRM_A}';`,
    ).trim();
    expect(after).toBe(before);
    // Re-approval is a conflict (only proposed profiles can be approved).
    const again = rpcAs(PARTNER_A, FIRM_A, `public.approve_client_compliance_profile('${P.approve}')`);
    expect(again.status).toBe('denied');
    expect(again.kind).toBe('conflict');
  });
});

// ---------------------------------------------------------------------------
// TEST-SCH-14 — rule-version pinning stability (AUTO-REC-07, SCH-32)
// ---------------------------------------------------------------------------

describe('TEST-SCH-14 — pinning stability across rule succession', () => {
  it('succession via the REAL activation command leaves the instance pinned to its original version + provenance', () => {
    const before = psql(`
      select rule_version_id || '|' || generation_source || '|' || generated_at || '|' || calculated_due_date
      from public.compliance_instances where id = '${I.pin}';
    `).trim();

    // Genuine succession through the IMP-030 Layer-B command under a
    // simulated aal2 partner context (audit.test.ts GUC precedent).
    const res = rpcAs(PARTNER_A, FIRM_A, `public.activate_compliance_rule_version('${V.pin2}')`);
    expect(res.status).toBe('activated');
    const pred = res.predecessor as { id: string; status: string; effective_to: string };
    expect(pred.id).toBe(V.pin1);
    expect(pred.status).toBe('active'); // predecessor stays active for its historical window
    expect(pred.effective_to).toBe('2027-04-01');

    const after = psql(`
      select rule_version_id || '|' || generation_source || '|' || generated_at || '|' || calculated_due_date
      from public.compliance_instances where id = '${I.pin}';
    `).trim();
    expect(after).toBe(before);
    expect(after.startsWith(`${V.pin1}|recurrence|`)).toBe(true);

    // The historical version remains referentially valid (FK target intact).
    const fk = psql(`
      select count(*) from public.compliance_instances i
      join public.compliance_rule_versions v on v.id = i.rule_version_id
      where i.id = '${I.pin}' and v.id = '${V.pin1}' and v.status = 'active';
    `).trim();
    expect(fk).toBe('1');
  });
});
