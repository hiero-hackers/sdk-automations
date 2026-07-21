# Safety Requirements for Repository Changes

> This document defines platform safety requirements. Candidate action rows remain inactive until the
> affected maintainers approve the capability, configuration, warning, rollback, and test evidence.

## 1. Action classes

The platform classifies an action by its effect on repository participants.

| Class | Examples | Minimum requirement |
|---|---|---|
| Observation | The App reads state and records a dry-run decision. | The App requires no workflow write permission and explains where the record is visible. |
| Human-facing output | The App creates or updates a managed comment. | The write is idempotent, App-authored, rate-limited, and removable without changing workflow state. |
| Reversible state change | The App adds one mapped label or assigns a user. | The App checks current state, verifies the result, and provides a tested repair or reversal. |
| Clock-triggered destructive change | The App unassigns a stalled issue or closes a stalled pull request. | The App warns first, observes a full grace period, rechecks current state, and provides a simple reversal. |
| Immediate preventive change | The App locks a new issue under an approved moderation policy. | The App explains the action immediately and provides a simple maintainer reversal. |

## 2. Rules for every write

Every repository write must satisfy all of the following rules.

1. The repository explicitly enabled the capability and active mode.
2. The installation has the required permission.
3. The capability supplied a dated cause and expected current state.
4. The platform rechecked mutable preconditions before the write.
5. A newer human change causes a conflict instead of an automatic reversal.
6. The adapter names the exact item and value that it may change.
7. The adapter verifies the requested postcondition after the write.
8. The executor records an unclear outcome and reconciles it instead of retrying blindly.
9. The operation has a tested disablement, repair, and rollback path.
10. The operation appears in dry-run output before it becomes active in a new environment.

## 3. Clock-triggered destructive actions

A clock-triggered action never occurs on its first stale observation. The capability requests a warning, and
the platform records the warning before the grace period begins.

Before the final action, the executor confirms that the item is still in the expected state, the affected
person has not provided qualifying activity, the warning remains valid, the grace period has elapsed, and no
newer human action cancelled the plan.

The warning states the observed inactivity, the earliest action time, the command or action that cancels the
plan, and the action that reverses it later.

## 4. Candidate Hiero profile actions

The following rows come from the audited automation. They are candidate policy for repositories that request
the related capabilities.

| Candidate action | Capability | Current candidate default | Reversal |
|---|---|---|---|
| The App releases a stalled issue assignment. | `inactivity` | The App warns after 7 days and may unassign after 21 days. | The contributor or a maintainer assigns the issue again. |
| The App closes a stalled pull request that needs contributor revision. | `inactivity` | The App warns after 10 days and may close after 60 days. | A maintainer or author reopens the pull request when repository policy allows it. |
| The App locks a new issue pending moderation. | `intake` | The App acts immediately only when the repository enabled moderation. | A maintainer approves and unlocks the issue. |

These numbers are not universal platform defaults. The configuration schema must set safe minimums and must
prevent a zero-day or negative grace period.

## 5. Pause and cancellation

A repository may configure a mapped `blocked` meaning for a workflow profile. When present, the platform
stops capability writes for that item. The profile must decide whether removing the pause resets or resumes a
clock. The earlier proposal preferred a reset, but maintainers have not ratified that policy.

Global, installation, repository, and capability kill switches cancel new work. The executor must define how
pending work is closed, retained, or reconciled after a kill switch activates.

## 6. Multi-call effects

An operation that changes a label, assignee, and comment uses several GitHub calls. The effect plan must list
the call order, partial states, safe retries, verification, and restart behavior.

The recovery experiment must stop the process after every call and must include a concurrent human edit. A
multi-call operation cannot enter a real repository until the executor can distinguish an App-created partial
state from a similar human-created state.

## 7. Rollout requirements

No destructive action runs in the first technical MVP. A destructive capability requires a separate review,
personal-sandbox failure injection, a Hiero Hackers sandbox soak, a consenting repository, and a practiced
rollback.

The old and new automation must never write the same managed state during migration.

## 8. Questions that remain open

- Maintainers must decide which destructive capabilities they want.
- The configuration design must decide safe timing floors and cancellation commands.
- The storage experiment must decide where warning and pending-effect records live.
- The effect executor must define rollback when GitHub returns an unclear result.
- Each profile must decide how a mapped pause affects clocks.
- The project must define the clean observation period required before a destructive pilot.
