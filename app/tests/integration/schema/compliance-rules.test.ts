/**
 * IMP-030 — Compliance types & rule versions: schema/invariant tests.
 *
 * Binds TEST-SCH-06 (rule-content immutability), TEST-SCH-07 (activation
 * gate — database-layer invariants; the RPC-level gate is covered in
 * rls/compliance-rules-rls.test.ts), TEST-SCH-10 (effective windows),
 * TEST-SCH-11 (governance classification) plus the structural contract
 * (SCH-10/SCH-32 columns, constraints, NULLS NOT DISTINCT uniqueness, the
 * no-updated_at exception, DM-SM-04 workflow-template validation).
 *
 * All assertions run as the postgres operator via psql (schema layer);
 * request-context behavior (derivation, RLS, AAL2) lives in the RLS/audit
 * suites. The transaction-local app.crv_lifecycle_command flag is set only
 * inside DO blocks to stage ACTIVE rows the way the Layer-B command would —
 * it is never reachable from PostgREST (no granted function exposes it).
 *
 * Deterministic ids in the 60000000-… range; force-reset per run so the
 * suite is re-runnable.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { FIRM_A, FIRM_B, psql } from '../helpers.mjs';

const T = {
  custom: '60000000-0000-4000-8000-0000000000c1', // firm custom non_statutory
  gstOverride: '60000000-0000-4000-8000-0000000000c2', // firm override of gstr1
};
const SYS_GSTR1 = '50000000-0000-4000-8000-000000000001'; // statutory system type (seed)
const SYS_CERT = '50000000-0000-4000-8000-00000000000e'; // non_statutory system type (seed)

/** Run a DO block, returning { ok, code, detail } — never throws on SQL
 *  errors so denial assertions can inspect the SQLSTATE/DETAIL. */
function attempt(sql: string): { ok: boolean; code: string; detail: string } {
  try {
    psql(`\\set VERBOSITY verbose\n${sql}`);
    return { ok: true, code: '', detail: '' };
  } catch (e) {
    const msg = String((e as { stderr?: string })?.stderr ?? e);
    const code = msg.match(/ERROR:\s+([0-9A-Z]{5}):/)?.[1] ?? '';
    const detail = msg.match(/DETAIL:\s*(\S+)/)?.[1] ?? '';
    return { ok: false, code, detail };
  }
}

beforeAll(() => {
  // Force-reset: remove any prior run's rows (versions first — FK).
  psql(`
    delete from public.audit_log
      where object_type in ('compliance_type','compliance_rule_version')
        and object_id in (
          select id::text from public.compliance_rule_versions
            where compliance_type_id in ('${T.custom}','${T.gstOverride}')
          union select '${T.custom}' union select '${T.gstOverride}');
    delete from public.compliance_rule_versions
      where compliance_type_id in ('${T.custom}','${T.gstOverride}');
    delete from public.compliance_types where id in ('${T.custom}','${T.gstOverride}');

    insert into public.firms (id, name) values
      ('${FIRM_A}', 'IMP-030 Schema Firm A'),
      ('${FIRM_B}', 'IMP-030 Schema Firm B')
    on conflict (id) do nothing;

    insert into public.compliance_types
      (id, firm_id, type_key, name, category, frequency, due_rule, workflow_template,
       scope_kind, registration_class, governance_class)
    values
      ('${T.custom}', '${FIRM_A}', 'firm-custom-cert', 'Firm Custom Certificate', 'Certificates',
       'custom', '{"description":"per firm schedule"}', '{"states":["not_started","preparation","closed"]}',
       'configurable', null, 'non_statutory'),
      ('${T.gstOverride}', '${FIRM_A}', 'gstr1', 'GSTR-1 (firm override)', 'GST',
       'monthly', '{"description":"11th of following month"}',
       '{"states":["not_started","preparation","closed"]}',
       'registration', 'GSTIN', 'statutory')
    on conflict (type_key, firm_id) do nothing;
  `);
});

afterAll(() => {
  // Child rows first, then the fixture firms — mirrors the established
  // per-suite seed/teardown pattern (append-only audit cleaned as operator).
  psql(`
    delete from public.audit_log
      where object_type in ('compliance_type','compliance_rule_version')
        and object_id in (
          select id::text from public.compliance_rule_versions
            where compliance_type_id in ('${T.custom}','${T.gstOverride}')
          union select '${T.custom}' union select '${T.gstOverride}');
    delete from public.compliance_rule_versions
      where compliance_type_id in ('${T.custom}','${T.gstOverride}');
    delete from public.compliance_types where id in ('${T.custom}','${T.gstOverride}');
    delete from public.firms where id in ('${FIRM_A}','${FIRM_B}')
      and not exists (select 1 from public.firm_memberships m where m.firm_id = firms.id)
      and not exists (select 1 from public.clients c where c.firm_id = firms.id);
  `);
});

