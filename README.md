# sdk-automations

Design work for a hosted, config-driven GitHub App that takes over the maintainer automation —
triage, assignment, the skill ladder, inactivity reaping, PR quality, progression — currently
implemented as per-repo bots in the Hiero SDKs. There is no code here yet: the repo is an audit of
the existing systems and the architecture of what replaces them. `design/` mirrors the components of
the system; when implementation starts, the code lands in this repo alongside it, one source
directory per component, with each component's design doc beside its code.

## Reading order

1. [`planning/goals.md`](planning/goals.md) — the vision, the problem, and the hard limits.
2. [`design/architecture.md`](design/architecture.md) — **the central design document**; its §1 is the overview
   picture. [`design/decisions.md`](design/decisions.md) is the register of every proposed position
   and open question — the ratification index.
3. The component docs, each drafted for maintainer ratification:
   - [`design/core/README.md`](design/core/README.md) — the core's anatomy and the index of its design
   - [`design/core/taxonomy.md`](design/core/taxonomy.md) — the labels, the two state machines (issue and PR), and
     the per-position invariants
   - [`design/core/manual-edits.md`](design/core/manual-edits.md) — what happens when a human edits a status label
   - [`design/config/schema.md`](design/config/schema.md) — the repo config file
   - [`design/operations/README.md`](design/operations/README.md) — hosting, rollout, rate limits, failure loudness
4. [`design/modules/README.md`](design/modules/README.md) — the module catalogue and interaction graph; per-module
   specs land in `design/modules/` as each is designed.
5. [`design/testing/README.md`](design/testing/README.md) — how the system is tested.

## The evidence underneath

[`planning/lessons-learned.md`](planning/lessons-learned.md) distills the coupling anti-patterns
(classes A–E) out of the audit; the audit itself lives in [`audit/`](audit/) — the C++, Python, and
JavaScript SDK automation read at pinned commits, with `file:line` citations — and
[`audit/services.md`](audit/services.md) is the cross-SDK synthesis of what exists today.
