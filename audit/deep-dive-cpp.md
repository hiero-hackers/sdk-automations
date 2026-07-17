# Per-Service Deep Dive: Hiero C++ SDK

> **What this document is for.** The earlier audit files described the C++ maintainer automation from the
> outside: what each service is, which labels it touches, and how the services depend on one another. This
> document goes one level deeper and asks a practical question about each service, the same question the
> wider project cares about. For every service group it asks three things in plain terms: what is the real
> value a maintainer would miss if the service were gone, what actually ties that service to its neighbours
> so that you cannot simply switch it off on its own, and whether it could stand as an independent feature
> that runs on the shared config and a read of the shared status labels. It builds directly on
> `audit/services-cpp.md` (the service inventory), `audit/labels-cpp.md` (the label state machines), and
> `audit/coupling-cpp.md` (the coupling map), and it serves the first project goal: that every capability
> should be an independent feature a repo can turn on, turn off, or dial up on its own.
>
> **Where the facts come from.** Everything here is read against `main` at commit `a898153`, the same commit
> the earlier phases read. On 2026-07-11 the C++ repository was checked again: `main` has not moved off
> `a898153`, and no commit has touched the automation code, the workflow files, or the config file since the
> audit, so every citation below points at code that is still live today.
>
> **What is description and what is hypothesis.** The reading of each service's value and of what couples it
> is description: it records what the code does now. The reading of whether a service could stand alone is an
> assessment of the code as it is written. Where that assessment goes on to say what an independent version
> would need, that is a hypothesis offered to `design/architecture.md`, not a design decision taken here. This
> document does not propose a target architecture, a split, a minimum viable product, or a toggle config.
> Those are separate decisions for the planning stage.
>
> **What is left out.** Only maintainer automation is in scope. The build, test, and lint workflows are a
> project non-goal and were already shown to touch none of the shared state, so they are not covered.
> Group 6 (notifications) has no C++ implementation at all, and the repository-hygiene half of Group 7 sits
> next to CI and is out of scope. Both are noted where they would fall and then set aside.

## 1. How to read each group

The service groups are the seven laid out in `audit/services.md`. Six of them have a C++ implementation, and
those six are covered here: intake, assignment, PR quality and review, lifecycle, progression, and the
admin dispatcher. Each one is read the same way, through three questions written out as plain paragraphs.

The first question is about value. Rather than list everything a service does, it names the one outcome the
service exists for, the part that would actually be missed. The second question is about coupling. A service
is coupled to another when the two share something: a label they both read and write, a comment one writes
and the other reads, a config file they both depend on, a link between an issue and a PR that one of them
follows, or simply the same workflow file. That shared thing is what stops you from moving or disabling one
service without thinking about the other, and it is drawn from the six shared channels mapped in
`audit/coupling-cpp.md`. The third question is about independence: given only the shared config and a read
of the shared status labels, could the service run on its own, and if not, what small change would let it.

It helps to keep three different senses of "independent" apart, because a service can have one and lack the
others. A service has independent logic when its own code is self-contained. It has independent state when
it still does useful work without relying on state that some other feature created. And it has independent
deployment when it is its own unit that can be switched on or off without editing a file that other features
also live in. The C++ services score well on the first sense and poorly on the other two, and that gap is
the theme this document keeps returning to. The verdicts use the same three words as the coupling map:
**separable** means the service runs on its own with only the shared config, **soft-coupled** means it
shares state with others but does not strictly need them to function, and **hard-coupled** means it cannot
run, move, or be switched off without another service or a file edit.

## 2. The groups

### Group 1: Intake, the `/finalize` command

**The core value.** `/finalize` is the command a triager runs once a new issue has been sorted, and its job
is to turn that raw issue into a work item the rest of the system can act on. Before it changes anything it
checks that the triager has set the four things it depends on: exactly one skill label, exactly one priority
label, a native GitHub issue type, and the `status: awaiting triage` label. Those validation checks live in
`commands/finalize.js:99-102,133,167`. Once they pass, it rewrites the issue title with the correct skill
prefix, prepends the skill boilerplate and the standard guide sections to the body, and promotes the issue
from `status: awaiting triage` to `status: ready for dev`. The single thing a maintainer would miss if it
were gone is that promotion, together with the one-time tidy-up of the title and body, done only by someone
with triage permission.

