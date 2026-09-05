/**
 * IMP-041 PASS B — review_items RLS + controlled-command integration tests
 * (SCH-17, RLS-RVW-01, RLS-4EY-04, RLS-STF-03/05, RLS-MECH-01,
 * RLS-CTX-01/02/03, RLS-POR-03, API-R0-RVW, API-ERR-02, DM-SM-06).
 *
 * Exercises the REAL production policy review_items_select_scoped plus the
 * Layer-B commands submit_review_item() / decide_review_item() through
 * PostgREST with signed-in access tokens — never service-role for
 * authorization assertions. Service-side psql is used only for fixture
 * setup, controlled membership mutation (freshness cases), operator-path
 * fixture inserts (pending review rows need no command marker), and
 * teardown.
 *
 * Role posture under test (05 §11 note ‡, RLS-RVW-01):
 *   super_admin/partner — firm-wide queue + detail, firm-wide submit/decide;
 *   manager             — portfolio clients (RLS-STF-03) OR items whose
 *                         linked task is currently assigned to / reviewed by
 *                         the manager's live membership (RLS-TSK-01); NO
 *                         team hierarchy;
 *   senior/article      — own submissions only; submit only inside current
 *                         assigned-work scope; NEVER decide;
 *   billing             — nothing (RLS-STF-05);
 *   suspended/removed   — nothing, live on the same JWT (RLS-MECH-01);
 *   anon / client portal — nothing (RLS-POR-03; no portal rows in R0).
 *
 * TEST mapping (spec 11 — IMP-041 contract closure 2026-09-05):
 *   TEST-RLS-RVW-01…10 — the ten standard 05 §14 verification cases executed
 *   against review_items (same-tenant access, cross-tenant read/insert/
 *   update/delete, unauthorized role, authorized role, suspended/removed,
 *   client-context posture, staff-context/multi-firm isolation);
 *   TEST-RLS-RVW-11…16 — role visibility matrix, manager scope boundary,
 *   self-decision prohibition (RLS-4EY-04), live-membership freshness,
 *   direct decision writes closed, senior/article scope.
 *
 * Re-runnable: dedicated fixture firms in the 68000000-… range (isolated
 * from the shared registry firms other suites clean), deterministic ids,
 * force-reset on every run; fixture and denial audit rows removed as the
 * operator in teardown, scoped to THESE firm ids only (AUD-INV-01 — the
 * append-only rule binds application roles, not the operator).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { api, psql, signIn, userEmail, userId } from '../helpers.mjs';

const H = (firm: string) => ({ 'x-active-firm': firm });

/** The ONE pre-authorization denial surface of submit_review_item
 *  (API-ERR-02): nonexistent, foreign, and out-of-scope subjects all return
 *  exactly this body — no existence oracle. */
const SUBJECT_NOT_FOUND = {
  status: 'denied',
  kind: 'not_found',
  message: 'review subject not found',
};

/** The same uniform pre-authorization surface of decide_review_item. */
const ITEM_NOT_FOUND = {
  status: 'denied',
  kind: 'not_found',
  message: 'review item not found',
};

/** RLS-4EY-04 self-decision denial (post-authorization, audited CA401). */
const FOUR_EYES_MESSAGE =
  'the deciding membership must differ from the submitting membership (RLS-4EY-04, no privileged-rank bypass)';

// This suite owns TWO dedicated firms — never the shared registry FIRM_A/B
// (other suites clean those audit logs).
const FIRM_MAIN = '68000000-0000-4000-8000-00000000f00a';
const FIRM_XTEN = '68000000-0000-4000-8000-00000000f00b';

const M = {
  superA: '68000000-0000-4000-8000-000000000001',
  partnerA: '68000000-0000-4000-8000-000000000002',
  managerA: '68000000-0000-4000-8000-000000000003',
  managerBInA: '68000000-0000-4000-8000-000000000004', // second manager in MAIN
  seniorA: '68000000-0000-4000-8000-000000000005',
  articleA: '68000000-0000-4000-8000-000000000006',
  billingA: '68000000-0000-4000-8000-000000000007',
  suspendedA: '68000000-0000-4000-8000-000000000008',
  removedA: '68000000-0000-4000-8000-000000000009',
  multiA: '68000000-0000-4000-8000-00000000000a', // USER_MULTI_FIRM in MAIN
  partnerX: '68000000-0000-4000-8000-00000000000b', // USER_B_PARTNER in XTEN
  multiX: '68000000-0000-4000-8000-00000000000c', // USER_MULTI_FIRM in XTEN
};
const C = {
  inPortfolio: '68000000-0000-4000-8000-000000000101', // manager = managerA
  otherManaged: '68000000-0000-4000-8000-000000000102', // manager = managerBInA
  unmanaged: '68000000-0000-4000-8000-000000000103', // manager = null
  xten: '68000000-0000-4000-8000-000000000111', // cross-tenant firm
};
const TK = {
  mgrAssigned: '68000000-0000-4000-8000-000000000201', // ad-hoc C.otherManaged, assignee=managerA
  mgrReviewer: '68000000-0000-4000-8000-000000000202', // ad-hoc C.otherManaged, reviewer=managerA
  seniorTask: '68000000-0000-4000-8000-000000000203', // ad-hoc C.unmanaged, assignee=seniorA
  articleTask: '68000000-0000-4000-8000-000000000204', // ad-hoc C.inPortfolio, assignee=articleA
};
const RI = {
  byPartnerIn: '68000000-0000-4000-8000-000000000301', // C.inPortfolio, by partnerA
  bySeniorIn: '68000000-0000-4000-8000-000000000302', // C.inPortfolio, by seniorA
  byArticleIn: '68000000-0000-4000-8000-000000000303', // C.inPortfolio, by articleA
  selfManager: '68000000-0000-4000-8000-000000000304', // C.inPortfolio, by managerA (4-eyes leg)
  selfPartner: '68000000-0000-4000-8000-000000000305', // C.unmanaged, by partnerA (4-eyes leg)
  selfSuper: '68000000-0000-4000-8000-000000000306', // C.unmanaged, by superA (4-eyes leg)
  outUnlinked: '68000000-0000-4000-8000-000000000307', // C.otherManaged, unlinked, by partnerA
  mgrTaskLink: '68000000-0000-4000-8000-000000000308', // C.otherManaged, task=TK.mgrAssigned, by partnerA
  mgrReviewerLink: '68000000-0000-4000-8000-000000000309', // C.otherManaged, task=TK.mgrReviewer, by partnerA
  unmanaged: '68000000-0000-4000-8000-00000000030a', // C.unmanaged, unlinked, by partnerA
  decideOk: '68000000-0000-4000-8000-00000000030b', // C.inPortfolio, by managerA (partner decision target)
  xten: '68000000-0000-4000-8000-000000000311', // XTEN, C.xten, by partnerX
};

