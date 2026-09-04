# 02 — Domain Model

- **Status:** Approved (Batch 2)
- **Approval status:** Approved (Batch 2). Later approved amendments: Batch 3 domain-scope validation (DM-OQ-01 resolved for architecture — DM-27 Registration Scope Matrix; Payroll removed from the statutory R0 catalogue) and Batch 4 recurrence rule-versioning/provenance cross-reference alignment. Open/provisional items remain governed by their recorded future gates — the Registration Scope Matrix is approved **for architecture only**; external practicing-CA/compliance-domain sign-off remains mandatory before production statutory-rule activation.

## Purpose

Authoritative conceptual domain model for CAOS. Defines entities, ownership,
relationships, cardinality, lifecycles, and invariants that every downstream
specification — above all `06-database-schema.md` — must implement. No SQL
types, columns-as-DDL, or migration SQL appear here; this is the conceptual
contract.

## Scope

- All 25 entities required for the approved architecture, each marked with
  its Release 0 status (DEC-T).
- Conceptual state machines for Firm, Client, Engagement, ComplianceInstance,
  Task, ReviewItem.
- The approved hierarchy (DEC-F), compliance-instance ownership default
  (DEC-G), and the unified identity model (staff and client relationships on
  one authenticated identity).

## Non-goals

- No physical schema design (fields/types/indexes) — owned by
  `06-database-schema.md`.
- No RLS policy definitions — owned by `05-authorization-rls.md`.
- No registration-scoping conventions per compliance type — explicitly
  deferred; the Registration Scope Matrix requirement is DM-27 / DM-OQ-01.
- No AI provider behaviour — owned by `20-ai-services.md` (later).

## Requirements

### Entity catalogue

R0 status legend: **R0** = in Release 0 scope (DEC-T); **DEFERRED** = modelled
now so the schema is forward-compatible, built in a later release.

---

#### DM-01 — Firm
- **Purpose:** The CA practice; the tenant root and isolation boundary (DEC-E).
- **Ownership:** Owned by the platform; operated by its users. Not tenant-owned itself — it *is* the tenant.
- **Relationships:** 1—N FirmMembership, Client, ComplianceType (firm-defined), Alert, AuditLog; 1—1 firm settings.
- **Cardinality:** One firm per tenant; a user may belong to N firms (via memberships).
- **Lifecycle:** `onboarding → active → suspended → deactivated` (suspended = billing/administrative hold, read-only; deactivated = terminal, data retained per retention policy).
- **Invariants:** All operational data resolves to exactly one firm. Deactivation never hard-deletes tenant data without the export/delete procedure (PRD §131).
- **Tenant boundary:** Root of the boundary.
- **R0 status:** R0. **Deferred:** plan/billing linkage, multi-branch support.

#### DM-02 — Profile (User)
- **Purpose:** The application mirror of one Supabase `auth.users` identity — a *person*, not a role.
- **Ownership:** Global (not tenant-owned).
- **Relationships:** 1—N FirmMembership (staff relationships, DM-03); 1—N client portal access mappings (client relationships, see DM-08 and DM-X-05). Referenced as assignee/reviewer/partner/actor across tasks, instances, review items, audit entries.
- **Lifecycle:** Mirrors auth identity: `invited → active → disabled`. Deletion is an auth concern; profile rows are retained for audit referential integrity.
- **Invariants:** A single authenticated identity may simultaneously hold staff memberships (of one or more firms) **and** client-access mappings (of one or more firms, including firms where the person is not staff). Neither relationship creates, requires, or prohibits the other. Profile contains no tenant data and no role information — staff roles live exclusively on FirmMembership (DM-03); client access lives exclusively on client-access mappings.
- **Tenant boundary:** Outside the boundary (identity plane).
- **R0 status:** R0. **Deferred:** SCIM provisioning, profile self-service polish, portal mapping implementation (Release 2).

