# CAOS Specification Index

- **Status:** Approved
- **Approval status:** Approved (Batch 1)
- **Final Spec Gate:** PASS — 2026-08-31
- **Phase 2 status:** COMPLETE (specification authoring; all R0-gate specs 00–13 approved; required closure fixes applied)
- **Harness Gate:** PASS — human approved 2026-09-01 (evidence commit `305d133`; exact committed-HEAD verification from a fresh detached worktree: 14/14 phases green)
- **Harness Engineering phase (IMP-000…IMP-005):** COMPLETE
- **Next phase:** Release-0 implementation (per `12-release-0-plan.md`) — STARTED 2026-09-01
- **Current package:** IMP-071 — Staging deployment & verification — NOT STARTED, NOT AUTHORIZED (begins only after the IMP-070 closure documentation is durably committed/pushed under explicit human authorization and an explicit human implementation instruction). IMP-070 Fixture demo preservation & adapter completion is CLOSED (human closure-documentation authorization 2026-10-03; implementation checkpoint 1eb3559722fd60f912760a3fbebb61468eee049e `feat: complete dual-mode data layer validation`; formal Harness Gate PASS after the RESOLVED HIGH-1 test-isolation correction; independent security review PASS — CRITICAL/HIGH/MEDIUM = 0, LOW=4, INFO=4 accepted; Human Acceptance ACCEPTED_WITH_EXPLICIT_RESIDUALS; hosted staging acceptance PASS_WITH_LIMITATION — read-only HTTP shell/asset/SPA checks PASS on `staging.caos.datafabric.in`; authoritative fixture-demo URL absent from trusted sources; deployed commit not independently verifiable through safe read-only metadata — revision UNKNOWN/LIMITED; no migration/schema/RLS/RPC/realtime/fixture-content/spec change; production untouched; closure durability Git commit/push NOT yet performed — pending explicit human authorization). IMP-062 Limited Realtime is CLOSED (human closure-documentation authorization 2026-10-03; implementation checkpoint b6d70477acf8233eb9b9d6ef2a5058f4995c7462 `feat: limited realtime`; hosted staging acceptance PASS on project `caos` ref `pyrniumcjcvagjygheyu`; hosted migration ledger 14/14 through `20261002000000_limited_realtime.sql`; production untouched; final closure Git checkpoint 05d037ba6f5889aca11f1ef285310b40fde1ebc7 committed and pushed to origin/staging under explicit human Git authorization after independent closure-checkpoint verification passed, becoming origin/staging HEAD upon the IMP-062 closure push). IMP-061 Structured global search is CLOSED (human closure-documentation authorization 2026-10-01; implementation checkpoint `213b5b1` `IMP-061: implement structured global search`; hosted staging acceptance PASS — API checks 67/67, UI checks 52/52, combined 119/119, combined failures 0; hosted migration ledger 13/13 through `20260920000000_structured_search.sql`; production untouched; final closure Git checkpoint b01d644e117ff220f1d804940a8dfd9311676eed committed and pushed to origin/staging after the Runtime Test gate and explicit human Git authorization passed, followed by closure-pointer-reconcile checkpoint 01595be9f9c767af151fd0e41f187585866d7c9f, also committed and pushed, becoming origin/staging HEAD upon the IMP-061 closure push). IMP-060 Command Centre & Morning Brief live data is CLOSED (human package-closure approval 2026-09-19; implementation checkpoint `d78cfe7` `IMP-060: live Command Centre and Morning Brief read models`; closure checkpoint: `f51ff717b28f093fb94b95dc6e58f829742aea66`; API-OQ-03 RESOLVED = human-approved B-count — RLS-respecting per-section exact-count reads with limited derivation row fetches, no aggregate SECURITY DEFINER; H1–H8 rulings implemented; API-OQ-02 resolved for the IMP-060 surfaces only; MEDIUM-1 correction — dashboard integration suite wired into the standing Harness Gate — independently verified; independent full Harness Gate PASS — 25 standing gate phases passed, the final run artifact contains 26 PASS records because stack-stop cleanup is recorded when the gate starts the stack (unit 354/354, dashboard integration 25/25, Playwright smoke 16/16); hosted staging acceptance PASS at hosted revision `d78cfe7` on project `caos` ref `pyrniumcjcvagjygheyu`; production untouched)
- **Completed packages (25 / 27):** IMP-000…IMP-005 harness engineering (COMPLETE — Harness Gate PASS, commit `305d133`); IMP-010 tenant core schema (COMPLETE — checkpoint `c913b9d`); IMP-011 staff authentication (COMPLETE — checkpoint `8ea9c4a`); IMP-012 foundational RLS (COMPLETE — checkpoint `7f5c7b6`); IMP-013 audit foundation (COMPLETE — checkpoint `3ee1e6d`); IMP-014 data-source adapter skeleton (COMPLETE — checkpoint `3fed76a`); IMP-020 client hierarchy persistence (COMPLETE — checkpoint `1d7bbb1`); IMP-021 engagements (COMPLETE — checkpoint `c38c758`); IMP-022 Client 360 live wiring (COMPLETE — checkpoint `6b58769`); IMP-030 compliance types & rule versions (COMPLETE — checkpoint `00ad7c2`); IMP-031 compliance profiles & instances (COMPLETE/CLOSED — checkpoint `03e999d`, staging acceptance PASS 2026-09-04); IMP-040 tasks, dependencies, checklists & comments (COMPLETE/CLOSED — checkpoint `be15229`, staging acceptance PASS 2026-09-05); IMP-041 review queue (COMPLETE/CLOSED — primary checkpoint `636beed`, accepted corrective checkpoint `e857e59`, staging/browser acceptance PASS 2026-09-06); IMP-042 alerts & My Work (COMPLETE/CLOSED — checkpoint `1f3db3e`, staging acceptance PASS 2026-09-07); IMP-050 recurrence generation & scheduler signals (COMPLETE/CLOSED — implementation checkpoint `b15b584`, hosted staging acceptance PASS, human package-closure approval 2026-09-13); IMP-051 deadline materialization & alert evaluation (COMPLETE/CLOSED — implementation checkpoint `8e8464a`, hosted staging acceptance PASS, human package-closure approval 2026-09-18); IMP-060 Command Centre & Morning Brief live data (COMPLETE/CLOSED — implementation checkpoint `d78cfe7`, hosted staging acceptance PASS, human package-closure approval 2026-09-19); IMP-061 structured global search (COMPLETE/CLOSED — implementation checkpoint `213b5b1`, hosted staging acceptance PASS, human closure-documentation authorization 2026-10-01; final closure Git checkpoint b01d644e117ff220f1d804940a8dfd9311676eed); IMP-062 limited realtime (COMPLETE/CLOSED — implementation checkpoint b6d70477acf8233eb9b9d6ef2a5058f4995c7462 `feat: limited realtime`, hosted staging acceptance PASS, human closure-documentation authorization 2026-10-03; final closure Git checkpoint 05d037ba6f5889aca11f1ef285310b40fde1ebc7); IMP-070 fixture demo preservation & adapter completion (COMPLETE/CLOSED — implementation checkpoint 1eb3559722fd60f912760a3fbebb61468eee049e `feat: complete dual-mode data layer validation`, hosted staging acceptance PASS_WITH_LIMITATION, human closure-documentation authorization 2026-10-03; closure durability Git commit/push pending explicit human authorization)
- **IMP-061 closure record (package CLOSED 2026-10-01 — human closure-documentation authorization; final closure Git checkpoint b01d644e117ff220f1d804940a8dfd9311676eed):** IMP-061 — Structured global search — COMPLETE/CLOSED (contract finalized 2026-09-19; contract checkpoint `3f03edb`; R11 contract-amendment checkpoint `a6f1c29`; implementation checkpoint `213b5b1`): contract discovery PASS; preliminary rulings finalized; local spike PASS; fresh independent spike review PASS (CRITICAL=0/HIGH=0; MEDIUM=2 — MEDIUM-1 resolved as IMP061-M1 = M1-A, MEDIUM-2 resolved by not citing the unretained superuser pg_trgm planner evidence and recording no numerical threshold; LOW=4 historical spike-quality observations, none a production vulnerability); final human rulings IMP061-R1…R10 + IMP061-M1 APPROVED and recorded normatively in `07` API-R0-SRC, `11` (TEST-API-21…24, TEST-E2E-13), and the `12` IMP-061 package contract. Explicit human IMPLEMENTATION AUTHORIZATION was subsequently GRANTED; primary implementation discovery STOPPED cleanly before any code (no truthful existing destination for the `staff` search kind; no fully role-truthful destination for `task` / `compliance_instance`; the repository remained completely clean). Final human ruling IMP061-R11 = R11-A (OPTIONAL TRUTHFUL NAVIGATION) APPROVED 2026-09-20 — the hit navigation destination is optional: `client` / `legal_entity` / `registration` navigate to `/clients/:clientId`, while `task` / `compliance_instance` / `staff` are searchable but non-navigable in R0 and no new route/page is introduced — recorded normatively in `07`/`11`/`12`. Implementation then LANDED and CLOSED: implementation checkpoint `213b5b1` `IMP-061: implement structured global search` (2026-09-20) — the exact implementation patch passed independent review and Runtime Test before commit/push; the remote implementation checkpoint was independently verified. Migration `20260920000000_structured_search.sql` applied to hosted staging (migration gate PASS; fresh independent hosted DB verification PASS; hosted ledger 13/13 through `20260920000000`); `structured_search` hosted as SECURITY INVOKER with `search_path=''`, `authenticated` execution, PUBLIC denied, `anon` denied, no explicit `service_role` grant introduced; catalog invariants unchanged (tables 24, RLS 24/24, FORCE RLS 20, policies 51). Netlify staging published revision == `213b5b1` (no additional deploy required). Hosted functional acceptance PASS — API checks 67/67, UI checks 52/52, combined 119/119, combined failures 0 (six-domain search; tenant isolation; identifier masking; R11 navigable and non-navigable behavior; Offboarded behavior; M1-A senior and article coverage; partner/manager/senior/article/billing role coverage; zero-result state; no fixture fallback; existing staging regression). ERROR_STATE_TRUTHFULNESS NOT_EXERCISED on hosted staging — accepted non-blocking limitation (no safe non-mutating hosted fault-injection mechanism exists; local component/test coverage remains authoritative for the error states). Acceptance cleanup completed and independently verified: deterministic IMP-061 fixture residue ZERO; six synthetic acceptance profiles/auth users retained with passwords rotated to intentionally unretained fresh random values — the six acceptance identities are intentionally unusable until a future explicitly authorized credential/MFA provisioning gate; the six imp061-accept TOTP factors and `/tmp/imp061-accept/sessions.json` removed; append-only audit evidence retained (audit_log count 1103; no audit cleanup/deletion performed). Historical implementation-review LOW findings = 7: LOW-3 (the stale pre-implementation "implementation paused / no implementation exists" repository status wording) is RESOLVED by this closure record; LOW-1/2/4/5/6/7 remain OPEN — effective open LOW count 6. Production untouched. **Next package:** IMP-062 — Limited Realtime (NOT STARTED, NOT AUTHORIZED). Historical pre-implementation record for IMP-060 (kept for rationale): all pre-implementation human decisions RESOLVED and recorded before implementation (H1–H8 rulings, the API-OQ-02 surface ruling, and API-OQ-03 = B-count — human-approved on the measured local representative-volume benchmark with all three candidates passing three-way semantic/security validation; recorded normatively in `07` API-R0-DASH / the API-OQ matrix and in the `12` IMP-060 package contract; decision evidence `scripts/spikes/api-oq-03/`); the fresh independent implementation/security review passed after one bounded MEDIUM-1 correction (dashboard integration suite initially absent from the standing Harness Gate); hosted rendered-error injection remained NOT_SAFELY_EXERCISABLE (accepted limitation — local component evidence covers the error states); three accepted LOW findings recorded in `docs/harness/current-state.md` §6f (none an implementation blocker).

