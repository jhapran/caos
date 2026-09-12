# CAOS — Current Engineering State

> This file is a navigation and session-handoff record only.
> Git history, checked-in specifications, migrations, executable tests,
> and harness evidence remain the authoritative sources of truth.
> A fresh agent must independently verify repository state before acting.

## 1. Last Accepted Checkpoint

- Human package-closure approval date: 2026-09-13
- Last CLOSED package: IMP-050 — Recurrence generation & scheduler
  signals
- IMP-050 implementation checkpoint: `b15b584`
  (`feat: implement IMP-050 recurrence automation`)
- IMP-050 closure checkpoint: this commit (`docs: close IMP-050` — the
  hash is recorded post-commit per the closure-pointer reconcile
  convention; see the IMP-042 precedent)
- IMP-050 hosted staging acceptance: PASS (see §4/§6/§6d)
- `origin/main` intentionally remains unchanged at `0bb3db6`
- Production has NOT been promoted

## 2. Release-0 Progress

Formal R0 package count: 27 (per `docs/spec/12-release-0-plan.md`).

Completed (20 / 27, 74.07%):

- IMP-000…IMP-005 (Harness Engineering phase — Harness Gate PASS)
- IMP-010…IMP-014 (Identity & Tenant Foundation)
- IMP-020…IMP-022 (Core Domain)
- IMP-030, IMP-031 (Compliance Foundation)
- IMP-040 (Work Management — tasks/dependencies/checklists/comments)
- IMP-041 (Work Management — review queue)
- IMP-042 (Work Management — alerts & My Work)
- IMP-050 (Automation & Deadlines — recurrence generation & scheduler
  signals; human package-closure approval 2026-09-13)

Remaining formal R0 packages:

- IMP-051 (Automation & Deadlines — deadline materialization & alert
  evaluation)
- IMP-060, IMP-061, IMP-062 (Application Read Models)
- IMP-070, IMP-071, IMP-072 (Migration & Cutover)

## 3. Current / Next Package

- Current: none in flight — IMP-050 — Recurrence generation &
  scheduler signals — CLOSED (human package-closure approval
  2026-09-13). Acceptance record: implementation HUMAN ACCEPTED;
  independent final implementation reviewer verdict PASS — READY FOR
  HUMAN IMPLEMENTATION ACCEPTANCE; final local Harness Gate PASS 23/23;
  automation integration 43/43, schema 199/199, RLS 303/303, audit
  111/111; hosted staging acceptance PASS (see §4/§6/§6d).
- Next: IMP-051 — Deadline materialization & alert evaluation — NOT
  STARTED and NOT AUTHORIZED (begins only with an explicit
  implementation instruction; IMP-051 owns the
  `sched.alerts.evaluate` registration; IMP-051 is alerts/deadline
  materialization, NOT recurrence-rule definition).
