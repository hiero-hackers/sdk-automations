# Principles Review: Hiero C++ SDK Automation

> **What this covers:** the C++ maintainer-automation system graded against classic software-design
> principles — where it upholds each, where it misses, and why.
>
> **How it differs from the rest of the audit.** The Phase 1–3 audit files are *descriptive* (what the
> system does); this one is *evaluative* (how well it does it, measured against named principles). It is
> the top-down cross-check on the bottom-up findings: if the coupling the audit found is real, it should
> show up as a principle being missed. It does.
>
> **Source:** the same commit and files as the rest of the audit (`audit/services-cpp.md`,
> `audit/labels-cpp.md`, `audit/coupling-cpp.md`); `§` references point into `coupling-cpp.md` unless
> noted. Cross-references to `planning/lessons-learned.md` use its entry codes (A1, B1, …).
>
> **Framework:** classic software-design principles (single source of truth, least privilege, single
> responsibility, explicit contracts, …), chosen over the cloud-infra Well-Architected pillars because
> this is a code-and-workflow system, not infrastructure.
>
> **Grade scale:** A upholds it cleanly · B upholds with one real gap · C honoured in code but broken at
> the system level · D routinely violated.

## The one-line finding

C++ scores **high on the local-quality principles** (single source of truth, least privilege,
idempotency, testability) and **low exactly on the inter-component principles** (explicit contracts,
fail-loud, data ownership, single responsibility). That split *is* the result: the code is well-built unit
by unit, and the coupling lives in the seams between units — the same "clean code, coupled system" story
as the audit's meta-finding, now stated as principles, with credit where the coupling lens alone gives
none.

## The principles

### 1. Single source of truth (DRY) — A

Every label string, limit, team, and prerequisite is defined once in `hiero-automation.json`,
schema-validated, and exposed as frozen constants; no handler types a label by hand. This is why C++ has
zero label drift where Python has four drift sets. (`services-cpp.md` App. B, §2.4 · keep-list, contrast E1)

### 2. Least privilege — A

The App runs on minimal scopes, workflows check out the default branch only (never PR-branch code), and
the PR-review relay's capture stage carries `contents: read` only so a fork event can never run untrusted
code with a write token. Privilege is scoped tightly and deliberately. (`services-cpp.md` architecture ·
keep-list)

### 3. Idempotency — A

Bot comments are marker-keyed and updated in place; the inactivity warning is idempotent; status writes
force the intended end state rather than assuming the prior one. Re-running a handler converges instead of
duplicating. (§2.2 · keep-list)

### 4. Testability — unit/handler A · seam/integration D

This principle splits, and the split is the finding (full read in `audit/testing-cpp.md`). A dedicated
`zxc-test-bot-scripts` CI job runs ~10k lines across 16 files — one per handler plus the helpers — each
driving a whole handler against a mocked GitHub (REST + GraphQL), with an injectable clock. **Unit/handler
testability is an A**: even cross-entity *reads* are mockable (issue assignees, closing refs), so the
issue-link check and the inactivity thresholds are well covered. **Seam/integration testability is a D**:
the couplings that span two handlers or live in YAML fall outside the suite — the artifact relay's
exact-name link has **no test file at all** (`bot-on-pr-review-labels.js` is untested, and a rename stays
green), deployment bundling and the concurrency lock are not code paths, and no test runs the handlers as a
*sequence*, so a divergence like the two linked-issue mechanisms (appendix row 6) cannot surface. The same
two-band fault line as the rest of this review — local quality high, inter-component quality low — visible
in the test suite itself.

### 5. Safe / reversible operations — B

The Inactivity Reaper has the system's one real safety mechanism — warn at 5 days, act at 7, with a
`status: blocked` exemption. That is the right pattern. The gap is that it is the *only* one, and the
destructive path itself is blunt: the bulk strip removes every `status:*` label by prefix, including ones
the config never defined, so a "safe" cleanup can delete state it does not understand. (§5.1 · keep-list,
A1)

