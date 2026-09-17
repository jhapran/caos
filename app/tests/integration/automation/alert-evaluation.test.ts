/**
 * IMP-051 — alert evaluation contract against the REAL local stack
 * (AUTO-ALR-01…03, HRR-06=A/HRR-09=A/HRR-11=A/HRR-12=A, AUTO-AUD-01/02,
 * AUTO-OBS-01).
 *
 * Maps to spec 11 (IMP-051 canonical TEST IDs):
 *   TEST-AUTO-04 — alert dedupe + audit-logged auto-resolution: a true
 *     deadline-risk condition creates exactly ONE alert (winner-only
 *     alert.created audit + outbox publication, system/alerts actor model,
 *     run correlation); re-evaluation dedupes (HRR-06=A structural
 *     uniqueness suppresses); when the condition clears, the gated
 *     (auto_resolve=true AND requires_explicit_ack=false) evaluator
 *     auto-resolves with resolution_type='auto', resolved_by NULL
 *     (AUD-ACT-05 — no fabricated human resolver), old/new snapshots in
 *     audit, and ONE alert.resolved publication. Folded-in fail-closed
 *     posture (interpretation (f)): an unknown rule_key is skipped with no
 *     effects and no error; a malformed days_before_due config fails THAT
 *     rule closed (run ends 'failed' with firm/rule attribution, zero
 *     effects for the rule) while a healthy firm in the SAME run still
 *     gets its alert (cross-firm continuation, AUTO-PRIN-04);
 *   TEST-AUTO-13 — evaluator alert-creation race: two concurrent
 *     evaluate_alerts runs produce exactly ONE non-resolved alert per
 *     dedupe identity, ONE alert.created publication and ONE audit row
 *     (structural dedupe is the correctness layer, HRR-12=A; separate
 *     SCH-34 rows for overlapping runs are allowed);
 *   TEST-AUTO-14 — alert retrigger / new occurrence (HRR-09=A): a resolved
 *     alert is a TERMINAL historical occurrence (byte-stable across
 *     re-evaluation — never reopened); a later true condition creates a
 *     NEW alert row with fresh lifecycle state; the current non-resolved
 *     occurrence suppresses further duplicates;
 *   TEST-AUTO-15 — persisted snooze-expiry normalization (SCH-18): the
 *     evaluator iterates firms with expired snoozes even with ZERO enabled
 *     rules; an expired snooze with acknowledgement history normalizes to
 *     'acknowledged' (acknowledged_at PRESERVED), one without to 'active';
 *     snoozed_until is cleared; a future snooze is untouched; each winning
 *     normalization writes ONE alert.snooze_expired audit row and NO
 *     domain event; a second run is a no-op (status-guarded, idempotent).
 *
 * Everything runs through operator psql (the scheduler entry is owner-only;
 * there is NO browser surface here). Instance state moves in fixtures go
 * through a DO block under the transaction-local app.cin_transition_command
 * marker (the SCH-12 single-writer guard; TEST-AUTO-09 marker precedent);
 * alert fixture rows are plain INSERTs (the SCH-18 guard gates status
 * UPDATEs, not INSERTs). Assertions are always scoped by firm/rule/alert/
 * correlation — never global counts (the per-minute outbox.drain cron and
 * the daily sched.alerts.evaluate cron run during the suite).
 *
 * Deterministic ids in the 6f610000-… range; this suite owns seven firms
 * (FA…FG — never the shared harness FIRM_A/FIRM_B, never the 6f500000-…
 * automation suites); re-runnable; teardown removes rows child → parent,
 * the suite's audit_log/event_outbox/scheduler_dead_letters rows, and the
 * scheduler_job_runs rows created during the suite window.
 */
import { spawn } from 'node:child_process';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { psql, userId } from '../helpers.mjs';

const SYS_ITR = '50000000-0000-4000-8000-000000000005'; // seeded system ITR type (entity scope)

// Firms: FA = TEST-AUTO-04 dedupe/auto-resolution; FB = TEST-AUTO-13 race;
// FC = TEST-AUTO-14 retrigger; FD = TEST-AUTO-15 snooze normalization (NO
// enabled rules — expired snoozes alone must attract the evaluator);
// FE = unknown rule_key; FF = malformed config; FG = healthy continuation.
const FA = '6f610000-0000-4000-8000-000000000001';
const FB = '6f610000-0000-4000-8000-000000000002';
const FC = '6f610000-0000-4000-8000-000000000003';
const FD = '6f610000-0000-4000-8000-000000000004';
const FE = '6f610000-0000-4000-8000-000000000005';
const FF = '6f610000-0000-4000-8000-000000000006';
const FG = '6f610000-0000-4000-8000-000000000007';
const ALL_FIRMS = [FA, FB, FC, FD, FE, FF, FG];

// Client ownership requires an ACTIVE same-firm membership (DM-04) even for
// operator-staged fixtures; no browser calls are made in this suite.
const M = {
  partnerA: '6f610000-0000-4000-8000-000000000101',
  partnerB: '6f610000-0000-4000-8000-000000000102',
  partnerC: '6f610000-0000-4000-8000-000000000103',
  partnerD: '6f610000-0000-4000-8000-000000000104',
  partnerG: '6f610000-0000-4000-8000-000000000107',
};
const PARTNER_A = userId('USER_A_PARTNER');

