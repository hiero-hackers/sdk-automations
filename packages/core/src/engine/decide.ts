/**
 * decide() — the one verb (D92). A delivery or a fact record goes in; a report
 * and the approved intents come out; nothing else escapes. It owns the
 * composition: normalize → evaluate → screen → derive the world → gate →
 * report. Externals are only the facts core cannot know, as data and lookups,
 * never I/O; everything derivable is derived.
 */

import { factGroupUnread, type Facts, type ItemRef, type RepositoryRef } from "../catalogue.js";
import {
    modesOf,
    projectCapabilityView,
    type CapabilityView,
    type TypedDeclaration,
} from "../capability/index.js";
import {
    addressManagedComment,
    managedCommentOf,
    type AnyIntent,
    type DestructiveGrace,
    type Intent,
    type ManagedComment,
} from "../intents/index.js";
import type { PermissionGrant } from "../github/index.js";
import {
    EngineHandle,
    isSkipSignal,
    readIntent,
    screenIntent,
    thrownDetail,
    type EngineCapability,
    type ResolverSource,
} from "./invoke.js";
import { normalizeDelivery } from "./events.js";
import type { RepositoryConfig } from "../config/index.js";
import { closureOf } from "../workflow/index.js";
import {
    deriveWorld,
    evaluateDestructive,
    evaluateWrite,
    type DestructiveWarning,
    type HumanChangeOrdering,
    type PendingWarning,
    type SafetyVerdict,
    type WriteContext,
} from "../safety/index.js";
import {
    explanationFinding,
    finding,
    screenFinding,
    verdictFinding,
    type Finding,
    type Report,
    type Subject,
} from "../report/index.js";
import { wouldApplyFinding, writeRequestFor } from "./change.js";

// ─── What goes in, what comes out ────────────────────────────────────

/** The facts core cannot derive, supplied as data and lookups rather than I/O. */
export interface Externals {
    readonly killSwitchActive: boolean;
    readonly installationGrants: readonly PermissionGrant[];
    /** When this decision began, carried by approved effects into their apply-time gate. */
    readonly evaluatedAt?: Date;
    /** Ordering evidence per item; `"unknown"` is a safe conflict (safety.md §3). */
    readonly latestHumanChangeAt: (
        item: ItemRef,
    ) => HumanChangeOrdering | Promise<HumanChangeOrdering>;
    /** Resolver answers, when the shell has them. Absent means unavailable. */
    readonly resolve?: ResolverSource;
    /** The warning recorded for one effect, or `null`; absent is "none" (grace.md §2). */
    readonly warningFor?: (
        effectId: string,
    ) => DestructiveWarning | null | Promise<DestructiveWarning | null>;
}

/**
 * One thing to decide about: a raw delivery, or a fact record the caller
 * already holds. One record is one item (contracts/facts.md §4).
 */
export type DecideInput =
    | {
          readonly kind: "delivery";
          readonly repository: RepositoryRef;
          readonly event: string;
          readonly deliveryId?: string;
          readonly payload: unknown;
      }
    | { readonly kind: "facts"; readonly facts: Facts };

/**
 * A warning authored but not yet posted, and the act it will authorize.
 * `effectId` is the ACT's, not the warning comment's (grace.md §3).
 */
export interface WarningToRecord extends PendingWarning {
    readonly effectId: string;
}

export interface Effect {
    readonly intent: AnyIntent;
    readonly managedComment: ManagedComment | null;
    /** The warning this comment records when it lands, or `null` (grace.md §3). */
    readonly records: WarningToRecord | null;
}

/** What one decision produced: the record and any active-mode effects. */
export interface Decision {
    readonly report: Report;
    /** Effects that passed every gate in `active` mode. */
    readonly approved: readonly Effect[];
}

// ─── The gates one intent passes ─────────────────────────────────────

/**
 * The refusal for an intent that names somebody else's item: one record is one
 * item (facts.md §4), so no other item's world is here to judge it against.
 */
const NOT_THIS_RECORD: SafetyVerdict = {
    outcome: "refuse",
    code: "preconditionStale",
    reason: "the intent names an item this record does not carry",
};

/** Whether an intent is about the item the record carries. */
function namesTheRecord(intent: AnyIntent, facts: Facts): boolean {
    return (
        intent.repository.owner === facts.repository.owner &&
        intent.repository.repo === facts.repository.repo &&
        intent.item.kind === facts.item.kind &&
        intent.item.number === facts.item.number
    );
}

