/**
 * What a capability declares about itself, and the one admission path for the
 * complete set the platform ships.
 */

import {
    CAPABILITY_NAME_PATTERN,
    COMMANDS,
    MAPPABLE_MEANINGS,
    type MappableMeaning,
    MAPPING_FAMILIES,
    RESERVED_BLOCK_KEYS,
    SKILL_TIERS,
} from "../config/schema.js";
import type { MappingFamily, RequiredMappings } from "../config/schema.js";
import type { FactGroup, FactKind, GroupOf, IntentOperation, ResolverName } from "../catalogue.js";
import { FACT_GROUPS, FACT_KINDS, RESOLVER_NAMES } from "../catalogue.js";
import { carriesFactGroup, PRODUCER_KINDS } from "./groups/index.js";
import { INTENT_OPERATIONS } from "../intents/index.js";
import type { ProducerName, WebhookProducer } from "./producers.js";
import type { Spec } from "../config/spec.js";
import { producerReads, producersReading, producesKind } from "./producers.js";
import {
    CLOSURE_CAUSES,
    ISSUE_CAUSES,
    PR_CAUSES,
    positionsEnteredBy,
    type TransitionCause,
} from "../workflow/index.js";

/**
 * contract.md §1 triggers: what a capability wants to be woken for. An event
 * IS a webhook producer, so a typo is a compile error and a need is answerable
 * at boot (`producers.ts`).
 */
export type DeclaredTrigger =
    | { readonly kind: "event"; readonly event: WebhookProducer }
    | { readonly kind: "schedule"; readonly description: string };

/** The three mapping families a declaration may demand, unnarrowed. */
export interface DeclaredMappings {
    readonly labels?: readonly string[];
    readonly commands?: readonly string[];
    readonly skills?: readonly string[];
}

/**
 * A capability's self-description — contract.md §1. `settings` and
 * `requiredMappings` are empty rather than absent when neither is wanted (D84).
 */
export interface CapabilityDeclaration {
    readonly name: string;
    readonly triggers: readonly DeclaredTrigger[];
    /** Also woken for a closed item; absent means open items only (D59). */
    readonly closed?: boolean;
    readonly settings: Spec;
    readonly requiredMappings: DeclaredMappings;
    /** The positions it may set: the ones its `moves` end on (D204). */
    readonly labels: readonly string[];
    /** The transition causes it owns on the map — non-empty exactly when `intents` holds `applyMappedLabel` (D243). */
    readonly moves: readonly string[];
    /** The positions it consults and does not set; `blocked` is the platform's pause and is never listed (D28). */
    readonly reads: readonly string[];
    readonly facts: readonly string[];
    /** Per kind — a need declared is a read paid for: the sweep reads these and no more (D195, D214). */
    readonly needs: Readonly<Record<string, readonly string[]>>;
    /** Per kind — groups read when the producer has them, `"unread"` otherwise, never a skip (D245). */
    readonly wants: Readonly<Record<string, readonly string[]>>;
    readonly resolvers: readonly string[];
    readonly intents: readonly string[];
}

/** The groups each kind's record is read with, filled for every kind. */
export type NeedsPerKind = { readonly [K in FactKind]: readonly FactGroup[] };

/** What an author may write: one list for every declared kind, or a list per kind. */
export type NeedsInput =
    readonly FactGroup[] | { readonly [K in FactKind]?: readonly GroupOf<K>[] };

/** A declaration whose names are catalogue keys — the shape `parseConfig` admits. */
export interface TypedDeclaration extends CapabilityDeclaration {
    readonly requiredMappings: RequiredMappings;
    readonly labels: readonly MappableMeaning[];
    readonly moves: readonly TransitionCause[];
    readonly reads: readonly MappableMeaning[];
    readonly facts: readonly FactKind[];
    readonly needs: NeedsPerKind;
    readonly wants: NeedsPerKind;
    readonly resolvers: readonly ResolverName[];
    readonly intents: readonly IntentOperation[];
}

