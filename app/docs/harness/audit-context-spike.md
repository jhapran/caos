# Audit-Context Propagation Spike — IMP-005 (AUD-OQ-02 / TEST-SPIKE-CTX-01/02)

- **Status:** COMPLETE (evidence collected 2026-09-01). **AUD-OQ-02 remains OPEN** — this
  report is the evidence package for human/security review; no spec amendment
  has been made and `docs/spec/08-audit-security.md` is unchanged.
- **Runner:** `npm run spike:audit-context` (from `npm run db:reset:harness`)
- **Cleanup:** `npm run spike:audit-context:cleanup`
- **Machine-readable evidence:** `docs/harness/audit-context-results.json` (31/31 checks passed)
- **Spike objects:** temporary `audctx_*` tables/functions/policies only —
  NOT Release-0 schema, NOT production `audit_log`, no migrations.

## Lettering note

This report uses the IMP-005 task lettering. Spec 11 §TEST-SPIKE-CTX-01 and
spec 08 §11 use a different order. Mapping:

| This report | Spec 08 §11 / spec 11 |
|---|---|
| A — request-scoped DB context (header GUC in triggers) | B (request-header GUC in triggers) |
| B — explicit RPC context | A (request-scoped DB context via RPC) |
| C — controlled server wrapper | C (Edge Function / server wrapper + security-definer event function) |

The spec's provisional recommendation (AUD-CTX-01: spec-B + spec-C) therefore
corresponds to **A + C in this report's lettering**.

## Environment

- Node v24.18.0; Supabase CLI 2.116.0; PostgreSQL 17.6 (aarch64-linux-gnu)
- Local Supabase CLI stack, loopback-only Docker network `caos-supabase-local`
- Deterministic IMP-003 harness identities (`tests/harness/registry.json`)
- DEC-J is RESOLVED: all firm authorization below validates `auth.uid()`
  against the **live** `audctx_memberships` / `audctx_client_access`
  relationship; the `x-active-firm` header is untrusted context only.

## Candidate definitions

- **A — request-scoped DB context.** Plain PostgREST table writes. An
  AFTER-trigger (`audctx_trg_resources_audit`, SECURITY DEFINER, pinned
  `search_path=''`) derives the actor from `auth.uid()` and reads
  `request.headers` (PostgREST-provided GUC) for correlation/request ids,
  X-Forwarded-For and user-agent. SECURITY DEFINER is required because
  `authenticated` has no SELECT/UPDATE/DELETE on the events table; the
  trigger only writes audit rows and is not an RLS bypass (RLS on the
  resource table is evaluated before the trigger fires).
- **B — explicit RPC context.** `audctx_b_create_resource(...)` (SECURITY
  INVOKER): validates the caller-selected firm against the live relationship
  (`audctx_assert_access`, fail-closed `42501`), performs the mutation and the
  audit insert in one transaction. The function has **no actor parameters** —
  actor is always `auth.uid()`. Companion RPCs: `audctx_service_event`
  (SECURITY DEFINER, executable only by `service_role`) for service actors and
  `audctx_support_event` (validates an open caller-owned break-glass session).
- **C — controlled server wrapper.** Local Node server
  (`scripts/spikes/audit-context/server.mjs`, 127.0.0.1:5499): validates the
  bearer token against GoTrue, generates `request_id` server-side, observes
  the socket IP itself, then forwards to `audctx_c_create_resource` with the
  **user's** token (RLS still enforced). Holds the only service-role key and
  the wrapper secret; browser code cannot reach the service-actor path.

## Direct PostgREST findings (what the database actually sees)

Evidence: `audctx_probe_context()` (results.json `evidence.directPostgrestProbe`).

- `auth.uid()` resolves the caller correctly — **TRUSTED** identity.
- `request.headers` GUC exposes all request headers to SQL as JSON, including
  arbitrary spoofed headers (`x-actor-user-id: <other user's uuid>` arrived
  verbatim). Everything in it is **UNTRUSTED METADATA**.
- **X-Forwarded-For is gateway-enriched:** the local Kong gateway appends the
  observed peer to the client value — `"203.0.113.99, 172.20.0.1"`. The
  client-supplied left portion is spoofable (A-03 recorded `198.51.100.23`
  verbatim); the right-most hop is gateway-asserted. Consistent with
  AUD-CTX-02: IP is best-effort evidence, never identity proof.
- `inet_client_addr()` returns the PostgREST container (`172.20.0.9`) —
  PostgreSQL **never** sees the browser connection. Real client IP exists only
  at a server/gateway boundary (Candidate C territory).
- `request.jwt.claims` contains standard claims (sub, role, aal, session_id,
  app_metadata, …); no custom claims are needed for this mechanism.

## RPC findings

- Mutation + audit in one transaction; actor derived, firm live-validated
  (B-01). Foreign firm, suspended and removed memberships all rejected
  (B-03/B-04) — DEC-J live-lookup semantics hold on the RPC path.
