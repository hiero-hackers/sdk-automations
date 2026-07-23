# Candidate Capability: Review Routing

> This capability is an unconfirmed candidate. The Python audit contains reviewer-related behavior, but
> direct maintainer demand and a reliable routing policy still need confirmation.

## 1. Maintainer need and evidence

Pull requests can wait because the right reviewer does not notice them. A routing capability may help when
ownership rules and team availability are clear. It can create noise and unfair load when those facts are
incomplete, so the project should not promise automated reviewer selection before maintainers explain how
they currently make that decision.

## 2. The capability boundary

This capability may recommend or request configured reviewers for an eligible pull request. It does not
judge pull request quality, grant approval, merge code, or maintain contributor skill. The first useful
experiment can produce a dry-run recommendation without requesting a review.

## 3. Candidate declaration

```ts
{
  name: "review-routing",
  configSchema: ReviewRoutingConfigSchema,
  triggers: ["pull_request.opened", "pull_request.ready_for_review", "pull_request.synchronize"],
  observations: ["PullRequestObservation", "ChangedFilesObservation", "ReviewRequestObservation"],
  resolvers: ["reviewCandidates", "mayPerform", "isAutomation"],
  intents: ["RequestReviewers", "UpsertManagedComment"],
  permissions: {
    repository: ["pull_requests:read", "pull_requests:write", "contents:read"],
    organization: ["members:read when team membership is part of policy"],
  },
  operationalNeeds: {
    schedule: false,
    durableState: "candidate",
    crossItemCoordination: true,
    externalDelivery: false,
  },
}
```

GitHub team visibility and organization permissions require a personal App experiment before this
declaration can be accepted.

## 4. Configuration and repository mappings

The capability defaults to disabled. Candidate settings include path-to-team rules, excluded authors,
draft behavior, maximum requested reviewers, whether existing requests are preserved, and whether the
result is advice or an actual review request. A repository may reference a CODEOWNERS file, explicit path
rules, or configured teams, but the project must not assume these sources mean the same thing.

Team names and reviewer identities are repository or organization mappings. Missing and invisible teams
produce an invalid or unknown result rather than a guessed reviewer.

## 5. Behavior

When a pull request becomes ready for review, the capability observes changed files, existing review
requests, author identity, and the configured ownership source. It resolves eligible candidates and returns
either a recommendation comment or a bounded review-request intent. A synchronize event should not request
the same reviewer again unless policy says a dismissed or completed review must be renewed.

A maintainer's manual reviewer request is valid input and is preserved. The capability must not remove a
manual request merely to enforce its own rotation. If no candidate is known, it explains the missing rule or
does nothing according to configuration.

## 6. GitHub events, reads, writes, and permissions

The capability reads changed files, current requested reviewers, reviews, repository content when an
ownership file is selected, and team membership when team routing is selected. Changed files and membership
lists require pagination. Requesting individual or team reviewers uses pull request write access.

Private team visibility, outside collaborators, suspended members, author exclusion, and team review
requests need direct API tests. The App must not broaden organization access merely to support an optional
candidate without maintainer agreement.

## 7. Compatibility without dependency

Review routing works when quality guidance is disabled because a maintainer can mark a pull request ready
by hand. If a profile combines the two, it may require an explicit quality-ready observation before routing.
That is a compatibility rule evaluated from shared facts, not a call from one capability to another.

## 8. Operational state and recovery

Path ownership can be recomputed from current GitHub facts. Fair round-robin selection, recent workload,
cooldowns, and vacation handling require history that GitHub may not expose reliably. Those policies need a
defined durable record or should stay out of the first experiment.

Review requests are idempotent only after the adapter verifies existing requests and GitHub's response. A
partial request to several reviewers must report exactly which requests succeeded.

## 9. Failure handling and safety

Missing team access, no eligible reviewer, too many changed files, rate limits, and stale pull request facts
cause no blind request. A recommendation is lower risk than a real request because review requests generate
notifications and can damage trust through repeated noise. The repository and organization kill switches
must stop new requests immediately.

## 10. Tests and sandbox proof

Tests must cover drafts, renamed and deleted files, more than one page of files, CODEOWNERS precedence,
private teams, outside collaborators, existing manual requests, the author appearing in an ownership group,
duplicate events, partial multi-reviewer results, and missing permissions. Maintainers should first inspect
dry-run recommendations and measure their accuracy before enabling notifications.

## 11. Disable, uninstall, and migration behavior

Disabling the capability stops recommendations and review requests. It does not remove existing review
requests. Any older reviewer bot must stop before active request mode begins, although both systems may be
compared safely in a no-write experiment.

## 12. Open decisions

Maintainers need to confirm that they want routing, identify the authoritative ownership source, and decide
whether advice is sufficient. The team must decide whether fairness and availability belong in scope and
whether their operational history justifies durable storage.
