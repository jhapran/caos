/**
 * IMP-042 (data-adapter slice) — Fixture alerts adapter contract test
 * (demo track) + the SCH-18 snooze-expiry read-derivation unit family
 * (TEST-API-18 read portion).
 *
 * Runs under the unit harness, which pins DATA_SOURCE=fixture
 * (tests/setup.ts), so alertsService resolves to the fixture
 * implementation. Verifies the deterministic seed (legacy demo labels
 * mapped onto the SCH-18 vocabulary at the boundary) and the fixture mirror
 * of the production contract (API-R0-ALR): the SCH-18 manual transition
 * matrix (ack from active/snoozed with stamp-once + snooze-clear; snooze
 * future-only preserving acknowledgement history, identical-snooze replay;
 * resolve with resolution_type 'manual'; invalid_state from resolved →
 * conflict), state-based already_applied replays (API-MUT-03), SCH-19
 * rule-key uniqueness and patch semantics, and the local invalidation
 * subscription (API-RT-04).
 *
 * Fixture role-model limit: fixture mode has ONE caller persona
 * ('demo-fixture-membership', partner, firm-wide) — the RLS-ALR-01/ARL-01
 * role scoping and the RLS-AAL-01 step-up are NOT simulated (no second
 * persona / assurance level exists); the business semantics above ARE
 * enforced. RLS/AAL security is covered by the PASS-B integration tests.
 *
 * NOTE: the fixture store is module-local and shared across the tests in
 * this file; scenarios use their own alert/rule ids or are sequenced so
 * earlier mutations cannot poison later assertions.
 */
import { describe, expect, it } from 'vitest';

import type { ApiError } from '@/data/errors';
// NOTE: '@/data/alerts' is the LEGACY flat fixture module (file-first
// resolution) — the IMP-042 service is imported via its explicit selector
// path (same as the barrel's './alerts/index' wiring).
import { alertsService as svc } from '@/data/alerts/alertsService';
import { deriveAlertEffectiveStatus } from '@/data/alerts/types';

const apiError = (kind: string) =>
  expect.objectContaining({ kind }) as unknown as ApiError;

const FUTURE = () => new Date(Date.now() + 24 * 3600_000).toISOString();
const PAST = '2026-09-01T00:00:00.000Z';

describe('fixture alerts adapter — seed & reads', () => {
  it('resolves to fixture mode under the unit harness and is barrel-reachable', async () => {
    expect(svc.mode).toBe('fixture');
    const { alertsService } = await import('@/data');
    expect(alertsService).toBe(svc);
  });

  it('serves the deterministic 5-alert seed mapped onto the SCH-18 vocabulary', async () => {
    const alerts = await svc.listAlerts();
    expect(alerts.map((a) => a.id)).toEqual(['a-01', 'a-02', 'a-03', 'a-04', 'a-05']);
    // Newest-raised first; demo severity labels mapped: critical→critical,
    // high/medium→warning, low→info.
    expect(alerts.map((a) => a.severity)).toEqual([
      'critical',
      'critical',
      'warning',
      'warning',
      'info',
    ]);
    expect(alerts.every((a) => a.status === 'active')).toBe(true);
    expect(alerts.every((a) => a.effectiveStatus === 'active')).toBe(true);
    expect(alerts.every((a) => a.firmId === 'demo-fixture-firm')).toBe(true);
    // The demo complianceId is a type key — no instance link is fabricated.
    expect(alerts.every((a) => a.complianceInstanceId === null)).toBe(true);
    // CamelCase DTOs — no provider keys cross the boundary.
    expect(alerts[0]).not.toHaveProperty('firm_id');
    expect(alerts[0]).not.toHaveProperty('raised_at');
  });

  it('list filters by effective status, severity, and client', async () => {
    expect((await svc.listAlerts({ status: 'active' })).length).toBe(5);
    expect(await svc.listAlerts({ status: 'acknowledged' })).toEqual([]);
    const critical = await svc.listAlerts({ severity: 'critical' });
    expect(critical.map((a) => a.id)).toEqual(['a-01', 'a-02']);
    const abc = await svc.listAlerts({ clientId: 'c-abc' });
    expect(abc.length).toBeGreaterThan(0);
    expect(abc.every((a) => a.clientId === 'c-abc')).toBe(true);
  });
});