/** What an author writes: `labels` follows from `moves` and is not written, and the lists an event trigger can imply are optional. */
export interface DeclarationInput {
    readonly name: string;
    readonly triggers: readonly DeclaredTrigger[];
    readonly closed?: boolean;
    readonly settings: Spec;
    readonly requiredMappings?: RequiredMappings;
    readonly moves?: readonly TransitionCause[];
    readonly reads?: readonly MappableMeaning[];
    readonly facts?: readonly FactKind[];
    readonly needs?: NeedsInput;
    readonly wants?: NeedsInput;
    readonly resolvers: readonly ResolverName[];
    readonly intents: readonly IntentOperation[];
}

/** The kinds one webhook producer yields, read off its registry row. */
type KindsOfEvent<E> = E extends WebhookProducer ? (typeof PRODUCER_KINDS)[E][number] : never;

/** The kinds every event trigger in a tuple implies; a schedule trigger implies none. */
type KindsOfTriggers<T extends readonly DeclaredTrigger[]> = {
    [I in keyof T]: T[I] extends { readonly kind: "event"; readonly event: infer E }
        ? KindsOfEvent<E>
        : never;
}[number];

/** The kinds a declaration receives: stated, or implied by its event triggers. */
type KindsOf<D extends DeclarationInput> = D["facts"] extends readonly FactKind[]
    ? D["facts"]
    : readonly KindsOfTriggers<D["triggers"]>[];

/** `needs` as written, per kind: a list reaches each declared kind that carries the group. */
type NeedsOf<N, Kinds extends FactKind> = {
    readonly [K in FactKind]: K extends Kinds
        ? N extends readonly FactGroup[]
            ? readonly Extract<N[number], GroupOf<K>>[]
            : K extends keyof N
              ? N[K] extends readonly FactGroup[]
                  ? N[K]
                  : readonly []
              : readonly []
        : readonly [];
};

/** The input with its defaults filled, each list kept as the literal tuple written. */
export type Declared<D extends DeclarationInput> = Omit<
    D,
    "facts" | "needs" | "wants" | "requiredMappings" | "labels" | "moves" | "reads"
> & {
    readonly labels: readonly MappableMeaning[];
    readonly moves: D["moves"] extends readonly TransitionCause[] ? D["moves"] : readonly [];
    readonly reads: D["reads"] extends readonly MappableMeaning[] ? D["reads"] : readonly [];
    readonly facts: KindsOf<D>;
    readonly needs: NeedsOf<D["needs"], KindsOf<D>[number]>;
    readonly wants: NeedsOf<D["wants"], KindsOf<D>[number]>;
    readonly requiredMappings: D["requiredMappings"] extends RequiredMappings
        ? D["requiredMappings"]
        : Record<never, never>;
};

function kindsImpliedBy(triggers: readonly DeclaredTrigger[]): readonly FactKind[] {
    const kinds = new Set<FactKind>();
    for (const trigger of triggers) {
        if (trigger.kind !== "event") continue;
        for (const kind of FACT_KINDS) if (producesKind(trigger.event, kind)) kinds.add(kind);
    }
    return FACT_KINDS.filter((kind) => kinds.has(kind));
}

const isNeedsList = (needs: NeedsInput): needs is readonly FactGroup[] => Array.isArray(needs);

/**
 * `needs` per kind. A listed group reaches every declared kind that carries it; one that
 * no declared kind carries is kept on each, so the boot check names it rather than losing it.
 */
function needsPerKind(needs: NeedsInput | undefined, kinds: readonly FactKind[]): NeedsPerKind {
    const filled: Record<FactKind, FactGroup[]> = { issue: [], pullRequest: [] };
    if (needs === undefined) return filled;
    if (!isNeedsList(needs)) {
        for (const kind of FACT_KINDS) filled[kind] = [...(needs[kind] ?? [])];
        return filled;
    }
    for (const group of needs) {
        const carriers = kinds.filter((kind) => carriesFactGroup(kind, group));
        for (const kind of carriers.length > 0 ? carriers : kinds) filled[kind].push(group);
    }
    return filled;
}