- Historical pre-implementation record (kept for rationale): the
  IMP-050 architecture/spec amendment was APPROVED 2026-09-12 (human
  diff review PASS); the IMP-050 implementation contract / contract
  closure was HUMAN APPROVED 2026-09-12 (final independent
  contract-closure re-review: PASS — findings NONE) and CLOSED by
  human rulings 2026-09-12 (recorded normatively in `09` as
  AUTO-SCH-04/05/06/07 and the TEST-AUTO-05/06 clarification;
  reconciled in `06`/`10`/`11`/`12`/`13`): cron registration ownership
  (AUTO-SCH-04 — IMP-050 registers `sched.recurrence.evaluate` + ONE
  infrastructure outbox-drain job; IMP-051 owns `sched.alerts.evaluate`;
  `sched.login_mirror.run` retains its deferred ownership outside
  IMP-050; the drain is infrastructure, not a fourth scheduler signal);
  cadences (AUTO-SCH-05 — recurrence once daily 00:30 Asia/Kolkata;
  outbox drain once per minute via a stable named, idempotent
  pg_cron registration); the pg_cron installation/migration boundary
  (AUTO-SCH-06 — version-controlled
  `CREATE EXTENSION IF NOT EXISTS pg_cron` in the IMP-050 migration);
  R5 — the recurrence cron uses `0 19 * * *` interpreted in GMT
  (= 00:30 Asia/Kolkata, fixed UTC+05:30) with the fail-closed
  `current_setting('cron.timezone', true) = 'GMT'` precondition
  (AUTO-SCH-07; CAOS never mutates `cron.timezone`); R6 — the hosted
  pg_cron state change enters ONLY through the version-controlled
  migration ledger (satisfied — see §4); R7 — SCH-12
  `successor_instance_id` structurally same-firm via composite self-FK
  (implemented); R8 — post-IMP-050 catalog targets 24 tables / RLS
  24/24 / FORCE RLS 20 / policies 51 (all reached — see §4). Entry
  criteria (satisfied before implementation): R0-D green;
  AUTO-OQ-01/02/03 RESOLVED 2026-09-11 (pg_cron + hardened in-database
  scheduler/job functions; transactional outbox; 90-calendar-day
  configurable look-ahead, Asia/Kolkata business-date basis,
  UTC-persisted timestamps); AUTO-SCH-02 LOCAL/HOSTED/OVERALL PASS
  (evidence `docs/harness/auto-sch-02-probe.md` +
  `docs/harness/auto-sch-02-results.json`); schema contracts
  SCH-33/34/35 recorded in `06`.

## 4. Database / Migration State (accepted staging)

- Latest migration: `20260912000000_recurrence_scheduler.sql` (IMP-050)
- Hosted staging migration ledger: 11 migrations, local == remote
  through `20260912000000` (11 / 11)
- Application public tables: 24 (CURRENT on hosted staging and local —
  SCH-33/34/35 landed with the IMP-050 migration; the Ruling
  2026-09-12 R8 target is reached)
- RLS enabled: 24 / 24
- FORCE-RLS: 20 (SCH-33 and SCH-35 forced; SCH-34 enabled but NOT
  forced; Ruling 2026-09-12, R8)
- Policies: 51 (unchanged through IMP-050 — RLS-EVO-01/SJR-01/SDL-01
  are zero-browser-grant postures, R8)
- IMP-050 automation tables: `event_outbox` (SCH-33),
  `scheduler_job_runs` (SCH-34), `scheduler_dead_letters` (SCH-35) —
  hosted catalog security acceptance PASS: zero forbidden
  automation-table privileges, zero forbidden owner-only function
  EXECUTE grants
- Hosted pg_cron: INSTALLED, version 1.6.4, via the version-controlled
  IMP-050 migration (`CREATE EXTENSION IF NOT EXISTS pg_cron`; no
  Dashboard/manual out-of-chain enablement — Ruling R6 satisfied);
  `cron.timezone = GMT` and `cron.database_name = postgres` verified
  hosted
- Hosted cron registrations — exactly two, both IMP-050-owned:
  `outbox.drain` (`* * * * *`) and `sched.recurrence.evaluate`
  (`0 19 * * *` GMT = 00:30 Asia/Kolkata next business-day
  interpretation per contract); observed `outbox.drain` runs succeeded.
  No alert-scheduler or login-mirror cron is owned by IMP-050.
- Hosted data stability at acceptance: `compliance_instances` 0,
  undelivered outbox rows 0, `scheduler_dead_letters` 0
- IMP-042 tables: `alerts` (policy `alerts_select_scoped`) and
  `alert_rules` (policy `alert_rules_select_scoped`) — single scoped
  SELECT policies; every write goes through the Layer-B definer commands
- No realtime-publication migration exists; `supabase_realtime` publishes
  zero public tables (the IMP-042 alert bell uses the approved API-RT-07
  polling fallback — D2 ruling; see §6b/§6c)
- Post-promotion staging row counts after hosted/browser fixture
  teardown: `alerts`, `alert_rules`, and all IMP-042 probe/browser
  fixture rows = 0 — no probe, fixture, or migration-created rows remain;
  immutable audit_log evidence retained (final browser teardown reported
  audit_rows_retained = 62)

