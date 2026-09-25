/**
 * What a capability asks for. An intent describes a desired OUTCOME, not an API
 * call; the screens that judge one live with the engine that collects them.
 */

import type { ClaimedFacts } from "../safety/index.js";
import type {
    DatedCause,
    IdempotencyClass,
    IntentCatalogue,
    IntentOperation,
    ItemRef,
    RepositoryRef,
    StructuredExplanation,
} from "../catalogue.js";
import { INTENT_OPERATIONS } from "./operations/index.js";

/**
 * What a capability says ONCE about a clock-triggered destructive act
 * (`design/guides/grace.md` §1): the platform owns WHEN, the capability WHAT.
 */
export interface DestructiveGrace {
    /** The full grace, in hours; at least `MIN_GRACE_HOURS`. */
    readonly hours: number;
    /** The discriminator the warning and the notice stand under, `""` by default (D145). */
    readonly topic?: string;
    /** The words posted on first sight — the date already rendered. */
    readonly warning: { readonly body: string };
    readonly notice: { readonly body: string };
    /** What cancels the plan, in the warning's own words (grace.md). */
    readonly cancelledBy: string;
    readonly reversesWith: string;
    /** The newest qualifying activity by the affected person, if the facts carry one. */
    readonly activityAt: Date | null;
}

/**
 * One request from a capability. `idempotencyKey` becomes the ledger's
 * `effect_id`, so two intents sharing a key ARE one effect to the store (D65).
 */
export interface Intent<K extends IntentOperation = IntentOperation> {
    readonly capability: string;
    readonly repository: RepositoryRef;
    readonly item: ItemRef;
    readonly operation: K;
    readonly claims: ClaimedFacts;
    readonly desired: IntentCatalogue[K];
    readonly cause: DatedCause;
    readonly evaluatedAt?: Date;
    readonly explanation: StructuredExplanation;
    readonly idempotencyKey: string;
    /** The grace terms, for a clock-triggered destructive operation and no other. */
    readonly grace: DestructiveGrace | null;
}

/** Discriminated over `operation`, so `desired` narrows with it. */
export type AnyIntent = { [K in IntentOperation]: Intent<K> }[IntentOperation];

/** The one derivation. The cause's timestamp identifies WHICH OCCASION; the payload does not. */
export function deriveIdempotencyKey(intent: {
    readonly capability: string;
    readonly repository: RepositoryRef;
    readonly item: ItemRef;
    readonly operation: IntentOperation;
    readonly cause: DatedCause;
}): string {
    // JSON, not a join: a join collides "a b"+"c" with "a"+"b c" (D65, D74).
    const parts = [
        intent.capability,
        intent.repository.owner,
        intent.repository.repo,
        intent.item.kind,
        String(intent.item.number),
        intent.operation,
        intent.cause.cause,
        intent.cause.observedAt.toISOString(),
    ];
    if (intent.cause.deliveryId !== undefined) parts.push(intent.cause.deliveryId);
    return JSON.stringify(parts);
}

// ─── The screen's verdict ────────────────────────────────────────────

/** Every way an intent can be refused before the safety engine sees it. */
export const INTENT_SCREEN_REFUSAL_CODES = [
    "malformedIntent",
    "foreignCapability",
    "undeclaredIntent",
    "invalidCause",
    "idempotencyKeyMismatch",
    "authoritativePositionUnavailable",
    "pauseNotCapabilityWritable",
    "meaningWrongEntity",
    "positionConflict",
    "transitionNotOnMap",
    "graceMismatch",
    "graceBelowFloor",
] as const;

export type IntentScreenRefusalCode = (typeof INTENT_SCREEN_REFUSAL_CODES)[number];

/** A screen's verdict: passed, or refused with a code and a sentence. */
export type IntentScreen =
    | { readonly ok: true }
    | {
          readonly ok: false;
          readonly code: IntentScreenRefusalCode;
          readonly reason: string;
      };

/** The class any future writer must use — from the catalogue, never the intent. */
export function idempotencyOf(operation: IntentOperation): IdempotencyClass {
    return INTENT_OPERATIONS[operation].idempotencyClass;
}
