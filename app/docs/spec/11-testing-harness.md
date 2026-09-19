# 11 — Testing & Verification Harness

- **Status:** Approved (Batch 5)
- **Approval status:** Approved (Batch 5). Open/provisional items remain as recorded: TEST-OQ-01…04; the DEC-J spike is **COMPLETE** (TEST-SPIKE-J-01…03, IMP-004 — executed 2026-08-31, decision approved 2026-09-01 — selected mechanism: live membership lookup, `05` RLS-MECH-01); the audit-context spike is **COMPLETE** (TEST-SPIKE-CTX-01/02, IMP-005 — executed and decision approved 2026-09-01 — selected mechanism: layered A+B+C audit-context propagation, `08` AUD-CTX-01); AUD-OQ-01 stays open.

## Purpose

The authoritative verification architecture for CAOS. This spec converts
every forward `TEST-*` reference from the approved specifications
(05/06/08/09/10) into explicit test families and defines the **Harness
Gate** that must pass before substantial implementation. The repository and
its automated verification — not any individual LLM's memory or claims —
determine whether an implementation is acceptable. The harness is designed
for future multi-LLM implementation with separated implementer/reviewer
roles.

## Scope

- Target testing stack (specification only — nothing is installed in
  Phase 2).
- The `TEST-*` taxonomy and the mapping of every earlier forward reference.
- The RLS / tenant-isolation harness and role-matrix verification.
- The DEC-J (RLS mechanism) and AUD-OQ-02 (audit context) technical-spike
  designs with measurable acceptance criteria.
- Authentication, schema, automation, migration, API/realtime, security,
  operations, and E2E test families.
- The multi-LLM implementation/verification protocol.
- The Harness Gate checklist.

## Non-goals

- No dependency installation, no test code, no CI configuration in Phase 2.
- No re-definition of authorization rules (owned by `05`), schema (`06`),
  audit (`08`), automation (`09`), or migration (`10`) — this spec
  *verifies* them.
- No full UI-permutation E2E coverage (minimal critical flows only).
- Vendor selection for error monitoring (owned by `13`, OPS-OQ).

## Testing stack (specification)

- **TEST-STACK-01 — Frontend/unit:** Vitest + React Testing Library.
- **TEST-STACK-02 — Backend/database:** Supabase CLI local stack; database
  tests execute against real Postgres (migration chain applied from clean,
  MIG-RBK-02); RLS authorization tests run as distinct authenticated
  contexts, not as a single superuser.
- **TEST-STACK-03 — E2E:** Playwright; minimal Release-0 critical-flow
  coverage only (TEST-E2E-*).
- **TEST-STACK-04 — Static verification:** TypeScript strict (`tsc -b`),
  ESLint, production build (`npm run build`) — all must pass on every
  change.
- **TEST-STACK-05:** The harness runs identically locally and in CI; the
  CI-equivalent command is a single documented entry point (H-GATE).

## Test taxonomy and forward-reference mapping

- **TEST-TAX-01 — Families:** `TEST-UNIT-*` (pure logic), `TEST-COMP-*`
  (component rendering/behaviour), `TEST-API-*` (data-layer contract,
  API-ERR/CONV/MUT/RT/SEC semantics), `TEST-AUTH-*` (authentication
  flows), `TEST-RLS-*` (authorization/tenant isolation), `TEST-SCH-*`
  (database structure/constraints), `TEST-AUD-*` (audit), `TEST-AUTO-*`
  (automation/events), `TEST-MIG-*` (migration/seeding/mode isolation),
  `TEST-OPS-*` (operational readiness, defined with `13`), `TEST-E2E-*`
  (Playwright critical flows), `TEST-SEC-*` (cross-cutting security).
- **TEST-TAX-02 — Completeness rule:** no `TEST-*` reference in an
  approved spec may remain undefined here. Mapping:

  | Forward reference (source) | Defined as |
  |---|---|
  | TEST-RLS-\<FAMILY\>-01…10 per tenant table (`05` §14) | TEST-RLS-GEN harness + per-family case sets (§RLS harness below) |
  | TEST-RLS-STO-* (`05` §13) | Deferred to Release 1 — recorded explanation: storage ships with documents (DEC-R); family reserved |
  | TEST-RLS-4EY-01 (`05` §14) | TEST-RLS-4EY-01 (four-eyes RPC rejects self-approval) |
  | TEST-RLS-SUP-01 (`05` §14) | TEST-RLS-SUP-01 (break-glass audit trail + expiry) |
  | TEST-RLS-CRV-01…13 (`05` §14) | TEST-RLS-CRV-01…13 (rule versions; 12/13 added by the 2026-09-03 rule-governance closure) |
  | TEST-RLS-EVO-01 / SJR-01 / SDL-01 (`05` §12/§14, IMP-050 architecture amendment 2026-09-11) | Grant closure: `anon`/`authenticated` have no read/write/execute on the SCH-33/34/35 automation records or their scheduler/job functions; scheduler-path cross-firm isolation/attribution is TEST-AUTO-08 (never RLS-based, AUTO-SCH-03) |
  | TEST-RLS-RVW-* (`06` SCH-17, `05` RLS-RVW-01) | TEST-RLS-RVW-01…16 defined below (IMP-041 contract closure 2026-09-05) |
  | TEST-AUD-01…12 (`08` §20) | Each ID defined by its `08` enumeration and binding here: TEST-AUD-01, TEST-AUD-02, TEST-AUD-03, TEST-AUD-04, TEST-AUD-05, TEST-AUD-06, TEST-AUD-07, TEST-AUD-08, TEST-AUD-09, TEST-AUD-10, TEST-AUD-11, TEST-AUD-12 |
  | TEST-AUTO-01…10 (`09`) | Each ID defined below (TEST-AUTO-01…TEST-AUTO-10), extended by TEST-AUTO-11/12/13/14/15 here |
  | TEST-MIG-01…05 (`10` phases) | Each phase-gate check defined by `10` and binding here: TEST-MIG-01, TEST-MIG-02, TEST-MIG-03, TEST-MIG-04, TEST-MIG-05; extended by TEST-MIG-06…15 below |
  | TEST-SCH-01 (`06` SCH-14) | TEST-SCH family, acyclicity case |
  | TEST-AUTH-* (`10` Phase A) | TEST-AUTH family below |
  | TEST-OPS-* (this batch, `13`) | TEST-OPS family defined in `13` |

## RLS / tenant-isolation harness (critical)

- **TEST-RLS-GEN-01 — Fixture tenants.** The database test seed creates at
  least **Firm A** and **Firm B**, each with: users covering every R0 role
  (super_admin, partner, manager, senior, article_executive, billing),
  clients/entities/registrations/engagements/profiles/instances/tasks/
  review items/alerts/rule versions, and known record IDs used as attack
  targets. Additionally: a **multi-firm user** (memberships in A and B), a
  **suspended** and a **removed** membership, and (architecture-level,
  post-portal) a user holding both staff and client relationships
  (DM-X-05).
