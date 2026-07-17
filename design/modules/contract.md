# The Module Contract: the Core Handle, Typed

> **Drafted — the exit from design into code (roadmap Track C1).** This is the core's public API as
> modules see it, written *against* the six core docs; the type signatures are deliberately the
> forcing function, and where a signature was hard to write, the exposed ambiguity is named in §5.
> Also fixes the **one-winner serializer/idempotency semantics** `design/architecture.md` §10 left
> open (§3). TypeScript is illustrative-but-binding: shapes are the contract, identifier spelling is
> refined at build.

## 1. The declaration — five fields answering the four tangles

```ts
interface ModuleDeclaration {
  name: ModuleName;
  config: ConfigSchema;                 // the slice it reads (E) — the registry projects exactly this
  consumes: readonly Position[];        // states observed (A)
  transitions: readonly Edge[];         // every edge it may request (A)
  resolvers: readonly ResolverName[];   // every shared question, incl. cross-entity reads (B, C)
  triggers: readonly Trigger[];         // events that wake it — its deployment identity (D)
}

type Entity = 'issue' | 'pr';
type IssuePosition = 'awaiting triage' | 'ready for dev' | 'in progress';
type PrPosition = 'needs review' | 'needs revision' | 'ready to merge';
type Position = IssuePosition | PrPosition;          // 'blocked' is an overlay, never a position
type Edge = { from: Position | 'none'; to: Position };  // 'none' = positionless entry (intake)
```

`consumes` and `triggers` are distinct on purpose: intake is woken by *events* (issue opened) and
consumes no prior position; inactivity consumes positions and is woken only by the sweep. The split
fell out of typing the catalogue (`design/modules/README.md` §2) — see §5.

## 2. The handle — typed by the declaration

```ts
interface Core<D extends ModuleDeclaration> {
  resolve<Q extends D['resolvers'][number]>(q: Q, ...args: ArgsOf<Q>): Promise<AnswerOf<Q>>;
  request(t: TransitionRequest<D['transitions'][number]>): Promise<TransitionResult>;
  project(p: ModuleProjectionContent): Promise<void>;   // content only — the core owns the marker,
}                                                       // rendering, and write (projections.md §2)

interface TransitionRequest<E extends Edge> {
  item: ItemRef;
  edge: E;
  expect: ObservedState;   // what the module saw — the compare-and-set token (§3)
  cause: DatedFact;        // the dated fact justifying it — the newer-fact rule's input
  effects?: { assign?: Login; unassign?: Login };   // coupled facts move in the same transition (A3)
}
```

An undeclared resolver or edge is a **compile error** (the generic bounds); the registry re-checks at
runtime as the boundary backstop (`design/architecture.md` §3, §5). `cause` is *required*: making the
newer-fact rule (`design/core/manual-edits.md` §4) a field, not a convention — a request that cannot
name its dated fact cannot be expressed.

## 3. TransitionResult — the one-winner semantics, executable

```ts
type TransitionResult =
  | { outcome: 'applied' }                       // this request won; labels + effects written
  | { outcome: 'already' }                       // target was current — idempotent success
  | { outcome: 'deferred'; until: Iso8601 }      // destructive: safety warned, grace running
  | { outcome: 'refused'; reason:
        'stale'         // expect ≠ current state — re-observe and retry if still warranted
      | 'older-fact'    // cause predates the human's edit (newer-fact rule)
      | 'blocked'       // overlay present — absolute (manual-edits.md §3)
      | 'illegal' };    // edge not legal from current position — a contract bug, telemetry only
```

The **one-winner invariant**, stated precisely (this closes `design/architecture.md` §10's open
item): the shell's per-item serializer totally orders requests per item; each is validated against
current observed state inside its turn, compare-and-set style via `expect`. For N concurrent
conflicting requests: **exactly one** returns `applied`; others return `already` (same target) or
`refused: stale` (different target). The app's own write, echoing back later as a webhook, resolves
to `already`. `deferred` is how safety composes: the sweep re-derives the condition next pass and
re-requests; after the grace elapses the same request returns `applied` — no module tracks timers.

