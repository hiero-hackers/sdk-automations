/**
 * The five judgements of `design.md`'s check table, each a pure function from
 * a resolver's answer to one row of the dashboard. The words are `messages.ts`.
 */

import { inert, type CommitAttestation, type ItemRef } from "@hiero-hackers/automation-core/author";

/** The checks, in the order the dashboard lists them. */
export const CHECKS = [
    "dcoSignoff",
    "gpgSignature",
    "mergeConflicts",
    "linkedIssues",
    "assignedIssues",
] as const;

export type CheckName = (typeof CHECKS)[number];

/** One row. `undetermined` is a resolver that could not answer — never a pass (D51). */
export interface Row {
    readonly check: CheckName;
    readonly outcome: "pass" | "fail" | "undetermined";
    /** What the row names: failing commits or issues, or the issues a pass links. */
    readonly listed: readonly string[];
    readonly guide: string | null;
}

export const determined = (row: Row): boolean => row.outcome === "pass" || row.outcome === "fail";

/** The positions the dashboard's verdict may set, and no other (`design.md` phase 2). */
export const VERDICT_POSITIONS = ["needsRevision", "needsReview"] as const;

export type VerdictPosition = (typeof VERDICT_POSITIONS)[number];

/**
 * Any failure asks for revision; so does an outstanding change request (D241), from `needsReview` alone.
 * Review is asked only when every row passes on a ready pull request whose review state is read and
 * clear, from no position or `needsRevision`: never from `readyToMerge`, never unread, as on a webhook (D245).
 */
export function positionFor(
    rows: readonly Row[],
    draft: boolean,
    current: string | null,
    changesOutstanding: boolean | null,
): VerdictPosition | null {
    if (rows.some((row) => row.outcome === "fail")) return "needsRevision";
    if (changesOutstanding === true) return current === "needsReview" ? "needsRevision" : null;
    const reviewable = current === null || current === "needsRevision";
    if (
        !draft &&
        reviewable &&
        changesOutstanding === false &&
        rows.every((row) => row.outcome === "pass")
    ) {
        return "needsReview";
    }
    return null;
}

/** How many failing commits or issues one row names before it counts the rest. */
const MAX_LISTED = 20;

const SHORT_SHA = 7;

/** A commit as the dashboard names it; the subject line is the author's, so inert. */
const commitLine = (commit: CommitAttestation): string =>
    `\`${inert(commit.sha.slice(0, SHORT_SHA))}\` ${inert(commit.summary)}`;

const issueRef = (item: ItemRef): string => `#${String(item.number)}`;

const pass = (check: CheckName, listed: readonly string[] = []): Row => ({
    check,
    outcome: "pass",
    listed,
    guide: null,
});

/** A failure naming at most `MAX_LISTED` offenders and counting the rest. */
function fail(check: CheckName, failing: readonly string[], guide: string | null): Row {
    const rest = failing.length - MAX_LISTED;
    const listed =
        rest > 0 ? [...failing.slice(0, MAX_LISTED), `…and ${String(rest)} more`] : failing;
    return { check, outcome: "fail", listed, guide };
}

export const undetermined = (check: CheckName): Row => ({
    check,
    outcome: "undetermined",
    listed: [],
    guide: null,
});

/** Every commit but GitHub's own merges carries a sign-off. */
export function dcoSignoff(commits: readonly CommitAttestation[], guide: string | null): Row {
    const unsigned = commits.filter((commit) => !commit.merge && !commit.signedOff);
    return unsigned.length === 0
        ? pass("dcoSignoff")
        : fail("dcoSignoff", unsigned.map(commitLine), guide);
}

/** Every commit, merges included, has a signature GitHub verified. */
export function gpgSignature(commits: readonly CommitAttestation[], guide: string | null): Row {
    const unverified = commits.filter((commit) => !commit.verified);
    return unverified.length === 0
        ? pass("gpgSignature")
        : fail("gpgSignature", unverified.map(commitLine), guide);
}

export const mergeConflicts = (mergeable: boolean): Row =>
    mergeable ? pass("mergeConflicts") : fail("mergeConflicts", [], null);

/** A pass names what is linked; a failure names nothing. */
export const linkedIssues = (linked: readonly ItemRef[], guide: string | null): Row =>
    linked.length === 0
        ? fail("linkedIssues", [], guide)
        : pass("linkedIssues", linked.map(issueRef));

/** One linked issue with the logins assigned to it. */
export interface Assigned {
    readonly item: ItemRef;
    readonly logins: readonly string[];
}

/** GitHub logins are case-insensitive. */
const sameLogin = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

/** The author is assigned to every linked issue; with nothing linked there is nothing to check against. */
export function assignedIssues(
    author: string,
    assigned: readonly Assigned[],
    guide: string | null,
): Row {
    if (assigned.length === 0) return fail("assignedIssues", [], guide);
    const unassigned = assigned.filter(
        (issue) => !issue.logins.some((login) => sameLogin(login, author)),
    );
    return unassigned.length === 0
        ? pass("assignedIssues")
        : fail(
              "assignedIssues",
              unassigned.map((issue) => issueRef(issue.item)),
              guide,
          );
}
