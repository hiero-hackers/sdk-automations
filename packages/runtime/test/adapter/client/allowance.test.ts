/**
 * The client-side ledger, held directly: GitHub's cost table, GitHub's window.
 * Nothing here sends anything; `http.test.ts` is where a response meets it.
 */

import { describe, expect, it } from "vitest";
import {
    ASSUMED_POOL_LIMIT,
    costOf,
    createAllowance,
    type Exchange,
    type PoolWindow,
    WINDOW_SLACK_S,
} from "../../../src/adapter/client/allowance.js";

/** One exchange, with the parts a case is about overridden. */
const exchange = (overrides: Partial<Exchange> = {}): Exchange => ({
    pool: "core",
    mutation: false,
    status: 200,
    points: null,
    ...overrides,
});

const NOTHING = { core: 0, graphql: 0, mutations: 0 };

/** A reset instant as GitHub sends one: whole seconds since the epoch. */
const resetIn = (seconds: number): string => String(1_787_300_000 + seconds);

const headers = (
    reset: string,
    rest: Readonly<Record<string, string>> = {},
): Record<string, string> => ({ "x-ratelimit-reset": reset, ...rest });

describe("what GitHub charges for one exchange", () => {
    it.each([
        ["a GET that answered", exchange(), { core: 1, graphql: 0, mutations: 0 }],
        ["a GET answered from the cache", exchange({ status: 304 }), NOTHING],
        ["a GET GitHub refused", exchange({ status: 404 }), { core: 1, graphql: 0, mutations: 0 }],
        [
            "a GraphQL query that reported its cost",
            exchange({ pool: "graphql", points: 7 }),
            { core: 0, graphql: 7, mutations: 0 },
        ],
        [
            "a GraphQL query that reported none",
            exchange({ pool: "graphql" }),
            { core: 0, graphql: 1, mutations: 0 },
        ],
        [
            "a mutation",
            exchange({ mutation: true, status: 201 }),
            { core: 1, graphql: 0, mutations: 1 },
        ],
        ["a request that never left", exchange({ status: null }), NOTHING],
        ["a mutation that never left", exchange({ mutation: true, status: null }), NOTHING],
    ])("charges %s", (_label, given, cost) => {
        expect(costOf(given)).toEqual(cost);
    });
});

describe("the cap one pool holds", () => {
    it("assumes GitHub's documented limit until a response says otherwise", () => {
        const allowance = createAllowance({ share: 0.001 });

        for (let sent = 0; sent < 5; sent += 1) allowance.charge(exchange());

        expect(allowance.spent()).toEqual({ core: 5, graphql: 0, mutations: 0 });
        expect(ASSUMED_POOL_LIMIT * 0.001).toBe(5);
        expect(allowance.exhausted()).toBe("core");
        expect(allowance.refuses("core", false)).toBe("core");
    });

    it("takes its share of the limit the headers report", () => {
        const allowance = createAllowance({ share: 0.5 });

        allowance.observed("core", headers(resetIn(60), { "x-ratelimit-limit": "12500" }));
        for (let sent = 0; sent < 6_249; sent += 1) allowance.charge(exchange());

        expect(allowance.exhausted()).toBeNull();
        allowance.charge(exchange());
        expect(allowance.exhausted()).toBe("core");
    });

    it("keeps the pools apart", () => {
        const allowance = createAllowance({ share: 0.001 });

        for (let sent = 0; sent < 5; sent += 1) allowance.charge(exchange());

        expect(allowance.refuses("graphql", false)).toBeNull();
        expect(allowance.exhausted()).toBe("core");
        allowance.charge(exchange({ pool: "graphql", points: 5 }));
        expect(allowance.spent()).toEqual({ core: 5, graphql: 5, mutations: 0 });
        expect(allowance.refuses("graphql", false)).toBe("graphql");

        const graphqlOnly = createAllowance({ share: 0.001 });
        graphqlOnly.charge(exchange({ pool: "graphql", points: 5 }));
        expect(graphqlOnly.exhausted()).toBe("graphql");
    });
});

