/**
 * The webhook lane: claim a durable delivery, prepare it, hand the shared box one item,
 * then complete it. The reading key: a claimed delivery always
 * ends as exactly ONE of five records — `repositoryMismatch`, `installationSuspended`,
 * `configRejected`, `modeUnsupported`, or a decision, with no sixth exit.
 * A pass whose read this lane's allowance refused completes none of them: it is
 * counted and retried, as a crash is. The try/catch in `attemptNext` is routing.
 */

import {
    parseConfigDocument,
    repositoryNamedBy,
    UNREADABLE_CONFIG_REVISION,
    type ConfigResult,
    type ConfigError,
    type EngineCapability,
    type Report,
    type RepositoryConfig,
    type RepositoryRef,
} from "@hiero-hackers/automation-core";
import type {
    ClaimedDelivery,
    ReleaseDeliveryAfterFailureResult,
    Store,
} from "../../store/index.js";
import type { Allowance, Refusal } from "../allowance.js";
import type { ConfigSource } from "../decide/config.js";
import type { DecideItem } from "../decide/item.js";
import { declareSweep } from "../decide/schedule.js";
import type { EffectOutcome } from "../effects.js";
import { detailOf, type Log } from "../log.js";

/**
 * A processing claim older than this is presumed dead and taken over.
 * Exported for the tick in `shell.ts`, which requeues on the same clock.
 */
export const STALE_CLAIM_MINUTES = 15;

/**
 * The retry bounds: five attempts in all, waiting 30s, 60s, 120s and 240s between.
 * The hourly ceiling bounds the doubling rather than being a number this reaches.
 */
const MAX_DELIVERY_ATTEMPTS = 5;
const RETRY_BASE_MS = 30_000;
const RETRY_CEILING_MS = 60 * 60_000;

/** The wait a delivery earns after `attempts` failures, doubling each time. */
function retryDelayMs(attempts: number): number {
    return Math.min(RETRY_BASE_MS * 2 ** attempts, RETRY_CEILING_MS);
}

/** The earlier of the ladder's step and a spent pool's window; both are `toISOString()`. */
function soonerOf(ladder: string, resetAt: string | null): string {
    return resetAt !== null && resetAt < ladder ? resetAt : ladder;
}

/** What one repository's deliveries are read and decided through. */
export interface DeliveryLane {
    readonly configSource: ConfigSource;
    /** The shared box: this lane decides nothing itself (D172). */
    readonly decideItem: DecideItem;
}

/** Dependencies and operator hooks for one durable delivery worker. */
export interface DeliveriesOptions {
    readonly store: Store;
    readonly capabilities: readonly EngineCapability[];
    /** One repository's lane; the payload names which, and every one is served (D169). */
    readonly lane: (repository: RepositoryRef) => DeliveryLane;
    /** The one repository a credential-free process serves; absent, every named one is. */
    readonly repository?: RepositoryRef;
    /** This lane's share of GitHub's limits: a read it refuses retries the delivery (D192). */
    readonly allowance?: Allowance;
    readonly worker: string;
    readonly clock: () => Date;
    /** Every line here names its delivery: this is the lane that retries. */
    readonly log: Log;
    /** The installation switch (D171): every delivery is accepted and recorded, and none is decided. */
    readonly suspended?: boolean;
}

/** What every persisted record says about which delivery it answers. */
interface RecordIdentity {
    readonly deliveryId: string;
    readonly event: string;
    readonly receivedAt: string;
    readonly decidedAt: string;
    readonly configRevision: string;
}

/** What one delivery came to; only its `kind` leaves the lane, on the completion line (D173). */
export type ShellRecord =
    | (RecordIdentity & {
          readonly kind: "decision";
          readonly report: Report;
          /** What became of each approved effect. Empty outside active mode. */
          readonly effects: readonly EffectOutcome[];
      })
    | (RecordIdentity & {
          /** The config failed to parse. Fail-closed: nothing was decided. */
          readonly kind: "configRejected";
          readonly errors: readonly ConfigError[];
      })
    | (RecordIdentity & {
          /** The runnable shell has no external effect path. */
          readonly kind: "modeUnsupported";
          readonly reason: string;
      })
    | (RecordIdentity & {
          /** The payload names no repository, or one this endpoint does not serve. */
          readonly kind: "repositoryMismatch";
          /** `owner/repo`, or `"any"` served and `"none"` named. */
          readonly expected: string;
          readonly observed: string;
      })
    | (RecordIdentity & {
          /** The installation is suspended: nothing was read and nothing decided (D171). */
          readonly kind: "installationSuspended";
      });

