/**
 * The lane's failure honesty: a crash mid-decision COUNTS an attempt —
 * the delivery stays durable, waits out a widening backoff, and is
 * eventually dead-lettered rather than retried forever — and a completed
 * delivery never runs twice. The receiver acknowledged long before any of
 * this; GitHub is not watching.
 *
 * Failures here are injected through the externals seam, which is the one
 * this worker actually meets (`live externals unavailable`) and the one
 * whose throw the lane sees: a capability that throws is contained by
 * `decide()` and reported, never raised.
 *
 * One case here is not about failure at all: the delivery that is refused
 * because it names another repository. It sits with these because it is
 * the fourth way a claimed delivery can end, and because what it must NOT
 * do — retry, dead-letter, or read a configuration — is what everything
 * else in this file is about.
 *
 * What the shared box decides and writes down is `decide/item.test.ts`;
 * every case here drives the lane through the real one.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
    asDeliveryGuid,
    toEngine,
    type Effect,
    type EngineCapability,
    type RepositoryRef,
} from "@hiero-hackers/automation-core";
import { Store } from "../../../src/store/index.js";
import { inactivity, intake, intakeDeclaration } from "@hiero-hackers/automation-capabilities";
import { capture, useTempDir } from "@hiero-hackers/automation-testkit";
import { createDeliveries } from "../../../src/shell/inbound/deliveries.js";
import { createItemDecider } from "../../../src/shell/decide/item.js";
import type { Applier } from "../../../src/shell/apply/apply.js";
import {
    stubbedExternals,
    type ExternalsForDelivery,
} from "../../../src/shell/decide/externals.js";
import type { ConfigSource } from "../../../src/shell/decide/config.js";
import type { Allowance } from "../../../src/shell/allowance.js";
import type { Log, ShellEvent } from "../../../src/shell/log.js";
import { spending, type Spending } from "../spending.js";

/**
 * Every lane here logs into one list, cleared per test. The event stream is
 * the operator's only view of a lane GitHub stopped watching at the 202, so
 * several cases below assert on it rather than on the store.
 */
let logged: ShellEvent[] = [];
const log: Log = (event) => logged.push(event);

const GUID = asDeliveryGuid("94f5384a-ee9a-33a5-a3cd-6eb589fe2b7a")!;
const SECOND_GUID = asDeliveryGuid("94f5384a-ee9a-33a5-a3cd-6eb589fe2b7b")!;
const FIXTURE = capture("issues.opened.json").bytes();

/**
 * The repository the captured fixture names, and therefore the one every
 * lane here is configured to serve: a delivery from anywhere else is
 * now refused before anything is read, which is its own case below.
 */
const REPOSITORY = { owner: "scrubbed-1", repo: "scrubbed-2" } as const;

/** The issue that fixture opens, which is what every decision row here is about. */
const ITEM = { kind: "issue", number: 164 } as const;

// Maps awaitingTriage because intake requires it: enabling without the
// mapping is now a configRejected, which has its own coverage in core.
const CONFIG_TEXT = `schemaVersion: 2
mode: dry-run
capabilities:
  intake:
    enabled: true
    announce: false
mappings:
  labels:
    awaitingTriage: "status: triage"
`;
const configSource: ConfigSource = {
    load: async () => ({ ok: true, document: { revision: "rev-test-1", text: CONFIG_TEXT } }),
};

const BASE = new Date("2026-08-07T10:00:00.000Z");

const temp = useTempDir("shell-deliveries-");
let store: Store;
beforeEach(() => {
    logged = [];
    store = new Store(temp.file("store.sqlite"));
    store.inbox.acceptDelivery({
        deliveryId: GUID,
        eventName: "issues",
        payload: FIXTURE,
        receivedAt: BASE.toISOString(),
    });
});
afterEach(() => {
    store.close();
});

/** Everything a case may vary about the lane and the box beneath it. */
interface Wiring {
    readonly capabilities: readonly EngineCapability[];
    readonly configSource: ConfigSource;
    readonly clock: () => Date;
    readonly repository?: RepositoryRef;
    readonly externals?: ExternalsForDelivery;
    readonly applier?: Applier;
    readonly allowance?: Allowance;
    readonly suspended?: boolean;
}