## 5. Compliance Governance State

- ComplianceTypes: 14 system/reference types (13 statutory, 1
  non_statutory; all `firm_id IS NULL`; no payroll type)
- ComplianceRuleVersions: 14, all `draft` (13 `pending`, 1
  `not_required`)
- Statutory ACTIVE: 0 — production statutory activation remains gated;
  not approved by browser/application
- Profiles do NOT pin RuleVersions; instances pin RuleVersion provenance
- IMP-050 has implemented the recurrence engine (CLOSED 2026-09-13):
  the generator consumes approved ACTIVE rule versions. CAOS stores the
  recurrence-rule framework and draft reference rules; final statutory
  rules still require external practicing-CA/compliance-domain
  validation and controlled activation — statutory rule versions remain
  draft/pending (0 ACTIVE). IMP-051 is alerts, not recurrence-rule
  definition.

## 6. Staging State

- Supabase staging project ref (not a secret): `pyrniumcjcvagjygheyu`
- Netlify staging: `staging.caos.datafabric.in` (tracks Git branch
  `staging`; `VITE_DATA_SOURCE=supabase` set in site environment)
- Accepted implementation checkpoint: `1f3db3e` (deployed bundle proven
  byte-identical to a clean local build of that Git HEAD with the staging
  environment)
- Deployment: Published / human browser acceptance PASS 2026-09-07
  (44/44 browser-gate checks: role-scoped My Work per persona, TEST-E2E-07
  task transition + authorized manager reassignment, TEST-E2E-09
  four-bucket rendering, alert bell RLS visibility incl. truthful known
  zero, API-RT-07 polling invalidation without reload, /alerts ModuleGate
  preservation, network/console isolation)
- No real customer data in staging
- **Hosted pg_cron state (IMP-050 — CLOSED 2026-09-13):** pg_cron is
  INSTALLED on hosted staging — installed version 1.6.4 — via the
  version-controlled migration `20260912000000_recurrence_scheduler.sql`
  (`CREATE EXTENSION IF NOT EXISTS pg_cron`; no Dashboard/manual
  extension drift — Ruling R6 satisfied). `cron.timezone = GMT` and
  `cron.database_name = postgres` verified hosted. Exactly two cron jobs
  are active and exactly as expected: `outbox.drain` (every minute,
  `* * * * *`) and `sched.recurrence.evaluate` (`0 19 * * *` GMT —
  00:30 Asia/Kolkata next business-day interpretation per contract);
  observed `outbox.drain` runs succeeded. **Scoped to the actual staging
  project only — production pg_cron availability/installation is NOT
  claimed and remains a pre-cutover verification.**
  Historical (pre-installation, 2026-09-11, AUTO-SCH-02 HOSTED PASS):
  authorized human read-only Studio catalog queries then observed pg_cron
  available (`default_version = 1.6.4`) but NOT installed
  (`installed_version = NULL`); that probe changed no hosted state, and
  the local baseline it temporarily disturbed was restored (Ruling
  AUTO-SCH-06). Evidence artifacts: `docs/harness/auto-sch-02-probe.md`
  + `docs/harness/auto-sch-02-results.json`.
- **Hosted IMP-050 acceptance (CLOSED 2026-09-13):** hosted SQL/catalog
  security acceptance PASS — zero forbidden automation-table privileges;
  zero forbidden owner-only function EXECUTE grants;
  `requeue_dead_letter` service_role allowed and
  public/anon/authenticated denied; `immediate_automation_correlation`
  is SECURITY INVOKER with `search_path=''`. Hosted API/PostgREST
  acceptance PASSED using an existing dedicated staging probe account
  after an explicitly human-authorized password reset through the
  supported Supabase Admin API — no credential/key/password is recorded
  in the repository or this file. Browser/API denial proof:
  authenticated requests denied (403) and anonymous requests denied
  (401) for `event_outbox`, `scheduler_job_runs`,
  `scheduler_dead_letters` and the protected RPC paths
  `immediate_automation_correlation` / `requeue_dead_letter`. This was a
  NEGATIVE PostgREST/RPC security proof — there is NO IMP-050
  UI/browser product flow. No business data was created by the hosted
  API acceptance. The local gitignored probe credential file is mode
  600 and shell-syntax PASS; its values are never recorded.
