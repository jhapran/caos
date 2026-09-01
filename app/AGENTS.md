# AGENTS.md

Guidance for AI coding agents working in this repository.

## Repository State: CURRENT vs TARGET

This repository is in transition. Two things are both true and must not be
conflated:

**CURRENT implementation (this Git baseline):** a front-end-only MVP demo —
React + TypeScript + Vite, fixture-backed, all data static in-memory via
`@/data`, no backend, no network calls, no tests installed.

**APPROVED TARGET architecture (Release 0):** specified and approved in
`docs/spec/` (Final Spec Gate: PASS, 2026-08-31). Release 0 adds a Supabase
backend — PostgreSQL, Supabase Auth, Row Level Security, migrations as the
schema-change source of truth, private/server boundaries where required —
with isolated local / staging / production environments. The polished
fixture demo is retained as a separate, dedicated deployment.

Until implementation packages land, the CURRENT description remains the
accurate picture of the code. Do not pretend Supabase is implemented; do
not document future behavior as if it exists. When a section below
describes target state, it says so explicitly.

**Release-0 implementation status (2026-09-01):** the Harness Gate is PASS,
IMP-010 has landed (`supabase/migrations/` carries the production tenant
core: `firms`, `profiles`, `firm_memberships`, SCH-01…03), and IMP-011
(staff authentication) is COMPLETE: a dual-mode auth adapter behind `@/data`
(`src/data/auth/`), staff auth pages, authentication-level route protection,
and invitation-only Supabase Auth config (`enable_signup = false`, TOTP on,
session timebox 168h / inactivity 12h). IMP-012 (foundational RLS) is
IMPLEMENTED and awaiting human approval: RLS is enabled on all three
tenant-core tables (7 policies; DEC-J live `firm_memberships` lookup; the
untrusted `x-active-firm` request header selects firm context but grants
nothing by itself; least-privilege `authenticated` grants restored, anon
still zero; AAL2 enforced at the database for membership administration).
No production audit objects yet — IMP-013. The React app remains
fixture-backed by default (`VITE_DATA_SOURCE` unset = fixture demo track;
`supabase` mode needs `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`, see
`.env.example`); the Supabase data-source adapter lands with IMP-014.

Authoritative sources:

- Product intent: `docs/input/PRD.txt` (~4,800 lines) — personas and MVP
  modules (Command Centre, Client 360, Compliance Engine, Review Queue,
  Ask CAOS, etc.).
- Approved target architecture: `docs/spec/00-index.md` …
  `docs/spec/13-operations-observability.md`. `docs/spec/12-release-0-plan.md`
  is the execution contract (work packages IMP-*, gates, sequencing).
- `info.md` records the scaffolding environment (Node.js 20, Tailwind CSS
  v3.4.19, Vite v7.2.4, shadcn theme) — note its suggested `src/sections/`
  layout is stale; the actual layout is below.
- `README.md` is the stock Vite template readme; it does not describe this
  app.

## Project Overview

This is **CAOS (CA Operating System)** — an AI-native practice, compliance
& client operating system for Indian Chartered Accountant firms. It is a
single-page React application built with Vite.

### Tech stack

- **React 19 + TypeScript** (strict mode, `react-jsx`), bundled by **Vite 7**
  with `@vitejs/plugin-react` and `plugin-inspect-react-code` (dev tooling that
  adds source-inspection attributes — do not remove from `vite.config.ts`).
- **react-router-dom v7** for routing (`BrowserRouter` in `src/main.tsx`).
- **Tailwind CSS v3** + `tailwindcss-animate`; **shadcn/ui** (style "new-york",
  lucide icons) primitives live in `src/components/ui/`.
- Radix UI primitives, framer-motion, GSAP (`@gsap/react`), lenis (smooth
  scroll), embla-carousel, recharts, sonner, react-hook-form + zod, date-fns.
- No state library beyond React context.
- **Target (Release 0, per `docs/spec/`):** Supabase — PostgreSQL, Auth,
  RLS, Storage (Release 1), Edge Functions where justified, Realtime only
  where justified. See `docs/spec/03-tenancy-environments.md` and
  `docs/spec/06-database-schema.md`.

## Build and Run

