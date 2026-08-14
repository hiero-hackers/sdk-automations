<div align="center">

# Hiero SDK Automations

**A safety-focused GitHub App for contributor workflows across Hiero SDK repositories.**

<p>
  <a href="https://github.com/hiero-hackers/sdk-automations/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/hiero-hackers/sdk-automations/actions/workflows/ci.yml/badge.svg"></a>
  <a href="https://github.com/hiero-hackers/sdk-automations/actions/workflows/codeql.yml"><img alt="CodeQL" src="https://github.com/hiero-hackers/sdk-automations/actions/workflows/codeql.yml/badge.svg"></a>
  <a href="LICENSE"><img alt="License: Apache-2.0" src="https://img.shields.io/badge/License-Apache%202.0-blue.svg"></a>
  <a href="https://github.com/hiero-hackers/sdk-automations/blob/main/package.json"><img alt="Node 23.4 or newer" src="https://img.shields.io/badge/node-%3E%3D23.4-blue"></a>
  <a href="https://scorecard.dev/viewer/?uri=github.com/hiero-hackers/sdk-automations"><img alt="OpenSSF Scorecard" src="https://api.scorecard.dev/projects/github.com/hiero-hackers/sdk-automations/badge"></a>
</p>

<p>
  <a href="#overview">Overview</a> ·
  <a href="#project-status">Status</a> ·
  <a href="#get-started">Get started</a> ·
  <a href="#documentation">Documentation</a> ·
  <a href="#contributing">Contributing</a>
</p>

</div>

## Overview

Hiero SDK repositories repeat many of the same contributor-facing tasks: triage, workflow labels,
pull-request checks, and status reporting. This project is building one hosted GitHub App that lets
each repository choose its automations in a reviewed YAML file instead of maintaining separate
scripts and workflows.

The current application can:

- verify signed webhook deliveries before trusting their contents;
- store accepted work durably before acknowledging it;
- evaluate repository configuration in `observe` or `dry-run` mode;
- keep delivery state and canonical reports in SQLite; and
- reject unsupported active behavior instead of claiming that a GitHub change happened.

> [!IMPORTANT]
> This project is in early development. The App is not yet available for installation and does not
> make active GitHub changes. The current runnable path is intentionally limited to truthful
> observation and dry-run reports.

## Project status

| Area | Current state |
|---|---|
| Signed webhook verification | Implemented |
| Durable delivery intake and deduplication | Implemented |
| Observe and dry-run decisions | Implemented |
| Canonical SQLite reports | Implemented |
| Active GitHub writes and recovery | Deliberately unavailable |
| Hosted installation | Not yet available |

The next milestone is one small, real capability exercised end to end before the project expands to
more automations. See the [configuration guide](docs/configuration.md) for the supported schema and
[`design/trace.md`](design/trace.md) for the current delivery journey.

## Get started

### Develop locally

You need [Node.js](https://nodejs.org/) 24 or newer and
[pnpm](https://pnpm.io/) 10.29.1.

```bash
pnpm install
pnpm -r test
```

All tracked tests run offline. You do not need GitHub credentials or a configured GitHub App.

### Explore the configuration

The [quickstart](docs/quickstart.md) shows the repository configuration planned for the App. Tested
examples live in [`docs/examples/`](docs/examples/README.md). These files describe the current
configuration contract; they are not installation instructions for a hosted service yet.

## How it works

```text
signed GitHub webhook
        │
        ▼
shell ── verify, accept, and claim the delivery
        │
        ▼
SQLite ── durable delivery state
        │
        ▼
core ── parse configuration and make a pure decision
        │
        ▼
SQLite ── canonical report and atomic completion
```

The boundaries are deliberately narrow: transport does not make policy decisions, Core does not
perform I/O, and SQLite owns durable operational state.

## Workspace

| Package | Responsibility |
|---|---|
| [`core`](packages/core/README.md) | Configuration, capability boundaries, safety rules, and pure decisions |
| [`store`](packages/store/README.md) | Durable delivery and report state in SQLite |
| [`shell`](packages/shell/README.md) | Webhook transport and processing order |
| [`probes`](packages/probes/README.md) | Disposable capability fixtures used while the first real capability is selected |
| [`checks`](packages/checks/README.md) | Repository-wide architecture, documentation, and example checks |
| [`lab`](packages/lab/README.md) | Scrubbed experiments for behavior that requires contact with GitHub |

## Documentation

| Document | Use it for |
|---|---|
| [Quickstart](docs/quickstart.md) | Preview the repository configuration |
| [Configuration](docs/configuration.md) | Understand every supported setting and validation rule |
| [Troubleshooting](docs/troubleshooting.md) | Interpret reported errors and suggested actions |
| [Delivery trace](design/trace.md) | Follow one webhook through the current system |
| [Architecture](design/architecture.md) | Understand the present design and its open boundaries |
| [Decision register](design/decisions.md) | Read the reasoning behind non-obvious choices |

## Security

The application verifies the exact webhook bytes, persists accepted work before returning success,
and fails closed when configuration or runtime values are invalid. Active writes remain disabled
until a real effect has durable restart and uncertain-outcome handling.

Please report vulnerabilities privately through the process in [SECURITY.md](SECURITY.md).

## Contributing

Contributions are welcome. Start with the [contributing guide](CONTRIBUTING.md), then choose an open
[`good first issue`](https://github.com/hiero-hackers/sdk-automations/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22).
Every commit requires a [Developer Certificate of Origin](https://developercertificate.org/) sign-off.
Participation is governed by the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

Licensed under the [Apache License 2.0](LICENSE).
