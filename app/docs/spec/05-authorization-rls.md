# 05 — Authorization & RLS

- **Status:** Approved (architecture, Batch 3) — **Batch 4 security closure amendment approved** (explicit RLS-CRV-* family for `compliance_rule_versions`, SCH-32)
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

### 8a. Step-up authentication (AAL2) defaults — RLS-OQ-01 RESOLVED directionally

- **RLS-AAL-01:** AAL2 / recent-MFA step-up is **required** for at least:
  membership creation and removal; role changes; MFA reset/recovery;
  break-glass support activation; firm-level data export; destructive
  firm/account operations; and security configuration changes (including
  alert-rule, compliance-type, and **compliance rule-version**
  administration — including activation, RLS-CRV-03).
- **RLS-AAL-02:** Step-up is **not** required for ordinary operational
  updates (routine task or compliance status changes, comments, checklist
  completion, assignment within one's authority).
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
| Compliance types & rule versions (firm-owned) | ✔ | ✔ | propose | ✖ | ✖ |
| Compliance profiles / instances | ✔ | ✔ | ◐ portfolio | ◐ assigned | ✖ |
| Tasks / checklist / dependencies | ✔ | ✔ | ◐ assign + supervise | ◐ assigned | ✖ |
| Task comments / internal notes | ✔ | ✔ | ◐ | ◐ assigned work | ✖ |
| Review items | ✔ | ✔ decide | ◐ decide (team) | submit only | ✖ |
| Alerts / alert rules | ✔ / rules read-write | ✔ / rules read-write | alerts ◐ / rules **read-only** | alerts ◐ / rules ✖ | ✖ |
| Firm revenue / billing aggregates | ✔ | ✔ | ✖ | ✖ | ✔ (billing only) |
| Invoices (deferred) | ✔ | ✔ | ✖ | ✖ | ✔ |
| Audit log | read ✔ | read ✔ | ✖ | ✖ | ✖ |
| Risk scores / risk factors | ✔ | ✔ | ◐ | ◐ assigned | ✖ |

Client User column: see §6 (RLS-POR-02…04). External Consultant: deferred
(RLS-STF-06). Support: see §7.

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
  only (TEN-08); firm users cannot mutate them.
- **RLS-CRV-03 (activation):** version activation is privileged
  (super_admin/partner) and is a security-configuration change requiring
  AAL2 step-up (RLS-AAL-01). A statutory version may be activated only when
  `domain_approval_status='approved'` (SCH-32 lifecycle invariant,
  DM-OQ-01); the gate is enforced by the lifecycle design, not by
  convention.
- **RLS-CRV-04 (immutability support):** authorization grants **no update
  path** to a version that is `active` or referenced by any compliance
  instance; changes create a new version (SCH-32). No policy may undermine
  this invariant (RLS-X01 applies).
- **RLS-CRV-05 (service role):** service-role interaction with rule
  versions follows RLS-SVC-01/02 — confined to Edge Functions and
  operator-run scripts, self-auditing; never a casual bypass of
  application authorization.
- **RLS-CCP-01** client_compliance_profiles: read per client scoping; approve/write manager+; approval actor stamped (DM-11).
- **RLS-CIN-01** compliance_instances: read per scoping (assigned-only for senior/article); state transitions via transition RPC only (RLS-4EY-02); direct table writes limited to manager+ non-state fields.
- **RLS-TSK-01** tasks + task_dependencies + task_checklist_items: read per scoping; assignee may update own task status/fields within DM-SM-05; assignment/reassignment manager+; ad-hoc task creation any staff for own clients.
- **RLS-TCM-01** task_comments: read per task scoping; insert by any staff with task access; no update except `retracted` by author; no delete.
- **RLS-RVW-01** review_items: submitters see own; reviewers (partner/manager per matrix) see firm/team queue; decisions via decision RPC (records decider/rationale); billing denied.
- **RLS-ALR-01** alerts: read partner/manager/admin (+ senior/article for alerts on assigned work); acknowledge/snooze manager+; resolve per rule config (RLS-4EY n/a).
- **RLS-ARL-01** alert_rules (RLS-OQ-03 RESOLVED): read: super_admin, partner,
  manager (read-only); write: super_admin and partner only; all other roles
  have no alert-rule configuration access. **Every alert-rule change is
  audited** (AUD-CAT-01) and is a security-configuration change requiring
  AAL2 step-up (RLS-AAL-01).
- **RLS-AUD-01** audit_log: SELECT restricted to partner/super_admin of the owning firm; INSERT only via security-definer triggers/functions; UPDATE/DELETE granted to nobody (AUD-INV-*).
- **RLS-DOC-*/RLS-DREQ-*/RLS-RMD-*/RLS-COM-*/RLS-NTF-*/RLS-INV-*/RLS-AIO-*/RLS-INT-*/RLS-KNC-*/RLS-CPU-*** (deferred tables): intent only — tenant-scoped per §2; client-context access only per §6; full policy design lands with each feature's release spec. No deferred table ships without its RLS family being finalized first.

## 13. Storage authorization principles (deferred document work)

- **RLS-STO-01:** Private buckets only; object paths `{firm_id}/{client_id}/{document_id}/{version}` (DEC-R); storage policies mirror table RLS via the path prefix.
- **RLS-STO-02:** Downloads via short-lived signed URLs (≤ 5 min); every issuance audit-logged (AUD-*).
- **RLS-STO-03:** Portal uploads via signed upload URLs bound to a specific open request token; uploads land in quarantine prefix and are promoted only after pipeline verification (DEC-R).
- **RLS-STO-04:** No public buckets, ever. Verified by TEST-RLS-STO-* (defined in `11`).

## 14. Verification requirements (forward references to `11`)

For **every tenant-owned table** (SCH-04…SCH-32 as applicable), the harness
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
- RLS-ACC-02: Every table in `06` (SCH-01…SCH-32) is covered by exactly one
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
  and service-role restriction, with verification cases TEST-RLS-CRV-01…11.

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
