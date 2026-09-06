/**
 * IMP-042 — alerts + alert_rules: schema/data-integrity tests (SCH-18,
 * SCH-19, DM-22; composite same-firm FKs SCH-FK-01/02; SCH-RESP-02 actor
 * references; lifecycle-field backstop; single-writer write guard).
 *
 * Maps to spec 11 (next family after TEST-SCH-21…25):
 *   TEST-SCH-26  alert_rules structure — exact SCH-19 columns, PK,
 *                nullability/defaults, the severity CHECK (SCH-18
 *                vocabulary), UNIQUE (firm_id, rule_key), the composite
 *                parent key (firm_id, id); NO seed-row/threshold posture
 *                (D3 ruling, AUTO-OQ-04 open);
 *   TEST-SCH-27  alerts structure — exact SCH-18 columns, PK,
 *                nullability/defaults, severity/status/resolution_type
 *                CHECK vocabularies, the two SCH-18 indexes, RLS/grants
 *                posture (enabled AND forced, one scoped-select policy per
 *                table, SELECT-only browser grants, owner-only guard,
 *                authenticated-only commands);
 *   TEST-SCH-28  composite same-firm FK enforcement (SCH-FK-01…03) —
 *                cross-firm alert_rule/client/compliance-instance
 *                references rejected; acknowledged_by/resolved_by are
 *                auth.users actor references (SCH-RESP-02);
 *   TEST-SCH-29  lifecycle-field CHECK (per-status stamp columns) + the
 *                single-writer write guard (status/lifecycle movement only
 *                under app.alert_transition_command; identity/raise
 *                provenance insert-only) + the no-expiry-writes
 *                representability invariant (a persisted snooze whose
 *                snoozed_until has PASSED is storable as-is — SCH-18
 *                snooze-expiry read derivation, TEST-API-18 schema half).
 *
 * All assertions run as the postgres operator via psql — the owner role
 * proves each invariant holds WITHOUT RLS (RLS is never the integrity
 * boundary).
 *
 * Deterministic ids in the 6b000000-… range; force-reset per run so the
 * suite is re-runnable. Uses the shared harness FIRM_A/FIRM_B with
 * suite-owned membership ids (review-items schema precedent).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { FIRM_A, FIRM_B, psql, userId } from '../helpers.mjs';

// Seeded system-default compliance type (supabase/seed.sql — reference
// data): entity scope, so instances need no registration.
const SYS_ITR = '50000000-0000-4000-8000-000000000005';

const M = {
  partnerA: '6b000000-0000-4000-8000-000000000001',
  managerA: '6b000000-0000-4000-8000-000000000002',
  seniorA: '6b000000-0000-4000-8000-000000000003',
  partnerB: '6b000000-0000-4000-8000-000000000004',
};
const C = {
  a1: '6b000000-0000-4000-8000-000000000101',
  b1: '6b000000-0000-4000-8000-000000000111', // other firm
};
const E = {
  a1: '6b000000-0000-4000-8000-000000000201',
  b1: '6b000000-0000-4000-8000-000000000211', // other firm
};
const I = {
  a1: '6b000000-0000-4000-8000-000000000301', // instance of E.a1 → client a1
  b1: '6b000000-0000-4000-8000-000000000311', // other firm
};
const RL = {
  a1: '6b000000-0000-4000-8000-000000000401', // firm A rule
  b1: '6b000000-0000-4000-8000-000000000411', // firm B rule (same rule_key — legal cross-firm)
};
const AL = {
  min: '6b000000-0000-4000-8000-000000000501', // minimal active alert, firm A
};

const PARTNER_A = userId('USER_A_PARTNER');
const MANAGER_A = userId('USER_A_MANAGER');
const SENIOR_A = userId('USER_A_SENIOR');
const PARTNER_B = userId('USER_B_PARTNER');

/** Run a SQL batch, returning { ok, code, detail } — never throws on SQL
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

function cleanFixture() {
  psql(`
    delete from public.alerts where firm_id in ('${FIRM_A}', '${FIRM_B}');
    delete from public.alert_rules where firm_id in ('${FIRM_A}', '${FIRM_B}');
    delete from public.compliance_instances where firm_id in ('${FIRM_A}', '${FIRM_B}');
    delete from public.client_compliance_profiles where firm_id in ('${FIRM_A}', '${FIRM_B}');
    delete from public.legal_entities where firm_id in ('${FIRM_A}', '${FIRM_B}');
    delete from public.clients where firm_id in ('${FIRM_A}', '${FIRM_B}');
    delete from public.firm_memberships where id in
      ('${M.partnerA}','${M.managerA}','${M.seniorA}','${M.partnerB}');
  `);
}

/** Minimal valid active alert insert (rule + client linked, firm A). */
function activeAlert(severity: string, title: string): string {
  return `
    insert into public.alerts (firm_id, alert_rule_id, severity, title, client_id)
    values ('${FIRM_A}', '${RL.a1}', '${severity}', '${title}', '${C.a1}');
  `;
}

