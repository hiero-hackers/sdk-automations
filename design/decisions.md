# Decisions and Open Questions: the Register

> The index of every **proposed** position and every open question across the design — one line
> each, pointing at the doc that argues it. **This file holds no content**: if a row disagrees with
> its doc, the doc wins and the row is a bug. It is also the skeleton of the ratification memo —
> maintainers walk this table, read behind the links they care about, and flip Status as they go.
> Status: `proposed` → `ratified` / `overturned` (with a date and a line on what replaced it).

## Decisions awaiting ratification

| # | Decision | Where argued | Overturned by | Status |
|---|---|---|---|---|
| D1 | GitHub is the database — stateless reducer, no owned store | `architecture.md` §4.1 | an invariant provably needing a store | proposed |
| D2 | Two state machines, one per entity; no label written across the issue↔PR link | `core/taxonomy.md` §2 | a need no resolver read can meet | proposed |
| D3 | The twelve-label set; priority/effort go native; `lifecycle:`+`notes:` folded away | `core/taxonomy.md` §1, §3 | ratifiers amending the set | proposed |
| D4 | Close hygiene is the core's; named labels only, never a prefix strip | `core/taxonomy.md` §2.3 | — (cures A1 by construction) | proposed |
| D5 | Per-position invariants incl. `ready for dev` = unassigned pool | `core/taxonomy.md` §2.4 | ratifiers amending rows | proposed |
| D6 | Two rulebooks: humans edit state (any→any), modules request edge-bound transitions | `core/manual-edits.md` §1 | — (load-bearing for toggling) | proposed |
| D7 | Never revert a human; the one exception is completing a two-position edit | `core/manual-edits.md` §2 | ratifiers wanting a hard gate on some position | proposed |
| D8 | The five incoherence classes and their semantics (latest-wins · flag-don't-fix · invisible · quarantine · forget) | `core/manual-edits.md` §3 | per-class amendment | proposed |
| D9 | The newer-fact rule, enforced via timeline reads | `core/manual-edits.md` §4 | timeline reads too costly at sweep scale | proposed |
| D10 | Warn-then-act mandatory for clock-triggered destructive actions; explain-and-reverse for preventive ones; one-gesture reversal | `core/safety.md` §1 | — | proposed |
| D11 | Blocked freezes clocks; **reset** (not resume) on unblock | `core/safety.md` §3 | ratifiers preferring resume | proposed |
| D12 | Projections have no read API; modules never write comments — the core renders | `core/projections.md` §1–2 | — (cures A2 by construction) | proposed |
| D13 | Exactly two projection-read exceptions, governed by the register | `core/projections.md` §3 | a third entering by amendment only | proposed |
| D14 | Resolved projections are edited down, not deleted | `core/projections.md` §1.5 | maintainers preferring deletion | proposed |
| D15 | `linkedIssues` = GraphQL closing references, only | `core/resolvers.md` §2 | — (must agree with native merge-close) | proposed |
| D16 | **Skill ladder: org-wide credit, repo-local gate; thresholds org-level** | `core/resolvers.md` §3 | difficulty judged non-transferable → repo scope key | proposed |
| D17 | A knob only where repos differ; safety, commands, and whose-turn not configurable | `config/schema.md` §3 | — | proposed |
| D18 | Safe-to-be-down: no pager, one instance, sweeps as recovery | `operations/README.md` §1 | fleet growth past the arithmetic | proposed |
| D19 | Hosted app over reusable workflows | `operations/README.md` §2 | no org-level operator found | proposed |
| D20 | Rate budget enforced at the adapter only; sweep cadence is fleet arithmetic, not config | `operations/README.md` §4 | arithmetic off by >2× | proposed |
| D21 | Every failure has exactly one audience (routing table) | `operations/README.md` §5 | — | proposed |
| D22 | Replay gate + rings + three-grain kill switches for rollout | `operations/README.md` §3 | — | proposed |
| D23 | Module contract: five typed declaration fields; required `cause`; `effects` for A3 coupling | `modules/contract.md` | build-time refinement of shapes | proposed |
| D24 | One process orders work and checks `expect`; saved pending records and App events recover interrupted changes; `unknown` reports an unclear result | `architecture.md` §4; `modules/contract.md` §3 | several active processes, or a partial change that cannot be matched and recovered → shared state for coordination, reopening D1 | proposed |
| D25 | Threat model: per-actor command budgets, echo policy + authorship checks, same-org one-level `_extends`, schema floors, safe-to-shed backpressure | `operations/threat-model.md` §3 | red-team findings at ring 0/1 | proposed |
| D26 | The label set is code, not config — no `core.labels` key; legacy spellings are the migration table's business, never standing config | `config/schema.md` §3, `core/taxonomy.md` §3 | a genuine display-spelling need → a narrow rendering alias, never a semantic change | proposed |
| D27 | The pending-record protocol: comment metadata is the app's only durable state — a write-ahead log (write-read-back `pending`, verify, `completed`); de-risked by the walking skeleton in week one | `core/projections.md` §3; `modules/contract.md` §3 | the skeleton proving it impractical against the real API → an owned store behind the core, reopening D1 | proposed |

## Open questions

| # | Question | Decided in / by | Blocks |
|---|---|---|---|
| Q1 | Where hosting lands (LFDT infra vs TSC account) | TSC — ask is `operations/README.md` §2 | vehicle confirmation → build start |
| Q2 | MVP module set + whether the intake lock ships | maintainers, with the memo | migration mapping, `config/schema.md` keys |
| Q3 | What counts as a ladder completion (merged-PR close only?) | ratification memo (`core/resolvers.md` §4) | `eligibleLevel` build |
| Q4 | Any policy veto on manual entry (default no) | ratification memo (`core/manual-edits.md` §2) | — |
| Q5 | Does assignment's contract include the native-assign repair? | assignment module spec | class-2 healing |
| Q6 | `queue:` namespace — storage or derivable? | review-routing module spec | that module only |
| Q7 | Migration protocol (mapping table + per-repo runbook) | `operations/migration.md` — **unwritten** (Track A2) | C++/Python cutover |
| Q8 | Ring-1 volunteer repo, soak durations, log retention, ring visibility | operator + TSC | rollout |
| Q9 | Marker/schema format, warning templates, health-issue pinning | build time, before ring 0 | ring 0 |
| Q10 | Timeline-read + secondary-limit budgets | measured at ring 0 | D9 confirmation |
| Q11 | Install org-wide with config consenting, or tight repo selection? | TSC governance | install guidance |
| Q13 | Who builds it — every dash in `build-plan.md`'s Owner column; the baseline-capture row has a deadline (old bots still running) | maintainers / TSC commit names | everything downstream |
| Q12 | Build-time docs, deliberately deferred with triggers: `modules/authoring.md` (with the first real module), the config JSON Schema (with the registry), the ring-0 sandbox runbook (with ring 0), the kit implementation guide (extracted from the first working harness) | build phase — each written against working code, not before | nothing (deferral is the decision) |
