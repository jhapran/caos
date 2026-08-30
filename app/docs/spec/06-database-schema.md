# 06 — Database Schema (Design)

- **Status:** Draft (Batch 3, Revision Pass 2 — REVIEW REQUIRED; DM-OQ-01 open pending CA-domain validation)
- **Approval status:** Not approved — must not be marked approved until DM-OQ-01 (Registration Scope Matrix) is human/CA-domain validated

## Purpose

Specification-level design of the production PostgreSQL schema: tables,
columns, logical/PostgreSQL types, keys, constraints, indexes, ownership, and
lifecycle persistence. This document is authoritative for structure. It is
**not** authoritative for authorization: every table references RLS
requirement IDs defined in `05-authorization-rls.md`; no policy definitions
appear here. No migration SQL is generated in Phase 2.

## Table inventory (authoritative)

**Release 0: exactly 20 tables — SCH-01…SCH-20** (firms, profiles,
firm_memberships, clients, legal_entities, client_relationships,
registrations, contacts, engagements, compliance_types,
client_compliance_profiles, compliance_instances, tasks, task_dependencies,
task_checklist_items, task_comments, review_items, alerts, alert_rules,
audit_log).

**Deferred: exactly 11 tables — SCH-21…SCH-31** (documents,
document_versions, document_requests, reminder_sequences, communications,
notifications, ai_outputs, invoices, integration_connections,
knowledge_chunks, client_portal_users). Deferred designs are dead-end
prevention only; full design lands with each feature's release spec.

## Scope

- Full design for the Release 0 tables (DEC-T).
- The Registration Scope Matrix (DM-27) with proposed review baselines.
- The tenant-aware referential integrity strategy (composite FKs).
- The responsibility-reference rule (membership vs identity).

## Non-goals

- No RLS policy definitions (owned by `05`; referenced by ID only).
- No SQL DDL, no migrations, no generated code.
- No AI provider design, no portal feature design.
- Seed data content (owned by `10-migration-seed.md`).

## Conventions

- Types are logical/PostgreSQL: `uuid`, `text`, `int`, `numeric`, `bool`,
  `date`, `timestamptz`, `jsonb`. Enumerations are `text` + CHECK
  constraints (per project convention against DB enums unless noted).
- Every table has `id uuid` PK (gen_random_uuid) unless stated; every
  tenant-owned table has `firm_id uuid NOT NULL → firms.id` (TEN-02/03).
- Standard columns on all non-audit tables: `created_at timestamptz NOT NULL
  DEFAULT now()`, `updated_at timestamptz` (trigger-maintained). `audit_log`
  is the exception (append-only, no `updated_at`).
- "Soft-delete policy" below means lifecycle status columns; hard deletes are
  prohibited on audit-sensitive tables (AUD-* in `08`).
- RLS references are family IDs from `05-authorization-rls.md`; verification
  obligations reference `TEST-RLS-*` and `TEST-AUD-*` families defined in
  `11-testing-harness.md`.

## Responsibility references: membership vs identity (SCH-RESP)

- **SCH-RESP-01:** Fields representing **tenant operational responsibility**
  (owner partner, manager, assignee, reviewer, partner-in-charge, review
  decision-maker where assignment context matters) reference
  **firm_memberships** via composite tenant FKs — never the bare Profile.
  The membership proves the person's role-bearing relationship to the same
  firm at the constraint layer.
- **SCH-RESP-02:** Fields representing **actor identity** (who performed an
  action: comment author, approver-of-record, acknowledger, resolver,
  inviter, checklist completer) reference `auth.users`/profiles — the global
  identity. Audit-log actor fields are actor identity (AUD-ACT-*).
- **SCH-RESP-03:** To make membership references enforceable at the
  constraint layer, `firm_memberships` carries `UNIQUE (firm_id, id)` and all
  responsibility references are composite: `(firm_id, <x>_membership_id)
  REFERENCES firm_memberships (firm_id, id)`.

## Tenant-aware referential integrity (direction RESOLVED — SCH-OQ-04)

- **SCH-FK-01:** For tenant-owned parent→child relationships, parents define
  `UNIQUE (firm_id, id)` and children declare composite foreign keys
  `(firm_id, parent_id) REFERENCES parent (firm_id, id)`. Cross-firm
  relationships are invalid at the **database constraint layer**, not merely
  forbidden by RLS. Defence-in-depth beneath RLS, not a replacement for it.
- **SCH-FK-02 — applies to (R0 chains):** firms→clients;
  clients→legal_entities; legal_entities→registrations;
  clients→contacts; clients→engagements; legal_entities→
  client_compliance_profiles; client_compliance_profiles→
  compliance_instances; compliance_instances→tasks; tasks→
  task_checklist_items / task_comments / task_dependencies (both ends);
  clients/tasks/compliance_instances→review_items; alert_rules→alerts;
  clients→alerts; engagements→compliance_instances (optional association);
  **firm_memberships→all responsibility references** (SCH-RESP-03).
  Deferred tables follow the same pattern when built.
- **SCH-FK-03 — documented exceptions:**
  - **Actor-identity references** (`auth.users`, profiles — SCH-RESP-02): no
    firm dimension; safe because identity is global and row isolation derives
    from the row's own `firm_id` plus RLS.
  - **compliance_types:** NULL-`firm_id` system defaults (TEN-06) make a
    composite FK impossible; safe because compliance types are reference data
    holding no tenant content — tenant isolation is carried by the
    referencing rows' own `firm_id`.
  - **audit_log:** soft references only (object_id as text, actor as
    non-enforcing reference); safe and intentional — audit rows must survive
    object lifecycle and remain append-only (AUD-INV-*).
