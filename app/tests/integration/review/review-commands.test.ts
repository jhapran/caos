/**
 * IMP-041 PASS B — review-queue controlled Layer-B commands
 * submit_review_item() / decide_review_item() through PostgREST against the
 * REAL local stack (API-R0-RVW, DM-SM-06, RLS-RVW-01, RLS-4EY-03/04,
 * API-ERR-02/04, API-MUT-03/04, AUD-FAIL-01).
 *
 * Maps to spec 11 (IMP-041 contract closure 2026-09-05):
 *   TEST-API-11 — decide_review_item authorization-before-disclosure: an
 *     unauthorized/out-of-scope existing item and a nonexistent id return
 *     the identical not_found surface; no existence, status, legality,
 *     vocabulary, rationale-requirement, or replay oracle;
 *   TEST-API-12 — mutation-key retry safety: a retried decision with the
 *     same valid key returns the original result; no double-decide, no
 *     second audit row, no duplicate returned-task comment; authorization
 *     is evaluated BEFORE replay state;
 *   TEST-API-13 — submit_review_item server-derived fields are unforgeable
 *     (firm_id, submitted_by_membership_id, submitted_at, actor identity);
 *     caller-supplied status/decision/ai_output_id/source keys are a
 *     PostgREST signature mismatch; linked-subject-wins derivation
 *     (task → instance → explicit client) with mismatches rejected; the
 *     RLS-RVW-01 submission scope matrix;
 *   TEST-API-14 — task-linked `returned` atomicity (DM-SM-06): item + task
 *     + exactly one immutable SCH-16 comment in one transaction; the actor
 *     must additionally satisfy the linked task's return authority (no
 *     rank bypass on a four-eyes task); an illegal task state rolls back
 *     ALL; task_id NULL has no task side effects;
 *   TEST-API-15 — decision legality: pending → approved|returned|
 *     escalated|dismissed only; terminal states reject further decisions
 *     (keyless conflict / keyed already_applied); a non-empty
 *     non-whitespace rationale is mandatory for all four outcomes;
 *     rejections map to conflict/validation (API-ERR-04).
 *
 * Reads/decisions go through signed-in access tokens — never service-role
 * for authorization assertions. psql (operator) is used only for fixture
 * setup (incl. staging tasks at 'submitted' via the transaction-local
 * command flag — never a request path), teardown, and audit-row counting.
 *
 * Deterministic ids in the 69000000-… range; this suite owns its own two
 * firms (never the shared harness FIRM_A/FIRM_B); re-runnable; teardown
 * removes rows child → parent plus the fixture's audit rows (scoped to the
 * two owned firm ids only).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { api, psql, signIn, userEmail, userId } from '../helpers.mjs';

const FA = '69000000-0000-4000-8000-00000000f00a';
const FB = '69000000-0000-4000-8000-00000000f00b';
const H = (firm: string) => ({ 'x-active-firm': firm });

/** The ONE pre-authorization denial surface of decide_review_item
 *  (API-ERR-02): nonexistent, foreign, and out-of-scope items all return
 *  exactly this body — no existence oracle. */
const DECIDE_NOT_FOUND = {
  status: 'denied',
  kind: 'not_found',
  message: 'review item not found',
};
/** The uniform subject surface of submit_review_item (API-ERR-02). */
const SUBJECT_NOT_FOUND = {
  status: 'denied',
  kind: 'not_found',
  message: 'review subject not found',
};

const SYS_ITR = '50000000-0000-4000-8000-000000000005'; // seeded system type (entity scope)

const M = {
  superA: '69000000-0000-4000-8000-0000000000a1',
  partnerA: '69000000-0000-4000-8000-0000000000a2',
  managerA: '69000000-0000-4000-8000-0000000000a3',
  managerBInA: '69000000-0000-4000-8000-0000000000a4', // USER_B_MANAGER as manager IN firm A
  seniorA: '69000000-0000-4000-8000-0000000000a5',
  articleA: '69000000-0000-4000-8000-0000000000a6',
  billingA: '69000000-0000-4000-8000-0000000000a7',
  partnerB: '69000000-0000-4000-8000-0000000000a8',
};
const C = {
  managed: '69000000-0000-4000-8000-000000000b01', // manager = managerA
  otherManaged: '69000000-0000-4000-8000-000000000b02', // manager = managerBInA
  unmanaged: '69000000-0000-4000-8000-000000000b03', // manager = null
  firmB: '69000000-0000-4000-8000-000000000b04',
};
const E = {
  managed: '69000000-0000-4000-8000-000000000b11',
  otherManaged: '69000000-0000-4000-8000-000000000b12',
  firmB: '69000000-0000-4000-8000-000000000b13',
};
const TY = {
  four: '69000000-0000-4000-8000-000000000b21', // four_eyes_required = true
  plain: '69000000-0000-4000-8000-000000000b22', // four_eyes_required = false
};
const I = {
  fourIn: '69000000-0000-4000-8000-000000000b31', // E.managed × TY.four, assignee=senior reviewer=manager
  fourOut: '69000000-0000-4000-8000-000000000b32', // E.otherManaged × TY.four, assignee=senior reviewer=manager
  plainIn: '69000000-0000-4000-8000-000000000b33', // E.managed × TY.plain, assignee=senior reviewer=article
  firmB: '69000000-0000-4000-8000-000000000b34',
};
const T = {
  four: '69000000-0000-4000-8000-000000000c01', // linked I.fourIn — staged submitted (success path)
  four2: '69000000-0000-4000-8000-000000000c02', // linked I.fourOut — staged submitted (rank-bypass probes)
  plain: '69000000-0000-4000-8000-000000000c03', // linked I.plainIn (NO four-eyes) — staged submitted
  illegalOpen: '69000000-0000-4000-8000-000000000c04', // ad-hoc C.managed, stays 'open'
  adhocIn: '69000000-0000-4000-8000-000000000c05', // ad-hoc C.managed, assignee=seniorA
  adhocUnmanaged: '69000000-0000-4000-8000-000000000c06', // ad-hoc C.unmanaged
  firmB: '69000000-0000-4000-8000-000000000c07',
};
const R = {
  hidden: '69000000-0000-4000-8000-000000000d01', // C.managed, submitter seniorA — stays pending
  outScope: '69000000-0000-4000-8000-000000000d02', // C.otherManaged, submitter seniorA — stays pending
  byManager: '69000000-0000-4000-8000-000000000d03', // C.managed, submitter managerA (self-decision probe)
  byPartner: '69000000-0000-4000-8000-000000000d04', // C.managed, submitter partnerA (self-decision probe)
  vocab: '69000000-0000-4000-8000-000000000d05', // C.managed, submitter seniorA — stays pending
  rationale: '69000000-0000-4000-8000-000000000d06', // C.managed, submitter seniorA — stays pending
  terminal: '69000000-0000-4000-8000-000000000d07', // pre-decided 'approved' (decider managerA)
  approve: '69000000-0000-4000-8000-000000000d08',
  return: '69000000-0000-4000-8000-000000000d09',
  escalate: '69000000-0000-4000-8000-000000000d0a',
  dismiss: '69000000-0000-4000-8000-000000000d0b',
  illegal: '69000000-0000-4000-8000-000000000d0c', // linked T.illegalOpen
  rankBypass: '69000000-0000-4000-8000-000000000d0d', // linked T.four2
  mutReturn: '69000000-0000-4000-8000-000000000d0e', // linked T.plain (mutation-key replay)
  unlinkRet: '69000000-0000-4000-8000-000000000d0f', // unlinked C.managed (API-14 no-task-effects)
};

