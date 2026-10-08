/** The reviewed repository configuration's vocabulary and shape (config-schema.md §2–§4). */

import type { Spec } from "./spec.js";

// ─── Vocabulary ──────────────────────────────────────────────────────

/** The blast-radius ladder a repository chooses from, least to most. */
export const REPOSITORY_MODES = ["disabled", "observe", "dry-run", "active"] as const;

export type RepositoryMode = (typeof REPOSITORY_MODES)[number];

export const ENTITY_KINDS = ["issue", "pullRequest"] as const;
export type EntityKind = (typeof ENTITY_KINDS)[number];

/** `blocked` is a flag rather than a position, so its flow is `pause` (D28). */
export type MeaningFlow = EntityKind | "pause";

/** Meaning → flow (D76). `satisfies`, not `:`, or both derived unions become `never` (D90). */
export const MEANING_FACTS = {
    awaitingTriage: { flow: "issue" },
    ready: { flow: "issue" },
    inProgress: { flow: "issue" },
    needsReview: { flow: "pullRequest" },
    needsRevision: { flow: "pullRequest" },
    readyToMerge: { flow: "pullRequest" },
    blocked: { flow: "pause" },
} as const satisfies Readonly<Record<string, { readonly flow: MeaningFlow }>>;

export type MappableMeaning = keyof typeof MEANING_FACTS;

/** The table's insertion order is the order every consumer walks it in. */
export const MAPPABLE_MEANINGS = Object.keys(MEANING_FACTS) as readonly MappableMeaning[];

export const COMMANDS = ["assign", "unassign", "working"] as const;
export type Command = (typeof COMMANDS)[number];

/** The skill ladder, easiest first. The ORDER is the contract: gates compare by index (D127). */
export const SKILL_TIERS = ["goodFirstIssue", "beginner", "intermediate", "advanced"] as const;
export type Skill = (typeof SKILL_TIERS)[number];

/** Capability names double as configuration keys (`capabilities.<name>`, §3). */
export const CAPABILITY_NAME_PATTERN = /^[a-z][a-zA-Z0-9]*$/;

// ─── The shape of a document ─────────────────────────────────────────

/** One capability's block. `settings` is spec-resolved (§3); no document writes that key. */
export interface CapabilityConfig {
    readonly enabled: boolean;
    readonly settings: Readonly<Record<string, unknown>>;
    readonly labels?: readonly MappableMeaning[];
}

/** Each meaning → this repository's spelling. First three families CLOSED, `alerts` OPEN. */
export interface Mappings {
    readonly labels: Partial<Readonly<Record<MappableMeaning, string>>>;
    readonly commands: Partial<Readonly<Record<Command, string>>>;
    readonly skills: Partial<Readonly<Record<Skill, string>>>;
    readonly alerts: Readonly<Record<string, string>>;
}

/** The CLOSED families, in the order errors surface. An open-keyed family must not join. */
export const MAPPING_FAMILIES = [
    "labels",
    "commands",
    "skills",
] as const satisfies readonly (keyof Mappings)[];
export type MappingFamily = (typeof MAPPING_FAMILIES)[number];

/** The open-keyed families: the repository names the meanings as well. */
export const OPEN_MAPPING_FAMILIES = ["alerts"] as const satisfies readonly (keyof Mappings)[];
export type OpenMappingFamily = (typeof OPEN_MAPPING_FAMILIES)[number];

/** Every key the `mappings:` section admits — both kinds of family. */
export const MAPPING_SECTION_KEYS = [
    ...MAPPING_FAMILIES,
    ...OPEN_MAPPING_FAMILIES,
] as const satisfies readonly (keyof Mappings)[];
export type MappingSectionKey = (typeof MAPPING_SECTION_KEYS)[number];

/**
 * A validated configuration. `revision` is the sha of the file and the one
 * field nobody writes; a write path must bind work to it (D45, D77).
 */
export interface RepositoryConfig {
    readonly revision: string;
    /** Optional in a document; absent is 2. A future format states its own. */
    readonly schemaVersion: 2;
    readonly mode: RepositoryMode;
    readonly capabilities: Readonly<Record<string, CapabilityConfig>>;
    readonly mappings: Mappings;
    readonly principals: Readonly<Record<string, string>>;
}

/** The keys a document may carry. `revision` is excluded: the parser stamps it (D77). */
export const TOP_LEVEL_KEYS = [
    "schemaVersion",
    "mode",
    "capabilities",
    "mappings",
    "principals",
] as const satisfies readonly (keyof Omit<RepositoryConfig, "revision">)[];
export type TopLevelKey = (typeof TOP_LEVEL_KEYS)[number];

// ─── Parsing input ───────────────────────────────────────────────────

/** An absent family demands nothing, which is why each key is optional. */
export interface RequiredMappings {
    readonly labels?: readonly MappableMeaning[];
    readonly commands?: readonly Command[];
    readonly skills?: readonly Skill[];
}

export interface AdmittedCapability {
    readonly name: string;
    /** The spec its `settings` block is read against: its keys are the legal names. */
    readonly settings: Spec;
    /** What must be mapped for this to be enabled (D84). */
    readonly requiredMappings: RequiredMappings;
    readonly labels?: readonly MappableMeaning[];
}

/** `knownCapabilities` is required: omitting it would silently skip the unknown check (D58). */
export interface ParseConfigOptions {
    readonly revision: string;
    readonly knownCapabilities: readonly AdmittedCapability[];
}
