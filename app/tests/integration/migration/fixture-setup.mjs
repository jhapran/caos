/**
 * IMP-070 — Shared deterministic fixture for the tests/integration/migration
 * suites (TEST-MIG-02/04/09/12/15). Plain .mjs (the helpers.mjs convention):
 * operator psql seed/teardown only — never a proof mechanism for RLS behavior.
 *
 * ONE dedicated suite-owned firm in the 70000000-… range (never the shared
 * registry FIRM_A/B), deterministic ids, force-reset on every run so every
 * suite is idempotent and re-runnable after a failed/partial run. Registry
 * auth users (partner.a / manager.a / senior.a / billing.a) are reused via
 * psql-upserted firm_memberships. System seed rows (50000000-… compliance
 * types/rule versions) are READ-ONLY here. Date-sensitive values are computed
 * SQL-side relative to (now() at time zone 'Asia/Kolkata') so the seeded
 * deadline/alert shapes hold on any run date.
 *
 * Non-default lifecycle states (active engagement/profile, in_progress /
 * waiting task, preparation / information_requested instance, snoozed alert)
 * are plain operator INSERTs — the DM-SM-03/04/05 and SCH-18 write guards bind
 * UPDATE only (the dashboard/deadline/mywork suite precedent). Fixture
 * audit/outbox noise is swept as the operator, scoped to THIS firm id only
 * (AUD-INV-01).
 */
import { psql, userId } from '../helpers.mjs';

export const SUITE_FIRM = '70000000-0000-4000-8000-000000000070';

// Seeded system reference type (supabase/seed.sql): 'Income Tax Return',
// entity-scoped (registration_id must be NULL per DM-27) — readable without
// any fixture compliance_types row (the deadline-suite precedent).
export const SYS_ITR = '50000000-0000-4000-8000-000000000005';
export const SYS_ITR_VERSION = '50000000-0000-4000-8000-000000000105';

export const M = {
  partnerA: '70000000-0000-4000-8000-000000000001',
  managerA: '70000000-0000-4000-8000-000000000002',
  seniorA: '70000000-0000-4000-8000-000000000003',
  billingA: '70000000-0000-4000-8000-000000000004',
};
export const C = {
  c1: '70000000-0000-4000-8000-000000000011', // the suite client (manager portfolio)
};
export const E = {
  e1: '70000000-0000-4000-8000-000000000021', // C.c1 — GSTIN + contact + profile/instances
  e2: '70000000-0000-4000-8000-000000000022', // C.c1 — relationship endpoint
};
export const REL = '70000000-0000-4000-8000-000000000025'; // e1 -> e2 'group'
export const REG = '70000000-0000-4000-8000-000000000031'; // GSTIN on e1
export const CON = '70000000-0000-4000-8000-000000000041'; // primary contact on c1/e1
export const ENG = '70000000-0000-4000-8000-000000000051'; // active engagement on c1
export const CCP = '70000000-0000-4000-8000-000000000061'; // active ITR profile on e1
export const I = {
  i1: '70000000-0000-4000-8000-000000000071', // preparation, due TODAY+7, profile-linked
  i2: '70000000-0000-4000-8000-000000000072', // information_requested, due TODAY-2 (dependency board + at-risk)
};
export const T = {
  t1: '70000000-0000-4000-8000-000000000081', // in_progress, linked to I.i1, assignee senior
  t2: '70000000-0000-4000-8000-000000000082', // waiting, linked to I.i2 (dependency board)
};
export const CHK = '70000000-0000-4000-8000-000000000091';
export const COM = '70000000-0000-4000-8000-000000000092';
export const R = '70000000-0000-4000-8000-0000000000a1'; // pending itr_computation, submitted by senior
export const A = {
  a1: '70000000-0000-4000-8000-0000000000b1', // active, client c1 + instance i1
  a2: '70000000-0000-4000-8000-0000000000b2', // snoozed, EXPIRED until, NO ack (TEST-API-18 reads ACTIVE), instance i2
};

export const SUITE_CLIENT_NAME = 'MIG070 Client One';

/** Operator DELETEs scoped to the suite ids (child rows before parents;
 *  audit/outbox swept first and last). Idempotent by construction. */
