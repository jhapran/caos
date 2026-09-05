/**
 * IMP-041 PASS B — Review-queue audit integration tests (TEST-AUD-12,
 * spec 08 §7c review-item audit partition; AUD-CAT-01 review-family
 * coverage for SCH-17; AUD-CTX-01 server-derived actor; AUD-VAL-01
 * old/new capture; AUD-FAIL-01 denial evidence; AUD-CTX-05 fail-closed;
 * AUD-INV-01 immutability posture).
 *
 * Verifies, through REAL PostgREST requests plus operator psql inspection
 * of public.audit_log:
 *   - submit_review_item writes exactly ONE `review_item.submitted` Layer-B
 *     row (server-derived actor/firm/submitter, NEW snapshot only) — the
 *     app.audit_skip_trigger marker suppresses the Layer-A 'insert'
 *     duplicate, so the exact action multiset per object is authoritative;
 *   - decide_review_item writes exactly ONE `review_item.decided` row with
 *     old (pending) / new (terminal) snapshots, the rationale riding
 *     new_value.decision_rationale and the mutation key as
 *     new_value._mutation_key; keyed replays (already_applied) add NO row;
 *   - denials: a probe against an EXISTING but invisible subject/item is
 *     audited server-side (review_item.submit_denied / review_item.decide_denied)
 *     while the caller sees the identical API-ERR-02 not_found envelope; a
 *     nonexistent id gets NO invented audit row; self-decision (RLS-4EY-04)
 *     is an audited unauthorized denial with the item unchanged;
 *   - the task-linked `returned` composition audits the decision AND the
 *     task transition (task.transition) in one transaction with exactly one
 *     immutable SCH-16 reviewer comment and no Layer-A duplicates on either
 *     object; a refused linked return (decider is not the assigned task
 *     reviewer, RLS-4EY-03) rolls the whole command back — ONE denial row,
 *     no inner task-denial audit, item pending, no comment;
 *   - audit-write failure aborts the command atomically (fail-closed,
 *     AUD-CTX-05) on BOTH command paths via the test-only app.audit_fault
 *     hook (psql-only simulated request contexts — the tasks-audit.test.ts /
 *     IMP-031 precedent);
 *   - review-item audit rows participate in the append-only posture
 *     (AUD-INV-01): UPDATE/DELETE/INSERT on audit_log via PostgREST are
 *     denied even to a super_admin.
 *
 * Re-runnable: deterministic ids in the 6a000000-… range, force-reset on
 * every run; fixture audit rows removed as the operator in teardown
 * (append-only applies to application roles, AUD-INV-01). Cleanup is
 * SCOPED to this file's two fixture firms only.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { api, psql, signIn, userEmail, userId } from '../helpers.mjs';

const H = (firm: string) => ({ 'x-active-firm': firm });

const FIRM_MAIN = '6a000000-0000-4000-8000-00000000f00a';
const FIRM_X = '6a000000-0000-4000-8000-00000000f00b';

const M = {
  superAdmin: '6a000000-0000-4000-8000-000000000001',
  partner: '6a000000-0000-4000-8000-000000000002',
  manager: '6a000000-0000-4000-8000-000000000003',
  senior: '6a000000-0000-4000-8000-000000000004',
  article: '6a000000-0000-4000-8000-000000000005',
  partnerX: '6a000000-0000-4000-8000-000000000006', // FIRM_X partner
};
const C = {
  inPort: '6a000000-0000-4000-8000-000000000101', // manager = M.manager
  outPort: '6a000000-0000-4000-8000-000000000102', // manager = null (out of portfolio)
  cross: '6a000000-0000-4000-8000-000000000103', // FIRM_X client
};
const E = {
  inPort: '6a000000-0000-4000-8000-000000000201',
};
const TY = {
  four: '6a000000-0000-4000-8000-0000000002c1', // four-eyes, entity scope
};
const I = {
  four: '6a000000-0000-4000-8000-000000000301', // E.inPort, TY.four
};
const TK = {
  linked: '6a000000-0000-4000-8000-000000000401', // linked I.four, staged submitted
  linkedRefuse: '6a000000-0000-4000-8000-000000000402', // linked I.four, staged submitted
  linkedFault: '6a000000-0000-4000-8000-000000000403', // linked I.four, staged submitted
};
const RI = {
  decAdhoc: '6a000000-0000-4000-8000-000000000501', // C.inPort, submitter partner
  selfDecide: '6a000000-0000-4000-8000-000000000502', // C.inPort, submitter partner
  hidden: '6a000000-0000-4000-8000-000000000503', // C.outPort, submitter partner
  linkedOk: '6a000000-0000-4000-8000-000000000504', // TK.linked, submitter senior
  linkedRefuse: '6a000000-0000-4000-8000-000000000505', // TK.linkedRefuse, submitter senior
  linkedFault: '6a000000-0000-4000-8000-000000000506', // TK.linkedFault, submitter senior
};
const GHOST_ITEM = '6a000000-0000-4000-8000-00000000fffe';
const GHOST_CLIENT = '6a000000-0000-4000-8000-00000000fffd';

const SUPER_ADMIN = userId('USER_A_SUPER_ADMIN');
const PARTNER = userId('USER_A_PARTNER');
const MANAGER = userId('USER_A_MANAGER');
const SENIOR = userId('USER_A_SENIOR');
const ARTICLE = userId('USER_A_ARTICLE');
const PARTNER_B = userId('USER_B_PARTNER');

let superAdminA: string;
let partnerA: string;
let managerA: string;
let partnerB: string;

interface AuditRow {
  firm_id: string | null;
  actor_type: string;
  actor_user_id: string | null;
  action: string;
  object_type: string;
  object_id: string | null;
  old_value: Record<string, unknown> | null;
  new_value: Record<string, unknown> | null;
}

function auditRows(objectId: string, objectTypes: string[] = ['review_item']): AuditRow[] {
  const out = psql(
    `select coalesce(json_agg(row_to_json(t) order by t.created_at, t.action), '[]'::json)
     from (select * from public.audit_log
           where object_type in (${objectTypes.map((o) => `'${o}'`).join(',')})
             and object_id = '${objectId}') t`,
  );
  return JSON.parse(out);
}

/** Denial rows carry object_id NULL for submission probes — query by action. */
function firmActionRows(firmId: string, action: string): AuditRow[] {
  const out = psql(
    `select coalesce(json_agg(row_to_json(t) order by t.created_at), '[]'::json)
     from (select * from public.audit_log
           where firm_id = '${firmId}' and action = '${action}') t`,
  );
  return JSON.parse(out);
}

