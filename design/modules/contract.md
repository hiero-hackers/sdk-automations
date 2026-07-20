# The Module Contract: the Core Handle, Typed

> **Drafted — the exit from design into code (roadmap Track C1).** This is the core's public API as
> modules see it, written *against* the six core docs; the type signatures are deliberately the
> forcing function, and where a signature was hard to write, the exposed ambiguity is named in §5.
> It also explains how the serializer handles repeated work and restarts (`design/architecture.md` §10,
> this document §3). TypeScript is illustrative-but-binding: shapes are the contract, identifier spelling is
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
  expect: ObservedState;   // what the module saw; the core checks it again before writing (§3)
  cause: DatedFact;        // the dated fact justifying it — the newer-fact rule's input
  effects?: { assign?: Login; unassign?: Login };   // requested assignee state; GitHub calls are separate (A3)
}
```

An undeclared resolver or edge is a **compile error** (the generic bounds); the registry re-checks at
runtime as the boundary backstop (`design/architecture.md` §3, §5). `cause` is *required*: making the
newer-fact rule (`design/core/manual-edits.md` §4) a field, not a convention — a request that cannot
name its dated fact cannot be expressed.

## 3. TransitionResult — what happened to a request

```ts
type TransitionResult =
  | { outcome: 'applied' }                       // calls succeeded and every requested change was verified
  | { outcome: 'already' }                       // every requested change was already present
  | { outcome: 'unknown'; reason:
        'postcondition-unreadable'                // the app could not read enough state to check the result
      | 'partial-effect' }                        // some calls worked, but the app cannot yet finish safely
  | { outcome: 'deferred'; until: Iso8601 }      // destructive: safety warned, grace running
  | { outcome: 'refused'; reason:
        'stale'         // expect ≠ current state — re-observe and retry if still warranted
      | 'older-fact'    // cause predates the human's edit (newer-fact rule)
      | 'blocked'       // overlay present — absolute (manual-edits.md §3)
      | 'illegal' };    // edge not legal from current position — a contract bug, telemetry only
```

Only one app process may be active. Its per-item serializer handles one request at a time. Before writing,
the core reads the item again and checks `expect`. The first valid request may return `applied`. A later
request for the same state returns `already`; a conflicting request based on old state returns
`refused: stale`. A webhook caused by the app's own write also returns `already`.

This rule works inside one process only. Two processes can both check the same old state before either write
is visible. D18 therefore requires deployments to stop the old process before starting a new one. If the app
must run several processes, it will need shared coordination and D1 must be reviewed again.

`effects` describes all labels and assignees that should be present when a transition is done. It does not
make several GitHub calls atomic. A multi-call transition must list its calls in order and explain how to
recognize and finish the state left after each call (`design/architecture.md` §4). The core returns `applied`
only after it reads the complete requested state. It returns `already` when that state was present before it
wrote, or when a lost response is followed by a read that shows the change. It returns `unknown` when it
cannot check or safely finish the result. Modules do not retry `unknown`; a later observation or sweep reads
the item again.

The single-assignee assign and unassign plans are in `design/architecture.md` §4. Restart recovery needs two
matching sources: a saved pending record identifies the transition and `cause`, and App-authored issue events
show which calls worked. A similar state made by a human does not count, so the manual-edit rules still apply
and Q5 remains open.

For `deferred`, no module keeps a timer. A later sweep checks the condition again. After the grace period, the
core can make the requested change.

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