const C = {
  a: '6f610000-0000-4000-8000-000000000201',
  b: '6f610000-0000-4000-8000-000000000202',
  c: '6f610000-0000-4000-8000-000000000203',
  d1: '6f610000-0000-4000-8000-000000000204', // FD snooze+ack alert subject
  d2: '6f610000-0000-4000-8000-000000000205', // FD snooze-no-ack alert subject
  g: '6f610000-0000-4000-8000-000000000206',
};
const E = {
  a: '6f610000-0000-4000-8000-000000000301',
  b: '6f610000-0000-4000-8000-000000000302',
  c: '6f610000-0000-4000-8000-000000000303',
  d: '6f610000-0000-4000-8000-000000000304',
  g: '6f610000-0000-4000-8000-000000000305',
};
const I = {
  a: '6f610000-0000-4000-8000-000000000401', // FA due instance (TEST-AUTO-04)
  b: '6f610000-0000-4000-8000-000000000402', // FB race instance (TEST-AUTO-13)
  c: '6f610000-0000-4000-8000-000000000403', // FC retrigger instance (TEST-AUTO-14)
  d: '6f610000-0000-4000-8000-000000000404', // FD instance-linked future-snooze subject
  g: '6f610000-0000-4000-8000-000000000405', // FG healthy-firm due instance
};
const RL = {
  a: '6f610000-0000-4000-8000-000000000501', // deadline-risk, days_before_due 10, auto_resolve
  b: '6f610000-0000-4000-8000-000000000502', // deadline-risk, days_before_due 10
  c: '6f610000-0000-4000-8000-000000000503', // deadline-risk, days_before_due 10, auto_resolve
  e: '6f610000-0000-4000-8000-000000000504', // unknown rule_key 'workload'
  f: '6f610000-0000-4000-8000-000000000505', // deadline-risk, malformed config '{}'
  g: '6f610000-0000-4000-8000-000000000506', // healthy continuation rule (FG)
};
const AL = {
  snAck: '6f610000-0000-4000-8000-000000000601', // expired snooze WITH ack history
  snNoAck: '6f610000-0000-4000-8000-000000000602', // expired snooze WITHOUT ack history
  snFuture: '6f610000-0000-4000-8000-000000000603', // future snooze (untouched)
};

let suiteStart: string;

function evaluate() {
  psql(`select public.evaluate_alerts();`);
}

/** Concurrent scheduler entry (TEST-AUTO-13): a separate psql process per
 *  invocation so the two runs genuinely overlap (AUTO-10 precedent). */
function evaluateAsync(): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(
      'docker',
      ['exec', '-i', 'supabase_db_app', 'psql', '-U', 'postgres', '-d', 'postgres',
       '-v', 'ON_ERROR_STOP=1', '-tA', '-c', 'select public.evaluate_alerts();'],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let err = '';
    p.stderr.on('data', (d) => {
      err += d;
    });
    p.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`evaluate_alerts exited ${code}: ${err}`)),
    );
    p.on('error', reject);
  });
}

/** Latest sched.alerts.evaluate job-run row (SCH-34). */
function lastAlertsRun(): { status: string; error: string | null; rows_affected: number | null; correlation_id: string } {
  const out = psql(`select row_to_json(r) from (
      select status, error, rows_affected, correlation_id
      from public.scheduler_job_runs
      where job_name = 'sched.alerts.evaluate'
      order by started_at desc limit 1) r;`);
  return JSON.parse(out);
}

function alertCount(scope: string): number {
  return Number(psql(`select count(*) from public.alerts where ${scope};`).trim());
}

/** Move a compliance_instances.state in a fixture: the SCH-12 guard admits
 *  state writes only under the single-writer command marker (operator
 *  fixture staging — never a browser path). */
function moveInstanceState(instanceId: string, toState: string) {
  psql(`
    do $$ begin
      perform set_config('app.cin_transition_command', '1', true);
      update public.compliance_instances set state = '${toState}' where id = '${instanceId}';
    end $$;
  `);
}

function cleanRows() {
  psql(`
    update public.compliance_instances set successor_instance_id = null
      where firm_id in (${ALL_FIRMS.map((f) => `'${f}'`).join(',')});
    delete from public.audit_log where firm_id in (${ALL_FIRMS.map((f) => `'${f}'`).join(',')});
    delete from public.event_outbox where firm_id in (${ALL_FIRMS.map((f) => `'${f}'`).join(',')});
    -- SCH-35 is append-only by trigger; harness teardown runs with the
    -- replication role so the synthetic rows can be removed (zero residue).
    begin;
    set local session_replication_role = 'replica';
    delete from public.scheduler_dead_letters where firm_id in (${ALL_FIRMS.map((f) => `'${f}'`).join(',')});
    commit;
    delete from public.scheduler_job_runs;
    delete from public.alerts where firm_id in (${ALL_FIRMS.map((f) => `'${f}'`).join(',')});
    delete from public.alert_rules where firm_id in (${ALL_FIRMS.map((f) => `'${f}'`).join(',')});
    delete from public.compliance_instances where firm_id in (${ALL_FIRMS.map((f) => `'${f}'`).join(',')});
    delete from public.legal_entities where firm_id in (${ALL_FIRMS.map((f) => `'${f}'`).join(',')});
    delete from public.clients where firm_id in (${ALL_FIRMS.map((f) => `'${f}'`).join(',')});
    delete from public.firm_memberships where firm_id in (${ALL_FIRMS.map((f) => `'${f}'`).join(',')});
  `);
}

