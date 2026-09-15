/** The mapped-label operation's transport: the two label verbs. */

import {
    issuePath,
    type OperationTransport,
    type VerbContext,
    type WriteVerbs,
} from "./transport.js";

export const APPLY_MAPPED_LABEL = {
    verbs: (context: VerbContext): Pick<WriteVerbs, "addLabel" | "removeLabel"> => ({
        addLabel: (item, label, allowance) =>
            context.apply(
                {
                    url: `${issuePath(context.repository, item)}/labels`,
                    method: "POST",
                    body: JSON.stringify({ labels: [label] }),
                    idempotency: "idempotent",
                },
                "invisible",
                allowance,
            ),
        removeLabel: (item, label, allowance) =>
            context.apply(
                {
                    url: `${issuePath(context.repository, item)}/labels/${encodeURIComponent(label)}`,
                    method: "DELETE",
                    idempotency: "idempotent",
                },
                "labelMayBeAbsent",
                allowance,
            ),
    }),
} satisfies OperationTransport;
