-- IMP-020 — Client hierarchy (SCH-04…08)
--
-- Implements exactly: clients (SCH-04), legal_entities (SCH-05),
-- client_relationships (SCH-06), registrations (SCH-07), contacts (SCH-08)
-- per docs/spec/06-database-schema.md, with production RLS per
-- docs/spec/05-authorization-rls.md and Layer-A audit coverage per
-- docs/spec/08-audit-security.md (TEST-AUD-01: every HIGH/MEDIUM table).
--
-- Domain hierarchy (DM-04…08): Firm → Client (commercial relationship) →
-- LegalEntity (company/LLP/individual/…) → Registration (PAN/GSTIN/…).
-- Client and LegalEntity are never collapsed; registrations attach to
-- legal entities only.
--
-- Authorization model (DEC-J, resolved): auth.uid() establishes identity;
-- every check is a LIVE read of firm_memberships. Domain policies are
-- active-firm scoped (RLS-CTX-01/02): firm_id must equal the untrusted
-- x-active-firm selector AND the caller must hold a live ACTIVE membership
-- with the required role in that firm. There is no all-firms staff view.
--
-- Role cells (05 §11, RLS-CLI-01/02, RLS-ENT-01, RLS-REG-01, RLS-CON-01):
--   super_admin/partner : full read + write within the active firm
--   manager             : read + write within the owned portfolio
--                         (RLS-OQ-02 RESOLVED: designated-manager clients
--                         and their related operational records)
--   billing             : NO table access; identity-only projection via the
--                         reviewed SECURITY DEFINER list_client_identities()
--                         (RLS-CLI-01). Entity/registration/contact billing
--                         projections are deferred — no billing fields exist
--                         on those tables in R0 (invoices deferred, SCH-28).
--   senior/article      : NO access in IMP-020 — RLS-STF-04 assigned-work
--                         scope requires tasks/compliance-instances (later
--                         packages extend these policies when assignment-
--                         bearing tables exist).
--   suspended/removed   : nothing (RLS-STF-07)
-- No DELETE for anyone (lifecycle statuses; audit-sensitive tables are
-- never hard-deleted, spec 06 conventions).

-- ---------------------------------------------------------------------------
-- SCH-04 — clients
-- ---------------------------------------------------------------------------
create table public.clients (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null,
  name text not null,
  industry text,
  risk_rating text,
  owner_partner_membership_id uuid not null,
  manager_membership_id uuid,
  status text not null default 'onboarding',
  tags text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  constraint clients_risk_rating_check
    check (risk_rating in ('low', 'medium', 'high')),
  constraint clients_status_check
    check (status in ('onboarding', 'active', 'inactive', 'offboarded')),
  constraint clients_firm_fkey
    foreign key (firm_id) references public.firms (id) on delete restrict,
  -- SCH-RESP-01/03: responsibility references are composite membership FKs,
  -- same-firm proven at the constraint layer (never bare profile refs).
  constraint clients_owner_partner_fkey
    foreign key (firm_id, owner_partner_membership_id)
    references public.firm_memberships (firm_id, id) on delete restrict,
  constraint clients_manager_fkey
    foreign key (firm_id, manager_membership_id)
    references public.firm_memberships (firm_id, id) on delete restrict,
  -- SCH-FK-01: composite-FK parent key for child tables.
  constraint clients_firm_id_unique unique (firm_id, id)
);

comment on table public.clients is 'SCH-04: commercial relationship (DM-04). Offboarded = excluded from default views, never silently deleted.';

create index clients_firm_status_idx on public.clients (firm_id, status);
create index clients_firm_name_idx on public.clients (firm_id, name);
create index clients_owner_partner_idx on public.clients (firm_id, owner_partner_membership_id);

-- ---------------------------------------------------------------------------
-- SCH-05 — legal_entities
-- ---------------------------------------------------------------------------
create table public.legal_entities (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null,
  client_id uuid not null,
  entity_type text not null,
  legal_name text not null,
  incorporation_date date,
  registered_address text,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  constraint legal_entities_entity_type_check
    check (entity_type in ('private_limited', 'llp', 'individual',
                           'partnership', 'trust', 'huf', 'other')),
  constraint legal_entities_status_check
    check (status in ('active', 'dormant', 'dissolved')),
  constraint legal_entities_firm_fkey
    foreign key (firm_id) references public.firms (id) on delete restrict,
  constraint legal_entities_client_fkey
    foreign key (firm_id, client_id)
    references public.clients (firm_id, id) on delete restrict,
  constraint legal_entities_firm_id_unique unique (firm_id, id)
);

