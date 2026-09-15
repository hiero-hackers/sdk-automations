/**
 * Every producer reads exactly the groups its registry row names — asked once,
 * generically over `PRODUCERS`, for every producer and every kind it makes a
 * record of.
 *
 * The registry is what a declaration is judged against at boot, so a producer
 * that reads less than its row promises makes the boot check admit a capability
 * that never runs, and one that reads more makes it refuse a capability that
 * would have. Neither shows up in either producer's own suite: each of those
 * asks whether its reading is right, not whether it is the reading the platform
 * published. This is the only file that sees both, because runtime is the only
 * package holding the sweep's reader and core's normalizers at once.
 *
 * The compiler already holds a producer to its row where the row is an upper
 * bound — a normalizer cannot fill a group `ProducedFacts` types as `Unread`.
 * What only a record can show is the other direction: a producer that promises
 * a group and then never fills it, which is a boot check admitting a capability
 * that is skipped on every delivery.
 *
 * THERE IS NO STANDING EXCEPTION ANY MORE. `review` used to be one — the sweep
 * promised it and answered `UNREAD`, because three of its reads were absent
 * from the endpoint-permission matrix — and protocol 6.9 cited all three, so
 * every row below is met by the record itself. The gap that made the exception
 * possible is still real (`design/guides/sweep.md` §4), which is why `decide()`
 * keeps its `factsUnread` skip and why the first case below asserts the gap is
 * empty rather than assuming it cannot open again.
 */

import { describe, expect, it } from "vitest";
import { capture } from "@hiero-hackers/automation-testkit";
import {
    carriesFactGroup,
    FACT_GROUPS,
    FACT_KINDS,
    factGroupUnread,
    normalizeDelivery,
    parseConfigDocument,
    PRODUCER_NAMES,
    PRODUCERS,
    producerReads,
    producesKind,
    UNREAD,
    type FactKind,
    type Facts,
    type ProducerName,
    type RepositoryConfig,
} from "@hiero-hackers/automation-core";
import { CONFIRMED_SWEEP_READS, createFactsReader, GROUP_READS } from "../src/adapter/index.js";
import {
    httpHarness,
    installationToken,
    json,
    routed,
    TEST_REPOSITORY,
    type ResponseStep,
} from "./adapter/harness.js";

const NOW = new Date("2026-09-09T12:00:00.000Z");

function config(): RepositoryConfig {
    const result = parseConfigDocument(
        `schemaVersion: 1
mode: observe
mappings:
  commands:
    working: "/working"
`,
        { revision: "rev-producers-1", knownCapabilities: [] },
    );
    expect(result.ok, "the suite's configuration parses").toBe(true);
    if (!result.ok) throw new Error("unreachable: asserted above");
    return result.config;
}

// ─── One record from each producer ───────────────────────────────────

/**
 * The webhook capture each event producer is asked to normalize.
 *
 * `issue_comment` HAS NO CAPTURE, and that is a fact about the testkit rather
 * than a gap in this file: capturing one means calling GitHub, and the session
 * that built the producer could not. Its delivery below is HALF real — the
 * `repository` and `issue` objects are the `issues.opened.json` capture's, and
 * only `action` and `comment` are written by hand from GitHub's documented
 * shape. The family joins the capture set at the next capture session
 * (protocol 7.1), and `CAPTURES` losing this special case is what that will
 * look like.
 */
const CAPTURES: Readonly<Record<string, string>> = {
    issues: "issues.opened.json",
    pull_request: "pull_request.opened.json",
};

/** The half-real `issue_comment` delivery — see `CAPTURES`. */
function commentDelivery(): unknown {
    const opened = capture("issues.opened.json").json() as Record<string, unknown>;
    return {
        action: "created",
        repository: opened["repository"],
        issue: opened["issue"],
        comment: {
            body: "/working",
            created_at: "2026-09-01T09:00:00Z",
            user: { login: "ada" },
        },
    };
}

function fromWebhook(producer: ProducerName): Facts {
    const captured = CAPTURES[producer];
    const [event, payload] =
        captured === undefined
            ? ([producer, commentDelivery()] as const)
            : ([capture(captured).event, capture(captured).json()] as const);
    const result = normalizeDelivery(event, payload, config());
    expect(result.kind, `${producer} normalizes its own delivery`).toBe("facts");
    if (result.kind !== "facts") throw new Error("unreachable: asserted above");
    return result.facts;
}

