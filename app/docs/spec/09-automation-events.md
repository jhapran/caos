# 09 — Automation & Events (Design)

- **Status:** Approved (Batch 4)
- **Approval status:** Approved (Batch 4). Closure amendment recorded: AUTO-XREF-01 satisfied by the `06` schema amendment (SCH-32 `compliance_rule_versions` + SCH-12 provenance fields); AUTO-OQ-05 resolved. (DEC-J resolved 2026-09-01 — live membership lookup, `05` RLS-MECH-01.) **IMP-050 architecture amendment (human-ruled 2026-09-11): AUTO-OQ-01 RESOLVED — pg_cron is the final R0 scheduler, invoking hardened in-database scheduler/job functions (pg_net not required for R0; HTTP/Edge-function scheduling deferred to R1+); AUTO-OQ-02 RESOLVED — transactional outbox is the final event-publication mechanism (direct downstream invocation rejected for R0); AUTO-OQ-03 RESOLVED — 90-calendar-day configurable default look-ahead on an Asia/Kolkata business-date basis. AUTO-SCH-02 recorded PASS (LOCAL/HOSTED/OVERALL).** **IMP-050 contract closure (human rulings 2026-09-12): cron registration ownership partitioned (AUTO-SCH-04) — IMP-050 registers `sched.recurrence.evaluate` and ONE infrastructure outbox-drain job; IMP-051 owns the `sched.alerts.evaluate` registration; `sched.login_mirror.run` retains its existing deferred ownership/binding and stays outside IMP-050; the outbox drain is infrastructure, NOT a fourth scheduler signal. Cadences fixed (AUTO-SCH-05) — recurrence once daily 00:30 Asia/Kolkata; outbox drain once per minute. pg_cron installation/migration boundary fixed (AUTO-SCH-06) — restored local baseline is available/preloaded with the extension NOT installed; the IMP-050 migration MAY carry `CREATE EXTENSION IF NOT EXISTS pg_cron` for deterministic local reset/build; hosted `CREATE EXTENSION` remains a separate explicit human state-change gate. TEST-AUTO-05/06 clarified — harness-only synthetic consumer / failure-injection fixtures; no production outbox consumer is created to test drain behavior. **Contract-closure review corrections (human rulings 2026-09-12 — historical: the contract-closure review returned PASS WITH REQUIRED CORRECTIONS; the required corrections R5–R8 were human-ruled and applied):** R5 — the recurrence cron registration uses the expression `0 19 * * *` interpreted in GMT (= 00:30 Asia/Kolkata, fixed UTC+05:30); CAOS never mutates the global `cron.timezone`, and a GMT precondition gates registration and every acceptance gate (AUTO-SCH-07). R6 — the hosted pg_cron state change enters ONLY through the version-controlled IMP-050 migration ledger; Dashboard-only or manual out-of-chain enablement is prohibited (AUTO-SCH-06). R7 — SCH-12 `successor_instance_id` linkage is structurally same-firm via the composite same-firm FK pattern (AUTO-SCH-03/SCH-FK-01 clarification, `06`). R8 — deterministic post-IMP-050 catalog targets recorded: 24 tables, RLS enabled 24/24, FORCE RLS 20 (SCH-33/SCH-35 forced; SCH-34 enabled, not forced), policies 51. **Final independent contract-closure re-review (2026-09-12): PASS — findings NONE. The IMP-050 implementation contract / contract closure is HUMAN APPROVED 2026-09-12.** Open/provisional items remaining: AUTO-OQ-04 only.**

## Purpose

Defines the Release 0 event and automation architecture: the domain-event
catalogue (completed business facts), the **separate** scheduler /
internal-signal catalogue (job triggers — not business events), how events
are produced and consumed, recurrence generation for compliance instances,
deadline materialization, alert evaluation, and the scheduled-execution
mechanism (final R0 mechanism recorded below — AUTO-OQ-01 resolved
2026-09-11). Design only — no jobs, triggers, or functions are implemented
in Phase 2.

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
- Scheduling-mechanism comparison and the final R0 mechanism decision
  (AUTO-OQ-01 resolved 2026-09-11).
- Replay considerations.

## Non-goals

- No implementation: no pg_cron jobs, no Edge Functions, no queue workers.
- No reminder *sending* (Release 1, DEC-T exclusion) — R0 records
  reminder-ready facts only.
