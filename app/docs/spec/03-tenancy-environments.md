# 03 — Tenancy & Environments

- **Status:** Draft (Batch 2 — revised per review; awaiting approval)
- **Approval status:** Not approved

## Purpose

Defines the production tenancy architecture (shared schema + RLS, DEC-E) and
the environment strategy (local / staging / production, DEC-D) including
isolation, migration promotion, secrets principles, support-access
principles, provisional resilience targets, and the fixture/demo data-source
strategy. This document is the tenancy classification authority: it decides
which entities carry `firm_id` and which are deliberate exceptions.

## Scope

- Tenant-owned vs global vs system-default data classification.
- Coexistence of system defaults and firm overrides.
- Environment definitions, isolation, and promotion flow.
- Secrets/configuration principles and service-role restrictions.
- Fixture/demo data-source strategy.
- Break-glass support-access principles and provisional RPO/RTO targets.

## Non-goals

- No RLS policy definitions (`05-authorization-rls.md`).
- No physical schema (`06-database-schema.md`).
- No CI/CD pipeline design or detailed backup procedures
  (`13-operations-observability.md`).
- No provisioning is performed or implied; production provisioning requires
  explicit human approval after data-residency/contractual review (DEC-P).

## Requirements

### Tenancy model

- **TEN-01:** Tenancy is shared-schema PostgreSQL with Row Level Security as
  the isolation mechanism (DEC-E). One database hosts all firms; every query
  path is constrained by RLS.
- **TEN-02:** Every tenant-owned operational table carries a mandatory
  `firm_id` column. Tenant ownership is determined by the entity catalogue in
  `02-domain-model.md`, not by a literal "every table" rule.

### Tenant-owned entities (firm_id REQUIRED)

Per DM-01…DM-26, tenant-owned: Client (DM-04), LegalEntity (DM-05),
Registration (DM-06), ClientRelationship (DM-07), Contact (DM-08),
Engagement (DM-09), ClientComplianceProfile (DM-11), ComplianceInstance
(DM-12), Task (DM-13), TaskChecklistItem (DM-14), TaskComment (DM-15),
Document (DM-16), DocumentVersion (DM-17), DocumentRequest (DM-18),
ReminderSequence (DM-19), Communication (DM-20), ReviewItem (DM-21),
Alert (DM-22), Notification (DM-23), Invoice (DM-24), AuditLog (DM-25),
AIOutput (DM-26), firm-owned ComplianceType override rows (DM-10), and the
client-side of portal access mappings (DM-08, deferred).

- **TEN-03:** `firm_id` on these tables is NOT NULL with no default other
  than the tenant-resolution mechanism chosen in `05` (DEC-J spike).

### Identity / global entities (no firm_id)

- **TEN-04:** The following are deliberately global; giving them `firm_id`
  would create duplication or incorrect modelling:
  - **Profile / User (DM-02)** — a person may belong to several firms and
    hold client-access mappings independently (DM-X-05); the profile is
    identity, not tenant data.
  - **FirmMembership (DM-03)** — the staff tenancy edge itself; it *carries*
    the (user, firm, role) mapping and is protected by self-referential RLS.
  - **Firm (DM-01)** — is the tenant.
  - Supabase `auth.*` schema — platform-managed, never modified.
- **TEN-05:** No operational (client/compliance/task/…) data may ever be
  stored on global entities.

### System defaults and firm overrides

- **TEN-06:** ComplianceType (DM-10) is the designated reference-data
  exception: rows with NULL `firm_id` are system defaults visible to all
  firms; rows with `firm_id` are firm-owned.
- **TEN-07:** Coexistence rule: a firm-owned row with the same type key
  **shadows** the system default for that firm only. Resolution order for any
  read: firm override → system default. Firm rows never modify shared rows.
- **TEN-08:** System-default rows are writable only via migrations/seeds
  (service role in deployment context), never via application runtime writes.
- **TEN-09:** No other entity may use the NULL-`firm_id` pattern without an
  amendment to this spec.

### Tenant-resolution and AI-context boundary

- **TEN-10:** Tenant isolation applies equally to AI context (PRD §125):
  prompts, embeddings, and AI outputs must be assembled from single-firm data
  only. This binds `20-ai-services.md` when authored.
- **TEN-11:** Cross-tenant queries are permitted only to (a) the platform
  operator via the controlled support mechanism (TEN-23), and (b) anonymised
  benchmark features (future). No application code path available to tenant
  users may bypass RLS (service-role key never reaches browsers — TEN-17).

### Environments

- **TEN-12: Local development.** Supabase CLI local stack per developer.
  Synthetic/seed data only. Migrations authored here, committed to git.
- **TEN-13: Staging.** One separate Supabase cloud project. Synthetic or
  sanitized data only — **real customer data must never be copied to
  staging or local.** Used for pre-production verification and pilot-onboarding
  rehearsal.
- **TEN-14: Production.** One separate Supabase cloud project holding real
  customer data. Engineering default region: **Mumbai (India)** (DEC-P).
  **The production project must not be provisioned until explicit human
  approval is given after data-residency/contractual review.** This spec
  authorises no provisioning.
- **TEN-15: Isolation.** The three environments share no credentials, no
  database links, and no storage buckets. Environment identity is selected by
  configuration, never by code branching.

### Migration promotion flow

- **TEN-16:** Schema changes travel as migration files in git:
  `local (author + verify) → staging (apply + verify) → production (apply
  during controlled window)`. No schema change is applied directly to
  staging or production outside this flow. Rollback strategy is specified in
  `13-operations-observability.md`.

