/**
 * GitHub as a script behind `fetch`: the two open items, their timelines and reviews, the
 * dashboard's pull request 165 linked to issue 164, and the configuration file, each answered
 * with rate-limit headers and an ETag, so the composed client, reader and engine run without
 * a credential. `calls` is what was charged.
 */

import { createHash } from "node:crypto";
import { vi } from "vitest";

export const HOUR = 3_600_000;
export const POOL_LIMIT = 5_000;
export const UPDATED = "2026-09-14T10:00:00.000Z";

export function scriptedGitHub(script: {
    readonly now: () => Date;
    readonly config: () => string;
}) {
    const calls: Array<{ path: string; status: number; pool: "core" | "graphql"; window: number }> =
        [];
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
    const routes: Record<string, unknown> = {
        "/issues": items,
        "/issues/12/timeline": [
            { event: "assigned", assignee: { login: "ada" }, created_at: UPDATED },
        ],
        "/issues/34/timeline": [
            { event: "assigned", assignee: { login: "ada" }, created_at: UPDATED },
        ],
        "/issues/12/comments": [],
        "/issues/34/comments": [],
        "/pulls/34": { draft: false, created_at: UPDATED },
        "/pulls/34/reviews": [],
        "/pulls/34/commits": [{ commit: { committer: { date: UPDATED } } }],
        "/issues/164": { assignees: [{ login: "scrubbed-1" }] },
        "/issues/164/timeline": [],
        "/issues/165/timeline": [],
        "/pulls/165": { number: 165, mergeable: true, head: { sha: "a".repeat(40) } },
        "/pulls/165/files": [{ filename: "sdk-automations.yml", status: "modified" }],
        "/pulls/165/commits": [
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
                        number: 165,
                        closingIssuesReferences: {
                            nodes: [
                                {
                                    number: 164,
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
    vi.stubGlobal("fetch", (input: string | URL, init: RequestInit) => {
        const path = new URL(String(input)).pathname;
        if (path.endsWith("/access_tokens")) {
            return Promise.resolve(
                new Response(
                    JSON.stringify({
                        token: "fixture-token",
                        expires_at: "2099-01-01T00:00:00Z",
                        permissions: { contents: "read", issues: "write", pull_requests: "read" },
                    }),
                    { status: 201 },
                ),
            );
        }
        const route = path.replace(/^\/repos\/[^/]+\/[^/]+/, "");
        const text = script.config();
        const config = route === "/contents/sdk-automations.yml";
        const body = config
            ? {
                  type: "file",
                  encoding: "base64",
                  sha: "a".repeat(40),
                  content: Buffer.from(text).toString("base64"),
              }
            : routes[route];
        const pool = route === "/graphql" ? "graphql" : "core";
        const etag = `"${config ? createHash("sha1").update(text).digest("hex") : "unchanged"}"`;
        const status = new Headers(init.headers).get("if-none-match") === etag ? 304 : 200;
        calls.push({ path, status, pool, window: script.now().getTime() });
        const headers = {
            "x-ratelimit-limit": String(POOL_LIMIT),
            "x-ratelimit-remaining": String(
                POOL_LIMIT -
                    calls.filter(
                        (call) =>
                            call.pool === pool &&
                            call.status === 200 &&
                            call.window === script.now().getTime(),
                    ).length,
            ),
            "x-ratelimit-reset": String(Math.floor((script.now().getTime() + HOUR) / 1_000)),
            "x-ratelimit-resource": pool,
            ...(pool === "core" ? { etag } : {}),
        };
        return Promise.resolve(
            new Response(status === 304 ? null : JSON.stringify(body ?? { message: "no route" }), {
                status: body === undefined ? 404 : status,
                headers,
            }),
        );
    });
    return {
        calls,
        cost: (from = 0) => ({
            requests: calls.length - from,
            core: calls.slice(from).filter(({ pool, status }) => pool === "core" && status === 200)
                .length,
            graphql: calls.slice(from).filter(({ pool }) => pool === "graphql").length,
        }),
    };
}
