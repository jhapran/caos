/**
 * IMP-020 — Client-hierarchy RLS integration tests (SCH-04…08 tables).
 *
 * Exercises the REAL production policies (clients / legal_entities /
 * registrations / contacts / client_relationships) through PostgREST with
 * signed-in access tokens — never service-role for authorization
 * assertions. Service-side psql is used only for fixture setup, controlled
 * membership mutation, and teardown.
 *
 * Mechanism under test (RLS-MECH-01, DEC-J): auth.uid() establishes
 * identity; authorization is a LIVE firm_memberships lookup per request;
 * x-active-firm is untrusted selector context and grants nothing by itself
 * (RLS-CTX-01/02). RLS-PRIN-02: all five tables are FORCE RLS.
 *
 * Role posture under test (spec 05 §11, RLS-STF-03/04, RLS-OQ-02 resolved):
 *   super_admin/partner — full active-firm read, manager+ write;
 *   manager             — portfolio read/write (manager_membership_id =
 *                         caller's OWN live membership + related records);
 *   billing             — NO table access; identity-only projection via the
 *                         reviewed list_client_identities() RPC (RLS-CLI-01);
 *   senior/article      — NOTHING in R0 (assigned-work scope needs
 *                         tasks/instances — IMP-030/040 extend these
 *                         policies; recorded, not invented).
 *
 * TEST mapping (spec 11):
 *   TEST-RLS-MAT-01 — role-matrix cells for the client hierarchy;
 *   TEST-RLS-GEN-01 fixture tenants / GEN-02 offensive posture (known
 *   foreign ids, forged selector) / GEN-03 case set (suspension, removal,
 *   multi-firm switching) / GEN-04 mutation-denial surfacing;
 *   TEST-AUTH-12/13 — suspension/removal freshness with the same JWT.
 *
 * Re-runnable: deterministic ids in the 93000000-… range, force-reset on
 * every run; fixture audit rows removed as the operator in teardown
 * (append-only applies to application roles, AUD-INV-01).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { api, FIRM_A, FIRM_B, psql, signIn, userEmail, userId } from '../helpers.mjs';

const H = (firm: string) => ({ 'x-active-firm': firm });

const M = {
  partnerA: '93000000-0000-4000-8000-000000000001',
  managerA: '93000000-0000-4000-8000-000000000002',
  seniorA: '93000000-0000-4000-8000-000000000003',
  billingA: '93000000-0000-4000-8000-000000000004',
  suspendedA: '93000000-0000-4000-8000-000000000005',
  removedA: '93000000-0000-4000-8000-000000000006',
  multiA: '93000000-0000-4000-8000-000000000007',
  partnerB: '93000000-0000-4000-8000-000000000008',
  multiB: '93000000-0000-4000-8000-000000000009',
  superAdminA: '93000000-0000-4000-8000-000000000010',
  managerBInA: '93000000-0000-4000-8000-000000000011', // second manager, firm A
  billingB: '93000000-0000-4000-8000-000000000012', // billingA user's firm-B seat
};

const C = {
  inPortfolio: '93000000-0000-4000-8000-000000000101', // manager = managerA
  unassigned: '93000000-0000-4000-8000-000000000102', // manager = null
  multiManaged: '93000000-0000-4000-8000-000000000103', // manager = multiA
  inPortfolio2: '93000000-0000-4000-8000-000000000104', // manager = managerA
  otherManaged: '93000000-0000-4000-8000-000000000105', // manager = managerBInA
  firmB: '93000000-0000-4000-8000-000000000111',
};
const E = {
  inPortfolio: '93000000-0000-4000-8000-000000000201',
  unassigned: '93000000-0000-4000-8000-000000000202',
  inPortfolio2: '93000000-0000-4000-8000-000000000203',
  otherManaged: '93000000-0000-4000-8000-000000000204',
  firmB: '93000000-0000-4000-8000-000000000211',
};
const REG = { inPortfolio: '93000000-0000-4000-8000-000000000301' };
const CONTACT = { inPortfolio: '93000000-0000-4000-8000-000000000401' };
const REL = {
  spanning: '93000000-0000-4000-8000-000000000501', // E.inPortfolio → E.unassigned
  withinPortfolio: '93000000-0000-4000-8000-000000000502', // inPortfolio ↔ inPortfolio2
  crossManager: '93000000-0000-4000-8000-000000000503', // inPortfolio ↔ otherManaged
  foreignSpan: '93000000-0000-4000-8000-000000000504', // otherManaged ↔ unassigned
};

const PARTNER_A = userId('USER_A_PARTNER');
const MANAGER_A = userId('USER_A_MANAGER');
const SENIOR_A = userId('USER_A_SENIOR');
const BILLING_A = userId('USER_A_BILLING');
const SUSPENDED_A = userId('USER_A_SUSPENDED');
const REMOVED_A = userId('USER_A_REMOVED');
const MULTI = userId('USER_MULTI_FIRM');
const PARTNER_B = userId('USER_B_PARTNER');
const SUPER_ADMIN_A = userId('USER_A_SUPER_ADMIN');
const MANAGER_B = userId('USER_B_MANAGER');

let partnerA: string;
let managerA: string;
let seniorA: string;
let billingA: string;
let suspendedA: string;
let removedA: string;
let multiFirm: string;
let partnerB: string;
let superAdminA: string;

function cleanRows() {
  psql(`
    delete from public.client_relationships where firm_id in ('${FIRM_A}', '${FIRM_B}');
    delete from public.contacts where firm_id in ('${FIRM_A}', '${FIRM_B}');
    delete from public.registrations where firm_id in ('${FIRM_A}', '${FIRM_B}');
    delete from public.legal_entities where firm_id in ('${FIRM_A}', '${FIRM_B}');
    delete from public.clients where firm_id in ('${FIRM_A}', '${FIRM_B}');
    delete from public.audit_log where firm_id in ('${FIRM_A}', '${FIRM_B}');
  `);
}

function seedFixture() {
  cleanRows();
  psql(`
    insert into public.firms (id, name) values
      ('${FIRM_A}', 'IMP-020 RLS Firm A'),
      ('${FIRM_B}', 'IMP-020 RLS Firm B')
    on conflict (id) do nothing;

    insert into public.firm_memberships (id, firm_id, user_id, role, status) values
      ('${M.partnerA}',     '${FIRM_A}', '${PARTNER_A}',     'partner',     'active'),
      ('${M.managerA}',     '${FIRM_A}', '${MANAGER_A}',     'manager',     'active'),
      ('${M.seniorA}',      '${FIRM_A}', '${SENIOR_A}',      'senior',      'active'),
      ('${M.billingA}',     '${FIRM_A}', '${BILLING_A}',     'billing',     'active'),
      ('${M.suspendedA}',   '${FIRM_A}', '${SUSPENDED_A}',   'senior',      'suspended'),
      ('${M.removedA}',     '${FIRM_A}', '${REMOVED_A}',     'senior',      'removed'),
      ('${M.multiA}',       '${FIRM_A}', '${MULTI}',         'manager',     'active'),
      ('${M.partnerB}',     '${FIRM_B}', '${PARTNER_B}',     'partner',     'active'),
      ('${M.multiB}',       '${FIRM_B}', '${MULTI}',         'senior',      'active'),
      ('${M.superAdminA}',  '${FIRM_A}', '${SUPER_ADMIN_A}', 'super_admin', 'active'),
      ('${M.managerBInA}',  '${FIRM_A}', '${MANAGER_B}',     'manager',     'active'),
      ('${M.billingB}',     '${FIRM_B}', '${BILLING_A}',     'billing',     'active')
    on conflict (firm_id, user_id) do nothing;

    -- Force-reset mutable state so re-runs are deterministic even if a
    -- previous run mutated status mid-flight (freshness cases).
    update public.firm_memberships set status = 'active' where id = '${M.managerA}';
    update public.firm_memberships set status = 'suspended' where id = '${M.suspendedA}';
    update public.firm_memberships set status = 'removed' where id = '${M.removedA}';
    update public.firm_memberships set status = 'active', role = 'billing' where id = '${M.billingA}';
    update public.firm_memberships set status = 'active' where id = '${M.billingB}';

    insert into public.clients (id, firm_id, name, owner_partner_membership_id, manager_membership_id, status, tags) values
      ('${C.inPortfolio}',  '${FIRM_A}', 'RLS Client InPortfolio',  '${M.partnerA}', '${M.managerA}',    'active', '{GST}'),
      ('${C.unassigned}',   '${FIRM_A}', 'RLS Client Unassigned',   '${M.partnerA}', null,               'active', '{ITR}'),
      ('${C.multiManaged}', '${FIRM_A}', 'RLS Client MultiManaged', '${M.partnerA}', '${M.multiA}',      'active', '{TDS}'),
      ('${C.inPortfolio2}', '${FIRM_A}', 'RLS Client InPortfolio2', '${M.partnerA}', '${M.managerA}',    'active', '{GST}'),
      ('${C.otherManaged}', '${FIRM_A}', 'RLS Client OtherManaged', '${M.partnerA}', '${M.managerBInA}', 'active', '{GST}'),
      ('${C.firmB}',        '${FIRM_B}', 'RLS Client FirmB',        '${M.partnerB}', null,               'active', '{GST}');

    insert into public.legal_entities (id, firm_id, client_id, entity_type, legal_name) values
      ('${E.inPortfolio}',  '${FIRM_A}', '${C.inPortfolio}',  'private_limited', 'RLS Entity InPortfolio'),
      ('${E.unassigned}',   '${FIRM_A}', '${C.unassigned}',   'llp',             'RLS Entity Unassigned'),
      ('${E.inPortfolio2}', '${FIRM_A}', '${C.inPortfolio2}', 'private_limited', 'RLS Entity InPortfolio2'),
      ('${E.otherManaged}', '${FIRM_A}', '${C.otherManaged}', 'llp',             'RLS Entity OtherManaged'),
      ('${E.firmB}',        '${FIRM_B}', '${C.firmB}',        'partnership',     'RLS Entity FirmB');

    insert into public.registrations (id, firm_id, legal_entity_id, type, value, state) values
      ('${REG.inPortfolio}', '${FIRM_A}', '${E.inPortfolio}', 'GSTIN', '27RLSA0000A1Z5', 'Maharashtra');

    insert into public.contacts (id, firm_id, client_id, name, email, is_primary) values
      ('${CONTACT.inPortfolio}', '${FIRM_A}', '${C.inPortfolio}', 'RLS Contact One', 'contact@rls-a.example', true);

    insert into public.client_relationships (id, firm_id, from_entity_id, to_entity_id, relation_type) values
      ('${REL.spanning}',        '${FIRM_A}', '${E.inPortfolio}',  '${E.unassigned}',   'group'),
      ('${REL.withinPortfolio}', '${FIRM_A}', '${E.inPortfolio}',  '${E.inPortfolio2}', 'group'),
      ('${REL.crossManager}',    '${FIRM_A}', '${E.inPortfolio}',  '${E.otherManaged}', 'group'),
      ('${REL.foreignSpan}',     '${FIRM_A}', '${E.otherManaged}', '${E.unassigned}',   'related_party');
  `);
}

beforeAll(async () => {
  seedFixture();
  partnerA = (await signIn(userEmail('USER_A_PARTNER'))).token;
  managerA = (await signIn(userEmail('USER_A_MANAGER'))).token;
  seniorA = (await signIn(userEmail('USER_A_SENIOR'))).token;
  billingA = (await signIn(userEmail('USER_A_BILLING'))).token;
  suspendedA = (await signIn(userEmail('USER_A_SUSPENDED'))).token;
  removedA = (await signIn(userEmail('USER_A_REMOVED'))).token;
  multiFirm = (await signIn(userEmail('USER_MULTI_FIRM'))).token;
  partnerB = (await signIn(userEmail('USER_B_PARTNER'))).token;
  superAdminA = (await signIn(userEmail('USER_A_SUPER_ADMIN'))).token;
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

describe('TEST-RLS-MAT-01 — read posture per role (clients)', () => {
  it('partner reads every client of the active firm, and only that firm', async () => {
    const res = await api(partnerA, 'GET', 'clients?select=id', { headers: H(FIRM_A) });
    expect(res.status).toBe(200);
    const ids = res.body.map((r: { id: string }) => r.id);
    expect(ids).toEqual(
      expect.arrayContaining([C.inPortfolio, C.unassigned, C.multiManaged]),
    );
    expect(ids).not.toContain(C.firmB);
  });

  it('manager reads only the designated portfolio (RLS-STF-03, RLS-OQ-02)', async () => {
    const res = await api(managerA, 'GET', 'clients?select=id', { headers: H(FIRM_A) });
    expect(res.status).toBe(200);
    expect(res.body.map((r: { id: string }) => r.id).sort()).toEqual(
      [C.inPortfolio, C.inPortfolio2].sort(),
    );
  });

  it('senior/article read NOTHING in R0 (RLS-STF-04 needs assigned-work tables)', async () => {
    const res = await api(seniorA, 'GET', 'clients?select=id', { headers: H(FIRM_A) });
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('billing reads NO client rows — the projection RPC is the only path (RLS-CLI-01)', async () => {
    const res = await api(billingA, 'GET', 'clients?select=id', { headers: H(FIRM_A) });
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
    const rpc = await api(billingA, 'POST', 'rpc/list_client_identities', {
      headers: H(FIRM_A),
      body: { p_firm_id: FIRM_A },
    });
    expect(rpc.status).toBe(200);
    const ids = rpc.body.map((r: { id: string }) => r.id);
    expect(ids).toEqual(
      expect.arrayContaining([C.inPortfolio, C.unassigned, C.multiManaged]),
    );
    // identity-only: no tags/risk/responsibility leakage
    expect(Object.keys(rpc.body[0]).sort()).toEqual(['id', 'name', 'status']);
  });

  it('the projection RPC authorizes itself — partner/manager/senior get nothing from it', async () => {
    for (const token of [partnerA, managerA, seniorA]) {
      const rpc = await api(token, 'POST', 'rpc/list_client_identities', {
        headers: H(FIRM_A),
        body: { p_firm_id: FIRM_A },
      });
      expect(rpc.status).toBe(200);
      expect(rpc.body).toEqual([]);
    }
  });
});

describe('TEST-RLS-MAT-01 — related-record scoping follows the client scope (RLS-ENT/REG/CON-01)', () => {
  it('manager sees entities/registrations/contacts of portfolio clients only', async () => {
    const entities = await api(managerA, 'GET', 'legal_entities?select=id', { headers: H(FIRM_A) });
    expect(entities.body.map((r: { id: string }) => r.id).sort()).toEqual(
      [E.inPortfolio, E.inPortfolio2].sort(),
    );
    const regs = await api(managerA, 'GET', 'registrations?select=id', { headers: H(FIRM_A) });
    expect(regs.body.map((r: { id: string }) => r.id)).toEqual([REG.inPortfolio]);
    const contacts = await api(managerA, 'GET', 'contacts?select=id', { headers: H(FIRM_A) });
    expect(contacts.body.map((r: { id: string }) => r.id)).toEqual([CONTACT.inPortfolio]);
  });

  it('partner sees related records across the whole active firm', async () => {
    const entities = await api(partnerA, 'GET', 'legal_entities?select=id', { headers: H(FIRM_A) });
    expect(entities.body.map((r: { id: string }) => r.id)).toEqual(
      expect.arrayContaining([E.inPortfolio, E.unassigned]),
    );
  });

  it('manager reads a relationship only when BOTH endpoints are in portfolio (closure decision A)', async () => {
    const mgr = await api(managerA, 'GET', 'client_relationships?select=id', { headers: H(FIRM_A) });
    expect(mgr.body.map((r: { id: string }) => r.id)).toEqual([REL.withinPortfolio]);
    const ptr = await api(partnerA, 'GET', 'client_relationships?select=id', { headers: H(FIRM_A) });
    expect(ptr.body.map((r: { id: string }) => r.id)).toEqual(
      expect.arrayContaining([REL.spanning, REL.withinPortfolio, REL.crossManager, REL.foreignSpan]),
    );
  });

  it('a known spanning relationship UUID does not leak to the manager (no oracle)', async () => {
    for (const rel of [REL.spanning, REL.crossManager, REL.foreignSpan]) {
      const res = await api(managerA, 'GET', `client_relationships?id=eq.${rel}`, {
        headers: H(FIRM_A),
      });
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    }
  });
});

describe('TEST-RLS-MAT-01 / GEN-04 — write posture per role', () => {
  it('partner creates and updates clients in the active firm', async () => {
    const created = await api(partnerA, 'POST', 'clients', {
      headers: H(FIRM_A),
      body: {
        firm_id: FIRM_A,
        name: 'RLS Partner Created',
        owner_partner_membership_id: M.partnerA,
        manager_membership_id: M.managerA,
      },
    });
    expect(created.status).toBe(201);
    const id = created.body[0].id;
    const updated = await api(partnerA, 'PATCH', `clients?id=eq.${id}`, {
      headers: H(FIRM_A),
      body: { status: 'active' },
    });
    expect(updated.status).toBe(200);
    expect(updated.body[0].status).toBe('active');
  });

  it('manager creates only into own portfolio (manager_membership_id = self)', async () => {
    const own = await api(managerA, 'POST', 'clients', {
      headers: H(FIRM_A),
      body: {
        firm_id: FIRM_A,
        name: 'RLS Manager Created',
        owner_partner_membership_id: M.partnerA,
        manager_membership_id: M.managerA,
      },
    });
    expect(own.status).toBe(201);
    const outside = await api(managerA, 'POST', 'clients', {
      headers: H(FIRM_A),
      body: {
        firm_id: FIRM_A,
        name: 'RLS Manager OutOfPortfolio',
        owner_partner_membership_id: M.partnerA,
      },
    });
    expect(outside.status).toBe(403);
  });

  it('manager updates portfolio rows but not unassigned rows', async () => {
    const inside = await api(managerA, 'PATCH', `clients?id=eq.${C.inPortfolio}`, {
      headers: H(FIRM_A),
      body: { industry: 'Manufacturing' },
    });
    expect(inside.status).toBe(200);
    expect(inside.body).toHaveLength(1);
    const outside = await api(managerA, 'PATCH', `clients?id=eq.${C.unassigned}`, {
      headers: H(FIRM_A),
      body: { industry: 'Trading' },
    });
    expect(outside.status).toBe(200);
    expect(outside.body).toEqual([]); // silent zero-row — no existence leak (API-ERR-02)
    const check = psql(`select industry from public.clients where id = '${C.unassigned}'`).trim();
    expect(check).toBe('');
  });

  it('manager cannot create or modify an edge unless BOTH endpoints are in portfolio', async () => {
    const denied = await api(managerA, 'POST', 'client_relationships', {
      headers: H(FIRM_A),
      body: {
        firm_id: FIRM_A,
        from_entity_id: E.inPortfolio,
        to_entity_id: E.unassigned,
        relation_type: 'holding',
      },
    });
    expect(denied.status).toBe(403);
    const deniedCross = await api(managerA, 'POST', 'client_relationships', {
      headers: H(FIRM_A),
      body: {
        firm_id: FIRM_A,
        from_entity_id: E.inPortfolio2,
        to_entity_id: E.otherManaged,
        relation_type: 'holding',
      },
    });
    expect(deniedCross.status).toBe(403);
    // UPDATE against an edge whose endpoints leave the portfolio is a
    // silent zero-row (no existence leak), and the row is unchanged.
    const upd = await api(managerA, 'PATCH', `client_relationships?id=eq.${REL.crossManager}`, {
      headers: H(FIRM_A),
      body: { relation_type: 'holding' },
    });
    expect(upd.status).toBe(200);
    expect(upd.body).toEqual([]);
    const check = psql(
      `select relation_type from public.client_relationships where id = '${REL.crossManager}'`,
    ).trim();
    expect(check).toBe('group');
    // A both-portfolio edge IS writable by the manager.
    const own = await api(managerA, 'POST', 'client_relationships', {
      headers: H(FIRM_A),
      body: {
        firm_id: FIRM_A,
        from_entity_id: E.inPortfolio2,
        to_entity_id: E.inPortfolio,
        relation_type: 'related_party',
      },
    });
    expect(own.status).toBe(201);
    const granted = await api(partnerA, 'POST', 'client_relationships', {
      headers: H(FIRM_A),
      body: {
        firm_id: FIRM_A,
        from_entity_id: E.unassigned,
        to_entity_id: E.inPortfolio,
        relation_type: 'related_party',
      },
    });
    expect(granted.status).toBe(201);
  });

  it('senior and billing cannot write anything (GEN-04 denial surfacing)', async () => {
    for (const token of [seniorA, billingA]) {
      const res = await api(token, 'POST', 'clients', {
        headers: H(FIRM_A),
        body: {
          firm_id: FIRM_A,
          name: 'RLS Denied',
          owner_partner_membership_id: M.partnerA,
        },
      });
      expect(res.status).toBe(403);
    }
  });

  it('DELETE is not granted to anyone (lifecycle statuses only)', async () => {
    const res = await api(partnerA, 'DELETE', `clients?id=eq.${C.unassigned}`, {
      headers: H(FIRM_A),
    });
    expect(res.status).toBe(403);
  });
});

describe('TEST-RLS-GEN-02 — offensive posture', () => {
  it('known foreign ids are indistinguishable from nonexistent (no oracle)', async () => {
    const res = await api(partnerA, 'GET', `clients?id=eq.${C.firmB}`, { headers: H(FIRM_A) });
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
    const asForeign = await api(partnerB, 'GET', `clients?id=eq.${C.inPortfolio}`, {
      headers: H(FIRM_B),
    });
    expect(asForeign.body).toEqual([]);
  });

  it('a forged active-firm selector grants nothing (RLS-CTX-02)', async () => {
    // partnerA has NO membership in firm B — selecting it yields nothing.
    const res = await api(partnerA, 'GET', 'clients?select=id', { headers: H(FIRM_B) });
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
    // Forged write toward the foreign firm is denied.
    const write = await api(partnerA, 'POST', 'clients', {
      headers: H(FIRM_B),
      body: { firm_id: FIRM_B, name: 'Forged', owner_partner_membership_id: M.partnerB },
    });
    expect(write.status).toBe(403);
  });

  it('no selector at all selects nothing (context is required, not optional)', async () => {
    const res = await api(partnerA, 'GET', 'clients?select=id');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('mismatched firm_id column vs selector cannot smuggle a row (insert pins both)', async () => {
    const res = await api(partnerA, 'POST', 'clients', {
      headers: H(FIRM_A),
      body: { firm_id: FIRM_B, name: 'Mismatch', owner_partner_membership_id: M.partnerB },
    });
    expect(res.status).toBe(403);
  });
});

describe('TEST-RLS-GEN-03 / TEST-AUTH-12/13 — freshness and multi-firm switching', () => {
  it('suspended and removed members get nothing with a live token', async () => {
    for (const token of [suspendedA, removedA]) {
      const res = await api(token, 'GET', 'clients?select=id', { headers: H(FIRM_A) });
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    }
  });

  it('suspension takes effect mid-session on the next request (same JWT)', async () => {
    // Earlier write cases created additional manager-portfolio clients, so
    // assert content, not an absolute count.
    const before = await api(managerA, 'GET', 'clients?select=id', { headers: H(FIRM_A) });
    expect(before.body.map((r: { id: string }) => r.id)).toContain(C.inPortfolio);
    psql(`update public.firm_memberships set status = 'suspended' where id = '${M.managerA}'`);
    try {
      const after = await api(managerA, 'GET', 'clients?select=id', { headers: H(FIRM_A) });
      expect(after.body).toEqual([]);
    } finally {
      psql(`update public.firm_memberships set status = 'active' where id = '${M.managerA}'`);
    }
  });

  it('multi-firm user: portfolio applies per selected firm, senior side sees nothing', async () => {
    const firmAView = await api(multiFirm, 'GET', 'clients?select=id', { headers: H(FIRM_A) });
    expect(firmAView.body.map((r: { id: string }) => r.id)).toEqual([C.multiManaged]);
    const firmBView = await api(multiFirm, 'GET', 'clients?select=id', { headers: H(FIRM_B) });
    expect(firmBView.body).toEqual([]); // senior in B — no client-hierarchy access in R0
  });
});

describe('TEST-RLS-MAT-01 — super_admin full-firm posture (closure §10)', () => {
  it('super_admin reads all five hierarchy tables across the active firm', async () => {
    for (const table of [
      'clients',
      'legal_entities',
      'registrations',
      'contacts',
      'client_relationships',
    ]) {
      const res = await api(superAdminA, 'GET', `${table}?select=id`, { headers: H(FIRM_A) });
      expect(res.status).toBe(200);
      expect(res.body.length).toBeGreaterThan(0);
      expect(res.body.map((r: { id: string }) => r.id)).not.toContain(C.firmB);
      expect(res.body.map((r: { id: string }) => r.id)).not.toContain(E.firmB);
    }
  });

  it('super_admin creates and updates across the hierarchy', async () => {
    const client = await api(superAdminA, 'POST', 'clients', {
      headers: H(FIRM_A),
      body: { firm_id: FIRM_A, name: 'RLS SuperAdmin Client', owner_partner_membership_id: M.partnerA },
    });
    expect(client.status).toBe(201);
    const clientId = client.body[0].id;
    const entity = await api(superAdminA, 'POST', 'legal_entities', {
      headers: H(FIRM_A),
      body: {
        firm_id: FIRM_A,
        client_id: clientId,
        entity_type: 'private_limited',
        legal_name: 'RLS SuperAdmin Entity',
      },
    });
    expect(entity.status).toBe(201);
    const entityId = entity.body[0].id;
    const reg = await api(superAdminA, 'POST', 'registrations', {
      headers: H(FIRM_A),
      body: {
        firm_id: FIRM_A,
        legal_entity_id: entityId,
        type: 'PAN',
        value: 'SADMN1234Z',
      },
    });
    expect(reg.status).toBe(201);
    const contact = await api(superAdminA, 'POST', 'contacts', {
      headers: H(FIRM_A),
      body: { firm_id: FIRM_A, client_id: clientId, name: 'SA Contact', is_primary: false },
    });
    expect(contact.status).toBe(201);
    const rel = await api(superAdminA, 'POST', 'client_relationships', {
      headers: H(FIRM_A),
      body: {
        firm_id: FIRM_A,
        from_entity_id: entityId,
        to_entity_id: E.inPortfolio,
        relation_type: 'group',
      },
    });
    expect(rel.status).toBe(201);
    const upd = await api(superAdminA, 'PATCH', `clients?id=eq.${clientId}`, {
      headers: H(FIRM_A),
      body: { status: 'active' },
    });
    expect(upd.status).toBe(200);
    expect(upd.body[0].status).toBe('active');
  });
});

describe('TEST-RLS-GEN-03 — billing projection multi-firm attack (closure decision B)', () => {
  const rpc = (token: string, headers: Record<string, string>, firm: string) =>
    api(token, 'POST', 'rpc/list_client_identities', { headers, body: { p_firm_id: firm } });

  it('active firm pins the projection: matching selector works, mismatched p_firm_id yields nothing', async () => {
    const okA = await rpc(billingA, H(FIRM_A), FIRM_A);
    expect(okA.status).toBe(200);
    expect(okA.body.length).toBeGreaterThan(0);
    const okB = await rpc(billingA, H(FIRM_B), FIRM_B);
    expect(okB.status).toBe(200);
    expect(okB.body.map((r: { id: string }) => r.id)).toEqual([C.firmB]);
    // Active firm A but p_firm_id B: membership in B exists, selector says A — denied.
    const mismatched = await rpc(billingA, H(FIRM_A), FIRM_B);
    expect(mismatched.status).toBe(200);
    expect(mismatched.body).toEqual([]);
    const mismatchedReverse = await rpc(billingA, H(FIRM_B), FIRM_A);
    expect(mismatchedReverse.status).toBe(200);
    expect(mismatchedReverse.body).toEqual([]);
  });

  it('missing or malformed selector fails closed', async () => {
    const noHeader = await rpc(billingA, {}, FIRM_A);
    expect(noHeader.status).toBe(200);
    expect(noHeader.body).toEqual([]);
    const malformed = await rpc(billingA, { 'x-active-firm': 'not-a-uuid' }, FIRM_A);
    expect(malformed.status).toBeGreaterThanOrEqual(400); // cast failure — safe, no data
    expect(Array.isArray(malformed.body)).toBe(false);
  });

  it('forged selector for a firm without membership yields nothing', async () => {
    const foreign = '93000000-0000-4000-8000-000000009999';
    const res = await rpc(billingA, H(foreign), foreign);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('suspend / remove / re-role the billing seat: same JWT loses access immediately', async () => {
    const before = await rpc(billingA, H(FIRM_A), FIRM_A);
    expect(before.body.length).toBeGreaterThan(0);
    try {
      psql(`update public.firm_memberships set status = 'suspended' where id = '${M.billingA}'`);
      const suspended = await rpc(billingA, H(FIRM_A), FIRM_A);
      expect(suspended.body).toEqual([]);
      psql(`update public.firm_memberships set status = 'removed' where id = '${M.billingA}'`);
      const removed = await rpc(billingA, H(FIRM_A), FIRM_A);
      expect(removed.body).toEqual([]);
      psql(
        `update public.firm_memberships set status = 'active', role = 'senior' where id = '${M.billingA}'`,
      );
      const reRoled = await rpc(billingA, H(FIRM_A), FIRM_A);
      expect(reRoled.body).toEqual([]);
    } finally {
      psql(
        `update public.firm_memberships set status = 'active', role = 'billing' where id = '${M.billingA}'`,
      );
    }
    const restored = await rpc(billingA, H(FIRM_A), FIRM_A);
    expect(restored.body.length).toBeGreaterThan(0);
  });
});
