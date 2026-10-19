import { describe, expect, it } from "vitest";
import { parseArgs, planOf } from "../src/action/cli.js";
import { credentialsOf } from "../src/action/auth.js";
import { countDifferences, countsOf, duplicateWrites } from "../src/action/judge.js";
import { evidenceName, stampOf } from "../src/action/record.js";
import { effectLinesIn, eventsIn, limitAnswersIn } from "../src/action/runs.js";
import { withMode, type Sandbox } from "../src/action/sandbox.js";
import {
    execute,
    exitCodeOf,
    skippedOutcomes,
    verdictTable,
    type Controls,
} from "../src/action/session.js";
import { reconcile, spendOf, POOL } from "../src/action/protocols/budget.js";
import { PRE_TAG, PROTOCOLS } from "../src/action/protocols/registry.js";
import { passed, type Context, type Protocol } from "../src/action/protocols/kit.js";

const KNOWN = PROTOCOLS.map(({ id }) => id);

const parsedOptions = (...argv: string[]) => {
    const parsed = parseArgs(argv, KNOWN);
    if (!parsed.ok) throw new Error(parsed.error);
    return parsed.options;
};

describe("the command line", () => {
    it("reads --disarm as a switch that runs nothing", () => {
        const parsed = parseArgs(["--disarm"], ["9.1"]);
        expect(parsed.ok && parsed.options.disarm).toBe(true);
        expect(planOf({ only: null, arm: false, long: false }, [], ["9.1"]).selected).toEqual([]);
    });

    it("defaults to the pre-tag batch, unarmed, short, with no pin", () => {
        expect(parsedOptions()).toEqual({
            only: null,
            arm: false,
            long: false,
            disarm: false,
            engine: null,
            sandbox: null,
            capabilities: [],
        });
    });

    it("reads --only as a list and the switches, the sha and the sandbox", () => {
        const sha = "a".repeat(40);
        expect(
            parsedOptions(
                "--only",
                "9.1, 9.2,9.4",
                "--arm",
                "--long",
                "--engine",
                sha,
                "--sandbox",
                "me/box",
            ),
        ).toMatchObject({
            only: ["9.1", "9.2", "9.4"],
            arm: true,
            long: true,
            engine: sha,
            sandbox: "me/box",
        });
    });

    it("refuses an unknown flag, an unknown protocol, a missing value and a short sha", () => {
        for (const argv of [
            ["--bogus"],
            ["--only", "9.12"],
            ["--only"],
            ["--engine", "abc"],
            ["--sandbox", "box"],
        ]) {
            expect(parseArgs(argv, KNOWN).ok).toBe(false);
        }
    });
});

describe("the arming guard", () => {
    const options = (overrides: object) => ({ only: null, arm: false, long: false, ...overrides });

    it("runs the reading protocols of the batch and lists each writing one as skipped with its reason", () => {
        const plan = planOf(options({}), PROTOCOLS, PRE_TAG);
        expect(plan.selected.map(({ id }) => id)).toEqual(["9.1"]);
        expect(plan.skipped).toEqual([
            { id: "9.2", reason: "writes; needs --arm" },
            { id: "9.4", reason: "writes; needs --arm" },
            { id: "9.6", reason: "writes; needs --arm" },
        ]);
    });

    it("runs the whole batch armed, in registry order", () => {
        const plan = planOf(options({ arm: true }), PROTOCOLS, PRE_TAG);
        expect(plan.selected.map(({ id }) => id)).toEqual(PRE_TAG);
        expect(plan.skipped).toEqual([]);
    });

    it("holds the hours-long protocol back without --long, and every writing one without --arm", () => {
        const only = ["9.3", "9.7", "9.9"];
        expect(planOf(options({ only, arm: true }), PROTOCOLS, PRE_TAG).skipped).toEqual([
            { id: "9.3", reason: "runs for hours; needs --long" },
        ]);
        const plan = planOf(options({ only, arm: true, long: true }), PROTOCOLS, PRE_TAG);
        expect(plan.selected.map(({ id }) => id)).toEqual(["9.3", "9.7", "9.9"]);
        expect(
            planOf(options({ only: ["9.7", "9.9"] }), PROTOCOLS, PRE_TAG).selected.map(
                ({ id }) => id,
            ),
        ).toEqual(["9.7"]);
    });

    it("marks as writing exactly the protocols that arm the sandbox", () => {
        expect(PROTOCOLS.filter(({ writes }) => writes).map(({ id }) => id)).toEqual([
            "9.2",
            "9.3",
            "9.4",
            "9.6",
            "9.9",
            "9.10",
        ]);
        expect(PROTOCOLS.filter(({ long }) => long).map(({ id }) => id)).toEqual(["9.3"]);
    });
});

