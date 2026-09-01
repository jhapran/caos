-- IMP-013 — Audit foundation (SCH-20 audit_log + layered A+B/C write paths)
--
-- Implements the RESOLVED AUD-OQ-02 architecture (08 AUD-CTX-01):
--   Layer A — database-trigger baseline for ordinary authenticated human
--             mutations (firms HIGH, firm_memberships HIGH, profiles MEDIUM
--             per spec 06 audit-sensitivity column).
--   Layer B — explicit RPC boundary for sensitive/privileged human
--             operations (AUD-CTX-04, API-ARCH-04): firm membership
--             administration moves off raw PostgREST writes onto
--             controlled RPCs (API-R0-FRM); mutation + audit are atomic
--             (AUD-CTX-05 fail-closed).
--   Layer C — controlled server boundary CONTRACT for system/service/
--             support actors: security-definer event writers granted to
--             service_role only. No Edge Function / worker deployment here.
--
-- Requirement IDs: AUD-PRIN-01…03, AUD-ACT-01…05, AUD-CTX-01…06,
-- AUD-INV-01…06, AUD-EVT-01…03 (foundation subset), AUD-VAL-01/02,
-- AUD-LOGIN-01/02 (mirror foundation), AUD-FAIL-01/02 (surfacing only);
-- SCH-20; SCH-FK-01 (soft refs); RLS-AUD-01.
--
-- NOT here (explicitly): retention/purge/archive (AUD-OQ-01 OPEN — audit
-- rows are immutable under approved R0 behavior); per-domain audit events
-- (land with each domain package); break-glass session machinery (no
-- support_sessions table in the R0 schema inventory — IMP-072); scheduler
-- binding for the login-history mirror (decision N deferred); frontend
-- adapter (IMP-014).
--
-- Trust model (08 §6/§10/§11): actor identity ALWAYS derives from
-- auth.uid() inside request paths; firm identity from the validated
-- operation/row + live FirmMembership (DEC-J); ip / user_agent /
-- correlation_id / X-Forwarded-For are NON-AUTHORITATIVE metadata when
-- received from the request boundary (AUD-CTX-02) — recorded honestly,
-- never used for identity or authorization.

-- ---------------------------------------------------------------------------
-- SCH-20 — audit_log (append-only audit record; DM-25)
-- ---------------------------------------------------------------------------
create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  -- NULL is the documented reserved platform marker (AUD-EVT-03); tenant
  -- rows always carry firm_id (AUD-INV-03). Soft reference (SCH-FK-03).
  firm_id uuid,
  actor_type text not null,
  -- Soft reference to auth.users (SCH-FK-03): actor identity, not tenant
  -- responsibility. NULL unless actor_type is 'human' or 'support'.
  actor_user_id uuid,
  -- Job / Edge Function / automation identity for system/service actors.
  service_name text,
  action text not null,
  object_type text not null,
  -- Soft reference (SCH-FK-03): survives object lifecycle, append-only.
  object_id text,
  old_value jsonb,
  new_value jsonb,
  -- Non-authoritative request metadata (AUD-CTX-02) unless written through
  -- the Layer-C server boundary.
  ip text,
  user_agent text,
  correlation_id uuid,
  support_session_id uuid,
  -- Server-generated only (AUD-INV-02): default now(); client-supplied
  -- timestamps are never accepted by the write paths below.
  created_at timestamptz not null default now(),
  constraint audit_log_actor_type_check
    check (actor_type in ('human', 'system', 'service', 'support')),
  -- AUD-ACT-05 masquerade prohibition: system/service never carry a human
  -- actor_user_id; support requires actor + session; human requires actor.
  constraint audit_log_actor_model_check
    check (
      case actor_type
        when 'human' then actor_user_id is not null
        when 'system' then actor_user_id is null and service_name is not null
        when 'service' then actor_user_id is null and service_name is not null
        when 'support' then actor_user_id is not null
                        and support_session_id is not null
      end
    )
);

comment on table public.audit_log is 'SCH-20: immutable append-only audit record (DM-25, AUD-INV-*). NULL firm_id is the reserved platform marker (AUD-EVT-03).';

-- SCH-20 indexes.
create index audit_log_firm_object_idx
  on public.audit_log (firm_id, object_type, object_id);
