/**
 * IMP-042 (data-adapter slice) — Alerts: FIXTURE adapter (demo track,
 * MIG-DS-06).
 *
 * A deterministic in-memory mirror of the SCH-18/19 / API-R0-ALR contract,
 * seeded from the legacy demo fixture (@/data/alerts ALERTS — the demo
 * severity labels are mapped onto the SCH-18 vocabulary at the boundary)
 * and mirroring the demo store's overlay semantics (src/data/store.tsx:
 * acknowledge sets 'acknowledged', resolve sets 'resolved' — exactly the
 * SCH-18 matrix outcomes, so the demo site behaves unchanged). The demo
 * `complianceId` is a compliance-TYPE key, not an SCH-18 instance
 * reference, so seeded rows carry complianceInstanceId null. This module
 * never touches the network and never constructs the Supabase client.
 *
 * Fixture role model (documented limit): fixture mode has exactly ONE
 * caller persona — the IMP-014 tenancy demo identity
 * (`demo-fixture-membership`, role 'partner', user `demo-fixture-user`),
 * i.e. firm-wide transition + rule-administration authority in the single
 * demo firm. The adapter enforces the contract's BUSINESS semantics — the
 * SCH-18 manual transition matrix (ack from active/snoozed with
 * stamp-once + snooze-clear; snooze future-only with acknowledgement
 * preservation and identical-snooze replay; resolve with the
 * requires_explicit_ack acknowledgement-history gate; invalid_state from
 * resolved), state-based already_applied replays (API-MUT-03), SCH-19
 * rule-key uniqueness and patch semantics — but does NOT simulate the
 * RLS-ALR-01/ARL-01 role scoping or the RLS-AAL-01 step-up (there is no
 * second persona or assurance level to gate against). RLS/AAL security is
 * covered by the PASS-B integration tests.
 *
 * Snooze expiry is the SCH-18 READ derivation (deriveAlertEffectiveStatus)
 * applied at list time — the fixture performs NO expiry writes either.
 * Rule seed: none (mirrors the IMP-042 no-seed ruling, AUTO-OQ-04 open);
 * rules appear only through createAlertRule.
 *
 * Mutations are module-local and ephemeral (page reload resets them);
 * mutation-key replay is STATE-based like the production commands (the key
 * enables the replay surface but is not value-bound). API-RT-04: the
 * subscription below is a LOCAL invalidation listener — no Supabase
 * channel is opened in fixture mode.
 */
import { ALERTS } from '@/data/alerts';
import { ApiError } from '@/data/errors';

import {
  deriveAlertEffectiveStatus,
  type AlertRecord,
  type AlertRuleRecord,
  type AlertsService,
  type AlertSeverityKey,
  type AlertStatus,
  type AlertTransitionResult,
} from './types';

const DEMO_FIRM_ID = 'demo-fixture-firm';

/** The single fixture caller persona (IMP-014 tenancy fixture identity). */
const FIXTURE_CALLER = {
  membershipId: 'demo-fixture-membership',
  userId: 'demo-fixture-user',
} as const;

/** Legacy demo severity label → SCH-18/19 vocabulary (demo-only mapping). */
const LEGACY_SEVERITY_MAP: Record<string, AlertSeverityKey> = {
  critical: 'critical',
  high: 'warning',
  medium: 'warning',
  low: 'info',
};

const SEVERITIES: readonly AlertSeverityKey[] = ['info', 'warning', 'critical'];

interface FixtureStore {
  alerts: AlertRecord[];
  rules: AlertRuleRecord[];
  sequence: number;
}

let store: FixtureStore | null = null;

