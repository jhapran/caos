/**
 * IMP-021 — Engagement RLS integration tests (SCH-09, RLS-ENG-01).
 *
 * Exercises the REAL production policies on public.engagements through
 * PostgREST with signed-in access tokens — never service-role for
 * authorization assertions. Service-side psql is used only for fixture
 * setup, controlled membership mutation, and teardown.
 *
 * Role posture under test (05 §11 matrix, RLS-ENG-01, RLS-STF-03/04/07):
 *   super_admin/partner — full active-firm read + write ("partner+ write");
 *   manager             — READ ONLY, portfolio-scoped via the owning
 *                         client's manager_membership_id (RLS-STF-03);
 *   billing             — NO table access; letter-status-only projection
 *                         via list_engagement_letter_statuses() with the
 *                         RLS-A-04 active-firm pin;
 *   senior/article      — NOTHING in R0 (assigned-work scope needs
 *                         tasks/instances — recorded deferral, IMP-020
 *                         precedent);
 *   suspended/removed   — nothing (RLS-STF-07).
 *
 * TEST mapping (spec 11):
 *   TEST-RLS-MAT-01 — role-matrix cells for engagements;
 *   TEST-RLS-GEN-01 fixture tenants / GEN-02 offensive posture (known
 *   foreign ids, forged selector) / GEN-03 case set (suspension, removal,
 *   role change, multi-firm switching) / GEN-04 mutation-denial surfacing;
 *   TEST-AUTH-12/13 — suspension/removal freshness with the same JWT.
 *
 * Re-runnable: deterministic ids in the 97000000-… range, force-reset on
 * every run; fixture audit rows removed as the operator in teardown
 * (append-only applies to application roles, AUD-INV-01).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { api, FIRM_A, FIRM_B, psql, signIn, userEmail, userId } from '../helpers.mjs';

const H = (firm: string) => ({ 'x-active-firm': firm });

const M = {
  partnerA: '97000000-0000-4000-8000-000000000001',
  superAdminA: '97000000-0000-4000-8000-000000000002',
  managerA: '97000000-0000-4000-8000-000000000003',
  managerBInA: '97000000-0000-4000-8000-000000000004',
  seniorA: '97000000-0000-4000-8000-000000000005',
  billingA: '97000000-0000-4000-8000-000000000006',
  suspendedA: '97000000-0000-4000-8000-000000000007',
  removedA: '97000000-0000-4000-8000-000000000008',
  multiA: '97000000-0000-4000-8000-000000000009',
  partnerB: '97000000-0000-4000-8000-00000000000a',
  multiB: '97000000-0000-4000-8000-00000000000b',
  billingB: '97000000-0000-4000-8000-00000000000c',
};

const C = {
  inPortfolio: '97000000-0000-4000-8000-000000000101', // manager = managerA
  otherManaged: '97000000-0000-4000-8000-000000000102', // manager = managerBInA
  unassigned: '97000000-0000-4000-8000-000000000103', // manager = null
  multiManaged: '97000000-0000-4000-8000-000000000104', // manager = multiA
  firmB: '97000000-0000-4000-8000-000000000111',
};
const G = {
  inPortfolio: '97000000-0000-4000-8000-000000000201',
  otherManaged: '97000000-0000-4000-8000-000000000202',
  unassigned: '97000000-0000-4000-8000-000000000203',
  multiManaged: '97000000-0000-4000-8000-000000000204',
  firmB: '97000000-0000-4000-8000-000000000211',
};

const PARTNER_A = userId('USER_A_PARTNER');
const SUPER_ADMIN_A = userId('USER_A_SUPER_ADMIN');
const MANAGER_A = userId('USER_A_MANAGER');
const MANAGER_B = userId('USER_B_MANAGER');
const SENIOR_A = userId('USER_A_SENIOR');
const BILLING_A = userId('USER_A_BILLING');
const SUSPENDED_A = userId('USER_A_SUSPENDED');
const REMOVED_A = userId('USER_A_REMOVED');
const MULTI = userId('USER_MULTI_FIRM');
const PARTNER_B = userId('USER_B_PARTNER');

let partnerA: string;
let superAdminA: string;
let managerA: string;
let seniorA: string;
let billingA: string;
let suspendedA: string;
let removedA: string;
let multiFirm: string;
let partnerB: string;

function cleanRows() {
  psql(`
    delete from public.engagements where firm_id in ('${FIRM_A}', '${FIRM_B}');
    delete from public.clients where firm_id in ('${FIRM_A}', '${FIRM_B}');
    delete from public.audit_log where firm_id in ('${FIRM_A}', '${FIRM_B}');
  `);
}

function seedFixture() {
  cleanRows();
  psql(`
    insert into public.firms (id, name) values
      ('${FIRM_A}', 'IMP-021 RLS Firm A'),
      ('${FIRM_B}', 'IMP-021 RLS Firm B')
    on conflict (id) do nothing;

    insert into public.firm_memberships (id, firm_id, user_id, role, status) values
      ('${M.partnerA}',     '${FIRM_A}', '${PARTNER_A}',     'partner',     'active'),
      ('${M.superAdminA}',  '${FIRM_A}', '${SUPER_ADMIN_A}', 'super_admin', 'active'),
      ('${M.managerA}',     '${FIRM_A}', '${MANAGER_A}',     'manager',     'active'),
      ('${M.managerBInA}',  '${FIRM_A}', '${MANAGER_B}',     'manager',     'active'),
      ('${M.seniorA}',      '${FIRM_A}', '${SENIOR_A}',      'senior',      'active'),
      ('${M.billingA}',     '${FIRM_A}', '${BILLING_A}',     'billing',     'active'),
      ('${M.suspendedA}',   '${FIRM_A}', '${SUSPENDED_A}',   'senior',      'suspended'),
      ('${M.removedA}',     '${FIRM_A}', '${REMOVED_A}',     'senior',      'removed'),
      ('${M.multiA}',       '${FIRM_A}', '${MULTI}',         'manager',     'active'),
      ('${M.partnerB}',     '${FIRM_B}', '${PARTNER_B}',     'partner',     'active'),
      ('${M.multiB}',       '${FIRM_B}', '${MULTI}',         'senior',      'active'),
      ('${M.billingB}',     '${FIRM_B}', '${BILLING_A}',     'billing',     'active')
    on conflict (firm_id, user_id) do nothing;

    -- Force-reset mutable state so re-runs are deterministic even if a
    -- previous run mutated status/role mid-flight (freshness cases).
    update public.firm_memberships set status = 'active', role = 'partner' where id = '${M.partnerA}';
    update public.firm_memberships set status = 'active', role = 'billing' where id = '${M.billingA}';
    update public.firm_memberships set status = 'suspended' where id = '${M.suspendedA}';
    update public.firm_memberships set status = 'removed' where id = '${M.removedA}';

    insert into public.clients (id, firm_id, name, owner_partner_membership_id, manager_membership_id, status) values
      ('${C.inPortfolio}',  '${FIRM_A}', 'ENG RLS InPortfolio',  '${M.partnerA}', '${M.managerA}',    'active'),
      ('${C.otherManaged}', '${FIRM_A}', 'ENG RLS OtherManaged', '${M.partnerA}', '${M.managerBInA}', 'active'),
      ('${C.unassigned}',   '${FIRM_A}', 'ENG RLS Unassigned',   '${M.partnerA}', null,               'active'),
      ('${C.multiManaged}', '${FIRM_A}', 'ENG RLS MultiManaged', '${M.partnerA}', '${M.multiA}',      'active'),
      ('${C.firmB}',        '${FIRM_B}', 'ENG RLS FirmB',        '${M.partnerB}', null,               'active');

    insert into public.engagements (id, firm_id, client_id, responsible_partner_membership_id, service_lines, status, letter_status) values
      ('${G.inPortfolio}',  '${FIRM_A}', '${C.inPortfolio}',  '${M.partnerA}', '{GST,TDS}',  'active', 'signed'),
      ('${G.otherManaged}', '${FIRM_A}', '${C.otherManaged}', '${M.partnerA}', '{Audit}',    'active', 'issued'),
      ('${G.unassigned}',   '${FIRM_A}', '${C.unassigned}',   '${M.partnerA}', '{ITR}',      'draft',  'not_started'),
      ('${G.multiManaged}', '${FIRM_A}', '${C.multiManaged}', '${M.partnerA}', '{MCA}',      'active', 'signed'),
      ('${G.firmB}',        '${FIRM_B}', '${C.firmB}',        '${M.partnerB}', '{GST}',      'active', 'signed');
  `);
}

beforeAll(async () => {
  seedFixture();
  partnerA = (await signIn(userEmail('USER_A_PARTNER'))).token;
  superAdminA = (await signIn(userEmail('USER_A_SUPER_ADMIN'))).token;
  managerA = (await signIn(userEmail('USER_A_MANAGER'))).token;
  seniorA = (await signIn(userEmail('USER_A_SENIOR'))).token;
  billingA = (await signIn(userEmail('USER_A_BILLING'))).token;
  suspendedA = (await signIn(userEmail('USER_A_SUSPENDED'))).token;
  removedA = (await signIn(userEmail('USER_A_REMOVED'))).token;
  multiFirm = (await signIn(userEmail('USER_MULTI_FIRM'))).token;
  partnerB = (await signIn(userEmail('USER_B_PARTNER'))).token;
});

afterAll(() => {
  // Child rows first — the membership/firm deletes would otherwise trip
  // the hierarchy FKs, and leaving rows behind poisons the next suite in
  // the sequential chain.
  cleanRows();
  psql(`
    delete from public.firm_memberships where firm_id in ('${FIRM_A}', '${FIRM_B}');
    delete from public.firms where id in ('${FIRM_A}', '${FIRM_B}');
  `);
});

describe('TEST-RLS-MAT-01 — read posture per role (engagements)', () => {
  it('super_admin reads every engagement of the active firm, and only that firm', async () => {
    const res = await api(superAdminA, 'GET', 'engagements?select=id', { headers: H(FIRM_A) });
    expect(res.status).toBe(200);
    const ids = res.body.map((r: { id: string }) => r.id);
    expect(ids).toEqual(
      expect.arrayContaining([G.inPortfolio, G.otherManaged, G.unassigned, G.multiManaged]),
    );
    expect(ids).not.toContain(G.firmB);
  });

  it('partner reads every engagement of the active firm', async () => {
    const res = await api(partnerA, 'GET', 'engagements?select=id', { headers: H(FIRM_A) });
    expect(res.status).toBe(200);
    expect(res.body.map((r: { id: string }) => r.id)).toEqual(
      expect.arrayContaining([G.inPortfolio, G.otherManaged, G.unassigned, G.multiManaged]),
    );
  });

  it('manager reads only engagements of portfolio clients (RLS-STF-03)', async () => {
    const res = await api(managerA, 'GET', 'engagements?select=id', { headers: H(FIRM_A) });
    expect(res.status).toBe(200);
    expect(res.body.map((r: { id: string }) => r.id)).toEqual([G.inPortfolio]);
  });

  it('senior/article read NOTHING in R0 (RLS-STF-04 needs assigned-work tables)', async () => {
    const res = await api(seniorA, 'GET', 'engagements?select=id', { headers: H(FIRM_A) });
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('billing reads NO engagement rows — the projection RPC is the only path (RLS-ENG-01)', async () => {
    const res = await api(billingA, 'GET', 'engagements?select=id', { headers: H(FIRM_A) });
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
    const rpc = await api(billingA, 'POST', 'rpc/list_engagement_letter_statuses', {
      headers: H(FIRM_A),
      body: { p_firm_id: FIRM_A },
    });
    expect(rpc.status).toBe(200);
    const ids = rpc.body.map((r: { id: string }) => r.id);
    expect(ids).toEqual(
      expect.arrayContaining([G.inPortfolio, G.otherManaged, G.unassigned, G.multiManaged]),
    );
    // letter-status-only: no service lines/responsibility/dates leakage
    expect(Object.keys(rpc.body[0]).sort()).toEqual(['client_id', 'id', 'letter_status']);
  });

  it('the projection RPC authorizes itself — partner/manager/senior get nothing from it', async () => {
    for (const token of [partnerA, managerA, seniorA]) {
      const rpc = await api(token, 'POST', 'rpc/list_engagement_letter_statuses', {
        headers: H(FIRM_A),
        body: { p_firm_id: FIRM_A },
      });
      expect(rpc.status).toBe(200);
      expect(rpc.body).toEqual([]);
    }
  });

  it('the projection RPC enforces the single-active-firm pin (RLS-A-04 pattern)', async () => {
    // Billing seat exists in BOTH firms; selector A + p_firm_id B is denied.
    const mismatched = await api(billingA, 'POST', 'rpc/list_engagement_letter_statuses', {
      headers: H(FIRM_A),
      body: { p_firm_id: FIRM_B },
    });
    expect(mismatched.status).toBe(200);
    expect(mismatched.body).toEqual([]);
    const okB = await api(billingA, 'POST', 'rpc/list_engagement_letter_statuses', {
      headers: H(FIRM_B),
      body: { p_firm_id: FIRM_B },
    });
    expect(okB.body.map((r: { id: string }) => r.id)).toEqual([G.firmB]);
  });
});

describe('TEST-RLS-MAT-01 / GEN-04 — write posture per role', () => {
  it('super_admin creates and updates engagements in the active firm', async () => {
    const created = await api(superAdminA, 'POST', 'engagements', {
      headers: H(FIRM_A),
      body: {
        firm_id: FIRM_A,
        client_id: C.unassigned,
        responsible_partner_membership_id: M.superAdminA,
        service_lines: ['GST'],
      },
    });
    expect(created.status).toBe(201);
    const id = created.body[0].id;
    expect(created.body[0].status).toBe('draft');
    const updated = await api(superAdminA, 'PATCH', `engagements?id=eq.${id}`, {
      headers: H(FIRM_A),
      body: { status: 'proposed', letter_status: 'issued' },
    });
    expect(updated.status).toBe(200);
    expect(updated.body[0].status).toBe('proposed');
  });

  it('partner creates and updates engagements in the active firm', async () => {
    const created = await api(partnerA, 'POST', 'engagements', {
      headers: H(FIRM_A),
      body: {
        firm_id: FIRM_A,
        client_id: C.inPortfolio,
        responsible_partner_membership_id: M.partnerA,
        service_lines: ['ITR'],
      },
    });
    expect(created.status).toBe(201);
    const id = created.body[0].id;
    const updated = await api(partnerA, 'PATCH', `engagements?id=eq.${id}`, {
      headers: H(FIRM_A),
      body: { period_label: 'FY 2025-26' },
    });
    expect(updated.status).toBe(200);
  });

  it('manager is READ-ONLY on engagements (RLS-ENG-01 partner+ write)', async () => {
    const create = await api(managerA, 'POST', 'engagements', {
      headers: H(FIRM_A),
      body: {
        firm_id: FIRM_A,
        client_id: C.inPortfolio,
        responsible_partner_membership_id: M.partnerA,
      },
    });
    expect(create.status).toBe(403);
    // Even a portfolio-visible row: the UPDATE using-clause excludes
    // managers — silent zero-row, no existence leak (API-ERR-02).
    const update = await api(managerA, 'PATCH', `engagements?id=eq.${G.inPortfolio}`, {
      headers: H(FIRM_A),
      body: { period_label: 'FY 2026-27' },
    });
    expect(update.status).toBe(200);
    expect(update.body).toEqual([]);
    const check = psql(
      `select coalesce(period_label, '<null>') from public.engagements where id = '${G.inPortfolio}'`,
    ).trim();
    expect(check).toBe('<null>');
  });

  it('senior and billing cannot write anything (GEN-04 denial surfacing)', async () => {
    for (const token of [seniorA, billingA]) {
      const res = await api(token, 'POST', 'engagements', {
        headers: H(FIRM_A),
        body: {
          firm_id: FIRM_A,
          client_id: C.inPortfolio,
          responsible_partner_membership_id: M.partnerA,
        },
      });
      expect(res.status).toBe(403);
    }
  });

  it('DELETE is not granted to anyone (lifecycle statuses only)', async () => {
    const res = await api(partnerA, 'DELETE', `engagements?id=eq.${G.unassigned}`, {
      headers: H(FIRM_A),
    });
    expect(res.status).toBe(403);
  });

  it('DM-SM-03 transitions hold through the API: backward edges fail, happy path works', async () => {
    const created = await api(partnerA, 'POST', 'engagements', {
      headers: H(FIRM_A),
      body: {
        firm_id: FIRM_A,
        client_id: C.otherManaged,
        responsible_partner_membership_id: M.partnerA,
      },
    });
    const id = created.body[0].id;
    // draft -> active skips proposed: 23514 with the INVALID_TRANSITION marker.
    const skip = await api(partnerA, 'PATCH', `engagements?id=eq.${id}`, {
      headers: H(FIRM_A),
      body: { status: 'active' },
    });
    expect(skip.status).toBe(400);
    expect(skip.body.code).toBe('23514');
    expect(skip.body.details).toContain('INVALID_TRANSITION:engagements.status');
    // draft -> proposed -> active -> terminated (with reason): legal.
    for (const body of [
      { status: 'proposed' },
      { status: 'active' },
      { status: 'terminated', termination_reason: 'Client exited' },
    ]) {
      const res = await api(partnerA, 'PATCH', `engagements?id=eq.${id}`, {
        headers: H(FIRM_A),
        body,
      });
      expect(res.status).toBe(200);
    }
    // terminated is terminal.
    const back = await api(partnerA, 'PATCH', `engagements?id=eq.${id}`, {
      headers: H(FIRM_A),
      body: { status: 'active' },
    });
    expect(back.status).toBe(400);
  });

  it('terminated without a reason is rejected input (plain CHECK → validation path)', async () => {
    const created = await api(partnerA, 'POST', 'engagements', {
      headers: H(FIRM_A),
      body: {
        firm_id: FIRM_A,
        client_id: C.otherManaged,
        responsible_partner_membership_id: M.partnerA,
        status: 'terminated',
      },
    });
    expect(created.status).toBe(400);
    expect(created.body.code).toBe('23514');
    expect(created.body.details ?? '').not.toContain('INVALID_TRANSITION');
  });
});

describe('TEST-RLS-GEN-02 — offensive posture', () => {
  it('known foreign ids are indistinguishable from nonexistent (no oracle)', async () => {
    const res = await api(partnerA, 'GET', `engagements?id=eq.${G.firmB}`, { headers: H(FIRM_A) });
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
    const asForeign = await api(partnerB, 'GET', `engagements?id=eq.${G.inPortfolio}`, {
      headers: H(FIRM_B),
    });
    expect(asForeign.body).toEqual([]);
  });

  it('a forged active-firm selector grants nothing (RLS-CTX-02)', async () => {
    const res = await api(partnerA, 'GET', 'engagements?select=id', { headers: H(FIRM_B) });
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
    const write = await api(partnerA, 'POST', 'engagements', {
      headers: H(FIRM_B),
      body: {
        firm_id: FIRM_B,
        client_id: C.firmB,
        responsible_partner_membership_id: M.partnerB,
      },
    });
    expect(write.status).toBe(403);
  });

  it('no selector at all selects nothing (context is required, not optional)', async () => {
    const res = await api(partnerA, 'GET', 'engagements?select=id');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('mismatched firm_id column vs selector cannot smuggle a row (insert pins both)', async () => {
    const res = await api(partnerA, 'POST', 'engagements', {
      headers: H(FIRM_A),
      body: {
        firm_id: FIRM_B,
        client_id: C.firmB,
        responsible_partner_membership_id: M.partnerB,
      },
    });
    expect(res.status).toBe(403);
  });
});

describe('TEST-RLS-GEN-03 / TEST-AUTH-12/13 — freshness and multi-firm switching', () => {
  it('suspended and removed members get nothing with a live token', async () => {
    for (const token of [suspendedA, removedA]) {
      const res = await api(token, 'GET', 'engagements?select=id', { headers: H(FIRM_A) });
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    }
  });

  it('suspension takes effect mid-session on the next request (same JWT)', async () => {
    const before = await api(partnerA, 'GET', 'engagements?select=id', { headers: H(FIRM_A) });
    expect(before.body.length).toBeGreaterThan(0);
    psql(`update public.firm_memberships set status = 'suspended' where id = '${M.partnerA}'`);
    try {
      const after = await api(partnerA, 'GET', 'engagements?select=id', { headers: H(FIRM_A) });
      expect(after.body).toEqual([]);
      const write = await api(partnerA, 'POST', 'engagements', {
        headers: H(FIRM_A),
        body: {
          firm_id: FIRM_A,
          client_id: C.inPortfolio,
          responsible_partner_membership_id: M.partnerA,
        },
      });
      // Denied either way: RLS with-check (403) or the DM-09 active-
      // responsibility trigger (23503 → 409), whichever fires first — the
      // security property is that a suspended member cannot write.
      expect([403, 409]).toContain(write.status);
    } finally {
      psql(`update public.firm_memberships set status = 'active' where id = '${M.partnerA}'`);
    }
  });

  it('role change partner -> senior loses engagement access with the same JWT', async () => {
    psql(`update public.firm_memberships set role = 'senior' where id = '${M.partnerA}'`);
    try {
      const res = await api(partnerA, 'GET', 'engagements?select=id', { headers: H(FIRM_A) });
      expect(res.body).toEqual([]);
    } finally {
      psql(`update public.firm_memberships set role = 'partner' where id = '${M.partnerA}'`);
    }
  });

  it('multi-firm user: manager portfolio applies per selected firm, senior side sees nothing', async () => {
    const firmAView = await api(multiFirm, 'GET', 'engagements?select=id', { headers: H(FIRM_A) });
    expect(firmAView.body.map((r: { id: string }) => r.id)).toEqual([G.multiManaged]);
    const firmBView = await api(multiFirm, 'GET', 'engagements?select=id', { headers: H(FIRM_B) });
    expect(firmBView.body).toEqual([]); // senior in B — no engagement access in R0
  });

  it('billing projection: suspend/remove/re-role the billing seat, same JWT loses access', async () => {
    const rpc = () =>
      api(billingA, 'POST', 'rpc/list_engagement_letter_statuses', {
        headers: H(FIRM_A),
        body: { p_firm_id: FIRM_A },
      });
    expect((await rpc()).body.length).toBeGreaterThan(0);
    try {
      psql(`update public.firm_memberships set status = 'suspended' where id = '${M.billingA}'`);
      expect((await rpc()).body).toEqual([]);
      psql(`update public.firm_memberships set status = 'removed' where id = '${M.billingA}'`);
      expect((await rpc()).body).toEqual([]);
      psql(
        `update public.firm_memberships set status = 'active', role = 'senior' where id = '${M.billingA}'`,
      );
      expect((await rpc()).body).toEqual([]);
    } finally {
      psql(
        `update public.firm_memberships set status = 'active', role = 'billing' where id = '${M.billingA}'`,
      );
    }
    expect((await rpc()).body.length).toBeGreaterThan(0);
  });
});