- No AI pipelines (DEC-C, `20-ai-services.md`).
- No scheduling of HTTP/Edge-function invocation in R0 — the final R0
  mechanism is pg_cron invoking hardened in-database scheduler/job
  functions (AUTO-OQ-01 resolved 2026-09-11); HTTP/Edge scheduling is
  deferred to R1+.
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
| `review.submitted` | `submit_review_item` (API-R0-RVW) | Work entered the queue | reviewer queue (realtime, API-RT-01); audit |
| `review.completed` | `decide_review_item` (API-R0-RVW) | Approve/return/escalate/dismiss decided (DM-SM-06) | submitter visibility; audit (decision + rationale, AUD-CAT-01) |
| `alert.created` | alert evaluation job or manual raise | A risk signal became active | alert surfaces (realtime, API-RT-01); audit |
| `alert.resolved` | resolve RPC or auto-resolution job | Alert resolved (`resolution_type` manual/auto, DM-OQ-05) | alert surfaces; audit (auto-resolution always logged) |
| `membership.changed` | membership administration RPCs | Invite/role/suspend/remove (RLS-AAL-01) | authz freshness (DEC-J mechanism); audit |

- **AUTO-EVT-01:** The catalogue above is exhaustive for R0 domain events;
  adding events requires a domain justification per AUTO-PRIN-01, not a
  trigger habit.
- **`compliance_instance.created` publication note (IMP-031 partition):**
  audit capture of manual creation (Layer A) is NOT domain-event
  publication; the publication mechanism is the transactional outbox
  (AUTO-OQ-02 RESOLVED 2026-09-11 — SCH-33, wired at IMP-050). IMP-031
  manual creation does not publish this event to any
  bus/outbox/webhook. With the approved mechanism recorded,
  manual creation is wired to publish under the event contract at IMP-050.
- **`task.created` / `task.assigned` / `task.completed` publication note
  (IMP-040 partition, 2026-09-04):** these remain approved event-contract
  names in the catalogue above, but IMP-040 owns mutation + audit only —
  it does NOT publish them. Audit capture (Layer A/B) is NOT domain-event
  publication; no outbox, event bus, webhook publisher, queue, or event
  trigger may be created for task events in IMP-040. Publication is wired
  at IMP-050 under this event contract, through the resolved transactional
  outbox mechanism (AUTO-OQ-02 RESOLVED 2026-09-11 — SCH-33).
- **`review.submitted` / `review.completed` publication note (IMP-041
  partition, contract closure 2026-09-05):** these remain approved
  event-contract names in the catalogue above, but IMP-041 owns mutation +
  audit only — it does NOT publish them. Audit capture (Layer B, `08` §7c)
  is NOT domain-event publication; no outbox, event bus, webhook publisher,
  queue, background delivery worker, or event trigger may be created for
  review events in IMP-041. Publication is wired at IMP-050 under this
  event contract, through the resolved transactional outbox mechanism
  (AUTO-OQ-02 RESOLVED 2026-09-11 — SCH-33).

## Scheduler / internal-signal catalogue (Release 0)

These are **job triggers, not domain events** (AUTO-PRIN-05). They use the
`sched.<job>.<action>` convention (AUTO-PRIN-02) and are logged
operationally (`13`), never consumed as business facts:

| Signal | Fires | Consumed by |
|---|---|---|
| `sched.recurrence.evaluate` | Once daily at 00:30 Asia/Kolkata — cron expression `0 19 * * *` interpreted in GMT (fixed UTC+05:30; AUTO-SCH-07 GMT precondition), Ruling 2026-09-12, AUTO-SCH-05 — catch-up / look-ahead maintenance | Recurrence generator — evaluates active profiles and materializes due instances (AUTO-REC-01) |
| `sched.alerts.evaluate` | On the alert-evaluation schedule | Alert evaluation job — runs enabled alert_rules (AUTO-ALR-01) |
| `sched.login_mirror.run` | On the login-history schedule | Login-history mirroring job (AUD-LOGIN-01) |

- **AUTO-EVT-02:** Adding scheduler signals is an operations decision
  recorded here; signals never appear in the domain-event catalogue and
  never write audit rows by themselves.
- **Catalogue exhaustiveness (Ruling 2026-09-12, AUTO-SCH-04):** the
  scheduler/internal-signal catalogue above is EXACTLY these three
  signals. The transactional-outbox drain is an operational
  **infrastructure** job — it is NOT a scheduler/domain signal, is never
  named `sched.*`, and MUST NOT be added to this catalogue.

## Producers, consumers, and flow

- **AUTO-FLOW-01 — Synchronous by default.** Anything the user must see
  confirmed (transitions, decisions) completes synchronously in the request
  path; its domain event is recorded in the same transaction.
- **AUTO-FLOW-02 — Asynchronous where latency or scheduling demands.**
  Recurrence generation, alert evaluation, and login-history mirroring
  (AUD-LOGIN-01) run asynchronously on scheduler signals.