/** One lane over the REAL box, which is the only thing any case here drives. */
function laneWith(wiring: Wiring) {
    const repository = wiring.repository ?? REPOSITORY;
    const externals = wiring.externals ?? (() => stubbedExternals());
    return createDeliveries({
        store,
        capabilities: wiring.capabilities,
        lane: () => ({
            configSource: wiring.configSource,
            decideItem: createItemDecider({
                store,
                capabilities: wiring.capabilities,
                externals,
                repository,
                ...(wiring.applier === undefined ? {} : { applier: wiring.applier }),
            }),
        }),
        repository,
        worker: "test-worker",
        log,
        clock: wiring.clock,
        ...(wiring.allowance === undefined ? {} : { allowance: wiring.allowance }),
        ...(wiring.suspended === undefined ? {} : { suspended: wiring.suspended }),
    });
}

/** The healthy lane most cases want: one capability, and a clock that advances a second a call. */
function lane(capability: EngineCapability, firstTickMs = 1_000) {
    let tick = 0;
    return laneWith({
        capabilities: [capability],
        configSource,
        clock: () => new Date(BASE.getTime() + firstTickMs + 1000 * tick++),
    });
}

/**
 * What the lane finished, as its own completion line names it. Nothing else
 * of the record it built leaves the lane any more (D173).
 */
/** What the completion lines said about an undecided record, in order. */
function details(): (string | undefined)[] {
    return logged.flatMap((event) => (event.event === "deliveryCompleted" ? [event.detail] : []));
}

function completions(): { readonly deliveryId: string; readonly kind: string }[] {
    return logged.flatMap((event) =>
        event.event === "deliveryCompleted"
            ? [{ deliveryId: event.deliveryId, kind: event.kind }]
            : [],
    );
}

describe("a config source that cannot answer", () => {
    const withSource = (load: ConfigSource["load"], atMs = 1000) =>
        laneWith({
            capabilities: [toEngine(intake)],
            configSource: { load },
            clock: () => new Date(BASE.getTime() + atMs),
        });

    /** Named or nameless, the file is broken and no redelivery can fix it. */
    it.each([["deadbeef"], [undefined]])(
        "completes a permanent defect at revision %s as configRejected",
        async (revision) => {
            const wedged = withSource(async () => ({
                ok: false,
                permanent: true,
                detail: "the config file is not valid UTF-8",
                ...(revision === undefined ? {} : { revision }),
            }));

            expect(await wedged.processOnce()).toBe(true);
            expect(completions()).toEqual([{ deliveryId: GUID as string, kind: "configRejected" }]);
            expect(details()[0]).toContain("the config file is not valid UTF-8");
        },
    );

    it("spends an attempt on a transient failure instead of retrying at once", async () => {
        const failing = withSource(async () => ({
            ok: false,
            permanent: false,
            detail: "config read failed: transient",
        }));

        await expect(failing.processOnce()).rejects.toThrow("configuration unavailable");
        expect(completions()).toEqual([]);

        // The deliberate change: transient config failures are counted, so a
        // config that is unreachable for good cannot spin the queue forever.
        expect(await withSource(configSource.load, 30_999).processOnce()).toBe(false);
        expect(await withSource(configSource.load, 31_000).processOnce()).toBe(true);
        expect(completions()).toHaveLength(1);
    });
});

