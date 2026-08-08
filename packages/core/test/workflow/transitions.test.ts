import { describe, it, expect } from "vitest";
import {
    ISSUE_CAUSES,
    ISSUE_MEANINGS,
    PR_CAUSES,
    PR_MEANINGS,
    CLOSURE_CAUSES,
    PROFILE_EDGES,
    canTransitionIssue,
    canTransitionPr,
    applyTransition,
    applyReopen,
    closureReasonFor,
    type ClosureReason,
    type IssueCause,
    type IssueMeaning,
    type PrCause,
    type PrMeaning,
    type WorkItemState,
    isIssueCause,
    isIssueMeaning,
    isPrCause,
    isPrMeaning,
} from "../../src/workflow/index.js";
import { MAPPABLE_MEANINGS } from "../../src/config/index.js";

/**
 * The exhaustive matrix: every (from, to, cause) triple is either exactly
 * one of the design doc's edges or rejected. The design's diagrams ARE the
 * spec — if an edit to the tables adds or drops an edge, the counts here
 * fail before any capability misbehaves.
 *
 * Note the limit this suite cannot exceed: its oracle is the edge list, so
 * it proves the tables are COHERENT, never that they are COMPLETE. A
 * missing edge is consistently missing and passes every assertion below —
 * which is how D48's `readyToMerge → needsRevision` gap survived the first
 * implementation. Completeness comes from the audit and from maintainers;
 * `doc-drift.test.ts` at least stops the tables and the diagrams from
 * disagreeing about it.
 */

const ALL_ISSUE_CAUSES: readonly IssueCause[] = ISSUE_CAUSES;
const ALL_PR_CAUSES: readonly PrCause[] = PR_CAUSES;

describe("issue flow (taxonomy.md §4)", () => {
    const positions: (IssueMeaning | null)[] = [null, ...ISSUE_MEANINGS];

    it("allows exactly the documented edges and nothing else", () => {
        const allowed: string[] = [];
        for (const from of positions) {
            for (const to of positions) {
                for (const cause of ALL_ISSUE_CAUSES) {
                    if (canTransitionIssue({ from, to, cause }).allowed) {
                        allowed.push(`${String(from)}->${String(to)}:${cause}`);
                    }
                }
            }
        }
        expect(allowed.sort()).toEqual(
            [
                "null->awaitingTriage:intakeObserved",
                "awaitingTriage->ready:triageCompleted",
                "ready->inProgress:contributorAssigned",
                "inProgress->ready:lastContributorUnassigned",
                "inProgress->ready:reclaimCompleted",
                "awaitingTriage->null:humanClosed",
                "ready->null:humanClosed",
                "ready->null:linkedMergeClosed",
                "inProgress->null:humanClosed",
                "inProgress->null:linkedMergeClosed",
            ].sort(),
        );
    });

    /**
     * D50: a PR cause on an issue request no longer type-checks, so the
     * old runtime `causeNotAccepted` case for it is unreachable — the
     * cast below is what a shell would have to write deliberately to get
     * there, and the refusal is kept as defence in depth.
     */
    it("a PR cause is a compile error, and still refused if cast through", () => {
        expect(
            canTransitionIssue({
                from: "awaitingTriage",
                to: "ready",
                cause: "checksPassed" as unknown as IssueCause,
            }),
        ).toMatchObject({ allowed: false, code: "causeNotAccepted" });
    });
});