```bash
npm install        # install dependencies
npm run dev        # Vite dev server on http://localhost:3000 (port set in vite.config.ts)
npm run build      # tsc -b (type check) + vite build → dist/
npm run preview    # serve the production build locally
npm run lint       # ESLint over the repo
npm run test       # Vitest in watch mode (unit/component tests in tests/)
npm run test:unit  # Vitest, non-interactive single run (tests/unit, tests/components)
npm run test:integration # Vitest node integration tests (tests/integration; needs local Supabase + db:reset:harness)
npm run test:auth  # Auth integration tests only (GoTrue, deterministic harness users)
npm run test:rls   # RLS integration tests only (hgate_* mechanism harness + production tenant-core RLS)
npm run test:schema # Schema integration tests only (IMP-010 tenant core; TEST-SCH-02/03)
npm run test:e2e   # Playwright (e2e/) — requires `npx playwright install chromium` first
npm run verify     # fast CI-equivalent: lint + unit tests + build
npm run verify:harness # FULL Harness Gate: preflight → stack → reset+seed → lint →
                       # unit → auth → RLS → build → Playwright smoke → network/MCP/
                       # cleanliness/secret checks (see docs/harness/harness-gate.md)
npm run db:start   # start the local Supabase dev stack (Docker; first run pulls images)
npm run db:stop    # stop the local stack
npm run db:status  # show local stack service URLs/health
npm run db:reset   # reset the local DB: re-apply migrations + seed (destructive, local only)
npm run db:seed:harness   # seed deterministic local Auth harness users (idempotent)
npm run db:verify:harness # verify harness identities only (no creation)
npm run db:reset:harness  # db reset + deterministic harness seed + verification
```

## Deterministic Harness Seed (IMP-003)

`tests/harness/registry.json` is the **authoritative local harness fixture
registry**: fixed UUIDs/emails for Firm A / Firm B and the harness personas
(every R0 role in both firms, plus multi-firm, suspended, removed, and
staff/client-overlap identities). It reserves identifiers only — persona
labels describe harness intent, not production roles/memberships.

`npm run db:reset:harness` rebuilds the same harness state from a clean
checkout: `supabase db reset` → `scripts/harness/seed-harness.mjs`, which
creates the registry's Auth users through the **local Auth Admin API**
(keys discovered dynamically via `supabase status -o env` — never
committed; no direct auth-schema writes). The script is idempotent, fails
loudly on identity conflicts, and hard-refuses non-local API URLs.
`supabase/seed.sql` stays reserved for future R0 reference data
(`docs/spec/10`). All harness identities are synthetic `@caos.test` local
fixtures (MIG-SEED-06) — never production seed data.

## Local Supabase Development (IMP-002)

The Supabase CLI is a **project dev dependency** (`supabase` in
`package.json`) — always use it via `npx supabase …` or the `db:*` scripts
above so the version stays pinned for every agent/CI. Local stack config
lives in `supabase/config.toml` (commit-safe; secrets via `env(...)`
references only). **The local stack is development-only**: do not expose it
publicly and never treat its default credentials as production-safe.

**Migrations are authoritative.** `supabase/migrations/` (Git-tracked) is
the only source of truth for schema change. MCP/console experiments are
never final: experiment → review → Git migration → `db:reset` → tests →
review → commit. A change that exists only in a running database is
incomplete.

**Local network exposure.** `npm run db:start` starts the stack on the
dedicated Docker network `caos-supabase-local`, created with
`com.docker.network.bridge.host_binding_ipv4=127.0.0.1` (`db:network`
prepares it idempotently) — published host ports bind to **loopback
only**. Rules:

- local Supabase services and the MCP endpoint are for **trusted local
  development only**; they must never appear on LAN, Tailscale, or public
  interfaces;
- **never bypass the dedicated network** (e.g. a bare `supabase start`
  or `supabase db reset` without `--network-id caos-supabase-local`,
  which binds `0.0.0.0`) for convenience — always use `npm run db:start`
  / `npm run db:reset` / `npm run db:reset:harness` (the global
  `--network-id` flag is required on `db reset` too: without it the CLI
  recreates the db container on the default network, breaking both
  loopback binding and container DNS);
- **stop the local stack when it is not actively being used**
  (`npm run db:stop`);
- local MCP must remain **approval-gated** at all times;
- do not change host firewall, router, Tailscale, or Docker daemon-wide
  settings to manage this — the dedicated network is the control.

**MCP.** `.kimi-code/mcp.json` configures `supabase-local`
(`http://localhost:54321/mcp`, HTTP transport, no credentials) for local
development. Hosted Supabase MCP, if ever added, must be **non-production
only**, project-scoped (`project_ref=<dev-project>`), minimal feature
groups, approval-gated, and OAuth-based — **production MCP write access is
forbidden**. Do not paste tokens into any committed file.

**Secrets.** `.gitignore` blocks `.env*` (except documented
`.env.example/.template/.sample`); `supabase/.gitignore` covers CLI-local
files. Never commit database passwords, JWT/signing keys, service-role
keys, or tokens (OPS-ENV-05).

