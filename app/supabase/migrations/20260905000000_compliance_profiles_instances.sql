-- IMP-031 — Compliance profiles & instances (SCH-11, SCH-12)
--
-- Implements exactly the two tables owned by this package:
--   public.client_compliance_profiles (SCH-11 — DM-11 applicability records)
--   public.compliance_instances       (SCH-12 — DM-12 obligation per entity
--                                      per period, DM-SM-04 10-state pipeline)
-- with production RLS (RLS-CCP-01, RLS-CIN-01 incl. the transition
-- authorization matrix and four-eyes rules RLS-4EY-01/02), the controlled
-- Layer-B commands (API-R0-CCP approve, API-R0-CIN transition), and Layer-A/B
-- audit integration (AUD-FAIL-01 denial evidence; TEST-AUD-02/03 families).
--
-- Requirement IDs: DM-11, DM-12, DM-27 (scope enforcement incl. the
-- TDS-specific PAN exception), DM-SM-04, SCH-11, SCH-12, SCH-FK-01…03,
-- SCH-RESP-01…03, SCH-A-02/03, RLS-CCP-01, RLS-CIN-01, RLS-4EY-01/02,
-- RLS-STF-01…05/07, RLS-CTX-01/02, RLS-MECH-01 (DEC-J), RLS-AAL-02 (routine
-- transitions need no step-up), AUTO-REC-03 layer 3 (database uniqueness —
-- the IMP-031-owned duplicate-protection layer), AUTO-REC-07 (provenance
-- immutability), API-R0-CCP, API-R0-CIN, API-ARCH-04, API-ERR-01/02/04,
-- API-SEC-03 (reviewed definer surface), AUD-FAIL-01.
--
-- Explicitly NOT here (package non-goals):
--   * recurrence generation / scheduler / successor spawning (IMP-050 —
--     AUTO-REC-01/02/04/05/06/08; approval and closure create NO instances)
--   * alerts (IMP-051), tasks (SCH-13 family), review queue
--   * UI screens and the @/data adapter (later IMP-031 phases)
--   * statutory production activation (DM-OQ-01/OPS-OQ-04 — unchanged)
--
-- Trust model (unchanged from IMP-012/013/030): auth.uid() is identity only;
-- every authorization check is a LIVE FirmMembership read (DEC-J); the
-- x-active-firm header is untrusted context validated against live membership
-- on every statement (RLS-CTX-02).
--
-- Documented design decisions where the spec left room:
--   * TDS exception discriminator: registration_class = 'TAN' (the DM-27
--     matrix's TDS family is the only TAN-class scope) — robust against
--     category free text. The exception is NOT generalised: only TAN-class
--     types may reference a PAN registration or (instances only) carry NULL
--     with a recorded reason.
--   * TDS NULL-registration exception key: period_meta->>'tds_pan_exception'
--     must be a NON-EMPTY string (the recorded statutory exception reason).
--     Profiles have no NULL path (SCH-12 text scopes the NULL+reason form to
--     instances; SCH-11 allows only the PAN substitution reference).
--   * Mutation-key idempotency (API-R0-CIN): state-based no-op detection —
--     if the instance already sits in p_to_state and a mutation key was
--     supplied, the command returns the current row with
--     status='already_applied' (no second mutation, no double audit). The key
--     is recorded on the authoritative audit row's new_value._mutation_key
--     for traceability; no separate key-registry table is introduced in this
--     package.
--   * senior/article profile read (RLS-CCP-01): profiles of legal entities
--     that have at least one compliance instance whose assignee/reviewer is
--     the caller's live membership — implementable with the existing helpers;
--     the EXISTS subquery runs under the caller's OWN instance RLS (already
--     assigned-only for senior/article), so it cannot widen visibility.
--   * Profile approval is a business approval, NOT a security-configuration
--     change: no AAL2 step-up (RLS-AAL-01 list; RLS-AAL-02 routine-work
--     precedent). HIGH audit sensitivity is carried by the atomic
--     mutation+audit command.

-- ---------------------------------------------------------------------------
-- SCH-FK-01 groundwork: registrations gains the composite-FK parent key
-- (firm_id, id) that SCH-11/SCH-12 reference. Purely additive; the existing
-- (firm_id, type, value) business uniqueness is untouched.
-- ---------------------------------------------------------------------------
alter table public.registrations
  add constraint registrations_firm_id_unique unique (firm_id, id);

-- ---------------------------------------------------------------------------
-- SCH-11 — client_compliance_profiles
-- Applicability records (DM-11): which compliance types apply to which legal
-- entity, with CA approval (PRD §72 step 9). Only 'active' profiles feed
-- recurrence (IMP-050); approval itself creates NO instances (C5 ruling).
-- ---------------------------------------------------------------------------
create table public.client_compliance_profiles (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null,
  legal_entity_id uuid not null,
  compliance_type_id uuid not null,
  registration_id uuid,
  applicability_answers jsonb,
  status text not null default 'proposed',
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  constraint client_compliance_profiles_status_check
    check (status in ('proposed', 'active', 'suspended', 'ended')),
  constraint ccp_firm_fkey
    foreign key (firm_id) references public.firms (id) on delete restrict,
  -- SCH-FK-01/02: composite same-firm FKs — cross-firm references are
  -- invalid at the constraint layer, not merely forbidden by RLS.
  constraint ccp_legal_entity_fkey
    foreign key (firm_id, legal_entity_id)
    references public.legal_entities (firm_id, id) on delete restrict,
  -- SCH-FK-03 reference-data exception: compliance types are reference data
  -- (NULL-firm_id system defaults make a composite FK impossible).
  constraint ccp_compliance_type_fkey
    foreign key (compliance_type_id) references public.compliance_types (id) on delete restrict,
  constraint ccp_registration_fkey
    foreign key (firm_id, registration_id)
    references public.registrations (firm_id, id) on delete restrict,
  -- SCH-RESP-02: approval actor is actor IDENTITY (global), not tenant
  -- operational responsibility.
  constraint ccp_approved_by_fkey
    foreign key (approved_by) references auth.users (id) on delete restrict,
  -- SCH-11: one profile per (entity, type, registration). NULLS NOT DISTINCT
  -- makes NULL registration a single key value (SCH-A-03).
  constraint ccp_obligation_unique
    unique nulls not distinct (legal_entity_id, compliance_type_id, registration_id),
  -- SCH-FK-01: composite-FK parent key for compliance_instances.
  constraint ccp_firm_id_unique unique (firm_id, id)
);

comment on table public.client_compliance_profiles is 'SCH-11: applicability records (DM-11). proposed -> active via the controlled approval command only (RLS-CCP-01); approval stamps approved_by/approved_at and creates NO instances (C5 ruling; materialization is IMP-050). Registration scope per DM-27 enforced at the write path; the TDS PAN substitution is the only permitted class substitution.';

create index ccp_entity_status_idx on public.client_compliance_profiles (legal_entity_id, status);
create index ccp_firm_status_idx on public.client_compliance_profiles (firm_id, status);

