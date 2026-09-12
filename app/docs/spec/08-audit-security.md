# 08 — Audit & Security Architecture

- **Status:** Approved (architecture, Batch 3) — **Batch 4 security closure amendment approved** (explicit audit classification for `compliance_rule_versions`, SCH-32)
- **Approval status:** Approved for architecture (Batch 3); Batch 4 security closure amendment approved (Batch 4). Note: AUD-OQ-01 (retention values) remains open/provisional as recorded. **AUD-OQ-02 is RESOLVED (2026-09-01): layered A+B+C audit-context propagation (IMP-005 harness-gate spike; §11 AUD-CTX-01).**

## Purpose

Defines the Release 0 security and audit architecture: threat boundaries, the
immutable audit event model, the actor model, how old/new values are captured
in the database, how IP/user-agent/correlation context crosses the request
boundary, support/break-glass auditing, MFA-recovery auditing, retention
classification, and verification obligations. Implements the approved hybrid
direction (DEC-O).

## Scope

The twenty mandated areas (§1–§20 below), at design level, for Release 0.

## Non-goals

- No implementation; no SQL; no trigger code.
- No enterprise SIEM/SOC design (see `13-operations-observability.md` for
  operational logging basics).
- Documents/portal audit specifics beyond principles (their releases extend
  this model, they do not redefine it).

## Requirements

### 1. Security principles

- **AUD-PRIN-01:** Security is a product feature (PRD §66): encryption at rest
  and TLS in transit are platform-given (Supabase); everything above that —
  isolation, auditability, least privilege — is ours.
- **AUD-PRIN-02:** Audit is written by the system, not by application
  willingness: data-mutation capture lives in triggers/controlled DB
  functions so no code path can forget it.
- **AUD-PRIN-03:** Fail closed: if audit context or an audit write for a
  sensitive operation fails, the operation fails (no silent pass).

### 2. Threat boundaries

- **AUD-THR-01:** Trust boundaries: (a) browser → PostgREST/RPC; (b) browser
  → Edge Functions; (c) Edge Functions/service-role → database (bypasses RLS);
  (d) platform operator console; (e) future: client portal context.
- **AUD-THR-02:** The service-role path (c) is the highest-consequence
  boundary: all its tenant-affecting writes must self-audit (RLS-SVC-02).

### 3. Tenant-isolation security assumptions

- **AUD-TEN-01:** Isolation rests on: RLS correctness (`05`), the DEC-J
  mechanism outcome, the `firm_id` discipline (TEN-02), and the composite
  tenant-FK layer (SCH-FK-01). Audit cannot compensate for a broken policy —
  hence the TEST-RLS-* matrix is a security control, not a nicety.
- **AUD-TEN-02:** AI context assembly must be single-firm (TEN-10); when AI
  ships, prompt-assembly paths become audit-relevant.

### 4. Authentication-related security dependencies

- **AUD-AUTH-01:** Depends on `04`: mandatory TOTP MFA for all staff
  (AUTH-10), session policy (AUTH-08), prompt revocation (AUTH-13/14),
  recovery procedure (AUTH-11). Audit consumes these as event sources.

### 5. Authorization-related security dependencies

- **AUD-AUTHZ-01:** Depends on `05`: context model (RLS-CTX-*), four-eyes
  (RLS-4EY-*), break-glass (RLS-SUP-*), service-role restrictions
  (RLS-SVC-*), and rule-version authorization (RLS-CRV-*). Audit records
  their exercise.

### 6. Audit event model

- **AUD-EVT-01:** One `audit_log` row (SCH-20) per event: `firm_id`,
  actor fields (§10: `actor_type`, `actor_user_id`, `service_name`,
  `support_session_id`), `action`, `object_type`, `object_id`, `old_value`,
  `new_value`, `ip`, `user_agent`, `correlation_id`, server-generated
  `created_at`.
- **AUD-EVT-02:** Two event classes: **data mutations** (trigger-captured,
  old/new row snapshots) and **security/business events** (login, MFA
  recovery, break-glass, export, URL issuance, auto-resolution, retention
  maintenance) written via a security-definer audit function.
- **AUD-EVT-03:** Platform-level entries (no owning firm) use
  `firm_id = NULL` with `actor_type` of `system` or `service` — the
  documented reserved marker (DM-25).

### 7. Sensitive action catalogue (R0)

