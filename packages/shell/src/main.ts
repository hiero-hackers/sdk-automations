/**
 * The sandbox-era entry point: environment in, listening shell out.
 *
 * The probes are wired as the capabilities because they are the
 * capabilities that exist; production capabilities replace this ONE
 * import, not the shell. Everything else is env-driven, with the user's
 * state home (`paths.ts`) as the default home for the store and the config
 * copy.
 *
 * The refusals below are the one thing here that is NOT structured: a
 * misconfigured boot has no delivery to correlate, no process to correlate
 * it with, and one reader — the person who just typed the variable wrong.
 * A JSON object about their typo would be a worse answer to it, so the
 * fail-closed writes stay human sentences and every line after the process
 * is alive goes through the log.
 *
 * Run:
 *   WEBHOOK_SECRET=… REPO_OWNER=… REPO_NAME=… pnpm --filter @hiero-hackers/automation-shell start
 */

import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { toEngine } from "@hiero-hackers/automation-core";
import { Store } from "@hiero-hackers/automation-store";
import { inactivity, intake, prQuality } from "@hiero-hackers/automation-probes";
import {
    createGitHubHttpClient,
    createTokenSource,
    githubConfigSource,
    githubMintInstallationToken,
    liveExternalsForDelivery,
} from "@hiero-hackers/automation-adapter";
import { createShell, DEFAULT_SWEEP_INTERVAL_MS } from "./shell.js";
import { CONFIG_PATH, fileConfigSource, type ConfigSource } from "./config.js";
import { stubbedExternals, type ExternalsForDelivery } from "./externals.js";
import { createLogger, detailOf } from "./log.js";
import { defaultDataDir, strandedStore } from "./paths.js";
import { createShutdown } from "./shutdown.js";

/** The port this endpoint takes when PORT says nothing. */
const DEFAULT_PORT = 8790;

const env = process.env;
const secret = env["WEBHOOK_SECRET"];
const owner = env["REPO_OWNER"];
const repo = env["REPO_NAME"];
if (!secret || !owner || !repo) {
    console.error(
        "WEBHOOK_SECRET, REPO_OWNER and REPO_NAME are required (the sandbox App's secret and the repository this endpoint serves).",
    );
    process.exit(1);
}

// D93: no credentials selects CI stubs; partial credentials are an error.
const appId = env["APP_ID"];
const installationId = env["INSTALLATION_ID"];
const privateKeyPath = env["PRIVATE_KEY_PATH"];
const credentialCount = [appId, privateKeyPath, installationId].filter(Boolean).length;
if (credentialCount !== 0 && credentialCount !== 3) {
    console.error(
        "APP_ID, PRIVATE_KEY_PATH and INSTALLATION_ID must be provided together to use live GitHub access.",
    );
    process.exit(1);
}

const dataDir = defaultDataDir(env);
mkdirSync(dataDir, { recursive: true });
const configFile = env["CONFIG_FILE"] ?? join(dataDir, "automations.yml");
const storeFile = env["STORE_PATH"] ?? join(dataDir, "shell.sqlite");

const stranded = strandedStore({ env, storePath: storeFile });
// Validated rather than coerced, like the interval below: `Number("nope")`
// is NaN, which node reads as "any free port" — so a typo would bind a
// port nobody can find and announce it as `:NaN`.
const port = env["PORT"] === undefined ? DEFAULT_PORT : Number(env["PORT"]);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error("PORT must be a whole number between 1 and 65535.");
    process.exit(1);
}

// Unnamed by default, which is what binds the unspecified address —
// dual-stack on an IPv6-capable host, where "0.0.0.0" would be IPv4 only.
// A test or a sandbox names the loopback. An EMPTY name is the one value
// that means neither: it is a typo for absent, and node answers it by
// resolving the empty host rather than by refusing.
const host = env["HOST"];
if (host !== undefined && host.trim() === "") {
    console.error("HOST must be a host name or address, or unset to bind every interface.");
    process.exit(1);
}

// How often stale claims are requeued and the queue re-drained. Validated
// rather than coerced: a mistyped interval that silently became a 0ms tick
// or a NaN one would take out the recovery this exists to provide.
const sweepSeconds =
    env["SWEEP_INTERVAL_SECONDS"] === undefined
        ? DEFAULT_SWEEP_INTERVAL_MS / 1000
        : Number(env["SWEEP_INTERVAL_SECONDS"]);
if (!Number.isInteger(sweepSeconds) || sweepSeconds < 1) {
    console.error("SWEEP_INTERVAL_SECONDS must be a whole number of seconds, 1 or more.");
    process.exit(1);
}

