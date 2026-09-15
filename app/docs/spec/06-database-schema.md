# 06 — Database Schema (Design)

- **Status:** Approved (architecture, Batch 3) — **amended by the Batch 4 closure amendment** (adds SCH-32 `compliance_rule_versions` and SCH-12 recurrence-provenance fields; satisfies AUTO-XREF-01) **and the Batch 4 security closure** (SCH-32 references the explicit RLS-CRV-* family in `05`) — **amended by the IMP-050 architecture amendment (human-ruled 2026-09-11)**: adds the automation record contracts SCH-33 `event_outbox`, SCH-34 `scheduler_job_runs`, SCH-35 `scheduler_dead_letters` (AUTO-OQ-01/02 resolutions; contract only — no migration exists yet)
- **Approval status:** Approved for architecture (Batch 3); Batch 4 closure and security closure amendments approved (Batch 4). Note: the Registration Scope Matrix (DM-27) is approved **for architecture only** — external practicing-CA / compliance-domain sign-off remains **mandatory before production statutory-rule activation** (this approval is not professional CA certification).

## Purpose

Specification-level design of the production PostgreSQL schema: tables,
columns, logical/PostgreSQL types, keys, constraints, indexes, ownership, and
lifecycle persistence. This document is authoritative for structure. It is
**not** authoritative for authorization: every table references RLS
requirement IDs defined in `05-authorization-rls.md`; no policy definitions
appear here. No migration SQL is generated in Phase 2.

## Table inventory (authoritative)

**CURRENT deployed state (accepted staging, through IMP-042): exactly 21
public application tables — SCH-01…SCH-20 plus SCH-32.**

**TARGET Release-0 contract after the IMP-050 schema migration: exactly
24 tables — SCH-01…SCH-20 plus SCH-32, SCH-33, SCH-34, SCH-35** (firms,
profiles, firm_memberships, clients, legal_entities, client_relationships,
registrations, contacts, engagements, compliance_types,
client_compliance_profiles, compliance_instances, tasks, task_dependencies,
task_checklist_items, task_comments, review_items, alerts, alert_rules,
audit_log, **compliance_rule_versions**, **event_outbox**,
**scheduler_job_runs**, **scheduler_dead_letters**). SCH-32 was added by the Batch 4
closure amendment (rule versioning / recurrence provenance, AUTO-XREF-01);
SCH-33/34/35 were added by the IMP-050 architecture amendment
(2026-09-11 — transactional outbox / publication record, scheduler job-run
record, retry/dead-letter record; AUTO-OQ-01/02 resolutions). Both
amendments follow the no-renumbering convention (IDX: IDs are never
renumbered after approval), taking the next free IDs rather than
renumbering the deferred range. **The 24-table count is the TARGET
contract count, NOT current deployed state: as of this amendment
SCH-33/34/35 are normative contracts only — no migration exists; physical
tables land with the IMP-050 implementation package.** **Target catalog
posture (Ruling 2026-09-12, R8):** CURRENT before IMP-050 = 21 public
application tables, FORCE RLS 18, 51 policies; TARGET after IMP-050 = 24
tables, RLS enabled 24/24, FORCE RLS **20** (SCH-33 and SCH-35 forced;
SCH-34 enabled but NOT forced — system-scoped, not tenant-owned), policy
count remains **51** unless implementation introduces a separately
contract-authorized policy; the new RLS families
(RLS-EVO-01/SJR-01/SDL-01) are zero-browser-grant postures and do not
themselves require permissive browser policies.

**Deferred: exactly 11 tables — SCH-21…SCH-31** (documents,
document_versions, document_requests, reminder_sequences, communications,
notifications, ai_outputs, invoices, integration_connections,
knowledge_chunks, client_portal_users). Deferred designs are dead-end
prevention only; full design lands with each feature's release spec.

## Scope

- Full design for the Release 0 tables (DEC-T).
- The Registration Scope Matrix (DM-27), resolved for architecture.
- The tenant-aware referential integrity strategy (composite FKs).
- The responsibility-reference rule (membership vs identity).
- Rule versioning and recurrence provenance (Batch 4 closure amendment:
  SCH-32, SCH-12 additions).
