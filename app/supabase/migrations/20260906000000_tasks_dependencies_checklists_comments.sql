-- IMP-040 — Tasks, dependencies, checklists, comments
-- (SCH-13, SCH-14, SCH-15, SCH-16 — schema + data-integrity foundation
-- (PASS A) and production RLS + controlled Layer-B commands + audit
-- integration (PASS B), one migration)
--
-- Implements exactly the four tables owned by this package:
--   public.tasks                (SCH-13 — execution activity, instance-linked
--                                or ad-hoc, DM-13 / DEC-H; DM-SM-05 8-state
--                                lifecycle)
--   public.task_dependencies    (SCH-14 — first-class task-to-task dependency
--                                edges, DM-OQ-04 resolution)
--   public.task_checklist_items (SCH-15 — checklist lines, DM-14)
--   public.task_comments        (SCH-16 — immutable discussion/review remarks,
--                                DM-15)
--
-- Requirement IDs: DM-13, DM-14, DM-15, DM-SM-05 (vocabulary + transition
-- machine), SCH-13…16, SCH-FK-01/02 (composite same-firm FKs),
-- SCH-RESP-02/03, RLS-PRIN-01/02 (RLS enabled AND forced), RLS-TSK-01/02,
-- RLS-TCM-01, RLS-STF-03/04/05/07, RLS-CTX-01/02, RLS-4EY-03 (task
-- four-eyes, no rank bypass), RLS-AAL-02 (routine transitions need no
-- step-up), API-R0-TSK, API-ARCH-04, API-ERR-01…04 (23514 → validation;
-- IMMUTABLE_FIELD:/INVALID_TRANSITION: markers → conflict; authorization-first
-- not_found uniformity; machine-readable transition denials), API-MUT-02/03,
-- AUD-CTX-01/05 (Layer-A trigger + Layer-B commands, atomic), AUD-FAIL-01
-- (denial evidence).
-- Test IDs served: TEST-SCH-01, TEST-SCH-02 (task-family cases),
-- TEST-SCH-15…20, TEST-RLS-TSK-*/TCM-*, TEST-AUD-03/04 families.
--
-- PASS layout (both halves live in THIS migration by design):
--   * PASS A (top): the four tables, composite same-firm FKs, declarative
--     invariants (DM-SM-05 vocabulary CHECK, self-edge/pair uniqueness,
--     is_done requires done_at), the subject-binding write guard, the
--     comment immutability guard, RLS enabled AND FORCED, browser grants
--     stripped.
--   * PASS B (below, marked): final RLS policies (RLS-TSK-01/02,
--     RLS-TCM-01), column-pinned grants (status/waiting_reason never
--     browser-writable), the controlled commands transition_task /
--     add_task_dependency / remove_task_dependency, and the Layer-A audit
--     mapping extension.
--
-- Explicitly NOT here (package non-goals — do not read their absence as an
-- oversight):
--   * @/data adapter, fixture adapter, UI, seed rows.
--   * Event/outbox publication (task.created/assigned/completed — contract
--     names only; the AUTO-OQ-02 mechanism is IMP-050).
--   * Recurrence generation/copying of any kind (IMP-050).
--
-- Trust model (unchanged from IMP-012/013/020/021/030/031): RLS is never the
-- integrity boundary — cross-firm references are impossible at the
-- constraint layer via composite (firm_id, x_id) FKs; the subject-binding
-- and comment-immutability invariants below are enforced by triggers that
-- hold for EVERY writer, owner included.

-- ---------------------------------------------------------------------------
-- SCH-13 — tasks
-- Execution activity belonging to a CLIENT (always) and optionally to a
-- compliance instance (DEC-H). client_id is NOT NULL for both forms: for
-- instance-linked tasks it is server-DERIVED from the linked instance by the
-- write guard below (a caller cannot forge a divergent subject); for ad-hoc
-- tasks it is caller-supplied and pinned same-firm by the composite FK.
-- ---------------------------------------------------------------------------
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null,
  client_id uuid not null,
  compliance_instance_id uuid,
  title text not null,
  description text,
  next_action text not null,
  status text not null default 'open',
  waiting_reason text,
  due_date date,
  priority text not null default 'normal',
  assignee_membership_id uuid,
  reviewer_membership_id uuid,
  time_spent_minutes int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  -- DM-SM-05 vocabulary (exactly these eight states). Transition LEGALITY is
  -- not a CHECK: all status movement is transition-command-owned (PASS B,
  -- API-ARCH-04), as are the waiting-requires-waiting_reason and
  -- returned-requires-reviewer-comment invariants (SCH-13, TEST-SCH-16).
  constraint tasks_status_check
    check (status in ('open', 'in_progress', 'waiting', 'submitted',
                      'returned', 'approved', 'done', 'cancelled')),
  constraint tasks_firm_fkey
    foreign key (firm_id) references public.firms (id) on delete restrict,
  -- SCH-FK-01/02: composite same-firm FKs — cross-firm references are
  -- invalid at the constraint layer, not merely forbidden by RLS.
  constraint tasks_client_fkey
    foreign key (firm_id, client_id)
    references public.clients (firm_id, id) on delete restrict,
  constraint tasks_instance_fkey
    foreign key (firm_id, compliance_instance_id)
    references public.compliance_instances (firm_id, id) on delete restrict,
  -- SCH-RESP-01/03: responsibility references are composite membership FKs,
  -- same-firm proven at the constraint layer. reviewer_membership_id is the
  -- required reference shape for the PASS-B four-eyes contract (RLS-4EY-03:
  -- submitted → approved/returned only by the assigned reviewer).
  constraint tasks_assignee_fkey
    foreign key (firm_id, assignee_membership_id)
    references public.firm_memberships (firm_id, id) on delete restrict,
  constraint tasks_reviewer_fkey
    foreign key (firm_id, reviewer_membership_id)
    references public.firm_memberships (firm_id, id) on delete restrict,
  -- SCH-FK-01: composite-FK parent key for the SCH-14/15/16 child tables.
  constraint tasks_firm_id_unique unique (firm_id, id)
);

comment on table public.tasks is 'SCH-13: execution activity, instance-linked or ad-hoc (DM-13, DEC-H). client_id server-derived from the linked compliance instance (subject binding, TEST-SCH-15); ad-hoc tasks carry a same-firm client. status vocabulary is DM-SM-05; all transitions are transition_task-only (PASS B, RLS-TSK-01/API-ARCH-04) — waiting_reason/returned-comment invariants are command-owned, deliberately not CHECKs.';

-- SCH-13 indexes: My Work (DEC-L), client drill-down, instance drill-down,
-- overdue scans.
create index tasks_my_work_idx on public.tasks (firm_id, assignee_membership_id, status, due_date);
create index tasks_firm_client_idx on public.tasks (firm_id, client_id);
create index tasks_instance_idx on public.tasks (compliance_instance_id);
create index tasks_firm_due_idx on public.tasks (firm_id, due_date);

-- ---------------------------------------------------------------------------
-- SCH-14 — task_dependencies
-- First-class task-to-task dependency edges (DM-OQ-04). The pair is unique
-- and self-edges are rejected at the constraint layer (TEST-SCH-18/19).
-- Acyclicity is NOT enforceable by a CHECK: it is validated inside the
-- controlled add/remove commands (PASS B, RLS-TSK-02 — firm-scoped advisory
-- lock + recursive cycle check + insert, one atomic commit, TEST-SCH-01/20).
-- No cycle-validation function and no public mutation surface exist yet.
-- ---------------------------------------------------------------------------
create table public.task_dependencies (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null,
  task_id uuid not null,
  depends_on_task_id uuid not null,
  dependency_type text not null default 'finish_to_start',
  created_at timestamptz not null default now(),
  constraint task_dependencies_no_self_edge_check
    check (task_id <> depends_on_task_id),
  constraint task_dependencies_firm_fkey
    foreign key (firm_id) references public.firms (id) on delete restrict,
  constraint task_dependencies_task_fkey
    foreign key (firm_id, task_id)
    references public.tasks (firm_id, id) on delete restrict,
  constraint task_dependencies_depends_on_fkey
    foreign key (firm_id, depends_on_task_id)
    references public.tasks (firm_id, id) on delete restrict,
  constraint task_dependencies_pair_unique
    unique (task_id, depends_on_task_id)
);

comment on table public.task_dependencies is 'SCH-14: task-to-task dependency edges (DM-OQ-04). Self-edges and duplicate pairs rejected at the constraint layer; acyclicity is enforced only inside the PASS-B controlled commands (RLS-TSK-02) — direct browser mutation stays closed.';

create index task_dependencies_task_idx on public.task_dependencies (task_id);
create index task_dependencies_depends_on_idx on public.task_dependencies (depends_on_task_id);

-- ---------------------------------------------------------------------------
-- SCH-15 — task_checklist_items
-- Checkable lines within a task (DM-14: open → done with who/when).
-- DB-owned invariant: is_done = true requires done_at (a line can never be
-- "done" without a recorded when); done_by is actor IDENTITY (SCH-RESP-02 —
-- global auth.users reference, not a tenant responsibility link).
-- template_source records the compliance-type checklist-template origin for
-- later recurrence copying (PRD §29); no recurrence copying exists in R0.
-- ---------------------------------------------------------------------------
create table public.task_checklist_items (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null,
  task_id uuid not null,
  label text not null,
  is_done boolean not null default false,
  done_by uuid,
  done_at timestamptz,
  template_source text,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  constraint task_checklist_items_done_requires_done_at_check
    check (is_done = false or done_at is not null),
  constraint task_checklist_items_firm_fkey
    foreign key (firm_id) references public.firms (id) on delete restrict,
  constraint task_checklist_items_task_fkey
    foreign key (firm_id, task_id)
    references public.tasks (firm_id, id) on delete restrict,
  constraint task_checklist_items_done_by_fkey
    foreign key (done_by) references auth.users (id) on delete restrict
);