function cleanFixture() {
  psql(`
    delete from public.audit_log where firm_id in ('${FIRM_MAIN}', '${FIRM_X}');
    delete from public.review_items where firm_id in ('${FIRM_MAIN}', '${FIRM_X}');
    delete from public.task_comments where firm_id in ('${FIRM_MAIN}', '${FIRM_X}');
    delete from public.tasks where firm_id in ('${FIRM_MAIN}', '${FIRM_X}');
    delete from public.compliance_instances where firm_id in ('${FIRM_MAIN}', '${FIRM_X}');
    delete from public.compliance_types where id in ('${TY.four}');
    delete from public.legal_entities where firm_id in ('${FIRM_MAIN}', '${FIRM_X}');
    delete from public.clients where firm_id in ('${FIRM_MAIN}', '${FIRM_X}');
    delete from public.firm_memberships where id in
      ('${M.superAdmin}', '${M.partner}', '${M.manager}', '${M.senior}', '${M.article}', '${M.partnerX}');
  `);
}

beforeAll(async () => {
  cleanFixture();
  psql(`
    insert into public.firms (id, name) values
      ('${FIRM_MAIN}', 'IMP-041 Audit Firm Main'),
      ('${FIRM_X}', 'IMP-041 Audit Firm Cross')
    on conflict (id) do nothing;

    insert into public.firm_memberships (id, firm_id, user_id, role, status) values
      ('${M.superAdmin}', '${FIRM_MAIN}', '${SUPER_ADMIN}', 'super_admin', 'active'),
      ('${M.partner}',    '${FIRM_MAIN}', '${PARTNER}',     'partner',      'active'),
      ('${M.manager}',    '${FIRM_MAIN}', '${MANAGER}',     'manager',      'active'),
      ('${M.senior}',     '${FIRM_MAIN}', '${SENIOR}',      'senior',       'active'),
      ('${M.article}',    '${FIRM_MAIN}', '${ARTICLE}',     'article_executive', 'active'),
      ('${M.partnerX}',   '${FIRM_X}',    '${PARTNER_B}',   'partner',      'active')
    on conflict (firm_id, user_id) do nothing;

    insert into public.clients (id, firm_id, name, owner_partner_membership_id, manager_membership_id) values
      ('${C.inPort}', '${FIRM_MAIN}', 'RVW Audit Client In',  '${M.partner}', '${M.manager}'),
      ('${C.outPort}','${FIRM_MAIN}', 'RVW Audit Client Out', '${M.partner}', null),
      ('${C.cross}',  '${FIRM_X}',    'RVW Audit Client X',   '${M.partnerX}', null);

    insert into public.legal_entities (id, firm_id, client_id, entity_type, legal_name) values
      ('${E.inPort}', '${FIRM_MAIN}', '${C.inPort}', 'private_limited', 'RVW Audit Entity In');

    insert into public.compliance_types
      (id, firm_id, type_key, name, category, frequency, due_rule, workflow_template,
       scope_kind, registration_class, governance_class, four_eyes_required)
    values
      ('${TY.four}', '${FIRM_MAIN}', 'aud41-four', 'AUD41 Four-Eyes', 'Certificates',
       'custom', '{}', '{"states":["not_started","preparation","internal_review","ready_to_file","closed"]}',
       'entity', null, 'non_statutory', true);

    insert into public.compliance_instances
      (id, firm_id, legal_entity_id, compliance_type_id, period_start, period_end,
       period_label, due_date, assignee_membership_id, reviewer_membership_id)
    values
      ('${I.four}', '${FIRM_MAIN}', '${E.inPort}', '${TY.four}', '2026-04-01', '2026-06-30', 'FY26 Q1', '2026-07-31', '${M.senior}', '${M.article}');

    insert into public.tasks
      (id, firm_id, client_id, compliance_instance_id, title, next_action,
       assignee_membership_id, reviewer_membership_id)
    values
      ('${TK.linked}',       '${FIRM_MAIN}', '${C.inPort}', '${I.four}', 'RVW audit linked',        'finish prep', '${M.senior}', '${M.manager}'),
      ('${TK.linkedRefuse}', '${FIRM_MAIN}', '${C.inPort}', '${I.four}', 'RVW audit linked refuse', 'finish prep', '${M.senior}', '${M.manager}'),
      ('${TK.linkedFault}',  '${FIRM_MAIN}', '${C.inPort}', '${I.four}', 'RVW audit linked fault',  'finish prep', '${M.senior}', '${M.manager}');

    -- Decision fixtures: pending rows inserted directly as the operator (the
    -- submission path is under test elsewhere in this file).
    insert into public.review_items
      (id, firm_id, client_id, task_id, compliance_instance_id, type, title, submitted_by_membership_id)
    values
      ('${RI.decAdhoc}',     '${FIRM_MAIN}', '${C.inPort}', null,                 null,       'tds_return',           'RVW decide adhoc',  '${M.partner}'),
      ('${RI.selfDecide}',   '${FIRM_MAIN}', '${C.inPort}', null,                 null,       'gst_reconciliation',   'RVW self decide',   '${M.partner}'),
      ('${RI.hidden}',       '${FIRM_MAIN}', '${C.outPort}', null,                null,       'itr_computation',      'RVW hidden',        '${M.partner}'),
      ('${RI.linkedOk}',     '${FIRM_MAIN}', '${C.inPort}', '${TK.linked}',       '${I.four}', 'financial_statements', 'RVW linked ok',     '${M.senior}'),
      ('${RI.linkedRefuse}', '${FIRM_MAIN}', '${C.inPort}', '${TK.linkedRefuse}', '${I.four}', 'audit_workpaper',      'RVW linked refuse', '${M.senior}'),
      ('${RI.linkedFault}',  '${FIRM_MAIN}', '${C.inPort}', '${TK.linkedFault}',  '${I.four}', 'tds_return',           'RVW linked fault',  '${M.senior}');

    -- Stage the linked tasks at 'submitted' (transaction-local command flag
    -- inside a DO block — the IMP-030/031/040 staging precedent; never a
    -- request path).
    do $$ begin
      perform set_config('app.task_transition_command', '1', true);
      update public.tasks set status = 'submitted'
      where id in ('${TK.linked}', '${TK.linkedRefuse}', '${TK.linkedFault}');
    end $$;
  `);
  // Seeding itself writes operator audit rows; remove them so assertions
  // below see only the rows produced by the mutations under test (IMP-031
  // precedent). SCOPED to this file's fixture firms.
  psql(`delete from public.audit_log where firm_id in ('${FIRM_MAIN}', '${FIRM_X}')`);

  for (const [key, set] of [
    ['USER_A_SUPER_ADMIN', (t: string) => (superAdminA = t)],
    ['USER_A_PARTNER', (t: string) => (partnerA = t)],
    ['USER_A_MANAGER', (t: string) => (managerA = t)],
    ['USER_B_PARTNER', (t: string) => (partnerB = t)],
  ] as Array<[string, (t: string) => void]>) {
    const s = await signIn(userEmail(key));
    if (!s.ok) throw new Error(`sign-in failed for ${key}: ${JSON.stringify(s.raw)}`);
    set(s.token);
  }
});

