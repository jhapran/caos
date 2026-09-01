/**
 * IMP-010 — Tenant core schema tests (SCH-01…03).
 *
 * Maps to spec 11:
 *   TEST-SCH-02  FK behavior rejects invalid references at the constraint
 *                layer (tenant-core portion: firm_memberships FKs to firms /
 *                auth.users; profiles 1:1 FK to auth.users). The composite
 *                same-firm FK rejection cases complete when child tables
 *                land in later packages.
 *   TEST-SCH-03  unique constraints hold (memberships/profiles portion).
 * Plus structural assertions (columns/types, NOT NULL, CHECK vocabularies,
 * indexes incl. the DEC-J live-lookup path, updated_at trigger) and the
 * IMP-010 security invariant: no PostgREST access before IMP-012 RLS.
 *
 * Runs as postgres via docker psql for DDL verification (admin only);
 * PostgREST access checks run as a signed-in user, never service-role.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, FIRM_A, psql, signIn, userEmail, userId } from '../helpers.mjs';

const PARTNER = userId('USER_A_PARTNER');
const MANAGER = userId('USER_A_MANAGER');
const SENIOR = userId('USER_A_SENIOR');
const BOGUS_UUID = '99999999-9999-4999-8999-999999999999';

/** Run SQL expected to FAIL; returns the psql error text ('' if it passed). */
function sqlError(sql: string): string {
  try {
    psql(sql);
    return '';
  } catch (e) {
    const err = e as { stderr?: Buffer | string; message?: string };
    return String(err.stderr ?? err.message ?? '');
  }
}

beforeAll(() => {
  psql(`
    insert into public.firms (id, name, frn, city) values
      ('${FIRM_A}', 'Schema Test Firm A', 'AAATEST0001', 'Testpur');
    insert into public.profiles (id, full_name) values
      ('${PARTNER}', 'Test Partner A'),
      ('${MANAGER}', 'Test Manager A');
    insert into public.firm_memberships (firm_id, user_id, role, status, invited_by) values
      ('${FIRM_A}', '${PARTNER}', 'partner', 'active', null),
      ('${FIRM_A}', '${MANAGER}', 'manager', 'invited', '${PARTNER}');
  `);
});

afterAll(() => {
  psql(`
    delete from public.firm_memberships where firm_id = '${FIRM_A}';
    delete from public.profiles where id in ('${PARTNER}', '${MANAGER}');
    delete from public.firms where id = '${FIRM_A}';
  `);
});

describe('structure — tables, columns, PKs', () => {
  it('exactly the three IMP-010 tables exist in public', () => {
    // Scoped to production objects: temporary harness/spike tables
    // (hgate_/decj_/audctx_) are managed by their own suites and by the
    // gate cleanliness phase; they may coexist during a combined run.
    const tables = psql(
      `select string_agg(table_name, ',' order by table_name) from information_schema.tables
       where table_schema = 'public' and table_type = 'BASE TABLE'
         and table_name not like 'hgate%' and table_name not like 'decj%' and table_name not like 'audctx%'`,
    ).trim();
    expect(tables).toBe('firm_memberships,firms,profiles');
  });

  it('expected columns and types exist', () => {
    const cols = psql(
      `select table_name || '.' || column_name || ':' || data_type
       from information_schema.columns where table_schema = 'public'
       order by table_name, ordinal_position`,
    ).trim();
    for (const expected of [
      'firms.id:uuid', 'firms.name:text', 'firms.frn:text', 'firms.city:text',
      'firms.plan:text', 'firms.settings:jsonb', 'firms.status:text',
      'firms.created_at:timestamp with time zone', 'firms.updated_at:timestamp with time zone',
      'profiles.id:uuid', 'profiles.full_name:text', 'profiles.avatar_url:text',
      'profiles.phone:text', 'profiles.created_at:timestamp with time zone',
      'firm_memberships.id:uuid', 'firm_memberships.firm_id:uuid',
      'firm_memberships.user_id:uuid', 'firm_memberships.role:text',
      'firm_memberships.status:text', 'firm_memberships.invited_by:uuid',
    ]) {
      expect(cols).toContain(expected);
    }
  });

  it('primary keys exist on all three tables', () => {
    const pks = psql(
      `select conrelid::regclass::text from pg_constraint
       where connamespace = 'public'::regnamespace and contype = 'p'
         and conrelid in ('public.firms'::regclass, 'public.profiles'::regclass, 'public.firm_memberships'::regclass)
       order by 1`,
    ).trim();
    expect(pks.split('\n').sort()).toEqual(['firm_memberships', 'firms', 'profiles']);
  });

  it('NOT NULL is enforced on required fields', () => {
    expect(sqlError(`insert into public.firms (name) values (null)`)).toContain('null value');
    expect(sqlError(`insert into public.profiles (id, full_name) values ('${SENIOR}', null)`)).toContain('null value');
    expect(
      sqlError(`insert into public.firm_memberships (firm_id, user_id, role) values ('${FIRM_A}', '${SENIOR}', null)`),
    ).toContain('null value');
    expect(
      sqlError(`insert into public.firm_memberships (firm_id, user_id, role) values (null, '${SENIOR}', 'senior')`),
    ).toContain('null value');
  });
});

