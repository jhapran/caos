/**
 * IMP-060 (E2E slice) — TEST-E2E-10 ("deadlines + Command Centre render live
 * data") against the LOCAL Supabase stack (port-3100 supabase-mode dev
 * server; playwright.config.ts `deadlines-command` project, included only
 * when the loopback stack is up). Extended to the Morning Brief, whose live
 * counters come from the same IMP-060 aggregate composition.
 *
 * Flow under test (real application, real RLS reads — UI → @/data →
 * dashboardService / deadlinesService, never a direct DB write as the action
 * under test):
 *   - a PARTNER signs in through the real UI (password + mandatory TOTP
 *     ENROLMENT, AUTH-10) and /command renders the seeded truth: Compliance
 *     Health hero = the open DM-SM-04 obligations, the Upcoming Deadlines
 *     card lists the seeded board groups, Review Queue shows the seeded
 *     pending count, Firm Risk Alerts shows the seeded active count — with
 *     the fixture-only artifacts ABSENT ("Last synced 09:12", the FY
 *     switcher, hard-coded demo numbers);
 *   - /deadlines lists every seeded board group (overdue included) with
 *     truthful counts, and drilling a group renders the seeded instance row
 *     (client / entity / period / state / due) — unknown-group discipline is
 *     the service's (API-ERR-02), not re-tested here;
 *   - /brief renders the approved counters (H3: at-risk deadlines, pending
 *     reviews, active alerts) and the H2–H6 absences: no "17 items need
 *     attention", no "On Track", Team Overload + Billing deferred tiles, the
 *     Attention List deferred panel;
 *   - role truthfulness (bonus): a BILLING sign-in sees truthful
 *     zeros/empty states — never an error, never fixture numbers.
 *
 * Harness mechanics (setup only, never the flow under test): operator psql
 * seeds the firm/membership/profile/client/entity/instance/review/alert
 * rows (plain INSERTs — the DM-SM-04/06 and SCH-18 lifecycle guards bind
 * UPDATE only, the dashboard-integration-suite precedent); service-role
 * admin calls clear TOTP factors so the mandatory-MFA path is
 * deterministically the ENROLMENT screen. audit_log rows are immutable by
 * design and wiped by the next harness reset — never deleted here.
 *
 * Identities come from tests/harness/registry.json — non-secret LOCAL
 * fixture accounts; never real credentials.
 *
 * NOTE on parallel safety: this suite owns a PRIVATE firm (a4300000-…,
 * unused by any other suite) rather than sharing FIRM_A/FIRM_B. The two
 * identities used here (USER_A_SUPER_ADMIN with a partner-ROLE membership,
 * USER_A_BILLING with a billing-ROLE membership — registry persona labels
 * describe harness intent only) are touched by NO other e2e project: no
 * factor, profile, or membership races, and each has exactly one ACTIVE
 * membership so the R0 active-firm bootstrap (smallest firm id)
 * deterministically selects this suite's firm.
 *
 * DATE NOTE: instance due dates are Asia/Kolkata business dates computed
 * SQL-side at seed time and recomputed spec-side with the same rules, so
 * the day labels are exact on any run date (the my-work/deadline-suite
 * precedent).
 */
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import {
  adminDeleteFactor,
  adminListFactors,
  PASSWORD,
  psql,
  totpCode,
  userEmail,
  userId,
} from '../tests/integration/helpers.mjs';

const PARTNER = userId('USER_A_SUPER_ADMIN'); // partner-ROLE membership here
const PARTNER_EMAIL = userEmail('USER_A_SUPER_ADMIN');
const BILLING = userId('USER_A_BILLING');
const BILLING_EMAIL = userEmail('USER_A_BILLING');

