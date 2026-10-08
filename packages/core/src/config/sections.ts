/**
 * The section validators — one per thing a configuration document has. Every
 * validator is total and independent, returning the problems it found
 * alongside the value it contributes: `check*` problems only, `read*` both.
 */

import { readSettings, type SettingsView } from "./spec.js";
import { checked, err, type Checked, type ConfigError, type ConfigErrorCode } from "./results.js";
import { labelKey } from "./labels.js";
import {
    CAPABILITY_NAME_PATTERN,
    COMMANDS,
    MAPPABLE_MEANINGS,
    MAPPING_FAMILIES,
    MAPPING_SECTION_KEYS,
    REPOSITORY_MODES,
    SKILL_TIERS,
    TOP_LEVEL_KEYS,
    type AdmittedCapability,
    type CapabilityConfig,
    type Command,
    type MappableMeaning,
    type Mappings,
    type RepositoryMode,
    type Skill,
} from "./schema.js";
import { DEFAULT_LABEL_MAPPINGS } from "./label-defaults.js";

export function isPlainObject(v: unknown): v is Record<string, unknown> {
    if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
    const prototype = Object.getPrototypeOf(v);
    return prototype === Object.prototype || prototype === null;
}

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

/** An absent `schemaVersion` is the current format. A stated one must be the number 2. */
export function checkSchemaVersion(raw: Record<string, unknown>): readonly ConfigError[] {
    if (!Object.hasOwn(raw, "schemaVersion") || raw.schemaVersion === 2) return [];
    return [
        err(
            "schemaVersionUnsupported",
            `schemaVersion, when stated, must be the number 2, got ${JSON.stringify(raw.schemaVersion)}`,
            "schemaVersion",
        ),
    ];
}

function isRepositoryMode(value: unknown): value is RepositoryMode {
    return typeof value === "string" && (REPOSITORY_MODES as readonly string[]).includes(value);
}

/**
 * An absent `mode` defaults to `observe` (§2.4). A present but empty one is an
 * error: choosing a mode for the maintainer is the silent read §2.7 rejects (D56).
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

/** The admission list as a lookup. A `Map`, so `constructor` is a key like any other. */
function admissionsOf(known: readonly AdmittedCapability[]): Map<string, AdmittedCapability> {
    const admitted = new Map<string, AdmittedCapability>();
    for (const entry of known) admitted.set(entry.name, entry);
    return admitted;
}

/**
 * One admitted block's settings, read against the spec that admitted it. The
 * KEY sweep is D84's and runs regardless, over disabled blocks too.
 */
function readCapabilitySettings(
    capability: string,
    admitted: AdmittedCapability,
    names: SettingsView | null,
    stated: Readonly<Record<string, unknown>>,
    base: string,
): Checked<Readonly<Record<string, unknown>>> {
    const at = (path: string): string => `${base}.${path}`;
    const declares = Object.keys(admitted.settings);
    const errors: ConfigError[] = Object.keys(stated)
        .filter((key) => !declares.includes(key))
        .map((key) =>
            err(
                "unknownKey",
                `capability "${capability}": unknown setting "${key}"` +
                    ` (it declares: ${[...declares].sort().join(", ") || "no settings"})`,
                at(key),
            ),
        );
    if (names === null) return checked(stated, errors);

    const read = readSettings(admitted.settings, names, stated);
    if (read.ok) return checked(read.value, errors);
    return {
        ok: false,
        errors: [
            ...errors,
            ...read.problems.map((problem) =>
                err(problem.code, `${at(problem.path)}: ${problem.message}`, at(problem.path)),
            ),
        ],
    };
}

/**
 * The `capabilities` section, block by block. A block is flat, so everything
 * but the reserved `enabled` is what the spec is read against.
 */
export function readCapabilities(
    raw: Record<string, unknown>,
    knownCapabilities: readonly AdmittedCapability[],
    names: SettingsView | null,
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
        // A key this pattern rejects can never name a shipped capability, so
        // rejecting it closes the hostile-key hole (`__proto__`, dotted paths).
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
        /** An unadmitted name has no spec to read against, and was reported above. */
        const declared = admitted.get(name);
        const stated: Readonly<Record<string, unknown>> = Object.fromEntries(
            Object.entries(value).filter(([key]) => key !== "enabled"),
        );
        const read =
            declared === undefined
                ? null
                : readCapabilitySettings(name, declared, names, stated, `capabilities.${name}`);
        if (read !== null && !read.ok) errors.push(...read.errors);
        const labels = declared?.labels ?? [];
        entries.push([
            name,
            {
                enabled,
                settings: read?.ok === true ? read.value : stated,
                ...(labels.length === 0 ? {} : { labels }),
            },
        ]);
    }
    return checked(entries, errors);
}

