/**
 * IMP-042 (data-adapter slice) — Alerts: domain types (provider-neutral).
 *
 * Mirrors the production schema (SCH-18 alerts / SCH-19 alert_rules,
 * spec 06) one-to-one in the application-facing camelCase shape. An
 * AlertRecord is one firm risk signal (DM-22) moving through the human-ruled
 * SCH-18 manual transition matrix; an AlertRuleRecord is the per-firm rule
 * configuration (DM-22; no seed rows ship in IMP-042 — AUTO-OQ-04 stays open).
 *
 * Server-controlled fields are never caller input (API-R0-ALR):
 *   - firmId, raisedAt are server-derived; alert CREATION has no browser
 *     path at all (the generator is IMP-051);
 *   - status starts 'active' and moves ONLY through the Layer-B commands
 *     acknowledge_alert / snooze_alert / resolve_alert (the manual
 *     transition matrix) — direct table writes are closed;
 *   - acknowledgedBy/acknowledgedAt, resolvedBy/resolvedAt/resolutionType
 *     are server-stamped actor identity (SCH-RESP-02, API-MUT-04);
 *     resolutionType 'auto' is reserved for the IMP-051 evaluator;
 *   - alert_rules administration goes only through the AAL2-gated Layer-B
 *     commands create_alert_rule / update_alert_rule (RLS-ARL-01,
 *     RLS-AAL-01); ruleKey and firmId are insert-only identity.
 *
 * SNOOZE-EXPIRY READ DERIVATION (SCH-18, TEST-API-18): IMP-042 persists no
 * expiry transition. A persisted 'snoozed' row whose snoozedUntil has passed
 * READS as effective status 'acknowledged' when acknowledgedAt IS NOT NULL,
 * else 'active'. The derivation happens adapter-side at read time via
 * deriveAlertEffectiveStatus — the read DTO therefore carries BOTH the
 * persisted `status` and the derived `effectiveStatus`; filter semantics and
 * UI rendering key off effectiveStatus, never raw persisted status.
 */
import type { DataSource } from '@/data/source';

// --- Vocabularies (exactly the SCH-18/19 CHECK sets) --------------------------

/** SCH-18/19 severity vocabulary. (Named *Key because the legacy demo
 *  barrel already exports an `AlertSeverity` demo-label union.) */
export type AlertSeverityKey = 'info' | 'warning' | 'critical';

/** SCH-18 persisted status vocabulary (exactly the alerts_status_check set). */
export type AlertStatus = 'active' | 'acknowledged' | 'snoozed' | 'resolved';

/** SCH-18 resolution provenance; 'auto' is written only by IMP-051. */
export type AlertResolutionType = 'manual' | 'auto';

// --- Snooze-expiry read derivation (SCH-18, TEST-API-18) ----------------------

/**
 * The authoritative read-time status of an alert. Pure and injectable-clock
 * so the derivation is unit-testable without timers:
 *   - persisted 'snoozed' with snoozedUntil <= now reads as 'acknowledged'
 *     when acknowledgedAt IS NOT NULL (acknowledgement history survives
 *     snooze), else 'active';
 *   - a future snooze reads as 'snoozed' (unchanged);
 *   - every other persisted status reads as itself.
 * No expiry WRITE ever happens here (IMP-042 scope rule; persisted
 * normalization belongs to the IMP-051 evaluator).
 */
export function deriveAlertEffectiveStatus(
  alert: {
    status: AlertStatus;
    snoozedUntil: string | null;
    acknowledgedAt: string | null;
  },
  now: Date = new Date(),
): AlertStatus {
  if (alert.status !== 'snoozed') return alert.status;
  if (alert.snoozedUntil === null) return 'snoozed';
  if (new Date(alert.snoozedUntil).getTime() > now.getTime()) return 'snoozed';
  return alert.acknowledgedAt !== null ? 'acknowledged' : 'active';
}

// --- Records (read DTOs) -------------------------------------------------------

