/**
 * A failed GitHub call as the answer a capability gets: one `ResolverAnswer`
 * failure per class the client reports, and the same for a GraphQL body that
 * carried errors. No read lives here; the reads are `resolvers.ts` and `links.ts`.
 */

import type { ResolverAnswer } from "@hiero-hackers/automation-core";
import type { Allowance, Lane } from "../client/allowance.js";
import { describeFailure, type GitHubFailure, type GitHubSuccess } from "../client/contract.js";
import { field } from "../client/untrusted.js";

export type ResolverFailure = Extract<ResolverAnswer<never>, { readonly ok: false }>;

/** GitHub's own words reach an operator verbatim, so they are kept short. */
const QUOTED_HEADER_LIMIT = 40;

export const unavailable = (detail: string): ResolverFailure => ({
    ok: false,
    reason: "unavailable",
    detail,
});

const rateLimited = (detail: string): ResolverFailure => ({
    ok: false,
    reason: "rateLimited",
    detail,
});

/** This lane's own share is spent, not GitHub's: the window it waits for is the pool's. */
function laneSpent(lane: Lane, allowance?: Allowance): ResolverFailure {
    const window = allowance?.standing().find((pool) => pool.pool === lane)?.resetAt ?? null;
    return unavailable(
        `this lane's ${lane} allowance is spent; the pool resets at ` +
            (window ?? "an instant GitHub has not reported"),
    );
}

/**
 * A failed call as a resolver answer.
 * `reason` is the capability's half and stays coarse; `detail` is the operator's.
 */
export function httpFailure(outcome: GitHubFailure, allowance?: Allowance): ResolverFailure {
    const failure = outcome.failure;
    if (failure.kind === "notSent" && failure.reason === "allowanceExhausted") {
        return laneSpent(failure.lane, allowance);
    }
    switch (failure.kind) {
        case "permissionMissing":
            return { ok: false, reason: "noPermission", detail: "GitHub denied the query" };
        case "primaryExhausted":
            return rateLimited(
                "GitHub primary rate limit reached; the budget resets at " +
                    (failure.resetAt ?? "an instant GitHub did not report"),
            );
        case "secondaryLimit":
            return rateLimited(
                failure.retryAfterSeconds === undefined
                    ? "GitHub secondary rate limit reached, with no retry-after to wait on"
                    : `GitHub secondary rate limit reached; retry-after ${String(failure.retryAfterSeconds)}s`,
            );
        case "rateLimitResponseUnusable":
            return rateLimited(
                `GitHub rate limit reached; ${failure.headerName} ` +
                    `"${failure.headerValue.slice(0, QUOTED_HEADER_LIMIT)}" is ${failure.reason}`,
            );
        default:
            return unavailable(`GitHub query failed: ${describeFailure(failure)}`);
    }
}

/** A 200 whose body carried GraphQL errors; the headers say whether it was a limit. */
export function graphqlFailure(
    response: GitHubSuccess,
    errors: readonly unknown[],
): ResolverFailure {
    const types = errors.map((error) => field(error, "type"));
    if (
        response.headers["x-ratelimit-remaining"] === "0" ||
        response.headers["retry-after"] !== undefined ||
        types.includes("RATE_LIMITED")
    ) {
        return { ok: false, reason: "rateLimited", detail: "GitHub GraphQL rate limit reached" };
    }
    if (types.includes("FORBIDDEN")) {
        return { ok: false, reason: "noPermission", detail: "GitHub denied the GraphQL query" };
    }
    return unavailable("GitHub GraphQL returned errors");
}
