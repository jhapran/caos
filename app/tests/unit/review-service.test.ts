/**
 * IMP-041 PASS C — Fixture review adapter contract test (demo track).
 *
 * Runs under the unit harness, which pins DATA_SOURCE=fixture
 * (tests/setup.ts), so reviewService resolves to the fixture implementation.
 * Verifies the deterministic seed (legacy demo labels mapped onto the frozen
 * R0 keys at the boundary) and the fixture mirror of the production contract
 * (API-R0-RVW): linked-subject-wins derivation, client-mismatch validation,
 * mandatory non-empty rationale for every decision, pending → terminal only
 * (keyless conflict / keyed already_applied replay, API-MUT-03), the
 * RLS-4EY-04 self-decision denial (no rank bypass — the fixture persona is a
 * partner), and the atomic linked-task return composition through the
 * fixture task machine (task refusal leaves the item pending).
 *
 * Fixture role-model limit: fixture mode has ONE caller persona
 * ('demo-fixture-membership', partner, firm-wide) — the RLS-RVW-01
 * role-scoping matrix is NOT simulated (no second persona exists); the
 * business semantics above ARE enforced. RLS security is covered by the
 * PASS-B integration tests.
 *
 * NOTE: the fixture store is module-local and shared across the tests in
 * this file; scenarios use their own freshly submitted rows or are sequenced
 * so earlier mutations cannot poison later assertions.
 */
import { describe, expect, it } from 'vitest';

import type { ApiError } from '@/data/errors';
// NOTE: '@/data/review' is the LEGACY flat fixture module (file-first
// resolution) — the IMP-041 service is imported via its explicit selector
// path (same as the barrel's './review/index' wiring).
import { reviewService as svc } from '@/data/review/reviewService';

const apiError = (kind: string) =>
  expect.objectContaining({ kind }) as unknown as ApiError;

const FIXTURE_MEMBER = 'demo-fixture-membership';
const SEED_LINKED_TASK = 'task-abc-gstr1-filing';
const SEED_FOUR_EYES_TASK = 'task-xyz-tds24q-review';
const SEED_INSTANCE = 'cin-abc-gstr1-2026-08';

describe('fixture review adapter — seed & reads', () => {
  it('resolves to fixture mode under the unit harness and is barrel-reachable', async () => {
    expect(svc.mode).toBe('fixture');
    const { reviewService } = await import('@/data');
    expect(reviewService).toBe(svc);
  });

  it('serves the deterministic 21-item seed with frozen R0 type keys', async () => {
    const items = await svc.listReviewItems();
    expect(items).toHaveLength(21);
    const keys = new Set(items.map((r) => r.type));
    expect(keys).toEqual(
      new Set([
        'gst_reconciliation',
        'tds_return',
        'itr_computation',
        'financial_statements',
        'audit_workpaper',
      ]),
    );
    // All seed rows are pending, oldest-submitted first, human source.
    expect(items.every((r) => r.status === 'pending')).toBe(true);
    expect(items.every((r) => r.source === 'human')).toBe(true);
    for (let i = 1; i < items.length; i++) {
      expect(items[i].submittedAt >= items[i - 1].submittedAt).toBe(true);
    }
    // CamelCase DTOs — no provider keys cross the boundary.
    expect(items[0]).not.toHaveProperty('firm_id');
    expect(items[0]).not.toHaveProperty('submitted_by_membership_id');
  });

  it('list filters by status, type, and submitter', async () => {
    const gst = await svc.listReviewItems({ type: 'gst_reconciliation' });
    expect(gst).toHaveLength(6);
    expect(gst.every((r) => r.type === 'gst_reconciliation')).toBe(true);
    expect(await svc.listReviewItems({ status: 'approved' })).toEqual([]);
    const priya = await svc.listReviewItems({ submittedByMembershipId: 'u-priya' });
    expect(priya.length).toBeGreaterThan(0);
    expect(priya.every((r) => r.submittedByMembershipId === 'u-priya')).toBe(true);
  });
});