- **TEST-RLS-GEN-02 — Offensive posture.** Cross-tenant tests intentionally
  attempt access to **known foreign record IDs** (direct select by id,
  filtered queries, insert referencing foreign parents, update/delete by
  foreign id). "Row not returned" happy-path tests alone are insufficient.
- **TEST-RLS-GEN-03 — Per-table case set.** For every tenant-owned R0 table
  (SCH-04…SCH-20, SCH-32), the harness executes the ten `05` §14 cases
  plus: suspended membership loses access; removed membership loses access;
  multi-firm context isolation (active-firm A sees no B rows and vice
  versa); staff+client overlap cannot leak across contexts (RLS-CTX-03);
  client context cannot reach staff-only objects (RLS-POR-03); staff
  context cannot inherit unrelated client scope.
- **TEST-RLS-GEN-04 — Mutation denial surfacing.** Write-path denials are
  asserted to surface as authorization errors (API-ERR-02/03), not silent
  no-ops.

## Role-matrix verification

- **TEST-RLS-MAT-01:** The §11 matrix of `05` is executable: for each role
  × sensitive object (clients, compliance instances, tasks, review items,
  alerts, audit history, compliance rule versions, firm financial/billing
  aggregates, and — architecture-level — future document metadata
  boundaries), at least one allow-case and one deny-case per matrix cell
  that differs from "full". Manager portfolio scoping (RLS-STF-03) and
  senior/article assigned-work scoping (RLS-STF-04) get dedicated
  boundary cases (in-portfolio vs out-of-portfolio; assigned vs
  unassigned).
- **TEST-RLS-MAT-02:** Billing is denied task content, review items,
  compliance detail, and workpapers-adjacent data (RLS-STF-05).
- **TEST-RLS-MAT-03:** Audit history is readable only by
  partner/super_admin (RLS-AUD-01); support-access history visibility per
  AUD-SUP-03.

## Review-item RLS case set (TEST-RLS-RVW-*, IMP-041 contract closure 2026-09-05)

- **TEST-RLS-RVW-01…10:** the ten standard `05` §14 verification cases
  executed against `review_items` via the TEST-RLS-GEN harness
  (cross-tenant isolation, suspended/removed membership, multi-firm context,
  per TEST-RLS-GEN-03).
- **TEST-RLS-RVW-11 — role visibility.** super_admin/partner: firm-wide
  queue + detail; manager: only the resolved scope (RLS-RVW-01);
  senior/article: only own submissions; billing: denied (RLS-STF-05); anon:
  denied.
- **TEST-RLS-RVW-12 — manager scope boundary.** In-portfolio client item:
  visible/decidable; item whose linked task names the manager as current
  assignee or reviewer (RLS-TSK-01): visible/decidable; unlinked
  out-of-portfolio item: omitted; submit/decide outside scope: denied. No
  team/subordinate traversal exists (§11 note ‡). An inconsistent
  task/client combination grants no scope — the manager cannot gain
  ReviewItem access through a mismatched subject link (SCH-17 subject
  binding, TEST-SCH-25).
- **TEST-RLS-RVW-13 — self-decision prohibition (RLS-4EY-04).** manager,
  partner, and super_admin each cannot decide an item their own membership
  submitted — no privileged-rank bypass; the comparison is decider live
  membership vs `submitted_by_membership_id`.
- **TEST-RLS-RVW-14 — live membership freshness.** A suspended or removed
  membership loses submit/decide on the next request with the same JWT
  (RLS-MECH-01).
- **TEST-RLS-RVW-15 — direct decision writes closed.** Browser direct UPDATE
  of `status`/`decided_by_membership_id`/`decided_at`/`decision_rationale` is
  denied for every role; decisions exist only via `decide_review_item`;
  submission only via `submit_review_item`.
- **TEST-RLS-RVW-16 — senior/article scope.** Submission allowed only for
  work inside current assigned-work scope; reads limited to own submissions;
  decide denied.

## DEC-J technical spike (Harness Gate — COMPLETE: executed 2026-08-31; decision approved 2026-09-01, IMP-004)

**Completion record.** TEST-SPIKE-J-01 (setup: custom access-token hook +
claims-based, live-lookup, and hybrid policy styles on representative
tenant tables against the local stack), TEST-SPIKE-J-02 (all twelve
measurable criteria, including a reviewer-mandated follow-up at 100,013
membership rows), and TEST-SPIKE-J-03 (written decision record,
human-reviewed) are **complete**. **Selected Release-0 mechanism: live
membership lookup (Candidate B)** — recorded in `05` RLS-MECH-01/02.
Evidence: `docs/harness/dec-j-spike.md`, `docs/harness/dec-j-results.json`.
The spike remains a **regression requirement**: production RLS
implementation (IMP-012+) must re-verify the same cases — same tenant,
cross-tenant denial, suspension, removal, role changes, multi-firm
switching, staff/client overlap, known foreign IDs — through the
TEST-RLS-* families below. The original spike design follows for the
record:

- **TEST-SPIKE-J-01 — Setup.** Implement the custom access-token hook and
  both policy styles (claims-based, security-definer lookup) plus the
  hybrid on three representative tables (firm_memberships,
  compliance_instances, audit_log) against the local stack, per
  RLS-MECH-02.
- **TEST-SPIKE-J-02 — Measurable acceptance criteria:**
  1. same-tenant access succeeds under each style;
  2. cross-tenant denial holds for read/insert/update/delete under each
     style;
  3. role-change freshness measured in seconds until effective (claims:
     bounded by token TTL; lookup: immediate) — recorded, not assumed;
  4. membership suspension takes effect within the AUTH-08 promptness
     target;
  5. membership removal takes effect;
  6. active-firm switching yields a clean new context (no residue of the
     previous firm);
  7. multi-firm users resolve only the active firm;
  8. one identity holding staff + client relationships evaluates the
     correct context (RLS-CTX-03);
  9. expired/stale access tokens are rejected;
  10. token refresh/rotation behaves correctly after context change;
  11. on a ~100k-row `compliance_instances` dataset, per-style policy
      latency is measured (p50/p95 recorded; the provisional budget is
      p95 < 100 ms for hot-path reads — the spike may revise this with
      evidence);
  12. policy testability/debugging complexity is assessed in writing (how
      a failing policy is diagnosed per style).
- **TEST-SPIKE-J-03 — Decision record.** The spike produces a written
  decision record appended to `05` (DEC-J outcome); substantial backend
  migration remains blocked until it exists. If the hybrid fails its
  criteria, the fallback is option B (lookup) and `05` is amended.

## Audit-context technical spike (AUD-OQ-02 / AUD-CTX — COMPLETE: executed and decision approved 2026-09-01, IMP-005)

