# Facts — what a capability reads, whatever woke the platform

> **Contract (2026-09-09, the ground-up plan's G3).** One fact shape per item kind. A webhook and a
> sweep both produce it; what differs is how much of it they read. A capability declares which
> kinds it reads and which fact groups it needs, and the platform invokes it only when those
> groups were read — so a capability never sees an unread group and never branches on what woke it.

## 1. The two shapes

```ts
/** What woke the platform. Metadata a capability may log, never branch on. */
export type Trigger = { readonly kind: "event"; readonly event: string } | { readonly kind: "sweep" };

/** A group the producer did not read. A capability that declared the group never sees this. */
export type Unread = "unread";

export interface IssueFacts {
    readonly kind: "issue";
    readonly repository: RepositoryRef;
    readonly item: ItemRef;
    readonly observedAt: Date;
    readonly trigger: Trigger;
    /** Who opened it. Never a group: every producer can read it. */
    readonly author: string;
    /** Who caused this record, or `null` on a sweep. Never a group either. */
    readonly actor: { readonly login: string } | null;
    /** GitHub's current discussion lock state. */
    readonly locked: boolean;
    /** The issue transition carried by this observation, or `null` when there is none. */
    readonly arrival:
        | { readonly kind: "opened" }
        | { readonly kind: "label"; readonly meaning: MappableMeaning | null }
        | null;
    /** Always read: the projection every gate judges by. */
    readonly position: Projection<IssueMeaning>;
    /** The open-keyed family: what this item carries, and what just arrived. */
    readonly alerts: { readonly carried: readonly string[]; readonly arrived: readonly string[] };
    readonly assignees: readonly AssigneeClock[] | Unread;
    readonly links: { readonly openPullRequests: readonly ItemRef[] } | Unread;
    /** `null` is a READ group whose delivery carried no command; only `Unread` means nobody looked. */
    readonly command: { readonly command: Command; readonly by: string; readonly at: Date } | null | Unread;
}

export interface PullRequestFacts {
    readonly kind: "pullRequest";
    readonly repository: RepositoryRef;
    readonly item: ItemRef;
    readonly observedAt: Date;
    readonly trigger: Trigger;
    readonly author: string;
    readonly actor: { readonly login: string } | null;
    readonly position: Projection<PrMeaning>;
    readonly alerts: { readonly carried: readonly string[]; readonly arrived: readonly string[] };
    readonly assignees: readonly AssigneeClock[] | Unread;
    readonly links: { readonly issues: readonly LinkedIssue[] } | Unread;
    readonly review: {
        readonly changesRequested: boolean;
        readonly reapableSince: Date;
        readonly lastCommitAt: Date | null;
    } | Unread;
    /** Has the author offered it for review yet? Its own group: a webhook can read this one. */
    readonly readiness: { readonly draft: boolean } | Unread;
}

export type Facts = IssueFacts | PullRequestFacts;
export const FACT_KINDS = ["issue", "pullRequest"] as const;
export const FACT_GROUPS = ["assignees", "links", "review", "readiness", "command"] as const;
```

`AssigneeClock` and `LinkedIssue` (an item with its assignees' clocks) keep their current shapes.

**Five fields are never groups.** `position` is one, because every producer reads labels and state
and the safety world is derived from it. `author` is another: an item nobody opened does not exist,
so there is no honest `Unread` for it and a payload without one is malformed. `alerts` is the third
— every producer reads the item's labels already, and the family is read off the same list the
projection was. `actor` is a field whose value may be `null`, which is NOT an `Unread`: a swept item
was read because a clock fired, so "nobody caused this" is a fact about the record rather than a
group somebody skipped. Issue records also always carry `locked` and `arrival`; `arrival: null`
means the observation carried no opening or added-label transition.

**A pull-request record carries no head sha.** Nothing above names one, and no group holds one, so
a capability that needs the commit a pull request currently points at asks a resolver for it — the
adapter is where a head sha is read, and it is read at the moment of asking rather than carried from
whenever the record was made.

**`readiness` is `draft` alone, and it left `review` for a reason.** It is the one readiness fact a
WEBHOOK can read — the payload carries it — while the three facts remaining in `review` need the
timeline. A capability wanting only draft state would otherwise have to declare `review` and be
skipped `factsUnread` on every delivery it was triggered by.

## 2. What a producer reads

The producers are a registry — `PRODUCERS` in `packages/core/src/capability/producers.ts` — and
this table is generated from it by `pnpm contracts`. One row per producer and per kind it makes a
record of; `—` is a group that kind does not carry.

<!-- generated: producers -->
| Producer | Kind | position | assignees | links | review | readiness | command |
|---|---|---|---|---|---|---|---|
| `issues` | `issue` | read | unread | unread | — | — | unread |
| `issue_comment` | `issue` | read | unread | unread | — | — | read |
| `pull_request` | `pullRequest` | read | unread | unread | unread | read | — |
| `sweep` | `issue` | read | read | read | — | — | unread |
| `sweep` | `pullRequest` | read | read | read | read | read | — |
<!-- /generated -->

A producer marks a group unread rather than inventing a value: an empty assignee list from a
webhook would be a lie the safety world cannot tell from a fact. Any future producer that reads
more than the projection says so by filling the group — and by adding its row here first, because
the row is what a declaration is judged against.

**The row is the promise; the record is the day's fact.** A read that failed, and a read the
endpoint-permission matrix has not confirmed, both leave their group unread on a record its row
says `read`. No row falls short that way today — the sweep's `review` was the standing example and
protocol 6.9 cited its three reads (`design/guides/sweep.md` §4) — and the `factsUnread` skip stays
anyway: the boot check refuses a capability that could never run, and the skip covers the record
that falls short of what was promised, whichever of the two reasons put it there.

## 3. What a capability declares

```ts
declareCapability({
    name: "inactivity",
    facts: ["issue", "pullRequest"],          // the kinds it reads (was `observations`)
    needs: ["assignees", "links", "review"],   // the groups it reads
    // triggers, settings, requiredMappings, resolvers, intents as before
});
```

- `needs` may name a group only if some declared kind carries it; `review` on an issue-only
  declaration is a declaration error at boot.
- A need must also be READ by the producer each declared trigger names — an event names the webhook
  producer of that event, a schedule names the sweep. `needs: ["review"]` on a `pull_request`
  trigger is refused at boot, because the webhook reads no group and the capability would be
  skipped on every delivery instead. The refusal names the trigger, the group, and the producers
  that do read it.
- The view a capability receives is `FactsFor<D>`: the declared kinds, with every declared group's
  `| Unread` removed. The type is the guarantee — `"unread"` cannot reach a capability that
  declared the group, and a capability that did not declare a group cannot read it (the group is
  typed `Unread` for it, which nothing can do anything with).

## 4. What the engine does

- `decide()` takes one fact record, or a delivery that `normalize/` turns into one. A sweep hands
  the engine one record per item; it does not batch, so a decision is about one item and the
  projection for every intent is the record's own.
- For each enabled capability: skip unless `declaration.facts` includes the record's kind; then,
  for each group in `needs` that the kind carries, if the record holds `"unread"`, record
  `factsUnread` (an `info` finding naming the capability and the group) and skip. Otherwise invoke.
- The engine's own world derivation reads `position` only. Nothing else in core reads a group.

## 5. What this replaces

`issueUpdated`, `pullRequestUpdated`, `staleIssuesDue`, `stalePullRequestsDue` — two shapes for the
same issue and two for the same pull request, with the sweep pair carrying a list the engine had
to project per entry. The declaration's `observations` field becomes `facts`; the catalogue's
observation table becomes the two shapes above and the producer table.

## 6. Declined

- **Per-group timestamps** (when each group was read): declined — a producer reads the record at
  one instant, `observedAt`; reopen if a producer ever mixes cached and fresh groups.
- **A `Trigger` a capability may branch on**: declined by type — it is there for reports and for
  the idempotency occasion, and a capability that behaved differently on a sweep than on an event
  would be deciding from the platform's schedule rather than from the item's facts.
