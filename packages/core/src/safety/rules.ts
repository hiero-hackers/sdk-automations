/**
 * The general rules every write passes, and the preflight before them —
 * `design/contracts/safety.md`'s mechanically checkable subset only.
 */

import { effectiveMode, type EffectiveMode, type RepositoryConfig } from "../config/index.js";
import { missingPermissions } from "../github/index.js";
import { isBlocked } from "../workflow/index.js";
import type {
    RecordOnlyCode,
    SafetyRefusalCode,
    SafetyVerdict,
    StandingContext,
    StandingRequest,
    WriteContext,
    WriteRequest,
} from "./types.js";

const KILL_SWITCH: SafetyVerdict = {
    outcome: "refuse",
    code: "killSwitch",
    reason: "a kill switch is active",
};

export const secondOf = (date: Date): number => Math.floor(date.getTime() / 1000);

/** Kill switch and authoritative precondition run before either write gate. */
export function evaluatePreflight(context: WriteContext): SafetyVerdict | null {
    // Ahead of the observation short-circuit: the gate refuses those too (D117).
    if (context.killSwitchActive) return KILL_SWITCH;
    if (!context.world.preconditionHolds) {
        return {
            outcome: "refuse",
            code: "preconditionStale",
            reason: "the authoritative precondition is unavailable, conflicted, or no longer holds (rule 4)",
        };
    }
    return null;
}

/** What a rule may look at when it knows nothing about the item. */
interface StandingFacts {
    readonly config: RepositoryConfig;
    /** The requesting capability's mode, never the file's alone (config-schema.md §4). */
    readonly mode: EffectiveMode;
    readonly actionClass: StandingRequest["actionClass"];
    readonly capabilityEnabled: boolean;
    readonly missing: readonly string[];
}

/** Everything a rule may look at, derived once so no rule recomputes it. */
interface Facts extends StandingFacts {
    readonly request: WriteRequest;
    readonly context: WriteContext;
}

type StandingRule = (f: StandingFacts) => SafetyVerdict | null;
type Rule = (f: Facts) => SafetyVerdict | null;

/**
 * Which facts one rule needs. `standing` rules read only configuration and the
 * installation; `itemState` rules can only be judged against a live read.
 */
export type RuleScope = "standing" | "itemState";

type GeneralRule =
    | readonly [name: string, rule: StandingRule, scope: "standing"]
    | readonly [name: string, rule: Rule, scope: "itemState"];

const standing = (name: string, rule: StandingRule): GeneralRule => [name, rule, "standing"];
const itemState = (name: string, rule: Rule): GeneralRule => [name, rule, "itemState"];

const refuse = (code: SafetyRefusalCode, reason: string): SafetyVerdict => ({
    outcome: "refuse",
    code,
    reason,
});
const record = (code: RecordOnlyCode, reason: string): SafetyVerdict => ({
    outcome: "record-only",
    code,
    reason,
});