describe("a delivery from another repository", () => {
    /** One lane serving `serves`, with every config read counted. */
    function servingLane(serves: { owner: string; repo: string }) {
        let reads = 0;
        return {
            reads: () => reads,
            lane: laneWith({
                capabilities: [toEngine(intake)],
                configSource: {
                    load: async () => {
                        reads += 1;
                        return configSource.load();
                    },
                },
                repository: serves,
                clock: () => new Date(BASE.getTime() + 1000),
            }),
        };
    }

    it("completes as repositoryMismatch, having read nothing about it", async () => {
        const serving = servingLane({ owner: "some-other", repo: "repository" });

        expect(await serving.lane.processOnce()).toBe(true);
        expect(completions()).toEqual([{ deliveryId: GUID as string, kind: "repositoryMismatch" }]);
        expect(details()[0]).toMatch(/^expected some-other\/repository, observed /);
        // Not merely unused: never asked for. A config outage must not turn
        // a permanent property of the delivery into a retry.
        expect(serving.reads()).toBe(0);
    });

    it("neither retries nor dead-letters: the queue is empty afterwards", async () => {
        const serving = servingLane({ owner: "some-other", repo: "repository" });
        await serving.lane.drain();

        expect(completions()).toHaveLength(1);
        expect(store.inbox.deadLetteredDeliveries()).toEqual([]);
        expect(
            store.inbox.claimNextDelivery(
                "assert",
                "2026-08-07T23:00:00.000Z",
                "2026-08-07T22:00:00.000Z",
            ),
        ).toBeUndefined();
    });

    it("holds a matching payload to nothing: GitHub's names are case-blind", async () => {
        const serving = servingLane({ owner: "Scrubbed-1", repo: "SCRUBBED-2" });

        expect(await serving.lane.processOnce()).toBe(true);
        expect(completions()).toEqual([{ deliveryId: GUID as string, kind: "decision" }]);
    });

    /**
     * A payload that does not READABLY name a repository names no seams to
     * read, decide or write through, and every one of these shapes is a way
     * to fall short of naming one. `observed: "none"` is what each is worth.
     */
    it.each([
        ["not an object at all", "not json at all"],
        // `typeof null === "object"`, so null is the shape that reads as a
        // record to anything that forgets to say otherwise.
        ["a literal null", "null"],
        ["no repository", '{"action":"opened"}'],
        ["a repository that is not an object", '{"repository":"scrubbed-1/2"}'],
        ["no owner", '{"repository":{"name":"scrubbed-2"}}'],
        ["an owner without a login", '{"repository":{"owner":{},"name":"x"}}'],
        ["no name", '{"repository":{"owner":{"login":"scrubbed-1"}}}'],
    ])("refuses %s, having read nothing about it", async (_shape, payload) => {
        store.inbox.acceptDelivery({
            deliveryId: SECOND_GUID,
            eventName: "issues",
            payload: Buffer.from(payload),
            receivedAt: new Date(BASE.getTime() + 500).toISOString(),
        });
        const serving = servingLane({ owner: "some-other", repo: "repository" });
        await serving.lane.drain();

        // The fixture is foreign; this one names nothing at all.
        expect(completions()).toEqual([
            { deliveryId: GUID as string, kind: "repositoryMismatch" },
            { deliveryId: SECOND_GUID as string, kind: "repositoryMismatch" },
        ]);
        expect(details()[1]).toBe("expected some-other/repository, observed none");
        expect(serving.reads()).toBe(0);
    });
});

/**
 * One process serves the INSTALLATION (D169). No repository is configured:
 * the payload names one, and that name selects the configuration the pass is
 * read under, the box it is decided by, and the name every row it writes
 * carries. Two repositories of one installation, one after the other.
 */
