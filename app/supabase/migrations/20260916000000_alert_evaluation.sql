-- IMP-051 — Deadline materialization & alert evaluation
--
-- Implements exactly the automation/read-model scope owned by this package:
--   * SCH-18 lifecycle CHECK correction: the resolved clause now models the
--     approved hybrid actor split — resolution_type='manual' requires a human
--     resolved_by (auth.users); resolution_type='auto' requires resolved_by
--     IS NULL (system automation must not masquerade as an auth.users human
--     actor, AUD-ACT-05; NO synthetic system auth.users identity is created).
--     All non-resolved clauses are semantically unchanged.
--   * HRR-06=A structural dedupe: a partial UNIQUE index over the approved
--     business dedupe identity (firm_id, alert_rule_id, client_id,
--     compliance_instance_id) NULLS NOT DISTINCT, restricted to the
--     non-resolved states (active/acknowledged/snoozed). Resolved rows stay
--     OUTSIDE the uniqueness scope (HRR-09=A — a resolved alert is a
--     terminal historical occurrence; a later recurrence creates a NEW
--     alert row with fresh lifecycle state). Preceded by a fail-closed
--     existing-data preflight (no automatic cleanup).
--   * public.evaluate_alerts() — the sched.alerts.evaluate job function
--     (AUTO-ALR-01…03, AUTO-FLOW-05 pull-based over live state; hardened
--     SECURITY DEFINER, search_path='', owner-only EXECUTE; no
--     caller-supplied firm/actor/resolution_type/correlation identity).
--   * Deadline read model (AUTO-DLN-01, API-R0-DLN, DEADLINE_MODEL=DERIVED):
--     public.deadline_board + public.client_dependency_board as
--     security_invoker views (NO persisted deadline table, NO SECURITY
--     DEFINER for simple user-scoped reads — underlying RLS is the
--     enforcement boundary).
--   * Scheduler registration (AUTO-SCH-04/05/07, HRR-02=A/HRR-03=A):
--     sched.alerts.evaluate at exactly '30 19 * * *' interpreted in GMT
--     (= 01:00 Asia/Kolkata, fixed UTC+05:30), registered inside the
--     existing register_scheduler_jobs() mechanism under the fail-closed
--     cron.timezone='GMT' precondition. sched.login_mirror.run is NOT
--     registered (deferred ownership unchanged).
--
-- Requirement IDs: AUTO-ALR-01…03, AUTO-RET-01/02, AUTO-RPL-01 (replay
--   considerations), AUTO-DLN-01, AUTO-FLOW-05, AUTO-IDM-01, AUTO-AUD-01/02,
--   AUTO-OBS-01, AUTO-SCH-03/04/05/07; HRR-02=A, HRR-03=A, HRR-06=A,
--   HRR-09=A, HRR-11=A, HRR-12=A; SCH-18/19, SCH-34; AUD-ACT-02/05,
--   AUD-INV-06, AUD-VAL-01; API-R0-DLN, API-ARCH-05, TEST-API-20.
-- Test IDs served: TEST-SCH-29 (extension), TEST-AUTO-04/08/13/14/15,
--   TEST-API-20, TEST-AUD-03 (auto-resolution portion).
--
-- Explicitly NOT here (package non-goals — do not read their absence as an
-- oversight):
--   * NO alert-rule seeds, NO default thresholds, NO default-enabled rules
--     (HRR-07=A — the D3 no-seed ruling governs IMP-051; AUTO-OQ-04 remains
--     OPEN). The evaluator is correct with ZERO enabled rules.
--   * NO new alert-rule families and NO statutory activation
--     (practicing-CA/compliance-domain validation remains separately
--     required).
--   * NO registration of sched.login_mirror.run.
--   * NO cron.timezone mutation (AUTO-SCH-07/HRR-03=A).
--   * NO UI wiring (UI_WORK_IN_IMP051=NO; /alerts ModuleGate unchanged).
--   * NO advisory lock (HRR-12=A) and NO historical replay/backfill
--     (HRR-11=A — missed runs recover through safe current-live-state
--     re-fire).
--
-- Implementation interpretations recorded for review (contract-faithful,
-- flagged in the implementation report; IMP-050 (a)…(e) precedent):
--   (f) Recognized rule_keys: exactly ONE rule family is mechanically
--       defined by current approved repository contracts (AUTO-ALR-01
--       "deadline-risk thresholds" over compliance_instances(due_date,
--       state) — DM-22 "rule set: deadline-risk, …"): rule_key
--       'deadline-risk'. Its REQUIRED config is exactly
--       {"days_before_due": N} (N a non-negative integer) — the only
--       threshold-shaped input AUTO-ALR-01 defines. A recognized rule with
--       missing/malformed days_before_due FAILS CLOSED for that rule
--       (rule-level subtransaction rollback, firm/rule error evidence,
--       run ends 'failed'); NO default threshold is ever substituted
--       (HRR-07=A). Any other rule_key is UNKNOWN: skipped with no
--       business effects and no error — future semantics are never
--       inferred (workload/unsigned-engagement-letter families remain
--       without mechanically-defined threshold contracts; AUTO-OQ-04 OPEN).
--   (g) The deadline-risk condition: an instance is at risk when its state
--       is pre-filing (NOT IN filed/acknowledgement_received/closed — the
--       DM-SM-04 states where the obligation is discharged) AND its
--       operative due_date <= the Asia/Kolkata business date + N days
--       (overdue-inclusive). The evaluator writes alerts keyed to the
--       instance; auto-resolution applies only to instance-linked,
--       rule-derived alerts whose own instance no longer satisfies the
--       condition, and only when auto_resolve=true AND
--       requires_explicit_ack=false (AUTO-ALR-03).
--   (h) Deadline board grouping: (firm_id, compliance_type_id, due_date) —
--       "grouped by compliance/day" (07 API-INV-01 inventory); the group id
--       is '<compliance_type_id>::<due_date>'. State buckets map DM-SM-04
--       onto the repository-approved DeadlineGroup shape (src/data/types.ts):
--       not_started->notStarted; information_requested->waiting;
--       information_received/preparation->inProgress;
--       internal_review/client_approval->underReview; ready_to_file->
--       readyToFile; filed/acknowledgement_received/closed->filed.
--       at_risk = pre-filing AND due_date <= the Asia/Kolkata business date
--       (overdue/due-today — a pure derivation, not a configured threshold).
--       days_left is computed against the Asia/Kolkata business date
--       (AUTO-REC-10 semantics); persisted timestamps stay UTC.
--   (i) client_dependency_board rows carry waiting_since = the row's
--       updated_at (the last state-affecting write — the state entered its
--       waiting posture at its last transition) and age_days derived on the
--       Asia/Kolkata business date (DM-X-03 derived ageing, server-side).
--   (j) evaluate_alerts() sets the transaction-local
--       app.alert_transition_command marker for its OWN lifecycle writes:
--       the SCH-18 single-writer guard admits status/lifecycle-stamp
--       movement only under that marker, and the evaluator is an approved
--       lifecycle writer (SCH-18: persisted snooze-expiry normalization and
--       resolution_type='auto' belong to the IMP-051 evaluator). The marker
--       mechanism is unchanged; no browser path gains any capability.
--   (k) The deadline views LEFT JOIN their decorating rows (client/type
--       names): under security_invoker the caller's RLS filters the joined
--       tables too, and an INNER JOIN would hide instances/tasks a
--       senior/article caller can legitimately see under RLS-CIN-01/
--       RLS-TSK-01 (their assigned work) merely because the decorating
--       client/type row is outside their read scope (TEST-API-20: scope
--       identical to the underlying reads). LEFT JOIN keeps the work row
--       visible and degrades only the name decoration to NULL.

