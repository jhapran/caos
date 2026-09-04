/**
 * IMP-031 — Fixture compliance profiles & instances adapter contract test
 * (demo track).
 *
 * Runs under the unit harness, which pins DATA_SOURCE=fixture
 * (tests/setup.ts), so complianceInstancesService resolves to the fixture
 * implementation. Verifies the deterministic seed set and the fixture
 * mirror of the production contract (API-R0-CCP / API-R0-CIN): profile
 * lifecycle + approval stamps, DM-27 scope validation (incl. the TDS PAN
 * exception), provenance insert-onlyness, DM-SM-04 transition legality,
 * the four-eyes reviewer-exit overlay, and mutation-key replay.
 *
 * Adapter parity note (MIG-VAL-03): the unit harness exercises the fixture
 * adapter only — the Supabase adapter shares the identical service
 * interface (compile-time) and its runtime parity is covered by the
 * integration suites owned by the IMP-031 test phase, not here.
 *
 * Fixture role-model limit: fixture mode has ONE caller persona
 * (partner, firm-wide) — T1 role-scoping (manager portfolio,
 * senior/article assigned-only) is not simulated; lifecycle/scope/
 * four-eyes semantics ARE enforced.
 */
import { describe, expect, it } from 'vitest';

import { complianceInstancesService as svc } from '@/data/complianceInstances';
import { complianceRulesService } from '@/data/complianceRules';
import type { ApiError } from '@/data/errors';

const TYPE_GSTR1 = '50000000-0000-4000-8000-000000000001';
const TYPE_GSTR3B = '50000000-0000-4000-8000-000000000002';
const TYPE_TDS24Q = '50000000-0000-4000-8000-000000000003';
const TYPE_TDS26Q = '50000000-0000-4000-8000-000000000004';
const TYPE_ITR = '50000000-0000-4000-8000-000000000005';

const apiError = (kind: string) =>
  expect.objectContaining({ kind }) as unknown as ApiError;

describe('fixture compliance instances adapter — seed & reads', () => {
  it('resolves to fixture mode under the unit harness and is barrel-reachable', async () => {
    expect(svc.mode).toBe('fixture');
    const { complianceInstancesService } = await import('@/data');
    expect(complianceInstancesService).toBe(svc);
  });

  it('serves the deterministic seed: 4 profiles (2 active / 2 proposed), 4 instances', async () => {
    const profiles = await svc.listComplianceProfiles();
    expect(profiles).toHaveLength(4);
    expect(profiles.filter((p) => p.status === 'active')).toHaveLength(2);
    expect(profiles.filter((p) => p.status === 'proposed')).toHaveLength(2);
    // Approval stamps exist only on the active rows.
    for (const p of profiles) {
      if (p.status === 'active') {
        expect(p.approvedBy).toBe('demo-fixture-user');
        expect(p.approvedAt).not.toBeNull();
      } else {
        expect(p.approvedBy).toBeNull();
      }
    }
    const instances = await svc.listComplianceInstances();
    expect(instances).toHaveLength(4);
    // No recurrence-sourced rows: manual or import only.
    expect(instances.every((i) => i.generationSource !== 'recurrence')).toBe(true);
    // Instances are due-date ordered.
    const dues = instances.map((i) => i.dueDate);
    expect(dues).toEqual([...dues].sort());
  });

  it('single-resource reads return null for unknown ids (no existence oracle, API-ERR-02)', async () => {
    expect(await svc.getComplianceProfile('ccp-abc-gstr1')).toMatchObject({
      legalEntityId: 'c-abc-entity',
      registrationId: 'c-abc-gstin',
      status: 'active',
    });
    expect(await svc.getComplianceProfile('nope')).toBeNull();
    expect(await svc.getComplianceInstance('cin-abc-gstr1-2026-08')).toMatchObject({
      clientId: 'c-abc',
      state: 'preparation',
    });
    expect(await svc.getComplianceInstance('nope')).toBeNull();
  });

  it('instance filters: state, assignee, due window, client, type; limit/offset', async () => {
    const internalReview = await svc.listComplianceInstances({ state: 'internal_review' });
    expect(internalReview.map((i) => i.id)).toEqual(['cin-xyz-tds24q-q1-fy26-27']);

    const rahul = await svc.listComplianceInstances({ assigneeMembershipId: 'u-rahul' });
    expect(rahul.length).toBeGreaterThan(0);
    expect(rahul.every((i) => i.assigneeMembershipId === 'u-rahul')).toBe(true);

    const dueWindow = await svc.listComplianceInstances({
      dueFrom: '2026-09-01',
      dueTo: '2026-09-30',
    });
    expect(dueWindow.map((i) => i.id)).toEqual(['cin-abc-gstr1-2026-08']);

    const abc = await svc.listComplianceInstances({ clientId: 'c-abc' });
    expect(abc).toHaveLength(2);
    const tds = await svc.listComplianceInstances({ complianceTypeId: TYPE_TDS24Q });
    expect(tds.map((i) => i.id)).toEqual(['cin-xyz-tds24q-q1-fy26-27']);

    const page = await svc.listComplianceInstances({ limit: 1, offset: 1 });
    expect(page).toHaveLength(1);
  });
});

