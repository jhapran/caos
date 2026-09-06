/**
 * IMP-042 — alert controlled Layer-B commands acknowledge_alert /
 * snooze_alert / resolve_alert through PostgREST against the REAL local
 * stack (API-R0-ALR, SCH-18 manual transition matrix, RLS-ALR-01,
 * API-ERR-02/04, API-MUT-01…04, AUD-FAIL-01).
 *
 * Maps to spec 11 (IMP-042 contract reconciliation 2026-09-06):
 *   TEST-API-16 — authorization-before-disclosure: an unauthorized or
 *     out-of-scope existing alert and a nonexistent id return the identical
 *     not_found surface on ALL THREE commands; no existence, status,
 *     legality, validation, or replay oracle (authorization precedes
 *     state/replay/validation evaluation);
 *   TEST-API-17 — the SCH-18 manual transition matrix holds: acknowledge
 *     from active/snoozed (stamping; stamp-if-unstamped; clearing
 *     snoozed_until); identical repeated commands return already_applied
 *     (keyless AND keyed — the matrix's state-based replay); invalid_state
 *     from resolved maps to conflict; snooze requires a future
 *     snoozed_until, preserves prior acknowledgement stamps, and a changed
 *     valid snoozed_until is a real update; resolve is permitted from any
 *     non-resolved state and is acknowledged_at-gated when the rule's
 *     requires_explicit_ack=true — including resolve AFTER
 *     acknowledge→snooze (history-based, not status-based); no reopen
 *     path exists; resolve/acknowledge/snooze are manager+ (senior/article
 *     denied); the expired-snooze IDENTICAL-replay edge proves the
 *     approved ordering — state-based replay recognition precedes
 *     future-time validation (a replayed now-past until is
 *     already_applied, never validation);
 *   TEST-API-18 — snooze-expiry posture (SCH-18): a plain SELECT exposes
 *     the PERSISTED columns (the DB performs no derivation — the
 *     effective-status read derivation lives in the adapter slice);
 *     IMP-042 performs NO expiry writes (reads and unrelated commands
 *     never touch an expired persisted snooze); the commands remain
 *     correct against an expired persisted snoozed row (acknowledge /
 *     re-snooze / resolve with the history-based ack gate); and the REAL
 *     alertsService.listAlerts derivation + status filter is exercised
 *     end-to-end through an authenticated SDK session (expired persisted
 *     snoozes resurface as active/acknowledged by acknowledgement
 *     history, with zero expiry writes).
 *
 * Reads/commands go through signed-in access tokens — never service-role
 * for authorization assertions. psql (operator) is used only for fixture
 * setup (including staging non-active rows — plain INSERTs need no command
 * marker), teardown, and state verification.
 *
 * Deterministic ids in the 6d000000-… range; this suite owns its own two
 * firms (never the shared harness FIRM_A/FIRM_B); re-runnable; teardown
 * removes rows child → parent plus the fixture's audit rows (scoped to the
 * two owned firm ids only). Several blocks intentionally mutate fixture
 * alerts — `it` order within a describe is significant (sequential pool).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// The legacy flat fixture module src/data/alerts.ts shadows the alerts/
// folder (the tasks/ naming hazard) — import the service via the barrel.
import { alertsService } from '@/data';
import { clearActiveFirm, setActiveFirm } from '@/data/context';
import { getSupabaseClient } from '@/lib/supabaseClient';

import { api, PASSWORD, psql, signIn, userEmail, userId } from '../helpers.mjs';

const FA = '6d000000-0000-4000-8000-00000000f00a';
const FB = '6d000000-0000-4000-8000-00000000f00b';
const H = (firm: string) => ({ 'x-active-firm': firm });

/** The ONE pre-authorization denial surface of all three alert commands
 *  (API-ERR-02): nonexistent, foreign, out-of-scope, and role-denied alerts
 *  all return exactly this body — no existence oracle. */
const ALERT_NOT_FOUND = {
  status: 'denied',
  kind: 'not_found',
  message: 'alert not found',
};

const SYS_ITR = '50000000-0000-4000-8000-000000000005'; // seeded system type (entity scope)

const STAGED_ACK_AT = '2026-09-01T10:00:00+00:00'; // staged acknowledgement stamp
const STAGED_UNTIL = '2026-12-31T00:00:00+00:00'; // staged open snooze (future)
const EXPIRED_UNTIL = '2026-09-01T00:00:00+00:00'; // staged snooze already past

const M = {
  superA: '6d000000-0000-4000-8000-0000000000a1',
  partnerA: '6d000000-0000-4000-8000-0000000000a2',
  managerA: '6d000000-0000-4000-8000-0000000000a3',
  seniorA: '6d000000-0000-4000-8000-0000000000a4',
  articleA: '6d000000-0000-4000-8000-0000000000a5',
  billingA: '6d000000-0000-4000-8000-0000000000a6',
  partnerB: '6d000000-0000-4000-8000-0000000000a7',
  managerB: '6d000000-0000-4000-8000-0000000000a8',
};
const C = {
  managed: '6d000000-0000-4000-8000-000000000b01', // manager = managerA
  firmB: '6d000000-0000-4000-8000-000000000b02',
};
const E = {
  managed: '6d000000-0000-4000-8000-000000000b11',
};
const I = {
  managed: '6d000000-0000-4000-8000-000000000b21', // E.managed, assignee=seniorA
};
const RL = {
  plain: '6d000000-0000-4000-8000-000000000c01', // requires_explicit_ack=false
  ack: '6d000000-0000-4000-8000-000000000c02', // requires_explicit_ack=true
  firmB: '6d000000-0000-4000-8000-000000000c03',
};
const AL = {
  ackTarget: '6d000000-0000-4000-8000-000000000d01', // active, RL.plain — acknowledge + replay
  snoozedStamped: '6d000000-0000-4000-8000-000000000d02', // snoozed (future) WITH ack stamps
  snoozedFresh: '6d000000-0000-4000-8000-000000000d03', // snoozed (future), no stamps
  resolvedStaged: '6d000000-0000-4000-8000-000000000d04', // resolved (manual) — invalid_state probes
  snoozeTarget: '6d000000-0000-4000-8000-000000000d05', // active — snooze validation/replay/update
  snoozeFromAck: '6d000000-0000-4000-8000-000000000d06', // acknowledged — snooze preserves stamps
  resolveActive: '6d000000-0000-4000-8000-000000000d07', // active, RL.plain — resolve + replay
  resolveSnoozed: '6d000000-0000-4000-8000-000000000d08', // snoozed (future), RL.plain — resolve
  gatedActive: '6d000000-0000-4000-8000-000000000d09', // active, RL.ack — ack-gate denial
  gatedFlow: '6d000000-0000-4000-8000-000000000d0a', // active, RL.ack — ack→snooze→resolve
  hidden: '6d000000-0000-4000-8000-000000000d0b', // active, instance I.managed (senior-readable)
  expired: '6d000000-0000-4000-8000-000000000d0c', // snoozed, EXPIRED until, no stamps, RL.plain
  expiredAck: '6d000000-0000-4000-8000-000000000d0d', // snoozed, EXPIRED until, ack stamps, RL.ack
  firmB: '6d000000-0000-4000-8000-000000000d0e', // FB alert
  replayEdge: '6d000000-0000-4000-8000-000000000d0f', // active — expired-snooze identical-replay edge
  fltExpiredActive: '6d000000-0000-4000-8000-000000000d10', // snoozed, EXPIRED, no ack stamps — adapter filter proof
  fltExpiredAcked: '6d000000-0000-4000-8000-000000000d11', // snoozed, EXPIRED, ack stamps — adapter filter proof
};
const GHOST = '6d000000-0000-4000-8000-00000000ffff';

