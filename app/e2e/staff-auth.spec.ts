import { createRequire } from 'node:module';

import { expect, test } from '@playwright/test';

/**
 * IMP-011 — Staff authentication browser flow against the LOCAL Supabase
 * stack (VITE_DATA_SOURCE=supabase dev server on port 3100, started by
 * playwright.config.ts only when the local stack is reachable).
 *
 * Covers, at browser level: auth-level route protection (unauthenticated
 * redirect), invalid-credential rejection, and a valid deterministic
 * harness login landing on the mandatory MFA enrolment gate (AUTH-10
 * client-side stub — harness users have no TOTP factor).
 *
 * Credentials come from tests/harness/registry.json — non-secret LOCAL
 * fixture identities; never real accounts.
 *
 * NOT the TEST-E2E-01…12 business-flow suite — those land with their
 * owning IMP packages.
 */
const require = createRequire(import.meta.url);
const registry = require('../tests/harness/registry.json') as {
  users: Record<string, { email: string }>;
  passwordLocalOnly: string;
};

const STAFF_EMAIL: string = registry.users.USER_A_SENIOR.email;
const STAFF_PASSWORD: string = registry.passwordLocalOnly;

test('unauthenticated visit to an app route redirects to staff sign-in', async ({ page }) => {
  await page.goto('/brief');
  await expect(page).toHaveURL(/\/auth\/sign-in$/);
  await expect(page.getByText('Staff sign-in. Access is by invitation only.')).toBeVisible();
});

test('invalid password is rejected with an error', async ({ page }) => {
  await page.goto('/auth/sign-in');
  await page.getByLabel('Email').fill(STAFF_EMAIL);
  await page.getByLabel('Password').fill('definitely-wrong-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText(/invalid login credentials/i)).toBeVisible();
  await expect(page).toHaveURL(/\/auth\/sign-in$/);
});

test('valid staff login lands on the mandatory MFA enrolment gate', async ({ page }) => {
  await page.goto('/auth/sign-in');
  await page.getByLabel('Email').fill(STAFF_EMAIL);
  await page.getByLabel('Password').fill(STAFF_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  // Harness users have no TOTP factor -> client-side mandatory-MFA stub
  // routes them to enrolment before any app content renders.
  await expect(page).toHaveURL(/\/auth\/mfa-enroll$/);
  await expect(page.getByText('Set up two-factor authentication')).toBeVisible();
});
