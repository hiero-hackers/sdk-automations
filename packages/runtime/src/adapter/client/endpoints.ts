/**
 * The confirmed write endpoints, as shapes: what method and path tail each one
 * is, the grant it needs, and the keys its landing stales. The admission gate
 * matches every built request against these; the transports build, never match.
 */

import type { PermissionGrant } from "@hiero-hackers/automation-core";
import { GITHUB_API_ORIGIN } from "./contract.js";

/** The write operations the endpoint matrix confirmed, by path shape. */
export type WriteEndpoint =
    | "createLabel"
    | "addLabel"
    | "removeLabel"
    | "createComment"
    | "updateComment"
    | "closePullRequest"
    | "releaseAssignment"
    | "lockIssue"
    | "unlockIssue";

/** Non-empty, and unchanged by a decode-then-encode round trip. */
export function isEncodedSegment(segment: string | undefined): boolean {
    if (segment === undefined || segment.length === 0) return false;
    try {
        return encodeURIComponent(decodeURIComponent(segment)) === segment;
    } catch {
        return false;
    }
}

export function isNumberSegment(segment: string | undefined): boolean {
    return segment !== undefined && /^[1-9][0-9]*$/.test(segment);
}

export interface EndpointShape {
    readonly endpoint: WriteEndpoint;
    readonly resource: "issues" | "pulls" | "labels";
    /** The grant a 403 on this endpoint names; a write takes nothing weaker (D123). */
    readonly grant: PermissionGrant;
    /** Structural match on method and the path's tail — never derived from the builder (D129). */
    matches(method: string, rest: readonly string[]): boolean;
    /** Cache keys a landed write makes untrustworthy. */
    invalidates(url: URL): readonly string[];
}

/** Whole-href resource prefixes: the item, one of its two lists, its timeline. */
function itemStaledBy(url: URL, list: "comments" | "labels"): readonly string[] {
    const item = `${GITHUB_API_ORIGIN}${url.pathname.split("/").slice(0, 6).join("/")}`;
    return [item, `${item}/${list}`, `${item}/timeline`];
}

/** The three hrefs one item's state is read from: both its views, and its timeline. */
function itemViewsStaledBy(url: URL): readonly string[] {
    const [, , owner, repo, , number] = url.pathname.split("/");
    const repository = `${GITHUB_API_ORIGIN}/repos/${String(owner)}/${String(repo)}`;
    const issue = `${repository}/issues/${String(number)}`;
    return [issue, `${issue}/timeline`, `${repository}/pulls/${String(number)}`];
}

/** `POST …/labels` — the repository's label list, defined into (protocol 6.14). */
const CREATE_LABEL: EndpointShape = {
    endpoint: "createLabel",
    resource: "labels",
    grant: "issues:write",
    matches: (method, rest) => method === "POST" && rest.length === 0,
    invalidates: (url) => [`${GITHUB_API_ORIGIN}${url.pathname}`],
};

/** `POST …/issues/{n}/labels` — the item's label list, added to. */
const ADD_LABEL: EndpointShape = {
    endpoint: "addLabel",
    resource: "issues",
    grant: "issues:write",
    matches: (method, rest) =>
        method === "POST" && rest.length === 2 && isNumberSegment(rest[0]) && rest[1] === "labels",
    invalidates: (url) => itemStaledBy(url, "labels"),
};

/**
 * `DELETE …/issues/{n}/labels/{name}` — one named label, removed.
 * D4 is enforced by this shape: the only removal admitted names one label.
 */
const REMOVE_LABEL: EndpointShape = {
    endpoint: "removeLabel",
    resource: "issues",
    grant: "issues:write",
    matches: (method, rest) =>
        method === "DELETE" &&
        rest.length === 3 &&
        isNumberSegment(rest[0]) &&
        rest[1] === "labels" &&
        isEncodedSegment(rest[2]),
    invalidates: (url) => itemStaledBy(url, "labels"),
};

/** `POST …/issues/{n}/comments` — the item's comment list, appended to. */
const CREATE_COMMENT: EndpointShape = {
    endpoint: "createComment",
    resource: "issues",
    grant: "issues:write",
    matches: (method, rest) =>
        method === "POST" &&
        rest.length === 2 &&
        isNumberSegment(rest[0]) &&
        rest[1] === "comments",
    invalidates: (url) => itemStaledBy(url, "comments"),
};

