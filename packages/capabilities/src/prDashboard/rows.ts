/**
 * What each enabled check asks the platform, and the row it earns: one read
 * shared by the two commit checks, one per linked issue for the assignment,
 * and one profile read for every enabled signal.
 */

import {
    type ItemRef,
    type ResolverAnswer,
    type SettingsOf,
} from "@hiero-hackers/automation-core/author";
import {
    assignedIssues,
    dcoSignoff,
    gpgSignature,
    linkedIssues,
    mergeConflicts,
    undetermined,
    type Assigned,
    type CheckName,
    type Row,
} from "./checks.js";
import { prDashboardDeclaration, type Platform } from "./declaration.js";
import { PR_DASHBOARD_SETTINGS } from "./settings.js";
import { anySignal, notesFor, type Note, type Signals } from "./signals.js";

export type Checks = SettingsOf<typeof PR_DASHBOARD_SETTINGS>["checks"];

/** The row for a check whose resolver did not answer, with the reason on the operator surface. */
function unanswered(
    platform: Platform,
    check: CheckName,
    answer: ResolverAnswer<unknown> & { readonly ok: false },
): Row {
    platform.explain({
        capability: prDashboardDeclaration.name,
        summary: `The ${check} check could not run: a resolver could not answer.`,
        detail: [`resolver reason: ${answer.reason}`, answer.detail],
    });
    return undetermined(check);
}

export const anyEnabled = (checks: Checks): boolean =>
    [checks.dcoSignoff, checks.gpgSignature, checks.mergeConflicts, checks.linkedIssues].some(
        (check) => check.enabled,
    );

/** The two commit checks share one read of the commits. */
async function commitRows(checks: Checks, item: ItemRef, platform: Platform): Promise<Row[]> {
    const { dcoSignoff: dco, gpgSignature: gpg } = checks;
    if (!dco.enabled && !gpg.enabled) return [];
    const commits = await platform.resolve("commitAttestations", { item });
    const rows: Row[] = [];
    if (dco.enabled) {
        rows.push(
            commits.ok
                ? dcoSignoff(commits.value, dco.guide)
                : unanswered(platform, "dcoSignoff", commits),
        );
    }
    if (gpg.enabled) {
        rows.push(
            commits.ok
                ? gpgSignature(commits.value, gpg.guide)
                : unanswered(platform, "gpgSignature", commits),
        );
    }
    return rows;
}

async function mergeRows(checks: Checks, item: ItemRef, platform: Platform): Promise<Row[]> {
    if (!checks.mergeConflicts.enabled) return [];
    const mergeable = await platform.resolve("mergeability", { item });
    return [
        mergeable.ok
            ? mergeConflicts(mergeable.value)
            : unanswered(platform, "mergeConflicts", mergeable),
    ];
}

/** The issues among the links, each once, so one assignee read serves a repeated reference. */
function distinctIssues(linked: readonly ItemRef[]): readonly ItemRef[] {
    const byNumber = new Map(
        linked.filter((item) => item.kind === "issue").map((item) => [item.number, item]),
    );
    return [...byNumber.values()];
}

/** Each linked issue's assignees, or the first read that failed. */
async function assigneesOf(
    linked: readonly ItemRef[],
    platform: Platform,
): Promise<ResolverAnswer<readonly Assigned[]>> {
    const assigned: Assigned[] = [];
    for (const item of linked) {
        const logins = await platform.resolve("assigneesOf", { item });
        if (!logins.ok) return logins;
        assigned.push({ item, logins: logins.value });
    }
    return { ok: true, value: assigned };
}

/** The link row, then the assignment row that depends on it. */
async function linkRows(
    checks: Checks,
    item: ItemRef,
    author: string,
    platform: Platform,
): Promise<Row[]> {
    const check = checks.linkedIssues;
    if (!check.enabled) return [];
    const linked = await platform.resolve("linkedIssues", { item });
    const rows: Row[] = [
        linked.ok
            ? linkedIssues(linked.value, check.guide)
            : unanswered(platform, "linkedIssues", linked),
    ];
    const sub = check.assignedIssues;
    if (!sub.enabled) return rows;
    // The links could not be read: the link row says so, and this one cannot be judged either.
    if (!linked.ok) return [...rows, undetermined("assignedIssues")];
    const assigned = await assigneesOf(distinctIssues(linked.value), platform);
    return [
        ...rows,
        assigned.ok
            ? assignedIssues(author, assigned.value, sub.guide)
            : unanswered(platform, "assignedIssues", assigned),
    ];
}

/** Every enabled check's row, in the dashboard's order. */
export async function rowsFor(
    checks: Checks,
    item: ItemRef,
    author: string,
    platform: Platform,
): Promise<Row[]> {
    return [
        ...(await commitRows(checks, item, platform)),
        ...(await mergeRows(checks, item, platform)),
        ...(await linkRows(checks, item, author, platform)),
    ];
}

/** Every enabled signal's note, from one profile read; an unanswered read makes each one unknown. */
export async function signalNotes(
    signals: Signals,
    item: ItemRef,
    platform: Platform,
): Promise<Note[]> {
    if (!anySignal(signals)) return [];
    const profile = await platform.resolve("pullRequestProfile", { item });
    if (profile.ok) return notesFor(signals, profile.value);
    platform.explain({
        capability: prDashboardDeclaration.name,
        summary: "The reviewer signals are unknown: a resolver could not answer.",
        detail: [`resolver reason: ${profile.reason}`, profile.detail],
    });
    return notesFor(signals, null);
}
