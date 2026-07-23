# Owned operational store

The four-table single-file SQLite store decided by protocol 6.5 —
`design/operations/storage-decision.md` — **ratification pending** under
the stage-four review. Built ahead of stage five because every layer of
the platform foundation rests on it.

| Table | Role | Evidence status |
|---|---|---|
| `seen_delivery` | delivery dedup by guid (opaque string — ids exceed 2^53) | decided in 6.5; exercised by this package's tests |
| `effect_journal` | intent/done write-ahead rows; the recovery loop's detector | crash-proven in the 6.5 sandbox grid |
| `effect_claim` | one-winner lock per effect | race-proven in the 6.5 sandbox grid |
| `schedule` | clock-triggered work; `pending → running → done` | decided in 6.5; exactly-once-across-restart is a stage-five exit-gate test, pre-covered here |

Design rules (from the evidence, not preference): every write is one
synchronous statement so crash state is always "everything before the
last returned call"; tables are independent — no foreign keys, no
joins; `sentUnknown` is deliberately unresolvable from the journal
alone — callers must resolve against GitHub state before retrying (the
recovery loop in the storage decision).

Requires Node 22.5+ (`node:sqlite`). `pnpm test` runs typecheck plus
the crash-simulation suite (fresh instance on the same file = the
restarted process).
