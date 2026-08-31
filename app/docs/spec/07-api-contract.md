# 07 — API Contract (Application Data Access)

- **Status:** Approved (Batch 4)
- **Approval status:** Approved (Batch 4). Open/provisional items remain as recorded: API-OQ-01…04; DEC-J and Harness Gate spike outcomes stay open.

## Purpose

Defines the production application data-access contract: how the React SPA
reads and mutates production data through the `@/data` abstraction, which
existing fixture-era functions survive, and the Release 0 contract for every
product surface. The existing `@/data` layer is the *UI-facing seam*; this
spec decides what lives behind it. Fixture-era APIs must not dictate the
production design — every existing function is classified KEEP / EVOLVE /
REPLACE / DEMO-ONLY (API-INV-01).

## Scope

- Architecture and layering of the production data path.
- Conventions: DTOs, pagination, filtering, sorting, search, error semantics,
  mutation semantics, optimistic updates, idempotency, retry, loading states,
  realtime usage rules.
- The complete inventory and classification of the existing `@/data` public
  surface (barrel `src/data/index.ts`).
- Release 0 contracts for: auth/session-facing data, firms/memberships,
  clients, legal entities, registrations, contacts, engagements, compliance
  types, compliance profiles, compliance instances, tasks, task dependencies,
  checklist items, comments, review queue, alerts, My Work, deadlines,
  Command Centre, Morning Brief, structured global search, and audit-history
  reads.

## Non-goals

- No RLS policy definitions (owned by `05`; referenced by ID only).
- No SQL, no RPC implementation, no code changes in Phase 2.
- No Client Portal contracts (Release 2, `21-portal.md`).
- No AI service contracts (deferred, `20-ai-services.md`); `askCaos` is
  classified DEMO-ONLY for R0.
- Automation internals (owned by `09`); this spec only fixes the
  UI-facing results of automation (e.g. alerts, generated instances).

## Architecture

- **API-ARCH-01 — Layering.** React components → application/domain data
  layer (`@/data`) → Supabase client (PostgREST reads / RPC writes) or Edge
  Function boundary where justified. **No direct Supabase queries in React
  components**; the `@/data` seam is preserved (per the approved migration
  principle) so fixture mode (TEN-20) and Supabase mode (TEN-21) share one
  UI.
- **API-ARCH-02 — Two adapters, one interface.** The domain layer exposes one
  typed contract with two implementations: a fixture adapter (demo/sales
  mode, TEN-20) and a Supabase adapter (local-dev/staging/production,
  TEN-21). Selection is by `DATA_SOURCE` per environment (`10`). The
  adapters are isolated implementations behind the contract: the Supabase
  adapter never imports fixture records, and fixture code is never present
  in a production-configured bundle (MIG-DS-05/06).
- **API-ARCH-03 — Plain reads via PostgREST.** Read contracts that are row
  shaped and filter/sort/page shaped use table/view reads under RLS — no RPC
  wrapper for its own sake.
- **API-ARCH-04 — Writes with invariants via RPC.** Mutations carrying
  server-side invariants execute through controlled RPCs (transition
  functions, decision functions, administration functions), never as raw
  table writes: compliance-instance state transitions (DM-SM-04, RLS-4EY-02,
  RLS-CIN-01), review decisions (DM-SM-06, RLS-RVW-01, RLS-4EY-01), task
  transitions with mandatory fields (DM-SM-05: `waiting` requires
  `waiting_reason`; `returned` requires a reviewer comment), compliance
  profile approval (RLS-CCP-01), membership/role administration (RLS-MEM-01,
  RLS-AAL-01), alert-rule administration (RLS-ARL-01), and alert
  acknowledge/snooze/resolve (RLS-ALR-01). Security constraints on such
  functions: API-SEC-*.
- **API-ARCH-05 — Derived data is server-derived.** Aggregates, deadline
  boards, dependency views, and risk scores are computed server-side (views
  or RPCs over live tables), never shipped as precomputed client fixtures
  (DM-X-03). The fixture `AGGREGATES` constant has no production equivalent.

## Server-side function & aggregate RPC security (API-SEC)

