# Threat Model: Structured Paranoia, One Pass

> **Drafted for ratification — belongs in the memo**, so the mitigations become commitments rather
> than intentions. Scope: the hosted app as designed across this corpus. Method: enumerate what an
> attacker touches (the trust boundaries), what they could take (the assets), and what answers each
> threat — split into **designed** (already in the corpus), **new commitments** (this document adds
> them), and **accepted residual** (named, bounded, lived with).

## 1. The ceiling everything hangs from

The app holds `issues:write · pull-requests:write · contents:read` and nothing else. Whatever is
compromised — a contributor account, a maintainer account, the config, even the App key itself —
**the app cannot be made to touch code, merge a PR, or alter a release.** Labels, comments,
assignments, and reactions are the entire blast radius, all visible in GitHub's UI and audit log,
all recoverable. Every threat below should be read against that ceiling; it is the reason this
document is one page and not ten.

Assets, in the order an attacker would rank them: the **App private key** (org-wide writes within
the ceiling); the **shared rate budget** (availability, `operations/README.md` §4); **repo state
integrity** (making the app do wrong-but-in-scope things); the **app's voice** (org-branded comments
that people trust and GitHub notifies on).

## 2. The threats

| # | Threat | Vector | Answer | Status |
|---|---|---|---|---|
| T1 | Forged or replayed webhooks | POST to the endpoint | HMAC verified before anything runs; replays land on idempotent observation (`already`) | designed |
| T2 | Command griefing — `/assign` spam burning budget and voice | any account can comment on a public repo | per-actor command budget + gate ordering + reply rate-limit (§3.1) | **new** |
| T3 | Content injection through the app's voice | issue titles / logins echoed into projections | echo policy + authorship checks (§3.2) | **new** |
| T4 | Config as weapon | repo config file, `_extends` chain | same-org, one-level `_extends`; schema floors; PR-diff loudness (§3.3) | **new** + designed |
| T5 | Compromised maintainer account, amplified by automation | hand edits carry human seniority (`core/manual-edits.md` §2) | the ceiling; decision-log forensics; mass-edit anomaly alert | accepted residual (§4) |
| T6 | Compromised App key / operator plane | secret store, deploy pipeline | custody + rotation (`operations/README.md` §2); kill switches; the ceiling | accepted residual (§4) |
| T7 | Event-storm DoS (bulk-label import → webhook flood) | GitHub events are attacker-cheap | backpressure: bounded queues, shed, sweep heals (§3.4) | **new** |
| T8 | Supply chain | npm deps, CI | pinned lockfile, minimal deps, audit in CI; default-branch-only workflows (audit keep-list) | **new** (build gate) |

## 3. The new commitments

### 3.1 Commands: the actor pays before the app does

- **Per-actor, per-repo command budget** in the shell (order of a few commands per minute) — checked
  *before* anything expensive. Gate ordering is the rule: syntax → actor cooldown → cheap invariant
  checks → expensive resolver calls (`eligibleLevel`'s searches) last. A spammer costs the app
  almost nothing.
- **Refusal replies are themselves rate-limited per actor**; past the threshold the app degrades to
  reaction-only, then silence + telemetry. The bot must never be the amplifier that turns one
  spammer into a wall of org-voiced replies.
- **Comment edits are not commands.** Only comment-*created* events dispatch; an edit after the 👀
  ack cannot re-trigger or retarget anything.

### 3.2 The app's voice: echo policy

- Projections echo **only titles, logins, and numbers — never bodies**, and everything echoed is
  neutralized: wrapped as code spans, `@` de-fanged (no echoed mention may ping), HTML comments
  stripped — an injected `<!-- hiero:… -->` in a title must never survive into a rendered comment,
  or markers become spoofable.
- **Authorship is part of every marker check**: a marker, metadata payload, or processed-reaction
  counts only when *the app itself* authored it. A 👀 added by anyone else to someone's command must
  not make the sweep skip it (denial), and a fake marker comment must not be adopted as the app's
  own.

### 3.3 Config: contained, floored, loud

- `_extends` resolves **same-organisation only, exactly one level** — no external repos, no chains,
  no loops. (A repo's own config already only affects that repo — registry projection is the
  containment.)
- **Schema floors on every timing knob**: `warnAfterDays: 0` must be a validation error, not an
  instant reaper. Safety being non-configurable (`config/schema.md` §3) is completed by minimums on
  what *is* configurable.
- The config-PR validation comment (`operations/README.md` §5) is a security control, not just UX:
  it states the effective diff — "this enables X, changes `_extends` to Y" — so a config change
  sneaked into an unrelated PR is loud at review time.

### 3.4 Backpressure: safe-to-drop

The shell's queues are bounded; beyond the bound, events are shed and the sweep reconciles.
Correctness never depends on processing any particular event — this is `operations/README.md` §1's
safe-to-be-down generalised to safe-to-shed, and it is the DoS answer: an event storm costs
latency, never state.

## 4. Accepted residuals, named

- **A compromised triage-or-above account** can steer automation via hand labels (human seniority is
  the design, D7). Amplification over what that account could already do natively is small and
  bounded by the ceiling; the decision log gives forensics the old system never had. Mass-edit
  anomaly detection is an operator alert, not a block.
- **A compromised App key** can spam and mislabel org-wide until the kill switch — but cannot touch
  code. Custody, rotation, and the GitHub audit log bound the window; recovery is label-level.
- **GitHub itself** is trusted: its permissions model is our tier system, its API our substrate.
  A GitHub compromise is out of scope by definition.

## 5. Open

- Exact command-budget numbers and reply thresholds — measured at ring 0 with everything else.
- Whether mass-edit anomaly detection ships in v1 telemetry or later.
- A red-team pass on the echo policy against the first real projection templates, before ring 1.
