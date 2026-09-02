/**
 * Where the store lands when nobody says. The rule this file locks is that
 * the default is somewhere the OPERATOR owns: a container that redeploys
 * replaces its image layers, and a default inside the package meant the
 * canonical reports went with them.
 */

import { describe, expect, it } from "vitest";
import { join, sep } from "node:path";
import { defaultDataDir, LEGACY_DATA_DIR, strandedStore } from "../src/paths.js";

const HOME = "/home/operator";
const SUPERSEDED = join(LEGACY_DATA_DIR, "shell.sqlite");
const NEW_STORE = "/var/lib/state/sdk-automations/shell.sqlite";

/** An `exists` seam: these paths are there, nothing else is. */
const only =
    (...present: string[]) =>
    (path: string): boolean =>
        present.includes(path);

describe("the default data directory", () => {
    it("is the state home the environment names", () => {
        expect(defaultDataDir({ XDG_STATE_HOME: "/var/lib/state" }, HOME)).toBe(
            join("/var/lib/state", "sdk-automations"),
        );
    });

    it("falls back to ~/.local/state when the environment names none", () => {
        expect(defaultDataDir({}, HOME)).toBe(join(HOME, ".local", "state", "sdk-automations"));
    });

    /**
     * The spec calls a relative XDG path invalid, and resolving one would
     * put the store somewhere different for every way of starting the
     * process — a `cd` would silently become a new, empty database.
     */
    it.each(["", "relative/state", "./state"])("ignores %j as a state home", (stateHome) => {
        expect(defaultDataDir({ XDG_STATE_HOME: stateHome }, HOME)).toBe(
            join(HOME, ".local", "state", "sdk-automations"),
        );
    });

    it("never lands inside the package, which is where a container's image ends", () => {
        expect(defaultDataDir({}, HOME).startsWith(LEGACY_DATA_DIR)).toBe(false);
        expect(LEGACY_DATA_DIR).toContain(join("packages", "shell"));
        // The superseded default is a DIRECTORY named data inside the
        // package — not the module that names it, and not the package root.
        expect(LEGACY_DATA_DIR.endsWith(`${sep}data${sep}`)).toBe(true);
    });
});

/**
 * The one case worth a word at startup: a sandbox that ran before the
 * default moved has a store this run will not open, and would otherwise
 * meet an empty database that looks like the same one, emptied.
 */
describe("the store left at the superseded default", () => {
    it("is named when the new default is about to be created empty", () => {
        expect(strandedStore({ env: {}, storePath: NEW_STORE }, only(SUPERSEDED))).toBe(SUPERSEDED);
    });

    it("is silent when STORE_PATH already settled the question", () => {
        expect(
            strandedStore(
                { env: { STORE_PATH: NEW_STORE }, storePath: NEW_STORE },
                only(SUPERSEDED),
            ),
        ).toBeNull();
    });

    it("is silent once the new default has a history of its own", () => {
        expect(
            strandedStore({ env: {}, storePath: NEW_STORE }, only(SUPERSEDED, NEW_STORE)),
        ).toBeNull();
    });

    it("is silent for the operator who never ran the old default", () => {
        expect(strandedStore({ env: {}, storePath: NEW_STORE }, only())).toBeNull();
    });
});
