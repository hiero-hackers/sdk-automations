/**
 * The section validators — one per thing a configuration document has.
 *
 * Every validator is total and independent. None throws, none short-circuits
 * another, and each returns the value it contributes alongside the problems
 * it found. So a maintainer with three mistakes is told about all three,
 * rather than made to fix them one push at a time — the humane half of D38's
 * whole-file fail-closed rule.

 * `check*` returns problems only. `read*` returns a value as well, wrapped
 * in `Checked` — see `results.ts`.
 */

import { checked, err, type Checked, type ConfigError } from "./results.js";
import { labelKey } from "./labels.js";
import {
    CAPABILITY_NAME_PATTERN,
    MAPPABLE_MEANINGS,
    REPOSITORY_MODES,
    TOP_LEVEL_KEYS,
    type AdmittedCapability,
    type CapabilityConfig,
    type MappableMeaning,
    type RepositoryMode,
} from "./schema.js";

export function isPlainObject(v: unknown): v is Record<string, unknown> {
    if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
    const prototype = Object.getPrototypeOf(v);
    return prototype === Object.prototype || prototype === null;
}

// ─── Section readers, in the order errors surface ────────────────────

const KNOWN_TOP_LEVEL = new Set<string>(TOP_LEVEL_KEYS);

/** config-schema.md §3 — unknown top-level keys are rejected, never ignored. */
export function checkTopLevelKeys(raw: Record<string, unknown>): readonly ConfigError[] {
    return Object.keys(raw)
        .filter((key) => !KNOWN_TOP_LEVEL.has(key))
        .map((key) =>
            err(
                "unknownKey",
                `unknown key "${key}" (unknown keys are rejected, config-schema.md §3)`,
                key,
            ),
        );
}

/**
 * D31's migration policy in one line: any version but 1 is rejected
 * whole. Migration tooling waits until a version 2 exists to migrate to.
 */
export function checkSchemaVersion(raw: Record<string, unknown>): readonly ConfigError[] {
    return raw.schemaVersion === 1
        ? []
        : [
              err(
                  "schemaVersionUnsupported",
                  `schemaVersion must be 1, got ${JSON.stringify(raw.schemaVersion)}`,
                  "schemaVersion",
              ),
          ];
}

/**
 * A predicate rather than an assertion. The array is widened to
 * `readonly string[]`, which is always safe; asserting the unknown value to
 * be a mode is the unsound direction.
 */
function isRepositoryMode(value: unknown): value is RepositoryMode {
    return typeof value === "string" && (REPOSITORY_MODES as readonly string[]).includes(value);
}

/**
 * An absent `mode` defaults to `observe` (§2.4). A present but empty one is
 * an error: `mode:` with no value parses to null, and choosing a mode on the
 * maintainer's behalf is the silent interpretation §2.7 rejects (D56).
 */
export function readMode(raw: Record<string, unknown>): Checked<RepositoryMode> {
    const value = Object.hasOwn(raw, "mode") ? raw.mode : "observe";
    return isRepositoryMode(value)
        ? { ok: true, value }
        : {
              ok: false,
              errors: [
                  err(
                      "modeInvalid",
                      `mode must be one of ${REPOSITORY_MODES.join(", ")}, got ${JSON.stringify(raw.mode)}`,
                      "mode",
                  ),
              ],
          };
}

/**
 * The admission list as a lookup: every admitted name, mapped to what the
 * caller said about it. A `Map` rather than a record, so a capability named
 * `constructor` is a key like any other.
 *
 * `null` is a NAME-ONLY admission — see `ParseConfigOptions`. The two checks
 * that need a declaration skip those entries; `capabilityUnknown` does not,
 * because a name is all that check ever needed.
 */
function admissionsOf(
    known: readonly (string | AdmittedCapability)[],
): Map<string, AdmittedCapability | null> {
    const admitted = new Map<string, AdmittedCapability | null>();
    for (const entry of known) {
        if (typeof entry === "string") admitted.set(entry, null);
        else admitted.set(entry.name, entry);
    }
    return admitted;
}

/**
 * Entries rather than an object: they are materialized via `cleanRecord`
 * at the end, because on a null-prototype target a key like `__proto__`
 * is an ordinary own property (plain `obj[key] = value` on a normal
 * object both pollutes the prototype and silently loses the entry).
 */
