/**
 * Which issues a pull request closes, read one pull request at a time or a hundred
 * to a POST. Same-repository references only: an invisible cross-repository target
 * comes back as a clean empty connection (`design/findings/endpoint-permission-matrix.md`).
 * The join to a sweep's own items is `facts.ts`; the arm a capability asks through
 * is `resolvers.ts`.
 */

import type { ItemRef, RepositoryRef, ResolverAnswer } from "@hiero-hackers/automation-core";
import type { Allowance } from "../client/allowance.js";
import {
    GITHUB_GRAPHQL_URL,
    type GitHubHttpClient,
    type GitHubSuccess,
} from "../client/contract.js";
import { graphqlFailure, httpFailure, unavailable, type ResolverFailure } from "./failures.js";
import { field, jsonRecordOf } from "../client/untrusted.js";

/** What either read needs to reach one repository: the client, and which one. */
export interface LinkReads {
    readonly http: GitHubHttpClient;
    readonly repository: RepositoryRef;
    /** What these reads are charged to; unset spends from no lane (D192). */
    readonly allowance?: Allowance;
}

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

/** One aliased pull request's selection; the batch walks no cursor of its own. */
const BATCH_CONNECTION =
    "closingIssuesReferences(first: 100, excludeUserLinked: true) " +
    "{ nodes { number repository { nameWithOwner } } pageInfo { hasNextPage endCursor } }";

/** How many pull requests one POST may name; GitHub's cost formula charges about a point. */
export const MAX_BATCH_ALIASES = 100;

const aliasOf = (index: number): string => `p${String(index)}`;

const variableOf = (index: number): string => `n${String(index)}`;

/** The query for one POST: one `$n{i}` and one `p{i}:` per pull request named. */
function batchQuery(count: number): string {
    const spelled = Array.from({ length: count }, (_, index) => index);
    const declared = spelled.map((index) => `$${variableOf(index)}: Int!`).join(", ");
    const aliased = spelled
        .map(
            (index) =>
                `${aliasOf(index)}: pullRequest(number: $${variableOf(index)}) ` +
                `{ number ${BATCH_CONNECTION} }`,
        )
        .join(" ");
    return (
        `query LinkedIssuesBatch($owner: String!, $repo: String!, ${declared}) ` +
        `{ repository(owner: $owner, name: $repo) { ${aliased} } }`
    );
}

/** The issues one connection named, and whether GitHub is holding more back. */
interface LinkedIssuesPage {
    readonly issues: readonly ItemRef[];
    readonly hasNextPage: boolean;
    readonly endCursor: string | null;
}

type ParsedPage = { readonly ok: true; readonly page: LinkedIssuesPage } | ResolverFailure;

const malformed = (): ResolverFailure => unavailable("GitHub returned malformed linked-issue data");

const expectedOf = (repository: RepositoryRef): string =>
    `${repository.owner}/${repository.repo}`.toLowerCase();

/** The GraphQL errors a body carried, or the reason the envelope itself is unusable. */
function envelopeFailure(
    response: GitHubSuccess,
    root: Record<string, unknown> | null,
): ResolverFailure | null {
    if (root === null) return malformed();
    const errors = field(root, "errors");
    if (errors === undefined) return null;
    if (!Array.isArray(errors)) return unavailable("GitHub returned malformed GraphQL errors");
    return errors.length > 0 ? graphqlFailure(response, errors) : null;
}

/** The same-repository issues one connection named, or the reason it is unusable. */
function pageOf(connection: unknown, expected: string): ParsedPage {
    const nodes = field(connection, "nodes");
    const pageInfo = field(connection, "pageInfo");
    const hasNextPage = field(pageInfo, "hasNextPage");
    const endCursor = field(pageInfo, "endCursor");
    if (
        !Array.isArray(nodes) ||
        typeof hasNextPage !== "boolean" ||
        (endCursor !== null && typeof endCursor !== "string")
    ) {
        return malformed();
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
            return malformed();
        }
        if (nameWithOwner.toLowerCase() === expected) {
            issues.push({ kind: "issue", number: issueNumber });
        }
    }
    return { ok: true, page: { issues, hasNextPage, endCursor } };
}

/** One per-item page, whose envelope also states which repository and pull request answered. */
function parsePage(response: GitHubSuccess, repository: RepositoryRef, number: number): ParsedPage {
    const root = jsonRecordOf(response.body);
    const broken = envelopeFailure(response, root);
    if (broken !== null) return broken;

    const returnedRepository = field(field(root, "data"), "repository");
    const nameWithOwner = field(returnedRepository, "nameWithOwner");
    const pullRequest = field(returnedRepository, "pullRequest");
    if (
        typeof nameWithOwner !== "string" ||
        nameWithOwner.toLowerCase() !== expectedOf(repository) ||
        field(pullRequest, "number") !== number
    ) {
        return malformed();
    }

    const parsed = pageOf(field(pullRequest, "closingIssuesReferences"), expectedOf(repository));
    if (!parsed.ok) return parsed;
    const { hasNextPage, endCursor } = parsed.page;
    return hasNextPage && (endCursor === null || endCursor.length === 0)
        ? unavailable("GitHub returned a missing linked-issue cursor")
        : parsed;
}

