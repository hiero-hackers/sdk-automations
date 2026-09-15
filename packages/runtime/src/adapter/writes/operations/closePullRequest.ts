/** The close-pull-request operation's transport: one endpoint on the pull surface, one verb. */

import {
    pullPath,
    type OperationTransport,
    type VerbContext,
    type WriteVerbs,
} from "./transport.js";

export const CLOSE_PULL_REQUEST = {
    verbs: (context: VerbContext): Pick<WriteVerbs, "closePullRequest"> => ({
        closePullRequest: (item, allowance) =>
            context.apply(
                {
                    url: pullPath(context.repository, item),
                    method: "PATCH",
                    body: JSON.stringify({ state: "closed" }),
                    idempotency: "idempotent",
                },
                "invisible",
                allowance,
            ),
    }),
} satisfies OperationTransport;
