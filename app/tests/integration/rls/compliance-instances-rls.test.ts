/**
 * IMP-031 — Compliance profiles & instances RLS integration tests
 * (SCH-11, SCH-12, RLS-CCP-01, RLS-CIN-01 incl. the T1 transition matrix,
 * RLS-4EY-01/02, RLS-STF-03/07, RLS-CTX-01/02).
 *
 * Exercises the REAL production policies on public.client_compliance_profiles
 * and public.compliance_instances plus the Layer-B commands
 * approve_client_compliance_profile() / transition_compliance_instance()
 * through PostgREST with signed-in access tokens — never service-role for
 * authorization assertions. Service-side psql is used only for fixture
 * setup, controlled membership mutation, operator-path staging (the
 * pre-active profile, staged via the transaction-local command flag inside
 * a DO block — never reachable from PostgREST), and teardown.
 *
 * Role posture under test (05 §11, RLS-CCP-01, RLS-CIN-01):
 *   super_admin/partner — firm-wide read + write, firm-wide transitions;
 *   manager             — portfolio read/write, portfolio transitions
 *                         (RLS-STF-03);
 *   senior/article      — assigned-work read (assignee/reviewer), no direct
 *                         table mutation, transitions only as the CURRENT
 *                         assignee/reviewer;
 *   billing             — nothing (no projection RPC exists in R0);
 *   suspended/removed   — nothing, live on the same JWT (TEST-AUTH-12/13);
 *   anon                — nothing.
 *
 * TEST mapping (spec 11 + 05 §14):
 *   TEST-RLS-MAT-01…03 — role-matrix cells for both tables;
 *   TEST-RLS-GEN-01 fixture tenants / GEN-02 offensive posture (known
 *   foreign ids, forged selector, forged firm_id) / GEN-03 case set
 *   (suspension, removal, multi-firm switching) / GEN-04 mutation-denial
 *   surfacing (authorization errors or verified silent zero-rows, never
 *   silent success);
 *   TEST-RLS-4EY-01 — four-eyes enforced server-side, no rank bypass.
 *
 * Re-runnable: deterministic ids in the 64000000-… range, force-reset on
 * every run; fixture audit rows removed as the operator in teardown
 * (append-only applies to application roles, AUD-INV-01).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { api, FIRM_A, FIRM_B, psql, signIn, userEmail, userId } from '../helpers.mjs';

const H = (firm: string) => ({ 'x-active-firm': firm });

/** The ONE pre-authorization denial surface of transition_compliance_instance
 *  (API-ERR-02): nonexistent, foreign, and out-of-scope instances all return
 *  exactly this body — no existence oracle, no instance payload. */
const NOT_FOUND_BODY = {
  status: 'denied',
  kind: 'not_found',
  message: 'compliance instance not found',
};

/** The same uniform pre-authorization surface of approve_client_compliance_profile
 *  (API-ERR-02): nonexistent, foreign, and out-of-scope profiles are
 *  indistinguishable. */
const PROFILE_NOT_FOUND_BODY = {
  status: 'denied',
  kind: 'not_found',
  message: 'compliance profile not found',
};

// Seeded system-default compliance types (reference data, both firms usable).
const SYS_TDS24Q = '50000000-0000-4000-8000-000000000003'; // registration / TAN, 4-eyes
const SYS_ITR = '50000000-0000-4000-8000-000000000005'; // entity scope, 4-eyes, full path

const M = {
  partnerA: '64000000-0000-4000-8000-000000000001',
  superA: '64000000-0000-4000-8000-000000000002',
  managerA: '64000000-0000-4000-8000-000000000003',
  managerBInA: '64000000-0000-4000-8000-000000000004',
  seniorA: '64000000-0000-4000-8000-000000000005',
  articleA: '64000000-0000-4000-8000-000000000006',
  billingA: '64000000-0000-4000-8000-000000000007',
  suspendedA: '64000000-0000-4000-8000-000000000008',
  removedA: '64000000-0000-4000-8000-000000000009',
  multiA: '64000000-0000-4000-8000-00000000000a',
  partnerB: '64000000-0000-4000-8000-00000000000b',
  multiB: '64000000-0000-4000-8000-00000000000c',
};
const C = {
  inPortfolio: '64000000-0000-4000-8000-000000000101', // manager = managerA
  otherManaged: '64000000-0000-4000-8000-000000000102', // manager = managerBInA
  multiManaged: '64000000-0000-4000-8000-000000000103', // manager = multiA
  firmB: '64000000-0000-4000-8000-000000000111',
};
const E = {
  inPortfolio: '64000000-0000-4000-8000-000000000201',
  otherManaged: '64000000-0000-4000-8000-000000000202',
  multiManaged: '64000000-0000-4000-8000-000000000203',
  firmB: '64000000-0000-4000-8000-000000000211',
};
const REG = {
  tanIn: '64000000-0000-4000-8000-000000000301',
  panIn: '64000000-0000-4000-8000-000000000302',
};
const T = {
  // firm A, NO four-eyes, entity scope
  plain: '64000000-0000-4000-8000-0000000000c1',
  // firm A, four-eyes, entity scope, template SKIPS client_approval
  skipFour: '64000000-0000-4000-8000-0000000000c2',
};
const P = {
  tdsIn: '64000000-0000-4000-8000-000000000401', // proposed, partner approval target
  itrIn: '64000000-0000-4000-8000-000000000402', // proposed, manager in-portfolio target
  out: '64000000-0000-4000-8000-000000000403', // proposed, out-of-portfolio
  activeIn: '64000000-0000-4000-8000-000000000404', // pre-ACTIVE (operator-staged)
  firmB: '64000000-0000-4000-8000-000000000411',
};
const I = {
  assigned: '64000000-0000-4000-8000-000000000501', // T.plain E.in assignee=senior reviewer=article
  manager: '64000000-0000-4000-8000-000000000502', // T.plain E.in, unassigned — manager/partner battery
  out: '64000000-0000-4000-8000-000000000503', // T.plain E.otherManaged
  four: '64000000-0000-4000-8000-000000000504', // T.skipFour E.in assignee=senior reviewer=article
  fourNoRev: '64000000-0000-4000-8000-000000000505', // T.skipFour E.in assignee=senior reviewer=NULL
  regress: '64000000-0000-4000-8000-000000000506', // T.skipFour E.in assignee=senior reviewer=article
  otherAssigned: '64000000-0000-4000-8000-000000000507', // T.plain E.in assignee=article reviewer=manager
  unassigned: '64000000-0000-4000-8000-000000000508', // T.plain E.in, NO responsibility at all
  multi: '64000000-0000-4000-8000-000000000509', // T.plain E.multiManaged
  firmB: '64000000-0000-4000-8000-000000000511', // SYS_ITR E.firmB
};

const PARTNER_A = userId('USER_A_PARTNER');
const SUPER_ADMIN_A = userId('USER_A_SUPER_ADMIN');
const MANAGER_A = userId('USER_A_MANAGER');
const MANAGER_B = userId('USER_B_MANAGER');
const SENIOR_A = userId('USER_A_SENIOR');
const ARTICLE_A = userId('USER_A_ARTICLE');
const BILLING_A = userId('USER_A_BILLING');
const SUSPENDED_A = userId('USER_A_SUSPENDED');
const REMOVED_A = userId('USER_A_REMOVED');
const MULTI = userId('USER_MULTI_FIRM');
const PARTNER_B = userId('USER_B_PARTNER');

let partnerA: string;
let superAdminA: string;
let managerA: string;
let seniorA: string;
let articleA: string;
let billingA: string;
let suspendedA: string;
let removedA: string;
let multiFirm: string;
let partnerB: string;

