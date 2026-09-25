/**
 * The issue-comment family: what an `issue_comment` delivery becomes once the
 * shared preamble has read it — an ordinary issue record whose command is a
 * fact group projected through `mappings.commands`, so a capability reads
 * `assign`, never `/assign`. Only a `created` action carries a command; an
 * edit reads `command: null`, not `UNREAD`.
 */

import { UNREAD, type CommandFacts } from "../../catalogue.js";
import type { ProducedFacts } from "../../capability/index.js";
import { commandInComment } from "../../config/index.js";
import { projectIssue, type ClosureReason } from "../../workflow/index.js";
import { isRecord, lockedOf, timestamp, type DeliveryFacts } from "./payload.js";
import { malformed, type NormalizeResult } from "./verdict.js";

/** Issue closure, from what this payload alone can see — `issues.ts`'s reading. */
function issueClosure(item: Record<string, unknown>): ClosureReason | null {
    return item["state"] === "closed" ? "closedByHuman" : null;
}

/** What the comment readably says, or `null` when its shape is not GitHub's. */
function commentOf(
    facts: DeliveryFacts,
): { readonly body: string; readonly by: string; readonly at: Date } | null {
    const comment = facts.payload["comment"];
    if (!isRecord(comment)) return null;
    const user = comment["user"];
    const at = timestamp(comment["created_at"]);
    if (typeof comment["body"] !== "string" || !isRecord(user) || at === null) return null;
    if (typeof user["login"] !== "string" || user["login"] === "") return null;
    return { body: comment["body"], by: user["login"], at };
}

/** The command this delivery issued, or `null` for a delivery that issued none. */
function commandIssued(
    facts: DeliveryFacts,
    comment: { readonly body: string; readonly by: string; readonly at: Date },
): CommandFacts | null {
    if (facts.payload["action"] !== "created") return null;
    const command = commandInComment(facts.config, comment.body);
    return command === null ? null : { command, by: comment.by, at: comment.at };
}

/** The `issue_comment` entry of the registry. */
export const issueCommentNormalizer = {
    event: "issue_comment",
    itemKey: "issue",
    normalize(facts: DeliveryFacts): NormalizeResult {
        if (facts.item["pull_request"] !== undefined) {
            return malformed(
                "commentUnreadable",
                "issue_comment: a comment on a pull request carries no merged state",
            );
        }
        const comment = commentOf(facts);
        if (comment === null) {
            return malformed("commentUnreadable", "issue_comment: comment unreadable");
        }
        const locked = lockedOf(facts.item);
        if (locked === null) return malformed("lockedMissing", "issue_comment: locked missing");
        return {
            kind: "facts",
            facts: {
                kind: "issue",
                repository: facts.repository,
                item: { kind: "issue", number: facts.number },
                observedAt: facts.observedAt,
                trigger: {
                    kind: "event",
                    event: "issue_comment",
                    ...(facts.deliveryId === undefined ? {} : { deliveryId: facts.deliveryId }),
                },
                author: facts.author,
                actor: facts.actor,
                locked,
                arrival: null,
                skills: facts.skills,
                alerts: facts.alerts,
                position: projectIssue({
                    closedBy: issueClosure(facts.item),
                    meanings: facts.meanings,
                }),
                assignees: UNREAD,
                links: UNREAD,
                command: commandIssued(facts, comment),
            } satisfies ProducedFacts<"issue_comment", "issue">,
        };
    },
} as const;
