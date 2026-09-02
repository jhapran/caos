# Harness Gate Evidence — Approval Record

**Date:** 2026-09-01
**Status:** HARNESS GATE: PASS — human approved 2026-09-01.
**Evidence commit:** `305d133` (`test: establish executable Harness Gate`),
independently verified from a fresh detached worktree at the exact committed
HEAD (`npm ci` → `npx playwright install chromium` →
`npm run verify:harness`): PASS — 14/14 phases green, working tree clean
after proof.
**Machine evidence vs human approval:** the machine-generated candidate
evidence below (and `harness-gate-result.json`) is preserved unchanged; this
header records the separate human gate decision. IMP-000…IMP-005 are
COMPLETE; the Harness Engineering phase is COMPLETE. IMP-010+ is UNLOCKED
but NOT STARTED.

## Environment

- Node.js v24.18.0 (aarch64 Linux)
- Supabase CLI 2.116.0; local stack only (project `app`, containers
  `supabase_*_app`, loopback-bound)
- PostgreSQL 17.6 (local container)
- Playwright 1.62.1, Chromium engine only
- Working-tree gate run: 2026-09-01T05:52:44Z → 05:53:43Z
- Fresh-worktree gate run: 2026-09-01T11:28Z (detached worktree + `npm ci`)

Machine-readable phase evidence: `docs/harness/harness-gate-result.json`
(regenerated on every `npm run verify:harness` run).

## Commands

| Command | Purpose |
| --- | --- |
| `npm run verify` | Fast check: lint + unit/component tests + build |
| `npm run test:unit` | Vitest unit/component (`tests/unit`, `tests/components`, jsdom) |
| `npm run test:integration` | All DB/Auth integration tests (node env) |
| `npm run test:auth` | Auth integration suite only |
| `npm run test:rls` | RLS integration suite only |
| `npm run test:e2e` | Playwright smoke (Chromium) |
| `npm run verify:harness` | **Authoritative full Harness Gate** (`scripts/harness/gate.mjs`) |

## Gate phases and results (14/14 green, both runs)

1. **preflight** — node/docker/CLI present; decision evidence present. PASS
2. **stack-lifecycle** — stack already running; preserved afterwards
   (gate stops the stack only if the gate started it). PASS
3. **db-reset-seed** — `npm run db:reset:harness`; 16 deterministic
   identities re-seeded, zero errors/warnings. PASS
4. **decision-evidence** — DEC-J resolved (live membership lookup, spec 05);
   AUD-OQ-02 resolved (layered A+B+C, spec 08); spike reports committed. PASS
5. **lint** — ESLint clean. PASS
6. **unit-tests** — 12/12 passed. PASS
7. **auth-integration** — 9/9 passed. PASS
8. **rls-integration** — 18/18 passed (two consecutive runs, idempotent). PASS
9. **build** — `tsc -b` + Vite production build succeeds. PASS
10. **playwright-smoke** — 1/1 passed (`e2e/smoke.spec.ts`: app shell boots,
    title `/CAOS/`, `#root` non-empty). PASS
11. **network-binding** — all published Supabase services bound to
    127.0.0.1 (docker port inspection + `ss`); no 0.0.0.0/[::] exposure. PASS
12. **mcp-regression** — MCP `initialize` at http://127.0.0.1:54321/mcp
    returns HTTP 200. PASS
13. **db-cleanliness** — no `hgate_*` / `decj_*` / `audctx_*` objects;
    public R0 application table count = 0; 16 deterministic harness
    identities verified via `npm run db:verify:harness`. PASS
14. **secret-scan** — no service-role key or JWT secret values in tracked
    files or `dist/` (TEST-SEC-01 at harness level). PASS

Failure handling: the gate fails fast with non-zero exit, names the failed
phase, and still runs safe cleanup (dogfooded once during development: a
lint failure aborted the gate, cleaned up, exit 1).

## Auth integration harness (TEST-AUTH core, mechanism level)

`tests/integration/auth/auth.test.ts` + `tests/integration/helpers.mjs`,
Vitest node environment, deterministic IMP-003 identities from
`tests/harness/registry.json`. Covered:

- **TEST-AUTH-02** — login: success; invalid password rejected (HTTP 400).
- **TEST-AUTH-09** — session refresh/rotation: refresh succeeds; refreshed
  identity is the same user (JWT `sub` = registry UUID).
- **TEST-AUTH-03** — logout: refresh denied after logout.
- Supporting assertions: authenticated `/user` reaches Supabase (200);
  no-token and garbage-token requests cannot impersonate (>= 400).

