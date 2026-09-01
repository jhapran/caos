-- HARNESS GATE — RLS integration harness. TEST INFRASTRUCTURE ONLY.
-- NOT Release-0 schema. NOT a migration. Applied/dropped by
-- tests/integration/rls/rls.test.ts (beforeAll/afterAll) via psql.
-- All user UUIDs come from tests/harness/registry.json (IMP-003 harness).
--
-- Implements the RESOLVED DEC-J mechanism (05 RLS-MECH-01):
--   auth.uid() (JWT) establishes identity; authorization is a LIVE lookup
--   against hgate_memberships / hgate_client_access; the x-active-firm
--   header is UNTRUSTED context and never grants access by itself.
-- Re-appliable: base membership state is force-reset on every apply so a
-- previous test run's mutations cannot leak into the next.

create table if not exists public.hgate_firms (
  id uuid primary key,
  label text not null
);

create table if not exists public.hgate_memberships (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  firm_id uuid not null references public.hgate_firms (id) on delete cascade,
  role text not null check (role in ('super_admin','partner','manager','senior','article_executive','billing')),
  status text not null default 'active' check (status in ('active','suspended','removed'))
);
create unique index if not exists hgate_memberships_user_firm on public.hgate_memberships (user_id, firm_id);
create index if not exists hgate_memberships_lookup on public.hgate_memberships (user_id, firm_id)
  include (status, role);

create table if not exists public.hgate_client_access (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  firm_id uuid not null references public.hgate_firms (id) on delete cascade,
  client_key text not null
);
create index if not exists hgate_client_access_lookup on public.hgate_client_access (user_id, firm_id) include (client_key);

create table if not exists public.hgate_resources (
  id bigint generated always as identity primary key,
  firm_id uuid not null references public.hgate_firms (id),
  name text not null,
  client_key text
);
create index if not exists hgate_resources_firm on public.hgate_resources (firm_id, id);

-- ---------------------------------------------------------------------------
-- Base fixture state (force-reset every apply)
-- ---------------------------------------------------------------------------
insert into public.hgate_firms (id, label) values
  ('10000000-0000-4000-8000-000000000001', 'HGate Firm A'),
  ('10000000-0000-4000-8000-000000000002', 'HGate Firm B')
on conflict do nothing;