create index audit_log_firm_created_idx
  on public.audit_log (firm_id, created_at);
create index audit_log_actor_created_idx
  on public.audit_log (actor_user_id, created_at);
create index audit_log_support_session_idx
  on public.audit_log (support_session_id);

-- ---------------------------------------------------------------------------
-- RLS (RLS-AUD-01). audit_log rows are tenant-owned (DM-25), so RLS is
-- enabled AND forced (RLS-PRIN-02). Forcing is safe here: the table owner
-- is postgres (superuser locally and on hosted Supabase — unaffected by
-- FORCE), and every write path below is a postgres-owned SECURITY DEFINER
-- function, so no legitimate writer depends on owner bypass.
-- ---------------------------------------------------------------------------
alter table public.audit_log enable row level security;
alter table public.audit_log force row level security;

-- SELECT only, privileged roles of the owning firm (RLS-AUD-01). NULL-firm
-- platform entries are never visible to application roles.
create policy audit_select_partner_admin on public.audit_log
  for select to authenticated
  using (
    firm_id is not null
    and public.active_membership_role(firm_id) in ('partner', 'super_admin')
  );

-- Grants: fail-closed first (default Supabase privileges would expose the
-- table to anon/authenticated AND grant service_role ALL), then exactly
-- SELECT for authenticated.
-- INSERT exists for NO application role (RLS-AUD-01: writes only via the
-- security-definer paths below — those run as the owner and are unaffected
-- by these revocations); UPDATE/DELETE/TRUNCATE for nobody (AUD-INV-01
-- append-only). service_role gets NO direct table privilege: Layer-C server
-- paths write exclusively through write_audit_event_server /
-- mirror_login_history.
revoke all on public.audit_log from anon, authenticated, service_role;
grant select on public.audit_log to authenticated;

