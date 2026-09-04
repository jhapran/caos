/**
 * IMP-031 — Compliance profiles & instances: SUPABASE adapter (production).
 *
 * Plain PostgREST reads/writes under RLS (API-ARCH-03) for the row-shaped
 * operations; the ONLY RPCs are the two controlled Layer-B commands
 * (API-R0-CCP approve, API-R0-CIN transition). Authorization is decided by
 * the database on every statement (DEC-J, RLS-MECH-01); the active-firm
 * header (injected by the browser client from @/data/context) is selector
 * context only.
 *
 * The adapter never sends server-controlled columns:
 *   - profiles: no status (forced default 'proposed'), no
 *     approved_by/approved_at (command-stamped);
 *   - instances: no client_id (trigger-derived, SCH-A-02), no state
 *     (forced default 'not_started'), no filed_at/closed_at
 *     (command-stamped), no risk_score/risk_factors/successor_instance_id
 *     (server-owned), and NO recurrence provenance — rule_version_id,
 *     generation_source, generated_at and calculated_due_date are not
 *     granted to browser callers at all (AUTO-REC-07; a browser session
 *     must never forge recurrence provenance). The server defaults
 *     generation_source to 'manual' on insert and the rest stay NULL;
 *     IMP-050's generator (service_role) is the only
 *     recurrence-provenance writer.
 *
 * The Layer-B commands return structured results: deliberate denials arrive
 * as { status: 'denied', kind, message } (already audited server-side,
 * AUD-FAIL-01) and are mapped onto the API-ERR-01 taxonomy here — CA401 →
 * unauthorized, CA402 → conflict, CA400 → validation. A keyed replay of an
 * already-applied transition arrives as { status: 'already_applied',
 * instance } and is returned as a DTO, never an error.
 *
 * Errors are translated once through toApiError() — no Supabase SDK or
 * PostgREST types cross this boundary (API-ARCH-01/02, API-ERR-01).
 */
import { getActiveFirm } from '@/data/context';
import { ApiError, toApiError, type ApiErrorKind } from '@/data/errors';
import { getSupabaseClient } from '@/lib/supabaseClient';

import type {
  ComplianceInstanceRecord,
  ComplianceInstanceState,
  ComplianceInstancesService,
  ComplianceProfileRecord,
  GenerationSource,
} from './types';

// --- Row shapes (snake_case, exactly the SCH-11/SCH-12 columns) --------------

interface ComplianceProfileRow {
  id: string;
  firm_id: string;
  legal_entity_id: string;
  compliance_type_id: string;
  registration_id: string | null;
  applicability_answers: Record<string, unknown> | null;
  status: ComplianceProfileRecord['status'];
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string | null;
}

interface ComplianceInstanceRow {
  id: string;
  firm_id: string;
  client_id: string;
  legal_entity_id: string;
  compliance_type_id: string;
  registration_id: string | null;
  client_compliance_profile_id: string | null;
  engagement_id: string | null;
  period_start: string;
  period_end: string;
  period_label: string;
  period_meta: Record<string, unknown> | null;
  due_date: string;
  rule_version_id: string | null;
  generation_source: GenerationSource;
  generated_at: string | null;
  calculated_due_date: string | null;
  state: ComplianceInstanceState;
  assignee_membership_id: string | null;
  reviewer_membership_id: string | null;
  partner_membership_id: string | null;
  priority: string;
  risk_score: number | null;
  risk_factors: Record<string, unknown> | null;
  filed_at: string | null;
  closed_at: string | null;
  successor_instance_id: string | null;
  created_at: string;
  updated_at: string | null;
}

// --- Column projections and mappers ------------------------------------------

const PROFILE_COLUMNS =
  'id, firm_id, legal_entity_id, compliance_type_id, registration_id, ' +
  'applicability_answers, status, approved_by, approved_at, created_at, updated_at';

const INSTANCE_COLUMNS =
  'id, firm_id, client_id, legal_entity_id, compliance_type_id, registration_id, ' +
  'client_compliance_profile_id, engagement_id, period_start, period_end, period_label, ' +
  'period_meta, due_date, rule_version_id, generation_source, generated_at, ' +
  'calculated_due_date, state, assignee_membership_id, reviewer_membership_id, ' +
  'partner_membership_id, priority, risk_score, risk_factors, filed_at, closed_at, ' +
  'successor_instance_id, created_at, updated_at';

