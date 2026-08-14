/**
 * The composition root: receiver + store + processor wired into one
 * running shell. Every box is existing, gated code — this file's whole
 * contribution is ORDER: verify before accept, accept before ack, decide
 * before act, then atomically commit the canonical report and completion.
 */

import { createServer, type Server } from "node:http";
import {
    validateCapabilityDeclarations,
    type EngineCapability,
    type RepositoryRef,
} from "@hiero-hackers/automation-core";
import type { Store } from "@hiero-hackers/automation-store";
import { createReceiver } from "./receiver.js";
import { Processor } from "./processor.js";
import type { ConfigSource } from "./config.js";
import type { ShellExternals } from "./externals.js";

export interface ShellOptions {
    readonly secret: string;
    readonly store: Store;
    readonly capabilities: readonly EngineCapability[];
    readonly configSource: ConfigSource;
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
    const errors = validateCapabilityDeclarations(
        options.capabilities.map(({ declaration }) => declaration),
    );
    if (errors.length > 0) {
        throw new Error(`invalid capability declarations: ${errors.join("; ")}`);
    }
    const clock = options.clock ?? (() => new Date());
    const processor = new Processor({
        store: options.store,
        capabilities: options.capabilities,
        configSource: options.configSource,
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
                console.error("shell: processing failed; inspect durable store state", error);
            });
        },
    });
    return {
        server: createServer(handler),
        drain: () => processor.drain(),
    };
}
