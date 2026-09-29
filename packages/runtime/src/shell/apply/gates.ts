/**
 * May this write still happen, asked at apply time rather than at decision time.
 * The ladders are core's; this file decides WHICH one a pass meets and reads the
 * live facts it needs. Nothing here sends anything.
 */

import {
    createDestructiveWarning,
    deriveWorld,
    evaluateDestructive,
    evaluateStandingRules,
    evaluateWrite,
    INTENT_OPERATIONS,
    writeRequestFor,
    meaningsOfLabels,
    projectIssue,
    projectPullRequest,
    type ActionClass,
    type AnyIntent,
    type DestructiveWarning,
    type Externals,
    type HumanChangeOrdering,
    type IntentOperation,
    type ItemFacts,
    type ItemRef,
    type MappableMeaning,
    type ObservedModes,
    type Projection,
    type ReadBack,
    type ReadBackOutcome,
    type RepositoryConfig,
} from "@hiero-hackers/automation-core";
import type { Ledger } from "../../store/index.js";
import { detailOf } from "../log.js";
import type { EffectOutcomeCode } from "../effects.js";
import type { Pass, PassResult } from "./actions.js";
import { traitsOf } from "./operations/index.js";

/**
 * A FRESH externals set, built per apply pass.
 * Never the delivery's own: its memo would answer the apply-time gate with the instant the DECISION read, which is the one thing a re-gate must not believe.
 */
export type EffectExternalsSource = (payload?: unknown) => Externals | Promise<Externals>;

/** A gate passed, or the result its refusal produces. */
export type GateVerdict =
    { readonly ok: true } | { readonly ok: false; readonly result: PassResult };

const refuse = (code: EffectOutcomeCode, detail: string): GateVerdict => ({
    ok: false,
    result: { outcome: "refused", code, detail },
});

/**
 * The live item as a projection.
 * A merged pull request is `merged` and everything else closed is `closedByHuman`; every closure refuses the write by the same rule, so the choice cannot change a verdict.
 */
function projectionFrom(
    seen: ItemFacts,
    kind: ItemRef["kind"],
    config: RepositoryConfig,
): Projection<MappableMeaning> {
    const observation = {
        closedBy: seen.closed
            ? seen.merged
                ? ("merged" as const)
                : ("closedByHuman" as const)
            : null,
        meanings: meaningsOfLabels(config, seen.labels),
    };
    return kind === "issue" ? projectIssue(observation) : projectPullRequest(observation);
}

/**
 * The recorded-warning seam, over the effect ledger (grace.md §2).
 * Nothing here validates; the destructive gate matches the snapshot to the request.
 */
export function recordedWarningsIn(
    ledger: Ledger,
): (effectId: string) => DestructiveWarning | null {
    return (effectId) => {
        const row = ledger.warningFor(effectId);
        if (row === null) return null;
        return createDestructiveWarning({
            request: {
                capability: row.capability,
                actionClass: row.actionClass as ActionClass,
                requiredPermissions: [],
                cause: row.cause,
                causeObservedAt: new Date(row.causeObservedAt),
                target: { item: row.item, change: row.change },
            },
            warnedAt: new Date(row.warnedAt),
            gracePeriodHours: row.gracePeriodHours,
            earliestActionAt: new Date(row.earliestActionAt),
            cancelledBy: row.cancelledBy,
            reversesWith: row.reversesWith,
        });
    };
}

export interface GateOptions {
    /** The facts a recorded warning is read from (D164). */
    readonly ledger: Ledger;
    readonly reader: ReadBack;
    readonly externals: EffectExternalsSource;
    readonly clock: () => Date;
}

/** The two gates a pass can meet. */
export interface Gates {
    /** The whole ladder, against a live read of the item. */
    fresh(pass: Pass, intent: AnyIntent): Promise<GateVerdict>;
    /** The item-independent subset, which is the whole gate a resume passes. */
    resume(pass: Pass, operation: IntentOperation): Promise<GateVerdict>;
}

