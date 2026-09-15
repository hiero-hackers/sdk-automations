# Pilot-ready v0

## Outcome

One installation can run the current capabilities on a real repository with bounded GitHub use,
and an operator can understand and recover every action.

This page records the agreed direction. The milestone and its issues should be created after the
maintainers confirm the split and ownership.

## Work in order

### 1. Bound GitHub use

1. Give one reconciliation tick a shared request cap and write cap across every due repository.
2. Make progress fair when more repositories are due than one tick can serve.
3. Carry a secondary-rate-limit pause across separate requests when the current client proves
   insufficient.
4. Record request use per installation and verify the design with a many-repository harness.
   One repository is measured (protocol 8.4, 2026-09-15); the harness stays open.

The sweep's allowance is a share of the installation's own limit per pool, in GitHub's units,
over GitHub's reset window (D192). Search is never used and the secondary limits are the client's.

### 2. Prove current main

Run a focused sandbox pilot after the budget work. Measure real request use and verify status,
explanation, restart, expired-token, and transient-GitHub failure paths. Keep the completed adapter
and destructive rehearsals as evidence instead of repeating them from the beginning.

### 3. Finish one capability

Complete `prQuality` phase 1 as small, independent changes: mergeability, commit attestations, and
linked-issue assignment. Keep label behavior separate. Confirm ownership before starting another
capability so work does not overlap.

### 4. Improve capability authoring from evidence

Use the next completed capability to identify repeated author work. Remove only repetition that the
real build demonstrates. Do not infer triggers or effects from settings when they express different
facts.

### 5. Prepare launch

Choose the App owner and hosting shape, then add the observability, backup, health, and operator
runbook work that deployment requires. Store versioning remains at version 1 until the first real
installation.

## Working rule

Each pull request should be reviewable in under an hour, remove more debt than it creates, and avoid
leaving a correctness or safety problem for a later cleanup.
