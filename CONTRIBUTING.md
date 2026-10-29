# Contributing

Thanks for being here. This repository builds contributor-facing automation that runs as a GitHub
Action or a hosted App, and it is deliberately test-heavy: most rules you meet are enforced by a
check rather than by review, so the suite tells you when something is wrong faster than a maintainer
can.

## Setup

```bash
pnpm install
pnpm -r test
```

That is the whole setup. **No tokens, credentials, or GitHub App configuration are needed for any
tracked code** — every test runs offline, including the ones that walk a real captured webhook
payload end to end.

Node 24 or newer — every package's `engines` floor. `node:sqlite` (which the store depends on) only
needs 23.4 unflagged, but Node 23 was never an LTS release and is past its own end of life, so the
floor tracks the oldest runtime CI actually tests: both 24 and 26, because that API is still
experimental and can change between majors.

Useful while working:

```bash
pnpm --filter @hiero-hackers/automation-core test
```

```bash
pnpm lint
```

```bash
pnpm format
```

```bash
pnpm contracts
```

```bash
pnpm smoke:action
```

`pnpm contracts` regenerates the tables in `design/contracts/catalogue.md`, `design/contracts/facts.md`,
`design/contracts/safety.md` and `docs/capabilities.md` from the registries and folders that own them —
run it when a drift check reports one of those blocks, rather than editing the markdown by hand.
`pnpm smoke:action` builds the Action's bundle and runs it as a repository would, against a fake
GitHub, once per captured event and once on the schedule; CI runs it on every push.

CI runs `pnpm format:check` and fails the build on a formatting difference, so run `pnpm format`
before pushing — or let your editor do it. Prettier is formatter-only here and markdown is excluded;
what it covers is [`.prettierignore`](.prettierignore)'s business, not this page's.

## Sign your commits (DCO)

Every commit needs a Developer Certificate of Origin sign-off:

```bash
git commit -s -m "your message"
```