- **AUTO-FLOW-03 — Reliable publication (requirement and mechanism both
  FINAL).** Batch 4 approved the *need* for: reliable event
  publication (a committed domain event is never lost if the process
  crashes after the business write), idempotent consumers, retry tracking,
  and correlation ids. **The mechanism is RESOLVED (AUTO-OQ-02, human
  ruling 2026-09-11): the transactional outbox.** A publication record
  (schema contract SCH-33, `06`) is written **in the same transaction** as
  the domain mutation and drained by the async runner with retry/backoff
  and dead-lettering (AUTO-RET-01; SCH-34/SCH-35). **Direct downstream
  invocation is REJECTED for R0** — it cannot satisfy the no-loss
  requirement across a process crash between mutation and invocation.
- **AUTO-FLOW-04 — Consumer discipline.** Consumers are idempotent
  (AUTO-IDM-01), record their progress, and never mutate outside their
  owning domain (the alert job writes `alerts`, not `tasks`).

## Idempotency, retry, failure

- **AUTO-IDM-01:** Every consumer tolerates duplicate delivery: effect keys
  (e.g. recurrence's unique instance key, SCH-12; alert dedupe key,
  AUTO-ALR-02) make re-processing a no-op. **Effect keys — not
  `event_id` — are the consumer idempotency identity:** `event_id` is
  publication/event-record identity (SCH-33); a manual requeue publishes
  the SAME domain fact under a NEW `event_id` (AUTO-RPL-01/02), and
  consumers must still not duplicate domain effects.
- **AUTO-FLOW-05 — R0 `delivered` semantics (SCH-33 `status`).** A
  publication reaches `delivered` when **all consumers actually
  registered for that event publication in R0 have completed**, each
  effect applied idempotently by domain effect key (AUTO-IDM-01). The
  registered-consumer set derives strictly from approved consumer
  contracts: synchronous audit capture (Layer A/B at mutation time,
  `08`), pull-based scheduled evaluation (AUTO-ALR-01 — IMP-051 reads
  live data on a schedule; it does not consume publications), and derived
  read models (deadline board AUTO-DLN-01; My Work; dashboard
  invalidation via the approved API-RT-07 polling fallback) are **not**
  outbox consumers. **In R0 no catalogue event registers an outbox
  consumer**, so the drain runner completes the (empty) registered set
  and marks the publication `delivered`: `delivered` is a drain-
  completion record for the publication, **never a claim of external/HTTP
  delivery** (pg_net and HTTP consumers are deferred, AUTO-SCH-01).
  Retry/backoff (AUTO-RET-01) and dead-lettering (SCH-35) govern the
  drain step itself and bind any consumer a future amendment registers.
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
  work appears before the period starts. **Scheduled-run semantics
  (Ruling 2026-09-12, AUTO-SCH-05):** the scheduled run is catch-up /
  look-ahead maintenance — trigger points (a) and (b) retain their
  immediate materialization behavior and never wait for the daily run.
  Trigger point (a) is owned by the
  generator package (IMP-050); IMP-031 ships the profile approval command
  without any generation side effect — an `active` profile with zero
  materialized instances is valid in the interim; no trigger/RPC-enqueued
  generation may be invented before IMP-050.
- **AUTO-REC-02 — Look-ahead window.** The materialization lead time is
  configuration, not hard-coded; **the R0 configuration carrier is
  `firms.settings.recurrence_lookahead_days`** (integer calendar days,
  SCH-01 `settings` jsonb, `06`) — read **server-side only** by the
  recurrence generator, defaulting to **90 when the key is absent or
  null**. No separate configuration table exists for this value.
  **Validation (2026-09-12):** a present value MUST be a positive integer
  (calendar days); an invalid present value (non-integer, zero, negative,
  or otherwise unparsable) is a **configuration error** — it MUST NOT
  silently fall back to 90, and recurrence evaluation for that firm MUST
  fail observably (recorded job failure, AUTO-OBS-01/SCH-34) rather than
  generate under an unintended horizon.
  **Default value RESOLVED (AUTO-OQ-03, human ruling 2026-09-11): 90
  calendar days.** The 90-day value is the R0 default configuration value
  only — it must not be scattered as hard-coded literals through business
  logic, and the configuration architecture must permit future
  firm-specific values **without changing recurrence identity or
  generated-instance semantics** (the SCH-12 uniqueness key and provenance
  contract are configuration-independent).