function seedFixture() {
  cleanRows();
  psql(`
    insert into public.firms (id, name) values
      ('${FA}', 'IMP-051 ALR Firm A'),
      ('${FB}', 'IMP-051 ALR Firm B'),
      ('${FC}', 'IMP-051 ALR Firm C'),
      ('${FD}', 'IMP-051 ALR Firm D'),
      ('${FE}', 'IMP-051 ALR Firm E'),
      ('${FF}', 'IMP-051 ALR Firm F'),
      ('${FG}', 'IMP-051 ALR Firm G')
    on conflict (id) do nothing;

    insert into public.firm_memberships (id, firm_id, user_id, role, status) values
      ('${M.partnerA}', '${FA}', '${PARTNER_A}', 'partner', 'active'),
      ('${M.partnerB}', '${FB}', '${PARTNER_A}', 'partner', 'active'),
      ('${M.partnerC}', '${FC}', '${PARTNER_A}', 'partner', 'active'),
      ('${M.partnerD}', '${FD}', '${PARTNER_A}', 'partner', 'active'),
      ('${M.partnerG}', '${FG}', '${PARTNER_A}', 'partner', 'active')
    on conflict (firm_id, user_id) do nothing;

    insert into public.clients (id, firm_id, name, owner_partner_membership_id, status) values
      ('${C.a}',  '${FA}', 'ALR Client A',  '${M.partnerA}', 'active'),
      ('${C.b}',  '${FB}', 'ALR Client B',  '${M.partnerB}', 'active'),
      ('${C.c}',  '${FC}', 'ALR Client C',  '${M.partnerC}', 'active'),
      ('${C.d1}', '${FD}', 'ALR Client D1', '${M.partnerD}', 'active'),
      ('${C.d2}', '${FD}', 'ALR Client D2', '${M.partnerD}', 'active'),
      ('${C.g}',  '${FG}', 'ALR Client G',  '${M.partnerG}', 'active');

    insert into public.legal_entities (id, firm_id, client_id, entity_type, legal_name) values
      ('${E.a}', '${FA}', '${C.a}',  'private_limited', 'ALR Entity A'),
      ('${E.b}', '${FB}', '${C.b}',  'private_limited', 'ALR Entity B'),
      ('${E.c}', '${FC}', '${C.c}',  'private_limited', 'ALR Entity C'),
      ('${E.d}', '${FD}', '${C.d1}', 'private_limited', 'ALR Entity D'),
      ('${E.g}', '${FG}', '${C.g}',  'private_limited', 'ALR Entity G');

    -- Due instances: state 'preparation' (pre-filing), due within the 10-day
    -- threshold of the Asia/Kolkata business date => the deadline-risk
    -- condition is TRUE. Instances alone attract NO evaluator work (a firm
    -- needs an enabled rule or an expired snooze); rules are staged lazily
    -- per describe so earlier evaluate runs never touch later fixtures.
    insert into public.compliance_instances
      (id, firm_id, legal_entity_id, compliance_type_id, period_start, period_end, period_label, due_date, state)
    values
      ('${I.a}', '${FA}', '${E.a}', '${SYS_ITR}', '2026-08-01', '2026-08-31', 'Aug 2026',
       ((now() at time zone 'Asia/Kolkata')::date + 5), 'preparation'),
      ('${I.b}', '${FB}', '${E.b}', '${SYS_ITR}', '2026-08-01', '2026-08-31', 'Aug 2026',
       ((now() at time zone 'Asia/Kolkata')::date + 5), 'preparation'),
      ('${I.c}', '${FC}', '${E.c}', '${SYS_ITR}', '2026-08-01', '2026-08-31', 'Aug 2026',
       ((now() at time zone 'Asia/Kolkata')::date + 5), 'preparation'),
      ('${I.d}', '${FD}', '${E.d}', '${SYS_ITR}', '2026-08-01', '2026-08-31', 'Aug 2026',
       ((now() at time zone 'Asia/Kolkata')::date + 5), 'preparation'),
      ('${I.g}', '${FG}', '${E.g}', '${SYS_ITR}', '2026-08-01', '2026-08-31', 'Aug 2026',
       ((now() at time zone 'Asia/Kolkata')::date + 5), 'preparation');
  `);
  // Fixture writes are operator rows; remove fixture audit/publication noise
  // so per-run correlation assertions read a clean table.
  psql(`
    delete from public.audit_log where firm_id in (${ALL_FIRMS.map((f) => `'${f}'`).join(',')});
    delete from public.event_outbox where firm_id in (${ALL_FIRMS.map((f) => `'${f}'`).join(',')});
  `);
}

beforeAll(() => {
  suiteStart = psql(`select now();`).trim();
  seedFixture();
});