const killSwitchActive = env["KILL_SWITCH"] === "1";
const repository = { owner, repo };
/** Everything past the last refusal above says what it did, in JSON. */
const log = createLogger();

interface LiveGitHub {
    readonly configSource: ConfigSource;
    readonly externals: ExternalsForDelivery;
}

function liveGitHub({
    appId,
    installationId,
    privateKeyPath,
}: {
    appId: string;
    installationId: string;
    privateKeyPath: string;
}): LiveGitHub {
    let privateKeyPem: string;
    try {
        // Stryker disable next-line StringLiteral: an emptied encoding yields the same PEM as a Buffer, which node's signer accepts identically — the mutant is equivalent.
        privateKeyPem = readFileSync(privateKeyPath, "utf8");
    } catch {
        console.error(`PRIVATE_KEY_PATH could not be read: ${privateKeyPath}`);
        process.exit(1);
    }
    const tokenSource = createTokenSource({
        credentials: { appId, installationId, privateKeyPem },
        mint: githubMintInstallationToken(),
        clock: () => new Date(),
    });
    const http = createGitHubHttpClient({ tokenSource });
    return {
        configSource: githubConfigSource({ client: http, repository }),
        // One call per delivery, so the seam below is bound to exactly the
        // delivery whose evidence it is explaining.
        externals: async ({ payload, deliveryId }) => {
            const outcome = await liveExternalsForDelivery(
                {
                    tokenSource,
                    http,
                    repository,
                    onUnknownOrdering: (detail) => {
                        log({ event: "orderingUnknown", deliveryId, detail });
                    },
                },
                payload,
            );
            // Real, and not provokable from a test: one token source feeds
            // both this and the config source above, the config read always
            // runs first, and a token minted in the last minute is served
            // whatever its expiry says (the adapter's mint floor). So every
            // way of breaking the token reaches the operator as
            // "configuration unavailable" long before it reaches here — the
            // production case this guards is a token that dies BETWEEN the
            // two reads, which is hours of running, not a suite.
            // Stryker disable next-line all: see above — no arrangement of the composition lets a test reach this branch; the config read fails on the same token first.
            if (!outcome.ok) {
                // Stryker disable next-line all: as above.
                throw new Error(`live externals unavailable: ${outcome.failure.kind}`);
            }
            return { killSwitchActive, ...outcome.facts };
        },
    };
}

// The count above already refused every partial set, so by here the three
// are present together or absent together and no combination of these
// operators can disagree; they are what narrows the three types.
const live =
    // Stryker disable next-line ConditionalExpression,LogicalOperator: see above — all three are present or none is, so every rearrangement of the conjunction answers the same.
    appId && installationId && privateKeyPath
        ? liveGitHub({ appId, installationId, privateKeyPath })
        : null;
const configSource = live?.configSource ?? fileConfigSource(configFile);
const externals = live?.externals ?? (() => stubbedExternals({ killSwitchActive }));

// The judgement is `strandedStore`, unit-tested in paths.test.ts against an
// injected `exists`. This branch is not: it runs only where the superseded
// default really holds a store, and that file is the operator's own sandbox
// state — untracked, absent in CI, and not something a test may conjure to
// watch a line get written.
// Stryker disable next-line all: reachable only by creating the operator's real store at the superseded default; the judgement behind it is covered in paths.test.ts.
if (stranded !== null) {
    // Stryker disable next-line all: as above — unreachable without writing packages/shell/data/shell.sqlite.
    log({ event: "legacyStoreFound", legacyPath: stranded, storePath: storeFile });
}
const store = new Store(storeFile);
const shell = createShell({
    secret,
    store,
    capabilities: [toEngine(intake), toEngine(prQuality), toEngine(inactivity)],
    configSource,
    externals,
    repository,
    sweepIntervalMs: sweepSeconds * 1000,
    log,
});

// Start recovering anything a previous run left pending before listening.
void shell.drain().catch((error: unknown) => {
    log({ event: "drainFailed", phase: "startup", detail: detailOf(error) });
});
// An undefined host is the unnamed case: node reads it as no host at all.
shell.server.listen(port, host, () => {
    log({
        event: "startup",
        port,
        host: host ?? null,
        repository: `${owner}/${repo}`,
        configSource: live === null ? "local" : "live",
        // Which file, either way: the local copy's path, or the path read
        // from the default branch of the repository named above.
        configPath: live === null ? configFile : CONFIG_PATH,
        storePath: storeFile,
    });
});

/** The order that loses nothing lives in `shutdown.ts`; this is its wiring. */
const shutdown = createShutdown({
    server: shell.server,
    stopSweep: shell.stopSweep,
    settled: shell.settled,
    store,
    log,
    out: process.stdout,
    exit: () => process.exit(0),
});
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