- IMP-050 ships no browser surface; Netlify staging state is unchanged
  from IMP-042 closure (bundle checkpoint `1f3db3e` remains the latest
  published UI bundle).
- Dedicated staging test identities (durable testing note): the 8
  synthetic `imp041-*` Supabase Auth users remain for future acceptance
  gates, each with a verified TOTP factor enrolled during the IMP-041
  browser gate through the supported UI flow. Correction to earlier
  process reporting: an intermediate gate report claimed MFA was
  untouched; that was inaccurate for these dedicated synthetic identities
  (verified factors WERE enrolled on them). Protected human MFA was
  untouched throughout. No passwords, TOTP secrets, or codes are recorded
  in the repository. The original `stg-*` baseline identities are
  preserved.

## 6a. Work-Management Enforcement Facts (IMP-040 — durable)

- Task lifecycle changes are RPC-only through `transition_task`; direct
  browser `tasks.status`/`waiting_reason` writes are closed (column-pinned
  grants + write guard).
- Dependency graph mutations are controlled commands
  (`add_task_dependency` / `remove_task_dependency`); direct table mutation
  is closed; a manager command requires BOTH tasks in scope; acyclicity is
  race-safe (firm-scoped transaction advisory lock + recursive check).
- Dependency SELECT requires BOTH endpoint tasks visible (API-ERR-02 /
  RLS-A-03 — either-endpoint visibility was rejected as an
  endpoint-identity leak and is regression-pinned).
- Task four-eyes (RLS-4EY-03): instance-linked tasks inherit it from the
  ComplianceType; reviewer-only `submitted → approved/returned` has NO
  privileged-rank bypass; `returned` creates its reviewer comment
  atomically with the transition.
- Comments are append/retract semantics only (immutable body/author/task,
  author-only retraction, no edit/delete).
- Same-JWT membership suspension/removal is enforced on the next request
  through live membership lookup (DEC-J) — verified locally and on hosted
  staging.
- Audit remains layered: Layer A for ordinary writes, Layer B for
  controlled commands (no double logging; security-significant denials
  audited per AUD-FAIL-01).
- IMP-040 did NOT implement task/My Work UI (TEST-E2E-07 → IMP-042),
  recurrence, or event publication (→ IMP-050).
- Hosted-probe process note: the IMP-040 hosted verification used
  disposable synthetic auth users created through the privileged CLI SQL
  path because public signup is intentionally disabled; all were removed
  and no existing identity/MFA was touched. This was a one-off, NOT a new
  standard path — future hosted probes must use a supported authorized
  test-user provisioning mechanism or request human provisioning; if
  unavailable, STOP. Do not normalize direct auth-schema insertion.

## 6b. Review-Queue Enforcement & Freshness Facts (IMP-041 — durable)

- `review_items` (SCH-17) role scope (RLS-RVW-01,
  `review_items_select_scoped`): super_admin/partner firm-wide; manager
  portfolio + direct task assignee/reviewer; senior/article own
  submissions; billing none; cross-firm zero.
- Browser table grants are SELECT-only; INSERT/UPDATE/DELETE are closed.
  All writes go through the Layer-B definer commands `submit_review_item`
  and `decide_review_item`.
- API-ERR-02 authorization-before-disclosure: existing-but-hidden and
  nonexistent ReviewItems return one identical `not_found`; authorization
  precedes vocabulary, lifecycle, rationale, and replay evaluation (no
  existence/status/legality/replay oracle).
- Four-eyes (RLS-4EY-04): the decider's live membership must differ from
  the submitter's — no rank bypass (manager/partner/super_admin
  self-decision all denied).
