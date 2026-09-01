# DEC-J Technical Spike — Authorization / RLS Mechanism Comparison

- **Status:** Spike executed; evidence complete. **DEC-J remains OPEN** — this
  report is the decision-record input (TEST-SPIKE-J-03). Human/security
  review decides; a controlled amendment to `docs/spec/05-authorization-rls.md`
  resolves DEC-J. No production tables, migrations, or final RLS were created.
- **Date:** 2026-08-31
- **Package:** IMP-004 (Harness Phase). Governing design: RLS-MECH-01/02
  (`05`), TEST-SPIKE-J-01/02/03 (`11`).
- **Reproduce:** `npm run db:reset:harness && npm run spike:dec-j`
  (teardown: `npm run spike:dec-j:cleanup`). Raw machine-readable evidence:
  `docs/harness/dec-j-results.json` (no secrets).

## Environment

| Component | Version |
|---|---|
| Supabase CLI (project dev dep) | 2.116.0 |
| PostgreSQL | 17.6.1.165 (supabase/postgres) |
| GoTrue (Auth) | v2.196.0 |
| PostgREST | v16.1 |
| Node | v24.18.0 |
| Stack | local CLI stack, loopback-only bindings (`caos-supabase-local`) |

## Candidates

All three candidates enforce the **identical permission model** through real
PostgREST requests with user access tokens (anon key; service-role used only
for setup/membership mutation):

- select: any active member (staff ctx) or matching client grant (client ctx)
- insert: super_admin/partner/manager/senior/article_executive
- update: super_admin/partner/manager/senior
- delete: super_admin/partner

**Candidate A — JWT claims only.** A custom access-token hook
(`decj_access_token_hook`, Postgres hook via
`[auth.hook.custom_access_token]`) embeds
`decj: { active_firm, context, memberships: [{membership_id, firm_id, role,
authz_version}], client_grants: [...] }` at issue time. RLS policies read
claims exclusively — **zero live membership lookups**. Active firm/context
come from `raw_app_meta_data` (not client-writable); changing them requires
a trusted-server step (simulated by Admin API) **plus token refresh**.

**Candidate B — live membership lookup.** JWT establishes identity only
(`auth.uid()`). The active firm arrives as an **untrusted** request header
(`x-active-firm`); every policy re-validates it against the live
`decj_memberships` table (`EXISTS … status='active'`, role lists inline).
The header grants nothing by itself.

**Candidate C — hybrid.** Claim snapshot (same hook as A) **plus** a live
indexed verification per request: membership exists, is owned by
`auth.uid()`, firm matches the (untrusted) header, status is `active`, and
`authz_version` equals the token snapshot. Role is read from the trusted
claim **only after** live verification succeeds. Security property: any
role/suspension/removal change alters status or version → old JWT fails
authorization immediately (fail-safe deny) → a fresh token is required.

## Spike schema (temporary, torn down after evidence capture)

`decj_firms` (2 tenants + 18 JWT-size fillers), `decj_memberships`
(id, user_id→auth.users, firm_id, role, status, authz_version; indexes
`(user_id, firm_id) include (status, role, authz_version)` and `(id, user_id)`),
`decj_client_access` (user, firm, client_key), and three identical resource
tables `decj_resources_{a,b,c}` — 100,000 synthetic rows each (Firm A 60,000 /
Firm B 40,000; 5% `CL-100`, 5% `CL-999` client keys; index `(firm_id, id)`).
Helper functions: `decj_req_firm/decj_req_context` (header readers),
`decj_a_*` (claim readers), `decj_c_verified_role/decj_c_client_ok` (hybrid
verify). Only the hook is `security definer` (required: it runs as
`supabase_auth_admin` with no table grants) with `set search_path = ''`,
qualified references, execute granted to `supabase_auth_admin` only, and a
pass-through guard when spike tables are absent. No RLS-bypass helpers.

## Security-correctness matrix (44 assertions — all as expected)

