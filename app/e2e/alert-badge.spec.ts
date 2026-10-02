/**
 * IMP-062 — Alert badge/count freshness E2E (API-RT-01(b)) against the
 * LOCAL Supabase stack (port-3100 supabase-mode dev server;
 * playwright.config.ts `alert-badge` project, included only when the
 * loopback stack is up). The browser/E2E analog of the review-queue
 * API-RT-07 freshness spec.
 *
 * Flow under test (real application, real R1-B transport):
 *   1. PARTNER signs in through the real MFA-enrolment UI and keeps any
 *      shell page open — the Layout alert bell subscribes through
 *      subscribeAlerts (IMP-062 R1-B private firm-topic channel + the
 *      always-on API-RT-07 polling backstop);
 *   2. alerts appear and resolve from OUTSIDE the browser session (psql
 *      operator writes — alert CREATION has no browser path in R0; the
 *      IMP-051 evaluator is the production writer; status moves here carry
 *      the SCH-18 resolution triple per the lifecycle CHECK);
 *   3. the bell count becomes current WITHOUT any reload — bare
 *      invalidation → authoritative listAlerts RLS refetch — and always
 *      converges to the RLS-scoped database count.
 *
 * Harness mechanics (setup only, never the flow under test): service-role
 * admin calls clear TOTP factors so the mandatory-MFA path is
 * deterministically the ENROLMENT screen; psql seeds the
 * firm/membership rows and cleans them up afterwards. audit_log rows are
 * immutable by design and wiped by the next harness reset — never deleted
 * here.
 *
 * NOTE on parallel safety: this suite owns a private firm (a4500000-…) and
 * uses USER_MULTI_FIRM — no other e2e project signs in with that identity,
 * so project-parallel runs never race on firm rows or MFA factors.
 */
import { expect, test } from '@playwright/test';

import {
  adminDeleteFactor,
  adminListFactors,
  PASSWORD,
  psql,
  totpCode,
  userEmail,
  userId,
} from '../tests/integration/helpers.mjs';

const OBSERVER = userId('USER_MULTI_FIRM');
const OBSERVER_EMAIL = userEmail('USER_MULTI_FIRM');

const FIRM = 'a4500000-0000-4000-8000-0000000000f1';
const MEMBERSHIP = 'a4500000-0000-4000-8000-0000000000b1';
// Two alert rows are simultaneously ACTIVE in this flow — the HRR-06=A
// structural dedupe index (alerts_nonresolved_dedupe_unique over
// (firm_id, alert_rule_id, client_id, compliance_instance_id)) requires
// distinct client anchors.
const CLIENT_ONE = 'a4500000-0000-4000-8000-0000000000c1';
const CLIENT_TWO = 'a4500000-0000-4000-8000-0000000000c2';

function dbActiveAlerts(): number {
  return Number(
    psql(`select count(*) from public.alerts where firm_id = '${FIRM}' and status = 'active';`).trim(),
  );
}

function raiseAlert(id: string, title: string, clientId: string) {
  psql(`
    insert into public.alerts (id, firm_id, severity, title, detail, client_id)
    values ('${id}', '${FIRM}', 'critical', '${title}', 'IMP-062 alert badge e2e', '${clientId}');
  `);
}

function resolveAlert(id: string) {
  // The SCH-18 guard admits status moves only under the transition-command
  // marker the Layer-B commands / IMP-051 evaluator set.
  psql(`
    set app.alert_transition_command = '1';
    update public.alerts set status = 'resolved', resolution_type = 'auto', resolved_at = now()
    where id = '${id}';
  `);
}

/** The bell's truthful state: its aria-label is "<n> active alerts" once
 *  the first read lands ("Risk alerts" while the count is unknown). */
async function bellLabel(page: import('@playwright/test').Page): Promise<string> {
  const bell = page.getByRole('button', { name: /active alerts|Risk alerts/ });
  return (await bell.getAttribute('aria-label')) ?? '';
}

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

