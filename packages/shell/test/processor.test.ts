/**
 * The worker's failure honesty: a crash mid-decision COUNTS an attempt —
 * the delivery stays durable, waits out a widening backoff, and is
 * eventually dead-lettered rather than retried forever — and a completed
 * delivery never runs twice. The receiver acknowledged long before any of
 * this; GitHub is not watching.
 *
 * Failures here are injected through the externals seam, which is the one
 * this worker actually meets (`live externals unavailable`) and the one
 * whose throw the processor sees: a capability that throws is contained by
 * `decide()` and reported, never raised.
 *
 * One case here is not about failure at all: the delivery that is refused
 * because it names another repository. It sits with these because it is
 * the fourth way a claimed delivery can end, and because what it must NOT
 * do — retry, dead-letter, or read a configuration — is what everything
 * else in this file is about.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
    asDeliveryGuid,
    toEngine,
    type ApprovedEffect,
    type EngineCapability,
} from "@hiero-hackers/automation-core";
import { Store } from "@hiero-hackers/automation-store";
import { intake, intakeDeclaration } from "@hiero-hackers/automation-probes";
import { capture, useTempDir } from "@hiero-hackers/automation-testkit";
import { createProcessor } from "../src/processor.js";
import type { Applier } from "../src/apply.js";
import { stubbedExternals } from "../src/externals.js";
import type { ConfigSource } from "../src/config.js";
import type { Log, ShellEvent } from "../src/log.js";

/**
 * Every processor here logs into one list, cleared per test. The event
 * stream is the operator's only view of a lane GitHub stopped watching at
 * the 202, so several cases below assert on it rather than on the store.
 */
let logged: ShellEvent[] = [];
const log: Log = (event) => logged.push(event);

const GUID = asDeliveryGuid("94f5384a-ee9a-33a5-a3cd-6eb589fe2b7a")!;
const SECOND_GUID = asDeliveryGuid("94f5384a-ee9a-33a5-a3cd-6eb589fe2b7b")!;
const FIXTURE = capture("issues.opened.json").bytes();

/**
 * The repository the captured fixture names, and therefore the one every
 * processor here is configured to serve: a delivery from anywhere else is
 * now refused before anything is read, which is its own case below.
 */
const REPOSITORY = { owner: "scrubbed-1", repo: "scrubbed-2" } as const;

// Maps awaitingTriage because intake requires it: enabling without the
// mapping is now a configRejected, which has its own coverage in core.
const CONFIG_TEXT = `schemaVersion: 1
mode: dry-run
capabilities:
  intake:
    enabled: true
    settings:
      announce: false
mappings:
  labels:
    awaitingTriage: "status: triage"
`;
const configSource: ConfigSource = {
    load: async () => ({ ok: true, document: { revision: "rev-test-1", text: CONFIG_TEXT } }),
};

const BASE = new Date("2026-08-07T10:00:00.000Z");

const temp = useTempDir("shell-processor-");
let store: Store;
beforeEach(() => {
    logged = [];
    store = new Store(temp.file("store.sqlite"));
    store.acceptDelivery({
        deliveryId: GUID,
        eventName: "issues",
        payload: FIXTURE,
        receivedAt: BASE.toISOString(),
    });
});
afterEach(() => {
    store.close();
});

function processor(capability: EngineCapability, firstTickMs = 1_000) {
    let tick = 0;
    return createProcessor({
        store,
        capabilities: [capability],
        configSource,
        externals: () => stubbedExternals(),
        repository: REPOSITORY,
        worker: "test-worker",
        log,
        clock: () => new Date(BASE.getTime() + firstTickMs + 1000 * tick++),
    });
}

function records(): Record<string, unknown>[] {
    return store
        .deliveryReports()
        .map((report) => JSON.parse(report.reportJson) as Record<string, unknown>);
}