- **IMP-062 closure record (package CLOSED 2026-10-03 — human closure-documentation authorization; final closure Git checkpoint 05d037ba6f5889aca11f1ef285310b40fde1ebc7):** IMP-062 — Limited Realtime — COMPLETE/CLOSED: realtime for exactly the two approved surfaces (Review Queue freshness; alert badge/count freshness, API-RT-01…07) as an optimization only — correctness never depends on it (API-RT-05). Final human rulings carried by this durable closure record: IMP062-R1 = R1-B (true push transport = database-trigger realtime.send / broadcast to private firm-scoped topics `firm:<uuid>:review_queue` / `firm:<uuid>:alerts` with membership-scoped `realtime.messages` authorization, minimal invalidation-only payloads `{firm_id,id,kind}`, authoritative refetch under RLS, polling fallback); IMP062-R2 (the bounded platform verification spike was authorized and completed — local PASS, hosted staging PASS, read-only hosted probes, zero residue); IMP062-R3 (active-firm subscription rebuild is deferred to the later firm-switcher package — no switcher machinery in IMP-062); H2 (realtime authorization is membership-scoped, not active-firm-scoped — the active firm remains application context); H3 (join-time realtime authorization staleness model accepted with safeguards — fresh join/reconnect reauthorizes; explicit teardown on logout/identity/session change is load-bearing; invalidation-only payloads and authoritative refetch bound consequences). Implementation checkpoint b6d70477acf8233eb9b9d6ef2a5058f4995c7462 `feat: limited realtime` (2026-10-02) — exactly one commit, 25 files; independent Git checkpoint verification PASS; pushed to origin/staging under explicit human authorization (server ref verified). Verification chain: implementation review PASS; dedicated runtime verification PASS; TEST-API-09 PASS; TEST-API-10 PASS; authoritative Harness Gate PASS 27/27 (realtime-integration 9/9); independent implementation security review PASS (CRITICAL/HIGH/MEDIUM/LOW = 0); hosted staging acceptance PASS (project `pyrniumcjcvagjygheyu`; migration `20261002000000_limited_realtime.sql` applied, hosted ledger 14/14; realtime.messages RLS, trigger broadcast, same-firm delivery, cross-firm denial, forged-topic denial, anonymous/private denial, client publish denial, invalidation-only payload, accepted revocation model, explicit teardown, reconnect reauthorization/refetch, polling fallback, Review Queue freshness, alert badge/count freshness, test-data cleanup, no unexpected hosted residue); independent closure-readiness review PASS. Application catalog invariants unchanged (tables 24, RLS 24/24, FORCE RLS 20, policies 51; `supabase_realtime` publication tables 0; the migration adds two SECURITY DEFINER broadcast trigger functions with `search_path=''` plus exactly two `realtime.messages` policies — membership-scoped SELECT, client-publish INSERT denied `with check (false)`). Accepted LOW residuals: LOW-1 — hosted broadcast delivery observed lossy/variable during acceptance (3/6 within 25 s; triggers persisted 6/6) — accepted because correctness is independent of realtime (invalidation-only messaging, authoritative refetch, always-on 15-second polling fallback, reconnect/re-entry refetch); delivery is NOT guaranteed and is not claimed to be. LOW-2 — the deployed staging frontend remained at the pre-IMP-062 revision `213b5b1` during hosted acceptance; full deployed-frontend UI acceptance was not performed and is not a normative IMP-062 closure requirement (the strongest authorized hosted integration verification ran the real committed application modules unmodified against hosted staging); any later staging frontend deployment remains a separate explicitly authorized action. LOW-3 — the IMP062-R1/R2/R3 + H2/H3 rulings were previously carried only in the evidence chain — RESOLVED by this durable closure record. Closure-stage evidence (external evidence store, per convention — filenames, not repository paths): hosted acceptance `imp062-hosted-staging-acceptance-20261002T1806Z.md` (SHA256 a748a6be57b866c76845618180dc081706666791acb5bb9ff9cfc82b43ff3653); independent closure-readiness review `imp062-independent-closure-readiness-review-20261002T1825Z.md` (SHA256 7e3127aeffc06bfd7aa9786fbd016104bd18060bd07b99faa1392a5516984adc). Production untouched; no production verification claimed. **Next package:** IMP-070 — Fixture demo preservation & adapter completion (NOT STARTED, NOT AUTHORIZED) — SUPERSEDED: IMP-070 has since been implemented and CLOSED (see below).

