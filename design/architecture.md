# Solution: Architecture Hypothesis (draft, co-authored)

> A draft, meant to be developed further — not a finished specification. This is the second revision;
> it supersedes the first hypothesis draft, which is preserved in git history. Where a decision is
> still open, the text says so (§10), and where the design takes a position early it is marked
> **proposed**, with the reasoning and with what would overturn it. This is the central design document
> the component docs point toward (the repo `README.md` gives the reading order):
> `design/modules/README.md` (the module catalogue), `design/testing/README.md` (the tests),
> `design/core/manual-edits.md` (the manual-edit semantics), `design/operations/README.md` (hosting, rollout,
> rate limits, failure loudness), `design/core/taxonomy.md` and
> `design/config/schema.md` (the drafts awaiting ratification). Vision and hard limits:
> `planning/goals.md`. The coupling this design avoids: `planning/lessons-learned.md` (classes A–E)
> and `audit/deep-dive-cpp.md` §3. Left for later, on purpose: which services get built and the build
> order. This document is about the system that holds the services, not the services themselves.

## 1. The problem, and the idea in one picture

Today the automation services are tangled together — not because the code is messy, but because the
services *share* things. The audit found four distinct kinds of sharing (`audit/deep-dive-cpp.md` §3):

- **Status labels as a baton.** `status: ready for dev` is produced by one service, consumed by another,
  reset by a third — moving state that no single service owns, so none can be switched off alone.
- **The issue↔PR link followed two different ways** (a precise query vs body-text scanning), which can
  disagree about what is linked to what.
- **Rendered text and exact names as interfaces.** One service searches another's comment for an exact
  phrase; two workflows connect only through a name string. Change the wording or the name and nothing
  reports an error — the behaviour just quietly stops.
- **Unrelated features bundled** into one workflow file, one permissions block, one hidden queue — so
  turning one off is a code edit, not a setting.

The answer is one shared thing in the middle: a **core** that owns everything services would otherwise
pass between themselves, behind one door to GitHub — plus one sentence that holds the design together:

> **The app is a stateless reducer over GitHub's state:** `(GitHub state, event, config) → transitions`.
> The app itself stores nothing.

```mermaid
flowchart TB
    MAINT[["maintainer — labels by hand<br/>(the non-module way in)"]]
    GH[("GitHub — the database<br/>labels = status · comments = projections · timestamps = clocks")]
    MAINT --> GH

    subgraph APP["hosted app · one install · issues:write · pull-requests:write · contents:read"]
        direction TB
        subgraph SHELL["shell"]
            WH["webhook intake<br/>(push)"]
            SW["reconciliation sweeper<br/>(pull, scheduled)"]
            SER["per-item serializer — keyed queue, one worker per issue/PR"]
            WH --> SER
            SW --> SER
        end
        REG["registry — validate config (_extends) · project per-module slices · activate declared modules"]
        MODS["modules (opt-in) — intake · assignment · inactivity · pr-quality · …<br/>each declares: config slice · states in/out · resolvers · cross-entity reads"]
        subgraph CORE["core — domain vocabulary only, no service-shaped methods"]
            direction LR
            SM["state machine<br/>labels are the truth<br/>idempotent transitions"]
            RES["resolvers<br/>linkedIssues · eligibleLevel<br/>isBot · mayPerform"]
            SAFE["safety<br/>grace periods<br/>per-item cooldowns"]
            PROJ["projections<br/>single-writer comments<br/>never an input"]
        end
        ADP["GitHub adapter — the one door"]
        SER --> REG --> MODS -->|request transitions · read state| CORE --> ADP
    end

    GH -->|events + observed state| SHELL
    ADP -->|guarded writes| GH
```

Each tangle is answered structurally below: the baton by §4's single-writer state machine, the two-way
link by §4's resolvers, the text-and-names interfaces by §4's projections, and the bundling by §5's
deployment identity.

## 2. The shell

Work arrives two ways and is serialised once:

- **Webhook intake** — GitHub pushes an event; the shell authenticates the installation.
- **Reconciliation sweeper** — scheduled reads of current state, fed through the same path as events.
  Webhooks are not guaranteed delivered, and §7's rule means states can be entered with no event at all —
  so modules react to **state observed, not events assumed**, and a missed webhook heals on the next
  sweep. (The inactivity service already works this way; the pattern is promoted from one service's trick
  to a first-class delivery mechanism.)
- **Per-item serializer** — one worker per issue or PR. The audit removed the accidental mutex (the shared
  concurrency groups, lessons D2); this is its deliberate replacement. GitHub's API has no
  compare-and-swap on labels, so races are prevented here and absorbed by idempotent transitions (§4).

## 3. Config and registry

The registry resolves `.github/hiero-automation.json` (+ `_extends` org defaults), validates it **at
runtime** (the file comes from repositories we do not control), and activates only the declared modules. A
repository with no config runs on safe defaults — nothing destructive on. Each module receives a
**projection** of the config: only its declared keys, *cannot see* the rest. That closes the shared-file
coupling (lessons E1) at runtime, while the contract types (§5) close it at compile time.

## 4. The core

