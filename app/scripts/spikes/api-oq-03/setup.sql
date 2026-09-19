-- ============================================================================
-- IMP-060 / API-OQ-03 LOCAL measurement spike — synthetic benchmark dataset
-- generation + Candidate A object. LOCAL ONLY. NOT a migration.
-- Everything created here is removed by teardown.sql.
--
-- Authorization: human-approved IMP-060 pre-implementation rulings H1-H8
-- (2026-09-18); LOCAL API-OQ-03 measurement spike ONLY.
--
-- Dataset (H8): TWO firms; PER FIRM approximately 200 clients / 5,000
-- compliance instances / 10,000 tasks / 1,000 review items / 500 alerts.
-- Every synthetic row carries a deterministic UUID in the reserved spike
-- namespace 0a030000-0000-4000-8000-FFKKNNNNNNNN
--   FF = firm (0a = Firm A, 0b = Firm B)
--   KK = kind (01 client, 02 legal entity, 03 compliance instance,
--             04 task, 05 review item, 06 alert, 07 membership)
-- so teardown is exact and generation is idempotent-by-rebuild.
--
-- Auth identities: NONE are created here. The spike reuses the IMP-003
-- deterministic local harness users (tests/harness/registry.json, @caos.test,
-- created by npm run db:reset:harness) and adds only firm_memberships rows
-- for the measured Firm A personas plus the structurally required Firm B
-- supporting personas (partner/manager/senior — referenced by Firm B
-- synthetic rows). Cleanup removes the memberships; the auth users
-- remain owned by the harness seed.
--
-- Audit/outbox handling: Layer-A audit is SKIPPED for this bulk synthetic
-- generation via the sanctioned app.audit_skip_trigger session GUC (the same
-- mechanism Layer-B commands use to avoid double auditing) — synthetic
-- benchmark rows are not business operations. The m050 publication triggers
-- have no skip flag; the event_outbox rows they mint for these inserts are
-- deleted by teardown.sql (firm-scoped delete). The app.audit_fault test GUC
-- is NEVER set.
--
-- Role-scoping layout (deterministic, drives the security/correctness gates):
--   * manager portfolio  = clients 000..049 (25% of 200) via
--                          clients.manager_membership_id; clients 050..199 are
--                          KNOWN out-of-portfolio rows.
--   * manager-assigned   = tasks of clients 150..159 (out-of-portfolio) carry
--                          assignee = manager (tests the assigned-row branch).
--   * senior slice       = instances and tasks of clients with index % 4 = 0
--                          carry assignee = senior, reviewer = manager
--                          (four-eyes: distinct ACTIVE memberships).
--   * review submissions = senior for clients % 4 = 0, else manager;
--                          decisions by the partner (never the submitter).
--   * alerts             = each linked to a DISTINCT compliance instance
--                          (satisfies alerts_nonresolved_dedupe_unique);
--                          330 active / 50 acknowledged / 50 snoozed-future /
--                          20 snoozed-EXPIRED (read-derivation edge,
--                          TEST-API-18) / 50 resolved-auto per firm.
--   * due dates          = offsets [-45,-10,+5,+20,+60] days from generation
--                          date so deadline_board has a known at-risk mix.
-- No alert_rules rows are created (AUTO-OQ-04 stays OPEN); no statutory rule
-- version is activated; all instance types are entity-scoped SYSTEM DEFAULTS
-- (firm_id IS NULL) so DM-27 requires registration_id NULL.
-- ============================================================================

begin;

select set_config('app.audit_skip_trigger', '1', true);

create or replace function pg_temp.oq3_id(p_ff text, p_kk text, p_n integer)
returns uuid language sql immutable as $$
  select ('0a030000-0000-4000-8000-' || p_ff || p_kk || lpad(to_hex(p_n), 8, '0'))::uuid
$$;

create temporary table oq3_firms (ff text primary key, firm_id uuid not null) on commit drop;
insert into oq3_firms values
  ('0a', '10000000-0000-4000-8000-000000000001'),  -- registry FIRM_A
  ('0b', '10000000-0000-4000-8000-000000000002');  -- registry FIRM_B

