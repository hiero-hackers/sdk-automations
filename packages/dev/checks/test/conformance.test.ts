/**
 * The era-3 lock: `packages/dev/lab/probe-results.json` names every confirmed read and every
 * captured webhook, carries no drift, and is not stale. A read confirmed in code but never
 * probed is a failing check, which is how a new resolver is forced into the probe table; a
 * capture with no webhook result forces the events pass the same way. One invariant per `it`.
 */

import { describe, expect, it } from "vitest";
import { WEBHOOK_CAPTURES } from "@hiero-hackers/automation-testkit";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "./repository.js";

const RESULTS = "packages/dev/lab/probe-results.json";

/** Older evidence is a red check: nobody ran the probe, which is the whole point. */
const FRESHNESS_DAYS = 45;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Every failure message ends with this, so a red check says what to run. */
const ADVICE = "run `pnpm lab:probe` (packages/dev/lab) and commit the result";

/** The config read has no `CONFIRMED_*` entry; `githubConfigSource` is its only reader. */
const CONFIG_READ = "config";

const LISTS = [
    ["packages/runtime/src/adapter/reads/items.ts", "CONFIRMED_SWEEP_READS"],
    ["packages/runtime/src/adapter/reads/resolvers.ts", "CONFIRMED_RESOLVER_READS"],
] as const;

interface ProbeResult {
    readonly name?: unknown;
    readonly drift?: unknown;
    readonly unreadable?: unknown;
}

interface ResultFile {
    readonly probedAt?: unknown;
    readonly sandbox?: unknown;
    readonly results?: unknown;
    readonly webhooks?: unknown;
}

function read(path: string): string {
    return readFileSync(join(repoRoot, path), "utf8");
}

/**
 * The names one `CONFIRMED_*` list holds, read from the adapter's source.
 * Parsed rather than imported: the checks package may not reach into the adapter.
 */
function confirmedReads(file: string, constant: string): string[] {
    const block = new RegExp(`export const ${constant}[^=]*=\\s*\\[([\\s\\S]*?)\\n\\]`).exec(
        read(file),
    );
    const body = (block?.[1] ?? "")
        .split("\n")
        .filter((line) => !line.trim().startsWith("//"))
        .join("\n");
    return [...body.matchAll(/"([A-Za-z]+)"/g)].map((match) => match[1]!);
}

/** The file as JSON, or `null` when it is not parseable JSON at all. */
function parseResults(text: string): ResultFile | null {
    try {
        const held: unknown = JSON.parse(text);
        return typeof held === "object" && held !== null ? (held as ResultFile) : null;
    } catch {
        return null;
    }
}

function resultsOf(file: ResultFile): ProbeResult[] {
    return Array.isArray(file.results) ? (file.results as ProbeResult[]) : [];
}

function webhooksOf(file: ResultFile): ProbeResult[] {
    return Array.isArray(file.webhooks) ? (file.webhooks as ProbeResult[]) : [];
}

/** The captured webhooks the file has no result for; a capture is named `<event>.<action>`. */
function unprobedWebhooks(file: ResultFile, captures: readonly string[]): string[] {
    const named = new Set(
        webhooksOf(file)
            .map((result) => result.name)
            .filter((name): name is string => typeof name === "string"),
    );
    return captures.filter((name) => !named.has(name));
}

function namesIn(file: ResultFile): Set<string> {
    return new Set(
        resultsOf(file)
            .map((result) => result.name)
            .filter((name): name is string => typeof name === "string"),
    );
}

/** The confirmed reads the file has no result for. */
function unprobedReads(file: ResultFile, confirmed: readonly string[]): string[] {
    const named = namesIn(file);
    return confirmed.filter((name) => !named.has(name));
}

/** Every result carrying a drift or an unreadable request, as one line each. */
function failures(file: ResultFile): string[] {
    return [...resultsOf(file), ...webhooksOf(file)].flatMap((result) => {
        const name = typeof result.name === "string" ? result.name : "(unnamed)";
        const drift = Array.isArray(result.drift) ? (result.drift as unknown[]) : [];
        const unreadable = typeof result.unreadable === "string" ? [result.unreadable] : [];
        return [...drift, ...unreadable].map((detail) => `${name}: ${String(detail)}`);
    });
}