Explicitly NOT claimed: invitation (TEST-AUTH-01), password reset
(TEST-AUTH-04), magic link (TEST-AUTH-05), MFA/AAL2 production behavior
(TEST-AUTH-06, TEST-AUTH-07, TEST-AUTH-08, TEST-AUTH-10, TEST-AUTH-11),
session lifetime policy (TEST-AUTH-14, TEST-AUTH-15). No React auth UI was
built.

## RLS integration harness (resolved DEC-J mechanism)

`tests/integration/rls/{setup.sql,teardown.sql,rls.test.ts}`. Harness-only
objects `hgate_firms`, `hgate_memberships`, `hgate_resources`, created and
dropped per run; never production migrations; public R0 table count returns
to 0 after teardown (asserted in the suite and re-checked by the gate).

Mechanism under test is the resolved DEC-J model: `auth.uid()` for
identity; authorization = live membership lookup of (user, selected firm)
for current status/role. The `x-active-firm` request header is untrusted
context and is always validated against live membership. Service-role key
is discovered dynamically and used only for setup/membership
mutation/teardown — never for the request under test.

Automated assertions (18 tests) map to:

- **TEST-RLS-GEN-01** — fixture tenants/roles (deterministic identities,
  multiple firms, role variety).
- **TEST-RLS-GEN-02** — offensive posture: cross-firm read denied,
  known foreign record id (firm B row 201) does not leak, forged
  active-firm selector grants nothing.
- **TEST-RLS-GEN-03** — case set: cross-firm insert/update/delete denied;
  multi-firm Firm A → Firm B → Firm A switching with no bleed;
  staff/client overlap does not inherit unrelated authority.
- **TEST-RLS-GEN-04** — mutation-denial surfacing: denied writes return
  403 / empty results through PostgREST, not silent success.
- **TEST-RLS-MAT-01** — role matrix at mechanism level (billing insert
  denied for unauthorized role; senior delete denied, partner allowed).
- **TEST-AUTH-12, TEST-AUTH-13** — suspended and removed memberships lose
  access **immediately on a pre-issued token** (live lookup, no JWT
  refresh); role downgrade/upgrade take effect on the next authorization
  check.

This is mechanism validation on harness tables, not the production RLS
matrix — the per-table production matrix lands with IMP-012+.

## Playwright smoke

Existing foundation (`e2e/`, `playwright.config.ts`) made executable.
Fresh-environment prerequisite: after `npm ci`, browser binaries must be
installed explicitly with `npx playwright install chromium` (Chromium
only, no other engines). Browser binaries live in the user-level cache
(`~/.cache/ms-playwright`); they are an environment prerequisite, not
repository state and not repository-hidden state.

The smoke proves the Vite app starts and the shell renders (title
`/CAOS/`, `#root` non-empty). It intentionally maps to **no TEST-E2E-*
requirement**: it is not part of the TEST-E2E-01, TEST-E2E-02, …,
TEST-E2E-12 business-flow suite (spec 11), and no TEST-E2E-* ID is
claimed for it. Those business flows land with later packages.

## Security and network checks

- **Network binding (TEST-SEC level for local stack):** gate fails if any
  published Supabase port is bound beyond loopback. Both runs: loopback-only.
- **Secret scan (TEST-SEC-01, harness level):** tracked files and `dist/`
  contain no service-role key or JWT secret values.
- **MCP regression:** local MCP initializes; MCP is not required to execute
  the tests (reproducibility does not depend on MCP).
- **Stack lifecycle:** gate preserves a pre-running stack; stops only a
  stack it started. `supabase_imgproxy_app` / `supabase_pooler_app` are
  reported as stopped by `supabase status` itself (not enabled in this
  local config) — this is baseline state, not gate action.

## Decision references

- **DEC-J — RESOLVED: live FirmMembership lookup.** Evidence:
  `docs/harness/dec-j-spike.md`, `docs/harness/dec-j-results.json`;
  amendment in `docs/spec/05-authorization-rls.md` (RLS-MECH-01), decision
  date 2026-09-01. The RLS integration harness is the standing regression
  embodiment of this decision.
- **AUD-OQ-02 — RESOLVED: layered A+B+C audit context.** Evidence:
  `docs/harness/audit-context-spike.md`,
  `docs/harness/audit-context-results.json`; amendment in
  `docs/spec/08-audit-security.md` (AUD-CTX-01), decision date 2026-09-01.
  No production audit triggers/RPCs are required at this gate; none exist.

## TEST traceability summary

Exact TEST IDs (all defined in `docs/spec/11-testing-harness.md`):

