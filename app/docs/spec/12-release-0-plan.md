# 12 — Release 0 Execution Plan

- **Status:** Approved (Batch 6)
- **Approval status:** Approved (Batch 6). Open/provisional items remain open as tabulated in the Open / Provisional Dependency Matrix (AUD-OQ-01, RLS-OQ-04, API-OQ-02, API-OQ-04, AUTO-OQ-04, MIG-OQ-02/04, DEC-P, OPS-OQ-01…04, TEST-OQ-01…04). This document resolves none of them. **AUTO-OQ-01/02/03 are RESOLVED by human ruling 2026-09-11 (IMP-050 architecture amendment, recorded normatively in `09` and `06`): pg_cron + hardened in-database scheduler/job functions is the final R0 scheduler (pg_net not required for R0; HTTP/Edge scheduling deferred to R1+); the transactional outbox is the final event-publication mechanism (direct invocation rejected for R0; schema contracts SCH-33/34/35 in `06`); the recurrence look-ahead default is 90 calendar days (configurable) on an Asia/Kolkata business-date basis with UTC-persisted timestamps. AUTO-SCH-02 is recorded PASS (LOCAL/HOSTED/OVERALL); hosted pg_cron is available (default 1.6.4) but NOT installed — hosted `CREATE EXTENSION` remains a future explicit human gate.** **DEC-J is RESOLVED (2026-09-01): IMP-004 complete — live membership lookup selected (`05` RLS-MECH-01; evidence `docs/harness/dec-j-spike.md`).** **AUD-OQ-02 is RESOLVED (2026-09-01): IMP-005 complete — layered A+B+C audit-context propagation selected (`08` AUD-CTX-01; evidence `docs/harness/audit-context-spike.md`).** **API-OQ-01 is RESOLVED (2026-09-05): IMP-041 contract closure — R0 `review_items.type` vocabulary frozen to `gst_reconciliation`, `tds_return`, `itr_computation`, `financial_statements`, `audit_workpaper` (SCH-17 CHECK, `06`/`07`).** **API-OQ-03 is RESOLVED (2026-09-19): IMP-060 pre-implementation package-contract recording — human-approved B-count (RLS-respecting per-section exact-count reads with limited row fetches only where an approved derivation genuinely requires rows) selected over the composite SECURITY INVOKER RPC and B-fetch candidates on the measured local representative-volume benchmark (all three candidates passed three-way semantic/security validation); recorded normatively in `07` (API-R0-DASH + API-OQ matrix) and in the IMP-060 package section below; hosted-network behavior is validated at hosted staging acceptance.** **API-OQ-02 is RESOLVED for the IMP-060 read-model surfaces (2026-09-19): scalar aggregate counts need no pagination; existing list contracts keep their already-approved pagination; any genuinely new paginated list uses the API-CONV-02 default 50 / maximum 200.** **The Harness Gate is PASS — human approved 2026-09-01 (evidence commit `305d133`; exact committed-HEAD verified from a fresh detached worktree: 14/14 phases green; evidence `docs/harness/harness-gate.md`).** IMP-000…IMP-005 are all COMPLETE; the Harness Engineering phase is COMPLETE. **IMP-010 is COMPLETE (2026-09-01 — Git checkpoint `c913b9d`).** **IMP-011 is COMPLETE (2026-09-01 — Git checkpoint `8ea9c4a`).** **IMP-012 is COMPLETE (2026-09-01 — Git checkpoint `7f5c7b6`).** **IMP-013 is COMPLETE (2026-09-02 — Git checkpoint `3ee1e6d`).** **IMP-014 is COMPLETE (2026-09-02 — Git checkpoint `3fed76a`).** **IMP-020 is COMPLETE (2026-09-02 — Git checkpoint `1d7bbb1`).** **IMP-021 is COMPLETE (2026-09-03 — Git checkpoint `c38c758`).** IMP-022 is IMPLEMENTED (2026-09-03); acceptance checks green; awaiting human approval and Git checkpoint. **IMP-022 implementation interpretations recorded (2026-09-03):** (A) Client 360 composite is an application-side composition over plain RLS reads (`07` API-R0-CLI / DM-X-02) — deliberately NO aggregate SECURITY DEFINER RPC, so the composition cannot widen table RLS; (B) API-OQ-02 resolved for the client list: offset pagination, page size 50 (API-CONV-02 default); (C) RequireAuth bootstraps the single active-firm context from live memberships before first render (RLS-CTX-01/02) — context selection, not authorization; multi-firm switcher UI deferred; (D) senior/article/billing receive no composite (safe null per API-ERR-02); billing's IMP-020/021 projections stay separate; (E) deferred tabs (Compliance/Documents/Financials) render explicit deferred states; Communications is the DM-15-approved placeholder; (F) the active-firm bootstrap is identity-bound (cleared on logout / identity change / session replacement BEFORE the new identity's pages render) and the temporary R0 multi-firm default is deterministic — smallest ACTIVE firm id via `resolveDefaultActiveFirm` (RLS-CTX-02; switcher UI deferred to a later package). **IMP-021 implementation interpretations recorded (2026-09-02):** (A) manager engagement access is portfolio-scoped READ-ONLY via the owning client's designated manager — writes are partner+ per `05` RLS-ENG-01; (B) billing has no table access — letter-status-only projection via `list_engagement_letter_statuses()` (active-firm pinned, same predicate family as `05` RLS-A-04); (C) invalid `engagements.status` transitions raise a CHECK violation marked `INVALID_TRANSITION:engagements.status`, which maps to `conflict`; plain CHECK violations stay `validation` (extends the IMP-020 closure (C) `07` API-ERR-01 convention); (D) `responsible_partner_membership_id` is validated as an ACTIVE same-firm membership with no role predicate (mirrors the IMP-020 DM-04 precedent); (E) senior/article engagement access deferred to IMP-030/040 (nothing in R0, same deferral as IMP-020). **IMP-061 is in CONTRACT PHASE (2026-09-19): final human rulings IMP061-R1…R10 + IMP061-M1 APPROVED and recorded normatively in `07` API-R0-SRC, `11` (TEST-API-21…24, TEST-E2E-13), and the IMP-061 package contract below; contract discovery PASS, local spike PASS, fresh independent spike review PASS (CRITICAL=0/HIGH=0; MEDIUM=2 resolved into the contract; LOW=4 historical spike-quality observations); explicit human implementation authorization was subsequently GRANTED and primary implementation discovery STOPPED cleanly before code on a navigation-feasibility gap; final human ruling IMP061-R11 = R11-A (optional truthful navigation) APPROVED 2026-09-20 and recorded in the IMP-061 package contract below; implementation execution is PAUSED pending fresh independent R11 contract-amendment review and an amendment Git checkpoint — no implementation checkpoint, no migration, no hosted/production change.**

## Purpose

Convert the approved Phase 2 specifications (00–11, 13) into an ordered,
dependency-explicit Release 0 implementation plan: phases, work packages
(IMP-*), the Harness Gate, human approval gates, Git checkpoints, the
open/provisional dependency matrix, production gates, and the Release 0
Definition of Done.

This document **sequences** approved architecture; it does not redesign it.
Where an approved spec leaves an item OPEN or PROVISIONAL, this plan
preserves that status and attaches it to the gate at which it must be
resolved. Nothing here silently resolves AUD-OQ-02,
DEC-P, or any other recorded open question. (DEC-J was resolved by the
approved IMP-004 spike amendment, 2026-09-01 — live membership lookup.
AUD-OQ-02 was resolved 2026-09-01 via IMP-005. AUTO-OQ-01/02/03 were
resolved by explicit human ruling 2026-09-11, recorded in the IMP-050
architecture amendment in `09`/`06` — this plan reconciles that record;
it did not resolve them.)

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
- **REL-PRIN-03:** Open stays open. A provisional mechanism
  (historically DEC-J and AUD-OQ-02 — both resolved 2026-09-01 through
  this rule — and AUTO-OQ-01/02 — resolved by human ruling 2026-09-11,
  recorded in `09`/`06`)
  is implemented only after its gate produces a
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

**IMP-010 — Tenant core schema & migration tooling** — **COMPLETE (2026-09-01 — Git checkpoint `c913b9d`)**

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

**IMP-011 — Staff authentication integration** — **COMPLETE (2026-09-01 — Git checkpoint `8ea9c4a`)**