- **TEST-SPIKE-CTX-01 — Candidates.** Evaluate the AUD-CTX options:
  request-header GUC in triggers (B), explicit RPC context (A), and the
  security-definer event-function wrapper (C) — and the provisional B+C
  combination. **COMPLETE (2026-09-01).**
- **TEST-SPIKE-CTX-02 — Acceptance criteria:** trustworthy actor identity
  (never client-spoofable); firm context correct under both PostgREST
  table writes and RPC calls; IP availability and trust level measured
  (recorded as best-effort per AUD-CTX-02); user-agent availability;
  correlation id end-to-end (request → mutations → audit rows, AUD-INV-06);
  service/system actor distinction preserved (AUD-ACT-05); spoofing
  resistance demonstrated (client-supplied context headers cannot
  overwrite server-trusted values). **COMPLETE (2026-09-01) — all
  criteria met (31/31 checks).**
- **Outcome (2026-09-01):** executed as IMP-005 — evidence:
  `docs/harness/audit-context-spike.md`,
  `docs/harness/audit-context-results.json`. Implementer recommendation
  was B+C with A optional; human/security review resolved AUD-OQ-02 as
  the **layered A+B+C** model (`08` AUD-CTX-01: trigger baseline for
  ordinary human mutations; explicit RPC boundary for
  sensitive/privileged commands; controlled server boundary for
  system/service/support). The spike matrix becomes standing regression
  requirements for IMP-013 and later audit-bearing packages: actor
  spoofing, firm spoofing, sequential context leakage, concurrent
  context leakage, trigger-path audit failure, RPC-path audit failure,
  human/system/service/support distinction, metadata trust
  classification.

## Authentication verification (TEST-AUTH-*)

- **TEST-AUTH-01** invitation (invite-only onboarding, `04`);
  **TEST-AUTH-02** login; **TEST-AUTH-03** logout (session revoked);
  **TEST-AUTH-04** password reset; **TEST-AUTH-05** magic link;
  **TEST-AUTH-06** TOTP enrolment; **TEST-AUTH-07** MFA challenge;
  **TEST-AUTH-08** AAL2-gated sensitive operations reject AAL1 sessions
  (RLS-AAL-01 list); **TEST-AUTH-09** session refresh/rotation;
  **TEST-AUTH-10** inactivity-timeout target (12 h, AUTH-08) verified
  against actual platform configuration; **TEST-AUTH-11** absolute session
  target (7 d); **TEST-AUTH-12** suspended membership loses access
  promptly; **TEST-AUTH-13** membership removal loses access;
  **TEST-AUTH-14** MFA device-loss recovery flow (AUTH-11) with audit row
  (AUD-MFA-01).
- **TEST-AUTH-15:** Exact platform-supported session/MFA configuration
  values are **verified against the platform and recorded** — never
  assumed (AUTH-08 note).

## Database / schema tests (TEST-SCH-*)

- **TEST-SCH-01:** task-dependency acyclicity rejected at insert (SCH-14).
  Ownership: IMP-040 supplies the task-dependency implementation coverage
  (the requirement is only executable once `task_dependencies` exists).
- **TEST-SCH-02:** foreign keys and composite same-firm FKs reject
  cross-firm references at the constraint layer (SCH-FK-01/02). Shared
  requirement: each earlier package's coverage remains regression
  coverage; IMP-040 adds the `tasks` / `task_dependencies` cases.
- **TEST-SCH-03:** unique constraints hold (clients/registrations/
  memberships/profiles/instance key).
- **TEST-SCH-04:** registration-scope invariants — registration-scoped
  types require a registration of the declared class; entity-scoped types
  require none (DM-27, SCH-11/12); the TDS PAN exception behaves only as
  documented (SCH-12).
- **TEST-SCH-05:** compliance-instance uniqueness
  `(compliance_type_id, legal_entity_id, registration_id, period_start)`
  with NULLS NOT DISTINCT semantics verified on the target Postgres
  (SCH-A-03).
- **TEST-SCH-06:** rule-version immutability — update of an active or
  instance-referenced version is rejected (SCH-32).
- **TEST-SCH-07:** rule-version activation gate — statutory version cannot
  reach `active` without `domain_approval_status='approved'` (SCH-32).
- **TEST-SCH-08:** instance provenance — recurrence-generated rows carry
  `rule_version_id`, `generation_source='recurrence'`, `generated_at`,
  `calculated_due_date`; manual rows carry `generation_source='manual'`
  and no recurrence provenance; provenance fields reject updates
  (SCH-12).
- **TEST-SCH-09:** lifecycle/check constraints — state vocabularies and
  `period_end >= period_start` enforced.
- **TEST-SCH-10 (R0 closure 2026-09-03):** rule-version effective-window
  invariants — windows of `active` versions for one `compliance_type_id`
  cannot overlap (touching half-open boundaries legal); `effective_from`
  inclusive / `effective_to` exclusive boundary behavior;
  `effective_to > effective_from` enforced; multiple disjoint `active`
  versions (incl. future-effective) permitted; the SCH-32
  active-as-of-date predicate resolves at most one version for any
  (type, date) pair (OPS-ACT-02).
- **TEST-SCH-11 (R0 closure 2026-09-03):** governance classification —
  a version whose parent type is `governance_class='statutory'` cannot
  reach `active` with `domain_approval_status='pending'` and can never
  carry `not_required`; a firm override of a statutory system type
  cannot downgrade the inherited `governance_class`; a genuinely custom
  firm type may be `non_statutory` and its versions may use
  `not_required` (SCH-10 governance inheritance, SCH-32 gate).
- **TEST-SCH-12:** `client_id` on compliance_instances is
  trigger-maintained and never user-writable (SCH-A-02, SCH-12) — direct
  user UPDATE of `client_id` rejected; the denormalized value stays
  consistent with the parent legal entity.
- **TEST-SCH-13:** four-eyes transition authorization (RLS-CIN-01,
  RLS-4EY-01/02) — reviewer ≠ assignee enforced where the type requires
  it; transitions leaving `internal_review` (including
  `internal_review → ready_to_file` when client_approval is skipped)
  accepted only from the assigned reviewer; privileged roles cannot bypass
  by rank; regression to `preparation` allowed from the assigned reviewer
  or an in-scope manager+; senior/article transition rights limited to
  instances where their membership is the current assignee/reviewer;
  direct `state` UPDATE denied for all roles.
- **TEST-SCH-14:** instance rule-version pinning stability — after rule
  succession (SCH-32), existing instances keep their original
  `rule_version_id`; provenance fields unchanged; the historical version
  remains readable and referentially valid (AUTO-REC-07).