- **AUD-CAT-01:** Audited: authentication events (login success/failure,
  logout, password reset); MFA enrolment/challenge/recovery; membership
  invite/role-change/suspend/remove; firm settings and alert-rule changes;
  compliance profile approval; compliance-instance state transitions;
  task status transitions and reassignment; review-item submission; review
  decisions (with rationale); alert acknowledge/snooze/resolve (including
  auto-resolution, DM-OQ-05); engagement status changes; client status
  changes (incl. offboarding); **compliance rule-version lifecycle
  (AUD-CRV-01)**; break-glass session open/close and every action inside
  one;
  data export/delete operations; retention maintenance executions
  (AUD-RET-02); (deferred releases add: document URL issuance, portal logins,
  reminder sends, AI decisions).

### 7a. Compliance rule-version audit (Batch 4 security closure)

- **AUD-CRV-01 — classification.** Compliance rule-version administration
  (SCH-32) is **security/compliance-sensitive**: it changes what obligations
  exist and when they are due. Audited events: rule version **created**;
  rule version **changed while mutable/draft**; rule version **activated**;
  rule version **superseded/deprecated**; **every controlled lifecycle-
  command metadata transition** — status changes and `effective_to` window
  closures on otherwise immutable active/referenced rows (SCH-32 class B,
  R0 closure 2026-09-03) — with old/new values; **domain-approval status
  change**; **activation attempt denied** (security-significant denial,
  AUD-FAIL-01); and any **privileged rule administration** path (including
  service-role/seed writes, AUD-SVC-01).
- **AUD-CRV-02 — record content.** Each rule-version audit row captures,
  where applicable: actor (per the §10 actor model); firm context (`firm_id`,
  or the NULL platform marker for system-default versions, AUD-EVT-03);
  `object_type='compliance_rule_version'` with the version id; the parent
  compliance type; old/new values (AUD-VAL-01 — including the
  approval-state transition); correlation/request context
  (`correlation_id`, IP/UA per AUD-CTX-*); server-generated timestamp
  (AUD-INV-02).
- **AUD-CRV-03 — actor distinguishability.** Seed/migration and system
  writes to rule versions carry `actor_type='system'`/`'service'` with a
  `service_name`; they must never masquerade as a human (AUD-ACT-05).
  Activation by a privileged human carries `actor_type='human'` with the
  administrator's `actor_user_id` and the AAL2 step-up context where
  applicable (RLS-CRV-03, RLS-AAL-01).

### 7b. Task audit partition (IMP-040 closure 2026-09-04)

- **Layer A (baseline trigger audit):** ordinary permitted non-state task
  writes, checklist writes, and comment append/retraction receive baseline
  audit capture with old/new snapshots per the existing sensitivity
  conventions (tasks MEDIUM-HIGH; comments MEDIUM; SCH-13…16).
- **Layer B (controlled commands, atomic mutation + audit):**
  `transition_task` executions (including the atomic reviewer-return
  comment of RLS-4EY-03) and the dependency-graph commands
  `add_task_dependency` / `remove_task_dependency` where
  security-significant. Actor identity is server-derived via the trusted
  audit-context mechanism (AUD-CTX-01); no browser-controlled actor
  stamps.
- **Denials:** unauthorized probes on the controlled commands follow the
  approved API-ERR-02 / AUD-FAIL-01 posture — an existing but invisible
  object is audited server-side as a security-significant denial, a
  nonexistent object gets no invented audit row, and neither leaks through
  the caller response.
- Task event **publication** is not part of audit and not part of IMP-040:
  `task.created` / `task.assigned` / `task.completed` publication is wired
  at IMP-050 through the resolved transactional outbox mechanism
  (AUTO-OQ-02 RESOLVED 2026-09-11 — SCH-33) — see `09`.

### 7c. Review-item audit partition (IMP-041 contract closure 2026-09-05)

- **Layer B (controlled commands, atomic mutation + audit):**
  `submit_review_item` and `decide_review_item` (RLS-RVW-01, API-R0-RVW)
  perform the mutation and its audit write in one transaction; actor
  identity is server-derived via the trusted audit-context mechanism
  (AUD-CTX-01) — no browser-controlled actor stamps. Audit action names:
  `review_item.submitted`, `review_item.decided`, `review_item.submit_denied`,
  `review_item.decide_denied`. The decision audit row records the rationale
  and the old/new decision fields; for a task-linked `returned` decision the
  atomic task transition and the single immutable SCH-16 reviewer comment are
  audited within the same transaction (no separate caller-visible steps).
