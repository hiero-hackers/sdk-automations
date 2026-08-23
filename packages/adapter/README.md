# automation-adapter

**The only place in the platform that talks to GitHub.** Everything else decides; this asks and
answers. It sits on `core/` and on nothing else, and exactly one file outside it — the shell's
composition root — ever names it.

Its knowledge goes stale the way `core/src/github/`'s does: these files describe a live system that
is free to change underneath them, so green tests mean the code still agrees with what was measured,
not that it is correct. The build guide is
[`design/guides/adapter.md`](../../design/guides/adapter.md); the operation list and its costs are
[`design/findings/endpoint-permission-matrix.md`](../../design/findings/endpoint-permission-matrix.md).

## What is here today

| File | The question it answers |
|---|---|
| `jwt.ts` | What proves we are the App? |
| `token.ts` | What token may we call with, right now? |
| `http.ts` | How does every operation make one bounded, classified GitHub call? |

`jwt.ts` is network-free: it is a pure function of its credentials and a `now` handed to it.
`token.ts` takes the mint call as an injected function, so its whole lifecycle — cache, early
refresh, single flight — is driven by a fake clock. `http.ts` owns the authenticated request path,
the bounded per-URL ETag cache, timeouts, rate-limit snapshots, core failure classification, and the
one permitted retry. It pins credentials to GitHub's HTTPS API, exposes only the GET reads this
stage has proved, and refuses to follow redirects — a 3xx comes back classified as `redirected`,
carrying its `location`, rather than being silently chased or retried. Its fetch and clock are
injected too, so no test reaches the network. GitHub response classes remain core's observed
vocabulary; the adapter-local `notSent` result covers only requests that never reached GitHub.

**Minting is injected rather than called** because that one request authenticates with the assertion
instead of with a token. It cannot travel through the HTTP client, since the client is what needs the
token this produces.

## The trap this package exists around

**An expired token and a wrong private key return byte-identical 401 bodies** (`"Bad credentials"`,
observed 2026-07-23). Nothing in the response distinguishes them, so `isPastExpiry` is the local fact
`classifyFailure` needs to tell an expiry apart from a credential fault. A token cache that only
reacted to 401s would classify every expiry as a bad key.

## Provenance, and how each fact goes stale

Same obligation as [`core/src/github/`](../core/src/github/README.md), for the same reason: these are
dated measurements of a live system, and D40 makes re-probing standing rather than occasional. The
rows without a probe date hold **documented** knowledge — things GitHub publishes and would announce
changing — so they are here for coverage, not for the quarterly pass.

| Fact | Where it lives | Probed by | Date | Goes stale when | First symptom |
|---|---|---|---|---|---|
| JWT span ≤ 600 s from `iat` | `ASSERTION_LIFETIME_SECONDS` | GitHub's docs | documented | the cap changes | every mint 401s at once — loud |
| RS256, backdated `iat` | `jwt.ts` | GitHub's docs | documented | the signing scheme changes | every mint rejected — loud |
| Installation token TTL is 1 h | `REFRESH_SKEW_SECONDS`, `MINT_FLOOR_SECONDS` | matrix row, mint response | 2026-07-23 | GitHub shortens the TTL | **quiet if shortened below ~2 min**: the floor would serve genuinely dead tokens |
| Expiry and bad key share a 401 body | `isPastExpiry`, and core's `classifyFailure` | experiment 6.1 | 2026-07-23 | GitHub distinguishes them | quiet — we keep using a local fact that became unnecessary |
| `permissions` is `{scope: level}` | `grantsFromPermissions` | mint response | 2026-07-23 | a level outside `read`/`write` enters the ceiling | **quiet**: the grant is dropped, and a capability refuses citing a permission the installation actually holds |
| REST request version is `2026-03-10` | `GITHUB_API_VERSION` | GitHub's version docs | documented | the version approaches sunset | response carries `deprecation`/`sunset`, then calls return 410 |
| Authenticated conditional GET returning 304 costs no primary quota | `http.ts` ETag cache | GitHub's best-practice docs, experiment 6.4 | documented + 2026-07-23 | GitHub changes conditional accounting | rate usage rises on unchanged reads |

**The two quiet rows are the ones that matter.** A wrong JWT bound fails on the next call and someone
notices within minutes; a TTL that shrank, or a grant level silently dropped, keeps every test green
while the running system misbehaves. `MINT_FLOOR_SECONDS` in particular is *derived* from the TTL
row — its safety argument is "an hour is far longer than a minute", and it stops being sound the day
that stops being true.

**Cadence:** quarterly for the dated rows, plus ad-hoc whenever a first-symptom column shows up in
operator reports. **Owner:** unassigned, the same unfilled row as its sibling in `core/`.

## Still to arrive

The operations — one per confirmed matrix row — and the seam implementations the shell composes:
`githubConfigSource`, `liveExternals`, and the resolvers. `design/guides/adapter.md` holds the order
and what each one is blocked on.

## What keeps it honest

`pnpm --filter @hiero-hackers/automation-adapter test` typechecks and runs the suite. CI holds no
credential and neither does this package: every credential is untracked environment, supplied to the
composition root. Fixtures are built lazily inside tests, never at describe-time — an eagerly built
fixture turns a mutant that breaks signing into a collection crash, which vitest reports as "no
tests" and Stryker scores as survived (D89).
