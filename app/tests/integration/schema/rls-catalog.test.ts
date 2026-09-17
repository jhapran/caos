/**
 * IMP-012/IMP-013 — Catalog assertions for the foundational RLS migration
 * and the audit-foundation migration (spec 12 / spec 11 structural checks).
 * Asserts the intended security posture exists in the database itself —
 * not just behavior: RLS enabled, exact policy set, least-privilege grants,
 * helper-function security properties, and the DEC-J lookup index shape.
 *
 * IMP-013 changes reflected here: audit_log (SCH-20) exists with RLS
 * enabled AND forced; the firm_memberships INSERT/UPDATE policies and
 * column write grants were removed (Layer-B RPC transition, API-ARCH-04);
 * the audit/membership-RPC function privilege inventory is asserted.
 *
 * IMP-020 changes reflected here: the client-hierarchy tables (SCH-04…08)
 * exist with RLS enabled AND forced, 15 active-firm-scoped policies,
 * column-pinned write grants, the active_membership_id() helper, the
 * billing-role list_client_identities() projection RPC, and two guard
 * trigger functions (responsibility validation / entity_type
 * immutability).
 *
 * IMP-021 changes reflected here: engagements (SCH-09) exists with RLS
 * enabled AND forced, three active-firm-scoped policies (partner+ write,
 * manager portfolio read), column-pinned write grants, the billing-role
 * list_engagement_letter_statuses() projection RPC, and two guard trigger
 * functions (responsibility validation / DM-SM-03 status transitions).
 *
 * IMP-030 changes reflected here: compliance_types (SCH-10) +
 * compliance_rule_versions (SCH-32) exist with RLS enabled AND forced,
 * seven policies (types: scoped select + privileged aal2 insert/update;
 * versions: privileged all-status select, manager active-only select,
 * privileged aal2 draft insert + payload-only update), column-pinned
 * write grants (no id/status/domain_approval_status/created_by), the
 * Layer-B activate_compliance_rule_version(uuid) definer RPC granted to
 * authenticated only, three owner-only trigger functions (governance
 * inheritance, insert path, update guard), and the intentionally
 * PUBLIC-executable immutable CHECK validator
 * compliance_workflow_template_valid(jsonb).
 *
 * IMP-031 changes reflected here: client_compliance_profiles (SCH-11) +
 * compliance_instances (SCH-12) exist with RLS enabled AND forced, six
 * policies (scoped select + manager+ insert/update per table),
 * column-pinned write grants (profiles: no id/status/approval stamps on
 * insert, answers/registration/non-active status on update; instances: no
 * id/client_id/state/lifecycle markers/risk/successor on insert, the
 * permitted non-state set on update), the Layer-B commands
 * approve_client_compliance_profile(uuid) and
 * transition_compliance_instance(uuid,text,text) granted to authenticated
 * only, and four owner-only definer functions (the shared DM-27 scope
 * validator, the assignment/four-eyes validator, the two write guards).
 *
 * IMP-040 changes reflected here (PASS B): tasks / task_dependencies /
 * task_checklist_items / task_comments (SCH-13…16) carry the final
 * RLS-TSK-01/RLS-TSK-02/RLS-TCM-01 policy set (11 policies: scoped
 * select/insert/update on tasks; select-only on dependencies;
 * select/insert/update/delete via-parent-task on checklist items;
 * select/insert/retract-only-update on comments), column-pinned write
 * grants (status/waiting_reason/client_id never browser-writable on tasks;
 * comments update is retracted-only; dependencies have NO write grant), the
 * Layer-B commands transition_task(uuid,text,text,text,text),
 * add_task_dependency(uuid,uuid,text,text) and
 * remove_task_dependency(uuid,uuid,text) granted to authenticated only, and
 * three owner-only trigger functions (the tasks write guard, the comment
 * immutability guard, the checklist who/when stamper).
 *
 * IMP-041 changes reflected here (PASS B): review_items (SCH-17) carries the
 * final RLS-RVW-01 policy set (one scoped-select policy: super_admin/partner
 * firm-wide, manager portfolio-or-linked-task, senior/article own
 * submissions), table-level SELECT for authenticated with NO browser write
 * grant (submission/decision are the Layer-B commands
 * submit_review_item(uuid,uuid,uuid,text,text,text,text,timestamptz) and
 * decide_review_item(uuid,text,text,text), granted to authenticated only),
 * and one owner-only definer trigger function (the subject-binding /
 * single-writer write guard).
 *
 * IMP-042 changes reflected here: alert_rules (SCH-19) + alerts (SCH-18)
 * exist with RLS enabled AND forced, one scoped-select policy each
 * (RLS-ALR-01: super_admin/partner/manager firm-wide + senior/article
 * assigned-work-only; RLS-ARL-01: super_admin/partner/manager read),
 * table-level SELECT for authenticated with NO browser write grant on
 * either table (status movement is the Layer-B commands
 * acknowledge_alert(uuid,text) / snooze_alert(uuid,timestamptz,text) /
 * resolve_alert(uuid,text); rule administration is the AAL2-gated
 * create_alert_rule(text,text,text,jsonb,boolean,boolean,boolean) /
 * update_alert_rule(uuid,text,text,jsonb,boolean,boolean,boolean) — all
 * granted to authenticated only), and one owner-only definer trigger
 * function (the alerts single-writer write guard).
 *
 * IMP-050 changes reflected here: event_outbox (SCH-33) +
 * scheduler_dead_letters (SCH-35) exist with RLS enabled AND forced,
 * scheduler_job_runs (SCH-34) with RLS enabled NOT forced (Ruling R8 —
 * system-scoped, not tenant-owned); all three carry ZERO policies (the
 * 51-policy inventory is deliberately unchanged — RLS-EVO-01/SJR-01/
 * SDL-01 are zero-browser-grant postures, not permissive policies) and
 * zero table grants for anon/authenticated/service_role. The function
 * inventory gains the three write guards (evo_guard_update,
 * sjr_guard_update, sdl_guard_write — INVOKER like the
 * crv_guard_update precedent), the outbox writer/producer trigger
 * (publish_domain_event, event_publish_trg), the recurrence machinery
 * (recurrence_period_anchor/label/due_date/lookahead_days,
 * recurrence_insert_instance, generate_profile_instances,
 * generate_successor_instance, evaluate_recurrence), the drain
 * (drain_event_outbox), and cron registration (register_scheduler_jobs)
 * — all owner-only; requeue_dead_letter(uuid,text) joins the
 * service-role-only class (AUTO-RPL-02, RLS-SVC-01).
 *
 * IMP-051 changes reflected here: two security_invoker deadline views —
 * public.deadline_board + public.client_dependency_board (AUTO-DLN-01,
 * API-R0-DLN, DEADLINE_MODEL=DERIVED) — carry SELECT to authenticated
 * only (the underlying tables' RLS is the row filter; NO SECURITY
 * DEFINER read path), and the sched.alerts.evaluate job function
 * public.evaluate_alerts() is SECURITY DEFINER with search_path='' and
 * owner-only EXECUTE. The views are not relkind='r' and carry no
 * policies, so the RLS/FORCE/51-policy inventories are unchanged.
 *
 * Order-independent (sorted comparisons) so harmless catalog ordering
 * changes do not break the suite.
 */
import { describe, expect, it } from 'vitest';

import { FIRM_A, psql, userId } from '../helpers.mjs';

const rows = (sql) => psql(sql).trim().split('\n').filter(Boolean).sort();

