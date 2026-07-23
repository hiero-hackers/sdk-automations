# Repository Configuration Proposal

> This document describes the first configuration requirements. The first version uses YAML with strict
> schema validation. The exact file name and final schema still need validation against real repository
> examples before they become stable.

## 1. Purpose

Configuration records a repository's reviewed intent. It answers which capabilities may run and how those
capabilities should fit the repository's workflow.

Configuration does not store webhook deliveries, retries, pending API effects, audit logs, or other runtime
state. Those concerns belong to the platform's operational components.

## 2. Required behavior

The configuration system must follow these rules.

1. The App reads active configuration from the repository's default branch.
2. No configuration causes no workflow-changing writes.
3. A capability runs only when the repository explicitly enables it.
4. Every user-facing capability is optional and defaults to disabled.
5. A capability receives only its own validated configuration block and the shared values that its contract
   declares.
6. Invalid or outdated configuration fails closed and reports a clear error.
7. Unknown keys are rejected so that misspellings do not silently change behavior.
8. The App can report the active configuration revision and effective value of every setting.
9. Configuration changes in a pull request do not become active until they reach the default branch.
10. A repository can disable all writes without uninstalling the App.

## 3. Candidate shape

The following YAML example shows the concepts that the first schema needs. It does not decide every
capability key.

```yaml
schemaVersion: 1
mode: observe

capabilities:
  prQuality:
    enabled: true
    settings:
      checks:
        dco: true
        mergeConflict: true
        linkedIssue: true
        gpg: false

  assignment:
    enabled: false
    settings:
      maxOpenAssignments: 2
      policyProfile: hiero-contributor-ladder

mappings:
  labels:
    ready: "status: ready for dev"
    inProgress: "status: in progress"
    needsReview: "status: needs review"
    needsRevision: "status: needs revision"

principals:
  maintainerTeam: hiero-sdk-cpp-maintainers
```

## 4. Repository modes

The schema should support the following repository modes.

| Mode | Required behavior |
|---|---|
| `disabled` | The App performs no capability reads or writes beyond the minimum work required to explain that it is disabled. |
| `observe` | The App reads and evaluates current state but produces only operator-visible findings. |
| `dry-run` | The App records the exact effects it would request but does not apply them. |
| `active` | The App may apply effects for capabilities that are enabled and fully valid. |

A global or installation-level kill switch always overrides repository mode.

## 5. Capability configuration

Every capability schema must declare the following information.

- The schema declares whether the capability is enabled. Omitted capabilities and capabilities with
  `enabled: false` are off.
- The schema declares every key that the capability may read.
- The schema provides safe ranges for numbers and time periods.
- The schema identifies required mappings and principals.
- The schema rejects incompatible settings before activation.
- The schema declares the capability version when migration may change behavior.

Settings live under the capability's `settings` key so that enablement is easy to distinguish from policy.
Settings under a disabled capability are dormant: they may remain in the file, but the capability performs
no capability-specific evaluation, read, or write. The validator still rejects malformed settings so that
enabling the capability later cannot silently activate an invalid value.

An empty capability block must not rely on surprising defaults. A profile or default may fill in settings,
but it must never enable a capability. If a default can cause a workflow-changing write after enablement,
the documentation must state it clearly.

Schema validation alone cannot police capability names: capability keys are free-form and settings are
contractually opaque to the shared validator, so a configuration enabling a misspelled or unshipped
capability passes validation silently — observed directly in the sandbox (experiment 6.3,
`FINDING(config-capability-registry-gap)`). The platform layer must therefore check every enabled
capability against its registry of shipped capabilities at configuration load, and the effective-
configuration report must name unknown capabilities and capabilities whose installation permissions are
missing. This registry check is a platform requirement that complements, and cannot be replaced by, the
schema in this document; it feeds the capability contract under D23. Its companion rule: registry names
are never deleted — a retired capability is tombstoned, so configurations that enable it remain valid
while the capability simply never activates and the effective-configuration report says so. Retirement must
not be a breaking change; only names that never existed are validation errors.