- **TEST-SCH-15 (IMP-040 closure 2026-09-04):** task subject binding —
  for a task with `compliance_instance_id IS NOT NULL`, `client_id` is
  server-derived/validated from the linked instance; a caller cannot
  create or rewrite a task whose `client_id` differs from the instance's
  client; re-linking `compliance_instance_id` preserves the subject
  invariant (SCH-13, DM-13).
- **TEST-SCH-16 (IMP-040 closure 2026-09-04):** task mandatory lifecycle
  fields — DM-SM-05 status CHECK vocabulary; `next_action` required;
  entering `waiting` requires `waiting_reason`; `returned` requires a
  non-empty reviewer comment created atomically with the transition
  (SCH-13, API-ARCH-04).
- **TEST-SCH-17 (IMP-040 closure 2026-09-04):** task four-eyes reviewer
  authorization (RLS-4EY-03) — where four-eyes applies (instance-linked
  task whose compliance type requires it), `submitted → approved` and
  `submitted → returned` are accepted only from the assigned reviewer;
  reviewer ≠ assignee; no privileged-rank bypass; ad-hoc tasks are not
  four-eyes-required by default; direct `status` UPDATE denied for all
  roles.
- **TEST-SCH-18 (IMP-040 closure 2026-09-04):** dependency self-edge
  rejection — `task_id = depends_on_task_id` rejected (SCH-14).
- **TEST-SCH-19 (IMP-040 closure 2026-09-04):** dependency duplicate-pair
  rejection — `(task_id, depends_on_task_id)` uniqueness enforced
  (SCH-14).
- **TEST-SCH-20 (IMP-040 closure 2026-09-04):** dependency cycle race —
  concurrent `A → B` / `B → A` additions: at most one commits; the
  committed graph remains acyclic; firm-scoped transaction advisory lock +
  recursive cycle validation + insert are atomic (SCH-14, RLS-TSK-02).
- **TEST-SCH-21 (IMP-041 contract closure 2026-09-05):** `review_items`
  structure — columns, PK, nullability/defaults, `status` and `source`
  CHECK vocabularies, exact frozen `type` CHECK (`gst_reconciliation`,
  `tds_return`, `itr_computation`, `financial_statements`,
  `audit_workpaper` — API-OQ-01 resolved), and the SCH-17 queue indexes
  (SCH-17).
- **TEST-SCH-22 (IMP-041 contract closure 2026-09-05):** composite same-firm
  FKs on `review_items` reject cross-firm client/task/compliance-instance/
  submitter/decider references (SCH-17, SCH-FK-01…03, SCH-RESP-03).
- **TEST-SCH-23 (IMP-041 contract closure 2026-09-05):** R0 source/AI
  invariant — `source='human'` requires `ai_output_id IS NULL`; the
  submission path accepts only `source='human'`; no FK to the deferred
  `ai_outputs` (SCH-27) ships in R0 (SCH-17).
- **TEST-SCH-24 (IMP-041 contract closure 2026-09-05):** terminal-decision
  field invariant — `status` ∈ {approved, returned, escalated, dismissed}
  requires `decided_by_membership_id` + `decided_at` + non-empty
  `decision_rationale`; `pending` rows carry no decision fields (DM-SM-06,
  SCH-17).
- **TEST-SCH-25 (IMP-041 cross-domain hardening 2026-09-05):** ReviewItem
  subject binding (SCH-17) — a valid task-linked item is accepted with
  `client_id` equal to the task's client; a forged/mismatching task client
  cannot persist; a valid instance-linked item is accepted with `client_id`
  equal to the instance's client; a forged/mismatching instance client
  cannot persist; consistent task + instance links are accepted only when
  the task references exactly that instance — a same-client-different-
  instance combination is rejected; an ad-hoc client-only item is accepted;
  no inconsistent combination may persist.

## Automation tests (TEST-AUTO-*)

Formalizes `09`: **TEST-AUTO-01** duplicate-proof recurrence (four
layers); **TEST-AUTO-02** trigger points (activation, closure, signal);
**TEST-AUTO-03** scope discipline per DM-27; **TEST-AUTO-04** alert dedupe
+ audit-logged auto-resolution; **TEST-AUTO-05** consumer idempotency;
**TEST-AUTO-06** retry/dead-letter; **TEST-AUTO-07** non-human actor model
on automation writes; **TEST-AUTO-08** scheduler mechanism checks
(AUTO-SCH-02 — recorded PASS 2026-09-11 for availability/execution
context; the mechanism checks execute during IMP-050); **TEST-AUTO-09** historical stability + provenance +
activation gate; **TEST-AUTO-10** concurrent-generator race (one
instance, one event). Extensions:
- **TEST-AUTO-11:** domain events vs scheduler signals are separated —
  `sched.*` signals produce no business-event consumers and no audit rows
  by themselves (AUTO-PRIN-05, AUTO-EVT-02).
- **TEST-AUTO-12:** correlation propagation — a scheduler run's
  correlation id reaches every event and audit row it causes
  (AUTO-AUD-02).
- **TEST-AUTO-13 (newly allocated, human ruling HRR-05=A 2026-09-15):**
  evaluator alert-creation race. **Owning behavior/requirement:**
  AUTO-ALR-02 structural dedupe (HRR-06=A) under concurrent evaluator
  execution (HRR-12=A) — the alert-evaluator analogue of TEST-AUTO-10's
  recurrence-generator race. **Minimum acceptance oracle:** two
  concurrent evaluator executions racing to create an alert for the same
  dedupe identity converge to EXACTLY ONE non-resolved alert row,
  exactly one `alert.created` publication, and no duplicate audit
  effect; the losing creation attempt no-ops. **Package ownership:**
  IMP-051.
- **TEST-AUTO-14 (newly allocated, human ruling HRR-05=A 2026-09-15):**
  alert retrigger / new occurrence. **Owning behavior/requirement:**
  HRR-09=A (AUTO-ALR-02/03) — resolved alerts are terminal historical
  occurrences and never suppress later recurrence. **Minimum acceptance
  oracle:** after an alert reaches `resolved`, the same rule condition
  becoming true again creates a NEW alert occurrence with fresh
  lifecycle state (`raised_at`, correlation identity, acknowledgement
  lifecycle, and the rule's applicable `requires_explicit_ack`
  behavior); the resolved row remains terminal and unchanged (no
  reopen); while a current non-resolved occurrence exists
  (`active`/`acknowledged`/`snoozed`), re-evaluation creates NO
  duplicate. **Package ownership:** IMP-051.
