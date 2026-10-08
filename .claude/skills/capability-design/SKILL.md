---
name: capability-design
description: Author or revise a capability design doc in design/guides/capabilities/ — the section structure, config conventions, guard patterns, and bot voice this repo's capability docs follow. Use when designing a new capability, rewriting an old-style candidate doc, or reviewing edits to one.
---

# Designing a capability for sdk-automations

Read the nearest exemplar first: the design docs beside their code in `packages/capabilities/src/`.
A new design starts in `design/guides/capabilities/` and moves into its capability's folder the day
that folder exists. Start from what exists — the C++ and Python SDK bots and `design/findings/services.md`
— and make a difference between two SDKs two example configs of one schema, not two features.

## The page

`# name — the one-sentence job` (lowercase, matching the config key). Then, only while phases are
outstanding, one line: `Not built: phases 2–3`. Nothing else above the first section, and no
banners. Then exactly four sections, in this order.

1. **What the output looks like** — every comment the capability posts, rendered, in blockquotes.
   The only place in the page rendered examples appear. Fail and unknown states included.
   **Every value a rendered comment interpolates must be traceable to a field on `CapabilityView`
   or on the facts.** The view carries mapped NAMES and no spellings (contract.md §2), so a comment
   may say "this repository's `working` command" and may not print `/working`; a mention the
   platform prepends cannot be placed mid-sentence; repository text arrives through `inert()`, so a
   configured address prints as text rather than as a link. Voice: greet by name, name the reason,
   the fix and the date; never scold. No markdown links with placeholder targets — write "the
   Signing Guide (configured link)".
2. **What the config looks like** — full `sdk-automations.yml` blocks, valid YAML, one per genuinely
   different policy. Prose only for what the examples cannot show. Read every key against the
   constructor table in `design/guides/capability-kits.md` §3: a shape with no constructor is the
   design's to move (§3.3), and moving it after the code is written costs the code.
3. **How it works** — what it acts on and never acts on; one mermaid flowchart with the guards in
   evaluation order — never the three the platform performs (closed items, an unanswered resolver, a
   label with no edge); a table where the behavior is tabular (per-check semantics, ladders); and the
   declaration and the phases as two short tables, or dropped where the code says it. The declaration
   table names `triggers`, `resolvers`, `intents`, `requiredMappings` (write `none` rather than
   omit the row), `facts`/`needs` only when a schedule trigger or a group read makes them
   non-obvious, and a `Platform needs` row (durable state, cross-item coordination, external
   delivery) as the review question it is. An intent's explanation summary says what the capability
   asked for, in the past tense of the act — "Placed the new issue in triage.", "Asked for a linked
   issue on this pull request." — never the observation that led to it. No rendered
   examples. Name every platform piece a scenario needs and does not have — catalogue entries,
   resolvers, sweep drivers, mapping families — where it is needed. Name a gap by its COST: a
   registry row, a fact-shape change (a field or group on both interfaces, every producer, every
   fixture), or a read with no confirmed endpoint.
4. **Verified by** — `Scenario | Proves`. This table IS the spec of the edge cases: counting rules,
   races, dedup, dry-run, kill switch, human sovereignty, and it is the test agenda.

## Config conventions

- **One block shape at every level**: a block is `enabled: true` and its own keys beside it, the
  capability's own block included — there is no `settings:` wrapper under a capability name.
- **Explicit consent**: everything is opt-in; blocks carry `enabled: true`; "truthy is not consent".
  `enabled` is reserved at every level, so no spec may declare a key of that name. Never hang
  children off a scalar (`issues: true` + children is invalid YAML).
- **Meaning-sets and numbers**: guards are lists of mapped meanings (`claimableOnlyWhen`,
  `capIgnores`, `exemptWhen`) or numbers — never raw label strings. Check whether an existing
  meaning already expresses the rule before inventing config.
- **Clocks are durations**: a whole number with a unit — `4h`, `2d`, `14d` — never a bare number,
  never minutes, weeks or mixed units. They resolve most-specific-first (reason → ladder →
  capability default), each act threshold must exceed its remind threshold by `MIN_GRACE_HOURS`
  where warn-then-act applies, and **a destructive clock declares `atLeast: MIN_REAP_HOURS`**. Both
  rules go **on the level that consents**: a level that only passes a clock down declares neither.
- **Per-item blocks** when items may grow options — a second option kind is the trigger to convert
  booleans to blocks.
- **Mapping families**: label spellings under `mappings.labels`, command spellings under
  `mappings.commands`, skill tiers under `mappings.skills` — shared vocabulary never moves into a
  capability's settings. A guard naming a meaning demands its mapping (unmapped = invisible).
- Inline comments state constraints on the keys they constrain; deny wins when meaning-sets
  conflict; misconfiguration is "rejected with the file, not silently ignored".

## Design rules that recur

- Advisory before destructive; warn-then-act behind the destructive gate; unknown never reads as
  pass, "under the cap", or "no conflict" (D51).
- Capabilities compose through meanings and timeline events, never by naming a sibling or parsing a
  sibling's comment prose (P3).
- Native GitHub controls are never fought; roles are never read — the native UI is every team
  member's bypass.
- Commit text and titles are attacker-controlled: escaped, mentions broken.
- Repo-local counting; org-wide reads are the parked ceiling question (D57).
- Managed comments: one per identity, updated in place; refusals cycle-scoped.

**Finishing:** run `pnpm contracts` FIRST — it rewrites every generated artifact, and a check
comparing one you did not regenerate is red about a file you never edited. Then `pnpm test` in
`packages/dev/checks`, and give a direction change a register row.
