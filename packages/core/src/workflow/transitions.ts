/**
 * Which moves are legal: the two workflow diagrams from
 * `design/core/taxonomy.md` §4–§5 as edge tables, and the question asked of
 * them. The table is the answer; `canTransition*` is how you ask.
 *
 * `packages/checks/test/doc-drift.test.ts` parses the diagrams out of that document and
 * asserts these tables match them edge for edge, in both directions — the
 * tables ARE the design, transcribed, and a transcription with nothing
 * checking it is how D48's missing edge survived in both artifacts at once.
 */

import type { EntityKind, IssueMeaning, PrMeaning } from "./positions.js";
import type { IssueCause, PrCause, TransitionCause } from "./causes.js";

export interface Edge<M, C extends TransitionCause> {
    readonly from: M | null;
    readonly to: M | null;
    readonly causes: readonly C[];
}

/**
 * taxonomy.md §4, verbatim as edges.
 *
 * No manual-entry edges, deliberately. Applying a label by hand is observed
 * reality to reconcile (manual-edits.md), not a transition anyone requests
 * (D29).
 */
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
];

/**
 * taxonomy.md §5, verbatim as edges.
 *
 * Three of these came from reading the audit rather than the prose, and §5
 * has been corrected to match (D48). The one naming rule worth carrying:
 * a cause names the CONSEQUENCE, not the trigger — `approvalInvalidated`
 * covers new commits, a dismissed review and a changed base alike.
 */
export const PR_EDGES: readonly Edge<PrMeaning, PrCause>[] = [
    { from: null, to: "needsReview", causes: ["checksPassed"] },
    { from: null, to: "needsRevision", causes: ["checksFailed"] },
    {
        from: "needsReview",
        to: "needsRevision",
        causes: ["checksFailed", "reviewRequestedChanges"],
    },
    { from: "needsRevision", to: "needsReview", causes: ["revisionResolved"] },
    { from: "needsReview", to: "readyToMerge", causes: ["reviewPolicySatisfied"] },
    { from: "readyToMerge", to: "needsReview", causes: ["approvalInvalidated"] },
    { from: "readyToMerge", to: "needsRevision", causes: ["checksFailed"] },
    { from: "needsReview", to: null, causes: ["humanClosed", "merged"] },
    { from: "needsRevision", to: null, causes: ["humanClosed", "merged"] },
    { from: "readyToMerge", to: null, causes: ["humanClosed", "merged"] },
];

/** Both tables as bare from/to pairs — what the doc-drift check compares. */
export const PROFILE_EDGES: {
    readonly [K in EntityKind]: readonly {
        readonly from: string | null;
        readonly to: string | null;
    }[];
} = {
    issue: ISSUE_EDGES.map((e) => ({ from: e.from, to: e.to })),
    pullRequest: PR_EDGES.map((e) => ({ from: e.from, to: e.to })),
};

// ─── Asking the tables ───────────────────────────────────────────────

/** A move somebody wants: from where, to where, and why. */
export interface TransitionRequest<M, C extends TransitionCause = TransitionCause> {
    readonly from: M | null;
    readonly to: M | null;
    readonly cause: C;
}

/**
 * Machine-readable refusal cause — telemetry and managed
 * explanations branch on `code`; `reason` is prose for humans only.
 * Same convention as `FailureClass` in failures.ts.
 */
export type TransitionRefusalCode =
    | "noSuchEdge"
    | "causeNotAccepted"
    | "itemClosed"
    | "itemBlocked"
    | "stalePrecondition"
    | "notClosed"
    | "mergedNotReopenable";

/** Allowed, or refused with a machine-readable cause. */
export type TransitionVerdict =
    | { readonly allowed: true }
    | {
          readonly allowed: false;
          readonly code: TransitionRefusalCode;
          readonly reason: string;
      };

function evaluate<M, C extends TransitionCause>(
    edges: readonly Edge<M, C>[],
    request: TransitionRequest<M, C>,
): TransitionVerdict {
    const edge = edges.find((e) => e.from === request.from && e.to === request.to);
    if (!edge) {
        return {
            allowed: false,
            code: "noSuchEdge",
            reason: `no edge ${String(request.from)} -> ${String(request.to)} in the profile`,
        };
    }
    if (!edge.causes.includes(request.cause)) {
        return {
            allowed: false,
            code: "causeNotAccepted",
            reason: `edge ${String(request.from)} -> ${String(request.to)} does not accept cause ${request.cause}`,
        };
    }
    return { allowed: true };
}

/** Can an issue move `from` → `to` for `cause`, per the profile? Pure. */
export function canTransitionIssue(
    request: TransitionRequest<IssueMeaning, IssueCause>,
): TransitionVerdict {
    return evaluate(ISSUE_EDGES, request);
}

/** Can a pull request move `from` → `to` for `cause`, per the profile? Pure. */
export function canTransitionPr(request: TransitionRequest<PrMeaning, PrCause>): TransitionVerdict {
    return evaluate(PR_EDGES, request);
}