- **TEST-AUTO-15 (newly allocated, human ruling HRR-05=A 2026-09-15):**
  persisted snooze-expiry normalization. **Owning behavior/requirement:**
  the human-ruled snooze-expiry ownership partition (`09` Alert
  evaluation; `06` SCH-18) — persisted expiry normalization belongs to
  the IMP-051 evaluator; the IMP-042 read derivation (TEST-API-18) is
  unchanged. **Minimum acceptance oracle:** an evaluator run normalizes
  a persisted `snoozed` row with `snoozed_until <= now()` to its SCH-18
  non-snoozed state (`acknowledged` when `acknowledged_at IS NOT NULL`,
  else `active`), consistent with the TEST-API-18 read derivation; the
  write carries the automation audit actor model (AUTO-AUD-01) and
  re-running is a no-op (idempotent, AUTO-IDM-01). **Package
  ownership:** IMP-051.
- **TEST-AUTO-04 label correction (human ruling HRR-08=A 2026-09-14):**
  canonical TEST-AUTO-04 is alert dedupe + audit-logged auto-resolution
  (above; `09`) and is exercised by IMP-051. The IMP-050 recurrence
  suite's use of the TEST-AUTO-04 label for per-firm look-ahead
  configuration (AUTO-REC-02, SCH-01) in
  `tests/integration/automation/recurrence.test.ts` was a mislabel; the
  correction there is label/comment/metadata only — no execution,
  assertion, setup/teardown, or test-data change.
- **TEST-AUTO-05/06 harness strategy (test contract clarification,
  Ruling 2026-09-12):** R0 has no production registered outbox consumers
  (AUTO-FLOW-05, `09`) — these tests MUST NOT force creation of a
  production consumer merely to exercise drain/idempotency/failure
  behavior. TEST-AUTO-05 sets up a deterministic **HARNESS-ONLY
  synthetic consumer/effect fixture** (temporary/synthetic test objects
  or test-only registration consistent with existing harness conventions
  — the `hgate_*` precedent in `tests/integration/rls/setup.sql`), never
  part of production runtime configuration and never becoming production
  schema/business behavior; the assertion is deterministic — duplicate
  delivery produces exactly one domain result per domain/effect key
  (`event_id` is NOT the idempotency key, AUTO-IDM-01). TEST-AUTO-06 uses
  deterministic **HARNESS-ONLY failure injection** against the
  drain/retry machinery — proving bounded retries, the
  failed/dead-letter transition, SCH-35 dead-letter evidence, correlation
  preservation (AUTO-RET-02), and operational visibility (`13`) — with no
  fake production consumer. Both tests tear down completely: **zero
  synthetic residue**.
- **TEST-AUTO-08 acceptance precondition + post-IMP-050 catalog targets
  (Rulings 2026-09-12, R5/R8):** before registering or accepting the
  recurrence cron job, verify `current_setting('cron.timezone', true) =
  'GMT'` — at local implementation acceptance, hosted staging acceptance,
  and production pre-cutover verification alike; a non-GMT effective
  timezone FAILS CLOSED (no registration, no automatic `cron.timezone`
  alteration, no ALTER SYSTEM / `postgresql.conf` edit / server restart —
  explicit human review required, AUTO-SCH-07). This is part of the
  existing TEST-AUTO-08 obligation; no new TEST ID is allocated. Harness
  catalog contract after IMP-050: 24 public application tables, RLS
  enabled 24/24, FORCE RLS 20 (SCH-33/SCH-35 forced; SCH-34 enabled but
  NOT forced — system-scoped), policy count 51 unless implementation
  introduces a separately contract-authorized policy
  (RLS-EVO-01/SJR-01/SDL-01 are zero-browser-grant families and require
  no permissive browser policies). The gate implementation
  (`scripts/harness/gate.mjs`) is updated by the IMP-050 implementation
  package, not by contract closure.
- **TEST-AUTO-08 post-IMP051 expectation (human ruling HRR-04=A
  2026-09-15):** IMP-051 updates/extends the existing shared automation
  suites in place — NO replacement IDs are created for already-canonical
  shared test obligations. After IMP-051 the TEST-AUTO-08 oracle
  additionally expects `sched.alerts.evaluate` PRESENT at cadence
  `30 19 * * *` under the same AUTO-SCH-07 fail-closed GMT registration
  precondition (HRR-03=A — a scheduler-timezone operating-convention
  check only; it does not conflate scheduler timezone with the
  Asia/Kolkata business-date semantics the evaluator derives
  explicitly), and expects `sched.login_mirror.run` to remain ABSENT
  under current ownership. Canonical TEST-AUTO-04 remains alert dedupe +
  audit-logged auto-resolution (HRR-08=A 2026-09-14), unchanged.
- AUTO-OQ-01/02/03 are RESOLVED (human ruling 2026-09-11, recorded in
  `09`/`06`); no provisional wording remains for them.
- **Scheduler-path isolation must be tested directly:** because the cron
  execution identity carries BYPASSRLS (AUTO-SCH-03 — FORCE RLS did not
  constrain the cron-fired path in the local probe), RLS-based tests are
  NOT evidence of scheduler isolation. TEST-AUTO-08's mechanism checks
  therefore include direct cross-firm isolation assertions against the
  scheduler/job-function path itself (explicit-tenancy enforcement,
  grant closure for anon/authenticated), executed under the cron
  execution context — no new TEST IDs are allocated for this; it is part
  of the existing TEST-AUTO-08 obligation.

## Migration tests (TEST-MIG-*)

- **TEST-MIG-01…05:** the Phase A–E gate checks defined in `10`
  (clean-chain reproducibility; adapter parity; seed invariants;
  read-model consistency; production smoke).
- **TEST-MIG-06:** fixture mode remains intact and passes its checks while
  Supabase mode exists (MIG-PRIN-02).
- **TEST-MIG-07:** Supabase mode works with no fixture modules loaded
  (MIG-DS-06a mechanical check).
- **TEST-MIG-08:** production-configured startup with missing/invalid
  Supabase config fails closed; unknown/unset `DATA_SOURCE` fails closed
  (MIG-DS-03/05); no fixture fallback after a runtime Supabase error
  (MIG-DS-06c).
- **TEST-MIG-09:** fixture records cannot enter a `supabase` database via
  seed scripts (environment labelling, MIG-SEED-06).
- **TEST-MIG-10:** dev seeds are deterministic (stable ids, MIG-OQ-02).
- **TEST-MIG-11:** migration ordering applies cleanly from scratch and
  incrementally (local → staging rehearsal).
- **TEST-MIG-12:** data-integrity suites run at every phase gate
  (MIG-VAL-01).
- **TEST-MIG-13:** pilot-data backfill path is exercised on synthetic
  stand-in data if invoked (MIG-PD-01) — pilot data is never deleted.
- **TEST-MIG-14:** rollback/recovery checkpoints are rehearsed per phase
  (`10` rollback conditions).
- **TEST-MIG-15:** seeded statutory rule versions carry
  `domain_approval_status='pending'` and cannot activate (MIG-SEED-02,
  SCH-32 gate).

## API / realtime verification (TEST-API-*)

- **TEST-API-01:** collection queries never error on unauthorized rows —
  rows are simply absent (API-ERR-02).
