/**
 * IMP-020 — Fixture client-hierarchy adapter contract (demo track).
 *
 * Runs under the unit harness, which pins DATA_SOURCE=fixture
 * (tests/setup.ts), so clientHierarchyService resolves to the fixture
 * implementation. Verifies the demo derivation from @/data/clients and
 * the contract's error/null semantics — no network, no Supabase client.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { CLIENTS } from '@/data/clients';
import { clientHierarchyService } from '@/data/clientHierarchy';

describe('fixture client-hierarchy adapter', () => {
  it('resolves to fixture mode under the unit harness', () => {
    expect(clientHierarchyService.mode).toBe('fixture');
  });

  it('lists every fixture client, sorted by name, with the demo firm id', async () => {
    const clients = await clientHierarchyService.listClients();
    expect(clients).toHaveLength(CLIENTS.length);
    expect(clients.every((c) => c.firmId === 'demo-fixture-firm')).toBe(true);
    const names = clients.map((c) => c.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });

  it('derives one default legal entity per client (DEC-F)', async () => {
    const entities = await clientHierarchyService.listLegalEntities('c-abc');
    expect(entities).toHaveLength(1);
    expect(entities[0]).toMatchObject({
      clientId: 'c-abc',
      entityType: 'private_limited',
      legalName: 'ABC Pvt Ltd',
      registeredAddress: 'Mumbai',
      status: 'active',
    });
  });

  it('derives registrations from PAN/GSTIN/CIN fixture fields', async () => {
    const regs = await clientHierarchyService.listRegistrations('c-abc-entity');
    const byType = Object.fromEntries(regs.map((r) => [r.type, r]));
    expect(byType.PAN.value).toBe('AABCA1234F');
    expect(byType.GSTIN.value).toBe('27AABCA1234F1Z5');
    expect(byType.GSTIN.state).toBe('Maharashtra');
    expect(byType.CIN.value).toBe('U74999MH2010PTC123456');
  });

  it('maps Goa GSTIN prefixes to state (DM-06 demo derivation)', async () => {
    const regs = await clientHierarchyService.listRegistrations('c-bluelotus-entity');
    expect(regs.find((r) => r.type === 'GSTIN')?.state).toBe('Goa');
  });

  it('getClient returns null for unknown ids (no existence oracle, API-ERR-02)', async () => {
    expect(await clientHierarchyService.getClient('c-abc')).toMatchObject({
      name: 'ABC Pvt Ltd',
    });
    expect(await clientHierarchyService.getClient('c-nope')).toBeNull();
  });

  it('excludes offboarded clients by default, includes on demand', async () => {
    const created = await clientHierarchyService.createClient({
      name: 'ZZZ Offboarded Demo',
      ownerPartnerMembershipId: 'u-priya',
      status: 'offboarded',
    });
    const defaultList = await clientHierarchyService.listClients();
    expect(defaultList.some((c) => c.id === created.id)).toBe(false);
    const withOffboarded = await clientHierarchyService.listClients({ includeOffboarded: true });
    expect(withOffboarded.some((c) => c.id === created.id)).toBe(true);
  });

  it('supports status/owner/tags filters', async () => {
    const byOwner = await clientHierarchyService.listClients({
      ownerPartnerMembershipId: 'u-priya',
    });
    expect(byOwner.length).toBeGreaterThan(0);
    expect(byOwner.every((c) => c.ownerPartnerMembershipId === 'u-priya')).toBe(true);
    const byTag = await clientHierarchyService.listClients({ tags: ['PF/ESI'] });
    expect(byTag.length).toBeGreaterThan(0);
    expect(byTag.every((c) => c.tags.includes('PF/ESI'))).toBe(true);
  });

  it('creates and updates clients; unknown updates throw not_found', async () => {
    const created = await clientHierarchyService.createClient({
      name: 'Fixture Newco',
      ownerPartnerMembershipId: 'u-priya',
      tags: ['GST'],
    });
    expect(created.status).toBe('onboarding');
    const updated = await clientHierarchyService.updateClient(created.id, {
      status: 'active',
      industry: 'Trading',
    });
    expect(updated.status).toBe('active');
    expect(updated.industry).toBe('Trading');
    expect(updated.updatedAt).not.toBeNull();
    await expect(
      clientHierarchyService.updateClient('c-nope', { name: 'x' }),
    ).rejects.toMatchObject({ name: 'ApiError', kind: 'not_found' });
  });

  it('enforces the registration invariants the database enforces', async () => {
    await expect(
      clientHierarchyService.createRegistration({
        legalEntityId: 'c-abc-entity',
        type: 'PAN',
        value: 'AABCA1234F',
      }),
    ).rejects.toMatchObject({ kind: 'conflict' });
    await expect(
      clientHierarchyService.createRegistration({
        legalEntityId: 'c-abc-entity',
        type: 'GSTIN',
        value: '24ZZZZZ0000Z1Z9',
      }),
    ).rejects.toMatchObject({ kind: 'validation' });
  });

  it('enforces the primary-contact email invariant (SCH-08)', async () => {
    await expect(
      clientHierarchyService.createContact({
        clientId: 'c-abc',
        name: 'No Email',
        isPrimary: true,
      }),
    ).rejects.toMatchObject({ kind: 'validation' });
    const contact = await clientHierarchyService.createContact({
      clientId: 'c-abc',
      name: 'Finance Head',
      email: 'finance@abc.example',
      isPrimary: true,
    });
    const contacts = await clientHierarchyService.listContacts('c-abc');
    expect(contacts.map((c) => c.id)).toContain(contact.id);
  });

  it('rejects relationship self-loops and unknown endpoints', async () => {
    await expect(
      clientHierarchyService.createClientRelationship({
        fromEntityId: 'c-abc-entity',
        toEntityId: 'c-abc-entity',
        relationType: 'group',
      }),
    ).rejects.toMatchObject({ kind: 'validation' });
    await expect(
      clientHierarchyService.createClientRelationship({
        fromEntityId: 'c-abc-entity',
        toEntityId: 'c-nope-entity',
        relationType: 'group',
      }),
    ).rejects.toMatchObject({ kind: 'not_found' });
  });

  it('lists relationships from either endpoint', async () => {
    const rel = await clientHierarchyService.createClientRelationship({
      fromEntityId: 'c-abc-entity',
      toEntityId: 'c-xyz-entity',
      relationType: 'group',
    });
    const fromSide = await clientHierarchyService.listClientRelationships('c-abc-entity');
    const toSide = await clientHierarchyService.listClientRelationships('c-xyz-entity');
    expect(fromSide.map((r) => r.id)).toContain(rel.id);
    expect(toSide.map((r) => r.id)).toContain(rel.id);
  });

  it('listClientIdentities projects id/name/status only', async () => {
    // Mutations from earlier tests persist in the module-local store, so
    // compare against the current full list rather than CLIENTS.length.
    const all = await clientHierarchyService.listClients({ includeOffboarded: true });
    const identities = await clientHierarchyService.listClientIdentities();
    expect(identities).toHaveLength(all.length);
    for (const identity of identities) {
      expect(Object.keys(identity).sort()).toEqual(['id', 'name', 'status']);
    }
  });

  describe('mutation isolation between tests', () => {
    beforeEach(() => {
      // Mutations above are module-local and ephemeral; nothing here
      // touches the network or the DemoStoreProvider overlay.
    });
    it('never initializes a Supabase client (MIG-DS-06)', async () => {
      const { getSupabaseClient } = await import('@/lib/supabaseClient');
      expect(() => getSupabaseClient()).toThrowError(/fixture mode/);
    });
  });
});
