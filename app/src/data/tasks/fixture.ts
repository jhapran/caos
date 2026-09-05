/**
 * IMP-040 — Tasks, dependencies, checklists, comments: FIXTURE adapter
 * (demo track, MIG-DS-06).
 *
 * A deterministic in-memory mirror of the SCH-13…16 contract, composed on
 * the IMP-020/030/031 fixture singletons (one fixture truth — clients are
 * READ through fixtureClientHierarchy, compliance types through
 * fixtureComplianceRules, linked instances through
 * fixtureComplianceInstances; this file adds no second copy of any of
 * them). The seed rows reference the derived hierarchy/client ids and the
 * IMP-031 fixture instance ids. This module never touches the network and
 * never constructs the Supabase client.
 *
 * Fixture role model (documented limit): fixture mode has exactly ONE
 * caller persona — the IMP-014 tenancy demo identity
 * (`demo-fixture-membership`, role 'partner', user `demo-fixture-user`),
 * i.e. firm-wide manager+ scope in the single demo firm. The adapter
 * therefore enforces the contract's BUSINESS semantics — the DM-SM-05
 * 15-edge transition machine, waiting-requires-reason /
 * returned-requires-comment (with the atomic immutable reviewer comment),
 * subject binding (linked clientId derived from the instance), write-time
 * four-eyes reviewer≠assignee, the RLS-4EY-03 reviewer-only review exits
 * by membership identity with no rank bypass, dependency self/duplicate/
 * cycle rejection, mutation-key replay, and the DM-14 who/when stamping
 * convention — but does NOT simulate the RLS-TSK-01 role-scoping matrix
 * (manager portfolio / senior-article assigned-only scoping and the
 * senior/article reviewer-only transition lane have no second persona to
 * scope against). Membership references are validated against the known
 * fixture roster (TEAM ids + the demo membership, all ACTIVE —
 * SCH-RESP-03 parity, 23503 → conflict).
 *
 * Mutations are module-local and ephemeral (page reload resets them).
 */
import { fixtureClientHierarchy } from '@/data/clientHierarchy/fixture';
import { TEAM } from '@/data/clients';
import { fixtureComplianceInstances } from '@/data/complianceInstances/fixture';
import { fixtureComplianceRules } from '@/data/complianceRules/fixture';
import { ApiError } from '@/data/errors';

import type {
  AddTaskDependencyResult,
  RemoveTaskDependencyResult,
  TaskChecklistItemRecord,
  TaskCommentRecord,
  TaskDependencyRecord,
  TaskRecord,
  TaskService,
  TaskStatus,
  TransitionTaskResult,
} from './types';

const DEMO_FIRM_ID = 'demo-fixture-firm';
const SEED_CREATED_AT = '2026-08-20T00:00:00.000Z';

/** The single fixture caller persona (IMP-014 tenancy fixture identity).
 *  role is typed against the SCH-03 staff vocabulary so the four-eyes
 *  checks below are genuine comparisons, not constants. */
const FIXTURE_CALLER: {
  membershipId: string;
  userId: string;
  role: 'super_admin' | 'partner' | 'manager' | 'senior' | 'article_executive';
} = {
  membershipId: 'demo-fixture-membership',
  userId: 'demo-fixture-user',
  role: 'partner',
};

/** Known fixture memberships (the demo roster + the demo persona), all
 *  ACTIVE — fixture mode models no suspended/removed staff. */
const FIXTURE_MEMBERSHIPS = new Set<string>([
  FIXTURE_CALLER.membershipId,
  ...TEAM.map((m) => m.id),
]);

/** DM-SM-05 vocabulary (exactly the tasks_status_check set). */
const STATUSES: readonly TaskStatus[] = [
  'open',
  'in_progress',
  'waiting',
  'submitted',
  'returned',
  'approved',
  'done',
  'cancelled',
];

/** The DM-SM-05 15-edge legality set (transition_task header derivation):
 *  main chain, the waiting blocker pair, the rework pair, the reopen edge,
 *  and cancellation from any non-terminal state. */
