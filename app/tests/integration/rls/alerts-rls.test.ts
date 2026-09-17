/**
 * IMP-042 — alerts + alert_rules RLS integration tests (SCH-18/19,
 * RLS-ALR-01, RLS-ARL-01, RLS-AAL-01, RLS-STF-03/05/07, RLS-MECH-01,
 * RLS-CTX-01/02/03, RLS-POR-03, RLS-PRIN-01/02, API-R0-ALR, API-ERR-02).
 *
 * Exercises the REAL production policies alerts_select_scoped /
 * alert_rules_select_scoped plus the Layer-B commands acknowledge_alert /
 * snooze_alert / resolve_alert / create_alert_rule / update_alert_rule
 * through PostgREST with signed-in access tokens — never service-role for
 * authorization assertions. Service-side psql is used only for fixture
 * setup, controlled membership mutation (freshness cases), and teardown.
 *
 * Role posture under test (RLS-ALR-01 / RLS-ARL-01):
 *   alerts:  super_admin/partner/manager — firm-wide read;
 *            senior/article — alerts on assigned work ONLY, at
 *            EXACT-INSTANCE granularity (human-ruled at IMP-042
 *            pre-checkpoint correction 2026-09-06): an instance-linked
 *            alert requires the caller's live membership as
 *            assignee/reviewer of THAT instance or of an existing task
 *            tied to THAT exact instance; a client-level alert (instance
 *            NULL) requires assigned work on that client (assigned
 *            instance/task — no bootstrapping); a both-NULL alert is
 *            invisible to them;
 *            billing/suspended/removed/anon — nothing;
 *            ALL status writes are the three Layer-B commands (manager+).
 *   alert_rules: read super_admin/partner/manager (manager read-only);
 *            write super_admin/partner ONLY, AAL2-gated, via the two Layer-B
 *            admin commands; every change audited (AUD-CAT-01).
 *
 * TEST mapping (spec 11):
 *   TEST-RLS-ALR-01…13 — the 05 §14 verification cases executed against
 *   alerts (same-tenant access, cross-tenant read/insert/update/delete,
 *   unauthorized role, authorized role, suspended/removed live freshness,
 *   client-context posture, staff-context/multi-firm isolation) plus the
 *   family specifics: senior/article assigned-work scope (ALR-11) and the
 *   human-ruled exact-instance granularity proof (ALR-13 — IMP-042
 *   pre-checkpoint correction 2026-09-06), and the closed direct browser
 *   write surface;
 *   TEST-RLS-ARL-01…08 — alert_rules read role matrix, command write
 *   denial matrix (manager/senior/article/billing), AAL1-without-AAL2
 *   denial, cross-firm rule administration denial, AAL2 success path.
 *
 * Re-runnable: dedicated fixture firms in the 6c000000-… range (isolated
 * from the shared registry firms other suites clean), deterministic ids,
 * force-reset on every run; fixture and denial audit rows removed as the
 * operator in teardown, scoped to THESE firm ids only (AUD-INV-01 — the
 * append-only rule binds application roles, not the operator).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  adminDeleteFactor,
  adminListFactors,
  api,
  authPost,
  psql,
  signIn,
  totpCode,
  userEmail,
  userId,
} from '../helpers.mjs';

const H = (firm: string) => ({ 'x-active-firm': firm });

/** The ONE pre-authorization denial surface of the alert commands
 *  (API-ERR-02): nonexistent, foreign, and out-of-scope alerts all return
 *  exactly this body — no existence oracle. */
const ALERT_NOT_FOUND = {
  status: 'denied',
  kind: 'not_found',
  message: 'alert not found',
};

// This suite owns TWO dedicated firms — never the shared registry FIRM_A/B
// (other suites clean those audit logs).
const FIRM_MAIN = '6c000000-0000-4000-8000-00000000f00a';
const FIRM_XTEN = '6c000000-0000-4000-8000-00000000f00b';

const SYS_ITR = '50000000-0000-4000-8000-000000000005'; // seeded system type (entity scope)

const M = {
  superA: '6c000000-0000-4000-8000-000000000001',
  partnerA: '6c000000-0000-4000-8000-000000000002',
  managerA: '6c000000-0000-4000-8000-000000000003',
  seniorA: '6c000000-0000-4000-8000-000000000004',
  articleA: '6c000000-0000-4000-8000-000000000005',
  billingA: '6c000000-0000-4000-8000-000000000006',
  suspendedA: '6c000000-0000-4000-8000-000000000007',
  removedA: '6c000000-0000-4000-8000-000000000008',
  multiA: '6c000000-0000-4000-8000-000000000009', // USER_MULTI_FIRM in MAIN
  partnerX: '6c000000-0000-4000-8000-00000000000a', // USER_B_PARTNER in XTEN
  multiX: '6c000000-0000-4000-8000-00000000000b', // USER_MULTI_FIRM in XTEN
};
const C = {
  assigned: '6c000000-0000-4000-8000-000000000101', // senior holds an assigned instance here
  taskScoped: '6c000000-0000-4000-8000-000000000102', // article holds an assigned task here
  other: '6c000000-0000-4000-8000-000000000103', // no senior/article assignment
  taskLink: '6c000000-0000-4000-8000-000000000104', // senior/article hold instance-LINKED tasks here (TEST-RLS-ALR-13 A2)
  cmd: '6c000000-0000-4000-8000-000000000105', // manager-managed, NO senior/article assignment — dedicated AL.cmdTarget client (IMP-051 HRR-06=A)
  xten: '6c000000-0000-4000-8000-000000000111', // cross-tenant firm
};
const E = {
  assigned: '6c000000-0000-4000-8000-000000000201',
  other: '6c000000-0000-4000-8000-000000000202',
  taskScoped: '6c000000-0000-4000-8000-000000000203',
  taskLink: '6c000000-0000-4000-8000-000000000204',
  xten: '6c000000-0000-4000-8000-000000000211',
};
const I = {
  senior: '6c000000-0000-4000-8000-000000000301', // E.assigned, assignee=seniorA, reviewer=managerA
  other: '6c000000-0000-4000-8000-000000000302', // E.other, assignee=managerA
  // TEST-RLS-ALR-13 exact-instance fixtures (human-ruled IMP-042
  // pre-checkpoint correction 2026-09-06):
  seniorReview: '6c000000-0000-4000-8000-000000000303', // E.assigned, assignee=managerA, reviewer=seniorA
  notSenior: '6c000000-0000-4000-8000-000000000304', // E.assigned, assignee=managerA — same client as I.senior, NOT the senior's instance
  article: '6c000000-0000-4000-8000-000000000305', // E.taskScoped, assignee=articleA
  artRev: '6c000000-0000-4000-8000-000000000306', // E.taskScoped, assignee=managerA, reviewer=articleA
  notArticle: '6c000000-0000-4000-8000-000000000307', // E.taskScoped, assignee=managerA — same client, NOT the article's instance
  taskLink: '6c000000-0000-4000-8000-000000000308', // E.taskLink, assignee=managerA — senior/article appear ONLY via linked tasks
};
const T = {
  article: '6c000000-0000-4000-8000-000000000401', // ad-hoc C.taskScoped, assignee=articleA
  seniorLinked: '6c000000-0000-4000-8000-000000000402', // linked to I.taskLink, assignee=seniorA (not on the instance)
  articleLinkedRev: '6c000000-0000-4000-8000-000000000403', // linked to I.taskLink, assignee=managerA, reviewer=articleA
};
const RL = {
  main: '6c000000-0000-4000-8000-000000000501', // MAIN rule (requires_explicit_ack=false)
  ack: '6c000000-0000-4000-8000-000000000502', // MAIN rule (requires_explicit_ack=true)
  xten: '6c000000-0000-4000-8000-000000000511', // XTEN rule
};
const AL = {
  instAssigned: '6c000000-0000-4000-8000-000000000601', // client C.assigned + instance I.senior
  clientInstance: '6c000000-0000-4000-8000-000000000602', // client C.assigned only
  clientTask: '6c000000-0000-4000-8000-000000000603', // client C.taskScoped only
  plain: '6c000000-0000-4000-8000-000000000604', // client C.other only
  firmWide: '6c000000-0000-4000-8000-000000000605', // no client/instance
  cmdTarget: '6c000000-0000-4000-8000-000000000606', // command smoke target (mutated mid-run); client C.cmd (IMP-051 HRR-06=A)
  // TEST-RLS-ALR-13 exact-instance fixtures (human-ruled IMP-042
  // pre-checkpoint correction 2026-09-06):
  instReview: '6c000000-0000-4000-8000-000000000607', // instance I.seniorReview (senior = REVIEWER)
  instArticle: '6c000000-0000-4000-8000-000000000608', // instance I.article (article = assignee)
  instArtRev: '6c000000-0000-4000-8000-000000000609', // instance I.artRev (article = REVIEWER)
  instTask: '6c000000-0000-4000-8000-00000000060a', // instance I.taskLink (callers on LINKED TASKS only)
  instOther: '6c000000-0000-4000-8000-00000000060b', // instance I.notSenior — same client as the senior's work, different instance
  instArtOther: '6c000000-0000-4000-8000-00000000060c', // instance I.notArticle — same client as the article's work, different instance
  xten: '6c000000-0000-4000-8000-000000000611', // XTEN alert
};
const MAIN_ALERTS = [
  AL.instAssigned, AL.clientInstance, AL.clientTask, AL.plain, AL.firmWide, AL.cmdTarget,
  AL.instReview, AL.instArticle, AL.instArtRev, AL.instTask, AL.instOther, AL.instArtOther,
];