/** The general rules, IN ORDER — order is contract, not style (D39, D52). */
export const GENERAL_RULES: readonly GeneralRule[] = [
    standing("observation", (f) =>
        f.actionClass === "observation"
            ? record("observation", "observation records a finding")
            : null,
    ),
    standing("capabilityDisabled", (f) =>
        f.capabilityEnabled
            ? null
            : refuse(
                  "capabilityDisabled",
                  "the repository did not enable this capability (rule 1)",
              ),
    ),
    standing("permissionMissing", (f) =>
        f.missing.length === 0
            ? null
            : refuse(
                  "permissionMissing",
                  `the installation lacks ${f.missing.join(", ")} (rule 2)`,
              ),
    ),
    // Reads the derived world, never `claims.closed`, which defaults to no claim (D47).
    itemState("itemClosed", (f) =>
        f.context.world.closure === null
            ? null
            : refuse(
                  "itemClosed",
                  `the item is closed (${f.context.world.closure}) — a closed item accepts no capability write`,
              ),
    ),
    itemState("itemBlocked", (f) =>
        isBlocked(f.context.world.observedMeanings)
            ? refuse("itemBlocked", "the item is blocked — capability writes are paused")
            : null,
    ),
    // Before the comparison: unestablished ordering is a conflict, not an absence.
    itemState("humanOrderingUnknown", (f) =>
        f.context.latestHumanChangeAt === "unknown"
            ? refuse(
                  "humanOrderingUnknown",
                  "ordering evidence for the newest human change is unavailable; the safe default is a conflict (contracts/safety.md §3)",
              )
            : null,
    ),
    itemState("invalidTimestamp", (f) =>
        !Number.isFinite(f.request.causeObservedAt.getTime()) ||
        (f.request.evaluatedAt !== undefined &&
            !Number.isFinite(f.request.evaluatedAt.getTime())) ||
        (f.context.latestHumanChangeAt !== null &&
            f.context.latestHumanChangeAt !== "unknown" &&
            !Number.isFinite(f.context.latestHumanChangeAt.getTime()))
            ? refuse(
                  "invalidTimestamp",
                  "the write request contains an invalid observation or human-change timestamp",
              )
            : null,
    ),
    // Ties go to the human — `>=`, not `>` (D33); GitHub dates changes in whole seconds (D221).
    itemState("newerHumanChange", (f) =>
        f.context.latestHumanChangeAt !== null &&
        f.context.latestHumanChangeAt !== "unknown" &&
        secondOf(f.context.latestHumanChangeAt) >=
            secondOf(f.request.evaluatedAt ?? f.request.causeObservedAt)
            ? refuse(
                  "newerHumanChange",
                  "a human change at or after the cause conflicts; human edits are authoritative (rule 5)",
              )
            : null,
    ),
    standing("modeDisabled", (f) =>
        f.mode.mode === "disabled"
            ? refuse("modeDisabled", "the repository mode is disabled")
            : null,
    ),
    standing("modeRecordsOnly", (f) =>
        f.mode.mode === "observe" || f.mode.mode === "dry-run"
            ? record(
                  "modeRecordsOnly",
                  `the capability's mode is ${f.mode.mode}, ${f.mode.source === "stated" ? "stated on its block" : "inherited from the file"}; the effect is recorded, not applied (rule 10)`,
              )
            : null,
    ),
];

function standingFacts(
    request: StandingRequest,
    config: RepositoryConfig,
    context: StandingContext,
): StandingFacts {
    return {
        config,
        mode: effectiveMode(config, request.capability),
        actionClass: request.actionClass,
        // Derived, never supplied: the reviewed file is the only source (D73).
        capabilityEnabled: config.capabilities[request.capability]?.enabled === true,
        missing: missingPermissions(request.requiredPermissions, context.installationGrants),
    };
}

/** The ordered rules, run in order — both gates arrive here after their own policy. */
export function evaluateGeneralRulesAfterPreflight(
    request: WriteRequest,
    config: RepositoryConfig,
    context: WriteContext,
): SafetyVerdict {
    const facts: Facts = { ...standingFacts(request, config, context), request, context };
    for (const [, rule] of GENERAL_RULES) {
        const verdict = rule(facts);
        if (verdict !== null) return verdict;
    }
    return { outcome: "apply" };
}

/**
 * The kill switch and every `standing` rule, in the same order — the standing
 * gate a caller holding no item can still consult.
 */
export function evaluateStandingRules(
    request: StandingRequest,
    config: RepositoryConfig,
    context: StandingContext,
): SafetyVerdict {
    if (context.killSwitchActive) return KILL_SWITCH;
    const facts = standingFacts(request, config, context);
    for (const entry of GENERAL_RULES) {
        if (entry[2] !== "standing") continue;
        const verdict = entry[1](facts);
        if (verdict !== null) return verdict;
    }
    return { outcome: "apply" };
}
