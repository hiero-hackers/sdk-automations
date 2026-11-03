# Capability Runtime Contract

> **Built for the capability boundary** — `packages/core/src/capability/` implements the declaration,
> projected view, resolver handle, intent factory, and runtime screens. The three capabilities in
> `packages/capabilities/` exercise the boundary and P3 isolation.
> `packages/dev/checks/test/contract-drift.test.ts` locks §1's interfaces.

This contract says what the boundary can enforce. What happens to an approved intent after the engine —
the journal, the apply, the read-back — is the write path's contract, `design/guides/write-operations.md`.
Neither page promises rollback or a generic conformance kit; those do not exist in this workspace.

## 1. Declaration

```ts
interface CapabilityDeclaration {
  readonly name: string;
  readonly triggers: readonly DeclaredTrigger[];
  readonly closed?: boolean;                     // also woken for a closed item; absent is open only (D59)
  readonly settings: Spec;                       // the settings toolkit's spec; its keys are the legal names
  readonly requiredMappings: DeclaredMappings;
  readonly labels: readonly string[];            // the positions its moves enter (D204)
  readonly moves: readonly string[];             // the transition causes it owns; non-empty iff intents holds applyMappedLabel (D243)
  readonly reads: readonly string[];             // the positions it consults and does not set; never `blocked`
  readonly facts: readonly string[];
  readonly needs: Readonly<Record<string, readonly string[]>>; // per kind (D214)
  readonly wants: Readonly<Record<string, readonly string[]>>; // per kind: read when the producer has it, "unread" otherwise, never a skip (D245)
  readonly resolvers: readonly string[];
  readonly intents: readonly string[];
}

type DeclaredTrigger =
  | { readonly kind: "event"; readonly event: WebhookProducer }   // issues | issue_comment | pull_request
  | { readonly kind: "schedule"; readonly description: string };

interface DeclaredMappings {
  readonly labels?: readonly string[];
  readonly commands?: readonly string[];
  readonly skills?: readonly string[];
}
```

- `validateCapabilityDeclarations` validates the complete directly admitted set: name syntax, at least one
  trigger, at least one fact kind, duplicates, catalogue membership, and duplicate capability names.
- `declareCapability` takes the author's shorter form: `facts` is implied by an event trigger (each webhook
  producer yields one kind; a schedule trigger states its kinds), `needs` may be one list — each group
  reaches every declared kind that carries it — or a list per kind, and `requiredMappings` defaults to
  empty. The filled declaration, `needs` per kind, is what everything below reads.
- `moves` names the transition causes a capability owns, checked against the map and against `intents`:
  one that may set a position owns an edge, and one that owns edges declares the intent. No cause has two
  owners. `labels`, the positions those edges enter, follows from it and is never written. The parser copies `labels` onto the enabled block, so the configuration report can tell a file's
  reviewers which labels the App will use, and define if missing (D204). `reads` names the positions it
  consults and does not set, for taxonomy §2.1's tables; `blocked` is the platform's and is never listed.
- `settings` and `requiredMappings` are the two fields the CONFIGURATION layer reads: the first is the
  spec every capability block is read against — its keys are the legal names a block may carry beside
  `enabled`, and its fields judge the values, at parse time, with the rest of the file — and the
  second says which meanings must be mapped, by
  family, before the capability may be enabled. Both are empty rather than absent for a capability that
  wants neither, and a required meaning outside its family's closed catalogue is a boot error (D84). A
  family the object omits demands nothing.
- `facts` and `needs` are the two the ENGINE reads ([`facts.md`](facts.md) §3): which item kinds this
  capability is handed a record for, and which groups of each kind's record it reads. A need on a kind
  it does not declare, or a group that kind does not carry — `review` on an issue — is a boot error (D214).
  `wants` names groups the capability reads when the producer has them: a want arrives `"unread"` on a
  producer that does not read it, and the capability is still invoked; one no trigger's producer reads,
  or one the capability already needs, is a boot error (D245).