- **API-SEC-01 — Caller's identity, caller's permissions.** Every RPC —
  including aggregate/dashboard functions (API-R0-DASH) and search
  (API-R0-SRC) — executes subject to the caller's tenant authorization.
  **No RPC may bypass RLS merely for convenience or performance.** Where a
  plain table/view read under RLS suffices, it is used (API-ARCH-03).
- **API-SEC-02 — No browser service-role.** Service-role execution is never
  used from the browser path (TEN-17/18, RLS-SVC-01); it exists only in
  Edge Functions and operator-run scripts.
- **API-SEC-03 — SECURITY DEFINER is exceptional and reviewed.** If a
  function genuinely requires `SECURITY DEFINER` (e.g. controlled
  transition/decision/administration RPCs, API-ARCH-04), it must: perform
  its own explicit authorization check against server-side data
  (RLS-PRIN-04); harden `search_path` and fully qualify objects; be as
  narrow as possible; and pass a documented security review before merge.
  Aggregate read functions must not use `SECURITY DEFINER` to widen
  visibility beyond the caller's role scoping (RLS-STF-03/04 portfolio
  slices are computed *for the caller*, not exposed firm-wide).
- **API-SEC-04 — Verification.** TEST-RLS-* families (`11`) include
  RPC-level cases: aggregate/search/transition functions return only
  caller-authorized data for every role, and a SECURITY DEFINER function
  cannot be coerced into cross-tenant reads or writes.

## Conventions

- **API-CONV-01 — DTOs.** The domain layer exposes TypeScript DTOs decoupled
  from row shape: server rows may be renamed/split without UI change. DTO
  field naming follows the existing UI conventions where a field already
  exists in `src/data/types.ts`; new fields follow schema naming (SCH-*).
- **API-CONV-02 — Pagination.** Boards and feeds are paginated; there is no
  unbounded "fetch all" contract in production mode. Cursor pagination for
  append-ordered feeds (audit history, comments); offset or cursor for
  boards. Default page size 50, max 200. Fixture mode may return full arrays
  behind the same contract (demo scale).
- **API-CONV-03 — Filtering/sorting.** Every list contract declares its
  supported filter fields and a sort whitelist; unsupported combinations are
  validation errors, never silently ignored. Sort whitelists exist so every
  production sort is backed by a SCH-* index.
- **API-CONV-04 — Dates.** Domain dates are `date`/`timestamptz` values
  end-to-end. The demo-clock bug (`DEMO_TODAY = new Date()`,
  `src/data/tasks.ts`) does not carry into production mode: production uses
  server time; fixture mode uses a pinned demo date (TEN-22; seeding in `10`).
- **API-CONV-05 — Tenant context.** Every request executes under exactly one
  active context (RLS-CTX-01). The domain layer never accepts a `firm_id`
  parameter from the UI for authorization purposes — context comes from the
  server-side session/claims per the DEC-J mechanism (RLS-PRIN-04).
- **API-CONV-06 — Loading/error states.** Async contracts keep the current
  UI behaviour of explicit loading and error states; the fixture adapter
  keeps simulated latency so demo mode looks identical.

### Error semantics (API-ERR)

- **API-ERR-01 — Taxonomy.** `unauthenticated` (no/expired session → re-auth
  flow per AUTH-08), `unauthorized` (authenticated but denied — role, scope,
  or context), `validation` (input rejected; field-level detail),
  `not_found` (unknown or inaccessible id in the active context),
  `conflict` (unique/check/transition violation or stale-state conflict),
  `internal` (retryable unless marked permanent).
- **API-ERR-02 — Authorization vs not-found, by query kind.** Deliberately
  distinct semantics so the UI can never act as an existence oracle:
  - **Collection queries:** unauthorized rows simply do not appear. An
    empty collection is a normal result, never an error banner.
  - **Single-resource queries:** an inaccessible resource is
    indistinguishable from a nonexistent one — the contract returns the
    same safe `not_found` result in both cases. The API must not reveal
    whether a resource exists outside the caller's scope (incl. other
    tenants').
  - **Explicit privileged operations** (administration/decision RPCs where
    the caller is known and the resource class is visible to them): may
    return `unauthorized`/forbidden when the caller lacks the required
    permission — only where doing so leaks no protected existence.
  - **Components must not infer tenant or resource existence from
    differences between error shapes**; error payloads for inaccessible vs
    nonexistent single resources are normalized to be identical.
