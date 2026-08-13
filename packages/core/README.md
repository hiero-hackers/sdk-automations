# automation-core (pure logic)

The decision engine of the platform: everything between a webhook payload
and a verdict, with no I/O anywhere — `pnpm test` runs the whole thing in
seconds, and a real captured GitHub delivery travels payload → report inside
a unit test (`test/slice.test.ts`).

**The front door is one verb.** A shell hands `decide()` a delivery, the
parsed configuration, the enabled capabilities, and the few facts core
cannot know (the clock, the kill switch, the installation's grants, human
edit ordering); it gets back a `Report` and the approved intents. Everything
else in this package is what that verb composes:

```mermaid
flowchart LR
    D["delivery"] --> N["engine/events.ts
normalize"]
    N --> P["workflow/project.ts
labels → position"]
    P --> E["capability evaluate
(via its view + handle)"]
    E --> S["capability/intent.ts
screens"]
    S --> W["safety/world.ts
derive the world"]
    W --> G["safety rules + gates"]
    G --> R["report/ findings"]
    G --> A["approved intents
(not executed by the runnable shell)"]
```

| Directory | The question it answers | Files |
|---|---|---|
| `src/engine/` | What does the platform DO with a delivery? | `decide.ts` (the verb), `events.ts` (webhook payload → observation), `invoke.ts` (how a capability is called, type erased) — and its own [README](src/engine/README.md) |
| `src/config/` | What did this repository ask for? | `schema.ts`, `sections.ts`, `parse.ts`, `document.ts` (YAML in), `labels.ts` (label ↔ meaning, both directions) — and its own [README](src/config/README.md) with the path a file takes |
| `src/workflow/` | What states exist, and how do they move? | `positions.ts` (derived from config), `causes.ts`, `state.ts`, `transitions.ts` (the tables and the legality question), `reference.ts` (the executable spec), `project.ts` — and its own [README](src/workflow/README.md) |
| `src/capability/` | What may a capability declare and do? | `declaration.ts`, `catalogue.ts` (the closed vocabularies — and the add-an-operation checklist), `boundary.ts` (how it is called), `intent.ts` (what it asks, and the screens), `factory.ts` (how one is built without ceremony) |
| `src/safety/` | May this write happen? | `write.ts` + `destructive.ts` (the two doors), `rules.ts` (the ordered rules both share), `world.ts` (the derived, unforgeable facts) — and its own [README](src/safety/README.md) |
| `src/github/` | Is this still true of GitHub? | `failures.ts`, `rate-limits.ts`, `ids.ts`, `signatures.ts` — and its own [README](src/github/README.md) with the provenance table |
| `src/report/` | What happened, and who must act? | `finding.ts` (the record), `convert.ts` (the one severity table) — and its own [README](src/report/README.md) |

Directories are named for the question a maintainer arrives with, not for a
technical kind. There is no `types/` or `utils/`: naming by kind forces you to
already know the answer in order to find it.

