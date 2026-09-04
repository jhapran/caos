/**
 * IMP-031 — Compliance profiles & instances: FIXTURE adapter (demo track,
 * MIG-DS-06).
 *
 * A deterministic in-memory mirror of the SCH-11/SCH-12 contract, composed
 * on the IMP-020/030 fixture singletons (one fixture truth — entity and
 * registration rows are READ through fixtureClientHierarchy, compliance
 * types through fixtureComplianceRules; this file adds no second copy of
 * either). The seed rows reference the derived hierarchy ids
 * (`<client>-entity`, `<client>-gstin|pan`) and the MIG-SEED-02 catalogue
 * UUIDs. This module never touches the network and never constructs the
 * Supabase client.
 *
 * Fixture role model (documented limit): fixture mode has exactly ONE
 * caller persona — the IMP-014 tenancy demo identity
 * (`demo-fixture-membership`, role 'partner', user `demo-fixture-user`),
 * i.e. firm-wide manager+ scope in the single demo firm. The adapter
 * therefore enforces the contract's BUSINESS semantics — profile
 * lifecycle, approval stamps, DM-27 scope validation (incl. the TDS PAN
 * exception), provenance insert-onlyness, DM-SM-04 transition legality,
 * four-eyes reviewer-exit by membership identity with no rank bypass, and
 * mutation-key replay — but does NOT simulate the RLS-CIN-01 T1
 * role-scoping matrix (manager portfolio / senior-article assigned-only
 * scoping has no second persona to scope against). Membership references
 * are validated against the known fixture roster (TEAM ids + the demo
 * membership, all ACTIVE — SCH-RESP-03 parity, 23503 → conflict).
 *
 * Mutations are module-local and ephemeral (page reload resets them).
 */
import { TEAM } from '@/data/clients';
import { fixtureClientHierarchy } from '@/data/clientHierarchy/fixture';
import { fixtureComplianceRules } from '@/data/complianceRules/fixture';
import { ApiError } from '@/data/errors';

import type {
  ComplianceInstanceRecord,
  ComplianceInstanceState,
  ComplianceInstancesService,
  ComplianceProfileRecord,
  CreateInstanceInput,
  CreateProfileInput,
  InstanceListFilter,
  ProfileListFilter,
  TransitionInstanceInput,
  TransitionInstanceResult,
  UpdateInstanceInput,
  UpdateProfileInput,
} from './types';

const DEMO_FIRM_ID = 'demo-fixture-firm';
const SEED_CREATED_AT = '2026-08-20T00:00:00.000Z';

/** The single fixture caller persona (IMP-014 tenancy fixture identity).
 *  role is typed against the SCH-03 staff vocabulary so the four-eyes /
 *  regression checks below are genuine comparisons, not constants. */
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

// MIG-SEED-02 catalogue ids (same fixed UUIDs as the IMP-030 mirror).
const TYPE_GSTR1 = '50000000-0000-4000-8000-000000000001';
const TYPE_GSTR3B = '50000000-0000-4000-8000-000000000002';
const TYPE_TDS24Q = '50000000-0000-4000-8000-000000000003';
const TYPE_TDS26Q = '50000000-0000-4000-8000-000000000004';
const TYPE_ITR = '50000000-0000-4000-8000-000000000005';

/** Canonical DM-SM-04 pipeline order — the legality baseline. */
const PIPELINE: ComplianceInstanceState[] = [
  'not_started',
  'information_requested',
  'information_received',
  'preparation',
  'internal_review',
  'client_approval',
  'ready_to_file',
  'filed',
  'acknowledgement_received',
  'closed',
];

interface FixtureStore {
  profiles: ComplianceProfileRecord[];
  instances: ComplianceInstanceRecord[];
  sequence: number;
}

let store: FixtureStore | null = null;

