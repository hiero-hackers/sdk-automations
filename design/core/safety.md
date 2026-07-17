# Safety: the Destructive Actions, One Row Each

> **Drafted for ratification** — the safety engine's contract (`design/architecture.md` §4), completing
> roadmap Track A3. The engine generalises the one proven pattern in the old bots (the C++ reaper's
> warn-then-act, `planning/lessons-learned.md` keep-list): every destructive action below inherits it.
> Timing numbers are config defaults (`design/config/schema.md`) — the *structure* (that a warning
> exists, what it says, the reversal path) is policy and not configurable. Positions are **proposed**.

## 1. What counts as destructive, by trigger class

An action is destructive if it takes something from a person: an assignment, an open PR, a
conversation. The rule differs by what triggers it:

- **Clock-triggered** (derived from timestamps at sweep): **warn-then-act is mandatory** — a warning
  projection, a grace period, then the act. Never acts on the first observation.
- **Event-triggered preventive** (must act immediately to be useful, e.g. moderation lock):
  no grace period would make sense — instead **explain-and-reverse**: the act carries an immediate
  explanation comment and a one-gesture reversal.
- **Command-triggered**: none are destructive — `/unassign` is the actor releasing *their own*
  assignment; self-service on self needs no protection.

Two standing rules across all rows:

1. **Every warning names the exits.** What was observed, when the app will act, the one-line way to
   stop it now, and the one-line way to undo it afterwards. A warning that doesn't say how to stop it
   is a threat, not a warning.
2. **Every action reverses with at most one human gesture**, and the app must never fight the
   reversal (`design/core/manual-edits.md` §2 — the reversal is a human edit; the newer-fact rule
   protects it from re-derivation).

## 2. The table

| Action | Module | Trigger | Warn → act (defaults) | Reversal (one gesture) |
|---|---|---|---|---|
| **Unassign a stalled issue** (`in progress` → `ready for dev`, assignee removed) | inactivity | clock: issue-side, no open linked PR, assignee silent | 7d → 21d | `/assign` again, or a maintainer re-assigns — the class-2 repair (`design/core/taxonomy.md` §2.4) may restore `in progress` automatically |
| **Close a stalled PR** (`needs revision`, author silent) | inactivity | clock: PR-side | 10d → 60d | reopen the PR — it re-enters positionless and pr-quality (or a hand label) re-places it |
| **Lock a new issue pending approval** | intake *(provisional — ships only if the module does)* | event: issue opened, moderation on | immediate + explanation comment | a maintainer approves — unlock + `awaiting triage` |

What is *deliberately not here*: **close hygiene** (`design/core/taxonomy.md` §2.3) strips a closed
item's position labels but is bookkeeping consequent to a close a human or a merge already performed —
the destructive act was the close, and its reversal (reopen) is native. **Recommendations, level-ups,
narrations, acks** are comments — nothing to protect.

## 3. The clock's semantics

- **What resets it:** any commit, push, or comment from the assignee (or PR author), or `/working`.
  A reset also clears the standing warning projection — the item is healthy again, and a stale
  warning is noise.
- **Where "warned at" lives:** in the warning projection's core-private metadata — one of the two
  sanctioned exceptions to "projections are never inputs" (`design/architecture.md` §4), schema-
  versioned like all comment metadata. No label, no store.
- **Cooldown after reversal** *(proposed)*: a reversal restarts the clock from zero — the full warn
  lead must elapse again before the item can be re-warned. A reversal that was immediately re-warned
  would read as the app arguing with the human.
- **`blocked` freezes everything** *(proposed — the reset-on-unblock half is the open choice)*:
  while the overlay is on, the clock does not advance, the warning neither escalates nor updates
  (`design/core/manual-edits.md` §3 — blocked is absolute). On unblock the clock **resets to zero**
  rather than resuming: an item blocked at day 6 of 7 and unblocked a month later should not lose its
  assignee the next morning. **Overturned by:** ratifiers preferring resume; the engine supports
  either, the default is the generous one.

## 4. Open

- Whether the intake lock ships at all — decided with the MVP module set, not here.
- Reset-vs-resume on unblock (§3's overturn clause).
- Whether the assignment module's contract includes the auto-restore repair named in row 1
  (`design/core/manual-edits.md` §8 carries the same question).
- Exact warning template wording — build-time, against the narration format
  (`design/core/manual-edits.md` §5).
