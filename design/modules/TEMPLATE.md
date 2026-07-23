# Candidate Capability: Name and One-Sentence Job

> This document describes a candidate capability. Its status must be stated as an idea, an approved
> experiment, a selected milestone, or an implemented capability. A candidate is not a product commitment.

## 1. Maintainer need and evidence

Explain the maintainer problem in complete sentences. Name the repositories or audits that provide
evidence, and state what still needs direct confirmation. If no maintainer has asked for the capability,
say that clearly.

## 2. The capability boundary

State the one outcome that this capability owns. Explain what remains manual and what belongs to another
candidate capability. The capability must not import, call, enable, or disable a sibling capability.

## 3. Candidate declaration

Show the information that the implementation would declare through the capability contract.

```ts
{
  name: "candidate-name",
  configSchema: CandidateConfigSchema,
  triggers: ["named webhook event", "optional scheduled evaluation"],
  observations: ["named normalized observation"],
  resolvers: ["named shared resolver"],
  intents: ["named narrow intent"],
  permissions: {
    repository: ["issues:read"],
    organization: [],
  },
  operationalNeeds: {
    schedule: false,
    durableState: "candidate",
    crossItemCoordination: false,
    externalDelivery: false,
  },
}
```

The declaration is a design sketch until an experiment proves that the adapter can support it reliably. The
document must explain every `candidate` or `required` operational need in section 8.

## 4. Configuration and repository mappings

List every proposed setting and its safe default. Explain why two reasonable repositories might choose
different values. Describe mappings between stable internal meanings and repository labels, teams, checks,
or other names. Defaults must not enable the capability or cause writes.

## 5. Behavior

Describe the behavior as a sequence from an observed fact to an intent. Include the manual-use case in
which every input was produced by a person rather than another capability. State how redelivery, outdated
observations, and concurrent human edits affect the result.

## 6. GitHub events, reads, writes, and permissions

Name the webhook events, scheduled evaluations, REST or GraphQL reads, pagination requirements, and write
operations that may be needed. Derive each requested permission from a named operation. State any
uncertainty that requires a feasibility experiment.

## 7. Compatibility without dependency

Explain how the capability behaves when likely companion capabilities are disabled. Then describe any
explicit compatibility rules or shared mappings needed when several capabilities are enabled together.
Compatibility must be checked by configuration and tests, not by sibling calls.

## 8. Operational state and recovery

State whether the capability can derive its decision from current GitHub facts. If it needs schedules,
deduplication, rotation, multi-call recovery, delivery history, or another durable fact, describe the
minimum information and retention period. Do not claim that comments or labels replace operational state
unless a test proves that recovery remains safe.

## 9. Failure handling and safety

Describe permission failures, rate limits, invalid configuration, missing mappings, partial writes, and
ambiguous observations. State the safe no-op, the useful human message, the operator signal, and the
rollback behavior. Identify every destructive or difficult-to-reverse action.

## 10. Tests and sandbox proof

List the behavior tests that go beyond the shared conformance suite. Include a personal installation test,
a Hiero Hackers sandbox test, a redelivery test, a human-override test, and a permission-failure test where
they apply. State what evidence would allow maintainers to accept or reject the candidate.

## 11. Disable, uninstall, and migration behavior

Explain what immediately stops when the capability is disabled. State whether owned comments, labels, or
stored records remain, are cleaned up, or expire. Describe how maintainers avoid two writers during
migration from an existing workflow or bot.

## 12. Open decisions

List unresolved product and technical decisions as questions. Name the experiment, maintainer conversation,
or design review that should answer each question.