describe("a config source that cannot answer", () => {
    const withSource = (load: ConfigSource["load"], atMs = 1000) =>
        createProcessor({
            store,
            capabilities: [toEngine(intake)],
            configSource: { load },
            externals: () => stubbedExternals(),
            repository: REPOSITORY,
            worker: "test-worker",
            log,
            clock: () => new Date(BASE.getTime() + atMs),
        });

    it("completes a permanent defect as configRejected — retrying cannot fix a file", async () => {
        const wedged = withSource(async () => ({
            ok: false,
            permanent: true,
            detail: "the config file is not valid UTF-8",
            revision: "deadbeef",
        }));

        expect(await wedged.processOnce()).toBe(true);
        expect(records()).toEqual([
            expect.objectContaining({
                kind: "configRejected",
                configRevision: "deadbeef",
                errors: [
                    expect.objectContaining({
                        code: "documentUnparseable",
                        // The code cannot distinguish a file that would not
                        // parse from one that could not be read at all, so
                        // the message is the only place that difference is
                        // said — and the operator's only route to the fix.
                        message: "unreadable before parsing: the config file is not valid UTF-8",
                    }),
                ],
            }),
        ]);
    });

    it("stamps the unreadable revision when the source could not name one", async () => {
        const nameless = withSource(async () => ({
            ok: false,
            permanent: true,
            detail: "the config file is not valid UTF-8",
        }));

        expect(await nameless.processOnce()).toBe(true);
        expect(records()).toEqual([
            expect.objectContaining({
                kind: "configRejected",
                configRevision: "sha256:unreadable",
            }),
        ]);
    });

    it("spends an attempt on a transient failure instead of retrying at once", async () => {
        const failing = withSource(async () => ({
            ok: false,
            permanent: false,
            detail: "config read failed: transient",
        }));

        await expect(failing.processOnce()).rejects.toThrow("configuration unavailable");
        expect(records()).toEqual([]);

        // The deliberate change: transient config failures are counted, so a
        // config that is unreachable for good cannot spin the queue forever.
        expect(await withSource(configSource.load, 30_999).processOnce()).toBe(false);
        expect(await withSource(configSource.load, 31_000).processOnce()).toBe(true);
        expect(records()).toHaveLength(1);
    });
});

