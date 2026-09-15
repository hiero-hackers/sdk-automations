/**
 * The four resolvers the study's capabilities ask about an ITEM: counting a
 * contributor's open claims, reading who holds one item, reading a pull
 * request's commits, and asking whether it merges cleanly.
 *
 * The subject that runs through every case is the matrix gate, and since
 * protocol 6.9 all four are through it: `GET /repos/{o}/{r}/issues/{n}` for
 * `assigneesOf` and `GET /repos/{o}/{r}/pulls/{n}/commits` for
 * `commitAttestations` are rows in
 * `design/findings/endpoint-permission-matrix.md` now. So each reader is tested
 * by number, and each is tested again through the dispatch, which is the only
 * place the item's KIND is judged — an `assigneesOf` about a pull request is
 * refused, because the cited row is the issue's.
 */

import type { AdmittedCapability, PermissionGrant } from "@hiero-hackers/automation-core";
import { describe, expect, it } from "vitest";
import {
    CONFIRMED_RESOLVER_READS,
    createResolverSource,
    readAssigneesOf,
    readCommitAttestations,
} from "../../../src/adapter/reads/resolvers.js";
import { parseConfigDocument, type RepositoryConfig } from "@hiero-hackers/automation-core";
import { createAllowance, type Allowance } from "../../../src/adapter/client/allowance.js";
import { failure, httpHarness, installationToken, success, type ResponseStep } from "../harness.js";

const REPOSITORY = { owner: "Hiero-Hackers", repo: "SDK-Automations" } as const;
const GRANTS = ["issues:read"] as const;
const ITEM = { kind: "issue", number: 7 } as const;
const PULL = { kind: "pullRequest", number: 34 } as const;

/** The two label meanings the assignments below are projected through. */
function configWith(): RepositoryConfig {
    const result = parseConfigDocument(
        `schemaVersion: 1
mode: observe
mappings:
  labels:
    ready: "status: ready for dev"
    needsReview: "status: needs review"
`,
        { revision: "rev-assignment-1", knownCapabilities: [] },
    );
    expect(result.ok, "the suite's configuration parses").toBe(true);
    if (!result.ok) throw new Error("unreachable: asserted above");
    return result.config;
}

const CONFIG = configWith();

/** No declarations: nothing in this file asks the resolver that reads them. */
const KNOWN: readonly AdmittedCapability[] = [];

function source(
    steps: readonly ResponseStep[],
    grants: readonly PermissionGrant[] = GRANTS,
    allowance?: Allowance,
) {
    const harness = httpHarness(steps, {
        outcomes: [{ ok: true, token: { ...installationToken("resolver-token"), grants } }],
    });
    return {
        resolve: createResolverSource({
            http: harness.client,
            repository: REPOSITORY,
            config: CONFIG,
            knownCapabilities: KNOWN,
            ...(allowance === undefined ? {} : { allowance }),
        }),
        calls: harness.scripted.calls,
    };
}

/** One item as `GET /repos/{o}/{r}/issues` carries it. */
const listed = (
    number: number,
    labels: readonly string[] = [],
    assignees: readonly string[] = ["alice"],
) => ({
    number,
    labels: labels.map((name) => ({ name })),
    assignees: assignees.map((login) => ({ login })),
});

const list = (items: readonly unknown[], headers?: Record<string, string>) =>
    success(JSON.stringify(items), headers);

describe("the matrix gate over the resolver surface", () => {
    it("names every read the matrix confirmed, which since 6.9 is all seven", () => {
        expect([...CONFIRMED_RESOLVER_READS].sort()).toEqual([
            "assigneesOf",
            "commitAttestations",
            "configAtHead",
            "isAutomationActor",
            "linkedIssues",
            "mergeability",
            "openAssignments",
        ]);
    });

    it.each([
        ["assigneesOf", { item: PULL }, "assigneesOf requires a valid issue item"],
        [
            "commitAttestations",
            { item: ITEM },
            "commitAttestations requires a valid pull request item",
        ],
    ] as const)(
        "refuses %s an item of the wrong kind, and sends nothing",
        async (query, input, detail) => {
            const { resolve, calls } = source([]);

            expect(await resolve(query, input)).toEqual({
                ok: false,
                reason: "unavailable",
                detail,
            });
            expect(calls).toHaveLength(0);
        },
    );
});

