/**
 * The shell under test: started from this checkout on a fresh store, with writes armed and no
 * sweep, read back through that store, and stopped. The lab imports only core, so the shell is
 * a child process and its store is read as a file.
 */

import { spawn } from "node:child_process";
import { once } from "node:events";
import { closeSync, copyFileSync, existsSync, mkdtempSync, openSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { Halt } from "../github.js";
import type { StoredDecision, StoredDelivery } from "./judge.js";

const RUNTIME_DIR = fileURLToPath(new URL("../../../../runtime/", import.meta.url));

const HEALTH_POLL_MS = 500;

const HEALTH_DEADLINE_MS = 60_000;

/** Inherited names the shell must not see: a person's token, and the switches this run leaves off. */
const WITHHELD = [
    "GITHUB_TOKEN",
    "GH_TOKEN",
    "SWEEP_CADENCE_HOURS",
    "SWEEP_WRITE_CALLS",
    "SWEEP_SHARE",
    "KILL_SWITCH",
    "SUSPENDED",
    "CONFIG_FILE",
] as const;

export interface ShellSettings {
    readonly appId: string;
    readonly installationId: string;
    readonly privateKeyPath: string;
    readonly appSlug: string;
    readonly owner: string;
    readonly repo: string;
    readonly secret: string;
    readonly port: number;
}

export interface Shell {
    deliveries(): StoredDelivery[];
    decisionsAbout(issue: number): StoredDecision[];
    stop(): Promise<void>;
    /** Copies the stopped process's store files into `directory`. */
    archiveInto(directory: string): void;
}

type Sleep = (ms: number) => Promise<void>;

export async function startShell(
    settings: ShellSettings,
    logPath: string,
    sleep: Sleep,
): Promise<Shell> {
    const storePath = join(mkdtempSync(join(tmpdir(), "sdk-auto-rehearsal-")), "shell.sqlite");
    const log = openSync(logPath, "a");
    const child = spawn(process.execPath, ["--import", "tsx", "src/shell/compose/main.ts"], {
        cwd: RUNTIME_DIR,
        env: environmentFor(settings, storePath),
        stdio: ["ignore", log, log],
    });
    const shell: Shell = {
        deliveries: () =>
            rowsOf(
                storePath,
                "SELECT delivery_id AS id, state FROM seen_delivery",
            ) as StoredDelivery[],
        decisionsAbout: (issue) =>
            rowsOf(
                storePath,
                "SELECT source_id AS sourceId, capability, verdict, code FROM decision " +
                    "WHERE item_kind = 'issue' AND item_number = ?",
                issue,
            ) as StoredDecision[],
        async stop() {
            if (child.exitCode === null && child.signalCode === null) {
                child.kill();
                await once(child, "exit");
            }
            closeSync(log);
        },
        archiveInto(directory) {
            // A killed process can leave committed pages in the write-ahead log.
            for (const suffix of ["", "-wal", "-shm"]) {
                const file = `${storePath}${suffix}`;
                if (existsSync(file)) copyFileSync(file, join(directory, `shell.sqlite${suffix}`));
            }
        },
    };
    for (let waited = 0; waited < HEALTH_DEADLINE_MS; waited += HEALTH_POLL_MS) {
        if (child.exitCode !== null) {
            closeSync(log);
            throw new Halt(`the shell exited with ${String(child.exitCode)}; see ${logPath}`);
        }
        if (await healthy(settings.port)) return shell;
        await sleep(HEALTH_POLL_MS);
    }
    await shell.stop();
    throw new Halt(
        `the shell was not healthy within ${String(HEALTH_DEADLINE_MS)} ms; see ${logPath}`,
    );
}

function environmentFor(settings: ShellSettings, storePath: string): NodeJS.ProcessEnv {
    const env = { ...process.env };
    for (const name of WITHHELD) delete env[name];
    return {
        ...env,
        APP_ID: settings.appId,
        INSTALLATION_ID: settings.installationId,
        PRIVATE_KEY_PATH: settings.privateKeyPath,
        APP_SLUG: settings.appSlug,
        REPO_OWNER: settings.owner,
        REPO_NAME: settings.repo,
        WEBHOOK_SECRET: settings.secret,
        PORT: String(settings.port),
        HOST: "127.0.0.1",
        STORE_PATH: storePath,
    };
}

async function healthy(port: number): Promise<boolean> {
    try {
        const response = await fetch(`http://127.0.0.1:${String(port)}/healthz`);
        return response.status === 200;
    } catch {
        return false;
    }
}

/** A read-only query against the live store; opened per read so no reader outlives its question. */
function rowsOf(storePath: string, sql: string, ...parameters: number[]): unknown[] {
    const database = new DatabaseSync(storePath, { readOnly: true });
    try {
        return database.prepare(sql).all(...parameters);
    } finally {
        database.close();
    }
}
