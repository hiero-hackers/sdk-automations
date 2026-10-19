/**
 * What mode each capability runs in: its block's stated mode, or the file's, which bounds it
 * (config-schema.md §4). Pure reads of a parsed configuration; the parser enforces the bound.
 */

import {
    REPOSITORY_MODES,
    type CapabilityConfig,
    type CapabilityMode,
    type RepositoryConfig,
    type RepositoryMode,
} from "./schema.js";

/** A capability's mode and where it came from: its own block, or the file's top line. */
export interface EffectiveMode {
    readonly mode: RepositoryMode;
    readonly source: "stated" | "inherited";
}

/** Whether `mode` does more than `ceiling` on the ladder. */
export function isAbove(mode: RepositoryMode, ceiling: RepositoryMode): boolean {
    return REPOSITORY_MODES.indexOf(mode) > REPOSITORY_MODES.indexOf(ceiling);
}

/** The mode `capability` runs in. A stated mode above the file's never wins, parsed or not. */
export function effectiveMode(config: RepositoryConfig, capability: string): EffectiveMode {
    const stated = config.capabilities[capability]?.mode;
    return stated === undefined || isAbove(stated, config.mode)
        ? { mode: config.mode, source: "inherited" }
        : { mode: stated, source: "stated" };
}

/** Whether some enabled capability runs in `active`: the one case that needs a write path. */
export function anyCapabilityActive(config: RepositoryConfig): boolean {
    return Object.entries(config.capabilities).some(
        ([name, block]) => block.enabled && effectiveMode(config, name).mode === "active",
    );
}

/** The configuration with the file and every stated mode lowered to at most `ceiling`. */
export function loweredTo(config: RepositoryConfig, ceiling: CapabilityMode): RepositoryConfig {
    // Null-prototype, as the parser builds it, so a missing name reads `undefined`.
    const capabilities: Record<string, CapabilityConfig> = Object.create(null);
    for (const [name, block] of Object.entries(config.capabilities)) {
        // A silent block counts as at the ceiling: it inherits the lowered file.
        capabilities[name] = isAbove(block.mode ?? ceiling, ceiling)
            ? { ...block, mode: ceiling }
            : block;
    }
    return {
        ...config,
        mode: isAbove(config.mode, ceiling) ? ceiling : config.mode,
        capabilities,
    };
}
