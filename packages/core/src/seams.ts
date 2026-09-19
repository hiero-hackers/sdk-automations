/** What may be asked of GitHub about one item, and what GitHub answers (write-operations.md). */

import type { ItemRef } from "./catalogue.js";
import type { Allowance } from "./github/index.js";

/** `applied` is the postcondition holding because we made it hold; `already` is it holding without us. */
export type WriteResult =
    | { readonly outcome: "applied" }
    | { readonly outcome: "already" }
    | { readonly outcome: "conflict"; readonly detail: string }
    | { readonly outcome: "forbidden"; readonly detail: string }
    | { readonly outcome: "retryLater"; readonly detail: string }
    | { readonly outcome: "unknown"; readonly detail: string }
    | { readonly outcome: "unsupported"; readonly detail: string };

export interface WriteVerbs {
    /** Define a label the repository lacks; a name it has already is a `conflict`, never recoloured. */
    createLabel(
        label: string,
        color: string,
        description: string,
        allowance?: Allowance,
    ): Promise<WriteResult>;
    addLabel(item: ItemRef, label: string, allowance?: Allowance): Promise<WriteResult>;
    /** ONE named label. There is no remove-by-prefix here or below (D4). */
    removeLabel(item: ItemRef, label: string, allowance?: Allowance): Promise<WriteResult>;
    /** The one non-idempotent verb. */
    createComment(item: ItemRef, body: string, allowance?: Allowance): Promise<WriteResult>;
    updateComment(commentId: number, body: string, allowance?: Allowance): Promise<WriteResult>;
    /** Closed unmerged; the reason is the notice's, never GitHub's. */
    closePullRequest(item: ItemRef, allowance?: Allowance): Promise<WriteResult>;
    /** ONE named login off the item's assignees, never the list whole (D63). */
    releaseAssignment(item: ItemRef, login: string, allowance?: Allowance): Promise<WriteResult>;
    lockIssue(item: ItemRef, allowance?: Allowance): Promise<WriteResult>;
    unlockIssue(item: ItemRef, allowance?: Allowance): Promise<WriteResult>;
}

/** A read that answered, or the reason it established nothing. */
export type ReadBackOutcome<T> =
    { readonly ok: true; readonly value: T } | { readonly ok: false; readonly detail: string };

/** D46's three answers; `unknown` is not a soft "absent". */
export type Presence = "present" | "absent" | "unknown";

/** One comment, as the marker matcher needs it. */
export interface CommentFact {
    readonly id: number;
    readonly body: string;
    readonly authoredByApp: boolean;
}

/** The item as an apply-time re-gate reads it; `merged` is not inferred from `closed` (D47). */
export interface ItemFacts {
    readonly labels: readonly string[];
    readonly closed: boolean;
    readonly merged: boolean;
    readonly draft: boolean;
    readonly locked: boolean;
}

/** The four resources stage C reads, raw or as a presence. */
export interface ReadBack {
    comments(item: ItemRef): Promise<ReadBackOutcome<readonly CommentFact[]>>;
    labels(item: ItemRef): Promise<ReadBackOutcome<readonly string[]>>;
    item(item: ItemRef): Promise<ReadBackOutcome<ItemFacts>>;
    /** Its own read because it is its own call: the reviews list, not the item's body. */
    changesRequested(item: ItemRef): Promise<ReadBackOutcome<boolean>>;
    pullRequestActivity(
        item: ItemRef,
        working: string | undefined,
    ): Promise<ReadBackOutcome<Date | null>>;
    /** The logins on the item now; one read, because a released login cannot come back stale. */
    assignees(item: ItemRef): Promise<ReadBackOutcome<readonly string[]>>;
    /** Is a comment matching `matches` there? Absence obeys D46's gap. */
    commentPresence(item: ItemRef, matches: (comment: CommentFact) => boolean): Promise<Presence>;
    /** Is this exact label name there? Absence obeys D46's gap. */
    labelPresence(item: ItemRef, label: string): Promise<Presence>;
    /** Does the REPOSITORY define this label? One read; GitHub's 404 is the absence. */
    labelDefined(label: string): Promise<Presence>;
}
