/**
 * What a capability asks for, and the screens every request passes.
 *
 * An intent describes a desired OUTCOME, not an API call. Translation into
 * GitHub calls is deliberately outside `core/` and is not implemented yet.
 */

import type { MappableMeaning } from "../config/index.js";
import type { ClaimedFacts } from "../safety/index.js";
import {
    canTransitionIssue,
    canTransitionPr,
    isIssueCause,
    isIssueMeaning,
    isPrCause,
    isPrMeaning,
    type ObservationProjection,
} from "../workflow/index.js";
import {
    INTENT_OPERATIONS,
    type DatedCause,
    type IdempotencyClass,
    type IntentCatalogue,
    type IntentOperation,
    type ItemRef,
    type RepositoryRef,
    type StructuredExplanation,
} from "./catalogue.js";
import type { TypedDeclaration } from "./declaration.js";

// ─── Intents ─────────────────────────────────────────────────────────

/**
 * contract.md §3 `expected`: the facts the capability believes hold. Now an
 * alias of safety's `ClaimedFacts` (D92 phase 4) — the claim and the
 * derivation that checks it share one definition, in the checker's module.
 */
export type ExpectedFacts = ClaimedFacts;

/**
 * One request from a capability: what outcome it wants, for which item, and
 * the requested preconditions that authoritative projection data must verify.
 *
 * `idempotencyKey` is the effect's stable identity across redelivery, retry
 * and restart. It becomes the journal's `effect_id`, so two intents sharing a
 * key ARE one effect to the store
 * (`FINDING(runtime-idempotency-key-underived)`, D65).
 */
