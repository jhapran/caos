/**
 * IMP-050 — scheduler mechanism contract against the REAL local stack
 * (AUTO-SCH-01…07, AUTO-OBS-01, AUTO-AUD-01/02, AUD-ACT-02/05, AUD-INV-06).
 *
 * Maps to spec 11 (IMP-050 contract closure 2026-09-12):
 *   TEST-AUTO-08 — pg_cron registration inventory: cron.job contains
 *     EXACTLY sched.recurrence.evaluate (0 19 * * *) and outbox.drain
 *     (* * * * *); sched.alerts.evaluate and sched.login_mirror.run are
 *     ABSENT (AUTO-SCH-04); register_scheduler_jobs() re-run is an
 *     idempotent named upsert (AUTO-SCH-05); the fail-closed precondition
 *     current_setting('cron.timezone', true) = 'GMT' holds (AUTO-SCH-07);
 *     and DIRECT Firm A/B scheduler isolation — fixtures in both suite
 *     firms, one evaluate_recurrence run via psql (the BYPASSRLS context,
 *     so RLS is evidence of nothing here): every instance/publication/
 *     audit row the run writes references only its own firm's ids and
 *     per-firm counts match profiles per firm (AUTO-SCH-03 explicit
 *     tenancy, verified in function-logic terms);
 *   TEST-AUTO-07 — automation audit actor model: generated-instance audit
 *     rows carry actor_type='system', service_name='recurrence',
 *     actor_user_id IS NULL (AUD-ACT-02/03/05);
 *   TEST-AUTO-11 — event_outbox contains no sched.* event_type rows and
 *     the CHECK rejects one (operator INSERT of 'sched.recurrence.evaluate'
 *     fails with 23514); a scheduler run that generates nothing writes no
 *     audit rows (and no publications);
 *   TEST-AUTO-12 — correlation propagation (AUTO-AUD-02, AUD-INV-06): the
 *     SCH-34 run row's correlation_id links every event_outbox row and
 *     every 'compliance_instance.generated' audit row the run produced.
 *
 * Everything runs through operator psql (the scheduler entry is owner-only;
 * there is NO browser surface for these records). Assertions are scoped by
 * firm/correlation — never global counts (the per-minute outbox.drain cron
 * fires during the suite).
 *
 * Deterministic ids in the 6f500000-… range; this suite owns two firms
 * (FSA/FSB); re-runnable; teardown removes rows child → parent plus the
 * suite's event_outbox/audit rows and the scheduler_job_runs rows created
 * during the suite window.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';

import { psql, userId } from '../helpers.mjs';

const FSA = '6f500000-0000-4000-8000-000000000008';
const FSB = '6f500000-0000-4000-8000-000000000009';

// Client ownership requires an ACTIVE same-firm membership (DM-04) even for
// operator-staged fixtures; no browser calls are made in this suite.
const M = {
  partnerSA: '6f500000-0000-4000-8000-0000000008b1',
  partnerSB: '6f500000-0000-4000-8000-0000000009b1',
};
const PARTNER_SA = userId('USER_A_PARTNER');
const PARTNER_SB = userId('USER_B_PARTNER');

const C = {
  sa: '6f500000-0000-4000-8000-0000000008a1',
  sb: '6f500000-0000-4000-8000-0000000009a1',
};
const E = {
  sa: '6f500000-0000-4000-8000-0000000008a2',
  sb: '6f500000-0000-4000-8000-0000000009a2',
  sa2: '6f500000-0000-4000-8000-0000000008a6', // TEST-AUTO-12 second entity
};
const T = {
  sa: '6f500000-0000-4000-8000-0000000008a3',
  sb: '6f500000-0000-4000-8000-0000000009a3',
};
const V = {
  sa1: '6f500000-0000-4000-8000-0000000008a4',
  sb1: '6f500000-0000-4000-8000-0000000009a4',
};
const P = {
  sa: '6f500000-0000-4000-8000-0000000008a5',
  sb: '6f500000-0000-4000-8000-0000000009a5',
  corr: '6f500000-0000-4000-8000-0000000008a7', // staged inside TEST-AUTO-12
};

let suiteStart: string;

/** Run a SQL batch, returning { ok, code, detail } — never throws on SQL
 *  errors so denial assertions can inspect the SQLSTATE. */
