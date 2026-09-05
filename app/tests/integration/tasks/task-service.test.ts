/**
 * IMP-040 — Tasks Supabase adapter contract against the real local stack
 * (TEST-API-01…03 for the tasks domain, API-R0-TSK).
 *
 * Drives the PUBLIC @/data contract (taskService) in supabase mode
 * (setup-env pins it) exactly as application code will: no PostgREST
 * shapes, no provider error types, no existence oracles. RLS and the
 * Layer-B commands stay the authorization/legality boundary — the adapter
 * asserts only contract behavior:
 *
 *   TEST-API-01 — collection reads return [] for invisible rows, never
 *     an error;
 *   TEST-API-02 — single-resource reads (getTaskDetail) return null for
 *     nonexistent AND inaccessible ids alike;
 *   TEST-API-03 — writes/commands to unknown/inaccessible ids surface
 *     ApiError('not_found'); illegal DM-SM-05 transitions and
 *     mandatory-field violations surface ApiError('conflict'); unknown
 *     target statuses surface ApiError('validation'); the RLS-4EY-03
 *     reviewer-only exit surfaces ApiError('unauthorized') for the partner
 *     and succeeds for the assigned reviewer; a missing active-firm
 *     selection surfaces ApiError('validation') BEFORE any request.
 *
 * Also pinned: the composite getTaskDetail read model, trigger-stamped
 * checklist attribution (done_by = the caller's auth user), session-pinned
 * comment authorship with the author-only retraction surface, dependency
 * command add/remove with keyed replays, and camelCase DTOs with no
 * provider keys.
 *
 * Fixture rows: deterministic ids in the 98000000-… range; teardown
 * removes rows child → parent, then fixture audit rows as the operator.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { clearActiveFirm, setActiveFirm } from '@/data/context';
import { taskService } from '@/data/tasks/taskService';
import { getSupabaseClient } from '@/lib/supabaseClient';

import { FIRM_A, FIRM_B, PASSWORD, psql, userEmail, userId } from '../helpers.mjs';

const M = {
  partnerA: '98000000-0000-4000-8000-000000000001',
  managerA: '98000000-0000-4000-8000-000000000002',
  seniorA: '98000000-0000-4000-8000-000000000003',
  articleA: '98000000-0000-4000-8000-000000000004',
  billingA: '98000000-0000-4000-8000-000000000005',
  partnerB: '98000000-0000-4000-8000-000000000006',
};

const C = {
  managed: '98000000-0000-4000-8000-000000000101',
  plain: '98000000-0000-4000-8000-000000000102',
  firmB: '98000000-0000-4000-8000-000000000111',
};
const E = { managed: '98000000-0000-4000-8000-000000000201' };
const CT = { fourEyes: '98000000-0000-4000-8000-000000000301' };
const CI = { fourEyes: '98000000-0000-4000-8000-000000000401' };
const T = {
  firmB: '98000000-0000-4000-8000-000000000501', // foreign-tenant task
};

const PARTNER_A = userId('USER_A_PARTNER');
const MANAGER_A = userId('USER_A_MANAGER');
const SENIOR_A = userId('USER_A_SENIOR');
const ARTICLE_A = userId('USER_A_ARTICLE');
const BILLING_A = userId('USER_A_BILLING');
const PARTNER_B = userId('USER_B_PARTNER');

const UNKNOWN_ID = '98000000-0000-4000-8000-00000000ffff';

async function signInAs(email: string) {
  const { error } = await getSupabaseClient().auth.signInWithPassword({
    email,
    password: PASSWORD,
  });
  expect(error).toBeNull();
}

function cleanRows() {
  psql(`
    delete from public.task_comments where firm_id in ('${FIRM_A}', '${FIRM_B}');
    delete from public.task_checklist_items where firm_id in ('${FIRM_A}', '${FIRM_B}');
    delete from public.task_dependencies where firm_id in ('${FIRM_A}', '${FIRM_B}');
    delete from public.tasks where firm_id in ('${FIRM_A}', '${FIRM_B}');
    delete from public.compliance_instances where firm_id in ('${FIRM_A}', '${FIRM_B}');
    delete from public.legal_entities where firm_id in ('${FIRM_A}', '${FIRM_B}');
    delete from public.clients where firm_id in ('${FIRM_A}', '${FIRM_B}');
    delete from public.compliance_types where firm_id in ('${FIRM_A}', '${FIRM_B}');
    delete from public.audit_log where firm_id in ('${FIRM_A}', '${FIRM_B}');
  `);
}

beforeAll(async () => {
  cleanRows();
  psql(`
    insert into public.firms (id, name) values
      ('${FIRM_A}', 'IMP-040 Adapter Firm A'),
      ('${FIRM_B}', 'IMP-040 Adapter Firm B')
    on conflict (id) do nothing;

    insert into public.firm_memberships (id, firm_id, user_id, role, status) values
      ('${M.partnerA}', '${FIRM_A}', '${PARTNER_A}', 'partner',            'active'),
      ('${M.managerA}', '${FIRM_A}', '${MANAGER_A}', 'manager',            'active'),
      ('${M.seniorA}',  '${FIRM_A}', '${SENIOR_A}',  'senior',             'active'),
      ('${M.articleA}', '${FIRM_A}', '${ARTICLE_A}', 'article_executive',  'active'),
      ('${M.billingA}', '${FIRM_A}', '${BILLING_A}', 'billing',            'active'),
      ('${M.partnerB}', '${FIRM_B}', '${PARTNER_B}', 'partner',            'active')
    on conflict (firm_id, user_id) do nothing;

    insert into public.clients (id, firm_id, name, owner_partner_membership_id, manager_membership_id, status) values
      ('${C.managed}', '${FIRM_A}', 'TSK Adapter Client Managed', '${M.partnerA}', '${M.managerA}', 'active'),
      ('${C.plain}',   '${FIRM_A}', 'TSK Adapter Client Plain',   '${M.partnerA}', null,            'active'),
      ('${C.firmB}',   '${FIRM_B}', 'TSK Adapter Client FirmB',   '${M.partnerB}', null,            'active');

    insert into public.legal_entities (id, firm_id, client_id, entity_type, legal_name) values
      ('${E.managed}', '${FIRM_A}', '${C.managed}', 'private_limited', 'TSK Managed Pvt Ltd');

    insert into public.compliance_types
      (id, firm_id, type_key, name, category, frequency, due_rule, workflow_template, four_eyes_required, governance_class)
    values
      ('${CT.fourEyes}', '${FIRM_A}', 'TSK_FOUR_EYES', 'TSK Four-Eyes Type', 'TSK', 'monthly',
       '{"rule":"monthly"}', '{"states":["preparation","internal_review"]}', true, 'non_statutory');

    insert into public.compliance_instances
      (id, firm_id, client_id, legal_entity_id, compliance_type_id,
       period_start, period_end, period_label, due_date,
       assignee_membership_id, reviewer_membership_id)
    values
      ('${CI.fourEyes}', '${FIRM_A}', '${C.managed}', '${E.managed}', '${CT.fourEyes}',
       '2026-08-01', '2026-08-31', 'Aug 2026', '2026-09-11',
       '${M.seniorA}', '${M.articleA}');

    insert into public.tasks (id, firm_id, client_id, title, next_action) values
      ('${T.firmB}', '${FIRM_B}', '${C.firmB}', 'FirmB task', 'foreign');
  `);
  psql(`delete from public.audit_log where firm_id in ('${FIRM_A}', '${FIRM_B}')`);
  await signInAs(userEmail('USER_A_PARTNER'));
  setActiveFirm(FIRM_A);
});

afterAll(async () => {
  clearActiveFirm();
  await getSupabaseClient().auth.signOut();
  cleanRows();
  psql(`
    delete from public.firm_memberships where firm_id in ('${FIRM_A}', '${FIRM_B}');
    delete from public.firms where id in ('${FIRM_A}', '${FIRM_B}');
  `);
});

describe('taskService — supabase adapter (TEST-API-01…03)', () => {
  it('serves the shared contract in supabase mode (API-ARCH-02)', () => {
    expect(taskService.mode).toBe('supabase');
  });

  it('create/list roundtrip as camelCase DTOs; foreign-tenant rows are absent (TEST-API-01)', async () => {
    const created = await taskService.createTask({
      title: 'Partner ad-hoc task',
      nextAction: 'start work',
      clientId: C.plain,
      dueDate: '2026-09-30',
      assigneeMembershipId: M.seniorA,
    });
    expect(created.firmId).toBe(FIRM_A);
    expect(created.status).toBe('open');
    expect(created.complianceInstanceId).toBeNull();
    expect(created).not.toHaveProperty('firm_id');

    const tasks = await taskService.listTasks();
    const ids = tasks.map((t) => t.id);
    expect(ids).toContain(created.id);
    expect(ids).not.toContain(T.firmB); // TEST-API-01: invisible == absent
  });

  it('linked create derives clientId from the instance; filters by instance/client/status', async () => {
    const linked = await taskService.createTask({
      title: 'Four-eyes review task',
      nextAction: 'prepare',
      complianceInstanceId: CI.fourEyes,
      clientId: C.plain, // never trusted — the guard derives the subject
      assigneeMembershipId: M.seniorA,
      reviewerMembershipId: M.articleA,
    });
    expect(linked.clientId).toBe(C.managed);
    expect(linked.complianceInstanceId).toBe(CI.fourEyes);

    const byInstance = await taskService.listTasks({ complianceInstanceId: CI.fourEyes });
    expect(byInstance.map((t) => t.id)).toEqual([linked.id]);
    const openOnly = await taskService.listTasks({ status: 'open' });
    expect(openOnly.every((t) => t.status === 'open')).toBe(true);
    const managedTasks = await taskService.listTasks({ clientId: C.managed });
    expect(managedTasks.map((t) => t.id)).toContain(linked.id);
  });

  it('TEST-API-02: unknown and foreign ids both return null — identical shape', async () => {
    const own = await taskService.createTask({
      title: 'Detail target',
      nextAction: 'x',
      clientId: C.plain,
    });
    expect((await taskService.getTaskDetail(own.id))!.task.id).toBe(own.id);
    expect(await taskService.getTaskDetail(UNKNOWN_ID)).toBeNull();
    expect(await taskService.getTaskDetail(T.firmB)).toBeNull();
  });

  it('getTaskDetail composes checklist (sort order), comments, and touching edges', async () => {
    const a = await taskService.createTask({
      title: 'Composite A',
      nextAction: 'x',
      clientId: C.plain,
    });
    const b = await taskService.createTask({
      title: 'Composite B',
      nextAction: 'x',
      clientId: C.plain,
    });
    // Checklist lines + one edge enter through operator SQL (no browser
    // insert surface exists for checklist lines in this package's adapter).
    psql(`
      insert into public.task_checklist_items (id, firm_id, task_id, label, sort_order) values
        ('98000000-0000-4000-8000-000000000601', '${FIRM_A}', '${a.id}', 'second line', 2),
        ('98000000-0000-4000-8000-000000000602', '${FIRM_A}', '${a.id}', 'first line', 1);
    `);
    await taskService.addTaskDependency(a.id, { dependsOnTaskId: b.id });

    const detail = await taskService.getTaskDetail(a.id);
    expect(detail).not.toBeNull();
    expect(detail!.checklist.map((i) => i.label)).toEqual(['first line', 'second line']);
    expect(detail!.dependencies).toHaveLength(1);
    expect(detail!.dependencies[0]).toMatchObject({
      taskId: a.id,
      dependsOnTaskId: b.id,
      dependencyType: 'finish_to_start',
    });
  });

  it('full DM-SM-05 lifecycle walk via the transition command, incl. waiting reason and reopen', async () => {
    const created = await taskService.createTask({
      title: 'Lifecycle',
      nextAction: 'x',
      clientId: C.plain,
      assigneeMembershipId: M.seniorA,
    });
    const t = created.id;

    expect(
      (await taskService.transitionTask(t, { targetStatus: 'in_progress' })).task.status,
    ).toBe('in_progress');

    // waiting without a reason is a legality conflict (CA402)…
    await expect(taskService.transitionTask(t, { targetStatus: 'waiting' })).rejects.toMatchObject(
      { name: 'ApiError', kind: 'conflict' },
    );
    // …and with one it stamps the reason.
    const waiting = await taskService.transitionTask(t, {
      targetStatus: 'waiting',
      waitingReason: 'Awaiting client documents',
    });
    expect(waiting.task.waitingReason).toBe('Awaiting client documents');

    // Leaving waiting retains the reason as history (documented choice).
    const resumed = await taskService.transitionTask(t, { targetStatus: 'in_progress' });
    expect(resumed.task.waitingReason).toBe('Awaiting client documents');

    await taskService.transitionTask(t, { targetStatus: 'submitted' });
    // Ad-hoc task: not four-eyes — the partner may approve.
    await taskService.transitionTask(t, { targetStatus: 'approved' });
    const done = await taskService.transitionTask(t, { targetStatus: 'done' });
    expect(done.status).toBe('transitioned');
    expect(done.fromStatus).toBe('approved');
    expect(done.toStatus).toBe('done');

    // done -> open reopen edge; cancelled is terminal.
    const reopened = await taskService.transitionTask(t, { targetStatus: 'open' });
    expect(reopened.task.status).toBe('open');
    await taskService.transitionTask(t, { targetStatus: 'cancelled' });
    await expect(
      taskService.transitionTask(t, { targetStatus: 'open' }),
    ).rejects.toMatchObject({ kind: 'conflict' });
  });

  it('unknown target status is validation; illegal edges conflict; keyed replay is already_applied', async () => {
    const created = await taskService.createTask({
      title: 'Edge cases',
      nextAction: 'x',
      clientId: C.plain,
    });
    await expect(
      taskService.transitionTask(created.id, { targetStatus: 'flying' as never }),
    ).rejects.toMatchObject({ kind: 'validation' }); // CA400
    await expect(
      taskService.transitionTask(created.id, { targetStatus: 'approved' }),
    ).rejects.toMatchObject({ kind: 'conflict' }); // not a DM-SM-05 edge

    await taskService.transitionTask(created.id, {
      targetStatus: 'in_progress',
      mutationKey: 'mk-int-1',
    });
    const replay = await taskService.transitionTask(created.id, {
      targetStatus: 'in_progress',
      mutationKey: 'mk-int-1',
    });
    expect(replay.status).toBe('already_applied');
    expect(replay.reason).toBe('already_in_target_status');
    // Keyless same-state is an ordinary conflict.
    await expect(
      taskService.transitionTask(created.id, { targetStatus: 'in_progress' }),
    ).rejects.toMatchObject({ kind: 'conflict' });
  });

  it('submitted -> returned creates the atomic reviewer comment (RLS-4EY-03)', async () => {
    const created = await taskService.createTask({
      title: 'Rework lane',
      nextAction: 'x',
      clientId: C.plain,
      assigneeMembershipId: M.seniorA,
    });
    await taskService.transitionTask(created.id, { targetStatus: 'in_progress' });
    await taskService.transitionTask(created.id, { targetStatus: 'submitted' });
    await expect(
      taskService.transitionTask(created.id, { targetStatus: 'returned' }),
    ).rejects.toMatchObject({ kind: 'conflict' }); // comment mandatory
    const returned = await taskService.transitionTask(created.id, {
      targetStatus: 'returned',
      reviewerComment: 'Attach the signed reconciliation.',
    });
    expect(returned.status).toBe('transitioned');
    expect(returned.reviewerComment?.authorId).toBe(PARTNER_A);
    expect(returned.reviewerComment?.body).toBe('Attach the signed reconciliation.');
    const detail = await taskService.getTaskDetail(created.id);
    expect(detail!.comments.map((c) => c.id)).toContain(returned.reviewerComment!.id);
  });

  it('RLS-4EY-03: the partner cannot approve the four-eyes task; the assigned reviewer can', async () => {
    const linked = (await taskService.listTasks({ complianceInstanceId: CI.fourEyes }))[0];
    expect(linked).toBeDefined();
    // Walk it to submitted as the partner (ordinary transitions are in
    // firm-wide partner scope; the four-eyes overlay binds only the
    // submitted -> approved/returned exits).
    await taskService.transitionTask(linked.id, { targetStatus: 'in_progress' });
    await taskService.transitionTask(linked.id, { targetStatus: 'submitted' });

    // No rank bypass: partner approve is CA401 -> unauthorized.
    await expect(
      taskService.transitionTask(linked.id, { targetStatus: 'approved' }),
    ).rejects.toMatchObject({ kind: 'unauthorized' });
    expect((await taskService.getTaskDetail(linked.id))!.task.status).toBe('submitted');

    // The assigned reviewer (article membership) performs the exit.
    await signInAs(userEmail('USER_A_ARTICLE'));
    try {
      const approved = await taskService.transitionTask(linked.id, { targetStatus: 'approved' });
      expect(approved.status).toBe('transitioned');
      expect(approved.task.status).toBe('approved');
    } finally {
      await signInAs(userEmail('USER_A_PARTNER'));
    }
  });

  it('TEST-API-03: writes/commands to unknown and foreign ids share the not_found surface', async () => {
    await expect(
      taskService.updateTask(UNKNOWN_ID, { title: 'x' }),
    ).rejects.toMatchObject({ name: 'ApiError', kind: 'not_found' });
    await expect(
      taskService.updateTask(T.firmB, { title: 'x' }),
    ).rejects.toMatchObject({ kind: 'not_found' });
    await expect(
      taskService.transitionTask(UNKNOWN_ID, { targetStatus: 'cancelled' }),
    ).rejects.toMatchObject({ kind: 'not_found' });
    await expect(
      taskService.transitionTask(T.firmB, { targetStatus: 'cancelled' }),
    ).rejects.toMatchObject({ kind: 'not_found' });
  });

  it('update patches only non-state fields; re-link re-derives the subject', async () => {
    const created = await taskService.createTask({
      title: 'Patch target',
      nextAction: 'x',
      clientId: C.plain,
    });
    const patched = await taskService.updateTask(created.id, {
      title: 'Patched',
      dueDate: '2026-12-01',
      timeSpentMinutes: 45,
      assigneeMembershipId: M.seniorA,
    });
    expect(patched.title).toBe('Patched');
    expect(patched.timeSpentMinutes).toBe(45);
    expect(patched.updatedAt).not.toBeNull();

    const relinked = await taskService.updateTask(created.id, {
      complianceInstanceId: CI.fourEyes,
    });
    expect(relinked.clientId).toBe(C.managed); // subject re-derived
    expect(relinked.complianceInstanceId).toBe(CI.fourEyes);
  });

  it('dependency commands: add, keyed replays, cycle/self rejection, remove (RLS-TSK-02)', async () => {
    const a = await taskService.createTask({ title: 'dep A', nextAction: 'x', clientId: C.plain });
    const b = await taskService.createTask({ title: 'dep B', nextAction: 'x', clientId: C.plain });

    const added = await taskService.addTaskDependency(a.id, { dependsOnTaskId: b.id });
    expect(added.status).toBe('added');
    expect(added.dependency.dependencyType).toBe('finish_to_start');

    await expect(
      taskService.addTaskDependency(a.id, { dependsOnTaskId: b.id }),
    ).rejects.toMatchObject({ kind: 'conflict' });
    const replay = await taskService.addTaskDependency(a.id, {
      dependsOnTaskId: b.id,
      mutationKey: 'mk-dep-1',
    });
    expect(replay.status).toBe('already_applied');
    expect(replay.reason).toBe('edge_already_exists');

    await expect(
      taskService.addTaskDependency(a.id, { dependsOnTaskId: a.id }),
    ).rejects.toMatchObject({ kind: 'conflict' });
    await expect(
      taskService.addTaskDependency(b.id, { dependsOnTaskId: a.id }),
    ).rejects.toMatchObject({ kind: 'conflict' }); // cycle

    // Foreign/unknown endpoints: uniform not_found (no existence oracle).
    await expect(
      taskService.addTaskDependency(a.id, { dependsOnTaskId: T.firmB }),
    ).rejects.toMatchObject({ kind: 'not_found' });

    const removed = await taskService.removeTaskDependency(a.id, b.id);
    expect(removed.status).toBe('removed');
    const absent = await taskService.removeTaskDependency(a.id, b.id, 'mk-dep-2');
    expect(absent.status).toBe('already_applied');
    expect(absent.reason).toBe('edge_already_absent');
    await expect(taskService.removeTaskDependency(a.id, b.id)).rejects.toMatchObject({
      kind: 'conflict',
    });
  });

  it('checklist toggle stamps the caller identity; uncheck clears (DM-14)', async () => {
    const task = await taskService.createTask({
      title: 'Checklist target',
      nextAction: 'x',
      clientId: C.plain,
    });
    psql(`
      insert into public.task_checklist_items (id, firm_id, task_id, label, sort_order) values
        ('98000000-0000-4000-8000-000000000603', '${FIRM_A}', '${task.id}', 'toggle me', 1);
    `);
    const itemId = '98000000-0000-4000-8000-000000000603';

    const done = await taskService.toggleChecklistItem(itemId, true);
    expect(done.isDone).toBe(true);
    expect(done.doneBy).toBe(PARTNER_A); // trigger-stamped auth.uid()
    expect(done.doneAt).not.toBeNull();

    const cleared = await taskService.toggleChecklistItem(itemId, false);
    expect(cleared.isDone).toBe(false);
    expect(cleared.doneBy).toBeNull();
    expect(cleared.doneAt).toBeNull();

    await expect(taskService.toggleChecklistItem(UNKNOWN_ID, true)).rejects.toMatchObject({
      kind: 'not_found',
    });
  });

  it('comments: session-pinned authorship; retraction is author-only (not_found otherwise)', async () => {
    const task = await taskService.createTask({
      title: 'Comment target',
      nextAction: 'x',
      clientId: C.managed,
    });
    const comment = await taskService.addTaskComment(task.id, 'Kickoff note.');
    expect(comment.authorId).toBe(PARTNER_A);
    expect(comment.retracted).toBe(false);

    // Another staff member — even one who can SEE the task — cannot
    // retract it: the author-only update policy yields the API-ERR-02
    // zero-row surface.
    await signInAs(userEmail('USER_A_MANAGER'));
    try {
      const detail = await taskService.getTaskDetail(task.id);
      expect(detail!.comments.map((c) => c.id)).toContain(comment.id);
      await expect(taskService.retractTaskComment(comment.id)).rejects.toMatchObject({
        kind: 'not_found',
      });
    } finally {
      await signInAs(userEmail('USER_A_PARTNER'));
    }

    const retracted = await taskService.retractTaskComment(comment.id);
    expect(retracted.retracted).toBe(true);
    await expect(taskService.retractTaskComment(UNKNOWN_ID)).rejects.toMatchObject({
      kind: 'not_found',
    });

    // API-ERR-03: comment append against an unknown OR invisible parent is
    // an INSERT-path write denial — 42501 → unauthorized, NOT the not_found
    // zero-row surface (that's the UPDATE path above; do not conflate).
    await expect(taskService.addTaskComment(UNKNOWN_ID, 'x')).rejects.toMatchObject({
      name: 'ApiError',
      kind: 'unauthorized',
    });
    await expect(taskService.addTaskComment(T.firmB, 'x')).rejects.toMatchObject({
      kind: 'unauthorized',
    });
  });

  it('billing sees no tasks at all (RLS-TSK-01 read scope)', async () => {
    await signInAs(userEmail('USER_A_BILLING'));
    try {
      expect(await taskService.listTasks()).toEqual([]);
      const someTask = (await taskService.listTasks()).length; // stays zero
      expect(someTask).toBe(0);
    } finally {
      await signInAs(userEmail('USER_A_PARTNER'));
    }
  });

  it('writes without an active-firm selection fail fast with validation (RLS-CTX-01)', async () => {
    clearActiveFirm();
    try {
      await expect(
        taskService.createTask({ title: 'x', nextAction: 'x', clientId: C.plain }),
      ).rejects.toMatchObject({ kind: 'validation' });
    } finally {
      setActiveFirm(FIRM_A);
    }
  });
});
