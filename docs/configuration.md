# Configuration reference

The App is controlled by `sdk-automations.yml` in your repository root. With App credentials, the shell
reads the file from the repository's default branch. Credential-free development and CI can use an
operator-maintained local copy through `CONFIG_FILE`. This page defines every shared key the parser
accepts today.

*The test suite locks this page's closed vocabularies—top-level keys, modes, meanings, and rejection
codes—against the code on every commit. Explanatory behavior still requires review.*

New here? Start with the [Quickstart](quickstart.md). Want a file to copy?
[`docs/examples/`](examples/).

## The file at a glance

5 top-level keys and two shared wrapper levels. The tree below is the entire shared shape; what a
capability writes inside its own block is deliberately capability-owned and may be deeper:

```yaml
schemaVersion: 2              # ── top level. Required for the flat capability shape
mode: dry-run                 # ── top level. Optional, default: observe

capabilities:                 # ── top level. Optional, default: nothing enabled
  triageQueue:                     #    └─ one block per capability, keyed by its name
    enabled: true             #       └─ boolean, default: false
    welcome: true            #       └─ that capability's own options, keys defined by it

mappings:                     # ── top level. Optional, default: no meanings available
  labels:                     #    └─ one of four families that may appear under mappings
    awaitingTriage: "status: triage"    # └─ one line per meaning: your label name
    ready: "status: ready for dev"
  commands:                   #    └─ the words contributors type
    assign: "/assign"
  skills:                     #    └─ the difficulty ladder, as labels
    goodFirstIssue: "good first issue"
  alerts:                     #    └─ YOUR alert names, each carried by a label
    p0: "P0-🔥"

principals:                   # ── top level. Optional, default: none
  maintainerTeam: "hiero-sdk-js-maintainers"    # └─ one line per role: a single name
```

Two things that prevent most mistakes:

- In headings below, dots mean **nesting**, not key names: `capabilities.<name>.enabled` is the
  `enabled` line inside one capability's block, three levels deep.
- Any shared key not on this tree is an error. Inside a capability's block the names beside
  `enabled` and their values are checked against the capability's own declaration.

Nothing is required. Every default is non-writing—an empty file is valid and produces an `observe`
decision rather than an active effect.

## Key definitions

### `schemaVersion`

| | |
|---|---|
| Type | integer |
| Required | no |
| Default | `1` |
| Allowed | `1`, `2` |

Leave it out and the file is version 1. Version 1 keeps capability options inside `settings:`.
Version 2 puts those options beside `enabled` and must state `schemaVersion: 2`. Quoted numbers and
an empty `schemaVersion:` are rejected.

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
| Type | mapping of capability name → that capability's block |
| Required | no |
| Default | `{}` — nothing enabled |

Keys are capability names in camelCase (`triageQueue`, `prDashboard`). Every name must belong to the
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

### `capabilities.<name>.<key>`

| | |
|---|---|
| Type | whatever that setting declares — a boolean, a number, a list, or a block of its own |
| Required | no |
| Default | the capability's documented value for that key |

A version 2 capability's options sit beside its `enabled`, on the same level. Version 1 keeps the
same options inside `settings:`. Every capability declares which setting names it reads, and a name outside
that list is an `unknownKey` error naming the exact path — so `annouce:` fails instead of configuring
nothing. Using one version's shape with the other version is also rejected. Disabled blocks are checked
too: a typo that waits for the day you flip `enabled` is the surprise this rule exists to end.

Names AND values, in one pass. The same declaration says what each setting may hold, so a number where a
boolean belongs, or a clock that reaps before it reminds, is a `settingInvalid` error naming the exact
path — checked with the rest of the file, before anything runs. A value you leave out takes the
capability's documented default. The keys each capability reads are listed on
[capabilities](capabilities.md).

Each capability only ever sees its own block — the keys beside its own `enabled`, and nothing
another capability was given.

**A clock is a duration, written as a whole number with a unit.** `4h` and `14d` are clocks; `14`
is not, and neither are `2w`, `90m` or `1d4h` — the App refuses a bare number with the spelling it
should have had. One day is twenty-four hours, the shortest wait before anything is released or
closed is two hours, and the longest clock of any kind is `36500d`, a century.

**What `0` means is per key, and the key's own sentence says it.** There is no global rule: for one
setting `0h` is "immediately" (`remindAfter: 0h` warns on the first sweep that sees the item), for
another `0` is "uncapped", and for another it is "nobody". The sentence beside each key on
[capabilities](capabilities.md) is where that is written, and where a key's sentence says nothing
about zero, zero is simply the number.

