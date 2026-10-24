/**
 * One lane's share of GitHub's own rate limits, kept in GitHub's units.
 * The client debits it from the response it just read, and refuses the
 * request that would pass it. Nothing here sends, waits or decides what a lane is for.
 * A window whose named end has passed rolls its own spend (D196): at its cap the
 * ledger refuses every request, so no response can ever name the next window. While a
 * window's end has not passed, a response naming a later one never lowers its spend (D231).
 */

import {
    parseSecondsHeader,
    type Allowance as AllowanceView,
    type Lane,
    type Pool,
    type PoolStanding,
    type Refusal,
    type Spent,
} from "@hiero-hackers/automation-core";

// ─── The chosen bounds ───────────────────────────────────────────────

/** What a pool is worth until a response says otherwise — GitHub's documented figure. */
export const ASSUMED_POOL_LIMIT = 5_000;

// ─── What one exchange costs ─────────────────────────────────────────

/** One finished exchange, as the client saw it. */
export interface Exchange {
    readonly pool: Pool;
    readonly mutation: boolean;
    /** GitHub's status, or `null` when nothing left the process. */
    readonly status: number | null;
    /** The `rateLimit.cost` the GraphQL body reported, where it carried one. */
    readonly points: number | null;
}

const NOTHING: Spent = { core: 0, graphql: 0, mutations: 0 };

/**
 * GitHub's charge for one exchange (6.4 step 2; `2026-09-15T15-27-51-748Z#595,#647`).
 * A 304 and a request that never left both cost nothing, on either pool.
 */
export function costOf({ pool, mutation, status, points }: Exchange): Spent {
    if (status === null) return NOTHING;
    if (mutation) return { core: 1, graphql: 0, mutations: 1 };
    if (pool === "graphql") return { core: 0, graphql: points ?? 1, mutations: 0 };
    return status === 304 ? NOTHING : { core: 1, graphql: 0, mutations: 0 };
}

// ─── The ledger ──────────────────────────────────────────────────────

/** How far a reset may drift before it is a new window: seconds, against a window of an hour (8.4). */
export const WINDOW_SLACK_S = 60;

/** GitHub's own numbers for one pool, as the window they belong to opens. */
export interface PoolWindow {
    readonly pool: Pool;
    readonly limit: number;
    readonly remaining: number;
    readonly resetAt: string;
}

export interface AllowanceOptions {
    /** The share of each pool's own limit this lane may spend; 0 < share ≤ 1. */
    readonly share: number;
    /** What the mutation lane holds until a tick arms it; unbounded when absent. */
    readonly mutations?: number;
    /** Said once per pool per window, as the window opens. */
    readonly onWindow?: (window: PoolWindow) => void;
    /** Epoch milliseconds. A pool whose named reset has passed starts again, until a response re-states the window (D196). */
    readonly clock?: () => number;
}

/** The ledger behind the read view: what the client debits, and what it refuses from. */
export interface Allowance extends AllowanceView {
    /** Which lane refuses one more request of this shape, or `null`. */
    refuses(pool: Pool, mutation: boolean): Lane | null;
    /** Say that a request was turned away; the client says it as it refuses one. */
    refused(lane: Lane): void;
    charge(exchange: Exchange): void;
    /** What a response said about its pool: the cap it sets, and the window it opens. */
    observed(pool: Pool, headers: Readonly<Record<string, string>>): void;
}

/** One pool as this process counts it: GitHub's numbers, and what we put through it. */
interface PoolLedger {
    limit: number;
    /** The reset instant in epoch seconds; `null` before a response names one, and after a roll until one does again. */
    resetAt: number | null;
    spent: number;
}

const wholeNumber = (raw: string | undefined): number | null => {
    const parsed = parseSecondsHeader(raw);
    return parsed.kind === "valid" ? parsed.seconds : null;
};

