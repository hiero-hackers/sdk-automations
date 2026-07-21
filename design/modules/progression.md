# Candidate Capability: Contributor Progression Guidance

> This capability is optional and unconfirmed. Most repositories may not want a skill ladder. The platform
> must work completely without this capability.

## 1. Maintainer need and evidence

The C++ workflow contains skill-related labels and assignment rules. A repository with a deliberate
contributor development program may want to summarize completed work and suggest a next challenge. That
does not make one skill ladder correct for every language, team, or repository.

## 2. The capability boundary

This capability can evaluate a repository-approved progression policy and publish guidance. It does not
grant organization roles, change GitHub permissions, decide whether a pull request merges, or control
assignment unless assignment separately chooses to consult a configured eligibility policy.

## 3. Candidate declaration

```ts
{
  name: "contributor-progression",
  configSchema: ProgressionConfigSchema,
  triggers: ["pull_request.closed", "issues.closed", "scheduled evaluation"],
  observations: ["ContributionObservation", "ActorObservation", "IssueObservation"],
  resolvers: ["linkedWork", "contributionHistory", "isAutomation"],
  intents: ["UpsertManagedComment", "AddMappedLabel", "RemoveMappedLabel"],
  permissions: {
    repository: ["issues:read", "pull_requests:read", "issues:write"],
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

Cross-repository progression would change the privacy, rate-limit, and tenant boundaries and is not part of
the first candidate.

## 4. Configuration and repository mappings

The capability defaults to disabled. A repository would define its levels or milestones, qualifying
contribution types, evidence thresholds, excluded work, recommendation rules, and output mode. Stable
internal meanings can map to exact labels or fields, but the names and number of levels belong to the
repository profile.

The platform must not ship a hidden default ladder. A simple repository may enable every other capability
without defining any contributor level.

## 5. Behavior

After a qualifying pull request merges or another configured contribution completes, the capability finds
the linked work and evaluates the current contributor history against the selected policy. It returns a
plain explanation of the evidence and an optional next-step recommendation. It must distinguish a merged
pull request from a closed, unmerged pull request.

The capability must not treat labels as proof when maintainers or other bots can apply them for unrelated
reasons. It must also avoid repeatedly announcing the same milestone. If reliable render-once behavior
requires history, the team must store a narrow record or omit the announcement.

## 6. GitHub events, reads, writes, and permissions

The capability may read merged pull requests, linked issues, authors, labels, reviews, and contribution
history. Search and history queries require pagination and have eventual-consistency limits. A repository-
local policy should not require organization membership permissions.

Writing a guidance comment or label uses issue write permission. The capability does not need content write,
merge, administration, or organization-role permissions.

## 7. Compatibility without dependency

Progression can evaluate completed work without intake, assignment, quality, or review routing. Assignment
may independently use the same repository-approved level mapping through a shared resolver. That shared
policy does not allow either capability to call or require the other.

## 8. Operational state and recovery

Current GitHub history can support some threshold policies, but repeated full-history searches may be slow
and eventually consistent. One-time announcements, historical snapshots, and cross-repository totals need
durable records with correction and deletion rules. The project should avoid that complexity until a
maintainer confirms that progression provides enough value.

## 9. Failure handling and safety

An ambiguous link, incomplete history, changed policy revision, or rate limit produces no level change. The
App explains uncertainty without ranking a contributor incorrectly. A progression result must never be
presented as an employment judgment, identity claim, or GitHub permission.

Label changes are reversible, but public ranking can still cause social harm. Wording, appeal, correction,
and opt-out behavior require maintainer review.

## 10. Tests and sandbox proof

Tests must cover merged and unmerged pull requests, several authors, bot contributions, reverted work,
missing links, more than one page of history, policy changes, duplicate events, renamed labels, manual
overrides, and repeated announcements. No Hiero Hackers write experiment should begin until a repository
maintainer explicitly asks to evaluate a progression policy.

## 11. Disable, uninstall, and migration behavior

Disabling the capability stops evaluations and writes without affecting other capabilities. Existing public
comments and labels remain unless maintainers choose an explicit cleanup. Any old skill-ladder writer must
stop before this capability manages the same labels.

## 12. Open decisions

The first decision is whether any repository wants this capability. If one does, its maintainers must define
the policy, evidence boundary, correction process, and output. The team must then decide whether repository-
local history is reliable enough and whether one-time results justify storage.
