/**
 * The triage rehearsal, protocol 8.6 as a script: arm triageQueue on a personal sandbox, run
 * the shell from this checkout behind the operator's public URL, act as a person, and judge
 * every step. The sandbox is restored on every exit, and each restoration is read back.
 *
 *   tsx src/rehearsal/run.ts                  every scenario
 *   tsx src/rehearsal/run.ts plain-open ...   the named ones
 */

import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { EvidenceLog } from "../evidence.js";
import { createGitHub, Halt, messageOf, sandboxOwner } from "../github.js";
import { createRehearsal, type ScenarioResult } from "./rehearse.js";
import { createSandbox } from "./sandbox.js";
import { SCENARIOS, type Scenario } from "./scenarios.js";
import { startShell, type Shell } from "./shell.js";

const EXPERIMENT = "triage-rehearsal";

const DEFAULT_PORT = 8790;

const LAB_DIR = fileURLToPath(new URL("../../", import.meta.url));

/** The packages whose code the rehearsal proves; their state is recorded with the evidence. */
const PRODUCTION = ["packages/core", "packages/runtime", "packages/capabilities"];

// ─── The environment ─────────────────────────────────────────────────

interface Environment {
    readonly appId: string;
    readonly installationId: string;
    readonly privateKeyPath: string;
    readonly appSlug: string;
    readonly owner: string;
    readonly repo: string;
    readonly publicUrl: string;
    readonly token: string;
    readonly port: number;
}

const REQUIRED = [
    "APP_ID",
    "INSTALLATION_ID",
    "PRIVATE_KEY_PATH",
    "APP_SLUG",
    "SANDBOX_REPO",
    "PUBLIC_URL",
    "GITHUB_TOKEN",
] as const;

function value(name: string): string | undefined {
    const held = process.env[name]?.trim();
    return held === "" ? undefined : held;
}

/** Every value, or the names that are missing or malformed. */
function environmentOf(): Environment | string[] {
    const missing = REQUIRED.filter((name) => value(name) === undefined);
    const [owner, repo, extra] = (value("SANDBOX_REPO") ?? "").split("/");
    const publicUrl = value("PUBLIC_URL") ?? "";
    const port = Number(value("PORT") ?? DEFAULT_PORT);
    const malformed = [
        ...(owner && repo && extra === undefined ? [] : ["SANDBOX_REPO (owner/repo)"]),
        ...(publicUrl.startsWith("https://") ? [] : ["PUBLIC_URL (https://…)"]),
        ...(Number.isInteger(port) && port > 0 && port < 65536 ? [] : ["PORT"]),
    ];
    if (missing.length > 0 || malformed.length > 0 || !owner || !repo) {
        return [...missing, ...malformed];
    }
    return {
        appId: value("APP_ID") as string,
        installationId: value("INSTALLATION_ID") as string,
        privateKeyPath: value("PRIVATE_KEY_PATH") as string,
        appSlug: value("APP_SLUG") as string,
        owner,
        repo,
        publicUrl,
        token: value("GITHUB_TOKEN") as string,
        port,
    };
}

function selectedScenarios(names: readonly string[]): readonly Scenario[] {
    if (names.length === 0) return SCENARIOS;
    const unknown = names.filter((name) => !SCENARIOS.some((scenario) => scenario.name === name));
    if (unknown.length > 0) throw new Halt(`no scenario named ${unknown.join(", ")}`);
    return SCENARIOS.filter((scenario) => names.includes(scenario.name));
}

// ─── Guards ──────────────────────────────────────────────────────────

/** The commit under test, and whether the production packages differ from it. */
function checkout(): { readonly commit: string; readonly productionDirty: boolean } {
    const git = (...args: string[]): string =>
        execFileSync("git", args, { cwd: LAB_DIR, encoding: "utf8" }).trim();
    const root = git("rev-parse", "--show-toplevel");
    const status = execFileSync("git", ["status", "--porcelain", "--", ...PRODUCTION], {
        cwd: root,
        encoding: "utf8",
    });
    return { commit: git("rev-parse", "HEAD"), productionDirty: status.trim() !== "" };
}

// ─── The run ─────────────────────────────────────────────────────────

const interrupted = new AbortController();

async function sleep(ms: number): Promise<void> {
    try {
        await delay(ms, undefined, { signal: interrupted.signal });
    } catch {
        throw new Halt("interrupted");
    }
}

async function main(): Promise<number> {
    const env = environmentOf();
    if (Array.isArray(env)) {
        console.error(`set ${env.join(", ")}; see packages/dev/lab/src/rehearsal/README.md`);
        return 2;
    }
    const scenarios = selectedScenarios(process.argv.slice(2));
    const call = createGitHub(env.token);
    const login = await sandboxOwner(call, env.owner, env.repo);

    const runId = new Date().toISOString().replace(/[:.]/g, "-");
    const directory = join(LAB_DIR, "evidence", `${EXPERIMENT}-${runId}`);
    mkdirSync(directory, { recursive: true });
    const log = new EvidenceLog(EXPERIMENT, runId, directory);
    log.record("start", {
        ...checkout(),
        sandbox: `${env.owner}/${env.repo}`,
        scenarios: scenarios.map((s) => s.name),
    });
    process.once("SIGINT", () => {
        console.log("\ninterrupted: stopping and restoring the sandbox");
        interrupted.abort();
    });

    const sandbox = createSandbox(call, env.owner, env.repo);
    const results: ScenarioResult[] = [];
    let halted: string | null = null;
    let shell: Shell | null = null;
    try {
        const template = scenarios.some((scenario) =>
            scenario.steps.some((step) => step.action.kind === "openFromTemplate"),
        );
        await sandbox.prepare({ template });
        const secret = randomBytes(32).toString("hex");
        const { appId, installationId, privateKeyPath, appSlug, owner, repo, port } = env;
        shell = await startShell(
            { appId, installationId, privateKeyPath, appSlug, owner, repo, port, secret },
            join(directory, "shell.log"),
            sleep,
        );
        const hookId = await sandbox.hook(env.publicUrl, secret);
        const rehearsal = createRehearsal({
            call,
            shell,
            sandbox,
            log,
            sleep,
            owner: env.owner,
            repo: env.repo,
            login,
            appLogin: `${env.appSlug}[bot]`,
            hookId,
            runId,
        });
        await rehearsal.pinged();
        for (const scenario of scenarios) {
            console.log(`- ${scenario.name}: ${scenario.question}`);
            const result = await rehearsal.rehearse(scenario);
            results.push(result);
            console.log(`  ${result.passed ? "passed" : "FAILED"}`);
            for (const difference of result.differences) console.log(`    ${difference}`);
        }
    } catch (error) {
        halted = messageOf(error);
        console.error(`halted: ${halted}`);
    }
    // Restoring comes before archiving, so a failed copy cannot leave the sandbox armed.
    await shell?.stop();
    const problems = await sandbox.restore();
    shell?.archiveInto(directory);
    log.record("end", { results, halted, problems });

    for (const problem of problems) console.error(`NOT RESTORED — do by hand: ${problem}`);
    const passed =
        halted === null && problems.length === 0 && results.every((result) => result.passed);
    console.log(`\n${passed ? "PASSED" : "FAILED"} — evidence in ${directory}`);
    return passed ? 0 : 1;
}

process.exitCode = await main().catch((error: unknown) => {
    console.error(`halted: ${messageOf(error)}`);
    return 1;
});
