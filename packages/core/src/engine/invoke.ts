/**
 * The engine's side of a call to a capability whose declaration type it cannot
 * know: it holds a heterogeneous list and so has no single `D`, works against
 * the erased shapes here, and screens what comes back (D175).
 */

import {
    MANAGED_COMMENT_KINDS,
    type Facts,
    type IntentCatalogue,
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
    type DestructiveGrace,
    type Intent,
    type IntentScreen,
} from "../intents/index.js";
import { MAPPABLE_MEANINGS, type MappableMeaning } from "../config/index.js";
import { MIN_GRACE_HOURS, PULL_REQUEST_MODES, type PullRequestMode } from "../safety/index.js";
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

function own(value: unknown, key: string): unknown {
    if (typeof value !== "object" || value === null) return undefined;
    return Object.hasOwn(value, key) ? (value as Record<string, unknown>)[key] : undefined;
}

function item(
    value: unknown,
): { readonly kind: "issue" | "pullRequest"; readonly number: number } | null {
    const kind = own(value, "kind");
    const number = own(value, "number");
    return (kind === "issue" || kind === "pullRequest") &&
        typeof number === "number" &&
        Number.isSafeInteger(number) &&
        number > 0
        ? { kind, number }
        : null;
}

/** One `ConfigError`, re-read: the four fields a report renders. */
function configError(value: unknown): unknown | null {
    const code = own(value, "code");
    const message = own(value, "message");
    const path = own(value, "path");
    const line = own(value, "line");
    if (typeof code !== "string" || typeof message !== "string") return null;
    if (path !== null && typeof path !== "string") return null;
    if (line !== undefined && (typeof line !== "number" || !Number.isSafeInteger(line)))
        return null;
    return line === undefined ? { code, message, path } : { code, message, path, line };
}

/**
 * `configAtHead`'s union, read to the depth a reader of it branches on. The
 * parsed `RepositoryConfig` is checked for being a mapping and no further (D77).
 */
function configAtHead(value: unknown): unknown | null {
    const touched = own(value, "touched");
    if (touched === false) return { touched: false };
    if (touched !== true) return null;

    const revision = own(value, "revision");
    const result = own(value, "result");
    const ok = own(result, "ok");
    if (typeof revision !== "string" || revision.length === 0) return null;

    if (ok === true) {
        const config = own(result, "config");
        return typeof config === "object" && config !== null
            ? { touched: true, revision, result: { ok: true, config } }
            : null;
    }
    if (ok !== false) return null;

    const errors = own(result, "errors");
    if (!Array.isArray(errors)) return null;
    const read = errors.map(configError);
    return read.every((error) => error !== null)
        ? { touched: true, revision, result: { ok: false, errors: read } }
        : null;
}

/** A list answer's entries, or `null` when the answer is not a list at all. */
function entriesOf(value: unknown): readonly unknown[] | null {
    return Array.isArray(value) ? [...(value as readonly unknown[])] : null;
}

/** `assigneesOf` — logins, as written. */
function assignees(value: unknown): unknown | null {
    const listed = entriesOf(value);
    if (listed === null) return null;
    return listed.every((entry) => typeof entry === "string") ? [...listed] : null;
}

/** `linkedIssues` — the items a pull request closes. */
function linked(value: unknown): unknown | null {
    const listed = entriesOf(value);
    if (listed === null) return null;
    const items = listed.map(item);
    return items.every((entry) => entry !== null) ? items : null;
}

/** `commitAttestations` — the five facts a quality check judges, per commit. */
function attestations(value: unknown): unknown | null {
    const listed = entriesOf(value);
    if (listed === null) return null;
    const commits = listed.map((entry) => {
        const sha = own(entry, "sha");
        const summary = own(entry, "summary");
        const signedOff = own(entry, "signedOff");
        const verified = own(entry, "verified");
        const merge = own(entry, "merge");
        return typeof sha === "string" &&
            typeof summary === "string" &&
            typeof signedOff === "boolean" &&
            typeof verified === "boolean" &&
            typeof merge === "boolean"
            ? { sha, summary, signedOff, verified, merge }
            : null;
    });
    return commits.every((entry) => entry !== null) ? commits : null;
}

/** `openAssignments` — each held item with the meanings it carries. */
function assignments(value: unknown): unknown | null {
    const listed = entriesOf(value);
    if (listed === null) return null;
    const held = listed.map((entry) => {
        const target = item(own(entry, "item"));
        const meanings = own(entry, "meanings");
        return target !== null &&
            Array.isArray(meanings) &&
            meanings.every(
                (meaning) =>
                    typeof meaning === "string" && MAPPABLE_MEANINGS.includes(meaning as never),
            )
            ? { item: target, meanings: [...meanings] }
            : null;
    });
    return held.every((entry) => entry !== null) ? held : null;
}

