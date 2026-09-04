/**
 * IMP-030 — Compliance types & rule versions: SUPABASE adapter (production).
 *
 * Plain PostgREST reads/writes under RLS (API-ARCH-03) for the row-shaped
 * operations; the ONLY RPC is activate_compliance_rule_version(), the
 * controlled Layer-B lifecycle command (API-R0-CRV activate). Authorization
 * is decided by the database on every statement (DEC-J, RLS-MECH-01); the
 * active-firm header (injected by the browser client from @/data/context)
 * is selector context only.
 *
 * The adapter never sends status / domain_approval_status / created_by on
 * writes — those columns are server-controlled (derived/stamped/stamped
 * respectively). The activation command returns a structured result:
 * deliberate denials arrive as { status: 'denied', kind, message } (the
 * denial audit row is already persisted server-side, AUD-FAIL-01) and are
 * mapped onto the API-ERR-01 taxonomy here.
 *
 * Errors are translated once through toApiError() — no Supabase SDK or
 * PostgREST types cross this boundary (API-ARCH-01/02, API-ERR-01).
 */
import { getActiveFirm } from '@/data/context';
import { ApiError, toApiError, type ApiErrorKind } from '@/data/errors';
import { getSupabaseClient } from '@/lib/supabaseClient';

import type {
  ComplianceRuleVersionRecord,
  ComplianceRulesService,
  ComplianceTypeRecord,
  DomainApprovalStatus,
} from './types';

// --- Row shapes (snake_case, exactly the SCH-10/SCH-32 columns) --------------

interface ComplianceTypeRow {
  id: string;
  firm_id: string | null;
  type_key: string;
  name: string;
  category: string;
  authority: string | null;
  frequency: ComplianceTypeRecord['frequency'];
  due_rule: Record<string, unknown>;
  applicability: Record<string, unknown> | null;
  required_documents: unknown[] | null;
  checklist_template: unknown[] | null;
  workflow_template: Record<string, unknown>;
  client_approval_required: boolean;
  filing_confirmation_required: boolean;
  acknowledgement_required: boolean;
  four_eyes_required: boolean;
  scope_kind: ComplianceTypeRecord['scopeKind'];
  registration_class: string | null;
  governance_class: ComplianceTypeRecord['governanceClass'];
  status: ComplianceTypeRecord['status'];
  created_at: string;
  updated_at: string | null;
}

interface RuleVersionRow {
  id: string;
  firm_id: string | null;
  compliance_type_id: string;
  version: number;
  effective_from: string;
  effective_to: string | null;
  frequency: ComplianceRuleVersionRecord['frequency'];
  due_rule: Record<string, unknown>;
  status: ComplianceRuleVersionRecord['status'];
  domain_approval_status: DomainApprovalStatus;
  created_by: string | null;
  created_at: string;
}

// --- Column projections and mappers ------------------------------------------

const TYPE_COLUMNS =
  'id, firm_id, type_key, name, category, authority, frequency, due_rule, ' +
  'applicability, required_documents, checklist_template, workflow_template, ' +
  'client_approval_required, filing_confirmation_required, acknowledgement_required, ' +
  'four_eyes_required, scope_kind, registration_class, governance_class, status, ' +
  'created_at, updated_at';

const VERSION_COLUMNS =
  'id, firm_id, compliance_type_id, version, effective_from, effective_to, ' +
  'frequency, due_rule, status, domain_approval_status, created_by, created_at';