-- ---------------------------------------------------------------------------
-- Firms + memberships (registry users; ACTIVE except the two negative probes)
-- registry users: partner.a=...0002 manager.a=...0003 senior.a=...0004
--                 billing.a=...0006 suspended.a=...0014 removed.a=...0015
--                 partner.b=...0008 manager.b=...0009 senior.b=...0010
-- Firm B needs partner + manager + senior memberships: every
-- membership-referencing insert below is parameterized by firm (f.ff), so
-- Firm B synthetic rows FK-reference 0b/07/1 (owner/decider), 0b/07/2
-- (manager portfolio/reviewer/submitter/assignee) and 0b/07/3 (senior
-- assignee/submitter). Firm B billing is NOT referenced by any synthetic
-- row and is deliberately not created (no Firm B billing role case).
-- ---------------------------------------------------------------------------
insert into public.firms (id, name, status)
select firm_id, 'API-OQ-03 BENCH Firm ' || ff, 'active' from oq3_firms
on conflict (id) do nothing;

insert into public.firm_memberships (id, firm_id, user_id, role, status) values
  (pg_temp.oq3_id('0a','07',1), '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', 'partner', 'active'),
  (pg_temp.oq3_id('0a','07',2), '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000003', 'manager', 'active'),
  (pg_temp.oq3_id('0a','07',3), '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000004', 'senior',  'active'),
  (pg_temp.oq3_id('0a','07',4), '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000006', 'billing', 'active'),
  (pg_temp.oq3_id('0a','07',5), '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000014', 'manager', 'suspended'),
  (pg_temp.oq3_id('0a','07',6), '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000015', 'manager', 'removed'),
  (pg_temp.oq3_id('0b','07',1), '10000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000008', 'partner', 'active'),
  (pg_temp.oq3_id('0b','07',2), '10000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000009', 'manager', 'active'),
  (pg_temp.oq3_id('0b','07',3), '10000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000010', 'senior',  'active')
on conflict (firm_id, user_id) do nothing;

-- ---------------------------------------------------------------------------
-- Clients (200/firm) + one legal entity each
-- ---------------------------------------------------------------------------
insert into public.clients
  (id, firm_id, name, industry, risk_rating, status,
   owner_partner_membership_id, manager_membership_id, tags)
select
  pg_temp.oq3_id(f.ff, '01', i),
  f.firm_id,
  'OQ03BENCH Client ' || f.ff || '-' || lpad(i::text, 3, '0'),
  'benchmark',
  (array['low','medium','high'])[i % 3 + 1],
  'active',
  pg_temp.oq3_id(f.ff, '07', 1),
  case when i < 50 then pg_temp.oq3_id(f.ff, '07', 2) end,
  array['oq03bench']
from oq3_firms f
cross join generate_series(0, 199) as i;

insert into public.legal_entities
  (id, firm_id, client_id, entity_type, legal_name, status)
select
  pg_temp.oq3_id(f.ff, '02', i),
  f.firm_id,
  pg_temp.oq3_id(f.ff, '01', i),
  'private_limited',
  'OQ03BENCH Entity ' || f.ff || '-' || lpad(i::text, 3, '0'),
  'active'
from oq3_firms f
cross join generate_series(0, 199) as i;

-- ---------------------------------------------------------------------------
-- Compliance instances (5,000/firm = 200 clients x 5 entity-scope system
-- types x 5 periods). States cycle the exact DM-SM-04 vocabulary.
-- ---------------------------------------------------------------------------
create temporary table oq3_types (t_idx integer primary key, type_id uuid not null) on commit drop;
insert into oq3_types values
  (0, '50000000-0000-4000-8000-000000000005'),  -- itr          (scope_kind entity)
  (1, '50000000-0000-4000-8000-000000000006'),  -- advance-tax  (entity)
  (2, '50000000-0000-4000-8000-000000000007'),  -- tax-audit    (entity)
  (3, '50000000-0000-4000-8000-000000000008'),  -- stat-audit   (entity)
  (4, '50000000-0000-4000-8000-000000000009');  -- mca-aoc4     (entity)

insert into public.compliance_instances
  (id, firm_id, legal_entity_id, compliance_type_id,
   period_start, period_end, period_label, due_date,
   state, assignee_membership_id, reviewer_membership_id, priority,
   filed_at, closed_at)
