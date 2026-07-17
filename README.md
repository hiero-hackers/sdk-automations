# sdk-automations

Design work for a hosted, config-driven GitHub App that takes over the maintainer automation —
triage, assignment, the skill ladder, inactivity reaping, PR quality, progression — currently
implemented as per-repo bots in the Hiero SDKs. There is no code here yet: the repo is an audit of
the existing systems and the architecture of what replaces them.

## Reading order

1. [`planning/goals.md`](planning/goals.md) — the vision, the problem, and the hard limits.
2. [`planning/solution.md`](planning/solution.md) — **the central design document**; its §1 is the
   overview picture.
3. The drafts awaiting ratification:
   [`taxonomy-draft.md`](planning/taxonomy-draft.md) (labels and the state machine),
   [`config-draft.md`](planning/config-draft.md) (the repo config file),
   [`manual-edits.md`](planning/manual-edits.md) (what happens when a human edits a status label),
   [`operations.md`](planning/operations.md) (hosting, rollout, rate limits, failure loudness).
4. [`planning/opt-in-modules.md`](planning/opt-in-modules.md) — the module catalogue — and
   [`planning/test-architecture.md`](planning/test-architecture.md) — how the system is tested.

## The evidence underneath

[`planning/lessons-learned.md`](planning/lessons-learned.md) distills the coupling anti-patterns
(classes A–E) out of the audit; the audit itself lives in [`audit/`](audit/) — the C++, Python, and
JavaScript SDK automation read at pinned commits, with `file:line` citations — and
[`docs/services.md`](docs/services.md) is the cross-SDK synthesis of what exists today.
