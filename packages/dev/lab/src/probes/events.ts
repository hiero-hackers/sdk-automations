/**
 * Every captured webhook as a checkable shape: what provokes it on the sandbox, the event and
 * action it must arrive as, and the payload paths the normalizer reads. Shapes only.
 */

/** What the probe does on the sandbox to make GitHub send the event. */
export type Provocation =
    | "openIssue"
    | "labelIssue"
    | "commentOnIssue"
    | "closeIssue"
    | "closePullRequest"
    | "reopenPullRequest";

export interface EventShape {
    /** The capture it answers for, `<event>.<action>`. */
    readonly name: string;
    readonly event: string;
    /** The action the delivery arrives under; `reopened` stands in for an `opened` nobody can repeat. */
    readonly action: string;
    readonly provoke: Provocation;
    /** JSON paths; `[]` walks an array and a trailing `?` marks one the reader tolerates absent. */
    readonly fields: readonly string[];
}

const DELIVERY = ["action", "repository.owner.login", "repository.name", "sender.login"];

const ISSUE = [
    ...DELIVERY,
    "issue.number",
    "issue.state",
    "issue.locked",
    "issue.user.login",
    "issue.labels[].name",
    "issue.updated_at",
    "issue.pull_request?",
];

const PULL_REQUEST = [
    ...DELIVERY,
    "pull_request.number",
    "pull_request.state",
    "pull_request.merged",
    "pull_request.draft",
    "pull_request.user.login",
    "pull_request.labels[].name",
    "pull_request.updated_at",
];

export const EVENT_SHAPES: readonly EventShape[] = [
    {
        name: "issues.opened",
        event: "issues",
        action: "opened",
        provoke: "openIssue",
        fields: ISSUE,
    },
    {
        name: "issues.labeled",
        event: "issues",
        action: "labeled",
        provoke: "labelIssue",
        fields: [...ISSUE, "label.name"],
    },
    {
        name: "issue_comment.created",
        event: "issue_comment",
        action: "created",
        provoke: "commentOnIssue",
        fields: [...ISSUE, "comment.body", "comment.user.login", "comment.created_at"],
    },
    {
        name: "issues.closed",
        event: "issues",
        action: "closed",
        provoke: "closeIssue",
        fields: ISSUE,
    },
    {
        name: "pull_request.closed",
        event: "pull_request",
        action: "closed",
        provoke: "closePullRequest",
        fields: PULL_REQUEST,
    },
    {
        name: "pull_request.opened",
        event: "pull_request",
        action: "reopened",
        provoke: "reopenPullRequest",
        fields: PULL_REQUEST,
    },
];