- **TEST-API-02:** single-resource reads return identical `not_found` for
  nonexistent and inaccessible ids — no existence oracle (API-ERR-02);
  asserted by timing/shape comparison, not just status.
- **TEST-API-03:** privileged operations return `unauthorized` only where
  safe (no protected-existence leak).
- **TEST-API-04:** aggregate/dashboard RPCs return caller-scoped results
  per role (API-SEC-01/04; portfolio slices for manager, assigned slices
  for senior; revenue aggregates partner/admin only).
- **TEST-API-05:** no browser path uses service-role (bundle and network
  inspection, MIG-DS-06; TEN-17/18).
- **TEST-API-06:** SECURITY DEFINER functions enforce their own explicit
  authorization and cannot be coerced cross-tenant (API-SEC-03).
- **TEST-API-07:** pagination/filter/sort contracts hold; unsupported
  combinations are validation errors (API-CONV-02/03).
- **TEST-API-08:** conflict and idempotency semantics — retried decisions/
  transitions with the same mutation key do not double-apply
  (API-MUT-03).
- **TEST-API-09:** realtime resilience — a missed event, a duplicate
  event, and an out-of-order event each leave the UI correct after
  revalidation; reconnect/re-entry re-fetches authoritative state
  (API-RT-05/06). **Realtime is not necessary for correctness** — the same
  flows pass with subscriptions disabled.
- **TEST-API-10:** realtime tenant isolation under RLS (API-RT-07);
  failure falls back to polling with no contract change.
- **TEST-API-11 (IMP-041 contract closure 2026-09-05):**
  `decide_review_item` authorization-before-disclosure — an
  unauthorized/out-of-scope existing item and a nonexistent id return the
  identical `not_found` surface; no existence, status, legality,
  vocabulary, rationale-requirement, or replay oracle (API-ERR-02,
  RLS-RVW-01).
- **TEST-API-12 (IMP-041 contract closure 2026-09-05):**
  `decide_review_item` mutation-key retry safety (API-MUT-03) — a retried
  decision with the same valid key returns the original result; no
  double-decide, no second audit row, no duplicate returned-task comment;
  authorization is evaluated BEFORE replay state.
- **TEST-API-13 (IMP-041 contract closure 2026-09-05):**
  `submit_review_item` server-derived fields are unforgeable (`firm_id`,
  `submitted_by_membership_id`, `submitted_at`, actor/audit identity);
  caller-supplied `status`, decision fields, `ai_output_id`, or
  `source='ai'` are rejected; same-firm subject relationships and caller
  scope are validated before the row is created (RLS-RVW-01, SCH-17).
  Subject derivation follows the linked-subject-wins order (task →
  instance → explicit client): caller `client_id` can never contradict or
  override a linked task/instance — a mismatch is rejected.
- **TEST-API-14 (IMP-041 contract closure 2026-09-05):** `returned`
  atomicity (DM-SM-06) — with `task_id` non-null, a `returned` decision
  transitions the linked task to `returned` and creates exactly one
  immutable SCH-16 comment carrying the rationale, attributed to the
  decision actor, in one transaction; the actor must additionally satisfy
  the task's `submitted → returned` authority (RLS-TSK-01; RLS-4EY-03
  assigned reviewer where the task is four-eyes-required — no rank bypass
  via `decide_review_item`); the task must be in a DM-SM-05 state that
  legally permits `→ returned`; failure at any step rolls back ReviewItem,
  task, and comment and writes no success audit; with `task_id` NULL there
  are no task side effects.
- **TEST-API-15 (IMP-041 contract closure 2026-09-05):** decision legality
  — `pending → approved | returned | escalated | dismissed` only; terminal
  states reject further decisions; non-empty non-whitespace rationale is
  mandatory for all four outcomes; rejections map to `conflict`/
  `validation` with machine-readable reason codes (API-ERR-04).
- **TEST-API-16 (newly allocated, IMP-042 contract reconciliation
  2026-09-06):** alert acknowledge/snooze/resolve commands enforce
  authorization-before-disclosure (API-ERR-02): an unauthorized or
  out-of-scope existing alert and a nonexistent id return the identical
  `not_found` surface; no existence, status, legality, or replay oracle
  (RLS-ALR-01).
- **TEST-API-17 (newly allocated, IMP-042 contract reconciliation
  2026-09-06):** the SCH-18 manual transition matrix holds — acknowledge
  from `active`/`snoozed` (stamping acknowledgement and clearing
  `snoozed_until` per the matrix); identical repeated commands return
  `already_applied`; `invalid_state` from `resolved` maps to `conflict`;
  snooze requires a future `snoozed_until`, preserves prior
  acknowledgement stamps, and a changed valid `snoozed_until` is a real
  audited update; resolve is permitted from any non-resolved state and is
  `acknowledged_at`-gated when the rule requires explicit
  acknowledgement; no reopen path exists.
- **TEST-API-18 (newly allocated, IMP-042 contract reconciliation
  2026-09-06):** snooze-expiry read derivation — a persisted `snoozed`
  alert with `snoozed_until <= now()` reads with effective status
  `acknowledged` (when `acknowledged_at IS NOT NULL`) else `active`, and
  commands remain correct against the expired persisted row; IMP-042
  performs no expiry writes.
- **TEST-API-19 (newly allocated, IMP-042 contract reconciliation
  2026-09-06):** the My Work read contract (API-R0-MWK / DEC-L) returns
  exactly four buckets with single-bucket precedence
  (Returned → Waiting → Today → This Week), canonical-work-identity
  deduplication (a task-linked returned ReviewItem surfaces only as its
  Task), own-assignment visibility for every staff role (billing none),
  Asia/Kolkata business-date boundaries (overdue-inclusive Today,
  ISO-week-bounded This Week, NULL `due_date` excluded from date
  buckets), and the ruled sort order with stable ID tie-break.
- **TEST-API-20 (newly allocated, IMP-051 contract reconciliation
  2026-09-14, human ruling HRR-10=A):** the API-R0-DLN deadline
  read-model contract — the deadline board and group drill-down are a
  server-derived read model over `compliance_instances(due_date, state)`
  (AUTO-DLN-01: derived; no persisted deadline rows; grouping computed
  server-side per API-ARCH-05); results are tenant-scoped identically to
  the underlying instance reads (RLS-CIN-01 — cross-firm zero, manager
  portfolio scope, senior/article assigned-only); due-date and
  period-boundary correctness holds on the Asia/Kolkata business-date
  basis with UTC-persisted timestamps (AUTO-REC-10); the board reflects
  the operative `due_date` and never rewrites immutable
  `calculated_due_date` provenance (SCH-12).
