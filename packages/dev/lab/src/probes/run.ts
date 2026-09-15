/**
 * Era 3's runner: send each confirmed read once, compare what came back to its shape
 * record, and stamp `probe-results.json`. It never adapts to what it sees — a difference
 * is a drift for a human to decide. Reads only, sandbox only, one request per record.
 *
 *   tsx src/probes/run.ts --plan   print every record and fixture, send nothing, exit 0
 *   tsx src/probes/run.ts          the run, with the four environment values set
 */

import { permissionAccepted } from "./compare.js";
import { createSign } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { EvidenceLog, safeHeaders } from "./evidence.js";
import {
    describeFixture,
    FIXTURE_NAMES,
    FIXTURES,
    type Fixture,
    type FixtureName,
} from "./fixtures.js";
import {
    SHAPE_RECORDS,
    type Conditional,
    type Pagination,
    type RequestTemplate,
    type Shape,
    type ShapeRecord,
    type WireRead,
} from "./reads.js";

// ─── Bounds ──────────────────────────────────────────────────────────

/** Two seconds between calls, the pace protocol 6.9 measured under. */
const PACE_MS = 2_000;

const API_ORIGIN = "https://api.github.com";

const API_VERSION = "2026-03-10";

const USER_AGENT = "hiero-hackers-sdk-automations-probe";

const EXPERIMENT = "conformance-probe";

/** GitHub rejects an assertion whose `iat` sits in its own future. */
const BACKDATE_SECONDS = 60;

const ASSERTION_SECONDS = 540;

const RESULTS_PATH = fileURLToPath(new URL("../../probe-results.json", import.meta.url));

// ─── What the run leaves behind ──────────────────────────────────────

/** One read's verdict: clean, drifted, or not readable at all. */
interface ProbeResult {
    readonly name: string;
    readonly ok: boolean;
    readonly drift?: readonly string[];
    readonly unreadable?: string;
}

interface ResultFile {
    readonly probedAt: string | null;
    readonly sandbox: string | null;
    readonly results: readonly ProbeResult[];
}

// ─── The environment ─────────────────────────────────────────────────

interface Environment {
    readonly appId: string;
    readonly keyPath: string;
    readonly installationId: string;
    readonly owner: string;
    readonly repo: string;
}

function value(name: string): string | undefined {
    const held = process.env[name];
    return held === undefined || held.trim() === "" ? undefined : held.trim();
}

/** The four values, or `null` when any is missing — which is a skip, not a failure. */
function environmentOf(): Environment | null {
    const appId = value("APP_ID");
    const keyPath = value("PRIVATE_KEY_PATH");
    const installationId = value("INSTALLATION_ID");
    const [owner, repo] = (value("SANDBOX_REPO") ?? "").split("/");
    if (appId === undefined || keyPath === undefined || installationId === undefined) return null;
    if (owner === undefined || owner === "" || repo === undefined || repo === "") return null;
    return { appId, keyPath, installationId, owner, repo };
}

/** Presence, never value. The key file is reported by its path and never opened. */
function environmentLines(): readonly string[] {
    const keyPath = value("PRIVATE_KEY_PATH");
    const presence = (name: string): string => (value(name) === undefined ? "(unset)" : "set");
    return [
        `SANDBOX_REPO      ${value("SANDBOX_REPO") ?? "(unset)"}`,
        `APP_ID            ${presence("APP_ID")}`,
        `INSTALLATION_ID   ${presence("INSTALLATION_ID")}`,
        `PRIVATE_KEY_PATH  ${
            keyPath === undefined ? "(unset)" : existsSync(keyPath) ? "present" : "NOT FOUND"
        }`,
        `results           ${RESULTS_PATH}`,
    ];
}

// ─── The plan ────────────────────────────────────────────────────────

function describeRequest(request: RequestTemplate | null): string {
    return request === null ? "— no request" : `${request.method} ${request.path}`;
}