- **Spoof resistance at the API boundary:** RPC bodies containing
  `actor_user_id`/`actor_type`/`service_name`/`support_session_id` keys fail
  PostgREST function resolution (HTTP 404) — unknown argument keys never
  reach SQL (B-02). Combined with parameterless-actor design, caller-supplied
  actor identity is impossible.
- Service actor: `audctx_service_event` is revoked from
  public/anon/authenticated; a browser token gets HTTP 403, `service_role`
  succeeds with `actor_type='service'`, NULL `actor_user_id` (B-05).
- Support actor: valid open session writes `actor_type='support'` with both
  `actor_user_id` and `support_session_id`; another user's session and unknown
  sessions rejected (B-06).
- **Gotcha (recorded for the production design):** under RLS,
  `INSERT ... RETURNING` applies SELECT-visibility to the returned row. A
  SECURITY INVOKER audit RPC must not use RETURNING on a table with no SELECT
  policy for the caller (use `GET DIAGNOSTICS` instead).

## Server-wrapper findings

- Token validated against GoTrue before any DB work; missing/invalid tokens
  get 401 (C-02). Identity comes only from the validated token (C-03).
- `request_id` generated server-side; socket IP observed by the wrapper
  (`127.0.0.1` locally) and recorded as server-asserted metadata (C-01) —
  stronger than client headers, still proxy-chain dependent.
- Service path gated by a server-side secret + service-role key held only in
  the wrapper process; secret-less calls get 403; `service_name` is a
  server-fixed constant (C-04).
- Foreign-firm attempts through the wrapper are still rejected downstream by
  live validation (C-05) — the wrapper adds context, never authority.
- Cost: extra runtime + per-request token validation; measured below.

## Trust matrix (all candidates)

| Field | Classification | Evidence |
|---|---|---|
| `auth.uid()` | TRUSTED | PROBE-01 |
| selected firm_id | UNTRUSTED → VALIDATED live | A-06, B-03, C-05 |
| caller actor_user_id | UNTRUSTED, never accepted | A-02, B-02, C-03 |
| caller actor_type=service | UNTRUSTED; service only via service_role | A-02, B-05, C-04 |
| correlation_id | UNTRUSTED-METADATA (recordable, AUD-INV-06) | A-01, B-01, C-01 |
| request_id | A/B: UNTRUSTED-METADATA; C: server-generated | C-01 |
| user-agent | UNTRUSTED-METADATA | A-01 |
| IP / XFF | UNTRUSTED-METADATA, spoofable left hops; gateway-appended right hop; C observes socket IP | PROBE-03, A-03, C-01 |

## Spoof-resistance matrix

| Spoof attempt | A (header GUC) | B (RPC) | C (wrapper) |
|---|---|---|---|
| actor_user_id | IGNORED (A-02) | REJECTED at API boundary (B-02) | IGNORED — derived from validated token (C-03) |
| actor_type | IGNORED (A-02) | IGNORED; service via service_role only (B-05) | IGNORED on human path (C-03) |
| firm_id (foreign) | VALIDATED — denied (A-06) | VALIDATED — denied (B-03) | VALIDATED — denied (C-05) |
| service_name | IGNORED (A-02) | server-only definer function (B-05) | server-fixed constant (C-04) |
| support_session | IGNORED (A-02) | VALIDATED — open, caller-owned session (B-06) | not exposed |
| correlation_id | UNTRUSTED-METADATA (A-01) | UNTRUSTED-METADATA (B-01) | accepted/generated, recorded (C-01) |
| request_id | UNTRUSTED-METADATA | UNTRUSTED-METADATA | server-generated UUID (C-01) |
| IP headers | SPOOFABLE, recorded verbatim + gateway hop (A-03) | same as A | wrapper-observed socket IP (C-01) |
| user-agent | UNTRUSTED-METADATA | UNTRUSTED-METADATA | wrapper-observed header |

**No candidate allows a browser-supplied actor identity to become the trusted
audit actor** (the automatic-fail condition).

## Context leakage / pooling

- Transaction-local GUCs die at transaction end: post-commit value `<gone>`
  (GUC-01). Session-level `SET` persists for the connection — measured and
  flagged **dangerous under pooling** (GUC-02); any GUC mechanism must be
  transaction-local only.
- Cross-request isolation through the pool: a tx-local GUC set in one request
  is absent (`''`/NULL placeholder quirk — no value leak) in the next (GUC-03).
- Sequential A/B/A/B and 20 concurrent mixed-firm requests: actor, firm and
  correlation id correct on every audit row — **zero leakage** (A-04, A-05).
- PostgREST's `request.headers` / `request.jwt.claims` GUCs are set per
  request; no cross-user contamination observed under concurrency.

## Audit-write failure (fail-closed)

- A path: forced audit failure (fault-injection GUC) aborted the whole
  transaction — 0 resource rows, 0 events (F-01).
