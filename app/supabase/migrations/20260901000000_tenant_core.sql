-- IMP-010 — Tenant core production schema (SCH-01…03)
--
-- Implements exactly: firms (SCH-01), profiles (SCH-02), firm_memberships
-- (SCH-03), per docs/spec/06-database-schema.md, with the SCH-FK-01…04
-- composite-FK groundwork and SCH-RESP-01…03 responsibility-reference
-- vocabulary. No other tables. No RLS policies (IMP-012 owns foundational
-- RLS); no audit triggers (IMP-013 owns audit).
--
-- Security posture until IMP-012: table privileges are revoked from
-- anon/authenticated so the tables are NOT reachable via PostgREST while
-- they carry no RLS policies (default Supabase privileges would otherwise
-- expose them). IMP-012 must re-grant as specified by 05 alongside the
-- policy set.
--
-- Conventions (spec 06): text + CHECK instead of DB enums; id uuid PK
-- default gen_random_uuid(); created_at NOT NULL DEFAULT now();
-- updated_at trigger-maintained (schema convention, not audit).

-- ---------------------------------------------------------------------------
-- SCH-01 — firms (tenant root; not tenant-owned)
-- ---------------------------------------------------------------------------
create table public.firms (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  frn text,
  city text,
  plan text not null default 'trial',
  settings jsonb not null default '{}'::jsonb,
  status text not null default 'onboarding',
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  constraint firms_status_check
    check (status in ('onboarding', 'active', 'suspended', 'deactivated'))
);

comment on table public.firms is 'SCH-01: tenant root (DM-01). Lifecycle via status; never hard-deleted.';

-- ---------------------------------------------------------------------------
-- SCH-02 — profiles (application mirror of auth.users; global, TEN-04)
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key,
  full_name text not null,
  avatar_url text,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  constraint profiles_user_fkey
    foreign key (id) references auth.users (id) on delete cascade
);

comment on table public.profiles is 'SCH-02: 1:1 mirror of auth.users (DM-02). No tenant data, no role columns (TEN-05).';

-- ---------------------------------------------------------------------------
-- SCH-03 — firm_memberships (staff tenancy edge with role; global edge)
-- ---------------------------------------------------------------------------
create table public.firm_memberships (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null,
  user_id uuid not null,
  role text not null,
  status text not null default 'invited',
  invited_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  constraint firm_memberships_role_check
    check (role in ('super_admin', 'partner', 'manager', 'senior',
                    'article_executive', 'billing', 'external_consultant')),
  constraint firm_memberships_status_check
    check (status in ('invited', 'active', 'suspended', 'removed')),
  constraint firm_memberships_firm_fkey
    foreign key (firm_id) references public.firms (id) on delete restrict,
  constraint firm_memberships_user_fkey
    foreign key (user_id) references auth.users (id) on delete restrict,
  constraint firm_memberships_invited_by_fkey
    foreign key (invited_by) references auth.users (id) on delete restrict,
  -- DM-03: one role per user per firm. Also serves the DEC-J live-lookup
  -- authorization path (equality on firm_id + user_id, checking
  -- status/role — RLS-MECH-01; index shape verified at 100k-row scale by
  -- the IMP-004 spike).
  constraint firm_memberships_firm_user_unique unique (firm_id, user_id),
  -- SCH-RESP-03: composite-FK target for tenant-responsibility references
  -- from child tables (land with later packages).
  constraint firm_memberships_firm_id_unique unique (firm_id, id)
);

comment on table public.firm_memberships is 'SCH-03: staff tenancy edge with role (DM-03). Target of all tenant-responsibility references (SCH-RESP-01). Never hard-deleted.';

-- Hot RLS/lookup paths (SCH-03 Indexes; distinct from the unique
-- constraints above, which also index (firm_id, user_id) and (firm_id, id)).
create index firm_memberships_user_idx
  on public.firm_memberships (user_id);
create index firm_memberships_firm_status_idx
  on public.firm_memberships (firm_id, status);

-- ---------------------------------------------------------------------------
-- updated_at maintenance (schema convention for all non-audit tables;
-- NOT an audit mechanism — audit lands in IMP-013 per AUD-CTX-01)
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger firms_set_updated_at
  before update on public.firms
  for each row execute function public.set_updated_at();

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

create trigger firm_memberships_set_updated_at
  before update on public.firm_memberships
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Fail-closed until IMP-012: no PostgREST access while RLS is undefined.
-- Default Supabase privileges grant public-schema tables to anon and
-- authenticated; revoke them here. IMP-012 re-grants per 05 together with
-- the foundational RLS policy set.
-- ---------------------------------------------------------------------------
revoke all on public.firms from anon, authenticated;
revoke all on public.profiles from anon, authenticated;
revoke all on public.firm_memberships from anon, authenticated;
