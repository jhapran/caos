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
 * Order-independent (sorted comparisons) so harmless catalog ordering
 * changes do not break the suite.
 */
import { describe, expect, it } from 'vitest';

import { FIRM_A, psql, userId } from '../helpers.mjs';

const rows = (sql) => psql(sql).trim().split('\n').filter(Boolean).sort();

describe('IMP-012/013/020 catalog — RLS state (RLS-PRIN-02)', () => {
  it('RLS is enabled on exactly the tenant-core + audit + client-hierarchy tables', () => {
    expect(
      rows(`select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity`),
    ).toEqual([
      'audit_log',
      'client_relationships',
      'clients',
      'contacts',
      'firm_memberships',
      'firms',
      'legal_entities',
      'profiles',
      'registrations',
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
    // (IMP-012 documented exception).
    expect(
      rows(`select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind = 'r' and c.relforcerowsecurity`),
    ).toEqual([
      'audit_log',
      'client_relationships',
      'clients',
      'contacts',
      'legal_entities',
      'registrations',
    ]);
  });

  it('exact policy inventory exists (one policy per meaningful operation)', () => {
    // IMP-013 dropped the firm_memberships INSERT/UPDATE policies (raw write
    // path closed; Layer-B RPCs own administration) and added the audit_log
    // SELECT policy (RLS-AUD-01). IMP-020 adds select/insert/update policies
    // per client-hierarchy table — active-firm scoped, manager+ writes,
    // manager portfolio-scoped reads (RLS-OQ-02), no DELETE anywhere.
    expect(
      rows(`select tablename || ':' || policyname || ':' || cmd from pg_policies where schemaname = 'public'`),
    ).toEqual(
      [
        'audit_log:audit_select_partner_admin:SELECT',
        'client_relationships:client_relationships_insert_manager_plus:INSERT',
        'client_relationships:client_relationships_select_scoped:SELECT',
        'client_relationships:client_relationships_update_manager_plus:UPDATE',
        'clients:clients_insert_manager_plus:INSERT',
        'clients:clients_select_scoped:SELECT',
        'clients:clients_update_manager_plus:UPDATE',
        'contacts:contacts_insert_manager_plus:INSERT',
        'contacts:contacts_select_scoped:SELECT',
        'contacts:contacts_update_manager_plus:UPDATE',
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
];
const SERVICE_ONLY_FNS = [
  'write_audit_event_server(uuid,text,uuid,text,text,text,jsonb,jsonb,text,uuid,uuid,text,text)',
  'mirror_login_history()',
];
const OWNER_ONLY_FNS = [
  'audit_write(uuid,text,uuid,text,text,text,jsonb,jsonb,text,uuid,uuid,text,text,timestamp with time zone)',
  'audit_trg_row()',
];
// IMP-020 function inventory (client-hierarchy helpers + guard triggers).
const IMP020_HELPERS = ['active_membership_id(uuid)'];
const IMP020_TRIGGER_FNS = ['clients_validate_responsibility()', 'legal_entities_guard_entity_type()'];

describe('IMP-012/013/020 catalog — least-privilege grants (RLS-SVC-03, RLS-AUD-01)', () => {
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
    ]) {
      expect(
        psql(`select has_function_privilege('anon', 'public.${fn}', 'EXECUTE')`).trim(),
      ).toBe('f');
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
      'audit_log:SELECT',
      'client_relationships:SELECT',
      'clients:SELECT',
      'contacts:SELECT',
      'firm_memberships:SELECT',
      'firms:SELECT',
      'legal_entities:SELECT',
      'registrations:SELECT',
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
      ].sort(),
    );
  });

  it('helper/RPC EXECUTE privileges are exactly the approved set (not PUBLIC)', () => {
    for (const fn of [...IMP012_HELPERS, ...AUTHENTICATED_RPCS, ...IMP020_HELPERS]) {
      expect(psql(`select has_function_privilege('authenticated', 'public.${fn}', 'EXECUTE')`).trim()).toBe('t');
    }
    for (const fn of [...SERVICE_ONLY_FNS, ...OWNER_ONLY_FNS, ...IMP020_TRIGGER_FNS]) {
      expect(psql(`select has_function_privilege('authenticated', 'public.${fn}', 'EXECUTE')`).trim()).toBe('f');
    }
    for (const fn of SERVICE_ONLY_FNS) {
      expect(psql(`select has_function_privilege('service_role', 'public.${fn}', 'EXECUTE')`).trim()).toBe('t');
    }
    for (const fn of [...AUTHENTICATED_RPCS, ...OWNER_ONLY_FNS, ...IMP020_TRIGGER_FNS]) {
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
    ]) {
      expect(psql(`select has_function_privilege('public', 'public.${fn}', 'EXECUTE')`).trim()).toBe('f');
    }
  });
});

describe('IMP-012/013/020 catalog — helper-function security properties', () => {
  // All public-schema application functions (trigger + definer paths).
  const ALL_FNS =
    "'active_membership_role', 'req_active_firm', 'shares_active_firm_with', 'set_updated_at', " +
    "'audit_write', 'audit_trg_row', 'write_audit_event', 'write_audit_event_server', 'mirror_login_history', " +
    "'invite_member', 'change_membership_role', 'suspend_membership', 'remove_membership', 'accept_invitation', " +
    "'active_membership_id', 'list_client_identities', " +
    "'clients_validate_responsibility', 'legal_entities_guard_entity_type'";

  it('SECURITY DEFINER set exactly where required (API-SEC-03 inventory)', () => {
    // Definer: the DEC-J recursion helpers (IMP-012), the IMP-013 audit
    // write paths (RLS-AUD-01: inserts only via definer functions; Layer-B
    // RPCs need definer because the raw write grants were removed), and the
    // IMP-020 responsibility-validation trigger + billing projection RPC
    // (both must read firm_memberships under FORCE-free recursion safety
    // and, for the RPC, rows the caller cannot SELECT directly).
    // NOT definer: req_active_firm (pure header read), set_updated_at
    // (pure timestamp maintenance) and legal_entities_guard_entity_type
    // (pure OLD/NEW comparison) — INVOKER.
    const definer = rows(`select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prosecdef and proname in (${ALL_FNS})`);
    expect(definer).toEqual([
      'accept_invitation',
      'active_membership_id',
      'active_membership_role',
      'audit_trg_row',
      'audit_write',
      'change_membership_role',
      'clients_validate_responsibility',
      'invite_member',
      'list_client_identities',
      'mirror_login_history',
      'remove_membership',
      'shares_active_firm_with',
      'suspend_membership',
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