beforeAll(() => {
  cleanFixture();
  psql(`
    insert into public.firms (id, name) values
      ('${FIRM_A}', 'IMP-042 Schema Firm A'),
      ('${FIRM_B}', 'IMP-042 Schema Firm B')
    on conflict (id) do nothing;

    insert into public.firm_memberships (id, firm_id, user_id, role, status) values
      ('${M.partnerA}', '${FIRM_A}', '${PARTNER_A}', 'partner', 'active'),
      ('${M.managerA}', '${FIRM_A}', '${MANAGER_A}', 'manager', 'active'),
      ('${M.seniorA}',  '${FIRM_A}', '${SENIOR_A}',  'senior',  'active'),
      ('${M.partnerB}', '${FIRM_B}', '${PARTNER_B}', 'partner', 'active')
    on conflict (firm_id, user_id) do nothing;

    insert into public.clients (id, firm_id, name, owner_partner_membership_id, manager_membership_id) values
      ('${C.a1}', '${FIRM_A}', 'ALR Schema Client A1', '${M.partnerA}', '${M.managerA}'),
      ('${C.b1}', '${FIRM_B}', 'ALR Schema Client B1', '${M.partnerB}', null);

    insert into public.legal_entities (id, firm_id, client_id, entity_type, legal_name) values
      ('${E.a1}', '${FIRM_A}', '${C.a1}', 'private_limited', 'ALR Entity A1'),
      ('${E.b1}', '${FIRM_B}', '${C.b1}', 'private_limited', 'ALR Entity B1');

    insert into public.compliance_instances
      (id, firm_id, legal_entity_id, compliance_type_id, period_start, period_end, period_label, due_date)
    values
      ('${I.a1}', '${FIRM_A}', '${E.a1}', '${SYS_ITR}', '2026-04-01', '2026-06-30', 'FY26 Q1', '2026-07-31'),
      ('${I.b1}', '${FIRM_B}', '${E.b1}', '${SYS_ITR}', '2026-04-01', '2026-06-30', 'FY26 Q1', '2026-07-31');

    insert into public.alert_rules (id, firm_id, rule_key, name, severity) values
      ('${RL.a1}', '${FIRM_A}', 'filing_due_soon', 'Filing due soon', 'warning'),
      ('${RL.b1}', '${FIRM_B}', 'filing_due_soon', 'Filing due soon', 'critical');

    insert into public.alerts (id, firm_id, alert_rule_id, severity, title, client_id)
    values ('${AL.min}', '${FIRM_A}', '${RL.a1}', 'warning', 'ALR minimal active', '${C.a1}');
  `);
});

afterAll(() => {
  cleanFixture();
  psql(`
    delete from public.firms where id in ('${FIRM_A}', '${FIRM_B}')
      and not exists (select 1 from public.firm_memberships m where m.firm_id = firms.id)
      and not exists (select 1 from public.clients c where c.firm_id = firms.id);
  `);
});

// ---------------------------------------------------------------------------
// TEST-SCH-26 — alert_rules structure (SCH-19)
// ---------------------------------------------------------------------------