function cleanRows() {
  psql(`
    delete from public.audit_log where firm_id in ('${FIRM_A}', '${FIRM_B}');
    delete from public.compliance_instances where firm_id in ('${FIRM_A}', '${FIRM_B}');
    delete from public.client_compliance_profiles where firm_id in ('${FIRM_A}', '${FIRM_B}');
    delete from public.compliance_rule_versions where compliance_type_id in ('${T.plain}', '${T.skipFour}');
    delete from public.compliance_types where id in ('${T.plain}', '${T.skipFour}');
    delete from public.registrations where firm_id in ('${FIRM_A}', '${FIRM_B}');
    delete from public.legal_entities where firm_id in ('${FIRM_A}', '${FIRM_B}');
    delete from public.clients where firm_id in ('${FIRM_A}', '${FIRM_B}');
    delete from public.firm_memberships where id in
      ('${M.partnerA}','${M.superA}','${M.managerA}','${M.managerBInA}','${M.seniorA}','${M.articleA}',
       '${M.billingA}','${M.suspendedA}','${M.removedA}','${M.multiA}','${M.partnerB}','${M.multiB}');
  `);
}

function seedFixture() {
  cleanRows();
  psql(`
    insert into public.firms (id, name) values
      ('${FIRM_A}', 'IMP-031 RLS Firm A'),
      ('${FIRM_B}', 'IMP-031 RLS Firm B')
    on conflict (id) do nothing;

    insert into public.firm_memberships (id, firm_id, user_id, role, status) values
      ('${M.partnerA}',    '${FIRM_A}', '${PARTNER_A}',     'partner',     'active'),
      ('${M.superA}',      '${FIRM_A}', '${SUPER_ADMIN_A}', 'super_admin', 'active'),
      ('${M.managerA}',    '${FIRM_A}', '${MANAGER_A}',     'manager',     'active'),
      ('${M.managerBInA}', '${FIRM_A}', '${MANAGER_B}',     'manager',     'active'),
      ('${M.seniorA}',     '${FIRM_A}', '${SENIOR_A}',      'senior',      'active'),
      ('${M.articleA}',    '${FIRM_A}', '${ARTICLE_A}',     'article_executive', 'active'),
      ('${M.billingA}',    '${FIRM_A}', '${BILLING_A}',     'billing',     'active'),
      ('${M.suspendedA}',  '${FIRM_A}', '${SUSPENDED_A}',   'senior',      'suspended'),
      ('${M.removedA}',    '${FIRM_A}', '${REMOVED_A}',     'senior',      'removed'),
      ('${M.multiA}',      '${FIRM_A}', '${MULTI}',         'manager',     'active'),
      ('${M.partnerB}',    '${FIRM_B}', '${PARTNER_B}',     'partner',     'active'),
      ('${M.multiB}',      '${FIRM_B}', '${MULTI}',         'senior',      'active')
    on conflict (firm_id, user_id) do nothing;

    -- Force-reset mutable state so re-runs are deterministic even if a
    -- previous run mutated status mid-flight (freshness cases).
    update public.firm_memberships set status = 'active' where id in ('${M.partnerA}', '${M.managerA}');
    update public.firm_memberships set status = 'suspended' where id = '${M.suspendedA}';
    update public.firm_memberships set status = 'removed' where id = '${M.removedA}';

    insert into public.clients (id, firm_id, name, owner_partner_membership_id, manager_membership_id) values
      ('${C.inPortfolio}',  '${FIRM_A}', 'CIN RLS InPortfolio',  '${M.partnerA}', '${M.managerA}'),
      ('${C.otherManaged}', '${FIRM_A}', 'CIN RLS OtherManaged', '${M.partnerA}', '${M.managerBInA}'),
      ('${C.multiManaged}', '${FIRM_A}', 'CIN RLS MultiManaged', '${M.partnerA}', '${M.multiA}'),
      ('${C.firmB}',        '${FIRM_B}', 'CIN RLS FirmB',        '${M.partnerB}', null);

    insert into public.legal_entities (id, firm_id, client_id, entity_type, legal_name) values
      ('${E.inPortfolio}',  '${FIRM_A}', '${C.inPortfolio}',  'private_limited', 'CIN Entity In'),
      ('${E.otherManaged}', '${FIRM_A}', '${C.otherManaged}', 'llp',             'CIN Entity Out'),
      ('${E.multiManaged}', '${FIRM_A}', '${C.multiManaged}', 'partnership',     'CIN Entity Multi'),
      ('${E.firmB}',        '${FIRM_B}', '${C.firmB}',        'private_limited', 'CIN Entity B');

    insert into public.registrations (id, firm_id, legal_entity_id, type, value) values
      ('${REG.tanIn}', '${FIRM_A}', '${E.inPortfolio}', 'TAN', 'RLSM00000A'),
      ('${REG.panIn}', '${FIRM_A}', '${E.inPortfolio}', 'PAN', 'RLSMA0000A');

    insert into public.compliance_types
      (id, firm_id, type_key, name, category, frequency, due_rule, workflow_template,
       scope_kind, registration_class, governance_class, four_eyes_required)
    values
      ('${T.plain}', '${FIRM_A}', 'rls31-plain', 'RLS31 Plain', 'Certificates',
       'custom', '{}', '{"states":["not_started","preparation","internal_review","ready_to_file","closed"]}',
       'entity', null, 'non_statutory', false),
      ('${T.skipFour}', '${FIRM_A}', 'rls31-skip-four', 'RLS31 Skip-Four', 'Certificates',
       'custom', '{}', '{"states":["not_started","preparation","internal_review","ready_to_file","closed"]}',
       'entity', null, 'non_statutory', true);

    insert into public.client_compliance_profiles
      (id, firm_id, legal_entity_id, compliance_type_id, registration_id, applicability_answers)
    values
      ('${P.tdsIn}', '${FIRM_A}', '${E.inPortfolio}',  '${SYS_TDS24Q}', '${REG.tanIn}', '{"salaried":true}'),
      ('${P.itrIn}', '${FIRM_A}', '${E.inPortfolio}',  '${SYS_ITR}',    null,           null),
      ('${P.out}',   '${FIRM_A}', '${E.otherManaged}', '${SYS_ITR}',    null,           null),
      ('${P.activeIn}', '${FIRM_A}', '${E.multiManaged}', '${SYS_ITR}', null,           null),
      ('${P.firmB}', '${FIRM_B}', '${E.firmB}',        '${SYS_ITR}',    null,           null);

    -- Operator-staged ACTIVE profile (re-approval conflict target). The
    -- transaction-local command flag lives inside the DO block — the same
    -- staging precedent as the IMP-030 schema suite; never a request path.
    do $$ begin
      perform set_config('app.ccp_approval_command', '1', true);
      update public.client_compliance_profiles
      set status = 'active', approved_by = '${PARTNER_A}', approved_at = now()
      where id = '${P.activeIn}';
    end $$;

    insert into public.compliance_instances
      (id, firm_id, legal_entity_id, compliance_type_id, period_start, period_end,
       period_label, due_date, assignee_membership_id, reviewer_membership_id)
    values
      ('${I.assigned}',       '${FIRM_A}', '${E.inPortfolio}',  '${T.plain}',    '2026-04-01', '2026-06-30', 'FY26 Q1', '2026-07-31', '${M.seniorA}', '${M.articleA}'),
      ('${I.manager}',        '${FIRM_A}', '${E.inPortfolio}',  '${T.plain}',    '2026-07-01', '2026-09-30', 'FY26 Q2', '2026-10-31', null, null),
      ('${I.out}',            '${FIRM_A}', '${E.otherManaged}', '${T.plain}',    '2026-04-01', '2026-06-30', 'FY26 Q1', '2026-07-31', null, null),
      ('${I.four}',           '${FIRM_A}', '${E.inPortfolio}',  '${T.skipFour}', '2026-04-01', '2026-06-30', 'FY26 Q1', '2026-07-31', '${M.seniorA}', '${M.articleA}'),
      ('${I.fourNoRev}',      '${FIRM_A}', '${E.inPortfolio}',  '${T.skipFour}', '2026-07-01', '2026-09-30', 'FY26 Q2', '2026-10-31', '${M.seniorA}', null),
      ('${I.regress}',        '${FIRM_A}', '${E.inPortfolio}',  '${T.skipFour}', '2026-10-01', '2026-12-31', 'FY26 Q3', '2027-01-31', '${M.seniorA}', '${M.articleA}'),
      ('${I.otherAssigned}',  '${FIRM_A}', '${E.inPortfolio}',  '${T.plain}',    '2027-01-01', '2027-03-31', 'FY26 Q4', '2027-04-30', '${M.articleA}', '${M.managerA}'),
      ('${I.unassigned}',     '${FIRM_A}', '${E.inPortfolio}',  '${T.plain}',    '2027-04-01', '2027-06-30', 'FY27 Q1', '2027-07-31', null, null),
      ('${I.multi}',          '${FIRM_A}', '${E.multiManaged}', '${T.plain}',    '2026-04-01', '2026-06-30', 'FY26 Q1', '2026-07-31', null, null),
      ('${I.firmB}',          '${FIRM_B}', '${E.firmB}',        '${SYS_ITR}',    '2026-04-01', '2027-03-31', 'FY 2026-27', '2027-10-31', null, null);
  `);
  // Fixture writes are operator/system-actor rows; the request-path audit
  // assertions live in the audit suite — remove fixture noise here so the
  // denial-by-side-effect checks below read a clean table.
  psql(`delete from public.audit_log where firm_id in ('${FIRM_A}', '${FIRM_B}')`);
}