**What couples it.** Most of what ties `/finalize` to the other services is what happens to its output.
`/finalize` is the only service that produces `status: ready for dev` out of triage, and the only service
that consumes that label into actual work is `/assign`. So `/finalize` on its own produces a label that
means nothing unless `/assign` is also present to pick it up. Beyond that, it shares a single workflow file,
`on-comment.yaml`, with `/assign` and `/unassign`: all three commands sit behind one dispatcher and one
block of permissions, so none of them can be disabled without a code change. It also reads more of the
config than any other single command (the status labels, the skill labels and hierarchy, the documentation
links, the Discord community link, and the team slugs), and it depends on one thing that is not a label at
all, the native issue type set by the issue template, which is why an issue with no type set will fail its
check.

**Could it stand alone?** Its own logic is self-contained, so it would run by itself. What it lacks is
independent state, because its output is inert without a consumer, and independent deployment, because it
lives in the shared dispatcher file. The verdict is soft-coupled. As a hypothesis for the planning stage,
the dependency on `/assign` is not really a dependency in code, it is a dependency on a shared label being
picked up by someone. If the status labels were owned by a shared core that any feature could write to,
`/finalize` could stand alone and simply hand the item off to whatever consumer happened to be turned on.

### Group 2: Assignment and the skill ladder, the `/assign` and `/unassign` commands

**The core value.** This group lets contributors claim and release work themselves, with eligibility
enforced so that self-serve does not become a free-for-all. `/assign` lets a contributor take an unassigned
`status: ready for dev` issue as long as they clear a set of gates in order: the issue has no assignee yet
(`commands/assign.js:257`), it carries the `status: ready for dev` label (`commands/assign.js:275`), the
contributor is under the open-assignment limit and the good-first-issue completion cap, and they meet the
skill prerequisites (`checkPrerequisites` at `commands/assign.js:97`). It then moves the issue from
`status: ready for dev` to `status: in progress` and assigns the contributor. `/unassign` is the mirror
image: the current assignee steps off, and the issue returns to `status: ready for dev`
(`commands/unassign.js`). The value maintainers want is the gated self-serve claim; the skill ladder and the
limits are what make it safe to expose to the public.

**What couples it.** `/assign` is the busiest junction in the whole issue side of the system, and three
things tie it down. First, it cannot work without something upstream producing `status: ready for dev`,
which is `/finalize`, `/unassign`, or the inactivity reaper; turn all of those off and `/assign` has nothing
to act on, and turn `/assign` off and issues pile up at `ready for dev` with nothing to move them along.
Second, an assignee and a status label move together as if they were one piece of state: `/assign` adds the
assignee and sets `in progress`, while `/unassign` and the reaper remove the assignee and reset to
`ready for dev`, so whoever owns one has to keep the other in step. The shared write helpers are
`addAssignees` at `helpers/api.js:166` and `removeAssignees` at `helpers/api.js:197`. Third, `/assign`
reaches across from the issue to its linked PR: when a contributor is at their assignment limit, it lets
them past only if every issue they already hold has a matching `status: needs review` PR, which it works out
by following the link with a GraphQL query (`hasNeedsReviewPR` at `helpers/api.js:1033-1100`, called from
`commands/assign.js:391`). So the assignment count quietly depends on the state of PRs. Both commands also
share the `on-comment.yaml` dispatcher.

**Could it stand alone?** `/unassign` is close to independent and is soft-coupled: its logic is
self-contained, the only state it writes is the `in progress` back to `ready for dev` step that `/assign`
and the reaper also use, and it shares the dispatcher file. `/assign` is hard-coupled: it is the hub, it
needs an upstream producer for the label it reads, and its limit bypass looks into PR state. As a hypothesis,
`/unassign` could be a standalone unit today given a shared way to write status labels, and `/assign` could
too if the `ready for dev` label were owned by a shared core, so that "is this item available" became a
question the core answers rather than a handoff from a named sibling, and if the limit bypass were written
as a declared read of the linked PR rather than a query buried in the handler.

