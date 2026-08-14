/**
 * What a capability declares about itself, and the one admission path for the
 * complete set the platform ships. `boundary.ts` invokes an admitted
 * capability; the platform catalogues remain authoritative for operation facts.
 */

import { CAPABILITY_NAME_PATTERN } from "../config/schema.js";
import type { IntentOperation, ObservationName, ResolverName } from "./catalogue.js";
import { INTENT_OPERATIONS, OBSERVATION_NAMES, RESOLVER_NAMES } from "./catalogue.js";

/** contract.md §1 triggers, split into the two real shapes. */
export type Trigger =
    | { readonly kind: "event"; readonly event: string }
    | { readonly kind: "schedule"; readonly description: string };

/** What a capability needs from the platform to run at all — contract.md §1. */
export interface OperationalNeeds {
    readonly schedule: boolean;
    readonly durableState: "none" | "candidate" | "required";
    readonly crossItemCoordination: boolean;
    readonly externalDelivery: boolean;
}

/** A capability's self-description — `design/modules/contract.md` §1. */
export interface CapabilityDeclaration {
    readonly name: string;
    readonly triggers: readonly Trigger[];
    readonly configKeys: readonly string[];
    readonly observations: readonly string[];
    readonly resolvers: readonly string[];
    readonly intents: readonly string[];
    readonly operationalNeeds: OperationalNeeds;
}

/**
 * A declaration whose names are catalogue keys. `CapabilityDeclaration`
 * keeps `readonly string[]` so malformed external declarations remain
 * runtime-validatable; the runtime boundary needs key-constrained names.
 */
export interface TypedDeclaration extends CapabilityDeclaration {
    readonly observations: readonly ObservationName[];
    readonly resolvers: readonly ResolverName[];
    readonly intents: readonly IntentOperation[];
}

/**
 * Identity at runtime; the point is the `const` type parameter, which
 * pins `observations`, `resolvers`, and `intents` as literal tuples. A
 * declaration written as a plain object widens them to `string[]`, and
 * every projection in `boundary.ts` then degrades to "any name" — losing
 * exactly the isolation the boundary exists to enforce. Declare capabilities
 * through this function, never by annotating them `: TypedDeclaration`.
 */
export function declareCapability<const D extends TypedDeclaration>(d: D): D {
    return d;
}

function duplicates(values: readonly string[]): string[] {
    const seen = new Set<string>();
    const dup = new Set<string>();
    for (const v of values) (seen.has(v) ? dup : seen).add(v);
    return [...dup];
}

/**
 * Is the declaration structurally sound, judged without the catalogues? Pure;
 * returns every violation rather than the first, in the same errors-as-values
 * style as `parseConfig`.
 */
function validateDeclaration(d: CapabilityDeclaration): readonly string[] {
    const errors: string[] = [];
    const at = `capability "${d.name}"`;

    if (!CAPABILITY_NAME_PATTERN.test(d.name)) {
        errors.push(
            `declaration name ${JSON.stringify(d.name)} must be a camelCase configuration key`,
        );
    }
    if (d.triggers.length === 0) {
        errors.push(
            `${at}: at least one trigger (event or schedule) is required — an untriggerable capability is dead code`,
        );
    }
    if (d.triggers.some((t) => t.kind === "schedule") && !d.operationalNeeds.schedule) {
        errors.push(`${at}: declares a schedule trigger but operationalNeeds.schedule is false`);
    }

    for (const list of [
        ["configKeys", d.configKeys],
        ["observations", d.observations],
        ["resolvers", d.resolvers],
        ["intents", d.intents],
    ] as const) {
        for (const dup of duplicates(list[1])) {
            errors.push(`${at}: duplicate ${list[0]} entry "${dup}"`);
        }
    }

    return errors;
}

function isIntentOperation(name: string): name is IntentOperation {
    return Object.hasOwn(INTENT_OPERATIONS, name);
}

/** Do the declared observation, resolver, and intent names exist? */
function checkAgainstCatalogue(declaration: CapabilityDeclaration): readonly string[] {
    const errors: string[] = [];
    const at = `capability "${declaration.name}"`;

    for (const observation of declaration.observations) {
        if (!OBSERVATION_NAMES.some((name) => name === observation)) {
            errors.push(`${at}: observation "${observation}" is not in the observation catalogue`);
        }
    }
    for (const resolver of declaration.resolvers) {
        if (!RESOLVER_NAMES.some((name) => name === resolver)) {
            errors.push(`${at}: resolver "${resolver}" is not in the resolver catalogue`);
        }
    }
    for (const intent of declaration.intents) {
        if (!isIntentOperation(intent)) {
            errors.push(`${at}: intent "${intent}" is not in the operation catalogue`);
        }
    }
    return errors;
}

/**
 * Validate the complete direct capability set before any caller can use it.
 * Returns every structural, catalogue, and duplicate-name error.
 */
export function validateCapabilityDeclarations(
    declarations: readonly CapabilityDeclaration[],
): readonly string[] {
    const errors = declarations.flatMap((declaration) => [
        ...validateDeclaration(declaration),
        ...checkAgainstCatalogue(declaration),
    ]);
    for (const name of duplicates(declarations.map((declaration) => declaration.name))) {
        errors.push(`duplicate capability name "${name}"`);
    }
    return errors;
}
