/**
 * Turning what core already produces into findings. Every producer keeps its
 * own return shape; the classification lives in ONE table, not in each surface.
 */

import type { ConfigResult } from "../config/index.js";
import type { SafetyRefusalCode, SafetyVerdict } from "../safety/index.js";
import type { StructuredExplanation } from "../catalogue.js";
import type { IntentScreen } from "../intents/index.js";
import { finding, type Finding, type Severity, type Subject } from "./finding.js";

/**
 * `notice` means nothing happened and that was correct; `problem` means a human
 * must act or this keeps failing. Most refusals are the system working.
 */
const REFUSAL_SEVERITY: { readonly [K in SafetyRefusalCode]: Severity } = {
    // Deliberate states. Nothing is wrong; nothing needs doing.
    killSwitch: "notice",
    capabilityDisabled: "notice",
    modeDisabled: "notice",
    itemBlocked: "notice",
    itemClosed: "notice",
    graceRunning: "info",
    activityCancelled: "notice",
    newerHumanChange: "notice",
    preconditionStale: "notice",

    // A maintainer must act: grant a permission or fix a configuration.
    permissionMissing: "problem",

    // Safe by default, but the default was reached by not knowing.
    humanOrderingUnknown: "problem",

    // Defects: unreachable in a correct system, so all of them are loud.
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

/** A failed screen is always a defect: no benign reason exists, so there is no table here. */
export function screenFinding(screen: IntentScreen, subject: Subject): Finding {
    return screen.ok
        ? finding("info", "screened", "The intent passed every screen.", subject)
        : finding("problem", screen.code, screen.reason, subject);
}

/** A capability's own words. It supplies no severity and no code (D75). */
export function explanationFinding(explanation: StructuredExplanation, subject: Subject): Finding {
    return finding("info", "capabilityExplained", explanation.summary, subject, explanation.detail);
}

/** A capability holding back an act under a rule the repository chose: nothing happened, as intended. */
export function exemptionFinding(exemption: StructuredExplanation, subject: Subject): Finding {
    return finding("notice", "capabilityExempted", exemption.summary, subject, exemption.detail);
}

/** Configuration errors as findings, each carrying its code and the dotted path (D75). */
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