| Test | A | B | C |
|---|---|---|---|
| Same-firm authorized read | ✅ rows | ✅ | ✅ |
| Cross-firm read (foreign filter) | ✅ 0 rows | ✅ | ✅ |
| Cross-firm read (foreign active-firm header) | n/a (claim-bound) | ✅ 0 rows | ✅ 0 rows |
| Foreign user asserting our firm | ✅ 0 rows | ✅ | ✅ |
| Known foreign record ID attack (id=70000) | ✅ 0 rows | ✅ | ✅ |
| Cross-firm insert | ✅ 403/42501 | ✅ | ✅ |
| Cross-firm update / delete | ✅ 0 rows affected | ✅ | ✅ |
| Unauthorized role (billing insert, senior delete) | ✅ denied | ✅ | ✅ |
| Authorized role (partner insert/delete, manager update) | ✅ | ✅ | ✅ |
| Suspended membership read | ✅ 0 rows | ✅ | ✅ |
| Removed membership read | ✅ 0 rows | ✅ | ✅ |
| Expired access token | 401 (all candidates — platform-level) | | |

**No cross-tenant authorization succeeded under any candidate.**

## Freshness results (18 assertions — the decisive difference)

Token issued → membership mutated → **stale (unexpired) token** retried →
fresh token retried. JWT expiry 3600 s.

| Sequence | A (claims) | B (lookup) | C (hybrid) |
|---|---|---|---|
| Role downgrade partner→senior, stale token | ❌ **stale token DELETED the row** — old privilege retained until expiry/refresh | ✅ denied immediately | ✅ denied immediately (version mismatch, whole context fails safe) |
| Role downgrade, fresh token | ✅ new (reduced) role | ✅ | ✅ |
| Suspension, stale token | ❌ **5 rows still returned** | ✅ 0 rows | ✅ 0 rows |
| Suspension, fresh token | ✅ 0 rows (membership no longer issued) | ✅ 0 rows | ✅ 0 rows |
| Removal, stale token | ❌ **5 rows still returned** | ✅ 0 rows | ✅ 0 rows |
| Removal, fresh token | ✅ 0 rows | ✅ 0 rows | ✅ 0 rows |

**Candidate A cannot meet the revocation requirement (RLS-MECH-02 criteria
3–5, AUTH-08 promptness) without added server-side validation**: a suspended
or removed member keeps full prior privileges for the life of the access
token (up to `jwt_expiry`). This is an inherent property of claims-only
authorization, not a tuning issue.

Note on C: the fail-safe deny also means a *legitimate* role change does not
take effect until the client refreshes its token (deny-then-refresh UX).
B instead applies the new role immediately. Both are safe; C is strictly
conservative.

## Active-firm switching (multi-firm user: manager@A, senior@B)

| | A | B | C |
|---|---|---|---|
| Mechanism | trusted `app_metadata` update + **token refresh** | request header only (validated) | request header only (validated) |
| A→B→A isolation | ✅ each hop correct; stale token sees 0 foreign rows | ✅ 50 rows per hop, all correct tenant | ✅ |
| Residue between contexts | none observed | none observed | none observed |
| Operational consequence | firm-switch = server round-trip + refresh; UI must handle token rotation | instant switch; header is context, never authority | instant switch + live verify per request |

## Staff + client overlap (one identity: senior@A staff + CL-100 client grant)

| | A | B | C |
|---|---|---|---|
| Staff ctx sees full firm portfolio | ✅ 60,000 | ✅ 60,000 | ✅ 60,000 |
| Client ctx sees only granted rows | ✅ 3,000 (CL-100) | ✅ 3,000 | ✅ 3,000 |
| Client ctx → foreign firm | n/a (claim-bound; grant absent → 0 by construction) | ✅ 0 rows | ✅ 0 rows |
| Client ctx write to staff resource | ✅ 403 | ✅ 403 | ✅ 403 |

No inheritance between contexts in any candidate. A requires a token refresh
to change context; B/C switch per request (validated selector).

## Benchmarks

