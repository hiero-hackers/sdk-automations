# What we observed about GitHub

Everything else in `core/` encodes a decision the project made. Those change
only when someone decides differently, and until then they stay true.

**This directory is different. Its contents can become wrong while nobody
touches them,** because they describe a live system that is free to change
underneath us. Green tests here do not mean correct — they mean the code
still agrees with what we measured on the date below.

## What belongs here

One question decides it:

> Could GitHub change, and make this file wrong, with nobody having edited it?

**Yes** → it belongs here. **It encodes a rule we chose** → it belongs
elsewhere, however much it mentions GitHub.

The line is easy to blur, so two worked examples:

- `capability/catalogue.ts` names operations like `postManagedComment`. That
  reads like GitHub, but it is *our* closed vocabulary (D61) — the endpoint it
  becomes is the adapter's business, outside `core/` entirely. **Not here.**
- `workflow/positions.ts` has `awaitingTriage`. Also not GitHub: P7 and D71
  make these platform meanings that repositories map onto their own labels.
  **Not here.**
- `github/ids.ts` exists because REST delivery ids exceed 2^53
  (`FINDING(delivery-id-precision)`). If GitHub changed its id format, this
  file would be wrong tomorrow with no commit in between. **Here.**

That last one was genuinely arguable — the branding *mechanism* is a shared
primitive, and only the *reason it exists* is an observed fact. It is recorded
here so the question is settled once rather than re-litigated per file.

## Provenance, and how each file goes stale

D40 makes re-probing a standing obligation. This table is where that
obligation lives next to the code it governs, rather than only in the register.

**Where to look first:** `failures.ts` exports `BODY_PATTERNS` — the only two
places this package reads GitHub's prose, each carrying the text it was
written against, its probe date, and the experiment that produced it. The
re-probe is: compare each `observed` sample against what GitHub says now. A
test asserts every pattern still matches its own sample, so editing one
without the other fails rather than drifting.

| File | Probed by | Date | Goes stale when | First symptom |
|---|---|---|---|---|
| `failures.ts` | experiments 6.1, 6.4 | 2026-07-23 | GitHub rewords error bodies | a rise in `forbiddenUnrecognized` classifications |
| `rate-limits.ts` | experiment 6.4 | 2026-07-23 | header semantics or the secondary-limit floor change | waits that are far too short, or absent |
| `ids.ts` | experiment 6.2 | 2026-07-23 | delivery id format changes | duplicate deliveries surviving dedup |
| `permissions.ts` | GitHub's docs | documented | the `scope:level` form changes | a real grant failing `isPermissionGrant` |
| `signatures.ts` | GitHub's docs | documented | the signing scheme changes | every delivery rejected at the door |

The last two rows carry no probe date on purpose. They hold **documented**
knowledge — things GitHub publishes and would announce changing — so they are
in the table for coverage, not for the re-probe. They also fail LOUDLY, which
is the whole contrast with the three rows above them.

**Cadence:** quarterly for the dated rows, plus ad-hoc whenever the
first-symptom column starts showing up in operator reports. **Owner:**
unassigned — falls out of Q13, and is one of the unfilled rows in
`design/build-plan.md` §14.

## Why the failure mode is quiet

`failures.ts` classifies GitHub responses by matching prose in the body. When
GitHub rewords a message, the regex stops matching and the response degrades to
`forbiddenUnrecognized` — deliberately, so a reworded error surfaces as
"unknown" rather than being confidently misdiagnosed as something it is not.

That is the right behaviour and it is also why nothing breaks loudly. The
tests keep passing, because they assert against recorded fixtures rather than
against GitHub. **The fixtures and the world drift apart in silence, and only
the re-probe closes the gap.**

## Not yet here, but expected

As the platform reaches GitHub, more observed knowledge will want this home —
at which point subdirectories may start to earn their keep:

- `endpoints.ts` — the confirmed operation list from
  `design/operations/endpoint-permission-matrix.md`.
- `subscriptions.ts` — the webhook subscription list, including the
  `pull_request_review` gap experiment 6.6 found.