-- ---------------------------------------------------------------------------
-- 1. SCH-18 lifecycle CHECK correction (resolved clause only).
--
-- Approved invariant:
--   MANUAL RESOLUTION: status='resolved' AND resolution_type='manual'
--     AND resolved_at IS NOT NULL AND resolved_by IS NOT NULL
--   AUTO RESOLUTION:   status='resolved' AND resolution_type='auto'
--     AND resolved_at IS NOT NULL AND resolved_by IS NULL
-- The resolved clause requires resolution_type IS NOT NULL EXPLICITLY:
-- the separate alerts_resolution_type_check admits NULL (the column is
-- nullable), and PostgreSQL three-valued logic would otherwise let a NULL
-- resolution_type evaluate the clause to UNKNOWN — which a CHECK accepts.
-- The 'manual'/'auto' vocabulary restriction itself stays with
-- alerts_resolution_type_check; resolved rows may retain acknowledgement/
-- snooze history (unchanged). The manual resolve command's writes
-- (resolution_type='manual', resolved_by=auth.uid()) remain behaviorally
-- compatible. The evaluator below is the only approved writer of
-- resolution_type='auto'.
-- ---------------------------------------------------------------------------
alter table public.alerts
  drop constraint alerts_lifecycle_fields_check;

alter table public.alerts
  add constraint alerts_lifecycle_fields_check
  check (
    (status = 'active'
      and acknowledged_by is null and acknowledged_at is null
      and snoozed_until is null
      and resolved_by is null and resolved_at is null
      and resolution_type is null)
    or
    (status = 'acknowledged'
      and acknowledged_by is not null and acknowledged_at is not null
      and snoozed_until is null
      and resolved_by is null and resolved_at is null
      and resolution_type is null)
    or
    (status = 'snoozed'
      and snoozed_until is not null
      and (acknowledged_by is null) = (acknowledged_at is null)
      and resolved_by is null and resolved_at is null
      and resolution_type is null)
    or
    (status = 'resolved'
      and resolved_at is not null
      and resolution_type is not null
      and (
        (resolution_type = 'manual' and resolved_by is not null)
        or (resolution_type = 'auto' and resolved_by is null)
      ))
  );

