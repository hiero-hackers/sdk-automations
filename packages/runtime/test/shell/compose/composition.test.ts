/**
 * The environment, judged. Every refusal is reachable from a table of
 * environments and spelled out here word for word, because the sentence IS the
 * contract with whoever typed the variable wrong; every default and every
 * override is read off the record; and a valid environment parses, so a parser
 * that refused everything would not pass.
 */

import { describe, expect, it } from "vitest";
import { join } from "node:path";
import {
    parseComposition,
    REFUSAL,
    type Composition,
} from "../../../src/shell/compose/composition.js";
import { DEFAULT_TICK_MS } from "../../../src/shell/compose/shell.js";
import {
    SNAPSHOT_MAX_AGE_MS,
    SWEEP_SHARE,
    SWEEP_WRITE_CALLS,
} from "../../../src/shell/sweep/budgets.js";

const STATE_HOME = "/var/lib/state";
const DATA_DIR = join(STATE_HOME, "sdk-automations");
const SECRET = "composition-secret";
const OWNER = "owner-sandbox";
const REPO = "automation-sandbox";

/** The three required names and a state home, so no case reads the operator's own. */
const VALID: Readonly<Record<string, string>> = {
    WEBHOOK_SECRET: SECRET,
    REPO_OWNER: OWNER,
    REPO_NAME: REPO,
    XDG_STATE_HOME: STATE_HOME,
};

const CREDENTIALS: Readonly<Record<string, string>> = {
    APP_ID: "123",
    INSTALLATION_ID: "789",
    PRIVATE_KEY_PATH: "/keys/app.pem",
};

type Overrides = Readonly<Record<string, string | undefined>>;

function refusals(overrides: Overrides): readonly string[] {
    const parsed = parseComposition({ ...VALID, ...overrides });
    return parsed.ok ? [] : parsed.errors;
}

function composed(overrides: Overrides = {}): Composition {
    const parsed = parseComposition({ ...VALID, ...overrides });
    if (!parsed.ok) throw new Error(`refused: ${parsed.errors.join(" ")}`);
    return parsed.composition;
}

/** One environment, and the one sentence it earns. */
interface Refusal {
    readonly title: string;
    readonly env: Overrides;
    readonly sentence: string;
}

const REQUIRED =
    "WEBHOOK_SECRET is required; REPO_OWNER and REPO_NAME are required without App credentials (the repository the local file serves).";
const PARTIAL_TRIAD =
    "APP_ID, PRIVATE_KEY_PATH and INSTALLATION_ID must be provided together to use live GitHub access.";
const SLUG =
    'APP_SLUG must be the App\'s URL slug, with no surrounding spaces and no brackets — the bot login is derived from it as "<slug>[bot]".';
const SLUG_UNBACKED =
    "APP_SLUG arms the write path and needs APP_ID, PRIVATE_KEY_PATH and INSTALLATION_ID to write with.";
const PORT = "PORT must be a whole number between 1 and 65535.";
const HOST = "HOST must be a host name or address, or unset to bind every interface.";
const TICK = "TICK_SECONDS must be a whole number of seconds, 1 or more.";
const CADENCE = "SWEEP_CADENCE_HOURS must be a whole number of hours, 1 or more.";
const CADENCE_UNBACKED =
    "SWEEP_CADENCE_HOURS arms the fact sweep and needs APP_ID, PRIVATE_KEY_PATH and INSTALLATION_ID to read GitHub with.";
const WRITE_CAP = "SWEEP_WRITE_CALLS must be a whole number of calls, 1 or more.";
const SHARE = "SWEEP_SHARE must be a fraction of GitHub's own rate limit, above 0 and at most 1.";
const RETIRED =
    "SWEEP_REQUESTS and SWEEP_READ_REQUESTS are no longer read; SWEEP_SHARE says what " +
    "share of the installation's own rate limit the sweep may spend.";
const CREATION_CEILING = "CONTENT_CREATION_HOURLY must be a whole number of comments, 1 or more.";
const SNAPSHOT_AGE = "SNAPSHOT_MAX_AGE_HOURS must be a whole number of hours, 1 or more.";

const absent = (name: string): Overrides => ({ [name]: undefined });

