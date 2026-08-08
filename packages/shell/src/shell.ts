/**
 * The composition root: receiver + store + processor wired into one
 * running shell. Every box is existing, gated code — this file's whole
 * contribution is ORDER: verify before accept, accept before ack, decide
 * before act, report always.
 */

import { createServer, type Server } from "node:http";
import type { EngineCapability, RepositoryRef } from "@hiero-hackers/automation-core";
import type { Store } from "@hiero-hackers/automation-store";
import { createReceiver } from "./receiver.js";
import { Processor } from "./processor.js";
import type { ConfigSource } from "./config.js";
import type { ReportSink } from "./reports.js";
import type { ShellExternals } from "./externals.js";

export interface ShellOptions {
    readonly secret: string;
    readonly store: Store;
    readonly capabilities: readonly EngineCapability[];
    readonly configSource: ConfigSource;
    readonly reports: ReportSink;
    readonly externals: ShellExternals;
    readonly repository: RepositoryRef;
    readonly worker?: string;
    readonly clock?: () => Date;
}

export interface Shell {
    readonly server: Server;
    /** Pump everything pending — exposed so tests and operators drain deterministically. */
    drain(): Promise<void>;
}

export function createShell(options: ShellOptions): Shell {
    const clock = options.clock ?? (() => new Date());
    const processor = new Processor({
        store: options.store,
        capabilities: options.capabilities,
        configSource: options.configSource,
        reports: options.reports,
        externals: options.externals,
        repository: options.repository,
        worker: options.worker ?? "shell-1",
        clock,
    });
    const handler = createReceiver({
        secret: options.secret,
        accept: ({ deliveryId, eventName, payload }) =>
            options.store.acceptDelivery({
                deliveryId,
                eventName,
                payload,
                receivedAt: clock().toISOString(),
            }).outcome,
        onAccepted: () => {
            void processor.drain().catch((error) => {
                // The delivery is durable and released; the next drain retries.
                console.error("shell: processing failed; delivery remains pending", error);
            });
        },
    });
    return {
        server: createServer(handler),
        drain: () => processor.drain(),
    };
}