/**
 * Fill the defaults and pin every list as a literal tuple. Declare capabilities
 * through this, never by annotating them `: TypedDeclaration`.
 */
export function declareCapability<const D extends DeclarationInput>(d: D): Declared<D> {
    const facts = d.facts ?? kindsImpliedBy(d.triggers);
    const moves = d.moves ?? [];
    const filled = {
        ...d,
        facts,
        needs: needsPerKind(d.needs, facts),
        wants: needsPerKind(d.wants, facts),
        requiredMappings: d.requiredMappings ?? {},
        labels: positionsEnteredBy(moves),
        moves,
        reads: d.reads ?? [],
    };
    // THE ONE CAST: the conditional types above are these defaults, as types.
    return filled as unknown as Declared<D>;
}

const at = (d: CapabilityDeclaration): string => `capability "${d.name}"`;

function duplicates(values: readonly string[]): string[] {
    const seen = new Set<string>();
    const dup = new Set<string>();
    for (const v of values) (seen.has(v) ? dup : seen).add(v);
    return [...dup];
}

/**
 * Is the declaration structurally sound, judged without the catalogues?
 * Returns every violation rather than the first.
 */
function validateDeclaration(d: CapabilityDeclaration): readonly string[] {
    const errors: string[] = [];

    if (!CAPABILITY_NAME_PATTERN.test(d.name)) {
        errors.push(
            `declaration name ${JSON.stringify(d.name)} must be a camelCase configuration key`,
        );
    }
    if (d.triggers.length === 0) {
        errors.push(
            `${at(d)}: at least one trigger (event or schedule) is required — an untriggerable capability is dead code`,
        );
    }
    if (d.facts.length === 0) {
        errors.push(
            `${at(d)}: names no fact kind — an event trigger implies its kind, a schedule trigger must state \`facts\``,
        );
    }

    for (const [key, what] of Object.entries(RESERVED_BLOCK_KEYS)) {
        if (!Object.hasOwn(d.settings, key)) continue;
        errors.push(
            `${at(d)}: settings may not declare "${key}" — the capability's own block reads it as ${what}, and its other keys are the settings`,
        );
    }

    const setsLabels = d.intents.includes("applyMappedLabel");
    if (setsLabels && d.moves.length === 0) {
        errors.push(`${at(d)}: may set a position but owns no edge in \`moves\``);
    }
    if (!setsLabels && d.moves.length > 0) {
        errors.push(
            `${at(d)}: owns edges in \`moves\` but never declares the applyMappedLabel intent`,
        );
    }

    // No `settings` row: a spec's keys are unique by construction.
    const lists: (readonly [string, readonly string[]])[] = [
        ["labels", d.labels],
        ["moves", d.moves],
        ["reads", d.reads],
        ["facts", d.facts],
        ...Object.entries(d.needs).map(([kind, groups]) => [`needs.${kind}`, groups] as const),
        ...Object.entries(d.wants).map(([kind, groups]) => [`wants.${kind}`, groups] as const),
        ["resolvers", d.resolvers],
        ["intents", d.intents],
        ...MAPPING_FAMILIES.map(
            (family) => [`requiredMappings.${family}`, d.requiredMappings[family] ?? []] as const,
        ),
    ];
    for (const [what, entries] of lists) {
        for (const dup of duplicates(entries)) {
            errors.push(`${at(d)}: duplicate ${what} entry "${dup}"`);
        }
    }

    return errors;
}

/** The closed meaning set of each family, for the requirement check below. */
const FAMILY_MEANINGS: { readonly [F in MappingFamily]: readonly string[] } = {
    labels: MAPPABLE_MEANINGS,
    commands: COMMANDS,
    skills: SKILL_TIERS,
};

