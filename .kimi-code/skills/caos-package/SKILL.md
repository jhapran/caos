---
name: caos-package
description: Manually execute exactly one authorized CAOS package phase while preserving repository-driven evidence and human gates between contract, implementation, Git, hosted staging, browser acceptance and closure.
type: flow
arguments:
  - package_id
  - phase
---

```mermaid
flowchart TD
    A([BEGIN]) --> B["Determine the CAOS app root mechanically. Read AGENTS.md, docs/harness/current-state.md, docs/spec/12-release-0-plan.md, the exact $package_id package definition, relevant owning specs, Git branch/HEAD/status, and current implementation/tests. Repository evidence overrides chat narration. Do not mutate anything in this node."]
    B --> C{"Requested phase is '$phase'. Is it explicitly authorized by the user's current instruction and one of contract, implement, checkpoint, hosted, browser, close, status?"}

    C -->|contract| D["CONTRACT ONLY for $package_id. Extract exact dependencies, requirement IDs, TEST IDs, schema/API/RLS/audit contracts, role matrix, allowed scope, non-goals, file surface, migration expectation, open decisions, acceptance criteria, human gates and Git checkpoint. Reconcile contradictions against owning specs. Do not implement. If a blocking decision is unresolved, STOP. End contract-ready and request human approval before implementation."]
    D --> Z([END])

    C -->|implement| E["IMPLEMENTATION ONLY for $package_id. Require approved contract and explicit implementation authorization. Follow SPEC→IMPLEMENT→TEST→VERIFY→FIX→RETEST→REVIEW. Preserve React→@/data→adapter, RLS authority, API-ERR-02, hardened definer commands, audit and no-scope-widening as applicable. Run affected tests, required integration/E2E, lint/build/diff check and full Harness Gate required by repository. Do not commit/push/migrate/deploy/current-state. End READY FOR HUMAN IMPLEMENTATION APPROVAL or BLOCKED."]
    E --> Z

    C -->|checkpoint| F["LOCAL GIT CHECKPOINT ONLY for $package_id. Require explicit human approval. Verify branch/HEAD/parent/cleanliness/full diff. Stage exact approved files explicitly; never git add -A. Verify cached name-status/diff-check/secrets/generated files. Commit exact authorized message. Do not amend or push unless separately authorized. Verify parent/message/clean tree. End COMMITTED LOCALLY."]
    F --> Z

    C -->|hosted| G["HOSTED SUPABASE STAGING ONLY for $package_id. Require explicit human staging authorization and approved local implementation commit. Verify exact Git SHA, linked approved STAGING project, remote baseline and dry-run. Apply only approved pending migration set using supported linked mechanisms. No credential/keyring discovery, DB-password rotation, auth-schema manufacturing or protected MFA mutation. Prove RLS/RPC via supported synthetic authenticated users; privileged SQL is catalog/setup/teardown, not RLS proof. Clean temporary domain data, retain immutable audit. Do not push/deploy/current-state unless separately authorized. End SUPABASE STAGING ACCEPTED or BLOCKED."]
    G --> Z

    C -->|browser| H["STAGING APPLICATION/BROWSER ACCEPTANCE ONLY for $package_id. Require explicit deployment/browser authorization and accepted hosted staging. Mechanically prove approved implementation SHA, origin/staging SHA and deployed staging SHA as required by current gate. Use supported Git/hosting sessions; never discover tokens. Test real staging URL with synthetic identities: provider truthfulness, role UI, RLS-backed behavior, non-optimistic commands, realtime if contracted, console/network isolation, no production/local API leakage. Clean temporary domain fixtures, retain audit. Do not patch implementation or close package. End ACCEPTED or BLOCKED."]
    H --> Z

    C -->|close| I["PACKAGE CLOSURE ONLY for $package_id. Require explicit human closure approval and mechanically verify local implementation, hosted staging acceptance and deployed-browser acceptance. Update only governance/status artifacts required by current-state conventions; do not rewrite historical specs unless expressly required. Recompute formal package count mechanically. Run checks, create exact authorized closure commit, verify clean tree and report next package. Do not start it automatically."]
    I --> Z

    C -->|status| J["STATUS ONLY for $package_id. Make no changes. Mechanically report Git state, contract/implementation/hosted/browser/closure gate states, migration/catalog evidence available in repository, unresolved blockers and exact next human-authorized action. Never infer completion from chat."]
    J --> Z

    C -->|unauthorized-or-invalid| K["STOP. Phase absent, invalid or not explicitly authorized. Report allowed phase names and missing authorization. Make no changes."]
    K --> Z
```

# Flow invariants

- One bounded IMP package at a time.
- Specs/code/tests/Git are authoritative.
- No silent redesign or deferred-scope implementation.
- React → `@/data` → adapter is permanent.
- RLS/server commands authorize; UI hiding does not.
- Authorization before disclosure/lifecycle/replay where required.
- No privileged rank bypass of four-eyes reviewer rules.
- No keyring scraping, secret printing, DB-password rotation, hosted auth-schema
  manufacturing, protected MFA mutation or global audit deletion.
- Production is forbidden unless separately invoked through explicit Release-0
  production gates.
- Never cross a human gate because the prior phase is green.
