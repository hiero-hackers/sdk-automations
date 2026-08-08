/**
 * The composition run after D92 3(c): decide → planApproved → store →
 * executor, end to end, with only GitHub faked.
 *
 * The pipeline's decision half is now ONE call — `decide()` — where it used
 * to be this file's own wiring of screens and safety. What this file still
 * uniquely proves is the half no core test can: that an approved intent
 * survives translation, journalling, a crash, and recovery, exactly once.
 * The safety and destructive gates are pinned in `packages/core/test/engine/`; here
 * they appear only as the doorway every journey walks through.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "@hiero-hackers/automation-store";
import {
    RecoveryExecutor,
    planApproved,
    type EffectPlan,
    type EffectPort,
    type PlannedCall,
} from "@hiero-hackers/automation-executor";
import {
    decide,
    problems,
    type DecideExternals,
    type Decision,
    toEngine,
    type IssueMeaning,
    type ObservationProjection,
    type RepositoryConfig,
} from "@hiero-hackers/automation-core";
import { inactivity, intake } from "../src/index.js";
import { configEnabling, type AnyObservation } from "./world.js";

let dir: string;
let path: string;
let stores: Store[];
beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "probe-compose-"));
    path = join(dir, "store.sqlite");
    stores = [];
});
afterEach(() => {
    const errors: unknown[] = [];
    for (const store of stores.reverse()) {
        try {
            store.close();
        } catch (error) {
            errors.push(error);
        }
    }
    try {
        rmSync(dir, { recursive: true, force: true });
    } catch (error) {
        errors.push(error);
    }
    if (errors.length > 0) {
        throw new AggregateError(errors, "composition cleanup failed");
    }
});

function openStore(): Store {
    const store = new Store(path);
    stores.push(store);
    return store;
}

const AT = new Date("2026-08-03T09:00:00.000Z");
const NOW = new Date("2026-08-03T09:00:05.000Z");
const REPO = { owner: "hiero-hackers", repo: "sandbox" } as const;
const NAMES = ["intake", "inactivity"];

const externals: DecideExternals = {
    now: NOW,
    killSwitchActive: false,
    installationGrants: ["issues:write"],
    latestHumanChangeAt: () => null,
    resolve: async () => ({ ok: true, value: false }) as never,
};

const engineCaps = () => [toEngine(intake), toEngine(inactivity)];

async function decideOn(
    config: RepositoryConfig,
    observation: AnyObservation,
    over: Partial<DecideExternals> = {},
): Promise<Decision> {
    return decide({ kind: "observation", observation }, config, engineCaps(), {
        ...externals,
        ...over,
    });
}

/** Counts applications per call — the reference model for exactly-once. */
class CountingPort implements EffectPort {
    readonly applied: string[] = [];
    private failNext = new Set<string>();

    private key(plan: EffectPlan, call: PlannedCall) {
        return `${plan.effectId}#${String(call.seq)}`;
    }
    crashOn(plan: EffectPlan, call: PlannedCall) {
        this.failNext.add(this.key(plan, call));
    }
    async perform(plan: EffectPlan, call: PlannedCall): Promise<void> {
        const k = this.key(plan, call);
        this.applied.push(k);
        if (this.failNext.has(k)) {
            this.failNext.delete(k);
            // The response is lost AFTER the write landed — 6.5's case.
            throw new Error("connection reset");
        }
    }
    async readBack(plan: EffectPlan, call: PlannedCall) {
        return this.applied.includes(this.key(plan, call))
            ? ("present" as const)
            : ("absent" as const);
    }
}

const issueObservation: AnyObservation = {
    kind: "issueUpdated",
    repository: REPO,
    item: { kind: "issue", number: 11 },
    position: {
        kind: "position",
        state: { meaning: null, blocked: false, closedBy: null },
        ignored: [],
    },
    observedAt: AT,
};

