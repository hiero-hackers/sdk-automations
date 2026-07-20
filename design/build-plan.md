# Build Plan: Audit → Design → Build → Launch

> DRAFT — the plan the README promises: names, estimates, and what is actually committed. The plan
> is **gated, not dated**: each phase ends at a gate the design already defines (the ratification
> memo, the conformance kit, the replay gate, the ring soaks). Phases deliberately **overlap** — a
> phase's setup work (scaffolding, recruiting, doc drafting) starts during the previous phase's
> tail, but its gate-dependent work never starts before the gate is green. Dates anchor the plan to
> a start on **20 Jul 2026** (sign-off begins immediately); slipping the start slips everything by
> the same amount. Week counts are calibrated to the cadence the project has actually run at — the
> full audit-and-design effort took ~5 weeks with two part-time contributors (16 Jun → 20 Jul 2026).

## The picture

```mermaid
gantt
    title sdk-automations — Jul 2026 → Feb 2027 (indicative)
    dateFormat YYYY-MM-DD
    axisFormat %b

    section Done
    Audit & design (this repo)          :done, p0, 2026-06-16, 2026-07-20

    section Approve
    1 · Sign-off                        :p1, 2026-07-20, 2026-08-14
    design approved                     :milestone, 2026-08-14, 0d

    section Build
    2 · Build the engine                :p2, 2026-08-10, 2026-09-25
    engine works                        :milestone, 2026-09-25, 0d
    3 · Build the features              :p3, 2026-09-07, 2026-10-16
    features complete, RC cut           :milestone, 2026-10-16, 0d

    section Test
    4 · Sandbox testing (ring 0)        :p4, 2026-10-12, 2026-11-13
    sandbox passed                      :milestone, 2026-11-13, 0d
    5 · Beta — one real repo (ring 1)   :p5, 2026-11-09, 2026-12-11
    beta passed                         :milestone, 2026-12-11, 0d

    section Launch
    6 · Fleet rollout (ring 2)          :p6, 2026-12-07, 2027-02-12
    old bots retired                    :milestone, 2027-02-12, 0d
```

Every bar starts inside the one before it: the overlap is setup work that no gate can overturn
(scaffolding, sandbox plumbing, volunteer recruiting, runbook drafting). The milestones are the
hard sequence — no gate is passed early.

And the gates as the design defines them — a phase is over when its gate is green, not when its
weeks run out:

```mermaid
flowchart LR
    A[audit + design ✓] --> G1{memo signed}
    G1 --> B[engine] --> G2{kit green<br/>on a stub}
    G2 --> C[features] --> G3{all modules<br/>kit-green → RC}
    G3 --> D[ring 0<br/>sandbox] --> G4{replay gate clean<br/>+ soak clean}
    G4 --> E[ring 1<br/>volunteer repo] --> G5{soak clean +<br/>migration dry-run}
    G5 --> F[ring 2<br/>fleet] --> G6{old bots off}
```

## Phase summary

| # | Phase | Dates | Gate at the end |
|---|---|---|---|
| ✓ | **Audit & design** | 16 Jun – 20 Jul 2026 | this repo, as it stands |
| 1 | **Sign-off** | 20 Jul – 14 Aug 2026 | ratification memo signed; hosting named; owners committed; baseline captured |
| 2 | **Build the engine** | 10 Aug – 25 Sep 2026 | conformance kit green on a stub module |
| 3 | **Build the features** | 7 Sep – 16 Oct 2026 | every chosen module kit-green; release candidate cut |
| 4 | **Sandbox testing** (ring 0) | 12 Oct – 13 Nov 2026 | replay gate diffs clean; soak window clean |
| 5 | **Beta** (ring 1) | 9 Nov – 11 Dec 2026 | soak clean; migration runbook dry-run |
| 6 | **Launch** (ring 2) | 7 Dec 2026 – mid Feb 2027 | every participating repo on the app alone; old bots retired |
| 7 | **Maintain & grow** | from Feb 2027 | — (the module lifecycle takes over) |

## The phases

### ✓ Audit & design — 16 Jun – 20 Jul 2026 (done)

