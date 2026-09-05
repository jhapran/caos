/**
 * IMP-040 — Supabase adapter write-payload shape test (production path,
 * network mocked).
 *
 * Pins the adapter to the exact granted write surface of the IMP-040 PASS-B
 * matrix: it mocks the browser client boundary (@/lib/supabaseClient),
 * captures the exact insert/update payloads and rpc invocations, and
 * asserts the adapter never sends server-controlled columns and always
 * routes state/graph changes through the Layer-B commands:
 *
 *   - tasks INSERT: no status (forced default 'open'), no waiting_reason
 *     (transition-stamped), and NO client_id on the instance-linked form
 *     (subject binding is guard-derived, SCH-13);
 *   - tasks UPDATE: only the nine granted non-state columns — never
 *     status/waiting_reason/client_id;
 *   - transition_task / add_task_dependency / remove_task_dependency: rpc
 *     with the exact parameter names; structured denials map onto the
 *     API-ERR-01 taxonomy; already_applied is a DTO, never an error;
 *   - checklist toggle sends ONLY is_done (done_by/done_at are
 *     trigger-stamped, DM-14);
 *   - comment insert carries the SESSION user as author_id (RLS-TCM-01 —
 *     the column has no default and the INSERT policy pins auth.uid());
 *   - comment retraction sends ONLY { retracted: true } (SCH-16 guard).
 *
 * The supabase adapter is imported DIRECTLY here (not via the
 * DATA_SOURCE-pinned selector) — a test-only reach into the implementation
 * module to verify the production write contract without a backend.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearActiveFirm, setActiveFirm } from '@/data/context';

const SESSION_USER_ID = '00000000-0000-4000-8000-00000000abcd';

const TASK_ROW = {
  id: 'task-1',
  firm_id: 'firm-1',
  client_id: 'client-1',
  compliance_instance_id: null,
  title: 't',
  description: null,
  next_action: 'n',
  status: 'open',
  waiting_reason: null,
  due_date: null,
  priority: 'normal',
  assignee_membership_id: null,
  reviewer_membership_id: null,
  time_spent_minutes: 0,
  created_at: '2026-09-01T00:00:00.000Z',
  updated_at: null,
};

const CHECKLIST_ROW = {
  id: 'chk-1',
  firm_id: 'firm-1',
  task_id: 'task-1',
  label: 'line',
  is_done: true,
  done_by: SESSION_USER_ID,
  done_at: '2026-09-01T00:00:00.000Z',
  template_source: null,
  sort_order: 1,
  created_at: '2026-09-01T00:00:00.000Z',
  updated_at: null,
};

const COMMENT_ROW = {
  id: 'cmt-1',
  firm_id: 'firm-1',
  task_id: 'task-1',
  author_id: SESSION_USER_ID,
  body: 'hello',
  retracted: false,
  created_at: '2026-09-01T00:00:00.000Z',
};

const DEPENDENCY_ROW = {
  id: 'dep-1',
  firm_id: 'firm-1',
  task_id: 'task-1',
  depends_on_task_id: 'task-2',
  dependency_type: 'finish_to_start',
  created_at: '2026-09-01T00:00:00.000Z',
};

interface CapturedTable {
  table: string;
  insertPayload?: Record<string, unknown>;
  updatePayload?: Record<string, unknown>;
}
interface CapturedRpc {
  name: string;
  params: Record<string, unknown>;
}

const tableCalls: CapturedTable[] = [];
const rpcCalls: CapturedRpc[] = [];
let rpcResults: Record<string, unknown> = {};
let sessionUser: { id: string } | null = { id: SESSION_USER_ID };

/** Injected per-table provider errors (PostgREST shape), returned by the
 *  next single/maybeSingle/collection resolution for that table. */
let tableErrors: Record<string, { code: string; message: string; status: number }> = {};

const ROWS: Record<string, unknown> = {
  tasks: TASK_ROW,
  task_checklist_items: CHECKLIST_ROW,
  task_comments: COMMENT_ROW,
  task_dependencies: DEPENDENCY_ROW,
};

