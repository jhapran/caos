/**
 * IMP-040 PASS A — Tasks, dependencies, checklists, comments:
 * schema/data-integrity tests (SCH-13…16, DM-13/14/15, DM-SM-05 vocabulary).
 *
 * Maps to spec 11:
 *   TEST-SCH-15  task subject binding — instance-linked tasks derive
 *                client_id from the linked instance (forged values never
 *                take effect), re-linking re-derives, cross-firm instance
 *                links rejected; ad-hoc tasks require a same-firm client;
 *   TEST-SCH-16  DB-owned portion ONLY: DM-SM-05 status CHECK vocabulary +
 *                next_action NOT NULL. The waiting-requires-waiting_reason
 *                and returned-requires-reviewer-comment invariants are
 *                TRANSITION-COMMAND-OWNED (API-ARCH-04) and are explicitly
 *                deferred to PASS B (transition_task) — NOT tested here;
 *   TEST-SCH-18  dependency self-edge rejection;
 *   TEST-SCH-19  dependency duplicate-pair rejection;
 *   TEST-SCH-02  IMP-040 portion: composite same-firm FK rejection for the
 *                whole task family (foreign client/instance/assignee/
 *                reviewer on tasks; foreign task on dependencies/checklist/
 *                comments).
 *
 * PASS-B placeholders (NOT faked here — require the controlled Layer-B
 * commands, RLS-TSK-01/02, RLS-4EY-03):
 *   TEST-SCH-01  dependency acyclicity (recursive validation inside
 *                add_task_dependency);
 *   TEST-SCH-17  task four-eyes reviewer authorization;
 *   TEST-SCH-20  dependency cycle race (firm advisory lock + atomic
 *                validate+insert).
 * All three landed with PASS B in tests/integration/rls/tasks-rls.test.ts —
 * the commands require authenticated request contexts, which this
 * operator-only suite deliberately never opens.
 *
 * All assertions run as the postgres operator via psql — the owner role
 * proves each invariant holds WITHOUT RLS (RLS is never the integrity
 * boundary). PASS B added the production policies/grants (catalog-asserted
 * in rls-catalog.test.ts); the posture test below pins the final PASS-B
 * inventory for the four tables.
 *
 * Deterministic ids in the 64000000-… range; force-reset per run so the
 * suite is re-runnable; fixture audit rows removed as the operator in
 * teardown (append-only applies to application roles, AUD-INV-01).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { FIRM_A, FIRM_B, psql, userId } from '../helpers.mjs';

// Seeded system-default compliance type (supabase/seed.sql — reference
// data): entity scope, so instances need no registration.
const SYS_ITR = '50000000-0000-4000-8000-000000000005';

const M = {
  partnerA: '64000000-0000-4000-8000-000000000001',
  managerA: '64000000-0000-4000-8000-000000000002',
  seniorA: '64000000-0000-4000-8000-000000000003',
  partnerB: '64000000-0000-4000-8000-000000000004',
};
const C = {
  a1: '64000000-0000-4000-8000-000000000101',
  a2: '64000000-0000-4000-8000-000000000102',
  b1: '64000000-0000-4000-8000-000000000111', // other firm
};
const E = {
  a1: '64000000-0000-4000-8000-000000000201', // entity of client a1
  a2: '64000000-0000-4000-8000-000000000202', // entity of client a2
  b1: '64000000-0000-4000-8000-000000000211', // other firm
};
const I = {
  a1: '64000000-0000-4000-8000-000000000301', // instance of E.a1 → client a1
  a2: '64000000-0000-4000-8000-000000000302', // instance of E.a2 → client a2
  b1: '64000000-0000-4000-8000-000000000311', // other firm
};
const T = {
  a1: '64000000-0000-4000-8000-000000000401', // ad-hoc, client a1, seniorA assigned
  a2: '64000000-0000-4000-8000-000000000402', // ad-hoc, client a1 (re-link target)
  b1: '64000000-0000-4000-8000-000000000411', // ad-hoc, firm B
  linked: '64000000-0000-4000-8000-000000000421', // SCH-15 scratch
  forged: '64000000-0000-4000-8000-000000000422', // SCH-15 scratch
};
const CM = {
  one: '64000000-0000-4000-8000-000000000501',
};

const PARTNER_A = userId('USER_A_PARTNER');
const MANAGER_A = userId('USER_A_MANAGER');
const SENIOR_A = userId('USER_A_SENIOR');
const PARTNER_B = userId('USER_B_PARTNER');

/** Run a DO-free SQL batch, returning { ok, code, detail } — never throws on
 *  SQL errors so denial assertions can inspect the SQLSTATE/DETAIL. */
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
    delete from public.audit_log where firm_id in ('${FIRM_A}', '${FIRM_B}');
    delete from public.task_comments where firm_id in ('${FIRM_A}', '${FIRM_B}');
    delete from public.task_checklist_items where firm_id in ('${FIRM_A}', '${FIRM_B}');
    delete from public.task_dependencies where firm_id in ('${FIRM_A}', '${FIRM_B}');
    delete from public.tasks where firm_id in ('${FIRM_A}', '${FIRM_B}');
    delete from public.compliance_instances where firm_id in ('${FIRM_A}', '${FIRM_B}');
    delete from public.client_compliance_profiles where firm_id in ('${FIRM_A}', '${FIRM_B}');
    delete from public.legal_entities where firm_id in ('${FIRM_A}', '${FIRM_B}');
    delete from public.clients where firm_id in ('${FIRM_A}', '${FIRM_B}');
    delete from public.firm_memberships where id in
      ('${M.partnerA}','${M.managerA}','${M.seniorA}','${M.partnerB}');
  `);
}

beforeAll(() => {
  cleanFixture();
  psql(`
    insert into public.firms (id, name) values
      ('${FIRM_A}', 'IMP-040 Schema Firm A'),
      ('${FIRM_B}', 'IMP-040 Schema Firm B')
    on conflict (id) do nothing;

    insert into public.firm_memberships (id, firm_id, user_id, role, status) values
      ('${M.partnerA}', '${FIRM_A}', '${PARTNER_A}', 'partner', 'active'),
      ('${M.managerA}', '${FIRM_A}', '${MANAGER_A}', 'manager', 'active'),
      ('${M.seniorA}',  '${FIRM_A}', '${SENIOR_A}',  'senior',  'active'),
      ('${M.partnerB}', '${FIRM_B}', '${PARTNER_B}', 'partner', 'active')
    on conflict (firm_id, user_id) do nothing;

    insert into public.clients (id, firm_id, name, owner_partner_membership_id, manager_membership_id) values
      ('${C.a1}', '${FIRM_A}', 'TSK Schema Client A1', '${M.partnerA}', '${M.managerA}'),
      ('${C.a2}', '${FIRM_A}', 'TSK Schema Client A2', '${M.partnerA}', null),
      ('${C.b1}', '${FIRM_B}', 'TSK Schema Client B1', '${M.partnerB}', null);

    insert into public.legal_entities (id, firm_id, client_id, entity_type, legal_name) values
      ('${E.a1}', '${FIRM_A}', '${C.a1}', 'private_limited', 'TSK Entity A1'),
      ('${E.a2}', '${FIRM_A}', '${C.a2}', 'llp',             'TSK Entity A2'),
      ('${E.b1}', '${FIRM_B}', '${C.b1}', 'private_limited', 'TSK Entity B1');

    insert into public.compliance_instances
      (id, firm_id, legal_entity_id, compliance_type_id, period_start, period_end, period_label, due_date)
    values
      ('${I.a1}', '${FIRM_A}', '${E.a1}', '${SYS_ITR}', '2026-04-01', '2026-06-30', 'FY26 Q1', '2026-07-31'),
      ('${I.a2}', '${FIRM_A}', '${E.a2}', '${SYS_ITR}', '2026-04-01', '2026-06-30', 'FY26 Q1', '2026-07-31'),
      ('${I.b1}', '${FIRM_B}', '${E.b1}', '${SYS_ITR}', '2026-04-01', '2026-06-30', 'FY26 Q1', '2026-07-31');

    insert into public.tasks (id, firm_id, client_id, title, next_action, assignee_membership_id) values
      ('${T.a1}', '${FIRM_A}', '${C.a1}', 'TSK ad-hoc A1', 'collect documents', '${M.seniorA}'),
      ('${T.a2}', '${FIRM_A}', '${C.a1}', 'TSK ad-hoc A2', 'reconcile ledger', null),
      ('${T.b1}', '${FIRM_B}', '${C.b1}', 'TSK ad-hoc B1', 'call client', null);

    insert into public.task_comments (id, firm_id, task_id, author_id, body) values
      ('${CM.one}', '${FIRM_A}', '${T.a1}', '${SENIOR_A}', 'TSK immutable comment');
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
// Structural contract
// ---------------------------------------------------------------------------

