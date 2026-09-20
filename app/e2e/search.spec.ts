/**
 * IMP-061 (E2E slice) — TEST-E2E-13: live Command Palette structured search
 * against the LOCAL Supabase stack (port-3100 supabase-mode dev server;
 * playwright.config.ts `search` project, included only when the loopback
 * stack is up).
 *
 * Flow under test (real application: UI → @/data → searchService → the
 * SECURITY INVOKER public.structured_search function under ordinary RLS):
 *   - a PARTNER-role user opens the palette with the existing Ctrl/⌘K
 *     shortcut; a one-character query shows ONLY client-side page shortcuts
 *     (no tenant enumeration, IMP061-R4); a live query returns the six-kind
 *     structured projection: client / legal_entity / registration (masked —
 *     the raw identifier never renders) / task / compliance_instance /
 *     staff;
 *   - R11-A navigation: the client hit carries the ArrowRight affordance and
 *     navigates to /clients/:clientId (palette closes); task,
 *     compliance_instance and staff hits are truthful NON-navigable rows —
 *     'No detail page', no ArrowRight, click does not navigate, Enter does
 *     not navigate, and the palette does not close;
 *   - the offboarded client keeps an explicit Offboarded badge (R10);
 *   - the zero-result state is truthful, and a fixture-only client name
 *     ('ABC Pvt Ltd' — demo track) returns NO results in live mode: no
 *     fixture fallback (MIG-DS-05);
 *   - role truthfulness: a SENIOR-role user sees only assigned work — the
 *     task and the compliance instance (label WITHOUT the compliance-type
 *     name the role cannot read, M1-A) — and no client/entity/registration
 *     hits.
 *
 * Harness mechanics (setup only, never the flow under test): operator psql
 * seeds the private firm (a4400000-…, owned by this spec so project-parallel
 * runs never race other suites); service-role admin calls clear TOTP
 * factors so the mandatory-MFA path is deterministically the ENROLMENT
 * screen. audit_log rows are append-only and wiped by the next harness
 * reset — never deleted here (the deadlines-command precedent).
 *
 * Identities: USER_B_MANAGER (partner-ROLE membership here) and
 * USER_A_ARTICLE (senior-ROLE membership here) — touched by NO other e2e
 * project (registry persona labels describe harness intent only). Local
 * fixture accounts; never real credentials.
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

const PARTNER = userId('USER_B_MANAGER'); // partner-ROLE membership here
const PARTNER_EMAIL = userEmail('USER_B_MANAGER');
const SENIOR = userId('USER_A_ARTICLE'); // senior-ROLE membership here
const SENIOR_EMAIL = userEmail('USER_A_ARTICLE');

const FIRM = 'a4400000-0000-4000-8000-0000000000f1';
const M_PARTNER = 'a4400000-0000-4000-8000-0000000000a1';
const M_SENIOR = 'a4400000-0000-4000-8000-0000000000a2';
const CLIENT = 'a4400000-0000-4000-8000-0000000000c1';
const CLIENT_OFF = 'a4400000-0000-4000-8000-0000000000c2';
const ENTITY = 'a4400000-0000-4000-8000-0000000000e1';
const REGISTRATION = 'a4400000-0000-4000-8000-0000000000d1';
const TASK = 'a4400000-0000-4000-8000-000000000051';
const INSTANCE = 'a4400000-0000-4000-8000-000000000041';

// Seeded system reference type (supabase/seed.sql): 'Income Tax Return' —
// readable by manager-plus only (the M1-A contrast for the senior flow).
const SYS_ITR = '50000000-0000-4000-8000-000000000005';

const RAW_IDENTIFIER = 'E2ESRC1234Z';

// --- Helpers (the deadlines-command.spec.ts precedent) ------------------------

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

function palette(page: Page) {
  return page.getByRole('dialog', { name: 'Command palette' });
}

async function openPaletteAndSearch(page: Page, query: string) {
  const dialog = palette(page);
  // A previous palette may still be in its AnimatePresence EXIT animation
  // after Escape — wait for full removal so the visibility probe below can
  // never mistake the dying element for an open palette.
  await expect(dialog).toHaveCount(0);
  // The Ctrl/⌘K listener attaches with the app shell's mount effect; right
  // after a fresh sign-in navigation a single immediate keypress can land
  // before the listener exists and is lost. Retry the REAL existing
  // shortcut until the palette opens — toggle-safe because a press is only
  // sent while no dialog is mounted.
  await expect(async () => {
    if ((await dialog.count()) === 0) {
      await page.keyboard.press('Control+k');
    }
    await expect(dialog).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  await dialog.locator('input').fill(query);
  return dialog;
}

/** Child → parent cleanup for this spec's PRIVATE firm only. audit_log rows
 *  are never deleted (append-only; wiped by the next harness reset). */
