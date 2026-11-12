/** Everything inactivity says, and the words it says it in. */

import { lasting, mentions, on } from "@hiero-hackers/automation-core/author";
import { deadlineOf, graceHoursOf, reaps, type Ladder, type ReapReason } from "./ladder.js";

/** The state a reminder names: the meaning's name, never a label (contract.md §2). */
const REASON_PHRASE: Readonly<Record<ReapReason, string>> = {
    needsRevision: "carried the `needsRevision` label",
    changesRequested: "had **changes requested**",
    draft: "been in **draft**",
};

/** What a reminder promises next, or nothing for a level that never acts. */
function consequence(act: string, ladder: Ladder, observedAt: Date): string {
    if (!reaps(ladder)) return "";
    return `, otherwise ${act} on ${on(deadlineOf(ladder, observedAt), graceHoursOf(ladder))}`;
}

export function issueReminder(logins: readonly string[], ladder: Ladder, observedAt: Date): string {
    const next = consequence("this assignment will be released", ladder, observedAt);
    return `⏰ Hi ${mentions(logins)} — you are assigned to this issue, but there is no pull request after ${lasting(ladder.remindAfter)}. Still working on it? Comment \`/working\` to let us know development is active${next}.`;
}

export function pullRequestReminder(
    logins: readonly string[],
    reason: ReapReason,
    ladder: Ladder,
    observedAt: Date,
): string {
    // No author on the entry, so an unassigned pull request addresses nobody.
    const opening =
        logins.length === 0
            ? "⏰ This pull request has"
            : `⏰ Hi ${mentions(logins)} — this pull request has`;
    const next = consequence("the pull request will be closed", ladder, observedAt);
    return `${opening} ${REASON_PHRASE[reason]} without development activity for ${lasting(ladder.remindAfter)}. Push a commit or comment \`/working\` to let us know you are working on it${next}.`;
}

/** The close's reason. The act's change carries it, so rewording it voids every pending warning. */
export function closeReason(reapAfter: number): string {
    return `This pull request was closed after ${lasting(reapAfter)} of inactivity.`;
}

/** What the platform posts once a close lands: the reason that fired, and the way back (grace.md §3). */
export function closeNotice(reason: ReapReason, reapAfter: number): string {
    return `This pull request was closed: it has ${REASON_PHRASE[reason]} without development activity for ${lasting(reapAfter)}. Want to keep going? Push your changes and ask a maintainer to reopen it.`;
}

/** What the platform posts once a release lands — the design's release text. */
export function issueReleaseNotice(reapAfter: number): string {
    return `This assignment was released after ${lasting(reapAfter)} with no pull request and no \`/working\`. The issue is open for anyone to pick up — you are welcome to \`/assign\` it again when you have capacity.`;
}
