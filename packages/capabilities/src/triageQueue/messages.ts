/** Everything triageQueue says to a contributor, and the words it says it in. */

import { mentions, type Skill } from "@hiero-hackers/automation-core/author";

/** One line of the triage checklist. Every row done is what a later phase's flip to `ready` reads. */
export interface ChecklistRow {
    readonly done: boolean;
    readonly text: string;
}

/** The skill row: status for the author, who cannot add labels — the team sets exactly one tier. */
export function skillRow(skills: readonly Skill[]): ChecklistRow {
    const [tier] = skills;
    if (tier === undefined)
        return { done: false, text: "Skill level — the team sets one skill label" };
    if (skills.length > 1) {
        return { done: false, text: "Skill level — more than one skill label; the team keeps one" };
    }
    return { done: true, text: `Skill level — ${tier}` };
}

/** The welcome a new issue earns; the locked form says why its author cannot reply yet, and what lifts it. */
export function welcome(
    author: string,
    locked: boolean,
    checklist: readonly ChecklistRow[],
): string {
    const opening = `👋 Hi ${mentions([author])} — thanks for opening this issue. It is in the triage queue`;
    const message = locked
        ? `${opening}, and the conversation is locked until the team has triaged it. You do not need to do anything: the lock lifts when the issue is marked ready, and we will follow up here.`
        : `${opening}; the team will triage it and follow up here.`;
    if (checklist.length === 0) return message;
    const rows = checklist.map((row) => `- [${row.done ? "x" : " "}] ${row.text}`);
    return `${message}\n\nTriage checklist:\n${rows.join("\n")}`;
}

/** The notice a released issue earns when the repository asked for one. */
/** The second sentence only when a lock was lifted: `ready` can arrive before the lock did. */
export const unlocked = (author: string, wasLocked: boolean): string =>
    `✅ Hi ${mentions([author])} — this issue has been triaged and marked ready.${
        wasLocked ? " The conversation is open again." : ""
    }`;