- **Outcome:** dual-mode auth adapter behind the data layer
  (`src/data/auth/` — fixture demo persona vs Supabase Auth service; React
  never touches Supabase directly), central lazy browser client
  (`src/lib/supabaseClient.ts`, anon key only) and fail-closed client-safe
  env (`src/lib/env.ts`, MIG-DS-03 hard error in supabase mode; strict
  DATA_SOURCE startup validation stays with IMP-014). Staff UI: sign-in
  (password + magic link), forgot/reset password, TOTP enrol + challenge
  pages, and `RequireAuth` authentication-level route protection with the
  AUTH-10 client-side mandatory-MFA gate stub (no membership/role data
  consulted — DEC-J). Invitation-only onboarding enforced by platform
  config: `[auth] enable_signup = false` (422 `signup_disabled`; verified),
  session targets `timebox = 168h` / `inactivity_timeout = 12h`, TOTP
  enrol/verify enabled, loopback redirect URLs. No migration required —
  IMP-010 migration byte-unchanged; zero RLS policies (IMP-012); zero
  audit objects (IMP-013); anon/authenticated grants on the tenant core
  remain revoked. Evidence: `tests/integration/auth/` 31 tests across
  TEST-AUTH-01…09 + TEST-AUTH-14 + TEST-AUTH-15 config/measurement
  assertions (TEST-AUTH-10/11 recorded as config verification); refresh
  rotation asserted against actual GoTrue v2.196.0 v1-token semantics
  (fail-to-save parent tolerance; hard "Already Used" detection +
  family revocation beyond the 10 s reuse interval — recorded in `13`).
  Component/unit: `tests/components/SignIn.test.tsx`,
  `tests/unit/env.test.ts`, `tests/unit/authService.test.ts` (23/23 unit
  total). Playwright `staff-auth` project (local-stack-gated, port 3100,
  `VITE_DATA_SOURCE=supabase`): unauthenticated redirect, invalid
  credentials, valid login → MFA-enrol gate (4/4 incl. smoke).
  `npm run verify` green; `npm run verify:harness` 15/15 green;
  secret/bundle scan clean. Mechanism-level caveats: invitation
  admin-authz wrapper and device-loss audit row land with IMP-012/013;
  DB AAL2 enforcement (RLS-AAL-01) is IMP-012; profile-creation
  production RPC deferred. The package definition below is preserved as
  executed.

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

**IMP-012 — Foundational RLS** — **COMPLETE (2026-09-01 — Git checkpoint `7f5c7b6`)**

- **Outcome:** production migration
  `supabase/migrations/20260901120000_foundational_rls.sql` enables RLS on
  the IMP-010 tenant core (`firms`, `profiles`, `firm_memberships`) with 7
  policies — `firms_select_member`, `firms_update_super_admin`;
  `profiles_select_own_or_shared_firm`, `profiles_update_self`;
  `memberships_select_own_or_active_firm`,
  `memberships_insert_super_admin_aal2`,
  `memberships_update_super_admin_aal2` — and restores least-privilege
  `authenticated` grants (table-level SELECT on firms/memberships;
  column-level SELECT(id, full_name, avatar_url) + UPDATE on profiles;
  column-level INSERT/UPDATE on memberships/firms; anon unchanged at zero;
  no DELETE anywhere). DEC-J mechanism: helpers
  `active_membership_role(uuid)` and `shares_active_firm_with(uuid)` are
  SECURITY DEFINER (RLS self-recursion avoidance / selector-independent
  shared-firm predicate; pinned `search_path`, owned by postgres, EXECUTE
  to `authenticated` only) and `req_active_firm()` SECURITY INVOKER reads
  the untrusted `x-active-firm` header — a selector grants nothing by
  itself; every check resolves `auth.uid()` + live `firm_memberships`
  status/role. AAL2 enforcement is inline
  `(select auth.jwt() ->> 'aal') = 'aal2'` on membership administration
  (RLS-AAL-01). FORCE RLS intentionally NOT set on the tenant core:
  RLS-PRIN-02's forced requirement targets tenant-owned SCH-04+ tables;
  forcing SCH-01…03 would recurse the DEFINER membership helper and break
  owner-run seeds (no JWT) — documented exception, asserted in
  `tests/integration/schema/rls-catalog.test.ts`. Verified behavior (33
  tests, `tests/integration/rls/tenant-core-rls.test.ts`, real PostgREST
  calls with signed-in tokens; service role only for fixture setup /
  controlled membership mutation / teardown): same-firm read,
  cross-firm read/insert/update/delete denial, known foreign ids leak
  nothing, forged selector grants nothing, self-elevation denied,
  `invited_by` server-derived, suspension/removal/downgrade/upgrade take
  effect on the next authorization check with the same pre-issued token,
  multi-firm A→B→A isolation, aal1 denied / aal2 allowed /
  aal2+wrong-role denied / aal2+wrong-firm denied (real TOTP enrolment),
  anon denied. Catalog suite (11 tests) asserts RLS state, exact policy
  inventory, exact grants, helper security properties, and the
  index-served DEC-J lookup path. Runtime discovery recorded: PostgREST
  applies the SELECT policy to write row-scans and RETURNING — membership
  administration therefore sends `x-active-firm` for the administered
  firm, and profile writes use `Prefer: return=minimal`. Harness fix:
  `vitest.integration.config.ts` now sets `fileParallelism: false`
  (`forks: { singleFork: true }` was silently ignored by Vitest 4 and let
  fixture-sharing files race). Harness Gate `db-cleanliness` phase now
  also asserts RLS enabled on all 3 tables + the exact 7-policy
  inventory; all other checks unchanged. Acceptance: `db:reset:harness`
  ×2 from scratch — identical schema, 16/16 deterministic identities;
  `test:auth` 31/31; `test:rls` 51/51 (hgate 18 + tenant-core 33);
  `test:schema` 29/29; `test:integration` 111/111; `test:e2e` 4/4;
  `npm run verify` green; `npm run verify:harness` 15/15 green;
  `supabase db lint --level warning` clean. IMP-010 migration
  byte-unchanged; zero audit objects (IMP-013); zero domain tables.
  Honest non-claims: TEST-RLS-MAT-02/03 need domain tables (later
  packages); TEST-RLS-SUP-01 break-glass shape deferred (IMP-013/072);
  RLS-AAL-03 AAL-freshness window not fixed here; production staff/client
  overlap coverage deferred to the owning client-access package (harness
  mechanism test stands); portfolio scoping (RLS-A-02) lands with the
  table-owning package. The package definition below is preserved as
  executed. **Superseded by IMP-013 (2026-09-02):** the firm_memberships
  INSERT/UPDATE policies (`memberships_insert_super_admin_aal2`,
  `memberships_update_super_admin_aal2`) and the column write grants were
  removed when membership administration moved to Layer-B RPCs
  (API-ARCH-04 / AUD-CTX-04) — the policy inventory is now 6 and the gate
  expectation updated accordingly; all read policies and the DEC-J
  mechanism are unchanged.

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

**IMP-013 — Audit foundation** — **IMPLEMENTED (2026-09-02); acceptance checks green; awaiting human approval and Git checkpoint (security-critical: audit)**

- **Outcome:** production migration
  `supabase/migrations/20260902000000_audit_foundation.sql` implements the
  resolved AUD-OQ-02 layered A+B+C architecture. **SCH-20 `audit_log`**:
  append-only, soft references only (SCH-FK-03), actor-model CHECK
  (AUD-ACT-05), the four spec'd indexes, no `updated_at`; RLS enabled AND
  forced (tenant-owned rows, RLS-PRIN-02 — safe because every writer is a
  postgres-owned definer) with one SELECT policy
  `audit_select_partner_admin` (RLS-AUD-01); grants: SELECT to
  `authenticated` only, nothing for anon, and NO table privilege for
  service_role (Layer-C writes go through the definer writers, which run
  as the owner). **Layer A:** `audit_trg_row()` AFTER trigger on firms /
  firm_memberships / profiles (the R0 HIGH/MEDIUM tables) — actor from
  `auth.uid()` / jwt `role='service_role'` / operator fallback
  (`human` / `service` / `system:database-operator`), firm/object from the
  row, old/new per AUD-VAL-01; AUD-VAL-02 redaction review recorded: none
  identified. **Layer B** (API-ARCH-04 / AUD-CTX-04 / API-R0-FRM):
  membership administration moved off raw PostgREST writes onto
  `invite_member` / `change_membership_role` / `suspend_membership` /
  `remove_membership` (super_admin + AAL2 + live DEC-J membership check;
  mutation + audit atomic in one transaction; 42501 denials) and
  self-service `accept_invitation` (no AAL2 — acceptance precedes MFA
  enrolment, AUTH-10 ordering). The IMP-012 INSERT/UPDATE policies and
  column write grants on firm_memberships were dropped/revoked here
  (policy inventory 7→6); IMP-010/IMP-012 migration files byte-unchanged.
  Re-invite of removed memberships deliberately NOT implemented
  (SCH-OQ-03/API-OQ-04 OPEN — surfaces as 409). **Layer C foundation:**
  `write_audit_event()` (authenticated; actor always `auth.uid()`; live
  membership guard), `write_audit_event_server()` (service_role only; full
  AUD-ACT actor model; server-asserted metadata), and
  `mirror_login_history()` (service_role only; mirrors
  `auth.audit_log_entries` as system-actor NULL-firm platform rows,
  idempotent — AUD-LOGIN-01/02; scheduler binding deferred, decision N).
  Internal `audit_write()` is owner-only. Metadata trust model per
  AUD-CTX-02: ip/UA/XFF/correlation recorded from request headers as
  non-authoritative metadata; actor/firm NEVER from headers (spoofing
  battery tested). Fail-closed (AUD-CTX-05): mutation + audit succeed or
  roll back together on both the trigger and RPC paths, proven via a
  psql-only `app.audit_fault` test hook (unreachable from PostgREST).
  Request-context state is transaction-local only (AUD-CTX-03);
  sequential + concurrent leakage tests green. Documented deviations:
  profile audit rows carry `firm_id = NULL` with a human/system actor
  (profiles are global identity data, TEN-04 — extends the AUD-EVT-03
  marker wording; the actor-model CHECK is still enforced); mirror rows
  carry the GoTrue-server-generated entry timestamp (AUD-INV-02 intent —
  never client-supplied). **Tests:** new
  `tests/integration/audit/audit.test.ts` (31) — TEST-AUD-01/02/04/07/08/09
  plus the spoofing battery, leakage/concurrency, RPC authorization matrix
  with same-token freshness, RLS-AUD-01 reads, Layer-C behavior, and
  SCH-20 structure; `tenant-core-rls.test.ts` now drives administration
  through the RPCs and asserts the raw write path is closed (rls 52/52);
  invitation acceptance uses the production `accept_invitation` RPC
  (auth 31/31); the catalog suite asserts the new function/grant/policy
  inventory (schema 30/30). **Deferred with reasons:** TEST-AUD-03 (no
  instance/task/review/alert tables), TEST-AUD-05 (no support_sessions
  table in the R0 schema inventory — IMP-072), TEST-AUD-06 (MFA-recovery
  Edge Function deferred; the Layer-C contract it will use IS tested),
  TEST-AUD-10 (AUD-OQ-01 OPEN — no retention path exists to test;
  immutability coverage stands), TEST-AUD-11 (SCH-32 rule versions land in
  a later package). **AUD-OQ-01 remains OPEN** — no retention, purge,
  archival, or legal-hold behavior implemented. Harness Gate: new
  `audit-integration` phase; db-cleanliness now expects exactly 4 tables /
  6 policies / FORCE on audit_log; all other checks unchanged. Acceptance:
  `db:reset:harness` ×2 from scratch — identical 117-line schema
  fingerprint, 16/16 deterministic identities; test:auth 31/31;
  test:rls 52/52; test:schema 30/30; test:audit 31/31;
  test:integration 144/144; test:e2e 4/4; `npm run verify` green;
  `npm run verify:harness` 16/16; `supabase db lint --level warning`
  clean; no hgate_/decj_/audctx_ objects; no domain tables; no frontend
  changes. The package definition below is preserved as specified.

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
  RLS-CTY-01, RLS-CRV-01…05, AUD-CRV-01…03, OPS-ACT-01…03, API-R0-CTY,
  API-R0-CRV.
