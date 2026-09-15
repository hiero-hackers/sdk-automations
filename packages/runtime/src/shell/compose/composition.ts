/**
 * The environment read once into one record: what this installation IS, before anything is built.
 * Pure, and it judges the whole environment — every refusal an operator has earned is collected,
 * not just the first. Nothing here opens a file, a socket or a store (D172).
 */

import { join } from "node:path";
import type { RepositoryRef } from "@hiero-hackers/automation-core";
import { defaultDataDir, storeFile } from "../paths.js";
import { DEFAULT_TICK_MS } from "./shell.js";
import { SNAPSHOT_MAX_AGE_MS, SWEEP_SHARE, SWEEP_WRITE_CALLS } from "../sweep/budgets.js";

/** The port this endpoint takes when PORT says nothing. */
const DEFAULT_PORT = 8790;

/** The refusals, word for word: a misconfigured boot has one reader, whoever typed it wrong. */
export const REFUSAL = {
    required:
        "WEBHOOK_SECRET is required; REPO_OWNER and REPO_NAME are required without App credentials (the repository the local file serves).",
    credentials:
        "APP_ID, PRIVATE_KEY_PATH and INSTALLATION_ID must be provided together to use live GitHub access.",
    slug: 'APP_SLUG must be the App\'s URL slug, with no surrounding spaces and no brackets — the bot login is derived from it as "<slug>[bot]".',
    slugUnbacked:
        "APP_SLUG arms the write path and needs APP_ID, PRIVATE_KEY_PATH and INSTALLATION_ID to write with.",
    port: "PORT must be a whole number between 1 and 65535.",
    host: "HOST must be a host name or address, or unset to bind every interface.",
    tick: "TICK_SECONDS must be a whole number of seconds, 1 or more.",
    cadence: "SWEEP_CADENCE_HOURS must be a whole number of hours, 1 or more.",
    cadenceUnbacked:
        "SWEEP_CADENCE_HOURS arms the fact sweep and needs APP_ID, PRIVATE_KEY_PATH and INSTALLATION_ID to read GitHub with.",
    writeCap: "SWEEP_WRITE_CALLS must be a whole number of calls, 1 or more.",
    share: "SWEEP_SHARE must be a fraction of GitHub's own rate limit, above 0 and at most 1.",
    requestCap:
        "SWEEP_REQUESTS and SWEEP_READ_REQUESTS are no longer read; SWEEP_SHARE says what " +
        "share of the installation's own rate limit the sweep may spend.",
    creationCeiling: "CONTENT_CREATION_HOURLY must be a whole number of comments, 1 or more.",
    snapshotAge: "SNAPSHOT_MAX_AGE_HOURS must be a whole number of hours, 1 or more.",
} as const;

/** The credential names, for the count that refuses a partial set. */
const CREDENTIAL_NAMES = ["APP_ID", "INSTALLATION_ID", "PRIVATE_KEY_PATH"];

type Environment = Readonly<Partial<Record<string, string>>>;

/** What this process authenticates as. All three or none (D93). */
export interface Credentials {
    readonly appId: string;
    readonly installationId: string;
    readonly privateKeyPath: string;
}

/** One installation, as its environment describes it — grouped as `docs/running.md` groups it. */
export interface Composition {
    readonly endpoint: {
        readonly port: number;
        readonly host: string | undefined;
        readonly secret: string;
    };
    /** The one repository the local file serves; `null` serves the whole installation (D169). */
    readonly repository: RepositoryRef | null;
    readonly credentials: Credentials | null;
    /** The App's URL slug, and the whole of what arms the write path. */
    readonly writes: { readonly appSlug: string } | null;
    /** How often repositories are read and the bounds shared by one tick. */
    readonly sweep: {
        readonly cadenceMs: number;
        readonly writeCap: number;
        /** What share of each of GitHub's pools the sweep may spend (D192). */
        readonly share: number;
        /** How long a stored read may be decided from (D193). */
        readonly snapshotMaxAgeMs: number;
    } | null;
    /** Comments both lanes may create per hour; `null` takes the adapter's own ceiling. */
    readonly contentCreationHourly: number | null;
    readonly switches: { readonly killSwitch: boolean; readonly suspended: boolean };
    readonly paths: { readonly configFile: string; readonly storeFile: string };
    readonly tickMs: number;
}

export type Parsed =
    | { readonly ok: true; readonly composition: Composition }
    | { readonly ok: false; readonly errors: readonly string[] };

/** A whole number at or above `least`; `null` is unset and `"typo"` is everything else. */
type Counted = number | null | "typo";

/** A fraction above 0 and at most 1; `null` is unset and `"typo"` is everything else. */
function fraction(raw: string | undefined): Counted {
    if (raw === undefined) return null;
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 && value <= 1 ? value : "typo";
}

/**
 * Validated rather than coerced: `Number("nope")` is NaN, and every reader downstream
 * would take that for something — a free port, a tick of no length, a firing with no bound.
 */
