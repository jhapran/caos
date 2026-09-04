/**
 * IMP-030 — Compliance types & rule versions: FIXTURE adapter (demo track,
 * MIG-DS-06).
 *
 * A deterministic in-memory mirror of the MIG-SEED-02 reference catalogue
 * (the SAME fixed UUIDs as supabase/seed.sql) plus firm-owned demo rows for
 * the demo firm. This module never touches the network and never constructs
 * the Supabase client; it does not import the legacy demo fixtures (the
 * catalogue mirror below is the single fixture truth for this contract).
 *
 * Governance parity (R0 closure 2026-09-03): the catalogue mirrors the
 * statutory classifications exactly; all seeded versions stay
 * draft + pending/not_required — NO fake statutory ACTIVE content is ever
 * served (the production gate would forbid it; the demo must not pretend
 * otherwise). The fixture activation command mirrors the Layer-B semantics
 * (firm-owned only, draft only, statutory approval gate derived from the
 * parent type, SCH-32 succession window closure, overlap conflict) so demo
 * behavior matches the production contract.
 *
 * Mutations are module-local and ephemeral (page reload resets them).
 */
import { ApiError } from '@/data/errors';

import type {
  ActivateRuleVersionResult,
  ComplianceRuleVersionRecord,
  ComplianceRulesService,
  ComplianceTypeListFilter,
  ComplianceTypeRecord,
  CreateComplianceTypeInput,
  CreateRuleVersionInput,
  RuleVersionListFilter,
  UpdateComplianceTypeInput,
  UpdateRuleVersionDraftInput,
} from './types';

const DEMO_FIRM_ID = 'demo-fixture-firm';
const SEED_CREATED_AT = '2026-04-01T00:00:00.000Z';

const FULL_WORKFLOW = {
  states: [
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
  ],
} as const;

/** One row of the MIG-SEED-02 catalogue mirror (see supabase/seed.sql). */
interface SeedSpec {
  seq: number;
  typeKey: string;
  name: string;
  category: string;
  authority: string | null;
  frequency: ComplianceTypeRecord['frequency'];
  dueDescription: string;
  scopeKind: ComplianceTypeRecord['scopeKind'];
  registrationClass: string | null;
  statutory: boolean;
  clientApproval?: boolean;
}

const SEED_CATALOGUE: SeedSpec[] = [
  { seq: 0x01, typeKey: 'gstr1', name: 'GSTR-1 (Outward Supplies)', category: 'GST', authority: 'GSTN', frequency: 'monthly', dueDescription: '11th of following month', scopeKind: 'registration', registrationClass: 'GSTIN', statutory: true, clientApproval: true },
  { seq: 0x02, typeKey: 'gstr3b', name: 'GSTR-3B (Summary Return)', category: 'GST', authority: 'GSTN', frequency: 'monthly', dueDescription: '20th of following month', scopeKind: 'registration', registrationClass: 'GSTIN', statutory: true, clientApproval: true },
  { seq: 0x03, typeKey: 'tds24q', name: 'TDS Return 24Q (Salaries)', category: 'TDS', authority: 'Income Tax Department', frequency: 'quarterly', dueDescription: '31st of month following quarter', scopeKind: 'registration', registrationClass: 'TAN', statutory: true, clientApproval: true },
  { seq: 0x04, typeKey: 'tds26q', name: 'TDS Return 26Q (Non-salary)', category: 'TDS', authority: 'Income Tax Department', frequency: 'quarterly', dueDescription: '31st of month following quarter', scopeKind: 'registration', registrationClass: 'TAN', statutory: true, clientApproval: true },
  { seq: 0x05, typeKey: 'itr', name: 'Income Tax Return', category: 'Income Tax', authority: 'Income Tax Department', frequency: 'annual', dueDescription: '31 Oct (audit) / 31 Jul (non-audit)', scopeKind: 'entity', registrationClass: null, statutory: true, clientApproval: true },
  { seq: 0x06, typeKey: 'advance-tax', name: 'Advance Tax Instalment', category: 'Income Tax', authority: 'Income Tax Department', frequency: 'quarterly', dueDescription: '15 Jun / 15 Sep / 15 Dec / 15 Mar', scopeKind: 'entity', registrationClass: null, statutory: true, clientApproval: true },
  { seq: 0x07, typeKey: 'tax-audit', name: 'Tax Audit (44AB)', category: 'Audit', authority: 'Income Tax Department', frequency: 'annual', dueDescription: '30 Sep following FY', scopeKind: 'entity', registrationClass: null, statutory: true, clientApproval: true },
  { seq: 0x08, typeKey: 'stat-audit', name: 'Statutory Audit', category: 'Audit', authority: 'MCA / applicable statute', frequency: 'annual', dueDescription: 'Within 6 months of FY end (AGM)', scopeKind: 'entity', registrationClass: null, statutory: true, clientApproval: true },
  { seq: 0x09, typeKey: 'mca-aoc4', name: 'MCA AOC-4 (Financial Statements)', category: 'ROC/MCA', authority: 'MCA', frequency: 'annual', dueDescription: '30 days from AGM', scopeKind: 'entity', registrationClass: null, statutory: true, clientApproval: true },
  { seq: 0x0a, typeKey: 'mca-mgt7', name: 'MCA MGT-7 (Annual Return)', category: 'ROC/MCA', authority: 'MCA', frequency: 'annual', dueDescription: '60 days from AGM', scopeKind: 'entity', registrationClass: null, statutory: true, clientApproval: true },
  { seq: 0x0b, typeKey: 'pt', name: 'Professional Tax', category: 'Professional Tax', authority: 'State commercial tax authority', frequency: 'custom', dueDescription: 'State/jurisdiction-specific schedule (no single nationwide PT rule modelled, DM-27)', scopeKind: 'registration', registrationClass: 'PT', statutory: true, clientApproval: true },
  { seq: 0x0c, typeKey: 'pf', name: 'PF Return', category: 'PF', authority: 'EPFO', frequency: 'monthly', dueDescription: '15th of following month', scopeKind: 'registration', registrationClass: 'PF', statutory: true, clientApproval: true },
  { seq: 0x0d, typeKey: 'esi', name: 'ESI Return', category: 'ESI', authority: 'ESIC', frequency: 'monthly', dueDescription: '15th of following month', scopeKind: 'registration', registrationClass: 'ESI', statutory: true, clientApproval: true },
  { seq: 0x0e, typeKey: 'certificate-custom', name: 'Certificates / Custom Recurring', category: 'Certificates', authority: null, frequency: 'custom', dueDescription: 'Per configured schedule', scopeKind: 'configurable', registrationClass: null, statutory: false, clientApproval: false },
];