describe('IMP-012/013/020/021/030/031/040/041 catalog — RLS state (RLS-PRIN-02)', () => {
  it('RLS is enabled on exactly the tenant-core + audit + client-hierarchy + engagement + compliance-rule + profile/instance + task-family + review-item + alerts-family tables', () => {
    expect(
      rows(`select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity`),
    ).toEqual([
      'alert_rules',
      'alerts',
      'audit_log',
      'client_compliance_profiles',
      'client_relationships',
      'clients',
      'compliance_instances',
      'compliance_rule_versions',
      'compliance_types',
      'contacts',
      'engagements',
      'event_outbox',
      'firm_memberships',
      'firms',
      'legal_entities',
      'profiles',
      'registrations',
      'review_items',
      'scheduler_dead_letters',
      'scheduler_job_runs',
      'task_checklist_items',
      'task_comments',
      'task_dependencies',
      'tasks',
    ]);
  });

  it('FORCE RLS is set exactly on tenant-owned content tables; the tenant core remains the documented exception', () => {
    // audit_log and the five IMP-020 client-hierarchy tables hold
    // tenant-owned content (DM-25, SCH-04…08), so RLS-PRIN-02's "enabled and
    // forced" applies. Forcing is safe: the table owner is postgres
    // (superuser, unaffected) and every audited write path is a
    // postgres-owned SECURITY DEFINER function — no legitimate writer needs
    // owner bypass.
    // SCH-01…03 stay unforced: forcing would recurse the live-membership
    // helper on firm_memberships and break owner-run seed/maintenance writes
    // (IMP-012 documented exception). IMP-030's hybrid reference tables hold
    // tenant-owned overrides/versions, so they are forced like the other
    // content tables (the compliance write paths are postgres-owned definer
    // functions / RLS-governed DML — no owner bypass needed). IMP-031's
    // profiles/instances are tenant-owned content, forced the same way.
    // IMP-040's four task-family tables are tenant-owned content, forced the
    // same way (zero policies in PASS A = fail-closed for browser roles).
    // IMP-041's review_items is tenant-owned content, forced the same
    // way (PASS B: one scoped-select policy; writes stay command-owned).
    // IMP-042's alerts + alert_rules are tenant-owned content, forced the
    // same way (one scoped-select policy each; ALL writes command-owned).
    // IMP-050: event_outbox (SCH-33) and scheduler_dead_letters (SCH-35)
    // are forced (Ruling R8); scheduler_job_runs (SCH-34) stays enabled but
    // NOT forced — system-scoped, not tenant-owned.
    expect(
      rows(`select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind = 'r' and c.relforcerowsecurity`),
    ).toEqual([
      'alert_rules',
      'alerts',
      'audit_log',
      'client_compliance_profiles',
      'client_relationships',
      'clients',
      'compliance_instances',
      'compliance_rule_versions',
      'compliance_types',
      'contacts',
      'engagements',
      'event_outbox',
      'legal_entities',
      'registrations',
      'review_items',
      'scheduler_dead_letters',
      'task_checklist_items',
      'task_comments',
      'task_dependencies',
      'tasks',
    ]);
  });

  it('exact policy inventory exists (one policy per meaningful operation)', () => {
    // IMP-013 dropped the firm_memberships INSERT/UPDATE policies (raw write
    // path closed; Layer-B RPCs own administration) and added the audit_log
    // SELECT policy (RLS-AUD-01). IMP-020 adds select/insert/update policies
    // per client-hierarchy table — active-firm scoped, manager+ writes,
    // manager portfolio-scoped reads (RLS-OQ-02), no DELETE anywhere.
    // IMP-030 adds three compliance_types policies (scoped select;
    // privileged aal2 insert/update) and four compliance_rule_versions
    // policies (privileged all-status select; manager active-only select;
    // privileged aal2 draft insert; privileged aal2 payload update).
    // IMP-031 adds scoped select + manager+ insert/update policies on both
    // client_compliance_profiles (RLS-CCP-01) and compliance_instances
    // (RLS-CIN-01) — state moves remain command-gated beneath the policies.
    // IMP-040 PASS B adds eleven task-family policies (RLS-TSK-01/02,
    // RLS-TCM-01): tasks scoped select/insert/update; task_dependencies
    // select-only (graph writes are command-owned); task_checklist_items
    // select/insert/update/delete via parent-task scope; task_comments
    // select + author-pinned insert + author retract-only update.
    // IMP-041 PASS B adds one review_items policy (RLS-RVW-01): scoped
    // select only — submission and decisions are Layer-B commands, so no
    // insert/update/delete policy exists.
    // IMP-042 adds two alerts-family policies: alerts_select_scoped
    // (RLS-ALR-01 — manager+ firm-wide, senior/article assigned-work-only)
    // and alert_rules_select_scoped (RLS-ARL-01 — super_admin/partner/
    // manager read); every write on both tables is Layer-B command-owned,
    // so no insert/update/delete policy exists.
    // IMP-050 adds NO policies: event_outbox (SCH-33), scheduler_job_runs
    // (SCH-34) and scheduler_dead_letters (SCH-35) are zero-policy,
    // zero-browser-grant automation records (RLS-EVO-01/SJR-01/SDL-01,
    // Ruling R8) — the inventory stays at 51 by contract.
    expect(
      rows(`select tablename || ':' || policyname || ':' || cmd from pg_policies where schemaname = 'public'`),
    ).toEqual(
      [
        'alert_rules:alert_rules_select_scoped:SELECT',
        'alerts:alerts_select_scoped:SELECT',
        'audit_log:audit_select_partner_admin:SELECT',
        'client_compliance_profiles:ccp_insert_manager_plus:INSERT',
        'client_compliance_profiles:ccp_select_scoped:SELECT',
        'client_compliance_profiles:ccp_update_manager_plus:UPDATE',
        'client_relationships:client_relationships_insert_manager_plus:INSERT',
        'client_relationships:client_relationships_select_scoped:SELECT',
        'client_relationships:client_relationships_update_manager_plus:UPDATE',
        'clients:clients_insert_manager_plus:INSERT',
        'clients:clients_select_scoped:SELECT',
        'clients:clients_update_manager_plus:UPDATE',
        'compliance_instances:cin_insert_manager_plus:INSERT',
        'compliance_instances:cin_select_scoped:SELECT',
        'compliance_instances:cin_update_manager_plus:UPDATE',
        'compliance_rule_versions:crv_insert_privileged_aal2:INSERT',
        'compliance_rule_versions:crv_select_manager_active:SELECT',
        'compliance_rule_versions:crv_select_privileged:SELECT',
        'compliance_rule_versions:crv_update_privileged_aal2:UPDATE',
        'compliance_types:compliance_types_insert_privileged_aal2:INSERT',
        'compliance_types:compliance_types_select_scoped:SELECT',
        'compliance_types:compliance_types_update_privileged_aal2:UPDATE',
        'contacts:contacts_insert_manager_plus:INSERT',
        'contacts:contacts_select_scoped:SELECT',
        'contacts:contacts_update_manager_plus:UPDATE',
        'engagements:engagements_insert_partner_plus:INSERT',
        'engagements:engagements_select_scoped:SELECT',
        'engagements:engagements_update_partner_plus:UPDATE',
        'firm_memberships:memberships_select_own_or_active_firm:SELECT',
        'firms:firms_select_member:SELECT',
        'firms:firms_update_super_admin:UPDATE',
        'legal_entities:legal_entities_insert_manager_plus:INSERT',
        'legal_entities:legal_entities_select_scoped:SELECT',
        'legal_entities:legal_entities_update_manager_plus:UPDATE',
        'profiles:profiles_select_own_or_shared_firm:SELECT',
        'profiles:profiles_update_self:UPDATE',
        'registrations:registrations_insert_manager_plus:INSERT',
        'registrations:registrations_select_scoped:SELECT',
        'registrations:registrations_update_manager_plus:UPDATE',
        // IMP-041 PASS B review queue (RLS-RVW-01).
        'review_items:review_items_select_scoped:SELECT',
        // IMP-040 PASS B task family.
        'task_checklist_items:task_checklist_items_delete_via_task:DELETE',
        'task_checklist_items:task_checklist_items_insert_via_task:INSERT',
        'task_checklist_items:task_checklist_items_select_via_task:SELECT',
        'task_checklist_items:task_checklist_items_update_via_task:UPDATE',
        'task_comments:task_comments_insert_author:INSERT',
        'task_comments:task_comments_select_via_task:SELECT',
        'task_comments:task_comments_update_retract_author:UPDATE',
        'task_dependencies:task_dependencies_select_scoped:SELECT',
        'tasks:tasks_insert_scoped:INSERT',
        'tasks:tasks_select_scoped:SELECT',
        'tasks:tasks_update_scoped:UPDATE',
      ].sort(),
    );
  });
});