test.beforeAll(() => {
  psql(`
    delete from public.alerts where firm_id = '${FIRM}';
    delete from public.clients where firm_id = '${FIRM}';
    delete from public.firm_memberships where firm_id = '${FIRM}';
    insert into public.firms (id, name) values ('${FIRM}', 'IMP-062 Badge E2E Firm')
    on conflict (id) do nothing;
    insert into public.firm_memberships (id, firm_id, user_id, role, status) values
      ('${MEMBERSHIP}', '${FIRM}', '${OBSERVER}', 'partner', 'active')
    on conflict (firm_id, user_id) do nothing;
    insert into public.clients (id, firm_id, name, owner_partner_membership_id, manager_membership_id, status) values
      ('${CLIENT_ONE}', '${FIRM}', 'E2E Badge Client One', '${MEMBERSHIP}', null, 'active'),
      ('${CLIENT_TWO}', '${FIRM}', 'E2E Badge Client Two', '${MEMBERSHIP}', null, 'active');
  `);
});

test.afterAll(() => {
  psql(`
    delete from public.alerts where firm_id = '${FIRM}';
    delete from public.clients where firm_id = '${FIRM}';
    delete from public.firm_memberships where firm_id = '${FIRM}';
    delete from realtime.messages where topic = 'firm:${FIRM}:alerts';
    delete from public.firms where id = '${FIRM}'
      and not exists (select 1 from public.firm_memberships m where m.firm_id = firms.id)
      and not exists (select 1 from public.clients c where c.firm_id = firms.id)
      and not exists (select 1 from public.alerts a where a.firm_id = firms.id);
  `);
});

test('API-RT-01(b) — alert bell badge becomes current without reload (IMP-062 R1-B + polling backstop)', async ({
  browser,
}) => {
  // Waits allow >2× the production 15s poll interval; production polling is
  // NOT sped up. The R1-B channel normally delivers within seconds; the
  // badge must converge to the RLS-scoped DB count either way.
  test.setTimeout(240_000);

  // Deterministic enrolment for the identity reused by this suite.
  for (const f of await adminListFactors(OBSERVER)) {
    await adminDeleteFactor(OBSERVER, f.id);
  }
  psql(`delete from public.alerts where firm_id = '${FIRM}';`);
  expect(dbActiveAlerts()).toBe(0);

  // --- Session A: observer with a shell page open -------------------------
  const contextA = await browser.newContext();
  const pageA = await contextA.newPage();
  await signInWithMfa(pageA, OBSERVER_EMAIL);
  // The first authoritative read lands: zero active alerts, no badge dot.
  await expect.poll(() => bellLabel(pageA), { timeout: 30_000 }).toBe('0 active alerts');

  // --- An alert appears OUTSIDE the session; the badge moves, no reload ---
  const ALERT_ONE = 'a4500000-0000-4000-8000-0000000000a1';
  const ALERT_TWO = 'a4500000-0000-4000-8000-0000000000a2';
  raiseAlert(ALERT_ONE, 'E2E badge alert one', CLIENT_ONE);
  expect(dbActiveAlerts()).toBe(1);
  await expect.poll(() => bellLabel(pageA), { timeout: 60_000 }).toBe('1 active alerts');
  await expect(pageA.locator('button[aria-label="1 active alerts"] span')).toHaveText('1');

  raiseAlert(ALERT_TWO, 'E2E badge alert two', CLIENT_TWO);
  await expect.poll(() => bellLabel(pageA), { timeout: 60_000 }).toBe('2 active alerts');

  // --- Reverse direction: one resolves; the badge drops without reload ----
  resolveAlert(ALERT_ONE);
  expect(dbActiveAlerts()).toBe(1);
  await expect.poll(() => bellLabel(pageA), { timeout: 60_000 }).toBe('1 active alerts');

  resolveAlert(ALERT_TWO);
  expect(dbActiveAlerts()).toBe(0);
  await expect.poll(() => bellLabel(pageA), { timeout: 60_000 }).toBe('0 active alerts');

  await contextA.close();
});
