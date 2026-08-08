/**
 * The worker's failure honesty: a crash mid-decision RELEASES the claim —
 * the delivery stays durable and the next drain retries it — and a
 * completed delivery never runs twice. The receiver acknowledged long
 * before any of this; GitHub is not watching.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { asDeliveryGuid, toEngine, type EngineCapability } from "@hiero-hackers/automation-core";
import { Store } from "@hiero-hackers/automation-store";
import { intake, intakeDeclaration } from "@hiero-hackers/automation-probes";
import { Processor } from "../src/processor.js";
import { memoryReportSink } from "../src/reports.js";
import { stubbedExternals } from "../src/externals.js";
import type { ConfigSource } from "../src/config.js";

const GUID = asDeliveryGuid("94f5384a-ee9a-33a5-a3cd-6eb589fe2b7a")!;
const FIXTURE = readFileSync(
    new URL("../../core/test/github/fixtures/issues.opened.json", import.meta.url),
);

const CONFIG_TEXT = `schemaVersion: 1
mode: dry-run
capabilities:
  intake:
    enabled: true
    settings:
      announce: false
`;
const configSource: ConfigSource = {
    load: async () => ({ revision: "rev-test-1", text: CONFIG_TEXT }),
};

const BASE = new Date("2026-08-07T10:00:00.000Z");

let dir: string;
let store: Store;
beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "shell-processor-"));
    store = new Store(join(dir, "store.sqlite"));
    store.acceptDelivery({
        deliveryId: GUID,
        eventName: "issues",
        payload: FIXTURE,
        receivedAt: BASE.toISOString(),
    });
});
afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
});

function processor(capability: EngineCapability) {
    const reports = memoryReportSink();
    let tick = 1;
    return {
        reports,
        processor: new Processor({
            store,
            capabilities: [capability],
            configSource,
            reports,
            externals: stubbedExternals(),
            repository: { owner: "owner-sandbox", repo: "automation-sandbox" },
            worker: "test-worker",
            clock: () => new Date(BASE.getTime() + 1000 * tick++),
        }),
    };
}

describe("a crash releases the claim", () => {
    it("the delivery survives its processor and is retried by the next one", async () => {
        const bomb: EngineCapability = {
            declaration: intakeDeclaration,
            evaluate: async () => {
                throw new Error("capability exploded");
            },
        };
        const failing = processor(bomb);
        await expect(failing.processor.processOnce()).rejects.toThrow("capability exploded");
        expect(failing.reports.entries).toEqual([]);

        // Released, not stuck: a fresh worker claims it immediately —
        // no stale-claim wait — and carries it to a decision.
        const healthy = processor(toEngine(intake));
        expect(await healthy.processor.processOnce()).toBe(true);
        expect(healthy.reports.entries).toHaveLength(1);
        expect(healthy.reports.entries[0]).toMatchObject({
            kind: "decision",
            deliveryId: GUID as string,
            configRevision: "rev-test-1",
        });
    });

    it("an empty queue reports itself instead of pretending to work", async () => {
        const healthy = processor(toEngine(intake));
        expect(await healthy.processor.processOnce()).toBe(true);
        expect(await healthy.processor.processOnce()).toBe(false);
        expect(healthy.reports.entries).toHaveLength(1);
    });
});