- A task-linked `returned` decision additionally requires the assigned
  Task reviewer (intersection with IMP-040 task review authority — no
  partner/super_admin/other-manager bypass). The linked return is atomic:
  ReviewItem `returned` + Task `returned` + exactly one immutable
  TaskComment (body = decision rationale, correct actor) +
  `review_item.decided` + `task.transition` audit in one transaction; an
  illegal Task state rolls the entire operation back.
- Linked-subject integrity: `client_id` is server-derived from the linked
  Task/ComplianceInstance; forged client or mismatched task/instance
  bindings are rejected.
- Audit actions: `review_item.submitted` / `review_item.decided` /
  `review_item.submit_denied` / `review_item.decide_denied` — server-derived
  actor, old/new snapshots, no Layer-A/Layer-B duplication; truly
  nonexistent objects carry no invented object audit.
- Decisions require a non-empty rationale; terminal keyless re-decision is
  a `conflict`; keyed state-based retry returns `already_applied` with no
  duplicate side effects (API-MUT-03).
- Provider-neutral `reviewService` behind `@/data` (`src/data/review/`);
  the Review Queue UI is data-backed in Supabase mode (no fixture values,
  no demo-role controls; senior/article submit against assigned work only,
  no client enumeration; role-truthful decision controls).
- Queue freshness (API-RT-01/03/05) uses the APPROVED API-RT-07 POLLING
  FALLBACK: authenticated postgres_changes cannot carry the R0
  `x-active-firm` request-header context through Realtime's per-row RLS
  evaluation (executable differential harness proof, 2026-09-06).
  `subscribeReviewQueue` polls every 15 seconds
  (`REVIEW_QUEUE_POLL_INTERVAL_MS` — an implementation parameter, NOT a
  product SLA); each tick is a bare invalidation and the authoritative
  state is always re-read through `listReviewItems` under RLS.
- In the accepted IMP-041 implementation there is NO Review Queue
  postgres_changes dependency and NO hosted realtime-publication
  migration. This records the current accepted staging state at IMP-041
  closure — it is NOT a permanent architecture invariant and does not
  constrain IMP-042 Alerts (the approved contract reserves Alerts as an
  R0 realtime surface in its owning package). Domain-event publication
  (`review.submitted` / `review.completed`) remains deferred to IMP-050
  and is NOT the same thing as this polling fallback.
- Harness Gate: 20 / 20 phases PASS.

## 6c. Alerts & My Work Enforcement Facts (IMP-042 — durable)

- `alerts` (SCH-18) / `alert_rules` (SCH-19): RLS enabled AND forced;
  single scoped SELECT policies (`alerts_select_scoped` /
  `alert_rules_select_scoped`); browser table grants are SELECT-only —
  no browser INSERT/UPDATE/DELETE exists on either table.
- Alert read scope (RLS-ALR-01): super_admin/partner/manager firm-wide;
  senior/article assigned-work alerts at EXACT-INSTANCE granularity
  (human-ruled at IMP-042 pre-checkpoint correction 2026-09-06):
  instance-linked requires the caller's live membership as
  assignee/reviewer of THAT instance or of an existing task tied to it;
  client-level (instance NULL, client set) requires assigned work on that
  client; a both-NULL alert is invisible to senior/article; billing none;
  cross-firm zero.
- Alert status moves are command-only via `acknowledge_alert` /
  `snooze_alert` / `resolve_alert` (manager+, NO AAL2 per RLS-AAL-02).
  The human-ruled SCH-18 manual transition matrix: acknowledge from
  active/snoozed (clears the open snooze; a prior acknowledgement's
  stamps are preserved); snooze from any non-resolved state with a
  strictly-future `snoozed_until`; resolve from
  active/acknowledged/snoozed with `resolution_type='manual'`; the
  explicit-ack gate (a linked rule with `requires_explicit_ack=true`
  requires a prior acknowledgement before resolve); `resolved` is
  terminal — no reopen. `resolution_type='auto'` is reserved for the
  IMP-051 evaluator; no R0 command can write it. State-based mutation-key
  idempotency: replays return `already_applied` with no re-stamp and no
  second audit (API-MUT-03).
