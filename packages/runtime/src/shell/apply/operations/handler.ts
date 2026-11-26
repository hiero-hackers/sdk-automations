/** One write operation's handler, in TypeScript: write-operations.md §3 is the contract. */

import type {
    Allowance,
    CommentFact,
    Effect,
    Intent,
    IntentOperation,
    ItemRef,
    Presence,
    ReadBack,
    RepositoryConfig,
    WriteResult,
    WriteVerbs,
} from "@hiero-hackers/automation-core";
import { renderManagedBody, type Call, type EffectCode, type Plan } from "../../effects.js";

/** Whether a read-back says a call's postcondition holds. */
export type Confirmation = "held" | "notHeld" | "unknown";

/** A presence read as a confirmation; an unknown read stays unknown. */
export const held = (seen: Presence, holds: Presence): Confirmation =>
    seen === "unknown" ? "unknown" : seen === holds ? "held" : "notHeld";

/**
 * Which call verbs each operation owns.
 * Checked, not trusted: `CallOf` indexes this by `IntentOperation`, so a missing line fails to compile there and a verb `Call` lacks extracts to `never`.
 */
interface OperationVerbs {
    readonly postManagedComment: "postComment";
    readonly applyMappedLabel: "defineLabel" | "addLabel" | "removeLabel";
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
/** A call held back by its own operation: the code the row carries, and the sentence beside it. */
export interface Hold {
    readonly code: EffectCode;
    readonly detail: string;
}

export interface SendContext {
    readonly item: ItemRef;
    readonly writer: WriteVerbs;
    readonly reader: ReadBack;
    readonly allowance: Allowance | undefined;
    /** Is a comment the one THIS CALL would be? Authorship and marker, both required (D125). */
    isMine(body: string): (comment: CommentFact) => boolean;
    readonly clock: () => Date;
}

/**
 * One act's calls: the act, and where it carries one the notice that says what the App did —
 * a graced act's (grace.md §3) or an act's own. Two calls in that order, because the plan stops at the first refusal — so a notice can never claim an act that did not land.
 */
export function planWithNotice(effect: Effect, act: Call, notice: string | null): Plan {
    if (notice === null) return { ok: true, calls: [act] };
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
                body: renderManagedBody(effect.managedComment.marker, notice),
            },
        ],
    };
}

/** What the choreography around a handler must know about its operation, declared rather than hard-coded (D210). */
export interface OperationTraits {
    /** A landed call of this operation is the warning a graced act promised (grace.md §3). */
    readonly recordsWarning: boolean;
    /** The fresh gate reads the affected person's activity before a graced act of this operation. */
    readonly activityRead: boolean;
}

export interface OperationHandler<K extends IntentOperation> {
    /** The call verbs this operation's rows carry — `operationOf` is derived from these. */
    readonly verbs: readonly Call["verb"][];
    readonly traits: OperationTraits;
    /** The calls one approved effect takes, in send order, or the reason it takes none. */
    plan(effect: Effect & { intent: Intent<K> }, config: RepositoryConfig): Plan;
    /** The row fields after the head — `verb` first, then the call's own, in row order. */
    serialize(call: CallOf<K>): Record<string, unknown>;
    /** The call a row's bytes hold, or `null`; total over `unknown`. */
    parse(row: unknown): CallOf<K> | null;
    /** Why this call must not be sent now, or `null`; an operation's own ceiling, judged before the send. */
    hold?(call: CallOf<K>, pass: SendContext): Promise<Hold | null>;
    /** One call, sent; the read-before-write for a comment lives here. */
    send(call: CallOf<K>, pass: SendContext): Promise<WriteResult>;
    /** Does GitHub say this call's postcondition holds? */
    confirm(call: CallOf<K>, pass: SendContext): Promise<Confirmation>;
}
