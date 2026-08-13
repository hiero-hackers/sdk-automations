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
 * How risky an action is, least to most (safety.md §1). The ladder is
 * ordered: `INTENT_OPERATIONS` states a floor per operation and a capability
 * may declare stricter, never laxer.
 */
export type ActionClass =
    | "observation"
    | "humanFacingOutput"
    | "reversibleStateChange"
    | "clockTriggeredDestructive"
    | "immediatePreventive";

/**
 * What a capability must supply with every write request (safety.md §2.3).
 *
 * `requiredPermissions` is supplied rather than derived, because core must
 * not depend on the capability layer to learn what an operation needs.
 */
export interface WriteRequest {
    readonly requiredPermissions: readonly PermissionGrant[];
    readonly actionClass: ActionClass;
    readonly capability: string;
    /** Dated cause — when the triggering observation was made. */
    readonly causeObservedAt: Date;
    readonly cause: string;
    /** The exact item and value the adapter may change (safety.md §2.6). */
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
    /** Global / installation / repository / capability (safety.md §5). */
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
