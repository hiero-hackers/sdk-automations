/**
 * The one box both lanes call (D172): one item decided, applied where the mode allows,
 * and written down as decision rows. It is not a lane — nothing here claims, retries,
 * completes or schedules, and the caller keeps whatever durable row it holds.
 */

import {
    decide,
    type DecideInput,
    type Decision,
    type EngineCapability,
    type Externals,
    type Facts,
    type Report,
    type RepositoryConfig,
    type RepositoryRef,
} from "@hiero-hackers/automation-core";
import type { Store } from "../../store/index.js";
import type { Allowance } from "../allowance.js";
import { recordedWarningsIn, type Applier } from "../apply/apply.js";
import type { EffectOutcome } from "../effects.js";
import { decisionsOf, type DecidedPass } from "./decisions.js";
import type { ExternalsForDelivery } from "./externals.js";

/** One thing to decide about, as the lane that holds it names it (D173). */
export type ItemInput =
    | {
          readonly kind: "delivery";
          readonly deliveryId: string;
          readonly event: string;
          readonly payload: unknown;
      }
    | { readonly kind: "facts"; readonly scheduleId: string; readonly facts: Facts };

/** What the box came to: the record it decided, or the write path this composition has not got. */
export type Decided =
    | {
          readonly kind: "decided";
          readonly report: Report;
          /** What became of each approved effect. Empty outside active mode. */
          readonly outcomes: readonly EffectOutcome[];
      }
    | { readonly kind: "modeUnsupported"; readonly reason: string };

/** What the runnable shell says when a repository asks for writes it has no path for. */
const MODE_UNSUPPORTED = "active mode is unsupported by the runnable shell";

/** The seams one item is decided through; the composition root fills every one. */
export interface ItemDeciderOptions {
    readonly store: Store;
    readonly capabilities: readonly EngineCapability[];
    readonly externals: ExternalsForDelivery;
    /** The one repository this endpoint serves, and the one every report names. */
    readonly repository: RepositoryRef;
    /** The write path, when a composition root has wired one. Absent, `mode: active` ends as `modeUnsupported` before `decide()` runs — the shell genuinely has no effect path. */
    readonly applier?: Applier;
}

/**
 * Decide one item and apply what it approved; `at` is the instant its rows carry.
 * `allowance` is what the caller's calls are charged to, and a webhook passes none (D192).
 */
export type DecideItem = (
    input: ItemInput,
    config: RepositoryConfig,
    at: string,
    allowance?: Allowance,
) => Promise<Decided>;

/** What core is asked about: a raw delivery held to this repository, or the record itself. */
const askedOf = (input: ItemInput, repository: RepositoryRef): DecideInput =>
    input.kind === "delivery"
        ? { kind: "delivery", repository, event: input.event, payload: input.payload }
        : { kind: "facts", facts: input.facts };

/** What the rows name as the cause: the delivery, or the schedule row that fired (D173). */
function passOf(input: ItemInput): Pick<DecidedPass, "passId" | "source" | "sourceId"> {
    if (input.kind === "delivery") {
        return { passId: input.deliveryId, source: "webhook", sourceId: input.deliveryId };
    }
    return { passId: input.scheduleId, source: "sweep", sourceId: input.scheduleId };
}

export function createItemDecider(options: ItemDeciderOptions): DecideItem {
    const { store, capabilities, externals, repository, applier } = options;

    /**
     * The recorded warning binds to the store HERE, because it is the store's own record rather than the item's, so every composition holding one can answer it with credentials or without (grace.md §2).
     */
    const warningFor = recordedWarningsIn(store.ledger);

    /** One item's externals as CORE takes them — both lanes' only way in. */
    const externalsFor = async (
        delivery: Parameters<ExternalsForDelivery>[0],
    ): Promise<Externals> => ({ ...(await externals(delivery)), warningFor });

    /** Stations 5–10 live behind one call: normalize, evaluate, screen, derive, gate. */
    const decideOn = async (
        input: ItemInput,
        config: RepositoryConfig,
        passId: string,
    ): Promise<Decision> =>
        decide(
            askedOf(input, repository),
            config,
            capabilities,
            // Built per item: the live path binds its ordering-evidence memo to this one.

            await externalsFor({
                payload: input.kind === "delivery" ? input.payload : undefined,
                deliveryId: passId,
                config,
            }),
        );

    return async (input, config, at, allowance) => {
        const active = config.mode === "active";
        if (active && applier === undefined) {
            return { kind: "modeUnsupported", reason: MODE_UNSUPPORTED };
        }
        const pass = passOf(input);
        const decision = await decideOn(input, config, pass.passId);
        // Only in active mode, so a future mode cannot acquire a write path by accident.

        const outcomes =
            active && applier !== undefined
                ? await applier.applyAll(decision.approved, config, allowance)
                : [];
        const rows = decisionsOf({
            ...pass,
            repository,
            at,
            report: decision.report,
            effects: outcomes,
        });
        // One statement each and no transaction: a crash between rows loses only rows.

        for (const row of rows) store.ledger.decide(row);
        return { kind: "decided", report: decision.report, outcomes };
    };
}