comment on table public.legal_entities is 'SCH-05: entity layer (DM-05). entity_type immutable after creation (update guard).';

create index legal_entities_client_idx on public.legal_entities (client_id);
create index legal_entities_firm_status_idx on public.legal_entities (firm_id, status);

-- ---------------------------------------------------------------------------
-- SCH-06 — client_relationships
-- ---------------------------------------------------------------------------
create table public.client_relationships (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null,
  from_entity_id uuid not null,
  to_entity_id uuid not null,
  relation_type text not null,
  effective_from date,
  effective_to date,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  constraint client_relationships_relation_type_check
    check (relation_type in ('group', 'holding', 'subsidiary', 'director',
                             'partner', 'promoter', 'related_party', 'family')),
  constraint client_relationships_status_check
    check (status in ('active', 'ended')),
  constraint client_relationships_no_self_loop
    check (from_entity_id <> to_entity_id),
  constraint client_relationships_firm_fkey
    foreign key (firm_id) references public.firms (id) on delete restrict,
  -- Composite FKs make cross-firm edges impossible (SCH-FK-01).
  constraint client_relationships_from_entity_fkey
    foreign key (firm_id, from_entity_id)
    references public.legal_entities (firm_id, id) on delete restrict,
  constraint client_relationships_to_entity_fkey
    foreign key (firm_id, to_entity_id)
    references public.legal_entities (firm_id, id) on delete restrict
);

comment on table public.client_relationships is 'SCH-06: group/related-party graph edges (DM-07). R0 basic.';

create index client_relationships_from_idx on public.client_relationships (from_entity_id);
create index client_relationships_to_idx on public.client_relationships (to_entity_id);

-- ---------------------------------------------------------------------------
-- SCH-07 — registrations
-- ---------------------------------------------------------------------------
create table public.registrations (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null,
  legal_entity_id uuid not null,
  type text not null,
  value text not null,
  state text,
  meta jsonb,
  valid_from date,
  valid_to date,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  constraint registrations_type_check
    check (type in ('PAN', 'GSTIN', 'TAN', 'CIN', 'LLPIN', 'DIN',
                    'PT', 'PF', 'ESI', 'OTHER')),
  constraint registrations_status_check
    check (status in ('active', 'surrendered', 'expired')),
  -- DM-06: GSTIN implies a state attribute (multi-state clients hold
  -- multiple GSTIN registrations).
  constraint registrations_gstin_state_check
    check (type <> 'GSTIN' or state is not null),
  constraint registrations_firm_fkey
    foreign key (firm_id) references public.firms (id) on delete restrict,
  constraint registrations_legal_entity_fkey
    foreign key (firm_id, legal_entity_id)
    references public.legal_entities (firm_id, id) on delete restrict,
  -- DM-06: (firm, type, value) is unique. Business identifiers are never PKs.
  constraint registrations_firm_type_value_unique unique (firm_id, type, value)
);

comment on table public.registrations is 'SCH-07: statutory identifiers (DM-06). meta carries establishment/jurisdiction data per DM-27; no first-class Establishment entity in R0.';

create index registrations_legal_entity_idx on public.registrations (legal_entity_id);
create index registrations_firm_value_idx on public.registrations (firm_id, value);

-- ---------------------------------------------------------------------------
-- SCH-08 — contacts
-- ---------------------------------------------------------------------------
create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null,
  client_id uuid not null,
  legal_entity_id uuid,
  name text not null,
  role_title text,
  email text,
  phone text,
  is_primary boolean not null default false,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  constraint contacts_status_check
    check (status in ('active', 'inactive')),
  -- SCH-08/DM-08: a primary contact must have a reachable channel
  -- (email initially, DEC-Q).
  constraint contacts_primary_email_check
    check (not is_primary or email is not null),
  constraint contacts_firm_fkey
    foreign key (firm_id) references public.firms (id) on delete restrict,
  constraint contacts_client_fkey
    foreign key (firm_id, client_id)
    references public.clients (firm_id, id) on delete restrict,
  constraint contacts_legal_entity_fkey
    foreign key (firm_id, legal_entity_id)
    references public.legal_entities (firm_id, id) on delete restrict
);

