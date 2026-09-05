/**
 * IMP-014 — Fixture mode never touches the network or Supabase
 * (MIG-DS-06, TEST-MIG-06/07). Deterministic: createClient is a mock spy
 * and fetch is stubbed to throw — fixture mode must invoke neither, and
 * must not require Supabase credentials.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const createClientSpy = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error('createClient must never run in fixture mode');
  }),
);

vi.mock('@supabase/supabase-js', () => ({
  createClient: createClientSpy,
}));

import { authService } from '@/data/auth/authService';
import { client360Service } from '@/data/client360/client360Service';
import { engagementService } from '@/data/engagements/engagementService';
import { reviewService } from '@/data/review/reviewService';
import { taskService } from '@/data/tasks/taskService';
import { tenancyService } from '@/data/tenancy/tenancyService';

describe('fixture mode — no network, no Supabase (MIG-DS-06)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('both fixture adapters are selected and run with zero client construction and zero fetch', async () => {
    const fetchSpy = vi.fn(() => {
      throw new Error('network access is forbidden in fixture mode');
    });
    vi.stubGlobal('fetch', fetchSpy);

    expect(authService.mode).toBe('fixture');
    expect(tenancyService.mode).toBe('fixture');
    expect(engagementService.mode).toBe('fixture');

    await authService.restore();
    await authService.signInPassword('a@b.c', 'x');
    await authService.signInMagicLink('a@b.c', 'http://x');
    await tenancyService.listMyMemberships();
    await tenancyService.getMyProfile();
    await tenancyService.getProfile('demo-fixture-user');
    // IMP-021: the engagement fixture adapter is on the same guarantee.
    await engagementService.listEngagements();
    await engagementService.getEngagement('c-abc-engagement');
    await engagementService.listEngagementLetterStatuses();
    // IMP-022: the Client 360 fixture adapter composes in-memory only.
    expect(client360Service.mode).toBe('fixture');
    await client360Service.getClient360('c-abc');
    await client360Service.listActiveStaff();
    // IMP-040: the tasks fixture adapter is on the same guarantee.
    expect(taskService.mode).toBe('fixture');
    await taskService.listTasks();
    await taskService.getTaskDetail('task-abc-gstr1-filing');
    // IMP-041: the review-queue fixture adapter is on the same guarantee —
    // including the subscription surface, which is a LOCAL listener in
    // fixture mode (API-RT-04) and must never open a Supabase channel.
    expect(reviewService.mode).toBe('fixture');
    await reviewService.listReviewItems();
    const unsubscribe = reviewService.subscribeReviewQueue(() => {});
    unsubscribe();

    expect(createClientSpy).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('the Supabase browser client cannot be constructed in fixture mode', async () => {
    const { getSupabaseClient } = await import('@/lib/supabaseClient');
    expect(() => getSupabaseClient()).toThrow(/MIG-DS-06/);
    expect(createClientSpy).not.toHaveBeenCalled();
  });
});
