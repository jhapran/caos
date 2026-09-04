# 10 — Fixture Migration & Seeding

- **Status:** Approved (Batch 4)
- **Approval status:** Approved (Batch 4). Closure amendment recorded: recurrence rule-versioning/provenance is specified in `06` (SCH-32, SCH-12) — AUTO-XREF-01 satisfied. Open/provisional items remain as recorded: MIG-OQ-02, MIG-OQ-04; DEC-P stays open.

## Purpose

Defines how the product moves from the fixture-only MVP to the
Supabase-backed production architecture: data-source switching, schema
migration ownership, fixture-to-production entity mapping, seed-data
categories, migration phases with explicit verification gates, validation,
rollback principles, and deployment sequencing. **No executable migration
SQL is produced in Phase 2.**

## Scope

- Migration principles and ordering.
- `DATA_SOURCE` switching, fixture-code isolation, and environment wiring.
- Fixture-mode preservation during and after migration.
- Fixture entity → production entity mapping (with transformations).
- Seed-data categories for local, staging, and production initialization.
- Per-phase entry/exit gates, verification test families, data-integrity
  checks, and rollback/recovery conditions.
- Rollback principles (forward-only production preference).
- Deployment sequencing and the production cutover gate.

## Non-goals

- No SQL, no migration files, no seed scripts (implementation phase).
- No provisioning or connection to Supabase (Phase 2 prohibition).
- No production statutory-rule activation — the Registration Scope Matrix
  (DM-27) is architecture-approved, but external practicing-CA /
  compliance-domain sign-off remains **mandatory before production
  statutory-rule activation** (not professional CA certification);
  enforced per rule version via SCH-32 `domain_approval_status`.
- No Netlify configuration changes in Phase 2 (deployment *design* only).
- No backup/PITR implementation detail (owned by `13`; provisional targets
  TEN-24).

## Migration principles

- **MIG-PRIN-01 — The `@/data` seam is preserved.** UI components keep
  consuming the domain-layer contract (`07`, API-ARCH-01); migration swaps
  the adapter behind the seam, never the UI's import path.
- **MIG-PRIN-02 — Fixture mode is a first-class parallel mode.** The
  polished demo remains usable throughout migration (TEN-20) as a
  demo/sales mode — and only that (TEN-21).
- **MIG-PRIN-03 — Production never silently falls back to fixtures.** If
  Supabase configuration is absent, invalid, or fails at runtime in a
  `supabase` environment, the application **fails closed** — a hard startup
  error or a surfaced runtime error. There is no automatic fixture
  fallback path, before or after errors (MIG-DS-06).
- **MIG-PRIN-04 — Schema changes travel as migration files in git**
  (TEN-16), applied via the Supabase CLI: local → staging → production.
  Hand-applied console changes are forbidden.
- **MIG-PRIN-05 — Forward-only production migrations.** Production fixes
  are new migrations, not edited history. Rollback strategy per
  MIG-RBK-*.
- **MIG-PRIN-06 — No real customer data in seeds.** Seeds are synthetic or
  fixture-derived only (TEN-12/13).
- **MIG-PRIN-07 — Pilot data is never a migration casualty.** If real
  customer/pilot data exists in any environment, migration proceeds by
  documented migration/backfill — **never by deleting pilot data**
  (MIG-PD-01).

## Data-source switching and fixture isolation

- **MIG-DS-01 — Per-environment `DATA_SOURCE`:**

  | Environment | DATA_SOURCE | Data |
  |---|---|---|
  | Dedicated demo/sales deployment | `fixture` | In-memory fixtures |
  | Local production-development | `supabase` | Supabase CLI local stack + dev seeds |
  | Staging | `supabase` | Staging project + synthetic staging seeds |
  | Production | `supabase` | Production project, real customer data |

