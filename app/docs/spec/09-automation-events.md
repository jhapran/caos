# 09 — Automation & Events (Design)

- **Status:** Approved (Batch 4)
- **Approval status:** Approved (Batch 4). Closure amendment recorded: AUTO-XREF-01 satisfied by the `06` schema amendment (SCH-32 `compliance_rule_versions` + SCH-12 provenance fields); AUTO-OQ-05 resolved. Open/provisional items remain as recorded: AUTO-OQ-01…04; DEC-J and Harness Gate spike outcomes stay open.

## Purpose

Defines the Release 0 event and automation architecture: the domain-event
catalogue (completed business facts), the **separate** scheduler /
internal-signal catalogue (job triggers — not business events), how events
are produced and consumed, recurrence generation for compliance instances,
deadline materialization, alert evaluation, and the (provisional)
scheduled-execution mechanism. Design only — no jobs, triggers, or
functions are implemented in Phase 2.

## Scope

- Domain-event catalogue and naming conventions.
- Scheduler / internal-signal catalogue and its distinct naming convention.
- Producer/consumer model; synchronous vs asynchronous handling.
- Idempotency, retry, failure handling, dead-lettering.
- Recurrence: Compliance Profile → Recurrence Rule Version → Compliance
  Instance, including rule-versioning / historical-stability requirements
  (schema specified in `06`, SCH-32/SCH-12).
- Deadline materialization and alert evaluation.
- Reminder-ready events (recording only; sending is Release 1).
- Interaction with the audit model (`08`) and correlation identifiers.
- Observability requirements (handed to `13`).
- Scheduling-mechanism comparison and provisional recommendation.
- Replay considerations.

## Non-goals

- No implementation: no pg_cron jobs, no Edge Functions, no queue workers.
- No reminder *sending* (Release 1, DEC-T exclusion) — R0 records
  reminder-ready facts only.
- No AI pipelines (DEC-C, `20-ai-services.md`).
- No final selection of the scheduling mechanism where validation is still
  required (AUTO-OQ-01, DEC-OQ-02).
- No RLS/policy definitions (`05`) and no physical schema (`06`); this spec
  references both by ID.

## Principles

- **AUTO-PRIN-01 — Events are domain facts, not change data capture.** An
  event exists because something meaningful happened in the domain
  (`review.completed`), not because a row changed. Table mutations without
  domain meaning produce no event.
- **AUTO-PRIN-02 — Naming.** Domain events use `entity.verb` in past tense
  (`compliance_instance.status_changed`) and are stable once consumed.
  **Scheduler/internal signals use a distinct convention —
  `sched.<job>.<action>` with a present-tense action
  (`sched.recurrence.evaluate`) — and are never named like, or mixed into,
  the domain-event catalogue.**
- **AUTO-PRIN-03 — Automation never masquerades as a human.** Automated
  writes carry `actor_type='system'` (DB-internal jobs) or `'service'`
  (Edge Functions) with a `service_name`, per AUD-ACT-02/03/05.
- **AUTO-PRIN-04 — Fail visible.** A failed automation run is an operational
  signal (job-run log + alerting in `13`), never silent; sensitive
  audit-affecting steps fail closed (AUD-PRIN-03).
- **AUTO-PRIN-05 — Scheduler signals are not business facts.** A scheduler
  tick means "a job should run now", nothing more. Audit and domain-event
  consumers must not treat ticks as business events; only the *outcomes* of
  a run (e.g. `compliance_instance.created`, `alert.resolved`) are domain
  facts.

## Event envelope

- **AUTO-ENV-01:** Every domain event carries: `event_id` (uuid),
  `event_type`, `firm_id` (or the reserved NULL platform marker,
  AUD-EVT-03), `occurred_at` (server-generated), `actor` (per the
  AUD-ACT-* actor model), `correlation_id` (links request ↔ mutations ↔
  automation ↔ audit rows, AUD-INV-06), and a minimal `payload` (ids and
  the specific facts that changed — e.g. old/new state — never full row
  dumps).
- **AUTO-ENV-02:** Scheduler signals carry only: signal name, scheduled
  time, run/correlation id, and job parameters. They carry no business
  payload and write no audit rows unless the run produces a domain change
  (AUTO-PRIN-05).

