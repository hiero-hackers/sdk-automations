/**
 * Live facts for core: grants from the cached mint response, and timeline ordering
 * read once per item per delivery. Ordering is a Date, confirmed absence (null), or
 * "unknown"; failed and incomplete reads are unknown (D51, D119).
 */

import type {
    AdmittedCapability,
    FailureClass,
    HumanChangeOrdering,
    ItemRef,
    PermissionGrant,
    RepositoryConfig,
    RepositoryRef,
    ResolverSource,
} from "@hiero-hackers/automation-core";
import {
    describeFailure,
    lastPageFromLink,
    repoPath,
    type GitHubHttpClient,
    type GitHubOutcome,
} from "../client/contract.js";
import type { Allowance } from "../client/allowance.js";
import { createResolverSource } from "./resolvers.js";
import type { TokenSource } from "../client/token.js";
import { field, jsonArrayOf } from "../client/untrusted.js";

/** The installation's grants, or the classified reason they are unknown. */
export type GrantsOutcome =
    | { readonly ok: true; readonly grants: readonly PermissionGrant[] }
    | { readonly ok: false; readonly failure: FailureClass };

/** Never an invented empty list; no memo, since grants change with token refreshes. */
export async function installationGrants(source: TokenSource): Promise<GrantsOutcome> {
    const outcome = await source.current();
    return outcome.ok
        ? { ok: true, grants: outcome.token.grants }
        : { ok: false, failure: outcome.failure };
}

/** D119: the surfaces whose changes count. Extend when the catalogue adds one, not before. */
const HUMAN_CHANGE_EVENTS: ReadonlySet<string> = new Set([
    "labeled",
    "unlabeled",
    "assigned",
    "unassigned",
    "closed",
    "reopened",
    "commented",
    "committed",
    "convert_to_draft",
    "ready_for_review",
    "reviewed",
    "review_dismissed",
    "review_requested",
]);

/** Timeline calls per item per delivery; past this the answer is `"unknown"`. */
const TIMELINE_READ_CAP = 3;

const TIMELINE_PAGE_SIZE = 100;

/** How long before a landed write's instant its own timeline event may be dated. */
const OWN_WRITE_WINDOW_MS = 60_000;

/** The delivery's causing human action, so it cannot conflict with itself. */
export interface CauseFingerprint {
    readonly actorLogin: string;
    readonly observedAt: Date;
    readonly itemNumber: number;
    readonly action: string;
    readonly target: string | null;
}

/**
 * One completed call the platform made on the item being read — the store's `LandedWrite`.
 * Restated rather than imported, and `main.ts` is where the two shapes are checked against each other.
 */
export interface LandedWrite {
    readonly verb: string | null;
    readonly login: string | null;
    readonly at: string;
}

/** What one delivery's ordering reads need; built fresh per delivery. */
export interface OrderingEvidenceOptions {
    readonly http: GitHubHttpClient;
    readonly repository: RepositoryRef;
    /** What these reads are charged to; unset spends from no lane (D192). */
    readonly allowance?: Allowance;
    /** The item's own landed calls, which GitHub's actor cannot say (D159). */
    readonly ownWrites: (item: ItemRef) => readonly LandedWrite[];
    /** Absent for sweeps and incomplete or unhandled causes — nothing to exclude. */
    readonly cause?: CauseFingerprint;
    /** A diagnostic seam only; it never changes an answer. */
    readonly onUnknownOrdering?: (detail: string) => void;
}

/** GitHub timestamps have second granularity; compare at that granularity. */
const sameSecond = (a: Date, b: Date): boolean =>
    Math.floor(a.getTime() / 1000) === Math.floor(b.getTime() / 1000);

/** The label or assignee identifies the touched target; state changes need neither. */
function changeTarget(entry: unknown, action: string): unknown {
    if (action === "labeled" || action === "unlabeled") return field(field(entry, "label"), "name");
    if (action === "assigned" || action === "unassigned")
        return field(field(entry, "assignee"), "login");
    return null;
}

/**
 * Does the ledger hold a release of this login dated within the window before `at`?
 * A human unassigning the same login in the same minute is indistinguishable, and holds the platform back.
 */
function releasedByApp(login: unknown, at: Date, landed: readonly LandedWrite[]): boolean {
    if (typeof login !== "string") return false;
    return landed.some((write) => {
        if (write.verb !== "releaseAssignment" || write.login !== login) return false;
        const done = new Date(write.at).getTime();
        if (!Number.isFinite(done)) return false;
        const gap = done - at.getTime();
        return gap >= 0 && gap <= OWN_WRITE_WINDOW_MS;
    });
}