function printPlan(): void {
    console.log("# conformance probe plan — nothing is sent\n");
    for (const line of environmentLines()) console.log(`  ${line}`);

    console.log("\n## fixtures\n");
    for (const name of FIXTURE_NAMES) console.log(`  ${describeFixture(name)}`);

    console.log(
        `\n## records — ${String(SHAPE_RECORDS.length)}, each sent once, ` +
            `${String(PACE_MS)} ms apart\n`,
    );
    for (const record of SHAPE_RECORDS) {
        console.log(`  ${record.name}`);
        console.log(`    row       ${record.row}`);
        console.log(`    request   ${describeRequest(record.request)}`);
        if (record.request === null) continue;
        console.log(`    fixture   ${record.fixture}`);
        console.log(
            `    shape     ${String(record.shape.status)} · ${record.shape.permission} · ` +
                `headers [${record.shape.headers.join(", ")}] · ` +
                `pagination ${record.shape.pagination} · conditional ${record.shape.conditional}`,
        );
        console.log(`    fields    ${record.shape.fields.join(", ")}`);
    }
    console.log("\nplan only: no request was made.");
}

// ─── Sending ─────────────────────────────────────────────────────────

interface Sent {
    readonly status: number;
    readonly headers: Readonly<Record<string, string>>;
    readonly body: string;
}

type SendOutcome =
    { readonly ok: true; readonly sent: Sent } | { readonly ok: false; readonly detail: string };

let opened: EvidenceLog | null = null;

/** Lazily opened, so `--plan` creates no directory and no file. */
const log = (): EvidenceLog => (opened ??= new EvidenceLog(EXPERIMENT));

let lastSentAt = 0;

async function pace(): Promise<void> {
    const wait = PACE_MS - (Date.now() - lastSentAt);
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    lastSentAt = Date.now();
}

function headersOf(response: Response): Record<string, string> {
    const harvested: Record<string, string> = {};
    response.headers.forEach((held, name) => {
        harvested[name.toLowerCase()] = held;
    });
    return harvested;
}

/**
 * One request, sent once. No retry and no cache by construction: either would replace
 * the shape being measured.
 */
async function send(
    step: string,
    token: string,
    url: string,
    method: "GET" | "POST",
    options: { readonly body?: string; readonly extra?: Readonly<Record<string, string>> } = {},
): Promise<SendOutcome> {
    await pace();
    let response: Response;
    try {
        response = await fetch(url, {
            method,
            headers: {
                accept: "application/vnd.github+json",
                authorization: `token ${token}`,
                "user-agent": USER_AGENT,
                "x-github-api-version": API_VERSION,
                ...(options.extra ?? {}),
            },
            ...(options.body === undefined ? {} : { body: options.body }),
            redirect: "manual",
        });
    } catch {
        return { ok: false, detail: "the request did not complete" };
    }
    let body: string;
    try {
        body = await response.text();
    } catch {
        return { ok: false, detail: "the response body could not be read" };
    }
    const headers = headersOf(response);
    log().record(step, {
        url: url.replace(API_ORIGIN, ""),
        method,
        status: response.status,
        headers: safeHeaders(headers),
        body,
    });
    return { ok: true, sent: { status: response.status, headers, body } };
}

// ─── Reading a body ──────────────────────────────────────────────────

/** GitHub's body, or `null` when what came back was not JSON. */
function parsed(body: string): unknown {
    try {
        return JSON.parse(body) as unknown;
    } catch {
        return null;
    }
}

function objectOf(held: unknown): Readonly<Record<string, unknown>> | null {
    return typeof held === "object" && held !== null && !Array.isArray(held)
        ? (held as Record<string, unknown>)
        : null;
}

/** Does this path resolve anywhere in the body? An empty array resolves every path under it. */
function resolves(held: unknown, segments: readonly string[]): boolean {
    const [head, ...rest] = segments;
    if (head === undefined) return true;
    if (head === "[]") {
        if (!Array.isArray(held)) return false;
        return held.length === 0 || held.some((entry) => resolves(entry, rest));
    }
    const inner = objectOf(held);
    return inner !== null && Object.hasOwn(inner, head) && resolves(inner[head], rest);
}

function segmentsOf(path: string): readonly string[] {
    return path
        .replace(/\[\]/g, ".[].")
        .split(".")
        .filter((segment) => segment !== "");
}