- **TEST-* IDs:** TEST-RLS-CTY-*, TEST-RLS-CRV-01…13 (incl.
  TEST-RLS-CRV-11 statutory-activation denial; 12/13 lifecycle-command
  and succession-history cases), TEST-SCH-06/07 (immutability,
  activation gate), TEST-SCH-10/11 (effective windows, governance
  classification), TEST-AUD-01/02/07/09/11 (rule-admin events).
- **Pre-implementation closure (2026-09-03):** (a) the former
  "RLS-CRV-11" reference here meant TEST-RLS-CRV-11 — the RLS-CRV
  requirement family ends at 05; (b) Manager is read-only on compliance
  types/rule versions — the `05` §11 matrix "propose" cell is corrected
  (RLS-PRIN-02 default-deny; no proposal object/contract exists);
  (c) API-R0-CRV is defined in `07` (list/get/create draft/draft-edit/
  controlled activation command; no DELETE); (d) SCH-32 deliberately has
  no `updated_at` (`06` Conventions exception); (e) no browser role can
  set `domain_approval_status='approved'` — the statutory
  `pending → approved` transition has no browser-facing R0 command until
  OPS-OQ-04 is resolved, and the activation command never mutates
  approval state (RLS-CRV-03 approval authority). **Rule-governance
  closure (2026-09-03):** (f) immutability vs supersession reconciled —
  SCH-32 columns are classified rule-content (class A, frozen once
  active/referenced), lifecycle metadata (class B: `status`/
  `effective_to`, mutable ONLY via the controlled Layer-B lifecycle
  command), creation/provenance (class C, insert-only), and governance
  state (`domain_approval_status`, deferred approval path only); ordinary
  UPDATE never performs lifecycle transitions; (g) effective windows are
  half-open (`effective_from` inclusive / `effective_to` exclusive,
  strictly greater), non-overlapping among `active` versions per type —
  multiple disjoint active versions incl. future-effective are permitted;
  the active-as-of-date predicate is normative (SCH-32/OPS-ACT-02);
  (h) succession closes the predecessor's WINDOW, never its status — a
  version that governed a period stays `active` for its historical
  window forever and instance references stay valid; `superseded`/
  `deprecated` are only for versions that never governed; (i) statutory
  classification is the server-controlled SCH-10 `governance_class`
  (`statutory`/`non_statutory`, no default) — firm overrides of a
  statutory system type inherit it and can never downgrade; approval
  requirement derives from the parent type, never caller input; (j)
  system-default activation is a deferred controlled operator path
  (Layer C, OPS-ACT-01) — the browser activation command is firm-owned
  only and rejects NULL-`firm_id` versions (fail-closed).
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
  RLS-CCP-01, RLS-CIN-01; AUTO-REC-03 layer 3 only (database uniqueness —
  schema-side duplicate protection; layers 1/2/4 are IMP-050), AUTO-REC-07
  (provenance contract, consumer-side); uniqueness incl. NULLS NOT DISTINCT
  behavior.
- **TEST-* IDs:** TEST-SCH-04 (scope invariants), TEST-SCH-05 (instance
  uniqueness NULLS NOT DISTINCT), TEST-SCH-08 (instance provenance +
  immutability), TEST-SCH-09 (lifecycle/check constraints), TEST-SCH-12
  (client_id trigger-maintenance), TEST-SCH-13 (four-eyes transition
  authorization), TEST-SCH-14 (rule-version pinning stability);
  TEST-RLS-GEN-01…04, TEST-RLS-MAT-01…03; TEST-API-01…10 as applicable to
  API-R0-CCP/API-R0-CIN; TEST-AUD-01/03/07/08/09; TEST-MIG-06/07.
  (TEST-SCH-06/07/10/11 are SCH-32 invariants owned/shipped by IMP-030 —
  regression only.)
- **Dependencies:** IMP-030.
- **Allowed scope:** migrations, policies, adapter CRUD for profiles and
  manual instances; status transitions per DM-SM-*; profile approval
  command (no instance materialization side effect); transition RPC with
  the RLS-CIN-01 authorization matrix; NO domain-event publication
  mechanism (AUTO-OQ-02 deferred to IMP-050).
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
- **Open/provisional dependency:** none blocking. Seeds use
  `generation_source='manual'`/`'import'` only (never `'recurrence'` —
  the generator is IMP-050; `10` Phase C). MIG-OQ-04 (back-materialization
  depth) is NOT a build blocker for IMP-031 — it constrains production
  onboarding materialization depth only; no depth is encoded.

### PHASE R0-E — Work Management

---

**IMP-040 — Tasks, dependencies, checklists, comments**

- **Purpose:** `tasks`, `task_dependencies`, `task_checklist_items`,
  `task_comments` (SCH-13…16): instance-linked and ad-hoc tasks (DEC-H,
  nullable `compliance_instance_id`), dependency acyclicity, immutable
  comments with retraction, explicit next-action fields for My Work.
- **Requirement IDs:** DM-12…14, DM-SM-* (task lifecycle), SCH-13…16,
  RLS-TSK-01, RLS-TCM-01; DEC-H.
- **TEST-* IDs:** TEST-SCH-01 (dependency acyclicity, SCH-14 — IMP-040
  supplies the implementation coverage), TEST-SCH-02 (shared composite
  same-firm FK rejection — IMP-040 adds task/task_dependency cases,
  earlier coverage remains regression); dedicated IMP-040 invariants:
  TEST-SCH-15 (subject binding), TEST-SCH-16 (mandatory lifecycle
  fields), TEST-SCH-17 (task four-eyes reviewer authorization),
  TEST-SCH-18 (self-edge), TEST-SCH-19 (duplicate pair), TEST-SCH-20
  (cycle race); TEST-RLS-*, TEST-API-* (API-R0-TSK contract).
  TEST-E2E-07 is owned downstream by IMP-042 (see `11`); IMP-040 carries
  no UI scope.
- **Dependencies:** IMP-031 (tasks may link instances), IMP-013.
- **Allowed scope:** migrations, policies, adapter functions, audit
  capture for task lifecycle/assignment/completion (mutation + audit
  only — publication of task.created/assigned/completed is deferred to
  the AUTO-OQ-02 mechanism, IMP-050; see `09`).
- **Non-goals:** workload recommendation intelligence (DEC-L deferral);
  My Work *surface* wiring is IMP-042; no domain-event infrastructure
  (no outbox/bus/webhook/queue); no Task/My Work UI (TEST-E2E-07 lands
  downstream at IMP-042).
- **Expected files/areas:** `supabase/migrations/`, `src/data/`.
- **Entry criteria:** R0-D green.
- **Acceptance criteria:** circular dependencies rejected; cross-firm task
  access denied; comment immutability enforced.