comment on constraint alerts_lifecycle_fields_check on public.alerts is
  'SCH-18 lifecycle-field consistency backstop (IMP-042), resolved clause corrected by IMP-051: resolution_type is explicitly NOT NULL for resolved rows (a CHECK passes UNKNOWN — the nullable-type vocabulary CHECK alone cannot enforce it); manual resolution requires a human resolved_by; auto resolution requires resolved_by IS NULL (AUD-ACT-05 — system automation never masquerades as an auth.users human actor; no synthetic system identity). Non-resolved clauses unchanged.';

-- ---------------------------------------------------------------------------
-- 2. HRR-06=A dedupe preflight (fail closed, ZERO automatic cleanup).
--
-- GROUP BY treats NULLs as equal — the same grouping semantics the NULLS
-- NOT DISTINCT index will enforce — so this query detects exactly the
-- groups the structural index would reject. On any duplicate group the
-- migration aborts atomically with actionable identities for HUMAN
-- remediation; nothing is deleted or updated here, ever.
-- ---------------------------------------------------------------------------
do $$
declare
  v_dupes text;
begin
  select string_agg(
           format('firm_id=%s alert_rule_id=%s client_id=%s compliance_instance_id=%s rows=%s',
                  d.firm_id,
                  coalesce(d.alert_rule_id::text, '<null>'),
                  coalesce(d.client_id::text, '<null>'),
                  coalesce(d.compliance_instance_id::text, '<null>'),
                  d.n),
           '; ')
    into v_dupes
  from (
    select firm_id, alert_rule_id, client_id, compliance_instance_id, count(*) as n
    from public.alerts
    where status in ('active', 'acknowledged', 'snoozed')
    group by firm_id, alert_rule_id, client_id, compliance_instance_id
    having count(*) > 1
  ) d;

  if v_dupes is not null then
    raise exception 'IMP-051 HRR-06=A preflight FAILED: legacy non-resolved alerts already violate the approved dedupe identity (firm_id, alert_rule_id, client_id, compliance_instance_id). The structural index was NOT created; no automatic cleanup was performed — explicit human remediation is required. Duplicate groups: %',
      v_dupes
      using errcode = 'P0001';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. HRR-06=A structural dedupe (the correctness layer — check-then-insert
-- alone is NOT sufficient). At most one NON-RESOLVED alert per approved
-- business dedupe identity; resolved rows are excluded (HRR-09=A terminal
-- historical occurrences — a later recurrence creates a NEW row).
-- ---------------------------------------------------------------------------
create unique index alerts_nonresolved_dedupe_unique
  on public.alerts (firm_id, alert_rule_id, client_id, compliance_instance_id)
  nulls not distinct
  where status in ('active', 'acknowledged', 'snoozed');

comment on index public.alerts_nonresolved_dedupe_unique is
  'HRR-06=A (AUTO-ALR-02, SCH-18): at most one non-resolved alert (active/acknowledged/snoozed) per approved business dedupe identity (firm_id, alert_rule_id, client_id, compliance_instance_id), NULLS NOT DISTINCT. Resolved rows are outside the uniqueness scope (HRR-09=A — terminal historical occurrences; retrigger creates a NEW occurrence). Structural correctness layer for evaluator creation races (HRR-12=A).';