/** The recorded fields the body does not carry; a `?` path is recorded and never drift. */
function missingFields(body: string, fields: readonly string[]): readonly string[] {
    const held = parsed(body);
    const root = Array.isArray(held) ? ["[]"] : [];
    return fields
        .filter((path) => !path.endsWith("?"))
        .filter((path) => !resolves(held, [...root, ...segmentsOf(path)]));
}

// ─── The token ───────────────────────────────────────────────────────

const encode = (claims: object): string =>
    Buffer.from(JSON.stringify(claims)).toString("base64url");

type MintOutcome =
    { readonly ok: true; readonly token: string } | { readonly ok: false; readonly detail: string };

/** The App assertion, or the reason the key could not sign one. */
function assertion(environment: Environment): MintOutcome {
    const issuedAt = Math.floor(Date.now() / 1000) - BACKDATE_SECONDS;
    const signingInput = [
        encode({ alg: "RS256", typ: "JWT" }),
        encode({
            iat: issuedAt,
            exp: issuedAt + ASSERTION_SECONDS,
            iss: environment.appId,
        }),
    ].join(".");
    try {
        const signature = createSign("RSA-SHA256")
            .update(signingInput)
            .sign(readFileSync(environment.keyPath, "utf8"))
            .toString("base64url");
        return { ok: true, token: `${signingInput}.${signature}` };
    } catch {
        return { ok: false, detail: "PRIVATE_KEY_PATH did not sign an assertion" };
    }
}

/** An installation token with the App's whole grant; narrowing is the negative control's job. */
async function mintToken(environment: Environment): Promise<MintOutcome> {
    const signed = assertion(environment);
    if (!signed.ok) return signed;

    const url = `${API_ORIGIN}/app/installations/${environment.installationId}/access_tokens`;
    let response: Response;
    try {
        response = await fetch(url, {
            method: "POST",
            headers: {
                accept: "application/vnd.github+json",
                authorization: `Bearer ${signed.token}`,
                "user-agent": USER_AGENT,
                "x-github-api-version": API_VERSION,
            },
            redirect: "manual",
        });
    } catch {
        return { ok: false, detail: "the mint did not complete" };
    }
    const minted = parsed(await response.text());
    const token = objectOf(minted)?.["token"];
    return typeof token === "string" && token.length > 0
        ? { ok: true, token }
        : { ok: false, detail: `the mint answered ${String(response.status)} with no token` };
}

// ─── Comparing ───────────────────────────────────────────────────────

const advertises = (link: string | undefined, rel: string): boolean =>
    link !== undefined && link.includes(`rel="${rel}"`);

/** A link header that contradicts the recorded advertisement, as one drift line. */
function paginationDrift(recorded: Pagination, link: string | undefined): string | null {
    const next = advertises(link, "next");
    const last = advertises(link, "last");
    if (recorded === "next-only" && last) return "pagination: next-only → last-named";
    if (recorded === "last-named" && next && !last) return "pagination: last-named → next-only";
    return null;
}

/** A fixture that no longer answers in one page is unreadable, not drifted. */
function outgrewOnePage(recorded: Pagination, link: string | undefined): boolean {
    return recorded === "none" && (advertises(link, "next") || advertises(link, "last"));
}

/** A failure of GitHub's rather than a change of GitHub's. */
function weather(status: number): boolean {
    return status >= 500 || status === 429;
}

const drifted = (property: string, recorded: string, seen: string): string =>
    `${property}: ${recorded} → ${seen}`;

/** Every property of the record the response contradicts, one line each. */
function driftOf(shape: Shape, sent: Sent): readonly string[] {
    const lines: string[] = [];
    if (sent.status !== shape.status) {
        lines.push(drifted("status", String(shape.status), String(sent.status)));
    }
    const accepted = sent.headers["x-accepted-github-permissions"];
    if (accepted !== undefined && !permissionAccepted(shape.permission, accepted)) {
        lines.push(drifted("permission", shape.permission, accepted));
    }
    for (const name of shape.headers) {
        if (sent.headers[name] === undefined) lines.push(drifted("headers", name, "absent"));
    }
    const pagination = paginationDrift(shape.pagination, sent.headers["link"]);
    if (pagination !== null) lines.push(pagination);
    for (const field of missingFields(sent.body, shape.fields)) {
        lines.push(drifted("fields", field, "absent"));
    }
    return lines;
}