vi.mock('@/lib/supabaseClient', () => ({
  getSupabaseClient: () => ({
    auth: {
      getUser: async () => ({ data: { user: sessionUser }, error: null }),
    },
    from: (table: string) => {
      const entry: CapturedTable = { table };
      tableCalls.push(entry);
      // A thenable builder: chainable query verbs, await resolves to a
      // collection read, single/maybeSingle resolve to one row.
      const builder: Record<string, unknown> = {
        select: () => builder,
        insert: (payload: Record<string, unknown>) => {
          entry.insertPayload = payload;
          return builder;
        },
        update: (payload: Record<string, unknown>) => {
          entry.updatePayload = payload;
          return builder;
        },
        eq: () => builder,
        or: () => builder,
        order: () => builder,
        gte: () => builder,
        lte: () => builder,
        range: () => builder,
        single: async () =>
          tableErrors[table]
            ? { data: null, error: tableErrors[table] }
            : { data: ROWS[table], error: null },
        maybeSingle: async () =>
          tableErrors[table]
            ? { data: null, error: tableErrors[table] }
            : { data: ROWS[table], error: null },
        then: (resolve: (v: unknown) => void) =>
          resolve(
            tableErrors[table]
              ? { data: null, error: tableErrors[table] }
              : { data: [ROWS[table]], error: null },
          ),
      };
      return builder;
    },
    rpc: async (name: string, params: Record<string, unknown>) => {
      rpcCalls.push({ name, params });
      return { data: rpcResults[name] ?? null, error: null };
    },
  }),
}));

import { supabaseTasks } from '@/data/tasks/supabase';

/** Columns no browser caller may write on tasks (server-managed or
 *  transition-command-owned — RLS-TSK-01). */
const FORBIDDEN_TASK_WRITE_KEYS = [
  'id',
  'status',
  'waiting_reason',
  'created_at',
  'updated_at',
];

