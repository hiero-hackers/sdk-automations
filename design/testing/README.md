# Test Strategy for the GitHub App Platform

> The test strategy must prove capability isolation, GitHub adapter behavior, effect recovery, configuration
> safety, and rollout controls. Specific frameworks will be selected with the implementation.

## 1. Test boundary

Capabilities are tested against platform interfaces that this project owns. GitHub response shapes are
handled and tested at one adapter boundary.

This design preserves the strong per-handler testing found in the C++ automation while adding tests for the
seams that the old system could not verify. It avoids giving every capability a separate hand-written model
of GitHub.

## 2. Test layers

| Layer | What the layer proves | External dependency |
|---|---|---|
| Pure platform logic | Configuration merging, policy, compatibility, safety, and intent validation behave deterministically. | The layer has no external dependency. |
| Capability unit | One capability produces the expected intent from normalized observations and its own configuration. | The layer uses owned platform fakes. |
| Capability conformance | The capability cannot use undeclared configuration, resolvers, intents, permissions, or sibling capabilities. | The layer uses the registry and type boundary. |
| Adapter contract | Normalized reads and narrow writes match GitHub's documented and recorded behavior. | The layer uses recorded GitHub fixtures and selected sandbox calls. |
| Effect recovery | Duplicate delivery, unclear responses, partial multi-call effects, restarts, and concurrent human edits converge safely. | The layer uses the real executor with controlled adapter failures. |
| Configuration integration | Default-branch loading, strict YAML validation, dormant settings, schema errors, effective values, permission mismatch, and rollback behave safely. | The layer uses repository fixtures and sandbox configuration changes. |
| Composition | Supported capability combinations preserve declared compatibility and ownership rules. | The layer uses the real platform and a fake adapter. |
| End-to-end sandbox | The GitHub App installation, webhook, token, API, configuration, storage, and recovery path work together. | The layer uses a development App and personal sandbox. |
| Replay and shadow | A new version evaluates recorded or live read-only observations without unexplained differences. | The layer uses sanitized audit records or approved shadow traffic. |

## 3. Capability conformance kit

The kit derives tests from the capability declaration.

- The kit verifies that disabled capabilities receive no events or schedules.
- The kit verifies that only the declared configuration is visible.
- The kit verifies that undeclared resolvers and intents are unavailable.
- The kit verifies that missing permissions prevent writes.
- The kit verifies dry-run output for every declared intent.
- The kit verifies repeated observations without duplicate effects.
- The kit verifies stale expectations and newer human changes.
- The kit verifies capability-specific disablement and rollback.
- The kit verifies every declared compatibility rule.

Passing the conformance kit shows that the capability follows the platform contract. It does not prove that
the capability policy is desirable. Maintainer review and capability-specific tests provide that evidence.

## 4. Adapter fixtures

The project should record real GitHub payloads and API responses from approved sandbox traffic. Every fixture
records the source endpoint, event, API version, capture date, sanitization, and expected normalization.

Hand-written fixtures remain acceptable for impossible or security-sensitive fault injection when the test
clearly identifies them as synthetic. The suite must not pretend that a synthetic fixture proves real GitHub
behavior.

The adapter suite must cover pagination, `null` and missing fields, redirects, conditional reads, rate-limit
headers, secondary limits, validation errors, forbidden responses, timeouts, and lost responses after a write
may have succeeded.

## 5. Recovery matrix

Every multi-call effect is tested with failure after each call and before each verification read. The matrix
includes the following scenarios.

- The same webhook delivery arrives again.
- A different delivery describes the same current state.
- Events arrive out of order.
- GitHub applies a write but the response is lost.
- The process stops before recording progress.
- The process stops after recording progress but before the next call.
- A human makes the same change while the App is stopped.
- A human makes an opposing change while the App is stopped.
- A permission is removed during recovery.
- The mapped label or managed comment is renamed, edited, or deleted.
- Two executor processes attempt the same or opposing effects when the selected hosting model permits that
  scenario.

The expected result must be `applied`, `already`, `conflict`, `forbidden`, `retryLater`, or `unknown`. The
test fails when the executor guesses success from an API response without verifying the postcondition.

## 6. Configuration matrix

The configuration suite covers absent, empty, valid, invalid, unknown-key, outdated, and future-version
files. It covers default-branch changes, pull-request-only changes, disabled capabilities with dormant
settings, mapping conflicts, missing or renamed labels, missing fields, missing permissions, mode changes,
and rollback.

The suite proves that no configuration and invalid configuration cause no workflow-changing writes. It also
proves that every capability remains off when omitted or explicitly disabled, including when a workflow
profile provides settings.

## 7. Security tests

The security suite covers invalid webhook signatures, replayed deliveries, command spam, forged markers,
untrusted mentions and markup, oversized configuration, permission reduction, queue saturation, and secret
redaction.

The App never runs pull request code with its write credentials. Fork and private-repository behavior is
tested with the development App before the corresponding capability is offered.

## 8. Required checks by stage

| Stage | Required evidence |
|---|---|
| Every pull request | Pure logic, capability unit, conformance, configuration, security, and deterministic failure-injection tests must pass. |
| Release candidate | Adapter contracts, effect recovery, supported composition, migration, and replay tests must pass. |
| Personal sandbox | Real webhook, token, API, storage, disablement, and rollback tests must pass. |
| Hiero Hackers sandbox | Observe, dry-run, reversible-write, kill-switch, and clean-soak evidence must pass. |
| Volunteer pilot | Maintainer approval, shadow comparison, rollback rehearsal, and an agreed clean observation period are required. |

## 9. Questions that remain open

- The implementation must choose the test frameworks and fixture storage format.
- The project must define how sandbox records are sanitized and retained.
- The storage decision must determine database and queue integration tests.
- The hosting decision must determine process-overlap and deployment tests.
- The first capability must define policy-specific cases beyond the conformance kit.
- Maintainers must define the clean observation period for a pilot.