export function readCapabilities(
    raw: Record<string, unknown>,
    knownCapabilities: readonly (string | AdmittedCapability)[],
): Checked<[string, CapabilityConfig][]> {
    const entries: [string, CapabilityConfig][] = [];
    const errors: ConfigError[] = [];
    if (raw.capabilities === undefined) return { ok: true, value: entries };
    if (!isPlainObject(raw.capabilities)) {
        return {
            ok: false,
            errors: [err("notAMapping", "capabilities must be a mapping", "capabilities")],
        };
    }
    const admitted = admissionsOf(knownCapabilities);

    for (const [name, value] of Object.entries(raw.capabilities)) {
        // A key this pattern rejects can never name a shipped
        // capability (contract.ts requires the same shape), so
        // rejecting it loses nothing and closes the hostile-key
        // hole (`__proto__`, dotted paths, etc.).
        if (!CAPABILITY_NAME_PATTERN.test(name)) {
            errors.push(
                err(
                    "capabilityNameInvalid",
                    `capability name ${JSON.stringify(name)} is not a valid configuration key (camelCase)`,
                    `capabilities.${name}`,
                ),
            );
            continue;
        }
        if (!isPlainObject(value)) {
            errors.push(
                err(
                    "notAMapping",
                    `capability "${name}" must be a mapping`,
                    `capabilities.${name}`,
                ),
            );
            continue;
        }
        for (const key of Object.keys(value)) {
            if (key !== "enabled" && key !== "settings") {
                errors.push(
                    err(
                        "unknownKey",
                        `capability "${name}": unknown key "${key}"`,
                        `capabilities.${name}.${key}`,
                    ),
                );
            }
        }
        // §2.4 — every capability defaults to disabled; only an
        // explicit boolean true enables ("truthy" is not consent).
        if (value.enabled !== undefined && typeof value.enabled !== "boolean") {
            errors.push(
                err(
                    "capabilityEnabledNotBoolean",
                    `capability "${name}": enabled must be a boolean`,
                    `capabilities.${name}.enabled`,
                ),
            );
        }
        const settings = value.settings ?? {};
        if (!isPlainObject(settings)) {
            errors.push(
                err(
                    "notAMapping",
                    `capability "${name}": settings must be a mapping`,
                    `capabilities.${name}.settings`,
                ),
            );
            continue;
        }
        const enabled = value.enabled === true;
        if (!admitted.has(name)) {
            errors.push(
                err(
                    "capabilityUnknown",
                    `capability "${name}" is not available in this application` +
                        ` (available: ${[...admitted.keys()].sort().join(", ") || "none"})`,
                    `capabilities.${name}`,
                ),
            );
        }
        /**
         * D84 — a settings key the capability never declared configures
         * nothing. `projectCapabilityView` drops it silently, so `annouce:`
         * used to be a working file that did the opposite of what it said.
         * `unknownKey` rather than a code of its own: the declared keys ARE
         * the schema for this block, and the maintainer's fix is the same
         * one every other unknown key asks for.
         *
         * Disabled blocks are checked too. A typo that waits for the day
         * somebody flips `enabled` is the surprise this rule exists to end.
         */
        const declared = admitted.get(name) ?? null;
        if (declared !== null) {
            for (const key of Object.keys(settings)) {
                if (!declared.configKeys.includes(key)) {
                    errors.push(
                        err(
                            "unknownKey",
                            `capability "${name}": unknown setting "${key}"` +
                                ` (it declares: ${[...declared.configKeys].sort().join(", ") || "no settings"})`,
                            `capabilities.${name}.settings.${key}`,
                        ),
                    );
                }
            }
        }
        entries.push([name, { enabled, settings }]);
    }
    return checked(entries, errors);
}

/**
 * Label mappings are fully injective, and uniqueness is judged the way GitHub
 * judges it — case- and edge-whitespace-insensitively, so `status: ready` and
 * `Status: Ready` are one label and cannot map two meanings
 * (`FINDING(config-label-injectivity)` D34, `FINDING(config-label-case)` D55).
 * The original spelling is preserved for writes; only the uniqueness key folds.
 */