select
  pg_temp.oq3_id(f.ff, '03', i * 25 + t.t_idx * 5 + p),
  f.firm_id,
  pg_temp.oq3_id(f.ff, '02', i),
  t.type_id,
  (date '2026-04-01' + (p * 3 || ' months')::interval)::date,
  (date '2026-04-01' + ((p + 1) * 3 || ' months')::interval - interval '1 day')::date,
  'OQ03BENCH-P' || p,
  current_date + (array[-45,-10,5,20,60])[p + 1],
  (array['not_started','information_requested','information_received','preparation',
         'internal_review','client_approval','ready_to_file','filed',
         'acknowledgement_received','closed'])[(t.t_idx * 5 + p) % 10 + 1],
  case when i % 4 = 0 then pg_temp.oq3_id(f.ff, '07', 3) end,
  case when i % 4 = 0 then pg_temp.oq3_id(f.ff, '07', 2) end,
  'normal',
  case when (t.t_idx * 5 + p) % 10 in (7, 8, 9) then now() end,
  case when (t.t_idx * 5 + p) % 10 = 9 then now() end
from oq3_firms f
cross join generate_series(0, 199) as i
cross join oq3_types t
cross join generate_series(0, 4) as p;

-- ---------------------------------------------------------------------------
-- Tasks (10,000/firm = 200 clients x 50; first 25 per client instance-linked,
-- rest ad-hoc). Statuses cycle the exact DM-SM-05 vocabulary.
-- ---------------------------------------------------------------------------
insert into public.tasks
  (id, firm_id, client_id, compliance_instance_id, title, next_action,
   status, waiting_reason, due_date, priority,
   assignee_membership_id, reviewer_membership_id)
select
  pg_temp.oq3_id(f.ff, '04', i * 50 + k),
  f.firm_id,
  pg_temp.oq3_id(f.ff, '01', i),
  case when k < 25 then pg_temp.oq3_id(f.ff, '03', i * 25 + k) end,
  'OQ03BENCH Task ' || f.ff || '-' || i || '-' || k,
  'OQ03BENCH next action',
  (array['open','in_progress','waiting','submitted','returned','approved','done','cancelled'])[k % 8 + 1],
  case when k % 8 = 2 then 'OQ03BENCH waiting on client documents' end,
  current_date + (k % 60) - 30,
  'normal',
  case
    when i % 4 = 0 then pg_temp.oq3_id(f.ff, '07', 3)
    when i between 150 and 159 then pg_temp.oq3_id(f.ff, '07', 2)
  end,
  case when i % 4 = 0 then pg_temp.oq3_id(f.ff, '07', 2) end
from oq3_firms f
cross join generate_series(0, 199) as i
cross join generate_series(0, 49) as k;

-- ---------------------------------------------------------------------------
-- Review items (1,000/firm = 200 clients x 5; 600 pending, 400 decided).
-- Exact API-OQ-01 type vocabulary; decision CHECKs satisfied on insert.
-- ---------------------------------------------------------------------------
insert into public.review_items
  (id, firm_id, client_id, type, title, status, priority,
   submitted_by_membership_id, submitted_at,
   decided_by_membership_id, decided_at, decision_rationale)
select
  pg_temp.oq3_id(f.ff, '05', i * 5 + r),
  f.firm_id,
  pg_temp.oq3_id(f.ff, '01', i),
  (array['gst_reconciliation','tds_return','itr_computation','financial_statements','audit_workpaper'])[r + 1],
  'OQ03BENCH Review ' || f.ff || '-' || i || '-' || r,
  case when r < 3 then 'pending'
       else (array['approved','returned','escalated','dismissed'])[(i + r) % 4 + 1] end,
  'normal',
  case when i % 4 = 0 then pg_temp.oq3_id(f.ff, '07', 3)
       else pg_temp.oq3_id(f.ff, '07', 2) end,
  now(),
  case when r >= 3 then pg_temp.oq3_id(f.ff, '07', 1) end,
  case when r >= 3 then now() end,
  case when r >= 3 then 'OQ03BENCH decision rationale' end
from oq3_firms f
cross join generate_series(0, 199) as i
cross join generate_series(0, 4) as r;

-- ---------------------------------------------------------------------------
-- Alerts (500/firm; each non-resolved alert has a DISTINCT (client, instance)
-- dedupe key; NO alert_rule rows — AUTO-OQ-04 untouched).
-- Status mix exercises the snooze-expiry READ derivation (TEST-API-18).
-- ---------------------------------------------------------------------------
insert into public.alerts
  (id, firm_id, severity, title, detail, client_id, compliance_instance_id,
   status, raised_at, acknowledged_by, acknowledged_at, snoozed_until,
   resolved_at, resolution_type)