## Domain-event catalogue (Release 0)

Exactly 14 domain events — completed, meaningful business facts:

| Event | Producer | Meaning | Primary consumers |
|---|---|---|---|
| `client.created` | client create path (API-R0-CLI) | New client relationship exists | audit; future: onboarding automation |
| `client.updated` | client update path | Client attributes changed (incl. status/offboarding) | audit; alert evaluation (status-dependent rules) |
| `engagement.created` | engagement create path (API-R0-ENG) | Engagement drafted/proposed | alert evaluation (unsigned-letter rule, DM-09) |
| `compliance_instance.created` | recurrence generator or manual creation | An obligation instance exists for a period | audit; dashboard invalidation |
| `compliance_instance.status_changed` | transition RPC (API-R0-CIN) | Instance moved along DM-SM-04 | dependency board derivation; alert evaluation; audit (AUD-CAT-01) |
| `compliance_instance.due_date_changed` | transition/update RPC | Statutory/extended due date changed | deadline board derivation; alert evaluation |
| `task.created` | task create path (API-R0-TSK) | Task exists (instance-linked or ad-hoc, DEC-H) | My Work derivation; audit |
| `task.assigned` | assignment RPC | Assignee membership set/changed | notification-ready fact (notifications deferred, SCH-26); audit |
| `task.completed` | task transition RPC | Task reached `done` | instance progress; audit |
| `review.submitted` | review submit path | Work entered the queue | reviewer queue (realtime, API-RT-01); audit |
| `review.completed` | review decision RPC | Approve/return/escalate/dismiss decided (DM-SM-06) | submitter visibility; audit (decision + rationale, AUD-CAT-01) |
| `alert.created` | alert evaluation job or manual raise | A risk signal became active | alert surfaces (realtime, API-RT-01); audit |
| `alert.resolved` | resolve RPC or auto-resolution job | Alert resolved (`resolution_type` manual/auto, DM-OQ-05) | alert surfaces; audit (auto-resolution always logged) |
| `membership.changed` | membership administration RPCs | Invite/role/suspend/remove (RLS-AAL-01) | authz freshness (DEC-J mechanism); audit |

- **AUTO-EVT-01:** The catalogue above is exhaustive for R0 domain events;
  adding events requires a domain justification per AUTO-PRIN-01, not a
  trigger habit.

## Scheduler / internal-signal catalogue (Release 0)

These are **job triggers, not domain events** (AUTO-PRIN-05). They use the
`sched.<job>.<action>` convention (AUTO-PRIN-02) and are logged
operationally (`13`), never consumed as business facts:

| Signal | Fires | Consumed by |
|---|---|---|
| `sched.recurrence.evaluate` | On the recurrence schedule | Recurrence generator — evaluates active profiles and materializes due instances (AUTO-REC-01) |
| `sched.alerts.evaluate` | On the alert-evaluation schedule | Alert evaluation job — runs enabled alert_rules (AUTO-ALR-01) |
| `sched.login_mirror.run` | On the login-history schedule | Login-history mirroring job (AUD-LOGIN-01) |

- **AUTO-EVT-02:** Adding scheduler signals is an operations decision
  recorded here; signals never appear in the domain-event catalogue and
  never write audit rows by themselves.

## Producers, consumers, and flow

- **AUTO-FLOW-01 — Synchronous by default.** Anything the user must see
  confirmed (transitions, decisions) completes synchronously in the request
  path; its domain event is recorded in the same transaction.
- **AUTO-FLOW-02 — Asynchronous where latency or scheduling demands.**
  Recurrence generation, alert evaluation, and login-history mirroring
  (AUD-LOGIN-01) run asynchronously on scheduler signals.
- **AUTO-FLOW-03 — Reliable publication (requirement; implementation
  PROVISIONAL).** Batch 4 approves the *need* for: reliable event
  publication (a committed domain event is never lost if the process
  crashes after the business write), idempotent consumers, retry tracking,
  and correlation ids. It does **not** yet approve a specific mechanism.
  The provisional design is a lightweight transactional outbox (a table
  written in the same transaction as the mutation, drained by the async
  runner); direct invocation is the alternative. **AUTO-OQ-02 remains open
  until harness-gate technical validation.**
