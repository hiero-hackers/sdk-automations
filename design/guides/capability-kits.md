# The guard kit and the settings toolkit

> **The two kits every capability is written with.** Two small pieces of ordinary TypeScript that
> live in core beside the capability boundary. The first makes every `evaluate()` read as ordered
> guards the design doc's flowchart maps onto one-to-one; the second makes every `settings` file a
> declarative spec, which the PARSER walks once per file rather than the capability once per
> delivery. Neither is a DSL and neither has an interpreter: the kits remove freedom of SHAPE, not
> steppability — a reader steps through the guards top to bottom, and each one is an `if` they can
> read where it stands. Anything that would need an interpreter is refused here.

## 1. The shape every capability takes

```ts
async evaluate(facts, view, platform) {
    /** Why this guard exists, travelling with the guard. */
    if (isPausedByProjection(facts.position)) return [];                // §2, in the flowchart's order
    if (facts.position.kind === "conflict") return [];
    if (!view.settings.issues.enabled) return [];                       // §3, arriving typed
    return actOn(facts, view.settings, make);                           // the capability's own work
}
```

Two captions, always in this order: pass the guards, act. The guards are the flowchart's diamonds in
evaluation order; the act is its final box. There is no settings caption, because there is nothing
left to read: `view.settings` is what this repository's block RESOLVED to against the capability's own
spec, defaults applied, every value already judged with the rest of the file (§3.2). A capability with
no settings reads an empty object, so the shape does not vary. There is no loop: one record is one item
(`design/contracts/facts.md` §4), so a guard returns rather than continues.

Everything the guards do is ordinary control flow, which is the point: an early return NARROWS. A
guard that has ruled out a conflicted projection leaves the position branch behind it, and a guard
that has ruled out a disabled block leaves the enabled block — so nothing below re-reads what the
guard above already settled. The `clarity` skill's rules apply unchanged: a condition worth a name
gets one (`const notConflicted = …`), and one that reads plainly stays a plain `if`.

## 2. The three stops

A capability decides by STOPPING, and every stop it makes is one of three things. This is the rule
the ladder existed to enforce, kept without the ladder.

| The stop | How it is written | Who hears about it |
|---|---|---|
| **Silent** | `return []` / `continue` | nobody — the branch a flowchart writes as "nothing" |
| **An operator note** | `return platform.skip(summary, ...detail)` | the operator surface, once, under the capability's name |
| **A comment to the person** | an ordinary managed-comment intent through `platform.intent` | the person, and the operator through the intent's own explanation |

Only the last writes. The three are separate because a skip that explained where the design says
nothing is a behaviour change, and the capabilities' own suites pin the difference. Six of the eight
guards in the three built capabilities are the silent branch.

The kit is two verbs on the handle, and two stops the platform makes on a capability's behalf:

```ts
/** Stop and say why on the operator surface: one explanation, no intents. */
skip(summary: string, ...detail: readonly string[]): readonly never[];
/** The answer, or the evaluation ends as skipped with the platform's own explanation (D51). */
ask<Q>(query: Q, input: ResolverInput<Q>): Promise<ResolverOutput<Q>>;
```

`skip` returns `[]`, typed `readonly never[]` so `return platform.skip(…)` is assignable wherever an
`evaluate` returns its own intent union. `ask` ends the evaluation itself when the question goes
unanswered, so no `!answer.ok` branch is written. A closed item never reaches a capability unless it
declares `closed: true` (D59), and a label with no edge from the item's position is skipped by
`platform.intent` before the map refuses it.

Rules the kit fixes:

- **Guards are judgements, named for the question.** `notConflicted`, `stillOpen`, "has this
  repository mapped `awaitingTriage`?". A guard that needs data reads it where it stands.
- **Deny wins, and unknown is not a pass.** A resolver that could not answer is a skip, never a
  pass (D51). `ask` enforces it; the reviewer's test is for the rare raw `resolve`: does every
  `!answer.ok` branch stop, or deliberately carry on (the assignee filter)?
- **The order is the flowchart's, and that is a REVIEW rule.** Guards are written in the order the
  design doc reads its diamonds, so a reviewer can hold the two side by side. Advisory before
  destructive is a property of that order: the guard that would comment sits above any act that
  changes state. Nothing in the types enforces the order — the first promotion showed that a type
  which did cost only re-reads (D143).
- **No ladder type, and no combinator.** The ceiling is stated so it can be refused: a guard that
  wants to branch into two ladders has found two KINDS, and the capability branches on the record's
  kind into a file per ladder.

## 3. The settings toolkit — `capability/settings`

A settings file is a spec: a plain object whose values are field readers, built from a closed
vocabulary of constructors. The capability hands it to `declareCapability` as `settings`, and
`readSettings` walks it once per file — at parse time, from `config/sections.ts` — returning the typed
settings or the list of problems. Every constructor but `spec` also takes a `doc` — one sentence
saying what the key is — which `describe()` reports beside the field's kind, its default and what an
absent key reads as, so `describeSpec(spec)` is the whole of what a generated page, `full.yml` or an
editor schema is written from; a shipped key left without that sentence fails the repository checks.
The vocabulary is what the shipped capabilities' config sections need and
nothing more:

<!-- generated: constructors -->
| Constructor | Reads | Absent reads as |
|---|---|---|
| `flag({ default })` | a boolean | `default` |
| `duration({ default })` | a length of time, written 4h or 14d | `default` |
| `duration({ inherits })` | a length of time, written 4h or 14d | `inherited` |
| `count({ default })` | a whole number, zero or more | `default` |
| `text({ optional: true })` | a string | `null` |
| `text({ optional: false })` | a string | `problem` |
| `meanings()` | a list of mapped label meanings | `empty` |
| `logins()` | a list of GitHub logins | `empty` |
| `section(fields)` | a plain group of fields with no consent of its own | `default` |
| `block(fields)` | an enabled-block | `parked` |
<!-- /generated -->

`Absent reads as` is `describe().absent` off a real instance, in its own six words: `default` the
stated default, `inherited` the nearest enclosing level's value, `null` nothing, `empty` no entries,
`parked` a block read as `{ enabled: false }`, `problem` a value the file has to state. A value of the
wrong TYPE is a problem in every row, so no row says so.

**`problem` is a demand on DOCUMENTS, not only on this spec.** A required key is one every document
that enables the capability has to state, `docs/examples/full.yml` included. So a key made required
is a documentation edit per example that enables the capability, and the estimate is owed before the
key is added rather than after the first example goes red.

The rule each constructor carries beyond that is prose no `describe()` reports, and it is here:

- **`duration`** — a length of time, WRITTEN as a whole number with a unit and HELD as a whole
  number of hours. One spelling and no others: `4h`, `2d`, `14d`; `1d` is `24h`. No minutes, no
  weeks, no mixed units, no fractions, and a bare number is refused with the two strings it could
  have been (`write "14d" for days or "14h" for hours`). `default` is the written form and is
  parsed once, at construction — a spec that misspells its own default is a programming error, and
  this is the one constructor in the vocabulary that may throw. The cascade resolves reason →
  ladder → capability default, and the two floors and the ceiling ride on top of it (§3.1). The
  value is bounded above by `MAX_CLOCK_HOURS`, a century, because a clock becomes a date: a
  capability that renders the day it promises throws on a gap no `Date` can hold, and a bound is
  the only reading that catches that at the maintainer's own path.
- **`count`** — a whole number, zero or more, held as written. A fraction, a negative, a string
  such as `"2d"`, a boolean and `null` are each a problem. It has no ceiling and does not borrow
  `MAX_CLOCK_HOURS`: a count is never added to an instant. It does not cascade: an absent key reads
  its own `default`, never an enclosing level's. `0` means nothing the reader knows of; when a
  capability gives it a meaning such as "uncapped", the field's `doc` says so.
- **`text`** — for guide links and references. Never parsed, never followed. It is repository-written
  text, so a capability that prints one puts it through `inert()` first
  (`packages/core/src/capability/facts.ts`): a plain `https://host/path` survives that unchanged and
  GitHub still links it, while `_`, `(`, `)`, `#`, `&`, `~` and `!` come back backslash-escaped and
  the address stops being a link. A configured address is never rendered as a markdown link with the
  title as its text — the brackets and parentheses would be escaped with the rest — so a design
  writes "the Signing Guide (configured link)" and the comment prints title and address as text.
- **`meanings`** — each entry must be one this repository mapped in that family, and an unmapped
  one is a problem: a guard naming a meaning demands its mapping.
- **`logins`** — each entry must be spelled as a GitHub login, and is held lowercase because GitHub
  compares logins without case. It names people the repository chose, so nothing is read from
  GitHub to judge it: a listed login that left the project stays listed until someone removes it.
- **`section`** — the station the group configures is switched by its own flags (`onOpen`,
  `approval`, a skill tier, a pillar), never by a consent key it does not have.
- **`block`** — consent is `enabled: true` and nothing else. A block that is absent or says anything
  else is parked, and its other fields are NOT read.

**`text` is overloaded on `optional`**, and it is the only one in the vocabulary whose TYPE an
option changes: the required form reads `string`, not `string | null`, because a value the file has
to state is one the parser already made `null` impossible for. Nothing else in the vocabulary
narrows this way — a required `duration` is still a `number`, and there is no required list.

**Every group constructor sweeps its own keys** (D4). `section` and `block` each report a key the
spec does not name, at that key's own dotted path. D84's sweep reaches
the TOP of a settings block and stops, so a reader that walked its spec's keys and never looked at
the file's left a misspelt `mergedPRz:` counting nothing and saying nothing — the silent zero a
closed vocabulary exists to refuse. `block` counts `enabled` among its own keys, because consent is
not a field; a parked block sweeps nothing, having read nothing.

### 3.1 Cascades and relations

