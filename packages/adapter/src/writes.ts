/**
 * The four write verbs, and what GitHub's answer to each one means.
 *
 * `http.ts` decides whether a write may be SENT — the origin pin, the
 * per-endpoint allowlist, the grant, the retry budget. This file decides what
 * came back, in the endpoint matrix's vocabulary: `applied`, `already`,
 * `conflict`, `forbidden`, `retryLater`, `unknown`. A capability acts on the
 * word and never on a status code.
 *
 * One rule shapes every ambiguous mapping. `unknown` means "sent, and nothing
 * here can tell whether it landed", and the matrix forbids a caller from
 * retrying it. So a class becomes `unknown` only when the write may genuinely
 * have applied, and becomes `retryLater` whenever re-sending is provably
 * harmless — which for an idempotent verb includes the ambiguous classes,
 * because applying a no-op twice is applying it once.
 *
 * The four URLs are built here and matched independently in `http.ts`'s gate.
 * That is the one fact deliberately written twice: a gate that trusted this
 * file's spelling would not be a gate.
 */

import type { ItemRef, RepositoryRef } from "@hiero-hackers/automation-core";
import {
    describeFailure,
    repoPath,
    type GitHubHttpClient,
    type GitHubHttpFailureClass,
    type GitHubWriteRequest,
    type WriteIdempotency,
} from "./http.js";

// ─── The vocabulary ──────────────────────────────────────────────────

/**
 * What one write turned out to be.
 *
 * `applied` is the postcondition holding because we made it hold; `already` is
 * it holding without us. Only the label removal can ever report `already` —
 * see `NotFoundMeaning` for why the other three cannot.
 */
export type WriteResult =
    | { readonly outcome: "applied" }
    | { readonly outcome: "already" }
    | { readonly outcome: "conflict"; readonly detail: string }
    | { readonly outcome: "forbidden"; readonly detail: string }
    | { readonly outcome: "retryLater"; readonly detail: string }
    | { readonly outcome: "unknown"; readonly detail: string };

/** The four confirmed write operations, and nothing else. */
export interface WriteVerbs {
    /** Add one named label. Idempotent: adding a label already there is a no-op. */
    addLabel(item: ItemRef, label: string): Promise<WriteResult>;
    /** Remove ONE named label. There is no remove-by-prefix here or below (D4). */
    removeLabel(item: ItemRef, label: string): Promise<WriteResult>;
    /** Create a comment. The one non-idempotent verb, and the reason 6.5 exists. */
    createComment(item: ItemRef, body: string): Promise<WriteResult>;
    /** Replace a comment's body, by the comment id the read-back found. */
    updateComment(commentId: number, body: string): Promise<WriteResult>;
}

export interface WriteVerbsOptions {
    readonly http: GitHubHttpClient;
    readonly repository: RepositoryRef;
}

// ─── Reading GitHub's answer ─────────────────────────────────────────

/**
 * What a 404 means at this endpoint — the one status the four disagree about.
 *
 * `invisible`: the item is gone or was never visible, and GitHub hides which
 * (matrix, "Repo outside installation"). Nothing landed and nothing will.
 *
 * `labelMayBeAbsent`: the same 404 ALSO covers the desired postcondition —
 * removing a label the item does not carry. The two are separated by GitHub's
 * prose below, and the fallback when the prose does not match is `invisible`,
 * never `already`: claiming a postcondition nobody observed is the error that
 * lets a wrong "absent" stand (D46).
 */
type NotFoundMeaning = "invisible" | "labelMayBeAbsent";

/**
 * The one place this file reads GitHub's prose, and it is DOCUMENTED rather
 * than probed: no run in the endpoint matrix removed an absent label, so this
 * pattern has no dated citation and no `probedAt`. It degrades the way core's
 * `BODY_PATTERNS` do — a reworded message stops matching and the result falls
 * back to `forbidden`, which is wrong in the harmless direction.
 */
export const LABEL_ABSENT = {
    pattern: /label does not exist/i,
    documented: "Label does not exist",
} as const;

