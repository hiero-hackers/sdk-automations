import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CONFIGS, JOURNEYS, WEBHOOK_CAPTURES } from "@hiero-hackers/automation-testkit";
import { CAPTURE_ORDER, CASES, PULL_REQUEST_LISTENERS } from "../src/action/cases.js";
import {
    readBackDifferences,
    rowDifferences,
    sorted,
    type LogRow,
    type TimelineEvent,
} from "../src/action/judge.js";
import {
    parseLog,
    QUIET_MS,
    runsRaised,
    settlementOf,
    type WorkflowRun,
} from "../src/action/runs.js";

const ISSUE = { kind: "issue", number: 200 } as const;

const row = (capability: string, verdict: string, code: string | null): LogRow => ({
    item: ISSUE,
    capability,
    verdict,
    code,
    detail: null,
});

const FIXTURE = new URL("./fixtures/action-run.log", import.meta.url);

describe("the cases cover the table", () => {
    it("has one case per config in the shared table, in its order", () => {
        expect(CASES.map((held) => held.capability)).toEqual(Object.keys(CONFIGS));
        for (const held of CASES) expect(held.config).toContain("mode: dry-run");
    });

    it("provokes the captures in order, the pull-request pair only for a listener", () => {
        const names = WEBHOOK_CAPTURES.map((held) => held.name);
        expect([...CAPTURE_ORDER].sort()).toEqual([...names].sort());
        for (const held of CASES) {
            const listener = PULL_REQUEST_LISTENERS.has(held.capability);
            expect(held.events.map((event) => event.capture)).toEqual(
                listener ? CAPTURE_ORDER : CAPTURE_ORDER.slice(0, 4),
            );
        }
    });

    it("expects each cell of the table and nothing where the table has no cell", () => {
        for (const held of CASES) {
            for (const event of held.events) {
                expect(event.expected).toEqual(JOURNEYS[held.capability]?.[event.capture] ?? []);
            }
        }
        const withPullCells = Object.entries(JOURNEYS)
            .filter(([, cells]) =>
                Object.keys(cells).some((name) => name.startsWith("pull_request.")),
            )
            .map(([capability]) => capability);
        for (const capability of withPullCells)
            expect(PULL_REQUEST_LISTENERS).toContain(capability);
    });

    it("edits the config file only in configReport's pull request", () => {
        const editors = CASES.filter((held) =>
            held.events.some(
                (event) => event.action.kind === "openPull" && event.action.editsConfig,
            ),
        );
        expect(editors.map((held) => held.capability)).toEqual(["configReport"]);
    });

    it("waits for the workflow event each action raises", () => {
        const raised = new Map<string, string[]>();
        for (const event of CASES.flatMap((held) => held.events)) {
            raised.set(event.action.kind, [...event.raises]);
        }
        expect(Object.fromEntries(raised)).toEqual({
            open: ["issues"],
            label: ["issues"],
            comment: ["issue_comment"],
            close: ["issues"],
            openPull: ["pull_request_target"],
            closePull: ["pull_request_target"],
        });
    });
});

describe("how the rows read differ from the cell", () => {
    const cell = [
        row("triageQueue", "info", "capabilityExplained"),
        row("triageQueue", "info", "wouldApply"),
        row("triageQueue", "notice", "modeRecordsOnly"),
    ];

    it("agrees when the same rows appear in another order", () => {
        expect(rowDifferences(ISSUE, cell, [...cell].reverse())).toEqual([]);
        expect(sorted([...cell].reverse())).toEqual(cell);
    });

    it("names each missing and each unexpected row, once per instance", () => {
        const found = [cell[0]!, cell[0]!, row("prDashboard", "info", "wouldApply")];
        expect(rowDifferences(ISSUE, cell, found)).toEqual([
            "missing: triageQueue info wouldApply",
            "missing: triageQueue notice modeRecordsOnly",
            "unexpected: prDashboard info wouldApply",
            "unexpected: triageQueue info capabilityExplained",
        ]);
    });

    it("names a row about another item and judges the rest", () => {
        const stray = { ...cell[1]!, item: { kind: "pullRequest", number: 7 } as const };
        expect(rowDifferences(ISSUE, cell, [cell[0]!, stray, cell[2]!])).toEqual([
            "a row about pullRequest#7, not issue#200: triageQueue info wouldApply",
            "missing: triageQueue info wouldApply",
        ]);
    });

    it("expects no row where the table has no cell", () => {
        expect(rowDifferences(ISSUE, [], [])).toEqual([]);
        expect(rowDifferences(ISSUE, [], [cell[2]!])).toEqual([
            "unexpected: triageQueue notice modeRecordsOnly",
        ]);
    });
});