const toType = (r: ComplianceTypeRow): ComplianceTypeRecord => ({
  id: r.id,
  firmId: r.firm_id,
  typeKey: r.type_key,
  name: r.name,
  category: r.category,
  authority: r.authority,
  frequency: r.frequency,
  dueRule: r.due_rule,
  applicability: r.applicability,
  requiredDocuments: r.required_documents,
  checklistTemplate: r.checklist_template,
  workflowTemplate: r.workflow_template,
  clientApprovalRequired: r.client_approval_required,
  filingConfirmationRequired: r.filing_confirmation_required,
  acknowledgementRequired: r.acknowledgement_required,
  fourEyesRequired: r.four_eyes_required,
  scopeKind: r.scope_kind,
  registrationClass: r.registration_class,
  governanceClass: r.governance_class,
  status: r.status,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const toVersion = (r: RuleVersionRow): ComplianceRuleVersionRecord => ({
  id: r.id,
  firmId: r.firm_id,
  complianceTypeId: r.compliance_type_id,
  version: r.version,
  effectiveFrom: r.effective_from,
  effectiveTo: r.effective_to,
  frequency: r.frequency,
  dueRule: r.due_rule,
  status: r.status,
  domainApprovalStatus: r.domain_approval_status,
  createdBy: r.created_by,
  createdAt: r.created_at,
});

// --- Write helpers -------------------------------------------------------------

/**
 * Tenant key for inserts (API-CONV-05): the caller never supplies an
 * authoritative firm_id — the value is the validated active-firm selector
 * context, and the database re-validates it against live membership on
 * every statement (RLS-CTX-02). Fail fast when no firm is selected.
 */
function requireActiveFirm(): string {
  const firmId = getActiveFirm();
  if (!firmId) {
    throw new ApiError(
      'validation',
      'No active firm selected — select a firm workspace before writing (RLS-CTX-01)',
    );
  }
  return firmId;
}

/** Drop undefined keys so patches only touch supplied columns. */
function compact<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/** Structured result of the Layer-B activation command. */
interface ActivationRpcResult {
  status: 'activated' | 'denied';
  kind?: ApiErrorKind;
  message?: string;
  version?: RuleVersionRow;
  predecessor?: RuleVersionRow | null;
}

export const supabaseComplianceRules: ComplianceRulesService = {
  mode: 'supabase',

  async listComplianceTypes(filter) {
    let query = getSupabaseClient()
      .from('compliance_types')
      .select(TYPE_COLUMNS)
      .order('type_key');
    if (filter?.category) query = query.eq('category', filter.category);
    if (filter?.status) query = query.eq('status', filter.status);
    if (filter?.limit !== undefined || filter?.offset !== undefined) {
      const from = filter?.offset ?? 0;
      const to = from + (filter?.limit ?? 50) - 1;
      query = query.range(from, to);
    }
    const { data, error } = await query;
    if (error) throw toApiError(error);
    return ((data ?? []) as unknown as ComplianceTypeRow[]).map(toType);
  },

  async getComplianceType(typeId) {
    const { data, error } = await getSupabaseClient()
      .from('compliance_types')
      .select(TYPE_COLUMNS)
      .eq('id', typeId)
      .maybeSingle();
    if (error) throw toApiError(error);
    return data ? toType(data as unknown as ComplianceTypeRow) : null;
  },

  async createComplianceType(input) {
    const { data, error } = await getSupabaseClient()
      .from('compliance_types')
      .insert({
        firm_id: requireActiveFirm(),
        type_key: input.typeKey,
        name: input.name,
        category: input.category,
        authority: input.authority ?? null,
        frequency: input.frequency,
        due_rule: input.dueRule,
        applicability: input.applicability ?? null,
        required_documents: input.requiredDocuments ?? null,
        checklist_template: input.checklistTemplate ?? null,
        workflow_template: input.workflowTemplate,
        client_approval_required: input.clientApprovalRequired ?? false,
        filing_confirmation_required: input.filingConfirmationRequired ?? true,
        acknowledgement_required: input.acknowledgementRequired ?? true,
        four_eyes_required: input.fourEyesRequired ?? true,
        scope_kind: input.scopeKind ?? 'configurable',
        registration_class: input.registrationClass ?? null,
        governance_class: input.governanceClass,
      })
      .select(TYPE_COLUMNS)
      .single();
    // Governance-inheritance violation → marked 23514 → conflict;
    // duplicate (type_key, firm) → 23505 → conflict.
    if (error) throw toApiError(error);
    return toType(data as unknown as ComplianceTypeRow);
  },

  async updateComplianceType(typeId, patch) {
    const { data, error } = await getSupabaseClient()
      .from('compliance_types')
      .update(
        compact({
          name: patch.name,
          category: patch.category,
          authority: patch.authority,
          frequency: patch.frequency,
          due_rule: patch.dueRule,
          applicability: patch.applicability,
          required_documents: patch.requiredDocuments,
          checklist_template: patch.checklistTemplate,
          workflow_template: patch.workflowTemplate,
          client_approval_required: patch.clientApprovalRequired,
          filing_confirmation_required: patch.filingConfirmationRequired,
          acknowledgement_required: patch.acknowledgementRequired,
          four_eyes_required: patch.fourEyesRequired,
          scope_kind: patch.scopeKind,
          registration_class: patch.registrationClass,
          status: patch.status,
        }),
      )
      .eq('id', typeId)
      .select(TYPE_COLUMNS)
      .single();
    if (error) throw toApiError(error);
    return toType(data as unknown as ComplianceTypeRow);
  },

  async listRuleVersions(filter) {
    let query = getSupabaseClient()
      .from('compliance_rule_versions')
      .select(VERSION_COLUMNS)
      .order('effective_from');
    if (filter?.complianceTypeId) query = query.eq('compliance_type_id', filter.complianceTypeId);
    if (filter?.status) query = query.eq('status', filter.status);
    if (filter?.limit !== undefined || filter?.offset !== undefined) {
      const from = filter?.offset ?? 0;
      const to = from + (filter?.limit ?? 50) - 1;
      query = query.range(from, to);
    }
    const { data, error } = await query;
    if (error) throw toApiError(error);
    return ((data ?? []) as unknown as RuleVersionRow[]).map(toVersion);
  },

  async getRuleVersion(versionId) {
    const { data, error } = await getSupabaseClient()
      .from('compliance_rule_versions')
      .select(VERSION_COLUMNS)
      .eq('id', versionId)
      .maybeSingle();
    if (error) throw toApiError(error);
    return data ? toVersion(data as unknown as RuleVersionRow) : null;
  },

  async createRuleVersion(input) {
    const { data, error } = await getSupabaseClient()
      .from('compliance_rule_versions')
      .insert({
        // firm scope is inherited from the parent type server-side; the
        // selector value is sent because the INSERT policy pins it
        // (firm_id = req_active_firm()) — never caller-authoritative.
        firm_id: requireActiveFirm(),
        compliance_type_id: input.complianceTypeId,
        version: input.version,
        effective_from: input.effectiveFrom,
        // effective_to is SCH-32 class-B lifecycle metadata — never sent at
        // insert; only the lifecycle command sets it (window closure).
        frequency: input.frequency,
        due_rule: input.dueRule,
      })
      .select(VERSION_COLUMNS)
      .single();
    // Duplicate (type, version) → 23505 → conflict; invalid window →
    // 23514 (plain) → validation.
    if (error) throw toApiError(error);
    return toVersion(data as unknown as RuleVersionRow);
  },

  async updateRuleVersionDraft(versionId, patch) {
    const { data, error } = await getSupabaseClient()
      .from('compliance_rule_versions')
      .update(
        compact({
          effective_from: patch.effectiveFrom,
          frequency: patch.frequency,
          due_rule: patch.dueRule,
        }),
      )
      .eq('id', versionId)
      .select(VERSION_COLUMNS)
      .single();
    // 0 rows (unknown OR inaccessible) → PGRST116 → not_found (API-ERR-02);
    // frozen rule content → marked 23514 → conflict (RLS-CRV-04).
    if (error) throw toApiError(error);
    return toVersion(data as unknown as RuleVersionRow);
  },

  async activateRuleVersion(versionId) {
    const { data, error } = await getSupabaseClient().rpc(
      'activate_compliance_rule_version',
      { p_version_id: versionId },
    );
    if (error) throw toApiError(error);
    const result = data as unknown as ActivationRpcResult;
    if (result.status === 'denied') {
      throw new ApiError(result.kind ?? 'internal', result.message ?? 'activation denied');
    }
    if (!result.version) {
      throw new ApiError('internal', 'activation returned no version row');
    }
    return {
      version: toVersion(result.version),
      predecessor: result.predecessor ? toVersion(result.predecessor) : null,
    };
  },
};
