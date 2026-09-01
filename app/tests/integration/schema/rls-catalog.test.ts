/**
 * IMP-012 — Catalog assertions for the foundational RLS migration
 * (spec 12 IMP-012 / spec 11 structural checks). Asserts the intended
 * security posture exists in the database itself — not just behavior:
 * RLS enabled, exact policy set, least-privilege grants, helper-function
 * security properties, and the DEC-J lookup index shape.
 *
 * Order-independent (sorted comparisons) so harmless catalog ordering
 * changes do not break the suite.
 */
import { describe, expect, it } from 'vitest';

import { FIRM_A, psql, userId } from '../helpers.mjs';

const rows = (sql) => psql(sql).trim().split('\n').filter(Boolean).sort();

describe('IMP-012 catalog — RLS state (RLS-PRIN-02)', () => {
  it('RLS is enabled on exactly the tenant-core tables', () => {
    expect(
      rows(`select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity`),
    ).toEqual(['firm_memberships', 'firms', 'profiles']);
  });

  it('FORCE RLS is intentionally NOT set on the tenant core (documented exception)', () => {
    // RLS-PRIN-02's forced requirement targets tenant-owned tables (SCH-04+).
    // Forcing SCH-01…03 would recurse the SECURITY DEFINER live-membership
    // helper and break owner-run seed/maintenance writes (no JWT).
    expect(
      rows(`select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind = 'r' and c.relforcerowsecurity`),
    ).toEqual([]);
  });

  it('exact policy inventory exists (one policy per meaningful operation)', () => {
    expect(
      rows(`select tablename || ':' || policyname || ':' || cmd from pg_policies where schemaname = 'public'`),
    ).toEqual([
      'firm_memberships:memberships_insert_super_admin_aal2:INSERT',
      'firm_memberships:memberships_select_own_or_active_firm:SELECT',
      'firm_memberships:memberships_update_super_admin_aal2:UPDATE',
      'firms:firms_select_member:SELECT',
      'firms:firms_update_super_admin:UPDATE',
      'profiles:profiles_select_own_or_shared_firm:SELECT',
      'profiles:profiles_update_self:UPDATE',
    ]);
  });
});

describe('IMP-012 catalog — least-privilege grants (RLS-SVC-03)', () => {
  it('anon has no privileges on any tenant-core table or helper function', () => {
    expect(
      psql(`select count(*) from information_schema.role_table_grants
            where table_schema = 'public' and grantee = 'anon'`).trim(),
    ).toBe('0');
    for (const fn of ['active_membership_role(uuid)', 'req_active_firm()', 'shares_active_firm_with(uuid)']) {
      expect(
        psql(`select has_function_privilege('anon', 'public.${fn}', 'EXECUTE')`).trim(),
      ).toBe('f');
    }
  });

  it('authenticated table-level grants are exactly the approved set', () => {
    // role_table_grants reports table-level privileges; table-level SELECT is
    // granted only where the whole row is meant to be visible (firms,
    // firm_memberships). profiles SELECT is column-level (see next test).
    expect(
      rows(`select table_name || ':' || privilege_type
            from information_schema.role_table_grants
            where table_schema = 'public' and grantee = 'authenticated'`),
    ).toEqual(['firm_memberships:SELECT', 'firms:SELECT']);
  });

  it('authenticated column-level grants are exactly the approved set', () => {
    // role_column_grants expands table-level SELECT into per-column rows;
    // the INSERT/UPDATE entries below are the true column-level grants.
    expect(
      rows(`select table_name || ':' || privilege_type || ':' || column_name
            from information_schema.role_column_grants
            where table_schema = 'public' and grantee = 'authenticated'`),
    ).toEqual([
      'firm_memberships:INSERT:firm_id',
      'firm_memberships:INSERT:invited_by',
      'firm_memberships:INSERT:role',
      'firm_memberships:INSERT:status',
      'firm_memberships:INSERT:user_id',
      'firm_memberships:SELECT:created_at',
      'firm_memberships:SELECT:firm_id',
      'firm_memberships:SELECT:id',
      'firm_memberships:SELECT:invited_by',
      'firm_memberships:SELECT:role',
      'firm_memberships:SELECT:status',
      'firm_memberships:SELECT:updated_at',
      'firm_memberships:SELECT:user_id',
      'firm_memberships:UPDATE:role',
      'firm_memberships:UPDATE:status',
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

  it('helper EXECUTE is granted to authenticated only (not PUBLIC)', () => {
    for (const fn of ['active_membership_role(uuid)', 'req_active_firm()', 'shares_active_firm_with(uuid)']) {
      expect(psql(`select has_function_privilege('authenticated', 'public.${fn}', 'EXECUTE')`).trim()).toBe('t');
      expect(psql(`select has_function_privilege('public', 'public.${fn}', 'EXECUTE')`).trim()).toBe('f');
    }
  });
});

describe('IMP-012 catalog — helper-function security properties', () => {
  it('SECURITY DEFINER set exactly where required (recursion/selector independence)', () => {
    const definer = rows(`select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prosecdef
        and proname in ('active_membership_role', 'req_active_firm', 'shares_active_firm_with', 'set_updated_at')`);
    expect(definer).toEqual(['active_membership_role', 'shares_active_firm_with']);
  });

  it('all public helper functions pin a safe search_path', () => {
    const unpinned = rows(`select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and proname in ('active_membership_role', 'req_active_firm', 'shares_active_firm_with', 'set_updated_at')
        and not exists (select 1 from unnest(p.proconfig) c where c = 'search_path=""')`);
    expect(unpinned).toEqual([]);
  });

  it('SECURITY DEFINER helpers are owned by the migration owner (postgres)', () => {
    const owners = rows(`select distinct pg_get_userbyid(p.proowner) from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prosecdef
        and proname in ('active_membership_role', 'shares_active_firm_with')`);
    expect(owners).toEqual(['postgres']);
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
