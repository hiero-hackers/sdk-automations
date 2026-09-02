/**
 * The definition of done, executed: a delivery GitHub actually sent (the
 * captured, scrubbed issues.opened fixture) travels webhook → verify →
 * durable accept → 202 → parseConfigDocument → decide() → persisted
 * report, over a real socket, a real SQLite store, and a real config
 * file — with only GitHub itself absent. Dry-run: the report is the
 * product and active mode stops before the decision path.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import {
    asDeliveryGuid,
    problems,
    signBody,
    toEngine,
    SIGNATURE_HEADER,
    type EngineCapability,
    type Report,
} from "@hiero-hackers/automation-core";
import { Store } from "@hiero-hackers/automation-store";
import { intake, prQuality } from "@hiero-hackers/automation-probes";
import { capture, useTempDir } from "@hiero-hackers/automation-testkit";
import {
    createApplier,
    createShell,
    fileConfigSource,
    serializeCall,
    stubbedExternals,
    type Log,
    type Shell,
    type ShellEvent,
} from "../src/index.js";
import { fakeGitHub } from "./effect-harness.js";

const SECRET = "shell-test-secret";
const GUID = "83e4273f-dd89-22f4-92bc-5da478ed1a69";
const SECOND_GUID = "83e4273f-dd89-22f4-92bc-5da478ed1a6a";
const FIXTURE = capture("issues.opened.json").bytes();

const CONFIG = `schemaVersion: 1
mode: dry-run
capabilities:
  intake:
    enabled: true
    settings:
      announce: true
mappings:
  labels:
    awaitingTriage: "status: triage"
`;

/** The repository the fixture names, which is the one the shell serves. */
const REPOSITORY = { owner: "scrubbed-1", repo: "scrubbed-2" } as const;

const BASE = new Date("2026-08-07T10:00:00.000Z");

const temp = useTempDir("shell-test-");
let store: Store;
let configFile: string;
/** Every shell built here, so its sweep stops with the test that made it. */
let running: Shell[];
/** Every shell built here logs into this, cleared per test. */
let logged: ShellEvent[];
const log: Log = (event) => logged.push(event);

beforeEach(() => {
    configFile = temp.file("automations.yml");
    writeFileSync(configFile, CONFIG);
    store = new Store(temp.file("store.sqlite"));
    running = [];
    logged = [];
});
afterEach(() => {
    for (const shell of running) shell.stopSweep();
    vi.restoreAllMocks();
    store.close();
});

