/** The workflow a repository copies stays safe by construction: no checkout, one fixed lookup script, a read-mostly ceiling, writes unarmed. */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { repoRoot } from "./repository.js";

interface Step {
    readonly id?: unknown;
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

const hasNoCheckout = (workflow: Workflow): boolean =>
    usesOf(workflow).every((ref) => !ref.startsWith("actions/checkout"));

/** The one script finds the previous scheduled run; an interpolated expression could inject code into it. */
const isCursorLookup = (step: Step): boolean =>
    step.id === "previous" &&
    typeof step.run === "string" &&
    !step.run.includes("${{") &&
    step.run.includes("gh api") &&
    step.run.includes("event=schedule");

const scriptsOnlyLookUpTheCursor = (workflow: Workflow): boolean =>
    stepsOf(workflow).every((step) => step.run === undefined || isCursorLookup(step));

const hasExactCeiling = (workflow: Workflow): boolean =>
    JSON.stringify(Object.entries(workflow.permissions ?? {}).sort()) ===
    JSON.stringify(
        [
            ["actions", "read"],
            ["contents", "read"],
            ["issues", "write"],
            ["pull-requests", "write"],
        ].sort(),
    );

const queuesRuns = (workflow: Workflow): boolean =>
    workflow.concurrency?.["cancel-in-progress"] === false;

/** The two artifact steps that carry the sweep's cursor between scheduled runs (D248), SHA-pinned. */
const CURSOR_ARTIFACT = /^actions\/(download|upload)-artifact@[0-9a-f]{40}$/;

const isCursorArtifact = (step: Step): boolean =>
    typeof step.uses === "string" && CURSOR_ARTIFACT.test(step.uses);

const pinsTheAction = (workflow: Workflow): boolean => {
    const uses = usesOf(workflow).filter((ref) => !CURSOR_ARTIFACT.test(ref));
    return (
        uses.length === 1 &&
        /^hiero-hackers\/sdk-automations@(v[0-9]+|[0-9a-f]{40})$/.test(uses[0] ?? "")
    );
};

const startsUnarmed = (workflow: Workflow): boolean =>
    stepsOf(workflow).some((step) => step.with?.["arm-writes"] === "false");

/** Any default-branch run in the repository can write a cache entry, and restoring one can overwrite files. */
const usesNoCache = (workflow: Workflow): boolean =>
    usesOf(workflow).every((ref) => !ref.startsWith("actions/cache"));

const runsHourly = (workflow: Workflow): boolean =>
    workflow.on !== undefined && "schedule" in workflow.on;

const example = load(readFileSync(join(repoRoot, PATH), "utf8"));
const bad = (yaml: string): Workflow => load(yaml);

describe("the example workflow stays safe to copy", () => {
    it("has no checkout step, and no script but the cursor lookup", () => {
        expect(hasNoCheckout(example)).toBe(true);
        expect(scriptsOnlyLookUpTheCursor(example)).toBe(true);
    });

    it("grants exactly actions read, contents read, issues write, pull-requests write", () => {
        expect(hasExactCeiling(example)).toBe(true);
    });

    it("queues runs rather than cancelling them", () => {
        expect(queuesRuns(example)).toBe(true);
    });

    it("uses the action at a major tag or a full commit SHA, once", () => {
        expect(pinsTheAction(example)).toBe(true);
    });

    it("carries the cursor as an artifact, never a cache", () => {
        expect(stepsOf(example).filter(isCursorArtifact)).toHaveLength(2);
        expect(usesNoCache(example)).toBe(true);
    });

    it("ships with arm-writes the string false", () => {
        expect(startsUnarmed(example)).toBe(true);
    });

    it("runs on the hourly schedule", () => {
        expect(runsHourly(example)).toBe(true);
    });

    it("proves each rule can fail", () => {
        const job = (steps: string): Workflow => bad(`jobs:\n  a:\n    steps:\n${steps}\n`);
        expect(hasNoCheckout(job("      - uses: actions/checkout@v4"))).toBe(false);
        expect(scriptsOnlyLookUpTheCursor(job("      - run: echo hi"))).toBe(false);
        const lookup = 'gh api "runs?event=schedule"';
        expect(
            scriptsOnlyLookUpTheCursor(job(`      - id: previous\n        run: ${lookup}`)),
        ).toBe(true);
        expect(
            scriptsOnlyLookUpTheCursor(
                job(`      - id: previous\n        run: ${lookup} \${{ github.head_ref }}`),
            ),
        ).toBe(false);
        expect(hasExactCeiling(bad("permissions:\n  contents: write\n"))).toBe(false);
        expect(
            hasExactCeiling(
                bad(
                    "permissions:\n  contents: read\n  issues: write\n  pull-requests: write\n  actions: write\n",
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
        const upload = "actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9";
        const action = "      - uses: hiero-hackers/sdk-automations@v1";
        expect(pinsTheAction(job(`${action}\n      - uses: ${upload}`))).toBe(true);
        expect(pinsTheAction(job(`${action}\n      - uses: actions/upload-artifact@v7`))).toBe(
            false,
        );
        expect(
            usesNoCache(
                job("      - uses: actions/cache/restore@55cc8345863c7cc4c66a329aec7e433d2d1c52a9"),
            ),
        ).toBe(false);
        expect(
            startsUnarmed(job("      - uses: x@v1\n        with:\n          arm-writes: true")),
        ).toBe(false);
        expect(runsHourly(bad("on:\n  issues:\n    types: [opened]\n"))).toBe(false);
    });
});