- **Layer A:** ordinary review-item table writes are not a supported path —
  submission and decision are Layer-B commands (RLS-RVW-01); any residual
  permitted non-decision writes receive baseline trigger capture with old/new
  snapshots (review_items HIGH, SCH-17). Layer-B commands suppress the Layer-A
  row-trigger via the established skip-flag convention (`app.audit_skip_trigger`)
  so one controlled command never double-logs across layers.
- **Denials:** unauthorized probes on either command follow the approved
  API-ERR-02 / AUD-FAIL-01 posture — an existing but invisible item is audited
  server-side as a security-significant denial, a nonexistent id gets no
  invented audit row, and neither leaks through the caller response.
- **Replay:** an idempotent mutation-key retry (API-MUT-03) returns the
  original result and writes **no** second audit row.
- **Fail closed:** if the audit write fails, the submission/decision fails
  (AUD-PRIN-03, AUD-CTX-05) — no partial decision persistence (DM-SM-06).
- Review event **publication** is not part of audit and not part of IMP-041:
  `review.submitted` / `review.completed` publication is wired at IMP-050
  through the resolved transactional outbox mechanism (AUTO-OQ-02 RESOLVED
  2026-09-11 — SCH-33) — see `09`.
- **Scheduler-actor alignment (AUTO-SCH-03, 2026-09-11):** scheduler-originated
  writes execute in a BYPASSRLS context, so tenant isolation there is
  enforced explicitly by function logic, never by RLS; every such write
  stamps `actor_type='system'`/`'service'` with `service_name` (AUD-ACT-02,
  RLS-SVC-02) and carries the run's `correlation_id` (AUD-INV-06,
  AUTO-AUD-02) into both `audit_log` and the SCH-33 publication record.
  **Manual automation recovery (AUTO-RPL-02, `09`)** uses the same
  existing taxonomy — the operator-run re-enqueue audits with
  `actor_type='service'` + `service_name`, records the recovery reason
  and the source publication/dead-letter identity, and preserves the
  original correlation chain (AUTO-RET-02); no new actor type is
  introduced.

### 8. Immutable audit-log requirements (invariants)

- **AUD-INV-01:** `audit_log` is **append-only for all application roles and
  ordinary service paths**: no UPDATE and no DELETE privilege exists for any
  application role, including super_admin (RLS-AUD-01). Retention purging is
  **not** an ordinary DELETE — see AUD-RET-02.
- **AUD-INV-02:** Timestamps are server-generated (`now()` default);
  client-supplied timestamps are ignored.
- **AUD-INV-03:** Tenant ownership is explicit on every row (or the NULL
  platform marker, AUD-EVT-03).
- **AUD-INV-04:** System, service, and support entries are distinguishable
  from human actors via `actor_type`; support entries additionally carry
  `support_session_id` (§10).
- **AUD-INV-05:** Audit write failure on a sensitive operation aborts the
  operation (AUD-PRIN-03).
- **AUD-INV-06:** Security-sensitive events carry a `correlation_id` linking
  related entries (request ↔ mutations ↔ notifications) where possible.

### 9. Old/new value capture

- **AUD-VAL-01:** Mutation triggers record `old_value = to_jsonb(OLD)` and
  `new_value = to_jsonb(NEW)` for UPDATE; NEW only for INSERT; OLD only for
  DELETE (PRD §67).
- **AUD-VAL-02:** Column-redaction list: secrets-adjacent or bulk-noise
  columns (none identified in R0 tables; confirmed during implementation) may
  be excluded per table — the exclusion list itself is documented here when
  set.

### 10. Actor model

`auth.uid()` alone is not the actor model — it identifies only interactive
human sessions. Audit records **actor identity** (auth.users-based per
SCH-RESP-02); tenant operational responsibility (assignee, reviewer, owner)
is a separate concept referenced via firm_memberships in the operational
tables (SCH-RESP-01) and appears in audit rows inside old/new values. The
actor model distinguishes four actor classes (SCH-20 columns):

- **AUD-ACT-01 — `human`:** `actor_user_id` = the authenticated user
  (`auth.uid()` inside triggers for interactive writes; explicit parameter
  via the security-definer event function otherwise). Required and
  sufficient.
