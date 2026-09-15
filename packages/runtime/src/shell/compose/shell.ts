/**
 * The composition root: receiver + store + the two lanes wired into one running shell.
 * Every box is existing, gated code; this file's whole contribution is ORDER.
 * Plus one clock — a webhook arrival is the only other thing that ever drains, so
 * the sweep is what makes stale work recover on its own in a quiet repository.
 */

import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import {
    validateCapabilityDeclarations,
    type EngineCapability,
    type RepositoryRef,
} from "@hiero-hackers/automation-core";
import type { Store } from "../../store/index.js";
import {
    createApplier,
    type Applier,
    type EffectExternalsSource,
    type EffectReader,
    type EffectWriter,
} from "../apply/apply.js";
import type { ConfigSource } from "../decide/config.js";
import { createItemDecider, type DecideItem } from "../decide/item.js";
import type { ExternalsForDelivery } from "../decide/externals.js";
import { createDeliveries } from "../inbound/deliveries.js";
import { createReceiver } from "../inbound/receiver.js";
import { createJobs } from "../jobs/jobs.js";
import { contained, createLogger, detailOf, type Log } from "../log.js";
import type { Allowance } from "../allowance.js";
import {
    DEFAULT_SWEEP_CADENCE_MS,
    SNAPSHOT_MAX_AGE_MS,
    SWEEP_WRITE_CALLS,
} from "../sweep/budgets.js";
import { createSweep, type SweepFactsSource } from "../sweep/sweep.js";

/** How often the shell requeues stale claims and drains, absent an override. */
export const DEFAULT_TICK_MS = 60_000;

/**
 * How long one connection may hold the edge open; Node's defaults are a slow-loris budget.
 * GitHub abandons a delivery unanswered for about ten seconds and redelivers later.
 */
const REQUEST_TIMEOUT_MS = 30_000;
const HEADERS_TIMEOUT_MS = 10_000;

/** The three seams `createApplier` cannot build for itself, per repository. */
export interface WritePath {
    readonly writer: EffectWriter;
    readonly reader: EffectReader;
    readonly externals: EffectExternalsSource;
}

/** Everything ONE repository is read, decided and written through (D169). */
export interface RepositorySeams {
    readonly configSource: ConfigSource;
    readonly externals: ExternalsForDelivery;
    /** `null` without `APP_SLUG`: the shipped composition writes nothing. */
    readonly writePath: WritePath | null;
    readonly facts: SweepFactsSource;
}

/** One repository's seams, built out: the box both lanes call, and what it applies with. */
interface Serving {
    readonly configSource: ConfigSource;
    readonly decideItem: DecideItem;
    readonly facts: SweepFactsSource;
    readonly applier: Applier | null;
}

export interface ShellOptions {
    readonly secret: string;
    readonly store: Store;
    readonly capabilities: readonly EngineCapability[];
    /** One set per repository; the process serves whichever the installation delivers for. */
    seams(repository: RepositoryRef, allowance?: Allowance): RepositorySeams;
    /** The one repository a credential-free process serves; absent, the payload names it. */
    readonly repository?: RepositoryRef;
    /** What the webhook lane's reads and writes are charged to; the sweep's is its own (D192). */
    readonly deliveryAllowance?: Allowance;
    readonly worker?: string;
    readonly clock?: () => Date;
    readonly tickMs?: number;
    /** The fact sweep, when a composition has something to read GitHub with. Absent is the shipped composition: due `sweep:` rows are simply never claimed. */
    readonly sweep?: {
        /** How long until the next firing; the default is hourly. */
        readonly cadenceMs?: number;
        /** How many writes one tick may send; the default is `SWEEP_WRITE_CALLS`. */
        readonly writeCap?: number;
        /** The one handle every firing spends from, built where the client is (D192). */
        readonly allowance: Allowance;
        /** How long a stored read may be decided from; the default is `SNAPSHOT_MAX_AGE_MS` (D193). */
        readonly snapshotMaxAgeMs?: number;
    };
    /** The installation switch (D171): deliveries are accepted and recorded, and nothing is read, decided or sent. */
    readonly suspended?: boolean;
    /** Optional here and required of every component: the root defaults to the production log. */
    readonly log?: Log;
}

