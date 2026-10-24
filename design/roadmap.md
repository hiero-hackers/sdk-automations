# Roadmap

## Outcome

Hiero SDK repositories run this engine as a GitHub Action: a repository adds a workflow file and
`sdk-automations.yml`, and nothing is hosted. The Action is the vehicle. The hosted shell stays
until the Action has run in two repositories, then is retired. Done is two repositories in
`active` for 30 days, every Python SDK bot migrated or declined in writing, and `v1.0.0` attested.

The plan, phases A to J, lives beside the repository rather than in it: the folder
`sdk-automations-action-delivery-2026-10-16/`, file `sdk-automations-action-delivery-plan.md`.

## Where it stands

- **Phase B, the Action shell, is merged** ([#231](https://github.com/hiero-hackers/sdk-automations/pull/231),
  [#232](https://github.com/hiero-hackers/sdk-automations/pull/232),
  [#233](https://github.com/hiero-hackers/sdk-automations/pull/233)): a run maps one event to one
  delivery or the hourly sweep, arms writes only when a capability's mode is `active` and `arm-writes` is
  `"true"`, and writes a job summary of every decision and effect.
- **Phase C, the sandbox**: protocols 9.1 (conformance for all five capabilities), 9.2 (first
  effects) and 9.4 (same-second events) passed on 2026-10-17, and `action-conformance.yml` runs them
  with 9.6 (a re-run of an old run) every night, passing since 2026-10-18 (D234). 9.3 (grace across
  runs) ran once and found D231's defect, with no verdict recorded. 9.5 (a fork pull request), 9.7
  (the sweep's budget), 9.9 (the pilot shape) and 9.10 (a mode per capability) are not yet run;
  9.8 is a documentation protocol.
- **Hardening is merged** ([#234](https://github.com/hiero-hackers/sdk-automations/pull/234)): the
  comment budget, the Action's inputs and checks, and a testkit that serves GitHub as a process.
  A capability's block may state its own `mode`
  ([#236](https://github.com/hiero-hackers/sdk-automations/pull/236), D236).
- **Released**: `v0.1.0` on f528791 (2026-10-18) and `v0.1.1` on 14aa7e8 (2026-10-19), both
  pre-releases. The major tag `v0` moves with each.
- **Observe on analytics** (Phase E) is live since 2026-10-21
  ([analytics#530](https://github.com/hiero-hackers/analytics/pull/530)): pinned to `v0.1.1`,
  `mode: observe` on the file and on every block, `arm-writes: "false"`.

## Next

1. **Promote analytics** (Phase E): dry-run, then each capability active by its own written
   approval. That last step reads as a diff: the file goes to `active` with every block stating
   `mode: dry-run`, and a capability's approval is the pull request deleting its block's `mode:`
   line — one line, naming it, which configReport answers by listing it as going live (D236).
2. **Docs** (Phase D): the quickstart, installing and troubleshooting pages carry the Action.
3. **Python SDK migration** (Phase G): each bot becomes a capability, dry-run beside the running
   bot for seven days, then one pull request that removes the bot and sets the capability active.
4. **Second repository and v1.0** (Phase H): the JavaScript SDK first, then the tag.
5. **Retire the hosted shell** (Phase I): the receiver, the jobs, the store's delivery tables, the
   Dockerfile and `running.md`, in one pull request after H.

Phase F, finishing the shipped capabilities, goes by demand.

## Working rule

Keep each change independently reviewable. Prefer one process, one durable store and the existing
capability seams until real use shows a missing abstraction. Unknown facts prevent unsafe writes;
retries must not duplicate effects; every effect must be explainable from GitHub. A decision
register row records only a belief about GitHub or about safety. A lab protocol runs before any new
endpoint is written to.