describe("pull request flow (taxonomy.md §5)", () => {
    const positions: (PrMeaning | null)[] = [null, ...PR_MEANINGS];

    it("allows exactly the documented edges and nothing else", () => {
        const allowed: string[] = [];
        for (const from of positions) {
            for (const to of positions) {
                for (const cause of ALL_PR_CAUSES) {
                    if (canTransitionPr({ from, to, cause }).allowed) {
                        allowed.push(`${String(from)}->${String(to)}:${cause}`);
                    }
                }
            }
        }
        expect(allowed.sort()).toEqual(
            [
                "null->needsReview:checksPassed",
                "null->needsRevision:checksFailed",
                "needsReview->needsRevision:checksFailed",
                "needsReview->needsRevision:reviewRequestedChanges",
                "needsRevision->needsReview:revisionResolved",
                "needsReview->readyToMerge:reviewPolicySatisfied",
                "readyToMerge->needsReview:approvalInvalidated",
                "readyToMerge->needsRevision:checksFailed",
                "needsReview->null:humanClosed",
                "needsReview->null:merged",
                "needsRevision->null:humanClosed",
                "needsRevision->null:merged",
                "readyToMerge->null:humanClosed",
                "readyToMerge->null:merged",
            ].sort(),
        );
    });

    it("readyToMerge is reachable only from needsReview", () => {
        for (const from of [null, "needsRevision", "readyToMerge"] as const) {
            for (const cause of ALL_PR_CAUSES) {
                expect(canTransitionPr({ from, to: "readyToMerge", cause }).allowed).toBe(false);
            }
        }
    });

    // D48 — the two gaps, pinned so they cannot silently close again.
    it("an approved PR whose checks break reaches needsRevision (D48)", () => {
        expect(
            canTransitionPr({
                from: "readyToMerge",
                to: "needsRevision",
                cause: "checksFailed",
            }),
        ).toEqual({ allowed: true });
    });

    it("a requested-changes review reaches needsRevision without a failing check (D48)", () => {
        expect(
            canTransitionPr({
                from: "needsReview",
                to: "needsRevision",
                cause: "reviewRequestedChanges",
            }),
        ).toEqual({ allowed: true });
    });

    it("a merged PR and a closed-unmerged PR are different closures (D47)", () => {
        const at = (meaning: PrMeaning): WorkItemState<PrMeaning> => ({
            meaning,
            blocked: false,
            closedBy: null,
        });
        const merged = applyTransition(
            at("readyToMerge"),
            { from: "readyToMerge", to: null, cause: "merged" },
            canTransitionPr,
        );
        const abandoned = applyTransition(
            at("needsRevision"),
            { from: "needsRevision", to: null, cause: "humanClosed" },
            canTransitionPr,
        );
        expect(merged.state.closedBy).toBe("merged");
        expect(abandoned.state.closedBy).toBe("closedByHuman");
    });
});

describe("closure reasons (D47)", () => {
    it("every cause that reaches null maps to exactly one closure reason", () => {
        for (const cause of CLOSURE_CAUSES) {
            expect(closureReasonFor(cause)).not.toBeNull();
        }
    });

    it("no other cause records a closure", () => {
        const closure = new Set<string>(CLOSURE_CAUSES);
        for (const cause of [...ISSUE_CAUSES, ...PR_CAUSES]) {
            if (!closure.has(cause)) expect(closureReasonFor(cause)).toBeNull();
        }
    });

    /**
     * The invariant `applyTransition` relies on to record WHY an item
     * closed without knowing its entity: nothing reaches `to: null`
     * except a closure cause. If a future edge breaks this, a closed
     * item would come back with `closedBy: null` — open, per the type.
     */
    it("no edge to null uses a cause outside CLOSURE_CAUSES", () => {
        const closure = new Set<string>(CLOSURE_CAUSES);
        const issueClosers = ALL_ISSUE_CAUSES.filter((cause) =>
            [null, ...ISSUE_MEANINGS].some(
                (from) => canTransitionIssue({ from, to: null, cause }).allowed,
            ),
        );
        const prClosers = ALL_PR_CAUSES.filter((cause) =>
            [null, ...PR_MEANINGS].some(
                (from) => canTransitionPr({ from, to: null, cause }).allowed,
            ),
        );
        expect(issueClosers.length).toBeGreaterThan(0);
        expect(prClosers.length).toBeGreaterThan(0);
        for (const cause of [...issueClosers, ...prClosers]) {
            expect(closure.has(cause)).toBe(true);
        }
    });
});