describe('structural contract (SCH-10/SCH-32)', () => {
  it('both tables exist with the exact spec columns; versions has NO updated_at', () => {
    const cols = psql(`
      select table_name || ':' || string_agg(column_name, ',' order by column_name)
      from information_schema.columns
      where table_schema = 'public'
        and table_name in ('compliance_types', 'compliance_rule_versions')
      group by table_name order by table_name;
    `);
    expect(cols).toContain(
      'compliance_rule_versions:compliance_type_id,created_at,created_by,domain_approval_status,' +
        'due_rule,effective_from,effective_to,firm_id,frequency,id,status,version',
    );
    expect(cols).toContain('compliance_types:');
    expect(cols).toContain('governance_class');
    expect(cols).toContain('scope_kind');
    // SCH-32 Conventions exception: created_at yes, updated_at NO.
    expect(cols).not.toMatch(/compliance_rule_versions:[^\n]*updated_at/);
    expect(cols).toMatch(/compliance_types:[^\n]*updated_at/);
  });

  it('exclusion constraint crv_no_active_window_overlap exists (partial: active only)', () => {
    const out = psql(`
      select contype from pg_constraint
      where conname = 'crv_no_active_window_overlap'
        and conrelid = 'public.compliance_rule_versions'::regclass;
    `);
    expect(out.trim()).toBe('x');
  });

  it('(type_key, firm_id) unique NULLS NOT DISTINCT: one system default + one override per firm', () => {
    // duplicate system default rejected
    const dupSystem = attempt(`
      insert into public.compliance_types (firm_id, type_key, name, category, frequency, due_rule, workflow_template, governance_class)
      values (null, 'gstr1', 'dup', 'GST', 'monthly', '{}', '{"states":["not_started"]}', 'statutory');
    `);
    expect(dupSystem.ok).toBe(false);
    expect(dupSystem.code).toBe('23505');
    // second override for the SAME firm rejected
    const dupFirm = attempt(`
      insert into public.compliance_types (firm_id, type_key, name, category, frequency, due_rule, workflow_template, governance_class)
      values ('${FIRM_A}', 'gstr1', 'dup', 'GST', 'monthly', '{}', '{"states":["not_started"]}', 'statutory');
    `);
    expect(dupFirm.ok).toBe(false);
    expect(dupFirm.code).toBe('23505');
    // a DIFFERENT firm may override the same system key (no error)
    const otherFirm = attempt(`
      insert into public.compliance_types (firm_id, type_key, name, category, frequency, due_rule, workflow_template, governance_class)
      values ('${FIRM_B}', 'gstr1', 'B override', 'GST', 'monthly', '{}', '{"states":["not_started"]}', 'statutory');
    `);
    expect(otherFirm.ok).toBe(true);
    psql(`delete from public.compliance_types where firm_id = '${FIRM_B}' and type_key = 'gstr1';`);
  });

  it('CHECK vocabularies hold (frequency, scope_kind, governance_class, status, version>0)', () => {
    const bad = (sql: string) => expect(attempt(sql).ok).toBe(false);
    bad(`insert into public.compliance_types (firm_id, type_key, name, category, frequency, due_rule, workflow_template, governance_class)
         values ('${FIRM_A}', 'bad-freq', 'x', 'c', 'weekly', '{}', '{"states":["not_started"]}', 'non_statutory');`);
    bad(`insert into public.compliance_types (firm_id, type_key, name, category, frequency, due_rule, workflow_template, governance_class, scope_kind)
         values ('${FIRM_A}', 'bad-scope', 'x', 'c', 'custom', '{}', '{"states":["not_started"]}', 'non_statutory', 'engagement');`);
    bad(`insert into public.compliance_types (firm_id, type_key, name, category, frequency, due_rule, workflow_template, governance_class)
         values ('${FIRM_A}', 'bad-gov', 'x', 'c', 'custom', '{}', '{"states":["not_started"]}', 'maybe_statutory');`);
    bad(`insert into public.compliance_rule_versions (firm_id, compliance_type_id, version, effective_from, frequency, due_rule)
         values ('${FIRM_A}', '${T.custom}', 0, '2026-04-01', 'custom', '{}');`);
    bad(`insert into public.compliance_rule_versions (firm_id, compliance_type_id, version, effective_from, frequency, due_rule, status)
         values ('${FIRM_A}', '${T.custom}', 1, '2026-04-01', 'custom', '{}', 'live');`);
  });

  it('governance_class is NOT NULL with NO default (fail-closed insert)', () => {
    const res = attempt(`
      insert into public.compliance_types (firm_id, type_key, name, category, frequency, due_rule, workflow_template)
      values ('${FIRM_A}', 'no-gov', 'x', 'c', 'custom', '{}', '{"states":["not_started"]}');
    `);
    expect(res.ok).toBe(false);
    expect(res.code).toBe('23502'); // not_null_violation
  });

  it('registration scope requires registration_class (DM-27)', () => {
    const res = attempt(`
      insert into public.compliance_types (firm_id, type_key, name, category, frequency, due_rule, workflow_template, governance_class, scope_kind)
      values ('${FIRM_A}', 'reg-noclass', 'x', 'c', 'custom', '{}', '{"states":["not_started"]}', 'non_statutory', 'registration');
    `);
    expect(res.ok).toBe(false);
    expect(res.code).toBe('23514');
  });

  it('workflow_template must be a valid DM-SM-04 path', () => {
    const badState = attempt(`
      insert into public.compliance_types (firm_id, type_key, name, category, frequency, due_rule, workflow_template, governance_class)
      values ('${FIRM_A}', 'bad-tmpl', 'x', 'c', 'custom', '{}', '{"states":["not_started","teleported"]}', 'non_statutory');
    `);
    expect(badState.ok).toBe(false);
    const empty = attempt(`
      insert into public.compliance_types (firm_id, type_key, name, category, frequency, due_rule, workflow_template, governance_class)
      values ('${FIRM_A}', 'empty-tmpl', 'x', 'c', 'custom', '{}', '{"states":[]}', 'non_statutory');
    `);
    expect(empty.ok).toBe(false);
  });
});

