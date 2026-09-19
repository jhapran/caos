/**
 * IMP-060 — Command Centre & Morning Brief live data: domain types
 * (provider-neutral) for the API-R0-DASH aggregate read model.
 *
 * Architecture (API-OQ-03 RESOLVED 2026-09-19, human-approved = B-count):
 * RLS-respecting per-section exact-count reads for the scalar aggregates,
 * composed behind `@/data`, with limited row fetches ONLY where an approved
 * derivation genuinely requires row-level fields:
 *   - the effective-active alert derivation (exact count of persisted
 *     'active' alerts + a limited fetch of persisted 'snoozed' rows whose
 *     snoozedUntil/acknowledgedAt fields decide whether they read as
 *     effectively active — the exact TEST-API-18 read derivation, IMP-042 /
 *     IMP-051 semantics unchanged);
 *   - the IMP-051 deadline_board security_invoker view for deadline risk
 *     (grouped server-side rows; at-risk is the view's own derivation).
 * B-fetch (paged row-fetch counting) is NOT the aggregate implementation,
 * and no composite RPC or SECURITY DEFINER aggregate function exists.
 *
 * Approved live set (API-R0-DASH, human rulings H1–H8 in `12`):
 *   1. task counts by state (DM-SM-05);
 *   2. deadline risk (at-risk compliance obligations, deadline_board);
 *   3. review pending;
 *   4. active alerts (TEST-API-18 effective-status derivation);
 * plus Compliance Health as live compliance_instances DM-SM-04 state truth
 * (H1 — fixture task-category semantics are NOT the live definition).
 * NO additional aggregate metrics: no Morning Brief attention total (H2),
 * no synthetic On-Track (H3), no Team Overload (H4), no billing/revenue
 * (H5), no AI/composite Attention List (H6).
 *
 * Collection/count semantics: every count executes under the signed-in
 * caller's RLS context with the x-active-firm selector unchanged (context
 * selection, never authorization — RLS-CTX-01/02). A role with no visible
 * rows (e.g. billing) receives truthful zeros; a transport/query failure
 * throws through toApiError (never a fabricated zero, never a fixture
 * fallback).
 */
import type { ComplianceInstanceState } from '@/data/complianceInstances/types';
import type { DataSource } from '@/data/source';

import type { TaskStatus } from '../tasks/types';

// --- Vocabulary lists (canonical order; mirror the SCH CHECK sets) -----------

/** DM-SM-05 eight-state task lifecycle (the tasks_status_check set). */
export const DASHBOARD_TASK_STATES: readonly TaskStatus[] = [
  'open',
  'in_progress',
  'waiting',
  'submitted',
  'returned',
  'approved',
  'done',
  'cancelled',
];

/** DM-SM-04 ten-state compliance-instance pipeline (canonical order). */
export const DASHBOARD_INSTANCE_STATES: readonly ComplianceInstanceState[] = [
  'not_started',
  'information_requested',
  'information_received',
  'preparation',
  'internal_review',
  'client_approval',
  'ready_to_file',
  'filed',
  'acknowledgement_received',
  'closed',
];

/** DM-SM-04 states that are still in flight (pre-closure) — the live
 *  Compliance Health "open obligations" hero is the sum of these counts. */
export const OPEN_INSTANCE_STATES: readonly ComplianceInstanceState[] =
  DASHBOARD_INSTANCE_STATES.filter((s) => s !== 'closed');

// --- Aggregate record ---------------------------------------------------------

/** The approved API-R0-DASH live counter set. Every key is always present
 *  (zero-filled), so UI code never renders an undefined counter. */
export interface DashboardAggregates {
  /** API-R0-DASH (1): task counts by DM-SM-05 state. */
  taskCountsByState: Record<TaskStatus, number>;
  /** H1: Compliance Health — live compliance_instances DM-SM-04 state
   *  truth (NOT fixture task-category semantics). */
  complianceInstanceCountsByState: Record<ComplianceInstanceState, number>;
  /** API-R0-DASH (2): at-risk compliance obligations, summed from the
   *  IMP-051 deadline_board view's own at_risk derivation. */
  atRiskDeadlines: number;
  /** API-R0-DASH (3): pending review items. */
  reviewPending: number;
  /** API-R0-DASH (4): effectively-active alerts — persisted-active exact
   *  count plus snoozed rows that read active under TEST-API-18. */
  activeAlerts: number;
}

export function zeroTaskCounts(): Record<TaskStatus, number> {
  return Object.fromEntries(DASHBOARD_TASK_STATES.map((s) => [s, 0])) as Record<
    TaskStatus,
    number
  >;
}

export function zeroInstanceCounts(): Record<ComplianceInstanceState, number> {
  return Object.fromEntries(
    DASHBOARD_INSTANCE_STATES.map((s) => [s, 0]),
  ) as Record<ComplianceInstanceState, number>;
}

/** The truthful empty contract: all counters zero. Used when there is no
 *  active-firm selector (nothing can be visible) — never used to mask a
 *  transport/query failure, which always throws. */
export function emptyDashboardAggregates(): DashboardAggregates {
  return {
    taskCountsByState: zeroTaskCounts(),
    complianceInstanceCountsByState: zeroInstanceCounts(),
    atRiskDeadlines: 0,
    reviewPending: 0,
    activeAlerts: 0,
  };
}

// --- Service contract (API-R0-DASH) --------------------------------------------

/**
 * The provider-neutral Command Centre / Morning Brief aggregate contract.
 * Two implementations (fixture demo track / Supabase production) sit behind
 * this interface; consumers import `dashboardService` from `@/data`.
 *
 * Read-only: there is NO write surface. The production adapter performs
 * per-section exact-count PostgREST reads under the caller's RLS (B-count);
 * tenant isolation is identical to the underlying table/view reads — the
 * composition holds no authorization logic of its own.
 */
export interface DashboardService {
  readonly mode: DataSource;

  /** The approved live counter set for Command Centre / Morning Brief.
   *  Throws ApiError on failure (the UI renders a truthful error state). */
  getDashboardAggregates(): Promise<DashboardAggregates>;
}
