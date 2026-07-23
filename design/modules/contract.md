# Capability Contract Proposal

> This contract is a draft for the first two capability experiments. The exact TypeScript names may change,
> but the isolation, permission, configuration, and outcome requirements are part of the architecture review.

## 1. Declaration

Every capability declares the information that the platform needs to validate and isolate it.

```ts
interface CapabilityDeclaration {
  name: string;
  configSchema: SchemaReference;
  triggers: readonly Trigger[];
  observations: readonly ObservationName[];
  resolvers: readonly ResolverName[];
  intents: readonly IntentName[];
  permissions: {
    repository: readonly GitHubPermission[];
    organization: readonly GitHubPermission[];
  };
  operationalNeeds: {
    schedule: boolean;
    durableState: 'none' | 'candidate' | 'required';
    crossItemCoordination: boolean;
    externalDelivery: boolean;
  };
}
```

The declaration must be available to configuration validation, permission diagnostics, test generation, and
operator reporting. A capability cannot request an undeclared resolver or intent.

## 2. Runtime boundary

The platform calls a capability with normalized facts, validated configuration, and a handle limited by the
declaration.

```ts
interface Capability<D extends CapabilityDeclaration> {
  declaration: D;
  evaluate(
    observation: ObservationFor<D>,
    config: ConfigFor<D>,
    platform: PlatformHandle<D>,
  ): Promise<readonly IntentFor<D>[]>;
}

interface PlatformHandle<D extends CapabilityDeclaration> {
  resolve<Q extends D['resolvers'][number]>(
    query: Q,
    input: ResolverInput<Q>,
  ): Promise<ResolverResult<Q>>;

  explain(message: StructuredExplanation): void;
}
```

The handle does not expose Octokit, HTTP, a raw webhook payload, arbitrary comments, unrestricted logs, or
another capability. The platform normalizes all external facts before evaluation.

## 3. Intent

An intent describes a desired outcome rather than an API call.

```ts
interface Intent {
  capability: string;
  repository: RepositoryRef;
  item: ItemRef;
  operation: IntentName;
  expected: ExpectedFacts;
  desired: DesiredFacts;
  cause: DatedCause;
  explanation: StructuredExplanation;
  idempotencyKey: string;
}
```

The policy layer rejects an intent when the capability is disabled, the repository is not active, the
installation lacks permission, the current state no longer matches `expected`, or a safety rule blocks the
operation.

## 4. Effect results

The executor returns one of the following typed results.

```ts
type EffectResult =
  | { outcome: 'applied'; verifiedAt: string }
  | { outcome: 'already'; verifiedAt: string }
  | { outcome: 'conflict'; current: NormalizedFacts }
  | { outcome: 'forbidden'; missingPermission?: GitHubPermission }
  | { outcome: 'retryLater'; after?: string; reason: string }
  | { outcome: 'unknown'; reason: string; recoveryKey: string };
```

`applied` means that the executor verified the requested postcondition after the write. `already` means that
the postcondition was present before a new write was necessary. `conflict` means that current facts no longer
match the capability's expectation. `unknown` means that the executor cannot prove whether a write occurred.

A capability does not retry `unknown`, `forbidden`, or `conflict` results. The executor or reconciliation
worker owns recovery and may request a fresh capability evaluation after current state is available.

## 5. Multi-call plans

A single intent may require several GitHub calls, but the executor must represent those calls as an explicit
plan. The plan records the safe call order, the expected state after each call, the verification rule, and the
recovery rule after a crash or unclear response.

The first implementation must not assume that comment metadata can recover every plan. The personal-sandbox
experiment will decide whether GitHub reconstruction, comment metadata, or an owned operational store records
the plan and its progress.

## 6. Configuration and mapping access

The configuration layer projects only the declared capability block and shared mappings into the capability.
The capability refers to internal meanings rather than repository label strings. The policy and adapter
layers resolve those meanings through validated mappings.

A capability cannot enable itself, read another capability's configuration, or use an unmapped meaning.

## 7. Compatibility

Independence does not mean that every arbitrary capability combination is valid. Each declaration may name a
compatibility rule that the registry evaluates before activation. A rule may require a shared mapping or
forbid two capabilities from owning the same external effect.

Compatibility rules do not allow direct capability calls. A workflow profile may package a tested set of
rules and defaults while preserving separate capability declarations.

## 8. Conformance tests

The test kit derives the following checks from the declaration.

- The kit verifies that undeclared resolvers and intents are unavailable.
- The kit verifies that disabled capability code receives no events or scheduled work.
- The kit verifies that only the declared configuration is visible.
- The kit verifies that permission mismatches prevent writes.
- The kit verifies that repeated observations converge on `already` without duplicate effects.
- The kit verifies that stale expectations return `conflict` and preserve newer human changes.
- The kit verifies dry-run output for every declared intent.
- The kit verifies the capability's rollback and disablement behavior.
- The kit verifies declared compatibility rules against supported combinations.

The adapter and effect executor have separate contract tests against recorded GitHub behavior. Capability
tests do not create private copies of GitHub response shapes.

## 9. Questions that remain open

- The project must select the first concrete observation, resolver, and intent types.
- The storage experiment must decide how recovery keys and plan progress persist.
- The configuration design must decide how mappings enter `ConfigFor<D>`.
- The first two candidates must prove whether the operational-needs declaration is sufficient.
- The hosting experiment must decide whether one or several executor processes may run at once.