export function cleanMigrationFixture() {
  psql(`
    delete from public.audit_log where firm_id = '${SUITE_FIRM}';
    delete from public.event_outbox where firm_id = '${SUITE_FIRM}';
    delete from public.alerts where firm_id = '${SUITE_FIRM}';
    delete from public.review_items where firm_id = '${SUITE_FIRM}';
    delete from public.task_comments where firm_id = '${SUITE_FIRM}';
    delete from public.task_checklist_items where firm_id = '${SUITE_FIRM}';
    delete from public.task_dependencies where firm_id = '${SUITE_FIRM}';
    delete from public.tasks where firm_id = '${SUITE_FIRM}';
    delete from public.compliance_instances where firm_id = '${SUITE_FIRM}';
    delete from public.client_compliance_profiles where firm_id = '${SUITE_FIRM}';
    delete from public.engagements where firm_id = '${SUITE_FIRM}';
    delete from public.contacts where firm_id = '${SUITE_FIRM}';
    delete from public.registrations where firm_id = '${SUITE_FIRM}';
    delete from public.client_relationships where firm_id = '${SUITE_FIRM}';
    delete from public.legal_entities where firm_id = '${SUITE_FIRM}';
    delete from public.clients where firm_id = '${SUITE_FIRM}';
    -- TEST-MIG-15's suite-firm-owned statutory catalogue rows (if a previous
    -- partial run left them): versions first, then the type.
    delete from public.compliance_rule_versions where firm_id = '${SUITE_FIRM}';
    delete from public.compliance_types where firm_id = '${SUITE_FIRM}';
    delete from public.firm_memberships where firm_id = '${SUITE_FIRM}';
    delete from public.firms where id = '${SUITE_FIRM}'
      and not exists (select 1 from public.firm_memberships m where m.firm_id = firms.id)
      and not exists (select 1 from public.clients c where c.firm_id = firms.id);
    -- The firm DELETE itself lands a Layer-A audit row; sweep it last.
    delete from public.audit_log where firm_id = '${SUITE_FIRM}';
  `);
}

/** Idempotent deterministic seed: force-reset first, then insert the full
 *  compact dataset, then sweep fixture audit/outbox noise. */
