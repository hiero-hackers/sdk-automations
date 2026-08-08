# sdk-automations

[![CI](https://github.com/hiero-hackers/sdk-automations/actions/workflows/ci.yml/badge.svg)](https://github.com/hiero-hackers/sdk-automations/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D23.4-blue)](https://github.com/hiero-hackers/sdk-automations/blob/main/package.json)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/hiero-hackers/sdk-automations/badge)](https://scorecard.dev/viewer/?uri=github.com/hiero-hackers/sdk-automations)

The design and in-progress implementation of a hosted, configuration-driven GitHub App that replaces repeated repository automation.
A repository enables only the capabilities it wants and maps them to its own workflow. The shared platform
handles GitHub access, configuration, safety, recovery, and audit information.

The repository contains an audit of existing Hiero automation and drafts for the system that may replace
it. The module documents are candidates based on that audit. They are not a committed product list. Seven
packages live under [`packages/`](packages/) as the parallel track the stage gates do not block (a pnpm
workspace), all pending stage-four ratification of the decisions they encode:

- [`core/`](packages/core/README.md) — the pure-logic state machine, safety engine, configuration layer, and the
  capability runtime boundary; its front door is one verb, `decide()`
- [`store/`](packages/store/README.md) — the owned operational store
- [`executor/`](packages/executor/README.md) — the recovery-loop engine with its automated crash grid and the
  intent-to-plan translator
- [`shell/`](packages/shell/README.md) — the transport: a webhook delivery in, a persisted report out; it owns
  ordering and decides nothing
- [`probes/`](packages/probes/README.md) — **disposable**: three deliberately dissimilar capability stubs that
  load-test the seam between the others and give P3 its first run in code
- [`checks/`](packages/checks/README.md) — tests about the repository rather than any package: docs,
  examples, and design documents held to the code they describe
- [`lab/`](packages/lab/README.md) — the standing instrument for facts about GitHub that only contact with GitHub
  can verify; protocols and the capture scrubber are tracked, credentials and raw evidence never are

Beyond `packages/` and `design/`, one user-facing root: [`docs/`](docs/README.md) — the configuration
guide, every table locked to the code by `checks/`, and [`docs/examples/`](docs/examples/README.md), worked
configurations parsed by the test suite on every commit. A top-level directory holds workspace packages
or is one of `design/`, `docs/` — a rule the suite enforces, like the other sentences in this paragraph.

New here? [`design/trace.md`](design/trace.md) follows one real delivery through every stage of the
system, introducing each term at the moment it acts.

## Reading order

1. [`design/planning/goals.md`](design/planning/goals.md) — the vision, the problem, and the hard limits.
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

[`design/planning/lessons-learned.md`](design/planning/lessons-learned.md) distills the coupling anti-patterns
(classes A–E) out of the audit; the audit itself lives in [`design/audit/`](design/audit/) — the C++, Python, and
JavaScript SDK automation read at pinned commits, with `file:line` citations — and
[`design/audit/services.md`](design/audit/services.md) is the cross-SDK synthesis of what exists today.

## Contributing

[`CONTRIBUTING.md`](CONTRIBUTING.md) has the setup (two commands, no credentials), the DCO sign-off
every commit needs, how the difficulty ladder works, and the ground rules — each one linked to the
decision or check that earned it. Participation is under the
[Code of Conduct](CODE_OF_CONDUCT.md); security reports go through [`SECURITY.md`](SECURITY.md).

## Tooling

Code style is enforced by [Prettier](https://prettier.io) (formatter-only) across all TypeScript
packages; markdown, YAML, and JSON files are excluded — see `.prettierignore`. Run `pnpm format` to
apply it, or `pnpm format:check` to verify without writing (CI runs the latter).

ESLint enforces code quality separately — the two do not overlap. If you're wondering whether a new
ESLint rule should be added: the answer is which defect class it catches, and whether a dedicated
check in `checks/` would fit better than a rule catalogue entry.