function cleanDomainRows() {
  psql(`
    delete from public.tasks where firm_id = '${FIRM}';
    delete from public.compliance_instances where firm_id = '${FIRM}';
    delete from public.registrations where firm_id = '${FIRM}';
    delete from public.legal_entities where firm_id = '${FIRM}';
    delete from public.clients where firm_id = '${FIRM}';
    delete from public.firm_memberships where firm_id = '${FIRM}';
    delete from public.profiles where id in ('${PARTNER}', '${SENIOR}');
    delete from public.firms where id = '${FIRM}';
  `);
}

// --- Fixtures ------------------------------------------------------------------

test.beforeAll(async () => {
  cleanDomainRows();
  psql(`
    insert into public.firms (id, name) values ('${FIRM}', 'E2E SRC Firm');

    insert into public.profiles (id, full_name) values
      ('${PARTNER}', 'E2E SRC Partner'),
      ('${SENIOR}', 'E2E SRC Senior');

    insert into public.firm_memberships (id, firm_id, user_id, role, status) values
      ('${M_PARTNER}', '${FIRM}', '${PARTNER}', 'partner', 'active'),
      ('${M_SENIOR}', '${FIRM}', '${SENIOR}', 'senior', 'active');

    insert into public.clients (id, firm_id, name, industry, owner_partner_membership_id, status) values
      ('${CLIENT}', '${FIRM}', 'E2E SRC Client', 'Manufacturing', '${M_PARTNER}', 'active'),
      ('${CLIENT_OFF}', '${FIRM}', 'E2E SRC Offboarded', 'Trading', '${M_PARTNER}', 'offboarded');

    insert into public.legal_entities (id, firm_id, client_id, entity_type, legal_name) values
      ('${ENTITY}', '${FIRM}', '${CLIENT}', 'private_limited', 'E2E SRC Entity');

    insert into public.registrations (id, firm_id, legal_entity_id, type, value) values
      ('${REGISTRATION}', '${FIRM}', '${ENTITY}', 'PAN', '${RAW_IDENTIFIER}');

    -- Task/instance fixtures are plain operator INSERTs (the DM-SM-04/05
    -- guards bind UPDATE only — the deadlines/mywork fixture precedent).
    insert into public.tasks
      (id, firm_id, client_id, title, next_action, status, assignee_membership_id)
    values
      ('${TASK}', '${FIRM}', '${CLIENT}', 'E2E SRC Task', 'do the work', 'open', '${M_SENIOR}');

    insert into public.compliance_instances
      (id, firm_id, legal_entity_id, compliance_type_id, period_start, period_end,
       period_label, due_date, state, assignee_membership_id)
    values
      ('${INSTANCE}', '${FIRM}', '${ENTITY}', '${SYS_ITR}', '2026-04-01', '2027-03-31',
       'E2E SRC Period FY 2026-27', ((now() at time zone 'Asia/Kolkata')::date + 30),
       'preparation', '${M_SENIOR}');
  `);
  await clearFactors(PARTNER, SENIOR);
});

test.afterAll(() => {
  cleanDomainRows();
});

// --- TEST-E2E-13 -----------------------------------------------------------------

