import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import { asDeliveryGuid, type DeliveryGuid } from "@hiero-hackers/automation-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as ts from "typescript";
import { Store } from "../src/store.js";

let dir: string;
let path: string;

beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "delivery-intake-test-"));
    path = join(dir, "store.sqlite");
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

function id(raw: string): DeliveryGuid {
    const deliveryId = asDeliveryGuid(raw);
    if (deliveryId === undefined) throw new Error("invalid test delivery GUID");
    return deliveryId;
}

const FIRST_ID = id("00000000-0000-0000-0000-000000000001");
const SECOND_ID = id("00000000-0000-0000-0000-000000000002");
const THIRD_ID = id("00000000-0000-0000-0000-000000000003");
const RECEIVED = "2026-08-01T10:00:00.000Z";

function accept(
    store: Store,
    deliveryId = FIRST_ID,
    eventName = "issues",
    payload: Uint8Array = Buffer.from("work"),
    receivedAt = RECEIVED,
) {
    return store.acceptDelivery({ deliveryId, eventName, payload, receivedAt });
}

type ConcurrentOperation = "accept" | "claim";

const CONTENDER_SOURCE = `
const { parentPort, workerData } = require("node:worker_threads");

(async () => {
    const { Store } = await import(workerData.storeModule);
    const store = new Store(workerData.databasePath);
    const gate = new Int32Array(workerData.gate);
    parentPort.postMessage({ type: "ready" });
    Atomics.wait(gate, 0, 0);
    let value;
    try {
        value = workerData.operation === "accept"
            ? store.acceptDelivery({
                  deliveryId: workerData.deliveryId,
                  eventName: "issues",
                  payload: Buffer.from("same bytes"),
                  receivedAt: workerData.receivedAt,
              })
            : store.claimNextDelivery(
                  workerData.worker,
                  "2026-08-01T10:01:00.000Z",
                  "2026-08-01T09:00:00.000Z",
              );
    } finally {
        store.close();
    }
    parentPort.postMessage({ type: "result", value });
})().catch((error) => {
    parentPort.postMessage({
        type: "error",
        message: error instanceof Error ? error.message : "worker failed",
    });
});
`;

function buildWorkerStoreModule(): string {
    const buildDir = join(dir, "worker-build");
    mkdirSync(buildDir, { recursive: true });
    const compilerOptions = {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
    };
    const idsSource = readFileSync(
        new URL("../../core/src/github/ids.ts", import.meta.url),
        "utf8",
    );
    const storeSource = readFileSync(new URL("../src/store.ts", import.meta.url), "utf8");
    writeFileSync(
        join(buildDir, "ids.js"),
        ts.transpileModule(idsSource, { compilerOptions }).outputText,
    );
    const storeModule = join(buildDir, "store.js");
    writeFileSync(
        storeModule,
        ts
            .transpileModule(storeSource, { compilerOptions })
            .outputText.replace("@hiero-hackers/automation-core", "./ids.js"),
    );
    return pathToFileURL(storeModule).href;
}

async function runConcurrent(operation: ConcurrentOperation): Promise<unknown[]> {
    const storeModule = buildWorkerStoreModule();
    const gate = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
    const gateView = new Int32Array(gate);
    let ready = 0;
    let completed = 0;
    const values: unknown[] = new Array(2);
    const workers = [0, 1].map(
        (index) =>
            new Worker(CONTENDER_SOURCE, {
                eval: true,
                workerData: {
                    operation,
                    storeModule,
                    databasePath: path,
                    gate,
                    deliveryId: FIRST_ID,
                    receivedAt: `2026-08-01T10:00:0${String(index)}.000Z`,
                    worker: `worker-${String(index)}`,
                },
            }),
    );

    try {
        await new Promise<void>((resolve, reject) => {
            workers.forEach((worker, index) => {
                worker.on("error", reject);
                worker.on(
                    "message",
                    (message: {
                        type: "ready" | "result" | "error";
                        value?: unknown;
                        message?: string;
                    }) => {
                        if (message.type === "ready") {
                            ready++;
                            if (ready === workers.length) {
                                Atomics.store(gateView, 0, 1);
                                Atomics.notify(gateView, 0, workers.length);
                            }
                        } else if (message.type === "error") {
                            reject(new Error(message.message ?? "worker failed"));
                        } else {
                            values[index] = message.value;
                            completed++;
                            if (completed === workers.length) resolve();
                        }
                    },
                );
            });
        });
        return values;
    } finally {
        await Promise.all(workers.map((worker) => worker.terminate()));
    }
}

