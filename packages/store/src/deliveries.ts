/**
 * What a delivery is, and what comes back from operating on one: one
 * input and one closed result type per durable-intake operation.
 *
 * Vocabulary only. `store.ts` owns the transitions and the SQLite rows
 * behind them, `schema.ts` the table definitions. `effects.ts` and
 * `schedules.ts` are the sibling vocabularies.
 */

import type { DeliveryGuid } from "@hiero-hackers/automation-core";

/**
 * One delivery's durable queue state. `failed` is the dead letter: attempts
 * reached the caller's cap, so nothing claims it again and it keeps its
 * payload for inspection and manual redrive.
 */
export type DeliveryState = "pending" | "processing" | "done" | "failed";

/** Verified bytes and identity offered at the durable intake boundary. */
export interface AcceptDeliveryInput {
    readonly deliveryId: DeliveryGuid;
    readonly eventName: string;
    readonly payload: Uint8Array;
    readonly receivedAt: string;
}

/** The accepted, duplicate, or conflicting intake classification. */
export type AcceptDeliveryResult =
    | {
          readonly outcome: "accepted";
          readonly state: "pending";
          readonly payloadDigest: string;
      }
    | {
          readonly outcome: "duplicate";
          readonly state: DeliveryState;
          readonly payloadDigest: string;
      }
    | {
          readonly outcome: "conflict";
          readonly state: DeliveryState;
          readonly eventNameMismatch: boolean;
          readonly payloadMismatch: boolean;
      };

/**
 * A delivery plus the token that currently owns its processing claim.
 *
 * `attempts` counts the failures BEFORE this claim, so a first claim reads
 * zero. It is what a caller derives a backoff and a retry budget from.
 */
export interface ClaimedDelivery {
    readonly deliveryId: DeliveryGuid;
    readonly eventName: string;
    readonly payload: Uint8Array;
    readonly payloadDigest: string;
    readonly receivedAt: string;
    readonly worker: string;
    readonly claimedAt: string;
    readonly claimToken: string;
    readonly attempts: number;
}

/** Everything the store must bind to one report-and-completion commit. */
export interface CompleteDeliveryWithReportInput {
    readonly deliveryId: DeliveryGuid;
    readonly eventName: string;
    readonly payloadDigest: string;
    readonly claimToken: string;
    readonly reportJson: string;
    readonly completedAt: string;
}

/** The closed result of attempting the report-and-completion commit. */
export type CompleteDeliveryWithReportResult =
    | { readonly outcome: "completed" }
    | { readonly outcome: "alreadyCompleted" }
    | { readonly outcome: "notOwned" }
    | { readonly outcome: "identityMismatch" }
    | { readonly outcome: "reportConflict" };

/** Whether the supplied token released its delivery claim. */
export type ReleaseDeliveryResult =
    { readonly outcome: "released" } | { readonly outcome: "notOwned" };

/**
 * One failed processing attempt, and the two instants that decide what
 * happens to the delivery next.
 *
 * `retryNotBefore` is when the delivery may be claimed again, and
 * `failedAt` stamps the dead letter when `maxAttempts` is reached instead.
 * Both are caller-supplied, like every other instant the store accepts: the
 * store counts attempts, the caller owns the retry policy that spaces them.
 */
export interface ReleaseDeliveryAfterFailureInput {
    readonly deliveryId: DeliveryGuid;
    readonly claimToken: string;
    readonly failedAt: string;
    readonly retryNotBefore: string;
    readonly maxAttempts: number;
}

/** What the counted failure did to the delivery, `attempts` now included. */
export type ReleaseDeliveryAfterFailureResult =
    | {
          readonly outcome: "retryScheduled";
          readonly attempts: number;
          readonly retryNotBefore: string;
      }
    | { readonly outcome: "deadLettered"; readonly attempts: number }
    | { readonly outcome: "notOwned" };

/** One dead-lettered delivery's identity, without its retained bytes. */
export interface DeadLetteredDelivery {
    readonly deliveryId: DeliveryGuid;
    readonly eventName: string;
    readonly payloadDigest: string;
    readonly receivedAt: string;
    readonly attempts: number;
    readonly failedAt: string;
}

/** One canonical report in deterministic projection-replay order. */
export interface CanonicalDeliveryReport {
    readonly deliveryId: DeliveryGuid;
    readonly reportJson: string;
    readonly completedAt: string;
}