/**
 * What one mapping family is: the keys it admits, its fold, and its error
 * codes. `fold` and `collisionNote` are one decision: change either, change both.
 */
export interface MeaningFamily<M extends string> {
    /** Dotted, like `mappings.labels`. Prefixes every path and message. */
    readonly path: string;
    /** What one entry's value is called, singular: `label`. */
    readonly noun: string;
    /** The meanings a CLOSED family admits, or `null` for an OPEN one. */
    readonly meanings: readonly M[] | null;
    readonly fold: (spelling: string) => string;
    /** The parenthetical for a collision between spellings that differ. */
    readonly collisionNote: (otherSpelling: string) => string;
    /** A shape beyond non-empty text, and the sentence demanding it. */
    readonly wellFormed?: { readonly holds: (spelling: string) => boolean; readonly must: string };
    /** What a key the family does not admit is called. */
    readonly notMappable: ConfigErrorCode;
    readonly invalid: ConfigErrorCode;
    readonly notInjective: ConfigErrorCode;
}

/**
 * A key the family does not admit, or `null` for one it does. An OPEN family's
 * key need only be dot-free camelCase — which keeps `__proto__` out.
 */
function unadmittedKey<M extends string>(
    spec: MeaningFamily<M>,
    meaning: string,
): ConfigError | null {
    const at = `${spec.path}.${meaning}`;
    if (spec.meanings === null) {
        return CAPABILITY_NAME_PATTERN.test(meaning)
            ? null
            : err(
                  spec.notMappable,
                  `${spec.path}: ${JSON.stringify(meaning)} is not a valid name (camelCase)`,
                  at,
              );
    }
    return (spec.meanings as readonly string[]).includes(meaning)
        ? null
        : err(spec.notMappable, `${spec.path}: "${meaning}" is not a mappable meaning`, at);
}

/**
 * Each meaning the family admits → this repository's spelling. Fully injective
 * under the family's own fold, not exact string (`FINDING(config-label-injectivity)` D34).
 */
export function readMeaningFamily<M extends string>(
    spec: MeaningFamily<M>,
    rawFamily: Record<string, unknown>,
): Checked<Partial<Record<M, string>>> {
    const family: Partial<Record<M, string>> = {};
    const errors: ConfigError[] = [];
    const owner = new Map<string, { meaning: string; spelling: string }>();

    for (const [meaning, spelling] of Object.entries(rawFamily)) {
        const unadmitted = unadmittedKey(spec, meaning);
        if (unadmitted !== null) {
            errors.push(unadmitted);
            continue;
        }
        if (typeof spelling !== "string" || spelling.trim() === "") {
            errors.push(
                err(
                    spec.invalid,
                    `${spec.path}.${meaning}: ${spec.noun} must be a non-empty string`,
                    `${spec.path}.${meaning}`,
                ),
            );
            continue;
        }
        if (spec.wellFormed !== undefined && !spec.wellFormed.holds(spelling)) {
            errors.push(
                err(
                    spec.invalid,
                    `${spec.path}.${meaning}: ${spec.noun} ${spec.wellFormed.must}`,
                    `${spec.path}.${meaning}`,
                ),
            );
            continue;
        }
        const key = spec.fold(spelling);
        const held = owner.get(key);
        if (held !== undefined) {
            errors.push(
                err(
                    spec.notInjective,
                    `${spec.path}: ${spec.noun} ${JSON.stringify(spelling)} is mapped to both "${held.meaning}" and "${meaning}"` +
                        (held.spelling === spelling ? "" : spec.collisionNote(held.spelling)) +
                        ` — ${spec.noun} mappings must be injective (config-schema.md §3)`,
                    `${spec.path}.${meaning}`,
                ),
            );
            continue;
        }
        owner.set(key, { meaning, spelling });
        family[meaning as M] = spelling;
    }
    return checked(family, errors);
}

/** Meaning → its label, folded as GitHub folds it (`FINDING(config-label-case)` D55). */
const LABELS: MeaningFamily<MappableMeaning> = {
    path: "mappings.labels",
    noun: "label",
    meanings: MAPPABLE_MEANINGS,
    fold: labelKey,
    collisionNote: (other) =>
        ` (differing only in case or surrounding space from ${JSON.stringify(other)}, which GitHub treats as the same label)`,
    notMappable: "meaningNotMappable",
    invalid: "labelInvalid",
    notInjective: "labelNotInjective",
};

