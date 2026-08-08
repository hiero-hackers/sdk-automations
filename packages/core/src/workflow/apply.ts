/**
 * The rules that walk the edge tables: may this transition happen, and what
 * does the item look like afterwards.
 */

import {
    closureReasonFor,
    type IssueCause,
    type IssueMeaning,
    type PrCause,
    type PrMeaning,
    type TransitionCause,
    type WorkItemState,
} from "./meanings.js";
import { ISSUE_EDGES, PR_EDGES, type Edge } from "./transitions.js";

export interface TransitionRequest<M, C extends TransitionCause = TransitionCause> {
    readonly from: M | null;
    readonly to: M | null;
    readonly cause: C;
}

/**
 * Machine-readable refusal cause — the executor, telemetry, and managed
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

/** The edge tables, exposed read-only for the doc-drift check. */
export function applyTransition<M, C extends TransitionCause>(
    state: WorkItemState<M>,
    request: TransitionRequest<M, C>,
    verdictFor: (r: TransitionRequest<M, C>) => TransitionVerdict,
): { readonly state: WorkItemState<M>; readonly verdict: TransitionVerdict } {
    if (state.closedBy !== null) {
        return {
            state,
            verdict: {
                allowed: false,
                code: "itemClosed",
                reason: `item is closed (${state.closedBy})`,
            },
        };
    }
    if (state.blocked) {
        return {
            state,
            verdict: {
                allowed: false,
                code: "itemBlocked",
                reason: "item is blocked — capability writes are paused (safety.md §5)",
            },
        };
    }
    if (state.meaning !== request.from) {
        return {
            state,
            verdict: {
                allowed: false,
                code: "stalePrecondition",
                reason: `stale precondition: item is at ${String(state.meaning)}, request assumed ${String(request.from)}`,
            },
        };
    }
    const verdict = verdictFor(request);
    if (!verdict.allowed) return { state, verdict };
    return {
        state: {
            // Closure is orthogonal to position: closing records why the
            // item closed but preserves the mapped position for reopen.
            meaning: request.to === null ? state.meaning : request.to,
            blocked: state.blocked,
            // Only a closure cause can reach `to: null` — pinned by the
            // edge-table invariant test, so this is never null here.
            closedBy: request.to === null ? closureReasonFor(request.cause) : null,
        },
        verdict,
    };
}

/**
 * Reopening is a closure CLEAR, not a transition: closing never removes the
 * position labels (D35), so a reopened item returns exactly where it was. A
 * merged pull request can never reopen, which GitHub enforces and this refuses
 * explicitly rather than omitting (`FINDING(taxonomy-reopen)`, D49, D28).
 */
export function applyReopen<M>(state: WorkItemState<M>): {
    readonly state: WorkItemState<M>;
    readonly verdict: TransitionVerdict;
} {
    if (state.closedBy === null) {
        return {
            state,
            verdict: {
                allowed: false,
                code: "notClosed",
                reason: "item is already open — reopening is not a no-op to absorb silently",
            },
        };
    }
    if (state.closedBy === "merged") {
        return {
            state,
            verdict: {
                allowed: false,
                code: "mergedNotReopenable",
                reason: "a merged pull request cannot reopen",
            },
        };
    }
    return {
        state: { meaning: state.meaning, blocked: state.blocked, closedBy: null },
        verdict: { allowed: true },
    };
}