const FIRM = 'a4300000-0000-4000-8000-0000000000f1';
const PARTNER_MEMBERSHIP = 'a4300000-0000-4000-8000-0000000000a1';
const BILLING_MEMBERSHIP = 'a4300000-0000-4000-8000-0000000000a2';
const CLIENT_ID = 'a4300000-0000-4000-8000-0000000000c1';
const ENTITY_ID = 'a4300000-0000-4000-8000-0000000000e1';
const I_AT_RISK = 'a4300000-0000-4000-8000-000000000101'; // preparation, due −2
const I_FUTURE = 'a4300000-0000-4000-8000-000000000102'; // not_started, due +5
const I_WAITING = 'a4300000-0000-4000-8000-000000000103'; // information_requested, due +3
const I_FILED = 'a4300000-0000-4000-8000-000000000104'; // filed, due −10 (never at-risk)
const R_PENDING = 'a4300000-0000-4000-8000-000000000201';
const A_ACTIVE = 'a4300000-0000-4000-8000-000000000301';

// Seeded system reference type (supabase/seed.sql): 'Income Tax Return',
// entity-scoped — readable without any fixture compliance_types row (the
// dashboard/deadline integration-suite precedent).
const SYS_ITR = '50000000-0000-4000-8000-000000000005';

const FIRM_NAME = 'E2E DASH Firm';
const PARTNER_NAME = 'E2E DASH Partner';
const CLIENT_NAME = 'E2E DASH Client';
const ENTITY_NAME = 'E2E DASH Entity';
const COMPLIANCE_NAME = 'Income Tax Return';

// --- Asia/Kolkata business-date math (the my-work.spec.ts precedent) --------

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

function shiftDate(businessDate: string, days: number): string {
  const day = new Date(`${businessDate}T00:00:00.000Z`);
  day.setUTCDate(day.getUTCDate() + days);
  return day.toISOString().slice(0, 10);
}