-- ---------------------------------------------------------------------------
-- 4. public.evaluate_alerts() — sched.alerts.evaluate job function
-- (AUTO-ALR-01…03; AUTO-FLOW-05 pull-based over live state, NOT an outbox
-- consumer).
--
-- Hardening (AUTO-SCH-03, repository scheduler-function convention):
-- SECURITY DEFINER, search_path='', fully qualified references, owner-only
-- EXECUTE (no anon/authenticated/service_role capability — no browser
-- invocation). The parameter list is EMPTY: no caller-supplied firm_id,
-- actor identity, resolution_type, or correlation identity exists.
--
-- Run/tenancy model: each invocation mints its own run correlation identity
-- and records SCH-34 evidence for job 'sched.alerts.evaluate'; the business
-- date is derived EXPLICITLY in Asia/Kolkata; firms are processed under
-- explicit per-firm scoping (the BYPASSRLS cron identity makes RLS evidence
-- of nothing here — tenancy is enforced in function logic; different firms
-- remain isolated; failures are attributable to firm/rule). Separate SCH-34
-- rows for overlapping invocation attempts are allowed; NO advisory lock
-- (HRR-12=A — structural dedupe + status-guarded writes are the
-- correctness layer). Missed runs recover through safe current-live-state
-- re-fire (HRR-11=A — no historical replay/backfill).
--
-- Audit model (approved): explicit public.audit_write(...) with
-- app.audit_skip_trigger='1' for evaluator-owned alert audit effects
-- (Layer-A stays silent — no double logging). The skip flag governs ONLY
-- the generic Layer-A audit path; the alerts_publish_event domain-event
-- trigger is NOT suppressed and owns alert.created / alert.resolved
-- publication (the evaluator never publishes manually). Actor model:
-- actor_type='system', actor_user_id=NULL, service_name='alerts', per-run
-- correlation_id (AUD-ACT-02/05, AUTO-AUD-02). Approved evaluator audit
-- actions: alert.created (winning new occurrence only), alert.resolved
-- (winning system auto-resolution only, resolution_type='auto' in the new
-- snapshot), alert.snooze_expired (persisted snooze-expiry normalization).
-- ---------------------------------------------------------------------------
create or replace function public.evaluate_alerts()
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_run_id uuid;
  v_correlation uuid := gen_random_uuid();
  -- Business date derived EXPLICITLY in Asia/Kolkata (AUTO-REC-10
  -- semantics) — never dependent on the server/session timezone.
  v_business_date date := (now() at time zone 'Asia/Kolkata')::date;
  v_firm_id uuid;
  v_rule public.alert_rules;
  v_threshold int;
  v_inst public.compliance_instances;
  v_old public.alerts;
  v_new public.alerts;
  v_alert_id uuid;
  v_rows int := 0;
  v_errors text[] := '{}';
