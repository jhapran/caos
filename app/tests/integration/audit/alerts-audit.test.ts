/**
 * IMP-042 — Alerts & alert_rules audit integration tests (TEST-AUD-02
 * alert_rules portion; TEST-AUD-03 alert manual-transition portion;
 * AUD-CAT-01 alert family; AUD-CTX-01 server-derived actor; AUD-VAL-01
 * old/new capture; AUD-FAIL-01 denial evidence; AUD-CTX-05 fail-closed;
 * spec 08 §7c Layer-A/B split).
 *
 * IMP-051 extension (same IDs): TEST-AUD-03 auto-resolution portion —
 * public.evaluate_alerts() audits its winning effects (alert.created /
 * alert.resolved / alert.snooze_expired) exactly once each with the
 * system/alerts actor and the per-run scheduler correlation; Layer-A
 * stays silent under app.audit_skip_trigger (no double auditing).
 *
 * Verifies, through REAL PostgREST requests plus operator psql inspection
 * of public.audit_log:
 *   - acknowledge_alert / snooze_alert / resolve_alert each write exactly
 *     ONE authoritative Layer-B row (alert.acknowledged / alert.snoozed /
 *     alert.resolved) with server-derived human actor, firm, and old/new
 *     snapshots — the app.audit_skip_trigger marker suppresses the Layer-A
 *     'update' duplicate, so the exact action multiset per object is
 *     authoritative; the mutation key rides new_value._mutation_key;
 *   - already_applied replays add NO audit row (no double audit); a changed
 *     valid snooze is a real second audited update;
 *   - denials (AUD-FAIL-01): a command probe against an EXISTING alert by a
 *     below-manager role is audited (alert.acknowledge_denied /
 *     alert.resolve_denied) while the caller sees the identical API-ERR-02
 *     not_found envelope; a nonexistent id gets NO invented audit row;
 *     invalid_state (acknowledge a resolved alert) and the
 *     requires_explicit_ack resolve gate are audited conflict denials;
 *   - alert-rule administration (TEST-AUD-02 portion, RLS-ARL-01 +
 *     RLS-AAL-01): create/update through the AAL2-gated commands write
 *     alert_rule.created / alert_rule.updated with correct actor and
 *     old/new snapshots; AAL1 / wrong-role / duplicate-key denials are
 *     audited (alert_rule.create_denied / alert_rule.update_denied); a
 *     nonexistent rule id is un-audited (API-ERR-02);
 *   - audit-write failure aborts the alert command atomically
 *     (fail-closed, AUD-CTX-05) via the test-only app.audit_fault hook
 *     (psql-only simulated request contexts — the IMP-031/040/041
 *     precedent).
 *
 * Re-runnable: deterministic ids in the 6e000000-… range, force-reset on
 * every run; fixture audit rows removed as the operator in teardown
 * (append-only applies to application roles, AUD-INV-01). Cleanup is
 * SCOPED to this file's two fixture firms only.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  adminDeleteFactor,
  adminListFactors,
  api,
  authPost,
  psql,
  signIn,
  totpCode,
  userEmail,
  userId,
} from '../helpers.mjs';

const H = (firm: string) => ({ 'x-active-firm': firm });

const FIRM_MAIN = '6e000000-0000-4000-8000-00000000f00a';
const FIRM_X = '6e000000-0000-4000-8000-00000000f00b';

const SYS_ITR = '50000000-0000-4000-8000-000000000005'; // seeded system type (entity scope)

const M = {
  superAdmin: '6e000000-0000-4000-8000-000000000001',
  partner: '6e000000-0000-4000-8000-000000000002',
  manager: '6e000000-0000-4000-8000-000000000003',
  senior: '6e000000-0000-4000-8000-000000000004',
  partnerX: '6e000000-0000-4000-8000-000000000005', // FIRM_X partner
};
const C = {
  main: '6e000000-0000-4000-8000-000000000101',
};
const E = {
  main: '6e000000-0000-4000-8000-000000000201',
};
const I = {
  senior: '6e000000-0000-4000-8000-000000000301', // assignee=senior (senior-visible alert)
  eval: '6e000000-0000-4000-8000-000000000302', // deadline-risk evaluation target
};
const RL = {
  plain: '6e000000-0000-4000-8000-000000000401', // requires_explicit_ack=false
  ack: '6e000000-0000-4000-8000-000000000402', // requires_explicit_ack=true
  // Extra plain-like firm rules (IMP-051 HRR-06=A repair): the five active
  // fixture alerts sharing (FIRM_MAIN, RL.plain, C.main, NULL) need their
  // own rules under alerts_nonresolved_dedupe_unique; audit assertions key
  // off alert ids, not rules.
  p2: '6e000000-0000-4000-8000-000000000404',
  p3: '6e000000-0000-4000-8000-000000000405',
  p4: '6e000000-0000-4000-8000-000000000406',
  p5: '6e000000-0000-4000-8000-000000000407',
  eval: '6e000000-0000-4000-8000-000000000403', // deadline-risk (TEST-AUD-03 evaluator portion)
};
const AL = {
  ack: '6e000000-0000-4000-8000-000000000501', // active — acknowledge + replay
  snooze: '6e000000-0000-4000-8000-000000000502', // active — snooze + changed re-snooze
  resolve: '6e000000-0000-4000-8000-000000000503', // active, RL.p3 — keyed resolve
  resolved: '6e000000-0000-4000-8000-000000000504', // staged resolved — invalid_state probe
  hidden: '6e000000-0000-4000-8000-000000000505', // active, instance-linked — role-denial probes
  gated: '6e000000-0000-4000-8000-000000000506', // active, RL.ack — resolve-gate denial
  fault: '6e000000-0000-4000-8000-000000000507', // active — AUD-CTX-05 fail-closed target
  crossProbe: '6e000000-0000-4000-8000-000000000508', // active — cross-firm denial-audit target
  expSnooze: '6e000000-0000-4000-8000-000000000509', // snoozed, expired — evaluator normalization
};
const GHOST = '6e000000-0000-4000-8000-00000000ffff';

const SUPER_ADMIN = userId('USER_A_SUPER_ADMIN');
const PARTNER = userId('USER_A_PARTNER');
const MANAGER = userId('USER_A_MANAGER');
const SENIOR = userId('USER_A_SENIOR');
const PARTNER_B = userId('USER_B_PARTNER');

let superAdminA2: string; // super_admin A, aal2 (TOTP step-up)
let partnerA: string;
let partnerA1: string; // partner A, aal1 (no step-up)
let managerA: string;
let seniorA: string;
let partnerX: string; // FIRM_X partner (cross-firm probe caller)

const factorIds: Array<{ user: string; factor: string }> = [];

interface AuditRow {
  firm_id: string | null;
  actor_type: string;
  actor_user_id: string | null;
  service_name: string | null;
  action: string;
  object_type: string;
  object_id: string | null;
  old_value: Record<string, unknown> | null;
  new_value: Record<string, unknown> | null;
  correlation_id: string | null;
}

/** Suite window start — scopes the scheduler_job_runs teardown. */
const suiteStart = new Date().toISOString();

