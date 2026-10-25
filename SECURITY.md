# Security

SDK Automations is a configuration-driven automation engine, pre-1.0 and in a pilot. It runs as a
GitHub Action inside a consuming repository's own workflow, or as a hosted App shell; the pilot
uses the Action. This document states the current posture honestly rather than aspirationally.

## Key posture

- As an Action, a run can write only what its workflow's `permissions:` block grants; the documented
  block is `contents: read`, `issues: write`, `pull-requests: write`
  ([`docs/installing.md`](docs/installing.md)). It writes nothing unless the configuration says
  `active` and the workflow sets `arm-writes: "true"`.
- The Action's workflow has no checkout step, so a `pull_request_target` run never executes a pull
  request's code; the configuration is read through the API from the default branch only.
- Configuration is fail-closed: a rejected file decides nothing, and the engine never runs with a
  partial or fallback configuration.
- No production credentials live in tracked code. `packages/dev/lab/` keeps credentials and
  raw evidence in local-only, untracked paths, and `.env` is never tracked.
- `packages/core/` is pure logic: no I/O and no clock reads; the runtime supplies observations.
- The hosted App shell verifies webhook signatures in
  [`packages/core/src/github/signatures.ts`](packages/core/src/github/signatures.ts).

## Supply chain

- GitHub Actions are pinned to full commit SHAs with version comments, and
  permissions are the smallest set each workflow needs.
- CI runs on `pull_request`, deliberately not `pull_request_target`, so fork
  code executes with a read-only token and no secrets.
- `pnpm install --frozen-lockfile` keeps dependency resolution reproducible;
  `pnpm audit --audit-level moderate` runs on every push and pull request.
- The test pipeline runs typecheck and tests on Node 24 and 25, plus line and mutation gates for the
  packages that declare them (`capabilities`, `core`, and `runtime` currently).
- Contributions are signed off with `git commit -s`; maintainers enforce the
  DCO.

## Supported versions

| Version | Supported |
|---|---|
| The latest release, behind the `v0` tag | Yes — a fix ships as a new release and `v0` moves to it |
| `main` | Yes |
| Older releases | No — move to the latest |

A vulnerability here can affect every repository that runs it, within the permissions its token
grants.

## Reporting a vulnerability

**Report privately at
<https://github.com/hiero-hackers/sdk-automations/security/advisories/new>** —
GitHub's private vulnerability reporting. Please do not open a public issue for
a suspected vulnerability.

If that page is unavailable to you, report it through the LFDT (Hyperledger) in the Hiero section
Discord at <https://discord.com/invite/hyperledger> and ask to reach a
maintainer of `hiero-hackers/sdk-automations` privately. Do not include the
details of the report in a public channel.

**What to expect.** Expect an acknowledgement within **7 days**, an initial assessment within **14 days**,
and a fix or a documented decision not to fix before any public disclosure. 

Security-sensitive design discussion that is *not* a vulnerability report
belongs in [`design/guides/threat-model.md`](design/guides/threat-model.md), where
open threats and required controls are tracked explicitly.