describe("deliveries from two repositories", () => {
    const OTHER = { owner: "scrubbed-1", repo: "other-repo" } as const;

    /** The captured fixture, re-addressed to another repository of the same installation. */
    function addressedTo(repository: RepositoryRef): Buffer {
        const payload = JSON.parse(Buffer.from(FIXTURE).toString("utf8")) as {
            repository: Record<string, unknown>;
        };
        return Buffer.from(
            JSON.stringify({
                ...payload,
                repository: {
                    ...payload.repository,
                    owner: { login: repository.owner },
                    name: repository.repo,
                },
            }),
        );
    }

    /** Only the fixture's own repository announces, so the two configs decide differently. */
    const configFor = (repository: RepositoryRef): string =>
        CONFIG_TEXT.replace(
            "announce: false",
            `announce: ${String(repository.repo === REPOSITORY.repo)}`,
        );

    /** A lane serving whatever a payload names, recording which it was asked for. */
    function installationLane(asked: string[]) {
        const capabilities = [toEngine(intake)];
        return createDeliveries({
            store,
            capabilities,
            lane: (repository) => {
                asked.push(`${repository.owner}/${repository.repo}`);
                return {
                    configSource: {
                        load: async () => ({
                            ok: true,
                            document: { revision: "rev-two", text: configFor(repository) },
                        }),
                    },
                    decideItem: createItemDecider({
                        store,
                        capabilities,
                        externals: () => stubbedExternals(),
                        repository,
                    }),
                };
            },
            worker: "test-worker",
            clock: () => new Date(BASE.getTime() + 1000),
            log,
        });
    }

    const wouldApply = (repository: RepositoryRef): number =>
        store.ledger.decisionsOn(repository, ITEM).filter((row) => row.code === "wouldApply")
            .length;

    it("decides each under its own configuration and writes rows under its own name", async () => {
        store.inbox.acceptDelivery({
            deliveryId: SECOND_GUID,
            eventName: "issues",
            payload: addressedTo(OTHER),
            receivedAt: new Date(BASE.getTime() + 500).toISOString(),
        });
        const asked: string[] = [];
        await installationLane(asked).drain();

        expect(completions()).toEqual([
            { deliveryId: GUID as string, kind: "decision" },
            { deliveryId: SECOND_GUID as string, kind: "decision" },
        ]);
        expect(asked).toEqual(["scrubbed-1/scrubbed-2", "scrubbed-1/other-repo"]);
        // The announcing config plans a comment as well as a label; the other
        // plans only the label. Same item number, two repositories, two answers.
        expect(wouldApply(REPOSITORY)).toBe(2);
        expect(wouldApply(OTHER)).toBe(1);
        expect(store.ledger.decisionsOn(OTHER, ITEM).map((row) => row.repository)).toEqual(
            store.ledger.decisionsOn(OTHER, ITEM).map(() => OTHER),
        );
    });
});

/**
 * The installation switch (D171). The delivery is verified, accepted and
 * FINISHED, so nothing is lost and nothing will redrive it — and the
 * configuration is never asked, which is what "reads nothing" means here.
 */
describe("a delivery under a suspended installation", () => {
    /** A source no suspended pass may reach: being called is the failure. */
    const untouchable: ConfigSource = {
        load: () => {
            throw new Error("the configuration was consulted");
        },
    };

    const suspendedLane = () =>
        laneWith({
            capabilities: [toEngine(intake)],
            configSource: untouchable,
            clock: () => new Date(BASE.getTime() + 1000),
            suspended: true,
        });

    it("completes as installationSuspended, having consulted no configuration", async () => {
        expect(await suspendedLane().processOnce()).toBe(true);

        expect(completions()).toEqual([
            { deliveryId: GUID as string, kind: "installationSuspended" },
        ]);
    });

    it("writes no decision row: nothing was decided to write one about", async () => {
        await suspendedLane().drain();

        expect(store.ledger.decisionsOn(REPOSITORY, ITEM)).toEqual([]);
    });

    it("neither retries nor dead-letters: the delivery is done, not deferred", async () => {
        await suspendedLane().drain();

        expect(store.inbox.deadLetteredDeliveries()).toEqual([]);
        expect(
            store.inbox.claimNextDelivery(
                "assert",
                "2026-08-07T23:00:00.000Z",
                "2026-08-07T22:00:00.000Z",
            ),
        ).toBeUndefined();
    });
});