comment on table public.contacts is 'SCH-08: client-side personnel (DM-08). Portal access mappings deferred (Release 2, SCH-31).';

create index contacts_client_idx on public.contacts (client_id);

-- ---------------------------------------------------------------------------
-- Fail-closed privilege baseline (IMP-010 pattern): strip default grants
-- before re-granting the exact least-privilege surface below.
-- ---------------------------------------------------------------------------
revoke all on public.clients from anon, authenticated;
revoke all on public.legal_entities from anon, authenticated;
revoke all on public.client_relationships from anon, authenticated;
revoke all on public.registrations from anon, authenticated;
revoke all on public.contacts from anon, authenticated;

-- ---------------------------------------------------------------------------
-- updated_at maintenance (schema convention; NOT audit)
-- ---------------------------------------------------------------------------
create trigger clients_set_updated_at
  before update on public.clients
  for each row execute function public.set_updated_at();
create trigger legal_entities_set_updated_at
  before update on public.legal_entities
  for each row execute function public.set_updated_at();
create trigger client_relationships_set_updated_at
  before update on public.client_relationships
  for each row execute function public.set_updated_at();
create trigger registrations_set_updated_at
  before update on public.registrations
  for each row execute function public.set_updated_at();
create trigger contacts_set_updated_at
  before update on public.contacts
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- DM-04 invariant: owner partner and (optional) manager must be ACTIVE
-- memberships of the same firm at designation time (composite FKs already
-- prove same-firm existence; this guard adds the live status check).
-- SECURITY DEFINER because a caller's RLS-visible roster depends on the
-- active-firm selector — designation validity must not. Reads only
-- firm_memberships; never callable as a meaningful RPC (TG_OP is null
-- outside trigger context) and EXECUTE is revoked anyway.
-- ---------------------------------------------------------------------------
create or replace function public.clients_validate_responsibility()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.firm_memberships m
    where m.firm_id = new.firm_id
      and m.id = new.owner_partner_membership_id
      and m.status = 'active'
  ) then
    raise exception 'owner_partner_membership_id must be an ACTIVE membership of the same firm (DM-04)'
      using errcode = '23503';
  end if;
  if new.manager_membership_id is not null and not exists (
    select 1 from public.firm_memberships m
    where m.firm_id = new.firm_id
      and m.id = new.manager_membership_id
      and m.status = 'active'
  ) then
    raise exception 'manager_membership_id must be an ACTIVE membership of the same firm (DM-04)'
      using errcode = '23503';
  end if;
  return new;
end;
$$;

revoke all on function public.clients_validate_responsibility() from public, anon, authenticated, service_role;

create trigger clients_validate_responsibility
  before insert or update of owner_partner_membership_id, manager_membership_id, firm_id
  on public.clients
  for each row execute function public.clients_validate_responsibility();

-- ---------------------------------------------------------------------------
-- SCH-05 invariant: entity_type is immutable after creation (DM-05).
-- INVOKER is sufficient — it compares OLD/NEW only, no table reads.
-- Maps to `conflict` in the API taxonomy via the DETAIL marker below
-- (API-R0-ENT); generic 23514 CHECK violations map to `validation`
-- (API-ERR-01; IMP-020 closure decision).
-- ---------------------------------------------------------------------------
create or replace function public.legal_entities_guard_entity_type()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.entity_type is distinct from old.entity_type then
    -- errcode 23514 alone is ambiguous (any CHECK violation raises it);
    -- the DETAIL marker is the deterministic discriminator the API layer
    -- uses to map THIS invariant to `conflict` (API-R0-ENT) while generic
    -- CHECK violations map to `validation` (API-ERR-01; human decision,
    -- IMP-020 closure 2026-09-02).
    raise exception 'legal_entities.entity_type is immutable after creation (DM-05); a conversion creates a new entity with a relationship link'
      using errcode = '23514', detail = 'IMMUTABLE_FIELD:legal_entities.entity_type';
  end if;
  return new;
end;
$$;

revoke all on function public.legal_entities_guard_entity_type() from public, anon, authenticated, service_role;

create trigger legal_entities_guard_entity_type
  before update of entity_type on public.legal_entities
  for each row execute function public.legal_entities_guard_entity_type();

