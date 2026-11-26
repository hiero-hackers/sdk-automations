/**
 * The facts the dashboard shows reviewers under its checks: what GitHub states
 * about the description, the author and the diff. No check and no verdict
 * reads them, and a fact GitHub did not give is unknown, never either answer.
 */

import { type PullRequestProfile, type SettingsOf } from "@hiero-hackers/automation-core/author";
import { PR_DASHBOARD_SETTINGS } from "./settings.js";

export type Signals = SettingsOf<typeof PR_DASHBOARD_SETTINGS>["signals"];

/** One enabled signal and what GitHub said; `null` is GitHub not saying. */
export type Note =
    | { readonly signal: "blankDescription"; readonly blank: boolean | null }
    | { readonly signal: "firstContribution"; readonly first: boolean | null }
    | { readonly signal: "diffSize"; readonly size: DiffSize | null };

export interface DiffSize {
    readonly additions: number;
    readonly deletions: number;
    readonly files: number;
    /** The repository's mark, and whether the lines changed pass it. */
    readonly mark: number;
    readonly above: boolean;
}

export const anySignal = (signals: Signals): boolean =>
    [signals.blankDescription, signals.firstContribution, signals.diffSize].some(
        (signal) => signal.enabled,
    );

function diffSizeOf(profile: PullRequestProfile, mark: number): DiffSize {
    const { additions, deletions, changedFiles } = profile;
    return { additions, deletions, files: changedFiles, mark, above: additions + deletions > mark };
}

/** A note per enabled signal, in the dashboard's order; `profile` is `null` when it could not be read. */
export function notesFor(signals: Signals, profile: PullRequestProfile | null): Note[] {
    const notes: Note[] = [];
    if (signals.blankDescription.enabled) {
        notes.push({ signal: "blankDescription", blank: profile?.blankDescription ?? null });
    }
    if (signals.firstContribution.enabled) {
        notes.push({ signal: "firstContribution", first: profile?.firstContribution ?? null });
    }
    if (signals.diffSize.enabled) {
        const size = profile === null ? null : diffSizeOf(profile, signals.diffSize.lines);
        notes.push({ signal: "diffSize", size });
    }
    return notes;
}

/** The note as the operator surface lists it beside the rows. */
export function noteDetail(note: Note): string {
    switch (note.signal) {
        case "blankDescription":
            return `blankDescription: ${note.blank === null ? "unknown" : String(note.blank)}`;
        case "firstContribution":
            return `firstContribution: ${note.first === null ? "unknown" : String(note.first)}`;
        case "diffSize":
            return note.size === null
                ? "diffSize: unknown"
                : `diffSize: ${String(note.size.additions + note.size.deletions)} lines, ${String(note.size.files)} files`;
    }
}
