/**
 * The crash grid: every single reachable perform crash, 64 scheduled
 * two-point histories, and seeded multi-crash histories — all must converge to the
 * same terminal state: effect complete, every call applied, the
 * non-idempotent call applied EXACTLY once. This is 6.5's hand-run
 * sandbox grid, exhaustive and repeatable.
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "@hiero-hackers/automation-store";
import type { EffectPlan } from "../src/recovery.js";
import { fixtureCommand, runToConvergence, prng, type CrashMode } from "./harness.js";

const PLAN: EffectPlan = {
    effectId: "assign-issue-7",
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

async function inTmp<T>(fn: (path: string) => Promise<T>): Promise<T> {
    const dir = mkdtempSync(join(tmpdir(), "executor-grid-"));
    try {
        return await fn(join(dir, "store.sqlite"));
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

async function assertConverged(
    path: string,
    schedule: ReadonlyMap<number, CrashMode>,
): Promise<number> {
    const { result, world, triggeredCrashes } = await runToConvergence(path, PLAN, schedule);
    expect(result).toEqual({ outcome: "complete" });
    for (const call of PLAN.calls) {
        expect(world.applications(PLAN, call)).toBeGreaterThanOrEqual(1);
    }
    // The invariant the whole design exists for: the non-idempotent
    // call landed exactly once, no matter where the crashes fell.
    expect(world.applications(PLAN, PLAN.calls[1]!)).toBe(1);
    // And the journal agrees the effect is closed.
    const store = new Store(path);
    expect(store.effectState(PLAN.effectId, PLAN.calls.length)).toMatchObject({
        state: "complete",
    });
    store.close();
    return triggeredCrashes.length;
}

describe("single crash at every point", () => {
    const modes: CrashMode[] = ["beforeApply", "afterApply"];
    it.each([1, 2, 3].flatMap((p) => modes.map((m) => [p, m] as const)))(
        "crash %i/%s converges with no duplicate",
        async (invocation, mode) => {
            await inTmp((path) => assertConverged(path, new Map([[invocation, mode]])));
        },
    );
});

describe("64 scheduled two-point histories across incarnations", () => {
    const modes: CrashMode[] = ["beforeApply", "afterApply"];
    const pairs: [number, CrashMode, number, CrashMode][] = [];
    for (let p1 = 1; p1 <= 4; p1++)
        for (const m1 of modes)
            for (let p2 = p1 + 1; p2 <= p1 + 4; p2++)
                for (const m2 of modes) pairs.push([p1, m1, p2, m2]);

    it(`all ${String(pairs.length)} pairs converge with no duplicate`, async () => {
        const triggeredCounts = new Map<number, number>();
        for (const [p1, m1, p2, m2] of pairs) {
            const triggered = await inTmp((path) =>
                assertConverged(
                    path,
                    new Map([
                        [p1, m1],
                        [p2, m2],
                    ]),
                ),
            );
            triggeredCounts.set(triggered, (triggeredCounts.get(triggered) ?? 0) + 1);
        }
        // The old test called all 64 schedules "crash pairs", but
        // many later invocation numbers are unreachable after the
        // effect completes. Preserve all cases while making the
        // actual exercised evidence explicit.
        expect(Object.fromEntries(triggeredCounts)).toEqual({
            0: 16,
            1: 30,
            2: 18,
        });
    }, 20_000);
});

describe("seeded multi-crash histories", () => {
    it.each(Array.from({ length: 10 }, (_, i) => i + 1))(
        "seed %i — random crash schedule converges with no duplicate",
        async (seed) => {
            const rand = prng(seed);
            // Each of the first 12 perform-invocations may crash.
            const schedule = new Map<number, CrashMode>();
            let crashes = 0;
            for (let invocation = 1; invocation <= 12 && crashes < 6; invocation++) {
                if (rand() < 0.35) {
                    schedule.set(invocation, rand() < 0.5 ? "beforeApply" : "afterApply");
                    crashes += 1;
                }
            }
            await inTmp((path) => assertConverged(path, schedule));
        },
    );
});