describe('structural contract (SCH-13…16)', () => {
  it('all four tables exist with the spec columns, parent key, and pair uniqueness', () => {
    const cols = psql(`
      select table_name || ':' || string_agg(column_name, ',' order by column_name)
      from information_schema.columns
      where table_schema = 'public'
        and table_name in ('tasks', 'task_dependencies', 'task_checklist_items', 'task_comments')
      group by table_name order by table_name;
    `);
    expect(cols).toContain(
      'tasks:assignee_membership_id,client_id,compliance_instance_id,created_at,description,' +
        'due_date,firm_id,id,next_action,priority,reviewer_membership_id,status,time_spent_minutes,' +
        'title,updated_at,waiting_reason',
    );
    expect(cols).toContain(
      'task_checklist_items:created_at,done_at,done_by,firm_id,id,is_done,label,sort_order,task_id,template_source,updated_at',
    );
    expect(cols).toContain('task_comments:author_id,body,created_at,firm_id,id,retracted,task_id');
    expect(cols).toContain('task_dependencies:created_at,dependency_type,depends_on_task_id,firm_id,id,task_id');

    const uniques = psql(`
      select conrelid::regclass::text || ':' || conname from pg_constraint
      where connamespace = 'public'::regnamespace and contype = 'u'
        and conrelid in ('public.tasks'::regclass, 'public.task_dependencies'::regclass)
      order by 1;
    `);
    // SCH-FK-01: the (firm_id, id) parent key the three child tables bind.
    expect(uniques).toContain('tasks:tasks_firm_id_unique');
    // SCH-14: one edge per (task, depends-on) pair.
    expect(uniques).toContain('task_dependencies:task_dependencies_pair_unique');
  });

  it('server defaults land (status open, priority normal, time_spent 0)', () => {
    psql(`
      insert into public.tasks (firm_id, client_id, title, next_action)
      values ('${FIRM_A}', '${C.a1}', 'TSK defaults probe', 'probe defaults');
    `);
    const row = psql(`
      select status || ':' || priority || ':' || time_spent_minutes
      from public.tasks where firm_id = '${FIRM_A}' and title = 'TSK defaults probe';
    `).trim();
    expect(row).toBe('open:normal:0');
    psql(`delete from public.tasks where firm_id = '${FIRM_A}' and title = 'TSK defaults probe';`);
  });

  it('spec indexes exist (SCH-13/14/15/16)', () => {
    const idx = psql(`
      select indexname from pg_indexes
      where schemaname = 'public'
        and tablename in ('tasks', 'task_dependencies', 'task_checklist_items', 'task_comments');
    `);
    for (const name of [
      'tasks_my_work_idx',
      'tasks_firm_client_idx',
      'tasks_instance_idx',
      'tasks_firm_due_idx',
      'task_dependencies_task_idx',
      'task_dependencies_depends_on_idx',
      'task_checklist_items_task_sort_idx',
      'task_comments_task_created_idx',
    ]) {
      expect(idx).toContain(name);
    }
  });

  it('RLS posture: enabled AND forced with the final PASS-B policy/grant inventory (RLS-TSK-01/02, RLS-TCM-01)', () => {
    const rls = psql(`
      select relname || ':' || relrowsecurity || ':' || relforcerowsecurity
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
        and c.relname in ('tasks', 'task_dependencies', 'task_checklist_items', 'task_comments')
      order by 1;
    `);
    expect(rls.trim().split('\n').sort()).toEqual([
      'task_checklist_items:true:true',
      'task_comments:true:true',
      'task_dependencies:true:true',
      'tasks:true:true',
    ]);
    // Exactly the PASS-B policies (the full cross-table inventory is pinned
    // in rls-catalog.test.ts).
    expect(
      psql(`select tablename || ':' || policyname from pg_policies
            where schemaname = 'public'
              and tablename in ('tasks', 'task_dependencies', 'task_checklist_items', 'task_comments')
            order by 1`).trim().split('\n'),
    ).toEqual([
      'task_checklist_items:task_checklist_items_delete_via_task',
      'task_checklist_items:task_checklist_items_insert_via_task',
      'task_checklist_items:task_checklist_items_select_via_task',
      'task_checklist_items:task_checklist_items_update_via_task',
      'task_comments:task_comments_insert_author',
      'task_comments:task_comments_select_via_task',
      'task_comments:task_comments_update_retract_author',
      'task_dependencies:task_dependencies_select_scoped',
      'tasks:tasks_insert_scoped',
      'tasks:tasks_select_scoped',
      'tasks:tasks_update_scoped',
    ]);
    // anon still holds NOTHING on the four tables (RLS-SVC-03).
    expect(
      psql(`select count(*) from information_schema.role_table_grants
            where table_schema = 'public' and grantee = 'anon'
              and table_name in ('tasks', 'task_dependencies', 'task_checklist_items', 'task_comments')`).trim(),
    ).toBe('0');
    // Browser write posture: status/waiting_reason/identity columns carry no
    // INSERT/UPDATE grant on tasks and client_id no UPDATE grant (client_id
    // IS insertable — ad-hoc tasks name their client — but is server-derived
    // on the instance-linked path); comments update is retracted-only;
    // dependencies carry no write grant at all. The EXACT granted column
    // sets are inventoried in rls-catalog.test.ts.
    expect(
      psql(`select count(*) from information_schema.role_column_grants
            where table_schema = 'public' and grantee = 'authenticated'
              and ((table_name = 'tasks' and privilege_type = 'INSERT'
                    and column_name in ('id', 'status', 'waiting_reason', 'created_at', 'updated_at'))
                   or (table_name = 'tasks' and privilege_type = 'UPDATE'
                    and column_name in ('id', 'status', 'waiting_reason', 'client_id', 'created_at', 'updated_at'))
                   or (table_name = 'task_comments' and privilege_type = 'UPDATE' and column_name <> 'retracted')
                   or (table_name = 'task_dependencies' and privilege_type in ('INSERT', 'UPDATE')))`).trim(),
    ).toBe('0');
    // The trigger functions are owner-only (never browser-executable).
    for (const fn of ['tasks_guard_write()', 'task_comments_guard_update()', 'task_checklist_items_stamp_done()']) {
      for (const role of ['anon', 'authenticated', 'public']) {
        expect(
          psql(`select has_function_privilege('${role}', 'public.${fn}', 'EXECUTE')`).trim(),
        ).toBe('f');
      }
    }
    // The three Layer-B commands are executable by authenticated only.
    for (const fn of ['transition_task(uuid,text,text,text,text)', 'add_task_dependency(uuid,uuid,text,text)', 'remove_task_dependency(uuid,uuid,text)']) {
      expect(psql(`select has_function_privilege('authenticated', 'public.${fn}', 'EXECUTE')`).trim()).toBe('t');
      for (const role of ['anon', 'public', 'service_role']) {
        expect(
          psql(`select has_function_privilege('${role}', 'public.${fn}', 'EXECUTE')`).trim(),
        ).toBe('f');
      }
    }
  });
});

