# The catalogue

Everything a capability may ever read, ask, or do. Closed on purpose: a capability cannot reach
past these lists, so the boundary is enforced by the type system rather than by review (P3, P4).
Every table below is GENERATED from those lists: `pnpm contracts` rewrites the block between each
pair of markers, and `packages/dev/checks/test/catalogue-drift.test.ts` fails when the file holds
anything else — so a cell nobody thought to assert can no longer drift. The prose around the tables
is hand-written and stays review-owned.

## Facts — what a capability reads

One record per item, whatever woke the platform. The shapes, the groups, and which producer reads
which, are [`facts.md`](facts.md); this table is the closed list of KINDS and the groups each
carries.

<!-- generated: facts -->
| Kind | Groups |
|---|---|
| `issue` | `assignees`, `links`, `command` |
| `pullRequest` | `assignees`, `links`, `review`, `readiness` |
<!-- /generated -->

Every record also carries the repository, the item, `observedAt`, the trigger, `author`, `actor`,
`alerts` and `position` — the projection every gate judges by. None of those four is a group.
`position` is read by every producer and the safety world is derived from it, so an unprojected
record would refuse every intent `preconditionStale` (D141); `author` has no honest absence, since an
item nobody opened does not exist; `alerts` is read off the same label list the projection was; and
`actor` is `null` on a sweep, which is a FACT about the record rather than a group somebody skipped.
Issue records also carry the current discussion lock and any opening or added-label transition.

`assignees` is each assignee with the clock that assignment started; `links` is an issue's open
linked pull requests, and on a pull request each linked issue with its own assignees' clocks;
`review` is the changes-requested decision, `reapableSince` and the last commit; `readiness` is the
draft flag, its own group because it is the one readiness fact a webhook can read; and `command` is
what a contributor typed in a comment, projected through `mappings.commands` so a capability reads
`assign` and never `/assign`. `review` and `readiness` are the pull request's alone and `command` is
the issue's. There is no group for the App's own standing warning: the platform holds that record
itself (`design/guides/grace.md` §4).

A group is read or marked `"unread"`. A capability declares the kinds it reads and the groups it
needs, and the engine invokes it only when every group it needs was read — otherwise it records
`factsUnread` and skips, so a capability never sees an unread group and never branches on what woke
the platform.

## Resolvers — what a capability may ask

<!-- generated: resolvers -->
| Resolver | Input | Output |
|---|---|---|
| `linkedIssues` | `item` | `ItemRef[]` |
| `isAutomationActor` | `login` | `boolean` |
| `commitAttestations` | `item` | `CommitAttestation[]` |
| `mergeability` | `item` | `boolean` |
| `assigneesOf` | `item` | `string[]` |
| `openAssignments` | `login` | `{ item, meanings }[]` |
| `configAtHead` | `item` | `ConfigAtHead` |
<!-- /generated -->

A resolver answers `{ ok: false, reason }` rather than throwing, and an undeclared resolver is
unreachable: the type rejects it, and `EngineHandle` records a violation and answers `notConfigured`
rather than letting it look answered.

**Unknown is not an answer.** An empty answer and an undetermined one are different values, and a
failed read is never proof that there is no linked issue, no assignment, and no permission — so a
resolver that could not answer says which: `notConfigured` where the capability never declared it,
`unavailable` where the read is unconfirmed, refused, rate-limited or simply failed. A capability
branches on that rather than reading it as absence: an unanswered question is a reason to do
nothing, never a licence to act as though the answer were "no".

**A read the endpoint-permission matrix has not confirmed is implemented and never sent.**
`CONFIRMED_RESOLVER_READS` in the adapter is `facts.ts`'s `CONFIRMED_SWEEP_READS` rule one directory
over: a resolver outside that list reaches an endpoint with no cited row, so the gate answers it
`unavailable` before the dispatch and its reader sits complete and tested until a sandbox run cites
the row. Which names those are is the list itself, pinned by value in
`packages/runtime/test/adapter/reads/item-resolvers.test.ts` and nowhere restated — a count beside a
generated table is a sentence that goes stale the day the table grows. A resolver is a question a capability asks BEFORE it acts, so an
unconfirmed read answering anyway would be the capability acting on evidence nobody has established
the App may gather.

`openAssignments` is why the resolver source takes the repository's configuration: it projects each
assignment's labels through `mappings.labels`, so a capability receives meanings and never a label
string (contract.md §2).

## Intents — what a capability may request

The platform owns these facts; a capability declares them and the declaration must *match*, never
supply (D62).

<!-- generated: intents -->
| Operation | Desired | Idempotency | Action class | Permission |
|---|---|---|---|---|
| `postManagedComment` | `kind`, `topic`, `body`, `mention` | `nonIdempotent` | `humanFacingOutput` | `issues:write` |
| `applyMappedLabel` | `meaning`, `cause` | `idempotent` | `reversibleStateChange` | `issues:write` |
| `assign` | `login` | `idempotent` | `reversibleStateChange` | `issues:write` |
| `unassign` | `login` | `idempotent` | `reversibleStateChange` | `issues:write` |
| `releaseAssignment` | `login` | `idempotent` | `clockTriggeredDestructive` | `issues:write` |
| `closePullRequest` | `reason` | `idempotent` | `clockTriggeredDestructive` | `pull_requests:write` |
| `lockIssue` | `reason` | `idempotent` | `reversibleStateChange` | `issues:write` |
| `unlockIssue` | `reason` | `idempotent` | `reversibleStateChange` | `issues:write` |
<!-- /generated -->

