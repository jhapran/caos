/**
 * IMP-041 PASS C — Review Queue data hook (React side of the @/data
 * boundary).
 *
 * One place that owns: the initial RLS-filtered queue read, the loading /
 * error states, manual refetch, and the API-RT-01 invalidation
 * subscription (realtime event → refetch through reviewService; payloads
 * are never used as data). The subscription is established once per
 * mounted consumer and always unsubscribed on cleanup.
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

  // API-RT-01: realtime/invalidation — every event simply refetches
  // through the RLS-controlled list. Exactly one subscription per mount.
  useEffect(() => reviewService.subscribeReviewQueue(refetch), [refetch]);

  return { items, loading: items === null, error, refetch };
}

/** The queue-count surface (API-RT-01): pending count, kept fresh by the
 *  same invalidation subscription. null while loading. */
export function useReviewPendingCount(): number | null {
  const { items } = useReviewQueue({ status: 'pending' });
  return items === null ? null : items.length;
}
