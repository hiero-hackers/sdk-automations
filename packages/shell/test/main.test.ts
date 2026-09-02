/**
 * The composition root run as the real process: `node --import tsx
 * src/main.ts`, an environment, a socket and a SQLite file. Everything
 * main.ts owns is observable from outside it. The
 * refusal to boot without its three variables, the startup event naming the
 * port and both file paths, and a signed delivery coming back as a persisted
 * report under exactly the store path that event announced.
 *
 * The mocked predecessor replaced node:fs, node:url, all three workspace
 * packages and all three sibling modules, so it could only prove that main
 * calls what main calls. Rewiring the composition would not have failed it.
 *
 * v8 attributes nothing across a spawn, so src/main.ts is excluded from
 * coverage in vitest.config.ts. The Stryker harness below forwards the
 * active mutant into the child and folds its coverage back into the parent,
 * so the process boundary does not make main.ts a mutation blind spot.
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
import {
    asDeliveryGuid,
    signBody,
    SIGNATURE_HEADER,
    type Report,
} from "@hiero-hackers/automation-core";
import { Store } from "@hiero-hackers/automation-store";
import { capture, useTempDir } from "@hiero-hackers/automation-testkit";

const SHELL_DIR = fileURLToPath(new URL("../", import.meta.url));

/**
 * Every child gets its own state home. The default store path is derived
 * from `XDG_STATE_HOME`, so a suite that left it alone would write the
 * operator's real store — and the case that boots with no `STORE_PATH` at
 * all is exactly the one that must not.
 */
const state = useTempDir("shell-main-state-");

const LOOPBACK = "127.0.0.1";
/** An address no machine owns: bindable nowhere, routable nowhere (RFC 5737). */
const UNBINDABLE = "203.0.113.1";

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
const PULL_REQUEST_FIXTURE = capture("pull_request.opened.json").bytes();
const PULL_REQUEST_GUID = "83e4273f-dd89-22f4-92bc-5da478ed1a6b";
const READ_ONLY_GUID = "83e4273f-dd89-22f4-92bc-5da478ed1a6c";
/** Seeded straight into a running child's store, where only a sweep can find it. */
const SWEPT_GUID = "83e4273f-dd89-22f4-92bc-5da478ed1a6d";

const MISSING_VARIABLES =
    "WEBHOOK_SECRET, REPO_OWNER and REPO_NAME are required (the sandbox App's secret and the repository this endpoint serves).";

const CONFIG = `schemaVersion: 1
mode: dry-run
capabilities:
  intake:
    enabled: true
    settings:
      announce: true
mappings:
  labels:
    awaitingTriage: "status: triage"
`;

const PULL_REQUEST_CONFIG = `schemaVersion: 1
mode: dry-run
capabilities:
  prQuality:
    enabled: true
`;