-- ---------------------------------------------------------------------------
-- RLS helpers (IMP-012 discipline: DEC-J live lookup, minimal definer
-- surface, pinned search_path, fully-qualified objects, no dynamic SQL)
-- ---------------------------------------------------------------------------

-- active_membership_id(uuid): the caller's CURRENT active membership id in
-- one firm — the portfolio anchor for manager scoping (RLS-STF-03,
-- RLS-OQ-02). SECURITY DEFINER solely so policies on OTHER tables need no
-- firm_memberships SELECT visibility; exposes exactly one uuid or NULL.
create or replace function public.active_membership_id(p_firm_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.id
  from public.firm_memberships m
  where m.firm_id = p_firm_id
    and m.user_id = (select auth.uid())
    and m.status = 'active'
$$;

comment on function public.active_membership_id(uuid) is
  'IMP-020 RLS-STF-03: caller''s live ACTIVE membership id in the given firm (portfolio anchor), or NULL. SECURITY DEFINER solely to avoid RLS coupling; exact-predicate only, never a bypass.';

revoke all on function public.active_membership_id(uuid) from public, anon;
grant execute on function public.active_membership_id(uuid) to authenticated, service_role;

-- list_client_identities(uuid): the billing role's identity-only client
-- projection (RLS-CLI-01: "billing identity-only projection"). A VIEW
-- cannot implement this: FORCE RLS (RLS-PRIN-02) binds even the view
-- owner, and column grants cannot distinguish app roles that share the
-- `authenticated` DB role. API-SEC-03 therefore applies: an explicit,
-- reviewed SECURITY DEFINER function performing its OWN authorization.
--
-- Authorization predicate (human decision, IMP-020 closure 2026-09-02):
--   p_firm_id = req_active_firm()           — same single-active-firm
--                                             model as normal RLS access;
--                                             membership elsewhere is not
--                                             sufficient
--   + live ACTIVE membership of auth.uid()
--   + role = 'billing'
-- JWT firm/role claims are never consulted (DEC-J).
-- Returns identity fields only (id, name, status); no risk_rating, tags,
-- responsibility references, or firm internals.
create or replace function public.list_client_identities(p_firm_id uuid)
returns table (id uuid, name text, status text)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.name, c.status
  from public.clients c
  where c.firm_id = p_firm_id
    and p_firm_id = public.req_active_firm()
    and public.active_membership_role(p_firm_id) = 'billing'
  order by c.name
$$;

comment on function public.list_client_identities(uuid) is
  'IMP-020 RLS-CLI-01 billing identity-only projection (API-SEC-03): own explicit authorization — p_firm_id = active-firm selector + live ACTIVE billing membership; identity fields only; never a general read path.';

revoke all on function public.list_client_identities(uuid) from public, anon, service_role;
grant execute on function public.list_client_identities(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Layer-A audit (IMP-013 foundation; TEST-AUD-01: complete old/new for
-- insert/update/delete on every HIGH/MEDIUM audit-sensitive table).
-- Extends the audited-table mapping; trigger function behavior otherwise
-- unchanged (actor from auth.uid(), firm from the row, metadata untrusted).
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
  else
    -- Defense in depth: this trigger must only ever be attached to the
    -- mapped tables above.
    raise exception 'audit_trg_row attached to unmapped table %', TG_TABLE_NAME
      using errcode = 'P0001';
  end if;

  -- AUD-VAL-01: old+new for UPDATE, NEW only for INSERT, OLD only for
  -- DELETE. AUD-VAL-02: redaction list reviewed for the IMP-020 tables —
  -- contacts carry light PII (name/email/phone) that is exactly the data
  -- the audit trail must preserve for accountability; no secrets-adjacent
  -- columns exist; none redacted.
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
  'IMP-013 Layer-A audit trigger (AUD-CTX-01), mapping extended by IMP-020 (SCH-04…08). Actor from auth.uid()/jwt role only; firm/object from the row. DEFINER solely so application roles without audit_log INSERT privilege can be audited; owner-only EXECUTE.';

create trigger clients_audit_row
  after insert or update or delete on public.clients
  for each row execute function public.audit_trg_row();
create trigger legal_entities_audit_row
  after insert or update or delete on public.legal_entities
  for each row execute function public.audit_trg_row();
create trigger client_relationships_audit_row
  after insert or update or delete on public.client_relationships
  for each row execute function public.audit_trg_row();
create trigger registrations_audit_row
  after insert or update or delete on public.registrations
  for each row execute function public.audit_trg_row();
create trigger contacts_audit_row
  after insert or update or delete on public.contacts
  for each row execute function public.audit_trg_row();

-- ---------------------------------------------------------------------------
-- RLS (RLS-PRIN-01/02: enabled AND FORCED on every tenant-owned table)
-- ---------------------------------------------------------------------------
alter table public.clients enable row level security;
alter table public.clients force row level security;
alter table public.legal_entities enable row level security;
alter table public.legal_entities force row level security;
alter table public.client_relationships enable row level security;
alter table public.client_relationships force row level security;
alter table public.registrations enable row level security;
alter table public.registrations force row level security;
alter table public.contacts enable row level security;
alter table public.contacts force row level security;

-- --- clients (RLS-CLI-01/02) ------------------------------------------------
-- Read: active-firm selector + live role. super_admin/partner: all firm
-- rows; manager: portfolio only; billing: none (projection function);
-- senior/article: none in R0 (assigned-work scope needs tasks — later).
create policy clients_select_scoped on public.clients
  for select to authenticated
  using (
    firm_id = public.req_active_firm()
    and (
      public.active_membership_role(firm_id) in ('super_admin', 'partner')
      or (
        public.active_membership_role(firm_id) = 'manager'
        and manager_membership_id = public.active_membership_id(firm_id)
      )
    )
  );

-- Write (RLS-CLI-02: manager+ within scope). firm_id is pinned to the
-- selector on both sides — a row can never be created in or moved toward
-- a firm outside the caller's authorized active context.
create policy clients_insert_manager_plus on public.clients
  for insert to authenticated
  with check (
    firm_id = public.req_active_firm()
    and (
      public.active_membership_role(firm_id) in ('super_admin', 'partner')
      or (
        public.active_membership_role(firm_id) = 'manager'
        and manager_membership_id = public.active_membership_id(firm_id)
      )
    )
  );

create policy clients_update_manager_plus on public.clients
  for update to authenticated
  using (
    firm_id = public.req_active_firm()
    and (
      public.active_membership_role(firm_id) in ('super_admin', 'partner')
      or (
        public.active_membership_role(firm_id) = 'manager'
        and manager_membership_id = public.active_membership_id(firm_id)
      )
    )
  )
  with check (
    firm_id = public.req_active_firm()
    and (
      public.active_membership_role(firm_id) in ('super_admin', 'partner')
      or (
        public.active_membership_role(firm_id) = 'manager'
        and manager_membership_id = public.active_membership_id(firm_id)
      )
    )
  );

-- --- legal_entities (RLS-ENT-01: same scoping as clients) -------------------
-- Manager portfolio = entities of designated-manager clients. The
-- subquery runs under the caller's OWN clients RLS — no definer needed.
create policy legal_entities_select_scoped on public.legal_entities
  for select to authenticated
  using (
    firm_id = public.req_active_firm()
    and (
      public.active_membership_role(firm_id) in ('super_admin', 'partner')
      or (
        public.active_membership_role(firm_id) = 'manager'
        and exists (
          select 1 from public.clients c
          where c.firm_id = legal_entities.firm_id
            and c.id = legal_entities.client_id
            and c.manager_membership_id = public.active_membership_id(legal_entities.firm_id)
        )
      )
    )
  );

create policy legal_entities_insert_manager_plus on public.legal_entities
  for insert to authenticated
  with check (
    firm_id = public.req_active_firm()
    and (
      public.active_membership_role(firm_id) in ('super_admin', 'partner')
      or (
        public.active_membership_role(firm_id) = 'manager'
        and exists (
          select 1 from public.clients c
          where c.firm_id = legal_entities.firm_id
            and c.id = legal_entities.client_id
            and c.manager_membership_id = public.active_membership_id(legal_entities.firm_id)
        )
      )
    )
  );

create policy legal_entities_update_manager_plus on public.legal_entities
  for update to authenticated
  using (
    firm_id = public.req_active_firm()
    and (
      public.active_membership_role(firm_id) in ('super_admin', 'partner')
      or (
        public.active_membership_role(firm_id) = 'manager'
        and exists (
          select 1 from public.clients c
          where c.firm_id = legal_entities.firm_id
            and c.id = legal_entities.client_id
            and c.manager_membership_id = public.active_membership_id(legal_entities.firm_id)
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
          where c.firm_id = legal_entities.firm_id
            and c.id = legal_entities.client_id
            and c.manager_membership_id = public.active_membership_id(legal_entities.firm_id)
        )
      )
    )
  );

-- --- client_relationships (RLS-ENT-01 family) -------------------------------
-- Group edges legitimately span clients (DM-07), but for a MANAGER both
-- endpoint clients must sit inside the portfolio for ANY access: an
-- either-endpoint read would leak the identity/relationship of an
-- out-of-portfolio client (human decision, IMP-020 closure 2026-09-02).
-- super_admin/partner see all active-firm edges.
create policy client_relationships_select_scoped on public.client_relationships
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
          where le.firm_id = client_relationships.firm_id
            and le.id = client_relationships.from_entity_id
            and c.manager_membership_id = public.active_membership_id(client_relationships.firm_id)
        )
        and exists (
          select 1 from public.legal_entities le
          join public.clients c on c.firm_id = le.firm_id and c.id = le.client_id
          where le.firm_id = client_relationships.firm_id
            and le.id = client_relationships.to_entity_id
            and c.manager_membership_id = public.active_membership_id(client_relationships.firm_id)
        )
      )
    )
  );

