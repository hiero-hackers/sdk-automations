/** A clock-triggered release: the plan, its row, and the assignee read that proves it. */

import { planWithNotice, type OperationHandler } from "./handler.js";
import { text } from "./row.js";

export const releaseAssignment: OperationHandler<"releaseAssignment"> = {
    verbs: ["releaseAssignment"],

    /** Two calls, because a release is graced: the release, then its notice (grace.md §3). */
    plan: (effect) =>
        planWithNotice(effect, {
            verb: "releaseAssignment",
            login: effect.intent.desired.login,
        }),

    serialize: (call) => ({ verb: call.verb, login: call.login }),

    parse(row) {
        const login = text(row, "login");
        return login === null ? null : { verb: "releaseAssignment", login };
    },

    /** One named login, so the other assignees are left where they are (D63). */
    send: async (call, pass) =>
        await pass.writer.releaseAssignment(pass.item, call.login, pass.allowance),

    /**
     * This login, gone from the list the item carries.
     * One read rather than D46's two: a stale list still naming the login answers `notHeld`, which asks again, so staleness cannot confirm a release that did not land.
     */
    async confirm(call, pass) {
        const seen = await pass.reader.assignees(pass.item);
        if (!seen.ok) return "unknown";
        return seen.value.includes(call.login) ? "notHeld" : "held";
    },
};