export interface Intent<K extends IntentOperation = IntentOperation> {
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

/** Discriminated over `operation`, so `desired` narrows with it. */
export type AnyIntent = { [K in IntentOperation]: Intent<K> }[IntentOperation];

/**
 * The one derivation. Capability, item, and operation identify WHAT; the
 * cause's timestamp identifies WHICH OCCASION, so a redelivery of the same
 * event yields the same key (the cause is a property of the event, not of
 * the delivery) while a genuinely new occasion yields a new one. The
 * desired payload is deliberately NOT included: a capability that
 * recomputes a slightly different comment body for the same occasion must
 * not thereby create a second comment.
 */
export function deriveIdempotencyKey(intent: {
    readonly capability: string;
    readonly repository: RepositoryRef;
    readonly item: ItemRef;
    readonly operation: IntentOperation;
    readonly cause: DatedCause;
}): string {
    // JSON, not a delimiter join: `cause` is free text, so no separator is
    // guaranteed absent, and a space-join collides "a b"+"c" with "a"+"b c"
    // — silently one effect. JSON encodes the boundaries (D65, D74).
    return JSON.stringify([
        intent.capability,
        intent.repository.owner,
        intent.repository.repo,
        intent.item.kind,
        String(intent.item.number),
        intent.operation,
        intent.cause.cause,
        intent.cause.observedAt.toISOString(),
    ]);
}

// ─── Runtime screens ─────────────────────────────────────────────────

/** Every way an intent can be refused before the safety engine sees it. */
export const INTENT_SCREEN_REFUSAL_CODES = [
    "foreignCapability",
    "undeclaredIntent",
    "invalidCause",
    "idempotencyKeyMismatch",
    "authoritativePositionUnavailable",
    "pauseNotCapabilityWritable",
    "meaningWrongEntity",
    "positionConflict",
    "transitionNotOnMap",
] as const;

/** One of `INTENT_SCREEN_REFUSAL_CODES`. */
export type IntentScreenRefusalCode = (typeof INTENT_SCREEN_REFUSAL_CODES)[number];

/** A screen's verdict: passed, or refused with a code and a sentence. */
export type IntentScreen =
    | { readonly ok: true }
    | {
          readonly ok: false;
          readonly code: IntentScreenRefusalCode;
          readonly reason: string;
      };

/**
 * Is the move this intent would make from the authoritative projected
 * position on the profile's map? Capability claims never supply `from`.
 */
function screenTransition(
    intent: Intent<"applyMappedLabel">,
    projection: ObservationProjection<MappableMeaning>,
): IntentScreen {
    if (projection.kind === "conflict") {
        return {
            ok: false,
            code: "positionConflict",
            reason: `the observed item holds ${projection.positions.join(" and ")}; a conflicted position has no edge to move along`,
        };
    }

    // `blocked` is a pause flag, not a position (D28); only a human may set
    // it — a capability that could would hold a veto over every other
    // capability (D79), and a freeze-by-label would bypass D54's gate.
    if (intent.desired.meaning === "blocked") {
        return {
            ok: false,
            code: "pauseNotCapabilityWritable",
            reason: "pausing an item withholds it from every capability, so only a human may set `blocked` (D79); a capability that must stop work needs the immediatePreventive gate (D54)",
        };
    }

    const wrongEntity = (meaning: string): IntentScreen => ({
        ok: false,
        code: "meaningWrongEntity",
        reason: `"${meaning}" is not ${intent.item.kind === "issue" ? "an issue" : "a pull request"} position`,
    });
    const offMap = (from: string | null, detail: string): IntentScreen => ({
        ok: false,
        code: "transitionNotOnMap",
        reason: `${from ?? "no position"} → ${intent.desired.meaning} for "${intent.desired.cause}" is not a documented edge (${detail})`,
    });
    const from = projection.state.meaning;

    if (intent.item.kind === "issue") {
        if (!isIssueMeaning(intent.desired.meaning)) return wrongEntity(intent.desired.meaning);
        if (from !== null && !isIssueMeaning(from)) return wrongEntity(from);
        if (!isIssueCause(intent.desired.cause)) {
            return offMap(from, "not an issue-flow cause");
        }
        const verdict = canTransitionIssue({
            from,
            to: intent.desired.meaning,
            cause: intent.desired.cause,
        });
        return verdict.allowed ? { ok: true } : offMap(from, verdict.code);
    }

    if (!isPrMeaning(intent.desired.meaning)) return wrongEntity(intent.desired.meaning);
    if (from !== null && !isPrMeaning(from)) return wrongEntity(from);
    if (!isPrCause(intent.desired.cause)) {
        return offMap(from, "not a pull-request-flow cause");
    }
    const verdict = canTransitionPr({
        from,
        to: intent.desired.meaning,
        cause: intent.desired.cause,
    });
    return verdict.allowed ? { ok: true } : offMap(from, verdict.code);
}

/**
 * The per-intent screen, run on everything `evaluate` returns. The typed
 * handle already makes an undeclared intent a compile error; this repeats
 * the check at runtime because a capability is ordinary code that can be
 * built from `unknown`, and the boundary must not depend on the far side
 * having been compiled honestly.
 */
export function screenIntent(
    intent: AnyIntent,
    declaration: TypedDeclaration,
    projection: ObservationProjection<MappableMeaning> | null,
): IntentScreen {
    if (intent.capability !== declaration.name) {
        return {
            ok: false,
            code: "foreignCapability",
            reason: `intent attributed to "${intent.capability}" was returned by "${declaration.name}"`,
        };
    }
    if (!declaration.intents.includes(intent.operation)) {
        return {
            ok: false,
            code: "undeclaredIntent",
            reason: `"${declaration.name}" did not declare intent "${intent.operation}"`,
        };
    }
    if (!Number.isFinite(intent.cause.observedAt.getTime())) {
        return {
            ok: false,
            code: "invalidCause",
            reason: "the intent's cause carries an invalid timestamp",
        };
    }
    // The key is the store's `effect_id` (D65), so a capability free to name
    // it could merge two effects into one or split a redelivery into two. It
    // is checked by RE-DERIVING it: the platform owns the identity, and the
    // factory's copy is an ergonomic, not an authority.
    //
    // AFTER the cause check, and only there: the derivation calls
    // `observedAt.toISOString()`, which throws on an invalid date.
    if (intent.idempotencyKey !== deriveIdempotencyKey(intent)) {
        return {
            ok: false,
            code: "idempotencyKeyMismatch",
            reason: "the intent's idempotency key is not the one this occasion derives",
        };
    }
    if (intent.operation === "applyMappedLabel") {
        if (projection === null) {
            return {
                ok: false,
                code: "authoritativePositionUnavailable",
                reason: "the authoritative current position is unavailable",
            };
        }
        return screenTransition(intent, projection);
    }
    return { ok: true };
}

/** The class any future writer must use — from the catalogue, never the intent. */
export function idempotencyOf(operation: IntentOperation): IdempotencyClass {
    return INTENT_OPERATIONS[operation].idempotencyClass;
}
