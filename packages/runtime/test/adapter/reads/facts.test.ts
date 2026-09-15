/**
 * The sweep's reader, against recorded GitHub responses: one fixture per read
 * sweep.md §1 names, plus the two shapes every paged read has to survive — a
 * 304 answered from the client's own cache, and a list that runs past page one.
 *
 * The invariant under test is the honesty rule, in both of its halves. A read
 * that FAILED and a read the matrix has not CONFIRMED both leave their group
 * `UNREAD`, and neither ever contributes a shorter list — so the cases here
 * assert on the group rather than on the call, because the group is what a
 * capability sees.
 *
 * Every response below is scripted through the real client
 * (`harness.ts`'s `httpHarness`), so admission, the token, the ETag cache and
 * the failure classifier are the production ones. Nothing here reaches GitHub.
 */

import { describe, expect, it } from "vitest";
import {
    NO_CONFIG,
    parseConfigDocument,
    PRODUCERS,
    UNREAD,
    type NeededGroups,
    type RepositoryConfig,
} from "@hiero-hackers/automation-core";
import {
    CONFIRMED_SWEEP_READS,
    createFactsReader,
    readChangesRequested,
    readDraft,
    readLastCommitAt,
    readPullRequestActivity,
    readReapableSince,
    readReview,
    SWEEP_READS,
    type ClosedIssues,
    type FactsReader,
    type OpenItem,
} from "../../../src/adapter/reads/facts.js";
import {
    httpHarness,
    failure,
    installationToken,
    json,
    routed,
    success,
    TEST_REPOSITORY,
    type ResponseStep,
} from "../harness.js";

/** The instant every record here is dated at — the sweep's own clock. */
const NOW = new Date("2026-09-09T12:00:00.000Z");

const TRIAGE_LABEL = "status: triage";
const REVISION_LABEL = "status: needs revision";

function configWith(commands = '\n  commands:\n    working: "/working"'): RepositoryConfig {
    const result = parseConfigDocument(
        `schemaVersion: 1
mode: observe
mappings:
  labels:
    awaitingTriage: "${TRIAGE_LABEL}"
    needsRevision: "${REVISION_LABEL}"
${commands}
`,
        { revision: "rev-facts-1", knownCapabilities: [] },
    );
    expect(result.ok, "the suite's configuration parses").toBe(true);
    if (!result.ok) throw new Error("unreachable: asserted above");
    return result.config;
}

/** The same, for a status GitHub answers with no usable body. */
const refuses =
    (status: number, body = "no"): ResponseStep =>
    () =>
        failure(status, body);

/** The list rows the routes below answer with, and the reader turns into items. */
const ISSUE_ROW = {
    number: 12,
    state: "open",
    updated_at: "2026-09-01T09:00:00Z",
    labels: [{ name: TRIAGE_LABEL }],
    user: { login: "ada" },
    assignees: [{ login: "ada" }],
};

const PULL_ROW = {
    number: 34,
    state: "open",
    updated_at: "2026-09-02T09:00:00Z",
    labels: [],
    user: { login: "grace" },
    assignees: [{ login: "grace" }],
    pull_request: { url: "https://api.github.com/pulls/34" },
};

const ASSIGNED_ADA = {
    event: "assigned",
    assignee: { login: "ada" },
    created_at: "2026-08-01T00:00:00Z",
};

const ASSIGNED_GRACE = {
    event: "assigned",
    assignee: { login: "grace" },
    created_at: "2026-08-02T00:00:00Z",
};

const WORKING_ADA = {
    user: { login: "ada" },
    created_at: "2026-08-20T00:00:00Z",
    body: "/working on it now",
};

/** Pull request 34 closes issue 12, and closes nothing else. */
const CLOSES_12 = {
    nodes: [
        {
            number: 12,
            repository: { nameWithOwner: `${TEST_REPOSITORY.owner}/${TEST_REPOSITORY.repo}` },
        },
    ],
    pageInfo: { hasNextPage: false, endCursor: null },
};

/** That answer in whichever shape the query asked for — aliased, or one pull request. */
const linkAnswer: ResponseStep = (_url, init) =>
    success(
        JSON.stringify({
            data: {
                repository: String(init.body).includes('"LinkedIssuesBatch"')
                    ? { p0: { number: 34, closingIssuesReferences: CLOSES_12 } }
                    : {
                          nameWithOwner: `${TEST_REPOSITORY.owner}/${TEST_REPOSITORY.repo}`,
                          pullRequest: { number: 34, closingIssuesReferences: CLOSES_12 },
                      },
            },
        }),
    );