describe("the window a pool spends in", () => {
    it("starts the spend again when a later reset arrives", () => {
        const allowance = createAllowance({ share: 0.001 });
        allowance.observed("core", headers(resetIn(0)));
        for (let sent = 0; sent < 5; sent += 1) allowance.charge(exchange());

        allowance.observed("core", headers(resetIn(3_600)));

        expect(allowance.spent().core).toBe(0);
        expect(allowance.exhausted()).toBeNull();
    });

    it("keeps the spend when the reset drifts inside the slack, and moves the window's end", () => {
        const allowance = createAllowance({ share: 0.001 });
        allowance.observed("core", headers(resetIn(0)));
        for (let sent = 0; sent < 5; sent += 1) allowance.charge(exchange());

        allowance.observed("core", headers(resetIn(3)));

        expect(allowance.spent().core).toBe(5);
        expect(allowance.standing().find((pool) => pool.pool === "core")?.resetAt).toBe(
            new Date((1_787_300_000 + 3) * 1_000).toISOString(),
        );
        allowance.observed("core", headers(resetIn(WINDOW_SLACK_S + 3 + 1)));
        expect(allowance.spent().core).toBe(0);
    });

    it.each([
        ["the same reset", resetIn(0)],
        ["an earlier reset", resetIn(-10)],
    ])("keeps the spend on %s", (_label, reset) => {
        const allowance = createAllowance({ share: 0.001 });
        allowance.observed("core", headers(resetIn(0)));
        for (let sent = 0; sent < 5; sent += 1) allowance.charge(exchange());

        allowance.observed("core", headers(reset));

        expect(allowance.spent().core).toBe(5);
    });

    it("ignores a reset it cannot read, and a limit of none", () => {
        const allowance = createAllowance({ share: 0.5 });
        allowance.charge(exchange());

        allowance.observed("core", { "x-ratelimit-reset": "soon", "x-ratelimit-limit": "0" });

        expect(allowance.spent().core).toBe(1);
        allowance.observed("core", headers(resetIn(60), { "x-ratelimit-limit": "10" }));
        for (let sent = 0; sent < 5; sent += 1) allowance.charge(exchange());
        expect(allowance.exhausted()).toBe("core");
    });

    it("says what GitHub says, once per pool per window", () => {
        const said: PoolWindow[] = [];
        const allowance = createAllowance({ share: 0.5, onWindow: (window) => said.push(window) });

        allowance.observed(
            "core",
            headers(resetIn(60), { "x-ratelimit-limit": "5000", "x-ratelimit-remaining": "4999" }),
        );
        allowance.observed("core", headers(resetIn(60), { "x-ratelimit-remaining": "4998" }));
        allowance.observed("graphql", headers(resetIn(120), { "x-ratelimit-limit": "5000" }));

        expect(said).toEqual([
            {
                pool: "core",
                limit: 5_000,
                remaining: 4_999,
                resetAt: new Date(Number(resetIn(60)) * 1_000).toISOString(),
            },
            {
                pool: "graphql",
                limit: 5_000,
                remaining: 5_000,
                resetAt: new Date(Number(resetIn(120)) * 1_000).toISOString(),
            },
        ]);
    });
});

describe("what an operator is shown of a pool", () => {
    /** The window before a response names one: the assumed limit, and no reset (D193). */
    it("says what each pool may spend, what it has, and when the window rolls", () => {
        const allowance = createAllowance({ share: 0.4 });

        allowance.charge(exchange());
        allowance.observed("graphql", headers(resetIn(120), { "x-ratelimit-limit": "10000" }));
        allowance.charge(exchange({ pool: "graphql", points: 3 }));

        expect(allowance.standing()).toEqual([
            {
                pool: "core",
                allowed: Math.floor(0.4 * ASSUMED_POOL_LIMIT),
                spent: 1,
                resetAt: null,
            },
            {
                pool: "graphql",
                allowed: 4_000,
                spent: 3,
                resetAt: new Date(Number(resetIn(120)) * 1_000).toISOString(),
            },
        ]);
    });
});

describe("the requests an allowance turned away", () => {
    it("counts each one the client says it refused", () => {
        const allowance = createAllowance({ share: 1 });
        expect(allowance.refusals()).toBe(0);

        allowance.refused("core");
        allowance.refused("core");

        expect(allowance.refusals()).toBe(2);
    });

    it("names the last lane refused, with the window that pool waits on", () => {
        const allowance = createAllowance({ share: 1 });
        expect(allowance.lastRefusal()).toBeNull();
        allowance.observed("graphql", headers(resetIn(90)));

        allowance.refused("core");
        allowance.refused("graphql");

        expect(allowance.lastRefusal()).toEqual({
            lane: "graphql",
            resetAt: new Date(Number(resetIn(90)) * 1_000).toISOString(),
        });
    });

    /** A mutation cap is this tick's, not GitHub's, so it has no window to name. */
    it("names no window for a refused mutation, or for a pool no response reached", () => {
        const allowance = createAllowance({ share: 1, mutations: 0 });

        allowance.refused("mutations");
        expect(allowance.lastRefusal()).toEqual({ lane: "mutations", resetAt: null });

        allowance.refused("core");
        expect(allowance.lastRefusal()).toEqual({ lane: "core", resetAt: null });
    });
});