/** The conditional replay's verdict: one drift line, or none. */
async function conditionalDrift(
    name: string,
    token: string,
    url: string,
    recorded: Conditional,
    first: Sent,
): Promise<readonly string[]> {
    const etag = first.headers["etag"];
    if (recorded === "none" || etag === undefined) return [];
    const replay = await send(`${name}-conditional`, token, url, "GET", {
        extra: { "if-none-match": etag },
    });
    if (recorded === "etag-only") return [];
    if (!replay.ok) return [drifted("conditional", "304-free", replay.detail)];
    if (replay.sent.status !== 304) {
        return [drifted("conditional", "304-free", String(replay.sent.status))];
    }
    const before = first.headers["x-ratelimit-used"];
    const after = replay.sent.headers["x-ratelimit-used"];
    return before !== undefined && after !== undefined && Number(after) > Number(before)
        ? [drifted("conditional", "304-free", "304, charged")]
        : [];
}

// ─── The fixtures ────────────────────────────────────────────────────

/** What the fixture check resolved: the values a request template may name. */
interface Resolved {
    readonly number?: number;
    readonly login?: string;
    readonly ref?: string;
}

type FixtureOutcome =
    | { readonly ok: true; readonly resolved: ReadonlyMap<FixtureName, Resolved> }
    | { readonly ok: false; readonly detail: string };

function itemUrl(environment: Environment, kind: string, number: number): string {
    const collection = kind === "pullRequest" ? "pulls" : "issues";
    return (
        `${API_ORIGIN}/repos/${encodeURIComponent(environment.owner)}/` +
        `${encodeURIComponent(environment.repo)}/${collection}/${String(number)}`
    );
}

/**
 * Every fixture's state, read back before a single shape is measured.
 * The first mismatch refuses the run, naming the fixture: a wrong state is not a drift.
 */
async function checkFixtures(environment: Environment, token: string): Promise<FixtureOutcome> {
    const resolved = new Map<FixtureName, Resolved>();
    for (const name of FIXTURE_NAMES) {
        const fixture: Fixture = FIXTURES[name];
        if (fixture.kind === "login") {
            if (fixture.login === undefined) return { ok: false, detail: `${name} pins no login` };
            resolved.set(name, { login: fixture.login });
            continue;
        }
        if (fixture.kind === "repository") {
            resolved.set(name, {});
            continue;
        }
        const number = fixture.number;
        if (number === undefined) return { ok: false, detail: `${name} pins no item number` };

        const read = await send(
            `fixture-${name}`,
            token,
            itemUrl(environment, fixture.kind, number),
            "GET",
        );
        if (!read.ok) return { ok: false, detail: `${name} (#${String(number)}): ${read.detail}` };
        if (read.sent.status !== 200) {
            return {
                ok: false,
                detail: `${name} (#${String(number)}) answered ${String(read.sent.status)}`,
            };
        }
        const body = objectOf(parsed(read.sent.body));
        const state = body?.["state"];
        if (state !== fixture.state) {
            return {
                ok: false,
                detail: `${name} (#${String(number)}) is ${String(state)}, not ${String(fixture.state)}`,
            };
        }
        if (fixture.draft !== undefined && body?.["draft"] !== fixture.draft) {
            return {
                ok: false,
                detail: `${name} (#${String(number)}) draft is ${String(body?.["draft"])}, not ${String(fixture.draft)}`,
            };
        }
        const head = objectOf(body?.["head"])?.["sha"];
        resolved.set(name, {
            number,
            ...(typeof head === "string" ? { ref: head } : {}),
        });
    }
    return { ok: true, resolved };
}

// ─── Probing one record ──────────────────────────────────────────────

/** The record's path with the fixture's values in it, or `null` when one is missing. */
function urlOf(read: WireRead, environment: Environment, held: Resolved): string | null {
    const filled = read.request.path
        .replace("{o}", encodeURIComponent(environment.owner))
        .replace("{r}", encodeURIComponent(environment.repo))
        .replace("{n}", held.number === undefined ? "{n}" : String(held.number))
        .replace("{login}", held.login === undefined ? "{login}" : encodeURIComponent(held.login))
        .replace("{ref}", held.ref === undefined ? "{ref}" : encodeURIComponent(held.ref));
    return /\{[a-z]+\}/.test(filled) ? null : `${API_ORIGIN}${filled}`;
}

