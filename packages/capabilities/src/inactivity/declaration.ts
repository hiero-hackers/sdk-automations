/**
 * What inactivity declares it may receive, ask and do, and the two record
 * shapes that declaration earns it. The folder's root, below the ladders.
 */

import { declareCapability, type FactsFor } from "@hiero-hackers/automation-core/author";
import { INACTIVITY_SETTINGS } from "./settings.js";

export const inactivityDeclaration = declareCapability({
    name: "inactivity",
    triggers: [{ kind: "schedule", description: "hourly stale-assignment sweep" }],
    settings: INACTIVITY_SETTINGS,
    facts: ["issue", "pullRequest"],
    /** Each ladder's own groups: the issue ladder reads links, the pull-request ladder never does. */
    needs: {
        issue: ["assignees", "links"],
        pullRequest: ["assignees", "review", "readiness"],
    },
    reads: ["needsReview", "needsRevision"],
    resolvers: ["isAutomationActor"],
    intents: ["postManagedComment", "releaseAssignment", "closePullRequest"],
});

export type InactivityDeclaration = typeof inactivityDeclaration;

/** One record with every group read — what either ladder is handed. */
export type InactivityFacts = FactsFor<InactivityDeclaration>;

export type IssueLadderFacts = Extract<InactivityFacts, { kind: "issue" }>;

export type PullLadderFacts = Extract<InactivityFacts, { kind: "pullRequest" }>;
