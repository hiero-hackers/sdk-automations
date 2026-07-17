# Config Draft: `.github/hiero-automation.json`

> **Non-normative** — a concrete object for the schema decision. Values come from the audited C++/Python
> systems; labels are `taxonomy-draft.md`'s set. Rule of shape: `core` is read by the core alone; each
> `modules.<name>` block is read by that module alone, and is the whole config it can see.

## Goals and non-goals

Project-level vision lives in `planning/goals.md`; these are the goals of the *config design* itself —
the principles behind every key kept or cut.

**Goals**

- **Readable in one sitting.** A maintainer reads this one commented file and knows everything the
  automation will do to their repo. If a key needs the architecture docs to understand, it is misnamed.
- **Scales down to nothing and up gradually.** No file = nothing destructive. An empty module block is a
  complete, working adoption of that module. Knobs refine; they are never required.
- **A knob only where repos genuinely differ.** Every remaining knob answers a real either/or between two
  reasonable repos (pool capacity, patience). A key that would be `true` in every sane config is not a
  choice — it is the module's behaviour, and lives in code.
- **One source of truth per fact.** Labels for lifecycle state, native fields for what GitHub already
  models, config for numbers and the canonical sets — no fact stored twice.

**Non-goals**

- **Duplicating GitHub's permission model.** No role tiers, no team management — the platform already
  decides who may act directly; the app only serves those who cannot.
- **Configurable safety.** Warnings, the command surface, and the meaning of `status: blocked` are policy.
  A config that could switch them off would be a config that breaks the promises in `goals.md`.
- **Completeness.** This file will never hold a key for every behaviour. The default posture for a new
  setting proposal is *no* — it enters only by the either/or test above.

## 1. The repo file

```jsonc
{
  "_extends": "hiero-ledger/.github",   // start from the org defaults; anything here overrides them

  "core": {
    "teams": {
      "maintainers": "@hiero-ledger/hiero-sdk-cpp-maintainers"   // who the app pings and trusts
    },
    "labels": {
      // The complete label set — a label not listed here does not exist.
      "status": [
        "status: awaiting triage",      // new, nobody has looked yet
        "status: ready for dev",        // triaged, free to pick up
        "status: in progress",          // assigned, being worked
        "status: needs review",         // PR open, checks passed
        "status: needs revision",       // reviewer asked for changes
        "status: ready to merge",       // approvals met
        "status: blocked"               // pause flag on top of any of the above
      ],
      "skill": [
        "skill: good first issue",
        "skill: beginner",
        "skill: intermediate",
        "skill: advanced"
      ],
      "meta": [
        "meta: open to community review"   // human signal to browsers; automation never touches it
      ]
    },
    "skillLadder": {
      // What /assign checks before giving someone an issue at each level:
      // e.g. to take a "beginner" issue you must have completed 2 good first issues.
      "skill: beginner":     { "requires": "skill: good first issue", "count": 2 },
      "skill: intermediate": { "requires": "skill: beginner",         "count": 3 },
      "skill: advanced":     { "requires": "skill: intermediate",     "count": 3 }
    }
  },

  "modules": {
    // A module listed here is on. Not listed = off. No file at all = nothing destructive runs.

    "intake": {},
    // Labels every new issue "awaiting triage". When an issue reaches "ready for dev"
    // (however that happened), checks it has a skill label and comments if not.

    "assignment": {
      "maxOpenAssignments": 2           // caps /assign users only — i.e. contributors
    },
    // Handles /assign and /unassign, checking the ladder above. People with repo
    // permissions (triage and up) assign natively in GitHub and are never limited:
    // the cap exists to keep the ready-for-dev pool from being hoarded by
    // contributors, not to manage the team.

    "inactivity": {
      "issue": { "warnAfterDays": 7,  "unassignAfterDays": 21 },  // assigned, but no PR yet
      "pr":    { "warnAfterDays": 10, "closeAfterDays": 60 }      // changes requested, no response
    }
    // The clock runs ONLY while the contributor holds the ball: "in progress" (no PR)
    // and "needs revision" (changes requested). It NEVER runs in "needs review" or
    // "ready to merge" — waiting on maintainers is not the contributor's inactivity —
    // and "blocked" pauses it like everything else. Closing real code gets far more
    // patience (60d) than releasing an untouched issue (21d).
    // Silence = no commit, push, or comment from the assignee; any of those resets the clock.
  }
}
```

## 2. The org defaults it extends

```jsonc
// hiero-ledger/.github → .github/hiero-automation.json
{
  "core": { "labels": { /* the one canonical set, so every repo agrees */ } },
  "modules": {
    "inactivity": {
      "issue": { "warnAfterDays": 7,  "unassignAfterDays": 28 },  // gentler org-wide defaults,
      "pr":    { "warnAfterDays": 14, "closeAfterDays": 90 }      // same keys as the repo file
    }
  }
}
```

Repo values override org values, key by key. **Turning a module on is repo-local**: the org file can set
defaults for a module but never enables it — a module runs only if the repo's own file lists it.

## 3. What is deliberately not configurable

- **Commands.** The full set is `/assign`, `/unassign`, `/working` — commands exist only for contributors,
  who cannot act directly; maintainers use the label picker. No command has a config key.
- **Warnings before destructive actions.** Always on; only the timing is a knob.
- **`status: blocked` pauses everything** — transitions and the inactivity clock. It is the one
  "automation, leave this alone" flag, and a maintainer applies it by hand.
- **Whose turn it is.** The inactivity clock only ever runs in the contributor-ball states
  (`in progress`, `needs revision`). No configuration can make it act on an item that is waiting on
  maintainers — a review backlog must never cost a contributor their assignment.
- **Priority and effort.** Native GitHub fields, read through the core when a module needs them — nothing
  to configure until one does.
- **Role tiers.** There are none. Limits apply to command users (contributors); anyone with repo
  permissions acts natively and is outside them by construction — GitHub's permission model is the tier
  system, and the config does not duplicate it.

Every knob that remains answers a question two repos would genuinely answer differently: how many issues
one person may hold, and how patient the two inactivity clocks are. Everything else is behaviour the module
either does or, switched off, doesn't.
