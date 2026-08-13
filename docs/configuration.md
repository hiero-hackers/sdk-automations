# Configuration reference

Everything the App does in your repository is controlled by one file: `.github/hiero-automations.yml`.
This page defines every key.

*Every table on this page is asserted against the code by the test suite, on every commit — the
reference cannot drift from the product.*

New here? Start with the [Quickstart](quickstart.md). Want a file to copy?
[`docs/examples/`](examples/).

## The file at a glance

5 top-level keys, 3 levels deep at most. The tree below is the entire shape — every key the
file can contain is on it, and indentation (two spaces per level) is the only structure YAML has:

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
- Any key not on this tree is an error, wherever it appears. The file cannot be extended, only
  filled in.

Nothing is required except `schemaVersion`. Every default is the inert one — an empty file is a
valid file, and it does nothing.

## Key definitions

### `schemaVersion`

| | |
|---|---|
| Type | integer |
| Required | **yes**, unless the file is completely empty |
| Allowed | `1` |

Must be the unquoted number `1`. `"1"` is a string and is rejected. There is no version 2 yet; when
there is, version 1 files keep working.

### `mode`

| | |
|---|---|
| Type | string |
| Required | no |
| Default | `observe` |
| Allowed | `disabled`, `observe`, `dry-run`, `active` |

Core recognizes all four values, but the runnable shell supports observe and dry-run only. Active is
reserved and rejected before a decision. Values are case-sensitive, and unquoted `no` is a YAML boolean
rather than a mode — quote anything you are unsure of.

| Mode | Reads | Reports | Records what it would do | Writes |
|---|---|---|---|---|
| `disabled` | no | says only that it is disabled | no | no |
| `observe` | yes | yes | no | no |
| `dry-run` | yes | yes | yes | no |
| `active` | configuration only | unsupported-mode rejection | no | no |

The executor is not connected. Active behavior will return only with a real GitHub effect and durable
recovery path.

`mode:` with no value after it is an error, not a default — the App will not pick a mode for you.

### `capabilities`

| | |
|---|---|
| Type | mapping of capability name → settings |
| Required | no |
| Default | `{}` — nothing enabled |

Keys are capability names in camelCase (`intake`, `prQuality`). Enabling a name that does not ship is
an error; **disabling** one is always fine, so a retired capability never breaks your file.

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

The capability's own options. The schema does not check what is inside; the capability does. Settings
are validated even when `enabled: false`, which is the supported way to stage a capability: get its
configuration reviewed and dormant now, then enable it later with a one-word diff.

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

No. **It depends on which capabilities you enable** — each one uses only the meanings it needs, and
skips itself entirely if one is missing, saying so in its report.

Today the App cannot tell you in advance which meanings a capability needs; you find out from the
report when it skips. That is a known gap and it will be closed by capabilities declaring their
meanings, so that enabling `intake` without `awaitingTriage` becomes an error in this file rather than
a silence at runtime.

Map nothing and the App writes no labels at all — which is a legitimate way to run it.

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

- **Any error rejects the whole file**, and the App then behaves as if there were no file: it watches
  and writes nothing. Every error is reported at once, not one per push.
- **Unknown keys are errors, not ignored.** A typo like `capabilties:` fails loudly instead of
  silently disabling everything you thought you had enabled.
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
| `unknownKey` | A key the schema does not have — usually a typo |
| `schemaVersionUnsupported` | `schemaVersion` must be the number `1`, present and unquoted |
| `modeInvalid` | `mode` is not one of the four modes (check case and quoting) |
| `capabilityNameInvalid` | Capability names are camelCase, like `prQuality` |
| `capabilityEnabledNotBoolean` | `enabled` must be literally `true` or `false` — not `"true"`, not `1` |
| `capabilityNotInRegistry` | You enabled a capability that does not exist |
| `meaningNotMappable` | A key under `mappings.labels` is not in the meanings table above |
| `labelInvalid` | A label that is empty, only spaces, or not a string |
| `labelNotInjective` | Two meanings map to the same label; give one a different name |
| `principalNotAString` | A principal must be a single name, as a string |
