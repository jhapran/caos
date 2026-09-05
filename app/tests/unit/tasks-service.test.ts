/**
 * IMP-040 — Fixture tasks adapter contract test (demo track).
 *
 * Runs under the unit harness, which pins DATA_SOURCE=fixture
 * (tests/setup.ts), so taskService resolves to the fixture implementation.
 * Verifies the deterministic seed set and the fixture mirror of the
 * production contract (API-R0-TSK): subject binding (linked clientId
 * derived from the instance), the DM-SM-05 15-edge transition machine with
 * its mandatory-field rules, the RLS-4EY-03 four-eyes reviewer-only exit
 * (no rank bypass), mutation-key replay, dependency self/duplicate/cycle
 * rejection with keyed replays, the DM-14 who/when stamping convention,
 * and the SCH-16 author-only retraction surface.
 *
 * Adapter parity note (MIG-VAL-03): the unit harness exercises the fixture
 * adapter only — the Supabase adapter shares the identical service
 * interface (compile-time) and its runtime parity is covered by
 * tests/integration/tasks, not here.
 *
 * Fixture role-model limit: fixture mode has ONE caller persona
 * (partner, firm-wide) — RLS-TSK-01 role-scoping (manager portfolio,
 * senior/article assigned-only) is not simulated; lifecycle/scope/
 * four-eyes semantics ARE enforced.
 *
 * NOTE: the fixture store is module-local and shared across the tests in
 * this file; each scenario either uses its own freshly created rows or is
 * sequenced so earlier mutations cannot poison later assertions.
 */
import { describe, expect, it } from 'vitest';

import type { ApiError } from '@/data/errors';
// NOTE: '@/data/tasks' is the LEGACY flat fixture module (file-first
// resolution) — the IMP-040 service is imported via its explicit selector
// path (same as the barrel's './tasks/index' wiring).
import { taskService as svc } from '@/data/tasks/taskService';

const apiError = (kind: string) =>
  expect.objectContaining({ kind }) as unknown as ApiError;

const SEED_LINKED = 'task-abc-gstr1-filing';
const SEED_FOUR_EYES = 'task-xyz-tds24q-review';
const SEED_ADHOC = 'task-abc-adhoc-onboarding';

describe('fixture tasks adapter — seed & reads', () => {
  it('resolves to fixture mode under the unit harness and is barrel-reachable', async () => {
    expect(svc.mode).toBe('fixture');
    const { taskService } = await import('@/data');
    expect(taskService).toBe(svc);
  });

  it('serves the deterministic seed: two instance-linked tasks + one ad-hoc', async () => {
    const tasks = await svc.listTasks();
    expect(tasks.map((t) => t.id).sort()).toEqual(
      [SEED_LINKED, SEED_FOUR_EYES, SEED_ADHOC].sort(),
    );
    const linked = tasks.find((t) => t.id === SEED_LINKED)!;
    expect(linked).toMatchObject({
      firmId: 'demo-fixture-firm',
      clientId: 'c-abc',
      complianceInstanceId: 'cin-abc-gstr1-2026-08',
      status: 'in_progress',
      assigneeMembershipId: 'u-rahul',
      reviewerMembershipId: 'u-priya',
    });
    const adhoc = tasks.find((t) => t.id === SEED_ADHOC)!;
    expect(adhoc.complianceInstanceId).toBeNull();
    expect(adhoc.status).toBe('open');
    // DTOs are camelCase domain shapes — no provider keys.
    expect(linked).not.toHaveProperty('firm_id');
  });

  it('getTaskDetail composes task + ordered checklist + comments + touching edges', async () => {
    const detail = await svc.getTaskDetail(SEED_LINKED);
    expect(detail).not.toBeNull();
    expect(detail!.task.id).toBe(SEED_LINKED);
    expect(detail!.checklist.map((i) => i.id)).toEqual([
      'taskchk-gstr1-sales',
      'taskchk-gstr1-itc',
    ]);
    expect(detail!.comments).toEqual([]);
    // The seeded edge touches the task (filing depends_on onboarding).
    expect(detail!.dependencies.map((d) => d.id)).toEqual([
      'taskdep-onboarding-before-filing',
    ]);

    const fourEyesDetail = await svc.getTaskDetail(SEED_FOUR_EYES);
    expect(fourEyesDetail!.comments.map((c) => c.id)).toEqual([
      'taskcmt-tds24q-handover',
      'taskcmt-tds24q-reviewer-note',
    ]);
    // Unknown ids return null — no existence oracle (API-ERR-02).
    expect(await svc.getTaskDetail('nope')).toBeNull();
  });

  it('listTasks filters: status, client, instance, assignee, due window, pagination', async () => {
    expect((await svc.listTasks({ status: 'submitted' })).map((t) => t.id)).toEqual([
      SEED_FOUR_EYES,
    ]);
    const abc = await svc.listTasks({ clientId: 'c-abc' });
    expect(abc).toHaveLength(2);
    expect(abc.every((t) => t.clientId === 'c-abc')).toBe(true);
    expect(
      (await svc.listTasks({ complianceInstanceId: 'cin-xyz-tds24q-q1-fy26-27' })).map(
        (t) => t.id,
      ),
    ).toEqual([SEED_FOUR_EYES]);
    const rahul = await svc.listTasks({ assigneeMembershipId: 'u-rahul' });
    expect(rahul).toHaveLength(3);

    const dueWindow = await svc.listTasks({ dueFrom: '2026-09-01', dueTo: '2026-09-30' });
    expect(dueWindow.map((t) => t.id).sort()).toEqual([SEED_LINKED, SEED_ADHOC].sort());

    // Due-date ordering (earliest first).
    const all = await svc.listTasks();
    const dues = all.map((t) => t.dueDate);
    expect(dues).toEqual(['2026-07-29', '2026-09-10', '2026-09-20']);

    const page = await svc.listTasks({ limit: 1, offset: 1 });
    expect(page).toHaveLength(1);
    expect(page[0].id).toBe(SEED_LINKED);
  });
});