const MAIN_ITEMS = [
  RI.byPartnerIn, RI.bySeniorIn, RI.byArticleIn, RI.selfManager, RI.selfPartner,
  RI.selfSuper, RI.outUnlinked, RI.mgrTaskLink, RI.mgrReviewerLink, RI.unmanaged,
  RI.decideOk,
];

const PARTNER_A = userId('USER_A_PARTNER');
const SUPER_ADMIN_A = userId('USER_A_SUPER_ADMIN');
const MANAGER_A = userId('USER_A_MANAGER');
const MANAGER_B = userId('USER_B_MANAGER');
const SENIOR_A = userId('USER_A_SENIOR');
const ARTICLE_A = userId('USER_A_ARTICLE');
const BILLING_A = userId('USER_A_BILLING');
const SUSPENDED_A = userId('USER_A_SUSPENDED');
const REMOVED_A = userId('USER_A_REMOVED');
const MULTI = userId('USER_MULTI_FIRM');
const PARTNER_X = userId('USER_B_PARTNER');

let partnerA: string;
let superAdminA: string;
let managerA: string;
let seniorA: string;
let articleA: string;
let billingA: string;
let suspendedA: string;
let removedA: string;
let multiFirm: string;
let partnerX: string;
let clientOverlap: string;
// Id of the manager's task-linked submission created in TEST-RLS-RVW-07 —
// consumed by the TEST-RLS-RVW-12 exact-set assertion.
let mgrLinkedSubmissionId: string;

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

function cleanRows() {
  psql(`
    delete from public.audit_log where firm_id in ('${FIRM_MAIN}', '${FIRM_XTEN}');
    delete from public.review_items where firm_id in ('${FIRM_MAIN}', '${FIRM_XTEN}');
    delete from public.task_comments where firm_id in ('${FIRM_MAIN}', '${FIRM_XTEN}');
    delete from public.task_checklist_items where firm_id in ('${FIRM_MAIN}', '${FIRM_XTEN}');
    delete from public.task_dependencies where firm_id in ('${FIRM_MAIN}', '${FIRM_XTEN}');
    delete from public.tasks where firm_id in ('${FIRM_MAIN}', '${FIRM_XTEN}');
    delete from public.compliance_instances where firm_id in ('${FIRM_MAIN}', '${FIRM_XTEN}');
    delete from public.client_compliance_profiles where firm_id in ('${FIRM_MAIN}', '${FIRM_XTEN}');
    delete from public.legal_entities where firm_id in ('${FIRM_MAIN}', '${FIRM_XTEN}');
    delete from public.clients where firm_id in ('${FIRM_MAIN}', '${FIRM_XTEN}');
    delete from public.firm_memberships where id in
      ('${M.superA}','${M.partnerA}','${M.managerA}','${M.managerBInA}','${M.seniorA}','${M.articleA}',
       '${M.billingA}','${M.suspendedA}','${M.removedA}','${M.multiA}','${M.partnerX}','${M.multiX}');
  `);
}

function seedFixture() {
  cleanRows();
  psql(`
    insert into public.firms (id, name) values
      ('${FIRM_MAIN}', 'IMP-041 RVW RLS Firm Main'),
      ('${FIRM_XTEN}', 'IMP-041 RVW RLS Firm Xten')
    on conflict (id) do nothing;

    insert into public.firm_memberships (id, firm_id, user_id, role, status) values
      ('${M.superA}',      '${FIRM_MAIN}', '${SUPER_ADMIN_A}', 'super_admin',       'active'),
      ('${M.partnerA}',    '${FIRM_MAIN}', '${PARTNER_A}',     'partner',           'active'),
      ('${M.managerA}',    '${FIRM_MAIN}', '${MANAGER_A}',     'manager',           'active'),
      ('${M.managerBInA}', '${FIRM_MAIN}', '${MANAGER_B}',     'manager',           'active'),
      ('${M.seniorA}',     '${FIRM_MAIN}', '${SENIOR_A}',      'senior',            'active'),
      ('${M.articleA}',    '${FIRM_MAIN}', '${ARTICLE_A}',     'article_executive', 'active'),
      ('${M.billingA}',    '${FIRM_MAIN}', '${BILLING_A}',     'billing',           'active'),
      ('${M.suspendedA}',  '${FIRM_MAIN}', '${SUSPENDED_A}',   'senior',            'suspended'),
      ('${M.removedA}',    '${FIRM_MAIN}', '${REMOVED_A}',     'senior',            'removed'),
      ('${M.multiA}',      '${FIRM_MAIN}', '${MULTI}',         'partner',           'active'),
      ('${M.partnerX}',    '${FIRM_XTEN}', '${PARTNER_X}',     'partner',           'active'),
      ('${M.multiX}',      '${FIRM_XTEN}', '${MULTI}',         'partner',           'active')
    on conflict (firm_id, user_id) do nothing;

    -- Force-reset mutable state so re-runs are deterministic even if a
    -- previous run mutated status mid-flight (freshness cases).
    update public.firm_memberships set status = 'active'
      where id in ('${M.superA}', '${M.partnerA}', '${M.managerA}');
    update public.firm_memberships set status = 'suspended' where id = '${M.suspendedA}';
    update public.firm_memberships set status = 'removed' where id = '${M.removedA}';

    insert into public.clients (id, firm_id, name, owner_partner_membership_id, manager_membership_id, status) values
      ('${C.inPortfolio}',  '${FIRM_MAIN}', 'RVW RLS InPortfolio',  '${M.partnerA}', '${M.managerA}',    'active'),
      ('${C.otherManaged}', '${FIRM_MAIN}', 'RVW RLS OtherManaged', '${M.partnerA}', '${M.managerBInA}', 'active'),
      ('${C.unmanaged}',    '${FIRM_MAIN}', 'RVW RLS Unmanaged',    '${M.partnerA}', null,               'active'),
      ('${C.xten}',         '${FIRM_XTEN}', 'RVW RLS Xten',         '${M.partnerX}', null,               'active');

    insert into public.tasks
      (id, firm_id, client_id, compliance_instance_id, title, next_action,
       assignee_membership_id, reviewer_membership_id)
    values
      ('${TK.mgrAssigned}', '${FIRM_MAIN}', '${C.otherManaged}', null, 'RVW mgr assigned', 'collect docs', '${M.managerA}', null),
      ('${TK.mgrReviewer}', '${FIRM_MAIN}', '${C.otherManaged}', null, 'RVW mgr reviewer', 'collect docs', null, '${M.managerA}'),
      ('${TK.seniorTask}',  '${FIRM_MAIN}', '${C.unmanaged}',    null, 'RVW senior task',  'collect docs', '${M.seniorA}', null),
      ('${TK.articleTask}', '${FIRM_MAIN}', '${C.inPortfolio}',  null, 'RVW article task', 'collect docs', '${M.articleA}', null);

    -- Pending review rows are plain operator inserts (no command marker
    -- needed); status/source/priority/submitted_at take their defaults.
    insert into public.review_items
      (id, firm_id, client_id, task_id, type, title, submitted_by_membership_id)
    values
      ('${RI.byPartnerIn}',     '${FIRM_MAIN}', '${C.inPortfolio}',  null,              'gst_reconciliation',   'RVW by partner in-portfolio',   '${M.partnerA}'),
      ('${RI.bySeniorIn}',      '${FIRM_MAIN}', '${C.inPortfolio}',  null,              'tds_return',           'RVW by senior in-portfolio',    '${M.seniorA}'),
      ('${RI.byArticleIn}',     '${FIRM_MAIN}', '${C.inPortfolio}',  null,              'itr_computation',      'RVW by article in-portfolio',   '${M.articleA}'),
      ('${RI.selfManager}',     '${FIRM_MAIN}', '${C.inPortfolio}',  null,              'financial_statements', 'RVW self manager',              '${M.managerA}'),
      ('${RI.selfPartner}',     '${FIRM_MAIN}', '${C.unmanaged}',    null,              'audit_workpaper',      'RVW self partner',              '${M.partnerA}'),
      ('${RI.selfSuper}',       '${FIRM_MAIN}', '${C.unmanaged}',    null,              'gst_reconciliation',   'RVW self super',                '${M.superA}'),
      ('${RI.outUnlinked}',     '${FIRM_MAIN}', '${C.otherManaged}', null,              'tds_return',           'RVW out-of-portfolio unlinked', '${M.partnerA}'),
      ('${RI.mgrTaskLink}',     '${FIRM_MAIN}', '${C.otherManaged}', '${TK.mgrAssigned}', 'itr_computation',    'RVW manager assignee link',     '${M.partnerA}'),
      ('${RI.mgrReviewerLink}', '${FIRM_MAIN}', '${C.otherManaged}', '${TK.mgrReviewer}', 'financial_statements', 'RVW manager reviewer link',   '${M.partnerA}'),
      ('${RI.unmanaged}',       '${FIRM_MAIN}', '${C.unmanaged}',    null,              'audit_workpaper',      'RVW unmanaged unlinked',        '${M.partnerA}'),
      ('${RI.decideOk}',        '${FIRM_MAIN}', '${C.inPortfolio}',  null,              'gst_reconciliation',   'RVW decide target',             '${M.managerA}'),
      ('${RI.xten}',            '${FIRM_XTEN}', '${C.xten}',         null,              'tds_return',           'RVW cross-tenant',              '${M.partnerX}');
  `);
  // Fixture writes are operator/system-actor rows; remove fixture noise so
  // denial-by-side-effect checks read a clean table (IMP-031/040 precedent).
  psql(`delete from public.audit_log where firm_id in ('${FIRM_MAIN}', '${FIRM_XTEN}')`);
}

