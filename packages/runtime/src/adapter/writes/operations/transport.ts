/** What one write operation's transport is: the verbs it contributes; its endpoints are the client's (D176). */

import type { ItemRef, RepositoryRef } from "@hiero-hackers/automation-core";
import type { Allowance } from "../../client/allowance.js";
import { repoPath, type GitHubWriteRequest } from "../../client/contract.js";

/** `applied` is the postcondition holding because we made it hold; `already` is it holding without us. */
export type WriteResult =
    | { readonly outcome: "applied" }
    | { readonly outcome: "already" }
    | { readonly outcome: "conflict"; readonly detail: string }
    | { readonly outcome: "forbidden"; readonly detail: string }
    | { readonly outcome: "retryLater"; readonly detail: string }
    | { readonly outcome: "unknown"; readonly detail: string }
    | { readonly outcome: "unsupported"; readonly detail: string };

export interface WriteVerbs {
    addLabel(item: ItemRef, label: string, allowance?: Allowance): Promise<WriteResult>;
    /** ONE named label. There is no remove-by-prefix here or below (D4). */
    removeLabel(item: ItemRef, label: string, allowance?: Allowance): Promise<WriteResult>;
    /** The one non-idempotent verb. */
    createComment(item: ItemRef, body: string, allowance?: Allowance): Promise<WriteResult>;
    updateComment(commentId: number, body: string, allowance?: Allowance): Promise<WriteResult>;
    /** Closed unmerged; the reason is the notice's, never GitHub's. */
    closePullRequest(item: ItemRef, allowance?: Allowance): Promise<WriteResult>;
    /** ONE named login off the item's assignees, never the list whole (D63). */
    releaseAssignment(item: ItemRef, login: string, allowance?: Allowance): Promise<WriteResult>;
}

/** The one status the endpoints disagree about; the fallback is `invisible`, never `already` (D46). */
export type NotFoundMeaning = "invisible" | "labelMayBeAbsent";

/** Nothing a builder receives is validated; the admission gate refuses a bad URL structurally. */
export interface VerbContext {
    readonly repository: RepositoryRef;
    apply(
        request: GitHubWriteRequest,
        notFound: NotFoundMeaning,
        allowance?: Allowance,
    ): Promise<WriteResult>;
}

export function issuePath(repository: RepositoryRef, item: ItemRef): string {
    return `${repoPath(repository)}/issues/${String(item.number)}`;
}

/** The pull-request view of the same number — a different row, and a different grant. */
export function pullPath(repository: RepositoryRef, item: ItemRef): string {
    return `${repoPath(repository)}/pulls/${String(item.number)}`;
}

export interface OperationTransport {
    verbs(context: VerbContext): Partial<WriteVerbs>;
}
