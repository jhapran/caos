-- ============================================================================
-- IMP-060 / API-OQ-03 LOCAL measurement spike — teardown. LOCAL ONLY.
-- Removes EVERYTHING setup.sql created:
--   * the Candidate A benchmark function
--   * every synthetic row in the 0a030000-0000-4000-8000-* UUID namespace
--   * the event_outbox rows the publication triggers minted for those inserts
--     (firm-scoped delete against the two harness/benchmark firms)
--   * the two benchmark firm rows themselves
-- Layer-A audit is skipped for these bulk deletes (same sanctioned session
-- GUC as setup) so teardown does not mint ~34k synthetic audit rows.
-- Idempotent: safe to run repeatedly. run.mjs verifies zero residue after.
-- ============================================================================

begin;

select set_config('app.audit_skip_trigger', '1', true);

drop function if exists public.api_oq_03_bench_dashboard();

delete from public.alerts               where id::text like '0a030000-0000-4000-8000-%';
delete from public.review_items         where id::text like '0a030000-0000-4000-8000-%';
delete from public.tasks                where id::text like '0a030000-0000-4000-8000-%';
delete from public.compliance_instances where id::text like '0a030000-0000-4000-8000-%';
delete from public.legal_entities       where id::text like '0a030000-0000-4000-8000-%';
delete from public.clients              where id::text like '0a030000-0000-4000-8000-%';
delete from public.firm_memberships     where id::text like '0a030000-0000-4000-8000-%';

delete from public.event_outbox
where firm_id in ('10000000-0000-4000-8000-000000000001',
                  '10000000-0000-4000-8000-000000000002');

delete from public.firms
where id in ('10000000-0000-4000-8000-000000000001',
             '10000000-0000-4000-8000-000000000002');

commit;

-- Residue evidence (run.mjs re-checks; every value must be 0) ---------------
select 'residue_clients='              || count(*) from public.clients              where id::text like '0a030000-0000-4000-8000-%';
select 'residue_legal_entities='       || count(*) from public.legal_entities       where id::text like '0a030000-0000-4000-8000-%';
select 'residue_compliance_instances=' || count(*) from public.compliance_instances where id::text like '0a030000-0000-4000-8000-%';
select 'residue_tasks='                || count(*) from public.tasks                where id::text like '0a030000-0000-4000-8000-%';
select 'residue_review_items='         || count(*) from public.review_items         where id::text like '0a030000-0000-4000-8000-%';
select 'residue_alerts='               || count(*) from public.alerts               where id::text like '0a030000-0000-4000-8000-%';
select 'residue_memberships='          || count(*) from public.firm_memberships     where id::text like '0a030000-0000-4000-8000-%';
select 'residue_outbox='               || count(*) from public.event_outbox
  where firm_id in ('10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002');
select 'residue_function='             || count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'api_oq_03_bench_dashboard';
