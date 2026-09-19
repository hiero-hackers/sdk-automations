# Capabilities

> The App is in development and not yet installable. These pages describe the configuration it ships with.

A capability is one automation you switch on. Each one wakes on something GitHub tells the App —
a webhook, or the App's own schedule — reads the item it was woken for, and asks to write at most
what its row below says. It sees your mappings by their meaning (`awaitingTriage`, never your label's
spelling), its own block's keys, and nothing another capability was given.

## The shipped capabilities

<!-- generated: capabilities -->
| Capability | What it does | Wakes on | Needs mapped | Settings keys | May write | Design |
|---|---|---|---|---|---|---|
| `intake` | walk a new issue from opening to triage | the `issues` webhook | `labels.awaitingTriage` | `announce`, `unlockWhen`, `confirmUnlock` | the `awaitingTriage` label, at your spelling or the default; a comment it keeps up to date; a lock on an issue; an unlock | [design page](../packages/capabilities/src/intake/design.md) |
| `prDashboard` | one dashboard comment that tells a contributor what stops their pull request from being ready to review | the `pull_request` webhook, a schedule (hourly recheck of every open pull request) | nothing required | `checks`, `applyLabels` | a comment it keeps up to date; the `needsRevision`, `needsReview` labels, at your spelling or the default | [design page](../packages/capabilities/src/prDashboard/design.md) |
| `inactivity` | remind about stalled work, then release it | a schedule (hourly stale-assignment sweep) | nothing required | `exemptBlocked`, `remindAfter`, `reap`, `issues`, `pullRequests` | a comment it keeps up to date; an assignment's release, after a warning; a pull request's closure, after a warning | [design page](../packages/capabilities/src/inactivity/design.md) |
| `configReport` | one comment on a pull request that changes `automations.yml`, saying what the App would read from it | the `pull_request` webhook | nothing required | none | a comment it keeps up to date | [design page](../packages/capabilities/src/configReport/design.md) |
<!-- /generated -->

Three things to read off the table:

- **Settings keys are the ones the App reads today.** A design page's config block may show more,
  labelled as later phases. A key outside the list is refused as `unknownKey` with the exact path,
  whether the capability is enabled or not — see [configuration](configuration.md).
- **Needs mapped** is what the parser insists on before the capability may be enabled. A capability
  may read other meanings when you map them (`inactivity` reads `blocked` and `needsRevision`, and
  the `working` command), and says on its design page which rule each one unlocks.
- **A warning always comes first.** Any write marked "after a warning" is never done on first sight:
  the App posts the warning, waits out exactly the grace it announced, and cancels itself if the
  person acts in the meantime. Those outcomes are `graceRunning` and `activityCancelled` in
  [troubleshooting](troubleshooting.md).

The design page linked from each row is the standard that capability is built to. Its first two
sections — what the output looks like, and what the config looks like — are written for you; the
rest is for the people who build it.

## Every setting, with its default

Each block below goes under `capabilities.<name>:`, shown with the value the App uses when
you leave the key out; `docs/examples/full.yml` is the same catalogue with the options overridden.

<!-- generated: settings -->
### `intake`

```yaml
enabled: true
announce: false # default — Comment on a new issue to say it is waiting for triage, rather than only labelling it
unlockWhen: [] # none — Lock a new issue until a human adds one of these mapped workflow meanings
confirmUnlock: false # default — Comment when an approval meaning unlocks an issue
```

### `prDashboard`

```yaml
enabled: true
checks: # default — The quality checks this repository runs — each one off until it is enabled
  dcoSignoff: # off until enabled — Say so when a commit carries no Signed-off-by trailer
    enabled: true
    # guide: "…" — optional; A page explaining how to sign commits, shown to the contributor when this check fails
  gpgSignature: # off until enabled — Say so when a commit has no verified signature
    enabled: true
    # guide: "…" — optional; A page explaining how to sign commits, shown to the contributor when this check fails
  mergeConflicts: # off until enabled — Say so when the branch does not merge cleanly
    enabled: true
  linkedIssues: # off until enabled — Say so when a pull request references no issue
    enabled: true
    # guide: "…" — optional; A page explaining how to link an issue, shown to the contributor when this check fails
    assignedIssues: # off until enabled — Say so when the author is not assigned to every linked issue
      enabled: true
      # guide: "…" — optional; A page explaining how to get assigned, shown to the contributor when this check fails
applyLabels: [] # none — The positions the dashboard may set: needsRevision on any failure, needsReview when every check passes on a pull request that is ready for review
```

