/** The unlock-issue operation's transport: the issue lock endpoint and its one verb. */

import type { WriteVerbs } from "@hiero-hackers/automation-core";
import { issuePath, type OperationTransport, type VerbContext } from "./transport.js";

export const UNLOCK_ISSUE = {
    verbs: (context: VerbContext): Pick<WriteVerbs, "unlockIssue"> => ({
        unlockIssue: (item, allowance) =>
            context.apply(
                {
                    url: `${issuePath(context.repository, item)}/lock`,
                    method: "DELETE",
                    idempotency: "idempotent",
                },
                "invisible",
                allowance,
            ),
    }),
} satisfies OperationTransport;