### Group 3: PR quality and review

This group has four services: PR Open Checks, PR Update Checks, the PR Review Applicator, and the Sibling
Conflict Re-check.

**The core value.** The group tells a PR author and the maintainers, in one place, whether a PR is in good
enough shape to merge, and moves the PR between two review states to match. PR Open Checks does the heavy
lifting: it runs the four checks (sign-off, GPG signature, merge conflict, and a linked issue), writes them
all into a single dashboard comment marked `<!-- bot:pr-helper -->` (the marker is defined at
`helpers/comments.js:11`), and sets either `status: needs review` or `status: needs revision`. PR Update
Checks re-runs when the PR is pushed to or its body is edited, and swaps the label, but only if one of the
two is already set. The PR Review Applicator sets `status: needs revision` when a reviewer asks for changes.
The Sibling Conflict Re-check looks at the other open PRs after one PR merges, in case the merge introduced
or cleared a conflict. The roughly eighty percent of the value here is PR Open Checks: the dashboard and that
first status label are what maintainers actually want, and the other three services are refinements on top
of that starting state.

**What couples it.** This group is the clearest example in the codebase of services sharing state through
text rather than through a clean interface. The Sibling Conflict Re-check decides whether a neighbouring PR's
conflict status has changed by reading the dashboard comment that PR Open and PR Update wrote and checking
whether its body contains the exact string `:x: **Merge Conflicts**` (the check is
`existingComment.body.includes(':x: **Merge Conflicts**')` in `bot-on-pr-merged.js`, and that string is
produced by `buildMergeSection` at `helpers/comments.js:90`). If the wording of that line ever changes, the
re-check quietly stops working, with no error. There is also a producer-and-consumer chain in how the labels
are written: PR Open and the Review Applicator force their label on even when the opposite is absent, while
PR Update and Sibling Conflict only act when a label is already present, so those two do nothing on a PR that
PR Open never labelled. The Review Applicator is really one feature spread across two workflow files for a
security reason (a review from a fork must not run with a write token), and the two files are joined only by
an exact name string: `on-pr-review.yaml` is named `Bot - On PR Review` (line 1) and saves the review as an
artifact (line 33), and `on-pr-review-labels.yaml` listens for that exact workflow name (line 5). Rename one
without the other and the relay silently breaks. On top of that, three separate workflow files (`on-pr.yaml`
line 26, `on-pr-update.yaml` line 24, and `on-pr-review.yaml` line 17) share one concurrency group,
`pr-bot-<pr number>`, so their runs for a single PR queue up behind each other even though they are separate
files. Finally, the Sibling Conflict Re-check shares the `on-pr-close.yaml` file with the post-merge service
(the two jobs are at lines 16 and 42, both gated on the PR having merged at lines 18 and 44).

**Could it stand alone?** PR Open Checks is the separable producer of the group and is soft-coupled: it
writes the dashboard and the first label that everything else builds on, and shares only the concurrency
group. The other three are hard-coupled, because PR Update only swaps a label that is already there, the
Review Applicator is one feature stretched across two relay files, and Sibling Conflict both reads the
dashboard text and lives in the merge file. As a hypothesis, the whole group could collapse into a single
independent PR-quality feature if the dashboard were a structured record that services read as data rather
than a comment they scan for a substring, and if the review relay were treated as one unit whose two halves
keep their names in step by construction instead of by two strings someone has to remember to match.

### Group 4: Lifecycle and inactivity, the reaper

**The core value.** The inactivity reaper stops the pool of available work from quietly filling up with
claims that were never finished. It scans open assigned issues and open PRs, and after five days of no
activity it posts a warning comment marked `<!-- bot:inactivity-warning -->`. If nothing changes, then after
seven days it acts: it closes the PR or unassigns the issue, clears the status, and resets the item back to
`status: ready for dev` so someone else can take it (the reset logic is `resetItem` at
`bot-inactivity.js:402-416`, called at `bot-inactivity.js:471`). The value is exactly that: reclaiming
stalled work, but with a grace period and a warning first. It is one of only two services that can undo
someone's work, and the only one that gives fair warning before it does.

