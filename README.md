<p align="center">
  <img src="docs/assets/readme-wordmark.png" alt="SDK AUTOMATIONS" width="100%">
</p>

<p align="center">
  <strong>One GitHub App. Repository-owned configuration. Durable, explainable decisions.</strong>
</p>

<p align="center">
  <a href="https://github.com/hiero-hackers/sdk-automations/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/hiero-hackers/sdk-automations/actions/workflows/ci.yml/badge.svg"></a>
  <a href="https://github.com/hiero-hackers/sdk-automations/actions/workflows/codeql.yml"><img alt="CodeQL" src="https://github.com/hiero-hackers/sdk-automations/actions/workflows/codeql.yml/badge.svg"></a>
  <a href="LICENSE"><img alt="License: Apache-2.0" src="https://img.shields.io/badge/License-Apache%202.0-blue.svg"></a>
  <a href="https://github.com/hiero-hackers/sdk-automations/blob/main/package.json"><img alt="Node 23.4 or newer" src="https://img.shields.io/badge/node-%3E%3D23.4-blue"></a>
  <a href="https://scorecard.dev/viewer/?uri=github.com/hiero-hackers/sdk-automations"><img alt="OpenSSF Scorecard" src="https://api.scorecard.dev/projects/github.com/hiero-hackers/sdk-automations/badge"></a>
</p>

<p align="center">
  <a href="docs/quickstart.md">Quickstart</a> ·
  <a href="docs/configuration.md">Configuration</a> ·
  <a href="design/trace.md">System trace</a> ·
  <a href="CONTRIBUTING.md">Contributing</a> ·
  <a href="SECURITY.md">Security</a>
</p>

<br>

<table>
  <tr>
    <td width="33%" align="center">
      <strong>Verified intake</strong><br><br>
      Webhook signatures are checked against the exact bytes received before payload data is trusted.
    </td>
    <td width="33%" align="center">
      <strong>Honest decisions</strong><br><br>
      Observe and dry-run modes explain what the App found without pretending an external change happened.
    </td>
    <td width="33%" align="center">
      <strong>Durable state</strong><br><br>
      Accepted deliveries and canonical reports live in SQLite, with completion committed atomically.
    </td>
  </tr>
</table>

<p align="center">
  <strong>Early development · observe and dry-run only</strong><br>
  <sub>The App is not installable yet. Active GitHub writes remain disabled until one real effect has durable recovery.</sub>
</p>

---

## Why this exists

Hiero SDK repositories repeat the same contributor-facing work: intake, triage, workflow labels,
pull-request checks, and status reporting. Today that logic is scattered across repository-specific
scripts and workflows.

SDK Automations is building one small, hosted GitHub App that lets each repository choose its
automation in a reviewed YAML file. The goal is not a generic workflow platform. It is one clear,
auditable path that maintainers can understand end to end.

## The supported path today

```text
GitHub webhook  →  verify  →  persist  →  decide  →  persist report  →  complete
                       exact bytes       pure logic      SQLite transaction
```

The runnable application verifies and stores webhook deliveries, evaluates repository configuration
in `observe` or `dry-run` mode, and persists a canonical report. Unsupported active configuration is
rejected before a decision can claim that GitHub was changed.

> [!NOTE]
> This boundary is intentional. The first active capability will return only with a real GitHub
> adapter, explicit permissions, durable restart behavior, and honest handling of uncertain writes.

## See the configuration

```yaml
schemaVersion: 1
mode: dry-run

capabilities:
  intake:
    enabled: true

mappings:
  labels:
    awaitingTriage: "status: triage"
```

The [quickstart](docs/quickstart.md) explains the shape of the configuration, and every file in
[`docs/examples/`](docs/examples/README.md) is parsed by the test suite. These documents describe the
current contract; they are not hosted-service installation instructions yet.

## Run the workspace

You need [Node.js](https://nodejs.org/) 24 or newer and [pnpm](https://pnpm.io/) 10.29.1.

```bash
pnpm install
pnpm -r test
```

All tracked tests run offline. No GitHub credentials or GitHub App configuration are required.

## Explore the project

<table>
  <tr>
    <td width="50%">
      <strong>Understand the system</strong><br><br>
      Follow one delivery in the <a href="design/trace.md">system trace</a>, then read the
      <a href="design/architecture.md">architecture</a> and <a href="design/decisions.md">decision register</a>.
    </td>
    <td width="50%">
      <strong>Use the contract</strong><br><br>
      Start with the <a href="docs/quickstart.md">quickstart</a>, then use the
      <a href="docs/configuration.md">configuration reference</a> and
      <a href="docs/troubleshooting.md">troubleshooting guide</a>.
    </td>
  </tr>
  <tr>
    <td width="50%">
      <strong>Contribute</strong><br><br>
      Read <a href="CONTRIBUTING.md">CONTRIBUTING.md</a> and choose an open
      <a href="https://github.com/hiero-hackers/sdk-automations/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22">good first issue</a>.
    </td>
    <td width="50%">
      <strong>Report a vulnerability</strong><br><br>
      Please use the private reporting process documented in <a href="SECURITY.md">SECURITY.md</a>.
    </td>
  </tr>
</table>

---

<p align="center">
  Apache-2.0 licensed · <a href="CODE_OF_CONDUCT.md">Code of Conduct</a> ·
  Developer Certificate of Origin required for contributions
</p>
