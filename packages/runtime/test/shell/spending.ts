/**
 * An allowance a shell test can script: it counts what was charged to it and
 * turns a charge away once a lane's cap is reached, as the client does. The real
 * ledger is the adapter's, and `allowance.test.ts` holds GitHub's table to it.
 */

import type { Allowance, Lane, Refusal, Spent } from "../../src/shell/allowance.js";

/** The fake, plus the three levers a case pulls: what it charged, what it refuses, and when. */
export interface Spending extends Allowance {
    /** Charge one lane `cost` requests; a charge past the cap is turned away instead. */
    charge(lane: Lane, cost?: number): void;
    /** A lane the fake reports as spent whatever it was charged, or `null`. */
    refusing: Lane | null;
    /** When GitHub's window rolls, as every pool and every refusal reports it. */
    resetAt: string | null;
    /** Start both pools again, as GitHub's own window rolling does. */
    openWindow(): void;
}

/** A fake with everything to spend; a lane named in `caps` refuses once it reaches one. */
export function spending(caps: Partial<Record<Lane, number>> = {}): Spending {
    const spent = { core: 0, graphql: 0, mutations: 0 };
    let turnedAway = 0;
    let refusedLane: Lane | null = null;
    const atCap = (lane: Lane): boolean => {
        const cap = caps[lane];
        return cap !== undefined && spent[lane] >= cap;
    };
    return {
        refusing: null,
        resetAt: null,
        spent: (): Spent => ({ ...spent }),
        exhausted(): Lane | null {
            if (this.refusing !== null) return this.refusing;
            return (["core", "graphql", "mutations"] as const).find(atCap) ?? null;
        },
        refusals: () => turnedAway,
        lastRefusal(): Refusal | null {
            return refusedLane === null ? null : { lane: refusedLane, resetAt: this.resetAt };
        },
        standing() {
            return (["core", "graphql"] as const).map((pool) => ({
                pool,
                // What no case capped is the client's own assumption for a pool.

                allowed: caps[pool] ?? 5_000,
                spent: spent[pool],
                resetAt: this.resetAt,
            }));
        },
        charge(lane: Lane, cost = 1): void {
            for (let request = 0; request < cost; request += 1) {
                if (atCap(lane)) {
                    turnedAway += 1;
                    refusedLane = lane;
                    return;
                }
                spent[lane] += 1;
                // A mutation is a core request too; the client charges both (D192).

                if (lane === "mutations") spent.core += 1;
            }
        },
        openWindow(): void {
            spent.core = 0;
            spent.graphql = 0;
        },
        armMutations(calls: number): void {
            caps.mutations = calls;
            spent.mutations = 0;
            if (this.refusing === "mutations") this.refusing = null;
        },
    };
}