create policy client_relationships_insert_manager_plus on public.client_relationships
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
          where le.firm_id = client_relationships.firm_id
            and le.id = client_relationships.from_entity_id
            and c.manager_membership_id = public.active_membership_id(client_relationships.firm_id)
        )
        and exists (
          select 1 from public.legal_entities le
          join public.clients c on c.firm_id = le.firm_id and c.id = le.client_id
          where le.firm_id = client_relationships.firm_id
            and le.id = client_relationships.to_entity_id
            and c.manager_membership_id = public.active_membership_id(client_relationships.firm_id)
        )
      )
    )
  );

create policy client_relationships_update_manager_plus on public.client_relationships
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
          where le.firm_id = client_relationships.firm_id
            and le.id = client_relationships.from_entity_id
            and c.manager_membership_id = public.active_membership_id(client_relationships.firm_id)
        )
        and exists (
          select 1 from public.legal_entities le
          join public.clients c on c.firm_id = le.firm_id and c.id = le.client_id
          where le.firm_id = client_relationships.firm_id
            and le.id = client_relationships.to_entity_id
            and c.manager_membership_id = public.active_membership_id(client_relationships.firm_id)
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
          where le.firm_id = client_relationships.firm_id
            and le.id = client_relationships.from_entity_id
            and c.manager_membership_id = public.active_membership_id(client_relationships.firm_id)
        )
        and exists (
          select 1 from public.legal_entities le
          join public.clients c on c.firm_id = le.firm_id and c.id = le.client_id
          where le.firm_id = client_relationships.firm_id
            and le.id = client_relationships.to_entity_id
            and c.manager_membership_id = public.active_membership_id(client_relationships.firm_id)
        )
      )
    )
  );