- **AUTO-REC-10 — Business-date basis (AUTO-OQ-03, human ruling
  2026-09-11).** The generator derives its **business date in
  Asia/Kolkata**; the recurrence generation horizon is **inclusive through
  business_date + 90 calendar days** (the configured look-ahead —
  `firms.settings.recurrence_lookahead_days`, default 90 when absent/null,
  AUTO-REC-02). All
  date-based recurrence calculations (period derivation, horizon
  comparison, due-rule evaluation inputs) use the Asia/Kolkata business
  date. **Persisted timestamps remain UTC** (`timestamptz` per `06`
  conventions); **statutory due dates must never be reinterpreted through
  UTC date boundaries** — a due date is a business date in the Asia/Kolkata
  calendar, not a UTC instant truncation. **Timezone independence
  (Ruling 2026-09-12):** the recurrence function derives its
  `business_date` explicitly in Asia/Kolkata; correctness MUST NOT depend
  on the PostgreSQL server or session timezone.
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

  **Package partition:** layer 3 (database uniqueness, SCH-12 NULLS NOT
  DISTINCT key) is owned by IMP-031 (schema); layers 1, 2 and 4
  (deterministic identity computation, idempotent generator, retry-safe
  behavior) are owned by IMP-050.
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
  `period_end`, SCH-12); "the active rule version" is resolved by the
  SCH-32 active-as-of-date predicate for the target period (R0 closure
  2026-09-03). The computed value is persisted as
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
- **Snooze-expiry ownership (human-ruled at IMP-042 contract
  reconciliation 2026-09-06):** persisted snooze-expiry normalization is
  the evaluator's responsibility (IMP-051). IMP-042 derives the effective
  status at read time per the SCH-18 matrix and performs no expiry
  writes.

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
  finished, rows affected, failures, dead-letters. The records are the
  scheduler job-run and dead-letter contracts (SCH-34/SCH-35, `06`); the
  alerting thresholds and operational surfacing are operations concerns
  specified in `13`.

## Replay considerations

- **AUTO-RPL-01:** Domain events are facts; consumers are idempotent, so
  replays are safe. R0 provides no replay tooling; if a consumer bug
  requires reprocessing, recovery is a manual, audited operation.
  **Dead-letter gating (R0 ruling, 2026-09-12):** manual recovery/requeue
  applies ONLY after a publication has reached dead-letter state (SCH-35
  record; SCH-33 `status='dead_lettered'`). Operators may identify
  dead-lettered candidates by `correlation_id` and/or time range across
  the publication record (the transactional outbox, SCH-33) and the
  dead-letter record (SCH-35, `06`), but the recovery operation itself
  acts on the SCH-35 dead-letter record and its source SCH-33 publication
  (AUTO-RPL-02). `pending` and ordinary `failed` publications remain
  under automatic retry (AUTO-RET-01) and are NOT manually requeued in
  R0. **Requeue identity semantics
  (2026-09-11):** a manual requeue creates a **NEW SCH-33 publication row
  with a NEW `event_id`** (`event_id` is publication/event-record
  identity — NOT the consumer idempotency identity, which is the domain
  effect key per AUTO-IDM-01), `requeue_of` pointing at the original
  publication's `event_id`, the original envelope facts unchanged, and
  the **original `correlation_id` preserved** (AUTO-RET-02). A requeue
  does **not** represent a new domain fact and must **not** duplicate
  domain effects — effect-key idempotency (AUTO-IDM-01) is what makes
  re-delivery a no-op. Formal replay tooling is post-R0. Scheduler
  signals are never "replayed" as events; re-running a job is simply
  firing the signal again (idempotent consumers make this safe).
- **AUTO-RPL-02 — Manual recovery path (hardened, server/operator-only;
  2026-09-11; dead-letter-gated per AUTO-RPL-01, 2026-09-12).**
  Re-enqueue of a dead-lettered publication
  executes ONLY through a hardened privileged function — contract-level
  name `requeue_dead_letter(p_dead_letter_id uuid, p_reason text)`,
  consistent with the existing Layer-B definer-command naming
  conventions; the final signature is an implementation detail within
  this contract. The function acts on the SCH-35 dead-letter record and
  its source SCH-33 publication, and MUST refuse requeue of any
  publication that has not reached dead-letter state — `pending`/`failed`
  publications remain under automatic retry (AUTO-RPL-01). Requirements: SECURITY DEFINER with a pinned empty
  `search_path` and fully qualified object references per the existing
  CAOS privileged-function hardening conventions; **no EXECUTE for
  `anon`/`authenticated` and no browser access** — EXECUTE is confined to
  the server/operator context (service role, RLS-SVC-01); a **recovery
  reason is required and recorded**; the **source publication/dead-letter
  identity is recorded** (`requeue_of` on the new SCH-33 row; the
  `open → requeued` transition on the SCH-35 row); the **original
  correlation chain is preserved** (AUTO-RET-02 — the new publication
  carries the original `correlation_id`); and the recovery operation
  itself is **audited** using the EXISTING audit actor taxonomy —
  `actor_type='service'` with a `service_name` for the operator-run
  server path (AUD-ACT-03, RLS-SVC-02, AUD-SVC-01); **no new actor type
  is introduced**.

## Scheduling mechanism — comparison and final R0 decision

