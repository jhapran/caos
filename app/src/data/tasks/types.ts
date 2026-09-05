/**
 * IMP-040 — Tasks, dependencies, checklists, comments: domain types
 * (provider-neutral).
 *
 * Mirror the production schema (SCH-13 / SCH-14 / SCH-15 / SCH-16, spec 06)
 * one-to-one in the application-facing camelCase shape. A TaskRecord is the
 * DM-13 execution activity — belonging to a CLIENT always (DEC-H), and
 * optionally linked to a compliance instance — moving through the DM-SM-05
 * eight-state lifecycle. TaskDependencyRecord is the first-class SCH-14
 * task-to-task edge (DM-OQ-04); TaskChecklistItemRecord the DM-14 checkable
 * line; TaskCommentRecord the immutable DM-15 discussion/review remark.
 *
 * Server-controlled fields are never caller input:
 *   - tasks: clientId is server-DERIVED from the linked compliance instance
 *     on every write (subject binding, SCH-13); status starts 'open' and
 *     moves ONLY through transitionTask (RLS-TSK-01, API-ARCH-04);
 *     waitingReason is stamped by the transition command when entering
 *     waiting and is never a routine edit;
 *   - checklist items: doneBy/doneAt are server-stamped on the false → true
 *     flip (unforgeable completion attribution, DM-14), preserved exactly on
 *     true → true edits, and cleared on uncheck;
 *   - comments: authorId is the authenticated session user, server-pinned
 *     (RLS-TCM-01); body is immutable after posting — retraction is the only
 *     permitted mutation and it is one-way (false → true);
 *   - dependencies: no direct row writes exist at all — the graph changes
 *     only through addTaskDependency / removeTaskDependency (RLS-TSK-02).
 */
import type { DataSource } from '@/data/source';

// --- Vocabularies (mirror the CHECK constraints / command edge set) ----------

/** DM-SM-05 eight-state task lifecycle (exactly the tasks_status_check set). */
export type TaskStatus =
  | 'open'
  | 'in_progress'
  | 'waiting'
  | 'submitted'
  | 'returned'
  | 'approved'
  | 'done'
  | 'cancelled';

// --- Records (read DTOs) ------------------------------------------------------

/** Task = one execution activity for one client, optionally instance-linked. */
export interface TaskRecord {
  id: string;
  firmId: string;
  /** The compliance SUBJECT. For instance-linked tasks this is derived from
   *  the linked instance by the database write guard — never trusted caller
   *  input (SCH-13 subject binding). */
  clientId: string;
  complianceInstanceId: string | null;
  title: string;
  description: string | null;
  nextAction: string;
  status: TaskStatus;
  /** Stamped when entering waiting; RETAINED as history after leaving it
   *  (documented transition_task choice — the audit trail keeps the
   *  blocker record). */
  waitingReason: string | null;
  dueDate: string | null;
  priority: string;
  assigneeMembershipId: string | null;
  reviewerMembershipId: string | null;
  timeSpentMinutes: number;
  createdAt: string;
  updatedAt: string | null;
}

/** TaskDependency = one directed edge: taskId depends on dependsOnTaskId. */
export interface TaskDependencyRecord {
  id: string;
  firmId: string;
  taskId: string;
  dependsOnTaskId: string;
  dependencyType: string;
  createdAt: string;
}

/** Checklist line within a task (DM-14). */
export interface TaskChecklistItemRecord {
  id: string;
  firmId: string;
  taskId: string;
  label: string;
  isDone: boolean;
  /** Completion actor IDENTITY (auth user id), trigger-stamped — never
   *  caller input (SCH-RESP-02, DM-14). */
  doneBy: string | null;
  doneAt: string | null;
  templateSource: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string | null;
}

/** Comment = one immutable discussion/review remark (DM-15). No updatedAt
 *  exists on this table by design (immutability, spec 06 conventions). */
export interface TaskCommentRecord {
  id: string;
  firmId: string;
  taskId: string;
  /** Author actor IDENTITY (auth user id), server-pinned to the session at
   *  insert time (RLS-TCM-01) — never caller input. */
  authorId: string;
  body: string;
  retracted: boolean;
  createdAt: string;
}

/** The composite task read model (API-R0-TSK): the task plus its checklist
 *  (sortOrder-ordered), its comments (createdAt-ordered), and every
 *  dependency edge touching it. Under RLS the edge list contains only edges
 *  whose BOTH endpoints are visible to the caller (RLS-TSK-02, API-ERR-02)
 *  — the adapter renders exactly what the database returns and never
 *  reconstructs hidden edges. */