#### DM-03 — FirmMembership
- **Purpose:** The staff tenancy edge: which user belongs to which firm, with which staff role.
- **Ownership:** Global edge table (not tenant-owned), enforced by RLS self-reference rules.
- **Relationships:** N—1 Profile, N—1 Firm.
- **Lifecycle:** `invited → active → suspended → removed` (removal is soft; historical attributions must survive).
- **Invariants:** Exactly one staff role per (user, firm). Unique (user, firm). Role changes are audit-logged. A suspended membership grants no staff access but preserves history. **A client portal access mapping never creates a FirmMembership, and a FirmMembership never creates or forbids a client portal mapping — the relationship families are independent** (DM-X-05).
- **Tenant boundary:** The boundary-defining edge for staff context.
- **R0 status:** R0. **Deferred:** team/branch grouping, capacity planning fields.

#### DM-04 — Client
- **Purpose:** The commercial relationship with a customer of the firm; anchors Client 360 (PRD §18–23, §62).
- **Ownership:** Tenant-owned (`firm_id`).
- **Relationships:** 1—N LegalEntity, Contact, Engagement, Communication, Invoice; N—1 FirmMembership (owner partner); N—1 FirmMembership (manager).
- **Cardinality:** A client has ≥ 1 legal entity (default entity at onboarding, DEC-F).
- **Lifecycle:** `onboarding → active → inactive → offboarded`.
- **Invariants:** Owner partner and manager must be active memberships of the same firm. Risk rating is a client-level attribute. **Offboarded/inactive clients: excluded from default active-client views and normal operational queues; retained per retention policy; searchable and readable by appropriately authorized roles; their historical/audit records remain available and immutable; they may never be silently deleted** (exact retention periods deferred to `13-operations-observability.md` / security policy).
- **Tenant boundary:** `firm_id` required.
- **R0 status:** R0. **Deferred:** client tags/segments, profitability rollups.

#### DM-05 — LegalEntity
- **Purpose:** A company, LLP, individual, trust, HUF, etc. through which a client operates (PRD §62).
- **Ownership:** Tenant-owned (`firm_id`); belongs to exactly one Client.
- **Relationships:** N—1 Client; 1—N Registration, ClientComplianceProfile; 1—N ClientRelationship (both directions).
- **Lifecycle:** `active → dormant → dissolved/archived`.
- **Invariants:** Entity type is fixed at creation (a Pvt Ltd does not become an LLP; a conversion creates a new entity with a relationship link).
- **Tenant boundary:** `firm_id` required (denormalized from client for RLS simplicity).
- **R0 status:** R0. **Deferred:** statutory master data sync (MCA).

#### DM-06 — Registration
- **Purpose:** A statutory identifier of a legal entity: PAN, GSTIN, TAN, CIN, DIN, etc. (PRD §18, §62).
- **Ownership:** Tenant-owned; belongs to exactly one LegalEntity.
- **Relationships:** N—1 LegalEntity; referenced by registration-scoped ComplianceInstances (DM-12, optional per DEC-G and DM-27).
- **Lifecycle:** `active → surrendered/cancelled → expired`.
- **Invariants:** (firm, registration type, value) is unique. GSTIN implies a state attribute (multi-state clients hold multiple GSTIN registrations).
- **Tenant boundary:** `firm_id` required.
- **R0 status:** R0. **Deferred:** verification against government portals.

#### DM-07 — ClientRelationship
- **Purpose:** Graph edges between legal entities (and later, persons): group entities, holding/subsidiary, directors, partners, promoters, related parties (PRD §19).
- **Ownership:** Tenant-owned.
- **Relationships:** two LegalEntity references (from/to) + relation type.
- **Lifecycle:** `active → ended` (with effective dates).
- **Invariants:** Both endpoints belong to the same firm. Self-loops forbidden.
- **Tenant boundary:** `firm_id` required.
- **R0 status:** R0 (basic group display). **Deferred:** full graph visualisation, person nodes (directors as first-class non-client persons).