/** What one variable the query declares is filled with; an item number is the default. */
function variableValue(name: string, environment: Environment, held: Resolved): unknown {
    if (name === "owner") return environment.owner;
    if (name === "repo") return environment.repo;
    if (name === "after") return null;
    return held.number ?? 0;
}

/**
 * The POST body for a record whose request carries a query.
 * The operation name and the variables are read OFF the query, so a second operation needs no arm here.
 */
function graphqlBody(read: WireRead, environment: Environment, held: Resolved): string {
    const query = read.request.body ?? "";
    const variables: Record<string, unknown> = {};
    for (const declared of query.matchAll(/\$([A-Za-z_][A-Za-z0-9_]*)\s*:/g)) {
        variables[declared[1]!] = variableValue(declared[1]!, environment, held);
    }
    return JSON.stringify({
        operationName: /^\s*query\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(query)?.[1] ?? "",
        query,
        variables,
    });
}

const unreadable = (name: string, detail: string): ProbeResult => ({
    ok: false,
    name,
    unreadable: detail,
});

/** One record: one paced request, one conditional replay, then the comparison. */
async function probe(
    read: WireRead,
    environment: Environment,
    token: string,
    resolved: ReadonlyMap<FixtureName, Resolved>,
): Promise<ProbeResult> {
    const held = resolved.get(read.fixture) ?? {};
    const url = urlOf(read, environment, held);
    if (url === null) {
        return unreadable(read.name, `${read.fixture} filled no value for the request template`);
    }
    const sent = await send(read.name, token, url, read.request.method, {
        ...(read.request.method === "POST" ? { body: graphqlBody(read, environment, held) } : {}),
    });
    if (!sent.ok) return unreadable(read.name, sent.detail);
    if (weather(sent.sent.status)) {
        return unreadable(read.name, `GitHub answered ${String(sent.sent.status)}`);
    }
    if (outgrewOnePage(read.shape.pagination, sent.sent.headers["link"])) {
        return unreadable(read.name, `${read.fixture} no longer answers in one page`);
    }
    const drift = [
        ...driftOf(read.shape, sent.sent),
        ...(read.request.method === "GET"
            ? await conditionalDrift(read.name, token, url, read.shape.conditional, sent.sent)
            : []),
    ];
    return drift.length === 0
        ? { name: read.name, ok: true }
        : { name: read.name, ok: false, drift };
}

// ─── The run ─────────────────────────────────────────────────────────

const isWire = (held: ShapeRecord): held is WireRead => held.request !== null;

function write(file: ResultFile): void {
    writeFileSync(RESULTS_PATH, `${JSON.stringify(file, null, 4)}\n`);
}

function report(results: readonly ProbeResult[]): number {
    for (const result of results) {
        const detail = result.unreadable ?? result.drift?.join("; ") ?? "";
        console.log(`[${result.name}] ${result.ok ? "ok" : `FAILED — ${detail}`}`);
    }
    const failed = results.filter((result) => !result.ok);
    console.log(
        `\n${String(results.length - failed.length)}/${String(results.length)} clean; ` +
            `evidence in ${log().file}`,
    );
    return failed.length === 0 ? 0 : 1;
}

if (process.argv.includes("--plan")) {
    printPlan();
    process.exit(0);
}

const environment = environmentOf();
if (environment === null) {
    console.log("skipped: no credentials");
    process.exit(0);
}

const minted = await mintToken(environment);
if (!minted.ok) {
    console.error(`refused: ${minted.detail}`);
    process.exit(1);
}

const sandbox = `${environment.owner}/${environment.repo}`;
const fixtures = await checkFixtures(environment, minted.token);
if (!fixtures.ok) {
    console.error(`refused: ${fixtures.detail}`);
    process.exit(1);
}

const results: ProbeResult[] = [];
for (const held of SHAPE_RECORDS) {
    results.push(
        isWire(held)
            ? await probe(held, environment, minted.token, fixtures.resolved)
            : { name: held.name, ok: true },
    );
}
write({ probedAt: new Date().toISOString(), sandbox, results });
process.exit(report(results));