beforeAll(async () => {
  seedFixture();
  for (const [key, set] of [
    ['USER_A_PARTNER', (t: string) => (partnerA = t)],
    ['USER_A_SUPER_ADMIN', (t: string) => (superAdminA = t)],
    ['USER_A_MANAGER', (t: string) => (managerA = t)],
    ['USER_A_SENIOR', (t: string) => (seniorA = t)],
    ['USER_A_ARTICLE', (t: string) => (articleA = t)],
    ['USER_A_BILLING', (t: string) => (billingA = t)],
    ['USER_A_SUSPENDED', (t: string) => (suspendedA = t)],
    ['USER_A_REMOVED', (t: string) => (removedA = t)],
    ['USER_MULTI_FIRM', (t: string) => (multiFirm = t)],
    ['USER_B_PARTNER', (t: string) => (partnerX = t)],
    ['USER_CLIENT_OVERLAP', (t: string) => (clientOverlap = t)],
  ] as Array<[string, (t: string) => void]>) {
    const s = await signIn(userEmail(key));
    if (!s.ok) throw new Error(`sign-in failed for ${key}: ${JSON.stringify(s.raw)}`);
    set(s.token);
  }
});

afterAll(() => {
  // Child rows first — the membership/firm deletes would otherwise trip the
  // hierarchy FKs, and leaving rows behind poisons the next suite in the
  // sequential chain.
  cleanRows();
  psql(`
    delete from public.firms where id in ('${FIRM_MAIN}', '${FIRM_XTEN}')
      and not exists (select 1 from public.firm_memberships m where m.firm_id = firms.id)
      and not exists (select 1 from public.clients c where c.firm_id = firms.id);
  `);
});

const ids = (body: Array<{ id: string }>) => body.map((r) => r.id);

function submit(
  token: string,
  firm: string | null,
  body: Record<string, unknown>,
) {
  return api(token, 'POST', 'rpc/submit_review_item', {
    headers: firm ? H(firm) : {},
    body,
  });
}

function decide(
  token: string,
  firm: string | null,
  body: Record<string, unknown>,
) {
  return api(token, 'POST', 'rpc/decide_review_item', {
    headers: firm ? H(firm) : {},
    body,
  });
}

// ---------------------------------------------------------------------------
// TEST-RLS-RVW-01 — same-tenant authorized access succeeds (05 §14 case 1)
// ---------------------------------------------------------------------------

describe('TEST-RLS-RVW-01 — same-tenant authorized access succeeds', () => {
  it('every staff role reads its authorized in-scope rows in the active firm (200, correct ids)', async () => {
    const asSuper = await api(superAdminA, 'GET', 'review_items?select=id', { headers: H(FIRM_MAIN) });
    expect(asSuper.status).toBe(200);
    expect(ids(asSuper.body)).toEqual(expect.arrayContaining(MAIN_ITEMS));

    const asManager = await api(managerA, 'GET', 'review_items?select=id', { headers: H(FIRM_MAIN) });
    expect(asManager.status).toBe(200);
    expect(ids(asManager.body)).toEqual(
      expect.arrayContaining([RI.byPartnerIn, RI.selfManager, RI.mgrTaskLink, RI.mgrReviewerLink]),
    );

    const asSenior = await api(seniorA, 'GET', 'review_items?select=id', { headers: H(FIRM_MAIN) });
    expect(asSenior.status).toBe(200);
    expect(ids(asSenior.body)).toEqual([RI.bySeniorIn]);

    const asArticle = await api(articleA, 'GET', 'review_items?select=id', { headers: H(FIRM_MAIN) });
    expect(asArticle.status).toBe(200);
    expect(ids(asArticle.body)).toEqual([RI.byArticleIn]);
  });
});

// ---------------------------------------------------------------------------
// TEST-RLS-RVW-02 — cross-tenant read fails (05 §14 case 2)
// ---------------------------------------------------------------------------

