/**
 * The reviewed repository configuration: its shape, its enumerations, and
 * the results of validating it — `design/config/schema.md` §2–§4.
 *
 * Types and constants only. The rules that check a document live in
 * `validate.ts`; the entry point that runs them lives in `parse.ts`.
 */

export const REPOSITORY_MODES = ["disabled", "observe", "dry-run", "active"] as const;

/**
 * Derived, never restated. `MAPPABLE_MEANINGS` two declarations below has
 * always done this; the mode did not, and kept its union hand-written in
 * `safety.ts` — the same four strings in two files with nothing linking
 * them, and a `value as RepositoryMode` cast in this file quietly covering
 * the seam. Adding a mode to the array alone would have let `parseConfig`
 * accept a value the safety engine's type had never heard of.
 *
 * FINDING(config-mode-union-derived), D76 — the fifth sighting of one fact
 * stored twice, after D53, D62, D67 and D73.
 */
export type RepositoryMode = (typeof REPOSITORY_MODES)[number];

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

/** The two kinds of work item GitHub numbers in one sequence. */
export const ENTITY_KINDS = ["issue", "pullRequest"] as const;
export type EntityKind = (typeof ENTITY_KINDS)[number];

/**
 * Which flow each meaning belongs to — the fact that used to exist only as
 * two hand-written unions in `workflow/meanings.ts`, related to this file's
 * union by nothing the compiler could see (D90).
 *
 * `pause` is `blocked`'s flow: an orthogonal flag, never a position (D28) —
 * which is why the derived position unions in `workflow/` exclude it by
 * construction rather than by rule.
 *
 * Mapped over the union, so a meaning added to `MAPPABLE_MEANINGS` fails
 * compilation here until its flow is stated, and vice versa.
 */
export type MeaningFlow = EntityKind | "pause";
/**
 * `satisfies`, not an annotation: an annotation would widen each `flow` to
 * the union, and the derived types in `workflow/meanings.ts` would silently
 * collapse to `never` — this is the one line the derivation's correctness
 * hangs on.
 */
export const MEANING_FACTS = {
    awaitingTriage: { flow: "issue" },
    ready: { flow: "issue" },
    inProgress: { flow: "issue" },
    needsReview: { flow: "pullRequest" },
    needsRevision: { flow: "pullRequest" },
    readyToMerge: { flow: "pullRequest" },
    blocked: { flow: "pause" },
} as const satisfies {
    readonly [K in MappableMeaning]: { readonly flow: MeaningFlow };
};

/**
 * Capability names must be usable as configuration keys
 * (`capabilities.<name>` in schema.md §3), so they share the camelCase
 * shape of the shipped examples (`prQuality`, `assignment`). Exported
 * because `parseConfig` enforces the same shape on config keys — a key
 * this pattern rejects can never name a shipped capability, and
 * rejecting it also closes the `__proto__`-style key hole.
 */
export const CAPABILITY_NAME_PATTERN = /^[a-z][a-zA-Z0-9]*$/;

/**
 * The keys a document may carry, in the order a maintainer meets them.
 *
 * Here rather than in `validate.ts` because it is part of the SHAPE: the
 * unknown-key rule reads it, but so does anything that needs to enumerate
 * the configuration surface without parsing a document first.
 *
 * `satisfies` ties it to `RepositoryConfig` so the two cannot drift into a
 * tenth one-fact-twice: a key listed here that the shape does not have is a
 * compile error. `revision` is excluded because it is the parser's stamp
 * (D77), not something a maintainer writes.
 *
 * The other direction — a field added to `RepositoryConfig` and forgotten
 * here, which would make the unknown-key rule reject a legitimate key — is
 * NOT covered, because an interface cannot be enumerated at runtime.
 */
export const TOP_LEVEL_KEYS = [
    "schemaVersion",
    "mode",
    "capabilities",
    "mappings",
    "principals",
] as const satisfies readonly (keyof Omit<RepositoryConfig, "revision">)[];
export type TopLevelKey = (typeof TOP_LEVEL_KEYS)[number];

