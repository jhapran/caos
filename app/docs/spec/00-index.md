# CAOS Specification Index

- **Status:** Approved
- **Approval status:** Approved (Batch 1)

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
| `AGENTS.md` | Current repository state (front-end-only implementation) |
| Phase 1 analysis (chat, accepted) | Working PRD-to-code analysis and gap list |
| Phase 1.5 decisions (chat, approved with clarifications) | Architecture decisions A–T |

## Specification map

| # | File | Title | Batch | R0 gate | Status |
|---|---|---|---|---|---|
| 00 | `00-index.md` | Specification Index | 1 | yes | Approved |
| 01 | `01-decisions.md` | Architecture Decision Register | 1 | yes | Approved |
| 02 | `02-domain-model.md` | Domain Model | 2 | yes | Approved |
| 03 | `03-tenancy-environments.md` | Tenancy & Environments | 2 | yes | Approved |
| 04 | `04-authentication.md` | Authentication | 2 | yes | Approved |
| 05 | `05-authorization-rls.md` | Authorization & RLS (authoritative for authz) | 3 | yes | Approved (architecture) |
| 06 | `06-database-schema.md` | Database Schema (design; no SQL) | 3 | yes | Approved (architecture) |
| 07 | `07-api-contract.md` | API Contract (`@/data` mapping) | 4 | yes | Not started |
| 08 | `08-audit-security.md` | Audit & Security | 3 | yes | Approved (architecture) |
| 09 | `09-automation-events.md` | Automation & Events | 4 | recurrence section only | Not started |
| 10 | `10-migration-seed.md` | Fixture Migration & Seeding | 4 | yes | Not started |
| 11 | `11-testing-harness.md` | Testing & Verification Harness | 5 | yes | Not started |
| 12 | `12-release-0-plan.md` | Release 0 Execution Plan | 6 | yes | Not started |
| 13 | `13-operations-observability.md` | Operations & Observability (R0 scope) | 5 | yes | Not started |
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
| Review item | A unit of work awaiting reviewer decision (approve/return/clarify) |
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