const SUPER_ADMIN_A = userId('USER_A_SUPER_ADMIN');
const PARTNER_A = userId('USER_A_PARTNER');
const MANAGER_A = userId('USER_A_MANAGER');
const SENIOR_A = userId('USER_A_SENIOR');
const ARTICLE_A = userId('USER_A_ARTICLE');
const BILLING_A = userId('USER_A_BILLING');
const SUSPENDED_A = userId('USER_A_SUSPENDED');
const REMOVED_A = userId('USER_A_REMOVED');
const MULTI = userId('USER_MULTI_FIRM');
const PARTNER_X = userId('USER_B_PARTNER');

let superAdminA: string;
let partnerA1: string; // partner A, aal1
let partnerA2: string; // partner A, aal2 (TOTP step-up)
let managerA: string;
let seniorA: string;
let articleA: string;
let billingA: string;
let suspendedA: string;
let removedA: string;
let multiFirm: string;
let partnerX: string;

const factorIds: Array<{ user: string; factor: string }> = [];

function cleanRows() {
  psql(`
    delete from public.audit_log where firm_id in ('${FIRM_MAIN}', '${FIRM_XTEN}');
    delete from public.alerts where firm_id in ('${FIRM_MAIN}', '${FIRM_XTEN}');
    delete from public.alert_rules where firm_id in ('${FIRM_MAIN}', '${FIRM_XTEN}');
    delete from public.task_comments where firm_id in ('${FIRM_MAIN}', '${FIRM_XTEN}');
    delete from public.task_checklist_items where firm_id in ('${FIRM_MAIN}', '${FIRM_XTEN}');
    delete from public.task_dependencies where firm_id in ('${FIRM_MAIN}', '${FIRM_XTEN}');
    delete from public.tasks where firm_id in ('${FIRM_MAIN}', '${FIRM_XTEN}');
    delete from public.compliance_instances where firm_id in ('${FIRM_MAIN}', '${FIRM_XTEN}');
    delete from public.client_compliance_profiles where firm_id in ('${FIRM_MAIN}', '${FIRM_XTEN}');
    delete from public.legal_entities where firm_id in ('${FIRM_MAIN}', '${FIRM_XTEN}');
    delete from public.clients where firm_id in ('${FIRM_MAIN}', '${FIRM_XTEN}');
    delete from public.firm_memberships where id in
      ('${M.superA}','${M.partnerA}','${M.managerA}','${M.seniorA}','${M.articleA}',
       '${M.billingA}','${M.suspendedA}','${M.removedA}','${M.multiA}','${M.partnerX}','${M.multiX}');
  `);
}

