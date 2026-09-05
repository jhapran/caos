# CAOS — Current Engineering State

> This file is a navigation and session-handoff record only.
> Git history, checked-in specifications, migrations, executable tests,
> and harness evidence remain the authoritative sources of truth.
> A fresh agent must independently verify repository state before acting.

## 1. Last Accepted Checkpoint

- Human staging acceptance date: 2026-09-05
- Last CLOSED package: IMP-040 — Tasks, dependencies, checklists, comments
- IMP-040 implementation checkpoint: `be15229` (`feat: tasks and dependencies`)
- Git staging (`origin/staging`) contains accepted IMP-040
- `origin/main` intentionally remains unchanged at `0bb3db6`
- Production has NOT been promoted

## 2. Release-0 Progress

Formal R0 package count: 27 (per `docs/spec/12-release-0-plan.md`).

Completed (17 / 27, ≈ 63.0%):

- IMP-000…IMP-005 (Harness Engineering phase — Harness Gate PASS)
- IMP-010…IMP-014 (Identity & Tenant Foundation)
- IMP-020…IMP-022 (Core Domain)
- IMP-030, IMP-031 (Compliance Foundation)
- IMP-040 (Work Management — tasks/dependencies/checklists/comments)

Remaining formal R0 packages:

- IMP-041, IMP-042 (Work Management)
- IMP-050, IMP-051 (Automation & Deadlines)
- IMP-060, IMP-061, IMP-062 (Application Read Models)
- IMP-070, IMP-071, IMP-072 (Migration & Cutover)

## 3. Current / Next Package

- Current: IMP-040 — Tasks, dependencies, checklists, comments — CLOSED
- Next: IMP-041 — Review queue — NOT STARTED
- Next action: fresh-session contract extraction / reconciliation for
  IMP-041. IMP-041 implementation is NOT authorized yet. Entry criterion
  per `12-release-0-plan.md`: API-OQ-01 review-item vocabulary decision.

## 4. Database / Migration State (accepted staging)

- Latest migration: `20260906000000_tasks_dependencies_checklists_comments.sql`
- Hosted staging migration ledger: 8 migrations, local == remote through
  `20260906000000` (8 / 8)
- Application public tables: 18
- RLS enabled: 18 / 18
- FORCE-RLS: 15 (all tenant-owned content tables)
- Policies: 48
- IMP-040 tables: `tasks`, `task_dependencies`, `task_checklist_items`,
  `task_comments`
- Post-promotion staging row counts after hosted-probe cleanup: all four
  task-family tables = 0 — no recurrence-generated or migration-created
  rows introduced

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
- Accepted implementation checkpoint: `be15229`
- Deployment: Published / human browser acceptance PASS
- No real customer data in staging

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
- Domain-event publication for ComplianceInstance remains deferred per
  the approved automation contract (IMP-050 / AUTO-OQ-02); the same
  deferral covers `task.created` / `task.assigned` / `task.completed`
  publication (contract names only after IMP-040).
- Advisor follow-ups (non-IMP-040, pre-existing; do not treat as
  blockers): Supabase `auth_leaked_password_protection` WARN (platform
  Auth config — ops decision); performance advisors
  (`auth_rls_initplan`, `multiple_permissive_policies`) on the IMP-030
  tables `compliance_types` / `compliance_rule_versions` — none on
  IMP-040 tables.

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
