# 05 — Authorization & RLS

- **Status:** Approved (architecture, Batch 3) — **Batch 4 security closure amendment approved** (explicit RLS-CRV-* family for `compliance_rule_versions`, SCH-32) — **IMP-050 architecture amendment (2026-09-11, APPROVED 2026-09-12 by human diff review):** explicit zero-browser-grant families RLS-EVO-01 / RLS-SJR-01 / RLS-SDL-01 for the automation records (SCH-33/34/35)
- **Approval status:** Approved for architecture (Batch 3); Batch 4 security closure amendment approved (Batch 4). **DEC-J RESOLVED (2026-09-01)** by the IMP-004 Harness Gate spike + human-reviewed amendment — the Release-0 authorization mechanism is **live membership lookup** (Candidate B, RLS-MECH-01); evidence `docs/harness/dec-j-spike.md` + `docs/harness/dec-j-results.json`.

## Purpose

The **single authoritative source** for authorization and Row Level Security
behaviour ("what are you allowed to do?"). `06-database-schema.md` references
requirement IDs defined here and must not duplicate policy definitions.
Authentication ("who are you?") is owned by `04-authentication.md`.

## Scope

1. Authorization principles · 2. Tenant-isolation model · 3. Active
   firm/context model · 4. Unified identity model · 5. Staff authorization ·
   6. Client Portal authorization architecture · 7. Support/break-glass
   authorization · 8. Four-eyes controls · 9. Service-role restrictions ·
   10. Cross-tenant denial requirements · 11. Role × object × action
   permission matrix · 12. Table-level RLS intent · 13. Storage authorization
   principles (deferred documents) · 14. Verification requirements.

## Non-goals

- No authentication flows (`04`). No physical schema (`06`). DEC-J is
  **resolved** (live membership lookup — see the DEC-J section below). No
  implementation or SQL policies in Phase 2.

## 1. Authorization principles

- **RLS-PRIN-01:** RLS on the database is the enforcement boundary (DEC-J);
  application-layer hiding is UX only, never security.
- **RLS-PRIN-02:** Default deny. Every tenant-owned table has RLS enabled and
  forced; access exists only where a requirement below grants it.
- **RLS-PRIN-03:** Authorization is evaluated against the **active context**
  (staff-of-firm-X vs client-of-org-Y), never against identity alone
  (DM-X-05).
- **RLS-PRIN-04:** Privilege checks use server-side data — the **live
  membership table** (DEC-J resolved, RLS-MECH-01: the JWT supplies
  authenticated identity only; membership status and role are read live
  from the database) — never client-supplied values.

## 2. Tenant-isolation model

- **RLS-TEN-01:** Every tenant-owned row is accessible only when its
  `firm_id` matches the caller's active firm context (staff) or the firm
  owning the caller's client mapping (client users).
- **RLS-TEN-02:** Cross-tenant read/insert/update/delete must fail at the
  database level regardless of role (TEST-RLS-*-02…05 per table).
- **RLS-TEN-03:** System-default `compliance_types` rows (NULL firm_id,
  TEN-06) are readable by all authenticated staff; writable by nobody via
  application roles (TEN-08). The same reference-data pattern applies to
  system-default `compliance_rule_versions` (RLS-CRV-01/02).

## 3. Active firm / context model

- **RLS-CTX-01:** A request carries exactly one active context:
  `staff(firm_id, role)` or `client(contact_id, client_id)` — never both.
- **RLS-CTX-02:** A user with memberships in multiple firms selects an active
  firm; the selector is **untrusted context** — RLS performs a live
  membership check for the selected firm on every request (DEC-J resolved,
  RLS-MECH-01: no token refresh or claim reissue is required to propagate
  FirmMembership authorization changes). There is no "all firms" staff view.
- **RLS-CTX-03:** A person holding both staff and client relationships (AUTH-01)
  acts in one context at a time; client context can never produce staff data
  and vice versa (TEST-RLS-*-09/10).

## 4. Unified authenticated identity model

Per AUTH-01 / DM-X-05: one `auth.users` identity; zero+ FirmMemberships;
zero+ client-access mappings. Authorization derives context from the
applicable relationship. No rule in this document may assume
"staff identity ≠ client identity."

## 5. Staff authorization (by role)

- **RLS-STF-01 Super Admin (firm-scoped):** full read/write within the firm,
  including user/membership management, firm settings, alert rules,
  compliance type overrides and firm-owned rule versions. Platform-level
  operations are out of role scope.
- **RLS-STF-02 Partner:** full read of the firm's portfolio; approve/review
  work; manage engagements; administer firm-owned compliance rule versions
  (with super_admin, RLS-CRV-02); view revenue/billing aggregates;
  firm-level reports.
- **RLS-STF-03 Manager (portfolio-based, RLS-OQ-02 RESOLVED for R0):**
  read/write within the owned portfolio — clients where the manager's
  **membership** is the designated `manager_membership_id`, plus all related
  operational records within that portfolio (entities, registrations,
  contacts, engagements, profiles, instances, tasks, comments) — and tasks
  directly assigned to them (as assignee/reviewer membership) regardless of
  portfolio. Managers assign tasks and review within that scope; **no firm
  revenue aggregates**. **Advanced team-based inherited access is deferred**
  until a formal team-membership model is specified.
- **RLS-STF-04 Senior / Article-Executive:** read/write only on **assigned
  work** (tasks/compliance instances where assignee or reviewer) and the
  clients/documents needed for that work; no firm revenue, no firm-wide
  reports, no billing (PRD §65).
- **RLS-STF-05 Billing:** read clients' identity/billing data and invoices;
  **denied** audit workpapers, task content, review items, and compliance
  detail (PRD §65).
- **RLS-STF-06 External Consultant:** deferred role (not provisioned in R0
  UI); when introduced: time-boxed, engagement-scoped read/write.