const SUPER_ADMIN_A = userId('USER_A_SUPER_ADMIN');
const PARTNER_A = userId('USER_A_PARTNER');
const MANAGER_A = userId('USER_A_MANAGER');
const SENIOR_A = userId('USER_A_SENIOR');
const ARTICLE_A = userId('USER_A_ARTICLE');
const BILLING_A = userId('USER_A_BILLING');
const PARTNER_B = userId('USER_B_PARTNER');
const MANAGER_B = userId('USER_B_MANAGER');

let superAdminA: string;
let partnerA: string;
let managerA: string;
let seniorA: string;
let articleA: string;
let billingA: string;
let partnerB: string;
let managerB: string;

function cleanRows() {
  psql(`
    delete from public.audit_log where firm_id in ('${FA}', '${FB}');
    delete from public.alerts where firm_id in ('${FA}', '${FB}');
    delete from public.alert_rules where firm_id in ('${FA}', '${FB}');
    delete from public.tasks where firm_id in ('${FA}', '${FB}');
    delete from public.compliance_instances where firm_id in ('${FA}', '${FB}');
    delete from public.client_compliance_profiles where firm_id in ('${FA}', '${FB}');
    delete from public.legal_entities where firm_id in ('${FA}', '${FB}');
    delete from public.clients where firm_id in ('${FA}', '${FB}');
    delete from public.firm_memberships where firm_id in ('${FA}', '${FB}');
  `);
}