describe('fixture review adapter — submission (API-R0-RVW)', () => {
  it('ad-hoc submit: explicit client, server-controlled fields derived', async () => {
    const item = await svc.submitReviewItem({
      clientId: 'c-abc',
      type: 'itr_computation',
      title: '  ITR-2 computation review  ',
      note: '  Two open queries.  ',
    });
    expect(item).toMatchObject({
      firmId: 'demo-fixture-firm',
      clientId: 'c-abc',
      taskId: null,
      complianceInstanceId: null,
      type: 'itr_computation',
      source: 'human',
      title: 'ITR-2 computation review',
      note: 'Two open queries.',
      status: 'pending',
      priority: 'normal',
      submittedByMembershipId: FIXTURE_MEMBER,
      decidedByMembershipId: null,
      decidedAt: null,
      decisionRationale: null,
    });
  });

  it('task-linked submit derives client + instance from the task (linked subject wins)', async () => {
    const item = await svc.submitReviewItem({
      taskId: SEED_LINKED_TASK,
      type: 'gst_reconciliation',
      title: 'GSTR-1 working for review',
    });
    expect(item.clientId).toBe('c-abc');
    expect(item.taskId).toBe(SEED_LINKED_TASK);
    expect(item.complianceInstanceId).toBe(SEED_INSTANCE);
  });

  it('instance-only submit derives the client from the instance', async () => {
    const item = await svc.submitReviewItem({
      complianceInstanceId: SEED_INSTANCE,
      type: 'gst_reconciliation',
      title: 'Instance-scoped review',
    });
    expect(item.clientId).toBe('c-abc');
    expect(item.complianceInstanceId).toBe(SEED_INSTANCE);
    expect(item.taskId).toBeNull();
  });

  it('rejects: unknown type, blank title, missing subject, unknown subject, client mismatch', async () => {
    await expect(
      svc.submitReviewItem({
        clientId: 'c-abc',
        // @ts-expect-error — deliberately invalid vocabulary probe
        type: 'gst_reco',
        title: 'x',
      }),
    ).rejects.toEqual(apiError('validation'));
    await expect(
      svc.submitReviewItem({ clientId: 'c-abc', type: 'tds_return', title: '   ' }),
    ).rejects.toEqual(apiError('validation'));
    await expect(
      svc.submitReviewItem({ type: 'tds_return', title: 'no subject' }),
    ).rejects.toEqual(apiError('validation'));
    // Unknown subject and (in production) inaccessible subject share the
    // identical not_found surface (API-ERR-02).
    await expect(
      svc.submitReviewItem({ clientId: 'c-nope', type: 'tds_return', title: 'x' }),
    ).rejects.toEqual(apiError('not_found'));
    // Caller-supplied clientId never overrides the linked subject.
    await expect(
      svc.submitReviewItem({
        taskId: SEED_LINKED_TASK,
        clientId: 'c-xyz',
        type: 'gst_reconciliation',
        title: 'x',
      }),
    ).rejects.toEqual(apiError('validation'));
    // Task + wrong compliance instance is rejected (SCH-17 invariant C).
    await expect(
      svc.submitReviewItem({
        taskId: SEED_LINKED_TASK,
        complianceInstanceId: 'cin-nope',
        type: 'gst_reconciliation',
        title: 'x',
      }),
    ).rejects.toEqual(apiError('validation'));
  });
});

