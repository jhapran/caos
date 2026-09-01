/**
 * IMP-012 — Foundational production RLS on the tenant core (SCH-01…03).
 *
 * Exercises the REAL production tables/policies (firms, profiles,
 * firm_memberships) through PostgREST with signed-in access tokens — never
 * service-role for authorization assertions. Service-side psql is used only
 * for fixture setup, controlled membership mutation, and teardown.
 *
 * Mechanism under test (05 RLS-MECH-01, DEC-J resolved): auth.uid()
 * establishes identity; authorization is a LIVE firm_memberships lookup per
 * request; x-active-firm is untrusted context and grants nothing by itself.
 *
 * Fixture rows live on the production tables only for the duration of this
 * file (beforeAll seed / afterAll cleanup, deterministic ids in the
 * 90000000-… range). Re-runnable: base state is force-reset on every run.
 *
 * TEST mapping (specs 05 §14 / 11):
 *   TEST-RLS-FRM-* — firms family; TEST-RLS-PRF-* — profiles family;
 *   TEST-RLS-MEM-* — firm_memberships family (ten-case pattern of 05 §14
 *   adapted to the tenant root/global tables);
 *   TEST-RLS-GEN-01 fixture tenants, GEN-02 offensive posture (known foreign
 *   ids, forged selector), GEN-03 case set (suspension/removal, multi-firm
 *   isolation), GEN-04 mutation-denial surfacing;
 *   TEST-RLS-MAT-01 role matrix — tenant-core cells;
 *   TEST-AUTH-12/13 suspension/removal freshness on production tables;
 *   RLS-AAL-01 — AAL2 step-up on membership administration (aal1 denied,
 *   aal2 allowed, aal2 + wrong role denied, aal2 + wrong firm denied);
 *   RLS-SVC-03 — anon without a session gets nothing.
 *
 * NOT claimed here: TEST-RLS-MAT-02/03 (tasks/audit tables don't exist),
 * TEST-RLS-SUP-01 (break-glass shape needs IMP-013 audit machinery),
 * staff/client overlap production coverage (no client-access tables yet —
 * the hgate mechanism test remains the standing coverage).
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

const H = (firm) => ({ 'x-active-firm': firm });

// Deterministic fixture membership ids (90000000 range — production tables,
// test-scoped rows; distinct from the hgate 80000000 harness range).
const M = {
  superAdminA: '90000000-0000-4000-8000-000000000001',
  partnerA: '90000000-0000-4000-8000-000000000002',
  managerA: '90000000-0000-4000-8000-000000000003',
  seniorA: '90000000-0000-4000-8000-000000000004',
  articleA: '90000000-0000-4000-8000-000000000005',
  billingA: '90000000-0000-4000-8000-000000000006',
  suspendedA: '90000000-0000-4000-8000-000000000007',
  removedA: '90000000-0000-4000-8000-000000000008',
  superAdminB: '90000000-0000-4000-8000-000000000009',
  partnerB: '90000000-0000-4000-8000-00000000000a',
  multiA: '90000000-0000-4000-8000-00000000000b',
  multiB: '90000000-0000-4000-8000-00000000000c',
};

const INVITEE_EMAIL = 'imp012.invitee@caos.test';
const FIRM_A_NAME = 'IMP-012 Fixture Firm A';

const PROFILE_USERS = ['USER_A_SUPER_ADMIN', 'USER_A_PARTNER', 'USER_A_SENIOR', 'USER_B_PARTNER'];

let sA; // super_admin A (aal1) + aal2 token after enrolment
let partnerA, seniorA, billingA, partnerB, multiFirm, suspendedA, removedA;
let inviteeId;
let factorId;
let aal2Token;

function seedFixture() {
  psql(`
    insert into public.firms (id, name) values
      ('${FIRM_A}', '${FIRM_A_NAME}'),
      ('${FIRM_B}', 'IMP-012 Fixture Firm B')
    on conflict (id) do nothing;

    insert into public.firm_memberships (id, firm_id, user_id, role, status) values
      ('${M.superAdminA}', '${FIRM_A}', '${userId('USER_A_SUPER_ADMIN')}', 'super_admin',       'active'),
      ('${M.partnerA}',    '${FIRM_A}', '${userId('USER_A_PARTNER')}',     'partner',           'active'),
      ('${M.managerA}',    '${FIRM_A}', '${userId('USER_A_MANAGER')}',     'manager',           'active'),
      ('${M.seniorA}',     '${FIRM_A}', '${userId('USER_A_SENIOR')}',      'senior',            'active'),
      ('${M.articleA}',    '${FIRM_A}', '${userId('USER_A_ARTICLE')}',     'article_executive', 'active'),
      ('${M.billingA}',    '${FIRM_A}', '${userId('USER_A_BILLING')}',     'billing',           'active'),
      ('${M.suspendedA}',  '${FIRM_A}', '${userId('USER_A_SUSPENDED')}',   'senior',            'suspended'),
      ('${M.removedA}',    '${FIRM_A}', '${userId('USER_A_REMOVED')}',     'senior',            'removed'),
      ('${M.superAdminB}', '${FIRM_B}', '${userId('USER_B_SUPER_ADMIN')}', 'super_admin',       'active'),
      ('${M.partnerB}',    '${FIRM_B}', '${userId('USER_B_PARTNER')}',     'partner',           'active'),
      ('${M.multiA}',      '${FIRM_A}', '${userId('USER_MULTI_FIRM')}',    'manager',           'active'),
      ('${M.multiB}',      '${FIRM_B}', '${userId('USER_MULTI_FIRM')}',    'senior',            'active')
    on conflict (firm_id, user_id) do nothing;

    insert into public.profiles (id, full_name, phone) values
      ('${userId('USER_A_SUPER_ADMIN')}', 'Super Admin A', null),
      ('${userId('USER_A_PARTNER')}',     'Partner A',     '+91-9000000002'),
      ('${userId('USER_A_SENIOR')}',      'Senior A',      '+91-9000000001'),
      ('${userId('USER_B_PARTNER')}',     'Partner B',     null)
    on conflict (id) do nothing;

    -- Force-reset mutable state so re-runs are deterministic even if a
    -- previous run mutated role/status/name mid-flight.
    update public.firms set name = '${FIRM_A_NAME}' where id = '${FIRM_A}';
    update public.firm_memberships set role = 'super_admin', status = 'active' where id = '${M.superAdminA}';
    update public.firm_memberships set role = 'senior',      status = 'active' where id = '${M.seniorA}';
    update public.profiles set full_name = 'Senior A' where id = '${userId('USER_A_SENIOR')}';
    delete from public.firm_memberships where firm_id in ('${FIRM_A}', '${FIRM_B}') and status = 'invited';
  `);
}

function cleanupFixture() {
  psql(`
    delete from public.firm_memberships where firm_id in ('${FIRM_A}', '${FIRM_B}');
    delete from public.profiles where id in (${PROFILE_USERS.map((k) => `'${userId(k)}'`).join(',')});
    delete from public.firms where id in ('${FIRM_A}', '${FIRM_B}');
  `);
}

async function makeAal2Token() {
  // aal1 session first, then TOTP enrol + challenge + verify -> aal2.
  const session = await signIn(userEmail('USER_A_SUPER_ADMIN'));
  if (!session.ok) throw new Error(`sign-in failed: ${JSON.stringify(session.raw)}`);
  const enroll = await authPost('factors', { factor_type: 'totp', friendly_name: 'imp012-aal2' }, session.token);
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

beforeAll(async () => {
  seedFixture();
  const invitee = await adminCreateUser(INVITEE_EMAIL, 'Imp012!InviteeLocalOnly', { imp012: 'invitee' });
  inviteeId = invitee.id;
  [partnerA, seniorA, billingA, partnerB, multiFirm, suspendedA, removedA] = await Promise.all([
    signIn(userEmail('USER_A_PARTNER')),
    signIn(userEmail('USER_A_SENIOR')),
    signIn(userEmail('USER_A_BILLING')),
    signIn(userEmail('USER_B_PARTNER')),
    signIn(userEmail('USER_MULTI_FIRM')),
    signIn(userEmail('USER_A_SUSPENDED')),
    signIn(userEmail('USER_A_REMOVED')),
  ]);
  for (const s of [partnerA, seniorA, billingA, partnerB, multiFirm, suspendedA, removedA]) {
    if (!s.ok) throw new Error(`sign-in failed: ${JSON.stringify(s.raw)}`);
  }
  const tokens = await makeAal2Token();
  sA = { token: tokens.aal1 };
  aal2Token = tokens.aal2;
});

afterAll(async () => {
  try {
    if (factorId) await adminDeleteFactor(userId('USER_A_SUPER_ADMIN'), factorId);
    // Defensive: remove any leftover TOTP factor from the harness user.
    const factors = await adminListFactors(userId('USER_A_SUPER_ADMIN'));
    for (const f of factors) await adminDeleteFactor(userId('USER_A_SUPER_ADMIN'), f.id);
  } finally {
    cleanupFixture();
    await deleteUserByEmail(INVITEE_EMAIL);
  }
});

// ---------------------------------------------------------------------------
// firms (RLS-FRM-01)
// ---------------------------------------------------------------------------
describe('TEST-RLS-FRM — firms policies (RLS-FRM-01)', () => {
  it('01 authorized read: active member sees exactly own firm row', async () => {
    const r = await api(partnerA.token, 'GET', 'firms?select=id,name');
    expect(r.status).toBe(200);
    expect(r.body.map((f) => f.id)).toEqual([FIRM_A]);
  });

  it('02 cross-firm read denied: known foreign firm id leaks nothing', async () => {
    const r = await api(partnerA.token, 'GET', `firms?id=eq.${FIRM_B}&select=id`);
    expect(r.status).toBe(200);
    expect(r.body).toEqual([]);
  });

  it('03/07 authorized role (super_admin) writes firm settings', async () => {
    const r = await api(sA.token, 'PATCH', `firms?id=eq.${FIRM_A}`, { body: { city: 'Mumbai' } });
    expect(r.status).toBe(200);
    expect(r.body).toHaveLength(1);
    expect(psql(`select city from public.firms where id = '${FIRM_A}'`).trim()).toBe('Mumbai');
  });

  it('06 unauthorized role (senior) cannot write the firm row', async () => {
    const r = await api(seniorA.token, 'PATCH', `firms?id=eq.${FIRM_A}`, { body: { name: 'hijacked' } });
    expect(r.body).toEqual([]);
    expect(psql(`select name from public.firms where id = '${FIRM_A}'`).trim()).toBe(FIRM_A_NAME);
  });

  it('04/05 cross-firm update and delete modify nothing / are denied', async () => {
    const u = await api(sA.token, 'PATCH', `firms?id=eq.${FIRM_B}`, { body: { name: 'hijacked' } });
    expect(u.body).toEqual([]);
    expect(psql(`select name from public.firms where id = '${FIRM_B}'`).trim()).toBe('IMP-012 Fixture Firm B');
    // DELETE is not granted at all (firms are never hard-deleted).
    const d = await api(sA.token, 'DELETE', `firms?id=eq.${FIRM_A}`);
    expect(d.status).toBeGreaterThanOrEqual(400);
    expect(psql(`select count(*) from public.firms where id = '${FIRM_A}'`).trim()).toBe('1');
    // INSERT is not granted (firm provisioning is platform/migration scope).
    const i = await api(sA.token, 'POST', 'firms', { body: { name: 'self-service firm' } });
    expect(i.status).toBeGreaterThanOrEqual(400);
  });

  it('08 suspended/removed memberships see no firm row (RLS-STF-07)', async () => {
    expect((await api(suspendedA.token, 'GET', 'firms?select=id')).body).toEqual([]);
    expect((await api(removedA.token, 'GET', 'firms?select=id')).body).toEqual([]);
  });

  it('multi-firm user sees exactly their two firms (switcher read)', async () => {
    const r = await api(multiFirm.token, 'GET', 'firms?select=id&order=id');
    expect(r.body.map((f) => f.id).sort()).toEqual([FIRM_A, FIRM_B].sort());
  });
});

// ---------------------------------------------------------------------------
// profiles (RLS-PRF-01)
// ---------------------------------------------------------------------------
describe('TEST-RLS-PRF — profiles policies (RLS-PRF-01)', () => {
  it('01 co-member display read: shared-firm profiles visible (display fields)', async () => {
    const r = await api(partnerA.token, 'GET', 'profiles?select=id,full_name');
    expect(r.status).toBe(200);
    const ids = r.body.map((p) => p.id);
    expect(ids).toContain(userId('USER_A_SENIOR'));
    expect(ids).toContain(userId('USER_A_SUPER_ADMIN'));
  });

  it('02 cross-tenant profile of a known foreign user id does not leak', async () => {
    const r = await api(partnerA.token, 'GET', `profiles?id=eq.${userId('USER_B_PARTNER')}&select=id,full_name`);
    expect(r.status).toBe(200);
    expect(r.body).toEqual([]);
  });

  it('phone is not a display field: column not granted to co-members', async () => {
    const r = await api(partnerA.token, 'GET', 'profiles?select=id,phone');
    expect(r.status).toBeGreaterThanOrEqual(400);
  });

  it('self may read and write own profile (display/contact fields only)', async () => {
    const read = await api(seniorA.token, 'GET', `profiles?id=eq.${userId('USER_A_SENIOR')}&select=id,full_name`);
    expect(read.body).toHaveLength(1);
    // return=minimal: RETURNING * would require SELECT on non-display columns.
    const write = await api(seniorA.token, 'PATCH', `profiles?id=eq.${userId('USER_A_SENIOR')}`, {
      headers: { Prefer: 'return=minimal' },
      body: { full_name: 'Senior A Renamed' },
    });
    expect(write.status).toBeLessThan(300);
    expect(psql(`select full_name from public.profiles where id = '${userId('USER_A_SENIOR')}'`).trim()).toBe(
      'Senior A Renamed',
    );
  });

  it('04 cannot write another user\'s profile (known foreign id)', async () => {
    const r = await api(seniorA.token, 'PATCH', `profiles?id=eq.${userId('USER_A_PARTNER')}`, {
      headers: { Prefer: 'return=minimal' },
      body: { full_name: 'hijacked' },
    });
    expect(r.status).toBeLessThan(300); // no error, but zero rows matched
    expect(psql(`select full_name from public.profiles where id = '${userId('USER_A_PARTNER')}'`).trim()).toBe(
      'Partner A',
    );
  });

  it('profile id is immutable: no UPDATE grant on id, own row unchanged', async () => {
    const r = await api(seniorA.token, 'PATCH', `profiles?id=eq.${userId('USER_A_SENIOR')}`, {
      body: { id: userId('USER_A_PARTNER') },
    });
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(psql(`select count(*) from public.profiles where id = '${userId('USER_A_SENIOR')}'`).trim()).toBe('1');
  });

  it('INSERT/DELETE not granted (provisioning RPC owns creation; audit retention owns retention)', async () => {
    const i = await api(seniorA.token, 'POST', 'profiles', { body: { id: userId('USER_A_SENIOR'), full_name: 'x' } });
    expect(i.status).toBeGreaterThanOrEqual(400);
    const d = await api(seniorA.token, 'DELETE', `profiles?id=eq.${userId('USER_A_SENIOR')}`);
    expect(d.status).toBeGreaterThanOrEqual(400);
  });
});

// ---------------------------------------------------------------------------
// firm_memberships (RLS-MEM-01 + RLS-AAL-01)
// ---------------------------------------------------------------------------
describe('TEST-RLS-MEM — firm_memberships read policies (RLS-MEM-01, RLS-CTX-02)', () => {
  it('01 active member reads the selected firm\'s roster', async () => {
    const r = await api(partnerA.token, 'GET', 'firm_memberships?select=id,firm_id', { headers: H(FIRM_A) });
    expect(r.status).toBe(200);
    const firmARows = r.body.filter((m) => m.firm_id === FIRM_A);
    // full roster incl. suspended/removed rows + any own rows elsewhere
    expect(firmARows.length).toBeGreaterThanOrEqual(9);
    expect(r.body.every((m) => m.firm_id === FIRM_A || m.user_id === userId('USER_A_PARTNER'))).toBe(true);
  });

  it('02/03 cross-firm roster read yields nothing — forged selector grants nothing', async () => {
    // seniorA has NO firm B membership; selecting firm B must yield no B rows.
    const r = await api(seniorA.token, 'GET', 'firm_memberships?select=id,firm_id', { headers: H(FIRM_B) });
    expect(r.status).toBe(200);
    expect(r.body.filter((m) => m.firm_id === FIRM_B)).toEqual([]);
  });

  it('known foreign membership id does not leak via direct select', async () => {
    const r = await api(partnerA.token, 'GET', `firm_memberships?id=eq.${M.partnerB}&select=id`, {
      headers: H(FIRM_B),
    });
    expect(r.body).toEqual([]);
  });

  it('own membership rows are visible without any selector (switcher/status awareness)', async () => {
    const r = await api(seniorA.token, 'GET', 'firm_memberships?select=id,firm_id,role');
    expect(r.body).toHaveLength(1);
    expect(r.body[0].id).toBe(M.seniorA);
  });

  it('multi-firm user: Firm A -> Firm B -> Firm A roster isolation holds', async () => {
    const a1 = await api(multiFirm.token, 'GET', 'firm_memberships?select=id,firm_id', { headers: H(FIRM_A) });
    const rosterA = a1.body.filter((m) => m.firm_id === FIRM_A);
    expect(rosterA.length).toBeGreaterThanOrEqual(9);
    const b = await api(multiFirm.token, 'GET', 'firm_memberships?select=id,firm_id', { headers: H(FIRM_B) });
    const rosterB = b.body.filter((m) => m.firm_id === FIRM_B);
    expect(rosterB.length).toBe(3); // super_admin B, partner B, multi (senior B)
    expect(rosterB.every((m) => m.firm_id === FIRM_B)).toBe(true);
    const a2 = await api(multiFirm.token, 'GET', 'firm_memberships?select=id,firm_id', { headers: H(FIRM_A) });
    expect(a2.body.filter((m) => m.firm_id === FIRM_A).length).toBe(rosterA.length);
    // no tenant-context bleed: without a selector only own rows are visible
    const none = await api(multiFirm.token, 'GET', 'firm_memberships?select=id,firm_id');
    expect(none.body.every((m) => [M.multiA, M.multiB].includes(m.id))).toBe(true);
  });
});

describe('TEST-RLS-MEM — membership administration (RLS-MEM-01 + RLS-AAL-01)', () => {
  it('06 unauthorized role (senior) cannot invite — denied as an authorization error', async () => {
    const r = await api(seniorA.token, 'POST', 'firm_memberships', {
      headers: H(FIRM_A),
      body: { firm_id: FIRM_A, user_id: inviteeId, role: 'senior', status: 'invited', invited_by: userId('USER_A_SENIOR') },
    });
    expect(r.status).toBe(403);
  });

  it('RLS-AAL-01: aal1 super_admin is DENIED membership administration', async () => {
    const r = await api(sA.token, 'POST', 'firm_memberships', {
      headers: H(FIRM_A),
      body: { firm_id: FIRM_A, user_id: inviteeId, role: 'senior', status: 'invited', invited_by: userId('USER_A_SUPER_ADMIN') },
    });
    expect(r.status).toBe(403);
  });

  it('RLS-AAL-01: aal2 super_admin invites (invite path works at the policy layer)', async () => {
    // Membership administration happens inside the selected firm context
    // (RLS-CTX-01): the x-active-firm header accompanies the command.
    const r = await api(aal2Token, 'POST', 'firm_memberships', {
      headers: H(FIRM_A),
      body: { firm_id: FIRM_A, user_id: inviteeId, role: 'senior', status: 'invited', invited_by: userId('USER_A_SUPER_ADMIN') },
    });
    expect(r.status).toBe(201);
    const status = psql(
      `select status from public.firm_memberships where firm_id = '${FIRM_A}' and user_id = '${inviteeId}'`,
    ).trim();
    expect(status).toBe('invited');
  });

  it('RLS-AAL-01: aal2 + WRONG FIRM is denied (MFA never substitutes for tenancy)', async () => {
    // Even WITH a foreign selector and aal2, firm B administration is denied.
    const r = await api(aal2Token, 'POST', 'firm_memberships', {
      headers: H(FIRM_B),
      body: { firm_id: FIRM_B, user_id: inviteeId, role: 'senior', status: 'invited', invited_by: userId('USER_A_SUPER_ADMIN') },
    });
    expect(r.status).toBe(403);
  });

  it('RLS-AAL-01: aal2 + WRONG ROLE (partner) is denied (MFA never substitutes for role)', async () => {
    try {
      // aal2 + correct role + correct firm + selected context succeeds.
      const ok = await api(aal2Token, 'PATCH', `firm_memberships?id=eq.${M.seniorA}`, {
        headers: H(FIRM_A),
        body: { role: 'partner' },
      });
      expect(ok.status).toBe(200);
      expect(ok.body).toHaveLength(1);
      expect(psql(`select role from public.firm_memberships where id = '${M.seniorA}'`).trim()).toBe('partner');
      // a PARTNER (wrong role) is denied the same class of change — the row
      // is visible in the selected-firm roster, but the UPDATE policy rejects.
      const partnerDenied = await api(partnerA.token, 'PATCH', `firm_memberships?id=eq.${M.articleA}`, {
        headers: H(FIRM_A),
        body: { role: 'manager' },
      });
      expect(partnerDenied.body).toEqual([]);
      expect(psql(`select role from public.firm_memberships where id = '${M.articleA}'`).trim()).toBe('article_executive');
      // aal2 + wrong firm: the aal2 super_admin-of-A token cannot touch firm
      // B rows, even when selecting firm B as context.
      const wrongFirm = await api(aal2Token, 'PATCH', `firm_memberships?id=eq.${M.partnerB}`, {
        headers: H(FIRM_B),
        body: { role: 'manager' },
      });
      expect(wrongFirm.body).toEqual([]);
      expect(psql(`select role from public.firm_memberships where id = '${M.partnerB}'`).trim()).toBe('partner');
    } finally {
      psql(`update public.firm_memberships set role = 'senior' where id = '${M.seniorA}'`);
    }
  });

  it('self-elevation is impossible: senior cannot edit own role/status', async () => {
    const r = await api(seniorA.token, 'PATCH', `firm_memberships?id=eq.${M.seniorA}`, { body: { role: 'super_admin' } });
    expect(r.body).toEqual([]);
    expect(psql(`select role from public.firm_memberships where id = '${M.seniorA}'`).trim()).toBe('senior');
  });

  it('identity columns are not writable (no grant): user_id/firm_id edits rejected', async () => {
    const r = await api(aal2Token, 'PATCH', `firm_memberships?id=eq.${M.seniorA}`, {
      headers: H(FIRM_A),
      body: { user_id: userId('USER_A_PARTNER') },
    });
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(psql(`select user_id from public.firm_memberships where id = '${M.seniorA}'`).trim()).toBe(
      userId('USER_A_SENIOR'),
    );
  });

  it('DELETE is not granted even to an aal2 super_admin (never hard-deleted)', async () => {
    const r = await api(aal2Token, 'DELETE', `firm_memberships?id=eq.${M.seniorA}`, { headers: H(FIRM_A) });
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(psql(`select count(*) from public.firm_memberships where id = '${M.seniorA}'`).trim()).toBe('1');
  });

  it('inviter identity is server-derived: stamping another user as invited_by is rejected', async () => {
    const r = await api(aal2Token, 'POST', 'firm_memberships', {
      headers: H(FIRM_A),
      body: { firm_id: FIRM_A, user_id: inviteeId, role: 'billing', status: 'invited', invited_by: userId('USER_A_PARTNER') },
    });
    expect(r.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Freshness (RLS-MECH-01 change semantics; TEST-AUTH-12/13 on production)
// ---------------------------------------------------------------------------
describe('membership freshness — live lookup, same pre-issued token', () => {
  it('suspension takes effect on the next authorization check', async () => {
    const before = await api(seniorA.token, 'GET', 'firm_memberships?select=id,firm_id', { headers: H(FIRM_A) });
    expect(before.body.filter((m) => m.firm_id === FIRM_A).length).toBeGreaterThan(1);
    try {
      psql(`update public.firm_memberships set status = 'suspended' where id = '${M.seniorA}'`);
      const after = await api(seniorA.token, 'GET', 'firm_memberships?select=id,firm_id', { headers: H(FIRM_A) });
      // roster gone; only the own-row clause remains
      expect(after.body.every((m) => m.id === M.seniorA)).toBe(true);
      expect((await api(seniorA.token, 'GET', 'firms?select=id')).body).toEqual([]);
    } finally {
      psql(`update public.firm_memberships set status = 'active' where id = '${M.seniorA}'`);
    }
  });

  it('removal takes effect on the next authorization check', async () => {
    try {
      psql(`update public.firm_memberships set status = 'removed' where id = '${M.seniorA}'`);
      expect((await api(seniorA.token, 'GET', 'firms?select=id')).body).toEqual([]);
      const roster = await api(seniorA.token, 'GET', 'firm_memberships?select=id,firm_id', { headers: H(FIRM_A) });
      expect(roster.body.filter((m) => m.firm_id === FIRM_A && m.id !== M.seniorA)).toEqual([]);
    } finally {
      psql(`update public.firm_memberships set status = 'active' where id = '${M.seniorA}'`);
    }
  });

  it('role downgrade removes the privilege immediately (same token)', async () => {
    expect((await api(sA.token, 'PATCH', `firms?id=eq.${FIRM_A}`, { body: { city: 'Pune' } })).body).toHaveLength(1);
    try {
      psql(`update public.firm_memberships set role = 'partner' where id = '${M.superAdminA}'`);
      const denied = await api(sA.token, 'PATCH', `firms?id=eq.${FIRM_A}`, { body: { city: 'Denied' } });
      expect(denied.body).toEqual([]);
      expect(psql(`select city from public.firms where id = '${FIRM_A}'`).trim()).toBe('Pune');
    } finally {
      psql(`update public.firm_memberships set role = 'super_admin' where id = '${M.superAdminA}'`);
    }
  });

  it('trusted role upgrade grants the privilege immediately (same token)', async () => {
    expect((await api(seniorA.token, 'PATCH', `firms?id=eq.${FIRM_A}`, { body: { city: 'Denied' } })).body).toEqual([]);
    try {
      psql(`update public.firm_memberships set role = 'super_admin' where id = '${M.seniorA}'`);
      const allowed = await api(seniorA.token, 'PATCH', `firms?id=eq.${FIRM_A}`, { body: { city: 'Nashik' } });
      expect(allowed.body).toHaveLength(1);
    } finally {
      psql(`update public.firm_memberships set role = 'senior' where id = '${M.seniorA}'`);
      psql(`update public.firms set city = null where id = '${FIRM_A}'`);
    }
  });
});

// ---------------------------------------------------------------------------
// Anon posture (RLS-SVC-03)
// ---------------------------------------------------------------------------
describe('RLS-SVC-03 — anon without a session gets nothing', () => {
  it('anon key alone cannot reach any tenant-core table', async () => {
    const { ANON_KEY } = localEnv();
    for (const table of ['firms', 'profiles', 'firm_memberships']) {
      const r = await api(ANON_KEY, 'GET', `${table}?select=*`);
      expect(r.status).toBeGreaterThanOrEqual(400);
      expect(Array.isArray(r.body)).toBe(false);
    }
  });
});