function counted(raw: string | undefined, least: number): Counted {
    if (raw === undefined) return null;
    const value = Number(raw);
    return Number.isInteger(value) && value >= least ? value : "typo";
}

/** The three together, or `null` for both the empty set and the partial one. */
function triad(env: Environment): Credentials | null {
    const appId = env["APP_ID"];
    const installationId = env["INSTALLATION_ID"];
    const privateKeyPath = env["PRIVATE_KEY_PATH"];
    return appId && installationId && privateKeyPath
        ? { appId, installationId, privateKeyPath }
        : null;
}

function spellsALogin(appSlug: string): boolean {
    return appSlug.trim() === appSlug && appSlug !== "" && !appSlug.includes("[");
}

export function parseComposition(env: Environment): Parsed {
    const errors: string[] = [];
    const credentials = triad(env);
    const named = CREDENTIAL_NAMES.filter((name) => env[name]);
    if (credentials === null && named.length > 0) errors.push(REFUSAL.credentials);

    // The installation names its own repositories as it delivers; a local file cannot.

    const secret = env["WEBHOOK_SECRET"];
    const owner = env["REPO_OWNER"];
    const repo = env["REPO_NAME"];
    const repository = owner && repo ? { owner, repo } : null;
    const endpoint =
        secret && (repository !== null || credentials !== null) ? { secret, repository } : null;
    if (endpoint === null) errors.push(REFUSAL.required);

    // A slug that cannot spell a login arms nothing, so it is never also unbacked.

    const appSlug = env["APP_SLUG"];
    if (appSlug !== undefined && !spellsALogin(appSlug)) errors.push(REFUSAL.slug);
    else if (appSlug !== undefined && credentials === null) errors.push(REFUSAL.slugUnbacked);

    const port = env["PORT"] === undefined ? DEFAULT_PORT : Number(env["PORT"]);
    if (!Number.isInteger(port) || port < 1 || port > 65535) errors.push(REFUSAL.port);

    // Unnamed binds the unspecified address — dual-stack, where "0.0.0.0" is IPv4 only.
    // An EMPTY name is a typo for absent, which node resolves rather than refuses.

    const host = env["HOST"];
    if (host !== undefined && host.trim() === "") errors.push(REFUSAL.host);

    const tickSeconds = counted(env["TICK_SECONDS"], 1);
    if (tickSeconds === "typo") errors.push(REFUSAL.tick);

    // The cadence arms the lane; the cap and the budget only narrow one firing of it.

    const cadenceHours = counted(env["SWEEP_CADENCE_HOURS"], 1);
    if (cadenceHours === "typo") errors.push(REFUSAL.cadence);
    else if (cadenceHours !== null && credentials === null) errors.push(REFUSAL.cadenceUnbacked);
    const cap = counted(env["SWEEP_WRITE_CALLS"], 1);
    if (cap === "typo") errors.push(REFUSAL.writeCap);
    const share = fraction(env["SWEEP_SHARE"]);
    if (share === "typo") errors.push(REFUSAL.share);
    // The two retired names are a refusal whatever they say: a set value would
    // otherwise be read by nobody and believed by the operator (D165, D192).

    if (env["SWEEP_REQUESTS"] !== undefined || env["SWEEP_READ_REQUESTS"] !== undefined) {
        errors.push(REFUSAL.requestCap);
    }
    const creations = counted(env["CONTENT_CREATION_HOURLY"], 1);
    if (creations === "typo") errors.push(REFUSAL.creationCeiling);
    const snapshotHours = counted(env["SNAPSHOT_MAX_AGE_HOURS"], 1);
    if (snapshotHours === "typo") errors.push(REFUSAL.snapshotAge);

    if (endpoint === null) return { ok: false, errors };
    if (errors.length > 0) return { ok: false, errors };
    return {
        ok: true,
        composition: {
            endpoint: { port, host, secret: endpoint.secret },
            repository: endpoint.repository,
            credentials,
            writes: appSlug === undefined ? null : { appSlug },
            sweep:
                typeof cadenceHours === "number"
                    ? {
                          cadenceMs: cadenceHours * 60 * 60_000,
                          writeCap: typeof cap === "number" ? cap : SWEEP_WRITE_CALLS,
                          share: typeof share === "number" ? share : SWEEP_SHARE,
                          snapshotMaxAgeMs:
                              typeof snapshotHours === "number"
                                  ? snapshotHours * 60 * 60_000
                                  : SNAPSHOT_MAX_AGE_MS,
                      }
                    : null,
            contentCreationHourly: typeof creations === "number" ? creations : null,
            switches: {
                killSwitch: env["KILL_SWITCH"] === "1",
                suspended: env["SUSPENDED"] === "1",
            },
            paths: {
                configFile: env["CONFIG_FILE"] ?? join(defaultDataDir(env), "automations.yml"),
                storeFile: storeFile(env),
            },
            tickMs: typeof tickSeconds === "number" ? tickSeconds * 1000 : DEFAULT_TICK_MS,
        },
    };
}
