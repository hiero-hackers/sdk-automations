# One label, start to finish

> The trace. A pull request is opened, `triageQueue` wants the `awaitingTriage` label on it, and this
> page follows that one label from GitHub's POST to GitHub's API call, naming each hop, its file,
> and the one thing that hop protects. Read this before anything else in `design/`; the second
> half is the walkthrough for writing a capability, and `design/guides/first-capability.md` is the
> afternoon's version of it, one green test per step.

## The route

| # | Hop | Where | What it protects |
|---|---|---|---|
| 1 | GitHub POSTs the webhook; the receiver checks the HMAC over the raw bytes and writes the delivery to the store before answering 202 | `packages/runtime/src/shell/inbound/receiver.ts` → `createReceiver`; `packages/core/src/github/signatures.ts` → `verifyBody`; `packages/runtime/src/store/inbox.ts` → `acceptDelivery` | a forged body never enters; an accepted delivery is never lost to a crash |
| 2 | The delivery lane claims the delivery under a lease and loads the repository's `sdk-automations.yml` through the config source | `packages/runtime/src/shell/inbound/deliveries.ts` → `createDeliveries`; `packages/core/src/config/parse.ts` | one worker at a time; a rejected config records why and acts on nothing |
| 3 | The delivery becomes facts: the normalizer reads the payload's labels and state, projects them through the repository's mappings into a `Projection`, and marks `unread` every fact group its row in `PRODUCERS` does not name | `packages/core/src/engine/normalize/pull-request.ts`; `packages/core/src/workflow/project.ts` → `projectPullRequest`; `packages/core/src/capability/producers.ts` → `PRODUCERS`; `design/contracts/facts.md` | a capability never sees a label string, and never sees a group nobody read |
| 4 | `decide()` finds the enabled capabilities whose declaration reads this fact kind and whose needed groups were read, projects each a view of its own settings and the mapped names, and calls `evaluate` | `packages/core/src/engine/decide.ts` → `decide`, `intentsFrom`; `packages/core/src/capability/boundary.ts` | isolation: a capability sees its block, the names of the mappings, and its declared resolvers — nothing else (P3, P4) |
| 5 | The capability returns intents: "set `awaitingTriage`, because `issueWithoutPosition`, claiming the item is open and the meaning absent" | `packages/capabilities/src/triageQueue/capability.ts`; `packages/core/src/capability/factory.ts` → `buildIntent`, behind `platform.intent` | an intent is a request, dated by its occasion, with a stable identity |
| 6 | The screen checks the intent names its own capability, a declared operation, its own item, and a legal transition on the workflow map | `packages/core/src/engine/invoke.ts` → `screenIntent` | a capability cannot act as another, on another item, or off the map |
| 7 | The world is derived from the facts, not asserted: do the intent's claims hold against the projection the delivery carried? | `packages/core/src/safety/world.ts` → `deriveWorld` | a caller cannot assert a precondition its own delivery contradicts (D77) |
| 8 | The safety ladder judges the write request: kill switch, mode, capability enabled, grant present, item open and unpaused, precondition holding, no newer human change | `packages/core/src/safety/write.ts` → `evaluateWrite`; `packages/core/src/safety/rules.ts`; `packages/core/src/intents/operations/` for the operation's class and permission | every refusal is a code an operator reads; a destructive class is refused here and judged only at the grace gate |
| 9 | The approval: the intent becomes an `Effect` with its managed-comment identity minted (for comments) and its `WriteRequest` snapshot; a record-only mode records `wouldApply` instead | `packages/core/src/engine/decide.ts` → `gateIntent`; `packages/core/src/intents/managed.ts` | dry-run says exactly what active would do; identity is platform-owned (D125) |
| 10 | The applier plans the effect as calls — for a label move, add the new label then remove the displaced one — journals each call as a row BEFORE sending, re-derives the world against a live read of the item, sends, and confirms the postcondition by read-back | `packages/runtime/src/shell/apply/apply.ts` → `createApplier`; `packages/runtime/src/shell/apply/operations/index.ts` → `planFor`, `serializeCall`; `packages/runtime/src/shell/apply/operations/applyMappedLabel.ts` | a crash between journal and send is resent from the row; a human change between deciding and applying refuses the write; "applied" means observed, not assumed |
| 11 | The adapter admits the request by shape (the endpoint matrix as code), checks the grant, mints or reuses the installation token, sends, classifies the answer, and stales its cache | `packages/runtime/src/adapter/writes/requests.ts`; `packages/runtime/src/adapter/client/admission.ts` → `admit`; `packages/runtime/src/adapter/client/http.ts` → `createGitHubHttpClient`; `packages/runtime/src/adapter/writes/readback.ts` → `createReadBack` | only the endpoints the matrix confirmed can be reached; no credential leaves this directory |
| 12 | Every finding and every effect's outcome is a decision row, written before the delivery is completed, and the operator log names the kind it finished as | `packages/runtime/src/shell/decide/decisions.ts` → `decisionsOf`; `packages/runtime/src/store/inbox.ts` → `completeDelivery` | the record of what was decided and why outlives the process (D173) |