// ---------------------------------------------------------------------------
// TEST-SCH-15 — task subject binding (SCH-13, DM-13)
// ---------------------------------------------------------------------------

describe('TEST-SCH-15 — subject binding', () => {
  it('a linked task with the instance client is accepted', () => {
    const res = attempt(`
      insert into public.tasks (id, firm_id, client_id, compliance_instance_id, title, next_action)
      values ('${T.linked}', '${FIRM_A}', '${C.a1}', '${I.a1}', 'TSK linked ok', 'file the return');
    `);
    expect(res.ok).toBe(true);
    expect(psql(`select client_id from public.tasks where id = '${T.linked}'`).trim()).toBe(C.a1);
  });

  it('a forged client_id never takes effect — the guard derives the subject from the instance', () => {
    // I.a2 belongs to client a2; the caller claims client a1.
    const res = attempt(`
      insert into public.tasks (id, firm_id, client_id, compliance_instance_id, title, next_action)
      values ('${T.forged}', '${FIRM_A}', '${C.a1}', '${I.a2}', 'TSK forged client', 'try to forge');
    `);
    expect(res.ok).toBe(true);
    // Mismatch is impossible: the stored subject is the instance's client.
    expect(psql(`select client_id from public.tasks where id = '${T.forged}'`).trim()).toBe(C.a2);
  });

  it('cross-firm instance links are rejected at the constraint layer', () => {
    const res = attempt(`
      insert into public.tasks (firm_id, client_id, compliance_instance_id, title, next_action)
      values ('${FIRM_A}', '${C.a1}', '${I.b1}', 'TSK cross-firm instance', 'nope');
    `);
    expect(res.ok).toBe(false);
    expect(res.code).toBe('23503');
  });

  it('re-linking re-derives the subject — a forged client_id in the same UPDATE is overwritten', () => {
    // T.a2 starts ad-hoc on client a1; re-link to I.a2 (client a2) while
    // simultaneously trying to pin client_id back to a1.
    const res = attempt(`
      update public.tasks
      set compliance_instance_id = '${I.a2}', client_id = '${C.a1}'
      where id = '${T.a2}';
    `);
    expect(res.ok).toBe(true);
    const row = psql(
      `select compliance_instance_id || ':' || client_id from public.tasks where id = '${T.a2}'`,
    ).trim();
    expect(row).toBe(`${I.a2}:${C.a2}`);
  });

  it('ad-hoc tasks: client_id is required and must be same-firm', () => {
    const missing = attempt(`
      insert into public.tasks (firm_id, title, next_action)
      values ('${FIRM_A}', 'TSK no client', 'no client');
    `);
    expect(missing.ok).toBe(false);
    expect(missing.code).toBe('23502');

    const foreign = attempt(`
      insert into public.tasks (firm_id, client_id, title, next_action)
      values ('${FIRM_A}', '${C.b1}', 'TSK foreign client', 'nope');
    `);
    expect(foreign.ok).toBe(false);
    expect(foreign.code).toBe('23503');

    // Same-firm ad-hoc is accepted (fixtures T.a1/T.a2 prove it).
    const ok = attempt(`
      insert into public.tasks (firm_id, client_id, title, next_action)
      values ('${FIRM_A}', '${C.a2}', 'TSK ad-hoc ok', 'fine');
    `);
    expect(ok.ok).toBe(true);
    psql(`delete from public.tasks where firm_id = '${FIRM_A}' and title = 'TSK ad-hoc ok';`);
  });
});

