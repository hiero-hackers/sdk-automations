/**
 * The two workflow diagrams from `design/core/taxonomy.md` §4–§5, verbatim
 * as edge tables.
 *
 * `packages/checks/test/doc-drift.test.ts` parses the diagrams out of that document and
 * asserts these tables match them edge for edge, in both directions — the
 * tables ARE the design, transcribed, and a transcription with nothing
 * checking it is how D48's missing edge survived in both artifacts at once.
 */

import type {
    EntityKind,
    IssueCause,
    IssueMeaning,
    PrCause,
    PrMeaning,
    TransitionCause,
} from "./meanings.js";

export interface Edge<M, C extends TransitionCause> {
    readonly from: M | null;
    readonly to: M | null;
    readonly causes: readonly C[];
}

/** taxonomy.md §4, verbatim as edges. */
export const ISSUE_EDGES: readonly Edge<IssueMeaning, IssueCause>[] = [
    { from: null, to: "awaitingTriage", causes: ["intakeObserved"] },
    { from: "awaitingTriage", to: "ready", causes: ["triageCompleted"] },
    { from: "ready", to: "inProgress", causes: ["contributorAssigned"] },
    {
        from: "inProgress",
        to: "ready",
        causes: ["lastContributorUnassigned", "reclaimCompleted"],
    },
    { from: "awaitingTriage", to: null, causes: ["humanClosed"] },
    { from: "ready", to: null, causes: ["humanClosed", "linkedMergeClosed"] },
    { from: "inProgress", to: null, causes: ["humanClosed", "linkedMergeClosed"] },
    /**
     * FINDING(taxonomy-manual-entry), D29: "every state has a
     * non-module way in" implies manual-entry edges §4 omits. Manual
     * label application is observed reality to reconcile
     * (manual-edits.md), not a requestable transition — no edges added.
     */
];

/** taxonomy.md §5, verbatim as edges. */
export const PR_EDGES: readonly Edge<PrMeaning, PrCause>[] = [
    { from: null, to: "needsReview", causes: ["checksPassed"] },
    { from: null, to: "needsRevision", causes: ["checksFailed"] },
    /**
     * Three corrections found by reading these tables against `design/audit/` rather than
     * against the prose: the missing `readyToMerge → needsRevision` edge, the added
     * `reviewRequestedChanges` cause, and `approvalInvalidated` replacing a name
     * that bundled a trigger with its consequence (D48).
     */
    {
        from: "needsReview",
        to: "needsRevision",
        causes: ["checksFailed", "reviewRequestedChanges"],
    },
    { from: "needsRevision", to: "needsReview", causes: ["revisionResolved"] },
    { from: "needsReview", to: "readyToMerge", causes: ["reviewPolicySatisfied"] },
    /**
     * `approvalInvalidated`, not the first implementation's
     * `newCommitsInvalidatedApproval` — FINDING(taxonomy-approval-cause),
     * D48. That name bundled a trigger (new commits) with the
     * consequence (the approval stopped counting) and so could not
     * express a dismissed review or a changed base. The consequence is
     * the transition; the trigger varies.
     */
    { from: "readyToMerge", to: "needsReview", causes: ["approvalInvalidated"] },
    /**
     * FINDING(taxonomy-approved-checks-broke), D48: MISSING from §5 and
     * from the first implementation — an approved pull request whose
     * checks break had no path to `needsRevision` at all
     * (`canTransitionPr` answered `noSuchEdge`), so the only exit
     * asserted commits had landed. Checks break without any push: the
     * audited Sibling Conflict Re-check re-reads every open PR's
     * `mergeable` state when a DIFFERENT pull request merges and swaps
     * `needs review` ↔ `needs revision` (`design/audit/services-cpp.md`).
     */
    { from: "readyToMerge", to: "needsRevision", causes: ["checksFailed"] },
    { from: "needsReview", to: null, causes: ["humanClosed", "merged"] },
    { from: "needsRevision", to: null, causes: ["humanClosed", "merged"] },
    { from: "readyToMerge", to: null, causes: ["humanClosed", "merged"] },
];

export const PROFILE_EDGES: {
    readonly [K in EntityKind]: readonly {
        readonly from: string | null;
        readonly to: string | null;
    }[];
} = {
    issue: ISSUE_EDGES.map((e) => ({ from: e.from, to: e.to })),
    pullRequest: PR_EDGES.map((e) => ({ from: e.from, to: e.to })),
};

/**
 * Apply a transition to an item's state, enforcing the two platform
 * invariants the test architecture names:
 *  - an item is never in two positions (structural: `meaning` is scalar);
 *  - a blocked item accepts no capability-requested transitions
 *    (safety.md §5 — pause stops writes).
 */
