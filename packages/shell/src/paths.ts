/**
 * Where the shell keeps its own files when the environment names none.
 *
 * The store is operational state: a queue of undecided deliveries and a
 * journal of decided ones, with a retention period nobody has ratified yet
 * (design/guides/operations.md §6). That is what `$XDG_STATE_HOME` is for —
 * data that must survive a restart without being a library the user curates
 * — so the default is `$XDG_STATE_HOME/sdk-automations`, falling back to
 * `~/.local/state/sdk-automations` when the variable says nothing usable.
 *
 * ONE path on every platform, rather than a branch per operating system.
 * The production home is a container, where the operator mounts a volume
 * and names it with `STORE_PATH` regardless; the default only has to be
 * somewhere writable, predictable and outside the image layers. A macOS or
 * Windows operator who wants the local convention sets `XDG_STATE_HOME`,
 * which is one documented hook instead of three untested branches.
 *
 * The superseded default is here too, because the only code that still
 * cares about it is the startup warning that it exists.
 */

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Everything under the state home belongs to this deployment, not to Node. */
const DIRECTORY_NAME = "sdk-automations";

/** What the shell defaulted to before the state home: inside the package. */
export const LEGACY_DATA_DIR = fileURLToPath(new URL("../data/", import.meta.url));

/**
 * The default home for the store and the local config copy.
 *
 * A relative `XDG_STATE_HOME` is ignored rather than resolved: the spec
 * calls it invalid, and resolving it against a working directory the
 * operator did not choose would put the store somewhere different for every
 * way of starting the process.
 */
export function defaultDataDir(
    env: Readonly<Partial<Record<string, string>>> = process.env,
    home: string = homedir(),
): string {
    const stateHome = env["XDG_STATE_HOME"];
    // `isAbsolute("")` is false, so the empty name needs no clause of its
    // own: it is ignored as every other unusable value is.
    const base =
        stateHome !== undefined && isAbsolute(stateHome)
            ? stateHome
            : join(home, ".local", "state");
    return join(base, DIRECTORY_NAME);
}

/**
 * The store an operator has at the superseded default and this run will not
 * open, or `null` when there is nothing to say.
 *
 * Said once, at startup, and never acted on. A store holds undecided
 * deliveries under a claim, so a process that moved one on its way up would
 * be doing durability work nobody asked it for, at the moment it knows
 * least about what else is running. One `mv`, or one `STORE_PATH`, is the
 * operator's decision to make — this only makes sure they get to make it,
 * instead of meeting a database that looks like it lost its history.
 *
 * An explicit `STORE_PATH` says the question is already settled, and a new
 * default that already exists says the same: this run has a history of its
 * own, and the older store is behind it rather than beside it.
 *
 * The environment arrives whole, as it does for `defaultDataDir` above: which
 * variable settles the question is a fact about where the shell keeps its
 * files, and this is the file that owns those.
 */
export function strandedStore(
    {
        env,
        storePath,
    }: {
        readonly env: Readonly<Partial<Record<string, string>>>;
        readonly storePath: string;
    },
    exists: (path: string) => boolean = existsSync,
): string | null {
    if (env["STORE_PATH"] !== undefined) return null;
    const superseded = join(LEGACY_DATA_DIR, "shell.sqlite");
    return exists(superseded) && !exists(storePath) ? superseded : null;
}
