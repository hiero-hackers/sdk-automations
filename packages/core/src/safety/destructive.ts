/**
 * Clock-triggered destructive actions — `design/core/safety.md` §3–§4.
 *
 * Separate from `write.ts` because it answers a different question. The
 * general rules ask "may this write happen"; this asks "has the warning,
 * the grace period and the cancellation window been honoured" — and D52
 * made `evaluateWrite` REFUSE a destructive request outright, so the two
 * entry points are not interchangeable and should not read as if they were.
 */

import type { RepositoryConfig } from "../config/index.js";
import { evaluateGeneralRulesAfterPreflight, evaluatePreflight } from "./rules.js";
import type { ActionClass, SafetyVerdict, WriteContext, WriteRequest } from "./types.js";

// ─── Clock-triggered destructive actions (safety.md §3) ──────────────

/**
 * A recorded warning, the precondition of every destructive action:
 * "a clock-triggered action never occurs on its first stale observation."
 */
const DESTRUCTIVE_WARNING_BRAND: unique symbol = Symbol("DestructiveWarning");

interface DestructiveRequestSnapshot {
    readonly actionClass: ActionClass;
    readonly capability: string;
    readonly causeObservedAtMs: number;
    readonly cause: string;
    readonly item: string;
    readonly change: string;
}

/** What a caller supplies to have a warning minted. */
export interface DestructiveWarningInput {
    readonly request: WriteRequest;
    readonly warnedAt: Date;
    readonly gracePeriodDays: number;
    readonly earliestActionAt: Date;
    readonly cancelledBy: string;
    readonly reversesWith: string;
}

/**
 * A minted warning: authority for ONE request, not a reusable timestamp.
 *
 * The immutable request snapshot is what stops a warning being reused across
 * capabilities, items, changes or causal observations (D60). Only
 * `createDestructiveWarning` can construct one.
 */
export interface DestructiveWarning {
    readonly [DESTRUCTIVE_WARNING_BRAND]: true;
    /** Copied primitives, never a reference to the caller's request. */
    readonly requestSnapshot: DestructiveRequestSnapshot;
    readonly warnedAtMs: number;
    readonly gracePeriodDays: number;
    /** Stated in the warning; may be later than the configured grace floor. */
    readonly earliestActionAtMs: number;
    /** What cancels the plan, stated in the warning (safety.md §3). */
    readonly cancelledBy: string;
    /** How a maintainer reverses the action after it occurs. */
    readonly reversesWith: string;
}

/**
 * Capture authority at warning time. Numeric timestamps and copied strings
 * avoid aliases to mutable request targets and mutable Date internal state.
 */
export function createDestructiveWarning(input: DestructiveWarningInput): DestructiveWarning {
    const requestSnapshot: DestructiveRequestSnapshot = Object.freeze({
        actionClass: input.request.actionClass,
        capability: input.request.capability,
        causeObservedAtMs: input.request.causeObservedAt.getTime(),
        cause: input.request.cause,
        item: input.request.target.item,
        change: input.request.target.change,
    });
    return Object.freeze({
        [DESTRUCTIVE_WARNING_BRAND]: true as const,
        requestSnapshot,
        warnedAtMs: input.warnedAt.getTime(),
        gracePeriodDays: input.gracePeriodDays,
        earliestActionAtMs: input.earliestActionAt.getTime(),
        cancelledBy: input.cancelledBy,
        reversesWith: input.reversesWith,
    });
}

/** A warning plus what has happened since — everything §4 needs to judge. */
export interface DestructivePlan {
    readonly request: WriteRequest;
    readonly warning: DestructiveWarning | null;
    /** Qualifying activity from the affected person since the warning. */
    readonly qualifyingActivitySinceWarning: boolean;
}

/**
 * FINDING(safety-grace-floor): safety.md §4 requires the schema to "set safe
 * minimums and prevent a zero-day or negative grace period" but names no
 * floor. This module enforces `>= MIN_GRACE_DAYS`; the exact number is a
 * register decision — 1 is the weakest defensible reading, encoded here so
 * the question cannot be silently skipped.
 */