afterAll(() => {
  cleanRows();
  psql(`
    delete from public.scheduler_job_runs where started_at >= '${suiteStart}'::timestamptz;
    delete from public.firms where id in (${ALL_FIRMS.map((f) => `'${f}'`).join(',')})
      and not exists (select 1 from public.firm_memberships m where m.firm_id = firms.id)
      and not exists (select 1 from public.clients c where c.firm_id = firms.id);
    -- The firm DELETE itself lands a Layer-A audit row; sweep it last.
    delete from public.audit_log where firm_id in (${ALL_FIRMS.map((f) => `'${f}'`).join(',')});
  `);
});

// ---------------------------------------------------------------------------
// TEST-AUTO-04 — alert dedupe + audit-logged auto-resolution
// (AUTO-ALR-01…03, HRR-06=A, AUTO-AUD-01/02, AUTO-OBS-01) + the fail-closed
// rule-config posture (unknown rule_key skip; malformed config isolation).
// ---------------------------------------------------------------------------

describe('TEST-AUTO-04 — alert dedupe + audit-logged auto-resolution', () => {
  let alertA: string;

  beforeAll(() => {
    psql(`
      insert into public.alert_rules
        (id, firm_id, rule_key, name, severity, config, enabled, auto_resolve, requires_explicit_ack)
      values
        ('${RL.a}', '${FA}', 'deadline-risk', 'ALR-A Deadline risk', 'warning',
         '{"days_before_due": 10}', true, true, false);
    `);
  });

  it('creates exactly one alert for a true condition and dedupes re-evaluation', () => {
    expect(alertCount(`firm_id = '${FA}' and alert_rule_id = '${RL.a}'`)).toBe(0); // pristine

    evaluate();
    const run1 = lastAlertsRun();
    expect(run1.status).toBe('succeeded');

    expect(
      alertCount(`firm_id = '${FA}' and alert_rule_id = '${RL.a}' and compliance_instance_id = '${I.a}'`),
    ).toBe(1);
    const row = JSON.parse(
      psql(`select row_to_json(a) from (
          select id, status, severity, title from public.alerts
          where firm_id = '${FA}' and alert_rule_id = '${RL.a}' and compliance_instance_id = '${I.a}') a;`),
    ) as { id: string; status: string; severity: string; title: string };
    expect(row.status).toBe('active');
    expect(row.severity).toBe('warning');
    expect(row.title).toBe('ALR-A Deadline risk');
    alertA = row.id;

    // Winner-only audit: ONE alert.created row, system/alerts actor model,
    // carrying the run's correlation identity (AUTO-AUD-01/02, AUTO-OBS-01).
    expect(
      Number(
        psql(`select count(*) from public.audit_log
              where firm_id = '${FA}' and action = 'alert.created' and object_id = '${alertA}'
                and actor_type = 'system' and actor_user_id is null and service_name = 'alerts'
                and correlation_id = '${run1.correlation_id}';`).trim(),
      ),
    ).toBe(1);
    // The publication trigger owns alert.created on the outbox path with the
    // SAME run correlation (app.correlation_id).
    expect(
      Number(
        psql(`select count(*) from public.event_outbox
              where firm_id = '${FA}' and event_type = 'alert.created'
                and payload ->> 'alert_id' = '${alertA}'
                and correlation_id = '${run1.correlation_id}';`).trim(),
      ),
    ).toBe(1);

    // Re-evaluation: the structural dedupe suppresses a second occurrence —
    // no new alert, no duplicate audit, no duplicate publication.
    evaluate();
    expect(
      alertCount(`firm_id = '${FA}' and alert_rule_id = '${RL.a}' and compliance_instance_id = '${I.a}'`),
    ).toBe(1);
    expect(
      Number(
        psql(`select count(*) from public.audit_log
              where firm_id = '${FA}' and action = 'alert.created' and object_id = '${alertA}';`).trim(),
      ),
    ).toBe(1);
    expect(
      Number(
        psql(`select count(*) from public.event_outbox
              where firm_id = '${FA}' and event_type = 'alert.created'
                and payload ->> 'alert_id' = '${alertA}';`).trim(),
      ),
    ).toBe(1);
  });

  it('auto-resolves when the condition clears, with system audit + event', () => {
    moveInstanceState(I.a, 'filed'); // condition cleared (DM-SM-04 discharged state)

    evaluate();
    const run2 = lastAlertsRun();
    // The ONLY effect in this run is FA's auto-resolution (FB/FC/FG rules
    // are not staged yet, FE/FF have none, FD has no expired snoozes yet).
    expect(run2.status).toBe('succeeded');
    expect(run2.rows_affected).toBe(1);

    expect(
      // The explicit ::text cast of the boolean renders PostgreSQL's
      // canonical text value 'true' (NOT the psql native display shorthand
      // 't') — the semantic oracle is resolved_at IS NOT NULL.
      psql(`select status || '|' || resolution_type || '|' ||
                    coalesce(resolved_by::text, '<null>') || '|' ||
                    (resolved_at is not null)::text
            from public.alerts where id = '${alertA}';`).trim(),
    ).toBe('resolved|auto|<null>|true');

    // ONE alert.resolved audit row: system/alerts actor, the pre-resolution
    // snapshot as old_value, resolution_type 'auto' in the new snapshot,
    // linked to THIS run's correlation.
    expect(
      Number(
        psql(`select count(*) from public.audit_log
              where firm_id = '${FA}' and action = 'alert.resolved' and object_id = '${alertA}'
                and actor_type = 'system' and actor_user_id is null and service_name = 'alerts'
                and old_value ->> 'status' = 'active'
                and new_value ->> 'resolution_type' = 'auto'
                and correlation_id = '${run2.correlation_id}';`).trim(),
      ),
    ).toBe(1);
    expect(
      Number(
        psql(`select count(*) from public.event_outbox
              where firm_id = '${FA}' and event_type = 'alert.resolved'
                and payload ->> 'alert_id' = '${alertA}'
                and payload ->> 'resolution_type' = 'auto'
                and correlation_id = '${run2.correlation_id}';`).trim(),
      ),
    ).toBe(1);
  });

  it('unknown rule_key is skipped with no effects and no error', () => {
    try {
      psql(`
        insert into public.alert_rules
          (id, firm_id, rule_key, name, severity, config, enabled, auto_resolve, requires_explicit_ack)
        values
          ('${RL.e}', '${FE}', 'workload', 'ALR-E Workload', 'info', '{}', true, true, false);
      `);

      evaluate();
      const run = lastAlertsRun();
      expect(run.status).toBe('succeeded'); // unknown keys never error the run
      expect(alertCount(`firm_id = '${FE}'`)).toBe(0);
      expect(
        psql(`select count(*) from public.audit_log
              where firm_id = '${FE}' and correlation_id = '${run.correlation_id}';`).trim(),
      ).toBe('0');
      expect(
        psql(`select count(*) from public.event_outbox
              where firm_id = '${FE}' and correlation_id = '${run.correlation_id}';`).trim(),
      ).toBe('0');
    } finally {
      // Never let a mid-test failure poison later evaluate runs.
      psql(`delete from public.alert_rules where id = '${RL.e}';`);
    }
  });

  it('malformed deadline-risk config fails that rule closed and the run ends failed', () => {
    try {
      psql(`
        insert into public.alert_rules
          (id, firm_id, rule_key, name, severity, config, enabled, auto_resolve, requires_explicit_ack)
        values
          ('${RL.f}', '${FF}', 'deadline-risk', 'ALR-F Broken', 'warning', '{}', true, true, false),
          ('${RL.g}', '${FG}', 'deadline-risk', 'ALR-G Deadline risk', 'critical',
           '{"days_before_due": 10}', true, true, false);
      `);

      evaluate();
      const run = lastAlertsRun();

      // Fail-closed for THAT rule: run-level SCH-34 evidence with firm/rule
      // attribution; no default threshold was ever substituted (HRR-07=A).
      expect(run.status).toBe('failed');
      expect(run.error).toContain(FF);
      expect(run.error).toContain(RL.f);
      expect(run.error).toContain('days_before_due');
      expect(alertCount(`firm_id = '${FF}'`)).toBe(0);
      expect(
        psql(`select count(*) from public.audit_log
              where firm_id = '${FF}' and correlation_id = '${run.correlation_id}';`).trim(),
      ).toBe('0');
      expect(
        psql(`select count(*) from public.event_outbox
              where firm_id = '${FF}' and correlation_id = '${run.correlation_id}';`).trim(),
      ).toBe('0');

      // Cross-firm continuation: the healthy FG rule created its alert in
      // the SAME failed run, and rows_affected counts ONLY the successful
      // persisted effects (FF's rolled-back partial effects count nothing).
      expect(
        alertCount(`firm_id = '${FG}' and alert_rule_id = '${RL.g}' and compliance_instance_id = '${I.g}'
                    and status = 'active'`),
      ).toBe(1);
      expect(run.rows_affected).toBe(1);
    } finally {
      // Full cleanup so no later evaluate run can ever see the broken rule
      // (or re-count the healthy firm's alert effects).
      psql(`
        delete from public.alerts where firm_id in ('${FE}', '${FF}', '${FG}');
        delete from public.alert_rules where firm_id in ('${FE}', '${FF}', '${FG}');
      `);
    }
  });
});

