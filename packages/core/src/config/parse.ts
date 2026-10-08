/**
 * `parseConfig` — the one entry point for an already-parsed value. The ERROR
 * order below is what a maintainer reads their mistakes in, and tests freeze it.
 */

import { DEFAULT_LABEL_MAPPINGS } from "./label-defaults.js";
import type { SettingsView } from "./spec.js";
import type { Mappings, ParseConfigOptions, RepositoryConfig } from "./schema.js";
import { err, type Checked, type ConfigResult } from "./results.js";
import {
    checkRequiredMappings,
    checkSchemaVersion,
    checkTopLevelKeys,
    isPlainObject,
    readCapabilities,
    readMappings,
    readMode,
    readPrincipals,
} from "./sections.js";

/**
 * A null-prototype record, so a key nobody set always reads `undefined`:
 * otherwise `capabilities["constructor"]` is truthy for a missing capability.
 */
export function cleanRecord<V>(
    entries: readonly (readonly [string, V])[],
): Readonly<Record<string, V>> {
    const record: Record<string, V> = Object.create(null);
    for (const [key, value] of entries) record[key] = value;
    return record;
}

/**
 * What a repository with no configuration file gets: no workflow-changing
 * writes (config-schema.md §1, §4). FINDING(config-no-config-mode) is undecided.
 */
export const NO_CONFIG: RepositoryConfig = {
    revision: "",
    schemaVersion: 2,
    mode: "observe",
    capabilities: cleanRecord([]),
    mappings: { labels: { ...DEFAULT_LABEL_MAPPINGS }, commands: {}, skills: {}, alerts: {} },
    principals: cleanRecord([]),
};

/**
 * What a settings value is allowed to NAME: the meanings this document mapped
 * and the principals it declared. `null` when either section did not parse.
 */
function namesIn(
    mappings: Checked<Mappings>,
    principals: Checked<[string, string][]>,
): SettingsView | null {
    if (!mappings.ok || !principals.ok) return null;
    const mapped = mappings.value;
    return {
        mapped: {
            labels: Object.keys(mapped.labels),
            commands: Object.keys(mapped.commands),
            skills: Object.keys(mapped.skills),
            alerts: Object.keys(mapped.alerts),
        },
        principals: principals.value.map(([name]) => name),
    };
}

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
    const mappings = readMappings(raw);
    const principals = readPrincipals(raw);
    const capabilities = readCapabilities(
        raw,
        options.knownCapabilities,
        namesIn(mappings, principals),
    );

    // §2.6 — fail closed: any error anywhere yields no configuration, whole-file (D38).
    const structural = [...checkTopLevelKeys(raw), ...checkSchemaVersion(raw)];

    /**
     * Asked only when both sections parsed. Last in the error list because it
     * is the only rule a maintainer cannot see in one section (D84).
     */
    const unmet =
        capabilities.ok && mappings.ok
            ? checkRequiredMappings(capabilities.value, mappings.value, options.knownCapabilities)
            : [];

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
            schemaVersion: 2,
            mode: mode.value,
            capabilities: cleanRecord(capabilities.value),
            mappings: mappings.value,
            principals: cleanRecord(principals.value),
        },
    };
}
