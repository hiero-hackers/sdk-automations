/** How the platform CALLS a capability — `design/contracts/contract.md` §2 as types. */

import type { TypedDeclaration } from "./declaration.js";
import type { Command, MappableMeaning, RepositoryConfig, Skill } from "../config/index.js";
import type {
    Facts,
    ResolverAnswer,
    ResolverInput,
    ResolverName,
    ResolverOutput,
    StructuredExplanation,
} from "../catalogue.js";
import type { AnyIntent, Intent } from "../intents/index.js";
import type { IntentRequest } from "./factory.js";
import type { ReadGroups } from "./producers.js";
import { readSettings, type SettingsOf, type SettingsView } from "../config/spec.js";

// ─── Typed projections ───────────────────────────────────────────────

/** The fact union a declaration receives — one member per declared kind, read with that kind's needs, its wants as read or not (D214, D245). */
export type FactsFor<D extends TypedDeclaration> = {
    [K in D["facts"][number]]: ReadGroups<
        Extract<Facts, { kind: K }>,
        D["needs"][K][number],
        D["wants"][K][number]
    >;
}[D["facts"][number]];

/** The intent union a declaration may return — one member per declared operation. */
export type IntentFor<D extends TypedDeclaration> = Extract<
    AnyIntent,
    { operation: D["intents"][number] }
>;

// ─── The view a capability sees ──────────────────────────────────────

/** contract.md §2 — no `mode`, no `enabled`, no neighbour's block, no spellings (§2, P3). */
export interface CapabilityView<D extends TypedDeclaration> {
    /** This repository's answers to the capability's own spec, resolved. */
    readonly settings: SettingsOf<D["settings"]>;
    /** Which meanings the repository mapped, family by family. Names only. */
    readonly mapped: {
        readonly labels: readonly MappableMeaning[];
        readonly commands: readonly Command[];
        readonly skills: readonly Skill[];
        readonly alerts: readonly string[];
    };
    readonly principals: readonly string[];
}

/** A spec resolved against a file that named no block: its own defaults, or nothing. */
function defaultsOf(
    declaration: TypedDeclaration,
    view: SettingsView,
): Readonly<Record<string, unknown>> {
    const resolved = readSettings(declaration.settings, view, {});
    return resolved.ok ? resolved.value : {};
}

/**
 * Build that view. THE ONE CAST: the only producer of a `RepositoryConfig` is
 * `parseConfig`, which already read this block against this declaration's spec.
 */
export function projectCapabilityView<const D extends TypedDeclaration>(
    declaration: D,
    config: RepositoryConfig,
): CapabilityView<D> {
    const block = config.capabilities[declaration.name];
    // No `!== undefined` filter: `parseConfig` only assigns defined spellings.
    const view = {
        mapped: {
            labels: Object.keys(config.mappings.labels) as MappableMeaning[],
            commands: Object.keys(config.mappings.commands) as Command[],
            skills: Object.keys(config.mappings.skills) as Skill[],
            alerts: Object.keys(config.mappings.alerts),
        },
        principals: Object.keys(config.principals),
    };
    const resolved = block?.settings ?? defaultsOf(declaration, view);
    return { settings: resolved as CapabilityView<D>["settings"], ...view };
}

// ─── The handle and the capability ───────────────────────────────────

/** contract.md §2. No Octokit, HTTP, raw payload, or other capability reaches through. */
export interface PlatformHandle<D extends TypedDeclaration> {
    /** The answer, or the evaluation ends as skipped: an unanswered question is not "no" (D51). */
    ask<Q extends D["resolvers"][number] & ResolverName>(
        query: Q,
        input: ResolverInput<Q>,
    ): Promise<ResolverOutput<Q>>;
    /** The raw answer, for the rare capability that carries on without one. */
    resolve<Q extends D["resolvers"][number] & ResolverName>(
        query: Q,
        input: ResolverInput<Q>,
    ): Promise<ResolverAnswer<ResolverOutput<Q>>>;
    /** One intent about this record; occasion, cause and claims are read off it. */
    intent<K extends D["intents"][number]>(request: IntentRequest<K>): Intent<K>;
    /** Stop and say why on the operator surface: one explanation, no intents. */
    skip(summary: string, ...detail: readonly string[]): readonly never[];
    explain(explanation: StructuredExplanation): void;
}

/**
 * A capability: its declaration, and the one function the platform calls.
 * `evaluate` never writes — everything it returns is a request policy may refuse.
 */
export interface Capability<D extends TypedDeclaration> {
    readonly declaration: D;
    evaluate(
        facts: FactsFor<D>,
        config: CapabilityView<D>,
        platform: PlatformHandle<D>,
    ): Promise<readonly IntentFor<D>[]>;
}