select
  pg_temp.oq3_id(f.ff, '06', n),
  f.firm_id,
  (array['info','warning','critical'])[n % 3 + 1],
  'OQ03BENCH Alert ' || f.ff || '-' || n,
  'OQ03BENCH synthetic alert',
  pg_temp.oq3_id(f.ff, '01', n % 200),
  pg_temp.oq3_id(f.ff, '03', (n % 200) * 25 + (n / 200)),
  case
    when n < 330 then 'active'
    when n < 380 then 'acknowledged'
    when n < 450 then 'snoozed'
    else 'resolved'
  end,
  now(),
  case when n between 330 and 379 then '20000000-0000-4000-8000-000000000002'::uuid end,
  case when n between 330 and 379 then now() end,
  case
    when n between 380 and 429 then now() + interval '3 days'
    when n between 430 and 449 then now() - interval '1 day'
  end,
  case when n >= 450 then now() end,
  case when n >= 450 then 'auto' end
from oq3_firms f
cross join generate_series(0, 499) as n;

-- ---------------------------------------------------------------------------
-- CANDIDATE A — ONE composite aggregate RPC. Benchmark-specific name,
-- explicitly SECURITY INVOKER (never definer): caller RLS on tasks /
-- compliance_instances / deadline_board / review_items / alerts remains the
-- authorization boundary. Returns ONLY the canonical API-R0-DASH counters
-- under comparison (H1-H8: no fixture-only KPIs, no H2/H3/H4/H5/H6 metrics):
--   * tasks_by_status        — the 8 DM-SM-05 states (zero-filled)
--   * instances_by_state     — the 10 DM-SM-04 states (zero-filled; H1
--                              compliance health = live instance-state truth)
--   * deadline               — deadline_board rollup: groups, at-risk
--                              instances (H3 directly named counter), total
--   * pending_reviews        — review_items status='pending' (H3 counter)
--   * active_alerts          — DERIVED effective-active (H3 counter):
--                              persisted 'active' OR persisted 'snoozed'
--                              whose snoozed_until has passed with no
--                              acknowledgement history (TEST-API-18 read
--                              derivation, identical to
--                              deriveAlertEffectiveStatus in
--                              src/data/alerts/types.ts)
-- ---------------------------------------------------------------------------
create or replace function public.api_oq_03_bench_dashboard()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'tasks_by_status', (
      select jsonb_object_agg(v.st, coalesce(t.n, 0))
      from (values ('open'),('in_progress'),('waiting'),('submitted'),
                   ('returned'),('approved'),('done'),('cancelled')) as v(st)
      left join (select status, count(*)::int as n from public.tasks group by status) t
        on t.status = v.st
    ),
    'instances_by_state', (
      select jsonb_object_agg(v.st, coalesce(c.n, 0))
      from (values ('not_started'),('information_requested'),('information_received'),
                   ('preparation'),('internal_review'),('client_approval'),
                   ('ready_to_file'),('filed'),('acknowledgement_received'),('closed')) as v(st)
      left join (select state, count(*)::int as n from public.compliance_instances group by state) c
        on c.state = v.st
    ),
    'deadline', (
      select jsonb_build_object(
               'groups', count(*)::int,
               'at_risk_instances', coalesce(sum(b.at_risk), 0)::int,
               'total_instances', coalesce(sum(b.total_clients), 0)::int)
      from public.deadline_board b
    ),
    'pending_reviews', (
      select count(*)::int from public.review_items where status = 'pending'
    ),
    'active_alerts', (
      select count(*)::int
      from public.alerts a
      where a.status = 'active'
         or (a.status = 'snoozed'
             and a.snoozed_until is not null
             and a.snoozed_until <= now()
             and a.acknowledged_at is null)
    )
  )
$$;

revoke all on function public.api_oq_03_bench_dashboard() from public;
grant execute on function public.api_oq_03_bench_dashboard() to authenticated;

commit;

-- Generation evidence (consumed by run.mjs; no secrets) ---------------------
select 'clients='              || count(*) from public.clients              where id::text like '0a030000-0000-4000-8000-%';
select 'legal_entities='       || count(*) from public.legal_entities       where id::text like '0a030000-0000-4000-8000-%';
select 'compliance_instances=' || count(*) from public.compliance_instances where id::text like '0a030000-0000-4000-8000-%';
select 'tasks='                || count(*) from public.tasks                where id::text like '0a030000-0000-4000-8000-%';
select 'review_items='         || count(*) from public.review_items         where id::text like '0a030000-0000-4000-8000-%';
select 'alerts='               || count(*) from public.alerts               where id::text like '0a030000-0000-4000-8000-%';
select 'memberships='          || count(*) from public.firm_memberships     where id::text like '0a030000-0000-4000-8000-%';
