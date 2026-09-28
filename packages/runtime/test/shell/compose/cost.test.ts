import { afterEach, describe, expect, it, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { writeFileSync } from "node:fs";
import { CAPABILITIES } from "@hiero-hackers/automation-capabilities";
import { parseConfigDocument } from "@hiero-hackers/automation-core";
import { useTempDir } from "@hiero-hackers/automation-testkit";
import { liveGitHub } from "../../../src/shell/compose/live.js";
import type { ShellOptions } from "../../../src/shell/compose/shell.js";
import { createItemDecider } from "../../../src/shell/decide/item.js";
import { SWEEP_EFFECT, sweepScheduleId } from "../../../src/shell/decide/schedule.js";
import type { ShellEvent } from "../../../src/shell/log.js";
import { createSweep } from "../../../src/shell/sweep/sweep.js";
import { Store } from "../../../src/store/index.js";

const HOUR = 3_600_000;
const POOL_LIMIT = 5_000;
const START = new Date("2026-09-15T10:00:00.000Z");
const UPDATED = "2026-09-14T10:00:00.000Z";
const temp = useTempDir("shell-cost-");

afterEach(() => vi.unstubAllGlobals());

function scriptedGitHub(state: { now: Date; enabled: boolean }) {
    const calls: Array<{ path: string; status: number; pool: "core" | "graphql"; window: number }> =
        [];
    const items = [12, 34].map((number) => ({
        number,
        state: "open",
        locked: false,
        updated_at: UPDATED,
        labels: [],
        user: { login: "ada" },
        assignees: [{ login: "ada" }],
        ...(number === 34 ? { pull_request: { url: "https://api.github.com/pulls/34" } } : {}),
    }));
    const routes: Record<string, unknown> = {
        "/issues": items,
        "/issues/12/timeline": [
            { event: "assigned", assignee: { login: "ada" }, created_at: UPDATED },
        ],
        "/issues/34/timeline": [
            { event: "assigned", assignee: { login: "ada" }, created_at: UPDATED },
        ],
        "/issues/12/comments": [],
        "/issues/34/comments": [],
        "/pulls/34": { draft: false, created_at: UPDATED },
        "/pulls/34/reviews": [],
        "/pulls/34/commits": [{ commit: { committer: { date: UPDATED } } }],
        "/graphql": {
            data: {
                rateLimit: { cost: 1 },
                repository: {
                    p0: {
                        number: 34,
                        closingIssuesReferences: {
                            nodes: [],
                            pageInfo: { hasNextPage: false, endCursor: null },
                        },
                    },
                },
            },
        },
    };
    vi.stubGlobal("fetch", (input: string | URL, init: RequestInit) => {
        const path = new URL(String(input)).pathname;
        if (path.endsWith("/access_tokens")) {
            return Promise.resolve(
                new Response(
                    JSON.stringify({
                        token: "fixture-token",
                        expires_at: "2099-01-01T00:00:00Z",
                        permissions: { contents: "read", issues: "write", pull_requests: "read" },
                    }),
                    { status: 201 },
                ),
            );
        }
        const route = path.replace(/^\/repos\/[^/]+\/[^/]+/, "");
        const text = `schemaVersion: 2
mode: dry-run
capabilities:
  inactivity:
    enabled: ${String(state.enabled)}
    issues:
      enabled: true
    pullRequests:
      enabled: true
mappings:
  commands:
    working: /working
`;
        const config = route === "/contents/automations.yml";
        const body = config
            ? {
                  type: "file",
                  encoding: "base64",
                  sha: "a".repeat(40),
                  content: Buffer.from(text).toString("base64"),
              }
            : routes[route];
        const pool = route === "/graphql" ? "graphql" : "core";
        const etag = `"${config ? String(state.enabled) : "unchanged"}"`;
        const status = new Headers(init.headers).get("if-none-match") === etag ? 304 : 200;
        calls.push({ path, status, pool, window: state.now.getTime() });
        const headers = {
            "x-ratelimit-limit": String(POOL_LIMIT),
            "x-ratelimit-remaining": String(
                POOL_LIMIT -
                    calls.filter(
                        (call) =>
                            call.pool === pool &&
                            call.status === 200 &&
                            call.window === state.now.getTime(),
                    ).length,
            ),
            "x-ratelimit-reset": String(Math.floor((state.now.getTime() + HOUR) / 1_000)),
            "x-ratelimit-resource": pool,
            ...(pool === "core" ? { etag } : {}),
        };
        return Promise.resolve(
            new Response(status === 304 ? null : JSON.stringify(body ?? { message: "no route" }), {
                status: body === undefined ? 404 : status,
                headers,
            }),
        );
    });
    return {
        calls,
        cost: (from = 0) => ({
            requests: calls.length - from,
            core: calls.slice(from).filter(({ pool, status }) => pool === "core" && status === 200)
                .length,
            graphql: calls.slice(from).filter(({ pool }) => pool === "graphql").length,
        }),
    };
}

function rehearsal(repositoryCount: number, share = 0.4) {
    const state = { now: START, enabled: false };
    const github = scriptedGitHub(state);
    const events: ShellEvent[] = [];
    const repositories = Array.from({ length: repositoryCount }, (_, index) => ({
        owner: "fixture",
        repo: `repo-${String(index).padStart(3, "0")}`,
    }));
    const store = new Store(temp.file("store.sqlite"));
    const privateKeyPath = temp.file("app.pem");
    writeFileSync(
        privateKeyPath,
        generateKeyPairSync("rsa", {
            modulusLength: 2048,
            publicKeyEncoding: { type: "spki", format: "pem" },
            privateKeyEncoding: { type: "pkcs8", format: "pem" },
        }).privateKey,
    );
    const clock = () => state.now;
    const built = liveGitHub({
        credentials: { appId: "123456", installationId: "789", privateKeyPath },
        writes: null,
        killSwitchActive: false,
        clock,
        share,
        contentCreationHourly: null,
        knownCapabilities: CAPABILITIES.map(({ declaration }) => declaration),
        ownWrites: () => () => [],
        log: (event) => events.push(event),
    });
    const seamsFor: ShellOptions["seams"] = built.seamsFor;
    const sweep = createSweep({
        store,
        capabilities: CAPABILITIES,
        processorFor: (repository, allowance) => {
            const seams = seamsFor(repository, allowance);
            return {
                facts: seams.facts,
                configuration: async () => {
                    const loaded = await seams.configSource.load();
                    if (!loaded.ok) throw new Error(loaded.detail);
                    const parsed = parseConfigDocument(loaded.document.text, {
                        revision: loaded.document.revision,
                        knownCapabilities: CAPABILITIES.map(({ declaration }) => declaration),
                    });
                    if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
                    return parsed.config;
                },
                decideItem: createItemDecider({
                    store,
                    repository,
                    capabilities: CAPABILITIES,
                    externals: seams.externals,
                    clock,
                }),
            };
        },
        clock,
        cadenceMs: HOUR,
        writeCap: 20,
        allowance: built.sweepAllowance,
        log: (event) => events.push(event),
    });
    for (const repository of repositories) {
        store.ledger.schedule(sweepScheduleId(repository), START.toISOString(), SWEEP_EFFECT);
    }
    return {
        state,
        store,
        sweep,
        built,
        events,
        ...github,
    };
}

describe("installation cost through the composed client and reader", () => {
    it("measures disabled, newly enabled and warm inactivity on an existing repository", async () => {
        const run = rehearsal(1);
        try {
            await run.sweep.runDue();
            expect(run.cost()).toEqual({ requests: 1, core: 1, graphql: 0 });

            run.state.enabled = true;
            run.state.now = new Date(START.getTime() + HOUR);
            await run.sweep.runDue();
            expect(run.cost(1)).toEqual({ requests: 10, core: 9, graphql: 1 });

            run.state.now = new Date(START.getTime() + 2 * HOUR);
            await run.sweep.runDue();
            expect(run.cost(11)).toEqual({ requests: 2, core: 0, graphql: 0 });
            expect(run.events.filter(({ event }) => event === "sweepFinished")).toMatchObject([
                { decided: 0 },
                { decided: 2, unread: 0, reused: 0, writes: 0 },
                { decided: 2, unread: 0, reused: 2, writes: 0 },
            ]);
            expect(run.events.some(({ event }) => event === "sweepFailed")).toBe(false);
        } finally {
            run.store.close();
        }
    });

    it("bounds a hundred-repository onboarding burst and resumes across windows", async () => {
        const run = rehearsal(100, 0.08);
        run.state.enabled = true;
        try {
            for (let window = 0; window < 3; window += 1) {
                run.state.now = new Date(START.getTime() + window * HOUR);
                const from = run.calls.length;
                await run.sweep.runDue();
                expect(run.cost(from).core).toBeLessThanOrEqual(400);
                expect(run.cost(from).graphql).toBeLessThanOrEqual(400);
                expect(run.built.sweepAllowance.spent()).toEqual({
                    core: run.cost(from).core,
                    graphql: run.cost(from).graphql,
                    mutations: 0,
                });
                if (window === 0) expect(run.cost(from).core).toBe(400);
                expect(run.built.deliveryAllowance.spent()).toMatchObject({ core: 0, graphql: 0 });
                const stopped = run.calls.length;
                await run.sweep.runDue();
                expect(run.calls).toHaveLength(stopped);
            }
            const completed = run.events
                .filter((event) => event.event === "sweepFinished")
                .filter(({ remaining, decided }) => remaining === 0 && decided > 0);
            expect(new Set(completed.map(({ scheduleId }) => scheduleId)).size).toBe(100);
            expect(run.events.some(({ event }) => event === "sweepFailed")).toBe(false);
        } finally {
            run.store.close();
        }
    }, 30_000);
});
