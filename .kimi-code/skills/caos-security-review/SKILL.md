---
name: caos-security-review
description: Perform an adversarial CAOS security review of schema, RLS, RPCs, audit, tenant isolation, auth, data adapters and UI truthfulness before approval.
type: prompt
whenToUse: When reviewing a CAOS package, migration, RLS policy, SECURITY DEFINER RPC, audit behavior, auth flow, cross-tenant access, four-eyes workflow, or staging acceptance evidence.
disableModelInvocation: false
arguments:
  - package_id
---

# CAOS Security Review

Review `$package_id` as an independent security reviewer. Do not implement
changes unless separately authorized.

## Ground the review

Determine the CAOS app root, then read:

- `AGENTS.md`
- `docs/harness/current-state.md`
- `$package_id` in `docs/spec/12-release-0-plan.md`
- owning tenancy/auth/RLS/schema/API/audit/migration/testing/ops specs
- the full package diff
- migrations, tests and Harness evidence

Treat repository evidence as authoritative.

## Tenant isolation

Check:

- tenant rows tie to correct firm;
- same-firm composite FKs;
- cross-firm references structurally rejected;
- active-firm selector is context only;
- live membership/status/role checked at request time;
- manager/assignee/reviewer scope matches contract;
- same-JWT suspension/removal freshness where required.

## RLS and grants

Check:

- RLS enabled as required;
- FORCE RLS on required tenant content tables;
- exact role matrix;
- least-privilege browser grants;
- no accidental anon access;
- direct controlled writes closed;
- UI hiding never treated as security.

## SECURITY DEFINER / commands

For every command:

- authorize before object disclosure;
- authorize before vocabulary/lifecycle/replay disclosure;
- hidden-existing and nonexistent no-leak behavior where required;
- hardened `search_path`;
- qualified object references;
- caller cannot forge actor/firm/client/subject fields;
- minimal EXECUTE grants;
- atomic business mutation + side effects + audit.

## Four-eyes

Check:

- prohibited self-review is impossible;
- no super_admin/partner/manager rank bypass where assigned reviewer is required;
- live membership is used;
- linked authority is the intersection of all required authorizations;
- illegal linked transition rolls back fully.

## API-ERR-02 / replay

Compare existing-hidden vs nonexistent UUIDs.

Then probe hidden items with:

- invalid vocabulary;
- illegal lifecycle;
- invalid/blank rationale;
- mutation keys.

No hidden state may leak.

Replay must authorize first and produce no duplicate side effects/audit.

## Audit

Check:

- server-derived actor and correct firm/object;
- old/new snapshots as contracted;
- security-significant denial audit where required;
- nonexistent objects do not get fabricated object audit;
- no Layer-A/Layer-B duplicate logical mutation;
- immutable audit is never globally cleaned;
- linked side-effect audit is preserved.

## Auth/secrets blockers

Block any attempt to:

- scrape credential stores;
- expose management/service-role/JWT/password/TOTP material;
- manufacture hosted Auth users with direct auth-schema SQL;
- modify protected MFA for tests;
- rotate DB passwords for probes;
- use real customer data in staging.

## Data boundary / truthfulness

Check:

- components use `@/data`, not Supabase directly;
- adapters use browser-safe configuration;
- fixture/Supabase implementations honor one provider-neutral contract;
- Supabase mode exposes no fixture facts as live data;
- role controls are truthful but not relied on for security;
- failures are non-optimistic and provider-neutral.

## Adversarial evidence expected

As applicable:

- allowed and denied roles;
- cross-tenant;
- hidden-existing vs nonexistent;
- direct table write attempts;
- self-review/rank bypass;
- same-JWT suspension;
- subject/client/instance/task forgery;
- illegal transition rollback;
- mutation-key replay;
- duplicate audit/comment/event prevention;
- Supabase-mode UI truthfulness.

Privileged SQL may verify catalog/setup/teardown, but is not RLS proof.

## Verdict format

### Verdict
`APPROVE`, `REQUEST CHANGES`, or `BLOCKED`

### Blocking findings
For each: severity, violated contract, exact evidence, failure/exploit mode,
minimum remediation.

### Non-blocking findings
Only safely deferrable items.

### Verified controls
Mechanically proven controls only.

### Test/evidence gaps
Missing adversarial coverage.

### Scope/truthfulness check
Any adjacent/deferred feature or fixture leak.

Approve only what repository evidence proves.
