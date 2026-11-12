/**
 * One item decided under a local configuration file through the Action's unarmed run, with
 * GitHub scripted behind `fetch`: what each capability would decide, and nothing written.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
    itemOfUrl,
    simulate,
    type SimulatedItem,
} from "../../../src/shell/compose/action/simulate.js";
import { runStore } from "../../../src/shell/compose/action/run.js";
import { renderSummary } from "../../../src/shell/observe/summary.js";
import { scriptedGitHub } from "./scripted-github.js";

const START = new Date("2026-09-15T10:00:00.000Z");
const REPOSITORY = { owner: "scrubbed-1", repo: "scrubbed-2" } as const;
const PULL = { repository: REPOSITORY, item: { kind: "pullRequest", number: 38 } } as const;
const ISSUE = { repository: REPOSITORY, item: { kind: "issue", number: 37 } } as const;

/** The file under test; the default branch's file says something else entirely. */
const configOf = (mode: string) => `schemaVersion: 2
mode: ${mode}
capabilities:
  prDashboard:
    enabled: true
    checks:
      mergeConflicts:
        enabled: true
    signals:
      diffSize:
        enabled: true
mappings:
  labels:
    awaitingTriage: "status: triage"
`;

const TRIAGE_CONFIG = `schemaVersion: 2
mode: dry-run
capabilities:
  triageQueue:
    enabled: true
mappings:
  labels:
    awaitingTriage: "status: triage"
`;

const BRANCH_CONFIG = `schemaVersion: 2
mode: observe
`;

const WRITES = new Set(["POST", "PATCH", "PUT", "DELETE"]);

afterEach(() => {
    vi.unstubAllGlobals();
});

async function simulated(target: SimulatedItem, configText: string) {
    const github = scriptedGitHub({ now: () => START, config: () => BRANCH_CONFIG });
    const store = runStore();
    const result = await simulate(target, configText, {
        store,
        token: "read-only",
        clock: () => START,
        log: () => undefined,
    });
    return { github, store, result };
}

describe("the item a URL names", () => {
    it("reads an issue page and a pull request page, ignoring what follows the number", () => {
        expect(itemOfUrl("https://github.com/scrubbed-1/scrubbed-2/pull/38/files#diff")).toEqual(
            PULL,
        );
        expect(itemOfUrl("https://github.com/scrubbed-1/scrubbed-2/issues/37")).toEqual(ISSUE);
    });

    it.each([
        "https://github.com/scrubbed-1/scrubbed-2/pulls/38",
        "https://github.com/scrubbed-1/scrubbed-2/issues/0",
        "https://github.com/scrubbed-1/scrubbed-2/issues/37x",
        "http://github.com/scrubbed-1/scrubbed-2/issues/37",
        "https://example.test/scrubbed-1/scrubbed-2/issues/37",
    ])("refuses %s", (url) => {
        expect(itemOfUrl(url)).toBeNull();
    });
});

describe("a simulation", () => {
    it("decides under the given file, not the default branch's", async () => {
        const { store, result } = await simulated(PULL, configOf("dry-run"));
        expect(result.ok).toBe(true);
        const capabilities = store.ledger
            .decisionsOn(REPOSITORY, PULL.item)
            .map((row) => row.capability);
        expect(capabilities).toContain("prDashboard");
        store.close();
    });

    it("sends no write, even when the file says active", async () => {
        const { github, store, result } = await simulated(PULL, configOf("active"));
        expect(result.ok && result.outcome.modeLowered).toBe(true);
        expect(github.calls.filter((call) => WRITES.has(call.method))).toEqual([]);
        store.close();
    });

    it("prints each capability's verdict and reason as the job summary does", async () => {
        const { store, result } = await simulated(PULL, configOf("dry-run"));
        if (!result.ok) throw new Error(result.detail);
        const printed = renderSummary(store, result.run, result.outcome);
        expect(printed).toContain("### pullRequest#38");
        expect(printed).toMatch(/\| prDashboard \| \w+ \|/);
        store.close();
    });

    it("decides an issue as its opening would", async () => {
        const { store, result } = await simulated(ISSUE, TRIAGE_CONFIG);
        expect(result.ok).toBe(true);
        const capabilities = store.ledger
            .decisionsOn(REPOSITORY, ISSUE.item)
            .map((row) => row.capability);
        expect(capabilities).toContain("triageQueue");
        store.close();
    });

    it("refuses an issue URL that names a pull request", async () => {
        const { store, result } = await simulated(
            { repository: REPOSITORY, item: { kind: "issue", number: 34 } },
            configOf("dry-run"),
        );
        expect(result).toEqual({ ok: false, detail: "#34 is a pull request: use its /pull/ URL" });
        store.close();
    });

    it("refuses an item GitHub does not have", async () => {
        const { store, result } = await simulated(
            { repository: REPOSITORY, item: { kind: "pullRequest", number: 99 } },
            configOf("dry-run"),
        );
        expect(result.ok).toBe(false);
        store.close();
    });
});
