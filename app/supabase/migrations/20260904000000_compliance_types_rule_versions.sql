-- IMP-030 — Compliance types & rule versions (SCH-10, SCH-32)
--
-- Implements exactly the two tables owned by this package:
--   public.compliance_types         (SCH-10 — DM-10 rule objects)
--   public.compliance_rule_versions (SCH-32 — immutable, effective-dated
--                                    recurrence/due-rule versions)
-- with production RLS (RLS-CTY-01, RLS-CRV-01…05), the controlled Layer-B
-- activation command (API-R0-CRV), and Layer-A/B audit integration
-- (AUD-CRV-01…03, AUD-FAIL-01).
--
-- Requirement IDs: DM-10, DM-27 (matrix host only — scope columns), SCH-10,
-- SCH-32, RLS-CTY-01, RLS-CRV-01…05, RLS-AAL-01, RLS-CTX-01/02,
-- RLS-MECH-01 (DEC-J), TEN-06…08, AUD-CRV-01…03, AUD-FAIL-01,
-- OPS-ACT-01…03, API-R0-CTY, API-R0-CRV, MIG-SEED-02 (seed.sql side).
--
-- Explicitly NOT here (package non-goals):
--   * client_compliance_profiles / compliance_instances (IMP-031)
--   * recurrence generation / scheduler (IMP-050), alerts (IMP-051)
--   * statutory production activation (external CA/domain sign-off gate,
--     DM-OQ-01/OPS-OQ-04 — seeded statutory versions stay draft/pending)
--   * the pending→approved approval command (no browser-facing R0 path;
--     OPS-OQ-04 deferred operator path)
--   * UI screens (no UI package owned by IMP-030)
--
-- Trust model (unchanged from IMP-012/013): auth.uid() is identity only;
-- every authorization check is a LIVE FirmMembership read (DEC-J); the
-- x-active-firm header is untrusted context validated against live
-- membership on every statement (RLS-CTX-02). The activation command is
-- firm-owned only and rejects NULL-firm_id system-default versions
-- fail-closed (TEN-08, RLS-CRV-03).

-- ---------------------------------------------------------------------------
-- btree_gist: GiST equality for uuid, required by the SCH-32 exclusion
-- constraint (non-overlapping active effective windows per type).
-- ---------------------------------------------------------------------------
create extension if not exists btree_gist with schema extensions;

