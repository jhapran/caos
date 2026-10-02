/**
 * IMP-041 PASS C — Review Queue data hook (React side of the @/data
 * boundary).
 *
 * One place that owns: the initial RLS-filtered queue read, the loading /
 * error states, manual refetch, and the API-RT-01 invalidation
 * subscription (freshness signal → refetch through reviewService; the
 * signal never carries data — the Supabase implementation is IMP-062 R1-B:
 * a private firm-topic channel with the approved API-RT-07 polling
 * fallback always-on underneath). The subscription is established once per
 * mounted consumer and always unsubscribed on cleanup. Route re-entry
 * re-mounts this hook, so the initial read IS the API-RT-06 re-entry
 * authoritative refresh.
 */
import { useCallback, useEffect, useState } from 'react';

import { reviewService, toApiError } from '@/data';
import type { ApiError, ReviewItemRecord, ReviewQueueFilter } from '@/data';

export interface ReviewQueueState {
  /** null while the first read is in flight. */
  items: ReviewItemRecord[] | null;
  loading: boolean;
  error: ApiError | null;
  refetch: () => void;
}

export function useReviewQueue(filter?: ReviewQueueFilter): ReviewQueueState {
  const [items, setItems] = useState<ReviewItemRecord[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const refetch = useCallback(() => setReloadKey((k) => k + 1), []);

  const status = filter?.status;
  const type = filter?.type;
  const submittedBy = filter?.submittedByMembershipId;

  useEffect(() => {
    let active = true;
    reviewService
      .listReviewItems({ status, type, submittedByMembershipId: submittedBy })
      .then((rows) => {
        if (active) {
          setItems(rows);
          setError(null);
        }
      })
      .catch((e) => {
        if (active) {
          setError(toApiError(e));
          setItems([]);
        }
      });
    return () => {
      active = false;
    };
  }, [reloadKey, status, type, submittedBy]);

  // API-RT-01: freshness/invalidation — every signal simply refetches
  // through the RLS-controlled list (API-RT-03/05). Exactly one
  // subscription per mount.
  useEffect(() => reviewService.subscribeReviewQueue(refetch), [refetch]);

  return { items, loading: items === null, error, refetch };
}

/** The queue-count surface (API-RT-01): pending count, kept fresh by the
 *  same invalidation subscription. null while loading. */
export function useReviewPendingCount(): number | null {
  const { items } = useReviewQueue({ status: 'pending' });
  return items === null ? null : items.length;
}
