# Endpoint and permission matrix

**Answer (Q16): the confirmed rows below are the adapter's operation list; the failure catalogue is
its error type.** A row without a citation is a guess and does not close the gate.

Status: `confirmed` observed in a run · `blocked` observed to fail, failure cited · `untested` ·
`probed, NOT adopted` measured in a run and deliberately not chosen. The last is evidence and not a
decision: it is NOT part of Q16's operation list, and nothing may be built on it until a decision
row chooses it.

## Operations

| Operation | Endpoint | Permission | Primary quota cost | Conditional-read support | Status | Citation |
|---|---|---|---|---|---|---|
| List issues (paged) | `GET /repos/{o}/{r}/issues` | Issues R | 1/call; 0 on 304 | ETag present; 304 confirmed free | confirmed incl. link-header pagination (157 items = 2 calls @ `per_page=100`); since 2026-09 GitHub paginates this list by cursor: `rel="next"` only, no `rel="last"`; plain `page=N` still works (8.3 rehearsal, 2026-09-12). **`updated_at` on a row moves for every sweep input** — labels, assignees, comments and their edits, body edits, review requests and removals, a push, a draft toggle, and a review, a comment review or a dismissal — but the review events reach the row late: the prior value four seconds after the write, the review's own instant ten to thirty seconds on (6.12). A pull request that comes to close an issue does not move the ISSUE's row | `2026-07-23T19-36-29-346Z#1–6`; `2026-09-15T15-18-19-663Z#9–121`, `2026-09-15T15-24-19-397Z#17–65` |
| Read issue | `GET /repos/{o}/{r}/issues/{n}` | Issues R | 1/call; 0 on 304 | ETag present; 304 confirmed free | confirmed. A DIFFERENT row from the list above, which cannot answer one issue. `assignees` arrives whole and unpaged — GitHub caps it at ten and returns them all on the item, so a page-walk would be a second call for a list that cannot have a second page | `2026-09-12T06-31-36-229Z#27` |
| Read issue timeline | `GET /repos/{o}/{r}/issues/{n}/timeline` | Issues R | 1/call | ETag present | confirmed; 80 events = 1 call, ~480 ms. **Answers a pull-request number too**, under Issues R or Pull requests R — either grant alone is enough (6.9), so the "Issues R" this row states is narrower than what it needs | `2026-07-23T19-38-17-272Z#13`; `2026-09-12T06-31-36-229Z#15` |
| Add label | `POST /repos/{o}/{r}/issues/{n}/labels` | Issues W | 1/call | — | confirmed (200) | `2026-07-23T18-58-46-782Z#2` |
| Remove label | `DELETE /repos/{o}/{r}/issues/{n}/labels/{name}` | Issues W | 1/call | — | confirmed (200) | `2026-07-23T18-58-46-782Z#3` |
| Create comment | `POST /repos/{o}/{r}/issues/{n}/comments` | Issues W | 1/call | — | confirmed (201); secondary limit at ~71 writes @ concurrency 20, no `retry-after` | `2026-07-23T19-37-00-198Z#15,19` |
| Update own comment | `PATCH /repos/{o}/{r}/issues/comments/{id}` | Issues W | 1/call | — | confirmed (200) | `2026-07-23T19-41-18-911Z#4` |
| Release one assignment | `DELETE /repos/{o}/{r}/issues/{n}/assignees` | Issues W | 1/call | — | confirmed (200), body `{ assignees: [login] }` — the one write that is a DELETE CARRYING A BODY, which is what takes one named login off and leaves the rest. Read-back is the item's `assignees` without that login, visible immediately and again at +2 s. **An assignment event names the assignee as its own actor**: `unassigned exploreriii by exploreriii` for an App-made release, identical to a human's, so nothing may read "a human reversed the App" off an assignment event's actor. Without the grant the 403 named `issues=write; pull_requests=write` | `2026-09-12T13-03-39-016Z#11`, `…#14` |
| List comments | `GET /repos/{o}/{r}/issues/{n}/comments` | Issues R | 1/call | ETag present | confirmed. Read-after-write (6.7): 25/25 first-read visible after create, median 299 ms, p95 462 ms, max 514 ms over forty trials on one repository, REST list reads only — typical behaviour, not a documented guarantee. The rule it decides: present on first sight; absent only after two reads at least one second apart (about twice the p95), because a wrong absent duplicates a non-idempotent write. Re-measure before any GraphQL or search-based read-back | `2026-07-23T19-41-18-911Z#2`; `2026-07-25T21-00-55-057Z#79` |
| Read PR | `GET /repos/{o}/{r}/pulls/{n}` | Pull requests R | 1/call | ETag present | confirmed incl. fork-sourced PR (head repo/sha exposed) | `2026-07-23T19-41-18-911Z#3`, `…T20-16-41-190Z#2` |
| Read linked issues | GraphQL `PullRequest.closingIssuesReferences(excludeUserLinked: true)` | Issues R + Pull requests R | 1/page | — | confirmed for same-repository references. Cross-repository results are unsafe: an invisible target returns a clean empty connection | `2026-08-29T20-51-00.386Z#same-repository,#cross-repository-outside-target`; repeat `2026-08-29T20-51-32.049Z` |
| Read linked issues, batched | GraphQL `repository { p0: pullRequest(number: $n0) { closingIssuesReferences(first: 100, excludeUserLinked: true) } … }` | Issues R + Pull requests R | 1 query; GraphQL charges by connections | — | confirmed (200). The shape is the row above's, aliased a hundred times over in one query — `p0…p99` against `$n0…$n99` — so the same-repository caution applies alias for alias | `2026-09-15T16-34-56-751Z#17` |
| List PR files | `GET /repos/{o}/{r}/pulls/{n}/files` | Pull requests R | 1/call | ETag present | confirmed on fork-sourced PR | `2026-07-23T20-16-41-190Z#7` |
| List PR reviews | `GET /repos/{o}/{r}/pulls/{n}/reviews` | Pull requests R | 1/call; 0 on 304 | ETag present; 304 confirmed free | confirmed; 1 page. `COMMENTED` reviews are present and are not a decision — the fold takes each reviewer's latest DECIDING state | `2026-09-12T06-31-36-229Z#10` |
| List PR commits | `GET /repos/{o}/{r}/pulls/{n}/commits` | Pull requests R | 1/call; 0 on 304 | ETag present; 304 confirmed free | confirmed; 1 page; two readers (last commit date, and `verification` + `Signed-off-by:` trailers). **`verification.verified` is true only for a SIGNED commit**: a commit authored through the contents API under a USER token comes back `reason: unsigned`, and only the GPG-signed push was verified. A design expecting API-authored commits to be verified is wrong for user tokens | `2026-09-12T06-31-36-229Z#19`, `…#23` |
| Create review | `POST /repos/{o}/{r}/pulls/{n}/reviews` | Pull requests W | 1/call | — | confirmed (REQUEST_CHANGES on fork-sourced PR); **no delivery observed** — App not subscribed to `pull_request_review` | `2026-07-23T20-16-41-190Z#6` |
| Close a pull request | `PATCH /repos/{o}/{r}/pulls/{n}` | Pull requests W | 1/call | — | confirmed (200), body `{ state: "closed" }`; unmerged, and the reason is not sent — GitHub is told the state only. Read-back is `state=closed` with `closed_at`, visible immediately and again at +2 s. **`closed_by` is ABSENT from the pull object**: the actor of a close is on the `closed` TIMELINE event (`closed by automation-experiment-3892384[bot]`), so authorship is read from the timeline and never from the item, and a read-back asking for `closed_by` would never confirm. Without the grant the 403 named `pull_requests=write` | `2026-09-12T13-03-39-016Z#7`, `…#14` |
| Read file (config) | `GET /repos/{o}/{r}/contents/{path}` | Contents R | 1/call | ETag present | confirmed incl. 404-as-absent and `ref` param. **Caution: serves fork-authored content at a PR head sha** (6.6) — config fetches must pin the default branch, never a PR-derived ref. A head-sha read is a REPORT INPUT only — parsed by the hardened document parser, rendered with the platform's escaping, and never the configuration anything is decided under (`configAtHead`) | `2026-07-23T19-09-37-225Z#2`, `…T19-10-09-463Z#2`, `…T20-18-20-965Z#3` |
| Search issues | `GET /search/issues` | not measured — 6.9's negative control covered the five adopted reads only | 1 call, against a SEPARATE budget: `x-ratelimit-resource: search`, 30/minute, not the core 5,000/hour | not probed | **probed 2026-09-12, NOT adopted.** One of two candidates for "merged pull requests by one author". Answers in one call and reports `incomplete_results`; the index is eventually consistent, so a count that is sometimes low is possible | `2026-09-12T06-31-36-229Z#32` |
| List closed pull requests | `GET /repos/{o}/{r}/pulls?state=closed` | not measured — as above | 1/page on the core budget; pages scale with the REPOSITORY'S AGE, not with the author (no server-side author filter), 1 page on the sandbox | not probed | **probed 2026-09-12, NOT adopted.** The other candidate. Exact, and its cost is the whole closed history divided by a hundred — per assignee, per sweep. Both candidates agreed on the sandbox (1 vs 1 for `exploreriii`, 0 vs 0 for `aceppaluni`), which settles nothing: the choice needs a cost model against the fleet budget (Q10) and a register row | `2026-09-12T06-31-36-229Z#32` |
| List app deliveries | `GET /app/hook/deliveries` | App (JWT) | ~410 ms/15 | — | confirmed; ids are >2^53 strings | `2026-07-23T18-57-44-094Z#1` |
| Redeliver | `POST /app/hook/deliveries/{id}/attempts` | App (JWT) | 202 | — | confirmed; redelivery carries `redelivery: true`. Also confirmed on a second contributor's events a day after original delivery: a **private-fork-sourced PR** (head repo a private fork of the sandbox) delivered `pull_request.opened`/`.closed` + `push`, signature-verified on redelivery, close-on-merge linkage intact (`merge_commit_sha` = push head). The ledger recorded `OK` for the originals although no receiver ran — the P9/6.2 loss window reproduced on unprompted real traffic | `2026-07-23T19-04-37-138Z#1`; `2026-07-25T20-03-36-091Z#1`, `…T20-04-04-509Z#1`, `…T20-04-05-654Z#1` (deliveries `3833075546093256704`, `…594313728`, `…955032064`) |
| Mint installation token | `POST /app/installations/{id}/access_tokens` | App (JWT) | n/a | — | confirmed (201, 1h TTL) | `2026-07-23T18-34-51-975Z#1` |