- the read-after-write freshness rule (D46, experiment 6.7), which is not
  implemented by the runnable application and must be owned by the eventual
  GitHub write path.

The repository's graduation test is that **a directory becomes a package when
it has external consumers and almost no internal ones.** Measured today, this
directory satisfies the first clause and fails the second.

### The case for splitting into its own package

**A change cadence nothing else here shares.** Every other directory in
`core/` encodes a decision the project made; it stays true until someone
decides differently. This one holds dated measurements of a live system, and
D40 makes re-probing a standing quarterly obligation. A package boundary would
make "this rots, the rest does not" *enforced* rather than merely written
down — its own version, its own release notes, its own reason to be reviewed
on a clock.

**Its own reason to distrust green tests**, set out at the top of this file.
That warning applies here and nowhere else in `core/`.

**Real consumers outside `core/`, now three.** `store/` and `shell/` take the
branded delivery ids; `shell/` and `lab/` both verify signatures. That is the
first clause of the graduation test, met.

### The case against splitting *today*

**It is no longer uncoupled, and that is the decisive change.** An earlier
version of this section argued the split from *zero* internal coupling — that
nothing in `core/` imported this directory, so it was already a package in
everything but name. That is no longer true. Five files across three
directories import it: `capability/declaration.ts` and `capability/catalogue.ts`
for `PermissionGrant`, `safety/types.ts` and `safety/rules.ts` for the same
type and `missingPermissions`, and `engine/decide.ts`. The permission
vocabulary in particular has become load-bearing for the safety engine.
Splitting now would not extract a leaf; it would put a package boundary in the
middle of core's own dependency graph.

**The direction is still clean, which is why there is no urgency.** This
directory imports nothing from its siblings. `core/` has two roots — `config/`
and this one — and every arrow still points one way. A boundary in the wrong
place is worse than no boundary; an acyclic graph with a root in the right
place costs nothing to leave alone.

**The consumers it has are thin.** Three packages, but between them they pull
a branded type, its constructor, and the signature verifier. Roughly 410 lines
of source for that is overhead, not architecture.

**It would move register citations again.** Rows cite paths in this directory,
and those paths had already moved once during the reorganisation. Churning
evidence links is not free in a project whose method is that a decision cites
the code proving it.

**The package count is unstable.** `probes/` is scheduled for deletion when
stage four names the first capability, and a `shared/` package may appear if
D74 and D75 are accepted. Adding another package into that is churn on top of
churn.

**The directory already earns most of the benefit.** The provenance table, the
inclusion test, and the D40 obligation are all here and all working. A package
would add version independence and a compiler-enforced boundary — and the
boundary is the part that has become expensive.

### The trigger

**Split it when the adapter is built** — stage five.

The adapter is *entirely* GitHub-observed knowledge, so it is the first
consumer that makes an enforced boundary pay for itself — unlike the three
thin ones this directory has today. It will want every file in the list above:
`endpoints.ts` from the permission matrix, the ratified permission ceiling to
sit beside the `scope:level` form already here, `subscriptions.ts` for the
subscription list, and the read-after-write freshness rule. That rule is not
implemented by the runnable application and belongs with the eventual GitHub
write path.

**The trigger is now two conditions, not one.** The adapter is the first. The
second is what the coupling section measures: while `capability/`, `safety/`
and `engine/` all import this directory, splitting it hands `core/` its first
internal workspace dependency — today its only dependency is `yaml`. Either
that coupling comes down first, or the split accepts that cost with its eyes
open and says so in the register row.

**A measurable secondary signal**, if the adapter is delayed: when this
directory holds more files than any other directory in `core/`, it has stopped
being a corner of core and should leave regardless. Standing at six, one
behind `config/` and `workflow/`.

### What would change the answer sooner

- A re-probe finding that fixtures drift faster than quarterly, which would
  make an independent release cadence worth having on its own.
- The permission vocabulary being extracted from `core/` on its own account —
  it is the single reason the internal coupling exists, and moving it would
  satisfy the second trigger condition without touching anything else here.
- A decision that `core/` must be publishable with no GitHub knowledge in it
  at all — a stronger claim than anything the register currently makes, and
  one that would settle this by principle rather than by cost.
