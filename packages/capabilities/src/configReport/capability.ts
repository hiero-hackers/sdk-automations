/**
 * configReport — the pull request's own report on `sdk-automations.yml`, built
 * against `design.md`. The rendering is `render.ts`.
 *
 * Content at a pull request's head sha is fork-authored: a report input only.
 */

import { declareCapability, type Capability } from "@hiero-hackers/automation-core/author";
import { renderReport } from "./render.js";
import { CONFIG_REPORT_SETTINGS } from "./settings.js";

export const configReportDeclaration = declareCapability({
    name: "configReport",
    triggers: [{ kind: "event", event: "pull_request" }],
    settings: CONFIG_REPORT_SETTINGS,
    resolvers: ["configAtHead"],
    intents: ["postManagedComment"],
});

export type ConfigReportDeclaration = typeof configReportDeclaration;

export const configReport: Capability<ConfigReportDeclaration> = {
    declaration: configReportDeclaration,

    async evaluate(facts, _config, platform) {
        // The resolver answers "touched" as well, so it is asked above that guard (D51).
        const proposed = await platform.ask("configAtHead", { item: facts.item });
        if (!proposed.touched) return [];

        return [
            platform.intent({
                operation: "postManagedComment",
                desired: {
                    kind: "summary",
                    body: renderReport(proposed.revision, proposed.result),
                },
                cause: "pullRequestChangesConfiguration",
                explain: {
                    summary: "Reported what this pull request's sdk-automations.yml would mean.",
                    detail: [`proposed configuration read at revision ${proposed.revision}`],
                },
            }),
        ];
    },
};
