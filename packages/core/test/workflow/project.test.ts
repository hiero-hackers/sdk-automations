import { describe, it, expect } from "vitest";
import {
    closureOf,
    isPausedByProjection,
    projectIssueObservation,
    projectPrObservation,
    type LabelObservation,
} from "../../src/workflow/index.js";
import { ISSUE_MEANINGS, PR_MEANINGS, type ClosureReason } from "../../src/workflow/index.js";
import type { MappableMeaning } from "../../src/config/index.js";

const observed = (
    meanings: readonly MappableMeaning[],
    closedBy: ClosureReason | null = null,
): LabelObservation => ({ closedBy, meanings });

describe("observation projection (manual-edits.md §3, §8)", () => {
    it.each(ISSUE_MEANINGS)("a single issue position %s projects to that position", (m) => {
        expect(projectIssueObservation(observed([m]))).toEqual({
            kind: "position",
            state: { meaning: m, blocked: false, closedBy: null },
            ignored: [],
        });
    });

    it.each(PR_MEANINGS)("a single PR position %s projects to that position", (m) => {
        expect(projectPrObservation(observed([m]))).toEqual({
            kind: "position",
            state: { meaning: m, blocked: false, closedBy: null },
            ignored: [],
        });
    });

    it("no mapped meanings projects to no position", () => {
        expect(projectIssueObservation(observed([]))).toEqual({
            kind: "position",
            state: { meaning: null, blocked: false, closedBy: null },
            ignored: [],
        });
    });

    it("two own-flow positions are a conflict, never a repair (§8 test 3)", () => {
        const projection = projectIssueObservation(observed(["ready", "inProgress"]));
        expect(projection).toEqual({
            kind: "conflict",
            positions: ["ready", "inProgress"],
            blocked: false,
            closedBy: null,
            ignored: [],
        });
    });

    it("a conflict still reports cross-entity meanings as ignored", () => {
        expect(
            projectPrObservation(observed(["needsReview", "needsRevision", "ready", "blocked"])),
        ).toEqual({
            kind: "conflict",
            positions: ["needsReview", "needsRevision"],
            blocked: true,
            closedBy: null,
            ignored: ["ready"],
        });
    });

    it("all three own-flow positions conflict with all three reported", () => {
        const projection = projectPrObservation(
            observed(["needsReview", "needsRevision", "readyToMerge"]),
        );
        expect(projection.kind).toBe("conflict");
        if (projection.kind === "conflict") {
            expect(projection.positions).toHaveLength(3);
        }
    });

    it("blocked does not rescue a conflict", () => {
        expect(projectIssueObservation(observed(["ready", "inProgress", "blocked"])).kind).toBe(
            "conflict",
        );
    });

    it("duplicate observations of one meaning are one position, not a conflict", () => {
        expect(projectIssueObservation(observed(["ready", "ready"]))).toEqual({
            kind: "position",
            state: { meaning: "ready", blocked: false, closedBy: null },
            ignored: [],
        });
    });

    // FINDING(observe-cross-entity)
    it.each(PR_MEANINGS)(
        "PR meaning %s on an issue is ignored, not a position or conflict",
        (m) => {
            expect(projectIssueObservation(observed([m]))).toEqual({
                kind: "position",
                state: { meaning: null, blocked: false, closedBy: null },
                ignored: [m],
            });
        },
    );

    it("a cross-entity meaning coexists with an own position without conflict", () => {
        expect(projectPrObservation(observed(["needsReview", "inProgress"]))).toEqual({
            kind: "position",
            state: { meaning: "needsReview", blocked: false, closedBy: null },
            ignored: ["inProgress"],
        });
    });

    // FINDING(observe-blocked-alone)
    it("blocked with no position is legal: no position, paused (D28)", () => {
        expect(projectIssueObservation(observed(["blocked"]))).toEqual({
            kind: "position",
            state: { meaning: null, blocked: true, closedBy: null },
            ignored: [],
        });
    });

    it("blocked alongside a position keeps the position and sets the flag", () => {
        expect(projectPrObservation(observed(["blocked", "needsRevision"]))).toEqual({
            kind: "position",
            state: { meaning: "needsRevision", blocked: true, closedBy: null },
            ignored: [],
        });
    });

    // FINDING(observe-closed-position)
    it("a closed item keeps its position labels unchanged", () => {
        expect(projectIssueObservation(observed(["inProgress"], "closedByHuman"))).toEqual({
            kind: "position",
            state: { meaning: "inProgress", blocked: false, closedBy: "closedByHuman" },
            ignored: [],
        });
    });
});

// D59 — a conflict verdict carries the same orthogonal facts as a
// position verdict; a reporting surface needs "conflicted AND closed"
// to judge whether the conflict is worth anyone's attention.
describe("conflict verdicts carry blocked and closedBy (D59)", () => {
    it("reports the pause alongside the conflict", () => {
        expect(projectIssueObservation(observed(["ready", "inProgress", "blocked"]))).toEqual({
            kind: "conflict",
            positions: ["ready", "inProgress"],
            blocked: true,
            closedBy: null,
            ignored: [],
        });
    });

    it("reports the closure alongside the conflict", () => {
        expect(projectPrObservation(observed(["needsReview", "readyToMerge"], "merged"))).toEqual({
            kind: "conflict",
            positions: ["needsReview", "readyToMerge"],
            blocked: false,
            closedBy: "merged",
            ignored: [],
        });
    });
});

describe("closure and pause read the same on both branches", () => {
    /**
     * Closure rides on `state.closedBy` for a position and on `closedBy` at
     * the top level for a conflict (D59). Reading one branch only compiles
     * fine and silently treats every conflicted, closed item as open — which
     * is exactly the bug made the first time a capability consumed a
     * projection, and the reason these helpers exist.
     */
    it("finds closure whichever branch the projection took", () => {
        expect(
            closureOf({
                kind: "position",
                state: { meaning: null, blocked: false, closedBy: "merged" },
                ignored: [],
            }),
        ).toBe("merged");
        expect(
            closureOf({
                kind: "conflict",
                positions: ["ready", "inProgress"],
                blocked: false,
                closedBy: "merged",
                ignored: [],
            }),
        ).toBe("merged");
    });

    it("finds the pause flag whichever branch the projection took", () => {
        expect(
            isPausedByProjection({
                kind: "position",
                state: { meaning: null, blocked: true, closedBy: null },
                ignored: [],
            }),
        ).toBe(true);
        expect(
            isPausedByProjection({
                kind: "conflict",
                positions: ["ready", "inProgress"],
                blocked: true,
                closedBy: null,
                ignored: [],
            }),
        ).toBe(true);
    });

    it("reports open and unpaused when neither is set", () => {
        const clean = {
            kind: "position",
            state: { meaning: null, blocked: false, closedBy: null },
            ignored: [],
        } as const;
        expect(closureOf(clean)).toBeNull();
        expect(isPausedByProjection(clean)).toBe(false);
    });
});
