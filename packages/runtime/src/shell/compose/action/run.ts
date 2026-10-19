/**
 * The one-shot composition: one GitHub Actions run decides one event or one sweep, then exits.
 * The run is the durable record, so the store lives in memory and is gone at exit; every seam
 * is the hosted shell's, built once for the one repository the runner names.
 */

import { CAPABILITIES } from "@hiero-hackers/automation-capabilities";
import {
    ABSENT_CONFIG_REVISION,
    anyCapabilityActive,
    loweredTo,
    type DestructiveWarning,
    type EngineCapability,
    type ItemRef,
} from "@hiero-hackers/automation-core";
import { Store } from "../../../store/index.js";
import { createApplier, recordedWarningsIn } from "../../apply/apply.js";
import { createItemDecider, type DecideItem } from "../../decide/item.js";
import { declareSweep } from "../../decide/schedule.js";
import { hydrateWarnings } from "../../decide/warnings.js";
import type { EffectOutcome } from "../../effects.js";
import { createDeliveries } from "../../inbound/deliveries.js";
import { contained, createLogger, type Log, type ShellEvent } from "../../log.js";
import {
    DEFAULT_SWEEP_CADENCE_MS,
    SNAPSHOT_MAX_AGE_MS,
    SWEEP_WRITE_CALLS,
} from "../../sweep/budgets.js";
import { createSweep } from "../../sweep/sweep.js";
import { liveGitHub } from "../live.js";
import type { RepositorySeams, ShellOptions } from "../shell.js";
import { itemNamedBy, RUNNER_GRANTS, type ActionRun } from "./inputs.js";

/** What one run came to, for the summary and the exit code. */
export interface RunOutcome {
    readonly kind: "delivery" | "sweep" | "idle";
    readonly events: readonly ShellEvent[];
    /** The items decided, in order; the summary explains each from the store. */
    readonly items: readonly ItemRef[];
    /** What became of every effect the run applied, in order. */
    readonly effects: readonly EffectOutcome[];
    /** A capability's `active` was decided as `dry-run` because the workflow did not arm writes. */
    readonly modeLowered: boolean;
    /** No `sdk-automations.yml` at the default branch: the run decided with nothing enabled. */
    readonly configAbsent: boolean;
    readonly exitCode: 0 | 1;
}

export interface RunActionOptions {
    readonly payload: Uint8Array;
    readonly store: Store;
    readonly clock?: () => Date;
    readonly log?: Log;
    readonly capabilities?: readonly EngineCapability[];
}

/** The runner token outlives any job; a job is six hours at most. */
const TOKEN_LIFETIME_MS = 6 * 60 * 60_000;

