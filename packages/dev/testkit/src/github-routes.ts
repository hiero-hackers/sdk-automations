/**
 * GitHub as a script: the open items, their timelines and reviews, the dashboard's pull request
 * 38 linked to issue 37, and the configuration file, each answered with rate-limit headers and
 * an ETag. One table behind both the in-process `fetch` script and the fake served over HTTP.
 * `calls` is what was charged.
 */

import { createHash } from "node:crypto";

export const HOUR = 3_600_000;
export const POOL_LIMIT = 5_000;
export const UPDATED = "2026-09-14T10:00:00.000Z";

export interface GitHubCall {
    method: string;
    path: string;
    status: number;
    pool: "core" | "graphql";
    window: number;
}

export interface GitHubScript {
    readonly now: () => Date;
    readonly config: () => string;
    /** While true, every request is refused as GitHub refuses one past a secondary limit. */
    readonly secondaryLimited?: (route: string) => boolean;
    /** The seconds that refusal asks the caller to wait; GitHub's is a minute. */
    readonly retryAfterSeconds?: () => number;
    /** While true, every write is refused as GitHub refuses an App without the grant. */
    readonly refusesWrites?: () => boolean;
    /** While true, the configuration file is absent. */
    readonly noConfig?: () => boolean;
}

export interface GitHubRequest {
    readonly method: string;
    readonly path: string;
    readonly ifNoneMatch: string | null;
    readonly body: string;
}

export interface GitHubReply {
    readonly status: number;
    readonly headers: Record<string, string>;
    readonly body: string | null;
}

const WRITE_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);
const BOT = { login: "github-actions[bot]", type: "Bot" } as const;

const items = [12, 34].map((number) => ({
    number,
    state: "open",
    locked: false,
    updated_at: UPDATED,
    labels: [],
    user: { login: "ada" },
    assignees: [{ login: "ada" }],
    ...(number === 34 ? { pull_request: { url: "https://api.github.com/pulls/34" } } : {}),
}));

const ROUTES: Record<string, unknown> = {
    "": { full_name: "scrubbed-1/scrubbed-2", default_branch: "main", private: false },
    "/issues": items,
    "/issues/12/timeline": [{ event: "assigned", assignee: { login: "ada" }, created_at: UPDATED }],
    "/issues/34/timeline": [{ event: "assigned", assignee: { login: "ada" }, created_at: UPDATED }],
    "/issues/12/comments": [],
    "/issues/34/comments": [],
    "/pulls/34": { draft: false, created_at: UPDATED },
    "/pulls/34/reviews": [],
    "/pulls/34/commits": [{ commit: { committer: { date: UPDATED } } }],
    "/issues/37": {
        number: 37,
        state: "open",
        locked: false,
        updated_at: UPDATED,
        labels: [],
        user: { login: "ada" },
        assignees: [{ login: "scrubbed-1" }],
    },
    "/issues/197": { number: 197, assignees: [] },
    "/issues/37/timeline": [],
    "/issues/38/timeline": [],
    "/pulls/38": { number: 38, mergeable: true, head: { sha: "a".repeat(40) } },
    "/pulls/38/files": [{ filename: "sdk-automations.yml", status: "modified" }],
    "/pulls/38/commits": [
        {
            sha: "a".repeat(40),
            parents: [],
            commit: {
                message: "Change\n\nSigned-off-by: ada",
                verification: { verified: true },
            },
        },
    ],
    "/graphql": {
        data: {
            rateLimit: { cost: 1 },
            repository: {
                nameWithOwner: "scrubbed-1/scrubbed-2",
                pullRequest: {
                    number: 38,
                    closingIssuesReferences: {
                        nodes: [
                            {
                                number: 37,
                                repository: { nameWithOwner: "scrubbed-1/scrubbed-2" },
                            },
                        ],
                        pageInfo: { hasNextPage: false, endCursor: null },
                    },
                },
                p0: {
                    number: 34,
                    closingIssuesReferences: {
                        nodes: [],
                        pageInfo: { hasNextPage: false, endCursor: null },
                    },
                },
            },
        },
    },
};

function jsonRecord(text: string): Record<string, unknown> {
    try {
        const parsed: unknown = JSON.parse(text);
        return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
            ? (parsed as Record<string, unknown>)
            : {};
    } catch {
        return {};
    }
}

/**
 * What a write answers: the body GitHub would, with ids, and no state kept. Stubbed: a comment's
 * id counts up from 1, a label list answers the names sent, an assignment answers the logins
 * sent; nothing written shows in a later read.
 */
