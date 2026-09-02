/**
 * Turning what core already produces into findings.
 *
 * Every producer keeps its own return shape — nothing here changes a
 * signature. These are adapters, and the fact that they are one-liners over
 * an exhaustive map is the point: the classification lives in ONE table
 * rather than being re-derived by each of the four surfaces that will read
 * a report.
 */

import type { ConfigResult } from "../config/index.js";
import type { SafetyRefusalCode, SafetyVerdict } from "../safety/index.js";
import type { IntentScreen, StructuredExplanation } from "../capability/index.js";
import { finding, type Finding, type Severity, type Subject } from "./finding.js";

/**
 * The heart of "a capability explains, the platform classifies".
 *
 * A refusal is not automatically a problem. Most refusals are the system
 * working: a disabled capability, a paused item, a human who edited the
 * issue first. Reporting those as problems would bury the handful that
 * genuinely need a maintainer — which is the failure mode an operator
 * surface exists to prevent.
 *
 * `notice` means "nothing happened, and that was correct". `problem` means
 * "a human must act, or this will keep failing".
 */
const REFUSAL_SEVERITY: { readonly [K in SafetyRefusalCode]: Severity } = {
    // Deliberate states. Nothing is wrong; nothing needs doing.
    killSwitch: "notice",
    capabilityDisabled: "notice",
    modeDisabled: "notice",
    itemBlocked: "notice",
    itemClosed: "notice",
    graceRunning: "notice",
    activityCancelled: "notice",
    newerHumanChange: "notice",
    preconditionStale: "notice",

    // A maintainer must act: grant a permission, fix a configuration, or
    // accept that this capability cannot run here.
    permissionMissing: "problem",

    // Diagnostics the platform could not establish. Safe by default, but a
    // human should know the safe default was reached by not knowing.
    humanOrderingUnknown: "problem",

    // Defects — in a capability, the shell, or the platform. None of these
    // should ever be reachable in a correct system, so all of them are loud.
    wrongEntryPoint: "problem",
    preventiveGateUnavailable: "problem",
    invalidTimestamp: "problem",
    wrongActionClass: "problem",
    noWarning: "problem",
    warningRequestMismatch: "problem",
    invalidDestructivePlan: "problem",
    graceBelowFloor: "problem",
};

/** A safety verdict as a finding. */
export function verdictFinding(verdict: SafetyVerdict, subject: Subject): Finding {
    if (verdict.outcome === "apply") {
        return finding("info", "applied", "The write was permitted.", subject);
    }
    if (verdict.outcome === "record-only") {
        return finding("notice", verdict.code, verdict.reason, subject);
    }
    return finding(REFUSAL_SEVERITY[verdict.code], verdict.code, verdict.reason, subject);
}

/**
 * A failed screen is always a defect: the capability produced an intent it
 * had no right to produce, or produced one malformed. There is no benign
 * reason for a screen to fail, which is why there is no table here.
 */
export function screenFinding(screen: IntentScreen, subject: Subject): Finding {
    return screen.ok
        ? finding("info", "screened", "The intent passed every screen.", subject)
        : finding("problem", screen.code, screen.reason, subject);
}

/**
 * A capability's own words. It supplies no severity and no code — it is not
 * the capability's place to decide how loud its output is, and a capability
 * that could mark itself `problem` could drown the ones that are.
 */
export function explanationFinding(explanation: StructuredExplanation, subject: Subject): Finding {
    return finding("info", "capabilityExplained", explanation.summary, subject, explanation.detail);
}

/**
 * Configuration errors as findings.
 *
 * Each carries its own code and the dotted path it came from, so a check run
 * can group by kind, count, and annotate one line instead of pasting a
 * paragraph (D75).
 */
export function configFindings(result: ConfigResult): readonly Finding[] {
    if (result.ok) {
        return [
            finding(
                "info",
                "configValid",
                `Configuration accepted; repository mode is ${result.config.mode}.`,
                { kind: "configuration", path: null },
            ),
        ];
    }
    return result.errors.map((e) =>
        finding("problem", e.code, e.message, {
            kind: "configuration",
            path: e.path,
        }),
    );
}