export async function runAction(run: ActionRun, options: RunActionOptions): Promise<RunOutcome> {
    const clock = options.clock ?? (() => new Date());
    const events: ShellEvent[] = [];
    const sink = options.log ?? createLogger({ clock });
    const log: Log = contained((event) => {
        events.push(event);
        sink(event);
    });
    const capabilities = options.capabilities ?? CAPABILITIES;
    const { store, payload } = options;
    const worker = `action-${run.deliveryId}`;
    const sweeping = run.eventName === "schedule";
    let modeLowered = false;
    let configAbsent = false;
    const items: ItemRef[] = [];
    const effects: EffectOutcome[] = [];

    const live = liveGitHub({
        auth: {
            kind: "token",
            token: {
                value: run.token,
                expiresAt: new Date(clock().getTime() + TOKEN_LIFETIME_MS),
                grants: RUNNER_GRANTS,
            },
            identity: run.identity,
        },
        writes: run.armWrites ? { appSlug: run.identity.slug } : null,
        killSwitchActive: false,
        clock,
        share: 1,
        lanes: "one",
        contentCreationHourly: null,
        ...(run.apiOrigin === null ? {} : { apiOrigin: run.apiOrigin }),
        knownCapabilities: capabilities.map(({ declaration }) => declaration),
        ownWrites: (served) => (item) => store.ledger.landedOn(served, item),
        log,
    });

    /** The shared box over one seam set, with the arming ceiling and the item list on it. */
    const deciderOver = (seams: RepositorySeams): DecideItem => {
        const applier =
            seams.writePath === null
                ? undefined
                : createApplier({ ledger: store.ledger, ...seams.writePath, worker, clock, log });
        /** The item under decision, so the warning seam below can read its comments. */
        let deciding: { readonly item: ItemRef; readonly revision: string } | null = null;
        const recorded = recordedWarningsIn(store.ledger);
        /** Asked only for a destructive act: the comments are read once, then the store answers. */
        const warningFor = async (effectId: string): Promise<DestructiveWarning | null> => {
            if (deciding !== null && seams.reader !== undefined) {
                const { item, revision } = deciding;
                deciding = null;
                await hydrateWarnings({
                    ledger: store.ledger,
                    reader: seams.reader,
                    repository: run.repository,
                    item,
                    revision,
                });
            }
            return recorded(effectId);
        };
        const decide = createItemDecider({
            store,
            capabilities,
            externals: async (delivery) => ({ ...(await seams.externals(delivery)), warningFor }),
            repository: run.repository,
            clock,
            ...(applier === undefined ? {} : { applier }),
        });
        return async (input, config, at, allowance) => {
            const item = input.kind === "facts" ? input.facts.item : itemNamedBy(payload);
            if (item !== null) items.push(item);
            deciding = item === null ? null : { item, revision: config.revision };
            // The file and every stated `active` together, so no block outlives the lowered file.
            const lowered = !run.armWrites && anyCapabilityActive(config);
            if (lowered) modeLowered = true;
            const decided = await decide(
                input,
                lowered ? loweredTo(config, "dry-run") : config,
                at,
                allowance,
            );
            // Stryker disable next-line ConditionalExpression: armed writes wire the path, so an active decision never ends unsupported here.
            if (decided.kind === "decided") effects.push(...decided.outcomes);
            return decided;
        };
    };

    /** Typed as the shell's own seam so the sweep's allowance passes as it does there. */
    const seamsFor: ShellOptions["seams"] = live.seamsFor;
    const laneSeams = seamsFor(run.repository);
    const deliveries = createDeliveries({
        store,
        capabilities,
        lane: () => ({ configSource: laneSeams.configSource, decideItem: deciderOver(laneSeams) }),
        repository: run.repository,
        allowance: live.deliveryAllowance,
        worker,
        clock,
        log,
        configured: (_, config) => {
            if (config.revision === ABSENT_CONFIG_REVISION) configAbsent = true;
        },
    });

    if (!sweeping) {
        store.inbox.acceptDelivery({
            deliveryId: run.deliveryId,
            eventName: run.eventName,
            payload,
            receivedAt: clock().toISOString(),
        });
        log({ event: "deliveryAccepted", deliveryId: run.deliveryId, eventName: run.eventName });
        await deliveries.drain();
        // A payload naming another repository completes as a mismatch: the workflow is misplaced.
        const finished = events.some(
            (event) =>
                event.event === "deliveryCompleted" &&
                event.deliveryId === run.deliveryId &&
                event.kind !== "repositoryMismatch",
        );
        return {
            kind: "delivery",
            events,
            items,
            effects,
            modeLowered,
            configAbsent,
            exitCode: finished ? 0 : 1,
        };
    }

    const config = await deliveries.configuration(run.repository, laneSeams.configSource);
    if (config === null) {
        // A rejected file is the repository's to fix and completes; a failed read is the run's failure.
        const unreadable = events.some(
            (event) => event.event === "configurationUnavailable" && event.reason === "unreadable",
        );
        return {
            kind: "idle",
            events,
            items,
            effects,
            modeLowered,
            configAbsent,
            exitCode: unreadable ? 1 : 0,
        };
    }
    configAbsent = config.revision === ABSENT_CONFIG_REVISION;
    declareSweep({ store, repository: run.repository, config, capabilities, now: clock() });
    const sweep = createSweep({
        store,
        capabilities,
        processorFor: (repository, allowance) => {
            const seams = seamsFor(repository, allowance);
            return {
                decideItem: deciderOver(seams),
                facts: seams.facts,
                configuration: () => deliveries.configuration(repository, seams.configSource),
            };
        },
        clock,
        cadenceMs: DEFAULT_SWEEP_CADENCE_MS,
        writeCap: SWEEP_WRITE_CALLS,
        allowance: live.sweepAllowance,
        snapshotMaxAgeMs: SNAPSHOT_MAX_AGE_MS,
        log,
    });
    await sweep.runDue();
    const fired = events.some((event) => event.event === "sweepClaimed");
    const failed = events.some((event) => event.event === "sweepFailed");
    return {
        kind: fired ? "sweep" : "idle",
        events,
        items,
        effects,
        modeLowered,
        configAbsent,
        exitCode: failed ? 1 : 0,
    };
}

/** The in-memory store one run decides through. */
export function runStore(): Store {
    return new Store(":memory:");
}
