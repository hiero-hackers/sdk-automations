/**
 * Branch-level tests for the recovery executor: each arm of the
 * storage-decision flowchart, the two surfaced stops, the claim
 * lifecycle — and the demonstration of the failure the read-back
 * exists to prevent.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "@hiero-hackers/automation-store";
import {
    RecoveryExecutor,
    MAX_CALL_ATTEMPTS,
    commandIdentity,
    type EffectPort,
    type EffectPlan,
} from "../src/recovery.js";
import { FakeWorld, CrashingPort, fixtureCommand, LEASE_MS } from "./harness.js";

const PLAN: EffectPlan = {
    effectId: "e1",
    revision: "config-sha-1",
    calls: [
        {
            seq: 1,
            command: fixtureCommand("applyMappedLabel"),
            idempotencyClass: "idempotent",
        },
        {
            seq: 2,
            command: fixtureCommand("postManagedComment"),
            idempotencyClass: "nonIdempotent",
        },
        {
            seq: 3,
            command: fixtureCommand("unassign"),
            idempotencyClass: "idempotent",
        },
    ],
};
const T = "2026-07-25T12:00:00.000Z";

let dir: string;
let path: string;
beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "executor-test-"));
    path = join(dir, "store.sqlite");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const executor = (store: Store, port: EffectPort, worker = "w1") =>
    new RecoveryExecutor(store, port, worker, () => T, LEASE_MS);

describe("flowchart branches", () => {
    it("neverStarted runs the whole plan once and releases the claim", async () => {
        const store = new Store(path);
        const world = new FakeWorld();
        const port = new CrashingPort(world, new Map());
        await expect(executor(store, port).runEffect(PLAN)).resolves.toEqual({
            outcome: "complete",
        });
        for (const call of PLAN.calls) expect(world.applications(PLAN, call)).toBe(1);
        // Released: a new worker could claim immediately, no staleness needed.
        expect(store.claim("e1", "w2", T, "2026-07-25T11:55:00.000Z")).toBe(true);
        store.close();
    });

    it("complete is a no-op — redelivery does not re-run a finished effect", async () => {
        const store = new Store(path);
        const world = new FakeWorld();
        await executor(store, new CrashingPort(world, new Map())).runEffect(PLAN);
        const port = new CrashingPort(world, new Map());
        await expect(executor(store, port, "w2").runEffect(PLAN)).resolves.toEqual({
            outcome: "complete",
        });
        expect(world.applications(PLAN, PLAN.calls[1]!)).toBe(1); // still once
        store.close();
    });

    it("midSequence resumes after the last done call", async () => {
        const store = new Store(path);
        store.intent("e1", 1, commandIdentity(PLAN.calls[0]!.command), T, PLAN.revision);
        store.done("e1", 1, T);
        const world = new FakeWorld();
        const port = new CrashingPort(world, new Map());
        await expect(executor(store, port).runEffect(PLAN)).resolves.toEqual({
            outcome: "complete",
        });
        expect(world.applications(PLAN, PLAN.calls[0]!)).toBe(0); // not re-run
        expect(world.applications(PLAN, PLAN.calls[1]!)).toBe(1);
        expect(world.applications(PLAN, PLAN.calls[2]!)).toBe(1);
        store.close();
    });

    it("sentUnknown + present resolves WITHOUT re-performing — the receipt is the read-back", async () => {
        const store = new Store(path);
        const world = new FakeWorld();
        // The 6.5 lost-response case: the create landed, the response died.
        store.intent("e1", 1, commandIdentity(PLAN.calls[0]!.command), T, PLAN.revision);
        store.done("e1", 1, T);
        store.intent("e1", 2, commandIdentity(PLAN.calls[1]!.command), T, PLAN.revision);
        world.apply(PLAN, PLAN.calls[1]!); // landed on GitHub
        const port = new CrashingPort(world, new Map());
        await expect(executor(store, port).runEffect(PLAN)).resolves.toEqual({
            outcome: "complete",
        });
        expect(world.applications(PLAN, PLAN.calls[1]!)).toBe(1); // NOT duplicated
        expect(port.readBacks).toEqual(["2:postManagedComment"]); // resolved, not guessed
        store.close();
    });

    it("sentUnknown + absent re-sends that call, incrementing the durable attempt", async () => {
        const store = new Store(path);
        const world = new FakeWorld();
        store.intent("e1", 1, commandIdentity(PLAN.calls[0]!.command), T, PLAN.revision);
        store.done("e1", 1, T);
        store.intent("e1", 2, commandIdentity(PLAN.calls[1]!.command), T, PLAN.revision); // died before the request left
        const port = new CrashingPort(world, new Map());
        await expect(executor(store, port).runEffect(PLAN)).resolves.toEqual({
            outcome: "complete",
        });
        expect(world.applications(PLAN, PLAN.calls[1]!)).toBe(1);
        store.close();
        const reopened = new Store(path);
        expect(reopened.effectState("e1", 3)).toMatchObject({ state: "complete" });
        reopened.close();
    });
});

describe("surfaced stops", () => {
    it("the same intent from an old configuration revision is unresolved, never remapped", async () => {
        const store = new Store(path);
        store.intent("e1", 1, "list-comments", T, "old-config-sha");
        const port = new CrashingPort(new FakeWorld(), new Map());
        const result = await executor(store, port).runEffect(PLAN);
        expect(result).toMatchObject({ outcome: "unresolved", seq: 1 });
        if (result.outcome === "unresolved") {
            expect(result.reason).toContain("revision");
        }
        store.close();
    });

    it("a mid-sequence effect from an old revision is unresolved too", async () => {
        const store = new Store(path);
        store.intent("e1", 1, "list-comments", T, "old-config-sha");
        store.done("e1", 1, T);
        const port = new CrashingPort(new FakeWorld(), new Map());
        const result = await executor(store, port).runEffect(PLAN);
        expect(result).toMatchObject({ outcome: "unresolved", seq: 1 });
        store.close();
    });

    it("a materially changed command does not match an open journal entry", async () => {
        const store = new Store(path);
        const original = PLAN.calls[1]!;
        store.intent(
            PLAN.effectId,
            original.seq,
            commandIdentity(original.command),
            T,
            PLAN.revision,
        );
        const changed: EffectPlan = {
            ...PLAN,
            calls: PLAN.calls.map((call) =>
                call.seq === original.seq
                    ? { ...call, command: fixtureCommand("postManagedComment", "-changed") }
                    : call,
            ),
        };
        const port = new CrashingPort(new FakeWorld(), new Map());

        await expect(executor(store, port).runEffect(changed)).resolves.toMatchObject({
            outcome: "unresolved",
            seq: original.seq,
        });
        expect(port.readBacks).toEqual([]);
        store.close();
    });

    /**
     * The counterpart, and the boundary of the revision guard: a
     * COMPLETE effect has nothing left to resume, so a later
     * configuration edit must not resurrect it as operator work.
     * Config reload is event-driven within seconds (6.3) and done rows
     * live 90 days (D43), so guarding `complete` would turn ordinary
     * redeliveries into a steady trickle of surfaced items.
     */
    it("a COMPLETE effect is not resurrected by a later configuration revision", async () => {
        const store = new Store(path);
        const world = new FakeWorld();
        await executor(store, new CrashingPort(world, new Map())).runEffect(PLAN);

        const afterConfigEdit: EffectPlan = {
            ...PLAN,
            revision: "config-sha-2",
            calls: PLAN.calls.map((call) => ({
                ...call,
                command: {
                    ...call.command,
                    configurationRevision: "config-sha-2",
                },
            })),
        };
        const port = new CrashingPort(world, new Map());
        await expect(executor(store, port, "w2").runEffect(afterConfigEdit)).resolves.toEqual({
            outcome: "complete",
        });
        // And nothing was re-performed to reach that answer.
        expect(world.applications(PLAN, PLAN.calls[1]!)).toBe(1);
        expect(port.readBacks).toEqual([]);
        store.close();
    });

    it("a call at the attempt bound surfaces instead of retrying forever", async () => {
        const store = new Store(path);
        for (let i = 0; i < MAX_CALL_ATTEMPTS; i++) {
            store.intent("e1", 1, commandIdentity(PLAN.calls[0]!.command), T, PLAN.revision);
        }
        const port = new CrashingPort(new FakeWorld(), new Map());
        const result = await executor(store, port).runEffect(PLAN);
        expect(result).toMatchObject({ outcome: "unresolved", seq: 1 });
        if (result.outcome === "unresolved") {
            expect(result.reason).toContain("re-sent");
        }
        store.close();
    });

    it("at the attempt bound, a present effect reconciles before the resend bound is applied", async () => {
        const store = new Store(path);
        const world = new FakeWorld();
        const call = PLAN.calls[0]!;
        for (let i = 0; i < MAX_CALL_ATTEMPTS; i++) {
            store.intent("e1", 1, commandIdentity(call.command), T, PLAN.revision);
        }
        world.apply(PLAN, call);
        const port = new CrashingPort(world, new Map());
        await expect(executor(store, port).runEffect(PLAN)).resolves.toEqual({
            outcome: "complete",
        });
        expect(world.applications(PLAN, call)).toBe(1);
        expect(port.readBacks).toEqual(["1:applyMappedLabel"]);
        store.close();
    });

    it("a live competing claim yields anotherWorker without touching the world", async () => {
        const store = new Store(path);
        store.claim("e1", "other", T, "2026-07-25T11:55:00.000Z");
        const world = new FakeWorld();
        const port = new CrashingPort(world, new Map());
        await expect(executor(store, port).runEffect(PLAN)).resolves.toEqual({
            outcome: "anotherWorker",
        });
        for (const call of PLAN.calls) expect(world.applications(PLAN, call)).toBe(0);
        store.close();
    });

    it("a malformed plan (non-contiguous seqs) rejects a caller bug", async () => {
        const store = new Store(path);
        const port = new CrashingPort(new FakeWorld(), new Map());
        await expect(
            executor(store, port).runEffect({
                effectId: "bad",
                revision: "config-sha-1",
                calls: [
                    {
                        seq: 2,
                        command: fixtureCommand("unassign"),
                        idempotencyClass: "idempotent",
                    },
                ],
            }),
        ).rejects.toThrow(TypeError);
        store.close();
    });

    it("rejects a call authorized by a different configuration revision", async () => {
        const store = new Store(path);
        const port = new CrashingPort(new FakeWorld(), new Map());
        await expect(
            executor(store, port).runEffect({
                ...PLAN,
                calls: [
                    {
                        ...PLAN.calls[0]!,
                        command: {
                            ...PLAN.calls[0]!.command,
                            configurationRevision: "other-revision",
                        },
                    },
                ],
            }),
        ).rejects.toThrow(TypeError);
        store.close();
    });
});

