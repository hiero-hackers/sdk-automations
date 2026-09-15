/** The release-assignment operation's transport: the assignees endpoint and its one verb. */

import {
    issuePath,
    type OperationTransport,
    type VerbContext,
    type WriteVerbs,
} from "./transport.js";

export const RELEASE_ASSIGNMENT = {
    verbs: (context: VerbContext): Pick<WriteVerbs, "releaseAssignment"> => ({
        releaseAssignment: (item, login, allowance) =>
            context.apply(
                {
                    url: `${issuePath(context.repository, item)}/assignees`,
                    method: "DELETE",
                    body: JSON.stringify({ assignees: [login] }),
                    idempotency: "idempotent",
                },
                "invisible",
                allowance,
            ),
    }),
} satisfies OperationTransport;
