/**
 * `lab:action`: the Action's sandbox protocols as a script. The sandbox is switched for each
 * protocol, driven as the person, and put back on every exit. See packages/dev/lab/README.md.
 *
 *   pnpm lab:action --only 9.1,9.2,9.4 [--arm] [--long] [--engine <sha>] [--sandbox owner/repo]
 *   pnpm lab:action --disarm        the backstop: dry-run and ARM_WRITES=false, nothing run
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
    createGitHub,
    field,
    Halt,
    messageOf,
    privateSandbox,
    sandboxOwner,
    type Call,
} from "../github.js";
import { credentialsOf, tokenOf } from "./auth.js";
import { keepAwake } from "./awake.js";
import { parseArgs, planOf, type Options } from "./cli.js";
import { createPerson } from "./person.js";
import { createProvoker } from "./provoke.js";
import type { Context, RateReader } from "./protocols/kit.js";
import { PRE_TAG, PROTOCOLS } from "./protocols/registry.js";
import { createEvidence, stampOf } from "./record.js";
import { createRunReader } from "./runs.js";
import {
    ARM_VARIABLE,
    CONFIG_PATH,
    createSandbox,
    REF_VARIABLE,
    withMode,
    WORKFLOW_PATH,
} from "./sandbox.js";
import { execute, exitCodeOf, skippedOutcomes, verdictTable } from "./session.js";
import { createEngineGuard, createWatch } from "./watch.js";

const FULL_SHA = /^[0-9a-f]{40}$/;

const interrupted = new AbortController();

async function sleep(ms: number): Promise<void> {
    try {
        await delay(ms, undefined, { signal: interrupted.signal });
    } catch {
        throw new Halt("interrupted");
    }
}

function rateReader(call: Call): RateReader {
    return async () => {
        const resources = field((await call("GET", "/rate_limit")).body, "resources");
        const pool = (name: string): { used: number; reset: number } => {
            const [used, reset] = [
                field(field(resources, name), "used"),
                field(field(resources, name), "reset"),
            ];
            if (typeof used !== "number" || typeof reset !== "number")
                throw new Halt(`/rate_limit has no ${name}`);
            return { used, reset };
        };
        return { core: pool("core"), graphql: pool("graphql") };
    };
}

async function main(argv: readonly string[]): Promise<number> {
    const parsed = parseArgs(
        argv,
        PROTOCOLS.map(({ id }) => id),
    );
    if (!parsed.ok) {
        console.error(parsed.error);
        return 2;
    }
    const options: Options = parsed.options;
    const plan = options.disarm
        ? { selected: [], skipped: [] }
        : planOf(options, PROTOCOLS, PRE_TAG);
    for (const skip of plan.skipped) console.log(`skipped ${skip.id}: ${skip.reason}`);
    if (!options.disarm && plan.selected.length === 0) {
        console.log(`\n${verdictTable(skippedOutcomes(plan.skipped))}`);
        return 0;
    }

    const slug = options.sandbox ?? process.env["SANDBOX_REPO"]?.trim() ?? "";
    const [owner, repo, extra] = slug.split("/");
    const credentials = credentialsOf(process.env);
    const missing = [
        ...(owner && repo && extra === undefined ? [] : ["SANDBOX_REPO or --sandbox (owner/repo)"]),
        ...(Array.isArray(credentials) ? credentials : []),
    ];
    if (missing.length > 0 || Array.isArray(credentials) || !owner || !repo) {
        console.error(`set ${missing.join(", ")}; see packages/dev/lab/README.md`);
        return 2;
    }
    const engine = options.engine ?? process.env["ENGINE_COMMIT"]?.trim() ?? null;
    if (engine !== null && !FULL_SHA.test(engine)) {
        console.error("ENGINE_COMMIT takes the full sha");
        return 2;
    }

    const token = await tokenOf(credentials);
    const call = createGitHub(token);
    const human = credentials.kind === "token";
    if (human) await sandboxOwner(call, owner, repo);
    else await privateSandbox(call, owner, repo);
    const sandbox = createSandbox(call, owner, repo);
    const facts = await sandbox.inspect();
    if (!facts.workflowPresent)
        throw new Halt(`${WORKFLOW_PATH} is absent from ${facts.defaultBranch}`);
    if (options.disarm) {
        await sandbox.setVariable(ARM_VARIABLE, "false");
        const config = facts.configMode === "active" ? await sandbox.fileAt(CONFIG_PATH) : null;
        if (config !== null)
            await sandbox.switchConfig(withMode(config.text, "dry-run"), "lab: disarm");
        console.log(
            `disarmed ${slug}: ${ARM_VARIABLE} false (was ${facts.armWrites ?? "unset"}), config ${config === null ? (facts.configMode ?? "absent") : "active -> dry-run"}`,
        );
        return 0;
    }
    if (facts.configMode === "active" || facts.armWrites === "true") {
        throw new Halt(
            `the sandbox is armed (config ${facts.configMode ?? "absent"}, ${ARM_VARIABLE} ${facts.armWrites ?? "unset"}); disarm it first`,
        );
    }

    const expected =
        engine ??
        (facts.engineRef !== null && FULL_SHA.test(facts.engineRef) ? facts.engineRef : null);
    const guard = createEngineGuard(expected);
    const stamp = stampOf(new Date());
    const rateToken = process.env["RATE_LIMIT_TOKEN"]?.trim() || (human ? null : token);
    const rate =
        rateToken === null
            ? null
            : rateReader(rateToken === token ? call : createGitHub(rateToken));
    const reader = createRunReader({ call, token, owner, repo });
    const provoker = createProvoker({
        call,
        sandbox,
        owner,
        repo,
        defaultBranch: facts.defaultBranch,
    });
    const person = createPerson(call, sandbox, owner, repo);

    const stop = (): void => {
        console.log("\ninterrupted: restoring the sandbox");
        interrupted.abort();
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
    const release = options.long ? keepAwake() : () => undefined;
    const controls = {
        begin: async () => {
            if (engine !== null) await sandbox.setVariable(REF_VARIABLE, engine);
        },
        restore: () => sandbox.restore(),
    };
    const contexts = {
        contextFor(protocol: { id: string; slug: string }) {
            const evidence = createEvidence(stamp, protocol.id, protocol.slug);
            const watch = createWatch({ call, reader, evidence, guard, owner, repo, sleep });
            const context: Context = {
                owner,
                repo,
                defaultBranch: facts.defaultBranch,
                call,
                sandbox,
                provoker,
                person,
                watch,
                evidence,
                rate,
                human,
                long: options.long,
                capabilities: options.capabilities,
                tag: stamp,
                sleep,
            };
            evidence.record("start", {
                sandbox: slug,
                human,
                engine: expected,
                protocol: protocol.id,
            });
            return { context, directory: evidence.directory };
        },
    };

    let outcomes;
    try {
        outcomes = await execute(
            plan.selected,
            controls,
            contexts,
            () => interrupted.signal.aborted,
        );
    } finally {
        const problems = await sandbox.restore();
        for (const problem of problems) console.error(`NOT RESTORED, do by hand: ${problem}`);
        release();
        process.off("SIGINT", stop);
        process.off("SIGTERM", stop);
    }
    for (const outcome of outcomes) {
        if (outcome.directory !== null) {
            writeFileSync(
                join(outcome.directory, "verdict.txt"),
                `${outcome.result}\n${outcome.notes.join("\n")}\n`,
            );
        }
    }
    const all = [...outcomes, ...skippedOutcomes(plan.skipped)];
    console.log(`\n${verdictTable(all)}`);
    return exitCodeOf(all);
}

process.exitCode = await main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(`halted: ${messageOf(error)}`);
    return 1;
});