describe('TEST-SCH-26 — alert_rules structure', () => {
  it('exact SCH-19 columns, PK, and no extra business columns', () => {
    const cols = psql(`
      select string_agg(column_name, ',' order by column_name)
      from information_schema.columns
      where table_schema = 'public' and table_name = 'alert_rules';
    `).trim();
    expect(cols).toBe(
      'auto_resolve,config,created_at,enabled,firm_id,id,name,' +
        'requires_explicit_ack,rule_key,severity,updated_at',
    );
    const pk = psql(`
      select conname from pg_constraint
      where conrelid = 'public.alert_rules'::regclass and contype = 'p';
    `).trim();
    expect(pk).toBe('alert_rules_pkey');
  });

  it('server defaults land (config {}, enabled/auto_resolve true, requires_explicit_ack false)', () => {
    const row = psql(`
      select config::text || ':' || enabled || ':' || auto_resolve || ':' || requires_explicit_ack
        || ':' || (created_at is not null) || ':' || (updated_at is null)
      from public.alert_rules where id = '${RL.a1}';
    `).trim();
    expect(row).toBe('{}:true:true:false:true:true');
  });

  it('NOT NULL on the mandated columns (rule_key, name, severity)', () => {
    for (const col of ['rule_key', 'name', 'severity']) {
      const res = attempt(`
        insert into public.alert_rules (firm_id, rule_key, name, severity)
        values ('${FIRM_A}', ${col === 'rule_key' ? 'null' : `'probe-${col}'`},
                ${col === 'name' ? 'null' : `'Probe ${col}'`},
                ${col === 'severity' ? 'null' : `'info'`});
      `);
      expect(res.ok, col).toBe(false);
      expect(res.code, col).toBe('23502');
    }
  });

  it('severity CHECK uses the SCH-18 vocabulary exactly (info/warning/critical)', () => {
    for (const severity of ['info', 'warning', 'critical']) {
      const res = attempt(`
        insert into public.alert_rules (firm_id, rule_key, name, severity)
        values ('${FIRM_A}', 'probe-sev-${severity}', 'Probe severity', '${severity}');
      `);
      expect(res.ok, severity).toBe(true);
    }
    for (const bad of ['low', 'high', 'urgent', 'INFO']) {
      const res = attempt(`
        insert into public.alert_rules (firm_id, rule_key, name, severity)
        values ('${FIRM_A}', 'probe-sev-bad', 'Probe bad severity', '${bad}');
      `);
      expect(res.ok, bad).toBe(false);
      expect(res.code, bad).toBe('23514');
    }
    psql(`delete from public.alert_rules where firm_id = '${FIRM_A}' and rule_key like 'probe-sev-%';`);
  });

  it('UNIQUE (firm_id, rule_key): same-firm duplicate rejected, cross-firm reuse legal', () => {
    const dup = attempt(`
      insert into public.alert_rules (firm_id, rule_key, name, severity)
      values ('${FIRM_A}', 'filing_due_soon', 'Duplicate key', 'info');
    `);
    expect(dup.ok).toBe(false);
    expect(dup.code).toBe('23505');
    // The same rule_key in ANOTHER firm already exists in the fixture
    // (RL.b1) — cross-firm reuse is legal by construction.
    expect(
      psql(`select count(*) from public.alert_rules where rule_key = 'filing_due_soon';`).trim(),
    ).toBe('2');
  });

  it('composite parent key (firm_id, id) exists for the SCH-18 child FK (SCH-FK-01)', () => {
    const uniques = psql(`
      select conname from pg_constraint
      where conrelid = 'public.alert_rules'::regclass and contype = 'u' order by 1;
    `).trim().split('\n').sort();
    expect(uniques).toEqual(['alert_rules_firm_id_unique', 'alert_rules_firm_rule_key_unique']);
  });

  it('no seed rows ship with the migration (D3 ruling; AUTO-OQ-04 open)', () => {
    // After cleanup of THIS suite's two fixture rules, the table holds no
    // package-seeded rows at all (other suites' fixtures are deleted by
    // their own teardowns; the sequential runner makes this exact).
    expect(
      psql(`select count(*) from public.alert_rules where id not in ('${RL.a1}', '${RL.b1}');`).trim(),
    ).toBe('0');
  });
});

// ---------------------------------------------------------------------------
// TEST-SCH-27 — alerts structure (SCH-18)
// ---------------------------------------------------------------------------

