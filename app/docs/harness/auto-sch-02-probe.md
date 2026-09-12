# AUTO-SCH-02 Validation Probe — pg_cron Scheduler Mechanism (IMP-050 architecture gate)

- **Status:** COMPLETE — evidence recorded 2026-09-11. This document is the
  validation record behind **AUTO-SCH-02 PASS (LOCAL/HOSTED/OVERALL)** as
  recorded in `docs/spec/09-automation-events.md`. AUTO-SCH-02 was recorded
  PASS on this evidence during the 2026-09-11 architecture-validation
  session; this artifact preserves that evidence with exact provenance —
  it is a record of what was observed, not a re-run, and it does not
  upgrade or extend the result.
- **Date:** 2026-09-11
- **Package/gate:** IMP-050 architecture gate — input to the AUTO-OQ-01
  (final scheduler mechanism) human ruling; satisfies the AUTO-SCH-02
  validation needs and the availability/execution-context portion of
  TEST-AUTO-08 (`09`, `11`).
- **Machine-readable evidence:** `docs/harness/auto-sch-02-results.json`
  (no secrets).
- **Scope discipline:** the LOCAL probe ran on the Supabase CLI local stack
  using temporary `imp050_*` probe objects only — NOT Release-0 schema, no
  migrations, no application code. The HOSTED evidence is read-only Supabase
  Studio catalog evidence on the actual staging project
  (`pyrniumcjcvagjygheyu`) ONLY; **production availability was not verified
  and remains a pre-cutover verification**. **No hosted state was changed
  at any point; hosted `CREATE EXTENSION` remains a future explicit human
  state-change gate.**

## Provenance legend

- **OBSERVED** — directly observed during the 2026-09-11 local probe
  session.
- **HUMAN-PROVIDED** — read-only hosted Supabase Studio catalog query
  results provided by the authorized human; not re-executed by the probe.
- **INDEPENDENTLY RE-VERIFIED** — re-checked in a separate pass after the
  fact.
- **NOT RETAINED** — values read interactively during the session but not
  persisted; they are excluded from the evidence base and no value is
  claimed for them anywhere.

## LOCAL mechanism evidence (OBSERVED)

- pg_cron **1.6.4** available/preloaded on the local CLI stack.
- `CREATE EXTENSION pg_cron` succeeded (extension enabled successfully).
- A **seconds-based schedule** was accepted.
- A synthetic **success job fired**; its successful run history was
  observed in the cron run history.
- A **deliberate failing job fired**; its failure history was observed.
- **Named reschedule/upsert** behaviour observed (scheduling under an
  existing job name updates the schedule in place).
- **Clean unschedule and teardown**: the job was unscheduled and removed
  without residue.

## LOCAL execution-context evidence (OBSERVED)

- `cron.job` username = **`postgres`**.
- Probe execution context: **`current_user` = `postgres`**,
  **`rolsuper` = false**, **`rolbypassrls` = true**.
- A synthetic table under **FORCE ROW LEVEL SECURITY with no permitting
  policy** was queried from the cron-fired path: **row visible = 1** (the
  row WAS visible — FORCE RLS did not constrain the cron-fired path).
- The probe function was **SECURITY INVOKER** — therefore the bypass is
  **structural (BYPASSRLS)**, not a SECURITY DEFINER effect.
- **Conclusion (recorded normatively as AUTO-SCH-03 in `09`):** scheduler
  isolation must NEVER rely on RLS; firm boundaries are enforced
  explicitly in scheduler/job function logic; `anon`/`authenticated`
  receive no scheduler execution capability; scheduler writes carry
  system/service audit context and per-run correlation identity.

## NOT RETAINED (excluded from the evidence base — no values claimed)

The following were read interactively during the probe session but were
**not persisted** and must not be quoted as evidence:

- `session_user`
- the `role` GUC
- `search_path`
- JWT claims
- `auth.uid()`

## HOSTED availability evidence (HUMAN-PROVIDED — read-only, staging project only)

Authorized human read-only Supabase Studio catalog queries on the hosted
**staging** project `pyrniumcjcvagjygheyu`:

- `pg_available_extensions` contains **pg_cron** ("Job scheduler for
  PostgreSQL") with **`default_version = 1.6.4`** and
  **`installed_version = NULL`**.
- `pg_available_extension_versions` offers versions **through 1.6.4**,
  none installed.
- `current_setting('cron.database_name', true)` = **`'postgres'`** —
  pg_cron targets the project database.
- **No hosted state was changed.** Installation is NOT authorized by this
  record; hosted `CREATE EXTENSION` remains a future explicit human
  state-change gate.
- **Scope:** staging project only. Production pg_cron availability is NOT
  claimed and remains a pre-cutover verification.

## INDEPENDENTLY RE-VERIFIED

**None.** No separate re-verification pass has been performed on this
evidence; the teardown checks below were observed within the same probe
session. If independent re-verification is required, the probe must be
re-executed from a clean checkout and this section updated with the
re-verification record.

## POST-PROBE teardown evidence (OBSERVED)

- pg_cron **absent again** (extension dropped after evidence capture).
- **Zero** `imp050_*` probe relations/functions remain.
- Local database healthy.
- Git tree clean (no probe residue in the working tree).

## Validation-checklist mapping (AUTO-SCH-02 needs → evidence)

| AUTO-SCH-02 validation need (`09`) | Evidence | Result |
|---|---|---|
| pg_cron availability (local + hosted staging) | LOCAL: OBSERVED (1.6.4 preloaded; extension temporarily enabled for the probe, jobs fired; dropped at teardown — restored baseline: available/preloaded, extension absent). HOSTED: HUMAN-PROVIDED (staging only — default_version 1.6.4, installed_version NULL, `cron.database_name='postgres'`). Production: NOT verified — pre-cutover gate | PASS (staging-scoped) |
| `pg_net` availability/acceptability (DEC-OQ-02) | Moot for R0 — AUTO-OQ-01 human ruling: pg_net NOT required for R0; HTTP/Edge scheduling deferred to R1+ | Closed by ruling |
| Schedule granularity | OBSERVED: seconds-based schedule accepted; full granularity/mechanism checks land with TEST-AUTO-08 during IMP-050 implementation | PASS (probe level) |
| Observable failure behaviour | OBSERVED: deliberate failing job fired; failure history recorded | PASS |
| Local-stack parity (TEN-12) | OBSERVED: probe executed on the Supabase CLI local stack | PASS |
| Execution-context security | OBSERVED: BYPASSRLS cron identity (postgres, rolsuper=false, rolbypassrls=true); FORCE-RLS bypass demonstrated under SECURITY INVOKER | PASS — recorded as binding constraint AUTO-SCH-03 |

## Result

**AUTO-SCH-02: LOCAL PASS / HOSTED PASS (availability only, staging
project) / OVERALL PASS** — as recorded in `09`. Remaining mechanism
checks (schedule granularity in implementation shape, failure injection,
direct scheduler-path cross-firm isolation/attribution under the
BYPASSRLS cron context) execute during IMP-050 under TEST-AUTO-08; hosted
pg_cron `CREATE EXTENSION` is a future explicit human state-change gate;
production availability is a pre-cutover verification.