describe("a crash counts an attempt", () => {
    it("the delivery survives its lane and is retried once its wait is up", async () => {
        const failing = laneWith({
            capabilities: [toEngine(intake)],
            configSource,
            externals: () => {
                throw new Error("live externals unavailable");
            },
            clock: () => new Date(BASE.getTime() + 1000),
        });
        await expect(failing.processOnce()).rejects.toThrow("live externals unavailable");
        expect(completions()).toEqual([]);

        // Durable but waiting: the attempt bought thirty seconds, and the
        // millisecond before them claims nothing.
        expect(await lane(toEngine(intake), 30_999).processOnce()).toBe(false);
        expect(await lane(toEngine(intake), 31_000).processOnce()).toBe(true);
        expect(completions()).toEqual([{ deliveryId: GUID as string, kind: "decision" }]);
    });

    it("an empty queue reports itself instead of pretending to work", async () => {
        const healthy = lane(toEngine(intake));
        expect(await healthy.processOnce()).toBe(true);
        expect(await healthy.processOnce()).toBe(false);
        expect(completions()).toHaveLength(1);
    });

    it("does not steal a fresh claim but takes over after the 15-minute lease", async () => {
        expect(
            store.inbox.claimNextDelivery(
                "stalled-worker",
                new Date(BASE.getTime() + 60_000).toISOString(),
                new Date(BASE.getTime() - 60_000).toISOString(),
            ),
        ).toBeDefined();

        const fresh = lane(toEngine(intake), 10 * 60_000);
        expect(await fresh.processOnce()).toBe(false);
        expect(completions()).toEqual([]);

        const stale = lane(toEngine(intake), 16 * 60_000);
        expect(await stale.processOnce()).toBe(true);
        expect(completions()).toHaveLength(1);
    });

    it("starts a new drain after the previous queue became empty", async () => {
        const healthy = lane(toEngine(intake));
        await healthy.drain();
        expect(completions()).toHaveLength(1);

        store.inbox.acceptDelivery({
            deliveryId: SECOND_GUID,
            eventName: "issues",
            payload: FIXTURE,
            receivedAt: new Date(BASE.getTime() + 10_000).toISOString(),
        });
        await healthy.drain();
        expect(completions()).toHaveLength(2);
    });

    it("does not persist or complete after its delivery claim is released", async () => {
        const lostClaim: EngineCapability = {
            declaration: intakeDeclaration,
            evaluate: async () => {
                expect(store.inbox.requeueStuckDeliveries("2026-08-07T10:00:01.000Z")).toEqual([
                    GUID,
                ]);
                return [];
            },
        };
        const candidate = lane(lostClaim);

        await expect(candidate.processOnce()).rejects.toThrow(
            "delivery was not completed: notOwned",
        );
        expect(completions()).toEqual([]);
        // A lost claim counted nothing, so the line reports no number: an
        // attempts figure here would be one this delivery never spent.
        expect(logged.filter((event) => event.event === "deliveryAttemptFailed")).toEqual([
            {
                event: "deliveryAttemptFailed",
                deliveryId: GUID as string,
                disposition: "notOwned",
                attempts: null,
                maxAttempts: 5,
                retryNotBefore: null,
                detail: expect.stringContaining("delivery was not completed: notOwned"),
            },
        ]);
        expect(
            store.inbox.claimNextDelivery(
                "next-worker",
                "2026-08-07T10:01:00.000Z",
                "2026-08-07T09:00:00.000Z",
            ),
        ).toBeDefined();
    });

    it("ends the drain on a lost claim rather than spinning on the same delivery", async () => {
        // Requeued mid-decision, the delivery is claimable again at once and
        // the failed attempt cannot be counted against it. A drain that kept
        // going would re-claim it forever, so this test hangs if it does.
        const lostClaim: EngineCapability = {
            declaration: intakeDeclaration,
            evaluate: async () => {
                store.inbox.requeueStuckDeliveries("2026-08-07T10:30:00.000Z");
                return [];
            },
        };
        await lane(lostClaim).drain();

        expect(completions()).toEqual([]);
        expect(
            store.inbox.claimNextDelivery(
                "next-worker",
                "2026-08-07T10:01:00.000Z",
                "2026-08-07T09:00:00.000Z",
            ),
        ).toMatchObject({ attempts: 0 });
    });
});

/**
 * The lane's own share of GitHub's limits (D192). A delivery decided around a
 * read the allowance refused is NOT the answer to that delivery, so it is not
 * completed: the attempt is counted and the delivery waits, on the same ladder
 * a crash puts it on, but no longer than the pool's own window.
 */