// IMP-013 function inventory (audit + Layer-B/C write paths).
const IMP012_HELPERS = ['active_membership_role(uuid)', 'req_active_firm()', 'shares_active_firm_with(uuid)'];
const AUTHENTICATED_RPCS = [
  'invite_member(uuid,uuid,text)',
  'change_membership_role(uuid,uuid,text)',
  'suspend_membership(uuid,uuid)',
  'remove_membership(uuid,uuid)',
  'accept_invitation(uuid)',
  'write_audit_event(uuid,text,text,text,jsonb,jsonb,uuid)',
  // IMP-020: billing identity projection — browser-facing, authenticated
  // only; service_role needs no projection RPC (it reads tables directly).
  'list_client_identities(uuid)',
  // IMP-021: billing letter-status projection (RLS-ENG-01), same pattern.
  'list_engagement_letter_statuses(uuid)',
  // IMP-030: Layer-B rule-version lifecycle command (RLS-CRV-03).
  'activate_compliance_rule_version(uuid)',
  // IMP-031: Layer-B profile approval + instance transition commands
  // (API-R0-CCP / API-R0-CIN).
  'approve_client_compliance_profile(uuid)',
  'transition_compliance_instance(uuid,text,text)',
  // IMP-040: Layer-B task transition + dependency-graph commands
  // (API-R0-TSK, RLS-TSK-01/02).
  'transition_task(uuid,text,text,text,text)',
  'add_task_dependency(uuid,uuid,text,text)',
  'remove_task_dependency(uuid,uuid,text)',
  // IMP-042: Layer-B alert transition commands (API-R0-ALR, RLS-ALR-01)
  // and the AAL2-gated alert-rule administration commands (RLS-ARL-01,
  // RLS-AAL-01).
  'acknowledge_alert(uuid,text)',
  'snooze_alert(uuid,timestamp with time zone,text)',
  'resolve_alert(uuid,text)',
  'create_alert_rule(text,text,text,jsonb,boolean,boolean,boolean)',
  'update_alert_rule(uuid,text,text,jsonb,boolean,boolean,boolean)',
  // IMP-041: Layer-B review-queue commands (API-R0-RVW, RLS-RVW-01).
  'submit_review_item(uuid,uuid,uuid,text,text,text,text,timestamp with time zone)',
  'decide_review_item(uuid,text,text,text)',
];
const SERVICE_ONLY_FNS = [
  'write_audit_event_server(uuid,text,uuid,text,text,text,jsonb,jsonb,text,uuid,uuid,text,text)',
  'mirror_login_history()',
  // IMP-050: hardened dead-letter recovery command (AUTO-RPL-01/02,
  // RLS-SVC-01) — EXECUTE to service_role only, never anon/authenticated.
  'requeue_dead_letter(uuid,text)',
];
const OWNER_ONLY_FNS = [
  'audit_write(uuid,text,uuid,text,text,text,jsonb,jsonb,text,uuid,uuid,text,text,timestamp with time zone)',
  'audit_trg_row()',
];
// IMP-020 function inventory (client-hierarchy helpers + guard triggers).
const IMP020_HELPERS = ['active_membership_id(uuid)'];
const IMP020_TRIGGER_FNS = ['clients_validate_responsibility()', 'legal_entities_guard_entity_type()'];
// IMP-021 function inventory (engagement guard triggers; the projection RPC
// joins AUTHENTICATED_RPCS above).
const IMP021_TRIGGER_FNS = [
  'engagements_validate_responsibility()',
  'engagements_guard_status_transition()',
];
// IMP-030 function inventory: the Layer-B lifecycle command joins
// AUTHENTICATED_RPCS; three owner-only trigger functions; the immutable
// CHECK validator is intentionally PUBLIC-executable (CHECK expressions
// evaluate with the DML caller's privileges — revoking EXECUTE would break
// legitimate inserts; the function is read-only, no security surface).
const IMP030_TRIGGER_FNS = [
  'compliance_types_enforce_governance_inheritance()',
  'crv_guard_update()',
  'crv_prepare_insert()',
];
const IMP030_PUBLIC_VALIDATOR = ['compliance_workflow_template_valid(jsonb)'];
// IMP-031 function inventory: the two Layer-B commands join
// AUTHENTICATED_RPCS above; the DM-27 scope validator, the assignment/
// four-eyes validator, and the two write guards are owner-only definer
// functions (invoked by triggers/commands, never by application roles).
const IMP031_FNS = [
  'ccp_guard_write()',
  'cin_guard_write()',
  'cin_validate_assignments(uuid,uuid,uuid,uuid,uuid)',
  'compliance_scope_validate(uuid,uuid,uuid,jsonb,boolean)',
];
// IMP-040 function inventory: the three Layer-B commands join
// AUTHENTICATED_RPCS above; the task write guard, the comment immutability
// guard, and the checklist who/when stamper are owner-only trigger functions
// (invoked by triggers, never by application roles).
const IMP040_TRIGGER_FNS = [
  'task_checklist_items_stamp_done()',
  'task_comments_guard_update()',
  'tasks_guard_write()',
];
// IMP-040 policy helper: the senior/article creation predicate consults
// tasks itself — the DEC-J definer pattern (active_membership_role
// precedent) to avoid RLS self-recursion; authenticated-executable.
const IMP040_HELPERS = ['task_client_in_assigned_scope(uuid,uuid)'];
// IMP-041 function inventory: the two Layer-B commands join
// AUTHENTICATED_RPCS above; the subject-binding / single-writer write guard
// is an owner-only definer trigger function (invoked by the trigger, never
// by application roles).
const IMP041_TRIGGER_FNS = ['review_items_guard_write()'];
// IMP-042 function inventory: the five Layer-B commands join
// AUTHENTICATED_RPCS above; the alerts single-writer write guard is an
// owner-only definer trigger function (invoked by the trigger, never by
// application roles). alert_rules carries NO guard — its browser write
// surface is empty and its only writers are the two AAL2-gated commands.
const IMP042_TRIGGER_FNS = ['alerts_guard_write()'];
// IMP-050 function inventory: requeue_dead_letter joins SERVICE_ONLY_FNS
// above. Every other new public function is owner-only — no EXECUTE for
// anon/authenticated/service_role/public (AUTO-SCH-03c, RLS-EVO-01/
// SJR-01/SDL-01): the three SCH-33/34/35 write guards, the transactional
// outbox writer + producer trigger, the recurrence helpers/core/generator,
// the scheduler entry, the outbox drain, cron registration, and the
// immediate-path correlation helper.
const IMP050_FNS = [
  'drain_event_outbox()',
  'evaluate_recurrence()',
  'event_publish_trg()',
  'evo_guard_update()',
  'generate_profile_instances(uuid,date,uuid)',
  'generate_successor_instance(uuid,uuid)',
  'immediate_automation_correlation()',
  'publish_domain_event(text,uuid,jsonb)',
  'recurrence_due_date(jsonb,date,date)',
  'recurrence_insert_instance(client_compliance_profiles,uuid,date,date,date,uuid,uuid,uuid,uuid)',
  'recurrence_lookahead_days(uuid)',
  'recurrence_period_anchor(text,date)',
  'recurrence_period_label(text,date)',
  'register_scheduler_jobs()',
  'sjr_guard_update()',
  'sdl_guard_write()',
  // IMP-051: the sched.alerts.evaluate job function — owner-only EXECUTE
  // (AUTO-SCH-03c); no anon/authenticated/service_role/public capability.
  'evaluate_alerts()',
];

