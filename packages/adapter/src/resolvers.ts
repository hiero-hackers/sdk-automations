/**
 * The adapter's answers to the questions core lets a capability ask: one
 * arm per name in core's `RESOLVER_NAMES`, and nothing else.
 *
 * Every answer is VERIFIED on this side rather than taken on trust. A
 * linked-issue page must name the repository and the pull request that
 * were asked about, a page claiming a successor must carry a cursor that
 * is new, and paging stops at `MAX_LINKED_ISSUE_PAGES`. Whatever fails a
 * check becomes a typed failure, never a shorter list: a capability
 * reading `[]` as "no linked issue" would act on a rate limit
 * (resolvers.md §6).
 */

import type {
    ItemRef,
    RepositoryRef,
    ResolverAnswer,
    ResolverName,
    ResolverSource,
} from "@hiero-hackers/automation-core";
import {
    describeFailure,
    GITHUB_GRAPHQL_URL,
    type GitHubFailure,
    type GitHubHttpClient,
    type GitHubSuccess,
} from "./http.js";
import { field, jsonRecordOf } from "./untrusted.js";

const LINKED_ISSUES_QUERY = `query LinkedIssues(
  $owner: String!
  $repo: String!
  $number: Int!
  $after: String
) {
  repository(owner: $owner, name: $repo) {
    nameWithOwner
    pullRequest(number: $number) {
      number
      closingIssuesReferences(first: 100, after: $after, excludeUserLinked: true) {
        nodes { number repository { nameWithOwner } }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
}`;

const MAX_LINKED_ISSUE_PAGES = 10;

type ResolverFailure = Extract<ResolverAnswer<never>, { readonly ok: false }>;

export interface ResolverSourceOptions {
    readonly http: GitHubHttpClient;
    readonly repository: RepositoryRef;
}

/** GitHub's own words reach an operator verbatim, so they are kept short. */
const QUOTED_HEADER_LIMIT = 40;

const unavailable = (detail: string): ResolverFailure => ({
    ok: false,
    reason: "unavailable",
    detail,
});

const rateLimited = (detail: string): ResolverFailure => ({
    ok: false,
    reason: "rateLimited",
    detail,
});

/**
 * A failed call as a resolver answer.
 *
 * The `reason` is the capability's half of this and stays coarse — a
 * capability can act on "rate limited" and on nothing finer. The `detail` is
 * the operator's half, and the three rate classes are three different
 * problems: an hourly budget spent, a burst that must slow down, and a wait
 * signal nobody could read. The adapter has already waited whatever was worth
 * waiting, so what arrives here is what an operator must decide about.
 */
