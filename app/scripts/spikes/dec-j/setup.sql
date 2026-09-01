-- IMP-004 / DEC-J SPIKE — TEMPORARY local-only spike schema.
-- NOT Release-0 schema. NOT a migration. Applied/removed by
-- scripts/spikes/dec-j/run.mjs and teardown.mjs.
-- All user UUIDs come from tests/harness/registry.json (IMP-003 harness).
-- Idempotent: safe to re-apply (if-not-exists / on-conflict / drop-if-exists).

-- ---------------------------------------------------------------------------
-- Spike tables
-- ---------------------------------------------------------------------------
create table if not exists public.decj_firms (
  id uuid primary key,
  label text not null
);

create table if not exists public.decj_memberships (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  firm_id uuid not null references public.decj_firms (id) on delete cascade,
  role text not null check (role in ('super_admin','partner','manager','senior','article_executive','billing')),
  status text not null default 'active' check (status in ('active','suspended','removed')),
  authz_version integer not null default 1
);
create unique index if not exists decj_memberships_user_firm on public.decj_memberships (user_id, firm_id);
-- lookup index used by candidates B (live lookup) and C (hybrid verify)
create index if not exists decj_memberships_lookup on public.decj_memberships (user_id, firm_id)
  include (status, role, authz_version);
create unique index if not exists decj_memberships_id_user on public.decj_memberships (id, user_id);

create table if not exists public.decj_client_access (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  firm_id uuid not null references public.decj_firms (id) on delete cascade,
  client_key text not null
);
create index if not exists decj_client_access_lookup on public.decj_client_access (user_id, firm_id) include (client_key);

-- Three identical resource tables, one per candidate, so all candidates are
-- installed simultaneously under fair, identical data/index conditions.
create table if not exists public.decj_resources_a (
  id bigint generated always as identity primary key,
  firm_id uuid not null references public.decj_firms (id),
  name text not null,
  amount numeric not null,
  client_key text
);
create table if not exists public.decj_resources_b (like public.decj_resources_a including all);
create table if not exists public.decj_resources_c (like public.decj_resources_a including all);
create index if not exists decj_resources_a_firm on public.decj_resources_a (firm_id, id);
create index if not exists decj_resources_b_firm on public.decj_resources_b (firm_id, id);
create index if not exists decj_resources_c_firm on public.decj_resources_c (firm_id, id);

-- ---------------------------------------------------------------------------
-- Tenants + memberships (harness users from tests/harness/registry.json)
-- ---------------------------------------------------------------------------
insert into public.decj_firms (id, label) values
  ('10000000-0000-4000-8000-000000000001', 'Spike Firm A'),
  ('10000000-0000-4000-8000-000000000002', 'Spike Firm B')
on conflict do nothing;

-- 18 filler firms used only for JWT-size measurement (no resources).
insert into public.decj_firms (id, label)
select ('10000000-0000-4000-8000-' || lpad(to_hex(61440 + g), 12, '0'))::uuid, 'Spike Filler ' || g
from generate_series(1, 18) g
on conflict do nothing;