function seedFixture() {
  cleanRows();
  psql(`
    insert into public.firms (id, name) values
      ('${FA}', 'IMP-042 ALR API Firm A'),
      ('${FB}', 'IMP-042 ALR API Firm B')
    on conflict (id) do nothing;

    insert into public.firm_memberships (id, firm_id, user_id, role, status) values
      ('${M.superA}',   '${FA}', '${SUPER_ADMIN_A}', 'super_admin',       'active'),
      ('${M.partnerA}', '${FA}', '${PARTNER_A}',     'partner',           'active'),
      ('${M.managerA}', '${FA}', '${MANAGER_A}',     'manager',           'active'),
      ('${M.seniorA}',  '${FA}', '${SENIOR_A}',      'senior',            'active'),
      ('${M.articleA}', '${FA}', '${ARTICLE_A}',     'article_executive', 'active'),
      ('${M.billingA}', '${FA}', '${BILLING_A}',     'billing',           'active'),
      ('${M.partnerB}', '${FB}', '${PARTNER_B}',     'partner',           'active'),
      ('${M.managerB}', '${FB}', '${MANAGER_B}',     'manager',           'active')
    on conflict (firm_id, user_id) do nothing;

    insert into public.clients (id, firm_id, name, owner_partner_membership_id, manager_membership_id, status) values
      ('${C.managed}', '${FA}', 'ALR API Managed', '${M.partnerA}', '${M.managerA}', 'active'),
      ('${C.firmB}',   '${FB}', 'ALR API FirmB',   '${M.partnerB}', null,            'active');

    insert into public.legal_entities (id, firm_id, client_id, entity_type, legal_name) values
      ('${E.managed}', '${FA}', '${C.managed}', 'private_limited', 'ALR API Entity');

    insert into public.compliance_instances
      (id, firm_id, legal_entity_id, compliance_type_id, period_start, period_end,
       period_label, due_date, assignee_membership_id, reviewer_membership_id)
    values
      ('${I.managed}', '${FA}', '${E.managed}', '${SYS_ITR}', '2026-04-01', '2026-06-30', 'FY26 Q1', '2026-07-31', '${M.seniorA}', '${M.managerA}');

    insert into public.alert_rules (id, firm_id, rule_key, name, severity, requires_explicit_ack) values
      ('${RL.plain}', '${FA}', 'filing_due_soon', 'Filing due soon', 'warning',  false),
      ('${RL.ack}',   '${FA}', 'risk_escalation', 'Risk escalation', 'critical', true),
      ('${RL.firmB}', '${FB}', 'filing_due_soon', 'Filing due soon', 'warning',  false);

    -- Alert fixtures are plain operator INSERTs (the write guard restricts
    -- UPDATE only); staged rows carry CHECK-consistent stamp sets.
    insert into public.alerts
      (id, firm_id, alert_rule_id, severity, title, client_id, compliance_instance_id, status,
       acknowledged_by, acknowledged_at, snoozed_until, resolved_by, resolved_at, resolution_type)
    values
      ('${AL.ackTarget}',      '${FA}', '${RL.plain}', 'warning',  'ALR ack target',       '${C.managed}', null,          'active',
       null, null, null, null, null, null),
      ('${AL.snoozedStamped}', '${FA}', '${RL.plain}', 'warning',  'ALR snoozed stamped',  '${C.managed}', null,          'snoozed',
       '${PARTNER_A}', '${STAGED_ACK_AT}', '${STAGED_UNTIL}', null, null, null),
      ('${AL.snoozedFresh}',   '${FA}', '${RL.plain}', 'info',     'ALR snoozed fresh',    '${C.managed}', null,          'snoozed',
       null, null, '${STAGED_UNTIL}', null, null, null),
      ('${AL.resolvedStaged}', '${FA}', '${RL.plain}', 'critical', 'ALR resolved staged',  '${C.managed}', null,          'resolved',
       null, null, null, '${PARTNER_A}', '${STAGED_ACK_AT}', 'manual'),
      ('${AL.snoozeTarget}',   '${FA}', '${RL.plain}', 'info',     'ALR snooze target',    '${C.managed}', null,          'active',
       null, null, null, null, null, null),
      ('${AL.snoozeFromAck}',  '${FA}', '${RL.plain}', 'info',     'ALR snooze from ack',  '${C.managed}', null,          'acknowledged',
       '${MANAGER_A}', '${STAGED_ACK_AT}', null, null, null, null),
      ('${AL.resolveActive}',  '${FA}', '${RL.plain}', 'warning',  'ALR resolve active',   '${C.managed}', null,          'active',
       null, null, null, null, null, null),
      ('${AL.resolveSnoozed}', '${FA}', '${RL.plain}', 'warning',  'ALR resolve snoozed',  '${C.managed}', null,          'snoozed',
       null, null, '${STAGED_UNTIL}', null, null, null),
      ('${AL.gatedActive}',    '${FA}', '${RL.ack}',   'critical', 'ALR gated active',     '${C.managed}', null,          'active',
       null, null, null, null, null, null),
      ('${AL.gatedFlow}',      '${FA}', '${RL.ack}',   'critical', 'ALR gated flow',       '${C.managed}', null,          'active',
       null, null, null, null, null, null),
      ('${AL.hidden}',         '${FA}', '${RL.plain}', 'info',     'ALR senior-visible',   '${C.managed}', '${I.managed}', 'active',
       null, null, null, null, null, null),
      ('${AL.expired}',        '${FA}', '${RL.plain}', 'warning',  'ALR expired snooze',   '${C.managed}', null,          'snoozed',
       null, null, '${EXPIRED_UNTIL}', null, null, null),
      ('${AL.expiredAck}',     '${FA}', '${RL.ack}',   'critical', 'ALR expired ack snooze', '${C.managed}', null,        'snoozed',
       '${MANAGER_A}', '${STAGED_ACK_AT}', '${EXPIRED_UNTIL}', null, null, null),
      ('${AL.replayEdge}',     '${FA}', '${RL.plain}', 'info',     'ALR replay edge',      '${C.managed}', null,          'active',
       null, null, null, null, null, null),
      ('${AL.fltExpiredActive}', '${FA}', '${RL.plain}', 'warning', 'ALR filter expired active', '${C.managed}', null,      'snoozed',
       null, null, '${EXPIRED_UNTIL}', null, null, null),
      ('${AL.fltExpiredAcked}', '${FA}', '${RL.plain}', 'critical', 'ALR filter expired acked', '${C.managed}', null,       'snoozed',
       '${MANAGER_A}', '${STAGED_ACK_AT}', '${EXPIRED_UNTIL}', null, null, null),
      ('${AL.firmB}',          '${FB}', '${RL.firmB}', 'warning',  'ALR firm B',           '${C.firmB}',   null,          'active',
       null, null, null, null, null, null);
  `);
  // Fixture writes are operator/system-actor rows; remove fixture noise so
  // audit-side assertions in the audit suite read a clean table.
  psql(`delete from public.audit_log where firm_id in ('${FA}', '${FB}')`);
}

beforeAll(async () => {
  seedFixture();
  for (const [key, set] of [
    ['USER_A_SUPER_ADMIN', (t: string) => (superAdminA = t)],
    ['USER_A_PARTNER', (t: string) => (partnerA = t)],
    ['USER_A_MANAGER', (t: string) => (managerA = t)],
    ['USER_A_SENIOR', (t: string) => (seniorA = t)],
    ['USER_A_ARTICLE', (t: string) => (articleA = t)],
    ['USER_A_BILLING', (t: string) => (billingA = t)],
    ['USER_B_PARTNER', (t: string) => (partnerB = t)],
    ['USER_B_MANAGER', (t: string) => (managerB = t)],
  ] as Array<[string, (t: string) => void]>) {
    const s = await signIn(userEmail(key));
    if (!s.ok) throw new Error(`sign-in failed for ${key}: ${JSON.stringify(s.raw)}`);
    set(s.token);
  }
});

afterAll(async () => {
  clearActiveFirm();
  await getSupabaseClient().auth.signOut();
  cleanRows();
  psql(`
    delete from public.firms where id in ('${FA}', '${FB}')
      and not exists (select 1 from public.firm_memberships m where m.firm_id = firms.id)
      and not exists (select 1 from public.clients c where c.firm_id = firms.id);
  `);
});

function ack(token: string, body: Record<string, unknown>, firm: string | null = FA) {
  return api(token, 'POST', 'rpc/acknowledge_alert', { headers: firm ? H(firm) : {}, body });
}
function snooze(token: string, body: Record<string, unknown>, firm: string | null = FA) {
  return api(token, 'POST', 'rpc/snooze_alert', { headers: firm ? H(firm) : {}, body });
}
function resolve(token: string, body: Record<string, unknown>, firm: string | null = FA) {
  return api(token, 'POST', 'rpc/resolve_alert', { headers: firm ? H(firm) : {}, body });
}
function alertRow(id: string): Record<string, unknown> {
  const out = psql(`select row_to_json(a) from public.alerts a where a.id = '${id}';`);
  return JSON.parse(out);
}

// ---------------------------------------------------------------------------
// TEST-API-16 — authorization-before-disclosure (API-ERR-02, RLS-ALR-01)
// ---------------------------------------------------------------------------