DEC-N approved a **hybrid pg_cron + Edge Functions direction**; the exact
invocation mechanism was provisional pending harness-gate validation
(DEC-OQ-02: is `pg_net` acceptable, or should a queue-table poller be
evaluated?). **DEC-OQ-02 / AUTO-OQ-01 is RESOLVED by human ruling
2026-09-11** (below). Options compared:

| Option | Strengths | Weaknesses |
|---|---|---|
| A. pg_cron only | In-database, transactional with data, simple for DB-native jobs (`sched.recurrence.evaluate`, `sched.alerts.evaluate`) | No HTTP semantics; invoking Edge Functions needs `pg_net` (DEC-OQ-02); limited retry/dead-letter ergonomics |
| B. Database queue + worker | Full retry/dead-letter control; testable locally | A worker process to host and monitor; more moving parts for R0 scale |
| C. Supabase Edge Function schedules only | Managed runtime; good for external calls | Scheduling granularity/reliability guarantees must be verified; DB-native jobs become awkward |
| D. Hybrid (historical provisional — superseded by the final R0 decision below) | pg_cron for DB-native evaluation/generation signals; Edge Functions where an HTTP/runtime boundary is genuinely needed | Two mechanisms to operate; boundary must be documented |

- **AUTO-SCH-01 (FINAL R0 mechanism — AUTO-OQ-01 / DEC-OQ-02 RESOLVED,
  human ruling 2026-09-11):** **pg_cron is the R0 scheduler.** pg_cron
  fires the DB-native scheduler signals (recurrence, alert evaluation,
  login-history mirroring) by invoking **hardened in-database
  scheduler/job functions**, which write to and drain the transactional
  outbox (AUTO-FLOW-03; SCH-33) with job-run and dead-letter records
  (SCH-34/SCH-35). **pg_net is NOT required for R0** — no scheduled job
  invokes HTTP in R0; **HTTP/Edge-function scheduling is deferred to R1+**
  (Release 1 reminder sending remains the first candidate). The DEC-N
  hybrid direction is thereby narrowed for R0 to Option A's scope; Edge
  Functions enter only when an HTTP/runtime boundary genuinely exists.