describe('TEST-RLS-RVW-02 — cross-tenant read fails', () => {
  it('known foreign ids are indistinguishable from nonexistent, both directions', async () => {
    const asMain = await api(partnerA, 'GET', `review_items?id=eq.${RI.xten}`, { headers: H(FIRM_MAIN) });
    expect(asMain.status).toBe(200);
    expect(asMain.body).toEqual([]);
    const asXten = await api(partnerX, 'GET', `review_items?id=eq.${RI.byPartnerIn}`, { headers: H(FIRM_XTEN) });
    expect(asXten.body).toEqual([]);
    // The cross-tenant partner sees ONLY its own firm's queue.
    const xtenQueue = await api(partnerX, 'GET', 'review_items?select=id', { headers: H(FIRM_XTEN) });
    expect(ids(xtenQueue.body)).toEqual([RI.xten]);
  });

  it('a forged selector selects nothing without a live membership there (RLS-CTX-02)', async () => {
    const forged = await api(partnerA, 'GET', 'review_items?select=id', { headers: H(FIRM_XTEN) });
    expect(forged.status).toBe(200);
    expect(forged.body).toEqual([]);
  });

  it('cross-tenant command calls share the uniform not_found surface (API-ERR-02)', async () => {
    const decideForeign = await decide(partnerA, FIRM_MAIN, {
      p_review_item_id: RI.xten, p_decision: 'approved', p_rationale: 'cross-tenant attempt',
    });
    expect(decideForeign.body).toEqual(ITEM_NOT_FOUND);
    const decideForgedSelector = await decide(partnerA, FIRM_XTEN, {
      p_review_item_id: RI.byPartnerIn, p_decision: 'approved', p_rationale: 'forged selector',
    });
    expect(decideForgedSelector.body).toEqual(ITEM_NOT_FOUND);
    const submitForeign = await submit(partnerA, FIRM_MAIN, {
      p_client_id: C.xten, p_type: 'tds_return', p_title: 'cross-tenant submit',
    });
    expect(submitForeign.body).toEqual(SUBJECT_NOT_FOUND);
    const submitForged = await submit(partnerA, FIRM_XTEN, {
      p_client_id: C.xten, p_type: 'tds_return', p_title: 'forged selector submit',
    });
    expect(submitForged.body).toEqual(SUBJECT_NOT_FOUND);
    expect(psql(`select count(*) from public.review_items where title like 'cross-tenant%'
      or title like 'forged selector%';`).trim()).toBe('0');
  });
});

// ---------------------------------------------------------------------------
// TEST-RLS-RVW-03 — cross-tenant insert fails (05 §14 case 3)
// ---------------------------------------------------------------------------

describe('TEST-RLS-RVW-03 — cross-tenant insert fails', () => {
  it('direct INSERT is not granted at all — foreign selector, foreign firm_id, and same-firm alike (42501)', async () => {
    const base = {
      client_id: C.xten, type: 'tds_return', title: 'direct insert',
      submitted_by_membership_id: M.partnerX,
    };
    const foreignSelector = await api(partnerA, 'POST', 'review_items', {
      headers: H(FIRM_XTEN),
      body: { ...base, firm_id: FIRM_XTEN },
    });
    expect(foreignSelector.status).toBe(403);
    expect((foreignSelector.body as { code: string }).code).toBe('42501');
    const foreignColumn = await api(partnerX, 'POST', 'review_items', {
      headers: H(FIRM_XTEN),
      body: { ...base, firm_id: FIRM_MAIN, client_id: C.inPortfolio, submitted_by_membership_id: M.partnerA },
    });
    expect(foreignColumn.status).toBe(403);
    const sameFirm = await api(superAdminA, 'POST', 'review_items', {
      headers: H(FIRM_MAIN),
      body: {
        firm_id: FIRM_MAIN, client_id: C.inPortfolio, type: 'tds_return',
        title: 'direct insert', submitted_by_membership_id: M.superA,
      },
    });
    expect(sameFirm.status).toBe(403);
    expect((sameFirm.body as { code: string }).code).toBe('42501');
    expect(psql(`select count(*) from public.review_items where title = 'direct insert';`).trim()).toBe('0');
  });
});

// ---------------------------------------------------------------------------
// TEST-RLS-RVW-04 — cross-tenant update fails (05 §14 case 4)
// ---------------------------------------------------------------------------

describe('TEST-RLS-RVW-04 — cross-tenant update fails', () => {
  it('direct UPDATE is not granted at all — cross-tenant both directions, row provably unchanged (42501)', async () => {
    const asMain = await api(partnerA, 'PATCH', `review_items?id=eq.${RI.xten}`, {
      headers: H(FIRM_MAIN),
      body: { title: 'hijacked' },
    });
    expect(asMain.status).toBe(403);
    expect((asMain.body as { code: string }).code).toBe('42501');
    const asXten = await api(partnerX, 'PATCH', `review_items?id=eq.${RI.byPartnerIn}`, {
      headers: H(FIRM_XTEN),
      body: { title: 'hijacked' },
    });
    expect(asXten.status).toBe(403);
    expect(psql(`select title from public.review_items where id = '${RI.xten}';`).trim()).toBe('RVW cross-tenant');
    expect(psql(`select title from public.review_items where id = '${RI.byPartnerIn}';`).trim())
      .toBe('RVW by partner in-portfolio');
  });
});

// ---------------------------------------------------------------------------
// TEST-RLS-RVW-05 — cross-tenant delete fails (05 §14 case 5)
// ---------------------------------------------------------------------------

describe('TEST-RLS-RVW-05 — cross-tenant delete fails', () => {
  it('direct DELETE is not granted at all — cross-tenant and same-firm alike; decision rows are accountability records', async () => {
    const asMain = await api(partnerA, 'DELETE', `review_items?id=eq.${RI.xten}`, { headers: H(FIRM_MAIN) });
    expect(asMain.status).toBe(403);
    expect((asMain.body as { code: string }).code).toBe('42501');
    const asXten = await api(partnerX, 'DELETE', `review_items?id=eq.${RI.byPartnerIn}`, { headers: H(FIRM_XTEN) });
    expect(asXten.status).toBe(403);
    const sameFirm = await api(superAdminA, 'DELETE', `review_items?id=eq.${RI.unmanaged}`, { headers: H(FIRM_MAIN) });
    expect(sameFirm.status).toBe(403);
    expect(psql(`select count(*) from public.review_items where id in ('${RI.xten}','${RI.byPartnerIn}','${RI.unmanaged}');`).trim())
      .toBe('3');
  });
});

// ---------------------------------------------------------------------------
// TEST-RLS-RVW-06 — unauthorized role fails (05 §14 case 6)
// ---------------------------------------------------------------------------