-- ---------------------------------------------------------------------------
-- SCH-12 — compliance_instances
-- One obligation for one legal entity for one period (DM-12). client_id is
-- denormalized for RLS/query simplicity (SCH-A-02): trigger-derived from the
-- legal entity, never user-writable. Recurrence provenance (rule_version_id,
-- generation_source, generated_at, calculated_due_date) is insert-only and
-- frozen forever (AUTO-REC-07); due_date is the OPERATIVE date and moves only
-- via audited direct update by manager+ (statutory extensions —
-- compliance_instance.due_date_changed audit via the Layer-A trigger).
-- ---------------------------------------------------------------------------
create table public.compliance_instances (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null,
  client_id uuid not null,
  legal_entity_id uuid not null,
  compliance_type_id uuid not null,
  registration_id uuid,
  client_compliance_profile_id uuid,
  engagement_id uuid,
  period_start date not null,
  period_end date not null,
  period_label text not null,
  period_meta jsonb,
  due_date date not null,
  rule_version_id uuid,
  generation_source text not null default 'manual',
  generated_at timestamptz,
  calculated_due_date date,
  state text not null default 'not_started',
  assignee_membership_id uuid,
  reviewer_membership_id uuid,
  partner_membership_id uuid,
  priority text not null default 'normal',
  risk_score int,
  risk_factors jsonb,
  filed_at timestamptz,
  closed_at timestamptz,
  successor_instance_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  constraint compliance_instances_state_check
    check (state in ('not_started', 'information_requested', 'information_received',
                     'preparation', 'internal_review', 'client_approval',
                     'ready_to_file', 'filed', 'acknowledgement_received', 'closed')),
  constraint compliance_instances_generation_source_check
    check (generation_source in ('recurrence', 'manual', 'import')),
  constraint compliance_instances_period_check
    check (period_end >= period_start),
  -- SCH-12: recurrence-generated instances must carry their provenance.
  constraint compliance_instances_recurrence_provenance_check
    check (generation_source <> 'recurrence'
           or (rule_version_id is not null and generated_at is not null)),
  constraint cin_firm_fkey
    foreign key (firm_id) references public.firms (id) on delete restrict,
  constraint cin_legal_entity_fkey
    foreign key (firm_id, legal_entity_id)
    references public.legal_entities (firm_id, id) on delete restrict,
  constraint cin_registration_fkey
    foreign key (firm_id, registration_id)
    references public.registrations (firm_id, id) on delete restrict,
  constraint cin_profile_fkey
    foreign key (firm_id, client_compliance_profile_id)
    references public.client_compliance_profiles (firm_id, id) on delete restrict,
  -- Optional ASSOCIATION only — an engagement is never the compliance
  -- subject (DM-12, SCH-12).
  constraint cin_engagement_fkey
    foreign key (firm_id, engagement_id)
    references public.engagements (firm_id, id) on delete restrict,
  constraint cin_client_fkey
    foreign key (firm_id, client_id)
    references public.clients (firm_id, id) on delete restrict,
  -- SCH-FK-03 reference-data exception family (system defaults carry NULL
  -- firm_id; reference data holds no tenant content).
  constraint cin_compliance_type_fkey
    foreign key (compliance_type_id) references public.compliance_types (id) on delete restrict,
  constraint cin_rule_version_fkey
    foreign key (rule_version_id) references public.compliance_rule_versions (id) on delete restrict,
  -- SCH-RESP-01/03: operational responsibility references are composite
  -- membership FKs — same-firm proven at the constraint layer.
  constraint cin_assignee_fkey
    foreign key (firm_id, assignee_membership_id)
    references public.firm_memberships (firm_id, id) on delete restrict,
  constraint cin_reviewer_fkey
    foreign key (firm_id, reviewer_membership_id)
    references public.firm_memberships (firm_id, id) on delete restrict,
  constraint cin_partner_fkey
    foreign key (firm_id, partner_membership_id)
    references public.firm_memberships (firm_id, id) on delete restrict,
  -- Successor link (recurrence, PRD §29): plain self FK per SCH-12;
  -- populated only by the IMP-050 generator (no browser grant below).
  constraint cin_successor_fkey
    foreign key (successor_instance_id) references public.compliance_instances (id) on delete restrict,
  -- SCH-12 / AUTO-REC-03 layer 3: one instance per obligation per period.
  -- The key deliberately EXCLUDES rule_version_id — a new rule version can
  -- never duplicate an already-materialized obligation.
  constraint cin_obligation_period_unique
    unique nulls not distinct (compliance_type_id, legal_entity_id, registration_id, period_start),
  -- SCH-FK-01: composite-FK parent key for the SCH-13 tasks family and any
  -- later child references.
  constraint cin_firm_id_unique unique (firm_id, id)
);

comment on table public.compliance_instances is 'SCH-12: obligation per legal entity per period (DM-12, DM-SM-04 pipeline). client_id trigger-derived (never user-writable, SCH-A-02); state changes ONLY via transition_compliance_instance() (RLS-CIN-01); identity/period/provenance insert-only (AUTO-REC-07); four-eyes per type (RLS-4EY-*). Successor spawning is IMP-050.';

-- SCH-12 indexes: deadline board, My Work, client drill-down, type
-- drill-down, provenance queries.
create index cin_firm_due_state_idx on public.compliance_instances (firm_id, due_date, state);
create index cin_assignee_state_idx on public.compliance_instances (firm_id, assignee_membership_id, state);
create index cin_client_period_idx on public.compliance_instances (client_id, period_start);
create index cin_firm_type_period_idx on public.compliance_instances (firm_id, compliance_type_id, period_start);
create index cin_rule_version_idx on public.compliance_instances (rule_version_id);

