# Cross-SDK Service and Label Architecture

> **Phase 2 synthesis:** a cross-SDK view of the maintainer automation. It covers what each SDK offers,
> how the services group together, how an issue or PR moves through them, and a normalized view of the
> labels that already exist across both SDKs. It draws on the four Phase 1 and Phase 2 audit files and
> lines up with `planning/goals.md` (decoupled by function, config-driven, opt-in).
>
> **This is descriptive, not prescriptive.** It records what the two existing systems do today. What the
> shared app should build, and what labels should mean, are goals questions decided separately (see the
> open questions at the end of section 4), not proposals made here.
>
> **Scope:** maintainer automation only. CI, build, release, and security are a project non-goal, so they
> appear only in Appendix Z.

## 1. The service groups, from the top down

Both SDKs solve the same broad set of problems in very different ways. C++ is a hub and spoke off one
config file; Python is roughly 40 small, focused workflows. Grouped by what each service does rather than
how it is built, the whole surface falls into seven groups.

```mermaid
flowchart TB
    subgraph INTAKE["1. Triage and Intake"]
        A1[New-issue moderation and lock]
        A2[Triage finalize]
        A3[Triage review request]
        A4[GFI-candidate notify]
    end
    subgraph ASSIGN["2. Assignment and Skill Ladder"]
        B1[/assign self-serve/]
        B2[/unassign/]
        B3[Skill prerequisite gates]
        B4[Assignment-limit enforcement]
        B5[Reviewer to assignee]
        B6[Mentor rotation]
    end
    subgraph PRREV["3. PR Quality and Review"]
        C1[PR checks: DCO, GPG, conflict, link]
        C2[Review to status labeling]
        C3[Review-queue state machine]
        C4[Linked-issue sync and enforce]
        C5[Sibling-conflict recheck]
    end
    subgraph LIFE["4. Lifecycle and Inactivity"]
        D1[Inactivity reaper, warn then close]
        D2[Activity ping /working/]
        D3[Inactivity reminders]
    end
    subgraph PROG["5. Recommendation and Progression"]
        E1[Post-merge next-issue recommend]
        E2[Level-up detection]
        E3[Milestone assignment]
    end
    subgraph NOTIFY["6. Notifications"]
        F1[P0 and critical alert]
        F2[Community and office-hours]
        F3[Workflow-failure feedback]
        F4[CodeRabbit AI triggers]
    end
    subgraph ADMIN["7. Admin and Hygiene"]
        G1[Spam-list maintenance]
        G2[Repo-hygiene checks]
    end
```

The repo-hygiene checks (broken links, test-file naming) sit close to CI and are deprioritized per the
maintainer's steer.

## 2. The same capabilities, compared across both SDKs

Each row is one capability. The marks show which SDK has it.
🟢 both · 🔵 C++ only · 🟣 Python only · ⚪ retired.