beforeAll(async () => {
  seedFixture();
  for (const [key, set] of [
    ['USER_A_PARTNER', (t: string) => (partnerA = t)],
    ['USER_A_SUPER_ADMIN', (t: string) => (superAdminA = t)],
    ['USER_A_MANAGER', (t: string) => (managerA = t)],
    ['USER_A_SENIOR', (t: string) => (seniorA = t)],
    ['USER_A_ARTICLE', (t: string) => (articleA = t)],
    ['USER_A_BILLING', (t: string) => (billingA = t)],
    ['USER_A_SUSPENDED', (t: string) => (suspendedA = t)],
    ['USER_A_REMOVED', (t: string) => (removedA = t)],
    ['USER_MULTI_FIRM', (t: string) => (multiFirm = t)],
    ['USER_B_PARTNER', (t: string) => (partnerB = t)],
  ] as Array<[string, (t: string) => void]>) {
    const s = await signIn(userEmail(key));
    if (!s.ok) throw new Error(`sign-in failed for ${key}: ${JSON.stringify(s.raw)}`);
    set(s.token);
  }
});

afterAll(() => {
  // Child rows first — the membership/firm deletes would otherwise trip
  // the hierarchy FKs, and leaving rows behind poisons the next suite in
  // the sequential chain.
  cleanRows();
  psql(`
    delete from public.firms where id in ('${FIRM_A}', '${FIRM_B}')
      and not exists (select 1 from public.firm_memberships m where m.firm_id = firms.id)
      and not exists (select 1 from public.clients c where c.firm_id = firms.id);
  `);
});

const ids = (body: Array<{ id: string }>) => body.map((r) => r.id);

// ---------------------------------------------------------------------------
// TEST-RLS-MAT-01 — read posture per role (both tables)
// ---------------------------------------------------------------------------

describe('TEST-RLS-MAT-01 — read posture per role', () => {
  it('super_admin/partner read every profile and instance of the active firm, and only that firm', async () => {
    for (const token of [partnerA, superAdminA]) {
      const profiles = await api(token, 'GET', 'client_compliance_profiles?select=id', { headers: H(FIRM_A) });
      expect(profiles.status).toBe(200);
      expect(ids(profiles.body)).toEqual(
        expect.arrayContaining([P.tdsIn, P.itrIn, P.out, P.activeIn]),
      );
      expect(ids(profiles.body)).not.toContain(P.firmB);
      const instances = await api(token, 'GET', 'compliance_instances?select=id', { headers: H(FIRM_A) });
      expect(ids(instances.body)).toEqual(
        expect.arrayContaining([
          I.assigned, I.manager, I.out, I.four, I.fourNoRev, I.regress,
          I.otherAssigned, I.unassigned, I.multi,
        ]),
      );
      expect(ids(instances.body)).not.toContain(I.firmB);
    }
  });

  it('manager reads only the designated portfolio (RLS-STF-03) on both tables', async () => {
    const profiles = await api(managerA, 'GET', 'client_compliance_profiles?select=id', { headers: H(FIRM_A) });
    expect(ids(profiles.body).sort()).toEqual([P.tdsIn, P.itrIn].sort());
    const instances = await api(managerA, 'GET', 'compliance_instances?select=id', { headers: H(FIRM_A) });
    expect(ids(instances.body).sort()).toEqual(
      [I.assigned, I.manager, I.four, I.fourNoRev, I.regress, I.otherAssigned, I.unassigned].sort(),
    );
  });

  it('senior reads only assigned-work instances and the profiles of entities carrying them', async () => {
    const instances = await api(seniorA, 'GET', 'compliance_instances?select=id', { headers: H(FIRM_A) });
    expect(ids(instances.body).sort()).toEqual(
      [I.assigned, I.four, I.fourNoRev, I.regress].sort(),
    );
    // RLS-CCP-01 senior path: profiles of legal entities with at least one
    // instance assigned to the caller's live membership.
    const profiles = await api(seniorA, 'GET', 'client_compliance_profiles?select=id', { headers: H(FIRM_A) });
    expect(ids(profiles.body).sort()).toEqual([P.tdsIn, P.itrIn].sort());
  });

  it('article reads only instances where their membership is assignee/reviewer', async () => {
    const instances = await api(articleA, 'GET', 'compliance_instances?select=id', { headers: H(FIRM_A) });
    expect(ids(instances.body).sort()).toEqual(
      [I.assigned, I.four, I.otherAssigned, I.regress].sort(),
    );
    const profiles = await api(articleA, 'GET', 'client_compliance_profiles?select=id', { headers: H(FIRM_A) });
    expect(ids(profiles.body).sort()).toEqual([P.tdsIn, P.itrIn].sort());
  });

  it('billing reads NOTHING on either table (no R0 projection RPC exists)', async () => {
    for (const table of ['client_compliance_profiles', 'compliance_instances']) {
      const res = await api(billingA, 'GET', `${table}?select=id`, { headers: H(FIRM_A) });
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    }
  });

  it('anon reads nothing and cannot reach the Layer-B commands', async () => {
    for (const table of ['client_compliance_profiles', 'compliance_instances']) {
      const res = await api('invalid-anon-token', 'GET', `${table}?select=id`, { headers: H(FIRM_A) });
      expect(res.status).toBeGreaterThanOrEqual(400);
    }
    const approve = await api('invalid-anon-token', 'POST', 'rpc/approve_client_compliance_profile', {
      headers: H(FIRM_A),
      body: { p_profile_id: P.itrIn },
    });
    expect(approve.status).toBeGreaterThanOrEqual(400);
    const transition = await api('invalid-anon-token', 'POST', 'rpc/transition_compliance_instance', {
      headers: H(FIRM_A),
      body: { p_instance_id: I.manager, p_to_state: 'preparation' },
    });
    expect(transition.status).toBeGreaterThanOrEqual(400);
  });
});

// ---------------------------------------------------------------------------
// TEST-RLS-GEN-02 — offensive posture (cross-tenant, forged context)
// ---------------------------------------------------------------------------

