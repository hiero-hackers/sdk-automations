/**
 * The four jobs a tick runs, driven through the shell that wires them: an
 * interval is their only caller, so every case here runs a real composition on
 * a five-millisecond tick and watches the log. What they prove is containment
 * — a requeue that throws ends the tick, every other failure is a line rather
 * than a dead process — and that a job with a reason not to run does not run.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import {
    asDeliveryGuid,
    ABSENT_CONFIG_REVISION,
    revisionOf,
    toEngine,
    type EngineCapability,
} from "@hiero-hackers/automation-core";
import { Store } from "../../../src/store/index.js";
import { intake } from "@hiero-hackers/automation-capabilities";
import { capture, useTempDir } from "@hiero-hackers/automation-testkit";
import {
    createShell,
    fileConfigSource,
    serializeCall,
    stubbedExternals,
    type EffectReader,
    type Log,
    type RepositorySeams,
    type Shell,
    type ShellEvent,
    type WritePath,
} from "../../../src/shell/index.js";
import { fakeGitHub } from "../apply/effect-harness.js";
import { spending } from "../spending.js";

const SECRET = "shell-test-secret";
const GUID = "83e4273f-dd89-22f4-92bc-5da478ed1a69";
const SECOND_GUID = "83e4273f-dd89-22f4-92bc-5da478ed1a6a";
const FIXTURE = capture("issues.opened.json").bytes();

const CONFIG = `schemaVersion: 2
mode: dry-run
capabilities:
  intake:
    enabled: true
    announce: true
mappings:
  labels:
    awaitingTriage: "status: triage"
`;

/** The repository the fixture names, which is the one the shell serves. */
const REPOSITORY = { owner: "scrubbed-1", repo: "scrubbed-2" } as const;

const BASE = new Date("2026-08-07T10:00:00.000Z");

/** Short enough that a tick has fired several times before a `waitFor` gives up. */
const TICK_MS = 5;

/** The credential-free seams: a local file, stubs, no write path and no reader. */
const seamsOn =
    (path: string, writePath: WritePath | null = null) =>
    (): RepositorySeams => ({
        configSource: fileConfigSource(path),
        externals: () => stubbedExternals(),
        writePath,
        facts: () => {
            throw new Error("the reader must not be built");
        },
    });

const temp = useTempDir("jobs-test-");
let store: Store;
let configFile: string;
/** Every shell built here, so its tick stops with the test that made it. */
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
    for (const shell of running) shell.stopTick();
    vi.restoreAllMocks();
    store.close();
});

function buildShell(capability: EngineCapability = toEngine(intake), tickMs = TICK_MS): Shell {
    let tick = 0;
    const shell = createShell({
        secret: SECRET,
        store,
        capabilities: [capability],
        seams: seamsOn(configFile),
        repository: REPOSITORY,
        clock: () => new Date(BASE.getTime() + 1000 * tick++),
        tickMs,
        log,
    });
    running.push(shell);
    return shell;
}

/** What a tick's drain finished, one entry per completed delivery (D173). */
function completions(): { readonly deliveryId: string; readonly kind: string }[] {
    return logged.flatMap((event) =>
        event.event === "deliveryCompleted"
            ? [{ deliveryId: event.deliveryId, kind: event.kind }]
            : [],
    );
}

/** One delivery waiting in the queue, for a tick to requeue or drain. */
function accept(guid: string) {
    return store.inbox.acceptDelivery({
        deliveryId: asDeliveryGuid(guid)!,
        eventName: "issues",
        payload: FIXTURE,
        receivedAt: BASE.toISOString(),
    });
}