describe('fixture tasks adapter — create (API-R0-TSK)', () => {
  it('linked create derives clientId from the instance and ignores any supplied clientId', async () => {
    const created = await svc.createTask({
      title: 'Linked follow-up',
      nextAction: 'Start prep',
      complianceInstanceId: 'cin-abc-gstr1-2026-08',
      clientId: 'c-xyz', // never trusted — overwritten by subject binding
      assigneeMembershipId: 'u-rahul',
      reviewerMembershipId: 'u-priya',
    });
    expect(created.clientId).toBe('c-abc');
    expect(created.complianceInstanceId).toBe('cin-abc-gstr1-2026-08');
    expect(created.status).toBe('open');
    expect(created.waitingReason).toBeNull();
  });

  it('linked create rejects an unknown instance (conflict) and four-eyes reviewer=assignee (validation)', async () => {
    await expect(
      svc.createTask({
        title: 'x',
        nextAction: 'x',
        complianceInstanceId: 'nope',
      }),
    ).rejects.toEqual(apiError('conflict'));
    // Every fixture-catalogue type requires four-eyes: linked create with
    // reviewer === assignee is the write-time RLS-4EY-03 violation.
    await expect(
      svc.createTask({
        title: 'x',
        nextAction: 'x',
        complianceInstanceId: 'cin-abc-gstr1-2026-08',
        assigneeMembershipId: 'u-rahul',
        reviewerMembershipId: 'u-rahul',
      }),
    ).rejects.toEqual(apiError('validation'));
  });

  it('ad-hoc create requires a client and validates it; memberships must be known ACTIVE', async () => {
    await expect(
      svc.createTask({ title: 'x', nextAction: 'x' }),
    ).rejects.toEqual(apiError('validation'));
    await expect(
      svc.createTask({ title: 'x', nextAction: 'x', clientId: 'nope' }),
    ).rejects.toEqual(apiError('conflict'));
    await expect(
      svc.createTask({
        title: 'x',
        nextAction: 'x',
        clientId: 'c-abc',
        assigneeMembershipId: 'not-a-member',
      }),
    ).rejects.toEqual(apiError('conflict'));

    const created = await svc.createTask({
      title: 'Ad-hoc ok',
      nextAction: 'Do it',
      clientId: 'c-abc',
      dueDate: '2026-10-01',
      priority: 'low',
      timeSpentMinutes: 15,
    });
    expect(created.status).toBe('open');
    expect(created.complianceInstanceId).toBeNull();
    expect(created.priority).toBe('low');
    expect(created.timeSpentMinutes).toBe(15);
  });
});

