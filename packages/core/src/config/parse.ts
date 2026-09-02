/**
 * `parseConfig` — the one entry point for an already-parsed value.
 *
 * The section order below is the order a maintainer reads their mistakes in,
 * outermost problem first, and the tests freeze it.
 */

import type { ParseConfigOptions, RepositoryConfig } from "./schema.js";
import { err, type ConfigResult } from "./results.js";
import {
    checkRequiredMeanings,
    checkSchemaVersion,
    checkTopLevelKeys,
    isPlainObject,
    readCapabilities,
    readMappings,
    readMode,
    readPrincipals,
} from "./sections.js";

/**
 * A null-prototype record, so a key nobody set always reads `undefined`.
 * Otherwise `capabilities["constructor"]` is truthy for a capability that
 * does not exist. `NO_CONFIG` below and `parse.ts` build every record with it.
 */
export function cleanRecord<V>(
    entries: readonly (readonly [string, V])[],
): Readonly<Record<string, V>> {
    const record: Record<string, V> = Object.create(null);
    for (const [key, value] of entries) record[key] = value;
    return record;
}

/**
 * What a repository with no configuration file gets. config-schema.md §1 and
 * §4 say no configuration causes no workflow-changing writes.
 *
 * FINDING(config-no-config-mode): the contract now records `observe`, the
 * current implementation choice.
 * `observe` obeys the rule and still shows findings. `disabled` is the
 * stricter reading. Undecided, and this constant is where the assumption sits.
 */
export const NO_CONFIG: RepositoryConfig = {
    revision: "",
    schemaVersion: 1,
    mode: "observe",
    capabilities: cleanRecord([]),
    mappings: { labels: {} },
    principals: cleanRecord([]),
};

export function parseConfig(raw: unknown, options: ParseConfigOptions): ConfigResult {
    if (raw === undefined || raw === null) {
        return { ok: true, config: { ...NO_CONFIG, revision: options.revision } };
    }
    if (!isPlainObject(raw)) {
        return {
            ok: false,
            errors: [err("notAMapping", "configuration must be a mapping", null)],
        };
    }

    const mode = readMode(raw);
    const capabilities = readCapabilities(raw, options.knownCapabilities);
    const mappings = readMappings(raw);
    const principals = readPrincipals(raw);

    // §2.6 — fail closed: any error anywhere yields no configuration at
    // all, whole-file (D38).
    const structural = [...checkTopLevelKeys(raw), ...checkSchemaVersion(raw)];

    /**
     * Whether an enabled capability's declared needs are met is a question
     * about its block AND the label table, so it is asked only when both
     * parsed. When one did not, the file is rejected anyway and an unmet-need
     * error read off a broken table would point at the wrong line.
     *
     * It comes last in the error list because it is the only rule a maintainer
     * cannot see by looking at one section (D84).
     */
    const unmet =
        capabilities.ok && mappings.ok
            ? checkRequiredMeanings(capabilities.value, mappings.value, options.knownCapabilities)
            : [];

    // One test doing two jobs: it reports every failed section and narrows
    // all four results, so the success path below needs no cast.
    if (!mode.ok || !capabilities.ok || !mappings.ok || !principals.ok) {
        return {
            ok: false,
            errors: [
                ...structural,
                ...(mode.ok ? [] : mode.errors),
                ...(capabilities.ok ? [] : capabilities.errors),
                ...(mappings.ok ? [] : mappings.errors),
                ...(principals.ok ? [] : principals.errors),
                ...unmet,
            ],
        };
    }
    if (structural.length > 0 || unmet.length > 0) {
        return { ok: false, errors: [...structural, ...unmet] };
    }

    return {
        ok: true,
        config: {
            revision: options.revision,
            schemaVersion: 1,
            mode: mode.value,
            capabilities: cleanRecord(capabilities.value),
            mappings: { labels: mappings.value },
            principals: cleanRecord(principals.value),
        },
    };
}