- **Verification:** CI-equivalent + TEST-SCH/RLS/API (TEST-E2E-07
  downstream at IMP-042).
- **Exit criteria:** task subsystem green.
- **Human approval:** no (RLS pattern established; diff review required).
- **Git checkpoint:** `feat: tasks and dependencies`.
- **Rollback concern:** standard.
- **Open/provisional dependency:** none.

---

**IMP-041 — Review queue**

- **Purpose:** `review_items` (SCH-17) with the review lifecycle
  (pending → approved/returned/escalated/dismissed, DM-SM-06), four-eyes
  support, and review history.
- **Requirement IDs:** DM-15, DM-SM-06, SCH-17, SCH-10
  (`four_eyes_required` flag on compliance_types, `06`), RLS-RVW-01,
  RLS-4EY-04.
- **TEST-* IDs:** TEST-RLS-RVW-01…16, TEST-SCH-21…25, TEST-API-11…15,
  TEST-AUD-03, TEST-AUD-12, TEST-E2E-08.
- **Dependencies:** IMP-040.
- **Allowed scope:** migrations, policies, controlled commands
  (`submit_review_item`, `decide_review_item`), adapter functions; wiring
  the existing Review Queue UI to `@/data`; `review.submitted` /
  `review.completed` event **contract names only** — no publication
  infrastructure (AUTO-OQ-02 remains with IMP-050, `09` IMP-041 partition
  note).
- **Non-goals:** AI-sourced items and any `ai_outputs` FK (SCH-27 deferred;
  R0 rows are human-sourced, `ai_output_id IS NULL`); automatic escalation
  routing (`escalated` is terminal, DM-SM-06); a review-history table
  (decision facts live on `review_items`; reviewer narrative via SCH-16
  task_comments; mutation history via audit_log); team/team-membership
  models (manager scope is portfolio/direct-task per RLS-RVW-01); My Work
  (IMP-042).
- **Expected files/areas:** `supabase/migrations/`, `src/data/`, existing
  Review Queue page wiring, `e2e/` (TEST-E2E-08).
- **Entry criteria:** IMP-040 green; API-OQ-01 vocabulary decision —
  **RESOLVED 2026-09-05** (R0 keys: `gst_reconciliation`, `tds_return`,
  `itr_computation`, `financial_statements`, `audit_workpaper`).
- **Acceptance criteria:** review submit/decision E2E green (TEST-E2E-08,
  owned here); returned items surface in My Work "Returned" (surface owned
  by IMP-042).
- **Verification:** CI-equivalent + TEST-E2E-08.
- **Exit criteria:** review queue functional with audit coverage.
- **Human approval:** no.
- **Git checkpoint:** `feat: review queue`.
- **Rollback concern:** standard.
- **Open/provisional dependency:** none for this package — API-OQ-01
  resolved 2026-09-05; AUTO-OQ-02 (event publication mechanism) remains
  downstream with IMP-050.

---

**IMP-042 — Alerts & My Work**

- **Purpose:** `alerts` and `alert_rules` (SCH-18/19) persistence + RLS;
  My Work surface (Today / This Week / Waiting / Returned / explicit next
  action, DEC-L) wired to live data.
- **Requirement IDs (erratum, human-ruled 2026-09-06: DM-16…18 are the
  deferred Release-1 document family — Document/DocumentVersion/
  DocumentRequest per DEC-T — and were a card citation error; corrected
  to the owning R0 entities):** DM-13, DM-21, DM-22, DM-25, SCH-18,
  SCH-19, RLS-ALR-01, RLS-ARL-01 (rule administration roles per
  RLS-OQ-03 resolution); DEC-L.
- **TEST-* IDs:** TEST-RLS-ALR-*, TEST-RLS-ARL-*, TEST-SCH-* (next
  family, SCH-18/19), TEST-API-16…19 (newly allocated at contract
  reconciliation 2026-09-06, `11`), TEST-AUD-02 (alert_rules portion),
  TEST-AUD-03 (alert manual-transition portion; the auto-resolution
  clause is exercisable only with the IMP-051 evaluator), TEST-E2E-07
  (task assignment + update — downstream UI acceptance; backend behavior
  delivered by IMP-040), TEST-E2E-09.
- **Dependencies:** IMP-040, IMP-041; alert *generation* lands in IMP-051
  — this package ships persistence, ack/resolve, and the My Work surface.
- **Allowed scope:** migrations, policies, adapter, My Work page wiring
  (D1 ruling 2026-09-06: the existing `/alerts` page is NOT wired in
  this package; its ModuleGate is unchanged — alert ack/snooze/resolve
  acceptance is proven through the provider-neutral adapter plus
  RLS/API/integration/audit verification).
- **Non-goals:** alert-rule authoring UI beyond read/admin basics;
  workload recommendations; reminder delivery; alert
  generation/evaluation/dedupe/auto-resolution and any scheduler
  (IMP-051); domain-event publication (`alert.created`/`alert.resolved`
  — IMP-050 / AUTO-OQ-02); alert-rule seed rows or thresholds (D3 ruling
  2026-09-06 — AUTO-OQ-04 stays open); postgres_changes for the alert
  badge/list surface (D2 ruling 2026-09-06 — the API-RT-07 sanctioned
  polling fallback is used: subscription interface → bare invalidation →
  authoritative RLS re-read; the interval is an implementation
  parameter, not a product SLA).
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
- **Contract reconciliation (human-ruled 2026-09-06):** My Work bucket
  semantics are normative in DEC-L (`01`); the alert manual transition
  matrix and snooze-expiry read derivation are normative in SCH-18
  (`06`); command/read behavior is normative in API-R0-ALR / API-R0-MWK
  (`07`); the My Work read architecture is least-privilege — plain
  RLS-protected task/review reads composed behind `@/data`, NO aggregate
  SECURITY DEFINER RPC (any newly discovered authoritative requirement
  for one STOPs for human ruling).
- **Open/provisional dependency:** AUTO-OQ-04 (which rules ship enabled
  by default) affects seed config, not this schema.

### PHASE R0-F — Automation & Deadlines

---

**IMP-050 — Recurrence generation & scheduler signals**

- **Purpose:** Implement ComplianceProfile → active rule version →
  ComplianceInstance generation: deterministic recurrence identity,
  four-layer duplicate protection, provenance stamping, scheduler-signal
  processing (`sched.*` signals are not domain events, AUTO-PRIN-05).
- **Requirement IDs:** AUTO-PRIN-01…05, AUTO-REC-01…10, AUTO-SCH-01/02/03,
  AUTO-IDM-01, AUTO-FLOW-01…05, AUTO-RPL-01/02, AUTO-EVT-01/02,
  AUTO-AUD-01/02, AUTO-OBS-01; SCH-01 settings carrier, SCH-12 provenance,
  SCH-32, SCH-33/34/35.
- **TEST-* IDs:** TEST-AUTO-01…12 (incl. concurrent-generator race,
  historical stability, event/signal separation, correlation propagation).
- **Dependencies:** IMP-031, IMP-013; **AUTO-OQ-01/02 — RESOLVED by human
  ruling 2026-09-11** (final scheduler mechanism: pg_cron invoking hardened
  in-database scheduler/job functions, pg_net not required for R0; final
  event-publication mechanism: transactional outbox — recorded in `09`;
  schema contracts SCH-33/34/35 recorded in `06`; validation evidence
  AUTO-SCH-02 LOCAL/HOSTED/OVERALL PASS).
- **Allowed scope:** generator function(s), scheduler wiring per the
  validated mechanism (pg_cron + hardened in-database functions,
  AUTO-SCH-01 final), transactional outbox publication (SCH-33),
  idempotency/retry/dead-letter handling (SCH-34/35). Cron registration
  ownership (Ruling 2026-09-12, AUTO-SCH-04): this package registers
  exactly `sched.recurrence.evaluate` (once daily 00:30 Asia/Kolkata —
  cron expression `0 19 * * *` interpreted in GMT under the fail-closed
  `cron.timezone='GMT'` precondition, AUTO-SCH-05/07) and ONE
  infrastructure outbox-drain job (once per minute;
  stable named, idempotent/re-runnable pg_cron registration).
- **Non-goals:** reminder *delivery* (AUTO-RMD-01 produces reminder-ready
  events only); no activation of statutory rules; no registration of
  `sched.alerts.evaluate` (owned by IMP-051) or `sched.login_mirror.run`
  (retains its existing deferred ownership/binding); the outbox drain is
  operational infrastructure — never a fourth `sched.*` scheduler signal
  (AUTO-SCH-04).
- **Expected files/areas:** `supabase/` (functions, cron config),
  automation worker area.