// ---------------------------------------------------------------------------
// TEST-AUTO-13 — evaluator alert-creation race (HRR-06=A correctness layer,
// HRR-12=A: NO advisory lock — structural dedupe + winner-only effects)
// ---------------------------------------------------------------------------

describe('TEST-AUTO-13 — evaluator alert-creation race', () => {
  beforeAll(() => {
    psql(`
      insert into public.alert_rules
        (id, firm_id, rule_key, name, severity, config, enabled, auto_resolve, requires_explicit_ack)
      values
        ('${RL.b}', '${FB}', 'deadline-risk', 'ALR-B Deadline risk', 'warning',
         '{"days_before_due": 10}', true, true, false);
    `);
  });

  it('two concurrent runs produce exactly one alert, one publication and one audit row', async () => {
    expect(alertCount(`firm_id = '${FB}'`)).toBe(0); // pristine before the race

    await Promise.all([evaluateAsync(), evaluateAsync()]);

    // Exactly ONE non-resolved alert for the dedupe identity — the creation
    // race loser persisted nothing (ON CONFLICT over the partial unique
    // index), audited nothing and published nothing.
    expect(
      alertCount(`firm_id = '${FB}' and alert_rule_id = '${RL.b}' and client_id = '${C.b}'
                  and compliance_instance_id = '${I.b}' and status in ('active', 'acknowledged', 'snoozed')`),
    ).toBe(1);
    expect(alertCount(`firm_id = '${FB}'`)).toBe(1);
    const raced = psql(`select id from public.alerts where firm_id = '${FB}';`).trim();
    expect(
      Number(
        psql(`select count(*) from public.event_outbox
              where firm_id = '${FB}' and event_type = 'alert.created'
                and payload ->> 'alert_id' = '${raced}';`).trim(),
      ),
    ).toBe(1);
    expect(
      Number(
        psql(`select count(*) from public.audit_log
              where firm_id = '${FB}' and action = 'alert.created' and object_id = '${raced}';`).trim(),
      ),
    ).toBe(1);
    // Separate SCH-34 rows for overlapping invocation attempts are allowed —
    // at least one sched.alerts.evaluate run must be recorded.
    expect(
      Number(
        psql(`select count(*) from public.scheduler_job_runs
              where job_name = 'sched.alerts.evaluate'
                and started_at >= '${suiteStart}'::timestamptz;`).trim(),
      ),
    ).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// TEST-AUTO-14 — alert retrigger / new occurrence (HRR-09=A: a resolved
// alert is a terminal historical occurrence; retrigger creates a NEW row)
// ---------------------------------------------------------------------------

describe('TEST-AUTO-14 — alert retrigger / new occurrence', () => {
  beforeAll(() => {
    psql(`
      insert into public.alert_rules
        (id, firm_id, rule_key, name, severity, config, enabled, auto_resolve, requires_explicit_ack)
      values
        ('${RL.c}', '${FC}', 'deadline-risk', 'ALR-C Deadline risk', 'warning',
         '{"days_before_due": 10}', true, true, false);
    `);
  });

  it('a resolved occurrence stays terminal; a retriggered condition creates a NEW alert occurrence', () => {
    // First occurrence: the true condition creates A1.
    evaluate();
    const runCreate = lastAlertsRun();
    expect(alertCount(`firm_id = '${FC}' and alert_rule_id = '${RL.c}'`)).toBe(1);
    const a1 = JSON.parse(
      psql(`select row_to_json(a) from (
          select id, raised_at from public.alerts
          where firm_id = '${FC}' and alert_rule_id = '${RL.c}' and compliance_instance_id = '${I.c}') a;`),
    ) as { id: string; raised_at: string };

    // Condition clears: A1 auto-resolves (the AUTO-04 mechanics; here the
    // resolved row is the fixture for the terminal-occurrence invariant).
    moveInstanceState(I.c, 'filed');
    evaluate();
    const runResolve = lastAlertsRun();
    expect(
      psql(`select status || '|' || resolution_type from public.alerts where id = '${a1.id}';`).trim(),
    ).toBe('resolved|auto');

    // Snapshot the resolved row: it must remain BYTE-STABLE forever after.
    const snapshot = psql(`select row_to_json(a) from public.alerts a where a.id = '${a1.id}';`).trim();

    // Retrigger: the condition is true again — a NEW occurrence, never a
    // reopen of the resolved historical one (HRR-09=A).
    moveInstanceState(I.c, 'preparation');
    evaluate();
    const runRetrigger = lastAlertsRun();
    expect(psql(`select row_to_json(a) from public.alerts a where a.id = '${a1.id}';`).trim()).toBe(snapshot);
    expect(alertCount(`firm_id = '${FC}' and alert_rule_id = '${RL.c}'`)).toBe(2);
    const a2 = JSON.parse(
      psql(`select row_to_json(a) from (
          select id, status, acknowledged_by, acknowledged_at, snoozed_until,
                 resolved_by, resolved_at, resolution_type
          from public.alerts
          where firm_id = '${FC}' and alert_rule_id = '${RL.c}' and id <> '${a1.id}') a;`),
    ) as {
      id: string;
      status: string;
      acknowledged_by: string | null;
      acknowledged_at: string | null;
      snoozed_until: string | null;
      resolved_by: string | null;
      resolved_at: string | null;
      resolution_type: string | null;
    };
    expect(a2.id).not.toBe(a1.id);
    expect(a2.status).toBe('active'); // fresh lifecycle state
    expect(a2.acknowledged_by).toBeNull();
    expect(a2.acknowledged_at).toBeNull();
    expect(a2.snoozed_until).toBeNull();
    expect(a2.resolved_by).toBeNull();
    expect(a2.resolved_at).toBeNull();
    expect(a2.resolution_type).toBeNull();
    // The new occurrence is raised no earlier than the historical one.
    expect(
      psql(`select (select raised_at from public.alerts where id = '${a2.id}')
                  >= (select raised_at from public.alerts where id = '${a1.id}');`).trim(),
    ).toBe('t');

    // Fresh correlation lifecycle (HRR-09=A + AUTO-AUD-02, against real
    // persisted evidence): the retrigger run mints its OWN correlation,
    // distinct from the create/resolve runs; the NEW occurrence's
    // alert.created audit AND its canonical outbox publication carry
    // exactly that retrigger-run correlation…
    expect(runRetrigger.correlation_id).not.toBe(runCreate.correlation_id);
    expect(runRetrigger.correlation_id).not.toBe(runResolve.correlation_id);
    expect(
      Number(
        psql(`select count(*) from public.audit_log
              where firm_id = '${FC}' and action = 'alert.created' and object_id = '${a2.id}'
                and actor_type = 'system' and actor_user_id is null and service_name = 'alerts'
                and correlation_id = '${runRetrigger.correlation_id}';`).trim(),
      ),
    ).toBe(1);
    expect(
      Number(
        psql(`select count(*) from public.event_outbox
              where firm_id = '${FC}' and event_type = 'alert.created'
                and payload ->> 'alert_id' = '${a2.id}'
                and correlation_id = '${runRetrigger.correlation_id}';`).trim(),
      ),
    ).toBe(1);
    // … while the resolved historical occurrence keeps its ORIGINAL
    // correlation history (nothing is restamped onto the retrigger run).
    expect(
      Number(
        psql(`select count(*) from public.audit_log
              where firm_id = '${FC}' and action = 'alert.created' and object_id = '${a1.id}'
                and correlation_id = '${runCreate.correlation_id}';`).trim(),
      ),
    ).toBe(1);
    expect(
      Number(
        psql(`select count(*) from public.audit_log
              where firm_id = '${FC}' and action = 'alert.resolved' and object_id = '${a1.id}'
                and correlation_id = '${runResolve.correlation_id}';`).trim(),
      ),
    ).toBe(1);
    expect(
      psql(`select count(*) from public.audit_log
            where firm_id = '${FC}' and object_id = '${a1.id}'
              and correlation_id = '${runRetrigger.correlation_id}';`).trim(),
    ).toBe('0');

    // Re-evaluation: the current non-resolved occurrence suppresses another
    // duplicate — still exactly 2 rows, exactly 1 non-resolved, and NO
    // second alert.created audit/publication for A2.
    evaluate();
    const runSuppress = lastAlertsRun();
    expect(alertCount(`firm_id = '${FC}' and alert_rule_id = '${RL.c}'`)).toBe(2);
    expect(
      alertCount(`firm_id = '${FC}' and alert_rule_id = '${RL.c}'
                  and status in ('active', 'acknowledged', 'snoozed')`),
    ).toBe(1);
    expect(
      psql(`select count(*) from public.audit_log
            where firm_id = '${FC}' and action = 'alert.created' and object_id = '${a2.id}';`).trim(),
    ).toBe('1');
    expect(
      psql(`select count(*) from public.event_outbox
            where firm_id = '${FC}' and event_type = 'alert.created'
              and payload ->> 'alert_id' = '${a2.id}'
              and correlation_id = '${runSuppress.correlation_id}';`).trim(),
    ).toBe('0');
  });
});

// ---------------------------------------------------------------------------
// TEST-AUTO-15 — persisted snooze-expiry normalization (SCH-18): the
// evaluator iterates FD despite ZERO enabled rules because expired snoozes
// alone attract work; normalization is status-guarded and publishes nothing.
// ---------------------------------------------------------------------------

describe('TEST-AUTO-15 — persisted snooze-expiry normalization', () => {
  let ackAt: string;
  let futureSnapshot: string;

  beforeAll(() => {
    // Operator INSERTs (the SCH-18 guard gates status UPDATEs, not INSERTs).
    // alert_rule_id NULL; distinct dedupe identities (client D1 / client D2 /
    // instance link) so the NULLS NOT DISTINCT partial unique index never
    // collides the three non-resolved rows.
    psql(`
      insert into public.alerts
        (id, firm_id, alert_rule_id, severity, title, client_id, compliance_instance_id,
         status, acknowledged_by, acknowledged_at, snoozed_until)
      values
        ('${AL.snAck}', '${FD}', null, 'warning', 'ALR-D snoozed with ack', '${C.d1}', null,
         'snoozed', '${PARTNER_A}', now() - interval '2 hours', now() - interval '1 hour'),
        ('${AL.snNoAck}', '${FD}', null, 'info', 'ALR-D snoozed without ack', '${C.d2}', null,
         'snoozed', null, null, now() - interval '1 hour'),
        ('${AL.snFuture}', '${FD}', null, 'critical', 'ALR-D future snooze', null, '${I.d}',
         'snoozed', null, null, now() + interval '1 day');
    `);
    // The fixture INSERTs themselves publish alert.created; remove that
    // noise so normalization event assertions read a clean table.
    psql(`
      delete from public.audit_log where firm_id = '${FD}';
      delete from public.event_outbox where firm_id = '${FD}';
    `);
    ackAt = psql(`select acknowledged_at from public.alerts where id = '${AL.snAck}';`).trim();
    futureSnapshot = psql(`select row_to_json(a) from public.alerts a where a.id = '${AL.snFuture}';`).trim();
  });

  it('expired snoozes normalize to acknowledged/active exactly once; future snoozes untouched; no events', () => {
    evaluate();
    const run1 = lastAlertsRun();
    expect(run1.status).toBe('succeeded');

    // (1) Expired snooze WITH acknowledgement history -> 'acknowledged';
    // acknowledged_at PRESERVED byte-for-byte; snoozed_until cleared.
    expect(
      psql(`select status || '|' || coalesce(snoozed_until::text, '<null>') || '|' || acknowledged_at
            from public.alerts where id = '${AL.snAck}';`).trim(),
    ).toBe(`acknowledged|<null>|${ackAt}`);
    // (2) Expired snooze WITHOUT acknowledgement history -> 'active'.
    expect(
      psql(`select status || '|' || coalesce(snoozed_until::text, '<null>') || '|' ||
                    coalesce(acknowledged_at::text, '<null>')
            from public.alerts where id = '${AL.snNoAck}';`).trim(),
    ).toBe('active|<null>|<null>');
    // (3) Future snooze: UNCHANGED (byte-stable full row).
    expect(psql(`select row_to_json(a) from public.alerts a where a.id = '${AL.snFuture}';`).trim()).toBe(
      futureSnapshot,
    );

    // ONE alert.snooze_expired audit row per winning normalization, with the
    // system/alerts actor model and THIS run's correlation.
    expect(
      Number(
        psql(`select count(*) from public.audit_log
              where firm_id = '${FD}' and action = 'alert.snooze_expired' and object_id = '${AL.snAck}'
                and actor_type = 'system' and actor_user_id is null and service_name = 'alerts'
                and old_value ->> 'status' = 'snoozed'
                and new_value ->> 'status' = 'acknowledged'
                and correlation_id = '${run1.correlation_id}';`).trim(),
      ),
    ).toBe(1);
    expect(
      Number(
        psql(`select count(*) from public.audit_log
              where firm_id = '${FD}' and action = 'alert.snooze_expired' and object_id = '${AL.snNoAck}'
                and actor_type = 'system' and actor_user_id is null and service_name = 'alerts'
                and old_value ->> 'status' = 'snoozed'
                and new_value ->> 'status' = 'active'
                and correlation_id = '${run1.correlation_id}';`).trim(),
      ),
    ).toBe(1);
    // Normalization publishes NOTHING (the trigger fires only on INSERT and
    // on status->resolved): zero outbox rows of any type under this run.
    expect(
      psql(`select count(*) from public.event_outbox
            where firm_id = '${FD}' and correlation_id = '${run1.correlation_id}';`).trim(),
    ).toBe('0');
    // NO fabricated acknowledgement (SCH-18 / AUD vocabulary): the system
    // normalization is NEVER represented as a human acknowledgement —
    // alert.snooze_expired is the ONLY evaluator-owned normalization action.
    // Zero alert.acknowledged audit rows under this run's correlation, and
    // zero for the normalized alert identities at all (their genuine
    // acknowledgement HISTORY is a persisted stamp, not an audit action —
    // the suite wiped fixture audit noise in beforeAll, so any
    // alert.acknowledged row here could only be a normalization forgery).
    expect(
      psql(`select count(*) from public.audit_log
            where firm_id = '${FD}' and action = 'alert.acknowledged'
              and correlation_id = '${run1.correlation_id}';`).trim(),
    ).toBe('0');
    expect(
      psql(`select count(*) from public.audit_log
            where firm_id = '${FD}' and action = 'alert.acknowledged'
              and object_id in ('${AL.snAck}', '${AL.snNoAck}', '${AL.snFuture}');`).trim(),
    ).toBe('0');

    // Second run: status-guarded updates no-op — rows unchanged, NO
    // additional alert.snooze_expired audit, still no events.
    evaluate();
    const run2 = lastAlertsRun();
    expect(run2.status).toBe('succeeded');
    expect(
      psql(`select status || '|' || coalesce(snoozed_until::text, '<null>') || '|' || acknowledged_at
            from public.alerts where id = '${AL.snAck}';`).trim(),
    ).toBe(`acknowledged|<null>|${ackAt}`);
    expect(
      psql(`select status from public.alerts where id = '${AL.snNoAck}';`).trim(),
    ).toBe('active');
    expect(psql(`select row_to_json(a) from public.alerts a where a.id = '${AL.snFuture}';`).trim()).toBe(
      futureSnapshot,
    );
    expect(
      Number(
        psql(`select count(*) from public.audit_log
              where firm_id = '${FD}' and action = 'alert.snooze_expired';`).trim(),
      ),
    ).toBe(2); // exactly the two first-run rows — idempotent no-op
    expect(
      psql(`select count(*) from public.event_outbox
            where firm_id = '${FD}' and correlation_id = '${run2.correlation_id}';`).trim(),
    ).toBe('0');
    // … and STILL no fabricated acknowledgement after the second run.
    expect(
      psql(`select count(*) from public.audit_log
            where firm_id = '${FD}' and action = 'alert.acknowledged'
              and object_id in ('${AL.snAck}', '${AL.snNoAck}', '${AL.snFuture}');`).trim(),
    ).toBe('0');
  });
});