insert into public.hgate_memberships (id, user_id, firm_id, role, status) values
  ('80000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'partner',           'active'),
  ('80000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000001', 'senior',             'active'),
  ('80000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000001', 'article_executive',  'active'),
  ('80000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000006', '10000000-0000-4000-8000-000000000001', 'billing',            'active'),
  ('80000000-0000-4000-8000-000000000005', '20000000-0000-4000-8000-000000000013', '10000000-0000-4000-8000-000000000001', 'manager',            'active'),
  ('80000000-0000-4000-8000-000000000006', '20000000-0000-4000-8000-000000000013', '10000000-0000-4000-8000-000000000002', 'senior',             'active'),
  ('80000000-0000-4000-8000-000000000007', '20000000-0000-4000-8000-000000000014', '10000000-0000-4000-8000-000000000001', 'senior',             'suspended'),
  ('80000000-0000-4000-8000-000000000008', '20000000-0000-4000-8000-000000000015', '10000000-0000-4000-8000-000000000001', 'senior',             'removed'),
  ('80000000-0000-4000-8000-000000000009', '20000000-0000-4000-8000-000000000016', '10000000-0000-4000-8000-000000000001', 'senior',             'active'),
  ('80000000-0000-4000-8000-000000000010', '20000000-0000-4000-8000-000000000008', '10000000-0000-4000-8000-000000000002', 'partner',            'active')
on conflict do nothing;

-- Force-reset mutable state so re-runs are deterministic even if a previous
-- test mutated status/role mid-flight.
update public.hgate_memberships set role = 'partner',          status = 'active'    where id = '80000000-0000-4000-8000-000000000001';
update public.hgate_memberships set role = 'senior',           status = 'active'    where id = '80000000-0000-4000-8000-000000000002';
update public.hgate_memberships set role = 'article_executive',status = 'active'    where id = '80000000-0000-4000-8000-000000000003';
update public.hgate_memberships set role = 'billing',          status = 'active'    where id = '80000000-0000-4000-8000-000000000004';
update public.hgate_memberships set role = 'manager',          status = 'active'    where id = '80000000-0000-4000-8000-000000000005';
update public.hgate_memberships set role = 'senior',           status = 'active'    where id = '80000000-0000-4000-8000-000000000006';
update public.hgate_memberships set role = 'senior',           status = 'suspended' where id = '80000000-0000-4000-8000-000000000007';
update public.hgate_memberships set role = 'senior',           status = 'removed'   where id = '80000000-0000-4000-8000-000000000008';
update public.hgate_memberships set role = 'senior',           status = 'active'    where id = '80000000-0000-4000-8000-000000000009';
update public.hgate_memberships set role = 'partner',          status = 'active'    where id = '80000000-0000-4000-8000-000000000010';

insert into public.hgate_client_access (id, user_id, firm_id, client_key) values
  ('81000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000016', '10000000-0000-4000-8000-000000000001', 'CL-100')
on conflict do nothing;

-- Known record IDs: firm A rows 1..200 (every 20th is client CL-100),
-- firm B rows 201..300 (id 201 is the known foreign attack target).
truncate public.hgate_resources restart identity;
insert into public.hgate_resources (firm_id, name, client_key)
select case when g <= 200 then '10000000-0000-4000-8000-000000000001'::uuid
            else '10000000-0000-4000-8000-000000000002'::uuid end,
       'res-' || g,
       case when g <= 200 and g % 20 = 0 then 'CL-100' end
from generate_series(1, 300) g;

-- ---------------------------------------------------------------------------
-- Request context helpers (UNTRUSTED header context — never grants access)
-- ---------------------------------------------------------------------------
create or replace function public.hgate_req_firm() returns uuid
language sql stable as $$
  select nullif(current_setting('request.headers', true)::jsonb ->> 'x-active-firm', '')::uuid
$$;
create or replace function public.hgate_req_context() returns text
language sql stable as $$
  select coalesce(nullif(current_setting('request.headers', true)::jsonb ->> 'x-hgate-context', ''), 'staff')
$$;

-- ---------------------------------------------------------------------------
-- RLS — resolved DEC-J live-lookup mechanism
--   select: active member (staff ctx) or matching client grant (client ctx),
--           scoped to the selected (untrusted) active firm
--   insert: super_admin/partner/manager/senior/article_executive (staff ctx)
--   update: super_admin/partner/manager/senior
--   delete: super_admin/partner
-- ---------------------------------------------------------------------------
alter table public.hgate_firms enable row level security;
alter table public.hgate_memberships enable row level security;
alter table public.hgate_client_access enable row level security;
alter table public.hgate_resources enable row level security;

drop policy if exists hgate_firms_read on public.hgate_firms;
create policy hgate_firms_read on public.hgate_firms for select to authenticated
  using (exists (select 1 from public.hgate_memberships m
                  where m.user_id = auth.uid() and m.firm_id = id and m.status = 'active')
         or exists (select 1 from public.hgate_client_access ca
                     where ca.user_id = auth.uid() and ca.firm_id = id));
drop policy if exists hgate_memberships_read_own on public.hgate_memberships;
create policy hgate_memberships_read_own on public.hgate_memberships for select to authenticated
  using (user_id = auth.uid());
drop policy if exists hgate_client_access_read_own on public.hgate_client_access;
create policy hgate_client_access_read_own on public.hgate_client_access for select to authenticated
  using (user_id = auth.uid());

drop policy if exists hgate_res_select on public.hgate_resources;
create policy hgate_res_select on public.hgate_resources for select to authenticated using (
  firm_id = public.hgate_req_firm() and (
    (public.hgate_req_context() = 'staff' and exists (
      select 1 from public.hgate_memberships m
      where m.user_id = auth.uid() and m.firm_id = hgate_resources.firm_id and m.status = 'active'))
    or (public.hgate_req_context() = 'client' and exists (
      select 1 from public.hgate_client_access ca
      where ca.user_id = auth.uid() and ca.firm_id = hgate_resources.firm_id
        and ca.client_key = hgate_resources.client_key))));
drop policy if exists hgate_res_insert on public.hgate_resources;
create policy hgate_res_insert on public.hgate_resources for insert to authenticated with check (
  public.hgate_req_context() = 'staff' and firm_id = public.hgate_req_firm() and exists (
    select 1 from public.hgate_memberships m
    where m.user_id = auth.uid() and m.firm_id = hgate_resources.firm_id and m.status = 'active'
      and m.role in ('super_admin','partner','manager','senior','article_executive')));
drop policy if exists hgate_res_update on public.hgate_resources;
create policy hgate_res_update on public.hgate_resources for update to authenticated
  using (public.hgate_req_context() = 'staff' and firm_id = public.hgate_req_firm() and exists (
    select 1 from public.hgate_memberships m
    where m.user_id = auth.uid() and m.firm_id = hgate_resources.firm_id and m.status = 'active'
      and m.role in ('super_admin','partner','manager','senior')))
  with check (public.hgate_req_context() = 'staff' and firm_id = public.hgate_req_firm() and exists (
    select 1 from public.hgate_memberships m
    where m.user_id = auth.uid() and m.firm_id = hgate_resources.firm_id and m.status = 'active'
      and m.role in ('super_admin','partner','manager','senior')));
drop policy if exists hgate_res_delete on public.hgate_resources;
create policy hgate_res_delete on public.hgate_resources for delete to authenticated using (
  public.hgate_req_context() = 'staff' and firm_id = public.hgate_req_firm() and exists (
    select 1 from public.hgate_memberships m
    where m.user_id = auth.uid() and m.firm_id = hgate_resources.firm_id and m.status = 'active'
      and m.role in ('super_admin','partner')));

grant select, insert, update, delete on public.hgate_resources to authenticated;
grant select on public.hgate_firms to authenticated;
grant select on public.hgate_memberships to authenticated;
grant select on public.hgate_client_access to authenticated;
grant usage on sequence public.hgate_resources_id_seq to authenticated;

vacuum analyze public.hgate_resources;
vacuum analyze public.hgate_memberships;