- **SCH-FK-04:** Composite-FK DDL details (constraint naming, cascade
  behaviour) are implementation details verified at the harness gate; the
  architectural direction above is settled.

## Requirements — Release 0 tables

### SCH-01 — firms
- **Purpose:** Tenant root (DM-01). **R0.** Tenant boundary root (not tenant-owned).
- **Columns:** `name text NOT NULL`; `frn text` (firm registration number); `city text`; `plan text NOT NULL DEFAULT 'trial'`; `settings jsonb NOT NULL DEFAULT '{}'` (reminder rules, confidence thresholds, retention policy, notification prefs); `status text NOT NULL DEFAULT 'onboarding'` CHECK in (`onboarding`,`active`,`suspended`,`deactivated`).
- **PK:** id. **FKs:** none.
- **Checks/invariants:** status transitions per DM-SM-01.
- **Indexes:** none beyond PK (single-digit row count per deployment scale).
- **Lifecycle:** status column; never hard-deleted.
- **Audit sensitivity:** HIGH — status/settings/plan changes audited (AUD-*).
- **RLS:** RLS-FRM-*. **Tests:** TEST-RLS-FRM-*, TEST-AUD-01.

### SCH-02 — profiles
- **Purpose:** Application mirror of `auth.users` (DM-02). **R0.** Global (TEN-04).
- **Columns:** `full_name text NOT NULL`; `avatar_url text`; `phone text`.
- **PK:** `id uuid` — also FK → `auth.users.id` (1:1).
- **FKs:** auth.users. **Unique:** none beyond PK.
- **Invariants:** no tenant data, no role columns (TEN-05).
- **Indexes:** PK only. **Lifecycle:** mirrors auth identity; retained for audit referential integrity.
- **Audit sensitivity:** MEDIUM (name/phone changes).
- **RLS:** RLS-PRF-*. **Tests:** TEST-RLS-PRF-*.

### SCH-03 — firm_memberships
- **Purpose:** Staff tenancy edge with role (DM-03); the target of all
  tenant-responsibility references (SCH-RESP-01). **R0.** Global edge (TEN-04).
- **Columns:** `firm_id uuid NOT NULL`; `user_id uuid NOT NULL`; `role text NOT NULL` CHECK in (`super_admin`,`partner`,`manager`,`senior`,`article_executive`,`billing`,`external_consultant`); `status text NOT NULL DEFAULT 'invited'` CHECK in (`invited`,`active`,`suspended`,`removed`); `invited_by uuid`; `created_at`, `updated_at`.
- **PK:** id. **FKs:** firm_id → firms; user_id → auth.users; invited_by → auth.users (actor identity, SCH-RESP-02).
- **Unique:** `(firm_id, user_id)` (one role per user per firm, DM-03) **and `(firm_id, id)`** (composite-FK target for responsibility references, SCH-RESP-03).
- **Invariants:** role changes audited; `removed` handling per SCH-OQ-03.
- **Indexes:** `(user_id)` and `(firm_id, status)` — both are hot RLS paths.
- **Lifecycle:** status column; never hard-deleted (historical attribution).
- **Audit sensitivity:** HIGH — membership/role/status changes audited (AUD-*); membership create/remove and role change are AAL2 step-up operations (RLS-AAL-01).
- **RLS:** RLS-MEM-*. **Tests:** TEST-RLS-MEM-*, TEST-AUD-02.

### SCH-04 — clients
- **Purpose:** Commercial relationship (DM-04). **R0.** Tenant-owned. Parent in composite-FK chain (SCH-FK-02).
- **Columns:** `name text NOT NULL`; `industry text`; `risk_rating text` CHECK in (`low`,`medium`,`high`); `owner_partner_membership_id uuid NOT NULL`; `manager_membership_id uuid`; `status text NOT NULL DEFAULT 'onboarding'` CHECK in (`onboarding`,`active`,`inactive`,`offboarded`); `tags text[] NOT NULL DEFAULT '{}'`.
- **FKs:** `(firm_id, owner_partner_membership_id)` and `(firm_id, manager_membership_id)` → firm_memberships(firm_id, id) (composite, SCH-RESP-03 — same-firm proven at constraint layer).
- **Unique:** `(firm_id, id)` (composite-FK parent key, SCH-FK-01).
- **Invariants:** offboarded semantics per DM-04 (excluded from default views, never silently deleted).
- **Indexes:** `(firm_id, status)`, `(firm_id, name)`, `(firm_id, owner_partner_membership_id)`.
- **Audit sensitivity:** HIGH (status, owner changes).
- **RLS:** RLS-CLI-*. **Tests:** TEST-RLS-CLI-*, TEST-AUD-01.

### SCH-05 — legal_entities
- **Purpose:** Entity layer of the approved hierarchy (DM-05). **R0.** Tenant-owned.
- **Columns:** `client_id uuid NOT NULL`; `entity_type text NOT NULL` CHECK in (`private_limited`,`llp`,`individual`,`partnership`,`trust`,`huf`,`other`); `legal_name text NOT NULL`; `incorporation_date date`; `registered_address text`; `status text NOT NULL DEFAULT 'active'` CHECK in (`active`,`dormant`,`dissolved`).
- **FKs:** `(firm_id, client_id)` → clients(firm_id, id) (composite, SCH-FK-01).
- **Unique:** `(firm_id, id)` (parent key for registrations/profiles).
- **Invariants:** entity_type immutable after creation (DM-05) — enforced by update guard.
- **Indexes:** `(client_id)`, `(firm_id, status)`.
- **Audit sensitivity:** MEDIUM.
- **RLS:** RLS-ENT-*. **Tests:** TEST-RLS-ENT-*.

