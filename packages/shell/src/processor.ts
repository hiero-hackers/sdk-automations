/**
 * The worker half: claim a durable delivery, prepare, reject an unsupported
 * mode or call the one verb, apply what it approved, then commit the outcome
 * with completion. The receiver acknowledged long ago; GitHub never observes
 * retries here.
 *
 * The reading key: a claimed delivery always ends as exactly ONE of four
 * records — `repositoryMismatch`, `configRejected`, `modeUnsupported`, or
 * a decision — and there is no fifth exit. The try/catch in `attemptNext`
 * is routing, not handling: any throw becomes a counted failed attempt,
 * and the retry policy above IS the recovery logic — a bounded, spaced
 * reclaim, ending in the store's dead letter when the budget runs out.
 *
 * `recordFor` below is stations ③ to ⑤ of this package's README table,
 * one named step per station, plus the applier this file hands the approved
 * effects to while the delivery's claim is still held (`apply.ts`).
 */

import {
    decide,
    parseConfigDocument,
    repositoryNamedBy,
    UNREADABLE_CONFIG_REVISION,
    type ConfigResult,
    type ConfigError,
    type Decision,
    type EngineCapability,
    type Report,
    type RepositoryConfig,
    type RepositoryRef,
} from "@hiero-hackers/automation-core";
import type {
    ClaimedDelivery,
    ReleaseDeliveryAfterFailureResult,
    Store,
} from "@hiero-hackers/automation-store";
import type { Applier } from "./apply.js";
import type { ConfigSource } from "./config.js";
import type { EffectOutcome } from "./effects.js";
import type { ExternalsForDelivery } from "./externals.js";
import { detailOf, type Log } from "./log.js";

/**
 * A processing claim older than this is presumed dead and taken over.
 * Exported for the sweep in `shell.ts`, which requeues on the same clock.
 */
export const STALE_CLAIM_MINUTES = 15;

/**
 * The retry bounds. A delivery that keeps failing gets five attempts in
 * all, waiting 30s, 60s, 120s and 240s between them.
 *
 * Thirty seconds is longer than the blips this worker actually meets — a
 * config read that lost its token, externals answering unavailable — and
 * five attempts spread over about eight minutes outlast most of them
 * without holding a delivery for an afternoon. The hourly ceiling is a
 * bound on the doubling rather than a number this schedule reaches; it
 * only binds if the attempt budget is raised.
 */
const MAX_DELIVERY_ATTEMPTS = 5;
const RETRY_BASE_MS = 30_000;
const RETRY_CEILING_MS = 60 * 60_000;

/** The wait a delivery earns after `attempts` failures, doubling each time. */
function retryDelayMs(attempts: number): number {
    return Math.min(RETRY_BASE_MS * 2 ** attempts, RETRY_CEILING_MS);
}

/** Dependencies and operator hooks for one durable delivery worker. */
export interface ProcessorOptions {
    readonly store: Store;
    readonly capabilities: readonly EngineCapability[];
    readonly configSource: ConfigSource;
    readonly externals: ExternalsForDelivery;
    /**
     * The shell's routing knowledge (`DecideInput` asks for it): the one
     * repository this endpoint serves. It is the name an unreadable
     * delivery's report carries, and — see `recordFor` — the name every
     * readable payload is held to.
     */
    readonly repository: RepositoryRef;
    readonly worker: string;
    readonly clock: () => Date;
    /** Every line here names its delivery: this is the lane that retries. */
    readonly log: Log;
    /**
     * The write path, when a composition root has wired one.
     *
     * Absent is the shipped composition. `main.ts` supplies no applier, so
     * `mode: active` still ends as `modeUnsupported` before `decide()` runs —
     * the shell genuinely has no effect path, which is what that record has
     * always said. Wiring one is how the gate lifts, and that is stage E's
     * decision to make at the composition root rather than a branch anyone
     * deletes here.
     */
    readonly applier?: Applier;
}

/** What every persisted record says about which delivery it answers. */
interface RecordIdentity {
    readonly deliveryId: string;
    readonly event: string;
    readonly receivedAt: string;
    readonly decidedAt: string;
    readonly configRevision: string;
}

/** The canonical shell record persisted for one delivery. */
type ShellRecord =
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
          /** The payload names a repository this endpoint does not serve. */
          readonly kind: "repositoryMismatch";
          /** `owner/repo`, as configured and as the payload named it. */
          readonly expected: string;
          readonly observed: string;
      });

/**
 * Stamped when a record was reached without consulting the configuration,
 * as `repositoryMismatch` is: the file of a repository this endpoint does
 * not serve is not the file that would have been read.
 */
const CONFIG_NOT_CONSULTED_REVISION = "sha256:unconsulted";

/**
 * Invalid JSON flows onward as an unreadable payload — the normalizer's
 * `payloadNotObject` names it in the report; the shell has no opinion.
 */