describe("reopening is a closure clear, not a transition (D49)", () => {
    const closedAt = (
        meaning: IssueMeaning | null,
        closedBy: ClosureReason,
    ): WorkItemState<IssueMeaning> => ({ meaning, blocked: false, closedBy });

    it("reopening restores the item exactly — the position was never removed (D35)", () => {
        const { state, verdict } = applyReopen(closedAt("inProgress", "closedByHuman"));
        expect(verdict).toEqual({ allowed: true });
        expect(state).toEqual({ meaning: "inProgress", blocked: false, closedBy: null });
    });

    it("a reopened item accepts transitions again", () => {
        const reopened = applyReopen(closedAt("ready", "completedByLinkedMerge")).state;
        const { verdict } = applyTransition(
            reopened,
            { from: "ready", to: "inProgress", cause: "contributorAssigned" },
            canTransitionIssue,
        );
        expect(verdict).toEqual({ allowed: true });
    });

    it("a merged pull request can never reopen", () => {
        const merged: WorkItemState<PrMeaning> = {
            meaning: "readyToMerge",
            blocked: false,
            closedBy: "merged",
        };
        const { state, verdict } = applyReopen(merged);
        expect(verdict).toMatchObject({ allowed: false, code: "mergedNotReopenable" });
        expect(state).toEqual(merged);
    });

    it("reopening an open item is refused, not absorbed as a no-op", () => {
        const open: WorkItemState<IssueMeaning> = {
            meaning: "ready",
            blocked: false,
            closedBy: null,
        };
        expect(applyReopen(open).verdict).toMatchObject({
            allowed: false,
            code: "notClosed",
        });
    });

    it("reopening preserves the pause — blocked is orthogonal to closure (D28)", () => {
        const { state } = applyReopen({
            meaning: "ready",
            blocked: true,
            closedBy: "closedByHuman",
        });
        expect(state.blocked).toBe(true);
    });
});

describe("work-item invariants (test-architecture: invariants layer)", () => {
    const at = (
        meaning: IssueMeaning | null,
        extra?: Partial<WorkItemState<IssueMeaning>>,
    ): WorkItemState<IssueMeaning> => ({
        meaning,
        blocked: false,
        closedBy: null,
        ...extra,
    });

    it("an item is never in two positions — meaning is scalar by construction", () => {
        // Structural invariant: the type allows exactly one meaning. The
        // runtime counterpart: applying a legal transition replaces the
        // position, never accumulates one.
        const { state } = applyTransition(
            at("ready"),
            { from: "ready", to: "inProgress", cause: "contributorAssigned" },
            canTransitionIssue,
        );
        expect(state.meaning).toBe("inProgress");
    });

    it("a blocked item refuses every capability transition (safety.md §5)", () => {
        for (const to of [...ISSUE_MEANINGS, null]) {
            for (const cause of ALL_ISSUE_CAUSES) {
                const { state, verdict } = applyTransition(
                    at("ready", { blocked: true }),
                    { from: "ready", to, cause },
                    canTransitionIssue,
                );
                expect(verdict.allowed).toBe(false);
                expect(state.meaning).toBe("ready"); // position survives the pause
            }
        }
    });

    it("a stale precondition refuses instead of overwriting (human edits win)", () => {
        // The request believed the issue was `ready`; a human moved it.
        const { verdict } = applyTransition(
            at("inProgress"),
            { from: "ready", to: "inProgress", cause: "contributorAssigned" },
            canTransitionIssue,
        );
        expect(verdict).toMatchObject({ allowed: false, code: "stalePrecondition" });
    });

    it("a closed item accepts nothing, and says which closure refused", () => {
        const { verdict } = applyTransition(
            at(null, { closedBy: "closedByHuman" }),
            { from: null, to: "awaitingTriage", cause: "intakeObserved" },
            canTransitionIssue,
        );
        expect(verdict).toMatchObject({ allowed: false, code: "itemClosed" });
        if (!verdict.allowed) expect(verdict.reason).toContain("closedByHuman");
    });

    it("the pause is reported before the edge check — a blocked item's code is itemBlocked", () => {
        const { verdict } = applyTransition(
            at("ready", { blocked: true }),
            { from: "ready", to: "inProgress", cause: "contributorAssigned" },
            canTransitionIssue,
        );
        expect(verdict).toMatchObject({ allowed: false, code: "itemBlocked" });
    });

    // Mutation-testing survivors, now pinned:
    it("a refused edge leaves the state EXACTLY unchanged — refusal must never apply", () => {
        const before = at("ready");
        const { state, verdict } = applyTransition(
            before,
            // Precondition matches, but the edge itself is illegal.
            { from: "ready", to: "awaitingTriage", cause: "triageCompleted" },
            canTransitionIssue,
        );
        expect(verdict).toMatchObject({ allowed: false, code: "noSuchEdge" });
        expect(state).toEqual(before);
    });

    it("closing transitions record the closure; ordinary moves leave it null", () => {
        const closed = applyTransition(
            at("ready"),
            { from: "ready", to: null, cause: "humanClosed" },
            canTransitionIssue,
        );
        expect(closed.state).toEqual({
            meaning: "ready",
            blocked: false,
            closedBy: "closedByHuman",
        });

        expect(applyReopen(closed.state)).toEqual({
            state: { meaning: "ready", blocked: false, closedBy: null },
            verdict: { allowed: true },
        });

        const linked = applyTransition(
            at("ready"),
            { from: "ready", to: null, cause: "linkedMergeClosed" },
            canTransitionIssue,
        );
        expect(linked.state.closedBy).toBe("completedByLinkedMerge");

        const moved = applyTransition(
            at("ready"),
            { from: "ready", to: "inProgress", cause: "contributorAssigned" },
            canTransitionIssue,
        );
        expect(moved.state).toEqual({
            meaning: "inProgress",
            blocked: false,
            closedBy: null,
        });
    });

    it("every refusal carries a non-empty human reason alongside its code", () => {
        const refusals = [
            applyTransition(
                at("ready", { blocked: true }),
                { from: "ready", to: "inProgress", cause: "contributorAssigned" },
                canTransitionIssue,
            ),
            applyTransition(
                at(null, { closedBy: "closedByHuman" }),
                { from: null, to: "awaitingTriage", cause: "intakeObserved" },
                canTransitionIssue,
            ),
            applyTransition(
                at("inProgress"),
                { from: "ready", to: "inProgress", cause: "contributorAssigned" },
                canTransitionIssue,
            ),
            applyTransition(
                at("ready"),
                { from: "ready", to: "awaitingTriage", cause: "triageCompleted" },
                canTransitionIssue,
            ),
            applyTransition(
                at("ready"),
                { from: "ready", to: "inProgress", cause: "reclaimCompleted" },
                canTransitionIssue,
            ),
            applyReopen(at("ready")),
            applyReopen({ meaning: null, blocked: false, closedBy: "merged" }),
        ];
        for (const { verdict } of refusals) {
            expect(verdict.allowed).toBe(false);
            if (!verdict.allowed) expect(verdict.reason.length).toBeGreaterThan(0);
        }
    });
});