describe('fixture tasks adapter — update (non-state fields only)', () => {
  it('patches content/assignment fields; re-link re-derives the subject', async () => {
    const created = await svc.createTask({
      title: 'Patch me',
      nextAction: 'x',
      clientId: 'c-abc',
    });
    const patched = await svc.updateTask(created.id, {
      title: 'Patched',
      description: 'now with detail',
      dueDate: '2026-11-01',
      assigneeMembershipId: 'u-neha',
    });
    expect(patched.title).toBe('Patched');
    expect(patched.description).toBe('now with detail');
    expect(patched.assigneeMembershipId).toBe('u-neha');
    expect(patched.updatedAt).not.toBeNull();

    const relinked = await svc.updateTask(created.id, {
      complianceInstanceId: 'cin-xyz-tds24q-q1-fy26-27',
    });
    expect(relinked.clientId).toBe('c-xyz');
    expect(relinked.complianceInstanceId).toBe('cin-xyz-tds24q-q1-fy26-27');
  });

  it('status/waitingReason are never routine edits (write-guard parity); unknown ids not_found', async () => {
    const created = await svc.createTask({
      title: 'Guard me',
      nextAction: 'x',
      clientId: 'c-abc',
    });
    await expect(
      svc.updateTask(created.id, { status: 'done' } as never),
    ).rejects.toEqual(apiError('conflict'));
    await expect(
      svc.updateTask(created.id, { waitingReason: 'x' } as never),
    ).rejects.toEqual(apiError('conflict'));
    await expect(svc.updateTask('nope', { title: 'x' })).rejects.toEqual(apiError('not_found'));
  });
});