- **RLS-STF-07:** Suspended or removed memberships grant nothing (AUTH-13/14);
  revocation timing per AUTH-08.

## 6. Client Portal authorization architecture (design only — Release 2)

- **RLS-POR-01:** Client users resolve through `client_portal_users`
  (SCH-31) → contact → client. Access is scoped to exactly that client
  organisation.
- **RLS-POR-02:** Readable in client context: own document requests and their
  items; own documents flagged client-visible; simple compliance status
  (mapped from internal states per PRD §55); completed deliverables; own
  invoices (when invoices ship); own communications addressed to the client.
- **RLS-POR-03:** Never readable in client context: internal notes,
  task_comments, review items, risk scores/risk factors, staff identities
  beyond display names, other clients, anything firm-wide.
- **RLS-POR-04:** Writable in client context: uploads against open request
  items (via signed upload URLs, DEC-R); message replies; own profile.
  Nothing else.
- **RLS-POR-05:** The simple-status mapping (internal 10-state →
  Completed/Processing/Waiting-for-you/Upcoming) is a projection; clients
  never see raw workflow states (PRD §55).

## 7. Support / break-glass authorization (TEN-23)

- **RLS-SUP-01:** No silent impersonation in R0. Support access requires a
  break-glass record: named support actor, firm/customer context, explicit
  reason, least-privilege scope, time-bound expiry.
- **RLS-SUP-02:** Break-glass sessions act via a security-definer path that
  stamps `actor_type='support'` and `support_session_id` into audit rows
  (AUD-*); service-role credentials are never exposed to users or browsers.
- **RLS-SUP-03:** Support-access history is reviewable (queryable audit view
  restricted to platform operators).

## 8. Four-eyes controls

- **RLS-4EY-01:** Where the compliance type requires it
  (`four_eyes_required`, SCH-10), the approval transition must enforce
  `decider <> submitter` / `reviewer <> assignee` at the write path (RPC),
  independent of role seniority (DM-13; PRD §47).
- **RLS-4EY-02:** The check is server-side (transition RPC), never client-side
  only. Verified by TEST-AUD-03 / transition tests in `11`.
- **RLS-4EY-03 (task four-eyes; IMP-040 closure 2026-09-04):** for an
  instance-linked task whose compliance type requires four-eyes
  (`four_eyes_required`, SCH-10 — inherited Task → ComplianceInstance →
  ComplianceType), `submitted → approved` and `submitted → returned` are
  performed only by the assigned reviewer: `reviewer_membership_id` must be
  an active same-firm membership and MUST differ from
  `assignee_membership_id`; no partner/super_admin/manager rank bypass.
  `submitted → returned` additionally requires a non-empty reviewer
  comment, created atomically with the transition as an immutable SCH-16
  comment. Ad-hoc tasks (no ComplianceInstance, hence no ComplianceType)
  are NOT four-eyes-required by default.
- **RLS-4EY-04 (review-item four-eyes; IMP-041 contract closure
  2026-09-05):** every human R0 review-item decision enforces
  `decider <> submitter` at the write path (`decide_review_item`, RLS-RVW-01):
  the decision actor's **live FirmMembership** MUST differ from
  `review_items.submitted_by_membership_id`. This is a ReviewItem-level rule
  on **every** human decision — it does NOT depend on the compliance type's
  `four_eyes_required` flag, role rank, or any caller-supplied flag, and it
  does NOT reuse the task assignee/reviewer comparison (RLS-4EY-03): the
  authoritative comparison is decider membership vs submitter membership.
  No privileged-rank bypass: super_admin, partner, and manager cannot decide
  an item they submitted themselves. Server-side only (RLS-4EY-02).

### 8a. Step-up authentication (AAL2) defaults — RLS-OQ-01 RESOLVED directionally

- **RLS-AAL-01:** AAL2 / recent-MFA step-up is **required** for at least:
  membership creation and removal; role changes; MFA reset/recovery;
  break-glass support activation; firm-level data export; destructive
  firm/account operations; and security configuration changes (including
  alert-rule, compliance-type, and **compliance rule-version**
  administration — including activation, RLS-CRV-03).
