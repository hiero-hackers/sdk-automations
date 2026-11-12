/**
 * Analytics' real history, replayed through the Action: each recorded instant is the moment just
 * before a live hourly sweep, and the replayed sweep must write exactly what that live sweep wrote
 * (read back from the repository afterwards), then nothing more when it runs again.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { CAPABILITIES } from "@hiero-hackers/automation-capabilities";
import {
    createWorld,
    history,
    seedsOf,
    type History,
    type World,
} from "@hiero-hackers/automation-testkit";
import {
    parseActionEnvironment,
    type ActionRun,
} from "../../../src/shell/compose/action/inputs.js";
import { runAction, runStore } from "../../../src/shell/compose/action/run.js";
import { scriptedGitHub } from "./scripted-github.js";

function sweepRun(repository: string): ActionRun {
    const parsed = parseActionEnvironment({
        GITHUB_REPOSITORY: repository,
        GITHUB_EVENT_NAME: "schedule",
        GITHUB_EVENT_PATH: "/tmp/event.json",
        INPUT_TOKEN: "runner-token",
        "INPUT_ARM-WRITES": "true",
        GITHUB_RUN_ID: "42",
        GITHUB_RUN_ATTEMPT: "1",
        GITHUB_SERVER_URL: "https://github.com",
    });
    if (!parsed.ok) throw new Error(parsed.errors.join("; "));
    return parsed.run;
}

/** What one item shows: enough to tell any write the sweep made. */
interface Shown {
    readonly comments: ReadonlyMap<number, string>;
    readonly labels: readonly string[];
    readonly assignees: readonly string[];
}

const shownBy = (world: World): Map<number, Shown> =>
    new Map(
        [...world.items.values()].map((item) => [
            item.number,
            {
                comments: new Map(item.comments.map(({ id, body }) => [id, body])),
                labels: [...item.labels],
                assignees: [...item.assignees],
            },
        ]),
    );

const capabilityOf = (body: string): string => /"capability":"(\w+)"/.exec(body)?.[1] ?? "unmarked";

/** Every change between two looks at the world, one line each, sorted. */
function changes(before: Map<number, Shown>, after: Map<number, Shown>): string[] {
    const lines: string[] = [];
    for (const [number, now] of after) {
        const then = before.get(number);
        for (const [id, body] of now.comments) {
            const old = then?.comments.get(id);
            if (old === undefined) lines.push(`#${String(number)} comment ${capabilityOf(body)}`);
            else if (old !== body) lines.push(`#${String(number)} edit ${capabilityOf(body)}`);
        }
        for (const label of now.labels) {
            if (!(then?.labels ?? []).includes(label)) lines.push(`#${String(number)} +${label}`);
        }
        for (const label of then?.labels ?? []) {
            if (!now.labels.includes(label)) lines.push(`#${String(number)} -${label}`);
        }
        for (const login of then?.assignees ?? []) {
            if (!now.assignees.includes(login)) lines.push(`#${String(number)} released ${login}`);
        }
    }
    return lines.sort();
}

/** The recorded repository as a world, and one hourly sweep run against it at `at`. */
function replay(recorded: History) {
    let at = new Date(recorded.at);
    let began = Date.now();
    // The comment read-back waits a real second and checks the clock moved (D46), so it must.
    const clock = (): Date => new Date(at.getTime() + Date.now() - began);
    const world = createWorld({
        now: clock,
        items: seedsOf(recorded),
        repository: recorded.repository.full_name,
    });
    scriptedGitHub({ now: clock, config: () => recorded.config, world });

    const sweep = async (instant: string): Promise<string[]> => {
        at = new Date(instant);
        began = Date.now();
        const before = shownBy(world);
        const store = runStore();
        try {
            const outcome = await runAction(sweepRun(recorded.repository.full_name), {
                payload: Buffer.from("{}"),
                store,
                clock,
                log: () => undefined,
                capabilities: CAPABILITIES,
            });
            expect(outcome.exitCode).toBe(0);
        } finally {
            store.close();
        }
        return changes(before, shownBy(world));
    };
    return { world, sweep };
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("Analytics' history, replayed", () => {
    it("writes what the first active sweep wrote (run 42111922684, 2026-11-05)", async () => {
        const { sweep } = replay(history("analytics-2026-11-05T2120Z"));

        expect(await sweep("2026-11-05T21:21:37Z")).toEqual([
            "#310 comment inactivity",
            "#391 comment prDashboard",
            "#543 +status: needs review",
            "#543 comment prDashboard",
            "#549 +status: needs revision",
            "#549 comment prDashboard",
            "#640 +status: needs revision",
            "#640 comment prDashboard",
        ]);
        expect(await sweep("2026-11-05T22:22:06Z")).toEqual([]);
    }, 120_000);

    it("writes what the 2026-11-12 06:31 sweep wrote (run 43168752008), then nothing", async () => {
        const { sweep } = replay(history("analytics-2026-11-12T0630Z"));

        expect(await sweep("2026-11-12T06:31:35Z")).toEqual(["#550 comment inactivity"]);
        expect(await sweep("2026-11-12T07:31:35Z")).toEqual([]);
    }, 120_000);
});