describe('TEST-API-16 — authorization-before-disclosure', () => {
  it('unauthorized-existing and nonexistent ids return the identical not_found on all three commands', async () => {
    // The probes: a nonexistent id; an existing alert READABLE by the
    // caller but below the manager+ command bar (senior on AL.hidden);
    // an existing alert INVISIBLE to the caller (billing); a cross-firm
    // id; a selector/forgery mismatch. Every body must be byte-identical.
    const probes: Array<() => Promise<{ body: unknown }>> = [
      () => ack(partnerA, { p_alert_id: GHOST }),
      () => ack(seniorA, { p_alert_id: AL.hidden }),
      () => ack(billingA, { p_alert_id: AL.hidden }),
      () => ack(partnerB, { p_alert_id: AL.hidden }),
      () => ack(partnerA, { p_alert_id: AL.hidden }, FB),
      () => ack(partnerA, { p_alert_id: AL.hidden }, null),
      () => snooze(partnerA, { p_alert_id: GHOST, p_snoozed_until: '2026-12-31T00:00:00Z' }),
      () => snooze(seniorA, { p_alert_id: AL.hidden, p_snoozed_until: '2026-12-31T00:00:00Z' }),
      () => resolve(partnerA, { p_alert_id: GHOST }),
      () => resolve(articleA, { p_alert_id: AL.hidden }),
      () => resolve(partnerA, { p_alert_id: AL.firmB }),
    ];
    for (const probe of probes) {
      expect((await probe()).body).toEqual(ALERT_NOT_FOUND);
    }
  });

  it('no replay oracle: a keyed command against an out-of-scope alert is not_found, never already_applied', async () => {
    const res = await resolve(seniorA, { p_alert_id: AL.resolvedStaged, p_mutation_key: 'probe-key' });
    expect(res.body).toEqual(ALERT_NOT_FOUND);
  });

  it('no validation oracle: an invalid snooze against an out-of-scope alert is not_found, never validation', async () => {
    const res = await snooze(seniorA, { p_alert_id: AL.hidden, p_snoozed_until: '2020-01-01T00:00:00Z' });
    expect(res.body).toEqual(ALERT_NOT_FOUND);
  });
});

// ---------------------------------------------------------------------------
// TEST-API-16 — billing no-leak posture (RLS-STF-05, RLS-ALR-01, RLS-A-04):
// the client may be KNOWN through the billing identity projection, yet the
// alert surface stays zero and hidden-existing ≡ nonexistent on every
// command — byte-identical, no existence/status/legality/replay oracle.
// ---------------------------------------------------------------------------

describe('TEST-API-16 — billing: known client, invisible alerts, uniform denials', () => {
  it('billing can learn the client identity (RLS-A-04) yet reads zero alerts for it', async () => {
    const identities = await api(billingA, 'POST', 'rpc/list_client_identities', {
      headers: H(FA), body: { p_firm_id: FA },
    });
    expect(identities.status).toBe(200);
    expect((identities.body as Array<{ id: string }>).map((r) => r.id)).toContain(C.managed);
    // Knowing the client id buys nothing on the alert surface.
    const byClient = await api(billingA, 'GET', `alerts?client_id=eq.${C.managed}&select=id`, { headers: H(FA) });
    expect(byClient.status).toBe(200);
    expect(byClient.body).toEqual([]);
    const byId = await api(billingA, 'GET', `alerts?id=eq.${AL.hidden}&select=id`, { headers: H(FA) });
    expect(byId.body).toEqual([]);
  });

  it('all three transition commands against the EXISTING alert are byte-identical to a nonexistent id', async () => {
    const pairs: Array<[string, { body: unknown }, { body: unknown }]> = [
      [
        'acknowledge',
        await ack(billingA, { p_alert_id: AL.hidden }),
        await ack(billingA, { p_alert_id: GHOST }),
      ],
      [
        'snooze',
        await snooze(billingA, { p_alert_id: AL.hidden, p_snoozed_until: '2026-12-31T00:00:00Z' }),
        await snooze(billingA, { p_alert_id: GHOST, p_snoozed_until: '2026-12-31T00:00:00Z' }),
      ],
      [
        'resolve',
        await resolve(billingA, { p_alert_id: AL.hidden, p_mutation_key: 'billing-probe' }),
        await resolve(billingA, { p_alert_id: GHOST, p_mutation_key: 'billing-probe' }),
      ],
    ];
    for (const [label, existing, ghost] of pairs) {
      expect(existing.body, label).toEqual(ALERT_NOT_FOUND);
      // Byte-identical bodies — no existence, status, legality, or replay oracle.
      expect(JSON.stringify(existing.body), label).toBe(JSON.stringify(ghost.body));
    }
    expect(alertRow(AL.hidden).status).toBe('active'); // never mutated
  });

  it('billing reads no alert_rules and both rule-admin commands deny on the suite’s unauthorized surface', async () => {
    const rules = await api(billingA, 'GET', 'alert_rules?select=id', { headers: H(FA) });
    expect(rules.body).toEqual([]);
    const create = await api(billingA, 'POST', 'rpc/create_alert_rule', {
      headers: H(FA), body: { p_rule_key: 'billing-probe', p_name: 'billing probe', p_severity: 'info' },
    });
    expect(create.body).toMatchObject({ status: 'denied', kind: 'unauthorized' });
    const upd = await api(billingA, 'POST', 'rpc/update_alert_rule', {
      headers: H(FA), body: { p_rule_id: RL.plain, p_name: 'billing edit' },
    });
    expect(upd.body).toMatchObject({ status: 'denied', kind: 'unauthorized' });
    expect(psql(`select count(*) from public.alert_rules where rule_key = 'billing-probe';`).trim()).toBe('0');
    expect(psql(`select name from public.alert_rules where id = '${RL.plain}';`).trim()).toBe('Filing due soon');
  });
});

// ---------------------------------------------------------------------------
// TEST-API-16 — cross-firm manager+ caller against a KNOWN-EXISTING foreign
// alert (RLS-ALR-01, RLS-CTX-02): read nothing, every command identical to
// nonexistent, forged selector changes nothing, and authorization precedes
// vocabulary/lifecycle/replay evaluation.
// ---------------------------------------------------------------------------

