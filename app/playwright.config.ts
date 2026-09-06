import { execSync } from 'node:child_process';

import { defineConfig } from '@playwright/test';

/**
 * IMP-001 Playwright foundation; IMP-011 staff-auth project.
 *
 * Two projects:
 *   chromium   — app-shell smoke on the fixture demo (port 3000).
 *   staff-auth — IMP-011 staff authentication against the LOCAL Supabase
 *                stack (port 3100, VITE_DATA_SOURCE=supabase). Included
 *                only when the local stack is running and loopback-bound;
 *                never points at hosted Supabase.
 *
 * Business-flow E2E coverage (TEST-E2E-01…12 in docs/spec/11-testing-harness.md)
 * lands with the IMP packages that own each flow; so far:
 *   client360    — IMP-022, TEST-E2E-03…05 (client → entity → registration)
 *   review-queue — IMP-041, TEST-E2E-08 (review submit → approve → return)
 *   my-work      — IMP-042, TEST-E2E-07 (task assignment + update) and
 *                  TEST-E2E-09 (My Work buckets render)
 *
 * Browser binaries are intentionally NOT installed by IMP-001 — run
 * `npx playwright install chromium` before first use (Harness Gate / CI).
 */

/** Discover local Supabase client-safe env; null when the stack is down. */
function discoverLocalSupabase(): { apiUrl: string; anonKey: string } | null {
  try {
    const out = execSync('npx supabase status -o env', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    const env: Record<string, string> = {};
    for (const line of out.split('\n')) {
      const m = line.match(/^([A-Z_]+)="(.*)"$/);
      if (m) env[m[1]] = m[2];
    }
    if (!env.API_URL || !env.ANON_KEY) return null;
    if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(env.API_URL)) return null;
    return { apiUrl: env.API_URL, anonKey: env.ANON_KEY };
  } catch {
    return null;
  }
}

const supabase = discoverLocalSupabase();
if (!supabase) {
  console.warn('[playwright] local Supabase not reachable — staff-auth project skipped');
}

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'list' : 'html',
  use: {
    baseURL: 'http://localhost:3000',
  },
  projects: [
    {
      name: 'chromium',
      testMatch: 'smoke.spec.ts',
      use: { browserName: 'chromium', baseURL: 'http://localhost:3000' },
    },
    ...(supabase
      ? [
          {
            name: 'staff-auth',
            testMatch: 'staff-auth.spec.ts',
            use: { browserName: 'chromium' as const, baseURL: 'http://127.0.0.1:3100' },
          },
          {
            // IMP-022: TEST-E2E-03…05 (client → entity → registration).
            name: 'client360',
            testMatch: 'client360.spec.ts',
            use: { browserName: 'chromium' as const, baseURL: 'http://127.0.0.1:3100' },
          },
          {
            // IMP-041: TEST-E2E-08 (review submit → approve → return).
            // Longer expect window: the fresh 3100 dev server cold-transforms
            // the route on first navigation.
            name: 'review-queue',
            testMatch: 'review-queue.spec.ts',
            expect: { timeout: 30_000 },
            use: { browserName: 'chromium' as const, baseURL: 'http://127.0.0.1:3100' },
          },
          {
            // IMP-042: TEST-E2E-07 (task assignment + update) and
            // TEST-E2E-09 (My Work buckets). Same 3100 supabase-mode server;
            // the spec owns a private firm (a4200000-…) so project-parallel
            // runs never race review-queue (FIRM_B) or client360 (FIRM_A).
            name: 'my-work',
            testMatch: 'my-work.spec.ts',
            expect: { timeout: 30_000 },
            use: { browserName: 'chromium' as const, baseURL: 'http://127.0.0.1:3100' },
          },
        ]
      : []),
  ],
  webServer: [
    {
      // IMP-014: no default mode exists (MIG-DS-05) — the fixture demo
      // track must be selected explicitly.
      command: 'VITE_DATA_SOURCE=fixture npm run dev',
      url: 'http://localhost:3000',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    ...(supabase
      ? [
          {
            command:
              `VITE_DATA_SOURCE=supabase VITE_SUPABASE_URL=${supabase.apiUrl} ` +
              `VITE_SUPABASE_ANON_KEY=${supabase.anonKey} npm run dev -- --port 3100 --strictPort`,
            url: 'http://127.0.0.1:3100',
            // Never reuse: the Supabase-mode env must be fresh for every run.
            reuseExistingServer: false,
            timeout: 60_000,
          },
        ]
      : []),
  ],
});
