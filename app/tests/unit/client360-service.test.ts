/**
 * IMP-022 — Client 360 fixture adapter contract (unit level, fixture
 * demo track via tests/setup.ts). Asserts the composite read model shape
 * (API-R0-CLI / DM-X-02) and the API-ERR-02 single-resource semantics:
 * unknown ids return null, never an error, never fabricated data.
 */
import { describe, expect, it } from 'vitest';

import { CLIENTS } from '@/data/clients';
import { client360Service } from '@/data/client360/client360Service';

describe('client360Service — fixture adapter (IMP-022)', () => {
  it('composes the full view for a demo client', async () => {
    const view = await client360Service.getClient360('c-abc');
    expect(view).not.toBeNull();
    const abc = CLIENTS.find((c) => c.id === 'c-abc')!;

    expect(view!.client.name).toBe(abc.name);
    // One derived default entity carrying the fixture identifiers.
    expect(view!.legalEntities).toHaveLength(1);
    expect(view!.legalEntities[0].entityType).toBe('private_limited');
    const types = view!.registrations.map((r) => r.type).sort();
    expect(types).toEqual(['CIN', 'GSTIN', 'PAN']);
    // Demo fixtures carry no contacts or group edges — empty collections
    // are normal results (API-ERR-02), not errors.
    expect(view!.contacts).toEqual([]);
    expect(view!.relationships).toEqual([]);
    // IMP-021 derives one engagement per demo client.
    expect(view!.engagements).toHaveLength(1);
  });

  it('resolves partner/manager display names from the demo roster', async () => {
    const view = await client360Service.getClient360('c-abc');
    // Fixture c-abc ownerId u-priya → Priya Nair (never the raw id).
    expect(view!.ownerPartner?.fullName).toBe('Priya Nair');
    expect(view!.ownerPartner?.membershipId).toBe('u-priya');
    expect(view!.engagements[0].responsiblePartnerName).toBe('Priya Nair');
    expect(view!.manager).toBeNull();
  });

  it('returns null for unknown, malformed, and empty ids alike (API-ERR-02)', async () => {
    await expect(client360Service.getClient360('c-nope')).resolves.toBeNull();
    await expect(client360Service.getClient360('not-a-uuid')).resolves.toBeNull();
    await expect(client360Service.getClient360('')).resolves.toBeNull();
  });

  it('listActiveStaff returns the demo roster with mapped roles', async () => {
    const staff = await client360Service.listActiveStaff();
    expect(staff.length).toBeGreaterThanOrEqual(5);
    const priya = staff.find((s) => s.membershipId === 'u-priya');
    expect(priya?.fullName).toBe('Priya Nair');
    expect(priya?.role).toBe('manager');
  });

  it('reflects in-session hierarchy mutations (create client → entity → registration)', async () => {
    const created = await import('@/data/clientHierarchy/clientHierarchyService').then(
      (m) => m.clientHierarchyService,
    );
    const client = await created.createClient({
      name: 'Unit Test Client',
      ownerPartnerMembershipId: 'u-pranav',
    });
    const entity = await created.createLegalEntity({
      clientId: client.id,
      entityType: 'llp',
      legalName: 'Unit Test Client LLP',
    });
    await created.createRegistration({
      legalEntityId: entity.id,
      type: 'PAN',
      value: 'AAACU9999Z',
    });

    const view = await client360Service.getClient360(client.id);
    expect(view).not.toBeNull();
    expect(view!.legalEntities.map((e) => e.legalName)).toContain('Unit Test Client LLP');
    expect(view!.registrations.map((r) => r.value)).toContain('AAACU9999Z');
  });
});
