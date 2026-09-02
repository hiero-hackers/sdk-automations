/**
 * The delivery's only completion boundary: canonical report plus done, under
 * one claim token. Worker exits exercise SQLite recovery with independent
 * connections rather than sequential promises posing as contention.
 */

import { rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { Worker } from "node:worker_threads";
import { beforeEach, describe, expect, it } from "vitest";
import { asDeliveryGuid } from "@hiero-hackers/automation-core";
import { useTempDir } from "@hiero-hackers/automation-testkit";
import { Store } from "../src/store.js";
import type { ClaimedDelivery, CompleteDeliveryWithReportInput } from "../src/deliveries.js";
import { buildWorkerStoreModule } from "./worker-build.js";

const temp = useTempDir("delivery-finalization-");
let databasePath: string;

beforeEach(() => {
    databasePath = temp.file("store.sqlite");
});

const DELIVERY_ID = asDeliveryGuid("00000000-0000-0000-0000-000000000001")!;
const SECOND_DELIVERY_ID = asDeliveryGuid("00000000-0000-0000-0000-000000000002")!;
const THIRD_DELIVERY_ID = asDeliveryGuid("00000000-0000-0000-0000-000000000003")!;
const RECEIVED_AT = "2026-08-01T10:00:00.000Z";
const COMPLETED_AT = "2026-08-01T10:02:00.000Z";
const REPORT_JSON = JSON.stringify({
    kind: "decision",
    deliveryId: DELIVERY_ID,
});

function acceptAndClaim(store: Store, deliveryId = DELIVERY_ID): ClaimedDelivery {
    store.acceptDelivery({
        deliveryId,
        eventName: "issues",
        payload: Buffer.from("work"),
        receivedAt: RECEIVED_AT,
    });
    return store.claimNextDelivery(
        "worker-a",
        "2026-08-01T10:01:00.000Z",
        "2026-08-01T09:00:00.000Z",
    )!;
}

function completion(
    claim: ClaimedDelivery,
    overrides: Partial<CompleteDeliveryWithReportInput> = {},
): CompleteDeliveryWithReportInput {
    return {
        deliveryId: claim.deliveryId,
        eventName: claim.eventName,
        payloadDigest: claim.payloadDigest,
        claimToken: claim.claimToken,
        reportJson: REPORT_JSON,
        completedAt: COMPLETED_AT,
        ...overrides,
    };
}

function durableOutcome(): {
    readonly delivery: Record<string, unknown>;
    readonly reports: Record<string, unknown>[];
} {
    const db = new DatabaseSync(databasePath);
    const delivery = db
        .prepare(
            `
        SELECT state, payload, claim_token, completed_at
        FROM seen_delivery WHERE delivery_id = ?
    `,
        )
        .get(DELIVERY_ID) as Record<string, unknown>;
    const reports = db
        .prepare(
            `
        SELECT delivery_id, claim_token, report_json, completed_at
        FROM delivery_report ORDER BY delivery_id
    `,
        )
        .all() as Record<string, unknown>[];
    db.close();
    return { delivery, reports };
}

const FINALIZER_SOURCE = `
const { parentPort, workerData } = require("node:worker_threads");

(async () => {
    const { Store } = await import(workerData.storeModule);
    const store = new Store(workerData.databasePath, {
        injectFault(point) {
            if (point === workerData.faultPoint) process.exit(23);
        },
    });
    const gate = new Int32Array(workerData.gate);
    parentPort.postMessage({ type: "ready" });
    Atomics.wait(gate, 0, 0);
    const value = store.completeDeliveryWithReport(workerData.input);
    store.close();
    parentPort.postMessage({ type: "result", value });
})().catch((error) => {
    parentPort.postMessage({
        type: "error",
        message: error instanceof Error ? error.message : "worker failed",
    });
});
`;

interface WorkerOutcome {
    readonly value?: { readonly outcome: string };
    readonly exitCode?: number;
}

async function runFinalizers(
    work: ReadonlyArray<{
        readonly input: CompleteDeliveryWithReportInput;
        readonly faultPoint?: string;
    }>,
): Promise<WorkerOutcome[]> {
    const storeModule = buildWorkerStoreModule(temp.dir);
    const gate = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
    const gateView = new Int32Array(gate);
    let ready = 0;
    const workers: Worker[] = [];

    const results = work.map(
        (item) =>
            new Promise<WorkerOutcome>((resolve, reject) => {
                const worker = new Worker(FINALIZER_SOURCE, {
                    eval: true,
                    workerData: {
                        storeModule,
                        databasePath,
                        gate,
                        input: item.input,
                        faultPoint: item.faultPoint,
                    },
                });
                workers.push(worker);
                let settled = false;
                worker.on("error", reject);
                worker.on(
                    "message",
                    (message: {
                        type: "ready" | "result" | "error";
                        value?: { outcome: string };
                        message?: string;
                    }) => {
                        if (message.type === "ready") {
                            ready++;
                            if (ready === work.length) {
                                Atomics.store(gateView, 0, 1);
                                Atomics.notify(gateView, 0, work.length);
                            }
                        } else if (message.type === "error") {
                            reject(new Error(message.message ?? "worker failed"));
                        } else {
                            if (message.value === undefined) {
                                reject(new Error("worker returned no result"));
                                return;
                            }
                            settled = true;
                            resolve({ value: message.value });
                        }
                    },
                );
                worker.on("exit", (exitCode) => {
                    if (!settled) resolve({ exitCode });
                });
            }),
    );

    try {
        return await Promise.all(results);
    } finally {
        await Promise.all(workers.map((worker) => worker.terminate()));
    }
}

describe("atomic report completion", () => {
    it("commits the canonical report and done state together, then retries idempotently", () => {
        const store = new Store(databasePath);
        const claim = acceptAndClaim(store);
        const input = completion(claim);

        expect(store.completeDeliveryWithReport(input)).toEqual({
            outcome: "completed",
        });
        expect(
            store.completeDeliveryWithReport({
                ...input,
                completedAt: "2026-08-01T10:03:00.000Z",
            }),
        ).toEqual({ outcome: "alreadyCompleted" });
        expect(store.deliveryReports()).toEqual([
            {
                deliveryId: DELIVERY_ID,
                reportJson: REPORT_JSON,
                completedAt: COMPLETED_AT,
            },
        ]);
        store.close();

        expect(durableOutcome()).toEqual({
            delivery: {
                state: "done",
                payload: null,
                claim_token: null,
                completed_at: COMPLETED_AT,
            },
            reports: [
                {
                    delivery_id: DELIVERY_ID,
                    claim_token: claim.claimToken,
                    report_json: REPORT_JSON,
                    completed_at: COMPLETED_AT,
                },
            ],
        });
    });

    it("rejects released claims, mismatched identities, and conflicting retries", () => {
        const store = new Store(databasePath);
        const released = acceptAndClaim(store);
        expect(store.releaseDelivery(DELIVERY_ID, released.claimToken)).toEqual({
            outcome: "released",
        });
        expect(store.completeDeliveryWithReport(completion(released))).toEqual({
            outcome: "notOwned",
        });

        const current = store.claimNextDelivery(
            "worker-b",
            "2026-08-01T10:01:30.000Z",
            "2026-08-01T09:00:00.000Z",
        )!;
        expect(
            store.completeDeliveryWithReport(
                completion(current, {
                    eventName: "pull_request",
                }),
            ),
        ).toEqual({ outcome: "identityMismatch" });
        expect(
            store.completeDeliveryWithReport(
                completion(current, {
                    payloadDigest: "1".repeat(64),
                }),
            ),
        ).toEqual({ outcome: "identityMismatch" });
        expect(
            store.completeDeliveryWithReport(
                completion(current, {
                    deliveryId: SECOND_DELIVERY_ID,
                }),
            ),
        ).toEqual({ outcome: "identityMismatch" });
        expect(store.completeDeliveryWithReport(completion(current))).toEqual({
            outcome: "completed",
        });
        expect(
            store.completeDeliveryWithReport(
                completion(current, {
                    reportJson: JSON.stringify({ kind: "different" }),
                }),
            ),
        ).toEqual({ outcome: "reportConflict" });
        store.close();

        expect(durableOutcome().reports).toHaveLength(1);
    });

    it("fails closed on malformed report-boundary inputs", () => {
        const store = new Store(databasePath);
        const claim = acceptAndClaim(store);
        const input = completion(claim);

        expect(() =>
            store.completeDeliveryWithReport({
                ...input,
                payloadDigest: "not-a-digest",
            }),
        ).toThrow(/payloadDigest/);
        expect(() =>
            store.completeDeliveryWithReport({
                ...input,
                payloadDigest: `${claim.payloadDigest}0`,
            }),
        ).toThrow("payloadDigest must be a lowercase SHA-256 digest");
        expect(() =>
            store.completeDeliveryWithReport({
                ...input,
                eventName: "",
            }),
        ).toThrow("eventName must be a non-empty string");
        expect(() =>
            store.completeDeliveryWithReport({
                ...input,
                reportJson: "[]",
            }),
        ).toThrow("reportJson must be a JSON object");
        for (const reportJson of ["null", "1", '"text"', "false"]) {
            expect(() =>
                store.completeDeliveryWithReport({
                    ...input,
                    reportJson,
                }),
            ).toThrow("reportJson must be a JSON object");
        }
        expect(() =>
            store.completeDeliveryWithReport({
                ...input,
                reportJson: "not-json",
            }),
        ).toThrow("reportJson must be a JSON object");
        expect(() =>
            store.completeDeliveryWithReport({
                ...input,
                deliveryId: "not-a-guid" as typeof input.deliveryId,
            }),
        ).toThrow("deliveryId must be a valid GitHub delivery GUID");
        expect(() =>
            store.releaseDelivery("not-a-guid" as typeof input.deliveryId, claim.claimToken),
        ).toThrow("deliveryId must be a valid GitHub delivery GUID");
        store.close();
    });

    it("rejects a different token after completion and an impossible early report", () => {
        const store = new Store(databasePath);
        const claim = acceptAndClaim(store);
        const input = completion(claim);
        expect(store.completeDeliveryWithReport(input)).toEqual({
            outcome: "completed",
        });
        expect(
            store.completeDeliveryWithReport({
                ...input,
                claimToken: "a-different-claim-token",
            }),
        ).toEqual({ outcome: "notOwned" });
        expect(store.completeDeliveryWithReport(input)).toEqual({
            outcome: "alreadyCompleted",
        });
        store.close();

        rmSync(databasePath);
        const fresh = new Store(databasePath);
        const freshClaim = acceptAndClaim(fresh);
        const corruptor = new DatabaseSync(databasePath);
        corruptor
            .prepare(
                `INSERT INTO delivery_report
                 (delivery_id, claim_token, report_json, completed_at)
                 VALUES (?, ?, ?, ?)`,
            )
            .run(DELIVERY_ID, freshClaim.claimToken, REPORT_JSON, COMPLETED_AT);
        corruptor.close();
        expect(fresh.completeDeliveryWithReport(completion(freshClaim))).toEqual({
            outcome: "reportConflict",
        });
        expect(fresh.completeDeliveryWithReport(completion(freshClaim))).toEqual({
            outcome: "reportConflict",
        });
        fresh.close();
    });

    it("rolls back an inserted report when the owned delivery invariant is damaged", () => {
        const store = new Store(databasePath);
        const claim = acceptAndClaim(store);
        const db = (store as unknown as { db: DatabaseSync }).db;
        db.exec("PRAGMA ignore_check_constraints = ON");
        db.prepare("UPDATE seen_delivery SET state = 'pending' WHERE delivery_id = ?").run(
            DELIVERY_ID,
        );

        expect(() => store.completeDeliveryWithReport(completion(claim))).toThrow(
            "delivery ownership changed under its write transaction",
        );
        expect(db.prepare("SELECT count(*) AS count FROM delivery_report").get()).toEqual({
            count: 0,
        });
        store.close();
    });

    it("lists canonical reports by completion time then delivery identity", () => {
        const store = new Store(databasePath);
        for (const [deliveryId, completedAt] of [
            [THIRD_DELIVERY_ID, "2026-08-01T10:03:00.000Z"],
            [DELIVERY_ID, "2026-08-01T10:04:00.000Z"],
            [SECOND_DELIVERY_ID, "2026-08-01T10:03:00.000Z"],
        ] as const) {
            const claim = acceptAndClaim(store, deliveryId);
            expect(
                store.completeDeliveryWithReport(
                    completion(claim, {
                        reportJson: JSON.stringify({ deliveryId }),
                        completedAt,
                    }),
                ),
            ).toEqual({ outcome: "completed" });
        }

        expect(store.deliveryReports().map((report) => report.deliveryId)).toEqual([
            SECOND_DELIVERY_ID,
            THIRD_DELIVERY_ID,
            DELIVERY_ID,
        ]);
        store.close();
    });

    it("prunes a completed delivery and its canonical report in one retention operation", () => {
        const store = new Store(databasePath);
        const claim = acceptAndClaim(store);
        expect(store.completeDeliveryWithReport(completion(claim))).toEqual({
            outcome: "completed",
        });
        expect(store.pruneCompletedDeliveries(COMPLETED_AT)).toBe(1);
        store.close();

        const db = new DatabaseSync(databasePath);
        expect(db.prepare("SELECT count(*) AS count FROM seen_delivery").get()).toEqual({
            count: 0,
        });
        expect(db.prepare("SELECT count(*) AS count FROM delivery_report").get()).toEqual({
            count: 0,
        });
        db.close();
    });
});

describe("dead-lettering", () => {
    /** One failed attempt against a claim, spending a two-attempt budget. */
    function fail(store: Store, claim: ClaimedDelivery, failedAt: string) {
        return store.releaseDeliveryAfterFailure({
            deliveryId: claim.deliveryId,
            claimToken: claim.claimToken,
            failedAt,
            retryNotBefore: failedAt,
            maxAttempts: 2,
        });
    }

    it("stops claiming a delivery at its cap and keeps it inspectable", () => {
        const store = new Store(databasePath);
        const first = acceptAndClaim(store);
        expect(fail(store, first, "2026-08-01T10:01:10.000Z")).toEqual({
            outcome: "retryScheduled",
            attempts: 1,
            retryNotBefore: "2026-08-01T10:01:10.000Z",
        });

        const second = store.claimNextDelivery(
            "worker-a",
            "2026-08-01T10:01:20.000Z",
            "2026-08-01T09:00:00.000Z",
        )!;
        expect(second.attempts).toBe(1);
        expect(fail(store, second, COMPLETED_AT)).toEqual({
            outcome: "deadLettered",
            attempts: 2,
        });

        // Claimable by no worker, at any later instant, stale window included.
        expect(
            store.claimNextDelivery(
                "worker-b",
                "2026-09-01T00:00:00.000Z",
                "2026-08-31T00:00:00.000Z",
            ),
        ).toBeUndefined();
        expect(store.deadLetteredDeliveries()).toEqual([
            {
                deliveryId: DELIVERY_ID,
                eventName: "issues",
                payloadDigest: first.payloadDigest,
                receivedAt: RECEIVED_AT,
                attempts: 2,
                failedAt: COMPLETED_AT,
            },
        ]);
        // Still the same delivery to a redelivery, and never pruned as done.
        expect(
            store.acceptDelivery({
                deliveryId: DELIVERY_ID,
                eventName: "issues",
                payload: Buffer.from("work"),
                receivedAt: RECEIVED_AT,
            }),
        ).toMatchObject({ outcome: "duplicate", state: "failed" });
        expect(store.pruneCompletedDeliveries("2026-12-01T00:00:00.000Z")).toBe(0);
        store.close();

        // The bytes a redrive would need outlive the failure, unlike a
        // completed delivery's, which its canonical report replaces.
        const db = new DatabaseSync(databasePath);
        const row = db
            .prepare("SELECT state, payload, completed_at FROM seen_delivery WHERE delivery_id = ?")
            .get(DELIVERY_ID) as Record<string, unknown>;
        expect(row.state).toBe("failed");
        expect(row.completed_at).toBe(COMPLETED_AT);
        expect(Buffer.from(row.payload as Uint8Array)).toEqual(Buffer.from("work"));
        db.close();
    });

    it("lists dead letters in dead-letter time then delivery identity", () => {
        const store = new Store(databasePath);
        for (const [deliveryId, failedAt] of [
            [THIRD_DELIVERY_ID, "2026-08-01T10:04:00.000Z"],
            [DELIVERY_ID, "2026-08-01T10:05:00.000Z"],
            [SECOND_DELIVERY_ID, "2026-08-01T10:04:00.000Z"],
        ] as const) {
            const claim = acceptAndClaim(store, deliveryId);
            expect(
                store.releaseDeliveryAfterFailure({
                    deliveryId,
                    claimToken: claim.claimToken,
                    failedAt,
                    retryNotBefore: failedAt,
                    maxAttempts: 1,
                }),
            ).toEqual({ outcome: "deadLettered", attempts: 1 });
        }

        expect(store.deadLetteredDeliveries().map((entry) => entry.deliveryId)).toEqual([
            SECOND_DELIVERY_ID,
            THIRD_DELIVERY_ID,
            DELIVERY_ID,
        ]);
        store.close();
    });
});

describe("crash boundaries", () => {
    it.each([
        "finalize:reportPersisted",
        "finalize:deliveryCompleted",
        "finalize:committed",
    ] as const)(
        "a thrown fault at %s exposes the same rollback-or-commit boundary in-process",
        (faultPoint) => {
            let faulted = false;
            const store = new Store(databasePath, {
                injectFault: (point) => {
                    if (point === faultPoint && !faulted) {
                        faulted = true;
                        throw new Error(`fault ${point}`);
                    }
                },
            });
            const claim = acceptAndClaim(store);

            expect(() => store.completeDeliveryWithReport(completion(claim))).toThrow(
                `fault ${faultPoint}`,
            );
            const committed = faultPoint === "finalize:committed";
            expect(store.completeDeliveryWithReport(completion(claim))).toEqual({
                outcome: committed ? "alreadyCompleted" : "completed",
            });
            store.close();

            const outcome = durableOutcome();
            expect(outcome.delivery.state).toBe("done");
            expect(outcome.reports).toHaveLength(1);
        },
    );

    it.each([
        ["finalize:reportPersisted", "processing", 0],
        ["finalize:deliveryCompleted", "processing", 0],
        ["finalize:committed", "done", 1],
    ] as const)(
        "a worker exit at %s leaves neither outcome or both",
        async (faultPoint, expectedState, expectedReports) => {
            const setup = new Store(databasePath);
            const claim = acceptAndClaim(setup);
            setup.close();

            expect(
                await runFinalizers([
                    {
                        input: completion(claim),
                        faultPoint,
                    },
                ]),
            ).toEqual([{ exitCode: 23 }]);
            const outcome = durableOutcome();
            expect(outcome.delivery.state).toBe(expectedState);
            expect(outcome.reports).toHaveLength(expectedReports);

            const restarted = new Store(databasePath);
            expect(restarted.completeDeliveryWithReport(completion(claim))).toEqual({
                outcome: expectedState === "done" ? "alreadyCompleted" : "completed",
            });
            restarted.close();
        },
    );
});

describe("claim ownership under contention", () => {
    it("lets only the current token finalize across real worker threads", async () => {
        const firstStore = new Store(databasePath);
        const first = acceptAndClaim(firstStore);
        firstStore.close();

        const secondStore = new Store(databasePath);
        const second = secondStore.claimNextDelivery(
            "worker-b",
            "2026-08-01T10:20:00.000Z",
            "2026-08-01T10:01:00.000Z",
        )!;
        secondStore.close();

        const outcomes = await runFinalizers([
            {
                input: completion(first, {
                    reportJson: JSON.stringify({ worker: "old" }),
                }),
            },
            {
                input: completion(second, {
                    reportJson: JSON.stringify({ worker: "current" }),
                }),
            },
        ]);
        expect(outcomes.map((result) => result.value?.outcome).sort()).toEqual([
            "completed",
            "notOwned",
        ]);

        const durable = durableOutcome();
        expect(durable.delivery.state).toBe("done");
        expect(durable.reports).toHaveLength(1);
        expect(durable.reports[0]?.report_json).toBe(JSON.stringify({ worker: "current" }));
        expect(durable.reports[0]?.claim_token).toBe(second.claimToken);
    });
});
