# Candidate Capability: Maintainer Notifications

> This capability is a collection of candidate notification subscriptions, not one approved behavior.
> Each notification must have separate demand, configuration, delivery, and rate-limit decisions.

## 1. Maintainer need and evidence

Maintainers may want a concise notice when work needs attention, such as a pull request with completed
checks, a long review wait, a failing release workflow, or an inactivity deadline. GitHub already sends many
notifications, so another message is useful only when it reaches the right audience with less noise.

## 2. The capability boundary

This capability observes configured conditions and delivers a message. It does not decide the underlying
quality, assignment, or inactivity policy on behalf of another capability. A notification can use shared
normalized facts, but it cannot require a sibling capability to run.

In-repository comments and off-GitHub delivery have different security and operational boundaries. They
should be treated as separate delivery adapters even if they use the same condition evaluator.

## 3. Candidate declaration

```ts
{
  name: "maintainer-notifications",
  configSchema: NotificationConfigSchema,
  triggers: ["selected GitHub events", "scheduled evaluation"],
  observations: ["RepositoryObservation", "WorkflowObservation", "PullRequestObservation"],
  resolvers: ["notificationAudience", "requiredChecks", "isAutomation"],
  intents: ["UpsertManagedComment", "DeliverExternalNotification"],
  permissions: {
    repository: ["metadata:read", "actions:read", "pull_requests:read", "issues:write when comments are enabled"],
    organization: [],
  },
  operationalNeeds: {
    schedule: true,
    durableState: "required",
    crossItemCoordination: false,
    externalDelivery: true,
  },
}
```

The declaration must be narrowed for each selected subscription. An installation should not receive
`actions:read` merely because another repository uses a workflow notification.

## 4. Configuration and repository mappings

The capability defaults to disabled. Each subscription names its condition, repositories, audience,
delivery channel, quiet period, repeat policy, and recovery message. Workflow and check names are exact
repository mappings. A fixed name such as `build` or `DCO` is not portable.

External destinations require separately stored secrets and an explicit statement of which repository
fields may leave GitHub. A destination URL supplied by arbitrary repository content is not allowed.

## 5. Behavior

When an enabled condition changes from false or unknown to true, the capability creates a delivery intent
with a stable deduplication key. It records the delivery result and does not resend until the configured
repeat boundary or a meaningful state change. When configured, a recovery notification uses a separate
identity and is sent only after a previously delivered condition becomes healthy.

The evaluator reads current GitHub facts instead of trusting one event. Delayed and duplicate events must
produce the same result. A scheduled reminder rechecks that the condition still exists immediately before
delivery.

## 6. GitHub events, reads, writes, and permissions

Required events and reads depend on the subscription. Workflow failure may use workflow-run events and
Actions reads. Review-wait notifications may use pull request and review reads. Repository comments use
issue write access. Every collection must paginate, and every named workflow or check must handle renaming.

Off-GitHub delivery needs outbound network controls, encrypted destination credentials, destination-
specific retry handling, and redaction. Slack, email, and custom webhooks must not be treated as equivalent
because their authentication and privacy behavior differ.

## 7. Compatibility without dependency

A notification may evaluate the same normalized facts that another capability uses, but it remains useful
when that capability is disabled. Shared condition names require a versioned contract. No capability can
silently subscribe a repository to notifications as a side effect of being enabled.

## 8. Operational state and recovery

Reliable notification delivery cannot be derived only from current GitHub labels or comments. The service
needs a narrow record containing the subscription, condition revision, deduplication key, destination,
attempt count, last outcome, and next eligible time. Retention and removal must be defined, especially for
private repositories and external destinations.

The queue must distinguish an unknown delivery from a confirmed failure. Blindly retrying an unknown result
can create duplicate pages or messages.

## 9. Failure handling and safety

An unknown condition, missing workflow, invalid audience, unavailable secret, rate limit, or disabled
destination causes no delivery. Temporary destination failures use bounded retries with backoff and jitter.
Permanent authentication or configuration failures stop retries and alert maintainers through a safe
channel.

Notifications create social and operational noise even when they do not change repository state. Budgets,
quiet periods, tenant isolation, redaction, and a kill switch are required safety controls.

## 10. Tests and sandbox proof

Tests must cover duplicate and reordered events, renamed workflows, repeated failures, recovery, quiet
periods, missing destinations, secret rotation, unknown delivery outcomes, private repository redaction,
more than one page of checks, and one noisy repository sharing the service. The first experiment should use
an in-repository or operator-only destination before any external integration.

## 11. Disable, uninstall, and migration behavior

Disabling a subscription stops new deliveries and cancels pending retries that have not begun. Records may
remain for a short audit and deduplication period, then expire according to retention policy. Removing an
installation must revoke or delete its destination credentials and queued work.

## 12. Open decisions

Maintainers must identify a notification that is more useful than GitHub's existing notices. The team must
choose the first delivery channel, define the allowed data, select retention, and decide whether external
delivery belongs in the November milestone at all.
