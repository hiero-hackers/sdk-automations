/**
 * The sweep's cursor between Action runs (D248): each run's store is fresh, so a pass that stops
 * short is continued only through the file the workflow's cache carries to the next run.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { writeFileSync } from "node:fs";
import { configFor, useTempDir } from "@hiero-hackers/automation-testkit";
import { keepCursor, readCursor } from "../../../src/shell/compose/action/cursor.js";
import {
    parseActionEnvironment,
    type ActionRun,
} from "../../../src/shell/compose/action/inputs.js";
import { runAction, runStore, type RunOutcome } from "../../../src/shell/compose/action/run.js";
import type { ShellEvent } from "../../../src/shell/log.js";
import { scriptedGitHub } from "./scripted-github.js";

const START = new Date("2026-09-15T10:00:00.000Z");
const temp = useTempDir("action-cursor-");

afterEach(() => {
    vi.unstubAllGlobals();
});

function scheduledRun(): ActionRun {
    const parsed = parseActionEnvironment({
        GITHUB_REPOSITORY: "scrubbed-1/scrubbed-2",
        GITHUB_EVENT_NAME: "schedule",
        GITHUB_EVENT_PATH: "/tmp/event.json",
        INPUT_TOKEN: "runner-token",
        GITHUB_RUN_ID: "42",
    });
    if (!parsed.ok) throw new Error(parsed.errors.join("; "));
    return parsed.run;
}

/** GitHub reporting a core limit of four, which the file, the list and item 12's two reads spend. */
function limitedToFirstItem(): void {
    const scripted = globalThis.fetch;
    vi.stubGlobal("fetch", async (input: string | URL, init: RequestInit) => {
        const reply = await scripted(input, init);
        const headers = new Headers(reply.headers);
        if (headers.get("x-ratelimit-resource") === "core") headers.set("x-ratelimit-limit", "4");
        return new Response(reply.body, { status: reply.status, headers });
    });
}

/** One scheduled run over the script's items 12 and 34; `stopShort` leaves 34 unread. */
async function sweepOnce(resumeAfter: number | null, stopShort = false): Promise<RunOutcome> {
    scriptedGitHub({ now: () => START, config: () => configFor("inactivity") });
    if (stopShort) limitedToFirstItem();
    const store = runStore();
    try {
        return await runAction(scheduledRun(), {
            payload: Buffer.from("{}"),
            store,
            clock: () => START,
            log: () => undefined,
            resumeAfter,
        });
    } finally {
        store.close();
    }
}

/** The cursor one run leaves, through the file as the workflow carries it. */
function carried(outcome: RunOutcome): number | null {
    const path = temp.file("cursor.json");
    expect(keepCursor(path, outcome.events)).toBeNull();
    const read = readCursor(path);
    if (!read.ok) throw new Error(read.detail);
    return read.resumeAfter;
}

const numbers = (outcome: RunOutcome): number[] => outcome.items.map(({ number }) => number);

describe("the sweep's cursor across runs", () => {
    it("lets the run after one that stopped short continue past where it stopped", async () => {
        const first = await sweepOnce(null, true);
        expect(numbers(first)).toEqual([12]);
        const next = await sweepOnce(carried(first));
        expect(numbers(next)).toEqual([34]);
    });

    it("starts the run after a finished pass at the first item again", async () => {
        const last = await sweepOnce(12);
        expect(numbers(last)).toEqual([34]);
        const next = await sweepOnce(carried(last));
        expect(numbers(next)).toEqual([12, 34]);
    });
});

describe("the cursor file", () => {
    it("reads as a first pass when it is absent", () => {
        expect(readCursor(temp.file("absent.json"))).toEqual({ ok: true, resumeAfter: null });
    });

    it.each([["not json"], ["{}"], ['{"resumeAfter":0}'], ['{"resumeAfter":1.5}'], ["12"]])(
        "reports %s as holding no cursor",
        (text) => {
            const path = temp.file("cursor.json");
            writeFileSync(path, text);
            expect(readCursor(path).ok).toBe(false);
        },
    );

    it("reports a file it cannot read", () => {
        expect(readCursor(temp.file(".")).ok).toBe(false);
    });

    it("is left as restored when no firing finished", () => {
        const path = temp.file("cursor.json");
        writeFileSync(path, '{"resumeAfter":12}');
        expect(keepCursor(path, [])).toBeNull();
        expect(readCursor(path)).toEqual({ ok: true, resumeAfter: 12 });
    });

    it("reports a cursor it cannot write", () => {
        const finished = { event: "sweepFinished", resumeAfter: 12 } as unknown as ShellEvent;
        expect(keepCursor(temp.file("missing/cursor.json"), [finished])).toMatch(/not be written/);
    });
});
