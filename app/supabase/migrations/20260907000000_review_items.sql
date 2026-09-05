-- IMP-041 PASS A — Review queue: review_items schema + database invariants
-- (SCH-17 — review queue with real persistence, DM-21; DM-SM-06 lifecycle
-- vocabulary + terminal-decision fields)
--
-- Implements exactly the one table owned by this pass:
--   public.review_items (SCH-17 — a unit of work awaiting reviewer decision,
--                        client-subject with optional task / compliance-
--                        instance links, human-sourced in R0)
--
-- Requirement IDs: DM-15 (review remarks land in SCH-16 task_comments —
-- no review-history table), DM-21, DM-SM-06 (vocabulary + decision facts),
-- SCH-17, SCH-FK-01/02 (composite same-firm FKs), SCH-RESP-01/03
-- (responsibility membership references), SCH-RESP-02 contrast (no bare
-- auth.users responsibility FKs), RLS-PRIN-01/02 (RLS enabled AND forced).
-- Test IDs served: TEST-SCH-21…25 (schema-focused; see
-- tests/integration/schema/review-items.test.ts).
--
-- PASS layout: this migration is PASS A ONLY — physical schema, declarative
-- invariants, the subject-binding write guard, structural RLS (enabled AND
-- FORCED, zero policies, browser grants stripped). PASS B (separately
-- authorized) owns: the substantive RLS-RVW-01 role policies, the controlled
-- Layer-B commands submit_review_item / decide_review_item (API-R0-RVW),
-- RLS-4EY-04 decision authorization, the task-linked `returned` composition
-- (DM-SM-06), Layer-A/B audit wiring (TEST-AUD-03/12), and the @/data
-- adapter / UI / TEST-E2E-08.
--
-- Explicitly NOT here (package non-goals — do not read their absence as an
-- oversight):
--   * ai_outputs (SCH-27) and any FK to it — deferred; ai_output_id is
--     reserved nullable provenance only (SCH-17).
--   * Automatic escalation routing — `escalated` is terminal in R0
--     (DM-SM-06, R0 closure 2026-09-05).
--   * Event publication (review.submitted / review.completed — contract
--     names only; the AUTO-OQ-02 mechanism is IMP-050).
--
-- Trust model (unchanged from IMP-012/013/020/021/030/031/040): RLS is never
-- the integrity boundary — cross-firm references are impossible at the
-- constraint layer via composite (firm_id, x_id) FKs; the subject-binding
-- invariant below is enforced by a trigger that holds for EVERY writer,
-- owner included. With zero policies and zero browser grants the table is
-- fail-closed for every application role until PASS B.

-- ---------------------------------------------------------------------------
-- SCH-17 — review_items
-- A unit of work awaiting reviewer decision (DM-21, PRD §46/§48–50/§62).
-- Always belongs to a CLIENT (the authoritative subject); usually linked to
-- a task and/or a compliance instance. Unlike SCH-13 tasks (where client_id
-- is server-DERIVED from the linked instance), review_items REJECTS a
-- divergent subject: a review row is an audit-sensitive accountability
-- record, so a forged/mismatching client_id must fail the write, never be
-- silently normalized (SCH-17 subject binding, TEST-SCH-25).
-- ---------------------------------------------------------------------------
create table public.review_items (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null,
  client_id uuid not null,
  task_id uuid,
  compliance_instance_id uuid,
  -- R0 type vocabulary frozen (API-OQ-01 = SCH-OQ-02 RESOLVED 2026-09-05):
  -- stable machine keys; display labels are presentation metadata.
  type text not null,
  -- R0 AI posture: application submissions are human-sourced; 'ai' is a
  -- reserved vocabulary value only (AI-originated submission deferred).
  source text not null default 'human',
  title text not null,
  note text,
  status text not null default 'pending',
  priority text not null default 'normal',
  submitted_by_membership_id uuid not null,
  submitted_at timestamptz not null default now(),
  decided_by_membership_id uuid,
  decided_at timestamptz,
  decision_rationale text,
  -- Reserved nullable provenance ONLY — NO FK ships in R0 because ai_outputs
  -- (SCH-27) is deferred; the FK is added when SCH-27/AIOutput ships.
  ai_output_id uuid,
  sla_due_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  constraint review_items_type_check
    check (type in ('gst_reconciliation', 'tds_return', 'itr_computation',
                    'financial_statements', 'audit_workpaper')),
  constraint review_items_source_check
    check (source in ('human', 'ai')),
  -- DM-SM-06 vocabulary (exactly these five states; pending → terminal only,
  -- no decision from a terminal state). Transition LEGALITY and
  -- authorization are not CHECKs: all status movement is
  -- decide_review_item-owned (PASS B, API-ARCH-04).
  constraint review_items_status_check
    check (status in ('pending', 'approved', 'returned', 'escalated',
                      'dismissed')),
  -- R0 source/AI invariant (SCH-17, TEST-SCH-23): human rows never carry AI
  -- provenance. The reverse is deliberately unconstrained in R0 — the
  -- submission path accepts only source='human' (PASS-B command), so no
  -- legitimate 'ai' row exists yet to constrain.
  constraint review_items_human_source_no_ai_output_check
    check (source <> 'human' or ai_output_id is null),
  -- DM-SM-06 terminal-decision fields (TEST-SCH-24): every terminal decision
  -- carries decider + timestamp + non-empty rationale, atomically; a pending
  -- row carries NO decision facts (it cannot masquerade as decided). A
  -- rationale must contain at least one non-whitespace character — blank,
  -- space-only, and tab/newline-only text is not a rationale (stricter than
  -- the plain-btrim command convention because the CHECK is the last-line
  -- backstop for an audit-sensitive fact). No reopen semantics exist in R0
  -- — nothing here permits one either.
  constraint review_items_decision_fields_check
    check (
      (status = 'pending'
        and decided_by_membership_id is null
        and decided_at is null
        and decision_rationale is null)
      or
      (status in ('approved', 'returned', 'escalated', 'dismissed')
        and decided_by_membership_id is not null
        and decided_at is not null
        and decision_rationale is not null
        and decision_rationale ~ '[^ \t\n\r]')
    ),
  -- SCH-17 / RLS-4EY-04 schema backstop: decider ≠ submitter on every human
  -- R0 decision, no privileged-rank bypass. The AUTHORITATIVE enforcement is
  -- the PASS-B decide_review_item command (live-membership comparison,
  -- denial audit); this row-level CHECK makes the invariant hold for every
  -- writer, including operator/service paths.
  constraint review_items_four_eyes_check
    check (decided_by_membership_id is null
           or decided_by_membership_id <> submitted_by_membership_id),
  constraint review_items_firm_fkey
    foreign key (firm_id) references public.firms (id) on delete restrict,
  -- SCH-FK-01/02: composite same-firm FKs — cross-firm references are
  -- invalid at the constraint layer, not merely forbidden by RLS.
  constraint review_items_client_fkey
    foreign key (firm_id, client_id)
    references public.clients (firm_id, id) on delete restrict,
  constraint review_items_task_fkey
    foreign key (firm_id, task_id)
    references public.tasks (firm_id, id) on delete restrict,
  constraint review_items_instance_fkey
    foreign key (firm_id, compliance_instance_id)
    references public.compliance_instances (firm_id, id) on delete restrict,
  -- SCH-RESP-01/03: submission and decision are tenant operational
  -- RESPONSIBILITY relationships — composite membership FKs, same-firm
  -- proven at the constraint layer; never bare auth.users ids.
  constraint review_items_submitted_by_fkey
    foreign key (firm_id, submitted_by_membership_id)
    references public.firm_memberships (firm_id, id) on delete restrict,
  constraint review_items_decided_by_fkey
    foreign key (firm_id, decided_by_membership_id)
    references public.firm_memberships (firm_id, id) on delete restrict
);