describe("one tick, four jobs", () => {
    it("sweeps a dead worker's claim back into a drain with no delivery to wake it", async () => {
        expect(accept(SECOND_GUID)).toMatchObject({ outcome: "accepted" });
        // A worker that died twenty minutes ago still holds the claim, and
        // in a quiet repository nothing else will ever arrive to drain it.
        expect(
            store.inbox.claimNextDelivery(
                "dead-worker",
                new Date(BASE.getTime() - 20 * 60_000).toISOString(),
                new Date(BASE.getTime() - 60 * 60_000).toISOString(),
            ),
        ).toBeDefined();

        buildShell();
        await vi.waitFor(() => expect(completions()).toHaveLength(1));
        expect(completions()[0]).toEqual({ kind: "decision", deliveryId: SECOND_GUID });
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
        accept(SECOND_GUID);
        expect(
            store.inbox.claimNextDelivery(
                "busy-worker",
                new Date(BASE.getTime() - 60_000).toISOString(),
                new Date(BASE.getTime() - 60 * 60_000).toISOString(),
            ),
        ).toBeDefined();
        // A second delivery nothing holds, so a sweep that ran is visible:
        // the tick's own drain completes this one whatever it requeued.
        accept(GUID);

        buildShell();
        await vi.waitFor(() => expect(completions()).toHaveLength(1));

        expect(completions()[0]).toMatchObject({ deliveryId: GUID });
        expect(logged.filter((event) => event.event === "sweepRequeued")).toEqual([]);
    });

    /**
     * A drain that cannot even claim is a store problem, and the tick that
     * started it is long gone by the time the promise rejects — so the
     * rejection is caught where it can still say which pump it was.
     */
    it("names the pump a failed drain belonged to", async () => {
        buildShell();
        vi.spyOn(store.inbox, "claimNextDelivery").mockImplementation(() => {
            throw new Error("the store cannot be claimed against");
        });

        await vi.waitFor(() =>
            expect(logged).toContainEqual({
                event: "drainFailed",
                phase: "sweep",
                detail: expect.stringContaining("the store cannot be claimed against"),
            }),
        );
    });

    it("reports a sweep it cannot run instead of taking the process down", async () => {
        // A closed store is the sweep's worst case: a throw inside a timer
        // callback is an unhandled exception, and this shell keeps serving.
        const doomed = new Store(temp.file("doomed.sqlite"));
        running.push(
            createShell({
                secret: SECRET,
                store: doomed,
                capabilities: [toEngine(intake)],
                seams: seamsOn(configFile),
                repository: REPOSITORY,
                tickMs: TICK_MS,
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
     * The other lane the tick drives. A composition that was given a reader
     * fires due `sweep:` rows on the same clock the reconciliation runs on —
     * and one that was not never claims them, which is the shipped default and
     * every other case in this file.
     */
    it("fires a due sweep row when a reader was composed, and never otherwise", async () => {
        store.ledger.schedule("sweep:owner/repo", BASE.toISOString(), "sweep");
        // Ticking against the same due row throughout, and never claiming it.
        buildShell();

        running.push(
            createShell({
                secret: SECRET,
                store,
                capabilities: [toEngine(intake)],
                seams: seamsOn(configFile),
                repository: REPOSITORY,
                tickMs: TICK_MS,
                // The reader is never reached: `intake` runs on events, so the
                // repository wants no sweeping and the firing reads nothing.
                sweep: { allowance: spending() },
                log,
            }),
        );

        await vi.waitFor(() =>
            expect(logged).toContainEqual(
                expect.objectContaining({ event: "sweepFinished", scheduleId: "sweep:owner/repo" }),
            ),
        );
        // Exactly one claim, from the one shell that was given a reader.
        expect(logged.filter((event) => event.event === "sweepClaimed")).toHaveLength(1);
    });
});

/**
 * The tick's second job: a send a worker recorded and never closed.
 *
 * Nothing here delivers anything. That is the claim — in a quiet repository
 * the only thing that could ever resolve a lost write is the clock, and these
 * cases prove it does, and that it does not when the composition root wired no
 * write path.
 */
describe("recovering effects on the clock, with no delivery to wake anything", () => {
    const ACTIVE_CONFIG = `schemaVersion: 2
mode: active
capabilities:
  intake:
    enabled: true
    announce: true
mappings:
  labels:
    awaitingTriage: "status: triage"
`;

    const LABEL = "status: triage";
    const EFFECT_ID = "orphan-effect";

    /** The open send a crashed worker left, older than one lease window. */
    function orphanRow(effectId = EFFECT_ID, number = 164): void {
        const revision = existsSync(configFile)
            ? revisionOf(readFileSync(configFile, "utf8"))
            : ABSENT_CONFIG_REVISION;
        const item = { kind: "issue", number } as const;
        store.ledger.record({
            effectId,
            seq: 1,
            kind: "sent",
            at: new Date(BASE.getTime() - 60 * 60_000).toISOString(),
            revision,
            capability: "intake",
            repository: REPOSITORY,
            item,
            verb: "addLabel",
            login: null,
            code: null,
            detail: null,
            payload: serializeCall({
                capability: "intake",
                item,
                call: { verb: "addLabel", label: LABEL },
            }),
        });
    }

    const openRows = (): number =>
        store.ledger.open(new Date(BASE.getTime() + 60 * 60_000).toISOString()).length;

    /** A read-back that dies on one item, so the pass has a row to step over. */
    const brittle = (reader: EffectReader, failing: number): EffectReader => ({
        ...reader,
        labelPresence: (item, label) =>
            item.number === failing
                ? Promise.reject(new Error("the read-back is closed"))
                : reader.labelPresence(item, label),
    });

    function shellWithWritePath(
        github: Pick<ReturnType<typeof fakeGitHub>, "writer" | "reader">,
        suspended = false,
    ): Shell {
        let tick = 0;
        const clock = (): Date => new Date(BASE.getTime() + 1000 * tick++);
        const shell = createShell({
            secret: SECRET,
            store,
            capabilities: [toEngine(intake)],
            seams: seamsOn(configFile, {
                writer: github.writer,
                reader: github.reader,
                externals: () => stubbedExternals(),
            }),
            repository: REPOSITORY,
            clock,
            tickMs: TICK_MS,
            suspended,
            log,
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
        expect(completions()).toEqual([]);
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
        const worklist = vi.spyOn(store.ledger, "open");

        shellWithWritePath(github);

        await vi.waitFor(() => expect(worklist.mock.calls.length).toBeGreaterThan(1));
        expect(github.calls).toEqual([]);
        expect(logged.filter((event) => event.event.startsWith("effect"))).toEqual([]);
        expect(openRows()).toBe(1);
    });

    it("reports a recovery pass it could not run, and keeps serving", async () => {
        writeFileSync(configFile, ACTIVE_CONFIG);
        orphanRow();
        orphanRow("second-orphan", 165);
        const github = fakeGitHub();
        // The older row is read back first, and its read is the one that dies.
        shellWithWritePath({ ...github, reader: brittle(github.reader, 164) });

        await vi.waitFor(() => {
            expect(logged).toContainEqual(
                expect.objectContaining({
                    event: "sweepFailed",
                    detail: expect.stringContaining("the read-back is closed") as string,
                }),
            );
            expect(logged).toContainEqual({
                event: "effectApplied",
                effectId: "second-orphan",
                seq: 1,
            });
        });
        // The row whose read died is left for a later tick; the other closed.
        expect(openRows()).toBe(1);
    });

    /**
     * Suspended (D171), the pass does not run at all: the open send waits for
     * the switch to lift, rather than being resent or closed against a file
     * this process is not reading.
     */
    it("runs no recovery pass while the installation is suspended", async () => {
        writeFileSync(configFile, ACTIVE_CONFIG);
        orphanRow();
        const github = fakeGitHub();
        const requeues = vi.spyOn(store.inbox, "requeueStuckDeliveries");
        const worklist = vi.spyOn(store.ledger, "open");

        shellWithWritePath(github, true);

        // Two ticks of the same sweep that would have found the row.
        await vi.waitFor(() => expect(requeues.mock.calls.length).toBeGreaterThan(1));
        expect(worklist).not.toHaveBeenCalled();
        expect(github.calls).toEqual([]);
        expect(logged.filter((event) => event.event.startsWith("effect"))).toEqual([]);
        expect(openRows()).toBe(1);
    });

    /** The row is found and passed over: no repository here has anything to resend with. */
    it("neither resends nor closes a row when no write path was wired", async () => {
        writeFileSync(configFile, ACTIVE_CONFIG);
        orphanRow();
        const requeues = vi.spyOn(store.inbox, "requeueStuckDeliveries");

        buildShell();

        // Two ticks of the same sweep that would have found the row.
        await vi.waitFor(() => expect(requeues.mock.calls.length).toBeGreaterThan(1));
        expect(logged.filter((event) => event.event.startsWith("effect"))).toEqual([]);
        expect(openRows()).toBe(1);
    });
});