**What couples it.** The reaper's reset is broader than it looks. When it clears an item's status it removes
every label whose name begins with `status:`, not just the six the config knows about
(`bot-inactivity.js:411` filters on `name.startsWith("status:")`), and then re-adds `ready for dev`, but only
for issues, not PRs (`bot-inactivity.js:416`, guarded at `bot-inactivity.js:471`). Because it strips the
whole namespace, it will also delete unmanaged status labels a maintainer set by hand, such as
`status: needs info` or `status: awaiting merge`, which is the one genuine data-loss risk the label audit
recorded. The reaper also only does useful work on state that other services created: it reads
`status: blocked`, `status: needs review`, `status: needs revision`, `status: in progress`, and the assignee
list, all of which are set by the assignment and PR services. And like the post-merge service, it reaches
across the PR-to-issue link and resets the other side: when it closes a PR for inactivity it also resets that
PR's linked open issues (`bot-inactivity.js:668`). One detail worth flagging is that it resolves that link a
different way from the merge and assign paths, using a text search of the body rather than the GraphQL query
the others use, so the two ways of answering "what is linked to what" can disagree.

**Could it stand alone?** The reaper is soft-coupled. It owns its own workflow file and its own comment
markers, so it is separable in terms of deployment, and its logic is self-contained. What it lacks is
independent state: it reads status and assignee state other features set, and its namespace-wide strip and
its cross-entity reset both write beyond its own feature. As a hypothesis, an independent reaper would need a
narrower reset that only touches the known managed status labels rather than the whole prefix, and a single
shared way of resolving the issue-to-PR link, so that reclaiming one stalled item does not quietly change
labels or linked issues that no feature declared it owns.

### Group 5: Recommendation and progression, the post-merge service

**The core value.** When a PR merges, this service closes the loop: it clears the merged item's status
labels, and then it points the contributor at their next issue and congratulates them if they have levelled
up. In detail, it strips all status labels from the merged PR and its linked issues, assigns the latest open
milestone to the linked issues, works out the contributor's eligible skill level from the prerequisites and
their closed-issue history, and posts up to five `status: ready for dev` recommendations sorted by priority
(the handler is `bot-on-pr-close.js`, with the recommendation engine in `bot/bot-recommend-issues.js`). The
value maintainers point to is the recommendation and the level-up moment, which is what makes contributor
progression feel real; the label cleanup and the milestone are the housekeeping around it.

**What couples it.** The main issue is that three separate concerns share a single path with one exit that
gates the others. The milestone step returns false when there is no open milestone
(`bot-on-pr-close.js:54-56`), and when it does, the whole handler exits early
(`bot-on-pr-close.js:104-107`), which means a repo that simply has no open milestone gets no recommendation
either, even though the two have nothing to do with each other. The service also strips status labels across
the link, using the same whole-namespace prefix removal as the reaper (`removeStatusLabels` at
`bot-on-pr-close.js:40-41`, run on the PR at line 51 and on each linked issue at line 68). And the
recommendation depends on the assignment side of the system to have candidates: it looks for issues that are
both `status: ready for dev` and unassigned (`bot/bot-recommend-issues.js:80`). Finally, its workflow job
shares the `on-pr-close.yaml` file with the Sibling Conflict Re-check, both triggered by the same merge
event, which is the only GitHub event in the whole system that fires two different services at once.

**Could it stand alone?** The service is hard-coupled, because three concerns sit in one path behind a
shared early exit and the job is bundled with an unrelated service in one file. As a hypothesis, the
recommendation is the part most ready to be pulled out on its own: given a read of the shared status labels
and the skill ladder from config, it could run as its own feature on the merge event. What stands in the way
is the milestone check that currently gates it and the fact that it shares a file, and both of those are
choices about how the code is arranged rather than real dependencies on shared data.

### Group 7: Admin, the slash-command dispatcher

The other half of Group 7, the repository-hygiene checks for broken links and test-file naming, sits next to
CI and is out of scope, so this covers the dispatcher only.

