/**
 * IMP-021 — Engagement Supabase adapter contract against the real local
 * stack (TEST-API-01…03 for the engagement domain).
 *
 * Drives the PUBLIC @/data contract (engagementService) in supabase mode
 * (setup-env pins it) exactly as application code will: no PostgREST
 * shapes, no provider error types, no existence oracles. RLS stays the
 * authorization boundary — the adapter asserts only contract behavior:
 *
 *   TEST-API-01 — collection reads return [] for invisible rows, never
 *     an error;
 *   TEST-API-02 — single-resource reads return null for nonexistent AND
 *     inaccessible ids alike;
 *   TEST-API-03 — writes to unknown/inaccessible ids surface
 *     ApiError('not_found'); illegal DM-SM-03 transitions surface
 *     ApiError('conflict'); rejected input (terminated without reason)
 *     surfaces ApiError('validation'); a missing active-firm selection
 *     surfaces ApiError('validation') BEFORE any request is sent.
 *
 * Fixture rows: deterministic ids in the 99000000-… range; teardown
 * removes engagement rows first (FK order), then clients, then
 * memberships/firms, then fixture audit rows as the operator.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { setActiveFirm, clearActiveFirm } from '@/data/context';
import { engagementService } from '@/data/engagements';
import { getSupabaseClient } from '@/lib/supabaseClient';

import { FIRM_A, FIRM_B, PASSWORD, psql, userEmail, userId } from '../helpers.mjs';

const M = {
  partnerA: '99000000-0000-4000-8000-000000000001',
  managerA: '99000000-0000-4000-8000-000000000002',
  billingA: '99000000-0000-4000-8000-000000000003',
  partnerB: '99000000-0000-4000-8000-000000000004',
};

const C = {
  managed: '99000000-0000-4000-8000-000000000101',
  plain: '99000000-0000-4000-8000-000000000102',
  firmB: '99000000-0000-4000-8000-000000000111',
};
const G = {
  managed: '99000000-0000-4000-8000-000000000201',
  firmB: '99000000-0000-4000-8000-000000000211',
};

const PARTNER_A = userId('USER_A_PARTNER');
const MANAGER_A = userId('USER_A_MANAGER');
const BILLING_A = userId('USER_A_BILLING');
const PARTNER_B = userId('USER_B_PARTNER');

const UNKNOWN_ID = '99000000-0000-4000-8000-00000000ffff';

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
    delete from public.clients where firm_id in ('${FIRM_A}', '${FIRM_B}');
    delete from public.audit_log where firm_id in ('${FIRM_A}', '${FIRM_B}');
  `);
}

beforeAll(async () => {
  cleanRows();
  psql(`
    insert into public.firms (id, name) values
      ('${FIRM_A}', 'IMP-021 Adapter Firm A'),
      ('${FIRM_B}', 'IMP-021 Adapter Firm B')
    on conflict (id) do nothing;

    insert into public.firm_memberships (id, firm_id, user_id, role, status) values
      ('${M.partnerA}', '${FIRM_A}', '${PARTNER_A}', 'partner', 'active'),
      ('${M.managerA}', '${FIRM_A}', '${MANAGER_A}', 'manager', 'active'),
      ('${M.billingA}', '${FIRM_A}', '${BILLING_A}', 'billing', 'active'),
      ('${M.partnerB}', '${FIRM_B}', '${PARTNER_B}', 'partner', 'active')
    on conflict (firm_id, user_id) do nothing;

    insert into public.clients (id, firm_id, name, owner_partner_membership_id, manager_membership_id, status) values
      ('${C.managed}', '${FIRM_A}', 'ENG Adapter Client Managed', '${M.partnerA}', '${M.managerA}', 'active'),
      ('${C.plain}',   '${FIRM_A}', 'ENG Adapter Client Plain',   '${M.partnerA}', null,            'active'),
      ('${C.firmB}',   '${FIRM_B}', 'ENG Adapter Client FirmB',   '${M.partnerB}', null,            'active');

    insert into public.engagements (id, firm_id, client_id, responsible_partner_membership_id, service_lines, status, letter_status) values
      ('${G.managed}', '${FIRM_A}', '${C.managed}', '${M.partnerA}', '{GST,MCA}', 'active', 'signed'),
      ('${G.firmB}',   '${FIRM_B}', '${C.firmB}',   '${M.partnerB}', '{GST}',     'active', 'issued');
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

describe('engagementService — supabase adapter (TEST-API-01…03)', () => {
  it('serves the shared contract in supabase mode (API-ARCH-02)', () => {
    expect(engagementService.mode).toBe('supabase');
  });

  it('lists active-firm engagements as domain DTOs (camelCase, no provider shape)', async () => {
    const engagements = await engagementService.listEngagements();
    const ids = engagements.map((e) => e.id);
    expect(ids).toContain(G.managed);
    expect(ids).not.toContain(G.firmB);
    const managed = engagements.find((e) => e.id === G.managed);
    expect(managed).toMatchObject({
      firmId: FIRM_A,
      clientId: C.managed,
      responsiblePartnerMembershipId: M.partnerA,
      serviceLines: ['GST', 'MCA'],
      status: 'active',
      letterStatus: 'signed',
    });
    expect(managed).not.toHaveProperty('firm_id');
  });

  it('filters by client and status', async () => {
    const byClient = await engagementService.listEngagements({ clientId: C.managed });
    expect(byClient.map((e) => e.id)).toEqual([G.managed]);
    const drafts = await engagementService.listEngagements({ status: 'draft' });
    expect(drafts.every((e) => e.status === 'draft')).toBe(true);
  });

  it('TEST-API-02: unknown and foreign ids both return null — identical shape', async () => {
    expect(await engagementService.getEngagement(G.managed)).toMatchObject({
      clientId: C.managed,
    });
    expect(await engagementService.getEngagement(UNKNOWN_ID)).toBeNull();
    expect(await engagementService.getEngagement(G.firmB)).toBeNull();
  });

  it('create/update roundtrip through the DM-SM-03 lifecycle', async () => {
    const created = await engagementService.createEngagement({
      clientId: C.plain,
      responsiblePartnerMembershipId: M.partnerA,
      serviceLines: ['ITR'],
      periodLabel: 'FY 2025-26',
    });
    expect(created.status).toBe('draft');
    expect(created.letterStatus).toBe('not_started');
    expect(created.firmId).toBe(FIRM_A);

    const proposed = await engagementService.updateEngagement(created.id, {
      status: 'proposed',
      letterStatus: 'issued',
      proposedAt: '2026-09-01T09:00:00.000Z',
    });
    expect(proposed.status).toBe('proposed');
    expect(proposed.updatedAt).not.toBeNull();

    const activated = await engagementService.updateEngagement(created.id, {
      status: 'active',
      letterStatus: 'signed',
      signedAt: '2026-09-02T09:00:00.000Z',
    });
    expect(activated.letterStatus).toBe('signed');
  });

  it('TEST-API-03: writes to unknown/inaccessible ids surface not_found', async () => {
    await expect(
      engagementService.updateEngagement(UNKNOWN_ID, { periodLabel: 'x' }),
    ).rejects.toMatchObject({ name: 'ApiError', kind: 'not_found' });
    // Foreign-tenant row under the caller's selector: inaccessible ==
    // nonexistent, same not_found shape (API-ERR-02).
    await expect(
      engagementService.updateEngagement(G.firmB, { periodLabel: 'x' }),
    ).rejects.toMatchObject({ kind: 'not_found' });
  });

  it('illegal transitions surface conflict; rejected input surfaces validation', async () => {
    const created = await engagementService.createEngagement({
      clientId: C.plain,
      responsiblePartnerMembershipId: M.partnerA,
    });
    // draft -> completed is not a DM-SM-03 edge: marked 23514 → conflict.
    await expect(
      engagementService.updateEngagement(created.id, { status: 'completed' }),
    ).rejects.toMatchObject({ kind: 'conflict' });
    // draft -> proposed -> active, then terminated WITHOUT a reason: plain
    // CHECK → validation.
    await engagementService.updateEngagement(created.id, { status: 'proposed' });
    await engagementService.updateEngagement(created.id, { status: 'active' });
    await expect(
      engagementService.updateEngagement(created.id, { status: 'terminated' }),
    ).rejects.toMatchObject({ kind: 'validation' });
    const ended = await engagementService.updateEngagement(created.id, {
      status: 'terminated',
      terminationReason: 'Scope completed elsewhere',
    });
    expect(ended.status).toBe('terminated');
  });

  it('manager is read-only through the adapter too: create surfaces unauthorized', async () => {
    await signInAs(userEmail('USER_A_MANAGER'));
    try {
      // Portfolio read still works (the manager reads G.managed's client).
      const visible = await engagementService.listEngagements();
      expect(visible.map((e) => e.id)).toEqual([G.managed]);
      await expect(
        engagementService.createEngagement({
          clientId: C.managed,
          responsiblePartnerMembershipId: M.partnerA,
        }),
      ).rejects.toMatchObject({ kind: 'unauthorized' });
    } finally {
      await signInAs(userEmail('USER_A_PARTNER'));
    }
  });

  it('billing gets only the letter-status projection (RLS-ENG-01)', async () => {
    await signInAs(userEmail('USER_A_BILLING'));
    try {
      expect(await engagementService.listEngagements()).toEqual([]);
      const statuses = await engagementService.listEngagementLetterStatuses();
      const ids = statuses.map((s) => s.id);
      expect(ids).toContain(G.managed);
      expect(ids).not.toContain(G.firmB);
      expect(Object.keys(statuses[0]).sort()).toEqual(['clientId', 'id', 'letterStatus']);
    } finally {
      await signInAs(userEmail('USER_A_PARTNER'));
    }
  });

  it('writes without an active-firm selection fail fast with validation (RLS-CTX-01)', async () => {
    clearActiveFirm();
    try {
      await expect(
        engagementService.createEngagement({
          clientId: C.plain,
          responsiblePartnerMembershipId: M.partnerA,
        }),
      ).rejects.toMatchObject({ kind: 'validation' });
    } finally {
      setActiveFirm(FIRM_A);
    }
  });
});
