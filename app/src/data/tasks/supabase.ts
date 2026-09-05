/**
 * IMP-040 — Tasks, dependencies, checklists, comments: SUPABASE adapter
 * (production).
 *
 * Plain PostgREST reads/writes under RLS (API-ARCH-03) for the row-shaped
 * operations; the ONLY RPCs are the three controlled Layer-B commands
 * (transition_task, add_task_dependency, remove_task_dependency —
 * API-R0-TSK, RLS-TSK-01/02, API-ARCH-04). Authorization is decided by the
 * database on every statement (DEC-J, RLS-MECH-01); the active-firm header
 * (injected by the browser client from @/data/context) is selector context
 * only.
 *
 * The adapter never sends server-controlled columns:
 *   - tasks: no status (forced default 'open' — transition-command-only),
 *     no waiting_reason (transition-stamped), and NO client_id on the
 *     instance-linked form (the write guard derives the subject from the
 *     linked instance — a caller-supplied value would be overwritten, so
 *     none is sent);
 *   - checklist toggles: ONLY is_done — done_by/done_at are
 *     trigger-stamped (flip stamps the caller over any supplied value;
 *     true → true preserves; uncheck clears — DM-14);
 *   - comments: author_id is filled from the authenticated session
 *     (auth.getUser()), never from caller input — the INSERT policy pins it
 *     to auth.uid() (RLS-TCM-01) and the column carries no default;
 *   - dependencies: no table writes AT ALL (no grant exists) — the graph
 *     changes only through the two commands.
 *
 * The Layer-B commands return structured results: deliberate denials arrive
 * as { status: 'denied', kind, message } (already audited server-side,
 * AUD-FAIL-01) and are mapped onto the API-ERR-01 taxonomy here — CA401 →
 * unauthorized, CA402 → conflict, CA400 → validation, pre-authorization →
 * the uniform not_found. A keyed replay arrives as
 * { status: 'already_applied', … } and is returned as a DTO, never an
 * error.
 *
 * Errors are translated once through toApiError() — no Supabase SDK or
 * PostgREST types cross this boundary (API-ARCH-01/02, API-ERR-01).
 */
import { getActiveFirm } from '@/data/context';
import { ApiError, toApiError, type ApiErrorKind } from '@/data/errors';
import { getSupabaseClient } from '@/lib/supabaseClient';

import type {
  TaskChecklistItemRecord,
  TaskCommentRecord,
  TaskDependencyRecord,
  TaskRecord,
  TaskService,
  TaskStatus,
} from './types';

// --- Row shapes (snake_case, exactly the SCH-13…16 columns) -------------------

