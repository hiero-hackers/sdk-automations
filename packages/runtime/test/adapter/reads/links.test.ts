/**
 * The batched link read, against scripted GraphQL answers. The per-item read is
 * covered through the resolver arm it answers (`resolvers.test.ts`); what is only
 * reachable here is the aliased body, the whole-answer refusal, and the fall back
 * to one query for a pull request GitHub held pages back on.
 */

import { describe, expect, it } from "vitest";
import { MAX_BATCH_ALIASES, readLinkedIssuesBatch } from "../../../src/adapter/reads/links.js";
import { failure, httpHarness, installationToken, success, type ResponseStep } from "../harness.js";

const REPOSITORY = { owner: "Hiero-Hackers", repo: "SDK-Automations" } as const;
const NAME_WITH_OWNER = "hiero-hackers/sdk-automations";
const GRANTS = ["issues:read", "pull_requests:read"] as const;

const node = (number: number, nameWithOwner = NAME_WITH_OWNER) => ({
    number,
    repository: { nameWithOwner },
});

/** One alias's answer, as GitHub shapes it. */
function alias(
    number: number,
    nodes: readonly unknown[] = [],
    pageInfo: unknown = { hasNextPage: false, endCursor: null },
) {
    return {
        number,
        closingIssuesReferences: { nodes, pageInfo },
    };
}

/** A batched body whose aliases are `p0…`, in the order the numbers were asked. */
function batch(aliases: readonly unknown[]): ResponseStep {
    const repository: Record<string, unknown> = {};
    for (const [index, held] of aliases.entries()) repository[`p${String(index)}`] = held;
    return () => success(JSON.stringify({ data: { repository } }));
}

/** A per-item answer, which the fallback reads through the `LinkedIssues` shape. */
function page(number: number, nodes: readonly unknown[] = []): ResponseStep {
    return () =>
        success(
            JSON.stringify({
                data: {
                    repository: {
                        nameWithOwner: NAME_WITH_OWNER,
                        pullRequest: {
                            number,
                            closingIssuesReferences: {
                                nodes,
                                pageInfo: { hasNextPage: false, endCursor: null },
                            },
                        },
                    },
                },
            }),
        );
}

function context(steps: readonly ResponseStep[]) {
    const harness = httpHarness(steps, {
        outcomes: [{ ok: true, token: { ...installationToken("batch-token"), grants: GRANTS } }],
    });
    return { http: harness.client, repository: REPOSITORY, calls: harness.scripted.calls };
}

/** The bodies each call sent, parsed, so a case can read the query and the variables. */
const bodiesOf = (calls: { readonly init: RequestInit }[]) =>
    calls.map(
        (call) =>
            JSON.parse(String(call.init.body)) as {
                operationName: string;
                query: string;
                variables: Record<string, unknown>;
            },
    );

describe("the batched link read", () => {
    it("names a hundred pull requests in one body, and chunks the hundred-and-first", async () => {
        const numbers = Array.from({ length: MAX_BATCH_ALIASES + 1 }, (_, index) => index + 1);
        const { calls, ...reads } = context([
            batch(numbers.slice(0, MAX_BATCH_ALIASES).map((number) => alias(number))),
            batch([alias(MAX_BATCH_ALIASES + 1)]),
        ]);

        const answer = await readLinkedIssuesBatch(reads, numbers);

        expect(answer).toMatchObject({ ok: true });
        expect(calls).toHaveLength(2);
        const [first, second] = bodiesOf(calls);
        expect(first!.operationName).toBe("LinkedIssuesBatch");
        expect(first!.query).toContain("p0: pullRequest(number: $n0)");
        expect(first!.query).toContain("p99: pullRequest(number: $n99)");
        expect(first!.query).not.toContain("p100:");
        expect(first!.query).not.toContain(REPOSITORY.owner);
        expect(Object.keys(first!.variables)).toHaveLength(MAX_BATCH_ALIASES + 2);
        expect(first!.variables["n99"]).toBe(100);
        expect(second!.variables).toEqual({
            owner: REPOSITORY.owner,
            repo: REPOSITORY.repo,
            n0: 101,
        });
    });

    it("keeps the same-repository references and drops the rest", async () => {
        const { calls: _calls, ...reads } = context([
            batch([
                alias(34, [node(12), node(9, "someone/else")]),
                alias(35, [node(12, "HIERO-HACKERS/SDK-AUTOMATIONS")]),
            ]),
        ]);

        const answer = await readLinkedIssuesBatch(reads, [34, 35]);

        expect(answer).toEqual({
            ok: true,
            value: new Map([
                [34, [{ kind: "issue", number: 12 }]],
                [35, [{ kind: "issue", number: 12 }]],
            ]),
        });
    });

    it.each([
        ["an alias answering another pull request", batch([alias(34), alias(99)])],
        ["a missing alias", batch([alias(34)])],
        ["a node with no number", batch([alias(34), alias(35, [{ repository: {} }])])],
        ["a node from no repository", batch([alias(34), alias(35, [{ number: 1 }])])],
        ["nodes that are not a list", batch([alias(34), alias(35, {} as never)])],
        [
            "a hasNextPage that is not a boolean",
            batch([alias(34), alias(35, [], { hasNextPage: "no" })]),
        ],
        ["a body that is not JSON", () => success("not json")],
        ["a body carrying GraphQL errors", () => success('{"errors":[{"type":"OTHER"}]}')],
    ])("refuses the whole answer on %s", async (_what, step) => {
        const { calls: _calls, ...reads } = context([step]);

        const answer = await readLinkedIssuesBatch(reads, [34, 35]);

        expect(answer).toMatchObject({ ok: false, reason: "unavailable" });
    });

    it("answers a refused POST as the failure class the client reported", async () => {
        const { calls: _calls, ...reads } = context([
            failure(403, "exhausted", { "x-ratelimit-remaining": "0" }),
        ]);

        await expect(readLinkedIssuesBatch(reads, [34])).resolves.toMatchObject({
            ok: false,
            reason: "rateLimited",
        });
    });

    it("falls back to the per-item read for a pull request GitHub held pages back on", async () => {
        const { calls, ...reads } = context([
            batch([
                alias(34, [node(12)], { hasNextPage: true, endCursor: "c1" }),
                alias(35, [node(13)]),
            ]),
            page(34, [node(12), node(14)]),
        ]);

        const answer = await readLinkedIssuesBatch(reads, [34, 35]);

        expect(answer).toEqual({
            ok: true,
            value: new Map([
                [
                    34,
                    [
                        { kind: "issue", number: 12 },
                        { kind: "issue", number: 14 },
                    ],
                ],
                [35, [{ kind: "issue", number: 13 }]],
            ]),
        });
        expect(calls).toHaveLength(2);
        expect(bodiesOf(calls)[1]!.operationName).toBe("LinkedIssues");
    });

    it("refuses the whole answer when the per-item fall back cannot be read", async () => {
        const { calls: _calls, ...reads } = context([
            batch([alias(34, [node(12)], { hasNextPage: true, endCursor: "c1" })]),
            failure(500, "weather"),
        ]);

        await expect(readLinkedIssuesBatch(reads, [34])).resolves.toMatchObject({
            ok: false,
            reason: "unavailable",
        });
    });

    it("sends nothing at all for an empty list", async () => {
        const { calls, ...reads } = context([batch([])]);

        await expect(readLinkedIssuesBatch(reads, [])).resolves.toEqual({
            ok: true,
            value: new Map(),
        });
        expect(calls).toHaveLength(0);
    });
});