- **AUD-ACT-02 — `system`:** platform-internal processes (recurrence engine,
  alert generation/auto-resolution, login-history mirroring).
  `actor_user_id` is NULL; `service_name` records the job identity
  (e.g. `recurrence`, `alert-engine`).
- **AUD-ACT-03 — `service`:** service-role / Edge Function / automation
  writes. `actor_user_id` is NULL; `service_name` records the function or
  automation identity.
- **AUD-ACT-04 — `support`:** break-glass access. `actor_user_id` = the
  named support actor's user id **and** `support_session_id` links to the
  break-glass session — both required.
- **AUD-ACT-05 (invariant):** **System/service operations must never
  masquerade as a human user.** Rows with `actor_type` of `system` or
  `service` must have NULL `actor_user_id`; rows with `actor_type='support'`
  must have both `actor_user_id` and `support_session_id`; rows with
  `actor_type='human'` must have `actor_user_id`. Enforced by CHECK and by
  the write paths; verified by TEST-AUD-09.

### 11. Audit-context propagation (AUD-OQ-02 — RESOLVED 2026-09-01)

**PostgreSQL does not automatically know a trustworthy client IP or
user-agent; this is designed, not assumed.** The candidate families below
were evaluated empirically by the IMP-005 harness-gate spike (31/31 checks;
`docs/harness/audit-context-spike.md`,
`docs/harness/audit-context-results.json`). Lettering: the resolved layers
are **Layer A = database-trigger baseline**, **Layer B = explicit RPC
boundary**, **Layer C = controlled server boundary**; the historical option
letters in this table map Layer A → option B, Layer B → option A,
Layer C → option C.

| Option | Mechanism | Strengths | Weaknesses |
|---|---|---|---|
| A. Request-scoped DB context | RPC wrapper sets a transaction GUC (`set_config('app.audit_ctx', …)`) before mutations; triggers read it | Explicit, testable, works for any write | Only covers RPC-routed writes; raw table writes bypass it |
| B. Request-header GUC in triggers | Triggers read Supabase-provided request headers (`request.headers` setting) for IP/UA | Covers plain PostgREST table writes with zero app discipline | Header trust depends on proxy chain (IP is best-effort, `x-forwarded-for` spoofable); availability must be verified |
| C. Edge Function / server wrapper | Server boundary computes context and calls a security-definer `write_audit_event()` | Full control; required anyway for system/security events | Doesn't cover direct table writes by itself |

- **AUD-CTX-01 (RESOLVED 2026-09-01) — layered propagation A+B+C.**
  Release 0 uses three non-overlapping layers:
  - **Layer A — database-trigger baseline.** Ordinary authenticated
    **human** mutations permitted through normal table/PostgREST paths are
    captured by database audit triggers. The trusted actor is derived from
    `auth.uid()` — never from caller-provided `actor_user_id`,
    `actor_type`, `user_id`, or equivalent identity headers.
    `actor_type='human'` derives from the authenticated request context;
    firm/object context derives from the validated operation/row, not from
    browser claims.
  - **Layer B — explicit RPC boundary.** Security-sensitive / privileged
    commands (AUD-CTX-04) execute through explicit RPCs that derive the
    actor from `auth.uid()`, validate the selected firm against the
    **live** FirmMembership relationship (DEC-J, `05` RLS-MECH-01), reject
    foreign/suspended/removed relationships, never accept caller-supplied
    authoritative actor identity, and perform the required mutation and
    audit write atomically. SECURITY INVOKER is preferred; SECURITY
    DEFINER remains exceptional and requires explicit authorization, a
    pinned safe `search_path`, minimal privileges, and security review.
    No generic RLS-bypass RPCs.
  - **Layer C — controlled server boundary.** System / service / support
    operations execute only through a controlled server-side boundary
    (Supabase Edge Function, controlled application server, or approved
    backend worker — the architecture is not bound to one runtime).
    Server-only privileged credentials (service role) never reach the
    browser. Non-human operations carry explicit `actor_type`
    (`system` / `service` / `support`) with `service_name` /
    `support_session_id` per the §10 actor model; a
    system/service/support actor never masquerades as a human
    `auth.users` identity (AUD-ACT-05).
  - **Decision history:** the IMP-005 implementer recommendation was B+C
    with A as optional defense-in-depth; human/security review selected
    the **layered A+B+C** model so audit coverage of ordinary direct
    authenticated mutations does not depend on forcing every write
    through an RPC.