const EDGES: ReadonlySet<string> = new Set([
  'open->in_progress',
  'in_progress->waiting',
  'in_progress->submitted',
  'waiting->in_progress',
  'submitted->approved',
  'submitted->returned',
  'returned->in_progress',
  'approved->done',
  'done->open',
  'open->cancelled',
  'in_progress->cancelled',
  'waiting->cancelled',
  'submitted->cancelled',
  'returned->cancelled',
  'approved->cancelled',
]);

interface FixtureStore {
  tasks: TaskRecord[];
  dependencies: TaskDependencyRecord[];
  checklist: TaskChecklistItemRecord[];
  comments: TaskCommentRecord[];
  sequence: number;
}

let store: FixtureStore | null = null;

function buildStore(): FixtureStore {
  // Deterministic seed set composed on the IMP-031 fixture instances:
  // one linked in-progress GSTR-1 filing task, one linked four-eyes TDS
  // task parked at submitted (the partner caller cannot approve it — the
  // assigned reviewer must, RLS-4EY-03), one ad-hoc client task. Plus
  // seeded checklist lines, two comments, and one dependency edge.
  const tasks: TaskRecord[] = [
    {
      id: 'task-abc-gstr1-filing',
      firmId: DEMO_FIRM_ID,
      clientId: 'c-abc',
      complianceInstanceId: 'cin-abc-gstr1-2026-08',
      title: 'GSTR-1 August 2026 filing',
      description: 'Prepare and file the August 2026 GSTR-1 return.',
      nextAction: 'Reconcile sales register against GSTR-1 draft',
      status: 'in_progress',
      waitingReason: null,
      dueDate: '2026-09-10',
      priority: 'high',
      assigneeMembershipId: 'u-rahul',
      reviewerMembershipId: 'u-priya',
      timeSpentMinutes: 90,
      createdAt: SEED_CREATED_AT,
      updatedAt: null,
    },
    {
      // Four-eyes case: the linked instance's compliance type requires
      // four-eyes, so submitted -> approved/returned is reviewer-only —
      // the partner caller is denied with no rank bypass.
      id: 'task-xyz-tds24q-review',
      firmId: DEMO_FIRM_ID,
      clientId: 'c-xyz',
      complianceInstanceId: 'cin-xyz-tds24q-q1-fy26-27',
      title: 'TDS 24Q Q1 FY 2026-27 review',
      description: 'Quarterly TDS return preparation and review.',
      nextAction: 'Reviewer to verify challan mapping',
      status: 'submitted',
      waitingReason: null,
      dueDate: '2026-07-29',
      priority: 'normal',
      assigneeMembershipId: 'u-rahul',
      reviewerMembershipId: 'u-priya',
      timeSpentMinutes: 240,
      createdAt: SEED_CREATED_AT,
      updatedAt: null,
    },
    {
      id: 'task-abc-adhoc-onboarding',
      firmId: DEMO_FIRM_ID,
      clientId: 'c-abc',
      complianceInstanceId: null,
      title: 'Collect FY 2026-27 opening balances',
      description: null,
      nextAction: 'Request trial balance from client',
      status: 'open',
      waitingReason: null,
      dueDate: '2026-09-20',
      priority: 'normal',
      assigneeMembershipId: 'u-rahul',
      reviewerMembershipId: null,
      timeSpentMinutes: 0,
      createdAt: SEED_CREATED_AT,
      updatedAt: null,
    },
  ];

  const dependencies: TaskDependencyRecord[] = [
    {
      id: 'taskdep-onboarding-before-filing',
      firmId: DEMO_FIRM_ID,
      taskId: 'task-abc-gstr1-filing',
      dependsOnTaskId: 'task-abc-adhoc-onboarding',
      dependencyType: 'finish_to_start',
      createdAt: SEED_CREATED_AT,
    },
  ];

  const checklist: TaskChecklistItemRecord[] = [
    {
      id: 'taskchk-gstr1-sales',
      firmId: DEMO_FIRM_ID,
      taskId: 'task-abc-gstr1-filing',
      label: 'Sales register reconciled',
      isDone: true,
      doneBy: FIXTURE_CALLER.userId,
      doneAt: SEED_CREATED_AT,
      templateSource: null,
      sortOrder: 1,
      createdAt: SEED_CREATED_AT,
      updatedAt: null,
    },
    {
      id: 'taskchk-gstr1-itc',
      firmId: DEMO_FIRM_ID,
      taskId: 'task-abc-gstr1-filing',
      label: 'B2B invoices verified',
      isDone: false,
      doneBy: null,
      doneAt: null,
      templateSource: null,
      sortOrder: 2,
      createdAt: SEED_CREATED_AT,
      updatedAt: null,
    },
  ];

  const comments: TaskCommentRecord[] = [
    {
      id: 'taskcmt-tds24q-handover',
      firmId: DEMO_FIRM_ID,
      taskId: 'task-xyz-tds24q-review',
      authorId: FIXTURE_CALLER.userId,
      body: 'Prep complete — over to review.',
      retracted: false,
      createdAt: SEED_CREATED_AT,
    },
    {
      id: 'taskcmt-tds24q-reviewer-note',
      firmId: DEMO_FIRM_ID,
      taskId: 'task-xyz-tds24q-review',
      // Another author's comment: the fixture caller can never retract it
      // (author-only, RLS-TCM-01 — the not_found surface).
      authorId: 'user-priya',
      body: 'Challan mapping looks consistent with 26AS.',
      retracted: false,
      createdAt: SEED_CREATED_AT,
    },
  ];

  return { tasks, dependencies, checklist, comments, sequence: 0 };
}

