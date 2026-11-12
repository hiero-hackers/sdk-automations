/**
 * `pnpm simulate <config-file> <issue-or-pull-url>`: prints what each capability would decide
 * about that item under that file, and why. Reads with `GITHUB_TOKEN`; writes nothing.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderSummary } from "../../observe/summary.js";
import { runStore } from "./run.js";
import { itemOfUrl, simulate } from "./simulate.js";

const USAGE = "usage: simulate <config-file> <https://github.com/owner/repo/(issues|pull)/n>";

function refuse(message: string): never {
    console.error(message);
    process.exit(1);
}

// pnpm hands the `--` separator through to the script.
const [configPath, url, ...extra] = process.argv.slice(2).filter((arg) => arg !== "--");
if (configPath === undefined || url === undefined || extra.length > 0) refuse(USAGE);
const target = itemOfUrl(url) ?? refuse(`not an issue or pull request URL: ${url}\n${USAGE}`);
const token = process.env["GITHUB_TOKEN"] ?? "";
if (token === "") refuse("GITHUB_TOKEN is not set: a read-only token is enough");
let configText: string;
try {
    // pnpm runs a filtered script in the package directory and names the caller's in INIT_CWD.
    const path = resolve(process.env["INIT_CWD"] ?? ".", configPath);
    configText = readFileSync(path, "utf8").replace(/^\uFEFF/, "");
} catch (error) {
    refuse(`the configuration file could not be read: ${(error as Error).message}`);
}

const store = runStore();
try {
    const simulated = await simulate(target, configText, { store, token, log: () => undefined });
    if (!simulated.ok) refuse(`the item could not be read: ${simulated.detail}`);
    console.log(renderSummary(store, simulated.run, simulated.outcome));
    process.exitCode = simulated.outcome.exitCode;
} finally {
    store.close();
}
