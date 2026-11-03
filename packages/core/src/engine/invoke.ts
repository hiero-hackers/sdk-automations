/**
 * The engine's side of a call to a capability whose declaration type it cannot
 * know: it holds a heterogeneous list and so has no single `D`, works against
 * the erased shapes here, and screens what comes back (D175). The shape of what
 * comes back is the compiler's (D209); the screens judge meaning.
 */

import {
    type Facts,
    type IntentOperation,
    type ResolverAnswer,
    type ResolverInput,
    type ResolverName,
    type ResolverOutput,
    type StructuredExplanation,
} from "../catalogue.js";
import {
    buildIntent,
    type Capability,
    type IntentRequest,
    type PlatformHandle,
    type TypedDeclaration,
} from "../capability/index.js";
import {
    deriveIdempotencyKey,
    INTENT_OPERATIONS,
    type AnyIntent,
    type Intent,
    type IntentScreen,
} from "../intents/index.js";
import type { MappableMeaning } from "../config/index.js";
import { MIN_GRACE_HOURS } from "../safety/index.js";
import {
    canTransitionIssue,
    canTransitionPr,
    isIssueCause,
    isIssueMeaning,
    isPrCause,
    isPrMeaning,
    type Projection,
} from "../workflow/index.js";

// ─── The erased call ─────────────────────────────────────────────────

/** A capability with its declaration type erased — what a list can hold. */
export interface EngineCapability {
    readonly declaration: TypedDeclaration;
    evaluate(facts: never, config: never, platform: never): Promise<readonly AnyIntent[]>;
}

/**
 * The one blessed erasure (D92), sound because `never` in every parameter
 * position is what any concrete `evaluate` accepts contravariantly.
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
    try {
        return thrown instanceof Error ? String(thrown.message) : String(thrown);
    } catch {
        return "an unprintable value";
    }
}

/**
 * The one throw a capability body may cause, and it is the platform's own:
 * `ask` ends the evaluation as skipped, and `intentsFrom` catches it (D51).
 */
class SkipSignal {
    readonly skipped = true;
}

export function isSkipSignal(thrown: unknown): thrown is SkipSignal {
    try {
        return thrown instanceof SkipSignal;
    } catch {
        return false;
    }
}

/**
 * The handle a capability is given: it refuses an undeclared resolver without
 * throwing, into `violations`; a throwing resolver source goes to `failures`.
 * An answer is the adapter's, verified at the network edge, and trusted here.
 */
export class EngineHandle {
    readonly explanations: StructuredExplanation[] = [];
    readonly violations: string[] = [];
    /** Declared resolvers whose source threw, as `name: detail`. */
    readonly failures: string[] = [];
    /** Set once `ask` or `intent` ended the evaluation; intents after it are refused. */
    skipped = false;

    constructor(
        private readonly declaration: TypedDeclaration,
        private readonly facts: Facts,
        private readonly source: ResolverSource | undefined,
    ) {}

    skip(summary: string, ...detail: readonly string[]): readonly never[] {
        this.explanations.push({ capability: this.declaration.name, summary, detail });
        return [];
    }

    /** Ends the evaluation: the explanation is recorded, then the sentinel is thrown. */
    private stop(summary: string, ...detail: readonly string[]): never {
        this.skip(summary, ...detail);
        this.skipped = true;
        throw new SkipSignal();
    }

    async ask(query: ResolverName, input: unknown): Promise<unknown> {
        const answer = await this.resolve(query, input);
        if (answer.ok) return answer.value;
        return this.stop(
            `Skipped: the ${query} resolver could not answer.`,
            `resolver reason: ${answer.reason}`,
            answer.detail,
        );
    }

    intent(request: IntentRequest<IntentOperation>): AnyIntent {
        const built = buildIntent(
            this.declaration.name,
            this.facts,
            request,
            this.declaration.moves,
        );
        if (built !== null) return built as AnyIntent;
        const meaning = "meaning" in request.desired ? request.desired.meaning : "";
        return this.stop(
            `Skipped: no edge this capability owns moves this item to ${meaning}.`,
            `from ${this.facts.position.kind === "conflict" ? "a conflicted position" : (this.facts.position.state.meaning ?? "no position")}`,
        );
    }

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
            // `unavailable`, never an empty value: a source that threw established nothing.
            const detail = thrownDetail(thrown);
            this.failures.push(`${query}: ${detail}`);
            return { ok: false, reason: "unavailable", detail };
        }
    }

    explain(explanation: StructuredExplanation): void {
        this.explanations.push(explanation);
    }
}

