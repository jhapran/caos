# CAOS — Current Engineering State

> This file is a navigation and session-handoff record only.
> Git history, checked-in specifications, migrations, executable tests,
> and harness evidence remain the authoritative sources of truth.
> A fresh agent must independently verify repository state before acting.

## 1. Last Accepted Checkpoint

- Human staging acceptance date: 2026-09-07
- Last CLOSED package: IMP-042 — Alerts & My Work
- IMP-042 implementation checkpoint: `1f3db3e`
  (`feat: alerts and my work`)
- IMP-042 closure checkpoint: `e5937ac`
  (`docs: close IMP-042`)
- `origin/staging` contains the accepted IMP-042 closure checkpoint
- `origin/main` intentionally remains unchanged at `0bb3db6`
- Production has NOT been promoted

## 2. Release-0 Progress

Formal R0 package count: 27 (per `docs/spec/12-release-0-plan.md`).

Completed (19 / 27, 70.37%):

- IMP-000…IMP-005 (Harness Engineering phase — Harness Gate PASS)
- IMP-010…IMP-014 (Identity & Tenant Foundation)
- IMP-020…IMP-022 (Core Domain)
- IMP-030, IMP-031 (Compliance Foundation)
- IMP-040 (Work Management — tasks/dependencies/checklists/comments)
- IMP-041 (Work Management — review queue)
- IMP-042 (Work Management — alerts & My Work)

Remaining formal R0 packages:

- IMP-050, IMP-051 (Automation & Deadlines)
- IMP-060, IMP-061, IMP-062 (Application Read Models)
- IMP-070, IMP-071, IMP-072 (Migration & Cutover)

## 3. Current / Next Package

- Current: IMP-042 — Alerts & My Work — CLOSED
- Next: IMP-050 — Recurrence generation & scheduler signals — NOT STARTED
- Next action: fresh-session contract extraction / reconciliation for
  IMP-050. The IMP-050 architecture/spec amendment (2026-09-11,
  uncommitted) is APPROVED — human diff review PASSED 2026-09-12.
  IMP-050 implementation is NOT authorized yet. Entry criteria
  per `12-release-0-plan.md`: R0-D green — satisfied; AUTO-OQ-01/02
  technical validation with results recorded in `09` — **SATISFIED
  2026-09-11: AUTO-OQ-01 RESOLVED (pg_cron + hardened in-database
  scheduler/job functions; pg_net not required for R0), AUTO-OQ-02
  RESOLVED (transactional outbox), AUTO-OQ-03 RESOLVED (90-calendar-day
  configurable default look-ahead, Asia/Kolkata business-date basis,
  UTC-persisted timestamps); AUTO-SCH-02 LOCAL/HOSTED/OVERALL PASS;
  schema contracts SCH-33/34/35 recorded in `06`. Remaining gates:
  the explicit IMP-050 implementation instruction; hosted pg_cron
  `CREATE EXTENSION` (explicit human state-change gate) at
  implementation time.**

## 4. Database / Migration State (accepted staging)

- Latest migration: `20260908000000_alerts.sql`
- Hosted staging migration ledger: 10 migrations, local == remote through
  `20260908000000` (10 / 10)
- Application public tables: 21 (CURRENT deployed; **TARGET after the
  IMP-050 schema migration: 24** — SCH-33/34/35 are contract additions in
  `06` from the IMP-050 amendment, APPROVED 2026-09-12 by human diff
  review, with no migration yet)
- RLS enabled: 21 / 21
- FORCE-RLS: 18 (all tenant-owned content tables)
- Policies: 51
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
- IMP-050 owns recurrence generation

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
- **Hosted pg_cron capability (2026-09-11, AUTO-SCH-02 HOSTED PASS):**
  authorized human read-only Supabase Studio catalog queries on
  `pyrniumcjcvagjygheyu` observed `pg_available_extensions` pg_cron
  `default_version = 1.6.4`, `installed_version = NULL` ("Job scheduler
  for PostgreSQL"); versions available through 1.6.4, none installed;
  `current_setting('cron.database_name', true) = 'postgres'`. No hosted
  state was changed. **Scoped to the actual staging project only —
  production pg_cron availability is NOT claimed and remains a
  pre-cutover verification.** **pg_cron is available but NOT installed; hosted
  `CREATE EXTENSION` remains a future explicit human state-change gate.**
  Evidence artifacts: `docs/harness/auto-sch-02-probe.md` +
  `docs/harness/auto-sch-02-results.json`.
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
- `successor_instance_id` generator-time same-firm/cycle hardening is an
  IMP-050 review item.
- Recurrence generator belongs to IMP-050.
- Domain-event publication wiring remains with IMP-050; the mechanism is
  RESOLVED 2026-09-11 (AUTO-OQ-02 — transactional outbox, SCH-33):
  `compliance_instance.created` (IMP-031), `task.created` /
  `task.assigned` / `task.completed` (IMP-040), `review.submitted` /
  `review.completed` (IMP-041), and `alert.created` / `alert.resolved`
  (IMP-042) are contract names only until IMP-050 wires publication.
  The accepted API-RT-07 Review Queue polling fallback is unrelated to
  event publication and does not discharge this deferral; the IMP-042
  alert badge uses the same approved fallback (D2 ruling).
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
