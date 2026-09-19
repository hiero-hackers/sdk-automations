/** The lock-issue operation's transport: the issue lock endpoint and its one verb. */

import type { WriteVerbs } from "@hiero-hackers/automation-core";
import { issuePath, type OperationTransport, type VerbContext } from "./transport.js";

export const LOCK_ISSUE = {
    verbs: (context: VerbContext): Pick<WriteVerbs, "lockIssue"> => ({
        lockIssue: (item, allowance) =>
            context.apply(
                {
                    url: `${issuePath(context.repository, item)}/lock`,
                    method: "PUT",
                    headers: { "content-length": "0" },
                    idempotency: "idempotent",
                },
                "invisible",
                allowance,
            ),
    }),
} satisfies OperationTransport;
