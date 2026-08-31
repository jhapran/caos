import { expect, test } from '@playwright/test';

/**
 * IMP-001 smoke placeholder: proves the E2E harness boots the app shell.
 * Not part of the TEST-E2E-01…12 business-flow suite (spec 11) — those land
 * with their owning IMP packages.
 */
test('app shell boots and serves the landing page', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/CAOS/);
  await expect(page.locator('#root')).not.toBeEmpty();
});
