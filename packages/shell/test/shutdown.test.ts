/**
 * The order a signal stops the shell in, watched step by step.
 *
 * Every step is a seam, so the sequence is a list this file can read rather
 * than something inferred from a process that happened to exit 0 — which is
 * what a spawned shell can prove and no more. The claims here are the ones
 * the ordering exists for: nothing is accepted after the socket closes, no
 * timer claims work on the way out, the pass in flight is JOINED and never
 * restarted, the store closes after everything that writes to it, and the
 * last line is on its way out of the pipe before the process leaves.
 */

import { describe, expect, it } from "vitest";
import { createShutdown, type ShutdownParts } from "../src/shutdown.js";
import type { ShellEvent } from "../src/log.js";

/** Longer than any of these takes, short enough that a hang is a failure. */
const TEST_TIMEOUT_MS = 2_000;

interface Watched {
    /** Every seam it touched, in the order it touched them. */
    readonly steps: string[];
    readonly logged: ShellEvent[];
    /** What reached the stream, so an emptied write is visible. */
    readonly written: string[];
    readonly parts: ShutdownParts;
}

/**
 * One shutdown's world. `settled` resolves on a later turn of the loop, so
 * a sequence that failed to await it would show up as steps out of order
 * rather than as a passing test.
 */
function watched(options: { readonly storeCloseFails?: boolean } = {}): Watched {
    const steps: string[] = [];
    const logged: ShellEvent[] = [];
    const written: string[] = [];
    return {
        steps,
        logged,
        written,
        parts: {
            server: {
                close: (done) => {
                    steps.push("server.close");
                    done();
                },
                closeIdleConnections: () => steps.push("server.closeIdleConnections"),
            },
            stopSweep: () => steps.push("stopSweep"),
            settled: async () => {
                await Promise.resolve();
                steps.push("settled");
            },
            store: {
                close: () => {
                    steps.push("store.close");
                    if (options.storeCloseFails === true) {
                        throw new Error("the store would not close");
                    }
                },
            },
            log: (event) => {
                steps.push(`log:${event.event}`);
                logged.push(event);
            },
            out: {
                write: (chunk, done) => {
                    steps.push("out.write");
                    written.push(chunk);
                    done();
                },
            },
            exit: () => steps.push("exit"),
        },
    };
}

/** Signal it, then let every awaited turn of the loop run out. */
async function stop(shutdown: (signal: NodeJS.Signals) => void): Promise<void> {
    shutdown("SIGTERM");
    for (let turn = 0; turn < 10; turn++) await Promise.resolve();
}

describe("stopping in the order that loses nothing", () => {
    it(
        "closes the edge, stops the sweep, joins the pass, then closes the store",
        async () => {
            const world = watched();

            await stop(createShutdown(world.parts));

            expect(world.steps).toEqual([
                "server.close",
                "server.closeIdleConnections",
                "stopSweep",
                "settled",
                "store.close",
                "log:shutdown",
                "out.write",
                "exit",
            ]);
        },
        TEST_TIMEOUT_MS,
    );

    it(
        "says which signal it answered, once the store is already closed",
        async () => {
            const world = watched();

            const shutdown = createShutdown(world.parts);
            shutdown("SIGINT");
            for (let turn = 0; turn < 10; turn++) await Promise.resolve();

            expect(world.logged).toEqual([{ event: "shutdown", signal: "SIGINT" }]);
        },
        TEST_TIMEOUT_MS,
    );

    /**
     * A store that will not close is worth a line and nothing more: the
     * work is already committed, and a throw here would lose the shutdown
     * line and the flush behind it over a file handle the exit releases.
     */
    it(
        "reports a store it could not close, and leaves anyway",
        async () => {
            const world = watched({ storeCloseFails: true });

            await stop(createShutdown(world.parts));

            expect(world.logged).toEqual([
                {
                    event: "storeCloseFailed",
                    detail: expect.stringContaining("the store would not close"),
                },
                { event: "shutdown", signal: "SIGTERM" },
            ]);
            expect(world.steps.at(-1)).toBe("exit");
        },
        TEST_TIMEOUT_MS,
    );

    /**
     * The flush is empty on purpose — it is a place in the queue, not
     * output. Writing anything here would put bytes after the last line
     * that the operator's collector has to explain.
     */
    it(
        "leaves only once the last line has left the pipe",
        async () => {
            const world = watched();

            await stop(createShutdown(world.parts));

            expect(world.written).toEqual([""]);
            expect(world.steps.indexOf("log:shutdown")).toBeLessThan(
                world.steps.indexOf("out.write"),
            );
            expect(world.steps.indexOf("out.write")).toBeLessThan(world.steps.indexOf("exit"));
        },
        TEST_TIMEOUT_MS,
    );

    /** A second signal during a shutdown is impatience, not new information. */
    it(
        "answers a second signal with nothing: the store closes once",
        async () => {
            const world = watched();
            const shutdown = createShutdown(world.parts);

            shutdown("SIGTERM");
            shutdown("SIGINT");
            for (let turn = 0; turn < 10; turn++) await Promise.resolve();
            shutdown("SIGTERM");
            for (let turn = 0; turn < 10; turn++) await Promise.resolve();

            expect(world.steps.filter((step) => step === "store.close")).toEqual(["store.close"]);
            expect(world.logged).toEqual([{ event: "shutdown", signal: "SIGTERM" }]);
            expect(world.steps.filter((step) => step === "exit")).toEqual(["exit"]);
        },
        TEST_TIMEOUT_MS,
    );
});
