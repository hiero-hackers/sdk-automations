/**
 * What GitHub's answer to a write MEANS, and the seam every verb sends through.
 * `unknown` means sent and unknowable, and may not be retried; `retryLater` means
 * re-sending is provably harmless; `unsupported` means nothing was sent at all,
 * because the admission gate has no confirmed endpoint for it.
 */

import type { RepositoryRef } from "@hiero-hackers/automation-core";
import type { Allowance } from "../client/allowance.js";
import {
    describeFailure,
    type GitHubHttpClient,
    type GitHubHttpFailureClass,
    type GitHubWriteRequest,
    type WriteIdempotency,
} from "../client/contract.js";
import { writeVerbsOf } from "./operations/index.js";
import type { NotFoundMeaning, WriteResult, WriteVerbs } from "./operations/transport.js";

/** GitHub's prose, documented rather than probed: a reword falls back to `forbidden`. */
export const LABEL_ABSENT = {
    pattern: /label does not exist/i,
    documented: "Label does not exist",
} as const;

const conflict = (detail: string): WriteResult => ({ outcome: "conflict", detail });
const forbidden = (detail: string): WriteResult => ({ outcome: "forbidden", detail });
const retryLater = (detail: string): WriteResult => ({ outcome: "retryLater", detail });
const unsupported = (detail: string): WriteResult => ({ outcome: "unsupported", detail });

/** A failure that may or may not have landed, answered by idempotency. */
function ambiguous(idempotency: WriteIdempotency, detail: string): WriteResult {
    return idempotency === "idempotent"
        ? retryLater(`${detail}; re-sending this write cannot apply it twice`)
        : { outcome: "unknown", detail: `${detail}; the write may already have landed` };
}

/** One failed write as one word, per class and per endpoint. */
function resultOfFailure(
    request: GitHubWriteRequest,
    failure: GitHubHttpFailureClass,
    notFound: NotFoundMeaning,
    body: string,
): WriteResult {
    switch (failure.kind) {
        case "notSent":
            // The hourly ceiling refused this creation locally, so nothing was sent
            // and the comment is owed, not lost (D192).

            if (failure.reason === "contentCreationCeiling") {
                return retryLater("this hour's content-creation ceiling is reached");
            }
            return unsupported(
                failure.reason === "brokenSeam"
                    ? `nothing was sent: ${describeFailure(failure)}`
                    : `the endpoint matrix confirms no write at ${request.method} ${request.url}: ` +
                          describeFailure(failure),
            );
        case "responseTooLarge":
        case "transient":
            return ambiguous(
                request.idempotency,
                `GitHub call failed: ${describeFailure(failure)}`,
            );
        case "tokenExpired":
            return retryLater("the installation token had expired and has been dropped");
        case "primaryExhausted":
            return retryLater(
                "GitHub primary rate limit reached; the budget resets at " +
                    (failure.resetAt ?? "an instant GitHub did not report"),
            );
        case "secondaryLimit":
            return retryLater(
                failure.retryAfterSeconds === undefined
                    ? "GitHub secondary rate limit reached, with no retry-after to wait on"
                    : `GitHub secondary rate limit reached; retry-after ${String(failure.retryAfterSeconds)}s`,
            );
        case "rateLimitResponseUnusable":
            return retryLater(
                `GitHub rate limit reached; ${failure.headerName} ` +
                    `"${failure.headerValue}" is ${failure.reason}`,
            );
        case "notFoundOrNotInstalled":
            if (notFound === "labelMayBeAbsent" && LABEL_ABSENT.pattern.test(body)) {
                return { outcome: "already" };
            }
            return forbidden(
                "GitHub answered 404: the item is absent or outside the installation, " +
                    "and the two cannot be told apart",
            );
        case "permissionMissing":
            return forbidden(`GitHub wants the permission ${failure.acceptedPermissions}`);
        case "installationSuspended":
            return forbidden("the App installation is suspended");
        case "forbiddenUnrecognized":
            return forbidden(`GitHub denied the write: ${failure.bodySnippet}`);
        case "badCredentials":
            return forbidden("GitHub rejected the App's credentials");
        case "validationError":
            return conflict("GitHub refused the write as invalid against the item's current state");
        case "redirected":
            return conflict(
                `GitHub redirected the write to ${failure.location ?? "an undisclosed location"}`,
            );
        case "clientError":
            return conflict(`GitHub refused the write with ${String(failure.status)}`);
    }
}

export interface WriteVerbsOptions {
    readonly http: GitHubHttpClient;
    readonly repository: RepositoryRef;
}

/** The write surface one repository's capabilities share. */
export function createWriteVerbs({ http, repository }: WriteVerbsOptions): WriteVerbs {
    /** Send one write and name its answer; every verb ends here. */
    const apply = async (
        request: GitHubWriteRequest,
        notFound: NotFoundMeaning,
        allowance?: Allowance,
    ): Promise<WriteResult> => {
        const outcome = await http.request(request, allowance);
        if (outcome.ok) return { outcome: "applied" };
        // A failure carries no body when no response arrived, and an absent body
        // cannot name a label — the empty string reads the same way.

        return resultOfFailure(request, outcome.failure, notFound, outcome.body ?? "");
    };

    return writeVerbsOf({ repository, apply });
}