- **API-ERR-03 — Mutation denials surface.** RLS/permission denials on
  writes map to `unauthorized` and are shown to the user, never silently
  swallowed.
- **API-ERR-04 — Transition conflicts.** State-machine RPC rejections
  (illegal transition, four-eyes self-approval, missing `waiting_reason`)
  map to `conflict`/`validation` with a machine-readable reason code so the
  UI can render the correct message.
- **API-ERR-05 — Retry.** Reads: safe to retry with backoff. Mutations:
  retry only where idempotent (API-MUT-03); otherwise surface the failure.
  A 5xx/network failure after a submitted mutation is re-fetched, not
  blindly re-posted.

### Mutation semantics (API-MUT)

- **API-MUT-01 — Result shape.** Mutations return the updated entity DTO
  (or the affected ids for bulk-ish actions) so the UI can reconcile server
  truth; the server result wins over optimistic state.
- **API-MUT-02 — Optimistic updates.** Permitted only for low-risk,
  self-contained toggles (checklist completion, comment posting with
  rollback). **Not** permitted for state transitions, review decisions,
  alert resolution, or any administration action — those render pending
  state until the server confirms.
- **API-MUT-03 — Idempotency.** Review decisions and instance/task
  transitions accept a client-generated mutation key; a retried submission
  with the same key returns the original result instead of double-applying
  (protects against double-click and network retry). Implementation detail
  (request-id column vs dedupe table) is verified at the harness gate.
- **API-MUT-04 — Actor stamping.** The UI never sends actor identity;
  actor/audit fields are stamped server-side per SCH-RESP-02 and AUD-ACT-*.

### Realtime usage rules (API-RT)

- **API-RT-01 — Justified subscriptions only (DEC-B: Realtime only where
  justified).** Release 0 subscribes to exactly two surfaces, chosen because
  they are multi-actor, time-sensitive, and badge-driven in the PRD: (a) the
  **review queue count/list** (PRD §46–50 — reviewers and submitters need
  the queue to move without manual refresh), (b) the **alert badge/list**
  (PRD §16 — new critical alerts should surface without polling).
- **API-RT-02 — Everything else refetches.** Boards, Client 360, My Work,
  deadlines, Command Centre use refetch-on-mutate and refetch-on-focus; no
  subscriptions.
- **API-RT-03 — Payload discipline.** Realtime payloads carry row identity
  and minimal display fields; consumers re-fetch the affected query rather
  than trusting payload completeness. Channels are firm-scoped; row
  visibility remains enforced by RLS on the underlying tables.
- **API-RT-04 — No realtime in fixture mode.** The fixture adapter simulates
  realtime behaviour locally (store overlays); no Supabase channel is opened
  in demo mode.
- **API-RT-05 — Realtime is a freshness optimization, never the source of
  truth.** The application must remain **correct** if: a realtime event is
  missed; the connection drops; events arrive twice; or events arrive out
  of order. All rendering decisions reconcile against fetched server state;
  a realtime event triggers revalidation, it does not apply authoritative
  state by itself (consistent with API-RT-03).
- **API-RT-06 — Reconnect/re-entry refreshes.** On reconnect, route
  re-entry, or subscription recovery, the affected queries are re-fetched
  from the server before the UI is treated as current.
- **API-RT-07 — Tenant isolation under realtime is harness-verified.**
  Realtime authorization respecting RLS is verified at the harness gate
  (API-A-02); a failure there falls back to polling for the two API-RT-01
  surfaces with no contract change.

## `@/data` inventory and classification

- **API-INV-01 — Completeness.** Every export reachable from the barrel
  (`src/data/index.ts`) is classified below. `KEEP` = unchanged in
  production mode; `EVOLVE` = same UI-facing contract, new production
  implementation; `REPLACE` = retired, function absorbed by a different
  production contract; `DEMO-ONLY` = fixture/demo mode only, no production
  counterpart in R0.

### Async/sync getters (`src/data/api.ts`)