#### DM-08 — Contact
- **Purpose:** Client-side personnel (CFO, accounts manager, proprietor) — recipients of requests and communications, and the anchor for client portal access.
- **Ownership:** Tenant-owned; belongs to a Client (optionally linked to a specific LegalEntity).
- **Relationships:** N—1 Client; 1—N Communication (as participant); 1—N client portal access mappings (deferred, Release 2).
- **Client portal access mapping (conceptual, DEFERRED):** links a Contact to an `auth.users` identity for portal login. The mapping **must not** create a FirmMembership, and a person holding such a mapping **may** simultaneously hold FirmMemberships elsewhere (DM-X-05). A contact may have zero mappings; a person may hold mappings to contacts in multiple firms.
- **Lifecycle:** `active → inactive`.
- **Invariants:** At least one reachable channel (email initially, DEC-Q) for primary contacts.
- **Tenant boundary:** `firm_id` required (the mapping table is tenant-owned on the client side; the identity side is global).
- **R0 status:** R0 (contacts only; portal mappings deferred to Release 2).

#### DM-09 — Engagement
- **Purpose:** The scope of professional services contracted with a client (PRD §62), including engagement-letter status.
- **Ownership:** Tenant-owned; belongs to a Client.
- **Relationships:** N—1 Client; N—1 FirmMembership (responsible partner); future link to letter document.
- **Lifecycle:** `draft → proposed → active → completed | terminated`. `proposed` means issued to client, letter pending signature.
- **Invariants:** The "unsigned engagement letter" firm alert (PRD §16) derives from engagements in `proposed` beyond a threshold. Service lines reference compliance types the firm will perform. **The responsible partner represents client responsibility/oversight, not execution ownership** — task/instance assignees and reviewers may freely differ from the engagement partner and manager, with no warning raised (DM-OQ-02 resolution).
- **Tenant boundary:** `firm_id` required.
- **R0 status:** R0 (minimal: engagement record + letter status to support alerts and applicability). **Deferred:** e-sign flow, fee schedules, engagement-letter document generation.

#### DM-10 — ComplianceType
- **Purpose:** The rule object for an obligation class (PRD §26, §124): authority, frequency, due-date rule, applicability criteria, required documents, checklist template, workflow template, and flags (client approval, filing confirmation, acknowledgement).
- **Ownership:** **Hybrid — system defaults (global reference data) + firm overrides (tenant-owned).** Resolution rules in `03-tenancy-environments.md` (TEN-06…09) and schema in `06`.
- **Relationships:** 1—N ClientComplianceProfile, ComplianceInstance.
- **Lifecycle:** `active → deprecated` (deprecated types keep history; instances continue).
- **Invariants:** Workflow template must be a valid path through the compliance state machine (DM-SM-04). Due-date rules are data, not code (PRD §124). **Registration-scoping behaviour per compliance type is defined by the Registration Scope Matrix (DM-27), not invented ad hoc.** **Statutory governance is explicit server-controlled data (SCH-10 `governance_class`), never inferred from category text or caller input; firm overrides of a statutory system type inherit its classification (R0 closure 2026-09-03).**
- **Tenant boundary:** Global rows have no `firm_id`; firm override rows do.
- **R0 status:** R0 (seeded rule library; firm editing UI may be minimal). **Deferred:** full template editor UI, per-state due-date matrices beyond seeded rules.

#### DM-11 — ClientComplianceProfile
- **Purpose:** The applicability record: which compliance types apply to which legal entity, derived from onboarding answers (PRD §25).
- **Ownership:** Tenant-owned; belongs to a LegalEntity.
- **Relationships:** N—1 LegalEntity; N—1 ComplianceType; optional N—1 Registration (per DM-27 conventions).
- **Lifecycle:** `proposed (system-suggested) → active → suspended → ended`. CA approval activates (PRD §72 step 9).
- **Invariants:** Only `active` profiles generate compliance instances. Applicability answers are stored for auditability. Profile activation does NOT itself create compliance instances: an `active` profile means "eligible for future recurrence/materialization" only; materialization is owned by the recurrence generator (IMP-050, AUTO-REC-01). An `active` profile with zero generated instances is valid and expected in the interim (C5 ruling).
- **Tenant boundary:** `firm_id` required.
- **R0 status:** R0. **Deferred:** AI-suggested profiles from extracted registrations (PRD §72 step 8 — needs AI).