export function readMappings(
    raw: Record<string, unknown>,
): Checked<Partial<Record<MappableMeaning, string>>> {
    const labels: Partial<Record<MappableMeaning, string>> = {};
    const errors: ConfigError[] = [];
    if (raw.mappings === undefined) return { ok: true, value: labels };
    if (!isPlainObject(raw.mappings)) {
        return {
            ok: false,
            errors: [err("notAMapping", "mappings must be a mapping", "mappings")],
        };
    }

    for (const key of Object.keys(raw.mappings)) {
        if (key !== "labels")
            errors.push(err("unknownKey", `mappings: unknown key "${key}"`, `mappings.${key}`));
    }
    const rawLabels = raw.mappings.labels ?? {};
    if (!isPlainObject(rawLabels)) {
        errors.push(err("notAMapping", "mappings.labels must be a mapping", "mappings.labels"));
        return checked(labels, errors);
    }

    const labelOwner = new Map<string, { meaning: string; label: string }>();
    for (const [meaning, label] of Object.entries(rawLabels)) {
        if (!MAPPABLE_MEANINGS.includes(meaning as MappableMeaning)) {
            errors.push(
                err(
                    "meaningNotMappable",
                    `mappings.labels: "${meaning}" is not a mappable meaning`,
                    `mappings.labels.${meaning}`,
                ),
            );
            continue;
        }
        if (typeof label !== "string" || label.trim() === "") {
            errors.push(
                err(
                    "labelInvalid",
                    `mappings.labels.${meaning}: label must be a non-empty string`,
                    `mappings.labels.${meaning}`,
                ),
            );
            continue;
        }
        const key = labelKey(label);
        const owner = labelOwner.get(key);
        if (owner !== undefined) {
            const sameSpelling = owner.label === label;
            errors.push(
                err(
                    "labelNotInjective",
                    `mappings.labels: label ${JSON.stringify(label)} is mapped to both "${owner.meaning}" and "${meaning}"` +
                        (sameSpelling
                            ? ""
                            : ` (differing only in case or surrounding space from ${JSON.stringify(owner.label)}, which GitHub treats as the same label)`) +
                        ` — label mappings must be injective (config-schema.md §3)`,
                    `mappings.labels.${meaning}`,
                ),
            );
            continue;
        }
        labelOwner.set(key, { meaning, label });
        labels[meaning as MappableMeaning] = label;
    }
    return checked(labels, errors);
}

export function readPrincipals(raw: Record<string, unknown>): Checked<[string, string][]> {
    const entries: [string, string][] = [];
    const errors: ConfigError[] = [];
    if (raw.principals === undefined) return { ok: true, value: entries };
    if (!isPlainObject(raw.principals)) {
        return {
            ok: false,
            errors: [err("notAMapping", "principals must be a mapping", "principals")],
        };
    }
    for (const [key, value] of Object.entries(raw.principals)) {
        if (typeof value !== "string") {
            errors.push(
                err(
                    "principalNotAString",
                    `principals.${key}: must be a string`,
                    `principals.${key}`,
                ),
            );
            continue;
        }
        entries.push([key, value]);
    }
    return checked(entries, errors);
}

// ─── The one cross-section rule ──────────────────────────────────────

/**
 * D84 — an ENABLED capability may not be missing a meaning it declares it
 * needs. Before this, such a repository parsed clean and the capability
 * skipped itself at runtime, saying so only in a report nobody reads until
 * they wonder why nothing happened.
 *
 * Disabled capabilities demand nothing: a block kept for later is not a
 * promise to run today, and rejecting one would make `enabled: false` harder
 * to write than deleting it.
 *
 * The only check that reads two sections, which is why it is a `check*`
 * called from `parse.ts` rather than part of either — see that file for when.
 */
export function checkRequiredMeanings(
    capabilities: readonly (readonly [string, CapabilityConfig])[],
    labels: Partial<Record<MappableMeaning, string>>,
    knownCapabilities: readonly (string | AdmittedCapability)[],
): readonly ConfigError[] {
    const admitted = admissionsOf(knownCapabilities);
    const errors: ConfigError[] = [];

    for (const [name, block] of capabilities) {
        const declared = admitted.get(name) ?? null;
        if (!block.enabled || declared === null) continue;
        for (const meaning of declared.requiredMeanings) {
            if (labels[meaning] !== undefined) continue;
            errors.push(
                err(
                    "meaningRequired",
                    `capability "${name}" is enabled but requires the meaning "${meaning}", which this repository has not mapped` +
                        ` — add mappings.labels.${meaning}, or set capabilities.${name}.enabled to false`,
                    `mappings.labels.${meaning}`,
                ),
            );
        }
    }
    return errors;
}
