# The read-only adapter

> **Not built — build guide.** The first component that talks to GitHub at runtime. It lands behind
> seams that already exist on `main`, so the shell does not change. How the work divides is below;
> its order and estimates live on issue #111, not here.

```mermaid
flowchart TD
    SH["shell processor — unchanged"]
    SEAMS["seams: ConfigSource · externals · resolve"]
    SH -->|"calls, never throws across"| SEAMS
    SEAMS -->|"implemented by"| A
    subgraph A ["adapter package — new"]
        AUTH["app auth<br/>token cache"]
        HTTP["http client<br/>ETags, timeouts"]
        OPS["operations<br/>one per matrix row"]
        FAIL["failure map<br/>errors → values"]
    end
    A -->|"HTTPS — the only place"| GH["GitHub API"]
```

## Ground rules

| Rule | Consequence |
|---|---|
| The shell does not change | Everything lands behind the four seams |
| Nothing throws across a seam | Every failure is a typed value |
| Unknown is never absence (D51) | A failed read must never become a default |
| Core stays pure | A new package; core's one edit is making one seam async — below |
| Fail closed on identity | Config fetches pin the default branch |

- The package is `packages/adapter`, importing `core` alone; `shell → adapter` exists only in `main.ts`.
- The final shell diff across the whole sequence is one composition-root conditional.
- Typed failures are why one bad delivery can never wedge the queue.
- The contents API serves fork-authored content at a PR head sha (observed, 6.6).

## Auth

| Concern | Behaviour |
|---|---|
| JWT | The private key signs a ~10-minute JWT (`node:crypto`, no library) |
| Installation token | `POST /app/installations/{id}/access_tokens`, valid 1 hour |
| `TokenSource` | Cached, refreshed early, single-flight |
| Expiry | Locally expiry-aware, clock-injected |
| Credentials | `APP_ID`, `PRIVATE_KEY_PATH`, `INSTALLATION_ID` |

- Single-flight means concurrent requests never stampede the mint endpoint.
- An expired token and a wrong key return the byte-identical 401 `"Bad credentials"`.
- Only a local `expires_at` separates them, so `classifyFailure` takes `tokenPastExpiry` as an input.
- Tests drive expiry with a fake clock, and no test touches the network.
- Credentials are untracked environment only — the lab's rule, extended as D99 predicted.

## HTTP client

| Concern | Behaviour |
|---|---|
| Request shaping | Auth header, API version, timeout via `AbortSignal` |
| Conditional reads | ETag cache per URL; a 304 costs zero quota |
| Rate awareness | Track `x-ratelimit-*` on every response |
| Classification | Non-success builds a `FailureObservation` for core |
| Bounded retry | One retry, and only for two classes |

- One function every operation calls, owning those five concerns.
- A free 304 is how the Q10 budget stays comfortable.
- Classification calls core's `classifyFailure` — no parallel vocabulary.
- Retry: `tokenExpired` refreshes and retries once · `transient` retries once · the rest return at once.
- `secondaryLimit` is **never** auto-retried by the client. The observed write-path block
  carried no wait signal (6.4); GitHub documents that `retry-after` may be present, and core
  honours it when it is. The read path is unprobed — `REPROBE(secondary-limit-read-path)`.
- Deterministic refusals are not weather: what never left the process is `notSent`, a refused
  3xx is `redirected` — both `doNotRetry`, so a wiring defect or a renamed repo cannot burn
  the retry budget under the `transient` label. `notSent` is adapter-local because it is not a
  GitHub response; every response class, including `redirected`, still comes from core.
- **How the two retry layers compose:** the client owns exactly one immediate in-process
  retry (`tokenExpired` after a refresh, `transient` once); core's `retryAdvice` owns durable,
  paced, restart-surviving retries at the operation layer, treating each client call as one
  attempt. With its current zero-based advice (wait after attempts 0, 1, and 2), the initial
  client call plus three durable retries can each make two HTTP attempts: **8 requests per
  persistent transient episode**. That number is accepted here, deliberately, once.
- Its tests replay every row of the failure catalogue, whose body snapshots are the fixtures —
  [`../findings/endpoint-permission-matrix.md`](../findings/endpoint-permission-matrix.md).

## Operations

| Function | Endpoint | Fills | Matrix status |
|---|---|---|---|
| `fetchConfigFile(ref)` | `GET …/contents/{path}` | `ConfigSource` | confirmed |
| `fetchInstallationGrants()` | token mint response | `installationGrants` | confirmed |
| `readIssueTimeline(n)` | `GET …/issues/{n}/timeline` | `latestHumanChangeAt` | confirmed |
| `readLinkedIssues(pr)` | GraphQL `closingIssuesReferences` | `resolve: linkedIssues` | semantics measured; App-auth shapes open |