- **MIG-DS-02 — Selection is explicit configuration** (environment
  variable injected per environment, TEN-19), read once at startup by the
  domain layer (API-ARCH-02). Client bundles only ever receive
  client-safe values (TEN-17); service-role credentials never reach a
  browser (TEN-18).
- **MIG-DS-03 — Fail-closed validation.** At startup the app validates
  that the selected mode's configuration is complete (fixture: nothing
  needed; supabase: URL + anon key present). A `supabase` mode missing
  configuration is a hard startup error, not a fallback (MIG-PRIN-03).
- **MIG-DS-04 — Demo clock pinned first.** Before any migration work
  begins, the fixture demo clock is pinned to a fixed date (TEN-22) —
  currently `DEMO_TODAY = new Date()` in `src/data/tasks.ts`, which makes
  fixture output non-reproducible. This is a prerequisite implementation
  task, not optional.
- **MIG-DS-05 — Unknown values fail closed.** An unrecognized or unset
  `DATA_SOURCE` is a hard startup error. There is no default mode and no
  implicit fixture fallback anywhere.
- **MIG-DS-06 — Fixture code isolation.** The fixture adapter and fixture
  constants are isolated behind the domain contract (API-ARCH-02) such
  that: (a) a production-configured build contains **no fixture module
  imports** (verified mechanically at Phase E, MIG-VFY-E); (b) the
  Supabase adapter never reads fixture records as production data; and
  (c) the adapter is chosen once at startup — a runtime Supabase error
  surfaces as an error and never triggers a mid-session switch to fixture
  mode. Demo mode remains fully supported — intentionally, in its own
  deployment.

## Migration phases and verification gates

Phases are dependency-ordered. **Advancement stops if any gate fails**;
a failed gate returns the phase to its entry state per the rollback/
recovery condition. Test families (TEST-MIG-*, TEST-RLS-*, TEST-AUTH-*,
TEST-AUD-*, TEST-AUTO-*) are defined in `11-testing-harness.md`.

### Phase A — Supabase foundation + auth

- **Scope:** Local CLI stack running; `firms`, `profiles`,
  `firm_memberships` schema; Supabase Auth wired (invite-only staff
  onboarding, MFA policy per `04`); DEC-J mechanism spike executed and
  recorded (RLS-MECH-02) — **substantial backend migration is blocked
  until the spike result is recorded** (`05`).
- **Entry criteria:** demo clock pinned (MIG-DS-04); harness skeleton
  exists (DEC-S); approved specs 02–08 current.
- **Exit criteria:** staff user authenticates against the local stack;
  membership rows exist; spike outcome recorded in `05`.
- **Verification:** TEST-AUTH-* (signup/login/MFA/session), TEST-RLS-MEM-*
  foundations, TEST-MIG-01 (clean-chain reproducibility on CLI stack).
- **Rollback/recovery:** local stack is disposable — reset and re-run the
  chain (MIG-RBK-02).
- **Data-integrity check:** membership uniqueness `(firm_id, user_id)`
  holds; composite-FK target `(firm_id, id)` present (SCH-03).

### Phase B — Core tenant/domain persistence

- **Scope:** Schema: `clients`, `legal_entities`, `client_relationships`,
  `registrations`, `contacts`, `engagements` (+ composite tenant FKs,
  SCH-FK-01/02); domain-layer adapters for API-R0-CLI/ENT/REG/CON/ENG.
- **Entry criteria:** Phase A exit criteria met; harness green.
- **Exit criteria:** Client 360 renders from the local stack behind the
  same `@/data` contract; fixture mode unaffected (demo still passes its
  checks).
- **Verification:** TEST-RLS-CLI/ENT/REG/CON/ENG-* families; TEST-MIG-02
  (adapter contract parity, MIG-VAL-03).
- **Rollback/recovery:** disposable environment reset; forward fix for
  anything persisted (MIG-RBK-01/02).
