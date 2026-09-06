-- IMP-042 — Alerts & My Work: alerts + alert_rules schema, production RLS,
-- controlled Layer-B commands, and audit integration (one migration).
-- (SCH-18 alerts, SCH-19 alert_rules, DM-22 hybrid-resolution risk signals;
-- RLS-ALR-01, RLS-ARL-01, RLS-AAL-01; API-R0-ALR; AUD-CAT-01 alert family)
--
-- Implements exactly the two tables owned by this package's database slice:
--   public.alert_rules (SCH-19 — per-firm alert rule configuration;
--                       tenant-owned, UNIQUE (firm_id, rule_key); NO seed
--                       rows and NO thresholds — D3 ruling, AUTO-OQ-04 open)
--   public.alerts      (SCH-18 — firm risk signals with hybrid resolution,
--                       DM-22; the manual transition matrix is human-ruled
--                       at IMP-042 contract reconciliation 2026-09-06; the
--                       RLS-ALR-01 senior/article read granularity is
--                       exact-instance, human-ruled at IMP-042
--                       pre-checkpoint correction 2026-09-06 — see
--                       alerts_select_scoped)
--
-- Requirement IDs: DM-22, SCH-18, SCH-19, SCH-FK-01/02 (composite same-firm
-- FKs), SCH-RESP-02 (acknowledged_by/resolved_by are bare auth.users ACTOR
-- identity references — acknowledgement/resolution are actions ON a firm
-- object, not tenant responsibility assignments; contrast SCH-RESP-01/03),
-- RLS-PRIN-01/02 (RLS enabled AND forced), RLS-ALR-01, RLS-ARL-01,
-- RLS-STF-05/07, RLS-CTX-01/02, RLS-AAL-01 (rule administration step-up),
-- RLS-AAL-02 (routine alert transitions need no step-up), API-R0-ALR,
-- API-ARCH-04, API-ERR-01/02/04 (authorization-first not_found uniformity;
-- invalid_state -> conflict; validation -> validation), API-MUT-01…04
-- (state-based mutation-key idempotency, server-derived actor stamping),
-- AUD-CAT-01 (alert-rule changes; alert acknowledge/snooze/resolve),
-- AUD-CTX-01/05, AUD-FAIL-01, AUD-VAL-01.
-- Test IDs served: TEST-SCH-26…29 (schema), TEST-RLS-ALR-*/TEST-RLS-ARL-*
-- (RLS), TEST-API-16/17/18 (commands + transition matrix + snooze-expiry
-- posture), TEST-AUD-02 (alert_rules portion), TEST-AUD-03 (alert
-- manual-transition portion).
--
-- Explicitly NOT here (package non-goals — do not read their absence as an
-- oversight):
--   * Alert-rule seed rows / default thresholds (D3 ruling; AUTO-OQ-04 open
--     — template seeding/activation is deferred to its own authorized
--     package/decision).
--   * The alert EVALUATOR and auto-resolution (resolution_type='auto' is
--     reserved for the IMP-051 evaluator; no command below can write it).
--   * The snooze-expiry SCHEDULER and any expiry writes (SCH-18: IMP-042
--     performs NO expiry writes; authoritative reads derive the effective
--     status adapter-side from the persisted columns — a plain SELECT
--     exposes status/snoozed_until/acknowledged_at exactly as persisted).
--   * The My Work read contract (API-R0-MWK — plain RLS reads composed
--     behind @/data in the adapter slice; NO aggregate definer RPC).
--   * @/data adapter, fixture adapter, UI, event publication
--     (alert.raised/resolved stay contract names only; AUTO-OQ-02 mechanism
--     is IMP-050).
--
-- Trust model (unchanged from IMP-012/013/020/021/030/031/040/041): RLS is
-- never the integrity boundary — cross-firm references are impossible at the
-- constraint layer via composite (firm_id, x_id) FKs; the lifecycle-field
-- CHECK and the single-writer write guard below hold for EVERY writer,
-- owner included. RLS is the authorization boundary: browser roles get
-- SELECT-only grants; every status write and every rule-administration
-- write is a Layer-B definer command (API-ARCH-04).

-- ---------------------------------------------------------------------------
-- SCH-19 — alert_rules
-- Per-firm alert rule configuration (DM-22). Tenant-owned: firm rows only
-- (NO NULL-firm/system-default pattern — TEN-09 firm-created rows). IMP-042
-- ships NO seed rows and no thresholds (D3 ruling; AUTO-OQ-04 open).
-- severity matches the SCH-18 alerts severity vocabulary exactly.
-- ---------------------------------------------------------------------------
create table public.alert_rules (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null,
  rule_key text not null,
  name text not null,
  severity text not null,
  config jsonb not null default '{}',
  enabled boolean not null default true,
  auto_resolve boolean not null default true,
  requires_explicit_ack boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  constraint alert_rules_severity_check
    check (severity in ('info', 'warning', 'critical')),
  constraint alert_rules_firm_fkey
    foreign key (firm_id) references public.firms (id) on delete restrict,
  -- SCH-19: one rule_key per firm.
  constraint alert_rules_firm_rule_key_unique unique (firm_id, rule_key),
  -- SCH-FK-01: composite-FK parent key for the SCH-18 alerts child table.
  constraint alert_rules_firm_id_unique unique (firm_id, id)
);

comment on table public.alert_rules is 'SCH-19: per-firm alert rule configuration (DM-22). Tenant-owned; UNIQUE (firm_id, rule_key). NO seed rows/thresholds in IMP-042 (D3 ruling; AUTO-OQ-04 open). RLS-ARL-01: read super_admin/partner/manager; write super_admin/partner only via the Layer-B admin commands with AAL2 step-up (RLS-AAL-01); every change audited (AUD-CAT-01). RLS enabled AND FORCED.';

