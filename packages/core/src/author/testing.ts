/**
 * The fixture harness a capability's tests build on: a configuration builder,
 * the subset enumerator, and the record builders. Every answer is read off the
 * platform's own tables, so a table that changes moves the fixtures with it.
 */

import {
    carriesFactGroup,
    FACT_GROUPS,
    UNREAD,
    type FactGroup,
    type FactKind,
    type Facts,
    type ResolverAnswer,
    type ResolverInput,
    type ResolverName,
    type ResolverOutput,
} from "../catalogue.js";
import {
    describeSpec,
    type FieldDescription,
    type SettingsView,
    type Spec,
} from "../config/spec.js";
import { parseConfig } from "../config/parse.js";
import type { AdmittedCapability, RepositoryConfig } from "../config/schema.js";
import type { TypedDeclaration } from "../capability/declaration.js";
import type { FactsFor } from "../capability/boundary.js";
import {
    producerReads,
    producersReading,
    type ProducedFacts,
    type ProducerName,
} from "../capability/producers.js";

/** The three meanings a repository maps unless a suite asks for others. */
const LABELS: Readonly<Record<string, string>> = {
    awaitingTriage: "status: triage",
    inProgress: "status: in progress",
    blocked: "blocked",
};

/**
 * The principal a probe document declares when the suite named none.
 *
 * A spec may REQUIRE a principal, and a name is only one because the document
 * declared it: one declared name is what makes the smallest block buildable.
 */
const PRINCIPALS: Readonly<Record<string, string>> = {
    maintainerTeam: "hiero-hackers/maintainers",
};

/**
 * The names a document offers a spec: its mapped families and its principals.
 * The defaults are `configEnabling`'s own, so a block built for the default
 * document and then enabled reads one answer, not two.
 */
export function namesOffered(
    mappings: Readonly<Record<string, unknown>> = { labels: LABELS },
    principals: Readonly<Record<string, string>> = PRINCIPALS,
): SettingsView {
    const family = (name: string): readonly string[] => {
        const written = mappings[name];
        return typeof written === "object" && written !== null ? Object.keys(written) : [];
    };
    return {
        mapped: {
            labels: family("labels"),
            commands: family("commands"),
            skills: family("skills"),
            alerts: family("alerts"),
        },
        principals: Object.keys(principals),
    };
}

/**
 * The smallest value one REQUIRED field admits.
 *
 * Only the kinds whose `absent` can be `problem` have one: a required form not
 * named here throws rather than answering `undefined` at the maintainer's key.
 */
function smallestValue(key: string, field: FieldDescription, names: SettingsView): unknown {
    switch (field.kind) {
        case "principal":
            return names.principals[0];
        case "oneOf":
            return field.values?.[0];
        case "text":
            return "x";
        case "duration":
            return "1h";
        case "count":
            return 0;
        default:
            throw new Error(`no smallest value for a required "${field.kind}" at "${key}"`);
    }
}

/** One level of a described spec, and the levels an absent key still reads. */
function smallestIn(
    described: Readonly<Record<string, FieldDescription>>,
    names: SettingsView,
): Record<string, unknown> {
    const written: Record<string, unknown> = {};
    for (const [key, field] of Object.entries(described)) {
        if (field.kind === "section") {
            const inner = smallestIn(field.fields ?? {}, names);
            if (Object.keys(inner).length > 0) written[key] = inner;
            continue;
        }
        if (field.absent === "problem") written[key] = smallestValue(key, field, names);
    }
    return written;
}

/**
 * The smallest settings block a spec accepts: every key whose absence is a
 * PROBLEM, at the smallest value its kind admits, and nothing else. Read off
 * `describeSpec`, so the answer moves with the spec rather than with a fixture.
 */
export function smallestValidSettings(
    fields: Spec,
    names: SettingsView,
): Readonly<Record<string, unknown>> {
    return smallestIn(describeSpec(fields), names);
}

/** One level of a described spec, with everything a file can state stated. */
function fullestIn(
    described: Readonly<Record<string, FieldDescription>>,
    names: SettingsView,
): Record<string, unknown> {
    const written: Record<string, unknown> = {};
    for (const [key, field] of Object.entries(described)) {
        if (field.kind === "block") {
            written[key] = { enabled: true, ...fullestIn(field.fields ?? {}, names) };
        } else if (field.kind === "section" || field.kind === "closed") {
            written[key] = fullestIn(field.fields ?? {}, names);
        } else if (field.absent === "problem") {
            written[key] = smallestValue(key, field, names);
        } else if (field.kind === "flag") {
            // A flag is a switch, and "fullest" throws every switch.
            written[key] = true;
        } else if (field.default !== undefined) {
            written[key] = field.default;
        }
    }
    return written;
}