- `TypedDeclaration` narrows mapping, fact, group, resolver, and intent names to the closed platform
  catalogues, which is also what lets a declaration serve as an `AdmittedCapability` uncast.
- `declareCapability<const D>` preserves those lists as literal tuples so the boundary can project exact
  types instead of widening them to every name.
- A closed issue or merged pull request reaches a capability only when it declares `closed: true`; the engine
  skips it in silence otherwise, as it skips a kind the capability never declared (D59).
- There is no runtime retirement registry, `describe`, or tombstone lookup. The application passes one
  direct admitted set, and configuration rejects every name outside it.

**Permissions, action class, and idempotency are not declaration fields.** The platform owns those facts in
`INTENT_OPERATIONS`; deriving them from the requested operation prevents a capability from restating or
widening its authority (D62).

## 2. Runtime boundary

```ts
interface Capability<D extends TypedDeclaration> {
  readonly declaration: D;
  evaluate(
    facts: FactsFor<D>,
    config: CapabilityView<D>,
    platform: PlatformHandle<D>,
  ): Promise<readonly IntentFor<D>[]>;
}

interface CapabilityView<D extends TypedDeclaration> {
  /** Resolved against the declaration's own spec by `parseConfig`; defaults applied. */
  readonly settings: SettingsOf<D["settings"]>;
  readonly mapped: {
    readonly labels: readonly MappableMeaning[];
    readonly commands: readonly Command[];
    readonly skills: readonly Skill[];
    /** The OPEN family: the repository names these meanings too, so they are strings. */
    readonly alerts: readonly string[];
  };
  readonly principals: readonly string[];
}

interface PlatformHandle<D extends TypedDeclaration> {
  ask<Q extends D["resolvers"][number] & ResolverName>(
    query: Q,
    input: ResolverInput<Q>,
  ): Promise<ResolverOutput<Q>>;
  resolve<Q extends D["resolvers"][number] & ResolverName>(
    query: Q,
    input: ResolverInput<Q>,
  ): Promise<ResolverAnswer<ResolverOutput<Q>>>;
  intent<K extends D["intents"][number]>(request: IntentRequest<K>): Intent<K>;
  skip(summary: string, ...detail: readonly string[]): readonly never[];
  explain(explanation: StructuredExplanation): void;
}
```

`ask` is the resolver call a capability writes: the answer, or the evaluation ends as skipped with a
platform-written explanation (D51, once, in the engine). It ends the evaluation by throwing the platform's own
sentinel, which `decide()` catches; that is the one throw a capability body may cause, and a capability that
catches it and still returns intents has them refused as `intentsAfterSkip`. `resolve` is the raw answer, for
the capability that carries on without one. `skip` is the explicit stop, returned. `intent` builds one intent
about the record in hand, so the occasion, the cause, and the claims are read off the record (§3).

`FactsFor<D>` is the declared kinds, each with its own kind's needed groups' `| Unread` removed and every
other group typed `Unread` — the type is the guarantee, not a promise the engine keeps.

`CapabilityView.settings` keeps that name in the code; the DOCUMENT has no such key. A maintainer
writes a capability's keys beside its `enabled`, on one flat block, and `settings` is only what the
platform calls them once they are resolved.

The platform supplies normalized facts, the capability's own settings as its spec RESOLVED them, the
**names** of mapped meanings in each family and of declared principals, and only its declared resolvers. The boundary exposes no
Octokit client, HTTP, raw webhook body, repository label string, command word, team string behind a
principal, mode, enabled flag, installation grant, or sibling capability.

`toEngine()` performs the one internal type erasure needed to run unlike declarations through one engine
loop. It does not expand what a capability can see.

## 3. Intents

```ts
interface Intent<K extends IntentOperation> {
  readonly capability: string;
  readonly repository: RepositoryRef;
  readonly item: ItemRef;
  readonly operation: K;
  readonly claims: ClaimedFacts;
  readonly desired: IntentCatalogue[K];
  readonly cause: DatedCause;
  readonly explanation: StructuredExplanation;
  readonly idempotencyKey: string;
}
```

