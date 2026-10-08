/**
 * The definition of done, executed: a delivery GitHub actually sent (the
 * captured, scrubbed issues.opened fixture) travels webhook → verify →
 * durable accept → 202 → parseConfigDocument → decide() → decision rows
 * and completion, over a real socket, a real SQLite store, and a real
 * config file — with only GitHub itself absent. Dry-run: the rows are the
 * product (D173) and active mode stops before the decision path.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import {
    asDeliveryGuid,
    signBody,
    toEngine,
    SIGNATURE_HEADER,
    type EngineCapability,
    type RepositoryRef,
} from "@hiero-hackers/automation-core";
import { Store } from "../../../src/store/index.js";
import { triageQueue, prDashboard } from "@hiero-hackers/automation-capabilities";
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
const GUID = "83e4273f-dd89-22f4-92bc-5da478ed1a69";
const SECOND_GUID = "83e4273f-dd89-22f4-92bc-5da478ed1a6a";
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

/** The repository the fixture names, which is the one the shell serves. */
const REPOSITORY = { owner: "scrubbed-1", repo: "scrubbed-2" } as const;

/** The issue the fixture opens: every decision row below is about it. */
const ITEM = { kind: "issue", number: 164 } as const;

const BASE = new Date("2026-08-07T10:00:00.000Z");

/** The credential-free seams: a local file, stubs, no write path and no reader. */
const seamsOn = (path: string) => (): RepositorySeams => ({
    configSource: fileConfigSource(path),
    externals: () => stubbedExternals(),
    writePath: null,
    facts: () => {
        throw new Error("the reader must not be built");
    },
});

const temp = useTempDir("shell-test-");
let store: Store;
let configFile: string;
/** Every shell built here, so its tick stops with the test that made it. */
let running: Shell[];
/** Every shell built here logs into this, cleared per test. */
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
    vi.restoreAllMocks();
    store.close();
});

function buildShell(
    capability: EngineCapability = toEngine(triageQueue),
    tickMs = 60_000,
    repository: { owner: string; repo: string } = REPOSITORY,
): Shell {
    let tick = 0;
    const shell = createShell({
        secret: SECRET,
        store,
        capabilities: [capability],
        seams: seamsOn(configFile),
        repository,
        clock: () => new Date(BASE.getTime() + 1000 * tick++),
        tickMs,
        log,
    });
    running.push(shell);
    return shell;
}

async function deliver(shell: Shell, guid = GUID): Promise<number> {
    await new Promise<void>((resolve) => shell.server.listen(0, "127.0.0.1", resolve));
    try {
        const { port } = shell.server.address() as AddressInfo;
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
    } finally {
        await new Promise<void>((resolve, reject) =>
            shell.server.close((error) => (error ? reject(error) : resolve())),
        );
    }
}

/** What the shell finished, as its completion line names it — the record's only exit (D173). */
function completions(): { readonly deliveryId: string; readonly kind: string }[] {
    return logged.flatMap((event) =>
        event.event === "deliveryCompleted"
            ? [{ deliveryId: event.deliveryId, kind: event.kind }]
            : [],
    );
}

/** The rows one pass wrote about the fixture's issue: the decided record itself. */
function rows() {
    return store.ledger.decisionsOn(REPOSITORY, ITEM);
}