- B path: a masquerading audit row (`actor_type='service'` with a user id)
  rejected (RLS insert policy + actor-model CHECK); mutation rolled back
  atomically (F-02).
- Actor-model CHECK (AUD-ACT-05 spike equivalent) rejects `system` rows
  carrying a human `actor_user_id` even for privileged writers; the
  legitimate system seed row is intact (F-03).
- Conclusion: mutation + audit in one transaction is reliably fail-closed.
  Best-effort audit is unnecessary for security-sensitive mutations.

## Performance (local engineering comparison, not SLA)

120 measured operations per path after 15 warm-up; identical mutation shape
(firm-A resource create as partner A):

| Path | p50 | p95 | min | max |
|---|---|---|---|---|
| A — direct PostgREST + trigger | 5.56 ms | 6.69 ms | 3.60 ms | 7.31 ms |
| B — explicit RPC | 5.59 ms | 6.81 ms | 3.79 ms | 7.16 ms |
| C — wrapper → RPC | 40.04 ms | 44.53 ms | 34.15 ms | 1,981.25 ms |

C's overhead (~34 ms/op) is dominated by the extra hop and per-request
GoTrue token validation; its max shows a single ~2 s outlier (one-off stall
in the local wrapper/auth path — p95 is unaffected, but tail behavior of the
extra network hop is real). A and B are equivalent within noise.

## Operational complexity

- **A:** zero application discipline for plain table writes; automatic
  IP/UA/correlation capture; but needs a SECURITY DEFINER trigger (review
  burden), cannot receive trusted custom context from the browser, and header
  metadata is untrusted. Debugging trigger-captured context is indirect.
- **B:** explicit, testable, fail-closed; spoof-proof by function signature;
  but covers only RPC-routed writes (raw table writes bypass it), implies RPC
  proliferation for sensitive mutations, and has the RETURNING-under-RLS
  gotcha. Cheapest to reason about per write path.
- **C:** strongest provenance (server-generated request ids, observed IP,
  the only safe home for service/system actors and future security events);
  but adds a runtime (Edge Function/server), a deployment surface, per-request
  token validation, ~7× latency, and new outage modes. Required anyway for
  system/service/security-event paths — browsers cannot safely mint those
  identities.

## Known limitations

- Local single-gateway topology only; hosted Supabase/Cloudflare chains may
  add more XFF hops. The trust rule (left hops untrusted, gateway-asserted
  right hop) must be re-verified per deployment topology.
- The wrapper is a local Node stand-in, not a deployed Edge Function;
  Deno-specific behavior untested.
- Spike resource dataset is small (1,000 seed rows); this spike measures
  context propagation, not tenant-filter scale (DEC-J covered scale).
- `request.headers` content is PostgREST-version-specific; pin verification
  into the future RLS/audit integration tests.

## Recommendation (for human/security review — AUD-OQ-02 stays OPEN)

**Recommend B + C (this report's lettering), with A retained as a
defense-in-depth capture layer:**

1. **B (explicit RPC context) as the normative mutation path** for
   audit-sensitive writes: trustworthy actor by construction, live firm
   validation (DEC-J), atomic fail-closed mutation+audit, simplest to review.
2. **C (controlled server wrapper) for everything a browser must never mint:**
   service/system actors, support/break-glass initiation, security events, and
   where strongest transport provenance (server-observed IP, server-generated
   request/correlation ids) is required. The service_role-only definer event
   function (validated in B-05) is its database counterpart.
3. **A (header-GUC trigger) as belt-and-braces** on tables that also allow
   direct PostgREST writes: it captures best-effort IP/UA/correlation with
   zero app discipline — never as the sole authority for actor or firm.

This converges with the spec's provisional AUD-CTX-01 (spec-lettering B+C),
now with empirical support, and adds the trigger layer as optional
defense-in-depth rather than a required component. Candidate A alone is
insufficient (no trusted browser-populated context); candidate C alone leaves
direct table writes unaudited; candidate B alone lacks server-observed
transport provenance and a service-actor path.

## TEST traceability

- **TEST-SPIKE-CTX-01** — candidates evaluated: A (header GUC in triggers),
  B (explicit RPC), C (server wrapper + definer event function), and the B+C
  combination. ✅ (mechanism validation)
- **TEST-SPIKE-CTX-02** — acceptance criteria: trustworthy actor identity
  (never client-spoofable) ✅; firm context correct under PostgREST writes and
  RPC ✅; IP availability/trust measured, best-effort per AUD-CTX-02 ✅;
  user-agent availability ✅; correlation id end-to-end (AUD-INV-06) ✅;
  service/system distinction preserved (AUD-ACT-05) ✅; spoof resistance ✅;
  pooling/context-leakage safety ✅; audit-failure fail-closed ✅.
- Mechanism-level evidence toward (not completion of): **TEST-AUD-07**
  (fail-closed audit), **TEST-AUD-08** (IP/UA/correlation context),
  **TEST-AUD-09** (actor-model invariants). Production implementations remain
  for the Release-0 audit work packages.