describe('fixture alerts adapter — acknowledge (SCH-18 matrix)', () => {
  it('active → acknowledged with server-derived stamps', async () => {
    const result = await svc.acknowledgeAlert('a-03', 'mk-ack-1');
    expect(result.status).toBe('applied');
    expect(result.fromStatus).toBe('active');
    expect(result.toStatus).toBe('acknowledged');
    expect(result.alert).toMatchObject({
      id: 'a-03',
      status: 'acknowledged',
      effectiveStatus: 'acknowledged',
      acknowledgedBy: 'demo-fixture-user',
      snoozedUntil: null,
    });
    expect(result.alert.acknowledgedAt).toBeTruthy();
  });

  it('acknowledged → already_applied replay (never an error, no re-stamp)', async () => {
    const first = await svc.listAlerts();
    const stamp = first.find((a) => a.id === 'a-03')!.acknowledgedAt;
    const replay = await svc.acknowledgeAlert('a-03', 'mk-ack-2');
    expect(replay.status).toBe('already_applied');
    expect(replay.reason).toBe('already_acknowledged');
    expect(replay.alert.acknowledgedAt).toBe(stamp);
  });

  it('unknown alert id is the uniform not_found surface (API-ERR-02)', async () => {
    await expect(svc.acknowledgeAlert('a-nope')).rejects.toEqual(apiError('not_found'));
    await expect(svc.resolveAlert('a-nope')).rejects.toEqual(apiError('not_found'));
    await expect(svc.snoozeAlert('a-nope', FUTURE())).rejects.toEqual(apiError('not_found'));
  });
});

describe('fixture alerts adapter — snooze (SCH-18 matrix)', () => {
  it('active → snoozed; a prior acknowledgement is preserved through snooze', async () => {
    // a-03 was acknowledged above: ack → snooze keeps the stamp (SCH-18).
    const until = FUTURE();
    const result = await svc.snoozeAlert('a-03', until);
    expect(result.status).toBe('applied');
    expect(result.fromStatus).toBe('acknowledged');
    expect(result.toStatus).toBe('snoozed');
    expect(result.alert.status).toBe('snoozed');
    expect(result.alert.snoozedUntil).toBe(until);
    expect(result.alert.acknowledgedBy).toBe('demo-fixture-user');
    expect(result.alert.acknowledgedAt).toBeTruthy();
  });

  it('an identical already-applied snooze replays; a changed until is a real update', async () => {
    const current = (await svc.listAlerts()).find((a) => a.id === 'a-03')!;
    const replay = await svc.snoozeAlert('a-03', current.snoozedUntil!);
    expect(replay.status).toBe('already_applied');
    expect(replay.reason).toBe('snooze_already_applied');

    const changed = await svc.snoozeAlert('a-03', new Date(Date.now() + 48 * 3600_000).toISOString());
    expect(changed.status).toBe('applied');
    expect(changed.fromStatus).toBe('snoozed');
    expect(changed.alert.snoozedUntil).not.toBe(current.snoozedUntil);
  });

  it('snooze requires a strictly future snoozedUntil (validation)', async () => {
    await expect(svc.snoozeAlert('a-05', PAST)).rejects.toEqual(apiError('validation'));
    await expect(svc.snoozeAlert('a-05', 'not-a-date')).rejects.toEqual(apiError('validation'));
    // Unchanged after the rejected commands.
    expect((await svc.listAlerts()).find((a) => a.id === 'a-05')!.status).toBe('active');
  });

  it('acknowledge from snoozed clears the snooze and does not re-stamp acknowledgement', async () => {
    const before = (await svc.listAlerts()).find((a) => a.id === 'a-03')!;
    const result = await svc.acknowledgeAlert('a-03');
    expect(result.status).toBe('applied');
    expect(result.fromStatus).toBe('snoozed');
    expect(result.alert.status).toBe('acknowledged');
    expect(result.alert.snoozedUntil).toBeNull();
    expect(result.alert.acknowledgedAt).toBe(before.acknowledgedAt); // stamp-once
  });
});