- API-ERR-02 authorization-before-disclosure: unauthorized-existing and
  nonexistent alerts return one identical `not_found` body (proven
  byte-identical on hosted staging); existing-but-invisible probes are
  audited as denials (AUD-FAIL-01); nonexistent ids are un-audited.
- Alert-rule administration (RLS-ARL-01 + RLS-AAL-01):
  `create_alert_rule` / `update_alert_rule` require a live same-firm
  super_admin/partner membership AND an AAL2 session; manager is
  read-only (denied `unauthorized`); SCH-19 `(firm_id, rule_key)`
  uniqueness surfaces as a `conflict` and is audited as a denial.
- Snooze expiry is a READ derivation only (SCH-18): IMP-042 performs NO
  expiry writes and there is no scheduler; a persisted `snoozed` row past
  `snoozed_until` reads adapter-side as `acknowledged` (when
  `acknowledged_at IS NOT NULL`) else `active` (TEST-API-18).
- Alert generation/evaluation/dedupe/auto-resolution is NOT implemented
  (IMP-051); NO alert-rule seed rows or thresholds exist (D3 ruling —
  AUTO-OQ-04 stays open); `alert.created`/`alert.resolved` publication is
  deferred to IMP-050 (mechanism RESOLVED 2026-09-11 — AUTO-OQ-02
  transactional outbox, SCH-33; wiring lands with IMP-050).
- My Work (`/my-work`, live in Supabase mode): DEC-L personal scope — an
  item is the caller's when their live ACTIVE membership is the task's
  assignee or reviewer; standalone returned ReviewItems surface only for
  their own submitter with the contract next_action "Address reviewer
  feedback"; a task-linked returned item claims its canonical task and is
  never double-surfaced. Billing/non-staff receive the empty contract
  (never an error — API-ERR-02 collection semantics). Buckets
  Today/This Week/Waiting/Returned with single-bucket precedence
  (Returned → Waiting → Today → This Week) against the real Asia/Kolkata
  business date (TEN-22). Read architecture: plain RLS reads composed
  behind `@/data` (`src/data/mywork/`) — NO aggregate SECURITY DEFINER
  RPC (DM-X-02 precedent). Task status changes from My Work go through
  `transition_task` only; reassignment is offered manager+ and enforced
  server-side within portfolio scope (RLS-TSK-01) — an out-of-portfolio
  manager update is denied (browser-observed 403 during the IMP-042 gate,
  then re-proven green with a portfolio-authorized fixture).
- The existing `/alerts` page remains behind ModuleGate (D1 ruling) — NOT
  live-wired in IMP-042. The alert bell badge reads the RLS-filtered
  active count through `alertsService.listAlerts`; freshness via
  `subscribeAlerts` (the approved API-RT-07 polling fallback — bare
  invalidation + authoritative re-read under RLS; the interval is an
  implementation parameter, NOT a product SLA). A zero visible count is a
  truthful known zero ("0 active alerts", no badge bubble); a failed read
  renders no badge (truthful unknown) — never a fabricated zero.
- Hosted/browser proof (2026-09-06/07): authenticated 60-check probe PASS
  60/60 with cohort-only synthetic identities (one probe-oracle miscount
  — `alert_rule.create_denied` expectation — was corrected and re-proven;
  test-oracle defect, NOT an implementation defect); browser acceptance
  PASS 44/44. All synthetic probe/browser fixtures torn down; immutable
  audit_log evidence retained.
- Harness Gate: 22 / 22 phases PASS.

## 6d. Recurrence & Scheduler Enforcement Facts (IMP-050 — durable; CLOSED 2026-09-13)

- Automation tables `event_outbox` (SCH-33), `scheduler_job_runs`
  (SCH-34), `scheduler_dead_letters` (SCH-35): RLS enabled 24/24
  catalog-wide (FORCE RLS on SCH-33/SCH-35; SCH-34 enabled but NOT
  forced, Ruling R8); browser roles have no automation-table privileges
  — access is service/cron-side only.