describe("a delivery from another repository", () => {
    /** One processor serving `serves`, with every config read counted. */
    function servingProcessor(serves: { owner: string; repo: string }) {
        let reads = 0;
        return {
            reads: () => reads,
            processor: createProcessor({
                store,
                capabilities: [toEngine(intake)],
                configSource: {
                    load: async () => {
                        reads += 1;
                        return configSource.load();
                    },
                },
                externals: () => stubbedExternals(),
                repository: serves,
                worker: "test-worker",
                log,
                clock: () => new Date(BASE.getTime() + 1000),
            }),
        };
    }

    it("completes as repositoryMismatch, having read nothing about it", async () => {
        const serving = servingProcessor({ owner: "some-other", repo: "repository" });

        expect(await serving.processor.processOnce()).toBe(true);
        expect(records()).toEqual([
            expect.objectContaining({
                kind: "repositoryMismatch",
                deliveryId: GUID as string,
                expected: "some-other/repository",
                observed: "scrubbed-1/scrubbed-2",
                configRevision: "sha256:unconsulted",
            }),
        ]);
        // Not merely unused: never asked for. A config outage must not turn
        // a permanent property of the delivery into a retry.
        expect(serving.reads()).toBe(0);
    });

    it("neither retries nor dead-letters: the queue is empty afterwards", async () => {
        const serving = servingProcessor({ owner: "some-other", repo: "repository" });
        await serving.processor.drain();

        expect(records()).toHaveLength(1);
        expect(store.deadLetteredDeliveries()).toEqual([]);
        expect(
            store.claimNextDelivery(
                "assert",
                "2026-08-07T23:00:00.000Z",
                "2026-08-07T22:00:00.000Z",
            ),
        ).toBeUndefined();
    });

    it("holds a matching payload to nothing: GitHub's names are case-blind", async () => {
        const serving = servingProcessor({ owner: "Scrubbed-1", repo: "SCRUBBED-2" });

        expect(await serving.processor.processOnce()).toBe(true);
        expect(records()).toEqual([expect.objectContaining({ kind: "decision" })]);
    });

    /**
     * A payload that does not READABLY name a repository cannot be judged
     * foreign, and every one of these shapes is a way to fall short of
     * naming one. Each must reach `decide()` and come back as a report
     * naming the malformation — the shell does not pre-empt that verdict,
     * and must not trip over the missing fields on its way past them.
     */
    it.each([
        ["not an object at all", "not json at all", "payloadNotObject"],
        // `typeof null === "object"`, so null is the shape that reads as a
        // record to anything that forgets to say otherwise.
        ["a literal null", "null", "payloadNotObject"],
        ["no repository", '{"action":"opened"}', "repositoryUnreadable"],
        [
            "a repository that is not an object",
            '{"repository":"scrubbed-1/2"}',
            "repositoryUnreadable",
        ],
        ["no owner", '{"repository":{"name":"scrubbed-2"}}', "repositoryUnreadable"],
        [
            "an owner without a login",
            '{"repository":{"owner":{},"name":"x"}}',
            "repositoryUnreadable",
        ],
        ["no name", '{"repository":{"owner":{"login":"scrubbed-1"}}}', "repositoryUnreadable"],
    ])("leaves %s to the report that names it", async (_shape, payload, code) => {
        store.acceptDelivery({
            deliveryId: SECOND_GUID,
            eventName: "issues",
            payload: Buffer.from(payload),
            receivedAt: new Date(BASE.getTime() + 500).toISOString(),
        });
        const serving = servingProcessor({ owner: "some-other", repo: "repository" });
        await serving.processor.drain();

        // The fixture is foreign and refused; this one is merely unreadable.
        const [foreign, unreadable] = records();
        expect(foreign).toMatchObject({ kind: "repositoryMismatch" });
        expect(unreadable).toMatchObject({
            kind: "decision",
            deliveryId: SECOND_GUID as string,
            report: { findings: [expect.objectContaining({ code })] },
        });
    });
});

