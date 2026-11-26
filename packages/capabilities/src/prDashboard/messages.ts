/** Everything prDashboard says to a contributor, and the words it says it in. */

import { mentions } from "@hiero-hackers/automation-core/author";
import { type CheckName, type Row } from "./checks.js";
import { type DiffSize, type Note } from "./signals.js";

const TITLE: Readonly<Record<CheckName, string>> = {
    dcoSignoff: "DCO sign-off",
    gpgSignature: "GPG signature",
    mergeConflicts: "Merge conflicts",
    linkedIssues: "Issue link",
    assignedIssues: "Assignment",
};

const PASSED: Readonly<Record<CheckName, string>> = {
    dcoSignoff: "Every commit carries a sign-off.",
    gpgSignature: "Every commit has a verified signature.",
    mergeConflicts: "This branch merges cleanly.",
    linkedIssues: "Linked to",
    assignedIssues: "You are assigned to every linked issue.",
};

const FAILED: Readonly<Record<CheckName, string>> = {
    dcoSignoff: "These commits carry no `Signed-off-by` trailer:",
    gpgSignature: "These commits have no verified signature:",
    mergeConflicts: "This branch has conflicts with its base branch.",
    linkedIssues:
        "This pull request does not reference an issue. Adding a closing reference keeps the issue and the pull request in step.",
    assignedIssues: "You are not assigned to",
};

const UNDETERMINED: Readonly<Record<CheckName, string>> = {
    dcoSignoff: "The commits could not be read this time.",
    gpgSignature: "The commits could not be read this time.",
    mergeConflicts: "GitHub has not said yet whether this branch merges cleanly.",
    linkedIssues: "The linked issues could not be read this time.",
    assignedIssues: "The linked issues' assignees could not be read this time.",
};

const NOTHING_LINKED =
    "No issue is linked, so we cannot tell whether you are assigned to it. Link the issue this pull request closes to check assignment.";

const MARK = { pass: "✅", fail: "❌", undetermined: "⏳" } as const;

const ALL_PASS = "✅ Every check passes.";
const SOME_FAIL = "This repository requires all of these checks to pass before review.";
const SOME_UNDETERMINED =
    "⏳ A check could not run this time. It runs again on the next update to this pull request.";

/** A failing row's account: commits one per line, issues inline, or the sentence alone. */
function failed(row: Row): string {
    switch (row.check) {
        case "dcoSignoff":
        case "gpgSignature":
            return `${FAILED[row.check]}\n${row.listed.join("\n")}`;
        case "assignedIssues":
            return row.listed.length === 0
                ? NOTHING_LINKED
                : `${FAILED.assignedIssues} ${row.listed.join(", ")}.`;
        default:
            return FAILED[row.check];
    }
}

/** The row's sentence, ending in the maintainer's guide when one is set; their own text, so not `inert`. */
function sentence(row: Row): string {
    switch (row.outcome) {
        case "pass":
            return row.check === "linkedIssues"
                ? `${PASSED.linkedIssues} ${row.listed.join(", ")}.`
                : PASSED[row.check];
        case "fail":
            return row.guide === null ? failed(row) : `${failed(row)}\nSee the guide: ${row.guide}`;
        case "undetermined":
            return UNDETERMINED[row.check];
    }
}

const closing = (rows: readonly Row[]): string => {
    if (rows.some((row) => row.outcome === "fail")) return SOME_FAIL;
    if (rows.every((row) => row.outcome === "pass")) return ALL_PASS;
    return SOME_UNDETERMINED;
};

const REVIEWERS =
    "**For reviewers** — what GitHub states about this pull request. No check depends on it.";

const UNREAD = "Could not be read this time.";

function sizeSentence(size: DiffSize): string {
    const counted = `+${String(size.additions)} −${String(size.deletions)} across ${String(size.files)} files.`;
    return size.above
        ? `${counted} That is above this repository's ${String(size.mark)}-line mark.`
        : counted;
}

/** One note as a list item; no mark, because a signal neither passes nor fails. */
function noteLine(note: Note): string {
    switch (note.signal) {
        case "blankDescription": {
            const said =
                note.blank === null
                    ? UNREAD
                    : note.blank
                      ? "Blank, HTML comments aside."
                      : "Written.";
            return `- **Description** — ${said}`;
        }
        case "firstContribution": {
            const said =
                note.first === null
                    ? "GitHub does not say whether the author has contributed here before."
                    : note.first
                      ? "First contribution to this repository, by GitHub's count."
                      : "Has contributed to this repository before.";
            return `- **Author** — ${said}`;
        }
        case "diffSize":
            return `- **Size** — ${note.size === null ? UNREAD : sizeSentence(note.size)}`;
    }
}

/** The reviewers' section, or nothing when no signal is enabled. */
const reviewers = (notes: readonly Note[]): string[] =>
    notes.length === 0 ? [] : [[REVIEWERS, ...notes.map(noteLine)].join("\n")];

/** The whole dashboard: a greeting, one paragraph per enabled check, a closing line, then the reviewers' notes. */
export function dashboard(author: string, rows: readonly Row[], notes: readonly Note[]): string {
    const paragraphs = rows.map(
        (row) => `${MARK[row.outcome]} **${TITLE[row.check]}** — ${sentence(row)}`,
    );
    return [
        `Hey ${mentions([author])} 👋 Thanks for the PR!`,
        ...paragraphs,
        closing(rows),
        ...reviewers(notes),
    ].join("\n\n");
}
