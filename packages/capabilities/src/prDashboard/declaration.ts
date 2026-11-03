/** What prDashboard is woken for, reads, asks and may do — the declaration alone, so `rows.ts` and `capability.ts` share it without a cycle. */

import { declareCapability, type PlatformHandle } from "@hiero-hackers/automation-core/author";
import { PR_DASHBOARD_SETTINGS } from "./settings.js";

export const prDashboardDeclaration = declareCapability({
    name: "prDashboard",
    triggers: [
        { kind: "event", event: "pull_request" },
        { kind: "schedule", description: "hourly recheck of every open pull request" },
    ],
    needs: ["readiness"],
    /** Read on the sweep only: a webhook record carries it `"unread"`, and the verdict says so (D245). */
    wants: ["review"],
    settings: PR_DASHBOARD_SETTINGS,
    moves: ["checksPassed", "checksFailed", "revisionResolved", "reviewRequestedChanges"],
    reads: ["readyToMerge"],
    resolvers: [
        "isAutomationActor",
        "linkedIssues",
        "commitAttestations",
        "mergeability",
        "assigneesOf",
    ],
    intents: ["postManagedComment", "applyMappedLabel"],
});

export type PrDashboardDeclaration = typeof prDashboardDeclaration;

export type Platform = PlatformHandle<PrDashboardDeclaration>;