comment on table public.review_items is 'SCH-17: review queue with real persistence (DM-21). Client-subject with optional same-firm task/compliance-instance links; subject binding enforced by the write guard (TEST-SCH-25) — mismatches are REJECTED, never normalized. DM-SM-06: pending -> approved/returned/escalated/dismissed; terminal decisions carry decider + decided_at + non-empty rationale (CHECK); decider <> submitter (RLS-4EY-04 backstop). R0 rows are human-sourced; ai_output_id is reserved nullable provenance with NO FK (SCH-27 deferred). RLS enabled AND FORCED with zero policies — fail-closed until the PASS-B RLS-RVW-01 policies and submit/decide commands land.';

-- SCH-17 indexes: the reviewer queue and the submitter/status lookup.
create index review_items_queue_idx on public.review_items (firm_id, status, priority);
create index review_items_submitter_idx on public.review_items (firm_id, submitted_by_membership_id, status);

-- ---------------------------------------------------------------------------
-- Subject-binding write guard — review_items (BEFORE INSERT/UPDATE).
-- Mirrors the IMP-040 SCH-13 pattern (DEFINER guard beneath the composite
-- FKs, enforcement independent of caller RLS visibility under FORCE RLS),
-- with the SCH-17 semantic difference: subjects are VALIDATED, not derived.
--   (a) task_id non-null               => client_id must equal the linked
--                                        task's authoritative client_id;
--   (b) compliance_instance_id non-null => client_id must equal the linked
--                                        instance's authoritative client_id;
--   (c) both non-null                  => the linked task must reference
--                                        EXACTLY that instance — a
--                                        same-client/different-instance
--                                        combination is rejected;
--   (d) both null                      => client_id (NOT NULL + composite FK)
--                                        is the authoritative ad-hoc subject.
-- Mismatches raise 23514 (check_violation) — rejected input, mapping to
-- `validation` under the API-ERR-01 resolved interpretation; deliberately NO
-- conflict-marker detail (this is not an immutability/transition conflict).
-- Identity fields (id, firm_id, created_at) are insert-only
-- (IMMUTABLE_FIELD: marker → conflict, tasks precedent).
-- Enforcement point is the review_items write itself; the composite FKs pin
-- every reference same-firm. DEFINER so the task/instance reads never depend
-- on the DML caller's RLS visibility under FORCE RLS (IMP-030/031/040
-- precedent).
-- ---------------------------------------------------------------------------
create or replace function public.review_items_guard_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task_client uuid;
  v_task_instance uuid;
  v_instance_client uuid;
begin
  if TG_OP = 'UPDATE' then
    if new.id is distinct from old.id
       or new.firm_id is distinct from old.firm_id
       or new.created_at is distinct from old.created_at then
      raise exception 'review item identity is insert-only (SCH-17)'
        using errcode = '23514', detail = 'IMMUTABLE_FIELD:review_items.identity';
    end if;
  end if;

  if new.task_id is not null then
    select t.client_id, t.compliance_instance_id
      into v_task_client, v_task_instance
    from public.tasks t
    where t.firm_id = new.firm_id and t.id = new.task_id;
    if not found then
      -- Unreachable via the composite FK; fail closed rather than skip
      -- subject validation.
      raise exception 'task_id does not exist in this firm' using errcode = '23503';
    end if;
    if v_task_client <> new.client_id then
      raise exception 'review_items.client_id must equal the linked task client (SCH-17 subject binding)'
        using errcode = '23514';
    end if;
  end if;

  if new.compliance_instance_id is not null then
    select ci.client_id into v_instance_client
    from public.compliance_instances ci
    where ci.firm_id = new.firm_id and ci.id = new.compliance_instance_id;
    if not found then
      -- Unreachable via the composite FK; fail closed.
      raise exception 'compliance_instance_id does not exist in this firm' using errcode = '23503';
    end if;
    if v_instance_client <> new.client_id then
      raise exception 'review_items.client_id must equal the linked compliance instance client (SCH-17 subject binding)'
        using errcode = '23514';
    end if;
  end if;

  if new.task_id is not null and new.compliance_instance_id is not null
     and v_task_instance is distinct from new.compliance_instance_id then
    raise exception 'the linked task must belong to the linked compliance instance (SCH-17 subject binding)'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

comment on function public.review_items_guard_write() is
  'IMP-041 PASS A SCH-17 write guard: subject binding validated on every review_items write (task client / instance client / task-instance exactness — mismatches REJECTED, never normalized); identity insert-only. DEFINER so enforcement never depends on caller RLS visibility. DM-SM-06 transition legality and decision authorization are PASS-B decide_review_item scope.';

revoke all on function public.review_items_guard_write() from public, anon, authenticated, service_role;

create trigger review_items_guard_write
  before insert or update on public.review_items
  for each row execute function public.review_items_guard_write();

-- ---------------------------------------------------------------------------
-- updated_at maintenance (schema convention; NOT audit).
-- ---------------------------------------------------------------------------
create trigger review_items_set_updated_at
  before update on public.review_items
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS posture (RLS-PRIN-01/02): enabled AND FORCED on the tenant-owned
-- content table. NO policies and NO browser grants exist in PASS A — the
-- table is fail-closed for anon/authenticated until PASS B adds the
-- substantive RLS-RVW-01 role policies and the controlled commands.
-- ---------------------------------------------------------------------------
alter table public.review_items enable row level security;
alter table public.review_items force row level security;

-- ---------------------------------------------------------------------------
-- Grants: strip the Supabase default privileges from the browser roles.
-- anon gets nothing, ever; service_role retains its default ALL (server-only
-- paths, RLS-SVC-01/02 — the same posture IMP-020/021/030/031/040 left in
-- place). Hard-delete posture for this HIGH-audit-sensitivity table is
-- carried by the grant/policy surface: no browser DELETE exists, and PASS B
-- adds no delete policy (decision rows are accountability records).
-- ---------------------------------------------------------------------------
revoke all on public.review_items from anon, authenticated;