- **AUTO-FLOW-04 — Consumer discipline.** Consumers are idempotent
  (AUTO-IDM-01), record their progress, and never mutate outside their
  owning domain (the alert job writes `alerts`, not `tasks`).

## Idempotency, retry, failure

- **AUTO-IDM-01:** Every consumer tolerates duplicate delivery: effect keys
  (e.g. recurrence's unique instance key, SCH-12; alert dedupe key,
  AUTO-ALR-02) make re-processing a no-op.
- **AUTO-RET-01:** Failed async work retries with exponential backoff and a
  bounded attempt count; exhausted retries land in a dead-letter record
  surfaced in operations monitoring (`13`) — nothing disappears silently
  (AUTO-PRIN-04).
- **AUTO-RET-02:** Retry of a *sensitive* step (anything writing audit rows)
  re-uses the original `correlation_id` so the attempt chain is traceable
  (AUD-INV-06).

## Recurrence generation model

Compliance Profile → active Recurrence Rule Version → Compliance Instance:

```
client_compliance_profiles (status='active')      SCH-11
        │  resolves (at generation time, SCH-11 version-resolution rule)
        ▼
compliance_rule_versions (active version for the target period)   SCH-32
        │  evaluated by
        ▼
recurrence generator (actor_type='system', service_name='recurrence')
        │  materializes
        ▼
compliance_instances (provenance: rule_version_id, generation_source,
  generated_at, calculated_due_date, period_start/period_end)      SCH-12
```

- **AUTO-REC-01 — Trigger points.** Instances are generated: (a) when a
  profile transitions to `active` (materialize the current period); (b)
  when an instance reaches `closed` (materialize its successor, linked via
  `successor_instance_id`, SCH-12); (c) on the `sched.recurrence.evaluate`
  signal, which materializes instances entering a look-ahead window so
  work appears before the period starts.
- **AUTO-REC-02 — Look-ahead window.** The materialization lead time is
  configuration (firm settings / due_rule metadata), not hard-coded; the
  default value is set during implementation (AUTO-OQ-03).
- **AUTO-REC-03 — Duplicate protection is multi-layered.** Four layers,
  each independently sufficient:
  1. **Deterministic recurrence identity:** the period calculation
     deterministically yields `(compliance_type_id, legal_entity_id,
     registration_id, period_start)` — the same inputs always target the
     same instance key;
  2. **Idempotent generator:** generation computes "should this instance
     exist?" and inserts only if absent — re-running is a no-op;
  3. **Database uniqueness:** the SCH-12 unique constraint
     `(compliance_type_id, legal_entity_id, registration_id,
     period_start)` NULLS NOT DISTINCT makes a duplicate row physically
     impossible (NULLS NOT DISTINCT support remains harness-gate verified,
     SCH-A-03). The key deliberately excludes `rule_version_id`, so a new
     rule version can never duplicate an already-materialized obligation
     — a genuinely new obligation requires an explicit domain decision,
     not a version edit;
  4. **Retry-safe behaviour:** a unique-violation on insert is treated as
     "already generated", not an error.
- **AUTO-REC-08 — Concurrent-generator race semantics.** If two scheduler
  runs race to generate the same instance: exactly one insert succeeds;
  the loser's unique-violation is an idempotent already-exists outcome
  (layer 4); and **no duplicate downstream domain events are emitted** —
  `compliance_instance.created` is published only by the winning insert
  (publication is part of the same transaction as the successful insert,
  per the AUTO-FLOW-03 reliability requirement).
- **AUTO-REC-04 — Scope discipline.** Registration-scoped types (GST, TDS,
  PT, PF, ESI per DM-27) generate one instance per qualifying registration;
  entity-scoped types generate one per legal entity. Generation respects
  the type's `scope_kind`/`registration_class` (SCH-10) and the profile's
  registration reference (SCH-11 invariant). Statutory rules are **not
  activated in production** until external CA/domain sign-off (DM-OQ-01
  status; enforced per rule version via SCH-32 `domain_approval_status`;
  activation path in `10`).