begin
  -- Automation context (transaction-local, pooled-request safe):
  --   app.service_name/app.correlation_id — publication + audit attribution;
  --   app.audit_skip_trigger — Layer-A stays silent (explicit audit_write is
  --     the ONE audit effect per winning write);
  --   app.alert_transition_command — the SCH-18 single-writer marker
  --     admitting the evaluator's own lifecycle writes (interpretation (j)).
  perform pg_catalog.set_config('app.service_name', 'alerts', true);
  perform pg_catalog.set_config('app.correlation_id', v_correlation::text, true);
  perform pg_catalog.set_config('app.audit_skip_trigger', '1', true);
  perform pg_catalog.set_config('app.alert_transition_command', '1', true);

  insert into public.scheduler_job_runs (job_name, correlation_id, status)
  values ('sched.alerts.evaluate', v_correlation, 'running')
  returning id into v_run_id;

  -- Explicit tenant attribution: firms needing work are those with enabled
  -- rules OR persisted expired snoozes. ZERO enabled rules with no expired
  -- snoozes is a safe no-op run (HRR-07=A) — SCH-34 evidence is still
  -- recorded normally.
  for v_firm_id in
    select f.id
    from public.firms f
    where exists (
            select 1 from public.alert_rules r
            where r.firm_id = f.id and r.enabled)
       or exists (
            select 1 from public.alerts a
            where a.firm_id = f.id
              and a.status = 'snoozed'
              and a.snoozed_until <= now())
    order by f.id
  loop
    begin
      -- -------------------------------------------------------------------
      -- Snooze-expiry normalization (BEFORE rule evaluation; SCH-18):
      -- persisted snoozed rows past snoozed_until normalize to
      -- 'acknowledged' when acknowledged_at IS NOT NULL, else 'active';
      -- snoozed_until is cleared; acknowledged_at is preserved. The update
      -- is status-guarded, so a second run or a concurrent loser updates
      -- zero rows — idempotent, no duplicate audit. The publication
      -- trigger publishes nothing here (it fires only on INSERT and on
      -- status->resolved): no alert.created/alert.resolved is manufactured
      -- for normalization, and NO alert.acknowledged is fabricated for the
      -- system path.
      -- -------------------------------------------------------------------
      for v_old in
        select a.*
        from public.alerts a
        where a.firm_id = v_firm_id
          and a.status = 'snoozed'
          and a.snoozed_until <= now()
        order by a.id
      loop
        update public.alerts
        set status = case
              when v_old.acknowledged_at is not null then 'acknowledged'
              else 'active' end,
            snoozed_until = null
        where id = v_old.id
          and status = 'snoozed' -- status-guarded: concurrent loser no-ops
        returning * into v_new;

        if found then
          v_rows := v_rows + 1;
          perform public.audit_write(
            v_new.firm_id, 'system', null,
            'alert.snooze_expired',
            'alert', v_new.id::text,
            to_jsonb(v_old), to_jsonb(v_new),
            'alerts', null, v_correlation);
        end if;
      end loop;

      -- -------------------------------------------------------------------
      -- Rule evaluation (enabled rules only, deterministic order).
      -- -------------------------------------------------------------------
      for v_rule in
        select r.*
        from public.alert_rules r
        where r.firm_id = v_firm_id
          and r.enabled
        order by r.id
      loop
        begin
          if v_rule.rule_key = 'deadline-risk' then
            -- REQUIRED config (interpretation (f)): days_before_due, a
            -- non-negative integer. Missing/malformed FAILS CLOSED for
            -- this rule — no default threshold is ever substituted
            -- (HRR-07=A); the rule-level subtransaction rolls back ALL of
            -- this rule's partial effects, the error is recorded with
            -- firm/rule attribution, and other rules/firms continue.
            if jsonb_typeof(v_rule.config -> 'days_before_due') = 'number'
               and (v_rule.config ->> 'days_before_due') ~ '^[0-9]+$' then
              v_threshold := (v_rule.config ->> 'days_before_due')::int;
            else
              raise exception 'rule % (firm %, rule_key ''deadline-risk''): missing/malformed required config key days_before_due (non-negative integer; refusing to substitute a default threshold)',
                v_rule.id, v_rule.firm_id
                using errcode = 'P0001';
            end if;

            -- Alert creation (AUTO-ALR-01/02): currently-true approved
            -- condition (interpretation (g)). Structural uniqueness decides
            -- concurrency correctness: an existing non-resolved alert for
            -- the dedupe identity suppresses duplicate creation; a creation
            -- race loser persists nothing, audits nothing, and publishes no
            -- alert.created (the AFTER INSERT publication trigger fires
            -- only for the winning row). A resolved historical occurrence
            -- is OUTSIDE the index scope, so a later true condition inserts
            -- a NEW occurrence with fresh lifecycle state (HRR-09=A).
            for v_inst in
              select i.*
              from public.compliance_instances i
              where i.firm_id = v_firm_id
                and i.state not in ('filed', 'acknowledgement_received', 'closed')
                and i.due_date <= v_business_date + v_threshold
              order by i.id
            loop
              v_alert_id := null;
              insert into public.alerts (
                firm_id, alert_rule_id, severity, title, detail,
                client_id, compliance_instance_id, affected
              ) values (
                v_firm_id, v_rule.id, v_rule.severity, v_rule.name,
                format('deadline-risk: due %s (state %s) within %s-day threshold of business date %s',
                       v_inst.due_date, v_inst.state, v_threshold, v_business_date),
                v_inst.client_id, v_inst.id,
                jsonb_build_object(
                  'instance_id', v_inst.id,
                  'due_date', v_inst.due_date,
                  'state', v_inst.state,
                  'days_before_due', v_threshold)
              )
              on conflict (firm_id, alert_rule_id, client_id, compliance_instance_id)
                where status in ('active', 'acknowledged', 'snoozed')
              do nothing
              returning id into v_alert_id;

              if v_alert_id is not null then
                -- Winning creation only: ONE audit row (the publication
                -- trigger owns alert.created on the outbox path).
                v_rows := v_rows + 1;
                perform public.audit_write(
                  v_firm_id, 'system', null,
                  'alert.created',
                  'alert', v_alert_id::text,
                  null,
                  jsonb_build_object(
                    'alert_id', v_alert_id,
                    'alert_rule_id', v_rule.id,
                    'rule_key', v_rule.rule_key,
                    'severity', v_rule.severity,
                    'client_id', v_inst.client_id,
                    'compliance_instance_id', v_inst.id),
                  'alerts', null, v_correlation);
              end if;
            end loop;

            -- Auto-resolution (AUTO-ALR-03): only when approved rule
            -- semantics permit it — auto_resolve=true AND
            -- requires_explicit_ack=false. Instance-linked, rule-derived
            -- alerts in a non-resolved state whose own instance no longer
            -- satisfies the condition resolve with resolution_type='auto',
            -- resolved_at=now(), resolved_by=NULL (no fabricated human
            -- resolver). The update is status-guarded: a concurrent
            -- auto-resolution loser updates zero rows and emits no
            -- duplicate audit and no duplicate alert.resolved (publication
            -- trigger fires only on the winning status->resolved write).
            if v_rule.auto_resolve and not v_rule.requires_explicit_ack then
              for v_old in
                select a.*
                from public.alerts a
                where a.firm_id = v_firm_id
                  and a.alert_rule_id = v_rule.id
                  and a.compliance_instance_id is not null
                  and a.status in ('active', 'acknowledged', 'snoozed')
                  and not exists (
                    select 1
                    from public.compliance_instances i
                    where i.firm_id = v_firm_id
                      and i.id = a.compliance_instance_id
                      and i.state not in ('filed', 'acknowledgement_received', 'closed')
                      and i.due_date <= v_business_date + v_threshold)
                order by a.id
              loop
                update public.alerts
                set status = 'resolved',
                    resolution_type = 'auto',
                    resolved_at = now(),
                    resolved_by = null
                where id = v_old.id
                  and status in ('active', 'acknowledged', 'snoozed')
                returning * into v_new;

                if found then
                  v_rows := v_rows + 1;
                  perform public.audit_write(
                    v_new.firm_id, 'system', null,
                    'alert.resolved',
                    'alert', v_new.id::text,
                    to_jsonb(v_old), to_jsonb(v_new),
                    'alerts', null, v_correlation);
                end if;
              end loop;
            end if;
          else
            -- UNKNOWN rule_key: skip — no business effects, no error, no
            -- inferred future semantics (interpretation (f)).
            null;
          end if;
        exception when others then
          -- Rule-level isolation: this rule's subtransaction has rolled
          -- back ALL of its partial effects; firm/rule error evidence is
          -- recorded and evaluation continues for other rules in this firm.
          v_errors := v_errors || format(
            'firm %s rule %s (%s): %s',
            v_firm_id, v_rule.id, v_rule.rule_key, SQLERRM);
        end;
      end loop;
    exception when others then
      -- Firm-level isolation (snooze normalization etc.): observable
      -- per-firm failure; other firms still run (AUTO-PRIN-04).
      v_errors := v_errors || format('firm %s: %s', v_firm_id, SQLERRM);
    end;
  end loop;

  update public.scheduler_job_runs
  set status = case
        when coalesce(array_length(v_errors, 1), 0) > 0 then 'failed'
        else 'succeeded' end,
      finished_at = now(),
      rows_affected = v_rows,
      error = case
        when coalesce(array_length(v_errors, 1), 0) > 0
          then array_to_string(v_errors, '; ') end
  where id = v_run_id;