export function createAllowance({
    share,
    mutations,
    onWindow,
    clock,
}: AllowanceOptions): Allowance {
    const pools: Record<Pool, PoolLedger> = {
        core: { limit: ASSUMED_POOL_LIMIT, resetAt: null, spent: 0 },
        graphql: { limit: ASSUMED_POOL_LIMIT, resetAt: null, spent: 0 },
    };
    let mutationCap = mutations ?? Number.POSITIVE_INFINITY;
    let mutationsSpent = 0;
    // Never rolled: a firing diffs it, so a window that ends under one still counts every request.
    const total = { core: 0, graphql: 0, mutations: 0 };
    let turnedAway = 0;
    let refusedLane: Lane | null = null;

    /**
     * A window nobody will report the end of rolls its own spend (D196).
     * The roll is a comparison, not a wait; the next response re-states the window.
     */
    const rollIfDue = (): void => {
        if (clock === undefined) return;
        const now = clock();
        for (const pool of ["core", "graphql"] as const) {
            const ledger = pools[pool];
            if (ledger.resetAt !== null && now >= ledger.resetAt * 1_000) {
                ledger.resetAt = null;
                ledger.spent = 0;
            }
        }
    };

    const capOf = (pool: Pool): number => Math.floor(share * pools[pool].limit);

    /** When GitHub's window for this lane rolls; the mutation lane has none of its own. */
    const rollsAt = (lane: Lane): string | null => {
        const reset = lane === "mutations" ? null : pools[lane].resetAt;
        return reset === null ? null : new Date(reset * 1_000).toISOString();
    };

    const atCap = (pool: Pool): boolean => pools[pool].spent >= capOf(pool);

    return {
        spent: () => {
            rollIfDue();
            return {
                core: pools.core.spent,
                graphql: pools.graphql.spent,
                mutations: mutationsSpent,
            };
        },
        charged: (): Spent => ({ ...total }),
        exhausted(): Lane | null {
            rollIfDue();
            if (atCap("core")) return "core";
            if (atCap("graphql")) return "graphql";
            return mutationsSpent >= mutationCap ? "mutations" : null;
        },
        refuses(pool: Pool, mutation: boolean): Lane | null {
            rollIfDue();
            if (atCap(pool)) return pool;
            return mutation && mutationsSpent >= mutationCap ? "mutations" : null;
        },
        refusals: () => turnedAway,
        lastRefusal: (): Refusal | null =>
            refusedLane === null ? null : { lane: refusedLane, resetAt: rollsAt(refusedLane) },
        standing: (): readonly PoolStanding[] => {
            rollIfDue();
            return (["core", "graphql"] as const).map((pool) => ({
                pool,
                allowed: capOf(pool),
                spent: pools[pool].spent,
                resetAt: rollsAt(pool),
            }));
        },
        refused(lane: Lane): void {
            turnedAway += 1;
            refusedLane = lane;
        },
        charge(exchange: Exchange): void {
            const cost = costOf(exchange);
            pools.core.spent += cost.core;
            pools.graphql.spent += cost.graphql;
            mutationsSpent += cost.mutations;
            total.core += cost.core;
            total.graphql += cost.graphql;
            total.mutations += cost.mutations;
        },
        /**
         * A reset past the slack is a new window: its spend starts again. Drift inside it only moves
         * the end. A later reset while this window's own end has not passed is another pool's
         * answer, never this one's roll: the spend stands until the clock passes the end (D231).
         */
        observed(pool: Pool, headers: Readonly<Record<string, string>>): void {
            const ledger = pools[pool];
            const limit = wholeNumber(headers["x-ratelimit-limit"]);
            if (limit !== null && limit > 0) ledger.limit = limit;
            const reset = wholeNumber(headers["x-ratelimit-reset"]);
            if (reset === null || (ledger.resetAt !== null && reset <= ledger.resetAt)) return;
            // A reset the clock has already passed names a window that is over; the next response
            // names the live one. Adopting it would roll away the charge that carried it (D196).

            if (clock !== undefined && reset * 1_000 <= clock()) return;
            if (ledger.resetAt !== null && reset <= ledger.resetAt + WINDOW_SLACK_S) {
                ledger.resetAt = reset;
                return;
            }
            if (
                clock !== undefined &&
                ledger.resetAt !== null &&
                clock() < ledger.resetAt * 1_000
            ) {
                return;
            }
            ledger.resetAt = reset;
            ledger.spent = 0;
            onWindow?.({
                pool,
                limit: ledger.limit,
                remaining: wholeNumber(headers["x-ratelimit-remaining"]) ?? ledger.limit,
                resetAt: new Date(reset * 1_000).toISOString(),
            });
        },
        armMutations(calls: number): void {
            mutationCap = calls;
            mutationsSpent = 0;
        },
    };
}