export function createGates(options: GateOptions): Gates {
    const { ledger, reader, externals, clock } = options;

    /**
     * The recorded warning, read from the SAME ledger the applier appends to.
     * Not through `externals`: a warning is the platform's own record, so the credential-free path can still gate its own destructive acts (grace.md §2).
     */
    const warningFor = recordedWarningsIn(ledger);

    /**
     * Did the affected person act after they were warned?
     * The instant is the DECISION's reading; this narrows rather than carries the claim.
     */
    const activityCancels = (intent: AnyIntent, live: Date | null): boolean => {
        const decided = intent.grace?.activityAt ?? null;
        const at =
            decided === null || (live !== null && live.getTime() > decided.getTime())
                ? live
                : decided;
        const warning = warningFor(intent.idempotencyKey);
        return at !== null && warning !== null && at.getTime() > warning.warnedAtMs;
    };

    /** The externals for this pass, with the seam CONTAINED. */
    const freshExternals = async (payload: unknown): Promise<ReadBackOutcome<Externals>> => {
        try {
            return { ok: true, value: await externals(payload) };
        } catch (error) {
            return { ok: false, detail: detailOf(error) };
        }
    };

    /**
     * Contained the way `decide()` contains it: a lookup that threw established nothing,
     * and D51 rules an unestablished ordering a conflict, which the rules already refuse.
     */
    const orderingFor = async (facts: Externals, item: ItemRef): Promise<HumanChangeOrdering> => {
        try {
            return await facts.latestHumanChangeAt(item);
        } catch {
            return "unknown";
        }
    };

    /**
     * The standing gate an operator can still close between deciding and applying, run by core
     * (`evaluateStandingRules`) and not copied. The shell decides WHICH rules to run. This item-independent subset is the whole gate a RESUME passes: add-then-remove leaves two position labels, so the full ladder could only answer `preconditionStale`.
     */
    const standingGate = (
        pass: Pass,
        operation: IntentOperation,
        facts: Externals,
    ): GateVerdict => {
        const operationFacts = INTENT_OPERATIONS[operation];
        const verdict = evaluateStandingRules(
            {
                capability: pass.capability,
                actionClass: operationFacts.actionClassFloor,
                requiredPermissions: [operationFacts.permission],
            },
            pass.config,
            {
                killSwitchActive: facts.killSwitchActive,
                installationGrants: facts.installationGrants,
            },
        );
        return verdict.outcome === "apply" ? { ok: true } : refuse(verdict.code, verdict.reason);
    };

    /**
     * The live answer to the mode this intent claimed, and to no other.
     * `draft` rides on the item read already made; the reviews list is a second call, spent only where a claim turns on it.
     */
    const modesClaimed = async (
        intent: AnyIntent,
        seen: ItemFacts,
    ): Promise<ReadBackOutcome<ObservedModes>> => {
        const claimed = intent.claims.pullRequestMode;
        if (claimed === undefined) return { ok: true, value: {} };
        if (claimed === "draft") return { ok: true, value: { draft: seen.draft } };
        const read = await reader.changesRequested(intent.item);
        return read.ok ? { ok: true, value: { changesRequested: read.value } } : read;
    };

    return {
        /**
         * The whole ladder again, against a LIVE read of the item.
         * This is what makes an approval a permission to act NOW rather than one banked at decision time. A mode that moved refuses under `preconditionStale`, as a meaning does.
         */
        async fresh(pass, intent) {
            const seen = await reader.item(intent.item);
            if (!seen.ok) {
                return {
                    ok: false,
                    result: {
                        outcome: "retryLater",
                        code: "itemUnreadable",
                        detail: `the item could not be read at apply time: ${seen.detail}`,
                    },
                };
            }
            const modes = await modesClaimed(intent, seen.value);
            if (!modes.ok) {
                return {
                    ok: false,
                    result: {
                        outcome: "retryLater",
                        code: "itemUnreadable",
                        detail: `the pull request's mode could not be read at apply time: ${modes.detail}`,
                    },
                };
            }
            const facts = await freshExternals(pass.payload);
            if (!facts.ok) {
                return {
                    ok: false,
                    result: {
                        outcome: "retryLater",
                        code: "externalsUnavailable",
                        detail: `the apply-time externals could not be built: ${facts.detail}`,
                    },
                };
            }
            const request = writeRequestFor(intent);
            const activity =
                intent.grace !== null && traitsOf(intent.operation).activityRead
                    ? await reader.pullRequestActivity(
                          intent.item,
                          pass.config.mappings.commands.working,
                      )
                    : { ok: true as const, value: null };
            if (!activity.ok) {
                return {
                    ok: false,
                    result: {
                        outcome: "retryLater",
                        code: "itemUnreadable",
                        detail: `the pull request's activity could not be read at apply time: ${activity.detail}`,
                    },
                };
            }
            const context = {
                killSwitchActive: facts.value.killSwitchActive,
                installationGrants: facts.value.installationGrants,
                latestHumanChangeAt: await orderingFor(facts.value, intent.item),
                world: deriveWorld(
                    projectionFrom(seen.value, intent.item.kind, pass.config),
                    intent.claims,
                    modes.value,
                ),
            };
            // The same two gates the decision used (grace.md §2): the record is re-read
            // here, so a pruned warning or a re-warned repository changes the answer.

            const verdict =
                intent.grace === null
                    ? evaluateWrite(request, pass.config, context)
                    : evaluateDestructive(
                          {
                              request,
                              warning: warningFor(intent.idempotencyKey),
                              qualifyingActivitySinceWarning: activityCancels(
                                  intent,
                                  activity.value,
                              ),
                          },
                          pass.config,
                          context,
                          clock(),
                      );
            return verdict.outcome === "apply"
                ? { ok: true }
                : refuse(verdict.code, verdict.reason);
        },

        /** The standing gate, over externals read fresh for this pass. */
        async resume(pass, operation) {
            const facts = await freshExternals(pass.payload);
            return facts.ok
                ? standingGate(pass, operation, facts.value)
                : {
                      ok: false,
                      result: {
                          outcome: "retryLater",
                          code: "externalsUnavailable",
                          detail: `the apply-time externals could not be built: ${facts.detail}`,
                      },
                  };
        },
    };
}