/** The whole happy repository: one issue, one pull request that closes it. */
function wholeRepository(): Readonly<Record<string, ResponseStep>> {
    return {
        "/issues?": json([ISSUE_ROW, PULL_ROW]),
        "/issues/12/timeline": json([ASSIGNED_ADA]),
        "/issues/12/comments": json([WORKING_ADA]),
        "/issues/34/timeline": json([ASSIGNED_GRACE]),
        "/issues/34/comments": json([]),
        "/graphql": linkAnswer,
    };
}

/** The pull request's own reads, answering every fact the review group folds. */
const REVIEW_ROUTES = {
    "/pulls/34/reviews": json([
        { state: "CHANGES_REQUESTED", user: { login: "linus" } },
        { state: "COMMENTED", user: { login: "linus" } },
    ]),
    "/pulls/34/commits": json([
        { commit: { committer: { date: "2026-08-30T00:00:00Z" } } },
        { commit: { committer: { date: "2026-08-28T00:00:00Z" } } },
    ]),
    "/pulls/34": json({ draft: true, created_at: "2026-08-01T00:00:00Z" }),
    "/issues/34/timeline": json([
        ASSIGNED_GRACE,
        { event: "convert_to_draft", created_at: "2026-08-25T00:00:00Z" },
        { event: "reviewed", state: "changes_requested", submitted_at: "2026-08-26T00:00:00Z" },
        {
            event: "labeled",
            label: { name: REVISION_LABEL },
            created_at: "2026-08-27T00:00:00Z",
        },
    ]),
};

interface Harness {
    readonly reader: FactsReader;
    readonly urls: () => string[];
    /** The operation each POST named, so a case can say which query was sent. */
    readonly operations: () => string[];
}

/**
 * The grants a sweep's installation actually holds. The default harness token
 * carries `issues:write` alone, and the linked-issue query is refused without
 * `pull_requests:read` — a refusal that would make every links case pass for
 * the wrong reason.
 */
const SWEEP_GRANTS = [
    {
        ok: true as const,
        token: {
            ...installationToken("sweep-token"),
            grants: ["issues:write", "pull_requests:read"] as const,
        },
    },
];

/** What a repository enabling every sweep capability needs: the whole row. */
const EVERY_GROUP: NeededGroups = PRODUCERS.sweep;

function readerOver(
    routes: Readonly<Record<string, ResponseStep>>,
    config = configWith(),
    groups: NeededGroups = EVERY_GROUP,
): Harness {
    const http = httpHarness([routed(routes)], { outcomes: SWEEP_GRANTS });
    return {
        reader: createFactsReader({
            http: http.client,
            repository: TEST_REPOSITORY,
            config,
            clock: () => NOW,
            groups,
        }),
        urls: () => http.scripted.calls.map((call) => call.url),
        operations: () =>
            http.scripted.calls
                .filter((call) => call.init.body !== undefined)
                .map(
                    (call) =>
                        (JSON.parse(String(call.init.body)) as { operationName: string })
                            .operationName,
                ),
    };
}

/** What one pull request closes, read the way the driver reads it: for the whole list. */
async function closesFor(reader: FactsReader, number: number): Promise<ClosedIssues> {
    const answered = await reader.linksFor([number]);
    return answered.get(number) ?? UNREAD;
}

/** One pull-request record, with its links read first, as the driver orders them. */
async function pullFacts(
    reader: FactsReader,
    listedItem: OpenItem,
    openIssues: readonly OpenItem[],
) {
    return reader.pullRequestFacts(
        listedItem,
        openIssues,
        await closesFor(reader, listedItem.item.number),
    );
}

/** The listed items, asserted readable so each case can index them. */
async function listed(reader: FactsReader): Promise<readonly OpenItem[]> {
    const outcome = await reader.openItems();
    expect(outcome.ok, "the open-item list was readable").toBe(true);
    if (!outcome.ok) throw new Error("unreachable: asserted above");
    return outcome.items;
}