describe("openAssignments", () => {
    it("answers each open assignment with the meanings its labels projected to", async () => {
        const { resolve, calls } = source([
            list([listed(11, ["status: ready for dev"]), listed(12, ["status: needs review"])]),
        ]);

        expect(await resolve("openAssignments", { login: "alice" })).toEqual({
            ok: true,
            value: [
                { item: { kind: "issue", number: 11 }, meanings: ["ready"] },
                { item: { kind: "issue", number: 12 }, meanings: ["needsReview"] },
            ],
        });
        expect(calls[0]?.url).toContain("assignee=alice");
        expect(calls[0]?.url).toContain("state=open");
    });

    it("drops an unmapped label rather than inventing a meaning for it", async () => {
        const { resolve } = source([list([listed(11, ["good first issue"])])]);

        expect(await resolve("openAssignments", { login: "alice" })).toEqual({
            ok: true,
            value: [{ item: { kind: "issue", number: 11 }, meanings: [] }],
        });
    });

    it("re-checks the filter: an item that does not carry the login does not count", async () => {
        const { resolve } = source([list([listed(11, [], ["bob"]), listed(12)])]);

        expect(await resolve("openAssignments", { login: "alice" })).toMatchObject({
            ok: true,
            value: [{ item: { number: 12 } }],
        });
    });

    it("a pull request in the same list is not an issue claim", async () => {
        const { resolve } = source([
            list([
                { ...listed(11), pull_request: { url: "https://api.github.com/x" } },
                listed(12),
            ]),
        ]);

        expect(await resolve("openAssignments", { login: "alice" })).toMatchObject({
            ok: true,
            value: [{ item: { number: 12 } }],
        });
    });

    it("gives up rather than answering a list longer than the walk", async () => {
        const { resolve, calls } = source([
            list([listed(11)], {
                link: '<https://api.github.com/x?page=11>; rel="last"',
            }),
            ...Array.from({ length: 9 }, () => list([listed(12)])),
        ]);

        expect(await resolve("openAssignments", { login: "alice" })).toEqual({
            ok: false,
            reason: "unavailable",
            detail: "GitHub assignment pagination exceeded 10 pages",
        });
        expect(calls).toHaveLength(10);
    });

    it("walks every page the link header names", async () => {
        const { resolve, calls } = source([
            list([listed(11)], {
                link: '<https://api.github.com/x?page=2>; rel="next", <https://api.github.com/x?page=2>; rel="last"',
            }),
            list([listed(12)]),
        ]);

        expect(await resolve("openAssignments", { login: "alice" })).toMatchObject({
            ok: true,
            value: [{ item: { number: 11 } }, { item: { number: 12 } }],
        });
        expect(calls).toHaveLength(2);
    });

    it("walks on through next-only headers, the shape cursor pagination sends", async () => {
        const { resolve, calls } = source([
            list([listed(11)], { link: '<https://api.github.com/x?after=c1>; rel="next"' }),
            list([listed(12)], { link: '<https://api.github.com/x?after=c2>; rel="next"' }),
            list([listed(13)], { link: '<https://api.github.com/x?page=2>; rel="prev"' }),
        ]);

        expect(await resolve("openAssignments", { login: "alice" })).toMatchObject({
            ok: true,
            value: [{ item: { number: 11 } }, { item: { number: 12 } }, { item: { number: 13 } }],
        });
        expect(calls).toHaveLength(3);
    });

    it("gives up on a next-only list that runs past the walk", async () => {
        const { resolve, calls } = source([
            () =>
                success(JSON.stringify([listed(11)]), {
                    link: '<https://api.github.com/x?after=c>; rel="next"',
                }),
        ]);

        expect(await resolve("openAssignments", { login: "alice" })).toEqual({
            ok: false,
            reason: "unavailable",
            detail: "GitHub assignment pagination exceeded 10 pages",
        });
        expect(calls).toHaveLength(10);
    });

    it.each([
        ["a body that is not an array", success('{"not":"an array"}')],
        ["an item with no number", list([{ labels: [], assignees: [] }])],
        ["an item whose labels are not a list", list([{ number: 1, assignees: [] }])],
        ["a label with no name", list([{ number: 1, labels: [{}], assignees: [] }])],
        ["an assignee that is not a record", list([{ number: 1, labels: [], assignees: [7] }])],
    ])("refuses %s rather than answering a shorter list", async (_what, response) => {
        const { resolve } = source([response]);

        expect(await resolve("openAssignments", { login: "alice" })).toMatchObject({
            ok: false,
            reason: "unavailable",
        });
    });

    it("a rate limit is a rate limit, never an empty list", async () => {
        const { resolve } = source([
            failure(403, '{"message":"rate limit"}', {
                "x-ratelimit-remaining": "0",
                "x-ratelimit-reset": "9999999999",
            }),
        ]);

        expect(await resolve("openAssignments", { login: "alice" })).toMatchObject({
            ok: false,
            reason: "rateLimited",
        });
    });

    it("refuses a login it cannot read", async () => {
        const { resolve, calls } = source([]);

        expect(await resolve("openAssignments", { login: "" })).toMatchObject({
            ok: false,
            reason: "unavailable",
        });
        expect(calls).toHaveLength(0);
    });
});