describe('TEST-API-16 — cross-firm manager+ caller, no-leak', () => {
  it('SELECT returns nothing and all three commands are byte-identical to a nonexistent id', async () => {
    const sel = await api(managerB, 'GET', `alerts?id=eq.${AL.hidden}&select=id`, { headers: H(FB) });
    expect(sel.status).toBe(200);
    expect(sel.body).toEqual([]);

    const pairs: Array<[string, { body: unknown }, { body: unknown }]> = [
      [
        'acknowledge',
        await ack(managerB, { p_alert_id: AL.hidden }, FB),
        await ack(managerB, { p_alert_id: GHOST }, FB),
      ],
      [
        'snooze',
        await snooze(managerB, { p_alert_id: AL.hidden, p_snoozed_until: '2026-12-31T00:00:00Z' }, FB),
        await snooze(managerB, { p_alert_id: GHOST, p_snoozed_until: '2026-12-31T00:00:00Z' }, FB),
      ],
      [
        'resolve',
        await resolve(managerB, { p_alert_id: AL.hidden }, FB),
        await resolve(managerB, { p_alert_id: GHOST }, FB),
      ],
    ];
    for (const [label, existing, ghost] of pairs) {
      expect(existing.body, label).toEqual(ALERT_NOT_FOUND);
      expect(JSON.stringify(existing.body), label).toBe(JSON.stringify(ghost.body));
    }
    expect(alertRow(AL.hidden).status).toBe('active'); // never mutated
  });

  it('a forged x-active-firm selector naming the OWNING firm changes nothing (RLS-CTX-02)', async () => {
    // managerB has no live membership in FA; forging FA selects nothing.
    const sel = await api(managerB, 'GET', `alerts?id=eq.${AL.hidden}&select=id`, { headers: H(FA) });
    expect(sel.status).toBe(200);
    expect(sel.body).toEqual([]);
    const res = await ack(managerB, { p_alert_id: AL.hidden }, FA);
    expect(res.body).toEqual(ALERT_NOT_FOUND);
    const resResolve = await resolve(managerB, { p_alert_id: AL.hidden }, FA);
    expect(resResolve.body).toEqual(ALERT_NOT_FOUND);
  });

  it('invalid snooze payloads and bogus mutation keys against the hidden-existing id are still the identical not_found', async () => {
    // Authorization precedes vocabulary/lifecycle evaluation: never 'validation'.
    const pastSnooze = await snooze(managerB, { p_alert_id: AL.hidden, p_snoozed_until: '2020-01-01T00:00:00Z' }, FB);
    expect(pastSnooze.body).toEqual(ALERT_NOT_FOUND);
    // … and precedes replay evaluation: never already_applied.
    const keyedResolve = await resolve(managerB, { p_alert_id: AL.hidden, p_mutation_key: 'forged-replay-probe' }, FB);
    expect(keyedResolve.body).toEqual(ALERT_NOT_FOUND);
    const keyedAck = await ack(managerB, { p_alert_id: AL.hidden, p_mutation_key: 'forged-ack-key' }, FB);
    expect(keyedAck.body).toEqual(ALERT_NOT_FOUND);
    expect(alertRow(AL.hidden).status).toBe('active'); // no state leak, no mutation
  });
});

// ---------------------------------------------------------------------------
// TEST-API-17 — the SCH-18 manual transition matrix
// ---------------------------------------------------------------------------

describe('TEST-API-17 — acknowledge matrix', () => {
  it('active → acknowledged stamps the server-derived actor (API-MUT-04)', async () => {
    const res = await ack(managerA, { p_alert_id: AL.ackTarget });
    expect(res.status).toBe(200);
    const body = res.body as { status: string; from_status: string; to_status: string; alert: { id: string } };
    expect(body.status).toBe('acknowledged');
    expect(body.from_status).toBe('active');
    expect(body.to_status).toBe('acknowledged');
    const row = alertRow(AL.ackTarget);
    expect(row.status).toBe('acknowledged');
    expect(row.acknowledged_by).toBe(MANAGER_A); // auth.uid(), never a parameter
    expect(row.acknowledged_at).not.toBeNull();
  });

  it('acknowledged → acknowledged is already_applied (keyless AND keyed) — no re-stamp', async () => {
    const stamp = alertRow(AL.ackTarget).acknowledged_at;
    const keyless = await ack(managerA, { p_alert_id: AL.ackTarget });
    expect((keyless.body as { status: string; reason: string }).status).toBe('already_applied');
    expect((keyless.body as { reason: string }).reason).toBe('already_acknowledged');
    const keyed = await ack(partnerA, { p_alert_id: AL.ackTarget, p_mutation_key: 'ack-replay-1' });
    expect((keyed.body as { status: string }).status).toBe('already_applied');
    expect(alertRow(AL.ackTarget).acknowledged_at).toBe(stamp); // untouched
  });

  it('snoozed → acknowledged PRESERVES an existing stamp and clears snoozed_until', async () => {
    const res = await ack(managerA, { p_alert_id: AL.snoozedStamped });
    expect((res.body as { status: string }).status).toBe('acknowledged');
    const row = alertRow(AL.snoozedStamped);
    expect(row.status).toBe('acknowledged');
    expect(row.acknowledged_by).toBe(PARTNER_A); // the original stamp, not the caller
    expect(row.acknowledged_at).not.toBeNull();
    expect(row.snoozed_until).toBeNull();
  });

  it('snoozed → acknowledged stamps fresh when not already stamped', async () => {
    const res = await ack(partnerA, { p_alert_id: AL.snoozedFresh });
    expect((res.body as { status: string }).status).toBe('acknowledged');
    const row = alertRow(AL.snoozedFresh);
    expect(row.acknowledged_by).toBe(PARTNER_A);
    expect(row.acknowledged_at).not.toBeNull();
    expect(row.snoozed_until).toBeNull();
  });

  it('resolved → acknowledge is invalid_state → conflict (no reopen)', async () => {
    const res = await ack(partnerA, { p_alert_id: AL.resolvedStaged });
    const body = res.body as { status: string; kind: string; message: string };
    expect(body).toMatchObject({ status: 'denied', kind: 'conflict' });
    expect(body.message).toContain('invalid_state');
    expect(alertRow(AL.resolvedStaged).status).toBe('resolved');
  });
});

