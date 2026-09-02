/**
 * How the platform CALLS a capability — `design/contracts/contract.md` §2 as
 * types.
 *
 * `declaration.ts` says what a capability is; this says how it is invoked and
 * what it is allowed to see. The shape of what is ABSENT from `PlatformHandle`
 * is the guarantee: no Octokit, no HTTP, no raw payload, no other capability.
 */

import type { TypedDeclaration } from "./declaration.js";
import type { RepositoryConfig, MappableMeaning } from "../config/index.js";
import type {
    ObservationCatalogue,
    ResolverAnswer,
    ResolverInput,
    ResolverName,
    ResolverOutput,
    StructuredExplanation,
} from "./catalogue.js";
import type { AnyIntent } from "./intent.js";

// ─── Typed projections ───────────────────────────────────────────────

/** The observation union a declaration receives — one member per declared name. */
export type ObservationFor<D extends TypedDeclaration> =
    ObservationCatalogue[D["observations"][number]];

/** The intent union a declaration may return — one member per declared operation. */
export type IntentFor<D extends TypedDeclaration> = Extract<
    AnyIntent,
    { operation: D["intents"][number] }
>;

// ─── The view a capability sees ──────────────────────────────────────

/**
 * contract.md §2 — the projection a capability sees. Four deliberate
 * omissions, each of which would hand a capability a decision that is not
 * its own:
 *
 * - no `mode`: dry-run and active are policy. A capability that branched
 *   on mode would be deciding whether to write, which is rule 10's job.
 * - no `enabled`: a disabled capability is never evaluated (§4), so the
 *   field could only ever read `true` — and a capability that could read
 *   it could try to act while off.
 * - no other capability's block (§2, P3).
 * - **no label strings.** §2 says a capability receives internal
 *   meanings rather than repository label strings", so the view reports
 *   WHICH meanings a repository has mapped, never what it calls them.
 *   Passing `mappings.labels` through would have satisfied the types and
 *   quietly broken the rule; a capability that never sees a label string
 *   cannot hard-code one.
 */
export interface CapabilityView<D extends TypedDeclaration> {
    readonly settings: {
        readonly [K in D["configKeys"][number]]?: unknown;
    };
    readonly mappedMeanings: readonly MappableMeaning[];
}

/**
 * Build that view. Undeclared settings keys are dropped rather than
 * rejected — the capability's own schema owns its block (§2), and this
 * function's job is the isolation cut, not validation.
 *
 * Since D84 `parseConfig` rejects an undeclared settings key outright, so for
 * a parsed configuration the drop below never fires. It stays as the
 * boundary's own defense: this function takes a `RepositoryConfig`, not a
 * promise about where one came from, and the isolation cut must hold for
 * `NO_CONFIG` and for any caller that builds one another way.
 */
export function projectCapabilityView<const D extends TypedDeclaration>(
    declaration: D,
    config: RepositoryConfig,
): CapabilityView<D> {
    const block = config.capabilities[declaration.name];
    const settings: Record<string, unknown> = Object.create(null);
    for (const key of declaration.configKeys) {
        if (block !== undefined && Object.hasOwn(block.settings, key)) {
            settings[key] = block.settings[key];
        }
    }
    // No `!== undefined` filter on the meanings: under
    // `exactOptionalPropertyTypes` a present key on
    // `Partial<Record<MappableMeaning, string>>` holds a string, and
    // `parseConfig` only ever assigns defined labels, so it was unreachable.
    return {
        settings: settings as CapabilityView<D>["settings"],
        mappedMeanings: Object.keys(config.mappings.labels) as MappableMeaning[],
    };
}

// ─── The handle and the capability ───────────────────────────────────

/**
 * contract.md §2. `Q extends D["resolvers"][number]` is the isolation
 * rule as a type: an undeclared resolver does not compile. It does not
 * expose Octokit, HTTP, a raw payload, arbitrary comments, or another
 * capability — the shape of what is absent is the guarantee.
 */
export interface PlatformHandle<D extends TypedDeclaration> {
    resolve<Q extends D["resolvers"][number] & ResolverName>(
        query: Q,
        input: ResolverInput<Q>,
    ): Promise<ResolverAnswer<ResolverOutput<Q>>>;
    explain(explanation: StructuredExplanation): void;
}

/**
 * A capability: its declaration, and the one function the platform calls.
 *
 * `evaluate` is pure with respect to the repository — a capability decides,
 * it never writes. Everything it returns is a REQUEST the policy layer may
 * refuse, which is why it cannot report success or receive an effect result.
 */
export interface Capability<D extends TypedDeclaration> {
    readonly declaration: D;
    evaluate(
        observation: ObservationFor<D>,
        config: CapabilityView<D>,
        platform: PlatformHandle<D>,
    ): Promise<readonly IntentFor<D>[]>;
}