describe('fixture tasks adapter — transitions (DM-SM-05, RLS-TSK-01)', () => {
  it('walks the full main chain incl. the waiting blocker pair and the reopen edge', async () => {
    const created = await svc.createTask({
      title: 'Lifecycle walk',
      nextAction: 'start',
      clientId: 'c-abc',
      assigneeMembershipId: 'u-rahul',
    });
    const t = (targetStatus: Parameters<typeof svc.transitionTask>[1]['targetStatus']) =>
      svc.transitionTask(created.id, { targetStatus });

    expect((await t('in_progress')).task.status).toBe('in_progress');

    // waiting requires a reason (conflict without), stamps it with one.
    await expect(
      svc.transitionTask(created.id, { targetStatus: 'waiting' }),
    ).rejects.toEqual(apiError('conflict'));
    const waiting = await svc.transitionTask(created.id, {
      targetStatus: 'waiting',
      waitingReason: 'Awaiting client bank statements',
    });
    expect(waiting.task.waitingReason).toBe('Awaiting client bank statements');

    // Leaving waiting RETAINS the reason as history.
    const resumed = await t('in_progress');
    expect(resumed.task.status).toBe('in_progress');
    expect(resumed.task.waitingReason).toBe('Awaiting client bank statements');

    await t('submitted');
    await t('approved');
    const done = await t('done');
    expect(done.fromStatus).toBe('approved');
    expect(done.toStatus).toBe('done');

    // done -> open is the one reopen edge; terminals are otherwise final.
    const reopened = await t('open');
    expect(reopened.task.status).toBe('open');
  });

  it('illegal edges and unknown targets are conflict/validation; same-status rules apply', async () => {
    const created = await svc.createTask({
      title: 'Illegal edges',
      nextAction: 'x',
      clientId: 'c-abc',
    });
    // open -> approved is not a DM-SM-05 edge.
    await expect(
      svc.transitionTask(created.id, { targetStatus: 'approved' }),
    ).rejects.toEqual(apiError('conflict'));
    // Unknown target status: malformed input → validation (CA400 parity).
    await expect(
      svc.transitionTask(created.id, { targetStatus: 'flying' as never }),
    ).rejects.toEqual(apiError('validation'));
    // Same-status without a key is a conflict…
    await expect(
      svc.transitionTask(created.id, { targetStatus: 'open' }),
    ).rejects.toEqual(apiError('conflict'));
    // …but a keyed replay is the already_applied DTO, never an error.
    const replay = await svc.transitionTask(created.id, {
      targetStatus: 'open',
      mutationKey: 'replay-1',
    });
    expect(replay.status).toBe('already_applied');
    expect(replay.reason).toBe('already_in_target_status');
    expect(replay.task.status).toBe('open');
    // Unknown task: the uniform not_found.
    await expect(
      svc.transitionTask('nope', { targetStatus: 'cancelled' }),
    ).rejects.toEqual(apiError('not_found'));
  });

  it('submitted -> returned requires a reviewer comment and creates it atomically', async () => {
    const created = await svc.createTask({
      title: 'Rework lane',
      nextAction: 'x',
      clientId: 'c-abc',
      assigneeMembershipId: 'u-rahul',
    });
    await svc.transitionTask(created.id, { targetStatus: 'in_progress' });
    await svc.transitionTask(created.id, { targetStatus: 'submitted' });

    await expect(
      svc.transitionTask(created.id, { targetStatus: 'returned' }),
    ).rejects.toEqual(apiError('conflict'));

    const returned = await svc.transitionTask(created.id, {
      targetStatus: 'returned',
      reviewerComment: 'Attach the signed reconciliation.',
    });
    expect(returned.status).toBe('transitioned');
    expect(returned.reviewerComment).toBeDefined();
    expect(returned.reviewerComment!.authorId).toBe('demo-fixture-user');
    expect(returned.reviewerComment!.body).toBe('Attach the signed reconciliation.');

    // The comment is an ordinary immutable SCH-16 row on the task.
    const detail = await svc.getTaskDetail(created.id);
    expect(detail!.comments.map((c) => c.id)).toContain(returned.reviewerComment!.id);
    // returned -> in_progress is the rework edge back to the assignee.
    expect(
      (await svc.transitionTask(created.id, { targetStatus: 'in_progress' })).task.status,
    ).toBe('in_progress');
  });

  it('four-eyes review exits are reviewer-only — the partner caller gets unauthorized (RLS-4EY-03)', async () => {
    // SEED_FOUR_EYES sits at submitted on a four-eyes instance with
    // reviewer u-priya; the fixture caller (partner, no rank bypass) is
    // denied for BOTH review exits.
    await expect(
      svc.transitionTask(SEED_FOUR_EYES, { targetStatus: 'approved' }),
    ).rejects.toEqual(apiError('unauthorized'));
    await expect(
      svc.transitionTask(SEED_FOUR_EYES, {
        targetStatus: 'returned',
        reviewerComment: 'try anyway',
      }),
    ).rejects.toEqual(apiError('unauthorized'));
    // The task is untouched.
    expect((await svc.getTaskDetail(SEED_FOUR_EYES))!.task.status).toBe('submitted');
  });

  it('cancellation is reachable from any non-terminal state and is final', async () => {
    const created = await svc.createTask({
      title: 'Cancel me',
      nextAction: 'x',
      clientId: 'c-abc',
    });
    await svc.transitionTask(created.id, { targetStatus: 'in_progress' });
    const cancelled = await svc.transitionTask(created.id, { targetStatus: 'cancelled' });
    expect(cancelled.task.status).toBe('cancelled');
    await expect(
      svc.transitionTask(created.id, { targetStatus: 'open' }),
    ).rejects.toEqual(apiError('conflict'));
  });
});

