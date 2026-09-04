/**
 * IMP-030 — Compliance types & rule versions: domain types (provider-neutral).
 *
 * Mirror the production schema (SCH-10 / SCH-32, spec 06) one-to-one in the
 * application-facing camelCase shape. A ComplianceType describes WHAT the
 * obligation is (DM-10); a rule version captures WHICH exact rule applies
 * for a governed window (SCH-32 — immutable, effective-dated, half-open
 * windows [effectiveFrom, effectiveTo)).
 *
 * Governance: governanceClass is the single authoritative statutory
 * classification (server-controlled, fail-closed); domainApprovalStatus is
 * server-derived/stamped — callers can never supply or mutate either
 * (RLS-CRV-02/03, OPS-OQ-04).
 */
import type { DataSource } from '@/data/source';

// --- Vocabularies (mirror the CHECK constraints in 20260904000000) ---------

export type ComplianceFrequency = 'monthly' | 'quarterly' | 'annual' | 'event' | 'custom';

export type ComplianceScopeKind = 'entity' | 'registration' | 'configurable';

/** Fail-closed statutory classification — no default, never caller-derived. */
export type GovernanceClass = 'statutory' | 'non_statutory';

export type ComplianceTypeStatus = 'active' | 'deprecated';

/** SCH-32 lifecycle. superseded/deprecated are terminal states for versions
 *  that NEVER governed a period; a version that governed stays 'active' for
 *  its historical window forever (succession closes windows, not status). */
export type RuleVersionStatus = 'draft' | 'active' | 'superseded' | 'deprecated';

/** Server-controlled governance state; no browser-facing mutation path. */
export type DomainApprovalStatus = 'not_required' | 'pending' | 'approved';

/** Structured rule payload (SCH-10/32 due_rule / template columns). */
export type RulePayload = Record<string, unknown>;

// --- Records (read DTOs) ----------------------------------------------------

/** ComplianceType = the obligation definition (system default or firm-owned). */
export interface ComplianceTypeRecord {
  id: string;
  /** NULL = system default (read-only to application roles, TEN-08). */
  firmId: string | null;
  typeKey: string;
  name: string;
  category: string;
  authority: string | null;
  frequency: ComplianceFrequency;
  dueRule: RulePayload;
  applicability: RulePayload | null;
  requiredDocuments: unknown[] | null;
  checklistTemplate: unknown[] | null;
  workflowTemplate: RulePayload;
  clientApprovalRequired: boolean;
  filingConfirmationRequired: boolean;
  acknowledgementRequired: boolean;
  fourEyesRequired: boolean;
  scopeKind: ComplianceScopeKind;
  registrationClass: string | null;
  governanceClass: GovernanceClass;
  status: ComplianceTypeStatus;
  createdAt: string;
  updatedAt: string | null;
}

/** Rule version = the immutable effective-dated rule for a type. */
export interface ComplianceRuleVersionRecord {
  id: string;
  /** Inherited from the parent type (SCH-32); NULL = system default. */
  firmId: string | null;
  complianceTypeId: string;
  version: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  frequency: ComplianceFrequency;
  dueRule: RulePayload;
  status: RuleVersionStatus;
  domainApprovalStatus: DomainApprovalStatus;
  createdBy: string | null;
  createdAt: string;
}

// --- Write inputs ------------------------------------------------------------

/**
 * Firm override / custom type creation (super_admin/partner, AAL2).
 * governanceClass is mandatory (fail-closed) and must equal the inherited
 * classification when typeKey matches a system default (SCH-10 inheritance).
 */
export interface CreateComplianceTypeInput {
  typeKey: string;
  name: string;
  category: string;
  authority?: string | null;
  frequency: ComplianceFrequency;
  dueRule: RulePayload;
  applicability?: RulePayload | null;
  requiredDocuments?: unknown[] | null;
  checklistTemplate?: unknown[] | null;
  workflowTemplate: RulePayload;
  clientApprovalRequired?: boolean;
  filingConfirmationRequired?: boolean;
  acknowledgementRequired?: boolean;
  fourEyesRequired?: boolean;
  scopeKind?: ComplianceScopeKind;
  registrationClass?: string | null;
  governanceClass: GovernanceClass;
}