- **Most-specific-first.** `duration({ inherits: "remindAfter" })` inside a block resolves reason →
  ladder → capability default: the reader looks at the field's own value, then the enclosing
  block's, then the capability's root field of that name. The spec names the chain by naming the
  field; the reader does the walking.
- **A dotted `inherits` where the clock lives inside a group.** `duration({ inherits: "reap.after" })`
  is inactivity's release clock, which each level states inside its own `reap` block. Every
  enclosing level is read at the WHOLE path, so a level that writes `reap:` with no `after` in it is
  walked past rather than read as a clock nothing resolves — and the defaults walk descends the spec
  by the same path, so the document and the spec cannot disagree about which level answers. Only
  `section` and `block` may sit on such a path: the two open mappings are keyed by names the
  repository chose, and no spec may name a path through one.
- **The two floors, both from `safety/destructive`, both on the level that consents.**
  `above(target, by)` is a relation a `duration` field may declare, in HOURS:
  `after: duration({ inherits: "reap.after", above: ["remindAfter", MIN_GRACE_HOURS] })`. It is
  checked at every level where both resolve, after the cascade, and `MIN_GRACE_HOURS` — one hour —
  is the floor under whatever gap the spec states. The TARGET is resolved by `durationNamed`
  (`packages/core/src/capability/settings.ts`), which walks OUTWARD from the field's own scope the
  way the cascade does — so a field inside a block may name one on the capability's root, and
  `after` inside an `escalate:` block is compared against the `remindAfter` beside the block rather
  than against a sibling it has none of. A target that resolves nowhere is simply not compared. `atLeast` is the second floor, over the value
  itself: `MIN_REAP_HOURS` — two hours — is the smallest reap of any kind, and a destructive clock
  declares it (`after: duration({ …, atLeast: MIN_REAP_HOURS })`). Both constants are imported,
  never restated, and both are judged after the ceiling so a maintainer hears about the number they
  wrote rather than about a gap it made. Declare them ON THE LEVEL THAT CONSENTS and nowhere else: a
  level that only passes a clock down — inactivity's root `reap`, and its `pullRequests` ladder,
  whose reasons are what act — declares neither, because a default nobody acts on has nothing to
  refuse and the clock it hands on is judged where it lands, against the reminder of the level that
  will act on it.
- **Structural dependencies are structure.** `reapWhen` nests inside inactivity's `pullRequests`
  block, so the reasons are unreadable when the ladder is off; anywhere else `reapWhen` is
  `unknownKey` at parse time already (D84). A design stating "only when" says it by nesting.

### 3.2 Judged with the file, once

`readSettings(spec, names, block)` returns `{ ok: true, value }` or `{ ok: false, problems }`, each
problem a dotted path relative to the block, a sentence, and a CODE: `unknownKey` for a key the spec
does not name at any depth (D84), `settingInvalid` for everything else. The parser prefixes each path
with `capabilities.<name>` — the block is flat, so there is no `settings` segment between them — and
rejects the whole file. D38's rule, extended from key names to values, with D84's reasoning about
the typo that waits for the day someone flips `enabled`. So a
settings block is judged ONCE, with the rest of the document, and a capability is only ever handed a
block that was readable.

Nothing is reported per delivery any more. The per-delivery `unusable` path is retired: a capability
cannot meet a block it cannot read, because such a file produces no configuration at all. The one
settings rule the toolkit cannot state — a setting that DEMANDS a mapping, which is a cross-field rule
§3.3 refuses — stays a guard in the capability that needs it, spoken through `platform.skip` under the same
dotted path so a maintainer meets one wording either way. The same spec is what the pull-request
configuration check will render its annotations from (config-schema §7).

### 3.3 What a spec is not

No conditional fields, no cross-field computation beyond the two relations above, no defaults that
depend on another field's value, no custom reader functions in a spec. Where a design states a
cross-field rule — advancement's `noticeIssue` required by `noticeOn: trackingIssue` — the design's
config is what moves, to a structural form (a group under the choice that needs it), never the
toolkit. A design that needs a config shape the shipped capabilities do not have grows the vocabulary by one
constructor in this file with its rule stated — never by a hook in a capability.

## 4. Declined, with triggers

- **A schema library** (zod and kin): declined — the vocabulary is seven constructors with rules the
  designs state in prose, and a library's error shape would replace `ConfigError`'s. Reopen never.
- **A `Verdict` ladder with a `climb` combinator**: BUILT (D138) and removed (D143). It was the one
  shape whose cost the first promotion could measure, and the measurement was against it: a verdict
  carries no subject, so every enabled block a ladder narrowed was read a second time after the
  climb purely for the type, and a question about a sub-subject ran as a one-rung ladder inside a
  loop (`design/constraints.md`, D143). Its discipline is §2's rules. Reopening it means
  reopening `proceed(value)` and `runRung` together, and the trigger is evidence of the same kind:
  a capability whose guards cannot be read against its flowchart without one.