/**
 * The settings block that switches a spec on: every block consented to, every
 * flag `true`, every required key at its smallest value, every other key at its
 * own default. The three kinds a fixture cannot invent stay absent.
 */
export function fullestValidSettings(
    fields: Spec,
    names: SettingsView,
): Readonly<Record<string, unknown>> {
    return fullestIn(describeSpec(fields), names);
}

/**
 * A repository configuration enabling exactly the named capabilities, out of
 * the declarations `known` admits. `mappings` and `principals` are parameters
 * because a capability's rules can depend on what the document maps or declares.
 */
export function configEnabling(
    enabled: readonly string[],
    known: readonly AdmittedCapability[],
    extra: Readonly<Record<string, Readonly<Record<string, unknown>>>> = {},
    mappings: Readonly<Record<string, unknown>> = { labels: LABELS },
    principals: Readonly<Record<string, string>> = PRINCIPALS,
): RepositoryConfig {
    for (const name of enabled) {
        if (known.some((declaration) => declaration.name === name)) continue;
        throw new Error(
            `no declaration named "${name}" among the ${String(known.length)} admitted`,
        );
    }
    const offered = namesOffered(mappings, principals);
    const capabilities: Record<string, unknown> = {};
    for (const declaration of known) {
        // Flat, as a maintainer writes it: consent, then the capability's own keys.
        // Every block starts at its smallest valid settings, enabled or not (D84).
        capabilities[declaration.name] = {
            enabled: enabled.includes(declaration.name),
            ...smallestValidSettings(declaration.settings, offered),
            ...extra[declaration.name],
        };
    }
    const result = parseConfig(
        { schemaVersion: 2, mode: "active", capabilities, mappings, principals },
        { revision: "rev-1", knownCapabilities: known },
    );
    if (!result.ok) {
        throw new Error(`probe config invalid: ${result.errors.map((e) => e.message).join("; ")}`);
    }
    return result.config;
}

/** Every subset of the given names, smallest first. */
export function subsets<T>(items: readonly T[]): readonly (readonly T[])[] {
    const out: T[][] = [[]];
    for (const item of items) {
        for (const existing of [...out]) out.push([...existing, item]);
    }
    return out.sort((a, b) => a.length - b.length);
}

/** A record exactly as producer `P` makes one for kind `K` — the fixture's name for it. */
export type RecordFrom<P extends ProducerName, K extends FactKind> = ProducedFacts<P, K>;

/** When every built record was observed, and where — what a test's expected intent restates. */
export const OBSERVED_AT = new Date("2026-08-03T09:00:00.000Z");
export const REPOSITORY = { owner: "hiero-hackers", repo: "sandbox" } as const;

/** A resolver source with one answer for every question a capability asks. */
export const answering =
    (answer: unknown) =>
    async <Q extends ResolverName>(
        _query: Q,
        _input: ResolverInput<Q>,
    ): Promise<ResolverAnswer<ResolverOutput<Q>>> =>
        await Promise.resolve(answer as ResolverAnswer<ResolverOutput<Q>>);

/** Open, unpositioned, unpaused — the position every record starts from. */
const OPEN = {
    kind: "position",
    state: { meaning: null, blocked: false, closedBy: null },
    ignored: [],
} as const;

/**
 * What each group holds when its producer read it — the smallest true answer,
 * so a suite that cares about a clock or a link states it as an override.
 */
const READ: { readonly [K in FactKind]: { readonly [G in FactGroup]?: unknown } } = {
    issue: {
        assignees: [],
        links: { openPullRequests: [] },
        // Read and empty: no command issued, which `UNREAD` is not (facts.md §2).
        command: null,
    },
    pullRequest: {
        assignees: [],
        links: { issues: [] },
        review: {
            changesRequested: false,
            reapableSince: {
                needsRevision: new Date("2026-07-01T00:00:00.000Z"),
                changesRequested: new Date("2026-07-01T00:00:00.000Z"),
                draft: new Date("2026-07-01T00:00:00.000Z"),
            },
            lastCommitAt: null,
        },
        readiness: { draft: true },
    },
};