function seedFixture() {
  cleanRows();
  psql(`
    insert into public.firms (id, name) values
      ('${FIRM_MAIN}', 'IMP-042 ALR RLS Firm Main'),
      ('${FIRM_XTEN}', 'IMP-042 ALR RLS Firm Xten')
    on conflict (id) do nothing;

    insert into public.firm_memberships (id, firm_id, user_id, role, status) values
      ('${M.superA}',     '${FIRM_MAIN}', '${SUPER_ADMIN_A}', 'super_admin',       'active'),
      ('${M.partnerA}',   '${FIRM_MAIN}', '${PARTNER_A}',     'partner',           'active'),
      ('${M.managerA}',   '${FIRM_MAIN}', '${MANAGER_A}',     'manager',           'active'),
      ('${M.seniorA}',    '${FIRM_MAIN}', '${SENIOR_A}',      'senior',            'active'),
      ('${M.articleA}',   '${FIRM_MAIN}', '${ARTICLE_A}',     'article_executive', 'active'),
      ('${M.billingA}',   '${FIRM_MAIN}', '${BILLING_A}',     'billing',           'active'),
      ('${M.suspendedA}', '${FIRM_MAIN}', '${SUSPENDED_A}',   'senior',            'suspended'),
      ('${M.removedA}',   '${FIRM_MAIN}', '${REMOVED_A}',     'senior',            'removed'),
      ('${M.multiA}',     '${FIRM_MAIN}', '${MULTI}',         'partner',           'active'),
      ('${M.partnerX}',   '${FIRM_XTEN}', '${PARTNER_X}',     'partner',           'active'),
      ('${M.multiX}',     '${FIRM_XTEN}', '${MULTI}',         'partner',           'active')
    on conflict (firm_id, user_id) do nothing;

    -- Force-reset mutable state so re-runs are deterministic even if a
    -- previous run mutated status mid-flight (freshness cases).
    update public.firm_memberships set status = 'active'
      where id in ('${M.superA}', '${M.partnerA}', '${M.managerA}', '${M.seniorA}', '${M.articleA}');
    update public.firm_memberships set status = 'suspended' where id = '${M.suspendedA}';
    update public.firm_memberships set status = 'removed' where id = '${M.removedA}';

    insert into public.clients (id, firm_id, name, owner_partner_membership_id, manager_membership_id, status) values
      ('${C.assigned}',   '${FIRM_MAIN}', 'ALR RLS Assigned',   '${M.partnerA}', '${M.managerA}', 'active'),
      ('${C.taskScoped}', '${FIRM_MAIN}', 'ALR RLS TaskScoped', '${M.partnerA}', null,            'active'),
      ('${C.other}',      '${FIRM_MAIN}', 'ALR RLS Other',      '${M.partnerA}', '${M.managerA}', 'active'),
      ('${C.taskLink}',   '${FIRM_MAIN}', 'ALR RLS TaskLink',   '${M.partnerA}', null,            'active'),
      ('${C.cmd}',        '${FIRM_MAIN}', 'ALR RLS Cmd',        '${M.partnerA}', '${M.managerA}', 'active'),
      ('${C.xten}',       '${FIRM_XTEN}', 'ALR RLS Xten',       '${M.partnerX}', null,            'active');

    insert into public.legal_entities (id, firm_id, client_id, entity_type, legal_name) values
      ('${E.assigned}',   '${FIRM_MAIN}', '${C.assigned}',   'private_limited', 'ALR Entity Assigned'),
      ('${E.other}',      '${FIRM_MAIN}', '${C.other}',      'llp',             'ALR Entity Other'),
      ('${E.taskScoped}', '${FIRM_MAIN}', '${C.taskScoped}', 'private_limited', 'ALR Entity TaskScoped'),
      ('${E.taskLink}',   '${FIRM_MAIN}', '${C.taskLink}',   'llp',             'ALR Entity TaskLink'),
      ('${E.xten}',       '${FIRM_XTEN}', '${C.xten}',       'private_limited', 'ALR Entity Xten');

    insert into public.compliance_instances
      (id, firm_id, legal_entity_id, compliance_type_id, period_start, period_end,
       period_label, due_date, assignee_membership_id, reviewer_membership_id)
    values
      ('${I.senior}',       '${FIRM_MAIN}', '${E.assigned}',   '${SYS_ITR}', '2026-04-01', '2026-06-30', 'FY26 Q1', '2026-07-31', '${M.seniorA}',  '${M.managerA}'),
      ('${I.other}',        '${FIRM_MAIN}', '${E.other}',      '${SYS_ITR}', '2026-04-01', '2026-06-30', 'FY26 Q1', '2026-07-31', '${M.managerA}', null),
      ('${I.seniorReview}', '${FIRM_MAIN}', '${E.assigned}',   '${SYS_ITR}', '2026-07-01', '2026-09-30', 'FY26 Q2', '2026-10-31', '${M.managerA}', '${M.seniorA}'),
      ('${I.notSenior}',    '${FIRM_MAIN}', '${E.assigned}',   '${SYS_ITR}', '2026-10-01', '2026-12-31', 'FY26 Q3', '2027-01-31', '${M.managerA}', null),
      ('${I.article}',      '${FIRM_MAIN}', '${E.taskScoped}', '${SYS_ITR}', '2026-04-01', '2026-06-30', 'FY26 Q1', '2026-07-31', '${M.articleA}', null),
      ('${I.artRev}',       '${FIRM_MAIN}', '${E.taskScoped}', '${SYS_ITR}', '2026-07-01', '2026-09-30', 'FY26 Q2', '2026-10-31', '${M.managerA}', '${M.articleA}'),
      ('${I.notArticle}',   '${FIRM_MAIN}', '${E.taskScoped}', '${SYS_ITR}', '2026-10-01', '2026-12-31', 'FY26 Q3', '2027-01-31', '${M.managerA}', null),
      ('${I.taskLink}',     '${FIRM_MAIN}', '${E.taskLink}',   '${SYS_ITR}', '2026-04-01', '2026-06-30', 'FY26 Q1', '2026-07-31', '${M.managerA}', null);

    insert into public.tasks
      (id, firm_id, client_id, compliance_instance_id, title, next_action, assignee_membership_id, reviewer_membership_id)
    values
      ('${T.article}',          '${FIRM_MAIN}', '${C.taskScoped}', null,            'ALR article task',        'collect docs',   '${M.articleA}', null),
      ('${T.seniorLinked}',     '${FIRM_MAIN}', '${C.taskLink}',   '${I.taskLink}', 'ALR senior linked task',  'prepare filing',  '${M.seniorA}',  null),
      ('${T.articleLinkedRev}', '${FIRM_MAIN}', '${C.taskLink}',   '${I.taskLink}', 'ALR article review task', 'review filing',   '${M.managerA}', '${M.articleA}');

    insert into public.alert_rules (id, firm_id, rule_key, name, severity, requires_explicit_ack) values
      ('${RL.main}', '${FIRM_MAIN}', 'filing_due_soon',  'Filing due soon',      'warning',  false),
      ('${RL.ack}',  '${FIRM_MAIN}', 'risk_escalation',  'Risk escalation',      'critical', true),
      ('${RL.xten}', '${FIRM_XTEN}', 'filing_due_soon',  'Filing due soon (X)',  'warning',  false);

    -- Active alert rows are plain operator inserts (no command marker
    -- needed); status/raised_at take their defaults.
    insert into public.alerts
      (id, firm_id, alert_rule_id, severity, title, client_id, compliance_instance_id)
    values
      ('${AL.instAssigned}',   '${FIRM_MAIN}', '${RL.main}', 'warning',  'ALR instance-assigned',  '${C.assigned}',   '${I.senior}'),
      ('${AL.clientInstance}', '${FIRM_MAIN}', '${RL.main}', 'info',     'ALR client-instance',    '${C.assigned}',   null),
      ('${AL.clientTask}',     '${FIRM_MAIN}', null,         'info',     'ALR client-task',        '${C.taskScoped}', null),
      ('${AL.plain}',          '${FIRM_MAIN}', '${RL.main}', 'critical', 'ALR plain',              '${C.other}',      null),
      ('${AL.firmWide}',       '${FIRM_MAIN}', '${RL.ack}',  'critical', 'ALR firm-wide',          null,              null),
      -- IMP-051 HRR-06=A — distinct client identity so AL.plain (C.other) and
      -- AL.cmdTarget (C.cmd) are structurally valid under the dedupe index.
      -- (The rule dimension could not be used: FIRM_MAIN's rule set is pinned
      -- to [RL.main, RL.ack] by TEST-RLS-ALR-10 / TEST-RLS-ARL-01 assertions.)
      ('${AL.cmdTarget}',      '${FIRM_MAIN}', '${RL.main}', 'warning',  'ALR command target',     '${C.cmd}',        null),
      ('${AL.instReview}',     '${FIRM_MAIN}', '${RL.main}', 'warning',  'ALR instance-reviewed',  '${C.assigned}',   '${I.seniorReview}'),
      ('${AL.instArticle}',    '${FIRM_MAIN}', '${RL.main}', 'info',     'ALR instance-article',   '${C.taskScoped}', '${I.article}'),
      ('${AL.instArtRev}',     '${FIRM_MAIN}', '${RL.main}', 'info',     'ALR instance-art-rev',   '${C.taskScoped}', '${I.artRev}'),
      ('${AL.instTask}',       '${FIRM_MAIN}', '${RL.main}', 'warning',  'ALR instance-task',      '${C.taskLink}',   '${I.taskLink}'),
      ('${AL.instOther}',      '${FIRM_MAIN}', '${RL.main}', 'critical', 'ALR instance-other',     '${C.assigned}',   '${I.notSenior}'),
      ('${AL.instArtOther}',   '${FIRM_MAIN}', '${RL.main}', 'info',     'ALR instance-art-other', '${C.taskScoped}', '${I.notArticle}'),
      ('${AL.xten}',           '${FIRM_XTEN}', '${RL.xten}', 'warning',  'ALR cross-tenant',       '${C.xten}',       null);
  `);
  // Fixture writes are operator/system-actor rows; remove fixture noise so
  // denial-by-side-effect checks read a clean table (IMP-031/040/041
  // precedent).
  psql(`delete from public.audit_log where firm_id in ('${FIRM_MAIN}', '${FIRM_XTEN}')`);
}