- **TEST-API-21 (newly allocated, IMP-061 final contract reconciliation
  2026-09-19):** the API-R0-SRC structured-search contract — exactly the
  six approved domains (client, legal_entity, registration, task,
  compliance_instance, staff); the provider-neutral hit projection
  (kind/id/label/sub/href plus status/badge and the masked-identifier
  projection); server-side caps (5 per kind / 20 global, no pagination);
  deterministic ordering (identifier exact before identifier prefix,
  textual prefix before substring-only, stable canonical-key tie-break);
  masked identifier display (type + last four only); truthful Offboarded
  indication; a truthful empty result is not an error; error surfaces
  follow API-ERR-01/02.
- **TEST-API-22 (newly allocated, IMP-061 final contract reconciliation
  2026-09-19):** search tenant isolation / no existence leakage
  (API-ERR-02, RLS-TEN-02) — Firm A/Firm B collisions return only own-firm
  hits; cross-firm denial; hidden and nonexistent targets are
  indistinguishable; a forged `x-active-firm` selector grants nothing
  (RLS-CTX-02/RLS-MECH-01); anonymous callers are denied.
- **TEST-API-23 (newly allocated, IMP-061 final contract reconciliation
  2026-09-19):** search input security and matching semantics
  (IMP061-R3/R4) — the server-side 2-character minimum never enumerates
  tenant data for empty/one-character input; identifiers match
  exact/prefix only (no substring); textual names/operational labels match
  case-insensitive substring with prefix ranked ahead of substring-only;
  `%`, `_`, backslash, quote/operator-looking and equivalent
  special-character input is treated literally with deterministic
  escaping — no uncontrolled wildcard/filter injection.
- **TEST-API-24 (newly allocated, IMP-061 final contract reconciliation
  2026-09-19):** search role-visibility matrix — partner firm-wide;
  manager portfolio scope (RLS-STF-03); senior/article assigned-work
  visibility (RLS-STF-04); billing receives no client/instance hits;
  the active-firm staff roster pin (ACTIVE `firm_memberships` only);
  the IMP061-M1 (= M1-A) compliance-instance cases — explicit
  period-label search coverage for partner, manager, senior/article, and
  billing, with no compliance-type-name leakage for roles lacking
  `compliance_types` visibility and no loss of otherwise-visible
  instances from the composition structure (no INNER JOIN removal).

**IMP-061 harness wiring (future obligation — recorded at contract
reconciliation 2026-09-19; NO harness code is edited at contract time):**
per the standing repository convention — each live data-backed domain
surface carries its own integration suite wired into the standing Harness
Gate (e.g. IMP-051 `tests/integration/deadlines/` →
`deadlines-integration`; IMP-060 `tests/integration/dashboard/` →
`dashboard-integration`) — IMP-061 introduces a dedicated search
integration phase (`tests/integration/search/`, executing
TEST-API-21…24) wired into `scripts/harness/gate.mjs` during
implementation. Extending an existing domain phase was rejected: no
existing phase owns a cross-domain search surface.

## Security family (TEST-SEC-*)

- **TEST-SEC-01:** no secrets/tokens/OTPs in the client bundle, repo, or
  logs (AUD-SEC-01/02; OPS-LOG redaction).
- **TEST-SEC-02:** fail-closed startup on missing security-critical config
  (MIG-DS-03/05, OPS-ENV).
- **TEST-SEC-03:** cross-tenant fuzz attempts across all R0 list/detail
  endpoints with foreign ids (extends TEST-RLS-GEN-02 to the API layer).
- **TEST-SEC-04:** audit fail-closed — a failed audit write aborts the
  sensitive operation (AUD-INV-05).
- **TEST-SEC-05:** security-significant denials are audited; routine
  denials are not (AUD-FAIL-01).

## E2E — Release-0 critical flows (TEST-E2E-*, Playwright, minimal)

1. **TEST-E2E-01** staff login (with MFA);
2. **TEST-E2E-02** select/enter firm context;
3. **TEST-E2E-03** create/view client;
4. **TEST-E2E-04** create/view legal entity;
5. **TEST-E2E-05** registration workflow;
6. **TEST-E2E-06** compliance instance visible on Client 360/deadlines;
7. **TEST-E2E-07** task assignment + update (incl. `waiting` requiring a
   reason) — **owned by IMP-042 (Alerts & My Work) as downstream UI
   acceptance**; IMP-040 owns the backend/data-adapter/API behavior this
   flow exercises and carries no UI scope;
8. **TEST-E2E-08** review submit + decision (approve and return) —
   **owned by IMP-041 (Review queue)**, which wires the existing Review
   Queue UI to `@/data` and owns this flow's UI acceptance; IMP-042 owns
   only the downstream My Work "Returned" surface the flow feeds;
9. **TEST-E2E-09** My Work buckets render (Today/This Week/Waiting/
   Returned);
10. **TEST-E2E-10** deadlines + Command Centre render live data;
11. **TEST-E2E-11** authorization-denied scenario (e.g. billing role
    blocked from compliance detail; cross-firm URL access denied);
12. **TEST-E2E-12** logout.
13. **TEST-E2E-13** live Command Palette structured search — **owned by
    IMP-061** (allocated at the IMP-061 final contract reconciliation
    2026-09-19): open with the existing shortcut; live search across the
    six API-R0-SRC domains; navigate to the canonical destination; masked
    identifier rendering; offboarded badge; zero-result state;
    loading/error behavior where safely testable; no fixture fallback in
    live mode; representative role coverage.

No UI-permutation coverage; everything else is component/API level.

## Multi-LLM implementation harness protocol

- **TEST-MLH-01 — Task declaration.** Every implementation task must
  declare in writing: the requirement IDs it implements; the TEST-* IDs it
  must satisfy; allowed files; forbidden changes; and the acceptance
  commands that must pass.
- **TEST-MLH-02 — Agent obligations.** Every coding agent must: (1)
  implement only the assigned scope; (2) run the required checks;
  (3) report changed files; (4) map changes to requirement IDs; (5) map
  tests to TEST-* IDs; (6) report failures and open issues honestly;
  (7) **STOP rather than silently redesign architecture** — deviations go
  back to the spec owner.
- **TEST-MLH-03 — Implementer ≠ reviewer.** For security-critical work —
  RLS, authentication, service-role access, audit, tenant isolation,
  production migrations, break-glass support — the implementer model and
  the reviewer model must differ where practical; the reviewer verifies
  against this spec's families, not against the implementer's summary.
- **TEST-MLH-04 — Evidence over narration.** A task is complete only when
  its acceptance commands pass in the repository and the output is
  recorded; chat claims are not evidence.

## Harness Gate (H-GATE) — PASS

**HARNESS GATE: PASS — human approved 2026-09-01.** Evidence commit
`305d133` (`test: establish executable Harness Gate`); exact committed-HEAD
verified from a fresh detached worktree (`npm ci` →
`npx playwright install chromium` → `npm run verify:harness`): **PASS —
14/14 phases green**. Evidence record: `docs/harness/harness-gate.md` +
`docs/harness/harness-gate-result.json`.

