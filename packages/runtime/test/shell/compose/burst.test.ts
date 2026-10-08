/**
 * The webhook lane under a burst: many concurrent signed deliveries, every
 * one acknowledged and none lost, a repeated GUID stored once, and the drain
 * decides each. Same credential-free composition as shell.test.ts.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import {
    signBody,
    toEngine,
    SIGNATURE_HEADER,
    type EngineCapability,
} from "@hiero-hackers/automation-core";
import { Store } from "../../../src/store/index.js";
import { triageQueue } from "@hiero-hackers/automation-capabilities";
import { capture, useTempDir } from "@hiero-hackers/automation-testkit";
import {
    createShell,
    fileConfigSource,
    stubbedExternals,
    type Log,
    type RepositorySeams,
    type Shell,
    type ShellEvent,
} from "../../../src/shell/index.js";

const SECRET = "shell-test-secret";
const GUID_PREFIX = "83e4273f-dd89-22f4-92bc-5da478ed1";
const FIXTURE = capture("issues.opened.json").bytes();

const CONFIG = `schemaVersion: 2
mode: dry-run
capabilities:
  triageQueue:
    enabled: true
    welcome: true
mappings:
  labels:
    awaitingTriage: "status: triage"
`;

const REPOSITORY = { owner: "scrubbed-1", repo: "scrubbed-2" } as const;

const ITEM = { kind: "issue", number: 164 } as const;

const BASE = new Date("2026-08-07T10:00:00.000Z");

/** A hundred signed requests and their decisions on a shared CI runner; 5 s is the default. */
const BURST_TIMEOUT_MS = 20_000;

const seamsOn = (path: string) => (): RepositorySeams => ({
    configSource: fileConfigSource(path),
    externals: () => stubbedExternals(),
    writePath: null,
    facts: () => {
        throw new Error("the reader must not be built");
    },
});

const temp = useTempDir("shell-burst-");
let store: Store;
let configFile: string;
let running: Shell[];
let logged: ShellEvent[];
const log: Log = (event) => logged.push(event);

beforeEach(() => {
    configFile = temp.file("sdk-automations.yml");
    writeFileSync(configFile, CONFIG);
    store = new Store(temp.file("store.sqlite"));
    running = [];
    logged = [];
});
afterEach(() => {
    for (const shell of running) shell.stopTick();
    store.close();
});

function buildShell(capability: EngineCapability = toEngine(triageQueue)): Shell {
    let tick = 0;
    const shell = createShell({
        secret: SECRET,
        store,
        capabilities: [capability],
        seams: seamsOn(configFile),
        repository: REPOSITORY,
        clock: () => new Date(BASE.getTime() + 1000 * tick++),
        tickMs: 60_000,
        log,
    });
    running.push(shell);
    return shell;
}

const guids = (count: number): string[] =>
    Array.from({ length: count }, (_, index) => GUID_PREFIX + index.toString(16).padStart(3, "0"));

async function burst(shell: Shell, deliveries: readonly string[]): Promise<number[]> {
    await new Promise<void>((resolve) => shell.server.listen(0, "127.0.0.1", resolve));
    try {
        const { port } = shell.server.address() as AddressInfo;
        return await Promise.all(
            deliveries.map(async (guid) => {
                const response = await fetch(`http://127.0.0.1:${String(port)}/`, {
                    method: "POST",
                    headers: {
                        [SIGNATURE_HEADER]: signBody(SECRET, FIXTURE),
                        "x-github-delivery": guid,
                        "x-github-event": "issues",
                    },
                    body: FIXTURE,
                });
                await response.arrayBuffer();
                return response.status;
            }),
        );
    } finally {
        await new Promise<void>((resolve, reject) =>
            shell.server.close((error) => (error ? reject(error) : resolve())),
        );
    }
}

async function settle(shell: Shell): Promise<void> {
    await shell.settled();
    await shell.drain();
}

describe("a burst of deliveries", { timeout: BURST_TIMEOUT_MS }, () => {
    it("acknowledges every one of 100 distinct deliveries and stores each once", async () => {
        const shell = buildShell();

        const statuses = await burst(shell, guids(100));
        expect(statuses).toEqual(statuses.map(() => 202));
        expect(statuses).toHaveLength(100);

        await settle(shell);
        expect(store.inbox.counts()).toMatchObject({
            pending: 0,
            processing: 0,
            failed: 0,
            done: 100,
        });
    });

    it("stores a delivery sent twice in the same burst once", async () => {
        const shell = buildShell();
        const distinct = guids(20);

        const statuses = await burst(shell, [...distinct, ...distinct]);
        expect(statuses).toEqual(statuses.map(() => 202));
        expect(statuses).toHaveLength(40);

        await settle(shell);
        expect(store.inbox.counts()).toMatchObject({
            pending: 0,
            processing: 0,
            failed: 0,
            done: 20,
        });
        expect(logged.filter((event) => event.event === "deliveryCompleted")).toHaveLength(20);
    });

    it("decides every delivery of the burst", async () => {
        const shell = buildShell();
        const distinct = guids(50);

        const statuses = await burst(shell, distinct);
        expect(statuses).toEqual(statuses.map(() => 202));

        await settle(shell);
        const sources = new Set(
            store.ledger.decisionsOn(REPOSITORY, ITEM).map((row) => row.sourceId),
        );
        expect(sources).toEqual(new Set(distinct));
    });
});
