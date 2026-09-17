# AGENTS.md

Guidance for AI coding agents working in this repository.

## Repository State: CURRENT vs TARGET

This repository is in transition. Two things are both true and must not be
conflated:

**CURRENT implementation (this Git baseline):** two tracks now exist and
are both real. (1) The polished fixture/demo track — React + TypeScript +
Vite, fixture-backed via `@/data`, deployed as the dedicated demo site.
(2) The Supabase-backed Release-0 implementation — PostgreSQL schema via
Git-tracked migrations, Supabase Auth, Row Level Security, audit, and
provider-neutral data adapters behind `@/data` — landed and accepted on
hosted staging through IMP-051 (CLOSED 2026-09-18; see the status block
below and `docs/harness/current-state.md`). The test/harness stack (Vitest unit,
auth/RLS/schema/audit integration suites, Playwright, Harness Gate) is
installed and operational.

**APPROVED TARGET architecture (Release 0):** specified and approved in
`docs/spec/` (Final Spec Gate: PASS, 2026-08-31). Release 0 adds a Supabase
backend — PostgreSQL, Supabase Auth, Row Level Security, migrations as the
schema-change source of truth, private/server boundaries where required —
with isolated local / staging / production environments. The polished
fixture demo is retained as a separate, dedicated deployment.

Implementation packages have landed through IMP-051 (CLOSED
2026-09-18); the Supabase track
is real and accepted on staging. Do not conflate the two tracks: fixture
mode is demo-only; production behavior is the Supabase track. Do not
document future behavior as if it exists. When a section below describes
target state, it says so explicitly.

