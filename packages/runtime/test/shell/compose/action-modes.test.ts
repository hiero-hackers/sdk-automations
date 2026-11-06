/**
 * The mode ladder, proven per capability: every file mode × block mode × arming, one delivery
 * each through the one-shot action, held to a truth table written here rather than read from
 * `effectiveMode`. What a repository is promised when it switches a mode is what GitHub receives.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { CAPABILITIES } from "@hiero-hackers/automation-capabilities";
import {
    CONFIGS,
    capture,
    createWorld,
    type World,
    type WorldSeed,
} from "@hiero-hackers/automation-testkit";
import {
    parseActionEnvironment,
    type ActionRun,
} from "../../../src/shell/compose/action/inputs.js";
import { runAction, runStore } from "../../../src/shell/compose/action/run.js";
import { scriptedGitHub, UPDATED } from "./scripted-github.js";

const START = new Date("2026-09-15T10:00:00.000Z");

const MODES = ["observe", "dry-run", "active"] as const;
type Mode = (typeof MODES)[number];
const RANK: Readonly<Record<Mode, number>> = { observe: 0, "dry-run": 1, active: 2 };

/** A block may lower the file's mode; one above it rejects the whole file (D236). */
function statedMode(file: Mode, block: Mode | null): Mode | "rejected" {
    if (block === null) return file;
    return RANK[block] > RANK[file] ? "rejected" : block;
}

/** Unarmed, an active capability decides as dry-run: the workflow's input is the second gate. */
function decidedMode(file: Mode, block: Mode | null, armed: boolean): Mode | "rejected" {
    const stated = statedMode(file, block);
    return stated === "active" && !armed ? "dry-run" : stated;
}

/** One run a capability acts on: what arrives, what the world holds first, what it should earn. */
interface Scenario {
    readonly capability: string;
    readonly event: string;
    readonly repository: string;
    readonly payload: () => Buffer;
    /** The item the effects land on and the rows are read for. */
    readonly item: { readonly kind: "issue" | "pullRequest"; readonly number: number };
    readonly seeds: readonly WorldSeed[];
    readonly at: Date;
    /** The intents it decides: each is one `wouldApply` line in dry-run. */
    readonly intents: number;
    /** What those intents change on the item once applied; a claim is an assignee and its notice. */
    readonly changes: number;
}

interface Delivered {
    issue?: { number: number; user: { login: string }; labels: { name: string }[] };
    pull_request?: { number: number; user: { login: string } };
    comment?: { body: string };
    repository: { full_name: string };
}

/** A captured delivery, its item seeded as the payload shows it, its comment rewritten if asked. */
function delivered(
    capability: string,
    name: string,
    counts: { readonly intents: number; readonly changes: number },
    comment?: string,
): Scenario {
    const held = capture(name);
    const payload = held.json() as Delivered;
    if (comment !== undefined && payload.comment !== undefined) payload.comment.body = comment;
    const opened = payload.issue ?? payload.pull_request;
    const pullRequest = held.event === "pull_request";
    const number = opened?.number ?? 0;
    return {
        capability,
        event: held.event,
        repository: payload.repository.full_name,
        payload: () => Buffer.from(JSON.stringify(payload)),
        item: { kind: pullRequest ? "pullRequest" : "issue", number },
        seeds: [
            {
                number,
                pullRequest,
                author: opened?.user.login ?? "",
                labels: (payload.issue?.labels ?? []).map(({ name: label }) => label),
            },
        ],
        at: START,
        ...counts,
    };
}

const DAY_MS = 24 * 60 * 60 * 1000;

