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
> The app owns no store outside GitHub. (Not quite "stores nothing": its two durable records — the
> safety warned-at and the command ack — ride as projection metadata *in* GitHub, a real recovery
> protocol designed in `design/core/projections.md` §3.)

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
  concurrency groups, lessons D2); this is its deliberate replacement. It orders work in the one running app
  process. It cannot coordinate two processes. GitHub cannot update a label only when an expected value still
  matches, so operations must prevent two app processes from handling the same item at once
  (`design/operations/README.md` §1). Repeated work in one process is safe because every transition checks the
  latest state and can do nothing when the requested change is already present (§4).

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

`expect` records the state that the module saw. The core reads the item again before it writes. If the state
has changed, the request is refused. GitHub never sees or checks `expect`.

The adapter makes each GitHub call separately. When it finishes, it reads the item again and checks every
requested label and assignee. The result is `applied` when the calls succeeded and the complete requested
state is present. It is `already` when that state was present before the first call, or when a response was
lost but a later read shows that the change happened. It is `unknown` when the app cannot read enough state
to be sure. A module never retries an `unknown` result itself.

These cases show what the design needs:

| Situation | What the app does | Design result |
|---|---|---|
| the same webhook arrives again | read the item; return `already` if the requested state is present | the app does not need to remember every webhook |
| webhooks arrive out of order | use the current state; return `stale` if `expect` no longer matches; use `older-fact` only when a human made a newer edit | webhook order does not decide the result, and D9 still applies only to human edits |
| GitHub applies a write but its response is lost | read the complete requested state; return `already` if it is present; repeat a call only when that call is safe to repeat | an API response does not by itself prove whether the requested change happened |
| the app crashes between the label and assignee calls | save the exact planned change before the first call; after restart, use that record and the issue timeline to find the last completed step | several GitHub calls are not one transaction, and knowing only that the App made a change is not enough |
| a second app process handles the same item | both processes may pass the same `expect` check; repeated writes toward the same state may be harmless, but conflicting writes have no single winner | only one process may be active; supporting several processes would require shared coordination and would reopen §4.1 |

A transition that needs several GitHub calls must list its starting state, stable ID, calls in order, state
after each call, final state, safe retries, and restart steps. Before the first call, the core saves a
`pending` record with the item, transition, `expect`, dated `cause`, requested state, and plan version. It then
reads the record back. A command stores this information in its command-ack comment. A timed destructive
action stores it in its safety-warning comment. These are the same two private records that the core already
reads (`design/core/projections.md` §3).

The record ID comes from the GitHub item and either the command comment ID or the timed safety fact. Replaying
the same work therefore finds the same record. If the core cannot read the saved record, it makes no other
change. After it confirms the complete requested state, it marks the record `completed` and keeps it as an
audit trail.

After a restart, the pending record tells the core which change was in progress and why. GitHub issue events
show which calls took effect. Before continuing, the core checks for a newer human edit, command, or timed
safety fact. If there is one, the old record is closed without making another change. If the app has nowhere
approved to save the record, or cannot safely identify and finish every partial state, that transition cannot
be built under D1.

Assignment and unassignment show how this works. The app adds the new position before removing the old one.
An interrupted update may briefly leave two positions, but it never leaves the item with no position. The
table covers one assignee. The behavior for `/unassign` when several people are assigned remains open.

| Transition | Starting state and reason | Calls in order | State after an interrupted call | What happens after restart |
|---|---|---|---|---|
| assign | open issue; `ready for dev`; no assignee; dated `/assign(login)` | confirm pending command record; add `login`; add `in progress`; remove `ready for dev`; mark completed | first `ready for dev` + `login`; then both positions + `login` | continue only when the pending record matches the App's issue events and there is no newer human edit or command |
| unassign the last assignee | open issue; `in progress`; only `login` is assigned; dated `/unassign` or reaping fact | confirm pending command or warning record; remove `login`; add `ready for dev`; remove `in progress`; mark completed | first `in progress` with no assignee; then both positions with no assignee | apply the same record, event, and newer-change checks before making the remaining calls |

GitHub issue events show the event type, actor, time, label or assignee, and the App that made the change. The
events show which calls worked. The pending record shows which transition those calls belonged to. If either
source cannot be read, the result is `unknown` and a later sweep tries the read again. The app never finishes
a partial update that it cannot match to a pending record. A human assignment on `ready for dev` therefore
remains class 2 and Q5 remains open.

Evidence checked on 20 July 2026: the current C++ automation at
[`a898153`](https://github.com/hiero-ledger/hiero-sdk-cpp/blob/a898153fa50b6ba99ba85d2be1afb16a9cf1602d/.github/scripts/commands/assign.js)
reads the issue again before assignment. It then makes separate calls for the assignee, comment, and labels.
Current Python
upstream at [`e8c9787`](https://github.com/hiero-ledger/hiero-sdk-python/blob/e8c97875c8cf7631bca71d4a24a78e07d58d094b/.github/scripts/bot-unassign-on-comment.js)
also makes separate assignee and comment calls. GitHub provides separate APIs for
[label](https://docs.github.com/en/rest/issues/labels) and
[assignee](https://docs.github.com/en/rest/issues/assignees) mutations, and warns that
[webhooks may arrive out of order](https://docs.github.com/en/webhooks/testing-and-troubleshooting-webhooks/troubleshooting-webhooks).
Its [issue-event schema](https://docs.github.com/en/rest/using-the-rest-api/issue-event-types) exposes the
actor, timestamp, label or assignee, and App attribution used by the recovery rows above.
Kubernetes Prow at
[`0633879`](https://github.com/kubernetes-sigs/prow/blob/0633879af8026d056e1a5dbe1e29f5a98f6acec3/pkg/plugins/label/label.go)
skips labels that are already present. It adds and removes the other labels with separate calls and reports
each failure. This is an example of checking current state and retrying safely, not of one atomic update.

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
stateless per event: state is visible in GitHub, a restarted app reads GitHub again, and the test fake is an
in-memory label set. Label and assignee changes are separate calls. A multi-call transition is safe only when
it follows the restart rules in §4. Data that does not fit in a label is stored in private comment metadata or
derived from timestamps. **Overturned by:** a required rule or transition that cannot be recovered this way
without an owned store. That store would sit behind the core interface, so modules would not change.

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
adapter*; and the serializer tests prove ordering within one process. The adapter tests fail after every step
listed in §4 and test responses whose result is unclear. A deployment test makes sure two app processes do
not overlap. The in-process fake cannot prove coordination across processes. The manual-edit semantics add their own
invariants and an incoherence-injection axis to the toggle matrix (`design/core/manual-edits.md` §6).

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
- The serializer and idempotency semantics are written down in `design/modules/contract.md` §3:
  `expect` checks the latest state inside the one running process, the core reads the complete requested state
  after writing, and `unknown` reports when it cannot tell what happened. A saved pending record connects an
  interrupted assign or unassign operation to its GitHub issue events. Coordinating several app processes
  would need shared durable state.
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