#### DM-12 — ComplianceInstance
- **Purpose:** One obligation for one legal entity for one period (PRD §62) — the core unit the firm chases.
- **Ownership:** Tenant-owned; belongs to a LegalEntity (**required**, DEC-G) and optionally a Registration (optional, DEC-G; per-type conventions via DM-27).
- **Relationships:** N—1 LegalEntity; N—1 ComplianceType; N—1 Registration (nullable); optional N—1 Engagement (association only — an engagement is **never** the compliance subject; the subject vocabulary is exactly `entity | registration | configurable`, and statutory/audit compliance remains legal-entity scoped); 1—N Task, DocumentRequest; N—1 assignee/reviewer/partner (FirmMembership references — operational responsibility always proves tenant membership via the membership, never the bare Profile); successor link to the next-period instance (recurrence, PRD §29).
- **Lifecycle:** see DM-SM-04 (10-state pipeline, PRD §27).
- **Invariants:** Closing an instance spawns the next-period instance, copying assignee/reviewer/checklist (PRD §29) — via the recurrence mechanism (AUTO-*). Risk score is derived (inputs per PRD §86), stored as a computed cache, never user-edited. Due date derives from the compliance type's due-date rule + period. **Assignee/reviewer may differ from the engagement's responsible partner without warning** (DM-OQ-02 resolution); four-eyes separation (assignee ≠ reviewer where required) is enforced independently (DM-13).
- **Tenant boundary:** `firm_id` required.
- **R0 status:** R0. **Deferred:** filing execution itself (always external/manual in MVP), acknowledgement capture automation.

#### DM-13 — Task
- **Purpose:** An execution activity (PRD §43, §62): compliance-linked **or** first-class ad-hoc (DEC-H).
- **Ownership:** Tenant-owned; belongs to a Client (always) and optionally a ComplianceInstance (`compliance_instance_id` nullable, DEC-H).
- **Relationships:** N—1 Client; N—1 ComplianceInstance (nullable); N—1 assignee/reviewer (FirmMembership); 1—N TaskChecklistItem, TaskComment; **N—N task-to-task dependencies (supported in the R0 domain model and schema — DM-OQ-04 resolution).**
- **Lifecycle:** see DM-SM-05.
- **Invariants:** Every task has an explicit next-action text (PRD §44). Four-eyes: approver ≠ assignee where required by the compliance type's workflow template (PRD §47) — an independent control, unaffected by engagement-partner differences; enforcement point specified in `05`/`07`. **Applicability (IMP-040 closure 2026-09-04):** an instance-linked task inherits the four-eyes requirement from Task → ComplianceInstance → ComplianceType; an ad-hoc task has no ComplianceType and is NOT four-eyes-required by default (RLS-4EY-03). **Status transitions occur only through the controlled transition command (`05` RLS-TSK-01, `07` API-R0-TSK) — never direct browser status writes.** **Subject binding:** a task linked to a ComplianceInstance derives/validates its `client_id` from the instance (no divergence, no independent rewrite); an ad-hoc task requires a same-firm client (SCH-13, TEST-SCH-15). **Deferred (DM-OQ-04 resolution):** advanced dependency visualization, automated critical-path analysis, dependency intelligence — the data model supports dependencies; the intelligence is post-R0.
- **Tenant boundary:** `firm_id` required.
- **R0 status:** R0. **Deferred:** time tracking beyond manual minutes, workload-recommendation engine (DEC-L), dependency intelligence.