export interface TaskDetail {
  task: TaskRecord;
  checklist: TaskChecklistItemRecord[];
  comments: TaskCommentRecord[];
  dependencies: TaskDependencyRecord[];
}

// --- Write inputs -------------------------------------------------------------

/**
 * Task creation (API-R0-TSK). Exactly two forms:
 *   - instance-linked: set complianceInstanceId — clientId is derived from
 *     the instance server-side and MUST NOT be supplied;
 *   - ad-hoc: set clientId (a same-firm client) and no complianceInstanceId.
 * status (forced default 'open') and waitingReason are never caller input.
 */
export interface CreateTaskInput {
  title: string;
  nextAction: string;
  description?: string | null;
  /** Ad-hoc form only — the subject client. Ignored when
   *  complianceInstanceId is set (linked subject binding is derived). */
  clientId?: string;
  /** Linked form — the compliance instance this task executes. */
  complianceInstanceId?: string;
  dueDate?: string | null;
  priority?: string;
  assigneeMembershipId?: string | null;
  reviewerMembershipId?: string | null;
  timeSpentMinutes?: number;
}

/**
 * The permitted NON-STATE task update set (RLS-TSK-01): exactly the
 * column-granted set — content fields, re-link via complianceInstanceId
 * (re-derives the subject), due date, priority, time spent, and the two
 * responsibility memberships (manager+ only, enforced by the write guard).
 * Status/waitingReason go through transitionTask only; clientId is
 * insert-time bound and not patchable.
 */
export interface UpdateTaskInput {
  title?: string;
  description?: string | null;
  nextAction?: string;
  complianceInstanceId?: string | null;
  dueDate?: string | null;
  priority?: string;
  timeSpentMinutes?: number;
  assigneeMembershipId?: string | null;
  reviewerMembershipId?: string | null;
}

/** Controlled transition invocation (API-R0-TSK, DM-SM-05). mutationKey
 *  enables idempotent replay: a repeat against a task already in
 *  targetStatus returns status 'already_applied' instead of a conflict
 *  (API-MUT-03). waitingReason is REQUIRED when entering waiting;
 *  reviewerComment is REQUIRED when entering returned (created atomically
 *  as an immutable SCH-16 comment authored by the caller). */
export interface TransitionTaskInput {
  targetStatus: TaskStatus;
  mutationKey?: string;
  waitingReason?: string;
  reviewerComment?: string;
}

/** Structured result of the transition command. 'already_applied' is a
 *  keyed replay surfacing the current row — NOT an error. */
export interface TransitionTaskResult {
  status: 'transitioned' | 'already_applied';
  task: TaskRecord;
  fromStatus?: TaskStatus;
  toStatus?: TaskStatus;
  /** Machine-readable replay reason (e.g. 'already_in_target_status'). */
  reason?: string;
  /** The atomic reviewer comment created by a submitted → returned
   *  transition (RLS-4EY-03). */
  reviewerComment?: TaskCommentRecord;
}

/** Dependency edge creation (RLS-TSK-02 — command-only). */
export interface AddTaskDependencyInput {
  dependsOnTaskId: string;
  /** Defaults to 'finish_to_start' server-side. */
  dependencyType?: string;
  mutationKey?: string;
}

/** Structured result of the add command: 'added' or a keyed-replay
 *  'already_applied' (reason 'edge_already_exists') carrying the existing
 *  edge — never an error. */
export interface AddTaskDependencyResult {
  status: 'added' | 'already_applied';
  dependency: TaskDependencyRecord;
  reason?: string;
}

/** Structured result of the remove command: 'removed' or a keyed-replay
 *  'already_applied' (reason 'edge_already_absent') — never an error. */
export interface RemoveTaskDependencyResult {
  status: 'removed' | 'already_applied';
  taskId: string;
  dependsOnTaskId: string;
  reason?: string;
}

// --- List filters (API-CONV-02 limit/offset pagination) ------------------------

export interface TaskListFilter {
  status?: TaskStatus;
  clientId?: string;
  complianceInstanceId?: string;
  assigneeMembershipId?: string;
  /** Due window: inclusive bounds on due_date. */
  dueFrom?: string;
  dueTo?: string;
  limit?: number;
  offset?: number;
}

// --- Service contract (API-R0-TSK) ---------------------------------------------

