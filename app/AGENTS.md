# AGENTS.md

Guidance for AI coding agents working in this repository.

## Project Overview

This is **CAOS (CA Operating System)** — a front-end-only MVP demo of an AI-native
practice, compliance & client operating system for Indian Chartered Accountant
firms. It is a single-page React application built with Vite; there is **no
backend**. All data is static in-memory fixtures with simulated latency.

- Product spec: `docs/input/PRD.txt` (~4,800 lines) — the source of truth for
  product intent, personas, and MVP modules (Command Centre, Client 360,
  Compliance Engine, Review Queue, Ask CAOS, etc.).
- `info.md` records the scaffolding environment (Node.js 20, Tailwind CSS
  v3.4.19, Vite v7.2.4, shadcn theme) — note its suggested `src/sections/`
  layout is stale; the actual layout is below.
- `README.md` is the stock Vite template readme; it does not describe this app.

### Tech stack

- **React 19 + TypeScript** (strict mode, `react-jsx`), bundled by **Vite 7**
  with `@vitejs/plugin-react` and `plugin-inspect-react-code` (dev tooling that
  adds source-inspection attributes — do not remove from `vite.config.ts`).
- **react-router-dom v7** for routing (`BrowserRouter` in `src/main.tsx`).
- **Tailwind CSS v3** + `tailwindcss-animate`; **shadcn/ui** (style "new-york",
  lucide icons) primitives live in `src/components/ui/`.
- Radix UI primitives, framer-motion, GSAP (`@gsap/react`), lenis (smooth
  scroll), embla-carousel, recharts, sonner, react-hook-form + zod, date-fns.
- No state library beyond React context; no test runner is installed.

## Build and Run

```bash
npm install        # install dependencies
npm run dev        # Vite dev server on http://localhost:3000 (port set in vite.config.ts)
npm run build      # tsc -b (type check) + vite build → dist/
npm run preview    # serve the production build locally
npm run lint       # ESLint over the repo
```

There are **no tests** in this project (no vitest/jest/playwright). Verification
is `npm run build` (includes full type checking) and `npm run lint`.

## Deployment

Static SPA deployed to **Netlify**: `netlify.toml` runs `npm run build` and
publishes `dist/`. SPA fallback is configured twice — keep both in sync if
changed: `netlify.toml` redirects and `public/_redirects` (`/* → /index.html`).

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
```

### Data layer (`src/data/`) — the key architectural pattern

There is no API; the data layer simulates one:

- `types.ts` — all domain types (Firm, Client, TaskInstance, FirmAlert,
  ReviewItem, …). Single source of truth for the domain model.
- `clients.ts`, `compliance.ts`, `tasks.ts`, `deadlines.ts`, `review.ts`,
  `alerts.ts`, `dependency.ts`, `askCaos.ts` — static fixture constants
  (`CLIENTS`, `TASKS`, `COMPLIANCE_MASTER`, …) plus pure selector helpers.
  Fixtures are pinned to a demo clock (`DEMO_TODAY`) — do not use
  `new Date()` for domain dates; use the fixture-relative dates.
- `api.ts` — typed "API surface": sync getters (`getClients`, `getTasks`, …)
  and async fetchers (`fetchClients`, `fetchTask`, …) that wrap fixtures in
  `withLatency()` (150–400 ms simulated latency) so pages can show loading
  states. Also `searchAll()` powering the ⌘K palette and `askCaos()` for the
  canned natural-language assistant.
- `store.tsx` — `DemoStoreProvider` React context: a mutable overlay on top of
  the fixtures (review approvals/returns, reminders, alert ack/resolve, toasts,
  `resetDemo()`). Derived live counts via `useLiveAggregates()`.
- `index.ts` — barrel re-exporting everything. **Always import data from
  `@/data`, never from the individual fixture modules.**

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
  cross-page mutations go through `useDemoStore()` only.
- Comments reference a `design.md` (e.g. "design.md §8") that is not in the
  repo — treat `docs/input/PRD.txt` as the authoritative spec.

## Security Considerations

- Demo-only app: no authentication, no real credentials, no network calls —
  all "reminders"/"emails" are simulated in the store. Do not add real API
  keys or endpoints; fixture data is fictional client data.
- If a backend is ever added, keep secrets out of the repo (no `.env` is
  currently used) and remember this is a fully client-side bundle — nothing in
  `src/` is private.