The work this repo holds today: the C++, Python, and JavaScript bots read at pinned commits
([`audit/`](../audit/)), the coupling anti-patterns distilled
([`planning/lessons-learned.md`](../planning/lessons-learned.md)), and the replacement designed in
full — architecture, taxonomy, module catalogue, config schema, safety, operations, threat model.

### Phase 1 · Sign-off — 20 Jul – 14 Aug 2026

*Calendar-bound, not effort-bound: the limit is convening maintainers, not doing work.*

The design is written; nothing builds until maintainers walk the register.
[`decisions.md`](decisions.md) is already the skeleton of the ratification memo.

- Ratification memo: maintainers walk **D1–D25**, flip each to ratified / overturned.
- TSC asks: hosting vehicle (**Q1** — LFDT infra vs TSC account) and install-scope governance (**Q11**).
- Pick the first feature set, and whether the intake lock ships (**Q2**) — this fixes Phase 3's scope.
- Settle what counts as a ladder completion (**Q3**) and any manual-entry veto (**Q4**).
- Name owners for every row of this plan (**Q13** — the table below).
- ⏰ **Deadline-bound: capture baseline behaviour of the live C++/Python bots** while they still run.
- Write [`contributors.md`](contributors.md) (promised by the README, still missing).

**Gate — design approved.** Decisions ratified, hosting named, feature set fixed, at least one owner
per build workstream, baseline captured.

### Phase 2 · Build the engine — 10 Aug – 25 Sep 2026 🔨 *coding starts here*

*The long pole. Everything modules depend on and nothing they see — the core is deliberately the
biggest single build so the modules stay thin. Starts during sign-off's final week: repo
scaffolding, CI, and the fake-GitHub harness are safe under any ratification outcome; code that a
decision could overturn waits for the memo.*

- **Shell:** webhook receiver, installation keying (what makes rings possible later), adapter with
  the global token bucket + write pacer, decision log (feeds the replay gate).
- **Config:** registry, `_extends` resolution, the JSON Schema (written with the registry, per Q12),
  health-issue reporting of unknown keys.
- **Core:** the two state machines and twelve labels, per-position invariants, resolvers
  (`linkedIssues`, `eligibleLevel`, `isBot`), safety engine (warn-then-act, blocked-freezes-clocks),
  projections renderer, serializer + compare-and-set, manual-edit / incoherence handling.
- **Test harness:** fake core, conformance-kit derivation from module declarations, fixture recorder
  (fixtures recorded, never hand-written — [`testing/README.md`](testing/README.md)).

**Gate — the engine works.** Core unit + invariant suites pass; the kit runs a trivial stub module
end-to-end, including the toggle matrix and the five incoherence injections.

### Phase 3 · Build the features — 7 Sep – 16 Oct 2026

*Overlaps the engine build's tail; parallelizes perfectly across owners — no module ever depends on
another, by design.*

Each module follows the same path: spec from [`modules/TEMPLATE.md`](modules/TEMPLATE.md) → ratify →
build → pass the kit (passing the kit **is** the definition of being a module). Order below is by
standalone-ness so each ships useful on its own; the actual set is whatever sign-off chose.

1. **assignment** — fully functional from hand-applied `ready for dev` labels, no upstream needed.
   Settles whether native-assign repair is in its contract (**Q5**).
2. **pr-quality** — self-contained on the PR side.
3. **intake** — automates the pool assignment already consumes; the lock question was decided at
   sign-off.

