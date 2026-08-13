/**
 * The general rules every write passes, and the preflight before them.
 *
 * safety.md §2's mechanically checkable subset only. Rules 7–10 —
 * postcondition verification, unclear-outcome reconciliation, tested
 * rollback, dry-run-before-active rollout — cannot be decided from one
 * request and belong to a future write path and to process.
 *
 * Precedence is policy: kill switch → observation → consent → authority →
 * pause → staleness → human conflict → mode. Only the kill switch changes an
 * OUTCOME; the rest decide which `code` gets reported, and the tests freeze
 * that order.
 * **If you are asking "why was my write refused?", this is the file.**
 * Both doors — `write.ts` and `destructive.ts` — arrive here after their
 * own policy; only the rule ORDER is exported, because order is contract
 * (D39, D52).
 */

import type { RepositoryConfig } from "../config/index.js";
import { missingPermissions } from "../github/index.js";
import { isBlocked } from "../workflow/index.js";
import type {
    RecordOnlyCode,
    SafetyRefusalCode,
    SafetyVerdict,
    WriteContext,
    WriteRequest,
} from "./types.js";

/** The one check that runs before everything, including observations (D39). */
export function evaluatePreflight(context: WriteContext): SafetyVerdict | null {
    // Before the observation short-circuit: "stop" stops reads too (D39).
    if (context.killSwitchActive) {
        return {
            outcome: "refuse",
            code: "killSwitch",
            reason: "a kill switch is active",
        };
    }
    return null;
}

/**
 * Everything a rule may look at, derived once so no rule recomputes it.
 */
interface Facts {
    readonly request: WriteRequest;
    readonly config: RepositoryConfig;
    readonly context: WriteContext;
    readonly capabilityEnabled: boolean;
    readonly missing: readonly string[];
}

type Rule = (f: Facts) => SafetyVerdict | null;

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

/**
 * The general rules, IN ORDER — order is contract, not style (D39, D52).
 * Data rather than `if`s so precedence is asserted directly by the tests
 * instead of inferred from contrived multi-trigger inputs.
 */
export const GENERAL_RULES: readonly (readonly [string, Rule])[] = [
    [
        // Observations need no permission and are always recordable.
        "observation",
        (f) =>
            f.request.actionClass === "observation"
                ? record("observation", "observation records a finding")
                : null,
    ],
    [
        "capabilityDisabled",
        (f) =>
            f.capabilityEnabled
                ? null
                : refuse(
                      "capabilityDisabled",
                      "the repository did not enable this capability (rule 1)",
                  ),
    ],
    [
        "permissionMissing",
        (f) =>
            f.missing.length === 0
                ? null
                : refuse(
                      "permissionMissing",
                      `the installation lacks ${f.missing.join(", ")} (rule 2)`,
                  ),
    ],
    [
        "itemBlocked",
        (f) =>
            isBlocked(f.context.world.observedMeanings)
                ? refuse("itemBlocked", "the item is blocked — capability writes are paused (§5)")
                : null,
    ],
    [
        "preconditionStale",
        (f) =>
            f.context.world.preconditionHolds
                ? null
                : refuse(
                      "preconditionStale",
                      "the rechecked precondition no longer holds (rule 4)",
                  ),
    ],
    [
        // Unestablished ordering is a conflict, never an absence — checked
        // before the comparison, because there is nothing to compare against.
        "humanOrderingUnknown",
        (f) =>
            f.context.latestHumanChangeAt === "unknown"
                ? refuse(
                      "humanOrderingUnknown",
                      "ordering evidence for the newest human change is unavailable; the safe default is a conflict (manual-edits.md §2)",
                  )
                : null,
    ],
    [
        "invalidTimestamp",
        (f) =>
            !Number.isFinite(f.request.causeObservedAt.getTime()) ||
            (f.context.latestHumanChangeAt !== null &&
                f.context.latestHumanChangeAt !== "unknown" &&
                !Number.isFinite(f.context.latestHumanChangeAt.getTime()))
                ? refuse(
                      "invalidTimestamp",
                      "the write request contains an invalid observation or human-change timestamp",
                  )
                : null,
    ],
    [
        // Ties go to the human: GitHub timestamps have second granularity,
        // so exact ties happen (D33).
        "newerHumanChange",
        (f) =>
            f.context.latestHumanChangeAt !== null &&
            f.context.latestHumanChangeAt !== "unknown" &&
            f.context.latestHumanChangeAt.getTime() >= f.request.causeObservedAt.getTime()
                ? refuse(
                      "newerHumanChange",
                      "a human change at or after the cause conflicts; human edits are authoritative (rule 5)",
                  )
                : null,
    ],
    [
        "modeDisabled",
        (f) =>
            f.config.mode === "disabled"
                ? refuse("modeDisabled", "the repository mode is disabled")
                : null,
    ],
    [
        "modeRecordsOnly",
        (f) =>
            f.config.mode === "observe" || f.config.mode === "dry-run"
                ? record(
                      "modeRecordsOnly",
                      `repository mode is ${f.config.mode}; the effect is recorded, not applied (rule 10)`,
                  )
                : null,
    ],
];

/** The ordered rules, run in order. Both doors arrive here after their own policy. */
export function evaluateGeneralRulesAfterPreflight(
    request: WriteRequest,
    config: RepositoryConfig,
    context: WriteContext,
): SafetyVerdict {
    const facts: Facts = {
        request,
        config,
        context,
        // Derived, never supplied: the reviewed file is the only source (D73).
        capabilityEnabled: config.capabilities[request.capability]?.enabled === true,
        missing: missingPermissions(request.requiredPermissions, context.installationGrants),
    };
    for (const [, rule] of GENERAL_RULES) {
        const verdict = rule(facts);
        if (verdict !== null) return verdict;
    }
    return { outcome: "apply" };
}