const GHOST = '69000000-0000-4000-8000-00000000ffff';

const PARTNER_A = userId('USER_A_PARTNER');
const MANAGER_A = userId('USER_A_MANAGER');

let superAdminA: string;
let partnerA: string;
let managerA: string;
let managerBInA: string;
let seniorA: string;
let articleA: string;
let billingA: string;
let partnerB: string;

function cleanRows() {
  psql(`
    delete from public.audit_log where firm_id in ('${FA}', '${FB}');
    delete from public.review_items where firm_id in ('${FA}', '${FB}');
    delete from public.task_comments where firm_id in ('${FA}', '${FB}');
    delete from public.task_checklist_items where firm_id in ('${FA}', '${FB}');
    delete from public.task_dependencies where firm_id in ('${FA}', '${FB}');
    delete from public.tasks where firm_id in ('${FA}', '${FB}');
    delete from public.compliance_instances where firm_id in ('${FA}', '${FB}');
    delete from public.client_compliance_profiles where firm_id in ('${FA}', '${FB}');
    delete from public.compliance_rule_versions where compliance_type_id in ('${TY.four}', '${TY.plain}');
    delete from public.compliance_types where id in ('${TY.four}', '${TY.plain}');
    delete from public.legal_entities where firm_id in ('${FA}', '${FB}');
    delete from public.clients where firm_id in ('${FA}', '${FB}');
    delete from public.firm_memberships where firm_id in ('${FA}', '${FB}');
  `);
}

/** audit_log row counts for one review_item object (psql, operator path). */
function reviewAudit(objectId: string, action?: string): number {
  return Number(
    psql(
      `select count(*) from public.audit_log
       where object_type = 'review_item' and object_id = '${objectId}'${action ? ` and action = '${action}'` : ''};`,
    ).trim(),
  );
}
function taskAudit(taskId: string, action: string): number {
  return Number(
    psql(
      `select count(*) from public.audit_log where object_type = 'task' and object_id = '${taskId}' and action = '${action}';`,
    ).trim(),
  );
}
function itemStatus(id: string): string {
  return psql(`select status from public.review_items where id = '${id}';`).trim();
}
function taskStatus(id: string): string {
  return psql(`select status from public.tasks where id = '${id}';`).trim();
}
function commentCount(taskId: string): number {
  return Number(
    psql(`select count(*) from public.task_comments where firm_id = '${FA}' and task_id = '${taskId}';`).trim(),
  );
}
function submitDeniedCount(): number {
  return Number(
    psql(`select count(*) from public.audit_log where firm_id = '${FA}' and action = 'review_item.submit_denied';`).trim(),
  );
}

async function submit(token: string, body: Record<string, unknown>, firm = FA) {
  return api(token, 'POST', 'rpc/submit_review_item', { headers: H(firm), body });
}
async function decide(token: string, body: Record<string, unknown>, firm = FA) {
  return api(token, 'POST', 'rpc/decide_review_item', { headers: H(firm), body });
}

