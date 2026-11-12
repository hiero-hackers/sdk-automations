/**
 * The pull-request ladder: a pull request whose ball is the contributor's is
 * put on the reminder ladder. An intent may only name its own item.
 *
 * One intent — the close where the level reaps, carrying the reminder's words
 * as grace, and the reminder itself where it does not.
 */

import {
    CANCELLED_BY,
    changesOutstanding,
    isConflicted,
    lasting,
    latestOf,
    meaningsOf,
    people,
    pullRequestClock,
    REVERSES_WITH,
    type ClaimedFacts,
    type Clock,
    type IntentFor,
} from "@hiero-hackers/automation-core/author";
import type { InactivitySettings, LadderContext } from "./context.js";
import type { InactivityDeclaration, PullLadderFacts } from "./declaration.js";
import { exemptedAsBlocked, exemptedAuthor, type AuthorExemption } from "./exemptions.js";
import {
    exemptAsBlocked,
    exemptLogin,
    graceHoursOf,
    ladderOf,
    REAP_REASONS,
    reaps,
    type Ladder,
    type ReapReason,
    type Reaping,
} from "./ladder.js";
import { closeNotice, closeReason, pullRequestReminder } from "./messages.js";

/** The first enabled reason that holds, with the clocks it resolved. */
interface Reapable extends Ladder {
    readonly reason: ReapReason;
}

/** The mode the two native reasons read; a label's meaning the record derives. */
function claimsFor(reason: ReapReason): Partial<ClaimedFacts> {
    return reason === "needsRevision" ? {} : { pullRequestMode: reason };
}

/** The pull-request ladder once its block has consented — `enabled: true`. */
type PullRequestLadder = Extract<InactivitySettings["pullRequests"], { readonly enabled: true }>;

/**
 * Which reason governs this pull request, or `null` for none — no reapable
 * mode, or one the repository did not opt into.
 */
function reapableFor(facts: PullLadderFacts, pullRequests: PullRequestLadder): Reapable | null {
    const holds: Readonly<Record<ReapReason, boolean>> = {
        needsRevision: meaningsOf(facts).includes("needsRevision"),
        changesRequested: changesOutstanding(facts.review),
        draft: facts.readiness.draft,
    };
    for (const reason of REAP_REASONS) {
        const opted = pullRequests.reapWhen[reason];
        if (opted.enabled && holds[reason]) return { reason, ...ladderOf(opted) };
    }
    return null;
}

export async function onPullRequest(
    facts: PullLadderFacts,
    context: LadderContext,
): Promise<readonly IntentFor<InactivityDeclaration>[]> {
    const { pullRequests } = context.settings;
    if (isConflicted(facts)) return [];
    if (!pullRequests.enabled) return [];

    // A pull request awaiting review is the maintainers' wait, not the contributor's. One a reviewer
    // sent back waits on its author, until a newer commit answers, whatever its label (D240, D241).
    if (meaningsOf(facts).includes("needsReview") && !changesOutstanding(facts.review)) return [];

    // In a reapable mode the repository opted into, or nothing to say.
    const reapable = reapableFor(facts, pullRequests);
    if (reapable === null) return [];

    const clock = pullRequestClock(facts, reapable.reason, context.observedAt);
    if (clock.idleHours < reapable.remindAfter) return [];
    return await onPullRequestLadder(facts, reapable, clock, context);
}

/** Which author-side rule exempts this pull request, or `null` for none. */
async function authorExemption(
    author: string,
    { settings, platform }: LadderContext,
): Promise<AuthorExemption | null> {
    if (exemptLogin(author, settings)) return "exemptMaintainers";
    // Asked only once consented, so a file without the setting reads nothing new; an
    // unanswerable author skips the evaluation rather than counting as a person.
    if (!settings.exemptBots) return null;
    return (await platform.ask("isAutomationActor", { login: author })) ? "exemptBots" : null;
}

/** What one pull request past its reminder is worth saying and doing about, unless a rule exempts it. */
async function onPullRequestLadder(
    facts: PullLadderFacts,
    reapable: Reapable,
    clock: Clock,
    context: LadderContext,
): Promise<readonly IntentFor<InactivityDeclaration>[]> {
    const stale = `stale in ${reapable.reason}, idle ${lasting(clock.idleHours)}`;
    if (exemptAsBlocked(facts, context.settings)) {
        exemptedAsBlocked(context.platform, [stale]);
        return [];
    }
    const exemption = await authorExemption(facts.author, context);
    if (exemption !== null) {
        exemptedAuthor(context.platform, exemption, facts.author, stale);
        return [];
    }

    const logins = (await people(context.platform, facts.assignees))
        .map((assignee) => assignee.login)
        .filter((login) => !exemptLogin(login, context.settings));
    return [
        reaps(reapable)
            ? close(context, facts, logins, clock, reapable)
            : remind(context, logins, clock, reapable),
    ];
}

/** The close alone, carrying the reminder's words as grace. */
function close(
    { platform, observedAt }: LadderContext,
    facts: PullLadderFacts,
    logins: readonly string[],
    clock: Clock,
    reapable: Reapable & Reaping,
): IntentFor<InactivityDeclaration> {
    return platform.intent({
        operation: "closePullRequest",
        desired: { reason: closeReason(reapable.reapAfter) },
        cause: "pullRequestWentStale",
        // Dated at the clock's start, not the sweep: the occasion is the idle run.
        occasion: clock.idleSince,
        claims: claimsFor(reapable.reason),
        explain: {
            summary: `Warned about a pull request stale in ${reapable.reason}; the close follows the grace.`,
            detail: [
                `idle ${lasting(clock.idleHours)}`,
                `closes after ${lasting(reapable.reapAfter)}`,
            ],
        },
        grace: {
            hours: graceHoursOf(reapable),
            // The reason is what the warning is about, so it is the topic (D145).
            topic: reapable.reason,
            warning: { body: pullRequestReminder(logins, reapable.reason, reapable, observedAt) },
            notice: { body: closeNotice(reapable.reason, reapable.reapAfter) },
            cancelledBy: CANCELLED_BY,
            reversesWith: REVERSES_WITH,
            // The set `pullRequestClock` resets from.
            activityAt: latestOf([
                facts.review.lastCommitAt,
                ...facts.assignees.map((assignee) => assignee.lastWorkingAt),
            ]),
        },
    });
}

/**
 * The reminder alone, for a reason whose `reap` block is absent or parked. It
 * takes the identity the platform's own warning would have taken.
 */
function remind(
    { platform, observedAt }: LadderContext,
    logins: readonly string[],
    clock: Clock,
    reapable: Reapable,
): IntentFor<InactivityDeclaration> {
    return platform.intent({
        operation: "postManagedComment",
        desired: {
            kind: "warning",
            topic: reapable.reason,
            body: pullRequestReminder(logins, reapable.reason, reapable, observedAt),
        },
        cause: "pullRequestWentStale",
        occasion: clock.idleSince,
        claims: claimsFor(reapable.reason),
        explain: {
            summary: `Reminded about a pull request stale in ${reapable.reason}; this reason closes nothing.`,
            detail: [`idle ${lasting(clock.idleHours)}`],
        },
    });
}