-- ===========================================================================
-- IMP-041 PASS B — production RLS (RLS-RVW-01), controlled Layer-B commands
-- submit_review_item / decide_review_item (API-R0-RVW, API-ARCH-04),
-- ReviewItem four-eyes (RLS-4EY-04), the task-linked returned composition
-- (DM-SM-06, RLS-TSK-01 + RLS-4EY-03 reuse via transition_task), mutation-key
-- idempotency (API-MUT-03), and Layer-A/B audit integration (spec 08 §7c,
-- AUD-CAT-01, AUD-CTX-01/05, AUD-FAIL-01, AUD-VAL-01).
-- Test IDs served: TEST-RLS-RVW-01…16, TEST-API-11…15, TEST-AUD-12.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Write guard — review_items (PASS-B extension of the PASS-A guard).
-- Adds, on top of subject binding and insert-only identity:
--   * status changes ONLY under the transaction-local
--     app.review_decision_command marker set by decide_review_item()
--     (RLS-RVW-01: status is never directly browser-writable; the absent
--     UPDATE grant is the primary control, this guard is the second layer
--     for every writer, service paths included — tasks precedent).
--     INVALID_TRANSITION: -> conflict (API-ERR-04).
--   * decision fields (decided_by_membership_id, decided_at,
--     decision_rationale) are command-stamped only — same marker.
--     IMMUTABLE_FIELD: -> conflict.
--   * submission provenance (submitted_by_membership_id, submitted_at) is
--     insert-only: no approved R0 flow rewrites who/when submitted on a
--     HIGH-audit-sensitivity record. IMMUTABLE_FIELD: -> conflict.
-- ---------------------------------------------------------------------------
create or replace function public.review_items_guard_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- coalesce: an unset GUC yields NULL and `not NULL` would silently skip
  -- the guard (three-valued logic) — the flag must be exactly '1'.
  v_command boolean := coalesce(current_setting('app.review_decision_command', true), '') = '1';
  v_task_client uuid;
  v_task_instance uuid;
  v_instance_client uuid;
begin
  if TG_OP = 'UPDATE' then
    if new.id is distinct from old.id
       or new.firm_id is distinct from old.firm_id
       or new.created_at is distinct from old.created_at then
      raise exception 'review item identity is insert-only (SCH-17)'
        using errcode = '23514', detail = 'IMMUTABLE_FIELD:review_items.identity';
    end if;

    if new.submitted_by_membership_id is distinct from old.submitted_by_membership_id
       or new.submitted_at is distinct from old.submitted_at then
      raise exception 'review item submission provenance is insert-only (SCH-17)'
        using errcode = '23514', detail = 'IMMUTABLE_FIELD:review_items.submission';
    end if;

    if new.status is distinct from old.status and not v_command then
      raise exception 'review_items.status changes only through decide_review_item() (RLS-RVW-01, DM-SM-06)'
        using errcode = '23514', detail = 'INVALID_TRANSITION:review_items.status';
    end if;

    if (new.decided_by_membership_id is distinct from old.decided_by_membership_id
        or new.decided_at is distinct from old.decided_at
        or new.decision_rationale is distinct from old.decision_rationale)
       and not v_command then
      raise exception 'decision fields are stamped by decide_review_item() only (DM-SM-06, SCH-17)'
        using errcode = '23514', detail = 'IMMUTABLE_FIELD:review_items.decision_fields';
    end if;
  end if;

  if new.task_id is not null then
    select t.client_id, t.compliance_instance_id
      into v_task_client, v_task_instance
    from public.tasks t
    where t.firm_id = new.firm_id and t.id = new.task_id;
    if not found then
      -- Unreachable via the composite FK; fail closed rather than skip
      -- subject validation.
      raise exception 'task_id does not exist in this firm' using errcode = '23503';
    end if;
    if v_task_client <> new.client_id then
      raise exception 'review_items.client_id must equal the linked task client (SCH-17 subject binding)'
        using errcode = '23514';
    end if;
  end if;

  if new.compliance_instance_id is not null then
    select ci.client_id into v_instance_client
    from public.compliance_instances ci
    where ci.firm_id = new.firm_id and ci.id = new.compliance_instance_id;
    if not found then
      -- Unreachable via the composite FK; fail closed.
      raise exception 'compliance_instance_id does not exist in this firm' using errcode = '23503';
    end if;
    if v_instance_client <> new.client_id then
      raise exception 'review_items.client_id must equal the linked compliance instance client (SCH-17 subject binding)'
        using errcode = '23514';
    end if;
  end if;

  if new.task_id is not null and new.compliance_instance_id is not null
     and v_task_instance is distinct from new.compliance_instance_id then
    raise exception 'the linked task must belong to the linked compliance instance (SCH-17 subject binding)'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

comment on function public.review_items_guard_write() is
  'IMP-041 SCH-17 write guard (PASS-B extension): subject binding validated on every write; identity AND submission provenance insert-only; status and decision fields move only under the transaction-local app.review_decision_command marker set by decide_review_item() (INVALID_TRANSITION:/IMMUTABLE_FIELD: markers -> conflict). DEFINER so enforcement never depends on caller RLS visibility under FORCE RLS.';