That appends a `Signed-off-by:` line. It is not a copyright assignment — it is you certifying that
you wrote the change, or have the right to submit it, under the project's licence. The full text is
at [developercertificate.org](https://developercertificate.org/).

If you forget on your last commit: `git commit --amend -s --no-edit`.

The repository's DCO check enforces this on every pull request. `-s` is the required sign-off; GPG/SSH
commit signing (`-S`) is a separate optional mechanism and is not required by this guide.

## Which issue to pick

Every issue carries **exactly one** difficulty label, and the ladder runs:

[`good first issue`](https://github.com/hiero-hackers/sdk-automations/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22)
→ [`beginner`](https://github.com/hiero-hackers/sdk-automations/issues?q=is%3Aissue+is%3Aopen+label%3A%22beginner%22)
→ [`intermediate`](https://github.com/hiero-hackers/sdk-automations/issues?q=is%3Aissue+is%3Aopen+label%3A%22intermediate%22)
→ [`advanced`](https://github.com/hiero-hackers/sdk-automations/issues?q=is%3Aissue+is%3Aopen+label%3A%22advanced%22)

The label descriptions say what each tier assumes; the issue body says what the task needs. Start at
`good first issue` — the guidance in an issue gets thinner as the tier rises, on purpose.

## Working together

These are here because each one has actually cost this project time.

- **Claim one issue at a time.** Comment on the issue to claim it, finish it, then take the next.
  Self-assigning several at once blocks other contributors from work you are not yet doing.
- **You must be able to explain every line you submit.** AI assistance is fine and normal here — the
  maintainer uses it. What is not fine is submitting code or prose you cannot defend in review. See
  the [AI policy](AI_POLICY.md).
- **Answer the feedback on your open pull request before starting new work.** A review comment
  waiting for a reply is the most expensive thing in the queue; opening more work while it sits
  means nothing lands.
- **Small and finished beats large and nearly.** A focused pull request that makes the suite green
  is worth more than a broad one that needs three rounds.
- **A large change divides so that every piece merges green with the system still running.** Isolation
  comes from seams that already exist and from environment gates, not from feature flags. Measurement
  is its own piece and carries no code. Removing the scaffolding is the last piece, and it is what
  closes the issue. `packages/runtime/src/adapter/` is the
  worked example: auth, then the client, then one seam at a time behind the composition root's
  environment gate, and choosing the live path last.

## Ground rules for changes

Each of these is a rule the register earned the hard way; follow the link for the reasoning rather
than taking it on faith.

- **One fact, one place.** If a value, list, or rule already exists somewhere, derive it — do not
  restate it. This is the single most repeated finding in the project ([`design/constraints.md`](design/constraints.md), D76 and D77).
- **Every check gets a negative control.** A test that cannot fail is not a check; each invariant in
  [`packages/dev/checks/`](packages/dev/checks/) carries a "proves the check can fail" case, and yours should too.
- **Never weaken a gate to make it pass.** The mutation threshold in
  [`packages/core/stryker.config.json`](packages/core/stryker.config.json) breaks the build below 90 — if you
  cannot reach it, the answer is a better test, not a lower number.
- **A claim about code becomes an invariant; a claim about prose stays prose.** If your change asserts
  something the compiler or a test can hold — a vocabulary, a table of codes, a layer rule — add or
  extend the check in `packages/dev/checks`. A sentence that only another sentence could check is
  review's job, not a test's (the register rule in `design/constraints.md`).
- **Credentials and raw captures are never tracked.** The lab's local-only layer holds sandbox
  secrets and unscrubbed payloads; a test enforces this and a `git add -f` will fail the build
  ([`packages/dev/lab/README.md`](packages/dev/lab/README.md)).
- **Comments carry constraints, not narration.** Say what must stay true and cite the decision; the
  story belongs in the register ([`.claude/skills/docstrings/SKILL.md`](.claude/skills/docstrings/SKILL.md)).

## How the tests are built

The suite is the argument that this App may be trusted with someone else's repository, so its shape
is a rule rather than a habit.

- **A test follows its subject's reach.** There is one GitHub model: a capability's tests consume the
  same normalized facts the capability does, never a private Octokit response fake. Recorded external
  shapes live at the testkit/adapter boundary, promoted from a scrubbed capture with its provenance,
  and a hand-written fixture is labelled synthetic — it can prove a fault is handled and can never be
  cited as evidence of how GitHub behaves.
- **A fake must say where it is kinder or harsher than GitHub.** A stateful fake that remembers what a
  write did is honest, because "did the write land?" is the only question the applier asks; a scripted
  reader is a kindness you cannot see. Every departure — a read that refuses, a write that dies
  mid-call — is set by the test that needs it, one line above the assertion.
- **"Exhaustive" names its dimensions.** D52 survived an earlier exhaustive sweep because action class
  was held fixed. Property tests run on fixed seeds so a reproduced counterexample is distinguishable
  from a load-dependent timeout, and a fault test asserts that the fault it asked for actually fired.
- **The store keeps both of its suites.** Sequential histories against a reference model, and
  separately connected worker threads contending for real rows: neither substitutes for the other, and
  a SQLite claim cannot cancel an in-flight GitHub request, so the effect path owes its own oracle
  (D41).
- **Journal rows are pinned as bytes.** Every operation spells its call one way in
  `packages/runtime/test/shell/effects.test.ts`, because a resend reads those bytes back and an
  operator greps them. A new operation adds a row pin.
- **Coverage and mutation are gates, not reports.** CI runs the suite on Node 24 and 26, line coverage
  for every package that declares a threshold, and Stryker per owning package.
- **The checks read the working tree, not the index.** A file is judged before it is committed (D144),
  so a new module is cited, placed and covered on the run that introduces it.

What each ring owes before the App touches a repository it does not own: **every pull request** — the
affected unit, property and model tests, the repository invariants, typecheck, lint, format, the
coverage and mutation gates, and the security workflow checks; **the personal sandbox** — a real
installation and token path, an active reversible write, loss recovery, the kill switch, rollback;
**a volunteer pilot** — maintainer approval, a shadow comparison, a rehearsed rollback, and a named
operator with alerts.

## Where the "why" lives

- [`design/trace.md`](design/trace.md) — one label from the webhook to the API call, and what each
  noun means. **Start here** if the vocabulary is new.
- [`design/architecture.md`](design/architecture.md) — the system as diagrams, each naming the code
  or test that falsifies it.
- [`design/constraints.md`](design/constraints.md) — the register's binding subset: the rules a
  change can break, each with its reasoning, its costs, and what would reopen it. Its history —
  every row ever written — is [`design/history/decisions.md`](design/history/decisions.md).
- [`docs/`](docs/README.md) — user-facing configuration guide, with its closed code vocabularies
  guarded by repository checks and its explanatory prose owned by review.

Pull requests are reviewed by the maintainers listed in [`.github/CODEOWNERS`](.github/CODEOWNERS).
By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).