`postManagedComment` carries content and purpose, never a marker. `kind` is one of `summary`,
`warning` or `notice`, and the marker is derived by the platform from the schema version, the
capability, the kind and a digest of the whole subject — a capability cannot supply one, and a
marker counts only under App authorship, so one copied into a repository user's comment can never
trigger an operation (D125).

The marker's own rules are the ones a reader has to trust, and they live in
`packages/core/src/intents/managed.ts`: one short marker per purpose per item; the schema version,
capability and kind in the clear, so a maintainer reading raw markdown can see whose comment it is;
the subject as a digest, because a topic is a capability's free text; and a body offered for
recognition refused outright when it carries no marker, is oversized, is malformed, or names a prior
or future schema — a version this reader does not read means something else by the same bytes, so v1
is refused rather than translated (D145). Authorship travels with the body, so a marker is never
evidence on its own. What the platform will RENDER is bounded the same way: no label spellings,
because a capability holds meanings and has no label to write; and the only mention that notifies
anybody is the resolved `mention`, because untrusted text a capability quotes back — a title, a
commit subject, a display name — is rendered inert first (`packages/core/src/capability/facts.ts`):
one line, every active markdown character escaped, every `@` broken, the whole thing capped. That
escaping is what neutralises a `<!--` smuggled through a title, so no quoted string can mint an
identity.

`topic` is the one part of identity a capability chooses, and it is optional: `""` for the ordinary
case, where one purpose stands once on an item, and a short stable word where one purpose may
legitimately stand more than once — an assignee's login on a per-person warning, an alert's name on
a subscription ping. Identity is per item and purpose and never per occasion, so a later delivery
about the same item finds the standing comment and updates it in place (D145). A graced act names
its topic on `grace` instead, and its warning and notice both stand under it.

`mention` is the other optional field, and it is NOT part of identity: it names a PRINCIPAL, by the
name the repository's `principals:` block declares, and the platform resolves it into the handle
behind it where identity is minted (`addressManagedComment`, run before the effect so the verdict,
the dry-run rehearsal and the recorded call all read the same bytes). A capability that wants to ping
someone therefore never learns who it pinged, for the reason `desired.meaning` is a meaning and
never a label. The same purpose addressed to two different principals is still one standing comment
on the item.

`assign`, `unassign` and `releaseAssignment` all move one login on or off one list, and they are
three operations on purpose (D63, D141). `assign` and `unassign` are the reversible pair a
contributor asks for on their own behalf; `releaseAssignment` is the clock's, so it is destructive
and reaches GitHub only through the warning-and-grace gates. `lockIssue` and `unlockIssue` are the
two directions of one moderation, kept apart for the same reason: a recorded call should name the
direction it went rather than carry a boolean an operator has to decode. `closePullRequest` is the
catalogue's first close, and its `reason` is the sentence its close notice states — carried on the
desired outcome so the recorded call names it, as `lockIssue`'s and `unlockIssue`'s are.

Four of these operations have no confirmed write endpoint — `assign`, `unassign`, `lockIssue`,
`unlockIssue` — and each is nonetheless a whole registered operation in all three layers, refusing
at the send. A row without a citation in `design/findings/endpoint-permission-matrix.md` does not
close the gate, and the honest shape of that is an implemented transport that answers `forbidden`
rather than a missing file.

`postManagedComment` is non-idempotent because experiment 6.5 observed a blind retry duplicating a
created comment; its recovery must go through the marker read-back path. `applyMappedLabel` is the
only operation that MOVES an item, which is why its cause comes from the closed entity-scoped list in
`workflow/causes.ts` rather than free text, and why `screenIntent` checks the edge (D78).

## Meanings — the positions a capability may read or write

<!-- generated: meanings -->
| Meaning | Flow | Capability-writable |
|---|---|---|
| `awaitingTriage` | issue | yes |
| `ready` | issue | yes |
| `inProgress` | issue | yes |
| `needsReview` | pull request | yes |
| `needsRevision` | pull request | yes |
| `readyToMerge` | pull request | yes |
| `blocked` | both | **no — human authority only (D79)** |
<!-- /generated -->

`blocked` is an orthogonal pause flag, never a position. An operation with no legal use is dead
vocabulary in a closed catalogue (D80), which is why the screen refuses it rather than the
documentation merely discouraging it.

## What the catalogue does not contain

The catalogue was sized to serve three seeds chosen for contract diversity, not for demand
(`packages/capabilities/README.md`). Five of the eight candidate capabilities need an operation that is not
here — no assign, no request-reviewers, no external delivery, and no way to write a level
outside `MAPPABLE_MEANINGS` (D115). The pull-request close is the one that has since arrived, with
inactivity's promotion (D141): it is in the catalogue, and its endpoint is not, so the shell refuses
the verb at send. Adding one is not a documentation edit: an operation needs a
matrix row with a citation, a permission inside the ceiling, an idempotency class measured rather
than assumed, and a recovery rule. A resolver is the same review with one question in place of the
idempotency class: one documented reading of one question, read-only, inside the ceiling, with a
declared answer for the unclear case — and a policy resolver may never invent a role hierarchy that
GitHub's own permissions do not express. That work is a catalogue review, and it is stage-four
territory.