function buildStore(): FixtureStore {
  return {
    alerts: ALERTS.map((a) => ({
      id: a.id,
      firmId: DEMO_FIRM_ID,
      alertRuleId: null,
      severity: LEGACY_SEVERITY_MAP[a.severity] ?? 'info',
      title: a.title,
      detail: a.detail,
      clientId: a.clientId ?? null,
      // The demo complianceId is a compliance-TYPE key (e.g. 'gstr1'), not
      // an SCH-18 instance reference — no instance link is fabricated.
      complianceInstanceId: null,
      affected: null,
      status: 'active',
      effectiveStatus: 'active',
      raisedAt: a.raisedAt,
      acknowledgedBy: null,
      acknowledgedAt: null,
      snoozedUntil: null,
      resolvedBy: null,
      resolvedAt: null,
      resolutionType: null,
      createdAt: a.raisedAt,
      updatedAt: null,
    })),
    rules: [],
    sequence: 0,
  };
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

/** Read-surface copy: the snooze-expiry derivation is applied HERE, at read
 *  time (SCH-18, TEST-API-18) — never by a write. */
const readCopy = (a: AlertRecord): AlertRecord => ({
  ...a,
  effectiveStatus: deriveAlertEffectiveStatus(a),
});

const copyRule = (r: AlertRuleRecord): AlertRuleRecord => ({ ...r, config: { ...r.config } });

// --- Local invalidation listeners (API-RT-04 fixture simulation) -----------------

const listeners = new Set<() => void>();

function notifyAlertsChanged(): void {
  for (const cb of [...listeners]) cb();
}

/** Uniform pre-authorization surface (API-ERR-02): unknown and inaccessible
 *  alerts are indistinguishable. Fixture mode has no hidden rows, so this is
 *  simply the unknown-id path — kept identical by contract. */
function notFound(label: string): ApiError {
  return new ApiError('not_found', `${label} not found`);
}

function invalidState(message: string): ApiError {
  return new ApiError('conflict', `invalid_state: ${message}`);
}

export const fixtureAlerts: AlertsService = {
  mode: 'fixture',

  async listAlerts(filter) {
    let rows = state().alerts.map(readCopy);
    // The status filter matches the DERIVED effective status — the
    // authoritative read surface (TEST-API-18).
    if (filter?.status) rows = rows.filter((a) => a.effectiveStatus === filter.status);
    if (filter?.severity) rows = rows.filter((a) => a.severity === filter.severity);
    if (filter?.clientId) rows = rows.filter((a) => a.clientId === filter.clientId);
    // Newest-raised first (the Supabase adapter's order clause).
    return rows.sort((a, b) => b.raisedAt.localeCompare(a.raisedAt));
  },

  async listAlertRules() {
    return [...state().rules]
      .sort((a, b) => a.ruleKey.localeCompare(b.ruleKey))
      .map(copyRule);
  },

  async acknowledgeAlert(alertId): Promise<AlertTransitionResult> {
    // The mutation key needs no value binding: replay is state-based
    // (API-MUT-03), identical to the production command.
    const found = state().alerts.find((a) => a.id === alertId);
    if (!found) throw notFound('alert');

    // State-based replay (API-MUT-03, SCH-18 matrix): already acknowledged
    // returns already_applied — no second stamp, no second audit.
    if (found.status === 'acknowledged') {
      return { status: 'already_applied', reason: 'already_acknowledged', alert: readCopy(found) };
    }
    if (found.status === 'resolved') {
      throw invalidState(
        'cannot acknowledge a resolved alert (SCH-18 manual transition matrix; no reopen)',
      );
    }

    const fromStatus: AlertStatus = found.status;
    found.status = 'acknowledged';
    // snoozed → acknowledged stamps ONLY if not already stamped
    // (acknowledge → snooze history is preserved); the matrix clears the
    // open snooze on acknowledge.
    found.acknowledgedBy = found.acknowledgedBy ?? FIXTURE_CALLER.userId;
    found.acknowledgedAt = found.acknowledgedAt ?? now();
    found.snoozedUntil = null;
    found.updatedAt = now();
    notifyAlertsChanged();
    return {
      status: 'applied',
      fromStatus,
      toStatus: 'acknowledged',
      alert: readCopy(found),
    };
  },

  async snoozeAlert(alertId, snoozedUntil): Promise<AlertTransitionResult> {
    const found = state().alerts.find((a) => a.id === alertId);
    if (!found) throw notFound('alert');

    const until = new Date(snoozedUntil);
    if (snoozedUntil == null || Number.isNaN(until.getTime())) {
      throw new ApiError('validation', 'snoozed_until must be in the future (SCH-18 SNOOZE matrix)');
    }

    // State-based replay precedes future-validation (API-MUT-03): the
    // identical already-applied snooze (same instant — production compares
    // timestamptz, so equivalent string forms replay) is already_applied;
    // every non-identical target is validated future-only.
    if (
      found.status === 'snoozed' &&
      found.snoozedUntil !== null &&
      new Date(found.snoozedUntil).getTime() === until.getTime()
    ) {
      return { status: 'already_applied', reason: 'snooze_already_applied', alert: readCopy(found) };
    }

    if (until.getTime() <= Date.now()) {
      throw new ApiError('validation', 'snoozed_until must be in the future (SCH-18 SNOOZE matrix)');
    }
    if (found.status === 'resolved') {
      throw invalidState(
        'cannot snooze a resolved alert (SCH-18 manual transition matrix; no reopen)',
      );
    }

    const fromStatus: AlertStatus = found.status;
    found.status = 'snoozed';
    found.snoozedUntil = until.toISOString();
    // acknowledgedBy/acknowledgedAt untouched: a prior acknowledgement is
    // preserved through snooze (SCH-18).
    found.updatedAt = now();
    notifyAlertsChanged();
    return { status: 'applied', fromStatus, toStatus: 'snoozed', alert: readCopy(found) };
  },

  async resolveAlert(alertId): Promise<AlertTransitionResult> {
    const found = state().alerts.find((a) => a.id === alertId);
    if (!found) throw notFound('alert');

    if (found.status === 'resolved') {
      return { status: 'already_applied', reason: 'already_resolved', alert: readCopy(found) };
    }

    // Explicit-ack gate (SCH-18): derived from the linked rule, and based on
    // acknowledgement HISTORY (acknowledgedAt IS NOT NULL), not status.
    if (found.alertRuleId !== null) {
      const rule = state().rules.find((r) => r.id === found.alertRuleId);
      if (rule?.requiresExplicitAck && found.acknowledgedAt === null) {
        throw invalidState(
          'this rule requires explicit acknowledgement before manual resolve (requires_explicit_ack=true, acknowledged_at IS NULL)',
        );
      }
    }

    const fromStatus: AlertStatus = found.status;
    found.status = 'resolved';
    found.resolvedBy = FIXTURE_CALLER.userId;
    found.resolvedAt = now();
    found.resolutionType = 'manual';
    // acknowledged_*/snoozedUntil untouched: history is retained.
    found.updatedAt = now();
    notifyAlertsChanged();
    return { status: 'applied', fromStatus, toStatus: 'resolved', alert: readCopy(found) };
  },

  async createAlertRule(input) {
    if (!input.ruleKey.trim()) throw new ApiError('validation', 'rule_key is required (SCH-19)');
    if (!input.name.trim()) throw new ApiError('validation', 'name is required (SCH-19)');
    if (!SEVERITIES.includes(input.severity)) {
      throw new ApiError(
        'validation',
        `unknown severity '${input.severity}' (SCH-18/19 vocabulary)`,
      );
    }
    const key = input.ruleKey.trim();
    if (state().rules.some((r) => r.ruleKey === key)) {
      throw new ApiError(
        'conflict',
        `an alert rule with rule_key '${key}' already exists in this firm (SCH-19 uniqueness)`,
      );
    }
    const record: AlertRuleRecord = {
      id: nextId('alert-rule'),
      firmId: DEMO_FIRM_ID, // server-derived from the active-firm context
      ruleKey: key,
      name: input.name.trim(),
      severity: input.severity,
      config: input.config ?? {},
      enabled: input.enabled ?? true,
      autoResolve: input.autoResolve ?? true,
      requiresExplicitAck: input.requiresExplicitAck ?? false,
      createdAt: now(),
      updatedAt: null,
    };
    state().rules.push(record);
    notifyAlertsChanged();
    return copyRule(record);
  },

  async updateAlertRule(ruleId, patch) {
    const found = state().rules.find((r) => r.id === ruleId);
    if (!found) throw notFound('alert rule');
    // Patch semantics: an absent field keeps the current value; a SUPPLIED
    // blank name / unknown severity is malformed input (validation).
    if (patch.name !== undefined && !patch.name.trim()) {
      throw new ApiError('validation', 'name must be non-empty when supplied (SCH-19)');
    }
    if (patch.severity !== undefined && !SEVERITIES.includes(patch.severity)) {
      throw new ApiError(
        'validation',
        `unknown severity '${patch.severity}' (SCH-18/19 vocabulary)`,
      );
    }
    if (patch.name !== undefined) found.name = patch.name.trim();
    if (patch.severity !== undefined) found.severity = patch.severity;
    if (patch.config !== undefined) found.config = patch.config;
    if (patch.enabled !== undefined) found.enabled = patch.enabled;
    if (patch.autoResolve !== undefined) found.autoResolve = patch.autoResolve;
    if (patch.requiresExplicitAck !== undefined) {
      found.requiresExplicitAck = patch.requiresExplicitAck;
    }
    found.updatedAt = now();
    notifyAlertsChanged();
    return copyRule(found);
  },

  subscribeAlerts(onInvalidate) {
    listeners.add(onInvalidate);
    return () => {
      listeners.delete(onInvalidate);
    };
  },
};
