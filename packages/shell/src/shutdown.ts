/**
 * Stop in the order that loses nothing.
 *
 * The socket closes first, because a delivery accepted after this point
 * would be one nothing left in the process will drain. Idle keep-alive
 * connections are closed with it: they hold no request, and waiting out
 * their timeout would only spend the shutdown budget. The sweep stops
 * next, so no timer claims fresh work on the way out.
 *
 * Then the pass already in flight is joined — NOT a new drain, which
 * would claim exactly the work being abandoned. A claim the process dies
 * holding is invisible for the full fifteen-minute stale window, and that
 * window is the whole cost this ordering buys off; anything still queued
 * is durable and waits for the next start.
 *
 * The store closes last, because every step above it writes.
 *
 * A separate file from the composition root because the ORDER above is the
 * whole product here, and an order nothing can watch is an order nobody can
 * check. Every step arrives as a seam, so a test reads the sequence directly
 * rather than inferring it from a process that exited.
 */

import { detailOf, type Log } from "./log.js";

/** Everything a shutdown touches, in the order it touches them. */
export interface ShutdownParts {
    /**
     * The edge. `close` stops accepting at once and answers when the LAST
     * connection has left, which is what the join below waits behind.
     */
    readonly server: {
        close(done: () => void): void;
        closeIdleConnections(): void;
    };
    readonly stopSweep: () => void;
    /** The pass already in flight, if any. Never one this starts. */
    readonly settled: () => Promise<void>;
    readonly store: { close(): void };
    readonly log: Log;
    /**
     * Where the last line went. A write to a pipe is asynchronous and an
     * exit truncates whatever is still queued, so leaving waits behind a
     * callback of its own — stream callbacks run in order.
     */
    readonly out: { write(chunk: string, done: () => void): unknown };
    readonly exit: () => void;
}

export function createShutdown(parts: ShutdownParts): (signal: NodeJS.Signals) => void {
    const { server, stopSweep, settled, store, log, out, exit } = parts;
    let stopping = false;
    return (signal) => {
        // A second signal during a shutdown is impatience, not new information.
        if (stopping) return;
        stopping = true;
        void (async () => {
            const closed = new Promise<void>((resolve) => {
                server.close(() => resolve());
                server.closeIdleConnections();
            });
            stopSweep();
            await closed;
            await settled();
            try {
                store.close();
            } catch (error) {
                log({ event: "storeCloseFailed", detail: detailOf(error) });
            }
            log({ event: "shutdown", signal });
            out.write("", () => {
                exit();
            });
        })();
    };
}
