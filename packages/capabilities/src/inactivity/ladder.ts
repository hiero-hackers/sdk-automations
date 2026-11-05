/**
 * What a ladder is, and who is still on one — pure judgements over this
 * capability's settings. The platform, not a ladder, holds the grace.
 */

import { HOUR_MS, isConflicted, isPaused } from "@hiero-hackers/automation-core/author";
import type { InactivitySettings } from "./context.js";
import type { InactivityFacts } from "./declaration.js";

/** The three contributor-side modes a pull request can be stale in, in the order the design reads them. */
export const REAP_REASONS = ["needsRevision", "changesRequested", "draft"] as const;

export type ReapReason = (typeof REAP_REASONS)[number];

/** A resolved level, in hours. `reapAfter` is `null` where it never acts. */
export interface Ladder {
    readonly remindAfter: number;
    readonly reapAfter: number | null;
}

/** A level that reaps — what every grace computation below needs. */
export interface Reaping extends Ladder {
    readonly reapAfter: number;
}

/** One acting level's clocks, read out of the block a repository consented to. */
export function ladderOf(level: {
    readonly remindAfter: number;
    readonly reap: { readonly enabled: false } | { readonly enabled: true; readonly after: number };
}): Ladder {
    return {
        remindAfter: level.remindAfter,
        reapAfter: level.reap.enabled ? level.reap.after : null,
    };
}

export function reaps(ladder: Ladder): ladder is Reaping {
    return ladder.reapAfter !== null;
}

/** The gap between the two rungs — the grace the platform holds an act for. */
export function graceHoursOf(ladder: Reaping): number {
    return ladder.reapAfter - ladder.remindAfter;
}

/** The date a warning names: the observation plus the grace it announces. */
export function deadlineOf(ladder: Reaping, observedAt: Date): Date {
    return new Date(observedAt.getTime() + graceHoursOf(ladder) * HOUR_MS);
}

/** Whether the repository listed this login under `exemptMaintainers` (D243). */
export function exemptLogin(login: string, settings: InactivitySettings): boolean {
    return settings.exemptMaintainers.includes(login.toLowerCase());
}

/** The two stops both ladders share, in order: paused, then conflicted. */
export function stillOnTheLadder(facts: InactivityFacts, settings: InactivitySettings): boolean {
    if (settings.exemptBlocked && isPaused(facts)) return false;
    return !isConflicted(facts);
}