const toProfile = (r: ComplianceProfileRow): ComplianceProfileRecord => ({
  id: r.id,
  firmId: r.firm_id,
  legalEntityId: r.legal_entity_id,
  complianceTypeId: r.compliance_type_id,
  registrationId: r.registration_id,
  applicabilityAnswers: r.applicability_answers,
  status: r.status,
  approvedBy: r.approved_by,
  approvedAt: r.approved_at,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const toInstance = (r: ComplianceInstanceRow): ComplianceInstanceRecord => ({
  id: r.id,
  firmId: r.firm_id,
  clientId: r.client_id,
  legalEntityId: r.legal_entity_id,
  complianceTypeId: r.compliance_type_id,
  registrationId: r.registration_id,
  clientComplianceProfileId: r.client_compliance_profile_id,
  engagementId: r.engagement_id,
  periodStart: r.period_start,
  periodEnd: r.period_end,
  periodLabel: r.period_label,
  periodMeta: r.period_meta,
  dueDate: r.due_date,
  ruleVersionId: r.rule_version_id,
  generationSource: r.generation_source,
  generatedAt: r.generated_at,
  calculatedDueDate: r.calculated_due_date,
  state: r.state,
  assigneeMembershipId: r.assignee_membership_id,
  reviewerMembershipId: r.reviewer_membership_id,
  partnerMembershipId: r.partner_membership_id,
  priority: r.priority,
  riskScore: r.risk_score,
  riskFactors: r.risk_factors,
  filedAt: r.filed_at,
  closedAt: r.closed_at,
  successorInstanceId: r.successor_instance_id,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
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

/** Structured result of the approve command (API-R0-CCP). */
interface ApprovalRpcResult {
  status: 'approved' | 'denied';
  kind?: ApiErrorKind;
  message?: string;
  profile?: ComplianceProfileRow;
}

/** Structured result of the transition command (API-R0-CIN). */
interface TransitionRpcResult {
  status: 'transitioned' | 'already_applied' | 'denied';
  kind?: ApiErrorKind;
  message?: string;
  from_state?: ComplianceInstanceState;
  to_state?: ComplianceInstanceState;
  reason?: string;
  instance?: ComplianceInstanceRow;
}

/** Map a Layer-B structured denial onto the API-ERR-01 taxonomy. */
function denialError(result: { kind?: ApiErrorKind; message?: string }): ApiError {
  return new ApiError(result.kind ?? 'internal', result.message ?? 'command denied');
}

export const supabaseComplianceInstances: ComplianceInstancesService = {
  mode: 'supabase',

  async listComplianceProfiles(filter) {
    let query = getSupabaseClient()
      .from('client_compliance_profiles')
      .select(PROFILE_COLUMNS)
      .order('created_at');
    if (filter?.legalEntityId) query = query.eq('legal_entity_id', filter.legalEntityId);
    if (filter?.complianceTypeId) query = query.eq('compliance_type_id', filter.complianceTypeId);
    if (filter?.status) query = query.eq('status', filter.status);
    if (filter?.limit !== undefined || filter?.offset !== undefined) {
      const from = filter?.offset ?? 0;
      const to = from + (filter?.limit ?? 50) - 1;
      query = query.range(from, to);
    }
    const { data, error } = await query;
    if (error) throw toApiError(error);
    return ((data ?? []) as unknown as ComplianceProfileRow[]).map(toProfile);
  },

  async getComplianceProfile(profileId) {
    const { data, error } = await getSupabaseClient()
      .from('client_compliance_profiles')
      .select(PROFILE_COLUMNS)
      .eq('id', profileId)
      .maybeSingle();
    if (error) throw toApiError(error);
    return data ? toProfile(data as unknown as ComplianceProfileRow) : null;
  },

  async createComplianceProfile(input) {
    const { data, error } = await getSupabaseClient()
      .from('client_compliance_profiles')
      .insert({
        firm_id: requireActiveFirm(),
        legal_entity_id: input.legalEntityId,
        compliance_type_id: input.complianceTypeId,
        registration_id: input.registrationId ?? null,
        applicability_answers: input.applicabilityAnswers ?? null,
      })
      .select(PROFILE_COLUMNS)
      .single();
    // DM-27 scope violation → marked SCOPE_VIOLATION: 23514 → validation;
    // duplicate (entity, type, registration) → 23505 → conflict; unknown
    // entity/type/registration reference → 23503 → conflict.
    if (error) throw toApiError(error);
    return toProfile(data as unknown as ComplianceProfileRow);
  },

  async updateComplianceProfile(profileId, patch) {
    const { data, error } = await getSupabaseClient()
      .from('client_compliance_profiles')
      .update(
        compact({
          registration_id: patch.registrationId,
          applicability_answers: patch.applicabilityAnswers,
          status: patch.status,
        }),
      )
      .eq('id', profileId)
      .select(PROFILE_COLUMNS)
      .single();
    // 0 rows (unknown OR inaccessible) → PGRST116 → not_found (API-ERR-02);
    // status -> 'active' outside the command → INVALID_TRANSITION: 23514 →
    // conflict (RLS-CCP-01); identity movement → IMMUTABLE_FIELD: → conflict.
    if (error) throw toApiError(error);
    return toProfile(data as unknown as ComplianceProfileRow);
  },

  async approveComplianceProfile(profileId) {
    const { data, error } = await getSupabaseClient().rpc(
      'approve_client_compliance_profile',
      { p_profile_id: profileId },
    );
    if (error) throw toApiError(error);
    const result = data as unknown as ApprovalRpcResult;
    if (result.status === 'denied') throw denialError(result);
    if (!result.profile) {
      throw new ApiError('internal', 'approval returned no profile row');
    }
    return toProfile(result.profile);
  },

  async listComplianceInstances(filter) {
    let query = getSupabaseClient()
      .from('compliance_instances')
      .select(INSTANCE_COLUMNS)
      .order('due_date');
    if (filter?.state) query = query.eq('state', filter.state);
    if (filter?.assigneeMembershipId) {
      query = query.eq('assignee_membership_id', filter.assigneeMembershipId);
    }
    if (filter?.dueFrom) query = query.gte('due_date', filter.dueFrom);
    if (filter?.dueTo) query = query.lte('due_date', filter.dueTo);
    if (filter?.clientId) query = query.eq('client_id', filter.clientId);
    if (filter?.legalEntityId) query = query.eq('legal_entity_id', filter.legalEntityId);
    if (filter?.complianceTypeId) query = query.eq('compliance_type_id', filter.complianceTypeId);
    if (filter?.limit !== undefined || filter?.offset !== undefined) {
      const from = filter?.offset ?? 0;
      const to = from + (filter?.limit ?? 50) - 1;
      query = query.range(from, to);
    }
    const { data, error } = await query;
    if (error) throw toApiError(error);
    return ((data ?? []) as unknown as ComplianceInstanceRow[]).map(toInstance);
  },

  async getComplianceInstance(instanceId) {
    const { data, error } = await getSupabaseClient()
      .from('compliance_instances')
      .select(INSTANCE_COLUMNS)
      .eq('id', instanceId)
      .maybeSingle();
    if (error) throw toApiError(error);
    return data ? toInstance(data as unknown as ComplianceInstanceRow) : null;
  },

  async createComplianceInstance(input) {
    const { data, error } = await getSupabaseClient()
      .from('compliance_instances')
      .insert({
        firm_id: requireActiveFirm(),
        legal_entity_id: input.legalEntityId,
        compliance_type_id: input.complianceTypeId,
        registration_id: input.registrationId ?? null,
        client_compliance_profile_id: input.clientComplianceProfileId ?? null,
        engagement_id: input.engagementId ?? null,
        period_start: input.periodStart,
        period_end: input.periodEnd,
        period_label: input.periodLabel,
        period_meta: input.periodMeta ?? null,
        due_date: input.dueDate,
        // No provenance keys: the provenance columns are not granted to
        // browser callers (sending generation_source would fail 42501) —
        // the server defaults it to 'manual' and the rest stay NULL
        // (AUTO-REC-07); 'recurrence' provenance is service_role-only.
        assignee_membership_id: input.assigneeMembershipId ?? null,
        reviewer_membership_id: input.reviewerMembershipId ?? null,
        partner_membership_id: input.partnerMembershipId ?? null,
        priority: input.priority ?? 'normal',
      })
      .select(INSTANCE_COLUMNS)
      .single();
    // Duplicate obligation-period key → 23505 → conflict (AUTO-REC-03
    // layer 3); invalid period / DM-27 scope / four-eyes assignment →
    // plain or SCOPE_VIOLATION:/FOUR_EYES: 23514 → validation; unknown
    // references / non-ACTIVE memberships → 23503 → conflict.
    if (error) throw toApiError(error);
    return toInstance(data as unknown as ComplianceInstanceRow);
  },

  async updateComplianceInstance(instanceId, patch) {
    const { data, error } = await getSupabaseClient()
      .from('compliance_instances')
      .update(
        compact({
          engagement_id: patch.engagementId,
          period_label: patch.periodLabel,
          period_meta: patch.periodMeta,
          due_date: patch.dueDate,
          assignee_membership_id: patch.assigneeMembershipId,
          reviewer_membership_id: patch.reviewerMembershipId,
          partner_membership_id: patch.partnerMembershipId,
          priority: patch.priority,
        }),
      )
      .eq('id', instanceId)
      .select(INSTANCE_COLUMNS)
      .single();
    // 0 rows → PGRST116 → not_found (API-ERR-02); identity/period/
    // provenance movement → IMMUTABLE_FIELD: 23514 → conflict; state
    // movement → INVALID_TRANSITION: → conflict (RLS-CIN-01); TDS
    // NULL-exception loss via period_meta → SCOPE_VIOLATION: → validation.
    if (error) throw toApiError(error);
    return toInstance(data as unknown as ComplianceInstanceRow);
  },

  async transitionInstance(instanceId, input) {
    const { data, error } = await getSupabaseClient().rpc('transition_compliance_instance', {
      p_instance_id: instanceId,
      p_to_state: input.toState,
      p_mutation_key: input.mutationKey ?? null,
    });
    if (error) throw toApiError(error);
    const result = data as unknown as TransitionRpcResult;
    if (result.status === 'denied') throw denialError(result);
    if (!result.instance) {
      throw new ApiError('internal', 'transition returned no instance row');
    }
    return {
      status: result.status,
      instance: toInstance(result.instance),
      fromState: result.from_state,
      toState: result.to_state,
      reason: result.reason,
    };
  },
};
