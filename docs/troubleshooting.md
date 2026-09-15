# Troubleshooting

Every decision the App makes carries a code, and so does every write that did not land; every code
is in the first four tables below. The most common question — "why didn't it act here?" — is almost
always answered by the first table: the App prefers doing nothing over doing something you didn't
ask for. The last table is for the records it writes when it never got as far as a decision.

*The test suite locks the code membership and severity grouping on this page against the implementation
on every commit. The plain-language explanations still require review.*

## It did nothing on purpose

Nothing to fix — this is your configuration, or our caution, behaving as specified.

| Code | In plain terms |
|---|---|
| `killSwitch` | The intent-level emergency gate is on; returned intents are refused after capability evaluation |
| `modeDisabled` | Your file says `disabled`; enabled capabilities may be evaluated, but every screened intent is refused |
| `modeRecordsOnly` | Your file says `observe` or `dry-run` — both record the action instead of applying it, and `dry-run` also names what it would have done in a `wouldApply` line beside this one |
| `observation` | It was only ever a read; there was nothing to apply |
| `capabilityDisabled` | The capability is `enabled: false` (or absent) in your file |
| `itemBlocked` | A human marked the item `blocked`, so the App keeps its hands off |
| `itemClosed` | The issue or pull request is closed or merged; the App stops there |
| `newerHumanChange` | Someone edited the item after the App decided — your edit wins |
| `preconditionStale` | The authoritative current state was unavailable, conflicted, or no longer matched the requested precondition, so the App stopped |
| `graceRunning` | The App warned, and is waiting out exactly the grace it announced before it acts |
| `activityCancelled` | Activity during the warning period cancelled the destructive action |

## It needs something from you

| Code | What to do |
|---|---|
| `permissionMissing` | The installation lacks a permission; the message names the exact grant |
| `humanOrderingUnknown` | The App could not tell whether a human acted after it, so it chose not to act — usually a delivery gap; if it persists, tell us |

## It decided, and the write did not land

These are the applier's own codes, below any verdict: the act was approved and the call did not
land. Nothing is lost — the sweep meets the effect again — except where the row says a person or
your file has to move.

| Code | In plain terms |
|---|---|
| `leaseHeld` | A live worker holds this effect's lease, so this pass did nothing; the next one asks again |
| `sweepRequestCap` | The sweep's share of one of GitHub's pools — the detail names which — was spent, so the act was held back until that window resets |
| `sweepWriteCap` | This tick had spent the writes one sweep may send, so the act was held back; the next tick decides it again |
| `rowUnreadable` | The ledger's bytes for this call could not be read, so the call is closed and nothing was resent |
| `ledgerInconsistent` | The ledger holds a history the App cannot read as one effect; `pnpm shell:explain` prints it, and clearing it is a person's job |
| `configurationChanged` | Your `automations.yml` changed after this effect started, so nothing more was sent under the file it began under |
| `identityMissing` | The approved effect carried no managed-comment identity to post under — a defect; please open an issue with the code |
| `labelUnmapped` | Your file maps no label to the position this capability wants, or to the one being displaced; the App never guesses a label name |
| `itemUnreadable` | The item could not be read at apply time, so the live re-check could not run; re-tried each sweep |
| `externalsUnavailable` | The apply-time facts — grants, kill switch, human ordering — could not be built; re-tried each sweep |
| `writeConflict` | GitHub refused the call as conflicting: nothing landed and nothing will, so the effect is settled |
| `writeForbidden` | GitHub refused the call outright; the effect is settled, and a `permissionMissing` refusal is the grant you can fix |
| `writeRetryLater` | GitHub asked for a wait, or this hour's content-creation ceiling was reached; the call stays open and a later pass resumes it |
| `writeUnknown` | Whether the call landed could not be established; nothing is resent until a read of GitHub settles it |
| `writeUnsupported` | The platform has no confirmed endpoint for this write yet; the intent stands and is re-tried each sweep |
| `postconditionUnconfirmed` | GitHub accepted the call, but the read-back did not confirm the state it should have left behind |

`pnpm shell:explain <effect-id>` prints one effect's whole history and where it stands, and
`pnpm shell:explain --item issue#40 --repo owner/repo` prints an item's effects and its decisions; `pnpm shell:status`
prints the queue, open sends, standing warnings, the sweep row and the last day's decisions. All three read only.

## It should never happen

These indicate a defect in a capability or the platform — never in your configuration. If you see
one, please open an issue with the code.

`wrongEntryPoint` · `preventiveGateUnavailable` · `invalidTimestamp` · `wrongActionClass` ·
`noWarning` · `warningRequestMismatch` · `invalidDestructivePlan` · `graceBelowFloor`

## It never got as far as deciding

These are not decision codes. They are the kinds of record the App stores when it finishes a delivery
without deciding anything, so no capability, item or intent is named in them — the cause is the file
or the delivery, not the work.

| Kind | In plain terms |
|---|---|
| `configRejected` | Your `automations.yml` did not parse or did not validate; the errors are named in [Every way the file can be wrong](configuration.md#every-way-the-file-can-be-wrong), and redelivering the same event cannot repair a file |
| `installationSuspended` | The endpoint serving you was started with `SUSPENDED=1`, so it verified and accepted your delivery and then finished it without deciding: no configuration was read, no capability ran, and nothing was sent. The delivery is complete and will not be reconsidered when the suspension lifts, so ask your operator to restart the endpoint without `SUSPENDED=1` — the next event on the item is decided normally |
| `modeUnsupported` | Your file says `mode: active`, and the endpoint serving it was started as a composition that wires no write path — so it is rejected before a decision rather than acted on. That is still the shipped default: writes are armed only when the endpoint is given the App's identity as well as its credentials (`APP_SLUG`, see [Running the shell](running.md)). Until then, choose `observe` or `dry-run` |
| `repositoryMismatch` | The delivery came from a different repository than the one this endpoint was started for, so nothing about it was read — point the webhook at the right endpoint, or start the endpoint for the right repository (`REPO_OWNER`/`REPO_NAME`) |

## After the store was rebuilt

The store carries no compatibility history until the platform launches, so a file written before an
upgrade is refused rather than converted: the endpoint does not start until that file is removed, and
the one it creates holds nothing. Your repository is unaffected — the decisions and the effect
history are the App's own record — but the fleet is **cold for one sweep**. Every open item is read in
full instead of being decided from its last read, which spends more of the rate limit than usual and
can spread the first pass over several ticks. The next sweep is warm again, and stays warm across a
restart.

`snapshotUnreadable` in the log says a firing found stored reads it could not decode and says how
many. Each is read again and rewritten, so one firing repairs them; a line that comes back every
firing is a defect — please open an issue with the count.
