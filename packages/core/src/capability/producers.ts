/**
 * Who reads what: every producer of fact records, and the groups each fills.
 * THE TABLE IS THE PROMISE — a failed read still leaves its group `"unread"`. It is
 * read off the group modules' own rows (D215), never written twice.
 */

import {
    FACT_GROUPS,
    FACT_KINDS,
    type FactGroup,
    type FactKind,
    type Facts,
    type Unread,
} from "../catalogue.js";
import type { RepositoryConfig } from "../config/schema.js";
import {
    PRODUCER_KINDS,
    PRODUCER_NAMES,
    WEBHOOK_PRODUCERS,
    readersOf,
    type GroupsReadBy,
    type ProducerName,
    type WebhookProducer,
} from "./groups/index.js";

export {
    PRODUCER_NAMES,
    WEBHOOK_PRODUCERS,
    type GroupsReadBy,
    type ProducerName,
    type WebhookProducer,
} from "./groups/index.js";

/** The kinds producer `P` makes a record of, as a union. */
export type KindsMadeBy<P extends ProducerName> = (typeof PRODUCER_KINDS)[P][number];

/** Per producer and kind, the groups it reads — `null` for no record at all (D76). */
type ProducerTable = {
    readonly [P in ProducerName]: {
        readonly [K in FactKind]: K extends KindsMadeBy<P> ? readonly GroupsReadBy<P, K>[] : null;
    };
};

/** One row, in `FACT_GROUPS` order; `null` where the producer makes no record of the kind. */
function rowOf(producer: ProducerName, kind: FactKind): readonly FactGroup[] | null {
    const makes: readonly FactKind[] = PRODUCER_KINDS[producer];
    if (!makes.includes(kind)) return null;
    return FACT_GROUPS.filter((group) => readersOf(kind, group).includes(producer));
}

/** The registry, derived. THE ONE CAST: `rowOf` computes exactly what `ProducerTable` names. */
export const PRODUCERS = Object.fromEntries(
    PRODUCER_NAMES.map((producer) => [
        producer,
        Object.fromEntries(FACT_KINDS.map((kind) => [kind, rowOf(producer, kind)])),
    ]),
) as unknown as ProducerTable;

/** The same table widened, so the questions below can index it with a variable. */
const ROWS: {
    readonly [P in ProducerName]: { readonly [K in FactKind]: readonly FactGroup[] | null };
} = PRODUCERS;

function isName<T extends string>(names: readonly T[], name: string): name is T {
    return names.some((known) => known === name);
}

export function isWebhookProducer(name: string): name is WebhookProducer {
    return isName(WEBHOOK_PRODUCERS, name);
}

export function producesKind(producer: ProducerName, kind: FactKind): boolean {
    return ROWS[producer][kind] !== null;
}

export function producerReads(producer: ProducerName, kind: FactKind, group: FactGroup): boolean {
    return ROWS[producer][kind]?.includes(group) ?? false;
}

/** The producers that do read this group — what a boot refusal names instead. */
export function producersReading(kind: FactKind, group: FactGroup): readonly ProducerName[] {
    return PRODUCER_NAMES.filter((producer) => producerReads(producer, kind, group));
}

/** A capability as this question reads it; `EngineCapability` is one, unimported (D91). */
export interface DeclaringCapability {
    readonly declaration: {
        readonly name: string;
        readonly triggers: readonly { readonly kind: string }[];
        readonly facts: readonly FactKind[];
        readonly needs: { readonly [K in FactKind]: readonly FactGroup[] };
        readonly wants: { readonly [K in FactKind]: readonly FactGroup[] };
    };
}

/** The groups to read on each kind — what one sweep firing asks `groupsNeeded` for. */
export type NeededGroups = { readonly [K in FactKind]: readonly FactGroup[] };

/**
 * The groups this repository's enabled schedule capabilities need or want on `kind`, of
 * those the sweep's row reads. A need or a want declared is a read paid for (D195, D245).
 */
export function groupsNeeded(
    config: RepositoryConfig,
    capabilities: readonly DeclaringCapability[],
    kind: FactKind,
): readonly FactGroup[] {
    const needed = new Set<FactGroup>();
    for (const { declaration } of capabilities) {
        if (config.capabilities[declaration.name]?.enabled !== true) continue;
        if (!declaration.triggers.some((trigger) => trigger.kind === "schedule")) continue;
        if (!declaration.facts.includes(kind)) continue;
        for (const need of declaration.needs[kind]) needed.add(need);
        for (const want of declaration.wants[kind]) needed.add(want);
    }
    // `PRODUCERS`, not `ROWS`: the sweep's row makes both kinds, so there is no null arm.

    return PRODUCERS.sweep[kind].filter((group) => needed.has(group));
}

/** One record with the needed groups read, the wanted ones as the producer left them, every other group `Unread` — facts.md §3. */
export type ReadGroups<F extends Facts, N extends FactGroup, W extends FactGroup = never> = {
    readonly [K in keyof F]: K extends N
        ? Exclude<F[K], Unread>
        : K extends W
          ? F[K]
          : K extends FactGroup
            ? Unread
            : F[K];
};

/** The record shape producer `P` may build for kind `K`; the row it omits is `Unread`. */
export type ProducedFacts<P extends ProducerName, K extends FactKind> =
    K extends KindsMadeBy<P> ? ReadGroups<Extract<Facts, { kind: K }>, GroupsReadBy<P, K>> : never;
