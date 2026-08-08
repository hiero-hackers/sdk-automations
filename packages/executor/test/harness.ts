/**
 * The crash-grid harness: a fake world that counts every application
 * (the reference model), a port that injects crashes at scheduled
 * perform-invocations, and a runner that restarts the executor — new
 * Store instance, new worker identity, clock advanced past the lease —
 * until the effect converges. Protocol 6.5's sandbox grid, automated.
 */
import { Store } from "@hiero-hackers/automation-store";
import {
    RecoveryExecutor,
    type AdapterCommand,
    type EffectPlan,
    type EffectPort,
    type PlannedCall,
    type RunResult,
} from "../src/recovery.js";

export class Crash extends Error {}

export type CrashMode = "beforeApply" | "afterApply";

export function fixtureCommand(
    operation: AdapterCommand["operation"],
    suffix = "",
): AdapterCommand {
    const common = {
        repository: { owner: "hiero-hackers", repo: "sandbox" },
        item: { kind: "issue" as const, number: 7 },
        configurationRevision: "config-sha-1",
        expected: {
            meaningsPresent: [] as const,
            meaningsAbsent: [] as const,
            closed: false,
        },
        configuredLabels: [{ meaning: "inProgress" as const, label: "status: doing" }],
    };
    switch (operation) {
        case "postManagedComment": {
            const marker = `<!-- managed${suffix} -->`;
            return {
                ...common,
                operation,
                desired: { marker, body: `body${suffix}` },
                readBack: { kind: "managedCommentMarker" },
            };
        }
        case "applyMappedLabel":
            return {
                ...common,
                operation,
                desired: { meaning: "inProgress", label: `status: doing${suffix}` },
                readBack: { kind: "mappedLabel" },
            };
        case "unassign":
            return {
                ...common,
                operation,
                desired: { login: `alice${suffix}` },
                readBack: { kind: "assigneeAbsent" },
            };
    }
}

/**
 * GitHub, reduced to what matters: which effects landed, how often.
 *
 * KINDER THAN GITHUB in one declared way (D46): `present` answers with
 * perfect read-after-write consistency. Real GitHub reads can lag
 * writes, so the grid's exactly-once results hold only under the
 * consistent-resolver precondition the real port must earn.
 */
export class FakeWorld {
    private readonly counts = new Map<string, number>();

    private key(plan: EffectPlan, call: PlannedCall): string {
        return `${plan.effectId}:${String(call.seq)}:${call.command.operation}`;
    }

    apply(plan: EffectPlan, call: PlannedCall): void {
        const k = this.key(plan, call);
        this.counts.set(k, (this.counts.get(k) ?? 0) + 1);
    }

    present(plan: EffectPlan, call: PlannedCall): boolean {
        return (this.counts.get(this.key(plan, call)) ?? 0) > 0;
    }

    applications(plan: EffectPlan, call: PlannedCall): number {
        return this.counts.get(this.key(plan, call)) ?? 0;
    }
}

/**
 * Crashes are scheduled by GLOBAL perform-invocation number, counted
 * across restarts — so a schedule describes one adversarial history,
 * not one process lifetime. `beforeApply` = died before the request
 * left; `afterApply` = request landed, response lost (the 6.5 case).
 */
export class CrashingPort implements EffectPort {
    private performInvocations = 0;
    readonly readBacks: string[] = [];
    readonly triggeredCrashes: number[] = [];

    constructor(
        private readonly world: FakeWorld,
        private readonly schedule: ReadonlyMap<number, CrashMode>,
    ) {}

    async perform(plan: EffectPlan, call: PlannedCall): Promise<void> {
        this.performInvocations += 1;
        const mode = this.schedule.get(this.performInvocations);
        if (mode === "beforeApply") {
            this.triggeredCrashes.push(this.performInvocations);
            throw new Crash();
        }
        this.world.apply(plan, call);
        if (mode === "afterApply") {
            this.triggeredCrashes.push(this.performInvocations);
            throw new Crash();
        }
    }

    async readBack(plan: EffectPlan, call: PlannedCall): Promise<"present" | "absent"> {
        this.readBacks.push(`${String(call.seq)}:${call.command.operation}`);
        return this.world.present(plan, call) ? "present" : "absent";
    }
}

export const LEASE_MS = 5 * 60_000;
const T0 = Date.parse("2026-07-25T00:00:00.000Z");

export interface Convergence {
    readonly result: RunResult;
    readonly world: FakeWorld;
    readonly restarts: number;
    readonly triggeredCrashes: readonly number[];
}

/**
 * Drive the effect to a terminal RunResult, restarting on every crash
 * exactly as a supervisor would: fresh Store on the same file, fresh
 * worker identity, clock advanced past the lease so D41's takeover
 * unblocks the crashed claim.
 */
export async function runToConvergence(
    path: string,
    plan: EffectPlan,
    schedule: ReadonlyMap<number, CrashMode>,
    maxRestarts = 20,
): Promise<Convergence> {
    const world = new FakeWorld();
    const port = new CrashingPort(world, schedule);
    let clockMs = T0;
    let restarts = 0;
    for (;;) {
        const store = new Store(path);
        const executor = new RecoveryExecutor(
            store,
            port,
            `w${String(restarts)}`,
            () => new Date(clockMs).toISOString(),
            LEASE_MS,
        );
        try {
            const result = await executor.runEffect(plan);
            store.close();
            return {
                result,
                world,
                restarts,
                triggeredCrashes: [...port.triggeredCrashes],
            };
        } catch (error) {
            store.close();
            if (!(error instanceof Crash)) throw error;
            restarts += 1;
            if (restarts > maxRestarts) {
                throw new Error(`no convergence after ${String(maxRestarts)} restarts`);
            }
            // The next incarnation starts after the dead worker's
            // lease has gone stale.
            clockMs += LEASE_MS + 60_000;
        }
    }
}

/** mulberry32 — the same tiny deterministic PRNG the store tests use. */
export function prng(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
