# Testing Audit: Hiero C++ SDK Automation (overview)

> **What this covers:** an overview of the C++ bot-script test suite (`.github/scripts/tests/`) — what its
> approach does well, what will not scale, and the lessons to carry into the replacement. Since the system
> is being replaced, this is the lessons pass, not an exhaustive coverage report. The forward-looking test
> design is `design/testing/README.md`.
>
> **One-line finding:** testability splits two ways. Unit/handler testing is strong (**A**); seam and
> integration testing is weak (**D**) — the same two-band fault line as `audit/principles-review-cpp.md`,
> visible in the suite itself.

## The setup, briefly

A custom harness (`test-utils.js`) run by the `zxc-test-bot-scripts` CI job: ~10k lines across 16 files, one
scenario suite per handler plus the helpers, each driving a whole handler against a mocked GitHub (REST +
GraphQL) with an injectable clock. These are per-handler **integration tests against a mock**, not narrow
unit tests — which is why the unit/handler band scores well.

## What works (worth carrying forward)

- **Per-handler scenario tests** that drive a handler end to end and assert on the resulting label,
  assignee, and comment writes.
- **Dependency injection makes handlers isolatable** — the `github` client and the clock are injected, so
  even time-based logic (the inactivity reaper) is testable.
- **Cross-entity *reads* are mockable** — the harness can express the other side of the PR↔issue link
  (issue assignees, closing refs), so the issue-link check is exercised.

These are good properties, and they come straight from the code-level decoupling (injected dependencies,
one shared helper barrel). Keep them.

## What will not scale (the lessons)

1. **The mock re-models GitHub in every handler.** Each suite carries its own fixtures of GitHub's response
   shapes, so GitHub's contract is duplicated across the suite. That is a B1-class coupling (`lessons-learned`
   B1) pointed at an external system — and it does not scale: more handlers means more copies of the same
   assumption, each able to drift independently.

2. **The coupled seams sit outside the test boundary entirely.** The artifact relay's exact-name link has
   **no test file at all** — a rename stays green. Deployment bundling and the shared concurrency lock are
   YAML, not code paths, so toggling and ordering are unverifiable. And no test runs handlers as a
   *sequence*, so a divergence between two modules (e.g. the two linked-issue mechanisms) cannot surface.
   These are exactly the accidental couplings from the inventory, and they are precisely what the suite
   cannot reach.

3. **Duplicated logic means duplicated, driftable tests.** The skill-ladder rule lives in two handlers, so
   it is verified in two test files that can drift apart as easily as the production copies can.

## The deeper lesson: green is not the same as correct

A mock-only suite **cannot fail for any reason originating outside the repo.** It proves "my logic is
consistent with *my model* of GitHub," never "my code works against GitHub." So when GitHub changes a format
the tests stay green while production breaks — valid but unsound. This is not even only a future risk: the
mock returns a fixed `mergeable` boolean and never the `null` GitHub returns while computing it, so the
retry/polling path is under-tested *today*, with no GitHub change required. Treating a green mock suite as
"the system works" is the trap to avoid.

## What this means for the replacement

The lessons map directly onto the new design (`design/testing/README.md`):

- Keep per-component tests and dependency injection — they are why the unit band is strong.
- Confine GitHub-mocking to **one** adapter and contract-test it against GitHub's published schema, instead
  of re-modelling GitHub in every module.
- Make the seams testable by construction: modules test against the core (an owned interface), sequences run
  on a real core, and toggling and invariants become first-class test layers.

The takeaway in one sentence: C++ proved that decoupled *code* is testable; the gaps prove that coupled
*systems* are not — so the replacement has to decouple the system, not just keep the code clean.