-- ---------------------------------------------------------------------------
-- DM-SM-04 workflow-template validator (SCH-10 invariant). Immutable pure
-- validation: the template's states array must be a non-empty path over the
-- DM-SM-04 compliance state vocabulary. EXECUTE is intentionally left
-- granted: CHECK-constraint expressions evaluate with the DML caller's
-- privileges, so revoking EXECUTE would break legitimate inserts. The
-- function is read-only and validates data only — no security surface.
-- ---------------------------------------------------------------------------
create or replace function public.compliance_workflow_template_valid(p_template jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(p_template -> 'states') = 'array'
     and jsonb_array_length(p_template -> 'states') > 0
     and not exists (
           select 1
           from jsonb_array_elements_text(p_template -> 'states') as s(state)
           where s.state not in (
             'not_started', 'information_requested', 'information_received',
             'preparation', 'internal_review', 'client_approval',
             'ready_to_file', 'filed', 'acknowledgement_received', 'closed'
           )
         )
$$;

comment on function public.compliance_workflow_template_valid(jsonb) is
  'IMP-030 SCH-10 invariant: workflow_template states must be a non-empty path over the DM-SM-04 vocabulary. EXECUTE granted (CHECK constraints evaluate as the DML caller).';

-- ---------------------------------------------------------------------------
-- SCH-10 — compliance_types
-- Hybrid ownership (TEN-06…08): NULL firm_id = system default (writable only
-- by deployment/seed — no application-role write policy exists); non-NULL =
-- firm-owned override/custom type.
-- ---------------------------------------------------------------------------
create table public.compliance_types (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid,
  type_key text not null,
  name text not null,
  category text not null,
  authority text,
  frequency text not null,
  due_rule jsonb not null,
  applicability jsonb,
  required_documents jsonb,
  checklist_template jsonb,
  workflow_template jsonb not null,
  client_approval_required bool not null default false,
  filing_confirmation_required bool not null default true,
  acknowledgement_required bool not null default true,
  four_eyes_required bool not null default true,
  scope_kind text not null default 'configurable',
  registration_class text,
  -- Single authoritative statutory classification (R0 closure 2026-09-03).
  -- Deliberately NO default: every type is explicitly classified at insert
  -- (fail-closed). Never inferred from category/caller input/approval state.
  governance_class text not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  constraint compliance_types_frequency_check
    check (frequency in ('monthly', 'quarterly', 'annual', 'event', 'custom')),
  constraint compliance_types_scope_kind_check
    check (scope_kind in ('entity', 'registration', 'configurable')),
  constraint compliance_types_registration_class_check
    check (scope_kind <> 'registration' or registration_class is not null),
  constraint compliance_types_governance_class_check
    check (governance_class in ('statutory', 'non_statutory')),
  constraint compliance_types_status_check
    check (status in ('active', 'deprecated')),
  constraint compliance_types_workflow_template_check
    check (public.compliance_workflow_template_valid(workflow_template)),
  constraint compliance_types_firm_fkey
    foreign key (firm_id) references public.firms (id) on delete restrict,
  -- SCH-10: one system default + one override per firm per key
  -- (NULLS NOT DISTINCT, SCH-A-03).
  constraint compliance_types_type_key_firm_unique
    unique nulls not distinct (type_key, firm_id)
);

comment on table public.compliance_types is 'SCH-10: compliance rule objects (DM-10). NULL firm_id = system default (TEN-08: deployment/seed writes only); non-NULL = firm override/custom. governance_class is the single authoritative statutory classification (fail-closed, no default).';

create index compliance_types_type_key_idx on public.compliance_types (type_key);
create index compliance_types_firm_idx on public.compliance_types (firm_id);

create trigger compliance_types_set_updated_at
  before update on public.compliance_types
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Governance inheritance (SCH-10, R0 closure 2026-09-03): a firm override
-- whose type_key matches a system default inherits that default's
-- governance_class — a firm can NEVER turn a statutory type non-statutory
-- to bypass the approval gate. Mismatch is rejected; the caller must supply
-- the inherited value explicitly (fail-closed, no silent rewrite).
--
-- SECURITY DEFINER is mandatory here, not a convenience: under FORCE RLS an
-- INVOKER check could be blind to the system-default row (RLS scoping) and
-- silently skip the inheritance enforcement. DEFINER reads exactly the
-- system row's governance_class — nothing else.
-- ---------------------------------------------------------------------------
create or replace function public.compliance_types_enforce_governance_inheritance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_system_class text;
begin
  if new.firm_id is not null then
    select c.governance_class into v_system_class
    from public.compliance_types c
    where c.firm_id is null
      and c.type_key = new.type_key;
    if found and new.governance_class is distinct from v_system_class then
      raise exception
        'firm override of system compliance type % must inherit governance_class=%',
        new.type_key, v_system_class
        using errcode = '23514',
              detail = 'GOVERNANCE_INHERITANCE:compliance_types.governance_class';
    end if;
  end if;
  return new;
end;
$$;

comment on function public.compliance_types_enforce_governance_inheritance() is
  'IMP-030 SCH-10 governance inheritance: firm overrides of a system type_key inherit its governance_class; statutory downgrade is rejected (TEST-SCH-11). DEFINER so enforcement never depends on caller RLS visibility.';

revoke all on function public.compliance_types_enforce_governance_inheritance() from public, anon, authenticated, service_role;

create trigger compliance_types_governance_inheritance
  before insert or update of type_key, governance_class, firm_id
  on public.compliance_types
  for each row execute function public.compliance_types_enforce_governance_inheritance();

-- ---------------------------------------------------------------------------
-- SCH-32 — compliance_rule_versions
-- Immutable, effective-dated versions of a type's frequency/due-rule
-- definition. Column classes (R0 closure 2026-09-03):
--   A rule content  : firm_id, compliance_type_id, version, effective_from,
--                     frequency, due_rule — draft-editable; frozen forever
--                     once the version leaves draft (or is referenced by a
--                     compliance instance — IMP-031 extends the guard).
--   B lifecycle     : status, effective_to — ONLY via the controlled
--                     Layer-B lifecycle command (app.crv_lifecycle_command).
--   C provenance    : id, created_by, created_at — insert-only.
--   D governance    : domain_approval_status — derived/stamped at insert;
--                     no UPDATE path in R0 (deferred operator approval path,
--                     OPS-OQ-04); the activation command never mutates it.
-- Deliberately NO updated_at (spec 06 Conventions exception): versions are
-- historical records; created_at + audit_log carry change provenance.
-- ---------------------------------------------------------------------------
create table public.compliance_rule_versions (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid,
  compliance_type_id uuid not null,
  version int not null,
  effective_from date not null,
  effective_to date,
  frequency text not null,
  due_rule jsonb not null,
  status text not null default 'draft',
  domain_approval_status text not null default 'not_required',
  created_by uuid,
  created_at timestamptz not null default now(),
  constraint crv_frequency_check
    check (frequency in ('monthly', 'quarterly', 'annual', 'event', 'custom')),
  constraint crv_status_check
    check (status in ('draft', 'active', 'superseded', 'deprecated')),
  constraint crv_domain_approval_status_check
    check (domain_approval_status in ('not_required', 'pending', 'approved')),
  constraint crv_version_positive check (version > 0),
  -- Half-open windows [effective_from, effective_to): end EXCLUSIVE,
  -- strictly greater (zero-length windows invalid), NULL = open-ended.
  constraint crv_window_valid
    check (effective_to is null or effective_to > effective_from),
  constraint crv_compliance_type_fkey
    foreign key (compliance_type_id) references public.compliance_types (id) on delete restrict,
  constraint crv_firm_fkey
    foreign key (firm_id) references public.firms (id) on delete restrict,
  -- SCH-RESP-02: actor identity reference (rule-version creator).
  constraint crv_created_by_fkey
    foreign key (created_by) references auth.users (id) on delete restrict,
  constraint crv_type_version_unique
    unique (compliance_type_id, version),
  -- SCH-32 / TEST-SCH-10: among ACTIVE versions of one type, effective
  -- windows must not overlap (touching half-open boundaries are legal;
  -- multiple disjoint active versions incl. future-effective are valid).
  -- Enforced at the database layer, concurrency-safe — never application
  -- code alone.
  constraint crv_no_active_window_overlap exclude using gist (
    compliance_type_id with =,
    pg_catalog.daterange(effective_from, coalesce(effective_to, 'infinity'::date), '[)') with &&
  ) where (status = 'active')
);

comment on table public.compliance_rule_versions is 'SCH-32: immutable effective-dated rule versions (AUTO-REC-07/09). NULL firm_id = system default (TEN-08). Active/referenced rule content is frozen; lifecycle metadata moves only via the controlled activation command; statutory activation requires domain_approval_status=approved (DM-OQ-01). No updated_at by design.';

create index crv_type_status_idx on public.compliance_rule_versions (compliance_type_id, status);
create index crv_firm_idx on public.compliance_rule_versions (firm_id);

-- ---------------------------------------------------------------------------
-- Insert preparation (SCH-32): firm scope is inherited from the parent type
-- (a firm-override type yields firm-owned versions; mismatch rejected);
-- domain_approval_status and created_by are server-controlled on the request
-- path — the caller can never supply them (grants below exclude them, this
-- trigger derives/stamps them):
--   request path (auth.uid() present): statutory parent -> 'pending';
--     non-statutory parent -> 'not_required'; created_by := auth.uid().
--   operator/seed path (no request JWT): the governance invariant is
--     validated instead — statutory can never carry 'not_required'
--     (bypass denial, TEST-SCH-11); non-statutory must carry 'not_required'.
--     This path exists so seeds can record 'pending' and controlled test
--     setup can stage an 'approved' version (never reachable from a
--     browser role).
-- DEFINER so the parent-type read never depends on caller RLS visibility.
-- ---------------------------------------------------------------------------
create or replace function public.crv_prepare_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_type_firm uuid;
  v_type_governance text;
begin
  select c.firm_id, c.governance_class
    into v_type_firm, v_type_governance
  from public.compliance_types c
  where c.id = new.compliance_type_id;
  if not found then
    raise exception 'compliance_type_id does not exist' using errcode = '23503';
  end if;

  if new.firm_id is distinct from v_type_firm then
    raise exception 'rule-version firm scope is inherited from its compliance type (SCH-32)'
      using errcode = '23514',
            detail = 'IMMUTABLE_FIELD:compliance_rule_versions.firm_id';
  end if;

  if (select auth.uid()) is not null then
    new.domain_approval_status := case
      when v_type_governance = 'statutory' then 'pending'
      else 'not_required'
    end;
    new.created_by := (select auth.uid());
  else
    if v_type_governance = 'statutory' and new.domain_approval_status = 'not_required' then
      raise exception 'a statutory rule version can never carry not_required (SCH-32 gate)'
        using errcode = '23514',
              detail = 'GOVERNANCE_INHERITANCE:compliance_rule_versions.domain_approval_status';
    end if;
    if v_type_governance = 'non_statutory' and new.domain_approval_status <> 'not_required' then
      raise exception 'a non-statutory rule version must carry not_required'
        using errcode = '23514',
              detail = 'GOVERNANCE_INHERITANCE:compliance_rule_versions.domain_approval_status';
    end if;
  end if;

  return new;
end;
$$;

comment on function public.crv_prepare_insert() is
  'IMP-030 SCH-32 insert path: firm scope inherited from the parent type; approval state derived (request) or validated (operator/seed); created_by stamped from auth.uid(). Caller can never manufacture approval state.';

revoke all on function public.crv_prepare_insert() from public, anon, authenticated, service_role;

create trigger crv_prepare_insert
  before insert on public.compliance_rule_versions
  for each row execute function public.crv_prepare_insert();

-- ---------------------------------------------------------------------------
-- Update guard (SCH-32 column classes, RLS-CRV-04). INVOKER is sufficient —
-- it compares OLD/NEW and a transaction-local command flag only.
--   * class C (id/created_by/created_at): never rewritten, any path.
--   * class D (domain_approval_status): no UPDATE path in R0 — not ordinary
--     CRUD, not the activation command (deferred operator path, OPS-OQ-04).
--   * class B (status/effective_to): only under the transaction-local
--     app.crv_lifecycle_command flag set by the controlled Layer-B command;
--     ordinary UPDATE can never perform a lifecycle transition
--     (TEST-RLS-CRV-12).
--   * class A (rule content): editable only on a draft row without a
--     lifecycle change; frozen forever once the version leaves draft or is
--     referenced (IMP-031 will extend this guard with the instance-
--     reference condition — the non-draft freeze already covers it).
--   * parentage (firm_id/compliance_type_id) never moves, even on drafts.
-- Markers follow the established API-ERR convention: IMMUTABLE_FIELD: and
-- INVALID_TRANSITION: map to `conflict` (API-ERR-01).
-- ---------------------------------------------------------------------------
create or replace function public.crv_guard_update()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  -- coalesce: an unset GUC yields NULL, and `not NULL` would silently skip
  -- the guard (three-valued logic) — the flag must be exactly '1'.
  v_command boolean := coalesce(current_setting('app.crv_lifecycle_command', true), '') = '1';
begin
  if new.id is distinct from old.id
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception 'creation/provenance fields are insert-only (SCH-32 class C)'
      using errcode = '23514',
            detail = 'IMMUTABLE_FIELD:compliance_rule_versions.provenance';
  end if;

  if new.domain_approval_status is distinct from old.domain_approval_status then
    raise exception 'domain_approval_status has no update path in R0 (SCH-32 class D; deferred operator path, OPS-OQ-04)'
      using errcode = '23514',
            detail = 'IMMUTABLE_FIELD:compliance_rule_versions.domain_approval_status';
  end if;

  if (new.status is distinct from old.status
      or new.effective_to is distinct from old.effective_to)
     and not v_command then
    raise exception 'lifecycle metadata changes only through the controlled lifecycle command (SCH-32 class B)'
      using errcode = '23514',
            detail = 'INVALID_TRANSITION:compliance_rule_versions.lifecycle';
  end if;

  if new.firm_id is distinct from old.firm_id
     or new.compliance_type_id is distinct from old.compliance_type_id then
    raise exception 'rule-version firm scope and parent type never change (SCH-32)'
      using errcode = '23514',
            detail = 'IMMUTABLE_FIELD:compliance_rule_versions.parentage';
  end if;

  if (old.status <> 'draft' or new.status is distinct from old.status)
     and (new.version is distinct from old.version
          or new.effective_from is distinct from old.effective_from
          or new.frequency is distinct from old.frequency
          or new.due_rule is distinct from old.due_rule) then
    raise exception 'rule-content fields are frozen once the version leaves draft (SCH-32 class A)'
      using errcode = '23514',
            detail = 'IMMUTABLE_FIELD:compliance_rule_versions.rule_content';
  end if;

  return new;
end;
$$;

comment on function public.crv_guard_update() is
  'IMP-030 SCH-32 column-class guard (RLS-CRV-04): provenance insert-only; approval state has no update path; lifecycle metadata only via the controlled command; rule content frozen once non-draft. Command can never rewrite rule payload (TEST-RLS-CRV-12).';

revoke all on function public.crv_guard_update() from public, anon, authenticated, service_role;

create trigger crv_guard_update
  before update on public.compliance_rule_versions
  for each row execute function public.crv_guard_update();

-- ---------------------------------------------------------------------------
-- RLS — compliance_types (RLS-CTY-01; FORCE per RLS-PRIN-02)
--   read   : super_admin/partner/manager with a live ACTIVE membership in
--            the selected firm see the merged catalogue (system defaults +
--            that firm's overrides). senior/article/billing: no R0 surface
--            (05 §11 matrix ✖; assigned-work scope requires IMP-031
--            instances — same recorded deferral as IMP-020/021).
--   write  : firm-owned rows only, super_admin/partner, AAL2 (RLS-AAL-01:
--            security-configuration change). System-default rows have no
--            application-role write path (TEN-08).
--   delete : none, for anyone.
-- ---------------------------------------------------------------------------
alter table public.compliance_types enable row level security;
alter table public.compliance_types force row level security;

create policy compliance_types_select_scoped on public.compliance_types
  for select to authenticated
  using (
    public.active_membership_role(public.req_active_firm()) in ('super_admin', 'partner', 'manager')
    and (firm_id is null or firm_id = public.req_active_firm())
  );

create policy compliance_types_insert_privileged_aal2 on public.compliance_types
  for insert to authenticated
  with check (
    firm_id is not null
    and firm_id = public.req_active_firm()
    and public.active_membership_role(firm_id) in ('super_admin', 'partner')
    and (select auth.jwt() ->> 'aal') = 'aal2'
  );

create policy compliance_types_update_privileged_aal2 on public.compliance_types
  for update to authenticated
  using (
    firm_id is not null
    and firm_id = public.req_active_firm()
    and public.active_membership_role(firm_id) in ('super_admin', 'partner')
    and (select auth.jwt() ->> 'aal') = 'aal2'
  )
  with check (
    firm_id is not null
    and firm_id = public.req_active_firm()
    and public.active_membership_role(firm_id) in ('super_admin', 'partner')
    and (select auth.jwt() ->> 'aal') = 'aal2'
  );

revoke all on public.compliance_types from anon, authenticated;
grant select on public.compliance_types to authenticated;
-- id/created_at/updated_at server-managed; status defaults to 'active'.
grant insert (firm_id, type_key, name, category, authority, frequency, due_rule,
              applicability, required_documents, checklist_template, workflow_template,
              client_approval_required, filing_confirmation_required,
              acknowledgement_required, four_eyes_required,
              scope_kind, registration_class, governance_class)
  on public.compliance_types to authenticated;
-- type_key and governance_class are insert-time identity/classification —
-- never mutable (governance inheritance is insert-enforced); firm_id/id are
-- immutable parentage.
grant update (name, category, authority, frequency, due_rule,
              applicability, required_documents, checklist_template, workflow_template,
              client_approval_required, filing_confirmation_required,
              acknowledgement_required, four_eyes_required,
              scope_kind, registration_class, status)
  on public.compliance_types to authenticated;

-- ---------------------------------------------------------------------------
-- RLS — compliance_rule_versions (RLS-CRV-01/02/04; FORCE per RLS-PRIN-02)
--   read   : super_admin/partner see all statuses (system defaults + own
--            firm); manager sees status='active' only (RLS-CRV-01:
--            non-active versions are never exposed to ordinary staff);
--            senior/article/billing: no R0 surface (05 §11; IMP-031
--            deferral). Cross-tenant versions are never visible.
--   insert : firm-owned drafts only, super_admin/partner, AAL2. The caller
--            never supplies an authoritative firm_id beyond the validated
--            selector value (API-CONV-05), status (forced default 'draft'),
--            domain_approval_status (derived), created_by (stamped), or
--            effective_to (class-B lifecycle metadata — command-owned).
--   update : draft-edit of class-A payload columns only (effective_from,
--            frequency, due_rule), super_admin/partner, AAL2 — the
--            crv_guard_update trigger enforces the class model on top.
--   delete : none — versions are historical records (SCH-32 lifecycle).
-- ---------------------------------------------------------------------------
alter table public.compliance_rule_versions enable row level security;
alter table public.compliance_rule_versions force row level security;

create policy crv_select_privileged on public.compliance_rule_versions
  for select to authenticated
  using (
    public.active_membership_role(public.req_active_firm()) in ('super_admin', 'partner')
    and (firm_id is null or firm_id = public.req_active_firm())
  );

create policy crv_select_manager_active on public.compliance_rule_versions
  for select to authenticated
  using (
    status = 'active'
    and public.active_membership_role(public.req_active_firm()) = 'manager'
    and (firm_id is null or firm_id = public.req_active_firm())
  );

create policy crv_insert_privileged_aal2 on public.compliance_rule_versions
  for insert to authenticated
  with check (
    firm_id is not null
    and firm_id = public.req_active_firm()
    and public.active_membership_role(firm_id) in ('super_admin', 'partner')
    and (select auth.jwt() ->> 'aal') = 'aal2'
    and status = 'draft'
  );

create policy crv_update_privileged_aal2 on public.compliance_rule_versions
  for update to authenticated
  using (
    firm_id is not null
    and firm_id = public.req_active_firm()
    and public.active_membership_role(firm_id) in ('super_admin', 'partner')
    and (select auth.jwt() ->> 'aal') = 'aal2'
  )
  with check (
    firm_id is not null
    and firm_id = public.req_active_firm()
    and public.active_membership_role(firm_id) in ('super_admin', 'partner')
    and (select auth.jwt() ->> 'aal') = 'aal2'
  );

revoke all on public.compliance_rule_versions from anon, authenticated;
grant select on public.compliance_rule_versions to authenticated;
-- id/created_at server-managed; status forced to the 'draft' default;
-- domain_approval_status derived by crv_prepare_insert; created_by stamped.
-- effective_to is SCH-32 class-B lifecycle metadata: NOT browser-suppliable
-- at insert — it is set only by the controlled lifecycle command (window
-- closure at succession; RLS-CRV-04, API-R0-CRV create).
grant insert (firm_id, compliance_type_id, version, effective_from,
              frequency, due_rule)
  on public.compliance_rule_versions to authenticated;
-- Draft-edit payload only: lifecycle (status/effective_to), governance
-- (domain_approval_status), provenance (created_by), and parentage have no
-- grant (the class guard is the second layer beneath these grants).
grant update (effective_from, frequency, due_rule)
  on public.compliance_rule_versions to authenticated;

-- ---------------------------------------------------------------------------
-- Layer-B lifecycle command: activate_compliance_rule_version(uuid)
-- (API-R0-CRV activate; RLS-CRV-03; OPS-ACT-01 firm-owned path).
--
-- SECURITY DEFINER justification (API-SEC-03 — exceptional, reviewed):
-- activation must mutate lifecycle metadata on rows the caller can only
-- read through RLS (ordinary UPDATE grants can never perform lifecycle
-- transitions — the class-B guard), so no INVOKER variant can work. The
-- function performs its OWN complete authorization: actor from auth.uid()
-- (never parameters/headers), live ACTIVE same-firm membership (DEC-J),
-- active-firm selector match (RLS-CTX-02), role super_admin/partner, AAL2
-- step-up (RLS-AAL-01), firm-owned only (NULL firm_id rejected fail-closed
-- — platform/system-default activation is the deferred Layer-C operator
-- path, OPS-ACT-01/OPS-OQ-04), draft-only eligibility, the statutory
-- approval gate derived from the trusted parent type's governance_class
-- (never caller input), and the SCH-32 window invariants.
--
-- Atomicity (AUD-CTX-05): validation + predecessor window closure +
-- activation + audit happen in one transaction; any failure rolls back all.
-- The transaction-local app.crv_lifecycle_command + app.audit_skip_trigger
-- flags make this function the single lifecycle writer (no duplicate audit
-- rows from the Layer-A trigger).
--
-- Denial evidence (AUD-FAIL-01/AUD-CRV-01): a raised exception would roll
-- back the denial audit row with everything else, so deliberate denials
-- raise the private errcodes CA401 (unauthorized) / CA402 (conflict), are
-- caught below, audited via audit_write, and returned as a structured
-- result the adapter maps onto the API-ERR-01 taxonomy. Any OTHER
-- exception (including audit-write failure) propagates — fail-closed
-- (AUD-CTX-05). An invisible/nonexistent version returns not_found
-- un-audited (API-ERR-02 — no existence oracle).
-- ---------------------------------------------------------------------------
create or replace function public.activate_compliance_rule_version(p_version_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_ver public.compliance_rule_versions;
  v_new public.compliance_rule_versions;
  v_pred_old public.compliance_rule_versions;
  v_pred_new public.compliance_rule_versions;
  v_governance text;
  v_role text;
  v_reason text;
  v_has_pred boolean := false;
begin
  -- Single-writer command context (transaction-local; pooled-request safe).
  perform pg_catalog.set_config('app.crv_lifecycle_command', '1', true);
  perform pg_catalog.set_config('app.audit_skip_trigger', '1', true);

  begin
    if (select auth.uid()) is null then
      raise exception 'authentication required' using errcode = 'CA401';
    end if;

    select * into v_ver
    from public.compliance_rule_versions v
    where v.id = p_version_id
    for update;
    if not found then
      return jsonb_build_object(
        'status', 'denied', 'kind', 'not_found',
        'message', 'rule version not found');
    end if;

    if v_ver.firm_id is null then
      v_reason := 'system-default rule versions are not activatable by application roles (TEN-08; deferred operator path, RLS-CRV-03)';
      raise exception '%', v_reason using errcode = 'CA401';
    end if;

    if public.req_active_firm() is distinct from v_ver.firm_id then
      v_reason := 'active-firm context does not match the version''s firm (RLS-CTX-02)';
      raise exception '%', v_reason using errcode = 'CA401';
    end if;

    v_role := public.active_membership_role(v_ver.firm_id);
    -- NULL role (no ACTIVE membership — suspended/removed/foreign) must be
    -- denied explicitly: `NOT IN` over a NULL yields NULL, and IF treats
    -- NULL as false — a bare `not in` check would silently PASS.
    if v_role is null or v_role not in ('super_admin', 'partner') then
      v_reason := 'rule-version activation requires super_admin/partner (RLS-CRV-03)';
      raise exception '%', v_reason using errcode = 'CA401';
    end if;

    if (select auth.jwt() ->> 'aal') is distinct from 'aal2' then
      v_reason := 'AAL2 step-up required for rule-version activation (RLS-AAL-01)';
      raise exception '%', v_reason using errcode = 'CA401';
    end if;

    if v_ver.status is distinct from 'draft' then
      v_reason := format('only a draft version can be activated (current status: %s)', v_ver.status);
      raise exception '%', v_reason using errcode = 'CA402';
    end if;

    -- Statutory approval gate: the requirement is DERIVED from the trusted
    -- parent type row (SCH-10 governance_class) — never caller input,
    -- browser flags, category text, or the approval state itself.
    select c.governance_class into v_governance
    from public.compliance_types c
    where c.id = v_ver.compliance_type_id;
    if v_governance = 'statutory' and v_ver.domain_approval_status is distinct from 'approved' then
      v_reason := 'statutory rule version requires domain_approval_status=approved (SCH-32 gate, DM-OQ-01)';
      raise exception '%', v_reason using errcode = 'CA402';
    end if;
    if v_governance = 'non_statutory' and v_ver.domain_approval_status is distinct from 'not_required' then
      v_reason := 'non-statutory rule version carries an invalid approval state';
      raise exception '%', v_reason using errcode = 'CA402';
    end if;

    -- Succession (SCH-32): close the WINDOW of the active predecessor whose
    -- window spans the new effective_from — never its status. At most one
    -- such version exists (active windows are mutually disjoint). The
    -- predecessor remains 'active' for its historical window forever
    -- (TEST-RLS-CRV-13).
    select * into v_pred_old
    from public.compliance_rule_versions v
    where v.compliance_type_id = v_ver.compliance_type_id
      and v.status = 'active'
      and v.effective_from < v_ver.effective_from
      and (v.effective_to is null or v.effective_to > v_ver.effective_from)
    for update;
    if found then
      v_has_pred := true;
      update public.compliance_rule_versions
      set effective_to = v_ver.effective_from
      where id = v_pred_old.id
      returning * into v_pred_new;
    end if;

    -- Any residual overlap after the approved closure fails the activation
    -- (conflict) — e.g. a future-effective version inside the new window
    -- (its withdrawal is a separate lifecycle operation, not R0).
    if exists (
      select 1
      from public.compliance_rule_versions v
      where v.compliance_type_id = v_ver.compliance_type_id
        and v.status = 'active'
        and v.id <> v_ver.id
        and pg_catalog.daterange(v.effective_from, coalesce(v.effective_to, 'infinity'::date), '[)')
            && pg_catalog.daterange(v_ver.effective_from, coalesce(v_ver.effective_to, 'infinity'::date), '[)')
    ) then
      v_reason := 'effective window overlaps another active version (SCH-32 non-overlap)';
      raise exception '%', v_reason using errcode = 'CA402';
    end if;

    update public.compliance_rule_versions
    set status = 'active'
    where id = v_ver.id
    returning * into v_new;

    -- Authoritative Layer-B audit events (AUD-CRV-01/02), same transaction.
    if v_has_pred then
      perform public.audit_write(
        v_new.firm_id, 'human', (select auth.uid()),
        'compliance_rule_version.window_close',
        'compliance_rule_version', v_pred_new.id::text,
        to_jsonb(v_pred_old), to_jsonb(v_pred_new));
    end if;
    perform public.audit_write(
      v_new.firm_id, 'human', (select auth.uid()),
      'compliance_rule_version.activate',
      'compliance_rule_version', v_new.id::text,
      to_jsonb(v_ver), to_jsonb(v_new));

    return jsonb_build_object(
      'status', 'activated',
      'version', to_jsonb(v_new),
      'predecessor', case when v_has_pred then to_jsonb(v_pred_new) else null end);
  exception
    -- Deliberate denials only: audit the security-significant attempt
    -- (AUD-FAIL-01) and return structured denial. Everything else
    -- (constraint violations, audit faults, internal errors) propagates.
    -- An unauthenticated caller cannot be audited as a human actor (the
    -- AUD-ACT-05 CHECK requires actor identity) — no denial row is written.
    when sqlstate 'CA401' or sqlstate 'CA402' then
      if (select auth.uid()) is not null then
        perform public.audit_write(
          v_ver.firm_id, 'human', (select auth.uid()),
          'compliance_rule_version.activation_denied',
          'compliance_rule_version', p_version_id::text,
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

comment on function public.activate_compliance_rule_version(uuid) is
  'IMP-030 Layer-B lifecycle command (API-R0-CRV activate): firm-owned draft -> active with SCH-32 succession (predecessor window close, status untouched). auth.uid() + live ACTIVE same-firm super_admin/partner + active-firm selector + AAL2 + governance-derived approval gate; atomic mutation+audit; denials audited (AUD-FAIL-01). Firm-owned only — NULL firm_id rejected fail-closed (deferred operator path). Never mutates domain_approval_status or rule payload.';

revoke all on function public.activate_compliance_rule_version(uuid) from public, anon, service_role;
grant execute on function public.activate_compliance_rule_version(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Layer-A audit (IMP-013 foundation; AUD-CRV-01: rule administration is
-- security/compliance-sensitive, HIGH). Extends the audited-table mapping
-- via the established create-or-replace mechanism (IMP-020/021 precedent);
-- committed migration files stay immutable. System-default rows audit with
-- the NULL platform firm marker (AUD-EVT-03, AUD-CRV-02); seed/migration
-- writes carry the system actor (AUD-CRV-03). The activation command sets
-- app.audit_skip_trigger and writes the authoritative lifecycle events
-- itself — no duplicate rows.
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
  else
    -- Defense in depth: this trigger must only ever be attached to the
    -- mapped tables above.
    raise exception 'audit_trg_row attached to unmapped table %', TG_TABLE_NAME
      using errcode = 'P0001';
  end if;

  -- AUD-VAL-01: old+new for UPDATE, NEW only for INSERT, OLD only for
  -- DELETE. AUD-VAL-02 redaction review for SCH-10/32: rule content is
  -- exactly what the audit trail must preserve (AUD-CRV-02); no
  -- secrets-adjacent columns exist; none redacted.
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
  'IMP-013 Layer-A audit trigger (AUD-CTX-01), mapping extended by IMP-020 (SCH-04…08), IMP-021 (SCH-09), and IMP-030 (SCH-10/32). Actor from auth.uid()/jwt role only; firm/object from the row. DEFINER solely so application roles without audit_log INSERT privilege can be audited; owner-only EXECUTE.';

create trigger compliance_types_audit_row
  after insert or update or delete on public.compliance_types
  for each row execute function public.audit_trg_row();

create trigger compliance_rule_versions_audit_row
  after insert or update or delete on public.compliance_rule_versions
  for each row execute function public.audit_trg_row();

-- ---------------------------------------------------------------------------
-- Notes for reviewers
-- ---------------------------------------------------------------------------
-- * Statutory seeds remain status='draft' + domain_approval_status='pending'
--   (MIG-SEED-02); production statutory activation additionally requires
--   external CA/domain sign-off recorded under the deferred operator path
--   (DM-OQ-01, OPS-ACT-01, OPS-OQ-04 OPEN). This package implements the
--   fail-closed infrastructure only.
-- * superseded/deprecated are terminal states for versions that NEVER
--   governed a period (SCH-32 succession model). R0 exposes no withdrawal
--   command (API-R0-CRV defines activate only); a version that governed a
--   historical window stays 'active' for it forever.
-- * The effective-window exclusion constraint (23P01 on violation) is the
--   database-layer non-overlap backstop; the activation command produces
--   the clean conflict first. The API layer maps 23P01 to `conflict`
--   (extends the IMP-014 taxonomy convention).
-- * No ComplianceInstance table exists yet: the class-A guard's
--   "referenced" freeze is architecturally prep-compatible with IMP-031
--   (the non-draft freeze is a superset); IMP-031 extends the guard with
--   the instance-reference condition.
-- * AAL is an authentication-assurance claim read from the JWT, not tenant
--   authority (DEC-J untouched); role/scope come from the live membership
--   lookup on every statement.
