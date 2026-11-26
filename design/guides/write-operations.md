# Write operations — two modules and a row

> **The contract a write operation is built to (D133, D210).** A write operation is a core module and
> a shell handler, each registered in a mapped-type registry, plus one row in the adapter's request
> table and one shape in the client's endpoint table — so forgetting any of the four fails to compile
> where it is missing. This page is the two module contracts, the two tables, the absolute
> payload-compatibility rule, and the five write rules `decide()` cannot judge.

## 1. The recipe

Adding a write operation touches exactly this, and nothing else:

| Layer | Adds | The compiler catches |
|---|---|---|
| core | `core/src/intents/operations/<op>` — the platform's facts and the change wording — plus one key in `IntentCatalogue` | a key with no module, at the core registry |
| shell | `runtime/src/shell/apply/operations/<op>` — traits · plan · serialize · parse · send · confirm — plus its call type in the `Call` union | a key with no handler, at the shell registry; a call the union does not hold, at `plan` |
| adapter | one verb on `WriteVerbs` (`core/src/seams.ts`) and its row in `runtime/src/adapter/writes/requests.ts`; one shape in `runtime/src/adapter/client/endpoints.ts` | a verb with no row, at the request table; a shape whose grant or body disagrees with the row, at `permission.test.ts` |

Both registries are typed `{ readonly [K in IntentOperation]: <Contract><K> }` and are the only
places the operations are listed. A module never imports its same-named sibling in another package;
the same names are a convention for the file finder, not a dependency (the cruiser's layer rules
hold unchanged). Layer boundaries are untouched: core decides, the shell orchestrates, the adapter
talks to GitHub.

One obligation stands over the whole shape: the FX-gate protocol
(`packages/dev/lab/protocols/8.2-first-effects.md`) passes on the reviewed build that ships a new
verb, and no graced act ships against a repository until it has. It was re-run armed on 2026-10-07,
covering `assign` and the real `unassign`, and every step held — on an unreviewed working tree, so
the run on the reviewed commit is still owed.

## 2. Core — `intents/operations/<op>`

**Location.** The modules live beside the intent they describe, because the facts table is consumed
BELOW the engine — `idempotencyOf` in `intent.ts` and the declaration screen in `declaration.ts`
both read it — and `engine/` imports `intents/`, never the reverse. Putting the registry in the
engine would mint the cycle the placement skill forbids. The engine keeps the generic recipe
(`change.ts`), which is what D128 asked of it.

**The module contract.**

```ts
/** The change one intent of this operation makes — the fields describeChange may read. */
export interface ChangeSubject<K extends IntentOperation> {
    readonly capability: string;
    readonly desired: IntentCatalogue[K];
}

export interface OperationModule<K extends IntentOperation> {
    /** The platform's facts: idempotency class, action-class floor, permission (D62). */
    readonly facts: OperationFacts;
    /** contracts/safety.md's exact item-and-value wording; pinned by the slice parity test. */
    describeChange(subject: ChangeSubject<K>): string;
}
```

`describeChange` is a method, not a function-typed property, so a module for one `K` is assignable
where the registry's union is called — the same bivariance the engine already relies on. The module
imports types from the catalogue only; `intent.ts` and `declaration.ts` import the registry. That
is the import direction: catalogue → operations → intent/declaration → engine.

**The registry** (`intents/operations/index`): `OPERATIONS`, typed by the mapped type above;
`INTENT_OPERATIONS` is DERIVED from it (`facts` per key) and keeps its name, its type and its place
in the public barrel — the slice test, the boundary test and the catalogue drift lock read it
unchanged. `IntentCatalogue` and `IntentOperation` stay in the catalogue file: the desired-outcome
shape is vocabulary a capability sees, and the key list is what the registry is checked against.

**The engine's generic recipe.** `describeChange(intent)` becomes one line over the registry;
`writeRequestFor` and `wouldApplyFinding` do not change. The one cast that correlates
`intent.operation` with its module is written once, in `change.ts`, with the argument beside it —
the pattern `invoke.ts` established for erased capability types.