describe("a read this lane's allowance refused", () => {
    /** When GitHub's window rolls — sooner than the ladder's first step, which is thirty seconds. */
    const RESET = new Date(BASE.getTime() + 20_000).toISOString();

    /** A lane charged one core read per delivery, with the clock in the case's hands. */
    function charged(allowance: Spending, at: () => Date) {
        return laneWith({
            capabilities: [toEngine(intake)],
            configSource,
            externals: () => {
                allowance.charge("core");
                return stubbedExternals();
            },
            clock: at,
            allowance,
        });
    }

    const failures = (): ShellEvent[] =>
        logged.filter((event) => event.event === "deliveryAttemptFailed");

    it("retries at the pool's reset, then decides once the window has rolled", async () => {
        // The cap is the fake's own record, so the case can open the window on it.
        const caps = { core: 0 };
        const allowance = spending(caps);
        allowance.resetAt = RESET;
        let at = new Date(BASE.getTime() + 1_000);
        const refusing = charged(allowance, () => at);

        await expect(refusing.processOnce()).rejects.toThrow(
            "the webhook lane's core allowance refused a read",
        );

        expect(completions()).toEqual([]);
        expect(failures()).toEqual([
            {
                event: "deliveryAttemptFailed",
                deliveryId: GUID as string,
                disposition: "retryScheduled",
                attempts: 1,
                maxAttempts: 5,
                // The pool's window, not the ladder's thirty seconds.
                retryNotBefore: RESET,
                pool: "core",
                detail: expect.stringContaining("core allowance refused a read"),
            },
        ]);

        caps.core = 10;
        at = new Date(RESET);
        expect(await refusing.processOnce()).toBe(true);
        expect(completions()).toEqual([{ deliveryId: GUID as string, kind: "decision" }]);
    });

    it("waits out the ladder's step where the pool resets later than it", async () => {
        const allowance = spending({ core: 0 });
        allowance.resetAt = new Date(BASE.getTime() + 10 * 60_000).toISOString();
        const at = new Date(BASE.getTime() + 1_000);

        await expect(charged(allowance, () => at).processOnce()).rejects.toThrow();

        expect(failures()[0]).toMatchObject({
            retryNotBefore: new Date(at.getTime() + 30_000).toISOString(),
            pool: "core",
        });
    });

    /** Five refusals are five attempts: the delivery ends as any other failure does. */
    it("dead-letters at five refusals", async () => {
        const allowance = spending({ core: 0 });
        for (const ms of [10_000, 40_000, 100_000, 220_000, 460_000]) {
            await charged(allowance, () => new Date(BASE.getTime() + ms)).drain();
        }

        expect(completions()).toEqual([]);
        expect(failures()).toHaveLength(5);
        expect(logged).toContainEqual({
            event: "deliveryDeadLettered",
            deliveryId: GUID as string,
            attempts: 5,
        });
        expect(store.inbox.deadLetteredDeliveries()).toMatchObject([
            { deliveryId: GUID, attempts: 5 },
        ]);
    });

    /** The refusal must be this delivery's own: an older one cannot keep the lane from finishing. */
    it("counts only what was refused while its own pass ran", async () => {
        const allowance = spending({ core: 0 });
        allowance.charge("core");
        expect(allowance.refusals()).toBe(1);

        const quiet = laneWith({
            capabilities: [toEngine(intake)],
            configSource,
            clock: () => new Date(BASE.getTime() + 1_000),
            allowance,
        });

        expect(await quiet.processOnce()).toBe(true);
        expect(completions()).toEqual([{ deliveryId: GUID as string, kind: "decision" }]);
    });
});