comment on table public.task_checklist_items is 'SCH-15: checklist lines (DM-14). is_done=true requires done_at (who/when lifecycle); done_by is actor identity (SCH-RESP-02); template_source preserves template origin for recurrence copying (PRD §29).';

create index task_checklist_items_task_sort_idx on public.task_checklist_items (task_id, sort_order);

-- ---------------------------------------------------------------------------
-- SCH-16 — task_comments
-- Discussion and review remarks (DM-15); immutable after posting —
-- corrections are new comments, retraction is a marked state, not removal.
-- Deliberately NO updated_at column (immutability, spec 06 Conventions
-- exception family). Deletion is prohibited by RLS/privileges (PASS B): no
-- delete policy and no delete grant will exist; no delete trigger is
-- assigned by the spec.
-- ---------------------------------------------------------------------------
create table public.task_comments (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null,
  task_id uuid not null,
  author_id uuid not null,
  body text not null,
  retracted boolean not null default false,
  created_at timestamptz not null default now(),
  constraint task_comments_firm_fkey
    foreign key (firm_id) references public.firms (id) on delete restrict,
  constraint task_comments_task_fkey
    foreign key (firm_id, task_id)
    references public.tasks (firm_id, id) on delete restrict,
  -- SCH-RESP-02: author is actor IDENTITY (global), not tenant operational
  -- responsibility.
  constraint task_comments_author_fkey
    foreign key (author_id) references auth.users (id) on delete restrict
);

comment on table public.task_comments is 'SCH-16: immutable task/review discussion (DM-15). UPDATE may only set retracted false -> true (guard trigger); deletes are prohibited by RLS/privileges (PASS B). The four-eyes submitted -> returned reviewer comment is created atomically by the PASS-B transition command as one of these immutable rows (RLS-4EY-03).';

create index task_comments_task_created_idx on public.task_comments (task_id, created_at);

-- ---------------------------------------------------------------------------
-- Subject-binding write guard — tasks (BEFORE INSERT/UPDATE).
--   * Instance-linked tasks: client_id is DERIVED from the linked instance
--     on every write (insert AND re-link update) — any caller-supplied value
--     is overwritten, never trusted (SCH-13 subject binding, TEST-SCH-15;
--     same "never trusted" precedent as compliance_instances.client_id,
--     SCH-A-02). The composite FK already pins the instance to the same
--     firm; this guard pins the SUBJECT (client equality) and rejects
--     re-link divergence by construction.
--   * Identity fields (id, firm_id, created_at) are insert-only.
-- Status is deliberately NOT guarded here: DM-SM-05 transition legality,
-- waiting_reason, the returned-comment requirement, and RLS-4EY-03 reviewer
-- authorization are all transition-command-owned (PASS B).
-- DEFINER so the instance read never depends on the DML caller's RLS
-- visibility under FORCE RLS (IMP-030/031 precedent).
-- ---------------------------------------------------------------------------
create or replace function public.tasks_guard_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client uuid;
begin
  if TG_OP = 'UPDATE' then
    if new.id is distinct from old.id
       or new.firm_id is distinct from old.firm_id
       or new.created_at is distinct from old.created_at then
      raise exception 'task identity is insert-only (SCH-13)'
        using errcode = '23514', detail = 'IMMUTABLE_FIELD:tasks.identity';
    end if;
  end if;

  if new.compliance_instance_id is not null then
    select ci.client_id into v_client
    from public.compliance_instances ci
    where ci.firm_id = new.firm_id and ci.id = new.compliance_instance_id;
    if not found then
      -- Unreachable via the composite FK; fail closed rather than leave
      -- client_id un-derived.
      raise exception 'compliance_instance_id does not exist in this firm' using errcode = '23503';
    end if;
    new.client_id := v_client;
  end if;
  return new;
end;
$$;

comment on function public.tasks_guard_write() is
  'IMP-040 SCH-13 write guard: client_id server-derived from the linked compliance instance on insert and re-link (subject binding, TEST-SCH-15); task identity insert-only. DEFINER so enforcement never depends on caller RLS visibility. DM-SM-05 transition rules are PASS-B transition_task scope.';

revoke all on function public.tasks_guard_write() from public, anon, authenticated, service_role;

create trigger tasks_guard_write
  before insert or update on public.tasks
  for each row execute function public.tasks_guard_write();

-- ---------------------------------------------------------------------------
-- Immutability guard — task_comments (BEFORE UPDATE).
-- The ONLY permitted update is retracted false -> true (DM-15: retraction is
-- a marked new state, never removal, never un-retraction). Content, authorship,
-- parentage, and timestamp changes are rejected with the IMMUTABLE_FIELD:
-- marker (→ conflict, API-ERR-01). INVOKER is sufficient — pure OLD/NEW
-- comparison (engagements_guard_status_transition precedent). DELETE
-- prohibition is RLS/privilege-owned (PASS B) — the spec assigns no delete
-- trigger.
-- ---------------------------------------------------------------------------
create or replace function public.task_comments_guard_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
     or new.firm_id is distinct from old.firm_id
     or new.task_id is distinct from old.task_id
     or new.author_id is distinct from old.author_id
     or new.body is distinct from old.body
     or new.created_at is distinct from old.created_at then
    raise exception 'task comments are immutable after posting (SCH-16, DM-15)'
      using errcode = '23514', detail = 'IMMUTABLE_FIELD:task_comments.content';
  end if;
  if new.retracted is distinct from old.retracted
     and not (old.retracted = false and new.retracted = true) then
    raise exception 'retraction is one-way: retracted may only move false -> true (SCH-16, DM-15)'
      using errcode = '23514', detail = 'IMMUTABLE_FIELD:task_comments.retracted';
  end if;
  return new;
end;
$$;

comment on function public.task_comments_guard_update() is
  'IMP-040 SCH-16 immutability guard: UPDATE may only set retracted false -> true; content/author/parentage/timestamp changes and un-retraction are rejected (IMMUTABLE_FIELD markers → conflict). Delete prohibition is RLS/privilege-owned (PASS B).';

revoke all on function public.task_comments_guard_update() from public, anon, authenticated, service_role;

create trigger task_comments_guard_update
  before update on public.task_comments
  for each row execute function public.task_comments_guard_update();

-- ---------------------------------------------------------------------------
-- updated_at maintenance (schema convention; NOT audit). task_comments has
-- no updated_at column (immutability); task_dependencies edges carry no
-- mutable payload beyond dependency_type and follow the insert/delete
-- command model (PASS B), so no maintenance trigger there either.
-- ---------------------------------------------------------------------------
create trigger tasks_set_updated_at
  before update on public.tasks
  for each row execute function public.set_updated_at();

create trigger task_checklist_items_set_updated_at
  before update on public.task_checklist_items
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS posture (RLS-PRIN-01/02): enabled AND FORCED on all four tenant-owned
-- content tables. Policies and browser grants are added by PASS B below —
-- at this point in the file the tables are fail-closed (zero policies, zero
-- browser grants).
-- ---------------------------------------------------------------------------
alter table public.tasks enable row level security;
alter table public.tasks force row level security;
alter table public.task_dependencies enable row level security;
alter table public.task_dependencies force row level security;
alter table public.task_checklist_items enable row level security;
alter table public.task_checklist_items force row level security;
alter table public.task_comments enable row level security;
alter table public.task_comments force row level security;

-- ---------------------------------------------------------------------------
-- Grants: strip the Supabase default privileges from the browser roles here;
-- PASS B (below) re-grants the exact least-privilege matrix. anon gets
-- nothing, ever; service_role retains its default ALL (server-only paths,
-- RLS-SVC-01/02 — the same posture IMP-020/021/030/031 left in place).
-- ---------------------------------------------------------------------------
revoke all on public.tasks from anon, authenticated;
revoke all on public.task_dependencies from anon, authenticated;
revoke all on public.task_checklist_items from anon, authenticated;
revoke all on public.task_comments from anon, authenticated;

-- ---------------------------------------------------------------------------
-- PASS-A notes (superseded where noted by PASS B below)
-- ---------------------------------------------------------------------------
-- * waiting-without-waiting_reason and returned-without-reviewer-comment
--   rows are representable at the raw SQL layer BY DESIGN: both invariants
--   are atomic multi-write transition rules that only the transition_task
--   command can enforce (API-ARCH-04); faking them with CHECKs would block
--   legitimate intermediate states (TEST-SCH-16 documents the split).
-- * Dependency acyclicity (TEST-SCH-01) and the concurrent-opposing-edge
--   race (TEST-SCH-20) are enforced inside the controlled add/remove
--   commands (PASS B, firm-scoped advisory lock); only the declarative
--   invariants (self-edge, duplicate pair, same-firm endpoints) exist above.