const BUSINESS_DATE = kolkataToday();
/** The drill-down group: the information_requested instance due in 3 days. */
const DRILL_GROUP_ID = `${SYS_ITR}::${shiftDate(BUSINESS_DATE, 3)}`;

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
    delete from public.alerts where firm_id = '${FIRM}';
    delete from public.review_items where firm_id = '${FIRM}';
    delete from public.tasks where firm_id = '${FIRM}';
    delete from public.compliance_instances where firm_id = '${FIRM}';
    delete from public.legal_entities where firm_id = '${FIRM}';
    delete from public.clients where firm_id = '${FIRM}';
    delete from public.firm_memberships where firm_id = '${FIRM}';
    delete from public.profiles where id in ('${PARTNER}', '${BILLING}');
    delete from public.firms where id = '${FIRM}';
  `);
}

// --- Fixtures ------------------------------------------------------------------

test.beforeAll(async () => {
  // Re-runnable after a previously failed/partial run.
  cleanDomainRows();

  psql(`
    insert into public.firms (id, name) values ('${FIRM}', '${FIRM_NAME}');
    insert into public.firm_memberships (id, firm_id, user_id, role, status) values
      ('${PARTNER_MEMBERSHIP}', '${FIRM}', '${PARTNER}', 'partner', 'active'),
      ('${BILLING_MEMBERSHIP}', '${FIRM}', '${BILLING}', 'billing', 'active');
    insert into public.profiles (id, full_name) values
      ('${PARTNER}', '${PARTNER_NAME}'),
      ('${BILLING}', 'E2E DASH Billing');
    insert into public.clients
      (id, firm_id, name, owner_partner_membership_id, manager_membership_id, status)
    values ('${CLIENT_ID}', '${FIRM}', '${CLIENT_NAME}', '${PARTNER_MEMBERSHIP}', null, 'active');
    insert into public.legal_entities (id, firm_id, client_id, entity_type, legal_name) values
      ('${ENTITY_ID}', '${FIRM}', '${CLIENT_ID}', 'private_limited', '${ENTITY_NAME}');

    -- Instance fixtures are plain operator INSERTs: client_id is
    -- trigger-derived from the legal entity (SCH-A-02), and the state guard
    -- binds UPDATE only (the dashboard/deadline integration-suite
    -- precedent). Due dates are Asia/Kolkata business dates computed
    -- SQL-side so at-risk is exact on any run date.
    insert into public.compliance_instances
      (id, firm_id, legal_entity_id, compliance_type_id, period_start, period_end,
       period_label, due_date, state, assignee_membership_id, reviewer_membership_id)
    values
      ('${I_AT_RISK}', '${FIRM}', '${ENTITY_ID}', '${SYS_ITR}', '2026-04-01', '2027-03-31', 'FY 2026-27',
       ((now() at time zone 'Asia/Kolkata')::date - 2), 'preparation', null, null),
      ('${I_FUTURE}', '${FIRM}', '${ENTITY_ID}', '${SYS_ITR}', '2027-04-01', '2028-03-31', 'FY 2027-28',
       ((now() at time zone 'Asia/Kolkata')::date + 5), 'not_started', null, null),
      ('${I_WAITING}', '${FIRM}', '${ENTITY_ID}', '${SYS_ITR}', '2028-04-01', '2029-03-31', 'FY 2028-29',
       ((now() at time zone 'Asia/Kolkata')::date + 3), 'information_requested', null, null),
      ('${I_FILED}', '${FIRM}', '${ENTITY_ID}', '${SYS_ITR}', '2025-04-01', '2026-03-31', 'FY 2025-26',
       ((now() at time zone 'Asia/Kolkata')::date - 10), 'filed', null, null);

    -- One pending review item and one active alert so every approved Command
    -- Centre / Morning Brief counter is non-zero. Plain operator INSERTs
    -- (browser grants are SELECT-only on both tables).
    insert into public.review_items
      (id, firm_id, client_id, type, title, status, submitted_by_membership_id)
    values
      ('${R_PENDING}', '${FIRM}', '${CLIENT_ID}', 'gst_reconciliation', 'E2E DASH pending review',
       'pending', '${PARTNER_MEMBERSHIP}');
    insert into public.alerts
      (id, firm_id, severity, title, client_id, compliance_instance_id, status)
    values
      ('${A_ACTIVE}', '${FIRM}', 'warning', 'E2E DASH active alert', '${CLIENT_ID}', null, 'active');
  `);

  // Deterministic enrolment for the UI sign-ins below.
  await clearFactors(PARTNER, BILLING);
});

test.afterAll(async () => {
  cleanDomainRows();
  await clearFactors(PARTNER, BILLING);
});

// --- TEST-E2E-10 ---------------------------------------------------------------

test('TEST-E2E-10 — Command Centre renders the live seeded aggregates, no fixture artifacts', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  await clearFactors(PARTNER); // deterministic re-enrolment on re-run

  const context = await browser.newContext();
  const page = await context.newPage();
  await signInWithMfa(page, PARTNER_EMAIL);

  await page.goto('/command');
  await expect(
    page.getByRole('heading', { name: 'Firm Command Centre', exact: true }),
  ).toBeVisible();

  // Compliance Health (H1): the hero is the live open-obligations count —
  // preparation + not_started + information_requested + filed = 4 (only
  // 'closed' is post-closure). The live caption carries no FY claim.
  const health = page.getByRole('region', { name: 'Compliance Health' });
  await expect(health.locator('.text-stat-xl')).toHaveText('4');
  await expect(health).toContainText('open compliance obligations');
  await expect(health).toContainText('Live compliance-instance states');
  // The At Risk chip is the deadline_board derivation (1 seeded at-risk).
  await expect(health.getByRole('button', { name: /At Risk/ })).toContainText('1');

  // Upcoming Deadlines card (H7): the seeded board groups render (overdue
  // included — the filed group due −10 and the at-risk group due −2).
  const deadlinesCard = page.getByRole('region', { name: 'Upcoming Deadlines' });
  await expect(deadlinesCard.getByText(COMPLIANCE_NAME).first()).toBeVisible();
  await expect(deadlinesCard).toContainText('Overdue by 2 days');
  await expect(deadlinesCard).toContainText('Due in 3 days');

  // Client Dependency card (H7): the information_requested instance.
  const dependencyCard = page.getByRole('region', { name: 'Client Dependency' });
  await expect(dependencyCard).toContainText('1 clients · 1 open dependency items');
  await expect(dependencyCard.getByText(CLIENT_NAME)).toBeVisible();

  // Review Queue card: the approved pending counter only.
  const reviewCard = page.getByRole('region', { name: 'Review Queue' });
  await expect(reviewCard).toContainText('1 items awaiting review');
  await expect(reviewCard).toContainText('Per-type breakdown lives in the Review Queue.');

  // Firm Risk Alerts card: the approved active counter only.
  const alertsCard = page.getByRole('region', { name: 'Firm Risk Alerts' });
  await expect(alertsCard).toContainText('1 active');

  // Fixture-only artifacts are ABSENT in live mode.
  await expect(page.getByText('Last synced 09:12')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'FY 2024-25' })).toHaveCount(0);
  await expect(page.getByText(/FY 2024-25/)).toHaveCount(0);
  await expect(page.getByText('684')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /nudge/i })).toHaveCount(0);

  await context.close();
});

test('TEST-E2E-10 — the deadlines board lists the seeded groups and the group drill-down renders the instance row', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  await clearFactors(PARTNER);

  const context = await browser.newContext();
  const page = await context.newPage();
  await signInWithMfa(page, PARTNER_EMAIL);

  await page.goto('/deadlines');
  await expect(
    page.getByRole('heading', { name: 'Upcoming Deadlines', exact: true }),
  ).toBeVisible();

  // All four seeded groups render (overdue included — the at-risk truth) —
  // one per due date, all the same compliance type. The demo-only category
  // filter and timeline toggle are absent; search is compliance-name only.
  const board = page.locator('table');
  await expect(board.getByText(COMPLIANCE_NAME).first()).toBeVisible();
  await expect(board).toContainText('Overdue by 10 days'); // filed group
  await expect(board).toContainText('Overdue by 2 days'); // at-risk group
  await expect(board).toContainText('Due in 3 days'); // waiting group
  await expect(board).toContainText('Due in 5 days'); // not-started group
  await expect(page.getByText('4 deadline groups · 4 client obligations')).toBeVisible();
  await expect(page.getByPlaceholder('Search compliance…')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Timeline' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Payroll' })).toHaveCount(0);

  // Search filters by compliance name only.
  await page.getByPlaceholder('Search compliance…').fill('zzz');
  await expect(page.getByText('No deadlines match')).toBeVisible();
  await page.getByRole('button', { name: 'Clear search' }).click();
  await expect(board.getByText(COMPLIANCE_NAME).first()).toBeVisible();

  // Drill the waiting group (due +3) on the canonical groupId.
  await page.locator('tr', { hasText: 'Due in 3 days' }).first().click();
  await expect(page).toHaveURL(
    `/deadlines/${encodeURIComponent(DRILL_GROUP_ID)}/clients`,
  );
  await expect(
    page.getByRole('heading', { name: `${COMPLIANCE_NAME} — All clients` }),
  ).toBeVisible();

  // The seeded instance row: client / entity / period / DM-SM-04 state / due.
  const row = page.locator('tr', { hasText: CLIENT_NAME });
  await expect(row).toContainText(ENTITY_NAME);
  await expect(row).toContainText('FY 2028-29');
  await expect(row).toContainText('Information Requested');
  await expect(row).toContainText('Due in 3 days');

  // The live filter chips map to the DM-SM-04 equivalents.
  await page.getByRole('button', { name: /^Blocked / }).click();
  await expect(page.locator('tr', { hasText: CLIENT_NAME })).toContainText('Information Requested');
  await page.getByRole('button', { name: /^Ready / }).click();
  await expect(page.getByText('No clients in this state — nice.')).toBeVisible();

  // Demo-only affordances stay off in live mode.
  await expect(page.getByRole('button', { name: /export csv/i })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /nudge/i })).toHaveCount(0);

  await context.close();
});

test('TEST-E2E-10 — Morning Brief renders the approved counters and the H2–H6 deferred absences', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  await clearFactors(PARTNER);

  const context = await browser.newContext();
  const page = await context.newPage();
  // Sign-in lands on /brief — the live Morning Brief.
  await signInWithMfa(page, PARTNER_EMAIL);

  // Real identity greeting (no fixture persona).
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    `Good Morning, ${PARTNER_NAME}.`,
  );
  await expect(page.getByText(FIRM_NAME).first()).toBeVisible();

  // H3: exactly the three approved counters.
  const posture = page.getByRole('group', { name: "Today's posture" });
  await expect(posture.getByRole('button', { name: /At-risk deadlines/ })).toContainText('1');
  await expect(posture.getByRole('button', { name: /Pending reviews/ })).toContainText('1');
  await expect(posture.getByRole('button', { name: /Active alerts/ })).toContainText('1');

  // Live tiles: at-risk + open obligations, waiting-for-clients, pending
  // review, and the live deadline board groups.
  const brief = page.getByRole('region', { name: 'Brief summary' });
  await expect(brief).toContainText('4 open compliance obligations in your scope');
  await expect(brief).toContainText('clients with open items');
  await expect(brief).toContainText('items pending review');
  await expect(brief.getByText(COMPLIANCE_NAME).first()).toBeVisible();

  // H2: the hard-coded attention count is gone — no replacement number.
  await expect(page.getByText(/items need attention today/)).toHaveCount(0);
  // H3: no synthetic posture split.
  await expect(page.getByText('On Track')).toHaveCount(0);
  await expect(page.getByText('684')).toHaveCount(0);
  // H4/H5: Team Overload and Billing are explicit deferred tiles.
  await expect(
    page.getByText('Team workload analytics arrive with a later release.'),
  ).toBeVisible();
  await expect(page.getByText('Billing and receivables arrive with a later release.')).toBeVisible();
  await expect(page.getByText(/₹8\.4/)).toHaveCount(0);
  // H6: the Attention List is a deferred panel.
  await expect(
    page.getByText('Attention list — coming in a later release'),
  ).toBeVisible();
  await expect(page.getByText(/Generated 8:58 AM/)).toHaveCount(0);

  await context.close();
});

test('TEST-E2E-10 (role truthfulness) — a billing sign-in sees truthful zeros and empty states', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  await clearFactors(BILLING);

  const context = await browser.newContext();
  const page = await context.newPage();
  await signInWithMfa(page, BILLING_EMAIL);

  // Billing has no table access — the approved behavior is truthful zeros,
  // never an error and never a fixture number (API-ERR-02, H1/H3).
  await page.goto('/command');
  const health = page.getByRole('region', { name: 'Compliance Health' });
  await expect(health.locator('.text-stat-xl')).toHaveText('0');
  await expect(health).toContainText('open compliance obligations');
  await expect(page.getByRole('region', { name: 'Review Queue' })).toContainText(
    '0 items awaiting review',
  );
  await expect(page.getByRole('region', { name: 'Firm Risk Alerts' })).toContainText('0 active');
  await expect(
    page.getByText('No upcoming deadlines — no open compliance obligations are scheduled.'),
  ).toBeVisible();
  await expect(
    page.getByText('No client dependencies — nothing is waiting on clients right now.'),
  ).toBeVisible();
  // No error surface and no fixture artifact leaks through.
  await expect(page.getByText(/Could not load/)).toHaveCount(0);
  await expect(page.getByText('Last synced 09:12')).toHaveCount(0);

  // The deadlines board renders its truthful empty state.
  await page.goto('/deadlines');
  await expect(page.getByText('No upcoming deadlines')).toBeVisible();
  await expect(page.getByText('No open compliance obligations are scheduled in your scope.')).toBeVisible();

  await context.close();
});
