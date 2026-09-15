# automation-lab — the standing instrument

One job: **facts about GitHub's behaviour that only contact with GitHub can verify.** Tests verify
our code; the lab verifies our beliefs about someone else's system. Conclusions never live here —
they migrate to `design/` as register rows (D32) — and the protocols stay with the instrument that
executes them: `src/scrub.ts` is the capture rules, `src/capture.ts` the receiver, and `src/probes/`
the conformance instrument whose stamped results
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
| [7.1](protocols/7.1-capture.md) | capturing webhook payloads as normalizer fixtures |
| [8.1](protocols/8.1-shell-soak.md) | the shell soak |
| [8.2](protocols/8.2-first-effects.md) | the first effects sent for real |
| [8.3](protocols/8.3-close-on-a-mode-claim.md) | closing a pull request on a mode claim |
| [8.4](protocols/8.4-read-side-pilot.md) | the read-side pilot: what a cold and a warm firing charge |
