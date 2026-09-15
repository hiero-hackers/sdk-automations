/** Closing a pull request unmerged: the plan, its row, and the state read that proves it. */

import { planWithNotice, type OperationHandler } from "./handler.js";
import { text } from "./row.js";

export const closePullRequest: OperationHandler<"closePullRequest"> = {
    verbs: ["closePullRequest"],

    /** The reason travels on the call, because the row is what a resend reads. */
    plan: (effect) =>
        planWithNotice(effect, {
            verb: "closePullRequest",
            reason: effect.intent.desired.reason,
        }),

    serialize: (call) => ({ verb: call.verb, reason: call.reason }),

    parse(row) {
        const reason = text(row, "reason");
        return reason === null ? null : { verb: "closePullRequest", reason };
    },

    /** The reason is not sent: GitHub is told the state, and the notice says why (6.10). */
    send: async (_call, pass) => await pass.writer.closePullRequest(pass.item, pass.allowance),

    /**
     * The state on the pull request, and only that.
     * `closed_by` is absent from the pull object — the actor of a close is on the timeline (6.10) — so a read-back that wanted it would never confirm.
     */
    async confirm(_call, pass) {
        const seen = await pass.reader.item(pass.item);
        if (!seen.ok) return "unknown";
        return seen.value.closed ? "held" : "notHeld";
    },
};
