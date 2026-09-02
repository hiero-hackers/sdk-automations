# The catalogue

Everything a capability may ever observe, ask, or do. Closed on purpose: a capability cannot reach
past these lists, so the boundary is enforced by the type system rather than by review (P3, P4).
`packages/dev/checks/test/catalogue-drift.test.ts` locks each table's first-column identifiers to code,
plus the permission, idempotency and action-class facts for each intent. Payload descriptions, resolver
I/O prose, desired-value descriptions and meaning metadata remain review-owned.

## Observations — what wakes a capability

| Observation | Carries | Notes |
|---|---|---|
| `issueUpdated` | repository, item, `position`, `observedAt` | the projection itself, never a flattened meaning list — a conflict must stay distinguishable from a clean position (D81, D35) |
| `pullRequestUpdated` | repository, item, `position`, `observedAt` | `merged` is `state.closedBy === "merged"`, a closure reason rather than a position (D47) |
| `staleItemsDue` | repository, items with assignee, `lastHumanActivityAt`, `warnedAt` | schedule-triggered and unprojected, so a capability reading it gets `preconditionStale` if it claims current state |

## Resolvers — what a capability may ask

| Resolver | Input | Output |
|---|---|---|
| `linkedIssues` | `item` | `ItemRef[]` |
| `isAutomationActor` | `login` | `boolean` |

A resolver answers `{ ok: false, reason }` rather than throwing, and an undeclared resolver is
unreachable: the type rejects it, and `EngineHandle` records a violation and answers `notConfigured`
rather than letting it look answered.

## Intents — what a capability may request

The platform owns these facts; a capability declares them and the declaration must *match*, never
supply (D62).

| Operation | Desired | Idempotency | Action class | Permission |
|---|---|---|---|---|
| `postManagedComment` | `kind`, `body` | `nonIdempotent` | `humanFacingOutput` | `issues:write` |
| `applyMappedLabel` | `meaning`, `cause` | `idempotent` | `reversibleStateChange` | `issues:write` |
| `unassign` | `login` | `idempotent` | `reversibleStateChange` | `issues:write` |

`postManagedComment` carries content and purpose, never identity. `kind` is one of `summary`,
`warning` or `notice`, and the marker is derived by the platform from the schema version, the
capability, the kind and the effect id — a capability cannot supply one, and a marker counts only
under App authorship, so one copied into a repository user's comment can never trigger an operation
(D125, `design/guides/managed-output.md` §2 and §4).

`postManagedComment` is non-idempotent because experiment 6.5 observed a blind retry duplicating a
created comment; its recovery must go through the marker read-back path. `applyMappedLabel` is the
only operation that MOVES an item, which is why its cause comes from the closed entity-scoped list in
`workflow/causes.ts` rather than free text, and why `screenIntent` checks the edge (D78).

## Meanings — the positions a capability may read or write

| Meaning | Flow | Capability-writable |
|---|---|---|
| `awaitingTriage` | issue | yes |
| `ready` | issue | yes |
| `inProgress` | issue | yes |
| `needsReview` | pull request | yes |
| `needsRevision` | pull request | yes |
| `readyToMerge` | pull request | yes |
| `blocked` | both | **no — human authority only (D79)** |

`blocked` is an orthogonal pause flag, never a position. An operation with no legal use is dead
vocabulary in a closed catalogue (D80), which is why the screen refuses it rather than the
documentation merely discouraging it.

## What the catalogue does not contain

The catalogue was sized to serve three probes chosen for contract diversity, not for demand
(`packages/probes/README.md`). Five of the eight candidate capabilities need an operation that is not
here — no assign, no close, no request-reviewers, no external delivery, and no way to write a level
outside `MAPPABLE_MEANINGS` (D115). Adding one is not a documentation edit: an operation needs a
matrix row with a citation, a permission inside the ceiling, an idempotency class measured rather
than assumed, and a recovery rule. That work is a catalogue review, and it is stage-four territory.
