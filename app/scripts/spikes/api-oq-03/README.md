# API-OQ-03 measurement spike — IMP-060 (LOCAL ONLY)

Performance-measured comparison of the two candidate API-R0-DASH (Command
Centre / Morning Brief aggregate) architectures, per the human-approved
IMP-060 pre-implementation rulings H1-H8 (2026-09-18). **API-OQ-03 remains
OPEN**: this harness emits factual evidence only; the A/B selection is a
human decision and no normative threshold (e.g. 1.5x) exists.

- **Candidate A** — one composite aggregate RPC
  (`public.api_oq_03_bench_dashboard`), explicitly `SECURITY INVOKER`,
  benchmark-named, created by `setup.sql`, dropped by `teardown.sql`.
  Never `SECURITY DEFINER`; no migration; no caching; no cross-tenant
  widening. Returns only the canonical counters under comparison.
- **Candidate B** — per-section RLS-respecting PostgREST reads composed
  client-side, in two variants: `fetch` (minimal-column paged scans,
  counted client-side) and `counts` (per-state `count=exact` queries).
  Exact-count responses are validated jointly: HTTP 200 or 206 ONLY with a
  well-formed `Content-Range` carrying a numeric total (`*/N` or
  `start-end/N`); anything else fails closed (`lib.mjs
  parseExactCountTotal`, self-tested by `selftest.mjs`).
  No new persistent DB object.

## Canonical counters compared (both candidates, identical semantics)

| Counter | Definition |
| --- | --- |
| `tasks_by_status` | counts over the 8 DM-SM-05 states (`open`, `in_progress`, `waiting`, `submitted`, `returned`, `approved`, `done`, `cancelled`), zero-filled |
| `instances_by_state` | counts over the 10 DM-SM-04 states (H1: compliance health = live `compliance_instances` state truth) |
| `deadline` | `deadline_board` (IMP-051 security_invoker view) rollup: `groups`, `at_risk_instances` (H3 named counter), `total_instances` |
| `pending_reviews` | `review_items` with `status='pending'` (H3 named counter) |
| `active_alerts` | derived effective-active (H3 named counter): persisted `active` OR persisted `snoozed` with `snoozed_until <= now()` and `acknowledged_at IS NULL` — the exact TEST-API-18 read derivation in `src/data/alerts/types.ts` (`deriveAlertEffectiveStatus`) |

No fixture-only KPIs (H2 "items needing attention", H3 "on track", H4 team
overload, H5 billing/revenue, H6 attention list) are produced by either
candidate.

## Files

| File | Purpose |
| --- | --- |
| `lib.mjs` | fail-closed local-safety guard + env/psql/HTTP helpers (no-secret) |
| `setup.sql` | deterministic synthetic dataset (2 firms) + Candidate A function |
| `teardown.sql` | exact removal of everything setup created (+ residue evidence) |
| `run.mjs` | orchestrator: safety → preflight → setup → gates → warmup → measure A/B → EXPLAIN plans → report → cleanup |
| `teardown.mjs` | standalone cleanup wrapper |
| `selftest.mjs` | pure in-memory parser self-test (no network/DB) for the exact-count response contract |
| `results/` | runtime-written JSON reports (artifacts; not source) |

## Local safety strategy (fail-closed, checked BEFORE any write)

`lib.mjs#localEnv()` refuses to run unless ALL hold:

1. `npx supabase status -o env` succeeds and yields `API_URL`, `ANON_KEY`,
   `JWT_SECRET`;
2. `API_URL` hostname is `127.0.0.1` / `localhost` / `::1`;
3. `DB_URL` parses and its hostname is loopback (the URL itself, which
   contains credentials, is NEVER printed);
4. the dedicated local Docker container `supabase_db_app` is running.

Only then is the non-secret marker `API_OQ_03_LOCAL_SAFETY_CHECK=PASS`
printed. Hosted project URLs, arbitrary `DATABASE_URL`s, and any non-local
Postgres are rejected by design (the harness never reads ambient DB env
vars). Any failure exits nonzero before any write. No passwords, keys,
JWTs, or tokens are ever printed.

## Synthetic dataset strategy (H8; deterministic)

Two firms (the IMP-003 registry Firm A / Firm B UUIDs). Auth identities are
NOT created — the harness personas (`@caos.test`, created by
`npm run db:reset:harness`) are reused; setup adds only ACTIVE
`firm_memberships` rows (plus one SUSPENDED and one REMOVED probe
membership) in the reserved spike UUID namespace
`0a030000-0000-4000-8000-FFKKNNNNNNNN`. Firm A receives
partner/manager/senior/billing (+ suspended/removed probes); Firm B
receives partner/manager/senior — the exact set its synthetic rows
FK-reference (Firm B billing is referenced nowhere and is not created).

