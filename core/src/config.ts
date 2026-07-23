/**
 * Repository configuration validation as pure logic —
 * `design/config/schema.md` §2–§4 as a strict, dependency-free validator.
 *
 * The input is a plain object (the YAML parse happens in the app shell,
 * which owns dependencies); this module owns the rules: unknown keys are
 * rejected (schema.md §2.7), everything defaults to off (§2.4), invalid
 * configuration fails closed (§2.6). Failing closed here means returning
 * errors and NO configuration object — there is no partially-valid config.
 */

import type { RepositoryMode } from "./safety.js";

export const REPOSITORY_MODES = [
    "disabled",
    "observe",
    "dry-run",
    "active",
] as const;

/** The meanings a repository may map — design/core/taxonomy.md §2. */
export const MAPPABLE_MEANINGS = [
    "awaitingTriage",
    "ready",
    "inProgress",
    "needsReview",
    "needsRevision",
    "readyToMerge",
    "blocked",
] as const;
export type MappableMeaning = (typeof MAPPABLE_MEANINGS)[number];

export interface CapabilityConfig {
    readonly enabled: boolean;
    /** Opaque to the platform; validated by the capability's own contract. */
    readonly settings: Readonly<Record<string, unknown>>;
}

export interface RepositoryConfig {
    readonly schemaVersion: 1;
    readonly mode: RepositoryMode;
    readonly capabilities: Readonly<Record<string, CapabilityConfig>>;
    readonly mappings: {
        readonly labels: Partial<Readonly<Record<MappableMeaning, string>>>;
    };
    readonly principals: Readonly<Record<string, string>>;
}

/** schema.md §2.2 — no configuration causes no workflow-changing writes. */
export const NO_CONFIG: RepositoryConfig = {
    schemaVersion: 1,
    mode: "observe",
    capabilities: {},
    mappings: { labels: {} },
    principals: {},
};

/**
 * FINDING(config-no-config-mode): schema.md §2.2 says "no configuration
 * causes no workflow-changing writes" but does not say which *mode* an
 * unconfigured repository is in. `observe` (chosen here) satisfies the rule
 * — observe never writes — while still letting operators see findings;
 * `disabled` is the stricter reading. Register decision needed; the
 * constant above makes today's assumption explicit and greppable.
 */

export type ConfigResult =
    | { readonly ok: true; readonly config: RepositoryConfig }
    | { readonly ok: false; readonly errors: readonly string[] };

export interface ParseConfigOptions {
    /**
     * The platform's registry of shipped capability names. When supplied,
     * an *enabled* capability outside the registry is a validation error;
     * a disabled unknown capability stays dormant (present, inert), so
     * removing a capability from the platform does not break configs that
     * still mention it disabled.
     *
     * FINDING(config-capability-registry-gap), experiment 6.3: without
     * this list a configuration enabling a misspelled or unshipped
     * capability passes validation silently — the maintainer believes a
     * behavior is on that does not exist. Callers that have a registry
     * must pass it; the parameter is optional only because settings are
     * contractually opaque and some callers (tests, tooling) have no
     * registry to check against.
     */
    readonly knownCapabilities?: readonly string[];
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
    return typeof v === "object" && v !== null && !Array.isArray(v);
}

const TOP_LEVEL_KEYS = new Set([
    "schemaVersion",
    "mode",
    "capabilities",
    "mappings",
    "principals",
]);

/** Strict parse of an already-YAML-parsed value. Pure; never throws. */
export function parseConfig(raw: unknown, options: ParseConfigOptions = {}): ConfigResult {
    if (raw === undefined || raw === null) {
        return { ok: true, config: NO_CONFIG };
    }
    const errors: string[] = [];
    if (!isPlainObject(raw)) {
        return { ok: false, errors: ["configuration must be a mapping"] };
    }

    for (const key of Object.keys(raw)) {
        if (!TOP_LEVEL_KEYS.has(key)) {
            errors.push(`unknown key "${key}" (unknown keys are rejected, schema.md §2.7)`);
        }
    }

    if (raw.schemaVersion !== 1) {
        errors.push(`schemaVersion must be 1, got ${JSON.stringify(raw.schemaVersion)}`);
    }

    const mode = raw.mode ?? "observe";
    if (!REPOSITORY_MODES.includes(mode as RepositoryMode)) {
        errors.push(`mode must be one of ${REPOSITORY_MODES.join(", ")}, got ${JSON.stringify(raw.mode)}`);
    }

    const capabilities: Record<string, CapabilityConfig> = {};
    if (raw.capabilities !== undefined) {
        if (!isPlainObject(raw.capabilities)) {
            errors.push("capabilities must be a mapping");
        } else {
            for (const [name, value] of Object.entries(raw.capabilities)) {
                if (!isPlainObject(value)) {
                    errors.push(`capability "${name}" must be a mapping`);
                    continue;
                }
                for (const key of Object.keys(value)) {
                    if (key !== "enabled" && key !== "settings") {
                        errors.push(`capability "${name}": unknown key "${key}"`);
                    }
                }
                // §2.4 — every capability defaults to disabled; only an
                // explicit boolean true enables ("truthy" is not consent).
                if (value.enabled !== undefined && typeof value.enabled !== "boolean") {
                    errors.push(`capability "${name}": enabled must be a boolean`);
                }
                const settings = value.settings ?? {};
                if (!isPlainObject(settings)) {
                    errors.push(`capability "${name}": settings must be a mapping`);
                    continue;
                }
                const enabled = value.enabled === true;
                if (
                    enabled &&
                    options.knownCapabilities !== undefined &&
                    !options.knownCapabilities.includes(name)
                ) {
                    errors.push(
                        `capability "${name}" is enabled but not in the platform's capability registry` +
                        ` (known: ${[...options.knownCapabilities].sort().join(", ") || "none"})`,
                    );
                }
                capabilities[name] = { enabled, settings };
            }
        }
    }

    const labels: Partial<Record<MappableMeaning, string>> = {};
    if (raw.mappings !== undefined) {
        if (!isPlainObject(raw.mappings)) {
            errors.push("mappings must be a mapping");
        } else {
            for (const key of Object.keys(raw.mappings)) {
                if (key !== "labels") errors.push(`mappings: unknown key "${key}"`);
            }
            const rawLabels = raw.mappings.labels ?? {};
            if (!isPlainObject(rawLabels)) {
                errors.push("mappings.labels must be a mapping");
            } else {
                for (const [meaning, label] of Object.entries(rawLabels)) {
                    if (!MAPPABLE_MEANINGS.includes(meaning as MappableMeaning)) {
                        errors.push(`mappings.labels: "${meaning}" is not a mappable meaning`);
                        continue;
                    }
                    if (typeof label !== "string" || label.trim() === "") {
                        errors.push(`mappings.labels.${meaning}: label must be a non-empty string`);
                        continue;
                    }
                    labels[meaning as MappableMeaning] = label;
                }
            }
        }
    }

    const principals: Record<string, string> = {};
    if (raw.principals !== undefined) {
        if (!isPlainObject(raw.principals)) {
            errors.push("principals must be a mapping");
        } else {
            for (const [key, value] of Object.entries(raw.principals)) {
                if (typeof value !== "string") {
                    errors.push(`principals.${key}: must be a string`);
                    continue;
                }
                principals[key] = value;
            }
        }
    }

    // §2.6 — fail closed: any error yields no configuration at all.
    if (errors.length > 0) return { ok: false, errors };

    return {
        ok: true,
        config: {
            schemaVersion: 1,
            mode: mode as RepositoryMode,
            capabilities,
            mappings: { labels },
            principals,
        },
    };
}