describe("durable delivery acceptance", () => {
    it("uses the stable SHA-256 digest of the exact bytes", () => {
        const store = new Store(path);
        expect(accept(store)).toEqual({
            outcome: "accepted",
            state: "pending",
            payloadDigest: "00e13ed7af55b27622f1d6eab5bec0147e68efe28dc2b12461117afa1a5ed40e",
        });
        store.close();
    });

    it("persists identity and exact opaque bytes together across restart", () => {
        const payload = Buffer.concat([
            Buffer.from("Grüße 🌍", "utf8"),
            Buffer.from([0x00, 0xff, 0x80]),
        ]);
        const expectedPayload = Buffer.from(payload);
        const before = new Store(path);
        const accepted = accept(before, FIRST_ID, "pull_request", payload);
        expect(accepted).toMatchObject({ outcome: "accepted", state: "pending" });
        expect("firstSeen" in before).toBe(false);
        payload.fill(0);
        before.close();

        const restarted = new Store(path);
        const claim = restarted.claimNextDelivery(
            "worker-a",
            "2026-08-01T10:01:00.000Z",
            "2026-08-01T09:56:00.000Z",
        );
        expect(claim).toMatchObject({
            deliveryId: FIRST_ID,
            eventName: "pull_request",
            receivedAt: RECEIVED,
            worker: "worker-a",
        });
        expect(Buffer.from(claim!.payload)).toEqual(expectedPayload);
        restarted.close();
    });

    it("makes an identity-only pending row impossible even below the typed API", () => {
        const store = new Store(path);
        const db = (
            store as unknown as {
                db: { prepare(sql: string): { run(...values: unknown[]): unknown } };
            }
        ).db;
        expect(() =>
            db
                .prepare(
                    `
            INSERT INTO seen_delivery (
                delivery_id, event_name, payload, payload_digest,
                received_at, state
            ) VALUES (?, ?, NULL, ?, ?, 'pending')
        `,
                )
                .run(FIRST_ID, "issues", "0".repeat(64), RECEIVED),
        ).toThrow();
        store.close();
    });

    it("creates and freshly claims one work item under real two-thread contention", async () => {
        const setup = new Store(path);
        setup.close();

        const acceptanceResults = (await runConcurrent("accept")) as {
            outcome: string;
            state: string;
        }[];
        expect(acceptanceResults.map((result) => result.outcome).sort()).toEqual([
            "accepted",
            "duplicate",
        ]);
        expect(acceptanceResults.every((result) => result.state === "pending")).toBe(true);

        const claimResults = await runConcurrent("claim");
        expect(claimResults.filter((claim) => claim !== undefined)).toHaveLength(1);
    });

    it("reports payload and event conflicts without replacing the original work", () => {
        const store = new Store(path);
        const original = Buffer.from("original bytes");
        expect(accept(store, FIRST_ID, "issues", original).outcome).toBe("accepted");

        expect(accept(store, FIRST_ID, "issues", Buffer.from("changed bytes"))).toEqual({
            outcome: "conflict",
            state: "pending",
            eventNameMismatch: false,
            payloadMismatch: true,
        });
        expect(accept(store, FIRST_ID, "pull_request", original)).toEqual({
            outcome: "conflict",
            state: "pending",
            eventNameMismatch: true,
            payloadMismatch: false,
        });

        const claim = store.claimNextDelivery(
            "worker-a",
            "2026-08-01T10:01:00.000Z",
            "2026-08-01T09:00:00.000Z",
        );
        expect(claim?.eventName).toBe("issues");
        expect(Buffer.from(claim!.payload)).toEqual(original);
        expect(
            store.claimNextDelivery(
                "worker-b",
                "2026-08-01T10:01:00.000Z",
                "2026-08-01T09:00:00.000Z",
            ),
        ).toBeUndefined();
        store.close();
    });
});

