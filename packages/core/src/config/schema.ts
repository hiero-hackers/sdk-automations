/**
 * The reviewed repository configuration: its vocabulary and its shape.
 * See `design/contracts/config-schema.md` §2–§4.
 *
 * Declarations only. What comes BACK from validating a document is
 * `results.ts`; the section checks are `sections.ts`; the entry point is
 * `parse.ts`.
 */

// ─── Vocabulary ──────────────────────────────────────────────────────

/** The blast-radius ladder a repository chooses from, least to most. */
export const REPOSITORY_MODES = ["disabled", "observe", "dry-run", "active"] as const;

/** Derived from the array, so a new mode needs no edit anywhere else (D76). */
export type RepositoryMode = (typeof REPOSITORY_MODES)[number];

/** The meanings a repository may map. See design/contracts/taxonomy.md §2. */
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

export const ENTITY_KINDS = ["issue", "pullRequest"] as const;
export type EntityKind = (typeof ENTITY_KINDS)[number];

/** `blocked` is a flag rather than a position, so its flow is `pause` (D28). */
export type MeaningFlow = EntityKind | "pause";

/**
 * Which flow each meaning belongs to. `workflow/positions.ts` builds the
 * per-entity position types from this table by matching on the flow values,
 * so those values have to stay literal.
 *
 * That is what `satisfies` protects. A `:` annotation would type every `flow`
 * as the whole `MeaningFlow` union instead of `"issue"` or `"pullRequest"`.
 * Nothing would match, both derived unions would become `never`, and this
 * line would still compile (D90).
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
 * Capability names double as configuration keys (`capabilities.<name>`,
 * config-schema.md §3). One shape covers both ends: `declaration.ts` checks shipped
 * names, `validate.ts` checks the keys it reads from a document.
 */
export const CAPABILITY_NAME_PATTERN = /^[a-z][a-zA-Z0-9]*$/;

// ─── The shape of a document ─────────────────────────────────────────

/** One capability's block in a configuration file. */
export interface CapabilityConfig {
    readonly enabled: boolean;
    /** Opaque to the platform. The capability's own contract validates it. */
    readonly settings: Readonly<Record<string, unknown>>;
}

/**
 * A validated configuration, plus the revision it was read from.
 *
 * `revision` is the sha of the file, and the one field nobody writes: the
 * shell supplies it through `ParseConfigOptions` and records it in reports.
 * Any future write path must bind work to this revision (D45, D77).
 */
export interface RepositoryConfig {
    readonly revision: string;
    readonly schemaVersion: 1;
    readonly mode: RepositoryMode;
    readonly capabilities: Readonly<Record<string, CapabilityConfig>>;
    readonly mappings: {
        readonly labels: Partial<Readonly<Record<MappableMeaning, string>>>;
    };
    readonly principals: Readonly<Record<string, string>>;
}

/**
 * The keys a document may carry, in the order a maintainer meets them.
 * `revision` is excluded: the parser stamps it, nobody writes it (D77).
 *
 * Adding a field to `RepositoryConfig` does not add it here. Only the reverse
 * is a compile error.
 */
export const TOP_LEVEL_KEYS = [
    "schemaVersion",
    "mode",
    "capabilities",
    "mappings",
    "principals",
] as const satisfies readonly (keyof Omit<RepositoryConfig, "revision">)[];
export type TopLevelKey = (typeof TOP_LEVEL_KEYS)[number];

// ─── Parsing input ───────────────────────────────────────────────────

/**
 * One admitted capability, as much of it as the parser can use.
 *
 * The fields are exactly the two a `CapabilityDeclaration` states about
 * CONFIGURATION, so a declaration is an admission with no adapting: the
 * shell may pass its declarations straight through. Everything else a
 * declaration says — triggers, observations, resolvers, intents — is about
 * running, and a document cannot be wrong about it.
 */
export interface AdmittedCapability {
    readonly name: string;
    /** The legal `settings` key names. Any other is `unknownKey` (D84). */
    readonly configKeys: readonly string[];
    /** Meanings that must be mapped before this may be enabled (D84). */
    readonly requiredMeanings: readonly MappableMeaning[];
}

/**
 * What the caller knows that the document does not say.
 *
 * `knownCapabilities` is the application's directly admitted list. Any
 * capability outside it is an error, whether enabled or disabled. The field is
 * required because omitting the admission authority would silently skip the
 * unknown-capability check (D58).
 *
 * An entry may be a bare NAME or an `AdmittedCapability`. A name admits the
 * name and states nothing else, so the two checks that need more than a name —
 * settings keys and required meanings — do not run for it. That is the honest
 * reading: treating "nothing declared" as "no legal settings key" would reject
 * every block a name-only caller admits.
 */
export interface ParseConfigOptions {
    /** The revision of the document being parsed. See `RepositoryConfig`. */
    readonly revision: string;
    readonly knownCapabilities: readonly (string | AdmittedCapability)[];
}