- **RLS-AAL-02:** Step-up is **not** required for ordinary operational
  updates (routine task or compliance status changes, comments, checklist
  completion, assignment within one's authority). **Review-item submission
  and review decisions (`submit_review_item` / `decide_review_item`,
  RLS-RVW-01) are ordinary operational workflow actions** — they require no
  additional step-up solely because they are review operations (R0 closure
  2026-09-05); normal staff authentication/MFA policy (AUTH-10) continues to
  apply.
- **RLS-AAL-03:** The exact re-authentication freshness window is an
  implementation-validated value (harness gate / `13`), not fixed here.

## 9. Service-role restrictions

- **RLS-SVC-01:** The service-role key bypasses RLS and therefore exists only
  in Edge Functions and operator-run deployment/seed scripts (TEN-18).
- **RLS-SVC-02:** Every service-role write that affects tenant data must
  stamp audit context (`actor_type='system'` or `'support'`) — no anonymous
  system writes.
- **RLS-SVC-03:** Anon-key access without a session grants nothing on
  application tables (no public policies).

## 10. Cross-tenant denial requirements

- **RLS-X01:** No policy may use `OR true`-style escape hatches; support
  access never uses tenant policies (it uses the break-glass path, §7).
- **RLS-X02:** Denial is verified, not assumed: every tenant-owned table gets
  the ten verification cases in §14.

## 11. Role × object × action permission matrix (staff, R0 objects)

Legend: ✔ full · ◐ scoped (see note) · ✖ denied · — n/a

| Object | Super Admin | Partner | Manager | Senior/Article | Billing |
|---|---|---|---|---|---|
| Firm settings / memberships | ✔ | read | ✖ | ✖ | ✖ |
| Clients / entities / registrations / contacts | ✔ | ✔ | ◐ portfolio | ◐ assigned-work clients | ◐ identity + billing fields only |
| Engagements | ✔ | ✔ | ◐ portfolio | read ◐ | read ◐ |
| Compliance types & rule versions (firm-owned) | ✔ | ✔ | read (RLS-CTY-01/RLS-CRV-01 only — see note) | ✖ | ✖ |
| Compliance profiles / instances | ✔ | ✔ | ◐ portfolio | ◐ assigned † | ✖ |
| Tasks / checklist / dependencies | ✔ | ✔ | ◐ assign + supervise | ◐ assigned | ✖ |
| Task comments / internal notes | ✔ | ✔ | ◐ | ◐ assigned work | ✖ |
| Review items | ✔ decide ‡ | ✔ decide ‡ | ◐ decide (scoped ‡) | submit only ‡ | ✖ |
| Alerts / alert rules | ✔ / rules read-write | ✔ / rules read-write | alerts ◐ / rules **read-only** | alerts ◐ / rules ✖ | ✖ |
| Firm revenue / billing aggregates | ✔ | ✔ | ✖ | ✖ | ✔ (billing only) |
| Invoices (deferred) | ✔ | ✔ | ✖ | ✖ | ✔ |
| Audit log | read ✔ | read ✔ | ✖ | ✖ | ✖ |
| Risk scores / risk factors | ✔ | ✔ | ◐ | ◐ assigned | ✖ |

Client User column: see §6 (RLS-POR-02…04). External Consultant: deferred
(RLS-STF-06). Support: see §7.

Matrix note (R0 closure 2026-09-03): the "Compliance types & rule versions"
row previously showed Manager = "propose". No proposal object, contract, or
workflow exists anywhere in the R0 specification, and default-deny
(RLS-PRIN-02) governs: Manager has read-only access to compliance types and
rule versions (RLS-CTY-01 / RLS-CRV-01) and may NOT insert, draft-edit,
change approval state, or activate. The cell is corrected accordingly; no
proposal workflow is introduced.

† Matrix note (compliance profiles / instances, Senior/Article "◐ assigned"):
instance state transitions occur via the transition RPC only, per RLS-CIN-01
— senior/article have no direct table writes on compliance_instances.

‡ Matrix note (Review items, R0 closure 2026-09-05): the former Manager cell
"◐ decide (team)" referenced a team concept that is **deferred and unspecified
in R0** (RLS-STF-03, RLS-A-02, RLS-OQ-02). R0 introduces **no**
team-membership hierarchy, no subordinate traversal, and no team table. The
resolved manager scope (RLS-RVW-01): a manager may read/decide a review item
when (a) the item's client is in the manager's existing RLS-STF-03 portfolio,
OR (b) `task_id` is non-null and the linked task is currently directly
assigned to that manager or names that manager as reviewer per the IMP-040
task-scope rules (RLS-TSK-01); an unlinked item is portfolio-scope only.
Manager submit scope equals manager read/decide scope. Senior/article may
submit only for work already inside their current assigned-work scope and may
read only their own submissions; they may never decide. Super_admin and
partner read/submit/decide firm-wide. **No role may decide an item it
submitted** (RLS-4EY-04 — decider's live FirmMembership must differ from
`submitted_by_membership_id`, no privileged-rank bypass). Billing, anon, and
the client portal have no review-item access.

## 12. Table-level RLS intent (family IDs referenced by `06`)

Note: per SCH-RESP, tenant operational-responsibility fields (owner, manager,
assignee, reviewer, partner-in-charge, review decider) reference
**firm_memberships**, so "assigned to the caller" in the policies below means
the caller's **membership** is the referenced assignee/reviewer membership;
actor-identity fields (author, approver-of-record, acknowledger) reference
`auth.users`.

- **RLS-FRM-01** firms: staff read own firm row; write restricted to super_admin. Partner read.
- **RLS-PRF-01** profiles: any authenticated user reads basic display fields of profiles they share a firm with; self may write own profile.
- **RLS-MEM-01** firm_memberships: members read own firm's memberships; write (invite/suspend/remove/role) restricted to super_admin (partner may read all).
- **RLS-CLI-01** clients: staff read per matrix §11 (partner/admin all; manager portfolio; senior/article assigned-scope; billing identity-only projection). **RLS-CLI-02:** writes restricted to manager+ within scope; client-context users read only their own client's portal projection.
- **RLS-ENT-01** legal_entities + client_relationships: same scoping as clients.
- **RLS-REG-01** registrations: same scoping as clients; writes manager+.
- **RLS-CON-01** contacts: same scoping; client-context read of own contacts (portal).
- **RLS-ENG-01** engagements: partner/manager read; partner+ write; billing read letter/fee status only.
- **RLS-CTY-01** compliance_types: all staff read (system defaults + own-firm overrides); overrides writable by super_admin/partner. Rule *versions* are covered by the separate RLS-CRV-* family below.
- **RLS-CRV-01 (read)** compliance_rule_versions: all authenticated staff
  read **active** system-default versions and same-firm versions applicable
  to their tenant workflows (RLS-TEN-01/03). Cross-tenant firm-specific
  versions are never visible. Non-active versions (`draft`,
  `superseded`, `deprecated`) are visible only to super_admin/partner —
  ordinary staff are not accidentally exposed to rules that are not in
  effect.
- **RLS-CRV-02 (write / administration):** create and draft-edit of
  firm-owned versions is restricted to super_admin/partner — the same
  privileged set as compliance-type administration (RLS-CTY-01); all other
  operational roles are denied. System/global default versions (NULL
  firm_id) are writable by nobody via application roles — migrations/seeds
  only (TEN-08); firm users cannot mutate them. **Explicit R0 closure
  (2026-09-03):** manager, senior, article, and billing roles have NO
  proposal, create, draft-edit, approval-state, or activation capability on
  rule versions — the §11 matrix's former "propose" cell is superseded; no
  proposal workflow exists in R0.
- **RLS-CRV-03 (activation):** version activation is privileged
  (super_admin/partner) and is a security-configuration change requiring
  AAL2 step-up (RLS-AAL-01). A statutory version may be activated only when
  `domain_approval_status='approved'` (SCH-32 lifecycle invariant,
  DM-OQ-01); the gate is enforced by the lifecycle design, not by
  convention. **Approval authority (R0 closure 2026-09-03):** no
  application/browser role may transition `domain_approval_status` from
  `pending` to `approved` — a browser-authenticated super_admin or partner
  must not be able to manufacture external statutory approval. The
  statutory `pending → approved` transition has **no browser-facing R0
  command** until OPS-OQ-04 (external CA/domain approval evidence
  format/storage) is resolved; the activation command never mutates
  approval state itself. **Approval derivation (R0 closure 2026-09-03):**
  whether activation requires `domain_approval_status='approved'` is
  derived from the trusted parent `compliance_types.governance_class`
  (SCH-10) — never from caller input, browser flags, `category` text, or
  `domain_approval_status` itself; a statutory-governed version can never
  satisfy the gate with `not_required`. **System-default activation
  authority (R0 closure 2026-09-03):** because TEN-08 forbids application
  roles from mutating NULL-`firm_id` rows, the browser-facing activation
  command applies to firm-owned versions ONLY and must reject
  system-default versions (fail-closed). Platform/system-default
  statutory activation belongs to a controlled operator/server path
  (Layer C, AUD-CTX-01) under the OPS-ACT-01 controls including recorded
  external CA/domain evidence; that positive path is deferred until
  OPS-OQ-04 is resolved. A partner's AAL2 browser session can never
  mutate platform reference data.
- **RLS-CRV-04 (immutability support):** authorization grants **no update
  path** to the rule-content fields (SCH-32 class A: `firm_id`,
  `compliance_type_id`, `version`, `effective_from`, `frequency`,
  `due_rule`) of a version that is `active` or referenced by any
  compliance instance; changes create a new version (SCH-32). Ordinary
  UPDATE can never perform a lifecycle transition. The ONLY permitted
  mutation of an active/referenced row is lifecycle metadata (SCH-32
  class B: `status`, `effective_to`) through the controlled Layer-B
  lifecycle command along the SCH-32 succession model — and the command
  never rewrites rule payload. No policy may undermine this invariant
  (RLS-X01 applies).
- **RLS-CRV-05 (service role):** service-role interaction with rule
  versions follows RLS-SVC-01/02 — confined to Edge Functions and
  operator-run scripts, self-auditing; never a casual bypass of
  application authorization.
- **RLS-CCP-01** client_compliance_profiles: read per client scoping; approve/write manager+; approval actor stamped (DM-11). Approval occurs through the controlled profile approval command (API-R0-CCP), which stamps `approved_by`/`approved_at` and does NOT create compliance instances (materialization is IMP-050).
- **RLS-CIN-01** compliance_instances: read per scoping (assigned-only for senior/article); state transitions via transition RPC only (RLS-4EY-02); direct table writes limited to manager+ non-state fields.
  - `state` may NEVER be changed by direct browser table UPDATE; all transitions go through the controlled Layer-B transition RPC. senior/article have no direct table mutation right on compliance_instances.
  - RPC invocation scope: super_admin — valid transitions firm-wide; partner — valid transitions firm-wide; manager — valid transitions only within manager portfolio scope (RLS-STF-03); senior/article — only when their live FirmMembership is currently the instance's `assignee_membership_id` OR `reviewer_membership_id`; billing — none; anon — none.
  - Four-eyes (where the compliance type's `four_eyes_required` applies, SCH-10): `reviewer_membership_id` MUST differ from `assignee_membership_id`; a transition leaving `internal_review` must be performed by the assigned reviewer — including the workflow-skipping `internal_review → ready_to_file` path when client_approval is skipped; this binds manager/partner/super_admin actors equally — no privileged role bypasses four-eyes by rank. Regression back to `preparation` from `internal_review` may be initiated by the assigned reviewer or a manager+ actor within scope, and is audit-logged (DM-SM-04).
- **RLS-TSK-01** tasks + task_checklist_items (IMP-040 closure 2026-09-04): read per scoping (manager portfolio + directly-assigned, RLS-STF-03; senior/article assigned-work only, RLS-STF-04; billing denied). Routine non-state field updates remain ordinary RLS writes where the §11 matrix permits; `status` may NEVER be changed by direct browser table UPDATE — all DM-SM-05 transitions go through the controlled Layer-B command `transition_task`, which authorizes BEFORE exposing task existence, current status, transition legality, workflow vocabulary, or mutation/replay information: an unauthorized/out-of-scope existing task and a nonexistent task return the identical API-ERR-02 `not_found` posture (no existence oracle).
  - Transition invocation scope (live membership lookup; suspended/removed memberships lose authorization on the next request with the same JWT): super_admin — firm-wide valid transitions; partner — firm-wide valid transitions; manager — only tasks within manager task scope (portfolio OR directly assigned to the current live membership); senior/article — ordinary transitions only where the current live membership is the current assignee (reviewer-only transitions per RLS-4EY-03); billing — none; anon — none.
  - Assignment/reassignment: manager+ within scope.
  - Ad-hoc task creation (supersedes the former "any staff for own clients" wording): super_admin/partner — any client in the active firm; manager — portfolio clients only; senior/article — only for a client ALREADY in current assigned-work scope (via an existing assigned ComplianceInstance or existing Task per this RLS model), the newly created ad-hoc task must initially assign the creator's own membership, and creation must NOT bootstrap access to an otherwise invisible client; billing — denied; anon — denied. Client-table RLS is not broadened to make task creation convenient.
- **RLS-TSK-02** task_dependencies (IMP-040 closure 2026-09-04): direct browser mutation closed; graph changes only via the controlled commands `add_task_dependency` / `remove_task_dependency`. Authorization: super_admin/partner — firm-wide; manager — BOTH referenced tasks must be inside manager-authorized task scope (RLS-TSK-01); senior/article — denied; billing — denied; anon — denied. Both tasks must be same-firm via the composite references (SCH-14); no same-client-only rule beyond existing approved SCH rules. The add path is race-safe by construction: firm-scoped transaction advisory lock, then recursive cycle validation, then insert — one atomic commit (TEST-SCH-20).
- **RLS-TCM-01** task_comments: read per task scoping; insert by any staff with task access; no update except `retracted` by author; no delete.
- **RLS-RVW-01** review_items (R0 contract closure 2026-09-05): queue/detail
  visibility — super_admin/partner firm-wide; manager scoped to portfolio
  clients (RLS-STF-03) OR items whose linked task is currently assigned to /
  reviewed by the manager's live membership (RLS-TSK-01; unlinked items are
  portfolio-only) — the deferred "team" concept is NOT a scope (§11 note ‡);
  senior/article see only their own submissions; billing denied (RLS-STF-05);
  anon denied; client portal never readable (RLS-POR-03). Submission only via
  the controlled Layer-B command `submit_review_item` (API-R0-RVW):
  super_admin/partner any client in the firm; manager/senior/article only
  inside their authorized scope above; scope and same-firm subject
  relationships are validated before the row is created. Decisions only via
  the controlled Layer-B command `decide_review_item` (records
  decider/rationale atomically; API-R0-RVW): super_admin/partner firm-wide;
  manager within scope; senior/article/billing/anon denied; **self-decision
  prohibited for every role** (RLS-4EY-04). Browser direct UPDATE of `status`
  and all decision fields is CLOSED. Both commands authorize BEFORE exposing
  existence, current status, legal decision vocabulary, transition legality,
  rationale requirements, or mutation/replay state — an unauthorized
  existing item and a nonexistent id return the identical API-ERR-02
  `not_found` surface. Live membership lookup governs every check
  (RLS-MECH-01): a suspended/removed membership loses submit/decide on the
  next request with the same JWT. **Task-linked `returned` composition
  (cross-domain hardening 2026-09-05):** a `returned` decision on a
  task-linked item additionally requires the same actor to hold the linked
  task's `submitted → returned` authority (RLS-TSK-01 scope; RLS-4EY-03
  assigned-reviewer requirement where the task is four-eyes-required) —
  no privileged-rank bypass via `decide_review_item`, and ReviewItem
  four-eyes (RLS-4EY-04) does not replace Task four-eyes; the task must be
  in a DM-SM-05 state that legally permits `→ returned`, otherwise the
  whole operation rolls back. Subject binding per SCH-17 guarantees the
  linked task/instance is never a foreign or mismatched subject.
