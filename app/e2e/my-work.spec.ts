/**
 * IMP-042 (E2E slice) — TEST-E2E-07 (task assignment + update, incl.
 * `waiting` requiring a reason) and TEST-E2E-09 (My Work buckets render:
 * Today / This Week / Waiting / Returned) against the LOCAL Supabase stack
 * (port-3100 supabase-mode dev server; playwright.config.ts `my-work`
 * project, included only when the loopback stack is up).
 *
 * Flow under test (real application, real RPCs — UI → @/data →
 * transition_task / updateTask, never a direct DB write as the action under
 * test):
 *   TEST-E2E-07: a SENIOR signs in, sees the assigned open task in Today,
 *   Start → in_progress (DB-verified), Mark waiting… → the dialog REJECTS
 *   an empty reason (confirm disabled) → reason → waiting with the reason
 *   persisted (DB-verified), Resume → in_progress; then a MANAGER reassigns
 *   an own task to the senior through the ReassignDialog (roster via
 *   client360Service.listActiveStaff) → DB shows the new
 *   assignee_membership_id and the item leaves the manager's buckets.
 *   TEST-E2E-09: the senior's four DEC-L buckets render with each seeded
 *   item in EXACTLY its expected bucket (single-bucket precedence:
 *   Returned → Waiting → Today → This Week), next_action on every item,
 *   including a standalone returned review item (task_id IS NULL) with the
 *   exact contract next action "Address reviewer feedback", and the linked
 *   returned ReviewItem never surfacing beside its canonical task.
 *
 * Harness mechanics (setup only, never the flow under test): psql seeds the
 * firm/membership/profile/client/task rows; the `waiting`/`returned` fixture
 * STATES are staged through the real backend commands (transition_task,
 * submit_review_item, decide_review_item) called over PostgREST with
 * password-grant harness tokens — the same commands the UI uses; service-role
 * admin calls clear TOTP factors so the mandatory-MFA path is
 * deterministically the ENROLMENT screen. audit_log rows are immutable by
 * design and wiped by the next harness reset — never deleted here.
 *
 * Identities come from tests/harness/registry.json — non-secret LOCAL
 * fixture accounts; never real credentials.
 *
 * NOTE on parallel safety: this suite owns a PRIVATE firm
 * (a4200000-…, the integration-suite precedent) rather than sharing
 * FIRM_A/FIRM_B — review-queue's teardown broadly deletes all FIRM_B
 * review_items/profiles and staff-auth enrolls/clears USER_A_SENIOR's TOTP
 * factors, both of which would race this suite's fixtures in project-parallel
 * runs. The two identities used here (USER_A_MANAGER as manager, USER_B_ARTICLE
 * with a senior-role membership — registry persona labels describe harness
 * intent only and both senior-persona users are owned by parallel suites) are
 * touched by NO other e2e project: no factor, profile, or membership races,
 * and each has exactly one ACTIVE membership so the R0 active-firm bootstrap
 * (smallest firm id) deterministically selects this suite's firm.
 *
 * DATE NOTE (DEC-L): bucket boundaries use the real Asia/Kolkata business
 * date. The This Week window is (today, ISO-week Sunday] — on a Sunday it is
 * EMPTY BY CONSTRUCTION, so the This Week item is seeded and asserted only
 * when a valid date exists (the bucket heading is asserted always).
 */
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

import {
  adminDeleteFactor,
  adminListFactors,
  api,
  PASSWORD,
  psql,
  signIn,
  totpCode,
  userEmail,
  userId,
} from '../tests/integration/helpers.mjs';

const MANAGER = userId('USER_A_MANAGER');
const MANAGER_EMAIL = userEmail('USER_A_MANAGER');
const SENIOR = userId('USER_B_ARTICLE'); // senior-ROLE membership in this firm
const SENIOR_EMAIL = userEmail('USER_B_ARTICLE');

const FIRM = 'a4200000-0000-4000-8000-0000000000f4';
const MANAGER_MEMBERSHIP = 'a4200000-0000-4000-8000-0000000000a1';
const SENIOR_MEMBERSHIP = 'a4200000-0000-4000-8000-0000000000a2';
const CLIENT_ID = 'a4200000-0000-4000-8000-0000000000c1';