const SCENARIOS: readonly Scenario[] = [
    delivered("triageQueue", "issues.opened.json", { intents: 2, changes: 2 }),
    delivered("prDashboard", "pull_request.opened.json", { intents: 1, changes: 1 }),
    delivered("configReport", "pull_request.opened.json", { intents: 1, changes: 1 }),
    delivered("assignment", "issue_comment.created.json", { intents: 1, changes: 2 }, "/assign"),
    {
        // The hourly sweep, forty days after issue 12 was assigned: one reminder, no release.
        capability: "inactivity",
        event: "schedule",
        repository: "scrubbed-1/scrubbed-2",
        payload: () => Buffer.from("{}"),
        item: { kind: "issue", number: 12 },
        seeds: [
            { number: 12, author: "ada", assignees: ["ada"], assignedAt: UPDATED },
            {
                number: 34,
                pullRequest: true,
                author: "ada",
                assignees: ["ada"],
                assignedAt: UPDATED,
            },
        ],
        at: new Date(START.getTime() + 40 * DAY_MS),
        intents: 1,
        changes: 1,
    },
];

/** One capability's block alone, stating `block` as its own mode, or inheriting when null. */
const configOf = (capability: string, file: Mode, block: Mode | null): string => `schemaVersion: 2
mode: ${file}
capabilities:
${(CONFIGS[capability] ?? "").replace(
    /^( {2}\w+:\n)/,
    block === null ? "$1" : `$1    mode: ${block}\n`,
)}mappings:
  labels:
    awaitingTriage: "status: triage"
  commands:
    assign: /assign
    unassign: /unassign
    working: /working
`;

function runFor(event: string, armed: boolean, repository: string): ActionRun {
    const parsed = parseActionEnvironment({
        GITHUB_REPOSITORY: repository,
        GITHUB_EVENT_NAME: event,
        GITHUB_EVENT_PATH: "/tmp/event.json",
        INPUT_TOKEN: "runner-token",
        "INPUT_ARM-WRITES": armed ? "true" : "false",
        GITHUB_RUN_ID: "42",
        GITHUB_RUN_ATTEMPT: "1",
        GITHUB_SERVER_URL: "https://github.com",
    });
    if (!parsed.ok) throw new Error(parsed.errors.join("; "));
    return parsed.run;
}

interface Cell {
    readonly lowered: boolean;
    readonly decided: number;
    /** What the item shows afterwards that it did not before: what the repository ends up with. */
    readonly landed: number;
    readonly wouldApply: number;
}

/** What changed on one item: comments, labels and assignees beyond what it was seeded with. */
function changesOn(world: World, seed: WorldSeed | undefined): number {
    const shown = seed === undefined ? undefined : world.items.get(seed.number);
    if (shown === undefined || seed === undefined) return 0;
    const before = new Set(seed.assignees ?? []);
    const after = new Set(shown.assignees);
    const moved =
        [...after].filter((login) => !before.has(login)).length +
        [...before].filter((login) => !after.has(login)).length;
    const labelled = shown.labels.filter((label) => !(seed.labels ?? []).includes(label)).length;
    return shown.comments.length + labelled + moved;
}

/** One run for one capability under one file mode, block mode and arming. */
async function cell(
    scenario: Scenario,
    file: Mode,
    block: Mode | null,
    armed: boolean,
): Promise<Cell> {
    const capability = CAPABILITIES.find((c) => c.declaration.name === scenario.capability);
    if (capability === undefined) throw new Error(`${scenario.capability} is not shipped`);
    const [owner = "", repo = ""] = scenario.repository.split("/");

    // The comment read-back waits a real second and checks the clock moved (D46), so it must.
    const began = Date.now();
    const clock = (): Date => new Date(scenario.at.getTime() + Date.now() - began);
    const world = createWorld({ now: clock, items: scenario.seeds });
    scriptedGitHub({
        now: clock,
        config: () => configOf(scenario.capability, file, block),
        world,
    });
    const store = runStore();
    try {
        const outcome = await runAction(runFor(scenario.event, armed, scenario.repository), {
            payload: scenario.payload(),
            store,
            clock,
            log: () => undefined,
            capabilities: [capability],
        });
        expect(outcome.exitCode).toBe(0);
        const rows = store.ledger.decisionsOn({ owner, repo }, scenario.item);
        const seed = scenario.seeds.find(({ number }) => number === scenario.item.number);
        return {
            lowered: outcome.modeLowered,
            decided: rows.length,
            landed: changesOn(world, seed),
            wouldApply: rows.filter(({ code }) => code === "wouldApply").length,
        };
    } finally {
        store.close();
    }
}