end;
$$;

comment on function public.evaluate_alerts() is
  'IMP-051 scheduler entry for sched.alerts.evaluate (AUTO-ALR-01…03, HRR-06/09/11/12=A): pull-based over live state (AUTO-FLOW-05); persisted snooze-expiry normalization (status-guarded, audited alert.snooze_expired); structural-dedupe alert creation for the recognized deadline-risk family (interpretation (f) — missing/malformed days_before_due fails the rule closed, unknown rule_keys skip silently, zero enabled rules is a safe no-op); gated system auto-resolution (auto_resolve=true AND requires_explicit_ack=false; resolution_type=auto, resolved_by NULL); explicit per-firm tenancy (AUTO-SCH-03); one SCH-34 run row + one correlation id per run (AUTO-OBS-01/AUTO-AUD-02); system/alerts audit actor via explicit audit_write with app.audit_skip_trigger (no double logging; publication trigger owns domain events). Owner-only EXECUTE — no anon/authenticated/service_role capability (AUTO-SCH-03c).';

revoke all on function public.evaluate_alerts() from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Deadline read model (AUTO-DLN-01, API-R0-DLN, API-ARCH-05) —
-- DEADLINE_MODEL=DERIVED: NO persisted deadline table. Two
-- security_invoker views; underlying RLS is the enforcement boundary (NO
-- SECURITY DEFINER for simple user-scoped reads). Browser posture: SELECT
-- to authenticated only — never anon, never public, no explicit
-- service_role grant.
-- ---------------------------------------------------------------------------

-- 5a. DEADLINE BOARD — compliance_instances ONLY (no task rows in the core
-- deadline grouping). Server-side derived aggregation; group =
-- (compliance_type_id, due_date) ("grouped by compliance/day", 07
-- inventory). Operative due_date is used — never the immutable
-- calculated_due_date provenance (SCH-12). Day arithmetic is Asia/Kolkata
-- business-date based (interpretation (h)). A firm/scope with no visible
-- instances yields an empty collection — never fabricated rows.
create or replace view public.deadline_board
with (security_invoker = true)
as
select
  i.compliance_type_id::text || '::' || i.due_date::text as group_id,
  i.firm_id,
  i.compliance_type_id,
  ct.name as compliance_name,
  i.due_date,
  (i.due_date - (now() at time zone 'Asia/Kolkata')::date) as days_left,
  count(*)::int as total_clients,
  count(*) filter (where i.state in ('filed', 'acknowledgement_received', 'closed'))::int as filed,
  count(*) filter (where i.state = 'ready_to_file')::int as ready_to_file,
  count(*) filter (where i.state in ('information_received', 'preparation'))::int as in_progress,
  count(*) filter (where i.state = 'information_requested')::int as waiting,
  count(*) filter (where i.state in ('internal_review', 'client_approval'))::int as under_review,
  count(*) filter (where i.state = 'not_started')::int as not_started,
  count(*) filter (where i.state not in ('filed', 'acknowledgement_received', 'closed')
                   and i.due_date <= (now() at time zone 'Asia/Kolkata')::date)::int as at_risk