**Verification — current vs target.** The frontend harness exists: Vitest +
React Testing Library (`tests/{unit,components}`, jsdom, `@/` alias via
`vite.config.ts`), Playwright (`e2e/`, `playwright.config.ts` — Chromium
installed, smoke executed), and `npm run verify` as the fast CI-equivalent
(lint + unit + build). The **Harness Gate** additionally exists and is
**PASS — human approved 2026-09-01** (evidence commit `305d133`):
Auth integration tests (`tests/integration/auth`), RLS integration tests
(`tests/integration/rls` — temporary `hgate_*` harness objects implementing
the resolved DEC-J live-membership-lookup mechanism, applied/dropped per
run; NOT R0 schema), both Vitest node-environment via
`vitest.integration.config.ts`, and `npm run verify:harness` as the full
gate command (evidence: `docs/harness/harness-gate.md`). DEC-J and
audit-context spikes are complete with decision records
(`docs/harness/dec-j-spike.md`, `docs/harness/audit-context-spike.md`).
**The Harness Gate is PASS; IMP-010+ is unlocked but each production
package still follows: spec package → implementation → tests → verification
(`verify` / `verify:harness` must stay green) → human approval → Git
checkpoint.**
Remaining target-state gaps: business-flow Playwright suite
(TEST-E2E-01…12) and production RLS/auth/audit tests land with their owning
IMP packages.

## Deployment

**Current:** static SPA deployed to **Netlify**: `netlify.toml` runs
`npm run build` and publishes `dist/`. SPA fallback is configured twice —
keep both in sync if changed: `netlify.toml` redirects and
`public/_redirects` (`/* → /index.html`). This deployment is the fixture
demo track.

**Target (per `docs/spec/03`, `10`, `13`):** environment-isolated topology
— local Supabase CLI for development, separate staging and production
Supabase projects. Data-source selection is explicit per environment:

- Dedicated demo/sales deployment: `DATA_SOURCE=fixture`
- Local production-development: `DATA_SOURCE=supabase`
- Staging: `DATA_SOURCE=supabase`
- Production: `DATA_SOURCE=supabase`

Production must **never** run fixture mode and must never silently fall
back to it; invalid or missing `DATA_SOURCE` fails closed
(`docs/spec/10-migration-seed.md`, MIG-DS-*).

## Code Organization

```
src/
  main.tsx            Entry: <BrowserRouter><DemoStoreProvider><App/></...>
  App.tsx             Route table. "/" is the landing page (no shell); all app
                      pages nest under <Layout/> via <Outlet/>.
  index.css           Global styles + shadcn CSS variables (@layer base).
  components/         App-level components: Layout (sidebar+topbar shell),
                      Navbar, Breadcrumb, CommandPalette (⌘K), Toast, StatCard,
                      StatusPill, DataTable, DeadlineRing, RiskGauge, etc.
  components/ui/      shadcn/ui primitives (accordion, dialog, table, …).
                      Generated code — prefer wrapping over editing.
  pages/              One component per route (Landing, MorningBrief,
                      CommandCentre, Deadlines, DeadlineClients,
                      ComplianceDetail, AskCaos, ReviewQueue, ClientDependency,
                      RiskAlerts, Reports) plus co-located per-page subfolders
                      (pages/brief/, pages/command/, …) for page-specific pieces.
  data/               THE DATA LAYER — see below.
  hooks/              Shared hooks (currently only use-mobile).
  lib/utils.ts        cn() (clsx + tailwind-merge). shadcn convention.
docs/spec/            APPROVED SPECIFICATION SET — the target architecture
                      and Release 0 execution plan. Read before implementing.
```

### Data layer (`src/data/`) — the key architectural pattern

**This boundary is permanent.** React components must NOT import or execute
Supabase (or any backend) queries directly. The target pattern is:

```
React component
    ↓
@/data / domain data layer
    ↓
fixture adapter  OR  Supabase adapter
```

The selected adapter depends on approved environment configuration
(`DATA_SOURCE`, above). The production data-access contract is specified in
`docs/spec/07-api-contract.md`; do not spread direct Supabase queries
through React components (API-ARCH-02).

Current fixture modules:

- `types.ts` — all domain types (Firm, Client, TaskInstance, FirmAlert,
  ReviewItem, …). Single source of truth for the current domain model;
  the *approved production* domain model is `docs/spec/02-domain-model.md`.
- `clients.ts`, `compliance.ts`, `tasks.ts`, `deadlines.ts`, `review.ts`,
  `alerts.ts`, `dependency.ts`, `askCaos.ts` — static fixture constants
  (`CLIENTS`, `TASKS`, `COMPLIANCE_MASTER`, …) plus pure selector helpers.
- `api.ts` — typed "API surface": sync getters (`getClients`, `getTasks`, …)
  and async fetchers (`fetchClients`, `fetchTask`, …) that wrap fixtures in
  `withLatency()` (150–400 ms simulated latency) so pages can show loading
  states. Also `searchAll()` powering the ⌘K palette and `askCaos()` for the
  canned natural-language assistant. Every barrel-reachable export is
  classified KEEP / EVOLVE / REPLACE / DEMO-ONLY in
  `docs/spec/07-api-contract.md` (API-INV-01).
