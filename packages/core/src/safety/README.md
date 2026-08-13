# safety/ — may this write happen?

**If you are asking why a write was refused, this is the directory**, and
[`rules.ts`](rules.ts) is the file.

Every write request arrives at one of two doors, passes that door's own policy, and then meets the
rules both doors share. The answer is always a verdict — applied, recorded, or refused with a
machine-readable code — never an exception.

```mermaid
flowchart TB
    REQ["a capability's intent, screened"]
    REQ --> W["write.ts — the general door"]
    REQ --> D["destructive.ts — the clock-triggered door"]
    W --> R["rules.ts — the ordered rules both share"]
    D --> R
    R --> V["SafetyVerdict — apply · record-only · refuse"]
    WO["world.ts — the derived, unforgeable facts"] --> R
```

## The files

| File | The question it answers |
|---|---|
| [`types.ts`](types.ts) | What vocabulary is a decision expressed in? The request, the context, the verdict, and every refusal code. |
| [`world.ts`](world.ts) | What was actually observed, and does the capability's claim hold? Derived, never asserted. |
| [`rules.ts`](rules.ts) | Which rules does every write pass, and in what order? |
| [`write.ts`](write.ts) | May this ordinary write happen? |
| [`destructive.ts`](destructive.ts) | Has the warning, the grace period and the cancellation window been honoured? |
| [`index.ts`](index.ts) | The barrel — and it deliberately exports less than the files contain. |

## Two doors, on purpose

`write.ts` is short and `destructive.ts` is long, and **that asymmetry is information**: the general
path has almost no special policy, while the clock-triggered one is almost entirely special policy.
Do not merge them.

They are also not interchangeable. Handing a `clockTriggeredDestructive` request to `evaluateWrite`
is **refused**, not quietly allowed — because the module's headline claim, that a destructive action
cannot fire without a recorded warning and an elapsed grace period, was once only true if the caller
happened to pick the right function. Making the wrong door a verdict turned a calling convention
into a property (D52).

## What cannot be faked

`DerivedWorld` has no public constructor. Its brand symbol is not exported from the barrel, and
core's `exports` map blocks the deep path, so **outside this package there is exactly one way to
obtain a world: derive it from the observation you were given** (D92). A shell cannot assert that a
capability's precondition holds — it has no type with which to say so.

`DestructiveWarning` works the same way: only `createDestructiveWarning` mints one, and it carries
an immutable snapshot of the request it authorises, so a warning cannot be reused across a different
capability, item, change or cause (D60).

Both are the same idea. Where a claim would otherwise be taken on trust, make the trusted value
impossible to construct.

## Order is contract

`GENERAL_RULES` is exported as an ordered list, and the tests assert the order directly, because
precedence is policy rather than an implementation detail: kill switch → observation → consent →
authority → pause → staleness → human conflict → mode. Only the kill switch changes an *outcome*;
the rest decide which `code` a maintainer sees, and that is what makes a report actionable.

Rules 7–10 of safety.md §2 are absent here on purpose — postcondition verification, unclear-outcome
reconciliation, tested rollback and staged rollout cannot be decided from a single request. They
belong to a future write path and to process.