/** Everything main.ts reads, cleared from the inherited environment. */
const SHELL_VARIABLES = [
    "WEBHOOK_SECRET",
    "REPO_OWNER",
    "REPO_NAME",
    "CONFIG_FILE",
    "APP_ID",
    "PRIVATE_KEY_PATH",
    "INSTALLATION_ID",
    "STORE_PATH",
    "PORT",
    "HOST",
    "KILL_SWITCH",
    "SWEEP_INTERVAL_SECONDS",
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
 * Boot `src/main.ts` for the duration of `body`, then take it down.
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
            "src/main.ts",
        ],
        {
            cwd: SHELL_DIR,
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

/** Only the parts of the shell's canonical record this suite reads. */
interface StoredRecord {
    readonly kind: string;
    readonly deliveryId: string;
    readonly event: string;
    readonly report?: Report;
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

/** Poll the child's own SQLite file until its report for `deliveryId` lands. */
async function persisted(storeFile: string, deliveryId: string): Promise<StoredRecord> {
    const store = await until(
        () => ifUnlocked(() => new Store(storeFile)),
        `the store at ${storeFile}`,
    );
    try {
        return await until(
            () =>
                ifUnlocked(() => {
                    const row = store
                        .deliveryReports()
                        .find((report) => (report.deliveryId as string) === deliveryId);
                    return row === undefined
                        ? undefined
                        : (JSON.parse(row.reportJson) as StoredRecord);
                }),
            `a persisted report for ${deliveryId}`,
        );
    } finally {
        store.close();
    }
}

function codes(record: StoredRecord): string[] {
    return (record.report?.findings ?? []).map((finding) => finding.code);
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

/** How one child's GitHub answers, for the cases that need it to misbehave. */
interface FakeGitHub {
    readonly mintStatus?: number;
    readonly config?: string;
    readonly issuesPermission?: string;
    /** The timeline is the last route: anything unmatched is one. */
    readonly timelineStatus?: number;
}

/** A child-only fetch double: it proves live composition without network access. */
function writeFetchPreload(path: string, logPath: string, github: FakeGitHub = {}): void {
    const {
        mintStatus = 201,
        config = CONFIG,
        issuesPermission = "write",
        timelineStatus = 200,
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
globalThis.fetch = async (input, init = {}) => {
    const headers = Object.fromEntries(new Headers(init.headers).entries());
    appendFileSync(${JSON.stringify(logPath)}, JSON.stringify({
        url: String(input),
        method: init.method ?? "GET",
        authorization: headers.authorization ?? null,
        body: init.body ?? null,
    }) + "\\n");
    if (String(input).includes("/access_tokens")) {
        if (${String(mintStatus)} !== 201) return new Response("{}", { status: ${String(mintStatus)} });
        return new Response(JSON.stringify({
            token: "shell-test-installation-token",
            expires_at: "2099-01-01T00:00:00Z",
            permissions: { issues: ${JSON.stringify(issuesPermission)}, pull_requests: "read" },
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
    if (${String(timelineStatus)} !== 200) {
        return new Response("nope", { status: ${String(timelineStatus)} });
    }
    return new Response(JSON.stringify([{
        event: "labeled",
        actor: { type: "User", login: "human" },
        created_at: "2026-08-06T23:10:51Z",
    }]), { status: 200 });
};
`,
    );
}

describe("the sandbox entry point, as a process", () => {
    it.each(["WEBHOOK_SECRET", "REPO_OWNER", "REPO_NAME"])(
        "fails closed and listens for nothing when %s is absent",
        async (missing) => {
            const environment = bootEnvironment();
            delete environment[missing];

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

    it.each([
        { title: "APP_ID only", credentials: { APP_ID: "1" } },
        { title: "PRIVATE_KEY_PATH only", credentials: { PRIVATE_KEY_PATH: "missing.pem" } },
        { title: "INSTALLATION_ID only", credentials: { INSTALLATION_ID: "1" } },
        {
            title: "APP_ID and PRIVATE_KEY_PATH",
            credentials: { APP_ID: "1", PRIVATE_KEY_PATH: "missing.pem" },
        },
        { title: "APP_ID and INSTALLATION_ID", credentials: { APP_ID: "1", INSTALLATION_ID: "1" } },
        {
            title: "PRIVATE_KEY_PATH and INSTALLATION_ID",
            credentials: { PRIVATE_KEY_PATH: "missing.pem", INSTALLATION_ID: "1" },
        },
    ])(
        "fails closed when $title are present",
        async ({ credentials }) => {
            await withShell(
                {
                    ...bootEnvironment(),
                    ...credentials,
                },
                async (shell) => {
                    await until(
                        () => (shell.exited() || shell.stdout() !== "" ? true : undefined),
                        "the partial credential set to be refused",
                    );
                    expect(shell.stdout()).toBe("");
                    expect(await shell.exit).toBe(1);
                    expect(shell.stderr().trim()).toBe(
                        "APP_ID, PRIVATE_KEY_PATH and INSTALLATION_ID must be provided together to use live GitHub access.",
                    );
                },
            );
        },
        TEST_TIMEOUT_MS,
    );

    it.each(["0", "-1", "1.5", "soon"])(
        "fails closed when SWEEP_INTERVAL_SECONDS is %j",
        async (interval) => {
            await withShell(
                { ...bootEnvironment(), SWEEP_INTERVAL_SECONDS: interval },
                async (shell) => {
                    await until(
                        () => (shell.exited() || shell.stdout() !== "" ? true : undefined),
                        "the sweep interval to be refused",
                    );
                    expect(shell.stdout()).toBe("");
                    expect(await shell.exit).toBe(1);
                    expect(shell.stderr().trim()).toBe(
                        "SWEEP_INTERVAL_SECONDS must be a whole number of seconds, 1 or more.",
                    );
                },
            );
        },
        TEST_TIMEOUT_MS,
    );

    /**
     * `Number("nope")` is NaN, and node reads NaN as "any free port": the
     * unvalidated version bound a port nobody could predict and announced
     * it as `:NaN`. 0 is the same request spelled deliberately, and is
     * refused for the same reason — an endpoint GitHub cannot reach.
     */
    it.each(["nope", "", "0", "-1", "8790.5", "65536", " "])(
        "fails closed when PORT is %j",
        async (port) => {
            await withShell({ ...bootEnvironment(), PORT: port }, async (shell) => {
                await until(
                    () => (shell.exited() || shell.stdout() !== "" ? true : undefined),
                    "the port to be refused",
                );
                expect(shell.stdout()).toBe("");
                expect(await shell.exit).toBe(1);
                expect(shell.stderr().trim()).toBe(
                    "PORT must be a whole number between 1 and 65535.",
                );
            });
        },
        TEST_TIMEOUT_MS,
    );

    /**
     * Both ends of the range are IN it. A privileged 1 and the last port
     * 65535 are values an operator may legitimately be handed, and what
     * happens to them next is the operating system's business — a refusal
     * here would be this shell inventing a narrower range than it documents.
     */
    it.each(["1", "65535"])(
        "does not refuse PORT %j: the range includes both its ends",
        async (port) => {
            await withShell({ ...bootEnvironment(), PORT: port }, async (shell) => {
                await until(
                    () => (shell.exited() || shell.stdout() !== "" ? true : undefined),
                    "the boot to settle",
                );
                expect(shell.stderr()).not.toContain("PORT must be");
            });
        },
        TEST_TIMEOUT_MS,
    );

    /**
     * An empty HOST is a typo for absent, and node answers it by resolving
     * the empty host rather than by refusing. Whitespace is the same typo
     * with a space in it, and reads the same way.
     */
    it.each(["", "   "])(
        "fails closed when HOST is %j",
        async (host) => {
            await withShell({ ...bootEnvironment(), HOST: host }, async (shell) => {
                await until(
                    () => (shell.exited() || shell.stdout() !== "" ? true : undefined),
                    "the empty host to be refused",
                );
                expect(shell.stdout()).toBe("");
                expect(await shell.exit).toBe(1);
                expect(shell.stderr().trim()).toBe(
                    "HOST must be a host name or address, or unset to bind every interface.",
                );
            });
        },
        TEST_TIMEOUT_MS,
    );

    /**
     * An UNSET host is the unnamed bind — the one value that is not a typo
     * — so the boot has to walk past that check and reach the ones below
     * it. Proved by refusing the next variable instead of by listening: a
     * suite that bound every interface is a suite the machine asks its
     * operator about.
     */
    it(
        "reads an unset HOST as the unnamed bind and goes on to the next check",
        async () => {
            const environment = bootEnvironment();
            delete environment["HOST"];

            await withShell({ ...environment, SWEEP_INTERVAL_SECONDS: "0" }, async (shell) => {
                await until(
                    () => (shell.exited() || shell.stdout() !== "" ? true : undefined),
                    "the sweep interval to be refused",
                );
                expect(shell.stdout()).toBe("");
                expect(await shell.exit).toBe(1);
                expect(shell.stderr().trim()).toBe(
                    "SWEEP_INTERVAL_SECONDS must be a whole number of seconds, 1 or more.",
                );
            });
        },
        TEST_TIMEOUT_MS,
    );

    it(
        "fails closed when PRIVATE_KEY_PATH names no readable file",
        async () => {
            await withPaths(async ({ privateKeyFile }) => {
                await withShell(
                    {
                        ...bootEnvironment(),
                        APP_ID: "123",
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

    it.each([
        {
            title: "composes live config, externals and the linked-issue resolver",
            mintStatus: 201,
            failureText: null,
            config: PULL_REQUEST_CONFIG,
            fixture: PULL_REQUEST_FIXTURE,
            deliveryId: PULL_REQUEST_GUID,
            event: "pull_request",
            issuesPermission: "write",
            expectedCodes: ["newerHumanChange"],
        },
        {
            title: "uses live grants instead of the credential-free grant",
            mintStatus: 201,
            failureText: null,
            config: PULL_REQUEST_CONFIG,
            fixture: PULL_REQUEST_FIXTURE,
            deliveryId: READ_ONLY_GUID,
            event: "pull_request",
            issuesPermission: "read",
            expectedCodes: ["permissionMissing"],
        },
        {
            title: "does not fall back to stubs when mint fails",
            mintStatus: 401,
            failureText: "configuration unavailable",
            config: CONFIG,
            fixture: FIXTURE,
            deliveryId: GUID,
            event: "issues",
            issuesPermission: "write",
            expectedCodes: [],
        },
    ])(
        "$title",
        async ({
            mintStatus,
            failureText,
            config,
            fixture,
            deliveryId,
            event,
            issuesPermission,
            expectedCodes,
        }) => {
            await withPaths(async ({ configFile, privateKeyFile, storeFile }) => {
                writeFileSync(configFile, "schemaVersion: 1\nmode: observe\n");
                const { privateKey } = generateKeyPairSync("rsa", {
                    modulusLength: 2048,
                    privateKeyEncoding: { type: "pkcs8", format: "pem" },
                    publicKeyEncoding: { type: "spki", format: "pem" },
                });
                writeFileSync(privateKeyFile, privateKey);
                const fetchLog = `${privateKeyFile}.fetch.log`;
                const preload = `${privateKeyFile}.fetch.mjs`;
                writeFetchPreload(preload, fetchLog, { mintStatus, config, issuesPermission });
                const port = await freePort();
                await withShell(
                    {
                        ...bootEnvironment(),
                        APP_ID: "123",
                        PRIVATE_KEY_PATH: privateKeyFile,
                        INSTALLATION_ID: "789",
                        CONFIG_FILE: configFile,
                        STORE_PATH: storeFile,
                        PORT: String(port),
                    },
                    async (shell) => {
                        expect(await listening(shell)).toMatchObject({
                            event: "startup",
                            port,
                            host: LOOPBACK,
                            repository: `${OWNER}/${REPO}`,
                            configSource: "live",
                            configPath: "automations.yml",
                            storePath: storeFile,
                        });
                        expect(await post(port, deliveryId, fixture, event)).toBe(202);
                        if (failureText === null) {
                            const decided = await persisted(storeFile, deliveryId);
                            expect(decided.report?.mode).toBe("dry-run");
                            expect(codes(decided)).toEqual(expectedCodes);
                            const requests = readFileSync(fetchLog, "utf8")
                                .trim()
                                .split("\n")
                                .map(
                                    (line) =>
                                        JSON.parse(line) as {
                                            url: string;
                                            method: string;
                                            authorization: string | null;
                                        },
                                );
                            const mint = requests.find((request) =>
                                request.url.endsWith("/app/installations/789/access_tokens"),
                            );
                            const timeline = requests.find(
                                (request) =>
                                    request.method === "GET" && request.url.includes("/timeline"),
                            );
                            const config = requests.find((request) =>
                                request.url.includes("/contents/automations.yml"),
                            );
                            const graphql = requests.find((request) =>
                                request.url.endsWith("/graphql"),
                            );
                            expect(mint).toMatchObject({ method: "POST" });
                            expect(mint?.authorization).toMatch(/^Bearer [^.]+\.[^.]+\.[^.]+$/);
                            expect(timeline).toMatchObject({
                                method: "GET",
                                authorization: "Bearer shell-test-installation-token",
                            });
                            expect(config).toMatchObject({
                                method: "GET",
                                authorization: "Bearer shell-test-installation-token",
                            });
                            expect(graphql).toMatchObject({
                                method: "POST",
                                authorization: "Bearer shell-test-installation-token",
                            });
                            expect(new URL(config!.url).search).toBe("");
                        } else {
                            await until(
                                () => (shell.stderr().includes(failureText) ? true : undefined),
                                "the live read failure to release the delivery",
                            );
                            const store = new Store(storeFile);
                            try {
                                expect(store.deliveryReports()).toEqual([]);
                            } finally {
                                store.close();
                            }
                        }
                    },
                    preload,
                );
            });
        },
        TEST_TIMEOUT_MS,
    );

    /**
     * A refusal by GitHub, a nonsense body and a timeline too long to read
     * all reach a decision as the same word — "unknown" — and they need
     * different fixes. The adapter leaves the reason through a seam; this
     * is the wire that carries it to the operator, under the delivery whose
     * evidence could not be read.
     */
    it(
        "says why an ordering answer was unknown, naming the delivery that asked",
        async () => {
            await withPaths(async ({ configFile, privateKeyFile, storeFile }) => {
                writeFileSync(configFile, "schemaVersion: 1\nmode: observe\n");
                const { privateKey } = generateKeyPairSync("rsa", {
                    modulusLength: 2048,
                    privateKeyEncoding: { type: "pkcs8", format: "pem" },
                    publicKeyEncoding: { type: "spki", format: "pem" },
                });
                writeFileSync(privateKeyFile, privateKey);
                const preload = `${privateKeyFile}.fetch.mjs`;
                writeFetchPreload(preload, `${privateKeyFile}.fetch.log`, {
                    config: PULL_REQUEST_CONFIG,
                    // The timeline read is refused, so the item's ordering
                    // cannot be established from anything.
                    timelineStatus: 500,
                });
                const port = await freePort();
                await withShell(
                    {
                        ...bootEnvironment(),
                        APP_ID: "123",
                        PRIVATE_KEY_PATH: privateKeyFile,
                        INSTALLATION_ID: "789",
                        CONFIG_FILE: configFile,
                        STORE_PATH: storeFile,
                        PORT: String(port),
                    },
                    async (shell) => {
                        await listening(shell);
                        expect(
                            await post(
                                port,
                                PULL_REQUEST_GUID,
                                PULL_REQUEST_FIXTURE,
                                "pull_request",
                            ),
                        ).toBe(202);

                        expect(await awaitEvent(shell, "orderingUnknown")).toMatchObject({
                            deliveryId: PULL_REQUEST_GUID,
                            detail: expect.stringContaining("GitHub refused the read"),
                        });
                        // The refusal it explains, in the same delivery's report.
                        const decided = await persisted(storeFile, PULL_REQUEST_GUID);
                        expect(codes(decided)).toContain("humanOrderingUnknown");
                    },
                    preload,
                );
            });
        },
        TEST_TIMEOUT_MS,
    );

    /**
     * The state home is the operator's directory, and on the machines this
     * default exists for — a fresh container, a volume mounted empty — none
     * of it is there yet. Every missing segment on the way to the store is
     * this process's to create, not just the last one.
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

    /**
     * SWEEP_INTERVAL_SECONDS is seconds. A shell told to sweep hourly and
     * sweeping every few milliseconds instead looks like working software
     * — the recovery is only ever early — while running a timer against
     * the store a thousand times faster than the operator asked for.
     */
    it(
        "sweeps on the interval in SECONDS, so an hour is not four milliseconds",
        async () => {
            await withPaths(async ({ configFile, storeFile }) => {
                const port = await freePort();
                await withShell(
                    {
                        ...bootEnvironment(),
                        CONFIG_FILE: configFile,
                        STORE_PATH: storeFile,
                        PORT: String(port),
                        SWEEP_INTERVAL_SECONDS: "3600",
                    },
                    async (shell) => {
                        await listening(shell);
                        // One delivery the ordinary way, so the drain a
                        // start performs is demonstrably over before the
                        // queue below is seeded behind the child's back.
                        expect(await post(port, GUID, FIXTURE)).toBe(202);
                        await persisted(storeFile, GUID);

                        // Nothing will wake the child for this one: no
                        // webhook arrives, and the next sweep is an hour off.
                        const seeded = await until(
                            () => ifUnlocked(() => new Store(storeFile)),
                            `the store at ${storeFile}`,
                        );
                        try {
                            expect(
                                seeded.acceptDelivery({
                                    deliveryId: asDeliveryGuid(SWEPT_GUID)!,
                                    eventName: "issues",
                                    payload: FIXTURE,
                                    receivedAt: new Date().toISOString(),
                                }),
                            ).toMatchObject({ outcome: "accepted" });
                        } finally {
                            seeded.close();
                        }
                        await new Promise<void>((resolve) => {
                            setTimeout(resolve, 1_000);
                        });

                        const store = await until(
                            () => ifUnlocked(() => new Store(storeFile)),
                            `the store at ${storeFile}`,
                        );
                        try {
                            expect(
                                store.deliveryReports().map((report) => String(report.deliveryId)),
                            ).toEqual([GUID]);
                        } finally {
                            store.close();
                        }
                    },
                );
            });
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
                        // The fastest interval the validation accepts, so a
                        // boot that swept every second is proved to work.
                        SWEEP_INTERVAL_SECONDS: "1",
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
                        });

                        expect(await post(port, GUID, FIXTURE)).toBe(202);
                        // The delivery's whole passage, under its own id.
                        await awaitEvent(shell, "deliveryCompleted");
                        expect(
                            events(shell.stdout())
                                .filter((event) => event["deliveryId"] === GUID)
                                .map((event) => event["event"]),
                        ).toEqual(["deliveryAccepted", "deliveryClaimed", "deliveryCompleted"]);
                        const decided = await persisted(storeFile, GUID);
                        expect(decided).toMatchObject({
                            kind: "decision",
                            deliveryId: GUID,
                            event: "issues",
                        });
                        expect(decided.report?.mode).toBe("dry-run");
                        expect(codes(decided)).toEqual([
                            "capabilityExplained",
                            "modeRecordsOnly",
                            "capabilityExplained",
                            "modeRecordsOnly",
                        ]);

                        // An unreadable payload is the one report that has to
                        // name the repository this endpoint was started for.
                        const bytes = Buffer.from("not json");
                        expect(await post(port, UNREADABLE_GUID, bytes)).toBe(202);
                        const unreadable = await persisted(storeFile, UNREADABLE_GUID);
                        expect(codes(unreadable)).toEqual(["payloadNotObject"]);
                        expect(unreadable.report?.repository).toEqual({
                            owner: OWNER,
                            repo: REPO,
                        });
                    },
                );
            });
        },
        TEST_TIMEOUT_MS,
    );

    it(
        "KILL_SWITCH=1 reaches the decision: every write is refused as killSwitch",
        async () => {
            await withPaths(async ({ configFile, storeFile }) => {
                const port = await freePort();
                await withShell(
                    {
                        ...bootEnvironment(),
                        CONFIG_FILE: configFile,
                        STORE_PATH: storeFile,
                        PORT: String(port),
                        KILL_SWITCH: "1",
                    },
                    async (shell) => {
                        await listening(shell);
                        expect(await post(port, GUID, FIXTURE)).toBe(202);

                        const decided = await persisted(storeFile, GUID);
                        expect(decided.kind).toBe("decision");
                        expect(codes(decided)).toEqual(["killSwitch", "killSwitch"]);
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
                        await persisted(storeFile, GUID);

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

    /**
     * Why the exit is explicit rather than a hope. A handle something else
     * in the process left open — a library's timer, a socket nobody closed
     * — would keep a shut-down shell alive until the platform lost patience
     * and killed it, which is a SIGKILL in the logs for a clean stop. The
     * last line has left; the process goes.
     */
    it(
        "leaves on time even when something else is still holding the event loop",
        async () => {
            await withPaths(async ({ configFile, storeFile }) => {
                const port = await freePort();
                const lingering = `${storeFile}.lingering.mjs`;
                // Referenced on purpose: an unref'd timer would let node end
                // the process on its own, which is the thing not being tested.
                writeFileSync(lingering, "setInterval(() => undefined, 60_000);\n");

                await withShell(
                    {
                        ...bootEnvironment(),
                        CONFIG_FILE: configFile,
                        STORE_PATH: storeFile,
                        PORT: String(port),
                    },
                    async (shell) => {
                        await listening(shell);
                        shell.signal("SIGTERM");

                        expect(await shell.exit).toBe(0);
                        expect(events(shell.stdout()).at(-1)).toMatchObject({ event: "shutdown" });
                    },
                    lingering,
                );
            });
        },
        TEST_TIMEOUT_MS,
    );

    /**
     * The endpoint serves exactly one repository, and a delivery from
     * another is refused before its configuration is even read — the
     * report it would otherwise carry would name the wrong repository, and
     * the write path it will one day reach would act on it.
     */
    it(
        "refuses a delivery from a repository it was not started for",
        async () => {
            await withPaths(async ({ configFile, storeFile }) => {
                const port = await freePort();
                await withShell(
                    {
                        ...bootEnvironment(),
                        REPO_NAME: "a-repository-this-endpoint-does-not-serve",
                        CONFIG_FILE: configFile,
                        STORE_PATH: storeFile,
                        PORT: String(port),
                    },
                    async (shell) => {
                        await listening(shell);
                        expect(await post(port, GUID, FIXTURE)).toBe(202);

                        const record = await persisted(storeFile, GUID);
                        expect(record).toMatchObject({
                            kind: "repositoryMismatch",
                            deliveryId: GUID,
                            event: "issues",
                        });
                        expect(record).not.toHaveProperty("report");
                    },
                );
            });
        },
        TEST_TIMEOUT_MS,
    );

    it(
        "binds the HOST it was handed, and dies on an address this machine has not got",
        async () => {
            await withShell({ ...bootEnvironment(), HOST: UNBINDABLE }, async (shell) => {
                await until(
                    () => (shell.exited() || shell.stdout() !== "" ? true : undefined),
                    "the bind to be refused",
                );
                expect(shell.stdout()).toBe("");
                expect(shell.stderr()).toMatch(/EADDRNOTAVAIL/);
            });
        },
        TEST_TIMEOUT_MS,
    );

    /**
     * The store's default is under the operator's state home, never inside
     * this package: in a container `packages/shell/data/` is an image layer,
     * and a redeploy would take the canonical reports with it.
     */
    it(
        "with only the three required variables it takes :8790 and the state home's paths",
        async () => {
            await withShell(bootEnvironment(), async (shell) => {
                const outcome = await until(
                    () => (shell.exited() || shell.stdout() !== "" ? true : undefined),
                    "the default-port boot",
                );
                expect(outcome).toBe(true);
                // 8790 is machine-wide, and mutation runs boot several
                // sandboxes at once. A child that lost the race names the
                // port it wanted in its own error, which is the claim here.
                if (shell.exited()) {
                    expect(shell.stderr()).toMatch(/EADDRINUSE[^\n]*8790/);
                    return;
                }
                const home = join(state.dir, "sdk-automations");
                expect(await listening(shell)).toMatchObject({
                    port: 8790,
                    configSource: "local",
                    configPath: join(home, "automations.yml"),
                    storePath: join(home, "shell.sqlite"),
                });
                expect(existsSync(join(home, "shell.sqlite"))).toBe(true);
            });
        },
        TEST_TIMEOUT_MS,
    );
});