export function seedMigrationFixture() {
  cleanMigrationFixture();
  psql(`
    insert into public.firms (id, name) values
      ('${SUITE_FIRM}', 'IMP-070 MIG Suite Firm')
    on conflict (id) do nothing;

    insert into public.firm_memberships (id, firm_id, user_id, role, status) values
      ('${M.partnerA}', '${SUITE_FIRM}', '${userId('USER_A_PARTNER')}', 'partner', 'active'),
      ('${M.managerA}', '${SUITE_FIRM}', '${userId('USER_A_MANAGER')}', 'manager', 'active'),
      ('${M.seniorA}',  '${SUITE_FIRM}', '${userId('USER_A_SENIOR')}',  'senior',  'active'),
      ('${M.billingA}', '${SUITE_FIRM}', '${userId('USER_A_BILLING')}', 'billing', 'active')
    on conflict (firm_id, user_id) do nothing;

    -- Force-reset mutable state so re-runs are deterministic even if a
    -- previous run left a membership mid-flight.
    update public.firm_memberships set role = 'partner' where id = '${M.partnerA}';
    update public.firm_memberships set role = 'manager' where id = '${M.managerA}';
    update public.firm_memberships set role = 'senior'  where id = '${M.seniorA}';
    update public.firm_memberships set role = 'billing' where id = '${M.billingA}';
    update public.firm_memberships set status = 'active'
      where id in ('${M.partnerA}', '${M.managerA}', '${M.seniorA}', '${M.billingA}');

    insert into public.clients (id, firm_id, name, owner_partner_membership_id, manager_membership_id, status) values
      ('${C.c1}', '${SUITE_FIRM}', '${SUITE_CLIENT_NAME}', '${M.partnerA}', '${M.managerA}', 'active');

    insert into public.legal_entities (id, firm_id, client_id, entity_type, legal_name) values
      ('${E.e1}', '${SUITE_FIRM}', '${C.c1}', 'private_limited', 'MIG070 Entity One'),
      ('${E.e2}', '${SUITE_FIRM}', '${C.c1}', 'llp',             'MIG070 Entity Two');

    insert into public.client_relationships (id, firm_id, from_entity_id, to_entity_id, relation_type, status) values
      ('${REL}', '${SUITE_FIRM}', '${E.e1}', '${E.e2}', 'group', 'active');

    -- GSTIN implies a state attribute (DM-06 SCH-07 CHECK).
    insert into public.registrations (id, firm_id, legal_entity_id, type, value, state, status) values
      ('${REG}', '${SUITE_FIRM}', '${E.e1}', 'GSTIN', '27AAACT0700M1Z7', 'Maharashtra', 'active');

    insert into public.contacts (id, firm_id, client_id, legal_entity_id, name, email, is_primary, status) values
      ('${CON}', '${SUITE_FIRM}', '${C.c1}', '${E.e1}', 'MIG070 Contact One', 'contact.one@mig070.test', true, 'active');

    -- DM-SM-03 transition legality is UPDATE-guard only: the operator INSERT
    -- carries the terminal-of-interest 'active' state directly.
    insert into public.engagements
      (id, firm_id, client_id, responsible_partner_membership_id, service_lines, letter_status, period_label, status)
    values
      ('${ENG}', '${SUITE_FIRM}', '${C.c1}', '${M.partnerA}', '{income_tax}', 'signed', 'FY 2026-27', 'active');

    -- Profile activation/approval stamps are UPDATE-guard only (RLS-CCP-01);
    -- the operator INSERT carries status 'active' + approval stamps directly.
    insert into public.client_compliance_profiles
      (id, firm_id, legal_entity_id, compliance_type_id, registration_id, status, approved_by, approved_at)
    values
      ('${CCP}', '${SUITE_FIRM}', '${E.e1}', '${SYS_ITR}', null, 'active', '${userId('USER_A_PARTNER')}', now());

    -- Instance fixtures are plain operator INSERTs: client_id is
    -- trigger-derived from the legal entity (SCH-A-02), the state guard binds
    -- UPDATE only (DM-SM-04), and generation_source defaults to 'manual'
    -- (AUTO-REC-07 — no recurrence provenance on operator rows). Due dates are
    -- Asia/Kolkata business dates computed SQL-side: i1 lands in a near-term
    -- future deadline group; i2 is overdue + information_requested (the
    -- dependency-board source and the at-risk row).
    insert into public.compliance_instances
      (id, firm_id, legal_entity_id, compliance_type_id, client_compliance_profile_id,
       period_start, period_end, period_label, due_date, state, assignee_membership_id)
    values
      ('${I.i1}', '${SUITE_FIRM}', '${E.e1}', '${SYS_ITR}', '${CCP}',
       '2026-04-01', '2027-03-31', 'FY 2026-27',
       ((now() at time zone 'Asia/Kolkata')::date + 7), 'preparation', '${M.seniorA}'),
      ('${I.i2}', '${SUITE_FIRM}', '${E.e1}', '${SYS_ITR}', null,
       '2025-04-01', '2026-03-31', 'FY 2025-26',
       ((now() at time zone 'Asia/Kolkata')::date - 2), 'information_requested', '${M.seniorA}');

    -- Task fixtures are plain operator INSERTs (status is unguarded on
    -- INSERT — DM-SM-05 transition legality and the waiting-reason invariant
    -- are command-owned; the mywork/deadline precedent). Instance-linked
    -- tasks: client_id is trigger-derived from the instance (SCH-13 subject
    -- binding), so the supplied value is overwritten with the instance's
    -- client.
    insert into public.tasks
      (id, firm_id, client_id, compliance_instance_id, title, next_action, status,
       waiting_reason, assignee_membership_id)
    values
      ('${T.t1}', '${SUITE_FIRM}', '${C.c1}', '${I.i1}', 'MIG070 prepare ITR working papers',
       'complete the checklist', 'in_progress', null, '${M.seniorA}'),
      ('${T.t2}', '${SUITE_FIRM}', '${C.c1}', '${I.i2}', 'MIG070 chase FY26 information',
       'collect the pending information', 'waiting', 'client information pending', '${M.seniorA}');

    insert into public.task_checklist_items (id, firm_id, task_id, label, sort_order) values
      ('${CHK}', '${SUITE_FIRM}', '${T.t1}', 'MIG070 reconcile 26AS', 1);

    insert into public.task_comments (id, firm_id, task_id, author_id, body) values
      ('${COM}', '${SUITE_FIRM}', '${T.t1}', '${userId('USER_A_SENIOR')}', 'MIG070 working note');

    -- Review fixture is a plain operator INSERT (browser grants are
    -- SELECT-only; a pending row carries no decision facts per the DM-SM-06
    -- CHECK). R0 frozen type vocabulary (API-OQ-01).
    insert into public.review_items
      (id, firm_id, client_id, compliance_instance_id, type, title, status, submitted_by_membership_id)
    values
      ('${R}', '${SUITE_FIRM}', '${C.c1}', '${I.i1}', 'itr_computation', 'MIG070 ITR computation review',
       'pending', '${M.seniorA}');

    -- Alert fixtures are plain operator INSERTs (the write guard restricts
    -- UPDATE only; alerts carry NO browser insert path at all). Subject
    -- combinations are pair-wise distinct among the non-resolved rows
    -- (IMP-051 HRR-06=A structural dedupe index, NULLS NOT DISTINCT, NULL
    -- alert_rule_id throughout). A.a2 is an EXPIRED unacknowledged snooze —
    -- the TEST-API-18 derivation reads it effectively active.
    insert into public.alerts
      (id, firm_id, severity, title, client_id, compliance_instance_id, status,
       acknowledged_by, acknowledged_at, snoozed_until, resolved_by, resolved_at, resolution_type)
    values
      ('${A.a1}', '${SUITE_FIRM}', 'warning', 'MIG070 active alert', '${C.c1}', '${I.i1}', 'active',
       null, null, null, null, null, null),
      ('${A.a2}', '${SUITE_FIRM}', 'critical', 'MIG070 expired snooze', null, '${I.i2}', 'snoozed',
       null, null, now() - interval '1 day', null, null, null);
  `);
  // Fixture writes are operator/system-actor rows; remove fixture noise so
  // the table stays clean for other suites (IMP-031…IMP-051 precedent).
  psql(`
    delete from public.audit_log where firm_id = '${SUITE_FIRM}';
    delete from public.event_outbox where firm_id = '${SUITE_FIRM}';
  `);
}
