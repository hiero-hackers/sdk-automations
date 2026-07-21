# Shared Read-Only Resolvers

> A resolver answers a question that more than one capability must ask in the same way. Resolvers are
> read-only platform services. Their exact list remains open until the first capabilities are selected.

## 1. Resolver rules

Every resolver follows these rules.

1. A resolver uses one documented source and interpretation for a question.
2. A resolver performs no repository write.
3. A resolver returns normalized facts rather than GitHub transport objects.
4. A resolver declares its permissions, pagination, rate cost, caching, and unclear-result behavior.
5. A resolver is memoized only when the architecture can prove that the cache does not hide newer state.
6. A capability can call only the resolvers in its declaration.
7. Repository policy that changes the answer enters through validated configuration or a selected workflow
   profile.

## 2. Candidate resolver register

| Resolver | Question | Candidate source | Main open issue |
|---|---|---|---|
| `linkedIssues` and `linkedPullRequests` | Which issues and pull requests are related under the repository's policy? | GitHub closing references are the candidate default. | Repositories may use different link rules, and reverse lookup cost requires testing. |
| `mayPerform` | May this actor request the named action? | GitHub repository permissions plus declared teams or deny rules. | The permission and team scopes must remain acceptable to maintainers. |
| `isAutomationActor` | Did an App or known bot create this event? | GitHub actor type, App identity, and migration configuration. | Old automation identities must be listed during coexistence. |
| `priorityOf` | What priority does the repository assign to this item? | A configured native field, Project field, or legacy label mapping. | Project fields require additional permissions and may not be wanted. |
| `eligibleLevel` | Which optional skill-policy rung may this contributor claim? | Configured completion rules over repository or organization history. | Skill policy, credit scope, and completion meaning are not universal decisions. |

The first implementation should build only the resolvers required by the selected technical slice and first
capability.

## 3. Link resolution

The audited automation answers the issue and pull request link question in more than one way. Body text and
GitHub closing references can disagree. A selected capability must therefore use one configured resolver and
must not implement a private parser.

Closing references are the current default hypothesis because they match GitHub's native close-on-merge
behavior. The sandbox test must still cover multiple linked issues, several pull requests for one issue,
missing closing keywords, reopened items, forks, and inaccessible repositories.

## 4. Authorization

`mayPerform` does not replace GitHub permissions. It combines the installation's actual permission, the
actor's repository authority, and capability policy that cannot be expressed through GitHub alone.

A capability must not invent its own role hierarchy. If a capability needs organization team membership or
another broad permission, the endpoint and permission matrix must show the need before the App manifest is
expanded.

## 5. Optional skill policy

`eligibleLevel` exists only when a repository enables a skill-based assignment or progression policy. It is
not a universal core requirement.

Repositories that request this resolver must decide all of the following questions.

- They must decide which rung mappings and prerequisite counts apply.
- They must decide what event counts as a completed contribution.
- They must decide whether credit is repository-local or organization-wide.
- They must decide how renamed or retired labels affect historical credit.
- They must decide how API search delay and rate limits affect an assignment refusal.

The resolver hides the chosen mechanism from capabilities, but it does not make the product decision on
behalf of maintainers.

## 6. Failure behavior

A resolver distinguishes an empty answer from an answer that could not be determined. A capability must not
treat an API failure as proof that a user is ineligible, that no linked issue exists, or that no permission is
present.

The platform reports whether the resolver can retry, must wait for a rate limit, lacks permission, or cannot
answer under the current configuration.

## 7. Questions that remain open

- The first capability selection must determine the first resolver set.
- The adapter experiment must determine pagination and rate costs.
- The configuration design must determine how resolver policy and mappings are supplied.
- Maintainers must decide whether any repository wants the optional skill resolver.
- The project must decide whether reverse issue-to-pull-request lookup requires owned indexing.