describe("what GitHub read back", () => {
    const since = "2026-10-17T15:40:00Z";
    const events: TimelineEvent[] = [
        { event: "labeled", actor: "github-actions[bot]", at: "2026-10-17T15:39:00Z" },
        { event: "labeled", actor: "a-person", at: "2026-10-17T15:40:10Z" },
        { event: "commented", actor: "github-actions[bot]", at: "2026-10-17T15:40:20Z" },
        { event: "locked", actor: "github-actions[bot]", at: null },
    ];

    it("names each event by the Action since the step began, and nothing before it or by a person", () => {
        expect(readBackDifferences(events, since)).toEqual([
            "github-actions[bot] commented at 2026-10-17T15:40:20Z",
            "github-actions[bot] locked at an unknown time",
        ]);
        expect(readBackDifferences(events.slice(0, 2), since)).toEqual([]);
    });
});

describe("which runs a step raised", () => {
    const run = (id: number, event: string, createdAt: string): WorkflowRun => ({
        id,
        event,
        createdAt,
        status: "completed",
        conclusion: "success",
    });

    it("selects the runs created at or after the step began for the events it raises, claimed by none", () => {
        const listed = [
            run(1, "issues", "2026-10-17T15:39:59Z"),
            run(2, "issues", "2026-10-17T15:40:00Z"),
            run(3, "schedule", "2026-10-17T15:40:05Z"),
            run(4, "issues", "2026-10-17T15:40:07Z"),
            run(5, "issue_comment", "2026-10-17T15:40:09Z"),
        ];
        const since = "2026-10-17T15:40:00.000Z";
        expect(runsRaised(listed, since, ["issues"], new Set([4])).map((held) => held.id)).toEqual([
            2,
        ]);
        expect(runsRaised(listed, since, ["issues"], new Set()).map((held) => held.id)).toEqual([
            2, 4,
        ]);
    });
});

describe("whether a step has settled", () => {
    const run = (id: number, status: string, conclusion: string | null): WorkflowRun => ({
        id,
        event: "issues",
        createdAt: "2026-10-17T15:40:00Z",
        status,
        conclusion,
    });

    it("waits while no run has appeared, or one is still going", () => {
        expect(settlementOf([], QUIET_MS).kind).toBe("waiting");
        expect(settlementOf([run(1, "in_progress", null)], QUIET_MS).kind).toBe("waiting");
        expect(settlementOf([run(1, "queued", null)], QUIET_MS).kind).toBe("waiting");
    });

    it("settles once every run has completed and the set has held still for the quiet window", () => {
        const done = [run(1, "completed", "success"), run(2, "completed", "success")];
        expect(settlementOf(done, QUIET_MS - 1).kind).toBe("waiting");
        expect(settlementOf(done, QUIET_MS).kind).toBe("settled");
    });

    it("fails the step on a run that did not succeed, before any quiet window", () => {
        const runs = [run(1, "completed", "success"), run(2, "completed", "cancelled")];
        expect(settlementOf(runs, 0)).toEqual({ kind: "failed", reason: "run 2 cancelled" });
        expect(settlementOf([run(3, "completed", "failure")], QUIET_MS).kind).toBe("failed");
    });
});

describe("the rows in a job log", () => {
    const text = readFileSync(FIXTURE, "utf8");

    it("reads every row and the engine commit out of a saved run log", () => {
        const parsed = parseLog(text);
        expect(parsed.engineCommit).toBe("0123456789abcdef0123456789abcdef01234567");
        expect(parsed.malformed).toEqual([]);
        expect(
            parsed.rows.map(({ capability, verdict, code }) => [capability, verdict, code]),
        ).toEqual([
            ["triageQueue", "info", "capabilityExplained"],
            ["triageQueue", "info", "wouldApply"],
            ["triageQueue", "notice", "modeRecordsOnly"],
        ]);
        expect(
            parsed.rows.every((held) => held.item.kind === "issue" && held.item.number === 200),
        ).toBe(true);
    });

    it("round-trips a detail carrying a pipe and a newline, untouched by the summary's escaping", () => {
        const [first] = parseLog(text).rows;
        expect(first?.detail).toBe(
            "triageQueue | the awaitingTriage label is applied on open\nand the welcome posted",
        );
    });

    it("reads a log the API serves with the timestamp alone", () => {
        const bare = text
            .split("\n")
            .map((line) => line.split("\t").at(-1) ?? line)
            .join("\n");
        expect(parseLog(bare)).toEqual(parseLog(text));
    });

    it("keeps a line that claims to be a row and is not, and names no commit from a table", () => {
        const parsed = parseLog(
            [
                "2026-10-17T15:40:03.0000000Z sdk-automations.row not json",
                '2026-10-17T15:40:03.0000001Z sdk-automations.row {"item":{"kind":"issue"},"capability":"x","verdict":"info","code":null,"detail":null}',
                "2026-10-17T15:40:03.0000002Z | engine commit: 0123456789abcdef0123456789abcdef01234567 |",
            ].join("\n"),
        );
        expect(parsed.rows).toEqual([]);
        expect(parsed.malformed).toHaveLength(2);
        expect(parsed.engineCommit).toBeNull();
    });
});
