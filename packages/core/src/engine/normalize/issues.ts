/**
 * The issue family: what an `issues` delivery becomes once the shared preamble
 * has read it. A group the webhook cannot see is `UNREAD`, never invented.
 */

import { UNREAD } from "../../catalogue.js";
import type { ProducedFacts } from "../../capability/index.js";
import { projectIssue, type ClosureReason } from "../../workflow/index.js";
import { lockedOf, type DeliveryFacts } from "./payload.js";
import { malformed, type NormalizeResult } from "./verdict.js";

/**
 * Closure from what the webhook alone can see: `completedByLinkedMerge` (D47)
 * is not on this payload, so a closed issue reads `closedByHuman`.
 */
function issueClosure(item: Record<string, unknown>): ClosureReason | null {
    return item["state"] === "closed" ? "closedByHuman" : null;
}

/** The `issues` entry of the registry. */
export const issuesNormalizer = {
    event: "issues",
    itemKey: "issue",
    normalize(facts: DeliveryFacts): NormalizeResult {
        const locked = lockedOf(facts.item);
        if (locked === null) return malformed("lockedMissing", "issues: locked missing");
        return {
            kind: "facts",
            facts: {
                kind: "issue",
                repository: facts.repository,
                item: { kind: "issue", number: facts.number },
                observedAt: facts.observedAt,
                trigger: { kind: "event", event: "issues" },
                author: facts.author,
                actor: facts.actor,
                locked,
                arrival:
                    facts.action === "opened"
                        ? { kind: "opened" }
                        : facts.action === "labeled"
                          ? { kind: "label", meaning: facts.arrivedMeaning }
                          : null,
                alerts: facts.alerts,
                position: projectIssue({
                    closedBy: issueClosure(facts.item),
                    meanings: facts.meanings,
                }),
                assignees: UNREAD,
                links: UNREAD,
                command: UNREAD,
            } satisfies ProducedFacts<"issues", "issue">,
        };
    },
} as const;