function attempt(sql: string): { ok: boolean; code: string; detail: string } {
  try {
    psql(`\\set VERBOSITY verbose\n${sql}`);
    return { ok: true, code: '', detail: '' };
  } catch (e) {
    const msg = String((e as { stderr?: string })?.stderr ?? e);
    const code = msg.match(/ERROR:\s+([0-9A-Z]{5}):/)?.[1] ?? '';
    const detail = msg.match(/DETAIL:\s*(\S+)/)?.[1] ?? '';
    return { ok: false, code, detail };
  }
}

function evaluate() {
  psql(`select public.evaluate_recurrence();`);
}

function lastRecurrenceRun(): {
  id: string;
  status: string;
  rows_affected: number | null;
  correlation_id: string;
} {
  const out = psql(`select row_to_json(r) from (
      select id, status, rows_affected, correlation_id
      from public.scheduler_job_runs
      where job_name = 'sched.recurrence.evaluate'
      order by started_at desc limit 1) r;`);
  return JSON.parse(out);
}

/** Expected monthly periods for a profile approved today under the default
 *  90-day look-ahead (computed SQL-side; AUTO-REC-10). */
function expectedMonths(): number {
  return Number(
    psql(`select count(*) from generate_series(
            date_trunc('month', (now() at time zone 'Asia/Kolkata')::date)::date,
            ((now() at time zone 'Asia/Kolkata')::date + 90)::date,
            interval '1 month') s;`).trim(),
  );
}

function cleanRows() {
  psql(`
    update public.compliance_instances set successor_instance_id = null
      where firm_id in ('${FSA}', '${FSB}');
    delete from public.audit_log where firm_id in ('${FSA}', '${FSB}');
    delete from public.event_outbox where firm_id in ('${FSA}', '${FSB}');
    begin;
    set local session_replication_role = 'replica';
    delete from public.scheduler_dead_letters where firm_id in ('${FSA}', '${FSB}');
    commit;
    delete from public.scheduler_job_runs;
    delete from public.compliance_instances where firm_id in ('${FSA}', '${FSB}');
    delete from public.client_compliance_profiles where firm_id in ('${FSA}', '${FSB}');
    delete from public.compliance_rule_versions where compliance_type_id in ('${T.sa}', '${T.sb}');
    delete from public.compliance_types where id in ('${T.sa}', '${T.sb}');
    delete from public.legal_entities where firm_id in ('${FSA}', '${FSB}');
    delete from public.clients where firm_id in ('${FSA}', '${FSB}');
    delete from public.firm_memberships where firm_id in ('${FSA}', '${FSB}');
  `);
}