One rule governs all four parts: **the core speaks domain vocabulary, never service vocabulary.**
Acceptance test: every public core operation must be describable without naming any module. The moment the
core grows a `markReadyForAssignment()`, the coupling this design removes has moved inside the core and
been sanctioned there.

One observation's life through the core, including the external feedback through GitHub:

```mermaid
sequenceDiagram
    participant GH as GitHub
    participant SH as shell
    participant A as adapter
    participant C as core
    participant M as module
    alt subscribed webhook arrives
        GH->>SH: webhook
    else scheduled reconciliation starts
        SH->>SH: begin sweep
    end
    SH->>SH: verify webhook if present, then enqueue item
    SH->>C: begin observation
    C->>A: read current facts
    A->>GH: narrow API reads
    GH-->>A: current observable state
    A-->>C: normalized facts
    C->>C: classify coherence
    C->>M: observation + config slice
    M->>C: request domain transition
    C->>C: authorize, guard, and apply safety
    C->>A: approved narrow effect
    A->>GH: GitHub API write
    Note over GH,M: first processing pass ends at GitHub
    alt subscribed webhook echoes the write
        GH->>SH: new external observation
    else echo is absent or missed
        SH->>SH: later sweep observes the item
    end
    SH->>SH: verify webhook if present, then enqueue item
    SH->>C: begin a new observation
    C->>A: reload current facts
    A->>GH: observable postcondition read
    GH-->>A: target already satisfied
    A-->>C: normalized facts
    C->>C: classify coherence
    C->>M: observation + config slice
    M->>C: request same desired transition
    C-->>M: already — idempotent no-op
```

The arrows to and from the adapter are not a recursive call cycle between components. Each processing
pass ends at GitHub; an app-authored webhook is a new external observation that re-enters the same path.
Recognising the app's actor can suppress irrelevant policy work, but correctness comes from reloading
current state and guarding the postcondition. Convergence does not depend on the echo arriving because a
later sweep performs the same observation.

The adapter is the transport boundary for both GitHub reads and writes: API versions, pagination, rate
limits, retry classification, narrow mutations, and conversion between API data and normalized facts stay
there. The diagram shows the core-side read boundary without deciding whether a snapshot builder or
individual core resolvers invoke those reads.
If a write response is lost, its result is unknown: the adapter reads the operation's observable
postcondition before any retry. A satisfied target converges to `already`; otherwise the operation is
retried only when repeating that particular mutation is safe. Several GitHub calls are not one atomic
transition. Recovery or compensation for partially applied effects remains open; those scenarios test
whether the proposed stateless design is sufficient.

Human projections are a separate optional effect. The core renders structured content under a stable
projection identity and publishes it through the same adapter; identical content produces no write. A
webhook echo from that publication is still only an observation and must neither request a domain
transition nor create another copy of the projection.

| Part | Owns | The rule that keeps it safe |
|---|---|---|
| **state machine** | states + legal transitions (one machine per entity, `design/core/taxonomy.md` §2), defined independently of installed modules | single `status:` writer; idempotent guarded transitions; coupled facts (assignee + status) move in one transition (lessons A1, A3); close hygiene strips an item's own position on close — never across the link |
| **resolvers** | `linkedIssues(pr)` · `eligibleLevel(user)` · `isBot(actor)` · `mayPerform(actor, action)` | one mechanism per question (B2) — authorization included, or two modules will answer it differently |
| **safety** | grace periods, reversibility, **per-item cooldowns** | generalises the inactivity service's proven warn-then-act pattern; timers *derived* from GitHub timestamps in sweeps, never owned |
| **projections** | every comment the app writes | rendered *from* state, **never read as input** (A2); any comment-borne metadata is core-private and schema-versioned |

### 4.1 Where state lives *(proposed)*