-- ---------------------------------------------------------------------------
-- SCH-18 — alerts
-- Firm risk signals with hybrid resolution (DM-22). alert_rule_id is a
-- nullable link to the generating rule (ad-hoc/operator-raised alerts carry
-- none); client_id / compliance_instance_id are independent nullable
-- same-firm subject references (SCH-18 defines NO subject-binding invariant
-- — unlike SCH-17 review_items). raised_at is server-generated.
-- The manual transition matrix (human-ruled 2026-09-06) is enforced by the
-- Layer-B commands acknowledge_alert / snooze_alert / resolve_alert (PASS-B
-- section below) — transition LEGALITY is deliberately not a CHECK; the
-- alerts_lifecycle_fields_check backstop only pins which stamp columns each
-- persisted status may carry, for EVERY writer.
-- Snooze expiry (SCH-18): IMP-042 persists NO expiry transition; a persisted
-- 'snoozed' row whose snoozed_until has passed simply remains persisted —
-- authoritative reads derive the effective status adapter-side
-- (acknowledged when acknowledged_at IS NOT NULL, else active). The CHECK
-- below therefore does NOT and CANNOT reference now().
-- ---------------------------------------------------------------------------
create table public.alerts (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null,
  alert_rule_id uuid,
  severity text not null,
  title text not null,
  detail text,
  client_id uuid,
  compliance_instance_id uuid,
  affected jsonb,
  status text not null default 'active',
  raised_at timestamptz not null default now(),
  acknowledged_by uuid,
  acknowledged_at timestamptz,
  snoozed_until timestamptz,
  resolved_by uuid,
  resolved_at timestamptz,
  resolution_type text,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  constraint alerts_severity_check
    check (severity in ('info', 'warning', 'critical')),
  -- Status vocabulary (exactly these four states). Transition legality and
  -- authorization are not CHECKs: all status movement is command-owned
  -- (API-R0-ALR, API-ARCH-04).
  constraint alerts_status_check
    check (status in ('active', 'acknowledged', 'snoozed', 'resolved')),
  -- 'auto' is reserved for the IMP-051 evaluator; the manual commands below
  -- only ever write 'manual'.
  constraint alerts_resolution_type_check
    check (resolution_type in ('manual', 'auto')),
  -- Lifecycle-field consistency backstop (schema layer; the authoritative
  -- semantics are the commands'): active carries NO stamps; acknowledged
  -- carries the acknowledgement stamps and NO open snooze (the matrix clears
  -- snoozed_until on acknowledge); snoozed carries snoozed_until and may or
  -- may not carry a prior acknowledgement (acknowledge -> snooze preserves
  -- it); resolved carries the resolution triple and may retain
  -- acknowledgement/snooze history. Expired persisted snoozes are
  -- representable by construction (no now() reference — SCH-18 expiry is a
  -- READ derivation, IMP-042 writes none).
  constraint alerts_lifecycle_fields_check
    check (
      (status = 'active'
        and acknowledged_by is null and acknowledged_at is null
        and snoozed_until is null
        and resolved_by is null and resolved_at is null
        and resolution_type is null)
      or
      (status = 'acknowledged'
        and acknowledged_by is not null and acknowledged_at is not null
        and snoozed_until is null
        and resolved_by is null and resolved_at is null
        and resolution_type is null)
      or
      (status = 'snoozed'
        and snoozed_until is not null
        and (acknowledged_by is null) = (acknowledged_at is null)
        and resolved_by is null and resolved_at is null
        and resolution_type is null)
      or
      (status = 'resolved'
        and resolved_by is not null and resolved_at is not null
        and resolution_type is not null)
    ),
  constraint alerts_firm_fkey
    foreign key (firm_id) references public.firms (id) on delete restrict,
  -- SCH-FK-01/02: composite same-firm FKs — cross-firm references are
  -- invalid at the constraint layer, not merely forbidden by RLS.
  constraint alerts_rule_fkey
    foreign key (firm_id, alert_rule_id)
    references public.alert_rules (firm_id, id) on delete restrict,
  constraint alerts_client_fkey
    foreign key (firm_id, client_id)
    references public.clients (firm_id, id) on delete restrict,
  constraint alerts_instance_fkey
    foreign key (firm_id, compliance_instance_id)
    references public.compliance_instances (firm_id, id) on delete restrict,
  -- SCH-RESP-02: acknowledgement/resolution are ACTOR identity references —
  -- bare auth.users FKs (the tasks done_by / crv created_by precedent),
  -- never composite membership responsibility FKs (SCH-RESP-01/03 contrast).
  constraint alerts_acknowledged_by_fkey
    foreign key (acknowledged_by) references auth.users (id) on delete restrict,
  constraint alerts_resolved_by_fkey
    foreign key (resolved_by) references auth.users (id) on delete restrict
);

comment on table public.alerts is 'SCH-18: firm risk signals with hybrid resolution (DM-22). Status vocabulary active/acknowledged/snoozed/resolved; the human-ruled manual transition matrix is enforced by the Layer-B commands acknowledge_alert/snooze_alert/resolve_alert (API-R0-ALR) — direct browser writes are closed (SELECT-only grant + write guard). resolution_type=auto is reserved for the IMP-051 evaluator. Snooze expiry is a READ derivation (persisted snoozed + passed snoozed_until reads as acknowledged/active adapter-side); IMP-042 performs NO expiry writes. Composite same-firm FKs (SCH-FK-01/02); acknowledged_by/resolved_by are auth.users actor identity (SCH-RESP-02). RLS enabled AND FORCED.';

-- SCH-18 indexes: the firm queue and the raised-at scan.
create index alerts_queue_idx on public.alerts (firm_id, status, severity);
create index alerts_raised_idx on public.alerts (firm_id, raised_at);

-- ---------------------------------------------------------------------------
-- updated_at maintenance (schema convention; NOT audit).
-- ---------------------------------------------------------------------------
create trigger alert_rules_set_updated_at
  before update on public.alert_rules
  for each row execute function public.set_updated_at();

create trigger alerts_set_updated_at
  before update on public.alerts
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS posture (RLS-PRIN-01/02): enabled AND FORCED on both tenant-owned
-- content tables.
-- ---------------------------------------------------------------------------
alter table public.alert_rules enable row level security;
alter table public.alert_rules force row level security;
alter table public.alerts enable row level security;
alter table public.alerts force row level security;

-- ---------------------------------------------------------------------------
-- Grants: strip the Supabase default privileges from the browser roles.
-- anon gets nothing, ever; service_role retains its default ALL (server-only
-- paths, RLS-SVC-01/02 — the IMP-020/021/030/031/040/041 posture; the
-- IMP-051 evaluator is a service path). No browser DELETE exists on either
-- table and none is added below (alert rows and rule rows are accountability
-- records, spec 06 conventions).
-- ---------------------------------------------------------------------------
revoke all on public.alert_rules from anon, authenticated;
revoke all on public.alerts from anon, authenticated;

-- ---------------------------------------------------------------------------
-- RLS policy — alerts SELECT (RLS-ALR-01 read scope).
-- Keyed off the LIVE firm_memberships lookup (DEC-J helpers — never JWT
-- claims): suspended/removed memberships lose access on the next statement
-- with the same JWT (RLS-STF-07); x-active-firm is an untrusted selector
-- (RLS-CTX-02). Three-valued-logic rule observed: a NULL caller membership
-- makes every comparison NULL -> not true -> denied.
--   super_admin/partner/manager — firm-wide alert read;
--   senior/article              — alerts on their ASSIGNED work only, at
--                                 EXACT-INSTANCE granularity (human-ruled at
--                                 IMP-042 pre-checkpoint correction
--                                 2026-09-06 — the earlier client-granular
--                                 treatment of instance-linked alerts was
--                                 ruled TOO BROAD):
--                                 CASE A (compliance_instance_id IS NOT
--                                 NULL): visibility derives ONLY from
--                                 exact-instance relations — the caller's
--                                 live membership is THAT instance's
--                                 assignee/reviewer, OR an existing task
--                                 tied to THAT EXACT compliance instance
--                                 names the caller's live membership as
--                                 assignee/reviewer. Assigned work elsewhere
--                                 on the same client does NOT qualify;
--                                 CASE B (compliance_instance_id IS NULL AND
--                                 client_id IS NOT NULL): client-level
--                                 assigned-work scope — an existing assigned
--                                 task of the linked client, or an assigned
--                                 instance on that client (no
--                                 bootstrapping);
--                                 CASE C (both NULL): NO visibility — falls
--                                 out of the CASE A/B guards;
--   billing                     — none (RLS-STF-05); anon — no policy
--                                 (RLS-SVC-03); client portal — never
--                                 readable (RLS-POR-03; no portal rows in
--                                 R0).
-- The CASE-A instance EXISTS runs under the caller's OWN RLS-CIN-01
-- visibility and the CASE-A task EXISTS under the caller's OWN RLS-TSK-01
-- visibility (both already assignee/reviewer-scoped for senior/article, so
-- neither can ever widen; the review_items_select_scoped cross-table
-- precedent — a tasks reference inside an ALERTS policy cannot recurse, so
-- no DEC-J definer helper is needed for the CASE-A predicates). The CASE-B
-- client-level task predicate keeps the DEC-J definer helper
-- task_client_in_assigned_scope (the IMP-040/041 precedent). Composite FKs
-- guarantee the linked instance/client/task is never a cross-tenant
-- subject.
-- ---------------------------------------------------------------------------
create policy alerts_select_scoped on public.alerts
  for select to authenticated
  using (
    firm_id = public.req_active_firm()
    and (
      public.active_membership_role(firm_id) in ('super_admin', 'partner', 'manager')
      or (
        public.active_membership_role(firm_id) in ('senior', 'article_executive')
        and (
          -- CASE A — instance-linked alert: exact-instance relations ONLY
          -- (human-ruled at IMP-042 pre-checkpoint correction 2026-09-06).
          (
            alerts.compliance_instance_id is not null
            and (
              exists (
                select 1 from public.compliance_instances i
                where i.firm_id = alerts.firm_id
                  and i.id = alerts.compliance_instance_id
                  and public.active_membership_id(alerts.firm_id)
                        in (i.assignee_membership_id, i.reviewer_membership_id)
              )
              or exists (
                select 1 from public.tasks t
                where t.firm_id = alerts.firm_id
                  and t.compliance_instance_id = alerts.compliance_instance_id
                  and public.active_membership_id(alerts.firm_id)
                        in (t.assignee_membership_id, t.reviewer_membership_id)
              )
            )
          )
          -- CASE B — client-level alert (no linked instance): client-level
          -- assigned-work scope.
          or (
            alerts.compliance_instance_id is null
            and alerts.client_id is not null
            and (
              public.task_client_in_assigned_scope(alerts.firm_id, alerts.client_id)
              or exists (
                select 1 from public.compliance_instances i
                where i.firm_id = alerts.firm_id
                  and i.client_id = alerts.client_id
                  and public.active_membership_id(alerts.firm_id)
                        in (i.assignee_membership_id, i.reviewer_membership_id)
              )
            )
          )
          -- CASE C — both subject references NULL: no branch can be true.
        )
      )
    )
  );

comment on policy alerts_select_scoped on public.alerts is
  'RLS-ALR-01 read scope: super_admin/partner/manager firm-wide; senior/article assigned-work alerts only at EXACT-INSTANCE granularity (human-ruled at IMP-042 pre-checkpoint correction 2026-09-06): an instance-linked alert requires the caller''s live membership as assignee/reviewer of THAT instance or of an existing task tied to THAT exact instance; a client-level alert (instance NULL, client set) requires assigned work on that client (no bootstrapping); a both-NULL alert is invisible to senior/article; billing/anon/portal none. Live-membership (DEC-J); active-firm selector untrusted (RLS-CTX-02).';

-- ---------------------------------------------------------------------------
-- RLS policy — alert_rules SELECT (RLS-ARL-01 read scope).
--   super_admin/partner — read + (via the Layer-B commands ONLY) write;
--   manager             — read-only (expressed by the absent write grants /
--                         commands, NOT by this policy, RLS-ARL-01);
--   senior/article/billing/anon/portal — none.
-- NO insert/update/delete policy exists: rule administration is the two
-- Layer-B AAL2-gated commands below (API-ARCH-04).
-- ---------------------------------------------------------------------------
create policy alert_rules_select_scoped on public.alert_rules
  for select to authenticated
  using (
    firm_id = public.req_active_firm()
    and public.active_membership_role(firm_id) in ('super_admin', 'partner', 'manager')
  );

comment on policy alert_rules_select_scoped on public.alert_rules is
  'RLS-ARL-01 read scope: super_admin/partner/manager of the firm (manager read-only via the absent write surface); all other roles none. Writes exist only as the AAL2-gated Layer-B commands create_alert_rule/update_alert_rule (RLS-AAL-01). Live-membership (DEC-J); active-firm selector untrusted (RLS-CTX-02).';

-- ---------------------------------------------------------------------------
-- Grants (least privilege at BOTH layers): SELECT only on both tables. NO
-- insert/update/delete for any browser role — alert status moves are the
-- three Layer-B transition commands; alert-rule administration is the two
-- Layer-B AAL2-gated commands (RLS-ALR-01/RLS-ARL-01, API-ARCH-04). Alert
-- CREATION is not a browser operation in IMP-042 at all (the raiser is the
-- IMP-051 evaluator service path; R0 fixtures are operator inserts).
-- ---------------------------------------------------------------------------
grant select on public.alert_rules to authenticated;
grant select on public.alerts to authenticated;

-- ---------------------------------------------------------------------------
-- Write guard — alerts (single-writer + insert-only identity/provenance).
--   * identity/raise provenance (id, firm_id, created_at, raised_at) is
--     insert-only (IMMUTABLE_FIELD: -> conflict, tasks/review precedent);
--   * status and EVERY lifecycle stamp column (acknowledged_by/at,
--     snoozed_until, resolved_by/at, resolution_type) move ONLY under the
--     transaction-local app.alert_transition_command marker set by the
--     three Layer-B commands (RLS-ALR-01: status is never directly
--     browser-writable; the absent UPDATE grant is the primary control,
--     this guard is the second layer for EVERY writer, service paths
--     included — IMP-040/041 precedent). INVALID_TRANSITION: /
--     IMMUTABLE_FIELD: -> conflict (API-ERR-04).
-- Subject references (alert_rule_id/client_id/compliance_instance_id) need
-- no cross-column validation: SCH-18 defines no subject binding, and the
-- composite FKs pin every reference same-firm.
-- ---------------------------------------------------------------------------
create or replace function public.alerts_guard_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- coalesce: an unset GUC yields NULL and `not NULL` would silently skip
  -- the guard (three-valued logic) — the flag must be exactly '1'.
  v_command boolean := coalesce(current_setting('app.alert_transition_command', true), '') = '1';
begin
  if TG_OP = 'UPDATE' then
    if new.id is distinct from old.id
       or new.firm_id is distinct from old.firm_id
       or new.created_at is distinct from old.created_at
       or new.raised_at is distinct from old.raised_at then
      raise exception 'alert identity and raise provenance are insert-only (SCH-18)'
        using errcode = '23514', detail = 'IMMUTABLE_FIELD:alerts.identity';
    end if;

    if new.status is distinct from old.status and not v_command then
      raise exception 'alerts.status changes only through the alert transition commands (RLS-ALR-01, SCH-18)'
        using errcode = '23514', detail = 'INVALID_TRANSITION:alerts.status';
    end if;

    if (new.acknowledged_by is distinct from old.acknowledged_by
        or new.acknowledged_at is distinct from old.acknowledged_at
        or new.snoozed_until is distinct from old.snoozed_until
        or new.resolved_by is distinct from old.resolved_by
        or new.resolved_at is distinct from old.resolved_at
        or new.resolution_type is distinct from old.resolution_type)
       and not v_command then
      raise exception 'alert lifecycle stamps are written by the alert transition commands only (SCH-18, API-R0-ALR)'
        using errcode = '23514', detail = 'IMMUTABLE_FIELD:alerts.lifecycle_fields';
    end if;
  end if;

  return new;
end;
$$;

comment on function public.alerts_guard_write() is
  'IMP-042 SCH-18 write guard: identity/raise provenance insert-only; status and all lifecycle stamp columns move only under the transaction-local app.alert_transition_command marker set by acknowledge_alert/snooze_alert/resolve_alert (INVALID_TRANSITION:/IMMUTABLE_FIELD: markers -> conflict). DEFINER so enforcement never depends on caller RLS visibility under FORCE RLS. No subject-binding validation — SCH-18 defines none; composite FKs pin references same-firm.';

revoke all on function public.alerts_guard_write() from public, anon, authenticated, service_role;

create trigger alerts_guard_write
  before insert or update on public.alerts
  for each row execute function public.alerts_guard_write();

-- ---------------------------------------------------------------------------
-- Layer-B command: acknowledge_alert(uuid, text)
-- (API-R0-ALR; SCH-18 ACKNOWLEDGE matrix; RLS-ALR-01; API-MUT-03).
--
-- SECURITY DEFINER justification (API-SEC-03 — exceptional, reviewed;
-- IMP-031/040/041 precedent): alerts carries no browser UPDATE grant and
-- the write guard admits lifecycle movement only under the
-- app.alert_transition_command marker this function sets, so no INVOKER
-- variant can work. Own complete authorization: actor from auth.uid()
-- (never parameters/headers), live ACTIVE same-firm membership (DEC-J),
-- active-firm selector match (RLS-CTX-02).
--
-- AUTHORIZATION FIRST (API-ERR-02 — transition_task/decide_review_item
-- precedent): immediately after the row fetch, BEFORE state/legality/replay
-- evaluation, the gate resolves role — acknowledge is manager+
-- (super_admin/partner/manager, firm scope = the read scope); senior/
-- article are read-only (RLS-ALR-01) and billing has nothing. EVERY gate
-- failure returns the IDENTICAL not_found body as a nonexistent id; a probe
-- against an EXISTING row is audited server-side (alert.acknowledge_denied,
-- AUD-FAIL-01); a nonexistent id stays un-audited.
--
-- Matrix (SCH-18, exact):
--   active       -> acknowledged (stamps acknowledged_by=auth.uid(),
--                   acknowledged_at=now() — server-derived, API-MUT-04);
--   snoozed      -> acknowledged (stamps acknowledgement ONLY if not
--                   already stamped — acknowledge -> snooze history is
--                   preserved; clears snoozed_until);
--   acknowledged -> already_applied (state-based replay, never an error;
--                   no second stamp, no second audit);
--   resolved     -> invalid_state -> conflict (CA402, audited denial).
--
-- Errcode vocabulary (IMP-030/031/040/041 convention):
--   CA401 unauthorized  (unauthenticated check -> kind 'unauthenticated')
--   CA402 conflict      (invalid_state; audited)
-- Any other exception propagates fail-closed (AUD-CTX-05).
-- ---------------------------------------------------------------------------
create or replace function public.acknowledge_alert(
  p_alert_id uuid,
  p_mutation_key text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_alert public.alerts;
  v_new public.alerts;
  v_role text;
  v_reason text;
begin
  -- Single-writer command context (transaction-local; pooled-request safe):
  -- the write guard admits lifecycle movement only under this marker, and
  -- the Layer-A row trigger stays silent — the command's own audit row is
  -- the ONE audit event (spec 08 §7c).
  perform pg_catalog.set_config('app.alert_transition_command', '1', true);
  perform pg_catalog.set_config('app.audit_skip_trigger', '1', true);

  begin
    if (select auth.uid()) is null then
      v_reason := 'authentication required';
      raise exception 'authentication required' using errcode = 'CA401';
    end if;

    select * into v_alert
    from public.alerts a
    where a.id = p_alert_id
    for update;
    if not found then
      return jsonb_build_object(
        'status', 'denied', 'kind', 'not_found',
        'message', 'alert not found');
    end if;

    -- AUTHORIZATION FIRST (API-ERR-02): nothing below runs for a caller who
    -- may not see the alert — every failure returns the IDENTICAL not_found
    -- body as a nonexistent id. The row EXISTS here, so the attempt is a
    -- security-significant probe and IS audited server-side (AUD-FAIL-01).
    v_role := public.active_membership_role(v_alert.firm_id);

    if public.req_active_firm() is distinct from v_alert.firm_id
       or v_role is null
       or v_role not in ('super_admin', 'partner', 'manager') then
      perform public.audit_write(
        v_alert.firm_id, 'human', (select auth.uid()),
        'alert.acknowledge_denied',
        'alert', p_alert_id::text,
        null, jsonb_build_object(
          'reason', 'alert not visible to caller or role below manager (API-ERR-02, RLS-ALR-01)'));
      return jsonb_build_object(
        'status', 'denied', 'kind', 'not_found',
        'message', 'alert not found');
    end if;

    -- State-based replay (API-MUT-03, SCH-18 matrix): an already-
    -- acknowledged alert returns already_applied — no second stamp, no
    -- second audit. Only reachable by an authorized caller, so returning
    -- the row is no wider than the caller's own RLS read right.
    if v_alert.status = 'acknowledged' then
      return jsonb_build_object(
        'status', 'already_applied',
        'reason', 'already_acknowledged',
        'alert', to_jsonb(v_alert));
    end if;

    -- invalid_state (SCH-18 matrix): no acknowledge from resolved.
    if v_alert.status = 'resolved' then
      v_reason := 'invalid_state: cannot acknowledge a resolved alert (SCH-18 manual transition matrix; no reopen)';
      raise exception '%', v_reason using errcode = 'CA402';
    end if;

    update public.alerts
    set status = 'acknowledged',
        -- snoozed -> acknowledged: stamp ONLY if not already stamped
        -- (acknowledge -> snooze preserves the original acknowledgement);
        -- active -> acknowledged always stamps.
        acknowledged_by = coalesce(acknowledged_by, (select auth.uid())),
        acknowledged_at = coalesce(acknowledged_at, now()),
        -- the matrix clears the open snooze on acknowledge.
        snoozed_until = null
    where id = v_alert.id
    returning * into v_new;

    -- Authoritative Layer-B audit event, same transaction (AUD-CTX-01/05;
    -- the Layer-A trigger is skipped via app.audit_skip_trigger).
    perform public.audit_write(
      v_new.firm_id, 'human', (select auth.uid()),
      'alert.acknowledged',
      'alert', v_new.id::text,
      to_jsonb(v_alert),
      to_jsonb(v_new)
        || case when p_mutation_key is not null
             then jsonb_build_object('_mutation_key', p_mutation_key)
             else '{}'::jsonb end);

    return jsonb_build_object(
      'status', 'acknowledged',
      'from_status', v_alert.status,
      'to_status', v_new.status,
      'alert', to_jsonb(v_new));
  exception
    -- Post-authorization deliberate denials: audit the attempt
    -- (AUD-FAIL-01) and return a structured denial. The block's
    -- subtransaction has already rolled back any partial mutation.
    -- Everything else (constraint violations, audit faults, internal
    -- errors) propagates fail-closed (AUD-CTX-05).
    when sqlstate 'CA401' or sqlstate 'CA402' then
      if (select auth.uid()) is not null then
        perform public.audit_write(
          v_alert.firm_id, 'human', (select auth.uid()),
          'alert.acknowledge_denied',
          'alert', p_alert_id::text,
          null, jsonb_build_object(
            'reason', v_reason,
            'from_status', v_alert.status));
      end if;
      return jsonb_build_object(
        'status', 'denied',
        'kind', case
                  when (select auth.uid()) is null then 'unauthenticated'
                  when sqlstate = 'CA401' then 'unauthorized'
                  else 'conflict'
                end,
        'message', v_reason);
  end;
end;
$$;

comment on function public.acknowledge_alert(uuid, text) is
  'IMP-042 Layer-B alert command (API-R0-ALR, SCH-18 ACKNOWLEDGE matrix): active -> acknowledged (server-derived stamps); snoozed -> acknowledged (stamps only if unstamped, clears snoozed_until); acknowledged -> already_applied (state-based replay, no re-audit); resolved -> invalid_state conflict. Authorization FIRST — pre-authorization failures return the API-ERR-02 not_found surface (audited alert.acknowledge_denied when the row exists); acknowledge is manager+ (RLS-ALR-01); senior/article read-only. Atomic mutation + Layer-B audit; denials audited (AUD-FAIL-01). NO AAL2 (routine operational action, RLS-AAL-02).';

revoke all on function public.acknowledge_alert(uuid, text) from public, anon, service_role;
grant execute on function public.acknowledge_alert(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Layer-B command: snooze_alert(uuid, timestamptz, text)
-- (API-R0-ALR; SCH-18 SNOOZE matrix; RLS-ALR-01; API-MUT-03).
--
-- Same SECURITY DEFINER justification, own-authorization, and
-- authorization-before-disclosure posture as acknowledge_alert.
--
-- Matrix (SCH-18, exact):
--   active | acknowledged | snoozed -> snoozed;
--   p_snoozed_until MUST be in the future — otherwise CA400 validation
--   (client error, never security-significant — un-audited, transition_task
--   vocabulary convention);
--   prior acknowledged_by/acknowledged_at are PRESERVED (acknowledge ->
--   snooze keeps the stamp — the acknowledged_at history is what later
--   gates an explicit-ack resolve);
--   an IDENTICAL already-applied snooze (persisted status='snoozed' with
--   the same snoozed_until) returns already_applied — no rewrite, no
--   second audit;
--   a CHANGED valid snoozed_until is a real audited update;
--   resolved -> invalid_state -> conflict (CA402, audited denial).
-- The replay check precedes future-validation so a state-identical retry is
-- already_applied per API-MUT-03; every non-identical snooze target is
-- validated future-only. Commands against an expired persisted snooze
-- (snoozed_until <= now()) behave identically — expiry is a read
-- derivation, never a command input (SCH-18; TEST-API-18).
-- ---------------------------------------------------------------------------
create or replace function public.snooze_alert(
  p_alert_id uuid,
  p_snoozed_until timestamptz default null,
  p_mutation_key text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_alert public.alerts;
  v_new public.alerts;
  v_role text;
  v_reason text;
begin
  -- Single-writer command context (transaction-local; pooled-request safe).
  perform pg_catalog.set_config('app.alert_transition_command', '1', true);
  perform pg_catalog.set_config('app.audit_skip_trigger', '1', true);

  begin
    if (select auth.uid()) is null then
      v_reason := 'authentication required';
      raise exception 'authentication required' using errcode = 'CA401';
    end if;

    select * into v_alert
    from public.alerts a
    where a.id = p_alert_id
    for update;
    if not found then
      return jsonb_build_object(
        'status', 'denied', 'kind', 'not_found',
        'message', 'alert not found');
    end if;

    -- AUTHORIZATION FIRST (API-ERR-02): identical not_found for
    -- existing-but-hidden and nonexistent; the existing-row probe IS
    -- audited (AUD-FAIL-01). Snooze is manager+ (RLS-ALR-01).
    v_role := public.active_membership_role(v_alert.firm_id);

    if public.req_active_firm() is distinct from v_alert.firm_id
       or v_role is null
       or v_role not in ('super_admin', 'partner', 'manager') then
      perform public.audit_write(
        v_alert.firm_id, 'human', (select auth.uid()),
        'alert.snooze_denied',
        'alert', p_alert_id::text,
        null, jsonb_build_object(
          'reason', 'alert not visible to caller or role below manager (API-ERR-02, RLS-ALR-01)'));
      return jsonb_build_object(
        'status', 'denied', 'kind', 'not_found',
        'message', 'alert not found');
    end if;

    -- State-based replay (API-MUT-03, SCH-18 matrix): the identical
    -- already-applied snooze returns already_applied — no rewrite, no
    -- second audit.
    if v_alert.status = 'snoozed'
       and v_alert.snoozed_until is not null
       and v_alert.snoozed_until = p_snoozed_until then
      return jsonb_build_object(
        'status', 'already_applied',
        'reason', 'snooze_already_applied',
        'alert', to_jsonb(v_alert));
    end if;

    -- Future-only validation (CA400 -> validation): post-gate, so it can
    -- never leak existence/state to an unauthorized caller.
    if p_snoozed_until is null or p_snoozed_until <= now() then
      v_reason := 'snoozed_until must be in the future (SCH-18 SNOOZE matrix)';
      raise exception '%', v_reason using errcode = 'CA400';
    end if;

    -- invalid_state (SCH-18 matrix): no snooze from resolved.
    if v_alert.status = 'resolved' then
      v_reason := 'invalid_state: cannot snooze a resolved alert (SCH-18 manual transition matrix; no reopen)';
      raise exception '%', v_reason using errcode = 'CA402';
    end if;

    update public.alerts
    set status = 'snoozed',
        snoozed_until = p_snoozed_until
        -- acknowledged_by/acknowledged_at untouched: a prior
        -- acknowledgement is preserved through snooze (SCH-18).
    where id = v_alert.id
    returning * into v_new;

    -- Authoritative Layer-B audit event, same transaction.
    perform public.audit_write(
      v_new.firm_id, 'human', (select auth.uid()),
      'alert.snoozed',
      'alert', v_new.id::text,
      to_jsonb(v_alert),
      to_jsonb(v_new)
        || case when p_mutation_key is not null
             then jsonb_build_object('_mutation_key', p_mutation_key)
             else '{}'::jsonb end);

    return jsonb_build_object(
      'status', 'snoozed',
      'from_status', v_alert.status,
      'to_status', v_new.status,
      'alert', to_jsonb(v_new));
  exception
    -- Malformed input: client error, not a security-significant denial.
    when sqlstate 'CA400' then
      return jsonb_build_object('status', 'denied', 'kind', 'validation', 'message', v_reason);
    -- Post-authorization deliberate denials: audited (AUD-FAIL-01);
    -- everything else propagates fail-closed (AUD-CTX-05).
    when sqlstate 'CA401' or sqlstate 'CA402' then
      if (select auth.uid()) is not null then
        perform public.audit_write(
          v_alert.firm_id, 'human', (select auth.uid()),
          'alert.snooze_denied',
          'alert', p_alert_id::text,
          null, jsonb_build_object(
            'reason', v_reason,
            'from_status', v_alert.status));
      end if;
      return jsonb_build_object(
        'status', 'denied',
        'kind', case
                  when (select auth.uid()) is null then 'unauthenticated'
                  when sqlstate = 'CA401' then 'unauthorized'
                  else 'conflict'
                end,
        'message', v_reason);
  end;
end;
$$;

comment on function public.snooze_alert(uuid, timestamp with time zone, text) is
  'IMP-042 Layer-B alert command (API-R0-ALR, SCH-18 SNOOZE matrix): active|acknowledged|snoozed -> snoozed with a strictly future snoozed_until (else validation); prior acknowledgement stamps preserved; identical already-applied snooze -> already_applied (state-based replay, no re-audit); changed valid snoozed_until -> real audited update; resolved -> invalid_state conflict. Authorization FIRST (API-ERR-02 not_found surface; probes audited alert.snooze_denied, AUD-FAIL-01); snooze is manager+ (RLS-ALR-01). Expiry is a READ derivation — this command never consults it (TEST-API-18). NO AAL2 (RLS-AAL-02).';

revoke all on function public.snooze_alert(uuid, timestamp with time zone, text) from public, anon, service_role;
grant execute on function public.snooze_alert(uuid, timestamp with time zone, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Layer-B command: resolve_alert(uuid, text)
-- (API-R0-ALR; SCH-18 RESOLVE matrix; RLS-ALR-01; API-MUT-03).
--
-- Same SECURITY DEFINER justification, own-authorization, and
-- authorization-before-disclosure posture as acknowledge_alert.
--
-- Matrix (SCH-18, exact):
--   active | acknowledged | snoozed -> resolved with
--     resolution_type='manual', resolved_by=auth.uid(), resolved_at=now()
--     (server-derived, API-MUT-04); acknowledgement and snooze history
--     columns are retained as history;
--   manual resolve is super_admin/partner/manager ONLY (RLS-ALR-01,
--   API-R0-ALR) — the same firm-scope gate as acknowledge/snooze;
--   explicit-ack gate (resolve per rule config, RLS-ALR-01): where the
--   linked rule's requires_explicit_ack=true, manual resolve requires
--   acknowledged_at IS NOT NULL — acknowledgement-HISTORY based, not
--   status-based (an acknowledged alert may subsequently be snoozed; the
--   persisted expired-snooze derivation likewise derives from
--   acknowledged_at, TEST-API-17/18). Alerts with NO linked rule carry no
--   gate. The rule row is read under definer rights but is pinned same-firm
--   by the composite FK — no cross-tenant read is possible;
--   resolved -> already_applied (state-based replay, never an error; no
--     second resolution, no second audit);
--   NO reopen transition exists in IMP-042 (nothing below writes any other
--   status); resolution_type='auto' is not writable here at all — the
--   parameter list carries no resolution_type (a caller-supplied key is a
--   PostgREST signature mismatch, API-MUT-04); 'auto' is reserved for the
--   IMP-051 evaluator.
-- ---------------------------------------------------------------------------
create or replace function public.resolve_alert(
  p_alert_id uuid,
  p_mutation_key text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_alert public.alerts;
  v_new public.alerts;
  v_role text;
  v_requires_ack boolean;
  v_reason text;
begin
  -- Single-writer command context (transaction-local; pooled-request safe).
  perform pg_catalog.set_config('app.alert_transition_command', '1', true);
  perform pg_catalog.set_config('app.audit_skip_trigger', '1', true);

  begin
    if (select auth.uid()) is null then
      v_reason := 'authentication required';
      raise exception 'authentication required' using errcode = 'CA401';
    end if;

    select * into v_alert
    from public.alerts a
    where a.id = p_alert_id
    for update;
    if not found then
      return jsonb_build_object(
        'status', 'denied', 'kind', 'not_found',
        'message', 'alert not found');
    end if;

    -- AUTHORIZATION FIRST (API-ERR-02): identical not_found for
    -- existing-but-hidden and nonexistent; the existing-row probe IS
    -- audited (AUD-FAIL-01). Manual resolve is super_admin/partner/manager
    -- ONLY (RLS-ALR-01, API-R0-ALR); senior/article read-only, billing none.
    v_role := public.active_membership_role(v_alert.firm_id);

    if public.req_active_firm() is distinct from v_alert.firm_id
       or v_role is null
       or v_role not in ('super_admin', 'partner', 'manager') then
      perform public.audit_write(
        v_alert.firm_id, 'human', (select auth.uid()),
        'alert.resolve_denied',
        'alert', p_alert_id::text,
        null, jsonb_build_object(
          'reason', 'alert not visible to caller or role below manager (API-ERR-02, RLS-ALR-01)'));
      return jsonb_build_object(
        'status', 'denied', 'kind', 'not_found',
        'message', 'alert not found');
    end if;

    -- State-based replay (API-MUT-03, SCH-18 matrix): already resolved
    -- returns already_applied — no second resolution, no second audit.
    if v_alert.status = 'resolved' then
      return jsonb_build_object(
        'status', 'already_applied',
        'reason', 'already_resolved',
        'alert', to_jsonb(v_alert));
    end if;

    -- Explicit-ack gate (RLS-ALR-01 "resolve per rule config"; SCH-18):
    -- derived from the TRUSTED linked rule row (same-firm pinned by the
    -- composite FK), never caller input; acknowledgement-HISTORY based
    -- (acknowledged_at IS NOT NULL), not status-based.
    if v_alert.alert_rule_id is not null then
      select r.requires_explicit_ack into v_requires_ack
      from public.alert_rules r
      where r.firm_id = v_alert.firm_id
        and r.id = v_alert.alert_rule_id;
      if coalesce(v_requires_ack, false) and v_alert.acknowledged_at is null then
        v_reason := 'invalid_state: this rule requires explicit acknowledgement before manual resolve (requires_explicit_ack=true, acknowledged_at IS NULL)';
        raise exception '%', v_reason using errcode = 'CA402';
      end if;
    end if;

    update public.alerts
    set status = 'resolved',
        resolved_by = (select auth.uid()),
        resolved_at = now(),
        resolution_type = 'manual'
        -- acknowledged_*/snoozed_until untouched: history is retained.
    where id = v_alert.id
    returning * into v_new;

    -- Authoritative Layer-B audit event, same transaction.
    perform public.audit_write(
      v_new.firm_id, 'human', (select auth.uid()),
      'alert.resolved',
      'alert', v_new.id::text,
      to_jsonb(v_alert),
      to_jsonb(v_new)
        || case when p_mutation_key is not null
             then jsonb_build_object('_mutation_key', p_mutation_key)
             else '{}'::jsonb end);

    return jsonb_build_object(
      'status', 'resolved',
      'from_status', v_alert.status,
      'to_status', v_new.status,
      'alert', to_jsonb(v_new));
  exception
    -- Post-authorization deliberate denials: audited (AUD-FAIL-01);
    -- everything else propagates fail-closed (AUD-CTX-05).
    when sqlstate 'CA401' or sqlstate 'CA402' then
      if (select auth.uid()) is not null then
        perform public.audit_write(
          v_alert.firm_id, 'human', (select auth.uid()),
          'alert.resolve_denied',
          'alert', p_alert_id::text,
          null, jsonb_build_object(
            'reason', v_reason,
            'from_status', v_alert.status));
      end if;
      return jsonb_build_object(
        'status', 'denied',
        'kind', case
                  when (select auth.uid()) is null then 'unauthenticated'
                  when sqlstate = 'CA401' then 'unauthorized'
                  else 'conflict'
                end,
        'message', v_reason);
  end;
end;
$$;

comment on function public.resolve_alert(uuid, text) is
  'IMP-042 Layer-B alert command (API-R0-ALR, SCH-18 RESOLVE matrix): active|acknowledged|snoozed -> resolved with resolution_type=manual and server-derived resolved_by/at; explicit-ack gate — linked rule with requires_explicit_ack=true requires acknowledged_at IS NOT NULL (history-based, not status-based); resolved -> already_applied (state-based replay, no re-audit); no reopen; resolution_type=auto not writable (IMP-051 evaluator only). Authorization FIRST (API-ERR-02 not_found surface; probes audited alert.resolve_denied, AUD-FAIL-01); manual resolve is super_admin/partner/manager only (RLS-ALR-01). NO AAL2 (RLS-AAL-02).';

revoke all on function public.resolve_alert(uuid, text) from public, anon, service_role;
grant execute on function public.resolve_alert(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Layer-B command: create_alert_rule(text, text, text, jsonb, boolean,
-- boolean, boolean) (RLS-ARL-01 write scope; RLS-AAL-01 step-up;
-- AUD-CAT-01 alert-rule changes; API-R0-ALR).
--
-- The ONLY rule-creation path. SECURITY DEFINER justification (API-SEC-03
-- — exceptional, reviewed; IMP-013/030 precedent): alert_rules carries no
-- browser INSERT grant, so no INVOKER variant can work. Own complete
-- authorization: actor from auth.uid(), live ACTIVE same-firm
-- super_admin/partner membership (DEC-J), active-firm selector match
-- (RLS-CTX-02), AAL2 step-up (RLS-AAL-01 — alert-rule administration is a
-- security-configuration change; AAL is an authentication-assurance claim
-- read from the JWT, not tenant data).
--
-- Server-derived, never caller-supplied: firm_id (the validated active-firm
-- context), id/created_at (column defaults). The parameter list carries no
-- firm/actor fields at all (API-MUT-04).
--
-- Denial posture (IMP-030 activate_compliance_rule_version precedent for
-- AAL2-gated administration): nonexistent context / wrong role / AAL1 are
-- deliberate CA401 denials — audited when a human identity exists
-- (alert_rule.create_denied, AUD-FAIL-01); a duplicate (firm_id, rule_key)
-- is a CA402 conflict (SCH-19 uniqueness). Business-input validation
-- (rule_key/name/severity shape — public knowledge) is CA400, un-audited.
-- ---------------------------------------------------------------------------
create or replace function public.create_alert_rule(
  p_rule_key text,
  p_name text,
  p_severity text,
  p_config jsonb default '{}',
  p_enabled boolean default true,
  p_auto_resolve boolean default true,
  p_requires_explicit_ack boolean default false
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  c_severities constant text[] := array['info', 'warning', 'critical'];
  v_firm uuid;
  v_role text;
  v_rule public.alert_rules;
  v_reason text;
begin
  -- Single-writer audit context: the command's own audit row is the ONE
  -- audit event (spec 08 §7c); the Layer-A trigger stays silent.
  perform pg_catalog.set_config('app.audit_skip_trigger', '1', true);

  begin
    if (select auth.uid()) is null then
      v_reason := 'authentication required';
      raise exception 'authentication required' using errcode = 'CA401';
    end if;

    -- Business-input validation (CA400 -> validation): the rule shape is
    -- public knowledge — no tenant disclosure.
    if p_rule_key is null or btrim(p_rule_key) = '' then
      v_reason := 'rule_key is required (SCH-19)';
      raise exception '%', v_reason using errcode = 'CA400';
    end if;
    if p_name is null or btrim(p_name) = '' then
      v_reason := 'name is required (SCH-19)';
      raise exception '%', v_reason using errcode = 'CA400';
    end if;
    if p_severity is null or not (p_severity = any(c_severities)) then
      v_reason := format('unknown severity %L (SCH-18/19 vocabulary)', p_severity);
      raise exception '%', v_reason using errcode = 'CA400';
    end if;

    -- Authoritative tenant context: the untrusted selector validated
    -- against a live ACTIVE membership (RLS-CTX-02, DEC-J).
    v_firm := public.req_active_firm();
    v_role := public.active_membership_role(v_firm);
    -- NULL role (no ACTIVE membership — suspended/removed/foreign) must be
    -- denied explicitly: `NOT IN` over a NULL yields NULL, and IF treats
    -- NULL as false — a bare `not in` check would silently PASS.
    if v_firm is null or v_role is null or v_role not in ('super_admin', 'partner') then
      v_reason := 'alert-rule administration requires super_admin/partner (RLS-ARL-01)';
      raise exception '%', v_reason using errcode = 'CA401';
    end if;

    if (select auth.jwt() ->> 'aal') is distinct from 'aal2' then
      v_reason := 'AAL2 step-up required for alert-rule administration (RLS-AAL-01)';
      raise exception '%', v_reason using errcode = 'CA401';
    end if;

    -- SCH-19 uniqueness as a deliberate conflict (the unique constraint is
    -- the last-line backstop for the race).
    if exists (
      select 1 from public.alert_rules r
      where r.firm_id = v_firm and r.rule_key = btrim(p_rule_key)) then
      v_reason := format('an alert rule with rule_key %L already exists in this firm (SCH-19 uniqueness)', p_rule_key);
      raise exception '%', v_reason using errcode = 'CA402';
    end if;

    insert into public.alert_rules (
      firm_id, rule_key, name, severity, config,
      enabled, auto_resolve, requires_explicit_ack
    ) values (
      v_firm, btrim(p_rule_key), btrim(p_name), p_severity,
      coalesce(p_config, '{}'::jsonb),
      coalesce(p_enabled, true), coalesce(p_auto_resolve, true),
      coalesce(p_requires_explicit_ack, false)
    ) returning * into v_rule;

    -- Authoritative Layer-B audit event, same transaction (AUD-CAT-01:
    -- every alert-rule change audited).
    perform public.audit_write(
      v_rule.firm_id, 'human', (select auth.uid()),
      'alert_rule.created',
      'alert_rule', v_rule.id::text,
      null, to_jsonb(v_rule));

    return jsonb_build_object(
      'status', 'created',
      'rule', to_jsonb(v_rule));
  exception
    -- Malformed input: client error, not a security-significant denial.
    when sqlstate 'CA400' then
      return jsonb_build_object('status', 'denied', 'kind', 'validation', 'message', v_reason);
    -- Deliberate denials: audited when a human identity exists; everything
    -- else (incl. the unique-violation race) propagates fail-closed
    -- (AUD-CTX-05).
    when sqlstate 'CA401' or sqlstate 'CA402' then
      if (select auth.uid()) is not null then
        perform public.audit_write(
          v_firm, 'human', (select auth.uid()),
          'alert_rule.create_denied',
          'alert_rule', null,
          null, jsonb_build_object('reason', v_reason, 'rule_key', p_rule_key));
      end if;
      return jsonb_build_object(
        'status', 'denied',
        'kind', case
                  when (select auth.uid()) is null then 'unauthenticated'
                  when sqlstate = 'CA401' then 'unauthorized'
                  else 'conflict'
                end,
        'message', v_reason);
  end;
end;
$$;

comment on function public.create_alert_rule(text, text, text, jsonb, boolean, boolean, boolean) is
  'IMP-042 Layer-B alert-rule administration (RLS-ARL-01): the ONLY alert_rules insert path. auth.uid() + live ACTIVE same-firm super_admin/partner + active-firm selector + AAL2 step-up (RLS-AAL-01); server-derived firm_id; SCH-19 (firm_id, rule_key) uniqueness as a conflict; atomic mutation + Layer-B audit (alert_rule.created, AUD-CAT-01); denials audited (alert_rule.create_denied, AUD-FAIL-01).';

revoke all on function public.create_alert_rule(text, text, text, jsonb, boolean, boolean, boolean) from public, anon, service_role;
grant execute on function public.create_alert_rule(text, text, text, jsonb, boolean, boolean, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Layer-B command: update_alert_rule(uuid, text, text, jsonb, boolean,
-- boolean, boolean) (RLS-ARL-01 write scope; RLS-AAL-01; AUD-CAT-01).
--
-- The ONLY rule-change path (name/severity/config/enabled/auto_resolve/
-- requires_explicit_ack — the full mutable set, PATCH-style: a NULL
-- parameter keeps the current value, unambiguous because every target
-- column is NOT NULL; rule_key and firm_id are insert-only identity:
-- renaming a key is delete-and-recreate semantics, and IMP-042 ships no
-- delete). Same definer justification and own-authorization posture as
-- create_alert_rule. A nonexistent id returns
-- not_found un-audited (API-ERR-02 — no object to bind); an existing row
-- addressed from the wrong firm, role, or assurance level is an audited
-- CA401 denial (activate_compliance_rule_version precedent — the AAL2-gated
-- administration command family), never a silent no-op.
-- ---------------------------------------------------------------------------
create or replace function public.update_alert_rule(
  p_rule_id uuid,
  p_name text default null,
  p_severity text default null,
  p_config jsonb default null,
  p_enabled boolean default null,
  p_auto_resolve boolean default null,
  p_requires_explicit_ack boolean default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  c_severities constant text[] := array['info', 'warning', 'critical'];
  v_rule public.alert_rules;
  v_new public.alert_rules;
  v_role text;
  v_reason text;
begin
  perform pg_catalog.set_config('app.audit_skip_trigger', '1', true);

  begin
    if (select auth.uid()) is null then
      v_reason := 'authentication required';
      raise exception 'authentication required' using errcode = 'CA401';
    end if;

    select * into v_rule
    from public.alert_rules r
    where r.id = p_rule_id
    for update;
    if not found then
      return jsonb_build_object(
        'status', 'denied', 'kind', 'not_found',
        'message', 'alert rule not found');
    end if;

    -- Authorization (RLS-ARL-01 + RLS-CTX-02 + RLS-AAL-01): active-firm
    -- selector must match the row's firm; caller must hold a live ACTIVE
    -- super_admin/partner membership THERE; AAL2 required. Every failure is
    -- an audited deliberate denial (AUD-FAIL-01).
    if public.req_active_firm() is distinct from v_rule.firm_id then
      v_reason := 'active-firm context does not match the rule''s firm (RLS-CTX-02)';
      raise exception '%', v_reason using errcode = 'CA401';
    end if;

    v_role := public.active_membership_role(v_rule.firm_id);
    if v_role is null or v_role not in ('super_admin', 'partner') then
      v_reason := 'alert-rule administration requires super_admin/partner (RLS-ARL-01)';
      raise exception '%', v_reason using errcode = 'CA401';
    end if;

    if (select auth.jwt() ->> 'aal') is distinct from 'aal2' then
      v_reason := 'AAL2 step-up required for alert-rule administration (RLS-AAL-01)';
      raise exception '%', v_reason using errcode = 'CA401';
    end if;

    -- Business-input validation (CA400 -> validation), post-authorization.
    -- NULL parameters keep the current value (patch semantics); a SUPPLIED
    -- blank name / unknown severity is malformed input.
    if p_name is not null and btrim(p_name) = '' then
      v_reason := 'name must be non-empty when supplied (SCH-19)';
      raise exception '%', v_reason using errcode = 'CA400';
    end if;
    if p_severity is not null and not (p_severity = any(c_severities)) then
      v_reason := format('unknown severity %L (SCH-18/19 vocabulary)', p_severity);
      raise exception '%', v_reason using errcode = 'CA400';
    end if;

    update public.alert_rules
    set name = coalesce(btrim(p_name), name),
        severity = coalesce(p_severity, severity),
        config = coalesce(p_config, config),
        enabled = coalesce(p_enabled, enabled),
        auto_resolve = coalesce(p_auto_resolve, auto_resolve),
        requires_explicit_ack = coalesce(p_requires_explicit_ack, requires_explicit_ack)
    where id = v_rule.id
    returning * into v_new;

    -- Authoritative Layer-B audit event with old/new snapshots (AUD-CAT-01,
    -- AUD-VAL-01), same transaction.
    perform public.audit_write(
      v_new.firm_id, 'human', (select auth.uid()),
      'alert_rule.updated',
      'alert_rule', v_new.id::text,
      to_jsonb(v_rule), to_jsonb(v_new));

    return jsonb_build_object(
      'status', 'updated',
      'rule', to_jsonb(v_new));
  exception
    -- Malformed input: client error, not a security-significant denial.
    when sqlstate 'CA400' then
      return jsonb_build_object('status', 'denied', 'kind', 'validation', 'message', v_reason);
    -- Deliberate denials: audited when a human identity exists; everything
    -- else propagates fail-closed (AUD-CTX-05).
    when sqlstate 'CA401' or sqlstate 'CA402' then
      if (select auth.uid()) is not null then
        perform public.audit_write(
          v_rule.firm_id, 'human', (select auth.uid()),
          'alert_rule.update_denied',
          'alert_rule', p_rule_id::text,
          null, jsonb_build_object('reason', v_reason));
      end if;
      return jsonb_build_object(
        'status', 'denied',
        'kind', case
                  when (select auth.uid()) is null then 'unauthenticated'
                  when sqlstate = 'CA401' then 'unauthorized'
                  else 'conflict'
                end,
        'message', v_reason);
  end;
end;
$$;

comment on function public.update_alert_rule(uuid, text, text, jsonb, boolean, boolean, boolean) is
  'IMP-042 Layer-B alert-rule administration (RLS-ARL-01): the ONLY alert_rules update path (name/severity/config/enabled/auto_resolve/requires_explicit_ack, PATCH-style — a NULL parameter keeps the current value; rule_key/firm_id insert-only). auth.uid() + live ACTIVE same-firm super_admin/partner + active-firm selector + AAL2 step-up (RLS-AAL-01); nonexistent id -> un-audited not_found (API-ERR-02); wrong firm/role/assurance -> audited denial (AUD-FAIL-01); atomic mutation + Layer-B audit with old/new snapshots (alert_rule.updated, AUD-CAT-01/AUD-VAL-01).';

revoke all on function public.update_alert_rule(uuid, text, text, jsonb, boolean, boolean, boolean) from public, anon, service_role;
grant execute on function public.update_alert_rule(uuid, text, text, jsonb, boolean, boolean, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Layer-A audit mapping (spec 08 §7c): alerts is MEDIUM-HIGH, alert_rules
-- HIGH audit sensitivity (SCH-18/19). The commands above set
-- app.audit_skip_trigger and write the authoritative Layer-B rows themselves
-- — one command never double-logs across layers. Residual non-command
-- writes (operator/service paths — including R0 fixture inserts and the
-- future IMP-051 evaluator) get baseline trigger capture with old/new
-- snapshots (AUD-VAL-01). The mapping is extended via the established
-- create-or-replace mechanism (IMP-020/021/030/031/040/041 precedent) —
-- committed migration files stay immutable.
-- AUD-VAL-02 redaction review for SCH-18/19: severity/title/detail/status/
-- stamps/rule configuration are exactly what the audit trail must preserve;
-- no secrets-adjacent columns exist; none redacted.
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
  -- IMP-030 compliance rules (SCH-10/32): hybrid reference data; NULL firm
  -- is the AUD-EVT-03 platform marker for system-default rows.
  elsif TG_TABLE_NAME = 'compliance_types' then
    v_firm_id := coalesce(new.firm_id, old.firm_id);
    v_object_type := 'compliance_type';
    v_object_id := coalesce(new.id, old.id)::text;
  elsif TG_TABLE_NAME = 'compliance_rule_versions' then
    v_firm_id := coalesce(new.firm_id, old.firm_id);
    v_object_type := 'compliance_rule_version';
    v_object_id := coalesce(new.id, old.id)::text;
  -- IMP-031 compliance profiles/instances (SCH-11/12): tenant-owned, firm
  -- from the row.
  elsif TG_TABLE_NAME = 'client_compliance_profiles' then
    v_firm_id := coalesce(new.firm_id, old.firm_id);
    v_object_type := 'compliance_profile';
    v_object_id := coalesce(new.id, old.id)::text;
  elsif TG_TABLE_NAME = 'compliance_instances' then
    v_firm_id := coalesce(new.firm_id, old.firm_id);
    v_object_type := 'compliance_instance';
    v_object_id := coalesce(new.id, old.id)::text;
  -- IMP-040 task family (SCH-13/15/16): tenant-owned, firm from the row.
  -- task_dependencies is deliberately UNMAPPED — the Layer-B commands own
  -- the dependency graph's audit (spec 08 §7b).
  elsif TG_TABLE_NAME = 'tasks' then
    v_firm_id := coalesce(new.firm_id, old.firm_id);
    v_object_type := 'task';
    v_object_id := coalesce(new.id, old.id)::text;
  elsif TG_TABLE_NAME = 'task_checklist_items' then
    v_firm_id := coalesce(new.firm_id, old.firm_id);
    v_object_type := 'task_checklist_item';
    v_object_id := coalesce(new.id, old.id)::text;
  elsif TG_TABLE_NAME = 'task_comments' then
    v_firm_id := coalesce(new.firm_id, old.firm_id);
    v_object_type := 'task_comment';
    v_object_id := coalesce(new.id, old.id)::text;
  -- IMP-041 review items (SCH-17): tenant-owned, firm from the row.
  elsif TG_TABLE_NAME = 'review_items' then
    v_firm_id := coalesce(new.firm_id, old.firm_id);
    v_object_type := 'review_item';
    v_object_id := coalesce(new.id, old.id)::text;
  -- IMP-042 alerts family (SCH-18/19): tenant-owned, firm from the row.
  elsif TG_TABLE_NAME = 'alerts' then
    v_firm_id := coalesce(new.firm_id, old.firm_id);
    v_object_type := 'alert';
    v_object_id := coalesce(new.id, old.id)::text;
  elsif TG_TABLE_NAME = 'alert_rules' then
    v_firm_id := coalesce(new.firm_id, old.firm_id);
    v_object_type := 'alert_rule';
    v_object_id := coalesce(new.id, old.id)::text;
  else
    -- Defense in depth: this trigger must only ever be attached to the
    -- mapped tables above.
    raise exception 'audit_trg_row attached to unmapped table %', TG_TABLE_NAME
      using errcode = 'P0001';
  end if;

  -- AUD-VAL-01: old+new for UPDATE, NEW only for INSERT, OLD only for DELETE.
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
  'IMP-013 Layer-A audit trigger (AUD-CTX-01), mapping extended by IMP-020 (SCH-04…08), IMP-021 (SCH-09), IMP-030 (SCH-10/32), IMP-031 (SCH-11/12), IMP-040 (SCH-13/15/16 — task_dependencies deliberately unmapped; the Layer-B commands own graph audit), IMP-041 (SCH-17 — review_items), and IMP-042 (SCH-18/19 — alerts + alert_rules; the Layer-B transition/administration commands own the authoritative alert audit via the skip flag). Actor from auth.uid()/jwt role only; firm/object from the row. DEFINER solely so application roles without audit_log INSERT privilege can be audited; owner-only EXECUTE.';

create trigger alert_rules_audit_row
  after insert or update or delete on public.alert_rules
  for each row execute function public.audit_trg_row();

create trigger alerts_audit_row
  after insert or update or delete on public.alerts
  for each row execute function public.audit_trg_row();

-- ---------------------------------------------------------------------------
-- Notes for reviewers
-- ---------------------------------------------------------------------------
-- * No INSERT/UPDATE/DELETE exists for any browser role on alerts or
--   alert_rules — SELECT is the whole table surface; the five Layer-B
--   commands are the complete write contract (API-ARCH-04). Hard delete
--   stays closed for both tables (spec 06 conventions).
-- * resolution_type='auto' is writable by NO IMP-042 path: the commands
--   write 'manual' only, browser grants are SELECT-only, and the IMP-051
--   evaluator will be a service_role path (its own package).
-- * Snooze expiry (SCH-18; TEST-API-18): IMP-042 performs NO expiry writes
--   — no scheduler, no normalization. A plain SELECT exposes the persisted
--   columns (status, snoozed_until, acknowledged_at) exactly as stored, so
--   the adapter read path can derive the effective status (persisted
--   snoozed + snoozed_until <= now() reads as acknowledged when
--   acknowledged_at IS NOT NULL, else active); the transition commands are
--   status-based and remain correct against an expired persisted row.
-- * The alert transition commands perform NO event publication
--   (alert.raised/resolved stay contract names only; the AUTO-OQ-02
--   mechanism is IMP-050).
-- * The x-active-firm selector is untrusted context everywhere: without a
--   live ACTIVE membership it selects nothing (RLS-CTX-02), and
--   suspended/removed memberships authorize nothing on the next statement
--   with the same JWT (DEC-J, RLS-STF-07).