export interface Shell {
    readonly server: Server;
    /** Pump everything pending — exposed so tests and operators drain deterministically. */
    drain(): Promise<void>;
    /** The drain in flight, if there is one. Starts no work. */
    settled(): Promise<void>;
    /** Stop the sweep. The server stays the caller's to close. */
    stopTick(): void;
}

export function createShell(options: ShellOptions): Shell {
    const errors = validateCapabilityDeclarations(
        options.capabilities.map(({ declaration }) => declaration),
    );
    if (errors.length > 0) {
        throw new Error(`invalid capability declarations: ${errors.join("; ")}`);
    }
    const clock = options.clock ?? (() => new Date());
    const suspended = options.suspended ?? false;
    const log = contained(options.log ?? createLogger({ clock }));
    const worker = options.worker ?? `shell-${randomUUID()}`;

    const buildServing = (repository: RepositoryRef, seams: RepositorySeams): Serving => {
        const { configSource, externals, writePath, facts } = seams;
        const applier =
            writePath === null
                ? null
                : createApplier({ ledger: options.store.ledger, ...writePath, worker, clock, log });
        return {
            configSource,
            facts,
            applier,
            decideItem: createItemDecider({
                store: options.store,
                capabilities: options.capabilities,
                externals,
                repository,
                ...(applier === null ? {} : { applier }),
            }),
        };
    };

    /** One repository's seams, built out once and held: the deciding is the same box. */
    const served = new Map<string, Serving>();
    const servingFor = (repository: RepositoryRef): Serving => {
        const key = `${repository.owner}/${repository.repo}`;
        const held = served.get(key);
        if (held !== undefined) return held;
        const serving = buildServing(repository, options.seams(repository));
        served.set(key, serving);
        return serving;
    };

    const deliveries = createDeliveries({
        store: options.store,
        capabilities: options.capabilities,
        lane: servingFor,
        ...(options.repository === undefined ? {} : { repository: options.repository }),
        ...(options.deliveryAllowance === undefined
            ? {}
            : { allowance: options.deliveryAllowance }),
        worker,
        clock,
        log,
        suspended,
    });
    /**
     * It rides the reconciliation tick rather than owning a timer: the schedule row's DUE
     * DATE decides when a repository is read, so a second interval is a second thing to stop.
     */
    const factSweep =
        options.sweep === undefined
            ? null
            : createSweep({
                  store: options.store,
                  capabilities: options.capabilities,
                  processorFor: (repository, allowance) => {
                      const { configSource, decideItem, facts } = buildServing(
                          repository,
                          options.seams(repository, allowance),
                      );
                      return {
                          decideItem,
                          facts,
                          configuration: () => deliveries.configuration(repository, configSource),
                      };
                  },
                  clock,
                  cadenceMs: options.sweep.cadenceMs ?? DEFAULT_SWEEP_CADENCE_MS,
                  writeCap: options.sweep.writeCap ?? SWEEP_WRITE_CALLS,
                  allowance: options.sweep.allowance,
                  snapshotMaxAgeMs: options.sweep.snapshotMaxAgeMs ?? SNAPSHOT_MAX_AGE_MS,
                  suspended,
                  log,
              });
    const handler = createReceiver({
        secret: options.secret,
        log,
        accept: ({ deliveryId, eventName, payload }) =>
            options.store.inbox.acceptDelivery({
                deliveryId,
                eventName,
                payload,
                receivedAt: clock().toISOString(),
            }).outcome,
        onAccepted: () => {
            void deliveries.drain().catch((error: unknown) => {
                log({ event: "drainFailed", phase: "accepted", detail: detailOf(error) });
            });
        },
    });
    const jobs = createJobs({
        store: options.store,
        deliveries,
        sweep: factSweep,
        clock,
        suspended,
        log,
        applierFor: (repository) => servingFor(repository).applier,
    });
    const ticking = setInterval(jobs.tick, options.tickMs ?? DEFAULT_TICK_MS);
    // Stryker disable next-line CallExpression: unref only decides whether an otherwise-idle event loop keeps running; nothing in this process can observe it, and the shell's own exit is explicit.
    // The sweep is recovery, never a reason for the process to stay alive.

    ticking.unref();

    const server = createServer(handler);
    server.requestTimeout = REQUEST_TIMEOUT_MS;
    server.headersTimeout = HEADERS_TIMEOUT_MS;

    return {
        server,
        drain: () => deliveries.drain(),
        settled: () => jobs.settled(),
        stopTick: () => {
            clearInterval(ticking);
        },
    };
}
