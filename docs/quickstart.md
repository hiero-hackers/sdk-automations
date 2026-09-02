# Quickstart

> The App is in development and not yet installable. These pages describe the configuration it ships with.

Set up in two minutes: one file, one merge, no per-repository installation.

## Add the file

**1.** Create `automations.yml` in your repository root:

```yaml
schemaVersion: 1
mode: dry-run

capabilities:
  intake:
    enabled: true

mappings:
  labels:
    awaitingTriage: "status: triage"
    ready: "status: ready for dev"
    inProgress: "status: in progress"
    needsReview: "status: needs review"
    blocked: "status: blocked"
```

**2.** Edit the label names on the right to match your repository's labels. Only labels you list
here are ever touched.

**3.** Merge to your default branch; a config in an open pull request does not take effect. With App
credentials the shell reads that branch. Credential-free development and CI may point `CONFIG_FILE`
at a local copy.

That is the whole setup.

## What happens next

The runnable shell observes deliveries and records a report explaining what it found. Active GitHub
writes and effect recovery are not implemented.

## Choosing a mode

The runnable shell supports `disabled`, `observe` and `dry-run`. It rejects `active` configuration before
making a decision unless the endpoint was started with a write path wired, which is not the default.

| Mode | Use it when |
|---|---|
| `disabled` | You want every returned intent refused; enabled capability and resolver evaluation still runs |
| `observe` | You want a non-writing decision record; today it includes record-only requested effects |
| `dry-run` | You want the same non-writing record, plus a `wouldApply` line naming each change the App would make |
| `active` | Unsupported unless the endpoint wires a write path |

`dry-run` is the rehearsal to read before `active`: nothing is written, and every effect that would
be is named.

## Common setups

**Triage only** — label incoming issues, touch nothing else:

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

**Full workflow with pull-request checks:**

```yaml
schemaVersion: 1
mode: dry-run
capabilities:
  intake:
    enabled: true
    settings:
      announce: true
  prQuality:
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
| [`active.yml`](examples/active.yml) | A reserved active configuration that the runnable shell rejects |
| [`observe-only.yml`](examples/observe-only.yml) | The same repository, reporting instead of acting |
| [`minimal.yml`](examples/minimal.yml) | Reports only, nothing enabled — the smallest useful file |
| [`empty.yml`](examples/empty.yml) | Nothing at all, spelled out |

## What's next

- **[Configuration](configuration.md)** — every key defined, with types, defaults, and every error code
- **[Troubleshooting](troubleshooting.md)** — what each reported code means, and what to do about it