### Making two capabilities work together

**The label vocabulary is the only channel there is.** Capabilities cannot read each other's blocks,
call each other, or run in an order you choose — that isolation is deliberate, and it is what lets
you enable one without reasoning about the rest. What one capability *writes* another can *read*,
because both speak the same meanings: `prDashboard` applies your `needsRevision` label to a pull
request that is failing its checks, and `inactivity`'s `reapWhen.needsRevision` is a clock that runs
on pull requests carrying it. Wire that up by mapping the meaning once under `mappings.labels` and
naming it in both blocks. Everything else — settings, timing, comments — stays isolated by design,
so if you are looking for a way to make one capability wait for another, there is not one.

### `mappings`

| | |
|---|---|
| Type | mapping with up to four keys: `labels`, `commands`, `skills`, `alerts` |
| Required | no |
| Default | every label meaning at its default spelling (the table under [Label mappings](#label-mappings)); no commands, skills or alerts |

See [Label mappings](#label-mappings) below, then [Command mappings](#command-mappings),
[Skill mappings](#skill-mappings) and [Alerts](#alerts).

### `principals`

| | |
|---|---|
| Type | mapping of role name → a single name, as a string |
| Required | no |
| Default | `{}` |

Named people or teams a capability can refer to without hard-coding them. Each value is a single
non-empty string — a list is an error, and so is an empty name: a capability that addresses a
principal writes `@` in front of whatever you put here, so a blank one would ping nobody and say
nothing about it. A bare login and an `org/team` slug are both fine; the App does not check which
you wrote.

## Label mappings

**Why this exists.** The App thinks in fixed meanings: `needsReview` is the same idea in every
repository. Each meaning has a default spelling, and a repository that maps nothing uses those. Your
repository may have its own words for it — `S-review`, `awaiting review` — and this mapping is the
translation, one meaning at a time, in one direction only: a capability asks for a *meaning*, and the
App looks up *your* label.

Two consequences worth knowing:

- **The App touches only the labels of the meanings the capabilities you enable ask for**, under the
  spelling in force — yours where you mapped one, the default otherwise. Enable nothing and it writes
  no labels at all.
- **Renaming a label is a one-line change here**, not a change to any capability.

### Do I have to map at all?

No. Map a meaning only when you want your own spelling for it. A spelling you give one meaning that
is another unmapped meaning's default is refused, so two meanings never share a label.

The other families have no defaults: enabling a capability whose command, skill or alert you have not
mapped is a `meaningRequired` error naming the capability, the meaning, and the line to add. A
capability you leave disabled requires nothing.

### Which labels will it use?

The report the App posts on a pull request that edits this file lists, under each enabled
capability, the labels it may set at the spelling in force, and the colour each would be defined
with if the repository lacks it. That is the moment to map your own name instead. There is no global
"no labels" switch: a capability whose whole act is a label is switched off by disabling it, and one
where the label is one act among several lists the positions it may set, like prDashboard's
`applyLabels`, which left empty labels nothing.

| Meaning | Typical use | Default spelling | Defined as, when the repository lacks it |
|---|---|---|---|
| `awaitingTriage` | New, nobody has looked yet | `status: triage` | `#fbca04` New; waiting for a maintainer to triage |
| `ready` | Triaged and available to pick up | `status: ready` | `#0e8a16` Triaged and ready to be picked up |
| `inProgress` | Someone is on it | `status: in progress` | `#1d76db` Someone is working on it |
| `needsReview` | Waiting on a reviewer | `status: needs review` | `#5319e7` Waiting for a maintainer's review |
| `needsRevision` | Reviewer sent it back | `status: needs revision` | `#d93f0b` Changes are needed before review |
| `readyToMerge` | Approved, awaiting merge | `status: ready to merge` | `#006b75` Approved and waiting to merge |
| `blocked` | Paused by a human — the App reads this and never sets it | `status: blocked` | `#b60205` Paused by a person; every clock waits |

Rules: a label must be a non-empty string, and no two meanings may share one. The duplicate check
ignores case and surrounding spaces, but the label is otherwise used **exactly as written** — it has
to match your real GitHub label character for character.

### Do I have to create the labels?

No. A label the repository lacks, default or mapped, is defined by the App the first time it needs
it, with the colour and description in the table above. A label you created is used exactly as it
is — its colour, its description — and is never edited. Create your own when you want your own look.

## Command mappings

The same translation, for the words a contributor types in a comment. The App knows three acts; your
repository chooses what each is called, so a project already telling people to write `/take` keeps
saying `/take`.

```yaml
mappings:
  commands:
    assign: "/assign"       # claim an issue
    unassign: "/unassign"   # give it back
    working: "/working"     # "still on it" — resets the inactivity clock
```

Rules: a command must be a non-empty string **starting with `/`**, and no two acts may share one. As
with labels, the duplicate check ignores case and surrounding spaces, because a comment typed
`/Assign` is the same instruction as `/assign`. A bare word is rejected rather than silently given a
slash — a command nobody can type is worse than an error.

Map nothing here and no command works. An unmapped act is invisible, exactly as an unmapped label is.

## Skill mappings

The difficulty ladder, as labels. Four tiers, easiest first — the **order is fixed**, and it is what
"at least beginner" means to a capability that gates on tiers.

```yaml
mappings:
  skills:
    goodFirstIssue: "good first issue"
    beginner: "skill: beginner"
    intermediate: "skill: intermediate"
    advanced: "skill: advanced"
```

Rules: the same as labels — a non-empty string, no two tiers sharing one, duplicates judged ignoring
case and surrounding spaces. One rule more: **a label cannot be both a tier and a meaning.** Tiers and
meanings are both real GitHub labels, so `status: ready` cannot appear under both `labels` and
`skills`; the App would have no way to read it back.

## Alerts

The three families above are **closed**: the App names the meanings and you choose the words. This
one is **open** — you name the meanings as well, because an alert has no meaning to the App beyond
"a capability's settings may refer to it".

```yaml
mappings:
  alerts:                     # you invent these names
    p0: "P0-🔥"
    security: "Security"
```

Three things worth knowing:

- **An entry is a label, written exactly as the three closed families write theirs.** Alert names are
  camelCase like every other key, and the same rules apply to the label: a non-empty string, no two
  alerts sharing one, duplicates judged ignoring case and surrounding spaces.
- **The names are yours, so nothing can require one.** A capability may say "notify this principal
  about `p0`", and if you never mapped `p0` that setting is reported as an error naming the alert.
- **The one label namespace still holds.** An alert label cannot also be a position or a tier: the
  App would have no way to read it back. This family is read last, so the label you are told to
  change is the one under `alerts`.

## Rules that may surprise you

- **Any error rejects the whole file.** The shell stores one `configRejected` record, completes the
  delivery, and never evaluates capabilities with a partial or no-config fallback. Every error is reported
  at once, not one per push.
- **Unknown keys are errors, not ignored.** A typo like `capabilties:` fails loudly, and so does a
  setting the capability never declared. Setting *values* remain the capability's own business.
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
| `unknownKey` | A key the schema does not have — usually a typo. Includes a setting name the capability never declared |
| `schemaVersionUnsupported` | A stated `schemaVersion` is not the unquoted number `1` or `2` — omit the key and it is `1` |
| `modeInvalid` | `mode` is not one of the four modes (check case and quoting) |
| `capabilityNameInvalid` | Capability names are camelCase, like `prDashboard` |
| `capabilityEnabledNotBoolean` | `enabled` must be literally `true` or `false` — not `"true"`, not `1` |
| `capabilityUnknown` | The capability is not available in this application; remove its block or run an application that ships it |
| `settingInvalid` | A value in a capability's block is not what that setting takes — the message names the path and what it must be |
| `meaningNotMappable` | A key under `mappings.labels` is not in the meanings table above |
| `meaningRequired` | An enabled capability needs a mapping you have not made; the message names the line to add |
| `labelInvalid` | A label that is empty, only spaces, or not a string |
| `labelNotInjective` | Two meanings map to the same label; give one a different name |
| `commandNotMappable` | A key under `mappings.commands` is not one of `assign`, `unassign`, `working` |
| `commandInvalid` | A command that is empty, not a string, or does not start with `/` |
| `commandNotInjective` | Two acts map to the same word; give one a different one |
| `skillNotMappable` | A key under `mappings.skills` is not one of the four tiers |
| `skillInvalid` | A tier label that is empty, only spaces, or not a string |
| `skillNotInjective` | Two tiers share a label, or a tier uses a label `mappings.labels` already claims |
| `alertInvalid` | An alert name that is not camelCase, or a label that is empty, only spaces, or not a string |
| `alertNotInjective` | Two alerts share a label, or an alert uses a label another family already claims |
| `principalNameInvalid` | A principal name is not camelCase, like `maintainerTeam` |
| `principalNotAString` | A principal must be a single non-empty name, as a string |
