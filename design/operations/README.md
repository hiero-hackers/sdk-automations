# Operations, Delivery, and Rollout Proposal

> This document records the operational requirements and experiments for the GitHub App. Hosting, process
> count, the storage technology and full record set, retention, and the production permission manifest
> remain open decisions.

## 1. Availability goal

The App should be safe when it is slow, restarted, or temporarily unavailable. Downtime may delay automation,
but it must not corrupt repository state or cause blind repeated writes.

An in-memory queue and a later sweep are not sufficient for a production webhook receiver. GitHub does not
automatically redeliver every failed delivery, and the service cannot claim that it accepted work if a
restart can erase that work. The recovery experiments must still decide which scheduled jobs,
pending-effect records, and reconciliation checkpoints also require durable state.

## 2. Hosting and operator

The project still prefers a hosted GitHub App because one deployment can provide consistent configuration,
permissions, adapter behavior, and upgrades across repositories. The project needs an organization-owned
operator rather than relying on one contributor's personal account.

The hosting decision must identify the following responsibilities.

- The operator stores and rotates the App private key and webhook secret.
- The operator controls deployment, kill switches, storage, backups, and retention.
- The operator monitors webhook delay, queue depth, API limits, failures, and reconciliation.
- The operator can suspend processing without uninstalling the App.
- The operator can prove whether one or several application processes are active.

A personal development App is separate from the eventual production App and is used only for sandbox work.

## 3. Webhook intake

GitHub expects the webhook endpoint to verify the signature and return a successful response within ten
seconds. A production receiver must durably accept the delivery identity and queued work before that
response. If it cannot durably accept the work, it must return a failure instead of silently losing an event.
Slow evaluation and GitHub API writes run after acknowledgement.

The intake experiment must prove this boundary. It must test duplicate delivery identifiers, manual
redelivery, delayed and out-of-order events, invalid signatures, queue saturation, process restarts, and a
delivery that is durably accepted but initially fails during processing.

Webhooks are triggers rather than an ordered source of truth. The executor reads current repository state
before a write, and reconciliation finds work that a missing event may have delayed.

## 4. Process and coordination model

The earlier design required exactly one active process because its queue and serializer lived only in memory.
That requirement is now reopened.

The hosting and storage experiments must decide whether the first production version runs one process or
several. If several processes may handle the same item, the system needs shared coordination or another
proved conflict-control mechanism. Current-state checks alone do not prevent two processes from making
opposing decisions from the same old state.

The selected model must define deployment overlap, restart behavior, poison-item handling, and how pending
work transfers to a new process.

## 5. Operational storage

GitHub remains authoritative for visible repository facts. The App may own the minimum state needed for
operational correctness.

Production-owned records include at least the durably accepted webhook work needed to survive a restart.
Additional candidate records include delivery deduplication status, scheduled jobs, effect plans, effect
attempts, unclear outcomes, reconciliation cursors, installation status, and kill-switch state.

The storage experiment compares GitHub reconstruction, App-authored comment metadata, and a small owned
store. The selected technology follows from the required guarantees, expected scale, hosting support, backup
needs, and operator capacity. The design does not choose SQLite, Postgres, or a queue before that evidence.

## 6. Rate limits and pacing

The adapter is the only component that handles GitHub rate-limit and retry behavior. Capabilities do not
implement private retry loops.

The adapter records primary and secondary rate-limit headers, uses conditional reads where supported,
paginates every list operation, paces writes, applies bounded backoff, and stops retrying when GitHub's
response says that waiting is required.

The project will measure App installation budgets and endpoint costs in the personal sandbox and again in
the Hiero Hackers sandbox. Sweep cadence follows measured fleet cost and product need rather than a
repository setting.

## 7. Failure audiences

Every failure class has one primary audience and a clear next step.

| Failure | Primary audience | Candidate channel |
|---|---|---|
| Configuration is invalid or outdated. | The repository maintainer or configuration author. | The App uses a configuration report whose final form depends on permissions. |
| A capability lacks an installation permission. | The repository owner or installation owner. | The effective-configuration report names the missing permission and blocked operations. |
| A command is refused or remains unclear. | The person who issued the command. | The App updates the command acknowledgement with the current facts and safe next step. |
| A capability repeatedly creates invalid intent. | The capability developer and operator. | Telemetry and audit records report the contract failure without posting repeated repository comments. |
| Webhook delivery or queue delay is sustained. | The operator. | Metrics and an operator alert show the installation and delay. |
| GitHub returns a sustained service or rate failure. | The operator, and the repository only when user-visible service is affected. | The adapter reports the failure and pauses unsafe retries. |
| A repository item repeatedly crashes processing. | The operator. | The queue isolates the item and records enough detail for a safe replay. |
| The executor cannot determine whether a write happened. | The operator and any directly affected command user. | The recovery record states the observed postcondition and the next reconciliation step. |

The App must not create a new repository comment for every internal retry or temporary GitHub failure.

## 8. Audit information and retention

An audit record should connect the normalized observation, effective configuration version, capability
decision, typed intent, policy result, adapter calls, final outcome, and recovery activity.

The audit record must avoid secrets and unnecessary repository content. The operator and maintainers must
decide the retention period, access control, deletion process, and whether public and private repositories
need different handling.

Repository comments are user-facing output. They are not the only operational audit record.

## 9. Kill switches

The system needs the following stop controls.

- A global operator switch stops all new processing.
- An installation switch stops one organization or installation.
- A repository mode stops workflow-changing writes for one repository.
- A capability switch stops one capability without changing another capability.
- An item-level pause may be supplied by a selected workflow profile.

The operator runbook must explain what happens to queued and pending work when each switch activates.

## 10. Rollout environments

The rollout uses the following environments in order.

1. Local tests use pure logic and an owned fake adapter without network writes.
2. A personal sandbox uses a separate development GitHub App.
3. A clearly named Hiero Hackers sandbox is used after organization approval.
4. One consenting repository runs in observe or dry-run mode.
5. One reversible capability enters an approved pilot.
6. Destructive capabilities and broader rollout require separate decisions.

Each promotion requires a clean observation period, a demonstrated kill switch, a rollback rehearsal, and a
review of new permissions. An unexplained effect stops promotion.

## 11. Migration

The old and new automation must never write the same managed state at the same time. Every pilot repository
needs an inventory of old triggers, permissions, state writes, effect writes, disablement controls, and
rollback steps.

A migration mapping may translate old repository labels or fields into the new internal meanings. The
mapping is specific to the repository and does not turn legacy spelling into universal platform policy.

## 12. Questions that remain open

- The project must choose the production host and operator.
- The webhook experiment must decide the durable-intake boundary.
- The storage experiment must decide the minimum owned state and technology.
- The hosting experiment must decide the process and coordination model.
- The first capability must determine the minimum permission manifest.
- The project must define audit retention and private-repository handling.
- The project must define the clean observation periods for each rollout gate.
- Maintainers must choose the first volunteer repository only after the sandbox evidence is available.