describe('IMP-012/013/020/021/030/031 catalog — least-privilege grants (RLS-SVC-03, RLS-AUD-01)', () => {
  it('anon has no privileges on any public table or function', () => {
    expect(
      psql(`select count(*) from information_schema.role_table_grants
            where table_schema = 'public' and grantee = 'anon'`).trim(),
    ).toBe('0');
    for (const fn of [
      ...IMP012_HELPERS,
      ...AUTHENTICATED_RPCS,
      ...SERVICE_ONLY_FNS,
      ...OWNER_ONLY_FNS,
      ...IMP020_HELPERS,
      ...IMP020_TRIGGER_FNS,
      ...IMP021_TRIGGER_FNS,
      ...IMP030_TRIGGER_FNS,
      ...IMP031_FNS,
      ...IMP040_TRIGGER_FNS,
      ...IMP040_HELPERS,
      ...IMP041_TRIGGER_FNS,
      ...IMP042_TRIGGER_FNS,
      ...IMP050_FNS,
    ]) {
      expect(
        psql(`select has_function_privilege('anon', 'public.${fn}', 'EXECUTE')`).trim(),
      ).toBe('f');
    }
    // IMP-030 documented exception: the immutable CHECK validator stays
    // PUBLIC-executable (CHECK constraints evaluate as the DML caller).
    for (const fn of IMP030_PUBLIC_VALIDATOR) {
      expect(
        psql(`select has_function_privilege('anon', 'public.${fn}', 'EXECUTE')`).trim(),
      ).toBe('t');
    }
  });

  it('authenticated table-level grants are exactly the approved set', () => {
    // Table-level SELECT is granted only where the whole row is meant to be
    // visible to an authorized tenant member (firms, firm_memberships,
    // audit_log, and the five IMP-020 client-hierarchy tables — RLS does
    // the row filtering). profiles SELECT is column-level (next test).
    // Write privileges stay column-pinned: id/firm_id/parent links and the
    // immutable identifiers (entity_type, registration type/value) are not
    // writable through PostgREST at all. audit_log remains SELECT-only —
    // no INSERT/UPDATE/DELETE for any application role (RLS-AUD-01,
    // AUD-INV-01).
    expect(
      rows(`select table_name || ':' || privilege_type
            from information_schema.role_table_grants
            where table_schema = 'public' and grantee = 'authenticated'`),
    ).toEqual([
      // IMP-042: alerts + alert_rules SELECT only (RLS does the row
      // filtering); ALL writes are Layer-B commands — there is deliberately
      // no INSERT/UPDATE/DELETE grant on either table (API-ARCH-04).
      'alert_rules:SELECT',
      'alerts:SELECT',
      'audit_log:SELECT',
      'client_compliance_profiles:SELECT',
      // IMP-051: the two security_invoker deadline views (API-R0-DLN);
      // SELECT only, the underlying tables' RLS does the row filtering.
      'client_dependency_board:SELECT',
      'client_relationships:SELECT',
      'clients:SELECT',
      'compliance_instances:SELECT',
      'compliance_rule_versions:SELECT',
      'compliance_types:SELECT',
      'contacts:SELECT',
      'deadline_board:SELECT',
      'engagements:SELECT',
      'firm_memberships:SELECT',
      'firms:SELECT',
      'legal_entities:SELECT',
      'registrations:SELECT',
      // IMP-041 PASS B: review_items SELECT only (RLS does the row
      // filtering); submission/decision writes are Layer-B commands — there
      // is deliberately no INSERT/UPDATE/DELETE grant (API-ARCH-04).
      'review_items:SELECT',
      // IMP-040 PASS B: task-family SELECT (RLS does the row filtering) +
      // the one table-level DELETE (checklist lines, governed by the
      // parent-task DELETE policy — no other task-family delete exists).
      'task_checklist_items:DELETE',
      'task_checklist_items:SELECT',
      'task_comments:SELECT',
      'task_dependencies:SELECT',
      'tasks:SELECT',
    ]);
  });

  it('authenticated column-level grants are exactly the approved set', () => {
    // role_column_grants expands table-level SELECT into per-column rows.
    // IMP-013 removed the firm_memberships INSERT/UPDATE column grants
    // (Layer-B RPC transition) — the raw write surface is gone.
    expect(
      rows(`select table_name || ':' || privilege_type || ':' || column_name
            from information_schema.role_column_grants
            where table_schema = 'public' and grantee = 'authenticated'`),
    ).toEqual(
      [
        // IMP-042 alerts family — SELECT covers all readable columns on
        // both tables; NO insert/update/delete column grant exists
        // (command-owned writes).
        'alert_rules:SELECT:auto_resolve',
        'alert_rules:SELECT:config',
        'alert_rules:SELECT:created_at',
        'alert_rules:SELECT:enabled',
        'alert_rules:SELECT:firm_id',
        'alert_rules:SELECT:id',
        'alert_rules:SELECT:name',
        'alert_rules:SELECT:requires_explicit_ack',
        'alert_rules:SELECT:rule_key',
        'alert_rules:SELECT:severity',
        'alert_rules:SELECT:updated_at',
        'alerts:SELECT:acknowledged_at',
        'alerts:SELECT:acknowledged_by',
        'alerts:SELECT:affected',
        'alerts:SELECT:alert_rule_id',
        'alerts:SELECT:client_id',
        'alerts:SELECT:compliance_instance_id',
        'alerts:SELECT:created_at',
        'alerts:SELECT:detail',
        'alerts:SELECT:firm_id',
        'alerts:SELECT:id',
        'alerts:SELECT:raised_at',
        'alerts:SELECT:resolution_type',
        'alerts:SELECT:resolved_at',
        'alerts:SELECT:resolved_by',
        'alerts:SELECT:severity',
        'alerts:SELECT:snoozed_until',
        'alerts:SELECT:status',
        'alerts:SELECT:title',
        'alerts:SELECT:updated_at',
        'audit_log:SELECT:action',
        'audit_log:SELECT:actor_type',
        'audit_log:SELECT:actor_user_id',
        'audit_log:SELECT:correlation_id',
        'audit_log:SELECT:created_at',
        'audit_log:SELECT:firm_id',
        'audit_log:SELECT:id',
        'audit_log:SELECT:ip',
        'audit_log:SELECT:new_value',
        'audit_log:SELECT:object_id',
        'audit_log:SELECT:object_type',
        'audit_log:SELECT:old_value',
        'audit_log:SELECT:service_name',
        'audit_log:SELECT:support_session_id',
        'audit_log:SELECT:user_agent',
        // IMP-031 compliance profiles — SELECT covers readable columns;
        // INSERT excludes id/status/approved_by/approved_at (server-managed
        // or command-stamped); UPDATE is answers/registration_id plus the
        // non-active status moves the write guard still gates.
        'client_compliance_profiles:INSERT:applicability_answers',
        'client_compliance_profiles:INSERT:compliance_type_id',
        'client_compliance_profiles:INSERT:firm_id',
        'client_compliance_profiles:INSERT:legal_entity_id',
        'client_compliance_profiles:INSERT:registration_id',
        'client_compliance_profiles:SELECT:applicability_answers',
        'client_compliance_profiles:SELECT:approved_at',
        'client_compliance_profiles:SELECT:approved_by',
        'client_compliance_profiles:SELECT:compliance_type_id',
        'client_compliance_profiles:SELECT:created_at',
        'client_compliance_profiles:SELECT:firm_id',
        'client_compliance_profiles:SELECT:id',
        'client_compliance_profiles:SELECT:legal_entity_id',
        'client_compliance_profiles:SELECT:registration_id',
        'client_compliance_profiles:SELECT:status',
        'client_compliance_profiles:SELECT:updated_at',
        'client_compliance_profiles:UPDATE:applicability_answers',
        'client_compliance_profiles:UPDATE:registration_id',
        'client_compliance_profiles:UPDATE:status',
        // IMP-051 client_dependency_board (API-R0-DLN) — security_invoker
        // view; table-level SELECT expands to all 14 view columns, NO
        // insert/update/delete grant exists (read model only).
        'client_dependency_board:SELECT:age_days',
        'client_dependency_board:SELECT:assignee_membership_id',
        'client_dependency_board:SELECT:client_id',
        'client_dependency_board:SELECT:client_name',
        'client_dependency_board:SELECT:due_date',
        'client_dependency_board:SELECT:firm_id',
        'client_dependency_board:SELECT:id',
        'client_dependency_board:SELECT:kind',
        'client_dependency_board:SELECT:label',
        'client_dependency_board:SELECT:period_label',
        'client_dependency_board:SELECT:reviewer_membership_id',
        'client_dependency_board:SELECT:status',
        'client_dependency_board:SELECT:waiting_reason',
        'client_dependency_board:SELECT:waiting_since',
        // IMP-031 compliance instances — SELECT covers readable columns;
        // INSERT excludes id/client_id (trigger-derived)/state/filed_at/
        // closed_at/risk/successor (command-stamped or server-owned) AND the
        // recurrence provenance set rule_version_id/generation_source/
        // generated_at/calculated_due_date (server-owned — the IMP-050
        // generator writes it; browser INSERT carrying it is a 42501,
        // AUTO-REC-07); UPDATE is exactly the permitted non-state set
        // (RLS-CIN-01).
        'compliance_instances:INSERT:assignee_membership_id',
        'compliance_instances:INSERT:client_compliance_profile_id',
        'compliance_instances:INSERT:compliance_type_id',
        'compliance_instances:INSERT:due_date',
        'compliance_instances:INSERT:engagement_id',
        'compliance_instances:INSERT:firm_id',
        'compliance_instances:INSERT:legal_entity_id',
        'compliance_instances:INSERT:partner_membership_id',
        'compliance_instances:INSERT:period_end',
        'compliance_instances:INSERT:period_label',
        'compliance_instances:INSERT:period_meta',
        'compliance_instances:INSERT:period_start',
        'compliance_instances:INSERT:priority',
        'compliance_instances:INSERT:registration_id',
        'compliance_instances:INSERT:reviewer_membership_id',
        'compliance_instances:SELECT:assignee_membership_id',
        'compliance_instances:SELECT:calculated_due_date',
        'compliance_instances:SELECT:client_compliance_profile_id',
        'compliance_instances:SELECT:client_id',
        'compliance_instances:SELECT:closed_at',
        'compliance_instances:SELECT:compliance_type_id',
        'compliance_instances:SELECT:created_at',
        'compliance_instances:SELECT:due_date',
        'compliance_instances:SELECT:engagement_id',
        'compliance_instances:SELECT:filed_at',
        'compliance_instances:SELECT:firm_id',
        'compliance_instances:SELECT:generated_at',
        'compliance_instances:SELECT:generation_source',
        'compliance_instances:SELECT:id',
        'compliance_instances:SELECT:legal_entity_id',
        'compliance_instances:SELECT:partner_membership_id',
        'compliance_instances:SELECT:period_end',
        'compliance_instances:SELECT:period_label',
        'compliance_instances:SELECT:period_meta',
        'compliance_instances:SELECT:period_start',
        'compliance_instances:SELECT:priority',
        'compliance_instances:SELECT:registration_id',
        'compliance_instances:SELECT:reviewer_membership_id',
        'compliance_instances:SELECT:risk_factors',
        'compliance_instances:SELECT:risk_score',
        'compliance_instances:SELECT:rule_version_id',
        'compliance_instances:SELECT:state',
        'compliance_instances:SELECT:successor_instance_id',
        'compliance_instances:SELECT:updated_at',
        'compliance_instances:UPDATE:assignee_membership_id',
        'compliance_instances:UPDATE:due_date',
        'compliance_instances:UPDATE:engagement_id',
        'compliance_instances:UPDATE:partner_membership_id',
        'compliance_instances:UPDATE:period_label',
        'compliance_instances:UPDATE:period_meta',
        'compliance_instances:UPDATE:priority',
        'compliance_instances:UPDATE:reviewer_membership_id',
        // IMP-020 client hierarchy — SELECT covers readable columns;
        // INSERT/UPDATE stay column-pinned (no id/firm_id/parent/identifier
        // mutation through PostgREST).
        'client_relationships:INSERT:effective_from',
        'client_relationships:INSERT:effective_to',
        'client_relationships:INSERT:firm_id',
        'client_relationships:INSERT:from_entity_id',
        'client_relationships:INSERT:relation_type',
        'client_relationships:INSERT:status',
        'client_relationships:INSERT:to_entity_id',
        'client_relationships:SELECT:created_at',
        'client_relationships:SELECT:effective_from',
        'client_relationships:SELECT:effective_to',
        'client_relationships:SELECT:firm_id',
        'client_relationships:SELECT:from_entity_id',
        'client_relationships:SELECT:id',
        'client_relationships:SELECT:relation_type',
        'client_relationships:SELECT:status',
        'client_relationships:SELECT:to_entity_id',
        'client_relationships:SELECT:updated_at',
        'client_relationships:UPDATE:effective_from',
        'client_relationships:UPDATE:effective_to',
        'client_relationships:UPDATE:relation_type',
        'client_relationships:UPDATE:status',
        'clients:INSERT:firm_id',
        'clients:INSERT:industry',
        'clients:INSERT:manager_membership_id',
        'clients:INSERT:name',
        'clients:INSERT:owner_partner_membership_id',
        'clients:INSERT:risk_rating',
        'clients:INSERT:status',
        'clients:INSERT:tags',
        'clients:SELECT:created_at',
        'clients:SELECT:firm_id',
        'clients:SELECT:id',
        'clients:SELECT:industry',
        'clients:SELECT:manager_membership_id',
        'clients:SELECT:name',
        'clients:SELECT:owner_partner_membership_id',
        'clients:SELECT:risk_rating',
        'clients:SELECT:status',
        'clients:SELECT:tags',
        'clients:SELECT:updated_at',
        'clients:UPDATE:industry',
        'clients:UPDATE:manager_membership_id',
        'clients:UPDATE:name',
        'clients:UPDATE:owner_partner_membership_id',
        'clients:UPDATE:risk_rating',
        'clients:UPDATE:status',
        'clients:UPDATE:tags',
        // IMP-030 compliance rules — SELECT covers readable columns;
        // INSERT excludes id/created_at/status/domain_approval_status/
        // created_by (server-managed or derived); UPDATE is payload-only
        // (no lifecycle/governance/provenance columns).
        'compliance_rule_versions:INSERT:compliance_type_id',
        'compliance_rule_versions:INSERT:due_rule',
        'compliance_rule_versions:INSERT:effective_from',
        'compliance_rule_versions:INSERT:firm_id',
        'compliance_rule_versions:INSERT:frequency',
        'compliance_rule_versions:INSERT:version',
        'compliance_rule_versions:SELECT:compliance_type_id',
        'compliance_rule_versions:SELECT:created_at',
        'compliance_rule_versions:SELECT:created_by',
        'compliance_rule_versions:SELECT:domain_approval_status',
        'compliance_rule_versions:SELECT:due_rule',
        'compliance_rule_versions:SELECT:effective_from',
        'compliance_rule_versions:SELECT:effective_to',
        'compliance_rule_versions:SELECT:firm_id',
        'compliance_rule_versions:SELECT:frequency',
        'compliance_rule_versions:SELECT:id',
        'compliance_rule_versions:SELECT:status',
        'compliance_rule_versions:SELECT:version',
        'compliance_rule_versions:UPDATE:due_rule',
        'compliance_rule_versions:UPDATE:effective_from',
        'compliance_rule_versions:UPDATE:frequency',
        'compliance_types:INSERT:acknowledgement_required',
        'compliance_types:INSERT:applicability',
        'compliance_types:INSERT:authority',
        'compliance_types:INSERT:category',
        'compliance_types:INSERT:checklist_template',
        'compliance_types:INSERT:client_approval_required',
        'compliance_types:INSERT:due_rule',
        'compliance_types:INSERT:filing_confirmation_required',
        'compliance_types:INSERT:firm_id',
        'compliance_types:INSERT:four_eyes_required',
        'compliance_types:INSERT:frequency',
        'compliance_types:INSERT:governance_class',
        'compliance_types:INSERT:name',
        'compliance_types:INSERT:registration_class',
        'compliance_types:INSERT:required_documents',
        'compliance_types:INSERT:scope_kind',
        'compliance_types:INSERT:type_key',
        'compliance_types:INSERT:workflow_template',
        'compliance_types:SELECT:acknowledgement_required',
        'compliance_types:SELECT:applicability',
        'compliance_types:SELECT:authority',
        'compliance_types:SELECT:category',
        'compliance_types:SELECT:checklist_template',
        'compliance_types:SELECT:client_approval_required',
        'compliance_types:SELECT:created_at',
        'compliance_types:SELECT:due_rule',
        'compliance_types:SELECT:filing_confirmation_required',
        'compliance_types:SELECT:firm_id',
        'compliance_types:SELECT:four_eyes_required',
        'compliance_types:SELECT:frequency',
        'compliance_types:SELECT:governance_class',
        'compliance_types:SELECT:id',
        'compliance_types:SELECT:name',
        'compliance_types:SELECT:registration_class',
        'compliance_types:SELECT:required_documents',
        'compliance_types:SELECT:scope_kind',
        'compliance_types:SELECT:status',
        'compliance_types:SELECT:type_key',
        'compliance_types:SELECT:updated_at',
        'compliance_types:SELECT:workflow_template',
        'compliance_types:UPDATE:acknowledgement_required',
        'compliance_types:UPDATE:applicability',
        'compliance_types:UPDATE:authority',
        'compliance_types:UPDATE:category',
        'compliance_types:UPDATE:checklist_template',
        'compliance_types:UPDATE:client_approval_required',
        'compliance_types:UPDATE:due_rule',
        'compliance_types:UPDATE:filing_confirmation_required',
        'compliance_types:UPDATE:four_eyes_required',
        'compliance_types:UPDATE:frequency',
        'compliance_types:UPDATE:name',
        'compliance_types:UPDATE:registration_class',
        'compliance_types:UPDATE:required_documents',
        'compliance_types:UPDATE:scope_kind',
        'compliance_types:UPDATE:status',
        'compliance_types:UPDATE:workflow_template',
        'contacts:INSERT:client_id',
        'contacts:INSERT:email',
        'contacts:INSERT:firm_id',
        'contacts:INSERT:is_primary',
        'contacts:INSERT:legal_entity_id',
        'contacts:INSERT:name',
        'contacts:INSERT:phone',
        'contacts:INSERT:role_title',
        'contacts:INSERT:status',
        'contacts:SELECT:client_id',
        'contacts:SELECT:created_at',
        'contacts:SELECT:email',
        'contacts:SELECT:firm_id',
        'contacts:SELECT:id',
        'contacts:SELECT:is_primary',
        'contacts:SELECT:legal_entity_id',
        'contacts:SELECT:name',
        'contacts:SELECT:phone',
        'contacts:SELECT:role_title',
        'contacts:SELECT:status',
        'contacts:SELECT:updated_at',
        'contacts:UPDATE:email',
        'contacts:UPDATE:is_primary',
        'contacts:UPDATE:legal_entity_id',
        'contacts:UPDATE:name',
        'contacts:UPDATE:phone',
        'contacts:UPDATE:role_title',
        'contacts:UPDATE:status',
        // IMP-051 deadline_board (API-R0-DLN) — security_invoker view;
        // table-level SELECT expands to all 14 view columns, NO
        // insert/update/delete grant exists (read model only).
        'deadline_board:SELECT:at_risk',
        'deadline_board:SELECT:compliance_name',
        'deadline_board:SELECT:compliance_type_id',
        'deadline_board:SELECT:days_left',
        'deadline_board:SELECT:due_date',
        'deadline_board:SELECT:filed',
        'deadline_board:SELECT:firm_id',
        'deadline_board:SELECT:group_id',
        'deadline_board:SELECT:in_progress',
        'deadline_board:SELECT:not_started',
        'deadline_board:SELECT:ready_to_file',
        'deadline_board:SELECT:total_clients',
        'deadline_board:SELECT:under_review',
        'deadline_board:SELECT:waiting',
        // IMP-021 engagements — SELECT covers readable columns; INSERT is
        // column-pinned (no id), UPDATE excludes firm_id/client_id
        // (parentage never changes).
        'engagements:INSERT:client_id',
        'engagements:INSERT:firm_id',
        'engagements:INSERT:letter_status',
        'engagements:INSERT:period_label',
        'engagements:INSERT:proposed_at',
        'engagements:INSERT:responsible_partner_membership_id',
        'engagements:INSERT:service_lines',
        'engagements:INSERT:signed_at',
        'engagements:INSERT:status',
        'engagements:INSERT:termination_reason',
        'engagements:SELECT:client_id',
        'engagements:SELECT:created_at',
        'engagements:SELECT:firm_id',
        'engagements:SELECT:id',
        'engagements:SELECT:letter_status',
        'engagements:SELECT:period_label',
        'engagements:SELECT:proposed_at',
        'engagements:SELECT:responsible_partner_membership_id',
        'engagements:SELECT:service_lines',
        'engagements:SELECT:signed_at',
        'engagements:SELECT:status',
        'engagements:SELECT:termination_reason',
        'engagements:SELECT:updated_at',
        'engagements:UPDATE:letter_status',
        'engagements:UPDATE:period_label',
        'engagements:UPDATE:proposed_at',
        'engagements:UPDATE:responsible_partner_membership_id',
        'engagements:UPDATE:service_lines',
        'engagements:UPDATE:signed_at',
        'engagements:UPDATE:status',
        'engagements:UPDATE:termination_reason',
        'firm_memberships:SELECT:created_at',
        'firm_memberships:SELECT:firm_id',
        'firm_memberships:SELECT:id',
        'firm_memberships:SELECT:invited_by',
        'firm_memberships:SELECT:role',
        'firm_memberships:SELECT:status',
        'firm_memberships:SELECT:updated_at',
        'firm_memberships:SELECT:user_id',
        'firms:SELECT:city',
        'firms:SELECT:created_at',
        'firms:SELECT:frn',
        'firms:SELECT:id',
        'firms:SELECT:name',
        'firms:SELECT:plan',
        'firms:SELECT:settings',
        'firms:SELECT:status',
        'firms:SELECT:updated_at',
        'firms:UPDATE:city',
        'firms:UPDATE:frn',
        'firms:UPDATE:name',
        'firms:UPDATE:settings',
        'legal_entities:INSERT:client_id',
        'legal_entities:INSERT:entity_type',
        'legal_entities:INSERT:firm_id',
        'legal_entities:INSERT:incorporation_date',
        'legal_entities:INSERT:legal_name',
        'legal_entities:INSERT:registered_address',
        'legal_entities:INSERT:status',
        'legal_entities:SELECT:client_id',
        'legal_entities:SELECT:created_at',
        'legal_entities:SELECT:entity_type',
        'legal_entities:SELECT:firm_id',
        'legal_entities:SELECT:id',
        'legal_entities:SELECT:incorporation_date',
        'legal_entities:SELECT:legal_name',
        'legal_entities:SELECT:registered_address',
        'legal_entities:SELECT:status',
        'legal_entities:SELECT:updated_at',
        'legal_entities:UPDATE:incorporation_date',
        'legal_entities:UPDATE:legal_name',
        'legal_entities:UPDATE:registered_address',
        'legal_entities:UPDATE:status',
        'profiles:SELECT:avatar_url',
        'profiles:SELECT:full_name',
        'profiles:SELECT:id',
        'profiles:UPDATE:avatar_url',
        'profiles:UPDATE:full_name',
        'profiles:UPDATE:phone',
        'registrations:INSERT:firm_id',
        'registrations:INSERT:legal_entity_id',
        'registrations:INSERT:meta',
        'registrations:INSERT:state',
        'registrations:INSERT:status',
        'registrations:INSERT:type',
        'registrations:INSERT:valid_from',
        'registrations:INSERT:valid_to',
        'registrations:INSERT:value',
        'registrations:SELECT:created_at',
        'registrations:SELECT:firm_id',
        'registrations:SELECT:id',
        'registrations:SELECT:legal_entity_id',
        'registrations:SELECT:meta',
        'registrations:SELECT:state',
        'registrations:SELECT:status',
        'registrations:SELECT:type',
        'registrations:SELECT:updated_at',
        'registrations:SELECT:valid_from',
        'registrations:SELECT:valid_to',
        'registrations:SELECT:value',
        'registrations:UPDATE:meta',
        'registrations:UPDATE:state',
        'registrations:UPDATE:status',
        'registrations:UPDATE:valid_from',
        'registrations:UPDATE:valid_to',
        // IMP-041 PASS B review_items — SELECT covers all readable columns;
        // NO insert/update/delete column grant exists (command-owned writes).
        'review_items:SELECT:ai_output_id',
        'review_items:SELECT:client_id',
        'review_items:SELECT:compliance_instance_id',
        'review_items:SELECT:created_at',
        'review_items:SELECT:decided_at',
        'review_items:SELECT:decided_by_membership_id',
        'review_items:SELECT:decision_rationale',
        'review_items:SELECT:firm_id',
        'review_items:SELECT:id',
        'review_items:SELECT:note',
        'review_items:SELECT:priority',
        'review_items:SELECT:sla_due_at',
        'review_items:SELECT:source',
        'review_items:SELECT:status',
        'review_items:SELECT:submitted_at',
        'review_items:SELECT:submitted_by_membership_id',
        'review_items:SELECT:task_id',
        'review_items:SELECT:title',
        'review_items:SELECT:type',
        'review_items:SELECT:updated_at',
        // IMP-040 PASS B task family — SELECT covers readable columns on all
        // four tables. tasks INSERT is exactly the caller-supplied set (no
        // id/created_at/updated_at, no status — forced default 'open',
        // transition-command-only — and no waiting_reason, transition-owned);
        // tasks UPDATE is the routine non-state set (no status /
        // waiting_reason / client_id / identity). Checklist INSERT excludes
        // id/done_at/created_at/updated_at (done_at is server-stamped by the
        // who/when trigger; done_by is accepted but force-stamped to the
        // caller); checklist UPDATE is label/is_done/done_by/sort_order
        // (template_source is insert-only provenance). Comments INSERT is
        // firm_id/task_id/author_id/body (retracted forced default false);
        // comments UPDATE is retracted ONLY (RLS-TCM-01). task_dependencies
        // has NO write grant at any column — the graph is command-owned
        // (RLS-TSK-02).
        'task_checklist_items:INSERT:done_by',
        'task_checklist_items:INSERT:firm_id',
        'task_checklist_items:INSERT:is_done',
        'task_checklist_items:INSERT:label',
        'task_checklist_items:INSERT:sort_order',
        'task_checklist_items:INSERT:task_id',
        'task_checklist_items:INSERT:template_source',
        'task_checklist_items:SELECT:created_at',
        'task_checklist_items:SELECT:done_at',
        'task_checklist_items:SELECT:done_by',
        'task_checklist_items:SELECT:firm_id',
        'task_checklist_items:SELECT:id',
        'task_checklist_items:SELECT:is_done',
        'task_checklist_items:SELECT:label',
        'task_checklist_items:SELECT:sort_order',
        'task_checklist_items:SELECT:task_id',
        'task_checklist_items:SELECT:template_source',
        'task_checklist_items:SELECT:updated_at',
        'task_checklist_items:UPDATE:done_by',
        'task_checklist_items:UPDATE:is_done',
        'task_checklist_items:UPDATE:label',
        'task_checklist_items:UPDATE:sort_order',
        'task_comments:INSERT:author_id',
        'task_comments:INSERT:body',
        'task_comments:INSERT:firm_id',
        'task_comments:INSERT:task_id',
        'task_comments:SELECT:author_id',
        'task_comments:SELECT:body',
        'task_comments:SELECT:created_at',
        'task_comments:SELECT:firm_id',
        'task_comments:SELECT:id',
        'task_comments:SELECT:retracted',
        'task_comments:SELECT:task_id',
        'task_comments:UPDATE:retracted',
        'task_dependencies:SELECT:created_at',
        'task_dependencies:SELECT:dependency_type',
        'task_dependencies:SELECT:depends_on_task_id',
        'task_dependencies:SELECT:firm_id',
        'task_dependencies:SELECT:id',
        'task_dependencies:SELECT:task_id',
        'tasks:INSERT:assignee_membership_id',
        'tasks:INSERT:client_id',
        'tasks:INSERT:compliance_instance_id',
        'tasks:INSERT:description',
        'tasks:INSERT:due_date',
        'tasks:INSERT:firm_id',
        'tasks:INSERT:next_action',
        'tasks:INSERT:priority',
        'tasks:INSERT:reviewer_membership_id',
        'tasks:INSERT:time_spent_minutes',
        'tasks:INSERT:title',
        'tasks:SELECT:assignee_membership_id',
        'tasks:SELECT:client_id',
        'tasks:SELECT:compliance_instance_id',
        'tasks:SELECT:created_at',
        'tasks:SELECT:description',
        'tasks:SELECT:due_date',
        'tasks:SELECT:firm_id',
        'tasks:SELECT:id',
        'tasks:SELECT:next_action',
        'tasks:SELECT:priority',
        'tasks:SELECT:reviewer_membership_id',
        'tasks:SELECT:status',
        'tasks:SELECT:time_spent_minutes',
        'tasks:SELECT:title',
        'tasks:SELECT:updated_at',
        'tasks:SELECT:waiting_reason',
        'tasks:UPDATE:assignee_membership_id',
        'tasks:UPDATE:compliance_instance_id',
        'tasks:UPDATE:description',
        'tasks:UPDATE:due_date',
        'tasks:UPDATE:next_action',
        'tasks:UPDATE:priority',
        'tasks:UPDATE:reviewer_membership_id',
        'tasks:UPDATE:time_spent_minutes',
        'tasks:UPDATE:title',
      ].sort(),
    );
  });

  it('helper/RPC EXECUTE privileges are exactly the approved set (not PUBLIC)', () => {
    for (const fn of [...IMP012_HELPERS, ...AUTHENTICATED_RPCS, ...IMP020_HELPERS, ...IMP040_HELPERS]) {
      expect(psql(`select has_function_privilege('authenticated', 'public.${fn}', 'EXECUTE')`).trim()).toBe('t');
    }
    for (const fn of [...SERVICE_ONLY_FNS, ...OWNER_ONLY_FNS, ...IMP020_TRIGGER_FNS, ...IMP021_TRIGGER_FNS, ...IMP030_TRIGGER_FNS, ...IMP031_FNS, ...IMP040_TRIGGER_FNS, ...IMP041_TRIGGER_FNS, ...IMP042_TRIGGER_FNS, ...IMP050_FNS]) {
      expect(psql(`select has_function_privilege('authenticated', 'public.${fn}', 'EXECUTE')`).trim()).toBe('f');
    }
    for (const fn of SERVICE_ONLY_FNS) {
      expect(psql(`select has_function_privilege('service_role', 'public.${fn}', 'EXECUTE')`).trim()).toBe('t');
    }
    for (const fn of [...AUTHENTICATED_RPCS, ...OWNER_ONLY_FNS, ...IMP020_TRIGGER_FNS, ...IMP021_TRIGGER_FNS, ...IMP030_TRIGGER_FNS, ...IMP031_FNS, ...IMP040_TRIGGER_FNS, ...IMP040_HELPERS, ...IMP041_TRIGGER_FNS, ...IMP042_TRIGGER_FNS, ...IMP050_FNS]) {
      expect(psql(`select has_function_privilege('service_role', 'public.${fn}', 'EXECUTE')`).trim()).toBe('f');
    }
    // IMP-020: active_membership_id is a policy helper deliberately usable
    // by the (never browser-shipped) service role as well.
    for (const fn of IMP020_HELPERS) {
      expect(psql(`select has_function_privilege('service_role', 'public.${fn}', 'EXECUTE')`).trim()).toBe('t');
    }
    for (const fn of [
      ...IMP012_HELPERS,
      ...AUTHENTICATED_RPCS,
      ...SERVICE_ONLY_FNS,
      ...OWNER_ONLY_FNS,
      ...IMP020_HELPERS,
      ...IMP020_TRIGGER_FNS,
      ...IMP021_TRIGGER_FNS,
      ...IMP030_TRIGGER_FNS,
      ...IMP031_FNS,
      ...IMP040_TRIGGER_FNS,
      ...IMP040_HELPERS,
      ...IMP041_TRIGGER_FNS,
      ...IMP042_TRIGGER_FNS,
      ...IMP050_FNS,
    ]) {
      expect(psql(`select has_function_privilege('public', 'public.${fn}', 'EXECUTE')`).trim()).toBe('f');
    }
    // IMP-030 documented exception (see the anon assertion above).
    for (const fn of IMP030_PUBLIC_VALIDATOR) {
      expect(psql(`select has_function_privilege('public', 'public.${fn}', 'EXECUTE')`).trim()).toBe('t');
    }
  });
});