beforeAll(async () => {
  cleanRows();
  psql(`
    insert into public.firms (id, name) values
      ('${FA}', 'IMP-041 API Firm A'),
      ('${FB}', 'IMP-041 API Firm B')
    on conflict (id) do nothing;

    insert into public.firm_memberships (id, firm_id, user_id, role, status) values
      ('${M.superA}',      '${FA}', '${userId('USER_A_SUPER_ADMIN')}', 'super_admin',       'active'),
      ('${M.partnerA}',    '${FA}', '${PARTNER_A}',                     'partner',           'active'),
      ('${M.managerA}',    '${FA}', '${MANAGER_A}',                     'manager',           'active'),
      ('${M.managerBInA}', '${FA}', '${userId('USER_B_MANAGER')}',      'manager',           'active'),
      ('${M.seniorA}',     '${FA}', '${userId('USER_A_SENIOR')}',       'senior',            'active'),
      ('${M.articleA}',    '${FA}', '${userId('USER_A_ARTICLE')}',      'article_executive', 'active'),
      ('${M.billingA}',    '${FA}', '${userId('USER_A_BILLING')}',      'billing',           'active'),
      ('${M.partnerB}',    '${FB}', '${userId('USER_B_PARTNER')}',      'partner',           'active')
    on conflict (firm_id, user_id) do nothing;

    insert into public.clients (id, firm_id, name, owner_partner_membership_id, manager_membership_id, status) values
      ('${C.managed}',      '${FA}', 'RVW API Managed',      '${M.partnerA}', '${M.managerA}',    'active'),
      ('${C.otherManaged}', '${FA}', 'RVW API OtherManaged', '${M.partnerA}', '${M.managerBInA}', 'active'),
      ('${C.unmanaged}',    '${FA}', 'RVW API Unmanaged',    '${M.partnerA}', null,               'active'),
      ('${C.firmB}',        '${FB}', 'RVW API FirmB',        '${M.partnerB}', null,               'active');

    insert into public.legal_entities (id, firm_id, client_id, entity_type, legal_name) values
      ('${E.managed}',      '${FA}', '${C.managed}',      'private_limited', 'RVW API Entity Managed'),
      ('${E.otherManaged}', '${FA}', '${C.otherManaged}', 'llp',             'RVW API Entity Other'),
      ('${E.firmB}',        '${FB}', '${C.firmB}',        'private_limited', 'RVW API Entity B');

    insert into public.compliance_types
      (id, firm_id, type_key, name, category, frequency, due_rule, workflow_template,
       scope_kind, registration_class, governance_class, four_eyes_required)
    values
      ('${TY.four}', '${FA}', 'rvw41-four', 'RVW41 Four-Eyes', 'Certificates',
       'custom', '{}', '{"states":["not_started","preparation","internal_review","ready_to_file","closed"]}',
       'entity', null, 'non_statutory', true),
      ('${TY.plain}', '${FA}', 'rvw41-plain', 'RVW41 Plain', 'Certificates',
       'custom', '{}', '{"states":["not_started","preparation","internal_review","ready_to_file","closed"]}',
       'entity', null, 'non_statutory', false);

    insert into public.compliance_instances
      (id, firm_id, legal_entity_id, compliance_type_id, period_start, period_end,
       period_label, due_date, assignee_membership_id, reviewer_membership_id)
    values
      ('${I.fourIn}',  '${FA}', '${E.managed}',      '${TY.four}',  '2026-04-01', '2026-06-30', 'FY26 Q1', '2026-07-31', '${M.seniorA}', '${M.managerA}'),
      ('${I.fourOut}', '${FA}', '${E.otherManaged}', '${TY.four}',  '2026-04-01', '2026-06-30', 'FY26 Q1', '2026-07-31', '${M.seniorA}', '${M.managerA}'),
      ('${I.plainIn}', '${FA}', '${E.managed}',      '${TY.plain}', '2026-07-01', '2026-09-30', 'FY26 Q2', '2026-10-31', '${M.seniorA}', '${M.articleA}'),
      ('${I.firmB}',   '${FB}', '${E.firmB}',        '${SYS_ITR}',  '2026-04-01', '2027-03-31', 'FY 2026-27', '2027-10-31', null, null);

    insert into public.tasks
      (id, firm_id, client_id, compliance_instance_id, title, next_action,
       assignee_membership_id, reviewer_membership_id)
    values
      ('${T.four}',           '${FA}', '${C.managed}',      '${I.fourIn}',  'RVW four-eyes task',   'finish prep',  '${M.seniorA}', '${M.managerA}'),
      ('${T.four2}',          '${FA}', '${C.otherManaged}', '${I.fourOut}', 'RVW four-eyes bypass', 'finish prep',  '${M.seniorA}', '${M.managerA}'),
      ('${T.plain}',          '${FA}', '${C.managed}',      '${I.plainIn}', 'RVW plain linked',     'finish prep',  '${M.seniorA}', '${M.articleA}'),
      ('${T.illegalOpen}',    '${FA}', '${C.managed}',      null,           'RVW illegal open',     'collect docs', '${M.seniorA}', null),
      ('${T.adhocIn}',        '${FA}', '${C.managed}',      null,           'RVW ad-hoc in',        'collect docs', '${M.seniorA}', null),
      ('${T.adhocUnmanaged}', '${FA}', '${C.unmanaged}',    null,           'RVW ad-hoc unmanaged', 'collect docs', null,           null),
      ('${T.firmB}',          '${FB}', '${C.firmB}',        null,           'RVW firm B task',      'collect docs', null,           null);

    -- Pure decision fixtures (pending rows inserted as the operator; subject
    -- binding per SCH-17 — task-linked rows carry the task's client).
    insert into public.review_items
      (id, firm_id, client_id, task_id, type, title, submitted_by_membership_id)
    values
      ('${R.hidden}',     '${FA}', '${C.managed}',      null,            'gst_reconciliation', 'RVW hidden',      '${M.seniorA}'),
      ('${R.outScope}',   '${FA}', '${C.otherManaged}', null,            'tds_return',         'RVW out-scope',   '${M.seniorA}'),
      ('${R.byManager}',  '${FA}', '${C.managed}',      null,            'itr_computation',    'RVW by manager',  '${M.managerA}'),
      ('${R.byPartner}',  '${FA}', '${C.managed}',      null,            'itr_computation',    'RVW by partner',  '${M.partnerA}'),
      ('${R.vocab}',      '${FA}', '${C.managed}',      null,            'tds_return',         'RVW vocab',       '${M.seniorA}'),
      ('${R.rationale}',  '${FA}', '${C.managed}',      null,            'tds_return',         'RVW rationale',   '${M.seniorA}'),
      ('${R.approve}',    '${FA}', '${C.managed}',      null,            'gst_reconciliation', 'RVW approve',     '${M.seniorA}'),
      ('${R.return}',     '${FA}', '${C.managed}',      null,            'gst_reconciliation', 'RVW return',      '${M.seniorA}'),
      ('${R.escalate}',   '${FA}', '${C.managed}',      null,            'gst_reconciliation', 'RVW escalate',    '${M.seniorA}'),
      ('${R.dismiss}',    '${FA}', '${C.managed}',      null,            'gst_reconciliation', 'RVW dismiss',     '${M.seniorA}'),
      ('${R.illegal}',    '${FA}', '${C.managed}',      '${T.illegalOpen}', 'audit_workpaper', 'RVW illegal',     '${M.seniorA}'),
      ('${R.rankBypass}', '${FA}', '${C.otherManaged}', '${T.four2}',    'audit_workpaper',    'RVW rank bypass', '${M.seniorA}'),
      ('${R.mutReturn}',  '${FA}', '${C.managed}',      '${T.plain}',    'tds_return',         'RVW mut replay',  '${M.seniorA}'),
      ('${R.unlinkRet}',  '${FA}', '${C.managed}',      null,            'financial_statements','RVW unlinked',   '${M.seniorA}');

    -- Terminal fixture (PASS-A CHECK shape: decider <> submitter, decided_at,
    -- non-empty rationale).
    insert into public.review_items
      (id, firm_id, client_id, type, title, status, submitted_by_membership_id,
       decided_by_membership_id, decided_at, decision_rationale)
    values
      ('${R.terminal}', '${FA}', '${C.managed}', 'gst_reconciliation', 'RVW terminal fixture',
       'approved', '${M.seniorA}', '${M.managerA}', now(), 'pre-decided fixture row');

    -- Stage the linked-return tasks at 'submitted' (transaction-local command
    -- flag inside a DO block — the IMP-040 staging precedent; never reachable
    -- from PostgREST).
    do $$ begin
      perform set_config('app.task_transition_command', '1', true);
      update public.tasks set status = 'submitted' where id in ('${T.four}', '${T.four2}', '${T.plain}');
    end $$;
  `);
  // Fixture writes are operator/system-actor rows; remove fixture noise so
  // denial-by-side-effect checks read a clean table (IMP-031/040 precedent).
  psql(`delete from public.audit_log where firm_id in ('${FA}', '${FB}')`);

  for (const [key, set] of [
    ['USER_A_SUPER_ADMIN', (t: string) => (superAdminA = t)],
    ['USER_A_PARTNER', (t: string) => (partnerA = t)],
    ['USER_A_MANAGER', (t: string) => (managerA = t)],
    ['USER_B_MANAGER', (t: string) => (managerBInA = t)],
    ['USER_A_SENIOR', (t: string) => (seniorA = t)],
    ['USER_A_ARTICLE', (t: string) => (articleA = t)],
    ['USER_A_BILLING', (t: string) => (billingA = t)],
    ['USER_B_PARTNER', (t: string) => (partnerB = t)],
  ] as Array<[string, (t: string) => void]>) {
    const s = await signIn(userEmail(key));
    if (!s.ok) throw new Error(`sign-in failed for ${key}: ${JSON.stringify(s.raw)}`);
    set(s.token);
  }
});

