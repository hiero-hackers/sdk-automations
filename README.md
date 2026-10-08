<p align="center">
  <img src="design/readme-wordmark.png" alt="SDK AUTOMATIONS" width="100%">
</p>

[![CI](https://github.com/hiero-hackers/sdk-automations/actions/workflows/ci.yml/badge.svg)](https://github.com/hiero-hackers/sdk-automations/actions/workflows/ci.yml) [![CodeQL](https://github.com/hiero-hackers/sdk-automations/actions/workflows/codeql.yml/badge.svg)](https://github.com/hiero-hackers/sdk-automations/actions/workflows/codeql.yml) [![License: Apache-2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE) [![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/hiero-hackers/sdk-automations/badge)](https://scorecard.dev/viewer/?uri=github.com/hiero-hackers/sdk-automations)

One GitHub App. Repository-owned configuration. Durable, explainable decisions.

Hiero SDK repositories repeat the same contributor-facing work: intake, triage, workflow labels,
pull-request checks, status reporting. This is one App that does it from a reviewed `sdk-automations.yml`
on each repository's default branch, decides one issue or pull request at a time, and writes down
what it decided and why. It is not a hosted service: it runs against a personal sandbox App, and
everything below is the tree as it stands.

## Who it is for

- **The maintainer** who writes `sdk-automations.yml` — [`docs/`](docs/README.md).
- **The operator** who runs the endpoint — [`docs/running.md`](docs/running.md).
- **The contributor** who changes the platform — [`CONTRIBUTING.md`](CONTRIBUTING.md).

## What one delivery does

1. **Verify** — GitHub POSTs; the receiver checks the HMAC over the exact bytes received.
2. **Accept** — those bytes become a durable row before the 202, so a crash after it loses nothing.
3. **Read** — a worker claims the row and reads `sdk-automations.yml` at the default branch, never at a
   pull request's head.
4. **Decide** — each enabled capability judges one item and asks for outcomes; the safety ladder
   gates every one of them, and a refusal carries a code an operator can look up.
5. **Apply** — an approved effect is journalled before it is sent, re-checked against a live read,
   sent, and confirmed by reading GitHub back. Writes happen only where the endpoint was started
   with the App's identity as well as its credentials; otherwise the pass records what it would do.
6. **Record** — the decision rows and the effect's facts outlive the process, and
   `pnpm shell:explain` reads them back.

## Read next

- [`docs/`](docs/README.md) — use it: the quickstart, every key, every code, and how to run it.
- [`design/trace.md`](design/trace.md) — one label from the webhook to the API call, then
  [`design/architecture.md`](design/architecture.md) for what each piece is and which rule holds it.
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — change it, and pick up a
  [good first issue](https://github.com/hiero-hackers/sdk-automations/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22).
- [`SECURITY.md`](SECURITY.md) — report a vulnerability privately.

## Run the tests

[Node.js](https://nodejs.org/) 24 or newer and [pnpm](https://pnpm.io/) 10.29.1.

```bash
pnpm install
pnpm -r test
```

Every tracked test runs offline: no GitHub credentials, no network, no App configuration.

---

Apache-2.0 licensed · [Code of Conduct](CODE_OF_CONDUCT.md) · Developer Certificate of Origin
required for contributions