// ---------------------------------------------------------------------------
// TEST-SCH-16 — mandatory lifecycle fields, DB-OWNED PORTION ONLY.
// DEFERRED TO PASS B (transition_task command, API-ARCH-04 — do NOT mark
// tested here):
//   * entering 'waiting' requires waiting_reason;
//   * entering 'returned' requires a non-empty reviewer comment created
//     atomically with the transition (an immutable SCH-16 comment);
//   * DM-SM-05 transition legality itself (which from→to moves are legal).
// These are atomic multi-write transition invariants that a CHECK cannot
// express; PASS A ships only the vocabulary CHECK and the NOT NULLs.
// ---------------------------------------------------------------------------

describe('TEST-SCH-16 — mandatory lifecycle fields (DB-owned portion; waiting_reason/returned-comment deferred to PASS B)', () => {
  it('next_action is mandatory (NOT NULL)', () => {
    const res = attempt(`
      insert into public.tasks (firm_id, client_id, title)
      values ('${FIRM_A}', '${C.a1}', 'TSK no next action');
    `);
    expect(res.ok).toBe(false);
    expect(res.code).toBe('23502');
  });

  it('a status outside the DM-SM-05 vocabulary is rejected by CHECK', () => {
    const res = attempt(`
      insert into public.tasks (firm_id, client_id, title, next_action, status)
      values ('${FIRM_A}', '${C.a1}', 'TSK bad status', 'x', 'blocked');
    `);
    expect(res.ok).toBe(false);
    expect(res.code).toBe('23514');
  });

  it('the exact 8-state DM-SM-05 vocabulary is accepted', () => {
    for (const status of [
      'open',
      'in_progress',
      'waiting',
      'submitted',
      'returned',
      'approved',
      'done',
      'cancelled',
    ]) {
      // NOTE: 'waiting' without waiting_reason is insertable at the raw SQL
      // layer in PASS A BY DESIGN — that invariant is transition-command-owned
      // (see the describe block header). This test asserts the vocabulary
      // CHECK only.
      const res = attempt(`
        insert into public.tasks (firm_id, client_id, title, next_action, status)
        values ('${FIRM_A}', '${C.a1}', 'TSK SCH-16 ${status}', 'x', '${status}');
      `);
      expect(res.ok).toBe(true);
    }
    psql(`delete from public.tasks where firm_id = '${FIRM_A}' and title like 'TSK SCH-16 %';`);
  });
});