/** aal1 session + TOTP enrol/challenge/verify -> aal2 (IMP-030 precedent). */
async function makeAal2(userKey: string): Promise<{ aal1: string; aal2: string }> {
  const session = await signIn(userEmail(userKey));
  if (!session.ok) throw new Error(`sign-in failed for ${userKey}: ${JSON.stringify(session.raw)}`);
  const enroll = await authPost('factors', { factor_type: 'totp', friendly_name: `imp042-rls-${userKey}` }, session.token);
  if (enroll.status !== 200) throw new Error(`enroll failed: ${JSON.stringify(enroll.body)}`);
  const factorId = enroll.body.id as string;
  factorIds.push({ user: userId(userKey), factor: factorId });
  const challenge = await authPost(`factors/${factorId}/challenge`, {}, session.token);
  const verify = await authPost(
    `factors/${factorId}/verify`,
    { challenge_id: challenge.body.id, code: totpCode(enroll.body.totp.secret) },
    session.token,
  );
  if (verify.status !== 200 || !verify.body.access_token) {
    throw new Error(`verify failed: ${JSON.stringify(verify.body)}`);
  }
  return { aal1: session.token, aal2: verify.body.access_token };
}

beforeAll(async () => {
  seedFixture();
  const partner = await makeAal2('USER_A_PARTNER');
  partnerA1 = partner.aal1;
  partnerA2 = partner.aal2;
  for (const [key, set] of [
    ['USER_A_SUPER_ADMIN', (t: string) => (superAdminA = t)],
    ['USER_A_MANAGER', (t: string) => (managerA = t)],
    ['USER_A_SENIOR', (t: string) => (seniorA = t)],
    ['USER_A_ARTICLE', (t: string) => (articleA = t)],
    ['USER_A_BILLING', (t: string) => (billingA = t)],
    ['USER_A_SUSPENDED', (t: string) => (suspendedA = t)],
    ['USER_A_REMOVED', (t: string) => (removedA = t)],
    ['USER_MULTI_FIRM', (t: string) => (multiFirm = t)],
    ['USER_B_PARTNER', (t: string) => (partnerX = t)],
  ] as Array<[string, (t: string) => void]>) {
    const s = await signIn(userEmail(key));
    if (!s.ok) throw new Error(`sign-in failed for ${key}: ${JSON.stringify(s.raw)}`);
    set(s.token);
  }
});

afterAll(async () => {
  try {
    for (const { user, factor } of factorIds) await adminDeleteFactor(user, factor);
    const factors = await adminListFactors(PARTNER_A);
    for (const f of factors) await adminDeleteFactor(PARTNER_A, f.id);
  } finally {
    // Child rows first — the membership/firm deletes would otherwise trip
    // the hierarchy FKs, and leaving rows behind poisons the next suite in
    // the sequential chain.
    cleanRows();
    psql(`
      delete from public.firms where id in ('${FIRM_MAIN}', '${FIRM_XTEN}')
        and not exists (select 1 from public.firm_memberships m where m.firm_id = firms.id)
        and not exists (select 1 from public.clients c where c.firm_id = firms.id);
    `);
  }
});

const ids = (body: Array<{ id: string }>) => body.map((r) => r.id);

// ---------------------------------------------------------------------------
// TEST-RLS-ALR-01 — same-tenant authorized access succeeds (05 §14 case 1)
// ---------------------------------------------------------------------------

describe('TEST-RLS-ALR-01 — same-tenant authorized access succeeds', () => {
  it('manager+ read the full firm alert set; senior/article read assigned-work alerts only (exact-instance granularity)', async () => {
    for (const token of [superAdminA, partnerA1, managerA]) {
      const res = await api(token, 'GET', 'alerts?select=id', { headers: H(FIRM_MAIN) });
      expect(res.status).toBe(200);
      expect(ids(res.body).sort()).toEqual([...MAIN_ALERTS].sort());
    }
    // senior (human-ruled exact-instance granularity, IMP-042
    // pre-checkpoint correction 2026-09-06): the instance the senior
    // ASSIGNEEs (AL.instAssigned), the instance the senior REVIEWs
    // (AL.instReview), the instance the senior holds a linked TASK on
    // (AL.instTask), plus the client-level alert on the client holding
    // that assigned work (AL.clientInstance). AL.instOther — an alert on a
    // DIFFERENT instance of the same client — is NOT visible (the inverted
    // pre-correction case; TEST-RLS-ALR-13 case B proves it directly).
    const asSenior = await api(seniorA, 'GET', 'alerts?select=id', { headers: H(FIRM_MAIN) });
    expect(asSenior.status).toBe(200);
    expect(ids(asSenior.body).sort()).toEqual(
      [AL.instAssigned, AL.instReview, AL.instTask, AL.clientInstance].sort(),
    );
    // article: the client-level alert on the task-scoped client
    // (AL.clientTask), the instance the article assignees (AL.instArticle),
    // the instance the article reviews (AL.instArtRev), and the instance the
    // article holds a linked reviewer task on (AL.instTask). AL.instArtOther
    // — same client, different instance — is NOT visible.
    const asArticle = await api(articleA, 'GET', 'alerts?select=id', { headers: H(FIRM_MAIN) });
    expect(asArticle.status).toBe(200);
    expect(ids(asArticle.body).sort()).toEqual(
      [AL.clientTask, AL.instArticle, AL.instArtRev, AL.instTask].sort(),
    );
  });
});

// ---------------------------------------------------------------------------
// TEST-RLS-ALR-02 — cross-tenant read fails (05 §14 case 2)
// ---------------------------------------------------------------------------

