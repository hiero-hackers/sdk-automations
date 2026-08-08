/**
 * Crash-behavior tests mirroring protocol 6.5's grid. Every Store write
 * is one synchronous statement, so a `kill -9` between calls leaves the
 * file holding exactly the completed calls — simulated here by opening
 * a FRESH instance on the same file ("the restarted process") and
 * asserting what it can and cannot know.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/store.js";
import { asDeliveryGuid } from "@hiero-hackers/automation-core";

let dir: string;
let path: string;

beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "store-test-"));
    path = join(dir, "store.sqlite");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

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
        const s = new Store(path);
        const db = (s as unknown as { db: { prepare(sql: string): { get(): unknown } } }).db;
        expect(db.prepare("PRAGMA journal_mode").get()).toEqual({ journal_mode: "delete" });
        expect(db.prepare("PRAGMA synchronous").get()).toEqual({ synchronous: 2 }); // 2 = FULL
        s.close();
    });
});

describe("timestamp boundary — lexicographic order must BE chronological order", () => {
    it("rejects every non-UTC-Z timestamp loudly instead of misordering silently", () => {
        const s = new Store(path);
        // An offset instant sorts wrongly against Z strings — as data
        // it would misfire schedules and freeze leases, so it throws.
        expect(() => s.schedule("x", "2026-07-24T00:00:00+01:00", "sweep")).toThrow(TypeError);
        expect(() => s.claimDue("24 Jul 2026 12:00")).toThrow(TypeError);
        expect(() => s.intent("e1", 1, "read", "2026-07-23", "rev-1")).toThrow(TypeError);
        expect(() =>
            s.acceptDelivery({
                deliveryId: id("00000000-0000-0000-0000-000000000001"),
                eventName: "issues",
                payload: Buffer.from("{}"),
                receivedAt: "",
            }),
        ).toThrow(TypeError);
        expect(() => s.claim("e1", "w1", "2026-07-23T12:00:00.000Z", "not-a-time")).toThrow(
            TypeError,
        );
        // Seconds-only Z is ALSO rejected: mixed precision breaks
        // lexicographic ordering ("…00Z" > "…00.500Z" as strings but
        // earlier in time). Exactly the Date.toISOString() shape.
        expect(() => s.schedule("y", "2026-07-24T00:00:00Z", "sweep")).toThrow(TypeError);
        s.schedule("ok", "2026-07-24T00:00:00.123Z", "sweep");
        s.close();
    });

    it("rejects canonical-looking strings that are not real calendar instants", () => {
        const s = new Store(path);
        expect(() => s.schedule("impossible", "2026-02-31T00:00:00.000Z", "sweep")).toThrow(
            TypeError,
        );
        expect(() => s.intent("e1", 1, "read", "2026-99-99T99:99:99.999Z", "rev-1")).toThrow(
            TypeError,
        );
        s.close();
    });
});

describe("effect journal — the 6.5 crash grid, restated as instance reopening", () => {
    it("kill after call 1 (read done, write never sent) → midSequence: provably safe to resume", () => {
        const before = new Store(path);
        before.intent("e1", 1, "list-comments", "2026-07-23T10:00:00.000Z", "rev-1");
        before.done("e1", 1, "2026-07-23T10:00:00.001Z");
        before.close(); // crash at kill point e1-after-call-1

        const recovered = new Store(path);
        expect(recovered.effectState("e1", 2)).toMatchObject({
            state: "midSequence",
            lastDoneSeq: 1,
        });
        recovered.close();
    });

    it("lost response (intent written, nothing else) → sentUnknown: the journal alone cannot say", () => {
        const before = new Store(path);
        before.intent("e1", 1, "list-comments", "2026-07-23T10:00:00.000Z", "rev-1");
        before.done("e1", 1, "2026-07-23T10:00:00.001Z");
        before.intent("e1", 2, "create-comment", "2026-07-23T10:00:02.000Z", "rev-1"); // write sent, response discarded, crash
        before.close();

        const recovered = new Store(path);
        expect(recovered.effectState("e1", 2)).toMatchObject({
            state: "sentUnknown",
            seq: 2,
            intent: "create-comment",
            attempt: 1,
        });
        recovered.close();
    });

    // FINDING(store-journal-attempts)
    it("a retry increments a durable attempt counter — the bound survives restart", () => {
        const before = new Store(path);
        before.intent("e1", 1, "create-comment", "2026-07-23T10:00:00.000Z", "rev-1"); // attempt 1, response lost
        before.intent("e1", 1, "create-comment", "2026-07-23T10:01:00.000Z", "rev-1"); // resolver said absent; attempt 2
        before.close(); // crash

        const recovered = new Store(path);
        recovered.intent("e1", 1, "create-comment", "2026-07-23T10:07:00.000Z", "rev-1"); // attempt 3, after restart
        expect(recovered.effectState("e1", 1)).toMatchObject({
            state: "sentUnknown",
            seq: 1,
            intent: "create-comment",
            attempt: 3,
        });
        recovered.close();
    });

    it("a done row is immutable to intent — acknowledged history never regresses to sent", () => {
        const s = new Store(path);
        s.intent("e1", 1, "add-label", "2026-07-23T10:00:00.000Z", "rev-1");
        s.done("e1", 1, "2026-07-23T10:00:00.001Z");
        // A buggy or duplicate-delivery-driven caller re-declares the
        // same call. The receipt must survive.
        s.intent("e1", 1, "add-label", "2026-07-23T10:02:00.000Z", "rev-1");
        expect(s.effectState("e1", 1)).toMatchObject({ state: "complete" });
        s.close();
    });

    it("done on a row that was never declared reports the caller bug", () => {
        const s = new Store(path);
        s.intent("e1", 1, "read", "2026-07-23T10:00:00.000Z", "rev-1");
        expect(s.done("e1", 1, "2026-07-23T10:00:00.001Z")).toBe(true);
        expect(s.done("e1", 7, "2026-07-23T10:00:00.002Z")).toBe(false); // no such call
        expect(s.done("ghost", 1, "2026-07-23T10:00:00.003Z")).toBe(false); // no such effect
        s.close();
    });

    it("full run → complete; untouched effect → neverStarted", () => {
        const s = new Store(path);
        s.intent("e1", 1, "read", "2026-07-23T10:00:00.000Z", "rev-1");
        s.done("e1", 1, "2026-07-23T10:00:00.001Z");
        s.intent("e1", 2, "write", "2026-07-23T10:00:01.000Z", "rev-1");
        s.done("e1", 2, "2026-07-23T10:00:01.001Z");
        expect(s.effectState("e1", 2)).toMatchObject({ state: "complete" });
        expect(s.effectState("ghost", 2)).toEqual({ state: "neverStarted" });
        s.close();
    });
});

describe("journal retention pruning (D43's adopted window)", () => {
    it("prunes old done journal rows, but NEVER an open sent row", () => {
        const s = new Store(path);
        s.intent("old-done", 1, "add-label", "2026-04-01T00:00:00.000Z", "rev-1");
        s.done("old-done", 1, "2026-04-01T00:00:00.001Z");
        s.intent("old-open", 1, "create-comment", "2026-04-01T00:00:00.000Z", "rev-1"); // unresolved, ancient
        s.intent("new-done", 1, "add-label", "2026-07-20T00:00:00.000Z", "rev-1");
        s.done("new-done", 1, "2026-07-20T00:00:00.001Z");

        const cutoff = "2026-04-27T00:00:00.000Z"; // ~90 days before "today"
        expect(s.pruneDoneJournal(cutoff)).toBe(1);

        // The ancient OPEN intent survives pruning — still the sweep's problem.
        expect(s.openIntents("2026-07-25T00:00:00.000Z")).toMatchObject([
            { effectId: "old-open", seq: 1 },
        ]);
        // The recent done row survives.
        expect(s.effectState("new-done", 1)).toMatchObject({ state: "complete" });
        s.close();
    });

    it("retains a newly resolved intent from its completion time, not its stale send time", () => {
        const s = new Store(path);
        s.intent("resolved-now", 1, "create-comment", "2026-01-01T00:00:00.000Z", "rev-1");
        expect(s.done("resolved-now", 1, "2026-07-01T00:00:00.000Z")).toBe(true);
        expect(s.pruneDoneJournal("2026-04-01T00:00:00.000Z")).toBe(0);
        expect(s.effectState("resolved-now", 1)).toMatchObject({ state: "complete" });
        s.close();
    });
});

describe("openIntents — the sweep's journal worklist", () => {
    it("lists unresolved sent rows across effects, oldest first; resolved rows drop out", () => {
        const s = new Store(path);
        s.intent("e2", 1, "create-comment", "2026-07-23T10:05:00.000Z", "rev-1"); // unresolved
        s.intent("e1", 1, "add-label", "2026-07-23T10:00:00.000Z", "rev-1"); // will resolve
        s.intent("e3", 1, "add-assignee", "2026-07-23T11:00:00.000Z", "rev-1"); // too new for the sweep window
        s.done("e1", 1, "2026-07-23T10:00:00.001Z");

        const open = s.openIntents("2026-07-23T10:30:00.000Z");
        expect(open).toEqual([
            {
                effectId: "e2",
                seq: 1,
                intent: "create-comment",
                attempt: 1,
                at: "2026-07-23T10:05:00.000Z",
            },
        ]);
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
            w1.claim("effect-x", "w1", T0, "2026-07-23T11:55:00.000Z"),
            w2.claim("effect-x", "w2", T0, "2026-07-23T11:55:00.000Z"),
        ];
        expect(results.filter(Boolean)).toHaveLength(1);
        w1.close();
        w2.close();

        const restarted = new Store(path);
        expect(
            restarted.claim(
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
        expect(before.claim("effect-x", "w1", T0, "2026-07-23T11:55:00.000Z")).toBe(true);
        before.close(); // crash while holding the claim

        const restarted = new Store(path);
        // 12:10, five-minute lease: the 12:00 claim is stale (<= 12:05).
        expect(
            restarted.claim(
                "effect-x",
                "w2",
                "2026-07-23T12:10:00.000Z",
                "2026-07-23T12:05:00.000Z",
            ),
        ).toBe(true);
        // The takeover replaced the row — w1's ghost cannot release it.
        expect(restarted.release("effect-x", "w1")).toBe(false);
        expect(restarted.release("effect-x", "w2")).toBe(true);
        restarted.close();
    });

    it("a live holder is NOT stolen from while its lease is fresh", () => {
        const s = new Store(path);
        expect(s.claim("effect-x", "w1", T0, "2026-07-23T11:55:00.000Z")).toBe(true);
        // 12:02, five-minute lease: the 12:00 claim is fresh (> 11:57).
        expect(
            s.claim("effect-x", "w2", "2026-07-23T12:02:00.000Z", "2026-07-23T11:57:00.000Z"),
        ).toBe(false);
        s.close();
    });

    it("release frees the effect for the next claimant; releasing what you lost is a safe no-op", () => {
        const s = new Store(path);
        expect(s.claim("effect-x", "w1", T0, "2026-07-23T11:55:00.000Z")).toBe(true);
        expect(s.release("effect-x", "w1")).toBe(true);
        // Fresh claim after release, no staleness needed.
        expect(
            s.claim("effect-x", "w2", "2026-07-23T12:00:30.000Z", "2026-07-23T11:55:30.000Z"),
        ).toBe(true);
        // w1 releasing again: it holds nothing, nothing happens.
        expect(s.release("effect-x", "w1")).toBe(false);
        s.close();
    });

    it("a non-contention failure THROWS — it must never masquerade as a lost race", () => {
        // `false` means "exit cleanly, someone else holds the effect".
        // A store that answers `false` to an I/O failure makes the
        // effect silently never run.
        const s = new Store(path);
        s.close();
        expect(() => s.claim("effect-x", "w1", T0, "2026-07-23T11:55:00.000Z")).toThrow();
    });
});

describe("schedules — the stage-five exit-gate behavior, testable today", () => {
    it("a due schedule fires exactly once across two instances and a restart", () => {
        const a = new Store(path);
        a.schedule("warn-issue-9", "2026-07-23T10:00:00.000Z", "inactivity-warning");
        const b = new Store(path);

        const firedA = a.claimDue("2026-07-23T12:00:00.000Z");
        const firedB = b.claimDue("2026-07-23T12:00:00.000Z");
        expect([...firedA, ...firedB]).toHaveLength(1);
        a.close();
        b.close();

        // A restart mid-processing must NOT re-fire it (redrive belongs
        // to reconciliation, which sees the stuck `running` row).
        const restarted = new Store(path);
        expect(restarted.claimDue("2026-07-23T12:00:00.000Z")).toHaveLength(0);
        restarted.close();
    });

    // FINDING(store-sweep-api)
    it("a stuck running schedule is requeued by claim age and re-fires through the normal path", () => {
        const before = new Store(path);
        before.schedule("warn-issue-9", "2026-07-23T10:00:00.000Z", "inactivity-warning");
        before.claimDue("2026-07-23T12:00:00.000Z"); // claimed, then the process dies
        before.close();

        const sweep = new Store(path);
        // Too fresh to be stuck: claimed 12:00, threshold 11:30 → untouched.
        expect(sweep.requeueStuck("2026-07-23T11:30:00.000Z")).toHaveLength(0);
        // An hour later the sweep declares it stuck and requeues it.
        const requeued = sweep.requeueStuck("2026-07-23T12:30:00.000Z");
        expect(requeued.map((r) => r.scheduleId)).toEqual(["warn-issue-9"]);
        // It re-fires through claimDue — no parallel firing mechanism.
        expect(sweep.claimDue("2026-07-23T13:00:00.000Z")).toHaveLength(1);
        // And is not stuck again under the same old threshold.
        expect(sweep.requeueStuck("2026-07-23T12:30:00.000Z")).toHaveLength(0);
        sweep.close();
    });

    it("requeue never touches pending or done rows — only stuck running ones", () => {
        const s = new Store(path);
        s.schedule("done-one", "2026-07-23T10:00:00.000Z", "a");
        const doneClaim = s.claimDue("2026-07-23T10:30:00.000Z")[0]!;
        expect(s.scheduleDone("done-one", doneClaim.claimToken)).toBe(true);
        s.schedule("still-pending", "2026-07-30T00:00:00.000Z", "b");
        expect(s.requeueStuck("2026-07-24T00:00:00.000Z")).toHaveLength(0);
        s.close();
    });

    it("a stale handler cannot complete a later claim of the same schedule", () => {
        const s = new Store(path);
        s.schedule("job", "2026-07-23T10:00:00.000Z", "work");
        const first = s.claimDue("2026-07-23T10:00:00.000Z")[0]!;
        s.requeueStuck("2026-07-23T10:00:00.000Z");
        const second = s.claimDue("2026-07-23T10:01:00.000Z")[0]!;
        expect(second.scheduleId).toBe(first.scheduleId);

        expect(s.scheduleDone(first.scheduleId, first.claimToken)).toBe(false);
        expect(s.requeueStuck("2026-07-23T10:01:00.000Z")).toHaveLength(1);
        s.close();
    });

    it("not due → not fired; re-declaring an existing schedule is a no-op", () => {
        const s = new Store(path);
        s.schedule("later", "2026-07-24T00:00:00.000Z", "sweep");
        s.schedule("later", "2020-01-01T00:00:00.000Z", "sweep-hijack-attempt");
        expect(s.claimDue("2026-07-23T12:00:00.000Z")).toHaveLength(0);
        const fired = s.claimDue("2026-07-24T01:00:00.000Z");
        expect(fired).toHaveLength(1);
        expect(fired[0]?.dueAt).toBe("2026-07-24T00:00:00.000Z");
        expect(s.scheduleDone("later", fired[0]!.claimToken)).toBe(true);
        expect(s.claimDue("2026-07-25T00:00:00.000Z")).toHaveLength(0);
        s.close();
    });
});
