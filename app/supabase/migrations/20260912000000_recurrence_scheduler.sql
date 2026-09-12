-- IMP-050 — Recurrence generation & scheduler signals
--
-- Implements exactly the automation scope owned by this package:
--   * SCH-12 amendment: composite same-firm successor self-FK
--     (firm_id, successor_instance_id) -> compliance_instances(firm_id, id)
--     (Ruling 2026-09-12 R7 / AUTO-SCH-03 clarification; supersedes the
--     plain self-FK shipped at IMP-031; nullable successor semantics and
--     the obligation-period uniqueness contract preserved).
--   * SCH-33 event_outbox (transactional outbox / publication record),
--     SCH-34 scheduler_job_runs, SCH-35 scheduler_dead_letters.
--   * Recurrence generator (AUTO-REC-01…10): profile activation and
--     instance closure materialize immediately; sched.recurrence.evaluate
--     performs daily catch-up / look-ahead maintenance on an Asia/Kolkata
--     business date; persisted timestamps stay UTC.
--   * Outbox drain with bounded retry / dead-letter (AUTO-RET-01) and the
--     hardened dead-letter-only recovery command requeue_dead_letter
--     (AUTO-RPL-01/02).
--   * pg_cron registrations (AUTO-SCH-04/05/07): exactly
--     sched.recurrence.evaluate (0 19 * * * GMT = 00:30 Asia/Kolkata,
--     fail-closed cron.timezone='GMT' precondition) and ONE infrastructure
--     outbox-drain job (every minute, timezone-independent, not a sched.*
--     signal).
--
-- Requirement IDs: AUTO-PRIN-01…05, AUTO-ENV-01/02, AUTO-EVT-01/02,
--   AUTO-FLOW-01…05, AUTO-IDM-01, AUTO-RET-01/02, AUTO-REC-01…10,
--   AUTO-RPL-01/02, AUTO-AUD-01/02, AUTO-OBS-01, AUTO-SCH-01…07;
--   SCH-01 (settings carrier), SCH-12 (provenance + successor FK),
--   SCH-33/34/35; RLS-EVO-01 / RLS-SJR-01 / RLS-SDL-01; AUD-ACT-02/03/05,
--   AUD-INV-06, RLS-SVC-01/02.
-- Test IDs served: TEST-AUTO-01…12, TEST-RLS-EVO-01 / SJR-01 / SDL-01,
--   TEST-OPS-07 (local mechanism portion).
--
-- Explicitly NOT here (package non-goals):
--   * NO registration of sched.alerts.evaluate (IMP-051) or
--     sched.login_mirror.run (existing deferred ownership) — AUTO-SCH-04.
--   * NO alert evaluation / dedupe / auto-resolution (IMP-051).
--   * NO reminder sending (Release 1), no HTTP/pg_net consumers (R1+).
--   * NO statutory rule activation (DM-OQ-01 gate unchanged).
--   * NO production registered outbox consumers — the R0 consumer set is
--     empty (AUTO-FLOW-05); `delivered` is a drain-completion record,
--     never an external/HTTP delivery claim.
--   * NO cron.timezone mutation — no ALTER SYSTEM / postgresql.conf /
--     restart path (AUTO-SCH-07); this migration NEVER changes the global
--     pg_cron timezone.
--   * No frontend behavioral changes; comment-only contract alignment
--     exists in src/data/complianceInstances for IMP-050 activation/closure
--     materialization. There is no browser surface for these records (zero
--     browser grants).
--
-- Trust model (AUTO-SCH-03, binding): the pg_cron execution identity was
-- observed as postgres with rolbypassrls=true — FORCE RLS does not
-- constrain the scheduler path. Scheduler functions therefore enforce
-- firm boundaries EXPLICITLY (per-firm iteration; firm-scoped writes;
-- composite same-firm FKs as structural backstop) and never rely on RLS.
-- anon/authenticated receive NO capability: zero table grants and no
-- EXECUTE on any scheduler/outbox/job function. Automation writes carry
-- actor_type='system'/'service' + service_name + per-run correlation_id
-- (AUD-ACT-02/03, RLS-SVC-02, AUTO-AUD-02) — never a human actor
-- (AUD-ACT-05).
--
-- Implementation interpretations recorded for review (contract-faithful,
-- flagged in the implementation report):
--   (a) due_rule machine-readable grammar: seeded rule versions carry
--       descriptive-only due_rule jsonb and are all draft (never active);
--       the generator interprets an optional machine-readable form
--       documented on recurrence_due_date() below. A present ACTIVE rule
--       version whose due_rule is not parseable is a configuration error
--       — generation for that profile fails observably; it never falls
--       back silently (AUTO-REC-02 validation philosophy).
--   (b) Period calendar basis: monthly = calendar month; quarterly =
--       Indian fiscal quarter (Q1 = Apr–Jun); annual = Indian fiscal year
--       (Apr 1 – Mar 31) — consistent with all repository fixture/PRD
--       evidence (QUARTERLY_PERIODS Q1 FY26, advance-tax 15 Jun/Sep/Dec/
--       Mar, FY 2024-25 labels). 'event'/'custom' frequencies have no
--       period schedule and generate nothing.
--   (c) SCH-33 carries one additive retry-metadata column
--       (first_failed_at) so SCH-35.first_failed_at (NOT NULL per
--       contract) can be populated truthfully at dead-letter time;
--       envelope/lifecycle semantics are exactly as contracted.
--   (d) Consumer registration: the drain dispatches to a consumer
--       function named public.outbox_consumer_<event_type_with_underscores>(uuid)
--       when — and only when — such a function exists. R0 production
--       registers none (empty set, AUTO-FLOW-05). TEST-AUTO-05/06 use
--       this as the sanctioned harness-only test-only registration point
--       and tear it down completely (zero residue).
--   (e) Deferred event publication wiring (spec 09 partition notes):
--       compliance_instance.created (IMP-031), task.created /
--       task.assigned / task.completed (IMP-040), review.submitted /
--       review.completed (IMP-041), alert.created / alert.resolved
--       (IMP-042) are published transactionally by AFTER row triggers
--       (an approved producer path, SCH-33 invariants) — the Layer-B
--       commands of prior packages are NOT modified for publication;
--       triggers are additive only.

-- ---------------------------------------------------------------------------
-- pg_cron (AUTO-SCH-06): the version-controlled IMP-050 migration MAY carry
-- CREATE EXTENSION IF NOT EXISTS pg_cron for a deterministic local
-- reset/build. Applying this migration to hosted staging is a separate
-- explicit HUMAN state-change gate (Ruling R6): the hosted pg_cron state
-- change enters ONLY through this migration ledger — no Dashboard-only or
-- manual out-of-chain enablement.
-- ---------------------------------------------------------------------------
create extension if not exists pg_cron;

-- ---------------------------------------------------------------------------
-- SCH-12 amendment (Ruling R7): successor linkage is structurally same-firm
-- via the composite self-FK. The (firm_id, id) parent key already exists
-- (cin_firm_id_unique, IMP-031); nullable successor semantics preserved.
-- ---------------------------------------------------------------------------
alter table public.compliance_instances
  drop constraint cin_successor_fkey;

alter table public.compliance_instances
  add constraint cin_successor_firm_fkey
  foreign key (firm_id, successor_instance_id)
  references public.compliance_instances (firm_id, id)
  on delete restrict;

comment on column public.compliance_instances.successor_instance_id is
  'Next-period recurrence successor (PRD §29, AUTO-REC-01b). Composite same-firm self-FK (firm_id, successor_instance_id) -> compliance_instances(firm_id, id) — Ruling 2026-09-12 R7; written only by the IMP-050 generator/transition command (grant-layer closed to browsers); cycle/period-order semantics enforced by generator logic, never by RLS.';

-- Refresh the two IMP-031 table comments whose "materialization is
-- IMP-050" wording described the pre-IMP-050 interim (the committed
-- migration files stay immutable; live catalog comments are updated
-- here).
comment on table public.client_compliance_profiles is
  'SCH-11: applicability records (DM-11). proposed -> active via the controlled approval command only (RLS-CCP-01); approval stamps approved_by/approved_at AND — since IMP-050 (AUTO-REC-01a) — materializes the current period immediately when a governing ACTIVE rule version exists (zero instances remains valid otherwise, C5). Registration scope per DM-27 enforced at the write path; the TDS PAN substitution is the only permitted class substitution.';

comment on table public.compliance_instances is
  'SCH-12: obligation per legal entity per period (DM-12, DM-SM-04 pipeline). client_id trigger-derived (never user-writable, SCH-A-02); state changes ONLY via transition_compliance_instance() (RLS-CIN-01); identity/period/provenance insert-only (AUTO-REC-07); four-eyes per type (RLS-4EY-*). Successor spawning on closure is IMP-050 (AUTO-REC-01b), linked via the composite same-firm self-FK (Ruling R7).';

-- ---------------------------------------------------------------------------
-- SCH-33 — event_outbox (transactional outbox / publication record)
-- AUTO-FLOW-03: written in the SAME transaction as the domain mutation;
-- drained asynchronously with bounded retry and dead-lettering.
-- Zero browser grants (RLS-EVO-01); RLS enabled AND forced.
-- ---------------------------------------------------------------------------
create table public.event_outbox (
  id uuid primary key default gen_random_uuid(),
  -- Publication/event-record identity. NOT the consumer idempotency
  -- identity — consumer idempotency is the domain effect key
  -- (AUTO-IDM-01); a manual requeue is a NEW row with a NEW event_id for
  -- the SAME domain fact (AUTO-RPL-01).
  event_id uuid not null,
  -- Exactly one of the 14 catalogue events (AUTO-EVT-01, spec 09).
  event_type text not null,
  -- NULL only per the reserved platform marker (AUD-EVT-03, AUTO-ENV-01).
  -- Deliberately non-FK (SCH-FK-03 automation-records exception): a
  -- publication record must survive and never block domain-row lifecycle.
  -- In the BYPASSRLS scheduler context there is no RLS/FK backstop for
  -- firm attribution — the producing function's logic is normative
  -- (AUTO-SCH-03; TEST-AUTO-08 verifies directly).
  firm_id uuid,
  occurred_at timestamptz not null default now(),
  actor_type text not null,
  actor_user_id uuid,
  service_name text,
  correlation_id uuid not null,
  -- Minimal envelope (AUTO-ENV-01): ids and the specific facts that
  -- changed — never full row dumps.
  payload jsonb not null,
  -- NULL on original publications; on a manual-requeue publication, the
  -- soft reference to the ORIGINAL publication's event_id (AUTO-RPL-01).
  requeue_of uuid,
  status text not null default 'pending',
  attempt_count int not null default 0,
  next_attempt_at timestamptz,
  last_error text,
  -- Retry metadata (AUTO-RET-01): first failure instant, carried here so
  -- the SCH-35 dead-letter record's NOT NULL first_failed_at is populated
  -- truthfully at exhaustion (implementation interpretation (c) above).
  first_failed_at timestamptz,
  created_at timestamptz not null default now(),
  -- Set on terminal delivered/dead_lettered.
  processed_at timestamptz,
  constraint event_outbox_event_id_unique unique (event_id),
  constraint event_outbox_event_type_check check (event_type in (
    'client.created', 'client.updated', 'engagement.created',
    'compliance_instance.created', 'compliance_instance.status_changed',
    'compliance_instance.due_date_changed',
    'task.created', 'task.assigned', 'task.completed',
    'review.submitted', 'review.completed',
    'alert.created', 'alert.resolved', 'membership.changed')),
  constraint event_outbox_actor_type_check
    check (actor_type in ('human', 'system', 'service', 'support')),
  constraint event_outbox_status_check
    check (status in ('pending', 'delivered', 'failed', 'dead_lettered'))
);