describe('TEST-API-17 — snooze matrix', () => {
  it('snoozed_until must be in the future — past and null are validation', async () => {
    const past = await snooze(managerA, { p_alert_id: AL.snoozeTarget, p_snoozed_until: '2020-01-01T00:00:00Z' });
    expect((past.body as { status: string; kind: string }).status).toBe('denied');
    expect((past.body as { kind: string }).kind).toBe('validation');
    const missing = await snooze(managerA, { p_alert_id: AL.snoozeTarget });
    expect((missing.body as { kind: string }).kind).toBe('validation');
    expect(alertRow(AL.snoozeTarget).status).toBe('active');
  });

  it('active → snoozed; the IDENTICAL repeat is already_applied; a CHANGED valid until is a real update', async () => {
    const until1 = '2026-12-01T00:00:00Z';
    const first = await snooze(managerA, { p_alert_id: AL.snoozeTarget, p_snoozed_until: until1 });
    expect((first.body as { status: string }).status).toBe('snoozed');
    expect(alertRow(AL.snoozeTarget).status).toBe('snoozed');

    const replay = await snooze(managerA, { p_alert_id: AL.snoozeTarget, p_snoozed_until: until1 });
    expect((replay.body as { status: string; reason: string }).status).toBe('already_applied');
    expect((replay.body as { reason: string }).reason).toBe('snooze_already_applied');

    const until2 = '2026-12-15T00:00:00Z';
    const changed = await snooze(partnerA, { p_alert_id: AL.snoozeTarget, p_snoozed_until: until2 });
    expect((changed.body as { status: string }).status).toBe('snoozed'); // real audited update
    expect(alertRow(AL.snoozeTarget).snoozed_until).toBe('2026-12-15T00:00:00+00:00');
  });

  it('acknowledged → snoozed PRESERVES the acknowledgement stamps', async () => {
    const res = await snooze(managerA, { p_alert_id: AL.snoozeFromAck, p_snoozed_until: '2026-12-20T00:00:00Z' });
    expect((res.body as { status: string; from_status: string }).status).toBe('snoozed');
    expect((res.body as { from_status: string }).from_status).toBe('acknowledged');
    const row = alertRow(AL.snoozeFromAck);
    expect(row.status).toBe('snoozed');
    expect(row.acknowledged_by).toBe(MANAGER_A); // preserved history
    expect(row.acknowledged_at).not.toBeNull();
  });

  it('resolved → snooze is invalid_state → conflict', async () => {
    const res = await snooze(partnerA, { p_alert_id: AL.resolvedStaged, p_snoozed_until: '2026-12-31T00:00:00Z' });
    const body = res.body as { kind: string; message: string };
    expect(body.kind).toBe('conflict');
    expect(body.message).toContain('invalid_state');
  });
});

describe('TEST-API-17 — expired-snooze identical-replay edge (replay recognition BEFORE future-time validation)', () => {
  it('the identical replay of a now-EXPIRED snooze is already_applied (never validation), the row is untouched, and no second audit row exists', async () => {
    const key = 'snooze-expiry-replay-1';
    // T1 a few seconds in the future — the only deterministic route to an
    // expired persisted snooze through the command path (the write guard
    // blocks direct lifecycle mutation even via psql).
    const t1 = new Date(Date.now() + 2500);
    const t1Iso = t1.toISOString();
    const auditCount = () =>
      psql(`select count(*) from public.audit_log
            where firm_id = '${FA}' and object_type = 'alert' and object_id = '${AL.replayEdge}'
              and action = 'alert.snoozed';`).trim();

    const first = await snooze(managerA, { p_alert_id: AL.replayEdge, p_snoozed_until: t1Iso, p_mutation_key: key });
    expect((first.body as { status: string }).status).toBe('snoozed');
    const applied = alertRow(AL.replayEdge);
    expect(applied.status).toBe('snoozed');
    expect(auditCount()).toBe('1');

    // Wait past expiry: T1 <= now() from here on.
    await new Promise((r) => setTimeout(r, Math.max(t1.getTime() - Date.now() + 600, 0)));
    expect(Date.now()).toBeGreaterThan(t1.getTime());

    // The IDENTICAL mutation (same alert, same T1, same key): state-based
    // replay recognition runs BEFORE the future-time validation, so T1
    // being now-past must not matter.
    const replay = await snooze(managerA, { p_alert_id: AL.replayEdge, p_snoozed_until: t1Iso, p_mutation_key: key });
    const replayBody = replay.body as { status: string; reason: string; kind?: string };
    expect(replayBody.status).toBe('already_applied');
    expect(replayBody.reason).toBe('snooze_already_applied');
    expect(replayBody.kind).toBeUndefined(); // never 'validation'
    expect(alertRow(AL.replayEdge)).toEqual(applied); // byte-identical — no re-stamp
    expect(auditCount()).toBe('1'); // zero additional audit rows for the replay

    // Control 1: a CHANGED snooze with a past snoozed_until is still
    // validation — genuinely-new-mutation validation is not weakened.
    const changedPast = await snooze(managerA, { p_alert_id: AL.replayEdge, p_snoozed_until: '2020-01-01T00:00:00Z' });
    expect(changedPast.body).toMatchObject({ status: 'denied', kind: 'validation' });
    expect(alertRow(AL.replayEdge)).toEqual(applied);
    expect(auditCount()).toBe('1'); // validation denials are not audited

    // Control 2: a changed FUTURE snooze is still a real audited update.
    const changedFuture = await snooze(managerA, { p_alert_id: AL.replayEdge, p_snoozed_until: '2027-01-15T00:00:00Z' });
    expect((changedFuture.body as { status: string }).status).toBe('snoozed');
    expect(alertRow(AL.replayEdge).snoozed_until).toBe('2027-01-15T00:00:00+00:00');
    expect(auditCount()).toBe('2');
  });
});