- **Data-integrity check:** orphan scan across composite FKs
  (MIG-VAL-01); identifier uniqueness `(firm_id, type, value)` on
  registrations (SCH-07).

### Phase C — Compliance, tasks, reviews

- **Scope:** Seed `compliance_types` system defaults **with their initial
  rule versions** (MIG-SEED-02; SCH-32); schema:
  `client_compliance_profiles`, `compliance_instances`,
  `compliance_rule_versions`, `tasks`, `task_dependencies`,
  `task_checklist_items`, `task_comments`, `review_items`, `alerts`,
  `alert_rules`, `audit_log`; transition/decision RPCs (API-ARCH-04,
  API-SEC-*); recurrence generator and alert evaluator (design per `09`;
  mechanism per AUTO-OQ-01). Rule versioning / generation provenance is
  specified in `06` (SCH-32, SCH-12 — Batch 4 closure amendment) and is
  implemented in this phase. IMP-031 fixture/staging seed compliance
  instances may use only `generation_source='manual'` or `'import'` —
  NEVER `'recurrence'` (the generator is IMP-050 and does not exist yet);
  `generated_at`/`rule_version_id`/`calculated_due_date` remain consistent
  with the SCH-12 provenance contract (i.e. recurrence-only fields stay
  NULL on manual/import rows); no fake recurrence-generated instances.
- **Entry criteria:** Phase B exit criteria met; alert-rule defaults
  decided (AUTO-OQ-04).
- **Exit criteria:** instances generate without duplicates and carry full
  provenance; tasks/My Work/review/alerts run on live data; audit rows
  flow.
- **Verification:** TEST-AUTO-01…10; TEST-AUD-01…10; TEST-RLS-CIN/TSK/
  RVW/ALR/ARL/AUD-* families; TEST-MIG-03 (seed invariant checks,
  MIG-VAL-01).
- **Rollback/recovery:** disposable environment reset; automation is
  idempotent so re-running jobs is safe (AUTO-IDM-01).
- **Data-integrity check:** instance uniqueness
  `(compliance_type_id, legal_entity_id, registration_id, period_start)`
  holds (unchanged by rule versioning — new versions never duplicate
  obligations, SCH-12); generated instances carry `rule_version_id`,
  `generation_source`, `generated_at`, `calculated_due_date` (AUTO-REC-07,
  SCH-32/SCH-12); audit rows carry non-human actors for automation writes
  (AUD-ACT-05).

### Phase D — Dashboard & search read models

- **Scope:** Command Centre / Morning Brief aggregates (API-R0-DASH),
  deadline board and dependency read models (API-R0-DLN), structured
  global search (API-R0-SRC), audit-history reads (API-R0-AUD), the two
  justified realtime surfaces (API-RT-01).
- **Entry criteria:** Phase C exit criteria met.
- **Exit criteria:** every R0 UI surface runs on Supabase mode with
  role-scoped numbers.
- **Verification:** role-scoped aggregate checks per RLS-STF-03/04
  (TEST-RLS-* RPC-level cases, API-SEC-04); realtime correctness and
  isolation (API-RT-05/06/07) at the harness gate; TEST-MIG-04 (read-model
  vs base-table consistency spot checks).
- **Rollback/recovery:** read models are derived — rebuild by re-query;
  no data loss mode exists in this phase (AUTO-DLN-01).
- **Data-integrity check:** aggregate outputs reconcile against direct
  table counts for representative filters (DM-X-03).

### Phase E — Production cut-over & fixture decoupling

- **Scope:** Production project initialized (**only after DEC-P human
  approval of region and contractual review — production provisioning is
  gated**); staging rehearsal of the full migration chain; production
  deploy in `supabase` mode per the cutover gate (MIG-DEP-04); production
  bundle verified free of fixture imports (MIG-DS-06).
- **Entry criteria:** Phases A–D gates green on staging; DEC-P approval
  recorded; rollback/recovery procedure documented (`13`).