describe("the confirmed read set", () => {
    it("names every read the matrix confirmed, which is all nine", () => {
        expect([...CONFIRMED_SWEEP_READS].sort()).toEqual(
            [
                "assignedAt",
                "changesRequested",
                "draft",
                "lastCommitAt",
                "lastWorkingAt",
                "linkedIssues",
                "linkedIssuesBatch",
                "openItems",
                "reapableSince",
            ].sort(),
        );
        expect(SWEEP_READS.filter((read) => !CONFIRMED_SWEEP_READS.includes(read))).toEqual([]);
    });
});

describe("the open-item list", () => {
    it("carries labels, state, author, assignees and updated_at, and flags a pull request", async () => {
        const { reader, urls } = readerOver(wholeRepository());

        const items = await listed(reader);

        expect(items).toEqual([
            {
                item: { kind: "issue", number: 12 },
                author: "ada",
                labels: [TRIAGE_LABEL],
                assignees: ["ada"],
                closedBy: null,
                updatedAt: new Date(ISSUE_ROW.updated_at),
            },
            {
                item: { kind: "pullRequest", number: 34 },
                author: "grace",
                labels: [],
                assignees: ["grace"],
                closedBy: null,
                updatedAt: new Date(PULL_ROW.updated_at),
            },
        ]);
        expect(urls()[0]).toContain("state=open");
        expect(urls()[0]).toContain("per_page=100");
    });

    it("walks to the last page the link header names", async () => {
        const second = { ...ISSUE_ROW, number: 99, assignees: [] };
        const { reader, urls } = readerOver({
            "&page=1": json([ISSUE_ROW], {
                link: '<https://api.github.com/x?page=2>; rel="next", <https://api.github.com/x?page=2>; rel="last"',
            }),
            "&page=2": json([second]),
        });

        const items = await listed(reader);

        expect(items.map(({ item }) => item.number)).toEqual([12, 99]);
        expect(urls()).toHaveLength(2);
    });

    it("walks on through a next-only header, the shape cursor pagination sends", async () => {
        const { reader, urls } = readerOver({
            "&page=1": json([ISSUE_ROW], {
                link: '<https://api.github.com/x?after=c1>; rel="next"',
            }),
            "&page=2": json([{ ...ISSUE_ROW, number: 98, assignees: [] }], {
                link: '<https://api.github.com/x?after=c2>; rel="next"',
            }),
            "&page=3": json([{ ...ISSUE_ROW, number: 99, assignees: [] }], {
                link: '<https://api.github.com/x?page=2>; rel="prev"',
            }),
        });

        const items = await listed(reader);

        expect(items.map(({ item }) => item.number)).toEqual([12, 98, 99]);
        expect(urls()).toHaveLength(3);
    });

    it("is unread when a next-only list runs past the walk's bound", async () => {
        const { reader, urls } = readerOver({
            "/issues?": json([ISSUE_ROW], {
                link: '<https://api.github.com/x?after=c>; rel="next"',
            }),
        });

        await expect(reader.openItems()).resolves.toEqual({
            ok: false,
            detail: "the open-item list: the list is longer than 10 pages",
        });
        expect(urls()).toHaveLength(10);
    });

    it.each([
        ["a body that is not an array", json({ message: "nope" })],
        ["a refusal", refuses(500, "boom")],
    ])("is unusable on %s", async (_what, step) => {
        const { reader } = readerOver({ "/issues?": step });

        const outcome = await reader.openItems();

        expect(outcome.ok).toBe(false);
    });

    it("is unusable when one row cannot be read, rather than shorter", async () => {
        const { reader } = readerOver({
            "/issues?": json([ISSUE_ROW, { ...PULL_ROW, labels: [{ name: 7 }] }]),
        });

        await expect(reader.openItems()).resolves.toEqual({
            ok: false,
            detail: "the open-item list carried an unreadable item",
        });
    });

    it("spends no second call when GitHub answers a repeat read 304", async () => {
        const http = httpHarness([
            success(JSON.stringify([ISSUE_ROW]), { etag: 'W/"list-1"' }),
            new Response(null, { status: 304 }),
        ]);
        const reader = createFactsReader({
            http: http.client,
            repository: TEST_REPOSITORY,
            config: configWith(),
            clock: () => NOW,
            groups: EVERY_GROUP,
        });

        const first = await listed(reader);
        const again = await listed(reader);

        expect(again).toEqual(first);
        expect(new Headers(http.scripted.calls[1]!.init.headers).get("if-none-match")).toBe(
            'W/"list-1"',
        );
    });
});