Dataset: 100,000 rows/table (60k Firm A / 40k Firm B). Query: authorized
hot-path read `?select=id,firm_id,name,amount&firm_id=eq.<A>&order=id&limit=25`
through PostgREST+RLS, sequential, loopback; 25 warm-up + 200 measured.
Methodology caveats: single-user, warm local stack — **not** a load test.

| Candidate | p50 | p95 | min | max |
|---|---|---|---|---|
| A | 4.57 ms | 5.54 ms | 2.65 | 18.53 |
| B | 3.98 ms | 5.14 ms | 1.79 | 7.47 |
| C | 5.22 ms | 6.31 ms | 2.88 | 6.83 |

All three are far inside the provisional p95 < 100 ms spike threshold
(TEST-SPIKE-J-02 #11). C's live-verify join costs ≈ +0.6–1.2 ms vs B at this
scale; B's per-row `EXISTS` is index-backed (`decj_memberships_lookup`;
the Seq Scan on the 13-row memberships table in the plan is immaterial).

EXPLAIN ANALYZE (emulated `authenticated` role + real claims/GUCs):
- A: Index Scan `decj_resources_a_firm`; planning 0.70 ms / exec 1.04 ms.
- B: Index Scan `decj_resources_b_firm` + bitmap on
  `decj_client_access_lookup`; planning 1.31 ms / exec 0.29 ms.
- C: Index Scan `decj_resources_c_firm` (verify via memberships PK lookup);
  planning 0.84 ms / exec 2.13 ms.

## JWT size (hook-embedded membership snapshots)

| Memberships | Token bytes | `decj` claim bytes |
|---|---|---|
| 1 | 1,192 | 248 |
| 2 | 1,488 | 388 |
| 5 | 2,048 | 808 |
| 20 | 4,848 | 2,908 |

≈ +140 B per embedded membership. Acceptable to ~20 memberships; a firm with
very large membership counts should bound the snapshot (active memberships
only — already the case — and at most one snapshot per firm). B embeds
nothing and is immune to this concern.

## Complexity & operational comparison

| Axis | A | B | C |
|---|---|---|---|
| Moving parts | hook + claims-only policies | policies only | hook + verify functions + version discipline |
| Revocation | ❌ bounded by token TTL | ✅ immediate | ✅ immediate (fail-safe) |
| Role-change effect | next refresh | immediate | deny-until-refresh (conservative) |
| Firm/context switch | server write + refresh | header (validated) | header (validated) |
| Token size growth | yes (~140 B/membership) | none | yes (bounded) |
| Operational dependency | hook on every token issue | none beyond DB | hook + `authz_version` bump on every membership mutation (production: trigger) |
| Debuggability | claim inspect = full picture; staleness invisible in DB | policy state = DB state; simplest to reason about | claim + DB must agree; mismatches deny loudly (safe, diagnosable via memberships table) |
| Policy SQL | shortest hot path | longest (inline EXISTS lists) | short role lists + one verify function |

Cross-cutting finding (all candidates): denied **inserts** surface as
403/`42501`, but denied **updates/deletes** return 200 with 0 rows affected
(RLS row-hiding). The production API layer must convert zero-affected-row
writes into explicit authorization errors (TEST-RLS-GEN-04, API-ERR-02/03).

## Known limitations

- Single-user sequential loopback timing; no concurrency/connection-pool
  race testing; one table shape (~100k rows) — not a production load model.
- Candidate A's "trusted server" firm/context selection was simulated with
  the local Admin API (service-role), which is the realistic stand-in for a
  future server-side select-firm endpoint.
- The `authz_version` bump for C was applied manually in SQL; production
  must enforce it with a trigger on membership mutation.
- The custom access-token hook is on the critical path of every token
  issue; the spike hook passes through when spike tables are absent, but a
  production hook needs its own tests/monitoring.
- JWT-size scaling measured to 20 memberships only.

## Recommendation

**RECOMMEND C (hybrid: claim snapshot + live membership/version
verification)** — consistent with the provisional RLS-MECH-01 direction,
now with empirical support:

1. **Tenant correctness:** all three pass completely (no cross-tenant
   success anywhere). Tie.