/** Latest sched.alerts.evaluate job-run row (SCH-34 run evidence). */
function lastEvalRun(): { status: string; correlation_id: string } {
  const out = psql(`select row_to_json(r) from (
      select status, correlation_id
      from public.scheduler_job_runs
      where job_name = 'sched.alerts.evaluate'
      order by started_at desc limit 1) r;`);
  return JSON.parse(out);
}

function auditRows(objectId: string, objectTypes: string[] = ['alert']): AuditRow[] {
  const out = psql(
    `select coalesce(json_agg(row_to_json(t) order by t.created_at, t.action), '[]'::json)
     from (select * from public.audit_log
           where object_type in (${objectTypes.map((o) => `'${o}'`).join(',')})
             and object_id = '${objectId}') t`,
  );
  return JSON.parse(out);
}

/** Denial rows for keyless create probes carry object_id NULL — query by action. */
function firmActionRows(firmId: string, action: string): AuditRow[] {
  const out = psql(
    `select coalesce(json_agg(row_to_json(t) order by t.created_at), '[]'::json)
     from (select * from public.audit_log
           where firm_id = '${firmId}' and action = '${action}') t`,
  );
  return JSON.parse(out);
}

function cleanFixture() {
  psql(`
    delete from public.audit_log where firm_id in ('${FIRM_MAIN}', '${FIRM_X}');
    delete from public.alerts where firm_id in ('${FIRM_MAIN}', '${FIRM_X}');
    delete from public.alert_rules where firm_id in ('${FIRM_MAIN}', '${FIRM_X}');
    delete from public.compliance_instances where firm_id in ('${FIRM_MAIN}', '${FIRM_X}');
    delete from public.legal_entities where firm_id in ('${FIRM_MAIN}', '${FIRM_X}');
    delete from public.clients where firm_id in ('${FIRM_MAIN}', '${FIRM_X}');
    delete from public.firm_memberships where id in
      ('${M.superAdmin}', '${M.partner}', '${M.manager}', '${M.senior}', '${M.partnerX}');
  `);
}

/** aal1 session + TOTP enrol/challenge/verify -> aal2 (IMP-030 precedent). */
async function makeAal2(userKey: string): Promise<{ aal1: string; aal2: string }> {
  // Pre-clean any stale factors so a previously interrupted suite cannot
  // collide on the friendly name.
  for (const f of await adminListFactors(userId(userKey))) {
    await adminDeleteFactor(userId(userKey), f.id);
  }
  const session = await signIn(userEmail(userKey));
  if (!session.ok) throw new Error(`sign-in failed for ${userKey}: ${JSON.stringify(session.raw)}`);
  const enroll = await authPost('factors', { factor_type: 'totp', friendly_name: `imp042-aud-${userKey}` }, session.token);
  if (enroll.status !== 200) throw new Error(`enroll failed: ${JSON.stringify(enroll.body)}`);
  const factorId = enroll.body.id as string;
  factorIds.push({ user: userId(userKey), factor: factorId });
  const challenge = await authPost(`factors/${factorId}/challenge`, {}, session.token);
  const verify = await authPost(
    `factors/${factorId}/verify`,
    { challenge_id: challenge.body.id, code: totpCode(enroll.body.totp.secret) },
    session.token,
  );
  if (verify.status !== 200 || !verify.body.access_token) {
    throw new Error(`verify failed: ${JSON.stringify(verify.body)}`);
  }
  return { aal1: session.token, aal2: verify.body.access_token };
}

