# Candidate Capability: Repository Administration Assistance

> This capability is an unconfirmed candidate based mainly on Python repository behavior. Administrative
> actions can require broader permissions and durable policy state, so they should not be grouped into the
> first platform milestone without direct maintainer demand.

## 1. Maintainer need and evidence

Some repositories may want help rotating mentors, applying a denylist, or checking whether administrative
policy files remain valid. These jobs are different from issue and pull request workflow assistance. They
can affect people and organization policy, so convenience alone is not enough reason to automate them.

## 2. The capability boundary

This candidate may evaluate a repository-approved administrative rule and propose a change. The safest
version opens or comments on a configuration pull request for human review. It does not write directly to
the default branch, change organization roles, manage secrets, or alter repository settings.

Mentor rotation and denylist enforcement may be separate capabilities after discovery because they use
different evidence, permissions, safety rules, and recovery.

## 3. Candidate declaration

```ts
{
  name: "administration-assistance",
  configSchema: AdministrationConfigSchema,
  triggers: ["scheduled evaluation", "pull_request events for a managed configuration change"],
  observations: ["RepositoryPolicyObservation", "MembershipObservation"],
  resolvers: ["mayPerform", "organizationMembership", "isAutomation"],
  intents: ["UpsertManagedComment", "ProposeConfigurationChange"],
  permissions: {
    repository: ["contents:read", "pull_requests:read", "issues:write"],
    organization: ["members:read only if an approved rule requires it"],
  },
  operationalNeeds: {
    schedule: true,
    durableState: "candidate",
    crossItemCoordination: true,
    externalDelivery: false,
  },
}
```

`ProposeConfigurationChange` is not yet an approved adapter operation. Its feasibility and permission cost
must be evaluated separately.

## 4. Configuration and repository mappings

The capability defaults to disabled. A selected rule would name its policy file, eligible people or teams,
exclusions, review owners, rotation period, and proposal mode. People and team identifiers need explicit
organization mappings. A denylist requires a clear owner, reason model, visibility policy, correction
process, and expiry policy.

Administrative configuration should not inherit from an unreviewed or mutable external source. A change in
effective policy must be visible in the pull request that enables it.

## 5. Behavior

At a scheduled evaluation, the capability reads the approved policy and current relevant facts. It produces
either an advisory result or a proposed configuration change for human review. It does not apply that
change to the protected branch. A later evaluation detects an existing proposal and updates or suppresses
it instead of opening duplicates.

A human edit to the policy is authoritative. The capability must re-read the latest default-branch revision
before preparing a proposal and must not overwrite a newer maintainer change.

## 6. GitHub events, reads, writes, and permissions

The capability may need repository content, pull request, and organization membership reads. Membership
visibility and team access need direct App tests. Creating a branch, commit, or pull request requires
content write access and significantly enlarges the permission boundary.

The preferred first experiment should generate a patch or advisory comment without granting content write.
If maintainers later want App-created pull requests, that effect needs an isolated adapter design, branch
naming rules, commit authorship, signing decisions, fork behavior, and protection against workflow changes
in generated content.

## 7. Compatibility without dependency

Administration assistance does not depend on issue, pull request, assignment, or progression capabilities.
Other capabilities may read the same approved policy through a shared resolver, but this candidate cannot
enable them or rewrite their configuration.

## 8. Operational state and recovery

A deterministic policy check can use the current repository revision. Fair rotation usually needs history
about prior selections, absences, overrides, and skipped periods. Git history may expose some changes but
does not necessarily represent the decision that was made. A rotation feature must define a durable record
or use a transparent deterministic rule that requires no hidden memory.

Proposal creation is a multi-call effect. If it is ever allowed, recovery must distinguish a created branch,
commit, and pull request and must never force-push or delete a human-modified branch.

## 9. Failure handling and safety

Unknown membership, invalid policy, ambiguous identity, missing permission, a changed base revision, or an
existing human proposal causes no administrative write. Public explanations must not expose private reasons
for exclusions or denylist entries.

Direct default-branch writes, organization-role changes, repository-setting changes, secret changes, and
workflow-file changes are outside this candidate. A content-writing version requires a separate security
review and may belong in a separate GitHub App.

## 10. Tests and sandbox proof

Tests must cover renamed and removed users, private teams, policy syntax errors, changed default branches,
concurrent human edits, duplicate schedules, an existing proposal, partial proposal creation, private data
redaction, and missing organization permission. No active administrative write should be tested in a shared
Hiero repository until maintainers approve the exact policy and rollback.

## 11. Disable, uninstall, and migration behavior

Disabling the capability stops schedules and new proposals. Existing pull requests remain ordinary GitHub
objects for maintainers to close or merge. Any stored rotation or deduplication records expire according to
policy. An existing administrative bot must remain the sole writer until an explicit handover is approved.

## 12. Open decisions

Maintainers must first decide whether mentor rotation, denylist management, or another administrative job is
actually wanted. The team must then split the selected job into its own boundary, decide whether advisory
output is enough, and evaluate whether broader repository or organization permissions are acceptable.