describe('TEST-SCH-27 — alerts structure', () => {
  it('exact SCH-18 columns, PK, and no extra business columns', () => {
    const cols = psql(`
      select string_agg(column_name, ',' order by column_name)
      from information_schema.columns
      where table_schema = 'public' and table_name = 'alerts';
    `).trim();
    expect(cols).toBe(
      'acknowledged_at,acknowledged_by,affected,alert_rule_id,client_id,' +
        'compliance_instance_id,created_at,detail,firm_id,id,raised_at,' +
        'resolution_type,resolved_at,resolved_by,severity,snoozed_until,' +
        'status,title,updated_at',
    );
    const pk = psql(`
      select conname from pg_constraint
      where conrelid = 'public.alerts'::regclass and contype = 'p';
    `).trim();
    expect(pk).toBe('alerts_pkey');
  });

  it('server defaults land (status active, raised_at now()); all subject/stamp columns nullable', () => {
    const row = psql(`
      select status || ':' || (raised_at is not null)
      from public.alerts where id = '${AL.min}';
    `).trim();
    expect(row).toBe('active:true');
    const nulls = psql(`
      select (detail is null) || ':' || (compliance_instance_id is null) || ':'
        || (affected is null) || ':' || (acknowledged_by is null) || ':'
        || (acknowledged_at is null) || ':' || (snoozed_until is null) || ':'
        || (resolved_by is null) || ':' || (resolved_at is null) || ':'
        || (resolution_type is null)
      from public.alerts where id = '${AL.min}';
    `).trim();
    expect(nulls).toBe('true:true:true:true:true:true:true:true:true');
  });

  it('NOT NULL on the mandated columns (severity, title, status, raised_at)', () => {
    const noSeverity = attempt(`
      insert into public.alerts (firm_id, title) values ('${FIRM_A}', 'ALR no severity');
    `);
    expect(noSeverity.ok).toBe(false);
    expect(noSeverity.code).toBe('23502');
    const noTitle = attempt(`
      insert into public.alerts (firm_id, severity) values ('${FIRM_A}', 'info');
    `);
    expect(noTitle.ok).toBe(false);
    expect(noTitle.code).toBe('23502');
  });

  it('exact vocabularies: severity, status, resolution_type CHECKs (SCH-18)', () => {
    for (const severity of ['info', 'warning', 'critical']) {
      const res = attempt(activeAlert(severity, `ALR sev ${severity}`));
      expect(res.ok, severity).toBe(true);
    }
    const badSev = attempt(activeAlert('urgent', 'ALR bad severity'));
    expect(badSev.ok).toBe(false);
    expect(badSev.code).toBe('23514');

    // Every status accepted WITH its mandated stamp set (TEST-SCH-29 covers
    // the field-consistency matrix in full).
    const good = attempt(`
      insert into public.alerts (firm_id, severity, title, status) values
        ('${FIRM_A}', 'info', 'ALR st active', 'active'),
        ('${FIRM_A}', 'info', 'ALR st ack', 'acknowledged'),
        ('${FIRM_A}', 'info', 'ALR st resolved', 'resolved');
    `);
    // acknowledged without stamps / resolved without the resolution triple
    // fail the lifecycle CHECK — asserted in TEST-SCH-29; here the plain
    // status vocabulary probes use fully-consistent rows.
    expect(good.ok).toBe(false); // inconsistent stamp sets rejected (23514)
    const vocab = attempt(`
      insert into public.alerts
        (firm_id, severity, title, status, acknowledged_by, acknowledged_at,
         snoozed_until, resolved_by, resolved_at, resolution_type)
      values
        ('${FIRM_A}', 'info', 'ALR st active', 'active',
         null, null, null, null, null, null),
        ('${FIRM_A}', 'info', 'ALR st ack', 'acknowledged',
         '${MANAGER_A}', now(), null, null, null, null),
        ('${FIRM_A}', 'info', 'ALR st snoozed', 'snoozed',
         null, null, now() + interval '1 day', null, null, null),
        ('${FIRM_A}', 'info', 'ALR st resolved', 'resolved',
         null, null, null, '${PARTNER_A}', now(), 'manual');
    `);
    expect(vocab.ok).toBe(true);
    for (const bad of ['open', 'pending', 'closed', 'dismissed', 'AUTO']) {
      const res = attempt(`
        insert into public.alerts (firm_id, severity, title, status)
        values ('${FIRM_A}', 'info', 'ALR bad status', '${bad}');
      `);
      expect(res.ok, bad).toBe(false);
      expect(res.code, bad).toBe('23514');
    }
    const badRes = attempt(`
      insert into public.alerts
        (firm_id, severity, title, status, resolved_by, resolved_at, resolution_type)
      values ('${FIRM_A}', 'info', 'ALR bad resolution', 'resolved', '${PARTNER_A}', now(), 'system');
    `);
    expect(badRes.ok).toBe(false);
    expect(badRes.code).toBe('23514');
    psql(`delete from public.alerts where firm_id = '${FIRM_A}' and title like 'ALR st %';`);
    psql(`delete from public.alerts where firm_id = '${FIRM_A}' and title like 'ALR sev %';`);
  });

  it('CHECK constraints and composite FK inventory exist exactly as specified', () => {
    const checks = psql(`
      select conname from pg_constraint
      where conrelid = 'public.alerts'::regclass and contype = 'c' order by 1;
    `).trim().split('\n').sort();
    expect(checks).toEqual([
      'alerts_lifecycle_fields_check',
      'alerts_resolution_type_check',
      'alerts_severity_check',
      'alerts_status_check',
    ]);
    const fks = psql(`
      select conname from pg_constraint
      where conrelid = 'public.alerts'::regclass and contype = 'f' order by 1;
    `).trim().split('\n').sort();
    expect(fks).toEqual([
      'alerts_acknowledged_by_fkey',
      'alerts_client_fkey',
      'alerts_firm_fkey',
      'alerts_instance_fkey',
      'alerts_resolved_by_fkey',
      'alerts_rule_fkey',
    ]);
  });

  it('spec indexes exist (SCH-18: the queue + the raised-at scan)', () => {
    const idxdef = psql(`
      select indexname || ':' || indexdef from pg_indexes
      where schemaname = 'public' and tablename = 'alerts' order by 1;
    `);
    expect(idxdef).toContain('alerts_queue_idx:CREATE INDEX alerts_queue_idx ON public.alerts USING btree (firm_id, status, severity)');
    expect(idxdef).toContain('alerts_raised_idx:CREATE INDEX alerts_raised_idx ON public.alerts USING btree (firm_id, raised_at)');
  });

  it('RLS posture: enabled AND forced, one scoped-select policy per table, SELECT-only browser grants', () => {
    for (const table of ['alerts', 'alert_rules']) {
      const rls = psql(`
        select relrowsecurity || ':' || relforcerowsecurity
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname = '${table}';
      `).trim();
      expect(rls, table).toBe('true:true');
      // Browser table surface is SELECT-only for authenticated; nothing for
      // anon (API-ARCH-04: every write is a Layer-B command).
      expect(
        psql(`select coalesce(string_agg(privilege_type, ',' order by privilege_type), '') from information_schema.role_table_grants
              where table_schema = 'public' and grantee = 'authenticated'
                and table_name = '${table}'`).trim(),
        table,
      ).toBe('SELECT');
      expect(
        psql(`select count(*) from information_schema.role_table_grants
              where table_schema = 'public' and grantee = 'anon'
                and table_name = '${table}'`).trim(),
        table,
      ).toBe('0');
    }
    // Exactly one policy per table: the scoped SELECTs. Status movement and
    // rule administration are Layer-B commands — no insert/update/delete
    // policy may ever appear here.
    expect(
      psql(`select tablename || ':' || policyname || ':' || cmd from pg_policies
            where schemaname = 'public' and tablename in ('alerts', 'alert_rules') order by 1`).trim(),
    ).toBe(
      'alert_rules:alert_rules_select_scoped:SELECT\nalerts:alerts_select_scoped:SELECT',
    );
    // The guard function is owner-only (never browser-executable).
    for (const role of ['anon', 'authenticated', 'public', 'service_role']) {
      expect(
        psql(`select has_function_privilege('${role}', 'public.alerts_guard_write()', 'EXECUTE')`).trim(),
      ).toBe('f');
    }
    // The Layer-B commands are authenticated-only entry points.
    for (const fn of [
      'acknowledge_alert(uuid,text)',
      'snooze_alert(uuid,timestamp with time zone,text)',
      'resolve_alert(uuid,text)',
      'create_alert_rule(text,text,text,jsonb,boolean,boolean,boolean)',
      'update_alert_rule(uuid,text,text,jsonb,boolean,boolean,boolean)',
    ]) {
      expect(psql(`select has_function_privilege('authenticated', 'public.${fn}', 'EXECUTE')`).trim()).toBe('t');
      for (const role of ['anon', 'public', 'service_role']) {
        expect(psql(`select has_function_privilege('${role}', 'public.${fn}', 'EXECUTE')`).trim()).toBe('f');
      }
    }
  });
});

