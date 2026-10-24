/**
 * Posting one managed comment, whole: what it plans, how its row is spelled and read,
 * and D12's create-or-update at the send. The only operation that reads before it writes.
 */

import {
    MANAGED_COMMENT_KINDS,
    parseManagedMarker,
    type CommentFact,
    type ManagedCommentKind,
    type ReadBackOutcome,
} from "@hiero-hackers/automation-core";
import { renderManagedBody } from "../../effects.js";
import { type OperationHandler, type SendContext } from "./handler.js";
import { text } from "./row.js";

const isManagedCommentKind = (value: string): value is ManagedCommentKind =>
    (MANAGED_COMMENT_KINDS as readonly string[]).includes(value);

/** Comments the App may CREATE on one item in one day; a rewrite in place never counts (D232). */
export const ITEM_COMMENT_BUDGET = 3;
const BUDGET_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * The comments created inside the window that are the App's own or carry its marker under any
 * name: a run whose identity is misconfigured must still meet the budget. An undated one is outside it.
 */
function createdRecently(comments: readonly CommentFact[], now: Date): number {
    const since = now.getTime() - BUDGET_WINDOW_MS;
    return comments.filter(
        (comment) =>
            (comment.authoredByApp || "recognized" in parseManagedMarker(comment.body)) &&
            comment.createdAt !== undefined &&
            Date.parse(comment.createdAt) >= since,
    ).length;
}

/**
 * The comment standing under this call's identity, `null` when there provably is none,
 * or the reason neither could be established. The `null` costs D46's gap: a stale "absent" is what makes a create run twice (protocol 6.5).
 */
const matchedComment = async (
    pass: SendContext,
    body: string,
): Promise<ReadBackOutcome<CommentFact | null>> => {
    const mine = pass.isMine(body);
    const listed = await pass.reader.comments(pass.item);
    if (!listed.ok) return { ok: false, detail: `the comment read-back failed: ${listed.detail}` };
    const found = listed.value.find(mine);
    if (found !== undefined) return { ok: true, value: found };
    const confirmed = await pass.reader.commentPresence(pass.item, mine);
    if (confirmed === "absent") return { ok: true, value: null };
    return {
        ok: false,
        detail:
            confirmed === "present"
                ? "this comment's managed identity appeared between two reads"
                : "the read-back could not establish whether a comment under this identity exists",
    };
};

export const postManagedComment: OperationHandler<"postManagedComment"> = {
    verbs: ["postComment"],
    traits: { recordsWarning: true, activityRead: false },

    plan(effect) {
        if (effect.managedComment === null) {
            return {
                ok: false,
                code: "identityMissing",
                detail: "the approved effect carries no managed-comment identity to post under",
            };
        }
        return {
            ok: true,
            calls: [
                {
                    verb: "postComment",
                    kind: effect.intent.desired.kind,
                    body: renderManagedBody(
                        effect.managedComment.marker,
                        effect.intent.desired.body,
                    ),
                },
            ],
        };
    },

    serialize: (call) => ({ verb: call.verb, kind: call.kind, body: call.body }),

    parse(row) {
        const kind = text(row, "kind");
        const body = text(row, "body");
        if (kind === null || !isManagedCommentKind(kind) || body === null) return null;
        return { verb: "postComment", kind, body };
    },

    /** The day's creations, counted only when this call would create rather than rewrite (D232). */
    async hold(call, pass) {
        const listed = await pass.reader.comments(pass.item);
        if (!listed.ok || listed.value.some(pass.isMine(call.body))) return null;
        const created = createdRecently(listed.value, pass.clock());
        if (created < ITEM_COMMENT_BUDGET) return null;
        return {
            code: "commentBudget",
            detail: `${String(created)} managed comments were created on this item in the last day; the budget is ${String(ITEM_COMMENT_BUDGET)}`,
        };
    },

    /**
     * D12, in full: no match creates, a match with the same body is `already`, and a match
     * with a different body is updated in place (D145). Nothing repairs a comment in the background — recovery's read-back matches on IDENTITY alone.
     */
    async send(call, pass) {
        const found = await matchedComment(pass, call.body);
        if (!found.ok) return { outcome: "retryLater", detail: found.detail };
        if (found.value === null)
            return await pass.writer.createComment(pass.item, call.body, pass.allowance);
        if (found.value.body === call.body) return { outcome: "already" };
        return await pass.writer.updateComment(found.value.id, call.body, pass.allowance);
    },

    /** Confirms the exact body, so a lost update response cannot accept the old comment. */
    async confirm(call, pass) {
        const found = await matchedComment(pass, call.body);
        if (!found.ok) return "unknown";
        return found.value?.body === call.body ? "held" : "notHeld";
    },
};