describe('CHECK vocabularies (DM-01…03, DM-X-05)', () => {
  it('firms.status rejects invalid lifecycle values', () => {
    expect(sqlError(`insert into public.firms (name, status) values ('X', 'bogus')`)).toContain('firms_status_check');
    for (const ok of ['onboarding', 'active', 'suspended', 'deactivated']) {
      expect(sqlError(`insert into public.firms (name, status) values ('tmp-${ok}', '${ok}')`)).toBe('');
      psql(`delete from public.firms where name = 'tmp-${ok}'`);
    }
  });

  it('firm_memberships.role rejects values outside the SCH-03 vocabulary', () => {
    expect(
      sqlError(`insert into public.firm_memberships (firm_id, user_id, role) values ('${FIRM_A}', '${SENIOR}', 'owner')`),
    ).toContain('firm_memberships_role_check');
    expect(
      sqlError(`insert into public.firm_memberships (firm_id, user_id, role) values ('${FIRM_A}', '${SENIOR}', 'admin')`),
    ).toContain('firm_memberships_role_check');
  });

  it('firm_memberships.status rejects invalid lifecycle values', () => {
    expect(
      sqlError(
        `insert into public.firm_memberships (firm_id, user_id, role, status) values ('${FIRM_A}', '${SENIOR}', 'senior', 'deleted')`,
      ),
    ).toContain('firm_memberships_status_check');
  });
});

describe('TEST-SCH-02 — foreign keys reject invalid references', () => {
  it('membership FKs to firms and auth.users are enforced', () => {
    expect(
      sqlError(`insert into public.firm_memberships (firm_id, user_id, role) values ('${BOGUS_UUID}', '${SENIOR}', 'senior')`),
    ).toContain('firm_memberships_firm_fkey');
    expect(
      sqlError(`insert into public.firm_memberships (firm_id, user_id, role) values ('${FIRM_A}', '${BOGUS_UUID}', 'senior')`),
    ).toContain('firm_memberships_user_fkey');
    expect(
      sqlError(
        `insert into public.firm_memberships (firm_id, user_id, role, invited_by) values ('${FIRM_A}', '${SENIOR}', 'senior', '${BOGUS_UUID}')`,
      ),
    ).toContain('firm_memberships_invited_by_fkey');
  });

  it('profiles.id must reference an existing auth.users row (1:1)', () => {
    expect(sqlError(`insert into public.profiles (id, full_name) values ('${BOGUS_UUID}', 'Ghost')`)).toContain(
      'profiles_user_fkey',
    );
  });

  it('RESTRICT prevents deleting a firm that still has memberships', () => {
    expect(sqlError(`delete from public.firms where id = '${FIRM_A}'`)).toContain('firm_memberships_firm_fkey');
  });
});

describe('TEST-SCH-03 — unique constraints hold', () => {
  it('duplicate (firm_id, user_id) membership is rejected (DM-03)', () => {
    expect(
      sqlError(`insert into public.firm_memberships (firm_id, user_id, role) values ('${FIRM_A}', '${PARTNER}', 'manager')`),
    ).toContain('firm_memberships_firm_user_unique');
  });

  it('(firm_id, id) unique exists as the composite-FK target (SCH-RESP-03)', () => {
    const uq = psql(
      `select conname from pg_constraint
       where connamespace = 'public'::regnamespace and contype = 'u' and conrelid = 'public.firm_memberships'::regclass
       order by 1`,
    ).trim();
    expect(uq).toContain('firm_memberships_firm_id_unique');
    expect(uq).toContain('firm_memberships_firm_user_unique');
  });
});

describe('indexes — hot RLS/lookup paths (SCH-03, RLS-MECH-01 support)', () => {
  it('required indexes exist, including the DEC-J live-lookup path', () => {
    const idx = psql(
      `select indexname from pg_indexes where schemaname = 'public' and tablename = 'firm_memberships' order by 1`,
    ).trim();
    expect(idx).toContain('firm_memberships_user_idx'); // (user_id)
    expect(idx).toContain('firm_memberships_firm_status_idx'); // (firm_id, status)
    expect(idx).toContain('firm_memberships_firm_user_unique'); // (firm_id, user_id) — DEC-J lookup
    expect(idx).toContain('firm_memberships_firm_id_unique'); // (firm_id, id) — SCH-RESP-03 target
  });

  it('live membership lookup (user + firm → status, role) uses the unique index', () => {
    const plan = psql(
      `explain select status, role from public.firm_memberships
       where firm_id = '${FIRM_A}' and user_id = '${PARTNER}'`,
    );
    expect(plan).toContain('firm_memberships_firm_user_unique');
  });
});

describe('updated_at trigger (schema convention)', () => {
  it('update sets updated_at', () => {
    psql(`update public.firm_memberships set status = 'active'
          where firm_id = '${FIRM_A}' and user_id = '${MANAGER}'`);
    const updated = psql(
      `select updated_at is not null from public.firm_memberships
       where firm_id = '${FIRM_A}' and user_id = '${MANAGER}'`,
    ).trim();
    expect(updated).toBe('t');
  });
});

describe('security — fail-closed until IMP-012 RLS', () => {
  it('no table privileges for anon/authenticated on the tenant core', () => {
    const grants = psql(
      `select count(*) from information_schema.role_table_grants
       where table_schema = 'public' and grantee in ('anon', 'authenticated')
         and table_name in ('firms', 'profiles', 'firm_memberships')`,
    ).trim();
    expect(grants).toBe('0');
  });

  it('signed-in user cannot read firms via PostgREST yet', async () => {
    const { token } = await signIn(userEmail('USER_A_PARTNER'));
    const res = await api(token, 'GET', 'firms?select=id');
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('signed-in user cannot insert a membership via PostgREST yet', async () => {
    const { token } = await signIn(userEmail('USER_A_PARTNER'));
    const res = await api(token, 'POST', 'firm_memberships', {
      body: { firm_id: FIRM_A, user_id: SENIOR, role: 'senior' },
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});