/**
 * The provider-neutral tasks contract. Two implementations (fixture demo
 * track / Supabase production) sit behind this interface; consumers import
 * `taskService` from `@/data` and never know which is active (API-ARCH-02).
 *
 * Error semantics (API-ERR-01/02/04):
 *   - collection reads return [] when nothing is visible — never an error
 *     (RLS silent omission);
 *   - getTaskDetail returns null for nonexistent AND inaccessible ids alike
 *     (no existence oracle);
 *   - writes/commands against unknown/inaccessible ids: the Layer-B
 *     commands return their uniform pre-authorization not_found denial;
 *     zero-row UPDATE/SELECT write surfaces (updateTask,
 *     toggleChecklistItem, retractTaskComment) throw ApiError('not_found')
 *     (PGRST116, API-ERR-02); INSERT-path denials where the parent is
 *     unknown/inaccessible (addTaskComment) throw ApiError('unauthorized')
 *     per API-ERR-03 — the production RLS write-denial mapping (42501);
 *   - transition-authority denials (four-eyes reviewer-only exits with no
 *     rank bypass, senior/article assignee-only rule — CA401) and
 *     role-scoped column protection (42501) throw ApiError('unauthorized');
 *   - rejected input — unknown target status (CA400), ad-hoc create without
 *     a client, four-eyes reviewer=assignee at write time — throws
 *     ApiError('validation');
 *   - legality/immutability/identity violations — illegal DM-SM-05 edges,
 *     entering waiting without a reason / returned without a comment
 *     (CA402), self/duplicate/cyclic dependency edges, non-ACTIVE or
 *     unknown responsibility memberships (23503), insert-only field
 *     movement (IMMUTABLE_FIELD:/INVALID_TRANSITION: 23514) — throw
 *     ApiError('conflict');
 *   - there is NO task delete anywhere, NO comment edit or delete, and NO
 *     way to set status, waitingReason, doneBy/doneAt, or comment
 *     authorship outside the controlled paths.
 */
export interface TaskService {
  readonly mode: DataSource;

  listTasks(filter?: TaskListFilter): Promise<TaskRecord[]>;

  /** The composite task read model; null for unknown/inaccessible ids
   *  (API-ERR-02). */
  getTaskDetail(taskId: string): Promise<TaskDetail | null>;

  createTask(input: CreateTaskInput): Promise<TaskRecord>;
  updateTask(taskId: string, patch: UpdateTaskInput): Promise<TaskRecord>;

  /**
   * Controlled Layer-B transition command — the ONLY status-change path
   * (RLS-TSK-01, API-ARCH-04). DM-SM-05 legality is the fixed 15-edge set
   * (open → in_progress → submitted → approved → done; in_progress ↔
   * waiting via the blocker record; submitted → returned → in_progress
   * rework; done → open reopen; cancelled from any non-terminal state;
   * terminals final). Authorization FIRST (uniform not_found), then the
   * RLS-4EY-03 four-eyes overlay (submitted → approved/returned only by
   * the assigned reviewer — no rank bypass) and the senior/article
   * current-assignee-only rule. No AAL2 step-up (routine operational
   * update, RLS-AAL-02).
   */
  transitionTask(taskId: string, input: TransitionTaskInput): Promise<TransitionTaskResult>;

  /**
   * Controlled Layer-B graph commands — the ONLY dependency write paths
   * (RLS-TSK-02: no direct row mutation exists). add validates self-edge,
   * duplicate pair, and acyclicity (recursive, firm-scoped) atomically;
   * both are mutation-key idempotent.
   */
  addTaskDependency(
    taskId: string,
    input: AddTaskDependencyInput,
  ): Promise<AddTaskDependencyResult>;
  removeTaskDependency(
    taskId: string,
    dependsOnTaskId: string,
    mutationKey?: string,
  ): Promise<RemoveTaskDependencyResult>;

  /**
   * Checklist toggle (DM-14, API-MUT-02): sends ONLY the new is_done value
   * — the server stamps doneBy/doneAt on the false → true flip (stamped
   * over any supplied value), preserves the recorded attribution on
   * true → true, and clears both on uncheck.
   */
  toggleChecklistItem(itemId: string, isDone: boolean): Promise<TaskChecklistItemRecord>;

  /**
   * Comment append (RLS-TCM-01): authorId is filled from the authenticated
   * session server-side — never caller input. The row is immutable after
   * posting; the only later mutation is retractTaskComment.
   */
  addTaskComment(taskId: string, body: string): Promise<TaskCommentRecord>;

  /**
   * Retraction (DM-15): one-way retracted false → true, by the original
   * author only. Unknown OR non-author ids both throw
   * ApiError('not_found') (API-ERR-02 — the RLS zero-row surface).
   */
  retractTaskComment(commentId: string): Promise<TaskCommentRecord>;
}