- **AUTO-REC-05 — Due dates.** `due_date` is computed from the active rule
  version's `due_rule` (SCH-32) + the structured period (`period_start`,
  `period_end`, SCH-12); the computed value is persisted as
  `calculated_due_date` at generation. Due-rule changes do not retro-move
  materialized instances without an explicit, audited regeneration
  decision (recorded as `compliance_instance.due_date_changed`) — see
  AUTO-REC-07.
- **AUTO-REC-06 — Audit.** Generation writes audit rows with
  `actor_type='system'`, `service_name='recurrence'` (AUD-ACT-02); bulk
  generation runs share one `correlation_id` per run.

### Rule versioning and historical stability

- **AUTO-REC-07 — Generated instances are historically stable.** Schema
  specified in `06` (Batch 4 closure amendment): rule behaviour is
  versioned in `compliance_rule_versions` (SCH-32; immutable once active),
  and each generated ComplianceInstance persists its provenance on SCH-12:
  `rule_version_id` (which rule/version generated it), `generation_source`
  (`recurrence`/`manual`/`import` — manual instances are representable and
  never claim recurrence provenance), `generated_at` (when it was
  generated), `calculated_due_date` (the rule's due-date output at
  generation; the operative `due_date` may later move only via audited
  change), and the structured period (`period_start`/`period_end`).
  Editing a rule creates a **new version** and must never silently change
  already-generated instances. If future due-date computation needs inputs
  beyond the version row, an additional immutable inputs snapshot is
  required before such inputs are introduced (SCH-12 design note).
- **AUTO-REC-09 — Statutory rule versions are gated.** A statutory rule
  *version* must not become `active` in production until the required
  external practicing-CA / compliance-domain approval exists — an explicit
  lifecycle invariant via SCH-32 `domain_approval_status` (DM-OQ-01).
  Architecture approval of the Registration Scope Matrix is **not**
  professional statutory-rule approval. Versioning does not weaken that
  gate.

## Deadline materialization

- **AUTO-DLN-01:** The deadline board is a **derived read model** over
  `compliance_instances(due_date, state)` (index per SCH-12) — no separate
  materialized deadline rows in R0. "Materialization" means the recurrence
  generator has created the instances; the board query (`07`, API-R0-DLN)
  renders them. Extension/change of a statutory due date updates the
  instance's operative `due_date` (`due_date_changed` event), never the
  immutable `calculated_due_date` provenance (SCH-12).

## Alert evaluation

- **AUTO-ALR-01:** On the `sched.alerts.evaluate` signal, the evaluator
  runs enabled `alert_rules` (SCH-19) against live data: deadline-risk
  thresholds, unsigned engagement letters (DM-09),
  offboarding-with-open-obligations, workload thresholds.
- **AUTO-ALR-02 — Dedupe.** At most one `active` alert per
  `(alert_rule_id, object)`; re-evaluation of an existing condition updates
  nothing (idempotent, AUTO-IDM-01).
- **AUTO-ALR-03 — Hybrid resolution (DM-OQ-05).** Rule-derived alerts with
  `auto_resolve=true` (SCH-19) auto-resolve when the triggering condition
  clears — every auto-resolution is audit-logged with
  `resolution_type='auto'`. Rules with `requires_explicit_ack=true` stay
  acknowledged-but-open until an authorized human resolves them. Manual
  alerts resolve only via the resolve RPC (RLS-ALR-01).

## Reminder-ready events (recording only in R0)

- **AUTO-RMD-01:** When an instance sits in `information_requested` past
  rule-configured thresholds, the evaluator records the reminder-ready fact
  (surfaced on the client-dependency board, API-R0-DLN). **Sending** any
  reminder is Release 1 (DEC-T exclusion); the R0 UI action remains
  demo-only (`sendReminder`, DEMO-ONLY in `07`).

## Audit and correlation interaction

- **AUTO-AUD-01:** Every automation write to tenant data produces audit
  rows per AUD-ACT-02/03 and AUD-EVT-02; no anonymous system writes
  (RLS-SVC-02).
- **AUTO-AUD-02:** Domain events and the audit rows they cause share
  `correlation_id` (AUD-INV-06); scheduler-originated runs mint one
  correlation id per run (carried on the signal, AUTO-ENV-02).

## Observability (handed to `13`)

- **AUTO-OBS-01:** Every scheduled run records: job identity, started/
  finished, rows affected, failures, dead-letters. The job-run log and
  alerting thresholds are operations concerns specified in `13`.

