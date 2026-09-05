---
name: caos-git-checkpoint
description: Create a human-approved CAOS local Git checkpoint safely with exact diff, staged-file, parent, secret and post-commit verification; never push unless separately authorized.
type: prompt
whenToUse: Only after the user explicitly approves a CAOS contract or implementation and asks for the corresponding local Git checkpoint.
disableModelInvocation: true
arguments:
  - package_id
---

# CAOS Local Git Checkpoint

This Skill may create a local commit only when the current user instruction
explicitly authorizes a checkpoint for `$package_id`. Otherwise STOP.

## Preflight

Mechanically record:

- branch;
- HEAD short/full;
- parent;
- recent log;
- working tree;
- unstaged/staged name-status;
- `git diff --check`.

Confirm expected branch and parent from repository/human instruction.

If unrelated changes or parent drift exist: STOP.

## Reconstruct approved file surface

Read package contract, current full diff and approved implementation report.

Classify every changed/untracked file as:

- approved implementation;
- approved test;
- approved migration;
- approved gate evidence;
- docs/spec/current-state explicitly authorized for this checkpoint;
- unrelated/generated/secret/probe output.

Reject accidental `.env*`, credentials, `test-results/`, `playwright-report/`,
probe output, debug dumps, unrelated formatting, unauthorized second migrations
and unauthorized docs/spec/current-state/AGENTS changes.

## Final diff review

Inspect for:

- console/debug residue;
- TODO/FIXME;
- `.only`/`.skip`;
- commented-out security;
- direct component Supabase access;
- fixture truthfulness leaks;
- service-role/secret usage;
- broad audit cleanup;
- destructive hosted/production commands;
- scope widening.

If code changed after accepted test/Harness evidence, rerun affected tests and
required full gate.

## Stage explicitly

Never use `git add -A`.

Stage the exact approved file list, then run:

```text
git diff --cached --name-status
git diff --cached --check
```

Cached set must exactly match the approved surface.

## Commit

Use the exact authorized commit message.

Do not amend unless explicitly authorized.

Create one local commit.

## Post-commit

Prove:

- new HEAD;
- exact parent;
- exact message;
- committed name-status/stat;
- `git diff HEAD^ HEAD --check`;
- clean worktree.

## Boundary

Local checkpoint does not authorize push, hosted migration, staging deployment,
production or package closure unless separately authorized.

## Report

Return package, branch, previous/new HEAD, exact parent/message, committed file
count/list, migrations, tests/Harness evidence, secret/generated checks,
docs/spec/AGENTS/current-state yes/no, second migration yes/no, push/hosted
actions, clean tree, and:

`COMMITTED LOCALLY`

STOP.