describe('fixture compliance instances adapter — profiles (API-R0-CCP)', () => {
  it('propose → approve lifecycle: stamps approvedBy/approvedAt, creates ZERO instances', async () => {
    const before = await svc.listComplianceInstances({ legalEntityId: 'c-pqr-entity' });
    const approved = await svc.approveComplianceProfile('ccp-pqr-gstr3b');
    expect(approved.status).toBe('active');
    expect(approved.approvedBy).toBe('demo-fixture-user');
    expect(approved.approvedAt).not.toBeNull();
    const after = await svc.listComplianceInstances({ legalEntityId: 'c-pqr-entity' });
    expect(after).toHaveLength(before.length); // C5 ruling: approval materializes nothing
    // Re-approval of a non-proposed profile is a conflict.
    await expect(svc.approveComplianceProfile('ccp-pqr-gstr3b')).rejects.toEqual(
      apiError('conflict'),
    );
    await expect(svc.approveComplianceProfile('nope')).rejects.toEqual(apiError('not_found'));
  });

  it('creates a proposed profile; duplicate (entity, type, registration) is conflict', async () => {
    const created = await svc.createComplianceProfile({
      legalEntityId: 'c-kaveri-entity',
      complianceTypeId: TYPE_GSTR3B,
      registrationId: 'c-kaveri-gstin',
      applicabilityAnswers: { registeredForGst: true },
    });
    expect(created.status).toBe('proposed');
    expect(created.firmId).toBe('demo-fixture-firm');
    expect(created.approvedBy).toBeNull();

    await expect(
      svc.createComplianceProfile({
        legalEntityId: 'c-kaveri-entity',
        complianceTypeId: TYPE_GSTR3B,
        registrationId: 'c-kaveri-gstin',
      }),
    ).rejects.toEqual(apiError('conflict'));
    // Unknown references are conflict (23503 parity).
    await expect(
      svc.createComplianceProfile({
        legalEntityId: 'c-nope-entity',
        complianceTypeId: TYPE_GSTR3B,
      }),
    ).rejects.toEqual(apiError('conflict'));
    await expect(
      svc.createComplianceProfile({
        legalEntityId: 'c-kaveri-entity',
        complianceTypeId: 'nope',
      }),
    ).rejects.toEqual(apiError('conflict'));
  });

  it('DM-27 scope validation on profiles (validation, never conflict)', async () => {
    // entity-scoped type with a registration
    await expect(
      svc.createComplianceProfile({
        legalEntityId: 'c-abc-entity',
        complianceTypeId: TYPE_ITR,
        registrationId: 'c-abc-pan',
      }),
    ).rejects.toEqual(apiError('validation'));
    // registration-scoped type without a registration (profiles have NO NULL path)
    await expect(
      svc.createComplianceProfile({
        legalEntityId: 'c-kaveri-entity',
        complianceTypeId: TYPE_TDS24Q,
        registrationId: null,
      }),
    ).rejects.toEqual(apiError('validation'));
    // registration class mismatch (GSTR-1 needs GSTIN, not PAN)
    await expect(
      svc.createComplianceProfile({
        legalEntityId: 'c-kaveri-entity',
        complianceTypeId: TYPE_GSTR1,
        registrationId: 'c-kaveri-pan',
      }),
    ).rejects.toEqual(apiError('validation'));
    // registration of a different legal entity
    await expect(
      svc.createComplianceProfile({
        legalEntityId: 'c-kaveri-entity',
        complianceTypeId: TYPE_GSTR1,
        registrationId: 'c-abc-gstin',
      }),
    ).rejects.toEqual(apiError('validation'));
    // TDS PAN substitution is the ONE permitted class substitution.
    const tds = await svc.createComplianceProfile({
      legalEntityId: 'c-kaveri-entity',
      complianceTypeId: TYPE_TDS26Q,
      registrationId: 'c-kaveri-pan',
    });
    expect(tds.registrationId).toBe('c-kaveri-pan');
  });

  it('edits a proposed profile; activation via ordinary update is a conflict', async () => {
    const edited = await svc.updateComplianceProfile('ccp-xyz-tds24q', {
      applicabilityAnswers: { tdsDeductor: true, tanNotAllotted: true, salaries: true },
    });
    expect(edited.applicabilityAnswers).toMatchObject({ salaries: true });
    expect(edited.status).toBe('proposed');

    await expect(
      svc.updateComplianceProfile('ccp-xyz-tds24q', { status: 'active' } as never),
    ).rejects.toEqual(apiError('conflict'));
    await expect(
      svc.updateComplianceProfile('nope', { applicabilityAnswers: {} }),
    ).rejects.toEqual(apiError('not_found'));
  });

  it('non-active status moves (suspend/end) stay ordinary updates', async () => {
    const suspended = await svc.updateComplianceProfile('ccp-abc-gstr1', { status: 'suspended' });
    expect(suspended.status).toBe('suspended');
    const ended = await svc.updateComplianceProfile('ccp-abc-gstr1', { status: 'ended' });
    expect(ended.status).toBe('ended');
  });
});