describe("why the read-back exists", () => {
    it("a blind retry after a lost response duplicates the comment — the 6.5 failure, reproduced", () => {
        // No executor here: this drives the naive protocol directly to
        // show the world state the recovery loop prevents.
        const store = new Store(path);
        const world = new FakeWorld();
        const call = PLAN.calls[1]!;
        store.intent("e1", 2, commandIdentity(call.command), T, PLAN.revision);
        world.apply(PLAN, call); // landed; response lost
        // Naive retry: no read-back, just send again.
        store.intent("e1", 2, commandIdentity(call.command), T, PLAN.revision);
        world.apply(PLAN, call);
        expect(world.applications(PLAN, call)).toBe(2); // the duplicate
        store.close();
    });
});

describe("asynchronous adapter boundary", () => {
    it("does not mark a call done or release its claim before perform settles", async () => {
        const store = new Store(path);
        let settle!: () => void;
        const pending = new Promise<void>((resolve) => {
            settle = resolve;
        });
        const port: EffectPort = {
            perform: async () => pending,
            readBack: async () => "absent",
        };
        const oneCall: EffectPlan = {
            effectId: "async-effect",
            revision: "config-sha-1",
            calls: [
                {
                    seq: 1,
                    command: fixtureCommand("postManagedComment"),
                    idempotencyClass: "nonIdempotent",
                },
            ],
        };

        const run = executor(store, port).runEffect(oneCall);
        await Promise.resolve();
        expect(store.effectState(oneCall.effectId, 1)).toMatchObject({
            state: "sentUnknown",
        });
        expect(store.claim(oneCall.effectId, "w2", T, "2026-07-25T11:55:00.000Z")).toBe(false);

        settle();
        await expect(run).resolves.toEqual({ outcome: "complete" });
        expect(store.effectState(oneCall.effectId, 1)).toMatchObject({
            state: "complete",
        });
        store.close();
    });
});
