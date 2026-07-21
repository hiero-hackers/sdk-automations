# Repository Configuration Proposal

> This document describes the first configuration requirements. The exact file name, JSON or YAML format,
> inheritance syntax, and final schema are open decisions. The implementation must validate the chosen format
> against real repository examples before it becomes stable.

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
4. Organization defaults may provide values, but they do not enable a capability for a repository.
5. A capability receives only its own validated configuration block and the shared values that its contract
   declares.
6. Invalid or outdated configuration fails closed and reports a clear error.
7. Unknown keys are rejected so that misspellings do not silently change behavior.
8. The App can report the effective value and source of every inherited setting.
9. Configuration changes in a pull request do not become active until they reach the default branch.
10. A repository can disable all writes without uninstalling the App.

## 3. Candidate shape

The following YAML example shows the concepts that the first schema needs. It does not decide the final file
format or every capability key.

```yaml
schemaVersion: 1
mode: observe

extends:
  repository: hiero-hackers/automation-defaults
  revision: 4f3a2c1

capabilities:
  prQuality:
    enabled: true
    checks:
      dco: true
      mergeConflict: true
      linkedIssue: true
      gpg: false

  assignment:
    enabled: false
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

- The schema declares whether the capability is enabled.
- The schema declares every key that the capability may read.
- The schema provides safe ranges for numbers and time periods.
- The schema identifies required mappings and principals.
- The schema rejects incompatible settings before activation.
- The schema declares the capability version when migration may change behavior.

An empty capability block must not rely on surprising defaults. If a default can cause a workflow-changing
write, the documentation must state it clearly and the repository must still explicitly enable the
capability.

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

## 7. Workflow profiles

A workflow profile is a reviewed collection of defaults and compatibility rules. A profile may describe the
current Hiero contribution workflow, including its suggested labels and skill policy.

A profile does not automatically enable its capabilities. A repository still chooses the capabilities that
it wants. The configuration report must show which values came from the profile and which values the
repository overrode.

The skill ladder is an optional policy profile. A repository that does not enable it does not need skill
labels, contribution history queries, or ladder thresholds.

## 8. Inheritance

Inheritance remains an open design question. Any accepted mechanism must satisfy the following safety rules.

- The App resolves inheritance only from an approved organization or repository scope.
- The active configuration identifies an immutable revision of inherited values.
- The resolver detects missing sources, cycles, excessive depth, and inaccessible repositories.
- A failed inheritance lookup does not fall back to a partially active configuration.
- Organization defaults cannot silently enable a repository capability.
- The effective-configuration report shows the complete merge result and its sources.

The `_extends` behavior used by the prototype is useful evidence, but it is not automatically the final
inheritance contract.

## 9. Invalid configuration

Invalid configuration must fail closed and must remain visible.

The App should report errors while a pull request edits the configuration and again when invalid
configuration is active on the default branch. The report should name the path, the rejected value, the
reason, and the last behavior that remains safe.

The first implementation must decide whether this report uses a managed comment, an issue, a check, or an
operator channel. That choice depends on the final permission manifest.

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
- A mapping change must account for items that still use the previous label or field.
- A repository must be able to return to `observe` or `disabled` mode before a risky migration.
- Configuration rollback must not cause the App to reverse newer human changes.

## 12. Questions that remain open

The following questions require maintainer review and sandbox evidence.

- The project must choose JSON or YAML and the final path under `.github/`.
- The project must decide whether inheritance is needed in the first version.
- The project must decide how inherited configuration is pinned and reviewed.
- The project must choose the first workflow profile and its ownership rules.
- The project must decide whether labels are provisioned manually or by a separate setup command.
- The project must define the effective-configuration report and the permission it requires.
- The project must define schema retention, migration, and rollback support.