describe('fixture compliance instances adapter — manual creation (API-R0-CIN)', () => {
  it('creates a manual instance: clientId derived, provenance null, state not_started', async () => {
    const created = await svc.createComplianceInstance({
      legalEntityId: 'c-kaveri-entity',
      complianceTypeId: TYPE_GSTR3B,
      registrationId: 'c-kaveri-gstin',
      clientComplianceProfileId: (
        await svc.listComplianceProfiles({ legalEntityId: 'c-kaveri-entity', complianceTypeId: TYPE_GSTR3B })
      )[0].id,
      periodStart: '2026-08-01',
      periodEnd: '2026-08-31',
      periodLabel: 'Aug 2026',
      dueDate: '2026-09-20',
      assigneeMembershipId: 'u-rahul',
      reviewerMembershipId: 'u-priya',
    });
    expect(created).toMatchObject({
      clientId: 'c-kaveri', // SCH-A-02: derived from the legal entity
      state: 'not_started',
      generationSource: 'manual',
      ruleVersionId: null,
      generatedAt: null,
      calculatedDueDate: null,
      filedAt: null,
      closedAt: null,
    });

    // One instance per obligation per period (AUTO-REC-03 layer 3).
    await expect(
      svc.createComplianceInstance({
        legalEntityId: 'c-kaveri-entity',
        complianceTypeId: TYPE_GSTR3B,
        registrationId: 'c-kaveri-gstin',
        periodStart: '2026-08-01',
        periodEnd: '2026-08-31',
        periodLabel: 'Aug 2026 dup',
        dueDate: '2026-09-20',
      }),
    ).rejects.toEqual(apiError('conflict'));
  });

  it('rejects invalid periods and scope violations as validation', async () => {
    const base = {
      legalEntityId: 'c-abc-entity',
      periodStart: '2026-08-01',
      periodEnd: '2026-08-31',
      periodLabel: 'Aug 2026',
      dueDate: '2026-09-20',
    };
    await expect(
      svc.createComplianceInstance({ ...base, complianceTypeId: TYPE_GSTR3B, periodEnd: '2026-07-31' }),
    ).rejects.toEqual(apiError('validation'));
    // registration-scoped type without registration
    await expect(
      svc.createComplianceInstance({ ...base, complianceTypeId: TYPE_GSTR3B }),
    ).rejects.toEqual(apiError('validation'));
    // unknown responsibility membership (23503/SCH-RESP-03 parity)
    await expect(
      svc.createComplianceInstance({
        ...base,
        complianceTypeId: TYPE_ITR,
        periodStart: '2024-04-01',
        periodEnd: '2025-03-31',
        assigneeMembershipId: 'u-nope',
      }),
    ).rejects.toEqual(apiError('conflict'));
  });

  it('TDS NULL registration needs the recorded exception reason in period_meta', async () => {
    const base = {
      legalEntityId: 'c-kaveri-entity',
      complianceTypeId: TYPE_TDS24Q,
      registrationId: null,
      periodStart: '2026-07-01',
      periodEnd: '2026-09-30',
      periodLabel: 'Q2 FY 2026-27',
      dueDate: '2026-10-31',
    };
    await expect(svc.createComplianceInstance(base)).rejects.toEqual(apiError('validation'));
    await expect(
      svc.createComplianceInstance({ ...base, periodMeta: { tds_pan_exception: '  ' } }),
    ).rejects.toEqual(apiError('validation'));
    const ok = await svc.createComplianceInstance({
      ...base,
      periodMeta: { tds_pan_exception: 'TAN not allotted — PAN-based deposit (DM-27)' },
    });
    expect(ok.registrationId).toBeNull();
  });

  it('four-eyes: reviewer = assignee on a four-eyes type is validation (RLS-4EY-01)', async () => {
    await expect(
      svc.createComplianceInstance({
        legalEntityId: 'c-abc-entity',
        complianceTypeId: TYPE_ITR, // catalogue types are fourEyesRequired
        periodStart: '2024-04-01',
        periodEnd: '2025-03-31',
        periodLabel: 'FY 2024-25',
        dueDate: '2025-10-31',
        assigneeMembershipId: 'u-rahul',
        reviewerMembershipId: 'u-rahul',
      }),
    ).rejects.toEqual(apiError('validation'));
  });
});

