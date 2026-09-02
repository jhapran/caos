/**
 * IMP-021 — Engagement SUPABASE adapter (production path).
 *
 * Plain PostgREST reads/writes under RLS (API-ARCH-03) — no RPC wrappers
 * for row-shaped operations. Authorization is decided by the database on
 * every statement: the active-firm header (injected by the browser
 * client from @/data/context) is selector context only, and the caller's
 * live membership + role + AAL are re-validated server-side (DEC-J,
 * RLS-MECH-01). The only RPC used here is list_engagement_letter_statuses(),
 * the reviewed SECURITY DEFINER projection for the billing role
 * (RLS-ENG-01).
 *
 * Errors are translated once through toApiError() — no Supabase SDK or
 * PostgREST types cross this boundary (API-ARCH-01/02, API-ERR-01).
 */
import { getActiveFirm } from '@/data/context';
import { ApiError, toApiError } from '@/data/errors';
import { getSupabaseClient } from '@/lib/supabaseClient';

import type {
  EngagementLetterStatus,
  EngagementRecord,
  EngagementService,
  EngagementStatus,
  LetterStatus,
} from './types';

// --- Row shape (snake_case, exactly the SCH-09 columns) ----------------------

interface EngagementRow {
  id: string;
  firm_id: string;
  client_id: string;
  responsible_partner_membership_id: string;
  service_lines: string[];
  letter_status: LetterStatus;
  proposed_at: string | null;
  signed_at: string | null;
  period_label: string | null;
  status: EngagementStatus;
  termination_reason: string | null;
  created_at: string;
  updated_at: string | null;
}

// --- Column projection and mapper ---------------------------------------------

const ENGAGEMENT_COLUMNS =
  'id, firm_id, client_id, responsible_partner_membership_id, service_lines, ' +
  'letter_status, proposed_at, signed_at, period_label, status, termination_reason, ' +
  'created_at, updated_at';

const toEngagement = (r: EngagementRow): EngagementRecord => ({
  id: r.id,
  firmId: r.firm_id,
  clientId: r.client_id,
  responsiblePartnerMembershipId: r.responsible_partner_membership_id,
  serviceLines: r.service_lines,
  letterStatus: r.letter_status,
  proposedAt: r.proposed_at,
  signedAt: r.signed_at,
  periodLabel: r.period_label,
  status: r.status,
  terminationReason: r.termination_reason,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

// --- Write helpers ---------------------------------------------------------------

/**
 * Tenant key for inserts. firm_id is NOT NULL and every INSERT policy
 * requires firm_id = req_active_firm(), so the value must come from the
 * validated selector context. The header itself is injected by the
 * browser client; here we fail fast when no firm is selected rather than
 * shipping a row the database would reject anyway.
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

export const supabaseEngagements: EngagementService = {
  mode: 'supabase',

  async listEngagements(filter) {
    let query = getSupabaseClient()
      .from('engagements')
      .select(ENGAGEMENT_COLUMNS)
      .order('created_at');
    if (filter?.clientId) query = query.eq('client_id', filter.clientId);
    if (filter?.status) query = query.eq('status', filter.status);
    if (filter?.letterStatus) query = query.eq('letter_status', filter.letterStatus);
    if (filter?.responsiblePartnerMembershipId) {
      query = query.eq('responsible_partner_membership_id', filter.responsiblePartnerMembershipId);
    }
    if (filter?.limit !== undefined || filter?.offset !== undefined) {
      const from = filter?.offset ?? 0;
      const to = from + (filter?.limit ?? 50) - 1;
      query = query.range(from, to);
    }
    const { data, error } = await query;
    if (error) throw toApiError(error);
    return ((data ?? []) as unknown as EngagementRow[]).map(toEngagement);
  },

  async getEngagement(engagementId) {
    const { data, error } = await getSupabaseClient()
      .from('engagements')
      .select(ENGAGEMENT_COLUMNS)
      .eq('id', engagementId)
      .maybeSingle();
    if (error) throw toApiError(error);
    return data ? toEngagement(data as unknown as EngagementRow) : null;
  },

  async createEngagement(input) {
    const { data, error } = await getSupabaseClient()
      .from('engagements')
      .insert({
        firm_id: requireActiveFirm(),
        client_id: input.clientId,
        responsible_partner_membership_id: input.responsiblePartnerMembershipId,
        service_lines: input.serviceLines ?? [],
        letter_status: input.letterStatus ?? 'not_started',
        proposed_at: input.proposedAt ?? null,
        signed_at: input.signedAt ?? null,
        period_label: input.periodLabel ?? null,
        status: input.status ?? 'draft',
        termination_reason: input.terminationReason ?? null,
      })
      .select(ENGAGEMENT_COLUMNS)
      .single();
    // Terminated without reason → 23514 (plain) → validation (DM-SM-03)
    if (error) throw toApiError(error);
    return toEngagement(data as unknown as EngagementRow);
  },

  async updateEngagement(engagementId, patch) {
    const { data, error } = await getSupabaseClient()
      .from('engagements')
      .update(
        compact({
          responsible_partner_membership_id: patch.responsiblePartnerMembershipId,
          service_lines: patch.serviceLines,
          letter_status: patch.letterStatus,
          proposed_at: patch.proposedAt,
          signed_at: patch.signedAt,
          period_label: patch.periodLabel,
          status: patch.status,
          termination_reason: patch.terminationReason,
        }),
      )
      .eq('id', engagementId)
      .select(ENGAGEMENT_COLUMNS)
      .single();
    // 0 rows (unknown OR inaccessible id) → PGRST116 → not_found (API-ERR-02);
    // illegal DM-SM-03 transition → marked 23514 → conflict (API-R0-ENG).
    if (error) throw toApiError(error);
    return toEngagement(data as unknown as EngagementRow);
  },

  async listEngagementLetterStatuses() {
    const { data, error } = await getSupabaseClient().rpc('list_engagement_letter_statuses', {
      p_firm_id: requireActiveFirm(),
    });
    if (error) throw toApiError(error);
    return (
      (data ?? []) as { id: string; client_id: string; letter_status: LetterStatus }[]
    ).map(
      (r): EngagementLetterStatus => ({
        id: r.id,
        clientId: r.client_id,
        letterStatus: r.letter_status,
      }),
    );
  },
};
