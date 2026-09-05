/**
 * IMP-041 PASS C — Review queue: SUPABASE adapter (production).
 *
 * Reads are plain PostgREST under RLS (API-ARCH-03): review_items SELECT
 * returns exactly the caller's authorized queue rows (RLS-RVW-01) — the
 * adapter never recreates role authorization in the browser and never
 * treats UI filtering as security. The ONLY write paths are the two
 * controlled Layer-B commands (submit_review_item / decide_review_item —
 * API-R0-RVW, API-ARCH-04); no direct INSERT/UPDATE/DELETE grant exists.
 *
 * The adapter never sends server-controlled inputs: no firm_id, no
 * submitted_by_membership_id / submitted_at, no status, no source, no
 * ai_output_id, and no decision fields on submission; decider identity and
 * timestamps are server-derived on decision.
 *
 * The commands return structured results: deliberate denials arrive as
 * { status: 'denied', kind, message } (already audited server-side,
 * AUD-FAIL-01) and are mapped onto the API-ERR-01 taxonomy here —
 * pre-authorization denials are the uniform not_found (API-ERR-02: the UI
 * cannot distinguish hidden-existing from nonexistent). A keyed replay
 * arrives as { status: 'already_applied', … } and is returned as a DTO,
 * never an error.
 *
 * Freshness (API-RT-01/03/05, API-RT-07): subscribeReviewQueue is a
 * provider-neutral invalidation subscription. The Supabase implementation
 * uses the APPROVED API-RT-07 POLLING FALLBACK: authenticated
 * postgres_changes cannot satisfy the R0 active-firm RLS context
 * (realtime's per-row RLS evaluation provides role + request.jwt.claims
 * only — never request.headers — so req_active_firm() is NULL there and
 * every tenant row is filtered out; proven by the 2026-09-06 executable
 * differential harness run). Every poll tick is treated purely as an
 * invalidation signal — the consumer re-reads through the normal
 * RLS-controlled list, so polling never widens authorization.
 *
 * Errors are translated once through toApiError() — no Supabase SDK or
 * PostgREST types cross this boundary (API-ARCH-01/02, API-ERR-01).
 */
import { getActiveFirm } from '@/data/context';
import { ApiError, toApiError, type ApiErrorKind } from '@/data/errors';
import { getSupabaseClient } from '@/lib/supabaseClient';

import type { TaskCommentRecord, TaskRecord, TaskStatus } from '../tasks/types';
import type {
  ReviewItemRecord,
  ReviewItemSource,
  ReviewItemStatus,
  ReviewItemType,
  ReviewService,
} from './types';

// --- Row shapes (snake_case, exactly the SCH-17 columns) -----------------------

interface ReviewItemRow {
  id: string;
  firm_id: string;
  client_id: string;
  task_id: string | null;
  compliance_instance_id: string | null;
  type: ReviewItemType;
  source: ReviewItemSource;
  title: string;
  note: string | null;
  status: ReviewItemStatus;
  priority: string;
  submitted_by_membership_id: string;
  submitted_at: string;
  decided_by_membership_id: string | null;
  decided_at: string | null;
  decision_rationale: string | null;
  ai_output_id: string | null;
  sla_due_at: string | null;
  created_at: string;
  updated_at: string | null;
}

/** Embedded linked-task row inside the decide_review_item result. */
interface EmbeddedTaskRow {
  id: string;
  firm_id: string;
  client_id: string;
  compliance_instance_id: string | null;
  title: string;
  description: string | null;
  next_action: string;
  status: TaskStatus;
  waiting_reason: string | null;
  due_date: string | null;
  priority: string;
  assignee_membership_id: string | null;
  reviewer_membership_id: string | null;
  time_spent_minutes: number;
  created_at: string;
  updated_at: string | null;
}

interface EmbeddedCommentRow {
  id: string;
  firm_id: string;
  task_id: string;
  author_id: string;
  body: string;
  retracted: boolean;
  created_at: string;
}

// --- Column projection and mappers ----------------------------------------------

const REVIEW_COLUMNS =
  'id, firm_id, client_id, task_id, compliance_instance_id, type, source, title, note, ' +
  'status, priority, submitted_by_membership_id, submitted_at, decided_by_membership_id, ' +
  'decided_at, decision_rationale, ai_output_id, sla_due_at, created_at, updated_at';