describe('fixture compliance instances adapter — non-state updates', () => {
  it('permits the non-state set (due date, priority, assignments, period meta)', async () => {
    const updated = await svc.updateComplianceInstance('cin-abc-gstr1-2026-08', {
      dueDate: '2026-09-20', // statutory extension — operative date moves
      priority: 'critical',
      partnerMembershipId: 'u-pranav',
    });
    expect(updated.dueDate).toBe('2026-09-20');
    expect(updated.priority).toBe('critical');
    expect(updated.state).toBe('preparation'); // untouched
    expect(updated.updatedAt).not.toBeNull();
  });

  it('dropping the TDS exception key from period_meta re-fails scope validation', async () => {
    await expect(
      svc.updateComplianceInstance('cin-kaveri-tds26q-q1-fy26-27', { periodMeta: null }),
    ).rejects.toEqual(apiError('validation'));
    // ...and a reasoned update is accepted.
    const ok = await svc.updateComplianceInstance('cin-kaveri-tds26q-q1-fy26-27', {
      periodMeta: { tds_pan_exception: 'TAN application pending (DM-27)' },
      reviewerMembershipId: 'u-priya',
    });
    expect(ok.reviewerMembershipId).toBe('u-priya');
  });

  it('provenance fields are not client-settable — extra keys are ignored (AUTO-REC-07)', async () => {
    // The public input type carries no provenance fields at all; a JS
    // caller forcing them in must still get a plain manual instance.
    const created = await svc.createComplianceInstance({
      legalEntityId: 'c-abc-entity',
      complianceTypeId: TYPE_ITR,
      periodStart: '2023-04-01',
      periodEnd: '2024-03-31',
      periodLabel: 'FY 2023-24',
      dueDate: '2024-10-31',
      generationSource: 'recurrence',
      ruleVersionId: 'forged',
      generatedAt: '2026-01-01T00:00:00.000Z',
      calculatedDueDate: '2024-10-31',
    } as never);
    expect(created).toMatchObject({
      generationSource: 'manual',
      ruleVersionId: null,
      generatedAt: null,
      calculatedDueDate: null,
    });
  });

  it('updates of unknown ids are not_found', async () => {
    await expect(svc.updateComplianceInstance('nope', { priority: 'low' })).rejects.toEqual(
      apiError('not_found'),
    );
  });
});

