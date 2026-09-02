import type { PermissionGrant, ResolverSource } from "@hiero-hackers/automation-core";
import { describe, expect, it } from "vitest";
import { createResolverSource } from "../src/resolvers.js";
import { failure, httpHarness, installationToken, success, type ResponseStep } from "./harness.js";

const REPOSITORY = { owner: "Hiero-Hackers", repo: "SDK-Automations" } as const;
const ITEM = { kind: "pullRequest", number: 136 } as const;
const GRANTS = ["issues:read", "pull_requests:read"] as const;

function page(
    nodes: readonly unknown[] = [],
    pageInfo: unknown = { hasNextPage: false, endCursor: null },
    overrides: {
        readonly repository?: unknown;
        readonly pullRequest?: unknown;
        readonly connection?: unknown;
        readonly errors?: unknown;
    } = {},
): Response {
    const connection =
        overrides.connection === undefined ? { nodes, pageInfo } : overrides.connection;
    const pullRequest =
        overrides.pullRequest === undefined
            ? { number: ITEM.number, closingIssuesReferences: connection }
            : overrides.pullRequest;
    const repository =
        overrides.repository === undefined
            ? { nameWithOwner: "hiero-hackers/sdk-automations", pullRequest }
            : overrides.repository;
    return success(
        JSON.stringify({
            data: { repository },
            ...(overrides.errors === undefined ? {} : { errors: overrides.errors }),
        }),
    );
}

const issue = (number: number, nameWithOwner = "hiero-hackers/sdk-automations") => ({
    number,
    repository: { nameWithOwner },
});

function source(steps: readonly ResponseStep[], grants: readonly PermissionGrant[] = GRANTS) {
    const harness = httpHarness(steps, {
        outcomes: [
            {
                ok: true,
                token: { ...installationToken("resolver-token"), grants },
            },
        ],
    });
    return {
        resolve: createResolverSource({ http: harness.client, repository: REPOSITORY }),
        calls: harness.scripted.calls,
    };
}

async function linked(resolve: ResolverSource) {
    return resolve("linkedIssues", { item: ITEM });
}

describe("isAutomationActor", () => {
    it.each([
        ["dependabot[bot]", true],
        ["SDK-Automations[BoT]", true],
        ["robot-maintainer", false],
        ["bot", false],
        ["app[bot]-migration", false],
    ])("classifies %s locally", async (login, expected) => {
        const { resolve, calls } = source([page()]);

        expect(await resolve("isAutomationActor", { login })).toEqual({
            ok: true,
            value: expected,
        });
        expect(calls).toHaveLength(0);
    });

    it.each([null, "", 42])("fails honestly for malformed login %j", async (login) => {
        const { resolve, calls } = source([page()]);

        expect(await resolve("isAutomationActor", { login } as never)).toMatchObject({
            ok: false,
            reason: "unavailable",
        });
        expect(calls).toHaveLength(0);
    });
});