/**
 * Command → the word a contributor types. The leading slash is demanded rather
 * than added: silently prefixing `assign:` would map a command nobody can type.
 */
const COMMAND_WORDS: MeaningFamily<Command> = {
    path: "mappings.commands",
    noun: "command",
    meanings: COMMANDS,
    fold: labelKey,
    collisionNote: (other) =>
        ` (differing only in case or surrounding space from ${JSON.stringify(other)}, which a contributor types the same way)`,
    wellFormed: {
        holds: (spelling) => spelling.trim().startsWith("/"),
        must: 'must start with "/"',
    },
    notMappable: "commandNotMappable",
    invalid: "commandInvalid",
    notInjective: "commandNotInjective",
};

/** Skill tier → its label. A tier IS a GitHub label, so it borrows the labels fold. */
const SKILLS: MeaningFamily<Skill> = {
    path: "mappings.skills",
    noun: "label",
    meanings: SKILL_TIERS,
    fold: labelKey,
    collisionNote: LABELS.collisionNote,
    notMappable: "skillNotMappable",
    invalid: "skillInvalid",
    notInjective: "skillNotInjective",
};

/**
 * Alert → the label that carries it. The one OPEN family: `meanings` is `null`
 * and a name is admitted on its shape alone, so every refusal is `alertInvalid`.
 */
const ALERTS: MeaningFamily<string> = {
    path: "mappings.alerts",
    noun: "label",
    meanings: null,
    fold: labelKey,
    collisionNote: LABELS.collisionNote,
    notMappable: "alertInvalid",
    invalid: "alertInvalid",
    notInjective: "alertNotInjective",
};

/** Each family read on its own: absence is empty, a non-mapping is one error. */
function readFamily<M extends string>(
    spec: MeaningFamily<M>,
    raw: unknown,
): Checked<Partial<Record<M, string>>> {
    const family = raw ?? {};
    if (!isPlainObject(family)) {
        return {
            ok: false,
            errors: [err("notAMapping", `${spec.path} must be a mapping`, spec.path)],
        };
    }
    return readMeaningFamily(spec, family);
}

/** Every label already spoken for, and by which family. */
function labelsTaken(
    families: readonly (readonly [string, Readonly<Record<string, string>>])[],
): Map<string, string> {
    const taken = new Map<string, string>();
    for (const [family, mapped] of families) {
        for (const [meaning, label] of Object.entries(mapped)) {
            taken.set(labelKey(label), `"${meaning}" under mappings.${family}`);
        }
    }
    return taken;
}

/**
 * Positions, tiers and alert spellings are all GitHub labels in one namespace
 * (D34). A family is checked against the families read before it.
 */
function checkAgainstEarlier(
    spec: MeaningFamily<string>,
    taken: Map<string, string>,
    entries: Readonly<Record<string, string>>,
): readonly ConfigError[] {
    const errors: ConfigError[] = [];
    for (const [name, spelling] of Object.entries(entries)) {
        const held = taken.get(labelKey(spelling));
        if (held === undefined) continue;
        errors.push(
            err(
                spec.notInjective,
                `${spec.path}.${name}: label ${JSON.stringify(spelling)} is already mapped to ${held}` +
                    ` — one label cannot carry two meanings (config-schema.md §3)`,
                `${spec.path}.${name}`,
            ),
        );
    }
    return errors;
}

/**
 * The `mappings` section, family by family: absence, the sweep for keys no
 * family claims, each family's own check, and the rules spanning two families.
 */
/**
 * The document's label spellings over the defaults (D203): a meaning the file
 * did not map keeps its default, and a file spelling that is another meaning's
 * default is refused, since one label cannot carry two meanings.
 */
function labelsWithDefaults(
    mapped: Partial<Record<MappableMeaning, string>>,
): Checked<Record<MappableMeaning, string>> {
    const errors: ConfigError[] = [];
    const merged = { ...DEFAULT_LABEL_MAPPINGS } as Record<MappableMeaning, string>;
    for (const [meaning, spelling] of Object.entries(mapped) as [MappableMeaning, string][]) {
        merged[meaning] = spelling;
    }
    for (const [meaning, spelling] of Object.entries(mapped) as [MappableMeaning, string][]) {
        const shadowed = MAPPABLE_MEANINGS.find(
            (other) =>
                other !== meaning &&
                !Object.hasOwn(mapped, other) &&
                labelKey(DEFAULT_LABEL_MAPPINGS[other]) === labelKey(spelling),
        );
        if (shadowed === undefined) continue;
        errors.push(
            err(
                LABELS.notInjective,
                `mappings.labels.${meaning}: label ${JSON.stringify(spelling)} is the default spelling of "${shadowed}"` +
                    ` — map ${shadowed} to another label, or spell ${meaning} differently (D203)`,
                `mappings.labels.${meaning}`,
            ),
        );
    }
    return checked(merged, errors);
}

