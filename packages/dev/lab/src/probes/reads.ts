/**
 * Every confirmed read as a checkable shape: the row of
 * `design/findings/endpoint-permission-matrix.md` it cites, the one request that answers
 * it, and the properties its reader depends on. Shapes only — no values, no counts.
 */

import { CONFIG_PATH } from "@hiero-hackers/automation-core";
import type { FixtureName } from "./fixtures.js";

/** What the link header is recorded to advertise. */
export type Pagination = "next-only" | "last-named" | "none";

/** What a second call carrying `If-None-Match` is recorded to do. */
export type Conditional = "304-free" | "etag-only" | "none";

/** `{o}`, `{r}`, `{n}`, `{login}` and `{ref}` are filled from the fixture at run time. */
export interface RequestTemplate {
    readonly method: "GET" | "POST";
    readonly path: string;
    readonly body?: string;
}

/** The six properties a reader depends on; a field it does not touch is absent. */
export interface Shape {
    readonly status: number;
    readonly permission: string;
    readonly headers: readonly string[];
    readonly pagination: Pagination;
    readonly conditional: Conditional;
    /** JSON paths; `[]` walks an array and a trailing `?` marks one the reader tolerates absent. */
    readonly fields: readonly string[];
}

/** A confirmed read that reaches GitHub. */
export interface WireRead {
    readonly name: string;
    readonly row: string;
    readonly request: RequestTemplate;
    readonly fixture: FixtureName;
    readonly shape: Shape;
}

/** A confirmed read that sends nothing, so it has no shape to drift. */
export interface LocalRead {
    readonly name: string;
    readonly row: string;
    readonly request: null;
}

export type ShapeRecord = WireRead | LocalRead;

const PAGED = "per_page=100&page=1";