describe("linkedIssues", () => {
    it("returns same-repository issues in API order and sends variables, not interpolation", async () => {
        const first = page([issue(8), issue(9, "someone/else")], {
            hasNextPage: true,
            endCursor: "cursor-1",
        });
        const second = page([issue(10)], { hasNextPage: false, endCursor: "cursor-2" });
        const { resolve, calls } = source([first, second]);

        expect(await linked(resolve)).toEqual({
            ok: true,
            value: [
                { kind: "issue", number: 8 },
                { kind: "issue", number: 10 },
            ],
        });
        expect(calls).toHaveLength(2);
        const bodies = calls.map(
            (call) =>
                JSON.parse(String(call.init.body)) as {
                    query: string;
                    variables: Record<string, unknown>;
                },
        );
        expect(bodies[0]!.query).toContain(
            "closingIssuesReferences(first: 100, after: $after, excludeUserLinked: true)",
        );
        expect(bodies[0]!.query).not.toContain(REPOSITORY.owner);
        expect(bodies.map((body) => body.variables)).toEqual([
            { owner: REPOSITORY.owner, repo: REPOSITORY.repo, number: 136, after: null },
            { owner: REPOSITORY.owner, repo: REPOSITORY.repo, number: 136, after: "cursor-1" },
        ]);
    });

    it("distinguishes a valid empty answer from failure", async () => {
        const { resolve } = source([page([], undefined, { errors: [] })]);
        expect(await linked(resolve)).toEqual({ ok: true, value: [] });
    });

    it("accepts the first pull-request number", async () => {
        const response = page([], undefined, {
            pullRequest: {
                number: 1,
                closingIssuesReferences: {
                    nodes: [],
                    pageInfo: { hasNextPage: false, endCursor: null },
                },
            },
        });
        const { resolve } = source([response]);

        expect(await resolve("linkedIssues", { item: { kind: "pullRequest", number: 1 } })).toEqual(
            { ok: true, value: [] },
        );
    });

    it("does not cache across resolver calls", async () => {
        const { resolve, calls } = source([page([issue(1)]), page([issue(2)])]);

        expect(await linked(resolve)).toMatchObject({ ok: true, value: [{ number: 1 }] });
        expect(await linked(resolve)).toMatchObject({ ok: true, value: [{ number: 2 }] });
        expect(calls).toHaveLength(2);
    });

    it.each([
        [["issues:read", "pull_requests:read"], true],
        [["issues:write", "pull_requests:write"], true],
        [["issues:read"], false],
        [["pull_requests:read"], false],
        [[], false],
    ] as const)("checks the exact request token grants %j", async (grants, allowed) => {
        const { resolve, calls } = source([page()], grants);
        const answer = await linked(resolve);

        expect(answer.ok).toBe(allowed);
        if (!allowed) expect(answer).toMatchObject({ reason: "noPermission" });
        expect(calls).toHaveLength(allowed ? 1 : 0);
    });

    it.each([
        [{ kind: "issue", number: 1 }, "an issue"],
        [{ kind: "pullRequest", number: 0 }, "zero"],
        [{ kind: "pullRequest", number: "1" }, "a string"],
        [{ kind: "pullRequest", number: Number.MAX_SAFE_INTEGER + 1 }, "an unsafe number"],
        [null, "null"],
    ])("rejects invalid item input: %s", async (item, _label) => {
        const { resolve, calls } = source([page()]);

        expect(await resolve("linkedIssues", { item } as never)).toMatchObject({
            ok: false,
            reason: "unavailable",
        });
        expect(calls).toHaveLength(0);
    });

    it("rejects missing and repeated pagination cursors", async () => {
        for (const endCursor of [null, ""]) {
            const missing = source([page([], { hasNextPage: true, endCursor })]);
            expect(await linked(missing.resolve)).toMatchObject({
                ok: false,
                reason: "unavailable",
            });
            expect(missing.calls).toHaveLength(1);
        }

        const repeated = source([
            page([], { hasNextPage: true, endCursor: "A" }),
            page([], { hasNextPage: true, endCursor: "B" }),
            page([], { hasNextPage: true, endCursor: "A" }),
        ]);
        expect(await linked(repeated.resolve)).toMatchObject({
            ok: false,
            reason: "unavailable",
        });
        expect(repeated.calls).toHaveLength(3);
    });

    it("bounds pagination with distinct cursors", async () => {
        const pages = Array.from({ length: 10 }, (_, index) =>
            page([], { hasNextPage: true, endCursor: `cursor-${String(index + 1)}` }),
        );
        const { resolve, calls } = source(pages);

        expect(await linked(resolve)).toMatchObject({
            ok: false,
            reason: "unavailable",
            detail: "GitHub linked-issue pagination exceeded 10 pages",
        });
        expect(calls).toHaveLength(10);
    });

    it.each([
        ["invalid JSON", success("not json")],
        ["non-array errors", page([], undefined, { errors: {} })],
        ["missing repository", page([], undefined, { repository: null })],
        ["missing pull request", page([], undefined, { pullRequest: null })],
        ["missing connection", page([], undefined, { connection: null })],
        [
            "non-array nodes",
            page([], undefined, {
                connection: { nodes: {}, pageInfo: { hasNextPage: false, endCursor: null } },
            }),
        ],
        [
            "bad source identity",
            page([], undefined, {
                repository: {
                    nameWithOwner: "someone/else",
                    pullRequest: {
                        number: 136,
                        closingIssuesReferences: {
                            nodes: [],
                            pageInfo: { hasNextPage: false, endCursor: null },
                        },
                    },
                },
            }),
        ],
        [
            "wrong pull request",
            page([], undefined, {
                pullRequest: {
                    number: 137,
                    closingIssuesReferences: {
                        nodes: [],
                        pageInfo: { hasNextPage: false, endCursor: null },
                    },
                },
            }),
        ],
        ["zero node number", page([issue(0)])],
        ["string node number", page([{ ...issue(1), number: "1" }])],
        ["fractional node number", page([issue(1.5)])],
        ["unsafe node number", page([issue(Number.MAX_SAFE_INTEGER + 1)])],
        ["bad node repository", page([{ number: 1, repository: null }])],
        ["bad hasNextPage", page([], { hasNextPage: "no", endCursor: null })],
        ["false-y hasNextPage", page([], { hasNextPage: 0, endCursor: null })],
        ["missing endCursor", page([], { hasNextPage: false })],
    ])("fails instead of inventing absence for %s", async (_label, response) => {
        const { resolve } = source([response]);
        expect(await linked(resolve)).toMatchObject({ ok: false, reason: "unavailable" });
    });

    it("discards partial data when GraphQL reports an error", async () => {
        const response = page([issue(1)], undefined, { errors: [{ type: "FORBIDDEN" }] });
        const { resolve } = source([response]);

        expect(await linked(resolve)).toEqual({
            ok: false,
            reason: "noPermission",
            detail: "GitHub denied the GraphQL query",
        });
    });

    it.each([
        [
            failure(403, "forbidden", { "x-accepted-github-permissions": "issues=read" }),
            "noPermission",
        ],
        [failure(403, "exhausted", { "x-ratelimit-remaining": "0" }), "rateLimited"],
        [failure(403, "secondary rate limit"), "rateLimited"],
        [failure(429, "limited", { "retry-after": "not-a-number" }), "rateLimited"],
        [failure(500, "weather"), "unavailable"],
        [failure(403, "unrecognized forbidden"), "unavailable"],
    ])("maps HTTP failure to %s", async (response, reason) => {
        const { resolve } = source([response]);
        expect(await linked(resolve)).toMatchObject({ ok: false, reason });
    });

    it.each([
        [{ type: "RATE_LIMITED" }, {}, "rateLimited"],
        [{ type: "OTHER" }, { "x-ratelimit-remaining": "0" }, "rateLimited"],
        [{ type: "OTHER" }, { "retry-after": "60" }, "rateLimited"],
        [{ type: "OTHER" }, {}, "unavailable"],
    ])("maps GraphQL error %j to %s", async (error, headers, reason) => {
        const response = page([], undefined, { errors: [error] });
        const withHeaders = new Response(response.body, { status: 200, headers });
        const { resolve } = source([withHeaders]);

        expect(await linked(resolve)).toMatchObject({ ok: false, reason });
    });

    it("keeps resolver failures diagnostic", async () => {
        const answer = async (
            steps: readonly ResponseStep[],
            grants: readonly PermissionGrant[] = GRANTS,
        ) => linked(source(steps, grants).resolve);

        expect(
            await answer([
                failure(403, "forbidden", {
                    "x-accepted-github-permissions": "issues=read",
                }),
            ]),
        ).toMatchObject({ detail: "GitHub denied the query" });
        expect(await answer([failure(403, "secondary rate limit")])).toMatchObject({
            detail: "GitHub secondary rate limit reached, with no retry-after to wait on",
        });
        expect(await answer([failure(500, "weather")])).toMatchObject({
            detail: "GitHub query failed: transient",
        });
        expect(
            await answer([page([], undefined, { errors: [{ type: "RATE_LIMITED" }] })]),
        ).toMatchObject({ detail: "GitHub GraphQL rate limit reached" });
        expect(await answer([page([], undefined, { errors: [{ type: "OTHER" }] })])).toMatchObject({
            detail: "GitHub GraphQL returned errors",
        });
        expect(await answer([success("not json")])).toMatchObject({
            detail: "GitHub returned malformed linked-issue data",
        });
        expect(await answer([page([], undefined, { repository: null })])).toMatchObject({
            detail: "GitHub returned malformed linked-issue data",
        });
        expect(await answer([page([{ number: 1, repository: null }])])).toMatchObject({
            detail: "GitHub returned malformed linked-issue data",
        });
        expect(await answer([page([], undefined, { errors: {} })])).toMatchObject({
            detail: "GitHub returned malformed GraphQL errors",
        });
        expect(await answer([page([], { hasNextPage: true, endCursor: "" })])).toMatchObject({
            detail: "GitHub returned a missing linked-issue cursor",
        });
        expect(
            await createResolverSource({
                http: httpHarness([page()]).client,
                repository: REPOSITORY,
            })("linkedIssues", { item: null } as never),
        ).toMatchObject({ detail: "linkedIssues requires a valid pull request item" });
        expect(await answer([page()], [])).toMatchObject({
            detail: "GitHub denied the query",
        });

        const repeated = source([
            page([], { hasNextPage: true, endCursor: "A" }),
            page([], { hasNextPage: true, endCursor: "A" }),
        ]);
        expect(await linked(repeated.resolve)).toMatchObject({
            detail: "GitHub repeated a linked-issue cursor",
        });
        expect(await repeated.resolve("isAutomationActor", { login: "" })).toMatchObject({
            detail: "isAutomationActor requires a valid login",
        });
    });

    /**
     * One `reason` covers all three rate classes because a capability can act
     * on nothing finer. An operator can: these assertions are the wait signal
     * surviving the collapse (D20).
     */
    it("says which rate limit was reached and what wait signal it carried", async () => {
        const answer = async (steps: readonly ResponseStep[]) => linked(source(steps).resolve);

        expect(
            await answer([
                failure(403, "API rate limit exceeded", {
                    "x-ratelimit-remaining": "0",
                    "x-ratelimit-reset": "1787310000",
                }),
            ]),
        ).toEqual({
            ok: false,
            reason: "rateLimited",
            detail: "GitHub primary rate limit reached; the budget resets at 1787310000",
        });
        expect(
            await answer([failure(403, "exhausted", { "x-ratelimit-remaining": "0" })]),
        ).toMatchObject({
            reason: "rateLimited",
            detail: "GitHub primary rate limit reached; the budget resets at an instant GitHub did not report",
        });
        expect(
            await answer([failure(403, "secondary rate limit", { "retry-after": "30" })]),
        ).toMatchObject({
            reason: "rateLimited",
            detail: "GitHub secondary rate limit reached; retry-after 30s",
        });
        expect(await answer([failure(429, "slow down", { "retry-after": "" })])).toMatchObject({
            reason: "rateLimited",
            detail: 'GitHub rate limit reached; retry-after "" is invalid',
        });
    });

    it("keeps GitHub's own words out of an unbounded detail", async () => {
        const answer = await linked(
            source([failure(429, "slow down", { "retry-after": "9".repeat(60) })]).resolve,
        );

        expect(answer).toMatchObject({
            reason: "rateLimited",
            detail: `GitHub rate limit reached; retry-after "${"9".repeat(40)}" is invalid`,
        });
    });

    it("names the broken seam behind a request that never left the process", async () => {
        const harness = httpHarness([page()], { outcomes: [new Error("token source down")] });

        expect(
            await linked(createResolverSource({ http: harness.client, repository: REPOSITORY })),
        ).toEqual({
            ok: false,
            reason: "unavailable",
            detail: "GitHub query failed: notSent (broken seam: tokenSource)",
        });
    });
});
