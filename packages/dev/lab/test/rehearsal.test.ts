import { describe, expect, it } from "vitest";
import {
    decisionDifferences,
    issueDifferences,
    settlementOf,
    tickedRows,
    type HookDelivery,
    type IssueState,
} from "../src/rehearsal/judge.js";
import { parsedOrHalt } from "../src/github.js";
import { SCENARIOS } from "../src/rehearsal/scenarios.js";

const attempt = (guid: string, statusCode = 202): HookDelivery => ({
    id: "1",
    guid,
    event: "issues",
    action: "opened",
    statusCode,
});

const queued: IssueState = { labels: ["a", "b"], locked: true, appComments: 1, appLabelWrites: 1 };

describe("whether a step's deliveries have settled", () => {
    it("waits while GitHub has listed nothing past the step's start", () => {
        expect(settlementOf([attempt("g1")], [{ id: "g1", state: "done" }], 1).kind).toBe(
            "waiting",
        );
    });

    it("settles once every listed delivery is done", () => {
        const hook = [attempt("g1"), attempt("g2")];
        const stored = [
            { id: "g1", state: "done" },
            { id: "g2", state: "done" },
        ];
        expect(settlementOf(hook, stored, 1).kind).toBe("settled");
    });

    it("counts a redelivery as a new attempt of a delivery already done", () => {
        const hook = [attempt("g1"), attempt("g1")];
        expect(settlementOf(hook, [{ id: "g1", state: "done" }], 1).kind).toBe("settled");
    });

    it("waits for a delivery the store has not finished", () => {
        const stored = [{ id: "g1", state: "processing" }];
        expect(settlementOf([attempt("g1")], stored, 0).kind).toBe("waiting");
    });

    it("waits while the store holds a delivery the hook's log does not list yet", () => {
        const stored = [
            { id: "g1", state: "done" },
            { id: "g2", state: "done" },
        ];
        expect(settlementOf([attempt("g1")], stored, 0).kind).toBe("waiting");
    });

    it("fails when the receiver did not accept an attempt", () => {
        const settlement = settlementOf([attempt("g1", 500)], [], 0);
        expect(settlement).toEqual({
            kind: "failed",
            reason: "the receiver did not accept g1 → 500",
        });
    });

    it("fails when the store failed a delivery", () => {
        const settlement = settlementOf([attempt("g1")], [{ id: "g1", state: "failed" }], 0);
        expect(settlement).toEqual({ kind: "failed", reason: "the store failed g1" });
    });
});

describe("how an issue differs from its step", () => {
    it("ignores label order", () => {
        expect(issueDifferences(queued, { ...queued, labels: ["b", "a"] })).toEqual([]);
    });

    it("names every field that differs", () => {
        const observed = { labels: ["a"], locked: false, appComments: 2, appLabelWrites: 0 };
        expect(issueDifferences(queued, observed)).toEqual([
            "labels: expected [a, b], found [a]",
            "locked: expected true, found false",
            "appComments: expected 1, found 2",
            "appLabelWrites: expected 1, found 0",
        ]);
    });
});

describe("a ticked checklist", () => {
    it("is judged only where the step names it", () => {
        expect(issueDifferences(queued, { ...queued, ticked: 1 })).toEqual([]);
        expect(issueDifferences({ ...queued, ticked: 1 }, { ...queued, ticked: 0 })).toEqual([
            "ticked: expected 1, found 0",
        ]);
    });

    it("counts only rows that start ticked", () => {
        const body =
            "Welcome.\n\nTriage checklist:\n- [x] Skill level\n- [ ] Type\nnot - [x] a row";
        expect(tickedRows(body)).toBe(1);
    });
});

describe("how a step's decisions fall short", () => {
    const row = {
        sourceId: "g1",
        capability: "triageQueue",
        verdict: "refused",
        code: "preconditionStale",
    };

    it("accepts the refusal the step expects", () => {
        expect(decisionDifferences([row], ["preconditionStale"])).toEqual([]);
    });

    it("names an expected refusal no row carries", () => {
        expect(decisionDifferences([], ["preconditionStale"])).toEqual([
            "expected a decision coded preconditionStale, found none",
        ]);
    });

    it("names an effect left unknown", () => {
        expect(decisionDifferences([{ ...row, verdict: "unknown", code: null }], [])).toEqual([
            "triageQueue left an effect unknown in g1",
        ]);
    });
});

describe("the scenarios", () => {
    it("have distinct names", () => {
        const names = SCENARIOS.map((scenario) => scenario.name);
        expect(new Set(names).size).toBe(names.length);
    });

    it("each open their issue first and only once", () => {
        const opens = new Set(["open", "openFromTemplate"]);
        for (const scenario of SCENARIOS) {
            const kinds = scenario.steps.map((step) => step.action.kind);
            expect(opens.has(kinds[0] ?? ""), scenario.name).toBe(true);
            expect(
                kinds.filter((kind) => opens.has(kind)),
                scenario.name,
            ).toHaveLength(1);
        }
    });
});

describe("a GitHub body", () => {
    it("keeps an integer beyond 2^53 exact, as its source text", () => {
        expect(parsedOrHalt('{"id":3845897491515973621,"n":5}', "GET /")).toEqual({
            id: "3845897491515973621",
            n: 5,
        });
    });
});
