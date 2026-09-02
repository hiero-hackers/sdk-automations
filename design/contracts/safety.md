# Safety Engine Contract

> **Built as policy logic** — `packages/core/src/safety/`, with both verdict vocabularies locked by
> `packages/dev/checks/test/safety-drift.test.ts`. Repository effect application, postcondition
> verification, recovery, and rollback are unbuilt and live in [`../guides/effects.md`](../guides/effects.md).
> The destructive door exists, but no catalogued operation reaches it today.

What the engine enforces today: two entry points, one shared rule list, and a closed vocabulary of
verdict codes. A capability never decides whether its own write may happen.

## 1. Action classes

The engine derives a request's class from the operation facts in `INTENT_OPERATIONS`; a capability cannot
declare or elevate it. That platform-owned class chooses the door.

| Class | Door | Today's treatment |
|---|---|---|
| `observation` | `evaluateWrite` | Recorded, never applied. Needs no permission and no consent. |
| `humanFacingOutput` | `evaluateWrite` | The general rules decide. |
| `reversibleStateChange` | `evaluateWrite` | The general rules decide. |
| `clockTriggeredDestructive` | `evaluateDestructive` | Refused at the general door — the warning and grace gates cannot be decided from one request (D52). |
| `immediatePreventive` | none | Refused everywhere until a request proves an immediate explanation and a simple maintainer reversal (D54). |

## 2. Precedence

Order is contract, not style. Only the kill switch changes an OUTCOME; the rest decide which code is
reported, and the tests freeze the sequence (D39, D52).

1. **Preflight**, before either door: kill switch, then the authoritative precondition.
2. **Door policy**: `evaluateWrite` refuses the two classes it does not own; `evaluateDestructive`
   refuses anything that is not clock-triggered destructive, then runs its own gates in order —
   recorded warning, warning-to-request match, plan validity, grace floor, grace elapsed, cancelling
   activity.
3. **General rules**, shared by both doors, in the order `GENERAL_RULES` lists them: observation,
   capability enabled, permissions, item open, item paused, human ordering known, timestamps valid,
   no newer human change, mode not disabled, mode not record-only.
4. Nothing objected — `apply`.

## 3. Refusal codes

The closed vocabulary of `SafetyRefusalCode`. Severity is `packages/core/src/report/convert.ts`'s
table, not this document's.

| Code | Raised by | Meaning |
|---|---|---|
| `killSwitch` | intent preflight | An operator pulled the brake; every returned intent is refused, including observation-class intents. Capability and resolver evaluation has already occurred (D117). |
| `wrongEntryPoint` | `write.ts` | A clock-triggered destructive request arrived at the general door. |
| `preventiveGateUnavailable` | `write.ts` | The immediate-preventive class has no gate yet. |
| `capabilityDisabled` | general rules | The repository did not enable this capability. |
| `permissionMissing` | general rules | The installation lacks a grant the request requires. |
| `itemClosed` | general rules | The observed item is closed; a closed item accepts no capability write. Reported ahead of `itemBlocked`, because closure is terminal where a pause is not. |
| `itemBlocked` | general rules | A mapped `blocked` meaning pauses capability writes for this item. |
| `preconditionStale` | preflight | The authoritative precondition is unavailable, conflicted, or no longer holds. |
| `newerHumanChange` | general rules | A human changed the item at or after the cause; ties go to the human. |
| `humanOrderingUnknown` | general rules | Ordering evidence could not be established, which is a conflict and never an absence. |
| `invalidTimestamp` | general rules | The observation or human-change timestamp is not a finite time. |
| `modeDisabled` | general rules | The repository mode is `disabled`. |
| `wrongActionClass` | `destructive.ts` | A non-destructive request arrived at the destructive door. |
| `noWarning` | `destructive.ts` | No recorded warning; a destructive action never occurs on first observation. |
| `warningRequestMismatch` | `destructive.ts` | The warning authorizes a different capability, target, change, or causal observation. |
| `invalidDestructivePlan` | `destructive.ts` | The plan carries a non-finite value, or a warning predating its observation or shorter than the full grace period. |
| `graceBelowFloor` | `destructive.ts` | The grace period is below `MIN_GRACE_DAYS`. |
| `graceRunning` | `destructive.ts` | The grace period has not fully elapsed. |
| `activityCancelled` | `destructive.ts` | The affected person provided qualifying activity during the grace period. |

## 4. Record-only codes

Not refusals. The decision was reached and the effect was written down instead of performed.

| Code | Raised when |
|---|---|
| `observation` | The request's class is `observation`. |
| `modeRecordsOnly` | The repository mode is `observe` or `dry-run`. |

## 5. Which document rule maps to which code

The write rules the engine can decide from a single request. Rules 6–10 cannot be, and belong to
[`../guides/effects.md`](../guides/effects.md).

| Rule | Code when it objects |
|---|---|
| 1 — the repository enabled the capability and an active mode | `capabilityDisabled`, `modeDisabled`, `modeRecordsOnly` |
| 2 — the installation has the required permission | `permissionMissing` |
| 3 — the capability supplied a dated cause and expected state | `invalidTimestamp` |
| 4 — mutable preconditions rechecked before the write | `preconditionStale` |
| 5 — a newer human change is a conflict, and so is unknown ordering | `newerHumanChange`, `humanOrderingUnknown` |
| closure, pause and kill switches | `itemClosed`, `itemBlocked`, `killSwitch` |
| class routing | `wrongEntryPoint`, `preventiveGateUnavailable`, `wrongActionClass` |