const T_FLOW = 'a4200000-0000-4000-8000-000000000101'; // TEST-E2E-07 senior task
const T_MGR = 'a4200000-0000-4000-8000-000000000102'; // manager-owned, reassigned
const T_TODAY = 'a4200000-0000-4000-8000-000000000103'; // overdue → Today
const T_WEEK = 'a4200000-0000-4000-8000-000000000104'; // due later this ISO week
const T_WAIT = 'a4200000-0000-4000-8000-000000000105'; // waiting w/ reason
const T_RET = 'a4200000-0000-4000-8000-000000000106'; // returned via linked item

const CLIENT_NAME = 'E2E MyWork Client';
const FLOW_TITLE = 'E2E MyWork flow task — open to waiting';
const FLOW_NEXT = 'Prepare the GSTR-3B working';
const MGR_TITLE = 'E2E MyWork manager task — reassign me';
const TODAY_TITLE = 'E2E MyWork overdue task';
const TODAY_NEXT = 'Chase the pending bank statement';
const WEEK_TITLE = 'E2E MyWork this-week task';
const WEEK_NEXT = 'Schedule the ledger walkthrough';
const WAIT_TITLE = 'E2E MyWork waiting task';
const WAIT_REASON = 'Awaiting April bank statements from the client';
const RET_TITLE = 'E2E MyWork returned task';
const RET_NEXT = 'Rework the depreciation schedule';
const LINKED_ITEM_TITLE = 'E2E MyWork linked return item';
const SOLO_ITEM_TITLE = 'E2E MyWork standalone returned item';
const SOLO_ITEM_NEXT = 'Address reviewer feedback'; // DEC-L contract action, exact
const SENIOR_ROSTER_OPTION = 'E2E MyWork Senior · Senior';

// --- DEC-L business-date math (mirrors src/data/mywork/types.ts — the e2e
//     runner has no @/ alias, so the two pure rules are restated here) -------

function kolkataToday(): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function isoWeekEnd(businessDate: string): string {
  const day = new Date(`${businessDate}T00:00:00.000Z`);
  const offset = (7 - day.getUTCDay()) % 7; // days remaining through Sunday
  day.setUTCDate(day.getUTCDate() + offset);
  return day.toISOString().slice(0, 10);
}

function shiftDate(businessDate: string, days: number): string {
  const day = new Date(`${businessDate}T00:00:00.000Z`);
  day.setUTCDate(day.getUTCDate() + days);
  return day.toISOString().slice(0, 10);
}

const BUSINESS_DATE = kolkataToday();
const DUE_TODAY = BUSINESS_DATE;
const DUE_OVERDUE = shiftDate(BUSINESS_DATE, -1);
/** A valid This Week due date, or null on Sundays (DEC-L: the window
 *  (today, weekEnd] is then empty by construction). */
const DUE_WEEK: string | null =
  isoWeekEnd(BUSINESS_DATE) > BUSINESS_DATE ? isoWeekEnd(BUSINESS_DATE) : null;

// --- Helpers -----------------------------------------------------------------

