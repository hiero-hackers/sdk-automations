/**
 * The judgements any capability makes over a fact record, and the vocabulary
 * every capability states them in. No settings of any kind live here.
 */

import type { MappableMeaning } from "../config/index.js";
import { observedMeaningsOf, type ObservedModes } from "../safety/index.js";
import {
    closureOf,
    ISSUE_EDGES,
    isPausedByProjection,
    PR_EDGES,
    type Edge,
    type TransitionCause,
} from "../workflow/index.js";
import {
    UNREAD,
    type AssigneeClock,
    type Facts,
    type PullRequestFacts,
    type ResolverAnswer,
    type ResolverInput,
    type ResolverOutput,
    type Unread,
} from "../catalogue.js";

// ─── The three stops ─────────────────────────────────────────────────

/** A closed issue and a merged pull request have both left (D59). */
export function isOpen(facts: Facts): boolean {
    return closureOf(facts.position) === null;
}

/**
 * A paused item's clocks all stop; whether a pause exempts is the repository's
 * to say, so read this only alongside your own exemption setting.
 */
export function isPaused(facts: Facts): boolean {
    return isPausedByProjection(facts.position);
}

/** A conflicted item has no position to judge, and the platform refuses it anyway. */
export function isConflicted(facts: Facts): boolean {
    return facts.position.kind === "conflict";
}

/** Every mapped meaning the record's projection carried, both branches. */
export function meaningsOf(facts: Facts): readonly MappableMeaning[] {
    return observedMeaningsOf<MappableMeaning>(facts.position);
}

/** The two review facts the outstanding rule reads. */
type ChangeRequestFacts = Pick<
    Exclude<PullRequestFacts["review"], Unread>,
    "changesRequestedAt" | "lastCommitAt"
>;

/** A change request is outstanding until a commit newer than it hands the wait back (D241). */
export function changesOutstanding(review: ChangeRequestFacts): boolean {
    const requested = review.changesRequestedAt;
    if (requested === null) return false;
    return review.lastCommitAt === null || review.lastCommitAt.getTime() <= requested.getTime();
}

/** Which pull-request modes this record READ; one nobody read is left out, not `false`. */
export function modesOf(facts: Facts): ObservedModes {
    if (facts.kind !== "pullRequest") return {};
    return {
        ...(facts.readiness === UNREAD ? {} : { draft: facts.readiness.draft }),
        ...(facts.review === UNREAD ? {} : { changesRequested: changesOutstanding(facts.review) }),
    };
}

// ─── Moving an item ──────────────────────────────────────────────────

/**
 * The cause for moving this item to `meaning`: the edge's first in edge order, or the first in edge
 * order that `owned` holds (D243). `null` when the map draws no such edge (D5), or none the caller owns.
 */
export function moveTo(
    facts: Facts,
    meaning: MappableMeaning,
    owned?: readonly TransitionCause[],
): TransitionCause | null {
    if (facts.position.kind === "conflict") return null;
    const from: string | null = facts.position.state.meaning;
    const edges: readonly Edge<string, TransitionCause>[] =
        facts.kind === "issue" ? ISSUE_EDGES : PR_EDGES;
    const edge = edges.find((edge) => edge.from === from && edge.to === meaning);
    return edge?.causes.find((cause) => owned === undefined || owned.includes(cause)) ?? null;
}

// ─── Who is a person ─────────────────────────────────────────────────

/** The one question `people` asks, and the whole of what it is handed. */
export interface ActorLookup {
    resolve(
        query: "isAutomationActor",
        input: ResolverInput<"isAutomationActor">,
    ): Promise<ResolverAnswer<ResolverOutput<"isAutomationActor">>>;
}

/** The assignees a capability may act on: never a bot, never an unanswerable login (D51). */
export async function people(
    platform: ActorLookup,
    assignees: readonly AssigneeClock[],
): Promise<readonly AssigneeClock[]> {
    const found: AssigneeClock[] = [];
    for (const assignee of assignees) {
        const isBot = await platform.resolve("isAutomationActor", { login: assignee.login });
        if (!isBot.ok || isBot.value) continue;
        found.push(assignee);
    }
    return found;
}

