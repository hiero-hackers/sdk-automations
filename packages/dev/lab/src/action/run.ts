/**
 * Protocol 9.1 as a script: switch a personal sandbox to each capability's dry-run config, provoke
 * the captured events as the person, wait for the runs GitHub raises, and hold their decision rows
 * to the journeys table. Nothing is armed; the sandbox is restored on every exit and read back.
 *
 *   SANDBOX_REPO=owner/repo GITHUB_TOKEN=… ENGINE_COMMIT=<sha> tsx src/action/run.ts [capability …]
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import type { ItemRef } from "@hiero-hackers/automation-core";
import { EvidenceLog } from "../evidence.js";
import {
    createGitHub,
    field,
    Halt,
    listOf,
    messageOf,
    sandboxOwner,
    type Call,
} from "../github.js";
import { CASES, type Case, type EventCase } from "./cases.js";
import { readBackDifferences, rowDifferences, type LogRow, type TimelineEvent } from "./judge.js";
import { createProvoker, type Provoker, type Subject } from "./provoke.js";
import {
    createRunReader,
    parseLog,
    runsRaised,
    settlementOf,
    type RunReader,
    type WorkflowRun,
} from "./runs.js";
import { createSandbox, WORKFLOW_PATH } from "./sandbox.js";

const EXPERIMENT = "action-rehearsal";

const LAB_DIR = fileURLToPath(new URL("../../", import.meta.url));

// ─── Bounds ──────────────────────────────────────────────────────────

/** Between provocations, and between polls of the runs list: bounded hostility. */
const PACE_MS = 5_000;

const POLL_MS = 15_000;

/** A step that has not settled by then fails; the rehearsal goes on to the next capability. */
const STEP_DEADLINE_MS = 10 * 60_000;

/** More runs than a rehearsal can raise on its own. */
const RUN_CEILING = 40;

const PAGE = 100;

// ─── The environment ─────────────────────────────────────────────────

interface Environment {
    readonly owner: string;
    readonly repo: string;
    readonly token: string;
    readonly engineCommit: string;
}

const REQUIRED = ["SANDBOX_REPO", "GITHUB_TOKEN", "ENGINE_COMMIT"] as const;

function value(name: string): string | undefined {
    const held = process.env[name]?.trim();
    return held === "" ? undefined : held;
}

/** Every value, or the names that are missing or malformed. */
function environmentOf(): Environment | string[] {
    const missing = REQUIRED.filter((name) => value(name) === undefined);
    const [owner, repo, extra] = (value("SANDBOX_REPO") ?? "").split("/");
    const engineCommit = value("ENGINE_COMMIT") ?? "";
    const malformed = [
        ...(owner && repo && extra === undefined ? [] : ["SANDBOX_REPO (owner/repo)"]),
        ...(/^[0-9a-f]{40}$/.test(engineCommit) ? [] : ["ENGINE_COMMIT (the full sha)"]),
    ];
    if (missing.length > 0 || malformed.length > 0 || !owner || !repo) {
        return [...missing, ...malformed];
    }
    return { owner, repo, token: value("GITHUB_TOKEN") as string, engineCommit };
}

function selectedCases(names: readonly string[]): readonly Case[] {
    if (names.length === 0) return CASES;
    const unknown = names.filter((name) => !CASES.some((held) => held.capability === name));
    if (unknown.length > 0) throw new Halt(`no capability named ${unknown.join(", ")}`);
    return CASES.filter((held) => names.includes(held.capability));
}

// ─── What a run leaves behind ────────────────────────────────────────

interface StepResult {
    readonly capture: string;
    readonly item: ItemRef;
    readonly runs: readonly number[];
    readonly differences: readonly string[];
}

