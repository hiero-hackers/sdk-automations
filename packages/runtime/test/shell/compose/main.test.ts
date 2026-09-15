/**
 * The composition root run as the real process: `node --import tsx
 * src/shell/compose/main.ts`, an environment, a socket and a SQLite file.
 * Everything the start owns is observable from outside it: the startup event
 * naming the port and both file paths, and a signed delivery coming back as a
 * persisted report under exactly the store path that event announced.
 *
 * Every case here costs a spawn, so a case belongs here only if a spawn is
 * the ONLY thing that can prove it: what the environment refuses at boot,
 * what the startup line announces, what leaves the process on the wire, and
 * what a signal does to it. Whatever a seam can answer is answered at the
 * seam — `composition.test.ts` for every variable the environment is refused
 * for, `shell.test.ts` for composition, `inbound/deliveries.test.ts` for the lane,
 * `externals.test.ts` for the live adapter, `log.test.ts` for the event
 * vocabulary — and is not rehearsed here at process cost.
 *
 * The mocked predecessor replaced node:fs, node:url, all three workspace
 * packages and all three sibling modules, so it could only prove that main
 * calls what main calls. Rewiring the composition would not have failed it.
 *
 * v8 attributes nothing across a spawn, so `compose/main.ts` and the live
 * fill it builds are excluded from coverage in vitest.config.ts. The Stryker
 * harness below forwards the active mutant into the child and folds its
 * coverage back into the parent, so the process boundary does not make them
 * a mutation blind spot.
 *
 * Every child is killed twice over: a hard timer inside `withShell`, and
 * the wrapper's own `finally`. A boot that never reaches `listen` has to
 * end as a failed wait, never as a wedged run. Every child also binds
 * HOST=127.0.0.1, because a suite that opens a port to the network is a
 * suite that makes the machine ask its operator about it.
 */

import { describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { signBody, SIGNATURE_HEADER } from "@hiero-hackers/automation-core";
import { Store, type Decision } from "../../../src/store/index.js";
import { capture, useTempDir } from "@hiero-hackers/automation-testkit";

const PACKAGE_DIR = fileURLToPath(new URL("../../../", import.meta.url));

/**
 * Every child gets its own state home. The default store path is derived
 * from `XDG_STATE_HOME`, so a suite that left it alone would write the
 * operator's real store — and the case that boots with no `STORE_PATH` at
 * all is exactly the one that must not.
 */
const state = useTempDir("shell-main-state-");

const LOOPBACK = "127.0.0.1";

const SECRET = "main-test-secret";
/**
 * The repository the captured fixtures name. The shell refuses a payload
 * from anywhere else, so the endpoint under test has to be started for the
 * repository the deliveries below actually come from — the mismatch is its
 * own case at the end of this file.
 */
const OWNER = "scrubbed-1";
const REPO = "scrubbed-2";
const GUID = "83e4273f-dd89-22f4-92bc-5da478ed1a69";
const UNREADABLE_GUID = "83e4273f-dd89-22f4-92bc-5da478ed1a6a";
const FIXTURE = capture("issues.opened.json").bytes();
const READ_ONLY_GUID = "83e4273f-dd89-22f4-92bc-5da478ed1a6c";
/** The one active-mode delivery, whose effects reach the fake GitHub below. */
const ACTIVE_GUID = "83e4273f-dd89-22f4-92bc-5da478ed1a6e";

/** The issue `issues.opened.json` carries, which the write routes answer for. */
const ISSUE_NUMBER = 164;
/** The item every decision row this suite reads is about. */
const ITEM_REF = { kind: "issue", number: ISSUE_NUMBER } as const;
/** The App the child is told it is: the id it authenticates as, and its slug. */
const APP_ID = "123";
const APP_SLUG = "hiero-hackers-sandbox";
const TRIAGE_LABEL = "status: triage";
/** The default timeline's one human label — later than any fixture's cause. */
const TIMELINE_AT = "2026-08-06T23:10:51Z";

const MISSING_VARIABLES =
    "WEBHOOK_SECRET is required; REPO_OWNER and REPO_NAME are required without App credentials (the repository the local file serves).";

const CONFIG = `schemaVersion: 2
mode: dry-run
capabilities:
  intake:
    enabled: true
    announce: true
mappings:
  labels:
    awaitingTriage: "status: triage"
`;

/**
 * A repository that has asked to be swept: `inactivity` is the one shipped
 * capability that runs on a clock, so enabling it is what makes the lane
 * declare a `sweep:` schedule row.
 */
const SWEEP_CONFIG = `schemaVersion: 2
mode: dry-run
capabilities:
  inactivity:
    enabled: true
    remindAfter: 14d
    reap:
      after: 21d
`;

/**
 * The write path's own configuration. `announce: false` on purpose: intake's
 * second intent claims the triage meaning is ABSENT, and by the time it is
 * gated the first effect has already put the label there — so the comment
 * would be refused as `preconditionStale` and the case would be about that
 * instead of about the composition.
 */
const ACTIVE_CONFIG = `schemaVersion: 2
mode: active
capabilities:
  intake:
    enabled: true
    announce: false
mappings:
  labels:
    awaitingTriage: "${TRIAGE_LABEL}"
`;

/** Everything main.ts reads, cleared from the inherited environment. */
const SHELL_VARIABLES = [
    "WEBHOOK_SECRET",
    "REPO_OWNER",
    "REPO_NAME",
    "CONFIG_FILE",
    "APP_ID",
    "APP_SLUG",
    "PRIVATE_KEY_PATH",
    "INSTALLATION_ID",
    "STORE_PATH",
    "PORT",
    "HOST",
    "KILL_SWITCH",
    "SUSPENDED",
    "TICK_SECONDS",
    "SWEEP_CADENCE_HOURS",
    "SWEEP_WRITE_CALLS",
    "SWEEP_SHARE",
    "CONTENT_CREATION_HOURLY",
    "XDG_STATE_HOME",
];

/** Longer than any boot, shorter than the per-test timeout below it. */
const HARD_TIMEOUT_MS = 10_000;
const WAIT_TIMEOUT_MS = 9_000;
const TEST_TIMEOUT_MS = 15_000;

/** One spawned shell, observed only through what the process emits. */
interface Shell {
    stdout(): string;
    stderr(): string;
    /**
     * The exit code, or `null` when a signal ended it. Settled on 'close',
     * so anything awaiting it reads stdout and stderr complete.
     */
    readonly exit: Promise<number | null>;
    /** Settled in the same sense: gone, and its output all here. */
    exited(): boolean;
    /** Ask it to stop the way a hosting platform does. */
    signal(name: NodeJS.Signals): void;
}

async function until<T>(probe: () => T | undefined, what: string): Promise<T> {
    const deadline = Date.now() + WAIT_TIMEOUT_MS;
    for (;;) {
        const value = probe();
        if (value !== undefined) return value;
        if (Date.now() >= deadline) throw new Error(`timed out waiting for ${what}`);
        await new Promise<void>((resolve) => {
            setTimeout(resolve, 25);
        });
    }
}

// ─── Carrying mutation testing across the spawn ──────────────────────

/**
 * Stryker runs in the process that runs the suite; this suite's subject
 * runs in another one. Two things have to cross that boundary, and
 * neither does on its own.
 *
 * Outward: the active mutant is named in a global here, and instrumented
 * code reads `__STRYKER_ACTIVE_MUTANT__` when its own global is empty. So
 * the variable is handed down. Without it every child runs unmutated code
 * and main.ts scores as perfectly tested while proving nothing.
 *
 * Homeward: mutant coverage is recorded in the child's global, and a
 * mutant that no test is recorded as reaching is never run at all — it is
 * reported "NoCoverage" and counted against the score exactly like a
 * survivor. So the child writes its coverage out as it dies, and the
 * counts are folded into what this test is recorded as covering.
 *
 * The homeward half looks like it should be a config fact instead —
 * `coverageAnalysis: "off"` would run every mutant against every test and
 * no fold would be needed. It was tried: the vitest runner ignores the
 * setting and analyses per test regardless, so main.ts came back 40×
 * NoCoverage and the gate broke at 76%. The fold is the only route.
 *
 * Both halves are inert outside a mutation run: `__stryker__` is only
 * there when Stryker put it there.
 */
interface MutantCoverage {
    static: Record<string, number>;
    perTest: Record<string, Record<string, number>>;
}

interface StrykerNamespace {
    activeMutant?: string;
    currentTestId?: string;
    mutantCoverage?: MutantCoverage;
}

/** Loaded into the child before main.ts, to write what it reached. */
const COVERAGE_HOOK = `import { writeFileSync } from "node:fs";
const flush = () => {
    writeFileSync(
        process.env.SHELL_COVERAGE_OUT,
        JSON.stringify(globalThis.__stryker__?.mutantCoverage ?? null),
    );
};
process.on("exit", flush);
process.stdin.on("end", () => process.exit(0));
process.stdin.resume();
`;

/** Where one child leaves its coverage, and the hook that puts it there. */
interface CoverageDrop {
    readonly dir: string;
    readonly hook: string;
    readonly out: string;
}

function stryker(): StrykerNamespace | undefined {
    return (globalThis as { __stryker__?: StrykerNamespace }).__stryker__;
}

function activeMutant(): Record<string, string> {
    const id = stryker()?.activeMutant;
    return id === undefined ? {} : { __STRYKER_ACTIVE_MUTANT__: String(id) };
}

/** Only the run that measures coverage — never a mutant run — needs one. */
function coverageDrop(): CoverageDrop | undefined {
    const namespace = stryker();
    if (namespace === undefined || namespace.activeMutant !== undefined) return undefined;
    const dir = mkdtempSync(join(tmpdir(), "shell-main-coverage-"));
    const hook = join(dir, "coverage-hook.mjs");
    writeFileSync(hook, COVERAGE_HOOK);
    return { dir, hook, out: join(dir, "coverage.json") };
}

function absorbCoverage(drop: CoverageDrop): void {
    const namespace = stryker();
    const testId = namespace?.currentTestId;
    try {
        if (namespace === undefined || testId === undefined) return;
        const child = JSON.parse(readFileSync(drop.out, "utf8")) as MutantCoverage | null;
        if (child === null) return;
        const coverage = (namespace.mutantCoverage ??= { static: {}, perTest: {} });
        const reached = (coverage.perTest[testId] ??= {});
        for (const [id, hits] of Object.entries(child.static)) {
            reached[id] = (reached[id] ?? 0) + hits;
        }
    } catch {
        // No drop file: the child died before the hook could write one,
        // which only a mutant another case already fails on can do.
    } finally {
        rmSync(drop.dir, { recursive: true, force: true });
    }
}

/**
 * Boot `src/shell/compose/main.ts` for the duration of `body`, then stop it.
 *
 * The parent environment is inherited rather than replaced — it carries
 * the module resolution the child needs — and only the shell's own
 * variables are set from scratch, so a host that exports WEBHOOK_SECRET
 * cannot quietly satisfy the case that requires it to be absent.
 */
async function withShell<T>(
    overrides: Readonly<Record<string, string>>,
    body: (shell: Shell) => Promise<T>,
    preload?: string,
): Promise<T> {
    const environment = { ...process.env };
    for (const key of SHELL_VARIABLES) delete environment[key];
    const drop = coverageDrop();
    const child = spawn(
        process.execPath,
        [
            "--import",
            "tsx",
            ...(drop === undefined ? [] : ["--import", pathToFileURL(drop.hook).href]),
            ...(preload === undefined ? [] : ["--import", pathToFileURL(preload).href]),
            "src/shell/compose/main.ts",
        ],
        {
            cwd: PACKAGE_DIR,
            env: {
                ...environment,
                ...activeMutant(),
                ...(drop === undefined ? {} : { SHELL_COVERAGE_OUT: drop.out }),
                ...overrides,
            },
        },
    );

    let out = "";
    let error = "";
    let done = false;
    let code: number | null = null;
    let failure: Error | undefined;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
        out += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
        error += chunk;
    });
    // 'exit' carries the code but can arrive with pipe data still in flight;
    // 'close' is the one that means the pipes are drained. So the code is
    // taken from the first and the shell counts as settled on the second,
    // and an assertion on stderr after a wait cannot read half of it.
    child.on("exit", (status) => {
        code = status;
    });
    const exit = new Promise<number | null>((resolve) => {
        child.on("close", () => {
            done = true;
            resolve(code);
        });
        // A spawn that never starts emits 'error' and neither of those two:
        // without this the wait in the finally below settles on nothing but
        // the vitest timeout, and takes the coverage drop down with it.
        child.on("error", (spawnFailure) => {
            failure = spawnFailure;
            done = true;
            resolve(code);
        });
    });
    const hardKill = setTimeout(() => child.kill("SIGKILL"), HARD_TIMEOUT_MS);
    hardKill.unref();

    try {
        return await body({
            stdout: () => out,
            stderr: () => error,
            exit,
            exited: () => done,
            signal: (name) => {
                child.kill(name);
            },
        });
    } finally {
        clearTimeout(hardKill);
        if (!done) {
            // Windows kills do not run exit hooks. EOF lets coverage flush first.
            if (drop !== undefined) child.stdin.end();
            else child.kill("SIGTERM");
        }
        const lastResort = setTimeout(() => child.kill("SIGKILL"), 2_000);
        lastResort.unref();
        await exit;
        clearTimeout(lastResort);
        if (drop !== undefined) absorbCoverage(drop);
        // Whatever the body made of a child that never ran, this is why.
        if (failure !== undefined) throw failure;
    }
}

