/**
 * The one box both lanes call: one item in, a report and its effects' outcomes
 * out, and one decision row per item finding and per effect (D163). Both sources
 * are here because they differ in exactly one thing — what the rows name as the
 * cause — and a box that decided a webhook and a swept item differently would
 * make "one lifecycle" a sentence rather than a fact.
 */

import { beforeEach, afterEach, describe, expect, it } from "vitest";
import {
    parseConfigDocument,
    toEngine,
    UNREAD,
    type Effect,
    type EngineCapability,
    type Facts,
    type RepositoryConfig,
} from "@hiero-hackers/automation-core";
import { intake } from "@hiero-hackers/automation-capabilities";
import { capture, useTempDir } from "@hiero-hackers/automation-testkit";
import { Store } from "../../../src/store/index.js";
import { spending } from "../spending.js";
import type { Allowance } from "../../../src/shell/allowance.js";
import type { Applier } from "../../../src/shell/apply/apply.js";
import { createItemDecider, type DecideItem } from "../../../src/shell/decide/item.js";
import {
    stubbedExternals,
    type ExternalsForDelivery,
} from "../../../src/shell/decide/externals.js";
import { sweepScheduleId } from "../../../src/shell/decide/schedule.js";

const REPOSITORY = { owner: "scrubbed-1", repo: "scrubbed-2" } as const;
const ITEM = { kind: "issue", number: 164 } as const;
const SCHEDULE = sweepScheduleId(REPOSITORY);
const GUID = "94f5384a-ee9a-33a5-a3cd-6eb589fe2b7a";
const AT = "2026-08-07T10:00:01.000Z";

const CONFIG_TEXT = `schemaVersion: 2
mode: MODE
capabilities:
  intake:
    enabled: true
    announce: false
mappings:
  labels:
    awaitingTriage: "status: triage"
`;

/** The payload the delivery arm is decided from: the captured `issues.opened`, parsed. */
const PAYLOAD: unknown = JSON.parse(
    Buffer.from(capture("issues.opened.json").bytes()).toString("utf8"),
);

/** One fact record as the sweep hands it over: the same item, read rather than announced. */
const RECORD: Facts = {
    kind: "issue",
    repository: REPOSITORY,
    item: ITEM,
    observedAt: new Date(AT),
    trigger: { kind: "sweep" },
    author: "opener",
    actor: null,
    position: {
        kind: "position",
        state: { meaning: null, blocked: false, closedBy: null },
        ignored: [],
    },
    alerts: { carried: [], arrived: [] },
    assignees: [],
    links: { openPullRequests: [] },
    command: UNREAD,
};

/** The one capability every case here decides through; the box knows no others. */
const CAPABILITIES: readonly EngineCapability[] = [toEngine(intake)];

function configIn(mode: string): RepositoryConfig {
    const result = parseConfigDocument(CONFIG_TEXT.replace("MODE", mode), {
        revision: "rev-a",
        knownCapabilities: CAPABILITIES.map(({ declaration }) => declaration),
    });
    expect(result.ok, "the suite's configuration parses").toBe(true);
    if (!result.ok) throw new Error("unreachable: asserted above");
    return result.config;
}

const temp = useTempDir("shell-decide-item-");
let store: Store;
beforeEach(() => {
    store = new Store(temp.file("store.sqlite"));
});
afterEach(() => {
    store.close();
});

interface Wiring {
    readonly externals?: ExternalsForDelivery;
    readonly applier?: Applier;
}

function decider(wiring: Wiring = {}): DecideItem {
    return createItemDecider({
        store,
        capabilities: CAPABILITIES,
        externals: wiring.externals ?? (() => stubbedExternals()),
        repository: REPOSITORY,
        ...(wiring.applier === undefined ? {} : { applier: wiring.applier }),
    });
}

const delivered = {
    kind: "delivery",
    deliveryId: GUID,
    event: "issues",
    payload: PAYLOAD,
} as const;
const swept = { kind: "facts", scheduleId: SCHEDULE, facts: RECORD } as const;

const rows = () => store.ledger.decisionsOn(REPOSITORY, ITEM);

describe("what one item comes back as", () => {
    it("answers a delivery with the report and an empty outcome list outside active mode", async () => {
        const decided = await decider()(delivered, configIn("dry-run"), AT);

        expect(decided).toMatchObject({
            kind: "decided",
            report: { revision: "rev-a", mode: "dry-run", repository: REPOSITORY },
            outcomes: [],
        });
    });

    it("answers a fact record the same way, with no delivery anywhere in it (D173)", async () => {
        const decided = await decider()(swept, configIn("dry-run"), AT);

        expect(decided).toMatchObject({ kind: "decided", outcomes: [] });
        expect(decided.kind === "decided" && decided.report.findings.length).toBeGreaterThan(0);
    });

    /**
     * The live path derives its cause fingerprint from the payload argument, so a
     * box that stopped passing it would break exclusion quietly. A fact record has
     * no causing human action to exclude, so it passes none.
     */
    it("hands the externals factory the payload, and a swept item's nothing", async () => {
        const seen: { payload: unknown; deliveryId: string }[] = [];
        const watching: ExternalsForDelivery = ({ payload, deliveryId }) => {
            seen.push({ payload, deliveryId });
            return stubbedExternals();
        };
        const config = configIn("dry-run");
        const decide = decider({ externals: watching });

        await decide(delivered, config, AT);
        await decide(swept, config, AT);

        expect(seen).toEqual([
            { payload: PAYLOAD, deliveryId: GUID },
            { payload: undefined, deliveryId: SCHEDULE },
        ]);
    });
});

