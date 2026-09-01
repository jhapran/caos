# 12 — Release 0 Execution Plan

- **Status:** Approved (Batch 6)
- **Approval status:** Approved (Batch 6). Open/provisional items remain open as tabulated in the Open / Provisional Dependency Matrix (AUD-OQ-01, RLS-OQ-04, API-OQ-01…04, AUTO-OQ-01…04, MIG-OQ-02/04, DEC-P, OPS-OQ-01…04, TEST-OQ-01…04). This document resolves none of them. **DEC-J is RESOLVED (2026-09-01): IMP-004 complete — live membership lookup selected (`05` RLS-MECH-01; evidence `docs/harness/dec-j-spike.md`).** **AUD-OQ-02 is RESOLVED (2026-09-01): IMP-005 complete — layered A+B+C audit-context propagation selected (`08` AUD-CTX-01; evidence `docs/harness/audit-context-spike.md`).** **The Harness Gate is PASS — human approved 2026-09-01 (evidence commit `305d133`; exact committed-HEAD verified from a fresh detached worktree: 14/14 phases green; evidence `docs/harness/harness-gate.md`).** IMP-000…IMP-005 are all COMPLETE; the Harness Engineering phase is COMPLETE. IMP-010 is UNLOCKED but NOT STARTED — it begins only on a separate explicit implementation instruction.

## Purpose

Convert the approved Phase 2 specifications (00–11, 13) into an ordered,
dependency-explicit Release 0 implementation plan: phases, work packages
(IMP-*), the Harness Gate, human approval gates, Git checkpoints, the
open/provisional dependency matrix, production gates, and the Release 0
Definition of Done.

This document **sequences** approved architecture; it does not redesign it.
Where an approved spec leaves an item OPEN or PROVISIONAL, this plan
preserves that status and attaches it to the gate at which it must be
resolved. Nothing here silently resolves AUD-OQ-02, AUTO-OQ-01/02,
DEC-P, or any other recorded open question. (DEC-J was resolved by the
approved IMP-004 spike amendment, 2026-09-01 — live membership lookup.)

## Scope

- Release 0 implementation scope as approved in DEC-T: the staff-side
  operational core on Supabase, with the fixture demo preserved.
- Implementation sequencing, work-package definitions, verification
  mapping, gates, and stop conditions.
- The multi-LLM execution protocol and loop-engineering rules that govern
  every implementation package.

## Non-goals

