/**
 * Building an intent — capability-authoring ergonomics, owned (D92 3d).
 *
 * The factory binds the occasion once — capability, repository, item,
 * observedAt — so each intent states only what it WANTS. Two contracts the
 * shape enforces rather than requests:
 *
 * - **Every intent explains itself.** `explain.summary` is required: the
 *   report's story for applied and recorded effects comes from here, and a
 *   capability that cannot say why it acts should not act (safety.md).
 * - **The claimed world defaults to no claim.** An omitted `expected` is
 *   vacuous (`closed: null`), never an accidental assertion. Claims are
 *   CHECKED under the engine's derived preconditions, so the default must be
 *   the one that cannot be wrong.
 */

import type { TypedDeclaration } from "./declaration.js";
import type { ItemRef, RepositoryRef } from "./catalogue.js";
import type { IntentCatalogue, IntentOperation } from "./catalogue.js";
import { deriveIdempotencyKey, type ExpectedFacts, type Intent } from "./intent.js";

/** Where and when — bound once per evaluation, not restated per intent. */
export interface IntentOccasion {
    readonly repository: RepositoryRef;
    readonly item: ItemRef;
    readonly observedAt: Date;
}

/** What a capability says; the factory supplies the rest of the intent. */
export interface IntentSpec<K extends IntentOperation> {
    readonly operation: K;
    readonly desired: IntentCatalogue[K];
    /** What occasioned this — free text identifying the trigger, dated by the occasion. */
    readonly cause: string;
    /** Omitted fields claim nothing; `closed` defaults to no-claim, not open. */
    readonly expected?: Partial<ExpectedFacts>;
    readonly explain: { readonly summary: string; readonly detail?: readonly string[] };
}

/** A spec-to-intent function with one occasion already bound. */
export type IntentMaker = <K extends IntentOperation>(spec: IntentSpec<K>) => Intent<K>;

/** Bind an occasion. Accepts any catalogue operation; see `intentFactoryFor`. */
export function intentFactory(capability: string, occasion: IntentOccasion): IntentMaker {
    return <K extends IntentOperation>(spec: IntentSpec<K>): Intent<K> => {
        const base = {
            capability,
            repository: occasion.repository,
            item: occasion.item,
            operation: spec.operation,
            expected: {
                meaningsPresent: spec.expected?.meaningsPresent ?? [],
                meaningsAbsent: spec.expected?.meaningsAbsent ?? [],
                closed: spec.expected?.closed ?? null,
            },
            desired: spec.desired,
            cause: { cause: spec.cause, observedAt: occasion.observedAt },
            explanation: {
                capability,
                summary: spec.explain.summary,
                detail: spec.explain.detail ?? [],
            },
        };
        return {
            ...base,
            idempotencyKey: deriveIdempotencyKey(base),
        };
    };
}

/**
 * The declaration-aware factory — the one capabilities should use. It
 * constrains `K` to the operations the DECLARATION carries, so its output is
 * assignable to `IntentFor<D>` with no cast, and an undeclared operation
 * fails at the call site, at compile time, in the capability's own file. The
 * screens still re-check at runtime; this is ergonomics, they are enforcement.
 */
export function intentFactoryFor<const D extends TypedDeclaration>(
    declaration: D,
    occasion: IntentOccasion,
): <K extends D["intents"][number]>(spec: IntentSpec<K>) => Intent<K> {
    return intentFactory(declaration.name, occasion);
}
