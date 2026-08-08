/**
 * `parseConfig` — the one entry point, and the order a maintainer reads
 * their mistakes in.
 */

import { cleanRecord, NO_CONFIG, type ConfigResult, type ParseConfigOptions } from "./schema.js";
import {
    checkSchemaVersion,
    err,
    checkTopLevelKeys,
    isPlainObject,
    parseCapabilities,
    parseMappings,
    parseMode,
    parsePrincipals,
} from "./validate.js";

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

    const mode = parseMode(raw);
    const capabilities = parseCapabilities(raw, options.knownCapabilities);
    const mappings = parseMappings(raw);
    const principals = parsePrincipals(raw);

    /**
     * §2.6 — fail closed: any error anywhere yields no configuration at all,
     * whole-file (`FINDING(config-fail-closed-granularity)`, D38). The order
     * below is the order a maintainer reads their mistakes in, and the tests
     * freeze it: outermost problem first.
     */
    const structural = [...checkTopLevelKeys(raw), ...checkSchemaVersion(raw)];

    /**
     * One test, doing two jobs: it reports every failed section AND narrows
     * the four results, so the success path below needs no cast and no
     * unreachable guard to satisfy the compiler.
     */
    if (!mode.ok || !capabilities.ok || !mappings.ok || !principals.ok) {
        return {
            ok: false,
            errors: [
                ...structural,
                ...(mode.ok ? [] : mode.errors),
                ...(capabilities.ok ? [] : capabilities.errors),
                ...(mappings.ok ? [] : mappings.errors),
                ...(principals.ok ? [] : principals.errors),
            ],
        };
    }
    if (structural.length > 0) return { ok: false, errors: structural };

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