// ─── The item reads ──────────────────────────────────────────────────

const ISSUE = { kind: "issue", number: 1632 } as const;

/** The reader's own seam, for the two reads the matrix has not confirmed. */
function reader(steps: readonly ResponseStep[]) {
    const harness = httpHarness(steps, {
        outcomes: [{ ok: true, token: { ...installationToken("resolver-token"), grants: GRANTS } }],
    });
    return {
        options: {
            http: harness.client,
            repository: REPOSITORY,
            config: CONFIG,
            knownCapabilities: KNOWN,
        },
        urls: () => harness.scripted.calls.map((call) => call.url),
    };
}

const commitRow = (over: Record<string, unknown> = {}) => ({
    sha: "abc1234def",
    parents: [{ sha: "0000000" }],
    commit: {
        message: "fix: handle empty payload\n\nSigned-off-by: Ada <ada@example.com>",
        verification: { verified: true },
    },
    ...over,
});

describe("mergeability", () => {
    it("answers what GitHub computed, for the pull request it was asked about", async () => {
        const { resolve, calls } = source([
            success(JSON.stringify({ number: 34, mergeable: false })),
        ]);

        expect(await resolve("mergeability", { item: PULL })).toEqual({ ok: true, value: false });
        expect(calls[0]?.url).toBe(
            "https://api.github.com/repos/Hiero-Hackers/SDK-Automations/pulls/34",
        );
    });

    it.each([
        ["a mergeability GitHub has not finished computing", { number: 34, mergeable: null }],
        ["an answer about a different pull request", { number: 999, mergeable: true }],
    ])("refuses %s", async (_what, body) => {
        const { resolve } = source([success(JSON.stringify(body))]);

        expect(await resolve("mergeability", { item: PULL })).toMatchObject({
            ok: false,
            reason: "unavailable",
        });
    });

    it("refuses a body that is not a JSON object", async () => {
        const { resolve } = source([success("[]")]);

        expect(await resolve("mergeability", { item: PULL })).toMatchObject({ ok: false });
    });

    it("refuses an input naming the wrong kind of item, and sends nothing", async () => {
        const { resolve, calls } = source([]);

        expect(await resolve("mergeability", { item: ISSUE })).toMatchObject({
            ok: false,
            reason: "unavailable",
        });
        expect(calls).toHaveLength(0);
    });

    it("carries a refused call through as the resolver's own failure", async () => {
        const { resolve } = source([failure(403, "no")]);

        expect(await resolve("mergeability", { item: PULL })).toMatchObject({ ok: false });
    });
});

/**
 * What a capability is told when this lane's own share is gone, rather than
 * GitHub's: `unavailable`, naming the instant the pool the client refused on
 * resets — the allowance was told that instant by GitHub's own headers (D192).
 */
describe("a read the lane's allowance refuses", () => {
    /** GitHub's own limit for the pool, set to one so the second read is past the share. */
    const RESET_SECONDS = 1_787_300_060;
    const ONE_REQUEST = {
        "x-ratelimit-limit": "1",
        "x-ratelimit-reset": String(RESET_SECONDS),
    };

    it("answers unavailable with the pool's own reset, having sent nothing", async () => {
        const allowance = createAllowance({ share: 1 });
        const { resolve, calls } = source(
            [success(JSON.stringify({ number: 34, mergeable: true }), ONE_REQUEST)],
            GRANTS,
            allowance,
        );

        expect(await resolve("mergeability", { item: PULL })).toEqual({ ok: true, value: true });
        expect(await resolve("mergeability", { item: PULL })).toEqual({
            ok: false,
            reason: "unavailable",
            detail:
                "this lane's core allowance is spent; the pool resets at " +
                new Date(RESET_SECONDS * 1_000).toISOString(),
        });
        expect(calls).toHaveLength(1);
        expect(allowance.lastRefusal()).toMatchObject({ lane: "core" });
    });

    /** Before any response, the allowance knows no window and says so rather than inventing one. */
    it("says GitHub named no instant when no response has carried one", async () => {
        const allowance = createAllowance({ share: 0.0001 });
        const { resolve, calls } = source([success("{}")], GRANTS, allowance);

        expect(await resolve("mergeability", { item: PULL })).toEqual({
            ok: false,
            reason: "unavailable",
            detail:
                "this lane's core allowance is spent; the pool resets at " +
                "an instant GitHub has not reported",
        });
        expect(calls).toHaveLength(0);
    });
});

