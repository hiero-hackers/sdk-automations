/**
 * PROBE — comment-only, event-triggered, non-idempotent, resolver-using.
 *
 * The narrowest shape in the triad: reads a pull request, asks one
 * resolver, writes at most one managed comment, needs no durable state,
 * no mapped meanings and — since D125 took the marker off it — no
 * settings either. It exists to prove the boundary works for a
 * capability that touches almost nothing, so it takes no view at all.
 *
 * Not a scope decision. See `probes/README.md`.
 */

import {
    closureOf,
    declareCapability,
    intentFactoryFor,
    type Capability,
} from "@hiero-hackers/automation-core";

export const prQualityDeclaration = declareCapability({
    name: "prQuality",
    triggers: [{ kind: "event", event: "pull_request" }],
    configKeys: [],
    requiredMeanings: [],
    observations: ["pullRequestUpdated"],
    resolvers: ["linkedIssues"],
    intents: ["postManagedComment"],
    operationalNeeds: {
        schedule: false,
        durableState: "none",
        crossItemCoordination: false,
        externalDelivery: false,
    },
});

export type PrQualityDeclaration = typeof prQualityDeclaration;

export const prQuality: Capability<PrQualityDeclaration> = {
    declaration: prQualityDeclaration,

    async evaluate(observation, _config, platform) {
        /**
         * Closure is carried on BOTH projection branches (D59), and reading it
         * only from the position branch would have asked for a comment on a
         * merged pull request whose labels happened to conflict.
         *
         * A conflict is not checked here, because this capability reads no
         * position. It does not follow that a conflicted pull request gets a
         * comment: `deriveWorld` establishes no precondition from a conflicted
         * projection, so the engine refuses every intent on one with
         * `preconditionStale`.
         */
        if (closureOf(observation.position) !== null) return [];

        const linked = await platform.resolve("linkedIssues", {
            item: observation.item,
        });
        /**
         * resolvers.md §6 as behaviour rather than a promise: an
         * undetermined answer is NOT "no linked issue". Without the
         * `ResolverAnswer` union this capability would have read a
         * rate-limit failure as a quality problem and told a contributor
         * to link an issue they had already linked.
         */
        if (!linked.ok) {
            platform.explain({
                capability: "prQuality",
                summary: "Skipped: the linked-issue resolver could not answer.",
                detail: [`resolver reason: ${linked.reason}`, linked.detail],
            });
            return [];
        }
        if (linked.value.length > 0) return [];

        const make = intentFactoryFor(prQualityDeclaration, {
            repository: observation.repository,
            item: observation.item,
            observedAt: observation.observedAt,
        });
        return [
            make({
                operation: "postManagedComment",
                desired: {
                    kind: "summary",
                    body: "This pull request does not reference an issue. Adding a closing reference keeps the issue and the pull request in step.",
                },
                cause: "pullRequestWithoutLinkedIssue",
                expected: { closed: false },
                explain: {
                    summary: "No linked issue found on this pull request.",
                    detail: ["checked via the linkedIssues resolver"],
                },
            }),
        ];
    },
};
