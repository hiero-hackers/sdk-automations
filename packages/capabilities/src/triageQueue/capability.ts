/**
 * triageQueue — put a new issue in the triage queue: label it, welcome its author, hold it until triaged (`design.md`).
 * The lock lifts when someone with triage access adds the ready label. The words are `messages.ts`.
 */

import {
    declareCapability,
    type Capability,
    type CapabilityView,
    type IntentFor,
    type PlatformHandle,
} from "@hiero-hackers/automation-core/author";
import { skillRow, unlocked, welcome, type ChecklistRow } from "./messages.js";
import { TRIAGE_QUEUE_SETTINGS } from "./settings.js";

export const triageQueueDeclaration = declareCapability({
    name: "triageQueue",
    triggers: [{ kind: "event", event: "issues" }],
    needs: ["locked", "skills"],
    settings: TRIAGE_QUEUE_SETTINGS,
    requiredMappings: { labels: ["awaitingTriage"] },
    labels: ["awaitingTriage"],
    resolvers: ["isAutomationActor"],
    intents: ["applyMappedLabel", "postManagedComment", "lockIssue", "unlockIssue"],
});

export type TriageQueueDeclaration = typeof triageQueueDeclaration;

type Facts = Parameters<Capability<TriageQueueDeclaration>["evaluate"]>[0];
type View = CapabilityView<TriageQueueDeclaration>;
type Platform = PlatformHandle<TriageQueueDeclaration>;
type Intents = readonly IntentFor<TriageQueueDeclaration>[];
type LabelArrival = Extract<Facts["arrival"], { readonly kind: "label" }>;

/** The meaning whose arrival completes triage: the map's one edge out of `awaitingTriage`. */
const TRIAGED = "ready";

/** The rows the repository asked for, in a fixed order; empty when it asked for none. */
function checklist(facts: Facts, config: View): readonly ChecklistRow[] {
    const rows: ChecklistRow[] = [];
    if (config.settings.requirements.skill) rows.push(skillRow(facts.skills));
    return rows;
}

/** The one managed welcome, posted at the gate and rewritten as the checklist changes. */
function welcomeIntent(
    facts: Facts,
    config: View,
    platform: Platform,
    rows: readonly ChecklistRow[],
    occasion: { readonly cause: string; readonly explain: string },
) {
    return platform.intent({
        operation: "postManagedComment",
        desired: {
            kind: "notice",
            topic: "welcome",
            body: welcome(facts.author, config.settings.lockUntilTriaged, rows),
        },
        cause: occasion.cause,
        explain: occasion.explain,
    });
}

/** The entry gate: the label, the welcome, then the lock — last, so the author can read why. */
function onOpened(facts: Facts, config: View, platform: Platform): Intents {
    // A conflicted item has no position to reason from, and D35 forbids repair.
    if (facts.position.kind === "conflict") {
        return platform.skip(
            "Skipped: the item holds more than one workflow position.",
            `conflicting: ${facts.position.positions.join(", ")}`,
            "a conflict is reported, never repaired (D35)",
        );
    }
    // Already past the gate — triageQueue is the entry gate only. A template-applied triage label is still at it.
    const { meaning } = facts.position.state;
    if (meaning !== null && meaning !== "awaitingTriage") return [];

    const { welcome: welcomed, lockUntilTriaged } = config.settings;
    const rows = checklist(facts, config);
    const intents: IntentFor<TriageQueueDeclaration>[] = [];
    if (meaning === null) {
        intents.push(
            platform.intent({
                operation: "applyMappedLabel",
                desired: { meaning: "awaitingTriage" },
                cause: "issueWithoutPosition",
                explain: "Placed the new issue in triage.",
            }),
        );
    }
    if (welcomed || lockUntilTriaged || rows.length > 0) {
        intents.push(
            welcomeIntent(facts, config, platform, rows, {
                cause: "issueWithoutPosition",
                explain: "Welcomed the author and said the issue awaits triage.",
            }),
        );
    }
    if (lockUntilTriaged && !facts.locked) {
        intents.push(
            platform.intent({
                operation: "lockIssue",
                desired: { reason: "the issue is waiting for triage" },
                explain: "Locked the conversation until the issue is triaged.",
            }),
        );
    }
    return intents;
}

/** A checklist label moved while the issue waits: the welcome is rewritten, and nothing else. */
function onChecklistChanged(facts: Facts, config: View, platform: Platform): Intents {
    const rows = checklist(facts, config);
    if (rows.length === 0) return [];
    if (facts.position.kind !== "position") return [];
    if (facts.position.state.meaning !== "awaitingTriage") return [];
    return [
        welcomeIntent(facts, config, platform, rows, {
            cause: "triageChecklistChanged",
            explain: "Updated the triage checklist in the welcome.",
        }),
    ];
}

/** The release: a person's `ready` unlocks whatever else the labels say, and may be announced. */
function onTriaged(facts: Facts, config: View, platform: Platform): Intents {
    if (!config.settings.lockUntilTriaged) return [];
    const intents: IntentFor<TriageQueueDeclaration>[] = [];
    if (facts.locked) {
        intents.push(
            platform.intent({
                operation: "unlockIssue",
                desired: { reason: "a person marked the issue ready" },
                explain: "Unlocked the conversation: the issue was marked ready.",
            }),
        );
    }
    if (config.settings.confirmUnlock) {
        intents.push(
            platform.intent({
                operation: "postManagedComment",
                desired: {
                    kind: "notice",
                    topic: "unlock",
                    body: unlocked(facts.author, facts.locked),
                },
                explain: facts.locked
                    ? "Said the issue is ready and its conversation open."
                    : "Said the issue is ready.",
            }),
        );
    }
    return intents;
}

/** `ready` arrived, or the stale triage label left an issue already at `ready`. */
function completesTriage(facts: Facts, arrival: LabelArrival): boolean {
    if (arrival.change === "added") return arrival.meaning === TRIAGED;
    return (
        arrival.meaning === "awaitingTriage" &&
        facts.position.kind === "position" &&
        facts.position.state.meaning === TRIAGED
    );
}

export const triageQueue: Capability<TriageQueueDeclaration> = {
    declaration: triageQueueDeclaration,

    // The author opened it; the actor labelled it. Either may be a machine, and only a person's
    // issue is welcomed or released — but a checklist label may come from anyone.
    async evaluate(facts, config, platform) {
        const { arrival } = facts;
        if (arrival === null) return [];
        const machine = (login: string) => platform.ask("isAutomationActor", { login });

        if (arrival.kind === "opened") {
            return (await machine(facts.author)) ? [] : onOpened(facts, config, platform);
        }
        if (completesTriage(facts, arrival)) {
            const actor = facts.actor?.login ?? null;
            if (actor === null || (await machine(actor))) return [];
            return onTriaged(facts, config, platform);
        }
        if (arrival.skill === null) return [];
        const update = onChecklistChanged(facts, config, platform);
        if (update.length === 0) return [];
        return (await machine(facts.author)) ? [] : update;
    },
};
