/**
 * IMP-020 — Client-hierarchy Supabase adapter contract against the real
 * local stack (TEST-API-01…03 for the client-hierarchy domain).
 *
 * Drives the PUBLIC @/data contract (clientHierarchyService) in supabase
 * mode (setup-env pins it) exactly as application code will: no PostgREST
 * shapes, no provider error types, no existence oracles. RLS stays the
 * authorization boundary — the adapter asserts only contract behavior:
 *
 *   TEST-API-01 — collection reads return [] for invisible rows, never
 *     an error;
 *   TEST-API-02 — single-resource reads return null for nonexistent AND
 *     inaccessible ids alike;
 *   TEST-API-03 — writes to unknown/inaccessible ids surface
 *     ApiError('not_found'); invariant violations surface
 *     ApiError('conflict'); a missing active-firm selection surfaces
 *     ApiError('validation') BEFORE any request is sent.
 *
 * Fixture rows: deterministic ids in the 95000000-… range; teardown
 * removes hierarchy rows first (FK order), then memberships/firms, then
 * fixture audit rows as the operator.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { setActiveFirm, clearActiveFirm } from '@/data/context';
import { clientHierarchyService } from '@/data/clientHierarchy';
import { toApiError } from '@/data/errors';
import { getSupabaseClient } from '@/lib/supabaseClient';

import { FIRM_A, FIRM_B, PASSWORD, psql, userEmail, userId } from '../helpers.mjs';

const M = {
  partnerA: '95000000-0000-4000-8000-000000000001',
  managerA: '95000000-0000-4000-8000-000000000002',
  billingA: '95000000-0000-4000-8000-000000000003',
  partnerB: '95000000-0000-4000-8000-000000000004',
};

const C = {
  managed: '95000000-0000-4000-8000-000000000101',
  plain: '95000000-0000-4000-8000-000000000102',
  firmB: '95000000-0000-4000-8000-000000000111',
};
const E = { managed: '95000000-0000-4000-8000-000000000201' };

const PARTNER_A = userId('USER_A_PARTNER');
const MANAGER_A = userId('USER_A_MANAGER');
const BILLING_A = userId('USER_A_BILLING');
const PARTNER_B = userId('USER_B_PARTNER');

const UNKNOWN_ID = '95000000-0000-4000-8000-00000000ffff';

async function signInAs(email: string) {
  const { error } = await getSupabaseClient().auth.signInWithPassword({
    email,
    password: PASSWORD,
  });
  expect(error).toBeNull();
}

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

beforeAll(async () => {
  cleanRows();
  psql(`
    insert into public.firms (id, name) values
      ('${FIRM_A}', 'IMP-020 Adapter Firm A'),
      ('${FIRM_B}', 'IMP-020 Adapter Firm B')
    on conflict (id) do nothing;

    insert into public.firm_memberships (id, firm_id, user_id, role, status) values
      ('${M.partnerA}', '${FIRM_A}', '${PARTNER_A}', 'partner', 'active'),
      ('${M.managerA}', '${FIRM_A}', '${MANAGER_A}', 'manager', 'active'),
      ('${M.billingA}', '${FIRM_A}', '${BILLING_A}', 'billing', 'active'),
      ('${M.partnerB}', '${FIRM_B}', '${PARTNER_B}', 'partner', 'active')
    on conflict (firm_id, user_id) do nothing;

    insert into public.clients (id, firm_id, name, owner_partner_membership_id, manager_membership_id, status) values
      ('${C.managed}', '${FIRM_A}', 'Adapter Client Managed', '${M.partnerA}', '${M.managerA}', 'active'),
      ('${C.plain}',   '${FIRM_A}', 'Adapter Client Plain',   '${M.partnerA}', null,            'active'),
      ('${C.firmB}',   '${FIRM_B}', 'Adapter Client FirmB',   '${M.partnerB}', null,            'active');

    insert into public.legal_entities (id, firm_id, client_id, entity_type, legal_name) values
      ('${E.managed}', '${FIRM_A}', '${C.managed}', 'private_limited', 'Adapter Entity Managed');
  `);
  psql(`delete from public.audit_log where firm_id in ('${FIRM_A}', '${FIRM_B}')`);
  await signInAs(userEmail('USER_A_PARTNER'));
  setActiveFirm(FIRM_A);
});

afterAll(async () => {
  clearActiveFirm();
  await getSupabaseClient().auth.signOut();
  cleanRows();
  psql(`
    delete from public.firm_memberships where firm_id in ('${FIRM_A}', '${FIRM_B}');
    delete from public.firms where id in ('${FIRM_A}', '${FIRM_B}');
  `);
});

describe('clientHierarchyService — supabase adapter (TEST-API-01…03)', () => {
  it('serves the shared contract in supabase mode (API-ARCH-02)', () => {
    expect(clientHierarchyService.mode).toBe('supabase');
  });

  it('lists active-firm clients as domain DTOs (camelCase, no provider shape)', async () => {
    const clients = await clientHierarchyService.listClients();
    const ids = clients.map((c) => c.id);
    expect(ids).toEqual(expect.arrayContaining([C.managed, C.plain]));
    expect(ids).not.toContain(C.firmB);
    const managed = clients.find((c) => c.id === C.managed);
    expect(managed).toMatchObject({
      firmId: FIRM_A,
      name: 'Adapter Client Managed',
      ownerPartnerMembershipId: M.partnerA,
      managerMembershipId: M.managerA,
      status: 'active',
    });
    expect(managed).not.toHaveProperty('firm_id');
  });

  it('TEST-API-02: unknown and foreign ids both return null — identical shape', async () => {
    expect(await clientHierarchyService.getClient(C.managed)).toMatchObject({
      name: 'Adapter Client Managed',
    });
    expect(await clientHierarchyService.getClient(UNKNOWN_ID)).toBeNull();
    expect(await clientHierarchyService.getClient(C.firmB)).toBeNull();
  });

  it('create/update roundtrip; default list excludes offboarded (DM-04)', async () => {
    const created = await clientHierarchyService.createClient({
      name: 'Adapter Newco',
      ownerPartnerMembershipId: M.partnerA,
      status: 'offboarded',
      tags: ['GST'],
    });
    expect(created.id).toBeTruthy();
    expect(created.status).toBe('offboarded');

    const defaultList = await clientHierarchyService.listClients();
    expect(defaultList.some((c) => c.id === created.id)).toBe(false);
    const all = await clientHierarchyService.listClients({ includeOffboarded: true });
    expect(all.some((c) => c.id === created.id)).toBe(true);

    const updated = await clientHierarchyService.updateClient(created.id, {
      status: 'active',
      industry: 'Trading',
    });
    expect(updated.status).toBe('active');
    expect(updated.industry).toBe('Trading');
    expect(updated.updatedAt).not.toBeNull();
  });

  it('TEST-API-03: writes to unknown/inaccessible ids surface not_found', async () => {
    await expect(
      clientHierarchyService.updateClient(UNKNOWN_ID, { name: 'x' }),
    ).rejects.toMatchObject({ name: 'ApiError', kind: 'not_found' });
    // Foreign-tenant row under the caller's selector: inaccessible ==
    // nonexistent, same not_found shape (API-ERR-02).
    await expect(
      clientHierarchyService.updateClient(C.firmB, { name: 'x' }),
    ).rejects.toMatchObject({ kind: 'not_found' });
  });

  it('legal entities: create/list/get within a client scope', async () => {
    const created = await clientHierarchyService.createLegalEntity({
      clientId: C.plain,
      entityType: 'llp',
      legalName: 'Adapter Entity Two',
    });
    expect(created.firmId).toBe(FIRM_A);
    const list = await clientHierarchyService.listLegalEntities(C.plain);
    expect(list.map((e) => e.id)).toContain(created.id);
    expect(await clientHierarchyService.getLegalEntity(created.id)).toMatchObject({
      legalName: 'Adapter Entity Two',
    });
    expect(await clientHierarchyService.getLegalEntity(UNKNOWN_ID)).toBeNull();
    const renamed = await clientHierarchyService.updateLegalEntity(created.id, {
      legalName: 'Adapter Entity Two Renamed',
      status: 'dormant',
    });
    expect(renamed.legalName).toBe('Adapter Entity Two Renamed');
    expect(renamed.status).toBe('dormant');
  });

  it('registrations: duplicate surfaces conflict, missing state surfaces validation', async () => {
    const reg = await clientHierarchyService.createRegistration({
      legalEntityId: E.managed,
      type: 'GSTIN',
      value: '27ADAPT0000A1Z5',
      state: 'Maharashtra',
    });
    expect(reg.status).toBe('active');
    await expect(
      clientHierarchyService.createRegistration({
        legalEntityId: E.managed,
        type: 'GSTIN',
        value: '27ADAPT0000A1Z5',
        state: 'Maharashtra',
      }),
    ).rejects.toMatchObject({ kind: 'conflict' });
    await expect(
      clientHierarchyService.createRegistration({
        legalEntityId: E.managed,
        type: 'GSTIN',
        value: '24ADAPT0000B1Z4',
      }),
    ).rejects.toMatchObject({ kind: 'validation' });
    const surrendered = await clientHierarchyService.updateRegistration(reg.id, {
      status: 'surrendered',
      validTo: '2026-03-31',
    });
    expect(surrendered.status).toBe('surrendered');
  });

  it('entity_type immutability: grant-level at the API, 23514+marker at the DB (closure decision C)', async () => {
    // The adapter contract intentionally excludes entityType from
    // updateLegalEntity, and the migration's column-pinned grant excludes
    // entity_type from UPDATE — PostgREST rejects the attempt with 42501
    // before any trigger runs. The 23514 + IMMUTABLE_FIELD detail marker is
    // the privileged-path guard (schema suite proves the trigger raises it;
    // the unit suite proves toApiError maps marked 23514 to conflict).
    const { error } = await getSupabaseClient()
      .from('legal_entities')
      .update({ entity_type: 'llp' })
      .eq('id', E.managed);
    expect(error).not.toBeNull();
    expect(error!.code).toBe('42501');
    expect(toApiError(error).kind).toBe('unauthorized');

    const { error: checkError } = await getSupabaseClient()
      .from('clients')
      .update({ status: 'not-a-status' })
      .eq('id', C.managed);
    expect(checkError).not.toBeNull();
    expect(checkError!.code).toBe('23514');
    expect(toApiError(checkError).kind).toBe('validation');
  });

  it('contacts: primary-without-email surfaces validation (SCH-08)', async () => {
    await expect(
      clientHierarchyService.createContact({
        clientId: C.managed,
        name: 'No Email',
        isPrimary: true,
      }),
    ).rejects.toMatchObject({ kind: 'validation' });
    const contact = await clientHierarchyService.createContact({
      clientId: C.managed,
      legalEntityId: E.managed,
      name: 'Finance Head',
      email: 'finance@adapter.example',
      isPrimary: true,
    });
    const contacts = await clientHierarchyService.listContacts(C.managed);
    expect(contacts.map((c) => c.id)).toContain(contact.id);
  });

  it('relationships: create and list from either endpoint', async () => {
    const second = await clientHierarchyService.createLegalEntity({
      clientId: C.managed,
      entityType: 'partnership',
      legalName: 'Adapter Entity Related',
    });
    const rel = await clientHierarchyService.createClientRelationship({
      fromEntityId: E.managed,
      toEntityId: second.id,
      relationType: 'group',
    });
    const fromSide = await clientHierarchyService.listClientRelationships(E.managed);
    const toSide = await clientHierarchyService.listClientRelationships(second.id);
    expect(fromSide.map((r) => r.id)).toContain(rel.id);
    expect(toSide.map((r) => r.id)).toContain(rel.id);
  });

  it('TEST-API-01: manager sees portfolio only; billing sees [] but gets identities', async () => {
    await signInAs(userEmail('USER_A_MANAGER'));
    setActiveFirm(FIRM_A);
    const managed = await clientHierarchyService.listClients();
    expect(managed.map((c) => c.id)).toEqual([C.managed]);

    await signInAs(userEmail('USER_A_BILLING'));
    setActiveFirm(FIRM_A);
    expect(await clientHierarchyService.listClients()).toEqual([]);
    const identities = await clientHierarchyService.listClientIdentities();
    expect(identities.map((i) => i.id)).toEqual(
      expect.arrayContaining([C.managed, C.plain]),
    );
    for (const identity of identities) {
      expect(Object.keys(identity).sort()).toEqual(['id', 'name', 'status']);
    }
  });

  it('writes without an active-firm selection fail fast with validation (RLS-CTX-01)', async () => {
    clearActiveFirm();
    await expect(
      clientHierarchyService.createClient({
        name: 'No Context',
        ownerPartnerMembershipId: M.partnerA,
      }),
    ).rejects.toMatchObject({ kind: 'validation' });
    // Reads without context are simply empty (selector selects nothing).
    expect(await clientHierarchyService.listClients()).toEqual([]);
  });
});
