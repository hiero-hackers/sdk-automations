# Endpoint and permission matrix

The stage-three exit-gate artifact (Q16's input): every operation the
first capabilities need, with the permission that grants it and its
**observed** behavior — filled from harness evidence logs, one citation
per row. A row without a citation is a guess and does not close the gate.

> Moved from `experiments/` on 2026-07-23: experiments produce evidence,
> their conclusions live in `design/`. The cited evidence logs
> (`experiments/harness/evidence/*.jsonl`) are local and untracked.

Status values: `confirmed` (observed in a run), `blocked` (observed to
fail — cite the failure), `untested`.

## Operations

| Operation | Endpoint | Permission | Primary quota cost | Conditional-read support | Status | Citation |
|---|---|---|---|---|---|---|
| List issues (paged) | `GET /repos/{o}/{r}/issues` | Issues R | 1/call; 0 on 304 | ETag present; 304 confirmed free | confirmed incl. link-header pagination (157 items = 2 calls @ `per_page=100`) | `2026-07-23T19-36-29-346Z#1–6` |
| Read issue timeline | `GET /repos/{o}/{r}/issues/{n}/timeline` | Issues R | 1/call | ETag present | confirmed; 80 events = 1 call, ~480 ms | `2026-07-23T19-38-17-272Z#13` |
| Add label | `POST /repos/{o}/{r}/issues/{n}/labels` | Issues W | 1/call | — | confirmed (200) | `2026-07-23T18-58-46-782Z#2` |
| Remove label | `DELETE /repos/{o}/{r}/issues/{n}/labels/{name}` | Issues W | 1/call | — | confirmed (200) | `2026-07-23T18-58-46-782Z#3` |
| Create comment | `POST /repos/{o}/{r}/issues/{n}/comments` | Issues W | 1/call | — | confirmed (201); secondary limit at ~71 writes @ concurrency 20, no `retry-after` | `2026-07-23T19-37-00-198Z#15,19` |
| Update own comment | `PATCH /repos/{o}/{r}/issues/comments/{id}` | Issues W | 1/call | — | confirmed (200) | `2026-07-23T19-41-18-911Z#4` |
| List comments | `GET /repos/{o}/{r}/issues/{n}/comments` | Issues R | 1/call | ETag present | confirmed | `2026-07-23T19-41-18-911Z#2` |
| Read PR | `GET /repos/{o}/{r}/pulls/{n}` | Pull requests R | 1/call | ETag present | confirmed incl. fork-sourced PR (head repo/sha exposed) | `2026-07-23T19-41-18-911Z#3`, `…T20-16-41-190Z#2` |
| List PR files | `GET /repos/{o}/{r}/pulls/{n}/files` | Pull requests R | 1/call | ETag present | confirmed on fork-sourced PR | `2026-07-23T20-16-41-190Z#7` |
| Create review | `POST /repos/{o}/{r}/pulls/{n}/reviews` | Pull requests W | 1/call | — | confirmed (REQUEST_CHANGES on fork-sourced PR); **no delivery observed** — App not subscribed to `pull_request_review` | `2026-07-23T20-16-41-190Z#6` |
| Read file (config) | `GET /repos/{o}/{r}/contents/{path}` | Contents R | 1/call | ETag present | confirmed incl. 404-as-absent and `ref` param. **Caution: serves fork-authored content at a PR head sha** (6.6) — config fetches must pin the default branch, never a PR-derived ref | `2026-07-23T19-09-37-225Z#2`, `…T19-10-09-463Z#2`, `…T20-18-20-965Z#3` |
| List app deliveries | `GET /app/hook/deliveries` | App (JWT) | ~410 ms/15 | — | confirmed; ids are >2^53 strings | `2026-07-23T18-57-44-094Z#1` |
| Redeliver | `POST /app/hook/deliveries/{id}/attempts` | App (JWT) | 202 | — | confirmed; redelivery carries `redelivery: true` | `2026-07-23T19-04-37-138Z#1` |
| Mint installation token | `POST /app/installations/{id}/access_tokens` | App (JWT) | n/a | — | confirmed (201, 1h TTL) | `2026-07-23T18-34-51-975Z#1` |

## Failure catalogue

The distinct failure shapes a diagnostics layer must tell apart, each
observed at least once:

| Failure | Status / body marker | Distinguishable from | Citation |
|---|---|---|---|
| Token expired | | bad credentials | |
| Permission missing | 403, `Resource not accessible by integration`, `x-accepted-github-permissions` names the grant. **Private repos only — public-repo reads succeed without the grant** | suspended | `2026-07-23T18-40-40-043Z#3` (private), `2026-07-23T18-34-51-975Z#4` (public 200) |
| Installation suspended | 403, body "This GitHub App installation is currently suspended", **no** `x-accepted-github-permissions` header | permission missing (which has the header and a different body) | `2026-07-23T18-46-45-624Z#5` |
| Repo outside installation | **404 `Not Found`** — existence hidden; indistinguishable from a nonexistent repo | permission missing (403 on a repo the App *is* installed on) | `2026-07-23T19-52-01-085Z#3` |
| Secondary rate limit | 403, body "You have exceeded a secondary rate limit … temporarily blocked from content creation"; **no `retry-after` header**, primary quota nearly untouched (4909/5000) | permission 403 (different body, has `x-accepted-github-permissions`); primary exhaustion (`x-ratelimit-remaining: 0`) | `2026-07-23T19-37-00-198Z#19` |
| Validation error | 422, `Validation Failed`, structured `errors[]` of `{message, resource, field, code}` | forbidden (403, prose body, no `errors[]`) | `2026-07-23T19-36-29-346Z#11` |