describe('supabase tasks adapter — write payload shapes', () => {
  beforeEach(() => {
    tableCalls.length = 0;
    rpcCalls.length = 0;
    rpcResults = {};
    tableErrors = {};
    sessionUser = { id: SESSION_USER_ID };
    setActiveFirm('firm-1');
  });

  afterEach(() => {
    clearActiveFirm();
  });

  it('linked create: sends compliance_instance_id, never client_id, never status/waiting_reason', async () => {
    const created = await supabaseTasks.createTask({
      title: 'Linked',
      nextAction: 'go',
      complianceInstanceId: 'cin-1',
      assigneeMembershipId: 'm-1',
      reviewerMembershipId: 'm-2',
    });
    expect(created.id).toBe('task-1');
    const payload = tableCalls.find((c) => c.table === 'tasks')?.insertPayload;
    expect(payload).toBeDefined();
    const keys = Object.keys(payload!);
    expect(keys).toContain('compliance_instance_id');
    expect(keys).not.toContain('client_id');
    for (const forbidden of FORBIDDEN_TASK_WRITE_KEYS) {
      expect(keys).not.toContain(forbidden);
    }
    // Exactly the linked-form granted surface.
    expect(keys.sort()).toEqual(
      [
        'firm_id',
        'compliance_instance_id',
        'title',
        'description',
        'next_action',
        'due_date',
        'priority',
        'assignee_membership_id',
        'reviewer_membership_id',
        'time_spent_minutes',
      ].sort(),
    );
  });

  it('ad-hoc create: sends client_id, never compliance_instance_id; missing both fails client-side', async () => {
    await supabaseTasks.createTask({ title: 'Ad-hoc', nextAction: 'go', clientId: 'client-1' });
    const payload = tableCalls.find((c) => c.table === 'tasks')?.insertPayload;
    const keys = Object.keys(payload!);
    expect(keys).toContain('client_id');
    expect(keys).not.toContain('compliance_instance_id');
    for (const forbidden of FORBIDDEN_TASK_WRITE_KEYS) {
      expect(keys).not.toContain(forbidden);
    }

    tableCalls.length = 0;
    await expect(
      supabaseTasks.createTask({ title: 'x', nextAction: 'x' }),
    ).rejects.toMatchObject({ name: 'ApiError', kind: 'validation' });
    expect(tableCalls).toHaveLength(0); // rejected before any request
  });

  it('create without an active firm fails fast with validation before any request', async () => {
    clearActiveFirm();
    await expect(
      supabaseTasks.createTask({ title: 'x', nextAction: 'x', clientId: 'client-1' }),
    ).rejects.toMatchObject({ kind: 'validation' });
    expect(tableCalls).toHaveLength(0);
  });

  it('update: only the granted non-state columns, compacted — never status/waiting_reason/client_id', async () => {
    await supabaseTasks.updateTask('task-1', {
      title: 'new',
      dueDate: '2026-10-01',
      assigneeMembershipId: 'm-9',
    });
    const payload = tableCalls.find((c) => c.table === 'tasks')?.updatePayload;
    expect(payload).toEqual({
      title: 'new',
      due_date: '2026-10-01',
      assignee_membership_id: 'm-9',
    });
    const keys = Object.keys(payload!);
    for (const forbidden of [...FORBIDDEN_TASK_WRITE_KEYS, 'client_id', 'firm_id']) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it('transition goes through transition_task with the exact parameter contract', async () => {
    rpcResults['transition_task'] = {
      status: 'transitioned',
      from_status: 'in_progress',
      to_status: 'waiting',
      task: { ...TASK_ROW, status: 'waiting', waiting_reason: 'blocked on client' },
    };
    const result = await supabaseTasks.transitionTask('task-1', {
      targetStatus: 'waiting',
      waitingReason: 'blocked on client',
      mutationKey: 'mk-1',
    });
    expect(result.status).toBe('transitioned');
    expect(result.task.status).toBe('waiting');
    expect(rpcCalls).toEqual([
      {
        name: 'transition_task',
        params: {
          p_task_id: 'task-1',
          p_target_status: 'waiting',
          p_mutation_key: 'mk-1',
          p_waiting_reason: 'blocked on client',
          p_reviewer_comment: null,
        },
      },
    ]);
    // No direct table write took part.
    expect(tableCalls).toHaveLength(0);
  });

  it('structured denials map onto the API-ERR-01 taxonomy; already_applied is a DTO', async () => {
    rpcResults['transition_task'] = {
      status: 'denied',
      kind: 'unauthorized',
      message: 'reviewer only',
    };
    await expect(
      supabaseTasks.transitionTask('task-1', { targetStatus: 'approved' }),
    ).rejects.toMatchObject({ name: 'ApiError', kind: 'unauthorized' });

    rpcResults['transition_task'] = {
      status: 'denied',
      kind: 'not_found',
      message: 'task not found',
    };
    await expect(
      supabaseTasks.transitionTask('nope', { targetStatus: 'approved' }),
    ).rejects.toMatchObject({ kind: 'not_found' });

    rpcResults['transition_task'] = {
      status: 'already_applied',
      reason: 'already_in_target_status',
      task: { ...TASK_ROW, status: 'done' },
    };
    const replay = await supabaseTasks.transitionTask('task-1', {
      targetStatus: 'done',
      mutationKey: 'mk-2',
    });
    expect(replay.status).toBe('already_applied');
    expect(replay.reason).toBe('already_in_target_status');
    expect(replay.task.status).toBe('done');
  });

  it('returned-transition reviewer comments are mapped onto the result DTO', async () => {
    rpcResults['transition_task'] = {
      status: 'transitioned',
      from_status: 'submitted',
      to_status: 'returned',
      task: { ...TASK_ROW, status: 'returned' },
      reviewer_comment: { ...COMMENT_ROW, body: 'attach the reco' },
    };
    const result = await supabaseTasks.transitionTask('task-1', {
      targetStatus: 'returned',
      reviewerComment: 'attach the reco',
    });
    expect(result.reviewerComment?.body).toBe('attach the reco');
    expect(result.reviewerComment?.authorId).toBe(SESSION_USER_ID);
  });

  it('dependency graph changes go through the two commands with exact params', async () => {
    rpcResults['add_task_dependency'] = { status: 'added', dependency: DEPENDENCY_ROW };
    const added = await supabaseTasks.addTaskDependency('task-1', {
      dependsOnTaskId: 'task-2',
      mutationKey: 'mk-3',
    });
    expect(added.status).toBe('added');
    expect(added.dependency.dependsOnTaskId).toBe('task-2');
    expect(rpcCalls[0]).toEqual({
      name: 'add_task_dependency',
      params: {
        p_task_id: 'task-1',
        p_depends_on_task_id: 'task-2',
        p_dependency_type: null,
        p_mutation_key: 'mk-3',
      },
    });

    rpcResults['remove_task_dependency'] = {
      status: 'already_applied',
      reason: 'edge_already_absent',
      task_id: 'task-1',
      depends_on_task_id: 'task-2',
    };
    const removed = await supabaseTasks.removeTaskDependency('task-1', 'task-2', 'mk-4');
    expect(removed.status).toBe('already_applied');
    expect(removed.reason).toBe('edge_already_absent');
    expect(rpcCalls[1]).toEqual({
      name: 'remove_task_dependency',
      params: {
        p_task_id: 'task-1',
        p_depends_on_task_id: 'task-2',
        p_mutation_key: 'mk-4',
      },
    });
    expect(tableCalls.find((c) => c.table === 'task_dependencies')).toBeUndefined();
  });

  it('checklist toggle sends ONLY is_done — attribution is trigger-stamped', async () => {
    const toggled = await supabaseTasks.toggleChecklistItem('chk-1', true);
    expect(toggled.isDone).toBe(true);
    const payload = tableCalls.find((c) => c.table === 'task_checklist_items')?.updatePayload;
    expect(payload).toEqual({ is_done: true });
  });

  it('comment insert carries the SESSION author and only the granted columns', async () => {
    const added = await supabaseTasks.addTaskComment('task-1', 'hello');
    expect(added.authorId).toBe(SESSION_USER_ID);
    const payload = tableCalls.find((c) => c.table === 'task_comments')?.insertPayload;
    expect(payload).toEqual({
      firm_id: 'firm-1',
      task_id: 'task-1',
      author_id: SESSION_USER_ID,
      body: 'hello',
    });
  });

  it('comment insert without a session fails unauthenticated before any request', async () => {
    sessionUser = null;
    await expect(supabaseTasks.addTaskComment('task-1', 'hello')).rejects.toMatchObject({
      name: 'ApiError',
      kind: 'unauthenticated',
    });
    expect(tableCalls.find((c) => c.table === 'task_comments')).toBeUndefined();
  });

  it('comment insert against an unknown/invisible parent: the 42501 write denial maps to unauthorized (API-ERR-03)', async () => {
    // The INSERT policy's WITH CHECK task-visibility failure surfaces as
    // PostgREST 403 / SQLSTATE 42501 — an RLS WRITE denial, which the
    // taxonomy maps to unauthorized (never the not_found zero-row surface).
    tableErrors['task_comments'] = {
      code: '42501',
      message: 'new row violates row-level security policy for table "task_comments"',
      status: 403,
    };
    await expect(supabaseTasks.addTaskComment('nope', 'x')).rejects.toMatchObject({
      name: 'ApiError',
      kind: 'unauthorized',
    });
  });

  it('retraction sends ONLY { retracted: true }', async () => {
    rpcResults = {};
    await supabaseTasks.retractTaskComment('cmt-1');
    const payload = tableCalls.find((c) => c.table === 'task_comments')?.updatePayload;
    expect(payload).toEqual({ retracted: true });
  });
});