- **RLS-ALR-01** alerts: read partner/manager/admin (+ senior/article for alerts on assigned work); acknowledge/snooze manager+; resolve per rule config (RLS-4EY n/a).
- **RLS-ARL-01** alert_rules (RLS-OQ-03 RESOLVED): read: super_admin, partner,
  manager (read-only); write: super_admin and partner only; all other roles
  have no alert-rule configuration access. **Every alert-rule change is
  audited** (AUD-CAT-01) and is a security-configuration change requiring
  AAL2 step-up (RLS-AAL-01).
- **RLS-AUD-01** audit_log: SELECT restricted to partner/super_admin of the owning firm; INSERT only via security-definer triggers/functions; UPDATE/DELETE granted to nobody (AUD-INV-*).
- **RLS-EVO-01** event_outbox (SCH-33; IMP-050 architecture amendment
  2026-09-11): **zero browser grants** — no SELECT/INSERT/UPDATE/DELETE
  for `anon`/`authenticated`, and no EXECUTE on outbox/scheduler/job
  functions for those roles (no browser access path exists). Writes are
  **scheduler/service/server-only**: inserts occur inside the approved
  transactional producer paths (Layer-A trigger / Layer-B definer command /
  generator), and drain/retry/dead-letter updates occur only from the
  scheduler/service context (RLS-SVC-02 audit-context stamping).
  **Scheduler isolation MUST NOT rely on RLS:** the cron execution context
  carries BYPASSRLS (AUTO-SCH-03, `09`), so RLS is evidence of nothing on
  the scheduler path; **explicit firm-boundary enforcement in the
  scheduler/job function logic is required**, structurally supported by
  composite same-firm FKs (SCH-FK-01…03). **Direct scheduler-path
  cross-firm tests are required** (TEST-AUTO-08, `11`); browser
  grant-closure is verified by TEST-RLS-EVO-01 (§14).