- **Entry criteria:** R0-D green; AUTO-OQ-01/02 resolved with results
  recorded in `09` (amendment) — **SATISFIED 2026-09-11** (human rulings
  recorded in `09`; schema contracts SCH-33/34/35 in `06`; AUTO-SCH-02
  PASS). The IMP-050 architecture amendment diff is APPROVED (human
  review PASSED 2026-09-12). **Contract closure 2026-09-12 (human
  rulings, recorded normatively in `09`):** cron registration ownership
  partition (AUTO-SCH-04), cadences (AUTO-SCH-05 — recurrence daily 00:30
  Asia/Kolkata; infrastructure outbox drain every minute), the pg_cron
  installation/migration boundary (AUTO-SCH-06 — the IMP-050 migration
  MAY carry `CREATE EXTENSION IF NOT EXISTS pg_cron` for a deterministic
  local reset/build; hosted execution stays human-gated), and the
  TEST-AUTO-05/06 harness-only strategy are closed; no cadence or
  cron-ownership open question remains. **Contract-closure review
  corrections (human rulings 2026-09-12) are recorded:** R5 — cron
  representation `0 19 * * *` GMT with the fail-closed
  `cron.timezone='GMT'` registration/acceptance precondition
  (AUTO-SCH-05/07; CAOS never mutates `cron.timezone`); R6 — the hosted
  pg_cron state change enters ONLY through the version-controlled IMP-050
  migration ledger (AUTO-SCH-06; Dashboard-only or manual out-of-chain
  enablement prohibited); R7 — SCH-12 `successor_instance_id` composite
  same-firm self-FK contract (`06`; generator enforces successor/cycle
  semantics; never RLS); R8 — post-IMP-050 catalog targets (24 tables,
  RLS 24/24, FORCE RLS 20, policies 51). **Final independent
  contract-closure re-review (2026-09-12): PASS — findings NONE; the
  IMP-050 implementation contract / contract closure is HUMAN APPROVED
  2026-09-12.** Remaining gate before
  implementation: the
  explicit IMP-050 implementation instruction, then hosted pg_cron
  `CREATE EXTENSION` by an authorized human (explicit state-change gate —
  availability proven, installation not yet authorized; executed only via
  the version-controlled migration per R6).
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
- **Open/provisional dependency:** none remaining at this gate — AUTO-OQ-01
  and AUTO-OQ-02 are RESOLVED (human ruling 2026-09-11, recorded in `09`);
  AUTO-OQ-03 is RESOLVED and set here as config: 90-calendar-day
  configurable default look-ahead (carrier
  `firms.settings.recurrence_lookahead_days`, SCH-01 — default 90 when
  absent/null), Asia/Kolkata business-date basis,
  UTC-persisted timestamps (AUTO-REC-02/AUTO-REC-10). Schedule cadence and
  cron registration ownership are likewise CLOSED (Ruling 2026-09-12:
  AUTO-SCH-04/05/06/07, recorded in `09`). The binding
  scheduler security constraint is AUTO-SCH-03 (BYPASSRLS cron identity —
  explicit tenant enforcement; no anon/authenticated scheduler
  capability).

---

**IMP-051 — Deadline materialization & alert evaluation**

- **Purpose:** Deadline views/materialization from instances + tasks;
  alert evaluation against alert_rules with dedupe, audit-logged
  auto-resolution, and manual acknowledgement.
- **Requirement IDs:** AUTO-DLN-01, AUTO-ALR-01…03, AUTO-RET-01/02,
  AUTO-RPL-01 (replay considerations). **(Erratum, human ruling HRR-01=A
  2026-09-14: the former trailing citation "DM-17/18" is removed —
  DM-17/18 are the deferred Release-1 DocumentVersion/DocumentRequest
  family (DEC-T exclusion) and were never IMP-051 scope; same correction
  class as the human-ruled IMP-042 card erratum of 2026-09-06.)**
- **TEST-* IDs:** TEST-AUTO-02/04/06/08 (shared canonical automation
  IDs — human ruling HRR-04=A 2026-09-15: the existing shared TEST-AUTO
  IDs are kept; IMP-051 updates/extends the existing automation suites
  in place and creates NO replacement IDs for already-canonical shared
  obligations; canonical TEST-AUTO-04 remains alert dedupe +
  auto-resolution audit; post-IMP051 the TEST-AUTO-08 oracle expects
  `sched.alerts.evaluate` present at cadence `30 19 * * *` while
  `sched.login_mirror.run` remains absent under current ownership),
  TEST-AUTO-13/14/15 (new sequential IDs for genuinely new IMP-051
  behavior — human ruling HRR-05=A 2026-09-15; allocated and defined in
  `11`), TEST-API-20 (canonical API-R0-DLN deadline read-model
  contract binding, allocated in `11`; human ruling HRR-10=A
  2026-09-14). Canonical TEST-AUTO-04 is alert dedupe + audit-logged
  auto-resolution (`11`; HRR-08=A 2026-09-14 — the IMP-050 recurrence
  suite's use of that label was a mislabel, corrected label-only with no
  execution/assertion change).
- **Dependencies:** IMP-050, IMP-042.
- **Allowed scope:** evaluation functions, deadline read paths, alert
  lifecycle wiring; the `sched.alerts.evaluate` pg_cron registration is
  owned by THIS package (Ruling 2026-09-12 cron-ownership partition,
  AUTO-SCH-04 — IMP-050 does not register it). **Cadence (human ruling
  HRR-02=A 2026-09-14, reviewer-validated CADENCE_VALID=YES): the
  registration uses the expression `30 19 * * *` interpreted in GMT =
  once daily 01:00 Asia/Kolkata (fixed UTC+05:30); recorded in `09`
  (signal table + AUTO-SCH-05). **Registration precondition and
  operational semantics are likewise RESOLVED (human rulings 2026-09-15,
  recorded in `09`):** the AUTO-SCH-07 fail-closed GMT precondition
  applies to this registration (HRR-03=A — register only when
  `current_setting('cron.timezone', true) = 'GMT'`; otherwise do not
  register, never mutate `cron.timezone`, fail closed to explicit human
  review; hosted registration remains through the version-controlled
  migration path; cron expression interpretation, the `cron.timezone`
  operating convention, and Asia/Kolkata business-date semantics remain
  distinct concerns); catch-up / missed-run semantics are governed by
  HRR-11=A and concurrency / re-entry semantics by HRR-12=A.**
  Deadline materialization is a derived read model over
  `compliance_instances(due_date, state)` (AUTO-DLN-01) — no persisted
  deadline rows; the evaluator is pull-based over live state
  (AUTO-FLOW-05), not an outbox consumer. No UI page wiring: the
  `/alerts` ModuleGate is unchanged (D1 ruling) and deadlines/Command
  Centre live UI is IMP-060 (TEST-E2E-10).
- **Non-goals:** reminder delivery; alert-rule seed rows, default
  thresholds, or default-enabled rules (human ruling HRR-07=A
  2026-09-14 — the D3 no-seed ruling governs IMP-051: ZERO alert-rule
  seeds; AUTO-OQ-04 remains OPEN; the evaluator must remain compatible
  with zero enabled alert rules; practicing-CA/compliance-domain
  validation remains separately required before any statutory
  activation); new alert-rule families.
- **Expected files/areas:** `supabase/`, `src/data/`.
- **Entry criteria:** IMP-050 green.
- **Acceptance criteria:** deadlines correct across period boundaries;
  alert dedupe proven; auto-resolution audit-logged; manual ack respected.
- **Verification:** CI-equivalent + TEST-AUTO-*.
- **Exit criteria:** deadlines and alerts live end-to-end.
- **Human approval:** no (mechanism approved at IMP-050).
- **Git checkpoint:** `feat: deadlines and alert evaluation`.
- **Rollback concern:** evaluation re-runnable idempotently.
- **Open/provisional dependency:** AUTO-OQ-04 (default rule set) — OPEN;
  product input needed before any seed enablement (no seeds authorized).
  **Pre-implementation rulings RESOLVED (human rulings 2026-09-15, all
  Option A; recorded normatively here and in `06`/`09`/`11`):** HRR-03=A
  (the AUTO-SCH-07 fail-closed GMT precondition applies to
  `sched.alerts.evaluate` — registration requires
  `current_setting('cron.timezone', true) = 'GMT'`; otherwise do not
  register, never mutate `cron.timezone`, fail closed to explicit human
  review; hosted registration remains through the version-controlled
  migration path); HRR-04=A (shared canonical TEST-AUTO IDs kept;
  IMP-051 updates/extends the existing automation suites in place);
  HRR-05=A (TEST-AUTO-13/14/15 allocated for the evaluator
  alert-creation race, alert retrigger / new occurrence, and persisted
  snooze-expiry normalization — defined in `11`); HRR-06=A (AUTO-ALR-02
  dedupe structurally enforced — at most one non-resolved alert per the
  approved dedupe identity via a database-level uniqueness mechanism
  over non-resolved states; creation races converge safely;
  check-then-insert alone insufficient; invariant recorded in `06`
  SCH-18); HRR-09=A (resolved alerts are terminal historical
  occurrences; a later recurrence creates a NEW alert occurrence with
  fresh lifecycle state — no reopen, no permanent suppression);
  HRR-11=A (catch-up / missed-run semantics — no historical
  replay/backfill; missed executions recover through safe re-fire over
  current live state; SCH-34 job-run evidence provides observability);
  HRR-12=A (concurrency / re-entry semantics — structural
  business-effect dedupe is the correctness layer; overlapping runs
  converge safely; no mandatory job-level advisory lock). **ALL
  pre-implementation human decisions for IMP-051 are now RESOLVED and
  recorded; the IMP-051 package contract remains HUMAN-APPROVED.
  Implementation remains NOT AUTHORIZED — it begins only with an
  explicit implementation instruction; this reconciliation edits
  contract text only and does NOT authorize implementation, Git
  checkpoint, or push.**

