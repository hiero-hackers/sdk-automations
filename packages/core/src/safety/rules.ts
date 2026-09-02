/**
 * The general rules every write passes, and the preflight before them.
 *
 * `design/contracts/safety.md`'s mechanically checkable subset only. Rules
 * 6–10 — naming the exact value, postcondition verification, unclear-outcome
 * reconciliation, tested rollback, dry-run-before-active rollout — cannot be
 * decided from one request and are `design/guides/effects.md`'s.
 *
 * Precedence is policy: kill switch → authoritative precondition → observation
 * → consent → permissions → closure → pause → human conflict → mode. Only the
 * kill switch changes an OUTCOME; the rest decide which `code` gets reported,
 * and the tests freeze that order.
 * **If you are asking "why was my write refused?", this is the file.**
 * Both doors — `write.ts` and `destructive.ts` — arrive here after their
 * own policy. The rule ORDER is exported because order is contract (D39,
 * D52), and `evaluateStandingRules` exports the item-independent subset so
 * the write path's resume gate reuses these rules rather than restating them.
 */

import type { RepositoryConfig } from "../config/index.js";
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

/** The brake's own verdict, in one place: two entry points return it. */
const KILL_SWITCH: SafetyVerdict = {
    outcome: "refuse",
    code: "killSwitch",
    reason: "a kill switch is active",
};

/** Kill switch and authoritative precondition run before either write door. */
export function evaluatePreflight(context: WriteContext): SafetyVerdict | null {
    // Before the observation-intent short-circuit: the brake refuses those
    // requests too. `decide()` has already evaluated the capability and any
    // resolver, so this is not a transport/read stop (D117).
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

/**
 * What a rule may look at when it knows nothing about the item: the
 * repository's file, the class of action, and the installation's grants.
 */
interface StandingFacts {
    readonly config: RepositoryConfig;
    readonly actionClass: StandingRequest["actionClass"];
    readonly capabilityEnabled: boolean;
    readonly missing: readonly string[];
}

/**
 * Everything a rule may look at, derived once so no rule recomputes it.
 */
interface Facts extends StandingFacts {
    readonly request: WriteRequest;
    readonly context: WriteContext;
}

type StandingRule = (f: StandingFacts) => SafetyVerdict | null;
type Rule = (f: Facts) => SafetyVerdict | null;

/**
 * Which facts one rule needs, as data beside the rule itself.
 *
 * `standing` rules read only the repository's configuration and the
 * installation, so they are the same answer whatever the item looks like now.
 * `itemState` rules read the derived world, the ordering evidence or the
 * cause's own timestamp, and can only be judged against a live read.
 *
 * The split is what lets `evaluateStandingRules` run a SUBSET without
 * restating it: the scope travels with the rule, so a rule that starts reading
 * the item has one place to say so.
 */
export type RuleScope = "standing" | "itemState";

/** One entry of `GENERAL_RULES`, discriminated by its scope. */
type GeneralRule =
    | readonly [name: string, rule: StandingRule, scope: "standing"]
    | readonly [name: string, rule: Rule, scope: "itemState"];

/**
 * One entry, per scope. The list below is written through these rather than
 * as bare tuples for a typing reason: a tuple literal checked against the
 * union above infers nothing for the rule's own parameter, so every rule would
 * have to annotate the facts it reads. Naming the scope in the call says the
 * same thing once, where a reader is already looking.
 */
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

/**
 * The general rules, IN ORDER — order is contract, not style (D39, D52).
 * Data rather than `if`s so precedence is asserted directly by the tests
 * instead of inferred from contrived multi-trigger inputs.
 */
export const GENERAL_RULES: readonly GeneralRule[] = [
    // Observations need no permission and are always recordable.
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
    // Closure ahead of the pause, the order `workflow/reference.ts`'s walk
    // already uses: a pause is a state a human lifts, closure is where the
    // item's flow ended. Reporting the pause on a closed item would name
    // the reversible fact and hide the terminal one.
    //
    // A capability may still claim `expected.closed: false`, but that
    // claim is optional and defaults to no claim (D47, `factory.ts`), so
    // it protects only the capabilities that remember to make it. This
    // rule reads the derived world instead, and therefore holds for every
    // capability including one built from `unknown`.
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
    // Unestablished ordering is a conflict, never an absence — checked
    // before the comparison, because there is nothing to compare against.
    itemState("humanOrderingUnknown", (f) =>
        f.context.latestHumanChangeAt === "unknown"
            ? refuse(
                  "humanOrderingUnknown",
                  "ordering evidence for the newest human change is unavailable; the safe default is a conflict (manual-edits.md §2)",
              )
            : null,
    ),
    itemState("invalidTimestamp", (f) =>
        !Number.isFinite(f.request.causeObservedAt.getTime()) ||
        (f.context.latestHumanChangeAt !== null &&
            f.context.latestHumanChangeAt !== "unknown" &&
            !Number.isFinite(f.context.latestHumanChangeAt.getTime()))
            ? refuse(
                  "invalidTimestamp",
                  "the write request contains an invalid observation or human-change timestamp",
              )
            : null,
    ),
    // Ties go to the human: GitHub timestamps have second granularity,
    // so exact ties happen (D33).
    itemState("newerHumanChange", (f) =>
        f.context.latestHumanChangeAt !== null &&
        f.context.latestHumanChangeAt !== "unknown" &&
        f.context.latestHumanChangeAt.getTime() >= f.request.causeObservedAt.getTime()
            ? refuse(
                  "newerHumanChange",
                  "a human change at or after the cause conflicts; human edits are authoritative (rule 5)",
              )
            : null,
    ),
    standing("modeDisabled", (f) =>
        f.config.mode === "disabled"
            ? refuse("modeDisabled", "the repository mode is disabled")
            : null,
    ),
    standing("modeRecordsOnly", (f) =>
        f.config.mode === "observe" || f.config.mode === "dry-run"
            ? record(
                  "modeRecordsOnly",
                  `repository mode is ${f.config.mode}; the effect is recorded, not applied (rule 10)`,
              )
            : null,
    ),
];

/** The half of the facts a standing request and context already carry. */
function standingFacts(
    request: StandingRequest,
    config: RepositoryConfig,
    context: StandingContext,
): StandingFacts {
    return {
        config,
        actionClass: request.actionClass,
        // Derived, never supplied: the reviewed file is the only source (D73).
        capabilityEnabled: config.capabilities[request.capability]?.enabled === true,
        missing: missingPermissions(request.requiredPermissions, context.installationGrants),
    };
}

/** The ordered rules, run in order. Both doors arrive here after their own policy. */
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
 * The kill switch and every `standing` rule, in the same order — the brakes a
 * caller holding no item can still consult.
 *
 * The write path's resume gate is the caller (`shell/src/apply.ts`). It runs
 * this INSTEAD of the full ladder, and the argument for the subset belongs
 * there, with the half-finished label swap that motivates it. What belongs
 * here is why the subset can be trusted: the rules are the same functions in
 * the same order, so a repository that turned a capability off, left active
 * mode, or lost a grant refuses a resend under the code it would refuse a
 * fresh decision under.
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
