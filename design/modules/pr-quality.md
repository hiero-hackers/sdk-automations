# Candidate Capability: Pull Request Quality Guidance

> This capability is a candidate. Repository audits show several quality checks, but each repository uses
> different branch rules, checks, contribution rules, and issue-link conventions.

## 1. Maintainer need and evidence

Contributors often need a single explanation of what still prevents a pull request from being reviewable
or mergeable. GitHub already enforces branch protection and reports checks. This capability should explain
repository policy and combine signals without pretending to replace GitHub's enforcement.

## 2. The capability boundary

This capability observes configured pull request signals and publishes guidance or narrow mapped results.
It does not merge pull requests, approve reviews, change code, push commits, or assign reviewers. The safe
first version is read-mostly and writes only one managed comment.

## 3. Candidate declaration

```ts
{
  name: "pull-request-quality",
  configSchema: PullRequestQualityConfigSchema,
  triggers: ["pull_request events", "check_suite.completed", "check_run.completed", "pull_request_review events"],
  observations: ["PullRequestObservation", "ChecksObservation", "ReviewObservation"],
  resolvers: ["linkedWork", "requiredChecks", "mayPerform", "isAutomation"],
  intents: ["UpsertManagedComment", "AddMappedLabel", "RemoveMappedLabel"],
  permissions: {
    repository: ["pull_requests:read", "checks:read", "statuses:read", "issues:write", "contents:read"],
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

The experiment must verify which GitHub events and APIs provide reliable required-check and mergeability
information under the selected App permissions.

## 4. Configuration and repository mappings

The capability defaults to disabled. A repository may select checks for title format, linked issue,
assignee, required status checks, review state, merge conflicts, sign-off, or verified signatures. Every
check is separately configurable because repositories disagree about these policies.

Check and workflow names must be exact configured identifiers or derived from protected-branch rules where
GitHub exposes them reliably. The capability must not assume a universal CI job name. Optional meanings such
as `qualityNeedsWork` and `qualityReadyForReview` map to repository labels only when label mode is enabled.

## 5. Behavior

After a relevant pull request event, the capability reads the current pull request and the configured
signals. Each signal returns pass, fail, pending, or unknown with an explanation. The capability combines
those results into one managed comment that tells the contributor what is complete, what is pending, what
needs action, and what the App could not determine.

An unknown result must not become a failure or a success. GitHub may temporarily return `mergeable: null`,
and check suites may still be running. The capability waits for later events or a bounded reconciliation
instead of posting contradictory messages.

If mapped-label mode is later enabled, label intents are based on the same observed result. A newer human
label change and a changed configuration revision invalidate an older intent.

## 6. GitHub events, reads, writes, and permissions

The capability may read pull request metadata, commits, changed files, reviews, branch rules, checks, commit
statuses, linked issues, and repository content such as a contribution policy. Commit, check, review, and
file collections require pagination. Pull requests from forks and contributions from outside collaborators
must work without exposing secrets or assuming write access to the contributor's branch.

Reading content is necessary only for checks that actually inspect a repository file. Writing the managed
comment or labels uses issue write permission because GitHub exposes pull request comments and labels
through issue APIs. The capability does not need merge or content write permission.

Signature policy needs a separate experiment because DCO sign-off text, GitHub verified signatures, and
organization identity rules are different facts.

## 7. Compatibility without dependency

The capability works without intake, assignment, review routing, or progression. If review routing is also
enabled, it may observe a quality mapping through configuration, but quality never calls it. A profile must
prevent two capabilities from owning the same managed comment marker or contradictory label meanings.

## 8. Operational state and recovery

The first version should recompute from current GitHub facts and update one deterministic App-authored
comment. A short coalescing queue may reduce repeated work during a burst of check events. Correctness must
not depend on that queue retaining every delivery.

If the capability later sends one-time notifications or records historical quality trends, those features
need explicit durable state and retention. They should not be hidden inside the quality evaluator.

## 9. Failure handling and safety

Missing permissions, unavailable branch rules, incomplete pagination, delayed checks, and API failures
produce unknown results and no readiness label. The managed comment should distinguish repository work from
an App limitation so contributors are not blamed for infrastructure failures.

The first version performs no destructive action and never closes a pull request because an issue link,
signature, assignee, or check is missing.

## 10. Tests and sandbox proof

Tests must cover more than one page of commits and checks, duplicate check names, reruns, cancelled checks,
`mergeable: null`, draft pull requests, fork pull requests, renamed workflows, changed branch protection,
review dismissal, hostile titles, missing permissions, and duplicate deliveries. Sandbox evidence should
compare the App result with GitHub's visible branch-protection result on the same pull request.

## 11. Disable, uninstall, and migration behavior

Disabling the capability stops all evaluations and writes. Existing managed comments remain unless an
approved cleanup mode updates them. The capability must run in comment-only dry-run or advisory mode while
an older quality bot still owns the same labels.

## 12. Open decisions

Maintainers must select the checks they actually want, decide whether advice or labels are useful, and
define how unknown results appear. The team must verify required-check discovery, signature facts, linked-
issue reliability, and branch-rule permissions through a GitHub App experiment.
