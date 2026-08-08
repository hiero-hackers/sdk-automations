/**
 * The general entry point — every action class EXCEPT
 * `clockTriggeredDestructive` (`design/core/safety.md` §2).
 *
 * **The rules themselves are in `rules.ts`.** This file is short on purpose,
 * and the shortness is information: it holds only the policy belonging to
 * THIS door — which classes it refuses outright — then hands off to the rules
 * both doors share. `destructive.ts` is the other door, and it is long
 * because eight §3 gates belong to it alone.
 *
 * Do not merge the three. The asymmetry records that the general path has
 * almost no special policy while the destructive one is almost entirely
 * special policy.
 */

import type { RepositoryConfig } from "../config/index.js";
import { evaluateGeneralRulesAfterPreflight, evaluatePreflight } from "./rules.js";
import type { SafetyVerdict, WriteContext, WriteRequest } from "./types.js";

export function evaluateWrite(
    request: WriteRequest,
    config: RepositoryConfig,
    context: WriteContext,
): SafetyVerdict {
    const preflight = evaluatePreflight(context);
    if (preflight !== null) return preflight;
    if (request.actionClass === "clockTriggeredDestructive") {
        return {
            outcome: "refuse",
            code: "wrongEntryPoint",
            reason: "a clock-triggered destructive action must be evaluated by evaluateDestructive, which alone enforces the §3 warning and grace gates",
        };
    }
    if (request.actionClass === "immediatePreventive") {
        return {
            outcome: "refuse",
            code: "preventiveGateUnavailable",
            reason: "immediate preventive actions are disabled until the request proves an immediate explanation and a simple maintainer reversal (safety.md §1)",
        };
    }
    return evaluateGeneralRulesAfterPreflight(request, config, context);
}