describe('fixture alerts adapter — resolve (SCH-18 matrix)', () => {
  it('active → resolved with manual resolution stamps; replay is already_applied', async () => {
    const result = await svc.resolveAlert('a-04', 'mk-res-1');
    expect(result.status).toBe('applied');
    expect(result.toStatus).toBe('resolved');
    expect(result.alert).toMatchObject({
      status: 'resolved',
      effectiveStatus: 'resolved',
      resolvedBy: 'demo-fixture-user',
      resolutionType: 'manual',
    });
    const replay = await svc.resolveAlert('a-04', 'mk-res-2');
    expect(replay.status).toBe('already_applied');
    expect(replay.reason).toBe('already_resolved');
  });

  it('invalid_state: acknowledge/snooze from resolved is a conflict (no reopen)', async () => {
    await expect(svc.acknowledgeAlert('a-04')).rejects.toEqual(apiError('conflict'));
    await expect(svc.snoozeAlert('a-04', FUTURE())).rejects.toEqual(apiError('conflict'));
    // ...while resolve from resolved stays the already_applied replay DTO.
    const replay = await svc.resolveAlert('a-04');
    expect(replay.status).toBe('already_applied');
  });
});

describe('fixture alerts adapter — snooze-expiry READ derivation (SCH-18, TEST-API-18)', () => {
  const NOW = new Date('2026-09-06T12:00:00.000Z');

  it('expired snooze with acknowledgement history reads as acknowledged', () => {
    expect(
      deriveAlertEffectiveStatus(
        { status: 'snoozed', snoozedUntil: '2026-09-06T11:59:59.000Z', acknowledgedAt: '2026-09-05T00:00:00.000Z' },
        NOW,
      ),
    ).toBe('acknowledged');
  });

  it('expired snooze without acknowledgement history reads as active', () => {
    expect(
      deriveAlertEffectiveStatus(
        { status: 'snoozed', snoozedUntil: '2026-09-01T00:00:00.000Z', acknowledgedAt: null },
        NOW,
      ),
    ).toBe('active');
  });

  it('the boundary is inclusive: snoozedUntil == now reads as expired', () => {
    expect(
      deriveAlertEffectiveStatus(
        { status: 'snoozed', snoozedUntil: '2026-09-06T12:00:00.000Z', acknowledgedAt: null },
        NOW,
      ),
    ).toBe('active');
  });

  it('a future snooze is unchanged; non-snoozed statuses read as themselves', () => {
    expect(
      deriveAlertEffectiveStatus(
        { status: 'snoozed', snoozedUntil: '2026-09-06T12:00:01.000Z', acknowledgedAt: null },
        NOW,
      ),
    ).toBe('snoozed');
    for (const status of ['active', 'acknowledged', 'resolved'] as const) {
      expect(
        deriveAlertEffectiveStatus({ status, snoozedUntil: null, acknowledgedAt: null }, NOW),
      ).toBe(status);
    }
  });

  it('the read path performs NO expiry writes — the persisted status is untouched', async () => {
    // a-03 is persisted 'snoozed'→acknowledged above; a read must surface
    // the derivation WITHOUT mutating the persisted row.
    const first = await svc.listAlerts();
    const a03 = first.find((a) => a.id === 'a-03')!;
    expect(a03.status).toBe('acknowledged'); // persisted (post-ack)
    expect(a03.effectiveStatus).toBe('acknowledged');
    const second = await svc.listAlerts();
    expect(second.find((a) => a.id === 'a-03')).toEqual(a03); // no drift
  });
});

