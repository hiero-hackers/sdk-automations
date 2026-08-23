# Endpoint and permission matrix

**Answer (Q16): the confirmed rows below are the adapter's operation list; the failure catalogue is
its error type.** A row without a citation is a guess and does not close the gate.

Status: `confirmed` observed in a run · `blocked` observed to fail, failure cited · `untested`.

## Operations

| Operation | Endpoint | Permission | Primary quota cost | Conditional-read support | Status | Citation |
|---|---|---|---|---|---|---|
| List issues (paged) | `GET /repos/{o}/{r}/issues` | Issues R | 1/call; 0 on 304 | ETag present; 304 confirmed free | confirmed incl. link-header pagination (157 items = 2 calls @ `per_page=100`) | `2026-07-23T19-36-29-346Z#1–6` |
| Read issue timeline | `GET /repos/{o}/{r}/issues/{n}/timeline` | Issues R | 1/call | ETag present | confirmed; 80 events = 1 call, ~480 ms | `2026-07-23T19-38-17-272Z#13` |
| Add label | `POST /repos/{o}/{r}/issues/{n}/labels` | Issues W | 1/call | — | confirmed (200) | `2026-07-23T18-58-46-782Z#2` |
| Remove label | `DELETE /repos/{o}/{r}/issues/{n}/labels/{name}` | Issues W | 1/call | — | confirmed (200) | `2026-07-23T18-58-46-782Z#3` |
| Create comment | `POST /repos/{o}/{r}/issues/{n}/comments` | Issues W | 1/call | — | confirmed (201); secondary limit at ~71 writes @ concurrency 20, no `retry-after` | `2026-07-23T19-37-00-198Z#15,19` |
| Update own comment | `PATCH /repos/{o}/{r}/issues/comments/{id}` | Issues W | 1/call | — | confirmed (200) | `2026-07-23T19-41-18-911Z#4` |
| List comments | `GET /repos/{o}/{r}/issues/{n}/comments` | Issues R | 1/call | ETag present | confirmed. Read-after-write: 25/25 first-read visible after create (6.7) — see `read-after-write.md` for the freshness rule | `2026-07-23T19-41-18-911Z#2`; `2026-07-25T21-00-55-057Z#79` |
| Read PR | `GET /repos/{o}/{r}/pulls/{n}` | Pull requests R | 1/call | ETag present | confirmed incl. fork-sourced PR (head repo/sha exposed) | `2026-07-23T19-41-18-911Z#3`, `…T20-16-41-190Z#2` |
| List PR files | `GET /repos/{o}/{r}/pulls/{n}/files` | Pull requests R | 1/call | ETag present | confirmed on fork-sourced PR | `2026-07-23T20-16-41-190Z#7` |
| Create review | `POST /repos/{o}/{r}/pulls/{n}/reviews` | Pull requests W | 1/call | — | confirmed (REQUEST_CHANGES on fork-sourced PR); **no delivery observed** — App not subscribed to `pull_request_review` | `2026-07-23T20-16-41-190Z#6` |
| Read file (config) | `GET /repos/{o}/{r}/contents/{path}` | Contents R | 1/call | ETag present | confirmed incl. 404-as-absent and `ref` param. **Caution: serves fork-authored content at a PR head sha** (6.6) — config fetches must pin the default branch, never a PR-derived ref | `2026-07-23T19-09-37-225Z#2`, `…T19-10-09-463Z#2`, `…T20-18-20-965Z#3` |
| List app deliveries | `GET /app/hook/deliveries` | App (JWT) | ~410 ms/15 | — | confirmed; ids are >2^53 strings | `2026-07-23T18-57-44-094Z#1` |
| Redeliver | `POST /app/hook/deliveries/{id}/attempts` | App (JWT) | 202 | — | confirmed; redelivery carries `redelivery: true`. Also confirmed on a second contributor's events a day after original delivery: a **private-fork-sourced PR** (head repo a private fork of the sandbox) delivered `pull_request.opened`/`.closed` + `push`, signature-verified on redelivery, close-on-merge linkage intact (`merge_commit_sha` = push head). The ledger recorded `OK` for the originals although no receiver ran — the P9/6.2 loss window reproduced on unprompted real traffic | `2026-07-23T19-04-37-138Z#1`; `2026-07-25T20-03-36-091Z#1`, `…T20-04-04-509Z#1`, `…T20-04-05-654Z#1` (deliveries `3833075546093256704`, `…594313728`, `…955032064`) |
| Mint installation token | `POST /app/installations/{id}/access_tokens` | App (JWT) | n/a | — | confirmed (201, 1h TTL) | `2026-07-23T18-34-51-975Z#1` |

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
| Token expired | 401, body `"Bad credentials"` — **identical to a wrong key; NOT distinguishable from the response.** The only distinguisher is local: the `expires_at` returned at mint time. Adapters must track token age and treat any 401 on a stale token as expiry (refresh and retry) | bad credentials (same body — the distinction exists only in local state) | `2026-07-23T21-52-06-572Z#1` |
| Permission missing | 403, `Resource not accessible by integration`, `x-accepted-github-permissions` names the grant. **Private repos only — public-repo reads succeed without the grant** | suspended | `2026-07-23T18-40-40-043Z#3` (private), `2026-07-23T18-34-51-975Z#4` (public 200) |
| Installation suspended | 403, body "This GitHub App installation is currently suspended", **no** `x-accepted-github-permissions` header | permission missing (which has the header and a different body) | `2026-07-23T18-46-45-624Z#5` |
| Repo outside installation | **404 `Not Found`** — existence hidden; indistinguishable from a nonexistent repo | permission missing (403 on a repo the App *is* installed on) | `2026-07-23T19-52-01-085Z#3` |
| Secondary rate limit | 403, body "You have exceeded a secondary rate limit … temporarily blocked from content creation"; **no `retry-after` header on this write-path observation** (n=1; GitHub documents the header may be present, and read-path secondary limits are unprobed — `REPROBE(secondary-limit-read-path)`), primary quota nearly untouched (4909/5000) | permission 403 (different body, has `x-accepted-github-permissions`); primary exhaustion (`x-ratelimit-remaining: 0`) | `2026-07-23T19-37-00-198Z#19` |
| Validation error | 422, `Validation Failed`, structured `errors[]` of `{message, resource, field, code}` | forbidden (403, prose body, no `errors[]`) | `2026-07-23T19-36-29-346Z#11` |
| Redirect | 3xx with `location` — documented for renamed repos (301) and temporary moves (302/307); **never observed in a probe**. The client currently refuses to follow and classifies as `redirected` pending an explicit redirect policy | transient 5xx (which is worth a retry) | [GitHub REST redirect guidance](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api#follow-redirects), documented only — `REPROBE(redirect-3xx)` |