beforeAll(() => {
  suiteStart = psql(`select now();`).trim();
  cleanRows();
  psql(`
    insert into public.firms (id, name) values
      ('${FSA}', 'IMP-050 SCHED Firm A'),
      ('${FSB}', 'IMP-050 SCHED Firm B')
    on conflict (id) do nothing;

    insert into public.firm_memberships (id, firm_id, user_id, role, status) values
      ('${M.partnerSA}', '${FSA}', '${PARTNER_SA}', 'partner', 'active'),
      ('${M.partnerSB}', '${FSB}', '${PARTNER_SB}', 'partner', 'active')
    on conflict (firm_id, user_id) do nothing;

    insert into public.clients (id, firm_id, name, owner_partner_membership_id, status) values
      ('${C.sa}', '${FSA}', 'SCHED Client A', '${M.partnerSA}', 'active'),
      ('${C.sb}', '${FSB}', 'SCHED Client B', '${M.partnerSB}', 'active');

    insert into public.legal_entities (id, firm_id, client_id, entity_type, legal_name) values
      ('${E.sa}',  '${FSA}', '${C.sa}', 'private_limited', 'SCHED Entity A'),
      ('${E.sb}',  '${FSB}', '${C.sb}', 'private_limited', 'SCHED Entity B'),
      ('${E.sa2}', '${FSA}', '${C.sa}', 'llp',             'SCHED Entity A2');

    insert into public.compliance_types
      (id, firm_id, type_key, name, category, frequency, due_rule, workflow_template,
       scope_kind, registration_class, governance_class, four_eyes_required)
    values
      ('${T.sa}', '${FSA}', 'sched-monthly-a', 'SCHED Monthly A', 'Certificates',
       'monthly', '{"description":"period end + 10"}', '{"states":["not_started","preparation","closed"]}',
       'entity', null, 'non_statutory', false),
      ('${T.sb}', '${FSB}', 'sched-monthly-b', 'SCHED Monthly B', 'Certificates',
       'monthly', '{"description":"period end + 10"}', '{"states":["not_started","preparation","closed"]}',
       'entity', null, 'non_statutory', false);

    insert into public.compliance_rule_versions
      (id, firm_id, compliance_type_id, version, effective_from, frequency, due_rule,
       status, domain_approval_status)
    values
      ('${V.sa1}', '${FSA}', '${T.sa}', 1, '2026-04-01', 'monthly',
       '{"days_after_period_end": 10}', 'active', 'not_required'),
      ('${V.sb1}', '${FSB}', '${T.sb}', 1, '2026-04-01', 'monthly',
       '{"days_after_period_end": 10}', 'active', 'not_required');

    insert into public.client_compliance_profiles
      (id, firm_id, legal_entity_id, compliance_type_id, status, approved_at)
    values
      ('${P.sa}', '${FSA}', '${E.sa}', '${T.sa}', 'active', now()),
      ('${P.sb}', '${FSB}', '${E.sb}', '${T.sb}', 'active', now());
  `);
  // Remove fixture audit/publication noise so per-run assertions are clean.
  psql(`
    delete from public.audit_log where firm_id in ('${FSA}', '${FSB}');
    delete from public.event_outbox where firm_id in ('${FSA}', '${FSB}');
  `);
});

afterAll(() => {
  cleanRows();
  psql(`
    delete from public.scheduler_job_runs where started_at >= '${suiteStart}'::timestamptz;
    delete from public.firms where id in ('${FSA}', '${FSB}')
      and not exists (select 1 from public.firm_memberships m where m.firm_id = firms.id)
      and not exists (select 1 from public.clients c where c.firm_id = firms.id);
    -- The firm DELETE itself lands a Layer-A audit row; sweep it last.
    delete from public.audit_log where firm_id in ('${FSA}', '${FSB}');
  `);
});

// ---------------------------------------------------------------------------
// TEST-AUTO-08 — cron registration inventory + idempotent re-registration +
// GMT precondition + direct Firm A/B scheduler isolation (AUTO-SCH-03/04/05/07)
// ---------------------------------------------------------------------------

describe('TEST-AUTO-08 — pg_cron registration inventory', () => {
  it('cron.job contains EXACTLY the two IMP-050 jobs with the expected schedule and command', () => {
    const jobs = psql(`select jobname || '|' || schedule || '|' || command from cron.job order by jobname;`)
      .trim()
      .split('\n')
      .sort();
    expect(jobs).toEqual([
      'outbox.drain|* * * * *|select public.drain_event_outbox()',
      'sched.recurrence.evaluate|0 19 * * *|select public.evaluate_recurrence()',
    ]);
    // IMP-050 deliberately does NOT register the IMP-051/deferred jobs.
    expect(
      psql(`select count(*) from cron.job
            where jobname in ('sched.alerts.evaluate', 'sched.login_mirror.run');`).trim(),
    ).toBe('0');
  });

  it('register_scheduler_jobs() re-run is an idempotent named upsert (AUTO-SCH-05)', () => {
    const snapshot = () =>
      psql(`select string_agg(jobname || '|' || schedule || '|' || command, ',' order by jobname) from cron.job;`).trim();
    const before = snapshot();
    const res = JSON.parse(psql(`select public.register_scheduler_jobs();`).trim());
    expect(res.status).toBe('registered');
    expect(res.cron_timezone).toBe('GMT');
    expect(snapshot()).toBe(before);
    expect(Number(psql(`select count(*) from cron.job;`).trim())).toBe(2);
  });

  it("the fail-closed precondition holds: current_setting('cron.timezone', true) = 'GMT' (AUTO-SCH-07)", () => {
    expect(psql(`select current_setting('cron.timezone', true);`).trim()).toBe('GMT');
  });
});