-- --- registrations (RLS-REG-01: same scoping as clients; writes manager+) ---
create policy registrations_select_scoped on public.registrations
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
          where le.firm_id = registrations.firm_id
            and le.id = registrations.legal_entity_id
            and c.manager_membership_id = public.active_membership_id(registrations.firm_id)
        )
      )
    )
  );

create policy registrations_insert_manager_plus on public.registrations
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
          where le.firm_id = registrations.firm_id
            and le.id = registrations.legal_entity_id
            and c.manager_membership_id = public.active_membership_id(registrations.firm_id)
        )
      )
    )
  );

create policy registrations_update_manager_plus on public.registrations
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
          where le.firm_id = registrations.firm_id
            and le.id = registrations.legal_entity_id
            and c.manager_membership_id = public.active_membership_id(registrations.firm_id)
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
          where le.firm_id = registrations.firm_id
            and le.id = registrations.legal_entity_id
            and c.manager_membership_id = public.active_membership_id(registrations.firm_id)
        )
      )
    )
  );

-- --- contacts (RLS-CON-01: same scoping; client-context read needs the
-- deferred portal mapping, SCH-31) -------------------------------------------
create policy contacts_select_scoped on public.contacts
  for select to authenticated
  using (
    firm_id = public.req_active_firm()
    and (
      public.active_membership_role(firm_id) in ('super_admin', 'partner')
      or (
        public.active_membership_role(firm_id) = 'manager'
        and exists (
          select 1 from public.clients c
          where c.firm_id = contacts.firm_id
            and c.id = contacts.client_id
            and c.manager_membership_id = public.active_membership_id(contacts.firm_id)
        )
      )
    )
  );

