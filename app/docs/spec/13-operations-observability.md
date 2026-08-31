# 13 — Operations & Observability (Release 0)

- **Status:** Approved (Batch 5)
- **Approval status:** Approved (Batch 5). Open/provisional items remain as recorded: OPS-OQ-01…04; RPO/RTO remain engineering targets (not SLAs); Supabase plan backup/PITR capabilities unverified (OPS-OQ-02); DEC-P production region approval stays open.

## Purpose

Defines Release-0 operational readiness: environment and secrets
management, structured logging, error monitoring, health checks,
backup/recovery, migration recovery, statutory-rule activation operations,
incident basics, and runbooks. Deliberately **not** an enterprise
observability platform — R0 needs reliable basics, executed well.

## Scope

- Environment configuration and secrets handling across LOCAL / STAGING /
  PRODUCTION.
- Structured application logging and redaction.
- Error monitoring and alert escalation basics.
- Health/readiness checks.
- Database backup, PITR, restore/recovery against the TEN-24 provisional
  targets.
- Migration rollback/recovery operations.
- Support/break-glass operations and audit-log operational handling.
- Statutory-rule activation operational control.
- Dependency/service outage behaviour.
- Incident lifecycle and runbooks.
- The TEST-OPS-* verification family (defined here, executed by `11`).

## Non-goals

- No enterprise observability/SIEM platform, no custom metrics pipeline.
- No SLA engineering beyond the TEN-24 provisional engineering targets.
- No implementation, no tooling installation, no credentials in Phase 2.
- Vendor selection is not finalized here (OPS-OQ-01).
- Release 1+ operational concerns (document pipeline, reminder delivery
  rates, AI cost monitoring) beyond noting their future arrival.

## Environments and secrets

- **OPS-ENV-01 — Isolation reaffirmed.** LOCAL (Supabase CLI stack,
  synthetic data), STAGING (separate cloud project, synthetic/sanitized
  data), PRODUCTION (separate cloud project, real customer data) share no
  credentials, no data, no configuration (TEN-12…15).
- **OPS-ENV-02 — Client-safe vs server-only.** The browser bundle may
  contain only the publishable anon key and public URL (TEN-17).
  Service-role keys, database URLs, and Edge Function secrets are
  server-only (TEN-18) and live in platform secret stores (AUD-SEC-01).
- **OPS-ENV-03 — Service-role restrictions.** Service-role credentials are
  used only in Edge Functions and operator-run deployment/seed scripts;
  every tenant-affecting service-role write self-audits (RLS-SVC-01/02,
  AUD-SVC-01). No silent use for support (break-glass path only, OPS-SUP).
- **OPS-ENV-04 — Rotation.** Secrets have a recorded rotation procedure
  (who, how, how often, and how revocation is verified); rotation events
  are operations-logged.
- **OPS-ENV-05 — No committed credentials.** No `.env` values, keys, or
  tokens in the repo; verified by TEST-SEC-01 and review convention.
- **OPS-ENV-06 — Validation and fail-closed startup.** Startup validates
  required configuration per environment; security-critical missing or
  invalid configuration (including an unknown `DATA_SOURCE`) is a hard
  startup failure (MIG-DS-03/05). **Production never contains a fixture
  fallback** (MIG-PRIN-03, MIG-DS-06).

## Structured logging

- **OPS-LOG-01 — Fields.** Every structured log entry carries: timestamp
  (server), severity, environment, service/component, `correlation_id`
  (shared with events/audit where applicable, AUD-INV-06), `request_id`,
  `actor_type` and `actor_user_id` where appropriate, `firm_id` where safe
  and appropriate, and a typed event/error kind.
- **OPS-LOG-02 — Redaction (never logged):** passwords; access tokens;
  refresh tokens; OTPs; service-role keys; sensitive document contents;
  unnecessary PII (AUD-SEC-02). Redaction is verified by TEST-OPS-03.
