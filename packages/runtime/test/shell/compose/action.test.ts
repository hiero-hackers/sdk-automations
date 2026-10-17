/**
 * One run decides one capture or one sweep over the live adapter with GitHub scripted behind
 * `fetch`: the runner's environment in, decision rows in the in-memory store, an exit code out.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { asDeliveryGuid, deriveManagedMarker } from "@hiero-hackers/automation-core";
import { CAPABILITIES } from "@hiero-hackers/automation-capabilities";
import { CONFIGS, capture } from "@hiero-hackers/automation-testkit";
import {
    ACTION_REFUSAL,
    deliveryIdOf,
    itemNamedBy,
    parseActionEnvironment,
    RUNNER_IDENTITY,
    runAction,
    runStore,
    type ActionRun,
} from "../../../src/shell/compose/action.js";
import { explainItem } from "../../../src/shell/observe/explain.js";
import type { ShellEvent } from "../../../src/shell/log.js";
import { scriptedGitHub } from "./scripted-github.js";

const START = new Date("2026-09-15T10:00:00.000Z");
const REPOSITORY = { owner: "scrubbed-1", repo: "scrubbed-2" } as const;

const ENVIRONMENT = {
    GITHUB_REPOSITORY: "scrubbed-1/scrubbed-2",
    GITHUB_EVENT_NAME: "issues",
    GITHUB_EVENT_PATH: "/tmp/event.json",
    INPUT_TOKEN: "runner-token",
    GITHUB_RUN_ID: "42",
    GITHUB_RUN_ATTEMPT: "1",
    GITHUB_SERVER_URL: "https://github.com",
};

const configFor = (capability: string, mode = "dry-run"): string => `schemaVersion: 2
mode: ${mode}
capabilities:
${CONFIGS[capability] ?? ""}mappings:
  labels:
    awaitingTriage: "status: triage"
  commands:
    assign: /assign
    unassign: /unassign
    working: /working
`;

afterEach(() => {
    vi.unstubAllGlobals();
});

function runOf(overrides: Partial<ActionRun> = {}): ActionRun {
    const parsed = parseActionEnvironment(ENVIRONMENT);
    if (!parsed.ok) throw new Error(parsed.errors.join("; "));
    return { ...parsed.run, ...overrides };
}

const kinds = (events: readonly ShellEvent[]): string[] => events.map(({ event }) => event);

describe("the runner's environment", () => {
    it("refuses an empty one, naming every missing piece", () => {
        const parsed = parseActionEnvironment({});
        const { arm: _unasked, identity: _defaulted, ...required } = ACTION_REFUSAL;
        expect(parsed).toEqual({ ok: false, errors: Object.values(required) });
    });

    it("refuses an arming input that is neither true nor false", () => {
        const parsed = parseActionEnvironment({ ...ENVIRONMENT, "INPUT_ARM-WRITES": "yes" });
        expect(parsed).toEqual({ ok: false, errors: [ACTION_REFUSAL.arm] });
    });

    it("reads a run, unarmed by default, with a GUID that is the attempt's alone", () => {
        const parsed = parseActionEnvironment({ ...ENVIRONMENT, "INPUT_ARM-WRITES": "true" });
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) return;
        expect(parsed.run.repository).toEqual(REPOSITORY);
        expect(parsed.run.armWrites).toBe(true);
        expect(parsed.run.runUrl).toBe("https://github.com/scrubbed-1/scrubbed-2/actions/runs/42");
        expect(asDeliveryGuid(parsed.run.deliveryId)).toBe(parsed.run.deliveryId);
        expect(parsed.run.deliveryId).toBe(deliveryIdOf("42", "1"));
        expect(deliveryIdOf("42", "2")).not.toBe(parsed.run.deliveryId);
        expect(runOf().armWrites).toBe(false);
    });
});

describe("the identity the token writes as", () => {
    it("is the runner's unless the workflow names another App's", () => {
        const runner = parseActionEnvironment(ENVIRONMENT);
        expect(runner.ok && runner.run.identity).toEqual(RUNNER_IDENTITY);
        const other = parseActionEnvironment({
            ...ENVIRONMENT,
            "INPUT_BOT-LOGIN": "hiero-automations[bot]",
            "INPUT_APP-ID": "4377258",
        });
        expect(other.ok && other.run.identity).toEqual({
            appId: "4377258",
            botLogin: "hiero-automations[bot]",
        });
    });

    it("refuses a login that is not a bot's, and an app id that is not a number", () => {
        expect(parseActionEnvironment({ ...ENVIRONMENT, "INPUT_BOT-LOGIN": "alice" })).toEqual({
            ok: false,
            errors: [ACTION_REFUSAL.identity],
        });
        expect(parseActionEnvironment({ ...ENVIRONMENT, "INPUT_APP-ID": "fifteen" })).toEqual({
            ok: false,
            errors: [ACTION_REFUSAL.identity],
        });
    });
});

describe("the event a run is told", () => {
    it("reads a pull_request_target run as the pull_request webhook it carries", () => {
        const parsed = parseActionEnvironment({
            ...ENVIRONMENT,
            GITHUB_EVENT_NAME: "pull_request_target",
        });
        expect(parsed.ok && parsed.run.eventName).toBe("pull_request");
        const review = parseActionEnvironment({
            ...ENVIRONMENT,
            GITHUB_EVENT_NAME: "pull_request_review",
        });
        expect(review.ok && review.run.eventName).toBe("pull_request_review");
    });
});

describe("the runner's environment, at its edges", () => {
    it("takes the token from GITHUB_TOKEN when no input names one, and no run link without a server", () => {
        const {
            INPUT_TOKEN: _input,
            GITHUB_SERVER_URL: _server,
            GITHUB_RUN_ATTEMPT: _attempt,
            ...rest
        } = ENVIRONMENT;
        const parsed = parseActionEnvironment({ ...rest, GITHUB_TOKEN: "fallback" });
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) return;
        expect(parsed.run.token).toBe("fallback");
        expect(parsed.run.runUrl).toBeNull();
        expect(parsed.run.deliveryId).toBe(deliveryIdOf("42", "1"));
    });
});

describe("the item a payload names", () => {
    const bytes = (value: unknown): Uint8Array => Buffer.from(JSON.stringify(value));

    it("reads a pull request, an issue, a comment on a pull request, and nothing else", () => {
        expect(itemNamedBy(bytes({ pull_request: { number: 5 } }))).toEqual({
            kind: "pullRequest",
            number: 5,
        });
        expect(itemNamedBy(bytes({ issue: { number: 6 } }))).toEqual({ kind: "issue", number: 6 });
        expect(itemNamedBy(bytes({ issue: { number: 7, pull_request: {} } }))).toEqual({
            kind: "pullRequest",
            number: 7,
        });
        expect(itemNamedBy(bytes({ issue: { title: "no number" } }))).toBeNull();
        expect(itemNamedBy(bytes(42))).toBeNull();
        expect(itemNamedBy(bytes(null))).toBeNull();
        expect(itemNamedBy(Buffer.from("not json"))).toBeNull();
    });
});

describe("one run", () => {
    it("decides a captured issue through the live seams and explains it from the store", async () => {
        scriptedGitHub({ now: () => START, config: () => configFor("triageQueue") });
        const store = runStore();
        const outcome = await runAction(runOf(), {
            payload: capture("issues.opened.json").bytes(),
            store,
            clock: () => START,
            log: () => undefined,
            capabilities: CAPABILITIES,
        });
        expect(outcome.kind).toBe("delivery");
        expect(outcome.exitCode).toBe(0);
        expect(outcome.modeLowered).toBe(false);
        expect(outcome.items).toEqual([{ kind: "issue", number: 164 }]);
        expect(outcome.events.find((event) => event.event === "deliveryCompleted")).toMatchObject({
            kind: "decision",
        });
        const rows = store.ledger.decisionsOn(REPOSITORY, { kind: "issue", number: 164 });
        // Two dry-run effects, each explained, would apply, and recorded only.
        expect(rows.filter((row) => row.code === "modeRecordsOnly")).toHaveLength(2);
        expect(explainItem(store, REPOSITORY, { kind: "issue", number: 164 }).found).toBe(true);
        store.close();
    });

    it("decides an active repository as dry-run while writes are not armed", async () => {
        scriptedGitHub({ now: () => START, config: () => configFor("triageQueue", "active") });
        const store = runStore();
        const outcome = await runAction(runOf({ armWrites: false }), {
            payload: capture("issues.opened.json").bytes(),
            store,
            clock: () => START,
            log: () => undefined,
        });
        expect(outcome.exitCode).toBe(0);
        expect(outcome.modeLowered).toBe(true);
        expect(kinds(outcome.events)).not.toContain("effectApplied");
        expect(store.ledger.decisionsOn(REPOSITORY, { kind: "issue", number: 164 })).not.toEqual(
            [],
        );
        store.close();
    });

    it("exits non-zero when the payload names a repository this workflow does not run in", async () => {
        scriptedGitHub({ now: () => START, config: () => configFor("triageQueue") });
        const store = runStore();
        const outcome = await runAction(runOf({ repository: { owner: "other", repo: "place" } }), {
            payload: capture("issues.opened.json").bytes(),
            store,
            clock: () => START,
            log: () => undefined,
        });
        expect(outcome.exitCode).toBe(1);
        expect(outcome.events.find((event) => event.event === "deliveryCompleted")).toMatchObject({
            kind: "repositoryMismatch",
        });
        store.close();
    });

    it("exits non-zero on a payload that is not JSON, and names no item", async () => {
        scriptedGitHub({ now: () => START, config: () => configFor("triageQueue") });
        const store = runStore();
        const outcome = await runAction(runOf(), {
            payload: Buffer.from("not json"),
            store,
            clock: () => START,
            log: () => undefined,
        });
        expect(outcome.exitCode).toBe(1);
        expect(outcome.items).toEqual([]);
        store.close();
    });

    /** The one place the hosted store was load-bearing across runs (D226). */
    it("reads a warning back from the item's comments before judging a destructive act", async () => {
        const reaping = `schemaVersion: 2
mode: dry-run
capabilities:
  inactivity:
    enabled: true
    issues:
      enabled: true
      remindAfter: 2h
      reap:
        enabled: true
        after: 4h
mappings:
  commands:
    working: /working
`;
        scriptedGitHub({ now: () => START, config: () => reaping });
        const planted = deriveManagedMarker(
            {
                capability: "inactivity",
                item: { kind: "issue", number: 12 },
                kind: "warning",
                topic: "ada",
            },
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
        const scripted = globalThis.fetch;
        vi.stubGlobal("fetch", (input: string | URL, init?: RequestInit) =>
            new URL(String(input)).pathname.endsWith("/issues/12/comments")
                ? Promise.resolve(
                      new Response(
                          JSON.stringify([
                              {
                                  id: 1,
                                  body: `${planted}\n\nada, this issue has been idle.`,
                                  created_at: "2026-09-14T12:00:00Z",
                                  user: { login: "github-actions[bot]", type: "Bot" },
                              },
                          ]),
                          {
                              status: 200,
                              headers: {
                                  "x-ratelimit-limit": "5000",
                                  "x-ratelimit-remaining": "4999",
                                  "x-ratelimit-reset": String(
                                      Math.floor((START.getTime() + 3_600_000) / 1_000),
                                  ),
                                  "x-ratelimit-resource": "core",
                              },
                          },
                      ),
                  )
                : scripted(input, init),
        );
        const store = runStore();
        const outcome = await runAction(runOf({ eventName: "schedule" }), {
            payload: Buffer.from("{}"),
            store,
            clock: () => START,
            log: () => undefined,
        });
        expect(outcome.kind).toBe("sweep");
        expect(outcome.exitCode).toBe(0);
        expect(store.ledger.warningFor("planted")?.warnedAt).toBe("2026-09-14T12:00:00.000Z");
        store.close();
    });

    it("is idle on the schedule when the configuration cannot be read as one", async () => {
        scriptedGitHub({ now: () => START, config: () => "mode: [not, a, mode]\n" });
        const store = runStore();
        const outcome = await runAction(runOf({ eventName: "schedule" }), {
            payload: Buffer.from("{}"),
            store,
            clock: () => START,
            log: () => undefined,
        });
        expect(outcome).toMatchObject({ kind: "idle", exitCode: 0, items: [] });
        store.close();
    });

    it("runs on its own clock and logger when the entry point passes none", async () => {
        scriptedGitHub({ now: () => new Date(), config: () => configFor("triageQueue") });
        const store = runStore();
        const written: string[] = [];
        const stdout = vi.spyOn(process.stdout, "write").mockImplementation((line) => {
            written.push(String(line));
            return true;
        });
        const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
        try {
            const outcome = await runAction(runOf(), {
                payload: capture("issues.opened.json").bytes(),
                store,
            });
            expect(outcome.exitCode).toBe(0);
            expect(written.some((line) => line.includes('"event":"deliveryAccepted"'))).toBe(true);
        } finally {
            stdout.mockRestore();
            stderr.mockRestore();
            store.close();
        }
    });

    it("wires the write path when writes are armed and the repository is active", async () => {
        scriptedGitHub({ now: () => START, config: () => configFor("configReport", "active") });
        const store = runStore();
        const outcome = await runAction(runOf({ armWrites: true }), {
            payload: capture("issues.closed.json").bytes(),
            store,
            clock: () => START,
            log: () => undefined,
        });
        // configReport hears pull requests alone, so an armed, active run decides this issue and writes nothing.
        expect(outcome.modeLowered).toBe(false);
        expect(outcome.exitCode).toBe(0);
        expect(kinds(outcome.events)).toContain("deliveryCompleted");
        expect(kinds(outcome.events)).not.toContain("effectApplied");
        store.close();
    });

    it("fires the sweep on the schedule when a scheduled capability is enabled", async () => {
        scriptedGitHub({ now: () => START, config: () => configFor("inactivity") });
        const store = runStore();
        const outcome = await runAction(runOf({ eventName: "schedule" }), {
            payload: Buffer.from("{}"),
            store,
            clock: () => START,
            log: () => undefined,
        });
        expect(outcome.kind).toBe("sweep");
        expect(outcome.exitCode).toBe(0);
        expect(kinds(outcome.events)).toContain("sweepFinished");
        store.close();
    });

    it("is idle on the schedule when nothing asks to be swept", async () => {
        scriptedGitHub({ now: () => START, config: () => configFor("triageQueue") });
        const store = runStore();
        const outcome = await runAction(runOf({ eventName: "schedule" }), {
            payload: Buffer.from("{}"),
            store,
            clock: () => START,
            log: () => undefined,
        });
        expect(outcome.kind).toBe("idle");
        expect(outcome.exitCode).toBe(0);
        expect(kinds(outcome.events)).not.toContain("sweepClaimed");
        store.close();
    });
});
