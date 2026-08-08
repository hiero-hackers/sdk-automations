/**
 * decide() — the one verb (D92). A delivery or observation goes in; a
 * report and the approved intents come out; nothing else escapes.
 *
 * This file OWNS the composition: normalize → evaluate → screen → derive
 * the world → gate → report. Externals are only the facts core cannot know
 * (clock, kill switch, grants, human ordering, resolver answers) as data
 * and lookups, never I/O; everything derivable is derived, so a caller
 * cannot assert a world that contradicts the one it delivered.
 */

import {
    INTENT_OPERATIONS,
    projectCapabilityView,
    screenIntent,
    type AnyIntent,
    type ItemRef,
    type ObservationCatalogue,
    type RepositoryRef,
    type ResolverAnswer,
    type ResolverInput,
    type ResolverName,
    type ResolverOutput,
    type Capability,
    type StructuredExplanation,
    type TypedDeclaration,
} from "../capability/index.js";
import type { PermissionGrant } from "../github/index.js";
import { normalizeDelivery } from "./events.js";
import type { MappableMeaning, RepositoryConfig } from "../config/index.js";
import type { ObservationProjection } from "../workflow/index.js";
import {
    createDestructiveWarning,
    deriveWorld,
    evaluateDestructive,
    evaluateWrite,
    type WriteContext,
    type WriteRequest,
} from "../safety/index.js";
import {
    explanationFinding,
    finding,
    screenFinding,
    verdictFinding,
    type Finding,
    type Report,
} from "../report/index.js";

export type EngineObservation = ObservationCatalogue[keyof ObservationCatalogue];

/** A capability with its type parameter erased — the probes-harness pattern. */
export interface EngineCapability {
    readonly declaration: TypedDeclaration;
    evaluate(observation: never, config: never, platform: never): Promise<readonly AnyIntent[]>;
}

/**
 * The one blessed erasure (D92 cleanup). Sound because `never` in every
 * parameter position is what any concrete `evaluate` accepts
 * contravariantly — nothing widens, and the capability gains no reach it
 * did not have. Fourteen call sites used to re-argue this inline with
 * `as unknown as EngineCapability`; the argument now lives here once.
 */
export function toEngine<D extends TypedDeclaration>(capability: Capability<D>): EngineCapability {
    return capability as unknown as EngineCapability;
}

export interface DecideExternals {
    /** The caller's clock — the destructive grace comparison needs one. */
    readonly now: Date;
    readonly killSwitchActive: boolean;
    readonly installationGrants: readonly PermissionGrant[];
    /** Ordering evidence per item; `"unknown"` is a safe conflict (manual-edits.md §2). */
    readonly latestHumanChangeAt: (item: ItemRef) => Date | null | "unknown";
    /** Resolver answers, when the shell has them. Absent means unavailable. */
    readonly resolve?: <Q extends ResolverName>(
        query: Q,
        input: ResolverInput<Q>,
    ) => Promise<ResolverAnswer<ResolverOutput<Q>>>;
}

export type DecideInput =
    | {
          readonly kind: "delivery";
          /** The shell's routing knowledge — a report must name its repository even when the payload is unreadable. */
          readonly repository: RepositoryRef;
          readonly event: string;
          readonly payload: unknown;
      }
    | { readonly kind: "observation"; readonly observation: EngineObservation };

export interface Decision {
    readonly report: Report;
    /** Intents that passed every gate in `active` mode — what an executor may plan. */
    readonly approved: readonly AnyIntent[];
}

/**
 * The engine's platform handle: refuses undeclared resolvers WITHOUT
 * throwing (the engine is total), recording the violation for the report
 * instead — an undeclared resolver call is a capability defect, and a
 * defect deserves a problem finding, not a crash in the shell.
 */
class EngineHandle {
    readonly explanations: StructuredExplanation[] = [];
    readonly violations: string[] = [];

    constructor(
        private readonly declaration: TypedDeclaration,
        private readonly externals: DecideExternals,
    ) {}

    async resolve(query: ResolverName, input: unknown): Promise<ResolverAnswer<unknown>> {
        if (!this.declaration.resolvers.includes(query)) {
            this.violations.push(query);
            return {
                ok: false,
                reason: "notConfigured",
                detail: `"${this.declaration.name}" did not declare resolver "${query}"`,
            };
        }
        if (this.externals.resolve === undefined) {
            return { ok: false, reason: "unavailable", detail: "no resolver source supplied" };
        }
        return this.externals.resolve(query, input as never);
    }

    explain(explanation: StructuredExplanation): void {
        this.explanations.push(explanation);
    }
}

/**
 * safety.md §2.6 wants "the exact item and value the adapter may change".
 * Moved here from the planner (D92 3c) — the exhaustive switch means a new
 * catalogue operation fails to compile until someone states what it changes.
 */
export function describeChange(intent: AnyIntent): string {
    switch (intent.operation) {
        case "postManagedComment":
            return `managed comment ${intent.desired.marker}`;
        case "applyMappedLabel":
            // "set", not "add": the adapter swaps the previous position
            // label as part of realising this (D4, D80).
            return `set mapped position ${intent.desired.meaning}`;
        case "unassign":
            return `unassign ${intent.desired.login}`;
    }
}