describe('TEST-RLS-ALR-02 — cross-tenant read fails', () => {
  it('known foreign ids are indistinguishable from nonexistent, both directions', async () => {
    const asMain = await api(partnerA1, 'GET', `alerts?id=eq.${AL.xten}`, { headers: H(FIRM_MAIN) });
    expect(asMain.status).toBe(200);
    expect(asMain.body).toEqual([]);
    const asXten = await api(partnerX, 'GET', `alerts?id=eq.${AL.plain}`, { headers: H(FIRM_XTEN) });
    expect(asXten.body).toEqual([]);
    const xtenAll = await api(partnerX, 'GET', 'alerts?select=id', { headers: H(FIRM_XTEN) });
    expect(ids(xtenAll.body)).toEqual([AL.xten]);
  });

  it('a forged selector selects nothing without a live membership there (RLS-CTX-02)', async () => {
    const forged = await api(partnerA1, 'GET', 'alerts?select=id', { headers: H(FIRM_XTEN) });
    expect(forged.status).toBe(200);
    expect(forged.body).toEqual([]);
    const forgedRules = await api(partnerA1, 'GET', 'alert_rules?select=id', { headers: H(FIRM_XTEN) });
    expect(forgedRules.body).toEqual([]);
  });

  it('cross-tenant command calls share the uniform not_found surface (API-ERR-02)', async () => {
    const ackForeign = await api(partnerA1, 'POST', 'rpc/acknowledge_alert', {
      headers: H(FIRM_MAIN), body: { p_alert_id: AL.xten },
    });
    expect(ackForeign.body).toEqual(ALERT_NOT_FOUND);
    const resolveForgedSelector = await api(partnerA1, 'POST', 'rpc/resolve_alert', {
      headers: H(FIRM_XTEN), body: { p_alert_id: AL.plain },
    });
    expect(resolveForgedSelector.body).toEqual(ALERT_NOT_FOUND);
  });
});

// ---------------------------------------------------------------------------
// TEST-RLS-ALR-03/04/05 — cross-tenant insert/update/delete fail: the direct
// browser write surface is CLOSED on both tables (05 §14 cases 3–5)
// ---------------------------------------------------------------------------

describe('TEST-RLS-ALR-03/04/05 — direct browser writes are closed (INSERT/UPDATE/DELETE)', () => {
  it('alerts: direct INSERT/UPDATE/DELETE are not granted at all — even to a same-firm super_admin (42501)', async () => {
    const insert = await api(superAdminA, 'POST', 'alerts', {
      headers: H(FIRM_MAIN),
      body: { firm_id: FIRM_MAIN, severity: 'info', title: 'direct insert' },
    });
    expect(insert.status).toBe(403);
    expect((insert.body as { code: string }).code).toBe('42501');

    const update = await api(superAdminA, 'PATCH', `alerts?id=eq.${AL.plain}`, {
      headers: H(FIRM_MAIN), body: { title: 'direct update' },
    });
    expect(update.status).toBe(403);
    expect((update.body as { code: string }).code).toBe('42501');

    const del = await api(superAdminA, 'DELETE', `alerts?id=eq.${AL.plain}`, { headers: H(FIRM_MAIN) });
    expect(del.status).toBe(403);
    expect((del.body as { code: string }).code).toBe('42501');

    // Status movement is guarded even for operator-class paths without the
    // command marker — asserted at the schema layer (TEST-SCH-29); the row
    // is unchanged here.
    expect(psql(`select title from public.alerts where id = '${AL.plain}';`).trim()).toBe('ALR plain');
  });

  it('alert_rules: direct INSERT/UPDATE/DELETE are not granted at all — even to an aal2 partner (42501)', async () => {
    const insert = await api(partnerA2, 'POST', 'alert_rules', {
      headers: H(FIRM_MAIN),
      body: { firm_id: FIRM_MAIN, rule_key: 'direct', name: 'direct insert', severity: 'info' },
    });
    expect(insert.status).toBe(403);
    expect((insert.body as { code: string }).code).toBe('42501');

    const update = await api(partnerA2, 'PATCH', `alert_rules?id=eq.${RL.main}`, {
      headers: H(FIRM_MAIN), body: { enabled: false },
    });
    expect(update.status).toBe(403);
    expect((update.body as { code: string }).code).toBe('42501');

    const del = await api(partnerA2, 'DELETE', `alert_rules?id=eq.${RL.main}`, { headers: H(FIRM_MAIN) });
    expect(del.status).toBe(403);
    expect((del.body as { code: string }).code).toBe('42501');

    expect(psql(`select enabled from public.alert_rules where id = '${RL.main}';`).trim()).toBe('t');
  });
});

// ---------------------------------------------------------------------------
// TEST-RLS-ALR-06/07 — unauthorized role gets nothing; authorized roles get
// their scope (05 §14 cases 6–7)
// ---------------------------------------------------------------------------

describe('TEST-RLS-ALR-06/07 — role posture', () => {
  it('billing reads NO alerts and NO alert rules (RLS-STF-05)', async () => {
    const alerts = await api(billingA, 'GET', 'alerts?select=id', { headers: H(FIRM_MAIN) });
    expect(alerts.status).toBe(200);
    expect(alerts.body).toEqual([]);
    const rules = await api(billingA, 'GET', 'alert_rules?select=id', { headers: H(FIRM_MAIN) });
    expect(rules.body).toEqual([]);
  });

  it('billing can know the client via the identity projection (RLS-A-04) yet still reads zero alerts for it', async () => {
    const identities = await api(billingA, 'POST', 'rpc/list_client_identities', {
      headers: H(FIRM_MAIN), body: { p_firm_id: FIRM_MAIN },
    });
    expect(identities.status).toBe(200);
    const known = (identities.body as Array<{ id: string }>).map((r) => r.id);
    expect(known).toContain(C.other);
    // Knowing the client id — and even a known-existing alert id on that
    // client — buys nothing on the alert surface.
    const byClient = await api(billingA, 'GET', `alerts?client_id=eq.${C.other}&select=id`, { headers: H(FIRM_MAIN) });
    expect(byClient.status).toBe(200);
    expect(byClient.body).toEqual([]);
    const byId = await api(billingA, 'GET', `alerts?id=eq.${AL.plain}&select=id`, { headers: H(FIRM_MAIN) });
    expect(byId.body).toEqual([]);
  });

  it('billing/senior/article command calls are denied on the uniform not_found surface (manager+ only)', async () => {
    for (const [label, token] of [['billing', billingA], ['senior', seniorA], ['article', articleA]] as Array<[string, string]>) {
      const ack = await api(token, 'POST', 'rpc/acknowledge_alert', {
        headers: H(FIRM_MAIN), body: { p_alert_id: AL.cmdTarget },
      });
      expect(ack.body, label).toEqual(ALERT_NOT_FOUND);
      const resolve = await api(token, 'POST', 'rpc/resolve_alert', {
        headers: H(FIRM_MAIN), body: { p_alert_id: AL.cmdTarget },
      });
      expect(resolve.body, label).toEqual(ALERT_NOT_FOUND);
      // … even against an alert the role CAN read (senior assigned-work
      // scope is read-only, RLS-ALR-01).
      const ackVisible = await api(token, 'POST', 'rpc/acknowledge_alert', {
        headers: H(FIRM_MAIN), body: { p_alert_id: AL.instAssigned },
      });
      expect(ackVisible.body, `${label} visible`).toEqual(ALERT_NOT_FOUND);
    }
    // manager+ CAN transition (the success half of the posture).
    const ack = await api(managerA, 'POST', 'rpc/acknowledge_alert', {
      headers: H(FIRM_MAIN), body: { p_alert_id: AL.cmdTarget },
    });
    expect(ack.status).toBe(200);
    expect((ack.body as { status: string }).status).toBe('acknowledged');
  });
});