function parsePayload(bytes: Uint8Array): unknown {
    try {
        return JSON.parse(Buffer.from(bytes).toString("utf8"));
        // Stryker disable next-line BlockStatement: an emptied catch falls through to the same implicit undefined — the mutant is equivalent.
    } catch {
        return undefined;
    }
}

/**
 * The `owner/repo` a payload names, spelled for a record — reading via
 * core's `repositoryNamedBy` so the three field reads live once, beside
 * the normalizer that owns them.
 */
function repositorySpelledBy(payload: unknown): string | null {
    const named = repositoryNamedBy(payload);
    return named === null ? null : `${named.owner}/${named.repo}`;
}

/**
 * Case-insensitively, because GitHub's names are: no two repositories
 * differ only in case, so a differently-cased `REPO_OWNER` names the same
 * repository and refusing it would refuse the truth.
 */
function sameRepository(named: string, served: string): boolean {
    return named.toLowerCase() === served.toLowerCase();
}

/** What the worker exposes: one pass, or pump until the queue is empty. */
export interface Processor {
    processOnce(): Promise<boolean>;
    drain(): Promise<void>;
    /** The drain in flight, if any; resolved at once when none is. */
    settled(): Promise<void>;
    /**
     * The current configuration as this lane reads it, or `null` when it
     * cannot be read or does not parse.
     *
     * Exposed for the sweep's effect recovery, which has to gate a resend on
     * the same file the deliveries are gated on. A second reader with its own
     * source and its own parser would be the one fact in two places this
     * repository keeps finding — and the two could disagree about whether a
     * repository is still in active mode, which is the disagreement that
     * writes to GitHub.
     */
    configuration(): Promise<RepositoryConfig | null>;
}

