/**
 * IMP-013 — Audit foundation integration tests (spec 08 / 11 TEST-AUD-*).
 *
 * Exercises the REAL production audit objects (audit_log SCH-20, the
 * Layer-A trigger, the Layer-B membership RPCs, the Layer-C server writer
 * and login-history mirror) on the local stack. Authorization assertions
 * use signed-in access tokens via PostgREST; psql (operator) is used only
 * for fixture setup/teardown, controlled membership mutation, and the
 * simulated-request-context fail-closed proofs (TEST-AUD-07).
 *
 * TEST mapping (spec 08 §20, binding per spec 11):
 *   TEST-AUD-01 trigger old/new rows for insert/update/delete on every
 *               HIGH/MEDIUM audit-sensitive table (firms, firm_memberships,
 *               profiles — the only such tables in R0 so far);
 *   TEST-AUD-02 membership + settings changes audited with correct actor
 *               ("rule" changes: no alert_rules/compliance-rule tables exist
 *               yet — deferred to their owning packages);
 *   TEST-AUD-04 audit_log rejects UPDATE/DELETE for all application roles
 *               incl. super_admin (task_comments immutability: table does
 *               not exist yet — IMP-031);
 *   TEST-AUD-07 audit-write failure aborts the sensitive operation
 *               (fail-closed, trigger path AND RPC path);
 *   TEST-AUD-08 IP/UA/correlation metadata on request-originated entries;
 *   TEST-AUD-09 actor-model invariants (AUD-ACT-05 CHECK).
 *
 * Deferred with reasons (recorded in spec 12 IMP-013 outcome):
 *   TEST-AUD-03 (no instance/task/review/alert tables), TEST-AUD-05 (no
 *   support_sessions table in the R0 schema inventory — IMP-072),
 *   TEST-AUD-06 (MFA recovery Edge Function deferred; the Layer-C contract
 *   it will use IS tested here), TEST-AUD-10 (AUD-OQ-01 OPEN — no
 *   retention path exists to test; immutability coverage stands),
 *   TEST-AUD-11 (SCH-32 rule versions land in a later package).
 *
 * Order-of-implementation tests (user order §17/§19): header-spoofing
 * battery, request-context leakage (sequential + concurrent), membership
 * RPC authorization matrix incl. same-token freshness, RLS-AUD-01 reads,
 * write_audit_event / write_audit_event_server / mirror_login_history
 * behavior, SCH-20 structural assertions.
 *
 * Fixture rows live on the production tables only for this file's duration
 * (deterministic ids in the 91000000-… range); audit rows produced by the
 * fixture are removed as the operator in afterAll (append-only applies to
 * application roles, AUD-INV-01).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  adminCreateUser,
  adminDeleteFactor,
  adminListFactors,
  api,
  authPost,
  deleteUserByEmail,
  FIRM_A,
  FIRM_B,
  localEnv,
  psql,
  signIn,
  totpCode,
  userEmail,
  userId,
} from '../helpers.mjs';

const M = {
  superAdminA: '91000000-0000-4000-8000-000000000001',
  partnerA: '91000000-0000-4000-8000-000000000002',
  seniorA: '91000000-0000-4000-8000-000000000003',
  superAdminB: '91000000-0000-4000-8000-000000000004',
  suspendedA: '91000000-0000-4000-8000-000000000005',
  managerProbe: '91000000-0000-4000-8000-000000000006',
};

const INVITEE_EMAIL = 'imp013.invitee@caos.test';
const INVITEE_PASSWORD = 'Imp013!InviteeLocalOnly';
const NULL_FIRM_PROBE = 'imp013-null-firm-probe';

const SUPER_A = userId('USER_A_SUPER_ADMIN');
const PARTNER_A = userId('USER_A_PARTNER');
const SENIOR_A = userId('USER_A_SENIOR');
const MANAGER_A = userId('USER_A_MANAGER');
const SUPER_B = userId('USER_B_SUPER_ADMIN');
const SUSPENDED_A = userId('USER_A_SUSPENDED');

let sA; // super_admin A aal1 token
let aal2Token; // super_admin A aal2 token
let partnerA, seniorA, suspendedA, superB, invitee;
let inviteeId;
let factorId;

/** Fixture-scoped audit rows, oldest first. */
function auditRows(where) {
  const out = psql(
    `select coalesce(json_agg(row_to_json(t)), '[]'::json)
     from (select * from public.audit_log where ${where} order by created_at) t`,
  );
  return JSON.parse(out);
}

/** Run SQL expected to FAIL; returns the error text ('' if it passed). */
function sqlError(sql) {
  try {
    psql(sql);
    return '';
  } catch (e) {
    return String(e.stderr ?? e.message ?? '');
  }
}