- **RLS-SJR-01** scheduler_job_runs (SCH-34; IMP-050 architecture
  amendment 2026-09-11): the same binding posture — **zero browser
  grants**; no anon/authenticated read/write/execute capability;
  scheduler/service-context writes only; because the cron execution
  context carries BYPASSRLS (AUTO-SCH-03), this table's integrity rests
  on grant closure and explicit function logic, never on RLS.
  Verification: TEST-RLS-SJR-01 (grant closure) + TEST-AUTO-08
  (scheduler-path cross-firm).
- **RLS-SDL-01** scheduler_dead_letters (SCH-35; IMP-050 architecture
  amendment 2026-09-11): the same binding posture as RLS-EVO-01 — **zero
  browser grants**, no anon/authenticated read/write/execute, writes only
  from the scheduler/service context. `firm_id` is nullable and non-FK by
  design, and in the BYPASSRLS scheduler context there is **no RLS or FK
  structural backstop for firm attribution** — the producing function's
  logic is normative, verified directly by TEST-AUTO-08 Firm A/B
  isolation/attribution (never by RLS-based tests). The manual recovery
  path (AUTO-RPL-02, `09`) is server/operator-only with no browser
  capability. Verification: TEST-RLS-SDL-01 (grant closure) +
  TEST-AUTO-08 (scheduler path).
