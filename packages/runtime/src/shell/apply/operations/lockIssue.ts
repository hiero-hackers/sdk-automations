/** Locking an issue's conversation: the plan, its row, and the state read that proves it. */

import type { OperationHandler } from "./handler.js";
import { text } from "./row.js";

export const lockIssue: OperationHandler<"lockIssue"> = {
    verbs: ["lockIssue"],

    /** The reason travels on the call, because the row is what a resend reads. */
    plan: (effect) => ({
        ok: true,
        calls: [{ verb: "lockIssue", reason: effect.intent.desired.reason }],
    }),

    serialize: (call) => ({ verb: call.verb, reason: call.reason }),

    parse(row) {
        const reason = text(row, "reason");
        return reason === null ? null : { verb: "lockIssue", reason };
    },

    send: async (_call, pass) => await pass.writer.lockIssue(pass.item, pass.allowance),

    async confirm(_call, pass) {
        const seen = await pass.reader.item(pass.item);
        if (!seen.ok) return "unknown";
        return seen.value.locked ? "held" : "notHeld";
    },
};
