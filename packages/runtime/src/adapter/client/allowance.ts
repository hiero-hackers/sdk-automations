/**
 * One lane's share of GitHub's own rate limits, kept in GitHub's units.
 * The client debits it from the response it just read, and refuses the request
 * that would pass it. Nothing here sends, waits or decides what a lane is for.
 */

import { parseSecondsHeader } from "@hiero-hackers/automation-core";

// ─── The chosen bounds ───────────────────────────────────────────────

/** What a pool is worth until a response says otherwise — GitHub's documented figure. */
export const ASSUMED_POOL_LIMIT = 5_000;

// ─── What one exchange costs ─────────────────────────────────────────

/** The two pools this client's requests are charged to. */
export type Pool = "core" | "graphql";

/** A pool, or the mutation lane that rides on `core` and is armed per tick. */
export type Lane = Pool | "mutations";

/** What has been spent this window; `graphql` counts points and the rest requests. */
export interface Spent {
    readonly core: number;
    readonly graphql: number;
    readonly mutations: number;
}

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

/** A request this allowance turned away: the lane that refused, and its window (D192). */
export interface Refusal {
    readonly lane: Lane;
    /** `null` before a response named a reset, and for the mutation lane. */
    readonly resetAt: string | null;
}

/** One pool's share of GitHub's window, as this process has spent it (D193). */
export interface PoolStanding {
    readonly pool: Pool;
    /** What this lane may spend of the pool before the window rolls. */
    readonly allowed: number;
    readonly spent: number;
    /** When GitHub's own window rolls; `null` before a response named one. */
    readonly resetAt: string | null;
}

export interface AllowanceOptions {
    /** The share of each pool's own limit this lane may spend; 0 < share ≤ 1. */
    readonly share: number;
    /** What the mutation lane holds until a tick arms it; unbounded when absent. */
    readonly mutations?: number;
    /** Said once per pool per window, as the window opens. */
    readonly onWindow?: (window: PoolWindow) => void;
}

/** What a lane has spent and what it still may. The client debits it; the shell reads it. */
export interface Allowance {
    spent(): Spent;
    /** The lane at its cap — core, then graphql, then mutations — or `null`. */
    exhausted(): Lane | null;
    /** Which lane refuses one more request of this shape, or `null`. */
    refuses(pool: Pool, mutation: boolean): Lane | null;
    /** Requests this allowance has turned away, for the life of the process. */
    refusals(): number;
    /** The last request this allowance turned away, or `null`. */
    lastRefusal(): Refusal | null;
    /** What each pool may spend this window, and what it has (D193). */
    standing(): readonly PoolStanding[];
    /** Say that a request was turned away; the client says it as it refuses one. */
    refused(lane: Lane): void;
    charge(exchange: Exchange): void;
    /** What a response said about its pool: the cap it sets, and the window it opens. */
    observed(pool: Pool, headers: Readonly<Record<string, string>>): void;
    /** Open this tick's mutation lane at `calls`, spent from nothing. */
    armMutations(calls: number): void;
}

/** One pool as this process counts it: GitHub's numbers, and what we put through it. */
interface PoolLedger {
    limit: number;
    /** The reset instant in epoch seconds, or `null` before a response names one. */
    resetAt: number | null;
    spent: number;
}

const wholeNumber = (raw: string | undefined): number | null => {
    const parsed = parseSecondsHeader(raw);
    return parsed.kind === "valid" ? parsed.seconds : null;
};

export function createAllowance({ share, mutations, onWindow }: AllowanceOptions): Allowance {
    const pools: Record<Pool, PoolLedger> = {
        core: { limit: ASSUMED_POOL_LIMIT, resetAt: null, spent: 0 },
        graphql: { limit: ASSUMED_POOL_LIMIT, resetAt: null, spent: 0 },
    };
    let mutationCap = mutations ?? Number.POSITIVE_INFINITY;
    let mutationsSpent = 0;
    let turnedAway = 0;
    let refusedLane: Lane | null = null;

    const capOf = (pool: Pool): number => Math.floor(share * pools[pool].limit);

    /** When GitHub's window for this lane rolls; the mutation lane has none of its own. */
    const rollsAt = (lane: Lane): string | null => {
        const reset = lane === "mutations" ? null : pools[lane].resetAt;
        return reset === null ? null : new Date(reset * 1_000).toISOString();
    };

    const atCap = (pool: Pool): boolean => pools[pool].spent >= capOf(pool);

    const refuses = (pool: Pool, mutation: boolean): Lane | null => {
        if (atCap(pool)) return pool;
        return mutation && mutationsSpent >= mutationCap ? "mutations" : null;
    };

    return {
        spent: () => ({
            core: pools.core.spent,
            graphql: pools.graphql.spent,
            mutations: mutationsSpent,
        }),
        exhausted(): Lane | null {
            if (atCap("core")) return "core";
            if (atCap("graphql")) return "graphql";
            return mutationsSpent >= mutationCap ? "mutations" : null;
        },
        refuses,
        refusals: () => turnedAway,
        lastRefusal: (): Refusal | null =>
            refusedLane === null ? null : { lane: refusedLane, resetAt: rollsAt(refusedLane) },
        standing: (): readonly PoolStanding[] =>
            (["core", "graphql"] as const).map((pool) => ({
                pool,
                allowed: capOf(pool),
                spent: pools[pool].spent,
                resetAt: rollsAt(pool),
            })),
        refused(lane: Lane): void {
            turnedAway += 1;
            refusedLane = lane;
        },
        charge(exchange: Exchange): void {
            const cost = costOf(exchange);
            pools.core.spent += cost.core;
            pools.graphql.spent += cost.graphql;
            mutationsSpent += cost.mutations;
        },
        /** A reset past the slack is a new window: its spend starts again. Drift inside it only moves the end. */
        observed(pool: Pool, headers: Readonly<Record<string, string>>): void {
            const ledger = pools[pool];
            const limit = wholeNumber(headers["x-ratelimit-limit"]);
            if (limit !== null && limit > 0) ledger.limit = limit;
            const reset = wholeNumber(headers["x-ratelimit-reset"]);
            if (reset === null || (ledger.resetAt !== null && reset <= ledger.resetAt)) return;
            if (ledger.resetAt !== null && reset <= ledger.resetAt + WINDOW_SLACK_S) {
                ledger.resetAt = reset;
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