- **RLS-DOC-*/RLS-DREQ-*/RLS-RMD-*/RLS-COM-*/RLS-NTF-*/RLS-INV-*/RLS-AIO-*/RLS-INT-*/RLS-KNC-*/RLS-CPU-*** (deferred tables): intent only — tenant-scoped per §2; client-context access only per §6; full policy design lands with each feature's release spec. No deferred table ships without its RLS family being finalized first.

## 13. Storage authorization principles (deferred document work)

- **RLS-STO-01:** Private buckets only; object paths `{firm_id}/{client_id}/{document_id}/{version}` (DEC-R); storage policies mirror table RLS via the path prefix.
- **RLS-STO-02:** Downloads via short-lived signed URLs (≤ 5 min); every issuance audit-logged (AUD-*).
- **RLS-STO-03:** Portal uploads via signed upload URLs bound to a specific open request token; uploads land in quarantine prefix and are promoted only after pipeline verification (DEC-R).
- **RLS-STO-04:** No public buckets, ever. Verified by TEST-RLS-STO-* (defined in `11`).

## 14. Verification requirements (forward references to `11`)

For **every tenant-owned table** (SCH-04…SCH-35 as applicable — for the
zero-browser-grant automation records SCH-33/34/35 the ten-case matrix
reduces to grant-closure denial for every browser role,
TEST-RLS-EVO-01/SJR-01/SDL-01 below, plus direct scheduler-path
cross-firm verification via TEST-AUTO-08), the harness
defines `TEST-RLS-<FAMILY>-01…10`:

1. same-tenant authorized access succeeds
2. cross-tenant read fails
3. cross-tenant insert fails
4. cross-tenant update fails
5. cross-tenant delete fails
6. unauthorized role fails (per matrix §11)
7. authorized role succeeds (per matrix §11)
8. suspended/removed membership loses access
9. client context cannot obtain staff-only data (RLS-POR-03)
10. staff context cannot accidentally inherit unrelated client scope (RLS-CTX-03)

Plus: **TEST-RLS-STO-*** (storage), **TEST-RLS-4EY-01** (four-eyes RPC
rejects self-approval), **TEST-RLS-SUP-01** (break-glass path leaves complete
audit trail and expires).

**TEST-RLS-CRV-01…10 (compliance_rule_versions, SCH-32):**

1. active global/default rule version readable by ordinary staff where
   appropriate (RLS-CRV-01)
2. same-firm rule version readable where authorized (RLS-CRV-01)
3. other-firm rule version unreadable (cross-tenant read fails)
4. cross-tenant insert fails
5. cross-tenant update fails
6. ordinary staff rule-version creation denied (RLS-CRV-02)
7. ordinary staff activation denied (RLS-CRV-03)
8. authorized privileged administration succeeds (super_admin/partner)
9. inactive/draft versions not exposed to ordinary staff beyond what
   workflows require (RLS-CRV-01)
10. system/default version mutation by firm users denied (RLS-CRV-02,
    TEN-08)

Plus **TEST-RLS-CRV-11:** statutory activation without
`domain_approval_status='approved'` fails (RLS-CRV-03, SCH-32 gate).

Plus (R0 closure 2026-09-03):

- **TEST-RLS-CRV-12:** ordinary UPDATE cannot transition lifecycle
  metadata (`status`, `effective_to`) on an active/referenced version —
  lifecycle transitions succeed only through the controlled Layer-B
  command, and the command never rewrites rule payload: an attempted
  payload change (`frequency`, `due_rule`, `effective_from`, …) on an
  active or instance-referenced version is rejected by every path
  (RLS-CRV-04, SCH-32 class-A guard).
- **TEST-RLS-CRV-13:** after succession, the window-closed predecessor
  remains `status='active'` for its historical window, remains readable
  per RLS-CRV-01, and instance provenance references to it stay valid
  (SCH-32 succession model, SCH-12).

Plus (IMP-050 architecture amendment 2026-09-11):

- **TEST-RLS-EVO-01 / TEST-RLS-SJR-01 / TEST-RLS-SDL-01 (automation
  records — event_outbox / scheduler_job_runs / scheduler_dead_letters,
  SCH-33/34/35):** `anon` and `authenticated` have NO read, write, or
  execute capability on the automation records or their scheduler/job
  functions (grant closure, RLS-EVO-01/SJR-01/SDL-01). Scheduler-path
  cross-firm isolation/attribution is verified directly by TEST-AUTO-08
  (`11`) — RLS-based tests are not isolation evidence in the BYPASSRLS
  cron context (AUTO-SCH-03).

## DEC-J: JWT claims vs membership lookup — RESOLVED (live membership lookup)

**Status: RESOLVED (2026-09-01).** The RLS-MECH-02 spike was executed as
IMP-004 (Harness Gate) on 2026-08-31, including a reviewer-mandated scale follow-up at
100,013 membership rows; human/security review selected **Candidate B —
live membership lookup** as the Release-0 mechanism. Evidence:
`docs/harness/dec-j-spike.md` and `docs/harness/dec-j-results.json`
(machine-readable, no secrets). The pre-spike comparison table and the
superseded provisional recommendation are preserved below as the
historical record — they no longer represent the selected mechanism.

