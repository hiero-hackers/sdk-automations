/**
 * The intent factory — capability-authoring ergonomics, owned (D92 3d).
 *
 * Before this, every intent was ~30 lines of hand-assembled record, and the
 * probes showed what that breeds: repeated `expected` boilerplate, the
 * capability name restated in the explanation, the idempotency key derived
 * at every call site. The factory binds the occasion once — capability,
 * repository, item, observedAt — and each intent states only what it WANTS.
 *
 * Two contracts the shape enforces rather than requests:
 *
 * - **Every intent explains itself.** `explain.summary` is required — the
 *   report's story for applied and recorded effects comes from here, and a
 *   capability that cannot say why it acts should not act (safety.md).
 * - **The claimed world defaults to no claim.** An omitted `expected` is
 *   vacuous (`closed: null`), never an accidental assertion — under the
 *   engine's derived preconditions, claims are CHECKED, so the default must
 *   be the one that cannot be wrong.
 */

import type { ActionClass } from "../safety/index.js";
import type { TypedDeclaration } from "./declaration.js";
import type { ItemRef, RepositoryRef } from "./catalogue.js";
import type { IntentCatalogue, IntentOperation } from "./catalogue.js";
import {
    deriveIdempotencyKey,
    type DestructiveDetail,
    type ExpectedFacts,
    type Intent,
} from "./intent.js";

/** Where and when — bound once per evaluation, not restated per intent. */
export interface IntentOccasion {
    readonly repository: RepositoryRef;
    readonly item: ItemRef;
    readonly observedAt: Date;
}

export interface IntentSpec<K extends IntentOperation> {
    readonly operation: K;
    readonly actionClass: ActionClass;
    readonly desired: IntentCatalogue[K];
    /** What occasioned this — free text identifying the trigger, dated by the occasion. */
    readonly cause: string;
    /** Omitted fields claim nothing; `closed` defaults to no-claim, not open. */
    readonly expected?: Partial<ExpectedFacts>;
    readonly explain: { readonly summary: string; readonly detail?: readonly string[] };
    /** Required exactly when the class is `clockTriggeredDestructive` — the screen enforces it. */
    readonly destructive?: DestructiveDetail;
}

export type IntentMaker = <K extends IntentOperation>(spec: IntentSpec<K>) => Intent<K>;

export function intentFactory(capability: string, occasion: IntentOccasion): IntentMaker {
    return <K extends IntentOperation>(spec: IntentSpec<K>): Intent<K> => {
        const base = {
            capability,
            repository: occasion.repository,
            item: occasion.item,
            operation: spec.operation,
            actionClass: spec.actionClass,
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
            ...(spec.destructive !== undefined ? { destructive: spec.destructive } : {}),
            idempotencyKey: deriveIdempotencyKey(base),
        };
    };
}

/**
 * The declaration-aware factory — D92 3(d), completed by unification
 * rather than deletion. `intentFactory` accepts any catalogue operation;
 * this one constrains `K` to the operations the DECLARATION carries, so
 * its output is assignable to `IntentFor<D>` with no cast — an undeclared
 * operation fails at the call site, at compile time, in the capability's
 * own file. The screens still re-check at runtime; this is ergonomics,
 * they are enforcement.
 */
export function intentFactoryFor<const D extends TypedDeclaration>(
    declaration: D,
    occasion: IntentOccasion,
): <K extends D["intents"][number]["name"] & IntentOperation>(spec: IntentSpec<K>) => Intent<K> {
    return intentFactory(declaration.name, occasion);
}
