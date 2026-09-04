/**
 * IMP-031 — Compliance profiles & instances: domain types (provider-neutral).
 *
 * Mirror the production schema (SCH-11 / SCH-12, spec 06) one-to-one in the
 * application-facing camelCase shape. A ClientComplianceProfile is the DM-11
 * applicability record (which compliance types apply to which legal entity,
 * CA-approved); a ComplianceInstance is the DM-12 obligation per legal entity
 * per period, moving through the DM-SM-04 ten-state pipeline.
 *
 * Server-controlled fields are never caller input:
 *   - profiles: status starts 'proposed'; activation + approvedBy/approvedAt
 *     are stamped by the approve command only (RLS-CCP-01, DM-11);
 *   - instances: clientId is trigger-derived from the legal entity (SCH-A-02);
 *     state + filedAt/closedAt move only via the transition command
 *     (RLS-CIN-01); recurrence provenance (ruleVersionId, generationSource,
 *     generatedAt, calculatedDueDate) is insert-only (AUTO-REC-07) and never
 *     client-settable — browser-created instances are generation_source
 *     'manual', always ('recurrence' is the IMP-050 generator's lane);
 *     riskScore/riskFactors/successorInstanceId are server-owned (DM-12,
 *     IMP-050).
 */
import type { DataSource } from '@/data/source';

// --- Vocabularies (mirror the CHECK constraints in 20260905000000) ---------

/** DM-11 lifecycle: proposed → active → suspended → ended. */
export type ComplianceProfileStatus = 'proposed' | 'active' | 'suspended' | 'ended';

/** DM-SM-04 ten-state pipeline (canonical order; templates may skip, never reorder). */
export type ComplianceInstanceState =
  | 'not_started'
  | 'information_requested'
  | 'information_received'
  | 'preparation'
  | 'internal_review'
  | 'client_approval'
  | 'ready_to_file'
  | 'filed'
  | 'acknowledgement_received'
  | 'closed';

/** AUTO-REC provenance. 'recurrence' rows come only from the IMP-050
 *  generator; the browser create path is 'manual' and fixture seed rows may
 *  additionally be 'import'. */
export type GenerationSource = 'recurrence' | 'manual' | 'import';

/** Structured applicability answers / period metadata payloads (jsonb). */
export type CompliancePayload = Record<string, unknown>;

// --- Records (read DTOs) ----------------------------------------------------

/** ClientComplianceProfile = the DM-11 applicability record for one legal
 *  entity × compliance type (× optional registration, per DM-27). */
export interface ComplianceProfileRecord {
  id: string;
  firmId: string;
  legalEntityId: string;
  complianceTypeId: string;
  registrationId: string | null;
  applicabilityAnswers: CompliancePayload | null;
  status: ComplianceProfileStatus;
  /** Approval actor IDENTITY (auth user id), command-stamped (SCH-RESP-02). */
  approvedBy: string | null;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string | null;
}

/** ComplianceInstance = one obligation for one legal entity for one period. */
export interface ComplianceInstanceRecord {
  id: string;
  firmId: string;
  /** Denormalized from the legal entity (SCH-A-02); never caller input. */
  clientId: string;
  legalEntityId: string;
  complianceTypeId: string;
  registrationId: string | null;
  clientComplianceProfileId: string | null;
  /** Optional ASSOCIATION only — never the compliance subject (DM-12). */
  engagementId: string | null;
  periodStart: string;
  periodEnd: string;
  periodLabel: string;
  periodMeta: CompliancePayload | null;
  /** The OPERATIVE due date; manager+ may move it (audited). */
  dueDate: string;
  ruleVersionId: string | null;
  generationSource: GenerationSource;
  generatedAt: string | null;
  calculatedDueDate: string | null;
  state: ComplianceInstanceState;
  assigneeMembershipId: string | null;
  reviewerMembershipId: string | null;
  partnerMembershipId: string | null;
  priority: string;
  riskScore: number | null;
  riskFactors: CompliancePayload | null;
  filedAt: string | null;
  closedAt: string | null;
  successorInstanceId: string | null;
  createdAt: string;
  updatedAt: string | null;
}