**Release-0 implementation status (2026-09-06):** the Harness Gate is PASS
(20/20), IMP-010 has landed (`supabase/migrations/` carries the production
tenant core: `firms`, `profiles`, `firm_memberships`, SCH-01…03), and
IMP-011 (staff authentication) is COMPLETE: a dual-mode auth adapter behind
`@/data` (`src/data/auth/`), staff auth pages, authentication-level route
protection, and invitation-only Supabase Auth config (`enable_signup =
false`, TOTP on, session timebox 168h / inactivity 12h). IMP-012
(foundational RLS) is COMPLETE: RLS is enabled on all three tenant-core
tables (DEC-J live `firm_memberships` lookup; the untrusted `x-active-firm`
request header selects firm context but grants nothing by itself;
least-privilege `authenticated` grants, anon zero; AAL2 enforced at the
database). IMP-013 (audit foundation) is COMPLETE: `audit_log` (SCH-20, append-only, RLS enabled + forced, SELECT
for partner/super_admin of the owning firm only), the Layer-A audit trigger
on the three tenant-core tables, Layer-B membership-administration RPCs
(`invite_member` / `change_membership_role` / `suspend_membership` /
`remove_membership` / `accept_invitation` — raw PostgREST writes to
`firm_memberships` are closed; super_admin + AAL2 + live membership, atomic
mutation+audit), and the Layer-C server-writer contract plus
`mirror_login_history()` (service_role only). IMP-014 (data adapter
boundary) is COMPLETE (checkpoint `3fed76a`): `VITE_DATA_SOURCE` is
REQUIRED and fail-closed (unset/invalid = hard startup error with a
visible screen — no default mode, no fixture fallback, MIG-DS-05);
`fixture` = demo track (no backend), `supabase` = production track (needs
`VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`, see `.env.example`).
Selection happens once, through `src/data/source.ts` only. IMP-020
(client hierarchy) is COMPLETE: the first
business-domain migration (`clients` / `legal_entities` /
`client_relationships` / `registrations` / `contacts`, SCH-04…08) with
composite same-firm FKs, RLS enabled AND forced (active-firm selector +
live role; manager portfolio = own designated-manager clients per
RLS-STF-03 — for `client_relationships` a manager reads/writes an edge
only when BOTH endpoint clients are in portfolio, RLS-A-03; billing has
no table access — identity-only via the reviewed
`list_client_identities()` definer RPC, which additionally requires
`p_firm_id =` the active-firm selector, RLS-A-04; senior/article see
nothing in R0),
Layer-A audit triggers on all five tables, and the provider-neutral
`clientHierarchyService` behind `@/data` (fixture adapter derives from the
demo fixtures; Supabase adapter is plain PostgREST under RLS). The
browser client now injects the untrusted `x-active-firm` selector header
from `src/data/context.ts` on every request. IMP-021 (engagements) is
COMPLETE: the `engagements` table
(SCH-09) — client-level professional-service relationships with
`responsible_partner_membership_id` (validated ACTIVE same-firm
membership via trigger; no role predicate, mirroring the DM-04
precedent), `service_lines`, `letter_status`, `period_label`, and a
guarded status lifecycle (draft → proposed → active → completed,
active → terminated; terminals final, DM-SM-03 — invalid transitions
raise a CHECK violation marked `INVALID_TRANSITION:engagements.status`
which the API layer maps to `conflict`; plain CHECK violations stay
`validation`). RLS enabled and forced: super_admin/partner full firm
scope, manager portfolio-scoped READ-ONLY via the owning client's
designated manager (RLS-ENG-01), senior/article nothing in R0, billing
letter-status-only via the `list_engagement_letter_statuses()` definer
RPC (active-firm pinned, like `list_client_identities()`). Layer-A
audit trigger via the extended `audit_trg_row()`; the provider-neutral
`engagementService` sits behind `@/data` (fixture adapter derives one
engagement per demo client; Supabase adapter is plain PostgREST under
RLS plus the billing projection RPC). IMP-022 (Client 360 live wiring)
is COMPLETE: `/clients` +
`/clients/:clientId` (new routes, sidebar entry) render the composite
Client 360 read model behind the provider-neutral `client360Service`
(API-R0-CLI / DM-X-02 — one contract, several plain RLS reads; NO
aggregate SECURITY DEFINER RPC, so the composition can never widen
table RLS). Sections live: overview (partner/manager display names via
firm_memberships ⋈ profiles under RLS-MEM-01/RLS-PRF-01), legal
entities, registrations-as-identifiers, contacts, relationships
(both-endpoint portfolio rule preserved — IMP-020 closure A),
engagements. Deferred tabs (Compliance / Documents / Financials) render
explicit deferred states; Communications is the spec-approved
placeholder (DM-15). Unknown, malformed, out-of-portfolio, and
foreign-firm client ids share ONE identical not-found surface
(API-ERR-02). Create flows (client → entity → registration,
TEST-E2E-03…05) reuse the IMP-020 write contracts; RequireAuth now
bootstraps the single active-firm context from live memberships before
any page renders (RLS-CTX-01/02 — context selection, never
authorization). The bootstrap is identity-bound: the context is cleared
on logout, sign-in as a different user, or session replacement BEFORE
the new identity's pages render, and the temporary R0 multi-firm
default is deterministic — the ACTIVE membership with the smallest
firm id (`resolveDefaultActiveFirm` in `src/data/context.ts`; switcher
UI is a later package). IMP-030 (compliance types & rule versions) has
landed (checkpoint `00ad7c2`): `compliance_types` (SCH-10 —
hybrid reference data: `firm_id IS NULL` = system default, browser
read-only per TEN-08; `governance_class` statutory|non_statutory is
NOT NULL with no default, and firm overrides of a system `type_key`
inherit the system classification — no statutory downgrade) and
`compliance_rule_versions` (SCH-32 — NO `updated_at`; half-open
effective windows `[effective_from, effective_to)` with a partial
exclusion constraint on ACTIVE rows; rule content frozen once a
version leaves draft; lifecycle metadata changes only via the Layer-B
definer command `activate_compliance_rule_version(uuid)` — actor from
`auth.uid()`, live same-firm super_admin/partner + AAL2 +
governance-derived statutory approval gate, atomic predecessor window
close + audit; succession keeps predecessors `active` for their
historical windows). Layer-A audit via the extended `audit_trg_row()`;
the provider-neutral `complianceRulesService` sits behind `@/data`
(fixture adapter mirrors the seed catalogue with the SAME UUIDs; no
UI screens in this package). Statutory seeds remain draft/pending —
zero activated statutory rules (OPS-OQ-04 stays a production
activation blocker). IMP-031 (compliance profiles & instances) is
COMPLETE and CLOSED (implementation checkpoint `03e999d`; hosted staging
promoted and verified; human browser acceptance PASS 2026-09-04): `client_compliance_profiles`
(SCH-11 — DM-11 applicability records, one profile per
(entity, type, registration) via `NULLS NOT DISTINCT` uniqueness;
proposed → active only through the controlled Layer-B approval
command, which stamps `approved_by`/`approved_at` and creates NO
instances — materialization is IMP-050) and `compliance_instances`
(SCH-12 — DM-12 obligation per entity per period, DM-SM-04 10-state
pipeline), with composite same-firm FKs (SCH-FK-01…03, including the
new `registrations (firm_id, id)` parent key) and the DM-27
registration-scope validator (TAN-class TDS PAN substitution is the
only permitted class exception; instances may carry NULL registration
only with a recorded `tds_pan_exception` reason). RLS enabled AND
forced on both tables (RLS-CCP-01/RLS-CIN-01: manager-plus write
paths; senior/article read only profiles/instances tied to their live
assignments; the transition authorization matrix and four-eyes rules
RLS-4EY-01/02 are enforced by the guards, not the caller's grants).
The two Layer-B definer commands `approve_client_compliance_profile(uuid)`
and `transition_compliance_instance(uuid,text,text)` are the only
guarded-column writers (single-writer marker; the transition command
adds state-based mutation-key idempotency — `already_applied` no-op,
no double audit); approval is a business approval with no AAL2
step-up (RLS-AAL-02 precedent). Layer-A audit via the extended
`audit_trg_row()`; the provider-neutral `complianceInstancesService`
sits behind `@/data` (fixture adapter + plain-PostgREST-under-RLS
Supabase adapter; no UI screens in this package). The authenticated
INSERT grant on `compliance_instances` excludes the four recurrence-
provenance columns (AUTO-REC-07) — the adapter sends no provenance
keys; the server defaults `generation_source` to `'manual'` and the
IMP-050 generator (service_role) is the only provenance writer.
Coverage: 40 schema
+ 39 RLS + 18 audit integration tests and 22 unit tests (21 fixture
service contract + 1 Supabase-adapter write-payload shape). IMP-040
(tasks, dependencies, checklists, comments) is COMPLETE and CLOSED
(implementation checkpoint `be15229`; hosted staging promoted and
verified; Netlify staging published; human browser acceptance PASS
2026-09-05): `tasks` (SCH-13 — instance-linked or ad-hoc; nullable
`compliance_instance_id`, DEC-H; `client_id` server-derived from the
linked instance, same-firm client required for ad-hoc), `task_dependencies`
(SCH-14), `task_checklist_items` (SCH-15), `task_comments` (SCH-16 —
append-only, author-only retraction, no edit/delete), all RLS enabled
AND forced with composite same-firm FKs. `status` is NEVER
browser-writable (column-pinned grants + write guard) — every DM-SM-05
transition goes through the Layer-B definer command
`transition_task(uuid,text,text,text,text)` (authorization BEFORE
disclosure: unauthorized-existing and nonexistent tasks return one
identical `not_found`; state-based mutation-key idempotency). Task
four-eyes (RLS-4EY-03): instance-linked tasks inherit
`four_eyes_required` via ComplianceInstance → ComplianceType;
`submitted → approved`/`submitted → returned` are assigned-reviewer-only
with NO privileged-rank bypass; `returned` requires a non-empty reviewer
comment created atomically in the same transaction. Dependency graph
changes go ONLY through `add_task_dependency` /
`remove_task_dependency` (direct table mutation closed; manager needs
BOTH tasks in scope; firm-scoped transaction advisory lock + recursive
cycle check — concurrent opposing edges commit at most once); dependency
SELECT requires BOTH endpoint tasks visible (API-ERR-02 / RLS-A-03 —
either-endpoint visibility was rejected as an endpoint-identity leak).
Layer-A audit on tasks/checklist/comments; Layer-B command audit with
skip-flag (no double logging); existing-but-invisible probes audited as
denials, nonexistent un-audited. The provider-neutral `taskService` sits
behind `@/data` (`src/data/tasks/` — note the naming hazard: the legacy
flat fixture module `src/data/tasks.ts` shadows the folder, so the barrel
wires `./tasks/index` explicitly). No task/My Work UI, no recurrence,
no event publication in this package (TEST-E2E-07 → IMP-042; generator
and events → IMP-050). Coverage: 22 schema + 51 RLS + 17 audit + 16
provider integration tests and 32 unit tests. IMP-041
(review queue) is COMPLETE and CLOSED (primary implementation
checkpoint `636beed` `feat: review queue`; final accepted corrective
checkpoint `e857e59` `fix: use review queue polling fallback`; hosted
staging promoted and verified; Netlify staging published; human
staging/browser acceptance PASS 2026-09-06): `review_items` (SCH-17 —
R0 type vocabulary frozen by API-OQ-01: `gst_reconciliation`,
`tds_return`, `itr_computation`, `financial_statements`,
`audit_workpaper`; lifecycle `pending → approved / returned /
escalated / dismissed` per DM-SM-06), RLS enabled AND forced with the
single scoped SELECT policy `review_items_select_scoped`
(super_admin/partner firm-wide; manager portfolio + direct task
assignee/reviewer; senior/article own submissions; billing none).
Browser table grants are SELECT-only — every write goes through the
Layer-B definer commands `submit_review_item` / `decide_review_item`
(authorization BEFORE disclosure per API-ERR-02: existing-but-hidden
and nonexistent items return one identical `not_found`; authorization
precedes vocabulary/lifecycle/rationale/replay evaluation; state-based
mutation-key idempotency returns `already_applied`, never an error).
Four-eyes (RLS-4EY-04): the decider's live membership must differ from
the submitter's — no rank bypass; a task-linked `returned` decision
additionally requires the assigned Task reviewer (intersection with
the IMP-040 task review authority), and the linked return is atomic:
ReviewItem `returned` + Task `returned` + exactly one immutable
TaskComment (body = rationale) + `review_item.decided` and
`task.transition` audit in one transaction — an illegal Task state
rolls the whole operation back. The provider-neutral `reviewService`
sits behind `@/data` (`src/data/review/`); the Review Queue UI is
data-backed in Supabase mode (senior/article submit against assigned
work only — no client enumeration; decision controls are
role-truthful). Queue freshness (API-RT-01/03/05) uses the APPROVED
API-RT-07 POLLING FALLBACK: authenticated postgres_changes cannot
carry the R0 `x-active-firm` request-header context through Realtime's
per-row RLS evaluation (executable differential harness proof,
2026-09-06), so `subscribeReviewQueue` polls every 15 seconds
(implementation parameter `REVIEW_QUEUE_POLL_INTERVAL_MS`, NOT a
product SLA) — each tick is a bare invalidation and the authoritative
state is always re-read through `listReviewItems` under RLS. There is
NO Review Queue postgres_changes dependency and NO realtime-publication
migration. Domain-event publication (`review.submitted` /
`review.completed`) remains deferred to IMP-050 and is NOT the same
thing as this polling fallback. IMP-042
(alerts & My Work) is COMPLETE and CLOSED (implementation
checkpoint `1f3db3e`; hosted staging promoted and verified —
authenticated 60-check probe PASS 60/60 with cohort-only synthetic
identities; Netlify staging proven byte-identical; human browser
acceptance PASS 2026-09-07, 44/44): `alerts` (SCH-18 — firm risk
signals with hybrid resolution, DM-22; status vocabulary
active/acknowledged/snoozed/resolved; the human-ruled manual transition
matrix is enforced ONLY by the Layer-B commands; senior/article read
granularity is exact-instance per the human-ruled pre-checkpoint
correction, RLS-ALR-01) and `alert_rules` (SCH-19 — per-firm
configuration, UNIQUE (firm_id, rule_key), NO seed rows/thresholds — D3
ruling, AUTO-OQ-04 stays open), both RLS enabled AND forced with single
scoped SELECT policies; browser table grants are SELECT-only — status
moves go only through `acknowledge_alert` / `snooze_alert` /
`resolve_alert` (manager+, no AAL2 per RLS-AAL-02; state-based
mutation-key idempotency; authorization-before-disclosure API-ERR-02
with byte-identical hidden/nonexistent denial bodies) and rule
administration only through `create_alert_rule` / `update_alert_rule`
(super_admin/partner + AAL2 step-up, RLS-AAL-01; manager read-only).
Snooze expiry is a READ derivation (TEST-API-18) — IMP-042 writes no
expiry (scheduler is IMP-051); `resolution_type='auto'` is
evaluator-reserved. My Work (`/my-work`, live) composes plain
RLS-protected task/review reads behind `myworkService`
(`src/data/mywork/` — DEC-L buckets Today/This Week/Waiting/Returned,
single-bucket precedence, explicit next_action, personal scope; NO
aggregate definer RPC, DM-X-02 precedent). The alert bell badge reads
the RLS-filtered active count and stays fresh via the approved API-RT-07
polling fallback (bare invalidation + authoritative re-read; interval is
an implementation parameter, not an SLA; known zero renders "0 active
alerts" with no badge, a failed read renders no badge — never a
fabricated zero). The existing `/alerts` page stays behind ModuleGate
(D1 ruling — NOT live-wired). Alert
generation/evaluation/dedupe/auto-resolution remain deferred to IMP-051;
event publication (`alert.created`/`alert.resolved`) to IMP-050
(AUTO-OQ-02). Coverage: TEST-SCH-26…29, TEST-RLS-ALR-*/ARL-*,
TEST-API-16…19, TEST-AUD-02/03 (IMP-042 portions), TEST-E2E-07/09.

Release-0 state through IMP-051 (CLOSED 2026-09-18 — human
package-closure approval): 21 / 27 formal R0 packages
complete (IMP-000…005, IMP-010…014, IMP-020…022, IMP-030, IMP-031,
IMP-040, IMP-041, IMP-042, IMP-050, IMP-051; 77.78%).
Migrations run through `20260916000000_alert_evaluation.sql`
(hosted staging ledger 12/12, local == remote through `20260916000000`).
Application public tables: 24 — CURRENT on local and hosted staging
(RLS enabled 24/24, FORCE RLS 20 — SCH-33/SCH-35 forced, SCH-34 enabled
not forced — policies 51; IMP-051 adds NO base table — the deadline read
model is two security_invoker views — so the Ruling 2026-09-12 R8
posture is unchanged).

IMP-050 (recurrence generation & scheduler signals) is COMPLETE and
CLOSED (human package-closure approval 2026-09-13; implementation
checkpoint `b15b584` `feat: implement IMP-050 recurrence automation`;
closure checkpoint `6b645e4` `docs: close IMP-050 recurrence`). Implementation was HUMAN
ACCEPTED before closure: independent final implementation reviewer
verdict PASS — READY FOR HUMAN IMPLEMENTATION ACCEPTANCE; final local
Harness Gate PASS 23/23 phases; automation integration 43/43; schema
integration 199/199; RLS 303/303; audit 111/111. Hosted staging
acceptance PASS (project `caos`, ref `pyrniumcjcvagjygheyu`,
Tokyo/Northeast Asia): the version-controlled migration
`20260912000000_recurrence_scheduler.sql` is APPLIED in the hosted
staging ledger and itself installed pg_cron via
`CREATE EXTENSION IF NOT EXISTS pg_cron` — hosted installed version
1.6.4, no Dashboard/manual extension drift (Ruling R6 satisfied);
`cron.timezone = GMT` and `cron.database_name = postgres` verified
hosted. Exactly two IMP-050 cron registrations were active at the
IMP-050 boundary:
`outbox.drain` (`* * * * *`) and `sched.recurrence.evaluate`
(`0 19 * * *` GMT = 00:30 Asia/Kolkata next business-day
interpretation per contract, fixed UTC+05:30, under the fail-closed
`current_setting('cron.timezone', true) = 'GMT'` precondition — CAOS
never mutates `cron.timezone`, Ruling R5/AUTO-SCH-07); observed
`outbox.drain` runs succeeded; no alert-scheduler or login-mirror cron
is owned by IMP-050. Automation tables `event_outbox`,
`scheduler_job_runs`, `scheduler_dead_letters` exist hosted with zero
forbidden automation-table privileges and zero forbidden owner-only
function EXECUTE grants; dead-letter manual recovery is service-only
via `requeue_dead_letter(uuid,text)` (browser roles have no execute);
`immediate_automation_correlation` is SECURITY INVOKER with
`search_path=''`. The hosted API/PostgREST acceptance PASSED using an
existing dedicated staging probe account after an explicitly
human-authorized password reset through the supported Supabase Admin
API (no credential/key/password is recorded anywhere): authenticated
requests were denied 403 and anonymous requests denied 401 for all
three automation tables and the protected RPC paths
`immediate_automation_correlation` / `requeue_dead_letter`; no business
data was created. There is NO IMP-050 UI/browser product flow — the
hosted browser-path acceptance was a negative PostgREST/RPC security
proof. Hosted data stability at acceptance: `compliance_instances` 0,
undelivered outbox 0, dead_letters 0. The R0 registered production
outbox consumer set may be empty — "delivered" means drain-completion,
not external delivery. Same-firm `successor_instance_id` composite
self-FK (Ruling R7) and explicit scheduler firm-boundary logic are
implemented; scheduler security never relies on RLS because pg_cron
execution was proven BYPASSRLS-capable (binding constraint
AUTO-SCH-03: anon/authenticated get no scheduler capability). CAOS
stores the recurrence-rule framework and draft reference rules;
IMP-050 implements the engine consuming approved ACTIVE rules — final
statutory rules still require external practicing-CA/compliance-domain
validation and controlled activation; draft statutory rule versions
remain pending. Production promotion is NOT part of IMP-050 closure
and remains NOT authorized; no production verification is claimed.

Historical pre-implementation context (kept for rationale): IMP-050
entry criteria were satisfied before implementation — R0-D green and
AUTO-OQ-01/02/03 RESOLVED by human ruling 2026-09-11 (pg_cron +
hardened in-database scheduler/job functions; transactional outbox;
90-calendar-day configurable look-ahead, Asia/Kolkata business-date
basis, UTC-persisted timestamps); AUTO-SCH-02 PASS (LOCAL/HOSTED/
OVERALL — evidence `docs/harness/auto-sch-02-probe.md` +
`docs/harness/auto-sch-02-results.json`); automation record contracts
SCH-33/34/35 added to `06`. The architecture/spec amendment was
APPROVED (human diff review PASS 2026-09-12); the implementation
contract / contract closure was HUMAN APPROVED 2026-09-12 (final
independent contract-closure re-review: PASS — findings NONE) and
CLOSED by human rulings 2026-09-12 (recorded in `09` as
AUTO-SCH-04/05/06/07 + the TEST-AUTO-05/06 clarification, reconciled
across `06`/`10`/`11`/`12`/`13`): IMP-050 registers
`sched.recurrence.evaluate` and ONE infrastructure outbox-drain job
(once per minute, stable named idempotent pg_cron registration — NOT a
fourth scheduler signal, timezone-independent); IMP-051 owns the
`sched.alerts.evaluate` registration; `sched.login_mirror.run` stays
outside IMP-050. The earlier pre-implementation note that hosted
pg_cron was "available but NOT installed" is SUPERSEDED — installation
entered through the version-controlled migration ledger exactly as
Ruling R6 required.

IMP-051 (deadline materialization & alert evaluation) is COMPLETE and
CLOSED (human package-closure approval 2026-09-18; implementation
checkpoint `8e8464a` `IMP-051: materialize deadlines and evaluate
alerts`; closure checkpoint: this closure commit — hash recorded
post-commit per the closure-pointer reconcile convention). The migration
`20260916000000_alert_evaluation.sql` corrects the SCH-18 resolved
clause (explicit `resolution_type IS NOT NULL`; manual ⇒ human
`resolved_by`, auto ⇒ `resolved_by IS NULL` — AUD-ACT-05, no synthetic
system identity), adds the HRR-06=A structural dedupe index
`alerts_nonresolved_dedupe_unique` (partial UNIQUE NULLS NOT DISTINCT
over (firm_id, alert_rule_id, client_id, compliance_instance_id),
non-resolved states only; fail-closed legacy-duplicate preflight, zero
automatic cleanup), implements the hardened owner-only
`evaluate_alerts()` (the `sched.alerts.evaluate` job function:
pull-based; recognized family = deadline-risk only — missing/malformed
`days_before_due` config fails that rule closed, unknown rule_keys skip
silently, zero enabled rules is a safe no-op; status-guarded
snooze-expiry normalization; structural-dedupe creation; gated
auto-resolution with `resolution_type='auto'`; explicit audit_write with
app.audit_skip_trigger — system/alerts actor, per-run SCH-34 evidence +
correlation, no double auditing, publication trigger owns the domain
events), the two security_invoker deadline views (`deadline_board` —
compliance_instances only, grouped by (compliance_type_id, operative
due_date) on Asia/Kolkata semantics; `client_dependency_board` —
information_requested instances + waiting tasks, tasks ONLY here;
SELECT to authenticated only), and the `sched.alerts.evaluate` cron
registration (`30 19 * * *` GMT = 01:00 Asia/Kolkata, fail-closed GMT
precondition; `sched.login_mirror.run` remains unregistered). The
provider-neutral `deadlinesService` sits behind `@/data`
(`src/data/deadlines/` — SAME naming hazard as tasks/alerts: the barrel
wires `./deadlines/index` explicitly; the legacy flat
`src/data/deadlines.ts` is untouched); the Harness Gate gained the
deadlines-integration phase (24 phases). NO UI wiring
(UI_WORK_IN_IMP051=NO); ZERO alert-rule seeds/thresholds/default-enabled
rules (HRR-07=A — AUTO-OQ-04 remains OPEN); NO statutory activation.
Final local runtime PASS (automation integration 51/51, targeted audit
15/15 incl. TEST-AUD-03, deadline integration 10/10, deadline unit
tests, `npm run verify`, full Harness Gate PASS 24/24); final
post-runtime independent review PASS; post-checkpoint independent
verification PASS; hosted staging acceptance PASS (structural +
behavioral: board aggregation and role-scope RLS proofs, evaluator
creation/dedupe/auto-resolution/snooze-normalization, audit/event
attribution; 5 synthetic probe firms + 5 synthetic auth users fully
removed; alert_rules = 0 and statutory ACTIVE = 0 after cleanup).
Runtime-found defects corrected en route and independently re-reviewed
(superseded, not open): the lifecycle-CHECK NULL-`resolution_type` hole
(migration defect) and focused test-defect repairs (SQL probe syntax; a
boolean `::text` representation; the TEST-AUD-03 evaluator fixture's
obligation-period isolation).

Next package: IMP-060 — Command Centre & Morning Brief live data (NOT
STARTED, NOT AUTHORIZED — begins only with an explicit implementation
instruction; IMP-051 closure does not authorize it).

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
                   # REQUIRES VITE_DATA_SOURCE (fixture|supabase) — no default mode
                   # (MIG-DS-05); copy .env.example to .env.local
npm run build      # tsc -b (type check) + vite build → dist/
npm run preview    # serve the production build locally
npm run lint       # ESLint over the repo
npm run test       # Vitest in watch mode (unit/component tests in tests/)
npm run test:unit  # Vitest, non-interactive single run (tests/unit, tests/components)
npm run test:integration # Vitest node integration tests (tests/integration; needs local Supabase + db:reset:harness)
npm run test:auth  # Auth integration tests only (GoTrue, deterministic harness users)
npm run test:rls   # RLS integration tests only (hgate_* mechanism harness + production tenant-core RLS)
npm run test:schema # Schema integration tests only (tenant core + catalog posture; TEST-SCH-02/03)
npm run test:audit # Audit integration tests only (IMP-013 audit foundation; TEST-AUD-*)
npm run test:tenancy # Tenancy adapter integration tests only (IMP-014; TEST-API-01…03 skeleton)
npm run test:clients # Client-hierarchy adapter contract tests only (IMP-020; TEST-API-01…03)
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
`npm run build` and publishes `dist/`. `VITE_DATA_SOURCE` is deliberately
NOT set in `netlify.toml` (a repo-level value would force fixture mode
onto every site built from this repo, including future staging/production
— MIG-DS-01/05); each Netlify site sets it in its own site environment
settings (`fixture` for the demo/sales site, `supabase` elsewhere). SPA
fallback is configured twice — keep both in sync if changed:
`netlify.toml` redirects and `public/_redirects` (`/* → /index.html`).
This deployment is the fixture demo track.

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
  main.tsx            Entry: validates startup config (fail-closed, visible
                      ConfigErrorScreen on error), then mounts the app tree.
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

Production-path modules (IMP-011 auth; IMP-014 boundary + tenancy skeleton;
IMP-020 client hierarchy; IMP-021 engagements; IMP-022 client360; IMP-030
compliance rules; IMP-031 compliance instances; IMP-040 tasks; IMP-041
review; IMP-042 alerts + mywork):

- `source.ts` — THE single data-source selection boundary: `getDataSource()`
  (cached, fail-closed) and `validateStartupConfig()` (called once by
  `src/main.tsx` bootstrap). No other module may switch on
  `VITE_DATA_SOURCE` (MIG-DS-02/05).
- `errors.ts` — provider-neutral error contract: `ConfigurationError`
  (fatal startup) and `ApiError`/`toApiError()` implementing the
  API-ERR-01 taxonomy (`unauthenticated`, `unauthorized`, `validation`,
  `not_found`, `conflict`, `internal`; SQLSTATE 23514 check violations →
  `validation`, EXCEPT the one marked immutable-field violation
  (`IMMUTABLE_FIELD:legal_entities.entity_type` detail) → `conflict`,
  API-R0-ENT). Supabase SDK error types must not leak past adapters.
- `context.ts` — the active-firm SELECTOR holder (RLS-CTX-01/02):
  `setActiveFirm()` / `getActiveFirm()` / `clearActiveFirm()`. Untrusted
  context only — the database re-validates it against live membership on
  every statement; never use it client-side as an authorization decision.
- `auth/` — `AuthService` contract with fixture/supabase implementations
  (IMP-011).
- `tenancy/` — `TenancyService` contract (API-R0-AUTH/FRM skeleton):
  `listMyMemberships()`, `getMyProfile()`, `getProfile(userId)`; plain
  PostgREST reads under RLS in supabase mode (API-ARCH-03), synthetic
  demo data in fixture mode.
- `clientHierarchy/` — `ClientHierarchyService` contract (IMP-020,
  API-R0-CLI/ENT/REG/CON): clients, legal entities, registrations,
  contacts, client relationships + the billing identity projection.
  `fixture.ts` is the declared demo bridge (the only adapter-path file
  allowed to import fixture modules); `supabase.ts` is plain PostgREST
  under RLS + the `list_client_identities()` RPC; the selector in
  `clientHierarchyService.ts` picks once via `getDataSource()`.
- `engagements/`, `client360/`, `complianceRules/`, `complianceInstances/`,
  `tasks/`, `review/`, `alerts/`, `mywork/` — the same five-file domain
  convention (`types.ts` +
  `fixture.ts` + `supabase.ts` + `<domain>Service.ts` + `index.ts`):
  a provider-neutral service contract, a demo bridge fixture adapter, and
  a plain-PostgREST-under-RLS Supabase adapter whose privileged operations
  go through the Layer-B RPCs (never direct guarded-column writes).
  `review/`'s `subscribeReviewQueue` is the provider-neutral freshness
  subscription; the Supabase implementation is the API-RT-07 polling
  fallback (see the IMP-041 status paragraph above). `alerts/`'s
  `subscribeAlerts` is the same approved fallback for the bell badge (D2
  ruling; see the IMP-042 status paragraph). `mywork/` is read-only by
  contract (API-R0-MWK) — no write surface at all.
  NOTE the `tasks/` naming hazard: the legacy flat fixture module
  `src/data/tasks.ts` shadows the folder — import the service via the
  barrel (`@/data`), never via `@/data/tasks`.
- `../lib/supabaseClient.ts` — the ONLY browser Supabase client (lazy
  singleton; throws in fixture mode). Injects the untrusted
  `x-active-firm` selector header from `context.ts` on every request.
  Pages/components must never import it — enforced by
  `tests/unit/import-boundary.test.ts`.

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

**Current:** two tracks. The fixture/demo track remains a demo-only app —
no real credentials; all "reminders"/"emails" are simulated in the store;
fixture data is fictional client data. The Supabase Release-0 track is
live on hosted staging: real Supabase Auth (invitation-only, TOTP MFA),
RLS as the enforcement boundary, hybrid Layer-A/B/C audit, and isolated
local/staging environments — the target rules below already bind there.
Production has NOT been promoted.

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