const CELLS = MODES.flatMap((file) =>
    [null, ...MODES].flatMap((block) =>
        [false, true].map((armed) => ({ file, block, armed }) as const),
    ),
);

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("the truth table", () => {
    it("lets a block lower the file's mode, and rejects one that raises it", () => {
        expect(statedMode("active", "dry-run")).toBe("dry-run");
        expect(statedMode("dry-run", "active")).toBe("rejected");
        expect(statedMode("observe", null)).toBe("observe");
    });

    it("decides an unarmed active capability as dry-run and nothing else", () => {
        expect(decidedMode("active", null, false)).toBe("dry-run");
        expect(decidedMode("active", null, true)).toBe("active");
        expect(decidedMode("observe", null, true)).toBe("observe");
    });
});

describe.each(SCENARIOS.map((scenario) => [scenario.capability, scenario] as const))(
    "%s writes exactly when its mode says so",
    (_name, scenario) => {
        it.each(CELLS.map((c) => [c.file, c.block ?? "inherited", c.armed, c] as const))(
            "file %s, block %s, armed %s",
            async (_file, _block, _armed, { file, block, armed }) => {
                const decided = decidedMode(file, block, armed);
                const got = await cell(scenario, file, block, armed);

                expect(got.lowered).toBe(statedMode(file, block) === "active" && !armed);
                expect(got.landed).toBe(decided === "active" ? scenario.changes : 0);
                expect(got.wouldApply).toBe(decided === "dry-run" ? scenario.intents : 0);
                if (decided === "rejected") expect(got.decided).toBe(0);
            },
        );
    },
);

describe("inactivity warns, waits out the grace, then releases, one sweep at a time", () => {
    /** The issue ladder with its release consented: remind at 30 days, release at 60. */
    const REAPING = `schemaVersion: 2
mode: active
capabilities:
  inactivity:
    enabled: true
    issues:
      enabled: true
      reap:
        enabled: true
mappings:
  commands:
    working: /working
`;
    const inactivity = CAPABILITIES.filter((c) => c.declaration.name === "inactivity");

    it("releases only after the warning it posted has stood for the whole grace", async () => {
        let at = START;
        let began = Date.now();
        const clock = (): Date => new Date(at.getTime() + Date.now() - began);
        const world = createWorld({
            now: clock,
            items: [
                { number: 12, author: "ada", assignees: ["ada"], assignedAt: UPDATED },
                {
                    number: 34,
                    pullRequest: true,
                    author: "ada",
                    assignees: ["ada"],
                    assignedAt: UPDATED,
                },
            ],
        });
        scriptedGitHub({ now: clock, config: () => REAPING, world });
        const issue = world.items.get(12);

        /** One hourly sweep at `day` days after the assignment, the way the Action runs it. */
        const sweepOn = async (day: number): Promise<void> => {
            at = new Date(new Date(UPDATED).getTime() + day * DAY_MS);
            began = Date.now();
            const store = runStore();
            try {
                const outcome = await runAction(runFor("schedule", true, "scrubbed-1/scrubbed-2"), {
                    payload: Buffer.from("{}"),
                    store,
                    clock,
                    log: () => undefined,
                    capabilities: inactivity,
                });
                expect(outcome.exitCode).toBe(0);
            } finally {
                store.close();
            }
        };

        await sweepOn(29);
        expect(issue?.comments).toHaveLength(0);

        await sweepOn(40);
        expect(issue?.comments).toHaveLength(1);
        expect(issue?.assignees).toEqual(["ada"]);

        // Inside the grace the warning is read back from the comments, so nothing more is said.
        await sweepOn(69);
        expect(issue?.comments).toHaveLength(1);
        expect(issue?.assignees).toEqual(["ada"]);

        await sweepOn(71);
        expect(issue?.assignees).toEqual([]);
        expect(issue?.comments).toHaveLength(2);

        await sweepOn(72);
        expect(issue?.comments).toHaveLength(2);
    });
});