A sweep enters at hop 3 with a different producer: the driver decides which records exist — one per open item, with the groups its row in `PRODUCERS` promises — so the producer, not the capability, chooses which item a decision is about
(`packages/runtime/src/shell/sweep/sweep.ts`, `design/guides/sweep.md`) and hands `decide()` one record
per item. It is the other producer in `PRODUCERS`, and a producer decides which records exist —
hence which items a capability may write to at all, and how much of each one it may read. A destructive act takes hop 8 through the grace gate instead (`design/guides/grace.md`):
the platform posts the warning, records it when it lands, and judges the act against the record.

## What each noun is, once

- **facts** — one item as the platform read it, with a `position` (the projection) and groups that
  are read or `unread`.
- **meaning** — a platform position word (`awaitingTriage`, `ready`, …), never a label string.
- **mapping** — the reviewed label ↔ meaning table: the one bridge between a repository's words and
  the platform's.
- **projection** — the observed label set read as a position, or as a conflict.
- **position** — the single meaning an item occupies in its flow — or `null`, or a conflict.
- **blocked** — an orthogonal human-set pause flag: never a position, never capability-writable.
- **capability** — a unit of automation: a declaration plus a pure `evaluate` returning intents.
- **declaration** — a capability's self-description: what it watches, asks, does, and needs.
- **view** — the slice of the config a capability may see: its settings and the mapped names.
- **intent** — what a capability asks for: an operation, its desired value, its claims, its cause.
- **occasion** — where and when an intent arose (repository, item, observed time), bound once by the
  factory.
- **claims** — the facts a capability believes hold; checked by derivation, or again at act time.
- **screen** — a runtime check on a returned intent (attribution, floors, the map): enforcement, not
  ergonomics.
- **world** — the derived, unforgeable safety facts: what was observed, and whether a claim holds.
- **effect** — an approved intent on its way to GitHub, with identity. A managed comment's identity
  is per item and purpose; the effect id is per occasion.
- **call** — one GitHub step of an effect; its `sent` fact's payload is the call as bytes.
- **verdict / outcome** — what a gate said (`apply`, `refuse` with a code, `recordOnly`), and what
  the applier made of an effect (`applied`, `already`, `refused`, `retryLater`, `unknown`).
- **finding** — one record in a report: severity, machine code, prose, subject. `problems()` is the
  operator surface.

## Writing a capability

If a capability needs more than this page says, the platform is missing something. Build the
smallest honest version and mark the rest not built with the reason — never a workaround inside the
capability.

A gap you can only STATE belongs in your design page, in the "Needs first" cell of the phase that
needs it and in the one-line `Not built:` list under the title. A file in `design/findings/` is for
a MEASURED or PROBED fact, and a third copy of either breaks one fact, one place.