**The core value.** The dispatcher is the single front door for comment commands. It reads a comment,
matches `/assign`, `/unassign`, or `/finalize` (case-insensitive and exact, with a helpful correction for
near-misses), and hands off to the right command, all serialised per issue so that two people acting on the
same issue at once cannot race each other (`bot-on-comment.js`). The value is that one shared parser and the
per-issue serialisation that keeps concurrent commands from colliding.

**What couples it.** The dispatcher is itself the thing that couples the intake and assignment commands at
the deployment level. All three commands live behind its one file, one permissions block, and one
concurrency group, so none of them can be switched off without a code change or an added guard. This is
coupling by design rather than by accident: the commands are already cleanly separated as modules in
`commands/{assign,unassign,finalize}.js`, but they are fused together at the workflow layer.

**Could it stand alone?** It is hard-coupled, because it is the single entry point for three commands. As a
hypothesis, since the command modules are already independent in code, what fuses them is only this one file;
an independent per-command design would route each command to its own switchable unit while still keeping one
shared parser and the per-issue serialisation, so that pulling the commands apart does not lose the guarantee
that keeps them from racing.

## 3. What the six groups have in common

Reading the six groups side by side, almost all of the coupling comes from the same four sources, and none
of them is untidy code.

The first and deepest is that the status labels are shared, moving state that no single service owns. Every
group reads or writes them, two services strip the whole namespace at once, and `status: ready for dev` in
particular is passed like a baton between `/finalize`, `/assign`, `/unassign`, the reaper, and the
recommendation. Whether a work item is available to be picked up is a shared label, not a fact any one
feature holds, and that is the hardest thing to pull apart.

The second is that services follow the link between an issue and its PR and write to the other side. Both
the post-merge service and the reaper change issue state from a PR event, and they resolve the link in two
different ways that can disagree, so the issue side and the PR side of the lifecycle cannot be taken
independently as things stand.

The third is that some services communicate through rendered text and exact names rather than through a real
contract. The Sibling Conflict Re-check reads a substring of a comment, and the review relay is held together
by an exact workflow name. Both of these are the kind of seam that breaks silently: change the wording or the
name and nothing throws an error, the behaviour just stops.

The fourth is that the deployment units bundle unrelated features together. One file holds all three slash
commands, another holds both the recommendation and the sibling re-check, and a shared concurrency group
lines up three separate files behind one another. Because of this, turning a single feature off is a code or
YAML edit rather than a setting.

The thing worth holding on to, which the audit already noted, is that the handlers themselves are clean:
they share one set of helpers, hard-code no label strings, and read one config file, which is why the C++
labels have no drift at all. What blocks turning features on and off one at a time is not the code; it is the
shared moving state sitting above the code and the shared files sitting under it.

## 4. What an independent feature would need (a hypothesis)

This last section is offered to `design/architecture.md` as a hypothesis, not decided here. If the question the
project keeps asking is whether each service could become a feature that runs on the shared config and a read
of the shared status labels, then the deep dive suggests a feature would need four things, one to answer each
of the four shared sources above.

It would need to declare the small slice of config it actually uses. The audit showed that although every
service can read the whole config file, the reads in practice are concentrated: the status labels and the
team slugs are read almost everywhere, while the skill ladder, the limits, the priority order, and the
community link are each read by only one or two services. So a feature could carry just the keys it needs
without taking on the entire file.

It would need to read and write the status labels through a shared core rather than each handler owning the
namespace itself. That removes the baton problem, because availability becomes something the core reports
rather than a handoff from a named sibling, and it removes the strip risk, because the core knows which
status labels are managed and a reset cannot delete ones that are not.

It would need to make its cross-entity reads explicit and go through one shared resolver. A feature that
touches the linked issue from a PR event would say so plainly and use the single resolver everyone uses, so
the two ways of following the link cannot disagree and a maintainer can see at a glance which lifecycles a
feature reaches into.

And it would need to be its own deployment unit, not sharing a file, a relay name, or a concurrency group
with an unrelated feature by accident, so that turning it on or off is a setting rather than an edit.