interface CaseResult {
    readonly capability: string;
    readonly passed: boolean;
    readonly steps: readonly StepResult[];
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

interface Rehearsal {
    readonly call: Call;
    readonly env: Environment;
    readonly log: EvidenceLog;
    readonly directory: string;
    readonly runId: string;
    readonly provoker: Provoker;
    readonly reader: RunReader;
    /** Every run a step claimed, so no later step counts it again. */
    readonly claimed: Set<number>;
    /** Every run recorded as not the step's: the schedule, a dispatch. */
    readonly ignored: Set<number>;
    engineChecked: boolean;
}

/** The step's runs once they have settled, or why the step failed. */
async function settle(
    rehearsal: Rehearsal,
    since: string,
    raises: readonly string[],
): Promise<{ readonly runs: WorkflowRun[] } | { readonly failed: string }> {
    const { reader, claimed, ignored, log } = rehearsal;
    let held = "";
    let heldSince = Date.now();
    for (const deadline = Date.now() + STEP_DEADLINE_MS; Date.now() < deadline;) {
        await sleep(POLL_MS);
        const listed = await reader.listSince(since);
        for (const run of listed) {
            if (claimed.has(run.id) || ignored.has(run.id) || raises.includes(run.event)) continue;
            ignored.add(run.id);
            log.record("ignored", { run });
        }
        const runs = runsRaised(listed, since, raises, claimed);
        const ids = runs.map((run) => run.id).join(",");
        if (ids !== held) {
            held = ids;
            heldSince = Date.now();
        }
        const settlement = settlementOf(runs, Date.now() - heldSince);
        if (settlement.kind === "failed") return { failed: settlement.reason };
        if (settlement.kind === "settled") {
            for (const run of runs) claimed.add(run.id);
            if (claimed.size > RUN_CEILING) throw new Halt(`more than ${String(RUN_CEILING)} runs`);
            return { runs };
        }
    }
    return { failed: `no settled run within ${String(STEP_DEADLINE_MS)} ms` };
}

/** The item's timeline as GitHub lists it, in the judge's shape. */
async function timelineOf(rehearsal: Rehearsal, item: ItemRef): Promise<TimelineEvent[]> {
    const { call, env } = rehearsal;
    const path = `/repos/${env.owner}/${env.repo}/issues/${String(item.number)}/timeline?per_page=${String(PAGE)}`;
    const events = listOf(await call("GET", path), "the timeline");
    if (events.length >= PAGE)
        throw new Halt(`${item.kind}#${String(item.number)} has a page of events or more`);
    const login = (entry: unknown): string | null => {
        const actor = field(field(entry, "actor"), "login") ?? field(field(entry, "user"), "login");
        return typeof actor === "string" ? actor : null;
    };
    const at = (entry: unknown): string | null => {
        const stamp = field(entry, "created_at") ?? field(entry, "submitted_at");
        return typeof stamp === "string" ? stamp : null;
    };
    return events.map((entry) => ({
        event: String(field(entry, "event")),
        actor: login(entry),
        at: at(entry),
    }));
}

/** What the step's runs printed, each log kept: the rows, the lines that are not rows, the engine. */
async function rowsOf(
    rehearsal: Rehearsal,
    runs: readonly WorkflowRun[],
): Promise<{
    readonly rows: LogRow[];
    readonly malformed: string[];
    readonly engine: string | null;
}> {
    const { reader, directory, log } = rehearsal;
    const rows: LogRow[] = [];
    const malformed: string[] = [];
    let engine: string | null = null;
    for (const run of runs) {
        const text = await reader.jobLogs(run.id);
        writeFileSync(join(directory, `run-${String(run.id)}.log`), text);
        const parsed = parseLog(text);
        rows.push(...parsed.rows);
        malformed.push(...parsed.malformed);
        engine ??= parsed.engineCommit;
        log.record("log", { run: run.id, ...parsed });
    }
    return { rows, malformed, engine };
}

/** Once, after the first run is judged and recorded: the engine in its log is the one expected. */
function assertEngine(rehearsal: Rehearsal, engine: string | null): void {
    if (rehearsal.engineChecked) return;
    rehearsal.engineChecked = true;
    if (engine === null) throw new Halt("the first run's log names no engine commit");
    if (engine !== rehearsal.env.engineCommit) {
        throw new Halt(
            `the engine commit in the log is ${engine}, not ${rehearsal.env.engineCommit}`,
        );
    }
}

/** One event: provoked, settled, read and judged; its differences name why it failed. */
async function step(
    rehearsal: Rehearsal,
    held: Case,
    event: EventCase,
    subject: Subject,
    name: string,
): Promise<StepResult> {
    const { log } = rehearsal;
    const record = { capability: held.capability, capture: event.capture };
    await sleep(PACE_MS);
    const { item, since } = await rehearsal.provoker.provoke(event.action, subject, name);
    log.record("provoke", { ...record, action: event.action, item, since });
    const settled = await settle(rehearsal, since, event.raises);
    if ("failed" in settled) {
        log.record("settle", { ...record, item, failed: settled.failed });
        return { capture: event.capture, item, runs: [], differences: [settled.failed] };
    }
    const runs = settled.runs.map((run) => run.id);
    log.record("settle", { ...record, item, runs: settled.runs });
    const read = await rowsOf(rehearsal, settled.runs);
    const differences = [
        ...rowDifferences(item, event.expected, read.rows),
        ...readBackDifferences(await timelineOf(rehearsal, item), since),
        ...read.malformed.map((line) => `a row line that is not a row: ${line}`),
    ];
    log.record("judge", {
        ...record,
        item,
        runs,
        rows: read.rows,
        expected: event.expected,
        differences,
    });
    assertEngine(rehearsal, read.engine);
    return { capture: event.capture, item, runs, differences };
}

/** One capability: its config switched, each event stepped until one fails. */
async function rehearse(rehearsal: Rehearsal, held: Case): Promise<CaseResult> {
    const steps: StepResult[] = [];
    const subject: Subject = { issue: null, pull: null };
    const name = `${EXPERIMENT}-${rehearsal.runId}-${held.capability}`;
    for (const event of held.events) {
        const result = await step(rehearsal, held, event, subject, name);
        steps.push(result);
        const passed = result.differences.length === 0;
        console.log(
            `  ${event.capture}: ${passed ? "passed" : "FAILED"} (runs ${result.runs.join(", ") || "none"})`,
        );
        for (const difference of result.differences) console.log(`    ${difference}`);
        if (!passed) break;
    }
    return {
        capability: held.capability,
        passed:
            steps.length === held.events.length && steps.every((s) => s.differences.length === 0),
        steps,
    };
}

async function main(): Promise<number> {
    const env = environmentOf();
    if (Array.isArray(env)) {
        console.error(`set ${env.join(", ")}; see packages/dev/lab/README.md`);
        return 2;
    }
    const cases = selectedCases(process.argv.slice(2));
    const call = createGitHub(env.token);
    const login = await sandboxOwner(call, env.owner, env.repo);
    const sandbox = createSandbox(call, env.owner, env.repo);
    const facts = await sandbox.inspect();
    if (!facts.workflowPresent)
        throw new Halt(`${WORKFLOW_PATH} is absent from ${facts.defaultBranch}`);
    if (facts.configMode === "active")
        throw new Halt("the config in force is active; nothing here runs armed");

    const runId = new Date().toISOString().replace(/[:.]/g, "-");
    const directory = join(LAB_DIR, "evidence", `${EXPERIMENT}-${runId}`);
    mkdirSync(directory, { recursive: true });
    const log = new EvidenceLog(EXPERIMENT, runId, directory);
    log.record("start", {
        sandbox: `${env.owner}/${env.repo}`,
        login,
        defaultBranch: facts.defaultBranch,
        configMode: facts.configMode,
        engineCommit: env.engineCommit,
        cases: cases.map((held) => held.capability),
    });
    process.once("SIGINT", () => {
        console.log("\ninterrupted: restoring the sandbox");
        interrupted.abort();
    });

    const rehearsal: Rehearsal = {
        call,
        env,
        log,
        directory,
        runId,
        provoker: createProvoker({
            call,
            sandbox,
            owner: env.owner,
            repo: env.repo,
            defaultBranch: facts.defaultBranch,
        }),
        reader: createRunReader({ call, token: env.token, owner: env.owner, repo: env.repo }),
        claimed: new Set(),
        ignored: new Set(),
        engineChecked: false,
    };
    const results: CaseResult[] = [];
    let halted: string | null = null;
    try {
        await sandbox.prepare();
        for (const held of cases) {
            console.log(`- ${held.capability}`);
            const sha = await sandbox.switchConfig(
                held.config,
                `rehearsal ${runId}: ${held.capability} in dry-run`,
            );
            log.record("switch", { capability: held.capability, sha });
            results.push(await rehearse(rehearsal, held));
        }
    } catch (error) {
        halted = messageOf(error);
        console.error(`halted: ${halted}`);
    }
    // Restoring comes before the verdict, so a halt cannot leave the sandbox switched.
    const problems = await sandbox.restore();
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
