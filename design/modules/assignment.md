# Candidate Capability: Contributor Assignment

> This capability is a candidate. Existing C++ automation provides evidence for command-based assignment,
> but the exact policy must be confirmed with each repository that wants it.

## 1. Maintainer need and evidence

A public issue can attract several contributors, abandoned assignments, and repeated requests. The existing
C++ flow uses assignment commands, contributor limits, and skill-related policy. Other repositories may
prefer ordinary GitHub assignment with no additional gate. The platform therefore needs a configurable
capability, not one universal assignment rule.

## 2. The capability boundary

This capability handles an explicit request to assign or unassign a contributor and returns assignment-
related intents. It does not decide whether issue intake is complete, measure inactivity, or maintain a
contributor progression system. Those facts can remain manual or come from independently enabled policies.

## 3. Candidate declaration

```ts
{
  name: "contributor-assignment",
  configSchema: AssignmentConfigSchema,
  triggers: ["issue_comment.created", "issues.assigned", "issues.unassigned"],
  observations: ["IssueObservation", "CommandObservation", "ActorObservation"],
  resolvers: ["mayPerform", "eligibleForAssignment", "isAutomation"],
  intents: ["AddAssignee", "RemoveAssignee", "UpsertManagedComment", "AddMappedLabel", "RemoveMappedLabel"],
  permissions: {
    repository: ["issues:read", "issues:write", "metadata:read"],
    organization: [],
  },
  operationalNeeds: {
    schedule: false,
    durableState: "candidate",
    crossItemCoordination: true,
    externalDelivery: false,
  },
}
```

The eligibility resolver and permission list require an experiment because limits based on assignments in
other repositories would cross the repository boundary.

## 4. Configuration and repository mappings

The capability defaults to disabled. Candidate settings include exact assign and unassign commands,
authorized actor roles, the maximum number of open assignments per contributor, whether self-assignment is
allowed, whether several assignees are allowed, and whether a skill policy is enabled. Skill checking is
optional and must not be part of the platform default.

If the repository wants workflow labels, meanings such as `assignmentAvailable` and `assignmentActive` map
to exact labels. A repository that uses only native GitHub assignees does not need those mappings.

## 5. Behavior

For an assignment command, the capability parses the exact command, identifies the requested contributor,
checks current actor permission, observes current assignees, and evaluates configured eligibility. If every
check passes, it returns an assignee intent and any separately configured managed-output intents.

For an unassignment command, it verifies that the actor may unassign the named contributor and returns a
remove-assignee intent. The policy may allow a contributor to release their own assignment while reserving
third-party removal for maintainers.

A person may also use GitHub's native assignment controls. The capability must either treat that action as
a valid manual decision or advise about a configured violation. It must not silently fight the native UI.
Edited comments do not execute commands, and duplicate deliveries use the same idempotency identity.

## 6. GitHub events, reads, writes, and permissions

The capability reads issue assignees, labels, command authors, repository permissions, and possibly a
contributor's other open assignments. Search results require correct pagination and may be eventually
consistent. Repository-wide or organization-wide eligibility queries need measured cost and a stated
privacy boundary.

Adding and removing assignees and writing issue comments require `issues:write`. Reading repository roles
and public metadata requires the relevant read access. The experiment must verify fork, outside-
collaborator, suspended-user, renamed-user, and deleted-user behavior.

## 7. Compatibility without dependency

Assignment works when intake is disabled because a human can identify an assignable issue. Inactivity may
later remove an assignment through its own approved intent, but it does not call this capability. If both
capabilities write the same position mapping, their compatibility profile must define clear preconditions
and tests.

## 8. Operational state and recovery

Adding an assignee and changing a label are separate GitHub calls. A crash between them can leave a partial
effect. The safest first milestone can manage only the native assignee or can use a durable operation record
that stores the expected state, completed step, cause, and configuration revision. The App must not infer a
pending operation merely from an unusual label and assignee combination.

Per-actor command budgets also require short-lived state or a queue service that provides an equivalent
counter. The design must name its retention and tenant boundary.

## 9. Failure handling and safety

Ambiguous commands, unauthorized actors, full contributor limits, unavailable GitHub users, missing
permissions, and stale observations cause no assignment write. A concise managed response may explain the
next step, but refusal replies are rate-limited so the App does not amplify spam.

An unassignment is reversible but can disrupt contributor work. The capability must preserve a newer human
assignment and must never bulk-remove assignees because a search result was incomplete.

## 10. Tests and sandbox proof

Tests must cover self-assignment, maintainer assignment, unauthorized commands, edited comments, duplicate
deliveries, several assignees, concurrent commands, limit queries with more than one page, stale search
results, partial effects, missing permissions, and native UI changes. The sandbox should begin with dry-run
decisions before it writes a real assignee.

## 11. Disable, uninstall, and migration behavior

Disabling the capability stops command handling and assignment writes immediately. It does not remove
current assignees. A repository migrating from an old bot must disable the old command handler before this
one becomes active, because two bots can both accept the same command and create conflicting messages.

## 12. Open decisions

Maintainers need to decide whether assignment is self-service, whether native assignment bypasses policy,
whether several assignees are allowed, whether limits cross repositories, and whether skill eligibility is
useful. The technical experiment must determine the minimum safe recovery record for multi-call effects.
