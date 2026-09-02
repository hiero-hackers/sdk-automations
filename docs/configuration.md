# Configuration reference

The App is controlled by `automations.yml` in your repository root. With App credentials, the shell
reads the file from the repository's default branch. Credential-free development and CI can use an
operator-maintained local copy through `CONFIG_FILE`. This page defines every shared key the parser
accepts today.

*The test suite locks this page's closed vocabularies—top-level keys, modes, meanings, and rejection
codes—against the code on every commit. Explanatory behavior still requires review.*

New here? Start with the [Quickstart](quickstart.md). Want a file to copy?
[`docs/examples/`](examples/).

## The file at a glance

5 top-level keys and three shared wrapper levels. The tree below is the entire shared shape; content
inside `settings` is deliberately capability-owned and may be deeper:

```yaml
schemaVersion: 1              # ── top level. Required — the only required key
mode: dry-run                 # ── top level. Optional, default: observe

capabilities:                 # ── top level. Optional, default: nothing enabled
  intake:                     #    └─ one block per capability, keyed by its name
    enabled: true             #       └─ boolean, default: false
    settings:                 #       └─ that capability's own options
      announce: true          #          └─ keys defined by the capability, not this schema

mappings:                     # ── top level. Optional, default: no meanings available
  labels:                     #    └─ the only key that may appear under mappings
    awaitingTriage: "status: triage"    # └─ one line per meaning: your label name
    ready: "status: ready for dev"

principals:                   # ── top level. Optional, default: none
  maintainerTeam: "hiero-sdk-js-maintainers"    # └─ one line per role: a single name
```

Two things that prevent most mistakes:

- In headings below, dots mean **nesting**, not key names: `capabilities.<name>.enabled` is the
  `enabled` line inside one capability's block, three levels deep.
- Any shared key not on this tree is an error. Inside `settings` the names are checked against the
  capability's own declaration; the values are not, and stay the capability's business.

Nothing is required except `schemaVersion`. Every default is non-writing—an empty file is valid and
produces an `observe` decision rather than an active effect.

## Key definitions

### `schemaVersion`

| | |
|---|---|
| Type | integer |
| Required | **yes**, unless the file is completely empty |
| Allowed | `1` |

Must be the unquoted number `1`. `"1"` is a string and is rejected. There is no version 2 yet, and the
migration/deprecation policy for any future version remains deliberately undecided.

### `mode`

| | |
|---|---|
| Type | string |
| Required | no |
| Default | `observe` |
| Allowed | `disabled`, `observe`, `dry-run`, `active` |

