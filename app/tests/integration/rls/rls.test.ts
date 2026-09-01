/**
 * Harness Gate — RLS integration tests (resolved DEC-J mechanism).
 *
 * Temporary harness-only objects (hgate_* — NOT Release-0 schema) are applied
 * in beforeAll and dropped in afterAll; public application-table count
 * returns to zero. Authorization model under test (05 RLS-MECH-01):
 *   auth.uid() + selected firm (UNTRUSTED context) -> LIVE membership lookup.
 * All authorization assertions use signed-in user access tokens via
 * PostgREST — never service-role. Service-role/admin access (psql) is used
 * only for fixture setup, membership mutation, and teardown.
 *
 * TEST mapping (spec 11):
 *   TEST-RLS-GEN-01 fixture tenants/roles; TEST-RLS-GEN-02 offensive posture
 *   (known foreign ids, forged selector); TEST-RLS-GEN-03 case set incl.
 *   suspension/removal, multi-firm isolation, staff/client overlap;
 *   TEST-RLS-GEN-04 mutation-denial surfacing; TEST-RLS-MAT-01 role matrix
 *   (mechanism level); TEST-AUTH-12/13 suspended/removed loses access.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  FIRM_A,
  FIRM_B,
  api,
  psql,
  psqlFile,
  signIn,
  userEmail,
} from '../helpers.mjs';

const H = (firm, extra = {}) => ({ 'x-active-firm': firm, ...extra });
const M = {
  articleA: '80000000-0000-4000-8000-000000000003',
  seniorA: '80000000-0000-4000-8000-000000000002',
  partnerA: '80000000-0000-4000-8000-000000000001',
};
const setMembership = (id, patch) =>
  psql(`update public.hgate_memberships set ${patch} where id = '${id}'`);

const FOREIGN_ID = 201; // firm B row — known attack target (TEST-RLS-GEN-02)

let partnerA, seniorA, articleA, billingA, partnerB, multifirm, suspendedA, removedA, overlap;

beforeAll(async () => {
  psqlFile('tests/integration/rls/setup.sql');
  [partnerA, seniorA, articleA, billingA, partnerB, multifirm, suspendedA, removedA, overlap] =
    await Promise.all([
      signIn(userEmail('USER_A_PARTNER')),
      signIn(userEmail('USER_A_SENIOR')),
      signIn(userEmail('USER_A_ARTICLE')),
      signIn(userEmail('USER_A_BILLING')),
      signIn(userEmail('USER_B_PARTNER')),
      signIn(userEmail('USER_MULTI_FIRM')),
      signIn(userEmail('USER_A_SUSPENDED')),
      signIn(userEmail('USER_A_REMOVED')),
      signIn(userEmail('USER_CLIENT_OVERLAP')),
    ]);
  for (const s of [partnerA, seniorA, articleA, billingA, partnerB, multifirm, suspendedA, removedA, overlap]) {
    if (!s.ok) throw new Error(`sign-in failed: ${JSON.stringify(s.raw)}`);
  }
});

afterAll(() => {
  psqlFile('tests/integration/rls/teardown.sql');
  const left = psql(
    `select count(*) from information_schema.tables where table_schema='public' and table_name like 'hgate%'`,
  );
  expect(left.trim()).toBe('0');
});

describe('TEST-RLS-GEN-01/03 — same-firm authorized access', () => {
  it('firm A member reads exactly the firm A rows (selected-firm context)', async () => {
    const expected = Number(psql(`select count(*) from public.hgate_resources where firm_id = '${FIRM_A}'`));
    const r = await api(partnerA.token, 'GET', 'hgate_resources?select=id,firm_id', { headers: H(FIRM_A) });
    expect(r.status).toBe(200);
    expect(r.body.length).toBe(expected);
    expect(r.body.every((row) => row.firm_id === FIRM_A)).toBe(true);
  });

  it('authorized role (partner) inserts in own firm', async () => {
    const r = await api(partnerA.token, 'POST', 'hgate_resources', {
      headers: H(FIRM_A),
      body: { firm_id: FIRM_A, name: 'rls-partner-insert' },
    });
    expect(r.status).toBe(201);
  });
});

describe('TEST-RLS-GEN-02 — offensive posture', () => {
  it('cross-firm read returns nothing (firm A user, firm B context)', async () => {
    const r = await api(partnerA.token, 'GET', 'hgate_resources?select=id', { headers: H(FIRM_B) });
    expect(r.status).toBe(200);
    expect(r.body).toEqual([]);
  });

  it('known foreign record ID does not leak via direct select', async () => {
    const r = await api(partnerA.token, 'GET', `hgate_resources?id=eq.${FOREIGN_ID}&select=id`, {
      headers: H(FIRM_B),
    });
    expect(r.body).toEqual([]);
    const r2 = await api(partnerA.token, 'GET', `hgate_resources?id=eq.${FOREIGN_ID}&select=id`, {
      headers: H(FIRM_A),
    });
    expect(r2.body).toEqual([]);
  });

  it('forged active-firm selector grants nothing', async () => {
    // seniorA has NO firm B membership; merely selecting firm B must yield nothing.
    const r = await api(seniorA.token, 'GET', 'hgate_resources?select=id', { headers: H(FIRM_B) });
    expect(r.status).toBe(200);
    expect(r.body).toEqual([]);
    const w = await api(seniorA.token, 'POST', 'hgate_resources', {
      headers: H(FIRM_B),
      body: { firm_id: FIRM_B, name: 'forged' },
    });
    expect(w.status).toBeGreaterThanOrEqual(400);
  });
});

describe('TEST-RLS-GEN-04 — mutation denial surfacing', () => {
  it('cross-firm insert is denied as an authorization error', async () => {
    const r = await api(partnerA.token, 'POST', 'hgate_resources', {
      headers: H(FIRM_B),
      body: { firm_id: FIRM_B, name: 'x-firm-insert' },
    });
    expect(r.status).toBe(403);
  });

  it('cross-firm update by foreign id modifies nothing', async () => {
    const r = await api(partnerA.token, 'PATCH', `hgate_resources?id=eq.${FOREIGN_ID}`, {
      headers: H(FIRM_B),
      body: { name: 'hijacked' },
    });
    expect(r.body).toEqual([]);
    const check = psql(`select name from public.hgate_resources where id = ${FOREIGN_ID}`);
    expect(check.trim()).toBe(`res-${FOREIGN_ID}`);
  });

  it('cross-firm delete by foreign id deletes nothing', async () => {
    const r = await api(partnerA.token, 'DELETE', `hgate_resources?id=eq.${FOREIGN_ID}`, {
      headers: H(FIRM_B),
    });
    expect(r.body).toEqual([]);
    const check = psql(`select count(*) from public.hgate_resources where id = ${FOREIGN_ID}`);
    expect(check.trim()).toBe('1');
  });
});

describe('TEST-RLS-MAT-01 — role matrix (mechanism level)', () => {
  it('unauthorized role (billing) is denied insert', async () => {
    const r = await api(billingA.token, 'POST', 'hgate_resources', {
      headers: H(FIRM_A),
      body: { firm_id: FIRM_A, name: 'billing-insert' },
    });
    expect(r.status).toBe(403);
  });

  it('senior is denied delete; partner is allowed delete', async () => {
    // temp rows as delete targets
    const mk = async (name) => {
      const r = await api(partnerA.token, 'POST', 'hgate_resources', {
        headers: H(FIRM_A),
        body: { firm_id: FIRM_A, name },
      });
      return r.body[0].id;
    };
    const id1 = await mk('rls-del-senior');
    const denied = await api(seniorA.token, 'DELETE', `hgate_resources?id=eq.${id1}`, {
      headers: H(FIRM_A),
    });
    expect(denied.body).toEqual([]);
    expect(psql(`select count(*) from public.hgate_resources where id = ${id1}`).trim()).toBe('1');
    const id2 = await mk('rls-del-partner');
    const allowed = await api(partnerA.token, 'DELETE', `hgate_resources?id=eq.${id2}`, {
      headers: H(FIRM_A),
    });
    expect(allowed.body.length).toBe(1);
  });
});

describe('TEST-AUTH-12/13 + role-change freshness (live lookup, same token)', () => {
  it('static suspended membership has no access', async () => {
    const r = await api(suspendedA.token, 'GET', 'hgate_resources?select=id', { headers: H(FIRM_A) });
    expect(r.body).toEqual([]);
  });

  it('static removed membership has no access', async () => {
    const r = await api(removedA.token, 'GET', 'hgate_resources?select=id', { headers: H(FIRM_A) });
    expect(r.body).toEqual([]);
  });

  it('suspension takes effect immediately on a pre-issued token', async () => {
    const expected = Number(psql(`select count(*) from public.hgate_resources where firm_id = '${FIRM_A}'`));
    const before = await api(articleA.token, 'GET', 'hgate_resources?select=id', { headers: H(FIRM_A) });
    expect(before.body.length).toBe(expected);
    try {
      setMembership(M.articleA, `status = 'suspended'`);
      const after = await api(articleA.token, 'GET', 'hgate_resources?select=id', { headers: H(FIRM_A) });
      expect(after.body).toEqual([]);
    } finally {
      setMembership(M.articleA, `status = 'active'`);
    }
  });

  it('removal takes effect immediately on a pre-issued token', async () => {
    try {
      setMembership(M.articleA, `status = 'removed'`);
      const after = await api(articleA.token, 'GET', 'hgate_resources?select=id', { headers: H(FIRM_A) });
      expect(after.body).toEqual([]);
    } finally {
      setMembership(M.articleA, `status = 'active'`);
    }
  });

  it('role downgrade takes effect immediately (partner -> senior loses delete)', async () => {
    const mk = async (name) => {
      const r = await api(partnerA.token, 'POST', 'hgate_resources', {
        headers: H(FIRM_A),
        body: { firm_id: FIRM_A, name },
      });
      return r.body[0].id;
    };
    const id1 = await mk('rls-downgrade-1');
    expect((await api(partnerA.token, 'DELETE', `hgate_resources?id=eq.${id1}`, { headers: H(FIRM_A) })).body.length).toBe(1);
    try {
      setMembership(M.partnerA, `role = 'senior'`);
      const id2 = await mk('rls-downgrade-2');
      const denied = await api(partnerA.token, 'DELETE', `hgate_resources?id=eq.${id2}`, { headers: H(FIRM_A) });
      expect(denied.body).toEqual([]);
    } finally {
      setMembership(M.partnerA, `role = 'partner'`);
    }
  });

  it('role upgrade takes effect immediately (senior -> partner gains delete)', async () => {
    const mk = async (name) => {
      const r = await api(partnerA.token, 'POST', 'hgate_resources', {
        headers: H(FIRM_A),
        body: { firm_id: FIRM_A, name },
      });
      return r.body[0].id;
    };
    const id1 = await mk('rls-upgrade-1');
    expect((await api(seniorA.token, 'DELETE', `hgate_resources?id=eq.${id1}`, { headers: H(FIRM_A) })).body).toEqual([]);
    try {
      setMembership(M.seniorA, `role = 'partner'`);
      const id2 = await mk('rls-upgrade-2');
      expect((await api(seniorA.token, 'DELETE', `hgate_resources?id=eq.${id2}`, { headers: H(FIRM_A) })).body.length).toBe(1);
    } finally {
      setMembership(M.seniorA, `role = 'senior'`);
    }
  });
});

describe('TEST-RLS-GEN-03 — multi-firm switching and staff/client overlap', () => {
  it('multi-firm user: Firm A -> Firm B -> Firm A isolation holds', async () => {
    const countA = Number(psql(`select count(*) from public.hgate_resources where firm_id = '${FIRM_A}'`));
    const countB = Number(psql(`select count(*) from public.hgate_resources where firm_id = '${FIRM_B}'`));
    const a1 = await api(multifirm.token, 'GET', 'hgate_resources?select=id,firm_id', { headers: H(FIRM_A) });
    expect(a1.body.length).toBe(countA);
    expect(a1.body.every((row) => row.firm_id === FIRM_A)).toBe(true);
    const b = await api(multifirm.token, 'GET', 'hgate_resources?select=id,firm_id', { headers: H(FIRM_B) });
    expect(b.body.length).toBe(countB);
    expect(b.body.every((row) => row.firm_id === FIRM_B)).toBe(true);
    const a2 = await api(multifirm.token, 'GET', 'hgate_resources?select=id,firm_id', { headers: H(FIRM_A) });
    expect(a2.body.length).toBe(countA);
    expect(a2.body.every((row) => row.firm_id === FIRM_A)).toBe(true);
  });

  it('staff/client overlap: client context sees only granted client rows', async () => {
    const expectedStaff = Number(psql(`select count(*) from public.hgate_resources where firm_id = '${FIRM_A}'`));
    const clientCtx = H(FIRM_A, { 'x-hgate-context': 'client' });
    const client = await api(overlap.token, 'GET', 'hgate_resources?select=id&order=id', { headers: clientCtx });
    expect(client.body.length).toBe(10); // only CL-100 rows (ids 20,40,…,200)
    const staff = await api(overlap.token, 'GET', 'hgate_resources?select=id', { headers: H(FIRM_A) });
    expect(staff.body.length).toBe(expectedStaff); // staff context uses the membership
    // client context cannot see a staff-only (non-client) row
    const staffOnly = await api(overlap.token, 'GET', 'hgate_resources?id=eq.1&select=id', { headers: clientCtx });
    expect(staffOnly.body).toEqual([]);
  });
});