// --- Write inputs ------------------------------------------------------------

/** Profile proposal (manager+). status/approvedBy/approvedAt are never
 *  caller input: every profile starts 'proposed' and activates only through
 *  the approve command (API-R0-CCP). */
export interface CreateProfileInput {
  legalEntityId: string;
  complianceTypeId: string;
  registrationId?: string | null;
  applicabilityAnswers?: CompliancePayload | null;
}

/**
 * Profile edit (manager+): the correctable registration reference,
 * applicability answers, and NON-ACTIVE status moves only (RLS-CCP-01 —
 * activation is command-gated; passing status 'active' here is a conflict,
 * mirroring the database write guard). Identity/parentage
 * (legalEntityId/complianceTypeId) is insert-only and not patchable.
 */
export interface UpdateProfileInput {
  registrationId?: string | null;
  applicabilityAnswers?: CompliancePayload | null;
  status?: Exclude<ComplianceProfileStatus, 'active'>;
}

/**
 * Manual instance creation (manager+). generation_source is forced 'manual'
 * — 'recurrence' provenance belongs to the IMP-050 generator and provenance
 * fields (ruleVersionId/generatedAt/calculatedDueDate) are never
 * client-settable. clientId, state, filedAt/closedAt, riskScore/riskFactors
 * and successorInstanceId are likewise never caller input.
 */
export interface CreateInstanceInput {
  legalEntityId: string;
  complianceTypeId: string;
  registrationId?: string | null;
  clientComplianceProfileId?: string | null;
  engagementId?: string | null;
  periodStart: string;
  periodEnd: string;
  periodLabel: string;
  periodMeta?: CompliancePayload | null;
  dueDate: string;
  assigneeMembershipId?: string | null;
  reviewerMembershipId?: string | null;
  partnerMembershipId?: string | null;
  priority?: string;
}

/**
 * The permitted NON-STATE instance update set (RLS-CIN-01, manager+):
 * exactly the column-granted set — engagement association, period
 * label/meta, operative due date, the three responsibility memberships,
 * priority. State moves go through transitionInstance only; identity,
 * period bounds, registration and provenance are insert-only.
 */
export interface UpdateInstanceInput {
  engagementId?: string | null;
  periodLabel?: string;
  periodMeta?: CompliancePayload | null;
  dueDate?: string;
  assigneeMembershipId?: string | null;
  reviewerMembershipId?: string | null;
  partnerMembershipId?: string | null;
  priority?: string;
}

/** Controlled transition invocation (API-R0-CIN). mutationKey enables
 *  idempotent replay: a repeat against an instance already in toState
 *  returns status 'already_applied' instead of a conflict (API-MUT-03). */
export interface TransitionInstanceInput {
  toState: ComplianceInstanceState;
  mutationKey?: string;
}

/** Structured result of the transition command. 'already_applied' is a
 *  keyed replay surfacing the current row — NOT an error. */
export interface TransitionInstanceResult {
  status: 'transitioned' | 'already_applied';
  instance: ComplianceInstanceRecord;
  fromState?: ComplianceInstanceState;
  toState?: ComplianceInstanceState;
  /** Machine-readable replay reason (e.g. 'already_in_target_state'). */
  reason?: string;
}

// --- List filters (API-CONV-02 limit/offset pagination) -----------------------

export interface ProfileListFilter {
  legalEntityId?: string;
  complianceTypeId?: string;
  status?: ComplianceProfileStatus;
  limit?: number;
  offset?: number;
}

export interface InstanceListFilter {
  state?: ComplianceInstanceState;
  assigneeMembershipId?: string;
  /** Due window: inclusive bounds on the operative due_date. */
  dueFrom?: string;
  dueTo?: string;
  clientId?: string;
  legalEntityId?: string;
  complianceTypeId?: string;
  limit?: number;
  offset?: number;
}

