/**
 * IMP-051 (data-adapter slice) — Deadlines: domain types (provider-neutral)
 * for the API-R0-DLN deadline read model.
 *
 * Three bounded projections (DEADLINE_MODEL=DERIVED — no persisted deadline
 * table anywhere):
 *   A. DEADLINE BOARD — server-derived aggregation over
 *      compliance_instances ONLY (no task rows), grouped by
 *      (compliance_type_id, due_date) on the operative due_date with
 *      Asia/Kolkata business-date semantics (AUTO-DLN-01,
 *      migration interpretation (h)).
 *   B. DEADLINE DRILL-DOWN — the compliance_instances rows belonging to one
 *      derived group, with the approved client/entity/assignee projections.
 *   C. CLIENT-DEPENDENCY BOARD — a separate projection: instances in
 *      information_requested state plus waiting tasks (tasks appear ONLY
 *      here, never in the board aggregation).
 *
 * Collection semantics are API-ERR-02: an empty scope is an empty
 * collection, never an error and never fabricated data.
 */

// --- Vocabulary ------------------------------------------------------------------

/** Client-dependency row provenance: an information_requested compliance
 *  instance or a waiting task (DM-SM-05 status 'waiting'). */
export type ClientDependencyKind = 'instance' | 'task';

/** Separator between the compliance-type id and the ISO due date inside a
 *  deadline board group id ('<compliance_type_id>::<YYYY-MM-DD>'). */
export const DEADLINE_GROUP_ID_SEPARATOR = '::';

// --- Records (read DTOs) ------------------------------------------------------------

/** One deadline board group (projection A). Field names mirror the
 *  repository-approved DeadlineGroup shape (src/data/types.ts) with the
 *  production identity columns (compliance_type_id / ISO due_date). */
export interface DeadlineGroupRecord {
  /** '<compliance_type_id>::<due_date>' — the drill-down address. */
  groupId: string;
  complianceTypeId: string;
  complianceName: string;
  /** Operative due date 'YYYY-MM-DD' (never calculated_due_date). */
  dueDate: string;
  /** due_date − the Asia/Kolkata business date (negative = overdue). */
  daysLeft: number;
  totalClients: number;
  filed: number;
  readyToFile: number;
  inProgress: number;
  waiting: number;
  underReview: number;
  notStarted: number;
  atRisk: number;
}

/** One drill-down row (projection B): a compliance instance belonging to a
 *  deadline board group, with client/entity/assignee projections. Display
 *  names are null when not resolvable under the caller's RLS (never an
 *  error). */
export interface DeadlineInstanceRecord {
  id: string;
  clientId: string;
  clientName: string | null;
  legalEntityId: string;
  entityName: string | null;
  complianceTypeId: string;
  complianceName: string | null;
  periodLabel: string;
  /** DM-SM-04 state. */
  state: string;
  /** Operative due date 'YYYY-MM-DD'. */
  dueDate: string;
  daysLeft: number;
  assigneeMembershipId: string | null;
  assigneeName: string | null;
  reviewerMembershipId: string | null;
  reviewerName: string | null;
}

/** One client-dependency row (projection C). */
export interface ClientDependencyRecord {
  kind: ClientDependencyKind;
  id: string;
  clientId: string;
  clientName: string | null;
  /** Compliance-type name for instances; task title for tasks. */
  label: string;
  /** Period label for instances; null for tasks. */
  periodLabel: string | null;
  /** DM-SM-05 waiting_reason for tasks; null for instances. */
  waitingReason: string | null;
  /** Instance state or task status. */
  status: string;
  /** ISO timestamptz of the last state-affecting write. */
  waitingSince: string | null;
  /** Whole days waiting on the Asia/Kolkata business date. */
  ageDays: number;
  dueDate: string | null;
  assigneeMembershipId: string | null;
  reviewerMembershipId: string | null;
}

// --- Group-id helpers (pure) ----------------------------------------------------------

/** The drill-down address of a deadline board group. */
export function makeDeadlineGroupId(complianceTypeId: string, dueDate: string): string {
  return `${complianceTypeId}${DEADLINE_GROUP_ID_SEPARATOR}${dueDate}`;
}

/** Inverse of makeDeadlineGroupId. Returns null for a malformed id (the
 *  caller treats an unaddressable group as an empty drill-down — API-ERR-02
 *  collection semantics). */
export function parseDeadlineGroupId(
  groupId: string,
): { complianceTypeId: string; dueDate: string } | null {
  const idx = groupId.indexOf(DEADLINE_GROUP_ID_SEPARATOR);
  if (idx <= 0) return null;
  const complianceTypeId = groupId.slice(0, idx);
  const dueDate = groupId.slice(idx + DEADLINE_GROUP_ID_SEPARATOR.length);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return null;
  return { complianceTypeId, dueDate };
}

// --- Service contract (API-R0-DLN) ----------------------------------------------------

import type { DataSource } from '@/data/source';

/**
 * The provider-neutral deadlines contract (API-R0-DLN). Two implementations
 * (fixture demo track / Supabase production) sit behind this interface;
 * consumers import `deadlinesService` from `@/data`.
 *
 * Read-only: there is NO write surface. The production adapter reads the
 * two security_invoker views and composes plain RLS-protected reads for the
 * drill-down projections — tenant isolation is identical to the underlying
 * instance/task reads (RLS-CIN-01/RLS-TSK-01: cross-firm zero, manager
 * portfolio scope, senior/article assigned-only).
 */
export interface DeadlinesService {
  readonly mode: DataSource;

  /** Projection A: the deadline board groups visible to the caller,
   *  ascending due date. Empty scope → empty collection. */
  listDeadlineGroups(): Promise<DeadlineGroupRecord[]>;

  /** Projection B: the instance rows of ONE deadline board group (groupId
   *  as returned by listDeadlineGroups). Unknown/malformed group ids and
   *  empty scopes → empty collection. */
  listDeadlineGroupInstances(groupId: string): Promise<DeadlineInstanceRecord[]>;

  /** Projection C: the client-dependency rows visible to the caller.
   *  Empty scope → empty collection. */
  listClientDependencies(): Promise<ClientDependencyRecord[]>;
}
