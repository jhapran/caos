/**
 * IMP-030 — Compliance rule-version audit integration tests
 * (AUD-CRV-01/02/03, AUD-FAIL-01, TEST-AUD-11; actor model AUD-ACT-05 /
 * TEST-AUD-09 extension).
 *
 * Verifies, through REAL PostgREST requests plus operator psql inspection
 * of public.audit_log:
 *   - Layer-A row audit for browser draft create/edit (insert/update rows
 *     with human actor, firm context, old/new values);
 *   - the Layer-B activation command writes exactly one authoritative
 *     `compliance_rule_version.activate` row (+ `window_close` for the
 *     predecessor) and the skip-flag suppresses trigger duplicates;
 *   - denied privileged activations are recorded as security-significant
 *     denials (AUD-FAIL-01) with actor, firm, and reason;
 *   - seed/operator writes carry the non-human system actor (AUD-CRV-03).
 *
 * Re-runnable: deterministic ids in the 62000000-… range; fixture audit
 * rows removed as the operator in teardown (append-only applies to
 * application roles, AUD-INV-01).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  adminDeleteFactor,
  adminListFactors,
  api,
  authPost,
  FIRM_A,
  psql,
  signIn,
  totpCode,
  userEmail,
  userId,
} from '../helpers.mjs';

const H = (firm: string) => ({ 'x-active-firm': firm });

const T = {
  aud: '62000000-0000-4000-8000-0000000000c1', // firm A custom non_statutory
  audGst: '62000000-0000-4000-8000-0000000000c2', // firm A gstr1 override (statutory)
};
const V = {
  statPending: '62000000-0000-4000-8000-0000000001d1', // statutory draft (pending)
};
// Server-assigned ids (id is outside the insert column grant) — captured
// from the create responses; tests run sequentially in file order.
let v1Id = '';
let v2Id = '';
const M = {
  partnerA: '62000000-0000-4000-8000-0000000000e1',
  managerA: '62000000-0000-4000-8000-0000000000e2',
};

const PARTNER_A = userId('USER_A_PARTNER');
const MANAGER_A = userId('USER_A_MANAGER');

let partnerA2: string;
let managerA: string;
let factorId = '';

function auditRows(objectId: string): Array<Record<string, unknown>> {
  const out = psql(`
    select jsonb_agg(row_to_json(a) order by a.created_at, a.action)
    from public.audit_log a
    where a.object_type in ('compliance_type','compliance_rule_version')
      and a.object_id = '${objectId}';
  `).trim();
  return out ? JSON.parse(out) : [];
}

beforeAll(async () => {
  psql(`
    delete from public.audit_log
      where object_type in ('compliance_type','compliance_rule_version')
        and object_id in (
          select id::text from public.compliance_rule_versions
            where compliance_type_id in ('${T.aud}','${T.audGst}')
          union select '${T.aud}' union select '${T.audGst}');
    delete from public.compliance_rule_versions
      where compliance_type_id in ('${T.aud}','${T.audGst}');
    delete from public.compliance_types where id in ('${T.aud}','${T.audGst}');
    delete from public.firm_memberships where id in ('${M.partnerA}','${M.managerA}');

    insert into public.firms (id, name) values ('${FIRM_A}', 'IMP-030 Audit Firm A')
    on conflict (id) do nothing;

    insert into public.firm_memberships (id, firm_id, user_id, role, status) values
      ('${M.partnerA}', '${FIRM_A}', '${PARTNER_A}', 'partner', 'active'),
      ('${M.managerA}', '${FIRM_A}', '${MANAGER_A}', 'manager', 'active');

    insert into public.compliance_types
      (id, firm_id, type_key, name, category, frequency, due_rule, workflow_template,
       scope_kind, registration_class, governance_class)
    values
      ('${T.aud}', '${FIRM_A}', 'aud-firm-custom', 'AUD Firm Custom', 'Certificates',
       'custom', '{"description":"aud"}', '{"states":["not_started","preparation","closed"]}',
       'configurable', null, 'non_statutory'),
      ('${T.audGst}', '${FIRM_A}', 'gstr1', 'GSTR-1 (AUD override)', 'GST',
       'monthly', '{"description":"11th"}', '{"states":["not_started","preparation","closed"]}',
       'registration', 'GSTIN', 'statutory');

    -- operator path: approval state supplied explicitly (validated, not derived)
    insert into public.compliance_rule_versions
      (id, firm_id, compliance_type_id, version, effective_from, frequency, due_rule,
       domain_approval_status)
    values
      ('${V.statPending}', '${FIRM_A}', '${T.audGst}', 1, '2026-04-01', 'monthly',
       '{"description":"statutory pending"}', 'pending');
  `);

  const session = await signIn(userEmail('USER_A_PARTNER'));
  if (!session.ok) throw new Error(`partner sign-in failed: ${JSON.stringify(session.raw)}`);
  const enroll = await authPost('factors', { factor_type: 'totp', friendly_name: 'imp030-aud' }, session.token);
  if (enroll.status !== 200) throw new Error(`enroll failed: ${JSON.stringify(enroll.body)}`);
  factorId = enroll.body.id;
  const challenge = await authPost(`factors/${factorId}/challenge`, {}, session.token);
  const verify = await authPost(
    `factors/${factorId}/verify`,
    { challenge_id: challenge.body.id, code: totpCode(enroll.body.totp.secret) },
    session.token,
  );
  if (verify.status !== 200) throw new Error(`verify failed: ${JSON.stringify(verify.body)}`);
  partnerA2 = verify.body.access_token;

  const mgr = await signIn(userEmail('USER_A_MANAGER'));
  if (!mgr.ok) throw new Error(`manager sign-in failed: ${JSON.stringify(mgr.raw)}`);
  managerA = mgr.token;
});

afterAll(async () => {
  try {
    if (factorId) await adminDeleteFactor(PARTNER_A, factorId);
    const factors = await adminListFactors(PARTNER_A);
    for (const f of factors) await adminDeleteFactor(PARTNER_A, f.id);
  } finally {
    psql(`
      delete from public.audit_log
        where object_type in ('compliance_type','compliance_rule_version')
          and object_id in (
            select id::text from public.compliance_rule_versions
              where compliance_type_id in ('${T.aud}','${T.audGst}')
            union select '${T.aud}' union select '${T.audGst}');
      delete from public.compliance_rule_versions
        where compliance_type_id in ('${T.aud}','${T.audGst}');
      delete from public.compliance_types where id in ('${T.aud}','${T.audGst}');
      delete from public.firm_memberships where id in ('${M.partnerA}','${M.managerA}');
      delete from public.firms where id = '${FIRM_A}'
        and not exists (select 1 from public.firm_memberships m where m.firm_id = firms.id)
        and not exists (select 1 from public.clients c where c.firm_id = firms.id);
    `);
  }
});

describe('AUD-CRV-03 / TEST-AUD-09 ext — non-human actor identity', () => {
  it('committed seed catalogue rows carry the system actor and the NULL platform firm marker', () => {
    const sysTypes = psql(`
      select count(*) from public.audit_log
      where object_type = 'compliance_type' and action = 'insert'
        and actor_type = 'system' and service_name = 'database-operator'
        and firm_id is null;
    `).trim();
    expect(Number(sysTypes)).toBeGreaterThanOrEqual(14);
    const sysVersions = psql(`
      select count(*) from public.audit_log
      where object_type = 'compliance_rule_version' and action = 'insert'
        and actor_type = 'system' and service_name = 'database-operator'
        and firm_id is null;
    `).trim();
    expect(Number(sysVersions)).toBeGreaterThanOrEqual(14);
    // AUD-ACT-05: no system row may carry a human actor identity.
    const masquerade = psql(`
      select count(*) from public.audit_log
      where object_type in ('compliance_type','compliance_rule_version')
        and actor_type in ('system','service') and actor_user_id is not null;
    `).trim();
    expect(masquerade).toBe('0');
  });

  it('operator-path (psql) fixture inserts above also recorded the system actor', () => {
    const rows = auditRows(V.statPending);
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe('insert');
    expect(rows[0].actor_type).toBe('system');
    expect(rows[0].firm_id).toBe(FIRM_A);
  });
});

describe('TEST-AUD-11 — lifecycle audit trail (Layer A + Layer B)', () => {
  it('browser draft create writes a Layer-A insert row with human actor, firm, NEW value', async () => {
    const res = await api(partnerA2, 'POST', 'compliance_rule_versions', {
      headers: H(FIRM_A),
      body: {
        firm_id: FIRM_A,
        compliance_type_id: T.aud,
        version: 1,
        effective_from: '2026-04-01',
        frequency: 'custom',
        due_rule: { description: 'aud v1' },
      },
    });
    expect(res.status).toBe(201);
    v1Id = res.body[0].id as string;
    const rows = auditRows(v1Id);
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe('insert');
    expect(rows[0].actor_type).toBe('human');
    expect(rows[0].actor_user_id).toBe(PARTNER_A);
    expect(rows[0].firm_id).toBe(FIRM_A);
    expect(rows[0].old_value).toBeNull();
    expect((rows[0].new_value as { status: string }).status).toBe('draft');
  });

  it('draft edit writes a Layer-A update row with old AND new values', async () => {
    const res = await api(partnerA2, 'PATCH', `compliance_rule_versions?id=eq.${v1Id}`, {
      headers: H(FIRM_A),
      body: { frequency: 'annual' },
    });
    expect(res.status).toBe(200);
    const rows = auditRows(v1Id);
    expect(rows).toHaveLength(2);
    const upd = rows.find((r) => r.action === 'update');
    expect(upd).toBeDefined();
    expect(upd!.actor_user_id).toBe(PARTNER_A);
    expect((upd!.old_value as { frequency: string }).frequency).toBe('custom');
    expect((upd!.new_value as { frequency: string }).frequency).toBe('annual');
  });

  it('activation writes exactly one activate row; the trigger writes NO duplicate (skip flag)', async () => {
    const res = await api(partnerA2, 'POST', 'rpc/activate_compliance_rule_version', {
      headers: H(FIRM_A),
      body: { p_version_id: v1Id },
    });
    expect(res.body.status).toBe('activated');
    const rows = auditRows(v1Id);
    // insert + draft edit + activate — and nothing else.
    expect(rows.map((r) => r.action)).toEqual(['insert', 'update', 'compliance_rule_version.activate']);
    const act = rows[2];
    expect(act.actor_type).toBe('human');
    expect(act.actor_user_id).toBe(PARTNER_A);
    expect(act.firm_id).toBe(FIRM_A);
    expect((act.old_value as { status: string }).status).toBe('draft');
    expect((act.new_value as { status: string }).status).toBe('active');
  });

  it('succession writes window_close (old/new lifecycle values) plus the activate row', async () => {
    const created = await api(partnerA2, 'POST', 'compliance_rule_versions', {
      headers: H(FIRM_A),
      body: {
        firm_id: FIRM_A,
        compliance_type_id: T.aud,
        version: 2,
        effective_from: '2026-10-01',
        frequency: 'annual',
        due_rule: { description: 'aud v2' },
      },
    });
    expect(created.status).toBe(201);
    v2Id = created.body[0].id as string;
    const res = await api(partnerA2, 'POST', 'rpc/activate_compliance_rule_version', {
      headers: H(FIRM_A),
      body: { p_version_id: v2Id },
    });
    expect(res.body.status).toBe('activated');

    const v1Rows = auditRows(v1Id);
    const close = v1Rows.filter((r) => r.action === 'compliance_rule_version.window_close');
    expect(close).toHaveLength(1);
    expect(close[0].actor_user_id).toBe(PARTNER_A);
    expect((close[0].old_value as { effective_to: string | null }).effective_to).toBeNull();
    expect((close[0].new_value as { effective_to: string }).effective_to).toBe('2026-10-01');
    // v1 lifecycle was NOT rewritten to a terminal state.
    expect((close[0].new_value as { status: string }).status).toBe('active');

    const v2Rows = auditRows(v2Id);
    expect(v2Rows.map((r) => r.action)).toEqual(['insert', 'compliance_rule_version.activate']);
  });
});

describe('AUD-FAIL-01 — denied activations are recorded', () => {
  it('statutory gate denial is audited with actor, firm, and reason', async () => {
    const res = await api(partnerA2, 'POST', 'rpc/activate_compliance_rule_version', {
      headers: H(FIRM_A),
      body: { p_version_id: V.statPending },
    });
    expect(res.body.status).toBe('denied');
    const rows = auditRows(V.statPending);
    const denied = rows.filter((r) => r.action === 'compliance_rule_version.activation_denied');
    expect(denied).toHaveLength(1);
    expect(denied[0].actor_type).toBe('human');
    expect(denied[0].actor_user_id).toBe(PARTNER_A);
    expect(denied[0].firm_id).toBe(FIRM_A);
    expect((denied[0].new_value as { reason: string }).reason).toContain('domain_approval_status');
    // The denial did not mutate the version.
    expect(psql(`select status from public.compliance_rule_versions where id = '${V.statPending}';`).trim())
      .toBe('draft');
  });

  it('unauthorized-role denial is audited against the manager actor', async () => {
    const res = await api(managerA, 'POST', 'rpc/activate_compliance_rule_version', {
      headers: H(FIRM_A),
      body: { p_version_id: V.statPending },
    });
    expect(res.body.status).toBe('denied');
    const rows = auditRows(V.statPending);
    const denied = rows.filter((r) => r.action === 'compliance_rule_version.activation_denied');
    expect(denied).toHaveLength(2);
    expect(denied[1].actor_user_id).toBe(MANAGER_A);
  });
});
