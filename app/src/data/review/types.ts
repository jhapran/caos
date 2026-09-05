/**
 * IMP-041 PASS C — Review queue: domain types (provider-neutral).
 *
 * Mirrors the production schema (SCH-17, spec 06) one-to-one in the
 * application-facing camelCase shape. A ReviewItemRecord is one piece of
 * work awaiting a four-eyes review decision (DM-21): always belonging to a
 * CLIENT (the authoritative ad-hoc subject), optionally linked to a task
 * and/or the compliance instance that task executes (subject binding is
 * enforced at the database, never by the caller).
 *
 * Vocabularies are the frozen R0 keys (API-OQ-01 RESOLVED 2026-09-05) —
 * display labels are presentation metadata in the UI, never stored values.
 *
 * Server-controlled fields are never caller input (API-R0-RVW):
 *   - firmId, submittedByMembershipId, submittedAt are derived by
 *     submit_review_item from the live session/membership;
 *   - status starts 'pending' and moves ONLY through decide_review_item
 *     (pending → approved/returned/escalated/dismissed, DM-SM-06 — no
 *     reopen, no terminal rewrite);
 *   - decidedByMembershipId/decidedAt/decisionRationale are stamped by the
 *     decision command; a non-empty rationale is mandatory for ALL four
 *     decisions;
 *   - source is forced 'human' in R0; aiOutputId stays NULL reserved
 *     provenance (no ai_outputs infrastructure exists in R0).
 */
import type { DataSource } from '@/data/source';
import type { TaskCommentRecord, TaskRecord } from '../tasks/types';

// --- Vocabularies (exactly the SCH-17 CHECK sets) ----------------------------

/** Frozen R0 review type keys (API-OQ-01). */
export type ReviewItemType =
  | 'gst_reconciliation'
  | 'tds_return'
  | 'itr_computation'
  | 'financial_statements'
  | 'audit_workpaper';

/** DM-SM-06 review lifecycle: pending, then exactly one terminal decision. */
export type ReviewItemStatus = 'pending' | 'approved' | 'returned' | 'escalated' | 'dismissed';

/** R0 application source is human; 'ai' is reserved provenance (SCH-17). */
export type ReviewItemSource = 'human' | 'ai';

/** The four legal terminal decisions (decide_review_item vocabulary). */
export type ReviewDecision = 'approved' | 'returned' | 'escalated' | 'dismissed';

// --- Record (read DTO) --------------------------------------------------------

/** ReviewItem = one unit of review work for one client (DM-21). */
export interface ReviewItemRecord {
  id: string;
  firmId: string;
  /** The authoritative subject: linked-task/instanced rows derive this
   *  server-side; for ad-hoc items it is the explicit client (SCH-17
   *  subject-binding invariants). */
  clientId: string;
  taskId: string | null;
  complianceInstanceId: string | null;
  type: ReviewItemType;
  source: ReviewItemSource;
  title: string;
  note: string | null;
  status: ReviewItemStatus;
  priority: string;
  /** Responsibility membership, never an auth.users id (SCH-RESP-01). */
  submittedByMembershipId: string;
  submittedAt: string;
  decidedByMembershipId: string | null;
  decidedAt: string | null;
  decisionRationale: string | null;
  slaDueAt: string | null;
  createdAt: string;
  updatedAt: string | null;
}

// --- Write inputs --------------------------------------------------------------

/**
 * Submission (API-R0-RVW). Business inputs only — the UI never sends
 * firmId / submittedByMembershipId / submittedAt / status / source /
 * aiOutputId / decision fields. Subject derivation is authoritative and
 * linked-subject-wins:
 *   - taskId supplied → clientId is server-derived from the task (a supplied
 *     clientId is at most a convenience assertion; mismatch is rejected);
 *   - else complianceInstanceId supplied → clientId derived from it;
 *   - else clientId is required (ad-hoc subject).
 * No mutation key exists on submission (API-MUT-03).
 */
