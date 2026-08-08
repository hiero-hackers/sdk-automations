/**
 * The worker half: claim a durable delivery, prepare, call the one verb,
 * persist the outcome, complete. The receiver acknowledged long ago —
 * everything here may crash and retry without GitHub ever knowing.
 *
 * `process` below is the right lane of design/trace.md stations 3–12,
 * one named step per station.
 */

import {
    decide,
    parseConfigDocument,
    type ConfigResult,
    type Decision,
    type EngineCapability,
    type RepositoryConfig,
    type RepositoryRef,
} from "@hiero-hackers/automation-core";
import type { ClaimedDelivery, Store } from "@hiero-hackers/automation-store";
import type { ConfigSource } from "./config.js";
import type { ReportSink } from "./reports.js";
import type { ShellExternals } from "./externals.js";

/** A processing claim older than this is presumed dead and taken over. */
const STALE_CLAIM_MINUTES = 15;

export interface ProcessorOptions {
    readonly store: Store;
    readonly capabilities: readonly EngineCapability[];
    readonly configSource: ConfigSource;
    readonly reports: ReportSink;
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

export class Processor {
    private draining: Promise<void> | null = null;

    constructor(private readonly options: ProcessorOptions) {}

    /** Station 3: claim one pending delivery; `false` when the queue is
     * empty. A crash mid-process RELEASES the claim — the delivery stays
     * durable and the next drain retries it. */
    async processOnce(): Promise<boolean> {
        const claimed = this.claimNext();
        if (claimed === undefined) return false;
        try {
            await this.process(claimed);
        } catch (error) {
            this.options.store.releaseDelivery(claimed.deliveryId, claimed.claimToken);
            throw error;
        }
        this.options.store.completeDelivery(
            claimed.deliveryId,
            claimed.claimToken,
            this.options.clock().toISOString(),
        );
        return true;
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

    /** One delivery, stations 4–12, in reading order. */
    private async process(claimed: ClaimedDelivery): Promise<void> {
        const config = await this.loadConfig();
        // One instant serves as the record's `decidedAt` AND the gates'
        // clock, so the journal never disagrees with the decision it holds.
        const decidedAt = this.options.clock();
        const identity = this.identify(claimed, config.revision, decidedAt);

        if (!config.result.ok) {
            // Fail closed and COMPLETE: redelivering cannot fix a broken
            // config — the fixed file arrives as its own future delivery.
            this.options.reports.record({
                kind: "configRejected",
                ...identity,
                errors: config.result.errors,
            });
            return;
        }

        const decision = await this.decideOn(claimed, config.result.config, decidedAt);
        this.options.reports.record({
            kind: "decision",
            ...identity,
            report: decision.report,
            approved: decision.approved,
        });
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
    private decideOn(
        claimed: ClaimedDelivery,
        config: RepositoryConfig,
        now: Date,
    ): Promise<Decision> {
        return decide(
            {
                kind: "delivery",
                repository: this.options.repository,
                event: claimed.eventName,
                payload: parsePayload(claimed.payload),
            },
            config,
            this.options.capabilities,
            { ...this.options.externals, now },
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
