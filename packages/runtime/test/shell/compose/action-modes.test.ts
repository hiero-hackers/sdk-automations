/**
 * The mode ladder, proven per capability: every file mode × block mode × arming, one delivery
 * each through the one-shot action, held to a truth table written here rather than read from
 * `effectiveMode`. What a repository is promised when it switches a mode is what GitHub receives.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { CAPABILITIES } from "@hiero-hackers/automation-capabilities";
import { CONFIGS, capture, createWorld } from "@hiero-hackers/automation-testkit";
import { parseActionEnvironment, type ActionRun } from "../../../src/shell/compose/action/inputs.js";
import { runAction, runStore } from "../../../src/shell/compose/action/run.js";
import { scriptedGitHub } from "./scripted-github.js";

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

/** Each capability with a captured delivery it acts on, and the effects that delivery earns. */
const ACTING = [
    { capability: "triageQueue", capture: "issues.opened.json", effects: 2 },
    { capability: "prDashboard", capture: "pull_request.opened.json", effects: 1 },
    { capability: "configReport", capture: "pull_request.opened.json", effects: 1 },
] as const;

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
    /** Bot comments and labels the item shows afterwards: what the repository ends up with. */
    readonly landed: number;
    readonly wouldApply: number;
}

/** One delivery for one capability under one file mode, block mode and arming. */
async function cell(
    acting: (typeof ACTING)[number],
    file: Mode,
    block: Mode | null,
    armed: boolean,
): Promise<Cell> {
    const held = capture(acting.capture);
    const payload = held.json() as {
        issue?: { number: number; user: { login: string } };
        pull_request?: { number: number; user: { login: string } };
        repository: { name: string; full_name: string; owner: { login: string } };
    };
    const opened = payload.issue ?? payload.pull_request;
    const number = opened?.number ?? 0;
    const item = { kind: held.event === "pull_request" ? "pullRequest" : "issue", number } as const;
    const repository = { owner: payload.repository.owner.login, repo: payload.repository.name };
    const capability = CAPABILITIES.find((c) => c.declaration.name === acting.capability);
    if (capability === undefined) throw new Error(`${acting.capability} is not shipped`);

    // The comment read-back waits a real second and checks the clock moved (D46), so it must.
    const began = Date.now();
    const clock = (): Date => new Date(START.getTime() + Date.now() - began);
    const world = createWorld({
        now: clock,
        items: [{ number, pullRequest: item.kind === "pullRequest", author: opened?.user.login ?? "" }],
    });
    scriptedGitHub({
        now: clock,
        config: () => configOf(acting.capability, file, block),
        world,
    });
    const store = runStore();
    try {
        const outcome = await runAction(runFor(held.event, armed, payload.repository.full_name), {
            payload: held.bytes(),
            store,
            clock,
            log: () => undefined,
            capabilities: [capability],
        });
        expect(outcome.exitCode).toBe(0);
        const rows = store.ledger.decisionsOn(repository, item);
        const shown = world.items.get(number);
        return {
            lowered: outcome.modeLowered,
            decided: rows.length,
            landed: (shown?.comments.length ?? 0) + (shown?.labels.length ?? 0),
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

describe.each(ACTING.map((acting) => [acting.capability, acting] as const))(
    "%s writes exactly when its mode says so",
    (_name, acting) => {
        it.each(CELLS.map((c) => [c.file, c.block ?? "inherited", c.armed, c] as const))(
            "file %s, block %s, armed %s",
            async (_file, _block, _armed, { file, block, armed }) => {
                const decided = decidedMode(file, block, armed);
                const got = await cell(acting, file, block, armed);

                expect(got.lowered).toBe(statedMode(file, block) === "active" && !armed);
                expect(got.landed).toBe(decided === "active" ? acting.effects : 0);
                expect(got.wouldApply).toBe(decided === "dry-run" ? acting.effects : 0);
                if (decided === "rejected") expect(got.decided).toBe(0);
            },
        );
    },
);