describe("the assignees group", () => {
    it("dates each assignment from the timeline and each reset from the comments", async () => {
        const { reader } = readerOver(wholeRepository());
        const items = await listed(reader);

        const record = await reader.issueFacts(items[0]!, []);

        expect(record.assignees).toEqual([
            {
                login: "ada",
                assignedAt: new Date(ASSIGNED_ADA.created_at),
                lastWorkingAt: new Date(WORKING_ADA.created_at),
            },
        ]);
        expect(record.trigger).toEqual({ kind: "sweep" });
        expect(record.observedAt).toEqual(NOW);
    });

    it("keeps the NEWEST assignment per login, not the first", async () => {
        const { reader } = readerOver({
            ...wholeRepository(),
            "/issues/12/timeline": json([
                { ...ASSIGNED_ADA, created_at: "2026-07-01T00:00:00Z" },
                ASSIGNED_ADA,
                { event: "labeled", created_at: "2026-09-01T00:00:00Z" },
            ]),
        });
        const items = await listed(reader);

        const record = await reader.issueFacts(items[0]!, []);

        expect(record.assignees).toMatchObject([{ assignedAt: new Date(ASSIGNED_ADA.created_at) }]);
    });

    it("counts a `/working` only as a comment's FIRST token", async () => {
        const { reader } = readerOver({
            ...wholeRepository(),
            "/issues/12/comments": json([
                { ...WORKING_ADA, body: "I am still /working on this" },
                { ...WORKING_ADA, body: "" },
            ]),
        });
        const items = await listed(reader);

        const record = await reader.issueFacts(items[0]!, []);

        expect(record.assignees).toMatchObject([{ lastWorkingAt: null }]);
    });

    it("reads no comment page at all when the repository maps no `working` spelling", async () => {
        const { reader, urls } = readerOver(wholeRepository(), configWith(""));
        const items = await listed(reader);

        const record = await reader.issueFacts(items[0]!, []);

        expect(record.assignees).toMatchObject([{ lastWorkingAt: null }]);
        expect(urls().some((url) => url.includes("/comments"))).toBe(false);
    });

    it.each([
        ["the timeline refuses", { "/issues/12/timeline": refuses(403) }],
        ["the comments refuse", { "/issues/12/comments": refuses(403) }],
        ["an assignee has no assignment event", { "/issues/12/timeline": json([]) }],
        [
            "an assigned event names nobody",
            {
                "/issues/12/timeline": json([
                    { event: "assigned", created_at: "2026-08-01T00:00:00Z" },
                ]),
            },
        ],
        [
            "a comment has no author",
            { "/issues/12/comments": json([{ created_at: "2026-08-01T00:00:00Z", body: "hi" }]) },
        ],
        [
            "the timeline is longer than a walk may cover",
            {
                "/issues/12/timeline": json([ASSIGNED_ADA], {
                    link: '<https://api.github.com/x?page=11>; rel="last"',
                }),
            },
        ],
    ])("goes unread when %s", async (_what, override) => {
        const { reader } = readerOver({ ...wholeRepository(), ...override });
        const items = await listed(reader);

        const record = await reader.issueFacts(items[0]!, []);

        expect(record.assignees).toBe(UNREAD);
    });
});

