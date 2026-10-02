-- ============================================================================
-- IMP-062 — Limited Realtime (R1-B; API-RT-01…07; IMP062-R1/R3 + H2/H3)
--
-- True push freshness for EXACTLY the two approved API-RT-01 surfaces:
--   (a) review queue count/list  (topic suffix: review_queue)
--   (b) alert badge/count        (topic suffix: alerts)
--
-- Transport (R1-B, independently reviewed):
--   application-table mutation (INSERT / UPDATE-of-status)
--   → AFTER trigger (SECURITY DEFINER, search_path='')
--   → realtime.send(..., private := true)
--   → PRIVATE firm-scoped topic  firm:<firm_uuid>:<surface>
--   → realtime.messages RLS authorization (this migration)
--   → client receives a bare INVALIDATION
--   → authoritative @/data re-read under the existing app-table RLS
--   → UI update
--
-- Contract pins honored here:
--   * INVALIDATION-ONLY payloads {id, kind, firm_id} — a SECURITY invariant.
--     No counts, no row content, no business data; the client never renders
--     state from a payload (API-RT-03/05).
--   * Topic authorization is MEMBERSHIP-SCOPED (H2): the SELECT policy
--     requires a live ACTIVE membership of auth.uid() in the firm encoded
--     in the topic — exactly the DEC-J live-membership shape. The
--     x-active-firm selector is application context only and is NOT part of
--     Realtime authorization (none is possible on a websocket join; none is
--     needed — the authoritative re-read still flows through the
--     header-scoped app-table RLS).
--   * Fail closed: strict topic-structure regex gate BEFORE the uuid cast;
--     realtime.messages ships RLS ENABLED with ZERO policies (deny-all) —
--     this migration adds exactly ONE permissive SELECT policy and ONE
--     deny-all INSERT policy. No further permissive realtime.messages
--     policy may be added without review.
--   * Browser roles may NEVER publish: INSERT with check (false). Broadcasts
--     originate only from these definer triggers (the function owner
--     bypasses RLS on realtime.messages; business-write authorization stays
--     at the app-table RLS/Layer-B commands, unchanged).
--   * DML coverage (minimal set for the two read models): review_items
--     INSERT + UPDATE OF status; alerts INSERT + UPDATE OF status. No
--     DELETE coverage (queue/alert freshness never depends on deletes in
--     R0), no broadcasts on unrelated column updates.
--   * A broadcast failure must NEVER fail the business transaction
--     (contained by the exception block below).
--
-- Explicitly NOT done (contract non-goals): no postgres_changes, no
-- publication/REPLICA IDENTITY change, no app-table RLS or JWT change, no
-- req_active_firm() change, no event_outbox coupling (AUTO-FLOW-05), no new
-- table/view/RPC, no firm-switch rebuild machinery (IMP062-R3).
--
-- Rollback-safe: drop the two triggers, the two functions and the two
-- policies; app tables, data and app-table RLS are untouched, and the
-- polling fallback keeps the surfaces fresh throughout.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Broadcast trigger functions (one per approved surface).
--    SECURITY DEFINER so the trigger owner can realtime.send into the
--    private topic; pinned empty search_path; fully qualified objects; no
--    caller-controlled SQL. Trigger-invoked only — EXECUTE revoked below.
-- ---------------------------------------------------------------------------
create or replace function public.imp062_rt_broadcast_review_queue()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform realtime.send(
    jsonb_build_object(
      'id', NEW.id,
      'kind', 'review_queue.invalidate',
      'firm_id', NEW.firm_id::text
    ),
    'invalidate',
    'firm:' || NEW.firm_id::text || ':review_queue',
    true
  );
  return null;
exception when others then
  -- Realtime is a freshness optimization, never correctness-critical
  -- (API-RT-05): a broadcast failure must not roll back the business
  -- transaction. Polling remains as the fallback.
  raise warning 'imp062_rt_broadcast_review_queue: broadcast contained: %', sqlerrm;
  return null;
end;
$$;

comment on function public.imp062_rt_broadcast_review_queue() is
  'IMP-062 R1-B: AFTER-trigger broadcast of a bare invalidation {id, kind, firm_id} to the private firm:<firm_id>:review_queue topic. Invalidation-only is a SECURITY invariant; broadcast failure is contained (never fails the business transaction).';

create or replace function public.imp062_rt_broadcast_alerts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform realtime.send(
    jsonb_build_object(
      'id', NEW.id,
      'kind', 'alerts.invalidate',
      'firm_id', NEW.firm_id::text
    ),
    'invalidate',
    'firm:' || NEW.firm_id::text || ':alerts',
    true
  );
  return null;
exception when others then
  -- See imp062_rt_broadcast_review_queue: contained, never transaction-fatal.
  raise warning 'imp062_rt_broadcast_alerts: broadcast contained: %', sqlerrm;
  return null;
end;
$$;

comment on function public.imp062_rt_broadcast_alerts() is
  'IMP-062 R1-B: AFTER-trigger broadcast of a bare invalidation {id, kind, firm_id} to the private firm:<firm_id>:alerts topic. Invalidation-only is a SECURITY invariant; broadcast failure is contained (never fails the business transaction).';

-- Trigger-invoked only: no role may call these directly (the owner fires
-- them via the triggers below; direct EXECUTE is not needed by anyone).
revoke all on function public.imp062_rt_broadcast_review_queue() from public, anon, authenticated, service_role;
revoke all on function public.imp062_rt_broadcast_alerts() from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Table triggers — the pinned minimal DML coverage.
--    review_items: queue membership/count/list freshness == row appears
--    (INSERT) or leaves/changes queue state (UPDATE OF status). alerts:
--    badge/count freshness == alert raised (INSERT) or status moves
--    (UPDATE OF status: acknowledge/snooze/resolve/evaluator moves).
-- ---------------------------------------------------------------------------
create trigger imp062_rt_review_items_broadcast
after insert or update of status on public.review_items
for each row execute function public.imp062_rt_broadcast_review_queue();

create trigger imp062_rt_alerts_broadcast
after insert or update of status on public.alerts
for each row execute function public.imp062_rt_broadcast_alerts();

-- ---------------------------------------------------------------------------
-- 3. realtime.messages authorization (the ONLY permissive policy + the
--    browser-publish deny).
--
-- SELECT policy (imp062_rt_messages_select):
--   * strict topic-structure gate FIRST: exactly
--     firm:<canonical-uuid>:(review_queue|alerts) — the canonical 8-4-4-4-12
--     hex shape guarantees the segment-2 uuid cast below can never fail on
--     a gated topic, and every malformed/forged topic fails closed at the
--     regex (no existence/malformation differentiation);
--   * membership-scoped authorization (H2): a live ACTIVE membership of
--     auth.uid() in the firm encoded in the topic, via the existing DEC-J
--     definer helper public.active_membership_role(uuid) — the same
--     live-membership semantics as the app-table policies (RLS-MECH-01);
--   * NO x-active-firm involvement (context, never authorization).
--
-- INSERT policy (imp062_rt_messages_insert_deny): with check (false) —
-- browser roles can never publish into realtime.messages; broadcasts
-- originate only from the definer triggers above.
-- ---------------------------------------------------------------------------
create policy imp062_rt_messages_select
on realtime.messages
for select
to authenticated
using (
  topic ~ '^firm:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}:(review_queue|alerts)$'
  and public.active_membership_role(split_part(topic, ':', 2)::uuid) is not null
);

create policy imp062_rt_messages_insert_deny
on realtime.messages
for insert
to authenticated
with check (false);