-- ===========================================================================
-- IMP-040 PASS B — production RLS, controlled Layer-B commands, audit
-- (RLS-TSK-01/02, RLS-TCM-01, RLS-4EY-03, API-R0-TSK, AUD-CTX-01/05,
--  AUD-FAIL-01; TEST-SCH-01/16/17/20, TEST-RLS-TSK-*/TCM-*, TEST-AUD-03/04)
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Write guard — tasks (PASS-B extension of the PASS-A guard).
-- Adds, on top of subject binding and insert-only identity:
--   * status changes ONLY under the transaction-local
--     app.task_transition_command marker set by transition_task()
--     (RLS-TSK-01: status is never directly browser-writable; the marker is
--     the single-writer mechanism, cin_guard_write precedent). The column
--     grant below is the primary control; this guard is the second layer for
--     every writer, service paths included. INVALID_TRANSITION: → conflict.
--   * waiting_reason is transition-owned (stamped by the command when
--     entering waiting; never a routine browser edit). IMMUTABLE_FIELD: →
--     conflict.
--   * Assignment liveness (SCH-RESP-03 live-status layer): a newly set
--     assignee/reviewer must be an ACTIVE same-firm membership — the
--     composite FKs prove same-firm existence; this adds the status layer
--     (DM-04 / cin_validate_assignments precedent, 23503). Suspended/removed
--     memberships can never be (re)assigned.
--   * Write-time four-eyes (RLS-4EY-03, cin precedent): where the task is
--     instance-linked and the instance's compliance type requires
--     four-eyes, reviewer must differ from assignee.
--   * Role-scoped column protection: assignment/reassignment is manager+
--     (RLS-TSK-01). No existing migration needed role-conditional OLD/NEW
--     column protection (IMP-031 instead gave senior/article NO update
--     policy at all — impossible here, the §11 matrix gives senior/article
--     ◐-assigned task writes), so this guard implements it: when the caller
--     is an authenticated human whose LIVE role in the row's firm is
--     senior/article_executive, INSERT may not set a reviewer (their
--     assignee=self pin is the INSERT policy's WITH CHECK) and UPDATE may
--     change neither assignee nor reviewer. 42501 (PostgREST 403) —
--     API-ERR-03 mutation-denial surface, membership-RPC precedent. Caller
--     role comes from the live DEC-J lookup, never JWT claims; operator and
--     service paths (auth.uid() NULL) are unaffected.
-- ---------------------------------------------------------------------------

create or replace function public.tasks_guard_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- coalesce: an unset GUC yields NULL and `not NULL` would silently skip
  -- the guard (three-valued logic) — the flag must be exactly '1'.
  v_command boolean := coalesce(current_setting('app.task_transition_command', true), '') = '1';
  v_caller_role text;
  v_four_eyes boolean;
begin
  if TG_OP = 'UPDATE' then
    if new.id is distinct from old.id
       or new.firm_id is distinct from old.firm_id
       or new.created_at is distinct from old.created_at then
      raise exception 'task identity is insert-only (SCH-13)'
        using errcode = '23514', detail = 'IMMUTABLE_FIELD:tasks.identity';
    end if;

    if new.status is distinct from old.status and not v_command then
      raise exception 'tasks.status changes only through transition_task() (RLS-TSK-01, DM-SM-05)'
        using errcode = '23514', detail = 'INVALID_TRANSITION:tasks.status';
    end if;

    if new.waiting_reason is distinct from old.waiting_reason and not v_command then
      raise exception 'waiting_reason is stamped by transition_task() only (DM-SM-05, SCH-13)'
        using errcode = '23514', detail = 'IMMUTABLE_FIELD:tasks.waiting_reason';
    end if;
  end if;

  if new.compliance_instance_id is not null then
    select ci.client_id into new.client_id
    from public.compliance_instances ci
    where ci.firm_id = new.firm_id and ci.id = new.compliance_instance_id;
    if not found then
      -- Unreachable via the composite FK; fail closed rather than leave
      -- client_id un-derived.
      raise exception 'compliance_instance_id does not exist in this firm' using errcode = '23503';
    end if;
  end if;

  -- SCH-RESP-03 live-status layer (PASS B): newly set responsibility
  -- memberships must be ACTIVE same-firm memberships. The composite FKs
  -- prove same-firm existence; this rejects suspended/removed (23503,
  -- DM-04 / cin_validate_assignments precedent).
  if new.assignee_membership_id is not null and not exists (
    select 1 from public.firm_memberships m
    where m.firm_id = new.firm_id and m.id = new.assignee_membership_id and m.status = 'active'
  ) then
    raise exception 'assignee_membership_id must be an ACTIVE membership of the same firm (SCH-RESP-03)'
      using errcode = '23503';
  end if;
  if new.reviewer_membership_id is not null and not exists (
    select 1 from public.firm_memberships m
    where m.firm_id = new.firm_id and m.id = new.reviewer_membership_id and m.status = 'active'
  ) then
    raise exception 'reviewer_membership_id must be an ACTIVE membership of the same firm (SCH-RESP-03)'
      using errcode = '23503';
  end if;

  -- Write-time four-eyes (RLS-4EY-03): instance-linked tasks whose
  -- compliance type requires four-eyes must name reviewer <> assignee.
  if new.compliance_instance_id is not null
     and new.assignee_membership_id is not null
     and new.reviewer_membership_id is not null
     and new.assignee_membership_id = new.reviewer_membership_id then
    select ct.four_eyes_required into v_four_eyes
    from public.compliance_instances ci
    join public.compliance_types ct on ct.id = ci.compliance_type_id
    where ci.firm_id = new.firm_id and ci.id = new.compliance_instance_id;
    if coalesce(v_four_eyes, false) then
      raise exception 'four-eyes required: reviewer_membership_id must differ from assignee_membership_id (RLS-4EY-03)'
        using errcode = '23514', detail = 'FOUR_EYES:tasks.assignments';
    end if;
  end if;

  -- Role-scoped column protection (RLS-TSK-01: assignment is manager+).
  -- auth.uid() NULL = operator/service path (no JWT) — unaffected.
  if (select auth.uid()) is not null then
    v_caller_role := public.active_membership_role(new.firm_id);
    if v_caller_role in ('senior', 'article_executive') then
      if (TG_OP = 'INSERT' and new.reviewer_membership_id is not null)
         or (TG_OP = 'UPDATE'
             and (new.assignee_membership_id is distinct from old.assignee_membership_id
                  or new.reviewer_membership_id is distinct from old.reviewer_membership_id)) then
        raise exception 'task assignment/reassignment requires a manager+ role within scope (RLS-TSK-01)'
          using errcode = '42501';
      end if;
    end if;
  end if;

  return new;
end;
$$;

comment on function public.tasks_guard_write() is
  'IMP-040 SCH-13 write guard: client_id server-derived from the linked compliance instance on insert and re-link (subject binding, TEST-SCH-15); task identity insert-only; status/waiting_reason only under the app.task_transition_command single-writer marker (RLS-TSK-01); responsibility memberships ACTIVE same-firm at write time (SCH-RESP-03); write-time four-eyes reviewer<>assignee where the linked type requires it (RLS-4EY-03); senior/article may not (re)assign (RLS-TSK-01, 42501). DEFINER so enforcement never depends on caller RLS visibility.';

-- ---------------------------------------------------------------------------
-- Checklist who/when stamping (DM-14; API-MUT-02 optimistic toggles are NOT
-- routed through transition_task — the server stamps the actor/time here).
--   * INSERT with is_done true -> done_at = now(); done_by forced to
--     auth.uid() whenever a caller identity exists (operator paths with no
--     JWT keep their supplied done_by — the PASS-A schema fixtures rely on
--     this). INSERT with is_done false -> done_by/done_at cleared.
--   * UPDATE false -> true (the actual completion flip) -> done_at = now()
--     and done_by = auth.uid() stamped OVER whatever was supplied —
--     completion attribution is unforgeable.
--   * UPDATE true -> true (an unrelated label/sort_order edit) -> the
--     recorded done_by/done_at are RESTORED onto NEW: the editor can neither
--     clobber nor forge another user's completion attribution (DM-14).
--   * is_done false -> done_by/done_at cleared. Convention chosen for
--     PASS B (the PASS-A CHECK `is_done = false OR done_at IS NOT NULL`
--     permits either; no PASS-A test encodes a kept value): an UNCHECKED
--     line carries no who/when — the historical completion is preserved by
--     the Layer-A audit row, not the row itself. Documented decision.
-- INVOKER is sufficient (pure NEW-row mutation + auth.uid()).
-- ---------------------------------------------------------------------------
create or replace function public.task_checklist_items_stamp_done()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if TG_OP = 'INSERT' then
    if new.is_done then
      new.done_at := now();
      new.done_by := coalesce((select auth.uid()), new.done_by);
    else
      new.done_by := null;
      new.done_at := null;
    end if;
  elsif new.is_done and not old.is_done then
    -- The false -> true flip: stamp over WHATEVER was supplied.
    new.done_at := now();
    new.done_by := coalesce((select auth.uid()), new.done_by);
  elsif not new.is_done then
    -- Unchecking clears both (documented PASS-B convention).
    new.done_by := null;
    new.done_at := null;
  else
    -- old.is_done and new.is_done: an unrelated edit must not rewrite the
    -- completion attribution — restore the recorded who/when.
    new.done_by := old.done_by;
    new.done_at := old.done_at;
  end if;
  return new;
end;
$$;

comment on function public.task_checklist_items_stamp_done() is
  'IMP-040 SCH-15 who/when stamping (DM-14, API-MUT-02): done_at/done_by server-stamped on the false->true flip only (stamped over any supplied value — unforgeable); a true->true unrelated edit preserves the recorded attribution exactly; unchecking clears both. INVOKER — pure row mutation.';

revoke all on function public.task_checklist_items_stamp_done() from public, anon, authenticated, service_role;

create trigger task_checklist_items_stamp_done
  before insert or update on public.task_checklist_items
  for each row execute function public.task_checklist_items_stamp_done();

-- ---------------------------------------------------------------------------
-- RLS policies (RLS-TSK-01/02, RLS-TCM-01; spec 05 §11 matrix rows 198/199).
-- All keyed off the LIVE firm_memberships lookup (DEC-J helpers — never JWT
-- claims): suspended/removed memberships lose access on the next statement
-- with the same JWT (RLS-STF-07); x-active-firm is an untrusted selector
-- (RLS-CTX-02). Three-valued-logic rule observed throughout: a NULL caller
-- membership makes every `in (...)`/comparison NULL -> not true -> denied.
-- ---------------------------------------------------------------------------

-- --- tasks: SELECT (RLS-TSK-01 read scope) ----------------------------------
-- super_admin/partner: firm-wide; manager: portfolio (the client's
-- designated manager is the caller's live membership) OR directly assigned
-- (assignee OR reviewer); senior/article: assigned-work only — the live
-- membership is the row's assignee or reviewer (RLS-STF-04; the
-- compliance_instances RLS-CIN-01 select shape, 20260905 ~729-750, mirrored
-- 1:1 — the "clients/documents needed for that work" half of RLS-STF-04 is
-- carried by the IMP-020 client-hierarchy policies, not widened here);
-- billing: none; anon: no policies (RLS-SVC-03).
create policy tasks_select_scoped on public.tasks
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
            where c.firm_id = tasks.firm_id
              and c.id = tasks.client_id
              and c.manager_membership_id = public.active_membership_id(tasks.firm_id)
          )
          or public.active_membership_id(firm_id)
               in (assignee_membership_id, reviewer_membership_id)
        )
      )
      or (
        public.active_membership_role(firm_id) in ('senior', 'article_executive')
        and public.active_membership_id(firm_id)
              in (assignee_membership_id, reviewer_membership_id)
      )
    )
  );