describe("the profile tables are exported for the drift check", () => {
    it("PROFILE_EDGES mirrors the private tables, one entry per edge", () => {
        expect(PROFILE_EDGES.issue).toHaveLength(7);
        expect(PROFILE_EDGES.pullRequest).toHaveLength(10);
    });
});

describe("the flow predicates — D90's replacement for the casts", () => {
    /**
     * Screen-level tests cannot kill mutants here: a predicate that wrongly
     * ACCEPTS a foreign cause still ends in `transitionNotOnMap`, because the
     * edge table backstops it. Only direct assertions see the predicate
     * itself — which is fine, because the predicates are now the single
     * place flow membership is decided.
     */
    it("cause predicates accept their own flow", () => {
        expect(isIssueCause("triageCompleted")).toBe(true);
        expect(isPrCause("reviewPolicySatisfied")).toBe(true);
        // The one cause both flows share.
        expect(isIssueCause("humanClosed")).toBe(true);
        expect(isPrCause("humanClosed")).toBe(true);
    });

    it("cause predicates reject the other flow", () => {
        expect(isIssueCause("merged")).toBe(false);
        expect(isIssueCause("checksPassed")).toBe(false);
        expect(isPrCause("triageCompleted")).toBe(false);
        expect(isPrCause("intakeObserved")).toBe(false);
    });

    it("meaning predicates split the vocabulary exactly, with blocked in neither", () => {
        const issues = MAPPABLE_MEANINGS.filter(isIssueMeaning);
        const prs = MAPPABLE_MEANINGS.filter(isPrMeaning);
        expect(issues).toEqual(["awaitingTriage", "ready", "inProgress"]);
        expect(prs).toEqual(["needsReview", "needsRevision", "readyToMerge"]);
        expect(isIssueMeaning("blocked")).toBe(false);
        expect(isPrMeaning("blocked")).toBe(false);
    });

    it("the derived arrays are the predicate filters", () => {
        expect(ISSUE_MEANINGS).toEqual(MAPPABLE_MEANINGS.filter(isIssueMeaning));
        expect(PR_MEANINGS).toEqual(MAPPABLE_MEANINGS.filter(isPrMeaning));
    });
});
