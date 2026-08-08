/**
 * Seeded interleaving stress — the example suites test SPECIFIC
 * orderings of claim/release/claimDue/requeueStuck; these drive
 * hundreds of RANDOM interleavings across two Store instances on one
 * file, checking the store against a reference model after every
 * step. Deterministic: a failure names its seed, and replaying the
 * seed replays the exact interleaving.
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/store.js";

/** mulberry32 — tiny deterministic PRNG. */
function prng(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const iso = (ms: number) => new Date(ms).toISOString();
const MINUTE = 60_000;
const LEASE = 5 * MINUTE;
const SEEDS = Array.from({ length: 10 }, (_, i) => i + 1);

describe("claims under random interleaving: store ≡ single-holder lease model", () => {
    it.each(SEEDS)("seed %i — 300 steps, two instances, three effects", (seed) => {
        const dir = mkdtempSync(join(tmpdir(), "store-stress-"));
        const path = join(dir, "store.sqlite");
        const a = new Store(path);
        const b = new Store(path);
        try {
            const rand = prng(seed);
            const stores = [a, b];
            const workers = ["w1", "w2", "w3"];
            const effects = ["e1", "e2", "e3"];
            // Reference model: per effect, the current holder and claim time.
            const model = new Map<string, { worker: string; atMs: number } | null>(
                effects.map((e) => [e, null]),
            );
            let now = Date.parse("2026-07-25T00:00:00.000Z");

            for (let step = 0; step < 300; step++) {
                now += Math.floor(rand() * LEASE * 0.75); // 0 … 3.75 min
                const store = stores[Math.floor(rand() * 2)]!;
                const worker = workers[Math.floor(rand() * workers.length)]!;
                const effect = effects[Math.floor(rand() * effects.length)]!;
                const holder = model.get(effect) ?? null;

                if (rand() < 0.7) {
                    // Attempt a claim with a LEASE-length staleness window.
                    const staleBefore = now - LEASE;
                    const modelAllows = holder === null || holder.atMs <= staleBefore;
                    const won = store.claim(effect, worker, iso(now), iso(staleBefore));
                    expect(won).toBe(modelAllows);
                    if (won) model.set(effect, { worker, atMs: now });
                } else {
                    // Attempt a release — only the current holder's row dies.
                    const modelReleases = holder !== null && holder.worker === worker;
                    const released = store.release(effect, worker);
                    expect(released).toBe(modelReleases);
                    if (released) model.set(effect, null);
                }
            }
        } finally {
            a.close();
            b.close();
            rmSync(dir, { recursive: true, force: true });
        }
    });
});

describe("schedules under random interleaving: fire exactly once unless requeued", () => {
    it.each(SEEDS)("seed %i — 200 steps, two instances, eight schedules", (seed) => {
        const dir = mkdtempSync(join(tmpdir(), "store-stress-"));
        const path = join(dir, "store.sqlite");
        const a = new Store(path);
        const b = new Store(path);
        try {
            const rand = prng(seed);
            const stores = [a, b];
            const STUCK = 30 * MINUTE;
            const start = Date.parse("2026-07-25T00:00:00.000Z");
            let now = start;

            type Row = {
                status: "pending" | "running" | "done";
                dueMs: number;
                claimedMs: number | null;
                claimToken: string | null;
            };
            const model = new Map<string, Row>();
            for (let i = 0; i < 8; i++) {
                const id = `s${String(i)}`;
                const dueMs = start + Math.floor(rand() * 60 * MINUTE);
                a.schedule(id, iso(dueMs), "work");
                model.set(id, {
                    status: "pending",
                    dueMs,
                    claimedMs: null,
                    claimToken: null,
                });
            }
            const ids = [...model.keys()];
            const fireCounts = new Map(ids.map((id) => [id, 0]));
            const requeueCounts = new Map(ids.map((id) => [id, 0]));

            for (let step = 0; step < 200; step++) {
                now += Math.floor(rand() * 10 * MINUTE);
                const store = stores[Math.floor(rand() * 2)]!;
                const roll = rand();

                if (roll < 0.5) {
                    // claimDue must fire exactly the model's due pending set.
                    const expected = ids
                        .filter((id) => {
                            const row = model.get(id)!;
                            return row.status === "pending" && row.dueMs <= now;
                        })
                        .sort();
                    const claimed = store.claimDue(iso(now));
                    const fired = claimed.map((r) => r.scheduleId).sort();
                    expect(fired).toEqual(expected);
                    for (const claimedRow of claimed) {
                        const id = claimedRow.scheduleId;
                        const row = model.get(id)!;
                        row.status = "running";
                        row.claimedMs = now;
                        row.claimToken = claimedRow.claimToken;
                        fireCounts.set(id, fireCounts.get(id)! + 1);
                    }
                } else if (roll < 0.75) {
                    // Finish a random running schedule.
                    const running = ids.filter((id) => model.get(id)!.status === "running");
                    const id = running[Math.floor(rand() * running.length)];
                    if (id !== undefined) {
                        const token = model.get(id)!.claimToken!;
                        expect(store.scheduleDone(id, token)).toBe(true);
                        model.get(id)!.status = "done";
                        model.get(id)!.claimToken = null;
                    }
                } else {
                    // The sweep requeues exactly the model's stuck set.
                    const threshold = now - STUCK;
                    const expected = ids
                        .filter((id) => {
                            const row = model.get(id)!;
                            return (
                                row.status === "running" &&
                                row.claimedMs !== null &&
                                row.claimedMs <= threshold
                            );
                        })
                        .sort();
                    const requeued = store
                        .requeueStuck(iso(threshold))
                        .map((r) => r.scheduleId)
                        .sort();
                    expect(requeued).toEqual(expected);
                    for (const id of requeued) {
                        const row = model.get(id)!;
                        row.status = "pending";
                        row.claimedMs = null;
                        row.claimToken = null;
                        requeueCounts.set(id, requeueCounts.get(id)! + 1);
                    }
                }
            }

            // The headline invariant: fires per schedule never exceed
            // 1 + times requeued — no double-fire without a requeue.
            for (const id of ids) {
                expect(fireCounts.get(id)!).toBeLessThanOrEqual(1 + requeueCounts.get(id)!);
            }
        } finally {
            a.close();
            b.close();
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