Each confirmed read's checkable shape is `packages/dev/lab/src/probes/reads.ts`; `pnpm lab:probe`
compares it monthly (D158).

## Provenance of the client's constants

What the adapter's client hard-codes about GitHub, and how each fact goes stale. The reads above are
re-probed monthly; nothing below is, so D40 makes re-probing these standing rather than occasional. A
row with no date holds documented knowledge — something GitHub publishes and would announce changing.

| Fact | Where it lives | Probed by | Date | Goes stale when | First symptom |
|---|---|---|---|---|---|
| JWT span ≤ 600 s from `iat` | `ASSERTION_LIFETIME_SECONDS` | GitHub's docs | documented | the cap changes | every mint 401s at once — loud |
| RS256, backdated `iat` | `jwt.ts` | GitHub's docs | documented | the signing scheme changes | every mint rejected — loud |
| Installation token TTL is 1 h | `REFRESH_SKEW_SECONDS`, `MINT_FLOOR_SECONDS` | the mint row above | 2026-07-23 | GitHub shortens the TTL | **quiet if shortened below ~2 min**: the floor would serve genuinely dead tokens |
| `permissions` is `{scope: level}` | `grantsFromPermissions` | mint response | 2026-07-23 | a level outside `read`/`write` enters the ceiling | **quiet**: the grant is dropped, and a capability refuses citing a permission the installation actually holds |
| REST request version is `2026-03-10` | `GITHUB_API_VERSION` | GitHub's version docs | documented | the version approaches sunset | the response carries `deprecation`/`sunset`, then calls return 410 |
| Contents API wraps a file as `{type, encoding, content, sha}` — base64 inline, `encoding: "none"` past 1 MB | the decode in `config.ts` | GitHub's contents docs | documented | the envelope or the 1 MB behaviour changes | **quiet-ish**: healthy configs read as defective (fail-closed records) or unrecognized (retries) |
| Timeline entries name `event`, a typed `actor`, second-precision `created_at`; pages ascend | the six-kind filter in `externals.ts` | GitHub's timeline docs, the timeline row above | documented + 2026-07-23 | the shape or the kinds change | a missing actor or date is unknown; **quiet**: new kinds stay uncounted |
| Installation identities are App bot logins such as `name[bot]` | the automation actor in `resolvers.ts` | [GitHub's App identity guide](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/differences-between-github-apps-and-oauth-apps) | documented | the login convention changes | App actors are mistaken for people, or people for App actors |

**The quiet rows are the ones that matter.** A wrong JWT bound fails loudly within minutes; a TTL
that shrank, a grant level silently dropped, or a timeline shape that drifted keeps every test green
while the running system misbehaves — and the timeline row is the worst of the three, because its
failure direction is writing over human edits. `MINT_FLOOR_SECONDS` is *derived* from the TTL row:
its safety argument is "an hour is far longer than a minute", and it stops being sound the day that
stops being true.

**Cadence:** quarterly for the dated rows, plus ad-hoc whenever a first-symptom column shows up in
operator reports. **Owner:** unassigned.

## The ceiling

**The proposed baseline** (from the stage-four packet, retired 2026-08-17; ratification still
pending): installation permissions `issues: write`, `pull_requests: write`, `contents: read`, plus
App-level webhook access. Event subscriptions `issues`, `issue_comment`, `pull_request`, `push` —
extended with `pull_request_review` only if a ratified capability needs to observe reviews, a gap
protocol 6.6 found in the current subscription list. Deliberately withheld: `checks` (probed; the
403 is harmless) and any `contents: write`.

Protocol 6.3 surfaced an incidental safety property worth keeping deliberately rather than by
accident: **`contents: read` means the platform cannot modify its own configuration.**

The App registration fixes the maximum permissions any installation can grant, and repository
configuration cannot reduce what maintainers see at install time. A capability runs only when its
required permissions are present; one introducing an organization-level or new write permission needs
separate justification and maintainer review. **The App must never need permission to change
repository code.** Team membership, organization Projects, Checks, and off-GitHub notifications stay
optional precisely because each adds permissions or an external system.

## Result vocabulary

Every write operation states its required permission, expected current state, desired postcondition,
idempotency key, retry rule, unclear-result behaviour, and recovery rule. The adapter returns an
explicit result, at minimum distinguishing `applied`, `already`, `conflict`, `forbidden`,
`retryLater`, and `unknown`. **A capability never retries an `unknown` result by itself** — an
unclear outcome is recorded and reconciled, never blindly repeated.

## Failure catalogue

The distinct failure shapes a diagnostics layer must tell apart. Probe-backed rows carry dated
evidence; documented-only rows are marked explicitly and remain re-probe obligations:

| Failure | Status / body marker | Distinguishable from | Citation |
|---|---|---|---|
| Token expired | 401, body `"Bad credentials"` — **identical to a wrong key; NOT distinguishable from the response.** The only distinguisher is local: the `expires_at` returned at mint time. Adapters must track token age and treat any 401 on a stale token as expiry (refresh and retry). An invalid App bearer value reproduced the same 401 body. | bad credentials (same body — the distinction exists only in local state) | `2026-07-23T21-52-06-572Z#1`; `2026-08-29T20-51-00.386Z#invalid-token` |
| Permission missing | REST: 403, `Resource not accessible by integration`, with `x-accepted-github-permissions`. GraphQL linked issues: no Pull requests grant gives partial data plus `FORBIDDEN`, but no Issues grant gives a clean empty connection. **The resolver must precheck both grants.** | suspended; a genuinely unlinked PR (when Issues is missing) | `2026-07-23T18-40-40-043Z#3`; `2026-08-29T20-51-00.386Z#same-repository-without-issues-permission,#same-repository-without-pull-requests-permission`; repeat `2026-08-29T20-51-32.049Z` |
| Installation suspended | 403, body "This GitHub App installation is currently suspended", **no** `x-accepted-github-permissions` header | permission missing (which has the header and a different body) | `2026-07-23T18-46-45-624Z#5` |
| Repo outside installation | REST: 404 `Not Found`. GraphQL source: 200 with `repository: null` plus `NOT_FOUND`. GraphQL linked target: clean empty connection, indistinguishable from no link; this is why the first resolver is same-repository only. | nonexistent source; unlinked PR when only the target is hidden | `2026-07-23T19-52-01-085Z#3`; `2026-08-29T20-51-00.386Z#outside-installation-source,#cross-repository-outside-target`; repeat `2026-08-29T20-51-32.049Z` |
| Secondary rate limit | 403, body "You have exceeded a secondary rate limit … temporarily blocked from content creation"; **no `retry-after` header on this write-path observation** (n=1; GitHub documents the header may be present). **Read path probed 2026-09-15 (6.13): no secondary signal at 1,000 unconditional GETs in 41 s at concurrency 10, nor at 600 conditional 304s in 25 s; 304s charge no primary quota** (`2026-09-15T15-27-51-748Z#595,#647`), primary quota nearly untouched on the write burst (4909/5000) | permission 403 (different body, has `x-accepted-github-permissions`); primary exhaustion (`x-ratelimit-remaining: 0`) | `2026-07-23T19-37-00-198Z#19` |
| Validation error | 422, `Validation Failed`, structured `errors[]` of `{message, resource, field, code}` | forbidden (403, prose body, no `errors[]`) | `2026-07-23T19-36-29-346Z#11` |
| Redirect | 3xx with `location` — documented for renamed repos (301) and temporary moves (302/307); **never observed in a probe**. The client currently refuses to follow and classifies as `redirected` pending an explicit redirect policy | transient 5xx (which is worth a retry) | [GitHub REST redirect guidance](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api#follow-redirects), documented only — `REPROBE(redirect-3xx)` |