/** Alert = one firm risk signal (DM-22, SCH-18). */
export interface AlertRecord {
  id: string;
  firmId: string;
  /** The generating rule; NULL for ad-hoc/operator-raised alerts (SCH-18
   *  defines no subject-binding invariant). */
  alertRuleId: string | null;
  severity: AlertSeverityKey;
  title: string;
  detail: string | null;
  clientId: string | null;
  complianceInstanceId: string | null;
  /** Rule-specific affected-entity payload (jsonb, uninterpreted). */
  affected: unknown;
  /** Persisted status exactly as stored (see effectiveStatus). */
  status: AlertStatus;
  /** Authoritative read-time status — the SCH-18 snooze-expiry derivation
   *  applied adapter-side (TEST-API-18). */
  effectiveStatus: AlertStatus;
  raisedAt: string;
  acknowledgedBy: string | null;
  acknowledgedAt: string | null;
  snoozedUntil: string | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
  resolutionType: AlertResolutionType | null;
  createdAt: string;
  updatedAt: string | null;
}

/** AlertRule = per-firm rule configuration (SCH-19, DM-22). */
export interface AlertRuleRecord {
  id: string;
  firmId: string;
  ruleKey: string;
  name: string;
  severity: AlertSeverityKey;
  /** Thresholds payload (jsonb object; content owned by the rule). */
  config: Record<string, unknown>;
  enabled: boolean;
  autoResolve: boolean;
  requiresExplicitAck: boolean;
  createdAt: string;
  updatedAt: string | null;
}

// --- Write inputs ---------------------------------------------------------------

/** Structured result of an alert transition command. 'already_applied' is a
 *  state-based replay surfacing the current row — NOT an error (API-MUT-03). */
export interface AlertTransitionResult {
  status: 'applied' | 'already_applied';
  alert: AlertRecord;
  fromStatus?: AlertStatus;
  toStatus?: AlertStatus;
  /** Machine-readable replay reason (e.g. 'already_acknowledged',
   *  'snooze_already_applied', 'already_resolved'). */
  reason?: string;
}

/**
 * Alert-rule creation (create_alert_rule, RLS-ARL-01 + AAL2). Business
 * inputs only — firmId is server-derived from the validated active-firm
 * context; id/createdAt are column defaults (API-MUT-04).
 */
export interface CreateAlertRuleInput {
  ruleKey: string;
  name: string;
  severity: AlertSeverityKey;
  config?: Record<string, unknown>;
  enabled?: boolean;
  autoResolve?: boolean;
  requiresExplicitAck?: boolean;
}

/**
 * Alert-rule patch (update_alert_rule, RLS-ARL-01 + AAL2). PATCH-style:
 * an absent field keeps the current value (the RPC coalesces NULL); a
 * supplied blank name / unknown severity is rejected (validation). ruleKey
 * and firmId are insert-only identity — not patchable.
 */
export interface UpdateAlertRuleInput {
  name?: string;
  severity?: AlertSeverityKey;
  config?: Record<string, unknown>;
  enabled?: boolean;
  autoResolve?: boolean;
  requiresExplicitAck?: boolean;
}

// --- List filters ----------------------------------------------------------------

export interface AlertListFilter {
  /** Matches the DERIVED effectiveStatus (the authoritative read surface,
   *  TEST-API-18) — an expired snooze with acknowledgement history matches
   *  'acknowledged', without it 'active'. */
  status?: AlertStatus;
  severity?: AlertSeverityKey;
  clientId?: string;
}

// --- Service contract (API-R0-ALR) -------------------------------------------------