/** One number per producer and kind, so a suite holding several can tell them apart. */
const NUMBERS: Readonly<Record<string, number>> = {
    "issues/issue": 11,
    "pull_request/pullRequest": 12,
    "sweep/issue": 13,
    "sweep/pullRequest": 14,
    "issue_comment/issue": 15,
};

/**
 * One record as the named producer makes it. The loop fills exactly the groups
 * `RecordFrom` types as read, because both read the same registry, and
 * `FACT_GROUPS` is what stops a group nobody enumerated going missing.
 */
export function recordFrom<P extends ProducerName, K extends FactKind>(
    producer: P,
    kind: K,
    over: Partial<RecordFrom<P, K>> = {},
): RecordFrom<P, K> {
    const groups: Record<string, unknown> = {};
    for (const group of FACT_GROUPS) {
        if (!carriesFactGroup(kind, group)) continue;
        groups[group] = producerReads(producer, kind, group) ? READ[kind][group] : UNREAD;
    }
    return {
        kind,
        repository: REPOSITORY,
        item: { kind, number: NUMBERS[`${producer}/${kind}`] ?? 1 },
        observedAt: OBSERVED_AT,
        trigger: producer === "sweep" ? { kind: "sweep" } : { kind: "event", event: producer },
        author: "opener",
        // Nobody causes a sweep; a delivery has a sender. Neither is a group.
        actor: producer === "sweep" ? null : { login: "actor" },
        ...(kind === "issue"
            ? { locked: false, arrival: producer === "issues" ? { kind: "opened" } : null }
            : {}),
        position: OPEN,
        alerts: { carried: [], arrived: [] },
        ...groups,
        ...over,
    } as RecordFrom<P, K>;
}

/** An issue as a webhook produces it: the projection read, every group unread. */
export function webhookIssue(
    over: Partial<RecordFrom<"issues", "issue">> = {},
): RecordFrom<"issues", "issue"> {
    return recordFrom("issues", "issue", over);
}

/** An issue as a sweep produces it: every group read. */
export function sweptIssue(
    over: Partial<RecordFrom<"sweep", "issue">> = {},
): RecordFrom<"sweep", "issue"> {
    return recordFrom("sweep", "issue", over);
}

/** An issue as a comment delivery produces it: the command read, nothing else. */
export function commentedIssue(
    over: Partial<RecordFrom<"issue_comment", "issue">> = {},
): RecordFrom<"issue_comment", "issue"> {
    return recordFrom("issue_comment", "issue", over);
}

/** A pull request as a webhook produces it — `review` unread with the rest. */
export function webhookPullRequest(
    over: Partial<RecordFrom<"pull_request", "pullRequest">> = {},
): RecordFrom<"pull_request", "pullRequest"> {
    return recordFrom("pull_request", "pullRequest", over);
}

/** A pull request as a sweep produces it: every group read. */
export function sweptPullRequest(
    over: Partial<RecordFrom<"sweep", "pullRequest">> = {},
): RecordFrom<"sweep", "pullRequest"> {
    return recordFrom("sweep", "pullRequest", over);
}

/**
 * One producer's record as one DECLARATION sees it: the kind must be declared
 * and every declared need the kind carries must be read, or the projection the
 * engine performs at the boundary would be a lie the fixture told.
 */
export function factsFor<D extends TypedDeclaration>(declaration: D, record: Facts): FactsFor<D> {
    const kind: FactKind = record.kind;
    if (!declaration.facts.includes(kind)) {
        throw new Error(`capability "${declaration.name}" declares no "${kind}" record`);
    }
    const unread = new Set(
        Object.entries(record)
            .filter(([, value]) => value === UNREAD)
            .map(([key]) => key),
    );
    for (const group of declaration.needs) {
        if (!carriesFactGroup(kind, group)) continue;
        if (!unread.has(group)) continue;
        throw new Error(
            `capability "${declaration.name}": "${group}" is unread on this ${kind} record — read by: ${producersReading(kind, group).join(", ")}`,
        );
    }
    // THE ONE CAST, standing on the two checks above: they are `FactsFor`'s own
    // clauses, asked of a value rather than of a type.
    return record as FactsFor<D>;
}
