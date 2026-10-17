/**
 * The workflow runs a step raised: which of the runs GitHub lists belong to it, when they have
 * settled, and the decision rows and engine commit read out of a job's log. The selection, the
 * settlement and the parser are pure; the reader at the end is the live half.
 */

import { fetchText, field, Halt, type Answer, type Call } from "../github.js";
import type { LogRow } from "./judge.js";

// ─── Bounds ──────────────────────────────────────────────────────────

/** A step has settled once its runs have all completed and none has appeared for this long. */
export const QUIET_MS = 30_000;

// ─── Which runs are the step's ───────────────────────────────────────

/** One workflow run as the Actions API lists it. */
export interface WorkflowRun {
    readonly id: number;
    readonly event: string;
    readonly createdAt: string;
    readonly status: string;
    readonly conclusion: string | null;
}

/** The runs a step raised: created at or after it began, for an event it raises, claimed by no earlier step. */
export function runsRaised(
    listed: readonly WorkflowRun[],
    since: string,
    raises: readonly string[],
    claimed: ReadonlySet<number>,
): WorkflowRun[] {
    return listed.filter(
        (run) =>
            Date.parse(run.createdAt) >= Date.parse(since) &&
            raises.includes(run.event) &&
            !claimed.has(run.id),
    );
}

export type Settlement =
    | { readonly kind: "waiting" }
    | { readonly kind: "settled" }
    | { readonly kind: "failed"; readonly reason: string };

const WAITING: Settlement = { kind: "waiting" };

/** Settled once every run has completed and the set has held still for the quiet window. */
export function settlementOf(runs: readonly WorkflowRun[], quietForMs: number): Settlement {
    const failed = runs.filter((run) => run.status === "completed" && run.conclusion !== "success");
    if (failed.length > 0) {
        const named = failed.map((run) => `${String(run.id)} ${run.conclusion ?? "unknown"}`);
        return { kind: "failed", reason: `run ${named.join(", run ")}` };
    }
    if (runs.length === 0 || runs.some((run) => run.status !== "completed")) return WAITING;
    return quietForMs >= QUIET_MS ? { kind: "settled" } : WAITING;
}

// ─── What a job log says ─────────────────────────────────────────────

/** What the Action prints before each decision row's compact JSON. */
export const ROW_MARKER = "sdk-automations.row ";

/** A log's rows, the lines that claimed to be rows and were not, and the engine commit it names. */
export interface ParsedLog {
    readonly rows: readonly LogRow[];
    readonly malformed: readonly string[];
    readonly engineCommit: string | null;
}

/** The job and step columns `gh` prefixes, then the timestamp the runner does, with its BOM. */
const PREFIX = /^(?:[^\t]*\t[^\t]*\t)?﻿?\d{4}-\d{2}-\d{2}T[\d:.]+Z /;

const ENGINE_COMMIT = /^engine commit: ([0-9a-f]{40})$/;

function rowOf(json: string): LogRow | null {
    let parsed: unknown;
    try {
        parsed = JSON.parse(json);
    } catch {
        return null;
    }
    const kind = field(field(parsed, "item"), "kind");
    const number = field(field(parsed, "item"), "number");
    const capability = field(parsed, "capability");
    const verdict = field(parsed, "verdict");
    const code = field(parsed, "code");
    const detail = field(parsed, "detail");
    const shaped =
        (kind === "issue" || kind === "pullRequest") &&
        typeof number === "number" &&
        typeof capability === "string" &&
        typeof verdict === "string" &&
        (code === null || typeof code === "string") &&
        (detail === null || typeof detail === "string");
    return shaped ? { item: { kind, number }, capability, verdict, code, detail } : null;
}

/** The rows and the engine commit in one job's log, whatever columns prefix its lines. */
export function parseLog(text: string): ParsedLog {
    const rows: LogRow[] = [];
    const malformed: string[] = [];
    let engineCommit: string | null = null;
    for (const line of text.split(/\r?\n/)) {
        const body = line.replace(PREFIX, "");
        if (body.startsWith(ROW_MARKER)) {
            const row = rowOf(body.slice(ROW_MARKER.length));
            if (row === null) malformed.push(body);
            else rows.push(row);
        } else {
            engineCommit ??= ENGINE_COMMIT.exec(body)?.[1] ?? null;
        }
    }
    return { rows, malformed, engineCommit };
}

// ─── Reading them from GitHub ────────────────────────────────────────

const PAGE = 100;

export interface RunReader {
    /** Every run created at or after `since`, as GitHub lists them. */
    listSince(since: string): Promise<WorkflowRun[]>;
    /** The text of every job's log in one run, joined. */
    jobLogs(runId: number): Promise<string>;
}

export interface RunReaderOptions {
    readonly call: Call;
    readonly token: string;
    readonly owner: string;
    readonly repo: string;
}

function runOf(listed: unknown): WorkflowRun | null {
    const id = field(listed, "id");
    const event = field(listed, "event");
    const createdAt = field(listed, "created_at");
    const status = field(listed, "status");
    const conclusion = field(listed, "conclusion");
    const shaped =
        typeof id === "number" &&
        typeof event === "string" &&
        typeof createdAt === "string" &&
        typeof status === "string" &&
        (conclusion === null || typeof conclusion === "string");
    return shaped ? { id, event, createdAt, status, conclusion } : null;
}

export function createRunReader({ call, token, owner, repo }: RunReaderOptions): RunReader {
    const repository = `/repos/${owner}/${repo}`;

    const listed = (answer: Answer, name: string, what: string): readonly unknown[] => {
        const held = field(answer.body, name);
        if (!Array.isArray(held)) throw new Halt(`${what} was not a list`);
        if (held.length >= PAGE) throw new Halt(`${what} is a page or more`);
        return held;
    };

    return {
        async listSince(since) {
            const created = encodeURIComponent(`>=${since.replace(/(?:\.\d+)?Z$/, "+00:00")}`);
            const path = `${repository}/actions/runs?created=${created}&per_page=${String(PAGE)}`;
            return listed(await call("GET", path), "workflow_runs", "the runs list")
                .map(runOf)
                .filter((run): run is WorkflowRun => run !== null);
        },

        async jobLogs(runId) {
            const path = `${repository}/actions/runs/${String(runId)}/jobs?per_page=${String(PAGE)}`;
            const jobs = listed(
                await call("GET", path),
                "jobs",
                `the jobs of run ${String(runId)}`,
            );
            const texts: string[] = [];
            for (const job of jobs) {
                const id = field(job, "id");
                if (typeof id !== "number")
                    throw new Halt(`a job of run ${String(runId)} has no id`);
                texts.push(await fetchText(token, `${repository}/actions/jobs/${String(id)}/logs`));
            }
            return texts.join("\n");
        },
    };
}
