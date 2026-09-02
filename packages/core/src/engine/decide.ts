/**
 * decide() — the one verb (D92). A delivery or observation goes in; a
 * report and the approved intents come out; nothing else escapes.
 *
 * This file OWNS the composition: normalize → evaluate → screen → derive
 * the world → gate → report. `events.ts` is the first of those steps and
 * `invoke.ts` holds the erased capability shape this walks over.
 *
 * Externals are only the facts core cannot know — clock, kill switch,
 * grants, human ordering, resolver answers — as data and lookups, never
 * I/O. Everything derivable is derived, so a caller cannot assert a world
 * that contradicts the one it delivered.
 */

import {
    INTENT_OPERATIONS,
    managedCommentOf,
    projectCapabilityView,
    screenIntent,
    type AnyIntent,
    type CapabilityView,
    type ItemRef,
    type ManagedComment,
    type ObservationCatalogue,
    type RepositoryRef,
    type TypedDeclaration,
} from "../capability/index.js";
import type { PermissionGrant } from "../github/index.js";
import {
    EngineHandle,
    thrownDetail,
    type EngineCapability,
    type ResolverSource,
} from "./invoke.js";
import { normalizeDelivery } from "./events.js";
import type { MappableMeaning, RepositoryConfig } from "../config/index.js";
import type { ObservationProjection } from "../workflow/index.js";
import {
    deriveWorld,
    evaluateWrite,
    type HumanChangeOrdering,
    type WriteRequest,
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

// ─── What goes in, what comes out ────────────────────────────────────

/** Any observation in the catalogue — what the engine evaluates against. */
export type EngineObservation = ObservationCatalogue[keyof ObservationCatalogue];

/** The facts core cannot derive, supplied as data and lookups rather than I/O. */
export interface DecideExternals {
    readonly killSwitchActive: boolean;
    readonly installationGrants: readonly PermissionGrant[];
    /**
     * Ordering evidence per item; `"unknown"` is a safe conflict
     * (manual-edits.md §2). The engine awaits either shape, so a synchronous
     * stub and a timeline-reading live implementation satisfy the same seam —
     * a lookup that returns a promise is still a lookup, not I/O in core.
     */
    readonly latestHumanChangeAt: (
        item: ItemRef,
    ) => HumanChangeOrdering | Promise<HumanChangeOrdering>;
    /** Resolver answers, when the shell has them. Absent means unavailable. */
    readonly resolve?: ResolverSource;
}

/**
 * One thing to decide about: a raw delivery, or an observation the caller
 * already holds. The raw branch carries the shell's routing knowledge
 * separately, because a report must name its repository even when the
 * payload turns out to be unreadable.
 */
export type DecideInput =
    | {
          readonly kind: "delivery";
          readonly repository: RepositoryRef;
          readonly event: string;
          readonly payload: unknown;
      }
    | { readonly kind: "observation"; readonly observation: EngineObservation };

/**
 * An intent that may act, carrying the identity only the platform can mint.
 *
 * `managedComment` is `null` for every operation that posts none. Identity
 * attaches HERE rather than in the factory (D125): an effect's identity is the
 * name under which a write will be found again, and an intent that will never
 * be written has none to name. The factory would also be handing it back to the
 * capability that must not own it, which is the arrangement D125 removed.
 */
export interface ApprovedEffect {
    readonly intent: AnyIntent;
    readonly managedComment: ManagedComment | null;
}

/** What one decision produced: the record and any active-mode effects. */
export interface Decision {
    readonly report: Report;
    /** Effects that passed every gate in `active` mode. */
    readonly approved: readonly ApprovedEffect[];
}

// ─── The gates one intent passes ─────────────────────────────────────

/**
 * contracts/safety.md requires the exact item and value an adapter may change.
 * The exhaustive switch means a new catalogue operation fails to compile
 * until someone states what it changes.
 */
export function describeChange(intent: AnyIntent): string {
    switch (intent.operation) {
        case "postManagedComment":
            // Capability and purpose, never the marker: the marker is derived
            // identity, and a safety record naming it would read as a value
            // someone chose rather than the change being made (D125).
            return `managed ${intent.desired.kind} comment from ${intent.capability}`;
        case "applyMappedLabel":
            // "set", not "add": the adapter swaps the previous position
            // label as part of realising this (D4, D80).
            return `set mapped position ${intent.desired.meaning}`;
        case "unassign":
            return `unassign ${intent.desired.login}`;
    }
}

/**
 * The one recipe for the safety request an intent is judged by — used here
 * at decision time and by the shell's applier at apply time, so a re-gate
 * can never judge a differently-shaped request than the decision did. The
 * capability comes from the intent; the screen has already proved it names
 * its declaration. Core's slice parity test pins this builder as the
 * specification.
 */
export function writeRequestFor(intent: AnyIntent): WriteRequest {
    const facts = INTENT_OPERATIONS[intent.operation];
    return {
        capability: intent.capability,
        actionClass: facts.actionClassFloor,
        requiredPermissions: [facts.permission],
        cause: intent.cause.cause,
        causeObservedAt: intent.cause.observedAt,
        target: {
            item: `${intent.repository.owner}/${intent.repository.repo}#${String(intent.item.number)}`,
            change: describeChange(intent),
        },
    };
}

/** What the delivery showed about the item — `null` for unprojected sweeps. */
type EngineProjection = ObservationProjection<MappableMeaning> | null;

const projectionOf = (observation: EngineObservation): EngineProjection =>
    observation.kind === "staleItemsDue" ? null : observation.position;

/**
 * The ordering evidence for one item, with the lookup CONTAINED.
 *
 * A seam that threw established nothing, and D51 rules an unestablished
 * ordering a conflict — so the contained value is `"unknown"`, which the rules
 * already refuse fail-closed. The detail rides alongside because "checked and
 * could not tell" and "the lookup broke" need different fixes.
 */
async function orderingFor(
    item: ItemRef,
    externals: DecideExternals,
): Promise<{ readonly value: HumanChangeOrdering; readonly defect: string | null }> {
    try {
        return { value: await externals.latestHumanChangeAt(item), defect: null };
    } catch (thrown) {
        return { value: "unknown", defect: thrownDetail(thrown) };
    }
}

/**
 * What dry-run would have done, said once per intent that got that far.
 *
 * This is the whole difference between the two record-only modes. `observe`
 * reports that a repository in a recording mode recorded; `dry-run` also names
 * the change, so the ladder's middle rung is a rehearsal an operator can read
 * before promoting the repository to `active` (safety rule 10's rollout half).
 *
 * It DESCRIBES rather than prepares. No managed identity is minted here and
 * none is minted anywhere else in this mode: a marker is the name a landed
 * write is found again under, and a write that will not happen has nothing to
 * find (D125). The change is spelled in `describeChange`'s words, so the
 * rehearsal and the active-mode safety record name the same change identically.
 */
function wouldApplyFinding(intent: AnyIntent, subject: Subject): Finding {
    return finding(
        "info",
        "wouldApply",
        `dry-run: ${intent.capability} would ${intent.operation} on ` +
            `${intent.repository.owner}/${intent.repository.repo}#${String(intent.item.number)} — ` +
            `${describeChange(intent)}. Nothing was written.`,
        subject,
    );
}

/**
 * The managed-comment identity for an intent that has one, minted from the
 * intent's OWN fields — the capability it is attributed to, the purpose it
 * asked for, and the idempotency key the screen has already re-derived.
 */
function managedCommentFor(intent: AnyIntent): ManagedComment | null {
    return intent.operation === "postManagedComment"
        ? managedCommentOf({
              capability: intent.capability,
              kind: intent.desired.kind,
              effectId: intent.idempotencyKey,
          })
        : null;
}

/**
 * One intent through every gate — screen, derived world, verdict —
 * returning its findings and, if it may act, the effect itself. Async for
 * exactly one fact: the ordering evidence, awaited after the screen so a
 * screened-out intent costs no lookup.
 */
async function gateIntent(
    intent: AnyIntent,
    declaration: TypedDeclaration,
    projection: EngineProjection,
    config: RepositoryConfig,
    externals: DecideExternals,
): Promise<{ readonly findings: readonly Finding[]; readonly approved: ApprovedEffect | null }> {
    const subject = {
        kind: "item",
        capability: declaration.name,
        item: intent.item,
    } as const;
    const screen = screenIntent(intent, declaration, projection);
    if (!screen.ok) {
        return { findings: [screenFinding(screen, subject)], approved: null };
    }

    const request = writeRequestFor(intent);
    const ordering = await orderingFor(intent.item, externals);
    const context = {
        killSwitchActive: externals.killSwitchActive,
        installationGrants: externals.installationGrants,
        latestHumanChangeAt: ordering.value,
        world: deriveWorld(projection, intent.expected),
    };
    const verdict = evaluateWrite(request, config, context);

    const findings: Finding[] = [];
    if (ordering.defect !== null) {
        findings.push(
            finding(
                "problem",
                "humanOrderingLookupFailed",
                `the human-change ordering lookup threw: ${ordering.defect}`,
                subject,
            ),
        );
    }
    // Acting intents tell their story; refusals keep their reasons alone (D92 3d).
    if (verdict.outcome !== "refuse") {
        findings.push(explanationFinding(intent.explanation, subject));
    }
    const effectSubject = {
        kind: "effect",
        capability: declaration.name,
        item: intent.item,
        operation: intent.operation,
    } as const;
    findings.push(verdictFinding(verdict, effectSubject));
    // After the verdict, because it elaborates on it: the verdict says the
    // mode recorded rather than applied, and this says what it recorded.
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
                ? { intent, managedComment: managedCommentFor(intent) }
                : null,
    };
}

