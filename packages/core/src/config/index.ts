/**
 * The configuration layer: what a repository asked for
 * (`design/contracts/config-schema.md` §2–§4). Nothing here throws or does
 * I/O, and one error anywhere yields no configuration at all (D38).
 */
export {
    describeSpec,
    readSettings,
    type BlockOf,
    type DurationOptions,
    type Field,
    type FieldDescription,
    type SettingsOf,
    type SettingsProblem,
    type SettingsProblemCode,
    type SettingsResult,
    type SettingsView,
    type Spec,
} from "./spec.js";
export * from "./schema.js";
export {
    ABSENT_CONFIG_REVISION,
    CONFIG_PATH,
    UNREADABLE_CONFIG_REVISION,
    revisionOf,
    type ConfigDocument,
    type ConfigLoadOutcome,
    type ConfigSource,
} from "./source.js";
export type { ConfigError, ConfigErrorCode, ConfigResult } from "./results.js";
export { parseConfig, NO_CONFIG } from "./parse.js";
export { anyCapabilityActive, loweredTo, effectiveMode, type EffectiveMode } from "./mode.js";
export { parseConfigDocument } from "./document.js";
export { commandInComment } from "./commands.js";
export { labelKey, meaningOfLabel, meaningsOfLabels, skillsOfLabels } from "./labels.js";
export { DEFAULT_LABEL_MAPPINGS, LABEL_DEFAULTS, type LabelDefault } from "./label-defaults.js";
