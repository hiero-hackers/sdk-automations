/**
 * Crash-behavior tests mirroring protocol 6.5's grid. Every Store write
 * is one synchronous statement, so a `kill -9` between calls leaves the
 * file holding exactly the completed calls — simulated here by opening
 * a FRESH instance on the same file ("the restarted process") and
 * asserting what it can and cannot know.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { useTempDir } from "@hiero-hackers/automation-testkit";
import { Store } from "../../src/store/store.js";
import { asDeliveryGuid } from "@hiero-hackers/automation-core";

const temp = useTempDir("store-test-");
let path: string;

beforeEach(() => {
    path = temp.file("store.sqlite");
});

const id = (raw: string) => {
    const v = asDeliveryGuid(raw);
    if (v === undefined) throw new Error("test id invalid");
    return v;
};

describe("durability configuration — the crash model, pinned", () => {
    it("runs DELETE-journal + synchronous FULL; switching to WAL must fail here first", () => {
        // "Everything before the last returned call survives kill -9
        // and power loss" is only true under these two pragmas. A
        // concurrency-motivated switch to WAL weakens power-loss
        // durability and must be a deliberate, register-visible change.
        const preconfigured = new DatabaseSync(path);
        preconfigured.exec("PRAGMA journal_mode = WAL");
        expect(preconfigured.prepare("PRAGMA journal_mode").get()).toEqual({
            journal_mode: "wal",
        });
        preconfigured.close();

        const s = new Store(path);
        const db = (s as unknown as { db: { prepare(sql: string): { get(): unknown } } }).db;
        expect(db.prepare("PRAGMA journal_mode").get()).toEqual({ journal_mode: "delete" });
        expect(db.prepare("PRAGMA synchronous").get()).toEqual({ synchronous: 2 }); // 2 = FULL
        expect(db.prepare("PRAGMA busy_timeout").get()).toEqual({ timeout: 2_000 });
        s.close();
    });

    it("creates the two operational worklist indexes", () => {
        const s = new Store(path);
        const db = (
            s as unknown as {
                db: {
                    prepare(sql: string): {
                        all(...values: unknown[]): { name: string }[];
                    };
                };
            }
        ).db;
        expect(
            db
                .prepare(
                    `
            SELECT name FROM sqlite_schema
            WHERE type = 'index' AND name IN (?, ?)
            ORDER BY name
        `,
                )
                .all("delivery_work", "open_sends"),
        ).toEqual([{ name: "delivery_work" }, { name: "open_sends" }]);
        s.close();
    });
});

describe("timestamp boundary — lexicographic order must BE chronological order", () => {
    it("rejects every non-UTC-Z timestamp loudly instead of misordering silently", () => {
        const s = new Store(path);
        // An offset instant sorts wrongly against Z strings — as data
        // it would misfire schedules and freeze leases, so it throws.
        expect(() => s.ledger.schedule("x", "2026-07-24T00:00:00+01:00", "sweep")).toThrow(
            TypeError,
        );
        expect(() => s.ledger.claimDue("24 Jul 2026 12:00")).toThrow(TypeError);
        expect(() => s.ledger.open("2026-07-23")).toThrow(TypeError);
        expect(() =>
            s.inbox.acceptDelivery({
                deliveryId: id("00000000-0000-0000-0000-000000000001"),
                eventName: "issues",
                payload: Buffer.from("{}"),
                receivedAt: "",
            }),
        ).toThrow(TypeError);
        expect(() => s.ledger.claim("e1", "w1", "2026-07-23T12:00:00.000Z", "not-a-time")).toThrow(
            TypeError,
        );
        // Seconds-only Z is ALSO rejected: mixed precision breaks
        // lexicographic ordering ("…00Z" > "…00.500Z" as strings but
        // earlier in time). Exactly the Date.toISOString() shape.
        expect(() => s.ledger.schedule("y", "2026-07-24T00:00:00Z", "sweep")).toThrow(TypeError);
        expect(() => s.ledger.schedule("prefix", "x2026-07-24T00:00:00.123Z", "sweep")).toThrow(
            TypeError,
        );
        expect(() => s.ledger.schedule("suffix", "2026-07-24T00:00:00.123Zx", "sweep")).toThrow(
            TypeError,
        );
        expect(() => s.ledger.schedule("extended", "+010000-01-01T00:00:00.000Z", "sweep")).toThrow(
            TypeError,
        );
        s.ledger.schedule("ok", "2026-07-24T00:00:00.123Z", "sweep");
        s.close();
    });

    it("names the invalid time at every durable boundary", () => {
        const s = new Store(path);
        const cases: readonly [() => unknown, RegExp][] = [
            [() => s.ledger.claim("e", "w", "invalid", "2026-01-01T00:00:00.000Z"), /now/],
            [() => s.ledger.claim("e", "w", "2026-01-01T00:00:00.000Z", "invalid"), /staleBefore/],
            [() => s.ledger.schedule("s", "invalid", "effect"), /dueAt/],
            [() => s.ledger.claimDue("invalid"), /now/],
            [() => s.ledger.requeueStuck("invalid"), /claimedBefore/],
            [() => s.inbox.pruneCompletedDeliveries("invalid"), /before/],
        ];
        for (const [operation, parameter] of cases) {
            expect(operation).toThrow(parameter);
        }
        s.close();
    });

    it("rejects canonical-looking strings that are not real calendar instants", () => {
        const s = new Store(path);
        expect(() => s.ledger.schedule("impossible", "2026-02-31T00:00:00.000Z", "sweep")).toThrow(
            TypeError,
        );
        expect(() => s.ledger.claimDue("2026-99-99T99:99:99.999Z")).toThrow(TypeError);
        s.close();
    });
});

describe("claims — the two-worker race serialized (6.5 scenario 6), now as a lease", () => {
    // Scenarios use a five-minute lease around a 12:00 claim:
    // staleBefore = now minus five minutes, all literal for legibility.
    const T0 = "2026-07-23T12:00:00.000Z";

    it("two instances racing the same effect: exactly one wins, and the claim survives restart", () => {
        const w1 = new Store(path);
        const w2 = new Store(path);
        const results = [
            w1.ledger.claim("effect-x", "w1", T0, "2026-07-23T11:55:00.000Z"),
            w2.ledger.claim("effect-x", "w2", T0, "2026-07-23T11:55:00.000Z"),
        ];
        expect(results.filter(Boolean)).toHaveLength(1);
        w1.close();
        w2.close();

        const restarted = new Store(path);
        expect(
            restarted.ledger.claim(
                "effect-x",
                "w3",
                "2026-07-23T12:01:00.000Z",
                "2026-07-23T11:56:00.000Z",
            ),
        ).toBe(false);
        restarted.close();
    });

    // FINDING(store-claim-lease)
    it("a stale claim is taken over atomically — a crashed holder cannot deadlock the effect", () => {
        const before = new Store(path);
        expect(before.ledger.claim("effect-x", "w1", T0, "2026-07-23T11:55:00.000Z")).toBe(true);
        before.close(); // crash while holding the claim

        const restarted = new Store(path);
        // 12:10, five-minute lease: the 12:00 claim is stale (<= 12:05).
        expect(
            restarted.ledger.claim(
                "effect-x",
                "w2",
                "2026-07-23T12:10:00.000Z",
                "2026-07-23T12:05:00.000Z",
            ),
        ).toBe(true);
        // The takeover replaced the row — w1's ghost cannot release it.
        expect(restarted.ledger.release("effect-x", "w1")).toBe(false);
        expect(restarted.ledger.release("effect-x", "w2")).toBe(true);
        restarted.close();
    });

    it("a live holder is NOT stolen from while its lease is fresh", () => {
        const s = new Store(path);
        expect(s.ledger.claim("effect-x", "w1", T0, "2026-07-23T11:55:00.000Z")).toBe(true);
        // 12:02, five-minute lease: the 12:00 claim is fresh (> 11:57).
        expect(
            s.ledger.claim(
                "effect-x",
                "w2",
                "2026-07-23T12:02:00.000Z",
                "2026-07-23T11:57:00.000Z",
            ),
        ).toBe(false);
        s.close();
    });

    it("release frees the effect for the next claimant; releasing what you lost is a safe no-op", () => {
        const s = new Store(path);
        expect(s.ledger.claim("effect-x", "w1", T0, "2026-07-23T11:55:00.000Z")).toBe(true);
        expect(s.ledger.release("effect-x", "w1")).toBe(true);
        // Fresh claim after release, no staleness needed.
        expect(
            s.ledger.claim(
                "effect-x",
                "w2",
                "2026-07-23T12:00:30.000Z",
                "2026-07-23T11:55:30.000Z",
            ),
        ).toBe(true);
        // w1 releasing again: it holds nothing, nothing happens.
        expect(s.ledger.release("effect-x", "w1")).toBe(false);
        s.close();
    });

    it("a non-contention failure THROWS — it must never masquerade as a lost race", () => {
        // `false` means "exit cleanly, someone else holds the effect".
        // A store that answers `false` to an I/O failure makes the
        // effect silently never run.
        const s = new Store(path);
        s.close();
        expect(() => s.ledger.claim("effect-x", "w1", T0, "2026-07-23T11:55:00.000Z")).toThrow();
    });
});

/** When a firing began, as the re-arm writes it down (D192). */
const STARTED_AT = "2026-07-23T10:00:00.000Z";

