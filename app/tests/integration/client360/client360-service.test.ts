/**
 * IMP-022 — Client 360 composite contract against the real local stack
 * (TEST-API-01…03 applied to the composite read; role/no-leak matrix per
 * the instruction §26).
 *
 * The composite must never broaden what table RLS allows: it is assembled
 * from the same RLS-scoped reads the caller could issue directly. What
 * this suite proves at the composition layer:
 *
 *   TEST-API-01 — collection fields inside the composite are plain
 *     caller-scoped arrays (empty is normal);
 *   TEST-API-02 — getClient360 returns the identical null for unknown,
 *     malformed, out-of-portfolio, and foreign-firm ids (no existence
 *     oracle);
 *   role matrix — partner: full firm view incl. cross-client
 *     relationship names; manager: portfolio clients only, and only
 *     both-endpoint-in-portfolio relationships (IMP-020 closure A);
 *     billing/senior: no composite at all; suspended membership loses
 *     access with the SAME JWT (DEC-J live membership).
 *
 * Fixture rows: deterministic ids in the 9b000000-… range; teardown in
 * FK order, profiles last (only the ones this suite inserted).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { client360Service } from '@/data/client360';
import { setActiveFirm, clearActiveFirm } from '@/data/context';
import { getSupabaseClient } from '@/lib/supabaseClient';

import { FIRM_A, FIRM_B, PASSWORD, psql, userEmail, userId } from '../helpers.mjs';

const M = {
  partnerA: '9b000000-0000-4000-8000-000000000001',
  managerA: '9b000000-0000-4000-8000-000000000002',
  billingA: '9b000000-0000-4000-8000-000000000003',
  seniorA: '9b000000-0000-4000-8000-000000000004',
  partnerB: '9b000000-0000-4000-8000-000000000005',
};

const C = {
  managed: '9b000000-0000-4000-8000-000000000101', // firm A, manager A's portfolio
  plain: '9b000000-0000-4000-8000-000000000102', // firm A, no manager (not manager A's)
  firmB: '9b000000-0000-4000-8000-000000000111',
};

const E = {
  managed1: '9b000000-0000-4000-8000-000000000201',
  managed2: '9b000000-0000-4000-8000-000000000202',
  plain: '9b000000-0000-4000-8000-000000000203',
  firmB: '9b000000-0000-4000-8000-000000000211',
};

const REL = {
  crossClient: '9b000000-0000-4000-8000-000000000301', // managed1 → plain (manager must NOT see)
  withinClient: '9b000000-0000-4000-8000-000000000302', // managed1 → managed2 (manager sees)
};

const ENG = '9b000000-0000-4000-8000-000000000401';

const PARTNER_A = userId('USER_A_PARTNER');
const MANAGER_A = userId('USER_A_MANAGER');
const BILLING_A = userId('USER_A_BILLING');
const SENIOR_A = userId('USER_A_SENIOR');
const PARTNER_B = userId('USER_B_PARTNER');

const UNKNOWN_ID = '9b000000-0000-4000-8000-00000000ffff';

async function signInAs(email: string) {
  const { error } = await getSupabaseClient().auth.signInWithPassword({
    email,
    password: PASSWORD,
  });
  expect(error).toBeNull();
}

function cleanRows() {
  psql(`
    delete from public.engagements where firm_id in ('${FIRM_A}', '${FIRM_B}');
    delete from public.client_relationships where firm_id in ('${FIRM_A}', '${FIRM_B}');
    delete from public.registrations where firm_id in ('${FIRM_A}', '${FIRM_B}');
    delete from public.contacts where firm_id in ('${FIRM_A}', '${FIRM_B}');
    delete from public.legal_entities where firm_id in ('${FIRM_A}', '${FIRM_B}');
    delete from public.clients where firm_id in ('${FIRM_A}', '${FIRM_B}');
    delete from public.audit_log where firm_id in ('${FIRM_A}', '${FIRM_B}');
  `);
}

beforeAll(async () => {
  cleanRows();
  psql(`
    insert into public.firms (id, name) values
      ('${FIRM_A}', 'IMP-022 Client360 Firm A'),
      ('${FIRM_B}', 'IMP-022 Client360 Firm B')
    on conflict (id) do nothing;

    insert into public.firm_memberships (id, firm_id, user_id, role, status) values
      ('${M.partnerA}', '${FIRM_A}', '${PARTNER_A}', 'partner', 'active'),
      ('${M.managerA}', '${FIRM_A}', '${MANAGER_A}', 'manager', 'active'),
      ('${M.billingA}', '${FIRM_A}', '${BILLING_A}', 'billing', 'active'),
      ('${M.seniorA}',  '${FIRM_A}', '${SENIOR_A}',  'senior',  'active'),
      ('${M.partnerB}', '${FIRM_B}', '${PARTNER_B}', 'partner', 'active')
    on conflict (firm_id, user_id) do nothing;

    insert into public.profiles (id, full_name) values
      ('${PARTNER_A}', 'C360 Partner Alpha'),
      ('${MANAGER_A}', 'C360 Manager Alpha'),
      ('${PARTNER_B}', 'C360 Partner Beta')
    on conflict (id) do nothing;

    insert into public.clients (id, firm_id, name, industry, risk_rating, owner_partner_membership_id, manager_membership_id, status, tags) values
      ('${C.managed}', '${FIRM_A}', 'C360 Managed Client', 'Manufacturing', 'medium', '${M.partnerA}', '${M.managerA}', 'active', '{GST,MCA}'),
      ('${C.plain}',   '${FIRM_A}', 'C360 Plain Client',   null,            null,     '${M.partnerA}', null,            'active', '{}'),
      ('${C.firmB}',   '${FIRM_B}', 'C360 Firm B Client',  null,            null,     '${M.partnerB}', null,            'active', '{}');

    insert into public.legal_entities (id, firm_id, client_id, entity_type, legal_name, status) values
      ('${E.managed1}', '${FIRM_A}', '${C.managed}', 'private_limited', 'C360 Managed Pvt Ltd',   'active'),
      ('${E.managed2}', '${FIRM_A}', '${C.managed}', 'llp',             'C360 Managed LLP',       'active'),
      ('${E.plain}',    '${FIRM_A}', '${C.plain}',   'partnership',     'C360 Plain & Partners',  'active'),
      ('${E.firmB}',    '${FIRM_B}', '${C.firmB}',   'individual',      'C360 Beta Individual',   'active');

    insert into public.registrations (id, firm_id, legal_entity_id, type, value, state, status) values
      ('9b000000-0000-4000-8000-000000000501', '${FIRM_A}', '${E.managed1}', 'PAN',   'AAACM0001A', null,          'active'),
      ('9b000000-0000-4000-8000-000000000502', '${FIRM_A}', '${E.managed2}', 'GSTIN', '27AAACM0002A1Z5', 'Maharashtra', 'active'),
      ('9b000000-0000-4000-8000-000000000503', '${FIRM_A}', '${E.managed2}', 'PAN',   'AAACM0002B', null,          'active'),
      ('9b000000-0000-4000-8000-000000000511', '${FIRM_A}', '${E.plain}',    'PAN',   'AAACM0003C', null,          'active'),
      ('9b000000-0000-4000-8000-000000000521', '${FIRM_B}', '${E.firmB}',    'PAN',   'AAACM0004D', null,          'active');

    insert into public.contacts (id, firm_id, client_id, legal_entity_id, name, role_title, email, is_primary, status) values
      ('9b000000-0000-4000-8000-000000000601', '${FIRM_A}', '${C.managed}', '${E.managed1}', 'C360 Contact CFO', 'CFO', 'cfo@example.test', true, 'active'),
      ('9b000000-0000-4000-8000-000000000602', '${FIRM_A}', '${C.managed}', null,            'C360 Contact Ops', null,  null,               false, 'active');

    insert into public.client_relationships (id, firm_id, from_entity_id, to_entity_id, relation_type, status) values
      ('${REL.crossClient}',  '${FIRM_A}', '${E.managed1}', '${E.plain}',    'group',      'active'),
      ('${REL.withinClient}', '${FIRM_A}', '${E.managed1}', '${E.managed2}', 'holding',    'active');

    insert into public.engagements (id, firm_id, client_id, responsible_partner_membership_id, service_lines, status, letter_status, period_label) values
      ('${ENG}', '${FIRM_A}', '${C.managed}', '${M.partnerA}', '{GST,MCA}', 'active', 'signed', 'FY 2025-26');
  `);
  psql(`delete from public.audit_log where firm_id in ('${FIRM_A}', '${FIRM_B}')`);
});

afterAll(async () => {
  clearActiveFirm();
  await getSupabaseClient().auth.signOut();
  cleanRows();
  psql(`
    delete from public.firm_memberships where firm_id in ('${FIRM_A}', '${FIRM_B}');
    delete from public.firms where id in ('${FIRM_A}', '${FIRM_B}');
    delete from public.profiles where id in ('${PARTNER_A}', '${MANAGER_A}', '${PARTNER_B}');
  `);
});

describe('client360Service — supabase adapter (TEST-API-01…03 composite)', () => {
  it('serves the shared contract in supabase mode (API-ARCH-02)', async () => {
    await signInAs(userEmail('USER_A_PARTNER'));
    setActiveFirm(FIRM_A);
    expect(client360Service.mode).toBe('supabase');
  });

  it('partner gets the full composite with names resolved (never raw membership ids)', async () => {
    const view = await client360Service.getClient360(C.managed);
    expect(view).not.toBeNull();
    expect(view!.client).toMatchObject({
      id: C.managed,
      name: 'C360 Managed Client',
      industry: 'Manufacturing',
      riskRating: 'medium',
    });
    expect(view!.ownerPartner?.fullName).toBe('C360 Partner Alpha');
    expect(view!.manager?.fullName).toBe('C360 Manager Alpha');

    expect(view!.legalEntities.map((e) => e.legalName).sort()).toEqual([
      'C360 Managed LLP',
      'C360 Managed Pvt Ltd',
    ]);
    // Registrations span multiple entities and types (DM-06 multi-GSTIN capable).
    const regs = view!.registrations.map((r) => `${r.type}:${r.value}`).sort();
    expect(regs).toEqual(['GSTIN:27AAACM0002A1Z5', 'PAN:AAACM0001A', 'PAN:AAACM0002B']);
    expect(view!.contacts).toHaveLength(2);
    expect(view!.contacts.find((c) => c.isPrimary)?.email).toBe('cfo@example.test');

    // Both edges visible to a partner, both endpoint names resolved —
    // including the endpoint belonging to a DIFFERENT client of the firm.
    const relIds = view!.relationships.map((r) => r.id).sort();
    expect(relIds).toEqual([REL.crossClient, REL.withinClient].sort());
    const cross = view!.relationships.find((r) => r.id === REL.crossClient)!;
    expect(cross.fromEntityName).toBe('C360 Managed Pvt Ltd');
    expect(cross.toEntityName).toBe('C360 Plain & Partners');
    expect(cross.toClientId).toBe(C.plain);

    expect(view!.engagements).toHaveLength(1);
    expect(view!.engagements[0].engagement.id).toBe(ENG);
    expect(view!.engagements[0].responsiblePartnerName).toBe('C360 Partner Alpha');
  });

  it('TEST-API-02: unknown, malformed, and foreign-firm ids all return the identical null', async () => {
    await expect(client360Service.getClient360(UNKNOWN_ID)).resolves.toBeNull();
    await expect(client360Service.getClient360('not-a-uuid')).resolves.toBeNull();
    await expect(client360Service.getClient360(C.firmB)).resolves.toBeNull();
  });

  it('manager: portfolio client composes; non-portfolio and foreign ids are null', async () => {
    await signInAs(userEmail('USER_A_MANAGER'));
    setActiveFirm(FIRM_A);

    const view = await client360Service.getClient360(C.managed);
    expect(view).not.toBeNull();
    expect(view!.client.id).toBe(C.managed);

    await expect(client360Service.getClient360(C.plain)).resolves.toBeNull();
    await expect(client360Service.getClient360(C.firmB)).resolves.toBeNull();
    await expect(client360Service.getClient360(UNKNOWN_ID)).resolves.toBeNull();
  });

  it('manager: relationship edge is hidden when EITHER endpoint leaves the portfolio (IMP-020 closure A)', async () => {
    const view = await client360Service.getClient360(C.managed);
    const relIds = view!.relationships.map((r) => r.id);
    // managed1 → managed2 (both in portfolio): visible.
    expect(relIds).toContain(REL.withinClient);
    // managed1 → plain (plain client is not manager A's): hidden, and no
    // name/identity of the hidden endpoint leaks through the composite.
    expect(relIds).not.toContain(REL.crossClient);
    expect(JSON.stringify(view)).not.toContain('C360 Plain');
  });

  it('billing and senior get no composite at all (TEST-API-02 null, not a projection mix-up)', async () => {
    await signInAs(userEmail('USER_A_BILLING'));
    setActiveFirm(FIRM_A);
    await expect(client360Service.getClient360(C.managed)).resolves.toBeNull();

    await signInAs(userEmail('USER_A_SENIOR'));
    setActiveFirm(FIRM_A);
    await expect(client360Service.getClient360(C.managed)).resolves.toBeNull();
  });

  it('suspended membership loses the composite with the SAME JWT (DEC-J live membership)', async () => {
    await signInAs(userEmail('USER_A_MANAGER'));
    setActiveFirm(FIRM_A);
    await expect(client360Service.getClient360(C.managed)).resolves.not.toBeNull();

    psql(
      `update public.firm_memberships set status = 'suspended' where id = '${M.managerA}'`,
    );
    await expect(client360Service.getClient360(C.managed)).resolves.toBeNull();

    psql(`update public.firm_memberships set status = 'active' where id = '${M.managerA}'`);
    await expect(client360Service.getClient360(C.managed)).resolves.not.toBeNull();
  });

  it('listActiveStaff returns own-firm active staff with names, and reflects suspension live', async () => {
    await signInAs(userEmail('USER_A_PARTNER'));
    setActiveFirm(FIRM_A);

    const staff = await client360Service.listActiveStaff();
    const byId = new Map(staff.map((s) => [s.membershipId, s]));
    expect(byId.get(M.partnerA)?.fullName).toBe('C360 Partner Alpha');
    expect(byId.get(M.managerA)?.fullName).toBe('C360 Manager Alpha');
    // No profile row was inserted for billing/senior — they still appear
    // as staff entries (name fallback), but never partner B of firm B.
    expect(byId.has(M.partnerB)).toBe(false);

    psql(
      `update public.firm_memberships set status = 'suspended' where id = '${M.managerA}'`,
    );
    const after = await client360Service.listActiveStaff();
    expect(after.some((s) => s.membershipId === M.managerA)).toBe(false);
    psql(`update public.firm_memberships set status = 'active' where id = '${M.managerA}'`);
  });

  it('empty collections inside the composite are normal results (TEST-API-01)', async () => {
    // C.plain has no contacts and no engagements — arrays, not errors.
    const view = await client360Service.getClient360(C.plain);
    expect(view).not.toBeNull();
    expect(view!.contacts).toEqual([]);
    expect(view!.engagements).toEqual([]);
    expect(view!.relationships.map((r) => r.id)).toEqual([REL.crossClient]);
    expect(view!.relationships[0].fromEntityName).toBe('C360 Managed Pvt Ltd');
  });
});
