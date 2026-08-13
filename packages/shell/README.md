# shell/ — transport, not decisions

The transport package (D93). A webhook delivery goes in; a persisted report comes out; every decision
in between belongs to core's one verb. The shell's entire contribution is **order**:

> verify before accept, accept before ack, decide before act, commit the canonical outcome atomically.

```mermaid
flowchart LR
    GH[GitHub delivery] --> V["① verify\ncore verifyBody"]
    V --> A["② accept durably\nstore acceptDelivery"]
    A --> ACK["202"]
    ACK -.-> P["③ prepare\nconfig + externals"]
    P -->|observe or dry-run| D["④ decide()"]
    P -->|active| U["modeUnsupported"]
    D --> C["⑤ store report + done\none transaction"]
    U --> C
```

## The five stations, and who owns each

| Step | File | Owned by |
|---|---|---|
| ① Verify the signature before anything else | [`src/receiver.ts`](src/receiver.ts) | core's `verifyBody` — the receiver never parses what it has not verified |
| ② Persist durably, only then `202` | [`src/receiver.ts`](src/receiver.ts) → [`src/shell.ts`](src/shell.ts) | the store's `acceptDelivery` (P9): a crash after the ack loses nothing |
| ③ Prepare: config text → `parseConfigDocument`, externals assembled | [`src/processor.ts`](src/processor.ts), [`src/config.ts`](src/config.ts), [`src/externals.ts`](src/externals.ts) | core's config layer; a broken config becomes `configRejected`, while `active` becomes `modeUnsupported` before `decide()` |
| ④ Decide with one verb | [`src/processor.ts`](src/processor.ts) | core's `decide()`; the shell cannot assert a world — `DerivedWorld` has no public constructor |
| ⑤ Commit report plus completion | [`src/processor.ts`](src/processor.ts) → store's `completeDeliveryWithReport` | store verifies delivery identity and claim ownership, then creates one canonical report and marks the delivery done in one transaction |

The configuration file lives at **`automations.yml` in the repository root** (D93): it configures the
automation platform, not GitHub, and everywhere else in the design GitHub is an adapter detail — a
`.github/` home would say otherwise at the most user-visible spot.

## Every stub is a named hole the read-only adapter fills

The first slice runs with stubs that have the shape of the truth ([`src/externals.ts`](src/externals.ts)).
The read-only adapter work packet replaces each behind its existing seam — the shell does not change:

| Stub today | Becomes | Seam |
|---|---|---|
| `fileConfigSource` (operator's local copy) | fetch `automations.yml` at the default branch | `ConfigSource` |
| `installationGrants: ["issues:write"]` | the installation's live grant list | `DecideExternals` |
| `latestHumanChangeAt: () => null` | timeline evidence per item | `DecideExternals` |
| no `resolve` | `linkedIssues` / `isAutomationActor` lookups | `DecideExternals.resolve` |

`() => null` and not `() => "unknown"` deliberately: `"unknown"` is a safe conflict and would refuse
every write, burying dry-run's real findings under a uniform refusal. Until the adapter lands,
dry-run reports **overstate** what would apply.

## Running against the sandbox

```
WEBHOOK_SECRET=…            # the sandbox App's webhook secret
REPO_OWNER=owner-sandbox    # the repository this endpoint serves
REPO_NAME=automation-sandbox
PORT=8790                   # optional
CONFIG_FILE=…               # optional; default data/automations.yml (copy of the repo's file)
STORE_PATH=…                # optional; default data/shell.sqlite
KILL_SWITCH=1               # optional; refuse everything, loudly
```

```bash
pnpm --filter @hiero-hackers/automation-shell start
```

Point the existing smee channel at it and open an issue on the sandbox. The canonical report and
delivery completion are committed together in `shell.sqlite`. Startup still starts draining pending
SQLite deliveries before listening. Automatic filesystem projection is not supported, and a polished
operator report/query surface has not been built yet. `Store.deliveryReports()` is the current
programmatic access to canonical reports.

`data/` is never tracked (see the root `.gitignore`), the same rule as `lab/evidence/`.

## Deliberately out of the first slice

- **The scheduler** — `staleItemsDue` is queried, not delivered; it arrives as a second caller of
  `decide()`, not a second pipeline.
- **Config hot-fetch** — the seam exists (`ConfigSource`); the fetch is the read adapter's.
- **Active mode** — the runnable shell supports observe and dry-run and rejects active configuration.
  Active GitHub writes are not implemented yet; each real effect will need its own write and durable
  recovery path before active behavior can be enabled.
- **Multi-repository routing** — one endpoint, one configured repository, matching the sandbox.

The capture receiver in `packages/lab/src/capture.ts` was this package's embryo: same verify-first line,
same 202 — it just wrote a file where the shell continues through canonical SQLite completion.