describe("a poison delivery", () => {
    /** A payload the externals seam below is willing to answer for. */
    const HEALTHY = Buffer.from(
        JSON.stringify({
            action: "healthy",
            repository: { owner: { login: REPOSITORY.owner }, name: REPOSITORY.repo },
        }),
    );
    let consulted = 0;

    /** One whole drain at one instant, failing everything but HEALTHY. */
    async function drainAt(offsetMs: number): Promise<void> {
        await laneWith({
            capabilities: [toEngine(intake)],
            configSource,
            externals: ({ payload }) => {
                consulted++;
                if ((payload as { action?: unknown }).action === "healthy") {
                    return stubbedExternals();
                }
                throw new Error("live externals unavailable");
            },
            clock: () => new Date(BASE.getTime() + offsetMs),
        }).drain();
    }

    beforeEach(() => {
        consulted = 0;
        store.inbox.acceptDelivery({
            deliveryId: SECOND_GUID,
            eventName: "issues",
            payload: HEALTHY,
            receivedAt: new Date(BASE.getTime() + 1000).toISOString(),
        });
    });

    /** When each attempt is made, in the order the ladder makes them. */
    const LADDER = [10_000, 40_000, 100_000, 220_000, 460_000];

    /** The failure line the poison delivery earns on its `attempt`th try. */
    function attemptFailure(attempt: number): Record<string, unknown> {
        const failedAt = BASE.getTime() + LADDER[attempt - 1]!;
        const deadLettered = attempt === LADDER.length;
        return {
            event: "deliveryAttemptFailed",
            deliveryId: GUID as string,
            disposition: deadLettered ? "deadLettered" : "retryScheduled",
            attempts: attempt,
            maxAttempts: 5,
            // The wait doubles per attempt already spent, from thirty seconds.
            retryNotBefore: deadLettered
                ? null
                : new Date(failedAt + 30_000 * 2 ** (attempt - 1)).toISOString(),
            detail: expect.stringContaining("live externals unavailable"),
        };
    }

    it("backs off, lets the queue behind it through, and dead-letters at five attempts", async () => {
        // The poison delivery is the OLDEST, so the queue behind it only
        // moves if a failed drain steps over it instead of unwinding.
        await drainAt(10_000);
        expect(consulted).toBe(2);
        expect(completions()).toEqual([{ deliveryId: SECOND_GUID as string, kind: "decision" }]);

        // Thirty seconds, then sixty: the wait doubles per spent attempt,
        // and neither is served a millisecond early.
        consulted = 0;
        await drainAt(39_999);
        expect(consulted).toBe(0);
        await drainAt(40_000);
        await drainAt(99_999);
        expect(consulted).toBe(1);

        // Attempts three, four and five, at 100s, 220s and 460s.
        await drainAt(100_000);
        await drainAt(220_000);
        await drainAt(460_000);
        expect(consulted).toBe(4);

        expect(store.inbox.deadLetteredDeliveries()).toEqual([
            expect.objectContaining({
                deliveryId: GUID,
                eventName: "issues",
                receivedAt: BASE.toISOString(),
                attempts: 5,
                failedAt: new Date(BASE.getTime() + 460_000).toISOString(),
            }),
        ]);

        // Inspectable, and claimed by nothing however long it waits.
        consulted = 0;
        await drainAt(24 * 60 * 60_000);
        expect(consulted).toBe(0);
        expect(completions()).toHaveLength(1);
    });

    /**
     * The same ladder, read as an operator reads it. Every attempt is on
     * the record with the number it spent and the instant it may be tried
     * again, and the delivery that STOPPED says so in a line of its own —
     * a dead letter nothing reports is a delivery that just went quiet.
     */
    it("counts every attempt in the log and names the delivery that stopped", async () => {
        for (const at of LADDER) await drainAt(at);

        expect(logged.filter((event) => event.event === "deliveryAttemptFailed")).toEqual(
            LADDER.map((_at, index) => attemptFailure(index + 1)),
        );
        expect(logged.filter((event) => event.event === "deliveryDeadLettered")).toEqual([
            { event: "deliveryDeadLettered", deliveryId: GUID as string, attempts: 5 },
        ]);
        // The healthy delivery behind it completed, and never failed.
        expect(logged).toContainEqual({
            event: "deliveryCompleted",
            deliveryId: SECOND_GUID as string,
            kind: "decision",
        });
    });
});

/**
 * What the lane makes of the box's two answers. The gate itself, and what a
 * wired applier is handed, are `decide/item.test.ts`; here the question is
 * only which record each answer becomes, and what the completion line names.
 */