- No architecture redesign; no amendment of approved specs (changes route
  through the affected spec's own Consequence of Change).
- No executable SQL, migrations, code, dependency changes, Supabase
  provisioning, or credential creation (this is still Phase 2).
- No scheduling of deferred scope: document vault/storage workflow, Client
  Portal UI, automated reminder *delivery*, WhatsApp, real AI provider
  integration, pgvector/RAG, native billing, advanced integrations,
  advanced workload recommendations, advanced team-based authorization,
  enterprise observability platform (DEC-C/K/M, 01-decisions). Also
  explicitly deferred per DEC-T named deferrals: Ask CAOS / NL AI
  assistant, a dedicated MVP Reporting module (PRD §87), and a dedicated
  Client Dependency dashboard/view (PRD §14). No new R0 work packages are
  created for these deferred views.
- No execution of the audit-context spike — it is scheduled
  here as a work package, not performed. (The DEC-J spike has since been
  executed as IMP-004, 2026-08-31; the audit-context spike as IMP-005,
  decision approved 2026-09-01.)

## Requirement IDs

This spec owns the `REL-*` namespace:

- **REL-PRIN-01…05** — planning principles.
- **REL-SEQ-01…05** — sequencing and dependency rules.
- **REL-HG-01…06** — Harness Gate requirements.
- **REL-WP-01…05** — work-package format and discipline.
- **REL-MLH-01…04** — multi-LLM execution protocol.
- **REL-LOOP-01…03** — loop-engineering rules.
- **REL-GIT-01…06** — Git strategy.
- **REL-PG-01…07** — production gates.
- **REL-DOD-01…13** — Release 0 Definition of Done.
- **REL-ACC-01…07** — acceptance criteria (§ Acceptance Criteria).
- **REL-A-01…04** — assumptions (§ Assumptions).
- **REL-OQ:** none introduced. All open items are inherited from approved
  specs and tabulated in the Open / Provisional Dependency Matrix.

## Assumptions

- **REL-A-01:** The approved specs 00–11 and 13 are the authoritative
  inputs; where this plan paraphrases them, the source spec governs.
- **REL-A-02:** The repository is the source of truth for implementation
  state; no model's memory or narration substitutes for code, tests, and
  Git history (TEST-MLH-03).
- **REL-A-03:** The fixture demo deployment remains live and untouched
  throughout R0; production never runs fixture mode (MIG-DS-05,
  MIG-OQ-01 RESOLVED).
- **REL-A-04:** Work-package numbering (IMP-*) is stable; packages may be
  split but never renumbered, so requirement/test mappings stay traceable.

## Dependencies

- Upstream (authoritative inputs): `00` index, `01` decisions, `02` domain
  model, `03` tenancy & environments, `04` authentication, `05`
  authorization & RLS, `06` database schema, `07` API contract, `08` audit
  & security, `09` automation & events, `10` migration & seeding, `11`
  testing harness, `13` operations & observability.
- Downstream: implementation prompts, the Harness Gate evidence record,
  staging/production cutover records, and the Release 0 release-approval
  record.

## Planning principles

- **REL-PRIN-01:** Harness first. The Harness Gate (REL-HG-*) passes
  before any substantial feature implementation begins.
- **REL-PRIN-02:** Dependency order over convenience. A package starts
  only when its declared dependencies are complete and green.
- **REL-PRIN-03:** Open stays open. A provisional mechanism (AUTO-OQ-01/02;
  historically DEC-J and AUD-OQ-02 — both resolved 2026-09-01 through this
  rule) is implemented only after its gate produces a
  written decision record; interim work uses the documented provisional
  default and is marked accordingly.
- **REL-PRIN-04:** One bounded package at a time; no silent scope
  widening. Ambiguity → STOP, report, do not redesign (REL-LOOP-03).
- **REL-PRIN-05:** Architecture approval ≠ production readiness. The
  production gates (REL-PG-*) and the external CA/compliance-domain
  statutory activation gate (OPS-ACT-*) are separate, later gates.

## Implementation phases

| Phase | Name | Packages | Gate at exit |
|---|---|---|---|
| R0-A | Harness Foundation | IMP-000…IMP-005 | **HARNESS GATE — PASS** (human approved 2026-09-01, commit `305d133`) |
| R0-B | Identity & Tenant Foundation | IMP-010…IMP-014 | Phase gate: TEST-AUTH-*, TEST-RLS-GEN-*, TEST-AUD-* green |
| R0-C | Core Domain | IMP-020…IMP-022 | Phase gate: TEST-SCH-*, TEST-API-*, E2E 3–5 |
| R0-D | Compliance Foundation | IMP-030…IMP-031 | Phase gate: TEST-SCH-*, TEST-RLS-CRV-*, scope invariants |
| R0-E | Work Management | IMP-040…IMP-042 | Phase gate: TEST-SCH-*, TEST-API-*, E2E 7–9 |
| R0-F | Automation & Deadlines | IMP-050…IMP-051 | Phase gate: TEST-AUTO-01…12 |
| R0-G | Application Read Models | IMP-060…IMP-062 | Phase gate: TEST-API-*, E2E 10 |
| R0-H | Migration & Cutover | IMP-070…IMP-072 | **PRODUCTION GATES** (REL-PG-*) + release approval |

Sequencing rules:

- **REL-SEQ-01:** R0-A is the only phase permitted before the Harness
  Gate; it *is* the gate's construction. R0-B through R0-H are blocked
  until the gate is green.
- **REL-SEQ-02:** Within a phase, packages run in numeric order unless
  their dependency fields say otherwise; across phases, a phase starts
  only when the previous phase's exit gate is green.
- **REL-SEQ-03:** IMP-004 (DEC-J spike) is **COMPLETE (2026-09-01)** —
  the live-membership-lookup decision record (`05` RLS-MECH-01) is the
  approved input to IMP-012 (foundational RLS). IMP-005 (audit-context
  spike) is **COMPLETE (2026-09-01)** — the layered A+B+C decision record
  (`08` AUD-CTX-01) is the approved input to the audit-context
  propagation portion of IMP-013. Both spikes are inside
  R0-A precisely so tenant-domain implementation never proceeds on an
  unvalidated authorization or audit mechanism.
- **REL-SEQ-04:** IMP-014 (data-source adapter skeleton) precedes all
  UI-facing packages so every surface is written against the `@/data`
  contract with an explicit DATA_SOURCE, never against Supabase directly
  (API-ARCH-01…05).
- **REL-SEQ-05:** R0-H begins only when R0-B…R0-G are green on staging;
  production cutover additionally requires REL-PG-* in full.

## Harness Gate

- **REL-HG-01:** The Harness Gate comprises IMP-000…IMP-005 and ends in
  recorded human approval. It implements the checklist in `11` (Harness
  Gate section): test runner, Vitest, React Testing Library, local
  Supabase stack, deterministic seed, TypeScript/build verification, lint,
  RLS integration harness, auth integration harness, DEC-J spike
  (COMPLETE — IMP-004, 2026-09-01),
  audit-context spike (COMPLETE — IMP-005, 2026-09-01), minimal Playwright
  smoke suite, CI-equivalent verification command, clean baseline.
  **STATUS: PASS — human approved 2026-09-01.** Evidence commit `305d133`
  (`test: establish executable Harness Gate`); exact committed-HEAD
  verified from a fresh detached worktree (`npm ci` →
  `npx playwright install chromium` → `npm run verify:harness`): 14/14
  phases green. Evidence record: `docs/harness/harness-gate.md` +
  `docs/harness/harness-gate-result.json`. IMP-000…IMP-005 are all
  COMPLETE; the Harness Engineering phase is COMPLETE. IMP-010+ is
  UNLOCKED by this gate — UNLOCKED does not mean STARTED: IMP-010 remains
  NOT STARTED until a separate explicit implementation instruction.
- **REL-HG-02:** Allowed before the gate: IMP-000…IMP-005 only, plus
  specification/documentation work. Everything else — including any
  production schema migration beyond spike scaffolding — is blocked.
- **REL-HG-03:** The gate is green only when the CI-equivalent command
  runs clean end-to-end on a fresh checkout: install → lint → typecheck →
  build → unit/component tests → local Supabase up → seed → RLS/auth
  integration tests → Playwright smoke → down, with a clean working tree.
- **REL-HG-04:** Spike decision records (DEC-J, AUD-OQ-02) are written
  into `05` / `08` respectively as amendments before the gate is approved;
  the approved specs are updated, not bypassed. (DEC-J recorded
  2026-09-01 — live membership lookup; AUD-OQ-02 recorded 2026-09-01 —
  layered A+B+C propagation.)
- **REL-HG-05:** No major feature work begins until the gate passes. A
  failed gate blocks R0-B entirely; partial credit is not permitted.
- **REL-HG-06:** Gate evidence (command output, spike measurements,
  decision records) is committed to the repository so any later model can
  audit it without trusting narration.

## Decision gates inside the plan

### DEC-J gate (authorization mechanism) — SATISFIED (2026-09-01)

DEC-J is **resolved**: IMP-004 executed TEST-SPIKE-J-01…03 against all
twelve spike criteria in `11` (plus the reviewer-mandated 100,013-row
membership scale follow-up; ~100k-row resource latency far inside the
provisional p95 < 100 ms budget, TEST-OQ-01 evidence recorded). The
decision record is written (`docs/harness/dec-j-spike.md`) and `05` is
amended (RLS-MECH-01: **live membership lookup**). IMP-012 and every
later RLS-bearing package implement that resolved mechanism; the
mechanism is not re-adjudicated.

### Audit-context gate (AUD-OQ-02) — SATISFIED (2026-09-01)

AUD-OQ-02 is **resolved**: IMP-005 executed TEST-SPIKE-CTX-01/02
(trustworthy actor, firm context, IP, user-agent, correlation ID,
PostgREST vs RPC behavior, actor-type distinction, spoofing resistance,
pooling/context-leakage safety, audit-failure atomicity — 31/31 checks).
The decision record is written (`docs/harness/audit-context-spike.md`)
and `08` is amended (AUD-CTX-01: **layered A+B+C propagation** — trigger
baseline for ordinary human mutations, explicit RPC boundary for
sensitive/privileged commands, controlled server boundary for
system/service/support). IMP-013 and every later audit-bearing package
implement that resolved mechanism; the mechanism is not re-adjudicated.

### Statutory-rule activation gate (standing)

Architecture approval of the Registration Scope Matrix and of
`compliance_rule_versions` is **not** professional statutory approval. No
statutory rule version becomes `active` in production without the external
CA/compliance-domain sign-off and the OPS-ACT-01…03 controls. This gate
survives the end of Release 0 implementation; completing R0 code does not
open it.

## Work-package catalogue

Format and discipline:

- **REL-WP-01:** Every package declares: ID, name, purpose, requirement
  IDs, TEST-* IDs, dependencies, allowed scope, explicit non-goals,
  expected files/areas, entry criteria, acceptance criteria, verification
  commands/families, exit criteria, human approval required, Git
  checkpoint, rollback/recovery concern, and open/provisional dependency.
- **REL-WP-02:** "Expected files/areas" names directories and module
  *areas*, not exact new filenames, except where the existing repo
  architecture already dictates them (`src/data/`, `supabase/`,
  `docs/spec/`).
- **REL-WP-03:** "Verification" is expressed as the CI-equivalent command
  plus TEST-* families from `11`; no package invents its own test runner.
- **REL-WP-04:** "Git checkpoint" means: clean tree at start, one bounded
  diff, tests green, review, then commit (REL-GIT-*). Human-approval
  packages additionally require the recorded approval before commit.
- **REL-WP-05:** A package is done only when its exit criteria hold *and*
  the Harness Gate remains green after merge.

### PHASE R0-A — Harness Foundation (pre-gate; builds the gate) — **COMPLETE (Harness Gate PASS, human approved 2026-09-01, commit `305d133`)**

---

**IMP-000 — Repository & implementation baseline** — **COMPLETE (2026-09-01; Harness Gate PASS, commit `305d133`)**

- **Purpose:** Establish the implementation-working baseline: agent/task
  prompt template, requirement-ID conventions, and a verified green
  baseline of the existing fixture app.
- **Requirement IDs:** TEST-MLH-01…04; REL-GIT-01…06; OPS-ENV-05 (no
  committed credentials).
- **TEST-* IDs:** TEST-MLH-01…04; baseline: lint, `tsc -b`, `vite build`.
- **Dependencies:** none.
- **Allowed scope:** `AGENTS.md` implementation-protocol addendum,
  `docs/` templates (implementation-task prompt template), verification of
  existing scripts.
- **Non-goals:** no source-code behavior change; no dependency changes.
- **Expected files/areas:** `AGENTS.md`, `docs/templates/`.
- **Entry criteria:** Final Spec Gate approved; `sdd/foundation` merged
  per REL-GIT-02.
- **Acceptance criteria:** prompt template carries spec refs, requirement
  IDs, TEST IDs, allowed/forbidden scope, acceptance commands, current Git
  checkpoint (REL-MLH-01); baseline commands pass unmodified.
- **Verification:** lint + typecheck + build on clean checkout.
- **Exit criteria:** baseline green; template committed.
- **Human approval:** no (process artifact; reviewer sign-off on template).
- **Git checkpoint:** `chore: implementation baseline`.
- **Rollback concern:** none (docs/config only).
- **Open/provisional dependency:** TEST-OQ-04 (CI platform) — template is
  platform-neutral.

---

**IMP-001 — Testing harness setup** — **COMPLETE (2026-09-01; Harness Gate PASS, commit `305d133`)**

- **Purpose:** Install and configure Vitest + React Testing Library +
  Playwright skeleton; define the CI-equivalent single command.
- **Requirement IDs:** TEST-STACK-01…05; TEST-TAX-01/02.
- **TEST-* IDs:** TEST-UNIT-* / TEST-COMP-* smoke cases; TEST-E2E harness
  boots (one trivial flow); TEST-OQ-02 (mail capture) and TEST-OQ-04 (CI
  platform) verified/decided here.
- **Dependencies:** IMP-000.
- **Allowed scope:** dev dependencies, test config, `tests/` scaffolding,
  npm scripts.
- **Non-goals:** no feature tests yet; no Supabase-dependent tests (that
  is IMP-002+).
- **Expected files/areas:** `package.json`, `vitest.config.*`,
  `playwright.config.*`, `tests/`.
- **Entry criteria:** IMP-000 green.
- **Acceptance criteria:** `npm run verify` (CI-equivalent) runs lint →
  typecheck → build → unit → e2e-smoke clean.
- **Verification:** the CI-equivalent command itself.
- **Exit criteria:** command green on fresh checkout; documented in
  README/AGENTS.
- **Human approval:** no.
- **Git checkpoint:** `test: harness setup`.
- **Rollback concern:** dependency additions are reversible by revert.
- **Open/provisional dependency:** TEST-OQ-02, TEST-OQ-04 resolved or
  explicitly deferred at this package.

---

**IMP-002 — Local Supabase environment** — **COMPLETE (2026-09-01; Harness Gate PASS, commit `305d133`)**

- **Purpose:** Supabase CLI local stack (Postgres, Auth, Storage, Edge
  runtime) reproducible from the repo; no credentials committed.
- **Requirement IDs:** TEN-01…TEN-06 (local env), OPS-ENV-01…06.
- **TEST-* IDs:** TEST-OPS-01 (missing config fails closed) at skeleton
  level.
- **Dependencies:** IMP-001.
- **Allowed scope:** `supabase/` config, local env templates (`.env.example`
  style), npm scripts for stack up/down/reset.
- **Non-goals:** no staging/production projects; no schema yet.
- **Expected files/areas:** `supabase/`, env templates.
- **Entry criteria:** IMP-001 green.
- **Acceptance criteria:** fresh clone → single command brings the local
  stack up; reset is deterministic; missing security-critical config fails
  closed (OPS-ENV-06).
- **Verification:** CI-equivalent command extended with stack up/down.
- **Exit criteria:** reproducible local stack; secrets hygiene verified.
- **Human approval:** no.
- **Git checkpoint:** `chore: local supabase stack`.
- **Rollback concern:** none (local only).
- **Open/provisional dependency:** none.

---

**IMP-003 — Deterministic development seed** — **COMPLETE (2026-09-01; Harness Gate PASS, commit `305d133`)**

- **Purpose:** Synthetic Firm A / Firm B with users in every R0 role,
  multi-firm user, suspended + removed memberships, staff+client overlap
  identities, and representative client/compliance/task rows — the RLS
  harness substrate.
- **Requirement IDs:** MIG-SEED-01…06; TEST-RLS-GEN-01 (seed strategy).
- **TEST-* IDs:** TEST-MIG-10 (determinism), TEST-RLS-GEN-01.
- **Dependencies:** IMP-002; spike-minimal schema (firms, profiles,
  firm_memberships, one tenant table) from IMP-004's scaffolding may land
  here or in IMP-004 — declared at implementation prompt time, not both.
- **Allowed scope:** seed scripts/data only; synthetic data rules per `10`.
- **Non-goals:** no production data; no statutory rule content.
- **Expected files/areas:** `supabase/seed*`, `tests/` seed helpers.
- **Entry criteria:** IMP-002 green.
- **Acceptance criteria:** reset → seed yields byte-stable ids
  (MIG-SEED-06; scheme per MIG-OQ-02); Firm A/B isolation scenario data
  complete.
- **Verification:** TEST-MIG-10.
- **Exit criteria:** deterministic seed green twice from clean resets.
- **Human approval:** no.
- **Git checkpoint:** `test: deterministic dev seed`.
- **Rollback concern:** none.
- **Open/provisional dependency:** MIG-OQ-02 (id scheme detail) — decided
  here, either satisfies MIG-SEED-06.

---

**IMP-004 — DEC-J authorization spike** — **COMPLETE (2026-09-01)**

- **Outcome:** decision recorded in `05` (RLS-MECH-01/02) — **live
  membership lookup** selected; evidence `docs/harness/dec-j-spike.md` +
  `docs/harness/dec-j-results.json`; human/security approval recorded.
  The package definition below is preserved as executed.
- **Purpose:** Decide the RLS mechanism (JWT claims / membership lookup /
  hybrid) on evidence. Security-critical.
- **Requirement IDs:** DEC-J; RLS-MECH-01/02; RLS-PRIN-01…04.
- **TEST-* IDs:** TEST-SPIKE-J-01…03 (all twelve criteria incl.
  ~100k-row latency, role-change freshness, suspension/removal, firm
  switching, multi-firm, staff+client overlap, stale token, refresh,
  testability).
- **Dependencies:** IMP-002, IMP-003.
- **Allowed scope:** spike scaffolding schema + policies for the three
  candidate styles; measurement scripts; decision record amending `05`.
- **Non-goals:** production RLS policies; production schema.
- **Expected files/areas:** `supabase/` spike migrations (clearly
  labelled), `docs/spec/05-authorization-rls.md` (decision-record
  amendment).
- **Entry criteria:** seed with ~100k representative rows loadable.
- **Acceptance criteria:** written decision record with measurements;
  `05` amended; fallback rule honored (hybrid failure → option B lookup).
- **Verification:** TEST-SPIKE-J-*.
- **Exit criteria:** decision recorded; TEST-OQ-01 latency budget
  confirmed or revised with evidence.
- **Human approval:** **yes** (authorization mechanism decision).
- **Git checkpoint:** `spike: DEC-J decision record` (after approval).
- **Rollback concern:** spike artefacts removed or quarantined; no
  production impact.
- **Open/provisional dependency:** ~~DEC-J~~ (RESOLVED 2026-09-01 — live
  membership lookup); TEST-OQ-01 (evidence recorded; budget unchanged).

---

**IMP-005 — Audit-context spike** — **COMPLETE (2026-09-01)**

- **Purpose:** Decide the audit-context propagation mechanism
  (request-scoped GUC / explicit RPC context / Edge Function wrapper) on
  evidence. Security-critical.
- **Requirement IDs:** AUD-OQ-02; AUD-CTX-01…03; AUD-ACT-01…05.
- **TEST-* IDs:** TEST-SPIKE-CTX-01/02.
- **Dependencies:** IMP-002, IMP-003; independent of IMP-004's outcome.
- **Allowed scope:** spike scaffolding; measurement; decision record
  amending `08`.
- **Non-goals:** production audit pipeline (IMP-013).
- **Expected files/areas:** `supabase/` spike artefacts,
  `docs/spec/08-audit-security.md` (amendment).
- **Entry criteria:** spike seed present.
- **Acceptance criteria:** decision record covering trustworthiness, firm
  context, IP/UA, correlation ID, PostgREST vs RPC, actor distinction,
  spoofing resistance; fallback order honored.
- **Verification:** TEST-SPIKE-CTX-*.
- **Exit criteria:** `08` amended; mechanism selected with evidence.
- **Human approval:** **yes** (audit/security mechanism decision).
- **Git checkpoint:** `spike: audit-context decision record`.
- **Rollback concern:** none beyond spike artefacts.
- **Open/provisional dependency:** ~~AUD-OQ-02~~ (RESOLVED 2026-09-01 —
  layered A+B+C, `08` AUD-CTX-01).

---

**HARNESS GATE — human approval checkpoint — SATISFIED (2026-09-01).**
REL-HG-01…06 all verified; CI-equivalent command green on fresh checkout
(exact committed-HEAD `305d133`, 14/14 phases); both decision records
committed. Exit: recorded human approval 2026-09-01. **Harness Engineering
phase COMPLETE (IMP-000…IMP-005 all COMPLETE).** R0-B is UNLOCKED —
IMP-010 is the next implementation package but remains NOT STARTED until a
separate explicit implementation instruction.

### PHASE R0-B — Identity & Tenant Foundation (post-gate)

---

**IMP-010 — Tenant core schema & migration tooling** — **IMPLEMENTED (2026-09-01); acceptance checks green; awaiting Git checkpoint**

- **Outcome:** migration `supabase/migrations/20260901000000_tenant_core.sql`
  creates exactly `firms` (SCH-01), `profiles` (SCH-02), `firm_memberships`
  (SCH-03) with approved columns, CHECK vocabularies, uniques
  `(firm_id, user_id)` + `(firm_id, id)`, indexes `(user_id)` +
  `(firm_id, status)` (DEC-J live-lookup path served by the
  `(firm_id, user_id)` unique index), and the shared `updated_at` trigger
  (schema convention, not audit). Table grants revoked from
  anon/authenticated — fail-closed until IMP-012 (RLS + grants per `05`).
  Evidence: `tests/integration/schema/tenant-core.test.ts` (18 tests:
  TEST-SCH-02/03 tenant-core portion + structural/security assertions);
  double `db:reset:harness` from migration history with byte-identical
  public schema (pg_dump hash match); Harness Gate regression 15/15 green
  (new `schema-integration` phase; db-cleanliness now expects exactly the
  IMP-010 table set, spike-leak checks unchanged). TEST-MIG-07 is NOT
  claimed at this package (no data-source adapter until IMP-014).
  The package definition below is preserved as executed.

- **Purpose:** Forward-only migration tooling plus the tenant core tables:
  `firms`, `profiles`, `firm_memberships` (SCH-01…03) with constraints,
  composite same-firm FK pattern, and lifecycle vocabularies.
- **Requirement IDs:** SCH-01…03, SCH-FK-01…04, SCH-RESP-01…03;
  MIG-PRIN-01…07 (forward-only, ordering); DM-01…03, DM-X-05 (roles).
- **TEST-* IDs:** TEST-SCH-01…03 (FKs, composite FKs, uniques);
  TEST-MIG-06/07 (ordering, integrity).
- **Dependencies:** Harness Gate (PASS 2026-09-01 — dependency satisfied).
- **Allowed scope:** `supabase/migrations/` for SCH-01…03; migration
  tooling config; updated dev seed to real schema.
- **Non-goals:** no RLS policies here (IMP-012); no auth wiring (IMP-011).
- **Expected files/areas:** `supabase/migrations/`, `supabase/seed*`.
- **Entry criteria:** Harness Gate green (satisfied 2026-09-01).
- **Acceptance criteria:** schema applies clean from empty; constraints
  enforced; seed migrates to real tables.
- **Verification:** CI-equivalent + TEST-SCH-01…03.
- **Exit criteria:** migrations re-runnable from zero; seed green.
- **Human approval:** no (but diff review mandatory — REL-GIT-03).
- **Git checkpoint:** `feat: tenant core schema`.
- **Rollback concern:** local/staging only; forward-only per MIG-RBK-*.
- **Open/provisional dependency:** none blocking.

---

**IMP-011 — Staff authentication integration**

- **Purpose:** Supabase Auth for staff: email/password + magic link,
  TOTP MFA enrolment/challenge, AAL2 step-up plumbing, session handling
  (12 h inactivity / 7 d absolute targets — verified against platform, not
  assumed), invitation and suspension flows.
- **Requirement IDs:** AUTH-01…18; RLS-AAL-01…03 (consumed, defined in
  `05`); OPS-ENV-02/03 (client-safe vs server-only config).
- **TEST-* IDs:** TEST-AUTH-01…15; TEST-SEC-01…05.
- **Dependencies:** IMP-010 (profiles/memberships exist).
- **Allowed scope:** `src/` auth module behind the data layer, auth pages,
  session provider; Edge-free (no server secrets in browser).
- **Non-goals:** client-portal OTP login (DEC-K, Release 1+); no RLS
  policies.
- **Expected files/areas:** `src/lib/`, `src/pages/` (auth), `src/data/`
  adapter surface.
- **Entry criteria:** IMP-010 green; mail capture available (TEST-OQ-02).
- **Acceptance criteria:** TEST-AUTH-01…15 green incl. MFA device-loss
  recovery and AAL2 gating stubs.
- **Verification:** CI-equivalent + TEST-AUTH-*.
- **Exit criteria:** full staff auth lifecycle green locally.
- **Human approval:** **yes** — security-critical (authentication).
- **Git checkpoint:** `feat: staff authentication`.
- **Rollback concern:** feature-flaggable; no data migration.
- **Open/provisional dependency:** none blocking (session values verified
  in implementation per `04`).

---

**IMP-012 — Foundational RLS**

- **Purpose:** Implement the approved RLS foundation per the DEC-J
  decision record: tenant context, membership checks, portfolio scoping,
  suspended/removed membership denial, service-role rules.
- **Requirement IDs:** RLS-PRIN-01…04, RLS-CTX-01…03, RLS-TEN-01…03,
  RLS-MEM-01, RLS-PRF-01, RLS-FRM-01, RLS-STF-01…07, RLS-SVC-01…03,
  RLS-AAL-01…03; RLS-A-02 (`manager_membership_id` portfolio model).
- **TEST-* IDs:** TEST-RLS-GEN-01…04, TEST-RLS-MAT-01…03,
  TEST-RLS-SUP-01 (break-glass shape), TEST-SEC-*.
- **Dependencies:** IMP-010, IMP-011, **IMP-004 decision record**
  (COMPLETE — live membership lookup, `05` RLS-MECH-01).
- **Allowed scope:** policies/functions for SCH-01…03 (+ the mechanism
  helpers reused later); no domain tables yet.
- **Non-goals:** per-domain policies (later packages); DEC-J mechanism
  re-adjudication.
- **Expected files/areas:** `supabase/migrations/` (policy migrations).
- **Entry criteria:** DEC-J record approved; auth green.
- **Acceptance criteria:** full TEST-RLS-GEN/MAT matrix green against
  Firm A/B seeds, incl. offensive foreign-ID access attempts and
  mutation-denial surfacing.
- **Verification:** CI-equivalent + TEST-RLS-*.
- **Exit criteria:** tenant isolation proven on the tenant core.
- **Human approval:** **yes** — security-critical (RLS/tenant isolation).
- **Git checkpoint:** `feat: foundational RLS`.
- **Rollback concern:** policy rollback = redeploy previous migration
  state on staging; never partial-policy deploys.
- **Open/provisional dependency:** none — DEC-J resolved upstream
  (IMP-004, live membership lookup).

---

**IMP-013 — Audit foundation**

- **Purpose:** `audit_log` (SCH-20) with the actor model, immutability
  invariants, context propagation per the IMP-005 decision record, and
  audit-write failure handling.
- **Requirement IDs:** AUD-PRIN-01…03, AUD-ACT-01…05, AUD-CTX-01…03,
  AUD-INV-01…06, AUD-FAIL-01/02, AUD-EVT-01…03 (foundation subset),
  AUD-VAL-01/02; SCH-20; SCH-FK-01 (soft refs).
- **TEST-* IDs:** TEST-AUD-01…11.
- **Dependencies:** IMP-010, IMP-012, **IMP-005 decision record**.
- **Allowed scope:** audit table + write path + propagation plumbing;
  login/MFA audit events (AUD-LOGIN-01/02, AUD-MFA-01).
- **Non-goals:** retention configuration values (AUD-OQ-01 — production
  policy decision); per-domain audit event catalogue completion (lands
  with each domain package).
- **Expected files/areas:** `supabase/migrations/`, audit writer module.
- **Entry criteria:** audit-context record approved.
- **Acceptance criteria:** TEST-AUD-01…11 green; append-only enforced;
  audit-write failure surfaces per AUD-FAIL-01 (never silently lost).
- **Verification:** CI-equivalent + TEST-AUD-*.
- **Exit criteria:** audit foundation green; human/system/service/support
  actor distinction enforced.
- **Human approval:** **yes** — security-critical (audit).
- **Git checkpoint:** `feat: audit foundation`.
- **Rollback concern:** audit data is append-only; rollback must not
  delete audit rows (AUD-INV-*).
- **Open/provisional dependency:** AUD-OQ-02 (resolved upstream);
  AUD-OQ-01 stays open until production policy.

---

**IMP-014 — Data-source adapter skeleton**

- **Purpose:** Introduce the production data layer behind the existing
  `@/data` contract: explicit `DATA_SOURCE` selection, fixture adapter
  preserved as-is, Supabase adapter skeleton, fail-closed invalid config.
- **Requirement IDs:** API-ARCH-01…05; MIG-DS-01…06; OPS-ENV-06.
- **TEST-* IDs:** TEST-MIG-06/07/08 (mode independence, fail-closed, no
  fixture fallback), TEST-API-01…03 (contract conformance skeleton).
- **Dependencies:** IMP-010 (schema to target), IMP-011 (session context).
- **Allowed scope:** `src/data/` reorganization behind the barrel,
  adapter modules, config plumbing. UI components unchanged.
- **Non-goals:** no per-domain Supabase queries yet (land with domain
  packages); no direct Supabase imports in components (API-ARCH-02).
- **Expected files/areas:** `src/data/` only.
- **Entry criteria:** R0-B schema/auth green.
- **Acceptance criteria:** `DATA_SOURCE=fixture` behaves exactly as today;
  `DATA_SOURCE=supabase` serves session/firm/membership reads; invalid
  value fails closed; production config cannot select fixture.
- **Verification:** CI-equivalent + TEST-MIG-06…08 + demo smoke.
- **Exit criteria:** both modes green; demo deployment untouched.
- **Human approval:** no.
- **Git checkpoint:** `feat: data-source adapter skeleton`.
- **Rollback concern:** pure additive layer; revert restores fixture-only.
- **Open/provisional dependency:** none.

### PHASE R0-C — Core Domain

---

**IMP-020 — Client hierarchy persistence**

- **Purpose:** `clients`, `legal_entities`, `registrations`, `contacts`,
  `client_relationships` (SCH-04…08) with RLS, portfolio scoping, and the
  responsibility model (membership-based owner/manager).
- **Requirement IDs:** DM-04…08 (hierarchy), DM-X-01…05, SCH-04…08,
  SCH-RESP-01…03; RLS-CLI-01/02, RLS-ENT-01, RLS-REG-01, RLS-CON-01,
  RLS-POR-01…05.
- **TEST-* IDs:** TEST-SCH-01…04; TEST-RLS-GEN-*/MAT-* on these tables;
  TEST-API-* (CRUD contracts).
- **Dependencies:** IMP-012, IMP-013, IMP-014.
- **Allowed scope:** migrations + policies + `@/data` Supabase adapter
  implementations for these entities; audit events client.created/updated
  (AUTO-EVT catalogue).
- **Non-goals:** no UI redesign; no engagements (IMP-021); no documents.
- **Expected files/areas:** `supabase/migrations/`, `src/data/`.
- **Entry criteria:** R0-B green.
- **Acceptance criteria:** cross-firm CRUD denial proven; manager
  portfolio access per RLS-OQ-02 resolution; audit rows written.
- **Verification:** CI-equivalent + TEST-RLS/SCH/API families.
- **Exit criteria:** hierarchy usable end-to-end via the adapter.
- **Human approval:** **yes** — RLS-bearing, tenant isolation surface.
- **Git checkpoint:** `feat: client hierarchy persistence`.
- **Rollback concern:** staging-only until R0-H; forward-only migrations.
- **Open/provisional dependency:** none blocking.

---

**IMP-021 — Engagements**

- **Purpose:** `engagements` (SCH-09) persistence + RLS; engagement is an
  operational container, never the compliance subject (DM-OQ-01
  resolution, `02`).
- **Requirement IDs:** DM-09 (engagements), SCH-09, RLS-ENG-01.
- **TEST-* IDs:** TEST-SCH-*, TEST-RLS-GEN-* (engagements), TEST-API-*.
- **Dependencies:** IMP-020.
- **Allowed scope:** migrations, policies, adapter functions.
- **Non-goals:** billing linkage; portal visibility.
- **Expected files/areas:** `supabase/migrations/`, `src/data/`.
- **Entry criteria:** IMP-020 green.
- **Acceptance criteria:** CRUD + isolation green; engagement.created
  audit/event emitted.
- **Verification:** CI-equivalent + relevant families.
- **Exit criteria:** engagements usable from Client 360 adapter.
- **Human approval:** no (covered by IMP-020's RLS pattern review).
- **Git checkpoint:** `feat: engagements`.
- **Rollback concern:** standard.
- **Open/provisional dependency:** none.

---

**IMP-022 — Client 360 live wiring**

- **Purpose:** Switch Client 360 surfaces to the Supabase adapter behind
  `@/data`: client list/detail, hierarchy, contacts, engagement summary;
  fixture mode still selectable for demo.
- **Requirement IDs:** API-CONV-01…06, API-ERR-01…05, API-MUT-01…04;
  `07` R0 contracts for clients/entities/registrations/contacts.
- **TEST-* IDs:** TEST-API-01…10 (incl. existence-oracle resistance),
  TEST-E2E-03…05, TEST-COMP-*.
- **Dependencies:** IMP-020, IMP-021.
- **Allowed scope:** page-level data wiring, loading/error/empty states
  per `07`; no visual redesign.
- **Non-goals:** compliance panels (R0-D/E); documents tab content.
- **Expected files/areas:** `src/pages/` (client surfaces), `src/data/`.
- **Entry criteria:** adapter functions green.
- **Acceptance criteria:** E2E create/view client → entity → registration
  flows pass in supabase mode; fixture demo unchanged.
- **Verification:** CI-equivalent + TEST-E2E-03…05.
- **Exit criteria:** Client 360 core live on Supabase locally.
- **Human approval:** no.
- **Git checkpoint:** `feat: client 360 live data`.
- **Rollback concern:** mode switch back to fixture restores prior UI
  behavior.
- **Open/provisional dependency:** API-OQ-02 (pagination values per
  surface) decided during implementation within API-CONV-02.

### PHASE R0-D — Compliance Foundation

---

**IMP-030 — Compliance types & rule versions**

- **Purpose:** `compliance_types` (SCH-10) and `compliance_rule_versions`
  (SCH-32) with the immutable, effective-dated version lifecycle and the
  statutory activation gate (`domain_approval_status`, privileged +
  AAL2-gated activation). Security/compliance-sensitive.
- **Requirement IDs:** DM-10, DM-27 (Registration Scope Matrix —
  architecture-approved, external CA gate standing), SCH-10, SCH-32,
  RLS-CTY-01, RLS-CRV-01…05 + RLS-CRV-11, AUD-CRV-01…03, OPS-ACT-01…03.
- **TEST-* IDs:** TEST-RLS-CRV-01…11, TEST-SCH-07/08 (immutability,
  activation gate), TEST-AUD-* (rule-admin events).
- **Dependencies:** IMP-012, IMP-013.
- **Allowed scope:** migrations, policies, admin adapter functions,
  activation-flow plumbing (AAL2 check + approval-status invariant).
- **Non-goals:** no statutory rule *content* activation (external CA gate);
  no recurrence generation (IMP-050); reference seeds stay `draft`/
  `pending` per `10`.
- **Expected files/areas:** `supabase/migrations/`, `src/data/`.
- **Entry criteria:** R0-B green.
- **Acceptance criteria:** TEST-RLS-CRV matrix green; active/referenced
  versions immutable; activation attempt without approval status denied
  and audited (AUD-CRV-*).
- **Verification:** CI-equivalent + TEST-RLS-CRV-* + TEST-SCH-*.
- **Exit criteria:** rule-version lifecycle enforced at the database.
- **Human approval:** **yes** — security/compliance-critical.
- **Git checkpoint:** `feat: compliance types and rule versions`.
- **Rollback concern:** version rows are immutable history — rollback
  never rewrites them.
- **Open/provisional dependency:** external CA/domain sign-off (standing;
  blocks only production *activation*, not this build).

---

**IMP-031 — Compliance profiles & instances**

- **Purpose:** `client_compliance_profiles` (SCH-11) and
  `compliance_instances` (SCH-12) with scope invariants (entity vs
  registration per the approved matrix), provenance fields
  (`rule_version_id`, `generation_source`, `generated_at`,
  `calculated_due_date`, `period_start`, `period_end`), manual vs
  generated representation, and status state machines.
- **Requirement IDs:** DM-11, DM-27, DM-SM-01…06; SCH-11, SCH-12;
  RLS-CCP-01, RLS-CIN-01; AUTO-REC-03/07 (provenance contract,
  consumer-side); uniqueness incl. NULLS NOT DISTINCT behavior.
- **TEST-* IDs:** TEST-SCH-04…09 (scope invariants, uniqueness,
  provenance, lifecycle), TEST-RLS-GEN-*/MAT-*, TEST-API-*.
- **Dependencies:** IMP-030.
- **Allowed scope:** migrations, policies, adapter CRUD for profiles and
  manual instances; status transitions per DM-SM-*.
- **Non-goals:** the generator itself (IMP-050); alert evaluation
  (IMP-051).
- **Expected files/areas:** `supabase/migrations/`, `src/data/`.
- **Entry criteria:** IMP-030 green.
- **Acceptance criteria:** registration-scoped types reject entity-scoped
  rows and vice versa (GST/TDS/PT/PF/ESI vs ITR/ROC/Audit per the matrix);
  manual instances marked `generation_source='manual'`; provenance fields
  populated for any generated seed rows.
- **Verification:** CI-equivalent + TEST-SCH-*.
- **Exit criteria:** compliance foundation queryable per client/entity/
  registration with isolation proven.
- **Human approval:** **yes** — RLS-bearing compliance surface.
- **Git checkpoint:** `feat: compliance profiles and instances`.
- **Rollback concern:** standard forward-only.
- **Open/provisional dependency:** none blocking (MIG-OQ-04 back-
  materialization depth affects seeding, not schema).

### PHASE R0-E — Work Management

---

**IMP-040 — Tasks, dependencies, checklists, comments**

- **Purpose:** `tasks`, `task_dependencies`, `task_checklist_items`,
  `task_comments` (SCH-13…16): instance-linked and ad-hoc tasks (DEC-H,
  nullable `compliance_instance_id`), dependency acyclicity, immutable
  comments with retraction, explicit next-action fields for My Work.
- **Requirement IDs:** DM-12…14, DM-SM-* (task lifecycle), SCH-13…16,
  RLS-TSK-01, RLS-TCM-01; DEC-H.
- **TEST-* IDs:** TEST-SCH-05/06 (dependency constraints, acyclicity),
  TEST-RLS-*, TEST-API-*, TEST-E2E-07.
- **Dependencies:** IMP-031 (tasks may link instances), IMP-013.
- **Allowed scope:** migrations, policies, adapter functions, audit/
  domain events task.created/assigned/completed.
- **Non-goals:** workload recommendation intelligence (DEC-L deferral);
  My Work *surface* wiring is IMP-042.
- **Expected files/areas:** `supabase/migrations/`, `src/data/`.
- **Entry criteria:** R0-D green.
- **Acceptance criteria:** circular dependencies rejected; cross-firm task
  access denied; comment immutability enforced.
- **Verification:** CI-equivalent + TEST-SCH/RLS/API + TEST-E2E-07.
- **Exit criteria:** task subsystem green.
- **Human approval:** no (RLS pattern established; diff review required).
- **Git checkpoint:** `feat: tasks and dependencies`.
- **Rollback concern:** standard.
- **Open/provisional dependency:** none.

---

**IMP-041 — Review queue**

- **Purpose:** `review_items` (SCH-17) with the review lifecycle
  (submitted → approved/returned), four-eyes support, and review history.
- **Requirement IDs:** DM-15, DM-SM-05, SCH-17, SCH-10
  (`four_eyes_required` flag on compliance_types, `06`), RLS-RVW-01.
- **TEST-* IDs:** TEST-RLS-*, TEST-API-*, TEST-E2E-08.
- **Dependencies:** IMP-040.
- **Allowed scope:** migrations, policies, adapter functions; review
  submitted/completed events.
- **Non-goals:** final production review-type vocabulary is **not** frozen
  here — storage uses category keys with the vocabulary resolved before
  this package's schema migration is finalized (API-OQ-01 = SCH-OQ-02);
  demo strings are not the production taxonomy.
- **Expected files/areas:** `supabase/migrations/`, `src/data/`.
- **Entry criteria:** IMP-040 green; API-OQ-01 vocabulary decision
  recorded (requester input).
- **Acceptance criteria:** review submit/decision E2E green; returned
  items surface in My Work "Returned".
- **Verification:** CI-equivalent + TEST-E2E-08.
- **Exit criteria:** review queue functional with audit coverage.
- **Human approval:** no.
- **Git checkpoint:** `feat: review queue`.
- **Rollback concern:** standard.
- **Open/provisional dependency:** API-OQ-01 (blocks this package's
  schema finalization; latest safe decision point: here).

---

**IMP-042 — Alerts & My Work**

- **Purpose:** `alerts` and `alert_rules` (SCH-18/19) persistence + RLS;
  My Work surface (Today / This Week / Waiting / Returned / explicit next
  action, DEC-L) wired to live data.
- **Requirement IDs:** DM-16…18, DM-25, SCH-18, SCH-19, RLS-ALR-01,
  RLS-ARL-01 (rule administration roles per RLS-OQ-03 resolution);
  DEC-L.
- **TEST-* IDs:** TEST-RLS-*, TEST-API-*, TEST-E2E-09.
- **Dependencies:** IMP-040, IMP-041; alert *generation* lands in IMP-051
  — this package ships persistence, ack/resolve, and the My Work surface.
- **Allowed scope:** migrations, policies, adapter, My Work page wiring.
- **Non-goals:** alert-rule authoring UI beyond read/admin basics;
  workload recommendations; reminder delivery.
- **Expected files/areas:** `supabase/migrations/`, `src/data/`,
  `src/pages/` (My Work).
- **Entry criteria:** R0-E persistence green.
- **Acceptance criteria:** My Work quadrants reflect live tasks/reviews;
  alert ack/resolve audited (AUD-* per `08`); rule admin write restricted
  to super_admin/partner, manager read-only.
- **Verification:** CI-equivalent + TEST-E2E-09.
- **Exit criteria:** My Work and alerts live.
- **Human approval:** no.
- **Git checkpoint:** `feat: alerts and my work`.
- **Rollback concern:** standard.
- **Open/provisional dependency:** AUTO-OQ-04 (which rules ship enabled
  by default) affects seed config, not this schema.

### PHASE R0-F — Automation & Deadlines

---

**IMP-050 — Recurrence generation & scheduler signals**

- **Purpose:** Implement ComplianceProfile → active rule version →
  ComplianceInstance generation: deterministic recurrence identity,
  four-layer duplicate protection, provenance stamping, scheduler-signal
  processing (`sched.*` signals are not domain events, AUTO-PRIN-05).
- **Requirement IDs:** AUTO-PRIN-01…05, AUTO-REC-01…09, AUTO-SCH-01/02,
  AUTO-IDM-01, AUTO-FLOW-01…04, AUTO-EVT-01/02, AUTO-AUD-01/02,
  AUTO-OBS-01; SCH-12 provenance, SCH-32.
- **TEST-* IDs:** TEST-AUTO-01…12 (incl. concurrent-generator race,
  historical stability, event/signal separation, correlation propagation).
- **Dependencies:** IMP-031, IMP-013; **AUTO-OQ-01/02 technical
  validation** (final scheduler mechanism + event-publication mechanism —
  provisional hybrid pg_cron + Edge Functions / provisional outbox per
  `09`; validated here, not silently finalized).
- **Allowed scope:** generator function(s), scheduler wiring per the
  validated mechanism, idempotency/retry/dead-letter handling.
- **Non-goals:** reminder *delivery* (AUTO-RMD-01 produces reminder-ready
  events only); no activation of statutory rules.
- **Expected files/areas:** `supabase/` (functions, cron config),
  automation worker area.
- **Entry criteria:** R0-D green; AUTO-OQ-01/02 resolved by validation
  with results recorded in `09` (amendment).
- **Acceptance criteria:** double-run/race yields exactly one instance and
  one downstream event; rule edits never mutate historical instances;
  correlation IDs reach events and audit rows.
- **Verification:** CI-equivalent + TEST-AUTO-01…12.
- **Exit criteria:** recurrence green under retry/race/failure injection.
- **Human approval:** **yes** — automation writes compliance obligations;
  mechanism validation reviewed.
- **Git checkpoint:** `feat: recurrence generation`.
- **Rollback concern:** generator disable-able without data loss;
  generated rows remain valid history.
- **Open/provisional dependency:** AUTO-OQ-01, AUTO-OQ-02 (resolved at
  this gate); AUTO-OQ-03 (look-ahead default) set here as config.

---

**IMP-051 — Deadline materialization & alert evaluation**

- **Purpose:** Deadline views/materialization from instances + tasks;
  alert evaluation against alert_rules with dedupe, audit-logged
  auto-resolution, and manual acknowledgement.
- **Requirement IDs:** AUTO-DLN-01, AUTO-ALR-01…03, AUTO-RET-01/02,
  AUTO-RPL-01 (replay considerations); DM-17/18.
- **TEST-* IDs:** TEST-AUTO-02/04/06/08 (trigger points, dedupe +
  auto-resolution, retry, mechanism), TEST-API-* (deadline contracts).
- **Dependencies:** IMP-050, IMP-042.
- **Allowed scope:** evaluation functions, deadline read paths, alert
  lifecycle wiring.
- **Non-goals:** reminder delivery; new alert-rule families beyond seeded
  defaults (AUTO-OQ-04).
- **Expected files/areas:** `supabase/`, `src/data/`.
- **Entry criteria:** IMP-050 green.
- **Acceptance criteria:** deadlines correct across period boundaries;
  alert dedupe proven; auto-resolution audit-logged; manual ack respected.
- **Verification:** CI-equivalent + TEST-AUTO-*.
- **Exit criteria:** deadlines and alerts live end-to-end.
- **Human approval:** no (mechanism approved at IMP-050).
- **Git checkpoint:** `feat: deadlines and alert evaluation`.
- **Rollback concern:** evaluation re-runnable idempotently.
- **Open/provisional dependency:** AUTO-OQ-04 (default rule set) — product
  input needed before seed enablement.

### PHASE R0-G — Application Read Models

---

**IMP-060 — Command Centre & Morning Brief live data**

- **Purpose:** Aggregate read models behind `07` contracts: Command
  Centre sections and Morning Brief from live data, with tenant-scoped
  aggregation that never bypasses RLS.
- **Requirement IDs:** API-SEC-01…04 (aggregate RPC security),
  API-CONV-*, API-RT-01 (realtime rules context); API-OQ-03 (composite
  RPC vs per-section views — decided by measurement here).
- **TEST-* IDs:** TEST-API-04…08 (aggregate tenant isolation, no browser
  service-role, SECURITY DEFINER authorization where used), TEST-E2E-10.
- **Dependencies:** IMP-051.
- **Allowed scope:** read-model views/RPCs (RLS-respecting), page wiring.
- **Non-goals:** new metrics beyond approved contracts; cross-tenant
  aggregation of any kind.
- **Expected files/areas:** `supabase/` (views/RPC), `src/data/`,
  `src/pages/` (Command Centre, Morning Brief).
- **Entry criteria:** R0-F green.
- **Acceptance criteria:** aggregates match row-level truth under Firm A/B
  isolation tests; performance measured on representative volume
  (API-OQ-03 decision recorded).
- **Verification:** CI-equivalent + TEST-API-* + TEST-E2E-10.
- **Exit criteria:** both surfaces live with correct isolation.
- **Human approval:** no (aggregate security pattern reviewed via tests).
- **Git checkpoint:** `feat: command centre and morning brief live`.
- **Rollback concern:** read-only; safe.
- **Open/provisional dependency:** API-OQ-03 (resolved here, recorded).

---

**IMP-061 — Structured global search**

- **Purpose:** Server-side structured search across clients, entities,
  registrations, tasks, instances per `07` search contracts — scoped by
  the caller's firm and role visibility.
- **Requirement IDs:** `07` search contract (structured global search);
  API-SEC-*; RLS visibility inheritance.
- **TEST-* IDs:** TEST-API-* (search authorization: no existence leakage
  across tenants).
- **Dependencies:** IMP-060.
- **Allowed scope:** search RPC/views + palette wiring (existing ⌘K UI
  swapped to the adapter).
- **Non-goals:** full-text document search; pgvector/semantic search
  (deferred).
- **Expected files/areas:** `supabase/`, `src/data/`,
  `src/components/CommandPalette` wiring.
- **Entry criteria:** read models green.
- **Acceptance criteria:** Firm B user cannot surface Firm A records by
  id, name, or suggestion; result shaping per contract.
- **Verification:** CI-equivalent + TEST-API-*.
- **Exit criteria:** search live with isolation proven.
- **Human approval:** no.
- **Git checkpoint:** `feat: structured global search`.
- **Rollback concern:** read-only.
- **Open/provisional dependency:** none.

---

**IMP-062 — Limited Realtime**

- **Purpose:** Realtime for the two approved surfaces only: Review Queue
  freshness and alert badge/count (API-RT-01…07). Realtime is an
  optimization; correctness never depends on it.
- **Requirement IDs:** API-RT-01…07.
- **TEST-* IDs:** TEST-API-09/10 (missed/duplicate/out-of-order events;
  reconnect authoritative refresh; realtime not necessary for
  correctness); TEST-RLS-* (realtime tenant isolation under RLS).
- **Dependencies:** IMP-041, IMP-042.
- **Allowed scope:** subscriptions + reconnect/refresh logic for the two
  surfaces.
- **Non-goals:** realtime anywhere else; presence/broadcast features.
- **Expected files/areas:** `src/data/` realtime module, two surfaces.
- **Entry criteria:** review queue and alerts live.
- **Acceptance criteria:** killing the channel, duplicating events, or
  reordering them never corrupts state; re-entry refetches authoritative
  state.
- **Verification:** CI-equivalent + TEST-API-09/10.
- **Exit criteria:** freshness improved; correctness independent of
  realtime.
- **Human approval:** no.
- **Git checkpoint:** `feat: limited realtime`.
- **Rollback concern:** subscriptions removable; polling/refresh remains.
- **Open/provisional dependency:** none.

### PHASE R0-H — Migration & Cutover

---

**IMP-070 — Fixture demo preservation & adapter completion**

- **Purpose:** Finalize the dual-mode data layer: fixture adapter
  untouched for the demo deployment; Supabase adapter complete for all R0
  contracts; fixture→production entity mapping validated per `10`
  (mapping tables, transformation rules, fixture-only presentation data
  identified).
- **Requirement IDs:** MIG-PRIN-01…07, MIG-DS-01…06, MIG-VAL-01…03,
  MIG-PD-01 (pilot-data rule), MIG-SEED-*.
- **TEST-* IDs:** TEST-MIG-01…15 full pass.
- **Dependencies:** IMP-060…IMP-062 (all consumers exist).
- **Allowed scope:** `src/data/`, seed/mapping validation tooling.
- **Non-goals:** deleting fixture code; migrating demo content into any
  production database.
- **Expected files/areas:** `src/data/`, `supabase/seed*`, `docs/`
  (mapping validation report).
- **Entry criteria:** R0-G green.
- **Acceptance criteria:** full TEST-MIG matrix green; demo deployment
  verified unchanged; production config provably cannot fall back to
  fixture.
- **Verification:** CI-equivalent + TEST-MIG-01…15 + demo smoke.
- **Exit criteria:** both modes fully green; mapping validation recorded.
- **Human approval:** no (cutover approval is IMP-072).
- **Git checkpoint:** `feat: dual-mode data layer complete`.
- **Rollback concern:** demo mode is the rollback for UI issues.
- **Open/provisional dependency:** MIG-OQ-02 (closed at IMP-003),
  MIG-OQ-04 (back-materialization depth — product input needed before
  production onboarding seeds).

---

**IMP-071 — Staging deployment & verification**

- **Purpose:** Provision and verify the staging Supabase project +
  staging app deployment per `03` and `13`: isolated environment, secrets
  hygiene, migrations applied, seed/reference validation, smoke tests.
- **Requirement IDs:** TEN-07…24 (staging slice), MIG-DEP-01…04,
  OPS-ENV-01…06, OPS-HLT-01/02, OPS-BKP-01…04 (staging-verifiable parts).
- **TEST-* IDs:** TEST-MIG-11…15, TEST-OPS-01…10 (staging-applicable),
  full CI-equivalent against staging.
- **Dependencies:** IMP-070; **DEC-P region confirmation** (human).
- **Allowed scope:** staging project + deployment config; no production
  resources.
- **Non-goals:** production cutover; statutory activation.
- **Expected files/areas:** deployment config, `docs/` environment
  records.
- **Entry criteria:** IMP-070 green; DEC-P approved.
- **Acceptance criteria:** full gate suite passes against staging;
  fail-closed config proven; backup capability of the chosen plan verified
  in writing (OPS-OQ-02).
- **Verification:** CI-equivalent + TEST-MIG/OPS against staging.
- **Exit criteria:** staging certified; cutover checklist instantiated.
- **Human approval:** **yes** — first real infrastructure.
- **Git checkpoint:** `ops: staging verified` (config + records).
- **Rollback concern:** staging is disposable; rebuild from repo.
- **Open/provisional dependency:** DEC-P (blocks), OPS-OQ-01 (monitoring
  vendor — must be decided for staging observability), OPS-OQ-02
  (verification recorded here).

---

**IMP-072 — Production cutover & operational readiness**

- **Purpose:** Execute the MIG-DEP-04 cutover gate: production project,
  migrations, auth/RLS verification, seed/reference validation, smoke
  tests, Harness Gate re-run, rollback/recovery procedure, restore drill,
  runbooks live, explicit deployment approval.
- **Requirement IDs:** MIG-DEP-01…04, MIG-RBK-01…04, OPS-* (all),
  TEN-17…24 (production slice), DEC-P; AUD-OQ-01 (retention values set by
  policy decision here, not by engineering default).
- **TEST-* IDs:** TEST-OPS-01…10, TEST-MIG-*, TEST-RLS-*/AUTH-*/AUD-*
  re-run against production-shaped config (no production tenant data in
  tests).
- **Dependencies:** IMP-071; all REL-PG-* gates.
- **Allowed scope:** production env config, runbook instantiation, cutover
  record.
- **Non-goals:** statutory rule activation (separate external-CA gate);
  client portal; importing any real customer data without the MIG-PD-01
  documented path.
- **Expected files/areas:** deployment config, `docs/` cutover + drill
  records.
- **Entry criteria:** staging certified; every REL-PG-* item evidenced.
- **Acceptance criteria:** cutover checklist fully executed and recorded;
  restore drill passed; production fails closed on bad config; fixture
  unreachable in production.
- **Verification:** full CI-equivalent + cutover checklist + drill
  evidence.
- **Exit criteria:** Release 0 live; release approval recorded
  (REL-DOD-13).
- **Human approval:** **yes** — explicit production release approval.
- **Git checkpoint:** `ops: release 0 cutover record`.
- **Rollback concern:** per MIG-RBK-* — app rollback vs DB rollback
  distinguished; forward-fix preferred where rollback unsafe.
- **Open/provisional dependency:** DEC-P, AUD-OQ-01, OPS-OQ-02/03/04 —
  all resolved or explicitly deferred-outside-R0 at this gate.

## TEST mappings (summary)

Every TEST-* family defined in `11` is owned by at least one work package:

| Family | Owning package(s) |
|---|---|
| TEST-STACK-01…05 | IMP-001 |
| TEST-TAX-01/02 | IMP-001 (taxonomy binding verified) |
| TEST-UNIT-*, TEST-COMP-* | IMP-001 + every UI-touching package |
| TEST-SPIKE-J-01…03 | IMP-004 |
| TEST-SPIKE-CTX-01/02 | IMP-005 |
| TEST-AUTH-01…15 | IMP-011 |
| TEST-RLS-GEN-01…04, TEST-RLS-MAT-01…03 | IMP-012, then re-run per RLS-bearing package (020/030/031/040/041/042) |
| TEST-RLS-CRV-01…11 | IMP-030 |
| TEST-RLS-SUP-01 | IMP-012 (shape), IMP-072 (operations) |
| TEST-SCH-01…09 | IMP-010, IMP-020, IMP-030, IMP-031, IMP-040 |
| TEST-AUD-01…11 | IMP-013, extended per domain package |
| TEST-API-01…10 | IMP-014, IMP-022, IMP-060, IMP-061, IMP-062 |
| TEST-AUTO-01…12 | IMP-050, IMP-051 |
| TEST-MIG-01…15 | IMP-003, IMP-014, IMP-070, IMP-071 |
| TEST-E2E-01…12 | IMP-001 (skeleton), flows land with their packages; full pass at IMP-071 |
| TEST-SEC-01…05 | IMP-011, IMP-012, IMP-013 |
| TEST-OPS-01…10 | IMP-071, IMP-072 |

## Multi-LLM implementation protocol

- **REL-MLH-01:** Every implementation prompt must carry: authoritative
  spec references (file + section), requirement IDs, TEST-* IDs, allowed
  scope (files/areas), forbidden changes, acceptance commands, and the
  current Git checkpoint. The IMP-000 template defines the exact shape.
- **REL-MLH-02:** Any capable model may execute any package from its
  prompt alone; the repository — not model memory — is the source of
  truth (TEST-MLH-03).
- **REL-MLH-03:** For security-critical packages (IMP-004, IMP-005,
  IMP-011, IMP-012, IMP-013, IMP-030, IMP-031, IMP-050, IMP-071, IMP-072
  — covering RLS, authentication, service-role handling, audit, tenant
  isolation, migrations, break-glass), **implementer model ≠ reviewer
  model** where practical (TEST-MLH-04).
- **REL-MLH-04:** The executing agent must report changed files, map
  changes to requirement IDs and tests to TEST-* IDs, run the acceptance
  commands, and report failures openly — evidence over narration.

## Loop engineering

- **REL-LOOP-01:** Every package follows SPEC → IMPLEMENT → TEST →
  VERIFY → FIX → RE-TEST → REVIEW → HUMAN APPROVAL → GIT CHECKPOINT.
- **REL-LOOP-02:** No implementation agent may silently widen scope;
  allowed scope and forbidden changes are part of the prompt contract.
- **REL-LOOP-03:** On spec ambiguity or conflict: STOP, report the
  ambiguity with spec references, do not redesign. Resolution amends the
  governing spec first, then the package resumes.

## Git strategy

- **REL-GIT-01:** Implementation begins from a clean working tree; one
  bounded package per branch.
- **REL-GIT-02:** At the Final Spec Gate, spec work merges
  `sdd/foundation` → `main`; `main` becomes the implementation base.
  Implementation branches are named `r0/imp-NNN-<slug>` off `main`.
- **REL-GIT-03:** Review the full diff before every commit; commit only
  after the package's required tests pass; no mixing unrelated changes.
- **REL-GIT-04:** Security-critical packages (REL-MLH-03 list) merge only
  after recorded human approval.
- **REL-GIT-05:** Commit messages reference the IMP id and primary
  requirement IDs (e.g. `feat(IMP-012): foundational RLS [RLS-CTX-*]`).
- **REL-GIT-06:** Phase-gate completions are tagged (`r0a-harness-green`,
  `r0b-identity-green`, …, `r0h-cutover`) so any later agent can
  reconstruct verified checkpoints. No Git operations are executed in
  Phase 2; this section is binding for implementation.

## Open / provisional dependency matrix

| Item | Owner spec | Status | Blocking? | What it blocks | Latest safe decision point |
|---|---|---|---|---|---|
| DEC-J | `05` | **Resolved 2026-09-01 — live membership lookup (IMP-004 spike + human review)** | No (resolved) | — (IMP-012 proceeds on the resolved mechanism) | Resolved at IMP-004 (Harness Gate) |
| AUD-OQ-01 | `08` | Open — retention values are engineering placeholders | No (build); **Yes** (production retention config) | Production retention/archive configuration | IMP-072 (policy/legal confirmation) |
| AUD-OQ-02 | `08` | **Resolved 2026-09-01 — layered A+B+C audit-context propagation (IMP-005 spike + human review)** | No (resolved) | — (IMP-013 proceeds on the resolved mechanism) | Resolved at IMP-005 (Harness Gate) |
| RLS-OQ-04 | `05` | Open — deferred | No | Release 1 client-visible document flagging only | Release 1 specs |
| API-OQ-01 (= SCH-OQ-02) | `07` | Open | **Yes** (one schema) | `review_items.type` production vocabulary | IMP-041 schema finalization (requester input) |
| API-OQ-02 | `07` | Open — convention fixed | No | Per-surface pagination values only | During each surface's package |
| API-OQ-03 | `07` | Open | No | Composite RPC vs per-section views shape | IMP-060 (measured) |
| API-OQ-04 (= SCH-OQ-03) | `07` | Open | No | Re-invite persistence semantics (API separates the three operations already) | IMP-010/011 membership implementation |
| AUTO-OQ-01 (= DEC-OQ-02) | `09` | Open — provisional hybrid | **Yes** (final mechanism) | Final scheduler mechanism in IMP-050 | IMP-050 entry (technical validation) |
| AUTO-OQ-02 | `09` | Open — provisional outbox | **Yes** (final mechanism) | Event-publication implementation in IMP-050 | IMP-050 entry (technical validation) |
| AUTO-OQ-03 | `09` | Open | No | Recurrence look-ahead default value | IMP-050 (config) |
| AUTO-OQ-04 | `09` | Open | No | Default enabled alert rules + thresholds | IMP-051 seeding (product input) |
| MIG-OQ-02 | `10` | Open | No | Deterministic-id scheme detail | IMP-003 |
| MIG-OQ-04 | `10` | Open | No (R0 build); **Yes** (production onboarding) | Historical back-materialization depth for real clients | IMP-072 (product input) |
| DEC-P | `01` | Open — Mumbai default, human confirmation required | **Yes** (hosted infra) | Staging/production provisioning | IMP-071 entry |
| OPS-OQ-01 | `13` | Open | No (build); **Yes** (staging observability) | Error-monitoring vendor selection | IMP-071 |
| OPS-OQ-02 | `13` | Open — do not claim until verified | **Yes** (cutover) | Backup/PITR reliance, TEN-24 targets | IMP-071 (verify), IMP-072 (rely) |
| OPS-OQ-03 | `13` | Open | No | Post-cutover restore-drill cadence | IMP-072 |
| OPS-OQ-04 | `13` | Open | No (build); **Yes** (statutory activation) | CA-approval evidence format | Before any statutory activation |
| TEST-OQ-01 | `11` | Open — provisional p95 budget | No | DEC-J latency acceptance value | IMP-004 (evidence may revise) |
| TEST-OQ-02 | `11` | Open | No | Mail-capture tooling for auth E2E | IMP-001/IMP-011 |
| TEST-OQ-03 | `11` | Open — deferred with Release 1 | No | Storage RLS tests (Release 1 documents) | Release 1 specs |
| TEST-OQ-04 | `11` | Open | No | CI platform choice | IMP-001 |

## Production gates

- **REL-PG-01:** Architecture approval (Phase 2, this document and its
  inputs) is categorically distinct from production readiness (REL-PG-02…
  07). Completing implementation is never, by itself, permission to
  activate production or statutory rules.
- **REL-PG-02:** DEC-P production-region approval recorded before any
  hosted provisioning (IMP-071 entry).
- **REL-PG-03:** Supabase plan backup/PITR capabilities verified in
  writing against the actual plan (OPS-OQ-02) before cutover reliance;
  RPO ≤ 24 h / RTO ≤ 8 h remain engineering targets, not SLAs (TEN-24).
- **REL-PG-04:** Harness Gate green and re-verified at cutover
  (MIG-DEP-04); TEST-RLS-*/TEST-AUTH-*/TEST-AUD-*/TEST-MIG-*/TEST-OPS-*
  passing.
- **REL-PG-05:** Migration verification per `10` phases: entry/exit
  criteria met, integrity checks green, rollback/recovery procedure exists
  and restore drill passed.
- **REL-PG-06:** Operational readiness per `13`: fail-closed config,
  logging/redaction, monitoring, runbooks, incident basics, break-glass
  operations — evidenced, not asserted.
- **REL-PG-07:** Statutory-rule activation remains gated on external
  CA/compliance-domain sign-off plus OPS-ACT-01…03 controls — a separate,
  later, explicitly human gate that R0 completion does not open.

## Release 0 Definition of Done

- **REL-DOD-01:** All R0-scope requirement families from the approved
  specs are implemented or explicitly deferred outside R0 with recorded
  approval.
- **REL-DOD-02:** The Harness Gate is green and remains green at head.
- **REL-DOD-03:** Required TEST-* families pass per the mapping table.
- **REL-DOD-04:** Tenant isolation verified (TEST-RLS-GEN/MAT full matrix,
  offensive foreign-ID attempts included).
- **REL-DOD-05:** Auth/MFA flows verified (TEST-AUTH-01…15).
- **REL-DOD-06:** Audit coverage verified (TEST-AUD-01…11; actor model,
  immutability, failure handling).
- **REL-DOD-07:** Migration/cutover verified (TEST-MIG-01…15; MIG-DEP-04
  checklist executed).
- **REL-DOD-08:** The fixture demo deployment remains functional and
  unchanged.
- **REL-DOD-09:** Production mode has no fixture fallback; invalid
  DATA_SOURCE fails closed.
- **REL-DOD-10:** Operational runbooks exist (OPS-RUN-01…07) and the
  restore/recovery procedure is validated by drill.
- **REL-DOD-11:** Every open item in the dependency matrix is either
  resolved with evidence or explicitly deferred outside R0 with recorded
  approval.
- **REL-DOD-12:** No statutory rule version is active in production
  without the external CA/compliance-domain sign-off (standing gate).
- **REL-DOD-13:** Human release approval recorded (IMP-072 exit).

## Acceptance Criteria

- **REL-ACC-01:** Phases R0-A…R0-H are dependency-ordered with explicit
  gates, and the Harness Gate precedes all feature implementation.
- **REL-ACC-02:** Every work package carries all REL-WP-01 fields with
  real requirement/TEST references to approved specs.
- **REL-ACC-03:** DEC-J and AUD-OQ-02 are gated (spike → decision record →
  spec amendment) before dependent implementation; neither is silently
  resolved here. DEC-J: **satisfied** (IMP-004, 2026-09-01). AUD-OQ-02:
  **satisfied** (IMP-005, 2026-09-01).
- **REL-ACC-04:** Every open/provisional item from the approved specs
  appears in the dependency matrix with a blocking assessment and latest
  safe decision point.
- **REL-ACC-05:** Multi-LLM protocol, loop rules, and Git strategy are
  binding and reference TEST-MLH-*.
- **REL-ACC-06:** Production gates and the Release 0 Definition of Done
  are explicit, and the statutory external-CA gate is preserved.
- **REL-ACC-07:** No out-of-R0 scope (DEC-C/K/M deferrals) is scheduled.

## Consequence of Change

This plan is the execution contract for Release 0. Reordering phases,
relaxing a gate, advancing a package past an unresolved blocking item, or
adding scope requires requester sign-off and, where the change touches
approved architecture, amendment of the governing spec first. Weakening
REL-HG/REL-PG/REL-DOD items changes what "done" means for the entire
release. Spike decision records (IMP-004/005) amend `05`/`08` and may
revise provisional values in `11` (TEST-OQ-01) — those amendments are the
sanctioned path, not silent deviation.

## Approval Status

Approved (Batch 6). All open/provisional items from approved specs remain
open as tabulated; this document resolves none of them.