/** Stamped when a record was reached without consulting the configuration. */
const CONFIG_NOT_CONSULTED_REVISION = "sha256:unconsulted";

/** Invalid JSON flows onward as an unreadable payload; the shell has no opinion. */
function parsePayload(bytes: Uint8Array): unknown {
    try {
        return JSON.parse(Buffer.from(bytes).toString("utf8"));
        // Stryker disable next-line BlockStatement: an emptied catch falls through to the same implicit undefined — the mutant is equivalent.
    } catch {
        return undefined;
    }
}

/** What a process serving the whole installation expects, and what a nameless payload observed. */
const ANY_REPOSITORY = "any";
const NO_REPOSITORY = "none";

/** The one spelling every comparison and every record uses. */
function repositorySpelledBy(repository: RepositoryRef): string {
    return `${repository.owner}/${repository.repo}`;
}

/** Case-insensitively, because GitHub's names are: no two repositories differ only in case. */
function sameRepository(named: string, served: string): boolean {
    return named.toLowerCase() === served.toLowerCase();
}

/** What the worker exposes: one pass, or pump until the queue is empty. */
export interface Deliveries {
    processOnce(): Promise<boolean>;
    drain(): Promise<void>;
    /** The drain in flight, if any; resolved at once when none is. */
    settled(): Promise<void>;
    /**
     * The current configuration as this lane reads it, or `null` when it cannot be read.
     * Exposed for the sweep, so a firing is gated on the same file: two readers could disagree about active mode, and that disagreement writes to GitHub.
     */
    configuration(
        repository: RepositoryRef,
        source?: ConfigSource,
    ): Promise<RepositoryConfig | null>;
}

/**
 * What one claimed-and-carried delivery came to.
 * The failure case is a VALUE, because the drain has to keep going after it.
 */
type PassOutcome =
    | { readonly kind: "idle" }
    | { readonly kind: "completed" }
    | {
          readonly kind: "failed";
          readonly deliveryId: string;
          readonly error: unknown;
          readonly release: ReleaseDeliveryAfterFailureResult;
      };

/**
 * What the failure did to the delivery, as the fields its line carries.
 * `attempts` is `null` for exactly one disposition: a lost claim counts nothing.
 */
function dispositionOf(release: ReleaseDeliveryAfterFailureResult): {
    readonly disposition: ReleaseDeliveryAfterFailureResult["outcome"];
    readonly attempts: number | null;
    readonly maxAttempts: number;
    readonly retryNotBefore: string | null;
} {
    const common = { disposition: release.outcome, maxAttempts: MAX_DELIVERY_ATTEMPTS };
    switch (release.outcome) {
        case "retryScheduled":
            return {
                ...common,
                attempts: release.attempts,
                retryNotBefore: release.retryNotBefore,
            };
        case "deadLettered":
            return { ...common, attempts: release.attempts, retryNotBefore: null };
        case "notOwned":
            return { ...common, attempts: null, retryNotBefore: null };
    }
}

/** The one line an undecided record leaves behind, since nothing else stores it (D173). */
function undecidedDetail(record: ShellRecord): string | undefined {
    switch (record.kind) {
        case "configRejected":
            return record.errors
                .map(
                    (error) =>
                        `${error.code}${error.path === null ? "" : ` at ${error.path}`}: ${error.message}`,
                )
                .join("; ");
        case "repositoryMismatch":
            return `expected ${record.expected}, observed ${record.observed}`;
        case "modeUnsupported":
            return record.reason;
        default:
            return undefined;
    }
}

