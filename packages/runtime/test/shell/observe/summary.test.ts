/**
 * The job summary and its annotations, read from a store a real one-shot run decided into.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
    deriveManagedMarker,
    type EngineCapability,
    type EngineHandle,
    type ReadBack,
} from "@hiero-hackers/automation-core";
import { triageQueueDeclaration } from "@hiero-hackers/automation-capabilities";
import { capture, configFor } from "@hiero-hackers/automation-testkit";
import { hydrateWarnings } from "../../../src/shell/decide/warnings.js";
import {
    parseActionEnvironment,
    type ActionRun,
} from "../../../src/shell/compose/action/inputs.js";
import { runAction, runStore, type RunOutcome } from "../../../src/shell/compose/action/run.js";
import { explainItem } from "../../../src/shell/observe/explain.js";
import {
    annotations,
    appendSummary,
    renderSummary,
    ROW_MARKER,
    rowLines,
} from "../../../src/shell/observe/summary.js";
import { scriptedGitHub } from "../compose/scripted-github.js";

const START = new Date("2026-09-15T10:00:00.000Z");

const ENVIRONMENT = {
    GITHUB_REPOSITORY: "scrubbed-1/scrubbed-2",
    GITHUB_EVENT_NAME: "issues",
    GITHUB_EVENT_PATH: "/tmp/event.json",
    INPUT_TOKEN: "runner-token",
    GITHUB_RUN_ID: "42",
    GITHUB_RUN_ATTEMPT: "1",
    GITHUB_SERVER_URL: "https://github.com",
};

afterEach(() => {
    vi.unstubAllGlobals();
});

function runOf(overrides: Partial<ActionRun> = {}): ActionRun {
    const parsed = parseActionEnvironment(ENVIRONMENT);
    if (!parsed.ok) throw new Error(parsed.errors.join("; "));
    return { ...parsed.run, ...overrides };
}

async function decided(
    run: ActionRun,
    mode: string,
): Promise<{ store: ReturnType<typeof runStore>; outcome: RunOutcome }> {
    scriptedGitHub({ now: () => START, config: () => configFor("triageQueue", mode) });
    const store = runStore();
    const outcome = await runAction(run, {
        payload: capture("issues.opened.json").bytes(),
        store,
        clock: () => START,
        log: () => undefined,
    });
    return { store, outcome };
}

describe("the job summary", () => {
    it("names the repository, event and item, and lists the decision rows", async () => {
        const run = runOf();
        const { store, outcome } = await decided(run, "dry-run");
        const text = renderSummary(store, run, outcome);
        expect(text).toContain("scrubbed-1/scrubbed-2");
        expect(text).toContain("issues");
        expect(text).toContain("delivery");
        expect(text).toContain("issue#37");
        expect(text.match(/modeRecordsOnly/g)).toHaveLength(2);
        expect(text).not.toContain("dry-run because");
        expect(text).not.toContain("Items decided with no rows");
        expect(annotations(outcome)).toEqual([]);
        store.close();
    });

    it("says active was decided as dry-run when writes were not armed", async () => {
        const run = runOf({ armWrites: false });
        const { store, outcome } = await decided(run, "active");
        const text = renderSummary(store, run, outcome);
        expect(text).toContain("dry-run");
        expect(text).toContain("did not arm writes");
        expect(annotations(outcome)[0]).toMatch(/^::notice::/);
        expect(annotations(outcome)).toHaveLength(1);
        store.close();
    });

    it("lists a capability's skip as one info row carrying its reason and lines", async () => {
        const skipping: EngineCapability = {
            declaration: triageQueueDeclaration,
            evaluate: async (_facts: never, _view: never, platform: never) =>
                (platform as EngineHandle).skip("Skipped: scripted.", "line a", "line b"),
        };
        scriptedGitHub({ now: () => START, config: () => configFor("triageQueue") });
        const run = runOf();
        const store = runStore();
        const outcome = await runAction(run, {
            payload: capture("issues.opened.json").bytes(),
            store,
            clock: () => START,
            log: () => undefined,
            capabilities: [skipping],
        });
        const text = renderSummary(store, run, outcome);
        expect(text).toContain(
            "| triageQueue | info | capabilitySkipped | Skipped: scripted. (line a; line b) |",
        );
        expect(text.match(/\| triageQueue \|/g)).toHaveLength(1);
        const item = { kind: "issue", number: 37 } as const;
        expect(explainItem(store, run.repository, item).lines).toContainEqual(
            expect.stringContaining("capabilitySkipped"),
        );
        store.close();
    });

    it("lists a capability that threw as one problem row on its item", async () => {
        const throwing: EngineCapability = {
            declaration: triageQueueDeclaration,
            evaluate: async () => {
                throw new Error("boom");
            },
        };
        scriptedGitHub({ now: () => START, config: () => configFor("triageQueue") });
        const run = runOf();
        const store = runStore();
        const outcome = await runAction(run, {
            payload: capture("issues.opened.json").bytes(),
            store,
            clock: () => START,
            log: () => undefined,
            capabilities: [throwing],
        });
        expect(outcome.exitCode).toBe(0);
        const text = renderSummary(store, run, outcome);
        expect(text).toContain(
            '| triageQueue | problem | capabilityFailed | "triageQueue" failed during evaluation: boom |',
        );
        store.close();
    });

    it("carries what became of each effect an armed run applied, and logs only applied or refused", async () => {
        const run = runOf({ armWrites: true });
        const { store, outcome } = await decided(run, "active");
        expect(outcome.modeLowered).toBe(false);
        expect(
            outcome.effects.map(({ operation, outcome: fate, code }) => [operation, fate, code]),
        ).toEqual([
            // The scripted GitHub keeps no state: the label cannot be read back, and the comment waits.
            ["applyMappedLabel", "unknown", "postconditionUnconfirmed"],
            ["postManagedComment", "retryLater", "writeRetryLater"],
        ]);
        expect(annotations(outcome)).toEqual([]);
        store.close();
    });

    it("closes with the event that made the run exit non-zero", async () => {
        const run = runOf({ repository: { owner: "other", repo: "place" } });
        const { store, outcome } = await decided(run, "dry-run");
        expect(outcome.exitCode).toBe(1);
        const text = renderSummary(store, run, outcome);
        expect(text).toContain("exited non-zero");
        expect(text).toContain("repositoryMismatch");
        const lines = annotations(outcome);
        expect(lines).toHaveLength(1);
        expect(lines[0]).toMatch(/^::warning::deliveryCompleted \(repositoryMismatch\)/);
        store.close();
    });
});

describe("the machine-readable rows", () => {
    const parsed = (line: string): unknown => JSON.parse(line.slice(`${ROW_MARKER} `.length));

    it("prints one line per decision row on each decided item, in the store's order", async () => {
        const run = runOf();
        const { store, outcome } = await decided(run, "dry-run");
        const item = { kind: "issue", number: 37 } as const;
        const rows = store.ledger.decisionsOn(run.repository, item);
        const lines = rowLines(store, run.repository, outcome);
        expect(rows.length).toBeGreaterThan(1);
        expect(lines).toHaveLength(rows.length);
        expect(lines[0]).toMatch(
            /^sdk-automations\.row \{"item":\{"kind":"issue","number":37\},"capability":"triageQueue","verdict":"info","code":"capabilityExplained","detail":"[^\n]*"\}$/,
        );
        expect(lines.map(parsed)).toEqual(
            rows.map(({ capability, verdict, code, detail }) => ({
                item,
                capability,
                verdict,
                code,
                detail,
            })),
        );
        store.close();
    });

    it("keeps a detail carrying a newline and a pipe on one line, and round-trips it", async () => {
        const skipping: EngineCapability = {
            declaration: triageQueueDeclaration,
            evaluate: async (_facts: never, _view: never, platform: never) =>
                (platform as EngineHandle).skip("Skipped: a | b.", "c\nd"),
        };
        scriptedGitHub({ now: () => START, config: () => configFor("triageQueue") });
        const run = runOf();
        const store = runStore();
        const outcome = await runAction(run, {
            payload: capture("issues.opened.json").bytes(),
            store,
            clock: () => START,
            log: () => undefined,
            capabilities: [skipping],
        });
        const lines = rowLines(store, run.repository, outcome);
        expect(lines).toHaveLength(1);
        expect(lines[0]).not.toContain("\n");
        expect(lines[0]).toContain("|");
        expect(parsed(lines[0]!)).toMatchObject({
            code: "capabilitySkipped",
            detail: "Skipped: a | b. (c\nd)",
        });
        store.close();
    });

    it("prints nothing for a run that decided no item, and an item once however often decided", () => {
        const store = runStore();
        const repository = { owner: "o", repo: "r" } as const;
        const item = { kind: "pullRequest", number: 7 } as const;
        const idle: RunOutcome = {
            kind: "idle",
            events: [],
            items: [],
            effects: [],
            modeLowered: false,
            configAbsent: false,
            exitCode: 0,
        };
        expect(rowLines(store, repository, idle)).toEqual([]);
        store.ledger.decide({
            passId: "pass-1",
            source: "webhook",
            sourceId: "d",
            at: "2026-09-15T10:00:00.000Z",
            repository,
            item,
            capability: "prDashboard",
            verdict: "info",
            code: "wouldApply",
            detail: null,
            effectId: null,
        });
        const twice: RunOutcome = { ...idle, kind: "delivery", items: [item, item] };
        expect(rowLines(store, repository, twice)).toEqual([
            `${ROW_MARKER} {"item":{"kind":"pullRequest","number":7},"capability":"prDashboard","verdict":"info","code":"wouldApply","detail":null}`,
        ]);
        store.close();
    });
});

describe("appendSummary", () => {
    it("lists an effect that stands on the item, and carries a failure's detail", async () => {
        const store = runStore();
        const item = { kind: "issue", number: 12 } as const;
        const repository = { owner: "scrubbed-1", repo: "scrubbed-2" } as const;
        const marker = deriveManagedMarker(
            { capability: "inactivity", item, kind: "warning", topic: "ada" },
            {
                effectId: "planted",
                actionClass: "clockTriggeredDestructive",
                capability: "inactivity",
                causeObservedAt: "2026-09-14T10:00:00.000Z",
                cause: "assignmentWentStale",
                item: "scrubbed-1/scrubbed-2#12",
                change: "release ada",
                gracePeriodHours: 168,
                cancelledBy: "a /working comment",
                reversesWith: "re-assign",
            },
        );
        await hydrateWarnings({
            ledger: store.ledger,
            reader: {
                comments: () =>
                    Promise.resolve({
                        ok: true,
                        value: [
                            {
                                id: 1,
                                body: marker,
                                authoredByApp: true,
                                createdAt: "2026-09-14T12:00:00Z",
                            },
                        ],
                    }),
            } as unknown as ReadBack,
            repository,
            item,
            revision: "rev-1",
        });
        const outcome: RunOutcome = {
            kind: "delivery",
            events: [
                {
                    event: "deliveryAttemptFailed",
                    deliveryId: "d",
                    disposition: "retryScheduled",
                    attempts: 1,
                    maxAttempts: 5,
                    retryNotBefore: null,
                    detail: "GitHub answered 502",
                },
            ],
            items: [item, item],
            effects: [],
            modeLowered: false,
            configAbsent: false,
            exitCode: 1,
        };
        const text = renderSummary(
            store,
            { repository, eventName: "schedule", runUrl: null },
            outcome,
        );
        expect(text).toContain("| planted |");
        expect(text.match(/### issue#12/g)).toHaveLength(1);
        expect(text).toContain("`deliveryAttemptFailed`, GitHub answered 502.");
        expect(annotations(outcome)).toEqual([
            "::warning::deliveryAttemptFailed GitHub answered 502",
        ]);
        store.close();
    });

    it("renders only the items with a row, then counts the rest once", () => {
        const store = runStore();
        const repository = { owner: "o", repo: "r" } as const;
        const decided = { kind: "issue", number: 5 } as const;
        store.ledger.decide({
            passId: "pass-1",
            source: "sweep",
            sourceId: "pass-1",
            at: "2026-09-15T10:00:00.000Z",
            repository,
            item: decided,
            capability: "inactivity",
            verdict: "info",
            code: "wouldApply",
            detail: "dry-run: inactivity would postManagedComment",
            effectId: null,
        });
        const outcome: RunOutcome = {
            kind: "sweep",
            events: [],
            items: [{ kind: "issue", number: 6 }, decided, { kind: "pullRequest", number: 7 }],
            effects: [],
            modeLowered: false,
            configAbsent: false,
            exitCode: 0,
        };
        const text = renderSummary(
            store,
            { repository, eventName: "schedule", runUrl: null },
            outcome,
        );
        expect(text.match(/^### .*$/gm)).toEqual(["### issue#5"]);
        expect(text).toContain("| inactivity | info | wouldApply |");
        expect(text).toContain("\nItems decided with no rows: 2.\n");
        store.close();
    });

    it("escapes a cell so no value can close it, and spells an empty one as a dash", () => {
        const store = runStore();
        const repository = { owner: "o", repo: "r" } as const;
        const item = { kind: "issue", number: 5 } as const;
        const decision = (capability: string, detail: string) => ({
            passId: `pass-${capability}`,
            source: "sweep" as const,
            sourceId: `pass-${capability}`,
            at: "2026-09-15T10:00:00.000Z",
            repository,
            item,
            capability,
            verdict: "info",
            code: null,
            detail,
            effectId: null,
        });
        store.ledger.decide(decision("escaped", "a|b\\c\n d"));
        store.ledger.decide(decision("empty", ""));
        const outcome: RunOutcome = {
            kind: "sweep",
            events: [],
            items: [item],
            effects: [],
            modeLowered: false,
            configAbsent: false,
            exitCode: 0,
        };
        const text = renderSummary(
            store,
            { repository, eventName: "schedule", runUrl: null },
            outcome,
        );
        expect(text).toContain("| escaped | info | - | a\\|b\\\\c d |");
        expect(text).toContain("| empty | info | - | - |");
        store.close();
    });

    it("names a dead-lettered delivery without a detail, in the line and the warning", () => {
        const store = runStore();
        const outcome: RunOutcome = {
            kind: "delivery",
            events: [{ event: "deliveryDeadLettered", deliveryId: "d", attempts: 5 }],
            items: [],
            effects: [],
            modeLowered: false,
            configAbsent: false,
            exitCode: 1,
        };
        const repository = { owner: "o", repo: "r" } as const;
        const text = renderSummary(
            store,
            { repository, eventName: "issues", runUrl: null },
            outcome,
        );
        expect(text).toContain("The run exited non-zero: `deliveryDeadLettered`.");
        expect(annotations(outcome)).toEqual(["::warning::deliveryDeadLettered"]);
        store.close();
    });

    it("keeps the first line of a failure's detail, leaving the stack to the log", () => {
        const store = runStore();
        const outcome: RunOutcome = {
            kind: "delivery",
            events: [
                {
                    event: "deliveryAttemptFailed",
                    deliveryId: "d",
                    disposition: "retryScheduled",
                    maxAttempts: 5,
                    attempts: 1,
                    retryNotBefore: "2026-09-15T10:00:30.000Z",
                    detail: "Error: configuration unavailable\n    at loadConfig (action.js:1:1)",
                },
            ],
            items: [],
            effects: [],
            modeLowered: false,
            configAbsent: false,
            exitCode: 1,
        };
        const repository = { owner: "o", repo: "r" } as const;
        const text = renderSummary(
            store,
            { repository, eventName: "issues", runUrl: null },
            outcome,
        );
        expect(text).toContain(
            "The run exited non-zero: `deliveryAttemptFailed`, Error: configuration unavailable.",
        );
        expect(text).not.toContain("at loadConfig");
        expect(annotations(outcome)).toEqual([
            "::warning::deliveryAttemptFailed Error: configuration unavailable",
        ]);
        store.close();
    });

    it("says when no configuration file was found, in a line and a warning", () => {
        const store = runStore();
        const outcome: RunOutcome = {
            kind: "delivery",
            events: [{ event: "deliveryCompleted", deliveryId: "d", kind: "decision" }],
            items: [{ kind: "issue", number: 7 }],
            effects: [],
            modeLowered: false,
            configAbsent: true,
            exitCode: 0,
        };
        const repository = { owner: "o", repo: "r" } as const;
        const text = renderSummary(
            store,
            { repository, eventName: "issues", runUrl: null },
            outcome,
        );
        expect(text).toContain("No `sdk-automations.yml` at the default branch");
        expect(annotations(outcome)).toEqual([
            "::warning::No `sdk-automations.yml` at the default branch: nothing is enabled, so nothing was decided.",
        ]);
        store.close();
    });

    it("says why a sweep found no configuration, as a line when rejected and a failure when unreadable", () => {
        const store = runStore();
        const repository = { owner: "o", repo: "r" } as const;
        const run = { repository, eventName: "schedule", runUrl: null };
        const rejected: RunOutcome = {
            kind: "idle",
            events: [
                { event: "configurationUnavailable", reason: "rejected", detail: "unknownKey: x" },
            ],
            items: [],
            effects: [],
            modeLowered: false,
            configAbsent: false,
            exitCode: 0,
        };
        expect(renderSummary(store, run, rejected)).toContain(
            "No decision: `configurationUnavailable (rejected)`, unknownKey: x.",
        );
        expect(annotations(rejected)).toEqual([
            "::warning::configurationUnavailable (rejected) unknownKey: x",
        ]);
        const unreadable: RunOutcome = {
            ...rejected,
            events: [{ event: "configurationUnavailable", reason: "unreadable", detail: "502" }],
            exitCode: 1,
        };
        expect(renderSummary(store, run, unreadable)).toContain(
            "The run exited non-zero: `configurationUnavailable (unreadable)`, 502.",
        );
        expect(annotations(unreadable)).toEqual([
            "::warning::configurationUnavailable (unreadable) 502",
        ]);
        store.close();
    });

    it("says a sweep could not read the open items, in a line and a warning", () => {
        const store = runStore();
        const outcome: RunOutcome = {
            kind: "sweep",
            events: [{ event: "sweepUnreadable", scheduleId: "s", detail: "502" }],
            items: [],
            effects: [],
            modeLowered: false,
            configAbsent: false,
            exitCode: 0,
        };
        const repository = { owner: "o", repo: "r" } as const;
        const text = renderSummary(
            store,
            { repository, eventName: "schedule", runUrl: null },
            outcome,
        );
        expect(text).toContain("No decision: `sweepUnreadable`, 502.");
        expect(annotations(outcome)).toEqual(["::warning::sweepUnreadable 502"]);
        store.close();
    });

    it("says why a delivery completed with no decision, in a line and a warning", () => {
        const store = runStore();
        const outcome: RunOutcome = {
            kind: "delivery",
            events: [
                {
                    event: "deliveryCompleted",
                    deliveryId: "d",
                    kind: "configRejected",
                    detail: "documentUnparseable: unreadable before parsing: not found",
                },
            ],
            items: [],
            effects: [],
            modeLowered: false,
            configAbsent: false,
            exitCode: 0,
        };
        const repository = { owner: "o", repo: "r" } as const;
        const text = renderSummary(
            store,
            { repository, eventName: "issues", runUrl: null },
            outcome,
        );
        expect(text).toContain(
            "No decision: `deliveryCompleted (configRejected)`, documentUnparseable: unreadable before parsing: not found.",
        );
        expect(text).not.toContain("exited non-zero");
        expect(annotations(outcome)).toEqual([
            "::warning::deliveryCompleted (configRejected) documentUnparseable: unreadable before parsing: not found",
        ]);
        store.close();
    });

    it("closes with no cause when a non-zero run logged none it recognises", () => {
        const store = runStore();
        const outcome: RunOutcome = {
            kind: "idle",
            events: [{ event: "deliveryCompleted", deliveryId: "d", kind: "decision" }],
            items: [],
            effects: [],
            modeLowered: false,
            configAbsent: false,
            exitCode: 1,
        };
        const repository = { owner: "o", repo: "r" } as const;
        const text = renderSummary(
            store,
            { repository, eventName: "schedule", runUrl: null },
            outcome,
        );
        expect(text).not.toContain("exited non-zero");
        expect(annotations(outcome)).toEqual([]);
        store.close();
    });

    it("logs one notice per applied effect and one warning per refused, in run order", () => {
        const item = { kind: "issue", number: 164 } as const;
        const effect = (
            over: Partial<RunOutcome["effects"][number]>,
        ): RunOutcome["effects"][number] => ({
            effectId: "e",
            capability: "triageQueue",
            operation: "applyMappedLabel",
            item,
            outcome: "applied",
            code: null,
            detail: null,
            ...over,
        });
        const outcome: RunOutcome = {
            kind: "delivery",
            events: [],
            items: [item],
            effects: [
                effect({
                    outcome: "refused",
                    operation: "postManagedComment",
                    code: "writeForbidden",
                }),
                effect({ outcome: "already", code: "leaseHeld" }),
                effect({}),
                effect({ outcome: "unknown", code: "postconditionUnconfirmed" }),
            ],
            modeLowered: false,
            configAbsent: false,
            exitCode: 0,
        };
        expect(annotations(outcome)).toEqual([
            "::warning::triageQueue postManagedComment issue#164 refused writeForbidden",
            "::notice::triageQueue applyMappedLabel issue#164 applied",
        ]);
    });

    it("escapes a message so a percent sign or a carriage return cannot end the command", () => {
        const outcome: RunOutcome = {
            kind: "delivery",
            events: [
                {
                    event: "deliveryAttemptFailed",
                    deliveryId: "d",
                    disposition: "retryScheduled",
                    attempts: 1,
                    maxAttempts: 5,
                    retryNotBefore: null,
                    detail: "GitHub answered 502\r100% of the time",
                },
            ],
            items: [],
            effects: [],
            modeLowered: true,
            configAbsent: false,
            exitCode: 1,
        };
        expect(annotations(outcome)).toEqual([
            `::notice::${"The configuration asked for `active`; it was decided as `dry-run` because the workflow did not arm writes."}`,
            "::warning::deliveryAttemptFailed GitHub answered 502%0D100%25 of the time",
        ]);
    });

    it("writes nothing without a path and appends with one", () => {
        const dir = mkdtempSync(join(tmpdir(), "summary-"));
        try {
            const file = join(dir, "step-summary.md");
            writeFileSync(file, "first\n");
            appendSummary(undefined, "ignored\n");
            expect(readFileSync(file, "utf8")).toBe("first\n");
            appendSummary(file, "second\n");
            expect(readFileSync(file, "utf8")).toBe("first\nsecond\n");
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
