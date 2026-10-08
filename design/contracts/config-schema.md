# Repository Configuration Contract

> **Built for the current shell** — `packages/core/src/config/` parses and validates the document;
> `packages/runtime/src/shell/decide/config.ts` fixes its repository path. The closed vocabularies below are locked by
> `packages/dev/checks/test/spec-drift.test.ts`, and every rejection shape is exercised by the in-package
> corpus in `packages/core/test/config/documents.ts`.

This is the contract the implementation satisfies today. Configuration reporting, mapped-label existence
checks, permission-readiness checks, inheritance, and schema migration are future work; they are listed in
§7 rather than written here as if they already ran.

## 1. Source and authority

- The repository file is **`sdk-automations.yml` at the repository root** (D93).
- With App credentials, the read adapter fetches it from the repository's default branch. Credential-free
  development and CI read an operator-maintained local copy through the same `ConfigSource` seam.
- An absent file and an empty file both produce the no-configuration result: `observe`, no capabilities,
  no mappings, and no principals.
- The file at a pull request's **head sha is a report input only**: the `configAtHead` resolver
  parses it with the same parser and hands a capability the result, and nothing decided under it
  ever becomes the repository's configuration, which stays the default branch's copy.
- A parsed configuration is stamped with the revision supplied by the caller. The revision is not a YAML
  key and is persisted with the delivery report.
- Configuration contains reviewed policy, never delivery, retry, effect, schedule, or audit state.

## 2. Document boundary

`parseConfigDocument` accepts YAML text and always returns a value; a hostile document does not escape as
an exception.

- Duplicate YAML keys are rejected. Keeping the last value could turn an earlier `mode: observe` into an
  effective `mode: active` without a visible validation error.
- Alias expansion is capped at ten. Configuration has no legitimate need for a large alias graph.
- The root and every named section that is documented as a mapping must actually be a mapping.
- Syntax errors and semantic errors carry a machine-readable code, a maintainer-facing message, and a
  dotted path where one exists. Where a path exists the error also carries the 1-based line it resolves
  to: the path is walked from the root, a mapping entry's line is its key's, and a path the document
  holds only part of lands on its nearest present ancestor (a missing `mappings.labels.ready` on the
  `labels:` line). The line is absent when nothing of the path is present or the document never became
  a mapping, and for the two syntax errors, whose message already carries a position. It is a hint for
  annotation; the code and the path remain the contract.
- One error anywhere rejects the whole document. The parser never salvages a valid-looking fragment from
  an invalid file (D38).

## 3. Schema shape

```yaml
schemaVersion: 2
mode: observe
capabilities:
  triageQueue:
    enabled: false
    welcome: true
mappings:
  labels:
    awaitingTriage: "status: awaiting triage"
    ready: "status: ready for dev"
  commands:
    assign: "/assign"
  skills:
    goodFirstIssue: "skill: good first issue"
principals:
  maintainerTeam: hiero-sdk-maintainers
```

The accepted top-level keys are exactly:

| Key | Current contract |
|---|---|
| `schemaVersion` | Optional; omission is version `1`. Version `1` keeps a capability's options under `settings:`; version `2` states `schemaVersion: 2` and puts them beside `enabled`. Every other stated value — a present null, a quoted number — is `schemaVersionUnsupported` (D151). A future format must state its own version to be read as one. |
| `mode` | Optional; omission defaults to `observe`, while a present null or invalid value is rejected. |
| `capabilities` | Optional mapping from an admitted capability name to a flat block: an `enabled` boolean and, beside it, the keys the capability's spec reads. |
| `mappings` | Optional; contains the `labels`, `commands` and `skills` families. |
| `principals` | Optional string-to-string mapping. |

Unknown keys are rejected at the top level, inside `mappings`, and inside each capability block.

### Capability admission

