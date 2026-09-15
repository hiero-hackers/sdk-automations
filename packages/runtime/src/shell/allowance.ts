/**
 * What a lane may still spend of GitHub's own limits, as the shell sees it: the adapter's ledger
 * restated, because only `compose/live.ts` may name it. `exhausted` names the lane at its cap (D192).
 */

export type Lane = "core" | "graphql" | "mutations";

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
    readonly pool: "core" | "graphql";
    readonly allowed: number;
    readonly spent: number;
    readonly resetAt: string | null;
}

export interface Allowance {
    spent(): Spent;
    exhausted(): Lane | null;
    refusals(): number;
    /** The last request this allowance turned away, or `null`. */
    lastRefusal(): Refusal | null;
    standing(): readonly PoolStanding[];
    /** Open this tick's mutation lane at `calls`, spent from nothing. */
    armMutations(calls: number): void;
}