## Replay considerations

- **AUTO-RPL-01:** Domain events are facts with stable ids; consumers are
  idempotent, so replays are safe. R0 provides no replay tooling; if a
  consumer bug requires reprocessing, operators re-enqueue by
  `correlation_id`/time range from the publication record — a manual,
  audited operation. Formal replay tooling is post-R0. Scheduler signals
  are never "replayed" as events; re-running a job is simply firing the
  signal again (idempotent consumers make this safe).

## Scheduling mechanism — comparison and provisional recommendation

DEC-N approved a **hybrid pg_cron + Edge Functions direction**; the exact
invocation mechanism remains provisional pending harness-gate validation
(DEC-OQ-02: is `pg_net` acceptable, or should a queue-table poller be
evaluated?). Options compared:

| Option | Strengths | Weaknesses |
|---|---|---|
| A. pg_cron only | In-database, transactional with data, simple for DB-native jobs (`sched.recurrence.evaluate`, `sched.alerts.evaluate`) | No HTTP semantics; invoking Edge Functions needs `pg_net` (DEC-OQ-02); limited retry/dead-letter ergonomics |
| B. Database queue + worker | Full retry/dead-letter control; testable locally | A worker process to host and monitor; more moving parts for R0 scale |
| C. Supabase Edge Function schedules only | Managed runtime; good for external calls | Scheduling granularity/reliability guarantees must be verified; DB-native jobs become awkward |
| D. Hybrid (provisional) | pg_cron for DB-native evaluation/generation signals; Edge Functions where an HTTP/runtime boundary is genuinely needed | Two mechanisms to operate; boundary must be documented |

- **AUTO-SCH-01 (provisional recommendation):** Option D — pg_cron fires
  the DB-native scheduler signals (recurrence, alert evaluation,
  login-history mirroring) against the reliable-publication mechanism
  (AUTO-FLOW-03); Edge Functions are introduced only for work needing an
  HTTP/runtime boundary (Release 1 reminder sending is the first
  candidate). **Not finalized:** mechanism details (including `pg_net`
  acceptability per DEC-OQ-02) are validated at the harness gate and
  recorded here before implementation.
- **AUTO-SCH-02 — Harness-gate validation needs:** pg_cron availability on
  the target projects; `pg_net` availability/acceptability (DEC-OQ-02);
  schedule granularity; observable failure behaviour; local-stack parity
  (jobs must run identically under the Supabase CLI local stack, TEN-12).

## Verification (forward references to `11`)

- **TEST-AUTO-01:** Recurrence generates exactly one instance per
  obligation per period across re-runs (AUTO-REC-03 layers 1–4).
- **TEST-AUTO-02:** Profile activation and instance closure each trigger
  correct materialization (AUTO-REC-01); inactive profiles generate nothing
  (DM-11).
- **TEST-AUTO-03:** Registration-scoped types generate per registration;
  entity-scoped per entity (AUTO-REC-04, DM-27).
- **TEST-AUTO-04:** Alert evaluation dedupes (AUTO-ALR-02) and auto-resolve
  writes `resolution_type='auto'` audit rows (AUTO-ALR-03).
- **TEST-AUTO-05:** Consumer idempotency — duplicate event delivery
  produces no duplicate effect (AUTO-IDM-01).
- **TEST-AUTO-06:** Failure path — exhausted retries produce dead-letter
  records and operational signals (AUTO-RET-01).
- **TEST-AUTO-07:** Automation audit rows carry the correct non-human
  actor model (AUTO-AUD-01, AUD-ACT-05).
- **TEST-AUTO-08:** Scheduler mechanism checks per AUTO-SCH-02 (executed
  with the RLS-MECH-02 spike at the harness gate).
- **TEST-AUTO-09:** Historical stability — activating a new rule version
  does not change already-generated instances; each generated instance
  retains `rule_version_id`, `generation_source`, `generated_at`,
  `calculated_due_date`, and its structured period (AUTO-REC-07; schema
  SCH-32/SCH-12); a statutory version cannot activate without
  `domain_approval_status='approved'` (AUTO-REC-09).
- **TEST-AUTO-10:** Concurrent-generator race — two simultaneous runs yield
  exactly one instance and exactly one `compliance_instance.created` event
  (AUTO-REC-08).