-- --- tasks: INSERT (RLS-TSK-01 creation scope) ------------------------------
-- public.task_client_in_assigned_scope(uuid, uuid) — the second DEC-J-style
-- recursion helper of this package (the active_membership_role precedent,
-- 20260901120000 ~30-55): the senior/article creation predicate must consult
-- tasks itself ("an existing assigned task of that client"); a plain
-- in-policy subquery is infinite RLS recursion (42P17). The function reads
-- tasks bypassing RLS but ONLY for the exact predicate below — the caller's
-- LIVE membership (auth.uid(), active status) is the row's assignee or
-- reviewer; it exposes nothing else. Same discipline as the IMP-012 helpers:
-- pinned empty search_path, fully qualified references, STABLE, single
-- static statement, EXECUTE revoked from PUBLIC/anon/service_role.
create or replace function public.task_client_in_assigned_scope(p_firm_id uuid, p_client_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.tasks t
    where t.firm_id = p_firm_id
      and t.client_id = p_client_id
      and public.active_membership_id(p_firm_id)
            in (t.assignee_membership_id, t.reviewer_membership_id)
  )
$$;

comment on function public.task_client_in_assigned_scope(uuid, uuid) is
  'IMP-040 RLS-TSK-01: true when auth.uid() holds an ACTIVE membership in the firm that is assignee or reviewer of at least one existing task of the given client. SECURITY DEFINER solely to avoid RLS self-recursion on tasks inside tasks_insert_scoped; exact-predicate only, never a convenience bypass.';

