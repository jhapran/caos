/**
 * IMP-060 — Command Centre / Morning Brief aggregate hook (React side of
 * the @/data boundary): the API-R0-DASH B-count read model behind
 * dashboardService (provider-neutral — fixture demo track / Supabase
 * production).
 *
 * One place that owns: the initial getDashboardAggregates read, the
 * loading / error states, manual refetch, and freshness.
 *
 * Freshness is API-RT-02: Command Centre / Morning Brief have NO
 * subscription and NO polling — refetch-on-mutate (pages call refetch
 * after a confirmed mutation) and refetch-on-focus only.
 *
 * Truthfulness: a failed read surfaces the error state (pages render a
 * truthful error panel); a failed re-read keeps the last good aggregates
 * on screen. A zero counter is only ever a truthful RLS-scoped zero —
 * never a fabricated fallback.
 */
import { useCallback, useEffect, useState } from 'react';

import { dashboardService, toApiError } from '@/data';
import type { ApiError, DashboardAggregates } from '@/data';

export interface DashboardAggregatesState {
  /** null while the first read is in flight. */
  aggregates: DashboardAggregates | null;
  loading: boolean;
  error: ApiError | null;
  refetch: () => void;
}

export function useDashboardAggregates(): DashboardAggregatesState {
  const [aggregates, setAggregates] = useState<DashboardAggregates | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const refetch = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    let active = true;
    dashboardService
      .getDashboardAggregates()
      .then((result) => {
        if (active) {
          setAggregates(result);
          setError(null);
        }
      })
      .catch((e) => {
        // A failed re-read keeps the last good aggregates on screen; only
        // the initial failure surfaces the error state (aggregates stays
        // null).
        if (active) setError(toApiError(e));
      });
    return () => {
      active = false;
    };
  }, [reloadKey]);

  // API-RT-02: refetch-on-focus — the only passive freshness this surface
  // has. No subscription, no polling.
  useEffect(() => {
    const onFocus = () => refetch();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refetch]);

  return {
    aggregates,
    loading: aggregates === null && error === null,
    error,
    refetch,
  };
}