describe("the first slice, end to end", () => {
    it("gives independent shells distinct worker identities", async () => {
        const claims = vi.spyOn(store.inbox, "claimNextDelivery");
        await buildShell().drain();
        await buildShell().drain();

        expect(new Set(claims.mock.calls.map(([worker]) => worker)).size).toBe(2);
    });

    it("rejects duplicate direct capability names before returning a server", () => {
        const intakeCapability = toEngine(triageQueue);
        const prDashboardCapability = toEngine(prDashboard);
        expect(() =>
            createShell({
                secret: SECRET,
                store,
                capabilities: [
                    intakeCapability,
                    intakeCapability,
                    prDashboardCapability,
                    prDashboardCapability,
                ],
                seams: seamsOn(configFile),
                repository: REPOSITORY,
            }),
        ).toThrow(
            'invalid capability declarations: duplicate capability name "triageQueue"; duplicate capability name "prDashboard"',
        );
    });

    it("a real delivery becomes dry-run decision rows", async () => {
        const shell = buildShell();
        expect(await deliver(shell)).toBe(202);
        await shell.drain();

        expect(completions()).toEqual([{ deliveryId: GUID, kind: "decision" }]);
        const decided = rows();
        expect(decided.length).toBeGreaterThan(0);
        // Every row names the webhook that caused it and the served
        // repository, which is the one the payload named to get here.
        expect(decided).toEqual(
            decided.map(() =>
                expect.objectContaining({
                    source: "webhook",
                    sourceId: GUID,
                    repository: REPOSITORY,
                }),
            ),
        );
        // `wouldApply` is dry-run saying exactly what active would do, and
        // no row is a problem: this configuration decided cleanly.
        expect(decided.map((row) => row.code)).toContain("wouldApply");
        expect(decided.filter((row) => row.verdict === "problem")).toEqual([]);
        // The queue is empty: the delivery completed.
        expect(
            store.inbox.claimNextDelivery(
                "assert",
                "2026-08-07T11:00:00.000Z",
                "2026-08-07T10:59:00.000Z",
            ),
        ).toBeUndefined();
    });

    /**
     * The signature only proves the sender holds this App's secret, not
     * that the delivery is this endpoint's business — an App installed on
     * two repositories signs both identically.
     */
    it("refuses a delivery from a repository it does not serve", async () => {
        const capability = toEngine(triageQueue);
        const shell = buildShell(
            {
                ...capability,
                evaluate: async () => {
                    throw new Error("a foreign repository reached capability evaluation");
                },
            },
            60_000,
            { owner: "some-other", repo: "repository" },
        );
        expect(await deliver(shell)).toBe(202);
        await shell.drain();

        expect(completions()).toEqual([{ deliveryId: GUID, kind: "repositoryMismatch" }]);
        // Nothing was decided, so nothing was written down about the item.
        expect(rows()).toEqual([]);
        // Terminal, like the two record kinds beside it: nothing to reclaim.
        expect(
            store.inbox.claimNextDelivery(
                "assert",
                "2026-08-07T11:00:00.000Z",
                "2026-08-07T10:59:00.000Z",
            ),
        ).toBeUndefined();
        expect(store.inbox.deadLetteredDeliveries()).toEqual([]);
    });

    /**
     * Node's defaults (300s and 60s) are a slow-loris budget, and the edge
     * buffers up to 25 MB per connection before it can verify anything.
     */
    it("bounds how long one connection may hold the edge open", () => {
        const shell = buildShell();
        expect(shell.server.requestTimeout).toBe(30_000);
        expect(shell.server.headersTimeout).toBe(10_000);
    });

    it("rejects active mode canonically without deciding or retrying", async () => {
        writeFileSync(configFile, CONFIG.replace("mode: dry-run", "mode: active"));
        const capability = toEngine(triageQueue);
        const shell = buildShell({
            ...capability,
            evaluate: async () => {
                throw new Error("active mode reached capability evaluation");
            },
        });
        expect(await deliver(shell)).toBe(202);
        await shell.drain();

        expect(completions()).toEqual([{ deliveryId: GUID, kind: "modeUnsupported" }]);
        expect(rows()).toEqual([]);
        expect(
            store.inbox.claimNextDelivery(
                "assert",
                "2026-08-07T11:00:00.000Z",
                "2026-08-07T10:59:00.000Z",
            ),
        ).toBeUndefined();

        expect(await deliver(shell)).toBe(202);
        await shell.drain();
        expect(completions()).toHaveLength(1);
    });

    /**
     * What a shutdown waits on. Starting a drain instead would claim the
     * very delivery the process is leaving, and a claim nobody completes
     * is invisible for the full fifteen-minute stale window.
     */
    it("settles on the pass in flight without starting one", async () => {
        store.inbox.acceptDelivery({
            deliveryId: asDeliveryGuid(SECOND_GUID)!,
            eventName: "issues",
            payload: FIXTURE,
            receivedAt: BASE.toISOString(),
        });
        const shell = buildShell();

        await shell.settled();
        expect(completions()).toEqual([]);

        const draining = shell.drain();
        await shell.settled();
        expect(completions()).toHaveLength(1);
        await draining;
    });

    it("a process restart observes the committed rows and completion", async () => {
        const shell = buildShell();
        expect(await deliver(shell)).toBe(202);
        await shell.drain();
        const committed = rows();
        expect(committed.length).toBeGreaterThan(0);

        store.close();
        store = new Store(temp.file("store.sqlite"));

        expect(rows()).toEqual(committed);
        expect(store.inbox.counts()).toMatchObject({ done: 1, pending: 0, processing: 0 });
    });

    it("startup draining recovers a pending delivery after restart", async () => {
        expect(
            store.inbox.acceptDelivery({
                deliveryId: asDeliveryGuid(SECOND_GUID)!,
                eventName: "issues",
                payload: FIXTURE,
                receivedAt: BASE.toISOString(),
            }),
        ).toMatchObject({ outcome: "accepted", state: "pending" });
        store.close();
        store = new Store(temp.file("store.sqlite"));

        const shell = buildShell();
        await shell.drain();

        expect(completions()).toEqual([{ deliveryId: SECOND_GUID, kind: "decision" }]);
        expect(
            store.inbox.claimNextDelivery(
                "assert",
                "2026-08-07T11:00:00.000Z",
                "2026-08-07T10:59:00.000Z",
            ),
        ).toBeUndefined();
    });

    it("starts durable processing after the acknowledgment without a manual drain", async () => {
        const shell = buildShell();
        expect(await deliver(shell)).toBe(202);
        await vi.waitFor(() => expect(completions()).toHaveLength(1));
    });

    /**
     * A drain that cannot even claim is a store problem, and the acknowledged
     * delivery that started it is long gone by the time the promise rejects —
     * so the rejection is caught where it can still say which pump it was.
     */
    it("names the pump a failed drain belonged to: accepted", async () => {
        const shell = buildShell();
        vi.spyOn(store.inbox, "claimNextDelivery").mockImplementation(() => {
            throw new Error("the store cannot be claimed against");
        });
        expect(await deliver(shell)).toBe(202);

        await vi.waitFor(() =>
            expect(logged).toContainEqual({
                event: "drainFailed",
                phase: "accepted",
                detail: expect.stringContaining("the store cannot be claimed against"),
            }),
        );
    });

    /**
     * The log is the only account of a lane GitHub stopped watching at the
     * 202, so one uneventful delivery has to be readable end to end: what
     * arrived, what claimed it, and what it became — under one id.
     */
    it("tells one delivery's whole story under its own id", async () => {
        const shell = buildShell();
        expect(await deliver(shell)).toBe(202);
        await shell.drain();

        expect(logged).toEqual([
            { event: "deliveryAccepted", deliveryId: GUID, eventName: "issues" },
            { event: "deliveryClaimed", deliveryId: GUID, eventName: "issues", attempts: 0 },
            { event: "deliveryCompleted", deliveryId: GUID, kind: "decision" },
        ]);
    });

    /**
     * A shell built without one still logs. The default is the production
     * logger, never silence: a composition root that forgot the seam must
     * not be the quietest one.
     */
    it("writes to stdout when no log was injected", async () => {
        const lines: string[] = [];
        const written = vi
            .spyOn(process.stdout, "write")
            .mockImplementation((chunk: string | Uint8Array) => {
                lines.push(String(chunk));
                return true;
            });
        const shell = createShell({
            secret: SECRET,
            store,
            capabilities: [toEngine(triageQueue)],
            seams: seamsOn(configFile),
            repository: REPOSITORY,
            clock: () => BASE,
        });
        running.push(shell);
        expect(await deliver(shell)).toBe(202);
        await shell.drain();
        written.mockRestore();

        expect(lines.map((line) => (JSON.parse(line) as ShellEvent).event)).toContain(
            "deliveryAccepted",
        );
        // On the shell's clock, not one of its own: a default logger reading
        // a second clock would date the log differently from the records
        // beside it, which is exactly the correlation the log exists for.
        expect(lines.map((line) => (JSON.parse(line) as { at: string }).at)).toEqual(
            lines.map(() => BASE.toISOString()),
        );
    });

    /** A log that throws is a broken diagnostic, not a lost delivery. */
    it("keeps deciding when the injected log throws", async () => {
        const shell = createShell({
            secret: SECRET,
            store,
            capabilities: [toEngine(triageQueue)],
            seams: seamsOn(configFile),
            repository: REPOSITORY,
            log: () => {
                throw new Error("the log itself is broken");
            },
        });
        running.push(shell);

        expect(await deliver(shell)).toBe(202);
        await shell.drain();
        // This shell's log throws, so the store is the only witness left.
        expect(store.inbox.counts()).toMatchObject({ done: 1 });
    });

    it("a broken config fails closed: completed, nothing decided", async () => {
        writeFileSync(configFile, "mode: [unclosed\n");
        const shell = buildShell();
        expect(await deliver(shell)).toBe(202);
        await shell.drain();

        expect(completions()).toEqual([{ deliveryId: GUID, kind: "configRejected" }]);
        expect(rows()).toEqual([]);
        expect(
            store.inbox.claimNextDelivery(
                "assert",
                "2026-08-07T11:00:00.000Z",
                "2026-08-07T10:59:00.000Z",
            ),
        ).toBeUndefined();
    });

    /**
     * An absent file is an empty one (`config.test.ts` pins the revision it
     * carries): the delivery is decided, and no capability it never enabled
     * writes a row.
     */
    /**
     * The other composition (D169): nothing names a repository here, so the
     * PAYLOAD does — and that name is what selects the seams the pass runs on
     * and what every row it writes carries.
     */
    it("serves whatever repository a payload names when none is configured", async () => {
        const asked: RepositoryRef[] = [];
        const shell = createShell({
            secret: SECRET,
            store,
            capabilities: [toEngine(triageQueue)],
            seams: (repository) => {
                asked.push(repository);
                return seamsOn(configFile)();
            },
            clock: () => BASE,
            log,
        });
        running.push(shell);

        expect(await deliver(shell)).toBe(202);
        await shell.drain();

        expect(completions()).toEqual([{ deliveryId: GUID, kind: "decision" }]);
        expect(asked).toEqual([REPOSITORY]);
        expect(rows().length).toBeGreaterThan(0);
    });

    /** With no name there is nothing to select, and nothing to decide under. */
    it("refuses a payload naming no repository when none is configured", async () => {
        store.inbox.acceptDelivery({
            deliveryId: asDeliveryGuid(SECOND_GUID)!,
            eventName: "issues",
            payload: Buffer.from('{"action":"opened"}'),
            receivedAt: BASE.toISOString(),
        });
        const shell = createShell({
            secret: SECRET,
            store,
            capabilities: [toEngine(triageQueue)],
            seams: seamsOn(configFile),
            clock: () => BASE,
            log,
        });
        running.push(shell);
        await shell.drain();

        expect(completions()).toEqual([{ deliveryId: SECOND_GUID, kind: "repositoryMismatch" }]);
        expect(
            logged.flatMap((event) => (event.event === "deliveryCompleted" ? [event.detail] : [])),
        ).toEqual(["expected any, observed none"]);
    });

    it("an absent config file decides rather than failing closed", async () => {
        rmSync(configFile);
        const shell = buildShell();
        expect(await deliver(shell)).toBe(202);
        await shell.drain();

        expect(completions()).toEqual([{ deliveryId: GUID, kind: "decision" }]);
        expect(rows()).toEqual([]);
    });
});