// ─── The clocks ──────────────────────────────────────────────────────

/** One hour, in milliseconds. */
export const HOUR_MS = 60 * 60 * 1000;

const HOURS_PER_DAY = 24;

export interface Clock {
    readonly idleSince: Date;
    readonly idleHours: number;
}

/** A pull request with the two groups its clock reads, both of them read. */
export interface PullRequestClockFacts {
    readonly assignees: Exclude<PullRequestFacts["assignees"], Unread>;
    readonly review: Exclude<PullRequestFacts["review"], Unread>;
}

/** The clock's start: the state's beginning, moved forward by any later reset. */
function startedAt(base: Date, resets: readonly (Date | null)[]): Date {
    const newest = latestOf(resets);
    return newest !== null && newest.getTime() > base.getTime() ? newest : base;
}

function clockFrom(idleSince: Date, observedAt: Date): Clock {
    return {
        idleSince,
        idleHours: Math.floor((observedAt.getTime() - idleSince.getTime()) / HOUR_MS),
    };
}

/** One assignee's own clock: their assignment, reset by their own `/working`. */
export function assigneeClock(assignee: AssigneeClock, observedAt: Date): Clock {
    return clockFrom(startedAt(assignee.assignedAt, [assignee.lastWorkingAt]), observedAt);
}

/** A pull request's one clock: the reason's start, reset by a commit or any `/working` on it. */
export function pullRequestClock(
    facts: PullRequestClockFacts,
    reason: keyof PullRequestClockFacts["review"]["reapableSince"],
    observedAt: Date,
): Clock {
    return clockFrom(
        startedAt(facts.review.reapableSince[reason], [
            facts.review.lastCommitAt,
            ...facts.assignees.map((assignee) => assignee.lastWorkingAt),
        ]),
        observedAt,
    );
}

export function latestOf(instants: readonly (Date | null)[]): Date | null {
    let newest: Date | null = null;
    for (const instant of instants) {
        if (instant !== null && (newest === null || instant.getTime() > newest.getTime())) {
            newest = instant;
        }
    }
    return newest;
}

// ─── The words a warning is written in ───────────────────────────────

/** The people a sentence addresses, in the spelling GitHub notifies on. */
export const mentions = (logins: readonly string[]): string =>
    logins.map((login) => `@${login}`).join(", ");

/** What DOES something in quoted untrusted text; a backslash escapes each in CommonMark. */
const ACTIVE_MARKDOWN = /[\\`*_[\]()<>&|~#!]/g;

/** GitHub stops linking a mention when anything at all sits after the `@`. */
const ZERO_WIDTH_SPACE = "​";

const QUOTED_LIMIT = 120;

/** Untrusted text, rendered so that it says something and does nothing (catalogue.md). */
export function inert(text: string): string {
    const oneLine = text.replace(/\s+/gu, " ").trim();
    const capped = oneLine.length > QUOTED_LIMIT ? `${oneLine.slice(0, QUOTED_LIMIT)}…` : oneLine;
    return capped
        .replace(ACTIVE_MARKDOWN, (char) => `\\${char}`)
        .replaceAll("@", `@${ZERO_WIDTH_SPACE}`);
}

/** The deadline a warning names: UTC, with the hour only when the grace is under a day. */
export function on(deadline: Date, graceHours: number): string {
    const iso = deadline.toISOString();
    return graceHours < HOURS_PER_DAY
        ? `**${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC**`
        : `**${iso.slice(0, 10)}**`;
}

/** A duration in the words a sentence to a contributor uses — "14 days", not `14d`. */
export function lasting(hours: number): string {
    const [count, noun] =
        hours !== 0 && hours % HOURS_PER_DAY === 0
            ? [hours / HOURS_PER_DAY, "day"]
            : [hours, "hour"];
    return `${String(count)} ${noun}${count === 1 ? "" : "s"}`;
}

/** The two sentences the platform keeps rather than posts (grace.md §1). */
export const CANCELLED_BY = "a commit or a /working comment";
export const REVERSES_WITH = "re-assign / reopen";