### SCH-06 — client_relationships
- **Purpose:** Group/related-party graph edges (DM-07). **R0 (basic).** Tenant-owned.
- **Columns:** `from_entity_id uuid NOT NULL`; `to_entity_id uuid NOT NULL`; `relation_type text NOT NULL` CHECK in (`group`,`holding`,`subsidiary`,`director`,`partner`,`promoter`,`related_party`,`family`); `effective_from date`; `effective_to date`; `status text NOT NULL DEFAULT 'active'` CHECK in (`active`,`ended`).
- **FKs:** `(firm_id, from_entity_id)` and `(firm_id, to_entity_id)` → legal_entities(firm_id, id) — composite FKs make cross-firm edges impossible (SCH-FK-01).
- **Checks:** `from_entity_id <> to_entity_id`.
- **Indexes:** `(from_entity_id)`, `(to_entity_id)`.
- **Audit sensitivity:** MEDIUM.
- **RLS:** RLS-ENT-* (shares entity family). **Tests:** TEST-RLS-ENT-*.

### SCH-07 — registrations
- **Purpose:** Statutory identifiers (DM-06). **R0.** Tenant-owned.
- **Columns:** `legal_entity_id uuid NOT NULL`; `type text NOT NULL` CHECK in (`PAN`,`GSTIN`,`TAN`,`CIN`,`LLPIN`,`DIN`,`PT`,`PF`,`ESI`,`OTHER`); `value text NOT NULL`; `state text` (for state-scoped registrations); `valid_from date`; `valid_to date`; `status text NOT NULL DEFAULT 'active'` CHECK in (`active`,`surrendered`,`expired`).
- **FKs:** `(firm_id, legal_entity_id)` → legal_entities(firm_id, id).
- **Unique:** `(firm_id, type, value)`.
- **Indexes:** `(legal_entity_id)`; `(firm_id, value)` — powers identifier search (PRD §68).
- **Audit sensitivity:** HIGH (identifiers are compliance-critical).
- **RLS:** RLS-REG-*. **Tests:** TEST-RLS-REG-*, TEST-AUD-01.

### SCH-08 — contacts
- **Purpose:** Client-side personnel (DM-08). **R0.** Tenant-owned.
- **Columns:** `client_id uuid NOT NULL`; `legal_entity_id uuid`; `name text NOT NULL`; `role_title text`; `email text`; `phone text`; `is_primary bool NOT NULL DEFAULT false`; `status text NOT NULL DEFAULT 'active'` CHECK in (`active`,`inactive`).
- **FKs:** `(firm_id, client_id)` → clients(firm_id, id); `(firm_id, legal_entity_id)` → legal_entities (nullable component).
- **Invariants:** a primary contact must have an email (DEC-Q channel).
- **Indexes:** `(client_id)`.
- **Audit sensitivity:** MEDIUM (PII).
- **RLS:** RLS-CON-*. **Tests:** TEST-RLS-CON-*.

### SCH-09 — engagements
- **Purpose:** Service scope + engagement-letter status (DM-09). **R0.** Tenant-owned.
- **Columns:** `client_id uuid NOT NULL`; `responsible_partner_membership_id uuid NOT NULL`; `service_lines text[] NOT NULL DEFAULT '{}'`; `letter_status text NOT NULL DEFAULT 'not_started'` CHECK in (`not_started`,`issued`,`signed`,`expired`); `proposed_at timestamptz`; `signed_at timestamptz`; `period_label text`; `status text NOT NULL DEFAULT 'draft'` CHECK in (`draft`,`proposed`,`active`,`completed`,`terminated`); `termination_reason text`.
- **FKs:** `(firm_id, client_id)` → clients; `(firm_id, responsible_partner_membership_id)` → firm_memberships (SCH-RESP-03).
- **Invariants:** unsigned-letter alerts derive from `status='proposed'`/`letter_status` age (DM-09); responsible partner = oversight, not execution (DM-OQ-02 resolution). **An engagement is never a compliance subject** (scope vocabulary is exactly `entity | registration | configurable`); instances may *associate* an engagement (SCH-12).
- **Indexes:** `(client_id)`, `(firm_id, status)`.
- **Audit sensitivity:** HIGH.
- **RLS:** RLS-ENG-*. **Tests:** TEST-RLS-ENG-*.