test('partner: live structured search with R11-A navigable/non-navigable behavior', async ({ page }) => {
  await signInWithMfa(page, PARTNER_EMAIL);

  // Open with the existing shortcut; a one-character query shows ONLY the
  // client-side page shortcuts — no tenant data is enumerated (R4).
  const shortDialog = await openPaletteAndSearch(page, 'E');
  await expect(shortDialog.getByText('E2E SRC Client')).toHaveCount(0);
  await expect(shortDialog.getByText('Clients', { exact: true })).toBeVisible();
  await expect(shortDialog.getByText('No detail page')).toHaveCount(0);
  // Close before reopening — ⌘K toggles.
  await page.keyboard.press('Escape');
  await expect(palette(page)).toHaveCount(0);

  // Live query: the structured projection renders.
  const dialog = await openPaletteAndSearch(page, 'E2E SRC');
  const clientHit = dialog.getByRole('button', { name: /^E2E SRC Client/ });
  await expect(clientHit).toBeVisible();
  // legal_entity (navigable via the parent Client 360)
  await expect(dialog.getByRole('button', { name: /^E2E SRC Entity/ })).toBeVisible();
  // Offboarded client is searchable and truthfully badged (R10).
  await expect(dialog.getByRole('button', { name: /^E2E SRC Offboarded/ })).toBeVisible();
  await expect(dialog.getByText('Offboarded', { exact: true })).toBeVisible();
  // Non-navigable kinds remain visible WITHOUT a navigation affordance:
  // partner reads compliance types, so the instance label carries the type
  // name; staff hits come from the ACTIVE roster.
  await expect(dialog.getByText('E2E SRC Task')).toBeVisible();
  await expect(dialog.getByText('Income Tax Return — E2E SRC Period FY 2026-27')).toBeVisible();
  await expect(dialog.getByText('E2E SRC Partner')).toBeVisible();
  await expect(dialog.getByText('E2E SRC Senior')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(palette(page)).toHaveCount(0);

  // Registration (identifier search, R7): a prefix query on the identifier
  // renders the MASKED form only — the raw value never appears anywhere in
  // the palette DOM.
  const regDialog = await openPaletteAndSearch(page, 'E2ESRC');
  await expect(regDialog.getByRole('button', { name: /PAN ····234Z/ })).toBeVisible();
  await expect(regDialog.getByText(RAW_IDENTIFIER)).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(palette(page)).toHaveCount(0);

  // R11-A: clicking the navigable client hit navigates and closes the palette.
  const navDialog = await openPaletteAndSearch(page, 'E2E SRC');
  await navDialog.getByRole('button', { name: /^E2E SRC Client/ }).click();
  await expect(page).toHaveURL(new RegExp(`/clients/${CLIENT}$`));
  await expect(palette(page)).toHaveCount(0);

  // Reopen: the task hit is non-navigable — no ArrowRight affordance, click
  // does not navigate, Enter does not navigate, palette stays open.
  const dialog2 = await openPaletteAndSearch(page, 'E2E SRC');
  const taskRow = dialog2.locator('li', { hasText: 'E2E SRC Task' });
  await expect(taskRow.getByText('No detail page')).toBeVisible();
  await expect(taskRow.locator('button')).toHaveCount(0);
  const urlBefore = page.url();
  await taskRow.click();
  await expect(page).toHaveURL(urlBefore);
  await expect(dialog2).toBeVisible();
  // Hover sets the active row; Enter on the non-navigable row must not
  // navigate or close the palette.
  await taskRow.hover();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(urlBefore);
  await expect(dialog2).toBeVisible();
  await page.keyboard.press('Escape');

  // Truthful zero-result state + NO fixture fallback in live mode: 'ABC Pvt
  // Ltd' exists only in the demo fixtures and must not appear here.
  const dialog3 = await openPaletteAndSearch(page, 'ABC Pvt');
  await expect(dialog3.getByText('No results for “ABC Pvt”')).toBeVisible();
  await expect(dialog3.getByText('ABC Pvt Ltd')).toHaveCount(0);
});

test('senior: assigned-work visibility only, M1-A period-label match without type-name leak', async ({ page }) => {
  await signInWithMfa(page, SENIOR_EMAIL);

  const dialog = await openPaletteAndSearch(page, 'E2E SRC');
  // Assigned task + assigned instance are visible; the instance label is the
  // period label ONLY — the compliance-type name the senior cannot read
  // never leaks (M1-A).
  await expect(dialog.getByText('E2E SRC Task')).toBeVisible();
  await expect(dialog.getByText('E2E SRC Period FY 2026-27', { exact: true })).toBeVisible();
  await expect(dialog.getByText(/Income Tax Return/)).toHaveCount(0);
  // No client/entity/registration hits under the senior's ordinary RLS.
  await expect(dialog.getByText('E2E SRC Client')).toHaveCount(0);
  await expect(dialog.getByText('E2E SRC Entity')).toHaveCount(0);
  await expect(dialog.getByText(/PAN ····/)).toHaveCount(0);
  // The staff roster of the active firm remains visible (live membership).
  await expect(dialog.getByText('E2E SRC Partner')).toBeVisible();
  // The instance hit is non-navigable (R11-A).
  const instanceRow = dialog.locator('li', { hasText: 'E2E SRC Period FY 2026-27' });
  await expect(instanceRow.getByText('No detail page')).toBeVisible();
});