const TABLE: readonly Refusal[] = [
    { title: "WEBHOOK_SECRET absent", env: absent("WEBHOOK_SECRET"), sentence: REQUIRED },
    { title: "REPO_OWNER absent", env: absent("REPO_OWNER"), sentence: REQUIRED },
    { title: "REPO_NAME absent", env: absent("REPO_NAME"), sentence: REQUIRED },
    { title: "WEBHOOK_SECRET empty", env: { WEBHOOK_SECRET: "" }, sentence: REQUIRED },
    {
        title: "WEBHOOK_SECRET absent with credentials",
        env: { ...CREDENTIALS, ...absent("WEBHOOK_SECRET") },
        sentence: REQUIRED,
    },
    { title: "APP_ID alone", env: { APP_ID: "1" }, sentence: PARTIAL_TRIAD },
    { title: "INSTALLATION_ID alone", env: { INSTALLATION_ID: "1" }, sentence: PARTIAL_TRIAD },
    {
        title: "PRIVATE_KEY_PATH alone",
        env: { PRIVATE_KEY_PATH: "app.pem" },
        sentence: PARTIAL_TRIAD,
    },
    {
        title: "APP_ID and INSTALLATION_ID",
        env: { APP_ID: "1", INSTALLATION_ID: "1" },
        sentence: PARTIAL_TRIAD,
    },
    {
        title: "APP_ID and PRIVATE_KEY_PATH",
        env: { APP_ID: "1", PRIVATE_KEY_PATH: "app.pem" },
        sentence: PARTIAL_TRIAD,
    },
    {
        title: "INSTALLATION_ID and PRIVATE_KEY_PATH",
        env: { INSTALLATION_ID: "1", PRIVATE_KEY_PATH: "app.pem" },
        sentence: PARTIAL_TRIAD,
    },
    { title: "APP_SLUG empty", env: { ...CREDENTIALS, APP_SLUG: "" }, sentence: SLUG },
    { title: "APP_SLUG blank", env: { ...CREDENTIALS, APP_SLUG: "   " }, sentence: SLUG },
    {
        title: "APP_SLUG already a login",
        env: { ...CREDENTIALS, APP_SLUG: "sandbox[bot]" },
        sentence: SLUG,
    },
    { title: "APP_SLUG spaced", env: { ...CREDENTIALS, APP_SLUG: " sandbox" }, sentence: SLUG },
    { title: "APP_SLUG with no triad", env: { APP_SLUG: "sandbox" }, sentence: SLUG_UNBACKED },
    { title: "PORT unreadable", env: { PORT: "nope" }, sentence: PORT },
    { title: "PORT empty", env: { PORT: "" }, sentence: PORT },
    { title: "PORT blank", env: { PORT: " " }, sentence: PORT },
    { title: "PORT zero", env: { PORT: "0" }, sentence: PORT },
    { title: "PORT negative", env: { PORT: "-1" }, sentence: PORT },
    { title: "PORT fractional", env: { PORT: "8790.5" }, sentence: PORT },
    { title: "PORT past the range", env: { PORT: "65536" }, sentence: PORT },
    { title: "HOST empty", env: { HOST: "" }, sentence: HOST },
    { title: "HOST blank", env: { HOST: "   " }, sentence: HOST },
    { title: "TICK_SECONDS zero", env: { TICK_SECONDS: "0" }, sentence: TICK },
    { title: "TICK_SECONDS negative", env: { TICK_SECONDS: "-1" }, sentence: TICK },
    { title: "TICK_SECONDS fractional", env: { TICK_SECONDS: "1.5" }, sentence: TICK },
    { title: "TICK_SECONDS unreadable", env: { TICK_SECONDS: "soon" }, sentence: TICK },
    { title: "SWEEP_CADENCE_HOURS zero", env: { SWEEP_CADENCE_HOURS: "0" }, sentence: CADENCE },
    {
        title: "SWEEP_CADENCE_HOURS negative",
        env: { SWEEP_CADENCE_HOURS: "-1" },
        sentence: CADENCE,
    },
    {
        title: "SWEEP_CADENCE_HOURS fractional",
        env: { SWEEP_CADENCE_HOURS: "1.5" },
        sentence: CADENCE,
    },
    {
        title: "SWEEP_CADENCE_HOURS unreadable",
        env: { SWEEP_CADENCE_HOURS: "daily" },
        sentence: CADENCE,
    },
    {
        title: "SWEEP_CADENCE_HOURS with no triad",
        env: { SWEEP_CADENCE_HOURS: "24" },
        sentence: CADENCE_UNBACKED,
    },
    { title: "SWEEP_WRITE_CALLS zero", env: { SWEEP_WRITE_CALLS: "0" }, sentence: WRITE_CAP },
    { title: "SWEEP_WRITE_CALLS negative", env: { SWEEP_WRITE_CALLS: "-1" }, sentence: WRITE_CAP },
    {
        title: "SWEEP_WRITE_CALLS fractional",
        env: { SWEEP_WRITE_CALLS: "1.5" },
        sentence: WRITE_CAP,
    },
    {
        title: "SWEEP_WRITE_CALLS unreadable",
        env: { SWEEP_WRITE_CALLS: "twenty" },
        sentence: WRITE_CAP,
    },
    { title: "SWEEP_SHARE zero", env: { SWEEP_SHARE: "0" }, sentence: SHARE },
    { title: "SWEEP_SHARE negative", env: { SWEEP_SHARE: "-0.4" }, sentence: SHARE },
    { title: "SWEEP_SHARE above one", env: { SWEEP_SHARE: "1.5" }, sentence: SHARE },
    { title: "SWEEP_SHARE unreadable", env: { SWEEP_SHARE: "most" }, sentence: SHARE },
    // The two retired names are refused whatever they say (D165, D192).
    { title: "SWEEP_REQUESTS at all", env: { SWEEP_REQUESTS: "2000" }, sentence: RETIRED },
    { title: "SWEEP_READ_REQUESTS at all", env: { SWEEP_READ_REQUESTS: "12" }, sentence: RETIRED },
    {
        title: "CONTENT_CREATION_HOURLY zero",
        env: { CONTENT_CREATION_HOURLY: "0" },
        sentence: CREATION_CEILING,
    },
    {
        title: "CONTENT_CREATION_HOURLY fractional",
        env: { CONTENT_CREATION_HOURLY: "1.5" },
        sentence: CREATION_CEILING,
    },
    {
        title: "CONTENT_CREATION_HOURLY unreadable",
        env: { CONTENT_CREATION_HOURLY: "four hundred" },
        sentence: CREATION_CEILING,
    },
    {
        title: "SNAPSHOT_MAX_AGE_HOURS zero",
        env: { SNAPSHOT_MAX_AGE_HOURS: "0" },
        sentence: SNAPSHOT_AGE,
    },
    {
        title: "SNAPSHOT_MAX_AGE_HOURS fractional",
        env: { SNAPSHOT_MAX_AGE_HOURS: "0.5" },
        sentence: SNAPSHOT_AGE,
    },
    {
        title: "SNAPSHOT_MAX_AGE_HOURS unreadable",
        env: { SNAPSHOT_MAX_AGE_HOURS: "a day" },
        sentence: SNAPSHOT_AGE,
    },
];

