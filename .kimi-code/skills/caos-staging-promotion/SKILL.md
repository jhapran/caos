---
name: caos-staging-promotion
description: Promote one human-approved CAOS package to hosted Supabase staging and run authenticated adversarial acceptance without credential discovery or production impact.
type: prompt
whenToUse: Only when the user explicitly authorizes hosted Supabase staging migration, hosted adversarial probes, or the staging database acceptance gate for an approved CAOS package.
disableModelInvocation: true
arguments:
  - package_id
---

# CAOS Hosted Supabase Staging Promotion

This Skill is manually invoked only after explicit human authorization for
`$package_id`. If hosted staging promotion is not explicitly authorized, STOP.

## Local preflight

Mechanically verify:

- CAOS app root;
- branch;
- exact full/short HEAD;
- expected parent/checkpoint;
- commit message;
- clean worktree;
- package migration(s) committed in HEAD.

Never use a SHA copied from chat when Git can provide it.

## Environment identity

Mechanically read the linked Supabase project ref and compare it to the approved
STAGING environment record.

If identity differs or is uncertain: STOP.

Production is not authorized by this Skill.

## Remote baseline and dry-run

Before mutation:

1. list remote migration history;
2. verify accepted baseline;
3. run supported dry-run;
4. require exactly the approved package migration set pending.

Any extra/missing/unrelated migration: STOP. Do not silently repair drift.

## Apply source-of-truth migrations only

Use the repository's supported linked Supabase mechanism.

Never discover management/service credentials, scrape keyrings, or
generate/change DB passwords. If the authorized session cannot apply, STOP.

## Post-migration catalog

Verify expected:

- migration ledger;
- tables;
- RLS;
- FORCE RLS;
- policies;
- grants;
- indexes/constraints;
- RPC signatures;
- SECURITY DEFINER posture and EXECUTE grants.

Do not mutate catalog just to match counts.

## Hosted authenticated acceptance

Use supported authenticated browser-equivalent sessions of dedicated synthetic
staging identities.

Privileged SQL may be used for:

- catalog;
- deterministic application-domain setup;
- teardown;
- read-only verification.

It is not proof for RLS visibility, write denial, RPC authorization,
API-ERR-02, same-JWT freshness or four-eyes.

Never create hosted identities by direct `auth.users`/`auth.identities` writes.
Never touch protected MFA.

If the role matrix cannot be authenticated safely: STOP.

## Adversarial matrix

As applicable, prove:

- allowed/denied roles;
- cross-firm isolation;
- direct browser write closure;
- controlled RPC success/denial;
- server-derived actor/firm/client/subject;
- forged bindings rejected;
- four-eyes/self-review/rank-bypass;
- hidden-existing vs nonexistent equivalence;
- authorization before vocabulary/lifecycle/replay;
- valid lifecycle;
- illegal-state atomic rollback;
- replay without duplicate side effects;
- audit/no double logging;
- same-JWT membership freshness.

Synthetic data only; no real customer data.

## Cleanup

Delete only temporary application-domain probe rows in safe FK order.

Never delete audit history, protected users/memberships/MFA, or unrelated
reference/statutory data. Restore synthetic membership changes exactly.

Reverify baseline and catalog.

## Boundary

Unless separately authorized, do not:

- push Git;
- move `origin/staging`;
- deploy Netlify;
- run deployed-browser acceptance;
- update current-state;
- close package.

## Report

Return exact implementation SHA, staging project ref, migrations before/dry-run/
after, catalog/grant/RPC posture, identities/provisioning mechanism, explicit
confirmation of no auth-schema manufacturing/MFA mutation, adversarial results,
advisor results if run, cleanup, untouched Git/Netlify/current-state, and final
status:

`SUPABASE STAGING ACCEPTED` or `BLOCKED`

STOP.
