# Stage-four review packet

Prepared 2026-07-23, ahead of the stage-four window (22 August – 5
September 2026, `design/build-plan.md` §7). One section per decision the
review must ratify: the concrete proposal, the sandbox evidence behind
it, and the register rows the approval flips.

The stage-three exit-gate artifacts this packet draws on:

- `design/operations/endpoint-permission-matrix.md` — every operation
  confirmed with permission, cost, and failure shape.
- `design/operations/storage-decision.md` — the recovery-sources grid and
  the storage decision.
- The per-protocol observation records and raw evidence logs
  (`experiments/`, deliberately local and untracked — experiments
  produce evidence; their conclusions live in `design/`).

## 1. Configuration path and schema (Q14, D31)

**Proposal.** Path `.github/hiero-automation.yml`; strict schema
version 1; migration policy: any `schemaVersion` other than 1 is
rejected whole (fail closed to `observe`), with migration tooling
deferred until a version 2 exists. The no-configuration mode keeps the
name `observe`.

**Evidence.** Protocol 6.3 ran the full state grid against this exact
path with the real `core/parseConfig`: absent, invalid, unknown-key,
and outdated configurations all landed in `observe` with single
precise errors, identical to unit-fixture behavior. A default-branch
config change was event-observable in 2.78 s via `push` delivery, so
reload is event-driven with polling as fallback.

**Hard requirement surfaced by 6.6.** The effective-config fetch must
pin the base default branch — the base repository's Contents API
serves fork-authored content at a PR head sha
(`FINDING(fork-content-via-base-api)`), so any PR-influenced ref is
contributor-controlled input.

**Flips:** Q14 (path/schema/migration), D31 → ratified.

## 2. Minimum storage (Q15, D1, D24, D27)

**Proposal.** Adopt `design/operations/storage-decision.md` as written: a
single-file SQLite store with four tables — seen delivery ids, effect
intent/done journal, claims, schedules. GitHub keeps all effect
outcomes; comment metadata remains effect identity/receipt only.

**Evidence.** The 6.5 crash grid: pending work is invisible to GitHub
state, lost-response retry duplicates non-idempotent effects, the
two-worker race duplicates even with read-checks, and the primary-key
claim serializes it. The decision document carries the per-need grid
with citations.

**Maintainer amendments (2026-07-23).** (1) The claims table is
retained *despite* the one-process model, and the reason is recorded
so it is not later deleted as dead code: crash-restart overlap and
at-least-once redelivery mean two executions of the same effect can
race without two long-lived workers ever existing. (2) The two grid
cells that rest on construction rather than dedicated runs (schedules,
retry bookkeeping) become stage-five exit-gate tests: a due schedule
must fire exactly once across a restart, and attempt history must
survive a mid-retry crash.

**Flips:** Q15; D1, D24, D27 (currently `replaced`, pending the
ratification names); D13 → ratified as narrowed.

## 3. Deployment model (D18, P9)

**Proposal.** One durable-first process. Recovery rests on three
demonstrated legs: durable-accept-before-ack (P9), the owned journal
for detection, and a reconciliation sweep over
`GET /app/hook/deliveries` (30-day retention) for repair. Availability
beyond business hours is an operator decision that stays with Q1/Q13
and does not block stage five.

**Hard requirement (maintainer amendment, 2026-07-23).** The
production receiver terminates GitHub's webhook POST **directly** — no
relay, tunnel, or forwarding tier. 6.2 demonstrated that any ack-first
intermediary makes GitHub's delivery ledger record success for
deliveries the receiver never saw, silently recreating P9's loss
window in a place no process discipline can fix. Relays remain
acceptable only in ring-zero development.

**Evidence.** Protocol 6.2: the acknowledged-but-lost delivery is
invisible in GitHub's ledger (reads `OK`), so detection must be local;
redelivery recovered it end-to-end. The transport-masking finding
means any relay in the path is itself an ack-first receiver — the
reconciliation leg is load-bearing even with a durable-first process.

**Flips:** D18 → ratified with the two conditions named in the
register.

## 4. First adapter operations (Q16, D20)

**Proposal.** The adapter's operation list is exactly the confirmed
rows of `design/operations/endpoint-permission-matrix.md`; its error type is
the failure catalogue (all shapes body-distinguishable). Policies the
adapter must own, from 6.4:

- bounded retry/backoff implemented in the adapter — Octokit's default
  throttling/retry plugins are disabled (they absorb the signals
  invisibly);
- secondary-limit handling keyed on body text with the documented
  one-minute floor (`FINDING(secondary-limit-no-wait-signal)` — no
  `retry-after` header exists);