describe("restoring on every exit", () => {
    class FakeSandbox {
        armed = false;
        restores = 0;
        stuck: string[] = [];
        arm(): void {
            this.armed = true;
        }
        restore(): Promise<string[]> {
            this.restores += 1;
            this.armed = false;
            return Promise.resolve(this.stuck);
        }
    }

    const protocol = (
        id: string,
        run: (sandbox: FakeSandbox) => Promise<void>,
        fake: FakeSandbox,
    ): Protocol => ({
        id,
        slug: id,
        writes: true,
        long: false,
        run: async () => {
            fake.arm();
            await run(fake);
            return passed(["ran"]);
        },
    });

    const contexts = { contextFor: () => ({ context: {} as Context, directory: "evidence/x" }) };

    const controlsOver = (fake: FakeSandbox): Controls => ({
        begin: () => Promise.resolve(),
        restore: () => (fake as unknown as Pick<Sandbox, "restore">).restore(),
    });

    it("restores after a protocol that throws, fails it with the reason, and runs the next", async () => {
        const fake = new FakeSandbox();
        const throwing = protocol(
            "9.2",
            () => Promise.reject(new Error("the run never came")),
            fake,
        );
        const fine = protocol("9.4", () => Promise.resolve(), fake);
        const outcomes = await execute([throwing, fine], controlsOver(fake), contexts, () => false);
        expect(outcomes.map(({ id, result }) => [id, result])).toEqual([
            ["9.2", "failed"],
            ["9.4", "passed"],
        ]);
        expect(outcomes[0]?.notes).toEqual(["halted: the run never came"]);
        expect(fake.restores).toBe(2);
        expect(fake.armed).toBe(false);
        expect(exitCodeOf(outcomes)).toBe(1);
    });

    it("fails a protocol whose change could not be read back as undone, naming it", async () => {
        const fake = new FakeSandbox();
        fake.stuck = ["close issue #7: it reads back open"];
        const [outcome] = await execute(
            [protocol("9.2", () => Promise.resolve(), fake)],
            controlsOver(fake),
            contexts,
            () => false,
        );
        expect(outcome?.result).toBe("failed");
        expect(outcome?.notes).toContain(
            "NOT RESTORED, do by hand: close issue #7: it reads back open",
        );
    });

    it("restores when the restore itself throws, and when a signal arrives between protocols", async () => {
        const fake = new FakeSandbox();
        const controls: Controls = {
            begin: () => Promise.resolve(),
            restore: () => Promise.reject(new Error("GitHub did not answer")),
        };
        const [outcome] = await execute(
            [protocol("9.2", () => Promise.resolve(), fake)],
            controls,
            contexts,
            () => false,
        );
        expect(outcome?.result).toBe("failed");
        let signalled = false;
        const first = protocol(
            "9.2",
            () => Promise.resolve().then(() => void (signalled = true)),
            fake,
        );
        const outcomes = await execute(
            [first, protocol("9.4", () => Promise.resolve(), fake)],
            controlsOver(fake),
            contexts,
            () => signalled,
        );
        expect(outcomes.map(({ id, result }) => [id, result])).toEqual([
            ["9.2", "passed"],
            ["9.4", "skipped"],
        ]);
        expect(fake.armed).toBe(false);
    });

    it("passes the exit code only when nothing that ran failed", () => {
        const skipped = skippedOutcomes([{ id: "9.3", reason: "needs --long" }]);
        expect(exitCodeOf(skipped)).toBe(0);
        expect(verdictTable(skipped)).toContain("9.3  skipped");
    });
});

describe("the config the sandbox is armed with", () => {
    it("names the mode wherever the file states one, and states it where it does not", () => {
        expect(withMode("mode: dry-run\ncapabilities:\n", "active")).toBe(
            "mode: active\ncapabilities:\n",
        );
        expect(withMode("capabilities:\n", "active")).toBe("mode: active\ncapabilities:\n");
    });
});