describe('TEST-SCH-11 — governance classification', () => {
  it('firm override of a statutory system type cannot downgrade to non_statutory', () => {
    const res = attempt(`
      insert into public.compliance_types (firm_id, type_key, name, category, frequency, due_rule, workflow_template, governance_class)
      values ('${FIRM_A}', 'tds24q', 'x', 'TDS', 'quarterly', '{}', '{"states":["not_started"]}', 'non_statutory');
    `);
    expect(res.ok).toBe(false);
    expect(res.code).toBe('23514');
    expect(res.detail).toBe('GOVERNANCE_INHERITANCE:compliance_types.governance_class');
  });

  it('firm override carrying the inherited statutory classification succeeds (fixture row)', () => {
    const row = psql(`select governance_class from public.compliance_types where id = '${T.gstOverride}';`);
    expect(row.trim()).toBe('statutory');
  });

  it('genuinely custom firm type may be non_statutory (fixture row)', () => {
    const row = psql(`select governance_class from public.compliance_types where id = '${T.custom}';`);
    expect(row.trim()).toBe('non_statutory');
  });

  it('a statutory version can never carry not_required (operator path)', () => {
    const res = attempt(`
      insert into public.compliance_rule_versions (firm_id, compliance_type_id, version, effective_from, frequency, due_rule, domain_approval_status)
      values (null, '${SYS_GSTR1}', 98, '2026-04-01', 'monthly', '{}', 'not_required');
    `);
    expect(res.ok).toBe(false);
    expect(res.detail).toBe('GOVERNANCE_INHERITANCE:compliance_rule_versions.domain_approval_status');
  });

  it('a non-statutory version cannot carry pending/approved (operator path)', () => {
    const res = attempt(`
      insert into public.compliance_rule_versions (firm_id, compliance_type_id, version, effective_from, frequency, due_rule, domain_approval_status)
      values (null, '${SYS_CERT}', 98, '2026-04-01', 'custom', '{}', 'pending');
    `);
    expect(res.ok).toBe(false);
    expect(res.detail).toBe('GOVERNANCE_INHERITANCE:compliance_rule_versions.domain_approval_status');
  });

  it('version firm scope must match the parent type (SCH-32 inheritance)', () => {
    // firm-owned version under a SYSTEM type → rejected
    const res = attempt(`
      insert into public.compliance_rule_versions (firm_id, compliance_type_id, version, effective_from, frequency, due_rule)
      values ('${FIRM_A}', '${SYS_GSTR1}', 97, '2026-04-01', 'monthly', '{}');
    `);
    expect(res.ok).toBe(false);
    expect(res.detail).toBe('IMMUTABLE_FIELD:compliance_rule_versions.firm_id');
  });
});