afterAll(() => {
  cleanFixture();
  psql(`
    delete from public.firms where id in ('${FIRM_MAIN}', '${FIRM_X}')
      and not exists (select 1 from public.firm_memberships m where m.firm_id = firms.id)
      and not exists (select 1 from public.clients c where c.firm_id = firms.id);
  `);
});

// ---------------------------------------------------------------------------
// TEST-AUD-12 — submit_review_item Layer-B audit (spec 08 §7c)
// ---------------------------------------------------------------------------

describe('TEST-AUD-12 — submit_review_item audit', () => {
  it('submission writes exactly one review_item.submitted row (server-derived actor/firm/submitter, NEW snapshot, no Layer-A insert)', async () => {
    const res = await api(partnerA, 'POST', 'rpc/submit_review_item', {
      headers: H(FIRM_MAIN),
      body: {
        p_client_id: C.inPort,
        p_type: 'tds_return',
        p_title: 'AUD41 submit audit probe',
        p_priority: 'high',
      },
    });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('submitted');
    const itemId = res.body.item.id as string;

    const rows = auditRows(itemId);
    // The exact action multiset: the command's row ONLY — the
    // app.audit_skip_trigger marker suppressed the Layer-A 'insert'.
    expect(rows.map((r) => r.action)).toEqual(['review_item.submitted']);
    const sub = rows[0];
    expect(sub.object_type).toBe('review_item');
    expect(sub.object_id).toBe(itemId);
    expect(sub.actor_type).toBe('human');
    expect(sub.actor_user_id).toBe(PARTNER); // auth.users UUID, server-derived
    expect(sub.firm_id).toBe(FIRM_MAIN); // server-derived, never caller-supplied
    expect(sub.old_value).toBeNull();
    const nv = sub.new_value as Record<string, unknown>;
    expect(nv.status).toBe('pending');
    expect(nv.source).toBe('human');
    expect(nv.firm_id).toBe(FIRM_MAIN);
    expect(nv.client_id).toBe(C.inPort);
    expect(nv.submitted_by_membership_id).toBe(M.partner);
    expect(nv.title).toBe('AUD41 submit audit probe');
    expect(nv.priority).toBe('high');
    expect(nv.decided_by_membership_id).toBeNull();
  });

  it('submission denial: an EXISTING out-of-scope subject is audited (review_item.submit_denied); nonexistent/foreign subjects are not', async () => {
    const envelope = { status: 'denied', kind: 'not_found', message: 'review subject not found' };

    // Manager probes the out-of-portfolio client: the subject EXISTS in-firm
    // — a security-significant probe (AUD-FAIL-01), audited with no leak.
    const denied = await api(managerA, 'POST', 'rpc/submit_review_item', {
      headers: H(FIRM_MAIN),
      body: { p_client_id: C.outPort, p_type: 'tds_return', p_title: 'AUD41 out-of-scope submit' },
    });
    expect(denied.body).toEqual(envelope);
    const denials = firmActionRows(FIRM_MAIN, 'review_item.submit_denied').filter(
      (r) => r.actor_user_id === MANAGER,
    );
    expect(denials).toHaveLength(1);
    expect(denials[0].object_type).toBe('review_item');
    expect(denials[0].object_id).toBeNull();
    expect(denials[0].old_value).toBeNull();
    const dnv = denials[0].new_value as { reason: string; client_id: string; type: string };
    expect(dnv.reason).toBe('review subject not visible to caller (API-ERR-02)');
    expect(dnv.client_id).toBe(C.outPort);
    expect(dnv.type).toBe('tds_return');

    // A truly nonexistent subject id: identical caller body, NO audit row.
    const ghost = await api(managerA, 'POST', 'rpc/submit_review_item', {
      headers: H(FIRM_MAIN),
      body: { p_client_id: GHOST_CLIENT, p_type: 'tds_return', p_title: 'AUD41 ghost submit' },
    });
    expect(ghost.body).toEqual(envelope);
    expect(
      firmActionRows(FIRM_MAIN, 'review_item.submit_denied').filter((r) => r.actor_user_id === MANAGER),
    ).toHaveLength(1);

    // Cross-tenant probe: the FIRM_X partner names a FIRM_MAIN client. The
    // subject does not exist in the active firm — un-audited, same envelope.
    const cross = await api(partnerB, 'POST', 'rpc/submit_review_item', {
      headers: H(FIRM_X),
      body: { p_client_id: C.inPort, p_type: 'tds_return', p_title: 'AUD41 cross-tenant submit' },
    });
    expect(cross.body).toEqual(envelope);
    expect(firmActionRows(FIRM_X, 'review_item.submit_denied')).toHaveLength(0);
    expect(
      firmActionRows(FIRM_MAIN, 'review_item.submit_denied').filter((r) => r.actor_user_id === PARTNER_B),
    ).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// TEST-AUD-12 — decide_review_item Layer-B audit (spec 08 §7c, DM-SM-06)
// ---------------------------------------------------------------------------

describe('TEST-AUD-12 — decide_review_item audit', () => {
  it('decision writes exactly one review_item.decided row: server actor, old/new snapshots, rationale + mutation key recorded', async () => {
    const res = await api(managerA, 'POST', 'rpc/decide_review_item', {
      headers: H(FIRM_MAIN),
      body: {
        p_review_item_id: RI.decAdhoc,
        p_decision: 'approved',
        p_rationale: 'reconciled against the ledger',
        p_mutation_key: 'aud41-mk-1',
      },
    });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('decided');
    expect(res.body.from_status).toBe('pending');
    expect(res.body.to_status).toBe('approved');

    const rows = auditRows(RI.decAdhoc);
    // Exact multiset: ONE Layer-B row; the status UPDATE produced NO
    // Layer-A 'update' duplicate (app.audit_skip_trigger).
    expect(rows.map((r) => r.action)).toEqual(['review_item.decided']);
    const dec = rows[0];
    expect(dec.object_type).toBe('review_item');
    expect(dec.object_id).toBe(RI.decAdhoc);
    expect(dec.actor_type).toBe('human');
    expect(dec.actor_user_id).toBe(MANAGER); // server-derived auth.users UUID
    expect(dec.firm_id).toBe(FIRM_MAIN);
    const ov = dec.old_value as Record<string, unknown>;
    expect(ov.status).toBe('pending');
    expect(ov.decision_rationale).toBeNull();
    expect(ov.decided_by_membership_id).toBeNull();
    const nv = dec.new_value as Record<string, unknown>;
    expect(nv.status).toBe('approved');
    expect(nv.decision_rationale).toBe('reconciled against the ledger');
    expect(nv.decided_by_membership_id).toBe(M.manager);
    expect(nv.decided_at).not.toBeNull();
    expect(nv._mutation_key).toBe('aud41-mk-1');
  });

  it('mutation-key replay (already_applied) writes NO second audit row', async () => {
    const replay = await api(managerA, 'POST', 'rpc/decide_review_item', {
      headers: H(FIRM_MAIN),
      body: {
        p_review_item_id: RI.decAdhoc,
        p_decision: 'approved',
        p_rationale: 'reconciled against the ledger',
        p_mutation_key: 'aud41-mk-1',
      },
    });
    expect(replay.body.status).toBe('already_applied');
    expect(replay.body.reason).toBe('already_decided');
    expect(auditRows(RI.decAdhoc).map((r) => r.action)).toEqual(['review_item.decided']);
    expect(
      psql(`select status from public.review_items where id = '${RI.decAdhoc}';`).trim(),
    ).toBe('approved');
  });

  it('self-decision (RLS-4EY-04) is an audited unauthorized denial; the item is unchanged', async () => {
    const res = await api(partnerA, 'POST', 'rpc/decide_review_item', {
      headers: H(FIRM_MAIN),
      body: {
        p_review_item_id: RI.selfDecide,
        p_decision: 'approved',
        p_rationale: 'approving my own submission',
      },
    });
    expect(res.body.status).toBe('denied');
    expect(res.body.kind).toBe('unauthorized');
    const rows = auditRows(RI.selfDecide);
    expect(rows.map((r) => r.action)).toEqual(['review_item.decide_denied']);
    const denied = rows[0];
    expect(denied.actor_type).toBe('human');
    expect(denied.actor_user_id).toBe(PARTNER);
    expect(denied.firm_id).toBe(FIRM_MAIN);
    expect(denied.old_value).toBeNull();
    const nv = denied.new_value as { reason: string; from_status: string; decision: string };
    expect(nv.reason).toContain('must differ from the submitting membership');
    expect(nv.from_status).toBe('pending');
    expect(nv.decision).toBe('approved');
    expect(
      psql(`select status from public.review_items where id = '${RI.selfDecide}';`).trim(),
    ).toBe('pending');
  });

  it('existing-but-invisible probes are audited (out-of-scope AND cross-tenant); a nonexistent id is not — one identical caller envelope', async () => {
    const envelope = { status: 'denied', kind: 'not_found', message: 'review item not found' };

    // Out-of-scope: the item's client is outside the manager's portfolio and
    // no linked task involves the manager.
    const outOfScope = await api(managerA, 'POST', 'rpc/decide_review_item', {
      headers: H(FIRM_MAIN),
      body: { p_review_item_id: RI.hidden, p_decision: 'dismissed', p_rationale: 'probe' },
    });
    expect(outOfScope.body).toEqual(envelope);

    // Cross-tenant: the FIRM_X partner decides a FIRM_MAIN item.
    const cross = await api(partnerB, 'POST', 'rpc/decide_review_item', {
      headers: H(FIRM_X),
      body: { p_review_item_id: RI.hidden, p_decision: 'dismissed', p_rationale: 'probe' },
    });
    expect(cross.body).toEqual(envelope);

    // Both security-significant probes are audited against the item, bound to
    // the OWNING firm (FIRM_MAIN) — the caller cannot tell the item exists.
    const rows = auditRows(RI.hidden);
    expect(rows.map((r) => r.action)).toEqual(['review_item.decide_denied', 'review_item.decide_denied']);
    const byActor = new Map(rows.map((r) => [r.actor_user_id, r]));
    for (const actor of [MANAGER, PARTNER_B]) {
      const denied = byActor.get(actor);
      expect(denied).toBeDefined();
      expect(denied?.firm_id).toBe(FIRM_MAIN);
      expect(denied?.object_type).toBe('review_item');
      expect(denied?.object_id).toBe(RI.hidden);
      expect((denied?.new_value as { reason: string }).reason).toBe(
        'review item not visible to caller (API-ERR-02)',
      );
      expect((denied?.new_value as { decision: string }).decision).toBe('dismissed');
    }

    // A truly nonexistent id: identical caller body, ZERO audit rows (no
    // invented object audit — the IMP-030/031/040 precedent).
    const miss = await api(managerA, 'POST', 'rpc/decide_review_item', {
      headers: H(FIRM_MAIN),
      body: { p_review_item_id: GHOST_ITEM, p_decision: 'dismissed', p_rationale: 'probe' },
    });
    expect(miss.body).toEqual(envelope);
    expect(auditRows(GHOST_ITEM)).toHaveLength(0);

    expect(
      psql(`select status from public.review_items where id = '${RI.hidden}';`).trim(),
    ).toBe('pending');
  });
});

// ---------------------------------------------------------------------------
// TEST-AUD-12 — task-linked `returned` composition (DM-SM-06, spec 08 §7c)
// ---------------------------------------------------------------------------

describe('TEST-AUD-12 — task-linked returned composition audit', () => {
  it('linked return audits decision + task.transition + the single reviewer comment in one transaction; no Layer-A duplicates', async () => {
    const res = await api(managerA, 'POST', 'rpc/decide_review_item', {
      headers: H(FIRM_MAIN),
      body: {
        p_review_item_id: RI.linkedOk,
        p_decision: 'returned',
        p_rationale: 'rework the reconciliation schedule',
      },
    });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('decided');
    expect(res.body.to_status).toBe('returned');
    const commentId = (res.body.reviewer_comment as { id: string }).id;

    // The item: exactly ONE Layer-B decision row, no Layer-A 'update'.
    const itemRows = auditRows(RI.linkedOk);
    expect(itemRows.map((r) => r.action)).toEqual(['review_item.decided']);
    expect(itemRows[0].actor_user_id).toBe(MANAGER);
    expect((itemRows[0].old_value as { status: string }).status).toBe('pending');
    const nv = itemRows[0].new_value as Record<string, unknown>;
    expect(nv.status).toBe('returned');
    expect(nv.decision_rationale).toBe('rework the reconciliation schedule');

    // The linked task: exactly ONE task.transition row (composed through
    // transition_task), carrying the atomic comment snapshot.
    const taskRows = auditRows(TK.linked, ['task']);
    expect(taskRows.map((r) => r.action)).toEqual(['task.transition']);
    expect(taskRows[0].actor_user_id).toBe(MANAGER);
    expect((taskRows[0].old_value as { status: string }).status).toBe('submitted');
    expect((taskRows[0].new_value as { status: string }).status).toBe('returned');
    const commentSnap = (taskRows[0].new_value as { _reviewer_comment: { id: string; body: string } })
      ._reviewer_comment;
    expect(commentSnap.id).toBe(commentId);
    expect(commentSnap.body).toBe('rework the reconciliation schedule');

    // Exactly one immutable SCH-16 comment exists and — riding the skip
    // marker — has NO Layer-A 'insert' audit row of its own.
    expect(
      psql(`select count(*) from public.task_comments where task_id = '${TK.linked}';`).trim(),
    ).toBe('1');
    expect(auditRows(commentId, ['task_comment'])).toHaveLength(0);
  });

  it('a refused linked return (decider is not the assigned task reviewer) persists exactly ONE denial row — the inner task refusal rolls back', async () => {
    // The partner outranks the reviewer but RLS-4EY-03 admits no rank bypass:
    // transition_task refuses, aborting the WHOLE command (subtransaction).
    const res = await api(partnerA, 'POST', 'rpc/decide_review_item', {
      headers: H(FIRM_MAIN),
      body: {
        p_review_item_id: RI.linkedRefuse,
        p_decision: 'returned',
        p_rationale: 'partner rank-bypass attempt',
      },
    });
    expect(res.body.status).toBe('denied');
    expect(res.body.kind).toBe('unauthorized');
    expect(String(res.body.message)).toContain('linked task refused the return');

    // ONE denial row on the item; the inner task.transition_denied audit
    // rolled back with the failed subtransaction.
    const itemRows = auditRows(RI.linkedRefuse);
    expect(itemRows.map((r) => r.action)).toEqual(['review_item.decide_denied']);
    expect(itemRows[0].actor_user_id).toBe(PARTNER);
    expect((itemRows[0].new_value as { from_status: string }).from_status).toBe('pending');
    expect(auditRows(TK.linkedRefuse, ['task'])).toHaveLength(0);

    // Nothing persists: item pending, task still submitted, no comment.
    expect(
      psql(`select status from public.review_items where id = '${RI.linkedRefuse}';`).trim(),
    ).toBe('pending');
    expect(
      psql(`select status from public.tasks where id = '${TK.linkedRefuse}';`).trim(),
    ).toBe('submitted');
    expect(
      psql(`select count(*) from public.task_comments where task_id = '${TK.linkedRefuse}';`).trim(),
    ).toBe('0');
  });
});

// ---------------------------------------------------------------------------
// TEST-AUD-12 — fail closed (AUD-CTX-05 / AUD-FAIL-01 posture): audit-write
// failure aborts the command (psql-only fault hook, tasks-audit precedent)
// ---------------------------------------------------------------------------

describe('TEST-AUD-12 — audit fault rolls back the command atomically', () => {
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

  it('submit_review_item: fault aborts mutation AND audit together', () => {
    const err = sqlError(`
      begin;
      set local request.jwt.claims = '{"sub":"${PARTNER}","aal":"aal1","role":"authenticated"}';
      set local request.headers = '{"x-active-firm":"${FIRM_MAIN}"}';
      set local app.audit_fault = 'fail_audit';
      select public.submit_review_item(p_client_id := '${C.inPort}', p_type := 'tds_return', p_title := 'AUD41 fault submit');
      commit;
    `);
    expect(err).toContain('fault injected');
    expect(
      psql(`select count(*) from public.review_items
            where firm_id = '${FIRM_MAIN}' and title = 'AUD41 fault submit';`).trim(),
    ).toBe('0');
    expect(
      psql(`select count(*) from public.audit_log
            where firm_id = '${FIRM_MAIN}' and action = 'review_item.submitted'
              and new_value ->> 'title' = 'AUD41 fault submit';`).trim(),
    ).toBe('0');
  });

  it('decide_review_item (task-linked return): fault aborts the item mutation, task transition, comment AND audit together', () => {
    const err = sqlError(`
      begin;
      set local request.jwt.claims = '{"sub":"${MANAGER}","aal":"aal1","role":"authenticated"}';
      set local request.headers = '{"x-active-firm":"${FIRM_MAIN}"}';
      set local app.audit_fault = 'fail_audit';
      select public.decide_review_item('${RI.linkedFault}', 'returned', 'fault rationale', null);
      commit;
    `);
    expect(err).toContain('fault injected');
    expect(
      psql(`select status from public.review_items where id = '${RI.linkedFault}';`).trim(),
    ).toBe('pending');
    expect(
      psql(`select status from public.tasks where id = '${TK.linkedFault}';`).trim(),
    ).toBe('submitted');
    expect(
      psql(`select count(*) from public.task_comments where task_id = '${TK.linkedFault}';`).trim(),
    ).toBe('0');
    expect(auditRows(RI.linkedFault)).toHaveLength(0);
    expect(auditRows(TK.linkedFault, ['task'])).toHaveLength(0);
  });

  it('positive control: without the fault hook the linked return commits mutation + audit together', () => {
    psql(`
      begin;
      set local request.jwt.claims = '{"sub":"${MANAGER}","aal":"aal1","role":"authenticated"}';
      set local request.headers = '{"x-active-firm":"${FIRM_MAIN}"}';
      select public.decide_review_item('${RI.linkedFault}', 'returned', 'control rationale', null);
      commit;
    `);
    expect(
      psql(`select status from public.review_items where id = '${RI.linkedFault}';`).trim(),
    ).toBe('returned');
    expect(
      psql(`select status from public.tasks where id = '${TK.linkedFault}';`).trim(),
    ).toBe('returned');
    expect(
      psql(`select count(*) from public.task_comments where task_id = '${TK.linkedFault}';`).trim(),
    ).toBe('1');
    expect(auditRows(RI.linkedFault).map((r) => r.action)).toEqual(['review_item.decided']);
    expect(auditRows(TK.linkedFault, ['task']).map((r) => r.action)).toEqual(['task.transition']);
  });
});

// ---------------------------------------------------------------------------
// TEST-AUD-12 — review-item audit rows share the append-only posture
// (AUD-INV-01; the full immutability matrix lives in audit.test.ts
// TEST-AUD-04 — this proves SCH-17 rows participate)
// ---------------------------------------------------------------------------

describe('TEST-AUD-12 — audit immutability posture covers review-item rows', () => {
  it('UPDATE / DELETE / INSERT on audit_log via PostgREST are denied even to a super_admin; review-item rows are unchanged', async () => {
    const target = `object_type=eq.review_item&object_id=eq.${RI.decAdhoc}`;
    const before = auditRows(RI.decAdhoc).length;
    expect(before).toBeGreaterThan(0);

    const upd = await api(superAdminA, 'PATCH', `audit_log?${target}`, {
      headers: H(FIRM_MAIN),
      body: { action: 'forged' },
    });
    expect(upd.status).toBe(403);
    const del = await api(superAdminA, 'DELETE', `audit_log?${target}`, {
      headers: H(FIRM_MAIN),
    });
    expect(del.status).toBe(403);
    const ins = await api(superAdminA, 'POST', 'audit_log', {
      headers: H(FIRM_MAIN),
      body: {
        firm_id: FIRM_MAIN,
        actor_type: 'human',
        actor_user_id: SUPER_ADMIN,
        action: 'forged',
        object_type: 'review_item',
        object_id: RI.decAdhoc,
      },
    });
    expect(ins.status).toBe(403);

    // The review-item decision row survived untouched (append-only).
    const rows = auditRows(RI.decAdhoc);
    expect(rows).toHaveLength(before);
    expect(rows[0].action).toBe('review_item.decided');
  });
});
