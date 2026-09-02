/**
 * IMP-021 — Fixture engagement adapter contract (demo track).
 *
 * Runs under the unit harness, which pins DATA_SOURCE=fixture
 * (tests/setup.ts), so engagementService resolves to the fixture
 * implementation. Verifies the demo derivation from @/data/clients and
 * the contract's error/null semantics — no network, no Supabase client.
 */
import { describe, expect, it } from 'vitest';

import { CLIENTS } from '@/data/clients';
import { engagementService } from '@/data/engagements';

describe('fixture engagement adapter', () => {
  it('resolves to fixture mode under the unit harness', () => {
    expect(engagementService.mode).toBe('fixture');
  });

  it('derives one engagement per fixture client with tags as service lines', async () => {
    const engagements = await engagementService.listEngagements();
    expect(engagements.length).toBeGreaterThanOrEqual(CLIENTS.length);
    const abc = engagements.find((e) => e.clientId === 'c-abc');
    expect(abc).toMatchObject({
      id: 'c-abc-engagement',
      firmId: 'demo-fixture-firm',
      status: 'active',
      letterStatus: 'signed',
      serviceLines: expect.arrayContaining(['GST', 'TDS']),
    });
  });

  it('filters by client, status, and responsible partner', async () => {
    const byClient = await engagementService.listEngagements({ clientId: 'c-xyz' });
    expect(byClient.map((e) => e.id)).toEqual(['c-xyz-engagement']);
    const byPartner = await engagementService.listEngagements({
      responsiblePartnerMembershipId: 'u-priya',
    });
    expect(byPartner.length).toBeGreaterThan(0);
    expect(byPartner.every((e) => e.responsiblePartnerMembershipId === 'u-priya')).toBe(true);
  });

  it('getEngagement returns null for unknown ids (no existence oracle, API-ERR-02)', async () => {
    expect(await engagementService.getEngagement('c-abc-engagement')).toMatchObject({
      clientId: 'c-abc',
    });
    expect(await engagementService.getEngagement('e-nope')).toBeNull();
  });

  it('creates engagements for known clients; unknown clients are not_found', async () => {
    const created = await engagementService.createEngagement({
      clientId: 'c-pqr',
      responsiblePartnerMembershipId: 'u-priya',
      serviceLines: ['Audit'],
    });
    expect(created.status).toBe('draft');
    expect(created.letterStatus).toBe('not_started');
    await expect(
      engagementService.createEngagement({
        clientId: 'c-nope',
        responsiblePartnerMembershipId: 'u-priya',
      }),
    ).rejects.toMatchObject({ name: 'ApiError', kind: 'not_found' });
  });

  it('enforces DM-SM-03 transitions: invalid edges are conflict, no-op updates allowed', async () => {
    const created = await engagementService.createEngagement({
      clientId: 'c-rst',
      responsiblePartnerMembershipId: 'u-neha',
    });
    // draft -> active skips proposed: illegal.
    await expect(
      engagementService.updateEngagement(created.id, { status: 'active' }),
    ).rejects.toMatchObject({ kind: 'conflict' });
    // draft -> proposed -> active -> completed: the happy path.
    await engagementService.updateEngagement(created.id, { status: 'proposed' });
    await engagementService.updateEngagement(created.id, { status: 'active' });
    const done = await engagementService.updateEngagement(created.id, { status: 'completed' });
    expect(done.status).toBe('completed');
    // completed is terminal.
    await expect(
      engagementService.updateEngagement(created.id, { status: 'draft' }),
    ).rejects.toMatchObject({ kind: 'conflict' });
  });

  it('terminated requires a reason (validation, not conflict)', async () => {
    const created = await engagementService.createEngagement({
      clientId: 'c-lmn',
      responsiblePartnerMembershipId: 'u-pranav',
      status: 'active',
    });
    await expect(
      engagementService.updateEngagement(created.id, { status: 'terminated' }),
    ).rejects.toMatchObject({ kind: 'validation' });
    const ended = await engagementService.updateEngagement(created.id, {
      status: 'terminated',
      terminationReason: 'Client exited',
    });
    expect(ended.status).toBe('terminated');
  });

  it('updates of unknown ids are not_found', async () => {
    await expect(
      engagementService.updateEngagement('e-nope', { periodLabel: 'FY 2026-27' }),
    ).rejects.toMatchObject({ kind: 'not_found' });
  });

  it('the billing letter-status projection exposes only id/clientId/letterStatus', async () => {
    const rows = await engagementService.listEngagementLetterStatuses();
    expect(rows.length).toBeGreaterThan(0);
    expect(Object.keys(rows[0]).sort()).toEqual(['clientId', 'id', 'letterStatus']);
  });
});