insert into public.decj_memberships (id, user_id, firm_id, role, status) values
  ('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'super_admin', 'active'),
  ('30000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'partner',     'active'),
  ('30000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', 'manager',     'active'),
  ('30000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000001', 'senior',      'active'),
  ('30000000-0000-4000-8000-000000000005', '20000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000001', 'article_executive', 'active'),
  ('30000000-0000-4000-8000-000000000006', '20000000-0000-4000-8000-000000000006', '10000000-0000-4000-8000-000000000001', 'billing',     'active'),
  ('30000000-0000-4000-8000-000000000007', '20000000-0000-4000-8000-000000000013', '10000000-0000-4000-8000-000000000001', 'manager',     'active'),
  ('30000000-0000-4000-8000-000000000008', '20000000-0000-4000-8000-000000000014', '10000000-0000-4000-8000-000000000001', 'senior',      'suspended'),
  ('30000000-0000-4000-8000-000000000009', '20000000-0000-4000-8000-000000000015', '10000000-0000-4000-8000-000000000001', 'senior',      'removed'),
  ('30000000-0000-4000-8000-000000000010', '20000000-0000-4000-8000-000000000016', '10000000-0000-4000-8000-000000000001', 'senior',      'active'),
  ('30000000-0000-4000-8000-000000000011', '20000000-0000-4000-8000-000000000008', '10000000-0000-4000-8000-000000000002', 'partner',     'active'),
  ('30000000-0000-4000-8000-000000000012', '20000000-0000-4000-8000-000000000010', '10000000-0000-4000-8000-000000000002', 'senior',      'active'),
  ('30000000-0000-4000-8000-000000000013', '20000000-0000-4000-8000-000000000013', '10000000-0000-4000-8000-000000000002', 'senior',      'active')
on conflict do nothing;

-- Staff + client overlap: overlap user can see client_key 'CL-100' rows in firm A.
insert into public.decj_client_access (id, user_id, firm_id, client_key) values
  ('40000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000016', '10000000-0000-4000-8000-000000000001', 'CL-100')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Representative dataset: 100,000 synthetic rows per candidate table
-- (Firm A 60,000 / Firm B 40,000; 5% client_key CL-100, 5% CL-999).
-- Truncated first so re-runs are idempotent AND identity ids stay stable
-- (the known-foreign-id attack relies on firm-B rows at ids 60001..100000).
-- ---------------------------------------------------------------------------
truncate public.decj_resources_a, public.decj_resources_b, public.decj_resources_c restart identity;

insert into public.decj_resources_a (firm_id, name, amount, client_key)
select case when g <= 60000 then '10000000-0000-4000-8000-000000000001'::uuid
            else '10000000-0000-4000-8000-000000000002'::uuid end,
       'res-' || g, (g % 1000)::numeric,
       case when g % 20 = 0 then 'CL-100' when g % 20 = 1 then 'CL-999' end
from generate_series(1, 100000) g
on conflict do nothing;
insert into public.decj_resources_b (firm_id, name, amount, client_key)
select firm_id, name, amount, client_key from public.decj_resources_a;
insert into public.decj_resources_c (firm_id, name, amount, client_key)
select firm_id, name, amount, client_key from public.decj_resources_a;

-- ---------------------------------------------------------------------------
-- RLS on supporting tables: users may read ONLY their own relationships.
-- (Writes are service-role/admin only in this spike.)
-- ---------------------------------------------------------------------------
alter table public.decj_firms enable row level security;
alter table public.decj_memberships enable row level security;
alter table public.decj_client_access enable row level security;

drop policy if exists decj_firms_read on public.decj_firms;
create policy decj_firms_read on public.decj_firms for select to authenticated
  using (exists (select 1 from public.decj_memberships m
                  where m.user_id = auth.uid() and m.firm_id = id and m.status = 'active')
         or exists (select 1 from public.decj_client_access ca
                     where ca.user_id = auth.uid() and ca.firm_id = id));
drop policy if exists decj_memberships_read_own on public.decj_memberships;
create policy decj_memberships_read_own on public.decj_memberships for select to authenticated
  using (user_id = auth.uid());
drop policy if exists decj_client_access_read_own on public.decj_client_access;
create policy decj_client_access_read_own on public.decj_client_access for select to authenticated
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Custom access-token hook (candidates A and C claim issuance).
-- SECURITY DEFINER is REQUIRED: the hook runs as supabase_auth_admin, which
-- must not hold broad table grants; the function owner (postgres) reads the
-- spike tables. search_path is pinned empty; all references qualified.
-- Defensive: passes the event through untouched when spike tables are absent.
-- Trusted context inputs (decj_active_firm / decj_context) live in
-- raw_app_meta_data, which client code cannot self-modify.
-- ---------------------------------------------------------------------------
create or replace function public.decj_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  claims jsonb := event -> 'claims';
  uid uuid := (event ->> 'user_id')::uuid;
  memberships jsonb;
  grants jsonb;
  active_firm text;
  context text;
begin
  if to_regclass('public.decj_memberships') is null then
    return event; -- spike not installed: pass through unchanged
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'membership_id', m.id, 'firm_id', m.firm_id,
           'role', m.role, 'authz_version', m.authz_version)), '[]'::jsonb)
    into memberships
    from public.decj_memberships m
   where m.user_id = uid and m.status = 'active';

  select coalesce(jsonb_agg(jsonb_build_object(
           'firm_id', ca.firm_id, 'client_key', ca.client_key)), '[]'::jsonb)
    into grants
    from public.decj_client_access ca
   where ca.user_id = uid;

  select coalesce(u.raw_app_meta_data ->> 'decj_active_firm', ''),
         coalesce(nullif(u.raw_app_meta_data ->> 'decj_context', ''), 'staff')
    into active_firm, context
    from auth.users u
   where u.id = uid;

  -- A requested active firm is honoured only if a live relationship exists
  -- at issue time; otherwise fall back to the first available relationship.
  if not exists (select 1 from pg_catalog.jsonb_array_elements(memberships) e
                  where e ->> 'firm_id' = active_firm)
     and not exists (select 1 from pg_catalog.jsonb_array_elements(grants) e
                      where e ->> 'firm_id' = active_firm) then
    active_firm := coalesce(
      (select e ->> 'firm_id' from pg_catalog.jsonb_array_elements(memberships) e limit 1),
      (select e ->> 'firm_id' from pg_catalog.jsonb_array_elements(grants) e limit 1), '');
  end if;
  if context = 'client' and not exists
     (select 1 from pg_catalog.jsonb_array_elements(grants) e where e ->> 'firm_id' = active_firm) then
    context := 'staff'; -- cannot claim client context without a client grant
  end if;

  claims := pg_catalog.jsonb_set(claims, '{decj}', pg_catalog.jsonb_build_object(
    'active_firm', active_firm,
    'context', context,
    'memberships', memberships,
    'client_grants', grants));
  return pg_catalog.jsonb_set(event, '{claims}', claims);