/**
 * The ordering evidence for one item, with the lookup CONTAINED: a seam that
 * threw yields `"unknown"`, which the rules refuse fail-closed (D51).
 */
async function orderingFor(
    item: ItemRef,
    externals: Externals,
): Promise<{ readonly value: HumanChangeOrdering; readonly defect: string | null }> {
    try {
        return { value: await externals.latestHumanChangeAt(item), defect: null };
    } catch (thrown) {
        return { value: "unknown", defect: thrownDetail(thrown) };
    }
}

/**
 * The intent as the platform will act on it, with a comment's principal name
 * resolved into its handle. Here, so everything downstream reads the same bytes.
 */
function addressed(intent: AnyIntent, config: RepositoryConfig): AnyIntent {
    if (intent.operation !== "postManagedComment") return intent;
    const body = addressManagedComment(
        intent.desired.body,
        intent.desired.mention,
        config.principals,
    );
    return body === intent.desired.body
        ? intent
        : { ...intent, desired: { ...intent.desired, body } };
}

function managedCommentFor(intent: AnyIntent): ManagedComment | null {
    if (intent.operation === "postManagedComment") {
        return managedCommentOf({
            capability: intent.capability,
            item: intent.item,
            kind: intent.desired.kind,
            topic: intent.desired.topic ?? "",
        });
    }
    return intent.grace === null
        ? null
        : managedCommentOf({
              capability: intent.capability,
              item: intent.item,
              kind: "notice",
              topic: intent.grace.topic ?? "",
          });
}

/**
 * The warning comment the platform posts on an act's first sight, authored here
 * because no capability may request one (grace.md §2).
 */
function warningEffectFor(act: AnyIntent, grace: DestructiveGrace): Intent<"postManagedComment"> {
    return {
        capability: act.capability,
        repository: act.repository,
        item: act.item,
        operation: "postManagedComment",
        claims: { meaningsPresent: [], meaningsAbsent: [], closed: false },
        desired: { kind: "warning", topic: grace.topic ?? "", body: grace.warning.body },
        cause: act.cause,
        ...(act.evaluatedAt === undefined ? {} : { evaluatedAt: act.evaluatedAt }),
        explanation: act.explanation,
        idempotencyKey: `${act.idempotencyKey}:warning`,
        grace: null,
    };
}

/**
 * The recorded warning for one effect, with the lookup CONTAINED. A seam that
 * threw must not read as "no warning", so the caller declines to act at all.
 */
async function recordedWarning(
    effectId: string,
    externals: Externals,
): Promise<{ readonly value: DestructiveWarning | null; readonly defect: string | null }> {
    try {
        return { value: (await externals.warningFor?.(effectId)) ?? null, defect: null };
    } catch (thrown) {
        return { value: null, defect: thrownDetail(thrown) };
    }
}

/**
 * What one verdict on one intent is worth saying, and whether it may act. An
 * acting intent tells its story, a refusal keeps its reason alone (D92 3d).
 */
function outcomeOf(
    intent: AnyIntent,
    verdict: SafetyVerdict,
    config: RepositoryConfig,
    subject: Subject,
    records: WarningToRecord | null,
): { readonly findings: readonly Finding[]; readonly approved: Effect | null } {
    const effectSubject = {
        kind: "effect",
        capability: intent.capability,
        item: intent.item,
        operation: intent.operation,
    } as const;
    const findings: Finding[] = [];
    if (verdict.outcome !== "refuse") {
        findings.push(explanationFinding(intent.explanation, subject));
    }
    findings.push(verdictFinding(verdict, effectSubject));
    // After the verdict, which it elaborates: this says what the mode recorded.
    if (
        config.mode === "dry-run" &&
        verdict.outcome === "record-only" &&
        verdict.code === "modeRecordsOnly"
    ) {
        findings.push(wouldApplyFinding(intent, effectSubject));
    }
    return {
        findings,
        approved:
            verdict.outcome === "apply"
                ? { intent, managedComment: managedCommentFor(intent), records }
                : null,
    };
}

/**
 * One intent through every gate — screen, own item, derived world, verdict. A
 * graced act is never approved on its first sight (grace.md §2).
 */