## 3. Shell — `apply/operations/<op>`

**The handler contract.** Keyed by operation, because the ledger, the gates and the report all
speak in operations; a handler owns every call verb its operation sends.

```ts
export interface OperationTraits {
    /** A landed call of this operation is the warning a graced act promised (grace.md §3). */
    readonly recordsWarning: boolean;
    /** The fresh gate reads the affected person's activity before a graced act of this operation. */
    readonly activityRead: boolean;
}

export interface OperationHandler<K extends IntentOperation> {
    /** The call verbs this operation's rows carry — `operationOf` is derived from these. */
    readonly verbs: readonly Call["verb"][];
    /** What the choreography asks of the operation through `traitsOf`, never by naming it (D210). */
    readonly traits: OperationTraits;
    /** The calls one approved effect takes, in send order, or the reason it takes none. */
    plan(effect: Effect & { intent: Intent<K> }, config: RepositoryConfig): Plan;
    /** The row fields after the head — `verb` first, then the call's own, in row order. */
    serialize(call: CallOf<K>): Record<string, unknown>;
    /** The call a row's bytes hold, or `null`; total over `unknown`. */
    parse(row: unknown): CallOf<K> | null;
    /** One call, sent; the read-before-write for a comment lives here. */
    send(call: CallOf<K>, pass: SendContext): Promise<WriteResult>;
    /** Does GitHub say this call's postcondition holds? */
    confirm(call: CallOf<K>, pass: SendContext): Promise<Confirmation>;
}

/** What one send may know: the item, the two seams, and this effect's own identity. */
export interface SendContext {
    readonly item: ItemRef;
    readonly writer: WriteVerbs;
    readonly reader: ReadBack;
    readonly allowance: Allowance | undefined;
    /** Is a comment the one THIS CALL would be? Authorship and marker, both required (D125). */
    isMine(body: string): (comment: CommentFact) => boolean;
}
```

`CallOf<K>` is the member of `Call` a handler owns; each module exports its call type and the union
in the vocabulary file lists them, one line per operation. The vocabulary file (`effects.ts`) keeps
`Call`, `JournaledCall`, `Plan`, `EffectOutcome` and the codes; the four functions over them —
`operationOf`, `serializeCall`, `parseJournaledCall`, `planFor` — are generic walks over the
registry, in `apply/operations/index.ts`. In the applier, `send` and `confirm` are one-line
dispatches; the choreography around them — `sendCall`, `readBack`, the standing gate and the fresh
gate — answers the fold's five states, which `actionFor` reads as a table (D161, D172).

**Payload compatibility is absolute.** A `sent` fact's payload is the serialized call:
`serializeCall` writes `{capability, item}` then the handler's fields, so insertion order — and
therefore bytes — is what it was. Every payload an armed sandbox has already written parses: a
handler may ADD a verb, and may never rename a verb, rename or reorder a field, or change what
`parse` refuses. The proof is the per-verb pins of the literal payload strings in
`packages/runtime/test/shell/effects.test.ts`, which are unchanged.

## 4. Adapter — the request table and the shapes

**The request table** (`writes/requests.ts`). One row per verb of `WriteVerbs`, typed
`{ readonly [V in keyof WriteVerbs]: (repository, ...own) => BuiltWrite }`, so a verb added to the
seam with no row fails to compile there. A row builds the `GitHubWriteRequest` and says what its 404
means (`NotFoundMeaning`, the one thing only this layer knows). `writeVerbsOf` composes the whole
surface from the table with one cast: each verb's own arguments precede its allowance, so the
builder's arity splits them. The send-and-classify mechanism stays one function in `writes.ts`.

**The shapes** (`client/endpoints.ts`). One `EndpointShape` per confirmed endpoint: method and path
tail, the grant it needs, whether it carries a `body`, the `lane` it sends on, and the keys its
landing stales (D176). The admission gate matches a built URL against the shapes in one walk and
reads the body rule off the match; the client reads the lane. The matcher and the builder stay two
spellings in two files — the D129 rule that a gate must not trust the builder's string is kept —
and `permission.test.ts` holds them to each other: every row is admitted as the shape of its own
name, carries a body exactly where the shape says, and the shape's grant is the operation's
permission (D62).

