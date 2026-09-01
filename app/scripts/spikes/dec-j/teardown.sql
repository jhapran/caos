-- IMP-004 / DEC-J SPIKE — teardown. Removes EVERY spike object.
-- After this runs, public R0 application table count must be 0 and the
-- IMP-003 harness Auth users must remain untouched (spike rows in
-- auth.users are never created; memberships reference harness users only
-- via ON DELETE CASCADE from the spike tables, which are dropped here).

begin;

drop policy if exists decj_a_select on public.decj_resources_a;
drop policy if exists decj_a_insert on public.decj_resources_a;
drop policy if exists decj_a_update on public.decj_resources_a;
drop policy if exists decj_a_delete on public.decj_resources_a;
drop policy if exists decj_b_select on public.decj_resources_b;
drop policy if exists decj_b_insert on public.decj_resources_b;
drop policy if exists decj_b_update on public.decj_resources_b;
drop policy if exists decj_b_delete on public.decj_resources_b;
drop policy if exists decj_c_select on public.decj_resources_c;
drop policy if exists decj_c_insert on public.decj_resources_c;
drop policy if exists decj_c_update on public.decj_resources_c;
drop policy if exists decj_c_delete on public.decj_resources_c;
drop policy if exists decj_firms_read on public.decj_firms;
drop policy if exists decj_memberships_read_own on public.decj_memberships;
drop policy if exists decj_client_access_read_own on public.decj_client_access;

drop function if exists public.decj_access_token_hook(jsonb);
drop function if exists public.decj_req_firm();
drop function if exists public.decj_req_context();
drop function if exists public.decj_a_active_firm();
drop function if exists public.decj_a_context();
drop function if exists public.decj_a_role();
drop function if exists public.decj_a_client_ok(uuid, text);
drop function if exists public.decj_c_verified_role();
drop function if exists public.decj_c_client_ok(uuid, text);

drop table if exists public.decj_resources_a;
drop table if exists public.decj_resources_b;
drop table if exists public.decj_resources_c;
drop table if exists public.decj_client_access;
drop table if exists public.decj_memberships;
drop table if exists public.decj_firms;

commit;