These four line up one to one with the four shared sources in the previous section. Whether the shared core,
the resolver, and the per-feature packaging are the right shape to build is exactly what the planning stage
is for. All this document sets out to do is show, service by service, where the current design already sits
in relation to that first goal.

## Appendix A: the services at a glance

| Group | Service | The value it exists for | Verdict | What mainly couples it |
|---|---|---|---|---|
| 1. Intake | `/finalize` | validate a triaged issue and promote it to `ready for dev`, tidying title and body | soft-coupled | its output label, and the shared dispatcher file |
| 2. Assignment | `/assign` | a gated self-serve claim, moving an issue to `in progress` | hard-coupled | it is the hub of the status labels, and it reads PR state |
| 2. Assignment | `/unassign` | a self-serve release back to `ready for dev` | soft-coupled | assignee and status label move together |
| 3. PR quality | PR Open Checks | the dashboard and the first status label | soft-coupled | the dashboard comment, and the shared concurrency group |
| 3. PR quality | PR Update Checks | refine the status on a push or an edit | hard-coupled | it only swaps a label PR Open already set |
| 3. PR quality | PR Review Applicator | set `needs revision` when changes are requested | hard-coupled | one feature across two files joined by a name string |
| 3. PR quality | Sibling Conflict Re-check | re-check other PRs after a merge | hard-coupled | it reads the dashboard text and shares the merge file |
| 4. Lifecycle | Inactivity Reaper | warn, then reclaim stalled work | soft-coupled | a whole-namespace status strip and a cross-link reset |
| 5. Progression | Post-Merge service | recommend the next issue and mark a level-up | hard-coupled | three concerns in one path, and a shared file |
| 7. Admin | Slash dispatcher | one parser for three commands, serialised per issue | hard-coupled | it is the single front door for three features |

## Appendix B: where each fact lives in the code

All references are against `hiero-ledger/hiero-sdk-cpp` at `a898153`, under `.github/`, and were checked
against live `main` on 2026-07-11, which is unchanged since the audit.

- The `/finalize` validation checks are at `commands/finalize.js:99-102,133,167`, and its dependence on the
  native issue type is documented in `audit/labels-cpp.md`.
- The `/assign` gates are the no-assignee check at `commands/assign.js:257`, the ready-for-dev check at
  `commands/assign.js:275`, the limit bypass at `commands/assign.js:391` (which calls `hasNeedsReviewPR` at
  `helpers/api.js:1033-1100`), the fresh-fetch race guard at `commands/assign.js:333-348`, and
  `checkPrerequisites` at `commands/assign.js:97`.
- Assignees are written through `addAssignees` at `helpers/api.js:166` and `removeAssignees` at
  `helpers/api.js:197`.
- The dashboard comment's marker is defined at `helpers/comments.js:11`, its merge-conflict line at
  `helpers/comments.js:90`, and the cross-read of that line is
  `existingComment.body.includes(':x: **Merge Conflicts**')` in `bot-on-pr-merged.js`.
- The whole-namespace status strips are the post-merge `removeStatusLabels` at `bot-on-pr-close.js:40-41`
  (applied at lines 51 and 68) and the reaper's `resetItem` filter at `bot-inactivity.js:411`, its re-add at
  `bot-inactivity.js:416`, its PR-versus-issue guard at `bot-inactivity.js:471`, and its linked-issue reset
  at `bot-inactivity.js:668`.
- The milestone early exit that gates recommendation is the false return at `bot-on-pr-close.js:54-56` and
  the handler exit at `bot-on-pr-close.js:104-107`.
- The recommendation's candidate query is at `bot/bot-recommend-issues.js:80`.
- The review relay is the producer name at `on-pr-review.yaml:1`, its artifact at `on-pr-review.yaml:33`, and
  the consumer's listen at `on-pr-review-labels.yaml:5`.
- The shared concurrency group is at `on-pr.yaml:26`, `on-pr-update.yaml:24`, and `on-pr-review.yaml:17`.
- The two jobs sharing the merge file are at `on-pr-close.yaml:16` and `on-pr-close.yaml:42`, both gated at
  `on-pr-close.yaml:18` and `on-pr-close.yaml:44`.