- **AUD-CTX-02 (amended 2026-09-01):** IP is recorded as **best-effort
  evidence, never sole identity proof**; actor identity is always per the
  §10 actor model. Request metadata — `correlation_id`, `request_id`,
  user-agent, IP-related headers, X-Forwarded-For — is **metadata** unless
  produced/normalized by a trusted server/proxy boundary (Layer C). It must
  never establish actor identity, actor type, firm authorization, or
  privileges. The spike demonstrated that caller-controlled XFF arrives
  with gateway-appended peer hops: the client portion is spoofable; only
  gateway/server-asserted hops carry (limited) trust. XFF is never
  authoritative client identity; metadata is recorded honestly according
  to its provenance.
- **AUD-CTX-03 (closed 2026-09-01):** Header availability/trust and the
  GUC mechanism were verified by the IMP-005 spike (TEST-SPIKE-CTX-01/02):
  `request.headers` is visible to SQL on both PostgREST table writes and
  RPC calls; transaction-local context is pooling-safe (zero cross-request
  leakage, sequential and concurrent); session-level GUC state is
  pooling-unsafe and is prohibited for audit context. Recorded
  production-design note: under RLS, `INSERT … RETURNING` applies
  SELECT-visibility to returned rows — audit-write paths must not rely on
  RETURNING against tables the caller cannot read.
- **AUD-CTX-04 (new) — sensitive-operation routing.** Layer B candidates
  include at minimum: firm membership / role changes; MFA recovery
  administration; break-glass/support administration; statutory rule
  activation / administration; destructive security-sensitive operations;
  privileged exports where applicable; and operations already classified
  AAL2/security-sensitive (RLS-AAL-01). Routine CRUD is **not** forced
  through RPCs solely for audit: a direct PostgREST/table mutation is
  allowed where normal RLS authorization suffices, Layer A provides the
  required audit coverage, and the operation is not classified as
  requiring an explicit privileged command boundary (API-ARCH-03/04
  remain the routing contract).
- **AUD-CTX-05 (new) — fail-closed auditing.** For
  security/compliance-sensitive mutations, the mutation and its required
  audit record succeed or fail together (AUD-PRIN-03, AUD-INV-05): if the
  required audit write fails, the sensitive mutation fails / rolls back.
  The IMP-005 spike demonstrated transactional fail-closed behavior on
  both the trigger path and the RPC path; best-effort audit is not
  acceptable for security-sensitive state changes.
- **AUD-CTX-06 (new) — DEC-J consistency.** Firm authorization on every
  audit path remains `auth.uid()` + selected firm/context → live
  FirmMembership validation → current status/role (`05` RLS-MECH-01). No
  audit mechanism may reintroduce JWT role/membership claims as an
  authoritative authorization source.

### 12. Authentication / login history

- **AUD-LOGIN-01:** Login history combines: Supabase `auth.audit_log_entries`
  (platform auth events) mirrored into `audit_log` by a scheduled job, plus
  application-level session events where needed (AUTH-18 for portal, later).
- **AUD-LOGIN-02:** Failed-login events are retained (security signal, PRD
  §66 login history).

### 13. Support / break-glass audit

- **AUD-SUP-01:** No silent customer impersonation in R0 (TEN-23). Break-glass
  requires: named support actor; explicit firm/customer context; recorded
  reason; least-privilege scope; time-bound expiry.
- **AUD-SUP-02:** Session open, every action within, and session close are
  audit rows linked by `support_session_id` (actor model AUD-ACT-04).
- **AUD-SUP-03:** Support-access history is reviewable by platform operators
  (RLS-SUP-03) **and visible to the affected firm's Super Admin and Partner
  roles** (read-only; AUD-OQ-03 RESOLVED). The history itself remains
  immutable and audited (AUD-INV-*).

### 14. MFA reset / recovery audit

- **AUD-MFA-01:** Every AUTH-11 recovery writes an audit row: admin actor,
  target user, verification method, factor revocation, timestamp.
  MFA enrolment and challenge-failure patterns are login-history events
  (AUD-LOGIN-*).

### 15. Data export / delete audit

- **AUD-EXP-01:** Firm data export (PRD §131) and any deletion under the
  retention/export procedure are audited: actor, scope, reason, timestamp.
- **AUD-EXP-02:** The audit log itself is excluded from tenant-initiated
  deletion; retention trimming happens only via AUD-RET-02 and is itself
  audited.

