/** The vocabulary every safety decision is expressed in: request, context, verdict. */

import type { DerivedWorld } from "./world.js";
import type { PermissionGrant } from "../github/index.js";
export type { RepositoryMode } from "../config/index.js";

/** How risky an action is, least to most (`design/contracts/safety.md`). */
export type ActionClass =
    | "observation"
    | "humanFacingOutput"
    | "reversibleStateChange"
    | "clockTriggeredDestructive"
    | "immediatePreventive";

/** The half of a write request that names no item and no instant. */
export interface StandingRequest {
    readonly requiredPermissions: readonly PermissionGrant[];
    readonly actionClass: ActionClass;
    readonly capability: string;
}

/** What one write request states; its class and permissions come from `INTENT_OPERATIONS` (D57). */
export interface WriteRequest extends StandingRequest {
    readonly causeObservedAt: Date;
    readonly evaluatedAt?: Date;
    readonly cause: string;
    readonly target: { readonly item: string; readonly change: string };
}

/** When the newest HUMAN change happened; `unknown` is a conflict, never an absence (D51). */
export type HumanChangeOrdering = Date | null | "unknown";

/**
 * The facts true of every write here and now. `installationGrants` is what
 * GitHub GRANTED, never whether it is enough (D77).
 */
export interface StandingContext {
    readonly installationGrants: readonly PermissionGrant[];
    readonly killSwitchActive: boolean;
}

/**
 * The external facts, plus the derived world. `latestHumanChangeAt` must
 * exclude the causing event; `world` can only be derived (D92).
 */
export interface WriteContext extends StandingContext {
    readonly latestHumanChangeAt: HumanChangeOrdering;
    readonly world: DerivedWorld;
}

/** Machine-readable verdict causes — callers branch on `code`; `reason` is prose. */
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
export type RecordOnlyCode = "observation" | "beforeSince" | "modeRecordsOnly";

/** The answer both gates return: applied, recorded, or refused with a code. */
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