function isFactKind(name: string): name is FactKind {
    return FACT_KINDS.some((kind) => kind === name);
}

function isFactGroup(name: string): name is FactGroup {
    return FACT_GROUPS.some((group) => group === name);
}

function isIntentOperation(name: string): name is IntentOperation {
    return Object.hasOwn(INTENT_OPERATIONS, name);
}

function isTransitionCause(name: string): name is TransitionCause {
    return ISSUE_CAUSES.some((c) => c === name) || PR_CAUSES.some((c) => c === name);
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
    const [x, y] = [new Set(a), new Set(b)];
    return x.size === y.size && [...x].every((v) => y.has(v));
}

/** Do the declared meaning, fact, resolver, and intent names exist? */
function checkAgainstCatalogue(declaration: CapabilityDeclaration): readonly string[] {
    const errors: string[] = [];

    for (const family of MAPPING_FAMILIES) {
        for (const meaning of declaration.requiredMappings[family] ?? []) {
            if (FAMILY_MEANINGS[family].some((name) => name === meaning)) continue;
            errors.push(
                `${at(declaration)}: required meaning "${meaning}" is not in the ${family} family`,
            );
        }
    }
    for (const meaning of declaration.labels) {
        if (!MAPPABLE_MEANINGS.some((name) => name === meaning)) {
            errors.push(
                `${at(declaration)}: label meaning "${meaning}" is not in the labels family`,
            );
        }
    }
    // Closure is read from GitHub and never written (D47), so no capability may own a closing cause.
    for (const cause of declaration.moves) {
        if (!isTransitionCause(cause)) {
            errors.push(`${at(declaration)}: transition cause "${cause}" is not on the map`);
        } else if (CLOSURE_CAUSES.some((c) => c === cause)) {
            errors.push(
                `${at(declaration)}: "${cause}" closes an item, which is read and never written`,
            );
        }
    }
    const entered = positionsEnteredBy(declaration.moves.filter(isTransitionCause));
    if (!sameSet(declaration.labels, entered)) {
        errors.push(
            `${at(declaration)}: labels ${JSON.stringify(declaration.labels)} are not the positions its moves enter, ${JSON.stringify(entered)}`,
        );
    }
    for (const meaning of declaration.reads) {
        if (!MAPPABLE_MEANINGS.some((name) => name === meaning)) {
            errors.push(
                `${at(declaration)}: read meaning "${meaning}" is not in the labels family`,
            );
        } else if (meaning === "blocked") {
            errors.push(
                `${at(declaration)}: reads "blocked", the pause every capability is held to (D28)`,
            );
        } else if (declaration.labels.includes(meaning)) {
            errors.push(
                `${at(declaration)}: reads "${meaning}", a position it sets and so reads by right`,
            );
        }
    }
    for (const fact of declaration.facts) {
        if (!isFactKind(fact)) {
            errors.push(`${at(declaration)}: fact kind "${fact}" is not in the fact catalogue`);
        }
    }
    // facts.md §3: a need or want is satisfiable only on a declared kind that carries the group.
    for (const verb of ["needs", "wants"] as const) {
        for (const [kind, groups] of Object.entries(declaration[verb])) {
            if (groups.length === 0) continue;
            const known = isFactKind(kind);
            if (!known)
                errors.push(`${at(declaration)}: ${verb} name "${kind}", which is not a fact kind`);
            const declared = known && declaration.facts.includes(kind);
            if (known && !declared) {
                errors.push(
                    `${at(declaration)}: ${verb} groups on ${kind} records, a kind it does not declare`,
                );
            }
            for (const group of groups) {
                if (!isFactGroup(group)) {
                    errors.push(
                        `${at(declaration)}: fact group "${group}" is not in the fact catalogue`,
                    );
                } else if (declared && !carriesFactGroup(kind, group)) {
                    errors.push(
                        `${at(declaration)}: the ${kind} record carries no group "${group}"`,
                    );
                } else if (verb === "wants" && (declaration.needs[kind] ?? []).includes(group)) {
                    errors.push(
                        `${at(declaration)}: wants "${group}" on ${kind} records, which it already needs`,
                    );
                }
            }
        }
    }
    for (const resolver of declaration.resolvers) {
        if (!RESOLVER_NAMES.some((name) => name === resolver)) {
            errors.push(
                `${at(declaration)}: resolver "${resolver}" is not in the resolver catalogue`,
            );
        }
    }
    for (const intent of declaration.intents) {
        if (!isIntentOperation(intent)) {
            errors.push(`${at(declaration)}: intent "${intent}" is not in the operation catalogue`);
        }
    }
    return errors;
}

