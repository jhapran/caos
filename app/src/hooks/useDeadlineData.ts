/**
 * IMP-060 — Deadline / client-dependency live read hooks (React side of
 * the @/data boundary): the IMP-051 API-R0-DLN read model behind
 * deadlinesService (provider-neutral — fixture demo bridge / Supabase
 * production).
 *
 * Freshness is API-RT-02 for every surface here: NO subscription, NO
 * polling — refetch-on-mutate (refetch after a confirmed mutation) and
 * refetch-on-focus only.
 *
 * Truthfulness: a failed read surfaces the error state; a failed re-read
 * keeps the last good data on screen. An empty collection is only ever a
 * truthful RLS-scoped empty scope (API-ERR-02), never fabricated rows.
 */
import { useCallback, useEffect, useState } from 'react';

import { deadlinesService, toApiError } from '@/data';
import type {
  ApiError,
  ClientDependencyRecord,
  DeadlineGroupRecord,
  DeadlineInstanceRecord,
} from '@/data';

interface ReadState<T> {
  /** null while the first read is in flight. */
  data: T | null;
  loading: boolean;
  error: ApiError | null;
  refetch: () => void;
}

function useDeadlineRead<T>(read: () => Promise<T>): ReadState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const refetch = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    let active = true;
    read()
      .then((result) => {
        if (active) {
          setData(result);
          setError(null);
        }
      })
      .catch((e) => {
        // A failed re-read keeps the last good data on screen; only the
        // initial failure surfaces the error state (data stays null).
        if (active) setError(toApiError(e));
      });
    return () => {
      active = false;
    };
  }, [read, reloadKey]);

  // API-RT-02: refetch-on-focus — the only passive freshness these
  // surfaces have.
  useEffect(() => {
    const onFocus = () => refetch();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refetch]);

  return { data, loading: data === null && error === null, error, refetch };
}

/** Projection A: the deadline board groups visible to the caller. */
export function useDeadlineGroups(): ReadState<DeadlineGroupRecord[]> {
  const read = useCallback(() => deadlinesService.listDeadlineGroups(), []);
  return useDeadlineRead(read);
}

/** Projection B: the instance rows of ONE deadline board group. */
export function useDeadlineGroupInstances(
  groupId: string,
): ReadState<DeadlineInstanceRecord[]> {
  const read = useCallback(() => deadlinesService.listDeadlineGroupInstances(groupId), [groupId]);
  return useDeadlineRead(read);
}

/** Projection C: the client-dependency rows visible to the caller. */
export function useClientDependencies(): ReadState<ClientDependencyRecord[]> {
  const read = useCallback(() => deadlinesService.listClientDependencies(), []);
  return useDeadlineRead(read);
}
