<p align="center">
  <img src="design/readme-wordmark.png" alt="SDK AUTOMATIONS" width="100%">
</p>

[![CI](https://github.com/hiero-hackers/sdk-automations/actions/workflows/ci.yml/badge.svg)](https://github.com/hiero-hackers/sdk-automations/actions/workflows/ci.yml) [![CodeQL](https://github.com/hiero-hackers/sdk-automations/actions/workflows/codeql.yml/badge.svg)](https://github.com/hiero-hackers/sdk-automations/actions/workflows/codeql.yml) [![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/hiero-hackers/sdk-automations/badge)](https://scorecard.dev/viewer/?uri=github.com/hiero-hackers/sdk-automations) [![Release](https://img.shields.io/github/v/release/hiero-hackers/sdk-automations?include_prereleases&sort=semver)](https://github.com/hiero-hackers/sdk-automations/releases) [![License: Apache-2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)

**Repository-owned configuration. Durable, explainable decisions. No server to host.**

Hiero SDK repositories repeat the same contributor-facing work: triage, pull-request checks,
workflow labels, stalled work, claiming issues. SDK Automations does it as a GitHub Action in each
repository's own workflow, from one reviewed `sdk-automations.yml` on the default branch. It decides
one issue or pull request at a time, writes nothing until a maintainer arms it, and records every
decision with its reason. It is pre-1.0, in a pilot on [hiero-hackers/analytics](https://github.com/hiero-hackers/analytics).

## Capabilities

| Capability | What a repository gets |
|---|---|
| `triageQueue` | new issues labelled for triage, with an optional welcome and a lock until triaged |
| `prDashboard` | one comment per pull request saying what stops it being ready to review, and optionally a label |
| `inactivity` | a reminder on stalled assignments and pull requests, then, where enabled, their release |
| `assignment` | contributors claim and release issues with a comment |
| `configReport` | a comment on any pull request that changes `sdk-automations.yml`, saying what it would mean |

Every capability is off until enabled. [What each one reads and may write →](docs/capabilities.md)

## Quick start

Add the workflow from [`docs/installing.md`](docs/installing.md), then merge this file:

```yaml
# sdk-automations.yml — observe records what would happen; dry-run also names each change
mode: observe

capabilities:
  triageQueue:
    enabled: true
  configReport:
    enabled: true
```

Each run's job summary lists its decisions. Nothing changes on GitHub until the file says `active`
and the workflow sets `arm-writes: "true"`.

## Safe by construction

- The configuration is read from the default branch; a run never checks out a contributor's code.
- Every outcome passes one safety ladder; a refusal carries a [code](docs/troubleshooting.md) that explains it.
- A write is re-checked against a live read, then confirmed by reading GitHub back.
- A release or a close comes only after a public warning and its grace period.

## Learn more

- [Documentation](docs/README.md) — quickstart, every configuration key, every refusal code.
- [Architecture](design/architecture.md), starting from [one label's trace](design/trace.md).
- [Contributing](CONTRIBUTING.md) — setup, the house rules, and [good first issues](https://github.com/hiero-hackers/sdk-automations/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22).
- [Security](SECURITY.md) — report a vulnerability privately.

---
Apache-2.0 · [Code of Conduct](CODE_OF_CONDUCT.md) · [AI policy](AI_POLICY.md) · DCO sign-off required
