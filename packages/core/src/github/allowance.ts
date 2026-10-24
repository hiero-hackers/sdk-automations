/** What a lane may still spend of GitHub's own limits, and what it has turned away (D192, D193). */

export type Pool = "core" | "graphql";

/** A pool, or the mutation lane that rides on `core` and is armed per tick. */
export type Lane = Pool | "mutations";

/** What has been spent, per lane; `graphql` counts points and the rest requests. */
export interface Spent {
    readonly core: number;
    readonly graphql: number;
    readonly mutations: number;
}

/** A request this allowance turned away: the lane that refused, and its window (D192). */
export interface Refusal {
    readonly lane: Lane;
    readonly resetAt: string | null;
}

/** One pool's share of GitHub's window, as this process has spent it (D193). */
export interface PoolStanding {
    readonly pool: Pool;
    readonly allowed: number;
    readonly spent: number;
    readonly resetAt: string | null;
}

/** Spent this window, charged in all (D238), and what a lane still may; the client's ledger adds the writing half. */
export interface Allowance {
    spent(): Spent;
    charged(): Spent;
    /** The lane at its cap — core, then graphql, then mutations — or `null`. */
    exhausted(): Lane | null;
    refusals(): number;
    lastRefusal(): Refusal | null;
    standing(): readonly PoolStanding[];
    /** Open this tick's mutation lane at `calls`, spent from nothing. */
    armMutations(calls: number): void;
}
