/**
 * IMP-060 — Dashboard aggregates: SUPABASE adapter (production).
 *
 * The human-approved B-count architecture (API-OQ-03 resolved 2026-09-19,
 * API-R0-DASH): scalar aggregates are RLS-respecting per-section
 * EXACT-COUNT PostgREST reads (`head: true, count: 'exact'`) — no row
 * datasets are fetched to compute a scalar, no composite RPC, no SECURITY
 * DEFINER aggregate. Limited row fetches occur only for the two approved
 * derivations:
 *
 *   - ACTIVE ALERTS (TEST-API-18 read derivation, IMP-042/IMP-051 semantics
 *     unchanged): one exact count of persisted 'active' rows PLUS a limited
 *     column fetch of persisted 'snoozed' rows (id, snoozed_until,
 *     acknowledged_at) — a snoozed row past snoozed_until reads as
 *     'acknowledged' when acknowledged_at IS NOT NULL, else 'active'. The
 *     shared deriveAlertEffectiveStatus helper (../alerts/types) is the
 *     only derivation logic; no new alert lifecycle formula exists here.
 *
 *   - DEADLINE RISK (API-R0-DLN): the IMP-051 deadline_board
 *     security_invoker view carries the server-side at-risk derivation
 *     (Asia/Kolkata business date, operative due_date); this adapter reads
 *     the grouped at_risk column and sums it. It never re-implements the
 *     at-risk formula and never reads calculated_due_date provenance.
 *
 * Every statement executes under the signed-in caller's RLS with the
 * x-active-firm selector injected by the browser client (RLS-CTX-01/02 —
 * context selection, never authorization). Manager/senior receive
 * portfolio/assigned slices (RLS-STF-03/04), billing receives truthful
 * zeros, cross-firm is always zero. With no active-firm selector the
 * truthful empty contract is returned (API-ERR-02 collection semantics).
 * Any query/transport failure throws through toApiError (API-ERR-01) — a
 * failed read is NEVER reported as zero and NEVER falls back to fixture
 * numbers (MIG-DS-05).
 */
import { getActiveFirm } from '@/data/context';
import { toApiError } from '@/data/errors';
import { getSupabaseClient } from '@/lib/supabaseClient';

import { deriveAlertEffectiveStatus } from '../alerts/types';
import {
  DASHBOARD_INSTANCE_STATES,
  DASHBOARD_TASK_STATES,
  emptyDashboardAggregates,
  zeroInstanceCounts,
  zeroTaskCounts,
  type DashboardAggregates,
  type DashboardService,
} from './types';

/** Snoozed-row projection for the TEST-API-18 derivation — the only alert
 *  row fetch, limited to the three columns the derivation reads. */
interface SnoozedAlertRow {
  id: string;
  snoozed_until: string | null;
  acknowledged_at: string | null;
}

/** The one deadline_board column the deadline-risk derivation sums. */
interface DeadlineRiskRow {
  at_risk: number;
}

export const supabaseDashboard: DashboardService = {
  mode: 'supabase',

  async getDashboardAggregates(): Promise<DashboardAggregates> {
    // No active-firm selector → nothing can be visible under the
    // RLS-CTX-01/02 context contract; the truthful empty contract, never
    // an error and never fabricated data.
    if (!getActiveFirm()) return emptyDashboardAggregates();

    const client = getSupabaseClient();

    // One exact-count HEAD read per state — the caller's RLS scopes every
    // count; no rows cross the wire for any scalar.
    const taskCountQueries = DASHBOARD_TASK_STATES.map((status) =>
      client
        .from('tasks')
        .select('id', { count: 'exact', head: true })
        .eq('status', status),
    );
    const instanceCountQueries = DASHBOARD_INSTANCE_STATES.map((state) =>
      client
        .from('compliance_instances')
        .select('id', { count: 'exact', head: true })
        .eq('state', state),
    );

    const [
      taskResults,
      instanceResults,
      reviewPendingRes,
      activeAlertCountRes,
      snoozedAlertsRes,
      deadlineRiskRes,
    ] = await Promise.all([
      Promise.all(taskCountQueries),
      Promise.all(instanceCountQueries),
      client
        .from('review_items')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending'),
      client
        .from('alerts')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'active'),
      client
        .from('alerts')
        .select('id, snoozed_until, acknowledged_at')
        .eq('status', 'snoozed'),
      client.from('deadline_board').select('at_risk'),
    ]);

    const taskCountsByState = zeroTaskCounts();
    taskResults.forEach((res, i) => {
      if (res.error) throw toApiError(res.error);
      taskCountsByState[DASHBOARD_TASK_STATES[i]] = res.count ?? 0;
    });

    const complianceInstanceCountsByState = zeroInstanceCounts();
    instanceResults.forEach((res, i) => {
      if (res.error) throw toApiError(res.error);
      complianceInstanceCountsByState[DASHBOARD_INSTANCE_STATES[i]] = res.count ?? 0;
    });

    if (reviewPendingRes.error) throw toApiError(reviewPendingRes.error);
    if (activeAlertCountRes.error) throw toApiError(activeAlertCountRes.error);
    if (snoozedAlertsRes.error) throw toApiError(snoozedAlertsRes.error);
    if (deadlineRiskRes.error) throw toApiError(deadlineRiskRes.error);

    // TEST-API-18 read derivation: an expired snooze with no acknowledgement
    // history reads as effectively active. One clock reading for the whole
    // composition; no expiry write ever happens here.
    const now = new Date();
    const snoozedRows = (snoozedAlertsRes.data ?? []) as unknown as SnoozedAlertRow[];
    const expiredUnacknowledged = snoozedRows.filter(
      (row) =>
        deriveAlertEffectiveStatus(
          {
            status: 'snoozed',
            snoozedUntil: row.snoozed_until,
            acknowledgedAt: row.acknowledged_at,
          },
          now,
        ) === 'active',
    ).length;

    const deadlineRiskRows = (deadlineRiskRes.data ?? []) as unknown as DeadlineRiskRow[];

    return {
      taskCountsByState,
      complianceInstanceCountsByState,
      atRiskDeadlines: deadlineRiskRows.reduce((sum, row) => sum + row.at_risk, 0),
      reviewPending: reviewPendingRes.count ?? 0,
      activeAlerts: (activeAlertCountRes.count ?? 0) + expiredUnacknowledged,
    };
  },
};