async function gateIntent(
    value: unknown,
    declaration: TypedDeclaration,
    facts: Facts,
    config: RepositoryConfig,
    externals: Externals,
): Promise<{ readonly findings: readonly Finding[]; readonly approved: Effect | null }> {
    const parsed = readIntent(value);
    if (parsed === null) {
        return {
            findings: [
                screenFinding(
                    {
                        ok: false,
                        code: "malformedIntent",
                        reason: "the capability returned a malformed intent",
                    },
                    { kind: "capability", capability: declaration.name },
                ),
            ],
            approved: null,
        };
    }
    const intent = addressed(
        { ...parsed, evaluatedAt: new Date(facts.observedAt.getTime()) },
        config,
    );
    const evaluatedAt = externals.evaluatedAt ?? facts.observedAt;
    const forApply = (approved: AnyIntent): AnyIntent => ({
        ...approved,
        evaluatedAt: new Date(evaluatedAt.getTime()),
    });
    const subject = {
        kind: "item",
        capability: declaration.name,
        item: intent.item,
    } as const;
    const screen = screenIntent(intent, declaration, facts.position);
    if (!screen.ok) {
        return { findings: [screenFinding(screen, subject)], approved: null };
    }
    // No world to derive: the only projection here belongs to another item.
    if (!namesTheRecord(intent, facts)) {
        return {
            findings: [
                verdictFinding(NOT_THIS_RECORD, {
                    kind: "effect",
                    capability: declaration.name,
                    item: intent.item,
                    operation: intent.operation,
                }),
            ],
            approved: null,
        };
    }

    const ordering = await orderingFor(intent.item, externals);
    const before: Finding[] =
        ordering.defect === null
            ? []
            : [
                  finding(
                      "problem",
                      "humanOrderingLookupFailed",
                      `the human-change ordering lookup threw: ${ordering.defect}`,
                      subject,
                  ),
              ];
    /** One world per claim: the act's own, or the warning's `closed: false`. */
    const contextFor = (request: AnyIntent): WriteContext => ({
        killSwitchActive: externals.killSwitchActive,
        installationGrants: externals.installationGrants,
        latestHumanChangeAt: ordering.value,
        // A mode claim is judged against the native modes this record read.
        world: deriveWorld(facts.position, request.claims, modesOf(facts)),
    });
    const said = (
        result: ReturnType<typeof outcomeOf>,
    ): { readonly findings: readonly Finding[]; readonly approved: Effect | null } => ({
        findings: [...before, ...result.findings],
        approved: result.approved,
    });

    // `?? null` as the screen reads it: the field may be absent on an intent
    // built from `unknown`.
    const grace = intent.grace ?? null;
    if (grace === null) {
        const verdict = evaluateWrite(writeRequestFor(intent), config, contextFor(intent));
        return said(outcomeOf(forApply(intent), verdict, config, subject, null));
    }

    const recorded = await recordedWarning(intent.idempotencyKey, externals);
    if (recorded.defect !== null) {
        return {
            findings: [
                ...before,
                finding(
                    "problem",
                    "warningLookupFailed",
                    `the recorded-warning lookup threw, so nothing was warned and nothing acted: ${recorded.defect}`,
                    subject,
                ),
            ],
            approved: null,
        };
    }
    if (recorded.value === null) {
        const warning = warningEffectFor(intent, grace);
        const verdict = evaluateWrite(writeRequestFor(warning), config, contextFor(warning));
        return said(
            outcomeOf(forApply(warning), verdict, config, subject, {
                effectId: intent.idempotencyKey,
                request: writeRequestFor(intent),
                gracePeriodHours: grace.hours,
                cancelledBy: grace.cancelledBy,
                reversesWith: grace.reversesWith,
            }),
        );
    }
    const verdict = evaluateDestructive(
        {
            request: writeRequestFor(intent),
            warning: recorded.value,
            // The platform decides what the capability's reported activity means.
            qualifyingActivitySinceWarning:
                grace.activityAt !== null && grace.activityAt.getTime() > recorded.value.warnedAtMs,
        },
        config,
        contextFor(intent),
        facts.observedAt,
    );
    return said(outcomeOf(forApply(intent), verdict, config, subject, null));
}

/**
 * One capability's intents, with the CALL contained: a throw becomes a recorded
 * defect and that capability contributes nothing. What it explained is kept.
 */
async function intentsFrom(
    capability: EngineCapability,
    facts: Facts,
    view: CapabilityView<TypedDeclaration>,
    handle: EngineHandle,
): Promise<{ readonly intents: readonly unknown[]; readonly defect: string | null }> {
    try {
        // The `never`s are `toEngine`'s erasure showing through.
        const intents: unknown = await capability.evaluate(
            facts as never,
            view as never,
            handle as never,
        );
        return Array.isArray(intents)
            ? { intents: [...intents], defect: null }
            : { intents: [], defect: "the capability returned a non-array intent collection" };
    } catch (thrown) {
        // The platform's own sentinel: the handle already said why (D51).
        if (isSkipSignal(thrown)) return { intents: [], defect: null };
        return { intents: [], defect: thrownDetail(thrown) };
    }
}