- writes serialized/paced well below the content-creation onset —
  observed once at ~71 writes in 7 s, consistent with GitHub's
  documented 80-per-minute figure; treated as an untrusted bound, not
  a measured constant (maintainer amendment: the pacing margin, not
  the number, is the contract);
- ETag caching on every read path — 304s are free and steady-state
  sweep cost then tracks changed issues only (this is the Q10 budget
  answer);
- delivery ids handled only as the branded opaque-string type
  (`core/src/ids.ts`, `DeliveryId`) — ids exceed 2^53 and numeric
  round-trips corrupt them; the type makes the 6.2 finding a compile
  error instead of an operational trap (maintainer amendment,
  implemented 2026-07-23).

**Flips:** Q16, D20 → ratified.

## 5. Permission ceiling

**Proposal.** Installation permissions: `issues: write`,
`pull_requests: write`, `contents: read`, plus App-level webhook
access. Event subscriptions: `issues`, `issue_comment`,
`pull_request`, `push` — extend with `pull_request_review` only if a
ratified capability needs to observe reviews (6.6 found the current
subscription list misses it). Deliberately withheld: `checks` (probed,
403 confirmed harmless) and any `contents: write`.

**Evidence.** 6.1's permission probes; 6.3's incidental safety
property — `contents: read` means the platform *cannot modify its own
configuration*, which this review should preserve as a deliberate
invariant, not an accident; 6.6's subscription gap.

**Flips:** the production permission manifest
(`design/operations/README.md`) gains its ratified baseline.

## 6. Repository mapping model (P7)

**Proposal.** Ratify the mapping model as schema'd in
`design/config/schema.md` (`mappings.labels`, profile defaults):
stable internal meanings in code, per-repository label mappings in
configuration.

**Evidence note.** This is the one item resting on the audits and the
`core/` implementation rather than sandbox runs — the experiments
exercised config validation of mappings but no capability consumed
them. The review should ratify the model, not any specific profile.

**Flips:** P7 stays a principle; D3/D26 remain `replaced`.

## 7. First capability — input needed from stage two

The stage-two needs review (window 1–7 August) ranks the first two
candidate capabilities; stage four then ratifies the first. This is
the packet's only open input. Two experiment results constrain
whichever candidate wins:

- the capability contract needs a declared **idempotency class** per
  effect (6.5: comment-create duplicates on blind retry, label-add
  does not) and a **capability registry** checked at config load (6.3:
  unknown capability names pass validation silently) — both feed D23
  before the first capability is specified. The registry check is
  already implemented in pure logic (maintainer amendment, 2026-07-23):
  `core/parseConfig` accepts `knownCapabilities` and rejects enabled
  capabilities outside it while keeping disabled unknowns dormant, with
  invariant tests;
- its operations must already be confirmed rows in the endpoint
  matrix, or ring-zero probes must be added first;
- **retirement policy (maintainer amendment, 2026-07-23):** capability
  names are never deleted from the registry — retirement is a
  tombstone. A retired capability's name stays valid (no repository's
  configuration fails closed over a retirement; its other capabilities
  keep running) but it never activates, and the effective-config
  report says so. Only never-existed names are validation errors.
  Without this rule, retiring a capability would silently drop every
  repository that enabled it to `observe` — a breaking change nobody
  chose. Implemented in `core/src/contract.ts` (`retired`,
  `activeNames`).

## Known gaps the review should see

Recorded so ratification is made with eyes open; none blocks the gate:

1. **6.6 private-fork column untested** (setup needs a collaborator
   fork; the not-installed probe predicts the 404 result).
2. **Token-expiry failure row** in the matrix is unfilled (needs a
   >1 h-old token; mechanics otherwise confirmed in 6.1).
3. **GitHub's >10 s webhook timeout classification is untestable
   through a relay** (6.2 transport masking); needs a directly-exposed
   endpoint if it ever matters to measure.
4. **Schedules row of the storage grid** rests on construction, not a
   dedicated run (the same durable-row machinery as the journal) — now
   promoted to a stage-five exit-gate test (§2 amendment).
5. **The raw evidence is not version-controlled — by design.** The
   two decision artifacts (endpoint matrix, storage decision) now live
   tracked under `design/operations/`; the per-protocol observation
   documents and raw JSONL evidence logs stay local and untracked
   under `experiments/`. Evidence-log citation ids (`…T19-45-…#14`)
   in the tracked documents therefore refer to local files. The review
   must decide how that raw evidence reaches the approving maintainers
   — an archive attached to the gate pull request or a separate
   evidence store — because §5 ratification requires naming the
   evidence reviewed.

## Ratification mechanics

Per the register's §5 rule, each item above becomes `ratified` only
when `design/decisions.md` names the approving maintainers, the date,
and the evidence reviewed. The register's rows already carry the
evidence text; approval is an edit adding names and dates, done in the
gate-closing pull request.