### SCH-10 — compliance_types
- **Purpose:** Rule objects (DM-10; PRD §26/§124). **R0.** Hybrid ownership: NULL `firm_id` = system default; else firm-owned (TEN-06…09).
- **Columns:** `firm_id uuid` (NULL = system default); `type_key text NOT NULL`; `name text NOT NULL`; `category text NOT NULL`; `authority text`; `frequency text NOT NULL` CHECK in (`monthly`,`quarterly`,`annual`,`event`,`custom`); `due_rule jsonb NOT NULL`; `applicability jsonb`; `required_documents jsonb`; `checklist_template jsonb`; `workflow_template jsonb NOT NULL`; `client_approval_required bool NOT NULL DEFAULT false`; `filing_confirmation_required bool NOT NULL DEFAULT true`; `acknowledgement_required bool NOT NULL DEFAULT true`; `four_eyes_required bool NOT NULL DEFAULT true`; **`scope_kind text NOT NULL DEFAULT 'configurable'` CHECK in (`entity`,`registration`,`configurable`)** — the complete compliance-subject vocabulary (engagement is NOT a subject kind); **`registration_class text`** — declares the required registration type (e.g. `GSTIN`, `TAN`) when `scope_kind='registration'`; `status text NOT NULL DEFAULT 'active'` CHECK in (`active`,`deprecated`).
- **Invariants:** workflow_template validated against DM-SM-04; system rows writable only by deployment/seed (TEN-08); `registration_class` required when `scope_kind='registration'`; **`scope_kind`/`registration_class` values are populated only from the validated Registration Scope Matrix (DM-27)** — until then, rows ship as `configurable`.
- **Unique:** `(type_key, firm_id)` NULLS NOT DISTINCT (one default + one override per firm per key).
- **Indexes:** `(type_key)`; `(firm_id)`.
- **Audit sensitivity:** HIGH (rule changes alter obligations; changes are security-configuration events, RLS-AAL-01/AUD-CAT-01).
- **RLS:** RLS-CTY-*. **Tests:** TEST-RLS-CTY-*, TEST-AUD-02.

### SCH-11 — client_compliance_profiles
- **Purpose:** Applicability records (DM-11; PRD §25). **R0.** Tenant-owned.
- **Columns:** `legal_entity_id uuid NOT NULL`; `compliance_type_id uuid NOT NULL`; `registration_id uuid`; `applicability_answers jsonb`; `status text NOT NULL DEFAULT 'proposed'` CHECK in (`proposed`,`active`,`suspended`,`ended`); `approved_by uuid`; `approved_at timestamptz`.
- **FKs:** `(firm_id, legal_entity_id)` → legal_entities; compliance_type_id → compliance_types (SCH-FK-03 exception — reference data); `(firm_id, registration_id)` → registrations (nullable component); approved_by → auth.users (actor identity, SCH-RESP-02).
- **Unique:** `(legal_entity_id, compliance_type_id, registration_id)` NULLS NOT DISTINCT.
- **Invariants:** only `active` profiles generate instances (DM-11); approval actor recorded (PRD §72 step 9); when the compliance type's `scope_kind='registration'`, `registration_id` must reference a registration of the declared `registration_class` (validated at write path; matrix-gated, DM-27).
- **Indexes:** `(legal_entity_id, status)`, `(firm_id, status)`.
- **Audit sensitivity:** HIGH (approval decision).
- **RLS:** RLS-CCP-*. **Tests:** TEST-RLS-CCP-*, TEST-AUD-02.