/**
 * `PATCH …/issues/comments/{id}` — the one write shape naming no item number.
 * Its landing stales a single key, so the issue's comment list survives an edit.
 */
const UPDATE_COMMENT: EndpointShape = {
    endpoint: "updateComment",
    resource: "issues",
    grant: "issues:write",
    matches: (method, rest) =>
        method === "PATCH" &&
        rest.length === 2 &&
        rest[0] === "comments" &&
        isNumberSegment(rest[1]),
    invalidates: (url) => [`${GITHUB_API_ORIGIN}${url.pathname}`],
};

/**
 * `PATCH …/pulls/{n}` — the pull request itself, set closed.
 * The only admitted write whose path names no sub-resource, so the number is the whole tail.
 */
const CLOSE_PULL_REQUEST: EndpointShape = {
    endpoint: "closePullRequest",
    resource: "pulls",
    grant: "pull_requests:write",
    matches: (method, rest) => method === "PATCH" && rest.length === 1 && isNumberSegment(rest[0]),
    invalidates: itemViewsStaledBy,
};

/**
 * `DELETE …/issues/{n}/assignees` — one named login off the list.
 * The one admitted DELETE that carries a body, and D63 is enforced by that body: the logins it names are the only ones removed.
 */
const RELEASE_ASSIGNMENT: EndpointShape = {
    endpoint: "releaseAssignment",
    resource: "issues",
    grant: "issues:write",
    matches: (method, rest) =>
        method === "DELETE" &&
        rest.length === 2 &&
        isNumberSegment(rest[0]) &&
        rest[1] === "assignees",
    invalidates: itemViewsStaledBy,
};

const LOCK_ISSUE: EndpointShape = {
    endpoint: "lockIssue",
    resource: "issues",
    grant: "issues:write",
    matches: (method, rest) =>
        method === "PUT" && rest.length === 2 && isNumberSegment(rest[0]) && rest[1] === "lock",
    invalidates: itemViewsStaledBy,
};

const UNLOCK_ISSUE: EndpointShape = {
    endpoint: "unlockIssue",
    resource: "issues",
    grant: "issues:write",
    matches: (method, rest) =>
        method === "DELETE" && rest.length === 2 && isNumberSegment(rest[0]) && rest[1] === "lock",
    invalidates: itemViewsStaledBy,
};

/** One shape per confirmed operation, and the only place one is declared. */
export const CONFIRMED_WRITE_ENDPOINTS: { readonly [K in WriteEndpoint]: EndpointShape } = {
    createLabel: CREATE_LABEL,
    addLabel: ADD_LABEL,
    removeLabel: REMOVE_LABEL,
    createComment: CREATE_COMMENT,
    updateComment: UPDATE_COMMENT,
    closePullRequest: CLOSE_PULL_REQUEST,
    releaseAssignment: RELEASE_ASSIGNMENT,
    lockIssue: LOCK_ISSUE,
    unlockIssue: UNLOCK_ISSUE,
};

/** What admitting one write endpoint establishes: its name, its grant, and its staling. */
export interface MatchedEndpoint {
    readonly endpoint: WriteEndpoint;
    readonly grant: EndpointShape["grant"];
    readonly invalidates: readonly string[];
}

/**
 * The write endpoint this method and path ARE, or `null`.
 * The shared preamble is checked here once; each shape judges the surface it sits on, the method and the tail — an unknown surface matches no shape and so is refused.
 */
export function writeEndpointOf(method: string, url: URL): MatchedEndpoint | null {
    if (url.search !== "" || url.hash !== "") return null;
    const [repos, owner, repo, resource, ...rest] = url.pathname.split("/").slice(1);
    if (repos !== "repos") return null;
    if (!isEncodedSegment(owner) || !isEncodedSegment(repo)) return null;

    for (const shape of Object.values(CONFIRMED_WRITE_ENDPOINTS)) {
        if (shape.resource === resource && shape.matches(method, rest)) {
            return {
                endpoint: shape.endpoint,
                grant: shape.grant,
                invalidates: shape.invalidates(url),
            };
        }
    }
    return null;
}
