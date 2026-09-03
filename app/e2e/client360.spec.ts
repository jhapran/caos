/**
 * IMP-022 — Client 360 business-flow E2E against the LOCAL Supabase stack
 * (TEST-E2E-03 create/view client, TEST-E2E-04 create/view legal entity,
 * TEST-E2E-05 registration workflow — create + view on Client 360).
 *
 * Runs on the port-3100 supabase-mode dev server (playwright.config.ts
 * `client360` project, included only when the loopback stack is up).
 *
 * Harness mechanics (setup only, never the flow under test):
 *   - service-role admin calls remove any existing TOTP factors so the
 *     mandatory-MFA path is deterministically the ENROLMENT screen
 *     (db:reset:harness guarantees none; standalone re-runs stay clean);
 *   - the enrolment secret is read from the page and the TOTP code is
 *     generated with the same helper as the integration MFA suite;
 *   - psql seeds only the firm/membership/profile rows the flow needs
 *     and cleans up the created client rows afterwards.
 *
 * Identities come from tests/harness/registry.json — non-secret LOCAL
 * fixture accounts; never real credentials.
 */
import { expect, test } from '@playwright/test';

import {
  adminDeleteFactor,
  adminListFactors,
  FIRM_A,
  PASSWORD,
  psql,
  totpCode,
  userEmail,
  userId,
} from '../tests/integration/helpers.mjs';

const PARTNER = userId('USER_A_PARTNER');
const EMAIL = userEmail('USER_A_PARTNER');
const MEMBERSHIP = 'e2200000-0000-4000-8000-0000000000e2';

const CLIENT_NAME = 'E2E Client Alpha';
const ENTITY_NAME = 'E2E Alpha Pvt Ltd';
const PAN_VALUE = 'AAACE0001A';

async function enrollTotp(page: import('@playwright/test').Page) {
  // Mandatory MFA gate (AUTH-10): enroll TOTP through the real UI.
  await expect(page).toHaveURL(/\/auth\/mfa-enroll$/);
  const secret = await page.locator('p.font-mono').textContent();
  expect(secret).toBeTruthy();
  await page.getByLabel('Authenticator code').fill(totpCode(secret!.trim()));
  await page.getByRole('button', { name: 'Verify and continue' }).click();
  await expect(page).toHaveURL(/\/brief$/);
}

test.beforeAll(() => {
  psql(`
    insert into public.firms (id, name) values ('${FIRM_A}', 'E2E Client360 Firm A')
    on conflict (id) do nothing;
    insert into public.firm_memberships (id, firm_id, user_id, role, status) values
      ('${MEMBERSHIP}', '${FIRM_A}', '${PARTNER}', 'partner', 'active')
    on conflict (firm_id, user_id) do nothing;
    insert into public.profiles (id, full_name) values ('${PARTNER}', 'E2E Partner Alpha')
    on conflict (id) do nothing;
  `);
});

test.afterAll(async () => {
  // Remove rows this flow created (FK order), plus the seeded firm row
  // and the enrolled TOTP factor — standalone suite ordering (e2e →
  // tenancy, staff-auth re-runs) must never see leftover state. audit_log
  // rows are immutable by design and are wiped by the next harness reset.
  psql(`
    delete from public.registrations where firm_id = '${FIRM_A}'
      and legal_entity_id in (select id from public.legal_entities where firm_id = '${FIRM_A}' and legal_name = '${ENTITY_NAME}');
    delete from public.legal_entities where firm_id = '${FIRM_A}' and legal_name = '${ENTITY_NAME}';
    delete from public.clients where firm_id = '${FIRM_A}' and name = '${CLIENT_NAME}';
    delete from public.firm_memberships where id = '${MEMBERSHIP}';
    delete from public.profiles where id = '${PARTNER}';
    delete from public.firms where id = '${FIRM_A}';
  `);
  for (const f of await adminListFactors(PARTNER)) {
    await adminDeleteFactor(PARTNER, f.id);
  }
});

test('TEST-E2E-03/04/05 — create + view client, legal entity, registration', async ({ page }) => {
  // Clean any factor from a previous standalone run so the mandatory-MFA
  // stub deterministically presents enrolment.
  for (const f of await adminListFactors(PARTNER)) {
    await adminDeleteFactor(PARTNER, f.id);
  }

  await page.goto('/auth/sign-in');
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await enrollTotp(page);

  // --- TEST-E2E-03: create + view client -------------------------------
  await page.goto('/clients');
  await expect(page.getByRole('heading', { name: 'Clients', exact: true })).toBeVisible();
  await expect(page.getByText('No clients found')).toBeVisible();

  await page.getByRole('button', { name: /New client/ }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Client name').fill(CLIENT_NAME);
  await dialog.getByLabel('Industry').fill('E2E Manufacturing');
  await dialog.getByRole('combobox').nth(1).click();
  await page.getByRole('option', { name: 'E2E Partner Alpha' }).click();
  await dialog.getByRole('button', { name: 'Create client' }).click();

  await expect(page).toHaveURL(/\/clients\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { name: CLIENT_NAME })).toBeVisible();
  // Overview resolves the partner DISPLAY NAME — never a membership UUID.
  // Scoped to <main>: the sidebar user chip now also truthfully shows the
  // signed-in user's real name (staging UI truthfulness closure).
  await expect(page.getByRole('main').getByText('E2E Partner Alpha')).toBeVisible();

  // --- TEST-E2E-04: create + view legal entity --------------------------
  await page.getByRole('tab', { name: /Entities & identifiers/ }).click();
  await page.getByRole('button', { name: 'Add legal entity' }).click();
  const entityDialog = page.getByRole('dialog');
  await entityDialog.getByLabel('Legal name').fill(ENTITY_NAME);
  await entityDialog.getByRole('button', { name: 'Add entity' }).click();
  await expect(page.getByText(ENTITY_NAME)).toBeVisible();

  // --- TEST-E2E-05: registration workflow (create + view) ---------------
  await page.getByRole('button', { name: 'Add registration' }).click();
  const regDialog = page.getByRole('dialog');
  await regDialog.getByLabel('Identifier').fill(PAN_VALUE);
  await regDialog.getByRole('button', { name: 'Add registration' }).click();
  await expect(page.getByText(PAN_VALUE)).toBeVisible();

  // Reload: the composite re-reads from the database (API-RT-02).
  await page.reload();
  await expect(page.getByRole('heading', { name: CLIENT_NAME })).toBeVisible();
  await expect(page.getByText(/PAN AAACE0001A/)).toBeVisible();
});