### PHASE R0-G — Application Read Models

---

**IMP-060 — Command Centre & Morning Brief live data**

- **Purpose:** Aggregate read models behind `07` contracts: Command
  Centre sections and Morning Brief from live data, with tenant-scoped
  aggregation that never bypasses RLS.
- **Requirement IDs:** API-SEC-01…04 (aggregate RPC security),
  API-CONV-*, API-RT-01/02 (realtime rules context — Command Centre
  itself is API-RT-02: refetch-on-mutate / refetch-on-focus, no
  realtime); API-OQ-02 (RESOLVED for the IMP-060 surfaces 2026-09-19,
  recorded below); API-OQ-03 (composite RPC vs per-section views —
  RESOLVED 2026-09-19 = human-approved B-count, decided by measurement
  here; recorded below and normatively in `07` API-R0-DASH).
- **TEST-* IDs:** TEST-API-04 (aggregate/dashboard caller-scoped per
  role — portfolio slices for manager, assigned slices for senior; the
  revenue-aggregates clause binds only where applicable: R0 has no
  billing data source for the deferred live tile, H5), TEST-API-05 (no
  browser service-role), TEST-API-06 (SECURITY DEFINER/cross-tenant
  security — if the implementation uses no definer function,
  evidence-by-absence/invoker semantics may satisfy the relevant part),
  TEST-API-07 (pagination/filter/sort for applicable list/read
  contracts), TEST-API-08 (conflict/idempotency regression coverage —
  IMP-060's new read-model work is read-only), TEST-E2E-10 (deadlines +
  Command Centre render live data); the API-R0-DLN deadline surfaces
  remain bound to TEST-API-20 (`11`, IMP-051).
- **Dependencies:** IMP-051.
- **Allowed scope:** RLS-respecting read-model reads composed behind
  `@/data` (per-section exact-count PostgREST reads per the B-count
  ruling; a view enters only if an API-A-01 read gap escalates), page
  wiring.
- **Non-goals:** new metrics beyond approved contracts; cross-tenant
  aggregation of any kind; the deferred scope itemized in the
  pre-implementation rulings block below (invented Morning Brief
  attention-total formula, synthetic On-Track formula, Team Overload
  live metric, billing/revenue live tile without an approved R0 source,
  AI/composite Attention List, standalone `/dependency` page unless
  separately approved, production/statutory-rule activation, IMP-061
  work).
- **Expected files/areas:** `supabase/` (views/RPC), `src/data/`,
  `src/pages/` (Command Centre, Morning Brief).
- **Entry criteria:** R0-F green.
- **Acceptance criteria:** aggregates match row-level truth under Firm A/B
  isolation tests; performance measured on representative volume
  (API-OQ-03 measured 2026-09-18 on the local representative-volume
  benchmark — decision recorded below; hosted-network behavior must
  still be validated at hosted staging acceptance — local loopback
  latency does not guarantee hosted latency).
- **Verification:** CI-equivalent + TEST-API-* + TEST-E2E-10.
- **Exit criteria:** both surfaces live with correct isolation.
- **Human approval:** no plan-level security re-approval (aggregate
  security pattern reviewed via tests) — but per the 2026-09-19
  pre-implementation recording below, implementation begins only after
  fresh independent review of this package contract plus explicit human
  package-contract approval and an explicit implementation instruction.
- **Git checkpoint:** `feat: command centre and morning brief live`.
- **Rollback concern:** read-only; safe.
- **Open/provisional dependency:** ~~API-OQ-03~~ (RESOLVED 2026-09-19 —
  human-approved B-count; recorded below and normatively in `07`
  API-R0-DASH / the API-OQ matrix).

**IMP-060 pre-implementation package contract — human-approved rulings
RECORDED (rulings H1…H8 already human-approved; API-OQ-02 surface ruling
and API-OQ-03 = B-count decision human-approved; recording 2026-09-19 —
documentation-only, no implementation authorized).** Dependency:
IMP-051 = COMPLETE/CLOSED (live deadline read-model foundation).

- **Canonical boundary (unchanged, no redesign):** React → `@/data` →
  Supabase/PostgREST (or a narrowly justified server/RPC path). No
  direct Supabase calls from React components (API-ARCH-01/02); fixture
  and Supabase adapters expose the same interface; no browser
  service-role key (API-SEC-02); ordinary RLS-respecting PostgREST is
  used where sufficient (API-ARCH-03); SECURITY DEFINER remains
  exceptional and may never widen tenant visibility (API-SEC-03);
  Command Centre itself is API-RT-02 — NO realtime — with freshness
  through the approved refetch-on-mutate / refetch-on-focus behavior;
  no cross-tenant aggregation; no new metrics beyond the approved
  contracts.
- **API-R0-DASH approved live set:** task counts by state; deadline
  risk; review pending; active alerts — replacing the relevant
  fixture/`useLiveAggregates` usage. No additional aggregate metrics
  are introduced.
- **H1 — Compliance Health:** live Compliance Health uses
  `compliance_instances` state truth. The fixture task-category
  semantics are NOT preserved as the live compliance-health definition;
  task-state counts remain separately permitted as part of API-R0-DASH.
- **H2 — Morning Brief "items needing attention today":** no composite
  definition is invented; the hard-coded fixture value (e.g. 17) is
  deferred/removed in live mode until a separate approved definition
  exists.
- **H3 — Critical / At-Risk / On-Track fixture semantics:** fabricated
  fixture semantics are NOT preserved and no new On-Track formula is
  invented; live mode exposes only directly named approved counters —
  at-risk deadlines, pending reviews, active alerts. NO synthetic
  "On Track" metric.
- **H4 — Team Overload:** DEFERRED for live mode; no new
  workload-analytics contract is introduced in IMP-060.
- **H5 — Billing / Revenue tile:** DEFERRED for live mode; no R0
  billing data source exists; no fabricated currency, invoice, billing,
  or revenue values. (The `07`/TEST-API-04 "revenue aggregates
  partner/admin only" clause binds only where applicable — if an
  approved billing source ever exists; IMP-060 ships no live
  billing/revenue tile.)
- **H6 — AI/composite Attention List:** DEFERRED; no hidden
  prioritization, ranking, weighting, or composition algorithm is
  introduced.
- **H7 — Deadline/dependency scope:** IMP-060 includes the live
  Deadline Board, deadline group drill-down, client drill-down, the
  Command Centre deadline card, and the Command Centre dependency card,
  built on the IMP-051 live deadline/read-model foundation
  (API-R0-DLN). A dedicated standalone `/dependency` page remains
  DEFERRED unless a later authoritative scope decision explicitly adds
  it.
- **H8 — API-OQ-03 measurement basis:** API-OQ-03 was resolved only
  after a local representative-volume benchmark (evidence under
  `scripts/spikes/api-oq-03/` — decision evidence only, NOT a normative
  production harness): 2 firms; per firm approximately 200 clients,
  5,000 compliance instances, 10,000 tasks, 1,000 review items, 500
  alerts; roles partner, manager, senior, billing. Candidates compared:
  (A) composite SECURITY INVOKER RPC; (B-fetch) per-section row-fetch
  approach; (B-count) per-section exact-count approach with limited row
  fetches where a derivation requires rows.
- **API-OQ-02 ruling (recorded):** scalar aggregate counts do NOT
  require special pagination; existing list contracts retain their
  already-approved pagination behavior; any genuinely new paginated
  list introduced later uses the API-CONV-02 default 50 / maximum 200
  unless superseded by a later explicit ruling.
- **API-OQ-03 RESOLVED = B-COUNT (human-approved):** the normative
  aggregate architecture is RLS-respecting per-section exact-count
  reads for the scalar aggregates, with limited row fetches only where
  required by an approved derivation. B-fetch is NOT the aggregate
  implementation; the composite-RPC candidate was NOT selected.
  **B-count production contract:** every count executes under the
  signed-in caller's RLS context (API-SEC-01); the `x-active-firm` /
  existing active-firm selector contract applies unchanged (context
  selection, never authorization, RLS-CTX-01/02); no service-role
  credentials in the browser (API-SEC-02); tenant visibility is never
  widened; scalar counts are obtained without fetching entire source
  datasets; limited row fetches occur only where the approved
  derivation genuinely requires row-level fields. The exact request
  count observed in the benchmark (22 per composition) is composition
  evidence, NOT a normative constant — it may change if approved
  read-model contracts evolve while preserving semantics.
  **Active-alert derivation:** unchanged from the approved IMP-042 /
  IMP-051 semantics and tests — an exact count of directly active
  persisted alerts, combined where required with a limited fetch of
  snoozed rows whose row data determines whether they are effectively
  active (the TEST-API-18 read derivation); no new alert lifecycle
  formula is invented.
