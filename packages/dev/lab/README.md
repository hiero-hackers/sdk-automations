# automation-lab — the standing instrument

One job: **facts about GitHub's behaviour that only contact with GitHub can verify.** Tests verify
our code; the lab verifies our beliefs about someone else's system. Conclusions never live here —
they migrate to `design/` as register rows (D32) — and the protocols stay with the instrument that
executes them: `src/scrub.ts` is the capture rules, `src/capture.ts` the receiver,
[`src/rehearsal/`](src/rehearsal/README.md) protocol 8.6 as one command, `src/action/` protocol
9.1 as one command, and `src/probes/` the conformance instrument whose stamped results
[`conformance.test.ts`](../checks/test/conformance.test.ts) holds to every confirmed read.

Ground rules: a personal sandbox repository only, never a Hiero one (P8, D22); bounded hostility —
we measure GitHub's behaviour, we do not hammer it; and fork code is never executed with App write
credentials (6.6). Copy `.env.example` to `.env` to run anything here.

Tracked: `protocols/`, `src/`, `test/`, `probe-results.json` (shapes only). Never tracked:
`harness/`, `evidence/`, `.env` — enforced by
[`never-tracked.test.ts`](../checks/test/never-tracked.test.ts), not by `.gitignore` alone. The raw
evidence logs are held privately because they embed whole webhook payloads, so a protocol's citation
id resolves into that archive and a dangling citation in a published document is expected, not an
error; the protocols themselves carry no secrets, credentials, tunnel URLs or personal identifiers.

## The protocols

| Protocol | What it measures |
|---|---|
| [6.1](protocols/6.1-installation-auth.md) | installation and authentication |
| [6.2](protocols/6.2-webhook-delivery.md) | webhook delivery, and the loss window an ack-first receiver opens |
| [6.3](protocols/6.3-configuration.md) | reading the configuration file |
| [6.4](protocols/6.4-adapter.md) | the adapter's reads, quotas and conditional requests |
| [6.5](protocols/6.5-recovery-storage.md) | recovery and storage — the protocol that produced a decision |
| [6.6](protocols/6.6-forks.md) | fork and private repositories |
| [6.7](protocols/6.7-read-after-write.md) | read-after-write staleness (D46) |
| [6.8](protocols/6.8-linked-issues.md) | linked-issue semantics (D123) |
| [6.9](protocols/6.9-sweep-and-check-reads.md) | the sweep's reads and the pull-request checks |
| [6.10](protocols/6.10-destructive-writes.md) | the two destructive writes |
| [6.11](protocols/6.11-review-facts-fields-labels-mentions.md) | review facts, issue fields, a missing label on add, and team mentions — the reviews design's four unknowns |
| [6.12](protocols/6.12-updated-at.md) | which events move an item's `updated_at` — the snapshot's key |
| [6.13](protocols/6.13-read-path-secondary-limit.md) | the read-path secondary limit and whether a 304 costs a point |
| [6.14](protocols/6.14-define-label.md) | defining a label the repository lacks |
| [6.15](protocols/6.15-lock-unlock-issue.md) | locking and unlocking one issue, including read-back and repeated calls |
| [6.16](protocols/6.16-assign-issue.md) | assigning one login, and what GitHub answers for a login it cannot assign |
| [7.1](protocols/7.1-capture.md) | capturing webhook payloads as normalizer fixtures |
| [7.2](protocols/7.2-webhook-conformance.md) | re-provoking every captured webhook and holding its delivery to the normalizer's reads |
| [8.1](protocols/8.1-shell-soak.md) | the shell soak |
| [8.2](protocols/8.2-first-effects.md) | the first effects sent for real |
| [8.3](protocols/8.3-close-on-a-mode-claim.md) | closing a pull request on a mode claim |
| [8.4](protocols/8.4-read-side-pilot.md) | the read-side pilot: what a cold and a warm firing charge |
| [8.5](protocols/8.5-pr-dashboard-pilot.md) | the prDashboard dashboard on a real pull request |
| [8.6](protocols/8.6-triage-queue-live.md) | the triage queue on real issues: open, lock, label, unlock, with real webhooks |
| [8.7](protocols/8.7-backup-recovery.md) | restoring a backed-up store and resuming only the work it remembers |
| [9.1](protocols/9.1-action-conformance.md) | each captured event, provoked for real, reaching the run the journeys table says: `SANDBOX_REPO=… GITHUB_TOKEN=… ENGINE_COMMIT=<full sha> pnpm lab:action [capability …]`, dry-run only, restored on every exit |
| [9.2](protocols/9.2-first-effects-as-an-action.md) | 8.2's writes, idempotence and kill switch from an action run |
| [9.3](protocols/9.3-grace-across-runs.md) | a warning honoured across three runs: refused inside the grace, acted on after it, cancelled by `/working` |
| [9.4](protocols/9.4-same-second-events.md) | 8.6's same-second changes as two runs under the concurrency group |
| [9.5](protocols/9.5-fork-pull-request.md) | a fork's pull request under `pull_request_target`: no head code runs |
| [9.6](protocols/9.6-re-run-of-an-old-run.md) | a day-old run re-run: live facts, stale cause refused, nothing written |
| [9.7](protocols/9.7-budget.md) | the hourly sweep on 300 open items against the token's request budget |
| [9.8](protocols/9.8-the-60-day-rule.md) | GitHub's 60-day rule for scheduled workflows, and the re-enable path |
| [9.9](protocols/9.9-the-pilot-shape.md) | all five capabilities together in `active`, one write each, no write twice, no shared label |