### SCH-12 — compliance_instances
- **Purpose:** Obligation per entity per period (DM-12). **R0.** Tenant-owned.
- **Columns:** `legal_entity_id uuid NOT NULL` (**required**, DEC-G); `compliance_type_id uuid NOT NULL`; `registration_id uuid` (**optional**, DEC-G; required only where the type's validated `scope_kind='registration'`, DM-27); `client_compliance_profile_id uuid`; `engagement_id uuid` (**optional association only** — engagement is never the compliance subject; statutory/audit compliance remains legal-entity scoped); `client_id uuid NOT NULL` (denormalized for RLS/query simplicity, trigger-maintained, never user-writable); **period — structured (SCH-OQ-01 RESOLVED):** `period_start date NOT NULL`; `period_end date NOT NULL`; `period_label text NOT NULL` (**presentation/convenience only, never authoritative**); `period_meta jsonb` (optional domain metadata: financial year, assessment year, tax quarter — populated per family as needed, not over-modelled); `due_date date NOT NULL`; `state text NOT NULL DEFAULT 'not_started'` CHECK in the ten DM-SM-04 states (`not_started`,`information_requested`,`information_received`,`preparation`,`internal_review`,`client_approval`,`ready_to_file`,`filed`,`acknowledgement_received`,`closed`); `assignee_membership_id uuid`; `reviewer_membership_id uuid`; `partner_membership_id uuid` (partner-in-charge for the obligation; PRD §43); `priority text NOT NULL DEFAULT 'normal'`; `risk_score int` (derived cache, DM-X-03); `risk_factors jsonb`; `filed_at timestamptz`; `closed_at timestamptz`; `successor_instance_id uuid`.
- **FKs:** `(firm_id, legal_entity_id)` → legal_entities; `(firm_id, registration_id)` → registrations (nullable); `(firm_id, client_compliance_profile_id)` → client_compliance_profiles; `(firm_id, engagement_id)` → engagements (nullable); `(firm_id, client_id)` → clients; compliance_type_id → compliance_types (SCH-FK-03 exception); `(firm_id, assignee_membership_id)` / `(firm_id, reviewer_membership_id)` / `(firm_id, partner_membership_id)` → firm_memberships (composite, SCH-RESP-03); successor → self.
- **Checks:** `period_end >= period_start`.
- **Unique:** `(compliance_type_id, legal_entity_id, registration_id, period_start)` NULLS NOT DISTINCT — one instance per obligation per period.
- **Invariants:** state transitions validated per DM-SM-04 at the write path (RPC, API-*) — the CHECK constrains values, transitions are validated by the transition function; four-eyes separation enforced where the type requires it (RLS-4EY-*); assignee/reviewer/partner may differ from the engagement's responsible partner without warning (DM-OQ-02 resolution).
- **Indexes:** `(firm_id, due_date, state)` — deadline board; `(firm_id, assignee_membership_id, state)` — My Work; `(client_id, period_start)`; `(firm_id, compliance_type_id, period_start)` — drill-downs.
- **Audit sensitivity:** HIGH — state transitions, assignee changes, filing markers audited (PRD §67 example). Routine status changes do **not** require step-up MFA (RLS-AAL-01).
- **RLS:** RLS-CIN-*. **Tests:** TEST-RLS-CIN-*, TEST-AUD-03.

### SCH-13 — tasks
- **Purpose:** Execution activity, instance-linked or ad-hoc (DM-13, DEC-H). **R0.** Tenant-owned.
- **Columns:** `client_id uuid NOT NULL`; `compliance_instance_id uuid` (nullable, DEC-H); `title text NOT NULL`; `description text`; `next_action text NOT NULL` (PRD §44); `status text NOT NULL DEFAULT 'open'` CHECK in (`open`,`in_progress`,`waiting`,`submitted`,`returned`,`approved`,`done`,`cancelled`); `waiting_reason text`; `due_date date`; `priority text NOT NULL DEFAULT 'normal'`; `assignee_membership_id uuid`; `reviewer_membership_id uuid`; `time_spent_minutes int NOT NULL DEFAULT 0`.
- **FKs:** `(firm_id, client_id)` → clients; `(firm_id, compliance_instance_id)` → compliance_instances (nullable); `(firm_id, assignee_membership_id)` / `(firm_id, reviewer_membership_id)` → firm_memberships (composite, SCH-RESP-03).
- **Invariants:** transitions per DM-SM-05; `waiting` requires `waiting_reason`; `returned` requires a reviewer comment (application/RPC invariant).
- **Indexes:** `(firm_id, assignee_membership_id, status, due_date)` — My Work (DEC-L); `(firm_id, client_id)`; `(compliance_instance_id)`; `(firm_id, due_date)` for overdue scans.
- **Audit sensitivity:** MEDIUM-HIGH (status transitions, reassignment).
- **RLS:** RLS-TSK-*. **Tests:** TEST-RLS-TSK-*, TEST-AUD-03.

### SCH-14 — task_dependencies
- **Purpose:** First-class task-to-task dependencies in R0 (DM-OQ-04 resolution). **R0 (schema + basic model; visualization/intelligence deferred).** Tenant-owned.
- **Columns:** `task_id uuid NOT NULL`; `depends_on_task_id uuid NOT NULL`; `dependency_type text NOT NULL DEFAULT 'finish_to_start'`.
- **FKs:** `(firm_id, task_id)` and `(firm_id, depends_on_task_id)` → tasks(firm_id, id) — composite FKs (SCH-FK-01).
- **Unique:** `(task_id, depends_on_task_id)`. **Checks:** `task_id <> depends_on_task_id`.
- **Invariants:** dependency graph must remain acyclic — enforced by a validation function at insert (RPC path); verified at harness gate.
- **Indexes:** `(task_id)`, `(depends_on_task_id)`.
- **Audit sensitivity:** LOW-MEDIUM.
- **RLS:** RLS-TSK-* (task family). **Tests:** TEST-RLS-TSK-*; acyclicity test TEST-SCH-01.

### SCH-15 — task_checklist_items
- **Purpose:** Checklist lines (DM-14). **R0.** Tenant-owned.
- **Columns:** `task_id uuid NOT NULL`; `label text NOT NULL`; `is_done bool NOT NULL DEFAULT false`; `done_by uuid`; `done_at timestamptz`; `template_source text`; `sort_order int NOT NULL DEFAULT 0`.
- **FKs:** `(firm_id, task_id)` → tasks; done_by → auth.users (actor identity, SCH-RESP-02).
- **Indexes:** `(task_id, sort_order)`.
- **Audit sensitivity:** LOW.
- **RLS:** RLS-TSK-*. **Tests:** TEST-RLS-TSK-*.

### SCH-16 — task_comments
- **Purpose:** Task/review discussion; immutable (DM-15). **R0.** Tenant-owned.
- **Columns:** `task_id uuid NOT NULL`; `author_id uuid NOT NULL`; `body text NOT NULL`; `retracted bool NOT NULL DEFAULT false`; `created_at` (no `updated_at` — immutability).
- **FKs:** `(firm_id, task_id)` → tasks; author_id → auth.users (actor identity, SCH-RESP-02).
- **Invariants:** updates limited to setting `retracted`; deletes prohibited (RLS + privileges).
- **Indexes:** `(task_id, created_at)`.
- **Audit sensitivity:** MEDIUM (review history, PRD §46).
- **RLS:** RLS-TCM-*. **Tests:** TEST-RLS-TCM-*; immutability TEST-AUD-04.

### SCH-17 — review_items
- **Purpose:** Review queue with real persistence (DM-21; DEC-T item 19). **R0.** Tenant-owned.
- **Columns:** `client_id uuid NOT NULL`; `task_id uuid`; `compliance_instance_id uuid`; `type text NOT NULL`; `source text NOT NULL DEFAULT 'human'` CHECK in (`human`,`ai`); `title text NOT NULL`; `note text`; `status text NOT NULL DEFAULT 'pending'` CHECK in (`pending`,`approved`,`returned`,`escalated`,`dismissed`); `priority text NOT NULL DEFAULT 'normal'`; `submitted_by_membership_id uuid NOT NULL`; `submitted_at timestamptz NOT NULL DEFAULT now()`; `decided_by_membership_id uuid`; `decided_at timestamptz`; `decision_rationale text`; `ai_output_id uuid`; `sla_due_at timestamptz`.
- **FKs:** `(firm_id, client_id)` → clients; `(firm_id, task_id)` → tasks; `(firm_id, compliance_instance_id)` → compliance_instances (nullable components); `(firm_id, submitted_by_membership_id)` / `(firm_id, decided_by_membership_id)` → firm_memberships (composite — review decisions are responsibility relationships requiring same-firm proof, SCH-RESP-01); ai_output_id → ai_outputs (deferred table, SCH-27).
- **Invariants:** terminal decisions require decider + timestamp + rationale (DM-SM-06); reviewer ≠ submitter where four-eyes applies (RLS-4EY-*); decisions feed audit (PRD §83).
- **Indexes:** `(firm_id, status, priority)` — the queue; `(firm_id, submitted_by_membership_id, status)`.
- **Audit sensitivity:** HIGH (decisions).
- **RLS:** RLS-RVW-*. **Tests:** TEST-RLS-RVW-*, TEST-AUD-03.

### SCH-18 — alerts
- **Purpose:** Firm risk signals with hybrid resolution (DM-22). **R0.** Tenant-owned.
- **Columns:** `alert_rule_id uuid`; `severity text NOT NULL` CHECK in (`info`,`warning`,`critical`); `title text NOT NULL`; `detail text`; `client_id uuid`; `compliance_instance_id uuid`; `affected jsonb`; `status text NOT NULL DEFAULT 'active'` CHECK in (`active`,`acknowledged`,`snoozed`,`resolved`); `raised_at timestamptz NOT NULL DEFAULT now()`; `acknowledged_by uuid`; `acknowledged_at timestamptz`; `snoozed_until timestamptz`; `resolved_by uuid`; `resolved_at timestamptz`; `resolution_type text` CHECK in (`manual`,`auto`) — auto-resolution always audit-logged (DM-OQ-05 resolution).
- **FKs:** `(firm_id, alert_rule_id)` → alert_rules; `(firm_id, client_id)` → clients; `(firm_id, compliance_instance_id)` → compliance_instances (nullable); acknowledged_by/resolved_by → auth.users (actor identity, SCH-RESP-02).
- **Indexes:** `(firm_id, status, severity)`; `(firm_id, raised_at)`.
- **Audit sensitivity:** MEDIUM-HIGH (ack/resolution).
- **RLS:** RLS-ALR-*. **Tests:** TEST-RLS-ALR-*, TEST-AUD-03.

### SCH-19 — alert_rules
- **Purpose:** Per-firm alert rule configuration (DM-22). **R0.** Tenant-owned (firm rows seeded from templates at firm creation — no NULL-firm pattern here; TEN-09).
- **Columns:** `rule_key text NOT NULL`; `name text NOT NULL`; `severity text NOT NULL`; `config jsonb NOT NULL DEFAULT '{}'` (thresholds); `enabled bool NOT NULL DEFAULT true`; `auto_resolve bool NOT NULL DEFAULT true`; `requires_explicit_ack bool NOT NULL DEFAULT false` (DM-OQ-05 resolution).
- **Unique:** `(firm_id, rule_key)`.
- **Audit sensitivity:** HIGH (changing alert thresholds changes risk visibility; administration restricted per RLS-ARL-01 and every change audited).
- **RLS:** RLS-ARL-*. **Tests:** TEST-RLS-ARL-*, TEST-AUD-02.

### SCH-20 — audit_log
- **Purpose:** Immutable append-only audit record (DM-25; PRD §67). **R0.** Tenant-owned rows; platform entries use the reserved NULL-firm marker (AUD-EVT-03).
- **Columns:** `firm_id uuid` (NULL only for platform/system entries per `08`); **actor model (AUD-ACT-*):** `actor_type text NOT NULL` CHECK in (`human`,`system`,`service`,`support`); `actor_user_id uuid` (the human auth user — NULL unless `actor_type='human'`; for `support`, the named support actor's user id); `service_name text` (job / Edge Function / automation identity when `actor_type` is `system`/`service`); `action text NOT NULL`; `object_type text NOT NULL`; `object_id text`; `old_value jsonb`; `new_value jsonb`; `ip text`; `user_agent text`; `correlation_id uuid`; `support_session_id uuid`; `created_at timestamptz NOT NULL DEFAULT now()` (server-generated only).
- **PK:** `id uuid`. **FKs:** soft references only (SCH-FK-03) — actor_user_id non-enforcing (actor identity, not tenant responsibility); object_id as text.
- **Invariants (binding, detailed in `08`):** append-only for all application roles and ordinary service paths — no UPDATE/DELETE; timestamps server-generated; `actor_type` non-human rows must not carry a human `actor_user_id` except `support` (which requires both actor_user_id and support_session_id) — system/service operations never masquerade as a human; retention/archive only via the privileged maintenance path (AUD-RET-02).
- **Indexes:** `(firm_id, object_type, object_id)`; `(firm_id, created_at)`; `(actor_user_id, created_at)`; `(support_session_id)`.
- **Audit sensitivity:** is the audit store itself.
- **RLS:** RLS-AUD-* (select-only, privileged roles). **Tests:** TEST-RLS-AUD-*, TEST-AUD-01…10.

## Deferred tables (dead-end prevention only)

Lightweight definitions; full design lands with their release specs. All are
tenant-owned (TEN-02) and follow the composite-FK pattern (SCH-FK-02) and the
responsibility-reference rule (SCH-RESP) when built.

- **SCH-21 — documents (Release 1, DM-16):** `client_id`, `legal_entity_id`, `doc_type text`, `classification_confidence numeric`, `extracted_metadata jsonb`, `expiry_date date`, `status` (`quarantine`,`processing`,`classified`,`verified`,`archived` — DEC-R), `source_channel`, `current_version_id`. Indexes: `(client_id, doc_type)`, `(firm_id, expiry_date)`.
- **SCH-22 — document_versions (Release 1, DM-17):** `document_id`, `storage_path text` (tenant-scoped, DEC-R), `content_hash text`, `size_bytes bigint`, `uploaded_by` (actor identity), `supersedes_id`. Unique content hash per client for duplicate detection (PRD §34). Append-only.
- **SCH-23 — document_requests (Release 1, DM-18):** `client_id`, `compliance_instance_id`, `contact_id`, `items jsonb` (per-item: doc_type, status, fulfilling_document_id), `secure_token text UNIQUE`, `status` per DM-18 lifecycle, `sent_at`, `completed_at`.
- **SCH-24 — reminder_sequences (Release 1, DM-19):** `document_request_id UNIQUE`, `current_step int`, `next_send_at timestamptz`, `status`, `stopped_reason`.
- **SCH-25 — communications (Release 1, DM-20):** `client_id`, `contact_id`, `channel` (`email`,`portal`,`whatsapp`,`note`), `direction`, `subject`, `body`, `template_id`, `document_request_id`, `sent_at`. Append-only.
- **SCH-26 — notifications (post-R0, DM-23):** `membership_id` (responsibility/reference to firm_memberships), `type`, `payload jsonb`, `read_at`, `digest_group`.
- **SCH-27 — ai_outputs (Release 1+, DM-26):** `model text`, `prompt_ref text`, `output jsonb`, `confidence numeric`, `evidence_links jsonb`, `human_decision text`, `decided_by_membership_id` (responsibility), `decided_at`.
- **SCH-28 — invoices (later, DM-24; DEC-M):** `client_id`, `invoice_number`, `amount numeric`, `currency text DEFAULT 'INR'`, `issued_on date`, `due_on date`, `status`, `import_source text`, `imported_at`.
- **SCH-29 — integration_connections (P1, PRD §59–60):** `provider text`, `credentials_ref text` (secret-store reference, never the secret), `status`, `last_sync_at`.
- **SCH-30 — knowledge_chunks (Phase 2, PRD §81/§126):** `source_document_id`, `embedding vector` (pgvector), `authority`, `citation jsonb`. Deferred with pgvector (DEC-T exclusion).
- **SCH-31 — client_portal_users (Release 2, DM-08/AUTH-15):** `contact_id`, `user_id → auth.users`, `status`, `created_at`. Unique `(contact_id, user_id)`. Independent of firm_memberships (DM-X-05).

All deferred tables reference RLS families RLS-DOC-*, RLS-DREQ-*, RLS-RMD-*,
RLS-COM-*, RLS-NTF-*, RLS-INV-*, RLS-AIO-*, RLS-INT-*, RLS-KNC-*, RLS-CPU-*
defined at intent level in `05`.

## Registration Scope Matrix (DM-27 — REQUIRES CA-DOMAIN VALIDATION)

**Validation status of the whole matrix: UNVALIDATED.** Evaluated from the
PRD only; the baseline column records the agreed review starting point —
these are **proposed review defaults, not final approved CA-domain rules**
(DM-OQ-01 remains OPEN). `scope_kind`/`registration_class` in
`compliance_types` (SCH-10) ship as `configurable` until the matrix is
human-validated. The compliance-subject vocabulary is exactly
`entity | registration | configurable`; engagement is never a subject kind
(SCH-09/SCH-12).

| Compliance family | scope_kind baseline | registration_class | Cardinality expectation | PRD source / rationale | Confidence | Validation status |
|---|---|---|---|---|---|---|
| GST (GSTR-1, GSTR-3B, …) | registration | GSTIN | ~one instance per GSTIN per period; multi-state clients hold multiple GSTINs | §25 "GST registration?"; "Multiple states?"; §29 recurrence example | Medium | REQUIRES CA-DOMAIN VALIDATION |
| TDS | registration | TAN | ~one instance per TAN per quarter | §25 "Does the client deduct TDS?"; §13 | Medium | REQUIRES CA-DOMAIN VALIDATION |
| Income Tax / ITR | entity | — (PAN is identifier/context, not the instance-scope FK) | One per entity per assessment year | §18 identifiers; §20; §72 "Income Tax annual" | Medium | REQUIRES CA-DOMAIN VALIDATION |
| ROC / MCA | entity | — (CIN/LLPIN is identifier/context) | One per company/LLP entity per year | §72 step 8; §18 | Medium | REQUIRES CA-DOMAIN VALIDATION |
| Professional Tax | registration (provisional) | PT — state-specific | Unknown — per state registration | §25 "Multiple states?" (indirect only) | Low | REQUIRES CA-DOMAIN VALIDATION |
| PF | registration (provisional — establishment/registration scope) | PF code | Unknown | §25 "PF?" | Low | REQUIRES CA-DOMAIN VALIDATION |
| ESI | registration (provisional — establishment/registration scope) | ESI code | Unknown | §25 "ESI?" | Low | REQUIRES CA-DOMAIN VALIDATION |
| Payroll | unresolved — **open question whether Payroll belongs in the statutory ComplianceType catalogue at all** (it may be a service/task family rather than a statutory obligation) | — | Unknown | §20 Payroll tab | Low | REQUIRES CA-DOMAIN VALIDATION (incl. catalogue membership) |
| Audit (statutory/tax) | entity | — (PAN/CIN context; an Engagement may be associated separately via `engagement_id`, SCH-12) | Per entity per year | §25 audit applicability questions | Medium | REQUIRES CA-DOMAIN VALIDATION |
| Certificates / custom recurring | configurable | per configuration | Per configuration | §20 "Certificates", "Custom recurring compliance" | Low | REQUIRES CA-DOMAIN VALIDATION |

## Assumptions

- SCH-A-01: `text` + CHECK is used instead of Postgres enums, matching the
  codebase's union-literal convention and easing migration evolution.
- SCH-A-02: Denormalized `client_id` on compliance_instances (and similar
  roll-ups) is maintained by trigger and exists for RLS/query simplicity;
  it is never user-writable.
- SCH-A-03: NULLS NOT DISTINCT unique semantics (PG15+) are available on the
  target Supabase Postgres version — verified at the harness gate.

## Dependencies

- Upstream: `02-domain-model.md` (entities, state machines, DM-27),
  `03-tenancy-environments.md` (TEN-02…09 classification),
  `04-authentication.md` (identity model), `05-authorization-rls.md`
  (RLS-AAL-01 referenced for sensitivity classification).
- Downstream: `07-api-contract.md` (RPC surface), `09-automation-events.md`
  (recurrence, alert generation), `10-migration-seed.md` (fixture mapping),
  `11-testing-harness.md` (TEST-RLS/TEST-AUD definitions).

## Open Questions

| ID | Question | Owner | Status |
|---|---|---|---|
| DM-OQ-01 | Registration Scope Matrix validation (proposed baselines recorded; not final rules) | CA-domain expert + requester | **OPEN — blocks Batch 3 approval** |
| SCH-OQ-01 | Period representation | — | **Resolved:** structured `period_start`/`period_end`/`period_label` (presentation-only) + optional `period_meta` jsonb — SCH-12 |
| SCH-OQ-02 | `review_items.type` value set (mirrors demo: gst_reconciliation, tds_return, itr_computation, financial_statements, audit_workpaper?) | Batch 4 (`07`) | Open |
| SCH-OQ-03 | Re-inviting a removed membership: new row vs status flip — affects unique constraint | `05`/`07` | Open |
| SCH-OQ-04 | Same-firm referential integrity mechanism | — | **Resolved:** composite tenant FKs (SCH-FK-01…03), extended to membership responsibility references (SCH-RESP-03); DDL details verified at harness gate (SCH-FK-04) |
| SCH-OQ-05 | audit_log partitioning | — | **Resolved:** deferred for R0 — indexes + approved retention architecture suffice; partitioning later on measured volume |
| SCH-OQ-06 | Does Payroll belong in the statutory ComplianceType catalogue, or is it a service/task family? (matrix row) | CA-domain expert + requester | **Open** |

## Acceptance Criteria

- SCH-ACC-01: Every R0 table has: requirement ID, purpose, R0 status, tenant
  ownership, columns with types and nullability, PK, FKs, uniques, checks,
  indexes, lifecycle policy, audit sensitivity, RLS family reference, and
  test references.
- SCH-ACC-02: DEC-F hierarchy preserved (clients → legal_entities →
  registrations); DEC-G (legal_entity_id required / registration_id
  optional); DEC-H (tasks.compliance_instance_id nullable); task_dependencies
  present for R0.
- SCH-ACC-03: No RLS policy text appears; only RLS-* ID references.
- SCH-ACC-04: Every tenant-owned table has a TEST-RLS-* reference; every
  HIGH/MEDIUM audit-sensitive table has a TEST-AUD-* reference.
- SCH-ACC-05: The Registration Scope Matrix covers GST, TDS, Income Tax,
  ROC/MCA, Professional Tax, PF and ESI as separate rows, Payroll (with the
  catalogue-membership question), Audit, and Certificates/custom; each row
  carries baseline, confidence, and REQUIRES CA-DOMAIN VALIDATION status.
- SCH-ACC-06: No table lacks an authorization classification; no sensitive
  table lacks an audit classification.
- SCH-ACC-07: The table inventory states exact counts (20 R0 / 11 deferred)
  matching the SCH-01…31 enumeration.
- SCH-ACC-08: The composite tenant-FK strategy lists its applications and
  documents every exception with its safety rationale.
- SCH-ACC-09: Every tenant operational-responsibility field references
  firm_memberships via composite FK (SCH-RESP-01/03); actor-identity fields
  reference auth.users (SCH-RESP-02); the two are never conflated.

## Consequence of Change

Column/constraint changes after Batch 4 approval invalidate the API contract
and migration mapping; tenant-classification changes invalidate `03` and
`05`; weakening the composite-FK strategy (SCH-FK-01) or the
responsibility-reference rule (SCH-RESP) removes defence-in-depth layers and
requires requester sign-off. The Registration Scope Matrix, once validated,
becomes append-mostly: changing a compliance type's scoping after instances
exist requires a data migration plan recorded in `10`.