## 4. The module runtime, and the fake core for free

```ts
interface Module<D extends ModuleDeclaration> {
  declare: D;
  handle(obs: Observation, core: Core<D>, config: ConfigOf<D>): Promise<void>;
}
// Observation = item snapshot + trigger (event | sweep), coherence already classified —
// quarantined (class 4) and blocked items are never dispatched (manual-edits.md §3).
```

The **fake core** (`design/testing/README.md`) is an in-memory `Core` implementation over a label
set plus the transition table — it falls straight out of these interfaces, and the toggle matrix and
incoherence-injection tests run real modules against it with no GitHub anywhere.

## 5. What typing this exposed (the vagueness register)

1. **`consumes` vs `triggers` had been one concept** in prose; intake forced the split (§1).
2. **A3 coupling needed a home**: assignee changes ride the request as `effects`, so "assignee and
   status move in one transition" is a field, not a discipline. Whether `effects` admits anything
   beyond assign/unassign is deliberately closed — it doesn't, until a tangle-A fact proves it must.
3. **`deferred` settles who re-requests after a safety grace**: nobody — sweep re-derivation is the
   retry, which is why clock-triggered modules must be sweep-triggered, now visible in `triggers`.
4. **`cause` as a required field** turned the newer-fact rule from reviewable convention into
   unwritable-without-it API — the strongest enforcement available.
5. One projection budget question surfaced: a module gets **one content projection per item**
   (proposed — matches projections.md's one-per-kind rule); a module wanting two comments on one
   item is redesigning its content, not calling twice.

## 6. Fitness for unknown modules

The module set is deliberately undecided (`design/modules/README.md` header) — so how do we know
this contract, and the core behind it, will hold for services nobody has named yet? Not by
speculative generality; by three arguments that can be checked today:

**The core models the domain, not the catalogue.** Every core operation is a fact about the
collaboration workflow that exists with zero automation — positions, links, eligibility, actor
identity, whose turn it is. Services come and go; the facts don't. The acceptance test
(`design/architecture.md` §4) enforces it: any operation describable only by naming a module is a
service leaking into the core, and flexibility dies exactly there.

**The zero-module system is already complete.** With no modules installed, maintainers drive both
state machines by hand and the core still does close hygiene, coherence, and narration. Since every
module must be a motion sensor on a state that has a manual switch (`design/architecture.md` §7),
any future service can only automate an entry point the manual system already expresses. A proposed
service needing something the manual workflow *cannot* express is not a missing core API — it is a
**domain change**, entering by the defined additive path: new state → the taxonomy's earn-its-place
test (§8); new shared question → a resolver; new comment kind → a projection; new destructive
action → a safety row. The five declaration fields never change.

**The conformance dry-run** — paper-fit candidate services against §1 before believing anything.
Three from the audit's not-yet-adopted rows: office-hours reminders and AI-review triggers fit
trivially (events in, projections out, no state — anything comment-only always fits); mentor
rotation fits with its roster as its config slice; and the **spam list** finds the instructive
wrinkle — in Python it *gated* `/assign`, one service influencing another. The answer generalises:
**when two services must share a fact, the fact is promoted into the core as a resolver** (here, a
clause of `mayPerform`), and the services stay strangers. That promotion is the designed growth
mechanism, not a workaround.

Where flexibility genuinely ends — three known edges, each with a priced reopening path: a service
needing **cross-item aggregate state** (a strictly ordered queue) strains GitHub-as-database — the
§4.1 overturn clause puts an owned store behind the core, changing no module; a service needing
**write scopes beyond the three** (auto-merge) is rejected by the permission promise, consciously;
a service needing **sub-minute latency guarantees** fights safe-to-be-down
(`design/operations/README.md` §1) and would reopen that decision. A candidate hitting one of these
is a named trade-off, not a core failure.