/**
 * The mode gate, and the write path behind it. `main.ts` supplies no applier, so
 * `mode: active` ends as `modeUnsupported` before a decision is even attempted;
 * everything else here is what a composition root that DOES supply one gets.
 */
describe("the write path", () => {
    /** An applier that records what it was handed and reports one outcome each. */
    function recordingApplier() {
        const passes: {
            effects: readonly Effect[];
            revision: string;
            allowance: Allowance | undefined;
        }[] = [];
        const applier: Applier = {
            applyAll: (effects, config, allowance) => {
                passes.push({ effects, revision: config.revision, allowance });
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

    it("refuses active mode before deciding when nothing wired a write path", async () => {
        const untouchable: ExternalsForDelivery = () => {
            throw new Error("the externals were built");
        };

        expect(
            await decider({ externals: untouchable })(delivered, configIn("active"), AT),
        ).toEqual({
            kind: "modeUnsupported",
            reason: "active mode is unsupported by the runnable shell",
        });
        expect(rows()).toEqual([]);
    });

    it("meets the same gate for a fact record: one lifecycle, not two", async () => {
        expect(await decider()(swept, configIn("active"), AT)).toMatchObject({
            kind: "modeUnsupported",
        });
    });

    it("hands the approved effects to a wired applier, under the same configuration", async () => {
        const wired = recordingApplier();

        const decided = await decider({ applier: wired.applier })(
            delivered,
            configIn("active"),
            AT,
        );

        expect(wired.passes).toHaveLength(1);
        expect(wired.passes[0]!.revision).toBe("rev-a");
        expect(wired.passes[0]!.effects.map((effect) => effect.intent.operation)).toEqual([
            "applyMappedLabel",
        ]);
        expect(decided).toMatchObject({
            kind: "decided",
            outcomes: [expect.objectContaining({ operation: "applyMappedLabel" })],
        });
    });

    it.each(["dry-run", "observe"])("applies nothing in %s, and calls no applier", async (mode) => {
        const wired = recordingApplier();

        const decided = await decider({ applier: wired.applier })(delivered, configIn(mode), AT);

        expect(wired.passes).toEqual([]);
        expect(decided).toMatchObject({ kind: "decided", outcomes: [] });
    });

    /** One allowance for the process, spent by the applier; a webhook passes none (D192). */
    it("hands the applier the caller's allowance, and nothing when it has none", async () => {
        const wired = recordingApplier();
        const config = configIn("active");
        const allowance = spending();

        await decider({ applier: wired.applier })(delivered, config, AT, allowance);
        await decider({ applier: wired.applier })(delivered, config, AT);

        expect(wired.passes.map((pass) => pass.allowance)).toEqual([allowance, undefined]);
    });
});

/**
 * Every decision is a row (D163). Both sources write them from one place, so a
 * delivery's rows and a swept item's differ only in what they name as the cause.
 */
describe("the decision rows one pass writes", () => {
    const FOREVER = "2999-01-01T00:00:00.000Z";

    /** One outcome per approved effect, so a row has an effect id to carry. */
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

    it("writes one row per item finding, sourced at the delivery that caused them", async () => {
        await decider()(delivered, configIn("dry-run"), AT);

        expect(rows().map(({ verdict, code, effectId }) => [verdict, code, effectId])).toEqual([
            ["info", "capabilityExplained", null],
            ["notice", "modeRecordsOnly", null],
            ["info", "wouldApply", null],
        ]);
        expect(rows()[0]).toMatchObject({
            passId: GUID,
            source: "webhook",
            sourceId: GUID,
            at: AT,
            repository: REPOSITORY,
            item: ITEM,
            capability: "intake",
            detail: "Placed the new issue in triage.",
        });
    });

    it("names the sweep and the schedule row the firing claimed", async () => {
        await decider()(swept, configIn("dry-run"), AT);

        expect(rows()).toContainEqual(
            expect.objectContaining({
                passId: SCHEDULE,
                source: "sweep",
                sourceId: SCHEDULE,
                capability: "intake",
            }),
        );
    });

    it("carries the effect id on the row an outcome writes", async () => {
        await decider({ applier: applying })(delivered, configIn("active"), AT);

        expect(rows().filter(({ effectId }) => effectId !== null)).toEqual([
            expect.objectContaining({
                capability: "intake",
                verdict: "applied",
                code: null,
                detail: null,
            }),
        ]);
    });

    /** `pruneDecisions` counts what it deleted, which is the only read of the whole table. */
    it("writes nothing for a record whose findings name no item", async () => {
        const unreadable = { ...delivered, payload: { action: "opened" } } as const;

        const decided = await decider()(unreadable, configIn("dry-run"), AT);

        expect(decided).toMatchObject({
            kind: "decided",
            report: {
                findings: [
                    expect.objectContaining({
                        code: "repositoryUnreadable",
                        subject: { kind: "repository" },
                    }),
                ],
            },
        });
        expect(store.ledger.pruneDecisions(FOREVER)).toBe(0);
    });
});