interface TaskRow {
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

interface TaskDependencyRow {
  id: string;
  firm_id: string;
  task_id: string;
  depends_on_task_id: string;
  dependency_type: string;
  created_at: string;
}

interface TaskChecklistItemRow {
  id: string;
  firm_id: string;
  task_id: string;
  label: string;
  is_done: boolean;
  done_by: string | null;
  done_at: string | null;
  template_source: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string | null;
}

interface TaskCommentRow {
  id: string;
  firm_id: string;
  task_id: string;
  author_id: string;
  body: string;
  retracted: boolean;
  created_at: string;
}

// --- Column projections and mappers -------------------------------------------

const TASK_COLUMNS =
  'id, firm_id, client_id, compliance_instance_id, title, description, next_action, ' +
  'status, waiting_reason, due_date, priority, assignee_membership_id, ' +
  'reviewer_membership_id, time_spent_minutes, created_at, updated_at';

const DEPENDENCY_COLUMNS =
  'id, firm_id, task_id, depends_on_task_id, dependency_type, created_at';

const CHECKLIST_COLUMNS =
  'id, firm_id, task_id, label, is_done, done_by, done_at, template_source, ' +
  'sort_order, created_at, updated_at';

const COMMENT_COLUMNS = 'id, firm_id, task_id, author_id, body, retracted, created_at';

const toTask = (r: TaskRow): TaskRecord => ({
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

const toDependency = (r: TaskDependencyRow): TaskDependencyRecord => ({
  id: r.id,
  firmId: r.firm_id,
  taskId: r.task_id,
  dependsOnTaskId: r.depends_on_task_id,
  dependencyType: r.dependency_type,
  createdAt: r.created_at,
});

const toChecklistItem = (r: TaskChecklistItemRow): TaskChecklistItemRecord => ({
  id: r.id,
  firmId: r.firm_id,
  taskId: r.task_id,
  label: r.label,
  isDone: r.is_done,
  doneBy: r.done_by,
  doneAt: r.done_at,
  templateSource: r.template_source,
  sortOrder: r.sort_order,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const toComment = (r: TaskCommentRow): TaskCommentRecord => ({
  id: r.id,
  firmId: r.firm_id,
  taskId: r.task_id,
  authorId: r.author_id,
  body: r.body,
  retracted: r.retracted,
  createdAt: r.created_at,
});

// --- Write helpers --------------------------------------------------------------

/**
 * Tenant key for inserts (API-CONV-05): the caller never supplies an
 * authoritative firm_id — the value is the validated active-firm selector
 * context, and the database re-validates it against live membership on
 * every statement (RLS-CTX-02). Fail fast when no firm is selected.
 */
function requireActiveFirm(): string {
  const firmId = getActiveFirm();
  if (!firmId) {
    throw new ApiError(
      'validation',
      'No active firm selected — select a firm workspace before writing (RLS-CTX-01)',
    );
  }
  return firmId;
}

/** Drop undefined keys so patches only touch supplied columns. */
function compact<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/** The authenticated session user — the only legitimate comment author
 *  (RLS-TCM-01: the INSERT policy pins author_id = auth.uid(), and the
 *  column carries no default, so the adapter must supply it). */
async function requireSessionUserId(): Promise<string> {
  const { data, error } = await getSupabaseClient().auth.getUser();
  if (error) throw toApiError(error);
  if (!data.user) {
    throw new ApiError('unauthenticated', 'an authenticated session is required (RLS-TCM-01)');
  }
  return data.user.id;
}

/** Structured result of the transition command (API-R0-TSK). */
interface TransitionTaskRpcResult {
  status: 'transitioned' | 'already_applied' | 'denied';
  kind?: ApiErrorKind;
  message?: string;
  from_status?: TaskStatus;
  to_status?: TaskStatus;
  reason?: string;
  task?: TaskRow;
  reviewer_comment?: TaskCommentRow;
}

/** Structured result of the dependency add command (RLS-TSK-02). */
interface AddDependencyRpcResult {
  status: 'added' | 'already_applied' | 'denied';
  kind?: ApiErrorKind;
  message?: string;
  reason?: string;
  dependency?: TaskDependencyRow;
}

/** Structured result of the dependency remove command (RLS-TSK-02). */
interface RemoveDependencyRpcResult {
  status: 'removed' | 'already_applied' | 'denied';
  kind?: ApiErrorKind;
  message?: string;
  reason?: string;
  task_id?: string;
  depends_on_task_id?: string;
}

/** Map a Layer-B structured denial onto the API-ERR-01 taxonomy. */
function denialError(result: { kind?: ApiErrorKind; message?: string }): ApiError {
  return new ApiError(result.kind ?? 'internal', result.message ?? 'command denied');
}

export const supabaseTasks: TaskService = {
  mode: 'supabase',

  async listTasks(filter) {
    let query = getSupabaseClient()
      .from('tasks')
      .select(TASK_COLUMNS)
      .order('due_date', { nullsFirst: false })
      .order('created_at');
    if (filter?.status) query = query.eq('status', filter.status);
    if (filter?.clientId) query = query.eq('client_id', filter.clientId);
    if (filter?.complianceInstanceId) {
      query = query.eq('compliance_instance_id', filter.complianceInstanceId);
    }
    if (filter?.assigneeMembershipId) {
      query = query.eq('assignee_membership_id', filter.assigneeMembershipId);
    }
    if (filter?.dueFrom) query = query.gte('due_date', filter.dueFrom);
    if (filter?.dueTo) query = query.lte('due_date', filter.dueTo);
    if (filter?.limit !== undefined || filter?.offset !== undefined) {
      const from = filter?.offset ?? 0;
      const to = from + (filter?.limit ?? 50) - 1;
      query = query.range(from, to);
    }
    const { data, error } = await query;
    if (error) throw toApiError(error);
    return ((data ?? []) as unknown as TaskRow[]).map(toTask);
  },

  async getTaskDetail(taskId) {
    const client = getSupabaseClient();
    const { data: task, error: taskError } = await client
      .from('tasks')
      .select(TASK_COLUMNS)
      .eq('id', taskId)
      .maybeSingle();
    if (taskError) throw toApiError(taskError);
    if (!task) return null; // unknown AND inaccessible alike (API-ERR-02)

    // Composite read (API-R0-TSK): several plain RLS reads — NO aggregate
    // SECURITY DEFINER RPC, so the composition can never widen table RLS.
    // The dependency list is exactly what the BOTH-endpoints policy returns
    // (RLS-TSK-02); hidden-endpoint edges are absent, never reconstructed.
    const [checklistRes, commentsRes, dependenciesRes] = await Promise.all([
      client
        .from('task_checklist_items')
        .select(CHECKLIST_COLUMNS)
        .eq('task_id', taskId)
        .order('sort_order')
        .order('created_at'),
      client
        .from('task_comments')
        .select(COMMENT_COLUMNS)
        .eq('task_id', taskId)
        .order('created_at'),
      client
        .from('task_dependencies')
        .select(DEPENDENCY_COLUMNS)
        .or(`task_id.eq.${taskId},depends_on_task_id.eq.${taskId}`)
        .order('created_at'),
    ]);
    if (checklistRes.error) throw toApiError(checklistRes.error);
    if (commentsRes.error) throw toApiError(commentsRes.error);
    if (dependenciesRes.error) throw toApiError(dependenciesRes.error);

    return {
      task: toTask(task as unknown as TaskRow),
      checklist: ((checklistRes.data ?? []) as unknown as TaskChecklistItemRow[]).map(
        toChecklistItem,
      ),
      comments: ((commentsRes.data ?? []) as unknown as TaskCommentRow[]).map(toComment),
      dependencies: ((dependenciesRes.data ?? []) as unknown as TaskDependencyRow[]).map(
        toDependency,
      ),
    };
  },

  async createTask(input) {
    const firmId = requireActiveFirm();
    // SCH-13: a task always belongs to a client — either derived from the
    // linked instance (client_id deliberately NOT sent: the write guard
    // derives it and would overwrite any supplied value) or supplied for
    // the ad-hoc form.
    const linked = input.complianceInstanceId !== undefined && input.complianceInstanceId !== null;
    if (!linked && !input.clientId) {
      throw new ApiError(
        'validation',
        'an ad-hoc task requires clientId (SCH-13: every task belongs to a client)',
      );
    }
    const { data, error } = await getSupabaseClient()
      .from('tasks')
      .insert({
        firm_id: firmId,
        ...(linked
          ? { compliance_instance_id: input.complianceInstanceId }
          : { client_id: input.clientId }),
        title: input.title,
        description: input.description ?? null,
        next_action: input.nextAction,
        due_date: input.dueDate ?? null,
        priority: input.priority ?? 'normal',
        assignee_membership_id: input.assigneeMembershipId ?? null,
        reviewer_membership_id: input.reviewerMembershipId ?? null,
        time_spent_minutes: input.timeSpentMinutes ?? 0,
        // Never sent: status (default 'open', transition-only), waiting_reason
        // (transition-stamped).
      })
      .select(TASK_COLUMNS)
      .single();
    // Unknown client/instance/membership reference or non-ACTIVE membership
    // → 23503 → conflict; write-time four-eyes reviewer=assignee →
    // FOUR_EYES: 23514 → validation; senior/article assignment attempt →
    // 42501 → unauthorized; out-of-scope creation → RLS 42501.
    if (error) throw toApiError(error);
    return toTask(data as unknown as TaskRow);
  },

  async updateTask(taskId, patch) {
    const { data, error } = await getSupabaseClient()
      .from('tasks')
      .update(
        compact({
          title: patch.title,
          description: patch.description,
          next_action: patch.nextAction,
          compliance_instance_id: patch.complianceInstanceId,
          due_date: patch.dueDate,
          priority: patch.priority,
          time_spent_minutes: patch.timeSpentMinutes,
          assignee_membership_id: patch.assigneeMembershipId,
          reviewer_membership_id: patch.reviewerMembershipId,
          // Never sent: client_id (insert-time subject binding), status +
          // waiting_reason (transition-command-owned — no column grant).
        }),
      )
      .eq('id', taskId)
      .select(TASK_COLUMNS)
      .single();
    // 0 rows (unknown OR inaccessible) → PGRST116 → not_found (API-ERR-02);
    // identity movement → IMMUTABLE_FIELD: 23514 → conflict; non-ACTIVE
    // membership reference → 23503 → conflict; write-time four-eyes →
    // FOUR_EYES: → validation; senior/article reassignment → 42501 →
    // unauthorized.
    if (error) throw toApiError(error);
    return toTask(data as unknown as TaskRow);
  },

  async transitionTask(taskId, input) {
    const { data, error } = await getSupabaseClient().rpc('transition_task', {
      p_task_id: taskId,
      p_target_status: input.targetStatus,
      p_mutation_key: input.mutationKey ?? null,
      p_waiting_reason: input.waitingReason ?? null,
      p_reviewer_comment: input.reviewerComment ?? null,
    });
    if (error) throw toApiError(error);
    const result = data as unknown as TransitionTaskRpcResult;
    if (result.status === 'denied') throw denialError(result);
    if (!result.task) {
      throw new ApiError('internal', 'transition returned no task row');
    }
    return {
      status: result.status,
      task: toTask(result.task),
      fromStatus: result.from_status,
      toStatus: result.to_status,
      reason: result.reason,
      reviewerComment: result.reviewer_comment
        ? toComment(result.reviewer_comment)
        : undefined,
    };
  },

  async addTaskDependency(taskId, input) {
    const { data, error } = await getSupabaseClient().rpc('add_task_dependency', {
      p_task_id: taskId,
      p_depends_on_task_id: input.dependsOnTaskId,
      p_dependency_type: input.dependencyType ?? null,
      p_mutation_key: input.mutationKey ?? null,
    });
    if (error) throw toApiError(error);
    const result = data as unknown as AddDependencyRpcResult;
    if (result.status === 'denied') throw denialError(result);
    if (!result.dependency) {
      throw new ApiError('internal', 'dependency add returned no edge row');
    }
    return {
      status: result.status,
      dependency: toDependency(result.dependency),
      reason: result.reason,
    };
  },

  async removeTaskDependency(taskId, dependsOnTaskId, mutationKey) {
    const { data, error } = await getSupabaseClient().rpc('remove_task_dependency', {
      p_task_id: taskId,
      p_depends_on_task_id: dependsOnTaskId,
      p_mutation_key: mutationKey ?? null,
    });
    if (error) throw toApiError(error);
    const result = data as unknown as RemoveDependencyRpcResult;
    if (result.status === 'denied') throw denialError(result);
    return {
      status: result.status,
      taskId: result.task_id ?? taskId,
      dependsOnTaskId: result.depends_on_task_id ?? dependsOnTaskId,
      reason: result.reason,
    };
  },

  async toggleChecklistItem(itemId, isDone) {
    const { data, error } = await getSupabaseClient()
      .from('task_checklist_items')
      // ONLY is_done: done_by/done_at are trigger-stamped (DM-14 — the flip
      // stamps the caller over any supplied value; true → true preserves the
      // recorded attribution; uncheck clears both).
      .update({ is_done: isDone })
      .eq('id', itemId)
      .select(CHECKLIST_COLUMNS)
      .single();
    // 0 rows (unknown OR parent task inaccessible) → PGRST116 → not_found.
    if (error) throw toApiError(error);
    return toChecklistItem(data as unknown as TaskChecklistItemRow);
  },

  async addTaskComment(taskId, body) {
    const authorId = await requireSessionUserId();
    const { data, error } = await getSupabaseClient()
      .from('task_comments')
      .insert({
        firm_id: requireActiveFirm(),
        task_id: taskId,
        author_id: authorId,
        body,
        // retracted forced default false; id/created_at server-managed.
      })
      .select(COMMENT_COLUMNS)
      .single();
    // Parent task invisible/nonexistent → RLS 42501 (the INSERT policy's
    // task EXISTS fails) — surfaced as unauthorized by the taxonomy; the
    // read paths keep the API-ERR-02 not_found uniform.
    if (error) throw toApiError(error);
    return toComment(data as unknown as TaskCommentRow);
  },

  async retractTaskComment(commentId) {
    const { data, error } = await getSupabaseClient()
      .from('task_comments')
      // ONLY retracted: the one-way false → true mutation is the sole
      // permitted update (SCH-16 guard); author-only via RLS-TCM-01.
      .update({ retracted: true })
      .eq('id', commentId)
      .select(COMMENT_COLUMNS)
      .single();
    // 0 rows — unknown, inaccessible, OR not the caller's own comment —
    // all share the identical not_found surface (API-ERR-02).
    if (error) throw toApiError(error);
    return toComment(data as unknown as TaskCommentRow);
  },
};
