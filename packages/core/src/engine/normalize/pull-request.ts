/**
 * The pull-request family: what a `pull_request` delivery becomes once the
 * shared preamble has read it. `readiness` is the one group the payload
 * carries whole; every other is `UNREAD`, never invented.
 */

import { UNREAD } from "../../catalogue.js";
import type { ProducedFacts } from "../../capability/index.js";
import { projectPullRequest, type ClosureReason } from "../../workflow/index.js";
import type { DeliveryFacts } from "./payload.js";
import { malformed, type NormalizeResult } from "./verdict.js";

/** The one readiness fact a delivery carries — refused, never defaulted to `false`. */
function draftState(item: Record<string, unknown>): boolean | null {
    return typeof item["draft"] === "boolean" ? item["draft"] : null;
}

/** Pull-request closure: `merged` is authoritative (D47 keeps them distinct). */
function prClosure(item: Record<string, unknown>): ClosureReason | null {
    if (item["merged"] === true) return "merged";
    return item["state"] === "closed" ? "closedByHuman" : null;
}

/** The `pull_request` entry of the registry. */
export const pullRequestNormalizer = {
    event: "pull_request",
    itemKey: "pull_request",
    normalize(facts: DeliveryFacts): NormalizeResult {
        if (typeof facts.item["merged"] !== "boolean") {
            return malformed("mergedMissing", "pull_request: merged missing");
        }
        const draft = draftState(facts.item);
        if (draft === null) {
            return malformed("draftMissing", "pull_request: draft missing");
        }
        return {
            kind: "facts",
            facts: {
                kind: "pullRequest",
                repository: facts.repository,
                item: { kind: "pullRequest", number: facts.number },
                observedAt: facts.observedAt,
                trigger: {
                    kind: "event",
                    event: "pull_request",
                    ...(facts.deliveryId === undefined ? {} : { deliveryId: facts.deliveryId }),
                },
                author: facts.author,
                actor: facts.actor,
                alerts: facts.alerts,
                position: projectPullRequest({
                    closedBy: prClosure(facts.item),
                    meanings: facts.meanings,
                }),
                assignees: UNREAD,
                links: UNREAD,
                review: UNREAD,
                readiness: { draft },
            } satisfies ProducedFacts<"pull_request", "pullRequest">,
        };
    },
} as const;