describe("the two answers the box gives this lane", () => {
    const ACTIVE_CONFIG = CONFIG_TEXT.replace("mode: dry-run", "mode: active");

    /** An applier that reports one outcome per approved effect. */
    const applying: Applier = {
        applyAll: (effects: readonly Effect[]) =>
            Promise.resolve(
                effects.map((effect) => ({
                    effectId: effect.intent.idempotencyKey,
                    capability: effect.intent.capability,
                    operation: effect.intent.operation,
                    item: effect.intent.item,
                    outcome: "applied" as const,
                    code: null,
                    detail: null,
                })),
            ),
        recover: () => Promise.resolve(),
    };

    function withConfig(text: string, applier?: Applier) {
        return laneWith({
            capabilities: [toEngine(intake)],
            configSource: {
                load: async () => ({ ok: true, document: { revision: "rev-a", text } }),
            },
            clock: () => new Date(BASE.getTime() + 1000),
            ...(applier === undefined ? {} : { applier }),
        });
    }

    it("still refuses active mode before deciding when nothing wired a write path", async () => {
        expect(await withConfig(ACTIVE_CONFIG).processOnce()).toBe(true);

        expect(completions()).toEqual([{ deliveryId: GUID as string, kind: "modeUnsupported" }]);
    });

    /** A record kind is not added: what the applier made of the effects is a row. */
    it("stays a decision, and the applier's outcome is a row of its own", async () => {
        expect(await withConfig(ACTIVE_CONFIG, applying).processOnce()).toBe(true);

        expect(completions()).toEqual([{ deliveryId: GUID as string, kind: "decision" }]);
        expect(store.ledger.decisionsOn(REPOSITORY, ITEM)).toContainEqual(
            expect.objectContaining({
                capability: "intake",
                verdict: "applied",
                effectId: expect.any(String),
            }),
        );
    });

    /** One instant for the whole pass, so the rows cannot disagree with each other. */
    it("stamps every row the box wrote with the instant the lane read once", async () => {
        expect(await lane(toEngine(intake)).processOnce()).toBe(true);

        const rows = store.ledger.decisionsOn(REPOSITORY, ITEM);
        expect(rows.length).toBeGreaterThan(0);
        // The second tick: the claim before it took the first.
        expect(new Set(rows.map((row) => row.at))).toEqual(
            new Set([new Date(BASE.getTime() + 2000).toISOString()]),
        );
    });
});

/**
 * The one read the sweep borrows from this lane. It exists so a firing gates
 * on the same file a delivery would, rather than growing a second reader that
 * could disagree about whether a repository is still in active mode.
 */
describe("the configuration this lane reads", () => {
    const reading = (load: ConfigSource["load"]) =>
        laneWith({
            capabilities: [toEngine(intake)],
            configSource: { load },
            clock: () => BASE,
        });

    it("answers with the parsed configuration", async () => {
        expect(await reading(configSource.load).configuration(REPOSITORY)).toMatchObject({
            mode: "dry-run",
            revision: "rev-test-1",
        });
    });

    it("answers null when the file does not parse", async () => {
        const broken = async () => ({
            ok: true as const,
            document: { revision: "rev-x", text: "schemaVersion: 9" },
        });

        expect(await reading(broken).configuration(REPOSITORY)).toBeNull();
    });

    it("answers null when the source could not be reached at all", async () => {
        const unreachable = async () => ({
            ok: false as const,
            permanent: false,
            detail: "config read failed: transient",
        });

        expect(await reading(unreachable).configuration(REPOSITORY)).toBeNull();
    });
});

/**
 * The one thing this lane does for the OTHER one. The lane reads the
 * configuration on every delivery, so it is where a repository's standing
 * request to be swept gets written down (`design/guides/sweep.md` §2).
 */
describe("the sweep row this lane declares", () => {
    const INACTIVITY_CONFIG = `schemaVersion: 2
mode: dry-run
capabilities:
  inactivity:
    enabled: ENABLED
    remindAfter: 14d
    reap:
      after: 21d
`;

    const declaring = (enabled: boolean) =>
        laneWith({
            capabilities: [inactivity],
            configSource: {
                load: async () => ({
                    ok: true,
                    document: {
                        revision: "rev-sweep",
                        text: INACTIVITY_CONFIG.replace("ENABLED", String(enabled)),
                    },
                }),
            },
            clock: () => BASE,
        });

    it("declares one due now when a clock-driven capability is enabled", async () => {
        await declaring(true).processOnce();

        expect(store.ledger.claimDue(BASE.toISOString())).toMatchObject([
            {
                scheduleId: `sweep:${REPOSITORY.owner}/${REPOSITORY.repo}`,
                dueAt: BASE.toISOString(),
                effect: "sweep",
            },
        ]);
    });

    it("declares none when the repository enables no capability that runs on a clock", async () => {
        await declaring(false).processOnce();

        expect(store.ledger.claimDue(BASE.toISOString())).toEqual([]);
    });
});
