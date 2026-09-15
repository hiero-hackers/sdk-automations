/**
 * Moving one item's position label, whole: the plan, its two rows, and the presence read that proves each.
 * The only operation whose plan is more than one call, and the order of the two is the decision.
 */

import {
    ISSUE_MEANINGS,
    PR_MEANINGS,
    type Intent,
    type ItemRef,
    type MappableMeaning,
} from "@hiero-hackers/automation-core";
import { held, type OperationHandler } from "./handler.js";
import { at, text } from "./row.js";

/** The own-flow positions of one entity kind, in `MAPPABLE_MEANINGS` order. */
function positionsOf(kind: ItemRef["kind"]): readonly MappableMeaning[] {
    return kind === "issue" ? ISSUE_MEANINGS : PR_MEANINGS;
}

/**
 * The position this move displaces, or `undefined` when the item held none.
 * Read from the capability's claim: `deriveWorld` refuses the write unless the authoritative projection observed it, and at most one own-flow position survives.
 */
function displacedBy(intent: Intent<"applyMappedLabel">): MappableMeaning | undefined {
    return positionsOf(intent.item.kind).find(
        (meaning) =>
            meaning !== intent.desired.meaning && intent.claims.meaningsPresent.includes(meaning),
    );
}

export const applyMappedLabel: OperationHandler<"applyMappedLabel"> = {
    verbs: ["addLabel", "removeLabel"],

    /**
     * Add, then remove. The intermediate state carries two position labels, which projects
     * as a conflict, so every other decision safe-holds; removing first would leave a window with NO position, which reads as untriaged.
     */
    plan(effect, config) {
        const { intent } = effect;
        const target = config.mappings.labels[intent.desired.meaning];
        if (target === undefined) {
            return {
                ok: false,
                code: "labelUnmapped",
                detail: `the repository maps no label to ${intent.desired.meaning}`,
            };
        }
        const displaced = displacedBy(intent);
        if (displaced === undefined) {
            return { ok: true, calls: [{ verb: "addLabel", label: target }] };
        }
        const previous = config.mappings.labels[displaced];
        if (previous === undefined) {
            return {
                ok: false,
                code: "labelUnmapped",
                detail: `the repository maps no label to the displaced position ${displaced}`,
            };
        }
        return {
            ok: true,
            calls: [
                { verb: "addLabel", label: target },
                { verb: "removeLabel", label: previous },
            ],
        };
    },

    serialize: (call) => ({ verb: call.verb, label: call.label }),

    parse(row) {
        const verb = at(row, "verb");
        if (verb !== "addLabel" && verb !== "removeLabel") return null;
        const label = text(row, "label");
        return label === null ? null : { verb, label };
    },

    async send(call, pass) {
        switch (call.verb) {
            case "addLabel":
                return await pass.writer.addLabel(pass.item, call.label, pass.allowance);
            case "removeLabel":
                return await pass.writer.removeLabel(pass.item, call.label, pass.allowance);
        }
    },

    async confirm(call, pass) {
        switch (call.verb) {
            case "addLabel":
                return held(await pass.reader.labelPresence(pass.item, call.label), "present");
            case "removeLabel":
                return held(await pass.reader.labelPresence(pass.item, call.label), "absent");
        }
    },
};