The vocabulary the rows return in — `WriteResult` and `WriteVerbs`, with the read-back's
`ReadBack`, `ReadBackOutcome`, `Presence`, `CommentFact` and `ItemFacts` — lives in
`packages/core/src/seams.ts`; the shell and the adapter name one definition. `assign` has its own
verb, row and shape (6.16); `unassign` has none of its own and sends through `releaseAssignment`'s,
because a second shape for the same method and path would make the admission walk ambiguous. A
landed `unassign` counts as the App's own release wherever the ordering read asks (D159).

An act's notice rides the act: `planWithNotice` plans the act, then the notice — a graced act's
from its grace, an `assign` or `unassign`'s from its `desired.notice` — so the plan's stop at the
first unproven call is what keeps a notice from announcing an act that did not land.

The read-back stays whole: its split per operation is pending (§6).

## 5. What the compiler proves, per layer

The proof each layer's registry owes: add a scratch key to `IntentCatalogue` and confirm that the
core registry fails to compile; add a scratch shell handler without a registry line and confirm the
shell registry fails; add a scratch verb to `WriteVerbs` and confirm the request table fails. Each
error must land on the registry object, not on a downstream use. Then delete the scratch.

## 6. Declined, with triggers

- **A shared cross-layer operation type** (one file describing all three layers): declined — it
  would be a module importing its same-named siblings across packages, which §1 forbids. Reopen never.
- **Deriving `Call` and `WriteEndpoint` from the registries** rather than writing the unions:
  declined — the union line is one edit per operation and reads as the closed vocabulary it is;
  derivation trades that for a type-level puzzle. Reopen if the unions pass a dozen members.
- **One transport file per operation** (D136): reversed by D210 — a transport was twenty lines
  building one URL, and the shape table already listed the endpoint; the row is the spelling now.
- **Splitting the read-back per operation**: deferred to the real unassign; its trigger, an assignee
  read, has fired. The real unassign landed reading the same `assignees` read the release already
  had, so no third resource arrived with it; the split is still pending.
- **Storing the operation in the `sent` fact**: declined — the operation follows from the fact's
  `verb` through the handler's `verbs`, and a stored copy could disagree with it.

## 7. The five rules the engine cannot judge

`decide()` judges one request, so five write rules fall outside it — requirements on the executor
and the adapter rather than on a verdict. They were the ground-rules table of the retired
`effects.md`; each is now stated where it is enforced, and this table is the list so that none of
them goes missing between pages. `design/contracts/safety.md` §5 points here for them.

| Rule | Requirement | Stated in |
|---|---|---|
| Name the change | The exact item and value the write changes | §2 — `describeChange`, whose wording `design/contracts/safety.md` fixes and the slice parity test pins |
| Verify | Read the state back and confirm the postcondition | §3 — `confirm`; §4 — the read-back |
| Reconcile | Record an unclear outcome and never retry blind | the `unknown` outcome in `design/trace.md`; the two retry layers — the one in-client attempt in `packages/runtime/src/adapter/client/http.ts` and core's durable `retryAdvice` — which stop on a permanent failure |
| Tested reversal | Every operation has a tested disablement, repair and rollback path before it runs against a repository | the sandbox and pilot rings in `CONTRIBUTING.md` |
| Dry-run first | An operation appears in a new environment's dry-run before any active run performs it | the mode ladder in `design/contracts/config-schema.md`; step 9 of `design/trace.md` |

Three consequences worth stating once, because no single layer owns them: the adapter removes only
the values it manages and never every value under a prefix (`design/contracts/safety.md` §3), a
destructive act reaches a repository only through the warning-and-grace path of
`design/guides/grace.md`, and the platform recognises its own assignment writes by its ledger
rather than by an event's actor, because GitHub attributes an `unassigned` event to the assignee
whoever made it (D159).