- **OPS-LOG-03 — Security-significant failures are dual-recorded:**
  operational log plus `audit_log` where AUD-FAIL-01 requires it.

## Error monitoring

- **OPS-MON-01 — Coverage.** R0 monitoring captures: frontend runtime
  errors; server/Edge Function errors; automation failures (job-run log,
  AUTO-OBS-01); recurrence-generation failures; **audit-write failures**
  (which abort the sensitive operation, AUD-INV-05 — these are always
  page-worthy); security-significant failures (AUD-FAIL-01); failed
  migrations.
- **OPS-MON-02 — Alerting/escalation basics.** Alert on: audit-write
  failure, repeated authorization anomalies, automation dead-letter
  accumulation, failed production migration, health-check failure.
  Escalation target is the operator on duty; severity per OPS-INC-02.
- **OPS-MON-03 — Vendor open.** The error-monitoring vendor/tool is not
  selected here (OPS-OQ-01); the requirement is the capability, not the
  product.

## Health / readiness

- **OPS-HLT-01 — Checks:** application availability (HTTP 200 on a
  documented route); database connectivity/readiness; required
  configuration validation result (OPS-ENV-06); critical backend
  dependency status (Supabase Auth/PostgREST reachability);
  scheduler/automation health (last successful run per job, AUTO-OBS-01);
  migration-version compatibility (deployed app version vs applied
  migration version — mismatch blocks readiness).
- **OPS-HLT-02 — No sensitive diagnostics publicly.** Health endpoints
  expose status, not internals (no versions, config values, connection
  strings, or tenant identifiers).

## Backup / recovery

- **OPS-BKP-01 — Targets (provisional, TEN-24):** **RPO ≤ 24 hours,
  RTO ≤ 8 hours.** These are engineering targets, not contractual SLAs;
  any stronger contractual requirement overrides them.
- **OPS-BKP-02 — Capability verification before reliance.** The chosen
  Supabase plan's automated backup, PITR, retention, and restore
  capabilities are **verified and recorded before production cutover**
  (MIG-DEP-04 gate). No capability is claimed until verified against the
  actual plan (OPS-OQ-02).
- **OPS-BKP-03 — Restore runbook and drill.** A documented restore
  procedure exists before Phase E; a restore drill to a scratch
  environment is executed and recorded at least once before production
  cutover, then on a scheduled cadence (TEST-OPS-05).
- **OPS-BKP-04 — Audit-log consideration.** Because `audit_log` is
  append-only and compliance-relevant, restore procedures must state how
  audit continuity is preserved (restore to point-in-time including audit
  rows; no selective table restores that orphan audit context).

## Migration recovery (operations view of `10`)

- **OPS-MIG-01 — Forward-only production migrations** (MIG-PRIN-05);
  staging-first rehearsal (MIG-DEP-02); pre-deployment verification per
  the phase gates (`10`).
- **OPS-MIG-02 — Backup precondition.** A production schema migration is
  not applied unless a current restore point exists and the restore
  runbook is in date (OPS-BKP-02/03).
- **OPS-MIG-03 — App rollback vs DB rollback.** Frontend rollback is
  allowed only when the schema is unchanged or backward-compatible
  (MIG-RBK-04); a failed or bad migration is corrected by a **forward
  fix**, not a reverse migration, wherever data has been written.
- **OPS-MIG-04 — Failed-migration incident procedure.** Stop the deploy
  train → assess blast radius (which gate/check failed) → contain (hold
  app deploy; block further migrations) → recover (forward fix or restore
  per OPS-BKP-03) → verify (phase-gate suite re-run) → record in the
  incident log (OPS-INC-01).
- **OPS-MIG-05 — Explicit approval.** No production migration proceeds
  without explicit requester/operator approval, recorded with the release.

## Support / break-glass operations

- **OPS-SUP-01:** Break-glass support follows RLS-SUP-01/02 and AUD-SUP-*:
  named actor, firm/customer context, reason, least-privilege scope,
  time-bound expiry, complete audit chain (open/actions/close). Support
  history is reviewable by platform operators and visible read-only to the
  affected firm's super_admin/partner (AUD-SUP-03). Service-role
  credentials are never used directly for support access (OPS-ENV-03).