/** What the delivery showed about the item — `null` for unprojected sweeps. */
type EngineProjection = ObservationProjection<MappableMeaning> | null;

const projectionOf = (observation: EngineObservation): EngineProjection =>
    observation.kind === "staleItemsDue" ? null : observation.position;

/**
 * One intent through every gate — screen, derived world, verdict —
 * returning its findings and, if it may act, the intent itself.
 */
function gateIntent(
    intent: AnyIntent,
    declaration: TypedDeclaration,
    projection: EngineProjection,
    config: RepositoryConfig,
    externals: DecideExternals,
): { readonly findings: readonly Finding[]; readonly approved: AnyIntent | null } {
    const subject = {
        kind: "item",
        capability: declaration.name,
        item: intent.item,
    } as const;
    const screen = screenIntent(intent, declaration);
    if (!screen.ok) {
        return { findings: [screenFinding(screen, subject)], approved: null };
    }

    const request = {
        capability: declaration.name,
        actionClass: intent.actionClass,
        // From the catalogue — the platform owns what an operation needs
        // (D62); the declaration's copy is the restatement, not the authority.
        requiredPermissions: [INTENT_OPERATIONS[intent.operation].permission],
        cause: intent.cause.cause,
        causeObservedAt: intent.cause.observedAt,
        target: {
            item: `${intent.repository.owner}/${intent.repository.repo}#${String(intent.item.number)}`,
            change: describeChange(intent),
        },
    };
    const context = {
        killSwitchActive: externals.killSwitchActive,
        installationGrants: externals.installationGrants,
        latestHumanChangeAt: externals.latestHumanChangeAt(intent.item),
        world: deriveWorld(projection, intent.expected),
    };
    const verdict = destructiveOrWrite(intent, request, config, context, externals.now);

    const findings: Finding[] = [];
    // Acting intents tell their story; refusals keep their reasons alone (D92 3d).
    if (verdict.outcome !== "refuse") {
        findings.push(explanationFinding(intent.explanation, subject));
    }
    findings.push(
        verdictFinding(verdict, {
            kind: "effect",
            capability: declaration.name,
            item: intent.item,
            operation: intent.operation,
        }),
    );
    return { findings, approved: verdict.outcome === "apply" ? intent : null };
}

/**
 * Destructive intents take the destructive gate; the warning rebuilds from
 * the STORED warned cause, never the current request (D60, D72).
 */
function destructiveOrWrite(
    intent: AnyIntent,
    request: WriteRequest,
    config: RepositoryConfig,
    context: WriteContext,
    now: Date,
) {
    if (intent.actionClass !== "clockTriggeredDestructive" || intent.destructive === undefined) {
        return evaluateWrite(request, config, context);
    }
    return evaluateDestructive(
        {
            request,
            warning: createDestructiveWarning({
                request: {
                    ...request,
                    cause: intent.destructive.warnedCause,
                    causeObservedAt: intent.destructive.warnedCauseObservedAt,
                },
                warnedAt: intent.destructive.warnedAt,
                gracePeriodDays: intent.destructive.gracePeriodDays,
                earliestActionAt: intent.destructive.earliestActionAt,
                cancelledBy: intent.destructive.cancelledBy,
                reversesWith: intent.destructive.reversesWith,
            }),
            qualifyingActivitySinceWarning: intent.destructive.qualifyingActivitySinceWarning,
        },
        config,
        context,
        now,
    );
}

export async function decide(
    input: DecideInput,
    config: RepositoryConfig,
    capabilities: readonly EngineCapability[],
    externals: DecideExternals,
): Promise<Decision> {
    const findings: Finding[] = [];
    const approved: AnyIntent[] = [];
    let repository: RepositoryRef;
    let observation: EngineObservation | null = null;

    if (input.kind === "delivery") {
        repository = input.repository;
        const normalized = normalizeDelivery(input.event, input.payload, config);
        if (normalized.kind === "ignored") {
            findings.push(
                finding(
                    "info",
                    "deliveryIgnored",
                    `event "${normalized.event}" carries no observation`,
                    { kind: "repository" },
                ),
            );
        } else if (normalized.kind === "malformed") {
            findings.push(
                finding("problem", normalized.code, normalized.detail, {
                    kind: "repository",
                }),
            );
        } else {
            observation = normalized.observation;
            repository = observation.repository;
        }
    } else {
        observation = input.observation;
        repository = observation.repository;
    }

    if (observation !== null) {
        const projection = projectionOf(observation);

        for (const capability of capabilities) {
            const declaration = capability.declaration;
            if (config.capabilities[declaration.name]?.enabled !== true) continue;
            if (!declaration.observations.includes(observation.kind)) continue;

            const handle = new EngineHandle(declaration, externals);
            const view = projectCapabilityView(declaration, config);
            // The `never`s are `toEngine`'s erasure showing through: its
            // doc comment owns the soundness argument, once, for all three.
            const intents = await capability.evaluate(
                observation as never,
                view as never,
                handle as never,
            );

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

            for (const intent of intents) {
                const gated = gateIntent(intent, declaration, projection, config, externals);
                findings.push(...gated.findings);
                if (gated.approved !== null) approved.push(gated.approved);
            }
        }
    }

    return {
        report: { revision: config.revision, mode: config.mode, repository, findings },
        approved,
    };
}
