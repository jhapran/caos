/**
 * IMP-042 (UI slice) — My Work data hook (React side of the @/data
 * boundary).
 *
 * One place that owns: the initial getMyWork read (the four DEC-L buckets,
 * RLS-filtered and personally scoped in Supabase mode; the demo bridge in
 * fixture mode), the loading / error states, manual refetch, and freshness.
 *
 * Freshness is API-RT-02: My Work has NO subscription — refetch-on-mutate
 * (the page calls refetch after every confirmed mutation) and
 * refetch-on-focus only. No polling timer, no channel.
 */
import { useCallback, useEffect, useState } from 'react';

import { myworkService, toApiError } from '@/data';
import type { ApiError, MyWorkBuckets } from '@/data';

export interface MyWorkState {
  /** null while the first read is in flight. */
  buckets: MyWorkBuckets | null;
  loading: boolean;
  error: ApiError | null;
  refetch: () => void;
}

export function useMyWork(): MyWorkState {
  const [buckets, setBuckets] = useState<MyWorkBuckets | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const refetch = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    let active = true;
    myworkService
      .getMyWork()
      .then((rows) => {
        if (active) {
          setBuckets(rows);
          setError(null);
        }
      })
      .catch((e) => {
        // A failed re-read keeps the last good buckets on screen; only the
        // initial failure surfaces the error state (buckets stays null).
        if (active) setError(toApiError(e));
      });
    return () => {
      active = false;
    };
  }, [reloadKey]);

  // API-RT-02: refetch-on-focus — the only passive freshness My Work has.
  useEffect(() => {
    const onFocus = () => refetch();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refetch]);

  return { buckets, loading: buckets === null && error === null, error, refetch };
}