- Executed in this package: **TEST-AUTH-02, TEST-AUTH-03, TEST-AUTH-09**
  (auth core mechanism); **TEST-AUTH-12, TEST-AUTH-13** (suspension /
  removal freshness); **TEST-RLS-GEN-01, TEST-RLS-GEN-02,
  TEST-RLS-GEN-03, TEST-RLS-GEN-04** (tenant correctness on harness
  tables); **TEST-RLS-MAT-01** (role matrix, mechanism level);
  **TEST-SEC-01** (harness-level secret scan); **TEST-MLH-01,
  TEST-MLH-02, TEST-MLH-03, TEST-MLH-04** (process compliance: declared
  scope, agent obligations, implementer ≠ reviewer via independent human
  review, evidence over narration).
- Playwright shell smoke: **no TEST-E2E-* ID claimed** (see the Playwright
  smoke section).
- Previously completed (earlier packages, not re-executed here):
  **TEST-SPIKE-J-01, TEST-SPIKE-J-02, TEST-SPIKE-J-03** (IMP-004) and
  **TEST-SPIKE-CTX-01, TEST-SPIKE-CTX-02** (IMP-005).

## Fresh-checkout proof

Detached worktree at HEAD (`ffe95f8`) + the uncommitted gate changes copied
in, then `npm ci` (574 packages, 0 vulnerabilities) and
`npm run verify:harness`: **PASS — 14/14 phases green**. The gate does not
depend on hidden working-tree state. Playwright Chromium is a user-level
cache (`~/.cache/ms-playwright`) and the local Supabase stack is a shared
local service; both are documented prerequisites, not repository state. On
a machine without that cache, `npx playwright install chromium` must be
run once after `npm ci` (see the Playwright smoke section); no repository
change is needed. Worktree removed after the run.

## Remaining open questions (do NOT block the Harness Gate)

AUD-OQ-01, RLS-OQ-04, API-OQ-*, AUTO-OQ-*, MIG-OQ-*, DEC-P, OPS-OQ-*,
TEST-OQ-*. None were resolved or modified by this package.

## Out of scope confirmation

No Release-0 production schema, no production migrations, no production
RLS policies, no production audit triggers, no React auth screens, no
hosted Supabase access, no IMP-010 work.

**HARNESS GATE: PASS — human approved 2026-09-01 (evidence commit `305d133`).**
(Historical machine verdict at evidence-generation time: "HARNESS GATE
CANDIDATE: PASS".)

## Gate evolution addendum (2026-09-01)

The gate definition in `scripts/harness/gate.mjs` is authoritative and has
evolved since the approval record above (which remains historical evidence,
preserved unchanged):

- **IMP-010** added the `schema-integration` phase and changed
  `db-cleanliness`: public tables must now be exactly the IMP-010 tenant core
  (`firms`, `profiles`, `firm_memberships`) — the historical "public R0
  application table count = 0" expectation applied only until IMP-010 landed.
  The `hgate_*` / `decj_*` / `audctx_*` leak check is unchanged.
- **IMP-011** expanded `auth-integration` (31 tests: invitation, magic link,
  password recovery, MFA/TOTP, session policy, revocation, core sign-in).
- **IMP-012** extended `db-cleanliness` to also assert the production RLS
  posture: RLS enabled on all three tenant-core tables and the exact 7-policy
  inventory. `rls-integration` now runs the hgate mechanism suite plus the
  production tenant-core RLS suite (`tests/integration/rls/tenant-core-rls.test.ts`).
- Integration file execution is strictly sequential
  (`fileParallelism: false` in `vitest.integration.config.ts`) because
  fixtures create/delete the same deterministic rows across files.
- **IMP-013** extended `db-cleanliness` to include `audit_log` (RLS enabled
  AND forced, SELECT-only grants, `audit_select_partner_admin` policy) and
  added the `audit-integration` phase (`tests/integration/audit/`).
- **IMP-020** extended `db-cleanliness` to the client hierarchy
  (`clients`, `legal_entities`, `client_relationships`, `registrations`,
  `contacts` — RLS enabled AND forced on all five; policy inventory now 21
  exact policies). New suites: client-hierarchy schema tests, production
  client-hierarchy RLS tests, client-hierarchy audit tests, and the
  `clients` adapter-contract phase input (`tests/integration/clients/`).
- **IMP-021** extended `db-cleanliness` to include `engagements` (RLS
  enabled AND forced; policy inventory now 24 exact policies) and added
  the `engagements-integration` phase (`npm run test:engagements`,
  `tests/integration/engagements/` — engagement adapter contract +
  billing letter-status projection; engagement schema/RLS/audit coverage
  runs in the existing `schema-integration` / `rls-integration` /
  `audit-integration` phases). Gate is now 18 phases.