/**
 * The two lanes of one process, as `compose/live.ts` builds them: the sweep's
 * share and the rest. One pool, two ledgers — what the webhook lane spends of
 * its 0.6 must leave the sweep's 0.4 exactly where it was.
 */
describe("two allowances over one installation", () => {
    const spend = (allowance: ReturnType<typeof createAllowance>, requests: number): void => {
        for (let sent = 0; sent < requests; sent += 1) allowance.charge(exchange());
    };

    it("refuses the lane past its share and leaves the sweep's untouched", () => {
        const sweep = createAllowance({ share: 0.4 });
        const deliveries = createAllowance({ share: 1 - 0.4 });
        expect(deliveries.standing()[0]).toMatchObject({ pool: "core", allowed: 3_000 });
        expect(sweep.standing()[0]).toMatchObject({ pool: "core", allowed: 2_000 });

        spend(deliveries, 3_000);

        expect(deliveries.refuses("core", false)).toBe("core");
        expect(sweep.refuses("core", false)).toBeNull();
        expect(sweep.spent()).toEqual(NOTHING);
    });

    /** The two shares must not add up to more than the pool GitHub reported. */
    it("splits GitHub's own reported limit, not the assumed one", () => {
        const sweep = createAllowance({ share: 0.4 });
        const deliveries = createAllowance({ share: 1 - 0.4 });

        for (const allowance of [sweep, deliveries]) {
            allowance.observed("core", headers(resetIn(60), { "x-ratelimit-limit": "12500" }));
        }

        expect(sweep.standing()[0]?.allowed).toBe(5_000);
        expect(deliveries.standing()[0]?.allowed).toBe(7_500);
    });
});

describe("the mutation lane", () => {
    it("is unbounded until a tick arms it", () => {
        const allowance = createAllowance({ share: 1 });

        for (let sent = 0; sent < 50; sent += 1) allowance.charge(exchange({ mutation: true }));

        expect(allowance.spent().mutations).toBe(50);
        expect(allowance.refuses("core", true)).toBeNull();
    });

    it("holds one tick's calls, and starts the next from nothing", () => {
        const allowance = createAllowance({ share: 1, mutations: 2 });

        allowance.armMutations(2);
        allowance.charge(exchange({ mutation: true }));
        allowance.charge(exchange({ mutation: true }));

        expect(allowance.refuses("core", true)).toBe("mutations");
        expect(allowance.refuses("core", false)).toBeNull();
        expect(allowance.exhausted()).toBe("mutations");

        allowance.armMutations(2);
        expect(allowance.spent()).toEqual({ core: 2, graphql: 0, mutations: 0 });
        expect(allowance.exhausted()).toBeNull();
    });

    it("comes after both pools when more than one lane is spent", () => {
        const allowance = createAllowance({ share: 0.001, mutations: 1 });
        allowance.armMutations(1);

        allowance.charge(exchange({ mutation: true }));
        for (let sent = 0; sent < 4; sent += 1) allowance.charge(exchange());

        expect(allowance.spent()).toEqual({ core: 5, graphql: 0, mutations: 1 });
        expect(allowance.exhausted()).toBe("core");
    });
});

/**
 * At its cap the ledger refuses every request, so no response can name the next
 * window (D196). The clock seam rolls a pool once the reset it last named has
 * passed; the next response re-states the window, exactly as the first one did.
 */
