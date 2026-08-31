import { defineConfig } from '@playwright/test';

/**
 * IMP-001 Playwright foundation.
 *
 * Only the framework, configuration, and directory convention exist at this
 * stage (per docs/spec/12-release-0-plan.md). Business-flow E2E coverage
 * (TEST-E2E-01…12 in docs/spec/11-testing-harness.md) lands with the IMP
 * packages that own each flow.
 *
 * Browser binaries are intentionally NOT installed by IMP-001 — run
 * `npx playwright install chromium` before first use (Harness Gate / CI).
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'list' : 'html',
  use: {
    baseURL: 'http://localhost:3000',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