/**
 * One capability's intents, with the CALL contained.
 *
 * A capability is ordinary code and may throw. The engine is total, so a
 * throw becomes a recorded defect and that capability simply contributes
 * nothing — the same bargain `EngineHandle` already makes for an undeclared
 * resolver. Whatever the capability explained before it broke is kept: the
 * handle holds it, and it is the only account of what it was doing.
 */
async function intentsFrom(
    capability: EngineCapability,
    observation: EngineObservation,
    view: CapabilityView<TypedDeclaration>,
    handle: EngineHandle,
): Promise<{ readonly intents: readonly AnyIntent[]; readonly defect: string | null }> {
    try {
        // The `never`s are `toEngine`'s erasure showing through; its
        // docstring owns the soundness argument, once, for all three.
        const intents = await capability.evaluate(
            observation as never,
            view as never,
            handle as never,
        );
        return { intents, defect: null };
    } catch (thrown) {
        return { intents: [], defect: thrownDetail(thrown) };
    }
}

// ─── The verb ────────────────────────────────────────────────────────

/**
 * The front door: a delivery becomes a report, plus the intents that may act.
 *
 * Total: every fallible seam is contained, so a report always comes back. An
 * unreadable payload, a capability that asks for an undeclared resolver or
 * throws, a resolver source or ordering lookup that rejects, and a refused
 * write are all findings. A shell that cannot get a report back cannot record
 * one, and in a reclaiming shell that loses the delivery for good.
 */
export async function decide(
    input: DecideInput,
    config: RepositoryConfig,
    capabilities: readonly EngineCapability[],
    externals: DecideExternals,
): Promise<Decision> {
    const findings: Finding[] = [];
    const approved: ApprovedEffect[] = [];
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

            const handle = new EngineHandle(declaration, externals.resolve);
            const view = projectCapabilityView(declaration, config);
            const evaluated = await intentsFrom(capability, observation, view, handle);

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
                        `the resolver source threw answering "${declaration.name}" — ${failure}`,
                        { kind: "capability", capability: declaration.name },
                    ),
                );
            }
            if (evaluated.defect !== null) {
                findings.push(
                    finding(
                        "problem",
                        "capabilityFailed",
                        `"${declaration.name}" threw during evaluation: ${evaluated.defect}`,
                        { kind: "capability", capability: declaration.name },
                    ),
                );
            }

            for (const intent of evaluated.intents) {
                const gated = await gateIntent(intent, declaration, projection, config, externals);
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