/** typeKey and governanceClass are insert-time identity — never mutable. */
export type UpdateComplianceTypeInput = Partial<
  Omit<CreateComplianceTypeInput, 'typeKey' | 'governanceClass'>
> & { status?: ComplianceTypeStatus };

/** Firm-owned draft version creation (super_admin/partner, AAL2). firmId,
 *  status, domainApprovalStatus and createdBy are never caller input;
 *  effectiveTo is SCH-32 class-B lifecycle metadata — set only by the
 *  controlled activation/succession command, never at draft creation. */
export interface CreateRuleVersionInput {
  complianceTypeId: string;
  version: number;
  effectiveFrom: string;
  frequency: ComplianceFrequency;
  dueRule: RulePayload;
}

/** Draft-edit payload only (SCH-32 class A while draft). Lifecycle metadata
 *  (status/effectiveTo) is never mutable through ordinary update. */
export type UpdateRuleVersionDraftInput = Partial<
  Pick<CreateRuleVersionInput, 'effectiveFrom' | 'frequency' | 'dueRule'>
>;

/** Result of the controlled activation command (API-R0-CRV activate). */
export interface ActivateRuleVersionResult {
  version: ComplianceRuleVersionRecord;
  /** The window-closed predecessor, when succession applied (still active
   *  for its historical window — never superseded by succession). */
  predecessor: ComplianceRuleVersionRecord | null;
}

// --- List filters --------------------------------------------------------------

export interface ComplianceTypeListFilter {
  category?: string;
  status?: ComplianceTypeStatus;
  limit?: number;
  offset?: number;
}

export interface RuleVersionListFilter {
  complianceTypeId?: string;
  status?: RuleVersionStatus;
  limit?: number;
  offset?: number;
}

// --- Service contract (API-R0-CTY + API-R0-CRV) --------------------------------

/**
 * The provider-neutral compliance-catalogue contract. Two implementations
 * (fixture demo track / Supabase production) sit behind this interface;
 * consumers import `complianceRulesService` from `@/data` and never know
 * which is active (API-ARCH-02).
 *
 * Error semantics (API-ERR-01/02):
 *   - collection reads return [] when nothing is visible — never an error;
 *   - single-resource reads return null for nonexistent AND inaccessible
 *     ids alike (no existence oracle);
 *   - writes to unknown/inaccessible ids throw ApiError('not_found');
 *   - role/scope/context denials throw ApiError('unauthorized');
 *   - immutability / lifecycle / governance-inheritance / activation-gate
 *     violations throw ApiError('conflict');
 *   - rejected input (bad frequency, invalid window, bad template) throws
 *     ApiError('validation');
 *   - there is NO delete and NO approval-status mutation anywhere.
 */
export interface ComplianceRulesService {
  readonly mode: DataSource;

  /** Merged catalogue read: system defaults + active-firm overrides (TEN-07). */
  listComplianceTypes(filter?: ComplianceTypeListFilter): Promise<ComplianceTypeRecord[]>;
  getComplianceType(typeId: string): Promise<ComplianceTypeRecord | null>;
  createComplianceType(input: CreateComplianceTypeInput): Promise<ComplianceTypeRecord>;
  updateComplianceType(
    typeId: string,
    patch: UpdateComplianceTypeInput,
  ): Promise<ComplianceTypeRecord>;

  listRuleVersions(filter?: RuleVersionListFilter): Promise<ComplianceRuleVersionRecord[]>;
  getRuleVersion(versionId: string): Promise<ComplianceRuleVersionRecord | null>;
  createRuleVersion(input: CreateRuleVersionInput): Promise<ComplianceRuleVersionRecord>;
  updateRuleVersionDraft(
    versionId: string,
    patch: UpdateRuleVersionDraftInput,
  ): Promise<ComplianceRuleVersionRecord>;

  /**
   * Controlled Layer-B lifecycle command (NOT an ordinary update):
   * firm-owned draft → active with SCH-32 succession. Requires
   * super_admin/partner + AAL2 + active-firm match; the statutory approval
   * gate derives from the parent type's governanceClass. System-default
   * versions are rejected (deferred operator path). Denials are audited
   * (AUD-FAIL-01) and surface as unauthorized/conflict.
   */
  activateRuleVersion(versionId: string): Promise<ActivateRuleVersionResult>;
}