describe("decide → planApproved → executor", () => {
    it("carries an intake decision all the way to an applied effect", async () => {
        const config = configEnabling(NAMES, NAMES, { intake: { announce: true } });
        const decision = await decideOn(config, issueObservation);
        expect(decision.approved).toHaveLength(2); // label + announcement
        expect(problems(decision.report)).toEqual([]);

        const { plans, refusals } = planApproved(decision.approved, {
            repository: REPO,
            config,
        });
        expect(refusals).toEqual([]);
        expect(plans).toHaveLength(2);
        expect(new Set(plans.map((p) => p.effectId)).size).toBe(2);

        const store = openStore();
        const port = new CountingPort();
        const executor = new RecoveryExecutor(store, port, "worker-1", () => NOW.toISOString());
        for (const plan of plans) {
            expect(await executor.runEffect(plan)).toEqual({ outcome: "complete" });
        }
        expect(port.applied).toHaveLength(2);
        for (const plan of plans) {
            expect(store.effectState(plan.effectId, 1).state).toBe("complete");
        }
    });

    it("re-deciding the same observation is exactly-once across a crash", async () => {
        const config = configEnabling(NAMES, NAMES, { intake: { announce: false } });
        const decision = await decideOn(config, issueObservation);
        const plan = planApproved(decision.approved, { repository: REPO, config }).plans[0]!;

        const port = new CountingPort();
        port.crashOn(plan, plan.calls[0]!);

        // First process dies mid-call; the claim is never released.
        const first = openStore();
        await expect(
            new RecoveryExecutor(first, port, "w1", () => NOW.toISOString()).runEffect(plan),
        ).rejects.toThrow("connection reset");

        // The restarted process takes the stale lease over and resolves.
        const later = new Date(NOW.getTime() + 30 * 60 * 1000);
        const second = openStore();
        const result = await new RecoveryExecutor(second, port, "w2", () =>
            later.toISOString(),
        ).runEffect(plan);

        expect(result).toEqual({ outcome: "complete" });
        // The read-back found the landed write; it was never re-sent.
        expect(port.applied).toEqual([`${plan.effectId}#1`]);
    });

    it("a redelivered event re-derives the same effect identity", async () => {
        const config = configEnabling(NAMES, NAMES, { intake: { announce: false } });
        const once = await decideOn(config, issueObservation);
        const twice = await decideOn(config, issueObservation);
        expect(twice.approved[0]!.idempotencyKey).toBe(once.approved[0]!.idempotencyKey);
    });
});

describe("the gates are the doorway, not a bypass", () => {
    it("a kill switch stops everything before any plan can exist", async () => {
        const config = configEnabling(NAMES, NAMES, { intake: { announce: false } });
        const decision = await decideOn(config, issueObservation, {
            killSwitchActive: true,
        });
        expect(decision.approved).toEqual([]);
        expect(decision.report.findings.map((f) => f.code)).toContain("killSwitch");
    });

    it("dry-run approves nothing, journals nothing, and still tells the story", async () => {
        const config = {
            ...configEnabling(NAMES, NAMES, { intake: { announce: true } }),
            mode: "dry-run" as const,
        };
        const decision = await decideOn(config, issueObservation);
        expect(decision.approved).toEqual([]);
        // The story: each would-be effect explains itself, none is a problem.
        const codes = decision.report.findings.map((f) => f.code);
        expect(codes.filter((c) => c === "capabilityExplained")).toHaveLength(2);
        expect(codes.filter((c) => c === "modeRecordsOnly")).toHaveLength(2);
        expect(problems(decision.report)).toEqual([]);

        const store = openStore();
        expect(store.openIntents(NOW.toISOString())).toEqual([]);
    });

    it("the destructive journey: warn first, act only after the grace period", async () => {
        const config = configEnabling(NAMES, NAMES, {
            inactivity: { gracePeriodDays: 7 },
        });
        const stale = (warnedAt: Date | null): AnyObservation => ({
            kind: "staleItemsDue",
            repository: REPO,
            items: [
                {
                    item: { kind: "issue", number: 13 },
                    assignee: "contributor",
                    lastHumanActivityAt: new Date("2026-07-01T00:00:00.000Z"),
                    warnedAt,
                },
            ],
            observedAt: AT,
        });

        // First sighting warns — a comment, never an act.
        const warned = await decideOn(config, stale(null));
        expect(warned.approved.map((i) => i.operation)).toEqual(["postManagedComment"]);

        // After the grace period, the reclaim is approved and executes.
        const acted = await decideOn(config, stale(new Date("2026-07-20T00:00:00.000Z")));
        expect(acted.approved.map((i) => i.operation)).toEqual(["unassign"]);

        const { plans } = planApproved(acted.approved, { repository: REPO, config });
        const store = openStore();
        const port = new CountingPort();
        const executor = new RecoveryExecutor(store, port, "w1", () => NOW.toISOString());
        expect(await executor.runEffect(plans[0]!)).toEqual({ outcome: "complete" });
        // The grace trio and the cause-drift refusal are pinned in
        // packages/core/test/engine/decide.test.ts — the gate itself is core's now.
    });
});

describe("a conflicted item reaches the capability as a conflict (D81)", () => {
    const conflicted: AnyObservation = {
        kind: "issueUpdated",
        repository: REPO,
        item: { kind: "issue", number: 11 },
        position: {
            kind: "conflict",
            positions: ["ready", "inProgress"],
            blocked: false,
            closedBy: null,
            ignored: [],
        } as ObservationProjection<IssueMeaning>,
        observedAt: AT,
    };

    it("intake declines, and the report says why", async () => {
        const config = configEnabling(NAMES, NAMES, { intake: { announce: true } });
        const decision = await decideOn(config, conflicted);
        expect(decision.approved).toEqual([]);
        const said = decision.report.findings
            .filter((f) => f.code === "capabilityExplained")
            .map((f) => f.summary)
            .join(" ");
        expect(said).toContain("more than one workflow position");
    });

    it("the same item with a clean projection is triaged", async () => {
        const config = configEnabling(NAMES, NAMES, { intake: { announce: false } });
        const decision = await decideOn(config, issueObservation);
        expect(decision.approved).toHaveLength(1);
        expect(decision.approved[0]!.operation).toBe("applyMappedLabel");
    });
});