function state(): FixtureStore {
  if (!store) store = buildStore();
  return store;
}

function nextId(label: string): string {
  const s = state();
  s.sequence += 1;
  return `fixture-${label}-${s.sequence}`;
}

const now = () => new Date().toISOString();

function notFound(label: string, id: string): ApiError {
  return new ApiError('not_found', `${label} ${id} not found`);
}

// --- Contract mirrors (fixture-side enforcement of the database rules) -------

const copyTask = (t: TaskRecord): TaskRecord => ({ ...t });
const copyDependency = (d: TaskDependencyRecord): TaskDependencyRecord => ({ ...d });
const copyChecklistItem = (i: TaskChecklistItemRecord): TaskChecklistItemRecord => ({ ...i });
const copyComment = (c: TaskCommentRecord): TaskCommentRecord => ({ ...c });

/** Assignment validity mirror (SCH-RESP-03 live-status layer +
 *  write-time RLS-4EY-03): responsibility memberships must be known ACTIVE
 *  fixture memberships (23503 parity → conflict); where the linked
 *  instance's compliance type requires four-eyes, reviewer ≠ assignee
 *  (23514 FOUR_EYES: parity → validation). */
async function assertAssignments(
  complianceInstanceId: string | null,
  assignee: string | null,
  reviewer: string | null,
): Promise<void> {
  for (const [label, id] of [
    ['assigneeMembershipId', assignee],
    ['reviewerMembershipId', reviewer],
  ] as const) {
    if (id !== null && !FIXTURE_MEMBERSHIPS.has(id)) {
      throw new ApiError(
        'conflict',
        `${label} must be an ACTIVE membership of the same firm (SCH-RESP-03)`,
      );
    }
  }
  if (complianceInstanceId !== null && assignee !== null && reviewer !== null && assignee === reviewer) {
    const instance = await fixtureComplianceInstances.getComplianceInstance(complianceInstanceId);
    const type = instance
      ? await fixtureComplianceRules.getComplianceType(instance.complianceTypeId)
      : null;
    if (type?.fourEyesRequired) {
      throw new ApiError(
        'validation',
        'four-eyes required: reviewerMembershipId must differ from assigneeMembershipId (RLS-4EY-03)',
      );
    }
  }
}

/** Four-eyes derivation mirror: true when the task is instance-linked and
 *  the instance's compliance type requires four-eyes. */