| Function | Current purpose / callers | Class | Target production responsibility |
|---|---|---|---|
| `fetchClients` / `getClients` | Client list (Command Centre, search, pickers) | EVOLVE | `clients` read under RLS-CLI-01; paginated, filter by status/owner; offboarded excluded by default (DM-04) |
| `fetchClient` | Client 360 hub (ComplianceDetail/Client pages) | EVOLVE | Composite read: client + entities + registrations + contacts + engagements + compliance summary (DM-X-02); one contract, several underlying reads |
| `fetchTasks` / `getTasks` / `getTasksForClient` | Task lists by client/compliance/category | EVOLVE | `tasks` read (RLS-TSK-01) with declared filters: client, instance, status, assignee, due window; paginated |
| `fetchTask` | Task detail | EVOLVE | Task + checklist + comments + dependencies read (SCH-13…16) |
| `getTask` | Synchronous internal fixture-era helper (`tasks.ts`); consumed by `api.ts` internals | DEMO-ONLY | No production counterpart. Production callers use the evolved `fetchTask` / domain-data contract above; `getTask` must not become a production backend API merely because it exists in the fixture implementation |
| `fetchDeadlines` / `getDeadlineGroups` | Deadline board grouped by compliance/day | EVOLVE | Server-derived board over `compliance_instances(due_date, state)` (index SCH-12); grouping computed server-side |
| `fetchDeadline` / `getDeadlineGroup` | Deadline group drill-down | EVOLVE | Same read model, single group |
| `fetchDeadlineClients` / `getDeadlineClients` | Per-deadline client rows | EVOLVE | Instance rows for the group with client/entity/assignee projection |
| `fetchComplianceTasks` / `getTasksForCompliance` | Tasks behind one compliance type | EVOLVE | Instances + tasks for a `compliance_type` (drill-down; index SCH-12 `(firm_id, compliance_type_id, period_start)`) |
| `fetchReviewItems` | Review queue | EVOLVE | `review_items` read (RLS-RVW-01); queue view per role; realtime per API-RT-01 |
| `fetchAlerts` | Risk alerts list | EVOLVE | `alerts` read (RLS-ALR-01); realtime per API-RT-01 |
| `getFirm` | Firm identity/settings | EVOLVE | `firms` read (RLS-FRM-01); settings write is an admin RPC (RLS-AAL-01) |
| `getTeam` | Team list (owners, assignees) | EVOLVE | `firm_memberships` ⋈ `profiles` read (RLS-MEM-01/RLS-PRF-01) |
| `getComplianceMaster` | Compliance catalogue | EVOLVE | Merged view: system defaults + firm overrides shadowing per TEN-07 (RLS-CTY-01) |
| `getAggregates` / `fetchAggregates` / `useLiveAggregates` | Command Centre / Morning Brief counters | REPLACE | Command-centre aggregate RPC/view computing live counts (API-R0-DASH); fixture `AGGREGATES` has no production counterpart (DM-X-03) |
| `fetchDependencyClients` | Client Dependency board (48 rows) | REPLACE | Server-derived "waiting on client" read model over instances in `information_requested` + waiting tasks (API-R0-DLN); not a stored fixture |
| `searchAll` | ⌘K palette (clients, compliance, pages) | REPLACE | Structured global search RPC (API-R0-SRC) covering clients, identifiers (registrations.value, SCH-07 index), staff; page shortcuts stay client-side |
| `askCaos` | Canned assistant answers | DEMO-ONLY | No R0 production counterpart; real AI deferred (DEC-C, `20-ai-services.md`) |
| `withLatency` | Simulated latency wrapper | DEMO-ONLY | Fixture-adapter internal; absent from the Supabase adapter |
| `matchAskQuery`, `SUGGESTED_QUESTIONS`, `FALLBACK_ANSWER` | Ask CAOS fixture internals | DEMO-ONLY | — |
| `getCompliance`, `dueDateFor`, `complianceName`, `daysUntil` | Fixture computation helpers | DEMO-ONLY | Due-date logic is re-implemented server-side from `due_rule` data (DM-10; `09` recurrence) |
| `ownerOf`, `getClient` | Fixture lookup helpers | DEMO-ONLY | Fixture adapter internals |

### Store actions (`src/data/store.tsx`)

