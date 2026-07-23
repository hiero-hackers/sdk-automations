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
import { asDeliveryId } from "../../core/src/ids.js";

let dir: string;
let path: string;

beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "store-test-"));
    path = join(dir, "store.sqlite");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const id = (raw: string) => {
    const v = asDeliveryId(raw);
    if (v === undefined) throw new Error("test id invalid");
    return v;
};

describe("delivery deduplication (6.2: redeliveries reuse the guid)", () => {
    it("first sight is true, every repeat — including after a restart — is false", () => {
        const a = new Store(path);
        expect(a.firstSeen(id("3832900504397021184"))).toBe(true);
        expect(a.firstSeen(id("3832900504397021184"))).toBe(false);
        a.close();
        const restarted = new Store(path);
        expect(restarted.firstSeen(id("3832900504397021184"))).toBe(false);
        restarted.close();
    });
});

describe("effect journal — the 6.5 crash grid, restated as instance reopening", () => {
    it("kill after call 1 (read done, write never sent) → midSequence: provably safe to resume", () => {
        const before = new Store(path);
        before.intent("e1", 1, "list-comments");
        before.done("e1", 1);
        before.close(); // crash at kill point e1-after-call-1

        const recovered = new Store(path);
        expect(recovered.effectState("e1", 2)).toEqual({ state: "midSequence", lastDoneSeq: 1 });
        recovered.close();
    });

    it("lost response (intent written, nothing else) → sentUnknown: the journal alone cannot say", () => {
        const before = new Store(path);
        before.intent("e1", 1, "list-comments");
        before.done("e1", 1);
        before.intent("e1", 2, "create-comment"); // write sent, response discarded, crash
        before.close();

        const recovered = new Store(path);
        expect(recovered.effectState("e1", 2)).toEqual({
            state: "sentUnknown",
            seq: 2,
            intent: "create-comment",
        });
        recovered.close();
    });

    it("full run → complete; untouched effect → neverStarted", () => {
        const s = new Store(path);
        s.intent("e1", 1, "read");
        s.done("e1", 1);
        s.intent("e1", 2, "write");
        s.done("e1", 2);
        expect(s.effectState("e1", 2)).toEqual({ state: "complete" });
        expect(s.effectState("ghost", 2)).toEqual({ state: "neverStarted" });
        s.close();
    });
});

describe("claims — the two-worker race, serialized (6.5 scenario 6)", () => {
    it("two instances racing the same effect: exactly one wins, and the claim survives restart", () => {
        const w1 = new Store(path);
        const w2 = new Store(path);
        const results = [w1.claim("effect-x", "w1"), w2.claim("effect-x", "w2")];
        expect(results.filter(Boolean)).toHaveLength(1);
        w1.close();
        w2.close();

        const restarted = new Store(path);
        expect(restarted.claim("effect-x", "w3")).toBe(false);
        restarted.close();
    });
});

describe("schedules — the stage-five exit-gate behavior, testable today", () => {
    it("a due schedule fires exactly once across two instances and a restart", () => {
        const a = new Store(path);
        a.schedule("warn-issue-9", "2026-07-23T10:00:00Z", "inactivity-warning");
        const b = new Store(path);

        const firedA = a.claimDue("2026-07-23T12:00:00Z");
        const firedB = b.claimDue("2026-07-23T12:00:00Z");
        expect([...firedA, ...firedB]).toHaveLength(1);
        a.close();
        b.close();

        // A restart mid-processing must NOT re-fire it (redrive belongs
        // to reconciliation, which sees the stuck `running` row).
        const restarted = new Store(path);
        expect(restarted.claimDue("2026-07-23T12:00:00Z")).toHaveLength(0);
        restarted.close();
    });

    it("not due → not fired; re-declaring an existing schedule is a no-op", () => {
        const s = new Store(path);
        s.schedule("later", "2026-07-24T00:00:00Z", "sweep");
        s.schedule("later", "2020-01-01T00:00:00Z", "sweep-hijack-attempt");
        expect(s.claimDue("2026-07-23T12:00:00Z")).toHaveLength(0);
        const fired = s.claimDue("2026-07-24T01:00:00Z");
        expect(fired).toHaveLength(1);
        expect(fired[0]?.dueAt).toBe("2026-07-24T00:00:00Z");
        s.scheduleDone("later");
        expect(s.claimDue("2026-07-25T00:00:00Z")).toHaveLength(0);
        s.close();
    });
});
