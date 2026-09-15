# The sweep — schedules become facts

> **The second producer of facts, and the only one that reads past the projection.** The sweep
> produces the fact shapes in `design/contracts/facts.md`: on a schedule it reads every open item of
> a repository, builds one record per item with every group an enabled capability needs read, and
> hands the engine one decision per record. The webhook producer reads the projection only; the
> sweep reads what the enabled capabilities declare, which is why the clock-driven ones need it.

## 1. What the sweep reads, and what is confirmed

| Fact | Read | Permission | Status in the matrix |
|---|---|---|---|
| open items, labels, state, assignees, `updated_at` | `GET /repos/{o}/{r}/issues` paged, `state=open` (pull requests included, flagged by `pull_request`) | Issues R | confirmed, ETag, link pagination |
| `assignedAt` per assignee | the item timeline's `assigned` events, newest per login | Issues R | confirmed (timeline) |
| `lastWorkingAt` per assignee | the item's comments whose body's first token folds to the repository's `working` command spelling, by author, newest | Issues R | confirmed (list comments) |
| a pull request's `draft` — the whole `readiness` group | `GET /repos/{o}/{r}/pulls/{n}` | Pull requests R | confirmed |
| `changesRequested` | `GET /pulls/{n}/reviews` folded to the latest DECIDING state per reviewer — the reader implements this, not GraphQL `reviewDecision` | Pull requests R | confirmed 2026-09-12 (6.9), ETag, 1 page |
| `reapableSince` | the timeline's `convert_to_draft` / `ready_for_review` / `review_requested` events and the newest `changes requested` review, whichever entered the current mode | Pull requests R, or Issues R — either alone answers the timeline on a pull-request number | confirmed 2026-09-12 (6.9), ETag |
| `lastCommitAt` | `GET /repos/{o}/{r}/pulls/{n}/commits`, last page | Pull requests R | confirmed 2026-09-12 (6.9), ETag, 1 page |
| a pull request's linked issues with their assignees | GraphQL `closingIssuesReferences` joined to the issues already listed, read for every LISTED pull request before the item walk — one aliased query per hundred (D194) | Issues R + Pull requests R | confirmed for same-repository links, batched shape confirmed 2026-09-15 |
| an issue's open linked pull requests | the inverse of the row above, built from that one read — no separate read, and no dependence on which items the walk reached | — | derived |

The App's own standing reminder is not a read any more: the platform holds its warning record
(`design/guides/grace.md` §4). `draft` left the `review` group for a `readiness` group of its own
once the study found that a webhook can read it whole. **Every read above is now confirmed**, so the
sweep answers every group its registry row promises AND an enabled capability needs, `review`
included (D195). The rule that put the three there has not changed: a read absent from the matrix is
never sent, and the driver answers its group `unread` rather than guessing.

## 2. What the driver does

1. A schedule row `sweep:{owner}/{repo}` is due. The shell claims it (the store's claim-token
   pattern), reads the repository's configuration through the config source, and if the
   repository enables no capability that declares `trigger: schedule`, completes the row and
   schedules the next.
2. It lists open items once (conditional reads; a 304 costs nothing) and drops the stored read of
   every item the list no longer carries. An item the list says is unchanged since its stored read
   is decided from that read: `updated_at` equal to the stored one, at least `REVIEW_SETTLE` (60 s)
   older than the list read, and read inside `SNAPSHOT_MAX_AGE` (24 h), with the same needed groups,
   every one of them answered (D193). It reads the links of every pull request that is not one of
   those and reverses them together with the stored ones, then for each item reads the
   groups above that an enabled capability needs (D195) through one adapter seam, `FactsReader` — a
   factory over the client and the repository, returning `IssueFacts` / `PullRequestFacts` with
   `trigger: { kind: "sweep" }`, and marking any read that failed, is unconfirmed, or nothing
   enabled needs as `unread` for that group rather than guessing. A record built from a stored read
   is built the same way, observed now, and every item actually read is written back.
3. It hands the engine one record at a time — `decide({ kind: "facts", facts })` — through the one
   box the webhook lane also calls, naming the schedule row as the cause rather than dressing a
   swept item as a delivery (D173), so reports, effects, the applier and recovery are unchanged.
4. It schedules the next sweep at the configured cadence (default hourly, because a clock the sweep
   cannot see is a promise the App cannot keep: `MIN_REAP_HOURS` is two hours, and a daily sweep
   would let a two-hour clock run a day before anyone was warned about it) and completes the row.
   One rule decides when: a firing that did not finish its list — cut short mid-list, or left
   untouched because the allowance was spent — is due at once; one that finished, and one that read
   nothing, take the cadence. Due rows are claimed oldest-`started_at` first (D192).

## 3. Cost

Per repository, per open item on a cold cache. The firing opens with the open-item list and the
links of every listed pull request, read before the item walk: one aliased query per hundred pull
requests, about one point (D194). An issue then costs its timeline page, and its comments page where
the repository maps a `working` spelling: two, or one without. A pull request costs five, in this order:
the timeline, the comments, the reviews, the pull request, the commits — four without `working`. The
timeline and the pull request are each read once an item and folded twice, so no group pays for a
page another group already asked for. At the fleet design point (fifty repositories, twenty open
items each) that is a thousand items an hour at the default cadence.

That is the cold price, and it is paid once. A firing over a list nothing has touched sends the list
pages and nothing else at all — not the item reads, not the aliased query — because every item is
decided from its stored read (D193). The store outlives the process, so a restart is warm too, which
the in-process ETag cache never was: it is bounded (a thousand entries, twenty megabytes), so a fleet
past a few hundred open items a repository evicted every entry between firings and paid for each read
again. The 304 stays what it is worth — free — for the list, the webhook lane and read-back; the
sweep's cost no longer rests on it. What a firing may spend is one
allowance for the process: `SWEEP_SHARE` of each pool's own `x-ratelimit-limit`, counted in GitHub's
units and over GitHub's window — a 304 nothing, a GraphQL query its reported points, a write one
request — with `SWEEP_WRITE_CALLS` as a per-tick lane on it and `CONTENT_CREATION_HOURLY` bounding
comment creation across both lanes (D192).

Measured (protocol 8.4, 2026-09-15, the sandbox's 171 open items): a cold firing charged 362
core requests and one GraphQL point in 141 seconds; the warm firing two minutes later charged
nothing on either pool, answered every item from the store, and took under two seconds.

## 4. What is still open

- Nothing on the read side. Protocol 6.9 cited `changesRequested`, `reapableSince` and
  `lastCommitAt` on 2026-09-12, so the `review` group is read and the pull-request ladder decides
  rather than being skipped by the `factsUnread` finding. The finding itself stays: it covers a read
  that FAILED, and any read a later group is built from that the matrix has not confirmed.
- The `pull_request_review` subscription question the matrix already records: the sweep does not
  need it, because it reads reviews rather than waiting to be told.
