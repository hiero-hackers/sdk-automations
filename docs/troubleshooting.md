# Troubleshooting

Every decision the App makes carries a code, and every code is in the three tables below. The most
common question — "why didn't it act here?" — is almost always answered by the first table: the App
prefers doing nothing over doing something you didn't ask for.

*Every table on this page is asserted against the code by the test suite, on every commit — the
reference cannot drift from the product.*

## It did nothing on purpose

Nothing to fix — this is your configuration, or our caution, behaving as specified.

| Code | In plain terms |
|---|---|
| `killSwitch` | The emergency stop is on; nothing writes anywhere |
| `modeDisabled` | Your file says `disabled` |
| `modeRecordsOnly` | Your file says `dry-run` — the action was recorded, not applied |
| `observation` | It was only ever a read; there was nothing to apply |
| `capabilityDisabled` | The capability is `enabled: false` (or absent) in your file |
| `itemBlocked` | A human marked the item `blocked`, so the App keeps its hands off |
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
