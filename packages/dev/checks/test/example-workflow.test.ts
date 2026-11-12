/** The workflow a repository copies stays safe by construction: no checkout, no script, a read-mostly ceiling, writes unarmed. */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { repoRoot } from "./repository.js";

interface Step {
    readonly if?: unknown;
    readonly uses?: unknown;
    readonly run?: unknown;
    readonly with?: Readonly<Record<string, unknown>>;
}

interface Workflow {
    readonly on?: Readonly<Record<string, unknown>>;
    readonly permissions?: unknown;
    readonly concurrency?: Readonly<Record<string, unknown>>;
    readonly jobs?: Readonly<Record<string, { readonly steps?: readonly Step[] } | null>>;
}

const PATH = "docs/examples/sdk-automations.workflow.yml";

const load = (text: string): Workflow => (parse(text) as Workflow | null) ?? {};

const stepsOf = (workflow: Workflow): Step[] =>
    Object.values(workflow.jobs ?? {}).flatMap((job) => [...(job?.steps ?? [])]);

const usesOf = (workflow: Workflow): string[] =>
    stepsOf(workflow).flatMap((step) => (typeof step.uses === "string" ? [step.uses] : []));

const hasNoCheckoutOrScript = (workflow: Workflow): boolean =>
    stepsOf(workflow).every(
        (step) =>
            step.run === undefined &&
            !(typeof step.uses === "string" && step.uses.startsWith("actions/checkout")),
    );

const hasExactCeiling = (workflow: Workflow): boolean =>
    JSON.stringify(Object.entries(workflow.permissions ?? {}).sort()) ===
    JSON.stringify(
        [
            ["contents", "read"],
            ["issues", "write"],
            ["pull-requests", "write"],
        ].sort(),
    );

const queuesRuns = (workflow: Workflow): boolean =>
    workflow.concurrency?.["cancel-in-progress"] === false;

/** The two cache steps that carry the sweep's cursor between scheduled runs (D248), SHA-pinned. */
const CURSOR_CACHE = /^actions\/cache\/(restore|save)@[0-9a-f]{40}$/;

const isCursorCache = (step: Step): boolean =>
    typeof step.uses === "string" && CURSOR_CACHE.test(step.uses);

const pinsTheAction = (workflow: Workflow): boolean => {
    const uses = usesOf(workflow).filter((ref) => !CURSOR_CACHE.test(ref));
    return (
        uses.length === 1 &&
        /^hiero-hackers\/sdk-automations@(v[0-9]+|[0-9a-f]{40})$/.test(uses[0] ?? "")
    );
};

const startsUnarmed = (workflow: Workflow): boolean =>
    stepsOf(workflow).some((step) => step.with?.["arm-writes"] === "false");

/** A cache a pull request's run could write is one it could poison, so only the schedule touches it. */
const cachesOnlyOnSchedule = (workflow: Workflow): boolean =>
    stepsOf(workflow)
        .filter(isCursorCache)
        .every(
            (step) =>
                typeof step.if === "string" && step.if.includes("github.event_name == 'schedule'"),
        );

const runsHourly = (workflow: Workflow): boolean =>
    workflow.on !== undefined && "schedule" in workflow.on;

const example = load(readFileSync(join(repoRoot, PATH), "utf8"));
const bad = (yaml: string): Workflow => load(yaml);

describe("the example workflow stays safe to copy", () => {
    it("has no checkout step and no run step", () => {
        expect(hasNoCheckoutOrScript(example)).toBe(true);
    });

    it("grants exactly contents read, issues write, pull-requests write", () => {
        expect(hasExactCeiling(example)).toBe(true);
    });

    it("queues runs rather than cancelling them", () => {
        expect(queuesRuns(example)).toBe(true);
    });

    it("uses the action at a major tag or a full commit SHA, once", () => {
        expect(pinsTheAction(example)).toBe(true);
    });

    it("touches the cursor cache on the schedule alone", () => {
        expect(stepsOf(example).filter(isCursorCache)).toHaveLength(2);
        expect(cachesOnlyOnSchedule(example)).toBe(true);
    });

    it("ships with arm-writes the string false", () => {
        expect(startsUnarmed(example)).toBe(true);
    });

    it("runs on the hourly schedule", () => {
        expect(runsHourly(example)).toBe(true);
    });

    it("proves each rule can fail", () => {
        const job = (steps: string): Workflow => bad(`jobs:\n  a:\n    steps:\n${steps}\n`);
        expect(hasNoCheckoutOrScript(job("      - uses: actions/checkout@v4"))).toBe(false);
        expect(hasNoCheckoutOrScript(job("      - run: echo hi"))).toBe(false);
        expect(hasExactCeiling(bad("permissions:\n  contents: write\n"))).toBe(false);
        expect(
            hasExactCeiling(
                bad(
                    "permissions:\n  contents: read\n  issues: write\n  pull-requests: write\n  actions: read\n",
                ),
            ),
        ).toBe(false);
        expect(queuesRuns(bad("concurrency:\n  cancel-in-progress: true\n"))).toBe(false);
        expect(queuesRuns(bad("name: x\n"))).toBe(false);
        expect(pinsTheAction(job("      - uses: hiero-hackers/sdk-automations@main"))).toBe(false);
        expect(pinsTheAction(job("      - uses: hiero-hackers/sdk-automations@abc123"))).toBe(
            false,
        );
        expect(pinsTheAction(job("      - uses: hiero-hackers/sdk-automations@v1"))).toBe(true);
        const cache = "actions/cache/save@55cc8345863c7cc4c66a329aec7e433d2d1c52a9";
        const action = "      - uses: hiero-hackers/sdk-automations@v1";
        expect(pinsTheAction(job(`${action}\n      - uses: ${cache}`))).toBe(true);
        expect(pinsTheAction(job(`${action}\n      - uses: actions/cache/save@v6`))).toBe(false);
        expect(cachesOnlyOnSchedule(job(`      - uses: ${cache}`))).toBe(false);
        expect(
            cachesOnlyOnSchedule(
                job(`      - if: github.event_name == 'push'\n        uses: ${cache}`),
            ),
        ).toBe(false);
        expect(
            startsUnarmed(job("      - uses: x@v1\n        with:\n          arm-writes: true")),
        ).toBe(false);
        expect(runsHourly(bad("on:\n  issues:\n    types: [opened]\n"))).toBe(false);
    });
});
