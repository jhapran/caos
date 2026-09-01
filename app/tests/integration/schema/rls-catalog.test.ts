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
 * Order-independent (sorted comparisons) so harmless catalog ordering
 * changes do not break the suite.
 */
import { describe, expect, it } from 'vitest';

import { FIRM_A, psql, userId } from '../helpers.mjs';

const rows = (sql) => psql(sql).trim().split('\n').filter(Boolean).sort();

describe('IMP-012/013 catalog — RLS state (RLS-PRIN-02)', () => {
  it('RLS is enabled on exactly the tenant-core tables + audit_log', () => {
    expect(
      rows(`select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity`),
    ).toEqual(['audit_log', 'firm_memberships', 'firms', 'profiles']);
  });

  it('FORCE RLS is set exactly on audit_log; the tenant core remains the documented exception', () => {
    // audit_log rows are tenant-owned (DM-25), so RLS-PRIN-02's "enabled and
    // forced" applies. Forcing is safe: the table owner is postgres
    // (superuser, unaffected) and every write path is a postgres-owned
    // SECURITY DEFINER function — no legitimate writer needs owner bypass.
    // SCH-01…03 stay unforced: forcing would recurse the live-membership
    // helper on firm_memberships and break owner-run seed/maintenance writes
    // (IMP-012 documented exception).
    expect(
      rows(`select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind = 'r' and c.relforcerowsecurity`),
    ).toEqual(['audit_log']);
  });

  it('exact policy inventory exists (one policy per meaningful operation)', () => {
    // IMP-013 dropped the firm_memberships INSERT/UPDATE policies (raw write
    // path closed; Layer-B RPCs own administration) and added the audit_log
    // SELECT policy (RLS-AUD-01).
    expect(
      rows(`select tablename || ':' || policyname || ':' || cmd from pg_policies where schemaname = 'public'`),
    ).toEqual([
      'audit_log:audit_select_partner_admin:SELECT',
      'firm_memberships:memberships_select_own_or_active_firm:SELECT',
      'firms:firms_select_member:SELECT',
      'firms:firms_update_super_admin:UPDATE',
      'profiles:profiles_select_own_or_shared_firm:SELECT',
      'profiles:profiles_update_self:UPDATE',
    ]);
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
];
const SERVICE_ONLY_FNS = [
  'write_audit_event_server(uuid,text,uuid,text,text,text,jsonb,jsonb,text,uuid,uuid,text,text)',
  'mirror_login_history()',
];
const OWNER_ONLY_FNS = [
  'audit_write(uuid,text,uuid,text,text,text,jsonb,jsonb,text,uuid,uuid,text,text,timestamp with time zone)',
  'audit_trg_row()',
];

describe('IMP-012/013 catalog — least-privilege grants (RLS-SVC-03, RLS-AUD-01)', () => {
  it('anon has no privileges on any public table or function', () => {
    expect(
      psql(`select count(*) from information_schema.role_table_grants
            where table_schema = 'public' and grantee = 'anon'`).trim(),
    ).toBe('0');
    for (const fn of [...IMP012_HELPERS, ...AUTHENTICATED_RPCS, ...SERVICE_ONLY_FNS, ...OWNER_ONLY_FNS]) {
      expect(
        psql(`select has_function_privilege('anon', 'public.${fn}', 'EXECUTE')`).trim(),
      ).toBe('f');
    }
  });

  it('authenticated table-level grants are exactly the approved set', () => {
    // role_table_grants reports table-level privileges; table-level SELECT is
    // granted only where the whole row is meant to be visible (firms,
    // firm_memberships, audit_log). profiles SELECT is column-level (next
    // test). audit_log is SELECT-only — no INSERT/UPDATE/DELETE for any
    // application role (RLS-AUD-01, AUD-INV-01).
    expect(
      rows(`select table_name || ':' || privilege_type
            from information_schema.role_table_grants
            where table_schema = 'public' and grantee = 'authenticated'`),
    ).toEqual(['audit_log:SELECT', 'firm_memberships:SELECT', 'firms:SELECT']);
  });

  it('authenticated column-level grants are exactly the approved set', () => {
    // role_column_grants expands table-level SELECT into per-column rows.
    // IMP-013 removed the firm_memberships INSERT/UPDATE column grants
    // (Layer-B RPC transition) — the raw write surface is gone.
    expect(
      rows(`select table_name || ':' || privilege_type || ':' || column_name
            from information_schema.role_column_grants
            where table_schema = 'public' and grantee = 'authenticated'`),
    ).toEqual([
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
      'profiles:SELECT:avatar_url',
      'profiles:SELECT:full_name',
      'profiles:SELECT:id',
      'profiles:UPDATE:avatar_url',
      'profiles:UPDATE:full_name',
      'profiles:UPDATE:phone',
    ]);
  });

  it('helper/RPC EXECUTE privileges are exactly the approved set (not PUBLIC)', () => {
    for (const fn of [...IMP012_HELPERS, ...AUTHENTICATED_RPCS]) {
      expect(psql(`select has_function_privilege('authenticated', 'public.${fn}', 'EXECUTE')`).trim()).toBe('t');
    }
    for (const fn of [...SERVICE_ONLY_FNS, ...OWNER_ONLY_FNS]) {
      expect(psql(`select has_function_privilege('authenticated', 'public.${fn}', 'EXECUTE')`).trim()).toBe('f');
    }
    for (const fn of SERVICE_ONLY_FNS) {
      expect(psql(`select has_function_privilege('service_role', 'public.${fn}', 'EXECUTE')`).trim()).toBe('t');
    }
    for (const fn of [...AUTHENTICATED_RPCS, ...OWNER_ONLY_FNS]) {
      expect(psql(`select has_function_privilege('service_role', 'public.${fn}', 'EXECUTE')`).trim()).toBe('f');
    }
    for (const fn of [...IMP012_HELPERS, ...AUTHENTICATED_RPCS, ...SERVICE_ONLY_FNS, ...OWNER_ONLY_FNS]) {
      expect(psql(`select has_function_privilege('public', 'public.${fn}', 'EXECUTE')`).trim()).toBe('f');
    }
  });
});

describe('IMP-012/013 catalog — helper-function security properties', () => {
  // All public-schema application functions (trigger + definer paths).
  const ALL_FNS =
    "'active_membership_role', 'req_active_firm', 'shares_active_firm_with', 'set_updated_at', " +
    "'audit_write', 'audit_trg_row', 'write_audit_event', 'write_audit_event_server', 'mirror_login_history', " +
    "'invite_member', 'change_membership_role', 'suspend_membership', 'remove_membership', 'accept_invitation'";

  it('SECURITY DEFINER set exactly where required (API-SEC-03 inventory)', () => {
    // Definer: the DEC-J recursion helpers (IMP-012) and the IMP-013 audit
    // write paths (RLS-AUD-01: inserts only via definer functions; Layer-B
    // RPCs need definer because the raw write grants were removed).
    // NOT definer: req_active_firm (pure header read) and set_updated_at
    // (pure timestamp maintenance) — INVOKER.
    const definer = rows(`select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prosecdef and proname in (${ALL_FNS})`);
    expect(definer).toEqual([
      'accept_invitation',
      'active_membership_role',
      'audit_trg_row',
      'audit_write',
      'change_membership_role',
      'invite_member',
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