describe('TEST-SCH-06 — rule-content immutability (column classes)', () => {
  const V = '60000000-0000-4000-8000-0000000001d1';

  beforeAll(() => {
    psql(`
      insert into public.compliance_rule_versions
        (id, firm_id, compliance_type_id, version, effective_from, frequency, due_rule)
      values ('${V}', '${FIRM_A}', '${T.custom}', 1, '2026-04-01', 'custom', '{"description":"v1"}')
      on conflict (compliance_type_id, version) do nothing;
      -- force-reset to a pristine draft (set_config is transaction-local:
      -- it must live inside the same DO block as the lifecycle update)
      do $$ begin
        perform set_config('app.crv_lifecycle_command', '1', true);
        update public.compliance_rule_versions set status = 'draft', effective_to = null where id = '${V}';
      end $$;
      update public.compliance_rule_versions set frequency = 'custom', due_rule = '{"description":"v1"}' where id = '${V}';
    `);
  });

  it('draft class-A edit is allowed (frequency/due_rule/effective_from)', () => {
    psql(`update public.compliance_rule_versions set frequency = 'annual', due_rule = '{"description":"v1-edit"}' where id = '${V}';`);
    const row = psql(`select frequency from public.compliance_rule_versions where id = '${V}';`);
    expect(row.trim()).toBe('annual');
    psql(`update public.compliance_rule_versions set frequency = 'custom', due_rule = '{"description":"v1"}' where id = '${V}';`);
  });

  it('class C provenance (created_at) is insert-only on every path', () => {
    const res = attempt(`update public.compliance_rule_versions set created_at = now() - interval '1 day' where id = '${V}';`);
    expect(res.ok).toBe(false);
    expect(res.detail).toBe('IMMUTABLE_FIELD:compliance_rule_versions.provenance');
  });

  it('class D approval state has no UPDATE path', () => {
    const res = attempt(`update public.compliance_rule_versions set domain_approval_status = 'approved' where id = '${V}';`);
    expect(res.ok).toBe(false);
    expect(res.detail).toBe('IMMUTABLE_FIELD:compliance_rule_versions.domain_approval_status');
  });

  it('class B lifecycle transition via ordinary UPDATE is rejected', () => {
    const res = attempt(`update public.compliance_rule_versions set status = 'active' where id = '${V}';`);
    expect(res.ok).toBe(false);
    expect(res.detail).toBe('INVALID_TRANSITION:compliance_rule_versions.lifecycle');
    const resTo = attempt(`update public.compliance_rule_versions set effective_to = '2026-10-01' where id = '${V}';`);
    expect(resTo.ok).toBe(false);
    expect(resTo.detail).toBe('INVALID_TRANSITION:compliance_rule_versions.lifecycle');
  });

  it('active rows reject rule-content rewrites — even under the command flag', () => {
    psql(`
      do $$ begin
        perform set_config('app.crv_lifecycle_command', '1', true);
        update public.compliance_rule_versions set status = 'active' where id = '${V}';
      end $$;
    `);
    const withoutFlag = attempt(`update public.compliance_rule_versions set frequency = 'monthly' where id = '${V}';`);
    expect(withoutFlag.ok).toBe(false);
    expect(withoutFlag.detail).toBe('IMMUTABLE_FIELD:compliance_rule_versions.rule_content');
    const withFlag = attempt(`
      do $$ begin
        perform set_config('app.crv_lifecycle_command', '1', true);
        update public.compliance_rule_versions set frequency = 'monthly' where id = '${V}';
      end $$;
    `);
    expect(withFlag.ok).toBe(false);
    expect(withFlag.detail).toContain('IMMUTABLE_FIELD:compliance_rule_versions.rule_content');
    // restore draft for other suites' independence
    psql(`
      do $$ begin
        perform set_config('app.crv_lifecycle_command', '1', true);
        update public.compliance_rule_versions set status = 'draft' where id = '${V}';
      end $$;
    `);
  });

  it('parentage never moves, even on a draft', () => {
    const res = attempt(`update public.compliance_rule_versions set compliance_type_id = '${T.gstOverride}' where id = '${V}';`);
    expect(res.ok).toBe(false);
    expect(res.detail).toBe('IMMUTABLE_FIELD:compliance_rule_versions.parentage');
  });
});