| Function | Current purpose | Class | Target production responsibility |
|---|---|---|---|
| `approveReviewItem` | Overlay review approval | EVOLVE | Review-decision RPC: records `decided_by_membership_id`, `decision_rationale`, four-eyes enforced (RLS-RVW-01, RLS-4EY-01/02); audited (AUD-CAT-01) |
| `returnReviewItem` | Overlay return with comment | EVOLVE | Same RPC with `returned` + mandatory rationale/comment (DM-SM-06) |
| `acknowledgeAlert` | Overlay alert ack | EVOLVE | Alert status RPC (RLS-ALR-01; manager+); audited |
| `resolveAlert` | Overlay alert resolve | EVOLVE | Alert resolve RPC with `resolution_type='manual'` (DM-OQ-05); audited |
| `sendReminder` | Simulated reminder toast | DEMO-ONLY in R0 | Reminder engine is Release 1 (DEC-T exclusion); R0 UI hides or no-ops the action in Supabase mode |
| `notify` / `dismissToast` | Toast UI | KEEP | Pure UI concern; unchanged |
| `resetDemo` | Reset fixture overlays | DEMO-ONLY | Demo-mode control only; never present in Supabase mode |
| store overlays (`reviewOverlay`, `alertOverlay`, reminder merge) | Mutable fixture overlay | REPLACE | Server state replaces overlays; fixture adapter keeps them for demo mode |

### Fixture constants (data, not functions)

`FIRM`, `TEAM`, `CLIENTS`, `COMPLIANCE_MASTER`, `TASKS`, `AGGREGATES`,
`REVIEW_ITEMS`, `ALERTS`, `DEPENDENCY_CLIENTS`, `ASK_FIXTURES`,
`ACTIVE_ALERT_COUNT`, `REVIEW_COUNTS`, `DEPENDENCY_TOTALS`, `TOTAL_ACTIVE`,
`DEMO_TODAY` — all DEMO-ONLY as data sources; their migration mapping to
production entities is owned by `10-migration-seed.md`. `DEMO_TODAY` must be
pinned before any migration work (TEN-22).

### Workflow vocabulary export

| Export | Current purpose / callers | Class | Target production responsibility |
|---|---|---|---|
| `WORKFLOW_STATES` (`src/data/types.ts`) | Fixture-era workflow-state constant consumed directly by UI components (`WorkflowStepper`, `ComplianceDetail`) | REPLACE | Production workflow vocabulary/state metadata derives from the approved domain state machines (DM-SM-01…06) and the production domain model; the fixture-era constant must not become the authoritative production workflow definition. Migration implication: current UI consumers may temporarily use an adapter-compatible export, but the source of truth moves to the approved production workflow/state model |

## Release 0 contracts

Contract rows use: **mechanism** (table read / view / RPC), **authz** (RLS
family from `05`), and notes on pagination/filters. All contracts run under
the caller's single active context (RLS-CTX-01) and follow API-ERR-02
authorization/not-found semantics and API-SEC-* function security.

- **API-R0-AUTH — session-facing data.** RPC/view: current identity
  (profile), list of the caller's firm memberships (for firm switching,
  RLS-CTX-02), active context descriptor, MFA/AAL status surface for step-up
  UX (RLS-AAL-01). Depends on `04`; the DEC-J mechanism decides whether
  context comes from claims or lookup (spike, RLS-MECH-02).
- **API-R0-FRM — firms & memberships.** Firm read (RLS-FRM-01). Membership
  administration is **three distinct operations, never one ambiguous
  "invite"**: (a) **invite new person** — creates a new membership/
  invitation; (b) **resend pending invitation** — re-notifies an existing
  `invited` membership without changing its state; (c) **reactivate /
  re-invite a previously removed membership** — an explicit, separately
  authorized operation whose persistence semantics (new row vs status
  flip) remain open (SCH-OQ-03 / API-OQ-04). All are super_admin,
  AAL2-gated (RLS-MEM-01, RLS-AAL-01) and audited (AUD-CAT-01). Role
  change, suspend, and remove are likewise distinct RPCs.
- **API-R0-CLI — clients.** List (filters: status, owner partner, manager,
  tags, risk; sort: name, status; paginated) and Client 360 composite read
  (DM-X-02). Writes via manager+ scope (RLS-CLI-02). Offboarded clients
  excluded from default lists; readable via explicit filter by authorized
  roles (DM-04).
- **API-R0-ENT — legal entities.** CRUD within client scope (RLS-ENT-01);
  `entity_type` immutable after creation (SCH-05 invariant → conflict error).
- **API-R0-REG — registrations.** CRUD within entity scope (RLS-REG-01);
  uniqueness `(firm_id, type, value)` maps to `conflict`; `meta` carries
  establishment/location data per DM-27.