- `store.tsx` — `DemoStoreProvider` React context: a mutable overlay on top of
  the fixtures (review approvals/returns, reminders, alert ack/resolve, toasts,
  `resetDemo()`). Derived live counts via `useLiveAggregates()`.
- `index.ts` — barrel re-exporting everything. **Always import data from
  `@/data`, never from the individual fixture modules.**

**Fixture clock.** The pinned demo clock (`DEMO_TODAY`, fixture-relative
dates, no `new Date()` for domain dates) applies to **fixture/demo mode
only**. Production Supabase behavior must use real authoritative
(server-generated) timestamps and must not inherit fixture-only
`DEMO_TODAY` behavior (`docs/spec/10-migration-seed.md`, TEN-22).

## Code Style and Conventions

- Path alias `@/*` → `src/*` (configured in `vite.config.ts` and
  `tsconfig.app.json`). Use `@/` imports.
- TypeScript is strict with `noUnusedLocals`, `noUnusedParameters`,
  `verbatimModuleSyntax` (use `import type` for type-only imports) and
  `erasableSyntaxOnly` (no enums or other runtime TS-only syntax — the codebase
  uses union string literal types instead).
- ESLint 9 flat config (`eslint.config.js`): typescript-eslint recommended +
  react-hooks + react-refresh. No Prettier; match existing formatting
  (2-space indent, single quotes in app code).
- Styling: Tailwind utility classes, composed with `cn()` from `@/lib/utils`.
  The design system is "Ledger Light": use the semantic tokens defined in
  `tailwind.config.js` (`paper`, `ink`, `line`, `brand`, `gold`, `critical`,
  `warning`, `success`, `info`, `violet`) rather than raw hex values. Fonts:
  Fraunces (display), Inter (sans), IBM Plex Mono (mono — numbers/codes, see
  the `tnum` class usage).
- shadcn/ui: primitives in `src/components/ui/` are generated; add new ones via
  the shadcn CLI conventions in `components.json` rather than hand-writing.
- Pages own their data fetching through `@/data` fetchers and local state;
  cross-page mutations go through `useDemoStore()` only (fixture mode;
  production mutations follow `docs/spec/07-api-contract.md`).

## Implementation Protocol (binding for all coding agents)

Derived from `docs/spec/12-release-0-plan.md` (REL-WP-*, REL-MLH-*,
REL-LOOP-*, REL-GIT-*) and `docs/spec/11-testing-harness.md` (TEST-MLH-*).

**Every implementation task must declare:**

- the IMP-* work package it belongs to (from `12-release-0-plan.md`)
- requirement IDs being implemented
- TEST-* IDs being satisfied
- allowed scope (files/areas)
- forbidden changes
- acceptance checks (commands/families)
- the current Git checkpoint

**Rules:**

- Agents must not silently redesign approved architecture. The repository
  and `docs/spec/` are the source of truth — not model memory, not
  narration.
- If a specification is ambiguous or conflicting: **STOP, report the
  ambiguity with spec references, do not invent architecture.**
- Implementation may be performed by multiple LLMs. For security-sensitive
  changes (RLS, authentication, service-role handling, audit, tenant
  isolation, migrations, break-glass), where practical:
  **IMPLEMENTER MODEL ≠ REVIEWER MODEL.**
- Report changed files, map changes to requirement IDs and tests to
  TEST-* IDs, run the acceptance checks, and report failures openly.

**Git / change discipline:**

- clean working tree before each IMP package
- one bounded package per branch (`r0/imp-NNN-<slug>` off `main`)
- no unrelated edits in a change set
- required tests pass before commit
- review the full diff before commit
- recorded human approval for security-sensitive packages
- one logical checkpoint per package; commit messages reference the IMP id
  and primary requirement IDs

## Security Considerations

**Current (fixture baseline):** demo-only app — no authentication, no real
credentials, no network calls; all "reminders"/"emails" are simulated in
the store; fixture data is fictional client data.

**Target (Release 0, binding once implementation begins — per
`docs/spec/03`, `04`, `05`, `08`, `13`):**

- **Never commit secrets.** No credentials in source control, ever.
- Client-safe Supabase configuration (project URL, anon key) may exist only
  through approved environment variables, clearly marked client-safe.
- **Service-role credentials are server-only** — never exposed to the
  browser, never imported by frontend code, never shipped in the bundle.
- Production fails closed on missing/invalid security-critical
  configuration (OPS-ENV-06).
- Production has **no fixture fallback** (MIG-DS-05).
- RLS is the authorization enforcement boundary
  (`docs/spec/05-authorization-rls.md`); tenant isolation is verified by
  the `11` harness, not by convention.
- Audit and break-glass rules: `docs/spec/08-audit-security.md`.