describe('fixture review adapter — decisions (DM-SM-06)', () => {
  it('approve: pending → approved with decider, timestamp and rationale stamped', async () => {
    const result = await svc.decideReviewItem('r-04', {
      decision: 'approved',
      rationale: 'Schedules tie out; ready to file.',
    });
    expect(result.status).toBe('decided');
    expect(result.fromStatus).toBe('pending');
    expect(result.toStatus).toBe('approved');
    expect(result.item).toMatchObject({
      id: 'r-04',
      status: 'approved',
      decidedByMembershipId: FIXTURE_MEMBER,
      decisionRationale: 'Schedules tie out; ready to file.',
    });
    expect(result.item.decidedAt).toBeTruthy();
    expect(result.task).toBeUndefined();
    expect(result.reviewerComment).toBeUndefined();
  });

  it('unlinked return: pending → returned with no task side effects', async () => {
    const result = await svc.decideReviewItem('r-05', {
      decision: 'returned',
      rationale: 'Attach the revised purchase register.',
    });
    expect(result.status).toBe('decided');
    expect(result.item.status).toBe('returned');
    expect(result.task).toBeUndefined();
  });

  it('blank or whitespace rationale is a conflict for every decision', async () => {
    await expect(
      svc.decideReviewItem('r-06', { decision: 'approved', rationale: '   \n\t ' }),
    ).rejects.toEqual(apiError('conflict'));
    await expect(
      svc.decideReviewItem('r-06', { decision: 'dismissed', rationale: '' }),
    ).rejects.toEqual(apiError('conflict'));
    // Still pending afterwards.
    const items = await svc.listReviewItems();
    expect(items.find((r) => r.id === 'r-06')!.status).toBe('pending');
  });

  it('self-decision is denied by membership identity — no rank bypass (RLS-4EY-04)', async () => {
    // The fixture persona is a partner; the denial is by identity, not rank.
    const own = await svc.submitReviewItem({
      clientId: 'c-abc',
      type: 'audit_workpaper',
      title: 'Own workpaper for self-decision probe',
    });
    await expect(
      svc.decideReviewItem(own.id, { decision: 'approved', rationale: 'self' }),
    ).rejects.toEqual(apiError('unauthorized'));
    const still = await svc.listReviewItems();
    expect(still.find((r) => r.id === own.id)!.status).toBe('pending');
  });

  it('terminal re-decision: keyless conflict, keyed replay returns already_applied', async () => {
    await expect(
      svc.decideReviewItem('r-04', { decision: 'returned', rationale: 'again' }),
    ).rejects.toEqual(apiError('conflict'));
    const replay = await svc.decideReviewItem('r-04', {
      decision: 'returned',
      rationale: 'again',
      mutationKey: 'mk-r04-1',
    });
    expect(replay.status).toBe('already_applied');
    expect(replay.reason).toBe('already_decided');
    // The replay surfaces the CURRENT row — no second decision happened.
    expect(replay.item.status).toBe('approved');
  });

  it('invalid decision vocabulary is validation; unknown item id is not_found', async () => {
    await expect(
      // @ts-expect-error — deliberately invalid vocabulary probe
      svc.decideReviewItem('r-07', { decision: 'rejected', rationale: 'x' }),
    ).rejects.toEqual(apiError('validation'));
    await expect(
      svc.decideReviewItem('r-nope', { decision: 'approved', rationale: 'x' }),
    ).rejects.toEqual(apiError('not_found'));
  });

  it('linked-task return composes through the task machine: task refusal leaves the item pending', async () => {
    // The four-eyes seed task is submitted with reviewer u-priya; the fixture
    // caller is NOT the assigned reviewer, so the task machine refuses the
    // return (RLS-4EY-03, no rank bypass) — the review item must stay pending
    // (atomicity: no partial mutation).
    const linked = await svc.submitReviewItem({
      taskId: SEED_FOUR_EYES_TASK,
      type: 'tds_return',
      title: 'TDS 24Q review for four-eyes probe',
    });
    await expect(
      svc.decideReviewItem(linked.id, { decision: 'returned', rationale: 'fix the mapping' }),
    ).rejects.toEqual(apiError('unauthorized'));
    const after = await svc.listReviewItems();
    expect(after.find((r) => r.id === linked.id)!.status).toBe('pending');
  });
});

describe('fixture review adapter — local invalidation (API-RT-04)', () => {
  it('submit and decide notify subscribers; unsubscribe stops notifications', async () => {
    let calls = 0;
    const unsubscribe = svc.subscribeReviewQueue(() => {
      calls += 1;
    });
    await svc.submitReviewItem({ clientId: 'c-xyz', type: 'tds_return', title: 'sub probe' });
    expect(calls).toBe(1);
    await svc.decideReviewItem('r-08', { decision: 'dismissed', rationale: 'duplicate of r-01' });
    expect(calls).toBe(2);
    unsubscribe();
    await svc.submitReviewItem({ clientId: 'c-xyz', type: 'tds_return', title: 'post-unsub' });
    expect(calls).toBe(2);
    // Failed commands do NOT notify (no state changed).
    await expect(
      svc.decideReviewItem('r-nope-2', { decision: 'approved', rationale: 'x' }),
    ).rejects.toEqual(apiError('not_found'));
    expect(calls).toBe(2);
  });
});
