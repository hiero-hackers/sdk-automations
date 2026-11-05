/**
 * What a settings spec is, and the two walks over one — capability-kits.md §3.
 * It imports nothing: naming the vocabulary would close a cycle each way.
 */

// ─── What a reader answers ───────────────────────────────────────────

/** Which kind of mistake a problem is — both names are `ConfigErrorCode` members. */
export type SettingsProblemCode = "unknownKey" | "settingInvalid";

export interface SettingsProblem {
    readonly code: SettingsProblemCode;
    /** Dotted, relative to the block — `pullRequests.reapWhen.draft.reapAfter`. */
    readonly path: string;
    readonly message: string;
}

/** Reading a spec, or one field: the typed value, or ALL problems at once. */
export type SettingsResult<T> =
    | { readonly ok: true; readonly value: T }
    | { readonly ok: false; readonly problems: readonly SettingsProblem[] };

// ─── What a spec is ──────────────────────────────────────────────────

/** The lists a spec checks values against — names, never spellings. */
export interface SettingsView {
    readonly mapped: {
        readonly labels: readonly string[];
        readonly commands: readonly string[];
        readonly skills: readonly string[];
        readonly alerts: readonly string[];
    };
    readonly principals: readonly string[];
}

/** One level of the block, and the way out of it (§3.1). */
export interface Scope {
    readonly raw: Readonly<Record<string, unknown>>;
    /** Dotted path of this level, `""` at the block's root. */
    readonly path: string;
    readonly fields: Spec;
    readonly outer: Scope | null;
    readonly view: SettingsView;
}

/** What a `duration` field resolves with. Numbers are HOURS; `default` is written (`4h`). */
export interface DurationOptions {
    readonly default?: string;
    /** What this field inherits from, where the WHOLE path is stated (§3.1). */
    readonly inherits?: string;
    /** `[target, by]` — this field must exceed `target` by at least `by` hours. */
    readonly above?: readonly [string, number];
    /** The smallest value this field may hold, in hours. */
    readonly atLeast?: number;
}

/** What one field is, for the generators, never for a reader; `absent` is DERIVED. */
export interface FieldDescription {
    readonly kind:
        "flag" | "duration" | "count" | "text" | "meanings" | "logins" | "section" | "block";
    readonly doc: string | null;
    readonly absent: "default" | "inherited" | "null" | "empty" | "parked" | "problem";
    /** `flag`, `count`, and a `duration` that declares one — the written form for a duration. */
    readonly default?: boolean | number | string;
    /** `flag` — the family that must map something before the flag may be `true`. */
    readonly needs?: keyof SettingsView["mapped"];
    /** `duration` — the field it cascades from (§3.1), the `[target, by]` gap in hours, and the smallest value it may hold. */
    readonly inherits?: string;
    readonly above?: readonly [string, number];
    readonly atLeast?: number;
    /** `text`. */
    readonly optional?: boolean;
    /** The two group kinds: `section`, `block`. */
    readonly fields?: Readonly<Record<string, FieldDescription>>;
}

/** One field of a spec. It fetches its own raw value: `duration` walks levels (§3.1). */
export interface Field<T> {
    read(key: string, scope: Scope): SettingsResult<T>;
    describe(): FieldDescription;
    /** `cascades` is a `duration` default resolved to HOURS; `within` is the spec one level down, on `section` and `block`. */
    readonly cascades?: { readonly default: number };
    readonly within?: Spec;
}

/** A settings spec: field name → the reader for it. */
export type Spec = Readonly<Record<string, Field<unknown>>>;

export type SettingsOf<S extends Spec> = {
    readonly [K in keyof S]: S[K] extends Field<infer T> ? T : never;
};

export type BlockOf<F extends Spec> =
    { readonly enabled: false } | ({ readonly enabled: true } & SettingsOf<F>);

// ─── Reading one ─────────────────────────────────────────────────────

export function dot(path: string, key: string): string {
    return path === "" ? key : `${path}.${key}`;
}

/** One value the spec could not read. */
export function problem(path: string, message: string): SettingsResult<never> {
    return { ok: false, problems: [{ code: "settingInvalid", path, message }] };
}

/** Every field of one level, each read whether or not an earlier one failed. */
export function readScope<S extends Spec>(fields: S, scope: Scope): SettingsResult<SettingsOf<S>> {
    const problems: SettingsProblem[] = [];
    const read: [string, unknown][] = [];
    for (const [key, field] of Object.entries(fields)) {
        const one = field.read(key, scope);
        if (one.ok) read.push([key, one.value]);
        else problems.push(...one.problems);
    }
    if (problems.length > 0) return { ok: false, problems };
    return { ok: true, value: Object.fromEntries(read) as SettingsOf<S> };
}

/** Read one block against its spec. The parser sweeps top-level keys (D84); groups their own (D4). */
export function readSettings<const S extends Spec>(
    fields: S,
    view: SettingsView,
    raw: Readonly<Record<string, unknown>>,
): SettingsResult<SettingsOf<S>> {
    const own: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const [key, value] of Object.entries(raw)) own[key] = value;
    return readScope(fields, {
        raw: own,
        path: "",
        fields,
        outer: null,
        view: { mapped: view.mapped, principals: view.principals },
    });
}

// ─── Describing one ──────────────────────────────────────────────────

export function describeSpec(fields: Spec): Readonly<Record<string, FieldDescription>> {
    return Object.fromEntries(
        Object.entries(fields).map(([key, field]) => [key, field.describe()]),
    );
}