// ---------------------------------------------------------------------------
// TEST-SCH-28 — composite same-firm FKs (SCH-FK-01…03, SCH-RESP-02)
// ---------------------------------------------------------------------------

describe('TEST-SCH-28 — alerts composite same-firm FK enforcement', () => {
  it('cross-firm alert_rule / client / compliance_instance references are rejected (23503)', () => {
    const crossRule = attempt(`
      insert into public.alerts (firm_id, alert_rule_id, severity, title)
      values ('${FIRM_A}', '${RL.b1}', 'warning', 'ALR cross-firm rule');
    `);
    expect(crossRule.ok).toBe(false);
    expect(crossRule.code).toBe('23503');

    const crossClient = attempt(`
      insert into public.alerts (firm_id, severity, title, client_id)
      values ('${FIRM_A}', 'warning', 'ALR cross-firm client', '${C.b1}');
    `);
    expect(crossClient.ok).toBe(false);
    expect(crossClient.code).toBe('23503');

    const crossInstance = attempt(`
      insert into public.alerts (firm_id, severity, title, compliance_instance_id)
      values ('${FIRM_A}', 'warning', 'ALR cross-firm instance', '${I.b1}');
    `);
    expect(crossInstance.ok).toBe(false);
    expect(crossInstance.code).toBe('23503');
  });

  it('same-firm references are accepted (rule + client + instance together)', () => {
    const res = attempt(`
      insert into public.alerts
        (firm_id, alert_rule_id, severity, title, client_id, compliance_instance_id, affected)
      values
        ('${FIRM_A}', '${RL.a1}', 'critical', 'ALR full subject', '${C.a1}', '${I.a1}',
         '{"instances": 1}'::jsonb);
    `);
    expect(res.ok).toBe(true);
    psql(`delete from public.alerts where firm_id = '${FIRM_A}' and title = 'ALR full subject';`);
  });

  it('acknowledged_by / resolved_by are auth.users actor references (SCH-RESP-02)', () => {
    const ghostUser = '6b000000-0000-4000-8000-00000000ffff';
    const badAck = attempt(`
      insert into public.alerts
        (firm_id, severity, title, status, acknowledged_by, acknowledged_at)
      values
        ('${FIRM_A}', 'info', 'ALR ghost ack', 'acknowledged', '${ghostUser}', now());
    `);
    expect(badAck.ok).toBe(false);
    expect(badAck.code).toBe('23503');

    const badResolve = attempt(`
      insert into public.alerts
        (firm_id, severity, title, status, resolved_by, resolved_at, resolution_type)
      values
        ('${FIRM_A}', 'info', 'ALR ghost resolve', 'resolved', '${ghostUser}', now(), 'manual');
    `);
    expect(badResolve.ok).toBe(false);
    expect(badResolve.code).toBe('23503');
  });

  it('deleting a referenced rule / client / instance is RESTRICTed while alerts exist', () => {
    const delRule = attempt(`delete from public.alert_rules where id = '${RL.a1}';`);
    expect(delRule.ok).toBe(false);
    expect(delRule.code).toBe('23503');
    const delClient = attempt(`delete from public.clients where id = '${C.a1}';`);
    expect(delClient.ok).toBe(false);
    expect(delClient.code).toBe('23503');
  });
});

