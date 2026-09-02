/**
 * How the engine calls a capability whose declaration type it cannot know.
 *
 * `capability/boundary.ts` is the typed side: `Capability<D>` and
 * `PlatformHandle<D>` say what one capability sees, with its declaration as
 * the type parameter. The engine holds a heterogeneous LIST and so has no
 * single `D` — it works against the erased shapes here, and `decide.ts`
 * composes them without restating the erasure at every call.
 */

import type {
    AnyIntent,
    Capability,
    ResolverAnswer,
    ResolverInput,
    ResolverName,
    ResolverOutput,
    StructuredExplanation,
    TypedDeclaration,
} from "../capability/index.js";

/** A capability with its declaration type erased — what a list can hold. */
export interface EngineCapability {
    readonly declaration: TypedDeclaration;
    evaluate(observation: never, config: never, platform: never): Promise<readonly AnyIntent[]>;
}

/**
 * The one blessed erasure (D92). Sound because `never` in every parameter
 * position is what any concrete `evaluate` accepts contravariantly: nothing
 * widens, and the capability gains no reach it did not have. The argument
 * lives here once so that no call site has to make it again.
 */
export function toEngine<D extends TypedDeclaration>(capability: Capability<D>): EngineCapability {
    return capability as unknown as EngineCapability;
}

/** Where resolver answers come from. A shell without one supplies nothing. */
export type ResolverSource = <Q extends ResolverName>(
    query: Q,
    input: ResolverInput<Q>,
) => Promise<ResolverAnswer<ResolverOutput<Q>>>;

/**
 * What a thrown value says, for a finding. Anything can be thrown, so the
 * non-`Error` case is normal rather than paranoid.
 */
export function thrownDetail(thrown: unknown): string {
    return thrown instanceof Error ? thrown.message : String(thrown);
}

/**
 * The handle a capability is given: it refuses an undeclared resolver
 * WITHOUT throwing, recording the violation instead. The engine is total,
 * and an undeclared resolver call is a capability defect — a defect deserves
 * a problem finding, not a crash in the shell.
 *
 * A resolver SOURCE that throws is contained the same way, and the two are
 * recorded separately because they blame different people: `violations` is
 * the capability's defect, `failures` the shell's.
 */
export class EngineHandle {
    readonly explanations: StructuredExplanation[] = [];
    readonly violations: string[] = [];
    /** Declared resolvers whose source threw, as `name: detail`. */
    readonly failures: string[] = [];

    constructor(
        private readonly declaration: TypedDeclaration,
        private readonly source: ResolverSource | undefined,
    ) {}

    async resolve(query: ResolverName, input: unknown): Promise<ResolverAnswer<unknown>> {
        if (!this.declaration.resolvers.includes(query)) {
            this.violations.push(query);
            return {
                ok: false,
                reason: "notConfigured",
                detail: `"${this.declaration.name}" did not declare resolver "${query}"`,
            };
        }
        if (this.source === undefined) {
            return { ok: false, reason: "unavailable", detail: "no resolver source supplied" };
        }
        try {
            return await this.source(query, input as never);
        } catch (thrown) {
            // `unavailable`, never an empty value: resolvers.md §6 forbids a
            // capability reading a broken lookup as a negative answer, and a
            // source that threw established nothing at all.
            const detail = thrownDetail(thrown);
            this.failures.push(`${query}: ${detail}`);
            return { ok: false, reason: "unavailable", detail };
        }
    }

    explain(explanation: StructuredExplanation): void {
        this.explanations.push(explanation);
    }
}