describe('TEST-SCH-10 — effective windows (SCH-32, OPS-ACT-02)', () => {
  const W = {
    v1: '60000000-0000-4000-8000-0000000001e1', // [2026-04-01, 2026-10-01) active
    v2: '60000000-0000-4000-8000-0000000001e2', // [2026-10-01, ∞) active (touching)
    v3: '60000000-0000-4000-8000-0000000001e3', // future scratch
  };

  beforeAll(() => {
    psql(`
      delete from public.compliance_rule_versions where id in ('${W.v1}','${W.v2}','${W.v3}');
      insert into public.compliance_rule_versions
        (id, firm_id, compliance_type_id, version, effective_from, effective_to, frequency, due_rule, status)
      values
        ('${W.v1}', '${FIRM_A}', '${T.custom}', 11, '2026-04-01', '2026-10-01', 'custom', '{}', 'draft'),
        ('${W.v2}', '${FIRM_A}', '${T.custom}', 12, '2026-10-01', null, 'custom', '{}', 'draft');
      do $$ begin
        perform set_config('app.crv_lifecycle_command', '1', true);
        update public.compliance_rule_versions set status = 'active' where id in ('${W.v1}','${W.v2}');
      end $$;
    `);
  });

  it('effective_to <= effective_from is rejected (zero/negative windows invalid)', () => {
    const res = attempt(`
      insert into public.compliance_rule_versions (firm_id, compliance_type_id, version, effective_from, effective_to, frequency, due_rule)
      values ('${FIRM_A}', '${T.custom}', 19, '2026-10-01', '2026-10-01', 'custom', '{}');
    `);
    expect(res.ok).toBe(false);
    expect(res.code).toBe('23514');
  });

  it('overlapping ACTIVE windows are rejected by the exclusion constraint (23P01)', () => {
    const res = attempt(`
      do $$ begin
        perform set_config('app.crv_lifecycle_command', '1', true);
        insert into public.compliance_rule_versions (id, firm_id, compliance_type_id, version, effective_from, frequency, due_rule, status)
        values ('${W.v3}', '${FIRM_A}', '${T.custom}', 13, '2026-06-01', 'custom', '{}', 'active');
      end $$;
    `);
    expect(res.ok).toBe(false);
    expect(res.code).toBe('23P01');
  });

  it('touching half-open boundaries are legal; disjoint + future-effective actives coexist', () => {
    const rows = psql(`
      select id from public.compliance_rule_versions
      where compliance_type_id = '${T.custom}' and status = 'active' and version in (11, 12)
      order by effective_from;
    `);
    expect(rows.trim().split('\n')).toEqual([W.v1, W.v2]);
  });

  it('draft windows may overlap freely (only ACTIVE windows are constrained)', () => {
    const res = attempt(`
      insert into public.compliance_rule_versions (firm_id, compliance_type_id, version, effective_from, frequency, due_rule)
      values ('${FIRM_A}', '${T.custom}', 14, '2026-05-01', 'custom', '{}');
    `);
    expect(res.ok).toBe(true);
    psql(`delete from public.compliance_rule_versions where compliance_type_id = '${T.custom}' and version = 14;`);
  });

  it('active-as-of-date predicate resolves at most one version per (type, date)', () => {
    const at = (d: string) =>
      psql(`
        select coalesce(string_agg(version::text, ','), 'none')
        from public.compliance_rule_versions
        where compliance_type_id = '${T.custom}' and status = 'active'
          and effective_from <= '${d}' and (effective_to is null or '${d}' < effective_to);
      `).trim();
    expect(at('2026-03-31')).toBe('none'); // before any window
    expect(at('2026-04-01')).toBe('11'); // effective_from INCLUSIVE
    expect(at('2026-09-30')).toBe('11');
    expect(at('2026-10-01')).toBe('12'); // effective_to EXCLUSIVE — boundary flips
    expect(at('2027-01-15')).toBe('12'); // open-ended successor
  });
});

describe('TEST-SCH-07 — activation gate (database invariants)', () => {
  it('seeded statutory versions remain draft/pending — zero active statutory rules', () => {
    const out = psql(`
      select count(*) from public.compliance_rule_versions v
      join public.compliance_types t on t.id = v.compliance_type_id
      where t.governance_class = 'statutory' and v.status = 'active';
    `);
    expect(out.trim()).toBe('0');
    const seeds = psql(`
      select count(*) from public.compliance_rule_versions v
      join public.compliance_types t on t.id = v.compliance_type_id
      where v.firm_id is null and t.governance_class = 'statutory'
        and (v.status <> 'draft' or v.domain_approval_status <> 'pending');
    `);
    expect(seeds.trim()).toBe('0');
  });
});