describe("an environment the composition refuses", () => {
    it.each(TABLE)("refuses $title, and says only that", ({ env, sentence }) => {
        expect(refusals(env)).toEqual([sentence]);
    });

    /** A sentence no environment in the table reaches is a sentence nobody can earn. */
    it("reaches every refusal the record declares", () => {
        expect(new Set(TABLE.map(({ sentence }) => sentence))).toEqual(
            new Set(Object.values(REFUSAL)),
        );
    });

    /**
     * The config layer's rule, which a boot obeys too: the whole environment is
     * judged, so an operator fixes every typo in one pass rather than one per run.
     */
    it("collects every refusal rather than stopping at the first", () => {
        expect(refusals({ PORT: "0", HOST: "", TICK_SECONDS: "soon" })).toEqual([PORT, HOST, TICK]);
    });
});

describe("what a process serves", () => {
    /**
     * The installation is the unit a process serves (D169): with credentials
     * GitHub delivers only for repositories it covers, and each names itself.
     * The local file cannot, so without them the two variables are required.
     */
    it("takes credentials with no repository named, and serves the installation", () => {
        const composition = composed({
            ...CREDENTIALS,
            ...absent("REPO_OWNER"),
            ...absent("REPO_NAME"),
        });

        expect(composition.repository).toBeNull();
        expect(composition.credentials).toMatchObject({ installationId: "789" });
    });

    it.each(["REPO_OWNER", "REPO_NAME"])("takes credentials with only %s named", (name) => {
        expect(composed({ ...CREDENTIALS, ...absent(name) }).repository).toBeNull();
    });

    /** The other shape: the one repository the local file serves. */
    it("names the repository when there are no credentials to serve without one", () => {
        expect(composed().repository).toEqual({ owner: OWNER, repo: REPO });
    });
});

