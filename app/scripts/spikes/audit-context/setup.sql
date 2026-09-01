-- IMP-005 / AUDIT-CONTEXT SPIKE — TEMPORARY local-only spike schema.
-- NOT Release-0 schema. NOT a migration. NOT production audit_log.
-- Applied/removed by scripts/spikes/audit-context/run.mjs and teardown.mjs.
-- All user UUIDs come from tests/harness/registry.json (IMP-003 harness).
-- Idempotent: safe to re-apply (if-not-exists / on-conflict / drop-if-exists).
--
-- Candidate lettering follows the IMP-005 task order:
--   A = request-scoped DB context / header GUC read in triggers
--   B = explicit RPC context (actor derived from auth.uid(), firm validated live)
--   C = controlled server wrapper (local Node boundary -> RPC)
-- (spec 11 §TEST-SPIKE-CTX-01 letters these A=RPC, B=header-GUC, C=wrapper;
--  the report carries the mapping.)
--
-- DEC-J is RESOLVED (live membership lookup): every firm authorization below
-- validates auth.uid() against the LIVE audctx_memberships / audctx_client_access
-- relationship. The x-active-firm header is UNTRUSTED context only.

-- ---------------------------------------------------------------------------
-- Spike tables
-- ---------------------------------------------------------------------------
create table if not exists public.audctx_firms (
  id uuid primary key,
  label text not null
);

create table if not exists public.audctx_memberships (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  firm_id uuid not null references public.audctx_firms (id) on delete cascade,
  role text not null check (role in ('super_admin','partner','manager','senior','article_executive','billing')),
  status text not null default 'active' check (status in ('active','suspended','removed'))
);
create unique index if not exists audctx_memberships_user_firm on public.audctx_memberships (user_id, firm_id);
create index if not exists audctx_memberships_lookup on public.audctx_memberships (user_id, firm_id)
  include (status, role);

create table if not exists public.audctx_client_access (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  firm_id uuid not null references public.audctx_firms (id) on delete cascade,
  client_key text not null
);
create index if not exists audctx_client_access_lookup on public.audctx_client_access (user_id, firm_id) include (client_key);

-- Mutation target. RLS enforces the resolved DEC-J mechanism on every path.
create table if not exists public.audctx_resources (
  id bigint generated always as identity primary key,
  firm_id uuid not null references public.audctx_firms (id),
  name text not null,
  amount numeric not null,
  client_key text
);
create index if not exists audctx_resources_firm on public.audctx_resources (firm_id, id);

-- Spike audit capture table. NOT production audit_log.
-- CHECK enforces the AUD-ACT-05 actor-model invariants (spike-level):
--   system/service -> actor_user_id IS NULL (never masquerade as human)
--   support        -> actor_user_id AND support_session_id required
--   human          -> actor_user_id required
create table if not exists public.audctx_events (
  id bigint generated always as identity primary key,
  event_at timestamptz not null default now(),
  actor_type text not null check (actor_type in ('human','system','service','support')),
  actor_user_id uuid,
  firm_id uuid,
  context text,
  object_type text,
  object_id text,
  action text,
  old_value jsonb,
  new_value jsonb,
  correlation_id text,
  request_id text,
  ip text,
  user_agent text,
  service_name text,
  support_session_id uuid,
  ctx_source text not null,
  constraint audctx_events_actor_model check (
    (actor_type in ('system','service') and actor_user_id is null)
    or (actor_type = 'support' and actor_user_id is not null and support_session_id is not null)
    or (actor_type = 'human' and actor_user_id is not null)
  )
);
create index if not exists audctx_events_correlation on public.audctx_events (correlation_id, id);

-- Break-glass representation (spike only — NOT production support feature).
create table if not exists public.audctx_support_sessions (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  firm_id uuid not null references public.audctx_firms (id) on delete cascade,
  reason text not null,
  opened_at timestamptz not null default now(),
  closed_at timestamptz
);

-- ---------------------------------------------------------------------------
-- Tenants + relationships (harness users from tests/harness/registry.json)
-- ---------------------------------------------------------------------------
insert into public.audctx_firms (id, label) values
  ('10000000-0000-4000-8000-000000000001', 'AudCtx Firm A'),
  ('10000000-0000-4000-8000-000000000002', 'AudCtx Firm B')