/**
 * The three variables main.ts requires, plus the loopback bind every case
 * here uses: a test shell has no business accepting connections from the
 * network, and a wildcard bind asks the operating system to say so.
 */
function bootEnvironment(): Record<string, string> {
    return {
        WEBHOOK_SECRET: SECRET,
        REPO_OWNER: OWNER,
        REPO_NAME: REPO,
        HOST: LOOPBACK,
        XDG_STATE_HOME: state.dir,
    };
}

/**
 * The events a stream has whole lines for. A line that will not parse is
 * skipped rather than thrown on: the last one is often half-written, and
 * node's own crash output is not JSON at all.
 */
function events(text: string): Record<string, unknown>[] {
    const parsed: Record<string, unknown>[] = [];
    for (const line of text.split("\n")) {
        try {
            const event: unknown = JSON.parse(line);
            if (typeof event === "object" && event !== null) {
                parsed.push(event as Record<string, unknown>);
            }
        } catch {
            // Not a whole line, or not one of ours.
        }
    }
    return parsed;
}

/** The first event of a kind, once the child has written one. */
async function awaitEvent(shell: Shell, name: string): Promise<Record<string, unknown>> {
    return until(() => {
        const found = events(shell.stdout() + shell.stderr()).find(
            (event) => event["event"] === name,
        );
        if (found !== undefined) return found;
        if (shell.exited()) throw new Error(`the shell exited before ${name}: ${shell.stderr()}`);
        return undefined;
    }, `the ${name} event`);
}

