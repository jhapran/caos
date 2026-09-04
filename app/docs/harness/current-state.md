# CAOS — Current Engineering State

> This file is a navigation and session-handoff record only.
> Git history, checked-in specifications, migrations, executable tests,
> and harness evidence remain the authoritative sources of truth.
> A fresh agent must independently verify repository state before acting.

## 1. Last Accepted Checkpoint

- Human staging acceptance date: 2026-09-04
- Last CLOSED package: IMP-031 — Compliance profiles & instances
- IMP-031 implementation checkpoint: `03e999d`
- Git staging (`origin/staging`) contains accepted IMP-031
- `origin/main` intentionally remains unchanged at `0bb3db6`
- Production has NOT been promoted

## 2. Release-0 Progress

Formal R0 package count: 27 (per `docs/spec/12-release-0-plan.md`).

Completed (16 / 27, ≈ 59%):

- IMP-000…IMP-005 (Harness Engineering phase — Harness Gate PASS)
- IMP-010…IMP-014 (Identity & Tenant Foundation)
- IMP-020…IMP-022 (Core Domain)
- IMP-030, IMP-031 (Compliance Foundation)

Remaining formal R0 packages:

- IMP-040, IMP-041, IMP-042 (Work Management)
- IMP-050, IMP-051 (Automation & Deadlines)
- IMP-060, IMP-061, IMP-062 (Application Read Models)
- IMP-070, IMP-071, IMP-072 (Migration & Cutover)

## 3. Current / Next Package

- Current: IMP-031 — Compliance profiles & instances — CLOSED
- Next: IMP-040 — Tasks, dependencies, checklists, comments — NOT STARTED
- Next action: fresh-session contract extraction / reconciliation for
  IMP-040. IMP-040 implementation is NOT authorized yet.

## 4. Database / Migration State (accepted staging)

- Latest migration: `20260905000000_compliance_profiles_instances.sql`
- Hosted staging migration ledger: 7 migrations, local == remote through
  `20260905000000`
- Application public tables: 14
- RLS enabled: 14 / 14
- FORCE-RLS: 11 (all tenant-owned content tables)
- Policies: 37
- IMP-031 tables: `client_compliance_profiles`, `compliance_instances`
- Post-promotion staging row counts: `client_compliance_profiles` = 0,
  `compliance_instances` = 0 — no recurrence-generated rows introduced

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
- Accepted implementation checkpoint: `03e999d`
- Deployment: Published / human browser acceptance PASS
- No real customer data in staging

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
  the approved automation contract (IMP-050 / AUTO-OQ-02).

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
