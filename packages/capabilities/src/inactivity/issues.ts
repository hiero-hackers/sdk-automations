/**
 * The issue ladder: an assigned issue with no open pull request is put on the
 * reminder ladder, one assignee at a time.
 *
 * One intent per stale assignee — the act where the ladder reaps, carrying
 * the reminder's words as grace, and the reminder itself where it does not.
 */

import {
    assigneeClock,
    CANCELLED_BY,
    lasting,
    people,
    REVERSES_WITH,
    type AssigneeClock,
    type Clock,
    type IntentFor,
} from "@hiero-hackers/automation-core/author";
import type { LadderContext } from "./context.js";
import type { InactivityDeclaration, IssueLadderFacts } from "./declaration.js";
import {
    exemptLogin,
    graceHoursOf,
    ladderOf,
    reaps,
    stillOnTheLadder,
    type Ladder,
    type Reaping,
} from "./ladder.js";
import { issueReleaseNotice, issueReminder } from "./messages.js";

export async function onIssue(
    facts: IssueLadderFacts,
    context: LadderContext,
): Promise<readonly IntentFor<InactivityDeclaration>[]> {
    const { issues } = context.settings;
    if (!stillOnTheLadder(facts, context.settings)) return [];
    if (!issues.enabled) return [];
    // With a pull request open, the pull-request ladder governs (design.md).
    if (facts.links.openPullRequests.length > 0) return [];
    return await onIssueLadder(facts, ladderOf(issues), context);
}

/** What one issue past its ladder is worth saying and doing about. */
async function onIssueLadder(
    facts: IssueLadderFacts,
    ladder: Ladder,
    context: LadderContext,
): Promise<readonly IntentFor<InactivityDeclaration>[]> {
    const intents: IntentFor<InactivityDeclaration>[] = [];
    for (const assignee of await people(context.platform, facts.assignees)) {
        if (exemptLogin(assignee.login, context.settings)) continue;
        const clock = assigneeClock(assignee, context.observedAt);
        if (clock.idleHours < ladder.remindAfter) continue;
        intents.push(
            reaps(ladder)
                ? release(context, assignee, clock, ladder)
                : remind(context, assignee, clock, ladder),
        );
    }
    return intents;
}

/**
 * The release, carrying the reminder's words as grace. One assignee per
 * intent, so one name per warning.
 */
function release(
    { platform, observedAt }: LadderContext,
    assignee: AssigneeClock,
    clock: Clock,
    ladder: Reaping,
): IntentFor<InactivityDeclaration> {
    return platform.intent({
        operation: "releaseAssignment",
        desired: { login: assignee.login },
        cause: "assignmentWentStale",
        // Dated at the clock's start, not the sweep: the occasion is the idle run.
        occasion: clock.idleSince,
        explain: {
            summary: `Warned ${assignee.login} about a stale assignment; the release follows the grace.`,
            detail: [
                `idle ${lasting(clock.idleHours)}`,
                `releases after ${lasting(ladder.reapAfter)}`,
            ],
        },
        grace: {
            hours: graceHoursOf(ladder),
            // Two stale assignees are two warnings on one issue (D145).
            topic: assignee.login,
            warning: { body: issueReminder([assignee.login], ladder, observedAt) },
            notice: { body: issueReleaseNotice(ladder.reapAfter) },
            cancelledBy: CANCELLED_BY,
            reversesWith: REVERSES_WITH,
            // Their own `/working`, and no one else's.
            activityAt: assignee.lastWorkingAt,
        },
    });
}

/**
 * The reminder alone, for a ladder whose `reap` block is absent or parked. It
 * takes the identity the platform's own warning would have taken.
 */
function remind(
    { platform, observedAt }: LadderContext,
    assignee: AssigneeClock,
    clock: Clock,
    ladder: Ladder,
): IntentFor<InactivityDeclaration> {
    return platform.intent({
        operation: "postManagedComment",
        desired: {
            kind: "warning",
            topic: assignee.login,
            body: issueReminder([assignee.login], ladder, observedAt),
        },
        cause: "assignmentWentStale",
        occasion: clock.idleSince,
        explain: {
            summary: `Reminded ${assignee.login} about a stale assignment; this ladder releases nothing.`,
            detail: [`idle ${lasting(clock.idleHours)}`],
        },
    });
}
