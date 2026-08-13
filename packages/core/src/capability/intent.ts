/**
 * What a capability asks for, and the screens every request passes.
 *
 * An intent describes a desired OUTCOME, not an API call. Translation into
 * GitHub calls is deliberately outside `core/` and is not implemented yet.
 */

import type { ActionClass, ClaimedFacts } from "../safety/index.js";
import type { IdempotencyClass } from "./catalogue.js";
import {
    canTransitionIssue,
    canTransitionPr,
    isIssueCause,
    isIssueMeaning,
    isPrCause,
    isPrMeaning,
} from "../workflow/index.js";
import {
    ACTION_CLASS_RANK,
    INTENT_OPERATIONS,
    type DatedCause,
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
 * The warning record a destructive intent must carry (D64). The warned CAUSE
 * rides separately because the branded warning cannot cross the store —
 * rebuilding from the current request would compare a value with itself
 * (D60, D72).
 */
export interface DestructiveDetail {
    readonly warnedAt: Date;
    readonly gracePeriodDays: number;
    readonly earliestActionAt: Date;
    readonly cancelledBy: string;
    readonly reversesWith: string;
    readonly qualifyingActivitySinceWarning: boolean;
    readonly warnedCause: string;
    readonly warnedCauseObservedAt: Date;
}

/**
 * One request from a capability: what to do, to which item, and the facts it
 * believes hold while asking.
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
    /** At or above `INTENT_OPERATIONS[operation].actionClassFloor`. */
    readonly actionClass: ActionClass;
    /** Required when `actionClass` is `clockTriggeredDestructive`, else absent. */
    readonly destructive?: DestructiveDetail;
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
    "actionClassBelowFloor",
    "invalidCause",
    "destructiveWithoutWarning",
    "warningWithoutDestructive",
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
 * Is the move this intent would make on the profile's map? Capabilities move
 * along documented edges; humans may land anywhere (D29, enforced by D78).
 * Self-contained: the claimed `from` is the same `expected` that safety
 * rechecks as the derived world.
 */
function screenTransition(intent: Intent<"applyMappedLabel">): IntentScreen {
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

    // Two flows, symmetric; the predicates carry the narrowing (D90). Held
    // meanings filter to own-flow, since cross-entity labels are preserved
    // noise (D35), and >1 own-flow position is a conflict with no edge.
    const wrongEntity = (): IntentScreen => ({
        ok: false,
        code: "meaningWrongEntity",
        reason: `"${intent.desired.meaning}" is not ${intent.item.kind === "issue" ? "an issue" : "a pull request"} position`,
    });
    const conflicted = (held: readonly string[]): IntentScreen => ({
        ok: false,
        code: "positionConflict",
        reason: `the item is claimed to hold ${held.join(" and ")}; a conflicted position has no edge to move along`,
    });
    const offMap = (from: string | null, detail: string): IntentScreen => ({
        ok: false,
        code: "transitionNotOnMap",
        reason: `${from ?? "no position"} → ${intent.desired.meaning} for "${intent.desired.cause}" is not a documented edge (${detail})`,
    });

    if (intent.item.kind === "issue") {
        if (!isIssueMeaning(intent.desired.meaning)) return wrongEntity();
        const held = intent.expected.meaningsPresent.filter(isIssueMeaning);
        if (held.length > 1) return conflicted(held);
        const from = held.length === 1 ? held[0]! : null;
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

    if (!isPrMeaning(intent.desired.meaning)) return wrongEntity();
    const held = intent.expected.meaningsPresent.filter(isPrMeaning);
    if (held.length > 1) return conflicted(held);
    const from = held.length === 1 ? held[0]! : null;
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
export function screenIntent(intent: AnyIntent, declaration: TypedDeclaration): IntentScreen {
    if (intent.capability !== declaration.name) {
        return {
            ok: false,
            code: "foreignCapability",
            reason: `intent attributed to "${intent.capability}" was returned by "${declaration.name}"`,
        };
    }
    const declared = declaration.intents.find((i) => i.name === intent.operation);
    if (declared === undefined) {
        return {
            ok: false,
            code: "undeclaredIntent",
            reason: `"${declaration.name}" did not declare intent "${intent.operation}"`,
        };
    }
    const facts = INTENT_OPERATIONS[intent.operation];
    if (ACTION_CLASS_RANK[intent.actionClass] < ACTION_CLASS_RANK[facts.actionClassFloor]) {
        return {
            ok: false,
            code: "actionClassBelowFloor",
            reason: `"${intent.operation}" declared as "${intent.actionClass}" is below the "${facts.actionClassFloor}" floor (FINDING(runtime-action-class-floor))`,
        };
    }
    if (!Number.isFinite(intent.cause.observedAt.getTime())) {
        return {
            ok: false,
            code: "invalidCause",
            reason: "the intent's cause carries an invalid timestamp",
        };
    }
    // Both directions are errors; the dangerous one is a warning on a
    // NON-destructive intent — a grace period no gate will check (D64).
    const destructive = intent.actionClass === "clockTriggeredDestructive";
    if (destructive && intent.destructive === undefined) {
        return {
            ok: false,
            code: "destructiveWithoutWarning",
            reason: `"${intent.operation}" is clock-triggered destructive but carries no warning record (safety.md §3)`,
        };
    }
    if (!destructive && intent.destructive !== undefined) {
        return {
            ok: false,
            code: "warningWithoutDestructive",
            reason: `"${intent.operation}" carries a warning record but is declared "${intent.actionClass}" — no gate would check it`,
        };
    }
    if (intent.operation === "applyMappedLabel") {
        return screenTransition(intent);
    }
    return { ok: true };
}

/** The class any future writer must use — from the catalogue, never the intent. */
export function idempotencyOf(operation: IntentOperation): IdempotencyClass {
    return INTENT_OPERATIONS[operation].idempotencyClass;
}
