/**
 * The vocabulary every safety decision is expressed in: what a capability
 * requests, what the shell rechecked, and the verdict shape both entry
 * points return.
 *
 * Types only, so `write.ts`, `destructive.ts` and `internal.ts` can all
 * depend on this without depending on each other.
 */

import type { DerivedWorld } from "./world.js";
import type { PermissionGrant } from "../github/index.js";
export type { RepositoryMode } from "../config/index.js";

export type ActionClass =
    | "observation"
    | "humanFacingOutput"
    | "reversibleStateChange"
    | "clockTriggeredDestructive"
    | "immediatePreventive";

/** What a capability must supply with every write request (safety.md §2.3). */
export interface WriteRequest {
    /**
     * What this write needs, from the operation catalogue. Supplied rather
     * than derived because core must not depend on the capability layer.
     */
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
 * When the newest HUMAN change was made: a `Date`, `null` if the shell
 * checked and found none, or `"unknown"` if it could not establish
 * ordering. Unestablished ordering is a conflict, never an absence
 * (`FINDING(safety-ordering-unknown)`, D51).
 */
export type HumanChangeOrdering = Date | null | "unknown";

/**
 * What a write evaluation needs beyond the request and the config: the
 * three facts that are genuinely EXTERNAL — nothing else. The two facts
 * callers used to assert here (`observedMeanings`, `preconditionHolds`)
 * are now the branded `DerivedWorld`, constructible only by derivation
 * from the observation (D92 phase 4) — a shell cannot assert a world that
 * contradicts the one it delivered, because it has no type to assert it
 * with.
 */
export interface WriteContext {
    /**
     * What GitHub GRANTED this installation — not whether it is enough.
     * The engine computes sufficiency from the request's requirements, so a
     * refusal can name the missing permission (D77).
     */
    readonly installationGrants: readonly PermissionGrant[];
    /** Kill switches: global / installation / repository / capability (safety.md §5). */
    readonly killSwitchActive: boolean;
    /**
     * When the newest HUMAN change on the touched state was made, `null`
     * if the shell checked and found none, `"unknown"` if it could not
     * establish ordering. The shell must exclude the causing event itself.
     */
    readonly latestHumanChangeAt: HumanChangeOrdering;
    /** The derived facts — see `world.ts`. */
    readonly world: DerivedWorld;
}

/**
 * Machine-readable verdict causes — the executor, telemetry, the config
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

export type RecordOnlyCode = "observation" | "modeRecordsOnly";

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

/**
 * safety.md §2 — the mechanically checkable subset of the ten rules.
 * Rules 7–10 (postcondition verification, unclear-outcome reconciliation,
 * tested rollback, dry-run-before-active rollout) are executor and process
 * obligations; they cannot be decided from a single request and live with
 * the effect executor when it exists.
 *
 * Check precedence is policy: kill switch → observation → consent
 * (rule 1) → authority (rule 2) → pause (§5) → staleness (rule 4) →
 * human conflict (rule 5) → mode. Only the kill-switch step changes an
 * outcome (FINDING below); otherwise order decides which `code` is
 * reported, frozen by the tests.
 */
