/**
 * The endpoint-permission matrix as code: may this request be sent, and with which grants?
 * Nothing here sends anything, waits, or reads a response; that is `http.ts`.
 */

import type { PermissionGrant } from "@hiero-hackers/automation-core";
import {
    bodyOf,
    GITHUB_API_ORIGIN,
    GITHUB_GRAPHQL_URL,
    isWrite,
    notSentFailure,
    type GitHubFailure,
    type GitHubGraphqlRequest,
    type GitHubRequest,
    type GitHubWriteRequest,
    type NotSentReason,
} from "./contract.js";
import { writeEndpointOf, type WriteEndpoint } from "./endpoints.js";
import type { InstallationToken } from "./token.js";
import { jsonRecordOf } from "./untrusted.js";

type GitHubApiUrl =
    | { readonly ok: true; readonly url: URL }
    | { readonly ok: false; readonly refused: "malformedUrl" | "disallowedOrigin" };

function githubApiUrl(rawUrl: string): GitHubApiUrl {
    let url: URL;
    try {
        url = new URL(rawUrl);
    } catch {
        return { ok: false, refused: "malformedUrl" };
    }
    return url.origin === GITHUB_API_ORIGIN
        ? { ok: true, url }
        : { ok: false, refused: "disallowedOrigin" };
}

/** What admitting a write learned, for the client's retry policy, its grants and its cache. */
export interface AdmittedWrite {
    readonly endpoint: WriteEndpoint;
    /** The grant this endpoint needs — the pull surface's is not the issue surface's. */
    readonly grant: PermissionGrant;
    readonly invalidates: readonly string[];
}

/** A request as it may be sent, or the refusal that stops it here. */
export type AdmittedRequest =
    | {
          readonly ok: true;
          readonly request: GitHubRequest;
          readonly write: AdmittedWrite | null;
          /** The read grants this request needs — per GraphQL operation, empty for a GET. */
          readonly reads: readonly PermissionGrant[];
      }
    | { readonly ok: false; readonly refusal: GitHubFailure };

const refused = (
    reason: Exclude<NotSentReason, "brokenSeam" | "allowanceExhausted">,
): AdmittedRequest => ({
    ok: false,
    refusal: notSentFailure(reason),
});

/**
 * The GraphQL operations this package may POST, and the grants each needs.
 * An operation absent from here reaches `/graphql` never, and these reach nothing else.
 */
const GRAPHQL_OPERATIONS: Readonly<Record<string, readonly PermissionGrant[]>> = {
    LinkedIssues: ["issues:read", "pull_requests:read"],
    LinkedIssuesBatch: ["issues:read", "pull_requests:read"],
};

/** The declared operation of a POST body, or `null` when the body does not name one. */
function operationOf(body: string): string | null {
    const named = jsonRecordOf(body);
    if (named === null) return null;
    const operationName = named["operationName"];
    const query = named["query"];
    if (typeof operationName !== "string" || typeof query !== "string") return null;
    if (!Object.hasOwn(GRAPHQL_OPERATIONS, operationName)) return null;
    // Each operation names its own query, so neither may answer for the other.

    return new RegExp(`^\\s*query\\s+${operationName}(?:\\s|\\()`).test(query)
        ? operationName
        : null;
}

function admitGraphql(request: GitHubGraphqlRequest, url: URL): AdmittedRequest {
    if (url.href !== GITHUB_GRAPHQL_URL) return refused("disallowedMethod");
    if (typeof request.body !== "string") return refused("invalidBody");
    const operation = operationOf(request.body);
    if (operation === null) return refused("invalidBody");
    return {
        ok: true,
        request: { ...request, url: url.href },
        write: null,
        reads: GRAPHQL_OPERATIONS[operation]!,
    };
}

/**
 * A write against the per-endpoint allowlist.
 * The body rule is per endpoint, not per method: the label removal carries none, and the assignee release is a DELETE that must.
 */
function admitWrite(request: GitHubWriteRequest, url: URL): AdmittedRequest {
    const write = writeEndpointOf(request.method, url);
    if (write === null) return refused("disallowedMethod");
    // Unreachable through the type, and the retry policy reads this field.

    if (request.idempotency !== "idempotent" && request.idempotency !== "nonIdempotent") {
        return refused("invalidBody");
    }
    const body = bodyOf(request);
    if (write.endpoint === "removeLabel") {
        if (body !== undefined) return refused("invalidBody");
    } else {
        if (body === undefined || jsonRecordOf(body) === null) return refused("invalidBody");
    }
    return { ok: true, request: { ...request, url: url.href }, write, reads: [] };
}

/**
 * The admitted methods, the pinned origin, the named GraphQL operations, the confirmed
 * write endpoints. It runs before a token is acquired, so a refusal costs no mint.
 */
export function admit(request: GitHubRequest): AdmittedRequest {
    const write = isWrite(request);
    if (!write && request.method !== "GET" && request.method !== "POST") {
        return refused("disallowedMethod");
    }
    const parsed = githubApiUrl(request.url);
    if (!parsed.ok) return refused(parsed.refused);
    if (write) return admitWrite(request, parsed.url);
    if (request.method === "POST") return admitGraphql(request, parsed.url);
    return { ok: true, request: { ...request, url: parsed.url.href }, write: null, reads: [] };
}

function hasReadGrant(token: InstallationToken, required: PermissionGrant): boolean {
    const write = `${required.slice(0, -4)}write`;
    return token.grants.some((grant) => grant === required || grant === write);
}

/**
 * Grants the admission gate named and the token does not carry.
 * A read is satisfied by the matching write grant; a write by the one its own endpoint names, and nothing weaker (D123).
 */
export function missingGrants(
    reads: readonly PermissionGrant[],
    write: AdmittedWrite | null,
    token: InstallationToken,
): readonly PermissionGrant[] {
    if (write !== null) {
        return token.grants.some((grant) => grant === write.grant) ? [] : [write.grant];
    }
    return reads.filter((grant) => !hasReadGrant(token, grant));
}
