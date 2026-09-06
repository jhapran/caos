/**
 * IMP-042 (data-adapter slice) — Alerts: SUPABASE adapter (production).
 *
 * Reads are plain PostgREST under RLS (API-ARCH-03): alerts / alert_rules
 * SELECT return exactly the caller's authorized rows (RLS-ALR-01 /
 * RLS-ARL-01 — SELECT-only browser grants) — the adapter never recreates
 * role authorization in the browser and never treats UI filtering as
 * security. The ONLY write paths are the five controlled Layer-B commands
 * (acknowledge_alert / snooze_alert / resolve_alert / create_alert_rule /
 * update_alert_rule — API-R0-ALR, API-ARCH-04); no direct
 * INSERT/UPDATE/DELETE grant exists on either table. Alert CREATION has no
 * browser path at all (the generator is IMP-051).
 *
 * The adapter never sends server-controlled inputs: no firm_id, no actor or
 * timestamp stamps, no status, no resolution_type (API-MUT-04). The
 * commands return structured results: deliberate denials arrive as
 * { status: 'denied', kind, message } (already audited server-side,
 * AUD-FAIL-01) and are mapped onto the API-ERR-01 taxonomy here —
 * pre-authorization denials are the uniform not_found (API-ERR-02: the UI
 * cannot distinguish hidden-existing from nonexistent); invalid_state maps
 * to conflict; malformed input to validation. A replay arrives as
 * { status: 'already_applied', … } and is returned as a DTO, never an
 * error (API-MUT-03).
 *
 * SNOOZE-EXPIRY READ DERIVATION (SCH-18, TEST-API-18): a plain SELECT
 * exposes status/snoozed_until/acknowledged_at exactly as persisted — the
 * adapter applies deriveAlertEffectiveStatus AFTER the SELECT, so every
 * AlertRecord leaving this boundary carries the authoritative
 * effectiveStatus, and the status list-filter matches the DERIVED status.
 * IMP-042 performs NO expiry writes.
 *
 * Freshness (API-RT-01/03/05, API-RT-07): subscribeAlerts is a
 * provider-neutral invalidation subscription. The Supabase implementation
 * uses the APPROVED API-RT-07 POLLING FALLBACK (human-ruled at IMP-042
 * contract reconciliation 2026-09-06; the IMP-041 differential harness
 * proved authenticated postgres_changes cannot satisfy the R0 active-firm
 * RLS context): every poll tick is a bare invalidation signal — the
 * consumer re-reads through the normal RLS-controlled list, so polling
 * never widens authorization. No postgres_changes dependency, no realtime
 * publication.
 *
 * Errors are translated once through toApiError() — no Supabase SDK or
 * PostgREST types cross this boundary (API-ARCH-01/02, API-ERR-01).
 */
import { getActiveFirm } from '@/data/context';
import { ApiError, toApiError, type ApiErrorKind } from '@/data/errors';
import { getSupabaseClient } from '@/lib/supabaseClient';

import {
  deriveAlertEffectiveStatus,
  type AlertRecord,
  type AlertResolutionType,
  type AlertRuleRecord,
  type AlertsService,
  type AlertSeverityKey,
  type AlertStatus,
  type AlertTransitionResult,
} from './types';

// --- Row shapes (snake_case, exactly the SCH-18/19 columns) ----------------------

interface AlertRow {
  id: string;
  firm_id: string;
  alert_rule_id: string | null;
  severity: AlertSeverityKey;
  title: string;
  detail: string | null;
  client_id: string | null;
  compliance_instance_id: string | null;
  affected: unknown;
  status: AlertStatus;
  raised_at: string;
  acknowledged_by: string | null;
  acknowledged_at: string | null;
  snoozed_until: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  resolution_type: AlertResolutionType | null;
  created_at: string;
  updated_at: string | null;
}

interface AlertRuleRow {
  id: string;
  firm_id: string;
  rule_key: string;
  name: string;
  severity: AlertSeverityKey;
  config: Record<string, unknown>;
  enabled: boolean;
  auto_resolve: boolean;
  requires_explicit_ack: boolean;
  created_at: string;
  updated_at: string | null;
}

// --- Column projections and mappers ------------------------------------------------

