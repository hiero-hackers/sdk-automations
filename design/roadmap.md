# Pilot-ready v0

## Outcome

One installation observes a real repository with bounded GitHub use. An operator can explain its
decisions, restart it, and recover its store. Active writes require separate approval and proof.

[Milestone #2](https://github.com/hiero-hackers/sdk-automations/milestone/2) tracks the remaining
pilot work. The adapter, write path, PR dashboard, and initial triage queue are built. A hosted
pilot, complete triage outcomes, and assignment are not complete.

## Next gates

1. Finish the disposable-repository triage rehearsal in
   [#189](https://github.com/hiero-hackers/sdk-automations/issues/189). Keep `lockUntilTriaged` off
   by default until clean ready-label unlock and template-labelled entry pass live. Record the
   decisions and effects, not just the visible result.
2. Choose the temporary App owner, pilot host, and operator in
   [#191](https://github.com/hiero-hackers/sdk-automations/issues/191). Prove direct webhook
   delivery, health, restart, backup, restore, and rollback with a durable store.
3. Run [#190](https://github.com/hiero-hackers/sdk-automations/issues/190) in `observe` on one
   approved repository. Sophie conditionally approved Analytics after the prior tests pass and
   the App is installable. Its owner must install and configure it. Dry-run and active writes need
   their own approval and evidence.
4. Use pilot findings to finish triage outcomes, then build the smallest useful assignment flow.
   Keep one owner for each automatic state transition. Do not add automatic triage or
   cross-capability state repair without a demonstrated need and a clear ownership rule.

## Independent work before wider rollout

[#192](https://github.com/hiero-hackers/sdk-automations/issues/192) measures per-capability costs
and onboarding bursts. This can proceed while the live pilot awaits credentials and hosting.
The credential-free [cost rehearsal](../packages/runtime/test/shell/compose/cost.test.ts) covers
inactivity first enabled on an existing repository and 100 repositories sharing the sweep's pool
across reset windows. It uses the composed client, fact reader, engine, and store. The
[sweep guide](guides/sweep.md#3-cost) records its scope and costs. Webhook-capability costs, live
write costs, mixed-lane bursts, and secondary-limit behavior at fleet scale remain open.

[#194](https://github.com/hiero-hackers/sdk-automations/issues/194) tracks the Vitest 5 update.
Retry only after the upstream Stryker runner fix is released. Keep mutation thresholds unchanged.

## Working rule

Keep each change independently reviewable. Prefer one process, one durable store, and existing
capability seams until real use shows a missing abstraction. Unknown facts prevent unsafe writes;
retries must not duplicate effects; every effect must be explainable from the store.
