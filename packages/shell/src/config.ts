/**
 * Where a repository's configuration lives, and how the shell obtains it.
 *
 * `automations.yml` at the repository ROOT is the decided path (D93 —
 * Q14's path half): the file configures the automation platform, not
 * GitHub, and everywhere else in the design GitHub is an adapter detail —
 * a `.github/` home would contradict that at the most user-visible spot.
 * Credential-free development and CI read an operator-maintained local
 * copy; the live adapter reads the same path from the default branch.
 */

import { readFile } from "node:fs/promises";
import {
    ABSENT_CONFIG_REVISION,
    CONFIG_PATH,
    type ConfigDocument,
    type ConfigLoadOutcome,
    type ConfigSource,
    revisionOf,
} from "@hiero-hackers/automation-core";

export {
    ABSENT_CONFIG_REVISION,
    CONFIG_PATH,
    type ConfigDocument,
    type ConfigLoadOutcome,
    type ConfigSource,
};

/**
 * Errnos no retry can outlast: the path is not a readable file, and only an
 * operator changes that. `permanent` sends them the way a defective committed
 * file goes — the delivery completes as `configRejected`, naming the problem,
 * instead of releasing the claim and asking the filesystem the same question
 * forever. Everything else (EIO, EBUSY, anything unrecognised) stays weather.
 */
const PERMANENT_READ_ERRNOS: ReadonlySet<string> = new Set([
    "EACCES",
    // Stryker disable next-line StringLiteral: no local path provokes EPERM from a read — it is listed from Node's errno set, and only an owner-level restriction reaches it.
    "EPERM",
    "EISDIR",
    "ENOTDIR",
    "ELOOP",
]);

const isPermanentReadFailure = (code: string | undefined): boolean =>
    // Stryker disable next-line ConditionalExpression: Set.has answers false for an undefined code already; the leading arm is for readers.
    code !== undefined && PERMANENT_READ_ERRNOS.has(code);

/** The credential-free source: an operator-maintained local copy. */
export function fileConfigSource(path: string): ConfigSource {
    return {
        async load(): Promise<ConfigLoadOutcome> {
            let raw: string;
            try {
                raw = await readFile(path, "utf8");
            } catch (error) {
                const code = (error as NodeJS.ErrnoException).code;
                if (code !== "ENOENT") {
                    const detail = `local config unreadable: ${(error as Error).message}`;
                    return isPermanentReadFailure(code)
                        ? { ok: false, permanent: true, detail }
                        : { ok: false, permanent: false, detail };
                }
                // ENOENT genuinely proves absence locally. An absent file and
                // an empty file agree by construction: both parse to
                // no-config's observe mode (config-schema.md §1, §4).
                return {
                    ok: true,
                    document: { revision: ABSENT_CONFIG_REVISION, text: "" },
                };
            }
            // The live source's UTF-8 decode drops a leading BOM (the WHATWG
            // default); drop it here too, so the same committed bytes yield
            // the same text and revision in every environment (D122).
            const text = raw.replace(/^\uFEFF/, "");
            return { ok: true, document: { revision: revisionOf(text), text } };
        },
    };
}