end;
$$;

grant execute on function public.decj_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.decj_access_token_hook(jsonb) from authenticated, anon, public;

-- ---------------------------------------------------------------------------
-- Shared request helpers (B + C): the active-firm header is UNTRUSTED
-- context only; every policy re-validates it against relationships.
-- ---------------------------------------------------------------------------
create or replace function public.decj_req_firm() returns uuid
language sql stable as $$
  select nullif(current_setting('request.headers', true)::jsonb ->> 'x-active-firm', '')::uuid
$$;
create or replace function public.decj_req_context() returns text
language sql stable as $$
  select coalesce(nullif(current_setting('request.headers', true)::jsonb ->> 'x-decj-context', ''), 'staff')
$$;

-- ---------------------------------------------------------------------------
-- Candidate A helpers: JWT CLAIMS ONLY. No live membership lookup anywhere
-- in these policies.
-- ---------------------------------------------------------------------------
create or replace function public.decj_a_active_firm() returns uuid
language sql stable as $$
  select nullif(auth.jwt() -> 'decj' ->> 'active_firm', '')::uuid
$$;
create or replace function public.decj_a_context() returns text
language sql stable as $$
  select coalesce(nullif(auth.jwt() -> 'decj' ->> 'context', ''), 'staff')
$$;
create or replace function public.decj_a_role() returns text
language sql stable as $$
  select e ->> 'role'
    from jsonb_array_elements(auth.jwt() -> 'decj' -> 'memberships') e
   where e ->> 'firm_id' = auth.jwt() -> 'decj' ->> 'active_firm'
   limit 1
$$;
create or replace function public.decj_a_client_ok(firm uuid, ck text) returns boolean
language sql stable as $$
  select exists (
    select 1 from jsonb_array_elements(auth.jwt() -> 'decj' -> 'client_grants') e
    where e ->> 'firm_id' = firm::text and e ->> 'client_key' = ck)
