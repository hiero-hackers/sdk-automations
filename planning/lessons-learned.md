# Lessons Learned: What Causes Coupling, and What to Avoid

> **What this covers:** the coupling failure modes found in the two existing SDK automation systems — what
> to avoid, and why. Every entry is an audit finding, not a new investigation.
>
> **Source:** the Phase 1–3 audits (`audit/services-cpp.md`, `audit/labels-cpp.md`,
> `audit/labels-python.md`, `audit/services-python.md`, `audit/coupling-cpp.md`) and `audit/services.md`.
> Section references (`§2.1` etc.) point into `audit/coupling-cpp.md` unless noted.
>
> **Scope:** this records the anti-patterns only. What to build instead is `design/architecture.md`.

## The meta-finding: the two SDKs trade one coupling for the other

Neither existing system can simply be copied — each is good at what the other is bad at. C++ has low data
coupling (one config file, no hand-typed labels, zero drift) but high deployment coupling (services share
a few workflow files, so disabling one means editing a shared file). Python is the reverse: ~40 small
workflows that are easy to delete individually, but messy shared data — four label-drift sets, labels
created at runtime, exact-string CI matching. (§7, `audit/labels-python.md`)

Every entry below is a specific instance of one of those two coupling kinds.

## What C++ does well — keep these

The anti-patterns below are about what to change; these are the properties worth preserving, not coupling
failures. They are why C++ has zero label drift and why its code is the cleaner of the two to separate.

**One config file, zero drift.** Every label string, limit, team, and prerequisite lives in
`hiero-automation.json`, schema-validated and exposed as frozen constants — no handler types a label by
hand. This is exactly the property Python lacks (the four drift sets, E1). (`audit/services-cpp.md`
Appendix B, §2.4)

**A single shared helper barrel.** Every handler imports one `helpers/index.js`
(`api`, `checks`, `comments`, `constants`, `logger`, `validation`); shared logic is written once, not
copy-pasted across workflows. (`audit/services-cpp.md`)

**Fork-safe by construction.** Workflows check out the default branch only, never PR-branch code, and the
PR-review relay captures the event to an artifact so a fork event never runs untrusted code with a write
token. Keep this safety — note that the *exact-string* link it relies on is the weakness in B1, so the
pattern to keep is the fork safety, not the literal-name coupling. (`audit/services-cpp.md`)

**Destructive actions already carry a grace period.** The Inactivity Reaper warns at 5 days and acts at 7
— the one built-in safety pattern across either SDK, and the model worth generalising. (§5.1)

## A. Shared mutable state

**A1. Avoid a shared label namespace that no single feature owns.** The `status:` namespace is the
system's spine — nine of ten services read or write it, and `status: ready for dev` alone is referenced by
eight. No one feature owns it, so you cannot disable, move, or reason about any of them in isolation. Worse,
the two bulk strips (Post-Merge Cleanup, Inactivity Reaper) remove **every** label starting with `status:`
by prefix, so they also delete labels the config has never heard of (`status: needs info`,
`status: awaiting merge`). (§2.1, §5.1)

**A2. Avoid passing data between features as rendered comment prose.** Sibling Conflict Re-check decides
its logic by testing whether the dashboard comment another service wrote contains the literal substring
`:x: **Merge Conflicts**`. It depends not on the other service having run, but on it having rendered that
exact string — so re-wording a human-facing comment silently breaks a different feature. (§2.2, §5.3)

**A3. Avoid splitting assignee and status across separately togglable features.** They are mutated
together at every step — `/assign` adds an assignee and sets `status: in progress`; `/unassign` and the
Reaper remove the assignee and reset to `status: ready for dev`. Enabling one without the other leaves the
pair inconsistent. (§2.3)

## B. Hidden string contracts (silent breakage)

**B1. Avoid coupling two components through a hand-copied literal string.** Two independent instances of
the same failure: the C++ artifact relay fires on `workflow_run` keyed to the exact producer name
`"Bot - On PR Review"`, and the Python notifier matches 7 CI workflows by their exact display names. Rename
either end and the link silently stops — no error, nothing to surface the gap. (§2.6, §5.5;
`audit/labels-python.md` notifier section)

**B2. Avoid answering the same question two different ways.** "What issue is linked to this PR?" is
resolved by GraphQL closing-reference fields in the merge and assign paths, but by a body-text regex in the
Inactivity Reaper. The two mechanisms can disagree, so correctness depends on which path happens to ask.
(§2.5)

## C. Cross-entity coupling

**C1. Avoid baking cross-entity writes into a feature triggered on the other entity.** Post-Merge Cleanup
strips `status:*` and sets milestones on the *linked issues*; the Reaper resets linked issues when it
closes a PR. A repo that enabled PR-side automation but not issue-side automation would still get its
issues mutated, because the traversal is built into the handler. (§2.5, §5.2)

## D. Deployment and packaging

**D1. Avoid bundling unrelated capabilities behind one trigger and permissions block.** `on-comment.yaml`
puts `/assign`, `/unassign`, and `/finalize` behind one dispatcher; `on-pr-close.yaml` puts Post-Merge
Recommendation and Sibling Conflict Re-check in one file on one `merged == true` trigger. Turning off a
single member of either bundle is a code or YAML edit, not a config choice. (§2.6, §5.4)

**D2. Avoid assuming separate files are independent — a shared concurrency group is hidden coupling.** PR
Open, PR Update, and PR Review capture all use the group `pr-bot-<pr number>` with
`cancel-in-progress: false`, so they serialise behind one another per PR despite being separate files and
events. (§2.6, §5.6)

## E. Config

**E1. Avoid both config extremes — hand-copied constants and a monolithic shared file.** Python's drift
(four sets, A–D in `audit/services.md` §4) comes from the same label idea typed by hand in scattered places.
C++ cures that with one `hiero-automation.json` — but that single file is then read by nine of ten
services, and its schema lets any service read any key, so the config becomes a dependency everything
shares in full. (§2.4, §5.7)