describe('TEST-AUTO-08 — direct Firm A/B scheduler isolation under the BYPASSRLS context', () => {
  it('one evaluate run writes only own-firm rows per firm; per-firm counts match profiles per firm', () => {
    evaluate();
    const months = expectedMonths();
    // One active profile per firm => exactly `months` instances per firm.
    for (const [firm, profile] of [
      [FSA, P.sa],
      [FSB, P.sb],
    ] as Array<[string, string]>) {
      expect(
        Number(
          psql(`select count(*) from public.compliance_instances where firm_id = '${firm}';`).trim(),
        ),
      ).toBe(months);
      expect(
        Number(
          psql(`select count(*) from public.compliance_instances
                where client_compliance_profile_id = '${profile}';`).trim(),
        ),
      ).toBe(months);
      // Every written row resolves exclusively to own-firm reference data
      // (entity, profile) and own-firm-or-system rule content.
      expect(
        psql(`select count(*) from public.compliance_instances i
              where i.firm_id = '${firm}'
                and (not exists (select 1 from public.legal_entities le
                                 where le.id = i.legal_entity_id and le.firm_id = i.firm_id)
                  or not exists (select 1 from public.client_compliance_profiles cp
                                 where cp.id = i.client_compliance_profile_id and cp.firm_id = i.firm_id)
                  or not exists (select 1 from public.compliance_types ct
                                 where ct.id = i.compliance_type_id
                                   and (ct.firm_id is null or ct.firm_id = i.firm_id)));`).trim(),
      ).toBe('0');
      // Publications and audit rows are firm-consistent with the instance.
      expect(
        psql(`select count(*) from public.event_outbox o
              where o.event_type = 'compliance_instance.created' and o.firm_id = '${firm}'
                and not exists (select 1 from public.compliance_instances i
                                where i.id::text = o.payload ->> 'instance_id' and i.firm_id = o.firm_id);`).trim(),
      ).toBe('0');
      expect(
        psql(`select count(*) from public.audit_log a
              where a.action = 'compliance_instance.generated' and a.firm_id = '${firm}'
                and not exists (select 1 from public.compliance_instances i
                                where i.id::text = a.object_id and i.firm_id = a.firm_id);`).trim(),
      ).toBe('0');
    }
    // And no cross-firm bleed in the other direction: nothing written by the
    // run names the OTHER suite firm's objects.
    expect(
      psql(`select count(*) from public.compliance_instances i
            where i.firm_id = '${FSA}'
              and (i.legal_entity_id in (select id from public.legal_entities where firm_id = '${FSB}')
                or i.compliance_type_id in (select id from public.compliance_types where firm_id = '${FSB}')
                or i.client_compliance_profile_id in (select id from public.client_compliance_profiles where firm_id = '${FSB}'));`).trim(),
    ).toBe('0');
  });
});

// ---------------------------------------------------------------------------
// TEST-AUTO-07 — automation audit actor model (AUD-ACT-02/03/05)
// ---------------------------------------------------------------------------