const typeId = (s: SeedSpec) =>
  `50000000-0000-4000-8000-0000000000${s.seq.toString(16).padStart(2, '0')}`;
const versionId = (s: SeedSpec) =>
  `50000000-0000-4000-8000-0000000001${s.seq.toString(16).padStart(2, '0')}`;

const seedDueRule = (s: SeedSpec) => ({
  description: s.dueDescription,
  provenance: s.registrationClass === null && s.statutory === false ? 'architecture-matrix' : 'fixture-demo-mapping',
  statutoryValidation: s.statutory ? 'pending-external-ca-signoff' : 'not-applicable',
});

interface FixtureStore {
  types: ComplianceTypeRecord[];
  versions: ComplianceRuleVersionRecord[];
  sequence: number;
}

let store: FixtureStore | null = null;

function buildStore(): FixtureStore {
  const types: ComplianceTypeRecord[] = SEED_CATALOGUE.map((s) => ({
    id: typeId(s),
    firmId: null,
    typeKey: s.typeKey,
    name: s.name,
    category: s.category,
    authority: s.authority,
    frequency: s.frequency,
    dueRule: seedDueRule(s),
    applicability: null,
    requiredDocuments: null,
    checklistTemplate: null,
    workflowTemplate: { ...FULL_WORKFLOW, states: [...FULL_WORKFLOW.states] },
    clientApprovalRequired: s.clientApproval ?? false,
    filingConfirmationRequired: true,
    acknowledgementRequired: true,
    fourEyesRequired: true,
    scopeKind: s.scopeKind,
    registrationClass: s.registrationClass,
    governanceClass: s.statutory ? 'statutory' : 'non_statutory',
    status: 'active',
    createdAt: SEED_CREATED_AT,
    updatedAt: null,
  }));
  const versions: ComplianceRuleVersionRecord[] = SEED_CATALOGUE.map((s) => ({
    id: versionId(s),
    firmId: null,
    complianceTypeId: typeId(s),
    version: 1,
    effectiveFrom: '2026-04-01',
    effectiveTo: null,
    frequency: s.frequency,
    dueRule: seedDueRule(s),
    status: 'draft',
    domainApprovalStatus: s.statutory ? 'pending' : 'not_required',
    createdBy: null,
    createdAt: SEED_CREATED_AT,
  }));
  return { types, versions, sequence: 0 };
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

/** SCH-10 governance inheritance: an override of a system type_key must
 *  carry the system row's governance_class. */
function assertGovernanceInheritance(input: CreateComplianceTypeInput): void {
  const system = state().types.find((t) => t.firmId === null && t.typeKey === input.typeKey);
  if (system && system.governanceClass !== input.governanceClass) {
    throw new ApiError(
      'conflict',
      `Firm override of system compliance type ${input.typeKey} must inherit governanceClass=${system.governanceClass}`,
    );
  }
  if (!system && input.governanceClass === undefined) {
    throw new ApiError('validation', 'governanceClass is required (fail-closed, SCH-10)');
  }
}

/** SCH-32 window validity: half-open, strictly greater when bounded. */
function assertWindowValid(effectiveFrom: string, effectiveTo: string | null | undefined): void {
  if (effectiveTo != null && effectiveTo <= effectiveFrom) {
    throw new ApiError('validation', 'effectiveTo must be strictly greater than effectiveFrom');
  }
}

/** Half-open overlap test: [aFrom,aTo) vs [bFrom,bTo). */
function windowsOverlap(
  aFrom: string,
  aTo: string | null,
  bFrom: string,
  bTo: string | null,
): boolean {
  return aFrom < (bTo ?? '9999-12-31') && bFrom < (aTo ?? '9999-12-31');
}

const copyType = (t: ComplianceTypeRecord): ComplianceTypeRecord => ({
  ...t,
  dueRule: { ...t.dueRule },
  workflowTemplate: { ...t.workflowTemplate },
});
const copyVersion = (v: ComplianceRuleVersionRecord): ComplianceRuleVersionRecord => ({
  ...v,
  dueRule: { ...v.dueRule },
});

export const fixtureComplianceRules: ComplianceRulesService = {
  mode: 'fixture',

  async listComplianceTypes(filter?: ComplianceTypeListFilter) {
    let rows = state().types;
    if (filter?.category) rows = rows.filter((t) => t.category === filter.category);
    if (filter?.status) rows = rows.filter((t) => t.status === filter.status);
    const offset = filter?.offset ?? 0;
    const end = filter?.limit !== undefined ? offset + filter.limit : undefined;
    return rows.slice(offset, end).map(copyType);
  },

  async getComplianceType(typeId: string) {
    const found = state().types.find((t) => t.id === typeId);
    return found ? copyType(found) : null;
  },

  async createComplianceType(input: CreateComplianceTypeInput) {
    assertGovernanceInheritance(input);
    // One override per firm per type_key (SCH-10 NULL-firm semantics):
    // system-default rows (firmId null) never collide with firm rows.
    if (state().types.some((t) => t.typeKey === input.typeKey && t.firmId === DEMO_FIRM_ID)) {
      throw new ApiError('conflict', `compliance type key ${input.typeKey} already exists for this firm`);
    }
    const record: ComplianceTypeRecord = {
      id: nextId('compliance-type'),
      firmId: DEMO_FIRM_ID,
      typeKey: input.typeKey,
      name: input.name,
      category: input.category,
      authority: input.authority ?? null,
      frequency: input.frequency,
      dueRule: { ...input.dueRule },
      applicability: input.applicability ?? null,
      requiredDocuments: input.requiredDocuments ?? null,
      checklistTemplate: input.checklistTemplate ?? null,
      workflowTemplate: { ...input.workflowTemplate },
      clientApprovalRequired: input.clientApprovalRequired ?? false,
      filingConfirmationRequired: input.filingConfirmationRequired ?? true,
      acknowledgementRequired: input.acknowledgementRequired ?? true,
      fourEyesRequired: input.fourEyesRequired ?? true,
      scopeKind: input.scopeKind ?? 'configurable',
      registrationClass: input.registrationClass ?? null,
      governanceClass: input.governanceClass,
      status: 'active',
      createdAt: now(),
      updatedAt: null,
    };
    state().types.push(record);
    return copyType(record);
  },

  async updateComplianceType(typeId: string, patch: UpdateComplianceTypeInput) {
    const found = state().types.find((t) => t.id === typeId);
    if (!found) throw notFound('Compliance type', typeId);
    if (found.firmId === null) {
      throw new ApiError('unauthorized', 'system-default compliance types are read-only (TEN-08)');
    }
    if (patch.scopeKind !== undefined || patch.registrationClass !== undefined) {
      const scopeKind = patch.scopeKind ?? found.scopeKind;
      const registrationClass =
        patch.registrationClass !== undefined ? patch.registrationClass : found.registrationClass;
      if (scopeKind === 'registration' && !registrationClass) {
        throw new ApiError('validation', 'registrationClass is required when scopeKind=registration');
      }
    }
    const { status: patchStatus, ...rest } = patch;
    Object.assign(found, rest, patchStatus !== undefined ? { status: patchStatus } : {}, {
      updatedAt: now(),
    });
    return copyType(found);
  },

  async listRuleVersions(filter?: RuleVersionListFilter) {
    let rows = state().versions;
    if (filter?.complianceTypeId) rows = rows.filter((v) => v.complianceTypeId === filter.complianceTypeId);
    if (filter?.status) rows = rows.filter((v) => v.status === filter.status);
    rows = [...rows].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
    const offset = filter?.offset ?? 0;
    const end = filter?.limit !== undefined ? offset + filter.limit : undefined;
    return rows.slice(offset, end).map(copyVersion);
  },

  async getRuleVersion(versionIdArg: string) {
    const found = state().versions.find((v) => v.id === versionIdArg);
    return found ? copyVersion(found) : null;
  },

  async createRuleVersion(input: CreateRuleVersionInput) {
    const parent = state().types.find((t) => t.id === input.complianceTypeId);
    if (!parent) throw notFound('Compliance type', input.complianceTypeId);
    if (
      state().versions.some(
        (v) => v.complianceTypeId === input.complianceTypeId && v.version === input.version,
      )
    ) {
      throw new ApiError('conflict', `version ${input.version} already exists for this type`);
    }
    const record: ComplianceRuleVersionRecord = {
      id: nextId('rule-version'),
      // Firm scope inherited from the parent type (SCH-32); approval state
      // derived from the parent governance (never caller input). effectiveTo
      // is class-B lifecycle metadata — always NULL at creation; only the
      // activation/succession command sets it.
      firmId: parent.firmId,
      complianceTypeId: input.complianceTypeId,
      version: input.version,
      effectiveFrom: input.effectiveFrom,
      effectiveTo: null,
      frequency: input.frequency,
      dueRule: { ...input.dueRule },
      status: 'draft',
      domainApprovalStatus: parent.governanceClass === 'statutory' ? 'pending' : 'not_required',
      createdBy: null,
      createdAt: now(),
    };
    state().versions.push(record);
    return copyVersion(record);
  },

  async updateRuleVersionDraft(versionIdArg: string, patch: UpdateRuleVersionDraftInput) {
    const found = state().versions.find((v) => v.id === versionIdArg);
    if (!found) throw notFound('Rule version', versionIdArg);
    // SCH-32 class A: rule content is frozen once the version leaves draft.
    if (found.status !== 'draft') {
      throw new ApiError('conflict', 'rule-content fields are frozen once the version leaves draft (SCH-32)');
    }
    const effectiveFrom = patch.effectiveFrom ?? found.effectiveFrom;
    assertWindowValid(effectiveFrom, found.effectiveTo);
    if (patch.effectiveFrom !== undefined) found.effectiveFrom = patch.effectiveFrom;
    if (patch.frequency !== undefined) found.frequency = patch.frequency;
    if (patch.dueRule !== undefined) found.dueRule = { ...patch.dueRule };
    return copyVersion(found);
  },

  async activateRuleVersion(versionIdArg: string): Promise<ActivateRuleVersionResult> {
    const found = state().versions.find((v) => v.id === versionIdArg);
    if (!found) throw notFound('Rule version', versionIdArg);
    // System-default activation is the deferred operator path (TEN-08).
    if (found.firmId === null) {
      throw new ApiError(
        'unauthorized',
        'system-default rule versions are not activatable by application roles (TEN-08)',
      );
    }
    if (found.status !== 'draft') {
      throw new ApiError('conflict', `only a draft version can be activated (current status: ${found.status})`);
    }
    const parent = state().types.find((t) => t.id === found.complianceTypeId);
    // Statutory gate derived from the trusted parent type — never caller input.
    if (parent?.governanceClass === 'statutory' && found.domainApprovalStatus !== 'approved') {
      throw new ApiError(
        'conflict',
        'statutory rule version requires domainApprovalStatus=approved (SCH-32 gate, DM-OQ-01)',
      );
    }
    // Succession: close the predecessor's WINDOW, never its status.
    const predecessor =
      state().versions.find(
        (v) =>
          v.complianceTypeId === found.complianceTypeId &&
          v.status === 'active' &&
          v.effectiveFrom < found.effectiveFrom &&
          (v.effectiveTo === null || v.effectiveTo > found.effectiveFrom),
      ) ?? null;
    const overlap = state().versions.some(
      (v) =>
        v.complianceTypeId === found.complianceTypeId &&
        v.status === 'active' &&
        v.id !== found.id &&
        v.id !== predecessor?.id &&
        windowsOverlap(v.effectiveFrom, v.effectiveTo, found.effectiveFrom, found.effectiveTo),
    );
    if (overlap) {
      throw new ApiError('conflict', 'effective window overlaps another active version (SCH-32)');
    }
    if (predecessor) predecessor.effectiveTo = found.effectiveFrom;
    found.status = 'active';
    return {
      version: copyVersion(found),
      predecessor: predecessor ? copyVersion(predecessor) : null,
    };
  },
};
