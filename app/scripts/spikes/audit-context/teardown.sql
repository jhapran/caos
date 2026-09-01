-- IMP-005 / AUDIT-CONTEXT SPIKE — teardown. Removes EVERY spike object.
-- After this runs, public R0 application table count must be 0 and the
-- IMP-003 harness Auth users must remain untouched.

begin;

drop trigger if exists audctx_resources_audit on public.audctx_resources;

drop policy if exists audctx_res_select on public.audctx_resources;
drop policy if exists audctx_res_insert on public.audctx_resources;
drop policy if exists audctx_res_update on public.audctx_resources;
drop policy if exists audctx_res_delete on public.audctx_resources;
drop policy if exists audctx_firms_read on public.audctx_firms;
drop policy if exists audctx_memberships_read_own on public.audctx_memberships;
drop policy if exists audctx_client_access_read_own on public.audctx_client_access;
drop policy if exists audctx_support_sessions_read_own on public.audctx_support_sessions;
drop policy if exists audctx_events_insert_self on public.audctx_events;

drop function if exists public.audctx_trg_resources_audit();
drop function if exists public.audctx_probe_context();
drop function if exists public.audctx_probe_set_ctx(text);
drop function if exists public.audctx_probe_get_ctx();
drop function if exists public.audctx_req_firm();
drop function if exists public.audctx_req_context();
drop function if exists public.audctx_assert_access(uuid, text);
drop function if exists public.audctx_b_create_resource(uuid, text, numeric, text, text);
drop function if exists public.audctx_b_create_resource_faulty(uuid, text, numeric);
drop function if exists public.audctx_c_create_resource(uuid, text, numeric, text, text, text, text, text);
drop function if exists public.audctx_service_event(uuid, text, text, text, text, text);
drop function if exists public.audctx_support_event(uuid, text, text, text);

drop table if exists public.audctx_resources;
drop table if exists public.audctx_events;
drop table if exists public.audctx_support_sessions;
drop table if exists public.audctx_client_access;
drop table if exists public.audctx_memberships;
drop table if exists public.audctx_firms;

commit;