function buildStore(): FixtureStore {
  // Minimal deterministic seed set over the existing fixture clients:
  // two ACTIVE profiles (registration-scoped GSTR-1 and entity-scoped
  // ITR for c-abc), two PROPOSED (TDS 24Q on the PAN-substitution path
  // for c-xyz; GSTR-3B for c-pqr). Approval deliberately seeds ZERO
  // instances (C5 ruling) — every seeded instance below is manual/import.
  const profiles: ComplianceProfileRecord[] = [
    {
      id: 'ccp-abc-gstr1',
      firmId: DEMO_FIRM_ID,
      legalEntityId: 'c-abc-entity',
      complianceTypeId: TYPE_GSTR1,
      registrationId: 'c-abc-gstin',
      applicabilityAnswers: { registeredForGst: true },
      status: 'active',
      approvedBy: FIXTURE_CALLER.userId,
      approvedAt: SEED_CREATED_AT,
      createdAt: SEED_CREATED_AT,
      updatedAt: null,
    },
    {
      id: 'ccp-abc-itr',
      firmId: DEMO_FIRM_ID,
      legalEntityId: 'c-abc-entity',
      complianceTypeId: TYPE_ITR,
      registrationId: null,
      applicabilityAnswers: { itrApplies: true },
      status: 'active',
      approvedBy: FIXTURE_CALLER.userId,
      approvedAt: SEED_CREATED_AT,
      createdAt: SEED_CREATED_AT,
      updatedAt: null,
    },
    {
      id: 'ccp-xyz-tds24q',
      firmId: DEMO_FIRM_ID,
      legalEntityId: 'c-xyz-entity',
      complianceTypeId: TYPE_TDS24Q,
      // DM-27 TDS exception: PAN registration substitutes for TAN.
      registrationId: 'c-xyz-pan',
      applicabilityAnswers: { tdsDeductor: true, tanNotAllotted: true },
      status: 'proposed',
      approvedBy: null,
      approvedAt: null,
      createdAt: SEED_CREATED_AT,
      updatedAt: null,
    },
    {
      id: 'ccp-pqr-gstr3b',
      firmId: DEMO_FIRM_ID,
      legalEntityId: 'c-pqr-entity',
      complianceTypeId: TYPE_GSTR3B,
      registrationId: 'c-pqr-gstin',
      applicabilityAnswers: { registeredForGst: true },
      status: 'proposed',
      approvedBy: null,
      approvedAt: null,
      createdAt: SEED_CREATED_AT,
      updatedAt: null,
    },
  ];

  const instances: ComplianceInstanceRecord[] = [
    {
      id: 'cin-abc-gstr1-2026-08',
      firmId: DEMO_FIRM_ID,
      clientId: 'c-abc',
      legalEntityId: 'c-abc-entity',
      complianceTypeId: TYPE_GSTR1,
      registrationId: 'c-abc-gstin',
      clientComplianceProfileId: 'ccp-abc-gstr1',
      engagementId: null,
      periodStart: '2026-08-01',
      periodEnd: '2026-08-31',
      periodLabel: 'Aug 2026',
      periodMeta: null,
      dueDate: '2026-09-11',
      ruleVersionId: null,
      generationSource: 'manual',
      generatedAt: null,
      calculatedDueDate: null,
      state: 'preparation',
      assigneeMembershipId: 'u-rahul',
      reviewerMembershipId: 'u-priya',
      partnerMembershipId: 'u-pranav',
      priority: 'high',
      riskScore: null,
      riskFactors: null,
      filedAt: null,
      closedAt: null,
      successorInstanceId: null,
      createdAt: SEED_CREATED_AT,
      updatedAt: null,
    },
    {
      id: 'cin-abc-itr-fy2025-26',
      firmId: DEMO_FIRM_ID,
      clientId: 'c-abc',
      legalEntityId: 'c-abc-entity',
      complianceTypeId: TYPE_ITR,
      registrationId: null,
      clientComplianceProfileId: 'ccp-abc-itr',
      engagementId: null,
      periodStart: '2025-04-01',
      periodEnd: '2026-03-31',
      periodLabel: 'FY 2025-26',
      periodMeta: null,
      dueDate: '2026-10-31',
      ruleVersionId: null,
      generationSource: 'manual',
      generatedAt: null,
      calculatedDueDate: null,
      state: 'not_started',
      assigneeMembershipId: 'u-neha',
      reviewerMembershipId: 'u-priya',
      partnerMembershipId: 'u-pranav',
      priority: 'normal',
      riskScore: null,
      riskFactors: null,
      filedAt: null,
      closedAt: null,
      successorInstanceId: null,
      createdAt: SEED_CREATED_AT,
      updatedAt: null,
    },
    {
      // Four-eyes case: TDS 24Q sits in internal_review; leaving that
      // state (other than the regression) requires the assigned reviewer
      // membership — the partner caller cannot bypass by rank.
      id: 'cin-xyz-tds24q-q1-fy26-27',
      firmId: DEMO_FIRM_ID,
      clientId: 'c-xyz',
      legalEntityId: 'c-xyz-entity',
      complianceTypeId: TYPE_TDS24Q,
      registrationId: 'c-xyz-pan',
      clientComplianceProfileId: 'ccp-xyz-tds24q',
      engagementId: null,
      periodStart: '2026-04-01',
      periodEnd: '2026-06-30',
      periodLabel: 'Q1 FY 2026-27',
      periodMeta: null,
      dueDate: '2026-07-31',
      ruleVersionId: null,
      generationSource: 'manual',
      generatedAt: null,
      calculatedDueDate: null,
      state: 'internal_review',
      assigneeMembershipId: 'u-rahul',
      reviewerMembershipId: 'u-priya',
      partnerMembershipId: 'u-pranav',
      priority: 'normal',
      riskScore: null,
      riskFactors: null,
      filedAt: null,
      closedAt: null,
      successorInstanceId: null,
      createdAt: SEED_CREATED_AT,
      updatedAt: null,
    },
    {
      // TDS NULL-registration case (instance-only path): no TAN, the
      // statutory exception reason is recorded in period_meta.
      id: 'cin-kaveri-tds26q-q1-fy26-27',
      firmId: DEMO_FIRM_ID,
      clientId: 'c-kaveri',
      legalEntityId: 'c-kaveri-entity',
      complianceTypeId: TYPE_TDS26Q,
      registrationId: null,
      clientComplianceProfileId: null,
      engagementId: null,
      periodStart: '2026-04-01',
      periodEnd: '2026-06-30',
      periodLabel: 'Q1 FY 2026-27',
      periodMeta: {
        tds_pan_exception: 'TAN not allotted — PAN-based TDS deposit (DM-27 exception)',
      },
      dueDate: '2026-07-31',
      ruleVersionId: null,
      generationSource: 'import',
      generatedAt: null,
      calculatedDueDate: null,
      state: 'not_started',
      assigneeMembershipId: 'u-rahul',
      reviewerMembershipId: null,
      partnerMembershipId: null,
      priority: 'normal',
      riskScore: null,
      riskFactors: null,
      filedAt: null,
      closedAt: null,
      successorInstanceId: null,
      createdAt: SEED_CREATED_AT,
      updatedAt: null,
    },
  ];

  return { profiles, instances, sequence: 0 };
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

/** Registration lookup across the whole fixture hierarchy: returns the
 *  row plus its owning entity, or null when the id exists nowhere. */
async function findRegistration(registrationId: string) {
  const clients = await fixtureClientHierarchy.listClients({ includeOffboarded: true });
  for (const client of clients) {
    for (const entity of await fixtureClientHierarchy.listLegalEntities(client.id)) {
      const reg = (await fixtureClientHierarchy.listRegistrations(entity.id)).find(
        (r) => r.id === registrationId,
      );
      if (reg) return reg;
    }
  }
  return null;
}

/**
 * DM-27 scope validation mirror (compliance_scope_validate): same-entity
 * registration, entity-scope NULL rule, registration-class match, and the
 * TDS-only PAN substitution / NULL-with-reason exception (registrationClass
 * 'TAN' is the discriminator — never category text). Unknown references are
 * 23503-parity conflicts; scope mismatches are validation (SCOPE_VIOLATION:
 * stays diagnostic, not a conflict marker).
 */
async function assertScope(
  complianceTypeId: string,
  legalEntityId: string,
  registrationId: string | null,
  periodMeta: Record<string, unknown> | null,
  allowTdsNull: boolean,
): Promise<void> {
  const type = await fixtureComplianceRules.getComplianceType(complianceTypeId);
  if (!type) throw new ApiError('conflict', 'compliance_type_id does not exist');

  let registration: Awaited<ReturnType<typeof findRegistration>> = null;
  if (registrationId !== null) {
    registration = await findRegistration(registrationId);
    if (!registration) throw new ApiError('conflict', 'registration_id does not exist');
    if (registration.legalEntityId !== legalEntityId) {
      throw new ApiError(
        'validation',
        'registration must belong to the same legal entity (DM-27, SCOPE_VIOLATION:registration.legal_entity)',
      );
    }
  }

  if (type.scopeKind === 'entity') {
    if (registrationId !== null) {
      throw new ApiError(
        'validation',
        'scopeKind=entity: registrationId must be null (DM-27, SCOPE_VIOLATION:entity_scope)',
      );
    }
  } else if (type.scopeKind === 'registration') {
    if (registrationId === null) {
      const reason = periodMeta?.tds_pan_exception;
      const hasReason = typeof reason === 'string' && reason.trim() !== '';
      if (!(allowTdsNull && type.registrationClass === 'TAN' && hasReason)) {
        throw new ApiError(
          'validation',
          'scopeKind=registration: registrationId is required (DM-27, SCOPE_VIOLATION:registration_required)',
        );
      }
    } else if (type.registrationClass === 'TAN') {
      if (registration!.type !== 'TAN' && registration!.type !== 'PAN') {
        throw new ApiError(
          'validation',
          'TDS-family scope references a TAN registration, or a PAN registration under the statutory exception (DM-27, SCOPE_VIOLATION:registration_class)',
        );
      }
    } else if (registration!.type !== type.registrationClass) {
      throw new ApiError(
        'validation',
        `registration type ${registration!.type} does not match the compliance type registrationClass (DM-27, SCOPE_VIOLATION:registration_class)`,
      );
    }
  }
  // scopeKind='configurable': either form allowed (same-entity enforced above).
}

/** Assignment validity mirror (cin_validate_assignments): four-eyes
 *  reviewer ≠ assignee where the type requires it (RLS-4EY-01 →
 *  validation); responsibility memberships must be known ACTIVE fixture
 *  memberships (SCH-RESP-03, 23503 parity → conflict). */
async function assertAssignments(
  complianceTypeId: string,
  assignee: string | null,
  reviewer: string | null,
  partner: string | null,
): Promise<void> {
  const type = await fixtureComplianceRules.getComplianceType(complianceTypeId);
  if (type?.fourEyesRequired && assignee !== null && reviewer !== null && assignee === reviewer) {
    throw new ApiError(
      'validation',
      'four-eyes required: reviewerMembershipId must differ from assigneeMembershipId (RLS-4EY-01)',
    );
  }
  for (const [label, id] of [
    ['assigneeMembershipId', assignee],
    ['reviewerMembershipId', reviewer],
    ['partnerMembershipId', partner],
  ] as const) {
    if (id !== null && !FIXTURE_MEMBERSHIPS.has(id)) {
      throw new ApiError('conflict', `${label} must be an ACTIVE membership of the same firm (SCH-RESP-03)`);
    }
  }
}

function templateStates(workflowTemplate: Record<string, unknown>): string[] {
  const states = workflowTemplate.states;
  return Array.isArray(states) ? (states as string[]) : [];
}

const copyProfile = (p: ComplianceProfileRecord): ComplianceProfileRecord => ({
  ...p,
  applicabilityAnswers: p.applicabilityAnswers ? { ...p.applicabilityAnswers } : null,
});

const copyInstance = (i: ComplianceInstanceRecord): ComplianceInstanceRecord => ({
  ...i,
  periodMeta: i.periodMeta ? { ...i.periodMeta } : null,
  riskFactors: i.riskFactors ? { ...i.riskFactors } : null,
});

export const fixtureComplianceInstances: ComplianceInstancesService = {
  mode: 'fixture',

  async listComplianceProfiles(filter?: ProfileListFilter) {
    let rows = state().profiles;
    if (filter?.legalEntityId) rows = rows.filter((p) => p.legalEntityId === filter.legalEntityId);
    if (filter?.complianceTypeId) {
      rows = rows.filter((p) => p.complianceTypeId === filter.complianceTypeId);
    }
    if (filter?.status) rows = rows.filter((p) => p.status === filter.status);
    const offset = filter?.offset ?? 0;
    const end = filter?.limit !== undefined ? offset + filter.limit : undefined;
    return rows.slice(offset, end).map(copyProfile);
  },

  async getComplianceProfile(profileId: string) {
    const found = state().profiles.find((p) => p.id === profileId);
    return found ? copyProfile(found) : null;
  },

  async createComplianceProfile(input: CreateProfileInput) {
    const entity = await fixtureClientHierarchy.getLegalEntity(input.legalEntityId);
    if (!entity) throw new ApiError('conflict', 'legal_entity_id does not exist in this firm');
    await assertScope(
      input.complianceTypeId,
      input.legalEntityId,
      input.registrationId ?? null,
      null, // profiles get NO period_meta NULL path (SCH-11)
      false,
    );
    // One profile per (entity, type, registration) — NULLS NOT DISTINCT.
    const registrationId = input.registrationId ?? null;
    if (
      state().profiles.some(
        (p) =>
          p.legalEntityId === input.legalEntityId &&
          p.complianceTypeId === input.complianceTypeId &&
          p.registrationId === registrationId,
      )
    ) {
      throw new ApiError('conflict', 'a profile already exists for this entity/type/registration');
    }
    const record: ComplianceProfileRecord = {
      id: nextId('compliance-profile'),
      firmId: DEMO_FIRM_ID,
      legalEntityId: input.legalEntityId,
      complianceTypeId: input.complianceTypeId,
      registrationId,
      applicabilityAnswers: input.applicabilityAnswers ? { ...input.applicabilityAnswers } : null,
      status: 'proposed',
      approvedBy: null,
      approvedAt: null,
      createdAt: now(),
      updatedAt: null,
    };
    state().profiles.push(record);
    return copyProfile(record);
  },

  async updateComplianceProfile(profileId: string, patch: UpdateProfileInput) {
    const found = state().profiles.find((p) => p.id === profileId);
    if (!found) throw notFound('Compliance profile', profileId);
    // Runtime parity with the write guard: activation is command-only
    // (the type already excludes 'active'; JS callers can still force it).
    if ((patch as { status?: string }).status === 'active') {
      throw new ApiError(
        'conflict',
        'profile activation only via approveComplianceProfile() (RLS-CCP-01, INVALID_TRANSITION)',
      );
    }
    const registrationId =
      patch.registrationId !== undefined ? patch.registrationId : found.registrationId;
    await assertScope(found.complianceTypeId, found.legalEntityId, registrationId, null, false);
    if (patch.registrationId !== undefined) found.registrationId = patch.registrationId;
    if (patch.applicabilityAnswers !== undefined) {
      found.applicabilityAnswers = patch.applicabilityAnswers
        ? { ...patch.applicabilityAnswers }
        : null;
    }
    if (patch.status !== undefined) found.status = patch.status;
    found.updatedAt = now();
    return copyProfile(found);
  },

  async approveComplianceProfile(profileId: string) {
    const found = state().profiles.find((p) => p.id === profileId);
    if (!found) throw notFound('Compliance profile', profileId);
    // The fixture persona is a partner (manager+, firm-wide): role/scope
    // authorization passes. Only the lifecycle gate remains.
    if (found.status !== 'proposed') {
      throw new ApiError(
        'conflict',
        `only a proposed profile can be approved (current status: ${found.status})`,
      );
    }
    found.status = 'active';
    found.approvedBy = FIXTURE_CALLER.userId;
    found.approvedAt = now();
    found.updatedAt = now();
    // C5 ruling: approval creates ZERO instances (materialization is IMP-050).
    return copyProfile(found);
  },

  async listComplianceInstances(filter?: InstanceListFilter) {
    let rows = state().instances;
    if (filter?.state) rows = rows.filter((i) => i.state === filter.state);
    if (filter?.assigneeMembershipId) {
      rows = rows.filter((i) => i.assigneeMembershipId === filter.assigneeMembershipId);
    }
    if (filter?.dueFrom) rows = rows.filter((i) => i.dueDate >= filter.dueFrom!);
    if (filter?.dueTo) rows = rows.filter((i) => i.dueDate <= filter.dueTo!);
    if (filter?.clientId) rows = rows.filter((i) => i.clientId === filter.clientId);
    if (filter?.legalEntityId) rows = rows.filter((i) => i.legalEntityId === filter.legalEntityId);
    if (filter?.complianceTypeId) {
      rows = rows.filter((i) => i.complianceTypeId === filter.complianceTypeId);
    }
    rows = [...rows].sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    const offset = filter?.offset ?? 0;
    const end = filter?.limit !== undefined ? offset + filter.limit : undefined;
    return rows.slice(offset, end).map(copyInstance);
  },

  async getComplianceInstance(instanceId: string) {
    const found = state().instances.find((i) => i.id === instanceId);
    return found ? copyInstance(found) : null;
  },

  async createComplianceInstance(input: CreateInstanceInput) {
    const entity = await fixtureClientHierarchy.getLegalEntity(input.legalEntityId);
    if (!entity) throw new ApiError('conflict', 'legal_entity_id does not exist in this firm');
    if (input.periodEnd < input.periodStart) {
      throw new ApiError('validation', 'periodEnd must be on or after periodStart (SCH-12)');
    }
    const periodMeta = input.periodMeta ? { ...input.periodMeta } : null;
    await assertScope(
      input.complianceTypeId,
      input.legalEntityId,
      input.registrationId ?? null,
      periodMeta,
      true, // instances get the TDS NULL-with-reason path (SCH-12)
    );
    await assertAssignments(
      input.complianceTypeId,
      input.assigneeMembershipId ?? null,
      input.reviewerMembershipId ?? null,
      input.partnerMembershipId ?? null,
    );
    if (input.clientComplianceProfileId) {
      const profile = state().profiles.find((p) => p.id === input.clientComplianceProfileId);
      if (!profile) throw new ApiError('conflict', 'client_compliance_profile_id does not exist');
    }
    // AUTO-REC-03 layer 3: one instance per obligation per period.
    const registrationId = input.registrationId ?? null;
    if (
      state().instances.some(
        (i) =>
          i.complianceTypeId === input.complianceTypeId &&
          i.legalEntityId === input.legalEntityId &&
          i.registrationId === registrationId &&
          i.periodStart === input.periodStart,
      )
    ) {
      throw new ApiError(
        'conflict',
        'an instance already exists for this obligation and period (AUTO-REC-03)',
      );
    }
    const record: ComplianceInstanceRecord = {
      id: nextId('compliance-instance'),
      firmId: DEMO_FIRM_ID,
      // client_id is DERIVED from the legal entity (SCH-A-02), never input.
      clientId: entity.clientId,
      legalEntityId: input.legalEntityId,
      complianceTypeId: input.complianceTypeId,
      registrationId,
      clientComplianceProfileId: input.clientComplianceProfileId ?? null,
      engagementId: input.engagementId ?? null,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      periodLabel: input.periodLabel,
      periodMeta,
      dueDate: input.dueDate,
      // Browser creation is manual; provenance is never client-settable.
      ruleVersionId: null,
      generationSource: 'manual',
      generatedAt: null,
      calculatedDueDate: null,
      state: 'not_started',
      assigneeMembershipId: input.assigneeMembershipId ?? null,
      reviewerMembershipId: input.reviewerMembershipId ?? null,
      partnerMembershipId: input.partnerMembershipId ?? null,
      priority: input.priority ?? 'normal',
      riskScore: null,
      riskFactors: null,
      filedAt: null,
      closedAt: null,
      successorInstanceId: null,
      createdAt: now(),
      updatedAt: null,
    };
    state().instances.push(record);
    return copyInstance(record);
  },

  async updateComplianceInstance(instanceId: string, patch: UpdateInstanceInput) {
    const found = state().instances.find((i) => i.id === instanceId);
    if (!found) throw notFound('Compliance instance', instanceId);
    const periodMeta =
      patch.periodMeta !== undefined
        ? patch.periodMeta
          ? { ...patch.periodMeta }
          : null
        : found.periodMeta;
    // Scope is re-validated because period_meta is a permitted non-state
    // field and the TDS NULL exception depends on its key.
    await assertScope(
      found.complianceTypeId,
      found.legalEntityId,
      found.registrationId,
      periodMeta,
      true,
    );
    await assertAssignments(
      found.complianceTypeId,
      patch.assigneeMembershipId !== undefined
        ? patch.assigneeMembershipId
        : found.assigneeMembershipId,
      patch.reviewerMembershipId !== undefined
        ? patch.reviewerMembershipId
        : found.reviewerMembershipId,
      patch.partnerMembershipId !== undefined
        ? patch.partnerMembershipId
        : found.partnerMembershipId,
    );
    if (patch.engagementId !== undefined) found.engagementId = patch.engagementId;
    if (patch.periodLabel !== undefined) found.periodLabel = patch.periodLabel;
    if (patch.periodMeta !== undefined) found.periodMeta = periodMeta;
    if (patch.dueDate !== undefined) found.dueDate = patch.dueDate;
    if (patch.assigneeMembershipId !== undefined) found.assigneeMembershipId = patch.assigneeMembershipId;
    if (patch.reviewerMembershipId !== undefined) found.reviewerMembershipId = patch.reviewerMembershipId;
    if (patch.partnerMembershipId !== undefined) found.partnerMembershipId = patch.partnerMembershipId;
    if (patch.priority !== undefined) found.priority = patch.priority;
    found.updatedAt = now();
    return copyInstance(found);
  },

  async transitionInstance(
    instanceId: string,
    input: TransitionInstanceInput,
  ): Promise<TransitionInstanceResult> {
    const found = state().instances.find((i) => i.id === instanceId);
    if (!found) throw notFound('Compliance instance', instanceId);
    const type = await fixtureComplianceRules.getComplianceType(found.complianceTypeId);
    if (!type) {
      throw new ApiError('internal', `compliance type of instance ${instanceId} is missing`);
    }

    const toIdx = PIPELINE.indexOf(input.toState);
    if (toIdx === -1) {
      // CA400 parity: malformed input, not a legality conflict.
      throw new ApiError('validation', `unknown target state '${input.toState}' (DM-SM-04 vocabulary)`);
    }
    const fromIdx = PIPELINE.indexOf(found.state);

    // Idempotent replay (API-MUT-03): keyed repeat against the target state.
    if (found.state === input.toState) {
      if (input.mutationKey) {
        return {
          status: 'already_applied',
          reason: 'already_in_target_state',
          instance: copyInstance(found),
        };
      }
      throw new ApiError('conflict', `instance is already in state ${input.toState}`);
    }

    // Legality (DM-SM-04): forward to the NEXT template state in canonical
    // pipeline order (template states between current and target forbid the
    // jump), or the single regression internal_review → preparation.
    const template = templateStates(type.workflowTemplate);
    const regression = found.state === 'internal_review' && input.toState === 'preparation';
    const legal =
      regression ||
      (template.includes(input.toState) &&
        toIdx > fromIdx &&
        !template.some((s) => {
          const idx = PIPELINE.indexOf(s as ComplianceInstanceState);
          return idx > fromIdx && idx < toIdx;
        }));
    if (!legal) {
      throw new ApiError(
        'conflict',
        `invalid state transition ${found.state} -> ${input.toState} for this compliance type's workflow (DM-SM-04)`,
      );
    }

    // Authorization (RLS-CIN-01 T1): the single fixture persona is a partner
    // — firm-wide scope, so role/scope authorization passes. Manager
    // portfolio and senior/article assigned-only scoping are NOT simulated
    // (documented fixture limit; see module header).
    //
    // Four-eyes overlay (RLS-4EY-01/02): where the type requires it, any
    // transition leaving internal_review (except the regression) must be
    // performed by the assigned reviewer — no rank bypass. A NULL reviewer
    // fail-closes the exit.
    if (
      type.fourEyesRequired &&
      found.state === 'internal_review' &&
      !regression &&
      (found.reviewerMembershipId === null ||
        FIXTURE_CALLER.membershipId !== found.reviewerMembershipId)
    ) {
      throw new ApiError(
        'unauthorized',
        'a transition leaving internal_review must be performed by the assigned reviewer (RLS-4EY-01/02)',
      );
    }
    if (
      regression &&
      (FIXTURE_CALLER.role === 'senior' || FIXTURE_CALLER.role === 'article_executive') &&
      FIXTURE_CALLER.membershipId !== found.reviewerMembershipId
    ) {
      throw new ApiError(
        'unauthorized',
        'regression to preparation requires the assigned reviewer or an in-scope manager+ actor (DM-SM-04)',
      );
    }

    found.state = input.toState;
    if (input.toState === 'filed') found.filedAt = now();
    if (input.toState === 'closed') found.closedAt = now();
    found.updatedAt = now();
    // IMP-050 boundary: NO successor instance is spawned here.
    return {
      status: 'transitioned',
      fromState: PIPELINE[fromIdx],
      toState: input.toState,
      instance: copyInstance(found),
    };
  },
};