/** `fresh`, or what is wrong with the stamp. */
function freshness(file: ResultFile, now: Date): string {
    if (typeof file.probedAt !== "string") return "never probed";
    const probedAt = new Date(file.probedAt);
    if (!Number.isFinite(probedAt.getTime())) return "the stamp is not an instant";
    const days = (now.getTime() - probedAt.getTime()) / MS_PER_DAY;
    return days > FRESHNESS_DAYS ? `stale by ${days.toFixed(0)} days` : "fresh";
}

const stamped = (results: string, webhooks = ""): string =>
    `{ "probedAt": "${new Date().toISOString()}", "sandbox": "o/r", "results": [${results}], "webhooks": [${webhooks}] }`;

const CONTROLS = {
    drift: stamped(
        '{ "name": "openItems", "ok": false, "drift": ["pagination: last-named → next-only"] }',
    ),
    stale: `{ "probedAt": "${new Date(Date.now() - 60 * MS_PER_DAY).toISOString()}", "sandbox": "o/r", "results": [] }`,
    missing: stamped('{ "name": "openItems", "ok": true }'),
    webhookDrift: stamped(
        "",
        '{ "name": "issues.opened", "ok": false, "drift": ["field issue.locked: missing"] }',
    ),
    missingWebhook: stamped("", '{ "name": "issues.opened", "ok": true }'),
};

/** `issues.opened.json` is the capture the result `issues.opened` answers for. */
const CAPTURES = WEBHOOK_CAPTURES.map((capture) => capture.name.replace(/\.json$/, ""));

describe("the conformance probe's result file holds its invariants", () => {
    const text = read(RESULTS);
    const file = parseResults(text);
    const confirmed = [...LISTS.flatMap(([path, name]) => confirmedReads(path, name)), CONFIG_READ];

    it("finds the confirmed reads to check", () => {
        for (const [path, name] of LISTS) {
            expect(confirmedReads(path, name).length, `${path} ${name}`).toBeGreaterThanOrEqual(5);
        }
        expect(confirmed).toContain(CONFIG_READ);
    });

    it("parses", () => {
        expect(file, `${RESULTS} is not readable JSON: ${ADVICE}`).not.toBeNull();
    });

    it("has a result for every confirmed read", () => {
        expect(unprobedReads(file ?? {}, confirmed), `unprobed reads: ${ADVICE}`).toEqual([]);
    });

    it("has a result for every captured webhook", () => {
        expect(CAPTURES.length).toBeGreaterThanOrEqual(5);
        expect(unprobedWebhooks(file ?? {}, CAPTURES), `unprobed webhooks: ${ADVICE}`).toEqual([]);
    });

    it("carries no drift and no unreadable request", () => {
        expect(failures(file ?? {}), `the probe reported a difference: ${ADVICE}`).toEqual([]);
    });

    it("was probed inside the freshness window", () => {
        expect(freshness(file ?? {}, new Date()), `${RESULTS}: ${ADVICE}`).toBe("fresh");
    });

    it("names the command a red check is fixed by", () => {
        expect(ADVICE).toContain("pnpm lab:probe");
    });

    it("fails on a result carrying a drift", () => {
        expect(failures(parseResults(CONTROLS.drift) ?? {})).toEqual([
            "openItems: pagination: last-named → next-only",
        ]);
    });

    it("fails on a stale stamp", () => {
        expect(freshness(parseResults(CONTROLS.stale) ?? {}, new Date())).toMatch(/^stale by/);
        expect(freshness({}, new Date())).toBe("never probed");
    });

    it("fails on a webhook carrying a drift", () => {
        expect(failures(parseResults(CONTROLS.webhookDrift) ?? {})).toEqual([
            "issues.opened: field issue.locked: missing",
        ]);
    });

    it("fails on a missing webhook", () => {
        expect(unprobedWebhooks(parseResults(CONTROLS.missingWebhook) ?? {}, CAPTURES)).toEqual(
            CAPTURES.filter((name) => name !== "issues.opened"),
        );
        expect(unprobedWebhooks({}, CAPTURES)).toEqual(CAPTURES);
    });

    it("fails on a missing read", () => {
        expect(unprobedReads(parseResults(CONTROLS.missing) ?? {}, confirmed)).toEqual(
            confirmed.filter((name) => name !== "openItems"),
        );
    });
});
