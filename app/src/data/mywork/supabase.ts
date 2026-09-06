/**
 * IMP-042 (data-adapter slice) — My Work: SUPABASE adapter (production).
 *
 * Application-side composition over plain PostgREST reads under RLS
 * (API-ARCH-03, DM-X-02 precedent — human-ruled at IMP-042 contract
 * reconciliation 2026-09-06): intentionally NO aggregate SECURITY DEFINER
 * RPC, so RLS remains the authoritative filter on every underlying
 * statement and the composition can never surface a row the caller could
 * not read directly (API-SEC). The DEC-L bucketing itself is the pure
 * shared buildMyWorkBuckets (./types) — this adapter only gathers the
 * caller's own eligible work, canonicalizes returned items, and resolves
 * client display references.
 *
 * Own-assignment visibility (DEC-L, RLS-ALR-01-class scoping is NOT
 * recreated here — RLS already scopes the reads; this adapter applies the
 * personal My Work rule on top): the caller's live ACTIVE membership in the
 * active-firm context is resolved from the session (auth.getUser +
 * firm_memberships under RLS, the tenancy-adapter pattern); an item is the
 * caller's when that membership is the task's assignee or reviewer, or —
 * for standalone returned ReviewItems — the item's submitter. Billing and
 * non-staff roles get the empty contract; so do a missing session, a
 * missing live membership, and a missing active-firm selector (API-ERR-02
 * collection semantics — never an error).
 *
 * Returned canonicalization (DEC-L): returned ReviewItems are read under
 * RLS; a task-linked returned item claims its canonical TASK (marked
 * returned, surfaced only when that task is the caller's own work — the
 * ReviewItem is never additionally surfaced); a returned item with
 * task_id IS NULL surfaces standalone with the deterministic contract
 * next_action (STANDALONE_RETURNED_NEXT_ACTION), never reviewer rationale.
 *
 * Errors are translated once through toApiError() (API-ERR-01); no Supabase
 * SDK or PostgREST types cross this boundary.
 */
import { getActiveFirm } from '@/data/context';
import { toApiError } from '@/data/errors';
import type { MembershipRole } from '@/data/tenancy';
import { getSupabaseClient } from '@/lib/supabaseClient';

import type { TaskStatus } from '../tasks/types';
import {
  buildMyWorkBuckets,
  emptyMyWorkBuckets,
  kolkataBusinessDate,
  STANDALONE_RETURNED_NEXT_ACTION,
  type MyWorkItem,
  type MyWorkService,
} from './types';

// --- Row shapes (snake_case; the SCH-13/17 columns this read model needs) -----------

interface MyWorkTaskRow {
  id: string;
  client_id: string;
  title: string;
  next_action: string;
  status: TaskStatus;
  waiting_reason: string | null;
  due_date: string | null;
  priority: string;
  assignee_membership_id: string | null;
  reviewer_membership_id: string | null;
}

interface ReturnedReviewRow {
  id: string;
  client_id: string;
  task_id: string | null;
  title: string;
  priority: string;
  submitted_by_membership_id: string;
}

interface MembershipRow {
  id: string;
  role: MembershipRole;
  status: 'invited' | 'active' | 'suspended' | 'removed';
}

interface ClientNameRow {
  id: string;
  name: string;
}

const TASK_COLUMNS =
  'id, client_id, title, next_action, status, waiting_reason, due_date, priority, ' +
  'assignee_membership_id, reviewer_membership_id';

const RETURNED_REVIEW_COLUMNS =
  'id, client_id, task_id, title, priority, submitted_by_membership_id';

/** DM-SM-05 terminal states are never My Work items (DEC-L "non-terminal
 *  actionable"). */
const TERMINAL: readonly TaskStatus[] = ['done', 'cancelled'];

/** DEC-L staff visibility: the five staff roles only — billing (and any
 *  non-staff role) has no My Work access. */
const STAFF_ROLES: readonly MembershipRole[] = [
  'super_admin',
  'partner',
  'manager',
  'senior',
  'article_executive',
];

/**
 * The caller's live ACTIVE membership in the active-firm context — the
 * personal-scope key for every DEC-L rule. Null when there is no session,
 * no live membership, or no active-firm selector (all yield the empty
 * contract, never an error).
 */