0. **Check the design against the platform before writing code.** Four lines, in the design page's
   Declaration table, each answered by a file:
   - facts and needs → the producers registry (`packages/core/src/capability/producers.ts`):
     every group you need must be read by a producer your trigger names, or boot refuses the
     declaration. A webhook reads the projection, `readiness`, `actor`, `author`; the sweep reads
     everything the endpoint matrix has confirmed. Needs are per kind: one list reaches every
     declared kind that carries each group, and a design whose issue branch reads a group its
     pull-request branch does not writes them per kind, so the sweep pays for neither (D214).
     Then check the group's element TYPE against what that producer can READ: `AssigneeClock`
     carries two clocks no webhook payload holds, so the `issues` webhook reads no assignee group
     and "add the row" is not the fix. A design needing a group its trigger cannot fill needs a
     different trigger, or the fact-shape change §6 prices — both interfaces, every producer, every
     fixture.
   - resolvers → `RESOLVER_NAMES` in `packages/core/src/catalogue.ts`, AND what feeds
     each one's input, AND which path answers it (a resolver needing a credential is `unavailable`
     on the credential-free path; the shell's stubbed externals list what they answer).
   - intents → `IntentCatalogue`'s desired payloads, in full: what you may say is exactly those
     fields. A label move's cause is chosen by the workflow map from the item's position
     (`moveTo`), not by you.
   - any "once" or "in place" promise → identity is per item and purpose (`kind` + `topic`);
     the effect id is per occasion. A comment with the same purpose on the same item is updated
     in place; two purposes need two topics.
   - settings → your design's config block, key by key, against the table in
     `design/guides/capability-kits.md` §3. A CROSS-FIELD rule is not expressible, and what moves
     is the design's config, to a structural form — a block or a group under the choice that needs
     it (§3.3), never the toolkit. `duration` has no optional form: an optional clock is a block,
     whose absence parks it. Every value a rendered comment interpolates must come from
     `CapabilityView` or the facts, and the view carries mapped NAMES and no spellings
     (contract.md §2). A block a repository opts into makes every example that enables the
     capability a no-op until the block is written there too — a doc edit per example.
   Designs written before the platform existed are often stale here. Correct the page first.
1. **Write the design page**, four sections: what the output looks like (the rendered comments), the
   config block, how it works (a flowchart of the guards in order, the declaration and the phases),
   verified-by (the scenarios, which become the test titles). Read the exemplar nearest your shape:
   `prDashboard` (webhook, resolvers, one comment), `triageQueue` (webhook, labels, several stations),
   `inactivity` (schedule, clocks, destructive acts — nine files, one per concern).
2. **Baseline.** `pnpm -r test` and `pnpm format:check` before you touch anything, so a later red is
   yours. `pnpm -r test:coverage` is the MUTATION path — it runs Stryker, it is slow, and it is
   CI's to judge; run it only when you mean to.
3. **Make the folder** under `packages/capabilities/src/<name>/`: `capability.ts`, `settings.ts`
   (the spec, from `design/guides/capability-kits.md`), `capability.test.ts`, and the design page
   MOVED here as `design.md` — updating the table in `design/guides/capabilities/README.md` and the
   one-line list in `packages/capabilities/README.md`. Four files is the minimum, not the shape: split by
   concern when a file answers two questions. If the folder already exists it is a seed — promote
   it in place. The shape every folder shares: the declaration stays in `capability.ts` until a
   sibling file needs its type (`inactivity/declaration.ts`); the words a contributor reads live in
   `messages.ts`, or in `render.ts` when they are a document; `settings.ts` opens with one line
   saying what the capability reads beside `enabled`; inline captions are `//`; a test drives
   `evaluate` through `handleFor` and scripts answers with `answering`, both from the harness.
   Every file in the folder names core through `@hiero-hackers/automation-core/author`
   (`packages/core/src/author/index.ts`), the door sized to what an author needs; the root barrel
   is the engine's, and a dependency rule refuses it from a capability.

   The `design.md` title is READ: its first line must be `# <name> — <purpose>`, with a spaced
   em-dash, because `docs/capabilities.md`'s purpose column is the half after it
   (`packages/dev/checks/test/capabilities.test.ts`). Your `capability.test.ts` builds its records
   from `@hiero-hackers/automation-core/author/testing` (`packages/core/src/author/testing.ts`),
   and a capability declaring FEWER groups than its
   producer reads passes `sweptPullRequest()` through `factsFor` — the projection the engine
   performs at the boundary, checked against your declaration.

   Register in `packages/capabilities/src/index.ts`: an import and one entry in `CAPABILITIES`. The
   named `export { … }` block is a third line only if something outside the package names your
   capability. The P3 matrix then covers you, and it writes each block at its own spec's FULLEST
   valid settings (`packages/core/src/author/testing.ts`), so work behind an `enabled: true` still
   runs in the alone-run. A PRINCIPAL your spec requires must be declared under `principals:` by
   every example that enables you.

   `test/engine-matrix.test.ts` pins every managed comment four fixtures earn, by capability, item
   and topic, and it is hand-written on purpose: derived from the registry it would assert whatever
   the code had just produced. The swept pull request is a DRAFT and earns none today, so a
   capability that acts on it adds a row to a file whose name does not mention it. Budget the edit.
