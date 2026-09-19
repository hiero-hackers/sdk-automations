# intake — walk a new issue from opening to triage

Not built: phase 3.

## What the output looks like

Intake can label a new issue, welcome its author, and keep the discussion locked until a maintainer
adds an approval label. The approval label is the authorization: GitHub only lets people with
triage access or above apply labels.

```yaml
capabilities:
  intake:
    enabled: true
    announce: true
    unlockWhen: [ready]
    confirmUnlock: true

mappings:
  labels:
    awaitingTriage: "status: pending-review"
    ready: "status: ready for dev"
```

`unlockWhen` does two jobs. A non-empty list locks new issues and names the mapped meanings that
release them. An empty list leaves discussions unlocked. This prevents a configuration that locks
issues without defining a release path.

On `issues.opened`, intake:

1. applies `awaitingTriage` when the issue has no workflow position;
2. posts the welcome when `announce` is true;
3. locks last when `unlockWhen` is not empty.

On `issues.labeled`, intake unlocks when the newly added label maps to an `unlockWhen` meaning. It
can then post one managed confirmation when `confirmUnlock` is true. If approval arrives before the
lock write, the confirmation still posts and no unnecessary unlock is requested.

Other issue actions do nothing. Removing a label never retriages or relocks the issue. Bot-authored
and conflicted issues remain untouched.

## What the config looks like

| Declaration | Value |
|---|---|
| `triggers` | `issues` |
| `facts` / `needs` | `issue` / none |
| `resolvers` | `isAutomationActor` |
| `intents` | `applyMappedLabel`, `postManagedComment`, `lockIssue`, `unlockIssue` |
| `requiredMappings` | `labels: awaitingTriage` |
| Permissions | repository `issues:read`, `issues:write` |

The issue observation carries its current `locked` value and, for an issue event, the useful
transition: opened, an added mapped label, or no intake transition. The raw webhook action stays
inside normalization.

## How it works

| Phase | Status | Scope |
|---|---|---|
| 1 | shipped | awaiting-triage label and optional welcome |
| 2 | shipped | lock on open, unlock on configured approval, optional confirmation |
| 3 | not built | advisory checks for skill tier, issue type, and native project fields |

## Verified by

| Scenario | Proves |
|---|---|
| New issue with quarantine enabled | label, welcome, then lock |
| Approval meaning added | unlock and optional confirmation |
| Approval reaches the item before the lock | confirmation without an unnecessary unlock |
| Approval label removed | no retriage and no relock |
| Unrelated label added | no effect |
| Bot-authored or conflicted issue | no effect |
| Redelivered write | the journal and managed comment identity prevent duplication |
| `mode: dry-run` | every proposed write is reported and none is sent |
