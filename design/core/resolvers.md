# Resolvers: One Mechanism per Question

> **Drafted for ratification.** The resolvers are the core's shared read-only answers — where two
> modules must agree on a computation, they call one resolver instead of each carrying a copy
> (`design/architecture.md` §4, the B2 cure). This document fixes each resolver's mechanism, and takes
> a position on the one real product decision hiding here: **the skill ladder's scope** (§3).
> Positions are **proposed**.

## 1. The contract every resolver obeys

- **Read-only and deterministic** per observation — a resolver never writes, and two calls in one
  processing pass agree (memoized within the pass; no cache beyond it — the app is stateless).
- **One mechanism per question.** The old system answered "what issue is linked?" two ways that could
  disagree (lessons B2). Here a second mechanism for an existing question is a rejected PR.
- **Implementation choices are quarantined behind the signature.** Where a fact lives (a native
  field, a Projects field, an org-wide count) is the resolver's private business — swapping it
  changes no module. This is what lets §3's decision be made calmly, and remade cheaply.
- **Metered, not declared** — resolver call costs are measured at the core
  (`design/operations/README.md` §4); modules never see budgets.

## 2. The register

| Resolver | Answers | Mechanism | Main consumers |
|---|---|---|---|
| `linkedIssues(pr)` / `linkedPRs(issue)` | what is linked to what, both directions | GraphQL closing references — **only** | inactivity (open-PR check), pr-quality, progression |
| `eligibleLevel(user)` | the highest rung this user may take | closed-issue counts per rung vs the ladder thresholds — scope per §3 | assignment (gate), progression (recommend) |
| `isBot(actor)` | is this actor automation | actor type = Bot **+ the app's own identity + the old-bot deny-list** | shell (skip self), manual-edit seniority (`design/core/manual-edits.md` §7) |
| `mayPerform(actor, action)` | may this actor invoke this | GitHub's own permission level + config teams — no app-side tiers | command dispatch, intake |
| `priorityOf(item)` | the item's priority | native field / Projects / legacy label — quarantined | progression (sort) — rule fixed in `design/core/taxonomy.md` §4 |

Per-resolver notes, where the mechanism is an argument and not just a choice:

- **`linkedIssues` must be closing references, not text-scanning** — not merely for consistency:
  the seam design (`design/core/taxonomy.md` §2.3) relies on GitHub *natively* closing linked issues
  at merge, and GitHub closes exactly what the closing references name. Any other mechanism would
  make the resolver disagree with what actually happens at merge. A PR without a closing keyword is
  simply not linked; pr-quality's link check is the module that tells authors so.
- **`isBot` carries three lists, each load-bearing:** the platform's Bot type; the app's own
  identity (its writes echo back as webhook events — recognising itself is loop prevention before
  idempotency even has to absorb anything); and the known old-bot accounts, which are refused
  human seniority during migration (`design/core/manual-edits.md` §7).
- **`mayPerform` adds no tiers** (`design/config/schema.md` §3): GitHub's permission model is the
  tier system. It answers only what the platform can't express — which slash commands an
  unprivileged contributor may invoke (`/finalize` needs triage; `/assign` is open, gated by the
  ladder, limits, and invariants instead of by role).

## 3. The skill ladder's scope: per-repo or org-wide? *(proposed: org-wide credit, repo-local gate)*

The old bots counted completions per repo — by accident of architecture, not decision. A hosted app
is the first design that *can* count across the org, so the question is finally real:

| | Per-repo | Org-wide |
|---|---|---|
| contributor experience | proven in Python, a stranger in C++ | progression is portable across the SDK family |
| calibration | each repo's labels match its difficulty | assumes rungs mean roughly the same across repos |
| config | thresholds could vary per repo | thresholds **must** live in the org file, or counting is incoherent |
| hoarding | `maxOpenAssignments` caps per repo only | cross-repo counting also enables a future org-wide view |
| queries | repo-scoped search | org-scoped search — same call count (~1/rung, event-driven, cheap) |

**Proposed:** *org-wide credit, repo-local gate.* Completions count across the organisation — the
SDKs are one domain (the same API surface in five languages), and a contributor who finished two
good-first-issues in the Python SDK has proven exactly what the C++ SDK's beginner gate exists to
check. The *gate* stays repo-local — each repo still decides which rung each of its issues demands,
via its own `skill:` labels. Consequence, accepted with eyes open: the ladder thresholds
(`core.skillLadder`) become **org-level config that repos do not override** — a repo-varied
threshold under org-wide counting would be incoherent.

**Overturned by:** maintainers judging difficulty non-transferable between repos. The fallback is a
single org-level scope key (`org` | `repo`) inside the resolver's config — and because the scope is
quarantined behind `eligibleLevel`'s signature, flipping it changes **no module, no contract, no
test above the core unit layer**. This question belongs in the ratification memo; it is a product
choice about contributors, not an engineering constraint.

## 4. Open

- The ladder scope (§3) — for the ratification memo.
- What counts as a completion: issue closed *by a merged PR* of the user's, or any close while
  assigned? (Proposed at build: merged-PR closes only — a maintainer closing as stale should not
  credit a rung.)
- Whether `eligibleLevel` also surfaces progress ("1 of 2 toward beginner") for progression's
  level-up messages — a return-shape detail, decided with that module.
- The old-bot deny-list contents — fixed by the migration protocol (`design/operations/` when
  drafted).