export function readMappings(raw: Record<string, unknown>): Checked<Mappings> {
    if (raw.mappings === undefined) {
        return {
            ok: true,
            value: { labels: { ...DEFAULT_LABEL_MAPPINGS }, commands: {}, skills: {}, alerts: {} },
        };
    }
    if (!isPlainObject(raw.mappings)) {
        return {
            ok: false,
            errors: [err("notAMapping", "mappings must be a mapping", "mappings")],
        };
    }
    const section = raw.mappings;

    const errors: ConfigError[] = Object.keys(section)
        .filter((key) => !(MAPPING_SECTION_KEYS as readonly string[]).includes(key))
        .map((key) => err("unknownKey", `mappings: unknown key "${key}"`, `mappings.${key}`));

    const written = readFamily(LABELS, section.labels);
    const labels = written.ok ? labelsWithDefaults(written.value) : written;
    const commands = readFamily(COMMAND_WORDS, section.commands);
    const skills = readFamily(SKILLS, section.skills);
    const alerts = readFamily(ALERTS, section.alerts);
    if (!labels.ok || !commands.ok || !skills.ok || !alerts.ok) {
        return {
            ok: false,
            errors: [
                ...errors,
                ...(labels.ok ? [] : labels.errors),
                ...(commands.ok ? [] : commands.errors),
                ...(skills.ok ? [] : skills.errors),
                ...(alerts.ok ? [] : alerts.errors),
            ],
        };
    }

    /**
     * The reader types entries as PARTIAL, for the closed families. Every key
     * of an open family is one the document wrote; the assertion says that.
     */
    const mapped = alerts.value as Readonly<Record<string, string>>;
    const shared = [
        ...checkAgainstEarlier(SKILLS, labelsTaken([["labels", labels.value]]), skills.value),
        ...checkAgainstEarlier(
            ALERTS,
            labelsTaken([
                ["labels", labels.value],
                ["skills", skills.value],
            ]),
            mapped,
        ),
    ];
    return checked(
        {
            labels: labels.value,
            commands: commands.value,
            skills: skills.value,
            alerts: mapped,
        },
        [...errors, ...shared],
    );
}

/**
 * The `principals` section: each role name → the one handle behind it. The key
 * must be camelCase, the value non-empty — an empty `@`-mention pings nobody.
 */
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
        if (!CAPABILITY_NAME_PATTERN.test(key)) {
            errors.push(
                err(
                    "principalNameInvalid",
                    `principals: ${JSON.stringify(key)} is not a valid name (camelCase)`,
                    `principals.${key}`,
                ),
            );
            continue;
        }
        if (typeof value !== "string" || value.trim() === "") {
            errors.push(
                err(
                    "principalNotAString",
                    `principals.${key}: must be a non-empty string`,
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
 * D84 — an ENABLED capability may not be missing a mapping it declares it
 * needs. A disabled one demands nothing. The only check reading two sections.
 */
export function checkRequiredMappings(
    capabilities: readonly (readonly [string, CapabilityConfig])[],
    mappings: Mappings,
    knownCapabilities: readonly AdmittedCapability[],
): readonly ConfigError[] {
    const admitted = admissionsOf(knownCapabilities);
    const errors: ConfigError[] = [];

    for (const [name, block] of capabilities) {
        const declared = admitted.get(name);
        if (!block.enabled || declared === undefined) continue;
        for (const family of MAPPING_FAMILIES) {
            for (const meaning of declared.requiredMappings[family] ?? []) {
                if (Object.hasOwn(mappings[family], meaning)) continue;
                errors.push(
                    err(
                        "meaningRequired",
                        `capability "${name}" is enabled but requires the meaning "${meaning}", which this repository has not mapped` +
                            ` — add mappings.${family}.${meaning}, or set capabilities.${name}.enabled to false`,
                        `mappings.${family}.${meaning}`,
                    ),
                );
            }
        }
    }
    return errors;
}