-- ---------------------------------------------------------------------------
-- Registration-scope validation (SCH-11/12 write-path invariants, DM-27).
-- Shared by both tables' write guards. DEFINER so the compliance-type and
-- registration reads never depend on the DML caller's RLS visibility under
-- FORCE RLS (IMP-030 governance-inheritance precedent).
--
-- Rules:
--   scope_kind='entity'       -> registration_id must be NULL.
--   scope_kind='registration' -> registration required; its type must equal
--                                the type's registration_class and it must
--                                belong to the SAME legal entity (composite
--                                FKs prove same-firm, not same-entity).
--     TDS exception (registration_class='TAN' ONLY — not generalised):
--       a PAN registration of the same entity may substitute (SCH-11/12);
--       additionally, INSTANCES (p_allow_tds_null) may carry NULL when
--       period_meta->>'tds_pan_exception' is a non-empty recorded reason
--       (SCH-12: "or is NULL with the exception reason recorded in
--       period_meta").
--   scope_kind='configurable' -> either allowed.
-- Any non-NULL registration must belong to the same legal entity regardless
-- of scope_kind.
-- Reference-data binding (DM-X-01; RLS-CTY-01): the compliance type must be
-- a system default (firm_id IS NULL) or owned by the SAME firm — a foreign
-- firm-owned type can never be bound (it would import foreign workflow /
-- four-eyes rules into this firm's instances and the pinned row would be
-- unreadable to the owning firm).
-- Violations are rejected input: plain 23514 -> `validation` (API-ERR-01);
-- the SCOPE_VIOLATION: detail token is diagnostic, not a conflict marker.
-- ---------------------------------------------------------------------------
create or replace function public.compliance_scope_validate(
  p_compliance_type_id uuid,
  p_legal_entity_id uuid,
  p_registration_id uuid,
  p_period_meta jsonb,
  p_allow_tds_null boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_scope text;
  v_class text;
  v_type_firm uuid;
  v_entity_firm uuid;
  v_reg public.registrations;
begin
  select c.scope_kind, c.registration_class, c.firm_id
    into v_scope, v_class, v_type_firm
  from public.compliance_types c
  where c.id = p_compliance_type_id;
  if not found then
    raise exception 'compliance_type_id does not exist' using errcode = '23503';
  end if;

  -- The referencing row's firm is the legal entity's firm (the composite
  -- (firm_id, legal_entity_id) FK on both guarded tables proves it), so the
  -- entity's firm is the authoritative binding scope here.
  select le.firm_id into v_entity_firm
  from public.legal_entities le
  where le.id = p_legal_entity_id;
  if not found then
    raise exception 'legal_entity_id does not exist' using errcode = '23503';
  end if;

  if v_type_firm is not null and v_type_firm is distinct from v_entity_firm then
    raise exception 'compliance type is not bindable by this firm (DM-X-01: system-default or same-firm only)'
      using errcode = '23514', detail = 'SCOPE_VIOLATION:type_firm_binding';
  end if;

  if p_registration_id is not null then
    select * into v_reg
    from public.registrations r
    where r.id = p_registration_id;
    if not found then
      raise exception 'registration_id does not exist' using errcode = '23503';
    end if;
    if v_reg.legal_entity_id is distinct from p_legal_entity_id then
      raise exception 'registration must belong to the same legal entity (DM-27)'
        using errcode = '23514', detail = 'SCOPE_VIOLATION:registration.legal_entity';
    end if;
  end if;

  if v_scope = 'entity' then
    if p_registration_id is not null then
      raise exception 'scope_kind=entity: registration_id must be NULL (SCH-11/12, DM-27)'
        using errcode = '23514', detail = 'SCOPE_VIOLATION:entity_scope';
    end if;
  elsif v_scope = 'registration' then
    if p_registration_id is null then
      -- TDS statutory PAN-based exception, NULL form: instances only.
      -- (v_class is non-null here — the SCH-10 CHECK forces
      -- registration_class when scope_kind='registration'; p_allow_tds_null
      -- is coalesced so a NULL flag can never turn `not (NULL)` into a
      -- silent permit.)
      if not (coalesce(p_allow_tds_null, false)
              and v_class = 'TAN'
              and nullif(p_period_meta ->> 'tds_pan_exception', '') is not null) then
        raise exception 'scope_kind=registration: registration_id is required (SCH-11/12, DM-27)'
          using errcode = '23514', detail = 'SCOPE_VIOLATION:registration_required';
      end if;
    elsif v_class = 'TAN' then
      -- TDS family: TAN normally; the statutory exception may substitute a
      -- PAN registration of the same entity. Not generalised to other
      -- registration classes or ordinary TDS statement filing (DM-27).
      if v_reg.type not in ('TAN', 'PAN') then
        raise exception 'TDS-family scope references a TAN registration, or a PAN registration under the statutory exception (DM-27)'
          using errcode = '23514', detail = 'SCOPE_VIOLATION:registration_class';
      end if;
    elsif v_reg.type is distinct from v_class then
      raise exception 'registration type % does not match the compliance type registration_class (DM-27)', v_reg.type
        using errcode = '23514', detail = 'SCOPE_VIOLATION:registration_class';
    end if;
  end if;
  -- scope_kind='configurable': either form allowed (same-entity enforced above).
end;
$$;

comment on function public.compliance_scope_validate(uuid, uuid, uuid, jsonb, boolean) is
  'IMP-031 DM-27 write-path scope validation shared by SCH-11/12 guards, plus DM-X-01 reference-data firm binding (system-default or same-firm types only; firm derived from the legal entity, which the composite FKs prove equals the row firm). TDS exception discriminator is registration_class=TAN (never category text); the NULL form needs period_meta.tds_pan_exception (non-empty reason) and is instance-only. DEFINER so enforcement never depends on caller RLS visibility.';

revoke all on function public.compliance_scope_validate(uuid, uuid, uuid, jsonb, boolean) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Instance assignment validation (SCH-RESP-03 live-status layer + RLS-4EY):
-- assignee/reviewer/partner, when set, must be ACTIVE memberships of the
-- same firm at write time (composite FKs already prove same-firm existence;
-- mirrors the DM-04/DM-09 precedent, which raises 23503). Where the type
-- requires four-eyes, reviewer must differ from assignee (RLS-4EY-01 — the
-- transition command additionally requires the reviewer to PERFORM any
-- exit from internal_review; a NULL reviewer therefore fail-closes the
-- review exit until a manager+ assigns one via the permitted non-state
-- update path).
-- ---------------------------------------------------------------------------
create or replace function public.cin_validate_assignments(
  p_firm_id uuid,
  p_compliance_type_id uuid,
  p_assignee uuid,
  p_reviewer uuid,
  p_partner uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_four_eyes boolean;
begin
  select c.four_eyes_required into v_four_eyes
  from public.compliance_types c
  where c.id = p_compliance_type_id;
  if not found then
    -- Unreachable via the plain FK; without this, v_four_eyes would be NULL
    -- and `if v_four_eyes and ...` would SILENTLY skip the four-eyes check
    -- (three-valued logic permits, never denies) — fail closed instead.
    raise exception 'compliance_type_id does not exist' using errcode = '23503';
  end if;

  if v_four_eyes and p_assignee is not null and p_reviewer is not null
     and p_assignee = p_reviewer then
    raise exception 'four-eyes required: reviewer_membership_id must differ from assignee_membership_id (RLS-4EY-01)'
      using errcode = '23514', detail = 'FOUR_EYES:compliance_instances.assignments';
  end if;

  if p_assignee is not null and not exists (
    select 1 from public.firm_memberships m
    where m.firm_id = p_firm_id and m.id = p_assignee and m.status = 'active'
  ) then
    raise exception 'assignee_membership_id must be an ACTIVE membership of the same firm (SCH-RESP-03)'
      using errcode = '23503';
  end if;
  if p_reviewer is not null and not exists (
    select 1 from public.firm_memberships m
    where m.firm_id = p_firm_id and m.id = p_reviewer and m.status = 'active'
  ) then
    raise exception 'reviewer_membership_id must be an ACTIVE membership of the same firm (SCH-RESP-03)'
      using errcode = '23503';
  end if;
  if p_partner is not null and not exists (
    select 1 from public.firm_memberships m
    where m.firm_id = p_firm_id and m.id = p_partner and m.status = 'active'
  ) then
    raise exception 'partner_membership_id must be an ACTIVE membership of the same firm (SCH-RESP-03)'
      using errcode = '23503';
  end if;
end;
$$;

comment on function public.cin_validate_assignments(uuid, uuid, uuid, uuid, uuid) is
  'IMP-031 instance assignment guard: four-eyes reviewer<>assignee where the type requires it (RLS-4EY-01); responsibility memberships must be ACTIVE same-firm at write time (SCH-RESP-03). DEFINER so the reads never depend on caller RLS visibility.';

revoke all on function public.cin_validate_assignments(uuid, uuid, uuid, uuid, uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Write guard — client_compliance_profiles (BEFORE INSERT/UPDATE).
--   * scope validation on every write (registration_id is a mutable,
--     correctable reference); profiles get NO period_meta NULL path.
--   * UPDATE: identity/parentage insert-only; status -> 'active' ONLY under
--     the transaction-local app.ccp_approval_command marker set by the
--     controlled approval command (RLS-CCP-01: approval via API-R0-CCP);
--     approved_by/approved_at are command-stamped only. Other status moves
--     (e.g. active -> suspended -> ended) remain ordinary manager+ updates.
-- Markers follow the API-ERR convention: IMMUTABLE_FIELD:/INVALID_TRANSITION:
-- map to `conflict`; the scope validator's plain 23514 maps to `validation`.
-- DEFINER only because it invokes the definer scope validator — the guard
-- itself reads no tables.
-- ---------------------------------------------------------------------------
create or replace function public.ccp_guard_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- coalesce: an unset GUC yields NULL and `not NULL` would silently skip
  -- the guard (three-valued logic) — the flag must be exactly '1'.
  v_command boolean := coalesce(current_setting('app.ccp_approval_command', true), '') = '1';
begin
  if TG_OP = 'UPDATE' then
    if new.id is distinct from old.id
       or new.firm_id is distinct from old.firm_id
       or new.legal_entity_id is distinct from old.legal_entity_id
       or new.compliance_type_id is distinct from old.compliance_type_id
       or new.created_at is distinct from old.created_at then
      raise exception 'profile identity/parentage is insert-only (SCH-11)'
        using errcode = '23514', detail = 'IMMUTABLE_FIELD:client_compliance_profiles.identity';
    end if;

    if (new.status is distinct from old.status and new.status = 'active')
       and not v_command then
      raise exception 'profile activation only via approve_client_compliance_profile() (RLS-CCP-01, API-R0-CCP)'
        using errcode = '23514', detail = 'INVALID_TRANSITION:client_compliance_profiles.status';
    end if;

    if (new.approved_by is distinct from old.approved_by
        or new.approved_at is distinct from old.approved_at)
       and not v_command then
      raise exception 'approved_by/approved_at are stamped by the approval command only (DM-11)'
        using errcode = '23514', detail = 'IMMUTABLE_FIELD:client_compliance_profiles.approval';
    end if;
  end if;

  perform public.compliance_scope_validate(
    new.compliance_type_id, new.legal_entity_id, new.registration_id, null, false);
  return new;
end;
$$;

comment on function public.ccp_guard_write() is
  'IMP-031 SCH-11 write guard: DM-27 scope + DM-X-01 type firm binding on every write; identity insert-only; status->active and approval stamps only under the app.ccp_approval_command single-writer marker (RLS-CCP-01).';

revoke all on function public.ccp_guard_write() from public, anon, authenticated, service_role;

create trigger client_compliance_profiles_guard_write
  before insert or update on public.client_compliance_profiles
  for each row execute function public.ccp_guard_write();

-- ---------------------------------------------------------------------------
-- Write guard — compliance_instances (BEFORE INSERT/UPDATE).
--   INSERT: client_id is DERIVED from the legal entity (any user-supplied
--     value overwritten — SCH-A-02, never trusted); DM-27 scope validation
--     (instances get the TDS NULL-with-reason path); reference-data firm
--     binding for the compliance type (in the scope validator) AND the rule
--     version (below — system-default or same-firm, and of the SAME type;
--     DM-X-01/RLS-CRV-01); assignment validity.
--   UPDATE: identity/period fields (firm_id, client_id, legal_entity_id,
--     compliance_type_id, registration_id, period_start, period_end) and
--     recurrence provenance (rule_version_id, generation_source,
--     generated_at, calculated_due_date) are insert-only (AUTO-REC-07) —
--     which is why the rule-version binding check below is INSERT-only:
--     no UPDATE path can ever change rule_version_id;
--     `state` and the filed_at/closed_at lifecycle markers change ONLY under
--     the transaction-local app.cin_transition_command marker set by the
--     controlled transition command (RLS-CIN-01: no direct table UPDATE of
--     state). Scope is re-validated because period_meta is a permitted
--     non-state field and the TDS NULL exception depends on its key.
-- successor_instance_id / risk_score / risk_factors carry no guard: they
-- have no browser grant at all (server-owned: IMP-050 recurrence successor
-- links, derived risk cache per DM-12) — the grant layer is the control.
-- ---------------------------------------------------------------------------
create or replace function public.cin_guard_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_command boolean := coalesce(current_setting('app.cin_transition_command', true), '') = '1';
  v_client uuid;
  v_rv_firm uuid;
  v_rv_type uuid;
begin
  if TG_OP = 'INSERT' then
    select le.client_id into v_client
    from public.legal_entities le
    where le.firm_id = new.firm_id and le.id = new.legal_entity_id;
    if not found then
      raise exception 'legal_entity_id does not exist in this firm' using errcode = '23503';
    end if;
    new.client_id := v_client;

    perform public.compliance_scope_validate(
      new.compliance_type_id, new.legal_entity_id, new.registration_id, new.period_meta, true);

    -- DM-X-01 / RLS-CRV-01: recurrence provenance may bind only a
    -- system-default or same-firm rule version, and (defense in depth) a
    -- version OF the instance's own compliance type.
    if new.rule_version_id is not null then
      select v.firm_id, v.compliance_type_id into v_rv_firm, v_rv_type
      from public.compliance_rule_versions v
      where v.id = new.rule_version_id;
      if not found then
        raise exception 'rule_version_id does not exist' using errcode = '23503';
      end if;
      if (v_rv_firm is not null and v_rv_firm is distinct from new.firm_id)
         or v_rv_type is distinct from new.compliance_type_id then
        raise exception 'rule version must be a system-default or same-firm version of the instance''s own compliance type (DM-X-01)'
          using errcode = '23514', detail = 'SCOPE_VIOLATION:rule_version_binding';
      end if;
    end if;

    perform public.cin_validate_assignments(
      new.firm_id, new.compliance_type_id,
      new.assignee_membership_id, new.reviewer_membership_id, new.partner_membership_id);
    return new;
  end if;

  -- UPDATE
  if new.id is distinct from old.id
     or new.firm_id is distinct from old.firm_id
     or new.client_id is distinct from old.client_id
     or new.legal_entity_id is distinct from old.legal_entity_id
     or new.compliance_type_id is distinct from old.compliance_type_id
     or new.registration_id is distinct from old.registration_id
     or new.period_start is distinct from old.period_start
     or new.period_end is distinct from old.period_end
     or new.created_at is distinct from old.created_at then
    raise exception 'identity and period fields are insert-only (SCH-12)'
      using errcode = '23514', detail = 'IMMUTABLE_FIELD:compliance_instances.identity';
  end if;

  if new.rule_version_id is distinct from old.rule_version_id
     or new.generation_source is distinct from old.generation_source
     or new.generated_at is distinct from old.generated_at
     or new.calculated_due_date is distinct from old.calculated_due_date then
    raise exception 'recurrence provenance is insert-only (SCH-12, AUTO-REC-07)'
      using errcode = '23514', detail = 'IMMUTABLE_FIELD:compliance_instances.provenance';
  end if;

  if new.state is distinct from old.state and not v_command then
    raise exception 'compliance_instances.state changes only through transition_compliance_instance() (RLS-CIN-01, DM-SM-04)'
      using errcode = '23514', detail = 'INVALID_TRANSITION:compliance_instances.state';
  end if;

  if (new.filed_at is distinct from old.filed_at
      or new.closed_at is distinct from old.closed_at) and not v_command then
    raise exception 'filed_at/closed_at are stamped by the transition command only (DM-SM-04)'
      using errcode = '23514', detail = 'IMMUTABLE_FIELD:compliance_instances.lifecycle_markers';
  end if;

  perform public.compliance_scope_validate(
    new.compliance_type_id, new.legal_entity_id, new.registration_id, new.period_meta, true);
  perform public.cin_validate_assignments(
    new.firm_id, new.compliance_type_id,
    new.assignee_membership_id, new.reviewer_membership_id, new.partner_membership_id);
  return new;
end;
$$;

comment on function public.cin_guard_write() is
  'IMP-031 SCH-12 write guard: client_id derived at insert (never trusted); identity/period/provenance insert-only; state and lifecycle markers only under the app.cin_transition_command single-writer marker (RLS-CIN-01); DM-27 scope + DM-X-01 reference-data firm binding + four-eyes/ACTIVE-membership validity on every write.';

revoke all on function public.cin_guard_write() from public, anon, authenticated, service_role;

create trigger compliance_instances_guard_write
  before insert or update on public.compliance_instances
  for each row execute function public.cin_guard_write();

-- ---------------------------------------------------------------------------
-- updated_at maintenance (schema convention; NOT audit). Trigger names sort
-- after the guards alphabetically, so guards evaluate the caller-visible row
-- before the timestamp refresh.
-- ---------------------------------------------------------------------------
create trigger client_compliance_profiles_set_updated_at
  before update on public.client_compliance_profiles
  for each row execute function public.set_updated_at();

create trigger compliance_instances_set_updated_at
  before update on public.compliance_instances
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS (RLS-PRIN-01/02: enabled AND FORCED — tenant-owned content tables)
-- ---------------------------------------------------------------------------
alter table public.client_compliance_profiles enable row level security;
alter table public.client_compliance_profiles force row level security;
alter table public.compliance_instances enable row level security;
alter table public.compliance_instances force row level security;

-- --- client_compliance_profiles (RLS-CCP-01) --------------------------------
-- Read: active-firm selector + live role. super_admin/partner: firm-wide;
-- manager: portfolio (the entity's client's designated manager is the
-- caller's live membership); senior/article: assigned-work scope only —
-- profiles of legal entities carrying an instance assigned to them (the
-- EXISTS runs under the caller's OWN instance RLS, which is already
-- assigned-only, so it cannot widen); billing: none; anon: no policies.
create policy ccp_select_scoped on public.client_compliance_profiles
  for select to authenticated
  using (
    firm_id = public.req_active_firm()
    and (
      public.active_membership_role(firm_id) in ('super_admin', 'partner')
      or (
        public.active_membership_role(firm_id) = 'manager'
        and exists (
          select 1 from public.legal_entities le
          join public.clients c on c.firm_id = le.firm_id and c.id = le.client_id
          where le.firm_id = client_compliance_profiles.firm_id
            and le.id = client_compliance_profiles.legal_entity_id
            and c.manager_membership_id = public.active_membership_id(client_compliance_profiles.firm_id)
        )
      )
      or (
        public.active_membership_role(firm_id) in ('senior', 'article_executive')
        and exists (
          select 1 from public.compliance_instances i
          where i.firm_id = client_compliance_profiles.firm_id
            and i.legal_entity_id = client_compliance_profiles.legal_entity_id
            and public.active_membership_id(client_compliance_profiles.firm_id)
                  in (i.assignee_membership_id, i.reviewer_membership_id)
        )
      )
    )
  );

-- Write: manager+ within scope (RLS-CCP-01 "approve/write manager+").
-- firm_id pinned to the selector on both sides; status -> 'active' is
-- command-gated by the write guard beneath these policies.
create policy ccp_insert_manager_plus on public.client_compliance_profiles
  for insert to authenticated
  with check (
    firm_id = public.req_active_firm()
    and (
      public.active_membership_role(firm_id) in ('super_admin', 'partner')
      or (
        public.active_membership_role(firm_id) = 'manager'
        and exists (
          select 1 from public.legal_entities le
          join public.clients c on c.firm_id = le.firm_id and c.id = le.client_id
          where le.firm_id = client_compliance_profiles.firm_id
            and le.id = client_compliance_profiles.legal_entity_id
            and c.manager_membership_id = public.active_membership_id(client_compliance_profiles.firm_id)
        )
      )
    )
  );

create policy ccp_update_manager_plus on public.client_compliance_profiles
  for update to authenticated
  using (
    firm_id = public.req_active_firm()
    and (
      public.active_membership_role(firm_id) in ('super_admin', 'partner')
      or (
        public.active_membership_role(firm_id) = 'manager'
        and exists (
          select 1 from public.legal_entities le
          join public.clients c on c.firm_id = le.firm_id and c.id = le.client_id
          where le.firm_id = client_compliance_profiles.firm_id
            and le.id = client_compliance_profiles.legal_entity_id
            and c.manager_membership_id = public.active_membership_id(client_compliance_profiles.firm_id)
        )
      )
    )
  )
  with check (
    firm_id = public.req_active_firm()
    and (
      public.active_membership_role(firm_id) in ('super_admin', 'partner')
      or (
        public.active_membership_role(firm_id) = 'manager'
        and exists (
          select 1 from public.legal_entities le
          join public.clients c on c.firm_id = le.firm_id and c.id = le.client_id
          where le.firm_id = client_compliance_profiles.firm_id
            and le.id = client_compliance_profiles.legal_entity_id
            and c.manager_membership_id = public.active_membership_id(client_compliance_profiles.firm_id)
        )
      )
    )
  );

-- --- compliance_instances (RLS-CIN-01) --------------------------------------
-- Read: super_admin/partner firm-wide; manager portfolio (denormalized
-- client_id -> designated manager); senior/article assigned-only (their
-- live membership is the row's assignee or reviewer); billing: none.
create policy cin_select_scoped on public.compliance_instances
  for select to authenticated
  using (
    firm_id = public.req_active_firm()
    and (
      public.active_membership_role(firm_id) in ('super_admin', 'partner')
      or (
        public.active_membership_role(firm_id) = 'manager'
        and exists (
          select 1 from public.clients c
          where c.firm_id = compliance_instances.firm_id
            and c.id = compliance_instances.client_id
            and c.manager_membership_id = public.active_membership_id(compliance_instances.firm_id)
        )
      )
      or (
        public.active_membership_role(firm_id) in ('senior', 'article_executive')
        and public.active_membership_id(firm_id)
              in (assignee_membership_id, reviewer_membership_id)
      )
    )
  );

-- Insert: manager+ within scope. Scope/four-eyes/assignment validations run
-- in the BEFORE trigger beneath this policy; client_id is trigger-derived
-- (the WITH CHECK scopes via legal_entities, never via the supplied row's
-- client_id).
create policy cin_insert_manager_plus on public.compliance_instances
  for insert to authenticated
  with check (
    firm_id = public.req_active_firm()
    and (
      public.active_membership_role(firm_id) in ('super_admin', 'partner')
      or (
        public.active_membership_role(firm_id) = 'manager'
        and exists (
          select 1 from public.legal_entities le
          join public.clients c on c.firm_id = le.firm_id and c.id = le.client_id
          where le.firm_id = compliance_instances.firm_id
            and le.id = compliance_instances.legal_entity_id
            and c.manager_membership_id = public.active_membership_id(compliance_instances.firm_id)
        )
      )
    )
  );

-- Update: manager+ within scope, non-state fields only — the column grants
-- below expose exactly the permitted non-state set, and the write guard
-- rejects state/provenance/identity movement even where a grant exists
-- (service paths). senior/article have NO direct table mutation right
-- (RLS-CIN-01) — no policy, no grant.
create policy cin_update_manager_plus on public.compliance_instances
  for update to authenticated
  using (
    firm_id = public.req_active_firm()
    and (
      public.active_membership_role(firm_id) in ('super_admin', 'partner')
      or (
        public.active_membership_role(firm_id) = 'manager'
        and exists (
          select 1 from public.clients c
          where c.firm_id = compliance_instances.firm_id
            and c.id = compliance_instances.client_id
            and c.manager_membership_id = public.active_membership_id(compliance_instances.firm_id)
        )
      )
    )
  )
  with check (
    firm_id = public.req_active_firm()
    and (
      public.active_membership_role(firm_id) in ('super_admin', 'partner')
      or (
        public.active_membership_role(firm_id) = 'manager'
        and exists (
          select 1 from public.clients c
          where c.firm_id = compliance_instances.firm_id
            and c.id = compliance_instances.client_id
            and c.manager_membership_id = public.active_membership_id(compliance_instances.firm_id)
        )
      )
    )
  );

-- ---------------------------------------------------------------------------
-- Grants (least privilege at BOTH layers — IMP-012/020/030 pattern; the
-- Supabase default privileges would otherwise hand anon/authenticated full
-- table grants and service_role ALL on every new public table). anon gets
-- nothing, ever; service_role retains its default ALL (server-only paths —
-- recurrence generation IMP-050, operator scripts — per RLS-SVC-01/02, the
-- same posture IMP-020/030 left in place).
--
-- Column-pinned write surface:
--   profiles INSERT: no id/created_at/updated_at (server-managed), no status
--     (forced default 'proposed' — activation is command-only), no
--     approved_by/approved_at (command-stamped).
--   profiles UPDATE: applicability_answers, registration_id (correctable;
--     scope-revalidated), status (non-active moves only — the guard blocks
--     -> 'active' without the command marker).
--   instances INSERT: no id/created_at/updated_at, no client_id
--     (trigger-derived), no state (forced default 'not_started' —
--     transition-command-only), no filed_at/closed_at (command-stamped), no
--     risk_score/risk_factors (derived cache, never user-edited — DM-12), no
--     successor_instance_id (IMP-050 recurrence-owned), and NO recurrence
--     provenance (rule_version_id, generation_source, generated_at,
--     calculated_due_date — AUTO-REC-07): a browser session must never forge
--     recurrence provenance. The IMP-050 generator runs as service_role
--     (default ALL), which is the only provenance-writing path; manual
--     browser creation needs no grant — generation_source defaults to
--     'manual' server-side and the rest stay NULL. The insert-only update
--     guard remains as the second layer beneath the service paths.
--   instances UPDATE: exactly the permitted non-state set (RLS-CIN-01) —
--     engagement association, period_label/period_meta, operative due_date,
--     the three responsibility memberships, priority.
-- ---------------------------------------------------------------------------
revoke all on public.client_compliance_profiles from anon, authenticated;
revoke all on public.compliance_instances from anon, authenticated;

grant select on public.client_compliance_profiles to authenticated;
grant insert (firm_id, legal_entity_id, compliance_type_id, registration_id,
              applicability_answers)
  on public.client_compliance_profiles to authenticated;
grant update (registration_id, applicability_answers, status)
  on public.client_compliance_profiles to authenticated;

grant select on public.compliance_instances to authenticated;
grant insert (firm_id, legal_entity_id, compliance_type_id, registration_id,
              client_compliance_profile_id, engagement_id,
              period_start, period_end, period_label, period_meta, due_date,
              assignee_membership_id, reviewer_membership_id, partner_membership_id,
              priority)
  on public.compliance_instances to authenticated;
grant update (engagement_id, period_label, period_meta, due_date,
              assignee_membership_id, reviewer_membership_id, partner_membership_id,
              priority)
  on public.compliance_instances to authenticated;

-- ---------------------------------------------------------------------------
-- Layer-B command: approve_client_compliance_profile(uuid)
-- (API-R0-CCP approval; RLS-CCP-01; DM-11; C5 ruling).
--
-- SECURITY DEFINER justification (API-SEC-03 — exceptional, reviewed):
-- activation must set status='active' and stamp approved_by/approved_at,
-- which ordinary UPDATE can never do (the write guard's single-writer
-- marker; approval columns carry no grant at all), so no INVOKER variant
-- can work. The function performs its OWN complete authorization: actor
-- from auth.uid() (never parameters/headers), live ACTIVE same-firm
-- membership (DEC-J), active-firm selector match (RLS-CTX-02), role
-- manager+ (super_admin/partner/manager), manager restricted to portfolio
-- (RLS-STF-03 — the entity's client's designated manager is the caller's
-- live membership). NO AAL2: a business approval is not a
-- security-configuration change (RLS-AAL-01 list; RLS-AAL-02).
--
-- AUTHORIZATION FIRST (API-ERR-02 — same ordering rule as
-- transition_compliance_instance): a profile the caller may not see is
-- indistinguishable from a nonexistent one. Immediately after the row
-- fetch the gate resolves active-firm context -> live ACTIVE membership +
-- role -> manager+ / portfolio scope, and EVERY failure returns the
-- IDENTICAL not_found body as a nonexistent id — no existence, firm,
-- status, applicability, or approval-state disclosure pre-authorization.
-- The lifecycle check (only 'proposed' can be approved -> conflict) runs
-- strictly AFTER the gate and is reachable only by an authorized in-scope
-- caller (who could read the row under RLS anyway). Audit treatment
-- (AUD-FAIL-01): the row EXISTS at the gate, so the attempt is a
-- security-significant probe against a real object and IS recorded —
-- server-side, never reflected in the caller-visible body, so the
-- not_found uniformity holds. A truly nonexistent id stays un-audited
-- (IMP-030 precedent: no object to bind the event to).
--
-- The command activates the profile ONLY. It deliberately creates NO
-- compliance_instances: an active profile means "eligible for future
-- materialization" by the recurrence generator (IMP-050, AUTO-REC-01);
-- active-with-zero-instances is valid in the interim (C5 ruling, DM-11).
--
-- Atomicity + denial evidence follow the IMP-030 pattern exactly
-- (AUD-CTX-05, AUD-FAIL-01): app.ccp_approval_command +
-- app.audit_skip_trigger transaction-local markers; deliberate denials
-- raise private errcodes CA401/CA402, are caught, audited, and returned as
-- structured results; any other exception propagates fail-closed.
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

    -- AUTHORIZATION FIRST (API-ERR-02): the lifecycle/status evaluation
    -- below discloses existence and state, so NOTHING after this gate runs
    -- for a caller who may not see the profile — every failure returns the
    -- IDENTICAL not_found body as a nonexistent id.
    -- Resolution: active-firm context (RLS-CTX-02) -> live ACTIVE
    -- membership + role (DEC-J) -> manager+ scope (super_admin/partner
    -- firm-wide; manager portfolio per RLS-STF-03; senior/article/billing/
    -- anything else: no approval right at all).
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
      -- NULL role (suspended/removed/foreign), senior, article_executive,
      -- billing, external_consultant: no approval right at all. The explicit
      -- ELSE (never a bare NOT IN over a NULL role) keeps three-valued
      -- logic from silently permitting.
      v_in_scope := false;
    end if;

    if public.req_active_firm() is distinct from v_profile.firm_id
       or v_role is null
       or not v_in_scope then
      -- The row EXISTS, so this probe is security-significant and IS
      -- audited (AUD-FAIL-01) — server-side only; the caller-visible body
      -- stays byte-identical to the nonexistent-id not_found above.
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

    -- Post-authorization lifecycle check: reachable only by an in-scope
    -- manager+ caller, so disclosing the current status is no wider than
    -- the caller's own RLS read right. Re-approval of an active profile
    -- lands here as a conflict (there is no replay path before the gate).
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

    -- Authoritative Layer-B audit event, same transaction (AUD-FAIL-01
    -- pattern; the Layer-A trigger is skipped via app.audit_skip_trigger).
    perform public.audit_write(
      v_new.firm_id, 'human', (select auth.uid()),
      'compliance_profile.approve',
      'compliance_profile', v_new.id::text,
      to_jsonb(v_profile), to_jsonb(v_new));

    return jsonb_build_object('status', 'approved', 'profile', to_jsonb(v_new));
  exception
    -- Post-authorization deliberate denials only (CA402 lifecycle conflict;
    -- CA401 is now raised solely by the unauthenticated check above the row
    -- fetch — every pre-authorization visibility failure returns not_found
    -- from the gate instead): audit the attempt (AUD-FAIL-01) and return a
    -- structured denial. Everything else (constraint violations, audit
    -- faults, internal errors) propagates fail-closed.
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
  'IMP-031 Layer-B approval command (API-R0-CCP): proposed -> active with approved_by/approved_at stamps. auth.uid() + live ACTIVE same-firm manager+ + active-firm selector + manager portfolio scope, resolved in an authorization-FIRST gate immediately after the row fetch (API-ERR-02): foreign/out-of-scope existing profiles and nonexistent ids return the identical not_found body; existing-row probes are audited server-side with reason ''profile not visible to caller (API-ERR-02)'', nonexistent ids un-audited. The proposed-only lifecycle check (conflict) runs strictly after the gate. NO AAL2 (business approval, RLS-AAL-02); creates NO instances (C5 ruling, IMP-050); atomic mutation+audit; denials audited (AUD-FAIL-01).';

revoke all on function public.approve_client_compliance_profile(uuid) from public, anon, service_role;
grant execute on function public.approve_client_compliance_profile(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Layer-B command: transition_compliance_instance(uuid, text, text)
-- (API-R0-CIN; DM-SM-04; RLS-CIN-01 transition authorization matrix;
-- RLS-4EY-01/02; API-ARCH-04 single controlled write path).
--
-- The ONLY path that changes compliance_instances.state (RLS-CIN-01). The
-- same API-SEC-03 definer justification as the approval command applies:
-- the write guard admits state movement only under the transaction-local
-- app.cin_transition_command marker this function sets.
--
-- Transition legality (DM-SM-04): the ten-state pipeline has a fixed order;
-- the compliance type's workflow_template.states array is the instance's
-- legal path — a transition may move FORWARD to the next template state
-- (skipping optional states absent from the template; reordering is
-- impossible because template order is checked against the canonical
-- pipeline order, not the array's textual order), or REGRESS exactly
-- internal_review -> preparation. Everything else is a CA402 conflict with
-- a machine-readable reason.
--
-- Authorization (RLS-CIN-01 T1) runs FIRST, immediately after the row
-- fetch — before the vocabulary check, the idempotent-replay path, and
-- legality, all of which would otherwise leak row existence/content to a
-- foreign or out-of-scope caller (API-ERR-02). Active-firm context
-- (RLS-CTX-02) + live membership/role (DEC-J) + scope: super_admin/partner
-- firm-wide in the active firm; manager portfolio-scoped (RLS-STF-03);
-- senior/article only when the caller's live membership IS the instance's
-- current assignee or reviewer; billing/external/anon/none denied. Every
-- authorization failure returns the IDENTICAL not_found body as a
-- nonexistent id; the attempt on an EXISTING row is audited server-side
-- (AUD-FAIL-01) without disturbing that uniformity. Post-authorization
-- transition-authority denials remain explicit: the four-eyes overlay
-- (only where the type's four_eyes_required) — any transition LEAVING
-- internal_review other than the regression must be performed by the
-- assigned reviewer membership, no rank bypass (RLS-4EY-02) — and the
-- regression-initiator rule (internal_review -> preparation: the assigned
-- reviewer OR an in-scope manager+ actor; an assignee-only senior/article
-- cannot regress) raise audited CA401 'unauthorized'.
--
-- filed_at is stamped on -> filed, closed_at on -> closed. The command
-- does NOT spawn successor instances (IMP-050, AUTO-REC-01).
--
-- Idempotency (API-MUT-03 family): with p_mutation_key supplied, a repeat
-- against an instance already in p_to_state returns status=
-- 'already_applied' with the current row — no second mutation, no double
-- audit. The key is recorded on the transition audit row
-- (new_value._mutation_key) for traceability. A same-state call WITHOUT a
-- key is an ordinary invalid transition (CA402).
--
-- Errcode vocabulary (IMP-030 convention, one documented extension):
--   CA401 unauthorized  (POST-authorization transition-authority denials:
--                        four-eyes reviewer-only exit, regression initiator;
--                        audited per AUD-FAIL-01. Pre-authorization
--                        context/role/scope failures are the not_found
--                        surface instead — API-ERR-02)
--   CA402 conflict      (legality failures; audited per AUD-FAIL-01)
--   CA400 validation    (NEW with this package: malformed input — unknown
--                        target state; a client error, NOT a
--                        security-significant denial, so un-audited)
-- Any other exception propagates fail-closed (AUD-CTX-05).
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

    -- AUTHORIZATION FIRST (API-ERR-02): an instance the caller may not see
    -- is indistinguishable from a nonexistent one. The vocabulary check,
    -- the keyed-replay path (which returns the FULL ROW), and the legality
    -- evaluation all leak existence/content if they run before this gate —
    -- so nothing below executes for an unauthorized caller (IMP-031
    -- security review).
    -- Resolution: active-firm context (RLS-CTX-02) -> live ACTIVE
    -- membership + role (DEC-J) -> T1 scope (super_admin/partner firm-wide;
    -- manager portfolio; senior/article assigned-only; anything else none).
    -- Every failure returns the IDENTICAL not_found body as a nonexistent id.
    -- Audit treatment (AUD-FAIL-01): the row EXISTS here, so the attempt is
    -- a security-significant probe against a real object and IS recorded —
    -- server-side, never reflected in the caller-visible body, so the
    -- not_found uniformity holds. A truly nonexistent id stays un-audited
    -- (IMP-030 precedent: no object to bind the event to).
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
      -- NULL-safe (three-valued logic): with exactly one assignment slot
      -- NULL and the caller not matching the other, `IN` yields NULL — and
      -- `not v_in_scope` would treat NULL as false and silently PERMIT.
      -- coalesce forces unknown -> denied (RLS-CIN-01 assigned-only scope).
      v_in_scope := coalesce(
        v_membership in (v_inst.assignee_membership_id, v_inst.reviewer_membership_id),
        false);
    else
      -- NULL role (suspended/removed/foreign), billing,
      -- external_consultant: no transition right at all.
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
      -- Unreachable (plain FK); defense in depth, propagates as internal.
      raise exception 'compliance type of instance % is missing', p_instance_id
        using errcode = 'P0001';
    end if;

    -- Target vocabulary: unknown states are malformed input (CA400 ->
    -- `validation`), never a legality conflict.
    v_to_idx := array_position(c_pipeline, p_to_state);
    if v_to_idx is null then
      v_reason := format('unknown target state %L (DM-SM-04 vocabulary)', p_to_state);
      raise exception '%', v_reason using errcode = 'CA400';
    end if;
    v_from_idx := array_position(c_pipeline, v_inst.state);

    -- Idempotent replay: already in the target state. Only reachable by an
    -- authorized in-scope caller (the gate above), so returning the row is
    -- no wider than the caller's own RLS read right.
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

    -- Legality (DM-SM-04): forward to the NEXT template state in canonical
    -- pipeline order (template states between current and target forbid the
    -- jump — they must be stepped through), or the single regression.
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

    -- Four-eyes overlay (RLS-4EY-01/02): where the type requires it, any
    -- transition leaving internal_review (except the regression) must be
    -- performed by the assigned reviewer — no rank bypass. A NULL reviewer
    -- fail-closes the exit until a manager+ assigns one (non-state update).
    if v_type.four_eyes_required
       and v_inst.state = 'internal_review'
       and not v_regression
       and (v_inst.reviewer_membership_id is null
            or v_membership is distinct from v_inst.reviewer_membership_id) then
      v_reason := 'a transition leaving internal_review must be performed by the assigned reviewer (RLS-4EY-01/02)';
      raise exception '%', v_reason using errcode = 'CA401';
    end if;

    -- Regression initiator: the assigned reviewer, or manager+ in scope —
    -- an assignee-only senior/article may NOT send work back (DM-SM-04).
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

    -- IMP-050 boundary: NO successor instance is spawned here (AUTO-REC-01).

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
  'IMP-031 Layer-B transition command (API-R0-CIN): the ONLY state-change path (RLS-CIN-01). Authorization FIRST — pre-authorization context/role/scope failures return the API-ERR-02 not_found surface (audited server-side when the row exists); then DM-SM-04 legality via the type workflow_template over the canonical pipeline (skip, never reorder) + internal_review->preparation regression; four-eyes reviewer-only review exit with no rank bypass (RLS-4EY-01/02); filed_at/closed_at stamps; no successor spawn (IMP-050); mutation-key idempotent replay; atomic mutation+audit; denials audited (AUD-FAIL-01).';

revoke all on function public.transition_compliance_instance(uuid, text, text) from public, anon, service_role;
grant execute on function public.transition_compliance_instance(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Layer-A audit (IMP-013 foundation; SCH-11 approval decisions and SCH-12
-- state transitions/assignee changes/filing markers are HIGH, PRD §67).
-- Extends the audited-table mapping via the established create-or-replace
-- mechanism (IMP-020/021/030 precedent); committed migration files stay
-- immutable. The two Layer-B commands set app.audit_skip_trigger and write
-- the authoritative lifecycle events themselves — no duplicate rows.
-- AUD-VAL-02 redaction review for SCH-11/12: applicability answers, state,
-- assignment, period and provenance data are exactly what the audit trail
-- must preserve; no secrets-adjacent columns exist; none redacted.
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
  'IMP-013 Layer-A audit trigger (AUD-CTX-01), mapping extended by IMP-020 (SCH-04…08), IMP-021 (SCH-09), IMP-030 (SCH-10/32), and IMP-031 (SCH-11/12). Actor from auth.uid()/jwt role only; firm/object from the row. DEFINER solely so application roles without audit_log INSERT privilege can be audited; owner-only EXECUTE.';

create trigger client_compliance_profiles_audit_row
  after insert or update or delete on public.client_compliance_profiles
  for each row execute function public.audit_trg_row();

create trigger compliance_instances_audit_row
  after insert or update or delete on public.compliance_instances
  for each row execute function public.audit_trg_row();

-- ---------------------------------------------------------------------------
-- Notes for reviewers
-- ---------------------------------------------------------------------------
-- * No DELETE exists for anyone on either table (lifecycle statuses; audit-
--   sensitive tables are never hard-deleted, spec 06 conventions).
-- * The approval command creates NO instances and the transition command
--   spawns NO successor — both materialization sides are IMP-050
--   (AUTO-REC-01/02; C5 ruling). Do not add generation side effects here.
-- * AUTO-REC-03 partition: this package ships layer 3 (the NULLS NOT
--   DISTINCT obligation-period unique key); layers 1/2/4 are IMP-050.
-- * due_date remains the OPERATIVE date: manager+ may move it by direct
--   update (statutory extensions) and the move is audited by the Layer-A
--   trigger (compliance_instance.due_date_changed evidence); the immutable
--   calculated_due_date preserves the rule's output (AUTO-REC-07).
-- * The x-active-firm selector is untrusted context everywhere: without a
--   live ACTIVE membership of the required role it selects nothing
--   (RLS-CTX-02), and suspended/removed memberships authorize nothing on
--   the next statement with the same JWT (DEC-J, RLS-STF-07).
-- * Both catalogs' integration expectations (tests/integration/schema
--   rls-catalog/tenant-core inventories) predate IMP-031 and will need
--   their table/policy/grant/function counts extended in the test phase of
--   this package — by design they fail until then (exact-inventory style).
