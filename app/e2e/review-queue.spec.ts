/**
 * IMP-041 PASS C — TEST-E2E-08: review submit + decision (approve and
 * return) against the LOCAL Supabase stack (port-3100 supabase-mode dev
 * server; playwright.config.ts `review-queue` project, included only when
 * the loopback stack is up).
 *
 * Flow under test (real application, real RPCs):
 *   1. PARTNER (firm-wide submit, RLS-RVW-01) signs in and submits TWO
 *      review items through the Review Queue submission dialog —
 *      submit_review_item via the @/data boundary, never a direct insert;
 *   2. SUPER_ADMIN (firm-wide decide, a DIFFERENT live membership —
 *      RLS-4EY-04 four-eyes) signs in, approves the first item with a
 *      rationale and returns the second with a rationale through
 *      decide_review_item;
 *   3. the database state is verified with psql: statuses, rationales,
 *      server-derived submitter/decider memberships.
 *
 * Harness mechanics (setup only, never the flow under test): service-role
 * admin calls clear TOTP factors so the mandatory-MFA path is
 * deterministically the ENROLMENT screen; psql seeds the
 * firm/membership/profile/client rows and cleans them up afterwards.
 * audit_log rows are immutable by design and wiped by the next harness
 * reset — never deleted here.
 *
 * Identities come from tests/harness/registry.json — non-secret LOCAL
 * fixture accounts; never real credentials.
 *
 * NOTE on parallel safety: this suite seeds FIRM_B (the client360 suite
 * owns FIRM_A) so project-parallel runs never race on firm rows.
 *
 * The second test (PASS C.1) proves the lower-role submission path: a SENIOR
 * cannot enumerate clients (clients SELECT RLS excludes the role — the PASS
 * C.1 root cause), so the dialog offers an ASSIGNED-WORK subject picker
 * (taskService, RLS-TSK-01 scope); the submission sends taskId only and the
 * server derives client_id from the task. Own item visible; no decision
 * controls.
 */
import { expect, test } from '@playwright/test';

import {
  adminDeleteFactor,
  adminListFactors,
  FIRM_B,
  PASSWORD,
  psql,
  totpCode,
  userEmail,
  userId,
} from '../tests/integration/helpers.mjs';

const PARTNER = userId('USER_B_PARTNER');
const PARTNER_EMAIL = userEmail('USER_B_PARTNER');
const ADMIN = userId('USER_B_SUPER_ADMIN');
const ADMIN_EMAIL = userEmail('USER_B_SUPER_ADMIN');
const SENIOR = userId('USER_B_SENIOR');
const SENIOR_EMAIL = userEmail('USER_B_SENIOR');

const PARTNER_MEMBERSHIP = 'e4400000-0000-4000-8000-0000000000e4';
const ADMIN_MEMBERSHIP = 'e4400000-0000-4000-8000-0000000000e5';
const SENIOR_MEMBERSHIP = 'e4400000-0000-4000-8000-0000000000e6';
const CLIENT_ID = 'c4400000-0000-4000-8000-0000000000c4';
const SENIOR_TASK_ID = '73300000-0000-4000-8000-000000000073';

const CLIENT_NAME = 'E2E Review Client';
const ITEM_ONE = 'E2E review item — approve me';
const ITEM_TWO = 'E2E review item — return me';
const APPROVE_RATIONALE = 'E2E approve: schedules tie out.';
const RETURN_RATIONALE = 'E2E return: please attach the revised register.';
const SENIOR_TASK_TITLE = 'E2E assigned task — GST filing';
const SENIOR_ITEM = 'E2E senior task-linked item';

