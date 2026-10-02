/**
 * IMP-062 — Alert badge/count freshness integration analog to the IMP-041
 * review queue-freshness suite (the missing API-RT-01(b) coverage).
 *
 * Proves the real user-visible behavior on the LOCAL stack through the REAL
 * adapter (not service_role, not a reimplementation):
 *   A. Session A "has the shell open" — it holds subscribeAlerts
 *      subscriptions (the Layout bell pattern) and reads through
 *      listAlerts (the authoritative RLS-controlled read);
 *   B. a NEW alert appears from OUTSIDE the session (psql operator insert —
 *      the IMP-051 evaluator's creation path has no browser writer) and
 *      Session A becomes current AUTOMATICALLY — IMP-062 R1-B channel
 *      invalidation and/or the always-on API-RT-07 poll tick → bare
 *      invalidation → authoritative listAlerts RLS refetch. No reload, no
 *      payload data;
 *   C. reverse direction — the alert is resolved through the real
 *      resolve_alert Layer-B command by another actor; the active count
 *      re-read drops to zero;
 *   D. unsubscribe stops further invalidations (timer cleared AND the
 *      shared topic channel released);
 *   E. multiple mounted consumers each invalidate independently over ONE
 *      shared hub channel.
 *
 * Timing note: the poll interval is the production 15s implementation
 * parameter — waits allow >2 intervals; nothing speeds production polling
 * for the test. The channel usually delivers within ~1s; the suite never
 * asserts first-broadcast delivery (LOW-3 platform caveat) — it warms up.
 *
 * Deterministic fixture ids in the 68100000-… range; this suite owns its
 * own firm; re-runnable; teardown removes rows child → parent plus the
 * fixture's audit rows (scoped to the owned firm id only).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { clearActiveFirm, setActiveFirm } from '@/data/context';
import { ALERTS_POLL_INTERVAL_MS, supabaseAlerts } from '@/data/alerts/supabase';
import { resetRealtimeHubForTests } from '@/data/realtime/hub';
import { getSupabaseClient } from '@/lib/supabaseClient';

import { api, psql, signIn, userEmail, userId } from '../helpers.mjs';

const FA = '68100000-0000-4000-8000-00000000f00a';
const H = (firm: string) => ({ 'x-active-firm': firm });

const M = {
  partnerA: '68100000-0000-4000-8000-000000000001',
  managerA: '68100000-0000-4000-8000-000000000002',
};

function cleanRows() {
  psql(`
    delete from public.audit_log where firm_id = '${FA}';
    delete from public.alerts where firm_id = '${FA}';
    delete from public.firm_memberships where firm_id = '${FA}';
    delete from realtime.messages where topic = 'firm:${FA}:alerts';
  `);
}

function raiseAlert(tag: string): string {
  // Keep at most ONE non-resolved fixture alert (HRR-06=A structural
  // dedupe); the resolve uses the same transition marker the commands use.
  const out = psql(`
    set app.alert_transition_command = '1';
    update public.alerts set status = 'resolved', resolution_type = 'auto', resolved_at = now()
    where firm_id = '${FA}' and status <> 'resolved';
    insert into public.alerts (firm_id, severity, title, detail)
    values ('${FA}', 'critical', 'IMP-062 badge ${tag}', 'badge freshness suite')
    returning id;
  `);
  // Multi-statement psql output mixes command tags and RETURNING rows —
  // the id is the UUID-shaped line.
  const id = out
    .split('\n')
    .map((l) => l.trim())
    .find((l) => /^[0-9a-f-]{36}$/.test(l));
  if (!id) throw new Error(`raiseAlert returned no id: ${out}`);
  return id;
}

async function waitFor(cond: () => boolean, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (cond()) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return cond();
}

let managerAToken: string;

beforeAll(async () => {
  cleanRows();
  psql(`
    insert into public.firms (id, name) values
      ('${FA}', 'IMP-062 Badge Firm A')
    on conflict (id) do nothing;

    insert into public.firm_memberships (id, firm_id, user_id, role, status) values
      ('${M.partnerA}', '${FA}', '${userId('USER_A_PARTNER')}', 'partner', 'active'),
      ('${M.managerA}', '${FA}', '${userId('USER_A_MANAGER')}', 'manager', 'active')
    on conflict (firm_id, user_id) do nothing;
  `);
  psql(`delete from public.audit_log where firm_id = '${FA}'`);

  // Session A signs in through the REAL adapter client — the behavior under
  // test is the production adapter, not raw fetch and not service_role.
  const client = getSupabaseClient();
  const { error } = await client.auth.signInWithPassword({
    email: userEmail('USER_A_PARTNER'),
    password: 'caos-harness-local-only',
  });
  if (error) throw new Error(`adapter sign-in failed: ${error.message}`);
  setActiveFirm(FA);

  managerAToken = (await signIn(userEmail('USER_A_MANAGER'))).token;
}, 60_000);

afterAll(async () => {
  clearActiveFirm();
  resetRealtimeHubForTests();
  await getSupabaseClient().auth.signOut();
  cleanRows();
  psql(`
    delete from public.firms where id = '${FA}'
      and not exists (select 1 from public.firm_memberships m where m.firm_id = firms.id)
      and not exists (select 1 from public.alerts a where a.firm_id = firms.id);
  `);
}, 60_000);

describe('API-RT-01(b) — cross-session alert badge freshness (IMP-062 R1-B + API-RT-07 backstop)', () => {
  it('a new alert and a resolution by another actor reach an open shell via invalidation → RLS refetch', async () => {
    // A. Session A: TWO mounted consumers (bell + second shell surface)
    // hold independent subscriptions over ONE shared hub channel.
    let bellTicks = 0;
    let secondTicks = 0;
    const unsubBell = supabaseAlerts.subscribeAlerts(() => {
      bellTicks += 1;
    });
    const unsubSecond = supabaseAlerts.subscribeAlerts(() => {
      secondTicks += 1;
    });

    // Warm the channel (first broadcast after a tenant boot may be lost);
    // the warm-up alert is resolved again before the baseline read.
    raiseAlert('warmup');
    for (let attempt = 0; attempt < 3 && bellTicks === 0; attempt += 1) {
      await waitFor(() => bellTicks >= 1, ALERTS_POLL_INTERVAL_MS + 5_000);
      if (bellTicks === 0) raiseAlert(`warmup-${attempt}`);
    }
    expect(bellTicks).toBeGreaterThanOrEqual(1);
    psql(`
      set app.alert_transition_command = '1';
      update public.alerts set status = 'resolved', resolution_type = 'auto', resolved_at = now()
      where firm_id = '${FA}' and status = 'active';
    `);

    // Authoritative baseline through the RLS-controlled read.
    const baseline = await supabaseAlerts.listAlerts({ status: 'active' });
    expect(baseline).toEqual([]);

    try {
      // B. A new critical alert appears from outside the session.
      const alertId = raiseAlert('cross-session');
      const ticksBefore = bellTicks;
      expect(
        await waitFor(
          () => bellTicks > ticksBefore && secondTicks > 0,
          ALERTS_POLL_INTERVAL_MS * 2 + 10_000,
        ),
      ).toBe(true);
      const active = await supabaseAlerts.listAlerts({ status: 'active' });
      expect(active.map((a) => a.id)).toEqual([alertId]);

      // C. Reverse direction: a manager resolves through the real command;
      // the next invalidation makes the badge read current again.
      const resolveTicks = bellTicks;
      const resolved = await api(managerAToken, 'POST', 'rpc/resolve_alert', {
        headers: H(FA),
        body: { p_alert_id: alertId, p_mutation_key: 'imp062-badge-resolve-1' },
      });
      expect(resolved.status).toBe(200);
      expect(resolved.body.status).not.toBe('denied');
      expect(resolved.body.alert.status).toBe('resolved');
      expect(
        await waitFor(() => bellTicks > resolveTicks, ALERTS_POLL_INTERVAL_MS * 2 + 10_000),
      ).toBe(true);
      expect(await supabaseAlerts.listAlerts({ status: 'active' })).toEqual([]);
    } finally {
      // D. Unsubscribe stops further invalidations on BOTH consumers.
      unsubBell();
      unsubSecond();
    }

    const bellAtUnsub = bellTicks;
    const secondAtUnsub = secondTicks;
    raiseAlert('post-unsub');
    await new Promise((r) => setTimeout(r, ALERTS_POLL_INTERVAL_MS * 2 + 2_000));
    expect(bellTicks).toBe(bellAtUnsub);
    expect(secondTicks).toBe(secondAtUnsub);
  }, 240_000);
});