from public.compliance_instances i
left join public.compliance_types ct
  on ct.id = i.compliance_type_id
group by i.firm_id, i.compliance_type_id, ct.name, i.due_date;

comment on view public.deadline_board is
  'IMP-051 API-R0-DLN deadline board (AUTO-DLN-01, DEADLINE_MODEL=DERIVED): server-derived aggregation over compliance_instances ONLY — no task rows; group = (compliance_type_id, due_date) per the 07 "grouped by compliance/day" inventory; operative due_date (never calculated_due_date provenance); DM-SM-04 -> DeadlineGroup bucket mapping + at_risk = pre-filing AND due on/before the Asia/Kolkata business date (interpretation (h)). security_invoker — the caller''s underlying RLS (RLS-CIN-01) is the row filter, so scope is identical to the underlying instance reads (manager portfolio; senior/article assigned-only); the LEFT JOIN keeps board groups visible when the caller cannot read the decorating type row (compliance_name degrades to NULL, never a hidden instance). SELECT to authenticated only.';

-- 5b. CLIENT-DEPENDENCY BOARD — separate API-R0-DLN projection. Sources:
-- compliance_instances in information_requested state, and waiting tasks
-- (DM-SM-05 status='waiting' — dependency-relevant). Tasks belong ONLY
-- here, never in the deadline board aggregation. Ageing is server-derived
-- (DM-X-03; interpretation (i)); tenant isolation comes from the
-- underlying tables' RLS.
create or replace view public.client_dependency_board
with (security_invoker = true)
as
select
  'instance'::text as kind,
  i.id,
  i.firm_id,
  i.client_id,
  c.name as client_name,
  ct.name as label,
  i.period_label,
  null::text as waiting_reason,
  i.state as status,
  i.updated_at as waiting_since,
  ((now() at time zone 'Asia/Kolkata')::date
    - (i.updated_at at time zone 'Asia/Kolkata')::date)::int as age_days,
  i.due_date,
  i.assignee_membership_id,
  i.reviewer_membership_id
from public.compliance_instances i
left join public.clients c
  on c.firm_id = i.firm_id and c.id = i.client_id
left join public.compliance_types ct
  on ct.id = i.compliance_type_id
where i.state = 'information_requested'
union all
select
  'task'::text as kind,
  t.id,
  t.firm_id,
  t.client_id,
  c.name as client_name,
  t.title as label,
  null::text as period_label,
  t.waiting_reason,
  t.status,
  t.updated_at as waiting_since,
  ((now() at time zone 'Asia/Kolkata')::date
    - (t.updated_at at time zone 'Asia/Kolkata')::date)::int as age_days,
  t.due_date,
  t.assignee_membership_id,
  t.reviewer_membership_id
from public.tasks t
left join public.clients c
  on c.firm_id = t.firm_id and c.id = t.client_id
where t.status = 'waiting';

comment on view public.client_dependency_board is
  'IMP-051 API-R0-DLN client-dependency board: compliance_instances in information_requested state + waiting tasks (DM-SM-05 status=''waiting'') — tasks appear ONLY in this projection, never in the deadline board. Server-derived ageing (DM-X-03; waiting_since = last state-affecting write, age_days on the Asia/Kolkata business date, interpretation (i)). security_invoker — underlying RLS is the row filter, so scope is identical to the underlying instance/task reads; the LEFT JOINs keep rows visible when the caller cannot read the decorating client/type rows (names degrade to NULL, never hidden work). SELECT to authenticated only. Truthful empty result = empty collection.';