#### DM-14 — TaskChecklistItem
- **Purpose:** A checkable line within a task (from the compliance type's checklist template or ad-hoc).
- **Ownership:** Tenant-owned; belongs to a Task.
- **Lifecycle:** `open → done` (with who/when).
- **Invariants:** Template-originated items record their template source for recurrence copying (PRD §29).
- **Tenant boundary:** `firm_id` required.
- **R0 status:** R0.

#### DM-15 — TaskComment
- **Purpose:** Discussion and review remarks on a task; reviewer comments become part of audit history (PRD §46).
- **Ownership:** Tenant-owned; belongs to a Task.
- **Lifecycle:** `posted` (immutable after posting; corrections are new comments).
- **Invariants:** Author and timestamp are system-set. Deletion is prohibited; retraction is a marked new state, not removal (audit). A reviewer comment required by a four-eyes `submitted → returned` transition is created atomically with that transition and follows this same immutable-comment contract (RLS-4EY-03).
- **Tenant boundary:** `firm_id` required.
- **R0 status:** R0.

#### DM-16 — Document
- **Purpose:** A file plus metadata in the client vault (PRD §30–36, §62): classification, extracted metadata, confidence, expiry.
- **Ownership:** Tenant-owned; belongs to a Client and a LegalEntity.
- **Relationships:** 1—N DocumentVersion; N—1 Client/LegalEntity; fulfils DocumentRequest items; referenced as evidence by ReviewItems and AIOutputs.
- **Lifecycle:** `uploaded (quarantine) → processing → classified → verified → archived` (quarantine-to-verified per DEC-R).
- **Invariants:** Only `verified` documents fulfil requests. Duplicate detection compares content hashes before storing (PRD §34). Expiry-dated documents feed expiry alerts (PRD §36).
- **Tenant boundary:** `firm_id` required; storage paths tenant-scoped (DEC-R).
- **R0 status:** **DEFERRED** (Release 1; excluded from R0 per DEC-T). Modelled now for schema forward-compatibility.

#### DM-17 — DocumentVersion
- **Purpose:** One stored revision of a document (PRD §34 replace/keep-both).
- **Ownership:** Tenant-owned; belongs to a Document.
- **Invariants:** Immutable once created; versions are append-only. Content hash recorded.
- **Tenant boundary:** `firm_id` required.
- **R0 status:** **DEFERRED** (Release 1).

#### DM-18 — DocumentRequest
- **Purpose:** A structured request to a client for information (PRD §38, §62): itemised, per-item status, secure upload link.
- **Ownership:** Tenant-owned; belongs to a Client, optionally a ComplianceInstance.
- **Relationships:** 1—N request items (each: doc type, status, fulfilling document); N—1 Contact (primary recipient); 1—1 ReminderSequence.
- **Lifecycle:** `draft → sent → partially_received → received | escalated → closed`.
- **Invariants:** Item fulfilment checks the vault first — never request what the firm already holds (PRD §35). Sequence stops on receipt (PRD §39).
- **Tenant boundary:** `firm_id` required.
- **R0 status:** **DEFERRED** (Release 1). Modelled now because communications and tasks reference it.

#### DM-19 — ReminderSequence
- **Purpose:** The automated Day 0/3/5/7/9 follow-up schedule for a document request (PRD §39–40).
- **Ownership:** Tenant-owned; 1—1 with a DocumentRequest.
- **Lifecycle:** `scheduled → running → stopped (received | status_changed | manual) → completed (escalated)`.
- **Invariants:** Smart rules: no sends on holidays/after hours/after receipt (PRD §40); every send writes a Communication row.
- **Tenant boundary:** `firm_id` required.
- **R0 status:** **DEFERRED** (Release 1; R0 excludes the reminder engine, DEC-T).

#### DM-20 — Communication
- **Purpose:** The client interaction timeline: emails, reminders, portal messages, WhatsApp, notes (PRD §22, §62).
- **Ownership:** Tenant-owned; belongs to a Client.
- **Relationships:** N—1 Client; optional links to DocumentRequest, ComplianceInstance, Contact, Task.
- **Lifecycle:** `logged` (append-only; outbound: `queued → sent → failed`).
- **Invariants:** Direction (inbound/outbound) and channel are mandatory. Edits prohibited (accountability, PRD §22).
- **Tenant boundary:** `firm_id` required.
- **R0 status:** **DEFERRED** (Release 1). R0 Client 360 shows a placeholder communications tab.

#### DM-21 — ReviewItem
- **Purpose:** A unit of work awaiting reviewer decision (PRD §46, §48–50, §62): submitted work or AI-flagged finding.
- **Ownership:** Tenant-owned; belongs to a Client; usually linked to a Task or ComplianceInstance.
- **Relationships:** N—1 Task (nullable); N—1 submitted-by / decided-by (FirmMembership); optional N—1 AIOutput (when AI-sourced); evidence links to documents (deferred with documents).
- **Lifecycle:** see DM-SM-06.
- **Invariants:** Both AI output and human decision are stored (PRD §83). SLA/waiting time is derived from timestamps. Reviewer ≠ submitter where four-eyes applies.
- **Tenant boundary:** `firm_id` required.
- **R0 status:** R0 (human-sourced review items with real persistence). **Deferred:** AI-sourced items, confidence thresholds, evidence linking to documents.

#### DM-22 — Alert
- **Purpose:** A firm-level risk signal (PRD §16): deadline risk, DSC expiry, unsigned letters, receivables ageing, workload thresholds.
- **Ownership:** Tenant-owned; belongs to a Firm with optional client/compliance references.
- **Lifecycle:** `active → acknowledged | snoozed → resolved`. (Snooze returns to active after expiry.)
- **Invariants:** Alerts are generated by rules (AlertRule config), not hand-created; each alert cites its rule and affected entities. Severity is rule-defined. **Hybrid resolution model (DM-OQ-05 resolution):** rule-derived/system alerts may auto-resolve when the triggering condition no longer exists — auto-resolution must be audit-logged; human/manual alerts require explicit authorized resolution; some rule alerts require explicit acknowledgement even after the condition clears (per rule configuration). Detailed transitions are specified in `06`/`09`.
- **Tenant boundary:** `firm_id` required.
- **R0 status:** R0 (rule set: deadline-risk, workload, unsigned-engagement-letter; receivable-ageing arrives with invoices). **Deferred:** document-expiry alerts (need documents), full rule editor UI.

#### DM-23 — Notification
- **Purpose:** Per-user in-app notification with digest semantics (PRD §70).
- **Ownership:** Tenant-owned; addressed to one FirmMembership.
- **Lifecycle:** `unread → read`; digest grouping by type.
- **Invariants:** Priority/escalation semantics per PRD §70 ("do not overwhelm").
- **Tenant boundary:** `firm_id` required.
- **R0 status:** **DEFERRED** (R0 derives the bell badge from live alert/review counts, as the current demo does). **Deferred:** digest engine, email/push channels.

#### DM-24 — Invoice
- **Purpose:** A professional-fee receivable (read-only/imported per DEC-M).
- **Ownership:** Tenant-owned; belongs to a Client.
- **Lifecycle:** `issued → partially_paid → paid | written_off`; ageing derived from due date.
- **Invariants:** Source of truth is external (import); rows record import provenance.
- **Tenant boundary:** `firm_id` required.
- **R0 status:** **DEFERRED** (DEC-M; arrives as read-only receivables in a later release).

#### DM-25 — AuditLog
- **Purpose:** Immutable record of sensitive actions (PRD §67): actor, timestamp, IP, object, action, previous/new values.
- **Ownership:** Tenant-owned rows (firm-scoped); the mechanism is platform-level (triggers, DEC-O).
- **Lifecycle:** `written` (terminal; no update, no delete).
- **Invariants:** Append-only; no user-modifiable path exists. Retention per firm policy (PRD §66).
- **Tenant boundary:** `firm_id` required (platform/system entries may use a reserved marker, specified in `08`).
- **R0 status:** R0 (audit foundation, DEC-T item 5).

#### DM-26 — AIOutput
- **Purpose:** Stored record of any AI generation: model, prompt/context reference, output, confidence, evidence links, and the human decision (PRD §83–84).
- **Ownership:** Tenant-owned.
- **Relationships:** referenced by ReviewItems, Documents (classification), Communications (drafts).
- **Invariants:** AI output is never an action; it becomes action only via a recorded human decision (guardrails, PRD §52).
- **Tenant boundary:** `firm_id` required.
- **R0 status:** **DEFERRED** (no real AI in R0, DEC-T). Modelled now because audit and review designs reference it.

---

#### DM-27 — Registration Scope Matrix (requirement)

The **Registration Scope Matrix** lives in `06-database-schema.md` and
records, for each compliance family, whether its instances key off
`registration_id` (and which registration class) or off the legal entity
alone. **Status: resolved for architecture** (GST/TDS registration-scoped
with classes GSTIN/TAN; Income Tax and ROC/MCA entity-scoped; PT/PF/ESI
registration-scoped with state/establishment metadata; Payroll removed from
the statutory catalogue for R0; Audit entity-scoped with optional engagement
association; Certificates/custom configurable) — **subject to external
practicing-CA sign-off before production statutory-rule activation** (this is
not external CA certification). The architectural default stands:
`legal_entity_id` required, `registration_id` optional (DEC-G), required per
family only as the matrix declares. A first-class **Establishment** entity is
deliberately not introduced in R0; establishment/location/jurisdiction data
lives in registration metadata. Future-model trigger: introduce Establishment
only if multiple registration families require persistent cross-registration
grouping by operating location.

---

### State machines (conceptual)

#### DM-SM-01 — Firm
```
onboarding → active ⇄ suspended → deactivated
```
- `suspended`: read-only for all tenant users; billing/administrative cause.
- `deactivated`: terminal; data retained per retention policy, export available (PRD §131).

#### DM-SM-02 — Client
```
onboarding → active ⇄ inactive → offboarded
```
- `onboarding`: questionnaire/profile in progress (PRD §72).
- `offboarded`: terminal; excluded from default views and queues, searchable/readable by authorized roles, read-only, history retained (DM-04 invariants).

#### DM-SM-03 — Engagement
```
draft → proposed → active → completed
                       └→ terminated
```
- `proposed`: letter issued, signature pending — drives unsigned-letter alerts.
- `terminated`: early end; reason required.

#### DM-SM-04 — ComplianceInstance (PRD §27, verbatim pipeline)
```
Not Started → Information Requested → Information Received → Preparation
→ Internal Review → Client Approval → Ready to File → Filed
→ Acknowledgement Received → Closed
```
- Any state may carry a flagged exception condition (at-risk is a
  **derived flag**, not a state — computed from risk inputs, PRD §86).
- Regression transitions are allowed only backward to `Preparation` (e.g.
  reviewer return), and are audit-logged.
- `Closed` triggers recurrence: next-period instance created (PRD §29).
- Workflow templates may skip optional states (e.g. no Client Approval when
  the compliance type's flag is off) but may not reorder the pipeline.
- Transition authorization (who may invoke which transition) is normative in
  `05` (RLS-CIN-01 transition matrix); state changes occur only through the
  controlled transition RPC (API-R0-CIN, API-ARCH-04) — never by direct
  table UPDATE.

#### DM-SM-05 — Task
```
open → in_progress → submitted (in review) → approved → done
        ↑                └→ returned ────────┘
        └→ waiting (blocked) → in_progress
done → (reopen, audit-logged) | cancelled (from any non-terminal state)
```
- `returned` sends the task back to the assignee with reviewer comments.
- `waiting` records the blocker (dependency, client information).

#### DM-SM-06 — ReviewItem
```
pending → approved | returned | escalated | dismissed
```
- `returned`: routes work back to the preparer (task transitions to `returned`).
- `escalated`: re-assigns decision to a higher role; remains pending-decision for audit purposes until decided.
- All terminal decisions record decider, timestamp, and rationale (PRD §46).

---

### Cross-entity invariants

- DM-X-01: Every tenant-owned row resolves to exactly one `firm_id`; no
  cross-firm references are permitted except platform-level identity
  (Profile) and relationship edges (FirmMembership, client portal mappings).
- DM-X-02: Client 360 is the query hub (PRD §63): every client-related
  entity is reachable from Client within two joins.
- DM-X-03: Derived values (risk score, ageing, waiting time) are computed
  from stored facts; they may be cached but never hand-edited.
- DM-X-04: Nothing in this model requires real AI in R0; AI-dependent
  entities are marked DEFERRED.
- **DM-X-05 (unified identity):** One `auth.users` identity maps to zero or
  more FirmMemberships **and** zero or more client portal access mappings,
  independently. A client mapping never creates a staff membership; a staff
  membership never creates or forbids a client mapping; duplicate auth
  identities must never be created merely because a person holds both staff
  and client relationships. Authorization evaluates the applicable
  relationship and active context (`05-authorization-rls.md`).

## Assumptions

- DM-A-01: The current fixture model (`src/data/types.ts`) informs naming but
  does not constrain this model; mismatches (e.g. fixtures lack LegalEntity,
  Engagement, Registration as separate concepts) are intentional corrections.
- DM-A-02: A client always has at least one legal entity; "individual" clients
  get a default individual entity (DEC-F consequence).
- DM-A-03: Alerts derive from rules stored as data; the R0 rule set is
  deliberately minimal.

## Dependencies

- Upstream: `01-decisions.md` (DEC-E, DEC-F, DEC-G, DEC-H, DEC-K, DEC-T).
- Downstream: `03-tenancy-environments.md` (ownership classification),
  `06-database-schema.md` (physical design; hosts the DM-27 matrix),
  `05-authorization-rls.md` (access rules per entity; context evaluation per
  DM-X-05), `09-automation-events.md` (recurrence, alert rules and
  auto-resolution), `11-testing-harness.md` (state-machine tests).

## Open Questions

| ID | Question | Owner spec | Status |
|---|---|---|---|
| DM-OQ-01 | Registration-scoping conventions per compliance type | — | **RESOLVED FOR ARCHITECTURE — EXTERNAL CA/DOMAIN SIGN-OFF REQUIRED BEFORE PRODUCTION STATUTORY-RULE ACTIVATION** (see DM-27 and the matrix in `06`) |
| DM-OQ-02 | Assignee/reviewer vs engagement partner divergence | — | **Resolved:** divergence allowed, no warning; engagement partner = oversight, not execution; four-eyes enforced independently (DM-09/12/13) |
| DM-OQ-03 | Offboarded-client visibility | — | **Resolved:** excluded from default views/queues; searchable/readable by authorized roles; immutable history retained; never silently deleted; retention periods deferred to `13` |
| DM-OQ-04 | Task dependencies in R0? | — | **Resolved:** model + schema support task-to-task dependencies in R0; visualization, critical-path analysis, and dependency intelligence deferred (DM-13) |
| DM-OQ-05 | Alert auto-resolution? | — | **Resolved:** hybrid — rule alerts may auto-resolve (audit-logged) and/or require explicit acknowledgement per rule config; manual alerts require explicit authorized resolution (DM-22); transitions detailed in `06`/`09` |

## Acceptance Criteria

- DM-ACC-01: All 25 mandated entities are defined with purpose, ownership,
  relationships, cardinality, lifecycle, invariants, tenant boundary, R0
  status, and deferred capabilities.
- DM-ACC-02: The Client → LegalEntity → Registration hierarchy is preserved
  everywhere; no entity contradicts DEC-F/DEC-G/DEC-H.
- DM-ACC-03: State machines exist for Firm, Client, Engagement,
  ComplianceInstance, Task, ReviewItem; the ComplianceInstance machine matches
  PRD §27's ten states.
- DM-ACC-04: Registration-scoping is an explicit open question with a named
  validation artifact (DM-27 Registration Scope Matrix) and CA-domain
  validation gate — not silently resolved.
- DM-ACC-05: Every entity excluded from R0 by DEC-T is marked DEFERRED with
  its target release noted.
- DM-ACC-06: The unified identity model (DM-X-05) is stated; no text implies
  staff and client identities are mutually exclusive or duplicate.

## Consequence of Change

This model keys the physical schema (06), the RLS matrix (05), and the API
contract (07). Changing entity ownership, the hierarchy, the identity model,
or a lifecycle after Batch 3 approval invalidates those specs and requires
re-review; changes are recorded as superseding requirements, never silent
edits.

## Approval Status

Approved (Batch 2). Later approved amendments: Batch 3 domain-scope
validation (DM-OQ-01 resolved for architecture via the DM-27 Registration
Scope Matrix; Payroll removed from the statutory ComplianceType catalogue
for R0 — SCH-OQ-06 in `06`) and Batch 4 recurrence rule-versioning /
generation-provenance cross-reference alignment (AUTO-XREF-01, SCH-32 /
SCH-12 in `06`). Open/provisional items remain governed by their recorded
future gates — in particular, the Registration Scope Matrix is approved
**for architecture only**; external practicing-CA / compliance-domain
sign-off remains mandatory before production statutory-rule activation.
This approval is not professional CA certification.