Per firm: 200 clients, 200 legal entities, 5,000 compliance instances
(5 entity-scope system types × 5 periods per client), 10,000 tasks
(50/client; 25 instance-linked), 1,000 review items (600 pending /
400 decided), 500 alerts (330 active / 50 acknowledged / 50 snoozed-future
/ 20 snoozed-expired / 50 resolved-auto).

Role-scoping layout (drives the security gates):

- **manager portfolio** = clients 000..049 (`clients.manager_membership_id`);
  clients 050..199 are known out-of-portfolio rows;
- **manager-assigned branch** = tasks of clients 150..159 (out of
  portfolio) assigned to the manager;
- **senior slice** = instances/tasks of clients `index % 4 = 0` assigned to
  the senior (reviewer = manager; four-eyes satisfied);
- **review** submissions by senior (`% 4 = 0` clients) or manager,
  decisions always by the partner (never the submitter);
- **alerts** each linked to a DISTINCT instance (satisfies
  `alerts_nonresolved_dedupe_unique`); no `alert_rules` rows
  (AUTO-OQ-04 untouched); no statutory rule activation.

Generation sets the sanctioned `app.audit_skip_trigger` session GUC so bulk
synthetic inserts do not mint ~34k `audit_log` rows (synthetic rows are not
business operations; Layer-B commands use the same skip mechanism).
Publication triggers have no skip flag; teardown deletes the minted
`event_outbox` rows with a firm-scoped delete.

## Measured path

All measured calls use the real application posture: signed-in harness user
token (plain password grant — reads require only AAL1) + `x-active-firm`
header + RLS enforced, through PostgREST. Superuser psql is used ONLY for
fixture generation, ground-truth computation for the gates, and
`EXPLAIN (ANALYZE, BUFFERS)` capture (emulated authenticated session via
`request.jwt.claims` / `request.headers` GUCs, as in the DEC-J spike).

## Gates (a candidate is INVALID regardless of speed if any fails)

1. **Semantic equivalence**: per role (partner/manager/senior/billing, Firm
   A), each candidate's counters must equal superuser ground truth computed
   with SQL replicating that role's RLS scoping predicate; additionally A
   and each B variant must produce identical counters for the manager case.
2. **Security correctness**: A-partner asserting Firm B context → zeros;
   B-partner asserting Firm A context → zeros; B-partner in own context →
   full firm-wide B counters (10,000 tasks); suspended and removed
   memberships → zeros; billing → zeros everywhere; manager/senior slices
   exactly equal the authorized subsets (via gate 1).

Any failure prints `API_OQ_03_RESULT=INVALID_MEASUREMENT`, skips latency
comparison, cleans up, and exits nonzero.

## Methodology

- Warm-up: 10 full compositions per candidate/role (not recorded).
- Recorded runs: `--runs` (default 60, floor 50) per candidate × role,
  interleaved A / B-fetch / B-counts per iteration to share cache
  conditions. Client-side wall-clock latency (the browser-path truth).
- Metrics: p50, p95, min, max, mean, round trips, payload bytes; Candidate B
  additionally records per-section timings. Note local PostgREST
  `max_rows = 1000` (supabase/config.toml) — the `fetch` variant paginates
  (e.g. 10,000 tasks = 10 pages) and every page is counted as a round trip.
- Plans: `EXPLAIN (ANALYZE, BUFFERS)` for the Candidate A call and each
  Candidate B representative query, for partner and manager.
- Setup/seed time is never reported as dashboard latency. Failed/timed-out
  runs (30 s request timeout) are recorded and counted, never hidden.
- Caveat: `deadline_board.at_risk` is computed against the Asia/Kolkata
  business date; ground truth and candidates are compared within seconds of
  each other, but a midnight-IST crossover mid-run could flip a boundary —
  rerun if a deadline gate diffs by exactly the boundary cell.

## Cleanup

Automatic in `run.mjs` (`finally`, even after gate failure or error) unless
`--keep`; standalone via `teardown.mjs`. Removes the Candidate A function,
all `0a030000-*` rows, the firm-scoped outbox rows, and the two benchmark
firm rows, then verifies zero residue (`CLEANUP_STATUS=PASS|RESIDUE|FAILED`
— residue is always reported, never hidden). No hosted effects are possible
(the safety guard runs first and teardown is a local Docker psql).

## Usage

```bash
npm run db:start && npm run db:reset:harness   # prerequisites
node scripts/spikes/api-oq-03/run.mjs          # full campaign (60 runs/case)
node scripts/spikes/api-oq-03/run.mjs --runs=100 --b-variant=fetch
node scripts/spikes/api-oq-03/teardown.mjs     # standalone cleanup
```

Output: console evidence lines (`CANDIDATE_*_P50_MS`, `ROUND_TRIPS_*`,
gate results, plans) plus a structured JSON report under `results/`.
The runner NEVER prints `API_OQ_03=RESOLVED_A/B`; API-OQ-03 stays OPEN
until the human reviews the measured evidence.