## Assumptions

- AUTO-A-01: pg_cron (and possibly `pg_net`) are available on the target
  Supabase projects and the local CLI stack — validated per AUTO-SCH-02.
- AUTO-A-02: R0 automation volume (one firm-scale deployment) fits simple
  scheduled evaluation; a queue/worker system is not justified yet
  (option B deferred without prejudice).

## Dependencies

- Upstream: `01` (DEC-N, DEC-OQ-02), `02` (DM-SM-04/05/06, DM-10/11/22,
  DM-27), `05` (RLS-SVC-02, RLS-ALR-01), `06` (SCH-10/11/12/18/19/20 —
  including SCH-32 rule versions and SCH-12 provenance per the Batch 4
  closure amendment), `07` (RPC producers, derived read models), `08`
  (AUD-ACT/EVT/INV).
- Downstream: `11` (TEST-AUTO definitions), `13` (job-run observability,
  scheduler operations).

## Open Questions

| ID | Question | Owner | Status |
|---|---|---|---|
| AUTO-OQ-01 (= DEC-OQ-02) | Final scheduled-job mechanism: `pg_net` from pg_cron acceptable, or queue-table poller? | harness gate | **Open — provisional hybrid (AUTO-SCH-01); must not be silently finalized** |
| AUTO-OQ-02 | Event-publication implementation: transactional outbox vs direct invocation (the *need* for reliability/idempotency/retry/correlation is approved, AUTO-FLOW-03; the mechanism is not) | harness gate | **Open — provisional outbox** |
| AUTO-OQ-03 | Default recurrence look-ahead window value (AUTO-REC-02) | implementation + product | Open — configurable; default TBD |
| AUTO-OQ-04 | Which R0 alert rules ship enabled by default and with what thresholds | product (PRD §16) + `10` seeding | Open |
| AUTO-OQ-05 (= AUTO-XREF-01) | Schema amendment for rule versioning + generation provenance | — | **Resolved (Batch 4 closure amendment):** specified in `06` — SCH-32 `compliance_rule_versions` (immutable, effective-dated, domain-approval gate) + SCH-12 provenance fields (`rule_version_id`, `generation_source`, `generated_at`, `calculated_due_date`) |

## Acceptance Criteria

- AUTO-ACC-01: The domain-event catalogue lists exactly the 14 mandated
  business-fact events; scheduler/internal signals live in a **separate**
  catalogue with the distinct `sched.<job>.<action>` convention, and no
  scheduler tick is classified as a domain event (AUTO-PRIN-02/05).
- AUTO-ACC-02: Envelope, idempotency, retry, dead-letter, and failure
  rules are specified (AUTO-ENV/IDM/RET); the reliable-publication need is
  approved while its implementation remains provisional (AUTO-FLOW-03).
- AUTO-ACC-03: The recurrence model specifies trigger points, the
  four-layer duplicate protection with race semantics (AUTO-REC-03/08),
  scope discipline per DM-27, due-date computation, system-actor auditing,
  and rule-versioning/historical-stability requirements with schema
  specified in `06` (SCH-32/SCH-12; AUTO-XREF-01 satisfied).
- AUTO-ACC-04: Deadline board is defined as a derived read model; alert
  evaluation implements the DM-OQ-05 hybrid with audit-logged
  auto-resolution.
- AUTO-ACC-05: Scheduling options are compared, a provisional
  recommendation recorded, and validation needs assigned to the harness
  gate — with no silent finalization (AUTO-OQ-01).
- AUTO-ACC-06: Reminder handling is recording-only in R0; no sending is
  specified.

## Consequence of Change

Domain events are integration contracts: renaming or removing a catalogue
event breaks consumers and audit queries; the recurrence
duplicate-protection key is anchored in SCH-12 (and deliberately excludes
`rule_version_id`), so changing that constraint invalidates
AUTO-REC-03/08. Provenance immutability (SCH-32/SCH-12 update guards) is
load-bearing for AUTO-REC-07 and TEST-AUTO-09; weakening it is a
compliance-posture change requiring requester sign-off. Changing the
scheduling mechanism after the harness gate requires updating this spec,
`13` (operations), and the harness tests.