describe("the links group", () => {
    it("joins a pull request's closing references to the issues already listed", async () => {
        const { reader } = readerOver(wholeRepository());
        const items = await listed(reader);

        const record = await pullFacts(reader, items[1]!, [items[0]!]);

        expect(record.links).toEqual({
            issues: [
                {
                    item: { kind: "issue", number: 12 },
                    assignees: [
                        {
                            login: "ada",
                            assignedAt: new Date(ASSIGNED_ADA.created_at),
                            lastWorkingAt: new Date(WORKING_ADA.created_at),
                        },
                    ],
                },
            ],
        });
    });

    it("drops a reference to an issue this sweep did not list, rather than reading it", async () => {
        const { reader, urls } = readerOver(wholeRepository());
        const items = await listed(reader);

        const record = await pullFacts(reader, items[1]!, []);

        expect(record.links).toEqual({ issues: [] });
        expect(urls().some((url) => url.includes("/issues/12/"))).toBe(false);
    });

    it("goes unread when the query cannot be answered", async () => {
        const { reader } = readerOver({ ...wholeRepository(), "/graphql": refuses(502) });
        const items = await listed(reader);

        const record = await pullFacts(reader, items[1]!, [items[0]!]);

        expect(record.links).toBe(UNREAD);
    });

    it("reads every listed pull request in one POST, and sends none when nobody needs links", async () => {
        const { reader, operations } = readerOver(wholeRepository());
        const unneeded = readerOver(wholeRepository(), configWith(), {
            issue: [],
            pullRequest: ["review"],
        });
        await listed(reader);

        const answered = await reader.linksFor([34]);
        const asked = await unneeded.reader.linksFor([34]);

        expect([...answered.keys()]).toEqual([34]);
        expect(answered.get(34)).toEqual([{ kind: "issue", number: 12 }]);
        expect(operations()).toEqual(["LinkedIssuesBatch"]);
        expect(asked.get(34)).toBe(UNREAD);
        expect(unneeded.urls().some((url) => url.endsWith("/graphql"))).toBe(false);
    });

    it("answers every pull request unread when the batch refused", async () => {
        const { reader } = readerOver({ ...wholeRepository(), "/graphql": refuses(502) });
        await listed(reader);

        const answered = await reader.linksFor([34, 35]);

        expect([...answered.values()]).toEqual([UNREAD, UNREAD]);
    });

    it("takes an issue's open pull requests from the driver, unread and all", async () => {
        const { reader } = readerOver(wholeRepository());
        const items = await listed(reader);

        const withLinks = await reader.issueFacts(items[0]!, [{ kind: "pullRequest", number: 34 }]);
        const withoutLinks = await reader.issueFacts(items[0]!, UNREAD);

        expect(withLinks.links).toEqual({
            openPullRequests: [{ kind: "pullRequest", number: 34 }],
        });
        expect(withoutLinks.links).toBe(UNREAD);
    });

    it("reads one item's clocks once, however many records name it", async () => {
        const { reader, urls } = readerOver(wholeRepository());
        const items = await listed(reader);

        await pullFacts(reader, items[1]!, [items[0]!]);
        await reader.issueFacts(items[0]!, []);

        expect(urls().filter((url) => url.includes("/issues/12/timeline"))).toHaveLength(1);
    });
});

