# Quickstart

> The Action is pre-1.0 and running in a pilot. A repository adopts it with two files; these pages describe what it does today.

Whether it runs as a GitHub Action in your repository or as an App an operator starts for you,
configure it with one file and one merge.

## Add the file

**1.** Create `sdk-automations.yml` in your repository root:

```yaml
mode: dry-run

capabilities:
  triageQueue:
    enabled: true

mappings:
  labels:
    awaitingTriage: "status: triage"
```

**2.** Edit the label name on the right to match your repository's triage label. A meaning you do not
list keeps its [default spelling](configuration.md#label-mappings), and a label the repository lacks is
defined when first needed; the [common setups](#common-setups) below map more as they need them.

**3.** Merge to your default branch; a config in an open pull request does not take effect. With App
credentials the shell reads that branch. Credential-free development and CI may point `CONFIG_FILE`
at a local copy.

That is the repository configuration. To run it as a GitHub Action in your own repository, see
[Installing](installing.md).

**For autocomplete**, put
`# yaml-language-server: $schema=https://raw.githubusercontent.com/hiero-hackers/sdk-automations/main/docs/automations.schema.json`
on the first line of `sdk-automations.yml`. Any editor with a YAML language server then completes every
key, shows the sentence beside it, and underlines a misspelt one as you type. It checks shape and
spelling; the App's parser is still the authority on the rest.

## What happens next

The App wakes on two things: a webhook from GitHub, and its own hourly schedule, which sweeps every
open issue and pull request for the capabilities that judge clocks. Either way it records a report
per delivery naming every decision and why. Anything the App would close or release is warned about
first, and the warning is honoured. [Capabilities](capabilities.md) says what each automation does
and what it may write.

A write needs the repository to select `active` and writes to be armed: by the workflow's
`arm-writes: "true"` under the Action ([Installing](installing.md#arming-writes)), by the operator
under the App, which is not hosted for general use yet. Use `observe` or `dry-run` until the writes
have been rehearsed. Unarmed, the Action decides `active` as `dry-run`, and the App rejects it
before any decision is made.

## Choosing a mode

| Mode | Use it when |
|---|---|
| `disabled` | You want every returned intent refused; enabled capability and resolver evaluation still runs |
| `observe` | You want a non-writing decision record; today it includes record-only requested effects |
| `dry-run` | You want the same non-writing record, plus a `wouldApply` line naming each change the App would make |
| `active` | You want approved changes applied where writes are armed, after a rehearsal |

`dry-run` is the rehearsal to read before `active`: nothing is written, and every effect that would
be is named.

The mode at the top of the file is the most any capability may do. To promote capabilities one at a
time, give a block its own lower `mode` and let the rest inherit the file's:

```yaml
mode: active
capabilities:
  triageQueue:
    enabled: true            # inherits active
  prDashboard:
    enabled: true
    mode: dry-run            # still rehearsing
```

A block may never state more than the file does. See
[`capabilities.<name>.mode`](configuration.md#capabilitiesnamemode).

## Common setups

**Triage only** — label incoming issues, touch nothing else:

```yaml
mode: dry-run
capabilities:
  triageQueue:
    enabled: true
mappings:
  labels:
    awaitingTriage: "status: triage"
```

**Full workflow with pull-request checks:**

```yaml
mode: dry-run
capabilities:
  triageQueue:
    enabled: true
    welcome: true
  prDashboard:
    enabled: true
    checks:
      linkedIssues:
        enabled: true
mappings:
  labels:
    awaitingTriage: "status: triage"
    ready: "status: ready for dev"
    inProgress: "status: in progress"
    needsReview: "status: needs review"
    needsRevision: "status: needs revision"
    readyToMerge: "status: ready to merge"
    blocked: "status: blocked"
principals:
  maintainerTeam: hiero-sdk-js-maintainers
```

## Or copy a tested file

Every file in [`docs/examples/`](examples/) is parsed by our test suite on every commit —
copy the one closest to what you want and edit the label names:

| File | What you get |
|---|---|
| [`full.yml`](examples/full.yml) | Every capability on, every mapping family filled, every option with a comment — the catalogue |
| [`inactivity.yml`](examples/inactivity.yml) | The scheduled capability alone: reminders and releases, with the defaults |
| [`active.yml`](examples/active.yml) | An active configuration; it writes only where writes are armed |
| [`observe-only.yml`](examples/observe-only.yml) | The same repository, reporting instead of acting |
| [`minimal.yml`](examples/minimal.yml) | Reports only, nothing enabled — the smallest useful file |
| [`empty.yml`](examples/empty.yml) | Nothing at all, spelled out |

## What's next

- **[Capabilities](capabilities.md)** — each automation, what it needs mapped, and what it may write
- **[Configuration](configuration.md)** — every key defined, with types, defaults, and every error code
- **[Troubleshooting](troubleshooting.md)** — what each reported code means, and what to do about it
