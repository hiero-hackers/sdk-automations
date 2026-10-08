# Observe pilot operations

One installation, one approved repository, one process, in `observe`. This checklist prepares
[#190](https://github.com/hiero-hackers/sdk-automations/issues/190) and
[#191](https://github.com/hiero-hackers/sdk-automations/issues/191); it grants no installation,
deployment or write approval. Dry-run and active operation need their own approval and evidence.

## Record the boundary

Before starting, the maintainers and operator fill these fields in the pilot issue. An unanswered
field keeps the pilot unready; this page does not choose a host or invent acceptable costs.

| Field | Record |
| --- | --- |
| Approval | Repository owner, approved repository, mode and issue/comment |
| Ownership | App owner, host, operator and person covering their absence |
| Version | Commit, Node version, effective configuration revision and enabled capabilities |
| Duration | Start/end in UTC, checkpoint frequency and planned downtime |
| API budget | Maximum core units and GraphQL points per installation window; other consumers of that installation |
| Storage | Available bytes, minimum free space, backup/log retention and permitted readers |
| Response | Maximum pending age/backlog, who receives failures and when they must respond |
| Recovery | Backup location, acceptable history gap, restore and rollback evidence |

Use the App ownership agreed with the maintainers. The personal development App remains a sandbox
instrument under [the operations boundary](../design/guides/operations.md).

## Before starting

- Keep one persistent `STORE_PATH` outside the checkout or image layer. Keep the private key and
  webhook secret in the host's secret store, separate from the database and backups. Restrict
  access: the database retains webhook payloads, including repository content.
- Deliver GitHub's HTTPS webhook directly through TLS termination to the receiver. An
  acknowledging relay cannot prove the receiver accepted a delivery. Confirm the App subscribes
  to the events used by the selected capability and covers only the approved repository.
- Set `APP_ID`, `PRIVATE_KEY_PATH`, `INSTALLATION_ID` and `WEBHOOK_SECRET`; omit `APP_SLUG`.
  With credentials, the effective `sdk-automations.yml` is on the repository's default branch;
  `CONFIG_FILE` is only the credential-free fallback. Its mode must be `observe`, with only the
  agreed capabilities enabled. Check mappings and permissions with the repository owner.
- Start without `SWEEP_CADENCE_HOURS`. A schedule-triggered capability will not run in this
  configuration. Add a sweep only after its scope and budget are approved and measured separately.
- Check both `/healthz` and `/readyz`: the latter must return `200 ready` after the startup drain.
  Readiness means the drain settled, not that every delivery succeeded; check startup failures and
  backlog as well. The `startup` line must say `configSource: "live"`, `writes: "absent"`,
  `sweep: "absent"`, and
  `suspended: false`. Capture stdout and stderr privately, with UTC timestamps across restarts.
- Record `pnpm shell:status`, database/log/backup sizes, available disk space and rate-limit
  readings. Use an approved delivery to establish its GUID's acceptance and completion and
  `pnpm shell:explain --item issue#<number> --repo <owner>/<repo>` (use `pullRequest#<number>`
  for a pull request). A healthy idle endpoint alone proves neither subscriptions nor useful
  decisions.

## At each checkpoint

Keep the raw record privately and publish only a scrubbed summary with evidence citations.

| Question | Evidence and limit |
| --- | --- |
| Did delivery finish? | Reconcile GitHub delivery GUIDs with `deliveryAccepted`, `deliveryDuplicate`, `deliveryCompleted` and failures across both streams. A `202` is acceptance, not a decision. Record redelivery attempts separately from distinct GUIDs. |
| Is work falling behind? | Record pending/processing/failed counts from status. For each accepted GUID, measure first acceptance to completion from log timestamps; keep unfinished GUIDs and their age in the result. Status's `delay` describes only the newest delivery. |
| Why did it decide that? | Record status's decision and unreadable counts and explain representative items, including refusals. Separate delivery counts, processing attempts and decision rows; one delivery can produce several rows. Status's decision/unreadable totals cover the last 24 hours, so overlapping checkpoints cannot be summed. |
| Is it noisy? | Count operator events on stderr and group sampled decisions by capability, verdict and code. Classify expected refusals separately from faults requiring action. Keep GUIDs/citations; `detail` is prose, not a field to parse into policy. Observe produces local records; check GitHub separately for zero App-authored changes. |
| Is storage bounded? | Record database, journal if present, logs, backups and free bytes separately. Compare like checkpoints and record accepted traffic and pruning. Retention runs only on a sweep firing: with the sweep absent, 30/90-day windows do not prune anything. Do not delete rows or enable a sweep just to improve the result. |
| What did GitHub charge? | Record core units and GraphQL points by installation/window using the method below. Include retries, configuration and ordering reads. A delivery count is not an API cost. |

Record restarts, version/configuration changes, downtime and missing log intervals beside these
measurements. A gap is unknown, not zero traffic or a successful quiet period. Preserve enough
evidence to explain every failure and refusal, not just a favorable sample.

## Measure API use honestly

`shell:status` reads the store; the running process holds the allowances. `sweepFinished.spent`
measures a firing when a sweep is armed. The current webhook-only composition emits neither
per-delivery spending nor `limits` lines, so its log cannot establish exact live API cost.
The [scripted cost rehearsal](../packages/runtime/test/shell/compose/cost.test.ts) remains offline
evidence, separate from this pilot.

For a periodic overview, the operator can read `GET /rate_limit` using an installation access token
for the same installation. Save the UTC time and `resources.core`/`resources.graphql` `limit`,
`used`, `remaining` and `reset`, never the token. A personal token measures a different budget.
This endpoint avoids primary charges but can incur secondary limits; use the agreed checkpoint
frequency rather than tight polling. GitHub's
[response headers take precedence](https://docs.github.com/en/rest/rate-limit/rate-limit)
if they disagree with the overview.

Within the same pool/reset window, changes in `used` are an observed installation total, not an
exact per-capability count. Record other consumers; if counters disagree, move backwards or cross
a reset, mark that interval unknown. Do not subtract across windows or sum REST units with
GraphQL points. Sparse snapshots miss consumption between resets. If the agreed budget needs
continuous or exact attribution, this method is insufficient and the pilot remains unready for
that claim. Secondary-limit failures must be recorded separately; remaining primary budget
does not prove their absence. See [GitHub's rate-limit guidance](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api).

## Recovery and stopping

Before relying on the host, run the
[operator rehearsal](../packages/dev/lab/protocols/8.7-backup-recovery.md#operator-rehearsal-before-a-hosted-pilot)
on the same version in observe and record its result in the pilot issue.

Stop for an unexplained accepted GUID, an unexpected App write, failed legitimate signatures,
unreadable storage, missing reports, or the agreed backlog, API or free-space boundary. The named
operator preserves the store and logs, records the stop time and notifies the agreed contact.
Do not clear the store to make startup succeed. `SUSPENDED=1` is not a replay queue: it completes
deliveries without deciding them. `KILL_SWITCH=1` still evaluates and reads; it does not stop API
spending. Use [the switch descriptions](running.md#the-two-switches) when choosing a response.

Check and archive GitHub's delivery ledger at least daily, before its
[three-day redelivery window](https://docs.github.com/en/webhooks/testing-and-troubleshooting-webhooks/redelivering-webhooks)
closes. GitHub does not automatically retry failed webhooks. The authorized App owner/manager
requests any needed redelivery and records each GUID's final outcome. Close the pilot with its
measured costs, storage growth, noise, recovery result and all unresolved gaps. Missing evidence
leaves the relevant gate open; finishing this checklist does not authorize writes.
