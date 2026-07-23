# Candidate Capability: Issue Intake

> This capability is a candidate, not an approved product commitment. The C++ and Python audits show
> existing intake behavior, but maintainers must confirm which parts they want to keep.

## 1. Maintainer need and evidence

Some repositories need help turning a new or edited issue into a clear next step. The C++ workflow checks
required issue content and changes labels after a contributor finalizes the issue. The Python workflow uses
moderation-oriented labels and messages. These are useful examples, but they do not prove that every Hiero
repository wants the same intake process.

## 2. The capability boundary

This capability can validate configured issue requirements and publish a clear intake result. It does not
assign contributors, measure inactivity, route reviewers, or decide contributor skill. Those concerns stay
manual unless their own capabilities are enabled.

The safe first version should advise through one managed comment. Label changes, issue locking, and issue
closure require separate approval because they create more policy and recovery risk.

## 3. Candidate declaration

```ts
{
  name: "issue-intake",
  configSchema: IssueIntakeConfigSchema,
  triggers: ["issues.opened", "issues.edited", "issue_comment.created"],
  observations: ["IssueObservation", "ManagedCommentObservation"],
  resolvers: ["mayPerform", "isAutomation"],
  intents: ["UpsertManagedComment", "AddMappedLabel", "RemoveMappedLabel"],
  permissions: {
    repository: ["issues:read", "issues:write"],
    organization: [],
  },
  operationalNeeds: {
    schedule: false,
    durableState: "none",
    crossItemCoordination: false,
    externalDelivery: false,
  },
}
```

The final event and permission list depends on whether maintainers select comments, labels, commands, or
moderation actions.

## 4. Configuration and repository mappings

The capability should default to disabled. A repository may configure required issue-form fields, required
body sections, accepted issue types, a finalization command, authorized command roles, and the output mode.
Every rule must explain a real repository difference. The platform must not invent a universal required
template.

If label output is enabled, internal results such as `intakeNeedsInformation` and `intakeReady` map to exact
repository label names. Missing mappings make only the affected label intent unavailable. The App must not
create or remove labels based on a prefix.

## 5. Behavior

When an issue is opened or edited, the capability evaluates the current issue against the configured
requirements. It returns a managed-comment intent that lists missing information and explains the next
step. When every requirement is satisfied, it updates or clears that comment according to configuration.

A repository may optionally require a finalization command before it marks intake as ready. The command
parser checks exact syntax and current actor permission. An edited comment does not execute as a new
command. A redelivered event produces the same managed comment and does not create duplicates.

The capability must work when a maintainer manually assigns an intake label or performs every later step.
It must not undo a newer human label decision because an older validation event arrived late.

## 6. GitHub events, reads, writes, and permissions

The candidate reads the issue, issue author, labels, and configured issue-form content. It may need comment
reads to find an App-authored managed comment. It writes only that comment in the first experiment.
`issues:write` is required for issue comments and label effects even though the content being changed is not
the issue body.

If maintainers request lock, unlock, close, reopen, or body-edit behavior, each operation needs a separate
permission and safety review. The default design does not edit contributor titles or bodies.

## 7. Compatibility without dependency

Assignment and progression capabilities may observe an intake result through configured mappings, but
intake never calls them. Intake remains useful by itself because a person can act on its explanation. A
profile that combines capabilities must reject contradictory mappings, such as mapping ready and needs-
information meanings to the same label.

## 8. Operational state and recovery

Current issue content, current labels, and an App-authored managed comment should be enough for the first
experiment. The managed-comment identity must be deterministic and must verify authorship. If later policy
needs warning history, command history, or multi-step moderation, the team must decide whether a small
durable operation record is safer than reconstructing history from comments.

## 9. Failure handling and safety

Invalid configuration or missing required mappings causes no write and produces a configuration error for
maintainers. A permission failure stops retries until permissions change. Rate limits delay advisory work.
Unknown labels and unrelated comments remain untouched.

The first experiment has no destructive action. Locking, closing, rewriting user content, or deleting
comments must not be added silently to the same milestone.

## 10. Tests and sandbox proof

Tests must cover malformed and valid issue forms, edited issues, duplicate deliveries, hostile Markdown,
fake managed markers, command authorization, missing mappings, missing permissions, and a newer human label
edit. A personal App installation should run before a Hiero Hackers repository receives comment-only dry
runs. Maintainers should review both the accuracy and the tone of the resulting message.

## 11. Disable, uninstall, and migration behavior

Disabling intake stops every intake evaluation and write. Existing managed comments may remain as historical
GitHub content unless configuration requests one final neutral cleanup update. Before label mode is enabled,
maintainers must disable the old workflow that writes the same labels.

## 12. Open decisions

Maintainers need to decide whether the desired outcome is validation, moderation, finalization, or a smaller
combination. They must also decide whether comments are sufficient, which labels are repository-owned, who
may finalize an issue, and whether any close or lock action belongs in scope.
