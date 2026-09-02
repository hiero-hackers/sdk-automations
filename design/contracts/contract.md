# Capability Runtime Contract

> **Built for the probe boundary** — `packages/core/src/capability/` implements the declaration,
> projected view, resolver handle, intent factory, and runtime screens. Three disposable probes exercise
> the boundary and P3 isolation. `packages/dev/checks/test/contract-drift.test.ts` locks §1's interfaces.

This contract says what the current implementation can enforce. It does not promise an effect executor,
multi-call plans, rollback, or a generic conformance kit; those do not exist in this workspace.

## 1. Declaration

```ts
interface CapabilityDeclaration {
  readonly name: string;
  readonly triggers: readonly Trigger[];
  readonly configKeys: readonly string[];
  readonly requiredMeanings: readonly string[];
  readonly observations: readonly string[];
  readonly resolvers: readonly string[];
  readonly intents: readonly string[];
  readonly operationalNeeds: OperationalNeeds;
}

type Trigger =
  | { readonly kind: "event"; readonly event: string }
  | { readonly kind: "schedule"; readonly description: string };

interface OperationalNeeds {
  readonly schedule: boolean;
  readonly durableState: "none" | "candidate" | "required";
  readonly crossItemCoordination: boolean;
  readonly externalDelivery: boolean;
}
```

- `validateCapabilityDeclarations` validates the complete directly admitted set: name syntax, at least one
  trigger, schedule consistency, duplicates, catalogue membership, and duplicate capability names.
- `configKeys` and `requiredMeanings` are the two fields the CONFIGURATION layer reads: the first says
  which `settings` names are legal, the second which label meanings must be mapped before the capability
  may be enabled. Both are empty rather than absent for a capability that wants neither, and a required
  meaning outside the closed catalogue is a boot error (D84).
- `TypedDeclaration` narrows meaning, observation, resolver, and intent names to the closed platform
  catalogues, which is also what lets a declaration serve as an `AdmittedCapability` uncast.
- `declareCapability<const D>` preserves those lists as literal tuples so the boundary can project exact
  types instead of widening them to every name.
- There is no runtime retirement registry, `describe`, or tombstone lookup. The application passes one
  direct admitted set, and configuration rejects every name outside it.

**Permissions, action class, and idempotency are not declaration fields.** The platform owns those facts in
`INTENT_OPERATIONS`; deriving them from the requested operation prevents a capability from restating or
widening its authority (D62).

## 2. Runtime boundary

```ts
interface Capability<D extends TypedDeclaration> {
  readonly declaration: D;
  evaluate(
    observation: ObservationFor<D>,
    config: CapabilityView<D>,
    platform: PlatformHandle<D>,
  ): Promise<readonly IntentFor<D>[]>;
}

interface CapabilityView<D extends TypedDeclaration> {
  readonly settings: {
    readonly [K in D["configKeys"][number]]?: unknown;
  };
  readonly mappedMeanings: readonly MappableMeaning[];
}

interface PlatformHandle<D extends TypedDeclaration> {
  resolve<Q extends D["resolvers"][number] & ResolverName>(
    query: Q,
    input: ResolverInput<Q>,
  ): Promise<ResolverAnswer<ResolverOutput<Q>>>;
  explain(explanation: StructuredExplanation): void;
}
```

The platform supplies normalized facts, the capability's own declared settings, the **names** of mapped
meanings, and only its declared resolvers. The boundary exposes no Octokit client, HTTP, raw webhook body,
repository label string, mode, enabled flag, installation grant, or sibling capability.

`toEngine()` performs the one internal type erasure needed to run unlike declarations through one engine
loop. It does not expand what a capability can see.

## 3. Intents

```ts
interface Intent<K extends IntentOperation> {
  readonly capability: string;
  readonly repository: RepositoryRef;
  readonly item: ItemRef;
  readonly operation: K;
  readonly expected: ExpectedFacts;
  readonly desired: IntentCatalogue[K];
  readonly cause: DatedCause;
  readonly explanation: StructuredExplanation;
  readonly idempotencyKey: string;
}
```

- An intent requests an outcome; it is never proof that the outcome happened.
- `intentFactoryFor` restricts the operation to the declaration, binds repository, item, capability, and
  observation time once, requires an explanation, fills a vacuous expected-state default, and derives the
  idempotency key.
- `screenIntent` rechecks capability identity, declared operation, dated cause, authoritative projection,
  entity/meaning compatibility, pause authority, position conflicts, and transition legality at runtime.
- The engine derives action class and required permission from `INTENT_OPERATIONS`, then derives an
  unforgeable safety world from the observation and the intent's claims.
- A passed screen can still be refused or recorded-only by the safety contract.

## 4. Isolation and composition

- A disabled capability is not invoked and leaves no finding.
- A capability whose declaration does not include the current observation is not invoked.
- Resolver names are restricted both by TypeScript and by the engine handle at runtime.
- The engine sees capabilities only through their declarations and projected views; there is no sibling
  reference to call.
- `packages/probes/test/engine-matrix.test.ts` runs every subset of three unlike probes and asserts each
  probe's approved intents and findings are identical to its alone-run. This proves the boundary's current
  P3 isolation property, not that any probe is a product capability.

## 5. What the current tests cover

| Property | Evidence |
|---|---|
| declaration structure and catalogue admission | core declaration tests |
| undeclared settings, resolvers, observations, and intents stay unavailable | core boundary tests and probe boundary tests |
| intent keys, claims, transition screens, and refusal codes | core capability tests |
| disabled capabilities leave zero trace; neighbours do not change a decision | probe engine matrix |
| repository modes, permission grants, pause state, and newer-human precedence gate intents | core safety and engine tests |

There is no declaration-derived suite that automatically proves rollback, effect convergence, or every
compatibility rule. Each real capability must add policy-specific tests, and later write-path work must add
adapter and recovery tests at its own boundary.

## 6. Deliberately deferred

- Select and implement the first real capability; the probes are disposable (Q2).
- Decide whether `OperationalNeeds` is sufficient after a real capability and scheduler use it.
- Add capability-owned validation for opaque `settings` and declare required mapped meanings.
- Define compatibility/ownership rules without introducing sibling calls.
- Build adapter commands, postcondition verification, effect results, recovery, and any multi-call plan.
- Resolve how unprojected scheduled observations obtain authoritative act-time facts; the current inactivity
  probe is refused `preconditionStale` by the engine.
