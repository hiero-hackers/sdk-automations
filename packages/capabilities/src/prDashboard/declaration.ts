/** What prDashboard is woken for, reads, asks and may do — the declaration alone, so `rows.ts` and `capability.ts` share it without a cycle. */

import { declareCapability, type PlatformHandle } from "@hiero-hackers/automation-core/author";
import { VERDICT_POSITIONS } from "./checks.js";
import { PR_DASHBOARD_SETTINGS } from "./settings.js";

export const prDashboardDeclaration = declareCapability({
    name: "prDashboard",
    triggers: [
        { kind: "event", event: "pull_request" },
        { kind: "schedule", description: "hourly recheck of every open pull request" },
    ],
    needs: ["readiness"],
    settings: PR_DASHBOARD_SETTINGS,
    labels: VERDICT_POSITIONS,
    resolvers: [
        "isAutomationActor",
        "linkedIssues",
        "commitAttestations",
        "mergeability",
        "assigneesOf",
        "pullRequestProfile",
    ],
    intents: ["postManagedComment", "applyMappedLabel"],
});

export type PrDashboardDeclaration = typeof prDashboardDeclaration;

export type Platform = PlatformHandle<PrDashboardDeclaration>;