- **OPS-SUP-02:** Break-glass activations are operationally alerted (not
  silent) and reviewed on a cadence.

## Statutory-rule activation operations

- **OPS-ACT-01 — Production activation control.** Activating a statutory
  `compliance_rule_versions` row (SCH-32) requires: an authorized
  privileged role (super_admin/partner, RLS-CRV-02/03); AAL2 step-up
  (RLS-AAL-01); `domain_approval_status='approved'`; **recorded external
  practicing-CA / compliance-domain approval evidence** (reference stored
  with the activation decision); a complete audit trail (AUD-CRV-01/02);
  and a recorded activation timestamp.
- **OPS-ACT-02 — Active-version identifiability.** At any time, operations
  can answer "which rule version is active for compliance type X as of
  date D" from data alone (SCH-32 effective windows + status).
- **OPS-ACT-03 — Not certification.** Architecture review and this
  operational control do not constitute professional CA certification;
  the external approval evidence requirement is the gate (DM-OQ-01).

## Dependency / service outage behaviour

- **OPS-DEP-01 — Supabase unavailability.** The application degrades to a
  clear unavailable/maintenance state — **never** to fixture data
  (MIG-PRIN-03). In-flight mutations surface errors per API-ERR-05 (no
  blind retry of non-idempotent mutations).
- **OPS-DEP-02 — Scheduler/automation outage.** Missed runs are detected
  via the job-run log (AUTO-OBS-01) and re-run safely (idempotent
  consumers, AUTO-IDM-01); recovery is catch-up execution, not data
  repair, because generation/evaluation are idempotent.
- **OPS-DEP-03 — Auth-service degradation.** Existing sessions behave per
  AUTH-08; new logins fail visibly; no authorization decision is made on
  assumed state (RLS-PRIN-02 default deny).

## Incident basics

- **OPS-INC-01 — Lifecycle:** Detect → Assess → Contain → Recover →
  Verify → Record/follow up. Every production incident gets a written
  record: timeline, blast radius, root cause, corrective actions,
  verification evidence.
- **OPS-INC-02 — Severity basics.** SEV-1: tenant-isolation breach,
  data loss, auth bypass, audit-write failure, production down. SEV-2:
  degraded core workflow (recurrence, review queue), failed migration.
  SEV-3: minor/partial issues. **Security and tenant-isolation incidents
  receive the highest escalation** regardless of visible impact.
- **OPS-INC-03 — Ownership.** A named operator owns each incident from
  detection to record; SEV-1 incidents notify the requester immediately.

## Operational runbooks (required before Phase E exit)

- **OPS-RUN-01** restore drill (OPS-BKP-03); **OPS-RUN-02** failed
  migration (OPS-MIG-04); **OPS-RUN-03** secret rotation (OPS-ENV-04);
  **OPS-RUN-04** break-glass activation/review (OPS-SUP-01/02);
  **OPS-RUN-05** statutory rule-version activation (OPS-ACT-01);
  **OPS-RUN-06** Supabase outage response (OPS-DEP-01/02);
  **OPS-RUN-07** SEV-1 tenant-isolation/security response (OPS-INC-02).

## Operations verification (TEST-OPS-*, executed by `11`)

- **TEST-OPS-01:** missing/invalid secret or config fails startup closed
  (OPS-ENV-06).
- **TEST-OPS-02:** health/readiness endpoints report accurately and leak
  no internals (OPS-HLT-01/02).
- **TEST-OPS-03:** logging redaction — synthetic secrets/OTPs/tokens never
  appear in logs (OPS-LOG-02).
- **TEST-OPS-04:** backup verification — plan capabilities confirmed and
  recorded before cutover (OPS-BKP-02).
- **TEST-OPS-05:** restore drill executes the runbook successfully
  (OPS-BKP-03).
