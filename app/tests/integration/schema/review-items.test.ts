/**
 * IMP-041 PASS A — review_items: schema/data-integrity tests (SCH-17, DM-21,
 * DM-SM-06 vocabulary + terminal-decision fields, RLS-4EY-04 schema
 * backstop).
 *
 * Maps to spec 11:
 *   TEST-SCH-21  review_items structure — exact columns, PK,
 *                nullability/defaults, the frozen type CHECK (API-OQ-01
 *                resolved), status/source CHECK vocabularies, and the two
 *                SCH-17 queue indexes;
 *   TEST-SCH-22  composite same-firm FK rejection — cross-firm client /
 *                task / compliance-instance / submitter / decider
 *                references (SCH-FK-01…03, SCH-RESP-03);
 *   TEST-SCH-23  R0 source/AI invariant — source='human' requires
 *                ai_output_id IS NULL; no FK to the deferred ai_outputs
 *                (SCH-27) ships in R0. The "submission path accepts only
 *                source='human'" half is submit_review_item behavior —
 *                PASS-B scope, NOT tested here (no command exists yet);
 *   TEST-SCH-24  terminal-decision field invariant — status ∈ {approved,
 *                returned, escalated, dismissed} requires decider +
 *                decided_at + non-empty rationale; pending rows carry no
 *                decision fields (DM-SM-06);
 *   TEST-SCH-25  ReviewItem subject binding — valid task/instance links
 *                accepted with matching client; forged/mismatching clients
 *                rejected; consistent task+instance accepted only when the
 *                task references EXACTLY that instance (same-client/
 *                different-instance rejected); ad-hoc client-only accepted.
 *
 * PASS-B placeholders (NOT faked here — require the controlled Layer-B
 * commands and the RLS-RVW-01 policies, separately authorized):
 *   TEST-RLS-RVW-01…16, TEST-API-11…15, TEST-AUD-03/12, TEST-E2E-08.
 *
 * All assertions run as the postgres operator via psql — the owner role
 * proves each invariant holds WITHOUT RLS (RLS is never the integrity
 * boundary). The table is fail-closed for browser roles in PASS A (RLS
 * enabled AND forced, zero policies, zero browser grants) — the posture
 * test below pins exactly that.
 *
 * Deterministic ids in the 65000000-… range; force-reset per run so the
 * suite is re-runnable.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { FIRM_A, FIRM_B, psql, userId } from '../helpers.mjs';

// Seeded system-default compliance type (supabase/seed.sql — reference
// data): entity scope, so instances need no registration.
const SYS_ITR = '50000000-0000-4000-8000-000000000005';

const M = {
  partnerA: '65000000-0000-4000-8000-000000000001',
  managerA: '65000000-0000-4000-8000-000000000002',
  seniorA: '65000000-0000-4000-8000-000000000003',
  partnerB: '65000000-0000-4000-8000-000000000004',
};
const C = {
  a1: '65000000-0000-4000-8000-000000000101',
  a2: '65000000-0000-4000-8000-000000000102',
  b1: '65000000-0000-4000-8000-000000000111', // other firm
};
const E = {
  a1: '65000000-0000-4000-8000-000000000201', // entity of client a1
  a2: '65000000-0000-4000-8000-000000000202', // entity of client a2
  b1: '65000000-0000-4000-8000-000000000211', // other firm
};
const I = {
  a1a: '65000000-0000-4000-8000-000000000301', // instance of E.a1 → client a1
  a1b: '65000000-0000-4000-8000-000000000302', // second instance, same client a1
  a2: '65000000-0000-4000-8000-000000000303', // instance of E.a2 → client a2
  b1: '65000000-0000-4000-8000-000000000311', // other firm
};
const T = {
  linkedA1: '65000000-0000-4000-8000-000000000401', // linked to I.a1a → client a1
  adhocA1: '65000000-0000-4000-8000-000000000402', // ad-hoc, client a1, no instance
  a2: '65000000-0000-4000-8000-000000000403', // ad-hoc, client a2
  b1: '65000000-0000-4000-8000-000000000411', // ad-hoc, firm B
};
const R = {
  adhoc: '65000000-0000-4000-8000-000000000501', // ad-hoc client-only, firm A
  relink: '65000000-0000-4000-8000-000000000502', // re-link scratch
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
    delete from public.review_items where firm_id in ('${FIRM_A}', '${FIRM_B}');
    delete from public.tasks where firm_id in ('${FIRM_A}', '${FIRM_B}');
    delete from public.compliance_instances where firm_id in ('${FIRM_A}', '${FIRM_B}');
    delete from public.client_compliance_profiles where firm_id in ('${FIRM_A}', '${FIRM_B}');
    delete from public.legal_entities where firm_id in ('${FIRM_A}', '${FIRM_B}');
    delete from public.clients where firm_id in ('${FIRM_A}', '${FIRM_B}');
    delete from public.firm_memberships where id in
      ('${M.partnerA}','${M.managerA}','${M.seniorA}','${M.partnerB}');
  `);
}

/** Minimal valid pending ad-hoc item insert (client-only subject). */
function pendingItem(type: string, title: string): string {
  return `
    insert into public.review_items
      (firm_id, client_id, type, title, submitted_by_membership_id)
    values
      ('${FIRM_A}', '${C.a1}', '${type}', '${title}', '${M.seniorA}');
  `;
}