describe('TEST-RLS-GEN-02 — offensive posture', () => {
  it('known foreign ids are indistinguishable from nonexistent (no oracle), both directions', async () => {
    const asA = await api(partnerA, 'GET', `compliance_instances?id=eq.${I.firmB}`, { headers: H(FIRM_A) });
    expect(asA.body).toEqual([]);
    const asB = await api(partnerB, 'GET', `compliance_instances?id=eq.${I.assigned}`, { headers: H(FIRM_B) });
    expect(asB.body).toEqual([]);
    const pAsA = await api(partnerA, 'GET', `client_compliance_profiles?id=eq.${P.firmB}`, { headers: H(FIRM_A) });
    expect(pAsA.body).toEqual([]);
  });

  it('cross-tenant insert fails even with the foreign selector forged (RLS-CTX-02)', async () => {
    const forgedSelector = await api(partnerA, 'POST', 'client_compliance_profiles', {
      headers: H(FIRM_B),
      body: { firm_id: FIRM_B, legal_entity_id: E.firmB, compliance_type_id: SYS_ITR },
    });
    expect(forgedSelector.status).toBe(403);
    const mismatchedColumn = await api(partnerA, 'POST', 'client_compliance_profiles', {
      headers: H(FIRM_A),
      body: { firm_id: FIRM_B, legal_entity_id: E.firmB, compliance_type_id: SYS_ITR },
    });
    expect(mismatchedColumn.status).toBe(403);
  });

  it('cross-tenant update is a silent zero-row with the row provably unchanged (GEN-04)', async () => {
    const upd = await api(superAdminA, 'PATCH', `compliance_instances?id=eq.${I.firmB}`, {
      headers: H(FIRM_A),
      body: { period_label: 'hijacked' },
    });
    expect(upd.status).toBe(200);
    expect(upd.body).toEqual([]);
    expect(
      psql(`select period_label from public.compliance_instances where id = '${I.firmB}';`).trim(),
    ).toBe('FY 2026-27');
    const pUpd = await api(superAdminA, 'PATCH', `client_compliance_profiles?id=eq.${P.firmB}`, {
      headers: H(FIRM_A),
      body: { applicability_answers: { hijacked: true } },
    });
    expect(pUpd.status).toBe(200);
    expect(pUpd.body).toEqual([]);
    expect(
      psql(`select applicability_answers is null from public.client_compliance_profiles where id = '${P.firmB}';`).trim(),
    ).toBe('t');
  });

  it('no selector at all selects nothing (context is required, not optional)', async () => {
    const res = await api(partnerA, 'GET', 'compliance_instances?select=id');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// TEST-RLS-MAT-02/03 — write posture per role
// ---------------------------------------------------------------------------

describe('TEST-RLS-MAT-02/03 — write posture per role', () => {
  it('partner creates a profile (server-forced proposed, no approval stamps) and an instance (derived client_id)', async () => {
    // E.otherManaged holds no TAN registration — a registration-scoped type
    // without one is DM-27-rejected on the request path too.
    const scopedOut = await api(partnerA, 'POST', 'client_compliance_profiles', {
      headers: H(FIRM_A),
      body: {
        firm_id: FIRM_A,
        legal_entity_id: E.otherManaged,
        compliance_type_id: SYS_TDS24Q,
        applicability_answers: { note: 'partner create' },
      },
    });
    expect(scopedOut.status).toBe(400);
    expect(String(scopedOut.body.details ?? scopedOut.body.message)).toContain('SCOPE_VIOLATION');

    const okProfile = await api(partnerA, 'POST', 'client_compliance_profiles', {
      headers: H(FIRM_A),
      body: { firm_id: FIRM_A, legal_entity_id: E.otherManaged, compliance_type_id: '50000000-0000-4000-8000-000000000007' },
    });
    expect(okProfile.status).toBe(201);
    expect(okProfile.body[0].status).toBe('proposed');
    expect(okProfile.body[0].approved_by).toBeNull();

    const instance = await api(partnerA, 'POST', 'compliance_instances', {
      headers: H(FIRM_A),
      body: {
        firm_id: FIRM_A,
        legal_entity_id: E.otherManaged,
        compliance_type_id: T.plain,
        period_start: '2026-10-01',
        period_end: '2026-12-31',
        period_label: 'FY26 Q3',
        due_date: '2027-01-31',
      },
    });
    expect(instance.status).toBe(201);
    expect(instance.body[0].state).toBe('not_started'); // forced default — transition-command-only
    expect(instance.body[0].client_id).toBe(C.otherManaged); // trigger-derived (SCH-A-02)
    expect(instance.body[0].generation_source).toBe('manual');
  });

  it('manager writes only inside the portfolio (insert + non-state update)', async () => {
    const inPortfolio = await api(managerA, 'POST', 'client_compliance_profiles', {
      headers: H(FIRM_A),
      body: {
        firm_id: FIRM_A,
        legal_entity_id: E.inPortfolio,
        compliance_type_id: '50000000-0000-4000-8000-000000000007', // tax-audit, entity scope
      },
    });
    expect(inPortfolio.status).toBe(201);
    const outPortfolio = await api(managerA, 'POST', 'client_compliance_profiles', {
      headers: H(FIRM_A),
      body: {
        firm_id: FIRM_A,
        legal_entity_id: E.multiManaged,
        compliance_type_id: '50000000-0000-4000-8000-000000000007',
      },
    });
    expect(outPortfolio.status).toBe(403);

    const upd = await api(managerA, 'PATCH', `compliance_instances?id=eq.${I.manager}`, {
      headers: H(FIRM_A),
      body: { priority: 'high' },
    });
    expect(upd.status).toBe(200);
    expect(upd.body[0].priority).toBe('high');
    const updOut = await api(managerA, 'PATCH', `compliance_instances?id=eq.${I.out}`, {
      headers: H(FIRM_A),
      body: { priority: 'high' },
    });
    expect(updOut.status).toBe(200);
    expect(updOut.body).toEqual([]); // silent zero-row, no existence leak
    expect(psql(`select priority from public.compliance_instances where id = '${I.out}';`).trim()).toBe('normal');
  });

  it('senior/article have NO direct table mutation right — insert 403, update zero-row (RLS-CIN-01)', async () => {
    for (const token of [seniorA, articleA]) {
      const ins = await api(token, 'POST', 'compliance_instances', {
        headers: H(FIRM_A),
        body: {
          firm_id: FIRM_A,
          legal_entity_id: E.inPortfolio,
          compliance_type_id: T.plain,
          period_start: '2028-01-01',
          period_end: '2028-03-31',
          period_label: 'x',
          due_date: '2028-04-30',
        },
      });
      expect(ins.status).toBe(403);
    }
    // Even on an instance the senior is ASSIGNED to and can read: the update
    // policy excludes senior — silent zero-row, row provably unchanged.
    const upd = await api(seniorA, 'PATCH', `compliance_instances?id=eq.${I.assigned}`, {
      headers: H(FIRM_A),
      body: { priority: 'urgent' },
    });
    expect(upd.status).toBe(200);
    expect(upd.body).toEqual([]);
    expect(psql(`select priority from public.compliance_instances where id = '${I.assigned}';`).trim()).toBe('normal');
  });

  it('billing is fully denied on both tables (GEN-04: authorization errors, not silent no-ops)', async () => {
    const ins = await api(billingA, 'POST', 'client_compliance_profiles', {
      headers: H(FIRM_A),
      body: { firm_id: FIRM_A, legal_entity_id: E.inPortfolio, compliance_type_id: SYS_ITR },
    });
    expect(ins.status).toBe(403);
    const upd = await api(billingA, 'PATCH', `compliance_instances?id=eq.${I.manager}`, {
      headers: H(FIRM_A),
      body: { priority: 'low' },
    });
    expect(upd.status).toBe(200);
    expect(upd.body).toEqual([]);
  });

  it('DELETE is not granted to anyone on either table (lifecycle statuses only)', async () => {
    const delP = await api(partnerA, 'DELETE', `client_compliance_profiles?id=eq.${P.out}`, { headers: H(FIRM_A) });
    expect(delP.status).toBeGreaterThanOrEqual(400);
    const delI = await api(partnerA, 'DELETE', `compliance_instances?id=eq.${I.out}`, { headers: H(FIRM_A) });
    expect(delI.status).toBeGreaterThanOrEqual(400);
    expect(psql(`select count(*) from public.client_compliance_profiles where id = '${P.out}';`).trim()).toBe('1');
    expect(psql(`select count(*) from public.compliance_instances where id = '${I.out}';`).trim()).toBe('1');
  });

  it('column-pinned write surface: state/identity/provenance/client_id have no browser write path', async () => {
    // state is outside the UPDATE column grant (and the guard behind it).
    const state = await api(partnerA, 'PATCH', `compliance_instances?id=eq.${I.manager}`, {
      headers: H(FIRM_A),
      body: { state: 'preparation' },
    });
    expect(state.status).toBeGreaterThanOrEqual(400);
    expect(psql(`select state from public.compliance_instances where id = '${I.manager}';`).trim()).toBe('not_started');
    // identity + provenance columns are outside the grant as well.
    for (const body of [
      { legal_entity_id: E.otherManaged },
      { client_id: C.otherManaged },
      { rule_version_id: null },
      { generation_source: 'import' },
      { filed_at: '2026-09-04T00:00:00Z' },
    ]) {
      const res = await api(partnerA, 'PATCH', `compliance_instances?id=eq.${I.manager}`, {
        headers: H(FIRM_A),
        body,
      });
      expect(res.status).toBeGreaterThanOrEqual(400);
    }
    // profile direct activation reaches the guard (status IS update-granted
    // for non-active moves) and is rejected with the command marker.
    const activate = await api(partnerA, 'PATCH', `client_compliance_profiles?id=eq.${P.itrIn}`, {
      headers: H(FIRM_A),
      body: { status: 'active' },
    });
    expect(activate.status).toBe(400);
    expect(String(activate.body.details)).toContain('INVALID_TRANSITION:client_compliance_profiles.status');
    expect(psql(`select status from public.client_compliance_profiles where id = '${P.itrIn}';`).trim()).toBe('proposed');
  });
});

// ---------------------------------------------------------------------------
// Profile approval authorization matrix (API-R0-CCP)
// ---------------------------------------------------------------------------

describe('profile approval matrix (approve_client_compliance_profile)', () => {
  it('manager approves an in-portfolio profile; approved_by stamps the actor identity', async () => {
    const res = await api(managerA, 'POST', 'rpc/approve_client_compliance_profile', {
      headers: H(FIRM_A),
      body: { p_profile_id: P.itrIn },
    });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('approved');
    expect(res.body.profile.status).toBe('active');
    expect(res.body.profile.approved_by).toBe(MANAGER_A);
    expect(res.body.profile.approved_at).not.toBeNull();
  });

  it('manager out-of-portfolio approval is denied (RLS-STF-03), billing denied (no approval right)', async () => {
    // Both are PRE-authorization visibility failures -> the API-ERR-02
    // not_found surface, indistinguishable from a nonexistent profile.
    const out = await api(managerA, 'POST', 'rpc/approve_client_compliance_profile', {
      headers: H(FIRM_A),
      body: { p_profile_id: P.out },
    });
    expect(out.body.status).toBe('denied');
    expect(out.body.kind).toBe('not_found');
    expect(out.body).toEqual(PROFILE_NOT_FOUND_BODY);
    const billing = await api(billingA, 'POST', 'rpc/approve_client_compliance_profile', {
      headers: H(FIRM_A),
      body: { p_profile_id: P.tdsIn },
    });
    expect(billing.body.status).toBe('denied');
    expect(billing.body.kind).toBe('not_found');
    expect(billing.body).toEqual(PROFILE_NOT_FOUND_BODY);
    expect(psql(`select status from public.client_compliance_profiles where id = '${P.out}';`).trim()).toBe('proposed');
    expect(psql(`select status from public.client_compliance_profiles where id = '${P.tdsIn}';`).trim()).toBe('proposed');
  });

  it('partner approves; re-approval and approving a non-proposed profile are conflicts', async () => {
    const res = await api(partnerA, 'POST', 'rpc/approve_client_compliance_profile', {
      headers: H(FIRM_A),
      body: { p_profile_id: P.tdsIn },
    });
    expect(res.body.status).toBe('approved');
    expect(res.body.profile.approved_by).toBe(PARTNER_A);

    const again = await api(partnerA, 'POST', 'rpc/approve_client_compliance_profile', {
      headers: H(FIRM_A),
      body: { p_profile_id: P.tdsIn },
    });
    expect(again.body.status).toBe('denied');
    expect(again.body.kind).toBe('conflict');

    const preActive = await api(superAdminA, 'POST', 'rpc/approve_client_compliance_profile', {
      headers: H(FIRM_A),
      body: { p_profile_id: P.activeIn },
    });
    expect(preActive.body.status).toBe('denied');
    expect(preActive.body.kind).toBe('conflict');
  });

  it('context discipline: foreign profile with home selector shares the not_found surface; partner B approves own firm', async () => {
    const foreign = await api(partnerA, 'POST', 'rpc/approve_client_compliance_profile', {
      headers: H(FIRM_A),
      body: { p_profile_id: P.firmB },
    });
    expect(foreign.body.status).toBe('denied');
    expect(foreign.body.kind).toBe('not_found');

    const missing = await api(partnerA, 'POST', 'rpc/approve_client_compliance_profile', {
      headers: H(FIRM_A),
      body: { p_profile_id: '99999999-9999-4999-8999-999999999999' },
    });
    expect(missing.body.status).toBe('denied');
    expect(missing.body.kind).toBe('not_found');
    // Byte-identical: a foreign EXISTING profile leaks nothing a
    // nonexistent id would not (API-ERR-02).
    expect(foreign.body).toEqual(missing.body);
    expect(missing.body).toEqual(PROFILE_NOT_FOUND_BODY);

    const ownFirm = await api(partnerB, 'POST', 'rpc/approve_client_compliance_profile', {
      headers: H(FIRM_B),
      body: { p_profile_id: P.firmB },
    });
    expect(ownFirm.body.status).toBe('approved');
  });

  it('suspended/removed memberships cannot approve with the same JWT (TEST-AUTH-12/13)', async () => {
    psql(`
      insert into public.client_compliance_profiles (id, firm_id, legal_entity_id, compliance_type_id)
      values ('64000000-0000-4000-8000-000000000405', '${FIRM_A}', '${E.inPortfolio}', '50000000-0000-4000-8000-000000000008')
      on conflict (id) do nothing;
      update public.client_compliance_profiles set status = 'proposed' where id = '64000000-0000-4000-8000-000000000405';
    `);
    for (const token of [suspendedA, removedA]) {
      const res = await api(token, 'POST', 'rpc/approve_client_compliance_profile', {
        headers: H(FIRM_A),
        body: { p_profile_id: '64000000-0000-4000-8000-000000000405' },
      });
      expect(res.body.status).toBe('denied');
      // No live membership -> NULL role -> pre-authorization not_found gate.
      expect(res.body.kind).toBe('not_found');
      expect(res.body).toEqual(PROFILE_NOT_FOUND_BODY);
    }
    // Live flip mid-session: the partner loses approval the moment the
    // membership suspends; restoring re-enables it (DEC-J live lookup).
    try {
      psql(`update public.firm_memberships set status = 'suspended' where id = '${M.partnerA}'`);
      const denied = await api(partnerA, 'POST', 'rpc/approve_client_compliance_profile', {
        headers: H(FIRM_A),
        body: { p_profile_id: '64000000-0000-4000-8000-000000000405' },
      });
      expect(denied.body.status).toBe('denied');
      expect(denied.body.kind).toBe('not_found'); // suspended mid-session -> NULL role -> gate
    } finally {
      psql(`update public.firm_memberships set status = 'active' where id = '${M.partnerA}'`);
    }
    const ok = await api(partnerA, 'POST', 'rpc/approve_client_compliance_profile', {
      headers: H(FIRM_A),
      body: { p_profile_id: '64000000-0000-4000-8000-000000000405' },
    });
    expect(ok.body.status).toBe('approved');
  });
});

// ---------------------------------------------------------------------------
// Transition authorization matrix (RLS-CIN-01 T1)
// ---------------------------------------------------------------------------

describe('transition matrix (transition_compliance_instance, T.plain = no four-eyes)', () => {
  it('partner and in-portfolio manager drive I.manager forward; idempotent replay works', async () => {
    const t1 = await api(partnerA, 'POST', 'rpc/transition_compliance_instance', {
      headers: H(FIRM_A),
      body: { p_instance_id: I.manager, p_to_state: 'preparation' },
    });
    expect(t1.body.status).toBe('transitioned');
    const t2 = await api(managerA, 'POST', 'rpc/transition_compliance_instance', {
      headers: H(FIRM_A),
      body: { p_instance_id: I.manager, p_to_state: 'internal_review', p_mutation_key: 'rls31-mk-1' },
    });
    expect(t2.body.status).toBe('transitioned');
    // No four-eyes on T.plain: the in-scope manager may exit review.
    const t3 = await api(managerA, 'POST', 'rpc/transition_compliance_instance', {
      headers: H(FIRM_A),
      body: { p_instance_id: I.manager, p_to_state: 'ready_to_file', p_mutation_key: 'rls31-mk-2' },
    });
    expect(t3.body.status).toBe('transitioned');
    // Replay with the same key: already_applied, no second mutation.
    const replay = await api(managerA, 'POST', 'rpc/transition_compliance_instance', {
      headers: H(FIRM_A),
      body: { p_instance_id: I.manager, p_to_state: 'ready_to_file', p_mutation_key: 'rls31-mk-2' },
    });
    expect(replay.body.status).toBe('already_applied');
    // Same-state without a key is an ordinary conflict.
    const noKey = await api(managerA, 'POST', 'rpc/transition_compliance_instance', {
      headers: H(FIRM_A),
      body: { p_instance_id: I.manager, p_to_state: 'ready_to_file' },
    });
    expect(noKey.body.status).toBe('denied');
    expect(noKey.body.kind).toBe('conflict');
    expect(psql(`select state from public.compliance_instances where id = '${I.manager}';`).trim()).toBe('ready_to_file');
  });

  it('manager OUT of portfolio cannot transition (RLS-STF-03)', async () => {
    const res = await api(managerA, 'POST', 'rpc/transition_compliance_instance', {
      headers: H(FIRM_A),
      body: { p_instance_id: I.out, p_to_state: 'preparation' },
    });
    expect(res.body.status).toBe('denied');
    // Pre-authorization denial: the API-ERR-02 not_found surface, byte-
    // identical to a nonexistent id (no existence oracle).
    expect(res.body.kind).toBe('not_found');
    expect(res.body).toEqual(NOT_FOUND_BODY);
    expect(psql(`select state from public.compliance_instances where id = '${I.out}';`).trim()).toBe('not_started');
  });

  it('senior/article transition only as the CURRENT assignee/reviewer', async () => {
    // Assignee + reviewer walk their own instance forward.
    const byAssignee = await api(seniorA, 'POST', 'rpc/transition_compliance_instance', {
      headers: H(FIRM_A),
      body: { p_instance_id: I.assigned, p_to_state: 'preparation' },
    });
    expect(byAssignee.body.status).toBe('transitioned');
    const byReviewer = await api(articleA, 'POST', 'rpc/transition_compliance_instance', {
      headers: H(FIRM_A),
      body: { p_instance_id: I.assigned, p_to_state: 'internal_review' },
    });
    expect(byReviewer.body.status).toBe('transitioned');
    // Senior is neither assignee nor reviewer of I.otherAssigned (both
    // responsibility slots held by others) — pre-authorization not_found.
    const notMine = await api(seniorA, 'POST', 'rpc/transition_compliance_instance', {
      headers: H(FIRM_A),
      body: { p_instance_id: I.otherAssigned, p_to_state: 'preparation' },
    });
    expect(notMine.body.status).toBe('denied');
    expect(notMine.body.kind).toBe('not_found');
    expect(notMine.body).toEqual(NOT_FOUND_BODY);
    // An instance with NO responsibility assignments at all is equally out
    // of scope for senior/article (the NULL-slot scope hole closed by the
    // IMP-031 security review: unknown -> denied, never silently permitted).
    const nobody = await api(seniorA, 'POST', 'rpc/transition_compliance_instance', {
      headers: H(FIRM_A),
      body: { p_instance_id: I.unassigned, p_to_state: 'preparation' },
    });
    expect(nobody.body.status).toBe('denied');
    expect(nobody.body.kind).toBe('not_found');
    expect(nobody.body).toEqual(NOT_FOUND_BODY);
    expect(psql(`select state from public.compliance_instances where id = '${I.otherAssigned}';`).trim()).toBe('not_started');
    expect(psql(`select state from public.compliance_instances where id = '${I.unassigned}';`).trim()).toBe('not_started');
  });

  it('billing cannot transition; invalid/unknown targets map to conflict/validation', async () => {
    const billing = await api(billingA, 'POST', 'rpc/transition_compliance_instance', {
      headers: H(FIRM_A),
      body: { p_instance_id: I.out, p_to_state: 'preparation' },
    });
    expect(billing.body.status).toBe('denied');
    expect(billing.body.kind).toBe('not_found');
    expect(billing.body).toEqual(NOT_FOUND_BODY);
    // I.out template lacks 'filed' — a jump is a legality conflict.
    const skip = await api(partnerA, 'POST', 'rpc/transition_compliance_instance', {
      headers: H(FIRM_A),
      body: { p_instance_id: I.out, p_to_state: 'filed' },
    });
    expect(skip.body.status).toBe('denied');
    expect(skip.body.kind).toBe('conflict');
    const unknown = await api(partnerA, 'POST', 'rpc/transition_compliance_instance', {
      headers: H(FIRM_A),
      body: { p_instance_id: I.out, p_to_state: 'teleported' },
    });
    expect(unknown.body.status).toBe('denied');
    expect(unknown.body.kind).toBe('validation');
  });

  it('suspended/removed memberships cannot transition with the same JWT', async () => {
    for (const token of [suspendedA, removedA]) {
      const res = await api(token, 'POST', 'rpc/transition_compliance_instance', {
        headers: H(FIRM_A),
        body: { p_instance_id: I.out, p_to_state: 'preparation' },
      });
      expect(res.body.status).toBe('denied');
      // No live membership -> NULL role -> pre-authorization not_found.
      expect(res.body.kind).toBe('not_found');
      expect(res.body).toEqual(NOT_FOUND_BODY);
    }
    expect(psql(`select state from public.compliance_instances where id = '${I.out}';`).trim()).toBe('not_started');
  });

  it('cross-tenant transition is denied — foreign selector and foreign instance share the not_found surface', async () => {
    const forged = await api(partnerA, 'POST', 'rpc/transition_compliance_instance', {
      headers: H(FIRM_B),
      body: { p_instance_id: I.out, p_to_state: 'preparation' },
    });
    expect(forged.body.status).toBe('denied');
    expect(forged.body.kind).toBe('not_found');
    expect(forged.body).toEqual(NOT_FOUND_BODY);
    const foreign = await api(partnerA, 'POST', 'rpc/transition_compliance_instance', {
      headers: H(FIRM_A),
      body: { p_instance_id: I.firmB, p_to_state: 'information_requested' },
    });
    expect(foreign.body.status).toBe('denied');
    expect(foreign.body.kind).toBe('not_found');
    expect(foreign.body).toEqual(NOT_FOUND_BODY);
    // Partner B drives the firm-B instance along its own legal path (SYS_ITR
    // full pipeline: not_started -> information_requested).
    const own = await api(partnerB, 'POST', 'rpc/transition_compliance_instance', {
      headers: H(FIRM_B),
      body: { p_instance_id: I.firmB, p_to_state: 'information_requested' },
    });
    expect(own.body.status).toBe('transitioned');
  });
});

// ---------------------------------------------------------------------------
// IMP-031 security-review regressions — authorization-first not_found
// uniformity (API-ERR-02) and the closed provenance INSERT grant
// ---------------------------------------------------------------------------

describe('security-review regressions (API-ERR-02 oracle uniformity, provenance grant)', () => {
  it('authorization runs FIRST: replay/vocabulary/legality probes by out-of-scope and foreign actors all return not_found', async () => {
    // I.out exists (firm A, outside manager A's portfolio) at not_started.
    // Each probe targets a code path that leaked existence/content when it
    // ran before the authorization gate: the keyed same-state replay (which
    // returns the FULL ROW to an authorized caller), the unknown-target
    // vocabulary check (CA400), and the legality evaluation (CA402).
    for (const [token, label] of [
      [managerA, 'out-of-portfolio manager'],
      [partnerB, 'foreign-firm partner (firm-B selector)'],
    ] as Array<[string, string]>) {
      const headers = label.startsWith('foreign') ? H(FIRM_B) : H(FIRM_A);
      const replay = await api(token, 'POST', 'rpc/transition_compliance_instance', {
        headers,
        body: { p_instance_id: I.out, p_to_state: 'not_started', p_mutation_key: 'probe' },
      });
      expect(replay.body, label).toEqual(NOT_FOUND_BODY);
      const vocab = await api(token, 'POST', 'rpc/transition_compliance_instance', {
        headers,
        body: { p_instance_id: I.out, p_to_state: 'teleported' },
      });
      expect(vocab.body, label).toEqual(NOT_FOUND_BODY);
      const jump = await api(token, 'POST', 'rpc/transition_compliance_instance', {
        headers,
        body: { p_instance_id: I.out, p_to_state: 'filed' },
      });
      expect(jump.body, label).toEqual(NOT_FOUND_BODY);
    }
    expect(psql(`select state from public.compliance_instances where id = '${I.out}';`).trim()).toBe('not_started');
  });

  it('existence-oracle uniformity: nonexistent, foreign, and out-of-scope responses are identical (no instance payload)', async () => {
    const missing = await api(partnerA, 'POST', 'rpc/transition_compliance_instance', {
      headers: H(FIRM_A),
      body: { p_instance_id: '99999999-9999-4999-8999-999999999999', p_to_state: 'preparation' },
    });
    const foreign = await api(partnerA, 'POST', 'rpc/transition_compliance_instance', {
      headers: H(FIRM_A),
      body: { p_instance_id: I.firmB, p_to_state: 'preparation' },
    });
    const outOfScope = await api(managerA, 'POST', 'rpc/transition_compliance_instance', {
      headers: H(FIRM_A),
      body: { p_instance_id: I.out, p_to_state: 'preparation' },
    });
    expect(missing.body).toEqual(NOT_FOUND_BODY);
    expect(foreign.body).toEqual(missing.body);
    expect(outOfScope.body).toEqual(missing.body);
    // Nothing beyond the denial triple — no row content, no existence hint.
    expect(Object.keys(missing.body as Record<string, unknown>).sort()).toEqual(['kind', 'message', 'status']);
  });

  it('APPROVAL oracle uniformity: foreign / out-of-portfolio / billing / nonexistent all return the identical not_found body', async () => {
    // P.out EXISTS in firm A (proposed, outside manager A's portfolio).
    const byForeign = await api(partnerB, 'POST', 'rpc/approve_client_compliance_profile', {
      headers: H(FIRM_B),
      body: { p_profile_id: P.out },
    });
    const byManager = await api(managerA, 'POST', 'rpc/approve_client_compliance_profile', {
      headers: H(FIRM_A),
      body: { p_profile_id: P.out },
    });
    const byBilling = await api(billingA, 'POST', 'rpc/approve_client_compliance_profile', {
      headers: H(FIRM_A),
      body: { p_profile_id: P.out },
    });
    const byMissing = await api(partnerA, 'POST', 'rpc/approve_client_compliance_profile', {
      headers: H(FIRM_A),
      body: { p_profile_id: '99999999-9999-4999-8999-999999999999' },
    });
    for (const [body, label] of [
      [byForeign.body, 'foreign partner'],
      [byManager.body, 'out-of-portfolio manager'],
      [byBilling.body, 'billing'],
      [byMissing.body, 'nonexistent id'],
    ] as Array<[unknown, string]>) {
      expect(body, label).toEqual(PROFILE_NOT_FOUND_BODY);
    }
    // Same keys, same values — no profile data, no existence leak.
    expect(Object.keys(byMissing.body as Record<string, unknown>).sort()).toEqual(['kind', 'message', 'status']);
    expect(psql(`select status from public.client_compliance_profiles where id = '${P.out}';`).trim()).toBe('proposed');
  });

  it('approval positive controls: in-portfolio manager and partner/super_admin approve; activation stamps the actor and creates ZERO instances', async () => {
    // Scratch proposed profiles on types not otherwise bound to these
    // entities (uniqueness key is (entity, type, registration)).
    const SYS_CERT = '50000000-0000-4000-8000-00000000000e'; // configurable scope
    const SCRATCH = {
      manager: '64000000-0000-4000-8000-000000000406', // E.inPortfolio — manager A in scope
      partner: '64000000-0000-4000-8000-000000000407', // E.otherManaged — firm-wide roles
      superAdmin: '64000000-0000-4000-8000-000000000408', // E.multiManaged
    };
    psql(`
      insert into public.client_compliance_profiles (id, firm_id, legal_entity_id, compliance_type_id) values
        ('${SCRATCH.manager}',    '${FIRM_A}', '${E.inPortfolio}',  '${SYS_CERT}'),
        ('${SCRATCH.partner}',    '${FIRM_A}', '${E.otherManaged}', '${SYS_CERT}'),
        ('${SCRATCH.superAdmin}', '${FIRM_A}', '${E.multiManaged}', '${SYS_CERT}')
      on conflict (id) do nothing;
      update public.client_compliance_profiles set status = 'proposed'
        where id in ('${SCRATCH.manager}', '${SCRATCH.partner}', '${SCRATCH.superAdmin}');
    `);

    const byManager = await api(managerA, 'POST', 'rpc/approve_client_compliance_profile', {
      headers: H(FIRM_A),
      body: { p_profile_id: SCRATCH.manager },
    });
    expect(byManager.body.status).toBe('approved');
    expect(byManager.body.profile.status).toBe('active');
    expect(byManager.body.profile.approved_by).toBe(MANAGER_A);
    expect(byManager.body.profile.approved_at).not.toBeNull();

    const byPartner = await api(partnerA, 'POST', 'rpc/approve_client_compliance_profile', {
      headers: H(FIRM_A),
      body: { p_profile_id: SCRATCH.partner },
    });
    expect(byPartner.body.status).toBe('approved');
    expect(byPartner.body.profile.approved_by).toBe(PARTNER_A);

    const bySuper = await api(superAdminA, 'POST', 'rpc/approve_client_compliance_profile', {
      headers: H(FIRM_A),
      body: { p_profile_id: SCRATCH.superAdmin },
    });
    expect(bySuper.body.status).toBe('approved');
    expect(bySuper.body.profile.approved_by).toBe(SUPER_ADMIN_A);

    // C5 ruling: activation is eligibility only — the command materializes
    // NO compliance_instances (AUTO-REC-01 belongs to IMP-050).
    const spawned = psql(`
      select count(*) from public.compliance_instances
      where client_compliance_profile_id in ('${SCRATCH.manager}', '${SCRATCH.partner}', '${SCRATCH.superAdmin}');
    `).trim();
    expect(spawned).toBe('0');

    // Remove the scratch rows: later suites assert exact per-portfolio
    // profile sets and must not see these activations.
    psql(`
      delete from public.client_compliance_profiles
      where id in ('${SCRATCH.manager}', '${SCRATCH.partner}', '${SCRATCH.superAdmin}');
    `);
  });

  it('browser INSERT carrying forged recurrence provenance is rejected (42501); manual insert defaults provenance server-side', async () => {
    const base = {
      firm_id: FIRM_A,
      legal_entity_id: E.inPortfolio,
      compliance_type_id: T.plain,
      period_start: '2035-01-01',
      period_end: '2035-03-31',
      period_label: 'FY35 Q4',
      due_date: '2035-04-30',
    };
    // Each provenance column individually forged: no INSERT grant -> 42501.
    for (const forged of [
      { rule_version_id: '99999999-9999-4999-8999-999999999999' },
      { generation_source: 'recurrence' },
      { generated_at: '2026-09-04T00:00:00Z' },
      { calculated_due_date: '2035-04-30' },
    ]) {
      const res = await api(partnerA, 'POST', 'compliance_instances', {
        headers: H(FIRM_A),
        body: { ...base, ...forged },
      });
      expect(res.status, JSON.stringify(res.body)).toBe(403);
      expect((res.body as { code: string }).code).toBe('42501');
    }
    // Manual insert with provenance omitted: succeeds, server defaults apply
    // (generation_source=manual, provenance NULL — AUTO-REC-07).
    const manual = await api(partnerA, 'POST', 'compliance_instances', { headers: H(FIRM_A), body: base });
    expect(manual.status).toBe(201);
    const row = psql(
      `select generation_source || '|' || coalesce(rule_version_id::text, '<null>') || '|' ||
              coalesce(generated_at::text, '<null>') || '|' || coalesce(calculated_due_date::text, '<null>')
       from public.compliance_instances where firm_id = '${FIRM_A}' and period_start = '2035-01-01';`,
    ).trim();
    expect(row).toBe('manual|<null>|<null>|<null>');
    psql(`delete from public.compliance_instances where firm_id = '${FIRM_A}' and period_start = '2035-01-01';`);
  });
});

// ---------------------------------------------------------------------------
// TEST-RLS-4EY-01 — four-eyes transition battery (RLS-4EY-01/02)
// ---------------------------------------------------------------------------

describe('TEST-RLS-4EY-01 — four-eyes, no rank bypass (T.skipFour)', () => {
  it('privileged roles and the assignee cannot exit internal_review; only the assigned reviewer can', async () => {
    // Walk into review (non-exit transitions are not four-eyes bound).
    for (const [token, to] of [
      [partnerA, 'preparation'],
      [seniorA, 'internal_review'],
    ] as Array<[string, string]>) {
      const res = await api(token, 'POST', 'rpc/transition_compliance_instance', {
        headers: H(FIRM_A),
        body: { p_instance_id: I.four, p_to_state: to },
      });
      expect(res.body.status).toBe('transitioned');
    }
    // No rank bypass: super_admin, partner, in-portfolio manager, and the
    // assignee are all denied the review exit — including the
    // client_approval-skip path (template jumps internal_review ->
    // ready_to_file).
    for (const [token, label] of [
      [superAdminA, 'super_admin'],
      [partnerA, 'partner'],
      [managerA, 'in-portfolio manager'],
      [seniorA, 'assignee senior'],
    ] as Array<[string, string]>) {
      const res = await api(token, 'POST', 'rpc/transition_compliance_instance', {
        headers: H(FIRM_A),
        body: { p_instance_id: I.four, p_to_state: 'ready_to_file' },
      });
      expect(res.body.status, label).toBe('denied');
      expect(res.body.kind, label).toBe('unauthorized');
      expect(String(res.body.message), label).toContain('assigned reviewer');
    }
    expect(psql(`select state from public.compliance_instances where id = '${I.four}';`).trim()).toBe('internal_review');
    // The assigned reviewer exits.
    const ok = await api(articleA, 'POST', 'rpc/transition_compliance_instance', {
      headers: H(FIRM_A),
      body: { p_instance_id: I.four, p_to_state: 'ready_to_file' },
    });
    expect(ok.body.status).toBe('transitioned');
  });

  it('a NULL reviewer fail-closes the exit until a manager+ assigns one via the permitted non-state update', async () => {
    for (const to of ['preparation', 'internal_review']) {
      const res = await api(seniorA, 'POST', 'rpc/transition_compliance_instance', {
        headers: H(FIRM_A),
        body: { p_instance_id: I.fourNoRev, p_to_state: to },
      });
      expect(res.body.status).toBe('transitioned');
    }
    const denied = await api(partnerA, 'POST', 'rpc/transition_compliance_instance', {
      headers: H(FIRM_A),
      body: { p_instance_id: I.fourNoRev, p_to_state: 'ready_to_file' },
    });
    expect(denied.body.status).toBe('denied');
    expect(denied.body.kind).toBe('unauthorized');
    // Assignment repair: manager+ non-state update (reviewer_membership_id
    // IS in the update column grant).
    const repair = await api(managerA, 'PATCH', `compliance_instances?id=eq.${I.fourNoRev}`, {
      headers: H(FIRM_A),
      body: { reviewer_membership_id: M.articleA },
    });
    expect(repair.status).toBe(200);
    const ok = await api(articleA, 'POST', 'rpc/transition_compliance_instance', {
      headers: H(FIRM_A),
      body: { p_instance_id: I.fourNoRev, p_to_state: 'ready_to_file' },
    });
    expect(ok.body.status).toBe('transitioned');
  });

  it('regression internal_review -> preparation: reviewer or in-scope manager+; assignee-only staff denied', async () => {
    for (const to of ['preparation', 'internal_review']) {
      const res = await api(seniorA, 'POST', 'rpc/transition_compliance_instance', {
        headers: H(FIRM_A),
        body: { p_instance_id: I.regress, p_to_state: to },
      });
      expect(res.body.status).toBe('transitioned');
    }
    const byAssignee = await api(seniorA, 'POST', 'rpc/transition_compliance_instance', {
      headers: H(FIRM_A),
      body: { p_instance_id: I.regress, p_to_state: 'preparation' },
    });
    expect(byAssignee.body.status).toBe('denied');
    expect(byAssignee.body.kind).toBe('unauthorized');
    const byReviewer = await api(articleA, 'POST', 'rpc/transition_compliance_instance', {
      headers: H(FIRM_A),
      body: { p_instance_id: I.regress, p_to_state: 'preparation' },
    });
    expect(byReviewer.body.status).toBe('transitioned');
    // Back into review; an in-scope manager+ actor may also regress.
    const back = await api(seniorA, 'POST', 'rpc/transition_compliance_instance', {
      headers: H(FIRM_A),
      body: { p_instance_id: I.regress, p_to_state: 'internal_review' },
    });
    expect(back.body.status).toBe('transitioned');
    const byManager = await api(managerA, 'POST', 'rpc/transition_compliance_instance', {
      headers: H(FIRM_A),
      body: { p_instance_id: I.regress, p_to_state: 'preparation' },
    });
    expect(byManager.body.status).toBe('transitioned');
  });

  it('write-time four-eyes: reviewer = assignee is rejected at the API layer too', async () => {
    const res = await api(partnerA, 'PATCH', `compliance_instances?id=eq.${I.regress}`, {
      headers: H(FIRM_A),
      body: { reviewer_membership_id: M.seniorA }, // = assignee
    });
    expect(res.status).toBe(400);
    expect(String(res.body.details)).toContain('FOUR_EYES:compliance_instances.assignments');
  });
});

// ---------------------------------------------------------------------------
// TEST-RLS-GEN-03 — freshness and multi-firm switching
// ---------------------------------------------------------------------------

describe('TEST-RLS-GEN-03 — freshness, multi-firm', () => {
  it('suspended and removed members read nothing with a live token (both tables)', async () => {
    for (const token of [suspendedA, removedA]) {
      for (const table of ['client_compliance_profiles', 'compliance_instances']) {
        const res = await api(token, 'GET', `${table}?select=id`, { headers: H(FIRM_A) });
        expect(res.status).toBe(200);
        expect(res.body).toEqual([]);
      }
    }
  });

  it('suspension takes effect mid-session on the very next request (same JWT)', async () => {
    const before = await api(managerA, 'GET', 'compliance_instances?select=id', { headers: H(FIRM_A) });
    expect(before.body.length).toBeGreaterThan(0);
    try {
      psql(`update public.firm_memberships set status = 'suspended' where id = '${M.managerA}'`);
      const after = await api(managerA, 'GET', 'compliance_instances?select=id', { headers: H(FIRM_A) });
      expect(after.body).toEqual([]);
      psql(`update public.firm_memberships set status = 'removed' where id = '${M.managerA}'`);
      const gone = await api(managerA, 'GET', 'compliance_instances?select=id', { headers: H(FIRM_A) });
      expect(gone.body).toEqual([]);
    } finally {
      psql(`update public.firm_memberships set status = 'active' where id = '${M.managerA}'`);
    }
    const restored = await api(managerA, 'GET', 'compliance_instances?select=id', { headers: H(FIRM_A) });
    expect(restored.body.length).toBeGreaterThan(0);
  });

  it('multi-firm user: manager portfolio applies per selected firm; senior side sees only assigned work', async () => {
    const firmAView = await api(multiFirm, 'GET', 'compliance_instances?select=id', { headers: H(FIRM_A) });
    expect(ids(firmAView.body)).toEqual([I.multi]);
    const firmAProfiles = await api(multiFirm, 'GET', 'client_compliance_profiles?select=id', { headers: H(FIRM_A) });
    expect(ids(firmAProfiles.body)).toEqual([P.activeIn]);
    const firmBView = await api(multiFirm, 'GET', 'compliance_instances?select=id', { headers: H(FIRM_B) });
    expect(firmBView.body).toEqual([]); // senior in B, nothing assigned there
  });
});