- **AUTO-SCH-02 — Validation record: PASS (2026-09-11).** Evidence
  artifacts with full provenance (OBSERVED / HUMAN-PROVIDED /
  INDEPENDENTLY RE-VERIFIED / NOT RETAINED):
  `docs/harness/auto-sch-02-probe.md` +
  `docs/harness/auto-sch-02-results.json`.
  - **LOCAL: PASS.** Targeted local execution-context probe on the
    Supabase CLI stack: pg_cron 1.6.4 available/preloaded with the
    extension NOT installed at baseline — the probe temporarily enabled
    it (`CREATE EXTENSION` succeeded) for evidence capture and restored
    the baseline afterwards; seconds-based schedule accepted; synthetic
    success and deliberate failure jobs fired with run history observed;
    named reschedule/upsert behaviour observed; a pg_cron job fired a
    SECURITY INVOKER probe function; full teardown verified (job
    unscheduled, probe objects dropped, pg_cron dropped — restored
    baseline: available/preloaded, extension absent; zero residue —
    relations, functions, clean Git tree).
  - **HOSTED: PASS (availability only — scoped to the actual staging
    project).** Authorized human read-only Supabase Studio catalog
    queries on the hosted staging project (`pyrniumcjcvagjygheyu`):
    `pg_available_extensions` contains pg_cron with
    `default_version = 1.6.4`, `installed_version = NULL` ("Job scheduler
    for PostgreSQL"); `pg_available_extension_versions` offers versions
    through 1.6.4 with none installed;
    `current_setting('cron.database_name', true) = 'postgres'` — pg_cron
    targets the project database. No hosted state was changed. **This
    evidence is scoped to the actual staging project ONLY — production
    pg_cron availability is NOT claimed and remains a pre-cutover
    verification.**
    **Hosted `CREATE EXTENSION` remains a future explicit human
    state-change gate — availability is proven, installation is NOT
    authorized by this record.**
  - **OVERALL: PASS.** pg_cron availability, local execution behaviour,
    and hosted availability are validated; schedule granularity and
    failure behaviour are exercised through the TEST-AUTO-08 mechanism
    checks during IMP-050 implementation (local stack parity, TEN-12).
- **AUTO-SCH-03 — Scheduler execution-context security constraint
  (binding; established by the LOCAL probe evidence, 2026-09-11).** The
  cron execution identity was observed as `postgres` with
  `rolsuper = false` and **`rolbypassrls = true`**: FORCE ROW LEVEL
  SECURITY did not constrain the cron-fired SECURITY INVOKER path — the
  bypass is structural (BYPASSRLS), not SECURITY DEFINER. Therefore:
  (a) **scheduler isolation MUST NOT rely on RLS** — RLS is evidence of
      nothing in the scheduler context;
  (b) scheduler/job functions must **enforce tenant/firm boundaries
      explicitly** in function logic (explicit per-firm iteration and
      firm-scoped writes), and cross-firm references must remain
      structurally constrained (composite same-firm FKs, SCH-FK-01…03);
  (c) **`anon`/`authenticated` must have no scheduler execution
      capability** — no EXECUTE on scheduler/job functions, no grants on
      the SCH-33/34/35 records (browser grant posture per `06`);
  (d) scheduler writes must carry **system/service audit context**
      (`actor_type='system'`, `service_name`, AUD-ACT-02/RLS-SVC-02) and a
      per-run **correlation identity** (AUTO-AUD-02, AUTO-ENV-02).
- **AUTO-SCH-03 clarification — successor same-firm structure (Ruling
  2026-09-12, R7; clarification of the existing AUTO-SCH-03 / SCH-FK-01
  contract, not a new architecture decision).** For `compliance_instances`
  successor linkage, `successor_instance_id` MUST be structurally
  same-firm via the existing composite same-firm FK pattern:
  `(firm_id, successor_instance_id)` → `compliance_instances(firm_id,
  id)`, preserving nullable successor semantics (the `(firm_id, id)`
  parent-key precedent per the SCH-FK conventions; the composite FK lands
  with the IMP-050 implementation migration — contract recorded in `06`
  SCH-12). The generator function logic additionally enforces valid
  successor/cycle semantics. This boundary MUST NOT rely on RLS.
- **AUTO-SCH-04 — Cron registration ownership (FINAL, human ruling
  2026-09-12).** IMP-050 owns exactly TWO pg_cron registrations: (1)
  `sched.recurrence.evaluate` and (2) ONE infrastructure outbox-drain
  job. IMP-050 does NOT register `sched.alerts.evaluate` (its
  registration is owned by IMP-051) and does NOT register
  `sched.login_mirror.run` (which retains its existing deferred
  ownership/binding). The outbox drain is an **operational
  infrastructure job** — it is NOT a fourth scheduler/domain signal and
  MUST NOT be added to the AUTO-PRIN-02 catalogue, which remains exactly
  `sched.recurrence.evaluate`, `sched.alerts.evaluate`,
  `sched.login_mirror.run`.
- **AUTO-SCH-05 — Cadences (FINAL, human ruling 2026-09-12).**
  `sched.recurrence.evaluate` runs **once daily at 00:30 Asia/Kolkata**;
  the scheduled run is catch-up / look-ahead maintenance — profile
  activation and instance closure retain their immediate materialization
  behavior (AUTO-REC-01 trigger points a/b) — and the recurrence function
  derives `business_date` explicitly in Asia/Kolkata, never depending on
  the PostgreSQL server/session timezone (AUTO-REC-10). **Cron
  representation (Ruling 2026-09-12, R5):** the business requirement is
  unchanged; the pg_cron registration MUST use the expression
  **`0 19 * * *` interpreted in GMT** — 00:30 Asia/Kolkata, because
  Asia/Kolkata is fixed UTC+05:30 — under the AUTO-SCH-07 GMT
  precondition; CAOS MUST NOT modify the global `cron.timezone` setting.
  The
  **infrastructure outbox drain runs once per minute** via a **stable
  named pg_cron registration**; the registration is **idempotent /
  re-runnable** (named upsert semantics per the AUTO-SCH-02 probe
  evidence) and is **timezone-independent**. The drain remains
  infrastructure, not a scheduler signal.
- **AUTO-SCH-06 — pg_cron installation / migration boundary (FINAL,
  human ruling 2026-09-12).** Restored local baseline after the
  AUTO-SCH-02 probe: pg_cron **available and preloaded, extension NOT
  installed** (the probe temporarily enabled the extension and restored
  the baseline). Implementation contract: the version-controlled IMP-050
  migration **MAY contain `CREATE EXTENSION IF NOT EXISTS pg_cron`** —
  deterministic clean local reset/build; no Dashboard-only/manual local
  drift. **Hosted staging:** pg_cron is available but NOT installed;
  applying `CREATE EXTENSION` to hosted staging remains a **separate
  explicit HUMAN STATE-CHANGE GATE** — this contract/spec closure does
  NOT authorize executing it. **Hosted state-change path (Ruling
  2026-09-12, R6):** the human gate means the human explicitly authorizes
  application of the **version-controlled IMP-050 migration** to hosted
  staging — the hosted pg_cron state change MUST enter through the
  migration ledger. **PROHIBITED:** Dashboard-only enablement; manual SQL
  `CREATE EXTENSION` outside the migration chain; enabling pg_cron first
  and then letting the migration silently no-op. Sequence: (1)
  implementation + local acceptance → (2) human authorizes the hosted
  state change → (3) the version-controlled IMP-050 migration is applied
  to staging → (4) the migration executes
  `CREATE EXTENSION IF NOT EXISTS pg_cron` → (5) the migration continues
  with the contract-approved schema/functions/jobs → (6) hosted
  acceptance verifies the resulting state. This correction does NOT
  authorize hosted execution now. **Production:** pg_cron availability
  remains a pre-cutover verification; no production state change is
  authorized.
- **AUTO-SCH-07 — pg_cron time representation / `cron.timezone`
  precondition (FINAL, human ruling 2026-09-12, R5).** The recurrence
  registration fires at 00:30 Asia/Kolkata via the GMT expression
  `0 19 * * *` (AUTO-SCH-05). Before registering or accepting the
  recurrence cron job, the implementation MUST verify
  `current_setting('cron.timezone', true) = 'GMT'` — at **local
  implementation acceptance, hosted staging acceptance, and production
  pre-cutover verification** alike. If the effective pg_cron timezone is
  NOT GMT: DO NOT register the recurrence job, DO NOT alter
  `cron.timezone` automatically — **fail closed / stop the acceptance
  gate and require explicit human review**. `ALTER SYSTEM`,
  `postgresql.conf` edits, server restarts, and any silent global
  `cron.timezone` mutation are prohibited as an implementation path.
  Business correctness never depends on this setting: the recurrence
  function derives `business_date` explicitly in Asia/Kolkata
  (AUTO-REC-10), and the per-minute outbox drain is
  timezone-independent.

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
  produces no duplicate effect (AUTO-IDM-01). **Harness strategy (test
  contract clarification, Ruling 2026-09-12):** R0 has no production
  registered outbox consumers (AUTO-FLOW-05); this test MUST NOT force
  the creation of a production consumer merely to exercise
  drain/idempotency behavior. It uses a deterministic **HARNESS-ONLY
  synthetic consumer/effect fixture** (temporary/synthetic test objects
  or test-only registration consistent with existing harness conventions
  — the `hgate_*` precedent, `tests/integration/rls/setup.sql`), which is
  NOT part of production runtime configuration and MUST NOT become
  production schema/business behavior. Duplicate delivery proves exactly
  one domain result per domain/effect key; `event_id` is NOT the
  idempotency key (AUTO-IDM-01). Teardown leaves **zero synthetic
  residue**.
- **TEST-AUTO-06:** Failure path — exhausted retries produce dead-letter
  records and operational signals (AUTO-RET-01). **Harness strategy
  (Ruling 2026-09-12):** deterministic **HARNESS-ONLY failure injection**
  against the drain/retry machinery proves bounded retries, the
  failed/dead-letter transition, SCH-35 dead-letter evidence, correlation
  preservation (AUTO-RET-02), and operational visibility (`13`) — with NO
  fake production consumer; teardown leaves **zero synthetic residue**.
- **TEST-AUTO-07:** Automation audit rows carry the correct non-human
  actor model (AUTO-AUD-01, AUD-ACT-05).
- **TEST-AUTO-08:** Scheduler mechanism checks per AUTO-SCH-02/03 —
  availability/execution-context validation is recorded PASS
  (2026-09-11); the remaining mechanism checks execute during IMP-050,
  including direct cross-firm isolation assertions against the scheduler
  path under the BYPASSRLS cron context (RLS-based tests are not
  isolation evidence there — see `11`).
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

- AUTO-A-01: pg_cron is available on the local CLI stack and on the
  hosted **staging** project — **VALIDATED (AUTO-SCH-02
  PASS, 2026-09-11: local execution-context probe PASS; hosted staging
  availability PASS via authorized human read-only Studio queries —
  pg_cron default_version 1.6.4, not installed, `cron.database_name =
  'postgres'`; hosted `CREATE EXTENSION` remains a future explicit human
  gate).** The hosted validation is scoped to the actual staging project
  only; **production availability is NOT claimed and remains a
  pre-cutover verification.** pg_net is not required for R0 (AUTO-OQ-01
  resolution), so its availability is no longer an R0 assumption.
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
| AUTO-OQ-01 (= DEC-OQ-02) | Final scheduled-job mechanism: `pg_net` from pg_cron acceptable, or queue-table poller? | requester — human ruling 2026-09-11 (validation evidence AUTO-SCH-02) | **RESOLVED 2026-09-11 (human ruling):** pg_cron invoking hardened in-database scheduler/job functions is the final R0 mechanism (AUTO-SCH-01); pg_net not required for R0; HTTP/Edge scheduling deferred to R1+; validated per AUTO-SCH-02 (LOCAL/HOSTED/OVERALL PASS) |
| AUTO-OQ-02 | Event-publication implementation: transactional outbox vs direct invocation (the *need* for reliability/idempotency/retry/correlation is approved, AUTO-FLOW-03; the mechanism is not) | requester — human ruling 2026-09-11 | **RESOLVED 2026-09-11 (human ruling):** transactional outbox — publication record (SCH-33, `06`) committed in the same transaction as the domain mutation; direct downstream invocation rejected for R0 |
| AUTO-OQ-03 | Default recurrence look-ahead window value (AUTO-REC-02) | implementation + product | **RESOLVED 2026-09-11 (human ruling):** 90 calendar days as the R0 configurable default (not hard-coded; firm-specific future configuration must not change recurrence identity/instance semantics); business-date basis Asia/Kolkata with UTC-persisted timestamps (AUTO-REC-02/AUTO-REC-10) |
| AUTO-OQ-04 | Which R0 alert rules ship enabled by default and with what thresholds | product (PRD §16) + `10` seeding | Open |
| AUTO-OQ-05 (= AUTO-XREF-01) | Schema amendment for rule versioning + generation provenance | — | **Resolved (Batch 4 closure amendment):** specified in `06` — SCH-32 `compliance_rule_versions` (immutable, effective-dated, domain-approval gate) + SCH-12 provenance fields (`rule_version_id`, `generation_source`, `generated_at`, `calculated_due_date`) |

## Acceptance Criteria

- AUTO-ACC-01: The domain-event catalogue lists exactly the 14 mandated
  business-fact events; scheduler/internal signals live in a **separate**
  catalogue with the distinct `sched.<job>.<action>` convention, and no
  scheduler tick is classified as a domain event (AUTO-PRIN-02/05).
- AUTO-ACC-02: Envelope, idempotency, retry, dead-letter, and failure
  rules are specified (AUTO-ENV/IDM/RET); the reliable-publication need is
  approved and its mechanism is resolved — transactional outbox
  (AUTO-FLOW-03, AUTO-OQ-02 RESOLVED 2026-09-11; schema contract SCH-33
  in `06`).
- AUTO-ACC-03: The recurrence model specifies trigger points, the
  four-layer duplicate protection with race semantics (AUTO-REC-03/08),
  scope discipline per DM-27, due-date computation, system-actor auditing,
  and rule-versioning/historical-stability requirements with schema
  specified in `06` (SCH-32/SCH-12; AUTO-XREF-01 satisfied).
- AUTO-ACC-04: Deadline board is defined as a derived read model; alert
  evaluation implements the DM-OQ-05 hybrid with audit-logged
  auto-resolution.
- AUTO-ACC-05: Scheduling options are compared, the final R0 mechanism is
  recorded with its validation evidence (AUTO-SCH-01 final — pg_cron +
  hardened in-database functions; AUTO-SCH-02 LOCAL/HOSTED/OVERALL PASS,
  2026-09-11), and the scheduler execution-context security constraint is
  normative (AUTO-SCH-03 — BYPASSRLS cron identity; explicit tenant
  enforcement; no scheduler capability for anon/authenticated). Cron
  registration ownership and cadences are recorded (AUTO-SCH-04/05,
  Ruling 2026-09-12): the signal catalogue remains exactly the three
  `sched.*` signals — the per-minute outbox drain is infrastructure, not
  a signal — and the pg_cron installation/migration boundary is normative
  (AUTO-SCH-06), including the hosted migration-ledger-only state-change
  path (R6) and the GMT `cron.timezone` fail-closed precondition
  (AUTO-SCH-07, R5). Hosted
  pg_cron enablement remains a future explicit human gate.
- AUTO-ACC-06: Reminder handling is recording-only in R0; no sending is
  specified.
- AUTO-ACC-07: The recurrence look-ahead default and business-date basis
  are resolved and recorded (AUTO-OQ-03, 2026-09-11): 90-calendar-day
  configurable default (carrier `firms.settings.recurrence_lookahead_days`,
  SCH-01); Asia/Kolkata business date; UTC-persisted
  timestamps; statutory due dates never reinterpreted through UTC date
  boundaries (AUTO-REC-02/AUTO-REC-10).

## Consequence of Change

Domain events are integration contracts: renaming or removing a catalogue
event breaks consumers and audit queries; the recurrence
duplicate-protection key is anchored in SCH-12 (and deliberately excludes
`rule_version_id`), so changing that constraint invalidates
AUTO-REC-03/08. Provenance immutability (SCH-32/SCH-12 update guards) is
load-bearing for AUTO-REC-07 and TEST-AUTO-09; weakening it is a
compliance-posture change requiring requester sign-off. Changing the
scheduling mechanism after the recorded final decision (AUTO-SCH-01,
2026-09-11) requires updating this spec,
`13` (operations), and the harness tests.