4. **Declare** what you read in `catalogue.ts`'s words: fact kinds and groups, required mappings,
   resolvers, intents, and `evaluates` nothing else. A typo does not compile; a need no producer
   reads does not boot.
5. **Write `evaluate` in two captions**: the guards in the flowchart's order, each a visible `if`
   returning `[]` or `platform.skip(...)` — a design's "on event X" is a STATE here, never a
   trigger; then the act, intents through `platform.intent`. Three guards are the platform's and are
   never written: a closed item never arrives (declare `closed: true` to see one), `platform.ask`
   ends the evaluation when a resolver cannot answer, and a label with no edge is skipped.
   `view.settings` arrives typed and already judged, so there is nothing to read first. An intent's
   `cause` is FREE TEXT and part of its identity, so state it; `applyMappedLabel` moves the item, and
   its transition cause is the workflow map's (`moveTo`) unless you name one. Claims are derived from
   the record; name a claim only to narrow it. The judgements every capability makes live in
   `capability/facts.ts` (`isPaused`, `isConflicted`, `people`, the clocks, `mentions`, `on`,
   `inert`, `moveTo`); import them, never a sibling.

   An intent the safety ladder does not refuse contributes a `capabilityExplained` finding
   immediately BEFORE its verdict (`engine/decide.ts` → `gateIntent`), so two intents from one
   record produce two, interleaved with the verdicts. A `ConfigError`'s `message` already carries
   its own dotted path: format the pair as `path :: message`, never `${path}: ${message}`.