describe("the budget reconciliation", () => {
    const reading = (core: number, graphql: number, reset = 100) => ({
        core: { used: core, reset },
        graphql: { used: graphql, reset },
    });

    it("agrees when the allowance dropped by what the sweep reports, within the slack", () => {
        const result = reconcile(reading(10, 0), reading(395, 2), { core: 383, graphql: 1 });
        expect(result).toEqual({ differences: [], notes: [] });
    });

    it("names each pool whose drop differs from the reported spend", () => {
        const result = reconcile(reading(0, 0), reading(300, 40), { core: 380, graphql: 40 });
        expect(result.differences).toEqual([
            "core: the allowance dropped by 300, the sweep reports 380",
        ]);
    });

    it("names a spend over the pool, and does not compare across a rolled window", () => {
        const result = reconcile(reading(0, 0, 100), reading(5, 0, 200), {
            core: POOL + 1,
            graphql: 0,
        });
        expect(result.differences).toEqual([
            `spent ${String(POOL + 1)} core calls, over the pool of ${String(POOL)}`,
        ]);
        expect(result.notes).toHaveLength(2);
    });

    it("reads the spend out of a sweepFinished event", () => {
        expect(spendOf({ spent: { core: 380, graphql: 1, mutations: 0 } })).toEqual({
            core: 380,
            graphql: 1,
        });
        expect(spendOf({ spent: { core: "x" } })).toBeNull();
    });
});

describe("what a job log carries", () => {
    const log = [
        'run\tstep\t2026-10-17T15:40:03.1310812Z {"at":"x","event":"sweepFinished","remaining":0,"spent":{"core":3,"graphql":1,"mutations":0}}',
        "2026-10-17T15:40:03.2Z ##[notice]triageQueue applyMappedLabel issue#5 applied",
        "2026-10-17T15:40:03.3Z ##[warning]triageQueue welcome issue#5 refused newerHumanChange",
        "2026-10-17T15:40:03.4Z request failed: secondary rate limit, retry-after 60",
        "2026-10-17T15:40:03.5Z {not json",
    ].join("\n");

    it("reads the structured events of one name", () => {
        expect(eventsIn(log, "sweepFinished")).toHaveLength(1);
        expect(eventsIn(log, "limits")).toEqual([]);
    });

    it("reads the effects announced, with a refusal's code", () => {
        expect(effectLinesIn(log)).toEqual([
            {
                level: "notice",
                capability: "triageQueue",
                operation: "applyMappedLabel",
                item: "issue#5",
                outcome: "applied",
                code: null,
            },
            {
                level: "warning",
                capability: "triageQueue",
                operation: "welcome",
                item: "issue#5",
                outcome: "refused",
                code: "newerHumanChange",
            },
        ]);
    });

    it("finds a limit answer and nothing else", () => {
        expect(limitAnswersIn(log)).toEqual([
            "request failed: secondary rate limit, retry-after 60",
        ]);
    });
});

describe("counting what the Action wrote", () => {
    const events = [
        { event: "labeled", actor: "a", at: null, label: "x" },
        { event: "labeled", actor: "a", at: null, label: "x" },
        { event: "commented", actor: "a", at: null },
    ];

    it("counts by kind and names every kind whose count differs", () => {
        expect(countsOf(events)).toEqual({ labeled: 2, commented: 1 });
        expect(countDifferences("issue#1", countsOf(events), { labeled: 2, locked: 1 })).toEqual([
            "issue#1: 1 commented, expected 0",
            "issue#1: 0 locked, expected 1",
        ]);
    });

    it("names a label written twice", () => {
        expect(duplicateWrites(events.slice(0, 2))).toEqual(["labeled x x2"]);
    });
});

describe("the evidence and the credentials", () => {
    it("names a directory for the stamp, the protocol and its slug, with no colon in it", () => {
        const stamp = stampOf(new Date("2026-10-18T09:30:05.123Z"));
        expect(evidenceName(stamp, "9.2", "first-effects")).toBe(
            "2026-10-18T09-30-05Z-9.2-first-effects",
        );
    });

    it("takes a token before the App's three values, and names what is missing otherwise", () => {
        expect(credentialsOf({ GITHUB_TOKEN: "t", APP_ID: "1" })).toEqual({
            kind: "token",
            token: "t",
        });
        expect(
            credentialsOf({ APP_ID: "1", INSTALLATION_ID: "2", PRIVATE_KEY_PATH: "/k" }),
        ).toEqual({
            kind: "app",
            appId: "1",
            installationId: "2",
            keyPath: "/k",
        });
        expect(Array.isArray(credentialsOf({ APP_ID: "1" }))).toBe(true);
    });
});