describe("a crash counts an attempt", () => {
    it("the delivery survives its processor and is retried once its wait is up", async () => {
        const failing = createProcessor({
            store,
            capabilities: [toEngine(intake)],
            configSource,
            externals: () => {
                throw new Error("live externals unavailable");
            },
            repository: REPOSITORY,
            worker: "test-worker",
            log,
            clock: () => new Date(BASE.getTime() + 1000),
        });
        await expect(failing.processOnce()).rejects.toThrow("live externals unavailable");
        expect(records()).toEqual([]);

        // Durable but waiting: the attempt bought thirty seconds, and the
        // millisecond before them claims nothing.
        expect(await processor(toEngine(intake), 30_999).processOnce()).toBe(false);
        expect(await processor(toEngine(intake), 31_000).processOnce()).toBe(true);
        expect(records()).toEqual([
            expect.objectContaining({
                kind: "decision",
                deliveryId: GUID as string,
                configRevision: "rev-test-1",
            }),
        ]);
    });

    it("hands the externals factory the delivery's parsed payload", async () => {
        // The live path derives its cause fingerprint from this argument;
        // a processor that stopped passing it would break exclusion quietly.
        const seen: unknown[] = [];
        const observing = createProcessor({
            store,
            capabilities: [toEngine(intake)],
            configSource,
            externals: (delivery) => {
                seen.push(delivery.payload);
                return stubbedExternals();
            },
            repository: REPOSITORY,
            worker: "test-worker",
            log,
            clock: () => new Date(BASE.getTime() + 1000),
        });

        expect(await observing.processOnce()).toBe(true);
        expect(seen).toHaveLength(1);
        expect(seen[0]).toMatchObject({ action: expect.any(String) });
    });

    it("an empty queue reports itself instead of pretending to work", async () => {
        const healthy = processor(toEngine(intake));
        expect(await healthy.processOnce()).toBe(true);
        expect(await healthy.processOnce()).toBe(false);
        expect(records()).toHaveLength(1);
    });

    it("does not steal a fresh claim but takes over after the 15-minute lease", async () => {
        expect(
            store.claimNextDelivery(
                "stalled-worker",
                new Date(BASE.getTime() + 60_000).toISOString(),
                new Date(BASE.getTime() - 60_000).toISOString(),
            ),
        ).toBeDefined();

        const fresh = processor(toEngine(intake), 10 * 60_000);
        expect(await fresh.processOnce()).toBe(false);
        expect(records()).toEqual([]);

        const stale = processor(toEngine(intake), 16 * 60_000);
        expect(await stale.processOnce()).toBe(true);
        expect(records()).toHaveLength(1);
    });

    it("starts a new drain after the previous queue became empty", async () => {
        const healthy = processor(toEngine(intake));
        await healthy.drain();
        expect(records()).toHaveLength(1);

        store.acceptDelivery({
            deliveryId: SECOND_GUID,
            eventName: "issues",
            payload: FIXTURE,
            receivedAt: new Date(BASE.getTime() + 10_000).toISOString(),
        });
        await healthy.drain();
        expect(records()).toHaveLength(2);
    });

    it("does not persist or complete after its delivery claim is released", async () => {
        const lostClaim: EngineCapability = {
            declaration: intakeDeclaration,
            evaluate: async () => {
                expect(store.requeueStuckDeliveries("2026-08-07T10:00:01.000Z")).toEqual([GUID]);
                return [];
            },
        };
        const candidate = processor(lostClaim);

        await expect(candidate.processOnce()).rejects.toThrow(
            "delivery report was not committed: notOwned",
        );
        expect(records()).toEqual([]);
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
                detail: expect.stringContaining("delivery report was not committed: notOwned"),
            },
        ]);
        expect(
            store.claimNextDelivery(
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
                store.requeueStuckDeliveries("2026-08-07T10:30:00.000Z");
                return [];
            },
        };
        await processor(lostClaim).drain();

        expect(records()).toEqual([]);
        expect(
            store.claimNextDelivery(
                "next-worker",
                "2026-08-07T10:01:00.000Z",
                "2026-08-07T09:00:00.000Z",
            ),
        ).toMatchObject({ attempts: 0 });
    });
});