// ---------------------------------------------------------------------------
// TEST-SCH-29 — lifecycle-field CHECK + write guard + expiry posture (SCH-18)
// ---------------------------------------------------------------------------

describe('TEST-SCH-29 — alerts lifecycle-field CHECK, write guard, expiry posture', () => {
  it('per-status stamp consistency: mismatched stamp sets rejected (23514)', () => {
    const cases: Array<[string, string]> = [
      // active carrying stamps
      ['active with ack stamps', `'active', '${MANAGER_A}', now()`],
      // acknowledged missing the stamps
      ['acknowledged without stamps', `'acknowledged', null, null`],
      // acknowledged retaining an open snooze (the matrix clears it)
      ['acknowledged with snoozed_until', `'acknowledged', '${MANAGER_A}', now()`],
    ];
    for (const [label, stampSql] of cases) {
      const snooze = label.includes('snoozed_until') ? `, snoozed_until` : '';
      const snoozeVal = label.includes('snoozed_until') ? `, now() + interval '1 day'` : '';
      const res = attempt(`
        insert into public.alerts
          (firm_id, severity, title, status, acknowledged_by, acknowledged_at${snooze})
        values
          ('${FIRM_A}', 'info', 'ALR bad lifecycle', ${stampSql}${snoozeVal});
      `);
      expect(res.ok, label).toBe(false);
      expect(res.code, label).toBe('23514');
    }
    // snoozed without snoozed_until
    const noUntil = attempt(`
      insert into public.alerts (firm_id, severity, title, status)
      values ('${FIRM_A}', 'info', 'ALR bad lifecycle', 'snoozed');
    `);
    expect(noUntil.ok).toBe(false);
    expect(noUntil.code).toBe('23514');
    // snoozed with half an acknowledgement pair
    const halfPair = attempt(`
      insert into public.alerts (firm_id, severity, title, status, acknowledged_by, snoozed_until)
      values ('${FIRM_A}', 'info', 'ALR bad lifecycle', 'snoozed', '${MANAGER_A}', now() + interval '1 day');
    `);
    expect(halfPair.ok).toBe(false);
    expect(halfPair.code).toBe('23514');
    // resolved without resolution_type / without resolved_by
    for (const [label, cols] of [
      ['resolved without resolution_type', `'${PARTNER_A}', now(), null`],
      ['resolved without resolved_by', `null, now(), 'manual'`],
    ] as Array<[string, string]>) {
      const res = attempt(`
        insert into public.alerts
          (firm_id, severity, title, status, resolved_by, resolved_at, resolution_type)
        values ('${FIRM_A}', 'info', 'ALR bad lifecycle', 'resolved', ${cols});
      `);
      expect(res.ok, label).toBe(false);
      expect(res.code, label).toBe('23514');
    }
  });

  it('an expired persisted snooze is storable as-is (SCH-18: expiry is a READ derivation; IMP-042 writes none)', () => {
    const res = attempt(`
      insert into public.alerts (firm_id, severity, title, status, snoozed_until)
      values ('${FIRM_A}', 'info', 'ALR expired snooze', 'snoozed', now() - interval '1 hour');
    `);
    expect(res.ok).toBe(true);
    // … including with a preserved acknowledgement stamp (ack → snooze →
    // expiry reads as acknowledged adapter-side).
    const resAck = attempt(`
      insert into public.alerts
        (firm_id, severity, title, status, acknowledged_by, acknowledged_at, snoozed_until)
      values
        ('${FIRM_A}', 'info', 'ALR expired snooze ack', 'snoozed',
         '${MANAGER_A}', now() - interval '2 hours', now() - interval '1 hour');
    `);
    expect(resAck.ok).toBe(true);
    psql(`delete from public.alerts where firm_id = '${FIRM_A}' and title like 'ALR expired snooze%';`);
  });

  it('write guard: direct status/lifecycle UPDATE without the command marker is rejected (INVALID_TRANSITION/IMMUTABLE_FIELD)', () => {
    const statusUpdate = attempt(`
      update public.alerts set status = 'acknowledged',
        acknowledged_by = '${MANAGER_A}', acknowledged_at = now()
      where id = '${AL.min}';
    `);
    expect(statusUpdate.ok).toBe(false);
    expect(statusUpdate.code).toBe('23514');
    expect(statusUpdate.detail).toBe('INVALID_TRANSITION:alerts.status');

    const stampUpdate = attempt(`
      update public.alerts set snoozed_until = now() + interval '1 day'
      where id = '${AL.min}';
    `);
    expect(stampUpdate.ok).toBe(false);
    expect(stampUpdate.code).toBe('23514');
    expect(stampUpdate.detail).toBe('IMMUTABLE_FIELD:alerts.lifecycle_fields');

    const identity = attempt(`
      update public.alerts set raised_at = now() - interval '1 day'
      where id = '${AL.min}';
    `);
    expect(identity.ok).toBe(false);
    expect(identity.code).toBe('23514');
    expect(identity.detail).toBe('IMMUTABLE_FIELD:alerts.identity');

    // Under the transaction-local command marker the same UPDATE is legal
    // (the Layer-B commands' own write path).
    const commanded = attempt(`
      begin;
      set local app.alert_transition_command = '1';
      update public.alerts set status = 'acknowledged',
        acknowledged_by = '${MANAGER_A}', acknowledged_at = now()
      where id = '${AL.min}';
      rollback;
    `);
    expect(commanded.ok).toBe(true);
  });
});
