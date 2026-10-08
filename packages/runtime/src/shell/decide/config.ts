/**
 * Where a repository's configuration lives, and how the shell obtains it.
 * `sdk-automations.yml` at the repository ROOT is the decided path (D93).
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
 * Errnos no retry can outlast: the path is not a readable file.
 * Everything else (EIO, EBUSY, anything unrecognised) stays weather.
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
                return {
                    ok: true,
                    document: { revision: ABSENT_CONFIG_REVISION, text: "" },
                };
            }
            // Drop a leading BOM as the live source's UTF-8 decode does, so the same
            // committed bytes yield the same revision in every environment (D122).
            const text = raw.replace(/^\uFEFF/, "");
            return { ok: true, document: { revision: revisionOf(text), text } };
        },
    };
}
