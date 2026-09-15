/** The comment operation's transport: the two comment verbs. */

import { repoPath } from "../../client/contract.js";
import {
    issuePath,
    type OperationTransport,
    type VerbContext,
    type WriteVerbs,
} from "./transport.js";

export const POST_MANAGED_COMMENT = {
    verbs: (context: VerbContext): Pick<WriteVerbs, "createComment" | "updateComment"> => ({
        createComment: (item, body, allowance) =>
            context.apply(
                {
                    url: `${issuePath(context.repository, item)}/comments`,
                    method: "POST",
                    body: JSON.stringify({ body }),
                    idempotency: "nonIdempotent",
                },
                "invisible",
                allowance,
            ),
        updateComment: (commentId, body, allowance) =>
            context.apply(
                {
                    url: `${repoPath(context.repository)}/issues/comments/${String(commentId)}`,
                    method: "PATCH",
                    body: JSON.stringify({ body }),
                    idempotency: "idempotent",
                },
                "invisible",
                allowance,
            ),
    }),
} satisfies OperationTransport;
