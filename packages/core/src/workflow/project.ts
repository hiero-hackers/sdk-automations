/**
 * Observed labels to workflow position — the projection step that
 * `design/core/manual-edits.md` §3 implies but no document owns.
 *
 * GitHub's reality is a SET of labels; the state machine's is a scalar
 * position. The shell maps label strings to meanings via validated
 * configuration (injective — config.ts) and passes the meanings here.
 * More than one own-flow position is a conflict, never a repair (§3,
 * §8 test 3); a conflicted item has no `WorkItemState`, so it can
 * never reach `applyTransition` — the no-write rule is structural.
 */

import {
    ISSUE_MEANINGS,
    isBlocked,
    PR_MEANINGS,
    type ClosureReason,
    type IssueMeaning,
    type PrMeaning,
    type WorkItemState,
} from "./meanings.js";
import type { MappableMeaning } from "../config/index.js";

/** What the shell observed on one issue or pull request. */
export interface LabelObservation {
    /**
     * Closure as GitHub reports it — `merged_at` for a pull request,
     * `state_reason` plus the closing reference for an issue — `null`
     * while open. A native fact the platform reads and never writes
     * (D47); the shell derives it, because the mapping from GitHub's
     * fields to a `ClosureReason` is transport detail.
     */
    readonly closedBy: ClosureReason | null;
    /**
     * The mapped meanings whose labels are present — a set. Unmapped
     * repository labels never appear here; the platform leaves them
     * alone entirely (§3 rule 1, §8 test 2).
     */
    readonly meanings: readonly MappableMeaning[];
}

export type ObservationProjection<M> =
    | {
          readonly kind: "position";
          /** Feed this to `applyTransition`; it is the only source of one. */
          readonly state: WorkItemState<M>;
          /**
           * FINDING(observe-cross-entity), D35: the other flow's
           * position meanings — left alone, reported for diagnostics,
           * never a conflict.
           */
          readonly ignored: readonly MappableMeaning[];
      }
    | {
          /**
           * More than one own-flow position: no repair, no guessing,
           * no writes (§3).
           */
          readonly kind: "conflict";
          readonly positions: readonly M[];
          /**
           * FINDING(observe-conflict-context), D59: the conflict verdict
           * used to carry positions ONLY, so a reporting surface could
           * say "this item is conflicted" but not "and it is also paused
           * / already closed" — which is what tells an operator whether
           * the conflict is worth their attention. Same facts as the
           * `position` branch, minus a position to put them on.
           */
          readonly blocked: boolean;
          readonly closedBy: ClosureReason | null;
          /** Other-flow meanings remain visible for diagnostics (D35). */
          readonly ignored: readonly MappableMeaning[];
      };

function projectWith<M extends IssueMeaning | PrMeaning>(
    own: readonly M[],
    observation: LabelObservation,
): ObservationProjection<M> {
    const distinct = [...new Set(observation.meanings)];
    const ownSet: ReadonlySet<MappableMeaning> = new Set(own);
    const positions = distinct.filter((m): m is M => ownSet.has(m));
    if (positions.length > 1) {
        return {
            kind: "conflict",
            positions,
            blocked: isBlocked(distinct),
            closedBy: observation.closedBy,
            ignored: distinct.filter((m) => !ownSet.has(m) && m !== "blocked"),
        };
    }
    /**
     * FINDING(observe-blocked-alone) and FINDING(observe-closed-position),
     * D35: `blocked` with no position is legal — "no position, paused"
     * (D28); a closed item keeps its position labels unrepaired
     * (manual-edits.md §6), and the closure reason rides alongside them
     * rather than erasing them (D47).
     */
    return {
        kind: "position",
        state: {
            meaning: positions[0] ?? null,
            blocked: isBlocked(distinct),
            closedBy: observation.closedBy,
        },
        ignored: distinct.filter((m) => !ownSet.has(m) && m !== "blocked"),
    };
}

/** Project an issue's observed mapped meanings. Pure. */
export function projectIssueObservation(
    observation: LabelObservation,
): ObservationProjection<IssueMeaning> {
    return projectWith(ISSUE_MEANINGS, observation);
}

/** Project a pull request's observed mapped meanings. Pure. */
export function projectPrObservation(
    observation: LabelObservation,
): ObservationProjection<PrMeaning> {
    return projectWith(PR_MEANINGS, observation);
}

/**
 * Is this item closed, whichever branch the projection took?
 *
 * Closure rides on BOTH — `state.closedBy` on a position, `closedBy` at the
 * top level on a conflict (D59) — and that asymmetry is a trap: reading it
 * from one branch only compiles fine and silently treats every conflicted,
 * closed item as open. This exists because that mistake was made the first
 * time a capability consumed the projection.
 */
export function closureOf<M>(projection: ObservationProjection<M>): ClosureReason | null {
    return projection.kind === "position" ? projection.state.closedBy : projection.closedBy;
}

/** Is this item paused, whichever branch the projection took? See `closureOf`. */
export function isPausedByProjection<M>(projection: ObservationProjection<M>): boolean {
    return projection.kind === "position" ? projection.state.blocked : projection.blocked;
}