// ---------------------------------------------------------------------------
// TEST-SCH-02 (IMP-040 portion) — composite same-firm FK rejection
// ---------------------------------------------------------------------------

describe('TEST-SCH-02 (IMP-040 portion) — composite same-firm FKs', () => {
  it('tasks reject foreign client / instance / assignee / reviewer (23503)', () => {
    const foreignClient = attempt(`
      insert into public.tasks (firm_id, client_id, title, next_action)
      values ('${FIRM_A}', '${C.b1}', 'TSK fk client', 'x');
    `);
    expect(foreignClient.code).toBe('23503');

    const foreignInstance = attempt(`
      insert into public.tasks (firm_id, client_id, compliance_instance_id, title, next_action)
      values ('${FIRM_A}', '${C.a1}', '${I.b1}', 'TSK fk instance', 'x');
    `);
    expect(foreignInstance.code).toBe('23503');

    const foreignAssignee = attempt(`
      insert into public.tasks (firm_id, client_id, title, next_action, assignee_membership_id)
      values ('${FIRM_A}', '${C.a1}', 'TSK fk assignee', 'x', '${M.partnerB}');
    `);
    expect(foreignAssignee.code).toBe('23503');

    const foreignReviewer = attempt(`
      insert into public.tasks (firm_id, client_id, title, next_action, reviewer_membership_id)
      values ('${FIRM_A}', '${C.a1}', 'TSK fk reviewer', 'x', '${M.partnerB}');
    `);
    expect(foreignReviewer.code).toBe('23503');
  });

  it('dependencies / checklist items / comments reject a foreign task (23503)', () => {
    const dep = attempt(`
      insert into public.task_dependencies (firm_id, task_id, depends_on_task_id)
      values ('${FIRM_A}', '${T.a1}', '${T.b1}');
    `);
    expect(dep.code).toBe('23503');

    const item = attempt(`
      insert into public.task_checklist_items (firm_id, task_id, label)
      values ('${FIRM_A}', '${T.b1}', 'TSK fk item');
    `);
    expect(item.code).toBe('23503');

    const comment = attempt(`
      insert into public.task_comments (firm_id, task_id, author_id, body)
      values ('${FIRM_A}', '${T.b1}', '${SENIOR_A}', 'TSK fk comment');
    `);
    expect(comment.code).toBe('23503');
  });

  it('task identity is insert-only (firm_id rewrite rejected with the IMMUTABLE_FIELD marker)', () => {
    const res = attempt(`
      update public.tasks set firm_id = '${FIRM_B}' where id = '${T.a1}';
    `);
    expect(res.ok).toBe(false);
    expect(res.code).toBe('23514');
    expect(res.detail).toBe('IMMUTABLE_FIELD:tasks.identity');
  });
});