**Four stories, seven directories.** Read core as: *vocabulary* (catalogue +
meanings + the facts tables), *rules* (safety + the screens + the map),
*engine* (events + decide), *report* — with config as the input gate and
github as the observed-world annex. The stories are the reading; the
directories are where the files happen to live (D92 phase 5 records why the
two aren't forced to coincide).

## Reading path — 30 minutes to the whole machine

0. [`design/trace.md`](../../design/trace.md) — one REAL delivery followed from
   the shell's socket to the persisted report, introducing every term at the
   moment it acts. Start here if the glossary below feels like a wall.
1. [`src/capability/README.md`](src/capability/README.md) — what a capability
   is, and the walkthrough of writing one.
2. [`test/slice.test.ts`](test/slice.test.ts) — a real delivery, end to end,
   ~180 lines; the parity test at its bottom is `decide()`'s specification.
3. [`src/safety/rules.ts`](src/safety/rules.ts) — the ten rules as an ordered
   array; the order is contract and the tests assert it directly.

After those three, every other file is a detail of something you have
already seen working.

## Glossary — the fifteen words that are the learning curve

| Term | One line |
|---|---|
| **observation** | A normalized fact about a repository item, from the catalogue — never a raw payload. |
| **meaning** | A platform position word (`awaitingTriage`, `ready`, …); repositories map their own labels onto these. |
| **mapping** | The reviewed label ↔ meaning table; the only bridge between a repository's words and the platform's. |
| **position** | The single meaning an item occupies in its flow — or `null`, or a conflict. |
| **projection** | The observed label set turned into a position (or a conflict): `ObservationProjection`. |
| **blocked** | An orthogonal human-set pause flag — never a position, never capability-writable. |
| **capability** | A unit of automation: a declaration plus a pure `evaluate` that returns intents. |
| **declaration** | A capability's self-description — what it watches, asks, does, and needs. |
| **intent** | A desired outcome a capability requests; never an API call. |
| **occasion** | Where and when an intent arose (repository, item, observed time) — bound once by the factory. |
| **claim / expected** | The facts a capability believes hold (`ClaimedFacts`); checked by derivation, or at act time. |
| **world** | The derived, unforgeable safety facts (`DerivedWorld`) — what was observed, whether the claim holds. |
| **screen** | A runtime check on a returned intent (attribution, floors, the map) — enforcement, not ergonomics. |
| **verdict** | The safety engine's answer: apply, record-only, or a coded refusal. |
| **finding** | One record in a report: severity, machine code, prose, subject. `problems()` is the operator surface. |

## How the pieces connect

Two views, because they answer different questions.

**Who depends on whom** — what a maintainer needs when changing something.
Every arrow runs one way; `config/` is the root and imports nothing.

```mermaid
flowchart TB
    CAP["capability/<br/>declare, call, screen"]
    SAFE["safety/<br/>may this write happen"]
    WF["workflow/<br/>states and moves"]
    CFG["config/<br/>what the repository asked for"]
    GH["github/<br/>what we measured of GitHub"]
    CAP --> SAFE
    CAP --> WF
    CAP --> CFG
    SAFE --> CFG
    WF --> CFG
```

`github/` stands alone deliberately: nothing in core decides anything from it,
and it is the only directory whose contents can go stale without an edit.

**What actually happens to one event** — the current path a webhook takes.
Only the shaded decision steps live in `core/`; the shell owns transport and
the store owns persistence, which is why core can be pure.

```mermaid
flowchart LR
    W["webhook"] --> N["shell: normalize"]
    N --> O["observation"]
    O --> E["capability.evaluate()"]
    E --> I["intent[]"]
    I --> S["safety: verdict"]
    S --> R["report"]
    R --> C["shell/store: report + completion"]
    style E fill:#EEEDFE,stroke:#534AB7
    style S fill:#EEEDFE,stroke:#534AB7
    style O fill:#EEEDFE,stroke:#534AB7
```

Core decides; it never acts. `evaluate` returns requests, `safety` returns a
verdict, and the runnable shell rejects active mode rather than performing
approved intents. That keeps this package testable with no network.


The tests are the executable form of the design's own claims: the
transition matrix is exhaustive (every `(from, to, cause)` triple is either
a documented edge or rejected), destructive actions cannot fire without a
recorded warning and an elapsed grace period, and one config error yields
no configuration at all.

## Where a test lives

`test/` mirrors `src/`, and the mirror carries meaning rather than being
tidiness:

- **A test inside a subdirectory tests that subdirectory.**
  `test/github/failures.test.ts` covers `src/github/failures.ts`.
- **A test at the root spans modules, deliberately.** `invariants` and
  `properties` compose several modules. Neither belongs to one file, and
  the absence of a directory is how they say so. Tests about the
  REPOSITORY rather than about core — docs, examples, design drift,
  artifact invariants — live in the workspace's `checks/` package.

So the rule reads in both directions: if you add a per-module test, it goes
beside its module; if you cannot name the one module a test belongs to, it
belongs at the root.

The workspace's `checks/` package holds the invariants that are not about
behaviour at all — source files stay free of control characters, and every
module matches Stryker's mutate glob. Both exist because a regression got
through: a NUL-delimited key made `capability/intent.ts` a binary file to grep, and a
single-level `src/*.ts` glob silently stopped mutating three modules the day
they moved into `src/github/`. Neither broke a test, because neither changed
behaviour.

**The mutation break threshold is 90**, and the number is evidence rather than
taste: when the capability boundary had no tests in this package at all, the score was
89.27 — so 90 is the value that would have failed the build for the regression
that actually happened. It catches a module losing its coverage wholesale. It
does *not* catch a module half-losing it, which is the weaker guarantee and is
stated here rather than assumed. Today's score is 96.63.

A line-coverage floor sits beneath the mutation gate: `vitest run --coverage`
(`core`'s `test:coverage`) holds lines, branches, functions, and statements
at 80 against `src/**`, excluding the `src/index.ts` barrel, and reports
99.64% lines. It is a local floor, not a CI gate — only Stryker's break
threshold fails the build — and is stated here because a number a contributor
can re-run is the kind of evidence that stays honest.

## What the tests prove — and what they do not

The invariant tests prove the *decision logic* is coherent: given true
inputs, the rules compose the way the design says they should. They do not
prove the safety property itself. Two debts remain for any future write path:

- **Some inputs arrive by attestation.** `WriteContext` mixes facts the
  core compares itself (`latestHumanChangeAt` against the request's
  `causeObservedAt`; `capability` against the request's, since D53) with
  attestations it must trust (`preconditionHolds` — the precondition's
  shape is capability-specific, so the comparison cannot live in
  capability-agnostic code). A shell that supplies a wrong attestation
  gets a wrong verdict; adapter integration tests must own that boundary.
  D51 narrows this further: the shell must now distinguish "no human change" from
  "could not establish ordering", and reporting `null` for a failed
  lookup silently restores the unsafe behaviour.
- **Verdicts are advisory until the write lands.** A future write path must
  recheck immediately before the GitHub write to close the usual
  time-of-check/time-of-use window
  (safety.md rules 7–10: postcondition verification and unclear-outcome
  reconciliation), not more pure logic.

Green tests here mean the rules are consistent — not that the system is
safe. The 2026-07-30 audit is the evidence: 152 tests were green, the
safety sweep called itself exhaustive, and `evaluateWrite` would still
answer `apply` to a clock-triggered destructive request in an otherwise
permissive active context (D52). The sweep enumerated seven of its eight
input dimensions and the eighth was where the defect lived. Suites prove
what they enumerate; naming what they do NOT enumerate is the part that
has to be written down.

## Findings for the decision register

Coding the prose surfaced ambiguities; each is tagged `FINDING(...)` in the
source at the exact place the assumption was made, and each is recorded in
[`design/decisions.md`](../../design/decisions.md) §3 as a hypothesis with this
code as its evidence:

- `FINDING(taxonomy-blocked)` → **D28** — `blocked` is an orthogonal
  pause flag, not a workflow position.
- `FINDING(taxonomy-manual-entry)` → **D29** — manual entry is observed
  reality to reconcile, not a requestable transition.
- `FINDING(safety-grace-floor)` → **D30** — `MIN_GRACE_DAYS = 1`, so the
  floor question cannot be silently skipped.
- `FINDING(config-no-config-mode)` → **D31** — the no-config mode is
  `observe`, chosen over `disabled`.
- `FINDING(safety-human-tie)` → **D33** — the rule-5 comparison lives in
  core; exact-timestamp ties go to the human; the shell excludes the
  causing event.
- `FINDING(config-label-injectivity)` → **D34** — label mappings are
  fully injective: every meaning its own label.
- `FINDING(observe-*)` (three) → **D35** — other-flow meanings are
  ignored-and-reported, `blocked` alone is "no position, paused", closed
  items keep their positions unrepaired.
- `FINDING(config-fail-closed-granularity)` → **D38** — fail-closed is
  whole-file; the config report and PR-time validation are the shell's
  required mitigations.
- `FINDING(safety-killswitch-observations)` → **D39** — the kill switch
  stops observations too; the rest of the check order is reporting-only,
  frozen by the verdict-code tests.
- `FINDING(failures-prose-snapshot)` → **D40** — body regexes are dated
  snapshots; rot degrades into `forbiddenUnrecognized`; a periodic
  sandbox re-probe is the standing operator obligation.
- `FINDING(taxonomy-closure-reason)` → **D47** — closure is a recorded
  reason (`merged` / `closedByHuman` / `completedByLinkedMerge`)
  orthogonal to position, read from GitHub and never written as a label.
- `FINDING(taxonomy-approved-checks-broke)`, `(taxonomy-review-cause)`,
  `(taxonomy-approval-cause)` → **D48** — the missing
  `readyToMerge → needsRevision` edge, the `reviewRequestedChanges`
  cause, and `approvalInvalidated` replacing the trigger-named
  `newCommitsInvalidatedApproval`. All three found by reading the tables
  against `design/audit/`, not against the prose.
- `FINDING(taxonomy-reopen)` → **D49** — reopening clears the closure
  and moves no position; a merged pull request can never reopen.
- `FINDING(taxonomy-entity-scoped-causes)` → **D50** — issue and
  pull-request causes are separate types, so a cross-flow cause is a
  compile error rather than a runtime refusal.
- `FINDING(safety-ordering-unknown)` → **D51** — ordering evidence is
  three-valued; `"unknown"` is a conflict, not an absence of one.
- `FINDING(safety-destructive-entry-point)`, `(safety-killswitch-order)`
  → **D52** — `evaluateWrite` refuses `clockTriggeredDestructive`
  outright, so §3's gates cannot be skipped by calling the wrong
  function; the kill switch is reported first on that path too.
- `FINDING(safety-capability-link)` → **D53** — the context names the
  capability its enablement flag describes, and a mismatch refuses.
- `immediatePreventive` → **D54** — the class has no gate yet and is
  refused until its immediate-explanation and simple-reversal gate exists.
- `FINDING(config-label-case)` → **D55** — label uniqueness is folded
  for case and edge space, as GitHub folds it.
- `FINDING(config-null-mode)` → **D56** — an absent mode defaults; a
  present but empty one is an error.
- `FINDING(contract-intent-org-permissions)` → **D57** — an intent may
  require any grant its capability declares, org-scoped included.
- `FINDING(contract-retired-enforcement)` → **D58** — `get` is the
  fail-closed activation lookup; `describe` returns report-only metadata.
- `FINDING(observe-conflict-context)` → **D59** — a conflict verdict
  carries `blocked`, `closedBy`, and ignored cross-entity meanings, so a
  report retains the same diagnostic facts as an ordinary projection.
- `FINDING(safety-warning-binding)` → **D60** — a destructive warning is
  an immutable snapshot of the exact request it authorizes and cannot be
  reused across capabilities, items, changes, or causal observations.

## Keeping code and prose aligned

The tables and rules here are hand copies of their source documents, so
the working rule is: any edit to a document in the "source of truth"
column above must touch the matching module and its tests.

One of those copies is now checked automatically. `packages/checks/test/doc-drift.test.ts`
parses the state diagrams out of `design/core/taxonomy.md` and asserts
they match `ISSUE_EDGES`/`PR_EDGES` edge for edge, in both directions — a
missing edge and an extra edge are the same defect from either side. It
compares `(from, to)` pairs only, so arrow prose stays human-written and
causes stay covered by the exhaustive matrix; a cause added without a doc
edit still slips through, but a whole edge no longer can. Generating the
diagrams from the tables outright would close the rest and remains the
cheaper long-term option.

Every other table here is still unchecked, and drift is not hypothetical.
The register's D8 row cited five conflict classes that `manual-edits.md`
no longer contains (caught 2026-07-25, row now `replaced`), and D48 is
worse: an edge the audit shows Hiero automation performing today was
missing from the design document *and* the tables, so no comparison
between them could have found it. Consistency checks catch copies that
disagree; only the audit catches a spec that is wrong in both places.

The register rows carry the required next evidence; none of these choices
is ratified by the code alone.
