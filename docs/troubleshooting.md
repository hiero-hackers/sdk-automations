# Troubleshooting

Every decision the App makes carries a code, and every code is in the first three tables below. The
most common question — "why didn't it act here?" — is almost always answered by the first table: the
App prefers doing nothing over doing something you didn't ask for. The last table is for the records
it writes when it never got as far as a decision.

*The test suite locks the code membership and severity grouping on this page against the implementation
on every commit. The plain-language explanations still require review.*

## It did nothing on purpose

Nothing to fix — this is your configuration, or our caution, behaving as specified.

| Code | In plain terms |
|---|---|
| `killSwitch` | The intent-level emergency brake is on; returned intents are refused after capability evaluation |
| `modeDisabled` | Your file says `disabled`; enabled capabilities may be evaluated, but every screened intent is refused |
| `modeRecordsOnly` | Your file says `observe` or `dry-run` — both record the action instead of applying it, and `dry-run` also names what it would have done in a `wouldApply` line beside this one |
| `observation` | It was only ever a read; there was nothing to apply |
| `capabilityDisabled` | The capability is `enabled: false` (or absent) in your file |
| `itemBlocked` | A human marked the item `blocked`, so the App keeps its hands off |
| `itemClosed` | The issue or pull request is closed or merged; the App stops there |
| `newerHumanChange` | Someone edited the item after the App decided — your edit wins |
| `preconditionStale` | The authoritative current state was unavailable, conflicted, or no longer matched the requested precondition, so the App stopped |
| `graceRunning` | A destructive action is still inside its warning period |
| `activityCancelled` | Activity during the warning period cancelled the destructive action |

## It needs something from you

| Code | What to do |
|---|---|
| `permissionMissing` | The installation lacks a permission; the message names the exact grant |
| `humanOrderingUnknown` | The App could not tell whether a human acted after it, so it chose not to act — usually a delivery gap; if it persists, tell us |

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
| `modeUnsupported` | Your file says `mode: active`, and the endpoint serving it was started as a composition that wires no write path — so it is rejected before a decision rather than acted on. That is still the shipped default: writes are armed only when the endpoint is given the App's identity as well as its credentials (`APP_SLUG`, see the shell's README). Until then, choose `observe` or `dry-run` |
| `repositoryMismatch` | The delivery came from a different repository than the one this endpoint was started for, so nothing about it was read — point the webhook at the right endpoint, or start the endpoint for the right repository (`REPO_OWNER`/`REPO_NAME`) |
