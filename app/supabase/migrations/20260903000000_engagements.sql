-- IMP-021 — Engagements (SCH-09)
--
-- Implements exactly: engagements (SCH-09) per docs/spec/06-database-schema.md,
-- with production RLS per docs/spec/05-authorization-rls.md (RLS-ENG-01) and
-- Layer-A audit coverage per docs/spec/08-audit-security.md (AUD-CAT-01:
-- engagements are HIGH audit-sensitive → TEST-AUD-01 trigger coverage).
--
-- Domain position (DM-09): an Engagement is the professional-service scope /
-- engagement-letter relationship belonging to a CLIENT (the commercial
-- relationship) — never a legal entity, never a compliance subject
-- (compliance scope vocabulary stays exactly entity | registration |
-- configurable; instances may only ASSOCIATE an engagement later, SCH-12).
-- Deferred per DM-09: e-sign flow, fee schedules, letter document generation.
--
-- Authorization model (DEC-J, resolved): auth.uid() establishes identity;
-- every check is a LIVE read of firm_memberships. Policies are active-firm
-- scoped (RLS-CTX-01/02): firm_id must equal the untrusted x-active-firm
-- selector AND the caller must hold a live ACTIVE membership with the
-- required role in that firm.
--
-- Role cells (05 §11 matrix + RLS-ENG-01):
--   super_admin/partner : full read + write within the active firm
--   manager             : READ ONLY, portfolio-scoped via the owning client's
--                         manager_membership_id (RLS-STF-03 lists engagements
--                         among portfolio-related operational records);
--                         RLS-ENG-01 grants write to "partner+" only —
--                         unlike clients, managers do NOT write engagements
--   billing             : NO table access; letter-status-only projection via
--                         the reviewed SECURITY DEFINER
--                         list_engagement_letter_statuses() (RLS-ENG-01
--                         "letter/fee status only"; fee schedules are a
--                         deferred DM-09 item, so no fee fields exist in R0)
--   senior/article      : NO access in R0 — RLS-STF-04 assigned-work scope
--                         requires tasks/compliance-instances (same recorded
--                         deferral as IMP-020; later packages extend)
--   suspended/removed   : nothing (RLS-STF-07)
-- No DELETE for anyone (lifecycle statuses; audit-sensitive tables are never
-- hard-deleted, spec 06 conventions).

-- ---------------------------------------------------------------------------
-- SCH-09 — engagements
-- ---------------------------------------------------------------------------
create table public.engagements (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null,
  client_id uuid not null,
  responsible_partner_membership_id uuid not null,
  service_lines text[] not null default '{}',
  letter_status text not null default 'not_started',
  proposed_at timestamptz,
  signed_at timestamptz,
  period_label text,
  status text not null default 'draft',
  termination_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  constraint engagements_letter_status_check
    check (letter_status in ('not_started', 'issued', 'signed', 'expired')),
  constraint engagements_status_check
    check (status in ('draft', 'proposed', 'active', 'completed', 'terminated')),
  -- DM-SM-03: "terminated: early end; reason required" — rejected input,
  -- maps to `validation` in the API taxonomy (API-ERR-01; generic CHECK).
  constraint engagements_termination_reason_check
    check (status <> 'terminated' or termination_reason is not null),
  constraint engagements_firm_fkey
    foreign key (firm_id) references public.firms (id) on delete restrict,
  -- SCH-FK-01/02: composite same-firm FK — an engagement can never reference
  -- a client of another firm at the constraint layer (RLS is not FK
  -- integrity).
  constraint engagements_client_fkey
    foreign key (firm_id, client_id)
    references public.clients (firm_id, id) on delete restrict,
  -- SCH-RESP-01/03: responsibility references are composite membership FKs,
  -- same-firm proven at the constraint layer (never bare profile refs).
  constraint engagements_responsible_partner_fkey
    foreign key (firm_id, responsible_partner_membership_id)
    references public.firm_memberships (firm_id, id) on delete restrict,
  -- SCH-FK-01: composite-FK parent key — the future
  -- engagements→compliance_instances optional association (SCH-FK-02) and
  -- any later child references bind (firm_id, id).
  constraint engagements_firm_id_unique unique (firm_id, id)
);

comment on table public.engagements is 'SCH-09: professional-service scope + engagement-letter status (DM-09). Belongs to a Client; never the compliance subject. Responsible partner = oversight, not execution (DM-OQ-02).';

create index engagements_client_idx on public.engagements (client_id);
create index engagements_firm_status_idx on public.engagements (firm_id, status);

