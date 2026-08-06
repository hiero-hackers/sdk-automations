# Contributing to sdk-automations

Thanks for considering it! This project follows the practices of the wider
Hiero / LF Decentralized Trust ecosystem, including the contributor covenant
used across the org (see [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)).

## Development setup

```sh
pnpm install
pnpm -r test
```

Node 24 is the tested floor: the packages declare `>=23.4` because `store/`
uses `node:sqlite`, and CI runs the suite on Node 24 and 25. No tokens or
credentials are needed for tracked code; the lab keeps credentials and raw
evidence in local-only, untracked paths.

## Sign your commits (DCO)

Sign every commit with `git commit -s`. The sign-off certifies that the change
is yours to contribute under the terms of the
[Developer Certificate of Origin](https://developercertificate.org). This
repository already runs the CNCF DCO check on pull requests; keeping
enforcement consistent across the org is a maintainer-side decision.

## Difficulty ladder

Every issue carries exactly one difficulty tier. If you are new here, start
with a [good first issue](https://github.com/hiero-hackers/sdk-automations/labels/good%20first%20issue);
the other tiers are
[beginner](https://github.com/hiero-hackers/sdk-automations/labels/beginner),
[intermediate](https://github.com/hiero-hackers/sdk-automations/labels/intermediate),
and [advanced](https://github.com/hiero-hackers/sdk-automations/labels/advanced).

## Ways to contribute

Contributing is not limited to pull requests. Reviewing open PRs, reproducing
reported issues, and writing well-scoped issues all help maintainers keep the
queue moving.

## Ground rules

- **Wait for assignment.** Comment on an issue if you plan to work on it, then
  wait for a maintainer to assign it before opening a PR.
- **Do not take too many issues at once.** Leave open issues for other
  contributors; one at a time keeps reviews healthy and the queue fair.
- **One fact, one place.** When a change copies a value another file owns, it
  links the owner instead. See the register in
  [design/decisions.md](design/decisions.md).
- **Every check gets a negative control.** An invariant test must prove it can
  fail, as the existing [checks/test/](checks/test/) files do.
- **Never weaken a mutation threshold to pass.** Lower a
  [`core/stryker.config.json`](core/stryker.config.json) floor only with a
  reason in the same diff.
- **Claims become invariants.** If a change makes a claim, expect to be asked
  which [check](checks/) keeps it true.
- **The lab's local layer stays local.** Credentials, raw evidence, and
  unscrubbed payloads must never be tracked; see
  [lab/README.md](lab/README.md).
- **`core/` stays pure.** No I/O and no clock reads in `core/`; the shell
  supplies observations, as documented in
  [core/README.md](core/README.md).

## Where the why lives

Design rationale is in [design/decisions.md](design/decisions.md), user-facing
documentation is in [docs/](docs/), and executable examples are in
[examples/](examples/). If your change makes a claim, expect a check to keep
it true.