-- ---------------------------------------------------------------------------
-- RLS policy — review_items SELECT (RLS-RVW-01 read scope).
-- All keyed off the LIVE firm_memberships lookup (DEC-J helpers — never JWT
-- claims): suspended/removed memberships lose access on the next statement
-- with the same JWT (RLS-STF-07); x-active-firm is an untrusted selector
-- (RLS-CTX-02). Three-valued-logic rule observed: a NULL caller membership
-- makes every comparison NULL -> not true -> denied.
--   super_admin/partner — firm-wide queue + detail;
--   manager             — portfolio (the item client's designated manager is
--                         the caller's live membership, RLS-STF-03) OR the
--                         linked task's current assignee/reviewer is the
--                         caller's live membership (RLS-TSK-01 scope); NO
--                         team hierarchy, NO subordinate traversal (05 §11
--                         note ‡);
--   senior/article      — own submissions only (RLS-RVW-01);
--   billing             — none (RLS-STF-05); anon — no policy (RLS-SVC-03);
--   client portal       — never readable (RLS-POR-03; no portal rows in R0).
-- The linked-task EXISTS runs under the caller's OWN tasks RLS, which for a
-- manager already resolves to exactly portfolio + directly-assigned — the
-- predicate can never widen past the caller's task visibility and never
-- recurses (no tasks policy references review_items). Subject binding (PASS
-- A) guarantees the linked task/client/instance is never a foreign or
-- inconsistent subject, so no predicate can leak a cross-tenant subject.
-- ---------------------------------------------------------------------------
create policy review_items_select_scoped on public.review_items
  for select to authenticated
  using (
    firm_id = public.req_active_firm()
    and (
      public.active_membership_role(firm_id) in ('super_admin', 'partner')
      or (
        public.active_membership_role(firm_id) = 'manager'
        and (
          exists (
            select 1 from public.clients c
            where c.firm_id = review_items.firm_id
              and c.id = review_items.client_id
              and c.manager_membership_id = public.active_membership_id(review_items.firm_id)
          )
          or exists (
            select 1 from public.tasks t
            where t.firm_id = review_items.firm_id
              and t.id = review_items.task_id
              and public.active_membership_id(review_items.firm_id)
                    in (t.assignee_membership_id, t.reviewer_membership_id)
          )
        )
      )
      or (
        public.active_membership_role(firm_id) in ('senior', 'article_executive')
        and review_items.submitted_by_membership_id = public.active_membership_id(firm_id)
      )
    )
  );

comment on policy review_items_select_scoped on public.review_items is
  'RLS-RVW-01 read scope: super_admin/partner firm-wide; manager portfolio (RLS-STF-03) OR linked-task assignee/reviewer (RLS-TSK-01); senior/article own submissions only; billing/anon/portal none. Live-membership (DEC-J); active-firm selector untrusted (RLS-CTX-02).';

-- ---------------------------------------------------------------------------
-- Grants (least privilege at BOTH layers — the PASS-A revokes already
-- stripped the Supabase defaults; this is the exact PASS-B matrix):
--   review_items: SELECT only. NO insert/update/delete for any browser role
--   — submission and decision exist only as the Layer-B commands below
--   (RLS-RVW-01: "Browser direct UPDATE of status and all decision fields is
--   CLOSED"; hard delete stays closed for this HIGH-audit-sensitivity table,
--   spec 06 conventions).
-- ---------------------------------------------------------------------------
grant select on public.review_items to authenticated;

-- ---------------------------------------------------------------------------
-- Layer-B command: submit_review_item(uuid, uuid, uuid, text, text, text,
-- text, timestamptz) (API-R0-RVW; RLS-RVW-01 submission scope; SCH-17).
--
-- The ONLY authoritative submission path. SECURITY DEFINER justification
-- (API-SEC-03 — exceptional, reviewed; the IMP-031/040 precedent): the table
-- carries no INSERT grant for browser roles, so no INVOKER variant can work.
-- The function performs its OWN complete authorization: actor from
-- auth.uid() (never parameters/headers), live ACTIVE same-firm membership
-- (DEC-J), active-firm selector match (RLS-CTX-02).
--
-- Server-derived, never caller-supplied: firm_id (the validated active-firm
-- context), submitted_by_membership_id (the caller's live membership),
-- submitted_at (column default now()), status ('pending'), source ('human'),
-- ai_output_id (NULL — R0 human-only). The parameter list carries no
-- decision/actor/source fields at all: supplying one is a PostgREST
-- signature mismatch, not a forgeable column (API-MUT-04).
--
-- Subject derivation (linked subject WINS, SCH-17 invariants; API-R0-RVW):
--   task_id supplied           -> the task is resolved inside the active
--                                 firm; client_id is server-DERIVED from the
--                                 task; a supplied compliance_instance_id
--                                 must be EXACTLY the task's instance
--                                 (validation otherwise); a supplied
--                                 client_id is at most a convenience
--                                 assertion — mismatch rejected
--                                 (validation);
--   else instance supplied     -> resolved in-firm; client_id derived from
--                                 the instance; same assertion rule;
--   else                       -> explicit client_id REQUIRED; resolved
--                                 in-firm; normal submission scope applies.
--
-- Role submission scope (RLS-RVW-01):
--   super_admin/partner — any client in the active firm;
--   manager             — portfolio client OR linked task currently
--                         assigned to / reviewed by the caller's live
--                         membership (instance-linked without task:
--                         portfolio only; unlinked: portfolio only);
--   senior/article      — work ALREADY inside current assigned-work scope:
--                         linked task/instance where the caller's live
--                         membership is assignee or reviewer, or (ad-hoc)
--                         a client with an existing assigned instance or
--                         assigned task (the tasks_insert_scoped predicate —
--                         NO access bootstrapping);
--   billing/anon/portal — denied; suspended/removed — denied live.
--
-- AUTHORIZATION / EXISTENCE uniformity (API-ERR-02): a foreign, nonexistent,
-- or out-of-scope subject ALL return the identical not_found body; the
-- attempt IS audited (review_item.submit_denied, AUD-FAIL-01) only when the
-- referenced subject row actually EXISTS in-firm (security-significant
-- probe); a nonexistent subject stays un-audited (no object to bind).
-- Vocabulary/mismatch rejections are CA400 validation (client errors, never
-- security-significant — un-audited, transition_task convention).
--
-- NO mutation key (API-MUT-03 names review decisions and instance/task
-- transitions, not submission). NO event publication (review.submitted is a
-- contract name only; AUTO-OQ-02 mechanism is IMP-050).
-- ---------------------------------------------------------------------------
create or replace function public.submit_review_item(
  p_client_id uuid default null,
  p_task_id uuid default null,
  p_compliance_instance_id uuid default null,
  p_type text default null,
  p_title text default null,
  p_note text default null,
  p_priority text default 'normal',
  p_sla_due_at timestamptz default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  -- SCH-17 frozen R0 type vocabulary (API-OQ-01; the CHECK is the DB layer).
  c_types constant text[] := array[
    'gst_reconciliation', 'tds_return', 'itr_computation',
    'financial_statements', 'audit_workpaper'];
  v_firm uuid;
  v_role text;
  v_membership uuid;
  v_client uuid;
  v_task public.tasks;
  v_instance public.compliance_instances;
  v_subject_exists boolean := false;
  v_in_scope boolean := false;
  v_new public.review_items;
  v_reason text;
begin
  -- Layer-B single-writer context: suppress the Layer-A row trigger so the
  -- command's own audit row is the ONE audit event (spec 08 §7c).
  perform pg_catalog.set_config('app.audit_skip_trigger', '1', true);

  begin
    if (select auth.uid()) is null then
      v_reason := 'authentication required';
      raise exception 'authentication required' using errcode = 'CA401';
    end if;

    -- Business-input validation (CA400 -> validation): no disclosure of any
    -- tenant data — the vocabulary and title shape are public knowledge.
    if p_type is null or not (p_type = any(c_types)) then
      v_reason := format('unknown review item type %L (SCH-17 R0 vocabulary, API-OQ-01)', p_type);
      raise exception '%', v_reason using errcode = 'CA400';
    end if;
    if p_title is null or btrim(p_title) = '' then
      v_reason := 'title is required (SCH-17)';
      raise exception '%', v_reason using errcode = 'CA400';
    end if;

    -- Authoritative tenant context: the untrusted selector validated against
    -- a live ACTIVE membership (RLS-CTX-02, DEC-J). Without one there is no
    -- firm to submit into — the uniform not_found surface, un-audited (no
    -- subject row can exist in a firm the caller has no membership in).
    v_firm := public.req_active_firm();
    v_role := public.active_membership_role(v_firm);
    v_membership := public.active_membership_id(v_firm);
    if v_firm is null or v_role is null then
      return jsonb_build_object(
        'status', 'denied', 'kind', 'not_found',
        'message', 'review subject not found');
    end if;

    -- Subject resolution + scope, linked-subject-wins order (API-R0-RVW).
    if p_task_id is not null then
      select * into v_task
      from public.tasks t
      where t.firm_id = v_firm and t.id = p_task_id;
      if found then
        v_subject_exists := true;
        v_client := v_task.client_id;
        if v_role in ('super_admin', 'partner') then
          v_in_scope := true;
        elsif v_role = 'manager' then
          v_in_scope := exists (
            select 1 from public.clients c
            where c.firm_id = v_firm and c.id = v_task.client_id
              and c.manager_membership_id = v_membership
          ) or coalesce(
            v_membership in (v_task.assignee_membership_id, v_task.reviewer_membership_id),
            false);
        elsif v_role in ('senior', 'article_executive') then
          v_in_scope := coalesce(
            v_membership in (v_task.assignee_membership_id, v_task.reviewer_membership_id),
            false);
        end if;
        -- Post-scope consistency checks (CA400): the task's linkage is
        -- already visible to an in-scope caller via tasks RLS, so these
        -- reveal nothing new. Instance exactness is SCH-17 invariant (c);
        -- the client assertion can never override the linked subject.
        if v_in_scope and p_compliance_instance_id is not null
           and v_task.compliance_instance_id is distinct from p_compliance_instance_id then
          v_reason := 'the linked task does not reference the supplied compliance instance (SCH-17 subject binding)';
          raise exception '%', v_reason using errcode = 'CA400';
        end if;
        if v_in_scope and p_client_id is not null
           and p_client_id is distinct from v_client then
          v_reason := 'client_id does not match the linked task subject (linked subject wins, API-R0-RVW)';
          raise exception '%', v_reason using errcode = 'CA400';
        end if;
      end if;
    elsif p_compliance_instance_id is not null then
      select * into v_instance
      from public.compliance_instances ci
      where ci.firm_id = v_firm and ci.id = p_compliance_instance_id;
      if found then
        v_subject_exists := true;
        v_client := v_instance.client_id;
        if v_role in ('super_admin', 'partner') then
          v_in_scope := true;
        elsif v_role = 'manager' then
          -- Instance-linked without a task: portfolio-only (RLS-RVW-01).
          v_in_scope := exists (
            select 1 from public.clients c
            where c.firm_id = v_firm and c.id = v_instance.client_id
              and c.manager_membership_id = v_membership);
        elsif v_role in ('senior', 'article_executive') then
          v_in_scope := coalesce(
            v_membership in (v_instance.assignee_membership_id, v_instance.reviewer_membership_id),
            false);
        end if;
        if v_in_scope and p_client_id is not null
           and p_client_id is distinct from v_client then
          v_reason := 'client_id does not match the linked compliance instance subject (linked subject wins, API-R0-RVW)';
          raise exception '%', v_reason using errcode = 'CA400';
        end if;
      end if;
    else
      if p_client_id is null then
        v_reason := 'client_id is required for an ad-hoc review item (SCH-17 subject)';
        raise exception '%', v_reason using errcode = 'CA400';
      end if;
      if exists (
        select 1 from public.clients c
        where c.firm_id = v_firm and c.id = p_client_id) then
        v_subject_exists := true;
        v_client := p_client_id;
        if v_role in ('super_admin', 'partner') then
          v_in_scope := true;
        elsif v_role = 'manager' then
          v_in_scope := exists (
            select 1 from public.clients c
            where c.firm_id = v_firm and c.id = p_client_id
              and c.manager_membership_id = v_membership);
        elsif v_role in ('senior', 'article_executive') then
          -- Already-authorized assigned-work scope only: an existing
          -- assigned instance OR an existing assigned task of this client
          -- (the tasks_insert_scoped predicate). Submission can NEVER
          -- bootstrap access to an otherwise invisible client.
          v_in_scope := exists (
            select 1 from public.compliance_instances i
            where i.firm_id = v_firm and i.client_id = p_client_id
              and v_membership in (i.assignee_membership_id, i.reviewer_membership_id)
          ) or public.task_client_in_assigned_scope(v_firm, p_client_id);
        end if;
      end if;
    end if;

    if not v_subject_exists then
      -- Nonexistent/foreign subject: uniform not_found, un-audited (no
      -- object to bind the event to — IMP-030/031/040 precedent).
      return jsonb_build_object(
        'status', 'denied', 'kind', 'not_found',
        'message', 'review subject not found');
    end if;

    if not v_in_scope then
      -- The subject EXISTS in-firm but is outside the caller's scope: a
      -- security-significant probe — audited (AUD-FAIL-01), still the
      -- identical caller surface.
      perform public.audit_write(
        v_firm, 'human', (select auth.uid()),
        'review_item.submit_denied',
        'review_item', null,
        null, jsonb_build_object(
          'reason', 'review subject not visible to caller (API-ERR-02)',
          'client_id', p_client_id,
          'task_id', p_task_id,
          'compliance_instance_id', p_compliance_instance_id,
          'type', p_type));
      return jsonb_build_object(
        'status', 'denied', 'kind', 'not_found',
        'message', 'review subject not found');
    end if;

    insert into public.review_items (
      firm_id, client_id, task_id, compliance_instance_id,
      type, title, note, priority, sla_due_at,
      submitted_by_membership_id
    ) values (
      v_firm, v_client, p_task_id, p_compliance_instance_id,
      p_type, btrim(p_title), p_note, coalesce(p_priority, 'normal'), p_sla_due_at,
      v_membership
    ) returning * into v_new;

    -- Authoritative Layer-B audit event, same transaction (AUD-CTX-01/05;
    -- the Layer-A trigger is skipped via app.audit_skip_trigger).
    perform public.audit_write(
      v_new.firm_id, 'human', (select auth.uid()),
      'review_item.submitted',
      'review_item', v_new.id::text,
      null, to_jsonb(v_new));

    return jsonb_build_object(
      'status', 'submitted',
      'item', to_jsonb(v_new));
  exception
    -- Malformed input: client error, not a security-significant denial.
    when sqlstate 'CA400' then
      return jsonb_build_object('status', 'denied', 'kind', 'validation', 'message', v_reason);
    -- Deliberate denials: audited when a human identity exists; everything
    -- else (constraint violations, audit faults, internal errors)
    -- propagates fail-closed (AUD-CTX-05).
    when sqlstate 'CA401' or sqlstate 'CA402' then
      if (select auth.uid()) is not null then
        perform public.audit_write(
          v_firm, 'human', (select auth.uid()),
          'review_item.submit_denied',
          'review_item', null,
          null, jsonb_build_object(
            'reason', v_reason,
            'client_id', p_client_id,
            'task_id', p_task_id,
            'compliance_instance_id', p_compliance_instance_id,
            'type', p_type));
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

comment on function public.submit_review_item(uuid, uuid, uuid, text, text, text, text, timestamp with time zone) is
  'IMP-041 Layer-B submission command (API-R0-RVW): the ONLY authoritative review_items insert path. Server-derived firm/submitter/submitted_at/status/source (human-only, ai_output_id NULL); linked-subject-wins derivation (task -> instance -> explicit client) with caller assertions rejected on mismatch; RLS-RVW-01 role scope with no access bootstrapping; API-ERR-02 uniform not_found for foreign/nonexistent/out-of-scope subjects (existing-subject probes audited review_item.submit_denied, AUD-FAIL-01); atomic mutation + Layer-B audit; no mutation key, no event publication. NO AAL2 (ordinary operational action, RLS-AAL-02).';

revoke all on function public.submit_review_item(uuid, uuid, uuid, text, text, text, text, timestamp with time zone) from public, anon, service_role;
grant execute on function public.submit_review_item(uuid, uuid, uuid, text, text, text, text, timestamp with time zone) to authenticated;

-- ---------------------------------------------------------------------------
-- Layer-B command: decide_review_item(uuid, text, text, text)
-- (API-R0-RVW; DM-SM-06; RLS-RVW-01 decision scope; RLS-4EY-04; API-MUT-03).
--
-- The ONLY review-decision path. SECURITY DEFINER justification as above:
-- status/decision fields carry no browser grant and the write guard admits
-- their movement only under the app.review_decision_command marker this
-- function sets, so no INVOKER variant can work. Own complete authorization:
-- actor from auth.uid(), live ACTIVE same-firm membership (DEC-J),
-- active-firm selector match (RLS-CTX-02).
--
-- DM-SM-06: pending -> approved | returned | escalated | dismissed; no
-- decision from a terminal state; no reopen. A non-empty, non-whitespace
-- p_rationale is mandatory for ALL FOUR decisions. decided_by/decided_at
-- server-derived.
--
-- AUTHORIZATION FIRST (API-ERR-02 — transition_task precedent): immediately
-- after the row fetch, BEFORE the vocabulary check, replay state, legality,
-- rationale and four-eyes evaluation (all of which disclose
-- existence/state/vocabulary), the gate resolves active-firm context ->
-- live ACTIVE membership + role -> decision scope:
--   super_admin/partner  — firm-wide;
--   manager              — portfolio (RLS-STF-03) OR linked task currently
--                          assigned to / reviewed by the caller (RLS-TSK-01);
--   senior/article       — NEVER decide;
--   billing/everything else — none.
-- EVERY gate failure returns the IDENTICAL not_found body as a nonexistent
-- id; a probe against an EXISTING row is audited server-side
-- (review_item.decide_denied, AUD-FAIL-01); a nonexistent id stays
-- un-audited.
--
-- ReviewItem four-eyes (RLS-4EY-04 — post-authorization, audited CA401):
-- the decision actor's LIVE membership MUST differ from
-- submitted_by_membership_id; no privileged-rank bypass (super_admin,
-- partner, manager all bound). The PASS-A CHECK is defense in depth only.
--
-- Returned coupling (DM-SM-06, cross-domain hardening 2026-09-05): when the
-- item's task_id is non-null, the decision composes with the ACCEPTED
-- IMP-040 task contract by INVOKING public.transition_task(task_id,
-- 'returned', p_reviewer_comment := p_rationale) — the task's own scope,
-- RLS-4EY-03 assigned-reviewer requirement (no rank bypass for
-- super_admin/partner/manager), DM-SM-05 legality (task must be in a state
-- that legally permits -> returned), atomic immutable SCH-16 reviewer
-- comment, and task.transition Layer-B audit are all preserved by reuse, not
-- duplication. A task refusal rolls the WHOLE command back (plpgsql
-- subtransaction): the item stays pending, no comment persists, no success
-- audit is written; the caller receives the standard authorized
-- conflict/unauthorized surface. With task_id NULL the item becomes
-- returned with its rationale and no task side effects. approved /
-- escalated / dismissed never touch the task.
--
-- Idempotency (API-MUT-03, state-based): once the item is decided (any
-- terminal status), a repeat WITH p_mutation_key returns already_applied
-- with the current row — no second decision, no second audit, no duplicate
-- task transition or comment. Authorization is evaluated BEFORE replay
-- state, so a replay probe against an out-of-scope item is the same
-- not_found. Keyless re-decision is an ordinary CA402 conflict.
--
-- Errcode vocabulary (IMP-030/031/040 convention):
--   CA401 unauthorized  (four-eyes self-decision; linked-task authority
--                        refusal; unauthenticated check -> kind
--                        'unauthenticated')
--   CA402 conflict      (terminal re-decision; missing/blank rationale;
--                        linked-task legality refusal; audited)
--   CA400 validation    (unknown decision value — client error, un-audited)
-- Any other exception propagates fail-closed (AUD-CTX-05).
-- ---------------------------------------------------------------------------
create or replace function public.decide_review_item(
  p_review_item_id uuid,
  p_decision text,
  p_rationale text,
  p_mutation_key text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  -- DM-SM-06 terminal outcomes (the review_items_status_check CHECK is the
  -- DB layer).
  c_decisions constant text[] := array['approved', 'returned', 'escalated', 'dismissed'];
  v_item public.review_items;
  v_new public.review_items;
  v_role text;
  v_membership uuid;
  v_reason text;
  v_in_scope boolean;
  v_task_result jsonb;
begin
  -- Single-writer command context (transaction-local; pooled-request safe):
  -- the write guard admits status/decision movement only under this marker,
  -- and the Layer-A row triggers stay silent — the command's own audit rows
  -- are the ONE audit event per layer (spec 08 §7c).
  perform pg_catalog.set_config('app.review_decision_command', '1', true);
  perform pg_catalog.set_config('app.audit_skip_trigger', '1', true);

  begin
    if (select auth.uid()) is null then
      v_reason := 'authentication required';
      raise exception 'authentication required' using errcode = 'CA401';
    end if;

    select * into v_item
    from public.review_items ri
    where ri.id = p_review_item_id
    for update;
    if not found then
      return jsonb_build_object(
        'status', 'denied', 'kind', 'not_found',
        'message', 'review item not found');
    end if;

    -- AUTHORIZATION FIRST (API-ERR-02): nothing below runs for a caller who
    -- may not see the item — every failure returns the IDENTICAL not_found
    -- body as a nonexistent id. The row EXISTS here, so the attempt is a
    -- security-significant probe and IS audited server-side (AUD-FAIL-01).
    v_role := public.active_membership_role(v_item.firm_id);
    v_membership := public.active_membership_id(v_item.firm_id);

    if v_role in ('super_admin', 'partner') then
      v_in_scope := true;
    elsif v_role = 'manager' then
      v_in_scope := exists (
        select 1 from public.clients c
        where c.firm_id = v_item.firm_id
          and c.id = v_item.client_id
          and c.manager_membership_id = v_membership
      ) or (
        v_item.task_id is not null
        and exists (
          select 1 from public.tasks t
          where t.firm_id = v_item.firm_id
            and t.id = v_item.task_id
            and v_membership in (t.assignee_membership_id, t.reviewer_membership_id))
      );
    else
      -- NULL role (suspended/removed/foreign), senior/article (never decide),
      -- billing: no decision right at all.
      v_in_scope := false;
    end if;

    if public.req_active_firm() is distinct from v_item.firm_id
       or v_role is null
       or not v_in_scope then
      perform public.audit_write(
        v_item.firm_id, 'human', (select auth.uid()),
        'review_item.decide_denied',
        'review_item', p_review_item_id::text,
        null, jsonb_build_object(
          'reason', 'review item not visible to caller (API-ERR-02)',
          'decision', p_decision));
      return jsonb_build_object(
        'status', 'denied', 'kind', 'not_found',
        'message', 'review item not found');
    end if;

    -- Decision vocabulary: unknown values are malformed input (CA400 ->
    -- validation), never a legality conflict; reachable only post-gate.
    if not (p_decision = any(c_decisions)) then
      v_reason := format('unknown decision %L (DM-SM-06 vocabulary)', p_decision);
      raise exception '%', v_reason using errcode = 'CA400';
    end if;

    -- Idempotent replay (API-MUT-03, state-based): the item is already
    -- decided. Only reachable by an authorized in-scope caller, so returning
    -- the row is no wider than the caller's own RLS read right.
    if v_item.status <> 'pending' then
      if p_mutation_key is not null then
        return jsonb_build_object(
          'status', 'already_applied',
          'reason', 'already_decided',
          'item', to_jsonb(v_item));
      end if;
      v_reason := format(
        'review item is already decided (status %s); no decision from a terminal state (DM-SM-06)',
        v_item.status);
      raise exception '%', v_reason using errcode = 'CA402';
    end if;

    -- ReviewItem four-eyes (RLS-4EY-04): decider live membership MUST differ
    -- from the submitting membership — every human R0 decision, no rank
    -- bypass. (v_membership is non-null here: v_role was resolved from a
    -- live ACTIVE membership.)
    if v_membership = v_item.submitted_by_membership_id then
      v_reason := 'the deciding membership must differ from the submitting membership (RLS-4EY-04, no privileged-rank bypass)';
      raise exception '%', v_reason using errcode = 'CA401';
    end if;

    -- Mandatory rationale (DM-SM-06) — legality-class conflict, matching the
    -- schema CHECK's non-whitespace semantic exactly.
    if p_rationale is null or not (p_rationale ~ '[^ \t\n\r]') then
      v_reason := 'a non-empty rationale is mandatory for every review decision (DM-SM-06)';
      raise exception '%', v_reason using errcode = 'CA402';
    end if;

    -- The ReviewItem transition (spec orchestration order: item first, then
    -- the linked task, then audit — one atomic commit; any later failure
    -- rolls this UPDATE back via the block's subtransaction).
    update public.review_items
    set status = p_decision,
        decided_by_membership_id = v_membership,
        decided_at = now(),
        decision_rationale = btrim(p_rationale)
    where id = v_item.id
    returning * into v_new;

    -- Returned coupling: compose with the ACCEPTED task contract by invoking
    -- transition_task — task scope, RLS-4EY-03 assigned-reviewer (no rank
    -- bypass), DM-SM-05 legality, the single atomic immutable SCH-16
    -- reviewer comment, and the task.transition Layer-B audit are all
    -- preserved by reuse. transition_task never raises for business denials
    -- (it returns a structured denial body and has mutated nothing on that
    -- path); any refusal here aborts the whole command.
    if p_decision = 'returned' and v_item.task_id is not null then
      v_task_result := public.transition_task(
        v_item.task_id, 'returned', null, null, p_rationale);
      if v_task_result ->> 'status' is distinct from 'transitioned' then
        v_reason := 'linked task refused the return: '
          || coalesce(v_task_result ->> 'message', 'denied');
        -- An in-scope item decider is always in the linked task's base scope
        -- (identical role matrices), so a task 'not_found' can only be an
        -- overlay refusal — map it to unauthorized, never an existence leak.
        if v_task_result ->> 'kind' in ('unauthorized', 'not_found', 'unauthenticated') then
          raise exception '%', v_reason using errcode = 'CA401';
        elsif v_task_result ->> 'kind' = 'validation' then
          raise exception '%', v_reason using errcode = 'CA400';
        else
          raise exception '%', v_reason using errcode = 'CA402';
        end if;
      end if;
    end if;

    -- Authoritative Layer-B audit event, same transaction (AUD-CTX-01/05;
    -- Layer-A triggers skipped via app.audit_skip_trigger — no double
    -- logging). old/new decision-field snapshots; rationale rides the new
    -- row (decision_rationale); the linked task transition + comment are
    -- audited by transition_task's own task.transition row in the same
    -- transaction (spec 08 §7c).
    perform public.audit_write(
      v_new.firm_id, 'human', (select auth.uid()),
      'review_item.decided',
      'review_item', v_new.id::text,
      to_jsonb(v_item),
      to_jsonb(v_new)
        || case when p_mutation_key is not null
             then jsonb_build_object('_mutation_key', p_mutation_key)
             else '{}'::jsonb end);

    return jsonb_build_object(
      'status', 'decided',
      'from_status', v_item.status,
      'to_status', v_new.status,
      'item', to_jsonb(v_new),
      'task', case when v_task_result is not null then v_task_result -> 'task' end,
      'reviewer_comment', case when v_task_result is not null then v_task_result -> 'reviewer_comment' end);
  exception
    -- Malformed input: client error, not a security-significant denial.
    when sqlstate 'CA400' then
      return jsonb_build_object('status', 'denied', 'kind', 'validation', 'message', v_reason);
    -- Post-authorization deliberate denials: audit the attempt
    -- (AUD-FAIL-01) and return a structured denial. The block's
    -- subtransaction has already rolled back any partial mutation (the item
    -- update above included). Everything else (constraint violations, audit
    -- faults, internal errors) propagates fail-closed.
    when sqlstate 'CA401' or sqlstate 'CA402' then
      if (select auth.uid()) is not null then
        perform public.audit_write(
          v_item.firm_id, 'human', (select auth.uid()),
          'review_item.decide_denied',
          'review_item', p_review_item_id::text,
          null, jsonb_build_object(
            'reason', v_reason,
            'from_status', v_item.status,
            'decision', p_decision));
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

comment on function public.decide_review_item(uuid, text, text, text) is
  'IMP-041 Layer-B decision command (API-R0-RVW): the ONLY review-decision path. Authorization FIRST — pre-authorization failures return the API-ERR-02 not_found surface (audited review_item.decide_denied when the row exists); then DM-SM-06 vocabulary/legality (pending -> approved/returned/escalated/dismissed only, no terminal re-decision), RLS-4EY-04 live-membership self-decision prohibition (no rank bypass), mandatory non-empty rationale for all four outcomes, state-based mutation-key replay (already_applied, no double-decide/audit/comment); task-linked returned composes through the accepted transition_task contract (RLS-TSK-01 scope, RLS-4EY-03 assigned reviewer, DM-SM-05 legality, one immutable SCH-16 comment, task.transition audit) in ONE atomic transaction — any failure rolls back ALL; denials audited (AUD-FAIL-01). NO AAL2 (ordinary operational action, RLS-AAL-02). No event publication.';

revoke all on function public.decide_review_item(uuid, text, text, text) from public, anon, service_role;
grant execute on function public.decide_review_item(uuid, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Layer-A audit mapping (spec 08 §7c): review_items is HIGH audit
-- sensitivity. The commands above set app.audit_skip_trigger and write the
-- authoritative Layer-B rows themselves — one command never double-logs
-- across layers. Residual non-command writes (operator/service paths) get
-- baseline trigger capture with old/new snapshots (AUD-VAL-01). The mapping
-- is extended via the established create-or-replace mechanism
-- (IMP-020/021/030/031/040 precedent) — committed migration files stay
-- immutable.
-- AUD-VAL-02 redaction review for SCH-17: type/title/note/status/priority/
-- rationale/subject references are exactly what the audit trail must
-- preserve; no secrets-adjacent columns exist; none redacted.
-- ---------------------------------------------------------------------------
create or replace function public.audit_trg_row()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor_type text;
  v_actor_user_id uuid;
  v_service_name text;
  v_firm_id uuid;
  v_object_type text;
  v_object_id text;
begin
  if current_setting('app.audit_skip_trigger', true) = '1' then
    return coalesce(new, old);
  end if;

  if (select auth.uid()) is not null then
    v_actor_type := 'human';
    v_actor_user_id := (select auth.uid());
  elsif (select auth.jwt() ->> 'role') = 'service_role' then
    v_actor_type := 'service';
    v_service_name := 'service-role';
  else
    v_actor_type := 'system';
    v_service_name := 'database-operator';
  end if;

  if TG_TABLE_NAME = 'firms' then
    v_firm_id := coalesce(new.id, old.id);
    v_object_type := 'firm';
    v_object_id := coalesce(new.id, old.id)::text;
  elsif TG_TABLE_NAME = 'firm_memberships' then
    v_firm_id := coalesce(new.firm_id, old.firm_id);
    v_object_type := 'firm_membership';
    v_object_id := coalesce(new.id, old.id)::text;
  elsif TG_TABLE_NAME = 'profiles' then
    -- Profiles are global identity data (TEN-04): no owning firm.
    -- human/system actor + NULL firm here is a documented extension of the
    -- AUD-EVT-03 platform marker (actor model CHECK still enforced).
    v_firm_id := null;
    v_object_type := 'profile';
    v_object_id := coalesce(new.id, old.id)::text;
  -- IMP-020 client hierarchy (SCH-04…08): tenant-owned, firm from the row.
  elsif TG_TABLE_NAME = 'clients' then
    v_firm_id := coalesce(new.firm_id, old.firm_id);
    v_object_type := 'client';
    v_object_id := coalesce(new.id, old.id)::text;
  elsif TG_TABLE_NAME = 'legal_entities' then
    v_firm_id := coalesce(new.firm_id, old.firm_id);
    v_object_type := 'legal_entity';
    v_object_id := coalesce(new.id, old.id)::text;
  elsif TG_TABLE_NAME = 'client_relationships' then
    v_firm_id := coalesce(new.firm_id, old.firm_id);
    v_object_type := 'client_relationship';
    v_object_id := coalesce(new.id, old.id)::text;
  elsif TG_TABLE_NAME = 'registrations' then
    v_firm_id := coalesce(new.firm_id, old.firm_id);
    v_object_type := 'registration';
    v_object_id := coalesce(new.id, old.id)::text;
  elsif TG_TABLE_NAME = 'contacts' then
    v_firm_id := coalesce(new.firm_id, old.firm_id);
    v_object_type := 'contact';
    v_object_id := coalesce(new.id, old.id)::text;
  -- IMP-021 engagements (SCH-09): tenant-owned, firm from the row.
  elsif TG_TABLE_NAME = 'engagements' then
    v_firm_id := coalesce(new.firm_id, old.firm_id);
    v_object_type := 'engagement';
    v_object_id := coalesce(new.id, old.id)::text;
  -- IMP-030 compliance rules (SCH-10/32): hybrid reference data; NULL firm
  -- is the AUD-EVT-03 platform marker for system-default rows.
  elsif TG_TABLE_NAME = 'compliance_types' then
    v_firm_id := coalesce(new.firm_id, old.firm_id);
    v_object_type := 'compliance_type';
    v_object_id := coalesce(new.id, old.id)::text;
  elsif TG_TABLE_NAME = 'compliance_rule_versions' then
    v_firm_id := coalesce(new.firm_id, old.firm_id);
    v_object_type := 'compliance_rule_version';
    v_object_id := coalesce(new.id, old.id)::text;
  -- IMP-031 compliance profiles/instances (SCH-11/12): tenant-owned, firm
  -- from the row.
  elsif TG_TABLE_NAME = 'client_compliance_profiles' then
    v_firm_id := coalesce(new.firm_id, old.firm_id);
    v_object_type := 'compliance_profile';
    v_object_id := coalesce(new.id, old.id)::text;
  elsif TG_TABLE_NAME = 'compliance_instances' then
    v_firm_id := coalesce(new.firm_id, old.firm_id);
    v_object_type := 'compliance_instance';
    v_object_id := coalesce(new.id, old.id)::text;
  -- IMP-040 task family (SCH-13/15/16): tenant-owned, firm from the row.
  -- task_dependencies is deliberately UNMAPPED — the Layer-B commands own
  -- the dependency graph's audit (spec 08 §7b).
  elsif TG_TABLE_NAME = 'tasks' then
    v_firm_id := coalesce(new.firm_id, old.firm_id);
    v_object_type := 'task';
    v_object_id := coalesce(new.id, old.id)::text;
  elsif TG_TABLE_NAME = 'task_checklist_items' then
    v_firm_id := coalesce(new.firm_id, old.firm_id);
    v_object_type := 'task_checklist_item';
    v_object_id := coalesce(new.id, old.id)::text;
  elsif TG_TABLE_NAME = 'task_comments' then
    v_firm_id := coalesce(new.firm_id, old.firm_id);
    v_object_type := 'task_comment';
    v_object_id := coalesce(new.id, old.id)::text;
  -- IMP-041 review items (SCH-17): tenant-owned, firm from the row.
  elsif TG_TABLE_NAME = 'review_items' then
    v_firm_id := coalesce(new.firm_id, old.firm_id);
    v_object_type := 'review_item';
    v_object_id := coalesce(new.id, old.id)::text;
  else
    -- Defense in depth: this trigger must only ever be attached to the
    -- mapped tables above.
    raise exception 'audit_trg_row attached to unmapped table %', TG_TABLE_NAME
      using errcode = 'P0001';
  end if;

  -- AUD-VAL-01: old+new for UPDATE, NEW only for INSERT, OLD only for DELETE.
  perform public.audit_write(
    v_firm_id,
    v_actor_type,
    v_actor_user_id,
    lower(TG_OP),
    v_object_type,
    v_object_id,
    case when TG_OP in ('UPDATE', 'DELETE') then to_jsonb(old) end,
    case when TG_OP in ('INSERT', 'UPDATE') then to_jsonb(new) end,
    p_service_name => v_service_name
  );

  return coalesce(new, old);
end;
$$;

comment on function public.audit_trg_row() is
  'IMP-013 Layer-A audit trigger (AUD-CTX-01), mapping extended by IMP-020 (SCH-04…08), IMP-021 (SCH-09), IMP-030 (SCH-10/32), IMP-031 (SCH-11/12), IMP-040 (SCH-13/15/16 — task_dependencies deliberately unmapped; the Layer-B commands own graph audit), and IMP-041 (SCH-17 — review_items; the Layer-B submit/decide commands own the authoritative review audit via the skip flag). Actor from auth.uid()/jwt role only; firm/object from the row. DEFINER solely so application roles without audit_log INSERT privilege can be audited; owner-only EXECUTE.';

create trigger review_items_audit_row
  after insert or update or delete on public.review_items
  for each row execute function public.audit_trg_row();

-- ---------------------------------------------------------------------------
-- Notes for reviewers (PASS B)
-- ---------------------------------------------------------------------------
-- * No INSERT/UPDATE/DELETE exists for any browser role on review_items —
--   SELECT is the whole table surface; submission and decision are the two
--   Layer-B commands (API-ARCH-04). Hard delete stays closed for this
--   HIGH-audit-sensitivity table (spec 06 conventions).
-- * The decision command performs NO event publication (review.submitted /
--   review.completed stay contract names only; the AUTO-OQ-02 mechanism is
--   IMP-050) and spawns nothing beyond the linked-task composition.
-- * decide_review_item reuses public.transition_task for the linked return
--   instead of duplicating task lifecycle logic: task scope, RLS-4EY-03
--   assigned-reviewer (no rank bypass), DM-SM-05 legality, the atomic
--   immutable SCH-16 comment and the task.transition audit cannot drift.
-- * The x-active-firm selector is untrusted context everywhere: without a
--   live ACTIVE membership it selects nothing (RLS-CTX-02), and
--   suspended/removed memberships authorize nothing on the next statement
--   with the same JWT (DEC-J, RLS-STF-07).