- **The untested read gets a lab protocol before it gets trust.**
- No matrix row, no citation — and a row without a citation is a guess.
- Manual links, cross-repository references and quota cost go to `packages/dev/lab/protocols/`.
- The answers become matrix rows in [`../findings/`](../findings/); only then does the resolver ship.
- **GitHub ids exceed 2^53**, so every id stays a string.
- **404 means "not found *or* not installed"** — it maps to `notFoundOrNotInstalled`, never to a
  confident absence.

## The seams, once implemented

- **`githubConfigSource`** — fetches at the default branch; `revision` is the blob sha.
- A 404 maps to the absent-file default, matching `fileConfigSource`'s semantics exactly — one shared `sha256:absent` sentinel, never a re-spelling.
- **`liveExternals`** — the real grant list, and `latestHumanChangeAt` from the timeline.
- The grant list costs zero calls: it is a field of the mint response, cached and refreshed with the token.
- It answers **unknown** when evidence cannot be established within budget.
- The seam turns async on the way: `main` types `latestHumanChangeAt` synchronously, which a
  timeline read cannot answer and the shell cannot prefetch — `intent.item` exists only inside
  `decide()`. It becomes `Promise`-returning like `resolve` beside it; `decide()` is already
  async, so the one verb's signature and the shell both hold.
- Timeline answers memoize within a delivery, never across one (the 6.8 freshness rule).
- That is the moment dry-run stops overstating. `killSwitchActive` stays operator environment.
- **`linkedIssuesResolver`** — an empty answer and a failed answer are different values.
- Wiring: with the three credential variables present, `main.ts` composes live implementations.
- Without them it composes stubs. One conditional — the sandbox runs live, CI stays credential-free.

## The fail-honest read

```mermaid
flowchart LR
    R["read(pr)<br/>processor asks"] --> Q["one GraphQL query<br/>closing references"]
    Q -->|200| OK["present / absent<br/>a confident answer"]
    Q -->|"everything else"| UNK["unknown + reason<br/>any failure at all"]
```

- Rate limit, 403, timeout, malformed response — all become `unknown` with a reason.
- The decision layer refuses to act on unknown, so a failed read can never fake a fact.

## How the work divides

```mermaid
flowchart LR
    A["auth kernel<br/>token cache, fake clock"] --> B["http client<br/>ETags, classification, retry"]
    B --> C["config seam<br/>live ConfigSource"]
    B --> E["resolvers<br/>linked issues, timeline"]
    D["lab protocol<br/>evidence only"] -.-> E
    C --> F["rehearsal<br/>stubs removed"]
    E --> F
```

Four properties make each piece mergeable alone — consequences of the seams, not of a plan.

| Property | Consequence |
|---|---|
| Each piece lands behind an existing seam | The shell never changes |
| The composition root is environment-gated | An unfinished adapter cannot break CI |
| The measurement is its own piece, no code | Evidence merges as protocol and matrix rows |
| Removing the stubs is the last piece | Zero stubs closes the work |

- Credentials present composes live implementations; absent composes stubs.
- CI never holds a credential, and the runnable sandbox keeps working.
- `readLinkedIssues` semantics are measured ([`../findings/linked-issues.md`](../findings/linked-issues.md)): closing keywords only, a mention is not a link, and the answer may not be cached across a delivery. Cross-repository and App-auth failure shapes remain open (6.8 cases 3 and 7).
- Zero stubs is the done-when below, not a step toward it.

## Verification

| Layer | Runs | Proves |
|---|---|---|
| Unit and fixture tests | CI, no credentials | Auth edges, ETags, all catalogue rows classify |
| Mutation gate | CI | The adapter's Stryker range, pinned to end-of-file |
| Lab conformance | Sandbox, manual | Linked-issue semantics; D40's prose-snapshot re-probe |
| Sandbox rehearsal | Sandbox, live | Zero stubs; dry-run reports stop overstating |

## Done when

- The sandbox rehearsal runs with **zero stubs** — live config, grants, timeline, linked-issue reads.
- Dry-run reports stop overstating, recorded in a register row.
- CI never needed a credential; the lab never tracked one.
- The shell diff across the whole sequence is the composition root only.
- Every GitHub assumption carries a citation — an existing matrix row, or a new one this work produced.
