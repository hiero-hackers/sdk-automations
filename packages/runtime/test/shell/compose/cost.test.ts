import { afterEach, describe, expect, it, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { writeFileSync } from "node:fs";
import { CAPABILITIES } from "@hiero-hackers/automation-capabilities";
import { asDeliveryGuid, type RepositoryRef, type Allowance } from "@hiero-hackers/automation-core";
import { capture, useTempDir } from "@hiero-hackers/automation-testkit";
import { liveGitHub } from "../../../src/shell/compose/live.js";
import type { ShellOptions } from "../../../src/shell/compose/shell.js";
import { createItemDecider } from "../../../src/shell/decide/item.js";
import { createDeliveries } from "../../../src/shell/inbound/deliveries.js";
import { SWEEP_EFFECT, sweepScheduleId } from "../../../src/shell/decide/schedule.js";
import type { ShellEvent } from "../../../src/shell/log.js";
import { createSweep } from "../../../src/shell/sweep/sweep.js";
import { Store } from "../../../src/store/index.js";

const HOUR = 3_600_000;
const POOL_LIMIT = 5_000;
const START = new Date("2026-09-15T10:00:00.000Z");
const UPDATED = "2026-09-14T10:00:00.000Z";
const DASHBOARD_CHECKS = `    checks:
      dcoSignoff:
        enabled: true
      gpgSignature:
        enabled: true
      mergeConflicts:
        enabled: true
      linkedIssues:
        enabled: true
        assignedIssues:
          enabled: true
`;
const temp = useTempDir("shell-cost-");

afterEach(() => vi.unstubAllGlobals());

function scriptedGitHub(state: { now: Date; enabled: boolean; deliveryCapabilities: string }) {
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
        "/issues/164": { assignees: [{ login: "scrubbed-1" }] },
        "/issues/164/timeline": [],
        "/issues/165/timeline": [],
        "/pulls/165": { number: 165, mergeable: true, head: { sha: "a".repeat(40) } },
        "/pulls/165/files": [{ filename: "automations.yml", status: "modified" }],
        "/pulls/165/commits": [
            {
                sha: "a".repeat(40),
                parents: [],
                commit: {
                    message: "Change\n\nSigned-off-by: ada",
                    verification: { verified: true },
                },
            },
        ],
        "/graphql": {
            data: {
                rateLimit: { cost: 1 },
                repository: {
                    nameWithOwner: "scrubbed-1/scrubbed-2",
                    pullRequest: {
                        number: 165,
                        closingIssuesReferences: {
                            nodes: [
                                {
                                    number: 164,
                                    repository: { nameWithOwner: "scrubbed-1/scrubbed-2" },
                                },
                            ],
                            pageInfo: { hasNextPage: false, endCursor: null },
                        },
                    },
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
${state.deliveryCapabilities}
mappings:
  labels:
    awaitingTriage: "status: triage"
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
        const etag = `"${config ? `${String(state.enabled)}-${Buffer.from(state.deliveryCapabilities).toString("base64")}` : "unchanged"}"`;
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
    const state = { now: START, enabled: false, deliveryCapabilities: "" };
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
    const servingFor = (repository: RepositoryRef, allowance?: Allowance) => {
        const seams = seamsFor(repository, allowance);
        return {
            ...seams,
            decideItem: createItemDecider({
                store,
                repository,
                capabilities: CAPABILITIES,
                externals: seams.externals,
                clock,
            }),
        };
    };
    const deliveries = createDeliveries({
        store,
        capabilities: CAPABILITIES,
        lane: servingFor,
        allowance: built.deliveryAllowance,
        worker: "cost-rehearsal",
        clock,
        log: (event) => events.push(event),
    });
    const sweep = createSweep({
        store,
        capabilities: CAPABILITIES,
        processorFor: (repository, allowance) => {
            const serving = servingFor(repository, allowance);
            return {
                ...serving,
                configuration: () => deliveries.configuration(repository, serving.configSource),
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
        deliveries,
        events,
        ...github,
    };
}

describe("installation cost through the composed client and reader", () => {
    it.each([
        {
            name: "triageQueue",
            event: "issues",
            fixture: "issues.opened.json",
            settings: "",
            paths: ["/contents/automations.yml", "/issues/164/timeline"],
        },
        {
            name: "prDashboard",
            event: "pull_request",
            fixture: "pull_request.opened.json",
            settings: DASHBOARD_CHECKS,
            paths: [
                "/contents/automations.yml",
                "/pulls/165/commits",
                "/pulls/165",
                "/graphql",
                "/issues/164",
                "/issues/165/timeline",
            ],
        },
        {
            name: "configReport",
            event: "pull_request",
            fixture: "pull_request.opened.json",
            settings: "",
            paths: [
                "/contents/automations.yml",
                "/pulls/165/files",
                "/pulls/165",
                "/contents/automations.yml",
                "/issues/165/timeline",
            ],
        },
    ])(
        "measures $name on a captured webhook without charging the sweep",
        async ({ name, event, fixture, settings, paths }) => {
            const run = rehearsal(0);
            run.state.deliveryCapabilities = `  ${name}:\n    enabled: true\n${settings}`;
            const deliveryId = asDeliveryGuid("00000000-0000-4000-8000-000000000001")!;
            try {
                run.store.inbox.acceptDelivery({
                    deliveryId,
                    eventName: event,
                    payload: capture(fixture).bytes(),
                    receivedAt: START.toISOString(),
                });
                await run.deliveries.drain();
                expect(
                    run.events.filter(({ event }) => event === "deliveryCompleted"),
                ).toMatchObject([{ deliveryId, kind: "decision" }]);
                expect(
                    run.calls.map(({ path }) => path.replace(/^\/repos\/[^/]+\/[^/]+/, "")),
                ).toEqual(paths);
                const graphql = paths.filter((path) => path === "/graphql").length;
                const core = paths.length - graphql;
                expect(run.cost()).toEqual({ requests: core + graphql, core, graphql });
                expect(run.built.deliveryAllowance.spent()).toEqual({
                    core,
                    graphql,
                    mutations: 0,
                });
                expect(run.built.sweepAllowance.spent()).toEqual({
                    core: 0,
                    graphql: 0,
                    mutations: 0,
                });
                expect(
                    run.store.ledger
                        .decisionsOn(
                            { owner: "scrubbed-1", repo: "scrubbed-2" },
                            {
                                kind: event === "issues" ? "issue" : "pullRequest",
                                number: event === "issues" ? 164 : 165,
                            },
                        )
                        .some(({ code }) => code === "wouldApply"),
                ).toBe(true);
            } finally {
                run.store.close();
            }
        },
    );

    it("keeps webhook decisions running beside an exhausted sweep", async () => {
        const run = rehearsal(20, 0.008);
        run.state.enabled = true;
        run.state.deliveryCapabilities = `  prDashboard:\n    enabled: true\n${DASHBOARD_CHECKS}`;
        const payload = capture("pull_request.opened.json").bytes();
        try {
            for (const id of [
                "00000000-0000-4000-8000-000000000001",
                "00000000-0000-4000-8000-000000000002",
            ]) {
                run.store.inbox.acceptDelivery({
                    deliveryId: asDeliveryGuid(id)!,
                    eventName: "pull_request",
                    payload,
                    receivedAt: START.toISOString(),
                });
                await Promise.all([run.sweep.runDue(), run.deliveries.drain()]);
                expect(run.built.sweepAllowance.spent().core).toBe(40);
                expect(run.built.sweepAllowance.exhausted()).toBe("core");
            }
            expect(run.events.filter(({ event }) => event === "deliveryCompleted")).toMatchObject([
                { kind: "decision" },
                { kind: "decision" },
            ]);
            expect(run.built.deliveryAllowance.spent()).toEqual({
                core: 5,
                graphql: 2,
                mutations: 0,
            });
            expect(run.cost().core).toBe(45);
            expect(run.cost().graphql).toBe(run.built.sweepAllowance.spent().graphql + 2);
            expect(run.built.sweepAllowance.spent().mutations).toBe(0);
            expect(
                run.events.some(
                    ({ event }) => event === "sweepFailed" || event === "deliveryAttemptFailed",
                ),
            ).toBe(false);
        } finally {
            run.store.close();
        }
    }, 30_000);

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