$$;

-- ---------------------------------------------------------------------------
-- Candidate C helpers: HYBRID — trusted claim snapshot + live indexed
-- verification (membership exists, owned, firm matches, active, version
-- matches). Role is read from the claim ONLY after live verification.
-- ---------------------------------------------------------------------------
create or replace function public.decj_c_verified_role() returns text
language sql stable as $$
  select e ->> 'role'
    from jsonb_array_elements(auth.jwt() -> 'decj' -> 'memberships') e
    join public.decj_memberships lm
      on lm.id = (e ->> 'membership_id')::uuid
     and lm.user_id = auth.uid()
     and lm.status = 'active'
     and lm.authz_version = (e ->> 'authz_version')::int
   where e ->> 'firm_id' = public.decj_req_firm()::text
     and lm.firm_id = public.decj_req_firm()
   limit 1
$$;
create or replace function public.decj_c_client_ok(firm uuid, ck text) returns boolean
language sql stable as $$
  select exists (
    select 1 from public.decj_client_access ca
    where ca.user_id = auth.uid() and ca.firm_id = firm and ca.client_key = ck)
$$;

-- ---------------------------------------------------------------------------
-- RLS policies — identical permission model for all candidates:
--   select: any active member (staff ctx) or matching client grant (client ctx)
--   insert: super_admin/partner/manager/senior/article_executive
--   update: super_admin/partner/manager/senior
--   delete: super_admin/partner
-- ---------------------------------------------------------------------------

-- Candidate A (claims only)
alter table public.decj_resources_a enable row level security;
drop policy if exists decj_a_select on public.decj_resources_a;
create policy decj_a_select on public.decj_resources_a for select to authenticated using (
  firm_id = public.decj_a_active_firm() and (
    (public.decj_a_context() = 'staff' and public.decj_a_role() is not null)
    or (public.decj_a_context() = 'client' and public.decj_a_client_ok(firm_id, client_key))));
drop policy if exists decj_a_insert on public.decj_resources_a;
create policy decj_a_insert on public.decj_resources_a for insert to authenticated with check (
  public.decj_a_context() = 'staff' and firm_id = public.decj_a_active_firm()
  and public.decj_a_role() in ('super_admin','partner','manager','senior','article_executive'));
drop policy if exists decj_a_update on public.decj_resources_a;
create policy decj_a_update on public.decj_resources_a for update to authenticated
  using (public.decj_a_context() = 'staff' and firm_id = public.decj_a_active_firm()
         and public.decj_a_role() in ('super_admin','partner','manager','senior'))
  with check (public.decj_a_context() = 'staff' and firm_id = public.decj_a_active_firm()
         and public.decj_a_role() in ('super_admin','partner','manager','senior'));
drop policy if exists decj_a_delete on public.decj_resources_a;
create policy decj_a_delete on public.decj_resources_a for delete to authenticated using (
  public.decj_a_context() = 'staff' and firm_id = public.decj_a_active_firm()
  and public.decj_a_role() in ('super_admin','partner'));

-- Candidate B (live lookup; header is untrusted context re-validated per row)
alter table public.decj_resources_b enable row level security;
drop policy if exists decj_b_select on public.decj_resources_b;
create policy decj_b_select on public.decj_resources_b for select to authenticated using (
  firm_id = public.decj_req_firm() and (
    (public.decj_req_context() = 'staff' and exists (
      select 1 from public.decj_memberships m
      where m.user_id = auth.uid() and m.firm_id = decj_resources_b.firm_id and m.status = 'active'))
    or (public.decj_req_context() = 'client' and exists (
      select 1 from public.decj_client_access ca
      where ca.user_id = auth.uid() and ca.firm_id = decj_resources_b.firm_id
        and ca.client_key = decj_resources_b.client_key))));