describe("the commit reader", () => {
    it("reads sha, subject, sign-off, signature and merge-ness", async () => {
        const { options, urls } = reader([
            success(
                JSON.stringify([
                    commitRow(),
                    commitRow({
                        sha: "999",
                        parents: [{ sha: "a" }, { sha: "b" }],
                        commit: { message: "Merge branch 'main'", verification: {} },
                    }),
                ]),
            ),
        ]);

        expect(await readCommitAttestations(options, 136)).toEqual({
            ok: true,
            value: [
                {
                    sha: "abc1234def",
                    summary: "fix: handle empty payload",
                    signedOff: true,
                    verified: true,
                    merge: false,
                },
                {
                    sha: "999",
                    summary: "Merge branch 'main'",
                    signedOff: false,
                    verified: false,
                    merge: true,
                },
            ],
        });
        expect(urls()[0]).toContain("/pulls/136/commits?per_page=100&page=1");
    });

    it("walks pages until one comes back short", async () => {
        const full = JSON.stringify(Array.from({ length: 100 }, () => commitRow()));
        const { options, urls } = reader([success(full), success(JSON.stringify([commitRow()]))]);

        const answer = await readCommitAttestations(options, 136);

        expect(answer.ok && answer.value).toHaveLength(101);
        expect(urls()).toHaveLength(2);
    });

    it("refuses a list that reached GitHub's own 250-commit ceiling", async () => {
        const full = JSON.stringify(Array.from({ length: 100 }, () => commitRow()));
        const half = JSON.stringify(Array.from({ length: 50 }, () => commitRow()));
        const { options } = reader([success(full), success(full), success(half)]);

        expect(await readCommitAttestations(options, 136)).toMatchObject({
            ok: false,
            reason: "unavailable",
            detail: expect.stringContaining("reached that limit"),
        });
    });

    it.each([
        ["a body that is not an array", "{}"],
        ["a commit with no sha", JSON.stringify([commitRow({ sha: "" })])],
        ["a commit with no message", JSON.stringify([commitRow({ commit: {} })])],
        ["a commit with no parent list", JSON.stringify([commitRow({ parents: "none" })])],
    ])("refuses %s", async (_what, body) => {
        const { options } = reader([success(body)]);

        expect(await readCommitAttestations(options, 136)).toMatchObject({ ok: false });
    });

    it("carries a refused call through as the resolver's own failure", async () => {
        const { options } = reader([failure(403, "no")]);

        expect(await readCommitAttestations(options, 136)).toMatchObject({ ok: false });
    });

    it("is reachable through the dispatch, which sends the item's number", async () => {
        const { resolve, calls } = source([success(JSON.stringify([commitRow()]))]);

        expect(await resolve("commitAttestations", { item: PULL })).toMatchObject({
            ok: true,
            value: [{ sha: "abc1234def", signedOff: true, verified: true, merge: false }],
        });
        expect(calls[0]?.url).toContain(`/pulls/${String(PULL.number)}/commits`);
    });
});

describe("the assignee reader", () => {
    it("answers the logins on the issue it was asked about", async () => {
        const { options, urls } = reader([
            success(
                JSON.stringify({ number: 1632, assignees: [{ login: "ada" }, { login: "grace" }] }),
            ),
        ]);

        expect(await readAssigneesOf(options, 1632)).toEqual({
            ok: true,
            value: ["ada", "grace"],
        });
        expect(urls()[0]).toBe(
            "https://api.github.com/repos/Hiero-Hackers/SDK-Automations/issues/1632",
        );
    });

    it.each([
        ["an answer about a different issue", JSON.stringify({ number: 9, assignees: [] })],
        ["a body that is not an object", "[]"],
        ["an assignee list that is not a list", JSON.stringify({ number: 1632, assignees: 1 })],
        ["an assignee with no login", JSON.stringify({ number: 1632, assignees: [{ login: "" }] })],
    ])("refuses %s", async (_what, body) => {
        const { options } = reader([success(body)]);

        expect(await readAssigneesOf(options, 1632)).toMatchObject({ ok: false });
    });

    it("carries a refused call through as the resolver's own failure", async () => {
        const { options } = reader([failure(403, "no")]);

        expect(await readAssigneesOf(options, 1632)).toMatchObject({ ok: false });
    });

    it("is reachable through the dispatch, which sends the item's number", async () => {
        const { resolve, calls } = source([
            success(JSON.stringify({ number: ITEM.number, assignees: [{ login: "alice" }] })),
        ]);

        expect(await resolve("assigneesOf", { item: ITEM })).toEqual({
            ok: true,
            value: ["alice"],
        });
        expect(calls[0]?.url).toContain(`/issues/${String(ITEM.number)}`);
    });
});