Core recognizes all four values. Whether `active` is honoured depends on the composition the endpoint
was started as: one that wires no write path — the shipped default — rejects it before a decision and
records `modeUnsupported`, explained in
[Troubleshooting](troubleshooting.md#it-never-got-as-far-as-deciding). Values are case-sensitive, and
unquoted `no` is a YAML boolean rather than a mode — quote anything you are unsure of.

| Mode | Reads | Reports | Records what it would do | Writes |
|---|---|---|---|---|
| `disabled` | yes | findings plus `modeDisabled` refusals | no | no |
| `observe` | yes | yes | yes—record-only | no |
| `dry-run` | yes | yes | yes—record-only, plus a `wouldApply` line naming each change | no |
| `active` | configuration only | unsupported-mode rejection | no | no |

Enabled capabilities and their declared resolvers run before the mode verdict, including in `disabled`.
`observe` and `dry-run` refuse identically; the difference is what they say. For every effect that
reaches the mode rule, `dry-run` adds one `wouldApply` finding naming the capability, the operation,
the item and the exact change — a rehearsal to read before promoting a repository to `active`. An
effect an earlier rule refused is never rehearsed, and nothing is prepared: no comment marker is
minted for a write that will not happen.

`active` is rejected before a decision by any composition that wires no write path, which is the
shipped default. See [Troubleshooting](troubleshooting.md#it-never-got-as-far-as-deciding).

`mode:` with no value after it is an error, not a default — the App will not pick a mode for you.

### `capabilities`

| | |
|---|---|
| Type | mapping of capability name → settings |
| Required | no |
| Default | `{}` — nothing enabled |

Keys are capability names in camelCase (`intake`, `prQuality`). Every name must belong to the
application's directly admitted capability list, whether `enabled` is `true` or `false`. Unknown
names fail closed instead of being retained as compatibility entries.

### `capabilities.<name>.enabled`

| | |
|---|---|
| Type | boolean |
| Required | no |
| Default | `false` |

Must be a real boolean. `"true"` in quotes, `yes`, and `1` are all errors — being switched on is
consent, and consent is not inferred from anything that merely looks true.

### `capabilities.<name>.settings`

| | |
|---|---|
| Type | mapping |
| Required | no |
| Default | `{}` |

The capability's own options. Every capability declares which setting names it reads, and a name outside
that list is an `unknownKey` error naming the exact path — so `annouce:` fails instead of configuring
nothing. Disabled blocks are checked too: a typo that waits for the day you flip `enabled` is the
surprise this rule exists to end.

Names only. The **values** are not validated, because they belong to the capability rather than to this
schema. A real capability must validate its own settings before it can ship; until then, enabling cannot
be treated as a pre-reviewed one-word activation.

Each capability only ever sees its own block. It cannot read another capability's settings.

### `mappings`

| | |
|---|---|
| Type | mapping with one key, `labels` |
| Required | no |
| Default | `{}` — no meanings available |

See [Label mappings](#label-mappings) below.

### `principals`

| | |
|---|---|
| Type | mapping of role name → a single name, as a string |
| Required | no |
| Default | `{}` |

Named people or teams a capability can refer to without hard-coding them. Values must be strings — a
list is an error.

## Label mappings

**Why this exists.** The App thinks in fixed meanings: `needsReview` is the same idea in every
repository. Your repository has its own words for it — `status: needs review`, `S-review`, `awaiting
review`. This mapping is the translation between the two, and it runs in one direction only: a
capability asks for a *meaning*, and the App looks up *your* label.

Two consequences worth knowing:

- **The App can only touch labels you list here.** A label you have not mapped is invisible to it. This
  is the main lever you have over its blast radius, and it is why the mapping is explicit rather than
  guessed from your label names.
- **Renaming a label is a one-line change here**, not a change to any capability.

### Do I have to map all of them?

No. **It depends on which capabilities you enable** — each one uses only the meanings it needs.

You are told in this file, not later in a report. Every capability declares the meanings it requires, and
enabling one whose meaning you have not mapped is a `meaningRequired` error naming the capability, the
meaning, and the line to add. A capability you leave disabled requires nothing.

Capabilities still skip themselves at report time when a meaning is missing, but that path is now only
reachable for a configuration the parser never saw — it is a safety net, not the thing you find out from.

Map nothing, enable nothing, and the App writes no labels at all — which is a legitimate way to run it.

| Meaning | Typical use |
|---|---|
| `awaitingTriage` | New, nobody has looked yet |
| `ready` | Triaged and available to pick up |
| `inProgress` | Someone is on it |
| `needsReview` | Waiting on a reviewer |
| `needsRevision` | Reviewer sent it back |
| `readyToMerge` | Approved, awaiting merge |
| `blocked` | Paused by a human — the App reads this and never sets it |

Rules: a label must be a non-empty string, and no two meanings may share one. The duplicate check
ignores case and surrounding spaces, but the label is otherwise used **exactly as written** — it has
to match your real GitHub label character for character.

## Rules that may surprise you

- **Any error rejects the whole file.** The shell stores one `configRejected` record, completes the
  delivery, and never evaluates capabilities with a partial or no-config fallback. Every error is reported
  at once, not one per push.
- **Unknown keys are errors, not ignored.** A typo like `capabilties:` fails loudly, and so does a
  `settings` key the capability never declared. Setting *values* remain the capability's own business.
- **An empty file, or no file, means `observe`.** Never `active`.
- **Duplicate keys are errors.** YAML would otherwise keep the last value silently — the one case
  where a typo could change your mode while the file still looks right.

## Every way the file can be wrong

The exact codes the App reports, and what to fix.

| Code | What it means |
|---|---|
| `documentUnparseable` | The YAML itself is broken; the message names the line and column |
| `duplicateKey` | The same key appears twice; delete one |
| `notAMapping` | Something is a list or a bare value where `key: value` pairs belong |
| `unknownKey` | A key the schema does not have — usually a typo. Includes a `settings` name the capability never declared |
| `schemaVersionUnsupported` | `schemaVersion` must be the number `1`, present and unquoted |
| `modeInvalid` | `mode` is not one of the four modes (check case and quoting) |
| `capabilityNameInvalid` | Capability names are camelCase, like `prQuality` |
| `capabilityEnabledNotBoolean` | `enabled` must be literally `true` or `false` — not `"true"`, not `1` |
| `capabilityUnknown` | The capability is not available in this application; remove its block or run an application that ships it |
| `meaningNotMappable` | A key under `mappings.labels` is not in the meanings table above |
| `meaningRequired` | An enabled capability needs a meaning you have not mapped; the message names the line to add |
| `labelInvalid` | A label that is empty, only spaces, or not a string |
| `labelNotInjective` | Two meanings map to the same label; give one a different name |
| `principalNotAString` | A principal must be a single name, as a string |
