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

// IMP-022: fixture-track Client 360 boots and shows demo content
// (the demo experience must stay intact in fixture mode).
test('fixture Client 360 boots from the clients list', async ({ page }) => {
  await page.goto('/clients');
  await expect(page.getByRole('heading', { name: 'Clients' })).toBeVisible();
  await page.getByText('ABC Pvt Ltd').first().click();
  await expect(page).toHaveURL(/\/clients\/c-abc$/);
  await expect(page.getByRole('heading', { name: 'ABC Pvt Ltd' })).toBeVisible();
  await expect(page.getByText(/PAN AABCA1234F/)).toBeVisible();
});