describe("an environment the composition accepts", () => {
    it("reads the three required variables and defaults everything else", () => {
        expect(composed()).toEqual({
            endpoint: { port: 8790, host: undefined, secret: SECRET },
            repository: { owner: OWNER, repo: REPO },
            credentials: null,
            writes: null,
            sweep: null,
            contentCreationHourly: null,
            switches: { killSwitch: false, suspended: false },
            paths: {
                configFile: join(DATA_DIR, "automations.yml"),
                storeFile: join(DATA_DIR, "shell.sqlite"),
            },
            tickMs: DEFAULT_TICK_MS,
        });
    });

    it("reads every override, and arms both lanes", () => {
        expect(
            composed({
                ...CREDENTIALS,
                APP_SLUG: "hiero-hackers-sandbox",
                PORT: "9000",
                HOST: "127.0.0.1",
                CONFIG_FILE: "/etc/automations.yml",
                STORE_PATH: "/var/shell.sqlite",
                TICK_SECONDS: "5",
                SWEEP_CADENCE_HOURS: "6",
                SWEEP_WRITE_CALLS: "3",
                SWEEP_SHARE: "0.25",
                CONTENT_CREATION_HOURLY: "120",
                SNAPSHOT_MAX_AGE_HOURS: "6",
                KILL_SWITCH: "1",
                SUSPENDED: "1",
            }),
        ).toEqual({
            endpoint: { port: 9000, host: "127.0.0.1", secret: SECRET },
            repository: { owner: OWNER, repo: REPO },
            credentials: {
                appId: "123",
                installationId: "789",
                privateKeyPath: "/keys/app.pem",
            },
            writes: { appSlug: "hiero-hackers-sandbox" },
            sweep: {
                cadenceMs: 6 * 60 * 60_000,
                writeCap: 3,
                share: 0.25,
                snapshotMaxAgeMs: 6 * 60 * 60_000,
            },
            contentCreationHourly: 120,
            switches: { killSwitch: true, suspended: true },
            paths: { configFile: "/etc/automations.yml", storeFile: "/var/shell.sqlite" },
            tickMs: 5_000,
        });
    });

    /** The cap and the share arm nothing, so an armed sweep takes `budgets.ts`'s own. */
    it("arms the sweep with the bounds the sweep declares", () => {
        expect(composed({ ...CREDENTIALS, SWEEP_CADENCE_HOURS: "1" }).sweep).toEqual({
            cadenceMs: 60 * 60_000,
            writeCap: SWEEP_WRITE_CALLS,
            share: SWEEP_SHARE,
            snapshotMaxAgeMs: SNAPSHOT_MAX_AGE_MS,
        });
    });

    /** Unset leaves the ceiling to the client that enforces it (D192). */
    it("leaves the content-creation ceiling unset unless an operator names one", () => {
        expect(composed().contentCreationHourly).toBeNull();
    });

    /**
     * Both ends of the range are IN it. A privileged 1 and the last port 65535
     * are values an operator may be handed, and what the operating system makes
     * of them next is its business, not a narrower range invented here.
     */
    it.each(["1", "65535"])("takes PORT %j: the range includes both its ends", (port) => {
        expect(composed({ PORT: port }).endpoint.port).toBe(Number(port));
    });

    /** Credentials buy reads; without a slug there is no identity and no write path. */
    it("takes the triad with no slug, and arms no writes", () => {
        const composition = composed(CREDENTIALS);
        expect(composition.credentials).not.toBeNull();
        expect(composition.writes).toBeNull();
    });

    /** Two names for two files: overriding one leaves the other under the state home. */
    it("keeps CONFIG_FILE and STORE_PATH independent of each other", () => {
        expect(composed({ CONFIG_FILE: "/etc/automations.yml" }).paths).toEqual({
            configFile: "/etc/automations.yml",
            storeFile: join(DATA_DIR, "shell.sqlite"),
        });
        expect(composed({ STORE_PATH: "/var/shell.sqlite" }).paths).toEqual({
            configFile: join(DATA_DIR, "automations.yml"),
            storeFile: "/var/shell.sqlite",
        });
    });

    /** Only the exact "1" throws a switch: anything else is a value nobody meant. */
    it.each(["0", "true", "yes", ""])("reads %j as neither switch thrown", (value) => {
        expect(composed({ KILL_SWITCH: value, SUSPENDED: value }).switches).toEqual({
            killSwitch: false,
            suspended: false,
        });
    });
});