describe('TEST-RLS-RVW-06 — unauthorized role fails (billing, anon)', () => {
  it('billing reads nothing and both commands deny on the uniform surface', async () => {
    const read = await api(billingA, 'GET', 'review_items?select=id', { headers: H(FIRM_MAIN) });
    expect(read.status).toBe(200);
    expect(read.body).toEqual([]);
    const sub = await submit(billingA, FIRM_MAIN, {
      p_client_id: C.inPortfolio, p_type: 'gst_reconciliation', p_title: 'billing submit',
    });
    expect(sub.body).toEqual(SUBJECT_NOT_FOUND);
    const dec = await decide(billingA, FIRM_MAIN, {
      p_review_item_id: RI.byPartnerIn, p_decision: 'approved', p_rationale: 'billing decide',
    });
    expect(dec.body).toEqual(ITEM_NOT_FOUND);
  });

  it('anon is denied outright on the table and both commands', async () => {
    const read = await api('invalid-anon-token', 'GET', 'review_items?select=id', { headers: H(FIRM_MAIN) });
    expect(read.status).toBeGreaterThanOrEqual(400);
    for (const rpc of ['submit_review_item', 'decide_review_item']) {
      const res = await api('invalid-anon-token', 'POST', `rpc/${rpc}`, {
        headers: H(FIRM_MAIN),
        body: {
          p_client_id: C.inPortfolio, p_review_item_id: RI.byPartnerIn,
          p_type: 'tds_return', p_title: 'anon', p_decision: 'approved', p_rationale: 'anon',
        },
      });
      expect(res.status).toBeGreaterThanOrEqual(400);
    }
  });
});

// ---------------------------------------------------------------------------
// TEST-RLS-RVW-07 — authorized role succeeds (05 §14 case 7)
// ---------------------------------------------------------------------------

describe('TEST-RLS-RVW-07 — authorized role succeeds (submit + decide happy paths)', () => {
  it('super_admin/partner submit firm-wide; server derives firm/submitter/status/source', async () => {
    const res = await submit(partnerA, FIRM_MAIN, {
      p_client_id: C.unmanaged, p_type: 'gst_reconciliation', p_title: 'RVW partner ad-hoc',
      p_note: 'routine', p_priority: 'high',
    });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('submitted');
    const item = res.body.item as Record<string, unknown>;
    expect(item.firm_id).toBe(FIRM_MAIN);
    expect(item.client_id).toBe(C.unmanaged);
    expect(item.submitted_by_membership_id).toBe(M.partnerA);
    expect(item.status).toBe('pending');
    expect(item.source).toBe('human');
    expect(item.ai_output_id).toBeNull();
  });

  it('manager submits inside the portfolio and via a directly-assigned task link (subject derived from the task)', async () => {
    const portfolio = await submit(managerA, FIRM_MAIN, {
      p_client_id: C.inPortfolio, p_type: 'tds_return', p_title: 'RVW manager portfolio',
    });
    expect(portfolio.body.status).toBe('submitted');
    expect((portfolio.body.item as Record<string, unknown>).submitted_by_membership_id).toBe(M.managerA);
    const linked = await submit(managerA, FIRM_MAIN, {
      p_task_id: TK.mgrAssigned, p_type: 'itr_computation', p_title: 'RVW manager task link',
    });
    expect(linked.body.status).toBe('submitted');
    // Linked subject wins: client_id is server-derived from the task.
    expect((linked.body.item as Record<string, unknown>).client_id).toBe(C.otherManaged);
    expect((linked.body.item as Record<string, unknown>).task_id).toBe(TK.mgrAssigned);
    mgrLinkedSubmissionId = (linked.body.item as Record<string, unknown>).id as string;
  });

  it('partner decides an item submitted by the manager — decision fields stamped atomically', async () => {
    const res = await decide(partnerA, FIRM_MAIN, {
      p_review_item_id: RI.decideOk, p_decision: 'approved', p_rationale: 'verified against ledger',
    });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('decided');
    expect(res.body.from_status).toBe('pending');
    expect(res.body.to_status).toBe('approved');
    const item = res.body.item as Record<string, unknown>;
    expect(item.decided_by_membership_id).toBe(M.partnerA);
    expect(item.decision_rationale).toBe('verified against ledger');
    expect(item.decided_at).not.toBeNull();
    expect(res.body.task).toBeNull(); // unlinked item: no task side effects
    expect(
      psql(`select status || '|' || decided_by_membership_id from public.review_items where id = '${RI.decideOk}';`).trim(),
    ).toBe(`approved|${M.partnerA}`);
  });

  it('manager decides a task-linked item in direct scope (approved never touches the linked task)', async () => {
    const res = await decide(managerA, FIRM_MAIN, {
      p_review_item_id: RI.mgrTaskLink, p_decision: 'approved', p_rationale: 'reconciles clean',
    });
    expect(res.body.status).toBe('decided');
    expect(res.body.to_status).toBe('approved');
    expect(psql(`select status from public.tasks where id = '${TK.mgrAssigned}';`).trim()).toBe('open');
  });
});

// ---------------------------------------------------------------------------
// TEST-RLS-RVW-08 — suspended/removed membership loses access (05 §14 case 8)
// ---------------------------------------------------------------------------

describe('TEST-RLS-RVW-08 — suspended/removed membership loses access', () => {
  it('suspended and removed members read nothing and both commands deny with a live token', async () => {
    for (const token of [suspendedA, removedA]) {
      const read = await api(token, 'GET', 'review_items?select=id', { headers: H(FIRM_MAIN) });
      expect(read.status).toBe(200);
      expect(read.body).toEqual([]);
      const sub = await submit(token, FIRM_MAIN, {
        p_client_id: C.inPortfolio, p_type: 'tds_return', p_title: 'suspended submit',
      });
      expect(sub.body).toEqual(SUBJECT_NOT_FOUND);
      const dec = await decide(token, FIRM_MAIN, {
        p_review_item_id: RI.bySeniorIn, p_decision: 'approved', p_rationale: 'suspended decide',
      });
      expect(dec.body).toEqual(ITEM_NOT_FOUND);
    }
  });
});

// ---------------------------------------------------------------------------
// TEST-RLS-RVW-09 — client context cannot obtain staff-only data (05 §14
// case 9, RLS-POR-03): R0 has no portal users and no portal policy — the
// catalog itself is the assertion, plus a no-membership identity probe.
// ---------------------------------------------------------------------------