// ---------------------------------------------------------------------------
// TEST-RLS-ALR-08 — suspended/removed memberships lose access live (DEC-J,
// RLS-MECH-01, RLS-STF-07; 05 §14 case 8)
// ---------------------------------------------------------------------------

describe('TEST-RLS-ALR-08 — live-membership freshness', () => {
  it('suspended/removed members read nothing on the same JWT', async () => {
    for (const [label, token] of [['suspended', suspendedA], ['removed', removedA]] as Array<[string, string]>) {
      const res = await api(token, 'GET', 'alerts?select=id', { headers: H(FIRM_MAIN) });
      expect(res.body, label).toEqual([]);
      const rules = await api(token, 'GET', 'alert_rules?select=id', { headers: H(FIRM_MAIN) });
      expect(rules.body, label).toEqual([]);
    }
  });

  it('suspending a manager revokes read AND command on the next request with the same JWT', async () => {
    const before = await api(managerA, 'GET', 'alerts?select=id', { headers: H(FIRM_MAIN) });
    expect(before.body.length).toBeGreaterThan(0);
    psql(`update public.firm_memberships set status = 'suspended' where id = '${M.managerA}';`);
    try {
      const after = await api(managerA, 'GET', 'alerts?select=id', { headers: H(FIRM_MAIN) });
      expect(after.status).toBe(200);
      expect(after.body).toEqual([]);
      const rules = await api(managerA, 'GET', 'alert_rules?select=id', { headers: H(FIRM_MAIN) });
      expect(rules.body).toEqual([]);
      const ack = await api(managerA, 'POST', 'rpc/acknowledge_alert', {
        headers: H(FIRM_MAIN), body: { p_alert_id: AL.plain },
      });
      expect(ack.body).toEqual(ALERT_NOT_FOUND);
    } finally {
      psql(`update public.firm_memberships set status = 'active' where id = '${M.managerA}';`);
    }
    const restored = await api(managerA, 'GET', 'alerts?select=id', { headers: H(FIRM_MAIN) });
    expect(restored.body.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// TEST-RLS-ALR-09 — client-context posture: no active-firm selector, no rows
// (RLS-CTX-01/02; 05 §14 case 9)
// ---------------------------------------------------------------------------

describe('TEST-RLS-ALR-09 — client-context posture', () => {
  it('without the x-active-firm selector even a partner reads nothing', async () => {
    const alerts = await api(partnerA1, 'GET', 'alerts?select=id');
    expect(alerts.status).toBe(200);
    expect(alerts.body).toEqual([]);
    const rules = await api(partnerA1, 'GET', 'alert_rules?select=id');
    expect(rules.body).toEqual([]);
    // Commands without the selector land on the same uniform surface.
    const ack = await api(partnerA1, 'POST', 'rpc/acknowledge_alert', { body: { p_alert_id: AL.plain } });
    expect(ack.body).toEqual(ALERT_NOT_FOUND);
  });
});

// ---------------------------------------------------------------------------
// TEST-RLS-ALR-10 — staff-context / multi-firm isolation (05 §14 case 10)
// ---------------------------------------------------------------------------

describe('TEST-RLS-ALR-10 — multi-firm isolation', () => {
  it('a multi-firm partner sees exactly the selected firm’s alerts and rules', async () => {
    const main = await api(multiFirm, 'GET', 'alerts?select=id', { headers: H(FIRM_MAIN) });
    expect(ids(main.body).sort()).toEqual([...MAIN_ALERTS].sort());
    const xten = await api(multiFirm, 'GET', 'alerts?select=id', { headers: H(FIRM_XTEN) });
    expect(ids(xten.body)).toEqual([AL.xten]);
    const mainRules = await api(multiFirm, 'GET', 'alert_rules?select=id', { headers: H(FIRM_MAIN) });
    expect(ids(mainRules.body).sort()).toEqual([RL.main, RL.ack].sort());
    const xtenRules = await api(multiFirm, 'GET', 'alert_rules?select=id', { headers: H(FIRM_XTEN) });
    expect(ids(xtenRules.body)).toEqual([RL.xten]);
  });
});

// ---------------------------------------------------------------------------
// TEST-RLS-ALR-11 — senior/article assigned-work scope boundary (RLS-ALR-01)
// ---------------------------------------------------------------------------

describe('TEST-RLS-ALR-11 — senior/article assigned-work-only scope', () => {
  it('out-of-scope alert ids return [] (not errors) for senior/article — no existence oracle', async () => {
    // AL.plain/AL.firmWide/AL.cmdTarget: no assigned work at all behind
    // them. AL.instOther/AL.instArtOther: assigned work on the CLIENT but
    // the alert is linked to a DIFFERENT instance — out of scope under the
    // human-ruled exact-instance granularity (IMP-042 pre-checkpoint
    // correction 2026-09-06; TEST-RLS-ALR-13 case B is the direct proof).
    for (const alertId of [AL.plain, AL.firmWide, AL.cmdTarget, AL.instOther, AL.instArtOther]) {
      const asSenior = await api(seniorA, 'GET', `alerts?id=eq.${alertId}`, { headers: H(FIRM_MAIN) });
      expect(asSenior.body, `senior ${alertId}`).toEqual([]);
      const asArticle = await api(articleA, 'GET', `alerts?id=eq.${alertId}`, { headers: H(FIRM_MAIN) });
      expect(asArticle.body, `article ${alertId}`).toEqual([]);
    }
    // article does NOT inherit the senior's instance assignment and vice
    // versa.
    const articleOnSeniorWork = await api(articleA, 'GET', `alerts?id=eq.${AL.instAssigned}`, { headers: H(FIRM_MAIN) });
    expect(articleOnSeniorWork.body).toEqual([]);
    const articleOnSeniorReview = await api(articleA, 'GET', `alerts?id=eq.${AL.instReview}`, { headers: H(FIRM_MAIN) });
    expect(articleOnSeniorReview.body).toEqual([]);
    const seniorOnArticleWork = await api(seniorA, 'GET', `alerts?id=eq.${AL.clientTask}`, { headers: H(FIRM_MAIN) });
    expect(seniorOnArticleWork.body).toEqual([]);
    const seniorOnArticleInstance = await api(seniorA, 'GET', `alerts?id=eq.${AL.instArticle}`, { headers: H(FIRM_MAIN) });
    expect(seniorOnArticleInstance.body).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// TEST-RLS-ALR-12 — anon / unauthenticated posture (RLS-SVC-03, RLS-POR-03)
// ---------------------------------------------------------------------------

describe('TEST-RLS-ALR-12 — anon posture', () => {
  it('anon has NO table privilege at all (RLS-SVC-03): 401/42501 permission-denied, zero rows; an invalid token is a plain 401', async () => {
    const { localEnv } = await import('../helpers.mjs');
    const { API_URL, ANON_KEY } = localEnv();
    for (const table of ['alerts', 'alert_rules']) {
      const res = await fetch(`${API_URL}/rest/v1/${table}?select=id`, {
        headers: { apikey: ANON_KEY, 'x-active-firm': FIRM_MAIN },
      });
      expect(res.status, table).toBe(401); // unauthenticated + grantless → permission denied
      const body = (await res.json()) as { code?: string };
      expect(body.code, table).toBe('42501');
    }
    const bad = await api('invalid-anon-token', 'GET', 'alerts?select=id', { headers: H(FIRM_MAIN) });
    expect(bad.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// TEST-RLS-ALR-13 — exact-instance alert granularity (RLS-ALR-01, human-ruled
// at IMP-042 pre-checkpoint correction 2026-09-06): an instance-linked alert
// is visible to senior/article ONLY through exact-instance relations; the
// pre-correction client-granular treatment of instance-linked alerts was
// ruled TOO BROAD. Letters A/A2/B/C/D/E are the ruled case set; F (manager+
// firm-wide) is TEST-RLS-ALR-01, G (billing none) is TEST-RLS-ALR-06/07,
// H (cross-firm none) is TEST-RLS-ALR-02 — all kept green above.
// ---------------------------------------------------------------------------

describe('TEST-RLS-ALR-13 — exact-instance alert granularity (human-ruled correction)', () => {
  it('case A: the instance ASSIGNEE and (separately) the instance REVIEWER read the exact-instance alert', async () => {
    // senior: assignee of I.senior, reviewer of I.seniorReview.
    const seniorAssignee = await api(seniorA, 'GET', `alerts?id=eq.${AL.instAssigned}&select=id`, { headers: H(FIRM_MAIN) });
    expect(ids(seniorAssignee.body)).toEqual([AL.instAssigned]);
    const seniorReviewer = await api(seniorA, 'GET', `alerts?id=eq.${AL.instReview}&select=id`, { headers: H(FIRM_MAIN) });
    expect(ids(seniorReviewer.body)).toEqual([AL.instReview]);
    // article: assignee of I.article, reviewer of I.artRev.
    const articleAssignee = await api(articleA, 'GET', `alerts?id=eq.${AL.instArticle}&select=id`, { headers: H(FIRM_MAIN) });
    expect(ids(articleAssignee.body)).toEqual([AL.instArticle]);
    const articleReviewer = await api(articleA, 'GET', `alerts?id=eq.${AL.instArtRev}&select=id`, { headers: H(FIRM_MAIN) });
    expect(ids(articleReviewer.body)).toEqual([AL.instArtRev]);
  });

  it('case A2: assignee/reviewer of a TASK tied to the exact instance (but not on the instance itself) reads the alert', async () => {
    // Fixture truth (operator inspection only): I.taskLink's instance
    // assignee/reviewer is the manager alone — neither the senior nor the
    // article is ON the instance; their only relation is the linked tasks
    // T.seniorLinked (assignee) / T.articleLinkedRev (reviewer).
    const instanceRow = psql(
      `select assignee_membership_id || ':' || coalesce(reviewer_membership_id::text, 'null')
       from public.compliance_instances where id = '${I.taskLink}';`,
    ).trim();
    expect(instanceRow).toBe(`${M.managerA}:null`);
    expect(
      psql(`select assignee_membership_id || ':' || coalesce(reviewer_membership_id::text, 'null')
            from public.tasks where id = '${T.seniorLinked}';`).trim(),
    ).toBe(`${M.seniorA}:null`);
    expect(
      psql(`select assignee_membership_id || ':' || coalesce(reviewer_membership_id::text, 'null')
            from public.tasks where id = '${T.articleLinkedRev}';`).trim(),
    ).toBe(`${M.managerA}:${M.articleA}`);
    // … and both read the instance-linked alert through those tasks.
    const asSenior = await api(seniorA, 'GET', `alerts?id=eq.${AL.instTask}&select=id`, { headers: H(FIRM_MAIN) });
    expect(ids(asSenior.body)).toEqual([AL.instTask]);
    const asArticle = await api(articleA, 'GET', `alerts?id=eq.${AL.instTask}&select=id`, { headers: H(FIRM_MAIN) });
    expect(ids(asArticle.body)).toEqual([AL.instTask]);
  });

  it('case B (the INVERTED pre-correction case): assigned work on the same client but NOT the linked instance → invisible', async () => {
    // The senior has assigned work on C.assigned (I.senior, I.seniorReview)
    // but NOT on I.notSenior; the article has assigned work on C.taskScoped
    // (T.article, I.article, I.artRev) but NOT on I.notArticle. Under the
    // pre-correction client-granular branch both alerts were readable; the
    // human ruling (IMP-042 pre-checkpoint correction 2026-09-06) makes
    // them invisible.
    const seniorWrongInstance = await api(seniorA, 'GET', `alerts?id=eq.${AL.instOther}&select=id`, { headers: H(FIRM_MAIN) });
    expect(seniorWrongInstance.body).toEqual([]);
    const articleWrongInstance = await api(articleA, 'GET', `alerts?id=eq.${AL.instArtOther}&select=id`, { headers: H(FIRM_MAIN) });
    expect(articleWrongInstance.body).toEqual([]);
  });

  it('case C: a client-level alert (instance NULL, client set) stays readable with assigned work on that client', async () => {
    const senior = await api(seniorA, 'GET', `alerts?id=eq.${AL.clientInstance}&select=id`, { headers: H(FIRM_MAIN) });
    expect(ids(senior.body)).toEqual([AL.clientInstance]);
    const article = await api(articleA, 'GET', `alerts?id=eq.${AL.clientTask}&select=id`, { headers: H(FIRM_MAIN) });
    expect(ids(article.body)).toEqual([AL.clientTask]);
  });

  it('case D: no assigned work on the client → the client-level alert is hidden', async () => {
    // C.other holds no senior/article assignment of any kind.
    for (const [label, token] of [['senior', seniorA], ['article', articleA]] as Array<[string, string]>) {
      const res = await api(token, 'GET', `alerts?id=eq.${AL.plain}&select=id`, { headers: H(FIRM_MAIN) });
      expect(res.body, label).toEqual([]);
    }
  });

  it('case E: a both-NULL alert (no client, no instance) is invisible to senior/article', async () => {
    for (const [label, token] of [['senior', seniorA], ['article', articleA]] as Array<[string, string]>) {
      const res = await api(token, 'GET', `alerts?id=eq.${AL.firmWide}&select=id`, { headers: H(FIRM_MAIN) });
      expect(res.body, label).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
// TEST-RLS-ARL-01 — alert_rules read role matrix (RLS-ARL-01)
// ---------------------------------------------------------------------------

describe('TEST-RLS-ARL-01 — alert_rules read scope', () => {
  it('super_admin/partner/manager read firm rules; senior/article/billing read none; cross-firm zero', async () => {
    for (const token of [superAdminA, partnerA1, managerA]) {
      const res = await api(token, 'GET', 'alert_rules?select=id', { headers: H(FIRM_MAIN) });
      expect(res.status).toBe(200);
      expect(ids(res.body).sort()).toEqual([RL.main, RL.ack].sort());
    }
    for (const token of [seniorA, articleA, billingA]) {
      const res = await api(token, 'GET', 'alert_rules?select=id', { headers: H(FIRM_MAIN) });
      expect(res.body).toEqual([]);
    }
    const cross = await api(partnerX, 'GET', `alert_rules?id=eq.${RL.main}`, { headers: H(FIRM_XTEN) });
    expect(cross.body).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// TEST-RLS-ARL-02…05 — rule administration command authorization (RLS-ARL-01,
// RLS-AAL-01)
// ---------------------------------------------------------------------------

describe('TEST-RLS-ARL-02 — rule admin denied for manager/senior/article/billing', () => {
  it('create_alert_rule is super_admin/partner-only — every other role is unauthorized', async () => {
    for (const [label, token] of [
      ['manager', managerA], ['senior', seniorA], ['article', articleA], ['billing', billingA],
    ] as Array<[string, string]>) {
      const res = await api(token, 'POST', 'rpc/create_alert_rule', {
        headers: H(FIRM_MAIN),
        body: { p_rule_key: `denied-${label}`, p_name: 'denied', p_severity: 'info' },
      });
      expect((res.body as { status: string }).status, label).toBe('denied');
      expect((res.body as { kind: string }).kind, label).toBe('unauthorized');
    }
    const upd = await api(managerA, 'POST', 'rpc/update_alert_rule', {
      headers: H(FIRM_MAIN),
      body: { p_rule_id: RL.main, p_name: 'manager edit', p_severity: 'info' },
    });
    expect((upd.body as { kind: string }).kind).toBe('unauthorized');
    // Nothing was written.
    expect(psql(`select count(*) from public.alert_rules where firm_id = '${FIRM_MAIN}' and rule_key like 'denied-%';`).trim()).toBe('0');
    expect(psql(`select name from public.alert_rules where id = '${RL.main}';`).trim()).toBe('Filing due soon');
  });
});

describe('TEST-RLS-ARL-03 — AAL2 step-up required (RLS-AAL-01)', () => {
  it('an aal1 partner (no step-up) is denied on both admin commands', async () => {
    const create = await api(partnerA1, 'POST', 'rpc/create_alert_rule', {
      headers: H(FIRM_MAIN),
      body: { p_rule_key: 'aal1-attempt', p_name: 'aal1 attempt', p_severity: 'info' },
    });
    expect((create.body as { status: string }).status).toBe('denied');
    expect((create.body as { kind: string }).kind).toBe('unauthorized');
    expect((create.body as { message: string }).message).toContain('AAL2');

    const upd = await api(partnerA1, 'POST', 'rpc/update_alert_rule', {
      headers: H(FIRM_MAIN),
      body: { p_rule_id: RL.main, p_name: 'aal1 edit', p_severity: 'info' },
    });
    expect((upd.body as { kind: string }).kind).toBe('unauthorized');
    expect(psql(`select count(*) from public.alert_rules where rule_key = 'aal1-attempt';`).trim()).toBe('0');
    expect(psql(`select name from public.alert_rules where id = '${RL.main}';`).trim()).toBe('Filing due soon');
  });
});

describe('TEST-RLS-ARL-04 — cross-firm / context administration denied', () => {
  it('aal2 partner cannot create into a firm without a live membership (selector re-validated, RLS-CTX-02)', async () => {
    const res = await api(partnerA2, 'POST', 'rpc/create_alert_rule', {
      headers: H(FIRM_XTEN),
      body: { p_rule_key: 'forged-firm', p_name: 'forged', p_severity: 'info' },
    });
    expect((res.body as { kind: string }).kind).toBe('unauthorized');
    expect(psql(`select count(*) from public.alert_rules where rule_key = 'forged-firm';`).trim()).toBe('0');
  });

  it('aal2 partner cannot update a foreign-firm rule (selector mismatch denied + audited)', async () => {
    const res = await api(partnerA2, 'POST', 'rpc/update_alert_rule', {
      headers: H(FIRM_MAIN),
      body: { p_rule_id: RL.xten, p_name: 'cross-firm edit', p_severity: 'critical' },
    });
    expect((res.body as { status: string }).status).toBe('denied');
    expect((res.body as { kind: string }).kind).toBe('unauthorized');
    expect(psql(`select name from public.alert_rules where id = '${RL.xten}';`).trim()).toBe('Filing due soon (X)');
    // The existing-row probe is audited against the OWNING firm (AUD-FAIL-01).
    expect(
      psql(`select count(*) from public.audit_log
            where firm_id = '${FIRM_XTEN}' and action = 'alert_rule.update_denied'
              and object_id = '${RL.xten}';`).trim(),
    ).toBe('1');
  });

  it('a nonexistent rule id is the un-audited not_found surface (API-ERR-02)', async () => {
    const ghost = '6c000000-0000-4000-8000-00000000ffff';
    const res = await api(partnerA2, 'POST', 'rpc/update_alert_rule', {
      headers: H(FIRM_MAIN),
      body: { p_rule_id: ghost, p_name: 'ghost', p_severity: 'info' },
    });
    expect(res.body).toEqual({ status: 'denied', kind: 'not_found', message: 'alert rule not found' });
    expect(
      psql(`select count(*) from public.audit_log
            where firm_id = '${FIRM_MAIN}' and action = 'alert_rule.update_denied'
              and object_id = '${ghost}';`).trim(),
    ).toBe('0');
  });
});

describe('TEST-RLS-ARL-05 — aal2 super_admin/partner success path (RLS-ARL-01)', () => {
  it('create + update through the commands; duplicate rule_key is a conflict', async () => {
    const create = await api(partnerA2, 'POST', 'rpc/create_alert_rule', {
      headers: H(FIRM_MAIN),
      body: {
        p_rule_key: 'overdue_filing', p_name: 'Overdue filing', p_severity: 'critical',
        p_config: { days: 7 }, p_requires_explicit_ack: true,
      },
    });
    expect(create.status).toBe(200);
    const created = create.body as { status: string; rule: { id: string; firm_id: string; enabled: boolean; auto_resolve: boolean } };
    expect(created.status).toBe('created');
    expect(created.rule.firm_id).toBe(FIRM_MAIN); // server-derived
    expect(created.rule.enabled).toBe(true);
    expect(created.rule.auto_resolve).toBe(true);

    const dup = await api(partnerA2, 'POST', 'rpc/create_alert_rule', {
      headers: H(FIRM_MAIN),
      body: { p_rule_key: 'overdue_filing', p_name: 'Duplicate', p_severity: 'info' },
    });
    expect((dup.body as { status: string }).status).toBe('denied');
    expect((dup.body as { kind: string }).kind).toBe('conflict');

    const upd = await api(partnerA2, 'POST', 'rpc/update_alert_rule', {
      headers: H(FIRM_MAIN),
      body: {
        p_rule_id: created.rule.id, p_name: 'Overdue filing (v2)', p_severity: 'warning',
        p_config: { days: 14 }, p_enabled: false, p_auto_resolve: false, p_requires_explicit_ack: false,
      },
    });
    expect((upd.body as { status: string }).status).toBe('updated');
    const row = psql(`select name || ':' || severity || ':' || enabled::text || ':' || auto_resolve::text || ':' || requires_explicit_ack::text
      from public.alert_rules where id = '${created.rule.id}';`).trim();
    expect(row).toBe('Overdue filing (v2):warning:false:false:false');

    // Every change audited (AUD-CAT-01 — the exact rows are TEST-AUD-02's
    // suite; here the count smoke-check).
    expect(
      psql(`select count(*) from public.audit_log
            where firm_id = '${FIRM_MAIN}' and object_type = 'alert_rule'
              and action in ('alert_rule.created', 'alert_rule.updated');`).trim(),
    ).toBe('2');
  });
});