- **IMP-070 closure record (package CLOSED 2026-10-03 — human closure-documentation authorization; closure durability Git commit/push NOT yet performed — pending explicit human authorization):** IMP-070 — Fixture demo preservation & adapter completion — COMPLETE/CLOSED: dual-mode data layer validation completed; fixture demo preservation proven (fixture content unchanged; fail-closed DATA_SOURCE and no-fixture-fallback invariants re-verified); Supabase/fixture adapter parity validated; executable fixture→production mapping validator (`scripts/validation/mapping-validation.mjs`) plus the committed mapping validation report (`docs/mapping-validation-report.md`); TEST-MIG disposition matrix recorded — EXECUTED LOCALLY 02/04/09/12/15, REUSED/REVERIFIED 01/03/06/07/08/10, CONDITIONAL 13, DEFERRED TO IMP-071 11/14 plus the staging legs of 12/15, PHASE-E/LATER 05 plus the bundle-level leg of 07; bounded Harness migration-validation phase added (`tests/integration/migration/`, `npm run test:migration`); import-boundary non-vacuity hardening. Implementation checkpoint 1eb3559722fd60f912760a3fbebb61468eee049e `feat: complete dual-mode data layer validation` (2026-10-03 — exactly one commit, 12 files), pushed to origin/staging under explicit human authorization (server ref verified). NO migration, NO schema/RLS/RPC/realtime change, NO fixture content change, NO spec change; catalog invariants unchanged (tables 24, RLS 24/24, FORCE RLS 20, policies 51). Correction history: the first formal Harness run found HIGH-1 (statutory-pending cleanup deleted seeded SYS_ITR_VERSION audit evidence — test isolation); the correction narrowed cleanup to test-owned rows with baseline capture/restore assertions; the formal Harness rerun PASSED (29 artifact records; migration-validation 61/61); HIGH-1 is RESOLVED. Verification chain: runtime verification PASS; formal Harness PASS; independent security review PASS (CRITICAL/HIGH/MEDIUM = 0; LOW=4, INFO=4); Human Acceptance ACCEPTED_WITH_EXPLICIT_RESIDUALS; hosted staging acceptance PASS_WITH_LIMITATION (Netlify authoritative; `staging.caos.datafabric.in` read-only anonymous GET/HEAD shell/asset/SPA checks PASS; limitations: authoritative fixture-demo URL NOT found, deployed commit NOT independently verifiable read-only — revision UNKNOWN/LIMITED; no pixel-perfect hosted fixture-demo verification claimed; no hosted/Supabase/Netlify mutation; production untouched). Checkpoint provenance (process history, not a product defect): the Git checkpoint was explicitly human-authorized but executed under PRIMARY instead of HUMAN-GATE due to a role-assignment/process mistake; history intentionally NOT rewritten; the push was performed under HUMAN-GATE after explicit human authorization; checkpoint contents/scope verified before push. Accepted residuals (NOT resolved): LOW-1 barrel-regex parser hardening opportunity; LOW-2 FIXTURE_MODULE_PATHS completeness hardening opportunity; LOW-3 embedded-spec-copy drift hardening opportunity; LOW-4 statutory-pending cleanup ownership could be further constrained; INFO-1 `--check-report` is a drift guard, not authenticity proof; INFO-2 adapter parity null/empty tolerance, subscribe methods not exercised; INFO-3 TEST-MIG-03 substance discharged by TEST-MIG-12 per contract; INFO-4 MIG-OQ-02 wording inconsistency deferred documentation cleanup. Production untouched. **Next package:** IMP-071 — Staging deployment & verification (NOT STARTED, NOT AUTHORIZED).

