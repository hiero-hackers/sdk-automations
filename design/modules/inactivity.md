# Candidate Capability: Inactivity Management

> This capability is a candidate. Existing workflows show that maintainers want some stale work to return
> to the queue, but warning periods, activity signals, and final actions differ between repositories.

## 1. Maintainer need and evidence

An assigned issue or pull request can remain inactive while other contributors wait. A useful capability
can warn the responsible person and later release or close stale work. That behavior can also annoy active
contributors when the service misunderstands meaningful activity, so every timer and final action must be
repository policy.

## 2. The capability boundary

This capability evaluates inactivity and returns warning or expiry intents. It does not assign the next
contributor, evaluate pull request quality, or decide contributor skill. It can operate by itself when a
maintainer manually creates the state that starts its timer.

## 3. Candidate declaration

```ts
{
  name: "inactivity-management",
  configSchema: InactivityConfigSchema,
  triggers: ["scheduled evaluation", "issue_comment.created", "issues.edited", "pull_request.synchronize"],
  observations: ["IssueObservation", "PullRequestObservation", "ActivityObservation"],
  resolvers: ["linkedWork", "isAutomation", "mayPerform"],
  intents: ["UpsertManagedComment", "RemoveAssignee", "AddMappedLabel", "RemoveMappedLabel", "CloseItem"],
  permissions: {
    repository: ["issues:read", "pull_requests:read", "issues:write", "pull_requests:write"],
    organization: [],
  },
  operationalNeeds: {
    schedule: true,
    durableState: "candidate",
    crossItemCoordination: false,
    externalDelivery: false,
  },
}
```

The first experiment should stop at a warning comment. Unassignment and closure should remain disabled.

## 4. Configuration and repository mappings

The capability defaults to disabled. A repository may configure which items are watched, how inactivity
starts, which actors and events count as activity, the warning period, the grace period, a `/working`
command, blocked behavior, linked-pull-request behavior, and the final action. Timing values need safe
minimums, and a final action must be explicit.

Optional mappings may identify watched, warned, blocked, or returned-to-queue meanings. A repository can
instead use native assignment and comments only.

## 5. Behavior

At a scheduled evaluation, the capability derives the latest qualifying activity and compares it with the
configured warning and expiry boundaries. Before the warning boundary it returns no intent. After the
warning boundary it may upsert one managed warning. After the grace period it may return the configured
expiry intent, but only after re-observing the item and proving that no newer activity or human decision
invalidates it.

A valid `/working` command records or exposes a new activity fact and moves the deadline forward according
to policy. An edited comment does not retrigger the command. A blocked item and an item with an active linked
pull request follow explicit configuration rather than a universal assumption.

Issue inactivity and pull request inactivity should use separate policy blocks because pushes, reviews,
requested changes, comments, and assignments have different meanings.

## 6. GitHub events, reads, writes, and permissions

The capability needs a scheduled source of work and reads issue or pull request timelines, assignees,
labels, comments, reviews, and linked work according to policy. Timeline and search APIs require pagination
and may not expose every relationship directly. The linked-work resolver must report unknown instead of
pretending that no link exists.

Comments and label or assignee changes require issue write access. Pull request closure or other pull
request writes require their own permission. The App must not request final-action permissions when the
installation only uses warning mode if the GitHub App permission model allows that separation.

## 7. Compatibility without dependency

Inactivity can watch a manually assigned issue when assignment automation is disabled. If a progression or
review capability is enabled, its comments do not automatically count as human activity unless the
inactivity policy says they do. Shared mappings and managed-comment identities must remain distinct.

## 8. Operational state and recovery

Current GitHub history may be enough to compute the latest activity, but it may not reliably prove when the
App first warned an item or which warning policy version applied. An App-authored managed comment can expose
some of that fact, but it is not automatically a safe database. The feasibility experiment must compare
reconstruction cost and ambiguity with a small durable record containing the item, policy revision, warning
time, deadline, and final outcome.

## 9. Failure handling and safety

Missing history, rate limits, an unknown linked-work result, invalid configuration, or a newer human edit
causes no expiry action. Warning comments are reversible. Unassignment and closure are more disruptive and
must use dry-run evidence, a grace period, immediate re-observation, and a repository kill switch.

The capability must never infer inactivity from the absence of an event when its event history was
truncated or unavailable.

## 10. Tests and sandbox proof

Tests must cover exact timer boundaries, time zones, delayed schedules, duplicate evaluations, activity at
the deadline, `/working` authorization, edited comments, blocked items, linked pull requests, bot activity,
pagination, missing history, rate limits, and a partial final action. Sandbox testing should compress time
while preserving the same state transitions, then use a real multi-day observation period before any
automatic unassignment.

## 11. Disable, uninstall, and migration behavior

Disabling the capability stops schedules, warnings, and final actions. Existing assignments remain. Managed
warnings can be updated once to say that automation is disabled, or they can remain unchanged according to
an explicit cleanup policy. An old stale workflow must stop before this capability can perform final
actions on the same items.

## 12. Open decisions

Maintainers must define meaningful activity, warning and grace periods, blocked behavior, linked-work
behavior, and the allowed final action. The team must also decide how schedules discover work and which
warning facts require durable storage.