export const MIN_GRACE_DAYS = 1;

const DAY_MS = 24 * 60 * 60 * 1000;

function warningMatchesRequest(
    warned: DestructiveRequestSnapshot,
    requested: WriteRequest,
): boolean {
    return (
        warned.actionClass === requested.actionClass &&
        warned.capability === requested.capability &&
        warned.causeObservedAtMs === requested.causeObservedAt.getTime() &&
        warned.cause === requested.cause &&
        warned.item === requested.target.item &&
        warned.change === requested.target.change
    );
}

/** safety.md §3 — every condition core can confirm before a future write. */
export function evaluateDestructive(
    plan: DestructivePlan,
    config: RepositoryConfig,
    context: WriteContext,
    now: Date,
): SafetyVerdict {
    // Kill switch first, before any §3 gate. The outcome is a refusal
    // either way, but D39 makes the verdict CODE contract: an operator who
    // pulled the brake must be told so, not "no recorded warning" (D52).
    const preflight = evaluatePreflight(context);
    if (preflight !== null) return preflight;
    if (plan.request.actionClass !== "clockTriggeredDestructive") {
        return {
            outcome: "refuse",
            code: "wrongActionClass",
            reason: "evaluateDestructive only accepts clock-triggered destructive requests",
        };
    }
    if (plan.warning === null) {
        return {
            outcome: "refuse",
            code: "noWarning",
            reason: "no recorded warning — a destructive action never occurs on first observation (§3)",
        };
    }
    if (!warningMatchesRequest(plan.warning.requestSnapshot, plan.request)) {
        return {
            outcome: "refuse",
            code: "warningRequestMismatch",
            reason: "the recorded warning does not authorize this exact capability, target, change, and causal observation",
        };
    }
    if (
        !Number.isFinite(plan.warning.gracePeriodDays) ||
        !Number.isFinite(plan.warning.warnedAtMs) ||
        !Number.isFinite(plan.warning.earliestActionAtMs) ||
        !Number.isFinite(plan.warning.requestSnapshot.causeObservedAtMs) ||
        plan.warning.cancelledBy.trim() === "" ||
        plan.warning.reversesWith.trim() === "" ||
        !Number.isFinite(now.getTime())
    ) {
        return {
            outcome: "refuse",
            code: "invalidDestructivePlan",
            reason: "the destructive plan contains a non-finite grace period or invalid timestamp",
        };
    }
    if (plan.warning.gracePeriodDays < MIN_GRACE_DAYS) {
        return {
            outcome: "refuse",
            code: "graceBelowFloor",
            reason: `grace period ${plan.warning.gracePeriodDays}d is below the ${MIN_GRACE_DAYS}d floor (§4)`,
        };
    }
    const minimumActionAt = plan.warning.warnedAtMs + plan.warning.gracePeriodDays * DAY_MS;
    if (
        plan.warning.warnedAtMs < plan.warning.requestSnapshot.causeObservedAtMs ||
        plan.warning.earliestActionAtMs < minimumActionAt
    ) {
        return {
            outcome: "refuse",
            code: "invalidDestructivePlan",
            reason: "the warning predates its observation or states an action time before the full grace period",
        };
    }
    if (now.getTime() < plan.warning.earliestActionAtMs) {
        return {
            outcome: "refuse",
            code: "graceRunning",
            reason: "the grace period has not fully elapsed (§3)",
        };
    }
    if (plan.qualifyingActivitySinceWarning) {
        return {
            outcome: "refuse",
            code: "activityCancelled",
            reason: "the affected person provided qualifying activity during the grace period (§3)",
        };
    }
    // All destructive-specific gates passed; the general write rules
    // decide. Calls the shared internal path, not the public
    // `evaluateWrite`, which now refuses this action class outright (D52).
    return evaluateGeneralRulesAfterPreflight(plan.request, config, context);
}