describe('fixture tasks adapter — dependencies (RLS-TSK-02)', () => {
  it('add/remove with keyed replays; self, duplicate, and cycle edges are conflicts', async () => {
    const a = await svc.createTask({ title: 'dep A', nextAction: 'x', clientId: 'c-abc' });
    const b = await svc.createTask({ title: 'dep B', nextAction: 'x', clientId: 'c-abc' });

    const added = await svc.addTaskDependency(a.id, { dependsOnTaskId: b.id });
    expect(added.status).toBe('added');
    expect(added.dependency.dependencyType).toBe('finish_to_start');

    // Duplicate pair: conflict unkeyed, already_applied keyed (API-MUT-03).
    await expect(
      svc.addTaskDependency(a.id, { dependsOnTaskId: b.id }),
    ).rejects.toEqual(apiError('conflict'));
    const replay = await svc.addTaskDependency(a.id, {
      dependsOnTaskId: b.id,
      mutationKey: 'dep-replay-1',
    });
    expect(replay.status).toBe('already_applied');
    expect(replay.reason).toBe('edge_already_exists');

    // Self-edge and cycle (b -> a would close a -> b) are conflicts.
    await expect(
      svc.addTaskDependency(a.id, { dependsOnTaskId: a.id }),
    ).rejects.toEqual(apiError('conflict'));
    await expect(
      svc.addTaskDependency(b.id, { dependsOnTaskId: a.id }),
    ).rejects.toEqual(apiError('conflict'));

    // Unknown endpoints: the uniform not_found.
    await expect(
      svc.addTaskDependency('nope', { dependsOnTaskId: b.id }),
    ).rejects.toEqual(apiError('not_found'));

    // Remove: removed -> keyed replay already_applied -> unkeyed conflict.
    const removed = await svc.removeTaskDependency(a.id, b.id);
    expect(removed.status).toBe('removed');
    const removedReplay = await svc.removeTaskDependency(a.id, b.id, 'dep-replay-2');
    expect(removedReplay.status).toBe('already_applied');
    expect(removedReplay.reason).toBe('edge_already_absent');
    await expect(svc.removeTaskDependency(a.id, b.id)).rejects.toEqual(apiError('conflict'));

    // The seeded edge still exists and is visible from BOTH endpoints.
    const detail = await svc.getTaskDetail(SEED_ADHOC);
    expect(detail!.dependencies.map((d) => d.id)).toEqual([
      'taskdep-onboarding-before-filing',
    ]);
  });

  it('the seeded cycle back-edge is rejected (filing already depends on onboarding)', async () => {
    await expect(
      svc.addTaskDependency(SEED_ADHOC, { dependsOnTaskId: SEED_LINKED }),
    ).rejects.toEqual(apiError('conflict'));
  });
});

describe('fixture tasks adapter — checklist toggles (DM-14)', () => {
  it('flip stamps the caller; true->true preserves; uncheck clears; unknown not_found', async () => {
    // false -> true: completion attribution is server-stamped.
    const flipped = await svc.toggleChecklistItem('taskchk-gstr1-itc', true);
    expect(flipped.isDone).toBe(true);
    expect(flipped.doneBy).toBe('demo-fixture-user');
    expect(flipped.doneAt).not.toBeNull();

    // true -> true on the seeded completed line: the recorded who/when is
    // preserved exactly.
    const preserved = await svc.toggleChecklistItem('taskchk-gstr1-sales', true);
    expect(preserved.doneAt).toBe('2026-08-20T00:00:00.000Z');
    expect(preserved.doneBy).toBe('demo-fixture-user');

    // Unchecking clears both (documented PASS-B convention).
    const cleared = await svc.toggleChecklistItem('taskchk-gstr1-sales', false);
    expect(cleared.isDone).toBe(false);
    expect(cleared.doneBy).toBeNull();
    expect(cleared.doneAt).toBeNull();

    await expect(svc.toggleChecklistItem('nope', true)).rejects.toEqual(
      apiError('not_found'),
    );
  });
});

describe('fixture tasks adapter — comments (SCH-16, RLS-TCM-01)', () => {
  it('append pins the author to the caller; retraction is author-only with a not_found surface', async () => {
    const added = await svc.addTaskComment(SEED_ADHOC, 'Client called — documents tomorrow.');
    expect(added.authorId).toBe('demo-fixture-user');
    expect(added.retracted).toBe(false);
    const detail = await svc.getTaskDetail(SEED_ADHOC);
    expect(detail!.comments.map((c) => c.id)).toContain(added.id);

    // Own comment: retract (one-way); re-retracting is the permitted no-op.
    const retracted = await svc.retractTaskComment(added.id);
    expect(retracted.retracted).toBe(true);
    const again = await svc.retractTaskComment(added.id);
    expect(again.retracted).toBe(true);

    // Another author's comment and unknown ids: identical not_found.
    await expect(svc.retractTaskComment('taskcmt-tds24q-reviewer-note')).rejects.toEqual(
      apiError('not_found'),
    );
    await expect(svc.retractTaskComment('nope')).rejects.toEqual(apiError('not_found'));
  });

  it('append against an unknown parent task is a WRITE denial — unauthorized (API-ERR-03), not not_found', async () => {
    // Production parity: the INSERT policy's WITH CHECK task-visibility
    // failure surfaces 42501 → unauthorized. The zero-row UPDATE surface
    // (retract, above) stays not_found — the two must not be conflated.
    await expect(svc.addTaskComment('nope', 'x')).rejects.toEqual(apiError('unauthorized'));
  });
});