revoke all on public.deadline_board from anon, authenticated, service_role;
revoke all on public.client_dependency_board from anon, authenticated, service_role;
grant select on public.deadline_board to authenticated;
grant select on public.client_dependency_board to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Scheduler registration extension (AUTO-SCH-04/05/07; HRR-02=A/HRR-03=A)
--
-- The existing named/idempotent registration mechanism is extended with the
-- IMP-051-owned job: sched.alerts.evaluate at exactly '30 19 * * *'
-- interpreted in GMT = once daily 01:00 Asia/Kolkata (fixed UTC+05:30).
-- The AUTO-SCH-07 fail-closed precondition is preserved verbatim and now
-- guards all three registrations: if cron.timezone is not GMT the function
-- RAISES and NOTHING is registered — CAOS never mutates cron.timezone.
-- sched.login_mirror.run remains UNREGISTERED (deferred ownership).
-- ---------------------------------------------------------------------------
create or replace function public.register_scheduler_jobs()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if pg_catalog.current_setting('cron.timezone', true) is distinct from 'GMT' then
    raise exception 'AUTO-SCH-07 fail-closed: cron.timezone must be GMT to register the CAOS scheduler jobs under their GMT-interpreted cadences (sched.recurrence.evaluate 0 19 * * * = 00:30 Asia/Kolkata; sched.alerts.evaluate 30 19 * * * = 01:00 Asia/Kolkata); effective value is %. Nothing registered; cron.timezone is never mutated by CAOS — explicit human review required.',
      coalesce(pg_catalog.current_setting('cron.timezone', true), '<unset>')
      using errcode = 'P0001';
  end if;

  -- Stable named upsert semantics (AUTO-SCH-02 probe evidence): re-running
  -- updates the schedule in place — idempotent/re-runnable (AUTO-SCH-05).
  perform cron.schedule(
    'sched.recurrence.evaluate', '0 19 * * *',
    $cmd$select public.evaluate_recurrence()$cmd$);
  perform cron.schedule(
    'outbox.drain', '* * * * *',
    $cmd$select public.drain_event_outbox()$cmd$);
  -- IMP-051 (HRR-02=A): once daily 01:00 Asia/Kolkata under the GMT cron
  -- convention. Same fail-closed precondition as above (HRR-03=A).
  perform cron.schedule(
    'sched.alerts.evaluate', '30 19 * * *',
    $cmd$select public.evaluate_alerts()$cmd$);

  return jsonb_build_object(
    'status', 'registered',
    'cron_timezone', pg_catalog.current_setting('cron.timezone', true),
    'jobs', jsonb_build_array(
      'sched.recurrence.evaluate', 'outbox.drain', 'sched.alerts.evaluate'));
end;
$$;

comment on function public.register_scheduler_jobs() is
  'IMP-050 cron registration (AUTO-SCH-04/05/07), extended by IMP-051 (HRR-02=A/HRR-03=A): sched.recurrence.evaluate (0 19 * * * GMT) + the outbox.drain infrastructure job (* * * * *) + sched.alerts.evaluate (30 19 * * * GMT = 01:00 Asia/Kolkata). GMT fail-closed precondition for ALL registrations; named idempotent upsert; cron.timezone is never mutated; sched.login_mirror.run is NOT registered (deferred ownership). Owner-only EXECUTE.';

revoke all on function public.register_scheduler_jobs() from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Cron registration at migration time (AUTO-SCH-06 version-controlled
-- migration pattern — the same invocation the IMP-050 migration used).
-- Hosted staging execution of THIS migration remains a separate explicit
-- human state-change gate.
-- ---------------------------------------------------------------------------
select public.register_scheduler_jobs();

-- ---------------------------------------------------------------------------
-- Notes for reviewers
-- ---------------------------------------------------------------------------
-- * The lifecycle CHECK correction touches ONLY the resolved clause; every
--   non-resolved clause is byte-identical to IMP-042. The manual resolve
--   command (resolution_type='manual', resolved_by=auth.uid()) satisfies
--   the corrected CHECK unchanged.
-- * The dedupe preflight performs ZERO remediation: on legacy duplicates
--   the migration aborts atomically before the index exists; current
--   accepted staging holds zero alert rows, so the preflight is expected
--   to pass silently.
-- * ON CONFLICT inference over the partial NULLS NOT DISTINCT index follows
--   the repository-proven cin_obligation_period_unique precedent (NULLS
--   NOT DISTINCT + ON CONFLICT); the arbiter predicate repeats the index
--   predicate exactly, as PostgreSQL partial-index inference requires.
-- * The evaluator's only alert lifecycle writes are: snooze-expiry
--   normalization (status-guarded), winning alert creation (INSERT), and
--   gated system auto-resolution (status-guarded). It never reopens
--   resolved rows, never writes resolution_type='manual', never fabricates
--   a human actor, never publishes domain events manually, and never
--   double-audits (Layer-A skipped; one explicit audit_write per winning
--   effect).
-- * Requires_explicit_ack=true rules never auto-resolve (AUTO-ALR-03);
--   their alerts stay human-resolvable only.
-- * The deadline views are NOT base tables: catalog invariants counting
--   BASE TABLE relations, RLS-enabled/forced tables (relkind 'r'), and
--   pg_policies are mechanically unaffected; only the authenticated
--   table-level/column-level grant inventories gain the two view SELECT
--   grants (rls-catalog expectations updated in the same package).
-- * No alert-rule seeds, no thresholds, no default-enabled rules, no
--   statutory activation, no UI, no sched.login_mirror.run.
