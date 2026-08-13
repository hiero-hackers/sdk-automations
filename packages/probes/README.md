# Capability probes — DISPOSABLE

Three capability stubs that exist to test the boundary they plug into.
They are **not** product scope, not a ranking, and not a prediction of what
stage four will choose. Same rule as [`lab/`](../lab/README.md):
the harness is disposable, the evidence is the product.

## Why this exists

The runnable shell uses these probes to exercise the capability boundary and
produce observe or dry-run decisions. They also keep the capability-isolation
matrix concrete without treating any probe as product scope.

What the probes found is recorded as
D61–D73 in [`design/decisions.md`](../../design/decisions.md); eight of the thirteen
rows are gaps that no further work inside a single package would have
surfaced, because each package was individually correct. D72 needed more than
that again — it appeared only when this branch met the 2026-07-30 audit's
immutable destructive warnings, and neither change produced it alone.

## Why these three

Chosen for **contract diversity**, deliberately not for likelihood of being
ranked first — picking probable winners would have made this a scope decision
nobody made.

| Probe | The only one that… |
|---|---|
| `prQuality` | touches almost nothing: one resolver, one comment, no state, no mappings |
| `intake` | consumes mapped meanings, emits two intents from one observation, and declares **no** resolvers — so it is also the test that an undeclared resolver is unreachable |
| `inactivity` | is schedule-triggered and destructive: the only path through `evaluateDestructive`, the store's `schedule` table, and warn-then-act |

Between them: event vs. schedule, idempotent vs. non-idempotent, safe vs.
destructive, mapping-consuming vs. not, stateless vs. `durableState: required`.
If the boundary holds for all three, it holds for anything in
[`design/modules/`](../../design/modules/README.md).

## What the tests prove

| Suite | Claim |
|---|---|
| `test/boundary.test.ts` | Declarations are catalogue-consistent; the config projection leaks neither another capability's block nor a repository label string; the intent screen refuses undeclared, misattributed, under-classified, and malformed-destructive intents |
| `test/engine-matrix.test.ts` | **P3**, tested: all eight subsets, each capability's behaviour identical regardless of neighbours, disabled capabilities never evaluated, with a negative control so the matrix cannot pass vacuously |

The P3 run is the one worth flagging: [`build-plan.md`](../../design/build-plan.md)
§12 defers the toggle matrix past November because one capability cannot
violate the principle. That is right about the arithmetic and wrong about the
prerequisite — P3 is structural, so stubs test it as well as shipped code does
(D70).

## Deleting this package

When stage four names the first real capability:

1. Re-run the toggle matrix with the real capability substituted for its probe.
2. Move nothing from `src/` into the platform. A probe was chosen for
   diversity, not for demand; promoting one would turn a measuring instrument
   into a scope decision.
3. Delete `probes/` and remove it from `pnpm-workspace.yaml`.

`test/world.ts` is the one piece worth reading before it goes: its `runEnabled`
is the registry-activation step from build-plan §8 item 4, written as the
smallest thing that could work.

## What it does not prove

- Nothing about GitHub writes. Active mode is not implemented.
- Nothing about demand. These are not candidate capabilities.
- Nothing about effect recovery or live lease takeover.