drop policy if exists decj_b_insert on public.decj_resources_b;
create policy decj_b_insert on public.decj_resources_b for insert to authenticated with check (
  public.decj_req_context() = 'staff' and firm_id = public.decj_req_firm() and exists (
    select 1 from public.decj_memberships m
    where m.user_id = auth.uid() and m.firm_id = decj_resources_b.firm_id and m.status = 'active'
      and m.role in ('super_admin','partner','manager','senior','article_executive')));
drop policy if exists decj_b_update on public.decj_resources_b;
create policy decj_b_update on public.decj_resources_b for update to authenticated
  using (public.decj_req_context() = 'staff' and firm_id = public.decj_req_firm() and exists (
    select 1 from public.decj_memberships m
    where m.user_id = auth.uid() and m.firm_id = decj_resources_b.firm_id and m.status = 'active'
      and m.role in ('super_admin','partner','manager','senior')))
  with check (public.decj_req_context() = 'staff' and firm_id = public.decj_req_firm() and exists (
    select 1 from public.decj_memberships m
    where m.user_id = auth.uid() and m.firm_id = decj_resources_b.firm_id and m.status = 'active'
      and m.role in ('super_admin','partner','manager','senior')));
drop policy if exists decj_b_delete on public.decj_resources_b;
create policy decj_b_delete on public.decj_resources_b for delete to authenticated using (
  public.decj_req_context() = 'staff' and firm_id = public.decj_req_firm() and exists (
    select 1 from public.decj_memberships m
    where m.user_id = auth.uid() and m.firm_id = decj_resources_b.firm_id and m.status = 'active'
      and m.role in ('super_admin','partner')));

-- Candidate C (hybrid: claim snapshot + live verification)
alter table public.decj_resources_c enable row level security;
drop policy if exists decj_c_select on public.decj_resources_c;
create policy decj_c_select on public.decj_resources_c for select to authenticated using (
  firm_id = public.decj_req_firm() and (
    (public.decj_req_context() = 'staff' and public.decj_c_verified_role() is not null)
    or (public.decj_req_context() = 'client' and public.decj_c_client_ok(firm_id, client_key))));
drop policy if exists decj_c_insert on public.decj_resources_c;
create policy decj_c_insert on public.decj_resources_c for insert to authenticated with check (
  public.decj_req_context() = 'staff' and firm_id = public.decj_req_firm()
  and public.decj_c_verified_role() in ('super_admin','partner','manager','senior','article_executive'));
drop policy if exists decj_c_update on public.decj_resources_c;
create policy decj_c_update on public.decj_resources_c for update to authenticated
  using (public.decj_req_context() = 'staff' and firm_id = public.decj_req_firm()
         and public.decj_c_verified_role() in ('super_admin','partner','manager','senior'))
  with check (public.decj_req_context() = 'staff' and firm_id = public.decj_req_firm()
         and public.decj_c_verified_role() in ('super_admin','partner','manager','senior'));
drop policy if exists decj_c_delete on public.decj_resources_c;
create policy decj_c_delete on public.decj_resources_c for delete to authenticated using (
  public.decj_req_context() = 'staff' and firm_id = public.decj_req_firm()
  and public.decj_c_verified_role() in ('super_admin','partner'));

-- API exposure grants (RLS still enforces).
grant select, insert, update, delete on public.decj_resources_a to authenticated;
grant select, insert, update, delete on public.decj_resources_b to authenticated;
grant select, insert, update, delete on public.decj_resources_c to authenticated;
grant select on public.decj_firms to authenticated;
grant select on public.decj_memberships to authenticated;
grant select on public.decj_client_access to authenticated;
grant usage on sequence public.decj_resources_a_id_seq to authenticated;
grant usage on sequence public.decj_resources_b_id_seq to authenticated;
grant usage on sequence public.decj_resources_c_id_seq to authenticated;

vacuum analyze public.decj_resources_a;
vacuum analyze public.decj_resources_b;
vacuum analyze public.decj_resources_c;
vacuum analyze public.decj_memberships;