describe('fixture compliance instances adapter — transitions (DM-SM-04, RLS-CIN-01)', () => {
  it('walks the template forward; unknown targets are validation, illegal jumps conflict', async () => {
    // Full-workflow gstr1 instance sits in preparation.
    const t1 = await svc.transitionInstance('cin-abc-gstr1-2026-08', { toState: 'internal_review' });
    expect(t1).toMatchObject({
      status: 'transitioned',
      fromState: 'preparation',
      toState: 'internal_review',
    });
    expect(t1.instance.state).toBe('internal_review');

    // Unknown target vocabulary → validation (CA400 parity).
    await expect(
      svc.transitionInstance('cin-abc-gstr1-2026-08', { toState: 'bogus' as never }),
    ).rejects.toEqual(apiError('validation'));
    // Skipping a template state → conflict with a machine-readable reason.
    await expect(
      svc.transitionInstance('cin-abc-gstr1-2026-08', { toState: 'filed' }),
    ).rejects.toEqual(apiError('conflict'));
    await expect(
      svc.transitionInstance('cin-abc-gstr1-2026-08', { toState: 'filed' }),
    ).rejects.toThrow(/invalid state transition internal_review -> filed/);
    // Unknown instance → not_found.
    await expect(
      svc.transitionInstance('nope', { toState: 'preparation' }),
    ).rejects.toEqual(apiError('not_found'));
  });

  it('four-eyes: the partner caller cannot exit internal_review without being the reviewer', async () => {
    // The fixture persona is a partner; the seeded TDS instance's reviewer
    // is u-priya — no rank bypass (RLS-4EY-01/02).
    await expect(
      svc.transitionInstance('cin-xyz-tds24q-q1-fy26-27', { toState: 'client_approval' }),
    ).rejects.toEqual(apiError('unauthorized'));
    // The regression internal_review → preparation IS open to an in-scope
    // manager+ actor (and the assignee-only restriction is not modelable
    // with the single fixture persona — documented limit).
    const regressed = await svc.transitionInstance('cin-xyz-tds24q-q1-fy26-27', {
      toState: 'preparation',
    });
    expect(regressed).toMatchObject({
      status: 'transitioned',
      fromState: 'internal_review',
      toState: 'preparation',
    });
  });

  it('workflow templates skip optional states (never reorder)', async () => {
    // Firm type whose template omits the information_* and client_approval /
    // acknowledgement states, and is NOT four-eyes.
    const firmType = await complianceRulesService.createComplianceType({
      typeKey: 'unit-skip-lane',
      name: 'Skip Lane',
      category: 'Certificates',
      frequency: 'custom',
      dueRule: { description: 'custom' },
      workflowTemplate: {
        states: ['not_started', 'preparation', 'internal_review', 'ready_to_file', 'filed', 'closed'],
      },
      governanceClass: 'non_statutory',
      fourEyesRequired: false,
      scopeKind: 'configurable',
    });
    const inst = await svc.createComplianceInstance({
      legalEntityId: 'c-abc-entity',
      complianceTypeId: firmType.id,
      periodStart: '2026-09-01',
      periodEnd: '2026-09-30',
      periodLabel: 'Sep 2026',
      dueDate: '2026-10-15',
      assigneeMembershipId: 'u-rahul',
    });
    // not_started -> preparation is legal: information_* are absent from the template.
    const t1 = await svc.transitionInstance(inst.id, { toState: 'preparation' });
    expect(t1.status).toBe('transitioned');
    // preparation -> filed is illegal: internal_review/ready_to_file are in the template between.
    await expect(svc.transitionInstance(inst.id, { toState: 'filed' })).rejects.toEqual(
      apiError('conflict'),
    );
    await svc.transitionInstance(inst.id, { toState: 'internal_review' });
    await svc.transitionInstance(inst.id, { toState: 'ready_to_file' });
    const filed = await svc.transitionInstance(inst.id, { toState: 'filed' });
    expect(filed.instance.filedAt).not.toBeNull();
    // filed -> closed skips acknowledgement_received (absent from template).
    const closed = await svc.transitionInstance(inst.id, { toState: 'closed' });
    expect(closed.instance.state).toBe('closed');
    expect(closed.instance.closedAt).not.toBeNull();
    // closed is terminal: nothing leaves it.
    await expect(svc.transitionInstance(inst.id, { toState: 'preparation' })).rejects.toEqual(
      apiError('conflict'),
    );
  });

  it('mutation-key replay returns already_applied; the same call without a key conflicts', async () => {
    const inst = await svc.createComplianceInstance({
      legalEntityId: 'c-abc-entity',
      complianceTypeId: TYPE_ITR,
      periodStart: '2026-04-01',
      periodEnd: '2027-03-31',
      periodLabel: 'FY 2026-27',
      dueDate: '2027-10-31',
      assigneeMembershipId: 'u-neha',
    });
    const t1 = await svc.transitionInstance(inst.id, {
      toState: 'information_requested',
      mutationKey: 'req-1',
    });
    expect(t1.status).toBe('transitioned');
    // Keyed replay: current row, no error, no second mutation.
    const replay = await svc.transitionInstance(inst.id, {
      toState: 'information_requested',
      mutationKey: 'req-1',
    });
    expect(replay).toMatchObject({
      status: 'already_applied',
      reason: 'already_in_target_state',
    });
    expect(replay.instance.state).toBe('information_requested');
    expect(replay.instance.updatedAt).toBe(t1.instance.updatedAt);
    // Same-state WITHOUT a key is an ordinary invalid transition.
    await expect(
      svc.transitionInstance(inst.id, { toState: 'information_requested' }),
    ).rejects.toEqual(apiError('conflict'));
  });
});