All existing OPEN / PROVISIONAL items remain governed by their documented
future gates (see `12` Open / Provisional Dependency Matrix); this gate
result resolves none of them.

## Purpose

Master index for the CAOS specification set. Defines the document map,
authoring order, requirement-ID conventions, shared glossary, and per-document
status tracking. This file is maintained throughout Phase 2 and updated as
documents move through review.

## Scope

- The complete specification set for the Supabase-backed production
  architecture, scoped to what Release 0 ("staff-side operational core on
  Supabase") requires, with placeholders for later releases.
- Authoring batches and dependency order as approved in the Phase 2 plan.

## Non-goals

- This file contains no product, schema, or security requirements of its own.
  It is a map and a tracker, not a specification.
- It does not restate PRD content; the PRD (`docs/input/PRD.txt`) remains the
  authoritative source of product intent.

## Source documents

| Document | Role |
|---|---|
| `docs/input/PRD.txt` | Authoritative product intent (v0.1, read in full) |
| `AGENTS.md` | Current repository state (fixture demo track + Supabase Release-0 track through IMP-070 — CLOSED 2026-10-03) |
| Phase 1 analysis (chat, accepted) | Working PRD-to-code analysis and gap list |
| Phase 1.5 decisions (chat, approved with clarifications) | Architecture decisions A–T |

## Specification map

| # | File | Title | Batch | R0 gate | Status |
|---|---|---|---|---|---|
| 00 | `00-index.md` | Specification Index | 1 | yes | Approved |
| 01 | `01-decisions.md` | Architecture Decision Register | 1 | yes | Approved |
| 02 | `02-domain-model.md` | Domain Model | 2 | yes | Approved (Batch 2; Batch 3 targeted amendments approved) |
| 03 | `03-tenancy-environments.md` | Tenancy & Environments | 2 | yes | Approved (Batch 2) |
| 04 | `04-authentication.md` | Authentication | 2 | yes | Approved (Batch 2) |
| 05 | `05-authorization-rls.md` | Authorization & RLS (authoritative for authz) | 3 | yes | Approved (architecture; Batch 4 security closure amendment approved; **DEC-J resolved 2026-09-01 — live membership lookup, IMP-004**) |
| 06 | `06-database-schema.md` | Database Schema (design; no SQL) | 3 | yes | Approved (architecture; Batch 4 closure + security closure amendments approved; **IMP-050 architecture amendment 2026-09-11 adds SCH-33/34/35 contracts — amendment APPROVED 2026-09-12 (human diff review passed)**) |
| 07 | `07-api-contract.md` | API Contract (`@/data` mapping) | 4 | yes | Approved (Batch 4) |
| 08 | `08-audit-security.md` | Audit & Security | 3 | yes | Approved (architecture; Batch 4 security closure amendment approved; **AUD-OQ-02 resolved 2026-09-01 — layered A+B+C audit-context propagation, IMP-005**) |
| 09 | `09-automation-events.md` | Automation & Events | 4 | recurrence section only | Approved (Batch 4; **IMP-050 architecture amendment 2026-09-11: AUTO-OQ-01/02/03 resolved, AUTO-SCH-02 PASS — amendment APPROVED 2026-09-12 (human diff review passed)**) |
| 10 | `10-migration-seed.md` | Fixture Migration & Seeding | 4 | yes | Approved (Batch 4) |
| 11 | `11-testing-harness.md` | Testing & Verification Harness | 5 | yes | Approved (Batch 5) |
| 12 | `12-release-0-plan.md` | Release 0 Execution Plan | 6 | yes | Approved (Batch 6) |
| 13 | `13-operations-observability.md` | Operations & Observability (R0 scope) | 5 | yes | Approved (Batch 5) |
| 20 | `20-ai-services.md` | AI Service Abstraction (placeholder) | later | no | Not started |
| 21 | `21-portal.md` | Client Portal (placeholder) | later | no | Not started |

## Dependency / authoring order

```
00-index ──► 01-decisions
      ──► 02-domain-model, 03-tenancy-environments
      ──► 04-authentication
      ──► 06-database-schema
      ──► 05-authorization-rls (finalize), 08-audit-security
      ──► 07-api-contract, 09-automation-events, 10-migration-seed
      ──► 11-testing-harness
      ──► 13-operations-observability
      ──► 12-release-0-plan
```

Notes on ordering (per approved plan):

- The role/permission matrix in `05` may begin before `06`, but table-specific
  RLS design is not finalized until `06-database-schema.md` exists.
- `05-authorization-rls.md` is the single source of truth for authorization
  and RLS requirements. `06-database-schema.md` references RLS requirement IDs
  per table and must not duplicate policy definitions.

## Review cadence (approved)

| Batch | Files | Gate |
|---|---|---|
| 1 | 00, 01 | stop for approval |
| 2 | 02, 03, 04 | stop for approval |
| 3 | 06, 05, 08 | stop for approval |
| 4 | 07, 09, 10 | stop for approval |
| 5 | 11, 13 | stop for approval |
| 6 | 12 | final spec-gate approval |

Release 0 implementation begins only after (a) all R0-gate specs are approved
and (b) the testing harness per `11` is implemented and green (harness gate).
Both conditions are satisfied: Final Spec Gate PASS 2026-08-31; Harness Gate
PASS — human approved 2026-09-01 (evidence commit `305d133`).

## Requirement-ID conventions

- Each spec owns a prefix: `IDX` (00), `DEC` (01), `DM` (02), `TEN` (03),
  `AUTH` (04), `RLS` (05), `SCH` (06), `API` (07), `AUD` (08), `AUTO` (09),
  `MIG` (10), `TEST` (11), `REL` (12), `OPS` (13), `AI` (20), `PORT` (21).
- IDs are assigned sequentially within a document (`RLS-CLI-01`, `SCH-07`, …)
  and are never reused or renumbered after a batch is approved; superseded
  requirements are marked `Superseded by <ID>`.
- Security, money, tenant-isolation, and audit requirements must reference a
  verification requirement in `11-testing-harness.md` (`TEST-*`).
- Cross-references use the form `see RLS-CLI-01`, never quoted policy text.

## Required structure for every specification

Status · Purpose · Scope · Non-goals · Requirement IDs · Assumptions ·
Open Questions · Acceptance criteria · Dependencies · Consequence of change ·
Approval status. Open questions must never be silently resolved.

## Glossary

| Term | Meaning |
|---|---|
| Firm | A CA practice; the tenant root. Every operational row belongs to exactly one firm |
| Client | Commercial relationship with a customer of the firm; may group several legal entities |
| Legal entity | A company, LLP, individual, trust, HUF etc. owned by a client |
| Registration | A statutory identifier (PAN, GSTIN, TAN, CIN, DIN) of a legal entity |
| Compliance type | A rule object describing an obligation class (GSTR-3B, TDS, …) |
| Compliance instance | One obligation for one legal entity for one period, with a 10-state lifecycle |
| Task | An execution activity; optionally linked to a compliance instance |
| Review item | A unit of work awaiting reviewer decision; R0 lifecycle `pending → approved / returned / escalated / dismissed` (DM-SM-06) |
| Fixture mode | The existing in-memory demo data layer, retained as a parallel data source |
| Harness | The automated verification stack (unit, RLS policy, E2E, CI) |
| R0 | Release 0: staff-side operational core on Supabase (scope per `01-decisions.md` DEC-T) |

## Assumptions

- The reader has access to the PRD and the Phase 1 / Phase 1.5 accepted
  analyses; specs reference them instead of repeating them.
- All specification work happens before any implementation; conflicting
  information discovered later is recorded as an open question, not edited
  silently.

## Open Questions

| ID | Question | Needed by |
|---|---|---|
| IDX-OQ-01 | Should approved spec documents additionally record an approval date/approver line in-file, or is the chat approval record sufficient? | Batch 2 |

## Acceptance criteria

- IDX-01: Every planned specification is listed with batch, gate status, and status.
- IDX-02: The authoring order matches the approved Phase 2 plan exactly.
- IDX-03: Requirement-ID prefixes are defined and unique per document.
- IDX-04: The RLS single-source-of-truth rule (05 authoritative, 06 references IDs) is stated.

## Dependencies

None (first document). All other specs depend on this index.

## Consequence of change

Renumbering files or changing prefixes after batches are approved breaks
cross-references across the entire spec set; treat both as frozen after the
containing batch is approved.