- Automation records (IMP-050 architecture amendment, 2026-09-11: SCH-33
  transactional outbox / publication record, SCH-34 scheduler job-run
  record, SCH-35 retry/dead-letter record — contract level only).

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
  DEFAULT now()`, `updated_at timestamptz` (trigger-maintained). Exceptions:
  `audit_log` (append-only, no `updated_at`); `compliance_rule_versions`
  (SCH-32) has `created_at` but deliberately NO `updated_at` — versions are
  historical/versioned records, active or referenced versions are immutable,
  rule changes create new versions, and `created_at` + `audit_log` carry
  change provenance; `updated_at` would imply a misleading mutability
  lifecycle. Draft edits are audited without requiring the column (R0
  closure 2026-09-03). No other table is excepted.
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
  inviter, checklist completer, rule-version creator) reference
  `auth.users`/profiles — the global identity. Audit-log actor fields are
  actor identity (AUD-ACT-*).
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
  - **compliance_rule_versions (SCH-32, Batch 4 closure amendment):** same
    reference-data exception family as compliance_types — NULL-`firm_id`
    system-default versions make composite FKs impossible in the general
    case; safe because versions are reference data holding no tenant
    content, and instance rows referencing them carry their own `firm_id`.
  - **audit_log:** soft references only (object_id as text, actor as
    non-enforcing reference); safe and intentional — audit rows must survive
    object lifecycle and remain append-only (AUD-INV-*).
  - **event_outbox / scheduler_job_runs / scheduler_dead_letters (SCH-33/34/35,
    IMP-050 architecture amendment 2026-09-11):** soft references only —
    event subjects and failed-work subjects are carried inside the minimal
    `payload` envelope as ids (AUTO-ENV-01), never as enforcing FKs; safe
    and intentional for the same reason as `audit_log` — publication and
    failure records must survive the lifecycle of the objects they describe,
    and a publication/dead-letter record must never be blocked by, or block,
    domain-row lifecycle. Tenant isolation is carried by each row's own
    `firm_id` where present, by the zero-browser-grant posture, and — in the
    BYPASSRLS scheduler context — by explicit tenancy enforcement in the
    scheduler functions (AUTO-SCH-03), never by RLS.
- **SCH-FK-04:** Composite-FK DDL details (constraint naming, cascade
  behaviour) are implementation details verified at the harness gate; the
  architectural direction above is settled.

## Requirements — Release 0 tables

### SCH-01 — firms
- **Purpose:** Tenant root (DM-01). **R0.** Tenant boundary root (not tenant-owned).
- **Columns:** `name text NOT NULL`; `frn text` (firm registration number); `city text`; `plan text NOT NULL DEFAULT 'trial'`; `settings jsonb NOT NULL DEFAULT '{}'` (reminder rules, confidence thresholds, retention policy, notification prefs, `recurrence_lookahead_days` — see the settings contract below); `status text NOT NULL DEFAULT 'onboarding'` CHECK in (`onboarding`,`active`,`suspended`,`deactivated`).
- **PK:** id. **FKs:** none.
- **Checks/invariants:** status transitions per DM-SM-01.
- **Settings contract (IMP-050 architecture amendment, 2026-09-11):**
  `settings.recurrence_lookahead_days` is the R0 recurrence look-ahead
  carrier — integer calendar days; default **90** when the key is absent
  or null; read **server-side only** by recurrence generation
  (AUTO-REC-02/AUTO-REC-10, `09`); Asia/Kolkata business-date semantics
  remain normative; future firm-specific values do NOT change recurrence
  identity or already-generated instance semantics (the SCH-12 uniqueness
  key and provenance contract are configuration-independent). No separate
  configuration table exists for this value. **Validation (2026-09-12):**
  a present value MUST be a positive integer (calendar days); an invalid
  present value (non-integer, zero, negative, or otherwise unparsable) is
  a **configuration error** — it MUST NOT silently fall back to 90, and
  recurrence evaluation for that firm MUST fail observably (recorded job
  failure, AUTO-OBS-01/SCH-34) rather than generate under an unintended
  horizon (AUTO-REC-02, `09`).
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
  The DEC-J live-lookup authorization path (equality on `user_id` + selected
  `firm_id`, checking `status`/`role` — RLS-MECH-01) is served by the
  `(firm_id, user_id)` unique index above; the IMP-004 spike (100,013
  membership rows) verified this lookup shape remains index-only at scale —
  no tiny-table scan assumption. If production query plans demand it, a
  covering `(user_id, firm_id) INCLUDE (status, role)` index may be added as
  an index-only change, not a design change.
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
- **Purpose:** Statutory identifiers (DM-06), including registration-scoped
  compliance anchors (GSTIN, TAN, PT, PF, ESI per the DM-27 matrix). **R0.**
  Tenant-owned.
- **Columns:** `legal_entity_id uuid NOT NULL`; `type text NOT NULL` CHECK in (`PAN`,`GSTIN`,`TAN`,`CIN`,`LLPIN`,`DIN`,`PT`,`PF`,`ESI`,`OTHER`); `value text NOT NULL`; `state text` (state/jurisdiction for state-scoped registrations); `meta jsonb` (**establishment/location/jurisdiction metadata** — e.g. PF EPFO establishment code context, ESI ESIC employer sub-code/branch/location, PT employer-registration vs enrolment distinction); `valid_from date`; `valid_to date`; `status text NOT NULL DEFAULT 'active'` CHECK in (`active`,`surrendered`,`expired`).
- **FKs:** `(firm_id, legal_entity_id)` → legal_entities(firm_id, id).
- **Unique:** `(firm_id, type, value)`.
- **Invariants:** **no first-class Establishment entity in R0** (DM-27 trigger note); establishment/location grouping lives in `meta` until the trigger condition fires.
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
- **Invariants:** unsigned-letter alerts derive from `status='proposed'`/`letter_status` age (DM-09); responsible partner = oversight, not execution (DM-OQ-02 resolution). **An engagement is never a compliance subject** (scope vocabulary is exactly `entity | registration | configurable`); instances may *associate* an engagement (SCH-12). Payroll-style operational service work, where needed, is modelled via engagements/tasks — not as a statutory ComplianceType (SCH-OQ-06 resolution).
- **Indexes:** `(client_id)`, `(firm_id, status)`.
- **Audit sensitivity:** HIGH.
- **RLS:** RLS-ENG-*. **Tests:** TEST-RLS-ENG-*.

### SCH-10 — compliance_types
- **Purpose:** Rule objects (DM-10; PRD §26/§124). **R0.** Hybrid ownership: NULL `firm_id` = system default; else firm-owned (TEN-06…09).
- **Columns:** `firm_id uuid` (NULL = system default); `type_key text NOT NULL`; `name text NOT NULL`; `category text NOT NULL`; `authority text`; `frequency text NOT NULL` CHECK in (`monthly`,`quarterly`,`annual`,`event`,`custom`); `due_rule jsonb NOT NULL`; `applicability jsonb`; `required_documents jsonb`; `checklist_template jsonb`; `workflow_template jsonb NOT NULL`; `client_approval_required bool NOT NULL DEFAULT false`; `filing_confirmation_required bool NOT NULL DEFAULT true`; `acknowledgement_required bool NOT NULL DEFAULT true`; `four_eyes_required bool NOT NULL DEFAULT true`; **`scope_kind text NOT NULL DEFAULT 'configurable'` CHECK in (`entity`,`registration`,`configurable`)** — the complete compliance-subject vocabulary (engagement is NOT a subject kind); **`registration_class text`** — the required registration type when `scope_kind='registration'`; **`governance_class text NOT NULL` CHECK in (`statutory`,`non_statutory`)** — deliberately NO default: every type is explicitly classified at insert (fail-closed). This is the single authoritative server-controlled statutory classification used by the SCH-32 activation gate; it is never inferred from `category` free text, caller input, browser flags, or `domain_approval_status` (R0 closure 2026-09-03); `status text NOT NULL DEFAULT 'active'` CHECK in (`active`,`deprecated`).
- **Invariants:** workflow_template validated against DM-SM-04; system rows writable only by deployment/seed (TEN-08); `registration_class` required when `scope_kind='registration'`; `scope_kind`/`registration_class` for seeded system types follow the architecture-validated Registration Scope Matrix (DM-27) — **statutory rules are not activated in production until external CA/domain sign-off** (DM-OQ-01 status). Payroll is excluded from the statutory catalogue for R0 (SCH-OQ-06 resolution). **Governance inheritance (R0 closure 2026-09-03):** a firm override whose `type_key` matches a system-default type inherits that system default's `governance_class` — a firm can NEVER turn a statutory type non-statutory to bypass the approval gate (write-path enforced); only a genuinely custom firm type (no matching system `type_key`) may be classified `non_statutory` by the firm. **Versioning (Batch 4 closure amendment):** the `frequency`/`due_rule` columns describe the type's default template; the *authoritative, applied* recurrence/due-rule content for any generated instance lives in `compliance_rule_versions` (SCH-32). Changing rule behaviour creates a new version — it never retroactively alters existing instances (AUTO-REC-07).
- **Unique:** `(type_key, firm_id)` NULLS NOT DISTINCT (one default + one override per firm per key).
- **Indexes:** `(type_key)`; `(firm_id)`.
- **Audit sensitivity:** HIGH (rule changes alter obligations; changes are security-configuration events, RLS-AAL-01/AUD-CAT-01).
- **RLS:** RLS-CTY-*. **Tests:** TEST-RLS-CTY-*, TEST-AUD-02.

### SCH-11 — client_compliance_profiles
- **Purpose:** Applicability records (DM-11; PRD §25). **R0.** Tenant-owned.
- **Columns:** `legal_entity_id uuid NOT NULL`; `compliance_type_id uuid NOT NULL`; `registration_id uuid`; `applicability_answers jsonb`; `status text NOT NULL DEFAULT 'proposed'` CHECK in (`proposed`,`active`,`suspended`,`ended`); `approved_by uuid`; `approved_at timestamptz`.
- **FKs:** `(firm_id, legal_entity_id)` → legal_entities; compliance_type_id → compliance_types (SCH-FK-03 exception — reference data); `(firm_id, registration_id)` → registrations (nullable component); approved_by → auth.users (actor identity, SCH-RESP-02).
- **Unique:** `(legal_entity_id, compliance_type_id, registration_id)` NULLS NOT DISTINCT.
- **Invariants:** only `active` profiles generate instances (DM-11); approval actor recorded (PRD §72 step 9); when the compliance type's `scope_kind='registration'`, `registration_id` must reference a registration of the declared `registration_class` (validated at write path, DM-27); the TDS PAN-based statutory exception (DM-27) may substitute a PAN registration reference. **Version resolution (Batch 4 closure amendment):** a profile does not pin a rule version; at generation time the recurrence generator resolves the compliance type's **active** rule version (SCH-32) effective for the target period and records it on the instance (SCH-12 provenance). Activation (`proposed → active`) creates no instances; `active` = eligible for future materialization by the generator (IMP-050); interim active-with-zero-instances is valid (C5 ruling).
- **Indexes:** `(legal_entity_id, status)`, `(firm_id, status)`.
- **Audit sensitivity:** HIGH (approval decision).
- **RLS:** RLS-CCP-*. **Tests:** TEST-RLS-CCP-*, TEST-AUD-02.

### SCH-12 — compliance_instances
- **Purpose:** Obligation per entity per period (DM-12). **R0.** Tenant-owned.
- **Columns:** `legal_entity_id uuid NOT NULL` (**required**, DEC-G); `compliance_type_id uuid NOT NULL`; `registration_id uuid` (DEC-G; **required where the type's `scope_kind='registration'`** — GST, TDS, PT, PF, ESI per DM-27 — **with one documented exception: TDS permits statutory PAN-based cases where TAN is not required**, in which case `registration_id` references the PAN registration or is NULL with the exception reason recorded in `period_meta`; this exception is TDS-specific and must not be generalised to ordinary TDS statement filing); `client_compliance_profile_id uuid`; `engagement_id uuid` (**optional association only** — engagement is never the compliance subject; statutory/audit compliance remains legal-entity scoped); `client_id uuid NOT NULL` (denormalized for RLS/query simplicity, trigger-maintained, never user-writable); **period — structured (SCH-OQ-01 RESOLVED):** `period_start date NOT NULL`; `period_end date NOT NULL`; `period_label text NOT NULL` (**presentation/convenience only, never authoritative**); `period_meta jsonb` (optional domain metadata: financial year, assessment year, tax quarter, statutory exception reasons — populated per family as needed, not over-modelled); `due_date date NOT NULL`; **recurrence provenance (Batch 4 closure amendment):** `rule_version_id uuid` — the applied rule version (SCH-32; NULL for manually created instances); `generation_source text NOT NULL DEFAULT 'manual'` CHECK in (`recurrence`,`manual`,`import`) — identifies recurrence-generated vs manual vs imported/seeded instances; `generated_at timestamptz` — when the generator created the instance (NULL unless `generation_source='recurrence'`); `calculated_due_date date` — the immutable due date the rule produced at generation time; `due_date` remains the *operative* date (statutory extensions change `due_date` via audited `compliance_instance.due_date_changed`, never `calculated_due_date`); `state text NOT NULL DEFAULT 'not_started'` CHECK in the ten DM-SM-04 states (`not_started`,`information_requested`,`information_received`,`preparation`,`internal_review`,`client_approval`,`ready_to_file`,`filed`,`acknowledgement_received`,`closed`); `assignee_membership_id uuid`; `reviewer_membership_id uuid`; `partner_membership_id uuid` (partner-in-charge for the obligation; PRD §43); `priority text NOT NULL DEFAULT 'normal'`; `risk_score int` (derived cache, DM-X-03); `risk_factors jsonb`; `filed_at timestamptz`; `closed_at timestamptz`; `successor_instance_id uuid`.
- **FKs:** `(firm_id, legal_entity_id)` → legal_entities; `(firm_id, registration_id)` → registrations (nullable); `(firm_id, client_compliance_profile_id)` → client_compliance_profiles; `(firm_id, engagement_id)` → engagements (nullable); `(firm_id, client_id)` → clients; compliance_type_id → compliance_types (SCH-FK-03 exception); `rule_version_id` → compliance_rule_versions (SCH-FK-03 reference-data exception family); `(firm_id, assignee_membership_id)` / `(firm_id, reviewer_membership_id)` / `(firm_id, partner_membership_id)` → firm_memberships (composite, SCH-RESP-03); **successor → composite same-firm self-FK (Ruling 2026-09-12, R7 — AUTO-SCH-03/SCH-FK-01 clarification):** `(firm_id, successor_instance_id)` → `compliance_instances(firm_id, id)`, preserving nullable successor semantics; the `(firm_id, id)` parent key already exists per the SCH-FK conventions and the composite self-FK lands with the IMP-050 implementation migration — it supersedes the plain `successor_instance_id → compliance_instances(id)` self-FK shipped at IMP-031; the generator function logic additionally enforces valid successor/cycle semantics, and this boundary never relies on RLS.
- **Checks:** `period_end >= period_start`; recurrence-generated instances must carry `rule_version_id` and `generated_at` (CHECK: `generation_source='recurrence'` implies both present).
- **Unique:** `(compliance_type_id, legal_entity_id, registration_id, period_start)` NULLS NOT DISTINCT — one instance per obligation per period. **Unchanged by the closure amendment:** the key deliberately excludes `rule_version_id`, so a new rule version can never accidentally duplicate an already-materialized obligation (compatible with the four-layer duplicate protection, AUTO-REC-03/08); a genuinely new obligation requires an explicit domain decision, not a version edit.
- **Invariants:** state transitions validated per DM-SM-04 at the write path (RPC, API-*) — the CHECK constrains values, transitions are validated by the transition function; four-eyes separation enforced where the type requires it (RLS-4EY-*); assignee/reviewer/partner may differ from the engagement's responsible partner without warning (DM-OQ-02 resolution). **Provenance immutability:** `rule_version_id`, `generation_source`, `generated_at`, and `calculated_due_date` are set at insert and never updated (update guard) — historical interpretation is permanent (AUTO-REC-07). Manual/ad-hoc instances remain fully representable with `generation_source='manual'` and no recurrence provenance. **Design note:** because rule versions are immutable once active (SCH-32), the version reference *is* the applied-rule snapshot; if future due-date computation needs inputs beyond the version row (e.g. holiday calendars), an additional immutable inputs snapshot is required and must be added before such inputs are introduced. **Transition authorization:** the transition authorization matrix (who may invoke which transition) is normative in RLS-CIN-01 (`05`).
- **Indexes:** `(firm_id, due_date, state)` — deadline board; `(firm_id, assignee_membership_id, state)` — My Work; `(client_id, period_start)`; `(firm_id, compliance_type_id, period_start)` — drill-downs; `(rule_version_id)` — provenance queries.
- **Audit sensitivity:** HIGH — state transitions, assignee changes, filing markers audited (PRD §67 example). Routine status changes do **not** require step-up MFA (RLS-AAL-02).
- **RLS:** RLS-CIN-*. **Tests:** TEST-RLS-CIN-*, TEST-AUD-03, TEST-AUTO-09.

### SCH-13 — tasks
- **Purpose:** Execution activity, instance-linked or ad-hoc (DM-13, DEC-H). **R0.** Tenant-owned.
- **Columns:** `client_id uuid NOT NULL`; `compliance_instance_id uuid` (nullable, DEC-H); `title text NOT NULL`; `description text`; `next_action text NOT NULL` (PRD §44); `status text NOT NULL DEFAULT 'open'` CHECK in (`open`,`in_progress`,`waiting`,`submitted`,`returned`,`approved`,`done`,`cancelled`); `waiting_reason text`; `due_date date`; `priority text NOT NULL DEFAULT 'normal'`; `assignee_membership_id uuid`; `reviewer_membership_id uuid`; `time_spent_minutes int NOT NULL DEFAULT 0`.
- **FKs:** `(firm_id, client_id)` → clients; `(firm_id, compliance_instance_id)` → compliance_instances (nullable); `(firm_id, assignee_membership_id)` / `(firm_id, reviewer_membership_id)` → firm_memberships (composite, SCH-RESP-03).
- **Invariants (IMP-040 closure 2026-09-04):** `status` is NEVER directly browser-writable — all DM-SM-05 transitions go through the controlled Layer-B command `transition_task` (RLS-TSK-01, API-ARCH-04); routine non-state field updates remain ordinary RLS writes where the §11 matrix permits. `waiting` requires `waiting_reason`; `returned` requires a non-empty reviewer comment created atomically with the transition (an immutable SCH-16 comment). **Subject binding:** for `compliance_instance_id IS NOT NULL`, `client_id` is server-derived/validated from the linked instance — a caller cannot create or rewrite a task with `client_id` ≠ the instance's client, and re-linking preserves the invariant; ad-hoc tasks (`compliance_instance_id IS NULL`) require a same-firm `client_id`. Four-eyes: where the task is instance-linked and the compliance type requires four-eyes, `submitted → approved` and `submitted → returned` are performed only by the assigned reviewer (RLS-4EY-03); ad-hoc tasks are not four-eyes-required by default. `reviewer_membership_id` (already in the column set above) is the required same-firm composite reference for this contract.
- **Indexes:** `(firm_id, assignee_membership_id, status, due_date)` — My Work (DEC-L); `(firm_id, client_id)`; `(compliance_instance_id)`; `(firm_id, due_date)` for overdue scans.
- **Audit sensitivity:** MEDIUM-HIGH (status transitions, reassignment).
- **RLS:** RLS-TSK-*. **Tests:** TEST-RLS-TSK-*, TEST-AUD-03.

### SCH-14 — task_dependencies
- **Purpose:** First-class task-to-task dependencies in R0 (DM-OQ-04 resolution). **R0 (schema + basic model; visualization/intelligence deferred).** Tenant-owned.
- **Columns:** `task_id uuid NOT NULL`; `depends_on_task_id uuid NOT NULL`; `dependency_type text NOT NULL DEFAULT 'finish_to_start'`.
- **FKs:** `(firm_id, task_id)` and `(firm_id, depends_on_task_id)` → tasks(firm_id, id) — composite FKs (SCH-FK-01).
- **Unique:** `(task_id, depends_on_task_id)`. **Checks:** `task_id <> depends_on_task_id`.
- **Invariants (IMP-040 closure 2026-09-04):** dependency graph must remain acyclic — enforced inside the controlled commands `add_task_dependency` / `remove_task_dependency` (RLS-TSK-02); direct browser mutation of `task_dependencies` is closed. Add path: transaction-scoped firm advisory lock → recursive cycle validation → insert, atomic commit; concurrent opposing edges (`A → B`, `B → A`) — at most one commits and the graph stays acyclic (TEST-SCH-20); verified at harness gate.
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
- **Columns:** `client_id uuid NOT NULL`; `task_id uuid`; `compliance_instance_id uuid`; `type text NOT NULL` CHECK in (`gst_reconciliation`,`tds_return`,`itr_computation`,`financial_statements`,`audit_workpaper`) — **R0 vocabulary frozen (API-OQ-01 = SCH-OQ-02 RESOLVED 2026-09-05); stable machine keys, display labels are presentation metadata; no other types in R0**; `source text NOT NULL DEFAULT 'human'` CHECK in (`human`,`ai`); `title text NOT NULL`; `note text`; `status text NOT NULL DEFAULT 'pending'` CHECK in (`pending`,`approved`,`returned`,`escalated`,`dismissed`); `priority text NOT NULL DEFAULT 'normal'`; `submitted_by_membership_id uuid NOT NULL`; `submitted_at timestamptz NOT NULL DEFAULT now()`; `decided_by_membership_id uuid`; `decided_at timestamptz`; `decision_rationale text`; `ai_output_id uuid`; `sla_due_at timestamptz`.
- **FKs:** `(firm_id, client_id)` → clients; `(firm_id, task_id)` → tasks; `(firm_id, compliance_instance_id)` → compliance_instances (nullable components); `(firm_id, submitted_by_membership_id)` / `(firm_id, decided_by_membership_id)` → firm_memberships (composite — review decisions are responsibility relationships requiring same-firm proof, SCH-RESP-01). `ai_output_id` is **reserved nullable provenance only — NO FK ships in R0** because `ai_outputs` (SCH-27) is deferred; the FK is added when SCH-27/AIOutput ships.
- **Invariants:** terminal decisions require decider + timestamp + non-empty rationale (DM-SM-06); **decider ≠ submitter on every human R0 decision (RLS-4EY-04) — `decided_by_membership_id` MUST differ from `submitted_by_membership_id`, no privileged-rank bypass**; decisions feed audit (PRD §83). **R0 AI posture:** the submission path accepts only `source='human'` and R0 human rows must satisfy `source='human' → ai_output_id IS NULL` (CHECK); AI-originated submission is deferred. **Subject binding (cross-domain hardening 2026-09-05 — no inconsistent subject combination may persist):** (a) `task_id` non-null ⇒ `client_id` MUST equal the linked task's authoritative `client_id`; (b) `compliance_instance_id` non-null ⇒ `client_id` MUST equal the linked instance's authoritative `client_id`; (c) both non-null ⇒ the linked task MUST reference exactly that instance (`tasks.compliance_instance_id = review_items.compliance_instance_id`) — a same-client-but-different-instance combination is NOT sufficient; (d) both null ⇒ `client_id` is required and identifies the ad-hoc client subject. Mirrors the IMP-040 task subject-binding pattern (SCH-13).
- **Indexes:** `(firm_id, status, priority)` — the queue; `(firm_id, submitted_by_membership_id, status)`.
- **Audit sensitivity:** HIGH (decisions).
- **RLS:** RLS-RVW-*. **Tests:** TEST-RLS-RVW-*, TEST-SCH-21…25, TEST-API-11…15, TEST-AUD-03, TEST-AUD-12.

### SCH-18 — alerts
- **Purpose:** Firm risk signals with hybrid resolution (DM-22). **R0.** Tenant-owned.
- **Columns:** `alert_rule_id uuid`; `severity text NOT NULL` CHECK in (`info`,`warning`,`critical`); `title text NOT NULL`; `detail text`; `client_id uuid`; `compliance_instance_id uuid`; `affected jsonb`; `status text NOT NULL DEFAULT 'active'` CHECK in (`active`,`acknowledged`,`snoozed`,`resolved`); `raised_at timestamptz NOT NULL DEFAULT now()`; `acknowledged_by uuid`; `acknowledged_at timestamptz`; `snoozed_until timestamptz`; `resolved_by uuid`; `resolved_at timestamptz`; `resolution_type text` CHECK in (`manual`,`auto`) — auto-resolution always audit-logged (DM-OQ-05 resolution).
- **FKs:** `(firm_id, alert_rule_id)` → alert_rules; `(firm_id, client_id)` → clients; `(firm_id, compliance_instance_id)` → compliance_instances (nullable); acknowledged_by/resolved_by → auth.users (actor identity, SCH-RESP-02).
- **Indexes:** `(firm_id, status, severity)`; `(firm_id, raised_at)`.
- **Audit sensitivity:** MEDIUM-HIGH (ack/resolution).
- **Manual transition matrix (human-ruled at IMP-042 contract
  reconciliation 2026-09-06):** all browser status writes are Layer-B
  definer commands (API-R0-ALR); direct table writes are closed.
  **ACKNOWLEDGE:** `active → acknowledged` (stamps
  `acknowledged_by`/`acknowledged_at`, server-derived actor); `snoozed →
  acknowledged` (stamps acknowledgement if not already stamped; clears
  `snoozed_until`); `acknowledged → acknowledged` returns
  `already_applied`; from `resolved` = `invalid_state` (→ `conflict`).
  **SNOOZE:** `active | acknowledged | snoozed → snoozed`;
  `snoozed_until` must be in the future; prior
  `acknowledged_by`/`acknowledged_at` are preserved; an identical
  already-applied snooze returns `already_applied`; a changed valid
  `snoozed_until` is a real audited update. **RESOLVE:** `active |
  acknowledged | snoozed → resolved` with `resolution_type='manual'`;
  where the rule's `requires_explicit_ack=true`, manual resolve requires
  `acknowledged_at IS NOT NULL` (acknowledgement-history based, not
  status-based — an acknowledged alert may subsequently be snoozed);
  `resolved → resolved` returns `already_applied`. No reopen transition
  exists in IMP-042. `resolution_type='auto'` is written only by the
  IMP-051 evaluator. **Snooze expiry:** IMP-042 adds no expiry scheduler
  and persists no expiry transition; authoritative reads derive the
  effective status — persisted `snoozed` with `snoozed_until <= now()`
  reads as `acknowledged` when `acknowledged_at IS NOT NULL`, else
  `active`; commands remain correct against an expired-but-persisted
  `snoozed` row; persisted normalization belongs to the IMP-051 evaluator.
- **Alert dedupe uniqueness invariant (human ruling HRR-06=A
  2026-09-15; the approved dedupe identity is unchanged — AUTO-ALR-02,
  `09`):** at most one NON-RESOLVED alert
  (`active`/`acknowledged`/`snoozed`) exists for the approved business
  dedupe identity `(alert_rule_id, object)` within its firm. This
  invariant MUST be enforced by a **database-level uniqueness
  mechanism** over the dedupe identity restricted to non-resolved
  status — check-then-insert alone is NOT sufficient as the correctness
  layer: concurrent creations MUST converge safely and the losing
  creation attempt persists no duplicate row (and publishes no duplicate
  `alert.created` event and no duplicate audit effect, `09`). **Resolved
  rows are EXCLUDED from the uniqueness scope (human ruling HRR-09=A
  2026-09-15):** resolved alerts remain terminal historical occurrences
  — no reopen path exists — so a later recurrence of the same condition
  creates a NEW alert occurrence carrying fresh lifecycle state
  (`raised_at`, correlation identity, acknowledgement lifecycle, and the
  rule's applicable `requires_explicit_ack` behavior); a current
  non-resolved occurrence continues to suppress duplicates.
  `resolution_type='auto'` remains evaluator-reserved — no
  browser/manual path may write it. The physical mechanism (partial
  unique index or equivalent database-level uniqueness construct) is an
  IMP-051 implementation detail within this contract; no migration SQL
  is specified here.
- **RLS:** RLS-ALR-*. **Tests:** TEST-RLS-ALR-*, TEST-AUD-03.

### SCH-19 — alert_rules
- **Purpose:** Per-firm alert rule configuration (DM-22). **R0.** Tenant-owned (firm rows seeded from templates at firm creation — no NULL-firm pattern here; TEN-09). **Seed stance (human-ruled at IMP-042 contract reconciliation 2026-09-06):** IMP-042 ships NO alert-rule seed rows and no thresholds; which rules ship enabled by default remains AUTO-OQ-04 (open) — template seeding/activation is deferred to its own authorized package/decision.
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

### SCH-32 — compliance_rule_versions (Batch 4 closure amendment)
- **Purpose:** Immutable, effective-dated versions of a compliance type's
  recurrence/frequency and due-rule definition (AUTO-REC-07/09). A
  ComplianceType describes *what* the obligation is; a rule version
  captures *which exact rule produced instances*, so generated instances
  never depend on the current mutable type configuration. **R0.**
  Hybrid ownership mirroring compliance_types: NULL `firm_id` =
  system-default version; else firm-owned (TEN-06 exception family,
  SCH-FK-03).
- **Columns:** `firm_id uuid` (NULL = system default); `compliance_type_id uuid NOT NULL`; `version int NOT NULL`; `effective_from date NOT NULL`; `effective_to date`; `frequency text NOT NULL` CHECK in (`monthly`,`quarterly`,`annual`,`event`,`custom`); `due_rule jsonb NOT NULL`; `status text NOT NULL DEFAULT 'draft'` CHECK in (`draft`,`active`,`superseded`,`deprecated`); `domain_approval_status text NOT NULL DEFAULT 'not_required'` CHECK in (`not_required`,`pending`,`approved`); `created_by uuid`; `created_at`. Deliberately NO `updated_at` — see the Conventions exception (R0 closure 2026-09-03).
- **PK:** id. **FKs:** `compliance_type_id` → compliance_types (firm scope inherited from the type row — a firm-override type yields firm-owned versions; SCH-FK-03 reference-data family); `created_by` → auth.users (actor identity, SCH-RESP-02).
- **Unique:** `(compliance_type_id, version)`.
- **Checks/invariants:**
  - **Column classes (R0 closure 2026-09-03 — reconciles immutability with
    supersession):**
    - **A. Rule-content fields** — `firm_id`, `compliance_type_id`,
      `version`, `effective_from`, `frequency`, `due_rule`: frozen once the
      version leaves `draft` (activated) OR is referenced by any compliance
      instance; no update path exists for them on such rows — not via
      ordinary UPDATE and not via the lifecycle command. Rule changes
      create a new version (update guard). Historical interpretation is
      permanent.
    - **B. Lifecycle-metadata fields** — `status`, `effective_to`:
      changeable ONLY through the controlled Layer-B lifecycle command
      (API-R0-CRV activate; RLS-CRV-04), and only along the approved
      transitions below. Ordinary UPDATE can never perform a lifecycle
      transition.
    - **C. Creation/provenance fields** — `id`, `created_by`, `created_at`:
      insert-only; never changed by any path.
    - **D. Governance-state field** — `domain_approval_status`: set at
      creation (`not_required` for legitimately non-statutory versions;
      `pending` for statutory seeds); changeable only via the deferred
      controlled approval path (no browser-facing R0 command, OPS-OQ-04);
      never by ordinary UPDATE; never by the activation command.
  - **Effective windows (normative semantics, R0 closure 2026-09-03):**
    windows are half-open — `effective_from` INCLUSIVE, `effective_to`
    EXCLUSIVE; NULL `effective_to` = open-ended. `effective_to` must be
    strictly greater than `effective_from` (zero-length windows invalid).
    For one `compliance_type_id`, the windows of versions in
    `status='active'` must NOT overlap (touching boundaries are legal:
    `[Jan 1, Apr 1)` and `[Apr 1, ∞)` do not overlap). Multiple
    `status='active'` versions per type ARE permitted when their windows
    are disjoint — including future-effective activated versions; this is
    how historical truth is preserved.
  - **Active-as-of-date predicate (OPS-ACT-02, exact):** the rule version
    applicable to compliance type X on date D is the unique version v with
    `v.compliance_type_id = X` AND `v.status = 'active'` AND
    `v.effective_from <= D` AND (`v.effective_to IS NULL` OR
    `D < v.effective_to`). Uniqueness follows from the non-overlap
    invariant; the answer derives from stored data alone.
  - **Succession model (R0 closure 2026-09-03):** activating V2 with
    `effective_from = F` closes the predecessor's window, never its
    status: if an active V1 has `effective_to IS NULL` or
    `effective_to > F`, the command sets `V1.effective_to = F`
    (class-B metadata via the controlled command); if V1's window already
    ends at or before F, V1 is untouched. **V1.status is NOT changed** —
    V1 remains `active` and remains the applicable version for its
    historical window forever; instances referencing V1 remain valid
    forever (SCH-12 provenance). `superseded`/`deprecated` are terminal
    states reserved for versions that never governed a period
    (`draft → deprecated` withdrawal; future-effective `active →
    superseded` withdrawal before effectiveness, via the command); a
    version that has governed a period must never transition to
    `superseded`/`deprecated`. Any residual window overlap after the
    approved closure fails the activation (`conflict`).
  - **Statutory activation gate:** a version whose parent type is
    `governance_class='statutory'` (SCH-10 — the single authoritative,
    server-controlled classification) must not reach `status='active'` in
    production while `domain_approval_status <> 'approved'` (DM-OQ-01).
    The approval requirement is DERIVED from the trusted parent type row
    — never from caller input, browser flags, `category` text, or
    `domain_approval_status` itself. Architecture approval of the
    Registration Scope Matrix is **not** professional statutory-rule
    approval; the gate is an explicit lifecycle invariant, not a
    convention.
  - **Approval authority (R0 closure 2026-09-03):** no browser-facing
    application role (including super_admin/partner) may set
    `domain_approval_status='approved'` on a statutory/system-default
    version — external approval cannot be manufactured through CRUD. The
    statutory `pending → approved` transition has no browser-facing R0
    command until OPS-OQ-04 (external CA/domain evidence format/storage)
    is resolved; the activation command never mutates approval state.
    Seeded statutory versions are `status='draft'` +
    `domain_approval_status='pending'` (MIG-SEED-02). Firm-owned
    non-statutory/custom versions may legitimately carry
    `domain_approval_status='not_required'` where no statutory approval
    applies.
  - No instance may reference a `draft`/`deprecated` version at generation
    time (generator invariant; write-path validated).
- **Indexes:** `(compliance_type_id, status)`; `(firm_id)`.
- **Lifecycle:** status column (`draft → active → superseded`/`deprecated`) with the R0 closure succession semantics above: normal succession closes the predecessor's *window*, not its status — a version that has governed a period stays `active` for its historical window permanently; `superseded`/`deprecated` mark only versions withdrawn without having governed. Never hard-deleted — versions are historical records.
- **Audit sensitivity:** HIGH — version creation/activation changes obligations; activation is a security/compliance-configuration event (RLS-AAL-01) and is audited (AUD-CAT-01).
- **RLS:** RLS-CRV-* (explicit rule-version family defined in `05` — Batch 4 security closure: read scoping, privileged administration, gated activation, immutability support; no policy text appears here).
- **Tests:** TEST-RLS-CRV-01…11, TEST-AUD-11, TEST-AUTO-09.

### SCH-33 — event_outbox (IMP-050 architecture amendment, 2026-09-11)
- **Purpose:** Transactional outbox / publication record — the final
  AUTO-OQ-02 mechanism (AUTO-FLOW-03): every published domain event is
  recorded **in the same transaction** as its domain mutation, so a
  committed business fact is never lost to a post-write crash; the async
  runner drains, retries, and dead-letters from this table. Also the
  replay source for manual audited re-enqueue of dead-lettered
  publications (AUTO-RPL-01/02 — dead-letter-gated in R0). **R0.**
  Tenant-owned rows; platform events use the reserved NULL-firm marker
  (AUD-EVT-03, AUTO-ENV-01). **Contract only — no migration exists until
  the IMP-050 implementation package.**
- **Columns:** `event_id uuid NOT NULL` (**publication/event-record
  identity** — it identifies THIS publication row, AUTO-ENV-01; it is
  **NOT** the consumer idempotency identity — consumer idempotency is
  domain effect-key based per AUTO-IDM-01, `09`); `event_type text NOT
  NULL` (exactly one of the 14 catalogue events, `09` — AUTO-EVT-01);
  `firm_id uuid` (NULL only per the reserved platform marker);
  `occurred_at timestamptz NOT NULL` (server-generated); `actor_type text
  NOT NULL` CHECK in (`human`,`system`,`service`,`support`);
  `actor_user_id uuid`; `service_name text` (job/automation identity when
  `actor_type` is `system`/`service`, AUD-ACT-02/03); `correlation_id
  uuid NOT NULL` (AUD-INV-06, AUTO-AUD-02); `payload jsonb NOT NULL`
  (minimal envelope per AUTO-ENV-01 — ids and the specific facts that
  changed, never full row dumps); `requeue_of uuid` (NULL on original
  publications; on a manual-requeue publication, the soft reference —
  SCH-FK-03 exception — to the ORIGINAL publication's `event_id`,
  AUTO-RPL-01/02); delivery lifecycle: `status text NOT NULL DEFAULT
  'pending'` CHECK in (`pending`,`delivered`,`failed`,`dead_lettered`) —
  `delivered` semantics per AUTO-FLOW-05 (`09`): completion of all R0
  consumers actually registered for the publication (in R0: none — a
  drain-completion record, never an external/HTTP delivery claim); retry
  metadata per AUTO-RET-01: `attempt_count int NOT NULL DEFAULT 0`,
  `next_attempt_at timestamptz` (backoff schedule; backoff parameters are
  implementation configuration, not contract), `last_error text`;
  `created_at`, `processed_at timestamptz` (set on terminal
  `delivered`/`dead_lettered`).
- **PK:** id. **Unique:** `(event_id)` — one publication record per
  `event_id`. Uniqueness guards the publication RECORD, not the domain
  fact: a manual requeue is a NEW publication row with a NEW `event_id`
  for the SAME domain fact, so duplicate domain effects are prevented by
  consumer effect keys (AUTO-IDM-01), never by `event_id`.
- **FKs:** none (soft references only — SCH-FK-03 automation-records
  exception); subject ids live inside `payload`; `requeue_of` is likewise
  a soft reference.
- **Invariants:** inserts occur only inside an approved mutation path's
  transaction (Layer-A trigger / Layer-B definer command / generator) or
  via the hardened manual recovery path (AUTO-RPL-02, `09`); `status`
  transitions follow `pending → delivered | failed`, `failed → pending`
  (retry reschedule) `| dead_lettered` (attempts exhausted → SCH-35
  record); retry of an audit-affecting event re-uses the original
  `correlation_id` (AUTO-RET-02). **Manual requeue (dead-letter-gated,
  AUTO-RPL-01/02):** applies ONLY to publications that have reached
  `dead_lettered` state — `pending`/`failed` publications remain under
  automatic retry and are never manually requeued in R0. A requeue
  creates a NEW row
  carrying the original envelope facts (`event_type`, `firm_id`,
  `occurred_at`, actor fields, `payload`) UNCHANGED, a NEW `event_id`,
  `requeue_of` = the original publication's `event_id`, and the ORIGINAL
  `correlation_id` (the original correlation chain is preserved,
  AUTO-RET-02) — a requeue is NOT a new domain fact and must NOT
  duplicate domain effects (AUTO-IDM-01 effect keys). No UPDATE of
  envelope fields (`event_id`, `event_type`, `firm_id`, `occurred_at`,
  actor fields, `payload`, `requeue_of`) after insert — only
  delivery-lifecycle metadata moves.
- **Indexes:** `(status, next_attempt_at)` — the drain query;
  `(firm_id, created_at)`; `(correlation_id)` — replay/audit tracing
  (AUTO-RPL-01); `(requeue_of)` — requeue lineage.
- **Firm attribution (AUTO-SCH-03 consequence):** `firm_id` is nullable
  and non-FK by design (reserved platform marker); in the privileged
  BYPASSRLS scheduler context there is **no RLS and no FK structural
  backstop for firm attribution** — the producing function's logic is the
  normative firm-attribution mechanism, and TEST-AUTO-08 directly
  verifies Firm A/B isolation/attribution on the scheduler path (`11`).
- **Audit sensitivity:** HIGH (publication integrity; the record itself
  is not audit — AUD-CAT-01 audit rows remain in `audit_log`).
- **RLS posture:** RLS enabled **and FORCED**; **zero browser grants** —
  no SELECT/INSERT/UPDATE/DELETE for `anon`/`authenticated` — per the
  named `05` family **RLS-EVO-01** (defined in `05` §12 by this
  amendment). Server/scheduler write posture: inserts via the approved
  transactional producer paths; drain/retry/dead-letter updates via the
  scheduler/service context only (RLS-SVC-02 audit-context stamping); the
  BYPASSRLS scheduler constraint (AUTO-SCH-03) applies — tenancy is
  enforced explicitly in function logic, never by RLS.
- **Retention/archival:** **intentionally unresolved — deferred
  boundary** (SCH-OQ-07); retention values are governed by the `08`
  retention architecture (AUD-OQ-01 OPEN — no values invented); any purge
  follows the privileged AUD-RET-02 path only; operational landing entry
  OPS-RET-01 (`13`). Delivered rows accumulate until that decision.
- **Tests:** TEST-AUTO-05/06/12.

### SCH-34 — scheduler_job_runs (IMP-050 architecture amendment, 2026-09-11)
- **Purpose:** Job-run record (AUTO-OBS-01, AUTO-PRIN-04 fail-visible):
  every scheduled run records job identity, started/finished, rows
  affected, and failure; the operational source for scheduler
  last-success health (OPS-HLT-01) and failure monitoring (OPS-MON-01).
  **R0.** **System-scoped, NOT tenant-owned** — one scheduler run spans
  firms; no `firm_id` (firm attribution of *effects* lives on the written
  domain/audit/outbox rows, linked by `correlation_id`). Contract only —
  no migration until IMP-050.
- **Columns:** `job_name text NOT NULL` (the job identity: the
  `sched.<job>.<action>` signal identity for scheduler-signal jobs
  (AUTO-PRIN-02 — e.g. `sched.recurrence.evaluate`); the infrastructure
  outbox-drain job records its runs under a distinct non-`sched.*` job
  name — it is operational infrastructure, NOT a scheduler signal
  (Ruling 2026-09-12, AUTO-SCH-04));
  `correlation_id uuid NOT NULL` (one per run, minted by the scheduler,
  carried on the signal — AUTO-ENV-02/AUTO-AUD-02); `status text NOT NULL
  DEFAULT 'running'` CHECK in (`running`,`succeeded`,`failed`);
  `started_at timestamptz NOT NULL DEFAULT now()`; `finished_at
  timestamptz`; `rows_affected int`; `error text`; `created_at`.
- **PK:** id. **FKs:** none (system record, SCH-FK-03 exception).
- **Invariants:** exactly one row per run attempt; a retry is a NEW run
  row re-using the original `correlation_id` for sensitive steps
  (AUTO-RET-02); `finished_at` and terminal `status` are set together;
  rows are never hard-deleted in R0 (retention deferred, SCH-OQ-07 —
  values per AUD-OQ-01, `08`; purge only via AUD-RET-02; OPS-RET-01 in
  `13`).
- **Indexes:** `(job_name, started_at)` — last-success-per-job derivation
  (OPS-HLT-01); `(status, started_at)`; `(correlation_id)`.
- **Audit sensitivity:** MEDIUM (operational integrity evidence; not a
  substitute for `audit_log` domain audit).
- **RLS posture:** RLS enabled; **zero browser grants** per the named
  `05` family **RLS-SJR-01** (defined in `05` §12 by this amendment);
  writes only from the scheduler/service context. AUTO-SCH-03 applies:
  the BYPASSRLS execution context means this table's integrity rests on
  grant closure and explicit function logic, not RLS.
- **Tests:** TEST-AUTO-08, TEST-OPS-07.

### SCH-35 — scheduler_dead_letters (IMP-050 architecture amendment, 2026-09-11)
- **Purpose:** Retry/dead-letter record (AUTO-RET-01): work whose bounded
  retries are exhausted lands here — nothing disappears silently
  (AUTO-PRIN-04); surfaced in operations monitoring (OPS-MON-02
  dead-letter accumulation). **R0.** Firm-scoped where the failed work
  carries a firm (`firm_id`); NULL only per the reserved platform marker.
  Contract only — no migration until IMP-050.
- **Columns:** `source text NOT NULL` CHECK in (`outbox_event`,`job_step`)
  — what exhausted; `source_id text NOT NULL` (soft reference — SCH-FK-03
  exception); `firm_id uuid`; `correlation_id uuid`; `payload jsonb NOT
  NULL` (the failed work item, minimal per AUTO-ENV-01); failure metadata:
  `failure_reason text NOT NULL`, `attempt_count int NOT NULL`,
  `first_failed_at timestamptz NOT NULL`, `last_failed_at timestamptz NOT
  NULL`; `status text NOT NULL DEFAULT 'open'` CHECK in
  (`open`,`requeued`) — `requeued` marks operator re-enqueue per
  AUTO-RPL-01 via the hardened server/operator-only recovery path
  (AUTO-RPL-02, `09`): a manual, audited operation that creates a NEW
  SCH-33 publication row with a NEW `event_id`, `requeue_of` linkage to
  the original publication, the original envelope facts unchanged, and
  the original `correlation_id` preserved (AUTO-RET-02) — NOT a new
  domain fact, no duplicate domain effects (AUTO-IDM-01); the dead-letter
  row itself is never mutated further and never
  hard-deleted in R0); `created_at`.
- **PK:** id. **FKs:** none (soft references, SCH-FK-03 exception).
- **Invariants:** append-only except the single `open → requeued`
  transition (performed only by the AUTO-RPL-02 recovery path); a
  dead-lettered outbox event also carries
  `status='dead_lettered'` on its SCH-33 row (dual visibility: per-event
  state + operational accumulation). **Resolution/replay workflow beyond
  manual audited re-enqueue is intentionally unspecified** — formal replay
  tooling is post-R0 (AUTO-RPL-01); retention deferred (SCH-OQ-07 —
  values per AUD-OQ-01, `08`; purge only via AUD-RET-02; OPS-RET-01 in
  `13`).
- **Indexes:** `(status, created_at)`; `(firm_id, created_at)`;
  `(correlation_id)`.
- **Firm attribution (AUTO-SCH-03 consequence):** `firm_id` is nullable
  and non-FK by design; in the privileged BYPASSRLS scheduler context
  there is **no RLS and no FK structural backstop for firm
  attribution** — the producing function's logic is the normative
  firm-attribution mechanism, and TEST-AUTO-08 directly verifies Firm A/B
  isolation/attribution on the scheduler path (`11`).
- **Audit sensitivity:** MEDIUM-HIGH (failed automation may indicate
  compliance-obligation gaps).
- **RLS posture:** identical binding posture to SCH-33 — RLS enabled and
  FORCED, zero browser grants, scheduler/service-context writes only,
  AUTO-SCH-03 explicit-tenancy constraint — named `05` family
  **RLS-SDL-01** (defined in `05` §12 by this amendment).
- **Tests:** TEST-AUTO-06, TEST-OPS-07.

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

## Registration Scope Matrix (DM-27 — resolved for architecture)

**Status: RESOLVED FOR ARCHITECTURE — EXTERNAL CA/DOMAIN SIGN-OFF REQUIRED
BEFORE PRODUCTION STATUTORY-RULE ACTIVATION.** (Architecture validation per
the requester's domain-scope review; this is **not** external CA
certification.) The compliance-subject vocabulary is exactly
`entity | registration | configurable`; engagement is never a subject kind.
The statutory activation gate is enforced per rule version via
`compliance_rule_versions.domain_approval_status` (SCH-32).

| Compliance family | scope_kind | registration_class | registration_id on instance | Notes | Status |
|---|---|---|---|---|---|
| GST (GSTR-1, GSTR-3B, …) | registration | GSTIN | **required** | Multi-state clients hold one GSTIN registration per state; ~one instance per GSTIN per period | Resolved for architecture; sign-off pending before production activation |
| TDS | registration | TAN | **normally required** | Architecture permits statutory PAN-based exceptions where TAN is not required (`registration_id` → PAN registration, or NULL + exception reason in `period_meta`); the exception is TDS-specific and must not be generalised to ordinary TDS statement filing | Resolved for architecture; sign-off pending |
| Income Tax / ITR | entity | — | not required | PAN is entity/taxpayer identifier/context, not the instance-scope FK | Resolved for architecture; sign-off pending |
| ROC / MCA | entity | — | not required | CIN/LLPIN identifies the entity | Resolved for architecture; sign-off pending |
| Professional Tax | registration | PT | required | State/jurisdiction-specific; distinguish employer registration vs enrolment where applicable (SCH-07 `meta`); **no single nationwide PT rule is modelled** | Resolved for architecture; sign-off pending |
| PF | registration | EPFO establishment code | required | Establishment/sub-code/location metadata on the registration (`meta`), not a separate entity in R0 | Resolved for architecture; sign-off pending |
| ESI | registration | ESIC employer code | required | Sub-code/branch/location metadata on the registration (`meta`) | Resolved for architecture; sign-off pending |
| Audit (statutory/tax) | entity | — | not required | `engagement_id` may be associated separately (SCH-12); engagement is not the compliance subject | Resolved for architecture; sign-off pending |
| Certificates / custom recurring | configurable | per configuration | resolved by the configured rule | A configured custom rule may resolve to entity or registration scope | Resolved for architecture; sign-off pending |
| Payroll | **removed from the statutory ComplianceType catalogue for R0** (SCH-OQ-06) | — | — | If needed, payroll is modelled as an operational/service/engagement workflow (engagements + tasks); statutory payroll obligations remain the separate families: TDS, PF, ESI, Professional Tax | Resolved |

**Future-model trigger (recorded):** introduce a first-class **Establishment**
entity **only if** multiple registration families require persistent
cross-registration grouping by operating location. Until that condition
fires, establishment/location/jurisdiction data lives on
`registrations.meta` (SCH-07).

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
  (recurrence, alert generation — consumes SCH-32/SCH-12 provenance per the
  Batch 4 closure amendment), `10-migration-seed.md` (fixture mapping),
  `11-testing-harness.md` (TEST-RLS/TEST-AUD definitions).

## Open Questions

| ID | Question | Owner | Status |
|---|---|---|---|
| DM-OQ-01 | Registration Scope Matrix validation | — | **RESOLVED FOR ARCHITECTURE — EXTERNAL CA/DOMAIN SIGN-OFF REQUIRED BEFORE PRODUCTION STATUTORY-RULE ACTIVATION** (not external CA certification); enforced per rule version via SCH-32 `domain_approval_status` |
| SCH-OQ-01 | Period representation | — | **Resolved:** structured `period_start`/`period_end`/`period_label` (presentation-only) + optional `period_meta` jsonb — SCH-12 |
| SCH-OQ-02 | `review_items.type` value set (mirrors demo: gst_reconciliation, tds_return, itr_computation, financial_statements, audit_workpaper?) | Batch 4 (`07`) | **Resolved 2026-09-05 (= API-OQ-01):** R0 vocabulary frozen to exactly `gst_reconciliation`, `tds_return`, `itr_computation`, `financial_statements`, `audit_workpaper` — enforced by CHECK in SCH-17; display labels are presentation metadata |
| SCH-OQ-03 | Re-inviting a removed membership: new row vs status flip — affects unique constraint | `05`/`07` | Open (= API-OQ-04) |
| SCH-OQ-04 | Same-firm referential integrity mechanism | — | **Resolved:** composite tenant FKs (SCH-FK-01…03), extended to membership responsibility references (SCH-RESP-03); DDL details verified at harness gate (SCH-FK-04) |
| SCH-OQ-05 | audit_log partitioning | — | **Resolved:** deferred for R0 — indexes + approved retention architecture suffice; partitioning later on measured volume |
| SCH-OQ-06 | Does Payroll belong in the statutory ComplianceType catalogue? | — | **Resolved:** removed from the statutory catalogue for R0; payroll = operational/service/engagement workflow if needed; statutory payroll obligations remain TDS/PF/ESI/PT |
| AUTO-XREF-01 | Recurrence rule versioning / generation provenance schema | — | **Satisfied (Batch 4 closure amendment):** SCH-32 `compliance_rule_versions` + SCH-12 provenance fields (`rule_version_id`, `generation_source`, `generated_at`, `calculated_due_date`) |
| SCH-OQ-07 | Retention/archival policy for the automation records (SCH-33 `event_outbox`, SCH-34 `scheduler_job_runs`, SCH-35 `scheduler_dead_letters`) — delivered/dead-lettered rows accumulate until decided | `13` / ops | **Open — deferred boundary (non-blocking for IMP-050):** records are never hard-deleted in R0; retention VALUES are governed by AUD-OQ-01 (`08` — OPEN; no values invented here or in `13`); any purge follows the privileged, policy-bound, audited AUD-RET-02 path only; the operations landing/reference entry is OPS-RET-01 (`13`); the decision mirrors the SCH-OQ-05 deferral pattern |

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
  ROC/MCA, Professional Tax, PF and ESI as separate rows, Payroll (removed),
  Audit, and Certificates/custom; each row carries the architecture-validated
  scope and its sign-off status.
- SCH-ACC-06: No table lacks an authorization classification; no sensitive
  table lacks an audit classification.
- SCH-ACC-07: The table inventory states exact counts — CURRENT deployed
  21 public application tables (through IMP-042) vs TARGET 24 R0 / 11
  deferred after the IMP-050 schema migration — matching the
  SCH-01…20 + SCH-32 + SCH-33/34/35 and SCH-21…31
  enumeration, and records that SCH-33/34/35 are contracts pending the
  IMP-050 migration (the 24 count is never presented as current deployed
  state).
- SCH-ACC-08: The composite tenant-FK strategy lists its applications and
  documents every exception with its safety rationale.
- SCH-ACC-09: Every tenant operational-responsibility field references
  firm_memberships via composite FK (SCH-RESP-01/03); actor-identity fields
  reference auth.users (SCH-RESP-02); the two are never conflated.
- SCH-ACC-10 (Batch 4 closure amendment): Rule history is immutable
  (SCH-32 invariants); generated instances retain full provenance
  (SCH-12: applied rule version, generation source, generation timestamp,
  calculated due date, structured period); manual instances remain
  representable; the statutory activation gate is an explicit lifecycle
  invariant (SCH-32 `domain_approval_status`); the instance uniqueness key
  is unchanged so version changes cannot duplicate obligations.
- SCH-ACC-11 (IMP-050 architecture amendment, 2026-09-11): The automation
  records carry their full contract — SCH-33 pins publication identity
  (`event_id` unique per publication record — NOT the consumer
  idempotency identity, which is the AUTO-IDM-01 domain effect key), the
  AUTO-ENV-01 envelope, correlation, requeue lineage (`requeue_of` +
  original-correlation preservation, AUTO-RPL-01/02), the delivery
  lifecycle with AUTO-FLOW-05 `delivered` semantics, retry/backoff
  metadata, and the same-transaction insert invariant; SCH-34 pins
  job-run identity, started/finished, rows-affected and failure recording
  (AUTO-OBS-01); SCH-35 pins dead-letter failure metadata and the
  append-only + manual-requeue lifecycle (AUTO-RET-01/AUTO-RPL-01/02);
  all three state the zero-browser-grant named `05` families
  (RLS-EVO-01/SJR-01/SDL-01), FORCE-RLS-where-tenant-owned,
  explicit-tenancy (AUTO-SCH-03) posture — including the
  no-RLS/no-FK-backstop firm-attribution rule verified by TEST-AUTO-08 —
  and the deferred retention boundary (SCH-OQ-07, reconciled with
  AUD-OQ-01/AUD-RET-02).

## Consequence of Change

Column/constraint changes after Batch 4 approval invalidate the API contract
and migration mapping; tenant-classification changes invalidate `03` and
`05`; weakening the composite-FK strategy (SCH-FK-01) or the
responsibility-reference rule (SCH-RESP) removes defence-in-depth layers and
requires requester sign-off. The Registration Scope Matrix is
architecture-resolved: changing a compliance type's scoping after instances
exist requires a data migration plan recorded in `10`, and production
statutory-rule activation additionally requires the external CA/domain
sign-off recorded against DM-OQ-01. The Batch 4 closure amendment (SCH-32 +
SCH-12 provenance) did not alter approved Batch 3 decisions; weakening
provenance immutability (SCH-32/SCH-12 update guards) breaks historical
interpretation (AUTO-REC-07) and TEST-AUTO-09 and requires requester
sign-off. The IMP-050 architecture amendment (SCH-33/34/35 automation
records, 2026-09-11) likewise did not alter approved Batch 3/4 decisions;
weakening the outbox same-transaction invariant (AUTO-FLOW-03), the
zero-browser-grant posture, or the AUTO-SCH-03 explicit-tenancy constraint
is a security-posture change requiring requester sign-off.
