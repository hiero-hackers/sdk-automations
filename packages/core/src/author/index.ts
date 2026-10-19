/**
 * The author's door: everything a capability folder names, and nothing the
 * engine, the write rules or the report vocabulary know. Named exports only,
 * so the door stays the size of what an author needs (D61, D125).
 */

export {
    declareCapability,
    type CapabilityDeclaration,
    type DeclaredMappings,
    type DeclaredTrigger,
    type Declared,
    type DeclarationInput,
    type TypedDeclaration,
} from "../capability/declaration.js";
export {
    type Capability,
    type CapabilityView,
    type FactsFor,
    type IntentFor,
    type PlatformHandle,
} from "../capability/boundary.js";
export type { DesiredSpec, IntentRequest } from "../capability/factory.js";
export {
    assigneeClock,
    CANCELLED_BY,
    HOUR_MS,
    inert,
    isConflicted,
    isOpen,
    isPaused,
    lasting,
    latestOf,
    meaningsOf,
    mentions,
    modesOf,
    moveTo,
    on,
    people,
    pullRequestClock,
    REVERSES_WITH,
    type ActorLookup,
    type Clock,
    type PullRequestClockFacts,
} from "../capability/facts.js";
export {
    block,
    count,
    duration,
    flag,
    MAX_CLOCK_HOURS,
    meanings,
    section,
    spec,
    text,
} from "../capability/settings.js";
export type { BlockOf, SettingsOf, Spec } from "../config/spec.js";
export { LABEL_DEFAULTS } from "../config/label-defaults.js";
export type { Command, MappableMeaning, RepositoryConfig, Skill } from "../config/schema.js";
export { effectiveMode, type EffectiveMode } from "../config/mode.js";
export type { ConfigError, ConfigResult } from "../config/results.js";
export { MIN_GRACE_HOURS, MIN_REAP_HOURS } from "../safety/destructive.js";
export type { ClaimedFacts } from "../safety/world.js";
export type { DestructiveGrace } from "../intents/intent.js";
export {
    UNREAD,
    type AssigneeClock,
    type CommitAttestation,
    type FactGroup,
    type FactKind,
    type Facts,
    type IssueFacts,
    type ItemRef,
    type PullRequestFacts,
    type RepositoryRef,
    type ResolverAnswer,
    type ResolverInput,
    type ResolverName,
    type ResolverOutput,
    type StructuredExplanation,
    type Unread,
} from "../catalogue.js";