### 16. Service-role usage

- **AUD-SVC-01:** Service-role usage is confined per RLS-SVC-01/02; every
  service-role write to tenant data self-audits with `actor_type='service'`
  (or `'system'` for DB-internal jobs) and a `service_name`
  (AUD-ACT-02/03). Service-role credentials never appear in the repo, client
  bundle, or spec documents (TEN-17/18).

### 17. Secret handling

- **AUD-SEC-01:** Secrets live in platform secret stores (Supabase project
  secrets / Edge Function env); rotation procedure and storage locations are
  operations concerns (`13`). No secrets in git, specs, or logs.
- **AUD-SEC-02:** Application logs must not include tokens, OTPs, passwords,
  or document contents.

### 18. Logging of security-relevant failures

- **AUD-FAIL-01 (AUD-OQ-04 RESOLVED directionally):** Routine RLS row denials
  are **not** persisted (no unbounded audit noise). Security-significant
  denials **are** audited: attempted cross-tenant access; privileged-operation
  denial (including **denied rule-version activation**, AUD-CRV-01);
  break-glass denial; administrative/security endpoint denial; and
  repeated suspicious authorization-failure patterns (thresholded/aggregated).
  Also recorded: audit-write failures (which abort operations, AUD-INV-05),
  break-glass misuse attempts, MFA challenge failures, and hook/spike
  anomalies.
- **AUD-FAIL-02:** Failure records go to the operational log (`13`);
  security-significant ones also to `audit_log`.

### 19. Retention classification

- **AUD-RET-01 (provisional engineering placeholders — AUD-OQ-01 OPEN):**
  audit_log: 7 years; login history: 2 years; operational logs: 90 days;
  tenant operational data: firm-lifetime + contractual retention
  (configurable per firm, PRD §66). **These values are engineering
  placeholders, not legal/compliance conclusions; they require
  policy/legal/domain confirmation before any production retention
  configuration is approved.** Offboarded-client data follows DM-04 (never
  silently deleted).
- **AUD-RET-02 — retention/archive maintenance path:** the architecture
  permits purging **only** where an approved retention policy requires it,
  and only via a **privileged, controlled maintenance mechanism**
  (security-definer maintenance function or operator-run job) that: is
  unavailable to all ordinary application roles (no GRANT); executes against
  a recorded, approved retention policy (firm settings, SCH-01); is
  attributable (maintenance actor identity recorded); and is **auditable** —
  each execution writes a security/business audit event (AUD-EVT-02) with
  scope, policy reference, row counts, and actor. Retention purge is never
  described or implemented as an ordinary DELETE permission. Mechanism
  details are operations-owned (`13`).

### 20. Verification obligations (forward references to `11`)

- **TEST-AUD-01:** trigger writes complete old/new rows for insert/update/delete on every HIGH/MEDIUM audit-sensitive table (SCH audit column).
- **TEST-AUD-02:** membership, rule, and settings changes produce audit rows with correct actor.
- **TEST-AUD-03:** state transitions (instance/task/review/alert) are audited; auto-resolution carries `resolution_type='auto'`.
- **TEST-AUD-04:** audit_log rejects UPDATE/DELETE for all application roles incl. super_admin; task_comments immutability holds.
- **TEST-AUD-05:** break-glass session produces open/actions/close chain with `support_session_id`.
- **TEST-AUD-06:** MFA recovery produces the AUD-MFA-01 row.
- **TEST-AUD-07:** audit-write failure aborts a sensitive operation (fail-closed).
- **TEST-AUD-08:** IP/UA/correlation context present on request-originated entries (post-spike mechanism).
- **TEST-AUD-09:** actor-model invariants (AUD-ACT-05): system/service rows never carry a human `actor_user_id`; support rows always carry actor + session.
- **TEST-AUD-10:** retention maintenance executes only via the privileged path, follows the recorded policy, and writes its own audit event (AUD-RET-02).
- **TEST-AUD-11 (Batch 4 security closure):** rule-version lifecycle events (create, draft change, activation, supersede/deprecate, domain-approval status change) produce audit rows with actor, firm context, old/new values, and approval-state transition (AUD-CRV-01/02); denied activation attempts are recorded as security-significant denials (AUD-FAIL-01); system/service writes to rule versions carry non-human actor identity (AUD-CRV-03).
- **TEST-AUD-12 (IMP-041 contract closure 2026-09-05):** review-item audit partition (§7c) — `submit_review_item` and `decide_review_item` each write exactly one Layer-B audit row (`review_item.submitted` / `review_item.decided`) with server-derived actor, firm context, and old/new decision fields including rationale; a task-linked `returned` decision audits the decision, task transition, and reviewer comment within one transaction; no Layer-A/Layer-B double logging; mutation-key retry writes no second row; existing-but-invisible denials are audited (`review_item.submit_denied` / `review_item.decide_denied`) while a nonexistent id produces no fabricated audit row; audit failure aborts the command (fail-closed).