comment on table public.event_outbox is
  'SCH-33: transactional outbox / publication record (AUTO-FLOW-03, AUTO-OQ-02). One row per publication; event_id is publication identity, NOT the consumer idempotency identity (effect keys, AUTO-IDM-01). delivered = all actually-registered R0 consumers completed (in R0: none — drain-completion record, never an external/HTTP delivery claim, AUTO-FLOW-05). RLS enabled+forced, zero browser grants (RLS-EVO-01). Retention deferred (SCH-OQ-07; purge only via AUD-RET-02).';

-- Drain query; firm/correlation/requeue lineage indexes per SCH-33.
create index event_outbox_drain_idx
  on public.event_outbox (status, next_attempt_at);
create index event_outbox_firm_created_idx
  on public.event_outbox (firm_id, created_at);
create index event_outbox_correlation_idx
  on public.event_outbox (correlation_id);
create index event_outbox_requeue_of_idx
  on public.event_outbox (requeue_of);

-- Envelope immutability (SCH-33 invariants): no UPDATE of envelope fields
-- after insert — only delivery-lifecycle metadata moves. INVOKER is
-- sufficient (compares OLD/NEW only; crv_guard_update precedent).
create or replace function public.evo_guard_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
     or new.event_id is distinct from old.event_id
     or new.event_type is distinct from old.event_type
     or new.firm_id is distinct from old.firm_id
     or new.occurred_at is distinct from old.occurred_at
     or new.actor_type is distinct from old.actor_type
     or new.actor_user_id is distinct from old.actor_user_id
     or new.service_name is distinct from old.service_name
     or new.correlation_id is distinct from old.correlation_id
     or new.payload is distinct from old.payload
     or new.requeue_of is distinct from old.requeue_of
     or new.created_at is distinct from old.created_at then
    raise exception 'event_outbox envelope fields are insert-only (SCH-33, AUTO-ENV-01)'
      using errcode = '23514',
            detail = 'IMMUTABLE_FIELD:event_outbox.envelope';
  end if;
  -- Lifecycle transitions (SCH-33): pending -> delivered | failed;
  -- failed -> pending (retry reschedule) | dead_lettered (exhausted).
  if new.status is distinct from old.status
     and not (old.status = 'pending' and new.status in ('delivered', 'failed'))
     and not (old.status = 'failed' and new.status in ('pending', 'dead_lettered')) then
    raise exception 'invalid event_outbox status transition % -> % (SCH-33)', old.status, new.status
      using errcode = '23514',
            detail = 'INVALID_TRANSITION:event_outbox.status';
  end if;
  return new;
end;
$$;

comment on function public.evo_guard_update() is
  'IMP-050 SCH-33 write guard: envelope immutability + delivery-lifecycle transition vocabulary. Owner/definer-context writes only (grant closure).';

revoke all on function public.evo_guard_update() from public, anon, authenticated, service_role;

create trigger event_outbox_guard_update
  before update on public.event_outbox
  for each row execute function public.evo_guard_update();

alter table public.event_outbox enable row level security;
alter table public.event_outbox force row level security;

-- RLS-EVO-01: ZERO browser grants — no SELECT/INSERT/UPDATE/DELETE for
-- anon/authenticated, and none for service_role either (server/scheduler
-- writes run as the definer owner; audit_log grant-closure precedent).
-- RLS enabled+forced with zero policies: default-deny for any
-- RLS-constrained role. The BYPASSRLS scheduler context is unaffected by
-- RLS (AUTO-SCH-03) — tenancy is enforced in function logic.
revoke all on public.event_outbox from anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- SCH-34 — scheduler_job_runs (job-run record; AUTO-OBS-01 fail-visible)
-- System-scoped, NOT tenant-owned: no firm_id. RLS enabled, NOT forced
-- (Ruling R8); zero browser grants (RLS-SJR-01).
-- ---------------------------------------------------------------------------
create table public.scheduler_job_runs (
  id uuid primary key default gen_random_uuid(),
  -- sched.<job>.<action> identity for scheduler-signal jobs
  -- (AUTO-PRIN-02); the infrastructure outbox-drain records runs under
  -- its own non-sched.* name (AUTO-SCH-04).
  job_name text not null,
  correlation_id uuid not null,
  status text not null default 'running',
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  rows_affected int,
  error text,
  created_at timestamptz not null default now(),
  constraint scheduler_job_runs_status_check
    check (status in ('running', 'succeeded', 'failed'))
);

comment on table public.scheduler_job_runs is
  'SCH-34: scheduler job-run record (AUTO-OBS-01, AUTO-PRIN-04). One row per run attempt; system-scoped (no firm_id — effect firm attribution lives on written rows via correlation_id). Operational source for last-success health (OPS-HLT-01) and failure monitoring (OPS-MON-01). RLS enabled (not forced — system-scoped), zero browser grants (RLS-SJR-01). Never hard-deleted in R0 (SCH-OQ-07).';

create index scheduler_job_runs_job_started_idx
  on public.scheduler_job_runs (job_name, started_at);
create index scheduler_job_runs_status_started_idx
  on public.scheduler_job_runs (status, started_at);
create index scheduler_job_runs_correlation_idx
  on public.scheduler_job_runs (correlation_id);

-- Run-record integrity (SCH-34 invariants): exactly one row per run
-- attempt; finished_at and terminal status are set together; identity
-- fields are insert-only.
create or replace function public.sjr_guard_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
     or new.job_name is distinct from old.job_name
     or new.correlation_id is distinct from old.correlation_id
     or new.started_at is distinct from old.started_at
     or new.created_at is distinct from old.created_at then
    raise exception 'scheduler_job_runs identity fields are insert-only (SCH-34)'
      using errcode = '23514',
            detail = 'IMMUTABLE_FIELD:scheduler_job_runs.identity';
  end if;
  if new.status is distinct from old.status
     and not (old.status = 'running' and new.status in ('succeeded', 'failed')) then
    raise exception 'invalid scheduler_job_runs status transition % -> % (SCH-34)', old.status, new.status
      using errcode = '23514',
            detail = 'INVALID_TRANSITION:scheduler_job_runs.status';
  end if;
  if new.status in ('succeeded', 'failed')
     and new.finished_at is null then
    raise exception 'finished_at and terminal status are set together (SCH-34)'
      using errcode = '23514',
            detail = 'INVALID_TRANSITION:scheduler_job_runs.terminal';
  end if;
  return new;
end;
$$;

comment on function public.sjr_guard_update() is
  'IMP-050 SCH-34 write guard: insert-only identity; running -> succeeded|failed only; terminal status requires finished_at.';

revoke all on function public.sjr_guard_update() from public, anon, authenticated, service_role;

create trigger scheduler_job_runs_guard_update
  before update on public.scheduler_job_runs
  for each row execute function public.sjr_guard_update();

alter table public.scheduler_job_runs enable row level security;
-- NOT forced (Ruling R8: system-scoped, not tenant-owned).
revoke all on public.scheduler_job_runs from anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- SCH-35 — scheduler_dead_letters (retry/dead-letter record; AUTO-RET-01)
-- Firm-scoped where the failed work carries a firm. RLS enabled AND
-- forced; zero browser grants (RLS-SDL-01).
-- ---------------------------------------------------------------------------
create table public.scheduler_dead_letters (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  -- Soft reference (SCH-FK-03 exception): the outbox publication's
  -- event_id for source='outbox_event'.
  source_id text not null,
  firm_id uuid,
  correlation_id uuid,
  -- The failed work item, minimal per AUTO-ENV-01.
  payload jsonb not null,
  failure_reason text not null,
  attempt_count int not null,
  first_failed_at timestamptz not null,
  last_failed_at timestamptz not null,
  status text not null default 'open',
  created_at timestamptz not null default now(),
  constraint scheduler_dead_letters_source_check
    check (source in ('outbox_event', 'job_step')),
  constraint scheduler_dead_letters_status_check
    check (status in ('open', 'requeued'))
);

comment on table public.scheduler_dead_letters is
  'SCH-35: retry/dead-letter record (AUTO-RET-01, AUTO-PRIN-04) — exhausted bounded retries land here; surfaced in operations monitoring (OPS-MON-02). Append-only except the single open -> requeued transition performed only by requeue_dead_letter (AUTO-RPL-01/02). RLS enabled+forced, zero browser grants (RLS-SDL-01). Never hard-deleted in R0 (SCH-OQ-07).';

create index scheduler_dead_letters_status_created_idx
  on public.scheduler_dead_letters (status, created_at);
create index scheduler_dead_letters_firm_created_idx
  on public.scheduler_dead_letters (firm_id, created_at);
create index scheduler_dead_letters_correlation_idx
  on public.scheduler_dead_letters (correlation_id);

-- Append-only except the single open -> requeued transition, and only
-- under the transaction-local marker set by requeue_dead_letter
-- (single-writer convention; grant closure already confines writes to
-- owner/definer contexts — this guard makes the lifecycle explicit).
create or replace function public.sdl_guard_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if TG_OP = 'DELETE' then
    raise exception 'scheduler_dead_letters rows are never hard-deleted in R0 (SCH-35, SCH-OQ-07)'
      using errcode = '23514',
            detail = 'IMMUTABLE_FIELD:scheduler_dead_letters.delete';
  end if;
  if TG_OP = 'UPDATE' then
    if coalesce(current_setting('app.dead_letter_recovery', true), '') <> '1' then
      raise exception 'scheduler_dead_letters updates only through requeue_dead_letter (AUTO-RPL-02)'
        using errcode = '23514',
              detail = 'IMMUTABLE_FIELD:scheduler_dead_letters.lifecycle';
    end if;
    if new.id is distinct from old.id
       or new.source is distinct from old.source
       or new.source_id is distinct from old.source_id
       or new.firm_id is distinct from old.firm_id
       or new.correlation_id is distinct from old.correlation_id
       or new.payload is distinct from old.payload
       or new.failure_reason is distinct from old.failure_reason
       or new.attempt_count is distinct from old.attempt_count
       or new.first_failed_at is distinct from old.first_failed_at
       or new.last_failed_at is distinct from old.last_failed_at
       or new.created_at is distinct from old.created_at then
      raise exception 'scheduler_dead_letters failure metadata is append-only (SCH-35)'
        using errcode = '23514',
              detail = 'IMMUTABLE_FIELD:scheduler_dead_letters.metadata';
    end if;
    if not (old.status = 'open' and new.status = 'requeued') then
      raise exception 'scheduler_dead_letters status moves only open -> requeued (SCH-35)'
        using errcode = '23514',
              detail = 'INVALID_TRANSITION:scheduler_dead_letters.status';
    end if;
  end if;
  return coalesce(new, old);
