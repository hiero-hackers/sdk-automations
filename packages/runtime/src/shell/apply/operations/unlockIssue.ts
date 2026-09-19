/** Unlocking an issue's conversation: the plan, its row, and the state read that proves it. */

import type { OperationHandler } from "./handler.js";
import { text } from "./row.js";

export const unlockIssue: OperationHandler<"unlockIssue"> = {
    verbs: ["unlockIssue"],

    plan: (effect) => ({
        ok: true,
        calls: [{ verb: "unlockIssue", reason: effect.intent.desired.reason }],
    }),

    serialize: (call) => ({ verb: call.verb, reason: call.reason }),

    parse(row) {
        const reason = text(row, "reason");
        return reason === null ? null : { verb: "unlockIssue", reason };
    },

    send: async (_call, pass) => await pass.writer.unlockIssue(pass.item, pass.allowance),

    async confirm(_call, pass) {
        const seen = await pass.reader.item(pass.item);
        if (!seen.ok) return "unknown";
        return seen.value.locked ? "notHeld" : "held";
    },
};