-- ---------------------------------------------------------------------------
-- Internal audit writer — owner-only (EXECUTE revoked from everyone;
-- callable only by the postgres-owned definer paths below, which run as
-- the owner). Resolves non-authoritative request metadata from
-- request.headers (AUD-CTX-02) and enforces the server-generated timestamp
-- (AUD-INV-02: p_created_at exists solely for the login-history mirror,
-- which carries GoTrue-server-generated timestamps; all other callers get
-- now()).
--
-- TEST-ONLY FAULT HOOK: current_setting('app.audit_fault', true) =
-- 'fail_audit' forces a write failure. It exists to prove AUD-CTX-05 /
-- AUD-INV-05 fail-closed behavior (TEST-AUD-07). It is unreachable from
-- PostgREST: callers have no EXECUTE on this function and no SQL/GUC
-- surface to set the variable; only a psql operator session (or a test
-- simulating one) can set it. Never used in production paths.
-- ---------------------------------------------------------------------------
create or replace function public.audit_write(
  p_firm_id uuid,
  p_actor_type text,
  p_actor_user_id uuid,
  p_action text,
  p_object_type text,
  p_object_id text,
  p_old_value jsonb,
  p_new_value jsonb,
  p_service_name text default null,
  p_support_session_id uuid default null,
  p_correlation_id uuid default null,
  p_ip text default null,
  p_user_agent text default null,
  p_created_at timestamptz default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_headers jsonb;
  v_correlation uuid := p_correlation_id;
  v_id uuid;
begin
  if current_setting('app.audit_fault', true) = 'fail_audit' then
    raise exception 'audit write fault injected (test hook)'
      using errcode = 'P0001';
  end if;

  -- Request headers are untrusted metadata (AUD-CTX-02). Parse defensively:
  -- a malformed GUC must never abort an otherwise valid audited mutation
  -- through a JSON error here.
  begin
    v_headers := coalesce(
      nullif(current_setting('request.headers', true), '')::jsonb,
      '{}'::jsonb
    );
  exception when others then
    v_headers := '{}'::jsonb;
  end;

  if v_correlation is null then
    begin
      v_correlation := nullif(v_headers ->> 'x-correlation-id', '')::uuid;
    exception when others then
      v_correlation := null;
    end;
  end if;

  insert into public.audit_log (
    firm_id, actor_type, actor_user_id, service_name, action,
    object_type, object_id, old_value, new_value,
    ip, user_agent, correlation_id, support_session_id, created_at
  ) values (
    p_firm_id, p_actor_type, p_actor_user_id, p_service_name, p_action,
    p_object_type, p_object_id, p_old_value, p_new_value,
    coalesce(p_ip, v_headers ->> 'x-forwarded-for'),
    coalesce(p_user_agent, v_headers ->> 'user-agent'),
    v_correlation,
    p_support_session_id,
    coalesce(p_created_at, now())
  )
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.audit_write(uuid, text, uuid, text, text, text, jsonb, jsonb, text, uuid, uuid, text, text, timestamptz) is
  'IMP-013 internal audit writer (AUD-EVT-01). Owner-only EXECUTE; callers are the definer trigger/RPC paths. Request-header ip/ua/correlation are untrusted metadata (AUD-CTX-02).';

-- ---------------------------------------------------------------------------
-- Layer A — trigger baseline (AUD-CTX-01 Layer A)
--
-- Actor derivation (never caller-controlled):
--   auth.uid() present              -> human / that user
--   jwt role = service_role         -> service / 'service-role'
--     (AUD-SVC-01: service-role writes self-audit)
--   otherwise (no request JWT: psql seed/migration/operator writes)
--                                   -> system / 'database-operator'
-- firm/object context derives from the row (never from headers).
-- Skip hook: membership-admin RPCs set transaction-local
-- app.audit_skip_trigger='1' BEFORE mutating so their authoritative Layer-B
-- audit row is not duplicated by this trigger. Single-writer design: only
-- the RPCs in this migration set it; it is transaction-local
-- (set_config(..., true)) so it cannot leak across pooled requests
-- (AUD-CTX-03).
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
  else
    -- Defense in depth: this trigger must only ever be attached to the
    -- mapped tables above.
    raise exception 'audit_trg_row attached to unmapped table %', TG_TABLE_NAME
      using errcode = 'P0001';
  end if;

  -- AUD-VAL-01: old+new for UPDATE, NEW only for INSERT, OLD only for
  -- DELETE. AUD-VAL-02: redaction list reviewed for the three mapped
  -- tables — no secrets-adjacent/bulk-noise columns identified; none.
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
  'IMP-013 Layer-A audit trigger (AUD-CTX-01). Actor from auth.uid()/jwt role only; firm/object from the row. DEFINER solely so application roles without audit_log INSERT privilege can be audited; owner-only EXECUTE.';

create trigger firms_audit_row
  after insert or update or delete on public.firms
  for each row execute function public.audit_trg_row();

create trigger firm_memberships_audit_row
  after insert or update or delete on public.firm_memberships
  for each row execute function public.audit_trg_row();

create trigger profiles_audit_row
  after insert or update or delete on public.profiles
  for each row execute function public.audit_trg_row();

-- ---------------------------------------------------------------------------
-- Layer B — membership administration RPCs (AUD-CTX-04, API-ARCH-04,
-- API-R0-FRM). These REPLACE the IMP-012 direct PostgREST write path for
-- firm_memberships: the insert/update policies and column write grants are
-- dropped/revoked at the end of this migration.
--
-- SECURITY DEFINER justification (API-SEC-03 — exceptional, reviewed):
-- INVOKER variants would require the raw table write policies/grants this
-- package deliberately removes. Each function:
--   * derives the actor from auth.uid() — never from parameters/headers;
--   * authorizes against the LIVE FirmMembership row via
--     public.active_membership_role (DEC-J, RLS-MECH-01): suspension,
--     removal and downgrade take effect on the next call with no JWT
--     refresh;
--   * requires AAL2 for privileged administration (RLS-AAL-01); the aal
--     claim is an authentication-assurance claim, not tenant authority;
--   * performs mutation + audit write in ONE transaction (AUD-CTX-05):
--     any failure (including an audit-write failure) rolls back both;
--   * has a pinned empty search_path, fully qualified objects, no dynamic
--     SQL, no SET ROLE, no GUC mutation beyond the transaction-local
--     trigger-skip flag described above.
-- Authorization failures raise 42501 (PostgREST surfaces 403).
-- ---------------------------------------------------------------------------

create or replace function public.invite_member(
  p_firm_id uuid,
  p_user_id uuid,
  p_role text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_row public.firm_memberships;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if (select auth.jwt() ->> 'aal') is distinct from 'aal2' then
    raise exception 'AAL2 step-up required' using errcode = '42501';
  end if;
  if public.active_membership_role(p_firm_id) is distinct from 'super_admin' then
    raise exception 'super_admin membership in the target firm required'
      using errcode = '42501';
  end if;

  perform pg_catalog.set_config('app.audit_skip_trigger', '1', true);

  insert into public.firm_memberships (firm_id, user_id, role, status, invited_by)
  values (p_firm_id, p_user_id, p_role, 'invited', (select auth.uid()))
  returning * into v_row;

  perform public.audit_write(
    p_firm_id, 'human', (select auth.uid()),
    'membership.invite', 'firm_membership', v_row.id::text,
    null, to_jsonb(v_row)
  );

  return to_jsonb(v_row);
end;
$$;

comment on function public.invite_member(uuid, uuid, text) is
  'IMP-013 Layer-B RPC (API-R0-FRM invite-new): super_admin + AAL2 + live membership; atomic mutation+audit (AUD-CTX-05). Re-invite of a removed membership is NOT this function (SCH-OQ-03/API-OQ-04 OPEN — surfaces as 409 unique conflict).';

create or replace function public.change_membership_role(
  p_firm_id uuid,
  p_user_id uuid,
  p_role text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_old public.firm_memberships;
  v_new public.firm_memberships;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if (select auth.jwt() ->> 'aal') is distinct from 'aal2' then
    raise exception 'AAL2 step-up required' using errcode = '42501';
  end if;
  if public.active_membership_role(p_firm_id) is distinct from 'super_admin' then
    raise exception 'super_admin membership in the target firm required'
      using errcode = '42501';
  end if;

  perform pg_catalog.set_config('app.audit_skip_trigger', '1', true);

  select * into v_old
  from public.firm_memberships
  where firm_id = p_firm_id and user_id = p_user_id
  for update;

  if not found then
    raise exception 'membership not found' using errcode = 'P0002';
  end if;
  -- 'removed' rows are terminal history (SCH-03: never hard-deleted);
  -- reactivation semantics are OPEN (SCH-OQ-03/API-OQ-04).
  if v_old.status = 'removed' then
    raise exception 'removed memberships are immutable'
      using errcode = '42501';
  end if;

  update public.firm_memberships
  set role = p_role
  where id = v_old.id
  returning * into v_new;

  perform public.audit_write(
    p_firm_id, 'human', (select auth.uid()),
    'membership.role_change', 'firm_membership', v_new.id::text,
    to_jsonb(v_old), to_jsonb(v_new)
  );

  return to_jsonb(v_new);
end;
$$;

comment on function public.change_membership_role(uuid, uuid, text) is
  'IMP-013 Layer-B RPC (API-R0-FRM role change): super_admin + AAL2 + live membership; atomic mutation+audit (AUD-CTX-05). Removed memberships are immutable (API-OQ-04 OPEN).';

create or replace function public.suspend_membership(
  p_firm_id uuid,
  p_user_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_old public.firm_memberships;
  v_new public.firm_memberships;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if (select auth.jwt() ->> 'aal') is distinct from 'aal2' then
    raise exception 'AAL2 step-up required' using errcode = '42501';
  end if;
  if public.active_membership_role(p_firm_id) is distinct from 'super_admin' then
    raise exception 'super_admin membership in the target firm required'
      using errcode = '42501';
  end if;

  perform pg_catalog.set_config('app.audit_skip_trigger', '1', true);

  select * into v_old
  from public.firm_memberships
  where firm_id = p_firm_id and user_id = p_user_id
  for update;

  if not found then
    raise exception 'membership not found' using errcode = 'P0002';
  end if;
  if v_old.status is distinct from 'active' then
    raise exception 'only an active membership can be suspended'
      using errcode = '42501';
  end if;

  update public.firm_memberships
  set status = 'suspended'
  where id = v_old.id
  returning * into v_new;

  perform public.audit_write(
    p_firm_id, 'human', (select auth.uid()),
    'membership.suspend', 'firm_membership', v_new.id::text,
    to_jsonb(v_old), to_jsonb(v_new)
  );

  return to_jsonb(v_new);
end;
$$;

comment on function public.suspend_membership(uuid, uuid) is
  'IMP-013 Layer-B RPC (API-R0-FRM suspend): super_admin + AAL2 + live membership; active -> suspended; atomic mutation+audit (AUD-CTX-05).';

create or replace function public.remove_membership(
  p_firm_id uuid,
  p_user_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_old public.firm_memberships;
  v_new public.firm_memberships;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if (select auth.jwt() ->> 'aal') is distinct from 'aal2' then
    raise exception 'AAL2 step-up required' using errcode = '42501';
  end if;
  if public.active_membership_role(p_firm_id) is distinct from 'super_admin' then
    raise exception 'super_admin membership in the target firm required'
      using errcode = '42501';
  end if;

  perform pg_catalog.set_config('app.audit_skip_trigger', '1', true);

  select * into v_old
  from public.firm_memberships
  where firm_id = p_firm_id and user_id = p_user_id
  for update;

  if not found then
    raise exception 'membership not found' using errcode = 'P0002';
  end if;
  if v_old.status not in ('invited', 'active', 'suspended') then
    raise exception 'membership already removed' using errcode = '42501';
  end if;

  update public.firm_memberships
  set status = 'removed'
  where id = v_old.id
  returning * into v_new;

  perform public.audit_write(
    p_firm_id, 'human', (select auth.uid()),
    'membership.remove', 'firm_membership', v_new.id::text,
    to_jsonb(v_old), to_jsonb(v_new)
  );

  return to_jsonb(v_new);
end;
$$;

comment on function public.remove_membership(uuid, uuid) is
  'IMP-013 Layer-B RPC (API-R0-FRM remove): super_admin + AAL2 + live membership; invited/active/suspended -> removed; atomic mutation+audit (AUD-CTX-05).';

-- Self-service invitation acceptance (API-R0-FRM (a) counterpart): the
-- invitee flips THEIR OWN invited membership to active. Deliberately NOT
-- AAL2-gated: first login and acceptance precede MFA enrolment (AUTH-10
-- ordering); the operation can only activate the caller's own row.
create or replace function public.accept_invitation(
  p_firm_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_old public.firm_memberships;
  v_new public.firm_memberships;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  perform pg_catalog.set_config('app.audit_skip_trigger', '1', true);

  select * into v_old
  from public.firm_memberships
  where firm_id = p_firm_id
    and user_id = (select auth.uid())
  for update;

  if not found or v_old.status is distinct from 'invited' then
    raise exception 'no pending invitation for this firm'
      using errcode = '42501';
  end if;

  update public.firm_memberships
  set status = 'active'
  where id = v_old.id
  returning * into v_new;

  perform public.audit_write(
    p_firm_id, 'human', (select auth.uid()),
    'membership.accept', 'firm_membership', v_new.id::text,
    to_jsonb(v_old), to_jsonb(v_new)
  );

  return to_jsonb(v_new);
end;
$$;

comment on function public.accept_invitation(uuid) is
  'IMP-013 Layer-B RPC: invitee self-accepts their own invited membership (invited -> active). No AAL2 — acceptance precedes MFA enrolment (AUTH-10). Atomic mutation+audit.';

-- ---------------------------------------------------------------------------
-- Layer C — server boundary contract (AUD-CTX-01 Layer C; AUD-ACT-01
-- "explicit parameter via the security-definer event function otherwise").
-- Granted to service_role ONLY. Server-asserted ip/ua/correlation params
-- are trusted ONLY because this boundary is controlled (AUD-CTX-02); the
-- browser can never reach these functions. The audit_log actor-model CHECK
-- (AUD-ACT-05) is the database backstop for every parameter combination.
-- ---------------------------------------------------------------------------

-- Human-actor event writer for authenticated staff (security/business
-- events that are not row mutations — AUD-EVT-02). Actor is ALWAYS
-- auth.uid()/human; firm authorization is the live membership check.
create or replace function public.write_audit_event(
  p_firm_id uuid,
  p_action text,
  p_object_type text,
  p_object_id text default null,
  p_old_value jsonb default null,
  p_new_value jsonb default null,
  p_correlation_id uuid default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_firm_id is null then
    raise exception 'firm_id is required for staff-originated events'
      using errcode = '42501';
  end if;
  if public.active_membership_role(p_firm_id) is null then
    raise exception 'active membership in the target firm required'
      using errcode = '42501';
  end if;

  return public.audit_write(
    p_firm_id, 'human', (select auth.uid()),
    p_action, p_object_type, p_object_id,
    p_old_value, p_new_value,
    p_correlation_id => p_correlation_id
  );
end;
$$;

comment on function public.write_audit_event(uuid, text, text, text, jsonb, jsonb, uuid) is
  'IMP-013 staff security/business event writer (AUD-EVT-02). Actor always auth.uid()/human; firm validated against live membership (DEC-J).';

-- Server-actor event writer (Layer C). Full actor model per AUD-ACT-01…04,
-- including explicit human actor for server-verified sessions and
-- support-actor rows for break-glass (AUD-SUP-*). The CHECK constraint
-- rejects masquerading combinations regardless of caller.
create or replace function public.write_audit_event_server(
  p_firm_id uuid,
  p_actor_type text,
  p_actor_user_id uuid,
  p_action text,
  p_object_type text,
  p_object_id text default null,
  p_old_value jsonb default null,
  p_new_value jsonb default null,
  p_service_name text default null,
  p_support_session_id uuid default null,
  p_correlation_id uuid default null,
  p_ip text default null,
  p_user_agent text default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  -- Reachable only by service_role (grant below) or the owner (operator).
  -- Defense in depth: if a request JWT context exists, it must be the
  -- service role. (Empty-string placeholder GUCs left behind by a prior
  -- SET LOCAL in the same session are treated as absent.)
  if nullif(current_setting('request.jwt.claims', true), '') is not null
     and (select auth.jwt() ->> 'role') is distinct from 'service_role' then
    raise exception 'service-role boundary required' using errcode = '42501';
  end if;

  return public.audit_write(
    p_firm_id, p_actor_type, p_actor_user_id,
    p_action, p_object_type, p_object_id,
    p_old_value, p_new_value,
    p_service_name => p_service_name,
    p_support_session_id => p_support_session_id,
    p_correlation_id => p_correlation_id,
    p_ip => p_ip,
    p_user_agent => p_user_agent
  );
end;
$$;

comment on function public.write_audit_event_server(uuid, text, uuid, text, text, text, jsonb, jsonb, text, uuid, uuid, text, text) is
  'IMP-013 Layer-C server event writer (AUD-CTX-01). service_role only; full AUD-ACT-* actor model; server-asserted metadata trusted only at this controlled boundary.';

-- Login-history mirroring foundation (AUD-LOGIN-01/02): copies GoTrue
-- auth.audit_log_entries into audit_log. The MIRRORING process is a system
-- actor (AUD-ACT-02 names login-history mirroring explicitly): rows carry
-- actor_type='system', service_name='supabase-auth-mirror', NULL firm
-- (platform auth events have no single owning firm — AUD-EVT-03), and the
-- full GoTrue payload (which contains actor_id/actor_username) in
-- new_value. created_at is carried from the GoTrue entry — server-generated
-- by platform auth, satisfying AUD-INV-02's "server-generated" intent;
-- never client-supplied. Idempotent on (object_type, object_id). Scheduler
-- binding (pg_cron vs Edge schedule) is DEFERRED (decision N unresolved);
-- this package ships the function + tests only.
create or replace function public.mirror_login_history()
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if nullif(current_setting('request.jwt.claims', true), '') is not null
     and (select auth.jwt() ->> 'role') is distinct from 'service_role' then
    raise exception 'service-role boundary required' using errcode = '42501';
  end if;

  insert into public.audit_log (
    firm_id, actor_type, actor_user_id, service_name, action,
    object_type, object_id, old_value, new_value,
    ip, user_agent, correlation_id, support_session_id, created_at
  )
  select
    null,
    'system',
    null,
    'supabase-auth-mirror',
    'auth.' || coalesce(nullif(e.payload ->> 'action', ''), 'event'),
    'auth.audit_log_entry',
    e.id::text,
    null,
    e.payload,
    nullif(e.ip_address, ''),
    null,
    null,
    null,
    e.created_at
  from auth.audit_log_entries e
  where not exists (
    select 1
    from public.audit_log a
    where a.object_type = 'auth.audit_log_entry'
      and a.object_id = e.id::text
  );

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function public.mirror_login_history() is
  'IMP-013 AUD-LOGIN-01/02 foundation: mirrors auth.audit_log_entries into audit_log as system-actor platform rows. service_role only; idempotent; scheduler binding deferred.';

-- ---------------------------------------------------------------------------
-- Function privileges. PostgreSQL grants EXECUTE to PUBLIC by default —
-- revoke everywhere first, then grant the minimum (RLS-AUD-01: INSERT only
-- via security-definer triggers/functions; API-SEC-03 minimal privileges).
-- ---------------------------------------------------------------------------
revoke all on function public.audit_write(uuid, text, uuid, text, text, text, jsonb, jsonb, text, uuid, uuid, text, text, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.audit_trg_row() from public, anon, authenticated, service_role;
revoke all on function public.invite_member(uuid, uuid, text) from public, anon, service_role;
revoke all on function public.change_membership_role(uuid, uuid, text) from public, anon, service_role;
revoke all on function public.suspend_membership(uuid, uuid) from public, anon, service_role;
revoke all on function public.remove_membership(uuid, uuid) from public, anon, service_role;
revoke all on function public.accept_invitation(uuid) from public, anon, service_role;
revoke all on function public.write_audit_event(uuid, text, text, text, jsonb, jsonb, uuid) from public, anon, service_role;
revoke all on function public.write_audit_event_server(uuid, text, uuid, text, text, text, jsonb, jsonb, text, uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.mirror_login_history() from public, anon, authenticated;

grant execute on function public.invite_member(uuid, uuid, text) to authenticated;
grant execute on function public.change_membership_role(uuid, uuid, text) to authenticated;
grant execute on function public.suspend_membership(uuid, uuid) to authenticated;
grant execute on function public.remove_membership(uuid, uuid) to authenticated;
grant execute on function public.accept_invitation(uuid) to authenticated;
grant execute on function public.write_audit_event(uuid, text, text, text, jsonb, jsonb, uuid) to authenticated;
grant execute on function public.write_audit_event_server(uuid, text, uuid, text, text, text, jsonb, jsonb, text, uuid, uuid, text, text) to service_role;
grant execute on function public.mirror_login_history() to service_role;

-- ---------------------------------------------------------------------------
-- Layer-B transition (API-ARCH-04 / AUD-CTX-04 / API-R0-FRM): membership
-- administration is no longer a raw table write. Drop the IMP-012 write
-- policies and revoke the column write grants; the SELECT policy and grant
-- (roster read) remain. firms / profiles authorization is unchanged —
-- their ordinary mutations stay on the Layer-A trigger baseline.
-- IMP-010/IMP-012 migration files are NOT modified (checkpointed history
-- is immutable); the transition happens here.
-- ---------------------------------------------------------------------------
drop policy memberships_insert_super_admin_aal2 on public.firm_memberships;
drop policy memberships_update_super_admin_aal2 on public.firm_memberships;

revoke insert (firm_id, user_id, role, status, invited_by)
  on public.firm_memberships from authenticated;
revoke update (role, status)
  on public.firm_memberships from authenticated;

-- ---------------------------------------------------------------------------
-- Notes for reviewers
-- ---------------------------------------------------------------------------
-- * AUD-VAL-02 redaction review for the three trigger-mapped tables
--   (firms, profiles, firm_memberships): no secrets-adjacent or bulk-noise
--   columns identified — full-row old/new snapshots are recorded.
-- * AUD-EVT-03 deviation (documented): profile audit rows carry
--   firm_id = NULL with a human/system actor because profiles are global
--   identity data (TEN-04) with no owning firm. The actor-model CHECK is
--   still fully enforced; only the "NULL firm implies system/service"
--   convention is extended.
-- * AUD-INV-06: correlation_id is populated from the x-correlation-id
--   request header when present (untrusted metadata, AUD-CTX-02) or passed
--   explicitly by server/RPC paths.
-- * AUD-FAIL-01/02 foundation: authorization failures inside the RPCs raise
--   42501 (visible to callers/logs per API-ERR-*); persistent security-
--   denial audit records land with the operational-log surface (13) and
--   domain packages.
-- * Test-only fault hook: app.audit_fault='fail_audit' forces an audit-write
--   failure for TEST-AUD-07 (fail-closed proof). Unreachable from PostgREST
--   (no EXECUTE on audit_write, no GUC surface); psql/operator sessions only.