async function resolveCallerMembership(): Promise<MembershipRow | null> {
  const firmId = getActiveFirm();
  if (!firmId) return null;
  const client = getSupabaseClient();
  const { data: userData, error: userError } = await client.auth.getUser();
  if (userError) throw toApiError(userError);
  const uid = userData.user?.id;
  if (!uid) return null;
  const { data, error } = await client
    .from('firm_memberships')
    .select('id, role, status')
    .eq('user_id', uid)
    .eq('firm_id', firmId)
    .eq('status', 'active')
    .maybeSingle();
  if (error) throw toApiError(error);
  const membership = data as MembershipRow | null;
  if (!membership || !STAFF_ROLES.includes(membership.role)) return null;
  return membership;
}

export const supabaseMyWork: MyWorkService = {
  mode: 'supabase',

  async getMyWork() {
    const membership = await resolveCallerMembership();
    if (!membership) return emptyMyWorkBuckets();

    const client = getSupabaseClient();
    // Two plain RLS reads composed (DM-X-02): the caller's visible tasks,
    // and the caller's visible returned review items. RLS scopes both; the
    // DEC-L personal rule narrows them to the caller's OWN work below.
    const [tasksRes, returnedRes] = await Promise.all([
      client.from('tasks').select(TASK_COLUMNS),
      client.from('review_items').select(RETURNED_REVIEW_COLUMNS).eq('status', 'returned'),
    ]);
    if (tasksRes.error) throw toApiError(tasksRes.error);
    if (returnedRes.error) throw toApiError(returnedRes.error);
    const tasks = (tasksRes.data ?? []) as unknown as MyWorkTaskRow[];
    const returnedItems = (returnedRes.data ?? []) as unknown as ReturnedReviewRow[];

    // Canonical items keyed by task id — own non-terminal tasks first.
    const byId = new Map<string, MyWorkItem>();
    for (const t of tasks) {
      if (TERMINAL.includes(t.status)) continue;
      const own =
        t.assignee_membership_id === membership.id || t.reviewer_membership_id === membership.id;
      if (!own) continue;
      byId.set(t.id, {
        id: t.id,
        kind: 'task',
        title: t.title,
        clientId: t.client_id,
        clientName: null, // resolved below
        dueDate: t.due_date,
        priority: t.priority,
        status: t.status,
        nextAction: t.next_action, // DEC-L: the stored next_action, never rationale
        returned: false,
        waitingReason: t.waiting_reason,
        taskId: t.id,
        reviewItemId: null,
      });
    }

    for (const r of returnedItems) {
      if (r.task_id !== null) {
        // Returned canonicalization: the TASK is the canonical item and is
        // claimed by Returned precedence. Surfaced only when the linked task
        // is the caller's own visible work — the ReviewItem itself is never
        // additionally surfaced (DEC-L).
        const task = byId.get(r.task_id);
        if (task) {
          task.returned = true;
          task.reviewItemId = r.id;
        }
      } else if (r.submitted_by_membership_id === membership.id) {
        // Standalone returned work: the caller's OWN submission only.
        byId.set(r.id, {
          id: r.id,
          kind: 'returned_review',
          title: r.title,
          clientId: r.client_id,
          clientName: null,
          dueDate: null,
          priority: r.priority,
          status: 'returned',
          nextAction: STANDALONE_RETURNED_NEXT_ACTION,
          returned: true,
          waitingReason: null,
          taskId: null,
          reviewItemId: r.id,
        });
      }
    }

    const items = [...byId.values()];
    if (items.length === 0) return emptyMyWorkBuckets();

    // Client display references — a plain RLS read over the referenced
    // clients; unresolvable names render null, never fail the read.
    const clientIds = [...new Set(items.map((i) => i.clientId))];
    const { data: clientRows, error: clientError } = await client
      .from('clients')
      .select('id, name')
      .in('id', clientIds);
    if (clientError) throw toApiError(clientError);
    const names = new Map(
      ((clientRows ?? []) as unknown as ClientNameRow[]).map((c) => [c.id, c.name]),
    );
    for (const item of items) item.clientName = names.get(item.clientId) ?? null;

    // DEC-L bucketing against the REAL current Asia/Kolkata business date
    // (TEN-22: the pinned demo clock applies to fixture mode only).
    return buildMyWorkBuckets(items, kolkataBusinessDate());
  },
};