- **Benchmark evidence (factual decision rationale; LOCAL loopback
  Supabase):** all three candidates passed the three-way
  semantic/security validation; 60 recorded runs per candidate per
  role; 10 warmups; 0 measurement failures/timeouts. Measured p50 ms —
  Candidate A: partner 194.62, manager 602.30, senior 652.15, billing
  397.56; Candidate B-fetch: partner 534.87, manager 772.20, senior
  685.65, billing 209.28; Candidate B-count: partner 104.54, manager
  195.26, senior 216.71, billing 133.73. Round trips per composition —
  A: 1; B-fetch: role-dependent, 5–21 in the benchmark; B-count: 22 in
  the benchmark composition. Representative payload bytes — A: ≈487–542;
  B-fetch: 10–461,635 depending on role; B-count: 44–9,391 depending on
  role. **Limitation:** these measurements were taken against local
  loopback Supabase; hosted-network behavior must still be validated
  during hosted staging acceptance — local latency does not guarantee
  hosted latency.
- **Security evidence (all three candidate shapes):** role-scoped
  correctness; Firm A → Firm B isolation; Firm B → Firm A isolation;
  valid Firm B own-context access; suspended-membership denial;
  removed-membership denial. Candidate A was explicitly SECURITY
  INVOKER; no service-role path was used for any measured candidate
  call; the chosen B-count architecture remains ordinary caller-RLS
  scoped.
- **Test mapping:** TEST-API-04…08, TEST-E2E-10 as itemized in the
  TEST-* IDs bullet above; API-SEC-*/API-CONV-*/API-RT requirements
  remain binding; Command Centre itself is API-RT-02 (no realtime).
- **Harness non-promotion:** the benchmark harness is temporary
  decision evidence only — its synthetic UUIDs, local setup/teardown,
  exact dataset sizes, the benchmark-only Candidate A function name,
  spike result JSON paths, temporary LOW findings, and local-only
  cleanup mechanics are NOT normative production requirements.
- **Expected implementation areas (identified only — NOT created or
  edited by this recording):** `src/data/**` (read-model data
  adapters), `src/pages/**` (Command Centre, Morning Brief), and
  read-model/data-adapter integration; a `supabase/` view enters only
  if an implementation-discovered read gap escalates per API-A-01.
- **ALL pre-implementation human decisions for IMP-060 are now
  RESOLVED and recorded; the IMP-060 package contract records the
  human-approved H1–H8 rulings and the API-OQ-02 / API-OQ-03
  resolutions. IMP-060 MAIN IMPLEMENTATION remains NOT AUTHORIZED — it
  begins only after fresh independent review of this package contract
  plus explicit human package-contract approval, followed by an
  explicit implementation instruction; this recording edits contract
  text only and does NOT authorize implementation, Git checkpoint, or
  push.**

---

**IMP-061 — Structured global search**

- **Status (2026-09-20):** CONTRACT PHASE (2026-09-19) — contract
  discovery PASS; preliminary rulings finalized; local spike PASS; fresh
  independent spike review PASS (CRITICAL=0, HIGH=0, MEDIUM=2 — both
  resolved into this contract; LOW=4 historical spike-quality
  observations, none a production vulnerability); final human rulings
  IMP061-R1…R10 + IMP061-M1 APPROVED 2026-09-19 and recorded normatively
  here and in `07` API-R0-SRC / `11` (TEST-API-21…24, TEST-E2E-13).
  **Explicit human IMPLEMENTATION AUTHORIZATION was subsequently GRANTED;
  primary implementation discovery then STOPPED cleanly before any code —
  route/destination discovery found no truthful existing destination for
  the `staff` search kind and no fully role-truthful destination for
  `task` / `compliance_instance` (bounded blocker report; the repository
  remained completely clean). Final human ruling IMP061-R11 = R11-A
  (OPTIONAL TRUTHFUL NAVIGATION) APPROVED 2026-09-20 and recorded
  normatively here and in `07` API-R0-SRC / `11` (TEST-API-21,
  TEST-E2E-13). IMPLEMENTATION EXECUTION IS PAUSED pending (1) this R11
  contract reconciliation, (2) a fresh independent R11 contract-amendment
  review, and (3) an amendment Git checkpoint. No implementation source,
  migration, or test/harness implementation exists; no hosted/production
  change has been made.**
- **Purpose:** server-side structured global search under the caller's
  firm/role visibility (`07` API-R0-SRC), wired into the existing ⌘K
  Command Palette.
- **Requirement IDs:** `07` API-R0-SRC (expanded at this reconciliation);
  API-SEC-01…04; API-ERR-01/02; API-CONV-01/05; API-ARCH-01/02; RLS
  visibility inheritance (RLS-CTX-01/02, RLS-MECH-01, RLS-TEN-02,
  RLS-STF-03/04, RLS-CIN-01, RLS-CTY-01, RLS-MEM-01/RLS-PRF-01);
  AUD-SEC-01/02 (query-material redaction).
- **TEST-* IDs:** TEST-API-21 (shape / six-domain behavior / caps /
  deterministic ordering / masked identifiers / offboarded status /
  truthful empty+error), TEST-API-22 (tenant isolation / no existence
  leakage), TEST-API-23 (input security & matching semantics),
  TEST-API-24 (role visibility matrix incl. M1-A period-label cases),
  TEST-E2E-13 (live Command Palette structured search) — allocated in `11`
  at this reconciliation; existing TEST-API-01…20 and TEST-E2E-01…12
  semantics preserved.
- **Dependencies:** IMP-060 (CLOSED 2026-09-19 — entry satisfied).
- **Approved scope (IMP061-R1 — final):** exactly six searchable domains
  — clients, legal entities, registrations, tasks, compliance instances,
  staff display names (ACTIVE `firm_memberships` of the selected active
  firm). This reconciles the former entity-set contradiction (the card
  listed tasks/instances but not staff; API-R0-SRC listed staff but not
  tasks/instances) — the final set is exactly these six.
- **Non-goals (IMP061-R2 — final; do not pull forward):** contacts, phone
  search, email search, document search, invoice search, client-portal
  search, semantic search, embeddings, RAG, pgvector; pagination in the
  Command Palette; any product ranking semantics beyond the approved
  ordering rules.
- **Matching (IMP061-R3 — final = R3-B HYBRID):** identifiers exact /
  prefix only (NO substring); textual names / operational labels
  case-insensitive substring with prefix ranked ahead of substring-only;
  literal input treatment with deterministic server-side escaping of `%`,
  `_`, backslash, quote/operator-looking and equivalent special
  characters; minimum live-data query length 2 (IMP061-R4 — final:
  empty/one-char input MUST NOT enumerate tenant data; page/navigation
  shortcuts may still appear, client-side).
- **Caps / ordering (IMP061-R5 — final):** max 5 per kind, max 20
  globally, server-side; no pagination; deterministic ordering —
  identifier exact before identifier prefix where applicable, textual
  prefix before substring-only, then a stable non-product technical
  tie-break on canonical key/id (an implementation determinism rule, not
  a relevance judgment). NO numerical future scaling threshold is
  established.
- **Architecture (IMP061-R8 — final = R8-B SECURITY INVOKER
  COMPOSITION):** React → `@/data` search service → ONE structured-search
  database function → ordinary caller RLS. SECURITY INVOKER (NOT SECURITY
  DEFINER); server-derived/revalidated active firm; no authorization from
  a caller-provided firm_id; active-firm roster pin for staff
  (IMP061-R6 — ACTIVE `firm_memberships` of the selected active firm);
  server-side min-length guard, caps, deterministic ordering, identifier
  masking (IMP061-R7 — display identifier type + last four only; the full
  value remains available only on the authorized destination surface),
  truthful offboarded status (IMP061-R10 — searchable if RLS-authorized,
  explicitly labeled Offboarded), literal wildcard/filter escaping;
  normal `authenticated` EXECUTE grant only as required; no browser
  service-role; no RLS bypass. Query privacy (IMP061-R9): application-owned
  telemetry / audit events / application error reporting MUST NOT persist
  raw search terms — redact/omit sensitive query material; no control is
  claimed over provider/platform infrastructure logs beyond the
  application contract.
- **Compliance-instance search (IMP061-M1 — final = M1-A):**
  senior/article search compliance instances only through fields already
  visible under their ordinary current RLS/read contract; NO new
  compliance-type-name projection is created for search; compliance type
  names a role cannot ordinarily read MUST NOT leak through search; the
  production composition MUST NOT use an INNER JOIN to
  `compliance_types` that removes otherwise-visible compliance instances
  — an RLS-safe structure (LEFT JOIN with NULL-safe matching/label
  shaping, or an equivalent branch structure) is contractually required so
  that period-label matching survives without `compliance_types`
  visibility, hidden type names are not leaked, and ordinary
  compliance-instance visibility is unchanged. Partner/manager type-name
  matching availability follows ordinary current RLS (not expanded to
  normalize results across roles); explicit per-role period-label tests
  required (TEST-API-24).
