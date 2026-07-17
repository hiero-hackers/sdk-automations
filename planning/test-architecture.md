# Test Architecture for the Opt-In Module System (work in progress)

> **What this covers:** a working proposal for how to test the opt-in-module app — the forward-looking
> partner to `audit/testing-cpp.md`, which found the C++ suite testable as units (A) but not across its
> seams (D). This design makes the seams testable by construction.
>
> **Tests the design in** `planning/solution.md` and `planning/opt-in-modules.md`; applies the
> `planning/lessons-learned.md` constraints. **Deferred (implementation):** the concrete frameworks.

## The thesis: test modules against the core, not against GitHub

C++ tested each handler against a mock of **GitHub** — a system the project doesn't control, whose drift is
silent (`lessons-learned.md` B1, mock-fidelity). Here, a module only ever calls **the core**
(`opt-in-modules.md` §3), so it is tested against a **fake core** — an interface the project *owns*: small,
stable, ours. GitHub-mocking is pushed down to **one** adapter and contract-tested there. The mock-drift
surface collapses from "every handler re-models GitHub" to "one adapter, modelled once."

## The layers

| Layer | Tests | Mocks |
|---|---|---|
| **Core unit** | state machine (every legal + illegal transition); resolvers; safety engine | nothing — pure logic |
| **Module unit** | one module's logic in isolation | the **fake core** (owned, stable) |
| **Adapter contract** | the one GitHub adapter vs GitHub's published schemas; typed client so a rename is a compile error | GitHub (here only) |
| **Module↔core contract** | a module only requests transitions / reads keys it *declared* | the registry |
| **Composition** | a real sequence (intake → assign → inactivity) on a real core | adapter only |
| **Toggle matrix** | enabling/disabling a module has no side effect on the others; plus the incoherence-injection axis — each `manual-edits.md` §3 class × each module combination | adapter |
| **Invariants** | item never in two *position* states (`blocked` is an overlay); destructive acts always pass the safety engine; the manual-edit set (`manual-edits.md` §6: never-revert, no-prefix, narrated, blocked-absolute) | — |
| **Replay gate** | every release replays recent production events and diffs the emitted transitions against what production did; an unexplained diff blocks (`operations.md` §3) | nothing — real recorded traffic |
| **E2E (scheduled)** | a real App install on a sandbox repo: real webhooks + API; doubles as ring 0 of the rollout (`operations.md` §3) | nothing |

## The two layers only the decoupling makes possible

These are the headline — they test what C++ structurally could not.

- **Toggle matrix** turns the decoupling *claim* into an executable test: run assignment-alone vs +intake vs
  full-stack and assert flipping one module doesn't perturb another. In C++ this was untestable — toggling a
  co-located job wasn't a code path.
- **Invariants** exist only because the core *owns* the spine: "never two `status:` states," "every
  destructive action passed the safety engine." Unassertable in C++ where no component owned that state
  (`lessons-learned.md` A1). Decoupling doesn't just ease tests — it *creates* testable guarantees.

