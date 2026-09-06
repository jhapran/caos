/**
 * IMP-042 (data-adapter slice) — Supabase alerts adapter contract test
 * (production path, network mocked).
 *
 * Pins the adapter to the exact granted surface of the IMP-042 PASS-B
 * contract: it mocks the browser client boundary (@/lib/supabaseClient),
 * captures the exact rpc invocations / table reads / realtime channels, and
 * asserts:
 *
 *   - reads are plain RLS-filtered PostgREST on alerts / alert_rules with
 *     the fixed SCH-18/19 projections; severity/clientId filters are eq()
 *     only; the status filter matches the DERIVED effective status
 *     (TEST-API-18: the snooze-expiry derivation is applied after SELECT —
 *     expired snooze + acknowledged_at → 'acknowledged', else 'active'; a
 *     future snooze is unchanged; reads perform NO expiry writes);
 *   - acknowledge/snooze/resolve carry exactly p_alert_id /
 *     p_snoozed_until / p_mutation_key (the PASS-B signatures) — never
 *     firm_id, actor, timestamp, status, or resolution_type (API-MUT-04);
 *   - create/update_alert_rule carry exactly the PASS-B parameter lists
 *     (patch-style NULLs keep current values);
 *   - structured denials map onto the API-ERR-01 taxonomy; already_applied
 *     is a DTO, never an error;
 *   - NO direct alerts/alert_rules INSERT/UPDATE/DELETE is ever issued
 *     (SELECT-only browser grants; the five Layer-B commands are the only
 *     write paths, API-ARCH-04);
 *   - subscribeAlerts is the API-RT-07 polling fallback: a bare
 *     invalidation tick every ALERTS_POLL_INTERVAL_MS, NO realtime channel
 *     opened, unsubscribe clears the timer; without an active firm it is a
 *     no-op.
 *
 * The supabase adapter is imported DIRECTLY here (not via the
 * DATA_SOURCE-pinned selector) — a test-only reach into the implementation
 * module to verify the production contract without a backend.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearActiveFirm, setActiveFirm } from '@/data/context';

const NOW = '2026-09-06T12:00:00.000Z';

const ALERT_ROW = {
  id: 'al-1',
  firm_id: 'firm-1',
  alert_rule_id: 'rule-1',
  severity: 'critical',
  title: 'GSTR-1 overdue',
  detail: 'three clients',
  client_id: 'client-1',
  compliance_instance_id: null,
  affected: { clients: ['client-1'] },
  status: 'active',
  raised_at: '2026-09-05T08:15:00.000Z',
  acknowledged_by: null,
  acknowledged_at: null,
  snoozed_until: null,
  resolved_by: null,
  resolved_at: null,
  resolution_type: null,
  created_at: '2026-09-05T08:15:00.000Z',
  updated_at: null,
};

const RULE_ROW = {
  id: 'rule-1',
  firm_id: 'firm-1',
  rule_key: 'deadline-risk',
  name: 'Deadline risk',
  severity: 'critical',
  config: { daysThreshold: 7 },
  enabled: true,
  auto_resolve: true,
  requires_explicit_ack: false,
  created_at: '2026-09-01T00:00:00.000Z',
  updated_at: null,
};

interface CapturedTable {
  table: string;
  verb?: 'insert' | 'update' | 'delete';
  eq: [string, unknown][];
}
interface CapturedRpc {
  name: string;
  params: Record<string, unknown>;
}

const tableCalls: CapturedTable[] = [];
const rpcCalls: CapturedRpc[] = [];
let rpcResults: Record<string, unknown> = {};
let listRows: Record<string, unknown[]> = {};

vi.mock('@/lib/supabaseClient', () => ({
  getSupabaseClient: () => ({
    from: (table: string) => {
      const entry: CapturedTable = { table, eq: [] };
      tableCalls.push(entry);
      const builder: Record<string, unknown> = {
        select: () => builder,
        insert: () => {
          entry.verb = 'insert';
          return builder;
        },
        update: () => {
          entry.verb = 'update';
          return builder;
        },
        delete: () => {
          entry.verb = 'delete';
          return builder;
        },
        eq: (col: string, val: unknown) => {
          entry.eq.push([col, val]);
          return builder;
        },
        order: () => builder,
        then: (resolve: (v: unknown) => void) =>
          resolve({ data: listRows[table] ?? [], error: null }),
      };
      return builder;
    },
    rpc: async (name: string, params: Record<string, unknown>) => {
      rpcCalls.push({ name, params });
      return { data: rpcResults[name] ?? null, error: null };
    },
    // Any realtime channel usage must show up in tests as a failure signal.
    channel: () => {
      throw new Error('no realtime channel may be opened (API-RT-07 polling fallback)');
    },
  }),
}));

import { ALERTS_POLL_INTERVAL_MS, supabaseAlerts } from '@/data/alerts/supabase';

describe('supabase alerts adapter — reads', () => {
  beforeEach(() => {
    tableCalls.length = 0;
    rpcCalls.length = 0;
    rpcResults = {};
    listRows = {};
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
    setActiveFirm('firm-1');
  });

  afterEach(() => {
    vi.useRealTimers();
    clearActiveFirm();
  });

  it('lists RLS-filtered alerts with the SCH-18 projection, mapped to camelCase DTOs', async () => {
    listRows['alerts'] = [ALERT_ROW];
    const alerts = await supabaseAlerts.listAlerts();
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      id: 'al-1',
      firmId: 'firm-1',
      alertRuleId: 'rule-1',
      severity: 'critical',
      status: 'active',
      effectiveStatus: 'active',
      affected: { clients: ['client-1'] },
      resolutionType: null,
    });
    expect(alerts[0]).not.toHaveProperty('firm_id');
    expect(alerts[0]).not.toHaveProperty('raised_at');
    // UX filters narrow through eq() only; the server applies them (the
    // mock simulates that by returning nothing), and an empty result is []
    // not an error.
    listRows['alerts'] = [];
    expect(await supabaseAlerts.listAlerts({ severity: 'warning', clientId: 'c-9' })).toEqual([]);
    const filterCall = tableCalls[tableCalls.length - 1];
    expect(filterCall.eq).toEqual([
      ['severity', 'warning'],
      ['client_id', 'c-9'],
    ]);
    expect(tableCalls.every((c) => c.table === 'alerts')).toBe(true);
    expect(tableCalls.every((c) => c.verb === undefined)).toBe(true);
  });

  it('applies the snooze-expiry read derivation after SELECT (TEST-API-18)', async () => {
    listRows['alerts'] = [
      // Expired snooze WITH acknowledgement history → acknowledged.
      {
        ...ALERT_ROW,
        id: 'al-exp-ack',
        status: 'snoozed',
        snoozed_until: '2026-09-06T11:59:59.000Z',
        acknowledged_by: 'user-1',
        acknowledged_at: '2026-09-05T09:00:00.000Z',
      },
      // Expired snooze WITHOUT acknowledgement history → active.
      {
        ...ALERT_ROW,
        id: 'al-exp-noack',
        status: 'snoozed',
        snoozed_until: '2026-09-01T00:00:00.000Z',
      },
      // Future snooze → unchanged.
      {
        ...ALERT_ROW,
        id: 'al-future',
        status: 'snoozed',
        snoozed_until: '2026-09-07T00:00:00.000Z',
      },
    ];
    const alerts = await supabaseAlerts.listAlerts();
    const byId = new Map(alerts.map((a) => [a.id, a]));
    expect(byId.get('al-exp-ack')!.status).toBe('snoozed'); // persisted untouched
    expect(byId.get('al-exp-ack')!.effectiveStatus).toBe('acknowledged');
    expect(byId.get('al-exp-noack')!.effectiveStatus).toBe('active');
    expect(byId.get('al-future')!.effectiveStatus).toBe('snoozed');
    // The status filter matches the DERIVED status.
    const active = await supabaseAlerts.listAlerts({ status: 'active' });
    expect(active.map((a) => a.id)).toEqual(['al-exp-noack']);
    const snoozed = await supabaseAlerts.listAlerts({ status: 'snoozed' });
    expect(snoozed.map((a) => a.id)).toEqual(['al-future']);
    // Reads perform NO expiry writes — no update was ever issued.
    expect(tableCalls.every((c) => c.verb === undefined)).toBe(true);
  });

  it('lists alert rules with the SCH-19 projection ordered by rule_key', async () => {
    listRows['alert_rules'] = [RULE_ROW];
    const rules = await supabaseAlerts.listAlertRules();
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({
      id: 'rule-1',
      ruleKey: 'deadline-risk',
      requiresExplicitAck: false,
      config: { daysThreshold: 7 },
    });
    expect(rules[0]).not.toHaveProperty('rule_key');
    expect(tableCalls[0].table).toBe('alert_rules');
    expect(tableCalls[0].verb).toBeUndefined();
  });
});

describe('supabase alerts adapter — transition commands (API-R0-ALR)', () => {
  beforeEach(() => {
    tableCalls.length = 0;
    rpcCalls.length = 0;
    rpcResults = {};
    setActiveFirm('firm-1');
  });

  afterEach(() => {
    clearActiveFirm();
  });

  it('acknowledge_alert carries exactly p_alert_id + p_mutation_key; result maps onto the DTO', async () => {
    rpcResults['acknowledge_alert'] = {
      status: 'acknowledged',
      from_status: 'active',
      to_status: 'acknowledged',
      alert: {
        ...ALERT_ROW,
        status: 'acknowledged',
        acknowledged_by: 'user-1',
        acknowledged_at: '2026-09-06T12:00:00.000Z',
      },
    };
    const result = await supabaseAlerts.acknowledgeAlert('al-1', 'mk-1');
    expect(result.status).toBe('applied');
    expect(result.fromStatus).toBe('active');
    expect(result.toStatus).toBe('acknowledged');
    expect(result.alert.acknowledgedBy).toBe('user-1');
    expect(rpcCalls).toEqual([
      { name: 'acknowledge_alert', params: { p_alert_id: 'al-1', p_mutation_key: 'mk-1' } },
    ]);
    expect(tableCalls).toHaveLength(0); // no direct table write
  });

  it('snooze_alert carries p_snoozed_until; omitted mutation key is null, never undefined', async () => {
    rpcResults['snooze_alert'] = {
      status: 'snoozed',
      from_status: 'active',
      to_status: 'snoozed',
      alert: { ...ALERT_ROW, status: 'snoozed', snoozed_until: '2026-09-10T00:00:00.000Z' },
    };
    const result = await supabaseAlerts.snoozeAlert('al-1', '2026-09-10T00:00:00.000Z');
    expect(result.status).toBe('applied');
    expect(result.alert.snoozedUntil).toBe('2026-09-10T00:00:00.000Z');
    expect(rpcCalls).toEqual([
      {
        name: 'snooze_alert',
        params: {
          p_alert_id: 'al-1',
          p_snoozed_until: '2026-09-10T00:00:00.000Z',
          p_mutation_key: null,
        },
      },
    ]);
    expect(tableCalls).toHaveLength(0);
  });

  it('resolve_alert maps already_applied and the invalid_state / gate denials', async () => {
    rpcResults['resolve_alert'] = {
      status: 'already_applied',
      reason: 'already_resolved',
      alert: {
        ...ALERT_ROW,
        status: 'resolved',
        resolved_by: 'user-1',
        resolved_at: '2026-09-06T12:00:00.000Z',
        resolution_type: 'manual',
      },
    };
    const replay = await supabaseAlerts.resolveAlert('al-1', 'mk-2');
    expect(replay.status).toBe('already_applied');
    expect(replay.reason).toBe('already_resolved');
    expect(replay.alert.resolutionType).toBe('manual');

    // The requires_explicit_ack gate denial (acknowledgement-history based).
    rpcResults['resolve_alert'] = {
      status: 'denied',
      kind: 'conflict',
      message: 'invalid_state: this rule requires explicit acknowledgement before manual resolve',
    };
    await expect(supabaseAlerts.resolveAlert('al-1')).rejects.toMatchObject({
      name: 'ApiError',
      kind: 'conflict',
    });

    // Pre-authorization not_found (API-ERR-02 uniform surface).
    rpcResults['resolve_alert'] = {
      status: 'denied',
      kind: 'not_found',
      message: 'alert not found',
    };
    await expect(supabaseAlerts.resolveAlert('hidden')).rejects.toMatchObject({
      kind: 'not_found',
    });

    expect(rpcCalls[0]).toEqual({
      name: 'resolve_alert',
      params: { p_alert_id: 'al-1', p_mutation_key: 'mk-2' },
    });
    expect(tableCalls).toHaveLength(0);
  });

  it('structured denials map onto the API-ERR-01 taxonomy', async () => {
    rpcResults['acknowledge_alert'] = {
      status: 'denied',
      kind: 'unauthorized',
      message: 'role below manager',
    };
    await expect(supabaseAlerts.acknowledgeAlert('al-1')).rejects.toMatchObject({
      kind: 'unauthorized',
    });
    rpcResults['snooze_alert'] = {
      status: 'denied',
      kind: 'validation',
      message: 'snoozed_until must be in the future',
    };
    await expect(
      supabaseAlerts.snoozeAlert('al-1', '2026-09-01T00:00:00.000Z'),
    ).rejects.toMatchObject({ kind: 'validation' });
    rpcResults['acknowledge_alert'] = {
      status: 'denied',
      kind: 'conflict',
      message: 'invalid_state: cannot acknowledge a resolved alert',
    };
    await expect(supabaseAlerts.acknowledgeAlert('al-1')).rejects.toMatchObject({
      kind: 'conflict',
    });
  });

  it('a command result carrying no alert row is an internal error (contract breach)', async () => {
    rpcResults['acknowledge_alert'] = { status: 'acknowledged' };
    await expect(supabaseAlerts.acknowledgeAlert('al-1')).rejects.toMatchObject({
      kind: 'internal',
    });
  });
});

describe('supabase alerts adapter — rule administration (RLS-ARL-01 + RLS-AAL-01)', () => {
  beforeEach(() => {
    tableCalls.length = 0;
    rpcCalls.length = 0;
    rpcResults = {};
    setActiveFirm('firm-1');
  });

  afterEach(() => {
    clearActiveFirm();
  });

  it('create_alert_rule carries ONLY the business inputs with server defaults explicit', async () => {
    rpcResults['create_alert_rule'] = { status: 'created', rule: RULE_ROW };
    const rule = await supabaseAlerts.createAlertRule({
      ruleKey: 'deadline-risk',
      name: 'Deadline risk',
      severity: 'critical',
      config: { daysThreshold: 7 },
    });
    expect(rule.id).toBe('rule-1');
    expect(rpcCalls).toEqual([
      {
        name: 'create_alert_rule',
        params: {
          p_rule_key: 'deadline-risk',
          p_name: 'Deadline risk',
          p_severity: 'critical',
          p_config: { daysThreshold: 7 },
          p_enabled: true,
          p_auto_resolve: true,
          p_requires_explicit_ack: false,
        },
      },
    ]);
    // Never firm_id / actor fields (API-MUT-04).
    expect(Object.keys(rpcCalls[0].params)).not.toContain('p_firm_id');
    expect(tableCalls).toHaveLength(0);
  });

  it('update_alert_rule is patch-style: absent fields are sent as NULL (keep current)', async () => {
    rpcResults['update_alert_rule'] = {
      status: 'updated',
      rule: { ...RULE_ROW, enabled: false, updated_at: '2026-09-06T12:00:00.000Z' },
    };
    const rule = await supabaseAlerts.updateAlertRule('rule-1', { enabled: false });
    expect(rule.enabled).toBe(false);
    expect(rpcCalls).toEqual([
      {
        name: 'update_alert_rule',
        params: {
          p_rule_id: 'rule-1',
          p_name: null,
          p_severity: null,
          p_config: null,
          p_enabled: false,
          p_auto_resolve: null,
          p_requires_explicit_ack: null,
        },
      },
    ]);
    expect(tableCalls).toHaveLength(0);
  });

  it('administration denials map: AAL2/role → unauthorized, duplicate key → conflict, unknown → not_found', async () => {
    rpcResults['create_alert_rule'] = {
      status: 'denied',
      kind: 'unauthorized',
      message: 'AAL2 step-up required for alert-rule administration (RLS-AAL-01)',
    };
    await expect(
      supabaseAlerts.createAlertRule({ ruleKey: 'k', name: 'n', severity: 'info' }),
    ).rejects.toMatchObject({ kind: 'unauthorized' });

    rpcResults['create_alert_rule'] = {
      status: 'denied',
      kind: 'conflict',
      message: 'an alert rule with rule_key already exists in this firm',
    };
    await expect(
      supabaseAlerts.createAlertRule({ ruleKey: 'k', name: 'n', severity: 'info' }),
    ).rejects.toMatchObject({ kind: 'conflict' });

    rpcResults['update_alert_rule'] = {
      status: 'denied',
      kind: 'not_found',
      message: 'alert rule not found',
    };
    await expect(supabaseAlerts.updateAlertRule('rule-nope', { enabled: true })).rejects.toMatchObject(
      { kind: 'not_found' },
    );
  });
});

describe('supabase alerts adapter — freshness (API-RT-01 via the API-RT-07 polling fallback)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setActiveFirm('firm-1');
  });

  afterEach(() => {
    vi.useRealTimers();
    clearActiveFirm();
  });

  it('ticks invalidation on the polling interval and opens NO realtime channel', () => {
    let invalidated = 0;
    const unsubscribe = supabaseAlerts.subscribeAlerts(() => {
      invalidated += 1;
    });
    // No immediate fire, and no postgres_changes channel at all (the mock
    // throws if one is opened) — the approved API-RT-07 fallback is polling.
    expect(invalidated).toBe(0);
    vi.advanceTimersByTime(ALERTS_POLL_INTERVAL_MS);
    expect(invalidated).toBe(1);
    vi.advanceTimersByTime(ALERTS_POLL_INTERVAL_MS * 2);
    expect(invalidated).toBe(3);
    unsubscribe();
  });

  it('unsubscribe clears the timer — no further invalidations, no leak', () => {
    let invalidated = 0;
    const unsubscribe = supabaseAlerts.subscribeAlerts(() => {
      invalidated += 1;
    });
    vi.advanceTimersByTime(ALERTS_POLL_INTERVAL_MS);
    expect(invalidated).toBe(1);
    unsubscribe();
    vi.advanceTimersByTime(ALERTS_POLL_INTERVAL_MS * 5);
    expect(invalidated).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('without an active firm the subscription is a no-op', () => {
    clearActiveFirm();
    const unsubscribe = supabaseAlerts.subscribeAlerts(() => {});
    vi.advanceTimersByTime(ALERTS_POLL_INTERVAL_MS * 2);
    expect(vi.getTimerCount()).toBe(0);
    expect(() => unsubscribe()).not.toThrow();
  });

  it('simultaneous consumers poll on independent timers and unsubscribe independently', () => {
    let first = 0;
    let second = 0;
    const unsubFirst = supabaseAlerts.subscribeAlerts(() => {
      first += 1;
    });
    const unsubSecond = supabaseAlerts.subscribeAlerts(() => {
      second += 1;
    });
    vi.advanceTimersByTime(ALERTS_POLL_INTERVAL_MS);
    expect(first).toBe(1);
    expect(second).toBe(1);
    unsubFirst();
    vi.advanceTimersByTime(ALERTS_POLL_INTERVAL_MS);
    expect(first).toBe(1);
    expect(second).toBe(2);
    unsubSecond();
    expect(vi.getTimerCount()).toBe(0);
  });
});