/**
 * Every need this producer leaves unread, as errors: the engine records
 * `factsUnread` and skips every delivery the trigger wakes, in silence.
 */
function needsUnreadBy(
    declaration: CapabilityDeclaration,
    producer: ProducerName,
    trigger: string,
): readonly string[] {
    const errors: string[] = [];
    for (const kind of declaration.facts.filter(isFactKind)) {
        if (!producesKind(producer, kind)) continue;
        for (const need of (declaration.needs[kind] ?? []).filter(isFactGroup)) {
            if (!carriesFactGroup(kind, need)) continue;
            if (producerReads(producer, kind, need)) continue;
            errors.push(
                `capability "${declaration.name}": ${trigger} leaves "${need}" unread on a ${kind} record, so every delivery it wakes is skipped — read by: ${producersReading(kind, need).join(", ")}`,
            );
        }
    }
    return errors;
}

/** A want nobody reads is dead: some trigger's producer must read it, on some occasion (D245). */
function wantsNobodyReads(declaration: CapabilityDeclaration): readonly string[] {
    const producers: ProducerName[] = declaration.triggers.map((trigger) =>
        trigger.kind === "schedule" ? "sweep" : trigger.event,
    );
    const errors: string[] = [];
    for (const kind of declaration.facts.filter(isFactKind)) {
        for (const want of (declaration.wants[kind] ?? []).filter(isFactGroup)) {
            if (!carriesFactGroup(kind, want)) continue;
            if (producers.some((p) => producesKind(p, kind) && producerReads(p, kind, want)))
                continue;
            errors.push(
                `${at(declaration)}: wants "${want}" on ${kind} records, which no trigger's producer reads — read by: ${producersReading(kind, want).join(", ")}`,
            );
        }
    }
    return errors;
}

/** Is every declared need answered by the producer each trigger wakes, and every want by one of them? */
function checkAgainstProducers(declaration: CapabilityDeclaration): readonly string[] {
    const errors: string[] = [];
    for (const trigger of declaration.triggers) {
        if (trigger.kind === "schedule") {
            errors.push(...needsUnreadBy(declaration, "sweep", "the schedule trigger"));
            continue;
        }
        errors.push(...needsUnreadBy(declaration, trigger.event, `the "${trigger.event}" trigger`));
    }
    errors.push(...wantsNobodyReads(declaration));
    return errors;
}

/** Validate the complete direct capability set; returns every error. */
export function validateCapabilityDeclarations(
    declarations: readonly CapabilityDeclaration[],
): readonly string[] {
    const errors = declarations.flatMap((declaration) => [
        ...validateDeclaration(declaration),
        ...checkAgainstCatalogue(declaration),
        ...checkAgainstProducers(declaration),
    ]);
    for (const name of duplicates(declarations.map((declaration) => declaration.name))) {
        errors.push(`duplicate capability name "${name}"`);
    }
    // One automatic edge has one owner (taxonomy.md §2.2, D243).
    for (const cause of duplicates(declarations.flatMap(({ moves }) => [...new Set(moves)]))) {
        errors.push(`transition cause "${cause}" is owned by more than one capability`);
    }
    return errors;
}