`modules/authoring.md` and the kit implementation guide are written alongside the first real module
(Q12's triggers).

**Gate — features complete.** Every chosen module passes its derived kit; composition suite green;
release candidate cut.

### Phase 4 · Sandbox testing — 12 Oct – 13 Nov 2026 (ring 0)

*First contact with real GitHub, on a practice repo. Mostly watching it run — and measuring every
number the design estimated. The sandbox repo, webhook plumbing, and hosting deploy are set up
while the last features finish; the soak clock starts only when the RC lands.*

- Before entering: fix marker/schema format, warning templates, health-issue pinning (**Q9**).
- Sandbox live on real webhooks; nightly E2E; failures mark the dashboard, page nobody.
- Record fixtures and replay corpora from real traffic — retires all hand-guessed payloads.
- Measure timeline-read + secondary-limit budgets (**Q10**) → confirms or overturns the newer-fact
  rule (D9) and the rate arithmetic (D20).
- Build the replay gate from the decision log; first red-team pass on the threat model (D25's
  overturn clause names ring 0/1).
- Write the ring-0 sandbox runbook, against the working sandbox (Q12).

**Gate — sandbox passed.** Replay of N days of sandbox events diffs clean; agreed observation window
with zero unexplained alerts.

### Phase 5 · Beta — 9 Nov – 11 Dec 2026 (ring 1)

*One real repo with real contributors; the old bots keep running as the safety net until cutover is
scripted. Volunteer recruiting and the first draft of the migration doc begin during the sandbox
soak; the app touches the volunteer repo only after the sandbox gate.*

- Recruit the volunteer repo; agree soak duration, log retention, ring visibility (**Q8**).
- Write `operations/migration.md`: label mapping table + per-repo cutover runbook (**Q7** — blocks
  the C++/Python cutover, nothing else).
- Kill switches proven in anger: operator per-module, repo config block, item-level `blocked`.
- Failure-loudness routing validated with a real audience on the other end.

**Gate — beta passed.** Soak window clean; migration runbook dry-run on the volunteer repo.

### Phase 6 · Launch — 7 Dec 2026 – mid Feb 2027 (ring 2)

*Rolling, repo by repo, with holiday slack built in — December is a bad month to cut over live
repos, so the fleet is paced as small batches through January. First-batch prep (configs, per-repo
runbooks) starts during beta's tail; no repo cuts over before the beta gate.*

- Fleet repos onboard in batches: install → config → runbook → old-bot decommission.
- C++ and Python SDK cutovers first (they carry the richest automation); JS follows.
- Remaining modules ride the same spec → kit → ring path as capacity allows: inactivity,
  review-routing (settles the `queue:` storage question, **Q6**), progression, notifications, admin.
- Rate arithmetic re-checked at real fleet size; escape hatches (ETags → cadence → owned store) in
  reserve.

**Gate — old bots retired.** Every participating repo runs on the app alone; per-repo scripts
deleted; baseline comparison archived.

### Phase 7 · Maintain & grow — from Feb 2027

The module lifecycle takes over: proposal → fitness test → spec → kit → ring
([`modules/README.md`](modules/README.md) §4). Config keys deprecate in place, never break. Nightly
E2E on ring 0 continues as the standing drift alarm; fixtures re-recorded on schedule; the rate
arithmetic re-run when the fleet grows. AI-assist hooks are explored through the notifications
module — the one module that touches no state.

## Who builds it (Q13)

Every dash below is Q13's open question. The baseline-capture row is the one with a real deadline —
the old bots must be recorded while they still run.

| Workstream | Phase | Owner |
|---|---|---|
| ⏰ Baseline capture of live C++/Python bots | 1 | — |
| Ratification memo convening | 1 | — |
| Shell (webhooks, adapter, decision log) | 2 | — |
| Config registry + JSON Schema | 2 | — |
| Core (state machines, resolvers, safety, projections) | 2 | — |
| Test harness + conformance kit | 2 | — |
| assignment module | 3 | — |
| pr-quality module | 3 | — |
| intake module | 3 | — |
| Ring-0 sandbox + replay gate | 4 | — |
| Migration protocol (`operations/migration.md`) | 5 | — |
| Fleet rollout operator | 6 | — |

## Critical path and standing risks

- **Q1 blocks build start.** No hosting vehicle → no webhook endpoint → nothing real to build
  against. It is the first ask of the TSC and the only sign-off item that can slip the whole plan.
- **Baseline capture has a real deadline.** Everything else in this plan is elastic; that row is not.
- **Owners are the multiplier.** Phase 3's features parallelize perfectly. One owner ≈ serial; three
  owners ≈ the overlap the gantt draws. Adding people shortens the build (Phases 2–3), not the
  testing and rollout (Phases 4–6) — roughly a third of the calendar is deliberate watching-it-run.