// ─── The verb ────────────────────────────────────────────────────────

/**
 * What this input is about: the record to decide on, the repository the report
 * must name even for an unreadable payload, and a raw delivery's reading.
 */
function readInput(
    input: DecideInput,
    config: RepositoryConfig,
): {
    readonly repository: RepositoryRef;
    readonly facts: Facts | null;
    readonly findings: readonly Finding[];
} {
    if (input.kind === "facts") {
        return { repository: input.facts.repository, facts: input.facts, findings: [] };
    }
    const normalized = normalizeDelivery(input.event, input.payload, config, input.deliveryId);
    if (normalized.kind === "facts") {
        return {
            repository: normalized.facts.repository,
            facts: normalized.facts,
            findings: [],
        };
    }
    const refusal =
        normalized.kind === "ignored"
            ? finding("info", "deliveryIgnored", `event "${normalized.event}" carries no facts`, {
                  kind: "repository",
              })
            : finding("problem", normalized.code, normalized.detail, { kind: "repository" });
    return { repository: input.repository, facts: null, findings: [refusal] };
}

/**
 * The entry point: a delivery becomes a report, plus the intents that may act.
 * Total — every fallible seam is contained, so a report always comes back.
 */
export async function decide(
    input: DecideInput,
    config: RepositoryConfig,
    capabilities: readonly EngineCapability[],
    externals: Externals,
): Promise<Decision> {
    const read = readInput(input, config);
    const findings: Finding[] = [...read.findings];
    const approved: Effect[] = [];
    const facts = read.facts;

    if (facts !== null) {
        for (const capability of capabilities) {
            const declaration = capability.declaration;
            if (config.capabilities[declaration.name]?.enabled !== true) continue;
            if (!declaration.facts.includes(facts.kind)) continue;
            const unread = declaration.needs.filter((group) => factGroupUnread(facts, group));
            if (unread.length > 0) {
                findings.push(
                    finding(
                        "info",
                        "factsUnread",
                        `"${declaration.name}" needs ${unread.join(", ")}, which this producer did not read`,
                        { kind: "capability", capability: declaration.name },
                    ),
                );
                continue;
            }

            // A closed issue and a merged pull request have both left (D59): routine, so silent.
            if (declaration.closed !== true && closureOf(facts.position) !== null) continue;

            const handle = new EngineHandle(declaration, facts, externals.resolve);
            const view = projectCapabilityView(declaration, config);
            const evaluated = await intentsFrom(capability, facts, view, handle);

            for (const explanation of handle.explanations) {
                findings.push(
                    explanationFinding(explanation, {
                        kind: "capability",
                        capability: declaration.name,
                    }),
                );
            }
            for (const resolver of handle.violations) {
                findings.push(
                    finding(
                        "problem",
                        "undeclaredResolver",
                        `"${declaration.name}" asked for undeclared resolver "${resolver}"`,
                        { kind: "capability", capability: declaration.name },
                    ),
                );
            }
            for (const failure of handle.failures) {
                findings.push(
                    finding(
                        "problem",
                        "resolverFailed",
                        `the resolver failed answering "${declaration.name}" — ${failure}`,
                        { kind: "capability", capability: declaration.name },
                    ),
                );
            }
            if (evaluated.defect !== null) {
                findings.push(
                    finding(
                        "problem",
                        "capabilityFailed",
                        `"${declaration.name}" failed during evaluation: ${evaluated.defect}`,
                        { kind: "capability", capability: declaration.name },
                    ),
                );
            }

            if (handle.skipped && evaluated.intents.length > 0) {
                findings.push(
                    finding(
                        "problem",
                        "intentsAfterSkip",
                        `"${declaration.name}" caught the platform's skip and returned ${String(evaluated.intents.length)} intents, which are refused`,
                        { kind: "capability", capability: declaration.name },
                    ),
                );
                continue;
            }

            for (const intent of evaluated.intents) {
                // The record IS one item: its projection is the only world (facts.md §4).
                const gated = await gateIntent(intent, declaration, facts, config, externals);
                findings.push(...gated.findings);
                if (gated.approved !== null) approved.push(gated.approved);
            }
        }
    }

    return {
        report: {
            revision: config.revision,
            mode: config.mode,
            repository: read.repository,
            findings,
        },
        approved,
    };
}