/** One open issue and one open pull request that closes it. */
const ROUTES: Readonly<Record<string, ResponseStep>> = {
    "/issues?": json([
        {
            number: 12,
            state: "open",
            updated_at: "2026-09-01T09:00:00Z",
            labels: [],
            user: { login: "ada" },
            assignees: [{ login: "ada" }],
        },
        {
            number: 34,
            state: "open",
            updated_at: "2026-09-02T09:00:00Z",
            labels: [],
            user: { login: "grace" },
            assignees: [{ login: "grace" }],
            pull_request: { url: "https://api.github.com/pulls/34" },
        },
    ]),
    "/issues/12/timeline": json([
        { event: "assigned", assignee: { login: "ada" }, created_at: "2026-08-01T00:00:00Z" },
    ]),
    "/issues/12/comments": json([]),
    "/issues/34/timeline": json([
        { event: "assigned", assignee: { login: "grace" }, created_at: "2026-08-02T00:00:00Z" },
    ]),
    "/issues/34/comments": json([]),
    "/pulls/34/reviews": json([]),
    "/pulls/34/commits": json([]),
    "/pulls/34": json({ draft: false, created_at: "2026-08-01T00:00:00Z" }),
    // The sweep reads links for the whole list, so the answer is the aliased one (D194).
    "/graphql": json({
        data: {
            repository: {
                p0: {
                    number: 34,
                    closingIssuesReferences: {
                        nodes: [
                            {
                                number: 12,
                                repository: {
                                    nameWithOwner: `${TEST_REPOSITORY.owner}/${TEST_REPOSITORY.repo}`,
                                },
                            },
                        ],
                        pageInfo: { hasNextPage: false, endCursor: null },
                    },
                },
            },
        },
    }),
};

/**
 * The sweep's own record for one kind, with every route answering.
 *
 * The installation holds `pull_requests:read` as well as `issues:write`: the
 * linked-issue query is refused without it, which would leave `links` unread
 * for a reason that has nothing to do with the registry.
 */
async function fromSweep(kind: FactKind): Promise<Facts> {
    const http = httpHarness([routed(ROUTES)], {
        outcomes: [
            {
                ok: true as const,
                token: {
                    ...installationToken("sweep-token"),
                    grants: ["issues:write", "pull_requests:read"] as const,
                },
            },
        ],
    });
    const reader = createFactsReader({
        http: http.client,
        repository: TEST_REPOSITORY,
        config: config(),
        // Every group the row promises, so this file asks about the row alone.
        groups: PRODUCERS.sweep,
        clock: () => NOW,
    });
    const outcome = await reader.openItems();
    expect(outcome.ok, "the open-item list was readable").toBe(true);
    if (!outcome.ok) throw new Error("unreachable: asserted above");
    const [issue, pull] = outcome.items;
    const closes = await reader.linksFor([pull!.item.number]);
    return kind === "issue"
        ? reader.issueFacts(issue!, [pull!.item])
        : reader.pullRequestFacts(pull!, [issue!], closes.get(pull!.item.number) ?? UNREAD);
}

function recordFrom(producer: ProducerName, kind: FactKind): Promise<Facts> {
    return producer === "sweep" ? fromSweep(kind) : Promise.resolve(fromWebhook(producer));
}

// ─── The registry, held against the records ──────────────────────────

describe("every producer reads the groups its registry row names", () => {
    /**
     * The gap the cases below are allowed to have, asserted empty. Only the
     * sweep can open one: a read its group is built from may be absent from
     * the endpoint-permission matrix, in which case the read is never
     * attempted and the group is honestly unread on a row that promises it.
     */
    it("promises no group whose reads the matrix has not confirmed", () => {
        const unreadable = FACT_GROUPS.filter((group) =>
            GROUP_READS[group].some((read) => !CONFIRMED_SWEEP_READS.includes(read)),
        );

        expect(unreadable).toEqual([]);
    });

    for (const producer of PRODUCER_NAMES) {
        for (const kind of FACT_KINDS) {
            if (!producesKind(producer, kind)) continue;

            it(`${producer} fills a ${kind} record to its row and no further`, async () => {
                const facts = await recordFrom(producer, kind);
                const read: string[] = [];
                const unread: string[] = [];
                for (const group of FACT_GROUPS) {
                    if (!carriesFactGroup(kind, group)) continue;
                    (factGroupUnread(facts, group) ? unread : read).push(group);
                }

                expect({ read, unread }).toEqual({
                    read: FACT_GROUPS.filter(
                        (group) =>
                            carriesFactGroup(kind, group) && producerReads(producer, kind, group),
                    ),
                    unread: FACT_GROUPS.filter(
                        (group) =>
                            carriesFactGroup(kind, group) && !producerReads(producer, kind, group),
                    ),
                });
            });
        }
    }

    it("asks every producer of every kind, and the sweep is the only one reading", () => {
        // A walk that silently covered nothing would make the cases above
        // vacuous, and the split between the two producer shapes IS the
        // registry's content: webhooks read the projection alone.
        const pairs = PRODUCER_NAMES.flatMap((producer) =>
            FACT_KINDS.filter((kind) => producesKind(producer, kind)).map(
                (kind) => `${producer}/${kind}`,
            ),
        );
        expect(pairs).toEqual([
            "issues/issue",
            "issue_comment/issue",
            "pull_request/pullRequest",
            "sweep/issue",
            "sweep/pullRequest",
        ]);
        // On a PULL REQUEST the webhook reads one group and the sweep the
        // rest: `readiness` is `draft`, which the payload carries whole, and
        // the three facts left in `review` need the timeline.
        expect(
            PRODUCER_NAMES.filter((producer) =>
                FACT_GROUPS.some((group) => producerReads(producer, "pullRequest", group)),
            ),
        ).toEqual(["pull_request", "sweep"]);
    });
});