6. **If you need a word the platform lacks**, this is what each costs and where it lives. A GitHub
   read or write the endpoint matrix (`design/findings/endpoint-permission-matrix.md`) has not
   confirmed is implemented and REFUSING until a sandbox protocol cites it — never called.

   | You need | Where it registers | What else it obliges |
   |---|---|---|
   | an operation | one module in each of `core/src/intents/operations/` and `runtime/src/shell/apply/operations/` + a key in `IntentCatalogue`; a verb on `WriteVerbs` with its row in `runtime/src/adapter/writes/requests.ts`; a shape in `adapter/client/endpoints.ts` | a payload pin in the shell's effects test; `pnpm contracts`; `design/guides/write-operations.md` |
   | a resolver whose read the matrix HAS confirmed | `RESOLVER_NAMES` + `ResolverCatalogue` in `catalogue.ts`; the name in `CONFIRMED_RESOLVER_READS` and one arm in the dispatch of `runtime/src/adapter/reads/resolvers.ts` | a sentence in the generator's map; the two value pins below; the credential-free path if it needs no credential. An input the adapter cannot import arrives on `ResolverSourceOptions`, threaded from `packages/runtime/src/shell/compose/main.ts` |
   | a resolver whose read it has NOT | the same, minus the adapter arm: the gate narrows `query` to `ConfirmedRead` BEFORE the switch, so an arm for an unconfirmed name does not compile. The adapter edit is a docstring saying which endpoint it would read and what the matrix lacks | the same two value pins; the capability shows the check undetermined until a sandbox protocol cites the row |
   | a fact group | the field on its kind's interface and a name in `FACT_GROUPS` (`catalogue.ts`); one module in `core/src/capability/groups/` — the producers that read it per kind, its webhook read if a webhook reads it, its stored decoder if the sweep keeps it, its fixture — and a registry line; its sweep read, one module in `runtime/src/adapter/reads/groups/`, and a registry line | `facts.md` regenerates |
   | a fact field (always read) | both fact interfaces; every producer; a `NORMALIZE_MALFORMED_CODES` entry if a payload may lack it | fixtures |
   | a producer (a new event) | one module in `core/src/engine/normalize/`, a union member and registry line in `engine/events.ts`, its kinds in `PRODUCER_KINDS` and its name in the rows of the groups it reads | a captured payload in the testkit, or a test that says there is none |
   | a mapping family | `config/schema.ts` + one `MeaningFamily` spec, whose `meanings` is the closed list or `null` for an open-keyed family, read by the one family reader | two error codes → `docs/configuration.md`, `config-schema.md` §6, and a reachable document per code |
   | a meaning | one row in `MEANING_FACTS` (`config/schema.ts`), which the union and the array derive from + one row in `design/contracts/taxonomy.md` §2 | the meanings table in `docs/configuration.md` (locked by `docs.test.ts`), `docs/examples/full.yml`, and the workflow map (`packages/core/src/workflow/transitions.ts`, `causes.ts`) if the meaning is a position |
   | a settings constructor | `capability/settings.ts`, with its rule stated | the kits guide's table |
   | a REQUIRED setting (`duration()` with no default, `text`/`principal` not optional, any `oneOf`) | your own `settings.ts`. The settings tree renders such a key as a placeholder (`packages/dev/checks/test/generated.ts` → `placeholder`), so there is no generator edit | every example that ENABLES you states the key; `docs/examples/full.yml` always does |
   | a principal (`principal({ optional: false })`) | the same | a `principals:` section in every example that enables you, and the name your `notify:` points at |
   | a second capability on one trigger | the registry line only | the examples whose PROSE claims to show that trigger — `docs/examples/inactivity.yml` is the schedule's |
   | a field on a desired payload | `IntentCatalogue` + the generator's `DESIRED_FIELDS` map | the shell handler that renders it |
   | a FIRST settings key on a capability that had none | your own `settings.ts` | your own `capability.test.ts`, and `configReport`'s expected comment body — it renders every enabled capability's settings, so a key on one capability reds a test file with another capability's name on it |
   | a fact KIND, durable state, a cross-item read, a subject that is not an item | not coverable — the platform's unit of decision is one item | the smallest honest version, the rest marked not built, and a finding |

   **Every closed vocabulary here is pinned BY VALUE in at least one test, and the new name goes
   into the pin in the same commit as the vocabulary.** Adding a resolver reds
   `packages/runtime/test/adapter/reads/item-resolvers.test.ts`, which pins
   `CONFIRMED_RESOLVER_READS` by value. Answer a red pin rather than deriving it away.

7. **Run the suite.** The checks read the working tree, so a new file is judged before it is
   committed.

   **`pnpm contracts` first, then the checks**, and first means after your LAST edit rather than
   after your code. It rewrites every generated artifact: the contract tables of
   `design/contracts/catalogue.md`, `design/contracts/facts.md` and `design/contracts/safety.md`,
   the constructor table of `design/guides/capability-kits.md`, the capability table and settings
   trees of `docs/capabilities.md`, the editor schema `docs/automations.schema.json`, and the
   committed parsed value of each file in `docs/examples/`. Nothing there is edited by hand. It
   typechecks `packages/dev/checks` before it generates anything, so a generator you broke arrives
   as a TYPE error under that package.

   **Keep working notes out of the tree.** `repositoryFiles()` is
   `git ls-files --cached --others --exclude-standard`
   (`packages/dev/checks/test/repository.ts`), so an untracked note is documentation the moment it
   exists, and `packages/dev/checks/test/citations.test.ts` resolves every `design/….md` and
   `docs/….yml` string in every document. Put notes in `notes/` at the repository root, which is
   ignored, or outside the repository.

The skills in `.claude/skills/` are the house style for what you write: `placement` (where a
file goes), `docstrings` (what a header says), `clarity` (how a body reads), `capability-design`
(the design page).