describe("the review group — the three reads protocol 6.9 confirmed", () => {
    const context = (routes: Readonly<Record<string, ResponseStep>> = REVIEW_ROUTES) => ({
        http: httpHarness([routed(routes)], { outcomes: SWEEP_GRANTS }).client,
        repository: TEST_REPOSITORY,
        config: NO_CONFIG,
    });

    it("is READ on a pull-request record, now that all three reads are confirmed", async () => {
        const { reader } = readerOver({ ...wholeRepository(), ...REVIEW_ROUTES });
        const items = await listed(reader);

        const record = await pullFacts(reader, items[1]!, [items[0]!]);

        expect(record.review).not.toBe(UNREAD);
        expect(record.review).toEqual({
            changesRequested: true,
            reapableSince: {
                needsRevision: new Date("2026-08-27T00:00:00Z"),
                changesRequested: new Date("2026-08-26T00:00:00Z"),
                draft: new Date("2026-08-25T00:00:00Z"),
            },
            lastCommitAt: new Date("2026-08-30T00:00:00Z"),
        });
    });

    it("reads all three facts when asked directly", async () => {
        await expect(readReview(context(), 34)).resolves.toEqual({
            ok: true,
            value: {
                changesRequested: true,
                reapableSince: {
                    needsRevision: new Date("2026-08-01T00:00:00Z"),
                    changesRequested: new Date("2026-08-26T00:00:00Z"),
                    draft: new Date("2026-08-25T00:00:00Z"),
                },
                lastCommitAt: new Date("2026-08-30T00:00:00Z"),
            },
        });
    });

    it("folds each reviewer to their latest DECIDING state, ignoring comments", async () => {
        const dismissed = {
            "/pulls/34/reviews": json([
                { state: "CHANGES_REQUESTED", user: { login: "linus" } },
                { state: "DISMISSED", user: { login: "linus" } },
            ]),
        };
        await expect(readChangesRequested(context(dismissed), 34)).resolves.toEqual({
            ok: true,
            value: false,
        });
    });

    it("dates a pull request nobody reviewed from the moment it opened", async () => {
        const untouched = {
            "/pulls/34": json({ draft: false, created_at: "2026-08-01T00:00:00Z" }),
            "/issues/34/timeline": json([{ event: "labeled", created_at: "2026-08-30T00:00:00Z" }]),
        };
        await expect(readReapableSince(context(untouched), 34)).resolves.toEqual({
            ok: true,
            value: {
                needsRevision: new Date("2026-08-01T00:00:00Z"),
                changesRequested: new Date("2026-08-01T00:00:00Z"),
                draft: new Date("2026-08-01T00:00:00Z"),
            },
        });
    });

    it("answers a commitless pull request `null` rather than unread", async () => {
        await expect(
            readLastCommitAt(context({ "/pulls/34/commits": json([]) }), 34),
        ).resolves.toEqual({
            ok: true,
            value: null,
        });
    });

    it("reads the newest commit or `/working` as current pull-request activity", async () => {
        const routes = {
            "/pulls/34/commits": json([
                { commit: { committer: { date: "2026-08-28T00:00:00Z" } } },
            ]),
            "/issues/34/comments": json([
                {
                    user: { login: "linus" },
                    created_at: "2026-08-30T00:00:00Z",
                    body: "/working",
                },
            ]),
        };

        await expect(readPullRequestActivity(context(routes), 34, "/working")).resolves.toEqual({
            ok: true,
            value: new Date("2026-08-30T00:00:00Z"),
        });
    });

    it.each([
        ["a draft that is not a boolean", { "/pulls/34": json({ draft: "yes" }) }],
        ["a review with no state", { "/pulls/34/reviews": json([{ user: { login: "l" } }]) }],
        ["an undated mode event", { "/issues/34/timeline": json([{ event: "convert_to_draft" }]) }],
        ["an undated commit", { "/pulls/34/commits": json([{ commit: {} }]) }],
        ["a pull request that is not an object", { "/pulls/34": json([]) }],
        ["a pull request with no created_at", { "/pulls/34": json({ draft: false }) }],
    ])("refuses %s", async (_what, override) => {
        const outcome = await readReview(context({ ...REVIEW_ROUTES, ...override }), 34);

        expect(outcome.ok).toBe(false);
    });

    it("refuses a pull request read that GitHub declined", async () => {
        await expect(readDraft(context({ "/pulls/34": refuses(403) }), 34)).resolves.toEqual({
            ok: false,
            detail: "#34 pull request: forbiddenUnrecognized",
        });
    });
});