/** A `Date`; `null` for an entry that does not count; `"unparsable"` for one that cannot be trusted. */
function humanChangeAt(entry: unknown, landed: readonly LandedWrite[]): Date | null | "unparsable" {
    const kind = field(entry, "event");
    // Stryker disable next-line ConditionalExpression: Set.has answers false for any non-string already; the typeof arm is for readers.
    if (typeof kind !== "string" || !HUMAN_CHANGE_EVENTS.has(kind)) return null;
    const actor = field(entry, "actor");
    const actorType = field(actor, "type");
    if (actorType === "Bot") return null;
    if (actorType !== "User") return "unparsable";
    const createdAt = field(entry, "created_at");
    if (typeof createdAt !== "string") return "unparsable";
    const at = new Date(createdAt);
    if (!Number.isFinite(at.getTime())) return "unparsable";
    // GitHub names the ASSIGNEE as the actor of a release the App made (D159).

    if (kind === "unassigned" && releasedByApp(changeTarget(entry, kind), at, landed)) {
        return null;
    }
    return at;
}

/** Exclude at most one matching cause. Every other change still counts, including ties. */
function newestIn(
    events: readonly unknown[],
    landed: readonly LandedWrite[],
    cause?: CauseFingerprint,
): HumanChangeOrdering {
    let newest: Date | null = null;
    for (const entry of events) {
        const at = humanChangeAt(entry, landed);
        if (at === "unparsable") return "unknown";
        if (at === null) continue;
        if (
            cause !== undefined &&
            field(entry, "event") === cause.action &&
            field(field(entry, "actor"), "login") === cause.actorLogin &&
            sameSecond(at, cause.observedAt) &&
            changeTarget(entry, cause.action) === cause.target
        ) {
            cause = undefined;
            continue;
        }
        // Stryker disable next-line EqualityOperator: at an exact tie the kept and the replacing Date are equal values — the mutant is equivalent.
        if (newest === null || at.getTime() > newest.getTime()) newest = at;
    }
    return newest;
}

interface TimelinePage {
    readonly events: readonly unknown[];
    /** The page `rel="last"` names, or `null` when there is no next page. */
    readonly lastPage: number | null;
}

/** A page, or the reason this read establishes nothing about ordering. */
type PageOutcome = TimelinePage | { readonly unreadable: string };

function parsePage(outcome: GitHubOutcome): PageOutcome {
    if (!outcome.ok) {
        return { unreadable: `GitHub refused the read: ${describeFailure(outcome.failure)}` };
    }
    const events = jsonArrayOf(outcome.body);
    if (events === null) return { unreadable: "GitHub's timeline body was not a JSON array" };
    const link = outcome.headers.link;
    const lastPage = lastPageFromLink(link);
    // This reader walks newest-first from the last page, so it cannot start without one.

    if (lastPage === null && link?.includes('rel="next"')) {
        return { unreadable: "GitHub advertised a next page without naming the last" };
    }
    return { events, lastPage };
}

/**
 * Pages ascend: page one locates the last page, then we walk backwards.
 * Incomplete coverage without a newest-block find must answer `"unknown"`.
 */
async function readOrdering(
    { http, repository, ownWrites, cause, onUnknownOrdering, allowance }: OrderingEvidenceOptions,
    item: ItemRef,
): Promise<HumanChangeOrdering> {
    const landed = ownWrites(item);
    const pageUrl = (page: number): string =>
        `${repoPath(repository)}/issues/${String(item.number)}/timeline` +
        `?per_page=${String(TIMELINE_PAGE_SIZE)}&page=${String(page)}`;
    const read = async (page: number): Promise<PageOutcome> =>
        parsePage(await http.request({ url: pageUrl(page), method: "GET" }, allowance));

    /** Say why, then answer the only word the contract has room for. */
    const unknown = (detail: string): "unknown" => {
        try {
            onUnknownOrdering?.(`#${String(item.number)} ordering unknown: ${detail}`);
        } catch {
            // A diagnostic seam that throws must not change a decision.
        }
        return "unknown";
    };
    const itemCause = cause?.itemNumber === item.number ? cause : undefined;
    /** The newest human change in these events, saying why when it cannot tell. */
    const newestOf = (events: readonly unknown[]): HumanChangeOrdering => {
        const answer = newestIn(events, landed, itemCause);
        return answer === "unknown"
            ? unknown("a timeline entry carried an unreadable actor or timestamp")
            : answer;
    };

    const first = await read(1);
    if ("unreadable" in first) return unknown(`page 1: ${first.unreadable}`);
    const lastPage = first.lastPage ?? 1;
    // Stryker disable next-line ConditionalExpression: the general path below answers a one-page timeline identically; the early return is for readers.
    if (lastPage === 1) return newestOf(first.events);

    const descending: number[] = [];
    for (let page = lastPage; page > 1 && descending.length < TIMELINE_READ_CAP - 1; page -= 1) {
        descending.push(page);
    }
    // Stryker disable next-line ArrayDeclaration: a seeded junk entry is inert — humanChangeAt answers null for anything unrecognizable.
    const recent: unknown[] = [];
    for (const page of descending) {
        const outcome = await read(page);
        if ("unreadable" in outcome) {
            return unknown(`page ${String(page)}: ${outcome.unreadable}`);
        }
        // Keep the visited block together: the cause can be excluded only once.

        recent.push(...outcome.events);
        const newest = newestOf(recent);
        if (newest !== null) return newest;
    }
    // Nothing in the newest block; only complete coverage may answer null.

    return lastPage <= 1 + descending.length
        ? newestOf([...recent, ...first.events])
        : unknown(`the timeline is longer than ${String(TIMELINE_READ_CAP)} reads may cover`);
}