describe('TEST-AUTO-07 — generated-instance audit rows carry the system/recurrence actor', () => {
  it("actor_type='system', service_name='recurrence', actor_user_id IS NULL for every generated row", () => {
    const total = Number(
      psql(`select count(*) from public.audit_log
            where action = 'compliance_instance.generated'
              and firm_id in ('${FSA}', '${FSB}');`).trim(),
    );
    expect(total).toBe(2 * expectedMonths());
    const violations = Number(
      psql(`select count(*) from public.audit_log
            where action = 'compliance_instance.generated'
              and firm_id in ('${FSA}', '${FSB}')
              and (actor_type is distinct from 'system'
                or actor_user_id is not null
                or service_name is distinct from 'recurrence');`).trim(),
    );
    expect(violations).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// TEST-AUTO-11 — no sched.* events in the outbox; a no-op run is silent
// ---------------------------------------------------------------------------

describe('TEST-AUTO-11 — the outbox never carries scheduler-signal events', () => {
  it('event_outbox contains no sched.* rows and the CHECK rejects one (23514)', () => {
    expect(
      psql(`select count(*) from public.event_outbox where event_type like 'sched.%';`).trim(),
    ).toBe('0');
    const res = attempt(`
      insert into public.event_outbox (event_id, event_type, firm_id, actor_type, correlation_id, payload)
      values (gen_random_uuid(), 'sched.recurrence.evaluate', '${FSA}', 'system', gen_random_uuid(), '{}');
    `);
    expect(res.ok).toBe(false);
    expect(res.code).toBe('23514');
  });

  it('a scheduler run that generates nothing writes no audit rows and no publications', () => {
    evaluate(); // absorbs any catch-up
    evaluate(); // this run must be a no-op
    const run = lastRecurrenceRun();
    expect(run.status).toBe('succeeded');
    expect(run.rows_affected).toBe(0);
    expect(
      psql(`select count(*) from public.audit_log where correlation_id = '${run.correlation_id}';`).trim(),
    ).toBe('0');
    expect(
      psql(`select count(*) from public.event_outbox where correlation_id = '${run.correlation_id}';`).trim(),
    ).toBe('0');
  });
});

// ---------------------------------------------------------------------------
// TEST-AUTO-12 — correlation propagation (AUTO-AUD-02, AUD-INV-06)
// ---------------------------------------------------------------------------

describe('TEST-AUTO-12 — every effect of a run carries the run correlation id', () => {
  it("instances, publications and audit rows of a suite-triggered run share the SCH-34 run's correlation_id", () => {
    psql(`insert into public.client_compliance_profiles
          (id, firm_id, legal_entity_id, compliance_type_id, status, approved_at)
          values ('${P.corr}', '${FSA}', '${E.sa2}', '${T.sa}', 'active', now());`);
    evaluate();
    const run = lastRecurrenceRun();
    expect(run.status).toBe('succeeded');

    const months = expectedMonths();
    const created = Number(
      psql(`select count(*) from public.compliance_instances
            where client_compliance_profile_id = '${P.corr}';`).trim(),
    );
    expect(created).toBe(months);
    expect(run.rows_affected).toBe(created);

    // Every publication the run produced carries the run correlation and
    // names one of the run's instances — and vice versa (exact 1:1).
    expect(
      Number(
        psql(`select count(*) from public.event_outbox
              where correlation_id = '${run.correlation_id}'
                and event_type = 'compliance_instance.created';`).trim(),
      ),
    ).toBe(created);
    expect(
      psql(`select count(*) from public.event_outbox o
            where o.correlation_id = '${run.correlation_id}'
              and not exists (select 1 from public.compliance_instances i
                              where i.id::text = o.payload ->> 'instance_id'
                                and i.client_compliance_profile_id = '${P.corr}');`).trim(),
    ).toBe('0');
    expect(
      Number(
        psql(`select count(*) from public.audit_log
              where correlation_id = '${run.correlation_id}'
                and action = 'compliance_instance.generated';`).trim(),
      ),
    ).toBe(created);
    expect(
      psql(`select count(*) from public.audit_log a
            where a.correlation_id = '${run.correlation_id}'
              and not exists (select 1 from public.compliance_instances i
                              where i.id::text = a.object_id
                                and i.client_compliance_profile_id = '${P.corr}');`).trim(),
    ).toBe('0');
  });
});