### 6. Single responsibility — C

Handlers are cleanly separated in code, but two deployment units bundle unrelated jobs: `on-pr-close.yaml`
runs Post-Merge Recommendation and Sibling Conflict Re-check together, and Post-Merge itself does cleanup,
milestone assignment, *and* recommendation in one path with a shared early exit. A unit that does three
things cannot be toggled to do one. (§2.6, §5.4 · D1)

### 7. Data ownership / encapsulation — C

The principle that each piece of state has one owner is honoured for config (one file) but broken for
moving state. The `status:` namespace is read or written by nine of ten services and owned by none; the
assignee list and the `status:` label are mutated together but by four different services; and several
handlers reach across the PR↔issue link to write the other entity's state. No module encapsulates the
state it mutates. (§2.1, §2.3, §2.5 · A1, A3, C1)

### 8. Explicit contracts / interface segregation — D

Components depend on each other through implicit, unenforced contracts. The artifact relay is keyed on the
literal workflow name `"Bot - On PR Review"`; Sibling Conflict Re-check reads the literal substring
`:x: **Merge Conflicts**` out of another service's rendered comment; and the config schema lets any service
read any key rather than exposing each feature only what it needs. None of these contracts is declared or
checked. (§2.2, §2.6, §2.4 · A2, B1, E1)

### 9. Fail-loud (no silent failure) — D

Where the implicit contracts break, they break silently. Rename the relay's producer workflow and the
label applicator simply stops firing; rename any of the seven CI checks the Python notifier watches and it
stops for that one — no error, no log, no surfaced gap. A broken contract should fail loudly; here it
fails quietly. (§5.5 · B1; `labels-python.md` notifier section for the parallel case)

## Scorecard

| Principle | Grade | One-line reason | Cross-ref |
|---|:--:|---|---|
| Single source of truth | **A** | one config, zero drift | keep-list, E1 |
| Least privilege | **A** | minimal scopes, fork-safe, default-branch-only | keep-list |
| Idempotency | **A** | marker-keyed comments, force-apply state | keep-list |
| Testability (unit/handler) | **A** | full bot-script suite, mocked GitHub, injectable clock | testing-cpp.md |
| Testability (seam/integration) | **D** | relay has no test file; no cross-handler sequence tests | testing-cpp.md |
| Safe / reversible | **B** | reaper grace period, but the only one; blind `status:*` strip | keep-list, A1 |
| Single responsibility | **C** | handlers split, but two files bundle jobs | D1 |
| Data ownership | **C** | `status:` spine owned by no module | A1, A3, C1 |
| Explicit contracts | **D** | exact-string and comment-prose links, any-key schema | A2, B1, E1 |
| Fail-loud | **D** | renamed strings break silently | B1 |

## Synthesis

The grades fall into two bands with nothing in between. The A band is everything a single unit controls on
its own — define a label once, hold a tight permission, write an idempotent comment, test a function. The
C–D band is everything that lives *between* units — who owns shared state, how one component depends on
another, what happens when that dependency breaks. C++ is, by these principles, a collection of
well-architected parts wired together by implicit contracts over shared, unowned state.

Testability is the sharpest demonstration, because the one principle straddles both bands: the *same*
suite scores an A at the handler level and a D at the seam level (`audit/testing-cpp.md`). Where a unit can
be isolated it is tested thoroughly; where two units are coupled across handlers or YAML, the test boundary
ends — the relay coupling has no test file at all. The two bands are not two sets of principles; they are
the same system measured locally versus across its seams.

That is an encouraging diagnosis, because the strong band is the hard part to retrofit and it is already
there. What the shared app has to add is the weak band: explicit, checked contracts between modules (the
capability registry, `design/architecture.md` §5), single ownership of the state spine (the core state machine,
`design/architecture.md` §4), and loud failure when a contract is unmet — none of which require giving up the
single-config, least-privilege, idempotent foundation that already scores an A.
