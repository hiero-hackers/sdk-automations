/**
 * The failures real bots meet, one per test, through the one-shot action against the world: deleted
 * accounts, a locked conversation, a transferred issue, a long comment thread, a copied marker,
 * awkward label names, a lost write reply and a secondary limit. Each run must finish, and what the
 * repository ends up showing must be what one careful write would leave.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { CAPABILITIES } from "@hiero-hackers/automation-capabilities";
import {
    capture,
    createWorld,
    type GitHubScript,
    type WorldComment,
    type WorldSeed,
} from "@hiero-hackers/automation-testkit";
import { parseActionEnvironment } from "../../../src/shell/compose/action/inputs.js";
import { runAction, runStore, type RunOutcome } from "../../../src/shell/compose/action/run.js";
import { scriptedGitHub, UPDATED } from "./scripted-github.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const REPOSITORY = "scrubbed-1/scrubbed-2";

/** Reminders on issues and pull requests at thirty days; nothing is released. */
const INACTIVITY = `schemaVersion: 2
mode: active
capabilities:
  inactivity:
    enabled: true
    issues:
      enabled: true
    pullRequests:
      enabled: true
mappings:
  commands:
    working: /working
`;

const triageMappedTo = (label: string): string => `schemaVersion: 2
mode: active
capabilities:
  triageQueue:
    enabled: true
    welcome: true
mappings:
  labels:
    awaitingTriage: "${label}"
`;

const only = (name: string) => CAPABILITIES.filter((c) => c.declaration.name === name);

function armedRun(eventName: string) {
    const parsed = parseActionEnvironment({
        GITHUB_REPOSITORY: REPOSITORY,
        GITHUB_EVENT_NAME: eventName,
        GITHUB_EVENT_PATH: "/tmp/event.json",
        INPUT_TOKEN: "runner-token",
        "INPUT_ARM-WRITES": "true",
        GITHUB_RUN_ID: "42",
        GITHUB_RUN_ATTEMPT: "1",
    });
    if (!parsed.ok) throw new Error(parsed.errors.join("; "));
    return parsed.run;
}

/** Issue 12, assigned to its author when the route table's items were last updated. */
const assigned = (more: Partial<WorldSeed> = {}): WorldSeed => ({
    number: 12,
    author: "ada",
    assignees: ["ada"],
    assignedAt: UPDATED,
    ...more,
});

const said = (id: number, body: string, login = "bob"): WorldComment => ({
    id,
    body,
    user: login.endsWith("[bot]") ? { login, type: "Bot" } : { login, type: "User" },
    created_at: UPDATED,
    updated_at: UPDATED,
});

/** A world and the hourly inactivity sweep over it, run on whichever day after the assignment. */
function sweeping(seeds: readonly WorldSeed[], script: Partial<GitHubScript> = {}) {
    let at = new Date(UPDATED);
    let began = Date.now();
    // The comment read-back waits a real second and checks the clock moved (D46), so it must.
    const clock = (): Date => new Date(at.getTime() + Date.now() - began);
    const world = createWorld({ now: clock, items: seeds });
    const github = scriptedGitHub({ now: clock, config: () => INACTIVITY, world, ...script });

    const sweepOn = async (day: number): Promise<RunOutcome> => {
        at = new Date(new Date(UPDATED).getTime() + day * DAY_MS);
        began = Date.now();
        const store = runStore();
        try {
            return await runAction(armedRun("schedule"), {
                payload: Buffer.from("{}"),
                store,
                clock,
                log: () => undefined,
                capabilities: only("inactivity"),
            });
        } finally {
            store.close();
        }
    };
    const posts = (): number =>
        github.calls.filter(({ method, path }) => method === "POST" && path.endsWith("/comments"))
            .length;
    return { world, calls: github.calls, sweepOn, posts };
}

/** The reminder issue 12 earns on day 40, as the sweep writes it into an empty thread. */
async function reminderBody(): Promise<string> {
    const { world, sweepOn } = sweeping([assigned()]);
    await sweepOn(40);
    vi.unstubAllGlobals();
    return world.items.get(12)?.comments[0]?.body ?? "";
}

const unreadIn = (outcome: RunOutcome): number | undefined =>
    outcome.events.flatMap((event) => (event.event === "sweepFinished" ? [event.unread] : []))[0];

const fates = (outcome: RunOutcome) =>
    outcome.effects.map(({ outcome: fate, code }) => [fate, code]);

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("a deleted account", () => {
    it("reminds on an issue whose author and commenter GitHub shows as its ghost", async () => {
        const { world, sweepOn } = sweeping([
            assigned({ author: "ghost", comments: [said(1, "any news?", "ghost")] }),
        ]);

        expect((await sweepOn(40)).exitCode).toBe(0);
        expect(world.items.get(12)?.comments).toHaveLength(2);
    });

    it("leaves a pull request readable when a review GitHub reports carries no account", async () => {
        const reviewed: WorldSeed = {
            number: 34,
            pullRequest: true,
            author: "ada",
            assignees: ["ada"],
            assignedAt: UPDATED,
            pull: {
                reviews: [{ state: "CHANGES_REQUESTED", user: null, submitted_at: UPDATED }],
                commits: [{ commit: { committer: { date: UPDATED } } }],
            },
        };
        const { sweepOn } = sweeping([reviewed]);

        expect(unreadIn(await sweepOn(40))).toBe(0);
    });
});