const toReviewItem = (r: ReviewItemRow): ReviewItemRecord => ({
  id: r.id,
  firmId: r.firm_id,
  clientId: r.client_id,
  taskId: r.task_id,
  complianceInstanceId: r.compliance_instance_id,
  type: r.type,
  source: r.source,
  title: r.title,
  note: r.note,
  status: r.status,
  priority: r.priority,
  submittedByMembershipId: r.submitted_by_membership_id,
  submittedAt: r.submitted_at,
  decidedByMembershipId: r.decided_by_membership_id,
  decidedAt: r.decided_at,
  decisionRationale: r.decision_rationale,
  slaDueAt: r.sla_due_at,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const toEmbeddedTask = (r: EmbeddedTaskRow): TaskRecord => ({
  id: r.id,
  firmId: r.firm_id,
  clientId: r.client_id,
  complianceInstanceId: r.compliance_instance_id,
  title: r.title,
  description: r.description,
  nextAction: r.next_action,
  status: r.status,
  waitingReason: r.waiting_reason,
  dueDate: r.due_date,
  priority: r.priority,
  assigneeMembershipId: r.assignee_membership_id,
  reviewerMembershipId: r.reviewer_membership_id,
  timeSpentMinutes: r.time_spent_minutes,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const toEmbeddedComment = (r: EmbeddedCommentRow): TaskCommentRecord => ({
  id: r.id,
  firmId: r.firm_id,
  taskId: r.task_id,
  authorId: r.author_id,
  body: r.body,
  retracted: r.retracted,
  createdAt: r.created_at,
});

// --- Command envelopes ------------------------------------------------------------

interface SubmitRpcResult {
  status: 'submitted' | 'denied';
  kind?: ApiErrorKind;
  message?: string;
  item?: ReviewItemRow;
}

interface DecideRpcResult {
  status: 'decided' | 'already_applied' | 'denied';
  kind?: ApiErrorKind;
  message?: string;
  from_status?: ReviewItemStatus;
  to_status?: ReviewItemStatus;
  reason?: string;
  item?: ReviewItemRow;
  task?: EmbeddedTaskRow;
  reviewer_comment?: EmbeddedCommentRow;
}

/** Map a Layer-B structured denial onto the API-ERR-01 taxonomy. */
function denialError(result: { kind?: ApiErrorKind; message?: string }): ApiError {
  return new ApiError(result.kind ?? 'internal', result.message ?? 'command denied');
}

// API-RT-07 fallback interval. Authenticated postgres_changes cannot
// satisfy the R0 active-firm RLS context (see the header above), so the
// review queue count/list freshness uses the approved polling fallback.
// Implementation parameter — tuneable later, NOT a product/SLA guarantee.
export const REVIEW_QUEUE_POLL_INTERVAL_MS = 15_000;

export const supabaseReview: ReviewService = {
  mode: 'supabase',

  async listReviewItems(filter) {
    // RLS is authoritative: the query returns exactly the caller's
    // authorized rows; the optional filters are UX narrowing only.
    let query = getSupabaseClient()
      .from('review_items')
      .select(REVIEW_COLUMNS)
      .order('submitted_at');
    if (filter?.status) query = query.eq('status', filter.status);
    if (filter?.type) query = query.eq('type', filter.type);
    if (filter?.submittedByMembershipId) {
      query = query.eq('submitted_by_membership_id', filter.submittedByMembershipId);
    }
    const { data, error } = await query;
    if (error) throw toApiError(error);
    return ((data ?? []) as unknown as ReviewItemRow[]).map(toReviewItem);
  },

  async submitReviewItem(input) {
    const { data, error } = await getSupabaseClient().rpc('submit_review_item', {
      // Business inputs only (API-R0-RVW): firm_id, submitted_by, submitted_at,
      // status, source, ai_output_id are server-derived — never sent.
      p_client_id: input.clientId ?? null,
      p_task_id: input.taskId ?? null,
      p_compliance_instance_id: input.complianceInstanceId ?? null,
      p_type: input.type,
      p_title: input.title,
      p_note: input.note ?? null,
      p_priority: input.priority ?? 'normal',
      p_sla_due_at: input.slaDueAt ?? null,
    });
    if (error) throw toApiError(error);
    const result = data as unknown as SubmitRpcResult;
    if (result.status === 'denied') throw denialError(result);
    if (!result.item) {
      throw new ApiError('internal', 'submit returned no review item row');
    }
    return toReviewItem(result.item);
  },

  async decideReviewItem(itemId, input) {
    const { data, error } = await getSupabaseClient().rpc('decide_review_item', {
      p_review_item_id: itemId,
      p_decision: input.decision,
      p_rationale: input.rationale,
      p_mutation_key: input.mutationKey ?? null,
    });
    if (error) throw toApiError(error);
    const result = data as unknown as DecideRpcResult;
    if (result.status === 'denied') throw denialError(result);
    if (!result.item) {
      throw new ApiError('internal', 'decision returned no review item row');
    }
    return {
      status: result.status,
      item: toReviewItem(result.item),
      fromStatus: result.from_status,
      toStatus: result.to_status,
      reason: result.reason,
      task: result.task ? toEmbeddedTask(result.task) : undefined,
      reviewerComment: result.reviewer_comment
        ? toEmbeddedComment(result.reviewer_comment)
        : undefined,
    };
  },

  subscribeReviewQueue(onInvalidate) {
    // API-RT-07 polling fallback: each tick is a bare invalidation signal —
    // no payload, no channel, no client-side authorization; the consumer
    // re-reads through the RLS-controlled list (API-RT-03/05). Every
    // consumer owns an independent timer (Navbar badge + queue page may be
    // mounted simultaneously); unsubscribe always clears it.
    const firmId = getActiveFirm();
    if (!firmId) return () => {}; // no selector context → no subscription
    const timer = setInterval(onInvalidate, REVIEW_QUEUE_POLL_INTERVAL_MS);
    return () => {
      clearInterval(timer);
    };
  },
};
