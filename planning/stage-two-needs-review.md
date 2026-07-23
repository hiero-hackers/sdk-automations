# Stage-two needs review — discussion pack

Prepared 2026-07-23 for the stage-two window (1–7 August 2026,
`design/build-plan.md` §5). The exit gate is a ranking of the first two
candidate capabilities, backed by maintainer evidence — this pack is
the collection instrument, not the answers. The audit-derived detail
for each candidate lives in `design/modules/`; this pack adds what the
stage-three experiments now let us say about each candidate's real
cost, so the ranking conversation happens against facts.

## 1. The six questions for every session

From the build plan, asked per repository (C++, Python, JavaScript
SDKs, one minimal-automation repository, any pilot volunteer):

1. Which automation is essential to you today?
2. Which automation causes mistakes you have to clean up?
3. Which work still costs maintainer time that automation could take?
4. Which actions must always remain human?
5. Which permissions would be unacceptable for an installed App?
6. What is the smallest capability that would actually help you?

Record answers per repository, not per person; disagreement between
repositories is signal (P7), not noise.

## 2. Candidate sheet

For each candidate, the maintainer-supplied fields to fill during the
review, per the build plan: **requesting repositories · current
behavior · policy variation · required permissions · safe disablement
· GitHub-native alternatives.** The audit already drafts the middle
four in each module document; the review confirms them and fills the
first and last.

What the experiments add per candidate — read before ranking:

| Candidate | Permissions vs. proposed ceiling (`issues:w`, `pulls:w`, `contents:r`) | Experiment-derived constraints |
|---|---|---|
| `intake` | within ceiling | Effects are label/comment writes: label-add is idempotent, comment-create is not (6.5) — intake's comment effects need the managed-comment marker path. |
| `assignment` | within ceiling | Command-driven: per-actor budgets must fit the measured write ceilings (6.4: ~80 content-creations/min, unsignaled). Claim races are real — two workers duplicated without an owned claim (6.5). |
| `pr-quality` | within ceiling | All required operations are confirmed matrix rows incl. on fork PRs (6.6). The natural first candidate on feasibility grounds; demand must still justify it. |
| `inactivity` | within ceiling, **plus** schedules | Destructive: gated behind D10/D30 (grace floor) and needs the owned store's schedules table (6.5) — cannot ship before the storage decision is ratified and implemented. Build plan already defers it to a later safety gate. |
| `notifications` | within ceiling | Highest write-volume exposure: every notice is a non-idempotent comment write into the unsignaled secondary limit (6.4). Needs coalescing rules before it is rankable. |
| `review-routing` | within ceiling, **plus** the `pull_request_review` event subscription the App currently lacks (6.6) | Routing needs review observations; the subscription gap must be closed first. |
| `progression` | needs org-wide data beyond a single installation | Out of scope for the first milestone by its own module doc; collect demand only. |
| `admin` | **exceeds ceiling** (administration permissions) | Ranking it first would reopen the permission ceiling; the review should treat it as evidence-gathering only. |

## 3. Suggested ranking rubric

Score each candidate the maintainers actually request on four axes;
rank by the weakest axis, not the average:

1. **Demand** — how many repositories asked, and how concretely
   (question 6 answers beat question 1 answers).
2. **Permission cost** — within the proposed ceiling, or does it grow
   the ceiling? (Growing it restarts the 6.1 permission evidence.)
3. **Effect risk** — idempotent reads/labels at one end;
   non-idempotent or destructive effects at the other (6.5's classes).
4. **GitHub-native alternative** — if a branch protection rule or
   CODEOWNERS entry does the job, the capability must beat it clearly.

## 4. What stage four consumes

The top two candidates feed the stage-four review as its "first
capability" input (see `planning/stage-four-review-packet.md` §7).
Whichever wins must then satisfy the two contract requirements the
experiments added to D23: a declared idempotency class per effect, and
presence in the platform's capability registry checked at
configuration load.