describe("a write GitHub will not take", () => {
    it("refuses a comment on a locked conversation and finishes the run", async () => {
        const { world, sweepOn } = sweeping([assigned({ locked: true })]);

        const outcome = await sweepOn(40);

        expect(outcome.exitCode).toBe(0);
        expect(fates(outcome)).toEqual([["refused", "writeForbidden"]]);
        expect(world.items.get(12)?.comments).toEqual([]);
    });

    it("skips an issue transferred after the list named it", async () => {
        const { world, sweepOn, posts } = sweeping([assigned()]);
        const scripted = globalThis.fetch;
        // The timeline is the first read of the item itself, after the open-item list.
        vi.stubGlobal("fetch", (input: string | URL, init: RequestInit) => {
            if (String(input).includes("/issues/12/timeline")) world.transfer(12);
            return scripted(input, init);
        });

        const outcome = await sweepOn(40);

        expect(outcome.exitCode).toBe(0);
        expect(unreadIn(outcome)).toBe(1);
        expect(posts()).toBe(0);
    });

    it("refuses its comment on an issue transferred just before the write", async () => {
        const { world, sweepOn } = sweeping([assigned()]);
        const scripted = globalThis.fetch;
        vi.stubGlobal("fetch", (input: string | URL, init: RequestInit) => {
            if (init.method === "POST") world.transfer(12);
            return scripted(input, init);
        });

        const outcome = await sweepOn(40);

        expect(outcome.exitCode).toBe(0);
        expect(fates(outcome)).toEqual([["refused", "writeConflict"]]);
        expect(world.items.get(12)?.comments).toEqual([]);
    });
});

describe("the comment thread it writes into", () => {
    it("rewrites its warning on the third page of comments rather than posting another", async () => {
        const marker = (await reminderBody()).split("\n\n")[0] ?? "";
        const thread = Array.from({ length: 210 }, (_, at) => said(at + 1, "bump"));
        const stale = said(211, `${marker}\n\nolder words`, "github-actions[bot]");
        const { world, sweepOn, posts } = sweeping([assigned({ comments: [...thread, stale] })]);

        await sweepOn(40);

        const comments = world.items.get(12)?.comments ?? [];
        expect(posts()).toBe(0);
        expect(comments).toHaveLength(211);
        expect(comments.at(-1)?.body.startsWith(marker)).toBe(true);
        expect(comments.at(-1)?.body).not.toContain("older words");
    });

    it("posts its own warning beside a human comment that copies its marker", async () => {
        const copied = said(1, await reminderBody());
        const { world, sweepOn } = sweeping([assigned({ comments: [copied] })]);

        await sweepOn(40);

        const comments = world.items.get(12)?.comments ?? [];
        expect(comments.map(({ user }) => user?.login)).toEqual(["bob", "github-actions[bot]"]);
        expect(comments[0]).toEqual(copied);
    });
});

describe("a reply that never arrives", () => {
    it("does not post again after the gateway lost the reply to a comment that landed", async () => {
        let losing = true;
        const { world, sweepOn, posts } = sweeping([assigned()], {
            losesWriteReply: () => losing,
        });

        expect(fates(await sweepOn(40))).toEqual([["unknown", "writeUnknown"]]);
        losing = false;
        await sweepOn(40 + 1 / 24);

        expect(posts()).toBe(1);
        expect(world.items.get(12)?.comments).toHaveLength(1);
    });

    it("finishes a sweep a secondary limit stops, and the next one posts the rest once each", async () => {
        let limited = false;
        const { world, calls, sweepOn, posts } = sweeping([assigned(), assigned({ number: 13 })], {
            secondaryLimited: () => limited,
        });
        const scripted = globalThis.fetch;
        vi.stubGlobal("fetch", async (input: string | URL, init: RequestInit) => {
            const reply = await scripted(input, init);
            if (init.method === "POST") limited = true;
            return reply;
        });

        expect((await sweepOn(40)).exitCode).toBe(0);
        expect(calls.some(({ status }) => status === 403)).toBe(true);
        limited = false;
        vi.stubGlobal("fetch", scripted);
        await sweepOn(40 + 1 / 24);

        expect(posts()).toBe(2);
        expect([12, 13].map((n) => world.items.get(n)?.comments.length)).toEqual([1, 1]);
    });
});

describe("a label name GitHub holds its own way", () => {
    /** The captured opening, triaged under `label` in a repository already holding `held`. */
    async function opened(label: string, held: readonly string[]) {
        const delivery = capture("issues.opened.json");
        const payload = delivery.json() as { issue: { number: number; user: { login: string } } };
        const began = Date.now();
        const clock = (): Date => new Date(new Date(UPDATED).getTime() + Date.now() - began);
        const { number, user } = payload.issue;
        const world = createWorld({
            now: clock,
            items: [{ number, author: user.login }],
            labels: held,
        });
        scriptedGitHub({ now: clock, config: () => triageMappedTo(label), world });
        const store = runStore();
        try {
            const outcome = await runAction(armedRun("issues"), {
                payload: delivery.bytes(),
                store,
                clock,
                log: () => undefined,
                capabilities: only("triageQueue"),
            });
            return { outcome, world, labels: world.items.get(number)?.labels };
        } finally {
            store.close();
        }
    }

    it("defines and applies one with an emoji, spaces and a slash", async () => {
        const { outcome, world, labels } = await opened("🐛 Needs Triage/Team A", []);

        expect(fates(outcome)).toEqual([
            ["applied", null],
            ["applied", null],
        ]);
        expect(labels).toEqual(["🐛 Needs Triage/Team A"]);
        expect([...world.labels]).toEqual(["🐛 Needs Triage/Team A"]);
    });

    it("confirms one the repository already holds under another case", async () => {
        const { outcome, world, labels } = await opened("status: triage", ["Status: Triage"]);

        expect(fates(outcome)).toEqual([
            ["applied", null],
            ["applied", null],
        ]);
        expect(labels).toEqual(["Status: Triage"]);
        expect([...world.labels]).toEqual(["Status: Triage"]);
    });
});
