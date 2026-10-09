/** When a repository wants sweeping, and what its schedule row is called (sweep.md §2). */

import type {
    EngineCapability,
    RepositoryConfig,
    RepositoryRef,
} from "@hiero-hackers/automation-core";
import type { Store } from "../../store/index.js";

/** The `effect` column every sweep row carries. */
export const SWEEP_EFFECT = "sweep";

/** The one spelling of a repository's sweep row. */
export function sweepScheduleId(repository: RepositoryRef): string {
    return `${SWEEP_EFFECT}:${repository.owner}/${repository.repo}`;
}

/** The inverse: which repository a due row is about, or `null` when its id spells none. */
export function repositoryOfScheduleId(scheduleId: string): RepositoryRef | null {
    const prefix = `${SWEEP_EFFECT}:`;
    if (!scheduleId.startsWith(prefix)) return null;
    const [owner, repo, ...rest] = scheduleId.slice(prefix.length).split("/");
    return owner && repo && rest.length === 0 ? { owner, repo } : null;
}

/** Does this repository enable a capability that runs on a clock? */
export function wantsSweeping(
    config: RepositoryConfig,
    capabilities: readonly EngineCapability[],
): boolean {
    return capabilities.some(
        ({ declaration }) =>
            config.capabilities[declaration.name]?.enabled === true &&
            declaration.triggers.some((trigger) => trigger.kind === "schedule"),
    );
}

/** The enabled capabilities that run only on a clock: with no sweep, nothing ever wakes them. */
export function scheduleOnlyCapabilities(
    config: RepositoryConfig,
    capabilities: readonly EngineCapability[],
): string[] {
    return capabilities.flatMap(({ declaration }) =>
        config.capabilities[declaration.name]?.enabled === true &&
        declaration.triggers.length > 0 &&
        declaration.triggers.every((trigger) => trigger.kind === "schedule")
            ? [declaration.name]
            : [],
    );
}

/** Everything the declaration below needs; the delivery lane holds all of it. */
export interface SweepDeclaration {
    readonly store: Store;
    readonly repository: RepositoryRef;
    readonly config: RepositoryConfig;
    readonly capabilities: readonly EngineCapability[];
    readonly now: Date;
}

/**
 * Declare the repository's sweep row if it wants one — idempotently, on every delivery.
 * Due NOW rather than a cadence from now: the cadence belongs to the driver.
 */
export function declareSweep({
    store,
    repository,
    config,
    capabilities,
    now,
}: SweepDeclaration): void {
    if (!wantsSweeping(config, capabilities)) return;
    store.ledger.schedule(sweepScheduleId(repository), now.toISOString(), SWEEP_EFFECT);
}