describe('IMP-012/013/020/021/030/031 catalog — helper-function security properties', () => {
  // All public-schema application functions (trigger + definer paths).
  const ALL_FNS =
    "'active_membership_role', 'req_active_firm', 'shares_active_firm_with', 'set_updated_at', " +
    "'audit_write', 'audit_trg_row', 'write_audit_event', 'write_audit_event_server', 'mirror_login_history', " +
    "'invite_member', 'change_membership_role', 'suspend_membership', 'remove_membership', 'accept_invitation', " +
    "'active_membership_id', 'list_client_identities', " +
    "'clients_validate_responsibility', 'legal_entities_guard_entity_type', " +
    "'engagements_validate_responsibility', 'engagements_guard_status_transition', 'list_engagement_letter_statuses', " +
    "'activate_compliance_rule_version', 'compliance_types_enforce_governance_inheritance', " +
    "'crv_guard_update', 'crv_prepare_insert', 'compliance_workflow_template_valid', " +
    "'approve_client_compliance_profile', 'transition_compliance_instance', " +
    "'ccp_guard_write', 'cin_guard_write', 'cin_validate_assignments', 'compliance_scope_validate', " +
    "'transition_task', 'add_task_dependency', 'remove_task_dependency', 'task_client_in_assigned_scope', " +
    "'tasks_guard_write', 'task_comments_guard_update', 'task_checklist_items_stamp_done', " +
    "'review_items_guard_write', 'submit_review_item', 'decide_review_item', " +
    "'alerts_guard_write', 'acknowledge_alert', 'snooze_alert', 'resolve_alert', " +
    "'create_alert_rule', 'update_alert_rule', " +
    // IMP-050: SCH-33/34/35 write guards, the outbox writer/producer
    // trigger, the recurrence machinery, scheduler entry, drain, cron
    // registration, dead-letter recovery, and the immediate-path
    // correlation helper.
    "'evo_guard_update', 'sjr_guard_update', 'sdl_guard_write', " +
    "'publish_domain_event', 'event_publish_trg', " +
    "'recurrence_period_anchor', 'recurrence_period_label', 'recurrence_due_date', " +
    "'recurrence_lookahead_days', 'recurrence_insert_instance', " +
    "'generate_profile_instances', 'generate_successor_instance', " +
    "'evaluate_recurrence', 'drain_event_outbox', 'register_scheduler_jobs', 'requeue_dead_letter', " +
    "'immediate_automation_correlation', " +
    // IMP-051: the sched.alerts.evaluate job function (AUTO-ALR-01…03).
    "'evaluate_alerts'";

  it('SECURITY DEFINER set exactly where required (API-SEC-03 inventory)', () => {
    // Definer: the DEC-J recursion helpers (IMP-012), the IMP-013 audit
    // write paths (RLS-AUD-01: inserts only via definer functions; Layer-B
    // RPCs need definer because the raw write grants were removed), and the
    // IMP-020 responsibility-validation trigger + billing projection RPC
    // (both must read firm_memberships under FORCE-free recursion safety
    // and, for the RPC, rows the caller cannot SELECT directly).
    // NOT definer: req_active_firm (pure header read), set_updated_at
    // (pure timestamp maintenance), legal_entities_guard_entity_type and
    // engagements_guard_status_transition (pure OLD/NEW comparisons) —
    // INVOKER. IMP-031: both Layer-B commands are definer (their guarded
    // columns carry no grant and the guard's single-writer marker admits
    // only the command path); the scope/assignment validators and write
    // guards are definer so enforcement never depends on caller RLS
    // visibility under FORCE RLS. IMP-040: the three Layer-B commands are
    // definer (status/waiting_reason and the dependency graph carry no
    // browser grant; single-writer markers admit only the command paths)
    // and tasks_guard_write is definer (it reads compliance_instances /
    // compliance_types / firm_memberships under FORCE RLS);
    // task_client_in_assigned_scope is definer (RLS self-recursion on
    // tasks inside the INSERT policy — the DEC-J helper pattern);
    // task_comments_guard_update (pure OLD/NEW) and
    // task_checklist_items_stamp_done (pure NEW mutation + auth.uid()) are
    // INVOKER. IMP-041 PASS A: review_items_guard_write is definer (it reads
    // tasks / compliance_instances under FORCE RLS). IMP-041 PASS B: both
    // Layer-B review commands are definer (status/decision/submission
    // columns carry no browser grant; the single-writer marker admits only
    // the command path). IMP-042: all five Layer-B alerts-family commands are
    // definer (both tables carry SELECT-only browser grants; the
    // single-writer marker admits only the transition-command path) and
    // alerts_guard_write is definer (enforcement independent of caller RLS
    // visibility under FORCE RLS). IMP-050: the outbox writer/producer
    // trigger, recurrence_lookahead_days, the generator core + entry
    // points, the drain, cron registration, and requeue_dead_letter are
    // definer (they write the grant-closed SCH-33/34/35 tables and derive
    // actor/correlation server-side); the three SCH-33/34/35 write guards,
    // the pure date-arithmetic helpers (recurrence_period_anchor/label/
    // due_date), and immediate_automation_correlation (a pure GUC read +
    // mint with no table access) are INVOKER (crv_guard_update precedent).
    // IMP-051: evaluate_alerts is definer (it writes the grant-closed
    // alerts/scheduler tables and derives actor/correlation server-side,
    // owned by the migration role, owner-only EXECUTE).
    const definer = rows(`select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prosecdef and proname in (${ALL_FNS})`);
    expect(definer).toEqual([
      'accept_invitation',
      'acknowledge_alert',
      'activate_compliance_rule_version',
      'active_membership_id',
      'active_membership_role',
      'add_task_dependency',
      'alerts_guard_write',
      'approve_client_compliance_profile',
      'audit_trg_row',
      'audit_write',
      'ccp_guard_write',
      'change_membership_role',
      'cin_guard_write',
      'cin_validate_assignments',
      'clients_validate_responsibility',
      'compliance_scope_validate',
      'compliance_types_enforce_governance_inheritance',
      'create_alert_rule',
      'crv_prepare_insert',
      'decide_review_item',
      'drain_event_outbox',
      'engagements_validate_responsibility',
      'evaluate_alerts',
      'evaluate_recurrence',
      'event_publish_trg',
      'generate_profile_instances',
      'generate_successor_instance',
      'invite_member',
      'list_client_identities',
      'list_engagement_letter_statuses',
      'mirror_login_history',
      'publish_domain_event',
      'recurrence_insert_instance',
      'recurrence_lookahead_days',
      'register_scheduler_jobs',
      'remove_membership',
      'remove_task_dependency',
      'requeue_dead_letter',
      'resolve_alert',
      'review_items_guard_write',
      'shares_active_firm_with',
      'snooze_alert',
      'submit_review_item',
      'suspend_membership',
      'task_client_in_assigned_scope',
      'tasks_guard_write',
      'transition_compliance_instance',
      'transition_task',
      'update_alert_rule',
      'write_audit_event',
      'write_audit_event_server',
    ]);
  });

  it('all public helper functions pin a safe search_path', () => {
    const unpinned = rows(`select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and proname in (${ALL_FNS})
        and not exists (select 1 from unnest(p.proconfig) c where c = 'search_path=""')`);
    expect(unpinned).toEqual([]);
  });

  it('SECURITY DEFINER functions are owned by the migration owner (postgres)', () => {
    const owners = rows(`select distinct pg_get_userbyid(p.proowner) from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prosecdef and proname in (${ALL_FNS})`);
    expect(owners).toEqual(['postgres']);
  });

  it('no public-schema function mutates session state (no SET ROLE / session GUC persistence)', () => {
    // Only the Layer-B RPCs call set_config, and only transaction-locally
    // (is_local = true) for the single-writer trigger-skip flag. Assert no
    // function body contains a SET ROLE statement ("set role <name>" —
    // UPDATE ... SET role = <value> is a column assignment, excluded by
    // requiring a non-'=' token after the keyword), SET SESSION
    // AUTHORIZATION/CHARACTERISTICS, or a session-persistent set_config.
    const offenders = rows(`select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and proname in (${ALL_FNS})
        and (p.prosrc ~* 'set role\\s+[a-z_"]'
          or p.prosrc ~* 'set session (authorization|characteristics)'
          or p.prosrc ~* 'set_config\\([^)]*,\\s*false\\s*\\)')`);
    expect(offenders).toEqual([]);
  });
});

describe('IMP-012 catalog — DEC-J lookup path performance shape', () => {
  it('live membership lookup uses the (firm_id, user_id) unique index', () => {
    // On a tiny fixture table the planner rightly prefers Seq Scan;
    // enable_seqscan=off makes the assertion deterministic while still
    // proving the lookup is index-served (scale viability: DEC-J spike).
    const plan = psql(
      `set enable_seqscan = off;
       explain (costs off) select role from public.firm_memberships
       where firm_id = '${FIRM_A}' and user_id = '${userId('USER_A_PARTNER')}' and status = 'active'`,
    );
    expect(plan).toMatch(/Index (Scan|Only Scan) using firm_memberships_/);
  });
});