/**
 * The engine's handle as the boundary types it for one declaration — what a
 * capability's own test hands `evaluate`. THE ONE CAST, the erasure `decide()` makes.
 */
export function handleFor<D extends TypedDeclaration>(
    declaration: D,
    facts: Facts,
    source?: ResolverSource,
): EngineHandle & PlatformHandle<D> {
    return new EngineHandle(declaration, facts, source) as EngineHandle & PlatformHandle<D>;
}

// ─── The intents that come back ──────────────────────────────────────

// ─── The intents that come back ──────────────────────────────────────

/**
 * Is the move this intent would make from the authoritative projected
 * position on the profile's map? Capability claims never supply `from`.
 */
function screenTransition(
    intent: Intent<"applyMappedLabel">,
    projection: Projection<MappableMeaning>,
): IntentScreen {
    if (projection.kind === "conflict") {
        return {
            ok: false,
            code: "positionConflict",
            reason: `the observed item holds ${projection.positions.join(" and ")}; a conflicted position has no edge to move along`,
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
 * Does the intent carry the grace terms its ACTION CLASS demands, and no others
 * (grace.md §1)? The class comes from the catalogue, never from the intent.
 */
function screenGrace(intent: AnyIntent): IntentScreen {
    const destructive =
        INTENT_OPERATIONS[intent.operation].actionClassFloor === "clockTriggeredDestructive";
    // An absent field reads as `null`: a missing promise is safely read as none made.
    const grace = intent.grace ?? null;
    if (destructive && grace === null) {
        return {
            ok: false,
            code: "graceMismatch",
            reason: `"${intent.operation}" is clock-triggered destructive, and such an intent must carry the grace terms the platform warns, waits and reports with (grace.md §1)`,
        };
    }
    if (!destructive && grace !== null) {
        return {
            ok: false,
            code: "graceMismatch",
            reason: `"${intent.operation}" is not clock-triggered destructive, so the grace terms it carries name a warning and a notice the platform would never post (grace.md §1)`,
        };
    }
    // A non-finite grace is not a period at all, so it is below any floor.
    if (grace !== null && !(Number.isFinite(grace.hours) && grace.hours >= MIN_GRACE_HOURS)) {
        return {
            ok: false,
            code: "graceBelowFloor",
            reason: `grace period ${String(grace.hours)}h is below the ${String(MIN_GRACE_HOURS)}h floor (grace.md)`,
        };
    }
    return { ok: true };
}

/**
 * The per-intent screen, run on everything `evaluate` returns: what the compiler
 * cannot judge — attribution, the derived key, the grace terms, the map.
 */
export function screenIntent(
    intent: AnyIntent,
    declaration: TypedDeclaration,
    projection: Projection<MappableMeaning> | null,
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
    // The key is the store's `effect_id` (D65), so it is checked by RE-DERIVING it.
    // AFTER the cause check: the derivation throws on an invalid date.
    if (intent.idempotencyKey !== deriveIdempotencyKey(intent)) {
        return {
            ok: false,
            code: "idempotencyKeyMismatch",
            reason: "the intent's idempotency key is not the one this occasion derives",
        };
    }
    const grace = screenGrace(intent);
    if (!grace.ok) return grace;
    if (intent.operation === "applyMappedLabel") {
        // `blocked` is a pause flag, not a position, and only a human may set it (D28, D79). First,
        // because no edge enters it: derived `labels` never hold it, so the ownership screens would hide this.
        if (intent.desired.meaning === "blocked") {
            return {
                ok: false,
                code: "pauseNotCapabilityWritable",
                reason: "pausing an item withholds it from every capability, so only a human may set `blocked` (D79); a capability that must stop work needs the immediatePreventive gate (D54)",
            };
        }
        if (!declaration.labels.includes(intent.desired.meaning)) {
            return {
                ok: false,
                code: "undeclaredMeaning",
                reason: `"${declaration.name}" did not declare label meaning "${intent.desired.meaning}"`,
            };
        }
        if (!declaration.moves.includes(intent.desired.cause)) {
            return {
                ok: false,
                code: "undeclaredCause",
                reason: `"${declaration.name}" does not own the cause "${intent.desired.cause}"`,
            };
        }
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