revoke all on function public.task_client_in_assigned_scope(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.task_client_in_assigned_scope(uuid, uuid) to authenticated;

-- WITH CHECK sees the row AFTER the BEFORE guards — for instance-linked
-- tasks client_id is already derived from the instance, so scope is always
-- evaluated against the true subject.
--   super_admin/partner: any client in the active firm.
--   manager: PORTFOLIO clients only (RLS-TSK-01 ad-hoc rule; an instance in
--     scope derives a portfolio client, so the instance-linked case folds
--     into the same predicate).
--   senior/article: the client must ALREADY be in their assigned-work scope
--     — an existing assigned compliance instance (EXISTS under the caller's
--     OWN RLS-CIN-01 visibility, already assigned-only, so it can never
--     widen) OR an existing assigned task of that client (via the definer
--     helper above — self-reference is RLS recursion) — AND the new row
--     must self-assign (assignee = the creator's live membership). No
--     bootstrapping: a client with nothing assigned to the caller stays
--     uncreatable. Reviewer-setting on insert is blocked for these roles by
--     the write guard (assignment is manager+).
--   billing: denied; anon: no policy.
create policy tasks_insert_scoped on public.tasks
  for insert to authenticated
  with check (
    firm_id = public.req_active_firm()
    and (
      public.active_membership_role(firm_id) in ('super_admin', 'partner')
      or (
        public.active_membership_role(firm_id) = 'manager'
        and exists (
          select 1 from public.clients c
          where c.firm_id = tasks.firm_id
            and c.id = tasks.client_id
            and c.manager_membership_id = public.active_membership_id(tasks.firm_id)
        )
      )
      or (
        public.active_membership_role(firm_id) in ('senior', 'article_executive')
        and assignee_membership_id = public.active_membership_id(firm_id)
        and (
          exists (
            select 1 from public.compliance_instances i
            where i.firm_id = tasks.firm_id
              and i.client_id = tasks.client_id
              and public.active_membership_id(tasks.firm_id)
                    in (i.assignee_membership_id, i.reviewer_membership_id)
          )
          or public.task_client_in_assigned_scope(tasks.firm_id, tasks.client_id)
        )
      )
    )
  );

-- --- tasks: UPDATE (RLS-TSK-01 routine non-state writes) --------------------
-- The transition invocation scope minus state changes: super_admin/partner
-- firm-wide; manager portfolio OR directly assigned; senior/article ONLY
-- where the live membership is the CURRENT assignee (they must not escape
-- assignment scope via a direct UPDATE — reviewer-only visibility does not
-- grant routine writes). status/waiting_reason are outside the column grant
-- and command-gated by the guard; assignee/reviewer changes by
-- senior/article are rejected by the guard (manager+ only).
create policy tasks_update_scoped on public.tasks
  for update to authenticated
  using (
    firm_id = public.req_active_firm()
    and (
      public.active_membership_role(firm_id) in ('super_admin', 'partner')
      or (
        public.active_membership_role(firm_id) = 'manager'
        and (
          exists (
            select 1 from public.clients c
            where c.firm_id = tasks.firm_id
              and c.id = tasks.client_id
              and c.manager_membership_id = public.active_membership_id(tasks.firm_id)
          )
          or public.active_membership_id(firm_id)
               in (assignee_membership_id, reviewer_membership_id)
        )
      )
      or (
        public.active_membership_role(firm_id) in ('senior', 'article_executive')
        and public.active_membership_id(firm_id) = assignee_membership_id
      )
    )
  )
  with check (
    firm_id = public.req_active_firm()
    and (
      public.active_membership_role(firm_id) in ('super_admin', 'partner')
      or (
        public.active_membership_role(firm_id) = 'manager'
        and (
          exists (
            select 1 from public.clients c
            where c.firm_id = tasks.firm_id
              and c.id = tasks.client_id
              and c.manager_membership_id = public.active_membership_id(tasks.firm_id)
          )
          or public.active_membership_id(firm_id)
               in (assignee_membership_id, reviewer_membership_id)
        )
      )
      or (
        public.active_membership_role(firm_id) in ('senior', 'article_executive')
        and public.active_membership_id(firm_id) = assignee_membership_id
      )
    )
  );

-- No DELETE policy and no DELETE grant on tasks (SCH-13 lifecycle: cancelled
-- is the terminal removal state; audit-sensitive tables are never
-- hard-deleted, spec 06 conventions).

-- --- task_dependencies: SELECT only (RLS-TSK-02) ----------------------------
-- Read follows the task graph with BOTH endpoints gated: an edge is visible
-- only where the caller can see BOTH endpoint tasks under the tasks read
-- scope (API-ERR-02, spec 07 §145-160 — the API must not reveal whether a
-- resource exists outside the caller's scope; RLS-A-03, spec 05 §506-510 —
-- the analogous two-endpoint relationship row requires BOTH endpoints in
-- scope for READ and WRITE; either-endpoint visibility was REJECTED because
-- it leaks the hidden endpoint's existence/UUID/relationship). The EXISTS
-- subqueries run under the caller's OWN tasks RLS, so this exposes exactly
-- edges whose two endpoints are both in the caller's scope. Direct browser
-- mutation is CLOSED: no INSERT/UPDATE/DELETE policies and no write grants —
-- graph changes go through add_task_dependency / remove_task_dependency only.
create policy task_dependencies_select_scoped on public.task_dependencies
  for select to authenticated
  using (
    firm_id = public.req_active_firm()
    and exists (
      select 1 from public.tasks t
      where t.firm_id = task_dependencies.firm_id
        and t.id = task_dependencies.task_id
    )
    and exists (
      select 1 from public.tasks t
      where t.firm_id = task_dependencies.firm_id
        and t.id = task_dependencies.depends_on_task_id
    )
  );

-- --- task_checklist_items (RLS-TSK-01: same family scope as tasks) ---------
-- Read AND write follow the parent task: the EXISTS runs under the caller's
-- tasks RLS, so each role gets exactly its task scope (partner/admin
-- firm-wide, manager portfolio/assigned, senior/article assignee-or-reviewer
-- — the toggle scope the brief specifies). done_by/done_at integrity is
-- owned ENTIRELY by the stamping trigger (flip stamps the caller, true->true
-- edits restore the recorded attribution, unchecking clears): BEFORE-row
-- triggers run before WITH CHECK evaluation, so any supplied done_by is
-- already sanitized at policy-check time — a WITH CHECK pin on done_by would
-- only ever reject the trigger-sanitized value (e.g. a legitimate label edit
-- on a line completed by someone else), never a forgery.
create policy task_checklist_items_select_via_task on public.task_checklist_items
  for select to authenticated
  using (
    firm_id = public.req_active_firm()
    and exists (
      select 1 from public.tasks t
      where t.firm_id = task_checklist_items.firm_id
        and t.id = task_checklist_items.task_id
    )
  );

create policy task_checklist_items_insert_via_task on public.task_checklist_items
  for insert to authenticated
  with check (
    firm_id = public.req_active_firm()
    and exists (
      select 1 from public.tasks t
      where t.firm_id = task_checklist_items.firm_id
        and t.id = task_checklist_items.task_id
    )
  );

create policy task_checklist_items_update_via_task on public.task_checklist_items
  for update to authenticated
  using (
    firm_id = public.req_active_firm()
    and exists (
      select 1 from public.tasks t
      where t.firm_id = task_checklist_items.firm_id
        and t.id = task_checklist_items.task_id
    )
  )
  with check (
    firm_id = public.req_active_firm()
    and exists (
      select 1 from public.tasks t
      where t.firm_id = task_checklist_items.firm_id
        and t.id = task_checklist_items.task_id
    )
  );

create policy task_checklist_items_delete_via_task on public.task_checklist_items
  for delete to authenticated
  using (
    firm_id = public.req_active_firm()
    and exists (
      select 1 from public.tasks t
      where t.firm_id = task_checklist_items.firm_id
        and t.id = task_checklist_items.task_id
    )
  );

-- --- task_comments (RLS-TCM-01) ----------------------------------------------
-- Read per task scoping (same EXISTS mechanism). Insert by any staff with
-- task access, author pinned to the caller (server-non-forgeable). Update
-- only by the original author — the guard beneath limits the mutation to
-- retracted false -> true; task visibility implies the author's membership
-- is current/live in the firm (DEC-J). NO delete policy and no delete grant
-- (SCH-16: deletes prohibited).
create policy task_comments_select_via_task on public.task_comments
  for select to authenticated
  using (
    firm_id = public.req_active_firm()
    and exists (
      select 1 from public.tasks t
      where t.firm_id = task_comments.firm_id
        and t.id = task_comments.task_id
    )
  );

create policy task_comments_insert_author on public.task_comments
  for insert to authenticated
  with check (
    firm_id = public.req_active_firm()
    and author_id = (select auth.uid())
    and exists (
      select 1 from public.tasks t
      where t.firm_id = task_comments.firm_id
        and t.id = task_comments.task_id
    )
  );

create policy task_comments_update_retract_author on public.task_comments
  for update to authenticated
  using (
    firm_id = public.req_active_firm()
    and author_id = (select auth.uid())
    and exists (
      select 1 from public.tasks t
      where t.firm_id = task_comments.firm_id
        and t.id = task_comments.task_id
    )
  )
  with check (
    firm_id = public.req_active_firm()
    and author_id = (select auth.uid())
    and exists (
      select 1 from public.tasks t
      where t.firm_id = task_comments.firm_id
        and t.id = task_comments.task_id
    )
  );

-- ---------------------------------------------------------------------------
-- Grants (least privilege at BOTH layers — the PASS-A revokes above already
-- stripped the Supabase defaults; this is the exact PASS-B matrix).
--
-- tasks INSERT (11 columns — derivation verified mechanically against the
-- SCH-13 column list): caller supplies firm_id, client_id,
--   compliance_instance_id, title, description, next_action, due_date,
--   priority, assignee_membership_id, reviewer_membership_id,
--   time_spent_minutes. EXCLUDED: id/created_at/updated_at (server-managed),
--   status (forced default 'open' — transition-command-only, RLS-TSK-01),
--   waiting_reason (transition-owned).
-- tasks UPDATE (9 columns): title, description, next_action,
--   compliance_instance_id (re-link re-derives the subject), due_date,
--   priority, time_spent_minutes, assignee_membership_id,
--   reviewer_membership_id. EXCLUDED: id/firm_id/created_at/updated_at
--   (identity/server-managed), status + waiting_reason (transition-owned),
--   client_id (subject binding is insert-time: linked tasks derive it in the
--   guard; ad-hoc subject re-binding is not a routine non-state field and is
--   deliberately not browser-writable — re-link via compliance_instance_id
--   instead).
-- task_checklist_items: INSERT excludes id/created_at/updated_at/done_at
--   (server-managed/server-stamped); UPDATE is label/is_done/done_by/
--   sort_order (template_source is insert-only provenance); done_by is
--   accepted but force-stamped to the caller by the trigger.
-- task_comments: INSERT is firm_id/task_id/author_id/body (retracted forced
--   default false; id/created_at server-managed); UPDATE is retracted ONLY
--   (the guard allows solely false -> true); no DELETE grant.
-- task_dependencies: SELECT only — every graph mutation is command-owned
-- (RLS-TSK-02); no write grant will ever exist for browser roles.
-- ---------------------------------------------------------------------------
grant select on public.tasks to authenticated;
grant insert (firm_id, client_id, compliance_instance_id, title, description,
              next_action, due_date, priority, assignee_membership_id,
              reviewer_membership_id, time_spent_minutes)
  on public.tasks to authenticated;
grant update (title, description, next_action, compliance_instance_id,
              due_date, priority, time_spent_minutes, assignee_membership_id,
              reviewer_membership_id)
  on public.tasks to authenticated;

grant select on public.task_dependencies to authenticated;

grant select on public.task_checklist_items to authenticated;
grant insert (firm_id, task_id, label, is_done, done_by, template_source, sort_order)
  on public.task_checklist_items to authenticated;
grant update (label, is_done, done_by, sort_order)
  on public.task_checklist_items to authenticated;
grant delete on public.task_checklist_items to authenticated;

grant select on public.task_comments to authenticated;
grant insert (firm_id, task_id, author_id, body) on public.task_comments to authenticated;
grant update (retracted) on public.task_comments to authenticated;

-- ---------------------------------------------------------------------------
-- Layer-B command: transition_task(uuid, text, text, text, text)
-- (API-R0-TSK; DM-SM-05; RLS-TSK-01 transition authorization; RLS-4EY-03;
-- API-ARCH-04 single controlled write path).
--
-- The ONLY path that changes tasks.status (RLS-TSK-01). SECURITY DEFINER
-- justification (API-SEC-03 — exceptional, reviewed; the IMP-031 precedent):
-- the write guard admits status/waiting_reason movement only under the
-- transaction-local app.task_transition_command marker this function sets,
-- and status/waiting_reason carry no column grant at all, so no INVOKER
-- variant can work. The function performs its OWN complete authorization:
-- actor from auth.uid() (never parameters/headers), live ACTIVE same-firm
-- membership (DEC-J), active-firm selector match (RLS-CTX-02).
--
-- DM-SM-05 edge derivation (docs/spec/02-domain-model.md:334-342):
--   main chain   open -> in_progress -> submitted -> approved -> done
--   blocked      in_progress -> waiting -> in_progress ("waiting records the
--                blocker")
--   rework       submitted -> returned -> in_progress ("returned sends the
--                task back to the assignee with reviewer comments")
--   reopen       done -> open ("done -> (reopen, audit-logged)")
--   cancel       cancelled <- ANY non-terminal state: open, in_progress,
--                waiting, submitted, returned, approved ("cancelled (from
--                any non-terminal state)")
--   terminals    cancelled is final; done is final except the explicit
--                reopen edge.
-- Encoded edge set (exactly these 15 edges; everything else CA402):
--   open->in_progress, in_progress->waiting, in_progress->submitted,
--   waiting->in_progress, submitted->approved, submitted->returned,
--   returned->in_progress, approved->done, done->open,
--   open->cancelled, in_progress->cancelled, waiting->cancelled,
--   submitted->cancelled, returned->cancelled, approved->cancelled.
--
-- Mandatory fields (SCH-13, TEST-SCH-16): entering waiting requires a
-- non-empty p_waiting_reason (persisted on the task); entering returned
-- requires a non-empty p_reviewer_comment, created ATOMICALLY in the same
-- transaction as an ordinary immutable SCH-16 comment authored by the
-- caller (author stamped server-side). Any failure rolls back both.
-- Leaving waiting RETAINS waiting_reason as history (the spec is silent;
-- retention preserves the blocker record for the audit trail — the Layer-B
-- audit row already snapshots both states). Documented choice.
--
-- AUTHORIZATION FIRST (API-ERR-02 — transition_compliance_instance
-- precedent): immediately after the row fetch, BEFORE the vocabulary check,
-- the keyed-replay path, legality, mandatory-field and four-eyes evaluation
-- (all of which disclose existence/state/vocabulary), the gate resolves
-- active-firm context -> live ACTIVE membership + role -> scope:
--   super_admin/partner  — firm-wide;
--   manager              — portfolio (client's designated manager is the
--                          caller's live membership) OR directly assigned
--                          (assignee/reviewer), RLS-STF-03;
--   senior/article       — caller's live membership is the task's current
--                          assignee OR reviewer (reviewer admission exists
--                          solely so the RLS-4EY-03 reviewer transitions are
--                          reachable; ordinary transitions are restricted to
--                          the current assignee by the post-authorization
--                          overlay below);
--   billing/everything else — none.
-- EVERY gate failure returns the IDENTICAL not_found body as a nonexistent
-- id; a probe against an EXISTING row is audited server-side
-- (AUD-FAIL-01) without disturbing that uniformity; a nonexistent id stays
-- un-audited (no object to bind the event to — IMP-030/031 precedent).
--
-- Post-authorization transition-authority overlays (audited CA401):
--   * Four-eyes (RLS-4EY-03): applies only when compliance_instance_id IS
--     NOT NULL and the instance's compliance type has four_eyes_required
--     (SCH-10). submitted -> approved / submitted -> returned must be
--     performed by the assigned reviewer membership (active same-firm —
--     the actor's membership is live by construction and the write guard
--     keeps the reference ACTIVE); reviewer <> assignee is enforced at the
--     write path; NO rank bypass (partner/super_admin/manager all bound).
--     A NULL reviewer fail-closes the review exit until a manager+ assigns
--     one via the permitted non-state update. Ad-hoc tasks are NOT
--     four-eyes-required by default.
--   * senior/article ordinary transitions: only as the CURRENT assignee;
--     a reviewer-only senior/article may perform exactly the four-eyes
--     reviewer transitions above and nothing else.
--
-- Idempotency (API-MUT-03): with p_mutation_key supplied, a repeat against
-- a task already in p_target_status returns status='already_applied' with
-- the current row — no second mutation, no double audit. The key rides on
-- the authoritative audit row's new_value._mutation_key. Same-state without
-- a key is an ordinary CA402 conflict.
--
-- Reopen (done -> open) is explicitly marked on the audit row
-- (new_value._reopen = true) in addition to the from/to snapshots
-- (DM-SM-05: "reopen, audit-logged").
--
-- Errcode vocabulary (IMP-030/031 convention):
--   CA401 unauthorized  (POST-authorization transition-authority denials:
--                        four-eyes reviewer-only exit, senior/article
--                        assignee-only rule; audited per AUD-FAIL-01. The
--                        unauthenticated check above the row fetch also
--                        raises CA401 — response kind 'unauthenticated').
--   CA402 conflict      (legality + mandatory-field failures; audited)
--   CA400 validation    (unknown target status; a client error, NOT a
--                        security-significant denial — un-audited)
-- Any other exception propagates fail-closed (AUD-CTX-05).
-- ---------------------------------------------------------------------------
create or replace function public.transition_task(
  p_task_id uuid,
  p_target_status text,
  p_mutation_key text default null,
  p_waiting_reason text default null,
  p_reviewer_comment text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  -- DM-SM-05 vocabulary (the tasks_status_check CHECK is the DB layer).
  c_states constant text[] := array[
    'open', 'in_progress', 'waiting', 'submitted',
    'returned', 'approved', 'done', 'cancelled'];
  v_task public.tasks;
  v_new public.tasks;
  v_comment public.task_comments;
  v_has_comment boolean := false;
  v_role text;
  v_membership uuid;
  v_reason text;
  v_in_scope boolean;
  v_legal boolean;
  v_four_eyes boolean := false;
begin
  -- Single-writer command context (transaction-local; pooled-request safe).
  perform pg_catalog.set_config('app.task_transition_command', '1', true);
  perform pg_catalog.set_config('app.audit_skip_trigger', '1', true);

  begin
    if (select auth.uid()) is null then
      v_reason := 'authentication required';
      raise exception 'authentication required' using errcode = 'CA401';
    end if;

    select * into v_task
    from public.tasks t
    where t.id = p_task_id
    for update;
    if not found then
      return jsonb_build_object(
        'status', 'denied', 'kind', 'not_found',
        'message', 'task not found');
    end if;

    -- AUTHORIZATION FIRST (API-ERR-02): nothing below runs for a caller who
    -- may not see the task — every failure returns the IDENTICAL not_found
    -- body as a nonexistent id. The row EXISTS here, so the attempt is a
    -- security-significant probe and IS audited server-side (AUD-FAIL-01).
    v_role := public.active_membership_role(v_task.firm_id);
    v_membership := public.active_membership_id(v_task.firm_id);

    if v_role in ('super_admin', 'partner') then
      v_in_scope := true;
    elsif v_role = 'manager' then
      v_in_scope := exists (
        select 1 from public.clients c
        where c.firm_id = v_task.firm_id
          and c.id = v_task.client_id
          and c.manager_membership_id = v_membership
      ) or coalesce(
        v_membership in (v_task.assignee_membership_id, v_task.reviewer_membership_id),
        false);
    elsif v_role in ('senior', 'article_executive') then
      -- NULL-safe (three-valued logic): a NULL membership or NULL assignment
      -- slots make IN yield NULL — coalesce forces unknown -> denied.
      v_in_scope := coalesce(
        v_membership in (v_task.assignee_membership_id, v_task.reviewer_membership_id),
        false);
    else
      -- NULL role (suspended/removed/foreign), billing,
      -- external_consultant: no transition right at all.
      v_in_scope := false;
    end if;

    if public.req_active_firm() is distinct from v_task.firm_id
       or v_role is null
       or not v_in_scope then
      perform public.audit_write(
        v_task.firm_id, 'human', (select auth.uid()),
        'task.transition_denied',
        'task', p_task_id::text,
        null, jsonb_build_object(
          'reason', 'task not visible to caller (API-ERR-02)',
          'to_status', p_target_status));
      return jsonb_build_object(
        'status', 'denied', 'kind', 'not_found',
        'message', 'task not found');
    end if;

    -- Target vocabulary: unknown statuses are malformed input (CA400 ->
    -- `validation`), never a legality conflict; reachable only post-gate.
    if not (p_target_status = any(c_states)) then
      v_reason := format('unknown target status %L (DM-SM-05 vocabulary)', p_target_status);
      raise exception '%', v_reason using errcode = 'CA400';
    end if;

    -- Idempotent replay: already in the target status. Only reachable by an
    -- authorized in-scope caller, so returning the row is no wider than the
    -- caller's own RLS read right.
    if v_task.status = p_target_status then
      if p_mutation_key is not null then
        return jsonb_build_object(
          'status', 'already_applied',
          'reason', 'already_in_target_status',
          'task', to_jsonb(v_task));
      end if;
      v_reason := format('task is already in status %s', p_target_status);
      raise exception '%', v_reason using errcode = 'CA402';
    end if;

    -- Legality (DM-SM-05 — the 15-edge set derived in the header comment).
    v_legal :=
      (v_task.status = 'open' and p_target_status = 'in_progress')
      or (v_task.status = 'in_progress' and p_target_status in ('waiting', 'submitted'))
      or (v_task.status = 'waiting' and p_target_status = 'in_progress')
      or (v_task.status = 'submitted' and p_target_status in ('approved', 'returned'))
      or (v_task.status = 'returned' and p_target_status = 'in_progress')
      or (v_task.status = 'approved' and p_target_status = 'done')
      or (v_task.status = 'done' and p_target_status = 'open')
      or (p_target_status = 'cancelled'
          and v_task.status in ('open', 'in_progress', 'waiting', 'submitted', 'returned', 'approved'));
    if not v_legal then
      v_reason := format(
        'invalid status transition %s -> %s (DM-SM-05)',
        v_task.status, p_target_status);
      raise exception '%', v_reason using errcode = 'CA402';
    end if;

    -- Four-eyes derivation: instance-linked task -> instance's compliance
    -- type (SCH-10 four_eyes_required). Ad-hoc tasks: not four-eyes.
    if v_task.compliance_instance_id is not null then
      select ct.four_eyes_required into v_four_eyes
      from public.compliance_instances ci
      join public.compliance_types ct on ct.id = ci.compliance_type_id
      where ci.firm_id = v_task.firm_id
        and ci.id = v_task.compliance_instance_id;
      -- Row existence is FK-proven and the column is NOT NULL; coalesce is
      -- defense in depth only (fail-closed: NULL -> not four-eyes can never
      -- occur, but never permits either).
      v_four_eyes := coalesce(v_four_eyes, false);
    end if;

    -- RLS-4EY-03 overlay: where four-eyes applies, the review decisions are
    -- performed ONLY by the assigned reviewer — no rank bypass.
    if v_four_eyes
       and v_task.status = 'submitted'
       and p_target_status in ('approved', 'returned')
       and (v_task.reviewer_membership_id is null
            or v_membership is distinct from v_task.reviewer_membership_id) then
      v_reason := 'submitted -> approved/returned must be performed by the assigned reviewer (RLS-4EY-03)';
      raise exception '%', v_reason using errcode = 'CA401';
    end if;

    -- senior/article: ordinary transitions only as the CURRENT assignee; a
    -- reviewer-only senior/article reaches exactly the four-eyes reviewer
    -- transitions (RLS-TSK-01 + RLS-4EY-03).
    if v_role in ('senior', 'article_executive')
       and v_membership is distinct from v_task.assignee_membership_id
       and not (v_four_eyes
                and v_task.status = 'submitted'
                and p_target_status in ('approved', 'returned')) then
      v_reason := 'senior/article may perform ordinary transitions only as the current assignee (RLS-TSK-01; reviewer-only transitions per RLS-4EY-03)';
      raise exception '%', v_reason using errcode = 'CA401';
    end if;

    -- Mandatory fields (SCH-13, TEST-SCH-16) — legality-class conflicts.
    if p_target_status = 'waiting'
       and nullif(btrim(coalesce(p_waiting_reason, '')), '') is null then
      v_reason := 'entering waiting requires a non-empty waiting_reason (DM-SM-05, SCH-13)';
      raise exception '%', v_reason using errcode = 'CA402';
    end if;
    if p_target_status = 'returned'
       and nullif(btrim(coalesce(p_reviewer_comment, '')), '') is null then
      v_reason := 'submitted -> returned requires a non-empty reviewer comment (SCH-13, RLS-4EY-03)';
      raise exception '%', v_reason using errcode = 'CA402';
    end if;

    update public.tasks
    set status = p_target_status,
        -- entering waiting stamps the reason; all other moves RETAIN any
        -- prior reason as history (documented header choice).
        waiting_reason = case
          when p_target_status = 'waiting' then btrim(p_waiting_reason)
          else waiting_reason
        end
    where id = v_task.id
    returning * into v_new;

    -- Atomic reviewer comment (RLS-4EY-03): an ordinary immutable SCH-16
    -- row, author server-stamped; rolls back with the transition on any
    -- failure. The Layer-A trigger on task_comments is suppressed by
    -- app.audit_skip_trigger — the Layer-B audit row below carries the
    -- comment snapshot (_reviewer_comment), so the operation is ONE audited
    -- mutation.
    if p_target_status = 'returned' then
      insert into public.task_comments (firm_id, task_id, author_id, body)
      values (v_new.firm_id, v_new.id, (select auth.uid()), btrim(p_reviewer_comment))
      returning * into v_comment;
      v_has_comment := true;
    end if;

    -- Authoritative Layer-B audit event, same transaction (the Layer-A
    -- trigger on tasks is skipped via app.audit_skip_trigger — no double
    -- audit).
    perform public.audit_write(
      v_new.firm_id, 'human', (select auth.uid()),
      'task.transition',
      'task', v_new.id::text,
      to_jsonb(v_task),
      to_jsonb(v_new)
        || case when p_mutation_key is not null
             then jsonb_build_object('_mutation_key', p_mutation_key)
             else '{}'::jsonb end
        || case when v_has_comment
             then jsonb_build_object('_reviewer_comment', to_jsonb(v_comment))
             else '{}'::jsonb end
        || case when v_task.status = 'done' and v_new.status = 'open'
             then jsonb_build_object('_reopen', true)
             else '{}'::jsonb end);

    return jsonb_build_object(
      'status', 'transitioned',
      'from_status', v_task.status,
      'to_status', v_new.status,
      'task', to_jsonb(v_new),
      'reviewer_comment', case when v_has_comment then to_jsonb(v_comment) end);
  exception
    -- Malformed input: client error, not a security-significant denial.
    when sqlstate 'CA400' then
      return jsonb_build_object('status', 'denied', 'kind', 'validation', 'message', v_reason);
    -- Post-authorization deliberate denials: audit the attempt
    -- (AUD-FAIL-01) and return a structured denial. Everything else
    -- (constraint violations, audit faults, internal errors) propagates
    -- fail-closed.
    when sqlstate 'CA401' or sqlstate 'CA402' then
      if (select auth.uid()) is not null then
        perform public.audit_write(
          v_task.firm_id, 'human', (select auth.uid()),
          'task.transition_denied',
          'task', p_task_id::text,
          null, jsonb_build_object(
            'reason', v_reason,
            'from_status', v_task.status,
            'to_status', p_target_status));
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

comment on function public.transition_task(uuid, text, text, text, text) is
  'IMP-040 Layer-B transition command (API-R0-TSK): the ONLY tasks.status change path (RLS-TSK-01). Authorization FIRST — pre-authorization context/role/scope failures return the API-ERR-02 not_found surface (audited server-side when the row exists); then DM-SM-05 legality (15-edge set), RLS-4EY-03 reviewer-only submitted->approved/returned with no rank bypass, senior/article current-assignee-only ordinary transitions, waiting_reason/returned-comment mandatory fields (the comment created atomically as an immutable SCH-16 row), mutation-key idempotent replay, reopen marked _reopen on the audit row; atomic mutation+audit; denials audited (AUD-FAIL-01). NO AAL2 (routine operational update, RLS-AAL-02).';

revoke all on function public.transition_task(uuid, text, text, text, text) from public, anon, service_role;
grant execute on function public.transition_task(uuid, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Layer-B commands: add_task_dependency / remove_task_dependency
-- (RLS-TSK-02; SCH-14 acyclicity; TEST-SCH-01/18/19/20).
--
-- Direct browser mutation of task_dependencies is CLOSED (no policies, no
-- grants above); these two SECURITY DEFINER commands are the only graph
-- write paths (API-ARCH-04; API-SEC-03 reviewed — no INVOKER variant can
-- write a grant-less table). Each performs its OWN authorization: actor
-- from auth.uid(), live ACTIVE same-firm membership (DEC-J), active-firm
-- selector match (RLS-CTX-02).
--
-- AUTHORIZATION FIRST (API-ERR-02), before ANY graph-disclosing validation:
--   super_admin/partner — firm-wide (both tasks in the active firm);
--   manager             — BOTH referenced tasks inside manager-authorized
--                         task scope (RLS-TSK-02: portfolio client OR
--                         directly assigned);
--   senior/article/billing/anon — denied.
-- Both tasks are resolved first (safe reads, no disclosure). If either id
-- is nonexistent OR the pair is cross-firm OR the caller is unauthorized,
-- the caller receives the IDENTICAL not_found body — no existence oracle,
-- no foreign-pair leak. A denial where BOTH task rows EXIST is audited
-- server-side (AUD-FAIL-01, bound to p_task_id); a probe touching a
-- nonexistent id is un-audited (nothing to bind).
--
-- Race safety (TEST-SCH-20, RLS-TSK-02): the add path takes a deterministic
-- transaction-scoped firm advisory lock BEFORE validation+insert
-- (pg_advisory_xact_lock(hashtextextended('caos-task-dep:' || firm_id, 0)) —
-- no earlier migration establishes an advisory-lock convention; this is the
-- first, documented here). Concurrent opposing edges (A -> B, B -> A) are
-- serialized on the firm key: the loser re-validates against the winner's
-- committed graph and its cycle check rejects. Lock + recursive validation
-- + insert are ONE atomic commit. The remove path keeps the symmetric
-- command shape but needs no lock (deletion cannot violate acyclicity).
--
-- Cycle rule (TEST-SCH-01): inserting (T depends_on D) closes a cycle iff T
-- is reachable from D by following existing depends_on edges — a recursive
-- CTE over task_dependencies, firm-scoped. Self-edge and duplicate pair are
-- rejected explicitly (machine-readable CA402 reasons) ahead of the
-- declarative CHECK/UNIQUE backstops.
--
-- Idempotency (API-MUT-03): add with a mutation key against an EXISTING
-- edge returns already_applied (edge_already_exists) with the row; remove
-- with a key against an ABSENT edge returns already_applied
-- (edge_already_absent). Keyless repeats are ordinary CA402 conflicts.
-- ---------------------------------------------------------------------------
create or replace function public.add_task_dependency(
  p_task_id uuid,
  p_depends_on_task_id uuid,
  p_dependency_type text default 'finish_to_start',
  p_mutation_key text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_task public.tasks;
  v_dep public.tasks;
  v_edge public.task_dependencies;
  v_role text;
  v_membership uuid;
  v_reason text;
  v_in_scope boolean;
  v_cycle boolean;
begin
  begin
    if (select auth.uid()) is null then
      raise exception 'authentication required' using errcode = 'CA401';
    end if;

    -- Safe resolution, no disclosure either way.
    select * into v_task from public.tasks t where t.id = p_task_id;
    select * into v_dep from public.tasks t where t.id = p_depends_on_task_id;
    if v_task.id is null or v_dep.id is null then
      return jsonb_build_object(
        'status', 'denied', 'kind', 'not_found',
        'message', 'task not found');
    end if;

    -- AUTHORIZATION FIRST (API-ERR-02): both rows EXIST here, so a denial
    -- is security-significant and IS audited (bound to p_task_id).
    v_role := public.active_membership_role(v_task.firm_id);
    v_membership := public.active_membership_id(v_task.firm_id);

    if v_task.firm_id is distinct from v_dep.firm_id then
      -- Cross-firm pair: never authorized (the composite FKs would also
      -- reject the insert; the command denies first, without disclosure).
      v_in_scope := false;
    elsif v_role in ('super_admin', 'partner') then
      v_in_scope := true;
    elsif v_role = 'manager' then
      v_in_scope :=
        (exists (
           select 1 from public.clients c
           where c.firm_id = v_task.firm_id and c.id = v_task.client_id
             and c.manager_membership_id = v_membership)
         or coalesce(
              v_membership in (v_task.assignee_membership_id, v_task.reviewer_membership_id),
              false))
        and
        (exists (
           select 1 from public.clients c
           where c.firm_id = v_dep.firm_id and c.id = v_dep.client_id
             and c.manager_membership_id = v_membership)
         or coalesce(
              v_membership in (v_dep.assignee_membership_id, v_dep.reviewer_membership_id),
              false));
    else
      -- NULL role (suspended/removed/foreign), senior, article_executive,
      -- billing, external_consultant: no dependency-graph right at all.
      v_in_scope := false;
    end if;

    if public.req_active_firm() is distinct from v_task.firm_id
       or v_task.firm_id is distinct from v_dep.firm_id
       or v_role is null
       or not v_in_scope then
      perform public.audit_write(
        v_task.firm_id, 'human', (select auth.uid()),
        'task_dependency.add_denied',
        'task', p_task_id::text,
        null, jsonb_build_object(
          'reason', 'task pair not visible to caller (API-ERR-02)',
          'depends_on_task_id', p_depends_on_task_id));
      return jsonb_build_object(
        'status', 'denied', 'kind', 'not_found',
        'message', 'task not found');
    end if;

    -- Firm-scoped serialization: everything below (validation + insert) is
    -- atomic against concurrent dependency adds in this firm (TEST-SCH-20).
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('caos-task-dep:' || v_task.firm_id::text, 0));

    if p_task_id = p_depends_on_task_id then
      v_reason := 'a task cannot depend on itself (SCH-14)';
      raise exception '%', v_reason using errcode = 'CA402';
    end if;

    select * into v_edge
    from public.task_dependencies d
    where d.firm_id = v_task.firm_id
      and d.task_id = p_task_id
      and d.depends_on_task_id = p_depends_on_task_id;
    if found then
      if p_mutation_key is not null then
        return jsonb_build_object(
          'status', 'already_applied',
          'reason', 'edge_already_exists',
          'dependency', to_jsonb(v_edge));
      end if;
      v_reason := 'dependency edge already exists (SCH-14)';
      raise exception '%', v_reason using errcode = 'CA402';
    end if;

    -- Cycle: (T depends_on D) closes a cycle iff T is reachable from D
    -- following existing depends_on edges within this firm.
    with recursive walk(id) as (
      select d.depends_on_task_id
      from public.task_dependencies d
      where d.firm_id = v_task.firm_id and d.task_id = p_depends_on_task_id
      union
      select d.depends_on_task_id
      from public.task_dependencies d
      join walk w on d.task_id = w.id
      where d.firm_id = v_task.firm_id
    )
    select exists (select 1 from walk where id = p_task_id) into v_cycle;
    if v_cycle then
      v_reason := 'dependency would create a cycle (SCH-14, DM-OQ-04)';
      raise exception '%', v_reason using errcode = 'CA402';
    end if;

    insert into public.task_dependencies (firm_id, task_id, depends_on_task_id, dependency_type)
    values (
      v_task.firm_id, p_task_id, p_depends_on_task_id,
      coalesce(nullif(btrim(coalesce(p_dependency_type, '')), ''), 'finish_to_start'))
    returning * into v_edge;

    -- Layer-B audit (task_dependencies carries no Layer-A trigger — the
    -- commands own the graph's audit trail entirely).
    perform public.audit_write(
      v_edge.firm_id, 'human', (select auth.uid()),
      'task_dependency.add',
      'task_dependency', v_edge.id::text,
      null,
      to_jsonb(v_edge) || case
        when p_mutation_key is not null
          then jsonb_build_object('_mutation_key', p_mutation_key)
        else '{}'::jsonb
      end);

    return jsonb_build_object('status', 'added', 'dependency', to_jsonb(v_edge));
  exception
    when sqlstate 'CA401' or sqlstate 'CA402' then
      if (select auth.uid()) is not null and v_task.id is not null then
        perform public.audit_write(
          v_task.firm_id, 'human', (select auth.uid()),
          'task_dependency.add_denied',
          'task', p_task_id::text,
          null, jsonb_build_object(
            'reason', v_reason,
            'depends_on_task_id', p_depends_on_task_id));
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

comment on function public.add_task_dependency(uuid, uuid, text, text) is
  'IMP-040 Layer-B dependency add (RLS-TSK-02): the ONLY graph insert path. Authorization FIRST (admin/partner firm-wide; manager BOTH tasks in scope; others denied) with the API-ERR-02 uniform not_found (existing-pair denials audited, AUD-FAIL-01); then firm-scoped pg_advisory_xact_lock -> self-edge/duplicate/cycle (recursive CTE) rejection -> insert, ONE atomic commit (TEST-SCH-01/20); mutation-key idempotent; Layer-B audit (no Layer-A trigger on task_dependencies).';

revoke all on function public.add_task_dependency(uuid, uuid, text, text) from public, anon, service_role;
grant execute on function public.add_task_dependency(uuid, uuid, text, text) to authenticated;

create or replace function public.remove_task_dependency(
  p_task_id uuid,
  p_depends_on_task_id uuid,
  p_mutation_key text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_task public.tasks;
  v_dep public.tasks;
  v_edge public.task_dependencies;
  v_role text;
  v_membership uuid;
  v_reason text;
  v_in_scope boolean;
begin
  begin
    if (select auth.uid()) is null then
      raise exception 'authentication required' using errcode = 'CA401';
    end if;

    select * into v_task from public.tasks t where t.id = p_task_id;
    select * into v_dep from public.tasks t where t.id = p_depends_on_task_id;
    if v_task.id is null or v_dep.id is null then
      return jsonb_build_object(
        'status', 'denied', 'kind', 'not_found',
        'message', 'task not found');
    end if;

    -- Same authorization as add (RLS-TSK-02 — symmetric command shape).
    v_role := public.active_membership_role(v_task.firm_id);
    v_membership := public.active_membership_id(v_task.firm_id);

    if v_task.firm_id is distinct from v_dep.firm_id then
      v_in_scope := false;
    elsif v_role in ('super_admin', 'partner') then
      v_in_scope := true;
    elsif v_role = 'manager' then
      v_in_scope :=
        (exists (
           select 1 from public.clients c
           where c.firm_id = v_task.firm_id and c.id = v_task.client_id
             and c.manager_membership_id = v_membership)
         or coalesce(
              v_membership in (v_task.assignee_membership_id, v_task.reviewer_membership_id),
              false))
        and
        (exists (
           select 1 from public.clients c
           where c.firm_id = v_dep.firm_id and c.id = v_dep.client_id
             and c.manager_membership_id = v_membership)
         or coalesce(
              v_membership in (v_dep.assignee_membership_id, v_dep.reviewer_membership_id),
              false));
    else
      v_in_scope := false;
    end if;

    if public.req_active_firm() is distinct from v_task.firm_id
       or v_task.firm_id is distinct from v_dep.firm_id
       or v_role is null
       or not v_in_scope then
      perform public.audit_write(
        v_task.firm_id, 'human', (select auth.uid()),
        'task_dependency.remove_denied',
        'task', p_task_id::text,
        null, jsonb_build_object(
          'reason', 'task pair not visible to caller (API-ERR-02)',
          'depends_on_task_id', p_depends_on_task_id));
      return jsonb_build_object(
        'status', 'denied', 'kind', 'not_found',
        'message', 'task not found');
    end if;

    -- No advisory lock needed: deletion cannot violate acyclicity.
    delete from public.task_dependencies d
    where d.firm_id = v_task.firm_id
      and d.task_id = p_task_id
      and d.depends_on_task_id = p_depends_on_task_id
    returning * into v_edge;
    if not found then
      if p_mutation_key is not null then
        return jsonb_build_object(
          'status', 'already_applied',
          'reason', 'edge_already_absent',
          'task_id', p_task_id,
          'depends_on_task_id', p_depends_on_task_id);
      end if;
      v_reason := 'dependency edge does not exist (SCH-14)';
      raise exception '%', v_reason using errcode = 'CA402';
    end if;

    perform public.audit_write(
      v_edge.firm_id, 'human', (select auth.uid()),
      'task_dependency.remove',
      'task_dependency', v_edge.id::text,
      to_jsonb(v_edge),
      case when p_mutation_key is not null
        then jsonb_build_object('_mutation_key', p_mutation_key)
        else null
      end);

    return jsonb_build_object(
      'status', 'removed',
      'task_id', p_task_id,
      'depends_on_task_id', p_depends_on_task_id);
  exception
    when sqlstate 'CA401' or sqlstate 'CA402' then
      if (select auth.uid()) is not null and v_task.id is not null then
        perform public.audit_write(
          v_task.firm_id, 'human', (select auth.uid()),
          'task_dependency.remove_denied',
          'task', p_task_id::text,
          null, jsonb_build_object(
            'reason', v_reason,
            'depends_on_task_id', p_depends_on_task_id));
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

comment on function public.remove_task_dependency(uuid, uuid, text) is
  'IMP-040 Layer-B dependency remove (RLS-TSK-02): the ONLY graph delete path. Same authorization-FIRST posture as add (uniform not_found; existing-pair denials audited, AUD-FAIL-01); no advisory lock (deletion cannot violate acyclicity); mutation-key idempotent (edge_already_absent); Layer-B audit with the removed edge snapshot.';

revoke all on function public.remove_task_dependency(uuid, uuid, text) from public, anon, service_role;
grant execute on function public.remove_task_dependency(uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Layer-A audit (IMP-013 foundation; spec 08 §7b task audit partition):
-- baseline trigger audit covers ordinary permitted non-state task writes,
-- checklist writes, and comment append/retraction (tasks MEDIUM-HIGH,
-- comments MEDIUM). The mapping is extended via the established
-- create-or-replace mechanism (IMP-020/021/030/031 precedent) — committed
-- migration files stay immutable.
--   * Attached: tasks, task_checklist_items, task_comments.
--   * NOT attached: task_dependencies — direct mutation is closed, so every
--     graph change is a Layer-B command event (add/remove/denied); a Layer-A
--     trigger would have nothing legitimate to capture.
-- transition_task sets app.audit_skip_trigger and writes the authoritative
-- task.transition row itself (including the atomic reviewer comment under
-- _reviewer_comment) — no trigger+command double logging.
-- AUD-VAL-02 redaction review for SCH-13/15/16: titles, descriptions,
-- next_action, status, assignments, waiting reasons, checklist lines and
-- comment bodies are exactly what the audit trail must preserve; no
-- secrets-adjacent columns exist; none redacted.
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
  'IMP-013 Layer-A audit trigger (AUD-CTX-01), mapping extended by IMP-020 (SCH-04…08), IMP-021 (SCH-09), IMP-030 (SCH-10/32), IMP-031 (SCH-11/12), and IMP-040 (SCH-13/15/16 — task_dependencies deliberately unmapped; the Layer-B commands own graph audit). Actor from auth.uid()/jwt role only; firm/object from the row. DEFINER solely so application roles without audit_log INSERT privilege can be audited; owner-only EXECUTE.';

create trigger tasks_audit_row
  after insert or update or delete on public.tasks
  for each row execute function public.audit_trg_row();

create trigger task_checklist_items_audit_row
  after insert or update or delete on public.task_checklist_items
  for each row execute function public.audit_trg_row();

create trigger task_comments_audit_row
  after insert or update or delete on public.task_comments
  for each row execute function public.audit_trg_row();

-- ---------------------------------------------------------------------------
-- Notes for reviewers (PASS B)
-- ---------------------------------------------------------------------------
-- * No DELETE exists for anyone on tasks / task_comments / task_dependencies
--   (lifecycle states / immutability; audit-sensitive tables are never
--   hard-deleted, spec 06 conventions). Checklist lines are the one
--   removable child (DM-14), governed by the parent-task scope.
-- * The transition command performs NO event publication (task.created /
--   assigned / completed stay deferred to the AUTO-OQ-02 mechanism,
--   IMP-050) and spawns nothing beyond the atomic reviewer comment.
-- * The x-active-firm selector is untrusted context everywhere: without a
--   live ACTIVE membership of the required role it selects nothing
--   (RLS-CTX-02), and suspended/removed memberships authorize nothing on the
--   next statement with the same JWT (DEC-J, RLS-STF-07).
-- * waiting_reason retention: entering waiting stamps the (required) reason;
--   leaving waiting RETAINS it as history (spec silent — documented in the
--   transition_task header). A later transition back into waiting overwrites
--   it with the new reason.
-- * task_dependencies SELECT requires BOTH endpoints visible (contract
--   ruling: API-ERR-02, spec 07 §145-160 — never reveal whether a resource
--   exists outside the caller's scope; RLS-A-03, spec 05 §506-510 — the
--   analogous two-endpoint relationship row requires both endpoints in
--   scope for READ and WRITE). Either-endpoint visibility was REJECTED: it
--   leaks the hidden endpoint's existence/UUID/relationship/type/timestamp
--   in both edge directions (independent-review live probe).
-- * Advisory-lock convention introduced here (first use in the repository):
--   pg_advisory_xact_lock(hashtextextended('caos-task-dep:' || firm_id, 0))
--   — deterministic per firm, transaction-scoped (auto-released at commit),
--   taken ONLY by add_task_dependency after the authorization gate, so an
--   unauthorized caller can never hold the lock.
