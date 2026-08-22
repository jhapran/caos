# 01 — Architecture Decision Register

- **Status:** Draft (Batch 1 — awaiting approval)
- **Approval status:** Not approved

## Purpose

Single register of the architecture and scope decisions approved in Phase 1.5
(decisions A–T, with the requester's clarifications). Every downstream
specification must conform to these decisions; a spec that cannot conform must
raise an open question rather than deviate silently.

## Scope

- Decisions A–T exactly as approved, including clarifications and deferrals.
- Consequence-of-change notes per decision to inform future re-litigation.

## Non-goals

- No new decisions are made here. Items explicitly deferred by the approver
  are recorded as deferrals, not resolved.
- No implementation detail beyond what the approver stated (field-level
  design belongs to later specs).

## Requirements (the decisions)

Each decision is a requirement with ID `DEC-<letter>`.

### DEC-A — Frontend: React + Vite SPA retained

Keep the existing React 19 + Vite single-page application. No Next.js
migration. Server-side needs are served by Supabase (PostgREST/RPC) and Edge
Functions.

- **Rationale:** No SSR/SEO requirement behind auth; the existing polished UI
  and build/lint verification are preserved; rewrite risk is avoided.
- **Consequence of change:** High — replacing the framework later is a full
  frontend rewrite of routing, data fetching, and deploy config; the `@/data`
  contract and Supabase schema survive unchanged.

### DEC-B — Production backend: Supabase

Supabase is the production backend: PostgreSQL, Auth, RLS, Storage, Edge
Functions where justified, Realtime only where justified. This supersedes the
PRD's generic Node/Python/Azure suggestion (§119–121) for the application
backend; external AI/integration services are still called from Edge
Functions.

- **Consequence of change:** High — auth, RLS, storage, and realtime are
  platform-shaped. The plain-Postgres schema and the `@/data` UI contract are
  portable; the security and job layers would need rebuilding elsewhere.

### DEC-C — AI: provider-neutral abstraction, provider selection deferred

A provider-neutral AI service abstraction is approved. **No AI provider is
selected or hard-coded.** Provider selection is explicitly deferred. Release 0
contains no real AI functionality (see DEC-T exclusions), so only the
abstraction boundary is specified in Phase 2 (placeholder `20-ai-services.md`).

- **Consequence of change:** Low if the abstraction holds — provider swap is
  an Edge Function change. High only if code calls provider SDKs directly.

### DEC-D — Environments: local CLI + staging + production

- Local development via Supabase CLI with migrations in git.
- One separate staging Supabase project.
- One separate production Supabase project.
- Preview branches deferred until PR volume justifies them.
- Staging and local environments must never hold real client data.

- **Consequence of change:** Low — migrations are portable; adding branches
  later is additive.

### DEC-E — Multi-tenancy: shared schema + RLS

Shared-schema tenancy. Every tenant-owned operational table carries
`firm_id`; RLS is the isolation mechanism. System/global tables may be
exceptions only where explicitly documented (in `03-tenancy-environments.md`
and `06-database-schema.md`).

- **Consequence of change:** Very high — re-keying every table and rewriting
  every policy. Frozen unless extraordinary cause arises.

### DEC-F — Domain hierarchy: Client → LegalEntity → Registration

Strict three-level ownership: a client (commercial relationship/group) owns
legal entities; registrations attach to legal entities. Every client has at
least one legal entity (default entity created at onboarding).

- **Consequence of change:** High — Client 360, applicability, documents, and
  portal scoping all key off this shape.

### DEC-G — Compliance instance ownership

`compliance_instances.legal_entity_id` is **required**;
`registration_id` is **optional** (registration-scoped compliances such as
per-GSTIN GST filings or per-TAN TDS returns).

- **Explicitly NOT resolved:** the per-compliance-type registration-scoping
  conventions. These must be defined in `02-domain-model.md` /
  `06-database-schema.md` and reviewed (with CA-domain input where needed)
  before being treated as settled.

### DEC-H — Tasks: instance-linked and ad-hoc

Both compliance-instance-linked tasks and first-class ad-hoc tasks are
approved. `tasks.compliance_instance_id` is nullable.

- **Consequence of change:** Low-medium — tightening later is a constraint
  change, not a remodel.

### DEC-I — Authentication

- **Staff:** email/password and/or magic link; MFA (TOTP) required according
  to role/security policy (privileged roles at minimum — policy defined in
  `04-authentication.md`).
- **Client portal:** email OTP initially (see DEC-Q). Portal is not built in
  Release 0 (DEC-K).
- Staff SSO (Entra ID / Google) and SCIM are enterprise-phase items, out of
  R0 scope.

### DEC-J — Authorization: RLS is the enforcement boundary; mechanism via spike

RLS is the enforcement boundary. **Neither JWT-claims-only nor
membership-lookup-only is permanently selected.** `05-authorization-rls.md`
must design both approaches and include a small technical spike to validate
the final choice; the spike outcome is recorded in that spec before Batch 3
is considered complete.

- **Consequence of change:** Medium — policy bodies change, schema does not.

### DEC-K — Client Portal: excluded from Release 0; first scope defined

The Client Portal is **not** part of Release 0. When implemented, its first
scope is: email OTP login, Action Required home, requested-document upload,
simple compliance status, completed-deliverable downloads. Deferred:
native payments, advanced approvals, activity-feed polish.

### DEC-L — My Work: basic experience approved for Release 0

My Work ships in R0 with: Today, This Week, Waiting, Returned groupings and
an explicit next action per item. Workload recommendation intelligence is
deferred.

### DEC-M — Billing: native billing deferred

Native billing is deferred. Early releases may support read-only/imported
receivables (feeding alerts and the Morning Brief). The native-billing
decision is revisited at the Release 1/2 boundary.

### DEC-N — Scheduling: hybrid pg_cron + Edge Functions

Working architecture: pg_cron / database jobs for DB-native cycles, invoking
Edge Functions (e.g. via `pg_net`) when actions leave the database. Exact
implementation is finalized in `09-automation-events.md`. Release 0 needs the
recurrence cycle only.

### DEC-O — Audit: hybrid capture, immutable log

Approved direction:

- DB triggers capture old/new values for data changes.
- The request/application layer supplies IP and user-agent context.
- The audit log is immutable and append-only.

The exact propagation mechanism (e.g. per-request GUC context vs RPC wrapper)
is finalized in `08-audit-security.md`.

### DEC-P — Region: Mumbai default; provisioning requires human confirmation

Engineering default: production project in the Mumbai region. **Production
project provisioning requires explicit human confirmation after
contractual/legal/data-residency review.** Nothing is provisioned from this
repository without that confirmation.

### DEC-Q — Portal OTP: email

Client portal authentication uses email OTP initially. SMS/WhatsApp OTP are
later, additive options riding the WhatsApp Business integration phase.

### DEC-R — Document security model

Approved: private buckets; tenant-scoped paths
(`{firm_id}/{client_id}/...`); short-lived signed URLs; audited URL issuance;
quarantine-to-verified upload workflow. **Note:** documents are excluded from
Release 0 (DEC-T); this decision binds Release 1 design and is recorded now
because it shapes the audit model (URL-issuance logging) and storage layout.

### DEC-S — Testing harness before backend migration

Approved stack: Vitest, React Testing Library, Supabase/RLS policy tests,
minimal Playwright E2E. **The verification harness must exist and be green
before substantial backend migration begins** (harness gate).

### DEC-T — Release 0 scope: staff-side operational core on Supabase

**Included:**

1. Supabase development/staging/production foundation
2. Staff authentication
3. Firms and memberships
4. RBAC + RLS
5. Audit foundation
6. Testing and verification harness
7. Clients
8. Legal entities
9. Registrations
10. Contacts
11. Client 360 core
12. Compliance types
13. Compliance profiles
14. Compliance instances
15. Recurrence model
16. Tasks
17. Ad-hoc tasks
18. My Work
19. Review queue with real persistence
20. Deadlines
21. Command Centre backed by real data
22. Morning Brief backed by real data
23. Structured global search
24. Fixture/demo mode retained as a parallel data source

**Excluded from Release 0:** Document Vault; document upload/storage
workflows; Client Portal; automated reminder engine; external email sending;
WhatsApp; real AI functionality; pgvector/RAG; native billing; advanced
integrations.

## Assumptions

- DEC-* IDs are stable; downstream specs cite them (e.g. "per DEC-E") rather
  than restating rationale.
- Where the approver's clarification narrowed an earlier recommendation
  (C, G, J, K), the clarification text above is authoritative.

## Open Questions

| ID | Question | Needed by |
|---|---|---|
| DEC-OQ-01 | DEC-I: which exact roles are "privileged" for mandatory MFA (partner + super_admin + billing proposed) — confirm in Batch 2 | `04-authentication.md` |
| DEC-OQ-02 | DEC-N: is `pg_net` acceptable as the DB→Edge Function invocation mechanism, or should the spike in Batch 4 also evaluate a queue table poller? | `09-automation-events.md` |
| DEC-OQ-03 | DEC-T item 24: does fixture/demo mode remain the Netlify production deploy's default data source until a later release, with Supabase mode enabled per-environment? | `10-migration-seed.md` |

## Acceptance criteria

- DEC-ACC-01: All twenty decisions A–T are recorded with the approver's
  clarifications verbatim in substance.
- DEC-ACC-02: Explicit deferrals (AI provider, authz mechanism,
  registration-scoping conventions, native billing, SSO) are recorded as
  deferrals with an owning spec.
- DEC-ACC-03: Every decision carries a consequence-of-change note.
- DEC-ACC-04: No decision in this register contradicts the Phase 1.5 approval
  message; any ambiguity is listed under Open Questions.

## Dependencies

- Upstream: Phase 1 analysis; Phase 1.5 decision approval message.
- Downstream: every other specification (02–13, 20, 21).

## Consequence of change

Changing any DEC-* after its dependent batches are approved invalidates those
batches' specs and requires re-review of the affected documents; the change
must be recorded here as a superseding requirement rather than an edit.
