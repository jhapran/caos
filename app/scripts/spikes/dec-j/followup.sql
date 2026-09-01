-- IMP-004 DEC-J INDEPENDENT REVIEW FOLLOW-UP — scale the memberships table.
-- Spike-only. Requires setup.sql already applied. Idempotent.
--
-- NOTE: the user_id FK is dropped (spike-only) so synthetic membership rows
-- can reference synthetic users without creating 100k auth.users. The real
-- harness users' memberships and all correctness semantics are unaffected.

-- Idempotency: clear previous scale rows first.
delete from public.decj_memberships
 where firm_id in (select id from public.decj_firms where label like 'Scale Filler %');
delete from public.decj_firms where label like 'Scale Filler %';

alter table public.decj_memberships drop constraint if exists decj_memberships_user_id_fkey;

-- 2,000 synthetic firms x 50 members = 100,000 membership rows.
insert into public.decj_firms (id, label)
select gen_random_uuid(), 'Scale Filler ' || g
from generate_series(1, 2000) g;

insert into public.decj_memberships (id, user_id, firm_id, role, status, authz_version)
select gen_random_uuid(),
       gen_random_uuid(),
       f.id,
       (array['super_admin','partner','manager','senior','billing'])[1 + (g % 5)],
       'active',
       1
from (select id from public.decj_firms where label like 'Scale Filler %') f
cross join generate_series(1, 50) g;

-- Fair, production-plausible indexes for BOTH candidates (already present
-- from setup.sql; re-asserted here for the record):
--   decj_memberships_lookup  (user_id, firm_id) include (status, role, authz_version)
--   decj_memberships_id_user (id, user_id)  -- candidate C verify-by-id path
--   decj_memberships_user_firm unique (user_id, firm_id)

vacuum analyze public.decj_memberships;
vacuum analyze public.decj_firms;