export interface SubmitReviewItemInput {
  clientId?: string;
  taskId?: string;
  complianceInstanceId?: string;
  type: ReviewItemType;
  title: string;
  note?: string | null;
  priority?: string;
  slaDueAt?: string | null;
}

/**
 * Controlled decision invocation (API-R0-RVW). rationale is mandatory and
 * non-whitespace for every decision. mutationKey enables idempotent replay:
 * a keyed repeat against an already-decided item returns 'already_applied'
 * instead of a conflict (API-MUT-03, state-based).
 */
export interface DecideReviewItemInput {
  decision: ReviewDecision;
  rationale: string;
  mutationKey?: string;
}

/** Structured result of the decision command. 'already_applied' is a keyed
 *  replay surfacing the current row — NOT an error. For a task-linked
 *  'returned' decision, task/reviewerComment carry the atomic linked-task
 *  outcome (the task transition + the single immutable SCH-16 comment). */
export interface DecideReviewItemResult {
  status: 'decided' | 'already_applied';
  item: ReviewItemRecord;
  fromStatus?: ReviewItemStatus;
  toStatus?: ReviewItemStatus;
  /** Machine-readable replay reason (e.g. 'already_decided'). */
  reason?: string;
  task?: TaskRecord;
  reviewerComment?: TaskCommentRecord;
}

// --- List filters ---------------------------------------------------------------

export interface ReviewQueueFilter {
  status?: ReviewItemStatus;
  type?: ReviewItemType;
  /** Queue submitter filter (own-submissions views). */
  submittedByMembershipId?: string;
}

// --- Service contract (API-R0-RVW) ----------------------------------------------

/**
 * The provider-neutral review-queue contract. Two implementations (fixture
 * demo track / Supabase production) sit behind this interface; consumers
 * import `reviewService` from `@/data` and never know which is active
 * (API-ARCH-02).
 *
 * Error semantics (API-ERR-01/02):
 *   - collection reads return [] when nothing is visible — never an error
 *     (RLS silent omission);
 *   - both commands authorize BEFORE disclosure: unknown AND inaccessible
 *     items/subjects share the identical not_found surface;
 *   - role-scope denials post-authorization (RLS-4EY-04 self-decision, a
 *     linked task refusing the return under RLS-4EY-03) throw
 *     ApiError('unauthorized');
 *   - rejected input (unknown type, blank title, subject/client mismatch)
 *     throws ApiError('validation');
 *   - lifecycle violations (blank/whitespace rationale, terminal
 *     re-decision without a key, illegal linked-task state) throw
 *     ApiError('conflict');
 *   - there is NO direct status mutation, NO delete, and NO way to set
 *     server-controlled fields — the two Layer-B commands are the only
 *     write paths (API-ARCH-04).
 */
export interface ReviewService {
  readonly mode: DataSource;

  /** The caller's authorized queue rows (RLS-RVW-01 in production; the
   *  single fixture persona in demo mode). Ordered oldest-submitted first. */
  listReviewItems(filter?: ReviewQueueFilter): Promise<ReviewItemRecord[]>;

  /** Controlled submission command — the ONLY insert path. */
  submitReviewItem(input: SubmitReviewItemInput): Promise<ReviewItemRecord>;

  /**
   * Controlled decision command — the ONLY status/decision path. Four-eyes
   * (decider ≠ submitter, no rank bypass) is enforced by the server; a
   * task-linked 'returned' additionally requires the linked task's return
   * authority and legal state, applied atomically (DM-SM-06).
   */
  decideReviewItem(itemId: string, input: DecideReviewItemInput): Promise<DecideReviewItemResult>;

  /**
   * API-RT-01 invalidation subscription for the review queue count/list.
   * The callback means "re-read through the normal RLS-controlled list" —
   * payloads are never treated as data (API-RT-03/05). Returns the
   * unsubscribe function; subscriptions are scoped to the active firm and
   * cleaned up by the caller. Fixture mode simulates this locally
   * (API-RT-04) — no Supabase channel is ever opened in demo mode.
   */
  subscribeReviewQueue(onInvalidate: () => void): () => void;
}