/** A resolver added to the catalogue needs a reader above, or this file does not build. */
function assertNever(_query: never): null {
    return null;
}

/** One resolver's answer value, re-read to the shape its catalogue entry promises. */
function answerValue(query: ResolverName, value: unknown): unknown | null {
    switch (query) {
        case "isAutomationActor":
        case "mergeability":
            return typeof value === "boolean" ? value : null;
        case "configAtHead":
            return configAtHead(value);
        case "assigneesOf":
            return assignees(value);
        case "linkedIssues":
            return linked(value);
        case "commitAttestations":
            return attestations(value);
        case "openAssignments":
            return assignments(value);
        default:
            return assertNever(query);
    }
}

function resolverAnswer(query: ResolverName, value: unknown): ResolverAnswer<unknown> | null {
    try {
        const ok = own(value, "ok");
        if (ok === true) {
            const answer = answerValue(query, own(value, "value"));
            return answer === null ? null : { ok: true, value: answer };
        }
        const reason = own(value, "reason");
        const detail = own(value, "detail");
        return ok === false &&
            ["noPermission", "rateLimited", "unavailable", "notConfigured"].includes(
                reason as string,
            ) &&
            typeof detail === "string"
            ? { ok: false, reason: reason as never, detail }
            : null;
    } catch {
        return null;
    }
}

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
        const built = buildIntent(this.declaration.name, this.facts, request);
        if (built !== null) return built as AnyIntent;
        const meaning = "meaning" in request.desired ? request.desired.meaning : "";
        return this.stop(
            `Skipped: no edge on the workflow map moves this item to ${meaning}.`,
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
            const answer: unknown = await this.source(query, input as never);
            const read = resolverAnswer(query, answer);
            if (read !== null) return read;
            const detail = "the resolver source returned a malformed answer";
            this.failures.push(`${query}: ${detail}`);
            return { ok: false, reason: "unavailable", detail };
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

function stringList(value: unknown): readonly string[] | null {
    if (!Array.isArray(value)) return null;
    const copy = [...value];
    return copy.every((entry) => typeof entry === "string") ? copy : null;
}

function desiredOf(
    operation: IntentOperation,
    value: unknown,
): IntentCatalogue[IntentOperation] | null {
    if (operation === "postManagedComment") {
        const kind = own(value, "kind");
        const topic = own(value, "topic");
        const mention = own(value, "mention");
        const body = own(value, "body");
        if (
            !MANAGED_COMMENT_KINDS.includes(kind as never) ||
            (topic !== undefined && typeof topic !== "string") ||
            (mention !== undefined && typeof mention !== "string") ||
            typeof body !== "string"
        ) {
            return null;
        }
        return {
            kind: kind as (typeof MANAGED_COMMENT_KINDS)[number],
            ...(topic === undefined ? {} : { topic }),
            ...(mention === undefined ? {} : { mention }),
            body,
        };
    }
    if (operation === "applyMappedLabel") {
        const meaning = own(value, "meaning");
        const cause = own(value, "cause");
        return typeof meaning === "string" && typeof cause === "string"
            ? { meaning: meaning as MappableMeaning, cause: cause as never }
            : null;
    }
    const key =
        operation === "assign" || operation === "unassign" || operation === "releaseAssignment"
            ? "login"
            : "reason";
    const text = own(value, key);
    return typeof text === "string" && text.length > 0 ? ({ [key]: text } as never) : null;
}

function graceOf(value: unknown): DestructiveGrace | null | undefined {
    if (value === null || value === undefined) return null;
    const hours = own(value, "hours");
    const topic = own(value, "topic");
    const warning = own(value, "warning");
    const notice = own(value, "notice");
    const cancelledBy = own(value, "cancelledBy");
    const reversesWith = own(value, "reversesWith");
    const activityAt = own(value, "activityAt");
    const warningBody = own(warning, "body");
    const noticeBody = own(notice, "body");
    if (
        typeof hours !== "number" ||
        !Number.isFinite(hours) ||
        (topic !== undefined && typeof topic !== "string") ||
        typeof warningBody !== "string" ||
        typeof noticeBody !== "string" ||
        typeof cancelledBy !== "string" ||
        cancelledBy.length === 0 ||
        typeof reversesWith !== "string" ||
        reversesWith.length === 0 ||
        (activityAt !== null &&
            (!(activityAt instanceof Date) || !Number.isFinite(activityAt.getTime())))
    ) {
        return undefined;
    }
    return {
        hours,
        ...(topic === undefined ? {} : { topic }),
        warning: { body: warningBody },
        notice: { body: noticeBody },
        cancelledBy,
        reversesWith,
        activityAt: activityAt === null ? null : new Date(activityAt.getTime()),
    };
}

export function readIntent(value: unknown): AnyIntent | null {
    try {
        const capability = own(value, "capability");
        const repository = own(value, "repository");
        const owner = own(repository, "owner");
        const repo = own(repository, "repo");
        const item = own(value, "item");
        const kind = own(item, "kind");
        const number = own(item, "number");
        const operation = own(value, "operation");
        const claims = own(value, "claims");
        const present = stringList(own(claims, "meaningsPresent"));
        const absent = stringList(own(claims, "meaningsAbsent"));
        const closed = own(claims, "closed");
        // Absent is no claim, which is what every value written before the
        // mode was claimable carries — so an old record parses as claiming
        // nothing rather than as malformed.
        const mode = own(claims, "pullRequestMode");
        const cause = own(value, "cause");
        const causeName = own(cause, "cause");
        const observedAt = own(cause, "observedAt");
        const deliveryId = own(cause, "deliveryId");
        const explanation = own(value, "explanation");
        const explanationCapability = own(explanation, "capability");
        const summary = own(explanation, "summary");
        const detail = stringList(own(explanation, "detail"));
        const idempotencyKey = own(value, "idempotencyKey");
        if (
            typeof capability !== "string" ||
            typeof owner !== "string" ||
            owner.length === 0 ||
            typeof repo !== "string" ||
            repo.length === 0 ||
            (kind !== "issue" && kind !== "pullRequest") ||
            typeof number !== "number" ||
            !Number.isSafeInteger(number) ||
            number < 1 ||
            typeof operation !== "string" ||
            !Object.hasOwn(INTENT_OPERATIONS, operation) ||
            present === null ||
            absent === null ||
            !present.every((entry) => MAPPABLE_MEANINGS.includes(entry as never)) ||
            !absent.every((entry) => MAPPABLE_MEANINGS.includes(entry as never)) ||
            (closed !== null && typeof closed !== "boolean") ||
            (mode !== undefined && !PULL_REQUEST_MODES.includes(mode as never)) ||
            typeof causeName !== "string" ||
            !(observedAt instanceof Date) ||
            (deliveryId !== undefined && typeof deliveryId !== "string") ||
            typeof explanationCapability !== "string" ||
            typeof summary !== "string" ||
            detail === null ||
            typeof idempotencyKey !== "string"
        ) {
            return null;
        }
        const desired = desiredOf(operation as IntentOperation, own(value, "desired"));
        const grace = graceOf(own(value, "grace"));
        if (desired === null || grace === undefined) return null;
        return {
            capability,
            repository: { owner, repo },
            item: { kind, number },
            operation,
            claims: {
                meaningsPresent: present as readonly MappableMeaning[],
                meaningsAbsent: absent as readonly MappableMeaning[],
                closed,
                ...(mode === undefined ? {} : { pullRequestMode: mode as PullRequestMode }),
            },
            desired,
            cause: {
                cause: causeName,
                observedAt: new Date(observedAt.getTime()),
                ...(deliveryId === undefined ? {} : { deliveryId }),
            },
            explanation: { capability: explanationCapability, summary, detail },
            idempotencyKey,
            grace,
        } as AnyIntent;
    } catch {
        return null;
    }
}

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

    // `blocked` is a pause flag, not a position, and only a human may set it (D28, D79).
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
    if (grace !== null && !(grace.hours >= MIN_GRACE_HOURS)) {
        return {
            ok: false,
            code: "graceBelowFloor",
            reason: `grace period ${String(grace.hours)}h is below the ${String(MIN_GRACE_HOURS)}h floor (grace.md)`,
        };
    }
    return { ok: true };
}

/**
 * The per-intent screen, run on everything `evaluate` returns; it repeats at
 * runtime what the typed handle already checks when compiled.
 */
export function screenIntent(
    value: unknown,
    declaration: TypedDeclaration,
    projection: Projection<MappableMeaning> | null,
): IntentScreen {
    const intent = readIntent(value);
    if (intent === null) {
        return {
            ok: false,
            code: "malformedIntent",
            reason: "the capability returned a malformed intent",
        };
    }
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