describe('TEST-API-17 — resolve matrix', () => {
  it('active → resolved with resolution_type=manual and server-derived actor; replays are already_applied', async () => {
    const res = await resolve(partnerA, { p_alert_id: AL.resolveActive, p_mutation_key: 'resolve-1' });
    expect(res.status).toBe(200);
    const body = res.body as { status: string; from_status: string };
    expect(body.status).toBe('resolved');
    expect(body.from_status).toBe('active');
    const row = alertRow(AL.resolveActive);
    expect(row.status).toBe('resolved');
    expect(row.resolution_type).toBe('manual');
    expect(row.resolved_by).toBe(PARTNER_A);
    expect(row.resolved_at).not.toBeNull();

    const keyless = await resolve(managerA, { p_alert_id: AL.resolveActive });
    expect((keyless.body as { status: string; reason: string }).status).toBe('already_applied');
    expect((keyless.body as { reason: string }).reason).toBe('already_resolved');
    const keyed = await resolve(partnerA, { p_alert_id: AL.resolveActive, p_mutation_key: 'resolve-1' });
    expect((keyed.body as { status: string }).status).toBe('already_applied');
  });

  it('snoozed → resolved is legal (from any non-resolved state)', async () => {
    const res = await resolve(managerA, { p_alert_id: AL.resolveSnoozed });
    expect((res.body as { status: string; from_status: string }).status).toBe('resolved');
    expect((res.body as { from_status: string }).from_status).toBe('snoozed');
  });

  it('requires_explicit_ack=true gates manual resolve on acknowledged_at IS NOT NULL', async () => {
    const res = await resolve(managerA, { p_alert_id: AL.gatedActive });
    const body = res.body as { status: string; kind: string; message: string };
    expect(body).toMatchObject({ status: 'denied', kind: 'conflict' });
    expect(body.message).toContain('explicit acknowledgement');
    expect(alertRow(AL.gatedActive).status).toBe('active');
  });

  it('the ack gate is HISTORY-based: resolve succeeds after acknowledge → snooze', async () => {
    const ackRes = await ack(managerA, { p_alert_id: AL.gatedFlow });
    expect((ackRes.body as { status: string }).status).toBe('acknowledged');
    const snoozeRes = await snooze(managerA, { p_alert_id: AL.gatedFlow, p_snoozed_until: '2026-12-25T00:00:00Z' });
    expect((snoozeRes.body as { status: string }).status).toBe('snoozed');
    // Status is now snoozed — the gate must read acknowledged_at, not status.
    const res = await resolve(partnerA, { p_alert_id: AL.gatedFlow });
    expect((res.body as { status: string; from_status: string }).status).toBe('resolved');
    expect((res.body as { from_status: string }).from_status).toBe('snoozed');
    const row = alertRow(AL.gatedFlow);
    expect(row.resolution_type).toBe('manual');
    expect(row.acknowledged_at).not.toBeNull(); // history retained
  });

  it('no reopen path exists: every command against a resolved alert is already_applied or invalid_state, never a state change', async () => {
    expect(alertRow(AL.resolvedStaged).status).toBe('resolved');
    const res = await resolve(superAdminA, { p_alert_id: AL.resolvedStaged });
    expect((res.body as { status: string }).status).toBe('already_applied');
    const ackRes = await ack(superAdminA, { p_alert_id: AL.resolvedStaged });
    expect((ackRes.body as { kind: string }).kind).toBe('conflict');
    const snz = await snooze(superAdminA, { p_alert_id: AL.resolvedStaged, p_snoozed_until: '2026-12-31T00:00:00Z' });
    expect((snz.body as { kind: string }).kind).toBe('conflict');
    const row = alertRow(AL.resolvedStaged);
    expect(row.status).toBe('resolved');
    expect(row.resolved_by).toBe(PARTNER_A); // the original stamp
  });

  it('resolve is super_admin/partner/manager ONLY — senior/article are read-only (RLS-ALR-01)', async () => {
    for (const [label, token] of [['senior', seniorA], ['article', articleA]] as Array<[string, string]>) {
      const res = await resolve(token, { p_alert_id: AL.hidden });
      expect(res.body, label).toEqual(ALERT_NOT_FOUND);
    }
    // … including against an alert the senior CAN read (assigned instance).
    const visible = await api(seniorA, 'GET', `alerts?id=eq.${AL.hidden}&select=id`, { headers: H(FA) });
    expect((visible.body as Array<{ id: string }>).map((r) => r.id)).toEqual([AL.hidden]);
    const denied = await resolve(seniorA, { p_alert_id: AL.hidden });
    expect(denied.body).toEqual(ALERT_NOT_FOUND);
    expect(alertRow(AL.hidden).status).toBe('active');
  });
});

// ---------------------------------------------------------------------------
// TEST-API-18 — snooze-expiry posture (SCH-18; IMP-042 performs NO expiry
// writes; the effective-status read derivation is adapter-side)
// ---------------------------------------------------------------------------