const conflict = (detail: string): WriteResult => ({ outcome: "conflict", detail });
const forbidden = (detail: string): WriteResult => ({ outcome: "forbidden", detail });
const retryLater = (detail: string): WriteResult => ({ outcome: "retryLater", detail });

/**
 * A failure that may or may not have landed, answered by idempotency.
 *
 * A timeout and a dropped socket both arrive as `transient`, and both can mean
 * GitHub applied the change and lost the answer on the way back. Re-sending an
 * idempotent write in that state costs nothing, so it is `retryLater`. For the
 * comment create it is `unknown`, and the caller reconciles instead.
 */
function ambiguous(idempotency: WriteIdempotency, detail: string): WriteResult {
    return idempotency === "idempotent"
        ? retryLater(`${detail}; re-sending this write cannot apply it twice`)
        : { outcome: "unknown", detail: `${detail}; the write may already have landed` };
}

/**
 * One failed write as one word, per class and per endpoint.
 *
 * The rate classes are `retryLater` with GitHub's own wait signal in the
 * detail, the same shape the read path gives an operator. `tokenExpired` joins
 * them because a 401 provably applied nothing and the client has already
 * dropped the token, so the next call mints a fresh one. `validationError`,
 * `clientError` and `redirected` are `conflict`: a 4xx never mutates, and each
 * says the world is not the shape the plan named. Everything else that denies
 * or refuses is `forbidden`, including a local refusal — nothing was sent, so
 * calling it `unknown` would send the caller reconciling a change that does
 * not exist.
 */
function resultOfFailure(
    failure: GitHubHttpFailureClass,
    idempotency: WriteIdempotency,
    notFound: NotFoundMeaning,
    body: string,
): WriteResult {
    switch (failure.kind) {
        case "notSent":
            return forbidden(`the adapter refused the write: ${describeFailure(failure)}`);
        case "responseTooLarge":
        case "transient":
            return ambiguous(idempotency, `GitHub call failed: ${describeFailure(failure)}`);
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

// ─── The verbs ───────────────────────────────────────────────────────

/**
 * The write surface one repository's capabilities share.
 *
 * Nothing is validated here. A label with no name, a negative comment id, an
 * item number that is not one — each builds a URL the gate in `http.ts` refuses
 * structurally, and a refusal is already a `forbidden` result. Checking twice
 * would move the decision away from the gate that has to be right anyway.
 */
export function createWriteVerbs({ http, repository }: WriteVerbsOptions): WriteVerbs {
    const issuePath = (item: ItemRef): string =>
        `${repoPath(repository)}/issues/${String(item.number)}`;

    /** Send one write and name its answer; every verb ends here. */
    const apply = async (
        request: GitHubWriteRequest,
        notFound: NotFoundMeaning,
    ): Promise<WriteResult> => {
        const outcome = await http.request(request);
        if (outcome.ok) return { outcome: "applied" };
        // A failure carries no body when no response arrived, and an absent
        // body cannot name a label — the empty string reads the same way.
        return resultOfFailure(outcome.failure, request.idempotency, notFound, outcome.body ?? "");
    };

    return {
        addLabel: (item, label) =>
            apply(
                {
                    url: `${issuePath(item)}/labels`,
                    method: "POST",
                    body: JSON.stringify({ labels: [label] }),
                    idempotency: "idempotent",
                },
                "invisible",
            ),
        removeLabel: (item, label) =>
            apply(
                {
                    url: `${issuePath(item)}/labels/${encodeURIComponent(label)}`,
                    method: "DELETE",
                    idempotency: "idempotent",
                },
                "labelMayBeAbsent",
            ),
        createComment: (item, body) =>
            apply(
                {
                    url: `${issuePath(item)}/comments`,
                    method: "POST",
                    body: JSON.stringify({ body }),
                    idempotency: "nonIdempotent",
                },
                "invisible",
            ),
        updateComment: (commentId, body) =>
            apply(
                {
                    url: `${repoPath(repository)}/issues/comments/${String(commentId)}`,
                    method: "PATCH",
                    body: JSON.stringify({ body }),
                    idempotency: "idempotent",
                },
                "invisible",
            ),
    };
}