- Exactly two IMP-050 cron registrations: `outbox.drain`
  (`* * * * *`, timezone-independent infrastructure — NOT a fourth
  scheduler signal, AUTO-SCH-04) and `sched.recurrence.evaluate`
  (`0 19 * * *` interpreted in GMT = once daily 00:30 Asia/Kolkata,
  fixed UTC+05:30), under the fail-closed
  `current_setting('cron.timezone', true) = 'GMT'` precondition — CAOS
  never mutates `cron.timezone` (Ruling R5/AUTO-SCH-07). IMP-051 owns
  the `sched.alerts.evaluate` registration; `sched.login_mirror.run`
  stays outside IMP-050.
- Scheduler security never relies on RLS: pg_cron execution was proven
  BYPASSRLS-capable (AUTO-SCH-03); firm boundaries are enforced
  explicitly in scheduler logic, and anon/authenticated have no
  scheduler execution capability. The SCH-12 `successor_instance_id`
  linkage is structurally same-firm via the composite self-FK
  `(firm_id, successor_instance_id)` → `compliance_instances(firm_id,
  id)` (Ruling R7); the generator additionally enforces valid
  successor/cycle semantics.
- The R0 registered production outbox consumer set may be empty;
  "delivered" means drain-completion, not external delivery. The
  TEST-AUTO-05/06 consumer / failure-injection strategy is harness-only
  — no production outbox consumer was invented.
- Dead-letter manual recovery is service-only via
  `requeue_dead_letter(uuid,text)` — browser roles have no execute.
  `immediate_automation_correlation` is SECURITY INVOKER with
  `search_path=''`.
- Recurrence configuration: 90-calendar-day configurable look-ahead
  (AUTO-OQ-03), Asia/Kolkata business-date basis, UTC-persisted
  timestamps.
- There is NO IMP-050 UI/browser product flow; the hosted browser-path
  acceptance was a negative PostgREST/RPC security proof
  (authenticated 403 / anonymous 401 on the automation tables and
  protected RPC paths).
- Statutory posture unchanged: CAOS stores the recurrence-rule
  framework and draft reference rules; IMP-050 implements the engine
  consuming approved ACTIVE rules; draft statutory rule versions remain
  pending external practicing-CA/compliance-domain validation and
  controlled activation (OPS-OQ-04 stays a production activation
  blocker). IMP-051 is alerts — not recurrence-rule definition.
- Local acceptance: final Harness Gate PASS 23/23 phases; automation
  integration 43/43; schema integration 199/199; RLS 303/303; audit
  111/111; catalog 24 public app tables / RLS 24/24 / FORCE RLS 20 /
  policies 51. Independent final implementation reviewer verdict:
  PASS — READY FOR HUMAN IMPLEMENTATION ACCEPTANCE; implementation
  HUMAN ACCEPTED; human package-closure approval 2026-09-13 — CLOSED.
- Production promotion is NOT part of IMP-050 closure and remains NOT
  authorized; no production verification is claimed.

## 7. Permanent Architecture Boundaries

- Data flow: React → `@/data` → fixture OR Supabase adapter. No direct
  Supabase calls from React components (enforced by import-boundary test).
- Shared-schema multi-tenancy; Postgres RLS is the enforcement boundary.
- Live membership authorization; the active-firm selector is untrusted
  context, never authorization.
- Migrations (`supabase/migrations/`) are the schema source of truth.
- Local / staging / production environments remain isolated.
- Provider-neutral AI boundary (provider selection deferred).
- No real customer data in staging.

## 8. Permanent Security Boundaries

- Never scrape OS keyrings.
- Never retrieve management/service credentials merely for tests.
- Never generate/change DB passwords to make tests pass.
- Never delete/mutate human MFA to make tests pass.
- Never expose credentials in logs/reports.
- No blind hosted promotion.
- No production/main push without explicit human approval.
- Security-critical implementer ≠ reviewer where practical.
- Human approval before implementation checkpoint commit.
- Flow: local → review → commit → staging → human acceptance.

## 9. Known Open / Deferred Items

