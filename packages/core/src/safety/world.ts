/**
 * The derived world — D92 phase 4, the payoff.
 *
 * D77 ruled "the shell supplies observations; core computes conclusions",
 * and `WriteContext` went on asking callers for two conclusions —
 * `observedMeanings` and `preconditionHolds` — that follow from the
 * projection. Phases 1–3 made the engine derive them; this phase makes the
 * derivation the ONLY way they can exist: `DerivedWorld` is branded with a
 * symbol this module does not export through the barrel, and core's
 * `exports` map blocks deep imports from outside the package. A shell that
 * wants to assert a stale precondition has no type to assert it with —
 * the lie is unrepresentable, not discouraged. Same pattern as D60's
 * branded warning, applied to the world itself.
 */

import { MAPPABLE_MEANINGS, type MappableMeaning } from "../config/index.js";
import { closureOf, type ClosureReason, type ObservationProjection } from "../workflow/index.js";

/**
 * What a capability claims about the world — contracts/safety.md's language. The
 * intent layer re-exports this as `ExpectedFacts`; it is defined here so
 * the derivation and the claim share one shape without the safety module
 * depending on the capability layer.
 */
export interface ClaimedFacts {
    readonly meaningsPresent: readonly MappableMeaning[];
    readonly meaningsAbsent: readonly MappableMeaning[];
    /** `null` when the capability makes no open/closed claim. */
    readonly closed: boolean | null;
}

/** Not exported from the barrel — constructing a DerivedWorld goes through `deriveWorld`. */
export const DERIVED: unique symbol = Symbol("derived-by-engine");

/**
 * The safety facts a rule may read, derivable only. External packages cannot
 * reach `DERIVED` (the barrel omits it and the package `exports` map blocks
 * deep imports), so this interface has no constructible literal outside core.
 *
 * `closure` is here for the same reason `observedMeanings` is: the
 * `itemClosed` rule must read the platform's own reading of the observation,
 * not a capability's `expected.closed` claim, which defaults to no claim.
 */
export interface DerivedWorld {
    readonly observedMeanings: readonly MappableMeaning[];
    readonly preconditionHolds: boolean;
    /** Why the observed item is closed, or `null` if it is open. */
    readonly closure: ClosureReason | null;
    readonly [DERIVED]: true;
}

/**
 * Every mapped meaning the observation actually carried, reconstructed from
 * the projection — both branches, in `MAPPABLE_MEANINGS` order.
 */
export function observedMeaningsOf<M extends MappableMeaning>(
    projection: ObservationProjection<M>,
): readonly MappableMeaning[] {
    const present = new Set<MappableMeaning>();
    if (projection.kind === "position") {
        if (projection.state.meaning !== null) present.add(projection.state.meaning);
        if (projection.state.blocked) present.add("blocked");
    } else {
        for (const position of projection.positions) present.add(position);
        if (projection.blocked) present.add("blocked");
    }
    for (const ignored of projection.ignored) present.add(ignored);
    return MAPPABLE_MEANINGS.filter((m) => present.has(m));
}

/**
 * Does the claimed world match the observed one? Three clauses against the
 * projection, closure read via `closureOf` — both branches, the asymmetry
 * trap that function exists for.
 */
export function expectedHolds<M extends MappableMeaning>(
    claims: ClaimedFacts,
    projection: ObservationProjection<M>,
): boolean {
    const observed = new Set(observedMeaningsOf(projection));
    for (const meaning of claims.meaningsPresent) {
        if (!observed.has(meaning)) return false;
    }
    for (const meaning of claims.meaningsAbsent) {
        if (observed.has(meaning)) return false;
    }
    if (claims.closed !== null) {
        const isClosed = closureOf(projection) !== null;
        if (claims.closed !== isClosed) return false;
    }
    return true;
}

/**
 * The one constructor. Missing or conflicted projection data cannot establish
 * an authoritative precondition. A clean position projection compares the
 * requested preconditions with observed facts.
 *
 * Closure is read from BOTH projection branches, and `null` without a
 * projection says "nothing observed says closed" rather than "open". No rule
 * reads it in that state: `preconditionHolds` is already false there, so the
 * shared preflight refuses `preconditionStale` before the rules run.
 */
export function deriveWorld<M extends MappableMeaning>(
    projection: ObservationProjection<M> | null,
    claims: ClaimedFacts,
): DerivedWorld {
    return {
        observedMeanings: projection === null ? [] : observedMeaningsOf(projection),
        preconditionHolds:
            projection !== null &&
            projection.kind === "position" &&
            expectedHolds(claims, projection),
        closure: projection === null ? null : closureOf(projection),
        [DERIVED]: true,
    };
}

/**
 * FOR CORE'S OWN RULE TESTS ONLY — deliberately absent from the barrel, so
 * external packages cannot reach it. The rule suite needs arbitrary
 * world-fact combinations to pin precedence; production code needs exactly
 * one way to make a world, and this is not it.
 */
export function assertedWorld(
    observedMeanings: readonly MappableMeaning[],
    preconditionHolds: boolean,
    closure: ClosureReason | null = null,
): DerivedWorld {
    return { observedMeanings, preconditionHolds, closure, [DERIVED]: true };
}