on conflict do nothing;

insert into public.audctx_memberships (id, user_id, firm_id, role, status) values
  ('50000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'partner', 'active'),
  ('50000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000001', 'senior',  'active'),
  ('50000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000013', '10000000-0000-4000-8000-000000000001', 'manager', 'active'),
  ('50000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000014', '10000000-0000-4000-8000-000000000001', 'senior',  'suspended'),
  ('50000000-0000-4000-8000-000000000005', '20000000-0000-4000-8000-000000000015', '10000000-0000-4000-8000-000000000001', 'senior',  'removed'),
  ('50000000-0000-4000-8000-000000000006', '20000000-0000-4000-8000-000000000016', '10000000-0000-4000-8000-000000000001', 'senior',  'active'),
  ('50000000-0000-4000-8000-000000000007', '20000000-0000-4000-8000-000000000008', '10000000-0000-4000-8000-000000000002', 'partner', 'active'),
  ('50000000-0000-4000-8000-000000000008', '20000000-0000-4000-8000-000000000013', '10000000-0000-4000-8000-000000000002', 'senior',  'active')
on conflict do nothing;

insert into public.audctx_client_access (id, user_id, firm_id, client_key) values
  ('60000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000016', '10000000-0000-4000-8000-000000000001', 'CL-100')
on conflict do nothing;

-- One open break-glass session: USER_B_PARTNER supporting Firm A
-- (support actor needs NO membership in the supported firm).
insert into public.audctx_support_sessions (id, user_id, firm_id, reason) values
  ('70000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000008', '10000000-0000-4000-8000-000000000001', 'spike break-glass session')
on conflict do nothing;

-- Small seed dataset (context-propagation spike, not a scale benchmark).
-- Drop the audit trigger FIRST (it may exist from a prior apply): the admin
-- seed has no JWT claims, and the human-actor invariant must not fire here.
drop trigger if exists audctx_resources_audit on public.audctx_resources;
truncate public.audctx_resources restart identity;
insert into public.audctx_resources (firm_id, name, amount, client_key)
select case when g <= 600 then '10000000-0000-4000-8000-000000000001'::uuid
            else '10000000-0000-4000-8000-000000000002'::uuid end,
       'seed-' || g, (g % 100)::numeric,
       case when g % 20 = 0 then 'CL-100' end
from generate_series(1, 1000) g;

-- One legitimate system-actor row written by an admin/migration-style path
-- (evidence that 'system' representation is possible server-side only).
truncate public.audctx_events restart identity;
insert into public.audctx_events (actor_type, actor_user_id, firm_id, context, object_type, object_id, action, service_name, ctx_source)
values ('system', null, null, 'system', 'audctx_spike', 'setup', 'SEED', 'audctx-setup', 'psql-admin')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- RLS — resolved DEC-J mechanism (live lookup; header is untrusted context)
-- ---------------------------------------------------------------------------
create or replace function public.audctx_req_firm() returns uuid
language sql stable as $$
  select nullif(current_setting('request.headers', true)::jsonb ->> 'x-active-firm', '')::uuid
$$;
create or replace function public.audctx_req_context() returns text
language sql stable as $$
  select coalesce(nullif(current_setting('request.headers', true)::jsonb ->> 'x-audctx-context', ''), 'staff')
$$;

alter table public.audctx_firms enable row level security;
alter table public.audctx_memberships enable row level security;
alter table public.audctx_client_access enable row level security;
alter table public.audctx_support_sessions enable row level security;
alter table public.audctx_events enable row level security;
alter table public.audctx_resources enable row level security;

drop policy if exists audctx_firms_read on public.audctx_firms;
create policy audctx_firms_read on public.audctx_firms for select to authenticated
  using (exists (select 1 from public.audctx_memberships m
                  where m.user_id = auth.uid() and m.firm_id = id and m.status = 'active')
         or exists (select 1 from public.audctx_client_access ca
                     where ca.user_id = auth.uid() and ca.firm_id = id));
drop policy if exists audctx_memberships_read_own on public.audctx_memberships;
create policy audctx_memberships_read_own on public.audctx_memberships for select to authenticated
  using (user_id = auth.uid());
drop policy if exists audctx_client_access_read_own on public.audctx_client_access;
create policy audctx_client_access_read_own on public.audctx_client_access for select to authenticated
  using (user_id = auth.uid());
drop policy if exists audctx_support_sessions_read_own on public.audctx_support_sessions;
create policy audctx_support_sessions_read_own on public.audctx_support_sessions for select to authenticated
  using (user_id = auth.uid());
-- audctx_events: NO select/update/delete for authenticated/anon — audit
-- content is never browser-readable in the spike. INSERT is allowed only for
-- self-bound human/support rows (the B/C RPC paths are SECURITY INVOKER);
-- service/system rows require the service_role-only definer function, and
-- the trigger path runs as the function owner. The actor-model CHECK remains
-- the database backstop even for privileged writers.
drop policy if exists audctx_events_insert_self on public.audctx_events;
create policy audctx_events_insert_self on public.audctx_events for insert to authenticated
  with check (actor_user_id = auth.uid() and actor_type in ('human','support'));

-- resources: identical permission model to the DEC-J spike.
drop policy if exists audctx_res_select on public.audctx_resources;
create policy audctx_res_select on public.audctx_resources for select to authenticated using (
  firm_id = public.audctx_req_firm() and (
    (public.audctx_req_context() = 'staff' and exists (
      select 1 from public.audctx_memberships m
      where m.user_id = auth.uid() and m.firm_id = audctx_resources.firm_id and m.status = 'active'))
    or (public.audctx_req_context() = 'client' and exists (
      select 1 from public.audctx_client_access ca
      where ca.user_id = auth.uid() and ca.firm_id = audctx_resources.firm_id
        and ca.client_key = audctx_resources.client_key))));
drop policy if exists audctx_res_insert on public.audctx_resources;
create policy audctx_res_insert on public.audctx_resources for insert to authenticated with check (
  (public.audctx_req_context() = 'staff' and firm_id = public.audctx_req_firm() and exists (
    select 1 from public.audctx_memberships m
    where m.user_id = auth.uid() and m.firm_id = audctx_resources.firm_id and m.status = 'active'
      and m.role in ('super_admin','partner','manager','senior','article_executive')))
  or (public.audctx_req_context() = 'client' and firm_id = public.audctx_req_firm()
      and client_key is not null and exists (
    select 1 from public.audctx_client_access ca
    where ca.user_id = auth.uid() and ca.firm_id = audctx_resources.firm_id
      and ca.client_key = audctx_resources.client_key)));
drop policy if exists audctx_res_update on public.audctx_resources;
create policy audctx_res_update on public.audctx_resources for update to authenticated
  using (public.audctx_req_context() = 'staff' and firm_id = public.audctx_req_firm() and exists (
    select 1 from public.audctx_memberships m
    where m.user_id = auth.uid() and m.firm_id = audctx_resources.firm_id and m.status = 'active'
      and m.role in ('super_admin','partner','manager','senior')))
  with check (public.audctx_req_context() = 'staff' and firm_id = public.audctx_req_firm() and exists (
    select 1 from public.audctx_memberships m
    where m.user_id = auth.uid() and m.firm_id = audctx_resources.firm_id and m.status = 'active'
      and m.role in ('super_admin','partner','manager','senior')));
drop policy if exists audctx_res_delete on public.audctx_resources;
create policy audctx_res_delete on public.audctx_resources for delete to authenticated using (
  public.audctx_req_context() = 'staff' and firm_id = public.audctx_req_firm() and exists (
    select 1 from public.audctx_memberships m
    where m.user_id = auth.uid() and m.firm_id = audctx_resources.firm_id and m.status = 'active'
      and m.role in ('super_admin','partner')));

grant select, insert, update, delete on public.audctx_resources to authenticated;
grant select on public.audctx_firms to authenticated;
grant select on public.audctx_memberships to authenticated;
grant select on public.audctx_client_access to authenticated;
grant select on public.audctx_support_sessions to authenticated;
grant insert on public.audctx_events to authenticated; -- RLS-gated (self human/support rows only)
grant usage on sequence public.audctx_resources_id_seq to authenticated;
grant usage on sequence public.audctx_events_id_seq to authenticated;

-- ---------------------------------------------------------------------------
-- CANDIDATE A — trigger reads request-scoped context.
-- Actor is ALWAYS auth.uid() (trusted). IP/UA/correlation/request-id are read
-- from PostgREST's request.headers GUC and recorded as UNTRUSTED METADATA.
-- x-actor-*/x-firm-override style headers are never consulted.
-- SECURITY DEFINER is required: authenticated has NO grant on audctx_events,
-- so the trigger owner (postgres) performs the audit write. search_path
-- pinned empty; all references qualified. It writes audit rows only — it is
-- not an RLS bypass helper (RLS on audctx_resources is evaluated before the
-- trigger fires).
-- Fault-injection hook (spike test only): when the transaction-local GUC
-- app.audctx_fault = 'fail_audit', the event row deliberately violates the
-- actor-model CHECK so the audit write fails.
-- Single-writer discipline: RPC candidates B/C set app.audctx_skip_trigger=1
-- (transaction-local) so exactly ONE audit row is written per mutation.
-- ---------------------------------------------------------------------------
create or replace function public.audctx_trg_resources_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_headers jsonb := coalesce(current_setting('request.headers', true)::jsonb, '{}'::jsonb);
  v_fault text := current_setting('app.audctx_fault', true);
begin
  if current_setting('app.audctx_skip_trigger', true) = '1' then
    return coalesce(new, old);
  end if;
  insert into public.audctx_events (
    actor_type, actor_user_id, firm_id, context, object_type, object_id, action,
    old_value, new_value, correlation_id, request_id, ip, user_agent, ctx_source)
  values (
    case when v_fault = 'fail_audit' then 'service' else 'human' end,
    auth.uid(),
    coalesce(new.firm_id, old.firm_id),
    coalesce(nullif(v_headers ->> 'x-audctx-context', ''), 'staff'),
    'audctx_resource', coalesce(new.id, old.id)::text, tg_op,
    to_jsonb(old), to_jsonb(new),
    v_headers ->> 'x-correlation-id',
    v_headers ->> 'x-request-id',
    v_headers ->> 'x-forwarded-for',
    v_headers ->> 'user-agent',
    'A-header-guc-trigger');
  return coalesce(new, old);
end;
$$;

drop trigger if exists audctx_resources_audit on public.audctx_resources;
create trigger audctx_resources_audit
  after insert or update or delete on public.audctx_resources
  for each row execute function public.audctx_trg_resources_audit();

-- ---------------------------------------------------------------------------
-- Context probes (evidence capture; readable by any signed-in spike user).
-- audctx_probe_context shows EXACTLY what the database sees on a direct
-- PostgREST request (authorization/apikey/cookie redacted).
-- ---------------------------------------------------------------------------
create or replace function public.audctx_probe_context() returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_headers jsonb := coalesce(current_setting('request.headers', true)::jsonb, '{}'::jsonb);
begin
  return pg_catalog.jsonb_build_object(
    'auth_uid', auth.uid(),
    'jwt_role', auth.jwt() ->> 'role',
    'jwt_claim_keys', (select coalesce(pg_catalog.jsonb_agg(k), '[]'::jsonb)
                       from pg_catalog.jsonb_object_keys(coalesce(auth.jwt(), '{}'::jsonb)) k),
    'request_headers', v_headers - 'authorization' - 'apikey' - 'cookie',
    'inet_client_addr', pg_catalog.inet_client_addr(),
    'inet_server_port', pg_catalog.inet_server_port(),
    'backend_pid', pg_catalog.pg_backend_pid(),
    'txid', pg_catalog.txid_current());
end;
$$;

create or replace function public.audctx_probe_set_ctx(p_value text) returns text
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform pg_catalog.set_config('app.audit_ctx', p_value, true); -- transaction-local
  return pg_catalog.current_setting('app.audit_ctx', true);
end;
$$;

create or replace function public.audctx_probe_get_ctx() returns text
language sql stable security invoker set search_path = '' as $$
  select pg_catalog.current_setting('app.audit_ctx', true)
$$;

-- ---------------------------------------------------------------------------
-- CANDIDATE B — explicit RPC context.
-- Shared validation: live relationship check (DEC-J resolved mechanism).
-- Raises (fail-closed) when no live staff membership / client grant exists.
-- ---------------------------------------------------------------------------
create or replace function public.audctx_assert_access(p_firm_id uuid, p_client_key text)
returns text
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'audctx: unauthenticated' using errcode = '42501';
  end if;
  if p_client_key is not null then
    if exists (select 1 from public.audctx_client_access ca
               where ca.user_id = v_uid and ca.firm_id = p_firm_id and ca.client_key = p_client_key) then
      return 'client';
    end if;
    raise exception 'audctx: no live client grant for firm %', p_firm_id using errcode = '42501';
  end if;
  if exists (select 1 from public.audctx_memberships m
             where m.user_id = v_uid and m.firm_id = p_firm_id and m.status = 'active'
               and m.role in ('super_admin','partner','manager','senior','article_executive')) then
    return 'staff';
  end if;
  raise exception 'audctx: no live active membership for firm %', p_firm_id using errcode = '42501';
end;
$$;

-- Core mutation+audit. SECURITY INVOKER: RLS on audctx_resources still
-- applies independently (defense in depth). Actor is derived ONLY from
-- auth.uid(); the function has NO actor parameters — caller-supplied actor
-- keys in the RPC payload cannot influence identity.
create or replace function public.audctx_b_create_resource(
  p_firm_id uuid, p_name text, p_amount numeric,
  p_client_key text default null, p_correlation_id text default null)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_ctx text;
  v_id bigint;
  v_headers jsonb := coalesce(current_setting('request.headers', true)::jsonb, '{}'::jsonb);
begin
  v_ctx := public.audctx_assert_access(p_firm_id, p_client_key);
  perform pg_catalog.set_config('app.audctx_skip_trigger', '1', true); -- single audit writer
  insert into public.audctx_resources (firm_id, name, amount, client_key)
  values (p_firm_id, p_name, p_amount, p_client_key)
  returning id into v_id;
  insert into public.audctx_events (
    actor_type, actor_user_id, firm_id, context, object_type, object_id, action,
    new_value, correlation_id, request_id, ip, user_agent, ctx_source)
  values (
    'human', auth.uid(), p_firm_id, v_ctx, 'audctx_resource', v_id::text, 'INSERT',
    pg_catalog.jsonb_build_object('id', v_id, 'firm_id', p_firm_id, 'name', p_name, 'amount', p_amount),
    p_correlation_id,
    v_headers ->> 'x-request-id',
    v_headers ->> 'x-forwarded-for',
    v_headers ->> 'user-agent',
    'B-rpc');
  return pg_catalog.jsonb_build_object('id', v_id, 'context', v_ctx);
end;
$$;

-- Fault-injection variant (spike test only): writes a MASQUERADING event
-- (actor_type='service' with a non-null actor_user_id) after the resource
-- insert. The actor-model CHECK must abort the whole transaction.
create or replace function public.audctx_b_create_resource_faulty(p_firm_id uuid, p_name text, p_amount numeric)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id bigint;
begin
  perform public.audctx_assert_access(p_firm_id, null);
  perform pg_catalog.set_config('app.audctx_skip_trigger', '1', true);
  insert into public.audctx_resources (firm_id, name, amount)
  values (p_firm_id, p_name, p_amount)
  returning id into v_id;
  insert into public.audctx_events (actor_type, actor_user_id, firm_id, context, object_type, object_id, action, ctx_source)
  values ('service', auth.uid(), p_firm_id, 'staff', 'audctx_resource', v_id::text, 'INSERT', 'B-rpc-faulty');
  return pg_catalog.jsonb_build_object('id', v_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- CANDIDATE C — server-wrapper RPC variant. Identical trust core to B; the
-- wrapper (server boundary) additionally asserts request_id / ip / user_agent
-- it observed itself. These remain METADATA (AUD-CTX-02: IP best-effort),
-- but they are server-asserted rather than client-asserted.
-- ---------------------------------------------------------------------------
create or replace function public.audctx_c_create_resource(
  p_firm_id uuid, p_name text, p_amount numeric,
  p_client_key text default null, p_correlation_id text default null,
  p_request_id text default null, p_ip text default null, p_user_agent text default null)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_ctx text;
  v_id bigint;
begin
  v_ctx := public.audctx_assert_access(p_firm_id, p_client_key);
  perform pg_catalog.set_config('app.audctx_skip_trigger', '1', true); -- single audit writer
  insert into public.audctx_resources (firm_id, name, amount, client_key)
  values (p_firm_id, p_name, p_amount, p_client_key)
  returning id into v_id;
  insert into public.audctx_events (
    actor_type, actor_user_id, firm_id, context, object_type, object_id, action,
    new_value, correlation_id, request_id, ip, user_agent, ctx_source)
  values (
    'human', auth.uid(), p_firm_id, v_ctx, 'audctx_resource', v_id::text, 'INSERT',
    pg_catalog.jsonb_build_object('id', v_id, 'firm_id', p_firm_id, 'name', p_name, 'amount', p_amount),
    p_correlation_id, p_request_id, p_ip, p_user_agent,
    'C-wrapper');
  return pg_catalog.jsonb_build_object('id', v_id, 'context', v_ctx);
end;
$$;

-- ---------------------------------------------------------------------------
-- Service actor path (server-only). SECURITY DEFINER is REQUIRED: it must
-- write audctx_events, which authenticated/anon cannot touch. Executable
-- ONLY by service_role — a browser token gets permission denied. Actor is
-- 'service' with NULL actor_user_id (AUD-ACT-05); service_name is supplied
-- by the server, never by the browser.
-- ---------------------------------------------------------------------------
create or replace function public.audctx_service_event(
  p_firm_id uuid, p_action text, p_object_type text, p_object_id text,
  p_service_name text, p_correlation_id text default null)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
begin
  insert into public.audctx_events (
    actor_type, actor_user_id, firm_id, context, object_type, object_id, action,
    service_name, correlation_id, ctx_source)
  values ('service', null, p_firm_id, 'service', p_object_type, p_object_id, p_action,
          p_service_name, p_correlation_id, 'service-rpc')
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.audctx_service_event(uuid, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.audctx_service_event(uuid, text, text, text, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- Support (break-glass representation, spike only). SECURITY INVOKER:
-- validates that the session exists, is OPEN, and belongs to auth.uid()
-- before writing actor_type='support' with both actor and session id.
-- ---------------------------------------------------------------------------
create or replace function public.audctx_support_event(
  p_session_id uuid, p_action text, p_object_type text, p_object_id text)
returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_session public.audctx_support_sessions%rowtype;
  v_id bigint;
begin
  select * into v_session from public.audctx_support_sessions s where s.id = p_session_id;
  if not found then
    raise exception 'audctx: unknown support session' using errcode = '42501';
  end if;
  if v_session.user_id <> auth.uid() then
    raise exception 'audctx: support session belongs to another user' using errcode = '42501';
  end if;
  if v_session.closed_at is not null then
    raise exception 'audctx: support session closed' using errcode = '42501';
  end if;
  insert into public.audctx_events (
    actor_type, actor_user_id, firm_id, context, object_type, object_id, action,
    support_session_id, ctx_source)
  values ('support', auth.uid(), v_session.firm_id, 'support', p_object_type, p_object_id, p_action,
          p_session_id, 'B-rpc-support');
  -- NOTE: no RETURNING here. Under RLS, INSERT ... RETURNING applies SELECT
  -- visibility to the returned row; authenticated has no SELECT policy on
  -- audctx_events (audit content is not browser-readable), so RETURNING
  -- raises an RLS violation. GET DIAGNOSTICS avoids that. (Spike finding.)
  get diagnostics v_id = row_count;
  return v_id;
end;
$$;

grant execute on function public.audctx_probe_context() to authenticated;
grant execute on function public.audctx_probe_set_ctx(text) to authenticated;
grant execute on function public.audctx_probe_get_ctx() to authenticated;
grant execute on function public.audctx_b_create_resource(uuid, text, numeric, text, text) to authenticated;
grant execute on function public.audctx_b_create_resource_faulty(uuid, text, numeric) to authenticated;
grant execute on function public.audctx_c_create_resource(uuid, text, numeric, text, text, text, text, text) to authenticated;
grant execute on function public.audctx_support_event(uuid, text, text, text) to authenticated;

vacuum analyze public.audctx_resources;
vacuum analyze public.audctx_memberships;