async function signInWithMfa(page: Page, email: string) {
  await page.goto('/auth/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  // Mandatory MFA gate (AUTH-10): enroll TOTP through the real UI.
  await expect(page).toHaveURL(/\/auth\/mfa-enroll$/);
  const secret = await page.locator('p.font-mono').textContent();
  expect(secret).toBeTruthy();
  await page.getByLabel('Authenticator code').fill(totpCode(secret!.trim()));
  await page.getByRole('button', { name: 'Verify and continue' }).click();
  await expect(page).toHaveURL(/\/brief$/);
}

/** One bucket section (<section aria-label> renders as role=region). */
function bucket(page: Page, label: string): Locator {
  return page.getByRole('region', { name: label, exact: true });
}

/** One work-item row within a bucket, by its unique title. */
function rowIn(region: Locator, title: string): Locator {
  return region.locator('div.rounded-xl', { hasText: title }).first();
}

function taskState(taskId: string): string {
  return psql(
    `select status || '|' || coalesce(waiting_reason, '') from public.tasks where id = '${taskId}';`,
  ).trim();
}

/** Setup-only Layer-B command over PostgREST with a harness password token —
 *  the same commands the UI drives; fails the run loudly on denial. */
async function command(
  token: string,
  fn: string,
  body: Record<string, unknown>,
  expectStatus: string,
): Promise<Record<string, unknown>> {
  const res = await api(token, 'POST', `rpc/${fn}`, {
    headers: { 'x-active-firm': FIRM },
    body,
  });
  const parsed = res.body as Record<string, unknown> | null;
  if (res.status !== 200 || !parsed || parsed.status !== expectStatus) {
    throw new Error(`setup command ${fn} failed: HTTP ${res.status} ${JSON.stringify(res.body)}`);
  }
  return parsed;
}

async function clearFactors(...users: string[]) {
  for (const u of users) {
    for (const f of await adminListFactors(u)) {
      await adminDeleteFactor(u, f.id);
    }
  }
}

/** Child → parent domain-row cleanup for this suite's PRIVATE firm only.
 *  audit_log rows are never deleted (append-only; wiped by harness reset). */
function cleanDomainRows() {
  psql(`
    delete from public.task_comments where firm_id = '${FIRM}';
    delete from public.review_items where firm_id = '${FIRM}';
    delete from public.tasks where firm_id = '${FIRM}';
    delete from public.clients where firm_id = '${FIRM}';
    delete from public.firm_memberships where firm_id = '${FIRM}';
    delete from public.profiles where id in ('${MANAGER}', '${SENIOR}');
    delete from public.firms where id = '${FIRM}';
  `);
}

// --- Fixtures ------------------------------------------------------------------

test.beforeAll(async () => {
  // Re-runnable after a previously failed/partial run.
  cleanDomainRows();

  // (id, title, next_action, due_date, priority, assignee, reviewer)
  const taskRows = [
    // TEST-E2E-07: the senior's open task due today; the manager's own task.
    `('${T_FLOW}', '${FLOW_TITLE}', '${FLOW_NEXT}', '${DUE_TODAY}', 'normal', '${SENIOR_MEMBERSHIP}', null)`,
    `('${T_MGR}', '${MGR_TITLE}', 'Review the draft computation', '${DUE_TODAY}', 'normal', '${MANAGER_MEMBERSHIP}', null)`,
    // TEST-E2E-09: Today (overdue), This Week (when a valid date exists),
    // Waiting and Returned fixtures (statuses staged via the commands below).
    `('${T_TODAY}', '${TODAY_TITLE}', '${TODAY_NEXT}', '${DUE_OVERDUE}', 'high', '${SENIOR_MEMBERSHIP}', null)`,
    ...(DUE_WEEK !== null
      ? [`('${T_WEEK}', '${WEEK_TITLE}', '${WEEK_NEXT}', '${DUE_WEEK}', 'normal', '${SENIOR_MEMBERSHIP}', null)`]
      : []),
    `('${T_WAIT}', '${WAIT_TITLE}', 'Follow up on client documents', '${DUE_TODAY}', 'normal', '${SENIOR_MEMBERSHIP}', null)`,
    `('${T_RET}', '${RET_TITLE}', '${RET_NEXT}', '${DUE_TODAY}', 'normal', '${SENIOR_MEMBERSHIP}', '${MANAGER_MEMBERSHIP}')`,
  ];

  psql(`
    insert into public.firms (id, name) values ('${FIRM}', 'E2E MyWork Firm');
    insert into public.firm_memberships (id, firm_id, user_id, role, status) values
      ('${MANAGER_MEMBERSHIP}', '${FIRM}', '${MANAGER}', 'manager', 'active'),
      ('${SENIOR_MEMBERSHIP}', '${FIRM}', '${SENIOR}', 'senior', 'active');
    insert into public.profiles (id, full_name) values
      ('${MANAGER}', 'E2E MyWork Manager'),
      ('${SENIOR}', 'E2E MyWork Senior');
    insert into public.clients
      (id, firm_id, name, owner_partner_membership_id, manager_membership_id, status)
    values ('${CLIENT_ID}', '${FIRM}', '${CLIENT_NAME}', '${MANAGER_MEMBERSHIP}', '${MANAGER_MEMBERSHIP}', 'active');
    insert into public.tasks
      (id, firm_id, client_id, title, next_action, due_date, priority, assignee_membership_id, reviewer_membership_id)
    select
      r.id::uuid, '${FIRM}', '${CLIENT_ID}', r.title, r.next_action, r.due_date::date,
      r.priority, r.assignee::uuid, r.reviewer::uuid
    from (values
      ${taskRows.join(',\n      ')}
    ) as r (id, title, next_action, due_date, priority, assignee, reviewer);
  `);

  // Stage the Waiting/Returned fixture STATES through the real Layer-B
  // commands (password-grant harness tokens, active-firm selector header) —
  // setup only, mirroring the UI's own command path. The browser never
  // performs these steps in TEST-E2E-09; it only READS the results.
  const seniorAuth = await signIn(SENIOR_EMAIL);
  const managerAuth = await signIn(MANAGER_EMAIL);
  if (!seniorAuth.ok || !managerAuth.ok) {
    throw new Error('setup sign-in failed — is the harness seed in place?');
  }
  const seniorToken = seniorAuth.token;
  const managerToken = managerAuth.token;

  // Waiting fixture: open → in_progress → waiting (reason mandatory, DM-SM-05).
  await command(seniorToken, 'transition_task', { p_task_id: T_WAIT, p_target_status: 'in_progress' }, 'transitioned');
  await command(
    seniorToken,
    'transition_task',
    { p_task_id: T_WAIT, p_target_status: 'waiting', p_waiting_reason: WAIT_REASON },
    'transitioned',
  );

  // Returned fixture (task-linked, DEC-L canonicalization): the senior moves
  // the task into review and submits a linked item; the MANAGER (a different
  // live membership — RLS-4EY-04, and the task's reviewer) returns it. The
  // decision atomically returns item + task and creates the reviewer comment.
  await command(seniorToken, 'transition_task', { p_task_id: T_RET, p_target_status: 'in_progress' }, 'transitioned');
  await command(seniorToken, 'transition_task', { p_task_id: T_RET, p_target_status: 'submitted' }, 'transitioned');
  const linked = await command(
    seniorToken,
    'submit_review_item',
    { p_task_id: T_RET, p_type: 'gst_reconciliation', p_title: LINKED_ITEM_TITLE },
    'submitted',
  );
  const linkedItemId = (linked.item as Record<string, unknown>).id as string;
  await command(
    managerToken,
    'decide_review_item',
    {
      p_review_item_id: linkedItemId,
      p_decision: 'returned',
      p_rationale: 'E2E return: rework the schedules and resubmit',
    },
    'decided',
  );

  // Standalone returned fixture (task_id IS NULL, the senior's OWN
  // submission): ad-hoc against the client — in senior scope via the assigned
  // tasks of this client (RLS-RVW-01); returned by the manager (portfolio).
  const solo = await command(
    seniorToken,
    'submit_review_item',
    { p_client_id: CLIENT_ID, p_type: 'tds_return', p_title: SOLO_ITEM_TITLE },
    'submitted',
  );
  const soloItemId = (solo.item as Record<string, unknown>).id as string;
  await command(
    managerToken,
    'decide_review_item',
    {
      p_review_item_id: soloItemId,
      p_decision: 'returned',
      p_rationale: 'E2E return: attach the revised computation',
    },
    'decided',
  );

  // Deterministic enrolment for the UI sign-ins below.
  await clearFactors(MANAGER, SENIOR);
});

test.afterAll(async () => {
  cleanDomainRows();
  await clearFactors(MANAGER, SENIOR);
});

// --- TEST-E2E-07 ---------------------------------------------------------------

test('TEST-E2E-07 — task assignment + update through the real UI and RPCs', async ({
  browser,
}) => {
  test.setTimeout(180_000);

  // --- Step 1: SENIOR works the assigned task ------------------------------
  const seniorContext = await browser.newContext();
  const seniorPage = await seniorContext.newPage();
  await signInWithMfa(seniorPage, SENIOR_EMAIL);

  await seniorPage.goto('/my-work');
  await expect(
    seniorPage.getByRole('heading', { name: 'My Work', exact: true }),
  ).toBeVisible();

  // The open task sits in Today (due today) with its explicit next_action.
  const today = bucket(seniorPage, 'Today');
  const flowRow = rowIn(today, FLOW_TITLE);
  await expect(flowRow).toBeVisible();
  await expect(flowRow).toContainText(`Next: ${FLOW_NEXT}`);
  await expect(flowRow.getByRole('button', { name: 'Start' })).toBeVisible();
  // Role-truthful UI (RLS-TSK-01 mirror): a senior is never offered Reassign.
  await expect(seniorPage.getByRole('button', { name: 'Reassign…' })).toHaveCount(0);

  // open → in_progress through transitionTask (the ONLY status path).
  await flowRow.getByRole('button', { name: 'Start' }).click();
  await expect(
    rowIn(today, FLOW_TITLE).getByRole('button', { name: 'Submit for review' }),
  ).toBeVisible();
  expect(taskState(T_FLOW)).toBe('in_progress|');

  // in_progress → waiting: the dialog REJECTS an empty reason (confirm
  // disabled) before any server call; a real reason then persists (DM-SM-05).
  await rowIn(today, FLOW_TITLE).getByRole('button', { name: 'Mark waiting…' }).click();
  const waitingDialog = seniorPage.getByRole('dialog');
  const waitingConfirm = waitingDialog.getByRole('button', { name: 'Mark as waiting' });
  await expect(waitingConfirm).toBeDisabled();
  await waitingDialog.getByLabel('Waiting reason').fill('   ');
  await expect(waitingConfirm).toBeDisabled(); // whitespace is not a reason
  await waitingDialog.getByLabel('Waiting reason').fill(WAIT_REASON);
  await expect(waitingConfirm).toBeEnabled();
  await waitingConfirm.click();
  await expect(waitingDialog).not.toBeVisible();

  // Waiting claims the item (precedence over Today) and shows the reason.
  const waiting = bucket(seniorPage, 'Waiting');
  const waitingRow = rowIn(waiting, FLOW_TITLE);
  await expect(waitingRow).toBeVisible();
  await expect(waitingRow).toContainText(WAIT_REASON);
  await expect(rowIn(today, FLOW_TITLE)).toHaveCount(0);
  expect(taskState(T_FLOW)).toBe(`waiting|${WAIT_REASON}`);

  // waiting → in_progress (Resume) — back to Today. The waiting_reason is
  // RETAINED as history after leaving waiting (documented transition_task
  // choice — the audit trail keeps the blocker record).
  await waitingRow.getByRole('button', { name: 'Resume' }).click();
  await expect(rowIn(today, FLOW_TITLE)).toBeVisible();
  await expect(rowIn(waiting, FLOW_TITLE)).toHaveCount(0);
  expect(taskState(T_FLOW)).toBe(`in_progress|${WAIT_REASON}`);

  // --- Step 2: MANAGER reassigns an own task to the senior -----------------
  const managerContext = await browser.newContext();
  const managerPage = await managerContext.newPage();
  await signInWithMfa(managerPage, MANAGER_EMAIL);

  await managerPage.goto('/my-work');
  const managerToday = bucket(managerPage, 'Today');
  const mgrRow = rowIn(managerToday, MGR_TITLE);
  await expect(mgrRow).toBeVisible();

  await mgrRow.getByRole('button', { name: 'Reassign…' }).click();
  const reassignDialog = managerPage.getByRole('dialog');
  const reassignConfirm = reassignDialog.getByRole('button', { name: 'Reassign', exact: true });
  await expect(reassignConfirm).toBeDisabled(); // no assignee selected yet
  // Roster loads through client360Service.listActiveStaff (RLS) — real names.
  await reassignDialog.getByLabel('New assignee').click();
  await managerPage.getByRole('option', { name: SENIOR_ROSTER_OPTION }).click();
  await expect(reassignConfirm).toBeEnabled();
  await reassignConfirm.click();
  await expect(reassignDialog).not.toBeVisible();

  // DB truth: the assignee responsibility moved to the senior membership…
  expect(
    psql(`select assignee_membership_id from public.tasks where id = '${T_MGR}';`).trim(),
  ).toBe(SENIOR_MEMBERSHIP);
  // …and My Work is personal (DEC-L): after the non-optimistic re-read
  // (API-MUT-02) the reassigned task is no longer the manager's own work and
  // leaves every bucket. (The manager still reviews the seeded returned task,
  // so the page-wide empty state is NOT expected here.)
  await expect(managerPage.getByText(MGR_TITLE)).toHaveCount(0);
  await expect(rowIn(bucket(managerPage, 'Today'), MGR_TITLE)).toHaveCount(0);

  await seniorContext.close();
  await managerContext.close();
});

// --- TEST-E2E-09 ---------------------------------------------------------------

test('TEST-E2E-09 — My Work buckets render Today / This Week / Waiting / Returned', async ({
  browser,
}) => {
  test.setTimeout(120_000);

  // Deterministic enrolment for the identity reused from TEST-E2E-07 (the
  // suite's established local-harness mechanism).
  await clearFactors(SENIOR);

  const context = await browser.newContext();
  const page = await context.newPage();
  await signInWithMfa(page, SENIOR_EMAIL);

  // Nav label → route.
  await page.locator('a[href="/my-work"]:visible').first().click();
  await expect(page).toHaveURL(/\/my-work$/);
  await expect(page.getByRole('heading', { name: 'My Work', exact: true })).toBeVisible();

  // All four DEC-L bucket headings render.
  const today = bucket(page, 'Today');
  const thisWeek = bucket(page, 'This week');
  const waiting = bucket(page, 'Waiting');
  const returned = bucket(page, 'Returned');
  await expect(today).toBeVisible();
  await expect(thisWeek).toBeVisible();
  await expect(waiting).toBeVisible();
  await expect(returned).toBeVisible();

  // Today: the overdue task, next_action visible, overdue flagged.
  const todayRow = rowIn(today, TODAY_TITLE);
  await expect(todayRow).toBeVisible();
  await expect(todayRow).toContainText(`Next: ${TODAY_NEXT}`);
  await expect(todayRow).toContainText('overdue');

  // This Week: due later this ISO week — except on Sundays, when the DEC-L
  // window (today, weekEnd] is empty by construction (see header DATE NOTE).
  if (DUE_WEEK !== null) {
    const weekRow = rowIn(thisWeek, WEEK_TITLE);
    await expect(weekRow).toBeVisible();
    await expect(weekRow).toContainText(`Next: ${WEEK_NEXT}`);
  } else {
    await expect(thisWeek).toContainText('Nothing here.');
  }

  // Waiting: the waiting task with its mandatory reason.
  const waitRow = rowIn(waiting, WAIT_TITLE);
  await expect(waitRow).toBeVisible();
  await expect(waitRow).toContainText(WAIT_REASON);

  // Returned: the canonical returned TASK (the linked ReviewItem is never
  // additionally surfaced) plus the standalone returned item carrying the
  // exact contract next action.
  const retRow = rowIn(returned, RET_TITLE);
  await expect(retRow).toBeVisible();
  await expect(retRow).toContainText(`Next: ${RET_NEXT}`);
  const soloRow = rowIn(returned, SOLO_ITEM_TITLE);
  await expect(soloRow).toBeVisible();
  await expect(soloRow).toContainText('review item');
  await expect(soloRow).toContainText(`Next: ${SOLO_ITEM_NEXT}`);
  await expect(page.getByText(LINKED_ITEM_TITLE)).toHaveCount(0);

  // Single-bucket precedence (Returned → Waiting → Today → This Week): each
  // seeded item appears in EXACTLY its expected bucket, even though the
  // waiting/returned tasks are also due today.
  await expect(rowIn(today, RET_TITLE)).toHaveCount(0);
  await expect(rowIn(today, WAIT_TITLE)).toHaveCount(0);
  await expect(rowIn(thisWeek, RET_TITLE)).toHaveCount(0);
  await expect(rowIn(thisWeek, WAIT_TITLE)).toHaveCount(0);
  await expect(rowIn(thisWeek, TODAY_TITLE)).toHaveCount(0);
  await expect(rowIn(waiting, RET_TITLE)).toHaveCount(0);
  await expect(rowIn(returned, WAIT_TITLE)).toHaveCount(0);

  // DB truth for the setup-staged fixture states (TEST-E2E-09's own actions
  // are read-only; these verify the fixture graph the buckets rendered).
  expect(taskState(T_WAIT)).toBe(`waiting|${WAIT_REASON}`);
  expect(taskState(T_RET)).toBe('returned|');
  const reviewRows = psql(`
    select title || '|' || status || '|' || coalesce(task_id::text, 'null')
      || '|' || submitted_by_membership_id
    from public.review_items where firm_id = '${FIRM}' order by title;
  `).trim().split('\n');
  expect(reviewRows).toEqual([
    `${LINKED_ITEM_TITLE}|returned|${T_RET}|${SENIOR_MEMBERSHIP}`,
    `${SOLO_ITEM_TITLE}|returned|null|${SENIOR_MEMBERSHIP}`,
  ]);

  await context.close();
});