export function createDeliveries(options: DeliveriesOptions): Deliveries {
    const {
        store,
        capabilities,
        lane,
        repository,
        allowance,
        worker,
        clock,
        log,
        suspended = false,
    } = options;
    let draining: Promise<void> | null = null;

    const claimNext = (): ClaimedDelivery | undefined => {
        const now = clock();
        const staleBefore = new Date(now.getTime() - STALE_CLAIM_MINUTES * 60_000);
        return store.inbox.claimNextDelivery(worker, now.toISOString(), staleBefore.toISOString());
    };

    /** Station 4: fetch the text, parse it. Every rejection is a value. */
    const loadConfig = async (
        configSource: ConfigSource,
    ): Promise<{
        readonly revision: string;
        readonly result: ConfigResult;
    }> => {
        const loaded = await configSource.load();
        if (!loaded.ok) {
            if (loaded.permanent) {
                return {
                    revision: loaded.revision ?? UNREADABLE_CONFIG_REVISION,
                    result: {
                        ok: false,
                        // documentUnparseable, not a new code: the catalogue only admits codes a DOCUMENT can reach (D76).

                        errors: [
                            {
                                code: "documentUnparseable",
                                message: `unreadable before parsing: ${loaded.detail}`,
                                path: null,
                            },
                        ],
                    },
                };
            }
            // Transient: the throw costs one attempt and schedules the next, so a config
            // unreachable for good dead-letters instead of retrying without end.

            throw new Error(`configuration unavailable: ${loaded.detail}`);
        }
        const { document } = loaded;
        return {
            revision: document.revision,
            result: parseConfigDocument(document.text, {
                revision: document.revision,
                // Full declarations, not names: the parser reads each settings block against its own spec.

                knownCapabilities: capabilities.map((c) => c.declaration),
            }),
        };
    };

    const identityFor = (
        claimed: ClaimedDelivery,
        configRevision: string,
        decidedAt: Date,
    ): RecordIdentity => ({
        // The branded GUID becomes plain text here: records are JSON.

        deliveryId: String(claimed.deliveryId),
        event: claimed.eventName,
        receivedAt: claimed.receivedAt,
        decidedAt: decidedAt.toISOString(),
        configRevision,
    });

    const served = repository === undefined ? ANY_REPOSITORY : repositorySpelledBy(repository);

    /**
     * Build one delivery's canonical record, stations ③ to ⑤ in reading order.
     * The repository comes FIRST, before the configuration is read: which one a payload names is a permanent property of the bytes and selects the seams the rest of the pass runs on, so a config outage cannot turn a refusal into four retries and a dead letter.
     * The suspension comes next, for the same reason in reverse: a suspended process reads nothing.
     */
    const recordFor = async (claimed: ClaimedDelivery): Promise<ShellRecord> => {
        const payload = parsePayload(claimed.payload);
        const spelled = repositoryNamedBy(payload);
        const observed = spelled === null ? NO_REPOSITORY : repositorySpelledBy(spelled);
        // A nameless payload names no seams to run on, whoever is served; a configured
        // process is held to the one repository it was given.

        const unserved =
            spelled === null || (repository !== undefined && !sameRepository(observed, served));
        if (unserved) {
            return {
                kind: "repositoryMismatch",
                ...identityFor(claimed, CONFIG_NOT_CONSULTED_REVISION, clock()),
                expected: served,
                observed,
            };
        }
        if (suspended) {
            return {
                kind: "installationSuspended",
                ...identityFor(claimed, CONFIG_NOT_CONSULTED_REVISION, clock()),
            };
        }
        // The served spelling wins where there is one: GitHub's names are case-blind,
        // and every row about this pass carries one of them.

        const named = repository ?? spelled;
        const { configSource, decideItem } = lane(named);
        const config = await loadConfig(configSource);
        // One instant is the record's `decidedAt` AND the rows' `at`, so the ledger
        // never disagrees with the record it holds.

        const identity = identityFor(claimed, config.revision, clock());

        if (!config.result.ok) {
            // Fail closed and COMPLETE: the fixed file arrives as its own future delivery.

            return { kind: "configRejected", ...identity, errors: config.result.errors };
        }
        const parsed = config.result.config;
        // The one thing this lane does for the OTHER one: the sweep row is declared
        // here, because this is where the file is read (sweep.md §2, step 1).

        declareSweep({ store, repository: named, config: parsed, capabilities, now: clock() });
        const decided = await decideItem(
            {
                kind: "delivery",
                deliveryId: identity.deliveryId,
                event: identity.event,
                payload,
            },
            parsed,
            identity.decidedAt,
            allowance,
        );
        return decided.kind === "modeUnsupported"
            ? { kind: "modeUnsupported", ...identity, reason: decided.reason }
            : { kind: "decision", ...identity, report: decided.report, effects: decided.outcomes };
    };

    /**
     * Count one failed attempt, which either spaces the next or ends the delivery.
     * The wait is the ladder's, shortened to a refused pool's window where that is sooner.
     */
    const recordFailure = (
        claimed: ClaimedDelivery,
        refusal: Refusal | null,
    ): ReleaseDeliveryAfterFailureResult => {
        const failedAt = clock();
        const ladder = new Date(failedAt.getTime() + retryDelayMs(claimed.attempts)).toISOString();
        return store.inbox.releaseDeliveryAfterFailure({
            deliveryId: claimed.deliveryId,
            claimToken: claimed.claimToken,
            failedAt: failedAt.toISOString(),
            retryNotBefore: soonerOf(ladder, refusal?.resetAt ?? null),
            maxAttempts: MAX_DELIVERY_ATTEMPTS,
        });
    };

    /** What this lane's allowance turned away while the pass ran, or `null` (D192). */
    const refusedSince = (turnedAway: number): Refusal | null => {
        if (allowance === undefined || allowance.refusals() === turnedAway) return null;
        return allowance.lastRefusal();
    };

    /**
     * The one exit a claimed delivery takes when it was not completed: the attempt is
     * counted, the next is spaced, and the delivery that STOPPED says so in a line of its own.
     */
    const notCompleted = (
        claimed: ClaimedDelivery,
        error: unknown,
        refusal: Refusal | null,
    ): PassOutcome => {
        const deliveryId = String(claimed.deliveryId);
        const release = recordFailure(claimed, refusal);
        log({
            event: "deliveryAttemptFailed",
            deliveryId,
            ...dispositionOf(release),
            ...(refusal === null ? {} : { pool: refusal.lane }),
            detail: detailOf(error),
        });
        if (release.outcome === "deadLettered") {
            log({ event: "deliveryDeadLettered", deliveryId, attempts: release.attempts });
        }
        return { kind: "failed", deliveryId, error, release };
    };

    /**
     * Station 3 onward: claim, decide, then complete.
     * A failure before completion is counted, not just released.
     */
    const attemptNext = async (): Promise<PassOutcome> => {
        const claimed = claimNext();
        if (claimed === undefined) return { kind: "idle" };
        const deliveryId = String(claimed.deliveryId);
        log({
            event: "deliveryClaimed",
            deliveryId,
            eventName: claimed.eventName,
            attempts: claimed.attempts,
        });
        const turnedAway = allowance?.refusals() ?? 0;
        try {
            const record = await recordFor(claimed);
            // A record decided around a refused read is not this delivery's answer (D192).

            const refusal = refusedSince(turnedAway);
            if (refusal !== null) {
                const spent = new Error(
                    `the webhook lane's ${refusal.lane} allowance refused a read`,
                );
                return notCompleted(claimed, spent, refusal);
            }
            const completion = store.inbox.completeDelivery({
                deliveryId: claimed.deliveryId,
                eventName: claimed.eventName,
                payloadDigest: claimed.payloadDigest,
                claimToken: claimed.claimToken,
                completedAt: clock().toISOString(),
            });
            if (completion.outcome !== "completed") {
                throw new Error(`delivery was not completed: ${completion.outcome}`);
            }
            const detail = undecidedDetail(record);
            log({
                event: "deliveryCompleted",
                deliveryId,
                kind: record.kind,
                ...(detail === undefined ? {} : { detail }),
            });
            return { kind: "completed" };
        } catch (error) {
            return notCompleted(claimed, error, refusedSince(turnedAway));
        }
    };

    return {
        /** One pass. A failed delivery still throws: the caller asked for it. */
        async processOnce(): Promise<boolean> {
            const outcome = await attemptNext();
            if (outcome.kind === "failed") throw outcome.error;
            return outcome.kind === "completed";
        },
        /**
         * Process until the queue is empty, stepping OVER a failed delivery: it is backed
         * off or dead-lettered by then. The one failure that ends the pass early is a lost claim — the attempt went uncounted, so a loop that cannot prove progress stops.
         */
        drain(): Promise<void> {
            draining ??= (async () => {
                try {
                    for (;;) {
                        const outcome = await attemptNext();
                        if (outcome.kind === "idle") return;
                        // Already logged where the store's answer was known; here it is only routing.

                        if (outcome.kind === "failed" && outcome.release.outcome === "notOwned") {
                            return;
                        }
                    }
                } finally {
                    draining = null;
                }
            })();
            return draining;
        },
        /**
         * What a shutdown waits for. It cannot be `drain()`: with no pass in flight that
         * would START one, claiming work the process is about to walk away from.
         */
        settled(): Promise<void> {
            return draining ?? Promise.resolve();
        },
        /**
         * A read, never a decision: an unanswerable source and an unparsable file are both
         * `null`, because the sweep's response to either is the same.
         */
        async configuration(
            repository: RepositoryRef,
            source?: ConfigSource,
        ): Promise<RepositoryConfig | null> {
            try {
                const loaded = await loadConfig(source ?? lane(repository).configSource);
                return loaded.result.ok ? loaded.result.config : null;
            } catch {
                return null;
            }
        },
    };
}
