/**
 * The capability contract's declaration layer as pure logic —
 * `design/modules/contract.md` §1 turned into validated types, plus the
 * two requirements the stage-three experiments added to D23:
 *
 * - every declared intent names its **idempotency class** (experiment
 *   6.5: a lost-response retry duplicates comment creation but is
 *   harmless for label addition — the executor's recovery rule differs
 *   by class, so the class must be declared, not inferred);
 * - declarations form a **registry** whose names feed
 *   `parseConfig({ knownCapabilities })` (experiment 6.3,
 *   `FINDING(config-capability-registry-gap)`: without the registry an
 *   enabled unknown capability passes validation silently).
 *
 * The runtime boundary (evaluate/PlatformHandle, contract.md §2) is
 * stage-five work; this module is only what configuration validation,
 * permission diagnostics, and operator reporting need today.
 */

/**
 * A repository permission in GitHub's `scope:level` form, e.g.
 * `issues:write`. Kept as a validated string rather than a closed union
 * so the contract does not need editing when GitHub adds scopes; the
 * permission *ceiling* is policy, owned by the stage-four review, not
 * by this type.
 */
export type PermissionGrant = `${string}:${"read" | "write"}`;

const PERMISSION_PATTERN = /^[a-z][a-z_]*:(read|write)$/;

/** contract.md §1 triggers, split into the two real shapes. */
export type Trigger =
    | { readonly kind: "event"; readonly event: string }
    | { readonly kind: "schedule"; readonly description: string };

/**
 * How a retry must behave after a lost response — experiment 6.5's
 * classes. `idempotent`: re-sending cannot duplicate the outcome (label
 * add). `nonIdempotent`: a blind retry duplicates; recovery must go
 * through the read-back path (comment create).
 */
export type IdempotencyClass = "idempotent" | "nonIdempotent";

export interface IntentDeclaration {
    readonly name: string;
    readonly idempotencyClass: IdempotencyClass;
    /** Repository permissions this intent's effects require. */
    readonly requiredPermissions: readonly PermissionGrant[];
}

export interface OperationalNeeds {
    readonly schedule: boolean;
    readonly durableState: "none" | "candidate" | "required";
    readonly crossItemCoordination: boolean;
    readonly externalDelivery: boolean;
}

/** contract.md §1, with intents upgraded from names to declarations. */
export interface CapabilityDeclaration {
    readonly name: string;
    /**
     * Tombstone. A retired capability's name stays in the registry
     * forever: configs that enable it remain *valid* (no repository
     * drops to observe over a retirement) but the capability never
     * activates, and the effective-config report must say so. Only
     * names that never existed are validation errors — retirement is
     * not allowed to be a breaking change, and deleting a name (the
     * only way to make it one) is not representable.
     */
    readonly retired?: boolean;
    readonly triggers: readonly Trigger[];
    readonly configKeys: readonly string[];
    readonly observations: readonly string[];
    readonly resolvers: readonly string[];
    readonly intents: readonly IntentDeclaration[];
    readonly permissions: {
        readonly repository: readonly PermissionGrant[];
        readonly organization: readonly PermissionGrant[];
    };
    readonly operationalNeeds: OperationalNeeds;
}

/**
 * Capability names must be usable as configuration keys
 * (`capabilities.<name>` in schema.md §3), so they share the camelCase
 * shape of the shipped examples (`prQuality`, `assignment`).
 */
const NAME_PATTERN = /^[a-z][a-zA-Z0-9]*$/;

function duplicates(values: readonly string[]): string[] {
    const seen = new Set<string>();
    const dup = new Set<string>();
    for (const v of values) (seen.has(v) ? dup : seen).add(v);
    return [...dup];
}

/**
 * Validate one declaration. Pure; returns every violation rather than
 * the first, in the same errors-as-values style as `parseConfig`.
 */
export function validateDeclaration(d: CapabilityDeclaration): readonly string[] {
    const errors: string[] = [];
    const at = `capability "${d.name}"`;

    if (!NAME_PATTERN.test(d.name)) {
        errors.push(`declaration name ${JSON.stringify(d.name)} must be a camelCase configuration key`);
    }
    if (d.triggers.length === 0) {
        errors.push(`${at}: at least one trigger (event or schedule) is required — an untriggerable capability is dead code`);
    }
    if (d.triggers.some((t) => t.kind === "schedule") && !d.operationalNeeds.schedule) {
        errors.push(`${at}: declares a schedule trigger but operationalNeeds.schedule is false`);
    }

    for (const list of [
        ["configKeys", d.configKeys],
        ["observations", d.observations],
        ["resolvers", d.resolvers],
        ["intents", d.intents.map((i) => i.name)],
    ] as const) {
        for (const dup of duplicates(list[1])) {
            errors.push(`${at}: duplicate ${list[0]} entry "${dup}"`);
        }
    }

    const declaredRepo = new Set(d.permissions.repository);
    for (const grant of [...d.permissions.repository, ...d.permissions.organization]) {
        if (!PERMISSION_PATTERN.test(grant)) {
            errors.push(`${at}: permission "${grant}" is not in scope:level form`);
        }
    }
    for (const intent of d.intents) {
        for (const grant of intent.requiredPermissions) {
            if (!declaredRepo.has(grant)) {
                errors.push(
                    `${at}: intent "${intent.name}" requires "${grant}" which the capability does not declare — ` +
                    `an intent cannot exceed its capability's permissions`,
                );
            }
        }
    }

    return errors;
}

export interface CapabilityRegistry {
    /**
     * Every name ever shipped, retired included — the list
     * `parseConfig({ knownCapabilities })` consumes, so retirement
     * never invalidates a repository's configuration.
     */
    readonly names: readonly string[];
    /** Names that may actually activate — retired ones excluded. */
    readonly activeNames: readonly string[];
    get(name: string): CapabilityDeclaration | undefined;
}

export type RegistryResult =
    | { readonly ok: true; readonly registry: CapabilityRegistry }
    | { readonly ok: false; readonly errors: readonly string[] };

/**
 * Build the platform's registry from its shipped declarations. Fails
 * closed like `parseConfig`: any invalid declaration or duplicate name
 * yields no registry at all — a platform must not boot with a
 * half-valid capability list.
 */
export function createRegistry(declarations: readonly CapabilityDeclaration[]): RegistryResult {
    const errors: string[] = declarations.flatMap((d) => [...validateDeclaration(d)]);
    for (const dup of duplicates(declarations.map((d) => d.name))) {
        errors.push(`duplicate capability name "${dup}" in the registry`);
    }
    if (errors.length > 0) return { ok: false, errors };

    const byName = new Map(declarations.map((d) => [d.name, d]));
    return {
        ok: true,
        registry: {
            names: declarations.map((d) => d.name),
            activeNames: declarations.filter((d) => d.retired !== true).map((d) => d.name),
            get: (name) => byName.get(name),
        },
    };
}