// ---------------------------------------------------------------------------
// TEST-SCH-18 / TEST-SCH-19 — dependency self-edge and duplicate pair.
// TEST-SCH-01 (acyclicity) and TEST-SCH-20 (concurrent opposing-edge race)
// are PASS-B scope: they require the controlled add_task_dependency command
// (firm-scoped advisory lock + recursive cycle validation + atomic insert,
// RLS-TSK-02). No public mutation surface or cycle function exists yet —
// deliberately untested here rather than faked.
// ---------------------------------------------------------------------------

describe('TEST-SCH-18/19 — dependency declarative invariants', () => {
  it('TEST-SCH-18: a self-edge is rejected', () => {
    const res = attempt(`
      insert into public.task_dependencies (firm_id, task_id, depends_on_task_id)
      values ('${FIRM_A}', '${T.a1}', '${T.a1}');
    `);
    expect(res.ok).toBe(false);
    expect(res.code).toBe('23514');
  });

  it('TEST-SCH-19: a duplicate (task, depends-on) pair is rejected', () => {
    const first = attempt(`
      insert into public.task_dependencies (firm_id, task_id, depends_on_task_id)
      values ('${FIRM_A}', '${T.a1}', '${T.a2}');
    `);
    expect(first.ok).toBe(true);
    const dup = attempt(`
      insert into public.task_dependencies (firm_id, task_id, depends_on_task_id)
      values ('${FIRM_A}', '${T.a1}', '${T.a2}');
    `);
    expect(dup.ok).toBe(false);
    expect(dup.code).toBe('23505');
    psql(`delete from public.task_dependencies where task_id = '${T.a1}';`);
  });
});