type ParsedBatch =
    { readonly ok: true; readonly pages: ReadonlyMap<number, LinkedIssuesPage> } | ResolverFailure;

/**
 * One batched answer, validated alias by alias the way `parsePage` validates one.
 * A single malformed alias refuses the WHOLE answer: a shorter map is a wrong one.
 */
function parseBatch(
    response: GitHubSuccess,
    repository: RepositoryRef,
    numbers: readonly number[],
): ParsedBatch {
    const root = jsonRecordOf(response.body);
    const broken = envelopeFailure(response, root);
    if (broken !== null) return broken;

    const returnedRepository = field(field(root, "data"), "repository");
    const expected = expectedOf(repository);
    const pages = new Map<number, LinkedIssuesPage>();
    for (const [index, number] of numbers.entries()) {
        const pullRequest = field(returnedRepository, aliasOf(index));
        if (field(pullRequest, "number") !== number) return malformed();
        const parsed = pageOf(field(pullRequest, "closingIssuesReferences"), expected);
        if (!parsed.ok) return parsed;
        pages.set(number, parsed.page);
    }
    return { ok: true, pages };
}

/**
 * Every issue one pull request closes, walked to the end of the connection.
 * A repeated or missing cursor is a failure, never a shorter list.
 */
export async function readLinkedIssues(
    { http, repository, allowance }: LinkReads,
    number: number,
): Promise<ResolverAnswer<readonly ItemRef[]>> {
    const issues: ItemRef[] = [];
    const cursors = new Set<string>();
    let after: string | null = null;
    for (let page = 1; page <= MAX_LINKED_ISSUE_PAGES; page += 1) {
        const outcome = await http.request(
            {
                url: GITHUB_GRAPHQL_URL,
                method: "POST",
                body: JSON.stringify({
                    operationName: "LinkedIssues",
                    query: LINKED_ISSUES_QUERY,
                    variables: { owner: repository.owner, repo: repository.repo, number, after },
                }),
            },
            allowance,
        );
        if (!outcome.ok) return httpFailure(outcome, allowance);

        const parsed = parsePage(outcome, repository, number);
        if (!parsed.ok) return parsed;
        issues.push(...parsed.page.issues);
        const next = parsed.page.hasNextPage ? parsed.page.endCursor : null;
        if (next === null) return { ok: true, value: issues };
        if (cursors.has(next)) return unavailable("GitHub repeated a linked-issue cursor");
        cursors.add(next);
        after = next;
    }
    return unavailable("GitHub linked-issue pagination exceeded 10 pages");
}

/**
 * Every issue each pull request named closes, a hundred pull requests to a POST.
 * One unusable alias refuses every number, the ones in other chunks included.
 */
export async function readLinkedIssuesBatch(
    context: LinkReads,
    numbers: readonly number[],
): Promise<ResolverAnswer<ReadonlyMap<number, readonly ItemRef[]>>> {
    const { http, repository, allowance } = context;
    const answered = new Map<number, readonly ItemRef[]>();
    const heldBack: number[] = [];
    for (let sent = 0; sent < numbers.length; sent += MAX_BATCH_ALIASES) {
        const chunk = numbers.slice(sent, sent + MAX_BATCH_ALIASES);
        const variables: Record<string, string | number> = {
            owner: repository.owner,
            repo: repository.repo,
        };
        for (const [index, number] of chunk.entries()) variables[variableOf(index)] = number;

        const outcome = await http.request(
            {
                url: GITHUB_GRAPHQL_URL,
                method: "POST",
                body: JSON.stringify({
                    operationName: "LinkedIssuesBatch",
                    query: batchQuery(chunk.length),
                    variables,
                }),
            },
            allowance,
        );
        if (!outcome.ok) return httpFailure(outcome, allowance);

        const parsed = parseBatch(outcome, repository, chunk);
        if (!parsed.ok) return parsed;
        for (const [number, page] of parsed.pages) {
            answered.set(number, page.issues);
            if (page.hasNextPage) heldBack.push(number);
        }
    }
    // The batch asks for one page each. A pull request past it is read on its own.

    for (const number of heldBack) {
        const whole = await readLinkedIssues(context, number);
        if (!whole.ok) return whole;
        answered.set(number, whole.value);
    }
    return { ok: true, value: answered };
}