/** The query `linkedIssues` sends, spelled here because the lab may not import the adapter. */
const LINKED_ISSUES_QUERY = `query LinkedIssues($owner: String!, $repo: String!, $number: Int!, $after: String) {
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

/**
 * The same connection, aliased. The batched query is this a hundred times over,
 * one `$n{i}` and one `p{i}:` per pull request; one alias is enough to check the shape.
 */
const LINKED_ISSUES_BATCH_QUERY = `query LinkedIssuesBatch($owner: String!, $repo: String!, $n0: Int!) { repository(owner: $owner, name: $repo) { p0: pullRequest(number: $n0) { number closingIssuesReferences(first: 100, excludeUserLinked: true) { nodes { number repository { nameWithOwner } } pageInfo { hasNextPage endCursor } } } } }`;

const LINKED = "data.repository.pullRequest.closingIssuesReferences";

const LINKED_BATCH = "data.repository.p0.closingIssuesReferences";

/**
 * One record per name of `CONFIRMED_SWEEP_READS` and `CONFIRMED_RESOLVER_READS`, plus the
 * default-branch config read. `linkedIssues` is on both lists and is one record.
 */
export const SHAPE_RECORDS: readonly ShapeRecord[] = [
    {
        name: "openItems",
        row: "List issues (paged)",
        request: { method: "GET", path: `/repos/{o}/{r}/issues?${PAGED}&state=open` },
        fixture: "REPOSITORY",
        shape: {
            status: 200,
            permission: "issues:read",
            headers: ["etag"],
            pagination: "next-only",
            conditional: "304-free",
            fields: [
                "number",
                "state",
                "updated_at",
                "labels[].name",
                "assignees[].login",
                "user.login",
                "pull_request?",
            ],
        },
    },
    {
        name: "assignedAt",
        row: "Read issue timeline",
        request: { method: "GET", path: `/repos/{o}/{r}/issues/{n}/timeline?${PAGED}` },
        fixture: "ISSUE_ASSIGNED_MERGED",
        shape: {
            status: 200,
            permission: "issues:read",
            headers: ["etag"],
            pagination: "none",
            conditional: "etag-only",
            fields: ["event", "assignee.login", "created_at"],
        },
    },
    {
        name: "lastWorkingAt",
        row: "List comments",
        request: { method: "GET", path: `/repos/{o}/{r}/issues/{n}/comments?${PAGED}` },
        fixture: "ISSUE_ASSIGNED_MERGED",
        shape: {
            status: 200,
            permission: "issues:read",
            headers: ["etag"],
            pagination: "none",
            conditional: "etag-only",
            fields: ["user.login", "created_at", "body"],
        },
    },
    {
        name: "draft",
        row: "Read PR",
        request: { method: "GET", path: "/repos/{o}/{r}/pulls/{n}" },
        fixture: "PR_DRAFT",
        shape: {
            status: 200,
            permission: "pull_requests:read",
            headers: ["etag"],
            pagination: "none",
            conditional: "etag-only",
            fields: ["draft"],
        },
    },
    {
        name: "linkedIssues",
        row: "Read linked issues",
        request: { method: "POST", path: "/graphql", body: LINKED_ISSUES_QUERY },
        fixture: "PR_READY",
        shape: {
            status: 200,
            permission: "issues:read+pull_requests:read",
            headers: [],
            pagination: "none",
            conditional: "none",
            fields: [
                "data.repository.nameWithOwner",
                "data.repository.pullRequest.number",
                `${LINKED}.nodes[].number`,
                `${LINKED}.nodes[].repository.nameWithOwner`,
                `${LINKED}.pageInfo.hasNextPage`,
                `${LINKED}.pageInfo.endCursor`,
            ],
        },
    },
    {
        name: "linkedIssuesBatch",
        row: "Read linked issues, batched",
        request: { method: "POST", path: "/graphql", body: LINKED_ISSUES_BATCH_QUERY },
        fixture: "PR_READY",
        shape: {
            status: 200,
            permission: "issues:read+pull_requests:read",
            headers: [],
            pagination: "none",
            conditional: "none",
            fields: [
                "data.repository.p0.number",
                `${LINKED_BATCH}.nodes[].number`,
                `${LINKED_BATCH}.nodes[].repository.nameWithOwner`,
                `${LINKED_BATCH}.pageInfo.hasNextPage`,
            ],
        },
    },
    {
        name: "changesRequested",
        row: "List PR reviews",
        request: { method: "GET", path: `/repos/{o}/{r}/pulls/{n}/reviews?${PAGED}` },
        fixture: "PR_CHANGES_REQUESTED",
        shape: {
            status: 200,
            permission: "pull_requests:read",
            headers: ["etag"],
            pagination: "none",
            conditional: "304-free",
            fields: ["state", "user.login"],
        },
    },
    {
        name: "reapableSince",
        row: "Read issue timeline",
        request: { method: "GET", path: `/repos/{o}/{r}/issues/{n}/timeline?${PAGED}` },
        fixture: "PR_READY",
        shape: {
            status: 200,
            permission: "issues:read|pull_requests:read",
            headers: ["etag"],
            pagination: "none",
            conditional: "304-free",
            fields: ["event", "created_at", "state?", "submitted_at?"],
        },
    },
    {
        name: "lastCommitAt",
        row: "List PR commits",
        request: { method: "GET", path: `/repos/{o}/{r}/pulls/{n}/commits?${PAGED}` },
        fixture: "PR_COMMITS",
        shape: {
            status: 200,
            permission: "pull_requests:read",
            headers: ["etag"],
            pagination: "none",
            conditional: "304-free",
            fields: ["commit.committer.date"],
        },
    },
    {
        name: "isAutomationActor",
        row: "—",
        request: null,
    },
    {
        name: "mergeability",
        row: "Read PR",
        request: { method: "GET", path: "/repos/{o}/{r}/pulls/{n}" },
        fixture: "PR_READY",
        shape: {
            status: 200,
            permission: "pull_requests:read",
            headers: ["etag"],
            pagination: "none",
            conditional: "etag-only",
            fields: ["number", "mergeable"],
        },
    },
    {
        name: "openAssignments",
        row: "List issues (paged)",
        request: {
            method: "GET",
            path: `/repos/{o}/{r}/issues?${PAGED}&state=open&assignee={login}`,
        },
        fixture: "MERGED_LOGIN",
        shape: {
            status: 200,
            permission: "issues:read",
            headers: ["etag"],
            pagination: "next-only",
            conditional: "304-free",
            fields: ["number", "labels[].name", "assignees[].login", "pull_request?"],
        },
    },
    {
        name: "configAtHead",
        row: "Read file (config)",
        request: { method: "GET", path: `/repos/{o}/{r}/contents/${CONFIG_PATH}?ref={ref}` },
        fixture: "PR_READY",
        shape: {
            status: 200,
            permission: "contents:read",
            headers: ["etag"],
            pagination: "none",
            conditional: "etag-only",
            fields: ["sha", "type", "content", "encoding"],
        },
    },
    {
        name: "commitAttestations",
        row: "List PR commits",
        request: { method: "GET", path: `/repos/{o}/{r}/pulls/{n}/commits?${PAGED}` },
        fixture: "PR_COMMITS",
        shape: {
            status: 200,
            permission: "pull_requests:read",
            headers: ["etag"],
            pagination: "none",
            conditional: "304-free",
            fields: ["sha", "commit.message", "commit.verification.verified", "parents"],
        },
    },
    {
        name: "assigneesOf",
        row: "Read issue",
        request: { method: "GET", path: "/repos/{o}/{r}/issues/{n}" },
        fixture: "ISSUE_ASSIGNED_MERGED",
        shape: {
            status: 200,
            permission: "issues:read",
            headers: ["etag"],
            pagination: "none",
            conditional: "304-free",
            fields: ["number", "assignees[].login"],
        },
    },
    {
        name: "config",
        row: "Read file (config)",
        request: { method: "GET", path: `/repos/{o}/{r}/contents/${CONFIG_PATH}` },
        fixture: "REPOSITORY",
        shape: {
            status: 200,
            permission: "contents:read",
            headers: ["etag"],
            pagination: "none",
            conditional: "etag-only",
            fields: ["sha", "type", "content", "encoding"],
        },
    },
];

export function shapeOf(name: string): ShapeRecord | undefined {
    return SHAPE_RECORDS.find((record) => record.name === name);
}