// ---------------------------------------------------------------------------
// SCH-16 — comment immutability (DM-15)
// ---------------------------------------------------------------------------

describe('SCH-16 — comment immutability', () => {
  it('task_comments has NO updated_at column', () => {
    expect(
      psql(`select count(*) from information_schema.columns
            where table_schema = 'public' and table_name = 'task_comments'
              and column_name = 'updated_at'`).trim(),
    ).toBe('0');
  });

  it('content, parentage, authorship, and timestamp are immutable (IMMUTABLE_FIELD → conflict)', () => {
    for (const set of [
      `body = 'edited'`,
      `task_id = '${T.a2}'`,
      `author_id = '${PARTNER_A}'`,
      `created_at = now()`,
    ]) {
      const res = attempt(`update public.task_comments set ${set} where id = '${CM.one}';`);
      expect(res.ok).toBe(false);
      expect(res.code).toBe('23514');
      expect(res.detail).toBe('IMMUTABLE_FIELD:task_comments.content');
    }
  });

  it('retraction is one-way: retracted false -> true allowed, true -> false rejected', () => {
    const retract = attempt(`update public.task_comments set retracted = true where id = '${CM.one}';`);
    expect(retract.ok).toBe(true);
    expect(
      psql(`select retracted from public.task_comments where id = '${CM.one}'`).trim(),
    ).toBe('t');
    const unretract = attempt(`update public.task_comments set retracted = false where id = '${CM.one}';`);
    expect(unretract.ok).toBe(false);
    expect(unretract.code).toBe('23514');
    expect(unretract.detail).toBe('IMMUTABLE_FIELD:task_comments.retracted');
  });
});

// ---------------------------------------------------------------------------
// SCH-15 — checklist invariants (DM-14)
// ---------------------------------------------------------------------------

describe('SCH-15 — checklist items', () => {
  it('is_done = true always carries done_at — the PASS-B stamper guarantees the DM-14 who/when invariant', () => {
    // PASS-B behavior change: the task_checklist_items_stamp_done trigger
    // stamps done_at = now() on any insert-done row, so the PASS-A rejection
    // path is replaced by guaranteed stamping (the CHECK remains as the
    // backstop and is asserted catalog-side below). On the operator path
    // (no JWT) done_by keeps its supplied value — NULL here.
    psql(`
      insert into public.task_checklist_items (firm_id, task_id, label, is_done)
      values ('${FIRM_A}', '${T.a1}', 'TSK done without when', true);
    `);
    const stamped = psql(`
      select (done_at is not null) || '|' || coalesce(done_by::text, '<null>')
      from public.task_checklist_items
      where firm_id = '${FIRM_A}' and task_id = '${T.a1}' and label = 'TSK done without when';
    `).trim();
    expect(stamped).toBe('true|<null>');
    // The CHECK backstop is still in force underneath the stamper.
    expect(
      psql(`select count(*) from pg_constraint c join pg_class t on t.oid = c.conrelid
            join pg_namespace n on n.oid = t.relnamespace
            where n.nspname = 'public' and t.relname = 'task_checklist_items'
              and c.contype = 'c' and pg_get_constraintdef(c.oid) like '%is_done%done_at%';`).trim(),
    ).toBe('1');

    const done = attempt(`
      insert into public.task_checklist_items (firm_id, task_id, label, is_done, done_by, done_at)
      values ('${FIRM_A}', '${T.a1}', 'TSK done with when', true, '${SENIOR_A}', now());
    `);
    expect(done.ok).toBe(true);

    const open = attempt(`
      insert into public.task_checklist_items (firm_id, task_id, label)
      values ('${FIRM_A}', '${T.a1}', 'TSK open item');
    `);
    expect(open.ok).toBe(true);
  });

  it('template_source is stored (template origin for recurrence copying, PRD §29)', () => {
    psql(`
      insert into public.task_checklist_items (firm_id, task_id, label, template_source, sort_order)
      values ('${FIRM_A}', '${T.a1}', 'TSK templated item', 'itr-checklist-v1', 7);
    `);
    const row = psql(`
      select template_source || ':' || sort_order from public.task_checklist_items
      where firm_id = '${FIRM_A}' and label = 'TSK templated item';
    `).trim();
    expect(row).toBe('itr-checklist-v1:7');
  });
});
