/**
 * IMP-040 PASS B — Tasks / dependencies / checklist / comments audit
 * integration tests (AUD-CAT-01 task-family coverage for SCH-13…16,
 * AUD-FAIL-01 denial evidence, AUD-CTX-05 fail-closed, TEST-AUD-02/03
 * families).
 *
 * Verifies, through REAL PostgREST requests plus operator psql inspection
 * of public.audit_log:
 *   - Layer-A row audit on tasks / task_checklist_items / task_comments
 *     (insert/update with old/new snapshots, actor ALWAYS auth.uid() of the
 *     caller, firm from the row) — task_dependencies deliberately carries
 *     NO Layer-A trigger (direct mutation is closed; the commands own the
 *     graph's audit trail);
 *   - the Layer-B transition command writes exactly one authoritative
 *     `task.transition` row — the app.audit_skip_trigger marker suppresses
 *     the Layer-A 'update' duplicate, and the atomic reviewer comment
 *     produces NO separate 'insert' audit row (its snapshot rides the
 *     transition row as new_value._reviewer_comment);
 *   - the transition audit row records the mutation key
 *     (new_value._mutation_key) and idempotent replays add NO audit rows;
 *   - the dependency commands write `task_dependency.add` /
 *     `task_dependency.remove` rows (object_type 'task_dependency'), keyed
 *     replays add nothing;
 *   - privileged-but-denied attempts are recorded as security-significant
 *     denials (task.transition_denied / task_dependency.add_denied with
 *     actor, firm, reason) when the target row(s) EXIST; nonexistent-id
 *     probes are un-audited (nothing to bind the event to);
 *   - guard rejections (status/waiting_reason PATCH attempts) leave no
 *     mutation audit;
 *   - audit-write failure aborts the operation (fail-closed, AUD-CTX-05)
 *     on the transition_task AND add_task_dependency paths via the
 *     test-only app.audit_fault hook (psql-only simulated request
 *     contexts — the audit.test.ts / IMP-031 precedent).
 *
 * Re-runnable: deterministic ids in the 67000000-… range, force-reset on
 * every run; fixture audit rows removed as the operator in teardown
 * (append-only applies to application roles, AUD-INV-01).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { api, FIRM_A, FIRM_B, psql, signIn, userEmail, userId } from '../helpers.mjs';

const H = (firm: string) => ({ 'x-active-firm': firm });

const M = {
  partnerA: '67000000-0000-4000-8000-000000000001',
  managerA: '67000000-0000-4000-8000-000000000002',
  seniorA: '67000000-0000-4000-8000-000000000003',
  articleA: '67000000-0000-4000-8000-000000000004',
  billingA: '67000000-0000-4000-8000-000000000005',
};
const C = {
  a1: '67000000-0000-4000-8000-000000000101', // manager = managerA
  a2: '67000000-0000-4000-8000-000000000102', // manager = null (out of portfolio)
};
const E = {
  a1: '67000000-0000-4000-8000-000000000201',
  a2: '67000000-0000-4000-8000-000000000202',
};
const TY = {
  four: '67000000-0000-4000-8000-0000000002c1', // four-eyes, entity scope
};
const I = {
  four: '67000000-0000-4000-8000-000000000301', // E.a1, TY.four, senior/article
};
const TK = {
  main: '67000000-0000-4000-8000-000000000401', // ad-hoc C.a1, assignee seniorA
  four: '67000000-0000-4000-8000-000000000402', // linked I.four, staged submitted
  depX: '67000000-0000-4000-8000-000000000403', // ad-hoc C.a1
  depY: '67000000-0000-4000-8000-000000000404', // ad-hoc C.a1
  fault: '67000000-0000-4000-8000-000000000405', // fail-closed transition target
  out: '67000000-0000-4000-8000-000000000406', // ad-hoc C.a2 (billing denial target)
};

const PARTNER_A = userId('USER_A_PARTNER');
const MANAGER_A = userId('USER_A_MANAGER');
const SENIOR_A = userId('USER_A_SENIOR');
const ARTICLE_A = userId('USER_A_ARTICLE');
const BILLING_A = userId('USER_A_BILLING');

let partnerA: string;
let managerA: string;
let seniorA: string;
let articleA: string;
let billingA: string;

// Server-assigned ids captured from API creates (tests run in file order).
let createdTaskId = '';
let commentId = '';

interface AuditRow {
  firm_id: string | null;
  actor_type: string;
  actor_user_id: string | null;
  action: string;
  object_type: string;
  object_id: string;
  old_value: Record<string, unknown> | null;
  new_value: Record<string, unknown> | null;
}

const TASK_OBJECT_TYPES = ['task', 'task_checklist_item', 'task_comment', 'task_dependency'];

function auditRows(objectId: string, objectTypes: string[] = TASK_OBJECT_TYPES): AuditRow[] {
  const out = psql(
    `select coalesce(json_agg(row_to_json(t) order by t.created_at, t.action), '[]'::json)
     from (select * from public.audit_log
           where object_type in (${objectTypes.map((o) => `'${o}'`).join(',')})
             and object_id = '${objectId}') t`,
  );
  return JSON.parse(out);
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
    delete from public.compliance_rule_versions where compliance_type_id in ('${TY.four}');
    delete from public.compliance_types where id in ('${TY.four}');
    delete from public.legal_entities where firm_id in ('${FIRM_A}', '${FIRM_B}');
    delete from public.clients where firm_id in ('${FIRM_A}', '${FIRM_B}');
    delete from public.firm_memberships where id in
      ('${M.partnerA}', '${M.managerA}', '${M.seniorA}', '${M.articleA}', '${M.billingA}');
  `);
}

beforeAll(async () => {
  cleanFixture();
  psql(`
    insert into public.firms (id, name) values
      ('${FIRM_A}', 'IMP-040 Audit Firm A'),
      ('${FIRM_B}', 'IMP-040 Audit Firm B')
    on conflict (id) do nothing;

    insert into public.firm_memberships (id, firm_id, user_id, role, status) values
      ('${M.partnerA}', '${FIRM_A}', '${PARTNER_A}', 'partner', 'active'),
      ('${M.managerA}', '${FIRM_A}', '${MANAGER_A}', 'manager', 'active'),
      ('${M.seniorA}',  '${FIRM_A}', '${SENIOR_A}',  'senior',  'active'),
      ('${M.articleA}', '${FIRM_A}', '${ARTICLE_A}', 'article_executive', 'active'),
      ('${M.billingA}', '${FIRM_A}', '${BILLING_A}', 'billing', 'active')
    on conflict (firm_id, user_id) do nothing;

    insert into public.clients (id, firm_id, name, owner_partner_membership_id, manager_membership_id) values
      ('${C.a1}', '${FIRM_A}', 'TSK Audit Client A1', '${M.partnerA}', '${M.managerA}'),
      ('${C.a2}', '${FIRM_A}', 'TSK Audit Client A2', '${M.partnerA}', null);

    insert into public.legal_entities (id, firm_id, client_id, entity_type, legal_name) values
      ('${E.a1}', '${FIRM_A}', '${C.a1}', 'private_limited', 'TSK Audit Entity A1'),
      ('${E.a2}', '${FIRM_A}', '${C.a2}', 'llp',             'TSK Audit Entity A2');

    insert into public.compliance_types
      (id, firm_id, type_key, name, category, frequency, due_rule, workflow_template,
       scope_kind, registration_class, governance_class, four_eyes_required)
    values
      ('${TY.four}', '${FIRM_A}', 'aud40-four', 'AUD40 Four-Eyes', 'Certificates',
       'custom', '{}', '{"states":["not_started","preparation","internal_review","ready_to_file","closed"]}',
       'entity', null, 'non_statutory', true);

    insert into public.compliance_instances
      (id, firm_id, legal_entity_id, compliance_type_id, period_start, period_end,
       period_label, due_date, assignee_membership_id, reviewer_membership_id)
    values
      ('${I.four}', '${FIRM_A}', '${E.a1}', '${TY.four}', '2026-04-01', '2026-06-30', 'FY26 Q1', '2026-07-31', '${M.seniorA}', '${M.articleA}');

    insert into public.tasks
      (id, firm_id, client_id, compliance_instance_id, title, next_action,
       assignee_membership_id, reviewer_membership_id)
    values
      ('${TK.main}', '${FIRM_A}', '${C.a1}', null,        'TSK audit main',  'collect docs', '${M.seniorA}', null),
      ('${TK.four}', '${FIRM_A}', '${C.a1}', '${I.four}', 'TSK audit four',  'finish prep',  '${M.seniorA}', '${M.articleA}'),
      ('${TK.depX}', '${FIRM_A}', '${C.a1}', null,        'TSK audit dep X', 'collect docs', null, null),
      ('${TK.depY}', '${FIRM_A}', '${C.a1}', null,        'TSK audit dep Y', 'collect docs', null, null),
      ('${TK.fault}','${FIRM_A}', '${C.a1}', null,        'TSK audit fault', 'collect docs', null, null),
      ('${TK.out}',  '${FIRM_A}', '${C.a2}', null,        'TSK audit out',   'collect docs', null, null);

    -- Stage TK.four at 'submitted' (transaction-local command flag inside a
    -- DO block — the IMP-030/031 staging precedent; never a request path).
    do $$ begin
      perform set_config('app.task_transition_command', '1', true);
      update public.tasks set status = 'submitted' where id = '${TK.four}';
    end $$;
  `);
  // Seeding itself writes operator audit rows; remove them so assertions
  // below see only the rows produced by the mutations under test (IMP-031
  // precedent).
  psql(`delete from public.audit_log where firm_id in ('${FIRM_A}', '${FIRM_B}')`);

  for (const [key, set] of [
    ['USER_A_PARTNER', (t: string) => (partnerA = t)],
    ['USER_A_MANAGER', (t: string) => (managerA = t)],
    ['USER_A_SENIOR', (t: string) => (seniorA = t)],
    ['USER_A_ARTICLE', (t: string) => (articleA = t)],
    ['USER_A_BILLING', (t: string) => (billingA = t)],
  ] as Array<[string, (t: string) => void]>) {
    const s = await signIn(userEmail(key));
    if (!s.ok) throw new Error(`sign-in failed for ${key}: ${JSON.stringify(s.raw)}`);
    set(s.token);
  }
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
// TEST-AUD-02 — Layer-A capture on tasks / checklist / comments
// ---------------------------------------------------------------------------

describe('TEST-AUD-02 — Layer-A insert/update capture with old/new snapshots', () => {
  it('task INSERT produces one audited row: human actor, firm from the row, NEW snapshot only', async () => {
    const res = await api(partnerA, 'POST', 'tasks', {
      headers: H(FIRM_A),
      body: {
        firm_id: FIRM_A, client_id: C.a2, title: 'audit-created task',
        next_action: 'collect docs', assignee_membership_id: M.seniorA,
      },
    });
    expect(res.status).toBe(201);
    createdTaskId = res.body[0].id as string;
    const rows = auditRows(createdTaskId);
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe('insert');
    expect(rows[0].object_type).toBe('task');
    expect(rows[0].actor_type).toBe('human');
    expect(rows[0].actor_user_id).toBe(PARTNER_A);
    expect(rows[0].firm_id).toBe(FIRM_A);
    expect(rows[0].old_value).toBeNull();
    expect((rows[0].new_value as { status: string }).status).toBe('open');
  });

  it('instance-linked task INSERT audits the trigger-derived client_id in the snapshot', async () => {
    const res = await api(partnerA, 'POST', 'tasks', {
      headers: H(FIRM_A),
      body: {
        firm_id: FIRM_A, compliance_instance_id: I.four,
        title: 'audit-linked task', next_action: 'finish prep',
        assignee_membership_id: M.seniorA, reviewer_membership_id: M.articleA,
      },
    });
    expect(res.status).toBe(201);
    const rows = auditRows(res.body[0].id as string);
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe('insert');
    expect((rows[0].new_value as { client_id: string }).client_id).toBe(C.a1);
  });

  it('task UPDATE carries old AND new values (routine non-state write)', async () => {
    const res = await api(managerA, 'PATCH', `tasks?id=eq.${TK.main}`, {
      headers: H(FIRM_A),
      body: { priority: 'high' },
    });
    expect(res.status).toBe(200);
    const rows = auditRows(TK.main);
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe('update');
    expect(rows[0].object_type).toBe('task');
    expect(rows[0].actor_user_id).toBe(MANAGER_A);
    expect((rows[0].old_value as { priority: string }).priority).toBe('normal');
    expect((rows[0].new_value as { priority: string }).priority).toBe('high');
  });

  it('checklist insert and toggle are audited; the toggle snapshot carries the server-stamped who/when', async () => {
    const added = await api(seniorA, 'POST', 'task_checklist_items', {
      headers: H(FIRM_A),
      body: { firm_id: FIRM_A, task_id: TK.main, label: 'audit checklist line', sort_order: 1 },
    });
    expect(added.status).toBe(201);
    const itemId = added.body[0].id as string;
    let rows = auditRows(itemId);
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe('insert');
    expect(rows[0].object_type).toBe('task_checklist_item');
    expect(rows[0].actor_user_id).toBe(SENIOR_A);

    const toggled = await api(seniorA, 'PATCH', `task_checklist_items?id=eq.${itemId}`, {
      headers: H(FIRM_A),
      body: { is_done: true },
    });
    expect(toggled.status).toBe(200);
    rows = auditRows(itemId);
    expect(rows).toHaveLength(2);
    const upd = rows[1];
    expect(upd.action).toBe('update');
    expect(upd.actor_user_id).toBe(SENIOR_A);
    expect((upd.old_value as { is_done: boolean }).is_done).toBe(false);
    expect((upd.new_value as { is_done: boolean }).is_done).toBe(true);
    expect((upd.new_value as { done_by: string }).done_by).toBe(SENIOR_A);
    expect((upd.new_value as { done_at: string | null }).done_at).not.toBeNull();
  });

  it('comment append and retraction are audited (author pinned, one-way flip)', async () => {
    const added = await api(seniorA, 'POST', 'task_comments', {
      headers: H(FIRM_A),
      body: { firm_id: FIRM_A, task_id: TK.main, author_id: SENIOR_A, body: 'audit comment line' },
    });
    expect(added.status).toBe(201);
    commentId = added.body[0].id as string;
    let rows = auditRows(commentId);
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe('insert');
    expect(rows[0].object_type).toBe('task_comment');
    expect(rows[0].actor_user_id).toBe(SENIOR_A);
    expect((rows[0].new_value as { author_id: string }).author_id).toBe(SENIOR_A);

    const retracted = await api(seniorA, 'PATCH', `task_comments?id=eq.${commentId}`, {
      headers: H(FIRM_A),
      body: { retracted: true },
    });
    expect(retracted.status).toBe(200);
    rows = auditRows(commentId);
    expect(rows).toHaveLength(2);
    const upd = rows[1];
    expect(upd.action).toBe('update');
    expect((upd.old_value as { retracted: boolean }).retracted).toBe(false);
    expect((upd.new_value as { retracted: boolean }).retracted).toBe(true);
  });

  it('a denied mutation (no row visible to the writer) leaves NO audit row', async () => {
    // billing can neither see nor write the task: the PATCH matches zero
    // rows, so no trigger fires and nothing is audited.
    const res = await api(billingA, 'PATCH', `tasks?id=eq.${TK.main}`, {
      headers: H(FIRM_A),
      body: { priority: 'low' },
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
    expect(auditRows(TK.main)).toHaveLength(1); // only the priority update above
  });
});

// ---------------------------------------------------------------------------
// TEST-AUD-03 — Layer-B transition command audit (skip-marker correctness)
// ---------------------------------------------------------------------------

describe('TEST-AUD-03 — transition command: one authoritative row, no trigger duplicate', () => {
  it('transition writes exactly task.transition with old/new status + the recorded mutation key', async () => {
    const res = await api(managerA, 'POST', 'rpc/transition_task', {
      headers: H(FIRM_A),
      body: { p_task_id: TK.main, p_target_status: 'in_progress', p_mutation_key: 'aud40-mk-1' },
    });
    expect(res.body.status).toBe('transitioned');
    const rows = auditRows(TK.main);
    // update (priority) + task.transition — the command's status UPDATE
    // produced NO Layer-A 'update' duplicate (app.audit_skip_trigger).
    expect(rows.map((r) => r.action)).toEqual(['update', 'task.transition']);
    const tr = rows[1];
    expect(tr.actor_type).toBe('human');
    expect(tr.actor_user_id).toBe(MANAGER_A);
    expect(tr.firm_id).toBe(FIRM_A);
    expect((tr.old_value as { status: string }).status).toBe('open');
    expect((tr.new_value as { status: string }).status).toBe('in_progress');
    expect((tr.new_value as { _mutation_key: string })._mutation_key).toBe('aud40-mk-1');
  });

  it('idempotent replay adds NO audit row; a keyless real transition records no _mutation_key', async () => {
    const replay = await api(managerA, 'POST', 'rpc/transition_task', {
      headers: H(FIRM_A),
      body: { p_task_id: TK.main, p_target_status: 'in_progress', p_mutation_key: 'aud40-mk-1' },
    });
    expect(replay.body.status).toBe('already_applied');
    expect(auditRows(TK.main)).toHaveLength(2);

    const next = await api(managerA, 'POST', 'rpc/transition_task', {
      headers: H(FIRM_A),
      body: {
        p_task_id: TK.main, p_target_status: 'waiting',
        p_waiting_reason: 'client documents pending',
      },
    });
    expect(next.body.status).toBe('transitioned');
    const rows = auditRows(TK.main);
    expect(rows).toHaveLength(3);
    const tr = rows[2];
    expect(tr.action).toBe('task.transition');
    expect((tr.old_value as { status: string }).status).toBe('in_progress');
    expect((tr.new_value as { waiting_reason: string }).waiting_reason).toBe('client documents pending');
    expect((tr.new_value as { _mutation_key?: string })._mutation_key).toBeUndefined();
  });

  it('reviewer return: ONE task.transition row carries _reviewer_comment; the atomic comment has NO insert audit row', async () => {
    const res = await api(articleA, 'POST', 'rpc/transition_task', {
      headers: H(FIRM_A),
      body: {
        p_task_id: TK.four, p_target_status: 'returned',
        p_reviewer_comment: 'rework the working papers',
      },
    });
    expect(res.body.status).toBe('transitioned');
    const returnCommentId = (res.body.reviewer_comment as { id: string }).id;
    const rows = auditRows(TK.four);
    expect(rows.map((r) => r.action)).toEqual(['task.transition']);
    const tr = rows[0];
    expect(tr.actor_user_id).toBe(ARTICLE_A);
    expect((tr.old_value as { status: string }).status).toBe('submitted');
    expect((tr.new_value as { status: string }).status).toBe('returned');
    const commentSnap = (tr.new_value as { _reviewer_comment: { id: string; body: string; author_id: string } })
      ._reviewer_comment;
    expect(commentSnap.id).toBe(returnCommentId);
    expect(commentSnap.body).toBe('rework the working papers');
    expect(commentSnap.author_id).toBe(ARTICLE_A);
    // The comment insert rode the skip marker: no Layer-A row of its own.
    expect(auditRows(returnCommentId, ['task_comment'])).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// TEST-AUD-03 — dependency command audit (command-owned graph trail)
// ---------------------------------------------------------------------------

describe('TEST-AUD-03 — dependency commands: single audited rows, keyed replays silent', () => {
  it('add writes one task_dependency.add row (object_type task_dependency) with the mutation key; replay adds nothing', async () => {
    const add = await api(partnerA, 'POST', 'rpc/add_task_dependency', {
      headers: H(FIRM_A),
      body: { p_task_id: TK.depX, p_depends_on_task_id: TK.depY, p_mutation_key: 'aud40-dep-1' },
    });
    expect(add.body.status).toBe('added');
    const edgeId = (add.body.dependency as { id: string }).id;
    const rows = auditRows(edgeId, ['task_dependency']);
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe('task_dependency.add');
    expect(rows[0].actor_user_id).toBe(PARTNER_A);
    expect(rows[0].firm_id).toBe(FIRM_A);
    expect(rows[0].old_value).toBeNull();
    expect((rows[0].new_value as { task_id: string }).task_id).toBe(TK.depX);
    expect((rows[0].new_value as { _mutation_key: string })._mutation_key).toBe('aud40-dep-1');
    // No Layer-A 'insert' duplicate exists for the edge (table unmapped).
    expect(rows.filter((r) => r.action === 'insert')).toHaveLength(0);

    const replay = await api(partnerA, 'POST', 'rpc/add_task_dependency', {
      headers: H(FIRM_A),
      body: { p_task_id: TK.depX, p_depends_on_task_id: TK.depY, p_mutation_key: 'aud40-dep-1' },
    });
    expect(replay.body.status).toBe('already_applied');
    expect(auditRows(edgeId, ['task_dependency'])).toHaveLength(1);

    const removed = await api(partnerA, 'POST', 'rpc/remove_task_dependency', {
      headers: H(FIRM_A),
      body: { p_task_id: TK.depX, p_depends_on_task_id: TK.depY, p_mutation_key: 'aud40-dep-2' },
    });
    expect(removed.body.status).toBe('removed');
    const after = auditRows(edgeId, ['task_dependency']);
    expect(after).toHaveLength(2);
    expect(after[1].action).toBe('task_dependency.remove');
    expect((after[1].old_value as { task_id: string }).task_id).toBe(TK.depX);
    expect((after[1].new_value as { _mutation_key: string })._mutation_key).toBe('aud40-dep-2');

    const removeReplay = await api(partnerA, 'POST', 'rpc/remove_task_dependency', {
      headers: H(FIRM_A),
      body: { p_task_id: TK.depX, p_depends_on_task_id: TK.depY, p_mutation_key: 'aud40-dep-2' },
    });
    expect(removeReplay.body.status).toBe('already_applied');
    expect(removeReplay.body.reason).toBe('edge_already_absent');
    expect(auditRows(edgeId, ['task_dependency'])).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// AUD-FAIL-01 — privileged-denied attempts are recorded; ghosts are not
// ---------------------------------------------------------------------------

describe('AUD-FAIL-01 — denial evidence', () => {
  it('billing transition denial on an EXISTING task is audited (API-ERR-02 reason); a nonexistent probe is not', async () => {
    const res = await api(billingA, 'POST', 'rpc/transition_task', {
      headers: H(FIRM_A),
      body: { p_task_id: TK.out, p_target_status: 'in_progress' },
    });
    expect(res.body).toEqual({ status: 'denied', kind: 'not_found', message: 'task not found' });
    const rows = auditRows(TK.out);
    expect(rows).toHaveLength(1);
    const denied = rows[0];
    expect(denied.action).toBe('task.transition_denied');
    expect(denied.actor_type).toBe('human');
    expect(denied.actor_user_id).toBe(BILLING_A);
    expect(denied.firm_id).toBe(FIRM_A);
    expect(denied.old_value).toBeNull();
    expect((denied.new_value as { reason: string }).reason).toBe('task not visible to caller (API-ERR-02)');
    expect((denied.new_value as { to_status: string }).to_status).toBe('in_progress');
    expect(psql(`select status from public.tasks where id = '${TK.out}';`).trim()).toBe('open');

    // A truly nonexistent id: identical caller body, NO audit row (no object
    // to bind the event to — IMP-030/031 precedent).
    const ghost = '67000000-0000-4000-8000-00000000fffe';
    const miss = await api(billingA, 'POST', 'rpc/transition_task', {
      headers: H(FIRM_A),
      body: { p_task_id: ghost, p_target_status: 'in_progress' },
    });
    expect(miss.body).toEqual(res.body);
    expect(auditRows(ghost)).toHaveLength(0);
  });

  it('billing dependency denial is audited only when BOTH tasks exist (bound to p_task_id)', async () => {
    const res = await api(billingA, 'POST', 'rpc/add_task_dependency', {
      headers: H(FIRM_A),
      body: { p_task_id: TK.depX, p_depends_on_task_id: TK.depY },
    });
    expect(res.body).toEqual({ status: 'denied', kind: 'not_found', message: 'task not found' });
    const rows = auditRows(TK.depX, ['task']);
    const denied = rows.filter((r) => r.action === 'task_dependency.add_denied');
    expect(denied).toHaveLength(1);
    expect(denied[0].actor_user_id).toBe(BILLING_A);
    expect((denied[0].new_value as { reason: string }).reason).toBe('task pair not visible to caller (API-ERR-02)');
    expect((denied[0].new_value as { depends_on_task_id: string }).depends_on_task_id).toBe(TK.depY);

    // A pair touching a nonexistent id is un-audited (nothing to bind).
    const ghost = '67000000-0000-4000-8000-00000000ffff';
    const before = auditRows(TK.depX, ['task']).length;
    const miss = await api(billingA, 'POST', 'rpc/add_task_dependency', {
      headers: H(FIRM_A),
      body: { p_task_id: TK.depX, p_depends_on_task_id: ghost },
    });
    expect(miss.body).toEqual(res.body);
    expect(auditRows(TK.depX, ['task'])).toHaveLength(before);
    expect(auditRows(ghost)).toHaveLength(0);
  });

  it('privileged four-eyes bypass attempt is audited (actor partner, from/to recorded)', async () => {
    // Walk TK.four back to submitted (assignee senior: returned -> in_progress
    // -> submitted), then the partner — outranking the reviewer — attempts the
    // review decision. RLS-4EY-03: no rank bypass (CA401).
    for (const to of ['in_progress', 'submitted']) {
      const step = await api(seniorA, 'POST', 'rpc/transition_task', {
        headers: H(FIRM_A),
        body: { p_task_id: TK.four, p_target_status: to },
      });
      expect(step.body.status, `walk to ${to}`).toBe('transitioned');
    }
    const res = await api(partnerA, 'POST', 'rpc/transition_task', {
      headers: H(FIRM_A),
      body: { p_task_id: TK.four, p_target_status: 'approved' },
    });
    expect(res.body.status).toBe('denied');
    expect(res.body.kind).toBe('unauthorized');
    const denied = auditRows(TK.four).filter((r) => r.action === 'task.transition_denied');
    expect(denied).toHaveLength(1);
    expect(denied[0].actor_user_id).toBe(PARTNER_A);
    expect(String((denied[0].new_value as { reason: string }).reason)).toContain('assigned reviewer');
    expect((denied[0].new_value as { from_status: string }).from_status).toBe('submitted');
    expect((denied[0].new_value as { to_status: string }).to_status).toBe('approved');
    expect(psql(`select status from public.tasks where id = '${TK.four}';`).trim()).toBe('submitted');
  });
});

// ---------------------------------------------------------------------------
// Guard rejections produce no mutation audit (single-writer marker)
// ---------------------------------------------------------------------------

describe('guard rejections produce no mutation audit', () => {
  it('rejected status/waiting_reason PATCHes add no rows to the task audit trail', async () => {
    const before = auditRows(TK.main).length;
    for (const body of [{ status: 'cancelled' }, { waiting_reason: 'forge the blocker' }]) {
      const res = await api(partnerA, 'PATCH', `tasks?id=eq.${TK.main}`, {
        headers: H(FIRM_A),
        body,
      });
      expect(res.status).toBeGreaterThanOrEqual(400);
    }
    expect(auditRows(TK.main)).toHaveLength(before);
    const intact = psql(
      `select status || '|' || coalesce(waiting_reason, '<null>') from public.tasks where id = '${TK.main}';`,
    ).trim();
    expect(intact).toBe('waiting|client documents pending');
  });
});

// ---------------------------------------------------------------------------
// AUD-CTX-05 — fail-closed: audit-write failure aborts the command
// ---------------------------------------------------------------------------

describe('AUD-CTX-05 — audit fault rolls back the command atomically (psql-only fault hook)', () => {
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

  it('transition_task: fault aborts mutation AND audit together', () => {
    const err = sqlError(`
      begin;
      set local request.jwt.claims = '{"sub":"${PARTNER_A}","aal":"aal1","role":"authenticated"}';
      set local request.headers = '{"x-active-firm":"${FIRM_A}"}';
      set local app.audit_fault = 'fail_audit';
      select public.transition_task('${TK.fault}', 'in_progress', null);
      commit;
    `);
    expect(err).toContain('fault injected');
    expect(psql(`select status from public.tasks where id = '${TK.fault}';`).trim()).toBe('open');
    expect(auditRows(TK.fault).filter((r) => r.action === 'task.transition')).toHaveLength(0);
  });

  it('add_task_dependency: fault aborts mutation AND audit together', () => {
    const addsBefore = psql(
      `select count(*) from public.audit_log
       where firm_id = '${FIRM_A}' and action = 'task_dependency.add'
         and new_value ->> 'task_id' = '${TK.depX}';`,
    ).trim();
    const err = sqlError(`
      begin;
      set local request.jwt.claims = '{"sub":"${PARTNER_A}","aal":"aal1","role":"authenticated"}';
      set local request.headers = '{"x-active-firm":"${FIRM_A}"}';
      set local app.audit_fault = 'fail_audit';
      select public.add_task_dependency('${TK.depX}', '${TK.depY}');
      commit;
    `);
    expect(err).toContain('fault injected');
    expect(
      psql(`select count(*) from public.task_dependencies
            where firm_id = '${FIRM_A}' and task_id = '${TK.depX}';`).trim(),
    ).toBe('0');
    // The earlier LEGITIMATE add's audit row survives (append-only); the
    // faulted attempt adds nothing on top of it.
    expect(
      psql(`select count(*) from public.audit_log
            where firm_id = '${FIRM_A}' and action = 'task_dependency.add'
              and new_value ->> 'task_id' = '${TK.depX}';`).trim(),
    ).toBe(addsBefore);
  });

  it('positive control: without the fault hook both commands commit mutation + audit together', () => {
    psql(`
      begin;
      set local request.jwt.claims = '{"sub":"${PARTNER_A}","aal":"aal1","role":"authenticated"}';
      set local request.headers = '{"x-active-firm":"${FIRM_A}"}';
      select public.transition_task('${TK.fault}', 'in_progress', null);
      select public.add_task_dependency('${TK.depX}', '${TK.depY}');
      commit;
    `);
    expect(psql(`select status from public.tasks where id = '${TK.fault}';`).trim()).toBe('in_progress');
    expect(
      psql(`select count(*) from public.task_dependencies
            where firm_id = '${FIRM_A}' and task_id = '${TK.depX}';`).trim(),
    ).toBe('1');
    expect(auditRows(TK.fault).map((r) => r.action)).toContain('task.transition');
  });
});