/**
 * The provider-neutral alerts contract. Two implementations (fixture demo
 * track / Supabase production) sit behind this interface; consumers import
 * `alertsService` from `@/data` and never know which is active
 * (API-ARCH-02).
 *
 * Error semantics (API-ERR-01/02/04):
 *   - collection reads return [] when nothing is visible — never an error
 *     (RLS silent omission);
 *   - all three transition commands authorize BEFORE disclosure: unknown
 *     AND inaccessible alerts share the identical not_found surface;
 *   - invalid_state (acknowledge/snooze from resolved; the
 *     requires_explicit_ack resolve gate) throws ApiError('conflict');
 *   - rejected input (past/null snoozedUntil, blank rule key/name, unknown
 *     severity) throws ApiError('validation');
 *   - a keyed OR state-identical replay returns 'already_applied', never an
 *     error (API-MUT-03);
 *   - rule administration requires super_admin/partner + AAL2 (RLS-ARL-01,
 *     RLS-AAL-01) — denials throw ApiError('unauthorized');
 *   - there is NO alert creation path (generator is IMP-051), NO delete,
 *     NO reopen, and NO way to write status or lifecycle stamps outside the
 *     three Layer-B commands (API-ARCH-04).
 */
export interface AlertsService {
  readonly mode: DataSource;

  /** The caller's authorized alert rows (RLS-ALR-01 in production; the
   *  single fixture persona in demo mode), newest-raised first, with the
   *  snooze-expiry derivation applied (effectiveStatus). */
  listAlerts(filter?: AlertListFilter): Promise<AlertRecord[]>;

  /** The caller's visible alert rules (RLS-ARL-01: super_admin/partner/
   *  manager read scope), ordered by ruleKey. */
  listAlertRules(): Promise<AlertRuleRecord[]>;

  /**
   * SCH-18 ACKNOWLEDGE: active → acknowledged (server-stamps actor/time);
   * snoozed → acknowledged (stamps only if unstamped, clears the snooze);
   * acknowledged → already_applied; resolved → conflict (invalid_state).
   */
  acknowledgeAlert(alertId: string, mutationKey?: string): Promise<AlertTransitionResult>;

  /**
   * SCH-18 SNOOZE: active | acknowledged | snoozed → snoozed with a strictly
   * FUTURE snoozedUntil (ISO timestamptz; past/null → validation); prior
   * acknowledgement stamps are preserved; an identical already-applied
   * snooze → already_applied; a changed valid snoozedUntil is a real audited
   * update; resolved → conflict.
   */
  snoozeAlert(
    alertId: string,
    snoozedUntil: string,
    mutationKey?: string,
  ): Promise<AlertTransitionResult>;

  /**
   * SCH-18 RESOLVE: any non-resolved state → resolved with
   * resolutionType 'manual' (server-stamped actor/time); where the linked
   * rule's requiresExplicitAck is true, resolve requires acknowledgement
   * HISTORY (acknowledgedAt IS NOT NULL — not status-based); resolved →
   * already_applied. No reopen exists.
   */
  resolveAlert(alertId: string, mutationKey?: string): Promise<AlertTransitionResult>;

  /** The ONLY alert-rule insert path (RLS-ARL-01 write scope + RLS-AAL-01
   *  step-up in production); SCH-19 (firm, ruleKey) uniqueness violations
   *  are conflicts. */
  createAlertRule(input: CreateAlertRuleInput): Promise<AlertRuleRecord>;

  /** The ONLY alert-rule change path — patch semantics over the mutable
   *  column set (name/severity/config/enabled/autoResolve/
   *  requiresExplicitAck); same administration gate as creation. */
  updateAlertRule(ruleId: string, patch: UpdateAlertRuleInput): Promise<AlertRuleRecord>;

  /**
   * API-RT-01 invalidation subscription for the alert list/count. The
   * callback means "re-read through the normal RLS-controlled list" —
   * freshness signals never carry business data (API-RT-03/05). Returns the
   * unsubscribe function; subscriptions require an active-firm context and
   * are cleaned up by the caller. The Supabase implementation uses the
   * approved API-RT-07 polling fallback (see alerts/supabase.ts); fixture
   * mode simulates this locally (API-RT-04) — no Supabase channel is ever
   * opened in demo mode.
   */
  subscribeAlerts(onInvalidate: () => void): () => void;
}