| Group | Capability | C++ | Python | Status | Notes |
|---|---|:--:|:--:|:--:|---|
| 1. Intake | New-issue moderation and lock until approved | | ✅ | 🟣 | `moderate-new-issues` plus `approved-issues` |
| 1. Intake | Triage finalize (`/finalize`: validate, retitle, promote) | ✅ | | 🔵 | validated against the central config |
| 1. Intake | Triage review request (ping the triage team on a PR) | | ✅ | 🟣 | `request-triage-review` |
| 1. Intake | GFI-candidate notification | | ✅ | 🟣 | `bot-gfi-candidate-notification` |
| 2. Assign | Self-serve `/assign` with eligibility gates | ✅ | ✅ | 🟢 | C++ uses central limits; Python uses per-tier handlers plus the spam list |
| 2. Assign | `/unassign` | ✅ | ✅ | 🟢 | C++ reverts the status label; Python is assignee-only |
| 2. Assign | Skill-ladder prerequisite gating | ✅ | ✅ | 🟢 | C++ uses `skillPrerequisites` (beginner needs 2 closed GFI, intermediate 3 closed beginner, advanced 3 closed intermediate); the same skill label also drives the GFI cap and the `/finalize` title and body rewrite, so it is far more than a recommendation hint; Python uses the advanced and intermediate guards, which unassign on a fail |
| 2. Assign | Assignment-limit enforcement | ✅ | ✅ | 🟢 | C++ uses `maxOpenAssignments` and `maxGfiCompletions`; Python uses spam-list caps |
| 2. Assign | Reviewer becomes PR assignee | | ✅ | 🟣 | `on-review` |
| 2. Assign | Mentor rotation on assignment | | ✅ | 🟣 | chained inside the GFI handler, via `mentor_roster.json` |
| 3. PR | PR quality checks (DCO, GPG, conflict, issue-link) plus a dashboard | ✅ | partial | 🟢 | C++ has a unified dashboard; Python only enforces the linked issue, by closing the PR |
| 3. PR | Auto-assign the PR author | ✅ | | 🔵 | part of PR Open Checks |
| 3. PR | Review result becomes a status label | ✅ | | 🔵 | the fork-safe relay sets `needs revision` |
| 3. PR | Review-queue state machine (`queue:*`) | | ✅ | 🟣 | `review-sync` on a `*/30` cron |
| 3. PR | Linked-issue label sync (issue and PR) | | ✅ | 🟣 | the fork-safe relay, additive only |
| 3. PR | Linked-issue enforcement (close PRs with no linked issue) | | ✅ | 🟣 | C++ checks and labels for this but never closes |
| 3. PR | Sibling-conflict recheck on merge | ✅ | | 🔵 | re-evaluates the other open PRs |
| 4. Life | Inactivity reaper (warn, then close or unassign) | ✅ | ✅ | 🟢 | C++ warns at 5 days and acts at 7; Python acts at 21 days with no warning |
| 4. Life | Activity ping `/working` (resets the timer) | | ✅ | 🟣 | read by the reaper and the reminder |
| 4. Life | Inactivity reminders (issue with no PR, inactive PR) | | ✅ | 🟣 | comment-only, a step before unassigning |
| 5. Prog | Post-merge next-issue recommendation | ✅ | ✅ | 🟢 | both walk a skill ladder |
| 5. Prog | Level-up detection and congratulation | ✅ | ✅ | 🟢 | |
| 5. Prog | Milestone assignment on merge | ✅ | | 🔵 | on the linked issues or the PR |
| 6. Notify | P0 or critical issue alert | | ✅ | 🟣 | on `priority: critical` |
| 6. Notify | Community and office-hours reminders | | ✅ | 🟣 | fortnightly crons |
| 6. Notify | Workflow-failure feedback on a PR | | ✅ | 🟣 | reacts to 7 named CI checks; a notification service, not CI itself; matches the 7 by exact workflow-name string, so a rename silently breaks it |
| 6. Notify | CodeRabbit AI plan and review triggers | | ✅ | 🟣 | matches the goals.md idea that AI should be complementary |
| 7. Admin | Spam-list maintenance | | ✅ | 🟣 | hourly cron plus a tracking issue |
| 7. Admin | Slash-command dispatcher (one shared parser) | ✅ | | 🔵 | architectural; Python dispatches per workflow instead |
| 7. Admin | Repo-hygiene checks (broken links, test naming) | | ✅ | 🟣 | close to CI, so deprioritized |
| Retired | Merge-conflict bot, auto-draft, draft explainer and reminder, missing or unassigned linked issue, verified commits, conventional title, standalone GFI-notify and mentor | | archived | ⚪ | the 10 files in Python's `workflows/archive/` |

How to read the table. The 🟢 rows (assignment, `/unassign`, skill gating, limit enforcement, inactivity
reaping, recommendation) are the common core: both SDKs implement them and differ only in policy and
shape. The 🔵 and 🟣 rows exist in just one SDK. The ⚪ rows are retired in Python.

## 3. The end-to-end maintainer-automation flow

This is how a contribution moves through the services from start to finish. The journey is shared, but each
SDK fills in different stops along the way. C++ is `▣`, Python is `◆`, and both is `●`.

```mermaid
flowchart TD
    O((Issue opened)) --> MOD["◆ Moderate and lock (pending-review)"]
    MOD --> APPR["◆ Approve, then unlock"]
    APPR --> TRI["▣ /finalize: validate and promote\n(awaiting triage to ready for dev)"]
    TRI --> POOL{{ready for dev pool}}
    O -. "C++ has no moderation step" .-> TRI
    POOL --> ASSIGN["● /assign: eligibility, skill ladder, limits\n(ready for dev to in progress)"]
    ASSIGN --> WORK["● Contributor works\n◆ /working resets the inactivity timer"]
    WORK -->|stalls| REAP["● Inactivity reaper\n▣ warn at 5 days, close at 7   ◆ 21 days, no warning\nunassign and reset the status"]
    REAP --> POOL
    WORK --> PR((PR opened))
    PR --> CHECK["▣ PR checks set needs review or needs revision\n◆ linked-issue enforcement closes a PR with no issue"]
    CHECK --> QUEUE["◆ Review-queue sync\njunior to committers to maintainers to ready-to-merge"]
    CHECK --> REVIEW["▣ Review submitted sets needs revision\n◆ reviewer becomes assignee"]
    REVIEW --> QUEUE
    QUEUE --> MERGE((PR merged))
    MERGE --> CLEAN["▣ Strip status:* and assign a milestone (C++)\n◆ Python: merged PRs simply drop out of the queue sync"]
    CLEAN --> RECO["● Recommend the next issue and check for a level-up"]
    RECO --> POOL
```

