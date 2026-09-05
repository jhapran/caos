---
name: caos-package-engineering
description: Execute or review one bounded CAOS IMP package using approved specs, the provider-neutral data boundary, Harness Gate, human approvals, and repository-as-source-of-truth discipline.
type: prompt
whenToUse: When implementing, continuing, reviewing, testing, or planning a CAOS Release-0 IMP package, or reconstructing package scope and acceptance criteria from the repository.
disableModelInvocation: false
arguments:
  - package_id
---

# CAOS Package Engineering

Work on package `$package_id` only. If `$package_id` is absent, identify the
package from the user's explicit instruction; never infer a different package.

## Establish repository truth first

1. Determine the CAOS application root mechanically:
   - if `AGENTS.md` and `docs/spec/` exist in the current directory, use it;
   - otherwise, if `app/AGENTS.md` and `app/docs/spec/` exist, use `app/`;
   - do not assume paths from chat.
2. Read `AGENTS.md`.
3. Read `docs/harness/current-state.md`.
4. Read `docs/spec/12-release-0-plan.md`, including the exact `$package_id`
   definition: dependencies, allowed scope, non-goals, requirement IDs, TEST
   IDs, entry/acceptance criteria, human approval, Git checkpoint, rollback.
5. Read the owning source specs referenced by that package.
6. Mechanically inspect Git branch, HEAD, parent, status, diff and recent log.
7. Inspect current implementation/tests in the package's expected areas.

Specs, code, migrations, tests and Git history are authoritative. Model memory,
chat narration and pasted SHAs are not substitutes for mechanical verification.

## Preserve the package boundary

- One bounded package at a time.
- No silent scope widening.
- Do not implement deferred packages or adjacent features for convenience.
- Do not redesign approved architecture inside implementation.
- Open/provisional questions stay open until their declared decision gate.
- If a required decision is missing/contradictory, STOP and report it.
- Do not edit `docs/spec/` unless explicitly authorized for a spec/contract step.
- Do not update `docs/harness/current-state.md` during ordinary implementation.
- Do not create a second migration merely to repair an uncommitted first
  migration; fix the uncommitted migration unless a crossed boundary requires
  a forward migration.

## Permanent data architecture

```text
React component
    ↓
@/data domain service
    ↓
fixture adapter OR Supabase adapter
```

Enforce:

- Components never execute Supabase queries directly.
- Data-source selection stays in the approved boundary; no fixture fallback.
- Provider errors do not leak past adapters.
- UI visibility is not authorization; PostgreSQL RLS/server commands are.
- Fixture mode is demo-only.
- Supabase mode must not render fixture claims as live facts.

## Engineering loop

```text
SPEC
→ IMPLEMENT
→ TEST
→ VERIFY
→ FIX
→ RETEST
→ REVIEW
→ HUMAN APPROVAL
→ GIT CHECKPOINT
```

During implementation:

- choose the smallest complete solution satisfying the contract;
- add owning tests in the same package;
- run affected tests first;
- then package integration/E2E suites;
- run lint, build/typecheck and `git diff --check`;
- run the full Harness Gate when required;
- inspect full diff for debug residue, skipped tests, fixture leaks, direct
  Supabase component access, secrets and unrelated churn.

Never weaken or disable a failing test to make a gate green.

## Database discipline

For schema-bearing work:

- `supabase/migrations/` is the source of truth;
- local SQL/MCP experiments are not final implementation;
- preserve forward ordering and schema conventions;
- use same-firm composite FKs;
- enable/force RLS per the approved tenant-owned posture;
- keep browser grants least-privilege;
- close direct browser mutation of controlled lifecycle columns;
- harden SECURITY DEFINER functions with qualified objects, safe/empty
  `search_path`, minimal EXECUTE grants and server-derived actor/tenant fields;
- authorize before hidden-object, lifecycle, validation or replay disclosure;
- authorize before idempotent replay evaluation;
- preserve audit layering and avoid double logging.

## Identity/security rules

Never:

- scrape OS/Desktop keyrings;
- retrieve/print management tokens, service-role keys, JWT secrets, passwords,
  refresh/access tokens or TOTP material;
- generate/change hosted DB passwords;
- manufacture hosted Auth users by direct `auth.users`/`auth.identities` writes;
- mutate/delete protected human MFA;
- use privileged SQL as browser-RLS proof;
- globally delete audit history.

Hosted probes use supported synthetic identities. If credentials/roles are
unavailable, STOP and request human action.

## Human gates

Do not infer approval. Without explicit authorization, do not:

- create the implementation commit;
- amend;
- push;
- migrate hosted staging;
- change hosted Auth identities;
- deploy staging;
- update current-state/package completion;
- touch production.

Authorization for one boundary does not authorize the next.

## Handoff report

Report mechanically:

- package/branch/start HEAD;
- exact changed files and migrations;
- schema/RLS/grant/RPC/audit posture where applicable;
- tests and exact results;
- Harness Gate status;
- unresolved implementation/security/truthfulness gaps;
- Git status;
- whether commit/push/hosted/deployment/current-state occurred;
- next human gate.

If green but not approved, finish:

`READY FOR HUMAN IMPLEMENTATION APPROVAL — NO COMMIT YET`