afterAll(() => {
  cleanRows();
  psql(`
    delete from public.firms where id in ('${FA}', '${FB}')
      and not exists (select 1 from public.firm_memberships m where m.firm_id = firms.id)
      and not exists (select 1 from public.clients c where c.firm_id = firms.id);
  `);
});

// ---------------------------------------------------------------------------
// TEST-API-11 — authorization BEFORE disclosure (API-ERR-02, RLS-RVW-01)
// ---------------------------------------------------------------------------

describe('TEST-API-11 — decide_review_item authorization-before-disclosure', () => {
  it('hidden-existing and nonexistent ids are BYTE-IDENTICAL not_found (no existence oracle)', async () => {
    const missing = await decide(partnerA, {
      p_review_item_id: GHOST,
      p_decision: 'approved',
      p_rationale: 'probe',
    });
    expect(missing.status).toBe(200);
    expect(missing.body).toEqual(DECIDE_NOT_FOUND);
    // The exact key set — no extra field may leak existence/state.
    expect(Object.keys(missing.body as Record<string, unknown>).sort()).toEqual([
      'kind',
      'message',
      'status',
    ]);

    const deniedBefore = reviewAudit(R.hidden, 'review_item.decide_denied');
    const outScopeBefore = reviewAudit(R.outScope, 'review_item.decide_denied');
    const ghostBefore = reviewAudit(GHOST, 'review_item.decide_denied');

    // Existing-but-invisible probes: billing (no decision right), the
    // submitting senior (senior/article NEVER decide), a cross-tenant
    // partner, and an in-firm partner with the WRONG active-firm selector —
    // plus an out-of-portfolio manager on an unmanaged-link item.
    const probes = [
      await decide(billingA, { p_review_item_id: R.hidden, p_decision: 'approved', p_rationale: 'probe' }),
      await decide(seniorA, { p_review_item_id: R.hidden, p_decision: 'approved', p_rationale: 'probe' }),
      await decide(partnerB, { p_review_item_id: R.hidden, p_decision: 'approved', p_rationale: 'probe' }, FB),
      await decide(partnerA, { p_review_item_id: R.hidden, p_decision: 'approved', p_rationale: 'probe' }, FB),
      await decide(managerA, { p_review_item_id: R.outScope, p_decision: 'approved', p_rationale: 'probe' }),
    ];
    for (const res of probes) {
      expect(res.status).toBe(200);
      expect(res.body).toEqual(DECIDE_NOT_FOUND);
      expect(JSON.stringify(res.body)).toBe(JSON.stringify(missing.body));
    }
    // Rows untouched.
    expect(itemStatus(R.hidden)).toBe('pending');
    expect(itemStatus(R.outScope)).toBe('pending');
    // AUD-FAIL-01: existing-row probes are audited; a nonexistent id is not.
    expect(reviewAudit(R.hidden, 'review_item.decide_denied')).toBe(deniedBefore + 4);
    expect(reviewAudit(R.outScope, 'review_item.decide_denied')).toBe(outScopeBefore + 1);
    expect(reviewAudit(GHOST, 'review_item.decide_denied')).toBe(ghostBefore);
  });

  it('authorization precedes vocabulary, rationale-requirement, and replay state', async () => {
    // Out-of-scope caller (billing) against EXISTING items with probes that
    // would each reveal a different post-authorization fact:
    //   - an invalid decision value (vocabulary),
    //   - a blank rationale (rationale requirement),
    //   - a mutation key against an already-decided item (replay state).
    for (const body of [
      { p_review_item_id: R.hidden, p_decision: 'teleported', p_rationale: 'probe' },
      { p_review_item_id: R.hidden, p_decision: 'approved', p_rationale: '   ' },
      { p_review_item_id: R.terminal, p_decision: 'approved', p_rationale: 'probe', p_mutation_key: 'rvw-probe-key' },
    ]) {
      const res = await decide(billingA, body);
      expect(res.body, JSON.stringify(body)).toEqual(DECIDE_NOT_FOUND);
    }
    // Same for a cross-tenant caller.
    const cross = await decide(partnerB, {
      p_review_item_id: R.terminal,
      p_decision: 'teleported',
      p_rationale: '   ',
      p_mutation_key: 'rvw-probe-key',
    }, FB);
    expect(cross.body).toEqual(DECIDE_NOT_FOUND);
    expect(itemStatus(R.hidden)).toBe('pending');
    expect(itemStatus(R.terminal)).toBe('approved');
  });
});

// ---------------------------------------------------------------------------
// TEST-API-12 — mutation-key retry safety (API-MUT-03)
// ---------------------------------------------------------------------------

