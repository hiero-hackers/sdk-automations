/**
 * The worker half: claim a durable delivery, prepare, reject an unsupported
 * mode or call the one verb, then commit the outcome with completion. The
 * receiver acknowledged long ago; GitHub never observes retries here.
 *
 * `process` below is the right lane of design/trace.md stations 3–12,
 * one named step per station.
 */

import {
    decide,
    parseConfigDocument,
    type ConfigResult,
    type ConfigError,
    type Decision,
    type EngineCapability,
    type Report,
    type RepositoryConfig,
    type RepositoryRef,
} from "@hiero-hackers/automation-core";
import type { ClaimedDelivery, Store } from "@hiero-hackers/automation-store";
import type { ConfigSource } from "./config.js";
import type { ShellExternals } from "./externals.js";

/** A processing claim older than this is presumed dead and taken over. */
const STALE_CLAIM_MINUTES = 15;

/** Dependencies and operator hooks for one durable delivery worker. */
export interface ProcessorOptions {
    readonly store: Store;
    readonly capabilities: readonly EngineCapability[];
    readonly configSource: ConfigSource;
    readonly externals: ShellExternals;
    /**
     * The shell's routing knowledge (`DecideInput` asks for it): the one
     * repository this endpoint serves. When a payload is readable the
     * engine names the repository from the observation instead; this is
     * the name an unreadable delivery's report carries.
     */
    readonly repository: RepositoryRef;
    readonly worker: string;
    readonly clock: () => Date;
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
      });

export class Processor {
    private draining: Promise<void> | null = null;

    constructor(private readonly options: ProcessorOptions) {}

    /**
     * Station 3 onward: claim, decide, then atomically persist-and-complete.
     * Failures before canonical completion release the claim.
     */
    async processOnce(): Promise<boolean> {
        const claimed = this.claimNext();
        if (claimed === undefined) return false;
        try {
            const record = await this.process(claimed);
            const completion = this.options.store.completeDeliveryWithReport({
                deliveryId: claimed.deliveryId,
                eventName: claimed.eventName,
                payloadDigest: claimed.payloadDigest,
                claimToken: claimed.claimToken,
                reportJson: JSON.stringify(record),
                completedAt: this.options.clock().toISOString(),
            });
            if (completion.outcome !== "completed") {
                throw new Error(`delivery report was not committed: ${completion.outcome}`);
            }
            return true;
        } catch (error) {
            this.options.store.releaseDelivery(claimed.deliveryId, claimed.claimToken);
            throw error;
        }
    }

    /** Process until the queue is empty. Overlapping calls share one loop. */
    drain(): Promise<void> {
        this.draining ??= (async () => {
            try {
                while (await this.processOnce());
            } finally {
                this.draining = null;
            }
        })();
        return this.draining;
    }

    /** Build one delivery's canonical record, stations 4–11 in reading order. */
    private async process(claimed: ClaimedDelivery): Promise<ShellRecord> {
        const config = await this.loadConfig();
        // One instant serves as the record's `decidedAt` AND the gates'
        // clock, so the journal never disagrees with the decision it holds.
        const decidedAt = this.options.clock();
        const identity = this.identify(claimed, config.revision, decidedAt);

        if (!config.result.ok) {
            // Fail closed and COMPLETE: redelivering cannot fix a broken
            // config — the fixed file arrives as its own future delivery.
            return {
                kind: "configRejected",
                ...identity,
                errors: config.result.errors,
            };
        }

        if (config.result.config.mode === "active") {
            return {
                kind: "modeUnsupported",
                ...identity,
                reason: "active mode is unsupported by the runnable shell",
            };
        }

        const decision = await this.decideOn(claimed, config.result.config);
        return {
            kind: "decision",
            ...identity,
            report: decision.report,
        };
    }

    private claimNext(): ClaimedDelivery | undefined {
        const now = this.options.clock();
        const staleBefore = new Date(now.getTime() - STALE_CLAIM_MINUTES * 60_000);
        return this.options.store.claimNextDelivery(
            this.options.worker,
            now.toISOString(),
            staleBefore.toISOString(),
        );
    }

    /** Station 4: fetch the text, parse it. Every rejection is a value —
     * nothing downstream ever sees a half-read configuration. */
    private async loadConfig(): Promise<{
        readonly revision: string;
        readonly result: ConfigResult;
    }> {
        const document = await this.options.configSource.load();
        return {
            revision: document.revision,
            result: parseConfigDocument(document.text, {
                revision: document.revision,
                knownCapabilities: this.options.capabilities.map((c) => c.declaration.name),
            }),
        };
    }

    private identify(
        claimed: ClaimedDelivery,
        configRevision: string,
        decidedAt: Date,
    ): RecordIdentity {
        return {
            deliveryId: claimed.deliveryId as string,
            event: claimed.eventName,
            receivedAt: claimed.receivedAt,
            decidedAt: decidedAt.toISOString(),
            configRevision,
        };
    }

    /** Stations 5–10 live behind this one call: normalize, evaluate,
     * screen, derive the world, gate. The shell's contribution ends at
     * the parenthesis. */
    private decideOn(claimed: ClaimedDelivery, config: RepositoryConfig): Promise<Decision> {
        return decide(
            {
                kind: "delivery",
                repository: this.options.repository,
                event: claimed.eventName,
                payload: parsePayload(claimed.payload),
            },
            config,
            this.options.capabilities,
            this.options.externals,
        );
    }
}

/**
 * Invalid JSON flows onward as an unreadable payload — the normalizer's
 * `payloadNotObject` names it in the report; the shell has no opinion.
 */
function parsePayload(bytes: Uint8Array): unknown {
    try {
        return JSON.parse(Buffer.from(bytes).toString("utf8"));
    } catch {
        return undefined;
    }
}