async function isFourEyes(task: TaskRecord): Promise<boolean> {
  if (task.complianceInstanceId === null) return false;
  const instance = await fixtureComplianceInstances.getComplianceInstance(
    task.complianceInstanceId,
  );
  if (!instance) return false;
  const type = await fixtureComplianceRules.getComplianceType(instance.complianceTypeId);
  return type?.fourEyesRequired ?? false;
}

/** Cycle mirror (add_task_dependency's recursive CTE): inserting
 *  (T depends_on D) closes a cycle iff T is reachable from D by following
 *  existing depends_on edges. */
function createsCycle(taskId: string, dependsOnTaskId: string): boolean {
  const edges = state().dependencies;
  const seen = new Set<string>();
  const queue = [dependsOnTaskId];
  while (queue.length > 0) {
    const current = queue.pop()!;
    if (current === taskId) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const edge of edges) {
      if (edge.taskId === current) queue.push(edge.dependsOnTaskId);
    }
  }
  return false;
}

export const fixtureTasks: TaskService = {
  mode: 'fixture',

  async listTasks(filter) {
    let rows = state().tasks;
    if (filter?.status) rows = rows.filter((t) => t.status === filter.status);
    if (filter?.clientId) rows = rows.filter((t) => t.clientId === filter.clientId);
    if (filter?.complianceInstanceId) {
      rows = rows.filter((t) => t.complianceInstanceId === filter.complianceInstanceId);
    }
    if (filter?.assigneeMembershipId) {
      rows = rows.filter((t) => t.assigneeMembershipId === filter.assigneeMembershipId);
    }
    if (filter?.dueFrom) rows = rows.filter((t) => t.dueDate !== null && t.dueDate >= filter.dueFrom!);
    if (filter?.dueTo) rows = rows.filter((t) => t.dueDate !== null && t.dueDate <= filter.dueTo!);
    // due_date ascending with NULLs last, then created_at (the Supabase
    // adapter's order clause).
    rows = [...rows].sort((a, b) => {
      if (a.dueDate === null && b.dueDate === null) return a.createdAt.localeCompare(b.createdAt);
      if (a.dueDate === null) return 1;
      if (b.dueDate === null) return -1;
      const cmp = a.dueDate.localeCompare(b.dueDate);
      return cmp !== 0 ? cmp : a.createdAt.localeCompare(b.createdAt);
    });
    const offset = filter?.offset ?? 0;
    const end = filter?.limit !== undefined ? offset + filter.limit : undefined;
    return rows.slice(offset, end).map(copyTask);
  },

  async getTaskDetail(taskId) {
    const task = state().tasks.find((t) => t.id === taskId);
    if (!task) return null; // unknown AND inaccessible alike (API-ERR-02)
    return {
      task: copyTask(task),
      checklist: state()
        .checklist.filter((i) => i.taskId === taskId)
        .sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt))
        .map(copyChecklistItem),
      comments: state()
        .comments.filter((c) => c.taskId === taskId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .map(copyComment),
      dependencies: state()
        .dependencies.filter((d) => d.taskId === taskId || d.dependsOnTaskId === taskId)
        .map(copyDependency),
    };
  },

  async createTask(input) {
    const linked = input.complianceInstanceId !== undefined && input.complianceInstanceId !== null;
    let clientId: string;
    if (linked) {
      // Subject binding: clientId is DERIVED from the linked instance —
      // any caller-supplied clientId is overwritten, never trusted
      // (SCH-13, tasks_guard_write parity).
      const instance = await fixtureComplianceInstances.getComplianceInstance(
        input.complianceInstanceId!,
      );
      if (!instance) {
        throw new ApiError('conflict', 'compliance_instance_id does not exist in this firm');
      }
      clientId = instance.clientId;
    } else {
      if (!input.clientId) {
        throw new ApiError(
          'validation',
          'an ad-hoc task requires clientId (SCH-13: every task belongs to a client)',
        );
      }
      const client = await fixtureClientHierarchy.getClient(input.clientId);
      if (!client) throw new ApiError('conflict', 'client_id does not exist in this firm');
      clientId = input.clientId;
    }
    await assertAssignments(
      linked ? input.complianceInstanceId! : null,
      input.assigneeMembershipId ?? null,
      input.reviewerMembershipId ?? null,
    );
    const record: TaskRecord = {
      id: nextId('task'),
      firmId: DEMO_FIRM_ID,
      clientId,
      complianceInstanceId: linked ? input.complianceInstanceId! : null,
      title: input.title,
      description: input.description ?? null,
      nextAction: input.nextAction,
      // status forced default 'open'; waitingReason transition-stamped only.
      status: 'open',
      waitingReason: null,
      dueDate: input.dueDate ?? null,
      priority: input.priority ?? 'normal',
      assigneeMembershipId: input.assigneeMembershipId ?? null,
      reviewerMembershipId: input.reviewerMembershipId ?? null,
      timeSpentMinutes: input.timeSpentMinutes ?? 0,
      createdAt: now(),
      updatedAt: null,
    };
    state().tasks.push(record);
    return copyTask(record);
  },

  async updateTask(taskId, patch) {
    const found = state().tasks.find((t) => t.id === taskId);
    if (!found) throw notFound('Task', taskId);
    // Runtime parity with the write guard: status/waiting_reason move only
    // through the transition command (the type already excludes them; JS
    // callers can still force them).
    if ((patch as { status?: string }).status !== undefined) {
      throw new ApiError(
        'conflict',
        'tasks.status changes only through transitionTask() (RLS-TSK-01, INVALID_TRANSITION:tasks.status)',
      );
    }
    if ((patch as { waitingReason?: string }).waitingReason !== undefined) {
      throw new ApiError(
        'conflict',
        'waitingReason is stamped by transitionTask() only (IMMUTABLE_FIELD:tasks.waiting_reason)',
      );
    }
    let complianceInstanceId = found.complianceInstanceId;
    if (patch.complianceInstanceId !== undefined) {
      complianceInstanceId = patch.complianceInstanceId;
      if (complianceInstanceId !== null) {
        // Re-link re-derives the subject (never trusted input).
        const instance = await fixtureComplianceInstances.getComplianceInstance(
          complianceInstanceId,
        );
        if (!instance) {
          throw new ApiError('conflict', 'compliance_instance_id does not exist in this firm');
        }
        found.clientId = instance.clientId;
      }
    }
    await assertAssignments(
      complianceInstanceId,
      patch.assigneeMembershipId !== undefined
        ? patch.assigneeMembershipId
        : found.assigneeMembershipId,
      patch.reviewerMembershipId !== undefined
        ? patch.reviewerMembershipId
        : found.reviewerMembershipId,
    );
    if (patch.title !== undefined) found.title = patch.title;
    if (patch.description !== undefined) found.description = patch.description;
    if (patch.nextAction !== undefined) found.nextAction = patch.nextAction;
    found.complianceInstanceId = complianceInstanceId;
    if (patch.dueDate !== undefined) found.dueDate = patch.dueDate;
    if (patch.priority !== undefined) found.priority = patch.priority;
    if (patch.timeSpentMinutes !== undefined) found.timeSpentMinutes = patch.timeSpentMinutes;
    if (patch.assigneeMembershipId !== undefined) found.assigneeMembershipId = patch.assigneeMembershipId;
    if (patch.reviewerMembershipId !== undefined) found.reviewerMembershipId = patch.reviewerMembershipId;
    found.updatedAt = now();
    return copyTask(found);
  },

  async transitionTask(taskId, input): Promise<TransitionTaskResult> {
    const found = state().tasks.find((t) => t.id === taskId);
    if (!found) throw notFound('Task', taskId);

    // CA400 parity: unknown target statuses are malformed input
    // (validation), never a legality conflict.
    if (!STATUSES.includes(input.targetStatus)) {
      throw new ApiError(
        'validation',
        `unknown target status '${input.targetStatus}' (DM-SM-05 vocabulary)`,
      );
    }

    // Idempotent replay (API-MUT-03): keyed repeat against the target status.
    if (found.status === input.targetStatus) {
      if (input.mutationKey) {
        return {
          status: 'already_applied',
          reason: 'already_in_target_status',
          task: copyTask(found),
        };
      }
      throw new ApiError('conflict', `task is already in status ${input.targetStatus}`);
    }

    // Legality (DM-SM-05 — the fixed 15-edge set).
    if (!EDGES.has(`${found.status}->${input.targetStatus}`)) {
      throw new ApiError(
        'conflict',
        `invalid status transition ${found.status} -> ${input.targetStatus} (DM-SM-05)`,
      );
    }

    // Authorization (RLS-TSK-01): the single fixture persona is a partner —
    // firm-wide scope, so role/scope authorization passes. Manager
    // portfolio and senior/article assigned-only scoping are NOT simulated
    // (documented fixture limit; see module header).
    //
    // Four-eyes overlay (RLS-4EY-03): where the linked type requires it,
    // submitted -> approved/returned is performed ONLY by the assigned
    // reviewer — no rank bypass; a NULL reviewer fail-closes the exit.
    const fourEyes = await isFourEyes(found);
    if (
      fourEyes &&
      found.status === 'submitted' &&
      (input.targetStatus === 'approved' || input.targetStatus === 'returned') &&
      (found.reviewerMembershipId === null ||
        FIXTURE_CALLER.membershipId !== found.reviewerMembershipId)
    ) {
      throw new ApiError(
        'unauthorized',
        'submitted -> approved/returned must be performed by the assigned reviewer (RLS-4EY-03)',
      );
    }

    // Mandatory fields (SCH-13): legality-class conflicts (CA402 parity).
    if (input.targetStatus === 'waiting' && !(input.waitingReason ?? '').trim()) {
      throw new ApiError(
        'conflict',
        'entering waiting requires a non-empty waitingReason (DM-SM-05, SCH-13)',
      );
    }
    if (input.targetStatus === 'returned' && !(input.reviewerComment ?? '').trim()) {
      throw new ApiError(
        'conflict',
        'submitted -> returned requires a non-empty reviewer comment (SCH-13, RLS-4EY-03)',
      );
    }

    const fromStatus = found.status;
    found.status = input.targetStatus;
    // Entering waiting stamps the reason; all other moves RETAIN any prior
    // reason as history (documented transition_task choice).
    if (input.targetStatus === 'waiting') found.waitingReason = input.waitingReason!.trim();
    found.updatedAt = now();

    let reviewerComment: TaskCommentRecord | undefined;
    if (input.targetStatus === 'returned') {
      // The atomic reviewer comment: an ordinary immutable SCH-16 row,
      // author server-stamped; rolls back with the transition on failure.
      reviewerComment = {
        id: nextId('task-comment'),
        firmId: DEMO_FIRM_ID,
        taskId: found.id,
        authorId: FIXTURE_CALLER.userId,
        body: input.reviewerComment!.trim(),
        retracted: false,
        createdAt: now(),
      };
      state().comments.push(reviewerComment);
    }

    return {
      status: 'transitioned',
      fromStatus,
      toStatus: input.targetStatus,
      task: copyTask(found),
      reviewerComment,
    };
  },

  async addTaskDependency(taskId, input): Promise<AddTaskDependencyResult> {
    // Safe resolution with the API-ERR-02 uniform not_found (either endpoint
    // unknown — identical body).
    const task = state().tasks.find((t) => t.id === taskId);
    const dep = state().tasks.find((t) => t.id === input.dependsOnTaskId);
    if (!task || !dep) throw notFound('Task', !task ? taskId : input.dependsOnTaskId);

    if (taskId === input.dependsOnTaskId) {
      throw new ApiError('conflict', 'a task cannot depend on itself (SCH-14)');
    }

    const existing = state().dependencies.find(
      (d) => d.taskId === taskId && d.dependsOnTaskId === input.dependsOnTaskId,
    );
    if (existing) {
      if (input.mutationKey) {
        return {
          status: 'already_applied',
          reason: 'edge_already_exists',
          dependency: copyDependency(existing),
        };
      }
      throw new ApiError('conflict', 'dependency edge already exists (SCH-14)');
    }

    if (createsCycle(taskId, input.dependsOnTaskId)) {
      throw new ApiError('conflict', 'dependency would create a cycle (SCH-14, DM-OQ-04)');
    }

    const edge: TaskDependencyRecord = {
      id: nextId('task-dependency'),
      firmId: DEMO_FIRM_ID,
      taskId,
      dependsOnTaskId: input.dependsOnTaskId,
      dependencyType: input.dependencyType?.trim() || 'finish_to_start',
      createdAt: now(),
    };
    state().dependencies.push(edge);
    return { status: 'added', dependency: copyDependency(edge) };
  },

  async removeTaskDependency(taskId, dependsOnTaskId, mutationKey): Promise<RemoveTaskDependencyResult> {
    const task = state().tasks.find((t) => t.id === taskId);
    const dep = state().tasks.find((t) => t.id === dependsOnTaskId);
    if (!task || !dep) throw notFound('Task', !task ? taskId : dependsOnTaskId);

    const index = state().dependencies.findIndex(
      (d) => d.taskId === taskId && d.dependsOnTaskId === dependsOnTaskId,
    );
    if (index === -1) {
      if (mutationKey) {
        return {
          status: 'already_applied',
          reason: 'edge_already_absent',
          taskId,
          dependsOnTaskId,
        };
      }
      throw new ApiError('conflict', 'dependency edge does not exist (SCH-14)');
    }
    state().dependencies.splice(index, 1);
    return { status: 'removed', taskId, dependsOnTaskId };
  },

  async toggleChecklistItem(itemId, isDone) {
    const found = state().checklist.find((i) => i.id === itemId);
    if (!found) throw notFound('Checklist item', itemId);
    // DM-14 who/when stamping convention (task_checklist_items_stamp_done
    // parity): the false -> true flip stamps the caller; true -> true
    // preserves the recorded attribution exactly; unchecking clears both.
    if (isDone && !found.isDone) {
      found.doneBy = FIXTURE_CALLER.userId;
      found.doneAt = now();
    } else if (!isDone) {
      found.doneBy = null;
      found.doneAt = null;
    }
    found.isDone = isDone;
    found.updatedAt = now();
    return copyChecklistItem(found);
  },

  async addTaskComment(taskId, body) {
    const task = state().tasks.find((t) => t.id === taskId);
    // API-ERR-03 parity: comment append against an unknown/inaccessible
    // parent task is a WRITE denial — the production INSERT policy's WITH
    // CHECK task-visibility failure surfaces 42501 → unauthorized (see the
    // Supabase adapter). The API-ERR-02 not_found uniformity applies to
    // reads and zero-row UPDATE surfaces, not to this INSERT-path denial.
    if (!task) {
      throw new ApiError(
        'unauthorized',
        'task not writable for this caller (API-ERR-03: insert-path write denial)',
      );
    }
    const record: TaskCommentRecord = {
      id: nextId('task-comment'),
      firmId: DEMO_FIRM_ID,
      taskId,
      // Author is the caller identity, server-pinned (RLS-TCM-01) — never
      // caller input.
      authorId: FIXTURE_CALLER.userId,
      body,
      retracted: false,
      createdAt: now(),
    };
    state().comments.push(record);
    return copyComment(record);
  },

  async retractTaskComment(commentId) {
    const found = state().comments.find((c) => c.id === commentId);
    // Unknown OR non-author ids share the identical not_found surface
    // (API-ERR-02 — the RLS zero-row mirror).
    if (!found || found.authorId !== FIXTURE_CALLER.userId) {
      throw notFound('Task comment', commentId);
    }
    // One-way false -> true; retracting an already-retracted own comment is
    // the permitted no-op (the guard sees no change).
    found.retracted = true;
    return copyComment(found);
  },
};