end;
$$;

comment on function public.sdl_guard_write() is
  'IMP-050 SCH-35 write guard: append-only; the single open -> requeued transition requires the app.dead_letter_recovery marker set by requeue_dead_letter (AUTO-RPL-02 single-writer).';

revoke all on function public.sdl_guard_write() from public, anon, authenticated, service_role;

create trigger scheduler_dead_letters_guard_write
  before update or delete on public.scheduler_dead_letters
  for each row execute function public.sdl_guard_write();

alter table public.scheduler_dead_letters enable row level security;
alter table public.scheduler_dead_letters force row level security;
revoke all on public.scheduler_dead_letters from anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Transactional event publication (AUTO-FLOW-03; spec 09 partition notes)
--
-- publish_domain_event is the internal owner-only writer. Actor/correlation
-- derivation is server-side only (never caller-controlled):
--   app.service_name set (generator/scheduler transaction) -> 'system' +
--   that service_name (AUTO-REC-06);
--   auth.uid() present  -> human / that user;
--   jwt role service_role -> service / 'service-role' (AUD-SVC-01);
--   otherwise           -> system / 'database-operator'.
-- correlation_id: app.correlation_id (scheduler run) -> x-correlation-id
-- request header (untrusted metadata, AUD-CTX-02) -> freshly minted.
-- The publish triggers below are ADDITIVE (they never modify the prior
-- packages' Layer-B commands) and fire inside the mutating transaction —
-- publication commits or rolls back with the domain mutation.
-- ---------------------------------------------------------------------------
create or replace function public.publish_domain_event(
  p_event_type text,
  p_firm_id uuid,
  p_payload jsonb
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_event_id uuid := gen_random_uuid();
  v_actor_type text;
  v_actor_user_id uuid;
  v_service_name text;
  v_correlation uuid;
  v_headers jsonb;
begin
  v_service_name := nullif(current_setting('app.service_name', true), '');
  if v_service_name is not null then
    v_actor_type := 'system';
    v_actor_user_id := null;
  elsif (select auth.uid()) is not null then
    v_actor_type := 'human';
    v_actor_user_id := (select auth.uid());
    v_service_name := null;
  elsif (select auth.jwt() ->> 'role') = 'service_role' then
    v_actor_type := 'service';
    v_service_name := 'service-role';
  else
    v_actor_type := 'system';
    v_service_name := 'database-operator';
  end if;

  begin
    v_correlation := nullif(current_setting('app.correlation_id', true), '')::uuid;
  exception when others then
    v_correlation := null;
  end;
  if v_correlation is null then
    -- Untrusted request metadata (AUD-CTX-02); a malformed GUC must never
    -- abort the mutation through a JSON/uuid error here (audit_write
    -- defensive-parsing precedent).
    begin
      v_headers := coalesce(
        nullif(current_setting('request.headers', true), '')::jsonb,
        '{}'::jsonb);
      v_correlation := nullif(v_headers ->> 'x-correlation-id', '')::uuid;
    exception when others then
      v_correlation := null;
    end;
  end if;
  -- SCH-33 correlation_id is NOT NULL: mint when no upstream correlation
  -- exists (AUD-INV-06 linkage is still satisfiable downstream).
  v_correlation := coalesce(v_correlation, gen_random_uuid());

  insert into public.event_outbox (
    event_id, event_type, firm_id, occurred_at,
    actor_type, actor_user_id, service_name,
    correlation_id, payload
  ) values (
    v_event_id, p_event_type, p_firm_id, now(),
    v_actor_type, v_actor_user_id, v_service_name,
    v_correlation, p_payload
  );
  return v_event_id;
end;
$$;

comment on function public.publish_domain_event(text, uuid, jsonb) is
  'IMP-050 internal transactional-outbox writer (AUTO-FLOW-03, SCH-33). Owner-only EXECUTE; called by the event_publish_trg producer triggers and the recovery path. Actor/correlation derived server-side; automation contexts stamp system+service_name via transaction-local GUCs set only by definer owner functions (AUD-ACT-02/05).';

revoke all on function public.publish_domain_event(text, uuid, jsonb) from public, anon, authenticated, service_role;

-- Generic producer trigger: maps the mutating table/operation to the
-- deferred catalogue events IMP-050 wires (spec 09 partition notes):
--   compliance_instances INSERT -> compliance_instance.created
--   tasks INSERT -> task.created; assignee change -> task.assigned;
--     status -> done -> task.completed
--   review_items INSERT -> review.submitted; pending -> terminal decision
--     -> review.completed
--   alerts INSERT -> alert.created; status -> resolved -> alert.resolved
-- Payloads are minimal (ids + changed facts, AUTO-ENV-01). The trigger
-- deliberately IGNORES app.audit_skip_trigger — that flag governs Layer-A
-- audit capture only, never publication.
create or replace function public.event_publish_trg()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if TG_TABLE_NAME = 'compliance_instances' and TG_OP = 'INSERT' then
    perform public.publish_domain_event(
      'compliance_instance.created', new.firm_id,
      jsonb_build_object(
        'instance_id', new.id,
        'compliance_type_id', new.compliance_type_id,
        'legal_entity_id', new.legal_entity_id,
        'registration_id', new.registration_id,
        'period_start', new.period_start,
        'period_end', new.period_end,
        'due_date', new.due_date,
        'generation_source', new.generation_source,
        'rule_version_id', new.rule_version_id));
    return new;
  end if;

  if TG_TABLE_NAME = 'tasks' and TG_OP = 'INSERT' then
    perform public.publish_domain_event(
      'task.created', new.firm_id,
      jsonb_build_object(
        'task_id', new.id,
        'client_id', new.client_id,
        'compliance_instance_id', new.compliance_instance_id,
        'assignee_membership_id', new.assignee_membership_id));
    return new;
  end if;
  if TG_TABLE_NAME = 'tasks' and TG_OP = 'UPDATE' then
    if new.assignee_membership_id is distinct from old.assignee_membership_id then
      perform public.publish_domain_event(
        'task.assigned', new.firm_id,
        jsonb_build_object(
          'task_id', new.id,
          'old_assignee_membership_id', old.assignee_membership_id,
          'new_assignee_membership_id', new.assignee_membership_id));
    end if;
    if new.status is distinct from old.status and new.status = 'done' then
      perform public.publish_domain_event(
        'task.completed', new.firm_id,
        jsonb_build_object(
          'task_id', new.id,
          'compliance_instance_id', new.compliance_instance_id));
    end if;
    return new;
  end if;

  if TG_TABLE_NAME = 'review_items' and TG_OP = 'INSERT' then
    perform public.publish_domain_event(
      'review.submitted', new.firm_id,
      jsonb_build_object(
        'review_item_id', new.id,
        'type', new.type,
        'client_id', new.client_id,
        'task_id', new.task_id,
        'compliance_instance_id', new.compliance_instance_id,
        'submitted_by_membership_id', new.submitted_by_membership_id));
    return new;
  end if;
  if TG_TABLE_NAME = 'review_items' and TG_OP = 'UPDATE' then
    if new.status is distinct from old.status
       and old.status = 'pending'
       and new.status in ('approved', 'returned', 'escalated', 'dismissed') then
      perform public.publish_domain_event(
        'review.completed', new.firm_id,
        jsonb_build_object(
          'review_item_id', new.id,
          'decision', new.status,
          'decided_by_membership_id', new.decided_by_membership_id,
          'decided_at', new.decided_at));
    end if;
    return new;
  end if;

  if TG_TABLE_NAME = 'alerts' and TG_OP = 'INSERT' then
    perform public.publish_domain_event(
      'alert.created', new.firm_id,
      jsonb_build_object(
        'alert_id', new.id,
        'alert_rule_id', new.alert_rule_id,
        'severity', new.severity,
        'client_id', new.client_id,
        'compliance_instance_id', new.compliance_instance_id));
    return new;
  end if;
  if TG_TABLE_NAME = 'alerts' and TG_OP = 'UPDATE' then
    if new.status is distinct from old.status and new.status = 'resolved' then
      perform public.publish_domain_event(
        'alert.resolved', new.firm_id,
        jsonb_build_object(
          'alert_id', new.id,
          'resolution_type', new.resolution_type,
          'resolved_by', new.resolved_by,
          'resolved_at', new.resolved_at));
    end if;
    return new;
  end if;

  -- Defense in depth (audit_trg_row precedent): attach only to the
  -- mapped tables above.
  raise exception 'event_publish_trg attached to unmapped table %', TG_TABLE_NAME
    using errcode = 'P0001';
end;
$$;

comment on function public.event_publish_trg() is
  'IMP-050 transactional-outbox producer trigger (AUTO-FLOW-03; spec 09 IMP-031/040/041/042 partition notes). Publishes exactly the eight deferred catalogue events; additive to prior packages (no Layer-B command modified); ignores app.audit_skip_trigger (publication is not audit).';

revoke all on function public.event_publish_trg() from public, anon, authenticated, service_role;

create trigger compliance_instances_publish_event
  after insert on public.compliance_instances
  for each row execute function public.event_publish_trg();

create trigger tasks_publish_event
  after insert or update of assignee_membership_id, status on public.tasks
  for each row execute function public.event_publish_trg();

create trigger review_items_publish_event
  after insert or update of status on public.review_items
  for each row execute function public.event_publish_trg();

create trigger alerts_publish_event
  after insert or update of status on public.alerts
  for each row execute function public.event_publish_trg();

-- ---------------------------------------------------------------------------
-- Recurrence machinery (AUTO-REC-01…10)
--
-- Business-date basis (AUTO-REC-10): the business date is derived
-- EXPLICITLY in Asia/Kolkata; correctness never depends on the PostgreSQL
-- server/session timezone. Persisted timestamps remain UTC.
-- ---------------------------------------------------------------------------

-- Period anchor: the period containing p_date for p_frequency.
-- Implementation interpretation (b): monthly = calendar month; quarterly
-- = Indian fiscal quarter (Q1 = Apr–Jun); annual = Indian fiscal year
-- (Apr 1 – Mar 31). 'event'/'custom' have no period schedule (the caller
-- skips them before invoking).
create or replace function public.recurrence_period_anchor(
  p_frequency text,
  p_date date,
  out period_start date,
  out period_end date
)
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_year int := extract(year from p_date);
  v_month int := extract(month from p_date);
begin
  if p_frequency = 'monthly' then
    period_start := date_trunc('month', p_date)::date;
    period_end := (date_trunc('month', p_date) + interval '1 month' - interval '1 day')::date;
  elsif p_frequency = 'quarterly' then
    -- Indian fiscal quarters: Q1 Apr–Jun, Q2 Jul–Sep, Q3 Oct–Dec,
    -- Q4 Jan–Mar.
    period_start := (make_date(v_year, 4, 1)
      + (floor(((v_month - 4 + 12) % 12) / 3) * 3 || ' months')::interval)::date;
    period_end := (period_start + interval '3 months' - interval '1 day')::date;
  elsif p_frequency = 'annual' then
    -- Indian fiscal year Apr 1 – Mar 31.
    period_start := make_date(case when v_month >= 4 then v_year else v_year - 1 end, 4, 1);
    period_end := (period_start + interval '1 year' - interval '1 day')::date;
  else
    raise exception 'frequency % has no recurrence period schedule', p_frequency
      using errcode = 'P0001';
  end if;
end;
$$;

comment on function public.recurrence_period_anchor(text, date) is
  'IMP-050 period derivation (AUTO-REC-03 layer 1 deterministic identity). Monthly = calendar month; quarterly/annual = Indian fiscal calendar (Apr-start). Pure date arithmetic; no timezone dependence.';

revoke all on function public.recurrence_period_anchor(text, date) from public, anon, authenticated, service_role;

-- Presentation-only period label (SCH-12: period_label is never
-- authoritative).
create or replace function public.recurrence_period_label(
  p_frequency text,
  p_period_start date
)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_year int := extract(year from p_period_start);
  v_month int := extract(month from p_period_start);
begin
  if p_frequency = 'monthly' then
    return to_char(p_period_start, 'Mon YYYY');
  elsif p_frequency = 'quarterly' then
    return 'Q' || (floor(((v_month - 4 + 12) % 12) / 3) + 1)::int
      || ' FY' || to_char(make_date(case when v_month >= 4 then v_year else v_year - 1 end, 4, 1), 'YY')
      || '-' || to_char(make_date(case when v_month >= 4 then v_year + 1 else v_year end, 3, 1), 'YY');
  elsif p_frequency = 'annual' then
    return 'FY ' || v_year || '-' || to_char((v_year + 1) % 100, 'FM00');
  end if;
  return to_char(p_period_start, 'YYYY-MM-DD');
end;
$$;

comment on function public.recurrence_period_label(text, date) is
  'IMP-050 presentation-only period label (SCH-12 — never authoritative). Monthly ''Mon YYYY''; quarterly ''Qn FYyy-yy''; annual ''FY yyyy-yy''.';

revoke all on function public.recurrence_period_label(text, date) from public, anon, authenticated, service_role;

-- Due-date computation (AUTO-REC-05): the active rule version's due_rule
-- + the structured period. Machine-readable grammar (implementation
-- interpretation (a) — seeded versions carry descriptive-only due_rule
-- and are all draft, so this grammar is exercised by authored rules):
--   { "days_after_period_end": N }                    (integer >= 0)
--   { "due_day_of_month": D [, "months_after_period_end": M ] }
--         D in 1..31, M integer >= 0 (default 1): the D-th of the month
--         M months after the period-end month. The computed date must be
--         a real calendar date — an impossible day (e.g. 31st of a 30-day
--         month) is a configuration error, never silently clamped.
-- Anything else is a configuration error: raises (fail-closed,
-- AUTO-REC-02 validation philosophy). Due dates are Asia/Kolkata business
-- dates — pure date arithmetic, never reinterpreted through UTC
-- boundaries (AUTO-REC-10).
create or replace function public.recurrence_due_date(
  p_due_rule jsonb,
  p_period_start date,
  p_period_end date
)
returns date
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_days int;
  v_day int;
  v_months int;
  v_base date;
  v_due date;
begin
  if jsonb_typeof(p_due_rule -> 'days_after_period_end') = 'number'
     and (p_due_rule ->> 'days_after_period_end') ~ '^[0-9]+$' then
    v_days := (p_due_rule ->> 'days_after_period_end')::int;
    return p_period_end + v_days;
  end if;

  if jsonb_typeof(p_due_rule -> 'due_day_of_month') = 'number'
     and (p_due_rule ->> 'due_day_of_month') ~ '^[0-9]+$' then
    v_day := (p_due_rule ->> 'due_day_of_month')::int;
    v_months := coalesce(
      case
        when jsonb_typeof(p_due_rule -> 'months_after_period_end') = 'number'
             and (p_due_rule ->> 'months_after_period_end') ~ '^[0-9]+$'
          then (p_due_rule ->> 'months_after_period_end')::int
      end, 1);
    if v_day < 1 or v_day > 31 then
      raise exception 'invalid due_rule: due_day_of_month % out of range', v_day
        using errcode = 'P0001';
    end if;
    v_base := (date_trunc('month', p_period_end) + (v_months || ' months')::interval)::date;
    if v_day > extract(day from (date_trunc('month', v_base) + interval '1 month' - interval '1 day')::date) then
      raise exception 'invalid due_rule: day % does not exist in month %', v_day, v_base
        using errcode = 'P0001';
    end if;
    v_due := (date_trunc('month', v_base) + ((v_day - 1) || ' days')::interval)::date;
    return v_due;
  end if;

  raise exception 'due_rule % is not machine-readable (configuration error; no silent fallback)',
    p_due_rule
    using errcode = 'P0001';
end;
$$;

comment on function public.recurrence_due_date(jsonb, date, date) is
  'IMP-050 due-date computation (AUTO-REC-05/10). Grammar: days_after_period_end | due_day_of_month(+months_after_period_end). Unparseable/impossible rules are configuration errors (fail-closed, no silent fallback). Business-date arithmetic; no UTC reinterpretation.';

revoke all on function public.recurrence_due_date(jsonb, date, date) from public, anon, authenticated, service_role;

-- Look-ahead configuration (AUTO-REC-02; SCH-01 settings carrier):
-- absent/null -> 90; a present value MUST be a positive integer; anything
-- else is a configuration error and MUST fail observably — never a silent
-- fallback to 90.
create or replace function public.recurrence_lookahead_days(p_firm_id uuid)
returns int
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_raw jsonb;
  v_text text;
begin
  select f.settings -> 'recurrence_lookahead_days' into v_raw
  from public.firms f
  where f.id = p_firm_id;
  if not found then
    raise exception 'firm % does not exist', p_firm_id using errcode = 'P0001';
  end if;
  if v_raw is null or v_raw = 'null'::jsonb then
    return 90;
  end if;
  v_text := v_raw::text;
  if jsonb_typeof(v_raw) = 'number' and v_text ~ '^[0-9]+$' and v_text::int > 0 then
    return v_text::int;
  end if;
  raise exception 'invalid recurrence_lookahead_days for firm %: % (must be a positive integer; refusing to fall back to 90)',
    p_firm_id, v_raw
    using errcode = 'P0001';
end;
$$;

comment on function public.recurrence_lookahead_days(uuid) is
  'IMP-050 look-ahead carrier (AUTO-REC-02, SCH-01): firms.settings.recurrence_lookahead_days; absent/null -> 90; present value must be a positive integer — invalid values are observable configuration errors (no silent fallback). Server-side only.';

revoke all on function public.recurrence_lookahead_days(uuid) from public, anon, authenticated, service_role;

-- Single-instance materialization core (AUTO-REC-03 layers 1/2/4):
-- deterministic identity + idempotent insert + unique-violation treated
-- as already-generated. Returns the instance id when THIS call inserted
-- the row (the winner — the ONLY path that publishes/audits creation,
-- AUTO-REC-08), NULL when the obligation-period row already exists.
create or replace function public.recurrence_insert_instance(
  p_profile public.client_compliance_profiles,
  p_rule_version_id uuid,
  p_period_start date,
  p_period_end date,
  p_due_date date,
  p_assignee_membership_id uuid,
  p_reviewer_membership_id uuid,
  p_partner_membership_id uuid,
  p_correlation_id uuid
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.compliance_instances (
    firm_id, legal_entity_id, compliance_type_id, registration_id,
    client_compliance_profile_id,
    period_start, period_end, period_label,
    due_date,
    rule_version_id, generation_source, generated_at, calculated_due_date,
    assignee_membership_id, reviewer_membership_id, partner_membership_id
  ) values (
    p_profile.firm_id, p_profile.legal_entity_id, p_profile.compliance_type_id,
    p_profile.registration_id, p_profile.id,
    p_period_start, p_period_end,
    public.recurrence_period_label(
      (select v.frequency from public.compliance_rule_versions v where v.id = p_rule_version_id),
      p_period_start),
    p_due_date,
    p_rule_version_id, 'recurrence', now(), p_due_date,
    p_assignee_membership_id, p_reviewer_membership_id, p_partner_membership_id
  )
  on conflict on constraint cin_obligation_period_unique do nothing
  returning id into v_id;

  if v_id is not null then
    -- Winning insert only (AUTO-REC-08): audit with the automation actor
    -- model (AUD-ACT-02 — system + service_name; never human, AUD-ACT-05)
    -- and the run correlation (AUD-INV-06). The Layer-A trigger is skipped
    -- by the caller's app.audit_skip_trigger; the publication trigger
    -- fires on this insert (same transaction, AUTO-FLOW-03).
    perform public.audit_write(
      p_profile.firm_id, 'system', null,
      'compliance_instance.generated',
      'compliance_instance', v_id::text,
      null,
      jsonb_build_object(
        'instance_id', v_id,
        'compliance_type_id', p_profile.compliance_type_id,
        'legal_entity_id', p_profile.legal_entity_id,
        'registration_id', p_profile.registration_id,
        'client_compliance_profile_id', p_profile.id,
        'period_start', p_period_start,
        'period_end', p_period_end,
        'due_date', p_due_date,
        'rule_version_id', p_rule_version_id,
        'generation_source', 'recurrence'),
      'recurrence', null, p_correlation_id);
  end if;
  return v_id;
end;
$$;

comment on function public.recurrence_insert_instance(client_compliance_profiles, uuid, date, date, date, uuid, uuid, uuid, uuid) is
  'IMP-050 generator insert core (AUTO-REC-03/08): idempotent ON CONFLICT DO NOTHING on the SCH-12 obligation-period key; winner-only audit (system/recurrence actor) and winner-only publication (the AFTER INSERT trigger fires only for the inserted row). Owner-only EXECUTE.';

revoke all on function public.recurrence_insert_instance(client_compliance_profiles, uuid, date, date, date, uuid, uuid, uuid, uuid) from public, anon, authenticated, service_role;


-- Profile materialization over a horizon (AUTO-REC-01 trigger points a/c):
-- enumerates candidate periods from the period containing the approval
-- business date (bounded catch-up; no invented look-back depth — MIG-OQ-04
-- stays open) through p_horizon INCLUSIVE (business_date + N calendar
-- days, AUTO-REC-10), resolves the active rule version for each period
-- (OPS-ACT-02 active-as-of-date predicate on period_start), and inserts
-- idempotently. A period with no governing ACTIVE version materializes
-- nothing (active-with-zero-instances remains valid, C5); a present
-- version with an unparseable due_rule is a configuration error and
-- raises (fail-closed). Returns the number of instances THIS call
-- created.
create or replace function public.generate_profile_instances(
  p_profile_id uuid,
  p_horizon date,
  p_correlation_id uuid
)
returns int
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_profile public.client_compliance_profiles;
  v_type public.compliance_types;
  v_version public.compliance_rule_versions;
  v_business_date date;
  v_approval_date date;
  v_start date;
  v_end date;
  v_due date;
  v_freq text;
  v_id uuid;
  v_assignee uuid;
  v_reviewer uuid;
  v_partner uuid;
  v_count int := 0;
begin
  -- Automation context for the publication trigger and nested audit
  -- (transaction-local, pooled-request safe). The run's correlation id
  -- links every event and audit row this generation causes (AUTO-AUD-02).
  perform pg_catalog.set_config('app.service_name', 'recurrence', true);
  perform pg_catalog.set_config('app.correlation_id', p_correlation_id::text, true);
  perform pg_catalog.set_config('app.audit_skip_trigger', '1', true);

  v_business_date := (now() at time zone 'Asia/Kolkata')::date;

  select * into v_profile
  from public.client_compliance_profiles p
  where p.id = p_profile_id;
  if not found then
    raise exception 'compliance profile % does not exist', p_profile_id
      using errcode = 'P0001';
  end if;

  -- DM-11: only active profiles generate instances.
  if v_profile.status is distinct from 'active' then
    return 0;
  end if;

  select * into v_type
  from public.compliance_types c
  where c.id = v_profile.compliance_type_id;
  if not found then
    raise exception 'compliance type of profile % is missing', p_profile_id
      using errcode = 'P0001';
  end if;

  -- 'event'/'custom' frequencies have no period schedule (interpretation
  -- (b)): nothing to materialize.
  if v_type.frequency in ('event', 'custom') then
    return 0;
  end if;

  v_freq := v_type.frequency;
  v_approval_date := coalesce(
    (v_profile.approved_at at time zone 'Asia/Kolkata')::date,
    v_business_date);

  -- Candidate-period walk: start at the period containing the approval
  -- business date (catch-up lower bound), step by the governing version's
  -- frequency, inclusive through the horizon.
  select a.period_start, a.period_end into v_start, v_end
  from public.recurrence_period_anchor(v_freq, v_approval_date) a;

  while v_start <= p_horizon loop
    -- Active-as-of-date predicate (OPS-ACT-02, exact): the unique active
    -- version governing this period. Uniqueness follows from the SCH-32
    -- active-window non-overlap invariant.
    v_version := null;
    select * into v_version
    from public.compliance_rule_versions v
    where v.compliance_type_id = v_profile.compliance_type_id
      and v.status = 'active'
      and v.effective_from <= v_start
      and (v.effective_to is null or v_start < v.effective_to)
    limit 1;

    if v_version.id is not null then
      if v_version.frequency is distinct from v_freq then
        -- A version may change frequency for its window: re-anchor the
        -- walk so period boundaries always follow the governing version.
        v_freq := v_version.frequency;
        select a.period_start, a.period_end into v_start, v_end
        from public.recurrence_period_anchor(v_freq, v_start) a;
      end if;

      v_due := public.recurrence_due_date(v_version.due_rule, v_start, v_end);

      -- Assignment carry-over (PRD §29 / DM-12): the immediately
      -- preceding period's instance of the same obligation donates
      -- assignee/reviewer/partner. First-ever instance: NULLs.
      select p2.assignee_membership_id, p2.reviewer_membership_id, p2.partner_membership_id
        into v_assignee, v_reviewer, v_partner
      from public.compliance_instances p2
      where p2.firm_id = v_profile.firm_id
        and p2.compliance_type_id = v_profile.compliance_type_id
        and p2.legal_entity_id = v_profile.legal_entity_id
        and p2.registration_id is not distinct from v_profile.registration_id
        and p2.period_start < v_start
      order by p2.period_start desc
      limit 1;

      v_id := public.recurrence_insert_instance(
        v_profile, v_version.id, v_start, v_end, v_due,
        v_assignee, v_reviewer, v_partner, p_correlation_id);

      if v_id is not null then
        v_count := v_count + 1;
        -- Successor backfill (AUTO-REC-01b): if the immediately preceding
        -- period's instance is already closed and not yet linked, link it
        -- to this new row. The composite same-firm self-FK makes a
        -- cross-firm link physically impossible (Ruling R7).
        update public.compliance_instances prev
        set successor_instance_id = v_id
        where prev.id = (
          select p3.id
          from public.compliance_instances p3
          where p3.firm_id = v_profile.firm_id
            and p3.compliance_type_id = v_profile.compliance_type_id
            and p3.legal_entity_id = v_profile.legal_entity_id
            and p3.registration_id is not distinct from v_profile.registration_id
            and p3.period_start < v_start
            and p3.state = 'closed'
            and p3.successor_instance_id is null
          order by p3.period_start desc
          limit 1);
      end if;
    end if;

    -- Step to the next period (the day after this period's end,
    -- re-anchored under the current frequency).
    select a.period_start, a.period_end into v_start, v_end
    from public.recurrence_period_anchor(v_freq, v_end + 1) a;
  end loop;

  return v_count;
end;
$$;

comment on function public.generate_profile_instances(uuid, date, uuid) is
  'IMP-050 recurrence materialization core (AUTO-REC-01a/c, AUTO-REC-03 layers 1/2, AUTO-REC-04/05/10): deterministic obligation-period identity; only ACTIVE profiles generate (DM-11); per-period active rule version per OPS-ACT-02; Asia/Kolkata business-date horizon; idempotent. Owner-only EXECUTE — invoked by the scheduler job and the approval command.';

revoke all on function public.generate_profile_instances(uuid, date, uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Successor materialization on closure (AUTO-REC-01 trigger point b):
-- when an instance reaches closed, its next-period successor materializes
-- immediately (never waiting for the daily run, AUTO-SCH-05), linked via
-- successor_instance_id. Idempotent: an already-materialized next period
-- (look-ahead) is linked, never duplicated. A manual instance without an
-- active profile has no recurrence basis and spawns nothing. The generator
-- enforces successor/cycle semantics in logic (Ruling R7): the successor
-- period must strictly advance; the composite same-firm self-FK makes a
-- cross-firm link impossible. Returns the successor id (created or
-- existing), NULL when no successor was materialized.
-- ---------------------------------------------------------------------------
create or replace function public.generate_successor_instance(
  p_instance_id uuid,
  p_correlation_id uuid
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_inst public.compliance_instances;
  v_profile public.client_compliance_profiles;
  v_type public.compliance_types;
  v_version public.compliance_rule_versions;
  v_freq text;
  v_next_start date;
  v_next_end date;
  v_due date;
  v_id uuid;
  v_existing uuid;
begin
  perform pg_catalog.set_config('app.service_name', 'recurrence', true);
  perform pg_catalog.set_config('app.correlation_id', p_correlation_id::text, true);
  perform pg_catalog.set_config('app.audit_skip_trigger', '1', true);

  select * into v_inst
  from public.compliance_instances i
  where i.id = p_instance_id;
  if not found then
    return null;
  end if;

  -- No recurrence basis without a profile link (manual ad-hoc instance).
  if v_inst.client_compliance_profile_id is null then
    return null;
  end if;

  select * into v_profile
  from public.client_compliance_profiles p
  where p.id = v_inst.client_compliance_profile_id;
  -- A suspended/ended profile generates nothing (DM-11).
  if not found or v_profile.status is distinct from 'active' then
    return null;
  end if;

  select * into v_type
  from public.compliance_types c
  where c.id = v_profile.compliance_type_id;
  if not found then
    raise exception 'compliance type of instance % is missing', p_instance_id
      using errcode = 'P0001';
  end if;
  if v_type.frequency in ('event', 'custom') then
    return null;
  end if;

  -- Period arithmetic follows the closing instance's own governing
  -- version when present, else the type's default template.
  v_freq := coalesce(
    (select v.frequency from public.compliance_rule_versions v
     where v.id = v_inst.rule_version_id),
    v_type.frequency);

  select a.period_start, a.period_end into v_next_start, v_next_end
  from public.recurrence_period_anchor(v_freq, v_inst.period_end + 1) a;

  -- Cycle/ordering guard (Ruling R7): the successor period must strictly
  -- advance — a non-advancing derivation is a defect, never persisted.
  if v_next_start <= v_inst.period_start then
    raise exception 'recurrence successor period does not advance (cycle guard): % -> %',
      v_inst.period_start, v_next_start
      using errcode = 'P0001';
  end if;

  -- Resolve the version governing the successor period (OPS-ACT-02).
  select * into v_version
  from public.compliance_rule_versions v
  where v.compliance_type_id = v_profile.compliance_type_id
    and v.status = 'active'
    and v.effective_from <= v_next_start
    and (v.effective_to is null or v_next_start < v.effective_to)
  limit 1;
  -- No governing version: nothing to materialize now; the scheduled run
  -- materializes when a version governs the period.
  if v_version.id is null then
    return null;
  end if;

  v_due := public.recurrence_due_date(v_version.due_rule, v_next_start, v_next_end);

  -- Copy assignee/reviewer/partner from the closing instance (PRD §29,
  -- DM-12). cin_validate_assignments re-validates same-firm on insert.
  v_id := public.recurrence_insert_instance(
    v_profile, v_version.id, v_next_start, v_next_end, v_due,
    v_inst.assignee_membership_id, v_inst.reviewer_membership_id,
    v_inst.partner_membership_id, p_correlation_id);

  if v_id is null then
    -- Already materialized (look-ahead or a prior close): link the
    -- existing row, never duplicate (AUTO-REC-03 layer 4).
    select i.id into v_existing
    from public.compliance_instances i
    where i.firm_id = v_profile.firm_id
      and i.compliance_type_id = v_profile.compliance_type_id
      and i.legal_entity_id = v_profile.legal_entity_id
      and i.registration_id is not distinct from v_profile.registration_id
      and i.period_start = v_next_start;
  end if;
  v_existing := coalesce(v_id, v_existing);

  -- Link successor (single-writer: this generator path and the scheduler
  -- backfill only; the browser grant excludes the column). Composite
  -- same-firm self-FK enforces firm structure.
  update public.compliance_instances i
  set successor_instance_id = v_existing
  where i.id = v_inst.id
    and i.successor_instance_id is null;

  return v_existing;
end;
$$;

comment on function public.generate_successor_instance(uuid, uuid) is
  'IMP-050 closure materialization (AUTO-REC-01b): immediate next-period successor linked via the composite same-firm self-FK (Ruling R7); idempotent against look-ahead rows; cycle/period-order guard; owner-only EXECUTE.';

revoke all on function public.generate_successor_instance(uuid, uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Scheduler entry: sched.recurrence.evaluate (AUTO-SCH-04/05)
--
-- Daily catch-up / look-ahead maintenance (00:30 Asia/Kolkata via the
-- 0 19 * * * GMT cron registration; registration itself is gated by
-- register_scheduler_jobs below). Trigger points (a) activation and
-- (b) closure retain their immediate materialization and never wait for
-- this run. Explicit per-firm iteration enforces tenancy in function
-- logic (AUTO-SCH-03 — the cron identity carries BYPASSRLS; RLS is
-- evidence of nothing here). Fail-visible (AUTO-PRIN-04/AUTO-OBS-01): one
-- SCH-34 job-run row per run; a firm whose configuration is invalid
-- (AUTO-REC-02) fails observably — its subtransaction rolls back, the
-- error is recorded, other firms still run, and the run ends 'failed'.
-- ---------------------------------------------------------------------------
create or replace function public.evaluate_recurrence()
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_run_id uuid;
  v_correlation uuid := gen_random_uuid();
  -- Business date derived EXPLICITLY in Asia/Kolkata (AUTO-REC-10) —
  -- never dependent on the server/session timezone.
  v_business_date date := (now() at time zone 'Asia/Kolkata')::date;
  v_firm_id uuid;
  v_profile_id uuid;
  v_lookahead int;
  v_horizon date;
  v_count int := 0;
  v_errors text[] := '{}';
begin
  insert into public.scheduler_job_runs (job_name, correlation_id, status)
  values ('sched.recurrence.evaluate', v_correlation, 'running')
  returning id into v_run_id;

  for v_firm_id in
    select f.id
    from public.firms f
    where exists (
      select 1 from public.client_compliance_profiles p
      where p.firm_id = f.id and p.status = 'active')
    order by f.id
  loop
    begin
      v_lookahead := public.recurrence_lookahead_days(v_firm_id);
      v_horizon := v_business_date + v_lookahead;
      for v_profile_id in
        select p.id
        from public.client_compliance_profiles p
        where p.firm_id = v_firm_id and p.status = 'active'
        order by p.id
      loop
        v_count := v_count + public.generate_profile_instances(
          v_profile_id, v_horizon, v_correlation);
      end loop;
    exception when others then
      -- Observable per-firm failure; the firm's work rolls back, the run
      -- continues for other firms and ends failed (AUTO-PRIN-04).
      v_errors := v_errors || format('firm %s: %s', v_firm_id, SQLERRM);
    end;
  end loop;

  update public.scheduler_job_runs
  set status = case
        when coalesce(array_length(v_errors, 1), 0) > 0 then 'failed'
        else 'succeeded' end,
      finished_at = now(),
      rows_affected = v_count,
      error = case
        when coalesce(array_length(v_errors, 1), 0) > 0
          then array_to_string(v_errors, '; ') end
  where id = v_run_id;
end;
$$;

comment on function public.evaluate_recurrence() is
  'IMP-050 scheduler entry for sched.recurrence.evaluate (AUTO-SCH-04/05): daily catch-up/look-ahead maintenance; explicit per-firm tenancy (AUTO-SCH-03); per-firm fail-visible errors in SCH-34 (AUTO-OBS-01); one correlation id per run (AUTO-AUD-02). Owner-only EXECUTE — no anon/authenticated/service_role capability (AUTO-SCH-03c).';

revoke all on function public.evaluate_recurrence() from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Infrastructure outbox drain (AUTO-SCH-04: NOT a sched.* signal) —
-- runs once per minute, timezone-independent (AUTO-SCH-05).
--
-- Drain semantics (AUTO-FLOW-05): a publication reaches 'delivered' when
-- all consumers ACTUALLY REGISTERED for its event type have completed.
-- Registration: a consumer exists iff a function
--   public.outbox_consumer_<event_type with dots -> underscores>(uuid)
-- exists (implementation interpretation (d)). R0 registers NO production
-- consumers, so drain completion marks the publication delivered — a
-- drain-completion record, never an external/HTTP delivery claim.
-- Failure path (AUTO-RET-01): bounded retries with exponential backoff
-- (1/2/4/8 minutes, 5 attempts — implementation configuration, not
-- contract); exhaustion dead-letters: SCH-33 status='dead_lettered' plus
-- an SCH-35 record (dual visibility). The publication's original
-- correlation_id is never touched by retries (AUTO-RET-02).
-- ---------------------------------------------------------------------------
create or replace function public.drain_event_outbox()
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  c_max_attempts constant int := 5;
  v_run_id uuid;
  v_correlation uuid := gen_random_uuid();
  v_pub record;
  v_consumer text;
  v_processed int := 0;
  v_run_error text;
begin
  insert into public.scheduler_job_runs (job_name, correlation_id, status)
  values ('outbox.drain', v_correlation, 'running')
  returning id into v_run_id;

  begin
    for v_pub in
      select o.id, o.event_id, o.event_type, o.firm_id, o.correlation_id,
             o.payload, o.attempt_count, o.status
      from public.event_outbox o
      where (o.status = 'pending'
             and (o.next_attempt_at is null or o.next_attempt_at <= now()))
         or (o.status = 'failed'
             and o.next_attempt_at is not null and o.next_attempt_at <= now())
      order by o.created_at
      for update of o skip locked
    loop
      begin
        if v_pub.status = 'failed' then
          -- failed -> pending: retry reschedule (SCH-33 lifecycle).
          update public.event_outbox set status = 'pending' where id = v_pub.id;
        end if;

        v_consumer := null;
        select p.proname into v_consumer
        from pg_catalog.pg_proc p
        where p.pronamespace = 'public'::pg_catalog.regnamespace
          and p.proname = 'outbox_consumer_' || replace(v_pub.event_type, '.', '_')
          -- Signature match by TYPE identity (pronargs + proargtypes), so a
          -- consumer declared with a named parameter ((p_event_id uuid))
          -- is discovered exactly like an unnamed-arg one — discovery must
          -- never silently miss a registered consumer.
          and p.pronargs = 1
          and p.proargtypes[0] = 'uuid'::pg_catalog.regtype;
        if v_consumer is not null then
          execute format('select public.%I($1::uuid)', v_consumer)
            using v_pub.event_id;
        end if;

        update public.event_outbox
        set status = 'delivered', processed_at = now()
        where id = v_pub.id;
        v_processed := v_processed + 1;
      exception when others then
        if v_pub.attempt_count + 1 >= c_max_attempts then
          -- Attempts exhausted: dead-letter (AUTO-RET-01; dual visibility
          -- on SCH-33 + SCH-35, SCH-35 invariants).
          update public.event_outbox
          set status = 'dead_lettered',
              attempt_count = attempt_count + 1,
              last_error = SQLERRM,
              first_failed_at = coalesce(first_failed_at, now()),
              processed_at = now()
          where id = v_pub.id;
          insert into public.scheduler_dead_letters (
            source, source_id, firm_id, correlation_id, payload,
            failure_reason, attempt_count, first_failed_at, last_failed_at)
          select 'outbox_event', o.event_id::text, o.firm_id, o.correlation_id,
                 o.payload, SQLERRM, o.attempt_count,
                 o.first_failed_at, now()
          from public.event_outbox o
          where o.id = v_pub.id;
          v_processed := v_processed + 1;
        else
          update public.event_outbox
          set status = 'failed',
              attempt_count = attempt_count + 1,
              last_error = SQLERRM,
              first_failed_at = coalesce(first_failed_at, now()),
              next_attempt_at = now()
                + (interval '1 minute' * power(2, attempt_count))
          where id = v_pub.id;
        end if;
      end;
    end loop;
  exception when others then
    v_run_error := SQLERRM;
  end;

  update public.scheduler_job_runs
  set status = case when v_run_error is null then 'succeeded' else 'failed' end,
      finished_at = now(),
      rows_affected = v_processed,
      error = v_run_error
  where id = v_run_id;
end;
$$;

comment on function public.drain_event_outbox() is
  'IMP-050 infrastructure outbox drain (AUTO-SCH-04 — NOT a sched.* signal): per-minute, timezone-independent; delivered = all actually-registered R0 consumers completed (empty in production, AUTO-FLOW-05); bounded exponential retry (5 attempts); exhaustion dead-letters to SCH-35 with correlation preserved (AUTO-RET-01/02). Owner-only EXECUTE.';

revoke all on function public.drain_event_outbox() from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Manual dead-letter recovery (AUTO-RPL-01/02) — hardened, server/
-- operator-only; DEAD-LETTER-GATED: pending/failed publications remain
-- under automatic retry and are NEVER manually requeued in R0.
-- ---------------------------------------------------------------------------
create or replace function public.requeue_dead_letter(
  p_dead_letter_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_dl public.scheduler_dead_letters;
  v_pub public.event_outbox;
  v_new_event_id uuid := gen_random_uuid();
begin
  -- Server/operator boundary (AUTO-RPL-02, RLS-SVC-01): with a request
  -- JWT present, only service_role passes (write_audit_event_server
  -- precedent); the no-JWT owner/operator path (psql) is the other
  -- legitimate caller. EXECUTE is granted to service_role only.
  if nullif(current_setting('request.jwt.claims', true), '') is not null
     and (select auth.jwt() ->> 'role') is distinct from 'service_role' then
    raise exception 'service-role boundary required (AUTO-RPL-02)'
      using errcode = '42501';
  end if;

  -- A recovery reason is required and recorded (AUTO-RPL-02).
  if p_reason is null or btrim(p_reason) = '' then
    return jsonb_build_object(
      'status', 'denied', 'kind', 'validation',
      'message', 'a recovery reason is required (AUTO-RPL-02)');
  end if;

  select * into v_dl
  from public.scheduler_dead_letters d
  where d.id = p_dead_letter_id
  for update;
  if not found then
    return jsonb_build_object(
      'status', 'denied', 'kind', 'not_found',
      'message', 'dead letter not found');
  end if;
  if v_dl.status is distinct from 'open' then
    return jsonb_build_object(
      'status', 'denied', 'kind', 'conflict',
      'message', format('dead letter is already %s (SCH-35 lifecycle)', v_dl.status));
  end if;
  if v_dl.source is distinct from 'outbox_event' then
    return jsonb_build_object(
      'status', 'denied', 'kind', 'validation',
      'message', 'only outbox_event dead letters are requeueable in R0 (AUTO-RPL-01)');
  end if;

  select * into v_pub
  from public.event_outbox o
  where o.event_id = v_dl.source_id::uuid;
  if not found then
    return jsonb_build_object(
      'status', 'denied', 'kind', 'not_found',
      'message', 'source publication not found');
  end if;
  -- Dead-letter gate (AUTO-RPL-01): refuse requeue of any publication
  -- that has not reached dead_lettered state.
  if v_pub.status is distinct from 'dead_lettered' then
    return jsonb_build_object(
      'status', 'denied', 'kind', 'conflict',
      'message', 'only dead_lettered publications can be requeued (AUTO-RPL-01); pending/failed remain under automatic retry');
  end if;

  -- NEW publication row with a NEW event_id (publication identity, not
  -- the consumer idempotency identity), envelope facts UNCHANGED,
  -- requeue_of -> the original publication's event_id, ORIGINAL
  -- correlation preserved (AUTO-RET-02). NOT a new domain fact — effect
  -- keys make re-delivery a no-op (AUTO-IDM-01).
  insert into public.event_outbox (
    event_id, event_type, firm_id, occurred_at,
    actor_type, actor_user_id, service_name, correlation_id,
    payload, requeue_of, status
  ) values (
    v_new_event_id, v_pub.event_type, v_pub.firm_id, v_pub.occurred_at,
    v_pub.actor_type, v_pub.actor_user_id, v_pub.service_name,
    v_pub.correlation_id,
    v_pub.payload, v_pub.event_id, 'pending'
  );

  -- The single open -> requeued transition (SCH-35 guard requires this
  -- transaction-local marker — the single-writer convention).
  perform pg_catalog.set_config('app.dead_letter_recovery', '1', true);
  update public.scheduler_dead_letters
  set status = 'requeued'
  where id = v_dl.id;

  -- The recovery operation itself is audited with the EXISTING actor
  -- taxonomy (AUD-ACT-03: service + service_name; no new actor type),
  -- preserving the original correlation chain (AUTO-RET-02).
  perform public.audit_write(
    v_dl.firm_id, 'service', null,
    'event_outbox.dead_letter_requeued',
    'scheduler_dead_letter', v_dl.id::text,
    to_jsonb(v_dl),
    jsonb_build_object(
      'dead_letter_id', v_dl.id,
      'status', 'requeued',
      'source_event_id', v_pub.event_id,
      'new_event_id', v_new_event_id,
      'reason', p_reason),
    'dead-letter-recovery', null, v_pub.correlation_id);

  return jsonb_build_object(
    'status', 'requeued',
    'dead_letter_id', v_dl.id,
    'source_event_id', v_pub.event_id,
    'new_event_id', v_new_event_id);
end;
$$;

comment on function public.requeue_dead_letter(uuid, text) is
  'IMP-050 hardened manual dead-letter recovery (AUTO-RPL-01/02): dead-letter-gated; required recorded reason; new SCH-33 publication with new event_id + requeue_of lineage + original correlation (AUTO-RET-02); SCH-35 open -> requeued; audited actor_type=service service_name=dead-letter-recovery (AUD-ACT-03, no new actor type). EXECUTE: service_role only — no anon/authenticated capability.';

revoke all on function public.requeue_dead_letter(uuid, text) from public, anon, authenticated;
grant execute on function public.requeue_dead_letter(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- Cron registration (AUTO-SCH-04/05/07)
--
-- IMP-050 registers EXACTLY TWO pg_cron jobs:
--   1. sched.recurrence.evaluate — 0 19 * * * interpreted in GMT
--      (= 00:30 Asia/Kolkata, fixed UTC+05:30; Ruling R5);
--   2. outbox.drain — the ONE infrastructure outbox-drain job, once per
--      minute, timezone-independent (NOT a sched.* signal).
-- IMP-050 does NOT register sched.alerts.evaluate (IMP-051) or
-- sched.login_mirror.run (existing deferred ownership).
--
-- AUTO-SCH-07 fail-closed precondition: the GMT interpretation is valid
-- only under current_setting('cron.timezone', true) = 'GMT'. If the
-- effective timezone is not GMT this function RAISES and nothing is
-- registered — CAOS never mutates cron.timezone (no ALTER SYSTEM /
-- postgresql.conf / restart path); a non-GMT environment fails the
-- acceptance gate and requires explicit human review.
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
    raise exception 'AUTO-SCH-07 fail-closed: cron.timezone must be GMT to register sched.recurrence.evaluate as 0 19 * * * (= 00:30 Asia/Kolkata); effective value is %. Nothing registered; cron.timezone is never mutated by CAOS — explicit human review required.',
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

  return jsonb_build_object(
    'status', 'registered',
    'cron_timezone', pg_catalog.current_setting('cron.timezone', true),
    'jobs', jsonb_build_array('sched.recurrence.evaluate', 'outbox.drain'));
end;
$$;

comment on function public.register_scheduler_jobs() is
  'IMP-050 cron registration (AUTO-SCH-04/05/07): exactly sched.recurrence.evaluate (0 19 * * * GMT) + the outbox.drain infrastructure job (* * * * *); GMT fail-closed precondition; named idempotent upsert. Owner-only EXECUTE.';

revoke all on function public.register_scheduler_jobs() from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Immediate-path correlation identity (AUTO-ENV-01, AUD-INV-06, AUTO-AUD-02)
--
-- Activation/closure-triggered materialization runs INSIDE the originating
-- human request's transaction, so its automation chain must share the
-- originating correlation rather than mint an unrelated one. Resolution
-- follows the existing AUD-CTX-02 / publish_domain_event precedence:
--   app.correlation_id (an already-linked automation context)
--   -> untrusted x-correlation-id request header (defensively parsed — a
--      malformed GUC must never abort an otherwise valid command)
--   -> one freshly minted server-side identity for the immediate chain.
-- Correlation remains NON-AUTHORITATIVE metadata: it is never used for
-- identity, scope, or authorization decisions.
-- ---------------------------------------------------------------------------
create or replace function public.immediate_automation_correlation()
returns uuid
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_correlation uuid;
  v_headers jsonb;
begin
  begin
    v_correlation := nullif(
      pg_catalog.current_setting('app.correlation_id', true), '')::uuid;
  exception when others then
    v_correlation := null;
  end;
  if v_correlation is null then
    begin
      v_headers := coalesce(
        nullif(pg_catalog.current_setting('request.headers', true), '')::jsonb,
        '{}'::jsonb);
      v_correlation := nullif(v_headers ->> 'x-correlation-id', '')::uuid;
    exception when others then
      v_correlation := null;
    end;
  end if;
  return coalesce(v_correlation, gen_random_uuid());
end;
$$;

comment on function public.immediate_automation_correlation() is
  'IMP-050 correlation identity for immediate (activation/closure-triggered) materialization: propagate the originating request correlation when one exists under AUD-CTX-02 semantics, else mint ONE server-side identity for the immediate automation chain (AUTO-ENV-01, AUD-INV-06). Non-authoritative metadata only. Owner-only EXECUTE — called by the Layer-B command amendments.';

revoke all on function public.immediate_automation_correlation() from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- IMP-031 command amendment (AUTO-REC-01 trigger point a): profile
-- activation materializes the CURRENT period immediately (it no longer
-- waits for the daily run, AUTO-SCH-05). Behavior added AFTER the
-- approval update, inside the same transaction: mutation + generation +
-- publication commit or roll back together. A profile whose type has no
-- ACTIVE governing rule version for the current period materializes
-- nothing (active-with-zero-instances remains valid, C5); a present
-- version with an unparseable due_rule is a configuration error and fails
-- the approval (conflict) — never a silent fallback. Everything else in
-- the command is byte-identical to the IMP-031 authorization-first
-- contract.
-- ---------------------------------------------------------------------------
create or replace function public.approve_client_compliance_profile(p_profile_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_profile public.client_compliance_profiles;
  v_new public.client_compliance_profiles;
  v_role text;
  v_membership uuid;
  v_reason text;
  v_in_scope boolean;
begin
  -- Single-writer command context (transaction-local; pooled-request safe).
  perform pg_catalog.set_config('app.ccp_approval_command', '1', true);
  perform pg_catalog.set_config('app.audit_skip_trigger', '1', true);

  begin
    if (select auth.uid()) is null then
      raise exception 'authentication required' using errcode = 'CA401';
    end if;

    select * into v_profile
    from public.client_compliance_profiles p
    where p.id = p_profile_id
    for update;
    if not found then
      return jsonb_build_object(
        'status', 'denied', 'kind', 'not_found',
        'message', 'compliance profile not found');
    end if;

    -- AUTHORIZATION FIRST (API-ERR-02): unchanged from IMP-031 — every
    -- pre-authorization failure returns the IDENTICAL not_found body.
    v_role := public.active_membership_role(v_profile.firm_id);
    v_membership := public.active_membership_id(v_profile.firm_id);

    if v_role in ('super_admin', 'partner') then
      v_in_scope := true;
    elsif v_role = 'manager' then
      v_in_scope := exists (
        select 1 from public.legal_entities le
        join public.clients c on c.firm_id = le.firm_id and c.id = le.client_id
        where le.firm_id = v_profile.firm_id
          and le.id = v_profile.legal_entity_id
          and c.manager_membership_id = v_membership
      );
    else
      v_in_scope := false;
    end if;

    if public.req_active_firm() is distinct from v_profile.firm_id
       or v_role is null
       or not v_in_scope then
      perform public.audit_write(
        v_profile.firm_id, 'human', (select auth.uid()),
        'compliance_profile.approval_denied',
        'compliance_profile', p_profile_id::text,
        null, jsonb_build_object(
          'reason', 'profile not visible to caller (API-ERR-02)'));
      return jsonb_build_object(
        'status', 'denied', 'kind', 'not_found',
        'message', 'compliance profile not found');
    end if;

    if v_profile.status is distinct from 'proposed' then
      v_reason := format('only a proposed profile can be approved (current status: %s)', v_profile.status);
      raise exception '%', v_reason using errcode = 'CA402';
    end if;

    update public.client_compliance_profiles
    set status = 'active',
        approved_by = (select auth.uid()),
        approved_at = now()
    where id = v_profile.id
    returning * into v_new;

    -- IMP-050 (AUTO-REC-01a): immediate current-period materialization.
    -- The horizon is the Asia/Kolkata business date, so exactly the
    -- current period is eligible. Generation is idempotent (AUTO-REC-03)
    -- and its instances/audit/publication rows share the originating
    -- request's correlation when one exists (AUD-CTX-02), else ONE
    -- server-side identity minted for this immediate chain (AUTO-ENV-01,
    -- AUD-INV-06) — never an unrelated fresh UUID.
    begin
      perform public.generate_profile_instances(
        v_new.id,
        (now() at time zone 'Asia/Kolkata')::date,
        public.immediate_automation_correlation());
    exception when others then
      v_reason := format('recurrence materialization failed: %s', SQLERRM);
      raise exception '%', v_reason using errcode = 'CA402';
    end;

    -- Authoritative Layer-B audit event, same transaction (unchanged).
    perform public.audit_write(
      v_new.firm_id, 'human', (select auth.uid()),
      'compliance_profile.approve',
      'compliance_profile', v_new.id::text,
      to_jsonb(v_profile), to_jsonb(v_new));

    return jsonb_build_object('status', 'approved', 'profile', to_jsonb(v_new));
  exception
    when sqlstate 'CA401' or sqlstate 'CA402' then
      if (select auth.uid()) is not null then
        perform public.audit_write(
          v_profile.firm_id, 'human', (select auth.uid()),
          'compliance_profile.approval_denied',
          'compliance_profile', p_profile_id::text,
          null, jsonb_build_object('reason', v_reason));
      end if;
      return jsonb_build_object(
        'status', 'denied',
        'kind', case
                  when (select auth.uid()) is null then 'unauthenticated'
                  when sqlstate = 'CA401' then 'unauthorized'
                  else 'conflict'
                end,
        'message', v_reason);
  end;
end;
$$;

comment on function public.approve_client_compliance_profile(uuid) is
  'IMP-031 Layer-B approval command (API-R0-CCP), amended by IMP-050 (AUTO-REC-01a): proposed -> active with approved_by/approved_at stamps AND immediate current-period materialization (idempotent; no governing ACTIVE rule version = zero instances, C5 remains valid; invalid rule configuration fails the approval as a conflict, atomically). Immediate materialization propagates the originating request correlation when one exists (AUD-CTX-02), else mints one server-side identity for the immediate automation chain (AUTO-ENV-01, AUD-INV-06, AUTO-AUD-02). Authorization-FIRST not_found uniformity, denial audit, and no-AAL2 posture unchanged (API-ERR-02, AUD-FAIL-01, RLS-AAL-02).';

revoke all on function public.approve_client_compliance_profile(uuid) from public, anon, service_role;
grant execute on function public.approve_client_compliance_profile(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- IMP-031 command amendment (AUTO-REC-01 trigger point b): reaching
-- 'closed' materializes the successor instance immediately, linked via
-- successor_instance_id (composite same-firm self-FK, Ruling R7), copying
-- assignee/reviewer/partner (PRD §29, DM-12). Idempotent against
-- look-ahead rows (AUTO-REC-03/08). All IMP-031 legality, four-eyes,
-- authorization-first, and replay semantics are unchanged.
-- ---------------------------------------------------------------------------
create or replace function public.transition_compliance_instance(
  p_instance_id uuid,
  p_to_state text,
  p_mutation_key text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  -- Canonical DM-SM-04 pipeline order — the legality baseline. Workflow
  -- templates may only SKIP states, never reorder them.
  c_pipeline constant text[] := array[
    'not_started', 'information_requested', 'information_received',
    'preparation', 'internal_review', 'client_approval',
    'ready_to_file', 'filed', 'acknowledgement_received', 'closed'];
  v_inst public.compliance_instances;
  v_new public.compliance_instances;
  v_type public.compliance_types;
  v_template text[];
  v_role text;
  v_membership uuid;
  v_reason text;
  v_from_idx int;
  v_to_idx int;
  v_regression boolean;
  v_legal boolean;
  v_in_scope boolean;
begin
  perform pg_catalog.set_config('app.cin_transition_command', '1', true);
  perform pg_catalog.set_config('app.audit_skip_trigger', '1', true);

  begin
    if (select auth.uid()) is null then
      raise exception 'authentication required' using errcode = 'CA401';
    end if;

    select * into v_inst
    from public.compliance_instances i
    where i.id = p_instance_id
    for update;
    if not found then
      return jsonb_build_object(
        'status', 'denied', 'kind', 'not_found',
        'message', 'compliance instance not found');
    end if;

    -- AUTHORIZATION FIRST (API-ERR-02): unchanged from IMP-031.
    v_role := public.active_membership_role(v_inst.firm_id);
    v_membership := public.active_membership_id(v_inst.firm_id);

    if v_role in ('super_admin', 'partner') then
      v_in_scope := true;
    elsif v_role = 'manager' then
      v_in_scope := exists (
        select 1 from public.clients c
        where c.firm_id = v_inst.firm_id
          and c.id = v_inst.client_id
          and c.manager_membership_id = v_membership
      );
    elsif v_role in ('senior', 'article_executive') then
      -- NULL-safe (three-valued logic): coalesce forces unknown -> denied.
      v_in_scope := coalesce(
        v_membership in (v_inst.assignee_membership_id, v_inst.reviewer_membership_id),
        false);
    else
      v_in_scope := false;
    end if;

    if public.req_active_firm() is distinct from v_inst.firm_id
       or v_role is null
       or not v_in_scope then
      perform public.audit_write(
        v_inst.firm_id, 'human', (select auth.uid()),
        'compliance_instance.transition_denied',
        'compliance_instance', p_instance_id::text,
        null, jsonb_build_object(
          'reason', 'instance not visible to caller (API-ERR-02)',
          'to_state', p_to_state));
      return jsonb_build_object(
        'status', 'denied', 'kind', 'not_found',
        'message', 'compliance instance not found');
    end if;

    select * into v_type
    from public.compliance_types c
    where c.id = v_inst.compliance_type_id;
    if not found then
      raise exception 'compliance type of instance % is missing', p_instance_id
        using errcode = 'P0001';
    end if;

    v_to_idx := array_position(c_pipeline, p_to_state);
    if v_to_idx is null then
      v_reason := format('unknown target state %L (DM-SM-04 vocabulary)', p_to_state);
      raise exception '%', v_reason using errcode = 'CA400';
    end if;
    v_from_idx := array_position(c_pipeline, v_inst.state);

    if v_inst.state = p_to_state then
      if p_mutation_key is not null then
        return jsonb_build_object(
          'status', 'already_applied',
          'reason', 'already_in_target_state',
          'instance', to_jsonb(v_inst));
      end if;
      v_reason := format('instance is already in state %s', p_to_state);
      raise exception '%', v_reason using errcode = 'CA402';
    end if;

    -- Legality (DM-SM-04): unchanged from IMP-031.
    select coalesce(array_agg(s.state), '{}') into v_template
    from jsonb_array_elements_text(v_type.workflow_template -> 'states') as s(state);

    v_regression := v_inst.state = 'internal_review' and p_to_state = 'preparation';
    v_legal := v_regression or (
      p_to_state = any(v_template)
      and v_to_idx > v_from_idx
      and not exists (
        select 1
        from unnest(v_template) as s(state)
        where array_position(c_pipeline, s.state) > v_from_idx
          and array_position(c_pipeline, s.state) < v_to_idx
      )
    );
    if not v_legal then
      v_reason := format(
        'invalid state transition %s -> %s for this compliance type''s workflow (DM-SM-04)',
        v_inst.state, p_to_state);
      raise exception '%', v_reason using errcode = 'CA402';
    end if;

    -- Four-eyes overlay (RLS-4EY-01/02): unchanged from IMP-031.
    if v_type.four_eyes_required
       and v_inst.state = 'internal_review'
       and not v_regression
       and (v_inst.reviewer_membership_id is null
            or v_membership is distinct from v_inst.reviewer_membership_id) then
      v_reason := 'a transition leaving internal_review must be performed by the assigned reviewer (RLS-4EY-01/02)';
      raise exception '%', v_reason using errcode = 'CA401';
    end if;

    -- Regression initiator: unchanged from IMP-031.
    if v_regression
       and v_role in ('senior', 'article_executive')
       and v_membership is distinct from v_inst.reviewer_membership_id then
      v_reason := 'regression to preparation requires the assigned reviewer or an in-scope manager+ actor (DM-SM-04)';
      raise exception '%', v_reason using errcode = 'CA401';
    end if;

    update public.compliance_instances
    set state = p_to_state,
        filed_at = case when p_to_state = 'filed' then now() else filed_at end,
        closed_at = case when p_to_state = 'closed' then now() else closed_at end
    where id = v_inst.id
    returning * into v_new;

    -- IMP-050 (AUTO-REC-01b): closure materializes the successor
    -- immediately and links it (successor_instance_id). Generation
    -- failures are configuration errors and fail the transition
    -- atomically (conflict); instances without a recurrence basis (no
    -- active profile, event/custom frequency, no governing version for
    -- the successor period) spawn nothing and close normally. The
    -- successor's audit/publication rows share the originating request's
    -- correlation when one exists (AUD-CTX-02), else one minted
    -- server-side identity for this immediate chain (AUTO-ENV-01,
    -- AUD-INV-06).
    if p_to_state = 'closed' then
      begin
        perform public.generate_successor_instance(
          v_new.id, public.immediate_automation_correlation());
      exception when others then
        v_reason := format('successor materialization failed: %s', SQLERRM);
        raise exception '%', v_reason using errcode = 'CA402';
      end;
      -- Re-read so the audit/return payload carries the successor link.
      select * into v_new from public.compliance_instances i where i.id = v_new.id;
    end if;

    -- Authoritative Layer-B audit event (old/new rows; the mutation key
    -- rides along under a reserved meta key for traceability).
    perform public.audit_write(
      v_new.firm_id, 'human', (select auth.uid()),
      'compliance_instance.transition',
      'compliance_instance', v_new.id::text,
      to_jsonb(v_inst),
      to_jsonb(v_new) || case
        when p_mutation_key is not null
          then jsonb_build_object('_mutation_key', p_mutation_key)
        else '{}'::jsonb
      end);

    return jsonb_build_object(
      'status', 'transitioned',
      'from_state', v_inst.state,
      'to_state', v_new.state,
      'instance', to_jsonb(v_new));
  exception
    -- Malformed input: client error, not a security-significant denial.
    when sqlstate 'CA400' then
      return jsonb_build_object('status', 'denied', 'kind', 'validation', 'message', v_reason);
    -- Deliberate denials: audit the attempt (AUD-FAIL-01), return
    -- structured denial. Everything else propagates fail-closed.
    when sqlstate 'CA401' or sqlstate 'CA402' then
      if (select auth.uid()) is not null then
        perform public.audit_write(
          v_inst.firm_id, 'human', (select auth.uid()),
          'compliance_instance.transition_denied',
          'compliance_instance', p_instance_id::text,
          null, jsonb_build_object(
            'reason', v_reason,
            'from_state', v_inst.state,
            'to_state', p_to_state));
      end if;
      return jsonb_build_object(
        'status', 'denied',
        'kind', case
                  when (select auth.uid()) is null then 'unauthenticated'
                  when sqlstate = 'CA401' then 'unauthorized'
                  else 'conflict'
                end,
        'message', v_reason);
  end;
end;
$$;

comment on function public.transition_compliance_instance(uuid, text, text) is
  'IMP-031 Layer-B transition command (API-R0-CIN), amended by IMP-050 (AUTO-REC-01b): the ONLY state-change path (RLS-CIN-01); on reaching closed, the successor instance is materialized immediately and linked via successor_instance_id (composite same-firm self-FK, Ruling R7), copying assignee/reviewer/partner (PRD §29); idempotent against look-ahead rows; successor-generation configuration errors fail the transition atomically (conflict). Immediate successor materialization propagates the originating request correlation when one exists (AUD-CTX-02), else mints one server-side identity for the immediate automation chain (AUTO-ENV-01, AUD-INV-06, AUTO-AUD-02). Authorization-first not_found uniformity, DM-SM-04 legality, four-eyes reviewer gate, mutation-key replay, and denial audit unchanged.';

revoke all on function public.transition_compliance_instance(uuid, text, text) from public, anon, service_role;
grant execute on function public.transition_compliance_instance(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Cron registration at migration time (AUTO-SCH-06): deterministic local
-- reset/build. Hosted staging execution of THIS migration remains a
-- separate explicit human state-change gate (Ruling R6).
-- ---------------------------------------------------------------------------
select public.register_scheduler_jobs();

-- ---------------------------------------------------------------------------
-- Notes for reviewers
--
-- * SCH-12 amendment: the plain IMP-031 successor self-FK is replaced by
--   the composite same-firm self-FK (Ruling R7). Nullable successor
--   semantics and the cin_obligation_period_unique NULLS NOT DISTINCT key
--   are unchanged. The successor column remains browser-unwritable
--   (column-pinned grant exclusion from IMP-031); generator/command
--   definer contexts write it.
-- * RLS posture (Ruling R8): event_outbox + scheduler_dead_letters RLS
--   enabled AND forced; scheduler_job_runs enabled NOT forced
--   (system-scoped); all three revoke all from anon/authenticated/
--   service_role (server writes run as the definer owner) and define ZERO
--   policies — the 51-policy count is unchanged. No permissive browser
--   policy is created to satisfy counts.
-- * No Layer-A audit trigger is attached to SCH-33/34/35 (the publication
--   record itself is not audit, SCH-33); automation audit lands in
--   audit_log via explicit audit_write with system/service actors.
-- * BYPASSRLS cron context (AUTO-SCH-03): evaluate_recurrence iterates
--   firms/profiles explicitly and writes are firm-scoped by construction;
--   cross-firm structural backstops are the composite FKs; TEST-AUTO-08
--   verifies Firm A/B isolation directly on the scheduler path.
-- * The eight deferred catalogue events publish via AFTER row triggers
--   (additive; prior Layer-B commands untouched); the R0 production
--   consumer set is empty (AUTO-FLOW-05), so delivery is a drain-
--   completion record. TEST-AUTO-05/06 register harness-only consumers
--   through the outbox_consumer_<event_type>(uuid) discovery point and
--   tear them down completely.