All of the following had to pass before substantial feature implementation
began (DEC-S; `10` Phase A gate) — status recorded per item:

- [x] Test runner installed and executing (Vitest) — **COMPLETE**
- [x] Supabase CLI local stack boots and resets deterministically from clean
      (loopback-bound; **COMPLETE** at harness level — the production
      migration chain lands with IMP-010+)
- [x] Deterministic local seed loads (TEST-MIG-10) with Firm A / Firm B
      and the full role set (TEST-RLS-GEN-01) — **COMPLETE** (16
      deterministic identities, `tests/harness/registry.json`)
- [x] ESLint clean; `tsc -b` clean; production build succeeds
      (TEST-STACK-04) — **COMPLETE**
- [x] RLS integration tests run and pass for the foundation mechanism —
      **COMPLETE** (18/18, resolved DEC-J live-membership-lookup mechanism
      on temporary `hgate_*` harness tables; TEST-RLS-GEN-01…04,
      TEST-RLS-MAT-01 mechanism level, TEST-AUTH-12/13 freshness; the
      per-table production matrix lands with IMP-012+ — UPDATE 2026-09-01:
      tenant-core production matrix landed with IMP-012; TEST-RLS-GEN-01…04
      / MAT-01 re-verified on the production tables per the spike regression
      requirement above)
- [x] Auth integration tests pass (TEST-AUTH core) — **COMPLETE**
      (9/9: TEST-AUTH-02, TEST-AUTH-03, TEST-AUTH-09 + supporting
      assertions; this is mechanism-level coverage, not the full
      TEST-AUTH-01…15 production set)
- [x] DEC-J spike executed and decision record appended to `05`
      (TEST-SPIKE-J-*) — **COMPLETE — executed 2026-08-31; decision approved 2026-09-01 (IMP-004; live membership
      lookup selected)**
- [x] Audit-context spike executed and outcome recorded in `08`
      (TEST-SPIKE-CTX-01/02) — **COMPLETE (IMP-005; decision approved
      2026-09-01 — layered A+B+C, `08` AUD-CTX-01)**
- [x] Minimal Playwright smoke passes — **COMPLETE** (1/1 shell smoke,
      Chromium; no TEST-E2E-* business-flow ID claimed — the
      TEST-E2E-01…12 suite lands with its owning packages)
- [x] Single CI-equivalent command runs the gate locally and in CI —
      **COMPLETE** (`npm run verify:harness`, `scripts/harness/gate.mjs`)
- [x] Clean baseline: zero failing tests on the gate commit —
      **COMPLETE** (fresh committed-HEAD worktree proof, commit `305d133`)

Gate phases additionally verified on every `verify:harness` run: network
binding loopback-only, local MCP initialize, database cleanliness (no
`hgate_*`/`decj_*`/`audctx_*` objects; public tables exactly the committed
production migration set — the IMP-010 tenant core — with the IMP-012 RLS
posture asserted: RLS enabled on all three tables plus the exact policy
inventory), secret scan (TEST-SEC-01 harness level). This gate does **not**
claim complete production coverage for Auth, RLS, audit, or E2E.

## Assumptions

- TEST-A-01: The Supabase CLI local stack supports the full schema,
  pg_cron (AUTO-SCH-02 — VALIDATED PASS 2026-09-11: local
  execution-context probe PASS — pg_cron available/preloaded with the
  extension NOT installed at the restored local baseline (the probe
  temporarily enabled it, then restored the baseline); the IMP-050
  migration MAY carry `CREATE EXTENSION IF NOT EXISTS pg_cron` for a
  deterministic local reset/build (Ruling 2026-09-12, AUTO-SCH-06);
  hosted availability PASS via authorized
  human read-only Studio queries, default_version 1.6.4, not installed —
  hosted `CREATE EXTENSION` remains a future explicit human gate), and
  header-GUC behaviour needed by the spikes;
  gaps are recorded, not worked around silently (MIG-A-01).
- TEST-A-02: Playwright runs against the local stack without external
  services (mail capture for OTP/magic links is local, e.g. Inbucket —
  verified at gate).
- TEST-A-03: R0 E2E runs against synthetic seed data only; demo-fixture
  mode keeps its own checks (TEST-MIG-06).

## Dependencies

- Upstream: every approved spec — `04` (AUTH-*), `05` (RLS families, DEC-J
  spike), `06` (SCH-* constraints), `08` (AUD-*, AUD-CTX spike), `09`
  (AUTO-*), `10` (MIG phases, DATA_SOURCE), `07` (API conventions).
- Downstream: `12` (R0 plan sequences work against these gates), `13`
  (defines TEST-OPS-*).

## Open Questions

| ID | Question | Owner | Status |
|---|---|---|---|
| TEST-OQ-01 | Concrete latency budget for the DEC-J spike (provisional p95 < 100 ms hot-path) | spike outcome | Open — provisional, evidence may revise |
| TEST-OQ-02 | Local mail-capture tool for OTP/magic-link E2E (e.g. Inbucket) | gate setup | Open — verified at gate |
| TEST-OQ-03 | Whether TEST-RLS-STO-* storage tests land with Release 1 documents spec | `21`/Release 1 | Open — family reserved, deferred with documents |
| TEST-OQ-04 | CI platform choice (GitHub Actions assumed by convention, not decided) | requester | Open |

## Acceptance Criteria

- TEST-ACC-01: All twelve taxonomy families are defined; every forward
  TEST-* reference from approved specs maps to a definition or carries an
  explicit recorded explanation (TEST-TAX-02).
- TEST-ACC-02: The RLS harness mandates Firm A/Firm B fixtures, offensive
  foreign-ID access attempts, and the full per-table case set including
  suspension/removal/multi-firm/context-overlap.
- TEST-ACC-03: Both spikes (DEC-J, audit context) have measurable
  acceptance criteria and produce written decision records; neither is
  executed in Phase 2.
- TEST-ACC-04: TEST-AUTH-*, TEST-SCH-*, TEST-AUTO-*, TEST-MIG-*,
  TEST-API-*, TEST-SEC-*, TEST-E2E-* families enumerate concrete cases
  consistent with their owning specs.
- TEST-ACC-05: The multi-LLM protocol requires declared scope, TEST
  mapping, evidence, and implementer≠reviewer for security-critical work.
- TEST-ACC-06: The Harness Gate checklist is explicit and blocks
  substantial implementation until green.

## Consequence of Change

This spec is the acceptability oracle: weakening a family or a gate
criterion changes what "done" means for every downstream task and requires
requester sign-off. Adding implementation scope without adding its TEST-*
coverage violates TEST-MLH-01. The spike outcomes, once recorded, amend
`05`/`08` and may revise provisional values here (TEST-OQ-01).