2. **Revocation freshness:** A **fails** outright (stale token retained
   post-suspension/removal privileges — an automatic candidate fail per the
   spike's own rule). B and C both revoke immediately.
3. **Role-change safety:** C fails safe (old token loses context until
   refresh); B applies the new role immediately. Both acceptable; C is the
   conservative design the approved specs describe.
4. **Active-firm / overlap:** B and C switch per request with a validated
   untrusted selector; A needs a server round-trip + refresh per switch.
5. **Maintainability:** B is simplest; C adds the hook and version-bump
   discipline — judged acceptable given (2)–(4).
6. **Performance:** A/B/C p95 = 5.5/5.1/6.3 ms — all far under threshold;
   performance does not differentiate.
7. **Token complexity:** C's growth is linear and bounded (~140 B per
   membership; 4.8 KB at 20) — acceptable; monitor at scale.

**Fallback (per TEST-SPIKE-J-03): B (live lookup).** B passes every security
criterion with the fewest moving parts. If the hook/version-maintenance
burden proves unacceptable in implementation review, adopt B and amend `05`
accordingly. **A is rejected**: claims-only authorization cannot satisfy
suspension/removal promptness within token TTL.

This recommendation does **not** resolve DEC-J. `05` remains OPEN pending
human/security review of this evidence.

---

# INDEPENDENT REVIEW FOLLOW-UP (2026-08-31, same environment)

Review outcome on the original run: **Candidate A rejected; B and C both
pass; evidence insufficient to prefer C over B.** One targeted question
remained: does B's live membership lookup stay acceptable at representative
**membership-table** scale? This section answers it. Original measurements
above are unchanged; follow-up evidence is appended in
`docs/harness/dec-j-results.json` under `followup`.
Reproduce: `npm run spike:dec-j:followup`.

## Scaled dataset

- `decj_memberships` grown to **100,013 rows** (100,000 synthetic across
  2,000 synthetic firms × 50 members + 13 harness memberships). The
  user_id FK was dropped (spike-only) so synthetic members need no
  auth.users rows; harness memberships and correctness semantics untouched.
- Indexes (fair to both, production-plausible, unchanged from the original
  spike): `decj_memberships_lookup (user_id, firm_id) include (status,
  role, authz_version)`, `decj_memberships_id_user (id, user_id)`,
  unique `(user_id, firm_id)`.

## Query plans at scale (EXPLAIN ANALYZE, RLS active)

- **B:** Index Scan `decj_resources_b_firm` + **Index Only Scan on
  `decj_memberships` using `decj_memberships_lookup`** + bitmap on
  `decj_client_access_lookup`; planning 1.31 ms / execution 0.22 ms.
  The tiny-table sequential scan from the original run is gone — the
  membership lookup is an index-only point lookup at 100k rows.
- **C:** Index Scan `decj_resources_c_firm` + memberships PK verify;
  planning 1.03 ms / execution 2.14 ms.

## Security regression at scale (22 B/C assertions — all as expected)

Same-firm access, known-foreign-ID denial, cross-firm read/insert denial,
suspension + stale token, removal + stale token, role downgrade (stale
token cannot keep delete), role upgrade, multi-firm A→B→A switching,
staff/client overlap (60,000 staff / 3,000 client) — **zero regressions
for either candidate.**

One behavioral asymmetry (a policy preference, not a vulnerability):
on **role upgrade**, B grants the new role to an existing token
immediately (a legitimate grant — safe); C fails closed until the client
refreshes. Both are defensible; C's conservatism here buys nothing against
any attack, since the upgrade is an authorized administrative act.

## Performance at 100k memberships (25 warm-up + 200 measured)

| Candidate | p50 | p95 | min | max |
|---|---|---|---|---|
| B | 4.20 ms | 5.25 ms | 1.79 | 6.42 |
| C | 4.12 ms | 5.40 ms | 2.26 | 7.04 |

B's live lookup cost is **flat from 13 to 100,013 membership rows**
(original: p50 3.98 / p95 5.14 ms). Both remain ~20× under the 100 ms
spike threshold.