## Assumptions

- AUD-A-01: Trigger-visible request headers (option B) exist on the target
  Supabase stack — to be verified in the harness-gate spike; fallback is
  option A.
- AUD-A-02: Audit volume at R0 scale fits a single append-only table with the
  SCH-20 indexes; **partitioning is deferred for Release 0** (SCH-OQ-05
  resolved) and introduced later only on measured volume/operational need.

## Dependencies

- Upstream: `01` (DEC-O), `02` (DM-25, DM-22), `03` (TEN-17/18/23),
  `04` (AUTH-08/10/11/13), `05` (RLS-SUP/SVC/AUD/CRV families), `06`
  (SCH-20, SCH-32, SCH-FK-01).
- Downstream: `09` (system-event sources), `11` (TEST-AUD definitions),
  `13` (retention jobs, operational logging, backup/PITR).

## Open Questions

| ID | Question | Owner | Status |
|---|---|---|---|
| AUD-OQ-01 | Retention values | requester + legal/CA-domain | **OPEN — AUD-RET-01 values are engineering placeholders requiring policy/legal/domain confirmation before production retention configuration is approved** |
| AUD-OQ-02 | Final context-propagation mechanism | harness-gate spike | **RESOLVED 2026-09-01 — layered A+B+C propagation (AUD-CTX-01): Layer A trigger baseline for ordinary human mutations, Layer B explicit RPC boundary for sensitive/privileged commands, Layer C controlled server boundary for system/service/support. Evidence: IMP-005 (`docs/harness/audit-context-spike.md`, `docs/harness/audit-context-results.json`)** |
| AUD-OQ-03 | Firms' visibility of their own support-access history? | — | **Resolved:** visible read-only to firm Super Admin and Partner; history remains immutable/audited (AUD-SUP-03) |
| AUD-OQ-04 | Which denials are audit-worthy? | — | **Resolved directionally:** security-significant denials only (cross-tenant attempts, privileged/break-glass/security-endpoint denials incl. denied rule-version activation, suspicious repetition); no routine-denial persistence (AUD-FAIL-01) |

## Acceptance Criteria

- AUD-ACC-01: All twenty mandated sections present.
- AUD-ACC-02: All mandated invariants are stated as requirements:
  append-only for application roles and ordinary service paths; no ordinary
  UPDATE/DELETE; fail-closed; system/service/support distinguishable; support
  attributable; server timestamps; explicit tenant; correlation IDs; and a
  privileged, policy-bound, auditable retention path (AUD-RET-02) distinct
  from ordinary deletion.
- AUD-ACC-03: IP/UA context is explicitly designed (options compared,
  provisional recommendation) with no claim that PostgreSQL knows trustworthy
  client context automatically.
- AUD-ACC-04: The actor model distinguishes human/system/service/support with
  the masquerade prohibition (AUD-ACT-05).
- AUD-ACC-05: Break-glass model includes actor, firm context, reason, time
  limit, least privilege, audit record, no service-role exposure, reviewable
  history.
- AUD-ACC-06: Every security/tenant/audit requirement references a TEST-AUD-*
  or TEST-RLS-* verification obligation.
- AUD-ACC-07 (Batch 4 security closure): compliance rule-version
  administration is explicitly classified as security/compliance-sensitive
  (AUD-CRV-01) with defined record content (AUD-CRV-02), actor
  distinguishability (AUD-CRV-03), and a verification obligation
  (TEST-AUD-11).

## Consequence of Change

The audit model is load-bearing for compliance claims (PRD §66–67) and for
every write path's shape. Changing the propagation mechanism after the spike
amends this spec and the `11` harness; weakening invariants (AUD-INV-*,
AUD-ACT-05), the retention boundary (AUD-RET-02), or the rule-version audit
coverage (AUD-CRV-*) is a security-posture change requiring requester
sign-off.