async function signInWithMfa(page: import('@playwright/test').Page, email: string) {
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

/** Submit one ad-hoc item through the dialog (business inputs only). */
async function submitItem(
  page: import('@playwright/test').Page,
  typeLabel: string,
  title: string,
) {
  await page.getByRole('button', { name: /Submit for review/ }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Client').click();
  await page.getByRole('option', { name: CLIENT_NAME }).click();
  await dialog.getByLabel('Work type').click();
  await page.getByRole('option', { name: typeLabel }).click();
  await dialog.getByLabel('Title').fill(title);
  await dialog.getByRole('button', { name: 'Submit for review' }).click();
  await expect(dialog).not.toBeVisible();
}

test.beforeAll(async () => {
  psql(`
    insert into public.firms (id, name) values ('${FIRM_B}', 'E2E Review Firm B')
    on conflict (id) do nothing;
    insert into public.firm_memberships (id, firm_id, user_id, role, status) values
      ('${PARTNER_MEMBERSHIP}', '${FIRM_B}', '${PARTNER}', 'partner', 'active'),
      ('${ADMIN_MEMBERSHIP}', '${FIRM_B}', '${ADMIN}', 'super_admin', 'active'),
      ('${SENIOR_MEMBERSHIP}', '${FIRM_B}', '${SENIOR}', 'senior', 'active')
    on conflict (firm_id, user_id) do nothing;
    insert into public.profiles (id, full_name) values
      ('${PARTNER}', 'E2E Review Partner'),
      ('${ADMIN}', 'E2E Review Admin'),
      ('${SENIOR}', 'E2E Review Senior')
    on conflict (id) do nothing;
    insert into public.clients (id, firm_id, name, owner_partner_membership_id, status)
    values ('${CLIENT_ID}', '${FIRM_B}', '${CLIENT_NAME}', '${PARTNER_MEMBERSHIP}', 'active')
    on conflict (id) do nothing;
    insert into public.tasks (id, firm_id, client_id, title, next_action, status, assignee_membership_id)
    values ('${SENIOR_TASK_ID}', '${FIRM_B}', '${CLIENT_ID}', '${SENIOR_TASK_TITLE}', 'File GSTR-1', 'open', '${SENIOR_MEMBERSHIP}')
    on conflict (id) do nothing;
  `);
  // Deterministic enrolment: no leftover factors from standalone re-runs.
  for (const u of [PARTNER, ADMIN, SENIOR]) {
    for (const f of await adminListFactors(u)) {
      await adminDeleteFactor(u, f.id);
    }
  }
});

test.afterAll(async () => {
  psql(`
    delete from public.review_items where firm_id = '${FIRM_B}';
    delete from public.tasks where id = '${SENIOR_TASK_ID}';
    delete from public.clients where id = '${CLIENT_ID}';
    delete from public.firm_memberships where id in ('${PARTNER_MEMBERSHIP}', '${ADMIN_MEMBERSHIP}', '${SENIOR_MEMBERSHIP}');
    delete from public.profiles where id in ('${PARTNER}', '${ADMIN}', '${SENIOR}');
    delete from public.firms where id = '${FIRM_B}';
  `);
  for (const u of [PARTNER, ADMIN, SENIOR]) {
    for (const f of await adminListFactors(u)) {
      await adminDeleteFactor(u, f.id);
    }
  }
});

test('TEST-E2E-08 — review submit + approve + return through the real UI and RPCs', async ({
  browser,
}) => {
  test.setTimeout(120_000);

  // --- Step 1: PARTNER submits two items --------------------------------
  const partnerContext = await browser.newContext();
  const partnerPage = await partnerContext.newPage();
  await signInWithMfa(partnerPage, PARTNER_EMAIL);

  await partnerPage.goto('/review');
  await expect(
    partnerPage.getByRole('heading', { name: 'Review Queue', exact: true }),
  ).toBeVisible();
  // Fresh firm → truthful empty state, no invented counts.
  await expect(partnerPage.getByText('0 items awaiting review')).toBeVisible();

  await submitItem(partnerPage, 'GST Reconciliation', ITEM_ONE);
  await expect(partnerPage.getByText('1 items awaiting review')).toBeVisible();
  await submitItem(partnerPage, 'TDS Return', ITEM_TWO);
  await expect(partnerPage.getByText('2 items awaiting review')).toBeVisible();

  // Four-eyes (RLS-4EY-04): the partner submitted both items, so the UI may
  // offer decision controls by role — the SERVER still refuses self-decision.
  // (That refusal is proven by the PASS-B integration matrix; here the
  // decider is simply a different membership.)

  // --- Step 2: SUPER_ADMIN decides both ----------------------------------
  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  await signInWithMfa(adminPage, ADMIN_EMAIL);

  await adminPage.goto('/review');
  await expect(adminPage.getByText('2 items awaiting review')).toBeVisible();

  // Approve item one — rationale mandatory (client guard mirrors the RPC).
  // (Rows are buttons; the inspector heading repeats the title, so select
  // by role to avoid strict-mode ambiguity.)
  await adminPage.getByRole('button', { name: new RegExp(ITEM_ONE) }).click();
  await adminPage.getByRole('button', { name: 'Approve', exact: true }).click();
  const approveConfirm = adminPage.getByRole('button', { name: 'Confirm approval' });
  await expect(approveConfirm).toBeDisabled();
  await adminPage.getByLabel('Approval rationale').fill(APPROVE_RATIONALE);
  await expect(approveConfirm).toBeEnabled();
  await approveConfirm.click();
  // Non-optimistic (API-MUT-02): the row leaves only after the RPC + re-read.
  await expect(adminPage.getByText('1 items awaiting review')).toBeVisible();

  // Return item two.
  await adminPage.getByRole('button', { name: new RegExp(ITEM_TWO) }).click();
  await adminPage.getByRole('button', { name: 'Return', exact: true }).click();
  const returnConfirm = adminPage.getByRole('button', { name: /Return to/ });
  await expect(returnConfirm).toBeDisabled();
  await adminPage.getByLabel('Return reason').fill(RETURN_RATIONALE);
  await expect(returnConfirm).toBeEnabled();
  await returnConfirm.click();
  await expect(
    adminPage.getByText(/Review queue is clear — nice work\./),
  ).toBeVisible();

  // --- Step 3: database truth --------------------------------------------
  const rows = psql(`
    select title || '|' || status || '|' || coalesce(decision_rationale, '')
      || '|' || submitted_by_membership_id || '|' || coalesce(decided_by_membership_id::text, '')
    from public.review_items where firm_id = '${FIRM_B}' order by title;
  `).trim().split('\n');
  expect(rows).toEqual([
    `${ITEM_ONE}|approved|${APPROVE_RATIONALE}|${PARTNER_MEMBERSHIP}|${ADMIN_MEMBERSHIP}`,
    `${ITEM_TWO}|returned|${RETURN_RATIONALE}|${PARTNER_MEMBERSHIP}|${ADMIN_MEMBERSHIP}`,
  ]);
  // Server-controlled invariants (SCH-17): human source, no ai provenance.
  const posture = psql(`
    select count(*) from public.review_items
    where firm_id = '${FIRM_B}' and (source <> 'human' or ai_output_id is not null);
  `).trim();
  expect(posture).toBe('0');

  await partnerContext.close();
  await adminContext.close();
});

test('PASS C.1 — senior submits against assigned work; client server-derived; no decision controls', async ({
  browser,
}) => {
  test.setTimeout(120_000);

  const seniorContext = await browser.newContext();
  const seniorPage = await seniorContext.newPage();
  await signInWithMfa(seniorPage, SENIOR_EMAIL);

  await seniorPage.goto('/review');
  await expect(
    seniorPage.getByRole('heading', { name: 'Review Queue', exact: true }),
  ).toBeVisible();
  // Senior sees own submissions only (RLS-RVW-01) — nothing yet.
  await expect(seniorPage.getByText('0 items awaiting review')).toBeVisible();

  // PASS C.1 ruling: the subject picker is the senior's ASSIGNED WORK
  // (taskService, RLS-TSK-01 scope) — never a client list, which clients RLS
  // does not expose to this role.
  await seniorPage.getByRole('button', { name: /Submit for review/ }).click();
  const dialog = seniorPage.getByRole('dialog');
  await expect(dialog.getByLabel('Assigned work item')).toBeVisible();
  await expect(dialog.getByLabel('Client')).toHaveCount(0);

  await dialog.getByLabel('Assigned work item').click();
  await seniorPage.getByRole('option', { name: new RegExp(SENIOR_TASK_TITLE) }).click();
  await dialog.getByLabel('Work type').click();
  await seniorPage.getByRole('option', { name: 'GST Reconciliation' }).click();
  await dialog.getByLabel('Title').fill(SENIOR_ITEM);
  await dialog.getByRole('button', { name: 'Submit for review' }).click();
  await expect(dialog).not.toBeVisible();
  await expect(seniorPage.getByText('1 items awaiting review')).toBeVisible();

  // Own submission is visible; decision controls are not (role-truthful UI —
  // the RPC's four-eyes/role checks remain the authority regardless).
  await seniorPage.getByRole('button', { name: new RegExp(SENIOR_ITEM) }).click();
  await expect(seniorPage.getByRole('button', { name: 'Approve', exact: true })).toHaveCount(0);
  await expect(seniorPage.getByRole('button', { name: 'Return', exact: true })).toHaveCount(0);

  // Database truth: the submission carried taskId ONLY — client_id was
  // derived server-side from the linked task (SCH-17 subject binding).
  const row = psql(`
    select task_id || '|' || client_id || '|' || submitted_by_membership_id
      || '|' || status || '|' || source
    from public.review_items where firm_id = '${FIRM_B}' and title = '${SENIOR_ITEM}';
  `).trim();
  expect(row).toBe(
    `${SENIOR_TASK_ID}|${CLIENT_ID}|${SENIOR_MEMBERSHIP}|pending|human`,
  );

  await seniorContext.close();
});