- **Exit criteria:** production smoke checks green; fail-closed behaviour
  proven (MIG-DS-03/05/06); demo deployment independently verified
  unaffected.
- **Verification:** TEST-MIG-05 (production smoke suite), TEST-AUTH-* and
  TEST-RLS-* spot runs against production with synthetic probe data,
  MIG-VAL-01 invariant checks.
- **Rollback/recovery:** application rollback per MIG-RBK-04; data
  recovery via backup/PITR per `13` (TEN-24 provisional targets).
- **Data-integrity check:** post-deploy invariant suite (row counts,
  orphans, uniques, audit presence) passes on production.

## Production cutover gate

- **MIG-DEP-04 — Production cutover to Supabase may occur only when ALL
  of the following hold (MIG-OQ-01 RESOLVED):** schema migrations have
  succeeded in the target environment; authentication and RLS
  verification pass (TEST-AUTH-*, TEST-RLS-*); seed/reference-data
  validation passes (MIG-VAL-01); smoke tests pass; the required Harness
  Gate checks are green (DEC-S, incl. RLS-MECH-02 recorded); a documented
  rollback/recovery procedure exists (`13`); and **explicit deployment
  approval** is given by the requester. Production **never** runs fixture
  mode and never silently falls back to it (MIG-PRIN-03, MIG-DS-05/06).
  The existing demo fixture deployment remains available independently on
  its own track (MIG-DEP-03).

## Fixture → production entity mapping

Mapping is used for (a) seed design and (b) the adapter contract. Fixture
records are **demo data**, not production seed content, except where a
category below says otherwise.

| Fixture source | Production target | Mapping class | Notes |
|---|---|---|---|
| `FIRM` (1 record) | `firms` row | Direct (synthetic) | String id → uuid; `team` splits into profiles + memberships |
| `TEAM` (5 members) | `profiles` + `firm_memberships` | Transform | One auth user + profile + membership per person; roles mapped to the SCH-03 role vocabulary; fixture "owner" ids become membership ids |
| `CLIENTS` (34) | `clients` + one default `legal_entities` row each | Transform | `ownerId` → `owner_partner_membership_id` (SCH-RESP-01); `entityType` → `legal_entities.entity_type`; `tags`, `risk_rating` map directly; offboarded semantics per DM-04 |
| `CLIENTS[].gstin/pan/cin` | `registrations` rows | Transform | Identifier fields become typed registration rows (`type` ∈ GSTIN/PAN/CIN, SCH-07); multi-state GSTINs would need multiple rows — fixture holds at most one |
| `COMPLIANCE_MASTER` (11 types) | `compliance_types` system defaults (NULL firm_id) + initial `compliance_rule_versions` | Reference seed | `dueRule` text → structured `due_rule jsonb` on the initial version (SCH-32); `scope_kind`/`registration_class` per the DM-27 matrix; **seeded but not production-activated until external CA/domain sign-off** (DM-OQ-01; SCH-32 `domain_approval_status`) |
| `TASKS` (1,284 generated) | `compliance_instances` + `tasks` | Transform | Generator logic is discarded; fixture rows map to instances (with structured periods; `generation_source='import'` or `'manual'` — never claimed as recurrence-generated, SCH-12) and their linked tasks; `nextAction` → `tasks.next_action`; fixture string periods → `period_start`/`period_end`/`period_label` (SCH-12) |
| `REVIEW_ITEMS` (21) | `review_items` | Transform | Display type strings → category keys (vocabulary **open**, API-OQ-01 — fixture strings are not the production taxonomy); submitter names → memberships; comments → review history/`task_comments` as appropriate |
| `ALERTS` (5) | `alerts` + `alert_rules` templates | Transform | Each alert implies a rule; rules seed as firm templates (SCH-19); statuses map to the DM-22 lifecycle |
| `DEPENDENCY_CLIENTS` (48) | none (derived) | Demo-only | Production dependency board is derived from instances/tasks (`09`, AUTO-DLN-01); fixture stays in the demo adapter |
| `ASK_FIXTURES` (6) | none | Demo-only | Ask CAOS is demo-only in R0 (`07`); real AI deferred (DEC-C) |
| `AGGREGATES`, `REVIEW_COUNTS`, `ACTIVE_ALERT_COUNT`, `DEPENDENCY_TOTALS`, `TOTAL_ACTIVE` | none | Fixture-only presentation data | Replaced by server-derived aggregates (DM-X-03, API-R0-DASH) |
| `DEMO_TODAY` | none (pinned demo date) | Demo-only | Pinned per MIG-DS-04; production uses server time (API-CONV-04) |