describe("what one cold item sends", () => {
    const REPO = `/repos/${TEST_REPOSITORY.owner}/${TEST_REPOSITORY.repo}`;

    /** Every send after the open-item list, as the path it asked GitHub for. */
    const walked = (urls: () => string[], after: number): string[] =>
        urls()
            .slice(after)
            .map((url) => new URL(url).pathname);

    /** The whole repository with the pull request's own reads answering too. */
    const coldRepository = () => ({ ...wholeRepository(), ...REVIEW_ROUTES });

    it("reads an issue's timeline, then its comments", async () => {
        const { reader, urls } = readerOver(coldRepository());
        const items = await listed(reader);
        const listCalls = urls().length;

        const record = await reader.issueFacts(items[0]!, []);

        expect(record.assignees).not.toBe(UNREAD);
        expect(walked(urls, listCalls)).toEqual([
            `${REPO}/issues/12/timeline`,
            `${REPO}/issues/12/comments`,
        ]);
    });

    it("reads an issue's timeline alone when the repository maps no `working`", async () => {
        const { reader, urls } = readerOver(coldRepository(), configWith(""));
        const items = await listed(reader);
        const listCalls = urls().length;

        const record = await reader.issueFacts(items[0]!, []);

        expect(record.assignees).not.toBe(UNREAD);
        expect(walked(urls, listCalls)).toEqual([`${REPO}/issues/12/timeline`]);
    });

    it("reads a pull request in five: timeline, comments, reviews, pull, commits", async () => {
        const { reader, urls } = readerOver(coldRepository());
        const items = await listed(reader);
        const closes = await closesFor(reader, 34);
        const listCalls = urls().length;

        const record = await reader.pullRequestFacts(items[1]!, [], closes);

        for (const group of [record.assignees, record.links, record.review, record.readiness]) {
            expect(group).not.toBe(UNREAD);
        }
        // The links arrived with the list, so the record itself sends no POST.
        expect(walked(urls, listCalls)).toEqual([
            `${REPO}/issues/34/timeline`,
            `${REPO}/issues/34/comments`,
            `${REPO}/pulls/34/reviews`,
            `${REPO}/pulls/34`,
            `${REPO}/pulls/34/commits`,
        ]);
    });

    /**
     * The read table by enabled set (D195): a repository whose only sweep
     * capability needs `review` pays for the three reads that group folds and
     * for nothing else — its issues cost no call at all.
     */
    it("sends the review reads alone, and nothing for an issue, for a `review`-only set", async () => {
        const { reader, urls } = readerOver(coldRepository(), configWith(), {
            issue: [],
            pullRequest: ["review"],
        });
        const items = await listed(reader);
        const listCalls = urls().length;

        const pull = await pullFacts(reader, items[1]!, [items[0]!]);
        const issue = await reader.issueFacts(items[0]!, [items[1]!.item]);

        expect(pull.review).not.toBe(UNREAD);
        for (const group of [pull.assignees, pull.links, pull.readiness]) {
            expect(group).toBe(UNREAD);
        }
        expect(issue.assignees).toBe(UNREAD);
        expect(issue.links).toBe(UNREAD);
        expect(walked(urls, listCalls)).toEqual([
            `${REPO}/pulls/34/reviews`,
            `${REPO}/pulls/34`,
            `${REPO}/issues/34/timeline`,
            `${REPO}/pulls/34/commits`,
        ]);
    });

    /**
     * A stored read stands in for the reads that made it (D193). The record is built
     * where a read one is, so it carries this sweep's instant and the list's own fields.
     */
    it("takes a record's groups from a stored read, and sends nothing for them", async () => {
        const { reader, urls } = readerOver(coldRepository());
        const items = await listed(reader);
        const listCalls = urls().length;
        const clocks = [
            {
                login: "ada",
                assignedAt: new Date("2026-07-01T00:00:00Z"),
                lastWorkingAt: null,
            },
        ];

        const issue = await reader.issueFacts(items[0]!, [], { assignees: clocks });
        const pull = await reader.pullRequestFacts(items[1]!, [], UNREAD, {
            assignees: clocks,
            links: { issues: [] },
            review: UNREAD,
            readiness: { draft: true },
        });

        expect(walked(urls, listCalls)).toEqual([]);
        expect(issue.assignees).toEqual(clocks);
        expect(pull).toMatchObject({
            item: { kind: "pullRequest", number: 34 },
            observedAt: NOW,
            trigger: { kind: "sweep" },
            author: "grace",
            links: { issues: [] },
            review: UNREAD,
            readiness: { draft: true },
        });
    });

    it("reads a pull request in four when the repository maps no `working`", async () => {
        const { reader, urls } = readerOver(coldRepository(), configWith(""));
        const items = await listed(reader);
        const closes = await closesFor(reader, 34);
        const listCalls = urls().length;

        const record = await reader.pullRequestFacts(items[1]!, [], closes);

        expect(record.review).not.toBe(UNREAD);
        expect(walked(urls, listCalls)).toEqual([
            `${REPO}/issues/34/timeline`,
            `${REPO}/pulls/34/reviews`,
            `${REPO}/pulls/34`,
            `${REPO}/pulls/34/commits`,
        ]);
    });
});

describe("the projection", () => {
    it("is the mapped meanings of the labels the list carried", async () => {
        const { reader } = readerOver(wholeRepository());
        const items = await listed(reader);

        const issue = await reader.issueFacts(items[0]!, []);
        const pull = await pullFacts(reader, items[1]!, []);

        expect(issue.position).toEqual({
            kind: "position",
            state: { meaning: "awaitingTriage", blocked: false, closedBy: null },
            ignored: [],
        });
        expect(pull.position).toMatchObject({ kind: "position", state: { meaning: null } });
    });

    it("carries the closure the list reported rather than assuming it open", async () => {
        const { reader } = readerOver({
            ...wholeRepository(),
            "/issues?": json([{ ...ISSUE_ROW, state: "closed" }]),
        });
        const items = await listed(reader);

        const record = await reader.issueFacts(items[0]!, []);

        expect(record.position).toMatchObject({ state: { closedBy: "closedByHuman" } });
    });
});