beforeAll(() => {
  cleanFixture();
  psql(`
    insert into public.firms (id, name) values
      ('${FIRM_A}', 'IMP-041 Schema Firm A'),
      ('${FIRM_B}', 'IMP-041 Schema Firm B')
    on conflict (id) do nothing;

    insert into public.firm_memberships (id, firm_id, user_id, role, status) values
      ('${M.partnerA}', '${FIRM_A}', '${PARTNER_A}', 'partner', 'active'),
      ('${M.managerA}', '${FIRM_A}', '${MANAGER_A}', 'manager', 'active'),
      ('${M.seniorA}',  '${FIRM_A}', '${SENIOR_A}',  'senior',  'active'),
      ('${M.partnerB}', '${FIRM_B}', '${PARTNER_B}', 'partner', 'active')
    on conflict (firm_id, user_id) do nothing;

    insert into public.clients (id, firm_id, name, owner_partner_membership_id, manager_membership_id) values
      ('${C.a1}', '${FIRM_A}', 'RVW Schema Client A1', '${M.partnerA}', '${M.managerA}'),
      ('${C.a2}', '${FIRM_A}', 'RVW Schema Client A2', '${M.partnerA}', null),
      ('${C.b1}', '${FIRM_B}', 'RVW Schema Client B1', '${M.partnerB}', null);

    insert into public.legal_entities (id, firm_id, client_id, entity_type, legal_name) values
      ('${E.a1}', '${FIRM_A}', '${C.a1}', 'private_limited', 'RVW Entity A1'),
      ('${E.a2}', '${FIRM_A}', '${C.a2}', 'llp',             'RVW Entity A2'),
      ('${E.b1}', '${FIRM_B}', '${C.b1}', 'private_limited', 'RVW Entity B1');

    insert into public.compliance_instances
      (id, firm_id, legal_entity_id, compliance_type_id, period_start, period_end, period_label, due_date)
    values
      ('${I.a1a}', '${FIRM_A}', '${E.a1}', '${SYS_ITR}', '2026-04-01', '2026-06-30', 'FY26 Q1', '2026-07-31'),
      ('${I.a1b}', '${FIRM_A}', '${E.a1}', '${SYS_ITR}', '2026-07-01', '2026-09-30', 'FY26 Q2', '2026-10-31'),
      ('${I.a2}',  '${FIRM_A}', '${E.a2}', '${SYS_ITR}', '2026-04-01', '2026-06-30', 'FY26 Q1', '2026-07-31'),
      ('${I.b1}',  '${FIRM_B}', '${E.b1}', '${SYS_ITR}', '2026-04-01', '2026-06-30', 'FY26 Q1', '2026-07-31');

    insert into public.tasks (id, firm_id, client_id, compliance_instance_id, title, next_action) values
      ('${T.linkedA1}', '${FIRM_A}', '${C.a1}', '${I.a1a}', 'RVW linked A1', 'prepare workpaper'),
      ('${T.adhocA1}',  '${FIRM_A}', '${C.a1}', null,       'RVW ad-hoc A1', 'collect documents'),
      ('${T.a2}',       '${FIRM_A}', '${C.a2}', null,       'RVW ad-hoc A2', 'reconcile ledger'),
      ('${T.b1}',       '${FIRM_B}', '${C.b1}', null,       'RVW ad-hoc B1', 'call client');

    insert into public.review_items
      (id, firm_id, client_id, type, title, submitted_by_membership_id)
    values
      ('${R.adhoc}',  '${FIRM_A}', '${C.a1}', 'tds_return',       'RVW ad-hoc item',  '${M.seniorA}'),
      ('${R.relink}', '${FIRM_A}', '${C.a1}', 'itr_computation',  'RVW re-link item', '${M.seniorA}');
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
// TEST-SCH-21 — structure (SCH-17)
// ---------------------------------------------------------------------------

describe('TEST-SCH-21 — review_items structure', () => {
  it('exact SCH-17 columns, PK, and no extra business columns', () => {
    const cols = psql(`
      select string_agg(column_name, ',' order by column_name)
      from information_schema.columns
      where table_schema = 'public' and table_name = 'review_items';
    `).trim();
    expect(cols).toBe(
      'ai_output_id,client_id,compliance_instance_id,created_at,decided_at,' +
        'decided_by_membership_id,decision_rationale,firm_id,id,note,priority,' +
        'sla_due_at,source,status,submitted_at,submitted_by_membership_id,' +
        'task_id,title,type,updated_at',
    );
    const pk = psql(`
      select conname from pg_constraint
      where conrelid = 'public.review_items'::regclass and contype = 'p';
    `).trim();
    expect(pk).toBe('review_items_pkey');
  });

  it('server defaults land (status pending, source human, priority normal, submitted_at now())', () => {
    const row = psql(`
      select status || ':' || source || ':' || priority || ':' || (submitted_at is not null)
      from public.review_items where id = '${R.adhoc}';
    `).trim();
    expect(row).toBe('pending:human:normal:true');
    // Nullable-by-default subject/decision/AI/SLA columns.
    const nulls = psql(`
      select (task_id is null) || ':' || (compliance_instance_id is null) || ':'
        || (decided_by_membership_id is null) || ':' || (decided_at is null) || ':'
        || (decision_rationale is null) || ':' || (ai_output_id is null) || ':'
        || (sla_due_at is null) || ':' || (note is null)
      from public.review_items where id = '${R.adhoc}';
    `).trim();
    expect(nulls).toBe('true:true:true:true:true:true:true:true');
  });

  it('NOT NULL on the mandated columns (client_id, type, title, submitted_by, submitted_at)', () => {
    const res = attempt(`
      insert into public.review_items (firm_id, type, title, submitted_by_membership_id)
      values ('${FIRM_A}', 'gst_reconciliation', 'RVW no client', '${M.seniorA}');
    `);
    expect(res.ok).toBe(false);
    expect(res.code).toBe('23502');

    const noSubmitter = attempt(`
      insert into public.review_items (firm_id, client_id, type, title)
      values ('${FIRM_A}', '${C.a1}', 'gst_reconciliation', 'RVW no submitter');
    `);
    expect(noSubmitter.ok).toBe(false);
    expect(noSubmitter.code).toBe('23502');
  });

  it('exact frozen type vocabulary (API-OQ-01 resolved): five keys accepted, anything else rejected', () => {
    for (const type of [
      'gst_reconciliation',
      'tds_return',
      'itr_computation',
      'financial_statements',
      'audit_workpaper',
    ]) {
      const res = attempt(pendingItem(type, `RVW probe ${type}`));
      expect(res.ok, type).toBe(true);
    }
    // A demo display label is not a stored machine key.
    const invalid = attempt(pendingItem('GST Reconciliation', 'RVW probe invalid'));
    expect(invalid.ok).toBe(false);
    expect(invalid.code).toBe('23514');
    psql(`delete from public.review_items where firm_id = '${FIRM_A}' and title like 'RVW probe%';`);
  });

  it('exact status vocabulary: the five DM-SM-06 states accepted, others rejected', () => {
    // Terminal states require the full decision facts (TEST-SCH-24).
    for (const status of ['approved', 'returned', 'escalated', 'dismissed']) {
      const res = attempt(`
        insert into public.review_items
          (firm_id, client_id, type, title, status, submitted_by_membership_id,
           decided_by_membership_id, decided_at, decision_rationale)
        values
          ('${FIRM_A}', '${C.a1}', 'gst_reconciliation', 'RVW vocab ${status}', '${status}',
           '${M.seniorA}', '${M.managerA}', now(), 'reviewed: ${status}');
      `);
      expect(res.ok, status).toBe(true);
    }
    for (const bad of ['open', 'submitted', 'clarify', 'rejected', 'done', 'cancelled']) {
      const res = attempt(`
        insert into public.review_items
          (firm_id, client_id, type, title, status, submitted_by_membership_id)
        values
          ('${FIRM_A}', '${C.a1}', 'gst_reconciliation', 'RVW bad status', '${bad}', '${M.seniorA}');
      `);
      expect(res.ok, bad).toBe(false);
      expect(res.code, bad).toBe('23514');
    }
    psql(`delete from public.review_items where firm_id = '${FIRM_A}' and title like 'RVW vocab %';`);
  });

  it('CHECK constraints and composite FK inventory exist exactly as specified', () => {
    const checks = psql(`
      select conname from pg_constraint
      where conrelid = 'public.review_items'::regclass and contype = 'c' order by 1;
    `).trim().split('\n').sort();
    expect(checks).toEqual([
      'review_items_decision_fields_check',
      'review_items_four_eyes_check',
      'review_items_human_source_no_ai_output_check',
      'review_items_source_check',
      'review_items_status_check',
      'review_items_type_check',
    ]);
    const fks = psql(`
      select conname from pg_constraint
      where conrelid = 'public.review_items'::regclass and contype = 'f' order by 1;
    `).trim().split('\n').sort();
    expect(fks).toEqual([
      'review_items_client_fkey',
      'review_items_decided_by_fkey',
      'review_items_firm_fkey',
      'review_items_instance_fkey',
      'review_items_submitted_by_fkey',
      'review_items_task_fkey',
    ]);
  });

  it('spec indexes exist (SCH-17: the queue + submitter/status lookup)', () => {
    const idx = psql(`
      select indexname from pg_indexes
      where schemaname = 'public' and tablename = 'review_items';
    `);
    expect(idx).toContain('review_items_queue_idx');
    expect(idx).toContain('review_items_submitter_idx');
    // Exactly the two SCH-17 indexes beyond the PK.
    const idxdef = psql(`
      select indexname || ':' || indexdef from pg_indexes
      where schemaname = 'public' and tablename = 'review_items' order by 1;
    `);
    expect(idxdef).toContain('review_items_queue_idx:CREATE INDEX review_items_queue_idx ON public.review_items USING btree (firm_id, status, priority)');
    expect(idxdef).toContain('review_items_submitter_idx:CREATE INDEX review_items_submitter_idx ON public.review_items USING btree (firm_id, submitted_by_membership_id, status)');
  });

  it('RLS posture: enabled AND forced, one scoped-select policy, SELECT-only browser grant (PASS B, RLS-RVW-01)', () => {
    const rls = psql(`
      select relrowsecurity || ':' || relforcerowsecurity
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'review_items';
    `).trim();
    expect(rls).toBe('true:true');
    // Exactly one policy: the RLS-RVW-01 scoped SELECT. Submission and
    // decisions are Layer-B commands, so no insert/update/delete policy
    // may ever appear here.
    expect(
      psql(`select policyname || ':' || cmd || ':' || coalesce((select string_agg(r::text, ',' order by r::text) from unnest(p.roles) r), '') from pg_policies p where p.schemaname = 'public' and p.tablename = 'review_items'`).trim(),
    ).toBe('review_items_select_scoped:SELECT:authenticated');
    // Browser table surface is SELECT-only for authenticated; nothing for
    // anon (API-ARCH-04: writes go through submit_review_item /
    // decide_review_item only).
    expect(
      psql(`select coalesce(string_agg(privilege_type, ',' order by privilege_type), '') from information_schema.role_table_grants
            where table_schema = 'public' and grantee = 'authenticated'
              and table_name = 'review_items'`).trim(),
    ).toBe('SELECT');
    expect(
      psql(`select count(*) from information_schema.role_table_grants
            where table_schema = 'public' and grantee = 'anon'
              and table_name = 'review_items'`).trim(),
    ).toBe('0');
    // The guard function is owner-only (never browser-executable).
    for (const role of ['anon', 'authenticated', 'public', 'service_role']) {
      expect(
        psql(`select has_function_privilege('${role}', 'public.review_items_guard_write()', 'EXECUTE')`).trim(),
      ).toBe('f');
    }
    // The Layer-B commands are authenticated-only entry points.
    for (const fn of ['submit_review_item(uuid,uuid,uuid,text,text,text,text,timestamp with time zone)', 'decide_review_item(uuid,text,text,text)']) {
      expect(psql(`select has_function_privilege('authenticated', 'public.${fn}', 'EXECUTE')`).trim()).toBe('t');
      for (const role of ['anon', 'public', 'service_role']) {
        expect(psql(`select has_function_privilege('${role}', 'public.${fn}', 'EXECUTE')`).trim()).toBe('f');
      }
    }
  });
});

// ---------------------------------------------------------------------------
// TEST-SCH-22 — composite same-firm FKs (SCH-FK-01…03, SCH-RESP-03)
// ---------------------------------------------------------------------------

describe('TEST-SCH-22 — composite same-firm FK rejection', () => {
  it('cross-firm client reference rejected (23503)', () => {
    const res = attempt(`
      insert into public.review_items (firm_id, client_id, type, title, submitted_by_membership_id)
      values ('${FIRM_A}', '${C.b1}', 'gst_reconciliation', 'RVW fk client', '${M.seniorA}');
    `);
    expect(res.ok).toBe(false);
    expect(res.code).toBe('23503');
  });

  it('cross-firm task reference rejected (23503)', () => {
    const res = attempt(`
      insert into public.review_items (firm_id, client_id, task_id, type, title, submitted_by_membership_id)
      values ('${FIRM_A}', '${C.a1}', '${T.b1}', 'gst_reconciliation', 'RVW fk task', '${M.seniorA}');
    `);
    expect(res.ok).toBe(false);
    expect(res.code).toBe('23503');
  });

  it('cross-firm compliance-instance reference rejected (23503)', () => {
    const res = attempt(`
      insert into public.review_items
        (firm_id, client_id, compliance_instance_id, type, title, submitted_by_membership_id)
      values ('${FIRM_A}', '${C.a1}', '${I.b1}', 'gst_reconciliation', 'RVW fk instance', '${M.seniorA}');
    `);
    expect(res.ok).toBe(false);
    expect(res.code).toBe('23503');
  });

  it('cross-firm submitted-by membership rejected (23503)', () => {
    const res = attempt(`
      insert into public.review_items (firm_id, client_id, type, title, submitted_by_membership_id)
      values ('${FIRM_A}', '${C.a1}', 'gst_reconciliation', 'RVW fk submitter', '${M.partnerB}');
    `);
    expect(res.ok).toBe(false);
    expect(res.code).toBe('23503');
  });

  it('cross-firm decided-by membership rejected (23503)', () => {
    const res = attempt(`
      insert into public.review_items
        (firm_id, client_id, type, title, status, submitted_by_membership_id,
         decided_by_membership_id, decided_at, decision_rationale)
      values
        ('${FIRM_A}', '${C.a1}', 'gst_reconciliation', 'RVW fk decider', 'approved',
         '${M.seniorA}', '${M.partnerB}', now(), 'fine work');
    `);
    expect(res.ok).toBe(false);
    expect(res.code).toBe('23503');
  });

  it('responsibility references are membership ids — a bare auth.users id is not a valid reference (23503)', () => {
    // SCH-RESP-01/03: submitted_by/decided_by bind firm_memberships
    // (firm_id, id), never the global identity. The senior's auth.users id
    // is not a membership id.
    const res = attempt(`
      insert into public.review_items (firm_id, client_id, type, title, submitted_by_membership_id)
      values ('${FIRM_A}', '${C.a1}', 'gst_reconciliation', 'RVW bare user id', '${SENIOR_A}');
    `);
    expect(res.ok).toBe(false);
    expect(res.code).toBe('23503');
  });

  it('review-item identity is insert-only (firm_id rewrite rejected with the IMMUTABLE_FIELD marker)', () => {
    const res = attempt(`
      update public.review_items set firm_id = '${FIRM_B}' where id = '${R.adhoc}';
    `);
    expect(res.ok).toBe(false);
    expect(res.code).toBe('23514');
    expect(res.detail).toBe('IMMUTABLE_FIELD:review_items.identity');
  });
});

// ---------------------------------------------------------------------------
// TEST-SCH-23 — R0 source/AI invariant (SCH-17; SCH-27 deferred)
// ---------------------------------------------------------------------------

describe('TEST-SCH-23 — source/AI invariant', () => {
  it("source='human' with ai_output_id set is rejected (23514)", () => {
    const res = attempt(`
      insert into public.review_items
        (firm_id, client_id, type, title, source, ai_output_id, submitted_by_membership_id)
      values
        ('${FIRM_A}', '${C.a1}', 'gst_reconciliation', 'RVW human+ai', 'human',
         '65000000-0000-4000-8000-000000000901', '${M.seniorA}');
    `);
    expect(res.ok).toBe(false);
    expect(res.code).toBe('23514');
  });

  it("source='human' with ai_output_id NULL is accepted (the R0 row shape)", () => {
    // Fixture rows R.adhoc / R.relink already prove it; assert the shape.
    const row = psql(`
      select source || ':' || (ai_output_id is null) from public.review_items where id = '${R.adhoc}';
    `).trim();
    expect(row).toBe('human:true');
  });

  it('source outside the vocabulary is rejected (23514)', () => {
    const res = attempt(`
      insert into public.review_items (firm_id, client_id, type, title, source, submitted_by_membership_id)
      values ('${FIRM_A}', '${C.a1}', 'gst_reconciliation', 'RVW bad source', 'robot', '${M.seniorA}');
    `);
    expect(res.ok).toBe(false);
    expect(res.code).toBe('23514');
  });

  it('no ai_outputs table exists and ai_output_id carries NO foreign key (SCH-27 deferred)', () => {
    expect(
      psql(`select count(*) from information_schema.tables
            where table_schema = 'public' and table_name = 'ai_outputs'`).trim(),
    ).toBe('0');
    expect(
      psql(`select count(*) from pg_constraint c
            join pg_class t on t.oid = c.conrelid
            join pg_namespace n on n.oid = t.relnamespace
            where n.nspname = 'public' and t.relname = 'review_items' and c.contype = 'f'
              and pg_get_constraintdef(c.oid) like '%ai_output_id%'`).trim(),
    ).toBe('0');
  });
});

// ---------------------------------------------------------------------------
// TEST-SCH-24 — terminal-decision field invariant (DM-SM-06, SCH-17)
// ---------------------------------------------------------------------------

describe('TEST-SCH-24 — terminal-decision fields', () => {
  it('pending rows carry no decision facts (each decision column alone is rejected)', () => {
    for (const [label, cols] of [
      ['decider', `, decided_by_membership_id`],
      ['decided_at', `, decided_at`],
      ['rationale', `, decision_rationale`],
    ] as const) {
      const val =
        label === 'decider'
          ? `'${M.managerA}'`
          : label === 'decided_at'
            ? 'now()'
            : `'some rationale'`;
      const res = attempt(`
        insert into public.review_items
          (firm_id, client_id, type, title, submitted_by_membership_id ${cols})
        values
          ('${FIRM_A}', '${C.a1}', 'gst_reconciliation', 'RVW pending+${label}', '${M.seniorA}', ${val});
      `);
      expect(res.ok, label).toBe(false);
      expect(res.code, label).toBe('23514');
    }
  });

  it('terminal status without decider rejected', () => {
    const res = attempt(`
      insert into public.review_items
        (firm_id, client_id, type, title, status, submitted_by_membership_id, decided_at, decision_rationale)
      values
        ('${FIRM_A}', '${C.a1}', 'gst_reconciliation', 'RVW no decider', 'approved',
         '${M.seniorA}', now(), 'fine work');
    `);
    expect(res.ok).toBe(false);
    expect(res.code).toBe('23514');
  });

  it('terminal status without decided_at rejected', () => {
    const res = attempt(`
      insert into public.review_items
        (firm_id, client_id, type, title, status, submitted_by_membership_id, decided_by_membership_id, decision_rationale)
      values
        ('${FIRM_A}', '${C.a1}', 'gst_reconciliation', 'RVW no decided_at', 'approved',
         '${M.seniorA}', '${M.managerA}', 'fine work');
    `);
    expect(res.ok).toBe(false);
    expect(res.code).toBe('23514');
  });

  it('terminal status with empty or whitespace-only rationale rejected', () => {
    for (const rationale of [`''`, `'   '`, `'\t\n '`]) {
      const res = attempt(`
        insert into public.review_items
          (firm_id, client_id, type, title, status, submitted_by_membership_id,
           decided_by_membership_id, decided_at, decision_rationale)
        values
          ('${FIRM_A}', '${C.a1}', 'gst_reconciliation', 'RVW blank rationale', 'returned',
           '${M.seniorA}', '${M.managerA}', now(), ${rationale});
      `);
      expect(res.ok, rationale).toBe(false);
      expect(res.code, rationale).toBe('23514');
    }
  });

  it('a terminal decision with decider + decided_at + non-empty rationale is accepted', () => {
    const res = attempt(`
      insert into public.review_items
        (firm_id, client_id, type, title, status, submitted_by_membership_id,
         decided_by_membership_id, decided_at, decision_rationale)
      values
        ('${FIRM_A}', '${C.a1}', 'gst_reconciliation', 'RVW decided ok', 'dismissed',
         '${M.seniorA}', '${M.managerA}', now(), 'not a reviewable defect');
    `);
    expect(res.ok).toBe(true);
    psql(`delete from public.review_items where firm_id = '${FIRM_A}' and title = 'RVW decided ok';`);
  });

  it('decider equal to submitter is rejected for every decision (RLS-4EY-04 schema backstop, no rank bypass)', () => {
    // The AUTHORITATIVE enforcement (live-membership comparison, denial
    // audit, authorization surface) is PASS-B decide_review_item scope;
    // this asserts only the SCH-17 row-level invariant.
    for (const submitter of [M.seniorA, M.managerA, M.partnerA]) {
      const res = attempt(`
        insert into public.review_items
          (firm_id, client_id, type, title, status, submitted_by_membership_id,
           decided_by_membership_id, decided_at, decision_rationale)
        values
          ('${FIRM_A}', '${C.a1}', 'gst_reconciliation', 'RVW self-decision', 'approved',
           '${submitter}', '${submitter}', now(), 'approving my own work');
      `);
      expect(res.ok, submitter).toBe(false);
      expect(res.code, submitter).toBe('23514');
    }
  });
});

// ---------------------------------------------------------------------------
// TEST-SCH-25 — ReviewItem subject binding (SCH-17 cross-domain hardening)
// ---------------------------------------------------------------------------

describe('TEST-SCH-25 — subject binding', () => {
  it('a valid task-linked item with client_id equal to the task client is accepted', () => {
    const res = attempt(`
      insert into public.review_items
        (firm_id, client_id, task_id, type, title, submitted_by_membership_id)
      values
        ('${FIRM_A}', '${C.a1}', '${T.linkedA1}', 'audit_workpaper', 'RVW task ok', '${M.seniorA}');
    `);
    expect(res.ok).toBe(true);
    psql(`delete from public.review_items where firm_id = '${FIRM_A}' and title = 'RVW task ok';`);
  });

  it('a mismatching task client cannot persist (23514)', () => {
    // T.a2 belongs to client a2; the caller claims client a1.
    const res = attempt(`
      insert into public.review_items
        (firm_id, client_id, task_id, type, title, submitted_by_membership_id)
      values
        ('${FIRM_A}', '${C.a1}', '${T.a2}', 'gst_reconciliation', 'RVW task client mismatch', '${M.seniorA}');
    `);
    expect(res.ok).toBe(false);
    expect(res.code).toBe('23514');
  });

  it('a valid instance-linked item with client_id equal to the instance client is accepted', () => {
    const res = attempt(`
      insert into public.review_items
        (firm_id, client_id, compliance_instance_id, type, title, submitted_by_membership_id)
      values
        ('${FIRM_A}', '${C.a2}', '${I.a2}', 'itr_computation', 'RVW instance ok', '${M.seniorA}');
    `);
    expect(res.ok).toBe(true);
    psql(`delete from public.review_items where firm_id = '${FIRM_A}' and title = 'RVW instance ok';`);
  });

  it('a mismatching instance client cannot persist (23514)', () => {
    // I.a2 belongs to client a2; the caller claims client a1.
    const res = attempt(`
      insert into public.review_items
        (firm_id, client_id, compliance_instance_id, type, title, submitted_by_membership_id)
      values
        ('${FIRM_A}', '${C.a1}', '${I.a2}', 'itr_computation', 'RVW instance client mismatch', '${M.seniorA}');
    `);
    expect(res.ok).toBe(false);
    expect(res.code).toBe('23514');
  });

  it('consistent task + instance links are accepted when the task references exactly that instance', () => {
    const res = attempt(`
      insert into public.review_items
        (firm_id, client_id, task_id, compliance_instance_id, type, title, submitted_by_membership_id)
      values
        ('${FIRM_A}', '${C.a1}', '${T.linkedA1}', '${I.a1a}', 'audit_workpaper', 'RVW task+instance ok', '${M.seniorA}');
    `);
    expect(res.ok).toBe(true);
    psql(`delete from public.review_items where firm_id = '${FIRM_A}' and title = 'RVW task+instance ok';`);
  });

  it('same-client but different-instance combination is rejected (23514)', () => {
    // T.linkedA1 references I.a1a; the caller links I.a1b — same client a1,
    // wrong instance. Not sufficient per SCH-17 (c).
    const res = attempt(`
      insert into public.review_items
        (firm_id, client_id, task_id, compliance_instance_id, type, title, submitted_by_membership_id)
      values
        ('${FIRM_A}', '${C.a1}', '${T.linkedA1}', '${I.a1b}', 'audit_workpaper', 'RVW wrong instance', '${M.seniorA}');
    `);
    expect(res.ok).toBe(false);
    expect(res.code).toBe('23514');
  });

  it('an ad-hoc task combined with a named instance is rejected (the task references no instance)', () => {
    const res = attempt(`
      insert into public.review_items
        (firm_id, client_id, task_id, compliance_instance_id, type, title, submitted_by_membership_id)
      values
        ('${FIRM_A}', '${C.a1}', '${T.adhocA1}', '${I.a1a}', 'tds_return', 'RVW adhoc+instance', '${M.seniorA}');
    `);
    expect(res.ok).toBe(false);
    expect(res.code).toBe('23514');
  });

  it('an ad-hoc client-only item is accepted — client_id is the authoritative subject', () => {
    // Fixture R.adhoc proves it; add a client-a2 ad-hoc row for breadth.
    const res = attempt(`
      insert into public.review_items
        (firm_id, client_id, type, title, submitted_by_membership_id)
      values
        ('${FIRM_A}', '${C.a2}', 'financial_statements', 'RVW ad-hoc ok', '${M.partnerA}');
    `);
    expect(res.ok).toBe(true);
    psql(`delete from public.review_items where firm_id = '${FIRM_A}' and title = 'RVW ad-hoc ok';`);
  });

  it('re-linking an existing item to a mismatching task is rejected on UPDATE (23514)', () => {
    const res = attempt(`
      update public.review_items set task_id = '${T.a2}' where id = '${R.relink}';
    `);
    expect(res.ok).toBe(false);
    expect(res.code).toBe('23514');
  });

  it('re-linking to a consistent task + instance is accepted on UPDATE', () => {
    const res = attempt(`
      update public.review_items
      set task_id = '${T.linkedA1}', compliance_instance_id = '${I.a1a}'
      where id = '${R.relink}';
    `);
    expect(res.ok).toBe(true);
    const row = psql(
      `select task_id || ':' || compliance_instance_id || ':' || client_id from public.review_items where id = '${R.relink}'`,
    ).trim();
    expect(row).toBe(`${T.linkedA1}:${I.a1a}:${C.a1}`);
  });
});