### `inactivity`

```yaml
enabled: true
exemptBlocked: true # default — Leave anything carrying the blocked meaning alone — no reminder, no release
remindAfter: 14d # default — Silence before a reminder, for every ladder and reason that sets none of its own
reap: # default — The release clock every ladder and reason inherits — consent is each acting level's own
  after: 21d # default — Silence before release — an issue is unassigned, a pull request closed
issues: # off until enabled — Run the ladder on assigned issues that have no open pull request
  enabled: true
  remindAfter: 14d # inherited from the level above — Silence before this level's reminder, taken from the level above when unset
  reap: # off until enabled — Release what this level reminded about — absent or off means remind and never act
    enabled: true
    after: 21d # inherited from the level above — Silence before this level's release, taken from the level above when unset
pullRequests: # off until enabled — Run the ladder on pull requests, linked to an issue or not
  enabled: true
  remindAfter: 14d # inherited from the level above — Silence before this level's reminder, taken from the level above when unset
  reap: # default — The release clock every reason below inherits — consent is each reason's own
    after: 21d # inherited from the level above — The release clock this ladder's reasons inherit, taken from the capability default when unset
  reapWhen: # default — The pull-request states the ladder applies in — one outside them is left alone
    draft: # off until enabled — Pull requests GitHub is holding as drafts — no mapping needed
      enabled: true
      remindAfter: 14d # inherited from the level above — Silence before this level's reminder, taken from the level above when unset
      reap: # off until enabled — Release what this level reminded about — absent or off means remind and never act
        enabled: true
        after: 21d # inherited from the level above — Silence before this level's release, taken from the level above when unset
    changesRequested: # off until enabled — Pull requests a reviewer has asked for changes on — no mapping needed
      enabled: true
      remindAfter: 14d # inherited from the level above — Silence before this level's reminder, taken from the level above when unset
      reap: # off until enabled — Release what this level reminded about — absent or off means remind and never act
        enabled: true
        after: 21d # inherited from the level above — Silence before this level's release, taken from the level above when unset
    needsRevision: # off until enabled — Pull requests carrying your needsRevision label, where a quality failure moves fast
      enabled: true
      remindAfter: 14d # inherited from the level above — Silence before this level's reminder, taken from the level above when unset
      reap: # off until enabled — Release what this level reminded about — absent or off means remind and never act
        enabled: true
        after: 21d # inherited from the level above — Silence before this level's release, taken from the level above when unset
```

### `configReport`

No settings. `configReport` declares no keys, so its block holds `enabled` and nothing else.
<!-- /generated -->

## How the App wakes

**Webhooks.** GitHub POSTs one delivery per event; the App verifies it, records it, and evaluates
every enabled capability that declared that event. Nothing happens for an event no capability
declared.

**The schedule.** Every hour the App sweeps every open issue and pull request and evaluates the
scheduled capabilities against each one, with the clocks a webhook cannot carry: how long an
assignment has been quiet, whether a linked pull request is open, when the last review landed. A
contributor resets their own clock by typing the mapped `working` command in a comment, or by
pushing.

Both paths end the same way: a report per delivery naming every decision and why, and — in
`active` — the writes. In `dry-run` the report names each write the App would have made
instead. [Troubleshooting](troubleshooting.md) lists every code a report can carry.

## Turning one on

```yaml
capabilities:
  intake:
    enabled: true             # consent — literally true, nothing that looks like it
    announce: true            # this capability's own keys, from the table above
```

Then map the meanings its row needs. A block the capability cannot read — a number where a boolean
belongs, a ladder that reaps before it reminds — is a `settingInvalid` error on the file itself, named at
`capabilities.<name>.<path>`, so nothing runs until it is fixed. It never falls back to a default
you did not write; a setting you leave out takes the documented one.

[`docs/examples/full.yml`](examples/full.yml) enables every capability with every option
spelled out; [`docs/examples/inactivity.yml`](examples/inactivity.yml) is the scheduled one alone.

The test suite regenerates the table and the settings blocks on this page from the shipped
capabilities' own declarations on every commit (`pnpm contracts`). The explanations around them
still require review.
