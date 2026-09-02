/**
 * The vocabulary every safety decision is expressed in: what a capability
 * requests, what the shell rechecked, and the verdict shape both entry
 * points return.
 *
 * Types only, so `write.ts`, `destructive.ts` and `rules.ts` can all depend
 * on this without depending on each other.
 */

import type { DerivedWorld } from "./world.js";
import type { PermissionGrant } from "../github/index.js";
export type { RepositoryMode } from "../config/index.js";

/**
 * How risky an action is, least to most (`design/contracts/safety.md`).
 *
 * The class is the platform's. `INTENT_OPERATIONS` states one per operation
 * and `decide()` reads it there; a capability has no field to declare one in,
 * so it can neither relax nor tighten the class it acts under (D57).
 */
export type ActionClass =
    | "observation"
    | "humanFacingOutput"
    | "reversibleStateChange"
    | "clockTriggeredDestructive"
    | "immediatePreventive";

/**
 * What one write request states (`design/contracts/safety.md`).
 *
 * Nothing here comes from a capability's declaration. `decide()` fills
 * `requiredPermissions` and `actionClass` from `INTENT_OPERATIONS`, so a
 * capability cannot understate what its operation needs (D57); the remaining
 * fields come from the intent it returned.
 */
export interface WriteRequest {
    readonly requiredPermissions: readonly PermissionGrant[];
    readonly actionClass: ActionClass;
    readonly capability: string;
    /** Dated cause — when the triggering observation was made. */
    readonly causeObservedAt: Date;
    readonly cause: string;
    /** The exact item and value the adapter may change (`design/guides/effects.md`). */
    readonly target: { readonly item: string; readonly change: string };
}

/**
 * When the newest HUMAN change happened: a date, `null` if the shell checked
 * and found none, `"unknown"` if it could not establish ordering. Unknown is
 * a conflict, never an absence (D51).
 */
export type HumanChangeOrdering = Date | null | "unknown";

/**
 * The three facts a decision needs that are genuinely EXTERNAL, plus the
 * derived world. Nothing else.
 *
 * `installationGrants` is what GitHub GRANTED, not whether it is enough —
 * the engine computes sufficiency itself, so a refusal can name the missing
 * permission (D77). `latestHumanChangeAt` must exclude the causing event.
 * `world` cannot be asserted here, only derived (D92).
 */
export interface WriteContext {
    readonly installationGrants: readonly PermissionGrant[];
    /** Global / installation / repository / capability kill switches. */
    readonly killSwitchActive: boolean;
    readonly latestHumanChangeAt: HumanChangeOrdering;
    readonly world: DerivedWorld;
}

/**
 * Machine-readable verdict causes — telemetry, the config
 * report, and managed explanations branch on `code`; `reason` is prose
 * for humans only. Same convention as `FailureClass` in failures.ts.
 */
export type SafetyRefusalCode =
    | "killSwitch"
    | "wrongEntryPoint"
    | "preventiveGateUnavailable"
    | "capabilityDisabled"
    | "permissionMissing"
    | "itemClosed"
    | "itemBlocked"
    | "preconditionStale"
    | "newerHumanChange"
    | "humanOrderingUnknown"
    | "invalidTimestamp"
    | "modeDisabled"
    | "wrongActionClass"
    | "noWarning"
    | "warningRequestMismatch"
    | "invalidDestructivePlan"
    | "graceBelowFloor"
    | "graceRunning"
    | "activityCancelled";

/** Why a write was recorded rather than performed. Not a refusal. */
export type RecordOnlyCode = "observation" | "modeRecordsOnly";

/** The answer both doors return: applied, recorded, or refused with a code. */
export type SafetyVerdict =
    | { readonly outcome: "apply" }
    | {
          readonly outcome: "record-only";
          readonly code: RecordOnlyCode;
          readonly reason: string;
      }
    | {
          readonly outcome: "refuse";
          readonly code: SafetyRefusalCode;
          readonly reason: string;
      };