const ALERT_COLUMNS =
  'id, firm_id, alert_rule_id, severity, title, detail, client_id, compliance_instance_id, ' +
  'affected, status, raised_at, acknowledged_by, acknowledged_at, snoozed_until, ' +
  'resolved_by, resolved_at, resolution_type, created_at, updated_at';

const RULE_COLUMNS =
  'id, firm_id, rule_key, name, severity, config, enabled, auto_resolve, ' +
  'requires_explicit_ack, created_at, updated_at';

/** Row → read DTO. The snooze-expiry derivation (SCH-18, TEST-API-18) is
 *  applied HERE, on every read surface — list rows and command-result rows
 *  alike — so effectiveStatus is always the authoritative read status. */
const toAlert = (r: AlertRow): AlertRecord => ({
  id: r.id,
  firmId: r.firm_id,
  alertRuleId: r.alert_rule_id,
  severity: r.severity,
  title: r.title,
  detail: r.detail,
  clientId: r.client_id,
  complianceInstanceId: r.compliance_instance_id,
  affected: r.affected,
  status: r.status,
  effectiveStatus: deriveAlertEffectiveStatus({
    status: r.status,
    snoozedUntil: r.snoozed_until,
    acknowledgedAt: r.acknowledged_at,
  }),
  raisedAt: r.raised_at,
  acknowledgedBy: r.acknowledged_by,
  acknowledgedAt: r.acknowledged_at,
  snoozedUntil: r.snoozed_until,
  resolvedBy: r.resolved_by,
  resolvedAt: r.resolved_at,
  resolutionType: r.resolution_type,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const toAlertRule = (r: AlertRuleRow): AlertRuleRecord => ({
  id: r.id,
  firmId: r.firm_id,
  ruleKey: r.rule_key,
  name: r.name,
  severity: r.severity,
  config: r.config,
  enabled: r.enabled,
  autoResolve: r.auto_resolve,
  requiresExplicitAck: r.requires_explicit_ack,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

// --- Command envelopes ----------------------------------------------------------------

/** Structured result of acknowledge_alert / snooze_alert / resolve_alert. */
interface AlertCommandRpcResult {
  status: 'acknowledged' | 'snoozed' | 'resolved' | 'already_applied' | 'denied';
  kind?: ApiErrorKind;
  message?: string;
  from_status?: AlertStatus;
  to_status?: AlertStatus;
  reason?: string;
  alert?: AlertRow;
}

/** Structured result of create_alert_rule / update_alert_rule. */
interface AlertRuleRpcResult {
  status: 'created' | 'updated' | 'denied';
  kind?: ApiErrorKind;
  message?: string;
  rule?: AlertRuleRow;
}

/** Map a Layer-B structured denial onto the API-ERR-01 taxonomy. */
function denialError(result: { kind?: ApiErrorKind; message?: string }): ApiError {
  return new ApiError(result.kind ?? 'internal', result.message ?? 'command denied');
}

/** Shared mapping for the three transition commands (API-R0-ALR). */
function mapCommandResult(result: AlertCommandRpcResult): AlertTransitionResult {
  if (result.status === 'denied') throw denialError(result);
  if (!result.alert) {
    throw new ApiError('internal', 'alert command returned no alert row');
  }
  if (result.status === 'already_applied') {
    return { status: 'already_applied', reason: result.reason, alert: toAlert(result.alert) };
  }
  return {
    status: 'applied',
    fromStatus: result.from_status,
    toStatus: result.to_status,
    alert: toAlert(result.alert),
  };
}

// API-RT-07 fallback interval. Authenticated postgres_changes cannot
// satisfy the R0 active-firm RLS context (see the header above), so alert
// list/count freshness uses the approved polling fallback — the same
// sanctioned pattern as subscribeReviewQueue (IMP-041). Implementation
// parameter — tuneable later, NOT a product/SLA guarantee.
export const ALERTS_POLL_INTERVAL_MS = 15_000;

export const supabaseAlerts: AlertsService = {
  mode: 'supabase',

  async listAlerts(filter) {
    // RLS is authoritative: the query returns exactly the caller's
    // authorized rows (RLS-ALR-01); severity/clientId filters are UX
    // narrowing only. The status filter matches the DERIVED effective
    // status (TEST-API-18), so it is applied after the derivation below.
    let query = getSupabaseClient()
      .from('alerts')
      .select(ALERT_COLUMNS)
      .order('raised_at', { ascending: false });
    if (filter?.severity) query = query.eq('severity', filter.severity);
    if (filter?.clientId) query = query.eq('client_id', filter.clientId);
    const { data, error } = await query;
    if (error) throw toApiError(error);
    let rows = ((data ?? []) as unknown as AlertRow[]).map(toAlert);
    if (filter?.status) rows = rows.filter((a) => a.effectiveStatus === filter.status);
    return rows;
  },

  async listAlertRules() {
    const { data, error } = await getSupabaseClient()
      .from('alert_rules')
      .select(RULE_COLUMNS)
      .order('rule_key');
    if (error) throw toApiError(error);
    return ((data ?? []) as unknown as AlertRuleRow[]).map(toAlertRule);
  },

  async acknowledgeAlert(alertId, mutationKey) {
    const { data, error } = await getSupabaseClient().rpc('acknowledge_alert', {
      p_alert_id: alertId,
      p_mutation_key: mutationKey ?? null,
    });
    if (error) throw toApiError(error);
    return mapCommandResult(data as unknown as AlertCommandRpcResult);
  },

  async snoozeAlert(alertId, snoozedUntil, mutationKey) {
    const { data, error } = await getSupabaseClient().rpc('snooze_alert', {
      p_alert_id: alertId,
      p_snoozed_until: snoozedUntil,
      p_mutation_key: mutationKey ?? null,
    });
    if (error) throw toApiError(error);
    return mapCommandResult(data as unknown as AlertCommandRpcResult);
  },

  async resolveAlert(alertId, mutationKey) {
    const { data, error } = await getSupabaseClient().rpc('resolve_alert', {
      p_alert_id: alertId,
      p_mutation_key: mutationKey ?? null,
    });
    if (error) throw toApiError(error);
    return mapCommandResult(data as unknown as AlertCommandRpcResult);
  },

  async createAlertRule(input) {
    const { data, error } = await getSupabaseClient().rpc('create_alert_rule', {
      // Business inputs only: firm_id is server-derived from the validated
      // active-firm context; id/created_at are column defaults (API-MUT-04).
      p_rule_key: input.ruleKey,
      p_name: input.name,
      p_severity: input.severity,
      p_config: input.config ?? {},
      p_enabled: input.enabled ?? true,
      p_auto_resolve: input.autoResolve ?? true,
      p_requires_explicit_ack: input.requiresExplicitAck ?? false,
    });
    if (error) throw toApiError(error);
    const result = data as unknown as AlertRuleRpcResult;
    if (result.status === 'denied') throw denialError(result);
    if (!result.rule) {
      throw new ApiError('internal', 'create returned no alert rule row');
    }
    return toAlertRule(result.rule);
  },

  async updateAlertRule(ruleId, patch) {
    const { data, error } = await getSupabaseClient().rpc('update_alert_rule', {
      p_rule_id: ruleId,
      // Patch semantics (API-R0-ALR): a NULL parameter keeps the current
      // value — absent patch fields are sent as null, never as writes.
      p_name: patch.name ?? null,
      p_severity: patch.severity ?? null,
      p_config: patch.config ?? null,
      p_enabled: patch.enabled ?? null,
      p_auto_resolve: patch.autoResolve ?? null,
      p_requires_explicit_ack: patch.requiresExplicitAck ?? null,
    });
    if (error) throw toApiError(error);
    const result = data as unknown as AlertRuleRpcResult;
    if (result.status === 'denied') throw denialError(result);
    if (!result.rule) {
      throw new ApiError('internal', 'update returned no alert rule row');
    }
    return toAlertRule(result.rule);
  },

  subscribeAlerts(onInvalidate) {
    // API-RT-07 polling fallback: each tick is a bare invalidation signal —
    // no payload, no channel, no client-side authorization; the consumer
    // re-reads through the RLS-controlled list (API-RT-03/05). Every
    // consumer owns an independent timer; unsubscribe always clears it.
    const firmId = getActiveFirm();
    if (!firmId) return () => {}; // no selector context → no subscription
    const timer = setInterval(onInvalidate, ALERTS_POLL_INTERVAL_MS);
    return () => {
      clearInterval(timer);
    };
  },
};
