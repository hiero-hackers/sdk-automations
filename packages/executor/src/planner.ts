/**
 * The planner: APPROVED intents in, executable effect plans out.
 *
 * D92 3(c) cut this file roughly in half. It used to run the screens, the
 * safety engine, and the destructive gate itself — a fifth hand-wiring of
 * the decision pipeline, with its own copy of the context facts. Those are
 * decisions, and `decide()` in core owns them now; what arrives here has
 * already been decided. What remains is everything that is genuinely
 * TRANSLATION: turning an outcome into adapter commands, and the checks
 * only the translation layer can see —
 *
 * - `duplicateIdempotencyKey`: two intents sharing a key are ONE effect to
 *   the store, so the second would be read as already-done and silently
 *   dropped. Only visible where a whole batch is.
 * - `mixedRepositoryBatch`: a batch is scoped to one repository; a stray
 *   intent is refused rather than routed.
 * - `mappedLabelMissing`: an unmapped meaning has no adapter-command
 *   representation, so no plan can exist for it.
 *
 * Still pure — no store, no port, no clock. The clock left with the
 * destructive gate.
 */

import {
    finding,
    idempotencyOf,
    MAPPABLE_MEANINGS,
    type AnyIntent,
    type Finding,
    type RepositoryConfig,
    type RepositoryRef,
} from "@hiero-hackers/automation-core";
import type { AdapterCommand, ConfiguredLabel, EffectPlan, PlannedCall } from "./recovery.js";

export const PLANNER_REFUSAL_CODES = [
    "duplicateIdempotencyKey",
    "mappedLabelMissing",
    "mixedRepositoryBatch",
] as const;

export type PlannerRefusalCode = (typeof PLANNER_REFUSAL_CODES)[number];

export interface PlannerRefusal {
    readonly intent: AnyIntent;
    readonly code: PlannerRefusalCode;
    readonly reason: string;
}

export interface PlanningResult {
    /** One plan per planned intent, for handing to `RecoveryExecutor`. */
    readonly plans: readonly EffectPlan[];
    /** Nothing is dropped silently: every unplanned intent is here, with why. */
    readonly refusals: readonly PlannerRefusal[];
}

export interface PlanningInputs {
    /** The one repository this planning batch belongs to. */
    readonly repository: RepositoryRef;
    /** The reviewed configuration — revision stamp and label mapping. */
    readonly config: RepositoryConfig;
}

function configuredLabels(config: RepositoryConfig): readonly ConfiguredLabel[] {
    return MAPPABLE_MEANINGS.flatMap((meaning) => {
        const label = config.mappings.labels[meaning];
        return label === undefined ? [] : [{ meaning, label }];
    });
}

function commandFor(intent: AnyIntent, config: RepositoryConfig): AdapterCommand {
    const common = {
        repository: { ...intent.repository },
        item: { ...intent.item },
        configurationRevision: config.revision,
        expected: {
            meaningsPresent: [...intent.expected.meaningsPresent],
            meaningsAbsent: [...intent.expected.meaningsAbsent],
            closed: intent.expected.closed,
        },
        configuredLabels: configuredLabels(config),
    };

    switch (intent.operation) {
        case "postManagedComment":
            return {
                ...common,
                operation: intent.operation,
                desired: { ...intent.desired },
                readBack: { kind: "managedCommentMarker" },
            };
        case "applyMappedLabel": {
            const label = config.mappings.labels[intent.desired.meaning];
            if (label === undefined) {
                throw new TypeError(
                    `cannot translate unmapped meaning "${intent.desired.meaning}"`,
                );
            }
            return {
                ...common,
                operation: intent.operation,
                desired: { meaning: intent.desired.meaning, label },
                readBack: { kind: "mappedLabel" },
            };
        }
        case "unassign":
            return {
                ...common,
                operation: intent.operation,
                desired: { ...intent.desired },
                readBack: { kind: "assigneeAbsent" },
            };
    }
}

/**
 * contract.md §5 allows a multi-call plan; every catalogue operation is one
 * call today. FINDING(planner-per-call-idempotency) still stands: the first
 * multi-call operation must move the idempotency class from the intent
 * declaration onto the call, or plans will retry under the wrong rule. The
 * class comes from the catalogue via `idempotencyOf`, never a declaration.
 */
function callsFor(intent: AnyIntent, config: RepositoryConfig): readonly PlannedCall[] {
    return [
        {
            seq: 1,
            command: commandFor(intent, config),
            idempotencyClass: idempotencyOf(intent.operation),
        },
    ];
}

/**
 * Translate one batch of APPROVED intents from one repository's decision.
 *
 * **One intent, one plan** — unchanged from the original: a shared plan
 * would couple unrelated outcomes behind one claim, one revision guard, and
 * one imposed order. Grouping is recoverable later; ungrouping is not.
 */
export function planApproved(
    approved: readonly AnyIntent[],
    inputs: PlanningInputs,
): PlanningResult {
    const plans: EffectPlan[] = [];
    const refusals: PlannerRefusal[] = [];
    const keys = new Map<string, AnyIntent>();

    const mixed = approved.some(
        (intent) =>
            intent.repository.owner !== inputs.repository.owner ||
            intent.repository.repo !== inputs.repository.repo,
    );
    if (mixed) {
        const targets = [
            ...new Set(
                approved.map((intent) => `${intent.repository.owner}/${intent.repository.repo}`),
            ),
        ].join(", ");
        for (const intent of approved) {
            refusals.push({
                intent,
                code: "mixedRepositoryBatch",
                reason: `the batch is scoped to ${inputs.repository.owner}/${inputs.repository.repo}, but its intents target ${targets}; no intent was planned`,
            });
        }
        return { plans, refusals };
    }

    for (const intent of approved) {
        /**
         * FINDING(planner-key-collision): two intents sharing a key are one
         * effect to the store — the second would be read as already-done
         * and never performed. Only this layer sees the whole batch.
         */
        const clash = keys.get(intent.idempotencyKey);
        if (clash !== undefined) {
            refusals.push({
                intent,
                code: "duplicateIdempotencyKey",
                reason: `shares an idempotency key with the earlier "${clash.operation}" intent — the store would treat them as one effect`,
            });
            continue;
        }
        keys.set(intent.idempotencyKey, intent);

        if (
            intent.operation === "applyMappedLabel" &&
            inputs.config.mappings.labels[intent.desired.meaning] === undefined
        ) {
            refusals.push({
                intent,
                code: "mappedLabelMissing",
                reason: `meaning "${intent.desired.meaning}" has no configured label, so no adapter command can represent its desired state`,
            });
            continue;
        }

        plans.push({
            effectId: intent.idempotencyKey,
            revision: inputs.config.revision,
            calls: callsFor(intent, inputs.config),
        });
    }

    return { plans, refusals };
}

/**
 * Planner refusals as findings, for appending to the decision's report.
 * All three codes are problems: each is a defect (a key collision, a
 * mis-scoped batch) or a configuration gap (an unmapped meaning) that a
 * human must resolve — nothing here is the system working as intended.
 */
export function plannerFindings(refusals: readonly PlannerRefusal[]): readonly Finding[] {
    return refusals.map((refusal) =>
        finding(
            "problem",
            refusal.code,
            refusal.reason,
            refusal.code === "mixedRepositoryBatch"
                ? { kind: "repository" }
                : {
                      kind: "effect",
                      capability: refusal.intent.capability,
                      item: refusal.intent.item,
                      operation: refusal.intent.operation,
                  },
        ),
    );
}