describe('TEST-RLS-RVW-09 — client context cannot obtain staff-only data (RLS-POR-03)', () => {
  it('the policy catalog carries exactly one SELECT-only staff policy — no portal/anon read path exists', () => {
    const rows = psql(
      `select policyname || '|' || cmd || '|' || roles::text from pg_policies
        where schemaname = 'public' and tablename = 'review_items' order by 1;`,
    ).trim();
    expect(rows).toBe('review_items_select_scoped|SELECT|{authenticated}');
  });

  it('an identity with no staff membership in the firm gets nothing even with a forged selector', async () => {
    const read = await api(clientOverlap, 'GET', 'review_items?select=id', { headers: H(FIRM_MAIN) });
    expect(read.status).toBe(200);
    expect(read.body).toEqual([]);
    const sub = await submit(clientOverlap, FIRM_MAIN, {
      p_client_id: C.inPortfolio, p_type: 'tds_return', p_title: 'portal probe',
    });
    expect(sub.body).toEqual(SUBJECT_NOT_FOUND);
    const dec = await decide(clientOverlap, FIRM_MAIN, {
      p_review_item_id: RI.byPartnerIn, p_decision: 'approved', p_rationale: 'portal probe',
    });
    expect(dec.body).toEqual(ITEM_NOT_FOUND);
  });
});

// ---------------------------------------------------------------------------
// TEST-RLS-RVW-10 — staff context cannot accidentally inherit unrelated
// client scope (05 §14 case 10, RLS-CTX-03); multi-firm context isolation
// (TEST-RLS-GEN-03 switching).
// ---------------------------------------------------------------------------

describe('TEST-RLS-RVW-10 — staff context / multi-firm isolation (RLS-CTX-03)', () => {
  it('no selector at all selects nothing — context is required, never assumed', async () => {
    const read = await api(partnerA, 'GET', 'review_items?select=id');
    expect(read.status).toBe(200);
    expect(read.body).toEqual([]);
    const sub = await submit(partnerA, null, {
      p_client_id: C.inPortfolio, p_type: 'tds_return', p_title: 'no context',
    });
    expect(sub.body).toEqual(SUBJECT_NOT_FOUND);
    const dec = await decide(partnerA, null, {
      p_review_item_id: RI.byPartnerIn, p_decision: 'approved', p_rationale: 'no context',
    });
    expect(dec.body).toEqual(ITEM_NOT_FOUND);
  });

  it('multi-firm user: each selected context exposes exactly that firm, never the other', async () => {
    const mainView = await api(multiFirm, 'GET', 'review_items?select=id', { headers: H(FIRM_MAIN) });
    expect(ids(mainView.body)).toEqual(expect.arrayContaining(MAIN_ITEMS));
    expect(ids(mainView.body)).not.toContain(RI.xten);
    const xtenView = await api(multiFirm, 'GET', 'review_items?select=id', { headers: H(FIRM_XTEN) });
    expect(ids(xtenView.body)).toEqual([RI.xten]);
    // Commands honor the selector too: partner-in-XTEN decides the XTEN item.
    const res = await decide(multiFirm, FIRM_XTEN, {
      p_review_item_id: RI.xten, p_decision: 'dismissed', p_rationale: 'duplicate of the paper file',
    });
    expect(res.body.status).toBe('decided');
    const fromMainContext = await decide(multiFirm, FIRM_MAIN, {
      p_review_item_id: RI.xten, p_decision: 'approved', p_rationale: 'wrong context',
    });
    expect(fromMainContext.body).toEqual(ITEM_NOT_FOUND);
  });
});

// ---------------------------------------------------------------------------
// TEST-RLS-RVW-11 — role visibility matrix (RLS-RVW-01 queue/detail scope)
// ---------------------------------------------------------------------------

describe('TEST-RLS-RVW-11 — role visibility matrix', () => {
  it('super_admin/partner see the full firm queue and nothing foreign', async () => {
    for (const token of [superAdminA, partnerA]) {
      const res = await api(token, 'GET', 'review_items?select=id', { headers: H(FIRM_MAIN) });
      expect(res.status).toBe(200);
      expect(ids(res.body)).toEqual(expect.arrayContaining(MAIN_ITEMS));
      expect(ids(res.body)).not.toContain(RI.xten);
    }
  });

  it('manager sees portfolio + linked-task scope only — never unmanaged or out-of-portfolio-unlinked items', async () => {
    const res = await api(managerA, 'GET', 'review_items?select=id', { headers: H(FIRM_MAIN) });
    expect(res.status).toBe(200);
    // In scope: every C.inPortfolio item + the two task-linked C.otherManaged
    // items (RVW-07 submissions add more in-scope rows — hence containing,
    // not equality).
    expect(ids(res.body)).toEqual(expect.arrayContaining([
      RI.byPartnerIn, RI.bySeniorIn, RI.byArticleIn, RI.selfManager, RI.decideOk,
      RI.mgrTaskLink, RI.mgrReviewerLink,
    ]));
    for (const out of [RI.selfPartner, RI.selfSuper, RI.unmanaged, RI.outUnlinked, RI.xten]) {
      expect(ids(res.body)).not.toContain(out);
    }
  });

  it('senior/article see only their own submissions', async () => {
    const senior = await api(seniorA, 'GET', 'review_items?select=id,submitted_by_membership_id', {
      headers: H(FIRM_MAIN),
    });
    expect(ids(senior.body)).toEqual([RI.bySeniorIn]);
    for (const row of senior.body) expect(row.submitted_by_membership_id).toBe(M.seniorA);
    const article = await api(articleA, 'GET', 'review_items?select=id,submitted_by_membership_id', {
      headers: H(FIRM_MAIN),
    });
    expect(ids(article.body)).toEqual([RI.byArticleIn]);
    for (const row of article.body) expect(row.submitted_by_membership_id).toBe(M.articleA);
  });

  it('billing sees zero rows; anon is denied', async () => {
    const billing = await api(billingA, 'GET', 'review_items?select=id', { headers: H(FIRM_MAIN) });
    expect(billing.body).toEqual([]);
    const anon = await api('invalid-anon-token', 'GET', 'review_items?select=id', { headers: H(FIRM_MAIN) });
    expect(anon.status).toBeGreaterThanOrEqual(400);
  });
});

// ---------------------------------------------------------------------------
// TEST-RLS-RVW-12 — manager scope boundary (RLS-RVW-01 + 05 §11 note ‡)
// ---------------------------------------------------------------------------