- **Navigation (IMP061-R11 — final = R11-A OPTIONAL TRUTHFUL NAVIGATION,
  human ruling 2026-09-20):** implementation discovery found no truthful
  current destination for `staff` (no staff/team/profile route exists) and
  no fully role-truthful destination for `task` (`/my-work` is
  caller-owned actionable work, not a general task-detail destination) or
  `compliance_instance` (`/compliance/:id` is ModuleGated in live mode;
  the parent Client 360 is not role-safe — senior/article may
  legitimately see an instance while lacking Client 360 visibility).
  R11-A makes the hit navigation destination OPTIONAL rather than
  removing searchable domains, fabricating destinations, adding new
  pages, or weakening role visibility. Final destination matrix:
  `client` → `/clients/:clientId`; `legal_entity` → the authorized
  parent Client 360 surface (`/clients/:clientId`); `registration` → the
  authorized parent Client 360 surface (`/clients/:clientId`) — a
  raw/full registration identifier never appears in any destination;
  `task` / `compliance_instance` / `staff` → NO destination in R0
  (searchable but non-navigable; the palette shows no false navigation
  affordance and click/Enter do not navigate — Command Palette behavior
  in `07` API-R0-SRC). R11 changes navigation only; R1…R10 and M1-A are
  unchanged.
- **Database consequence:** R3 requires NO new search index at the
  measured representative R0 scale (pg_trgm NOT required for IMP-061);
  R8 WILL require one version-controlled migration for the production
  SECURITY INVOKER structured-search function during implementation —
  that migration is NOT authorized now.
- **Benchmark record (factual; independently accepted conclusions
  only):** measured locally — fan-out topology: 8 requests in the
  measured topology, local p50 ≈ 94–96 ms; SECURITY INVOKER
  single-function topology: 1 request, local p50 ≈ 111–129 ms. Fan-out
  had the lower LOCAL loopback p50; the invoker was NOT proven faster
  locally; hosted performance was NOT measured and any hosted latency
  inversion is only a hypothesis — hosted performance must later be
  checked during hosted acceptance. NO hosted superiority is claimed for
  either approach; the R8-B choice rests on the approved combined
  security, contract-enforcement, topology, maintainability and evidence
  analysis — not a hosted-speed claim. Spike-review corrections
  incorporated: the benchmark artifact used an INNER JOIN despite the
  handback saying LEFT JOIN, so senior/article period-label matching
  could have disappeared (MEDIUM-1 → resolved by IMP061-M1 = M1-A:
  RLS-safe LEFT JOIN/equivalent + explicit per-role period-label tests);
  the claimed superuser pg_trgm planner counter-evidence was not retained
  in the reviewable artifacts and is NOT cited as verified evidence, and
  no numerical ("10x"-style) future threshold is recorded (MEDIUM-2). The
  LOW findings (raw latency samples not retained; report.md stub; setup
  comment said 9 profiles vs 8; the actual PostgREST embedded expansion
  lacked a captured query plan) are historical spike-quality observations,
  not production vulnerabilities.
- **pg_trgm / index record:** pg_trgm was absent before the spike;
  temporary pg_trgm/indexes were exercised locally; RLS-context query
  plans did NOT select the temporary trigram indexes at the
  representative measured scale; pg_trgm and the temporary indexes were
  cleaned up; pg_trgm is NOT required for IMP-061 at the measured R0
  scale; search indexing / pg_trgm is to be RE-EVALUATED at materially
  larger per-firm data volumes using fresh measurement — no numerical
  threshold is established.
- **Harness contract (future obligation — recorded in `11`; NO harness
  code edited at contract time):** per the standing repository convention
  (IMP-051 `deadlines-integration`, IMP-060 `dashboard-integration`),
  IMP-061 introduces a dedicated search integration phase
  (`tests/integration/search/`, executing TEST-API-21…24) wired into the
  standing Harness Gate during implementation; extending an existing
  domain phase was rejected — no existing phase owns a cross-domain
  search surface. `scripts/harness/gate.mjs` is NOT edited at contract
  time.
- **Expected files/areas (identified only — NOT created or edited by this
  recording):** `supabase/migrations/` (the R8 function —
  implementation-time only), `src/data/search/` (provider-neutral
  service, five-file convention), `src/components/CommandPalette` wiring,
  `tests/integration/search/`, Playwright TEST-E2E-13.
- **Entry criteria:** IMP-060 read models green (satisfied); fresh
  independent contract review PASS plus an explicit human implementation
  instruction (GRANTED); execution additionally gated on the R11 contract
  amendment — fresh independent R11 contract-amendment review PASS plus
  an amendment Git checkpoint.
- **Acceptance criteria:** Firm B user cannot surface Firm A records by
  id, name, or suggestion; result shaping per API-R0-SRC (caps,
  deterministic ordering, masked identifiers, Offboarded labelling);
  role-visibility matrix proven (TEST-API-24); input-security semantics
  proven (TEST-API-23); tenant isolation proven (TEST-API-22).
- **Verification:** CI-equivalent + TEST-API-21…24 + TEST-E2E-13 +
  Harness Gate with the search-integration phase.
- **Exit criteria:** search live with isolation proven.
- **Human approval:** no (the package carries no additional human-approval
  gate; this contract reconciliation itself does NOT authorize
  implementation).
- **Git checkpoint:** `feat: structured global search` (implementation-time
  only).
- **Rollback concern:** read-only; the function is additive.
- **Open/provisional dependency:** none — R3/R8/M1 are RESOLVED by the
  final human rulings recorded above.

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
| TEST-RLS-CRV-01…13 | IMP-030 |
| TEST-RLS-SUP-01 | IMP-012 (shape), IMP-072 (operations) |
| TEST-SCH-01…20 | IMP-010, IMP-020, IMP-030, IMP-031, IMP-040 (TEST-SCH-01 dependency-acyclicity implementation coverage and TEST-SCH-15…20 owned by IMP-040; TEST-SCH-02 shared — earlier package coverage remains regression; TEST-SCH-12/13/14 owned by IMP-031) |
| TEST-AUD-01…11 | IMP-013, extended per domain package |
| TEST-API-01…10 | IMP-014, IMP-022, IMP-031 (API-R0-CCP/API-R0-CIN contract tests), IMP-040 (API-R0-TSK contract tests), IMP-060, IMP-062 |
| TEST-API-21…24 | IMP-061 (allocated at the IMP-061 final contract reconciliation 2026-09-19) |
| TEST-AUTO-01…15 | IMP-050, IMP-051 |
| TEST-MIG-01…15 | IMP-003, IMP-014, IMP-070, IMP-071 |
| TEST-E2E-01…12 | IMP-001 (skeleton), flows land with their packages (TEST-E2E-07 owned by IMP-042); full pass at IMP-071 |
| TEST-E2E-13 | IMP-061 (allocated at the IMP-061 final contract reconciliation 2026-09-19) |
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
| API-OQ-01 (= SCH-OQ-02) | `07` | **Resolved 2026-09-05 — R0 vocabulary frozen (`gst_reconciliation`, `tds_return`, `itr_computation`, `financial_statements`, `audit_workpaper`; SCH-17 CHECK)** | No (resolved) | — (IMP-041 proceeds on the frozen vocabulary) | Resolved at IMP-041 contract closure (requester input) |
| API-OQ-02 | `07` | Open — convention fixed; **resolved for the IMP-060 read-model surfaces 2026-09-19 (scalar aggregate counts need no pagination; existing list contracts keep approved pagination; new paginated lists default 50 / max 200 per API-CONV-02)** | No | Per-surface pagination values only | During each surface's package |
| API-OQ-03 | `07` | **Resolved 2026-09-19 — human-approved B-count: RLS-respecting per-section exact-count reads for scalar aggregates, limited row fetches only where an approved derivation requires rows; measured on local representative volume (all three candidates passed semantic/security validation; B-fetch and the composite-RPC candidate NOT selected); hosted-network behavior validated at hosted staging acceptance** | No (resolved) | — (IMP-060 proceeds on B-count) | Resolved at IMP-060 pre-implementation package contract (human ruling + measurement evidence) |
| API-OQ-04 (= SCH-OQ-03) | `07` | Open | No | Re-invite persistence semantics (API separates the three operations already) | IMP-010/011 membership implementation |
| AUTO-OQ-01 (= DEC-OQ-02) | `09` | **Resolved 2026-09-11 — human ruling: pg_cron + hardened in-database scheduler/job functions final for R0; pg_net not required for R0; HTTP/Edge deferred to R1+ (AUTO-SCH-01; AUTO-SCH-02 PASS)** | No (resolved) | — (IMP-050 proceeds on the resolved mechanism) | Resolved at IMP-050 architecture gate (human ruling + validation evidence) |
| AUTO-OQ-02 | `09` | **Resolved 2026-09-11 — human ruling: transactional outbox final; direct invocation rejected for R0 (AUTO-FLOW-03; SCH-33/34/35 contracts in `06`)** | No (resolved) | — (IMP-050 proceeds on the resolved mechanism) | Resolved at IMP-050 architecture gate (human ruling) |
| AUTO-OQ-03 | `09` | **Resolved 2026-09-11 — human ruling: 90-calendar-day configurable default; Asia/Kolkata business-date basis; UTC-persisted timestamps (AUTO-REC-02/AUTO-REC-10)** | No (resolved) | — (value set as R0 config) | Resolved at IMP-050 architecture gate (human ruling) |
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
