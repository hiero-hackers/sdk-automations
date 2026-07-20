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
| **safety warned-at** | warning time; before a destructive change, a pending or completed record with the item, edge, `expect`, safety fact, requested state, and plan version | the app needs this record to finish safely after a crash; a label cannot hold it, and the app has no owned store (`design/architecture.md` §4.1) |
| **command ack marker** | whether the command was received or completed; before a change, a pending or completed record with the item, edge, `expect`, command comment ID, requested state, and plan version | after downtime, the app must tell the difference between a new command, an unfinished command, and a completed command (`design/architecture.md` §4; `design/operations/README.md` §5) |

For either exception, the core writes and reads back `pending` before making the first GitHub change. It marks
the record `completed` only after it reads the item and sees every requested change. If a newer reason for a
change exists, the old record is closed without another write. Modules never see this metadata and still
cannot read comments.

## 4. Voice: the templates are a product surface

The bot's comments are the entire contributor experience of this system, and the difference between
a warning that reads as a countdown to punishment and one that reads as a colleague checking in is
the difference between automation a community tolerates and automation it resents. Every template,
every kind, follows these rules:

- **Colleague, not cop.** Every message is help: it states a fact and hands over the exits. The
  remedy is never buried — it is the point of the message.
- **Facts and exits, never threats.** Not *"WARNING: this issue will be unassigned in 3 days"* but
  *"No activity here for 7 days — still on it? `/working` keeps it yours. If life happened,
  `/unassign` sends it back to the pool and it's here when you're back; otherwise I'll do that on
  the 21st so someone else can pick it up. Your work stays in your fork either way."* Same
  information, opposite relationship.
- **No blame, no exclamation marks, no bot-cutesiness.** Plain, warm, brief. Personality is
  earned through usefulness, not emoji.
- **Brevity budget:** warnings ≤4 sentences; acks and narrations ≤2. A bot that writes essays
  trains people to stop reading it — and an unread warning fails `safety.md`'s first rule.
- **The embarrassment test**, applied at template review: *would a maintainer be embarrassed to
  have written this to a first-time contributor?* If yes, rewrite.

The contributor-facing summary of all behaviour, written in this voice, is
`design/contributors.md` — the bot's own comments link to it.

## 5. Open

- Resolved-vs-deleted (§1 rule 5's overturn clause).
- The exact marker namespace and schema-version format — build-time, fixed before ring 0.
- Whether the health issue pins (GitHub pinned issues need no extra scope) — cosmetic, decide at build.
- Per-kind render templates — build-time, against the narration format's three parts (what was
  observed · what the app did or awaits · the one-line remedy).