create trigger engagements_set_updated_at
  before update on public.engagements
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Responsibility validation (DM-09 / SCH-RESP-03): the responsible partner
-- must be an ACTIVE membership of the same firm. Mirrors DM-04's
-- clients_validate_responsibility: ACTIVE-status enforcement at the
-- database layer, no role restriction (the spec mandates none; recorded
-- IMP-021 interpretation). DEFINER solely so the check can read
-- firm_memberships under FORCE RLS regardless of the writer's table grants.
-- ---------------------------------------------------------------------------
create or replace function public.engagements_validate_responsibility()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.firm_memberships m
    where m.firm_id = new.firm_id
      and m.id = new.responsible_partner_membership_id
      and m.status = 'active'
  ) then
    raise exception 'responsible_partner_membership_id must be an ACTIVE membership of the same firm (DM-09)'
      using errcode = '23503';
  end if;
  return new;
end;
$$;

revoke all on function public.engagements_validate_responsibility() from public, anon, authenticated, service_role;

create trigger engagements_validate_responsibility
  before insert or update of responsible_partner_membership_id, firm_id
  on public.engagements
  for each row execute function public.engagements_validate_responsibility();

-- ---------------------------------------------------------------------------
-- DM-SM-03 lifecycle guard: draft → proposed → active → completed,
-- active → terminated; completed/terminated are terminal; same-status
-- updates are no-ops. INVOKER is sufficient — it compares OLD/NEW only.
-- Transition violations are `conflict` in the API taxonomy (API-ERR-01
-- "transition violation", API-R0-ENG "status/letter transitions per
-- DM-SM-03"); the DETAIL marker is the deterministic discriminator the API
-- layer uses, exactly like the IMP-020 IMMUTABLE_FIELD marker — generic
-- 23514 CHECK violations remain `validation`.
-- ---------------------------------------------------------------------------
create or replace function public.engagements_guard_status_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status is distinct from old.status
     and not (
       (old.status = 'draft'    and new.status = 'proposed')
       or (old.status = 'proposed' and new.status = 'active')
       or (old.status = 'active'   and new.status in ('completed', 'terminated'))
     ) then
    raise exception 'invalid engagements.status transition % -> % (DM-SM-03)', old.status, new.status
      using errcode = '23514', detail = 'INVALID_TRANSITION:engagements.status';
  end if;
  return new;
end;
$$;

revoke all on function public.engagements_guard_status_transition() from public, anon, authenticated, service_role;

create trigger engagements_guard_status_transition
  before update of status on public.engagements
  for each row execute function public.engagements_guard_status_transition();

-- ---------------------------------------------------------------------------
-- RLS (RLS-ENG-01; FORCE per RLS-PRIN-02)
-- ---------------------------------------------------------------------------
alter table public.engagements enable row level security;
alter table public.engagements force row level security;

-- Read: active-firm selector + live role. super_admin/partner: all firm
-- rows; manager: portfolio only (owning client's designated manager is the
-- caller's own live membership); billing: none (projection function below);
-- senior/article: none in R0.
create policy engagements_select_scoped on public.engagements
  for select to authenticated
  using (
    firm_id = public.req_active_firm()
    and (
      public.active_membership_role(firm_id) in ('super_admin', 'partner')
      or (
        public.active_membership_role(firm_id) = 'manager'
        and exists (
          select 1 from public.clients c
          where c.firm_id = engagements.firm_id
            and c.id = engagements.client_id
            and c.manager_membership_id = public.active_membership_id(engagements.firm_id)
        )
      )
    )
  );

-- Write (RLS-ENG-01: "partner+ write"). firm_id is pinned to the selector
-- on both sides — a row can never be created in or moved toward a firm
-- outside the caller's authorized active context. Managers are read-only
-- on engagements (unlike the client hierarchy).
create policy engagements_insert_partner_plus on public.engagements
  for insert to authenticated
  with check (
    firm_id = public.req_active_firm()
    and public.active_membership_role(firm_id) in ('super_admin', 'partner')
  );

create policy engagements_update_partner_plus on public.engagements
  for update to authenticated
  using (
    firm_id = public.req_active_firm()
    and public.active_membership_role(firm_id) in ('super_admin', 'partner')
  )
  with check (
    firm_id = public.req_active_firm()
    and public.active_membership_role(firm_id) in ('super_admin', 'partner')
  );

-- ---------------------------------------------------------------------------
-- Grants (least privilege at BOTH layers — IMP-012/020 pattern).
-- Supabase default privileges would otherwise hand anon/authenticated full
-- table grants on every new public table — strip them first.
-- SELECT for the read policy above; column-pinned INSERT/UPDATE so identity
-- columns (id, firm_id) and parentage (client_id — an engagement never moves
-- to another client) are never mutable. No DELETE for anyone.
-- ---------------------------------------------------------------------------
revoke all on public.engagements from anon, authenticated;

grant select on public.engagements to authenticated;
grant insert (firm_id, client_id, responsible_partner_membership_id, service_lines, letter_status, proposed_at, signed_at, period_label, status, termination_reason) on public.engagements to authenticated;
-- firm_id/client_id excluded: parentage never changes (same precedent as
-- legal_entities.entity_type / client_id in IMP-020).
grant update (responsible_partner_membership_id, service_lines, letter_status, proposed_at, signed_at, period_label, status, termination_reason) on public.engagements to authenticated;

-- ---------------------------------------------------------------------------
-- list_engagement_letter_statuses(uuid): the billing role's letter-status
-- projection (RLS-ENG-01: "billing read letter/fee status only" — fee
-- schedules are deferred per DM-09, so letter_status is the entire R0
-- surface). A VIEW cannot implement this: FORCE RLS (RLS-PRIN-02) binds even
-- the view owner, and column grants cannot distinguish app roles that share
-- the `authenticated` DB role. API-SEC-03 therefore applies: an explicit,
-- reviewed SECURITY DEFINER function performing its OWN authorization.
--
-- Authorization predicate (RLS-A-04 pattern, IMP-020 closure decision B):
--   p_firm_id = req_active_firm()           — same single-active-firm
--                                             model as normal RLS access;
--                                             membership elsewhere is not
--                                             sufficient
--   + live ACTIVE membership of auth.uid()
--   + role = 'billing'
-- JWT firm/role claims are never consulted (DEC-J).
-- Returns letter-status fields only (id, client_id, letter_status); no
-- service lines, responsibility references, dates, or firm internals.
create or replace function public.list_engagement_letter_statuses(p_firm_id uuid)
returns table (id uuid, client_id uuid, letter_status text)
language sql
stable
security definer
set search_path = ''
as $$
  select e.id, e.client_id, e.letter_status
  from public.engagements e
  where e.firm_id = p_firm_id
    and p_firm_id = public.req_active_firm()
    and public.active_membership_role(p_firm_id) = 'billing'
  order by e.created_at
$$;

comment on function public.list_engagement_letter_statuses(uuid) is
  'IMP-021 RLS-ENG-01 billing letter-status projection (API-SEC-03): own explicit authorization — p_firm_id = active-firm selector + live ACTIVE billing membership; letter-status fields only; never a general read path.';

revoke all on function public.list_engagement_letter_statuses(uuid) from public, anon, service_role;
grant execute on function public.list_engagement_letter_statuses(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Layer-A audit (IMP-013 foundation; AUD-CAT-01: engagements are HIGH).
-- Extends the audited-table mapping; trigger function behavior otherwise
-- unchanged (actor from auth.uid(), firm from the row, metadata untrusted).
-- create-or-replace is the established extension mechanism (IMP-020 extended
-- the IMP-013 mapping the same way); committed migration files stay
-- immutable.
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
  else
    -- Defense in depth: this trigger must only ever be attached to the
    -- mapped tables above.
    raise exception 'audit_trg_row attached to unmapped table %', TG_TABLE_NAME
      using errcode = 'P0001';
  end if;

  -- AUD-VAL-01: old+new for UPDATE, NEW only for INSERT, OLD only for
  -- DELETE. AUD-VAL-02: redaction review for engagements — the row carries
  -- service scope and letter-status data that is exactly what the audit
  -- trail must preserve for accountability; no secrets-adjacent columns
  -- exist; none redacted.
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
  'IMP-013 Layer-A audit trigger (AUD-CTX-01), mapping extended by IMP-020 (SCH-04…08) and IMP-021 (SCH-09). Actor from auth.uid()/jwt role only; firm/object from the row. DEFINER solely so application roles without audit_log INSERT privilege can be audited; owner-only EXECUTE.';

create trigger engagements_audit_row
  after insert or update or delete on public.engagements
  for each row execute function public.audit_trg_row();

-- ---------------------------------------------------------------------------
-- Notes for reviewers
-- ---------------------------------------------------------------------------
-- * Manager is READ-ONLY on engagements: RLS-ENG-01 grants write to
--   "partner+" — unlike the client hierarchy (RLS-CLI-02 manager+ write).
-- * Senior/article_executive see NOTHING here in R0: RLS-STF-04 scopes them
--   to assigned work, which requires tasks/compliance_instances (IMP-030/040
--   families). Same recorded deferral as IMP-020.
-- * Billing table access is denied entirely; RLS-ENG-01's "letter/fee
--   status only" surface is the reviewed list_engagement_letter_statuses()
--   definer function (fee schedules deferred, DM-09 — letter_status is the
--   entire R0 projection).
-- * The x-active-firm selector is untrusted context everywhere: without a
--   live ACTIVE membership of the required role it selects nothing
--   (RLS-CTX-02), and membership changes take effect on the next
--   authorization check with the same JWT (DEC-J).
-- * Status transitions are enforced at the database layer (DM-SM-03 guard
--   trigger) so no write path can skip them; violations carry the
--   INVALID_TRANSITION detail marker → `conflict` (API-ERR-01), while the
--   termination-reason CHECK is ordinary rejected input → `validation`.
-- * Audit failure semantics are inherited from IMP-013: audit_write failure
--   aborts the triggering statement and rolls the business mutation back
--   (atomicity), and app.audit_skip_trigger remains internal to the Layer-B
--   single-writer path (no engagements RPC uses it — direct CRUD only).