describe("schedules — the stage-five exit-gate behavior, testable today", () => {
    it("a due schedule fires exactly once across two instances and a restart", () => {
        const a = new Store(path);
        a.ledger.schedule("warn-issue-9", "2026-07-23T10:00:00.000Z", "inactivity-warning");
        const b = new Store(path);

        const firedA = a.ledger.claimDue("2026-07-23T12:00:00.000Z");
        const firedB = b.ledger.claimDue("2026-07-23T12:00:00.000Z");
        expect([...firedA, ...firedB]).toHaveLength(1);
        a.close();
        b.close();

        // A restart mid-processing must NOT re-fire it (redrive belongs
        // to reconciliation, which sees the stuck `running` row).
        const restarted = new Store(path);
        expect(restarted.ledger.claimDue("2026-07-23T12:00:00.000Z")).toHaveLength(0);
        restarted.close();
    });

    // FINDING(store-sweep-api)
    it("a stuck running schedule is requeued by claim age and re-fires through the normal path", () => {
        const before = new Store(path);
        before.ledger.schedule("warn-issue-9", "2026-07-23T10:00:00.000Z", "inactivity-warning");
        before.ledger.claimDue("2026-07-23T12:00:00.000Z"); // claimed, then the process dies
        before.close();

        const sweep = new Store(path);
        // Too fresh to be stuck: claimed 12:00, threshold 11:30 → untouched.
        expect(sweep.ledger.requeueStuck("2026-07-23T11:30:00.000Z")).toHaveLength(0);
        // An hour later the sweep declares it stuck and requeues it.
        const requeued = sweep.ledger.requeueStuck("2026-07-23T12:30:00.000Z");
        expect(requeued.map((r) => r.scheduleId)).toEqual(["warn-issue-9"]);
        // It re-fires through claimDue — no parallel firing mechanism.
        expect(sweep.ledger.claimDue("2026-07-23T13:00:00.000Z")).toHaveLength(1);
        // And is not stuck again under the same old threshold.
        expect(sweep.ledger.requeueStuck("2026-07-23T12:30:00.000Z")).toHaveLength(0);
        sweep.close();
    });

    it("requeue never touches pending or done rows — only stuck running ones", () => {
        const s = new Store(path);
        s.ledger.schedule("done-one", "2026-07-23T10:00:00.000Z", "a");
        const doneClaim = s.ledger.claimDue("2026-07-23T10:30:00.000Z")[0]!;
        expect(s.ledger.scheduleDone("done-one", doneClaim.claimToken)).toBe(true);
        s.ledger.schedule("still-pending", "2026-07-30T00:00:00.000Z", "b");
        expect(s.ledger.requeueStuck("2026-07-24T00:00:00.000Z")).toHaveLength(0);
        s.close();
    });

    it("a stale handler cannot complete a later claim of the same schedule", () => {
        const s = new Store(path);
        s.ledger.schedule("job", "2026-07-23T10:00:00.000Z", "work");
        const first = s.ledger.claimDue("2026-07-23T10:00:00.000Z")[0]!;
        s.ledger.requeueStuck("2026-07-23T10:00:00.000Z");
        const second = s.ledger.claimDue("2026-07-23T10:01:00.000Z")[0]!;
        expect(second.scheduleId).toBe(first.scheduleId);

        expect(s.ledger.scheduleDone(first.scheduleId, first.claimToken)).toBe(false);
        expect(s.ledger.requeueStuck("2026-07-23T10:01:00.000Z")).toHaveLength(1);
        s.close();
    });

    it("re-arming completes the firing and moves the due date, in one statement", () => {
        const s = new Store(path);
        s.ledger.schedule("sweep:o/r", "2026-07-23T10:00:00.000Z", "sweep");
        const fired = s.ledger.claimDue("2026-07-23T10:00:00.000Z")[0]!;

        expect(
            s.ledger.scheduleAgain(
                "sweep:o/r",
                fired.claimToken,
                "2026-07-24T10:00:00.000Z",
                null,
                STARTED_AT,
            ),
        ).toBe(true);

        // The claim is gone, the row is pending again, and it fires only once
        // the NEW due date has passed — which re-declaring could never do,
        // because `schedule` ignores a row that already exists.
        expect(s.ledger.claimDue("2026-07-23T23:00:00.000Z")).toEqual([]);
        expect(s.ledger.claimDue("2026-07-24T11:00:00.000Z")).toMatchObject([
            { scheduleId: "sweep:o/r", dueAt: "2026-07-24T10:00:00.000Z" },
        ]);
        s.close();
    });

    it("re-arming refuses a token that no longer owns the firing", () => {
        const s = new Store(path);
        s.ledger.schedule("sweep:o/r", "2026-07-23T10:00:00.000Z", "sweep");
        const first = s.ledger.claimDue("2026-07-23T10:00:00.000Z")[0]!;
        s.ledger.requeueStuck("2026-07-23T10:00:00.000Z");
        const second = s.ledger.claimDue("2026-07-23T10:01:00.000Z")[0]!;

        expect(
            s.ledger.scheduleAgain(
                "sweep:o/r",
                first.claimToken,
                "2026-07-24T10:00:00.000Z",
                null,
                STARTED_AT,
            ),
        ).toBe(false);
        expect(
            s.ledger.scheduleAgain(
                "sweep:o/r",
                second.claimToken,
                "2026-07-24T10:00:00.000Z",
                null,
                STARTED_AT,
            ),
        ).toBe(true);
        expect(() =>
            s.ledger.scheduleAgain("sweep:o/r", second.claimToken, "nonsense", null, STARTED_AT),
        ).toThrow(/dueAt/);
        s.close();
    });

    /** D170: the read cursor is a column on the row, so it outlives the process that set it. */
    it("re-arming carries the read cursor, and a restart claims it back", () => {
        const before = new Store(path);
        before.ledger.schedule("sweep:o/r", "2026-07-23T10:00:00.000Z", "sweep");
        const fired = before.ledger.claimDue("2026-07-23T10:00:00.000Z")[0]!;
        expect(fired.resumeAfter).toBeNull();
        expect(
            before.ledger.scheduleAgain(
                "sweep:o/r",
                fired.claimToken,
                "2026-07-24T10:00:00.000Z",
                412,
                STARTED_AT,
            ),
        ).toBe(true);
        before.close();

        const restarted = new Store(path);
        const resumed = restarted.ledger.claimDue("2026-07-24T11:00:00.000Z")[0]!;
        expect(resumed.resumeAfter).toBe(412);

        // The firing that finishes the list clears it, and the next one starts over.
        expect(
            restarted.ledger.scheduleAgain(
                "sweep:o/r",
                resumed.claimToken,
                "2026-07-25T10:00:00.000Z",
                null,
                STARTED_AT,
            ),
        ).toBe(true);
        expect(restarted.ledger.claimDue("2026-07-25T11:00:00.000Z")).toMatchObject([
            { scheduleId: "sweep:o/r", resumeAfter: null },
        ]);
        restarted.close();
    });

    it("not due → not fired; re-declaring an existing schedule is a no-op", () => {
        const s = new Store(path);
        s.ledger.schedule("later", "2026-07-24T00:00:00.000Z", "sweep");
        s.ledger.schedule("later", "2020-01-01T00:00:00.000Z", "sweep-hijack-attempt");
        expect(s.ledger.claimDue("2026-07-23T12:00:00.000Z")).toHaveLength(0);
        const fired = s.ledger.claimDue("2026-07-24T01:00:00.000Z");
        expect(fired).toHaveLength(1);
        expect(fired[0]?.dueAt).toBe("2026-07-24T00:00:00.000Z");
        expect(s.ledger.scheduleDone("later", fired[0]!.claimToken)).toBe(true);
        expect(s.ledger.claimDue("2026-07-25T00:00:00.000Z")).toHaveLength(0);
        s.close();
    });
});