beforeAll(async () => {
  cleanFixture();
  psql(`
    insert into public.firms (id, name) values
      ('${FIRM_MAIN}', 'IMP-042 ALR Audit Firm Main'),
      ('${FIRM_X}', 'IMP-042 ALR Audit Firm Cross')
    on conflict (id) do nothing;

    insert into public.firm_memberships (id, firm_id, user_id, role, status) values
      ('${M.superAdmin}', '${FIRM_MAIN}', '${SUPER_ADMIN}', 'super_admin', 'active'),
      ('${M.partner}',    '${FIRM_MAIN}', '${PARTNER}',     'partner',      'active'),
      ('${M.manager}',    '${FIRM_MAIN}', '${MANAGER}',     'manager',      'active'),
      ('${M.senior}',     '${FIRM_MAIN}', '${SENIOR}',      'senior',       'active'),
      ('${M.partnerX}',   '${FIRM_X}',    '${PARTNER_B}',   'partner',      'active')
    on conflict (firm_id, user_id) do nothing;

    insert into public.clients (id, firm_id, name, owner_partner_membership_id, manager_membership_id) values
      ('${C.main}', '${FIRM_MAIN}', 'ALR Audit Client', '${M.partner}', '${M.manager}');

    insert into public.legal_entities (id, firm_id, client_id, entity_type, legal_name) values
      ('${E.main}', '${FIRM_MAIN}', '${C.main}', 'private_limited', 'ALR Audit Entity');

    insert into public.compliance_instances
      (id, firm_id, legal_entity_id, compliance_type_id, period_start, period_end,
       period_label, due_date, assignee_membership_id)
    values
      ('${I.senior}', '${FIRM_MAIN}', '${E.main}', '${SYS_ITR}', '2026-04-01', '2026-06-30', 'FY26 Q1', '2026-07-31', '${M.senior}');

    insert into public.alert_rules (id, firm_id, rule_key, name, severity, requires_explicit_ack) values
      ('${RL.plain}', '${FIRM_MAIN}', 'filing_due_soon', 'Filing due soon', 'warning',  false),
      ('${RL.ack}',   '${FIRM_MAIN}', 'risk_escalation', 'Risk escalation', 'critical', true),
      ('${RL.p2}',    '${FIRM_MAIN}', 'filing_due_soon_p2', 'Filing due soon (P2)', 'warning', false),
      ('${RL.p3}',    '${FIRM_MAIN}', 'filing_due_soon_p3', 'Filing due soon (P3)', 'warning', false),
      ('${RL.p4}',    '${FIRM_MAIN}', 'filing_due_soon_p4', 'Filing due soon (P4)', 'warning', false),
      ('${RL.p5}',    '${FIRM_MAIN}', 'filing_due_soon_p5', 'Filing due soon (P5)', 'warning', false);

    -- Alert fixtures are plain operator INSERTs (the write guard restricts
    -- UPDATE only); the staged resolved row carries the CHECK-mandated
    -- resolution triple. IMP-051 HRR-06=A: each active row carrying the
    -- (FIRM_MAIN, rule, C.main, NULL) identity gets its OWN rule — the
    -- dedupe index admits one non-resolved alert per identity.
    insert into public.alerts
      (id, firm_id, alert_rule_id, severity, title, client_id, compliance_instance_id, status,
       resolved_by, resolved_at, resolution_type)
    values
      ('${AL.ack}',     '${FIRM_MAIN}', '${RL.plain}', 'warning',  'AUD ack target',     '${C.main}', null,        'active', null, null, null),
      ('${AL.snooze}',  '${FIRM_MAIN}', '${RL.p2}',    'info',     'AUD snooze target',  '${C.main}', null,        'active', null, null, null),
      ('${AL.resolve}', '${FIRM_MAIN}', '${RL.p3}',    'critical', 'AUD resolve target', '${C.main}', null,        'active', null, null, null),
      ('${AL.resolved}','${FIRM_MAIN}', '${RL.plain}', 'warning',  'AUD resolved',       '${C.main}', null,        'resolved', '${PARTNER}', '2026-09-01T10:00:00+00:00', 'manual'),
      ('${AL.hidden}',  '${FIRM_MAIN}', '${RL.plain}', 'info',     'AUD senior-visible', '${C.main}', '${I.senior}', 'active', null, null, null),
      ('${AL.gated}',   '${FIRM_MAIN}', '${RL.ack}',   'critical', 'AUD gated',          '${C.main}', null,        'active', null, null, null),
      ('${AL.fault}',   '${FIRM_MAIN}', '${RL.p4}',    'warning',  'AUD fault target',   '${C.main}', null,        'active', null, null, null),
      ('${AL.crossProbe}', '${FIRM_MAIN}', '${RL.p5}', 'info',     'AUD cross-firm probe', '${C.main}', null,      'active', null, null, null);
  `);
  // Fixture writes are operator/system-actor rows; remove fixture noise so
  // the exact-multiset assertions read a clean table (IMP-031/040/041
  // precedent).
  psql(`delete from public.audit_log where firm_id in ('${FIRM_MAIN}', '${FIRM_X}')`);

  const [sup, partner] = await Promise.all([makeAal2('USER_A_SUPER_ADMIN'), makeAal2('USER_A_PARTNER')]);
  superAdminA2 = sup.aal2;
  partnerA1 = partner.aal1;
  const sPartner = await signIn(userEmail('USER_A_PARTNER'));
  partnerA = sPartner.token as string;
  const sManager = await signIn(userEmail('USER_A_MANAGER'));
  managerA = sManager.token as string;
  const sSenior = await signIn(userEmail('USER_A_SENIOR'));
  seniorA = sSenior.token as string;
  const sPartnerX = await signIn(userEmail('USER_B_PARTNER'));
  if (!sPartnerX.ok) throw new Error(`sign-in failed for USER_B_PARTNER: ${JSON.stringify(sPartnerX.raw)}`);
  partnerX = sPartnerX.token as string;
});

