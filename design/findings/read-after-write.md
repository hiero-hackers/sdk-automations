# Read-after-write staleness

**Answer (D46, protocol 6.7): no staleness observed — every write was visible on the first read.**
The rule still spends one delay on the "absent" side, because a wrong "absent" duplicates.

## Measured

On a dedicated probe issue in the personal sandbox, paced ~2 s per trial:

| Write → read | Trials | Visible on FIRST immediate read | Median to visible | p95 | Max | Citation |
|---|---|---|---|---|---|---|
| create comment → list comments | 25 | **25 / 25** | 299 ms | 462 ms | 514 ms | `2026-07-25T21-00-55-057Z#79` |
| add label → read issue | 15 | **15 / 15** | 238 ms | 352 ms | 352 ms | `2026-07-25T21-00-55-057Z#140` |

The to-visible times include the confirming read's own round-trip (~200–300 ms); with every trial visible
on the first read, **no replication staleness was observed at all** — the measured "lag" is HTTP latency,
not eventual consistency.

## Honest limits of the measurement

Forty trials, one repository, one day, low write contention, REST list endpoints only. GitHub documents no
read-after-write guarantee, so this is evidence of *typical* behavior, not a contract. A rare stale read
remains possible, and the failure it would cause (a duplicated non-idempotent effect) is exactly the one
the design exists to prevent — so the rule below spends one cheap delay on the asymmetric side anyway.

## The freshness rule this decides

- `readBack` may answer **"present" on first sight** — a visible effect is a landed effect.
- `readBack` may answer **"absent" only after two reads at least one second apart** (observed p95 is
  462 ms; 1 s is ~2× that). "Absent" triggers a re-send, and for non-idempotent calls a wrong "absent"
  duplicates — the second read is insurance priced at one API call, only on the rare recovery path.

The read-back constants landed in the adapter on 2026-09-02 (`packages/adapter/src/readback.ts`:
presence on first sight; absence only after a clock-confirmed gap of at least one second, else
`unknown`). The executor that consumes them remains unbuilt. Re-measure if the resolver ever uses
GraphQL or search-based reads — those paths were not measured and search indexing is known to lag.