- Names use lower-camel configuration-key syntax: `/^[a-z][a-zA-Z0-9]*$/`.
- Every configured name must appear in the caller's directly admitted `knownCapabilities` list, even when
  `enabled: false`. Unknown and retired names are rejected with `capabilityUnknown`; there is no retirement
  tombstone in the current direct-set model (D58's earlier registry design no longer exists).
- Only the boolean value `true` enables a capability. Omission is false; strings and numbers are rejected.
- `enabled` is reserved at the top of a block, and a declaration naming it as a setting is refused at
  boot: the block is flat, so consent and a setting would be one key. Nested levels need no rule — the
  kit's own block constructors own their `enabled`.
- Every key of a block other than `enabled` IS a setting, and they are read together against the
  admitted capability's declared SPEC — the settings toolkit of `design/guides/capability-kits.md` §3.
  The spec's keys are the legal names, so an undeclared name is `unknownKey` at
  `capabilities.<name>.<key>`; its fields judge the values, so a value a field cannot read is
  `settingInvalid` at that value's own dotted path. Both apply whether the block is enabled or
  disabled (D84). A file written against the older shape, with the keys nested under a `settings:`
  wrapper, is therefore refused by name at `capabilities.<name>.settings` rather than read as a
  setting the capability declares. The value stored is what the spec RESOLVED, with every default
  applied.
- The VALUE read happens only when `mappings` and `principals` parsed, because a settings value may name
  one of their entries; the KEY sweep always runs. The file is rejected either way, and a value judged
  against a family that failed would name the wrong line — the rule the required-meaning check follows.
- Every admitted capability states a spec. There is no name-only admission: with the spec as the schema
  for a block, "admitted by name and nothing else" has no honest reading, and a caller that means "this
  capability takes no setting" says so with the empty spec.

### Mapping families

Families come in two kinds and share ONE reader (D127): a closed set of meanings, a non-empty
spelling, and injectivity judged under the family's own fold, with the maintainer's spelling kept for
writes. A CLOSED family's meanings are the platform's. An OPEN family lets the repository name the
meanings too, so the only question left about a key is its shape.

- **`labels`** (closed) — the mappable meanings in [`catalogue.md`](catalogue.md); the spelling is a
  GitHub label, folded by trimming and case-folding.
- **`commands`** (closed) — `assign`, `unassign`, `working`; the spelling is what a contributor types
  and must start with `/`, folded the same way.
- **`skills`** (closed) — `goodFirstIssue`, `beginner`, `intermediate`, `advanced`, in that ladder
  order; the spelling is a GitHub label.
- **`alerts`** (open) — the repository names each alert; the spelling is a GitHub label, folded as
  `labels`'s is.

- The label fold matches GitHub label-name uniqueness, so two meanings cannot map to spellings GitHub
  treats as the same label (D34, D55). The command fold matches what a contributor types.
- `skills` and `labels` share GitHub's label namespace, so one label cannot be both a position and a tier;
  the cross-family collision is `skillNotInjective`, reported at the tier that named it.
- The skill ladder's ORDER is the contract, not the set: a capability gating a tier compares by index.
- An OPEN family's entry is a bare spelling, exactly as a closed family's is, and its KEY is admitted
  on shape alone: any name matching the capability-name pattern, which is camelCase and dot-free like
  every other key the parser takes. A malformed name and a spelling that is not a non-empty string are
  one code. Notifications' native project field form (`{ field, value }`) is that design's phase 2;
  when the project-field read has an endpoint-matrix row the VALUE widens to a string-or-object union,
  and a widening accepts every file written against the bare form, so no schema version moves (D148).
- An open family's labels join the one label namespace too. It is read after the closed families, so a
  collision names the later spelling — the one a maintainer changes.
- No declaration may require an open family's entry: `requiredMappings` is checked against a closed
  meaning set, and an open family has none.
- Every label meaning has a default spelling (`LABEL_DEFAULTS`, D203): a document that maps nothing
  gets all seven, and `mappings.labels` overrides one meaning at a time. A spelling the document
  gives one meaning that is another unmapped meaning's default is `labelNotInjective`.
- A capability enabled without a mapping its declaration requires is `meaningRequired`, pathed at
  `mappings.<family>.<meaning>`. Disabled capabilities require nothing, and every missing mapping is
  reported at once (D84). Labels have defaults, so this reaches the other families only.
- The parser does **not** currently call GitHub to confirm that a mapped label exists. That is an
  activation check still to build.

## 4. Repository modes

| Mode | Current behavior |
|---|---|
| `disabled` | Core still evaluates enabled capabilities and declared resolvers, then refuses every screened intent with `modeDisabled`; it approves no effect. |
| `observe` | Core records findings and record-only intent explanations, never an effect to apply. This is the safe default. |
| `dry-run` | The same record-only decision path as `observe`, plus a `wouldApply` finding naming each effect that reached the mode rule. No identity is minted and nothing is prepared. |
| `active` | A valid core mode the shell honours only when it was composed with a write path: the shipped default records `modeUnsupported` before `decide()`, while a process started with `APP_SLUG` beside the credential triad applies effects, behind the standing gate — App-owned comment identity (D125) and the armed FX-gate protocol (`packages/dev/lab/protocols/8.2-first-effects.md`). |

For modes that reach `decide()`, the process kill switch is the first safety verdict for each returned
intent. It does not prevent capability or resolver evaluation, and the shell intercepts `active` before
`decide()`. A true transport/evaluation stop is deferred (D117). Capability enablement remains a separate
gate.

## 5. Failure behavior

Invalid configuration returns no partial `RepositoryConfig`. In the runnable shell it becomes one durable
`configRejected` record and the delivery completes: retrying the same webhook cannot repair the file, while
a later commit containing a fix arrives as a new delivery.

The following mitigations named by D38 are **not built yet**:

- a pull-request check annotating invalid `sdk-automations.yml` changes;
- a repository-visible effective-configuration or health report;
- permission diagnostics before capability evaluation.

`active` no longer waits on them: the default composition records `modeUnsupported` before `decide()`, and
the applier composition honours `active` when `APP_SLUG` arms it, behind the standing gate (D125,
protocol 8.2).

## 6. Rejection codes

| Code | Meaning |
|---|---|
| `documentUnparseable` | YAML could not be safely converted, including excessive alias expansion. |
| `duplicateKey` | The YAML repeats a key. |
| `notAMapping` | The document or a mapping-shaped section has another type. |
| `unknownKey` | A closed mapping contains an unsupported key. |
| `schemaVersionUnsupported` | `schemaVersion` is stated and is not the unquoted number `1` or `2`; absence is version `1`. |
| `modeInvalid` | `mode` is present but is not one of §4's values. |
| `capabilityNameInvalid` | A capability name is not a valid configuration key. |
| `capabilityEnabledNotBoolean` | `enabled` is present but is not a boolean. |
| `capabilityUnknown` | The application did not directly admit the configured capability name. |
| `settingInvalid` | A settings value the admitted capability's spec cannot read, at that value's own path — `capabilities.<name>.<key>`, with no `settings` segment. |
| `meaningNotMappable` | A label mapping names a meaning outside the closed catalogue. |
| `meaningRequired` | An enabled capability declares a meaning the document has not mapped. |
| `labelInvalid` | A mapped label is not a non-empty string. |
| `labelNotInjective` | Two meanings map to one GitHub-equivalent label name. |
| `commandNotMappable` | A command mapping names a command outside the closed set. |
| `commandInvalid` | A mapped command is not a non-empty string starting with `/`. |
| `commandNotInjective` | Two commands map to one word a contributor types the same way. |
| `skillNotMappable` | A skill mapping names a tier outside the ladder. |
| `skillInvalid` | A mapped tier label is not a non-empty string. |
| `skillNotInjective` | Two tiers map to one label, or a tier maps to a label a meaning already holds. |
| `alertInvalid` | An alert name is not a valid configuration key, or its label is not a non-empty string. |
| `alertNotInjective` | Two alerts map to one label, or an alert maps to a label an earlier family already holds. |
| `principalNameInvalid` | A principal name is not a valid configuration key. |
| `principalNotAString` | A principal value is not a string. |

## 7. Deliberately deferred

- Check mapped-label existence and live installation grants before activation.
- Build the pull-request validation check and effective-configuration report required by D38.
- Decide how a version-2 parser treats a version-1 file, and deprecation, retention and rollback policy (Q14); absence being version 1 is decided (D151).
- Add inheritance only if repeated repository demand justifies it; version 1 has none.
- Keep `active` unsupported in every composition that wires no write path, and keep the armed one behind
  the standing gate (D125, protocol 8.2) until that protocol has been re-run against the operations as
  they stand.

## 8. The editor schema

`docs/automations.schema.json` is JSON Schema draft 2020-12, generated from the shipped specs and the
top-level vocabulary by `pnpm contracts`, and served from the default branch for a
`# yaml-language-server: $schema=…` modeline. It is a shape-and-spelling check and nothing more: mapping
injectivity and the shared label namespace, a settings value naming a meaning or principal this file
maps, a `duration`'s ceiling and `above` relation and the cascade, and the enabled-capability required-mapping rule are
all cross-field and stay the parser's. The schema's own top-level `description` says so, so a maintainer
cannot read a green editor as a parsed file (D149).
