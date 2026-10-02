/**
 * IMP-062 — TEST-API-09 (component level): the Review Queue surface stays
 * correct under realtime event failures and always reconciles against
 * authoritative server state.
 *
 * Proven here against the REAL useReviewQueue hook with the service mocked
 * at the @/data boundary:
 *   - invalidation → authoritative re-read: a freshness signal NEVER
 *     patches local state; the hook re-reads through reviewService and the
 *     UI renders exactly what the server read returns;
 *   - duplicate events are harmless: each collapses to a refetch, the
 *     rendered state is identical;
 *   - route re-entry (unmount → remount) performs a fresh authoritative
 *     read before the UI is treated as current (API-RT-06);
 *   - unmount tears the subscription down (explicit teardown — the
 *     load-bearing IMP-062 lifecycle requirement);
 *   - a missed event corrupts nothing: the UI simply keeps the last
 *     authoritative read until the next signal/refetch (API-RT-05).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

import type { ReviewItemRecord } from '@/data';

const mock = vi.hoisted(() => ({
  rows: [] as unknown[],
  listReviewItems: vi.fn(),
  invalidate: null as null | (() => void),
  unsubscribes: 0,
}));

vi.mock('@/data', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/data')>();
  return {
    ...original,
    getDataSource: () => 'supabase',
    reviewService: {
      mode: 'supabase',
      listReviewItems: (...args: unknown[]) => mock.listReviewItems(...args),
      subscribeReviewQueue: (onInvalidate: () => void) => {
        mock.invalidate = onInvalidate;
        return () => {
          mock.unsubscribes += 1;
        };
      },
    },
  };
});

import { useReviewQueue } from '@/hooks/useReviewQueue';

function Probe() {
  const { items, loading, error } = useReviewQueue({ status: 'pending' });
  if (loading) return <div>loading</div>;
  if (error) return <div>error</div>;
  return <div data-testid="queue">{items.map((i: ReviewItemRecord) => i.title).join(',') || 'empty'}</div>;
}

const ITEM = (id: string, title: string) =>
  ({
    id,
    firmId: 'f-1',
    clientId: 'c-1',
    taskId: null,
    complianceInstanceId: null,
    type: 'gst_reconciliation',
    source: 'human',
    title,
    note: null,
    status: 'pending',
    priority: 'normal',
    submittedByMembershipId: 'm-1',
    submittedAt: '2026-10-02T09:00:00.000Z',
    decidedByMembershipId: null,
    decidedAt: null,
    decisionRationale: null,
    slaDueAt: null,
    createdAt: '2026-10-02T09:00:00.000Z',
    updatedAt: null,
  }) as ReviewItemRecord;

beforeEach(() => {
  cleanup();
  mock.rows = [];
  mock.unsubscribes = 0;
  mock.invalidate = null;
  mock.listReviewItems = vi.fn(async () => mock.rows);
});

describe('useReviewQueue — TEST-API-09 resilience (API-RT-05/06)', () => {
  it('an invalidation triggers an authoritative re-read — never a local patch', async () => {
    render(<Probe />);
    await screen.findByText('empty');
    expect(mock.listReviewItems).toHaveBeenCalledTimes(1);

    // The server state changes; the freshness signal arrives.
    mock.rows = [ITEM('ri-1', 'GSTR-2A reco')];
    mock.invalidate?.();
    await screen.findByText('GSTR-2A reco');
    expect(mock.listReviewItems).toHaveBeenCalledTimes(2);
    // The read goes through the service with the hook's filter — the event
    // carried nothing and nothing was applied locally.
    expect(mock.listReviewItems).toHaveBeenLastCalledWith({ status: 'pending' });
  });

  it('duplicate and repeated invalidations leave the UI identical', async () => {
    mock.rows = [ITEM('ri-1', 'GSTR-2A reco')];
    render(<Probe />);
    await screen.findByText('GSTR-2A reco');

    mock.invalidate?.();
    mock.invalidate?.();
    mock.invalidate?.();
    // React may batch the repeated refetch requests into one re-read —
    // either way each invalidation collapses to an authoritative re-read…
    await waitFor(() => expect(mock.listReviewItems.mock.calls.length).toBeGreaterThanOrEqual(2));
    // …and the rendered state is exactly the server state.
    expect(screen.getByTestId('queue').textContent).toBe('GSTR-2A reco');
  });

  it('a missed event corrupts nothing — the last authoritative read stands', async () => {
    mock.rows = [ITEM('ri-1', 'GSTR-2A reco')];
    render(<Probe />);
    await screen.findByText('GSTR-2A reco');
    // No invalidation arrives (missed event). The UI keeps the last
    // authoritative state; nothing is fabricated or dropped.
    expect(screen.getByTestId('queue').textContent).toBe('GSTR-2A reco');
    expect(mock.listReviewItems).toHaveBeenCalledTimes(1);
  });

  it('route re-entry (unmount → remount) re-reads authoritatively before the UI is current', async () => {
    mock.rows = [ITEM('ri-1', 'first')];
    const first = render(<Probe />);
    await screen.findByText('first');
    expect(mock.listReviewItems).toHaveBeenCalledTimes(1);

    // Unmount: the subscription is explicitly torn down.
    first.unmount();
    expect(mock.unsubscribes).toBe(1);

    // Re-entry: the server moved on; the remount reads fresh state.
    mock.rows = [ITEM('ri-2', 'second')];
    render(<Probe />);
    await screen.findByText('second');
    expect(mock.listReviewItems).toHaveBeenCalledTimes(2);
    expect(screen.queryByText('first')).toBeNull();
  });

  it('unmount unsubscribes exactly once per mounted consumer', async () => {
    const tree = render(<Probe />);
    await screen.findByText('empty');
    tree.unmount();
    expect(mock.unsubscribes).toBe(1);
    // A late invalidation after teardown reaches no one.
    mock.invalidate?.();
    expect(mock.listReviewItems).toHaveBeenCalledTimes(1);
  });
});