/** The webhook matched to its timeline action; a missing field excludes nothing. */
export function causeFingerprintOf(payload: unknown): CauseFingerprint | undefined {
    const login = field(field(payload, "sender"), "login");
    const item = field(payload, "issue") ?? field(payload, "pull_request");
    const updatedAt = field(item, "updated_at");
    const itemNumber = field(item, "number");
    const action = field(payload, "action");
    if (typeof login !== "string" || typeof updatedAt !== "string") return undefined;
    // Stryker disable next-line ConditionalExpression: isSafeInteger answers false for any non-number; the typeof arm is for readers.
    if (typeof itemNumber !== "number" || !Number.isSafeInteger(itemNumber) || itemNumber < 1)
        return undefined;
    // Stryker disable next-line ConditionalExpression: Set.has answers false for any non-string; the typeof arm is for readers.
    if (typeof action !== "string" || !HUMAN_CHANGE_EVENTS.has(action)) return undefined;
    const target = changeTarget(payload, action);
    if (target !== null && typeof target !== "string") return undefined;
    const observedAt = new Date(updatedAt);
    if (!Number.isFinite(observedAt.getTime())) return undefined;
    return { actorLogin: login, observedAt, itemNumber, action, target };
}

/**
 * One delivery's memo: concurrent intents share each item's in-flight read.
 * The journal is read with the timeline, so a write landing mid-delivery changes no answer already given.
 */
export function orderingEvidenceSource(
    options: OrderingEvidenceOptions,
): (item: ItemRef) => Promise<HumanChangeOrdering> {
    const memo = new Map<string, Promise<HumanChangeOrdering>>();
    return (item) => {
        const key = `${item.kind}#${String(item.number)}`;
        let pending = memo.get(key);
        if (pending === undefined) {
            pending = readOrdering(options, item);
            memo.set(key, pending);
        }
        return pending;
    };
}

/** The two facts the live fill supplies; the shell adds its own. */
export interface LiveExternalFacts {
    readonly installationGrants: readonly PermissionGrant[];
    readonly latestHumanChangeAt: (item: ItemRef) => Promise<HumanChangeOrdering>;
    readonly resolve: ResolverSource;
}

/** One delivery's live facts, or the classified reason there are none. */
export type LiveExternalsOutcome =
    | { readonly ok: true; readonly facts: LiveExternalFacts }
    | { readonly ok: false; readonly failure: FailureClass };

/** Everything the live fill composes over; built once at the composition root. */
export interface LiveExternalsOptions {
    readonly tokenSource: TokenSource;
    readonly http: GitHubHttpClient;
    readonly repository: RepositoryRef;
    /** The delivery's reviewed configuration, passed straight to the resolver source. */
    readonly config: RepositoryConfig;
    /** The declarations the shell ships; the adapter may not import them itself. */
    readonly knownCapabilities: readonly AdmittedCapability[];
    /** What every read of this delivery is charged to; unset spends from no lane (D192). */
    readonly allowance?: Allowance;
    /** Both passed straight to `OrderingEvidenceOptions`. */
    readonly ownWrites: (item: ItemRef) => readonly LandedWrite[];
    readonly onUnknownOrdering?: (detail: string) => void;
}

/** Call once per delivery: the ordering memo inside must not outlive it. */
export async function liveExternalsForDelivery(
    {
        tokenSource,
        http,
        repository,
        config,
        knownCapabilities,
        allowance,
        ownWrites,
        onUnknownOrdering,
    }: LiveExternalsOptions,
    payload: unknown,
): Promise<LiveExternalsOutcome> {
    const grants = await installationGrants(tokenSource);
    if (!grants.ok) return grants;
    const cause = causeFingerprintOf(payload);
    /** What every read below is charged to, or nothing at all. */
    const charged = allowance === undefined ? {} : { allowance };
    return {
        ok: true,
        facts: {
            installationGrants: grants.grants,
            latestHumanChangeAt: orderingEvidenceSource({
                http,
                repository,
                ownWrites,
                ...charged,
                // Stryker disable next-line ConditionalExpression: spreading { cause: undefined } is runtime-identical; the guard serves exactOptionalPropertyTypes.
                ...(cause === undefined ? {} : { cause }),
                // Stryker disable next-line ConditionalExpression: as above — the guard serves exactOptionalPropertyTypes, not behaviour.
                ...(onUnknownOrdering === undefined ? {} : { onUnknownOrdering }),
            }),
            resolve: createResolverSource({
                http,
                repository,
                config,
                knownCapabilities,
                ...charged,
            }),
        },
    };
}