create policy contacts_insert_manager_plus on public.contacts
  for insert to authenticated
  with check (
    firm_id = public.req_active_firm()
    and (
      public.active_membership_role(firm_id) in ('super_admin', 'partner')
      or (
        public.active_membership_role(firm_id) = 'manager'
        and exists (
          select 1 from public.clients c
          where c.firm_id = contacts.firm_id
            and c.id = contacts.client_id
            and c.manager_membership_id = public.active_membership_id(contacts.firm_id)
        )
      )
    )
  );

create policy contacts_update_manager_plus on public.contacts
  for update to authenticated
  using (
    firm_id = public.req_active_firm()
    and (
      public.active_membership_role(firm_id) in ('super_admin', 'partner')
      or (
        public.active_membership_role(firm_id) = 'manager'
        and exists (
          select 1 from public.clients c
          where c.firm_id = contacts.firm_id
            and c.id = contacts.client_id
            and c.manager_membership_id = public.active_membership_id(contacts.firm_id)
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
          where c.firm_id = contacts.firm_id
            and c.id = contacts.client_id
            and c.manager_membership_id = public.active_membership_id(contacts.firm_id)
        )
      )
    )
  );

-- ---------------------------------------------------------------------------
-- Grants (least privilege at BOTH layers — IMP-012 pattern).
-- SELECT for the read policies above; column-pinned INSERT/UPDATE so
-- identity columns (id, firm_id, client_id, type/value on registrations)
-- are never mutable. No DELETE for anyone (lifecycle statuses only).
-- ---------------------------------------------------------------------------
grant select on public.clients to authenticated;
grant insert (firm_id, name, industry, risk_rating, owner_partner_membership_id, manager_membership_id, status, tags) on public.clients to authenticated;
grant update (name, industry, risk_rating, owner_partner_membership_id, manager_membership_id, status, tags) on public.clients to authenticated;

grant select on public.legal_entities to authenticated;
grant insert (firm_id, client_id, entity_type, legal_name, incorporation_date, registered_address, status) on public.legal_entities to authenticated;
-- entity_type excluded: immutable after creation (DM-05); client_id/firm_id
-- excluded: parentage never changes.
grant update (legal_name, incorporation_date, registered_address, status) on public.legal_entities to authenticated;

grant select on public.client_relationships to authenticated;
grant insert (firm_id, from_entity_id, to_entity_id, relation_type, effective_from, effective_to, status) on public.client_relationships to authenticated;
grant update (relation_type, effective_from, effective_to, status) on public.client_relationships to authenticated;

grant select on public.registrations to authenticated;
grant insert (firm_id, legal_entity_id, type, value, state, meta, valid_from, valid_to, status) on public.registrations to authenticated;
-- type/value excluded: they ARE the identifier (unique key); correction is
-- a lifecycle transition (surrender) + a new registration row, not a silent
-- edit of a statutory identifier (HIGH audit sensitivity, SCH-07).
grant update (state, meta, valid_from, valid_to, status) on public.registrations to authenticated;

grant select on public.contacts to authenticated;
grant insert (firm_id, client_id, legal_entity_id, name, role_title, email, phone, is_primary, status) on public.contacts to authenticated;
grant update (legal_entity_id, name, role_title, email, phone, is_primary, status) on public.contacts to authenticated;

-- ---------------------------------------------------------------------------
-- Notes for reviewers
-- ---------------------------------------------------------------------------
-- * Senior/article_executive see NOTHING here in R0: RLS-STF-04 scopes them
--   to assigned work, which requires tasks/compliance_instances (IMP-030/040
--   families). Those packages extend these policies; TEST-RLS-MAT-01
--   senior/article boundary cases for the client hierarchy land there.
-- * Billing table access is denied entirely; RLS-CLI-01's identity-only
--   projection is the reviewed list_client_identities() definer function.
-- * The x-active-firm selector is untrusted context everywhere: without a
--   live ACTIVE membership of the required role it selects nothing
--   (RLS-CTX-02), and membership changes take effect on the next
--   authorization check with the same JWT (DEC-J).
-- * Audit failure semantics are inherited from IMP-013: audit_write
--   failure aborts the business mutation in the same transaction.