/** A port nothing holds at the moment the child is told to take it. */
async function freePort(): Promise<number> {
    const probe = createServer();
    await new Promise<void>((resolve) => probe.listen(0, LOOPBACK, resolve));
    const { port } = probe.address() as AddressInfo;
    await new Promise<void>((resolve, reject) => {
        probe.close((failure) => (failure ? reject(failure) : resolve()));
    });
    return port;
}

/** The single event main.ts writes once the socket is actually bound. */
async function listening(shell: Shell): Promise<Record<string, unknown>> {
    return awaitEvent(shell, "startup");
}

async function post(
    port: number,
    deliveryId: string,
    body: Uint8Array<ArrayBuffer>,
    event = "issues",
): Promise<number> {
    const response = await fetch(`http://${LOOPBACK}:${String(port)}/`, {
        method: "POST",
        headers: {
            [SIGNATURE_HEADER]: signBody(SECRET, body),
            "x-github-delivery": deliveryId,
            "x-github-event": event,
        },
        body,
    });
    await response.arrayBuffer();
    return response.status;
}

/** A locked database is the child mid-commit — the answer is "not yet". */
function ifUnlocked<T>(read: () => T): T | undefined {
    try {
        return read();
    } catch (failure) {
        if (!/locked|busy/i.test(String(failure))) throw failure;
        return undefined;
    }
}

/** The completion line the child wrote for one delivery, once it has written one. */
async function completed(shell: Shell, deliveryId: string): Promise<Record<string, unknown>> {
    return until(() => {
        const found = events(shell.stdout()).find(
            (event) => event["event"] === "deliveryCompleted" && event["deliveryId"] === deliveryId,
        );
        if (found !== undefined) return found;
        if (shell.exited()) throw new Error(`the shell exited before it completed ${deliveryId}`);
        return undefined;
    }, `the completion of ${deliveryId}`);
}

/** The rows the child wrote about the fixture's issue, read from its own store file (D173). */
async function decisionRows(storeFile: string): Promise<Decision[]> {
    const store = await until(
        () => ifUnlocked(() => new Store(storeFile)),
        `the store at ${storeFile}`,
    );
    try {
        return await until(() => {
            const rows = ifUnlocked(() =>
                store.ledger.decisionsOn({ owner: OWNER, repo: REPO }, ITEM_REF),
            );
            return rows === undefined || rows.length === 0 ? undefined : rows;
        }, `decision rows in ${storeFile}`);
    } finally {
        store.close();
    }
}