- **RLS-MECH-01 (RESOLVED — Release-0 mechanism: live membership lookup):**
  - **Authentication vs authorization boundary.** Supabase Auth / JWT
    proves **who the user is** (authentication, owned by `04`).
    PostgreSQL RLS validates **current application relationships**
    (authorization, owned by this document). Firm membership and role are
    **not** carried in JWT claims as an authoritative Release-0
    authorization source; standard JWT identity claims remain normal
    authentication inputs.
  - **Live reads.** Authorization reads the membership table **live** on
    every request: membership status is live, role is live.
  - **Change semantics (normative).** Suspension takes effect on the next
    authorization check. Removal takes effect on the next authorization
    check. Role downgrade removes the old privilege on the next
    authorization check. A trusted role upgrade may grant the new
    privilege on the next authorization check after the membership change
    commits. **No JWT refresh is required solely to propagate
    FirmMembership authorization changes.**
  - **Active-firm context.** A request may select an active firm through
    the approved application context mechanism; that selector is
    **untrusted context**. Supplying `firm_id = X` never grants access by
    itself: RLS verifies the authenticated user holds a **current active
    membership** for X with the required current role. A forged or
    foreign selector yields no access.
  - **Multi-firm users.** One auth identity may hold multiple
    FirmMemberships. Switching Firm A → Firm B → Firm A uses the same
    authenticated identity; RLS performs the corresponding live
    membership check per switch. No role or membership authority is
    reissued into the JWT, and no authorization state bleeds between
    firms.
  - **Staff + client overlap (DM-X-05).** The selected context is
    validated against the corresponding **live** relationship. Staff
    context never inherits client-only permissions; client context never
    inherits staff-only permissions; the context selector itself is not
    proof of authorization (RLS-CTX-03).
  - **Candidate A (JWT claims only) — REJECTED.** The spike demonstrated
    stale (unexpired) tokens retaining post-suspension, post-removal, and
    post-downgrade privileges for the life of the access token.
  - **Candidate C (hybrid claim snapshot + live verification) — viable
    alternative, not selected.** C passed every security test at both
    scales but demonstrated no sufficient advantage over B to justify the
    custom authorization claim hook, the `authz_version` lifecycle, the
    stale-token refresh protocol, larger JWTs, and the additional
    operational/debugging complexity.
  - **Helper-function rules (unchanged).** Where helper functions are
    used they must preserve RLS enforcement and never become convenience
    bypasses; SECURITY DEFINER remains exceptional with pinned
    `search_path`; service-role browser use remains forbidden (RLS-SVC-*).
- **RLS-MECH-02 (spike — executed 2026-08-31; decision recorded and approved 2026-09-01, IMP-004):** all twelve
  acceptance criteria below were tested and recorded (TEST-SPIKE-J-01/02),
  plus the reviewer-mandated membership-scale follow-up: 100,000 resource
  rows per candidate table and 100,013 membership rows; 77 original + 22
  follow-up assertions, zero unexpected outcomes; no cross-tenant success
  under any candidate; B's membership lookup remained an index-only point
  lookup at 100k memberships (p50 4.20 ms / p95 5.25 ms, far inside the
  provisional p95 < 100 ms budget). The written decision record
  (TEST-SPIKE-J-03) is `docs/harness/dec-j-spike.md`, resolution approved
  by human/security review. **Backend migration is unblocked with respect
  to DEC-J.**

| Criterion | A. JWT custom claims (access-token hook) | B. Security-definer membership lookup | C. Hybrid (provisional choice) |
|---|---|---|---|
| Tenant-isolation safety | High (claims set server-side at issue) | High (reads live table) | High (claims for hot path; lookup where freshness critical) |
| Role-change freshness | Stale until token refresh (≤1 h) | Immediate | Mostly ≤1 h; critical paths (membership status) read live |
| Membership removal | Stale until refresh; mitigated by explicit revocation (AUTH-13) | Immediate | Revocation call + short token TTL |
| Active-firm switching | Clean (new token per firm) | Needs session GUC bookkeeping | Clean via claims |
| Multi-firm users | Claim carries active firm only — good | Lookup must disambiguate | Claims disambiguate |
| Client/staff overlap | Context kind in claim — explicit | Context resolved per query | Claims carry context kind |
| Performance | No per-row lookup | Per-policy subquery cost at scale | Claims on hot path; lookup on cold |
| Policy complexity | Simple policies (`jwt->>`) | Simple but slower policies | Moderate (two helper shapes) |
| Operational complexity | Hook function to maintain | None | Hook + helpers |
| Token staleness | Real risk, bounded by TTL + revocation | None | Bounded, with revocation |
| Testability | Needs token-minting in tests | Plain fixtures | Both, harness covers |

- **RLS-MECH-01-HIST (superseded — preserved for history):** the pre-spike
  provisional recommendation was Hybrid (C) — custom access-token hook
  injecting `{ context: staff|client, firm_id, role, contact_id?, client_id? }`,
  policies reading claims for the hot path with live lookups where
  freshness was critical. Superseded by the resolved RLS-MECH-01 above
  (live membership lookup) on spike evidence; do not implement the hybrid
  as the Release-0 mechanism.

  Original RLS-MECH-02 spike acceptance criteria (as executed and recorded):
  1. same-tenant access succeeds;
  2. cross-tenant denial (read/insert/update/delete);
  3. role-change freshness (time until a role change takes effect);
  4. membership suspension takes effect (timing vs the AUTH-08 promptness
     target);
  5. membership removal takes effect;
  6. active-firm switching produces a clean new context;
  7. multi-firm users resolve only the correct active firm;
  8. one auth identity holding both staff and client relationships evaluates
     the correct context (RLS-CTX-03 / DM-X-05);
  9. stale access-token behaviour (expired claims rejected);
  10. session/token refresh behaviour (rotation, refresh after context
      change);
  11. representative performance on a ~100k-row compliance_instances
      dataset (policy latency per style);
  12. policy testability and debugging complexity (how policies are
      unit-tested and diagnosed per style).
  Outcome recorded above and in `docs/harness/dec-j-spike.md`: the hybrid
  did not fail its criteria, but demonstrated no sufficient advantage over
  option B — human/security review therefore selected **option B (live
  membership lookup)** and amended this spec accordingly (2026-09-01),
  before backend migration.

