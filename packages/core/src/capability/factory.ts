/**
 * Building an intent — capability-authoring ergonomics, owned (D92 3d).
 *
 * `buildIntent` reads the occasion and the claims off the record the capability
 * was handed, so an intent states only what it WANTS; a field it names narrows.
 */

import type { TypedDeclaration } from "./declaration.js";
import { meaningsOf, moveTo } from "./facts.js";
import type { Facts, ItemRef, RepositoryRef } from "../catalogue.js";
import type { IntentCatalogue, IntentOperation } from "../catalogue.js";
import { deriveIdempotencyKey, type DestructiveGrace, type Intent } from "../intents/index.js";
import type { ClaimedFacts } from "../safety/index.js";
import { closureOf, type TransitionCause } from "../workflow/index.js";

/** Where and when — bound once per evaluation, not restated per intent. */
export interface IntentOccasion {
    readonly repository: RepositoryRef;
    readonly item: ItemRef;
    readonly observedAt: Date;
    readonly deliveryId?: string;
}

/** What a capability says; the factory supplies the rest of the intent. */
export interface IntentSpec<K extends IntentOperation> {
    readonly operation: K;
    readonly desired: IntentCatalogue[K];
    /** What occasioned this — free text identifying the trigger, dated by the occasion. */
    readonly cause: string;
    /** Omitted fields claim nothing; `closed` defaults to no-claim, not open. */
    readonly claims?: Partial<ClaimedFacts>;
    readonly explain: { readonly summary: string; readonly detail?: readonly string[] };
    /** Stated by a clock-triggered destructive act and by nothing else (grace.md §1). */
    readonly grace?: DestructiveGrace;
}

/** A label's transition cause may be left to the map (`moveTo`); everything else is as declared. */
export type DesiredSpec<K extends IntentOperation> = K extends "applyMappedLabel"
    ? { readonly meaning: IntentCatalogue[K]["meaning"]; readonly cause?: TransitionCause }
    : IntentCatalogue[K];

/** What a capability says to `platform.intent`: the record supplies occasion, cause and claims. */
export interface IntentRequest<K extends IntentOperation> {
    readonly operation: K;
    readonly desired: DesiredSpec<K>;
    /** Free text naming the occasion; defaults to the trigger, and is part of the effect id (D65). */
    readonly cause?: string;
    /** The clock's start where an act has one; defaults to the observation (`design/guides/grace.md` §1). */
    readonly occasion?: Date;
    /** A named field narrows the derived claim; an omitted one is derived from the record. */
    readonly claims?: Partial<ClaimedFacts>;
    readonly explain: string | { readonly summary: string; readonly detail?: readonly string[] };
    readonly grace?: DestructiveGrace;
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
            claims: {
                meaningsPresent: spec.claims?.meaningsPresent ?? [],
                meaningsAbsent: spec.claims?.meaningsAbsent ?? [],
                closed: spec.claims?.closed ?? null,
                // Written in only when claimed: a key spelled `undefined` would
                // not match the same intent built from bytes.
                ...(spec.claims?.pullRequestMode === undefined
                    ? {}
                    : { pullRequestMode: spec.claims.pullRequestMode }),
            },
            desired: spec.desired,
            cause: {
                cause: spec.cause,
                observedAt: occasion.observedAt,
                ...(occasion.deliveryId === undefined ? {} : { deliveryId: occasion.deliveryId }),
            },
            explanation: {
                capability,
                summary: spec.explain.summary,
                detail: spec.explain.detail ?? [],
            },
            grace: spec.grace ?? null,
        };
        return {
            ...base,
            idempotencyKey: deriveIdempotencyKey(base),
        };
    };
}

/** The declaration-aware factory — the one capabilities should use. */
export function intentFactoryFor<const D extends TypedDeclaration>(
    declaration: D,
    occasion: IntentOccasion,
): <K extends D["intents"][number]>(spec: IntentSpec<K>) => Intent<K> {
    return intentFactory(declaration.name, occasion);
}

/** Every claim the record supports: closure, the meanings seen, and a label's absence. */
function derivedClaims(facts: Facts, desired: DesiredSpec<IntentOperation>): ClaimedFacts {
    const present = meaningsOf(facts);
    const applying = "meaning" in desired ? desired.meaning : null;
    return {
        meaningsPresent: present,
        meaningsAbsent: applying !== null && !present.includes(applying) ? [applying] : [],
        closed: closureOf(facts.position) !== null,
    };
}

/** The desired payload with a label's cause chosen from the map, or `null` off it. */
function desiredOf<K extends IntentOperation>(
    facts: Facts,
    desired: DesiredSpec<K>,
): IntentCatalogue[K] | null {
    if (!("meaning" in desired)) return desired as IntentCatalogue[K];
    const cause = desired.cause ?? moveTo(facts, desired.meaning);
    return cause === null ? null : ({ meaning: desired.meaning, cause } as IntentCatalogue[K]);
}

/**
 * Build one intent from the record it is about. `null` when a label has no
 * edge to move along, which the handle reports and the map refuses anyway.
 */
export function buildIntent<K extends IntentOperation>(
    capability: string,
    facts: Facts,
    request: IntentRequest<K>,
): Intent<K> | null {
    const desired = desiredOf(facts, request.desired);
    if (desired === null) return null;
    const derived = derivedClaims(facts, request.desired);
    const explain =
        typeof request.explain === "string" ? { summary: request.explain } : request.explain;
    const cause = request.cause ?? (facts.trigger.kind === "sweep" ? "sweep" : facts.trigger.event);
    return intentFactory(capability, {
        repository: facts.repository,
        item: facts.item,
        observedAt: request.occasion ?? facts.observedAt,
        ...(facts.trigger.kind === "event" && facts.trigger.deliveryId !== undefined
            ? { deliveryId: facts.trigger.deliveryId }
            : {}),
    })({
        operation: request.operation,
        desired,
        cause,
        claims: { ...derived, ...request.claims },
        explain,
        ...(request.grace === undefined ? {} : { grace: request.grace }),
    });
}