- **API-R0-CON — contacts.** CRUD within client scope (RLS-CON-01); primary
  contact requires email (SCH-08 invariant).
- **API-R0-ENG — engagements.** Read per RLS-ENG-01; status/letter
  transitions per DM-SM-03; responsible-partner references are memberships
  (SCH-RESP-01).
- **API-R0-CTY — compliance types.** Merged catalogue read (system +
  firm override, TEN-07). Firm override create/update restricted to
  super_admin/partner (RLS-CTY-01); changes are security-configuration
  events (RLS-AAL-01, AUD-CAT-01). Statutory system defaults are not
  editable via the app (TEN-08).
- **API-R0-CCP — compliance profiles.** Propose/edit (manager+); approval
  RPC records `approved_by`/`approved_at` (RLS-CCP-01, DM-11); only `active`
  profiles feed recurrence (`09`).
- **API-R0-CIN — compliance instances.** Reads with filters (state,
  assignee, due window, client, type; paginated). **All state transitions
  via transition RPC** (DM-SM-04, RLS-CIN-01, RLS-4EY-02); routine
  transitions need no step-up (RLS-AAL-02). Non-state fields writable by
  manager+ only (RLS-CIN-01).
- **API-R0-TSK — tasks.** CRUD + assignment (RLS-TSK-01); transitions per
  DM-SM-05 with mandatory-field validation (API-ARCH-04); ad-hoc task
  creation supported (`compliance_instance_id` nullable, DEC-H); dependency
  edges via RPC enforcing acyclicity (SCH-14); checklist toggles optimistic
  (API-MUT-02); comments append-only (RLS-TCM-01).
- **API-R0-RVW — review queue.** Queue read per role (submitter sees own;
  partner/manager see firm/team queue, RLS-RVW-01); decision RPC
  (API-ARCH-04, idempotent per API-MUT-03); realtime per API-RT-01. Review
  **categories are stable keys + display labels in the contract**; the
  production vocabulary is **not** frozen to the fixture's display strings
  — see API-OQ-01 (SCH-OQ-02).
- **API-R0-ALR — alerts.** List/read (RLS-ALR-01); acknowledge/snooze/
  resolve RPCs; alert-rule administration RPCs restricted per RLS-ARL-01
  with AAL2 (RLS-AAL-01); realtime per API-RT-01.
- **API-R0-MWK — My Work.** One read contract returning the four buckets
  (Today, This Week, Waiting, Returned — DEC-L) with explicit `next_action`
  per task (PRD §44); backed by SCH-13 indexes. No recommendation
  intelligence (deferred per DEC-L).
- **API-R0-DLN — deadlines & dependency.** Deadline board + group drill-down
  (read model over instances); client-dependency board (instances in
  `information_requested`, waiting tasks, ageing derived server-side,
  DM-X-03).
- **API-R0-DASH — Command Centre & Morning Brief.** Aggregate RPC/view over
  live tables producing the section counters the UI renders today (task
  counts by state, deadline risk, review pending, active alerts) — the
  production replacement for `AGGREGATES`/`useLiveAggregates`. **Security
  per API-SEC-01/03:** results are computed for the caller under RLS —
  manager/senior receive portfolio/assigned slices (RLS-STF-03/04);
  revenue aggregates are partner/admin only (RLS matrix §11); no
  firm-wide bypass via SECURITY DEFINER.
- **API-R0-SRC — structured global search.** Search RPC over clients (name),
  registrations (identifier values, SCH-07 index), legal entities, staff
  display names; returns typed hits mirroring today's `SearchHit` shape
  (kind/id/label/sub/href). Page-shortcut hits remain client-side. Results
  are computed under the caller's RLS context (API-SEC-01) — search can
  never leak cross-tenant rows (RLS-TEN-02), and hit existence follows
  API-ERR-02 (no existence oracle).
- **API-R0-AUD — audit-history reads.** Read-only audit queries for
  partner/super_admin (RLS-AUD-01): per-object history, per-actor history,
  support-access history (AUD-SUP-03). Cursor-paginated (API-CONV-02).
  Portal-facing audit views are out of scope (Release 2).

## Assumptions

- API-A-01: PostgREST query capabilities (embedding, filtering) cover the
  plain-read contracts without per-read RPCs; gaps discovered at
  implementation become views, not client-side joins.
