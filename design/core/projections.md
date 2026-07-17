# Projections: Every Comment the App Writes

> **Drafted for ratification.** The projection engine is the core part that owns every comment,
> reaction, and issue the app authors (`design/architecture.md` §4). The kinds already exist across
> the corpus — this document assembles them under one contract and, most importantly, keeps the old
> system's A2 disease (services reading each other's rendered text, `planning/lessons-learned.md`)
> structurally impossible. Positions are **proposed**.

## 1. The contract, five rules

1. **Rendered from state, never read as input.** A projection is a pure function of
   `(observed state, config)`. The core offers modules **no API to read any comment** — the A2 cure
   is the absence of the operation, not a convention. The only comment-reads the core itself performs
   are finding its own marker, plus the two registered exceptions (§3).
2. **Single writer, marker-keyed, one per kind per item.** Every projection opens with an HTML-comment
   marker (`<!-- hiero:<kind>:v<schema> -->`); the core finds-or-creates by marker and **updates in
   place, never appends**. Update-in-place is also the politeness mechanism: GitHub edits do not
   re-notify watchers, so a re-render never re-pings anyone.
3. **Idempotent and churn-free.** A re-render that produces identical content performs no write —
   sweeps must not cause comment-edit noise or spend write budget (`design/operations/README.md` §4).
4. **Schema-versioned metadata.** Any machine-readable payload inside a projection carries the schema
   version in the marker; v(n) must read v(n+1) (additive changes only within a rollout soak,
   `design/operations/README.md` §3).
5. **Resolved, not deleted** *(proposed)*: when the condition behind a projection clears, it is edited
   down to a one-line resolved note rather than deleted — the thread keeps its audit trail, the noise
   is one line, and the full record is the decision log anyway (`design/operations/README.md` §6).
   **Overturned by:** maintainers preferring deletion; the engine supports either.

## 2. The kinds

| Kind | Trigger | Audience | Defined in |
|---|---|---|---|
| **narration** | incoherent manual state (classes 1, 2, 4) | repo maintainers | `design/core/manual-edits.md` §5 |
| **safety warning** | clock passes warn lead | the assignee / PR author | `design/core/safety.md` |
| **health issue** | installation-level problem (one open issue max) | repo maintainers | `design/operations/README.md` §5 |
| **config validation** | PR touching `.github/hiero-automation.json` | the config editor | `design/operations/README.md` §5 |
| **command ack** | slash command received / completed / refused | the commenter | `design/operations/README.md` §5 |
| **module content** | a module requests it (pr-quality dashboard, intake validation nudge, progression recommendations, notifications) | per module | each module's spec |

The last row is the load-bearing one: **modules never write comments themselves.** A module hands the
core structured content; the core owns the marker, the rendering, the idempotent update, and the
write through the adapter. This is what makes rule 1 enforceable — a module *cannot* read another's
dashboard because no module ever holds a comment at all. (The old Sibling-Conflict-reads-the-dashboard
failure, lessons A2, is thereby unwritable.)

## 3. The exception register

Exactly two projections carry metadata the core later reads back. This register is the governance
mechanism: a third exception enters by amending this section, with the same scrutiny §1 rule 1 exists
to enforce — not by quietly reading a comment somewhere.

| Exception | What is read back | Why no alternative |
|---|---|---|
| **safety warned-at** | the warning's timestamp + schema-versioned metadata | warn-then-act needs durable memory of "warned at T"; no label can carry a timestamp, and the app has no store (`design/architecture.md` §4.1) |
| **command ack marker** | the 👀 reaction's presence | the processed-marker that lets the sweep find un-acked commands after downtime — commands become durable with no store (`design/operations/README.md` §5) |

## 4. Open

- Resolved-vs-deleted (§1 rule 5's overturn clause).
- The exact marker namespace and schema-version format — build-time, fixed before ring 0.
- Whether the health issue pins (GitHub pinned issues need no extra scope) — cosmetic, decide at build.
- Per-kind render templates — build-time, against the narration format's three parts (what was
  observed · what the app did or awaits · the one-line remedy).
