/**
 * The section validators — one per thing a configuration document has.
 *
 * Every validator is total and independent: none throws, none short-circuits
 * another, and each returns the value it contributes alongside the problems
 * it found. A maintainer with three mistakes is told about all three rather
 * than made to fix them one push at a time, which is the humane half of
 * D38's whole-file fail-closed rule.
 */

import type { ConfigError, ConfigErrorCode } from "./schema.js";
import { labelKey } from "./mappings.js";
import {
    CAPABILITY_NAME_PATTERN,
    MAPPABLE_MEANINGS,
    REPOSITORY_MODES,
    TOP_LEVEL_KEYS,
    type CapabilityConfig,
    type MappableMeaning,
    type RepositoryMode,
} from "./schema.js";

export function isPlainObject(v: unknown): v is Record<string, unknown> {
    if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
    const prototype = Object.getPrototypeOf(v);
    return prototype === Object.prototype || prototype === null;
}

const KNOWN_TOP_LEVEL = new Set<string>(TOP_LEVEL_KEYS);

/**
 * One configuration section's outcome: the value it contributes, and the
 * problems it found. Sections never throw and never short-circuit each
 * other — a maintainer with three mistakes should be told about all
 * three, not made to fix them one push at a time.
 */
/**
 * A section's outcome. A value exists only when the section is VALID — which
 * is the whole point of the shape.
 *
 * The predecessor returned `{ value, errors }` and always populated both, so a
 * reader had to carry a non-local invariant: this value only means anything if
 * the GLOBAL error list is empty. `parseCapabilities` could do complete, correct
 * work on six capabilities and have it discarded because `principals` had a typo.
 *
 * Splitting into a validate pass and a build pass was the other candidate and
 * was rejected: the builder would assume exactly what the checker guarantees,
 * with nothing tying them together — the same "two things free to disagree"
 * defect this package spent D53, D62, D67, D73, D76 and D77 removing.
 */
export type Checked<T> =
    | { readonly ok: true; readonly value: T }
    | { readonly ok: false; readonly errors: readonly ConfigError[] };

/** Fold a section's accumulated errors into a result. */
function checked<T>(value: T, errors: readonly ConfigError[]): Checked<T> {
    return errors.length > 0 ? { ok: false, errors } : { ok: true, value };
}

/** One constructor, so every error is shaped the same way. */
export function err(
    code: ConfigErrorCode,
    message: string,
    path: string | null = null,
): ConfigError {
    return { code, message, path };
}

/** schema.md §2.7 — unknown top-level keys are rejected, never ignored. */
export function checkTopLevelKeys(raw: Record<string, unknown>): readonly ConfigError[] {
    return Object.keys(raw)
        .filter((key) => !KNOWN_TOP_LEVEL.has(key))
        .map((key) =>
            err(
                "unknownKey",
                `unknown key "${key}" (unknown keys are rejected, schema.md §2.7)`,
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
 * An ABSENT `mode` defaults to `observe` (§2.4, defaults are off);
 * a PRESENT but empty one is an error.
 *
 * FINDING(config-null-mode), D56: `raw.mode ?? "observe"` silently
 * accepted `mode:` with no value — YAML parses that to null — and
 * chose a mode on the maintainer's behalf. The chosen mode was the
 * safe one, but silently interpreting malformed input is the exact
 * pattern §2.7 and D38 reject everywhere else in this file.
 */
/**
 * A type predicate, so the narrowing is sound in the direction that matters.
 *
 * The array is WIDENED to `readonly string[]` — always safe — rather than the
 * unknown value being asserted to be a mode, which is the unsound direction
 * and was how this file used to do it.
 */
function isRepositoryMode(value: unknown): value is RepositoryMode {
    return typeof value === "string" && (REPOSITORY_MODES as readonly string[]).includes(value);
}

export function parseMode(raw: Record<string, unknown>): Checked<RepositoryMode> {
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
 * Entries rather than an object: they are materialized via `cleanRecord`
 * at the end, because on a null-prototype target a key like `__proto__`
 * is an ordinary own property (plain `obj[key] = value` on a normal
 * object both pollutes the prototype and silently loses the entry).
 */
export function parseCapabilities(
    raw: Record<string, unknown>,
    knownCapabilities: readonly string[],
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
        if (enabled && !knownCapabilities.includes(name)) {
            errors.push(
                err(
                    "capabilityNotInRegistry",
                    `capability "${name}" is enabled but not in the platform's capability registry` +
                        ` (known: ${[...knownCapabilities].sort().join(", ") || "none"})`,
                    `capabilities.${name}`,
                ),
            );
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
export function parseMappings(
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
                        ` — label mappings must be injective (schema.md §3)`,
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

export function parsePrincipals(raw: Record<string, unknown>): Checked<[string, string][]> {
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

/**
 * Strict parse of an already-YAML-parsed value. Pure; never throws.
 *
 * The section order below is the ERROR order a maintainer sees, and the
 * tests freeze it: top-level keys, version, mode, capabilities,
 * mappings, principals — outermost problem first.
 */