describe("a window nobody will report the end of", () => {
    const spentCorePool = (clock?: () => number): ReturnType<typeof createAllowance> => {
        const allowance = createAllowance({
            share: 0.001,
            ...(clock === undefined ? {} : { clock }),
        });
        allowance.observed("core", headers(resetIn(60)));
        for (let sent = 0; sent < 5; sent += 1) allowance.charge(exchange());
        return allowance;
    };

    it("rolls its own spend once the reset it last named has passed", () => {
        let now = (1_787_300_000 + 59) * 1_000;
        const allowance = spentCorePool(() => now);

        expect(allowance.refuses("core", false)).toBe("core");

        now = (1_787_300_000 + 60) * 1_000;
        expect(allowance.refuses("core", false)).toBeNull();
        expect(allowance.exhausted()).toBeNull();
        expect(allowance.spent().core).toBe(0);
        // The pool waits for a response to name the next window's end.
        expect(allowance.standing().find((pool) => pool.pool === "core")?.resetAt).toBeNull();
    });

    it("keeps a live window's spend when a response names a later reset, and rolls once its own end passes", () => {
        let now = (1_787_300_000 + 30) * 1_000;
        const allowance = spentCorePool(() => now);

        // A write's answer names another pool's window, an hour away: not this window's roll.
        allowance.observed("core", headers(resetIn(3_600)));

        expect(allowance.spent().core).toBe(5);
        expect(allowance.refuses("core", false)).toBe("core");
        expect(allowance.standing().find((pool) => pool.pool === "core")?.resetAt).toBe(
            new Date((1_787_300_000 + 60) * 1_000).toISOString(),
        );

        now = (1_787_300_000 + 61) * 1_000;
        expect(allowance.spent().core).toBe(0);
        allowance.observed("core", headers(resetIn(3_600)));
        expect(allowance.standing().find((pool) => pool.pool === "core")?.resetAt).toBe(
            new Date((1_787_300_000 + 3_600) * 1_000).toISOString(),
        );
    });

    it("re-states its window's end from the first response after the roll", () => {
        const now = (1_787_300_000 + 61) * 1_000;
        const allowance = spentCorePool(() => now);

        // The roll left no named end; the next response names the new one.
        allowance.observed("core", headers(resetIn(3_600), { "x-ratelimit-limit": "12500" }));
        expect(allowance.standing().find((pool) => pool.pool === "core")).toMatchObject({
            allowed: 12,
            spent: 0,
            resetAt: new Date((1_787_300_000 + 3_600) * 1_000).toISOString(),
        });
    });

    it("stays spent before the reset has passed, without a clock, and without a named reset", () => {
        // A clock that has not reached the reset changes nothing.
        const now = (1_787_300_000 + 30) * 1_000;
        expect(spentCorePool(() => now).refuses("core", false)).toBe("core");
        // No clock: the ledger cannot roll, and stays as it was.
        expect(spentCorePool().refuses("core", false)).toBe("core");
        // No named reset: there is nothing to roll to.
        const unnamed = createAllowance({ share: 0.001, clock: () => Number.MAX_SAFE_INTEGER });
        for (let sent = 0; sent < 5; sent += 1) unnamed.charge(exchange());
        expect(unnamed.refuses("core", false)).toBe("core");
    });
});

/** What a firing diffs for its own spend: no roll of a window or a tick lowers it. */
describe("everything the ledger has charged", () => {
    it("counts on through a window a later reset opened", () => {
        const allowance = createAllowance({ share: 1 });
        allowance.observed("core", headers(resetIn(0)));
        allowance.charge(exchange());
        const before = allowance.charged();

        allowance.observed("core", headers(resetIn(3_600)));
        allowance.charge(exchange({ pool: "graphql", points: 3 }));
        allowance.charge(exchange({ mutation: true }));

        expect(allowance.spent()).toEqual({ core: 1, graphql: 3, mutations: 1 });
        expect(before).toEqual({ core: 1, graphql: 0, mutations: 0 });
        expect(allowance.charged()).toEqual({ core: 2, graphql: 3, mutations: 1 });
    });

    it("counts on through a window the clock rolled, and a tick that armed the mutations", () => {
        let now = (1_787_300_000 + 30) * 1_000;
        const allowance = createAllowance({ share: 1, clock: () => now });
        allowance.observed("core", headers(resetIn(60)));
        allowance.charge(exchange({ mutation: true }));

        now = (1_787_300_000 + 60) * 1_000;
        allowance.armMutations(2);
        expect(allowance.refuses("core", false)).toBeNull();
        allowance.charge(exchange());

        expect(allowance.spent()).toEqual({ core: 1, graphql: 0, mutations: 0 });
        expect(allowance.charged()).toEqual({ core: 2, graphql: 0, mutations: 1 });
    });
});