### Mapping field notes

- **New production values required:** uuid primary keys; `firm_id` on every
  tenant-owned row; membership ids for all responsibility references
  (SCH-RESP-01); structured periods (SCH-12); `period_meta` where a family
  needs it; recurrence provenance on generated instances
  (`rule_version_id`, `generation_source`, `generated_at`,
  `calculated_due_date` — AUTO-REC-07, SCH-32/SCH-12); audit fields
  (`created_at`/server stamps) — never backdated from fixture strings.
- **Fixture-only presentation data:** precomputed counters, prose strings
  (`dueRule` descriptions), avatar/imagery — not migrated as data.
- **Unsupported fixture assumptions:** exactly-one-owner-per-client as a
  bare user id (production needs partner + optional manager memberships);
  single-identifier clients (production registrations are N per entity);
  generated task volumes keyed to a live clock (pinned per MIG-DS-04);
  flat compliance catalogue (production adds firm overrides, TEN-07).

## Seed-data categories

- **MIG-SEED-01 — System reference data:** platform-level reference rows
  that exist once (none beyond schema defaults identified for R0; recorded
  here if added).
- **MIG-SEED-02 — Compliance-type reference data:** the statutory
  catalogue as `compliance_types` system defaults **plus their initial
  `compliance_rule_versions`** (SCH-32), with `scope_kind`/
  `registration_class` per DM-27 and alert-rule templates. **Seed
  governance classification (R0 closure 2026-09-03):** GST, TDS, Income
  Tax/ITR, ROC/MCA, Professional Tax, PF, ESI, and Audit are seeded as
  `governance_class='statutory'`; Certificates/custom recurring are
  `non_statutory`; Payroll remains excluded (SCH-OQ-06). **These rows
  define capability, not activated statutory calendars; production
  statutory-rule activation is a separate gated step requiring external
  CA/domain sign-off (DM-OQ-01; AUTO-REC-09) — seeded versions carry
  `domain_approval_status='pending'` until then (SCH-32).** Statutory
  seeded versions are `status='draft'`; non-statutory/custom test/demo
  rules may use `domain_approval_status='not_required'` only where the
  governance classification permits it.
- **MIG-SEED-03 — Synthetic development tenant:** one demo firm
  ("development" marker), synthetic staff covering every role (for
  TEST-RLS-* execution), synthetic clients/entities/registrations/
  engagements, and generated compliance/task data at representative volume
  (incl. a ~100k-row `compliance_instances` dataset option for the
  RLS-MECH-02 performance check).
- **MIG-SEED-04 — Synthetic staging tenant:** smaller, sanitized,
  structurally similar to production shape; refreshed from migrations, not
  from production data (TEN-13).
- **MIG-SEED-05 — Demo fixture data:** the existing in-memory fixtures,
  unchanged in content, pinned in time (MIG-DS-04); used only by the
  fixture adapter in the demo deployment.
- **MIG-SEED-06 — Synthetic-data rules:** fictional names/identifiers only;
  no real PAN/GSTIN/CIN values; deterministic uuids for dev seeds (stable
  test references, MIG-OQ-02); seed scripts are environment-labelled so a
  dev seed can never run against production by accident.