function writeReply(
    method: string,
    route: string,
    text: string,
    id: () => number,
): { status: number; body: unknown } {
    const sent = jsonRecord(text);
    const now = UPDATED;
    if (method === "POST" && /^\/issues\/\d+\/comments$/.test(route)) {
        const comment = {
            id: id(),
            body: sent["body"],
            user: BOT,
            created_at: now,
            updated_at: now,
        };
        return { status: 201, body: comment };
    }
    if (method === "PATCH" && /^\/issues\/comments\/\d+$/.test(route)) {
        const found = /\d+$/.exec(route)?.[0] ?? "0";
        return {
            status: 200,
            body: { id: Number(found), body: sent["body"], user: BOT, updated_at: now },
        };
    }
    if (method === "POST" && /^\/issues\/\d+\/labels$/.test(route)) {
        const labels = Array.isArray(sent["labels"]) ? (sent["labels"] as unknown[]) : [];
        return { status: 200, body: labels.map((name) => ({ name })) };
    }
    if (method === "POST" && route === "/labels") {
        return { status: 201, body: { id: id(), name: sent["name"] } };
    }
    if (method === "DELETE" && /^\/issues\/\d+\/labels\//.test(route)) {
        return { status: 200, body: [] };
    }
    if (method === "POST" && /^\/issues\/\d+\/assignees$/.test(route)) {
        const logins = Array.isArray(sent["assignees"]) ? (sent["assignees"] as unknown[]) : [];
        return { status: 201, body: { assignees: logins.map((login) => ({ login })) } };
    }
    if (method === "DELETE" && /^\/issues\/\d+\/assignees$/.test(route)) {
        return { status: 200, body: { assignees: [] } };
    }
    if (method === "PATCH" && /^\/pulls\/\d+$/.test(route)) {
        return { status: 200, body: { state: sent["state"] ?? "closed" } };
    }
    if (/^\/issues\/\d+\/lock$/.test(route)) return { status: 204, body: null };
    return { status: 200, body: {} };
}

export function githubScript(script: GitHubScript) {
    const calls: GitHubCall[] = [];
    let ids = 0;
    const answer = (request: GitHubRequest): GitHubReply => {
        const { path } = request;
        if (path.endsWith("/access_tokens")) {
            return {
                status: 201,
                headers: {},
                body: JSON.stringify({
                    token: "fixture-token",
                    expires_at: "2099-01-01T00:00:00Z",
                    permissions: { contents: "read", issues: "write", pull_requests: "read" },
                }),
            };
        }
        const route = path.replace(/^\/repos\/[^/]+\/[^/]+/, "");
        const window = script.now().getTime();
        if (script.secondaryLimited?.(route) === true) {
            calls.push({ method: request.method, path, status: 403, pool: "core", window });
            return {
                status: 403,
                headers: { "retry-after": String(script.retryAfterSeconds?.() ?? 60) },
                body: JSON.stringify({ message: "You have exceeded a secondary rate limit." }),
            };
        }
        const pool = route === "/graphql" ? "graphql" : "core";
        const limits = (etag?: string): Record<string, string> => ({
            "x-ratelimit-limit": String(POOL_LIMIT),
            "x-ratelimit-remaining": String(
                POOL_LIMIT -
                    calls.filter(
                        (call) =>
                            call.pool === pool && call.status === 200 && call.window === window,
                    ).length,
            ),
            "x-ratelimit-reset": String(Math.floor((window + HOUR) / 1_000)),
            "x-ratelimit-resource": pool,
            ...(etag === undefined ? {} : { etag }),
        });
        if (WRITE_METHODS.has(request.method) && route !== "/graphql") {
            if (script.refusesWrites?.() === true) {
                calls.push({ method: request.method, path, status: 403, pool, window });
                return {
                    status: 403,
                    headers: limits(),
                    body: JSON.stringify({
                        message: "Resource not accessible by integration",
                        documentation_url: "https://docs.github.com/rest",
                    }),
                };
            }
            const written = writeReply(request.method, route, request.body, () => (ids += 1));
            calls.push({ method: request.method, path, status: written.status, pool, window });
            return {
                status: written.status,
                headers: limits(),
                body: written.body === null ? null : JSON.stringify(written.body),
            };
        }
        const text = script.config();
        const config = route === "/contents/sdk-automations.yml";
        if (config && script.noConfig?.() === true) {
            calls.push({ method: request.method, path, status: 404, pool, window });
            return {
                status: 404,
                headers: limits(),
                body: JSON.stringify({ message: "Not Found" }),
            };
        }
        const body = config
            ? {
                  type: "file",
                  encoding: "base64",
                  sha: "a".repeat(40),
                  content: Buffer.from(text).toString("base64"),
              }
            : (ROUTES[route] ?? (/^\/issues\/\d+\/timeline$/.test(route) ? [] : undefined));
        const etag = `"${config ? createHash("sha1").update(text).digest("hex") : "unchanged"}"`;
        const status = request.ifNoneMatch === etag ? 304 : 200;
        calls.push({ method: request.method, path, status, pool, window });
        return {
            status: body === undefined ? 404 : status,
            headers: limits(pool === "core" ? etag : undefined),
            body: status === 304 ? null : JSON.stringify(body ?? { message: "no route" }),
        };
    };
    return { calls, answer };
}