function cleanAudit() {
  psql(`
    delete from public.audit_log
      where firm_id in ('${FIRM_A}', '${FIRM_B}')
         or object_type = 'auth.audit_log_entry'
         or object_id in ('${SENIOR_A}', '${MANAGER_A}', '${NULL_FIRM_PROBE}')
         ${inviteeId ? `or object_id in (select m.id::text from public.firm_memberships m where m.user_id = '${inviteeId}')` : ''};
  `);
}

function cleanupFixture() {
  psql(`
    delete from public.firm_memberships where firm_id in ('${FIRM_A}', '${FIRM_B}');
    delete from public.profiles where id in ('${SENIOR_A}');
    delete from public.firms where id in ('${FIRM_A}', '${FIRM_B}');
  `);
  cleanAudit();
}

async function makeAal2Token() {
  const session = await signIn(userEmail('USER_A_SUPER_ADMIN'));
  if (!session.ok) throw new Error(`sign-in failed: ${JSON.stringify(session.raw)}`);
  const enroll = await authPost('factors', { factor_type: 'totp', friendly_name: 'imp013-aal2' }, session.token);
  if (enroll.status !== 200) throw new Error(`enroll failed: ${JSON.stringify(enroll.body)}`);
  factorId = enroll.body.id;
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

/** service_role REST call — the controlled Layer-C caller (never the browser). */
async function serviceRpc(fn, body = {}) {
  const { API_URL, SERVICE_ROLE_KEY } = localEnv();
  const res = await fetch(`${API_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed };
}

beforeAll(async () => {
  cleanupFixture(); // idempotent: clears residue from a previously failed run
  await deleteUserByEmail(INVITEE_EMAIL);
  const created = await adminCreateUser(INVITEE_EMAIL, INVITEE_PASSWORD, { imp013: 'invitee' });
  inviteeId = created.id;

  psql(`
    insert into public.firms (id, name, status) values
      ('${FIRM_A}', 'IMP-013 Audit Firm A', 'active'),
      ('${FIRM_B}', 'IMP-013 Audit Firm B', 'active');
    insert into public.firm_memberships (id, firm_id, user_id, role, status) values
      ('${M.superAdminA}', '${FIRM_A}', '${SUPER_A}',     'super_admin', 'active'),
      ('${M.partnerA}',    '${FIRM_A}', '${PARTNER_A}',   'partner',     'active'),
      ('${M.seniorA}',     '${FIRM_A}', '${SENIOR_A}',    'senior',      'active'),
      ('${M.superAdminB}', '${FIRM_B}', '${SUPER_B}',     'super_admin', 'active'),
      ('${M.suspendedA}',  '${FIRM_A}', '${SUSPENDED_A}', 'senior',      'suspended');
    insert into public.profiles (id, full_name) values ('${SENIOR_A}', 'Audit Senior A');
  `);
  cleanAudit(); // fixture-establishing audit rows are operator noise; drop them

  const tokens = await makeAal2Token();
  sA = { token: tokens.aal1 };
  aal2Token = tokens.aal2;
  [partnerA, seniorA, suspendedA, superB, invitee] = await Promise.all([
    signIn(userEmail('USER_A_PARTNER')),
    signIn(userEmail('USER_A_SENIOR')),
    signIn(userEmail('USER_A_SUSPENDED')),
    signIn(userEmail('USER_B_SUPER_ADMIN')),
    signIn(INVITEE_EMAIL, INVITEE_PASSWORD),
  ]);
  for (const s of [partnerA, seniorA, suspendedA, superB, invitee]) {
    if (!s.ok) throw new Error(`sign-in failed: ${JSON.stringify(s.raw)}`);
  }
});

afterAll(async () => {
  try {
    if (factorId) await adminDeleteFactor(SUPER_A, factorId);
    const factors = await adminListFactors(SUPER_A);
    for (const f of factors) await adminDeleteFactor(SUPER_A, f.id);
  } finally {
    cleanupFixture();
    await deleteUserByEmail(INVITEE_EMAIL);
  }
});

// ---------------------------------------------------------------------------
// SCH-20 structure
// ---------------------------------------------------------------------------
describe('SCH-20 — audit_log structure', () => {
  it('columns, types, and append-only shape (no updated_at)', () => {
    const cols = psql(
      `select column_name || ':' || data_type from information_schema.columns
       where table_schema = 'public' and table_name = 'audit_log' order by ordinal_position`,
    ).trim();
    for (const expected of [
      'id:uuid', 'firm_id:uuid', 'actor_type:text', 'actor_user_id:uuid',
      'service_name:text', 'action:text', 'object_type:text', 'object_id:text',
      'old_value:jsonb', 'new_value:jsonb', 'ip:text', 'user_agent:text',
      'correlation_id:uuid', 'support_session_id:uuid', 'created_at:timestamp with time zone',
    ]) {
      expect(cols).toContain(expected);
    }
    expect(cols).not.toContain('updated_at');
  });

  it('PK and the four SCH-20 indexes exist', () => {
    const idx = psql(
      `select indexname from pg_indexes where schemaname = 'public' and tablename = 'audit_log' order by 1`,
    ).trim();
    for (const name of [
      'audit_log_pkey',
      'audit_log_firm_object_idx',
      'audit_log_firm_created_idx',
      'audit_log_actor_created_idx',
      'audit_log_support_session_idx',
    ]) {
      expect(idx).toContain(name);
    }
  });

  it('soft references only: no enforcing FK constraints (SCH-FK-03)', () => {
    const fks = psql(
      `select count(*) from pg_constraint
       where connamespace = 'public'::regnamespace and contype = 'f'
         and conrelid = 'public.audit_log'::regclass`,
    ).trim();
    expect(fks).toBe('0');
  });
});

// ---------------------------------------------------------------------------
// TEST-AUD-01 — Layer-A trigger: complete old/new rows on all three tables
// ---------------------------------------------------------------------------
describe('TEST-AUD-01 — trigger writes complete old/new rows (AUD-VAL-01)', () => {
  it('firms UPDATE via PostgREST: human actor from auth.uid(), old+new snapshots', async () => {
    psql(`update public.firms set city = 'BeforeCity' where id = '${FIRM_A}'`);
    cleanAudit();
    const r = await api(sA.token, 'PATCH', `firms?id=eq.${FIRM_A}`, { body: { city: 'AfterCity' } });
    expect(r.status).toBe(200);
    const rows = auditRows(`object_type = 'firm' and object_id = '${FIRM_A}' and action = 'update'`);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.actor_type).toBe('human');
    expect(row.actor_user_id).toBe(SUPER_A);
    expect(row.firm_id).toBe(FIRM_A);
    expect(row.old_value.city).toBe('BeforeCity');
    expect(row.new_value.city).toBe('AfterCity');
  });

  it('profiles UPDATE by self: human actor, NULL firm (global identity data)', async () => {
    cleanAudit();
    const r = await api(seniorA.token, 'PATCH', `profiles?id=eq.${SENIOR_A}`, {
      headers: { Prefer: 'return=minimal' },
      body: { full_name: 'Audit Senior Renamed' },
    });
    expect(r.status).toBeLessThan(300);
    const rows = auditRows(`object_type = 'profile' and object_id = '${SENIOR_A}' and action = 'update'`);
    expect(rows).toHaveLength(1);
    expect(rows[0].actor_type).toBe('human');
    expect(rows[0].actor_user_id).toBe(SENIOR_A);
    expect(rows[0].firm_id).toBeNull();
    expect(rows[0].old_value.full_name).toBe('Audit Senior A');
    expect(rows[0].new_value.full_name).toBe('Audit Senior Renamed');
  });

  it('firm_memberships INSERT + DELETE via operator psql: system actor, NEW-only / OLD-only', () => {
    cleanAudit();
    psql(`insert into public.firm_memberships (id, firm_id, user_id, role, status) values
          ('${M.managerProbe}', '${FIRM_A}', '${MANAGER_A}', 'manager', 'active')`);
    const rows = auditRows(`object_type = 'firm_membership' and object_id = '${M.managerProbe}'`);
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe('insert');
    expect(rows[0].actor_type).toBe('system');
    expect(rows[0].actor_user_id).toBeNull();
    expect(rows[0].service_name).toBe('database-operator');
    expect(rows[0].old_value).toBeNull();
    expect(rows[0].new_value.role).toBe('manager');
    expect(rows[0].firm_id).toBe(FIRM_A);

    psql(`delete from public.firm_memberships where id = '${M.managerProbe}'`);
    const del = auditRows(`object_type = 'firm_membership' and object_id = '${M.managerProbe}' and action = 'delete'`);
    expect(del).toHaveLength(1);
    expect(del[0].old_value.role).toBe('manager');
    expect(del[0].new_value).toBeNull();
    expect(del[0].actor_type).toBe('system');
  });
});

// ---------------------------------------------------------------------------
// TEST-AUD-02 — membership + settings changes audited with correct actor
// (exercises the full invite → accept → role-change → suspend → remove arc
// through the Layer-B RPCs; trigger-skip must prevent duplicate rows)
// ---------------------------------------------------------------------------
describe('TEST-AUD-02 — Layer-B membership RPCs audit with correct actor', () => {
  it('invite / accept / role-change / suspend / remove each write exactly one audited row', async () => {
    cleanAudit();

    // invite (aal2 super_admin)
    const inv = await api(aal2Token, 'POST', 'rpc/invite_member', {
      body: { p_firm_id: FIRM_A, p_user_id: inviteeId, p_role: 'senior' },
    });
    expect(inv.status).toBe(200);
    const membershipId = inv.body.id;
    expect(inv.body.status).toBe('invited');
    expect(inv.body.invited_by).toBe(SUPER_A);

    // accept (invitee self-service, aal1 — precedes MFA enrolment)
    const acc = await api(invitee.token, 'POST', 'rpc/accept_invitation', { body: { p_firm_id: FIRM_A } });
    expect(acc.status).toBe(200);
    expect(acc.body.status).toBe('active');

    // role change (aal2 super_admin)
    const role = await api(aal2Token, 'POST', 'rpc/change_membership_role', {
      body: { p_firm_id: FIRM_A, p_user_id: inviteeId, p_role: 'partner' },
    });
    expect(role.status).toBe(200);
    expect(role.body.role).toBe('partner');

    // suspend + remove (aal2 super_admin)
    const susp = await api(aal2Token, 'POST', 'rpc/suspend_membership', {
      body: { p_firm_id: FIRM_A, p_user_id: inviteeId },
    });
    expect(susp.status).toBe(200);
    expect(susp.body.status).toBe('suspended');
    const rem = await api(aal2Token, 'POST', 'rpc/remove_membership', {
      body: { p_firm_id: FIRM_A, p_user_id: inviteeId },
    });
    expect(rem.status).toBe(200);
    expect(rem.body.status).toBe('removed');

    // exactly one audit row per event — the trigger-skip GUC must prevent
    // Layer-A duplicates on the RPC-mutated rows.
    const rows = auditRows(`object_type = 'firm_membership' and object_id = '${membershipId}'`);
    expect(rows.map((r) => r.action)).toEqual([
      'membership.invite',
      'membership.accept',
      'membership.role_change',
      'membership.suspend',
      'membership.remove',
    ]);
    expect(rows[0].actor_user_id).toBe(SUPER_A);
    expect(rows[0].new_value.status).toBe('invited');
    expect(rows[1].actor_user_id).toBe(inviteeId); // self-acceptance actor
    expect(rows[2].actor_user_id).toBe(SUPER_A);
    expect(rows[2].old_value.role).toBe('senior');
    expect(rows[2].new_value.role).toBe('partner');
    expect(rows[3].old_value.status).toBe('active');
    expect(rows[3].new_value.status).toBe('suspended');
    expect(rows[4].new_value.status).toBe('removed');
    for (const r of rows) {
      expect(r.actor_type).toBe('human');
      expect(r.firm_id).toBe(FIRM_A);
    }
  });

  it('firm settings change (Layer-A path) is audited with the real actor — no AAL2 required for firms', async () => {
    // RLS-FRM-01 as implemented in IMP-012: firms UPDATE requires
    // super_admin membership, NOT AAL2 (verified against spec 05 — no
    // RLS-AAL-01 classification for firm settings writes). Recorded here.
    cleanAudit();
    const r = await api(sA.token, 'PATCH', `firms?id=eq.${FIRM_A}`, {
      body: { settings: { digest: true } },
    });
    expect(r.status).toBe(200);
    const rows = auditRows(`object_type = 'firm' and object_id = '${FIRM_A}' and action = 'update'`);
    expect(rows).toHaveLength(1);
    expect(rows[0].actor_user_id).toBe(SUPER_A);
    expect(rows[0].new_value.settings).toEqual({ digest: true });
  });

  it('membership RPC authorization matrix: aal1 / wrong role / wrong firm / suspended caller', async () => {
    const body = { p_firm_id: FIRM_A, p_user_id: MANAGER_A, p_role: 'senior' };
    expect((await api(sA.token, 'POST', 'rpc/invite_member', { body })).status).toBe(403); // aal1
    expect((await api(partnerA.token, 'POST', 'rpc/invite_member', { body })).status).toBe(403); // wrong role
    expect(
      (await api(aal2Token, 'POST', 'rpc/invite_member', { body: { ...body, p_firm_id: FIRM_B } })).status,
    ).toBe(403); // aal2 + wrong firm
    expect((await api(seniorA.token, 'POST', 'rpc/suspend_membership', {
      body: { p_firm_id: FIRM_A, p_user_id: PARTNER_A },
    })).status).toBe(403); // wrong role
    expect((await api(suspendedA.token, 'POST', 'rpc/remove_membership', {
      body: { p_firm_id: FIRM_A, p_user_id: PARTNER_A },
    })).status).toBe(403); // suspended caller
    // no membership/audit residue from the denied attempts
    expect(
      psql(`select count(*) from public.firm_memberships where firm_id = '${FIRM_A}' and user_id = '${MANAGER_A}'`).trim(),
    ).toBe('0');
  });

  it('accept_invitation rejects anyone without their own pending invitation', async () => {
    expect((await api(seniorA.token, 'POST', 'rpc/accept_invitation', { body: { p_firm_id: FIRM_A } })).status).toBe(403);
    expect((await api(partnerA.token, 'POST', 'rpc/accept_invitation', { body: { p_firm_id: FIRM_A } })).status).toBe(403);
    expect((await api(seniorA.token, 'POST', 'rpc/accept_invitation', { body: { p_firm_id: FIRM_B } })).status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// TEST-AUD-04 — immutability (AUD-INV-01)
// ---------------------------------------------------------------------------
describe('TEST-AUD-04 — audit_log is append-only for all application roles', () => {
  it('UPDATE / DELETE / INSERT via PostgREST are denied even to an aal2 super_admin', async () => {
    // ensure at least one row exists to target
    await api(seniorA.token, 'POST', 'rpc/write_audit_event', {
      body: { p_firm_id: FIRM_A, p_action: 'probe.immutability', p_object_type: 'probe', p_object_id: 'imp013-aud04' },
    });
    const upd = await api(aal2Token, 'PATCH', 'audit_log?object_id=eq.imp013-aud04', { body: { action: 'forged' } });
    expect(upd.status).toBe(403);
    const del = await api(aal2Token, 'DELETE', 'audit_log?object_id=eq.imp013-aud04');
    expect(del.status).toBe(403);
    const ins = await api(aal2Token, 'POST', 'audit_log', {
      body: { firm_id: FIRM_A, actor_type: 'human', actor_user_id: SUPER_A, action: 'forged', object_type: 'probe' },
    });
    expect(ins.status).toBe(403);
    // unchanged
    expect(
      psql(`select action from public.audit_log where object_id = 'imp013-aud04'`).trim(),
    ).toBe('probe.immutability');
  });

  it('grant layer: no INSERT/UPDATE/DELETE/TRUNCATE for anon/authenticated; service_role has none either', () => {
    const grants = psql(
      `select grantee || ':' || privilege_type from information_schema.role_table_grants
       where table_schema = 'public' and table_name = 'audit_log'
         and privilege_type <> 'SELECT' and grantee in ('anon', 'authenticated', 'service_role')`,
    ).trim();
    expect(grants).toBe('');
  });

  it('internal writer audit_write is not reachable via PostgREST at all', async () => {
    const r = await api(aal2Token, 'POST', 'rpc/audit_write', {
      body: { p_firm_id: FIRM_A, p_actor_type: 'system', p_actor_user_id: null, p_action: 'x', p_object_type: 'x', p_object_id: 'x' },
    });
    expect([403, 404]).toContain(r.status);
  });
});

// ---------------------------------------------------------------------------
// TEST-AUD-07 — fail-closed auditing (AUD-CTX-05, AUD-INV-05)
// Uses the test-only app.audit_fault hook (psql-only; unreachable from
// PostgREST). Simulated request contexts set request.jwt.claims locally.
// ---------------------------------------------------------------------------
describe('TEST-AUD-07 — audit-write failure aborts the operation (fail-closed)', () => {
  it('trigger path: firm UPDATE rolls back when the audit write fails', () => {
    psql(`update public.firms set city = 'FaultControl' where id = '${FIRM_A}'`);
    const err = sqlError(`
      begin;
      set local app.audit_fault = 'fail_audit';
      update public.firms set city = 'FaultCity' where id = '${FIRM_A}';
      commit;
    `);
    expect(err).toContain('fault injected');
    // the mutation did not survive
    expect(psql(`select city from public.firms where id = '${FIRM_A}'`).trim()).toBe('FaultControl');
  });

  it('RPC path: invite_member rolls back membership AND audit when the audit write fails', () => {
    const err = sqlError(`
      begin;
      set local request.jwt.claims = '{"sub":"${SUPER_A}","aal":"aal2","role":"authenticated"}';
      set local request.headers = '{}';
      set local app.audit_fault = 'fail_audit';
      select public.invite_member('${FIRM_A}', '${MANAGER_A}', 'senior');
      commit;
    `);
    expect(err).toContain('fault injected');
    expect(
      psql(`select count(*) from public.firm_memberships where firm_id = '${FIRM_A}' and user_id = '${MANAGER_A}'`).trim(),
    ).toBe('0');
    expect(
      psql(`select count(*) from public.audit_log where action = 'membership.invite' and new_value ->> 'user_id' = '${MANAGER_A}'`).trim(),
    ).toBe('0');
  });

  it('positive control: without the fault hook both paths commit mutation + audit together', () => {
    cleanAudit();
    psql(`
      begin;
      set local request.jwt.claims = '{"sub":"${SUPER_A}","aal":"aal2","role":"authenticated"}';
      set local request.headers = '{}';
      select public.invite_member('${FIRM_A}', '${MANAGER_A}', 'senior');
      commit;
    `);
    const membershipId = psql(
      `select id from public.firm_memberships where firm_id = '${FIRM_A}' and user_id = '${MANAGER_A}'`,
    ).trim();
    expect(membershipId).not.toBe('');
    const rows = auditRows(`object_type = 'firm_membership' and object_id = '${membershipId}'`);
    expect(rows.map((r) => r.action)).toEqual(['membership.invite']);
    psql(`delete from public.firm_memberships where id = '${membershipId}'`);
  });
});

// ---------------------------------------------------------------------------
// TEST-AUD-08 + spoofing battery (AUD-CTX-02; user order §17)
// ---------------------------------------------------------------------------
describe('TEST-AUD-08 — request metadata recorded honestly; identity never from headers', () => {
  it('correlation_id / user-agent / XFF land as metadata on request-originated entries', async () => {
    cleanAudit();
    const cid = '33333333-3333-4333-8333-333333333333';
    const r = await api(sA.token, 'PATCH', `firms?id=eq.${FIRM_A}`, {
      headers: {
        'x-correlation-id': cid,
        'user-agent': 'imp013-test-agent/1.0',
        'x-forwarded-for': '198.51.100.77',
      },
      body: { city: 'MetaCity' },
    });
    expect(r.status).toBe(200);
    const rows = auditRows(`correlation_id = '${cid}'`);
    expect(rows).toHaveLength(1);
    expect(rows[0].user_agent).toContain('imp013-test-agent');
    expect(rows[0].ip).toContain('198.51.100.77');
    expect(rows[0].actor_user_id).toBe(SUPER_A); // actor still from auth.uid()
  });

  it('spoofing battery: forged identity headers change NOTHING authoritative', async () => {
    cleanAudit();
    const cid = '44444444-4444-4444-8444-444444444444';
    const r = await api(sA.token, 'PATCH', `firms?id=eq.${FIRM_A}`, {
      headers: {
        'x-actor-id': PARTNER_A,
        'x-actor-type': 'system',
        'x-firm-id': FIRM_B,
        'x-role': 'super_admin',
        'x-service-name': 'forged-service',
        'x-active-firm': FIRM_B, // forged selector: grants nothing
        'x-correlation-id': cid,
        'x-forwarded-for': '203.0.113.66',
        'user-agent': 'forged-agent',
      },
      body: { city: 'SpoofCity' },
    });
    expect(r.status).toBe(200); // the firm A write itself is legitimate
    const rows = auditRows(`correlation_id = '${cid}'`);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.actor_type).toBe('human');
    expect(row.actor_user_id).toBe(SUPER_A); // NOT the forged partner id
    expect(row.service_name).toBeNull(); // NOT the forged service name
    expect(row.firm_id).toBe(FIRM_A); // NOT the forged firm
    expect(row.ip).toContain('203.0.113.66'); // metadata recorded honestly
    expect(row.user_agent).toBe('forged-agent');
    // forged selector granted no firm-B access
    expect((await api(sA.token, 'GET', `firms?id=eq.${FIRM_B}&select=id`, { headers: { 'x-active-firm': FIRM_B } })).body).toEqual([]);
  });

  it('request-context leakage: sequential requests carry their own correlation ids', async () => {
    cleanAudit();
    const c1 = '11111111-1111-4111-8111-111111111111';
    const c2 = '22222222-2222-4222-8222-222222222222';
    await api(sA.token, 'PATCH', `firms?id=eq.${FIRM_A}`, { headers: { 'x-correlation-id': c1 }, body: { city: 'SeqOne' } });
    await api(sA.token, 'PATCH', `firms?id=eq.${FIRM_A}`, { headers: { 'x-correlation-id': c2 }, body: { city: 'SeqTwo' } });
    const r1 = auditRows(`correlation_id = '${c1}'`);
    const r2 = auditRows(`correlation_id = '${c2}'`);
    expect(r1).toHaveLength(1);
    expect(r2).toHaveLength(1);
    expect(r1[0].new_value.city).toBe('SeqOne');
    expect(r2[0].new_value.city).toBe('SeqTwo');
  });

  it('request-context leakage: concurrent requests do not cross-contaminate (pooling safety)', async () => {
    cleanAudit();
    const ids = [0, 1, 2, 3].map((i) => `55555555-5555-4555-8555-55555555555${i}`);
    const results = await Promise.all(
      ids.map((cid, i) =>
        api(seniorA.token, 'POST', 'rpc/write_audit_event', {
          headers: { 'x-correlation-id': cid },
          body: { p_firm_id: FIRM_A, p_action: 'probe.leakage', p_object_type: 'probe', p_object_id: `leak-${i}` },
        }),
      ),
    );
    for (const r of results) expect(r.status).toBe(200);
    for (const [i, cid] of ids.entries()) {
      const rows = auditRows(`correlation_id = '${cid}'`);
      expect(rows).toHaveLength(1);
      expect(rows[0].object_id).toBe(`leak-${i}`); // each request's own context
      expect(rows[0].actor_user_id).toBe(SENIOR_A);
    }
  });
});

// ---------------------------------------------------------------------------
// TEST-AUD-09 — actor-model invariants (AUD-ACT-05, enforced by CHECK)
// ---------------------------------------------------------------------------
describe('TEST-AUD-09 — actor-model CHECK enforcement', () => {
  it('rejects masquerading / incomplete actor combinations', () => {
    // system/service must never carry a human actor_user_id
    expect(
      sqlError(`insert into public.audit_log (firm_id, actor_type, actor_user_id, service_name, action, object_type, object_id)
                values ('${FIRM_A}', 'system', '${SUPER_A}', 'job', 'audit.test', 'probe', 'imp013-aud09')`),
    ).toContain('audit_log_actor_model_check');
    expect(
      sqlError(`insert into public.audit_log (firm_id, actor_type, actor_user_id, action, object_type, object_id)
                values ('${FIRM_A}', 'service', '${SUPER_A}', 'audit.test', 'probe', 'imp013-aud09')`),
    ).toContain('audit_log_actor_model_check');
    // system/service require a service_name
    expect(
      sqlError(`insert into public.audit_log (firm_id, actor_type, action, object_type, object_id)
                values ('${FIRM_A}', 'system', 'audit.test', 'probe', 'imp013-aud09')`),
    ).toContain('audit_log_actor_model_check');
    // human requires actor_user_id
    expect(
      sqlError(`insert into public.audit_log (firm_id, actor_type, action, object_type, object_id)
                values ('${FIRM_A}', 'human', 'audit.test', 'probe', 'imp013-aud09')`),
    ).toContain('audit_log_actor_model_check');
    // support requires actor + session
    expect(
      sqlError(`insert into public.audit_log (firm_id, actor_type, actor_user_id, action, object_type, object_id)
                values ('${FIRM_A}', 'support', '${SUPER_A}', 'audit.test', 'probe', 'imp013-aud09')`),
    ).toContain('audit_log_actor_model_check');
    // unknown actor type
    expect(
      sqlError(`insert into public.audit_log (firm_id, actor_type, action, object_type, object_id)
                values ('${FIRM_A}', 'ghost', 'audit.test', 'probe', 'imp013-aud09')`),
    ).toContain('audit_log_actor_type_check');
  });

  it('accepts valid support/system rows (and the server writer enforces the same model)', () => {
    const session = '66666666-6666-4666-8666-666666666666';
    psql(`insert into public.audit_log (firm_id, actor_type, actor_user_id, support_session_id, action, object_type, object_id)
          values ('${FIRM_A}', 'support', '${SUPER_A}', '${session}', 'audit.test', 'probe', 'imp013-aud09')`);
    expect(auditRows(`object_id = 'imp013-aud09'`)).toHaveLength(1);
    psql(`delete from public.audit_log where object_id = 'imp013-aud09'`);
    // Layer-C writer cannot bypass the CHECK either
    expect(
      sqlError(`select public.write_audit_event_server('${FIRM_A}', 'system', '${SUPER_A}', 'audit.test', 'probe', 'imp013-aud09b', null, null, 'job')`),
    ).toContain('audit_log_actor_model_check');
  });
});

// ---------------------------------------------------------------------------
// RLS-AUD-01 — audit reads: partner/super_admin of the owning firm only
// ---------------------------------------------------------------------------
describe('RLS-AUD-01 — audit_log read policy', () => {
  beforeAll(async () => {
    cleanAudit();
    // one firm-A row (human), one firm-B row (human), one NULL-firm platform row
    await api(seniorA.token, 'POST', 'rpc/write_audit_event', {
      body: { p_firm_id: FIRM_A, p_action: 'probe.read', p_object_type: 'probe', p_object_id: 'rls-a-a' },
    });
    await api(superB.token, 'POST', 'rpc/write_audit_event', {
      body: { p_firm_id: FIRM_B, p_action: 'probe.read', p_object_type: 'probe', p_object_id: 'rls-b-b' },
    });
    psql(`insert into public.audit_log (firm_id, actor_type, service_name, action, object_type, object_id)
          values (null, 'system', 'probe-job', 'probe.read', 'probe', '${NULL_FIRM_PROBE}')`);
  });

  it('partner reads only own-firm rows; NULL-firm platform rows are never visible', async () => {
    const r = await api(partnerA.token, 'GET', 'audit_log?select=id,firm_id,object_id');
    expect(r.status).toBe(200);
    expect(r.body.length).toBeGreaterThan(0);
    expect(r.body.every((row) => row.firm_id === FIRM_A)).toBe(true);
    expect(r.body.map((row) => row.object_id)).toContain('rls-a-a');
    // explicit probes
    expect((await api(partnerA.token, 'GET', `audit_log?object_id=eq.rls-b-b&select=id`)).body).toEqual([]);
    expect((await api(partnerA.token, 'GET', `audit_log?object_id=eq.${NULL_FIRM_PROBE}&select=id`)).body).toEqual([]);
    expect((await api(partnerA.token, 'GET', 'audit_log?firm_id=is.null&select=id')).body).toEqual([]);
  });

  it('super_admin reads own-firm rows; foreign-firm rows stay invisible', async () => {
    const r = await api(aal2Token, 'GET', 'audit_log?select=object_id');
    expect(r.status).toBe(200);
    expect(r.body.map((row) => row.object_id)).toContain('rls-a-a');
    expect(r.body.map((row) => row.object_id)).not.toContain('rls-b-b');
  });

  it('non-privileged roles (senior) and suspended members read nothing', async () => {
    expect((await api(seniorA.token, 'GET', 'audit_log?select=id')).body).toEqual([]);
    expect((await api(suspendedA.token, 'GET', 'audit_log?select=id')).body).toEqual([]);
  });

  it('anon gets nothing (RLS-SVC-03)', async () => {
    const { ANON_KEY } = localEnv();
    const r = await api(ANON_KEY, 'GET', 'audit_log?select=id');
    expect(r.status).toBeGreaterThanOrEqual(400);
  });
});

// ---------------------------------------------------------------------------
// write_audit_event (staff event writer) + Layer-C server writer + mirror
// ---------------------------------------------------------------------------
describe('write_audit_event — staff security/business event writer (AUD-EVT-02)', () => {
  it('active member writes an event for own firm; actor is always auth.uid()', async () => {
    cleanAudit();
    const r = await api(seniorA.token, 'POST', 'rpc/write_audit_event', {
      body: { p_firm_id: FIRM_A, p_action: 'security.probe', p_object_type: 'probe', p_object_id: 'wae-1' },
    });
    expect(r.status).toBe(200);
    const rows = auditRows(`object_id = 'wae-1'`);
    expect(rows).toHaveLength(1);
    expect(rows[0].actor_type).toBe('human');
    expect(rows[0].actor_user_id).toBe(SENIOR_A);
    expect(rows[0].action).toBe('security.probe');
  });

  it('foreign firm, suspended membership, and NULL firm are rejected', async () => {
    expect(
      (await api(seniorA.token, 'POST', 'rpc/write_audit_event', {
        body: { p_firm_id: FIRM_B, p_action: 'x', p_object_type: 'probe' },
      })).status,
    ).toBe(403);
    expect(
      (await api(suspendedA.token, 'POST', 'rpc/write_audit_event', {
        body: { p_firm_id: FIRM_A, p_action: 'x', p_object_type: 'probe' },
      })).status,
    ).toBe(403);
    expect(
      (await api(seniorA.token, 'POST', 'rpc/write_audit_event', {
        body: { p_firm_id: null, p_action: 'x', p_object_type: 'probe' },
      })).status,
    ).toBe(403);
  });
});

describe('Layer C — write_audit_event_server + mirror_login_history (service_role only)', () => {
  it('authenticated users cannot execute the server writer or the mirror (404/403)', async () => {
    const w = await api(aal2Token, 'POST', 'rpc/write_audit_event_server', {
      body: { p_firm_id: FIRM_A, p_actor_type: 'system', p_actor_user_id: null, p_action: 'x', p_object_type: 'probe' },
    });
    expect([403, 404]).toContain(w.status);
    const m = await api(aal2Token, 'POST', 'rpc/mirror_login_history', { body: {} });
    expect([403, 404]).toContain(m.status);
  });

  it('service_role writes a full actor-model row incl. server-asserted metadata', async () => {
    cleanAudit();
    const supportSession = '77777777-7777-4777-8777-777777777777';
    const r = await serviceRpc('write_audit_event_server', {
      p_firm_id: FIRM_A,
      p_actor_type: 'support',
      p_actor_user_id: SUPER_A,
      p_action: 'support.probe',
      p_object_type: 'probe',
      p_object_id: 'layer-c-1',
      p_support_session_id: supportSession,
      p_ip: '192.0.2.10',
      p_user_agent: 'caos-ops-console/0.1',
    });
    expect(r.status).toBe(200);
    const rows = auditRows(`object_id = 'layer-c-1'`);
    expect(rows).toHaveLength(1);
    expect(rows[0].actor_type).toBe('support');
    expect(rows[0].actor_user_id).toBe(SUPER_A);
    expect(rows[0].support_session_id).toBe(supportSession);
    expect(rows[0].ip).toBe('192.0.2.10');
    expect(rows[0].user_agent).toBe('caos-ops-console/0.1');
  });

  it('mirror_login_history mirrors GoTrue auth events as system-actor platform rows, idempotently (AUD-LOGIN-01/02)', async () => {
    psql(`delete from public.audit_log where object_type = 'auth.audit_log_entry'`);
    const first = await serviceRpc('mirror_login_history');
    expect(first.status).toBe(200);
    expect(first.body).toBeGreaterThanOrEqual(1);
    const second = await serviceRpc('mirror_login_history');
    expect(second.status).toBe(200);
    expect(second.body).toBe(0);
    const rows = auditRows(`object_type = 'auth.audit_log_entry'`);
    expect(rows.length).toBe(first.body);
    for (const row of rows) {
      expect(row.actor_type).toBe('system');
      expect(row.actor_user_id).toBeNull();
      expect(row.service_name).toBe('supabase-auth-mirror');
      expect(row.firm_id).toBeNull(); // platform marker (AUD-EVT-03)
      expect(row.action).toMatch(/^auth\./);
      expect(row.new_value).toBeTruthy(); // full GoTrue payload retained
    }
  });
});
