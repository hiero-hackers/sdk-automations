/**
 * The composition root: receiver + store + processor wired into one
 * running shell. Every box is existing, gated code — this file's whole
 * contribution is ORDER: verify before accept, accept before ack, decide
 * before act, then atomically commit the canonical report and completion.
 *
 * Plus one clock. A webhook arrival is the only other thing that ever
 * drains, so work a drain left behind — a stale claim from a killed
 * worker, a delivery waiting out its backoff, an effect whose answer was
 * lost between the send and the acknowledgement — would sit until the next
 * delivery happened to arrive. The sweep is what makes those recover on
 * their own in a quiet repository.
 */

import { createServer, type Server } from "node:http";
import {
    validateCapabilityDeclarations,
    type EngineCapability,
    type RepositoryRef,
} from "@hiero-hackers/automation-core";
import type { Store } from "@hiero-hackers/automation-store";
import { createReceiver } from "./receiver.js";
import { createProcessor, STALE_CLAIM_MINUTES } from "./processor.js";
import { EFFECT_LEASE_STALE_MINUTES, type Applier } from "./apply.js";
import type { ConfigSource } from "./config.js";
import type { ExternalsForDelivery } from "./externals.js";
import { contained, createLogger, detailOf, type Log } from "./log.js";

/** How often the shell requeues stale claims and drains, absent an override. */
export const DEFAULT_SWEEP_INTERVAL_MS = 60_000;

/**
 * How long one connection may hold the edge open. Node's defaults are 300s
 * for a whole request and 60s for its headers, which is a slow-loris budget
 * rather than a webhook's.
 *
 * GitHub abandons a delivery it has not been answered within about ten
 * seconds and redelivers later, so a body still arriving after thirty is
 * one nobody is waiting for; cutting it costs a redelivery this shell was
 * built to absorb. Headers arrive in the first segment or not at all, so
 * ten seconds is already generous, and it is the header phase a loris
 * spends its connections on.
 */
const REQUEST_TIMEOUT_MS = 30_000;
const HEADERS_TIMEOUT_MS = 10_000;

export interface ShellOptions {
    readonly secret: string;
    readonly store: Store;
    readonly capabilities: readonly EngineCapability[];
    readonly configSource: ConfigSource;
    readonly externals: ExternalsForDelivery;
    readonly repository: RepositoryRef;
    readonly worker?: string;
    readonly clock?: () => Date;
    readonly sweepIntervalMs?: number;
    /**
     * The write path, when one is wired. See `ProcessorOptions.applier`: with
     * none, active mode is still refused before `decide()` and the sweep's
     * recovery pass has nothing to recover with.
     */
    readonly applier?: Applier;
    /**
     * Where the receiver, the processor and the sweep say what they did.
     * Optional here and required of both of them: this is the composition
     * root's own seam, so it defaults to the production log rather than to
     * silence, and a component that forgot to take one cannot compile.
     */
    readonly log?: Log;
}

export interface Shell {
    readonly server: Server;
    /** Pump everything pending — exposed so tests and operators drain deterministically. */
    drain(): Promise<void>;
    /**
     * The drain in flight, if there is one. Starts no work: a shutdown
     * joins the pass that already holds a claim rather than beginning
     * another one it would have to abandon.
     */
    settled(): Promise<void>;
    /** Stop the sweep. The server stays the caller's to close. */
    stopSweep(): void;
}

export function createShell(options: ShellOptions): Shell {
    const errors = validateCapabilityDeclarations(
        options.capabilities.map(({ declaration }) => declaration),
    );
    if (errors.length > 0) {
        throw new Error(`invalid capability declarations: ${errors.join("; ")}`);
    }
    const clock = options.clock ?? (() => new Date());
    const log = contained(options.log ?? createLogger({ clock }));
    const processor = createProcessor({
        store: options.store,
        capabilities: options.capabilities,
        configSource: options.configSource,
        externals: options.externals,
        repository: options.repository,
        worker: options.worker ?? "shell-1",
        clock,
        log,
        ...(options.applier === undefined ? {} : { applier: options.applier }),
    });
    const handler = createReceiver({
        secret: options.secret,
        log,
        accept: ({ deliveryId, eventName, payload }) =>
            options.store.acceptDelivery({
                deliveryId,
                eventName,
                payload,
                receivedAt: clock().toISOString(),
            }).outcome,
        onAccepted: () => {
            void processor.drain().catch((error: unknown) => {
                log({ event: "drainFailed", phase: "accepted", detail: detailOf(error) });
            });
        },
    });
    /**
     * The effects a worker journalled and never closed.
     *
     * The window is one lease: a row younger than that may still belong to a
     * pass that is running right now, and the lease is what serialises the two
     * anyway — asking about them would only be work the claim refuses. Every
     * row is re-driven through the applier's own dispatch, which reads GitHub
     * before it resends anything, so a sweep can never turn a landed write
     * into a second one.
     *
     * Nothing happens without a configuration this run could read: a resend is
     * gated on the repository still being in active mode, and a config outage
     * is not a repository saying yes.
     */
    const recoverEffects = async (): Promise<void> => {
        const applier = options.applier;
        if (applier === undefined) return;
        const before = new Date(clock().getTime() - EFFECT_LEASE_STALE_MINUTES * 60_000);
        const open = options.store.openIntents(before.toISOString());
        if (open.length === 0) return;
        const config = await processor.configuration();
        if (config === null) return;
        for (const row of open) await applier.recover(row, config);
    };

    /**
     * One tick: hand back claims their worker died holding, resolve the
     * effects nobody closed, then pump.
     *
     * Contained, because a tick that throws inside a timer callback takes
     * the process down, and a store that cannot be swept is a thing to
     * report rather than a reason to stop serving webhooks. Overlapping
     * ticks are already harmless: the processor's drain shares one loop, and
     * an effect's lease admits one worker at a time.
     */
    const sweep = (): void => {
        try {
            const staleBefore = new Date(clock().getTime() - STALE_CLAIM_MINUTES * 60_000);
            const requeued = options.store.requeueStuckDeliveries(staleBefore.toISOString());
            // A sweep that requeued nothing changed nothing, and a line
            // every interval forever would bury the ones that did.
            if (requeued.length > 0) {
                log({
                    event: "sweepRequeued",
                    requeued: requeued.length,
                    deliveryIds: requeued.map(String),
                });
            }
        } catch (error) {
            log({ event: "sweepFailed", detail: detailOf(error) });
            return;
        }
        void recoverEffects().catch((error: unknown) => {
            log({ event: "sweepFailed", detail: detailOf(error) });
        });
        void processor.drain().catch((error: unknown) => {
            log({ event: "drainFailed", phase: "sweep", detail: detailOf(error) });
        });
    };
    const ticking = setInterval(sweep, options.sweepIntervalMs ?? DEFAULT_SWEEP_INTERVAL_MS);
    // The sweep is recovery, never a reason for the process to stay alive.
    // Stryker disable next-line CallExpression: unref only decides whether an otherwise-idle event loop keeps running; nothing in this process can observe it, and the shell's own exit is explicit.
    ticking.unref();

    const server = createServer(handler);
    server.requestTimeout = REQUEST_TIMEOUT_MS;
    server.headersTimeout = HEADERS_TIMEOUT_MS;

    return {
        server,
        drain: () => processor.drain(),
        settled: () => processor.settled(),
        stopSweep: () => {
            clearInterval(ticking);
        },
    };
}
