# Operations — what runs today

> **What runs, and who has to be able to run it.** The shell verifies and durably accepts
> deliveries, persists one canonical report, and exposes process, repository, capability and item
> stop controls. Alerting, backups, reconciliation and runbooks are unbuilt, and the operator
> surfaces that would need them are not described here. Measured answers live in [`../findings/`](../findings/).

## 1. The operator

Whoever takes the operator role must be able to:

- store and rotate the App private key and the webhook secret;
- control deployment, kill switches, storage, backups, and retention;
- monitor webhook delay, queue depth, API limits, failures, and reconciliation;
- suspend processing without uninstalling the App;
- prove whether one or several application processes are active.

- One process serves one installation and owns one store; every repository the installation covers is
  served by it, and each is decided under its own `automations.yml` (D169).
- One deployment gives every repository the same permissions, adapter, and upgrades.
- It needs an organization-owned operator, not one contributor's personal account (Q1, Q13).
- A personal development App is separate from the production App (P8).
- The personal App is only ever used for sandbox work.

The records that role owns: the canonical delivery report (what was decided and why) and the effect
ledger (what reached GitHub). Neither carries a secret or repository content it does not need, and
**repository comments are user-facing output, never the operational audit record.** Who may read
either, and how a record is deleted on request, are open (Q17). How long each is kept is D166's, and
every sweep firing runs all three windows:

| Window | Kept | Prune |
|---|---|---|
| Done deliveries, each with its report | 30 days | `inbox.pruneCompletedDeliveries` |
| Decision rows (D163) | 30 days | `ledger.pruneDecisions` |
| Settled effects, whole and never by row (D161) | 90 days | `ledger.prune` |
| Stored item reads (D193) | the item stays open, and 90 days | `ledger.prune` |

An effect with an open send is kept however old, and so is one whose warning promised an action
still ahead: the promise outlives the window. Nothing prunes outside a firing, and a firing says
`sweepPruned` only when something went. A stored read is normally dropped long before the window,
by the firing whose open-item list no longer carries its item; the window is what removes the reads
of a repository nobody sweeps any more. A read carries no payload — the groups of one item, as
instants — and is rebuilt by the next read of that item.

## 2. Intake

- **The production receiver terminates GitHub's POST directly.** No relay, tunnel, or forwarding tier.
- Protocol 6.2 showed why: an acknowledging relay is structurally an ack-first receiver.
- GitHub's ledger then records `OK` for deliveries the receiver never saw.
- That recreates P9's loss window somewhere no process discipline can reach.
- Relays are acceptable only in ring-zero development.

## 3. Pacing

- **The adapter is the only component handling rate-limit and retry behaviour.**
- **Capabilities never implement a private retry loop.**
- The adapter records primary and secondary rate-limit headers, one slot per pool.
- It uses conditional reads where supported and paginates every list operation.
- It paces writes and applies bounded backoff.
- The sweep spends one allowance for the process: `SWEEP_SHARE` of each pool's own reported limit,
  in GitHub's units and over GitHub's window, 0.4 by default (D192, D193).
- `SWEEP_WRITE_CALLS` is a per-tick lane on that allowance, 20 by default (D167), and
  `CONTENT_CREATION_HOURLY` bounds comment creation across both lanes, 400 by default.
- It stops retrying when GitHub's response says waiting is required.
- Measured budgets (Q10):
  [`../findings/endpoint-permission-matrix.md`](../findings/endpoint-permission-matrix.md).

## 4. Kill switches

| Switch | Stops | Built |
|---|---|---|
| Process/global | every returned intent after capability/resolver evaluation | `KILL_SWITCH=1`; intake still records and reports the refusal |
| Installation | one organization or installation | `SUSPENDED=1`; intake still verifies and accepts, and records `installationSuspended` (D171) |
| Repository mode | one repository's approved effects | all four modes are core vocabulary; a process composed without the App's identity records `modeUnsupported` for `active` |
| Capability | one capability, leaving others alone | `capabilities.<name>.enabled: false` or omission |
| Item-level pause | every capability write on an item | mapped `blocked` meaning → `itemBlocked` |

- All five levels have code paths today. The process switch is an intent-level safety refusal, not a
  transport or evaluation shutdown; suspension is the one level above evaluation, since it decides
  nothing and reads nothing; an unsupported `active` is intercepted earlier still, before `decide()`
  runs. The item pause is currently global to all capabilities rather than profile-selective (D117).
- What each switch does to queued and pending work, which is what the operator runbook owes:
  - **Process/global.** Queued deliveries are still claimed and decided, and every intent the
    decision returns is refused `killSwitch`; a send left open is refused the same way, not resent.
  - **Installation.** Queued deliveries are verified, accepted and recorded `installationSuspended`,
    so none is redriven later; nothing is read or sent, and a send left open stays open until the
    switch lifts.
  - **Repository mode.** From the next delivery that reads the file, that repository's work is
    decided and recorded rather than applied; a send left open is closed `modeRecordsOnly`.
  - **Capability.** From the next delivery that reads the file, that capability returns nothing and
    every other one is unaffected; a send left open is closed `capabilityDisabled`.
  - **Item-level pause.** Queued work naming the item is refused `itemBlocked` for every capability;
    a send already made is resolved on the call it holds, because a resume meets only the
    item-independent gate.

## 5. Before the App writes to a repository it does not own

- Old and new automation must never write the same managed state at the same time (Q7).
- Every pilot repository needs an inventory first: old triggers · permissions · state writes ·
  effect writes · how the old writer is disabled · how the change is rolled back.
- A migration mapping may translate old labels or fields into internal meanings. It stays specific to
  that repository and never becomes universal platform policy.
- A renamed mapped label stops that capability's label work and is reported; the App does not
  recreate the old label, guess the new name, or change existing items.
