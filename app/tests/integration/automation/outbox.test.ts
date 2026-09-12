/**
 * IMP-050 — transactional outbox drain / bounded retry / dead-letter /
 * recovery contract against the REAL local stack (SCH-33/34/35,
 * AUTO-FLOW-03/05, AUTO-IDM-01, AUTO-RET-01/02, AUTO-RPL-01/02, AUTO-OBS-01).
 *
 * Maps to spec 11 (IMP-050 contract closure 2026-09-12, incl. the
 * TEST-AUTO-05/06 clarification — harness-only consumers via the
 * outbox_consumer_<event_type>(uuid) discovery point, fully torn down):
 *   TEST-AUTO-05 — delivery + effect-key idempotency: a harness-only
 *     synthetic consumer records effects keyed by payload->>'instance_id'
 *     (NOT by event_id); two publications of the SAME domain fact drain to
 *     'delivered' with exactly ONE effect row;
 *   TEST-AUTO-06 — failure injection: an always-raising consumer drives a
 *     publication through bounded exponential retry (attempt_count caps at
 *     5) into 'dead_lettered' with an SCH-35 record (source/firm/
 *     correlation/payload/failure metadata, first/last failure stamps) and
 *     SCH-34 drain run rows (operational visibility); then
 *     requeue_dead_letter: empty/NULL reason denied (validation), requeue of
 *     a PENDING publication refused (conflict), requeue of an
 *     already-requeued dead letter refused (conflict), successful requeue
 *     creates a NEW publication (new event_id, requeue_of lineage, envelope
 *     unchanged, ORIGINAL correlation preserved, status pending), the dead
 *     letter moves open -> requeued, and the recovery is audited as
 *     actor_type='service' / service_name='dead-letter-recovery';
 *   TEST-OPS-07 (local portion) — a failing scheduled path is detected and
 *     safely re-run: the drain-side failure is visible (last_error +
 *     SCH-34/SCH-35), dropping the failing consumer and re-draining
 *     delivers the requeued publication with NO duplicate effects; the
 *     recurrence-side failure (invalid firm config) fails the run in
 *     SCH-34, and the re-run after the fix succeeds idempotently.
 *
 * The per-minute outbox.drain cron fires during this suite: failure-
 * injection publications are parked at next_attempt_at = +1h and re-armed
 * explicitly before each manual drain, so the cron can never steal an
 * attempt; delivery-path publications are drain-agnostic (cron or manual
 * drain produce identical state). Assertions are scoped by firm/correlation
 * — never global counts.
 *
 * Deterministic ids in the 6f500000-… range; this suite owns one firm (FO);
 * re-runnable; teardown drops the harness-only consumer functions and the
 * hgate_auto_effects table, and removes every suite row (event_outbox,
 * scheduler_dead_letters — via the replication role since SCH-35 is
 * append-only by trigger — audit_log, scheduler_job_runs window) with a
 * zero-residue assertion.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { psql, userId } from '../helpers.mjs';

const FO = '6f500000-0000-4000-8000-000000000005';

// Client ownership requires an ACTIVE same-firm membership (DM-04) even for
// operator-staged fixtures; no browser calls are made in this suite.
const M = { partnerO: '6f500000-0000-4000-8000-0000000005a1' };
const PARTNER_O = userId('USER_B_PARTNER');

const C = { o: '6f500000-0000-4000-8000-0000000005c1' };
const E = { o: '6f500000-0000-4000-8000-0000000005e1' };
const T = { o: '6f500000-0000-4000-8000-0000000005f1' };
const V = { o1: '6f500000-0000-4000-8000-0000000005d1' };
const P = { o: '6f500000-0000-4000-8000-0000000005b1' };

// Publications / correlations (fixed uuids for deterministic assertions).
const E5A = '6f500000-0000-4000-8000-00000000500a'; // publication 1 (AUTO-05)
const E5B = '6f500000-0000-4000-8000-00000000500b'; // publication 2 (AUTO-05)
const I5 = '6f500000-0000-4000-8000-00000000500c'; // shared domain fact (instance id)
const C5 = '6f500000-0000-4000-8000-00000000500d';
const E6 = '6f500000-0000-4000-8000-000000005006'; // failing publication (AUTO-06)
const C6 = '6f500000-0000-4000-8000-000000005007'; // its correlation id
const E6B = '6f500000-0000-4000-8000-00000000500e'; // pending publication (requeue refusal)
const C6B = '6f500000-0000-4000-8000-00000000500f';
const DL6B = '6f500000-0000-4000-8000-000000005010'; // manual dead letter over E6B

let suiteStart: string;

function drain() {
  psql(`select public.drain_event_outbox();`);
}

function outboxRow(eventId: string): Record<string, unknown> {
  return JSON.parse(
    psql(`select row_to_json(o) from public.event_outbox o where o.event_id = '${eventId}';`),
  );
}

function requeue(deadLetterId: string, reason: string | null): Record<string, unknown> {
  const out = psql(
    `select public.requeue_dead_letter('${deadLetterId}', ${reason === null ? 'null' : `'${reason}'`});`,
  ).trim();
  return JSON.parse(out.split('\n').find((l) => l.startsWith('{')) ?? '{}');
}

function cleanRows() {
  psql(`
    delete from public.audit_log where firm_id = '${FO}';
    delete from public.event_outbox where firm_id = '${FO}';
    begin;
    set local session_replication_role = 'replica';
    delete from public.scheduler_dead_letters where firm_id = '${FO}';
    commit;
    delete from public.scheduler_job_runs;
    delete from public.compliance_instances where firm_id = '${FO}';
    delete from public.client_compliance_profiles where firm_id = '${FO}';
    delete from public.compliance_rule_versions where compliance_type_id = '${T.o}';
    delete from public.compliance_types where id = '${T.o}';
    delete from public.legal_entities where firm_id = '${FO}';
    delete from public.clients where firm_id = '${FO}';
    delete from public.firm_memberships where firm_id = '${FO}';
  `);
}

beforeAll(() => {
  suiteStart = psql(`select now();`).trim();
  cleanRows();
  psql(`
    insert into public.firms (id, name) values ('${FO}', 'IMP-050 OUTBOX Firm')
    on conflict (id) do nothing;

    insert into public.firm_memberships (id, firm_id, user_id, role, status) values
      ('${M.partnerO}', '${FO}', '${PARTNER_O}', 'partner', 'active')
    on conflict (firm_id, user_id) do nothing;

    -- OPS-07 recurrence-half fixture: one active monthly profile.
    insert into public.clients (id, firm_id, name, owner_partner_membership_id, status) values
      ('${C.o}', '${FO}', 'OUTBOX Client', '${M.partnerO}', 'active');
    insert into public.legal_entities (id, firm_id, client_id, entity_type, legal_name) values
      ('${E.o}', '${FO}', '${C.o}', 'private_limited', 'OUTBOX Entity');
    insert into public.compliance_types
      (id, firm_id, type_key, name, category, frequency, due_rule, workflow_template,
       scope_kind, registration_class, governance_class, four_eyes_required)
    values
      ('${T.o}', '${FO}', 'outbox-monthly', 'OUTBOX Monthly', 'Certificates',
       'monthly', '{"description":"period end + 10"}', '{"states":["not_started","preparation","closed"]}',
       'entity', null, 'non_statutory', false);
    insert into public.compliance_rule_versions
      (id, firm_id, compliance_type_id, version, effective_from, frequency, due_rule,
       status, domain_approval_status)
    values
      ('${V.o1}', '${FO}', '${T.o}', 1, '2026-04-01', 'monthly',
       '{"days_after_period_end": 10}', 'active', 'not_required');
    insert into public.client_compliance_profiles
      (id, firm_id, legal_entity_id, compliance_type_id, status, approved_at)
    values
      ('${P.o}', '${FO}', '${E.o}', '${T.o}', 'active', now());

    -- TEST-AUTO-05 harness-only effect sink + synthetic consumer (the
    -- sanctioned test-only registration point; SECURITY INVOKER is
    -- sufficient — drain runs as the owner). The parameter is deliberately
    -- NAMED: the drain discovers consumers by argument-TYPE identity
    -- (proargtypes = uuid), so named- and unnamed-arg declarations are
    -- discovered identically — this suite pins that.
    create table public.hgate_auto_effects (
      effect_key text primary key,
      event_id uuid,
      created_at timestamptz default now()
    );
    create or replace function public.outbox_consumer_compliance_instance_created(p_event_id uuid)
    returns void language plpgsql set search_path = '' as $$
    declare
      v_payload jsonb;
    begin
      select o.payload into v_payload from public.event_outbox o where o.event_id = p_event_id;
      insert into public.hgate_auto_effects (effect_key, event_id)
      values (v_payload ->> 'instance_id', p_event_id)
      on conflict (effect_key) do nothing;
    end $$;
  `);
  psql(`
    delete from public.audit_log where firm_id = '${FO}';
    delete from public.event_outbox where firm_id = '${FO}';
  `);
});

afterAll(() => {
  psql(`
    drop function if exists public.outbox_consumer_compliance_instance_created(uuid);
    drop function if exists public.outbox_consumer_task_created(uuid);
    drop table if exists public.hgate_auto_effects;
  `);
  cleanRows();
  psql(`
    delete from public.scheduler_job_runs where started_at >= '${suiteStart}'::timestamptz;
    delete from public.firms where id = '${FO}'
      and not exists (select 1 from public.firm_memberships m where m.firm_id = firms.id)
      and not exists (select 1 from public.clients c where c.firm_id = firms.id);
    -- The firm DELETE itself lands a Layer-A audit row; sweep it last.
    delete from public.audit_log where firm_id = '${FO}';
  `);
  // Zero synthetic residue is a hard requirement (the gate's db-cleanliness
  // phase fails on leftover hgate% tables).
  expect(
    psql(`select count(*) from information_schema.tables
          where table_schema = 'public' and table_name like 'hgate_auto%';`).trim(),
  ).toBe('0');
  expect(
    psql(`select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname like 'outbox_consumer_%';`).trim(),
  ).toBe('0');
  expect(
    psql(`select (select count(*) from public.event_outbox where firm_id = '${FO}')
               , (select count(*) from public.scheduler_dead_letters where firm_id = '${FO}')
               , (select count(*) from public.audit_log where firm_id = '${FO}');`).trim(),
  ).toBe('0|0|0');
});

// ---------------------------------------------------------------------------
// TEST-AUTO-05 — delivery + effect-key idempotency (AUTO-IDM-01, AUTO-FLOW-05)
// ---------------------------------------------------------------------------

describe('TEST-AUTO-05 — two publications of one domain fact drain to exactly one effect', () => {
  it('both publications deliver; the effect key (instance_id), NOT the event id, is the idempotency identity', () => {
    psql(`
      insert into public.event_outbox (event_id, event_type, firm_id, actor_type, correlation_id, payload)
      values
        ('${E5A}', 'compliance_instance.created', '${FO}', 'system', '${C5}',
         '{"instance_id": "${I5}", "due_date": "2026-10-31"}'),
        ('${E5B}', 'compliance_instance.created', '${FO}', 'system', '${C5}',
         '{"instance_id": "${I5}", "due_date": "2026-10-31"}');
    `);
    drain();

    for (const id of [E5A, E5B]) {
      const row = outboxRow(id);
      expect(row.status).toBe('delivered');
      expect(row.processed_at).not.toBeNull();
    }
    // Effect-key idempotency: ONE effect row for the shared instance_id even
    // though two publication rows (two event ids) were delivered. (Scoped to
    // the suite's effect key: while the harness consumer is registered, the
    // drain also delivers OTHER suites' pending compliance_instance.created
    // publications through it — the per-minute cron makes that race real.)
    const effects = psql(`select event_id from public.hgate_auto_effects where effect_key = '${I5}';`)
      .trim()
      .split('\n');
    expect(effects.length).toBe(1);
    expect([E5A, E5B]).toContain(effects[0]);
  });
});

// ---------------------------------------------------------------------------
// TEST-AUTO-06 — bounded retry, dead-letter, hardened recovery
// ---------------------------------------------------------------------------

describe('TEST-AUTO-06 — failure injection drives bounded retry into dead-letter; recovery is dead-letter-gated', () => {
  it('five attempts cap the retry; exhaustion dead-letters to SCH-35 with full metadata; drain runs are recorded', () => {
    psql(`
      create or replace function public.outbox_consumer_task_created(p_event_id uuid)
      returns void language plpgsql set search_path = '' as $$
      begin
        raise exception 'hgate injected failure (event %)', p_event_id;
      end $$;
      insert into public.event_outbox
        (event_id, event_type, firm_id, actor_type, correlation_id, payload, next_attempt_at)
      values
        ('${E6}', 'task.created', '${FO}', 'system', '${C6}',
         '{"task_id": "6f500000-0000-4000-8000-000000005099"}',
         now() + interval '1 hour'); -- parked: the per-minute cron never steals an attempt
    `);

    for (let i = 1; i <= 5; i++) {
      // Re-arm the due time (lifecycle metadata update is legal) and drain.
      psql(`update public.event_outbox set next_attempt_at = now() where event_id = '${E6}';`);
      drain();
      const row = outboxRow(E6);
      if (i < 5) {
        expect(row.status).toBe('failed');
        expect(Number(row.attempt_count)).toBe(i);
        expect(String(row.last_error)).toContain('hgate injected failure');
        expect(row.first_failed_at).not.toBeNull();
        expect(row.next_attempt_at).not.toBeNull(); // exponential backoff re-armed
      } else {
        expect(row.status).toBe('dead_lettered');
        expect(Number(row.attempt_count)).toBe(5); // bounded: never a 6th attempt
        expect(row.processed_at).not.toBeNull();
      }
    }

    // SCH-35 dual visibility: exactly one dead-letter record with the full
    // failure metadata and the ORIGINAL correlation (AUTO-RET-02).
    const dls = psql(`select row_to_json(d) from public.scheduler_dead_letters d
      where d.source_id = '${E6}';`)
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l));
    expect(dls.length).toBe(1);
    const dl = dls[0];
    expect(dl.source).toBe('outbox_event');
    expect(dl.firm_id).toBe(FO);
    expect(dl.correlation_id).toBe(C6);
    expect(dl.payload).toEqual({ task_id: '6f500000-0000-4000-8000-000000005099' });
    expect(String(dl.failure_reason)).toContain('hgate injected failure');
    expect(Number(dl.attempt_count)).toBe(5);
    expect(dl.first_failed_at).not.toBeNull();
    expect(dl.last_failed_at).not.toBeNull();
    expect(dl.status).toBe('open');

    // SCH-34 operational visibility: every manual drain in this suite is a
    // recorded job run (the per-minute cron adds more on top).
    expect(
      Number(
        psql(`select count(*) from public.scheduler_job_runs
              where job_name = 'outbox.drain' and started_at >= '${suiteStart}'::timestamptz;`).trim(),
      ),
    ).toBeGreaterThanOrEqual(6);
  });

  it('requeue_dead_letter: reason required; pending publications and requeued dead letters refused; success preserves lineage', () => {
    const dlId = psql(`select id from public.scheduler_dead_letters where source_id = '${E6}';`).trim();

    // A recovery reason is required and recorded (AUTO-RPL-02).
    expect(requeue(dlId, '')).toMatchObject({ status: 'denied', kind: 'validation' });
    expect(requeue(dlId, '   ')).toMatchObject({ status: 'denied', kind: 'validation' });
    expect(requeue(dlId, null)).toMatchObject({ status: 'denied', kind: 'validation' });
    expect(outboxRow(E6).status).toBe('dead_lettered'); // untouched

    // Dead-letter gate (AUTO-RPL-01): a PENDING publication is never
    // manually requeued, even with a staged open dead letter pointing at it.
    psql(`
      insert into public.event_outbox (event_id, event_type, firm_id, actor_type, correlation_id, payload, next_attempt_at)
      values ('${E6B}', 'task.created', '${FO}', 'system', '${C6B}',
              '{"task_id": "6f500000-0000-4000-8000-000000005098"}', now() + interval '1 hour');
      insert into public.scheduler_dead_letters
        (id, source, source_id, firm_id, correlation_id, payload, failure_reason,
         attempt_count, first_failed_at, last_failed_at)
      values ('${DL6B}', 'outbox_event', '${E6B}', '${FO}', '${C6B}',
              '{"task_id": "6f500000-0000-4000-8000-000000005098"}', 'staged refusal probe',
              5, now(), now());
    `);
    const refused = requeue(DL6B, 'probe');
    expect(refused.status).toBe('denied');
    expect(refused.kind).toBe('conflict');
    expect(String(refused.message)).toContain('dead_lettered');
    // Clean the probe rows (SCH-35 is append-only by trigger — harness
    // teardown semantics via the replication role).
    psql(`
      begin;
      set local session_replication_role = 'replica';
      delete from public.scheduler_dead_letters where id = '${DL6B}';
      commit;
      delete from public.event_outbox where event_id = '${E6B}';
    `);

    // Successful recovery (AUTO-RPL-01): NEW publication, NEW event_id,
    // envelope unchanged, requeue_of lineage, ORIGINAL correlation.
    const before = outboxRow(E6);
    const ok = requeue(dlId, 'consumer defect fixed; see TEST-OPS-07');
    expect(ok.status).toBe('requeued');
    const newId = String(ok.new_event_id);
    expect(newId).not.toBe(E6);
    const repub = outboxRow(newId);
    expect(repub.event_type).toBe(before.event_type);
    expect(repub.firm_id).toBe(before.firm_id);
    expect(repub.occurred_at).toBe(before.occurred_at);
    expect(repub.actor_type).toBe(before.actor_type);
    expect(repub.payload).toEqual(before.payload);
    expect(repub.requeue_of).toBe(E6);
    expect(repub.correlation_id).toBe(C6); // AUTO-RET-02
    expect(repub.status).toBe('pending');
    expect(Number(repub.attempt_count)).toBe(0);

    // The dead letter moved open -> requeued; a second requeue is a conflict.
    expect(
      psql(`select status from public.scheduler_dead_letters where id = '${dlId}';`).trim(),
    ).toBe('requeued');
    expect(requeue(dlId, 'again')).toMatchObject({ status: 'denied', kind: 'conflict' });

    // The recovery itself is audited with the service actor taxonomy
    // (AUD-ACT-03), preserving the original correlation chain.
    expect(
      psql(`select count(*) from public.audit_log
            where firm_id = '${FO}' and action = 'event_outbox.dead_letter_requeued'
              and object_type = 'scheduler_dead_letter' and object_id = '${dlId}'
              and actor_type = 'service' and actor_user_id is null
              and service_name = 'dead-letter-recovery'
              and correlation_id = '${C6}';`).trim(),
    ).toBe('1');

    // Park the requeued publication (lifecycle metadata only) so the
    // per-minute cron cannot drain it while the FAILING consumer is still
    // registered — TEST-OPS-07 re-arms it after the fix.
    psql(`update public.event_outbox set next_attempt_at = now() + interval '1 hour' where event_id = '${newId}';`);
  });
});

// ---------------------------------------------------------------------------
// TEST-OPS-07 (local portion) — failure detected, fix applied, safe re-run
// ---------------------------------------------------------------------------

describe('TEST-OPS-07 — scheduler failure is visible and the re-run after the fix is safe', () => {
  it('drain half: dropping the failing consumer delivers the requeued publication with no duplicate effects', () => {
    // The failure is on the record: last_error on the publication, SCH-34
    // run rows, the (now requeued) SCH-35 row — asserted in TEST-AUTO-06.
    const newId = psql(`select event_id from public.event_outbox where requeue_of = '${E6}';`).trim();
    expect(newId).not.toBe('');

    // Fix: remove the defect (the harness-only failing consumer), re-arm
    // the publication, and re-drain.
    psql(`drop function public.outbox_consumer_task_created(uuid);`);
    psql(`update public.event_outbox set next_attempt_at = now() where event_id = '${newId}';`);
    drain();
    const repub = outboxRow(newId);
    expect(repub.status).toBe('delivered');
    expect(repub.processed_at).not.toBeNull();
    // No new dead letters for the suite firm; the original stays 'requeued'.
    expect(
      psql(`select count(*) from public.scheduler_dead_letters where firm_id = '${FO}';`).trim(),
    ).toBe('1');
    // No duplicate effects: the AUTO-05 effect for the shared domain fact
    // is still exactly one row.
    expect(
      Number(psql(`select count(*) from public.hgate_auto_effects where effect_key = '${I5}';`).trim()),
    ).toBe(1);
  });

  it('recurrence half: an invalid firm config fails the run observably; the fixed re-run succeeds idempotently', () => {
    const countInstances = () =>
      Number(
        psql(`select count(*) from public.compliance_instances
              where client_compliance_profile_id = '${P.o}';`).trim(),
      );
    const expected90 = Number(
      psql(`select count(*) from generate_series(
              date_trunc('month', (now() at time zone 'Asia/Kolkata')::date)::date,
              ((now() at time zone 'Asia/Kolkata')::date + 90)::date,
              interval '1 month') s;`).trim(),
    );
    try {
      psql(`update public.firms set settings = '{"recurrence_lookahead_days": -3}'::jsonb where id = '${FO}';`);
      const beforeCount = countInstances();
      psql(`select public.evaluate_recurrence();`);
      const failed = psql(`select row_to_json(r) from (
          select status, error from public.scheduler_job_runs
          where job_name = 'sched.recurrence.evaluate'
          order by started_at desc limit 1) r;`);
      const run = JSON.parse(failed);
      expect(run.status).toBe('failed'); // SCH-34 records the failure
      expect(run.error).toContain(FO);
      expect(countInstances()).toBe(beforeCount); // the firm's work rolled back

      psql(`update public.firms set settings = '{}'::jsonb where id = '${FO}';`);
      psql(`select public.evaluate_recurrence();`);
      expect(
        JSON.parse(
          psql(`select row_to_json(r) from (
              select status from public.scheduler_job_runs
              where job_name = 'sched.recurrence.evaluate'
              order by started_at desc limit 1) r;`),
        ).status,
      ).toBe('succeeded');
      expect(countInstances()).toBe(expected90);
      // Safe re-run: idempotent, one instance per period.
      psql(`select public.evaluate_recurrence();`);
      expect(countInstances()).toBe(expected90);
      expect(
        psql(`select period_start from public.compliance_instances
              where client_compliance_profile_id = '${P.o}'
              group by period_start having count(*) <> 1;`).trim(),
      ).toBe('');
    } finally {
      psql(`update public.firms set settings = '{}'::jsonb where id = '${FO}';`);
    }
  });
});