## Pilot / pre-cutover customer data

- **MIG-PD-01 (MIG-OQ-03 RESOLVED directionally):** The preferred launch
  path assumes **no legacy production database currently exists**. If
  pilot/customer data is introduced into any environment before final
  production cutover, a **documented migration/backfill path becomes
  mandatory** before Phase E completes: source-of-truth declaration,
  field-level mapping into the SCH-* model, dry-run validation, and
  reconciliation counts. **The system must not require deleting pilot
  data to complete migration** (MIG-PRIN-07); any "start clean" step
  requires explicit requester approval as a separate decision.

## Data-validation strategy

- **MIG-VAL-01 — Post-migration invariant checks** per phase: row counts
  vs expectation, orphan scan (composite-FK integrity, SCH-FK-01), unique
  constraints holding (SCH-12 instance key), state values within CHECK
  vocabularies, generation provenance present on generated instances
  (AUTO-REC-07, SCH-32/SCH-12), audit rows present for seed/system writes
  (AUD-ACT-02).
- **MIG-VAL-02 — Contract verification:** the harness (`11`) runs the
  TEST-RLS-*/TEST-AUD-*/TEST-AUTO-*/TEST-AUTH-* suites against the
  migrated schema at every phase gate.
- **MIG-VAL-03 — Adapter parity check (local only):** the same `@/data`
  contract calls are exercised against both adapters; responses must
  satisfy the same DTO contract (shape, not fixture values).

## Rollback principles

- **MIG-RBK-01 — Forward-only in production** (MIG-PRIN-05): a bad
  production migration is corrected by a new migration; destructive
  reverse migrations are not written.
- **MIG-RBK-02 — Local/staging are disposable:** reset and re-seed freely;
  the migration chain must be reproducible from scratch on the CLI stack
  (this is also the CI pattern, `11`).
- **MIG-RBK-03 — Data-loss safety net:** production restore relies on
  platform backup/PITR per `13` against the provisional RPO ≤ 24 h /
  RTO ≤ 8 h targets (TEN-24) — exact mechanisms are operations-owned and
  still open (TEN-OQ-03).
- **MIG-RBK-04 — Application rollback:** a bad deploy rolls back to the
  previous frontend build **only if** the schema is unchanged or
  backward-compatible; schema-affecting releases sequence migration first,
  deploy second (MIG-DEP-01), so the old app keeps working against the new
  schema.

## Deployment sequencing

- **MIG-DEP-01 — Migration before deploy.** Schema migrations apply to the
  target environment first; the frontend deploy follows. Backward-
  incompatible changes ship as expand-then-contract migration pairs.
- **MIG-DEP-02 — Environment order:** local → staging (full rehearsal,
  Phase E) → production (after DEC-P approval and the MIG-DEP-04 gate).
  Each environment has isolated credentials and configuration (TEN-15/19).
- **MIG-DEP-03 — Demo deployment is independent:** the fixture demo site
  deploys on its own track with `DATA_SOURCE=fixture`; production releases
  never touch it (TEN-20/21).
- **MIG-DEP-04 — Production cutover gate:** see its own section above
  (MIG-OQ-01 RESOLVED).

## Assumptions

- MIG-A-01: The Supabase CLI local stack supports the full migration chain
  offline (pg_cron availability per AUTO-SCH-02 is validated at the harness
  gate; a local-only gap would be recorded, not worked around silently).
- MIG-A-02: Fixture volumes (34 clients, 1,284 tasks) are representative
  enough to design seeds from; production-scale synthetic volume is
  generated, not copied (MIG-SEED-03).
- MIG-A-03: The preferred launch path has no legacy production database to
  port (MIG-PD-01); if that changes, the documented pilot-data backfill
  path applies — no silent assumption either way.

## Dependencies