export interface CapabilityConfig {
    readonly enabled: boolean;
    /** Opaque to the platform; validated by the capability's own contract. */
    readonly settings: Readonly<Record<string, unknown>>;
}

export interface RepositoryConfig {
    /**
     * Which version of the reviewed file this is — the sha the shell fetched.
     *
     * The executor guards every in-flight effect on this string and D45 rules
     * old-revision intents unresumable, yet the parsed configuration once
     * carried no identity at all (`FINDING(config-revision-detached)`, D77).
     * An OBSERVATION, so it arrives through `ParseConfigOptions`.
     */
    readonly revision: string;
    readonly schemaVersion: 1;
    readonly mode: RepositoryMode;
    readonly capabilities: Readonly<Record<string, CapabilityConfig>>;
    readonly mappings: {
        readonly labels: Partial<Readonly<Record<MappableMeaning, string>>>;
    };
    readonly principals: Readonly<Record<string, string>>;
}

/** schema.md §2.2 — no configuration causes no workflow-changing writes. */
/**
 * A null-prototype record: absent-key lookups are always `undefined`.
 * With a normal prototype, `capabilities["constructor"]` would be
 * truthy for an unconfigured name — inherited Object.prototype
 * members must never masquerade as configuration.
 */
export function cleanRecord<V>(
    entries: readonly (readonly [string, V])[],
): Readonly<Record<string, V>> {
    const record: Record<string, V> = Object.create(null);
    for (const [key, value] of entries) record[key] = value;
    return record;
}

export const NO_CONFIG: RepositoryConfig = {
    revision: "",
    schemaVersion: 1,
    mode: "observe",
    capabilities: cleanRecord([]),
    mappings: { labels: {} },
    principals: cleanRecord([]),
};

/**
 * FINDING(config-no-config-mode): schema.md §2.2 says "no configuration
 * causes no workflow-changing writes" but does not say which *mode* an
 * unconfigured repository is in. `observe` (chosen here) satisfies the rule
 * — observe never writes — while still letting operators see findings;
 * `disabled` is the stricter reading. Register decision needed; the
 * constant above makes today's assumption explicit and greppable.
 */

/**
 * Why a configuration was rejected, in a form a report can USE.
 *
 * D38's fail-closed granularity was accepted conditional on the configuration
 * report and the PR-time check, and bare prose left both able only to echo
 * text (`FINDING(config-error-codes)`, D75). The code is contract; the
 * message is for humans and is never asserted on, only its presence.
 */
export type ConfigErrorCode =
    /**
     * Document-level: the file never became a mapping. Reported by
     * `parseConfigDocument`, which is the only thing that sees text.
     */
    | "documentUnparseable"
    | "duplicateKey"
    | "notAMapping"
    | "unknownKey"
    | "schemaVersionUnsupported"
    | "modeInvalid"
    | "capabilityNameInvalid"
    | "capabilityEnabledNotBoolean"
    | "capabilityNotInRegistry"
    | "meaningNotMappable"
    | "labelInvalid"
    | "labelNotInjective"
    | "principalNotAString";

export interface ConfigError {
    readonly code: ConfigErrorCode;
    /** Prose for a maintainer. Never asserted on, only its presence. */
    readonly message: string;
    /**
     * Dotted path into the reviewed file — `capabilities.intake.enabled` —
     * or `null` for a whole-document problem. This is what lets a check run
     * annotate a line rather than paste a paragraph.
     */
    readonly path: string | null;
}

export type ConfigResult =
    | { readonly ok: true; readonly config: RepositoryConfig }
    | { readonly ok: false; readonly errors: readonly ConfigError[] };

export interface ParseConfigOptions {
    /** The revision of the document being parsed. See `RepositoryConfig`. */
    readonly revision: string;
    /**
     * The platform's shipped capability names. An ENABLED capability outside
     * this list is a validation error; a disabled unknown one stays dormant,
     * so retiring a capability never breaks a config that still mentions it.
     *
     * Required, not optional: an absent registry once meant "skip the check"
     * and later "nothing is known", and both were reachable by forgetting an
     * argument (`FINDING(config-capability-registry-gap)`, D58, experiment 6.3).
     */
    readonly knownCapabilities: readonly string[];
}