describe('TEST-API-12 — decide_review_item mutation-key replay', () => {
  it('a keyed retry returns already_applied with NO duplicate decision/comment/audit/transition', async () => {
    // Task-linked returned decision (T.plain is NOT four-eyes; the in-scope
    // portfolio manager holds the task-return authority).
    const first = await decide(managerA, {
      p_review_item_id: R.mutReturn,
      p_decision: 'returned',
      p_rationale: 'Reconcile the TDS credits against 26AS before resubmission.',
      p_mutation_key: 'rvw-mk-return-1',
    });
    expect(first.status).toBe(200);
    expect(first.body.status).toBe('decided');
    expect(first.body.from_status).toBe('pending');
    expect(first.body.to_status).toBe('returned');
    expect(first.body.task.status).toBe('returned');
    expect(first.body.reviewer_comment.body).toBe(
      'Reconcile the TDS credits against 26AS before resubmission.',
    );

    const auditAfterFirst = reviewAudit(R.mutReturn);
    const taskAuditAfterFirst = taskAudit(T.plain, 'task.transition');
    expect(reviewAudit(R.mutReturn, 'review_item.decided')).toBe(1);
    expect(commentCount(T.plain)).toBe(1);

    // Replay with the SAME mutation key: the original result, no re-apply.
    const replay = await decide(managerA, {
      p_review_item_id: R.mutReturn,
      p_decision: 'returned',
      p_rationale: 'Reconcile the TDS credits against 26AS before resubmission.',
      p_mutation_key: 'rvw-mk-return-1',
    });
    expect(replay.status).toBe(200);
    expect(replay.body.status).toBe('already_applied');
    expect(replay.body.reason).toBe('already_decided');
    expect(replay.body.item.status).toBe('returned');
    expect(JSON.stringify(replay.body.item)).toBe(JSON.stringify(first.body.item));

    // Retry safety is state-based (the established controlled-command
    // convention): a DIFFERENT key against the decided item is also a no-op.
    const otherKey = await decide(managerA, {
      p_review_item_id: R.mutReturn,
      p_decision: 'approved',
      p_rationale: 'different key probe',
      p_mutation_key: 'rvw-mk-return-2',
    });
    expect(otherKey.body.status).toBe('already_applied');
    expect(otherKey.body.item.status).toBe('returned');

    // No second decision, no second audit, no duplicate comment/transition.
    expect(reviewAudit(R.mutReturn)).toBe(auditAfterFirst);
    expect(taskAudit(T.plain, 'task.transition')).toBe(taskAuditAfterFirst);
    expect(commentCount(T.plain)).toBe(1);
    expect(itemStatus(R.mutReturn)).toBe('returned');
    expect(taskStatus(T.plain)).toBe('returned');

    // Keyless same-state re-decision is an ordinary conflict (API-ERR-04).
    const keyless = await decide(managerA, {
      p_review_item_id: R.mutReturn,
      p_decision: 'returned',
      p_rationale: 'again',
    });
    expect(keyless.body.status).toBe('denied');
    expect(keyless.body.kind).toBe('conflict');
    expect(String(keyless.body.message)).toContain('no decision from a terminal state (DM-SM-06)');
  });

  it('an out-of-scope replay probe returns not_found — no replay oracle (authorization BEFORE replay state)', async () => {
    // The exact mutation key that succeeded above, wielded by a caller with
    // no decision right: the replay state is never disclosed.
    const res = await decide(billingA, {
      p_review_item_id: R.mutReturn,
      p_decision: 'returned',
      p_rationale: 'Reconcile the TDS credits against 26AS before resubmission.',
      p_mutation_key: 'rvw-mk-return-1',
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual(DECIDE_NOT_FOUND);
  });
});

// ---------------------------------------------------------------------------
// TEST-API-13 — submit_review_item (SCH-17, RLS-RVW-01, API-MUT-04)
// ---------------------------------------------------------------------------

describe('TEST-API-13 — submit_review_item server-derived fields and scope', () => {
  it('server-derived firm/submitter/timestamps/status/source are stamped; actor/audit identity is server-side', async () => {
    const res = await submit(partnerA, {
      p_client_id: C.managed,
      p_type: 'gst_reconciliation',
      p_title: 'RVW API13 derived',
      p_note: 'note',
      p_priority: 'high',
      p_sla_due_at: '2026-09-20T00:00:00+00:00',
    });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('submitted');
    const item = res.body.item;
    expect(item.firm_id).toBe(FA);
    expect(item.client_id).toBe(C.managed);
    expect(item.submitted_by_membership_id).toBe(M.partnerA);
    expect(item.status).toBe('pending');
    expect(item.source).toBe('human');
    expect(item.ai_output_id).toBeNull();
    expect(item.task_id).toBeNull();
    expect(item.compliance_instance_id).toBeNull();
    expect(item.decided_by_membership_id).toBeNull();
    expect(item.decided_at).toBeNull();
    expect(item.decision_rationale).toBeNull();
    expect(item.submitted_at).not.toBeNull();
    expect(item.sla_due_at).toBe('2026-09-20T00:00:00+00:00');
    // The authoritative audit row binds the caller's auth identity
    // (API-MUT-04 — never caller-supplied).
    const actor = psql(
      `select actor_type || ':' || actor_user_id from public.audit_log
       where action = 'review_item.submitted' and object_type = 'review_item' and object_id = '${item.id}';`,
    ).trim();
    expect(actor).toBe(`human:${PARTNER_A}`);
  });

  it('caller-supplied status/decision/actor/source keys are a PostgREST signature mismatch (unforgeable by construction)', async () => {
    for (const extra of [
      { status: 'approved' },
      { source: 'ai' },
      { ai_output_id: GHOST },
      { submitted_by_membership_id: M.seniorA },
      { decided_by_membership_id: M.managerA },
      { firm_id: FB },
    ]) {
      const res = await submit(partnerA, {
        p_client_id: C.managed,
        p_type: 'tds_return',
        p_title: 'RVW API13 forged',
        ...extra,
      });
      expect([400, 404], JSON.stringify(extra)).toContain(res.status);
      expect(String((res.body as { code?: string })?.code ?? '')).toMatch(/^PGRST/);
    }
    expect(
      psql(`select count(*) from public.review_items where firm_id = '${FA}' and title = 'RVW API13 forged';`).trim(),
    ).toBe('0');
  });

  it('subject derivation: task wins over a supplied client assertion; instance second; explicit client last', async () => {
    // Task supplied → client derived from the task (no client_id needed).
    const fromTask = await submit(seniorA, {
      p_task_id: T.adhocIn,
      p_type: 'audit_workpaper',
      p_title: 'RVW API13 from task',
    });
    expect(fromTask.body.status).toBe('submitted');
    expect(fromTask.body.item.client_id).toBe(C.managed);
    expect(fromTask.body.item.task_id).toBe(T.adhocIn);

    // A CONSISTENT client assertion alongside the task is accepted.
    const consistent = await submit(seniorA, {
      p_task_id: T.adhocIn,
      p_client_id: C.managed,
      p_type: 'audit_workpaper',
      p_title: 'RVW API13 consistent',
    });
    expect(consistent.body.status).toBe('submitted');

    // A MISMATCHING client assertion can never override the linked task.
    const mismatch = await submit(seniorA, {
      p_task_id: T.adhocIn,
      p_client_id: C.otherManaged,
      p_type: 'audit_workpaper',
      p_title: 'RVW API13 mismatch',
    });
    expect(mismatch.body.status).toBe('denied');
    expect(mismatch.body.kind).toBe('validation');
    expect(String(mismatch.body.message)).toContain('does not match the linked task subject');

    // Instance supplied (no task) → client derived from the instance.
    const fromInstance = await submit(seniorA, {
      p_compliance_instance_id: I.plainIn,
      p_type: 'itr_computation',
      p_title: 'RVW API13 from instance',
    });
    expect(fromInstance.body.status).toBe('submitted');
    expect(fromInstance.body.item.client_id).toBe(C.managed);
    expect(fromInstance.body.item.compliance_instance_id).toBe(I.plainIn);

    const instanceMismatch = await submit(seniorA, {
      p_compliance_instance_id: I.plainIn,
      p_client_id: C.unmanaged,
      p_type: 'itr_computation',
      p_title: 'RVW API13 instance mismatch',
    });
    expect(instanceMismatch.body.kind).toBe('validation');
    expect(String(instanceMismatch.body.message)).toContain('does not match the linked compliance instance subject');

    // Task + instance: the task must reference EXACTLY that instance.
    const wrongInstance = await submit(seniorA, {
      p_task_id: T.plain,
      p_compliance_instance_id: I.fourIn,
      p_type: 'audit_workpaper',
      p_title: 'RVW API13 wrong instance',
    });
    expect(wrongInstance.body.kind).toBe('validation');
    expect(String(wrongInstance.body.message)).toContain('does not reference the supplied compliance instance');

    const bothConsistent = await submit(seniorA, {
      p_task_id: T.plain,
      p_compliance_instance_id: I.plainIn,
      p_type: 'audit_workpaper',
      p_title: 'RVW API13 both consistent',
    });
    expect(bothConsistent.body.status).toBe('submitted');

    // Neither task nor instance → explicit client is REQUIRED.
    const noSubject = await submit(partnerA, {
      p_type: 'tds_return',
      p_title: 'RVW API13 no subject',
    });
    expect(noSubject.body.kind).toBe('validation');
    expect(String(noSubject.body.message)).toContain('client_id is required');
  });

  it('role submission scope matrix (RLS-RVW-01): firm-wide / portfolio / assigned-work / denied', async () => {
    // super_admin / partner — any client of the active firm.
    for (const [token, client] of [
      [superAdminA, C.unmanaged],
      [partnerA, C.otherManaged],
    ] as Array<[string, string]>) {
      const res = await submit(token, {
        p_client_id: client,
        p_type: 'financial_statements',
        p_title: 'RVW API13 matrix privileged',
      });
      expect(res.body.status, client).toBe('submitted');
    }

    // manager — portfolio only (ad-hoc and instance-linked-without-task).
    const mgrIn = await submit(managerA, {
      p_client_id: C.managed,
      p_type: 'financial_statements',
      p_title: 'RVW API13 matrix manager in',
    });
    expect(mgrIn.body.status).toBe('submitted');
    for (const client of [C.otherManaged, C.unmanaged]) {
      const res = await submit(managerA, {
        p_client_id: client,
        p_type: 'financial_statements',
        p_title: 'RVW API13 matrix manager out',
      });
      expect(res.body, client).toEqual(SUBJECT_NOT_FOUND);
    }

    // senior/article — work already inside the assigned-work scope; no
    // bootstrapping onto an unrelated client.
    const articleInstance = await submit(articleA, {
      p_compliance_instance_id: I.plainIn, // article is the instance reviewer
      p_type: 'itr_computation',
      p_title: 'RVW API13 matrix article',
    });
    expect(articleInstance.body.status).toBe('submitted');
    // C.otherManaged is INSIDE senior's assigned-work scope (assignee of
    // T.four2 there) — ad-hoc submission is legitimately allowed.
    const seniorAssigned = await submit(seniorA, {
      p_client_id: C.otherManaged,
      p_type: 'financial_statements',
      p_title: 'RVW API13 matrix senior assigned',
    });
    expect(seniorAssigned.body.status).toBe('submitted');
    expect(seniorAssigned.body.item.submitted_by_membership_id).toBe(M.seniorA);
    // C.unmanaged has NOTHING assigned to senior — submission can never
    // bootstrap access to an otherwise out-of-scope client.
    const seniorBootstrap = await submit(seniorA, {
      p_client_id: C.unmanaged,
      p_type: 'financial_statements',
      p_title: 'RVW API13 matrix senior bootstrap',
    });
    expect(seniorBootstrap.body).toEqual(SUBJECT_NOT_FOUND);

    // billing — denied for an EXISTING in-firm subject: the same not_found
    // surface, audited as a security-significant probe (AUD-FAIL-01).
    const deniedBefore = submitDeniedCount();
    const billing = await submit(billingA, {
      p_client_id: C.managed,
      p_type: 'financial_statements',
      p_title: 'RVW API13 matrix billing',
    });
    expect(billing.body).toEqual(SUBJECT_NOT_FOUND);
    expect(submitDeniedCount()).toBe(deniedBefore + 1);

    // anon — no execute path at all.
    const anon = await submit('invalid-anon-token', {
      p_client_id: C.managed,
      p_type: 'financial_statements',
      p_title: 'RVW API13 matrix anon',
    });
    expect(anon.status).toBeGreaterThanOrEqual(400);
  });

  it('nonexistent and foreign subjects share the uniform not_found surface and stay un-audited', async () => {
    const deniedBefore = submitDeniedCount();
    for (const body of [
      { p_client_id: GHOST, p_type: 'tds_return', p_title: 'RVW API13 ghost client' },
      { p_task_id: GHOST, p_type: 'tds_return', p_title: 'RVW API13 ghost task' },
      { p_compliance_instance_id: GHOST, p_type: 'tds_return', p_title: 'RVW API13 ghost instance' },
      { p_client_id: C.firmB, p_type: 'tds_return', p_title: 'RVW API13 foreign client' },
      { p_task_id: T.firmB, p_type: 'tds_return', p_title: 'RVW API13 foreign task' },
    ]) {
      const res = await submit(partnerA, body);
      expect(res.status).toBe(200);
      expect(res.body, JSON.stringify(body)).toEqual(SUBJECT_NOT_FOUND);
    }
    // No subject row exists in-firm → nothing to bind an audit event to.
    expect(submitDeniedCount()).toBe(deniedBefore);

    // Positive cross-tenant control: firm B's partner submits in firm B.
    const inB = await submit(
      partnerB,
      { p_client_id: C.firmB, p_type: 'tds_return', p_title: 'RVW API13 firm B' },
      FB,
    );
    expect(inB.body.status).toBe('submitted');
    expect(inB.body.item.firm_id).toBe(FB);
  });

  it('type vocabulary and title shape are validation errors (CA400, un-audited)', async () => {
    const badType = await submit(partnerA, {
      p_client_id: C.managed,
      p_type: 'GST Reconciliation', // a display label is not a machine key
      p_title: 'RVW API13 bad type',
    });
    expect(badType.body.status).toBe('denied');
    expect(badType.body.kind).toBe('validation');
    expect(String(badType.body.message)).toContain('unknown review item type');

    for (const title of ['', '   ']) {
      const res = await submit(partnerA, {
        p_client_id: C.managed,
        p_type: 'tds_return',
        p_title: title,
      });
      expect(res.body.kind, JSON.stringify(title)).toBe('validation');
      expect(String(res.body.message)).toContain('title is required');
    }
  });
});

// ---------------------------------------------------------------------------
// TEST-API-14 — task-linked returned atomicity (DM-SM-06, RLS-TSK-01,
// RLS-4EY-03 — no rank bypass)
// ---------------------------------------------------------------------------

describe('TEST-API-14 — linked returned atomicity', () => {
  it('success composes item + task + exactly one immutable comment in one transaction', async () => {
    // Submission through the real command: the senior assignee submits the
    // four-eyes task for review (task + instance links consistent).
    const submitted = await submit(seniorA, {
      p_task_id: T.four,
      p_compliance_instance_id: I.fourIn,
      p_type: 'audit_workpaper',
      p_title: 'RVW API14 four-eyes success',
    });
    expect(submitted.body.status).toBe('submitted');
    const itemId = submitted.body.item.id;
    expect(submitted.body.item.client_id).toBe(C.managed);

    const commentsBefore = commentCount(T.four);
    // The assigned task reviewer (managerA) decides — item scope via the
    // linked task, ReviewItem four-eyes (decider ≠ submitter) satisfied.
    const res = await decide(managerA, {
      p_review_item_id: itemId,
      p_decision: 'returned',
      p_rationale: 'Rework the workpaper indexing and re-tie the lead schedule.',
    });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('decided');
    expect(res.body.from_status).toBe('pending');
    expect(res.body.to_status).toBe('returned');
    expect(res.body.item.decided_by_membership_id).toBe(M.managerA);
    expect(res.body.item.decision_rationale).toBe(
      'Rework the workpaper indexing and re-tie the lead schedule.',
    );
    // The linked task transition rides the same transaction.
    expect(res.body.task.status).toBe('returned');
    expect(res.body.reviewer_comment.task_id).toBe(T.four);
    expect(res.body.reviewer_comment.body).toBe(
      'Rework the workpaper indexing and re-tie the lead schedule.',
    );
    expect(res.body.reviewer_comment.author_id).toBe(MANAGER_A);

    // Server truth: item returned, task returned, EXACTLY ONE comment
    // carrying the rationale attributed to the decision actor.
    expect(itemStatus(itemId)).toBe('returned');
    expect(taskStatus(T.four)).toBe('returned');
    expect(commentCount(T.four)).toBe(commentsBefore + 1);
    const comment = psql(
      `select body || ':' || author_id from public.task_comments where task_id = '${T.four}';`,
    ).trim();
    expect(comment).toBe(`Rework the workpaper indexing and re-tie the lead schedule.:${MANAGER_A}`);
    expect(reviewAudit(itemId, 'review_item.decided')).toBe(1);
    expect(taskAudit(T.four, 'task.transition')).toBe(1);
  });

  it('rank does NOT bypass the assigned task reviewer on a four-eyes task (RLS-4EY-03 via decide_review_item)', async () => {
    // R.rankBypass: item on T.four2 (four-eyes, C.otherManaged), submitted by
    // the senior assignee. partner / super_admin / the in-scope portfolio
    // manager (managerBInA) all hold ReviewItem decision scope but NONE is
    // the assigned task reviewer.
    const auditBefore = reviewAudit(R.rankBypass, 'review_item.decided');
    const taskAuditBefore = taskAudit(T.four2, 'task.transition');
    for (const [token, label] of [
      [partnerA, 'partner'],
      [superAdminA, 'super_admin'],
      [managerBInA, 'scoped manager (not the assigned reviewer)'],
    ] as Array<[string, string]>) {
      const res = await decide(token, {
        p_review_item_id: R.rankBypass,
        p_decision: 'returned',
        p_rationale: `${label} attempts the return`,
      });
      expect(res.status, label).toBe(200);
      expect(res.body.status, label).toBe('denied');
      expect(res.body.kind, label).toBe('unauthorized');
      expect(String(res.body.message), label).toContain('linked task refused the return:');
      expect(String(res.body.message), label).toContain('assigned reviewer');
    }
    // Total rollback per probe: item pending, task unchanged, no comment, no
    // successful review audit, no task transition audit.
    expect(itemStatus(R.rankBypass)).toBe('pending');
    expect(taskStatus(T.four2)).toBe('submitted');
    expect(commentCount(T.four2)).toBe(0);
    expect(reviewAudit(R.rankBypass, 'review_item.decided')).toBe(auditBefore);
    expect(taskAudit(T.four2, 'task.transition')).toBe(taskAuditBefore);

    // The assigned reviewer (managerA) succeeds — the probe refusals were
    // authority, not legality.
    const ok = await decide(managerA, {
      p_review_item_id: R.rankBypass,
      p_decision: 'returned',
      p_rationale: 'Assigned reviewer returns for rework.',
    });
    expect(ok.body.status).toBe('decided');
    expect(ok.body.to_status).toBe('returned');
    expect(taskStatus(T.four2)).toBe('returned');
    expect(commentCount(T.four2)).toBe(1);
  });

  it('an illegal linked-task state rolls back ALL (item pending, task unchanged, no comment, conflict)', async () => {
    // T.illegalOpen sits at 'open' — DM-SM-05 permits no open → returned edge.
    const auditBefore = reviewAudit(R.illegal, 'review_item.decided');
    const res = await decide(partnerA, {
      p_review_item_id: R.illegal,
      p_decision: 'returned',
      p_rationale: 'Please rework.',
    });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('denied');
    expect(res.body.kind).toBe('conflict');
    expect(String(res.body.message)).toContain('linked task refused the return:');
    expect(String(res.body.message)).toContain('invalid status transition open -> returned');
    expect(itemStatus(R.illegal)).toBe('pending');
    expect(taskStatus(T.illegalOpen)).toBe('open');
    expect(commentCount(T.illegalOpen)).toBe(0);
    expect(reviewAudit(R.illegal, 'review_item.decided')).toBe(auditBefore);
  });

  it('an unlinked (client-subject) returned decision has NO task side effects', async () => {
    const commentsBefore = Number(
      psql(`select count(*) from public.task_comments where firm_id = '${FA}';`).trim(),
    );
    const res = await decide(managerA, {
      p_review_item_id: R.unlinkRet,
      p_decision: 'returned',
      p_rationale: 'Return the draft statements for the missing schedule.',
    });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('decided');
    expect(res.body.to_status).toBe('returned');
    expect(res.body.task).toBeNull();
    expect(res.body.reviewer_comment).toBeNull();
    expect(itemStatus(R.unlinkRet)).toBe('returned');
    expect(
      Number(psql(`select count(*) from public.task_comments where firm_id = '${FA}';`).trim()),
    ).toBe(commentsBefore);
  });
});

// ---------------------------------------------------------------------------
// TEST-API-15 — decision legality (DM-SM-06, RLS-4EY-04, API-ERR-04)
// ---------------------------------------------------------------------------

describe('TEST-API-15 — decision lifecycle legality', () => {
  it('all four outcomes succeed from pending with a non-empty rationale', async () => {
    for (const [id, decision] of [
      [R.approve, 'approved'],
      [R.return, 'returned'],
      [R.escalate, 'escalated'],
      [R.dismiss, 'dismissed'],
    ] as Array<[string, string]>) {
      const res = await decide(managerA, {
        p_review_item_id: id,
        p_decision: decision,
        p_rationale: `decision rationale for ${decision}`,
      });
      expect(res.status, decision).toBe(200);
      expect(res.body.status, decision).toBe('decided');
      expect(res.body.from_status, decision).toBe('pending');
      expect(res.body.to_status, decision).toBe(decision);
      expect(res.body.item.decided_by_membership_id).toBe(M.managerA);
      expect(res.body.item.decision_rationale).toBe(`decision rationale for ${decision}`);
      expect(res.body.item.decided_at).not.toBeNull();
      // None of these items is task-linked: no task side effects.
      expect(res.body.task).toBeNull();
      expect(res.body.reviewer_comment).toBeNull();
      expect(itemStatus(id)).toBe(decision);
    }
  });

  it('an invalid decision value is validation and leaves the item pending', async () => {
    for (const bad of ['teleported', 'Approved', 'pending']) {
      const res = await decide(partnerA, {
        p_review_item_id: R.vocab,
        p_decision: bad,
        p_rationale: 'probe',
      });
      expect(res.body.status, bad).toBe('denied');
      expect(res.body.kind, bad).toBe('validation');
      expect(String(res.body.message), bad).toContain('unknown decision');
    }
    expect(itemStatus(R.vocab)).toBe('pending');
  });

  it('terminal re-decision: keyless conflict, keyed already_applied', async () => {
    const keyless = await decide(managerA, {
      p_review_item_id: R.terminal,
      p_decision: 'dismissed',
      p_rationale: 'second decision attempt',
    });
    expect(keyless.body.status).toBe('denied');
    expect(keyless.body.kind).toBe('conflict');
    expect(String(keyless.body.message)).toContain('already decided (status approved)');
    expect(String(keyless.body.message)).toContain('no decision from a terminal state (DM-SM-06)');

    const keyed = await decide(managerA, {
      p_review_item_id: R.terminal,
      p_decision: 'dismissed',
      p_rationale: 'second decision attempt',
      p_mutation_key: 'rvw-mk-terminal',
    });
    expect(keyed.body.status).toBe('already_applied');
    expect(keyed.body.reason).toBe('already_decided');
    expect(keyed.body.item.status).toBe('approved');
    expect(itemStatus(R.terminal)).toBe('approved');
  });

  it('blank and whitespace-only rationales are mandatory-rationale conflicts for every outcome shape', async () => {
    for (const rationale of ['', '   ', '\t\n ']) {
      const res = await decide(partnerA, {
        p_review_item_id: R.rationale,
        p_decision: 'approved',
        p_rationale: rationale,
      });
      expect(res.body.status, JSON.stringify(rationale)).toBe('denied');
      expect(res.body.kind, JSON.stringify(rationale)).toBe('conflict');
      expect(String(res.body.message)).toContain('non-empty rationale is mandatory');
    }
    expect(itemStatus(R.rationale)).toBe('pending');
  });

  it('self-decision is unauthorized for every rank (RLS-4EY-04, no privileged-rank bypass)', async () => {
    const asManager = await decide(managerA, {
      p_review_item_id: R.byManager,
      p_decision: 'approved',
      p_rationale: 'approving my own submission',
    });
    expect(asManager.body.status).toBe('denied');
    expect(asManager.body.kind).toBe('unauthorized');
    expect(String(asManager.body.message)).toContain(
      'the deciding membership must differ from the submitting membership',
    );

    const asPartner = await decide(partnerA, {
      p_review_item_id: R.byPartner,
      p_decision: 'approved',
      p_rationale: 'partner rank does not bypass four-eyes',
    });
    expect(asPartner.body.kind).toBe('unauthorized');
    expect(String(asPartner.body.message)).toContain(
      'the deciding membership must differ from the submitting membership',
    );

    expect(itemStatus(R.byManager)).toBe('pending');
    expect(itemStatus(R.byPartner)).toBe('pending');
  });
});