### Secrets and configuration principles

- **TEN-17: Client-safe vs server-only.** The browser bundle may contain only
  the project URL and the anon (publishable) key. The service-role key, Edge
  Function secrets, AI provider keys, and any webhook secrets are server-only
  (Supabase secrets store / Edge Function env), never committed, never in the
  repo, never in client code.
- **TEN-18:** Service-role credentials are used only in: (a) Edge Functions,
  (b) deployment/seed scripts run by authorised operators. They bypass RLS by
  design and are therefore treated as production-grade secrets in every
  environment. **Routine support access must not use service-role credentials
  silently — see TEN-23.**
- **TEN-19:** Configuration is injected per environment (env files excluded
  from git / secret stores); no environment may read another environment's
  configuration. No credentials appear in any spec document.

### Fixture / demo data-source strategy

- **TEN-20:** The existing fixture data layer remains a first-class parallel
  data source (DEC-T item 24), selected by an explicit `DATA_SOURCE`
  configuration (`fixture | supabase`); UI imports remain `@/data` only.

| Environment / deployment | `DATA_SOURCE` |
|---|---|
| Demo environment/deployment (sales/demo) | `fixture` |
| Local production-development | `supabase` |
| Staging | `supabase` |
| Production | `supabase` |

- **TEN-21:** Fixture mode is a **demo/sales mode only** — it must never
  become the default data source of the real production application
  (TEN-OQ-01 resolution). The existing polished fixture demo must remain
  usable throughout migration. Exact deployment mechanics belong to
  `10-migration-seed.md` and `13-operations-observability.md`.
- **TEN-22:** Before migration work begins, the demo clock must be pinned
  (fixtures currently use a live `new Date()` clock, drifting from pinned
  fixture dates) so fixture mode and seeded mode reconcile. Specified in
  `10-migration-seed.md`.

### Support access (break-glass) principles

- **TEN-23:** Customer impersonation is **not** implemented in Release 0.
  Production support access uses a controlled break-glass mechanism with:
  explicit reason recorded; least privilege; time-bound access; an audit
  record containing actor identity, firm/customer context, and timestamp; and
  no silent use of service-role credentials. Exact implementation is owned by
  `05-authorization-rls.md` and `08-audit-security.md` (Batch 3).

### Provisional resilience targets

- **TEN-24:** Provisional Release 0 engineering targets (not contractual
  SLAs): **RPO ≤ 24 hours; RTO ≤ 8 hours.** `13-operations-observability.md`
  must validate these against the selected Supabase plan, available
  backup/PITR capabilities, contractual requirements, and pilot/customer
  requirements. Any stronger contractual requirement overrides these
  defaults. Exact backup/PITR implementation remains open (owned by `13`).

## Assumptions

- TEN-A-01: Supabase Mumbai region offers the required core services
  (Postgres, Auth, Storage, Edge Functions) at provisioning time; feature
  availability is re-verified before provisioning (which itself awaits
  human approval, DEC-P).
- TEN-A-02: One production project suffices for launch; multi-region or
  per-customer projects are out of scope.

## Dependencies

- Upstream: `01-decisions.md` (DEC-D, DEC-E, DEC-P, DEC-T), `02-domain-model.md`
  (entity ownership classification, DM-X-05 identity model).
- Downstream: `04-authentication.md`, `05-authorization-rls.md`,
  `06-database-schema.md`, `08-audit-security.md` (break-glass audit),
  `10-migration-seed.md`, `13-operations-observability.md` (RPO/RTO
  validation, backup/PITR design).

## Open Questions

| ID | Question | Owner spec | Status |
|---|---|---|---|
| TEN-OQ-01 | Fixture demo default? | — | **Resolved:** fixture mode is demo/sales-only; per-environment `DATA_SOURCE` per TEN-20; never the production default |
| TEN-OQ-02 | Support access model? | — | **Resolved directionally:** no R0 impersonation; break-glass principles per TEN-23; implementation in `05`/`08` |
| TEN-OQ-03 | Backup/restore objectives? | — | **Resolved as provisional targets:** RPO ≤ 24 h, RTO ≤ 8 h (TEN-24); validation and exact PITR/backup implementation remain **open**, owned by `13` |

## Acceptance Criteria

- TEN-ACC-01: Every DM entity is classified exactly once: tenant-owned,
  identity/global, or system-default exception.
- TEN-ACC-02: The NULL-`firm_id` pattern is restricted to ComplianceType and
  requires spec amendment for any other use.
- TEN-ACC-03: Production provisioning is explicitly blocked on human approval
  (DEC-P) in the text.
- TEN-ACC-04: No credentials, URLs, or project identifiers appear in this
  document.
- TEN-ACC-05: System-default/firm-override resolution is defined as a rule,
  not left to implementation choice.
- TEN-ACC-06: Fixture mode is defined as demo-only with an explicit
  per-environment `DATA_SOURCE` table.
- TEN-ACC-07: Break-glass support principles (TEN-23) and provisional RPO/RTO
  targets (TEN-24) are stated without designing their implementations.

## Consequence of Change

Tenancy classification (TEN-03/04/06) is load-bearing for RLS (05) and schema
(06); reclassifying an entity after Batch 3 approval invalidates both.
Environment changes (TEN-12…16, TEN-20/21) affect operations (13) and
migration (10); region changes affect only provisioning, not schema. Weakening
TEN-23 (support access) or TEN-24 (resilience targets) is a security/posture
change requiring requester sign-off.