The label-level state machines behind these stops are written up in `audit/labels-cpp.md` (the issue and
PR `status:` machines) and `audit/labels-python.md` (the moderation and review-queue machines). How these
services depend on each other through shared state (labels, comments, assignees, config, cross-entity
links, and shared workflow files), and where that coupling sits, is mapped in `audit/coupling-cpp.md`.

## 4. A normalized view of the labels that exist today

This lines up the label strings that already exist across the two SDKs so the same idea sits in one row.
It is a summary and a check-in, **not a proposal**: it shows where the two agree and where they diverge
(including the four Python drift sets from `audit/labels-python.md`). What each namespace should ultimately
do is an open question, listed below.

| Namespace | Values across both SDKs | Where the two SDKs differ |
|---|---|---|
| `status:` (work lifecycle) | `awaiting triage`, `ready for dev`, `in progress`, `blocked`, `needs review`, `needs revision`, `ready-to-merge` | C++ owns the issue and PR status set; Python adds `status: ready-to-merge` (hyphenated) from its review queue |
| `skill:` (the ladder) | `good first issue`, `beginner`, `intermediate`, `advanced` | Python also has the bare `beginner` (drift C), the title-case `Good First Issue` (drift D), and `Good First Issue Candidate` |
| `priority:` | `critical`, `high`, `medium`, `low` | Python also carries `Priority: Critical` (drift B) |
| `queue:` (review routing) | `junior-committer`, `committers`, `maintainers` | Python-only |
| `notes:` (bookkeeping) | `automated`, `spam`, `spam-list-update`, `broken markdown links`, `mentor-duty` | Python-only, mostly inline literals |
| `lifecycle:` (intake gate) | `pending-review`, `approved` | Python-only |
| `meta:` | `open to community review`, `discussion` | Python-only |

The four drift sets, and where the two spellings diverge:

| Drift | What exists today | Where they differ |
|---|---|---|
| A | `Good First Issue Candidate` and `good first issue candidate` | constant and template vs the workflow gate's casing; `contains()` matches either |
| B | `priority: critical` and `Priority: Critical` | two casings, both accepted via `||` |
| C | `skill: beginner` and bare `beginner` | namespaced vs bare, in one triage branch |
| D | shared `GOOD_FIRST_ISSUE_LABEL` and a hand-typed copy | defined once vs duplicated inline |

The contrast worth noting: C++ has one config file and never types a label by hand, so it has zero drift;
Python's drift comes from the same idea being written in scattered places. That difference is the finding.

**Open questions for a labels goals.md** (for maintainers to decide, not answered here): which
classifications should be GitHub native tags or fields rather than labels (`priority` already is one,
`effort` may follow); whether `status:` and the `lifecycle:` intake gate should be one namespace; whether
`notes:` and `meta:` should be one; and what each label should do for maintainers (drive automation,
signal to humans, or both).

## 5. Capabilities common across both SDKs (a summary)

Reading section 2 by what the two SDKs already share, the recurring capabilities are:

- **Assignment and the skill ladder** (🟢): `/assign`, `/unassign`, prerequisite gates, limit enforcement.
- **Inactivity reaping** (🟢): C++ warns then acts; Python acts at 21 days.
- **Post-merge recommendation and level-up** (🟢).
- **PR quality checks and review-to-status labeling** (🟢, 🔵): DCO, GPG, conflict, issue-link.
- **Intake and triage** (🔵, 🟣): `/finalize`, moderation and lock, triage review request.
- **Review-queue routing** (🟣): the `queue:*` state machine.
- **Linked-issue sync and enforcement** (🟣).
- **Notifications** (🟣): P0 alert, reminders, workflow-failure feedback, CodeRabbit AI hooks.
- **Admin** (🟣): spam-list maintenance, mentor rotation.

The repo-hygiene and CI-adjacent checks and the 10 retired Python workflows are noted only for
completeness; they sit outside the maintainer-automation surface.

## Appendix Z: out of scope (a non-goal)

CI, build, release, and security stay as native Actions per repo and are a project non-goal
(`goals.md`, Non-goals). In both SDKs these workflows were verified to touch no labels (see
`audit/labels-cpp.md` Appendix C and `audit/labels-python.md` Appendix D). They are left out of the
classification and flow work here.