afterAll(async () => {
  try {
    for (const { user, factor } of factorIds) await adminDeleteFactor(user, factor);
    for (const u of [SUPER_ADMIN, PARTNER]) {
      const factors = await adminListFactors(u);
      for (const f of factors) await adminDeleteFactor(u, f.id);
    }
  } finally {
    cleanFixture();
    psql(`
      delete from public.firms where id in ('${FIRM_MAIN}', '${FIRM_X}')
        and not exists (select 1 from public.firm_memberships m where m.firm_id = firms.id)
        and not exists (select 1 from public.clients c where c.firm_id = firms.id);
    `);
  }
});

// ---------------------------------------------------------------------------
// TEST-AUD-03 (alert manual-transition portion) — success-path audit
// ---------------------------------------------------------------------------

describe('TEST-AUD-03 — each manual alert transition audited with server-derived actor + old/new snapshots', () => {
  it('acknowledge writes exactly ONE alert.acknowledged Layer-B row (no Layer-A duplicate)', async () => {
    const res = await api(managerA, 'POST', 'rpc/acknowledge_alert', {
      headers: H(FIRM_MAIN), body: { p_alert_id: AL.ack },
    });
    expect((res.body as { status: string }).status).toBe('acknowledged');

    const rows = auditRows(AL.ack);
    expect(rows.map((r) => r.action)).toEqual(['alert.acknowledged']);
    const row = rows[0];
    expect(row.actor_type).toBe('human');
    expect(row.actor_user_id).toBe(MANAGER); // auth.uid() — server-derived
    expect(row.firm_id).toBe(FIRM_MAIN);
    expect(row.object_type).toBe('alert');
    expect(row.old_value?.status).toBe('active');
    expect(row.new_value?.status).toBe('acknowledged');
    expect(row.new_value?.acknowledged_by).toBe(MANAGER);
    expect(row.new_value?.acknowledged_at).toBeTruthy();

    // already_applied replay adds NO audit row (no double audit).
    const replay = await api(managerA, 'POST', 'rpc/acknowledge_alert', {
      headers: H(FIRM_MAIN), body: { p_alert_id: AL.ack },
    });
    expect((replay.body as { status: string }).status).toBe('already_applied');
    expect(auditRows(AL.ack)).toHaveLength(1);
  });

  it('snooze writes alert.snoozed old/new rows; a CHANGED valid until is a real second audited update', async () => {
    const first = await api(managerA, 'POST', 'rpc/snooze_alert', {
      headers: H(FIRM_MAIN),
      body: { p_alert_id: AL.snooze, p_snoozed_until: '2026-12-01T00:00:00Z' },
    });
    expect((first.body as { status: string }).status).toBe('snoozed');
    // Identical repeat: already_applied, no row.
    const replay = await api(managerA, 'POST', 'rpc/snooze_alert', {
      headers: H(FIRM_MAIN),
      body: { p_alert_id: AL.snooze, p_snoozed_until: '2026-12-01T00:00:00Z' },
    });
    expect((replay.body as { status: string }).status).toBe('already_applied');
    // Changed valid until: real audited update.
    const changed = await api(partnerA, 'POST', 'rpc/snooze_alert', {
      headers: H(FIRM_MAIN),
      body: { p_alert_id: AL.snooze, p_snoozed_until: '2026-12-10T00:00:00Z' },
    });
    expect((changed.body as { status: string }).status).toBe('snoozed');

    const rows = auditRows(AL.snooze);
    expect(rows.map((r) => r.action)).toEqual(['alert.snoozed', 'alert.snoozed']);
    expect(rows[0].actor_user_id).toBe(MANAGER);
    expect(rows[0].old_value?.status).toBe('active');
    expect(rows[0].new_value?.status).toBe('snoozed');
    expect(rows[1].actor_user_id).toBe(PARTNER);
    expect(rows[1].old_value?.snoozed_until).toBe('2026-12-01T00:00:00+00:00');
    expect(rows[1].new_value?.snoozed_until).toBe('2026-12-10T00:00:00+00:00');
  });

  it('resolve writes alert.resolved with the mutation key riding new_value._mutation_key', async () => {
    const res = await api(partnerA, 'POST', 'rpc/resolve_alert', {
      headers: H(FIRM_MAIN), body: { p_alert_id: AL.resolve, p_mutation_key: 'aud-resolve-1' },
    });
    expect((res.body as { status: string }).status).toBe('resolved');

    const rows = auditRows(AL.resolve);
    expect(rows.map((r) => r.action)).toEqual(['alert.resolved']);
    expect(rows[0].actor_user_id).toBe(PARTNER);
    expect(rows[0].old_value?.status).toBe('active');
    expect(rows[0].new_value?.status).toBe('resolved');
    expect(rows[0].new_value?.resolution_type).toBe('manual');
    expect(rows[0].new_value?.resolved_by).toBe(PARTNER);
    expect(rows[0].new_value?._mutation_key).toBe('aud-resolve-1');

    // Keyed replay: already_applied, no second resolution audit.
    const replay = await api(partnerA, 'POST', 'rpc/resolve_alert', {
      headers: H(FIRM_MAIN), body: { p_alert_id: AL.resolve, p_mutation_key: 'aud-resolve-1' },
    });
    expect((replay.body as { status: string }).status).toBe('already_applied');
    expect(auditRows(AL.resolve)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// TEST-AUD-03 — denial audit (AUD-FAIL-01)
// ---------------------------------------------------------------------------

describe('TEST-AUD-03 — security-significant denials audited; routine probes not', () => {
  it('a below-manager command against an EXISTING alert is audited; the caller sees the identical not_found', async () => {
    const ackRes = await api(seniorA, 'POST', 'rpc/acknowledge_alert', {
      headers: H(FIRM_MAIN), body: { p_alert_id: AL.hidden },
    });
    expect(ackRes.body).toEqual({ status: 'denied', kind: 'not_found', message: 'alert not found' });
    const resolveRes = await api(seniorA, 'POST', 'rpc/resolve_alert', {
      headers: H(FIRM_MAIN), body: { p_alert_id: AL.hidden },
    });
    expect(resolveRes.body).toEqual({ status: 'denied', kind: 'not_found', message: 'alert not found' });

    const rows = auditRows(AL.hidden);
    expect(rows.map((r) => r.action).sort()).toEqual(['alert.acknowledge_denied', 'alert.resolve_denied']);
    expect(rows[0].actor_user_id).toBe(SENIOR);
    expect(rows[0].actor_type).toBe('human');
    expect(rows[0].old_value).toBeNull(); // denial rows carry a reason payload only
    expect(rows[0].new_value?.reason).toBeTruthy();
  });

  it('a nonexistent id gets NO invented audit row (no object to bind)', async () => {
    const res = await api(partnerA, 'POST', 'rpc/acknowledge_alert', {
      headers: H(FIRM_MAIN), body: { p_alert_id: GHOST },
    });
    expect((res.body as { kind: string }).kind).toBe('not_found');
    expect(auditRows(GHOST)).toEqual([]);
    expect(
      psql(`select count(*) from public.audit_log
            where firm_id = '${FIRM_MAIN}' and action like 'alert.%_denied'
              and new_value::text like '%${GHOST}%';`).trim(),
    ).toBe('0');
  });

  it('invalid_state (acknowledge a resolved alert) and the explicit-ack resolve gate are audited conflict denials', async () => {
    const res = await api(managerA, 'POST', 'rpc/acknowledge_alert', {
      headers: H(FIRM_MAIN), body: { p_alert_id: AL.resolved },
    });
    expect((res.body as { kind: string }).kind).toBe('conflict');
    const rows = auditRows(AL.resolved);
    expect(rows.map((r) => r.action)).toEqual(['alert.acknowledge_denied']);
    expect(String(rows[0].new_value?.reason)).toContain('invalid_state');
    expect(rows[0].new_value?.from_status).toBe('resolved');
    expect(
      psql(`select status from public.alerts where id = '${AL.resolved}';`).trim(),
    ).toBe('resolved');

    const gated = await api(managerA, 'POST', 'rpc/resolve_alert', {
      headers: H(FIRM_MAIN), body: { p_alert_id: AL.gated },
    });
    expect((gated.body as { kind: string }).kind).toBe('conflict');
    const gateRows = auditRows(AL.gated);
    expect(gateRows.map((r) => r.action)).toEqual(['alert.resolve_denied']);
    expect(String(gateRows[0].new_value?.reason)).toContain('requires explicit acknowledgement');
  });
});

// ---------------------------------------------------------------------------
// TEST-AUD-03 / AUD-FAIL-01 — cross-firm probes: the definer command is
// owned by postgres and SEES the existing row, so the authorization-first
// branch audits it even though the row is invisible to the caller.
// ---------------------------------------------------------------------------

describe('TEST-AUD-03 / AUD-FAIL-01 — cross-firm probes against EXISTING rows are audited; the row is untouched', () => {
  it('a cross-firm manager+ probe writes exactly one denial row per command (owning firm, server-derived actor), no protected snapshot, no mutation', async () => {
    const before = psql(`select row_to_json(a) from public.alerts a where a.id = '${AL.crossProbe}';`);

    // Own-firm selector: the FIRM_X partner targets a KNOWN-EXISTING
    // FIRM_MAIN alert. The caller sees the identical API-ERR-02 surface…
    const ack = await api(partnerX, 'POST', 'rpc/acknowledge_alert', {
      headers: H(FIRM_X), body: { p_alert_id: AL.crossProbe },
    });
    expect(ack.body).toEqual({ status: 'denied', kind: 'not_found', message: 'alert not found' });

    // … and a forged selector naming the OWNING firm is the same surface,
    // audited alike (RLS-CTX-02 — the selector is untrusted context).
    const forged = await api(partnerX, 'POST', 'rpc/resolve_alert', {
      headers: H(FIRM_MAIN), body: { p_alert_id: AL.crossProbe, p_mutation_key: 'xprobe-1' },
    });
    expect(forged.body).toEqual({ status: 'denied', kind: 'not_found', message: 'alert not found' });

    // A denial never mutates: the alert row is byte-identical.
    const after = psql(`select row_to_json(a) from public.alerts a where a.id = '${AL.crossProbe}';`);
    expect(after).toBe(before);

    const rows = auditRows(AL.crossProbe);
    expect(rows.map((r) => r.action).sort()).toEqual(['alert.acknowledge_denied', 'alert.resolve_denied']);
    for (const row of rows) {
      expect(row.firm_id).toBe(FIRM_MAIN); // audited against the OWNING firm
      expect(row.actor_type).toBe('human');
      expect(row.actor_user_id).toBe(PARTNER_B); // auth.uid(), server-derived
      expect(row.object_type).toBe('alert');
      expect(row.object_id).toBe(AL.crossProbe);
      // The denial contract carries a reason payload ONLY — no old/new
      // snapshot of the protected row (the same shape as the
      // below-authority senior probe asserted above).
      expect(row.old_value).toBeNull();
      expect(Object.keys(row.new_value ?? {})).toEqual(['reason']);
      expect(JSON.stringify(row.new_value)).not.toContain('AUD cross-firm probe');
    }
  });

  it('a cross-firm probe against a TRULY NONEXISTENT id stays un-audited (API-ERR-02)', async () => {
    const res = await api(partnerX, 'POST', 'rpc/acknowledge_alert', {
      headers: H(FIRM_X), body: { p_alert_id: GHOST },
    });
    expect(res.body).toEqual({ status: 'denied', kind: 'not_found', message: 'alert not found' });
    expect(auditRows(GHOST)).toEqual([]);
    expect(
      psql(`select count(*) from public.audit_log
            where action like 'alert.%_denied' and new_value::text like '%${GHOST}%';`).trim(),
    ).toBe('0');
  });
});

// ---------------------------------------------------------------------------
// TEST-AUD-03 — fail-closed audit (AUD-CTX-05)
// ---------------------------------------------------------------------------

describe('TEST-AUD-03 — audit-write failure aborts the transition atomically', () => {
  it('acknowledge with a failing audit write rolls back EVERYTHING (app.audit_fault test hook, psql-only)', () => {
    let failed = '';
    try {
      psql(`
        begin;
        set local request.jwt.claims = '{"sub":"${MANAGER}","aal":"aal1","role":"authenticated"}';
        set local request.headers = '{"x-active-firm":"${FIRM_MAIN}"}';
        set local app.audit_fault = 'fail_audit';
        select public.acknowledge_alert('${AL.fault}', null);
        commit;
      `);
    } catch (e) {
      failed = String((e as { stderr?: string })?.stderr ?? e);
    }
    expect(failed).toContain('audit write fault');
    // The mutation rolled back with the audit fault; no audit row exists.
    expect(
      psql(`select status from public.alerts where id = '${AL.fault}';`).trim(),
    ).toBe('active');
    expect(auditRows(AL.fault)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// TEST-AUD-02 (alert_rules portion) — every rule change audited with the
// correct actor (RLS-ARL-01, RLS-AAL-01, AUD-CAT-01)
// ---------------------------------------------------------------------------

describe('TEST-AUD-02 — alert-rule administration audit', () => {
  it('create_alert_rule writes exactly ONE alert_rule.created row with the aal2 actor and the new snapshot', async () => {
    const res = await api(superAdminA2, 'POST', 'rpc/create_alert_rule', {
      headers: H(FIRM_MAIN),
      body: {
        p_rule_key: 'audit_probe', p_name: 'Audit probe', p_severity: 'info',
        p_config: { threshold: 3 }, p_enabled: true, p_auto_resolve: false,
        p_requires_explicit_ack: true,
      },
    });
    expect((res.body as { status: string }).status).toBe('created');
    const ruleId = (res.body as { rule: { id: string } }).rule.id;

    const rows = auditRows(ruleId, ['alert_rule']);
    expect(rows.map((r) => r.action)).toEqual(['alert_rule.created']);
    expect(rows[0].actor_type).toBe('human');
    expect(rows[0].actor_user_id).toBe(SUPER_ADMIN);
    expect(rows[0].firm_id).toBe(FIRM_MAIN);
    expect(rows[0].old_value).toBeNull();
    expect(rows[0].new_value?.rule_key).toBe('audit_probe');
    expect(rows[0].new_value?.auto_resolve).toBe(false);
    expect(rows[0].new_value?.requires_explicit_ack).toBe(true);
  });

  it('update_alert_rule writes alert_rule.updated with old AND new snapshots', async () => {
    const upd = await api(superAdminA2, 'POST', 'rpc/update_alert_rule', {
      headers: H(FIRM_MAIN),
      body: { p_rule_id: RL.plain, p_enabled: false, p_config: { days: 2 } },
    });
    expect((upd.body as { status: string }).status).toBe('updated');

    const rows = auditRows(RL.plain, ['alert_rule']);
    expect(rows.map((r) => r.action)).toEqual(['alert_rule.updated']);
    expect(rows[0].actor_user_id).toBe(SUPER_ADMIN);
    expect(rows[0].old_value?.enabled).toBe(true);
    expect(rows[0].new_value?.enabled).toBe(false);
    expect(rows[0].old_value?.config).toEqual({});
    expect(rows[0].new_value?.config).toEqual({ days: 2 });
    // Patch semantics: untouched fields carry over.
    expect(rows[0].new_value?.severity).toBe('warning');
  });

  it('denials are audited: AAL1 step-up missing, wrong role, duplicate rule_key; nonexistent id is not', async () => {
    // AAL1 (no step-up) create.
    const aal1 = await api(partnerA1, 'POST', 'rpc/create_alert_rule', {
      headers: H(FIRM_MAIN),
      body: { p_rule_key: 'aal1-denied', p_name: 'denied', p_severity: 'info' },
    });
    expect((aal1.body as { kind: string }).kind).toBe('unauthorized');
    // Wrong role (manager) update of an existing rule.
    const mgr = await api(managerA, 'POST', 'rpc/update_alert_rule', {
      headers: H(FIRM_MAIN),
      body: { p_rule_id: RL.plain, p_name: 'manager edit' },
    });
    expect((mgr.body as { kind: string }).kind).toBe('unauthorized');
    // Duplicate rule_key (aal2) — a conflict, still audited.
    const dup = await api(superAdminA2, 'POST', 'rpc/create_alert_rule', {
      headers: H(FIRM_MAIN),
      body: { p_rule_key: 'filing_due_soon', p_name: 'dup', p_severity: 'info' },
    });
    expect((dup.body as { kind: string }).kind).toBe('conflict');
    // Nonexistent rule id — un-audited (API-ERR-02).
    const ghost = await api(superAdminA2, 'POST', 'rpc/update_alert_rule', {
      headers: H(FIRM_MAIN), body: { p_rule_id: GHOST, p_name: 'ghost' },
    });
    expect((ghost.body as { kind: string }).kind).toBe('not_found');

    const createDenied = firmActionRows(FIRM_MAIN, 'alert_rule.create_denied');
    expect(createDenied).toHaveLength(2);
    expect(createDenied[0].actor_user_id).toBe(PARTNER);
    expect(String(createDenied[0].new_value?.reason)).toContain('AAL2');
    expect(createDenied[1].actor_user_id).toBe(SUPER_ADMIN);
    expect(String(createDenied[1].new_value?.reason)).toContain('already exists');

    const updateDenied = firmActionRows(FIRM_MAIN, 'alert_rule.update_denied');
    expect(updateDenied).toHaveLength(1);
    expect(updateDenied[0].actor_user_id).toBe(MANAGER);
    expect(updateDenied[0].object_id).toBe(RL.plain);

    expect(auditRows(GHOST, ['alert_rule'])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// TEST-AUD-03 (auto-resolution portion, IMP-051) — the evaluate_alerts()
// evaluator audits its own winning effects exactly once each with the
// system/alerts actor and the per-run correlation; Layer-A stays silent
// (app.audit_skip_trigger) so there is no double auditing.
// ---------------------------------------------------------------------------

describe('TEST-AUD-03 — system evaluator audit (evaluate_alerts, IMP-051)', () => {
  beforeAll(() => {
    // A recognized deadline-risk rule (auto-resolve permitted) plus an
    // at-risk instance: state 'preparation' (pre-filing), due within the
    // 10-day threshold of the Asia/Kolkata business date. The instance's
    // obligation period is the NEXT quarter (FY26 Q2) — distinct from the
    // file-level I.senior fixture's (SYS_ITR, E.main, NULL registration,
    // 2026-04-01) key under cin_obligation_period_unique (period isolation;
    // the evaluator reads only state/due_date, so eligibility semantics are
    // unchanged).
    psql(`
      insert into public.alert_rules
        (id, firm_id, rule_key, name, severity, config, auto_resolve, requires_explicit_ack, enabled)
      values
        ('${RL.eval}', '${FIRM_MAIN}', 'deadline-risk', 'Deadline risk', 'warning',
         '{"days_before_due": 10}'::jsonb, true, false, true);
      insert into public.compliance_instances
        (id, firm_id, legal_entity_id, compliance_type_id, period_start, period_end,
         period_label, due_date, state)
      values
        ('${I.eval}', '${FIRM_MAIN}', '${E.main}', '${SYS_ITR}', '2026-07-01', '2026-09-30',
         'FY26 Q2', (now() at time zone 'Asia/Kolkata')::date + 5, 'preparation');
    `);
    // Staging writes are operator rows; clear fixture noise so the exact
    // evaluator-run audit multisets below read clean (suite precedent).
    psql(`delete from public.audit_log where firm_id = '${FIRM_MAIN}'`);
  });

  afterAll(() => {
    // Remove everything this describe staged or the evaluator runs created:
    // no enabled deadline-risk rule and no alert/audit/outbox/job-run noise
    // may leak into the sequentially-following suites.
    psql(`
      delete from public.event_outbox
      where firm_id = '${FIRM_MAIN}'
        and (payload ->> 'instance_id' = '${I.eval}'
             or payload ->> 'alert_id' in (
               select a.id::text from public.alerts a
               where a.firm_id = '${FIRM_MAIN}'
                 and (a.alert_rule_id = '${RL.eval}' or a.id = '${AL.expSnooze}')));
      delete from public.audit_log
      where firm_id = '${FIRM_MAIN}' and actor_type = 'system' and service_name = 'alerts';
      delete from public.alerts
      where firm_id = '${FIRM_MAIN}' and (alert_rule_id = '${RL.eval}' or id = '${AL.expSnooze}');
      delete from public.alert_rules where id = '${RL.eval}';
      delete from public.compliance_instances where id = '${I.eval}';
      delete from public.scheduler_job_runs
      where job_name = 'sched.alerts.evaluate' and started_at >= '${suiteStart}'::timestamptz;
    `);
  });

  it('evaluate_alerts creates the at-risk alert and audits alert.created exactly once (system actor, run correlation)', () => {
    psql(`select public.evaluate_alerts();`);
    const alertId = psql(`
      select id from public.alerts
      where firm_id = '${FIRM_MAIN}' and alert_rule_id = '${RL.eval}'
        and compliance_instance_id = '${I.eval}';
    `).trim();
    expect(alertId).not.toBe('');

    const run = lastEvalRun();
    expect(run.status).toBe('succeeded');
    const rows = auditRows(alertId);
    expect(rows.map((r) => r.action)).toEqual(['alert.created']);
    const row = rows[0];
    expect(row.actor_type).toBe('system');
    expect(row.actor_user_id).toBeNull(); // no fabricated human actor (AUD-ACT-05)
    expect(row.service_name).toBe('alerts');
    expect(row.firm_id).toBe(FIRM_MAIN);
    expect(row.object_type).toBe('alert');
    expect(row.object_id).toBe(alertId);
    expect(row.old_value).toBeNull();
    expect(row.new_value?.alert_id).toBe(alertId);
    expect(row.new_value?.alert_rule_id).toBe(RL.eval);
    expect(row.correlation_id).toBe(run.correlation_id);
  });

  it('filing the instance auto-resolves the alert (resolution_type auto) and audits alert.resolved exactly once — no double auditing', () => {
    const alertId = psql(`
      select id from public.alerts
      where firm_id = '${FIRM_MAIN}' and alert_rule_id = '${RL.eval}'
        and compliance_instance_id = '${I.eval}';
    `).trim();
    // Move the instance out of the at-risk condition (state -> filed) under
    // the compliance_instances single-writer marker; Layer-A stays silent
    // for this operator move.
    psql(`
      do $$
      begin
        perform set_config('app.cin_transition_command', '1', true);
        perform set_config('app.audit_skip_trigger', '1', true);
        update public.compliance_instances
        set state = 'filed', filed_at = now()
        where id = '${I.eval}';
      end
      $$;
    `);
    psql(`select public.evaluate_alerts();`);

    const run = lastEvalRun();
    const resolved = auditRows(alertId).filter((r) => r.action === 'alert.resolved');
    expect(resolved).toHaveLength(1);
    const row = resolved[0];
    expect(row.actor_type).toBe('system');
    expect(row.actor_user_id).toBeNull();
    expect(row.service_name).toBe('alerts');
    expect(row.correlation_id).toBe(run.correlation_id);
    // Old/new snapshot contract: old carries the pre-resolution row, new
    // the resolved row.
    expect(row.old_value?.status).toBe('active');
    expect(row.new_value?.status).toBe('resolved');
    expect(row.new_value?.resolution_type).toBe('auto');
    expect(row.new_value?.resolved_by).toBeNull();
    expect(row.new_value?.resolved_at).toBeTruthy();

    // No double auditing: the whole evaluator history for this alert is
    // exactly the two domain rows, and the alert INSERT/UPDATE produced NO
    // Layer-A 'insert'/'update' rows (app.audit_skip_trigger='1').
    expect(auditRows(alertId).map((r) => r.action)).toEqual(['alert.created', 'alert.resolved']);
    expect(
      psql(`select count(*) from public.audit_log
            where object_type = 'alert' and object_id = '${alertId}'
              and action in ('insert', 'update');`).trim(),
    ).toBe('0');
  });

  it('persisted snooze expiry is normalized and audited alert.snooze_expired (no fabricated alert.acknowledged)', () => {
    psql(`
      insert into public.alerts
        (id, firm_id, alert_rule_id, severity, title, status,
         acknowledged_by, acknowledged_at, snoozed_until)
      values
        ('${AL.expSnooze}', '${FIRM_MAIN}', '${RL.ack}', 'info', 'AUD expired snooze',
         'snoozed', '${PARTNER}', now() - interval '2 hours', now() - interval '1 hour');
      -- The operator INSERT fires the publication trigger and the Layer-A
      -- audit trigger; both are staging noise, not evaluator effects.
      delete from public.audit_log where object_id = '${AL.expSnooze}';
      delete from public.event_outbox where payload ->> 'alert_id' = '${AL.expSnooze}';
    `);
    psql(`select public.evaluate_alerts();`);

    const rows = auditRows(AL.expSnooze);
    expect(rows.map((r) => r.action)).toEqual(['alert.snooze_expired']);
    const row = rows[0];
    expect(row.actor_type).toBe('system');
    expect(row.actor_user_id).toBeNull();
    expect(row.service_name).toBe('alerts');
    expect(row.old_value?.status).toBe('snoozed');
    expect(row.new_value?.status).toBe('acknowledged');
    // acknowledged_at is preserved; snoozed_until is cleared.
    expect(row.new_value?.acknowledged_at).toBe(row.old_value?.acknowledged_at);
    expect(row.new_value?.snoozed_until).toBeNull();
    // The exact-multiset assertion above already proves NO fabricated
    // 'alert.acknowledged' row exists for the system path.
  });
});
