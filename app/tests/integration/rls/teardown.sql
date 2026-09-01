-- HARNESS GATE — RLS integration harness teardown. Drops every hgate_* object.
begin;

drop policy if exists hgate_res_select on public.hgate_resources;
drop policy if exists hgate_res_insert on public.hgate_resources;
drop policy if exists hgate_res_update on public.hgate_resources;
drop policy if exists hgate_res_delete on public.hgate_resources;
drop policy if exists hgate_firms_read on public.hgate_firms;
drop policy if exists hgate_memberships_read_own on public.hgate_memberships;
drop policy if exists hgate_client_access_read_own on public.hgate_client_access;

drop function if exists public.hgate_req_firm();
drop function if exists public.hgate_req_context();

drop table if exists public.hgate_resources;
drop table if exists public.hgate_client_access;
drop table if exists public.hgate_memberships;
drop table if exists public.hgate_firms;

commit;