function buildShell(
    capability: EngineCapability = toEngine(intake),
    sweepIntervalMs = 60_000,
    repository: { owner: string; repo: string } = REPOSITORY,
): Shell {
    let tick = 0;
    const shell = createShell({
        secret: SECRET,
        store,
        capabilities: [capability],
        configSource: fileConfigSource(configFile),
        externals: () => stubbedExternals(),
        repository,
        clock: () => new Date(BASE.getTime() + 1000 * tick++),
        sweepIntervalMs,
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

interface RecordIdentity {
    readonly deliveryId: string;
    readonly event: string;
    readonly receivedAt: string;
    readonly decidedAt: string;
    readonly configRevision: string;
}

type StoredRecord = RecordIdentity &
    (
        | {
              readonly kind: "decision";
              readonly report: Report;
              readonly effects: readonly unknown[];
          }
        | { readonly kind: "configRejected"; readonly errors: readonly unknown[] }
        | { readonly kind: "modeUnsupported"; readonly reason: string }
        | { readonly kind: "repositoryMismatch"; readonly expected: string }
    );

function records(): StoredRecord[] {
    return store.deliveryReports().map((report) => JSON.parse(report.reportJson) as StoredRecord);
}

describe("the first slice, end to end", () => {
    it("rejects duplicate direct capability names before returning a server", () => {
        const intakeCapability = toEngine(intake);
        const prQualityCapability = toEngine(prQuality);
        expect(() =>
            createShell({
                secret: SECRET,
                store,
                capabilities: [
                    intakeCapability,
                    intakeCapability,
                    prQualityCapability,
                    prQualityCapability,
                ],
                configSource: fileConfigSource(configFile),
                externals: () => stubbedExternals(),
                repository: REPOSITORY,
            }),
        ).toThrow(
            'invalid capability declarations: duplicate capability name "intake"; duplicate capability name "prQuality"',
        );
    });

    it("a real delivery becomes a persisted dry-run report", async () => {
        const shell = buildShell();
        expect(await deliver(shell)).toBe(202);
        await shell.drain();

        const [entry, ...rest] = records();
        expect(rest).toEqual([]);
        expect(entry).toMatchObject({
            kind: "decision",
            deliveryId: GUID,
            event: "issues",
        });
        if (entry?.kind !== "decision") throw new Error("expected a decision");
        expect(entry.report.mode).toBe("dry-run");
        // Named from the payload by the engine, and equal to the served
        // repository because a payload naming any other never gets here.
        expect(entry.report.repository).toEqual(REPOSITORY);
        expect(problems(entry.report as Report)).toEqual([]);
        expect(entry.report.findings.length).toBeGreaterThan(0);
        expect(entry).not.toHaveProperty("approved");
        expect(store.deliveryReports()).toEqual([
            expect.objectContaining({
                deliveryId: GUID,
                reportJson: JSON.stringify(entry),
            }),
        ]);
        // The queue is empty: the delivery completed.
        expect(
            store.claimNextDelivery(
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
        const capability = toEngine(intake);
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

        expect(records()).toEqual([
            expect.objectContaining({
                kind: "repositoryMismatch",
                deliveryId: GUID,
                expected: "some-other/repository",
                observed: "scrubbed-1/scrubbed-2",
            }),
        ]);
        // Terminal, like the two record kinds beside it: nothing to reclaim.
        expect(
            store.claimNextDelivery(
                "assert",
                "2026-08-07T11:00:00.000Z",
                "2026-08-07T10:59:00.000Z",
            ),
        ).toBeUndefined();
        expect(store.deadLetteredDeliveries()).toEqual([]);
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
        const capability = toEngine(intake);
        const shell = buildShell({
            ...capability,
            evaluate: async () => {
                throw new Error("active mode reached capability evaluation");
            },
        });
        expect(await deliver(shell)).toBe(202);
        await shell.drain();

        const [entry, ...rest] = records();
        expect(rest).toEqual([]);
        expect(entry).toMatchObject({
            kind: "modeUnsupported",
            deliveryId: GUID,
            event: "issues",
            reason: "active mode is unsupported by the runnable shell",
        });
        expect(entry).not.toHaveProperty("report");
        expect(entry).not.toHaveProperty("approved");
        expect(JSON.stringify(entry)).not.toContain("applied");
        expect(store.deliveryReports()).toEqual([
            expect.objectContaining({ reportJson: JSON.stringify(entry) }),
        ]);
        expect(
            store.claimNextDelivery(
                "assert",
                "2026-08-07T11:00:00.000Z",
                "2026-08-07T10:59:00.000Z",
            ),
        ).toBeUndefined();

        expect(await deliver(shell)).toBe(202);
        await shell.drain();
        expect(records()).toHaveLength(1);
    });

    /**
     * What a shutdown waits on. Starting a drain instead would claim the
     * very delivery the process is leaving, and a claim nobody completes
     * is invisible for the full fifteen-minute stale window.
     */
    it("settles on the pass in flight without starting one", async () => {
        store.acceptDelivery({
            deliveryId: asDeliveryGuid(SECOND_GUID)!,
            eventName: "issues",
            payload: FIXTURE,
            receivedAt: BASE.toISOString(),
        });
        const shell = buildShell();

        await shell.settled();
        expect(records()).toEqual([]);

        const draining = shell.drain();
        await shell.settled();
        expect(records()).toHaveLength(1);
        await draining;
    });

    it("a process restart observes the committed canonical report", async () => {
        const shell = buildShell();
        expect(await deliver(shell)).toBe(202);
        await shell.drain();
        const committed = store.deliveryReports();

        store.close();
        store = new Store(temp.file("store.sqlite"));

        expect(store.deliveryReports()).toEqual(committed);
        expect(records()).toHaveLength(1);
    });

    it("startup draining recovers a pending delivery after restart", async () => {
        expect(
            store.acceptDelivery({
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

        expect(records()).toEqual([
            expect.objectContaining({
                kind: "decision",
                deliveryId: SECOND_GUID,
            }),
        ]);
        expect(
            store.claimNextDelivery(
                "assert",
                "2026-08-07T11:00:00.000Z",
                "2026-08-07T10:59:00.000Z",
            ),
        ).toBeUndefined();
    });

    it("starts durable processing after the acknowledgment without a manual drain", async () => {
        const shell = buildShell();
        expect(await deliver(shell)).toBe(202);
        await vi.waitFor(() => expect(records()).toHaveLength(1));
    });

    it("sweeps a dead worker's claim back into a drain with no delivery to wake it", async () => {
        expect(
            store.acceptDelivery({
                deliveryId: asDeliveryGuid(SECOND_GUID)!,
                eventName: "issues",
                payload: FIXTURE,
                receivedAt: BASE.toISOString(),
            }),
        ).toMatchObject({ outcome: "accepted" });
        // A worker that died twenty minutes ago still holds the claim, and
        // in a quiet repository nothing else will ever arrive to drain it.
        expect(
            store.claimNextDelivery(
                "dead-worker",
                new Date(BASE.getTime() - 20 * 60_000).toISOString(),
                new Date(BASE.getTime() - 60 * 60_000).toISOString(),
            ),
        ).toBeDefined();

        buildShell(toEngine(intake), 5);
        await vi.waitFor(() => expect(records()).toHaveLength(1));
        expect(records()[0]).toMatchObject({ kind: "decision", deliveryId: SECOND_GUID });
        // Said once, with what it handed back: a requeue means some worker
        // died holding a claim, which is the line an operator greps for.
        expect(logged.filter((event) => event.event === "sweepRequeued")).toEqual([
            { event: "sweepRequeued", requeued: 1, deliveryIds: [SECOND_GUID] },
        ]);
    });

    /**
     * The stale window is fifteen MINUTES, and the sweep is the only thing
     * that reads it. A claim a minute old belongs to a worker that is very
     * probably still deciding on it, and requeueing it would hand the same
     * delivery to a second worker — the duplicate the claim exists to stop.
     */
    it("leaves a claim that is merely a minute old where it is", async () => {
        store.acceptDelivery({
            deliveryId: asDeliveryGuid(SECOND_GUID)!,
            eventName: "issues",
            payload: FIXTURE,
            receivedAt: BASE.toISOString(),
        });
        expect(
            store.claimNextDelivery(
                "busy-worker",
                new Date(BASE.getTime() - 60_000).toISOString(),
                new Date(BASE.getTime() - 60 * 60_000).toISOString(),
            ),
        ).toBeDefined();
        // A second delivery nothing holds, so a sweep that ran is visible:
        // the tick's own drain completes this one whatever it requeued.
        store.acceptDelivery({
            deliveryId: asDeliveryGuid(GUID)!,
            eventName: "issues",
            payload: FIXTURE,
            receivedAt: BASE.toISOString(),
        });

        buildShell(toEngine(intake), 5);
        await vi.waitFor(() => expect(records()).toHaveLength(1));

        expect(records()[0]).toMatchObject({ deliveryId: GUID });
        expect(logged.filter((event) => event.event === "sweepRequeued")).toEqual([]);
    });

    /**
     * A drain that cannot even claim is a store problem, and the tick that
     * started it is long gone by the time the promise rejects — so the
     * rejection is caught where it can still say which pump it was.
     */
    it.each([
        { phase: "accepted", acknowledge: true },
        { phase: "sweep", acknowledge: false },
    ] as const)(
        "names the pump a failed drain belonged to: $phase",
        async ({ phase, acknowledge }) => {
            const shell = buildShell(toEngine(intake), 5);
            vi.spyOn(store, "claimNextDelivery").mockImplementation(() => {
                throw new Error("the store cannot be claimed against");
            });
            if (acknowledge) expect(await deliver(shell)).toBe(202);

            await vi.waitFor(() =>
                expect(logged).toContainEqual({
                    event: "drainFailed",
                    phase,
                    detail: expect.stringContaining("the store cannot be claimed against"),
                }),
            );
        },
    );

    it("reports a sweep it cannot run instead of taking the process down", async () => {
        // A closed store is the sweep's worst case: a throw inside a timer
        // callback is an unhandled exception, and this shell keeps serving.
        const doomed = new Store(temp.file("doomed.sqlite"));
        running.push(
            createShell({
                secret: SECRET,
                store: doomed,
                capabilities: [toEngine(intake)],
                configSource: fileConfigSource(configFile),
                externals: () => stubbedExternals(),
                repository: REPOSITORY,
                sweepIntervalMs: 5,
                log,
            }),
        );
        doomed.close();

        await vi.waitFor(() =>
            expect(logged).toContainEqual(
                expect.objectContaining({ event: "sweepFailed", detail: expect.any(String) }),
            ),
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
            capabilities: [toEngine(intake)],
            configSource: fileConfigSource(configFile),
            externals: () => stubbedExternals(),
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
            capabilities: [toEngine(intake)],
            configSource: fileConfigSource(configFile),
            externals: () => stubbedExternals(),
            repository: REPOSITORY,
            log: () => {
                throw new Error("the log itself is broken");
            },
        });
        running.push(shell);

        expect(await deliver(shell)).toBe(202);
        await shell.drain();
        expect(records()).toHaveLength(1);
    });

    it("a broken config fails closed: recorded, completed, nothing decided", async () => {
        writeFileSync(configFile, "mode: [unclosed\n");
        const shell = buildShell();
        expect(await deliver(shell)).toBe(202);
        await shell.drain();

        const [entry] = records();
        expect(entry?.kind).toBe("configRejected");
        if (entry?.kind !== "configRejected") throw new Error("expected rejection");
        expect(entry.errors.length).toBeGreaterThan(0);
        expect(
            store.claimNextDelivery(
                "assert",
                "2026-08-07T11:00:00.000Z",
                "2026-08-07T10:59:00.000Z",
            ),
        ).toBeUndefined();
    });

    it("an absent config file decides in observe mode, like an empty one", async () => {
        rmSync(configFile);
        const shell = buildShell();
        expect(await deliver(shell)).toBe(202);
        await shell.drain();

        const [entry] = records();
        if (entry?.kind !== "decision") throw new Error("expected a decision");
        expect(entry.report.mode).toBe("observe");
        expect(entry.configRevision).toBe("sha256:absent");
    });
});

/**
 * The sweep's second job: an effect a worker journalled and never closed.
 *
 * Nothing here delivers anything. That is the claim — in a quiet repository
 * the only thing that could ever resolve a lost write is the clock, and these
 * cases prove it does, and that it does not when the composition root wired no
 * write path.
 */
describe("recovering effects on the clock, with no delivery to wake anything", () => {
    const ACTIVE_CONFIG = `schemaVersion: 1
mode: active
capabilities:
  intake:
    enabled: true
    settings:
      announce: true
mappings:
  labels:
    awaitingTriage: "status: triage"
`;

    const LABEL = "status: triage";
    const EFFECT_ID = "orphan-effect";

    /** The row a crashed worker left, older than one lease window. */
    function orphanRow(): void {
        store.intent(
            EFFECT_ID,
            1,
            serializeCall({
                capability: "intake",
                item: { kind: "issue", number: 164 },
                call: { verb: "addLabel", label: LABEL },
            }),
            new Date(BASE.getTime() - 60 * 60_000).toISOString(),
            "rev-1",
        );
    }

    const openRows = (): number =>
        store.openIntents(new Date(BASE.getTime() + 60 * 60_000).toISOString()).length;

    function shellWithWritePath(github: ReturnType<typeof fakeGitHub>): Shell {
        let tick = 0;
        const clock = (): Date => new Date(BASE.getTime() + 1000 * tick++);
        const shell = createShell({
            secret: SECRET,
            store,
            capabilities: [toEngine(intake)],
            configSource: fileConfigSource(configFile),
            externals: () => stubbedExternals(),
            repository: REPOSITORY,
            clock,
            sweepIntervalMs: 5,
            log,
            applier: createApplier({
                store,
                writer: github.writer,
                reader: github.reader,
                externals: () => stubbedExternals(),
                worker: "sweep-worker",
                clock,
                log,
            }),
        });
        running.push(shell);
        return shell;
    }

    it("resends what GitHub never had, and closes the row", async () => {
        writeFileSync(configFile, ACTIVE_CONFIG);
        orphanRow();
        const github = fakeGitHub();

        shellWithWritePath(github);

        await vi.waitFor(() =>
            expect(logged).toContainEqual({ event: "effectApplied", effectId: EFFECT_ID, seq: 1 }),
        );
        expect(github.world.labels).toEqual([LABEL]);
        expect(openRows()).toBe(0);
        // No delivery was involved in any of that.
        expect(records()).toEqual([]);
        expect(logged.filter((event) => event.event === "deliveryClaimed")).toEqual([]);
    });

    it("closes a row for good once the repository has left active mode", async () => {
        orphanRow();
        const github = fakeGitHub();

        shellWithWritePath(github);

        await vi.waitFor(() =>
            expect(logged).toContainEqual(
                expect.objectContaining({ event: "effectRefused", code: "modeRecordsOnly" }),
            ),
        );
        expect(github.calls).toEqual([]);
        expect(openRows()).toBe(0);
    });

    it("closes the row when the absent file puts the repository in observe mode", async () => {
        rmSync(configFile);
        orphanRow();
        const github = fakeGitHub();

        shellWithWritePath(github);
        // An absent file decides in observe mode, which is a real answer and
        // therefore a refusal — what must not happen is a resend.
        await vi.waitFor(() =>
            expect(logged.some((event) => event.event === "effectRefused")).toBe(true),
        );
        expect(github.calls).toEqual([]);
    });

    /**
     * A file nobody can parse is not a repository saying anything. The row is
     * left exactly as it was, for a tick where the file has been fixed.
     */
    it("leaves every row alone while the configuration does not parse", async () => {
        writeFileSync(configFile, "schemaVersion: 9");
        orphanRow();
        const github = fakeGitHub();
        const worklist = vi.spyOn(store, "openIntents");

        shellWithWritePath(github);

        await vi.waitFor(() => expect(worklist.mock.calls.length).toBeGreaterThan(1));
        expect(github.calls).toEqual([]);
        expect(logged.filter((event) => event.event.startsWith("effect"))).toEqual([]);
        expect(openRows()).toBe(1);
    });

    it("reports a recovery pass it could not run, and keeps serving", async () => {
        writeFileSync(configFile, ACTIVE_CONFIG);
        orphanRow();
        running.push(
            createShell({
                secret: SECRET,
                store,
                capabilities: [toEngine(intake)],
                configSource: fileConfigSource(configFile),
                externals: () => stubbedExternals(),
                repository: REPOSITORY,
                clock: () => BASE,
                sweepIntervalMs: 5,
                log,
                applier: {
                    applyAll: () => Promise.resolve([]),
                    recover: () => Promise.reject(new Error("the store is closed")),
                },
            }),
        );

        await vi.waitFor(() =>
            expect(logged).toContainEqual(
                expect.objectContaining({
                    event: "sweepFailed",
                    detail: expect.stringContaining("the store is closed") as string,
                }),
            ),
        );
        expect(openRows()).toBe(1);
    });

    it("does not even look for open rows when no write path was wired", async () => {
        writeFileSync(configFile, ACTIVE_CONFIG);
        orphanRow();
        const requeues = vi.spyOn(store, "requeueStuckDeliveries");
        const worklist = vi.spyOn(store, "openIntents");

        buildShell(toEngine(intake), 5);

        // Two ticks of the same sweep that would have found the row.
        await vi.waitFor(() => expect(requeues.mock.calls.length).toBeGreaterThan(1));
        expect(worklist).not.toHaveBeenCalled();
        expect(logged.filter((event) => event.event.startsWith("effect"))).toEqual([]);
        expect(openRows()).toBe(1);
    });
});