- DEC-P production hosting/residency decision remains gated.
- Production statutory rule activation requires external/domain approval.
- OPS-OQ-04 positive system/default statutory activation operator path
  remains deferred.
- MIG-OQ-04 historical back-materialization depth remains unresolved for
  production onboarding; non-blocking for current schema.
- `successor_instance_id` generator-time same-firm/cycle hardening —
  **RESOLVED BY RULING 2026-09-12 (R7; kept for history, no longer an
  open review item):** successor linkage is structurally same-firm via
  the composite self-FK `(firm_id, successor_instance_id)` →
  `compliance_instances(firm_id, id)` (contract recorded in `06` SCH-12;
  the FK landed with the IMP-050 implementation migration); the generator
  function logic additionally enforces valid successor/cycle semantics;
  the boundary never relies on RLS.
- Recurrence generator: implemented in IMP-050 (CLOSED 2026-09-13 —
  see §6d).
- Domain-event publication: the mechanism is RESOLVED 2026-09-11
  (AUTO-OQ-02 — transactional outbox, SCH-33) and IMPLEMENTED by
  IMP-050 (CLOSED 2026-09-13 — see §6d): `event_outbox` +
  `scheduler_job_runs` + `scheduler_dead_letters` with the
  `outbox.drain` cron; "delivered" means drain-completion, not external
  delivery, and the R0 registered production outbox consumer set may be
  empty. `compliance_instance.created` (IMP-031), `task.created` /
  `task.assigned` / `task.completed` (IMP-040), `review.submitted` /
  `review.completed` (IMP-041), and `alert.created` / `alert.resolved`
  (IMP-042) are the contract event names on the outbox path. The
  accepted API-RT-07 Review Queue polling fallback is unrelated to
  event publication; the IMP-042 alert badge uses the same approved
  fallback (D2 ruling).
- **Scheduler execution-context security finding (2026-09-11, AUTO-SCH-03,
  local probe):** pg_cron executes as `postgres` (rolsuper=false,
  rolbypassrls=true); FORCE RLS did not constrain the cron-fired
  SECURITY INVOKER path. Scheduler isolation must NOT rely on RLS;
  scheduler functions enforce firm boundaries explicitly; anon/
  authenticated have no scheduler execution capability; scheduler writes
  carry system/service audit context + per-run correlation identity.
- AUTO-OQ-04 (which alert rules ship enabled / default thresholds)
  remains OPEN — IMP-042 shipped NO alert-rule seeds (D3 ruling);
  product input is needed before seed enablement (IMP-051).
- Alert generation/evaluation/dedupe/auto-resolution and the snooze-expiry
  scheduler belong to IMP-051; IMP-042 shipped persistence, manual
  transitions, and the My Work surface only.
- Advisor follow-ups (non-IMP-040/IMP-041, pre-existing; do not treat as
  blockers): Supabase `auth_leaked_password_protection` WARN (platform
  Auth config — ops decision); performance advisors
  (`auth_rls_initplan`, `multiple_permissive_policies`) on the IMP-030
  tables `compliance_types` / `compliance_rule_versions` — none on
  IMP-040/IMP-041 tables. The IMP-041 hosted advisor run (2026-09-06)
  found 0 new ERRORs (security 0 ERROR / 21 WARN; performance 0 ERROR /
  5 WARN — all pre-existing known findings).

## 10. Fresh Session Bootstrap

1. Read `AGENTS.md`.
2. Read `docs/harness/current-state.md` (this file).
3. Run git branch/status/HEAD checks.
4. Verify current staging/main refs independently.
5. Read `docs/spec/00-index.md`.
6. Read the current package card in `docs/spec/12-release-0-plan.md`.
7. Read every specification referenced by that package.
8. Inspect relevant migrations/tests.
9. Build the package contract checklist.
10. Report contradictions before implementation.
11. Never rely on chat memory over repository evidence.

## 11. Update Policy

Update `current-state.md` only at meaningful approved package boundaries,
staging acceptance, or material environment/governance changes. Do NOT
update it for every small implementation edit.
