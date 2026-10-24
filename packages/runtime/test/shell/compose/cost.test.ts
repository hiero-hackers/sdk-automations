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
import { HOUR, scriptedGitHub } from "./scripted-github.js";

const START = new Date("2026-09-15T10:00:00.000Z");
/** Where the issue and pull-request captures were taken. */
const FIXTURE_REPOSITORY = { owner: "scrubbed-1", repo: "scrubbed-2" };
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

/** The sandbox file the script serves: inactivity's clocks, plus whatever a case enables. */
const configText = (state: {
    enabled: boolean;
    deliveryCapabilities: string;
}): string => `schemaVersion: 2
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
    assign: /assign
`;

/** The captured comment, rewritten as a person claiming the issue it was left on. */
function assignComment(): Buffer {
    const payload = capture("issue_comment.created.json").json() as {
        comment: Record<string, unknown>;
        sender: unknown;
    };
    const person = { login: "ada", id: 7, type: "User" };
    const { performed_via_github_app: _app, ...comment } = payload.comment;
    return Buffer.from(
        JSON.stringify({
            ...payload,
            comment: { ...comment, body: "/assign", user: person },
            sender: person,
        }),
    );
}

function rehearsal(repositoryCount: number, share = 0.4) {
    const state = { now: START, enabled: false, deliveryCapabilities: "", limited: false };
    const github = scriptedGitHub({
        now: () => state.now,
        config: () => configText(state),
        secondaryLimited: (route) =>
            state.limited && route !== "/contents/sdk-automations.yml" && route !== "/issues",
    });
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
        auth: {
            kind: "app",
            credentials: { appId: "123456", installationId: "789", privateKeyPath },
        },
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
            payload: () => capture("issues.opened.json").bytes(),
            item: { kind: "issue", number: 37 } as const,
            repository: FIXTURE_REPOSITORY,
            settings: "",
            paths: ["/contents/sdk-automations.yml", "/issues/37/timeline"],
        },
        {
            name: "prDashboard",
            event: "pull_request",
            payload: () => capture("pull_request.opened.json").bytes(),
            item: { kind: "pullRequest", number: 38 } as const,
            repository: FIXTURE_REPOSITORY,
            settings: DASHBOARD_CHECKS,
            paths: [
                "/contents/sdk-automations.yml",
                "/pulls/38/commits",
                "/pulls/38",
                "/graphql",
                "/issues/37",
                "/issues/38/timeline",
            ],
        },
        {
            name: "configReport",
            event: "pull_request",
            payload: () => capture("pull_request.opened.json").bytes(),
            item: { kind: "pullRequest", number: 38 } as const,
            repository: FIXTURE_REPOSITORY,
            settings: "",
            paths: [
                "/contents/sdk-automations.yml",
                "/pulls/38/files",
                "/pulls/38",
                "/contents/sdk-automations.yml",
                "/issues/38/timeline",
            ],
        },
        {
            name: "assignment",
            event: "issue_comment",
            payload: assignComment,
            item: { kind: "issue", number: 197 } as const,
            repository: { owner: "scrubbed-3", repo: "scrubbed-4" },
            settings: "    autoAssign:\n      enabled: true\n",
            paths: [
                "/contents/sdk-automations.yml",
                "/issues/197",
                "/issues",
                "/issues/197/timeline",
            ],
        },
    ])(
        "measures $name on a captured webhook without charging the sweep",
        async ({ name, event, payload, item, repository, settings, paths }) => {
            const run = rehearsal(0);
            run.state.deliveryCapabilities = `  ${name}:\n    enabled: true\n${settings}`;
            const deliveryId = asDeliveryGuid("00000000-0000-4000-8000-000000000001")!;
            try {
                run.store.inbox.acceptDelivery({
                    deliveryId,
                    eventName: event,
                    payload: payload(),
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
                        .decisionsOn(repository, item)
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

    it("carries a webhook burst past its lane's allowance into the next windows", async () => {
        // A 1% lane: fifty core units a window, so a hundred new issues need three windows.
        const run = rehearsal(0, 0.99);
        run.state.deliveryCapabilities = "  triageQueue:\n    enabled: true\n";
        const opened = capture("issues.opened.json").json() as { issue: { number: number } };
        const named = (event: string) => run.events.filter((logged) => logged.event === event);
        try {
            for (let index = 0; index < 100; index += 1) {
                opened.issue.number = 1_000 + index;
                run.store.inbox.acceptDelivery({
                    deliveryId: asDeliveryGuid(
                        `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
                    )!,
                    eventName: "issues",
                    payload: Buffer.from(JSON.stringify(opened)),
                    receivedAt: START.toISOString(),
                });
            }
            for (let window = 0; window < 3; window += 1) {
                // A running shell drains every minute; none of those passes may spend an attempt.
                for (let minute = 0; minute < 60; minute += 1) {
                    run.state.now = new Date(START.getTime() + window * HOUR + minute * 60_000);
                    await run.deliveries.drain();
                }
                expect(named("deliveryAttemptFailed")).toHaveLength(window === 0 ? 51 : 52);
                expect(run.built.deliveryAllowance.spent().core).toBe(window === 2 ? 1 : 50);
            }
            const completed = run.events.flatMap((logged) =>
                logged.event === "deliveryCompleted" ? [logged.deliveryId] : [],
            );
            expect(new Set(completed).size).toBe(100);
            expect(completed).toHaveLength(100);
            expect(named("deliveryDeadLettered")).toEqual([]);
            expect(run.built.sweepAllowance.spent()).toEqual({ core: 0, graphql: 0, mutations: 0 });
        } finally {
            run.store.close();
        }
    }, 60_000);

    it("stops a fleet's sweep at the first secondary limit and reads again after it", async () => {
        // The HTTP client keeps the wall clock, so the hold's end is moved on that clock too.
        vi.useFakeTimers({ toFake: ["Date"], now: START });
        const run = rehearsal(20);
        run.state.enabled = true;
        run.state.limited = true;
        try {
            await run.sweep.runDue();
            const refused = run.calls.filter(({ status }) => status === 403);
            expect(refused).toHaveLength(1);
            expect(run.calls.at(-1)).toBe(refused[0]);

            run.state.limited = false;
            run.state.now = new Date(START.getTime() + HOUR);
            vi.setSystemTime(run.state.now);
            await run.sweep.runDue();
            const decided = run.events
                .filter((event) => event.event === "sweepFinished")
                .slice(-20)
                .filter(({ decided }) => decided === 2);
            expect(decided).toHaveLength(20);
            expect(run.events.some(({ event }) => event === "sweepFailed")).toBe(false);
        } finally {
            run.store.close();
            vi.useRealTimers();
        }
    }, 30_000);

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