/** A temporary directory holding the dry-run config and the store. */
async function withPaths<T>(
    body: (paths: { configFile: string; storeFile: string; privateKeyFile: string }) => Promise<T>,
): Promise<T> {
    const dir = mkdtempSync(join(tmpdir(), "shell-main-"));
    const configFile = join(dir, "automations.yml");
    const privateKeyFile = join(dir, "app-private-key.pem");
    writeFileSync(configFile, CONFIG);
    try {
        return await body({ configFile, privateKeyFile, storeFile: join(dir, "shell.sqlite") });
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

/** How one child's GitHub answers. */
interface FakeGitHub {
    readonly config?: string;
    /**
     * The timeline entries the item's reads answer with. The default is one
     * human label, which is what makes an ordinary delivery report
     * `newerHumanChange`; the write case passes `[]` so the ladder gets past
     * the ordering rule and reaches the applier.
     */
    readonly timeline?: readonly unknown[];
}

/**
 * A child-only fetch double: it proves live composition without network
 * access.
 *
 * The label and comment routes are STATEFUL, held in the child's own module
 * scope for the life of the process. A stateless double cannot exercise the
 * write path at all: the applier reads the item back before it gates, sends,
 * and then reads again to prove the postcondition held — so a GitHub that
 * answered the same thing before and after a write would either refuse the
 * write it was about to make or fail to confirm the one it made.
 */
function writeFetchPreload(path: string, logPath: string, github: FakeGitHub = {}): void {
    const {
        config = CONFIG,
        timeline = [
            { event: "labeled", actor: { type: "User", login: "human" }, created_at: TIMELINE_AT },
        ],
    } = github;
    const configBody = JSON.stringify({
        type: "file",
        encoding: "base64",
        content: Buffer.from(config).toString("base64"),
        sha: "0123456789abcdef0123456789abcdef01234567",
    });
    writeFileSync(
        path,
        `import { appendFileSync } from "node:fs";
const labels = new Set();
const comments = [];
let nextCommentId = 1;
const ITEM = ${JSON.stringify(`/issues/${String(ISSUE_NUMBER)}`)};
const labelList = () => [...labels].map((name) => ({ name }));
globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    const method = init.method ?? "GET";
    const headers = Object.fromEntries(new Headers(init.headers).entries());
    appendFileSync(${JSON.stringify(logPath)}, JSON.stringify({
        url,
        method,
        authorization: headers.authorization ?? null,
        body: init.body ?? null,
    }) + "\\n");
    if (url.includes(ITEM + "/labels")) {
        if (method === "POST") {
            for (const name of JSON.parse(init.body).labels) labels.add(name);
            return new Response(JSON.stringify(labelList()), { status: 200 });
        }
        if (method === "DELETE") {
            labels.delete(decodeURIComponent(url.split(ITEM + "/labels/")[1]));
            return new Response(JSON.stringify(labelList()), { status: 200 });
        }
        return new Response(JSON.stringify(labelList()), { status: 200 });
    }
    if (url.includes(ITEM + "/comments")) {
        if (method === "POST") {
            comments.push({
                id: nextCommentId++,
                body: JSON.parse(init.body).body,
                performed_via_github_app: { id: ${String(APP_ID)} },
            });
            return new Response(JSON.stringify(comments.at(-1)), { status: 201 });
        }
        return new Response(JSON.stringify(comments), { status: 200 });
    }
    if (url.includes("/timeline")) {
        return new Response(${JSON.stringify(JSON.stringify(timeline))}, { status: 200 });
    }
    if (new URL(url).pathname.endsWith(ITEM)) {
        return new Response(
            JSON.stringify({ state: "open", labels: labelList() }),
            { status: 200 },
        );
    }
    if (url.includes("/access_tokens")) {
        return new Response(JSON.stringify({
            token: "shell-test-installation-token",
            expires_at: "2099-01-01T00:00:00Z",
            permissions: { issues: "write", pull_requests: "read" },
        }), { status: 201 });
    }
    if (String(input).includes("/contents/automations.yml")) {
        return new Response(${JSON.stringify(configBody)}, { status: 200 });
    }
    if (String(input).endsWith("/graphql")) {
        return new Response(JSON.stringify({ data: { repository: {
            nameWithOwner: ${JSON.stringify(`${OWNER}/${REPO}`)},
            pullRequest: { number: 165, closingIssuesReferences: {
                nodes: [], pageInfo: { hasNextPage: false, endCursor: null },
            } },
        } } }), { status: 200 });
    }
    // The last route: anything unmatched is a timeline, as it always was.
    return new Response(${JSON.stringify(JSON.stringify(timeline))}, { status: 200 });
};
`,
    );
}

/** One line of the fetch log — what the child asked GitHub for, and how. */
interface LoggedRequest {
    readonly url: string;
    readonly method: string;
    readonly authorization: string | null;
    readonly body: string | null;
}

function requestsIn(logPath: string): LoggedRequest[] {
    return readFileSync(logPath, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as LoggedRequest);
}

/** What a live-composition case gets to look at. */
interface LiveShell {
    readonly shell: Shell;
    readonly port: number;
    readonly storeFile: string;
    readonly fetchLog: string;
}

/**
 * A child wired to App credentials and a scripted GitHub, for the duration of
 * `body`.
 *
 * A real RSA key is generated per case rather than committed: the child signs
 * a genuine App assertion with it, and a fixture key in the tree is a secret
 * shaped like a secret.
 */
async function withLiveGitHub(
    github: FakeGitHub & {
        readonly slug?: string;
        /** Arms the fact sweep, and how often it re-reads the repository. */
        readonly cadenceHours?: string;
        /** How many writes one firing may send, over the sweep's own cap. */
        readonly writeCap?: string;
        /** What share of GitHub's own limits the sweep may spend, over the sweep's own. */
        readonly share?: string;
        /** How often the reconciliation tick runs — the sweep rides it. */
        readonly tickSeconds?: string;
    },
    body: (live: LiveShell) => Promise<void>,
): Promise<void> {
    await withPaths(async ({ configFile, privateKeyFile, storeFile }) => {
        // Deliberately not the config GitHub serves: a local copy that could
        // satisfy the case would hide a live read that never happened.
        writeFileSync(configFile, "schemaVersion: 1\nmode: observe\n");
        const { privateKey } = generateKeyPairSync("rsa", {
            modulusLength: 2048,
            privateKeyEncoding: { type: "pkcs8", format: "pem" },
            publicKeyEncoding: { type: "spki", format: "pem" },
        });
        writeFileSync(privateKeyFile, privateKey);
        const fetchLog = `${privateKeyFile}.fetch.log`;
        const preload = `${privateKeyFile}.fetch.mjs`;
        writeFetchPreload(preload, fetchLog, github);
        const port = await freePort();
        await withShell(
            {
                ...bootEnvironment(),
                APP_ID,
                PRIVATE_KEY_PATH: privateKeyFile,
                INSTALLATION_ID: "789",
                CONFIG_FILE: configFile,
                STORE_PATH: storeFile,
                PORT: String(port),
                ...(github.slug === undefined ? {} : { APP_SLUG: github.slug }),
                ...(github.cadenceHours === undefined
                    ? {}
                    : { SWEEP_CADENCE_HOURS: github.cadenceHours }),
                ...(github.writeCap === undefined ? {} : { SWEEP_WRITE_CALLS: github.writeCap }),
                ...(github.share === undefined ? {} : { SWEEP_SHARE: github.share }),
                ...(github.tickSeconds === undefined ? {} : { TICK_SECONDS: github.tickSeconds }),
            },
            (shell) => body({ shell, port, storeFile, fetchLog }),
            preload,
        );
    });
}
describe("the sandbox entry point, as a process", () => {
    /**
     * One case, not one per variable: WHICH variable is missing, and every
     * other sentence the environment can earn, is the parser's table in
     * `test/shell/compose/composition.test.ts`. A spawn is needed only to
     * prove that a refusal reaches stderr and that nothing starts listening.
     */
    it(
        "fails closed and listens for nothing when a required variable is absent",
        async () => {
            const environment = bootEnvironment();
            delete environment["WEBHOOK_SECRET"];

            await withShell(environment, async (shell) => {
                await until(
                    () => (shell.exited() || shell.stdout() !== "" ? true : undefined),
                    "the shell to give up",
                );
                expect(shell.stdout()).toBe("");
                expect(await shell.exit).toBe(1);
                expect(shell.stderr().trim()).toBe(MISSING_VARIABLES);
            });
        },
        TEST_TIMEOUT_MS,
    );

    /**
     * The one refusal to boot that is not the parser's, because it is a READ:
     * the key file is opened by the live fill, after the record is in hand.
     */
    it(
        "fails closed when PRIVATE_KEY_PATH names no readable file",
        async () => {
            await withPaths(async ({ privateKeyFile }) => {
                await withShell(
                    {
                        ...bootEnvironment(),
                        APP_ID,
                        PRIVATE_KEY_PATH: privateKeyFile,
                        INSTALLATION_ID: "789",
                    },
                    async (shell) => {
                        await until(
                            () => (shell.exited() || shell.stdout() !== "" ? true : undefined),
                            "the missing private key to be refused",
                        );
                        expect(shell.stdout()).toBe("");
                        expect(await shell.exit).toBe(1);
                        expect(shell.stderr().trim()).toBe(
                            `PRIVATE_KEY_PATH could not be read: ${privateKeyFile}`,
                        );
                    },
                );
            });
        },
        TEST_TIMEOUT_MS,
    );

    /**
     * The installation is the unit a process serves (D169): GitHub delivers
     * only for repositories it covers and every payload names its own, so with
     * credentials no repository need be configured, and the line says `any`.
     */
    it(
        "boots on credentials alone, serving any repository of the installation",
        async () => {
            await withPaths(async ({ configFile, privateKeyFile, storeFile }) => {
                const { privateKey } = generateKeyPairSync("rsa", {
                    modulusLength: 2048,
                    privateKeyEncoding: { type: "pkcs8", format: "pem" },
                    publicKeyEncoding: { type: "spki", format: "pem" },
                });
                writeFileSync(privateKeyFile, privateKey);
                const environment: Record<string, string> = {
                    ...bootEnvironment(),
                    APP_ID,
                    PRIVATE_KEY_PATH: privateKeyFile,
                    INSTALLATION_ID: "789",
                    CONFIG_FILE: configFile,
                    STORE_PATH: storeFile,
                    PORT: String(await freePort()),
                };
                delete environment["REPO_OWNER"];
                delete environment["REPO_NAME"];

                await withShell(environment, async (shell) => {
                    expect(await listening(shell)).toMatchObject({
                        repository: "any (installation 789)",
                        configSource: "live",
                    });
                });
            });
        },
        TEST_TIMEOUT_MS,
    );

    /**
     * The record names the paths; making them is the start's, and on the
     * machines the default exists for — a fresh container, a volume mounted
     * empty — every segment on the way to the store is missing, not just one.
     */
    it(
        "creates the whole path to a state home that is not there yet",
        async () => {
            const home = join(state.dir, "not", "created", "yet");
            const port = await freePort();

            await withShell(
                { ...bootEnvironment(), XDG_STATE_HOME: home, PORT: String(port) },
                async (shell) => {
                    const store = join(home, "sdk-automations", "shell.sqlite");
                    expect(await listening(shell)).toMatchObject({ storePath: store });
                    expect(existsSync(store)).toBe(true);
                },
            );
        },
        TEST_TIMEOUT_MS,
    );

    it(
        "announces where it listens, then turns a signed delivery into that store's report",
        async () => {
            await withPaths(async ({ configFile, storeFile }) => {
                const port = await freePort();
                await withShell(
                    {
                        ...bootEnvironment(),
                        CONFIG_FILE: configFile,
                        STORE_PATH: storeFile,
                        PORT: String(port),
                        // The fastest tick the validation accepts, so a
                        // boot that ticked every second is proved to work.
                        TICK_SECONDS: "1",
                    },
                    async (shell) => {
                        const startup = await listening(shell);
                        expect(startup).toEqual({
                            // A real line, parsed as JSON, carrying the two
                            // fields every line carries.
                            at: expect.stringMatching(/^\d{4}-\d\d-\d\dT[\d:.]+Z$/),
                            event: "startup",
                            port,
                            host: LOOPBACK,
                            repository: `${OWNER}/${REPO}`,
                            configSource: "local",
                            configPath: configFile,
                            storePath: storeFile,
                            // No credentials, so no identity, so no applier:
                            // the shipped composition writes nothing.
                            writes: "absent",
                            // And no cadence, so it reads nothing on a clock
                            // either: this process waits to be told.
                            sweep: "absent",
                            // And it is awake: this one decides what arrives.
                            suspended: false,
                        });

                        expect(await post(port, GUID, FIXTURE)).toBe(202);
                        // The delivery's whole passage, under its own id.
                        await awaitEvent(shell, "deliveryCompleted");
                        expect(
                            events(shell.stdout())
                                .filter((event) => event["deliveryId"] === GUID)
                                .map((event) => event["event"]),
                        ).toEqual(["deliveryAccepted", "deliveryClaimed", "deliveryCompleted"]);
                        expect(await completed(shell, GUID)).toMatchObject({ kind: "decision" });
                        const decided = await decisionRows(storeFile);
                        expect(
                            decided.map((row) => [row.capability, row.verdict, row.code]),
                        ).toEqual([
                            ["intake", "info", "capabilityExplained"],
                            ["intake", "notice", "modeRecordsOnly"],
                            ["intake", "info", "wouldApply"],
                            ["intake", "info", "capabilityExplained"],
                            ["intake", "notice", "modeRecordsOnly"],
                            ["intake", "info", "wouldApply"],
                        ]);
                        // Every row names the repository this endpoint serves
                        // and the delivery that caused it.
                        expect(
                            decided.map((row) => [row.repository, row.source, row.sourceId]),
                        ).toEqual(
                            decided.map(() => [{ owner: OWNER, repo: REPO }, "webhook", GUID]),
                        );

                        // An unreadable payload names no repository, so it
                        // names no seams to read, decide or write through.
                        const bytes = Buffer.from("not json");
                        expect(await post(port, UNREADABLE_GUID, bytes)).toBe(202);
                        expect(await completed(shell, UNREADABLE_GUID)).toMatchObject({
                            kind: "repositoryMismatch",
                            detail: `expected ${OWNER}/${REPO}, observed none`,
                        });
                    },
                );
            });
        },
        TEST_TIMEOUT_MS,
    );

    /**
     * Both lanes, in the startup line and in the store: with a cadence the
     * process reads the repository on a clock, and without one it waits to be
     * told. The DELIVERY is what declares the row — it is the pass that reads
     * the configuration — and the reconciliation tick is what claims it, so the
     * `sweepFinished` line below is the whole chain in one process.
     *
     * The fake GitHub answers the open-item list with an empty array (its last
     * route is `timeline`, and this case scripts that empty), so the firing
     * decides nothing and the case stays about the WIRING rather than about a
     * ladder's judgement — which `test/shell/sweep/sweep.test.ts` owns. `SWEEP_WRITE_CALLS`
     * and `SWEEP_SHARE` ride the same wiring: accepted at boot, and barely spent
     * here, so the firing finishes the list with no cursor to keep.
     */
    it(
        "with SWEEP_CADENCE_HOURS a delivery arms a sweep row, and the tick fires it",
        async () => {
            await withLiveGitHub(
                {
                    config: SWEEP_CONFIG,
                    timeline: [],
                    cadenceHours: "24",
                    writeCap: "5",
                    share: "0.5",
                    tickSeconds: "1",
                },
                async ({ port, shell }) => {
                    expect(await listening(shell)).toMatchObject({
                        writes: "absent",
                        sweep: "armed",
                    });
                    expect(await post(port, READ_ONLY_GUID, FIXTURE)).toBe(202);

                    const finished = await awaitEvent(shell, "sweepFinished");
                    expect(finished).toMatchObject({
                        scheduleId: `sweep:${OWNER}/${REPO}`,
                        items: 0,
                        decided: 0,
                        writes: 0,
                        heldBack: 0,
                        remaining: 0,
                        resumeAfter: null,
                        reused: 0,
                        deferred: false,
                        spent: { core: 2, graphql: 0, mutations: 0 },
                    });
                },
            );
        },
        TEST_TIMEOUT_MS,
    );

    /**
     * The whole composition, end to end and in one process: an active-mode
     * delivery is decided, its approved effect is journalled, sent to the fake
     * GitHub, and read back — and the canonical record says `applied`.
     *
     * The label POST is asserted separately from the record because they prove
     * different things. The record says the applier ran and believed itself;
     * the request log says a write actually left the process, under the
     * installation token, at the endpoint the matrix confirmed.
     */
    it(
        "with APP_SLUG an active delivery reaches GitHub through the applier",
        async () => {
            await withLiveGitHub(
                { config: ACTIVE_CONFIG, timeline: [], slug: APP_SLUG },
                async ({ fetchLog, port, shell, storeFile }) => {
                    expect(await listening(shell)).toMatchObject({ writes: "armed" });
                    expect(await post(port, ACTIVE_GUID, FIXTURE)).toBe(202);

                    expect(await completed(shell, ACTIVE_GUID)).toMatchObject({
                        kind: "decision",
                    });
                    expect(await decisionRows(storeFile)).toContainEqual(
                        expect.objectContaining({
                            capability: "intake",
                            verdict: "applied",
                            code: null,
                            effectId: expect.any(String),
                        }),
                    );

                    const written = requestsIn(fetchLog).filter(
                        (request) =>
                            request.method === "POST" &&
                            request.url.includes(`/issues/${String(ISSUE_NUMBER)}/labels`),
                    );
                    expect(written).toEqual([
                        expect.objectContaining({
                            authorization: "Bearer shell-test-installation-token",
                            body: JSON.stringify({ labels: [TRIAGE_LABEL] }),
                        }),
                    ]);
                },
            );
        },
        TEST_TIMEOUT_MS,
    );

    /**
     * The switch the record carries into the shell. Suspension still verifies
     * and accepts — the 202 is what keeps P9's loss window shut — and then
     * finishes the delivery without reading or deciding anything.
     */
    it(
        "SUSPENDED=1 accepts the delivery and records it undecided",
        async () => {
            await withPaths(async ({ configFile, storeFile }) => {
                const port = await freePort();
                await withShell(
                    {
                        ...bootEnvironment(),
                        CONFIG_FILE: configFile,
                        STORE_PATH: storeFile,
                        PORT: String(port),
                        SUSPENDED: "1",
                    },
                    async (shell) => {
                        expect(await listening(shell)).toMatchObject({ suspended: true });
                        expect(await post(port, GUID, FIXTURE)).toBe(202);

                        expect(await completed(shell, GUID)).toMatchObject({
                            kind: "installationSuspended",
                        });
                    },
                );
            });
        },
        TEST_TIMEOUT_MS,
    );

    /**
     * A killed shell must not leave a claim behind: a delivery interrupted
     * mid-decision is invisible for the full stale-claim window, and the
     * point of the handler is that the process finishes what it holds and
     * says so before it goes.
     */
    it.each(["SIGTERM", "SIGINT"] as const)(
        "stops cleanly on %s, exit 0",
        async (signal) => {
            await withPaths(async ({ configFile, storeFile }) => {
                const port = await freePort();
                await withShell(
                    {
                        ...bootEnvironment(),
                        CONFIG_FILE: configFile,
                        STORE_PATH: storeFile,
                        PORT: String(port),
                    },
                    async (shell) => {
                        await listening(shell);
                        expect(await post(port, GUID, FIXTURE)).toBe(202);
                        await completed(shell, GUID);

                        // Twice: impatience is not new information, and a
                        // second shutdown would close a closed store.
                        shell.signal(signal);
                        shell.signal(signal);
                        expect(await shell.exit).toBe(0);
                        // Once, and last: the line is written after the store
                        // closed, and the exit waits behind it leaving.
                        const written = events(shell.stdout());
                        expect(written.filter((event) => event["event"] === "shutdown")).toEqual([
                            { at: expect.any(String), event: "shutdown", signal },
                        ]);
                        expect(written.at(-1)).toMatchObject({ event: "shutdown" });
                        expect(shell.stderr()).toBe("");
                    },
                );
            });
        },
        TEST_TIMEOUT_MS,
    );
});
