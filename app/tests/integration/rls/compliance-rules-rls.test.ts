/**
 * IMP-030 — Compliance Types & Rule Versions RLS integration tests
 * (SCH-10, SCH-32, RLS-CTY-01, RLS-CRV-01…05, RLS-AAL-01, TEN-08).
 *
 * Exercises the REAL production policies on public.compliance_types and
 * public.compliance_rule_versions plus the Layer-B lifecycle command
 * activate_compliance_rule_version() through PostgREST with signed-in
 * access tokens — never service-role for authorization assertions.
 * Service-side psql is used only for fixture setup, controlled membership
 * mutation, operator-path staging (approved statutory drafts), and
 * teardown.
 *
 * Role posture under test (05 §11 matrix):
 *   super_admin/partner — read all statuses + firm-owned draft create/edit
 *                         + AAL2 activation (RLS-CRV-02/03);
 *   manager             — READ ONLY, active versions only
 *                         (crv_select_manager_active, RLS-CRV-01);
 *   senior/article      — NOTHING in R0 (same deferral as IMP-020/021);
 *   billing             — NOTHING in R0;
 *   suspended/removed   — nothing, live on the same JWT (TEST-AUTH-12/13);
 *   anon                — nothing.
 *
 * TEST mapping (05 §14 + 2026-09-03 rule-governance closure):
 *   TEST-RLS-CTY-01…10  — generic tenant family on compliance_types;
 *   TEST-RLS-CRV-01…13  — rule-version family incl. statutory gate (11),
 *                         command-only lifecycle (12), succession
 *                         readability (13).
 *
 * Re-runnable: deterministic ids in the 61000000-… range, force-reset on
 * every run; fixture audit rows removed as the operator in teardown
 * (append-only applies to application roles, AUD-INV-01).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  adminDeleteFactor,
  adminListFactors,
  api,
  authPost,
  FIRM_A,
  FIRM_B,
  psql,
  signIn,
  totpCode,
  userEmail,
  userId,
} from '../helpers.mjs';

const H = (firm: string) => ({ 'x-active-firm': firm });

// System seed rows (committed seed catalogue).
const SYS_GSTR1 = '50000000-0000-4000-8000-000000000001'; // statutory system type
const SYS_GSTR1_V1 = '50000000-0000-4000-8000-000000000101'; // its draft/pending seed version

// Suite fixtures.
const T = {
  sysActive: '61000000-0000-4000-8000-0000000000a1', // system non_statutory, has an ACTIVE version
  firmCustomA: '61000000-0000-4000-8000-0000000000c1', // firm A custom non_statutory
  firmGstA: '61000000-0000-4000-8000-0000000000c2', // firm A gstr1 override (inherits statutory)
  firmCustomB: '61000000-0000-4000-8000-0000000000c3', // firm B custom non_statutory
};
const V = {
  sysActive1: '61000000-0000-4000-8000-0000000001a1', // ACTIVE system version [2026-01-01, ∞)
  customA1: '61000000-0000-4000-8000-0000000001c1', // draft, effective 2026-10-01 (succession step 1)
  customA2: '61000000-0000-4000-8000-0000000001c2', // draft, effective 2027-04-01 (succession step 2)
  gstPendingA: '61000000-0000-4000-8000-0000000001d1', // statutory draft, auto pending
  gstApprovedA: '61000000-0000-4000-8000-0000000001d2', // statutory draft, operator-approved
  customB1: '61000000-0000-4000-8000-0000000001b1', // firm B draft
};
// Created through PostgREST in CRV-08 (id is NOT in the insert column
// grant — the server assigns it). Set by the create test; used by the
// succession tests which run after it in file order.
let customA3Id = '';

const M = {
  partnerA: '61000000-0000-4000-8000-0000000000e1',
  superA: '61000000-0000-4000-8000-0000000000e2',
  managerA: '61000000-0000-4000-8000-0000000000e3',
  seniorA: '61000000-0000-4000-8000-0000000000e4',
  articleA: '61000000-0000-4000-8000-0000000000e5',
  billingA: '61000000-0000-4000-8000-0000000000e6',
  suspendedA: '61000000-0000-4000-8000-0000000000e7',
  removedA: '61000000-0000-4000-8000-0000000000e8',
  multiA: '61000000-0000-4000-8000-0000000000e9',
  partnerB: '61000000-0000-4000-8000-0000000000ea',
  multiB: '61000000-0000-4000-8000-0000000000eb',
};

const PARTNER_A = userId('USER_A_PARTNER');
const SUPER_A = userId('USER_A_SUPER_ADMIN');
const MANAGER_A = userId('USER_A_MANAGER');
const SENIOR_A = userId('USER_A_SENIOR');
const ARTICLE_A = userId('USER_A_ARTICLE');
const BILLING_A = userId('USER_A_BILLING');
const SUSPENDED_A = userId('USER_A_SUSPENDED');
const REMOVED_A = userId('USER_A_REMOVED');
const MULTI = userId('USER_MULTI_FIRM');
const PARTNER_B = userId('USER_B_PARTNER');

let partnerA1: string; // partner A, aal1
let partnerA2: string; // partner A, aal2
let superA1: string;
let superA2: string;
let managerA: string;
let seniorA: string;
let billingA: string;
let suspendedA: string;
let removedA: string;
let multiFirm: string;
let partnerB: string;
const factorIds: Array<{ user: string; factor: string }> = [];

function seedFixture() {
  // Force-reset so re-runs are deterministic after a failed/partial run.
  psql(`
    delete from public.audit_log
      where object_type in ('compliance_type','compliance_rule_version')
        and object_id in (
          select id::text from public.compliance_rule_versions
            where compliance_type_id in ('${T.sysActive}','${T.firmCustomA}','${T.firmGstA}','${T.firmCustomB}')
                 or compliance_type_id in (select id from public.compliance_types
                     where firm_id = '${FIRM_A}' and type_key = 'rls-api-created')
          union select unnest(array['${T.sysActive}','${T.firmCustomA}','${T.firmGstA}','${T.firmCustomB}']));
    delete from public.compliance_rule_versions
      where compliance_type_id in ('${T.sysActive}','${T.firmCustomA}','${T.firmGstA}','${T.firmCustomB}')
           or compliance_type_id in (select id from public.compliance_types
               where firm_id = '${FIRM_A}' and type_key = 'rls-api-created');
    delete from public.compliance_types
      where id in ('${T.sysActive}','${T.firmCustomA}','${T.firmGstA}','${T.firmCustomB}')
             or (firm_id = '${FIRM_A}' and type_key = 'rls-api-created');
    delete from public.firm_memberships where id in
      ('${M.partnerA}','${M.superA}','${M.managerA}','${M.seniorA}','${M.articleA}','${M.billingA}',
       '${M.suspendedA}','${M.removedA}','${M.multiA}','${M.partnerB}','${M.multiB}');

    insert into public.firms (id, name) values
      ('${FIRM_A}', 'IMP-030 RLS Firm A'),
      ('${FIRM_B}', 'IMP-030 RLS Firm B')
    on conflict (id) do nothing;

    insert into public.firm_memberships (id, firm_id, user_id, role, status) values
      ('${M.partnerA}',   '${FIRM_A}', '${PARTNER_A}',   'partner',     'active'),
      ('${M.superA}',     '${FIRM_A}', '${SUPER_A}',     'super_admin', 'active'),
      ('${M.managerA}',   '${FIRM_A}', '${MANAGER_A}',   'manager',     'active'),
      ('${M.seniorA}',    '${FIRM_A}', '${SENIOR_A}',    'senior',      'active'),
      ('${M.articleA}',   '${FIRM_A}', '${ARTICLE_A}',   'article_executive', 'active'),
      ('${M.billingA}',   '${FIRM_A}', '${BILLING_A}',   'billing',     'active'),
      ('${M.suspendedA}', '${FIRM_A}', '${SUSPENDED_A}', 'senior',      'suspended'),
      ('${M.removedA}',   '${FIRM_A}', '${REMOVED_A}',   'senior',      'removed'),
      ('${M.multiA}',     '${FIRM_A}', '${MULTI}',       'manager',     'active'),
      ('${M.partnerB}',   '${FIRM_B}', '${PARTNER_B}',   'partner',     'active'),
      ('${M.multiB}',     '${FIRM_B}', '${MULTI}',       'senior',      'active');

    insert into public.compliance_types
      (id, firm_id, type_key, name, category, frequency, due_rule, workflow_template,
       scope_kind, registration_class, governance_class)
    values
      ('${T.sysActive}', null, 'rls-sys-checklist', 'RLS System Checklist', 'Certificates',
       'custom', '{"description":"system checklist"}', '{"states":["not_started","preparation","closed"]}',
       'configurable', null, 'non_statutory'),
      ('${T.firmCustomA}', '${FIRM_A}', 'rls-firm-custom', 'RLS Firm Custom', 'Certificates',
       'custom', '{"description":"firm custom"}', '{"states":["not_started","preparation","closed"]}',
       'configurable', null, 'non_statutory'),
      ('${T.firmGstA}', '${FIRM_A}', 'gstr1', 'GSTR-1 (RLS override)', 'GST',
       'monthly', '{"description":"11th"}', '{"states":["not_started","preparation","closed"]}',
       'registration', 'GSTIN', 'statutory'),
      ('${T.firmCustomB}', '${FIRM_B}', 'rls-firm-custom', 'RLS Firm Custom B', 'Certificates',
       'custom', '{"description":"firm B custom"}', '{"states":["not_started","preparation","closed"]}',
       'configurable', null, 'non_statutory');

    insert into public.compliance_rule_versions
      (id, firm_id, compliance_type_id, version, effective_from, frequency, due_rule,
       status, domain_approval_status)
    values
      -- operator path: explicit status/approval state, validated by crv_prepare_insert
      ('${V.sysActive1}', null, '${T.sysActive}', 1, '2026-01-01', 'custom',
       '{"description":"active system rule"}', 'active', 'not_required'),
      ('${V.gstApprovedA}', '${FIRM_A}', '${T.firmGstA}', 2, '2026-10-01', 'monthly',
       '{"description":"approved statutory draft"}', 'draft', 'approved'),
      -- request path: approval state derived from the trusted parent type
      ('${V.customA1}', '${FIRM_A}', '${T.firmCustomA}', 1, '2026-10-01', 'custom',
       '{"description":"v1"}', 'draft', 'not_required'),
      ('${V.customA2}', '${FIRM_A}', '${T.firmCustomA}', 2, '2027-04-01', 'custom',
       '{"description":"v2"}', 'draft', 'not_required'),
      ('${V.gstPendingA}', '${FIRM_A}', '${T.firmGstA}', 1, '2026-04-01', 'monthly',
       '{"description":"pending statutory draft"}', 'draft', 'pending'),
      ('${V.customB1}', '${FIRM_B}', '${T.firmCustomB}', 1, '2026-04-01', 'custom',
       '{"description":"firm B v1"}', 'draft', 'not_required');
  `);
}

async function makeAal2(userKey: string): Promise<{ aal1: string; aal2: string }> {
  const session = await signIn(userEmail(userKey));
  if (!session.ok) throw new Error(`sign-in failed for ${userKey}: ${JSON.stringify(session.raw)}`);
  const enroll = await authPost('factors', { factor_type: 'totp', friendly_name: `imp030-${userKey}` }, session.token);
  if (enroll.status !== 200) throw new Error(`enroll failed: ${JSON.stringify(enroll.body)}`);
  const factorId = enroll.body.id as string;
  factorIds.push({ user: userId(userKey), factor: factorId });
  const challenge = await authPost(`factors/${factorId}/challenge`, {}, session.token);
  const verify = await authPost(
    `factors/${factorId}/verify`,
    { challenge_id: challenge.body.id, code: totpCode(enroll.body.totp.secret) },
    session.token,
  );
  if (verify.status !== 200 || !verify.body.access_token) {
    throw new Error(`verify failed: ${JSON.stringify(verify.body)}`);
  }
  return { aal1: session.token, aal2: verify.body.access_token };
}

beforeAll(async () => {
  seedFixture();
  const [partner, sup] = await Promise.all([makeAal2('USER_A_PARTNER'), makeAal2('USER_A_SUPER_ADMIN')]);
  partnerA1 = partner.aal1;
  partnerA2 = partner.aal2;
  superA1 = sup.aal1;
  superA2 = sup.aal2;
  for (const [key, set] of [
    ['USER_A_MANAGER', (t: string) => (managerA = t)],
    ['USER_A_SENIOR', (t: string) => (seniorA = t)],
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

afterAll(async () => {
  try {
    for (const { user, factor } of factorIds) await adminDeleteFactor(user, factor);
    for (const u of [PARTNER_A, SUPER_A]) {
      const factors = await adminListFactors(u);
      for (const f of factors) await adminDeleteFactor(u, f.id);
    }
  } finally {
    psql(`
      delete from public.audit_log
        where object_type in ('compliance_type','compliance_rule_version')
          and object_id in (
            select id::text from public.compliance_rule_versions
              where compliance_type_id in ('${T.sysActive}','${T.firmCustomA}','${T.firmGstA}','${T.firmCustomB}')
                   or compliance_type_id in (select id from public.compliance_types
                       where firm_id = '${FIRM_A}' and type_key = 'rls-api-created')
            union select unnest(array['${T.sysActive}','${T.firmCustomA}','${T.firmGstA}','${T.firmCustomB}']));
      delete from public.compliance_rule_versions
        where compliance_type_id in ('${T.sysActive}','${T.firmCustomA}','${T.firmGstA}','${T.firmCustomB}')
           or compliance_type_id in (select id from public.compliance_types
               where firm_id = '${FIRM_A}' and type_key = 'rls-api-created');
      delete from public.compliance_types
        where id in ('${T.sysActive}','${T.firmCustomA}','${T.firmGstA}','${T.firmCustomB}')
             or (firm_id = '${FIRM_A}' and type_key = 'rls-api-created');
      delete from public.firm_memberships where id in
        ('${M.partnerA}','${M.superA}','${M.managerA}','${M.seniorA}','${M.articleA}','${M.billingA}',
         '${M.suspendedA}','${M.removedA}','${M.multiA}','${M.partnerB}','${M.multiB}');
      delete from public.firms where id in ('${FIRM_A}', '${FIRM_B}')
        and not exists (select 1 from public.firm_memberships m where m.firm_id = firms.id)
        and not exists (select 1 from public.clients c where c.firm_id = firms.id);
    `);
  }
});

// ---------------------------------------------------------------------------
// TEST-RLS-CTY-01…10 — compliance_types
// ---------------------------------------------------------------------------

describe('TEST-RLS-CTY-01/02 — read scoping (system defaults + own-firm only)', () => {
  it('partner reads system defaults and own-firm types, never other-firm types', async () => {
    const res = await api(partnerA1, 'GET', 'compliance_types?select=id', { headers: H(FIRM_A) });
    expect(res.status).toBe(200);
    const ids = res.body.map((r: { id: string }) => r.id);
    expect(ids).toEqual(expect.arrayContaining([SYS_GSTR1, T.sysActive, T.firmCustomA, T.firmGstA]));
    expect(ids).not.toContain(T.firmCustomB);
  });

  it('manager reads the same scope (RLS-CTY-01 all-staff read)', async () => {
    const res = await api(managerA, 'GET', 'compliance_types?select=id', { headers: H(FIRM_A) });
    expect(res.status).toBe(200);
    const ids = res.body.map((r: { id: string }) => r.id);
    expect(ids).toEqual(expect.arrayContaining([SYS_GSTR1, T.firmCustomA]));
    expect(ids).not.toContain(T.firmCustomB);
  });

  it('cross-tenant targeted read returns nothing (no existence oracle)', async () => {
    const res = await api(partnerA1, 'GET', `compliance_types?id=eq.${T.firmCustomB}&select=id`, {
      headers: H(FIRM_A),
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
    const back = await api(partnerB, 'GET', `compliance_types?id=eq.${T.firmCustomA}&select=id`, {
      headers: H(FIRM_B),
    });
    expect(back.status).toBe(200);
    expect(back.body).toEqual([]);
  });

  it('forged x-active-firm yields no rows (selector validated against live membership)', async () => {
    const res = await api(partnerA1, 'GET', 'compliance_types?select=id', { headers: H(FIRM_B) });
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

describe('TEST-RLS-CTY-03/04/05 — cross-tenant mutation and DELETE denied', () => {
  it('cross-tenant insert fails even for aal2 super_admin', async () => {
    const res = await api(superA2, 'POST', 'compliance_types', {
      headers: H(FIRM_A),
      body: {
        firm_id: FIRM_B,
        type_key: 'rls-xtenant',
        name: 'x',
        category: 'Certificates',
        frequency: 'custom',
        due_rule: {},
        workflow_template: { states: ['not_started'] },
        scope_kind: 'configurable',
        governance_class: 'non_statutory',
      },
    });
    expect(res.status).toBe(403);
  });

  it('cross-tenant update is a silent zero-row (API-ERR-02)', async () => {
    const res = await api(superA2, 'PATCH', `compliance_types?id=eq.${T.firmCustomB}`, {
      headers: H(FIRM_A),
      body: { name: 'hijacked' },
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
    expect(psql(`select name from public.compliance_types where id = '${T.firmCustomB}';`).trim())
      .toBe('RLS Firm Custom B');
  });

  it('DELETE is not granted on either table — even to aal2 super_admin', async () => {
    const delType = await api(superA2, 'DELETE', `compliance_types?id=eq.${T.firmCustomA}`, {
      headers: H(FIRM_A),
    });
    expect(delType.status).toBeGreaterThanOrEqual(400);
    const delVer = await api(superA2, 'DELETE', `compliance_rule_versions?id=eq.${V.customA1}`, {
      headers: H(FIRM_A),
    });
    expect(delVer.status).toBeGreaterThanOrEqual(400);
    expect(psql(`select count(*) from public.compliance_types where id = '${T.firmCustomA}';`).trim()).toBe('1');
    expect(psql(`select count(*) from public.compliance_rule_versions where id = '${V.customA1}';`).trim()).toBe('1');
  });
});

describe('TEST-RLS-CTY-06/07 — role matrix for type administration', () => {
  it('manager/senior/billing cannot create types', async () => {
    for (const token of [managerA, seniorA, billingA]) {
      const res = await api(token, 'POST', 'compliance_types', {
        headers: H(FIRM_A),
        body: {
          firm_id: FIRM_A,
          type_key: 'rls-denied',
          name: 'x',
          category: 'Certificates',
          frequency: 'custom',
          due_rule: {},
          workflow_template: { states: ['not_started'] },
          scope_kind: 'configurable',
          governance_class: 'non_statutory',
        },
      });
      expect(res.status).toBe(403);
    }
  });

  it('manager cannot update a firm type (silent zero-row)', async () => {
    const res = await api(managerA, 'PATCH', `compliance_types?id=eq.${T.firmCustomA}`, {
      headers: H(FIRM_A),
      body: { name: 'manager edit' },
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('aal2 super_admin creates and aal2 partner updates a firm-owned type', async () => {
    const created = await api(superA2, 'POST', 'compliance_types', {
      headers: H(FIRM_A),
      body: {
        firm_id: FIRM_A,
        type_key: 'rls-api-created',
        name: 'API Created',
        category: 'Certificates',
        frequency: 'custom',
        due_rule: { description: 'api' },
        workflow_template: { states: ['not_started', 'preparation', 'closed'] },
        scope_kind: 'configurable',
        governance_class: 'non_statutory',
      },
    });
    expect(created.status).toBe(201);
    expect(created.body[0].type_key).toBe('rls-api-created');
    const createdId = created.body[0].id as string;
    const updated = await api(partnerA2, 'PATCH', `compliance_types?id=eq.${createdId}`, {
      headers: H(FIRM_A),
      body: { name: 'API Created (edited)' },
    });
    expect(updated.status).toBe(200);
    expect(updated.body[0].name).toBe('API Created (edited)');
  });

  it('aal1 privileged insert is denied (AAL2 required for administration)', async () => {
    const res = await api(superA1, 'POST', 'compliance_types', {
      headers: H(FIRM_A),
      body: {
        firm_id: FIRM_A,
        type_key: 'rls-aal1',
        name: 'x',
        category: 'Certificates',
        frequency: 'custom',
        due_rule: {},
        workflow_template: { states: ['not_started'] },
        scope_kind: 'configurable',
        governance_class: 'non_statutory',
      },
    });
    expect(res.status).toBe(403);
  });

  it('browser cannot create system-default rows (TEN-08)', async () => {
    const res = await api(superA2, 'POST', 'compliance_types', {
      headers: H(FIRM_A),
      body: {
        firm_id: null,
        type_key: 'rls-system-forge',
        name: 'x',
        category: 'Certificates',
        frequency: 'custom',
        due_rule: {},
        workflow_template: { states: ['not_started'] },
        scope_kind: 'configurable',
        governance_class: 'non_statutory',
      },
    });
    expect(res.status).toBe(403);
  });
});

describe('TEST-RLS-CTY-08/09/10 — freshness, anon, no cross-scope inheritance', () => {
  it('suspended and removed memberships read nothing with the same JWT', async () => {
    for (const token of [suspendedA, removedA]) {
      const res = await api(token, 'GET', 'compliance_types?select=id', { headers: H(FIRM_A) });
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    }
  });

  it('senior/article/billing read NOTHING in R0 (05 §11 matrix)', async () => {
    for (const token of [seniorA, billingA]) {
      const res = await api(token, 'GET', 'compliance_types?select=id', { headers: H(FIRM_A) });
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    }
  });

  it('anon reads nothing', async () => {
    const res = await api('invalid-anon-token', 'GET', 'compliance_types?select=id', {
      headers: H(FIRM_A),
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('staff context cannot inherit unrelated scope: multi-firm user in firm-B context as senior sees nothing', async () => {
    const res = await api(multiFirm, 'GET', 'compliance_types?select=id', { headers: H(FIRM_B) });
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// TEST-RLS-CRV-01…13 — compliance_rule_versions
// ---------------------------------------------------------------------------

describe('TEST-RLS-CRV-01/02/03/09 — read scoping per role', () => {
  it('CRV-01: active system-default version readable by ordinary staff (manager)', async () => {
    const res = await api(managerA, 'GET', `compliance_rule_versions?id=eq.${V.sysActive1}&select=id,status`, {
      headers: H(FIRM_A),
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: V.sysActive1, status: 'active' }]);
  });

  it('CRV-09: manager sees ONLY active versions — drafts are not exposed', async () => {
    const res = await api(managerA, 'GET', 'compliance_rule_versions?select=id,status', {
      headers: H(FIRM_A),
    });
    expect(res.status).toBe(200);
    const ids = res.body.map((r: { id: string }) => r.id);
    for (const r of res.body) expect(r.status).toBe('active');
    expect(ids).not.toContain(V.customA1); // draft at suite start…
    expect(ids).not.toContain(V.gstPendingA);
    expect(ids).not.toContain(V.customB1);
  });

  it('CRV-02: same-firm privileged read sees every status', async () => {
    const res = await api(partnerA1, 'GET', 'compliance_rule_versions?select=id', { headers: H(FIRM_A) });
    expect(res.status).toBe(200);
    const ids = res.body.map((r: { id: string }) => r.id);
    expect(ids).toEqual(
      expect.arrayContaining([V.sysActive1, SYS_GSTR1_V1, V.customA1, V.customA2, V.gstPendingA, V.gstApprovedA]),
    );
    expect(ids).not.toContain(V.customB1);
  });

  it('CRV-03: other-firm version unreadable (targeted, both directions)', async () => {
    const res = await api(partnerA1, 'GET', `compliance_rule_versions?id=eq.${V.customB1}&select=id`, {
      headers: H(FIRM_A),
    });
    expect(res.body).toEqual([]);
    const back = await api(partnerB, 'GET', `compliance_rule_versions?id=eq.${V.customA1}&select=id`, {
      headers: H(FIRM_B),
    });
    expect(back.body).toEqual([]);
  });

  it('suspended/removed same-JWT freshness: live membership loss denies the very next read', async () => {
    expect((await api(suspendedA, 'GET', 'compliance_rule_versions?select=id', { headers: H(FIRM_A) })).body).toEqual([]);
    expect((await api(removedA, 'GET', 'compliance_rule_versions?select=id', { headers: H(FIRM_A) })).body).toEqual([]);
    // Live flip mid-session: manager loses access the moment the row suspends.
    expect((await api(managerA, 'GET', 'compliance_rule_versions?select=id', { headers: H(FIRM_A) })).body.length)
      .toBeGreaterThan(0);
    try {
      psql(`update public.firm_memberships set status = 'suspended' where id = '${M.managerA}'`);
      expect((await api(managerA, 'GET', 'compliance_rule_versions?select=id', { headers: H(FIRM_A) })).body).toEqual([]);
      psql(`update public.firm_memberships set status = 'removed' where id = '${M.managerA}'`);
      expect((await api(managerA, 'GET', 'compliance_rule_versions?select=id', { headers: H(FIRM_A) })).body).toEqual([]);
    } finally {
      psql(`update public.firm_memberships set status = 'active' where id = '${M.managerA}'`);
    }
  });

  it('anon reads nothing', async () => {
    const res = await api('invalid-anon-token', 'GET', 'compliance_rule_versions?select=id', {
      headers: H(FIRM_A),
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('anon cannot reach the lifecycle command (execute granted to authenticated only)', async () => {
    const res = await api('invalid-anon-token', 'POST', 'rpc/activate_compliance_rule_version', {
      headers: H(FIRM_A),
      body: { p_version_id: V.customA1 },
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

describe('TEST-RLS-CRV-04/05/06 — write denial matrix', () => {
  it('CRV-04: cross-tenant insert fails (aal2 super_admin, WITH CHECK pins firm to context)', async () => {
    const res = await api(superA2, 'POST', 'compliance_rule_versions', {
      headers: H(FIRM_A),
      body: {
        firm_id: FIRM_B,
        compliance_type_id: T.firmCustomB,
        version: 9,
        effective_from: '2026-04-01',
        frequency: 'custom',
        due_rule: {},
      },
    });
    expect(res.status).toBe(403);
  });

  it('browser INSERT cannot supply effective_to — class-B lifecycle metadata is command-owned (SCH-32, RLS-CRV-04)', async () => {
    const res = await api(superA2, 'POST', 'compliance_rule_versions', {
      headers: H(FIRM_A),
      body: {
        firm_id: FIRM_A,
        compliance_type_id: T.firmCustomA,
        version: 92,
        effective_from: '2026-04-01',
        effective_to: '2026-08-01',
        frequency: 'custom',
        due_rule: {},
      },
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(
      psql(`select count(*) from public.compliance_rule_versions where compliance_type_id = '${T.firmCustomA}' and version = 92;`).trim(),
    ).toBe('0');
  });

  it('CRV-05: cross-tenant update is a silent zero-row', async () => {
    const res = await api(superA2, 'PATCH', `compliance_rule_versions?id=eq.${V.customB1}`, {
      headers: H(FIRM_A),
      body: { frequency: 'monthly' },
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
    expect(psql(`select frequency from public.compliance_rule_versions where id = '${V.customB1}';`).trim())
      .toBe('custom');
  });

  it('CRV-06: manager/senior/billing cannot create versions', async () => {
    for (const token of [managerA, seniorA, billingA]) {
      const res = await api(token, 'POST', 'compliance_rule_versions', {
        headers: H(FIRM_A),
        body: {
          firm_id: FIRM_A,
          compliance_type_id: T.firmCustomA,
          version: 90,
          effective_from: '2026-04-01',
          frequency: 'custom',
          due_rule: {},
        },
      });
      expect(res.status).toBe(403);
    }
  });

  it('CRV-10: firm users cannot mutate system/default versions (insert or update)', async () => {
    const ins = await api(superA2, 'POST', 'compliance_rule_versions', {
      headers: H(FIRM_A),
      body: {
        firm_id: null,
        compliance_type_id: T.sysActive,
        version: 9,
        effective_from: '2026-04-01',
        frequency: 'custom',
        due_rule: {},
      },
    });
    expect(ins.status).toBe(403);
    const upd = await api(superA2, 'PATCH', `compliance_rule_versions?id=eq.${V.sysActive1}`, {
      headers: H(FIRM_A),
      body: { frequency: 'monthly' },
    });
    expect(upd.status).toBe(200);
    expect(upd.body).toEqual([]);
  });
});

describe('TEST-RLS-CRV-07/03 — activation denial matrix', () => {
  it('manager activation denied (read-only role)', async () => {
    const res = await api(managerA, 'POST', 'rpc/activate_compliance_rule_version', {
      headers: H(FIRM_A),
      body: { p_version_id: V.customA1 },
    });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('denied');
    expect(res.body.kind).toBe('unauthorized');
  });

  it('AAL1 privileged activation denied — step-up required (RLS-AAL-01)', async () => {
    const res = await api(partnerA1, 'POST', 'rpc/activate_compliance_rule_version', {
      headers: H(FIRM_A),
      body: { p_version_id: V.customA1 },
    });
    expect(res.body.status).toBe('denied');
    expect(res.body.kind).toBe('unauthorized');
    expect(res.body.message).toContain('AAL2');
  });

  it('system-default activation denied for browser roles (TEN-08; deferred operator path)', async () => {
    const res = await api(partnerA2, 'POST', 'rpc/activate_compliance_rule_version', {
      headers: H(FIRM_A),
      body: { p_version_id: SYS_GSTR1_V1 },
    });
    expect(res.body.status).toBe('denied');
    expect(res.body.kind).toBe('unauthorized');
    expect(psql(`select status from public.compliance_rule_versions where id = '${SYS_GSTR1_V1}';`).trim())
      .toBe('draft');
  });

  it('cross-tenant activation denied — forged selector and foreign version both fail', async () => {
    const forged = await api(partnerA2, 'POST', 'rpc/activate_compliance_rule_version', {
      headers: H(FIRM_B),
      body: { p_version_id: V.customA1 },
    });
    expect(forged.body.status).toBe('denied');
    const foreign = await api(partnerA2, 'POST', 'rpc/activate_compliance_rule_version', {
      headers: H(FIRM_A),
      body: { p_version_id: V.customB1 },
    });
    expect(foreign.body.status).toBe('denied');
    expect(foreign.body.kind).toBe('unauthorized');
  });

  it('suspended same-JWT freshness on the command path (TEST-AUTH-12)', async () => {
    try {
      psql(`update public.firm_memberships set status = 'suspended' where id = '${M.partnerA}'`);
      const res = await api(partnerA2, 'POST', 'rpc/activate_compliance_rule_version', {
        headers: H(FIRM_A),
        body: { p_version_id: V.customA1 },
      });
      expect(res.body.status).toBe('denied');
      expect(res.body.kind).toBe('unauthorized');
    } finally {
      psql(`update public.firm_memberships set status = 'active' where id = '${M.partnerA}'`);
    }
  });
});

describe('TEST-RLS-CRV-11 — statutory approval gate (trusted derivation)', () => {
  it('statutory draft with pending approval cannot activate', async () => {
    const res = await api(partnerA2, 'POST', 'rpc/activate_compliance_rule_version', {
      headers: H(FIRM_A),
      body: { p_version_id: V.gstPendingA },
    });
    expect(res.body.status).toBe('denied');
    expect(res.body.kind).toBe('conflict');
    expect(res.body.message).toContain('domain_approval_status');
  });

  it('caller cannot supply the approval state — the insert grant excludes domain_approval_status', async () => {
    const res = await api(superA2, 'POST', 'compliance_rule_versions', {
      headers: H(FIRM_A),
      body: {
        firm_id: FIRM_A,
        compliance_type_id: T.firmGstA,
        version: 91,
        effective_from: '2026-04-01',
        frequency: 'monthly',
        due_rule: {},
        domain_approval_status: 'approved',
      },
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(psql(`select count(*) from public.compliance_rule_versions where compliance_type_id = '${T.firmGstA}' and version = 91;`).trim()).toBe('0');
  });

  it('operator-approved statutory draft activates through the command (gate opens only on approved)', async () => {
    const res = await api(partnerA2, 'POST', 'rpc/activate_compliance_rule_version', {
      headers: H(FIRM_A),
      body: { p_version_id: V.gstApprovedA },
    });
    expect(res.body.status).toBe('activated');
    expect(res.body.version.status).toBe('active');
    expect(res.body.version.domain_approval_status).toBe('approved');
    expect(res.body.predecessor).toBeNull();
  });
});

describe('TEST-RLS-CRV-08/12 — privileged draft administration; command-only lifecycle', () => {
  it('aal2 super_admin creates a draft; server derives status/approval/creator', async () => {
    const res = await api(superA2, 'POST', 'compliance_rule_versions', {
      headers: H(FIRM_A),
      body: {
        firm_id: FIRM_A,
        compliance_type_id: T.firmCustomA,
        version: 3,
        effective_from: '2026-04-01',
        frequency: 'custom',
        due_rule: { description: 'v3 base window' },
      },
    });
    expect(res.status).toBe(201);
    expect(res.body[0].status).toBe('draft');
    expect(res.body[0].domain_approval_status).toBe('not_required');
    expect(res.body[0].created_by).toBe(SUPER_A);
    customA3Id = res.body[0].id as string;
  });

  it('aal2 partner edits draft rule content; class-A fields stay mutable only in draft', async () => {
    const res = await api(partnerA2, 'PATCH', `compliance_rule_versions?id=eq.${customA3Id}`, {
      headers: H(FIRM_A),
      body: { frequency: 'annual' },
    });
    expect(res.status).toBe(200);
    expect(res.body[0].frequency).toBe('annual');
  });

  it('CRV-12: ordinary UPDATE cannot transition status or effective_to (column grant + trigger layers)', async () => {
    // status/effective_to are outside the UPDATE column grant — PostgREST
    // denies at the privilege layer; the INVALID_TRANSITION trigger marker
    // behind it is verified directly in TEST-SCH-06 (schema suite).
    const toActive = await api(partnerA2, 'PATCH', `compliance_rule_versions?id=eq.${V.customA1}`, {
      headers: H(FIRM_A),
      body: { status: 'active' },
    });
    expect(toActive.status).toBeGreaterThanOrEqual(400);
    const toClose = await api(partnerA2, 'PATCH', `compliance_rule_versions?id=eq.${V.customA1}`, {
      headers: H(FIRM_A),
      body: { effective_to: '2027-01-01' },
    });
    expect(toClose.status).toBeGreaterThanOrEqual(400);
    const row = psql(
      `select status || '|' || coalesce(effective_to::text,'<null>') from public.compliance_rule_versions where id = '${V.customA1}';`,
    ).trim();
    expect(row).toBe('draft|<null>');
  });

  it('approval state has no ordinary UPDATE path from the browser', async () => {
    const res = await api(partnerA2, 'PATCH', `compliance_rule_versions?id=eq.${V.gstPendingA}`, {
      headers: H(FIRM_A),
      body: { domain_approval_status: 'approved' },
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(psql(`select domain_approval_status from public.compliance_rule_versions where id = '${V.gstPendingA}';`).trim())
      .toBe('pending');
  });

  it('CRV-08: aal2 partner activates the non-statutory draft through the command', async () => {
    const res = await api(partnerA2, 'POST', 'rpc/activate_compliance_rule_version', {
      headers: H(FIRM_A),
      body: { p_version_id: customA3Id },
    });
    expect(res.body.status).toBe('activated');
    expect(res.body.version.status).toBe('active');
    // The command never rewrites rule payload (CRV-12 second clause).
    expect(res.body.version.frequency).toBe('annual');
    expect(res.body.version.effective_from).toBe('2026-04-01');
    expect(res.body.version.due_rule).toEqual({ description: 'v3 base window' });
    expect(res.body.predecessor).toBeNull();
  });
});

describe('TEST-RLS-CRV-13 — succession: predecessor stays active for its historical window', () => {
  it('activating v1 closes the governing window of v3 at the boundary; v3 remains active historically', async () => {
    const res = await api(partnerA2, 'POST', 'rpc/activate_compliance_rule_version', {
      headers: H(FIRM_A),
      body: { p_version_id: V.customA1 },
    });
    expect(res.body.status).toBe('activated');
    expect(res.body.version.effective_from).toBe('2026-10-01');
    const pred = res.body.predecessor;
    expect(pred.id).toBe(customA3Id);
    expect(pred.status).toBe('active'); // never rewritten to superseded/deprecated
    expect(pred.effective_to).toBe('2026-10-01');
  });

  it('second succession step closes v1; all three governed windows remain readable', async () => {
    const res = await api(partnerA2, 'POST', 'rpc/activate_compliance_rule_version', {
      headers: H(FIRM_A),
      body: { p_version_id: V.customA2 },
    });
    expect(res.body.status).toBe('activated');
    expect(res.body.predecessor.id).toBe(V.customA1);
    expect(res.body.predecessor.effective_to).toBe('2027-04-01');

    const rows = psql(`
      select id, status, effective_from, effective_to from public.compliance_rule_versions
      where compliance_type_id = '${T.firmCustomA}' and status = 'active'
      order by effective_from;
    `);
    expect(rows).toContain(customA3Id);
    expect(rows).toContain(V.customA1);
    expect(rows).toContain(V.customA2);

    // Historical versions remain readable per RLS-CRV-01 (manager can still see them).
    const mgr = await api(managerA, 'GET', `compliance_rule_versions?compliance_type_id=eq.${T.firmCustomA}&select=id,status`, {
      headers: H(FIRM_A),
    });
    const mgrIds = mgr.body.map((r: { id: string }) => r.id);
    expect(mgrIds).toEqual(expect.arrayContaining([customA3Id, V.customA1, V.customA2]));
  });

  it('active-as-of predicate picks exactly one version per date (half-open windows)', () => {
    const pick = (d: string) =>
      psql(`
        select id from public.compliance_rule_versions
        where compliance_type_id = '${T.firmCustomA}' and status = 'active'
          and effective_from <= '${d}'::date
          and (effective_to is null or '${d}'::date < effective_to);
      `).trim();
    expect(pick('2026-05-01')).toBe(customA3Id);
    expect(pick('2026-09-30')).toBe(customA3Id);
    expect(pick('2026-10-01')).toBe(V.customA1); // boundary: end-exclusive
    expect(pick('2027-04-01')).toBe(V.customA2);
    expect(pick('2028-01-01')).toBe(V.customA2);
  });
});

describe('adversarial — residual overlap and historical-payload attacks', () => {
  it('activation into a window containing a FUTURE active version is denied and fully rolled back', async () => {
    // Succession end state: v3 [2026-04-01,2026-10-01), v1 [2026-10-01,2027-04-01),
    // v2 [2027-04-01,∞). A new draft effective 2026-06-01 would close v3 but
    // still overlap v1/v2 — the command must deny atomically (no partial
    // window close, no audit-free mutation).
    const created = await api(superA2, 'POST', 'compliance_rule_versions', {
      headers: H(FIRM_A),
      body: {
        firm_id: FIRM_A,
        compliance_type_id: T.firmCustomA,
        version: 4,
        effective_from: '2026-06-01',
        frequency: 'custom',
        due_rule: { description: 'overlap attack' },
      },
    });
    expect(created.status).toBe(201);
    const attackId = created.body[0].id as string;
    const res = await api(partnerA2, 'POST', 'rpc/activate_compliance_rule_version', {
      headers: H(FIRM_A),
      body: { p_version_id: attackId },
    });
    expect(res.body.status).toBe('denied');
    expect(res.body.kind).toBe('conflict');
    expect(res.body.message).toContain('overlap');
    // Atomicity: the predecessor window close was rolled back with the denial.
    expect(
      psql(`select coalesce(effective_to::text,'<null>') from public.compliance_rule_versions where id = '${customA3Id}';`).trim(),
    ).toBe('2026-10-01');
    expect(
      psql(`select status from public.compliance_rule_versions where id = '${attackId}';`).trim(),
    ).toBe('draft');
  });

  it('historical governed versions reject payload rewrites after succession (TEST-RLS-CRV-12 second clause)', async () => {
    // customA3 is active-with-closed-window (governed [2026-04-01,2026-10-01)).
    // frequency IS inside the UPDATE column grant, so this reaches the
    // class-A trigger and must fail with the IMMUTABLE_FIELD marker.
    const res = await api(partnerA2, 'PATCH', `compliance_rule_versions?id=eq.${customA3Id}`, {
      headers: H(FIRM_A),
      body: { frequency: 'monthly' },
    });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain('IMMUTABLE_FIELD:compliance_rule_versions.rule_content');
    expect(
      psql(`select frequency from public.compliance_rule_versions where id = '${customA3Id}';`).trim(),
    ).toBe('annual');
  });
});