- An intent requests an outcome; it is never proof that the outcome happened.
- `platform.intent` restricts the operation to the declaration, binds repository, item, capability, and
  observation time from the record, requires an explanation, and derives the idempotency key. An act with a
  clock of its own dates itself at that clock's start instead, through `occasion`, so the effect identity is
  stable across sweeps and a reset mints a new one (`design/guides/grace.md` §1).
- **Claims are derived from the record** unless the request narrows them: closure as observed, every mapped
  meaning observed as present, and a label's meaning as absent. A wider claim refuses on a moved world, which
  is the safe side, and the next delivery re-evaluates.
- **The cause defaults to the trigger** (the event name, or `sweep`) and is part of the idempotency key, so a
  capability that already states one keeps it: the key is the store's `effect_id` (D65).
- **A label's transition cause comes from the map** (`moveTo`) when the request leaves it out: the edge's
  first cause the capability owns. No edge from the item's position, or none it owns, ends the evaluation as
  skipped.
- `screenIntent` judges what the compiler cannot: capability identity, declared operation, dated cause,
  the re-derived key, the grace terms, then for a label move pause authority first (no edge enters
  `blocked`, so the ownership screens would hide it), the meaning's and the cause's ownership
  (`undeclaredMeaning`, `undeclaredCause`), entity/meaning compatibility, position conflicts, and
  transition legality. The intent's shape is the compiler's (D209); the engine contains a non-object
  entry as `malformedIntent` and reads nothing else defensively.
- The engine derives action class and required permission from `INTENT_OPERATIONS`, then derives an
  unforgeable safety world from the record's own projection and the intent's claims.
- A passed screen can still be refused or recorded-only by the safety contract.

## 4. Isolation and composition

- A disabled capability is not invoked and leaves no finding.
- A capability whose declaration does not include the record's kind is not invoked, and one needing a
  group the producer left unread is skipped with a `factsUnread` finding.
- Resolver names are restricted both by TypeScript and by the engine handle at runtime.
- The engine sees capabilities only through their declarations and projected views; there is no sibling
  reference to call.
- `packages/capabilities/test/engine-matrix.test.ts` runs every subset of the three unlike seeds over four
  records — a webhook-shaped and a sweep-shaped one of each kind — and asserts
  each one's approved intents and findings are identical to its alone-run. This proves the boundary's current
  P3 isolation property, not that any seed is a finished product capability.

## 5. What the current tests cover

| Property | Evidence |
|---|---|
| declaration structure and catalogue admission | core declaration tests |
| undeclared settings, resolvers, observations, and intents stay unavailable | core boundary tests and the capabilities package's boundary tests |
| intent keys, claims, transition screens, and refusal codes | core capability tests |
| disabled capabilities leave zero trace; neighbours do not change a decision | the capabilities package's engine matrix |
| repository modes, permission grants, pause state, and newer-human precedence gate intents | core safety and engine tests |

There is no declaration-derived suite that automatically proves rollback, effect convergence, or every
compatibility rule. Each capability adds its own policy tests — the rows of its design's Verified-by
table — and the write path's tests sit at its own boundary (`design/guides/write-operations.md`).

## 6. Deliberately deferred

- Decide whether `OperationalNeeds` is sufficient now that a scheduled capability and the sweep use it.
- Define compatibility/ownership rules between capabilities without introducing sibling calls.
- Rollback and a generic conformance kit: a capability's reversal is rehearsed in the rings
  `CONTRIBUTING.md` names, not proved by a declaration-derived suite.

Earlier versions of this list also deferred what the platform has since built: the first seed promoted
against its design (`inactivity`, D141); capability-owned settings validation and declared required
mappings (D84, `design/guides/capability-kits.md`); adapter commands, postcondition verification, effect
results and recovery (`design/guides/write-operations.md`); and the sweep's per-item records, which hand
a scheduled capability authoritative facts instead of a `preconditionStale` refusal
(`design/guides/sweep.md`).