describe('TEST-RLS-RVW-12 — manager scope boundary', () => {
  it('portfolio and both linked-task legs (assignee AND reviewer) are visible; unlinked out-of-portfolio is omitted', async () => {
    const reviewerLeg = await api(managerA, 'GET', `review_items?id=eq.${RI.mgrReviewerLink}`, {
      headers: H(FIRM_MAIN),
    });
    expect(ids(reviewerLeg.body)).toEqual([RI.mgrReviewerLink]);
    // On the other manager's portfolio client the manager sees ONLY the
    // task-linked rows — the unlinked one is omitted. No team/subordinate
    // traversal exists: managerBInA's portfolio is not managerA's scope.
    // (mgrLinkedSubmissionId is the RVW-07 task-linked submission, whose
    // server-derived client is C.otherManaged.)
    const onOther = await api(managerA, 'GET', `review_items?client_id=eq.${C.otherManaged}&select=id`, {
      headers: H(FIRM_MAIN),
    });
    expect(ids(onOther.body).sort()).toEqual([RI.mgrReviewerLink, RI.mgrTaskLink, mgrLinkedSubmissionId].sort());
    const unlinked = await api(managerA, 'GET', `review_items?id=eq.${RI.outUnlinked}`, { headers: H(FIRM_MAIN) });
    expect(unlinked.body).toEqual([]);
    const unmanaged = await api(managerA, 'GET', `review_items?id=eq.${RI.unmanaged}`, { headers: H(FIRM_MAIN) });
    expect(unmanaged.body).toEqual([]);
  });

  it('submit outside scope is denied on the uniform not_found surface', async () => {
    for (const client of [C.otherManaged, C.unmanaged]) {
      const res = await submit(managerA, FIRM_MAIN, {
        p_client_id: client, p_type: 'tds_return', p_title: 'manager out-of-scope submit',
      });
      expect(res.body).toEqual(SUBJECT_NOT_FOUND);
    }
    expect(
      psql(`select count(*) from public.review_items where title = 'manager out-of-scope submit';`).trim(),
    ).toBe('0');
  });

  it('decide outside scope is denied identically to a nonexistent id', async () => {
    for (const item of [RI.outUnlinked, RI.selfPartner, '99999999-9999-4999-8999-999999999999']) {
      const res = await decide(managerA, FIRM_MAIN, {
        p_review_item_id: item, p_decision: 'approved', p_rationale: 'out-of-scope decide',
      });
      expect(res.body).toEqual(ITEM_NOT_FOUND);
    }
  });

  it('an inconsistent task/client link grants no scope — mismatched assertions are rejected (SCH-17 subject binding)', async () => {
    // Command path: a caller-supplied client_id contradicting the linked task
    // is a validation rejection, never a silent normalization.
    const res = await submit(managerA, FIRM_MAIN, {
      p_task_id: TK.mgrAssigned, p_client_id: C.inPortfolio,
      p_type: 'tds_return', p_title: 'mismatched subject',
    });
    expect(res.body.status).toBe('denied');
    expect(res.body.kind).toBe('validation');
    expect(String(res.body.message)).toContain('client_id does not match the linked task subject');
    // Constraint layer: even the operator cannot stage a mismatched row
    // (write guard, TEST-SCH-25 backstop).
    const err = sqlError(`
      insert into public.review_items
        (id, firm_id, client_id, task_id, type, title, submitted_by_membership_id)
      values
        ('68000000-0000-4000-8000-000000000399', '${FIRM_MAIN}', '${C.inPortfolio}',
         '${TK.mgrAssigned}', 'tds_return', 'operator mismatch', '${M.partnerA}');
    `);
    // psql default verbosity omits the SQLSTATE; the raised message is the
    // assertion surface (the guard raises errcode 23514).
    expect(err).toContain('must equal the linked task client');
    expect(err).toContain('subject binding');
  });
});

// ---------------------------------------------------------------------------
// TEST-RLS-RVW-13 — self-decision prohibition (RLS-4EY-04, no rank bypass)
// ---------------------------------------------------------------------------

describe('TEST-RLS-RVW-13 — self-decision prohibition (RLS-4EY-04)', () => {
  it('manager cannot decide an item their own membership submitted', async () => {
    const res = await decide(managerA, FIRM_MAIN, {
      p_review_item_id: RI.selfManager, p_decision: 'approved', p_rationale: 'self approval attempt',
    });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('denied');
    expect(res.body.kind).toBe('unauthorized');
    expect(String(res.body.message)).toBe(FOUR_EYES_MESSAGE);
    expect(psql(`select status from public.review_items where id = '${RI.selfManager}';`).trim()).toBe('pending');
  });

  it('partner cannot decide an item their own membership submitted — no rank bypass', async () => {
    const res = await decide(partnerA, FIRM_MAIN, {
      p_review_item_id: RI.selfPartner, p_decision: 'escalated', p_rationale: 'self escalation attempt',
    });
    expect(res.body.status).toBe('denied');
    expect(res.body.kind).toBe('unauthorized');
    expect(String(res.body.message)).toBe(FOUR_EYES_MESSAGE);
    expect(psql(`select status from public.review_items where id = '${RI.selfPartner}';`).trim()).toBe('pending');
  });

  it('super_admin cannot decide an item their own membership submitted — no rank bypass', async () => {
    const res = await decide(superAdminA, FIRM_MAIN, {
      p_review_item_id: RI.selfSuper, p_decision: 'dismissed', p_rationale: 'self dismissal attempt',
    });
    expect(res.body.status).toBe('denied');
    expect(res.body.kind).toBe('unauthorized');
    expect(String(res.body.message)).toBe(FOUR_EYES_MESSAGE);
    expect(psql(`select status from public.review_items where id = '${RI.selfSuper}';`).trim()).toBe('pending');
  });
});

// ---------------------------------------------------------------------------
// TEST-RLS-RVW-14 — live membership freshness (RLS-MECH-01, DEC-J)
// ---------------------------------------------------------------------------

describe('TEST-RLS-RVW-14 — live membership freshness', () => {
  it('suspension then removal takes effect on the very next request with the SAME JWT', async () => {
    const before = await api(managerA, 'GET', 'review_items?select=id', { headers: H(FIRM_MAIN) });
    expect(before.body.length).toBeGreaterThan(0);
    const okSubmit = await submit(managerA, FIRM_MAIN, {
      p_client_id: C.inPortfolio, p_type: 'gst_reconciliation', p_title: 'RVW freshness before',
    });
    expect(okSubmit.body.status).toBe('submitted');
    try {
      psql(`update public.firm_memberships set status = 'suspended' where id = '${M.managerA}'`);
      const suspendedRead = await api(managerA, 'GET', 'review_items?select=id', { headers: H(FIRM_MAIN) });
      expect(suspendedRead.body).toEqual([]);
      const suspendedSubmit = await submit(managerA, FIRM_MAIN, {
        p_client_id: C.inPortfolio, p_type: 'tds_return', p_title: 'RVW freshness suspended',
      });
      expect(suspendedSubmit.body).toEqual(SUBJECT_NOT_FOUND);
      const suspendedDecide = await decide(managerA, FIRM_MAIN, {
        p_review_item_id: RI.bySeniorIn, p_decision: 'approved', p_rationale: 'suspended decide',
      });
      expect(suspendedDecide.body).toEqual(ITEM_NOT_FOUND);

      psql(`update public.firm_memberships set status = 'removed' where id = '${M.managerA}'`);
      const removedRead = await api(managerA, 'GET', 'review_items?select=id', { headers: H(FIRM_MAIN) });
      expect(removedRead.body).toEqual([]);
      const removedDecide = await decide(managerA, FIRM_MAIN, {
        p_review_item_id: RI.bySeniorIn, p_decision: 'approved', p_rationale: 'removed decide',
      });
      expect(removedDecide.body).toEqual(ITEM_NOT_FOUND);
    } finally {
      psql(`update public.firm_memberships set status = 'active' where id = '${M.managerA}'`);
    }
    const restored = await api(managerA, 'GET', 'review_items?select=id', { headers: H(FIRM_MAIN) });
    expect(restored.body.length).toBeGreaterThan(0);
    expect(psql(`select status from public.review_items where id = '${RI.bySeniorIn}';`).trim()).toBe('pending');
  });
});