describe("a poison delivery", () => {
    /** A payload the externals seam below is willing to answer for. */
    const HEALTHY = Buffer.from(JSON.stringify({ action: "healthy" }));
    let consulted = 0;

    /** One whole drain at one instant, failing everything but HEALTHY. */
    async function drainAt(offsetMs: number): Promise<void> {
        await createProcessor({
            store,
            capabilities: [toEngine(intake)],
            configSource,
            externals: ({ payload }) => {
                consulted++;
                if ((payload as { action?: unknown }).action === "healthy") {
                    return stubbedExternals();
                }
                throw new Error("live externals unavailable");
            },
            repository: REPOSITORY,
            worker: "test-worker",
            log,
            clock: () => new Date(BASE.getTime() + offsetMs),
        }).drain();
    }

    beforeEach(() => {
        consulted = 0;
        store.acceptDelivery({
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
        expect(records()).toEqual([expect.objectContaining({ deliveryId: SECOND_GUID as string })]);

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

        expect(store.deadLetteredDeliveries()).toEqual([
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
        expect(records()).toHaveLength(1);
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
 * The write path's wiring, and the gate that is deliberately still shut.
 *
 * `main.ts` supplies no applier, so `mode: active` still ends as
 * `modeUnsupported` before a decision is even attempted — that is the shipped
 * behaviour and the first case below is what holds it there. Everything after
 * it is what a composition root that DOES supply one gets, which is how this
 * lane is tested without opening the gate.
 */
describe("the effects a decision approved", () => {
    const ACTIVE_CONFIG = CONFIG_TEXT.replace("mode: dry-run", "mode: active");

    /** An applier that records what it was handed and reports one outcome. */
    function recordingApplier() {
        const passes: { effects: readonly ApprovedEffect[]; revision: string }[] = [];
        const applier: Applier = {
            applyAll: (effects, config) => {
                passes.push({ effects, revision: config.revision });
                return Promise.resolve(
                    effects.map((effect) => ({
                        effectId: effect.intent.idempotencyKey,
                        capability: effect.intent.capability,
                        operation: effect.intent.operation,
                        item: effect.intent.item,
                        outcome: "applied" as const,
                        code: null,
                        detail: null,
                    })),
                );
            },
            recover: () => Promise.resolve(),
        };
        return { applier, passes };
    }

    function withConfig(text: string, applier?: Applier) {
        return createProcessor({
            store,
            capabilities: [toEngine(intake)],
            configSource: {
                load: async () => ({ ok: true, document: { revision: "rev-a", text } }),
            },
            externals: () => stubbedExternals(),
            repository: REPOSITORY,
            worker: "test-worker",
            log,
            clock: () => new Date(BASE.getTime() + 1000),
            ...(applier === undefined ? {} : { applier }),
        });
    }

    it("still refuses active mode before deciding when nothing wired a write path", async () => {
        expect(await withConfig(ACTIVE_CONFIG).processOnce()).toBe(true);

        expect(records()).toEqual([
            expect.objectContaining({
                kind: "modeUnsupported",
                reason: "active mode is unsupported by the runnable shell",
            }),
        ]);
    });

    it("hands the approved effects to a wired applier, under the same configuration", async () => {
        const wired = recordingApplier();

        expect(await withConfig(ACTIVE_CONFIG, wired.applier).processOnce()).toBe(true);

        expect(wired.passes).toHaveLength(1);
        expect(wired.passes[0]!.revision).toBe("rev-a");
        expect(wired.passes[0]!.effects.map((effect) => effect.intent.operation)).toEqual([
            "applyMappedLabel",
        ]);
        const [entry] = records();
        expect(entry).toMatchObject({ kind: "decision", configRevision: "rev-a" });
        expect(entry?.["effects"]).toEqual([
            expect.objectContaining({ operation: "applyMappedLabel", outcome: "applied" }),
        ]);
    });

    it("records an empty effect list outside active mode, and calls no applier", async () => {
        const wired = recordingApplier();

        expect(await withConfig(CONFIG_TEXT, wired.applier).processOnce()).toBe(true);

        expect(wired.passes).toEqual([]);
        expect(records()).toEqual([expect.objectContaining({ kind: "decision", effects: [] })]);
    });

    /** A record kind is not added: the decision arm simply says more. */
    it("stays a decision record, effects and all", async () => {
        const wired = recordingApplier();

        await withConfig(ACTIVE_CONFIG, wired.applier).processOnce();

        expect(logged).toContainEqual({
            event: "deliveryCompleted",
            deliveryId: GUID as string,
            kind: "decision",
        });
    });
});

/**
 * The one read the sweep borrows from this lane. It exists so a recovery pass
 * gates on the same file a delivery would, rather than growing a second reader
 * that could disagree about whether a repository is still in active mode.
 */
describe("the configuration this lane reads", () => {
    const reading = (load: ConfigSource["load"]) =>
        createProcessor({
            store,
            capabilities: [toEngine(intake)],
            configSource: { load },
            externals: () => stubbedExternals(),
            repository: REPOSITORY,
            worker: "test-worker",
            log,
            clock: () => BASE,
        });

    it("answers with the parsed configuration", async () => {
        expect(await reading(configSource.load).configuration()).toMatchObject({
            mode: "dry-run",
            revision: "rev-test-1",
        });
    });

    it("answers null when the file does not parse", async () => {
        const broken = async () => ({
            ok: true as const,
            document: { revision: "rev-x", text: "schemaVersion: 9" },
        });

        expect(await reading(broken).configuration()).toBeNull();
    });

    it("answers null when the source could not be reached at all", async () => {
        const unreachable = async () => ({
            ok: false as const,
            permanent: false,
            detail: "config read failed: transient",
        });

        expect(await reading(unreachable).configuration()).toBeNull();
    });
});