describe("delivery claims and recovery", () => {
    it("claims in received-time then GUID order", () => {
        const store = new Store(path);
        accept(store, THIRD_ID, "issues", Buffer.from("third"), "2026-08-01T10:00:01.000Z");
        accept(store, SECOND_ID, "issues", Buffer.from("second"));
        accept(store, FIRST_ID, "issues", Buffer.from("first"));

        const order: DeliveryGuid[] = [];
        for (let index = 0; index < 3; index++) {
            const claim = store.claimNextDelivery(
                "worker-a",
                `2026-08-01T10:01:0${String(index)}.000Z`,
                "2026-08-01T09:00:00.000Z",
            );
            order.push(claim!.deliveryId);
            expect(
                store.completeDelivery(
                    claim!.deliveryId,
                    claim!.claimToken,
                    `2026-08-01T10:02:0${String(index)}.000Z`,
                ),
            ).toEqual({ outcome: "completed" });
        }
        expect(order).toEqual([FIRST_ID, SECOND_ID, THIRD_ID]);
        store.close();
    });

    it("takes over a stale claim after restart and rejects the old token", () => {
        const before = new Store(path);
        accept(before);
        const first = before.claimNextDelivery(
            "worker-a",
            "2026-08-01T10:01:00.000Z",
            "2026-08-01T09:00:00.000Z",
        )!;
        before.close();

        const restarted = new Store(path);
        expect(
            restarted.claimNextDelivery(
                "worker-b",
                "2026-08-01T10:04:00.000Z",
                "2026-08-01T10:00:00.000Z",
            ),
        ).toBeUndefined();
        const second = restarted.claimNextDelivery(
            "worker-b",
            "2026-08-01T10:10:00.000Z",
            "2026-08-01T10:05:00.000Z",
        )!;
        expect(second.deliveryId).toBe(first.deliveryId);
        expect(second.claimToken).not.toBe(first.claimToken);
        expect(
            restarted.completeDelivery(
                first.deliveryId,
                first.claimToken,
                "2026-08-01T10:11:00.000Z",
            ),
        ).toEqual({ outcome: "notOwned" });
        expect(
            restarted.completeDelivery(
                second.deliveryId,
                second.claimToken,
                "2026-08-01T10:11:00.000Z",
            ),
        ).toEqual({ outcome: "completed" });
        restarted.close();
    });

    it("releases and requeues only work owned by the matching token", () => {
        const store = new Store(path);
        accept(store);
        const first = store.claimNextDelivery(
            "worker-a",
            "2026-08-01T10:01:00.000Z",
            "2026-08-01T09:00:00.000Z",
        )!;
        expect(store.releaseDelivery(FIRST_ID, "wrong-token")).toEqual({ outcome: "notOwned" });
        expect(store.releaseDelivery(FIRST_ID, first.claimToken)).toEqual({ outcome: "released" });

        const second = store.claimNextDelivery(
            "worker-b",
            "2026-08-01T10:02:00.000Z",
            "2026-08-01T09:00:00.000Z",
        )!;
        expect(store.requeueStuckDeliveries("2026-08-01T10:01:59.999Z")).toEqual([]);
        expect(store.requeueStuckDeliveries("2026-08-01T10:02:00.000Z")).toEqual([FIRST_ID]);
        expect(
            store.completeDelivery(FIRST_ID, second.claimToken, "2026-08-01T10:03:00.000Z"),
        ).toEqual({ outcome: "notOwned" });
        store.close();
    });
});

