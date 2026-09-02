# Repository Configuration Contract

> **Built for the current shell** — `packages/core/src/config/` parses and validates the document;
> `packages/shell/src/config.ts` fixes its repository path. The closed vocabularies below are locked by
> `packages/dev/checks/test/spec-drift.test.ts`, and every rejection shape is exercised by the in-package
> corpus in `packages/core/test/config/documents.ts`.

This is the contract the implementation satisfies today. Configuration reporting, per-capability setting
schemas, mapped-label existence checks, permission-readiness checks, inheritance, and schema migration are
future work; they are listed in §7 rather than written here as if they already ran.

## 1. Source and authority

- The repository file is **`automations.yml` at the repository root** (D93).
- With App credentials, the read adapter fetches it from the repository's default branch. Credential-free
  development and CI read an operator-maintained local copy through the same `ConfigSource` seam.
- An absent file and an empty file both produce the no-configuration result: `observe`, no capabilities,
  no mappings, and no principals.
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
  dotted path where one exists.
- One error anywhere rejects the whole document. The parser never salvages a valid-looking fragment from
  an invalid file (D38).

## 3. Schema shape

```yaml
schemaVersion: 1
mode: observe
capabilities:
  intake:
    enabled: false
    settings:
      announce: true
mappings:
  labels:
    awaitingTriage: "status: awaiting triage"
    ready: "status: ready for dev"
principals:
  maintainerTeam: hiero-sdk-maintainers
```

The accepted top-level keys are exactly:

| Key | Current contract |
|---|---|
| `schemaVersion` | Required for a non-empty document and exactly `1`. |
| `mode` | Optional; omission defaults to `observe`, while a present null or invalid value is rejected. |
| `capabilities` | Optional mapping from an admitted capability name to an `enabled` boolean and an opaque `settings` mapping. |
| `mappings` | Optional; currently contains only the `labels` mapping. |
| `principals` | Optional string-to-string mapping. |

Unknown keys are rejected at the top level, inside `mappings`, and inside each capability block.

### Capability admission

- Names use lower-camel configuration-key syntax: `/^[a-z][a-zA-Z0-9]*$/`.
- Every configured name must appear in the caller's directly admitted `knownCapabilities` list, even when
  `enabled: false`. Unknown and retired names are rejected with `capabilityUnknown`; there is no retirement
  tombstone in the current direct-set model (D58's earlier registry design no longer exists).
- Only the boolean value `true` enables a capability. Omission is false; strings and numbers are rejected.
- `settings`, when present, must be a mapping, and its KEY NAMES are checked against the admitted
  capability's declared `configKeys` — an undeclared name is `unknownKey` at
  `capabilities.<name>.settings.<key>`, whether the block is enabled or disabled (D84). The VALUES stay
  opaque: a real capability must add and own its setting validation before it ships.
- A capability may be admitted by name alone, which admits the name and states nothing else. The
  settings-key and required-meaning rules then have nothing to judge against and do not run for it.

### Label mappings

- A key must be one of the closed mappable meanings in [`catalogue.md`](catalogue.md).
- A label is a non-empty string.
- Mappings are fully injective after trimming and case folding, matching GitHub label-name uniqueness. Two
  meanings therefore cannot map to spellings GitHub treats as the same label (D34, D55).
- A capability enabled without a meaning its declaration requires is `meaningRequired`, pathed at
  `mappings.labels.<meaning>`. Disabled capabilities require nothing, and every missing meaning is
  reported at once (D84).
- The parser does **not** currently call GitHub to confirm that a mapped label exists. That is an
  activation check still to build.

## 4. Repository modes

| Mode | Current behavior |
|---|---|
| `disabled` | Core still evaluates enabled capabilities and declared resolvers, then refuses every screened intent with `modeDisabled`; it approves no effect. |
| `observe` | Core records findings and record-only intent explanations, never an effect to apply. This is the safe default. |
| `dry-run` | The same record-only decision path as `observe`, plus a `wouldApply` finding naming each effect that reached the mode rule. No identity is minted and nothing is prepared. |
| `active` | A valid core mode, but the current shell intercepts it as `modeUnsupported` because no GitHub write path exists. |

For modes that reach `decide()`, the process kill switch is the first safety verdict for each returned
intent. It does not prevent capability or resolver evaluation, and the shell intercepts `active` before
`decide()`. A true transport/evaluation stop is deferred (D117). Capability enablement remains a separate
gate.

## 5. Failure behavior

Invalid configuration returns no partial `RepositoryConfig`. In the runnable shell it becomes one durable
`configRejected` record and the delivery completes: retrying the same webhook cannot repair the file, while
a later commit containing a fix arrives as a new delivery.

The following mitigations named by D38 are **not built yet**:

- a pull-request check annotating invalid `automations.yml` changes;
- a repository-visible effective-configuration or health report;
- permission diagnostics before capability evaluation.

Until those exist, `active` remains unsupported by the shell.

## 6. Rejection codes

| Code | Meaning |
|---|---|
| `documentUnparseable` | YAML could not be safely converted, including excessive alias expansion. |
| `duplicateKey` | The YAML repeats a key. |
| `notAMapping` | The document or a mapping-shaped section has another type. |
| `unknownKey` | A closed mapping contains an unsupported key. |
| `schemaVersionUnsupported` | `schemaVersion` is absent, has the wrong type, or is not `1`. |
| `modeInvalid` | `mode` is present but is not one of §4's values. |
| `capabilityNameInvalid` | A capability name is not a valid configuration key. |
| `capabilityEnabledNotBoolean` | `enabled` is present but is not a boolean. |
| `capabilityUnknown` | The application did not directly admit the configured capability name. |
| `meaningNotMappable` | A label mapping names a meaning outside the closed catalogue. |
| `meaningRequired` | An enabled capability declares a meaning the document has not mapped. |
| `labelInvalid` | A mapped label is not a non-empty string. |
| `labelNotInjective` | Two meanings map to one GitHub-equivalent label name. |
| `principalNotAString` | A principal value is not a string. |

## 7. Deliberately deferred

- Define and enforce each shipped capability's settings VALUE schema. Setting key names and required
  meanings are enforced as of D84; what a declared setting may hold is still the capability's to state.
- Check mapped-label existence and live installation grants before activation.
- Build the pull-request validation check and effective-configuration report required by D38.
- Decide schema-version migration, deprecation, retention, and rollback policy (Q14).
- Add inheritance only if repeated repository demand justifies it; version 1 has none.
- Keep `active` unsupported until adapter writes, postcondition verification, recovery, and rollback exist.
