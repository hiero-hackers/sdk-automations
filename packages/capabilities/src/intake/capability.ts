/**
 * intake — walk a new issue from its opening to triaged, ready work
 * (`design.md`): the label, and the announcement a repository may ask for.
 * The words are `messages.ts`.
 */

import {
    declareCapability,
    type Capability,
    type IntentFor,
} from "@hiero-hackers/automation-core/author";
import { TRIAGE_ANNOUNCED, TRIAGE_APPROVED, TRIAGE_LOCKED } from "./messages.js";
import { INTAKE_SETTINGS } from "./settings.js";

export const intakeDeclaration = declareCapability({
    name: "intake",
    triggers: [{ kind: "event", event: "issues" }],
    settings: INTAKE_SETTINGS,
    requiredMappings: { labels: ["awaitingTriage"] },
    labels: ["awaitingTriage"],
    resolvers: ["isAutomationActor"],
    intents: ["applyMappedLabel", "postManagedComment", "lockIssue", "unlockIssue"],
});

export type IntakeDeclaration = typeof intakeDeclaration;

export const intake: Capability<IntakeDeclaration> = {
    declaration: intakeDeclaration,

    async evaluate(facts, config, platform) {
        if (facts.arrival === null) return [];

        const participant = facts.arrival.kind === "opened" ? facts.author : facts.actor?.login;
        if (participant === undefined) return [];
        if (await platform.ask("isAutomationActor", { login: participant })) return [];

        // A conflicted item has no position to reason from, and D35 forbids repair.
        if (facts.position.kind === "conflict") {
            return platform.skip(
                "Skipped: the item holds more than one workflow position.",
                `conflicting: ${facts.position.positions.join(", ")}`,
                "a conflict is reported, never repaired (D35)",
            );
        }

        if (facts.arrival?.kind === "label") {
            if (
                facts.arrival.meaning === null ||
                !config.settings.unlockWhen.includes(facts.arrival.meaning)
            ) {
                return [];
            }
            const intents: IntentFor<IntakeDeclaration>[] = [];
            if (facts.locked) {
                intents.push(
                    platform.intent({
                        operation: "unlockIssue",
                        desired: { reason: "a maintainer approved the issue" },
                        explain: "Unlocked the approved issue.",
                    }),
                );
            }
            if (config.settings.confirmUnlock) {
                intents.push(
                    platform.intent({
                        operation: "postManagedComment",
                        desired: { kind: "notice", topic: "approval", body: TRIAGE_APPROVED },
                        explain: "Confirmed the issue approval.",
                    }),
                );
            }
            return intents;
        }

        if (facts.arrival?.kind !== "opened") return [];

        // Already positioned somewhere — intake is the entry gate only.
        if (facts.position.state.meaning !== null) return [];

        const intents: IntentFor<IntakeDeclaration>[] = [
            platform.intent({
                operation: "applyMappedLabel",
                desired: { meaning: "awaitingTriage" },
                cause: "issueWithoutPosition",
                explain: "Placed the new issue in triage.",
            }),
        ];

        if (config.settings.announce) {
            intents.push(
                platform.intent({
                    operation: "postManagedComment",
                    desired: {
                        kind: "notice",
                        topic: "welcome",
                        body:
                            config.settings.unlockWhen.length > 0
                                ? TRIAGE_LOCKED
                                : TRIAGE_ANNOUNCED,
                    },
                    cause: "issueWithoutPosition",
                    explain: "Announced the triage placement.",
                }),
            );
        }

        if (config.settings.unlockWhen.length > 0 && !facts.locked) {
            intents.push(
                platform.intent({
                    operation: "lockIssue",
                    desired: { reason: "the issue is waiting for maintainer review" },
                    explain: "Locked the issue while it waits for review.",
                }),
            );
        }

        return intents;
    },
};
