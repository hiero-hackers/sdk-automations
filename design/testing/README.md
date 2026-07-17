# Test Architecture for the Opt-In Module System (work in progress)

> **What this covers:** a working proposal for how to test the opt-in-module app — the forward-looking
> partner to `audit/testing-cpp.md`, which found the C++ suite testable as units (A) but not across its
> seams (D). This design makes the seams testable by construction.
>
> **Tests the design in** `design/architecture.md` and `design/modules/README.md`; applies the
> `planning/lessons-learned.md` constraints. **Deferred (implementation):** the concrete frameworks.

## The thesis: test modules against the core, not against GitHub

C++ tested each handler against a mock of **GitHub** — a system the project doesn't control, whose drift is
silent (`planning/lessons-learned.md` B1, mock-fidelity). Here, a module only ever calls **the core**
(`design/modules/README.md` §3), so it is tested against a **fake core** — an interface the project *owns*: small,
stable, ours. GitHub-mocking is pushed down to **one** adapter and contract-tested there. The mock-drift
surface collapses from "every handler re-models GitHub" to "one adapter, modelled once."

## The layers

| Layer | Tests | Mocks |
|---|---|---|
| **Core unit** | state machines (every legal + illegal transition); resolvers; safety engine | nothing — pure logic |
| **Module unit** | one module's logic in isolation | the **fake core** (owned, stable) |
| **Adapter contract** | the one GitHub adapter vs GitHub's published schemas; typed client so a rename is a compile error | GitHub (here only) |
| **Module↔core contract** | a module only requests transitions / reads keys it *declared* | the registry |
| **Composition** | a real sequence (intake → assign → inactivity) on a real core | adapter only |
| **Toggle matrix** | enabling/disabling a module has no side effect on the others; plus the incoherence-injection axis — each `design/core/manual-edits.md` §3 class × each module combination | adapter |
| **Invariants** | item never in two *position* states (`blocked` is an overlay); destructive acts always pass the safety engine; the manual-edit set (`design/core/manual-edits.md` §6: never-revert, no-prefix, narrated, blocked-absolute) | — |
| **Replay gate** | every release replays recent production events and diffs the emitted transitions against what production did; an unexplained diff blocks (`design/operations/README.md` §3) | nothing — real recorded traffic |
| **E2E (scheduled)** | a real App install on a sandbox repo: real webhooks + API; doubles as ring 0 of the rollout (`design/operations/README.md` §3) | nothing |

## When each layer must pass

The layers map to gates — this mapping is policy, fixed here rather than discovered in CI config:

| Gate | Must pass |
|---|---|
| **every PR** | core unit · module unit · module↔core contract · the conformance kit (incl. toggle matrix + incoherence injection) · invariants |
| **release candidate** | all of the above + adapter contract + composition + **replay gate** (`design/operations/README.md` §3) |
| **scheduled (nightly)** | E2E on the ring-0 sandbox — failures mark the dashboard, page nobody (`design/operations/README.md` §1) |

Everything a module author can break runs at PR time; everything that needs real GitHub runs where
real GitHub is, off the PR critical path.

## Fixtures are recorded, never written

The C++ suite's deepest flaw was hand-written mocks of GitHub drifting silently from the real thing
(`audit/testing-cpp.md` — the mock that never returned `mergeable: null`). The cure applies to our
own test data: **every GitHub payload fixture — adapter contract inputs, replay corpora, kit
scenarios that need event shapes — is recorded from real traffic** (ring 0, or production via the
decision log) **and never authored by hand.** A hand-written fixture encodes what its author
believes GitHub does; a recorded one encodes what GitHub did. Re-recording on a schedule is the
drift alarm hand-written mocks can never sound.

## The conformance kit: one harness, derived per module

Three of the layers above — **module↔core contract**, **toggle matrix**, and **invariants** — are
packaged as a single reusable conformance kit, in the spirit of the Hiero TCK but cheaper: there is
one implementation with many modules of one interface, so no external driver is needed — the kit
runs any module in-process against the fake core, and **derives most of its suite from the module's
own declaration** (`design/modules/contract.md` §1): a manual-production case per consumed state, a
legal-request and refusal-handling case per declared edge, the five incoherence classes injected,
the global invariants asserted throughout, and the on/off toggle cases. Undeclared operations need
no tests — the types made them inexpressible. A module author writes only behaviour tests
(does `/assign` check the ladder correctly); **passing the kit is the definition of being a
module** — it is how the standards bind without anyone having to remember them.

## The two layers only the decoupling makes possible

These are the headline — they test what C++ structurally could not.

- **Toggle matrix** turns the decoupling *claim* into an executable test: run assignment-alone vs +intake vs
  full-stack and assert flipping one module doesn't perturb another. In C++ this was untestable — toggling a
  co-located job wasn't a code path.
- **Invariants** exist only because the core *owns* the spine: "never two *position* states," "every
  destructive action passed the safety engine." Unassertable in C++ where no component owned that state
  (`planning/lessons-learned.md` A1). Decoupling doesn't just ease tests — it *creates* testable guarantees.