describe("delivery completion and retention", () => {
    it("clears completed payload bytes but retains identity and digest for duplicate detection", () => {
        const store = new Store(path);
        const payload = Buffer.from("discard after completion");
        const accepted = accept(store, FIRST_ID, "issues", payload);
        const claim = store.claimNextDelivery(
            "worker-a",
            "2026-08-01T10:01:00.000Z",
            "2026-08-01T09:00:00.000Z",
        )!;
        expect(
            store.completeDelivery(FIRST_ID, claim.claimToken, "2026-08-01T10:02:00.000Z"),
        ).toEqual({ outcome: "completed" });

        const db = (
            store as unknown as {
                db: { prepare(sql: string): { get(id: string): Record<string, unknown> } };
            }
        ).db;
        expect(
            db
                .prepare(
                    `
            SELECT payload, payload_digest, state, completed_at
            FROM seen_delivery WHERE delivery_id = ?
        `,
                )
                .get(FIRST_ID),
        ).toEqual({
            payload: null,
            payload_digest:
                accepted.outcome === "accepted" ? accepted.payloadDigest : "unreachable",
            state: "done",
            completed_at: "2026-08-01T10:02:00.000Z",
        });
        expect(accept(store, FIRST_ID, "issues", payload)).toMatchObject({
            outcome: "duplicate",
            state: "done",
        });
        expect(accept(store, FIRST_ID, "issues", Buffer.from("different"))).toEqual({
            outcome: "conflict",
            state: "done",
            eventNameMismatch: false,
            payloadMismatch: true,
        });
        expect(accept(store, FIRST_ID, "pull_request", payload)).toEqual({
            outcome: "conflict",
            state: "done",
            eventNameMismatch: true,
            payloadMismatch: false,
        });
        store.close();
    });

    it("never prunes pending or processing work and prunes only old completed rows", () => {
        const store = new Store(path);
        accept(store, FIRST_ID, "issues", Buffer.from("pending"), "2026-01-01T00:00:00.000Z");
        accept(store, SECOND_ID, "issues", Buffer.from("processing"), "2026-01-01T00:00:00.000Z");
        accept(store, THIRD_ID, "issues", Buffer.from("done"), "2026-01-01T00:00:00.000Z");

        const processing = store.claimNextDelivery(
            "worker-a",
            "2026-01-02T00:00:00.000Z",
            "2025-01-01T00:00:00.000Z",
        )!;
        expect(processing.deliveryId).toBe(FIRST_ID);
        const done = store.claimNextDelivery(
            "worker-b",
            "2026-01-02T00:00:00.000Z",
            "2025-01-01T00:00:00.000Z",
        )!;
        expect(done.deliveryId).toBe(SECOND_ID);
        expect(
            store.completeDelivery(done.deliveryId, done.claimToken, "2026-02-01T00:00:00.000Z"),
        ).toEqual({ outcome: "completed" });

        expect(store.pruneCompletedDeliveries("2026-01-31T23:59:59.999Z")).toBe(0);
        expect(store.pruneCompletedDeliveries("2026-02-01T00:00:00.000Z")).toBe(1);
        expect(
            store.claimNextDelivery(
                "worker-c",
                "2026-03-01T00:00:00.000Z",
                "2025-01-01T00:00:00.000Z",
            )?.deliveryId,
        ).toBe(THIRD_ID);
        expect(accept(store, FIRST_ID, "issues", Buffer.from("pending"))).toMatchObject({
            outcome: "duplicate",
            state: "processing",
        });
        store.close();
    });
});

describe("delivery intake boundaries", () => {
    it("fails closed on malformed identifiers, empty names, non-bytes, and invalid timestamps", () => {
        expect(asDeliveryGuid("")).toBeUndefined();
        expect(asDeliveryGuid("123")).toBeUndefined();
        const store = new Store(path);
        expect(() => accept(store, "" as DeliveryGuid)).toThrow(TypeError);
        expect(() => accept(store, FIRST_ID, " ")).toThrow(TypeError);
        expect(() =>
            store.acceptDelivery({
                deliveryId: FIRST_ID,
                eventName: "issues",
                // @ts-expect-error Runtime callers can violate the typed boundary.
                payload: "not bytes",
                receivedAt: RECEIVED,
            }),
        ).toThrow(TypeError);
        expect(() =>
            accept(store, FIRST_ID, "issues", Buffer.from("secret-payload"), "invalid"),
        ).toThrowError(/receivedAt/);
        try {
            accept(store, FIRST_ID, "issues", Buffer.from("secret-payload"), "invalid");
        } catch (error) {
            expect(String(error)).not.toContain("secret-payload");
        }
        expect(() => store.claimNextDelivery("worker", "invalid", RECEIVED)).toThrow(TypeError);
        expect(() => store.claimNextDelivery("worker", RECEIVED, "invalid")).toThrow(TypeError);
        expect(() => store.requeueStuckDeliveries("invalid")).toThrow(TypeError);
        expect(() => store.completeDelivery(FIRST_ID, "token", "invalid")).toThrow(TypeError);
        expect(() => store.pruneCompletedDeliveries("invalid")).toThrow(TypeError);
        expect(() => store.claimNextDelivery("", RECEIVED, RECEIVED)).toThrow(TypeError);
        expect(() => store.releaseDelivery(FIRST_ID, "")).toThrow(TypeError);
        store.close();
    });

    it("releases every SQLite handle so the database can be removed on Windows", () => {
        const a = new Store(path);
        const b = new Store(path);
        accept(a);
        expect(accept(b).outcome).toBe("duplicate");
        a.close();
        b.close();

        rmSync(path);
        expect(existsSync(path)).toBe(false);
    });

    it("rejects the pre-ratification GUID-only schema and closes the failed handle", () => {
        const legacy = new DatabaseSync(path);
        legacy.exec(`
            CREATE TABLE seen_delivery (
                delivery_id TEXT PRIMARY KEY,
                at TEXT NOT NULL
            )
        `);
        legacy.close();

        expect(() => new Store(path)).toThrow(/incompatible pre-ratification/);
        rmSync(path);
        expect(existsSync(path)).toBe(false);
    });
});