// --- Service contract (API-R0-CCP + API-R0-CIN) -------------------------------

/**
 * The provider-neutral compliance profiles & instances contract. Two
 * implementations (fixture demo track / Supabase production) sit behind
 * this interface; consumers import `complianceInstancesService` from
 * `@/data` and never know which is active (API-ARCH-02).
 *
 * Error semantics (API-ERR-01/02/04):
 *   - collection reads return [] when nothing is visible — never an error
 *     (RLS silent omission);
 *   - single-resource reads return null for nonexistent AND inaccessible
 *     ids alike (no existence oracle);
 *   - writes/commands against unknown/inaccessible ids throw
 *     ApiError('not_found');
 *   - role/scope/context/four-eyes denials throw ApiError('unauthorized')
 *     (CA401 from the Layer-B commands);
 *   - rejected input — unknown target state, invalid period, DM-27 scope
 *     violations, four-eyes reviewer=assignee — throws
 *     ApiError('validation') (CA400 / plain 23514, incl. the diagnostic
 *     SCOPE_VIOLATION:/FOUR_EYES: detail tokens);
 *   - legality/immutability/identity violations — invalid DM-SM-04
 *     transitions (machine-readable reason in the message), insert-only
 *     field movement, duplicate obligation/period keys — throw
 *     ApiError('conflict') (CA402 / INVALID_TRANSITION:/IMMUTABLE_FIELD:
 *     23514 / 23505 / 23503);
 *   - there is NO delete anywhere, and NO way to set instance state,
 *     approval stamps, or provenance outside the two Layer-B commands.
 */
export interface ComplianceInstancesService {
  readonly mode: DataSource;

  listComplianceProfiles(filter?: ProfileListFilter): Promise<ComplianceProfileRecord[]>;
  getComplianceProfile(profileId: string): Promise<ComplianceProfileRecord | null>;
  createComplianceProfile(input: CreateProfileInput): Promise<ComplianceProfileRecord>;
  updateComplianceProfile(
    profileId: string,
    patch: UpdateProfileInput,
  ): Promise<ComplianceProfileRecord>;

  /**
   * Controlled Layer-B approval command (NOT an ordinary update): proposed
   * → active, stamping approvedBy/approvedAt (DM-11, RLS-CCP-01). Manager+
   * in scope; NO AAL2 step-up (business approval, RLS-AAL-02). Approving
   * creates ZERO compliance instances — materialization is the IMP-050
   * recurrence generator (C5 ruling, AUTO-REC-01).
   */
  approveComplianceProfile(profileId: string): Promise<ComplianceProfileRecord>;

  listComplianceInstances(filter?: InstanceListFilter): Promise<ComplianceInstanceRecord[]>;
  getComplianceInstance(instanceId: string): Promise<ComplianceInstanceRecord | null>;
  createComplianceInstance(input: CreateInstanceInput): Promise<ComplianceInstanceRecord>;
  updateComplianceInstance(
    instanceId: string,
    patch: UpdateInstanceInput,
  ): Promise<ComplianceInstanceRecord>;

  /**
   * Controlled Layer-B transition command — the ONLY state-change path
   * (RLS-CIN-01, API-ARCH-04). DM-SM-04 legality is derived from the
   * compliance type's workflow template over the canonical pipeline
   * (forward to the next template state; the only regression is
   * internal_review → preparation). Authorization per the RLS-CIN-01 T1
   * matrix plus the four-eyes overlay (RLS-4EY-01/02: exits from
   * internal_review other than the regression are performed by the
   * assigned reviewer — no rank bypass). filedAt/closedAt are stamped on
   * → filed / → closed. No successor instance is spawned (IMP-050).
   */
  transitionInstance(
    instanceId: string,
    input: TransitionInstanceInput,
  ): Promise<TransitionInstanceResult>;
}