/**
 * What one claimed-and-carried delivery came to. The failure case is a
 * VALUE because the drain has to keep going after it, and needs to know
 * what the store made of the failure to decide whether it can.
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
 *
 * `attempts` is `null` for exactly one disposition: a lost claim counts
 * nothing, so reporting a number there would invent one.
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

export function createProcessor(options: ProcessorOptions): Processor {
    const {
        store,
        capabilities,
        configSource,
        externals,
        repository,
        worker,
        clock,
        log,
        applier,
    } = options;
    let draining: Promise<void> | null = null;

    const claimNext = (): ClaimedDelivery | undefined => {
        const now = clock();
        const staleBefore = new Date(now.getTime() - STALE_CLAIM_MINUTES * 60_000);
        return store.claimNextDelivery(worker, now.toISOString(), staleBefore.toISOString());
    };

    /** Station 4: fetch the text, parse it. Every rejection is a value —
     * nothing downstream ever sees a half-read configuration. */
    const loadConfig = async (): Promise<{
        readonly revision: string;
        readonly result: ConfigResult;
    }> => {
        const loaded = await configSource.load();
        if (!loaded.ok) {
            if (loaded.permanent) {
                // Fail closed and COMPLETE, exactly like a config that
                // parses wrong: redelivering cannot fix a defective file.
                return {
                    revision: loaded.revision ?? UNREADABLE_CONFIG_REVISION,
                    result: {
                        ok: false,
                        // documentUnparseable, not a new code: the error
                        // catalogue only admits codes a DOCUMENT can reach
                        // (D76's demonstration rule), and an unreadable file
                        // is the parse failure's upstream twin. The message
                        // carries which one it was.
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
            // Transient: the throw costs the delivery one attempt and
            // schedules the next. A config that is unreachable for good
            // therefore dead-letters instead of retrying without end.
            throw new Error(`configuration unavailable: ${loaded.detail}`);
        }
        const { document } = loaded;
        return {
            revision: document.revision,
            result: parseConfigDocument(document.text, {
                revision: document.revision,
                // Full declarations, not names: the parser holds settings
                // keys to configKeys and enabling to requiredMeanings.
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

    /** Stations 5–10 live behind this one call: normalize, evaluate,
     * screen, derive the world, gate. The shell's contribution ends at
     * the parenthesis. */
    const decideOn = async (
        claimed: ClaimedDelivery,
        payload: unknown,
        config: RepositoryConfig,
    ): Promise<Decision> => {
        // Built per delivery: the live path binds its ordering-evidence
        // memo to exactly this delivery. A rejection here is a counted
        // failed attempt, like any other failure before completion.
        return decide(
            { kind: "delivery", repository, event: claimed.eventName, payload },
            config,
            capabilities,
            await externals({ payload, deliveryId: String(claimed.deliveryId) }),
        );
    };

    const served = `${repository.owner}/${repository.repo}`;

    /**
     * Build one delivery's canonical record, stations ③ to ⑤ in reading
     * order — after the one question no station asks.
     *
     * The repository comes FIRST, before the configuration is even read.
     * This endpoint serves exactly one repository, and a payload naming
     * another is a permanent property of the delivery's own bytes: it must
     * end the delivery whatever the config source is doing, or a config
     * outage would turn a refusal into four retries and a dead letter. It
     * mislabels a report today; the day active mode lands it would be
     * write authority over a repository nobody configured.
     */
    const recordFor = async (claimed: ClaimedDelivery): Promise<ShellRecord> => {
        const payload = parsePayload(claimed.payload);
        const named = repositorySpelledBy(payload);
        if (named !== null && !sameRepository(named, served)) {
            return {
                kind: "repositoryMismatch",
                ...identityFor(claimed, CONFIG_NOT_CONSULTED_REVISION, clock()),
                expected: served,
                observed: named,
            };
        }
        const config = await loadConfig();
        // One instant serves as the record's `decidedAt` AND the gates'
        // clock, so the journal never disagrees with the decision it holds.
        const identity = identityFor(claimed, config.revision, clock());

        if (!config.result.ok) {
            // Fail closed and COMPLETE: redelivering cannot fix a broken
            // config — the fixed file arrives as its own future delivery.
            return { kind: "configRejected", ...identity, errors: config.result.errors };
        }
        const active = config.result.config.mode === "active";
        if (active && applier === undefined) {
            return {
                kind: "modeUnsupported",
                ...identity,
                reason: "active mode is unsupported by the runnable shell",
            };
        }
        const decision = await decideOn(claimed, payload, config.result.config);
        // Station 6: the approved effects, applied while this delivery's claim
        // is still held. Only in active mode — nothing else ever approves one,
        // and saying so here means a future mode cannot acquire a write path
        // by accident.
        const effects =
            active && applier !== undefined
                ? await applier.applyAll(decision.approved, config.result.config)
                : [];
        return { kind: "decision", ...identity, report: decision.report, effects };
    };

    /**
     * Count one failed attempt against this claim, which either spaces the
     * next one or ends the delivery as a dead letter. The wait is derived
     * from the attempts the claim arrived with, so a delivery that keeps
     * failing backs off instead of being re-claimed on every drain.
     */
    const recordFailure = (claimed: ClaimedDelivery): ReleaseDeliveryAfterFailureResult => {
        const failedAt = clock();
        return store.releaseDeliveryAfterFailure({
            deliveryId: claimed.deliveryId,
            claimToken: claimed.claimToken,
            failedAt: failedAt.toISOString(),
            retryNotBefore: new Date(
                failedAt.getTime() + retryDelayMs(claimed.attempts),
            ).toISOString(),
            maxAttempts: MAX_DELIVERY_ATTEMPTS,
        });
    };

    /**
     * Station 3 onward: claim, decide, then atomically persist-and-complete.
     * A failure before canonical completion is counted, not just released:
     * a delivery nothing can process spends its budget and dead-letters
     * rather than being retried forever.
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
        try {
            const record = await recordFor(claimed);
            const completion = store.completeDeliveryWithReport({
                deliveryId: claimed.deliveryId,
                eventName: claimed.eventName,
                payloadDigest: claimed.payloadDigest,
                claimToken: claimed.claimToken,
                reportJson: JSON.stringify(record),
                completedAt: clock().toISOString(),
            });
            if (completion.outcome !== "completed") {
                throw new Error(`delivery report was not committed: ${completion.outcome}`);
            }
            log({ event: "deliveryCompleted", deliveryId, kind: record.kind });
            return { kind: "completed" };
        } catch (error) {
            const release = recordFailure(claimed);
            log({
                event: "deliveryAttemptFailed",
                deliveryId,
                ...dispositionOf(release),
                detail: detailOf(error),
            });
            // A second line, because this is where a delivery STOPS: the
            // one an operator greps for is not one of five failed attempts.
            if (release.outcome === "deadLettered") {
                log({ event: "deliveryDeadLettered", deliveryId, attempts: release.attempts });
            }
            return { kind: "failed", deliveryId, error, release };
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
         * Process until the queue is empty, stepping OVER a delivery that
         * failed: it is backed off or dead-lettered by then, so the queue
         * behind it moves. Overlapping calls share one loop.
         *
         * The one failure that ends the pass early is a lost claim. The
         * attempt went uncounted, so the same delivery can be handed back
         * immediately, and a loop that cannot prove progress should stop
         * rather than spin — the next drain starts from a fresh claim.
         */
        drain(): Promise<void> {
            draining ??= (async () => {
                try {
                    for (;;) {
                        const outcome = await attemptNext();
                        if (outcome.kind === "idle") return;
                        // The failure is already logged, where the store's
                        // answer to it was known; here it is only a routing
                        // question — can this pass prove progress?
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
         * What a shutdown waits for. It cannot be `drain()`: with no pass
         * in flight that would START one, claiming work the process is
         * about to walk away from — the stranded claim this exists to
         * prevent.
         */
        settled(): Promise<void> {
            return draining ?? Promise.resolve();
        },
        /**
         * A read, never a decision: a source that cannot answer and a file
         * that does not parse are both `null`, because the sweep's response to
         * either is the same — gate nothing on a configuration nobody could
         * read, and try again next tick.
         */
        async configuration(): Promise<RepositoryConfig | null> {
            try {
                const loaded = await loadConfig();
                return loaded.result.ok ? loaded.result.config : null;
            } catch {
                return null;
            }
        },
    };
}