- API-A-02: Supabase Realtime authorization respects RLS on subscribed
  tables at the target platform version — verified at the harness gate
  (API-RT-07); fallback is polling for the two API-RT-01 surfaces.
- API-A-03: The UI can tolerate the DTO mapping changes implied by EVOLVE
  classifications without route-level redesign (contracts are preserved
  where useful, not guaranteed identical).

## Dependencies

- Upstream: `01` (DEC-B/H/J/L/T), `02` (DM-*, DM-SM-*, DM-X-*), `03`
  (TEN-07/08/17/18/20/21/22), `04` (AUTH-*), `05` (RLS families,
  RLS-AAL-01, RLS-4EY-*), `06` (SCH-01…20, SCH-RESP, SCH-FK), `08`
  (AUD-ACT/CTX).
- Downstream: `09` (events behind mutations), `10` (fixture mapping behind
  the adapter), `11` (contract tests, TEST-RLS/TEST-AUD execution), `12`
  (R0 slices).

## Open Questions

| ID | Question | Owner | Status |
|---|---|---|---|
| API-OQ-01 (= SCH-OQ-02) | Production `review_items.type` vocabulary. The PRD provides no authoritative taxonomy; demo strings (`GST Reconciliation`, `TDS`, `ITR`, `Financial Statements`, `Audit Workpaper`) are **not** frozen as production values. The contract uses stable category keys + labels; final vocabulary is resolved **before schema-migration implementation** (with `06` if a CHECK list needs amending). | requester + product | **Open — deliberately unresolved** |
| API-OQ-02 | Cursor vs offset pagination per board; exact page-size defaults per surface. | implementation | Open — convention fixed (API-CONV-02), per-surface values set during implementation |
| API-OQ-03 | Whether the Command Centre aggregate contract is one composite RPC or per-section views (performance-driven). | harness gate | Open — measured on representative volume |
| API-OQ-04 (= SCH-OQ-03) | Persistence semantics of re-inviting a removed membership (new row vs status flip). The API already separates invite-new / resend-pending / reactivate-removed (API-R0-FRM); storage semantics stay open. | requester + schema/harness review | **Open** |

## Acceptance Criteria

- API-ACC-01: Every `@/data` barrel export is classified KEEP / EVOLVE /
  REPLACE / DEMO-ONLY with callers, target contract, and R0 status.
- API-ACC-02: The layering rule (API-ARCH-01) forbids direct Supabase access
  from components; write-invariant operations are RPC-routed (API-ARCH-04);
  fixture and Supabase adapters are isolated (API-ARCH-02).
- API-ACC-03: Conventions cover DTOs, pagination, filtering, sorting,
  search, mutation results, optimistic guidance, idempotency, loading/error
  states, retry, and conflict handling.
- API-ACC-04: Realtime is limited to justified surfaces (API-RT-01/02) and
  is explicitly a freshness optimization, not the source of truth, with
  correctness under missed/dropped/duplicate/out-of-order events and
  reconnect refresh (API-RT-05/06); isolation is harness-verified
  (API-RT-07).
- API-ACC-05: Every R0 contract area lists its mechanism and RLS family
  reference; no authorization policy text is duplicated here.
- API-ACC-06: Authorization/not-found semantics distinguish collections,
  single resources, and privileged operations, and forbid existence
  inference (API-ERR-02); mutation denials surface (API-ERR-03).
- API-ACC-07: Server-side function security is specified: no RLS bypass for
  convenience, no browser service-role, reviewed SECURITY DEFINER with
  explicit authorization, and TEST-RLS-* verification (API-SEC-*).
- API-ACC-08: Membership administration distinguishes invite-new /
  resend-pending / reactivate-removed (API-R0-FRM); review-type vocabulary
  remains an explicit open question (API-OQ-01).

## Consequence of Change

This contract is the seam between UI and backend: changing classifications
or conventions after Batch 4 approval invalidates `10` (adapter mapping),
`11` (contract tests), and the R0 slices in `12`. Removing the `@/data`
seam (coupling components to Supabase directly) breaks fixture/demo mode
(TEN-20) and requires requester sign-off. Weakening API-ERR-02 or API-SEC-*
is a security-posture change requiring requester sign-off.