- Upstream: `01` (DEC-D/P/S/T), `02` (DM-04/10/27, DM-X-03), `03`
  (TEN-12…24), `05` (RLS-MECH-02 gate), `06` (SCH-01…32, SCH-FK, SCH-RESP,
  SCH-32/SCH-12 provenance per the Batch 4 closure amendment), `07`
  (adapter contract, classifications, API-OQ-01), `08` (AUD-ACT-02), `09`
  (AUTO-SCH/OQ, AUTO-REC-07/09).
- Downstream: `11` (harness executes the phase gates), `12` (R0 plan
  sequences the phases), `13` (backup/PITR, rollback operations).

## Open Questions

| ID | Question | Owner | Status |
|---|---|---|---|
| MIG-OQ-01 (= DEC-OQ-03) | Production data-source cutover conditions | — | **Resolved:** cutover only via the MIG-DEP-04 gate (migrations, auth/RLS verification, seed validation, smoke tests, Harness Gate, rollback procedure, explicit deployment approval); production never runs/falls back to fixture; demo deployment independent |
| MIG-OQ-02 | Deterministic-id scheme detail for dev seeds (uuidv5 namespace vs fixed uuid list) | implementation | Open — either satisfies MIG-SEED-06 |
| MIG-OQ-03 | Pilot/customer data appearing before cutover | — | **Resolved directionally:** documented migration/backfill becomes mandatory; pilot data is never deleted as a migration shortcut (MIG-PD-01, MIG-PRIN-07) |
| MIG-OQ-04 | How many historical periods are back-materialized for existing clients at onboarding (recurrence look-back vs forward-only, AUTO-REC-01) | product | Open — NOT a blocker for IMP-031 schema/RLS/API/local/staging implementation; IS a blocker for production onboarding materialization depth and historical/back-materialization policy; IMP-031 must not encode any assumed depth (30 days / 90 days / 1 year / financial year etc.) |

## Acceptance Criteria

- MIG-ACC-01: The per-environment `DATA_SOURCE` matrix matches the approved
  direction exactly; selection is explicit; unknown values fail closed;
  production never runs or falls back to fixture mode; fixture code is
  mechanically excluded from production builds (MIG-DS-01…06).
- MIG-ACC-02: Phases A–E each declare entry criteria, exit criteria,
  verification test families (TEST-MIG/RLS/AUTH/AUD/AUTO), rollback or
  recovery condition, and a data-integrity check; advancement stops on
  gate failure.
- MIG-ACC-03: Every fixture constant/export is mapped: direct, transform,
  fixture-only, demo-only, or unsupported — including identifier →
  registration transformation and membership-reference conversion.
- MIG-ACC-04: Seed categories are defined with synthetic-data rules; no
  real customer or production-sensitive data is seeded anywhere.
- MIG-ACC-05: Statutory-rule activation is explicitly excluded pending
  external CA/domain sign-off (DM-OQ-01); seeds define capability only,
  and seeded rule versions carry `domain_approval_status='pending'`
  (SCH-32).
- MIG-ACC-06: Rollback principles state the forward-only production
  preference, disposable local/staging, backup/PITR dependency, and
  migration-before-deploy sequencing.
- MIG-ACC-07: The demo-clock pinning prerequisite (TEN-22 / MIG-DS-04) is
  recorded before any migration work.
- MIG-ACC-08: The production cutover gate (MIG-DEP-04) and the pilot-data
  protection rule (MIG-PD-01) are explicit.

## Consequence of Change

Changing the data-source matrix, fixture-isolation rules, or the cutover
gate affects every environment and the demo business flow (requester
sign-off). Changing the fixture mapping after seeds exist requires a
seed-versioning decision. Activating statutory rules without the external
CA/domain sign-off is a compliance-risk change, not a technical one — it
is gated by DM-OQ-01 and SCH-32 `domain_approval_status` regardless of
implementation readiness. Weakening MIG-PD-01 risks real customer data
and requires explicit requester approval.