describe('TEST-API-18 — snooze-expiry read derivation posture', () => {
  it('a plain SELECT exposes the PERSISTED columns — the DB performs no derivation', async () => {
    const res = await api(managerA, 'GET', `alerts?id=in.(${AL.expired},${AL.expiredAck})&select=id,status,snoozed_until,acknowledged_at`, { headers: H(FA) });
    expect(res.status).toBe(200);
    const byId = Object.fromEntries(
      (res.body as Array<{ id: string; status: string; snoozed_until: string; acknowledged_at: string | null }>).map((r) => [r.id, r]),
    );
    // Persisted status stays 'snoozed' with the PASSED snoozed_until; the
    // adapter derives effective status acknowledged (ack stamp present) /
    // active (no stamp) from exactly these columns.
    expect(byId[AL.expired].status).toBe('snoozed');
    expect(byId[AL.expired].acknowledged_at).toBeNull();
    expect(byId[AL.expiredAck].status).toBe('snoozed');
    expect(byId[AL.expiredAck].acknowledged_at).not.toBeNull();
  });

  it('NO expiry writes: reads and unrelated commands never touch an expired persisted snooze', async () => {
    const beforeExpired = alertRow(AL.expired);
    const beforeAck = alertRow(AL.expiredAck);
    // Unrelated command traffic + repeated reads.
    const unrelated = await ack(managerA, { p_alert_id: AL.hidden });
    expect((unrelated.body as { status: string }).status).toBe('acknowledged');
    await api(partnerA, 'GET', 'alerts?select=id', { headers: H(FA) });
    await api(managerA, 'GET', `alerts?id=eq.${AL.expired}`, { headers: H(FA) });
    // The expired rows are byte-identical (updated_at included) and no
    // audit row exists for them (no hidden normalization write).
    expect(alertRow(AL.expired)).toEqual(beforeExpired);
    expect(alertRow(AL.expiredAck)).toEqual(beforeAck);
    expect(
      psql(`select count(*) from public.audit_log
            where object_type = 'alert' and object_id in ('${AL.expired}', '${AL.expiredAck}');`).trim(),
    ).toBe('0');
  });

  it('commands remain correct against an expired persisted snooze (acknowledge / re-snooze)', async () => {
    // acknowledge: expired snoozed → acknowledged (fresh stamps — the row
    // carried none), until cleared.
    const res = await ack(managerA, { p_alert_id: AL.expired });
    expect((res.body as { status: string; from_status: string }).status).toBe('acknowledged');
    expect((res.body as { from_status: string }).from_status).toBe('snoozed');
    const row = alertRow(AL.expired);
    expect(row.acknowledged_by).toBe(MANAGER_A);
    expect(row.snoozed_until).toBeNull();

    // re-snooze with a NEW future until is a real update; the preserved
    // acknowledgement stamp survives.
    const until = '2026-12-28T00:00:00Z';
    const reSnooze = await snooze(partnerA, { p_alert_id: AL.expiredAck, p_snoozed_until: until });
    expect((reSnooze.body as { status: string }).status).toBe('snoozed');
    const reRow = alertRow(AL.expiredAck);
    expect(reRow.snoozed_until).toBe('2026-12-28T00:00:00+00:00');
    expect(reRow.acknowledged_by).toBe(MANAGER_A); // preserved
  });

  it('the explicit-ack resolve gate reads HISTORY, not expiry: resolve after an expired ack-snooze succeeds', async () => {
    // AL.expiredAck: rule requires_explicit_ack=true, acknowledged_at set,
    // snoozed_until in the past (and re-snoozed above). The gate is
    // satisfied by the acknowledgement history alone.
    const res = await resolve(partnerA, { p_alert_id: AL.expiredAck });
    expect((res.body as { status: string }).status).toBe('resolved');
    expect(alertRow(AL.expiredAck).resolution_type).toBe('manual');
  });
});

// ---------------------------------------------------------------------------
// TEST-API-18 — effective-status list filtering through the REAL
// alertsService Supabase adapter (live stack; SCH-18, API-R0-ALR): the
// adapter derives effectiveStatus for ALL authorized rows and the status
// filter matches the DERIVATION — an expired persisted snooze with no
// acknowledgement history resurfaces as 'active', one WITH acknowledgement
// history as 'acknowledged'. Driven through an authenticated SDK session
// exactly as application code does (the mywork-suite pattern); psql is used
// only for the fixture rows and the no-expiry-writes inspection.
// ---------------------------------------------------------------------------

describe('TEST-API-18 — effective-status filtering via the real alertsService adapter (live stack)', () => {
  it('listAlerts filters on the DERIVED effectiveStatus and performs NO expiry writes', async () => {
    // Fixtures: AL.fltExpiredActive = persisted 'snoozed', snoozed_until in
    // the PAST, acknowledged_at NULL; AL.fltExpiredAcked = persisted
    // 'snoozed', expired, acknowledged_at NOT NULL (the lifecycle CHECK
    // deliberately admits both expired persisted snooze shapes).
    const beforeActive = alertRow(AL.fltExpiredActive);
    const beforeAcked = alertRow(AL.fltExpiredAcked);
    expect(beforeActive.status).toBe('snoozed');
    expect(beforeActive.acknowledged_at).toBeNull();
    expect(beforeAcked.status).toBe('snoozed');
    expect(beforeAcked.acknowledged_at).not.toBeNull();

    const { error } = await getSupabaseClient().auth.signInWithPassword({
      email: userEmail('USER_A_MANAGER'),
      password: PASSWORD,
    });
    expect(error).toBeNull();
    setActiveFirm(FA);
    try {
      // status: 'active' — INCLUDES the expired unstamped snooze (effective
      // active), EXCLUDES the expired acknowledged one.
      const active = await alertsService.listAlerts({ status: 'active' });
      const activeIds = active.map((a) => a.id);
      expect(activeIds).toContain(AL.fltExpiredActive);
      expect(activeIds).not.toContain(AL.fltExpiredAcked);

      // status: 'acknowledged' — includes the expired acked snooze, not the
      // unstamped one.
      const acked = await alertsService.listAlerts({ status: 'acknowledged' });
      const ackedIds = acked.map((a) => a.id);
      expect(ackedIds).toContain(AL.fltExpiredAcked);
      expect(ackedIds).not.toContain(AL.fltExpiredActive);

      // … and neither matches 'snoozed' any more (the snooze has expired).
      const snoozed = await alertsService.listAlerts({ status: 'snoozed' });
      const snoozedIds = snoozed.map((a) => a.id);
      expect(snoozedIds).not.toContain(AL.fltExpiredActive);
      expect(snoozedIds).not.toContain(AL.fltExpiredAcked);

      // The unfiltered list returns BOTH with the persisted status intact
      // and the correct derived effectiveStatus.
      const all = await alertsService.listAlerts();
      const byId = new Map(all.map((a) => [a.id, a]));
      const a1 = byId.get(AL.fltExpiredActive);
      const a2 = byId.get(AL.fltExpiredAcked);
      expect(a1?.status).toBe('snoozed'); // persisted, underived by the DB
      expect(a1?.effectiveStatus).toBe('active');
      expect(a2?.status).toBe('snoozed');
      expect(a2?.effectiveStatus).toBe('acknowledged');
    } finally {
      clearActiveFirm();
      await getSupabaseClient().auth.signOut();
    }

    // NO expiry writes: both rows are byte-identical (updated_at included)
    // after the adapter reads.
    expect(alertRow(AL.fltExpiredActive)).toEqual(beforeActive);
    expect(alertRow(AL.fltExpiredAcked)).toEqual(beforeAcked);
    expect(
      psql(`select count(*) from public.audit_log
            where object_type = 'alert' and object_id in ('${AL.fltExpiredActive}', '${AL.fltExpiredAcked}');`).trim(),
    ).toBe('0');
  });
});