## 1 / 5 / 20 membership scaling (100 measured requests each)

| Memberships | B p50/p95 | C p50/p95 | C token bytes |
|---|---|---|---|
| 1 | 2.94 / 3.84 | 3.42 / 4.90 | 1,192 |
| 5 | 3.06 / 3.93 | 4.17 / 5.82 | 2,048 |
| 20 | 3.90 / 4.74 | 4.56 / 7.32 | 4,848 |

B's point lookup is insensitive to how many memberships a user holds
(indexed by `(user_id, firm_id)`). C's cost rises slowly with membership
count (larger claim arrays to scan per request) and its token grows
linearly (~140 B/membership). 20 is not a production maximum; the trends,
not the absolutes, are the finding.

## Updated operational comparison (B vs C)

| Axis | B (live lookup) | C (hybrid) |
|---|---|---|
| Authorization freshness | immediate for role/suspension/removal | immediate deny (fail closed); new permissions need token refresh |
| Custom claims required | none beyond identity/context | claim snapshot via custom access-token hook |
| Version protocol | none | `authz_version` bump on every membership mutation (production trigger) + hook maintenance |
| Token size | constant (~1.2 KB here; no decj claims needed) | +~140 B per membership (4.8 KB at 20) |
| Hot-path latency at scale | 4.20/5.25 ms (p50/p95), flat vs table size | 4.12/5.40 ms; slight growth with membership count |
| Query-plan complexity | index-only point lookups | equivalent + claim-array scan |
| Moving parts / failure modes | policies only | hook on every token issue + version discipline + refresh UX on any membership change |

## Measurable advantage of C over B

**None demonstrated.** C's only distinct behavior — fail-closed denial of
stale tokens after membership changes, including upgrades — matched B's
immediate denial for the security-relevant cases (downgrade, suspension,
removal) and differed only on role *upgrade*, where immediate grant is
safe. C showed no latency, correctness, isolation, or operational
advantage at any measured scale, while adding the hook dependency,
version-bump protocol, token growth, and deny-then-refresh UX.

## Follow-up recommendation

**RECOMMEND B (live membership lookup)** for Release 0:

1. Tenant correctness: B and C identical (no cross-tenant success).
2. Revocation/suspension freshness: both immediate.
3. Role-change behavior: both safe; B simpler (immediate effect, no
   refresh protocol).
4. Active-firm/overlap: identical validated-selector behavior.
5. Maintainability/debuggability: B has the fewest moving parts; policy
   state = database state.
6. Performance: B flat at 100k memberships (index-only scan), equal or
   better than C at every measured point, with constant token size.
7. Operational complexity: B needs no custom claims hook and no
   `authz_version` maintenance.

DEC-J remains **OPEN** — this is spike evidence and a recommendation only;
resolution requires the controlled amendment to
`docs/spec/05-authorization-rls.md` after human decision.

## TEST-* traceability

- **TEST-SPIKE-J-01** — hook + claims-style, lookup-style, and hybrid
  policies implemented on representative tenant tables against the local
  stack. ✅
- **TEST-SPIKE-J-02** — criteria 1–10 evidenced above (§security matrix,
  §freshness, §switching, §overlap, §expired token, §refresh behaviour);
  #11 latency recorded (p50/p95 vs provisional 100 ms budget); #12
  policy testability/complexity assessed (§complexity). ✅
- **TEST-SPIKE-J-03** — this report is the written decision record; DEC-J
  stays OPEN until human review amends `05`. ⏳
- Supporting families exercised (mechanism validation only, **not** the
  production RLS matrix): TEST-RLS-GEN-01 (Firm A/B fixtures incl.
  multi-firm, suspended, removed, overlap), TEST-RLS-GEN-02 (offensive
  posture: foreign-id and foreign-header attacks), TEST-RLS-GEN-03
  (per-table case shape incl. suspension/removal/multi-firm/overlap),
  TEST-RLS-GEN-04 (mutation-denial surfacing — recorded as a finding for
  the API layer).
