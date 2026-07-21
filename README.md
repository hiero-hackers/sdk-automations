# sdk-automations

Design work for a hosted, configuration-driven GitHub App that replaces repeated repository automation.
A repository enables only the capabilities it wants and maps them to its own workflow. The shared platform
handles GitHub access, configuration, safety, recovery, and audit information.

There is no implementation code here yet. The repository contains an audit of existing Hiero automation and
drafts for the system that may replace it. The module documents are candidates based on that audit. They are
not a committed product list.

## Reading order

1. [`planning/goals.md`](planning/goals.md) — the vision, the problem, and the hard limits.
2. [`design/architecture.md`](design/architecture.md) — the current architecture proposal and its open
   feasibility questions. [`design/decisions.md`](design/decisions.md) records accepted principles,
   hypotheses, and open decisions.
3. The component documents explain the candidate design in more detail.
   - [`design/core/README.md`](design/core/README.md) explains the shared platform services and indexes the
     rest of the core design.
   - [`design/core/taxonomy.md`](design/core/taxonomy.md) describes an optional Hiero workflow profile and
     the repository mappings it would require.
   - [`design/core/manual-edits.md`](design/core/manual-edits.md) proposes safe behavior when a person changes
     a mapped workflow label.
   - [`design/config/schema.md`](design/config/schema.md) proposes the reviewed repository configuration.
   - [`design/operations/README.md`](design/operations/README.md) describes hosting, rollout, rate limits,
     failure reporting, and storage questions.
   - [`design/operations/threat-model.md`](design/operations/threat-model.md) describes security threats,
     required controls, and decisions that still depend on the implementation.
4. [`design/modules/README.md`](design/modules/README.md) — candidate capabilities found in the audit. A
   capability becomes product scope only after maintainer review and a safe test plan.
5. [`design/testing/README.md`](design/testing/README.md) — how the system is tested.
6. [`design/build-plan.md`](design/build-plan.md) is working planning material through November 2026. Its
   dates and candidate milestones still require agreement and are not delivery commitments.

## The evidence underneath

[`planning/lessons-learned.md`](planning/lessons-learned.md) distills the coupling anti-patterns
(classes A–E) out of the audit; the audit itself lives in [`audit/`](audit/) — the C++, Python, and
JavaScript SDK automation read at pinned commits, with `file:line` citations — and
[`audit/services.md`](audit/services.md) is the cross-SDK synthesis of what exists today.
