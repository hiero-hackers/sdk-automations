/** One write operation's handler, in TypeScript: write-operations.md §3 is the contract. */

import type {
    Effect,
    Intent,
    IntentOperation,
    ItemRef,
    RepositoryConfig,
} from "@hiero-hackers/automation-core";
import type { Allowance } from "../../allowance.js";
import { renderManagedBody, type Call, type Plan } from "../../effects.js";

/** What one write turned out to be, in the endpoint matrix's words. */
export type WriteResult =
    | { readonly outcome: "applied" }
    | { readonly outcome: "already" }
    | { readonly outcome: "conflict"; readonly detail: string }
    | { readonly outcome: "forbidden"; readonly detail: string }
    | { readonly outcome: "retryLater"; readonly detail: string }
    | { readonly outcome: "unknown"; readonly detail: string }
    | { readonly outcome: "unsupported"; readonly detail: string };

/** The six confirmed write endpoints, and nothing else (D4). */
export interface EffectWriter {
    addLabel(item: ItemRef, label: string, allowance?: Allowance): Promise<WriteResult>;
    removeLabel(item: ItemRef, label: string, allowance?: Allowance): Promise<WriteResult>;
    createComment(item: ItemRef, body: string, allowance?: Allowance): Promise<WriteResult>;
    updateComment(commentId: number, body: string, allowance?: Allowance): Promise<WriteResult>;
    closePullRequest(item: ItemRef, allowance?: Allowance): Promise<WriteResult>;
    releaseAssignment(item: ItemRef, login: string, allowance?: Allowance): Promise<WriteResult>;
}

/** A read that answered, or the reason it established nothing. */
export type ReadAnswer<T> =
    { readonly ok: true; readonly value: T } | { readonly ok: false; readonly detail: string };

/** D46's three answers; `unknown` is not a soft "absent". */
export type SeenState = "present" | "absent" | "unknown";

/** One comment, as the marker matcher needs it. */
export interface CommentSeen {
    readonly id: number;
    readonly body: string;
    readonly authoredByApp: boolean;
}

/** The facts the apply-time re-gate rebuilds a projection from, `draft` included. */
export interface ItemSeen {
    readonly labels: readonly string[];
    readonly closed: boolean;
    readonly merged: boolean;
    readonly draft: boolean;
}

/** What GitHub says is there now. Presence answers on sight; absence obeys D46. */
export interface EffectReader {
    comments(item: ItemRef): Promise<ReadAnswer<readonly CommentSeen[]>>;
    labels(item: ItemRef): Promise<ReadAnswer<readonly string[]>>;
    item(item: ItemRef): Promise<ReadAnswer<ItemSeen>>;
    /** The other native mode, which is its own call: the reviews list, folded. */
    changesRequested(item: ItemRef): Promise<ReadAnswer<boolean>>;
    pullRequestActivity(
        item: ItemRef,
        working: string | undefined,
    ): Promise<ReadAnswer<Date | null>>;
    assignees(item: ItemRef): Promise<ReadAnswer<readonly string[]>>;
    commentPresence(item: ItemRef, matches: (comment: CommentSeen) => boolean): Promise<SeenState>;
    labelPresence(item: ItemRef, label: string): Promise<SeenState>;
}

/** Whether a read-back says a call's postcondition holds. */
export type Confirmation = "held" | "notHeld" | "unknown";

/** A presence read as a confirmation; an unknown read stays unknown. */
export const held = (seen: SeenState, holds: SeenState): Confirmation =>
    seen === "unknown" ? "unknown" : seen === holds ? "held" : "notHeld";

/**
 * Which call verbs each operation owns.
 * Checked, not trusted: `CallOf` indexes this by `IntentOperation`, so a missing line fails to compile there and a verb `Call` lacks extracts to `never`.
 */
interface OperationVerbs {
    readonly postManagedComment: "postComment";
    readonly applyMappedLabel: "addLabel" | "removeLabel";
    readonly assign: "assign";
    readonly unassign: "unassign";
    readonly releaseAssignment: "releaseAssignment";
    readonly closePullRequest: "closePullRequest";
    readonly lockIssue: "lockIssue";
    readonly unlockIssue: "unlockIssue";
}

/** The `Call` members one operation's handler owns. */
export type CallOf<K extends IntentOperation> = Extract<Call, { verb: OperationVerbs[K] }>;

/** What one send may know: the item, the two seams, and this effect's own identity. */
export interface SendContext {
    readonly item: ItemRef;
    readonly writer: EffectWriter;
    readonly reader: EffectReader;
    readonly allowance: Allowance | undefined;
    /** Is a comment the one THIS CALL would be? Authorship and marker, both required (D125). */
    isMine(body: string): (comment: CommentSeen) => boolean;
}

/**
 * One act's calls: the act, and where it carries grace the notice that says what the
 * App did (grace.md §3). Two calls in that order, because the plan stops at the first refusal — so a notice can never claim an act that did not land.
 */
export function planWithNotice(effect: Effect, act: Call): Plan {
    const grace = effect.intent.grace;
    if (grace === null) return { ok: true, calls: [act] };
    if (effect.managedComment === null) {
        return {
            ok: false,
            code: "identityMissing",
            detail: "the approved act carries no managed-comment identity to post its outcome notice under",
        };
    }
    return {
        ok: true,
        calls: [
            act,
            {
                verb: "postComment",
                kind: "notice",
                body: renderManagedBody(effect.managedComment.marker, grace.notice.body),
            },
        ],
    };
}

export interface OperationHandler<K extends IntentOperation> {
    /** The call verbs this operation's rows carry — `operationOf` is derived from these. */
    readonly verbs: readonly Call["verb"][];
    /** The calls one approved effect takes, in send order, or the reason it takes none. */
    plan(effect: Effect & { intent: Intent<K> }, config: RepositoryConfig): Plan;
    /** The row fields after the head — `verb` first, then the call's own, in row order. */
    serialize(call: CallOf<K>): Record<string, unknown>;
    /** The call a row's bytes hold, or `null`; total over `unknown`. */
    parse(row: unknown): CallOf<K> | null;
    /** One call, sent; the read-before-write for a comment lives here. */
    send(call: CallOf<K>, pass: SendContext): Promise<WriteResult>;
    /** Does GitHub say this call's postcondition holds? */
    confirm(call: CallOf<K>, pass: SendContext): Promise<Confirmation>;
}