## 6. Stable meanings and repository mappings

The platform may use stable internal meanings while repositories keep their own labels and fields. For
example, assignment may require internal meanings named `ready` and `inProgress`. The repository maps those
meanings to its actual labels.

The validator must check the following conditions before a capability becomes active.

- Every required meaning has exactly one supported mapping.
- Two incompatible meanings do not map to the same label or field.
- The configured label or field exists when the platform requires pre-provisioning.
- The installation has permission to read or write the mapped representation.
- A mapping change has a clear migration and rollback path when existing items still use the old value.

The App removes only the configured value that belongs to the requested meaning. It never removes values by
matching a namespace prefix.

In the first version, maintainers create required labels before activation. The App validates each mapped
label and reports a missing or renamed label. It does not create a replacement, guess which label was
renamed, or continue label-changing work for the affected capability.

## 7. Workflow profiles

A workflow profile is a reviewed collection of settings, mappings, and compatibility rules. A profile may
describe the current Hiero contribution workflow, including its suggested labels and skill policy.

A profile does not automatically enable its capabilities. A repository still chooses the capabilities that
it wants. Every user-facing capability remains optional.

The skill ladder is an optional policy profile. A repository that does not enable it does not need skill
labels, contribution history queries, or ladder thresholds.

The Hiero contribution profile includes the internal `blocked` meaning and suggests `status: blocked` as its
expected mapping. A repository may explicitly map the same meaning to an existing label, but it cannot
replace `blocked` with a different meaning or ask the App to create an arbitrary new label during normal
event processing.

## 8. Effective configuration and later inheritance

The first version does not inherit configuration from another repository or organization. Each repository's
default-branch YAML file is its complete source of configuration truth.

The App validates that file and computes an effective configuration in memory. An evaluation records the
repository configuration revision and a hash of the validated effective configuration so that an operator
can tell which configuration produced a decision. A cache may keep the validated result, but the cache is
not the source of truth.

Inheritance may be considered later if several repositories demonstrate a real need for shared settings.
Any later design must pin inherited values to an immutable revision, reject missing sources and cycles,
show the complete merge result, and never enable a capability through inherited defaults.

## 9. Invalid configuration

Invalid configuration must fail closed and must remain visible to repository maintainers.

While a pull request edits configuration, the App reports validation through one configuration check on
that pull request. If invalid configuration reaches the default branch, the App publishes or updates one
repository configuration-health result for maintainers. The report names the path, rejected value, reason,
and last behavior that remains safe.

If missing permissions prevent repository reporting, the App sends the failure to its operator diagnostics.
The sandbox experiment must confirm the exact GitHub check or health-report surface and the permission it
requires.

## 10. Permission mismatch

Valid configuration is not enough to authorize a capability. The installation must also have every required
GitHub permission.

When a permission is missing, the capability remains inactive. The App reports the missing permission, the
operations that are blocked, and the action an installation owner must take. The App does not repeatedly try
an operation that the current installation cannot perform.

## 11. Migration and rollback

The schema must define how repositories move between versions.

- The system must reject unsupported future versions.
- The system must explain deprecated keys before removing support for them.
- A missing or renamed mapped label disables label-changing work for the affected capability and produces a
  maintainer-visible configuration error.
- The App does not recreate the old label, guess the replacement, or migrate existing items during ordinary
  event processing.
- A mapping change must account for items that still use the previous label or field through an explicit
  migration and rollback plan.
- A repository must be able to return to `observe` or `disabled` mode before a risky migration.
- Configuration rollback must not cause the App to reverse newer human changes.
- An intent evaluated under an older configuration revision becomes invalid when the mapping changes.

## 12. Questions that remain open

The following questions require maintainer review and sandbox evidence.

- The project must choose the final YAML path under `.github/`.
- The project must choose the first workflow profile and its ownership rules.
- The sandbox experiment must confirm the configuration check, repository health-report surface, and
  permissions they require.
- The project must define schema retention, migration, and rollback support.
