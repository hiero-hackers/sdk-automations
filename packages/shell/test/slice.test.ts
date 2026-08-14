/**
 * The definition of done, executed: a delivery GitHub actually sent (the
 * captured, scrubbed issues.opened fixture) travels webhook → verify →
 * durable accept → 202 → parseConfigDocument → decide() → persisted
 * report, over a real socket, a real SQLite store, and a real config
 * file — with only GitHub itself absent. Dry-run: the report is the
 * product and active mode stops before the decision path.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import {
    asDeliveryGuid,
    problems,
    signBody,
    toEngine,
    SIGNATURE_HEADER,
    type EngineCapability,
    type Report,
} from "@hiero-hackers/automation-core";
import { Store } from "@hiero-hackers/automation-store";
import { intake, prQuality } from "@hiero-hackers/automation-probes";
import { createShell, fileConfigSource, stubbedExternals, type Shell } from "../src/index.js";

const SECRET = "shell-slice-secret";
const GUID = "83e4273f-dd89-22f4-92bc-5da478ed1a69";
const SECOND_GUID = "83e4273f-dd89-22f4-92bc-5da478ed1a6a";
const FIXTURE = readFileSync(
    new URL(
        "../test/github/fixtures/issues.opened.json",
        import.meta.resolve("@hiero-hackers/automation-core"),
    ),
);

const CONFIG = `schemaVersion: 1
mode: dry-run
capabilities:
  intake:
    enabled: true
    settings:
      announce: true
mappings:
  labels:
    awaitingTriage: "status: triage"
`;

const BASE = new Date("2026-08-07T10:00:00.000Z");

let dir: string;
let store: Store;
let configFile: string;

beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "shell-slice-"));
    configFile = join(dir, "automations.yml");
    writeFileSync(configFile, CONFIG);
    store = new Store(join(dir, "store.sqlite"));
});
afterEach(() => {
    vi.restoreAllMocks();
    store.close();
    rmSync(dir, { recursive: true, force: true });
});

function buildShell(capability: EngineCapability = toEngine(intake)): Shell {
    let tick = 0;
    return createShell({
        secret: SECRET,
        store,
        capabilities: [capability],
        configSource: fileConfigSource(configFile),
        externals: stubbedExternals(),
        repository: { owner: "owner-sandbox", repo: "automation-sandbox" },
        clock: () => new Date(BASE.getTime() + 1000 * tick++),
    });
}

async function deliver(shell: Shell, guid = GUID): Promise<number> {
    await new Promise<void>((resolve) => shell.server.listen(0, resolve));
    try {
        const { port } = shell.server.address() as AddressInfo;
        const response = await fetch(`http://127.0.0.1:${String(port)}/`, {
            method: "POST",
            headers: {
                [SIGNATURE_HEADER]: signBody(SECRET, FIXTURE),
                "x-github-delivery": guid,
                "x-github-event": "issues",
            },
            body: FIXTURE,
        });
        await response.arrayBuffer();
        return response.status;
    } finally {
        await new Promise<void>((resolve, reject) =>
            shell.server.close((error) => (error ? reject(error) : resolve())),
        );
    }
}

interface RecordIdentity {
    readonly deliveryId: string;
    readonly event: string;
    readonly receivedAt: string;
    readonly decidedAt: string;
    readonly configRevision: string;
}

type StoredRecord = RecordIdentity &
    (
        | { readonly kind: "decision"; readonly report: Report }
        | { readonly kind: "configRejected"; readonly errors: readonly unknown[] }
        | { readonly kind: "modeUnsupported"; readonly reason: string }
    );

function records(): StoredRecord[] {
    return store.deliveryReports().map((report) => JSON.parse(report.reportJson) as StoredRecord);
}

describe("the first slice, end to end", () => {
    it("rejects duplicate direct capability names before returning a server", () => {
        const intakeCapability = toEngine(intake);
        const prQualityCapability = toEngine(prQuality);
        expect(() =>
            createShell({
                secret: SECRET,
                store,
                capabilities: [
                    intakeCapability,
                    intakeCapability,
                    prQualityCapability,
                    prQualityCapability,
                ],
                configSource: fileConfigSource(configFile),
                externals: stubbedExternals(),
                repository: { owner: "owner-sandbox", repo: "automation-sandbox" },
            }),
        ).toThrow(
            'invalid capability declarations: duplicate capability name "intake"; duplicate capability name "prQuality"',
        );
    });

    it("a real delivery becomes a persisted dry-run report", async () => {
        const shell = buildShell();
        expect(await deliver(shell)).toBe(202);
        await shell.drain();

        const [entry, ...rest] = records();
        expect(rest).toEqual([]);
        expect(entry).toMatchObject({
            kind: "decision",
            deliveryId: GUID,
            event: "issues",
        });
        if (entry?.kind !== "decision") throw new Error("expected a decision");
        expect(entry.report.mode).toBe("dry-run");
        // The engine named the repository from the payload, not our routing default.
        expect(entry.report.repository).toEqual({
            owner: "scrubbed-1",
            repo: "scrubbed-2",
        });
        expect(problems(entry.report as Report)).toEqual([]);
        expect(entry.report.findings.length).toBeGreaterThan(0);
        expect(entry).not.toHaveProperty("approved");
        expect(store.deliveryReports()).toEqual([
            expect.objectContaining({
                deliveryId: GUID,
                reportJson: JSON.stringify(entry),
            }),
        ]);
        // The queue is empty: the delivery completed.
        expect(
            store.claimNextDelivery(
                "assert",
                "2026-08-07T11:00:00.000Z",
                "2026-08-07T10:59:00.000Z",
            ),
        ).toBeUndefined();
    });

    it("rejects active mode canonically without deciding or retrying", async () => {
        writeFileSync(configFile, CONFIG.replace("mode: dry-run", "mode: active"));
        const capability = toEngine(intake);
        const shell = buildShell({
            ...capability,
            evaluate: async () => {
                throw new Error("active mode reached capability evaluation");
            },
        });
        expect(await deliver(shell)).toBe(202);
        await shell.drain();

        const [entry, ...rest] = records();
        expect(rest).toEqual([]);
        expect(entry).toMatchObject({
            kind: "modeUnsupported",
            deliveryId: GUID,
            event: "issues",
            reason: "active mode is unsupported by the runnable shell",
        });
        expect(entry).not.toHaveProperty("report");
        expect(entry).not.toHaveProperty("approved");
        expect(JSON.stringify(entry)).not.toContain("applied");
        expect(store.deliveryReports()).toEqual([
            expect.objectContaining({ reportJson: JSON.stringify(entry) }),
        ]);
        expect(
            store.claimNextDelivery(
                "assert",
                "2026-08-07T11:00:00.000Z",
                "2026-08-07T10:59:00.000Z",
            ),
        ).toBeUndefined();

        expect(await deliver(shell)).toBe(202);
        await shell.drain();
        expect(records()).toHaveLength(1);
    });

    it("a process restart observes the committed canonical report", async () => {
        const shell = buildShell();
        expect(await deliver(shell)).toBe(202);
        await shell.drain();
        const committed = store.deliveryReports();

        store.close();
        store = new Store(join(dir, "store.sqlite"));

        expect(store.deliveryReports()).toEqual(committed);
        expect(records()).toHaveLength(1);
    });

    it("startup draining recovers a pending delivery after restart", async () => {
        expect(
            store.acceptDelivery({
                deliveryId: asDeliveryGuid(SECOND_GUID)!,
                eventName: "issues",
                payload: FIXTURE,
                receivedAt: BASE.toISOString(),
            }),
        ).toMatchObject({ outcome: "accepted", state: "pending" });
        store.close();
        store = new Store(join(dir, "store.sqlite"));

        const shell = buildShell();
        await shell.drain();

        expect(records()).toEqual([
            expect.objectContaining({
                kind: "decision",
                deliveryId: SECOND_GUID,
            }),
        ]);
        expect(
            store.claimNextDelivery(
                "assert",
                "2026-08-07T11:00:00.000Z",
                "2026-08-07T10:59:00.000Z",
            ),
        ).toBeUndefined();
    });

    it("starts durable processing after the acknowledgment without a manual drain", async () => {
        const shell = buildShell();
        expect(await deliver(shell)).toBe(202);
        await vi.waitFor(() => expect(records()).toHaveLength(1));
    });

    it("a broken config fails closed: recorded, completed, nothing decided", async () => {
        writeFileSync(configFile, "mode: [unclosed\n");
        const shell = buildShell();
        expect(await deliver(shell)).toBe(202);
        await shell.drain();

        const [entry] = records();
        expect(entry?.kind).toBe("configRejected");
        if (entry?.kind !== "configRejected") throw new Error("expected rejection");
        expect(entry.errors.length).toBeGreaterThan(0);
        expect(
            store.claimNextDelivery(
                "assert",
                "2026-08-07T11:00:00.000Z",
                "2026-08-07T10:59:00.000Z",
            ),
        ).toBeUndefined();
    });

    it("an absent config file decides in observe mode, like an empty one", async () => {
        rmSync(configFile);
        const shell = buildShell();
        expect(await deliver(shell)).toBe(202);
        await shell.drain();

        const [entry] = records();
        if (entry?.kind !== "decision") throw new Error("expected a decision");
        expect(entry.report.mode).toBe("observe");
        expect(entry.configRevision).toBe("sha256:absent");
    });
});