**GitHub is the database.** Labels are the status store — the core is the app-side exclusive writer, and a
hand-applied label is ingested as a legitimate transition, which is §7's rule working natively with no
synchronisation machinery. Comments are projections. Timestamps are the safety engine's clocks. The app is
stateless per event: trivial hosting, crash-safe, state auditable in GitHub's own UI, and the test fake
for the core is an in-memory label set. The honest costs: label writes are not transactional (mitigated by
§2's serializer plus idempotency), and any datum that fits no label rides in core-private comment metadata
or derives from timestamps. **Overturned by:** a concrete invariant that provably needs an owned store —
which would then live *behind* the core's interface, changing no module.

This answers the first draft's open question "labels the core manages, or state a label only reflects":
that question was really *does the app have a database*, and the proposal is no.

## 5. What counts as a module

One unit, on or off, talks only to the core. Its contract declares four things — one per tangle in §1:

| Declares | Answers | Enforced by |
|---|---|---|
| the config slice it reads | shared config (E) | contract types (compile time) + registry projection (runtime) |
| states consumed / transitions requested | the label baton (A) | the core is the only `status:` writer |
| cross-entity reads | the two-way link, baked-in writes (B, C) | one core resolver per question |
| its own trigger, permissions, queue | bundling (D) | deployment identity; only the shell's *item*-scoped queue is shared |

In TypeScript the contract is a value the type system enforces: the registry hands each module a core
handle *typed by its declaration* — an undeclared transition is a compile error — and the runtime
projection (§3) backs the same rule at the boundary. The contract's exact form is drafted in
`design/modules/contract.md`; it is what every test layer in `design/testing/README.md` mocks against.

## 6. The config file, sketched

Shape now, keys later (§10):

```jsonc
// .github/hiero-automation.json — illustrative shape only
{
  "_extends": "org-repo",           // org defaults, repo overrides win
  "modules": {
    "assignment": { "maxOpenAssignments": 2 },   // presence = enabled
    "inactivity": { "issue": { "warnAfterDays": 7, "unassignAfterDays": 21 } }
    // absent module = off · no file at all = safe defaults · keys: design/config/schema.md
  }
}
```

A module's block is the whole config that module can see (§3), and safe defaults switch on nothing
destructive.

## 7. Turning a module on and off

**Every state a module consumes can also be set another way** — a hand-applied label, a config default, a
command. An upstream module is only ever a shortcut, never the only way in: the light has both a switch
and a motion sensor, and removing the sensor leaves the switch working. (The state graph with the manual
entry point drawn is `design/modules/README.md` §3; the exact semantics of manual edits — the coherence
classes, the never-revert rule, the newer-fact rule — are `design/core/manual-edits.md`.) Two corollaries,
made explicit:

- Because states enter out-of-band, modules react to **state observed, not events assumed** — the sweeper
  (§2) is architecture, not optimisation.
- The rule is a CI gate, not philosophy: for every state in any module's contract, the toggle matrix must
  contain a passing case where that state is produced *manually* and the consuming module still functions.

## 8. Why labels stay minimal

Every label is a potential baton — and under §4.1, also a row in the database. The core owns the full set;
no module invents one; bulk `status:*` prefix-strips are impossible by construction (A1); and a proposed
new label must beat the alternative of the core *deriving* the fact from assignees, timestamps, or links
without storing it at all. The taxonomy itself waits for its own decision (§10).

## 9. How it is tested

The design in `design/testing/README.md` stands, with three additions this architecture makes cheap
or necessary: the **fake core is an in-memory label set** plus the transition table (§4.1); two invariants
become near-tautological and are asserted anyway — *no state outside GitHub*, *no write outside the
adapter*; and one is new and load-bearing — **concurrent conflicting transitions resolve to exactly one
winner**, the executable form of §2 plus §4's idempotency, and the regression test for removing the
accidental mutex. The manual-edit semantics add their own invariants and an incoherence-injection axis to
the toggle matrix (`design/core/manual-edits.md` §6).

## 10. What we still need to decide

```mermaid
flowchart LR
    T["taxonomy + state machine<br/>(gates everything)"] --> ST["state store —<br/>ratify §4.1"]
    T --> MVP["MVP module set<br/>+ boundaries"]
    ST --> CONC["serializer + idempotency<br/>semantics (§2, §9)"]
    ST --> SAFEQ["safety specifics<br/>(grace · reversal · cooldown)"]
    MVP --> KNOBS["policy knobs reconciled<br/>across the SDKs"]
    KNOBS --> SCHEMA["config schema (§6)"]
    T --> SCHEMA
```

- We need the label taxonomy and the state machines ratified first — drafted in `design/core/taxonomy.md`;
  nothing downstream starts before it.
- We need to ratify (or refute) §4.1: is GitHub the database? If we can name an invariant that provably
  needs an owned store, the store enters behind the core's interface and no module changes.
- We need the manual-edit semantics ratified — what the core does when a hand-applied label conflicts
  with the state machine. Drafted as `design/core/manual-edits.md`: humans edit state (any position, from
  any position, never reverted), modules request transitions (edge-bound); incoherent observations get
  five defined classes; plus the newer-fact rule that stops a sweep re-derivation from fighting a
  human's edit.
- The module contract (§5) is drafted as `design/modules/contract.md` — five typed declaration
  fields, a required `cause` enforcing the newer-fact rule, `effects` carrying the A3 coupling.
- The serializer and idempotency semantics are written down as the one-winner invariant in
  `design/modules/contract.md` §3 — exactly one `applied` per conflicting set, compare-and-set via
  `expect`, the app's own echo resolving to `already`.
- The full register of proposed decisions and open questions is `design/decisions.md` — the
  ratification memo's skeleton.
- We need the MVP module set, then the policy knobs reconciled across the SDK bots, then the schema keys.
- We need the safety specifics per destructive action ratified — drafted as `design/core/safety.md`:
  three destructive actions, warn-then-act mandatory for clock-triggered ones, every warning names its
  exits, every action reverses in one gesture.
- The operations questions — who hosts, rollout rings, config-error surfacing, and the rate-limit
  arithmetic — are drafted in `design/operations/README.md`. The one correction it makes here: the budget
  is **per-organisation**, not per-repo (one installation covers every org repo), enforced entirely
  at the adapter, with sweep cadence derived from fleet arithmetic rather than configured. Its §7
  lists the shape-changes it forces on this document's §2 and §4.

Reworking the existing C++ and Python bots into modules on this core is build-phase work, recorded here so
the cost stays on the record.
