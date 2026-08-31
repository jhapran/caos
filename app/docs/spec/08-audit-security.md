# 08 — Audit & Security Architecture

- **Status:** Approved (architecture, Batch 3)
- **Approval status:** Approved for architecture (Batch 3). Note: AUD-OQ-01 (retention values) and AUD-OQ-02 (context propagation mechanism) remain open/provisional as recorded.

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
  (RLS-SVC-*). Audit records their exercise.

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
  task status transitions and reassignment; review decisions (with
  rationale); alert acknowledge/snooze/resolve (including auto-resolution,
  DM-OQ-05); engagement status changes; client status changes (incl.
  offboarding); break-glass session open/close and every action inside one;
  data export/delete operations; retention maintenance executions
  (AUD-RET-02); (deferred releases add: document URL issuance, portal logins,
  reminder sends, AI decisions).

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

### 11. IP / user-agent / correlation context

**PostgreSQL does not automatically know a trustworthy client IP or
user-agent; this is designed, not assumed.** Options compared:

| Option | Mechanism | Strengths | Weaknesses |
|---|---|---|---|
| A. Request-scoped DB context | RPC wrapper sets a transaction GUC (`set_config('app.audit_ctx', …)`) before mutations; triggers read it | Explicit, testable, works for any write | Only covers RPC-routed writes; raw table writes bypass it |
| B. Request-header GUC in triggers | Triggers read Supabase-provided request headers (`request.headers` setting) for IP/UA | Covers plain PostgREST table writes with zero app discipline | Header trust depends on proxy chain (IP is best-effort, `x-forwarded-for` spoofable); availability must be verified |
| C. Edge Function / server wrapper | Server boundary computes context and calls a security-definer `write_audit_event()` | Full control; required anyway for system/security events | Doesn't cover direct table writes by itself |

- **AUD-CTX-01 (provisional recommendation):** **B + C**: triggers read
  request-header context when present (browser writes); a security-definer
  audit function with explicit parameters serves Edge Functions, jobs, and
  security events. Option A remains the fallback if B's header availability
  fails verification.
- **AUD-CTX-02:** IP is recorded as **best-effort evidence, never sole
  identity proof**; actor identity is always per the §10 actor model.
- **AUD-CTX-03:** Verification of header availability/trust and the GUC
  mechanism is part of the harness-gate spike (together with RLS-MECH-02);
  not claimed as validated here.

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
  denial; break-glass denial; administrative/security endpoint denial; and
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

## Assumptions

- AUD-A-01: Trigger-visible request headers (option B) exist on the target
  Supabase stack — to be verified in the harness-gate spike; fallback is
  option A.
- AUD-A-02: Audit volume at R0 scale fits a single append-only table with the
  SCH-20 indexes; **partitioning is deferred for Release 0** (SCH-OQ-05
  resolved) and introduced later only on measured volume/operational need.

## Dependencies

- Upstream: `01` (DEC-O), `02` (DM-25, DM-22), `03` (TEN-17/18/23),
  `04` (AUTH-08/10/11/13), `05` (RLS-SUP/SVC/AUD families), `06` (SCH-20,
  SCH-FK-01).
- Downstream: `09` (system-event sources), `11` (TEST-AUD definitions),
  `13` (retention jobs, operational logging, backup/PITR).

## Open Questions

| ID | Question | Owner | Status |
|---|---|---|---|
| AUD-OQ-01 | Retention values | requester + legal/CA-domain | **OPEN — AUD-RET-01 values are engineering placeholders requiring policy/legal/domain confirmation before production retention configuration is approved** |
| AUD-OQ-02 | Final context-propagation mechanism (AUD-CTX-01 provisional B+C) | harness-gate spike | **Open — provisional** |
| AUD-OQ-03 | Firms' visibility of their own support-access history? | — | **Resolved:** visible read-only to firm Super Admin and Partner; history remains immutable/audited (AUD-SUP-03) |
| AUD-OQ-04 | Which denials are audit-worthy? | — | **Resolved directionally:** security-significant denials only (cross-tenant attempts, privileged/break-glass/security-endpoint denials, suspicious repetition); no routine-denial persistence (AUD-FAIL-01) |

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

## Consequence of Change

The audit model is load-bearing for compliance claims (PRD §66–67) and for
every write path's shape. Changing the propagation mechanism after the spike
amends this spec and the `11` harness; weakening invariants (AUD-INV-*,
AUD-ACT-05) or the retention boundary (AUD-RET-02) is a security-posture
change requiring requester sign-off.