## Assumptions

- RLS-A-01: ~~The custom access-token hook capability is required~~
  **Superseded by the DEC-J resolution:** no custom authorization claim
  hook is required for Release-0 authorization (live membership lookup,
  RLS-MECH-01). The hook capability was spike-verified as available and
  remains an option only for future non-authorization claims.
- RLS-A-02: R0 "portfolio" scoping for managers uses
  `clients.manager_membership_id` (designated manager is a FirmMembership);
  a team model, if added, extends rather than replaces this (RLS-OQ-02).
- RLS-A-03: **Resolved R0 interpretation (2026-09-02, IMP-020 closure
  decision A):** manager access to `client_relationships` requires BOTH
  endpoint clients to be inside the manager's current portfolio — for READ
  and for WRITE. Either-endpoint visibility was rejected: it would leak the
  identity/relationship of an out-of-portfolio client.
- RLS-A-04: **Resolved R0 interpretation (2026-09-02, IMP-020 closure
  decision B):** `list_client_identities(p_firm_id)` enforces the same
  single-active-firm model as table RLS — the caller needs a live active
  billing membership in `p_firm_id` AND `p_firm_id` must equal
  `req_active_firm()` (the request's active-firm selector). Membership in
  another firm alone grants nothing.

## Dependencies

- Upstream: `02` (DM-X-05, roles), `03` (TEN-*, break-glass principles),
  `04` (AUTH-01/08/13/14, AAL), `06` (tables incl. SCH-32, four_eyes_required
  flag).
- Downstream: `07` (RPC enforcement points), `08` (audit of authz-relevant
  actions), `11` (TEST-RLS definitions), `12` (R0 slices).

## Open Questions

| ID | Question | Owner | Status |
|---|---|---|---|
| DEC-J | Claims vs lookup mechanism | harness-gate spike (RLS-MECH-02) | **Resolved (2026-09-01):** live membership lookup (Candidate B) — IMP-004 spike + human/security review; evidence `docs/harness/dec-j-spike.md` + `dec-j-results.json` |
| RLS-OQ-01 | Which actions require AAL2 step-up? | — | **Resolved directionally:** RLS-AAL-01/02/03 (step-up for membership/role/MFA-recovery/break-glass/export/destructive/security-config — incl. rule-version administration; not for routine operational updates; freshness window implementation-validated) |
| RLS-OQ-02 | Manager "portfolio" scope in R0? | — | **Resolved:** portfolio = designated-manager clients + related operational records + directly assigned tasks (RLS-STF-03); team-based inherited access deferred |
| RLS-OQ-03 | May partners manage alert rules? | — | **Resolved:** super_admin + partner read/write; manager read-only; others none; all changes audited (RLS-ARL-01) |
| RLS-OQ-04 | Client-visible flagging of documents (RLS-POR-02): explicit per-document flag vs type-based rule? | Release 1 spec | Open |

## Acceptance Criteria

- RLS-ACC-01: All 14 mandated sections present.
- RLS-ACC-02: Every table in `06` (SCH-01…SCH-35) is covered by exactly one
  RLS family here; no policy is defined anywhere else.
- RLS-ACC-03: The permission matrix covers all eight roles against clients,
  revenue, billing, workpapers-adjacent data, tasks, review items, documents,
  internal notes, risk scores, audit log, and portal data.
- RLS-ACC-04: DEC-J comparison covers all eleven mandated criteria and ends
  in a provisional recommendation plus a concrete spike design executed at
  the harness gate. **Satisfied:** spike executed (TEST-SPIKE-J-01…03,
  IMP-004) and decision recorded — live membership lookup (2026-09-01).
- RLS-ACC-05: All ten verification cases are specified per tenant table via
  TEST-RLS-* forward references.
- RLS-ACC-06 (Batch 4 security closure): compliance_rule_versions has an
  explicit family (RLS-CRV-01…05) covering read scoping, privileged
  write/administration, gated statutory activation, immutability support,
  and service-role restriction, with verification cases TEST-RLS-CRV-01…13
  (12/13 added by the 2026-09-03 rule-governance closure).
- RLS-ACC-07 (IMP-050 architecture amendment 2026-09-11): the automation
  records (SCH-33/34/35) have explicit named families (RLS-EVO-01,
  RLS-SJR-01, RLS-SDL-01) normatively stating zero browser grants, no
  anon/authenticated read/write/execute capability,
  scheduler/service/server-only writes, the AUTO-SCH-03 constraint that
  scheduler isolation must not rely on RLS (BYPASSRLS cron context),
  explicit firm-boundary enforcement in function logic, and direct
  scheduler-path cross-firm tests (TEST-AUTO-08).

## Consequence of Change

Changing the matrix or the context model invalidates `06` references, `07`
enforcement points, and the `11` test matrix. DEC-J was resolved by the
IMP-004 spike amendment (live membership lookup, 2026-09-01); changing the
selected mechanism requires the same evidence-based amendment process —
spike, human/security review, recorded decision — before any dependent
implementation changes. Weakening the rule-version family (RLS-CRV-*) —
including the statutory activation gate (RLS-CRV-03) or immutability support
(RLS-CRV-04) — is a compliance/security-posture change requiring requester
sign-off.
