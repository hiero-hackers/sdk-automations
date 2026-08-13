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
    problems,
    signBody,
    toEngine,
    SIGNATURE_HEADER,
    type EngineCapability,
    type Report,
} from "@hiero-hackers/automation-core";
import { Store } from "@hiero-hackers/automation-store";
import { intake } from "@hiero-hackers/automation-probes";
import {
    createShell,
    fileConfigSource,
    fileReportSink,
    stubbedExternals,
    type Shell,
    type ShellRecord,
    type ReportSink,
} from "../src/index.js";

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
let reportsFile: string;
let configFile: string;

beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "shell-slice-"));
    configFile = join(dir, "automations.yml");
    reportsFile = join(dir, "decisions.jsonl");
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
        reports: fileReportSink(reportsFile),
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

function records(): ShellRecord[] {
    return readFileSync(reportsFile, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as ShellRecord);
}

describe("the first slice, end to end", () => {
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
        const db = (
            store as unknown as {
                db: {
                    prepare(sql: string): {
                        get(id: string): { report_json: string; state: string };
                    };
                };
            }
        ).db;
        expect(
            db
                .prepare(
                    `
            SELECT delivery_report.report_json, seen_delivery.state
            FROM delivery_report
            JOIN seen_delivery USING (delivery_id)
            WHERE delivery_id = ?
        `,
                )
                .get(GUID),
        ).toEqual({
            report_json: JSON.stringify(entry),
            state: "done",
        });
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

    it("rebuilds a missing or stale JSONL projection from SQLite on restart", async () => {
        const shell = buildShell();
        expect(await deliver(shell)).toBe(202);
        await shell.drain();
        expect(await deliver(shell, SECOND_GUID)).toBe(202);
        await shell.drain();
        const canonicalProjection = readFileSync(reportsFile, "utf8");

        writeFileSync(reportsFile, '{"stale":true}\n');
        store.close();
        store = new Store(join(dir, "store.sqlite"));
        buildShell();

        expect(readFileSync(reportsFile, "utf8")).toBe(canonicalProjection);
        expect(records()).toHaveLength(2);
    });

    it("reports persistent projection damage without stopping completed work", async () => {
        let rebuilds = 0;
        const brokenProjection: ReportSink = {
            record: () => {
                throw new Error("append unavailable");
            },
            rebuild: () => {
                if (rebuilds++ > 0) throw new Error("rebuild unavailable");
            },
        };
        const error = vi.spyOn(console, "error").mockImplementation(() => {});
        const shell = createShell({
            secret: SECRET,
            store,
            capabilities: [toEngine(intake)],
            configSource: fileConfigSource(configFile),
            reports: brokenProjection,
            externals: stubbedExternals(),
            repository: { owner: "owner-sandbox", repo: "automation-sandbox" },
            clock: () => BASE,
        });

        expect(await deliver(shell)).toBe(202);
        await expect(shell.drain()).resolves.toBeUndefined();
        expect(store.deliveryReports()).toHaveLength(1);
        expect(error).toHaveBeenCalledWith(
            "shell: report projection remains stale; canonical reports are intact",
            expect.any(AggregateError),
        );
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