- **TEST-OPS-06:** migration failure/recovery rehearsal — forward-fix path
  demonstrated on staging (OPS-MIG-03/04).
- **TEST-OPS-07:** scheduler failure detected and safely re-run
  (OPS-DEP-02).
- **TEST-OPS-08:** dependency outage — app fails visibly, never to fixture
  (OPS-DEP-01).
- **TEST-OPS-09:** security-incident basics — SEV-1 drill produces the
  incident record and notifications (OPS-INC-01/03).
- **TEST-OPS-10:** statutory activation controls — activation without
  approval evidence/AAL2 is refused and audited (OPS-ACT-01, RLS-CRV-03,
  AUD-CRV-01).

## Assumptions

- OPS-A-01: Supabase platform status/backup surfaces are sufficient for
  R0 once verified (OPS-BKP-02); no custom backup infrastructure is
  planned for R0.
- OPS-A-02: A single on-duty operator model fits R0 scale; formal on-call
  rotations are post-R0.
- OPS-A-03: Error-monitoring vendor capabilities (OPS-MON-03) are
  commodity; selection does not change this spec's requirements.

## Dependencies

- Upstream: `03` (TEN-12…24), `05` (RLS-SVC/SUP/CRV/AAL), `06` (SCH-01
  settings, SCH-20, SCH-32), `08` (AUD-*), `09` (AUTO-OBS/SCH), `10`
  (MIG-DS/DEP/RBK/VFY), `11` (executes TEST-OPS-*).
- Downstream: `12` (R0 plan sequences operational readiness before
  cutover).

## Open Questions

| ID | Question | Owner | Status |
|---|---|---|---|
| OPS-OQ-01 | Error-monitoring vendor/tool selection | requester + implementation | Open — capability specified, product undecided |
| OPS-OQ-02 | Exact backup/PITR/retention capabilities of the chosen Supabase plan (must be verified before cutover; TEN-24 targets depend on it) | implementation + requester | **Open — do not claim until verified** |
| OPS-OQ-03 | Restore-drill cadence after the initial pre-cutover drill | requester | Open — initial drill mandatory, cadence TBD |
| OPS-OQ-04 | External CA/domain approval evidence format/storage for statutory activation (OPS-ACT-01) | requester + CA-domain | Open |

## Acceptance Criteria

- OPS-ACC-01: Environment isolation, client-safe/server-only separation,
  service-role restriction, rotation, no-committed-credentials, and
  fail-closed startup are specified; production never falls back to
  fixture.
- OPS-ACC-02: Structured logging fields and the redaction list are
  explicit; security-significant failures are dual-recorded.
- OPS-ACC-03: Error-monitoring coverage includes audit-write failures and
  automation failures with basic escalation.
- OPS-ACC-04: Health/readiness checks are defined without exposing
  sensitive diagnostics.
- OPS-ACC-05: Backup/recovery reconciles TEN-24 (RPO ≤ 24 h, RTO ≤ 8 h,
  engineering targets), requires plan-capability verification before
  reliance, and mandates a restore runbook + drill.
- OPS-ACC-06: Migration recovery distinguishes app vs DB rollback,
  prefers forward fixes, and requires explicit approval plus a backup
  precondition.
- OPS-ACC-07: Statutory-rule activation operational control requires
  privileged role + AAL2 + approved status + external CA/domain evidence
  + audit trail, and is explicitly not professional certification.
- OPS-ACC-08: Incident lifecycle, severity basics, ownership, and the
  runbook set are defined.
- OPS-ACC-09: TEST-OPS-01…10 are defined for execution by `11`.

## Consequence of Change

Operations requirements gate production cutover (MIG-DEP-04). Weakening
fail-closed startup, redaction, backup verification, or statutory
activation controls is a security/compliance-posture change requiring
requester sign-off. Claiming unverified platform capabilities violates
OPS-BKP-02 and must be corrected in writing wherever recorded.