function httpFailure(outcome: GitHubFailure): ResolverFailure {
    const failure = outcome.failure;
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

function graphqlFailure(response: GitHubSuccess, errors: readonly unknown[]): ResolverFailure {
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

interface LinkedIssuesPage {
    readonly issues: readonly ItemRef[];
    readonly nextCursor: string | null;
}

function parsePage(
    response: GitHubSuccess,
    repository: RepositoryRef,
    number: number,
): { readonly ok: true; readonly page: LinkedIssuesPage } | ResolverFailure {
    const root = jsonRecordOf(response.body);
    if (root === null) return unavailable("GitHub returned malformed linked-issue data");

    const errors = field(root, "errors");
    if (errors !== undefined) {
        if (!Array.isArray(errors)) return unavailable("GitHub returned malformed GraphQL errors");
        if (errors.length > 0) return graphqlFailure(response, errors);
    }

    const returnedRepository = field(field(root, "data"), "repository");
    const pullRequest = field(returnedRepository, "pullRequest");
    const connection = field(pullRequest, "closingIssuesReferences");
    const nodes = field(connection, "nodes");
    const pageInfo = field(connection, "pageInfo");
    const hasNextPage = field(pageInfo, "hasNextPage");
    const endCursor = field(pageInfo, "endCursor");
    const expectedRepository = `${repository.owner}/${repository.repo}`.toLowerCase();

    if (
        typeof field(returnedRepository, "nameWithOwner") !== "string" ||
        (field(returnedRepository, "nameWithOwner") as string).toLowerCase() !==
            expectedRepository ||
        field(pullRequest, "number") !== number ||
        !Array.isArray(nodes) ||
        typeof hasNextPage !== "boolean" ||
        (endCursor !== null && typeof endCursor !== "string")
    ) {
        return unavailable("GitHub returned malformed linked-issue data");
    }

    const issues: ItemRef[] = [];
    for (const node of nodes) {
        const issueNumber = field(node, "number");
        const nameWithOwner = field(field(node, "repository"), "nameWithOwner");
        if (
            typeof issueNumber !== "number" ||
            !Number.isSafeInteger(issueNumber) ||
            issueNumber < 1 ||
            typeof nameWithOwner !== "string"
        ) {
            return unavailable("GitHub returned malformed linked-issue data");
        }
        if (nameWithOwner.toLowerCase() === expectedRepository) {
            issues.push({ kind: "issue", number: issueNumber });
        }
    }

    if (hasNextPage && (typeof endCursor !== "string" || endCursor.length === 0)) {
        return unavailable("GitHub returned a missing linked-issue cursor");
    }
    return { ok: true, page: { issues, nextCursor: hasNextPage ? endCursor : null } };
}

async function linkedIssues(
    { http, repository }: ResolverSourceOptions,
    input: unknown,
): Promise<ResolverAnswer<readonly ItemRef[]>> {
    const item = field(input, "item");
    const number = field(item, "number");
    if (
        field(item, "kind") !== "pullRequest" ||
        typeof number !== "number" ||
        !Number.isSafeInteger(number) ||
        number < 1
    ) {
        return unavailable("linkedIssues requires a valid pull request item");
    }

    const issues: ItemRef[] = [];
    const cursors = new Set<string>();
    let after: string | null = null;
    for (let pageNumber = 1; pageNumber <= MAX_LINKED_ISSUE_PAGES; pageNumber += 1) {
        const outcome = await http.request({
            url: GITHUB_GRAPHQL_URL,
            method: "POST",
            body: JSON.stringify({
                operationName: "LinkedIssues",
                query: LINKED_ISSUES_QUERY,
                variables: { owner: repository.owner, repo: repository.repo, number, after },
            }),
        });
        if (!outcome.ok) return httpFailure(outcome);

        const parsed = parsePage(outcome, repository, number);
        if (!parsed.ok) return parsed;
        issues.push(...parsed.page.issues);
        const next = parsed.page.nextCursor;
        if (next === null) return { ok: true, value: issues };
        if (cursors.has(next)) return unavailable("GitHub repeated a linked-issue cursor");
        cursors.add(next);
        after = next;
    }
    return unavailable("GitHub linked-issue pagination exceeded 10 pages");
}

/** GitHub gives every App actor the `[bot]` suffix, so no call is needed. */
function isAutomationActor(input: unknown): ResolverAnswer<boolean> {
    const login = field(input, "login");
    return typeof login === "string" && login.length > 0
        ? { ok: true, value: login.toLowerCase().endsWith("[bot]") }
        : unavailable("isAutomationActor requires a valid login");
}

export function createResolverSource(options: ResolverSourceOptions): ResolverSource {
    // Exhaustive, with no default arm: a name added to RESOLVER_NAMES leaves
    // this switch able to return undefined, which the declared type refuses.
    // Adding the resolver is then a compile error, not a silent inheritance
    // of whichever answer happened to sit last.
    const resolve = async (
        query: ResolverName,
        input: unknown,
    ): Promise<ResolverAnswer<unknown>> => {
        switch (query) {
            case "linkedIssues":
                return linkedIssues(options, input);
            case "isAutomationActor":
                return isAutomationActor(input);
        }
    };
    // The one erasure: `ResolverSource` ties each name to its own output
    // type, and a body that dispatches at runtime cannot prove that pairing
    // per call. The switch above is what makes the pairing true.
    return resolve as ResolverSource;
}