// ---------------------------------------------------------------------------
// TEST-RLS-RVW-15 — direct decision writes closed (RLS-RVW-01: status and
// all decision fields move only through decide_review_item)
// ---------------------------------------------------------------------------

describe('TEST-RLS-RVW-15 — direct decision writes closed', () => {
  it('browser direct UPDATE of status / decided_by / decided_at / decision_rationale is denied for every role (42501)', async () => {
    for (const body of [
      { status: 'approved' },
      { status: 'returned' },
      { decided_by_membership_id: M.partnerA },
      { decided_at: '2026-09-05T00:00:00Z' },
      { decision_rationale: 'forged rationale' },
      { status: 'dismissed', decided_by_membership_id: M.superA, decision_rationale: 'combo' },
    ]) {
      for (const token of [partnerA, superAdminA, managerA]) {
        const res = await api(token, 'PATCH', `review_items?id=eq.${RI.byPartnerIn}`, {
          headers: H(FIRM_MAIN),
          body,
        });
        expect(res.status, JSON.stringify(body)).toBe(403);
        expect((res.body as { code: string }).code).toBe('42501');
      }
    }
    const intact = psql(
      `select status || '|' || coalesce(decided_by_membership_id::text, '<null>')
         || '|' || coalesce(decided_at::text, '<null>')
         || '|' || coalesce(decision_rationale, '<null>')
       from public.review_items where id = '${RI.byPartnerIn}';`,
    ).trim();
    expect(intact).toBe('pending|<null>|<null>|<null>');
  });

  it('INSERT and DELETE stay closed too — submission and decision exist only as the Layer-B commands', async () => {
    const ins = await api(partnerA, 'POST', 'review_items', {
      headers: H(FIRM_MAIN),
      body: {
        firm_id: FIRM_MAIN, client_id: C.inPortfolio, type: 'tds_return',
        title: 'closed insert', submitted_by_membership_id: M.partnerA,
      },
    });
    expect(ins.status).toBe(403);
    const del = await api(partnerA, 'DELETE', `review_items?id=eq.${RI.byPartnerIn}`, { headers: H(FIRM_MAIN) });
    expect(del.status).toBe(403);
    expect(psql(`select count(*) from public.review_items where id = '${RI.byPartnerIn}';`).trim()).toBe('1');
    expect(psql(`select count(*) from public.review_items where title = 'closed insert';`).trim()).toBe('0');
  });
});

// ---------------------------------------------------------------------------
// TEST-RLS-RVW-16 — senior/article scope (RLS-RVW-01: own-submission reads,
// assigned-work submission, never decide)
// ---------------------------------------------------------------------------

describe('TEST-RLS-RVW-16 — senior/article scope', () => {
  it('submission succeeds for work already inside current assigned-work scope', async () => {
    // Linked task where the senior is the current assignee.
    const viaTask = await submit(seniorA, FIRM_MAIN, {
      p_task_id: TK.seniorTask, p_type: 'audit_workpaper', p_title: 'RVW senior via task',
    });
    expect(viaTask.body.status).toBe('submitted');
    expect((viaTask.body.item as Record<string, unknown>).client_id).toBe(C.unmanaged);
    expect((viaTask.body.item as Record<string, unknown>).submitted_by_membership_id).toBe(M.seniorA);
    // Ad-hoc on the same client: an existing assigned task puts the client in
    // assigned-work scope (no bootstrapping needed — it is already there).
    const adhoc = await submit(seniorA, FIRM_MAIN, {
      p_client_id: C.unmanaged, p_type: 'gst_reconciliation', p_title: 'RVW senior ad-hoc in scope',
    });
    expect(adhoc.body.status).toBe('submitted');
    // Article via an assigned task.
    const viaArticleTask = await submit(articleA, FIRM_MAIN, {
      p_task_id: TK.articleTask, p_type: 'itr_computation', p_title: 'RVW article via task',
    });
    expect(viaArticleTask.body.status).toBe('submitted');
  });

  it('submission can never bootstrap access to an otherwise out-of-scope client', async () => {
    // C.otherManaged and C.inPortfolio carry NO work assigned to the senior.
    for (const client of [C.otherManaged, C.inPortfolio]) {
      const res = await submit(seniorA, FIRM_MAIN, {
        p_client_id: client, p_type: 'tds_return', p_title: 'senior bootstrap attempt',
      });
      expect(res.body).toEqual(SUBJECT_NOT_FOUND);
    }
    const articleAdhoc = await submit(articleA, FIRM_MAIN, {
      p_client_id: C.unmanaged, p_type: 'tds_return', p_title: 'article bootstrap attempt',
    });
    expect(articleAdhoc.body).toEqual(SUBJECT_NOT_FOUND);
    expect(psql(`select count(*) from public.review_items where title like '% bootstrap attempt';`).trim()).toBe('0');
  });

  it('reads stay limited to own submissions after submitting (no scope growth)', async () => {
    const senior = await api(seniorA, 'GET', 'review_items?select=id,submitted_by_membership_id', {
      headers: H(FIRM_MAIN),
    });
    expect(senior.body.length).toBeGreaterThan(0);
    for (const row of senior.body) expect(row.submitted_by_membership_id).toBe(M.seniorA);
    expect(ids(senior.body)).not.toContain(RI.byPartnerIn);
    expect(ids(senior.body)).not.toContain(RI.byArticleIn);
  });

  it('senior/article can NEVER decide — even their own visible submissions', async () => {
    const asSenior = await decide(seniorA, FIRM_MAIN, {
      p_review_item_id: RI.bySeniorIn, p_decision: 'approved', p_rationale: 'senior decide attempt',
    });
    expect(asSenior.body).toEqual(ITEM_NOT_FOUND);
    const asArticle = await decide(articleA, FIRM_MAIN, {
      p_review_item_id: RI.byArticleIn, p_decision: 'approved', p_rationale: 'article decide attempt',
    });
    expect(asArticle.body).toEqual(ITEM_NOT_FOUND);
    expect(psql(`select status from public.review_items where id in ('${RI.bySeniorIn}','${RI.byArticleIn}');`).trim())
      .toBe('pending\npending');
  });
});