describe('fixture alerts adapter — rule administration (SCH-19, RLS-ARL-01 surface)', () => {
  it('no rule seeds ship (AUTO-OQ-04); created rules list by ruleKey', async () => {
    const created = await svc.createAlertRule({
      ruleKey: 'deadline-risk',
      name: 'Deadline risk',
      severity: 'critical',
      config: { daysThreshold: 7 },
      requiresExplicitAck: true,
    });
    expect(created).toMatchObject({
      firmId: 'demo-fixture-firm',
      ruleKey: 'deadline-risk',
      severity: 'critical',
      enabled: true,
      autoResolve: true,
      requiresExplicitAck: true,
      config: { daysThreshold: 7 },
    });
    await svc.createAlertRule({ ruleKey: 'ageing', name: 'Receivables ageing', severity: 'warning' });
    const rules = await svc.listAlertRules();
    expect(rules.map((r) => r.ruleKey)).toEqual(['ageing', 'deadline-risk']);
  });

  it('create validation: blank key/name and unknown severity; duplicate key is a conflict', async () => {
    await expect(
      svc.createAlertRule({ ruleKey: '  ', name: 'x', severity: 'info' }),
    ).rejects.toEqual(apiError('validation'));
    await expect(
      svc.createAlertRule({ ruleKey: 'k', name: ' ', severity: 'info' }),
    ).rejects.toEqual(apiError('validation'));
    await expect(
      // @ts-expect-error — deliberately invalid vocabulary probe
      svc.createAlertRule({ ruleKey: 'k2', name: 'x', severity: 'high' }),
    ).rejects.toEqual(apiError('validation'));
    await expect(
      svc.createAlertRule({ ruleKey: 'deadline-risk', name: 'dup', severity: 'info' }),
    ).rejects.toEqual(apiError('conflict'));
  });

  it('update is patch-style: absent fields keep current values; supplied bad values are validation', async () => {
    const rules = await svc.listAlertRules();
    const target = rules.find((r) => r.ruleKey === 'deadline-risk')!;
    const patched = await svc.updateAlertRule(target.id, { enabled: false });
    expect(patched).toMatchObject({
      id: target.id,
      enabled: false,
      // Untouched fields preserved (patch semantics).
      name: 'Deadline risk',
      severity: 'critical',
      requiresExplicitAck: true,
      config: { daysThreshold: 7 },
    });
    await expect(svc.updateAlertRule(target.id, { name: '  ' })).rejects.toEqual(
      apiError('validation'),
    );
    await expect(
      // @ts-expect-error — deliberately invalid vocabulary probe
      svc.updateAlertRule(target.id, { severity: 'medium' }),
    ).rejects.toEqual(apiError('validation'));
    await expect(svc.updateAlertRule('rule-nope', { enabled: true })).rejects.toEqual(
      apiError('not_found'),
    );
  });
});

describe('fixture alerts adapter — local invalidation (API-RT-04)', () => {
  it('transitions and rule administration notify subscribers; failures and replays do not', async () => {
    let calls = 0;
    const unsubscribe = svc.subscribeAlerts(() => {
      calls += 1;
    });
    await svc.acknowledgeAlert('a-01');
    expect(calls).toBe(1);
    await svc.snoozeAlert('a-02', FUTURE());
    expect(calls).toBe(2);
    // Replays surface the current row without a state change → no notify.
    await svc.resolveAlert('a-04'); // already resolved → already_applied
    expect(calls).toBe(2);
    // Failed commands do NOT notify.
    await expect(svc.acknowledgeAlert('a-nope-2')).rejects.toEqual(apiError('not_found'));
    expect(calls).toBe(2);
    unsubscribe();
    await svc.resolveAlert('a-05');
    expect(calls).toBe(2);
  });
});
