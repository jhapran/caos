/**
 * IMP-014 — Tenancy service contract, fixture implementation (demo track).
 *
 * The supabase implementation is exercised against the real local stack by
 * tests/integration/tenancy/*; here we pin the shared provider-neutral
 * contract shape the demo deployment depends on (API-ARCH-02: consumer
 * code does not care which adapter is active).
 */
import { describe, expect, it } from 'vitest';

import { tenancyService } from '@/data/tenancy/tenancyService';

describe('tenancyService — fixture mode (demo track)', () => {
  it('selects the fixture implementation by default', () => {
    expect(tenancyService.mode).toBe('fixture');
  });

  it('lists one synthetic active demo membership for firm switching', async () => {
    const memberships = await tenancyService.listMyMemberships();
    expect(memberships).toHaveLength(1);
    expect(memberships[0]).toMatchObject({
      firmId: 'demo-fixture-firm',
      firmName: 'CAOS Demo Firm',
      status: 'active',
    });
  });

  it('serves the demo profile; unknown ids normalize to null (API-ERR-02)', async () => {
    const profile = await tenancyService.getMyProfile();
    expect(profile).toMatchObject({ id: 'demo-fixture-user', fullName: 'Demo Principal' });
    expect(await tenancyService.getProfile('demo-fixture-user')).toEqual(profile);
    expect(await tenancyService.getProfile('00000000-0000-0000-0000-000000000000')).toBeNull();
  });
});
