/**
 * Live facts for core: grants from the cached mint response, and timeline
 * ordering read once per item per delivery. Ordering is a Date, confirmed
 * absence (null), or "unknown"; failed/incomplete reads are unknown (D51, D119).
 */

import type {
    FailureClass,
    HumanChangeOrdering,
    ItemRef,
    PermissionGrant,
    RepositoryRef,
    ResolverSource,
} from "@hiero-hackers/automation-core";
import {
    describeFailure,
    lastPageFromLink,
    repoPath,
    type GitHubHttpClient,
    type GitHubOutcome,
} from "./http.js";
import { createResolverSource } from "./resolvers.js";
import type { TokenSource } from "./token.js";
import { field, jsonArrayOf } from "./untrusted.js";

/** The installation's grants, or the classified reason they are unknown. */
export type GrantsOutcome =
    | { readonly ok: true; readonly grants: readonly PermissionGrant[] }
    | { readonly ok: false; readonly failure: FailureClass };

/**
 * Current token grants, or the classified mint failure — never an invented
 * empty list (which would wrongly mean "granted nothing"). No memo here:
 * grants change with token refreshes.
 */
export async function installationGrants(source: TokenSource): Promise<GrantsOutcome> {
    const outcome = await source.current();
    return outcome.ok
        ? { ok: true, grants: outcome.token.grants }
        : { ok: false, failure: outcome.failure };
}

/**
 * D119: mapped labels, assignment, and the open/closed state decisions read.
 * Extend this list when the intent catalogue adds a surface, not before.
 */
const HUMAN_CHANGE_EVENTS: ReadonlySet<string> = new Set([
    "labeled",
    "unlabeled",
    "assigned",
    "unassigned",
    "closed",
    "reopened",
]);

/** Timeline calls per item per delivery; past this the answer is `"unknown"`. */
const TIMELINE_READ_CAP = 3;

const TIMELINE_PAGE_SIZE = 100;

/** The delivery's causing human action, so it cannot conflict with itself. */
export interface CauseFingerprint {
    readonly actorLogin: string;
    readonly observedAt: Date;
    readonly itemNumber: number;
    readonly action: string;
    readonly target: string | null;
}

/**
 * What one delivery's ordering reads need; built fresh per delivery.
 *
 * `onUnknownOrdering` exists because core's `HumanChangeOrdering` has room for
 * `"unknown"` and nothing else. A refusal by GitHub, a nonsense body, and a
 * timeline too long to read all reach a decision as the same word, and they
 * need different fixes — so the reason leaves through a seam the composition
 * root points at its log instead of dying here. It never changes an answer.
 */
export interface OrderingEvidenceOptions {
    readonly http: GitHubHttpClient;
    readonly repository: RepositoryRef;
    /** Absent for sweeps and incomplete/unhandled causes — nothing to exclude. */
    readonly cause?: CauseFingerprint;
    readonly onUnknownOrdering?: (detail: string) => void;
}

/** GitHub timestamps have second granularity; compare at that granularity. */
const sameSecond = (a: Date, b: Date): boolean =>
    Math.floor(a.getTime() / 1000) === Math.floor(b.getTime() / 1000);

/**
 * When this timeline entry counts as a human change: a `Date`; `null` for
 * an entry that does not count — an ignored kind or a known bot;
 * `"unparsable"` for one that cannot be trusted either way — an unknown
 * actor type or an unorderable timestamp, refusing rather than ignoring.
 */
function humanChangeAt(entry: unknown): Date | null | "unparsable" {
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
    return at;
}

/** The label or assignee identifies the touched target; state changes need neither. */
function changeTarget(entry: unknown, action: string): unknown {
    if (action === "labeled" || action === "unlabeled") return field(field(entry, "label"), "name");
    if (action === "assigned" || action === "unassigned")
        return field(field(entry, "assignee"), "login");
    return null;
}

/** Exclude at most one matching cause. Every other change still counts, including ties. */
function newestIn(events: readonly unknown[], cause?: CauseFingerprint): HumanChangeOrdering {
    let newest: Date | null = null;
    for (const entry of events) {
        const at = humanChangeAt(entry);
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
    // GitHub may advertise a next page without knowing the last page.
    // We cannot walk newest-first in that case; absence would be a guess.
    if (lastPage === null && link?.includes('rel="next"')) {
        return { unreadable: "GitHub advertised a next page without naming the last" };
    }
    return { events, lastPage };
}

/**
 * Pages ascend: page one locates the last page, then we walk backwards.
 * A find in that newest block is authoritative and saves further calls.
 * A page-one find with unvisited middle pages is not; under the call cap,
 * incomplete coverage without a newest-block find must answer "unknown".
 */
async function readOrdering(
    { http, repository, cause, onUnknownOrdering }: OrderingEvidenceOptions,
    item: ItemRef,
): Promise<HumanChangeOrdering> {
    const pageUrl = (page: number): string =>
        `${repoPath(repository)}/issues/${String(item.number)}/timeline` +
        `?per_page=${String(TIMELINE_PAGE_SIZE)}&page=${String(page)}`;
    const read = async (page: number): Promise<PageOutcome> =>
        parsePage(await http.request({ url: pageUrl(page), method: "GET" }));

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
        const answer = newestIn(events, itemCause);
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
        // Keep the visited block together: the cause can be excluded only once,
        // even when two same-second actions straddle a page boundary.
        recent.push(...outcome.events);
        const newest = newestOf(recent);
        if (newest !== null) return newest;
    }
    // Nothing in the newest block; only complete coverage may answer null.
    return lastPage <= 1 + descending.length
        ? newestOf([...recent, ...first.events])
        : unknown(`the timeline is longer than ${String(TIMELINE_READ_CAP)} reads may cover`);
}

/**
 * Match the webhook to its timeline action. `updated_at` is also core's
 * causeObservedAt: both must describe the same instant to avoid self-conflict.
 * Missing action, target, sender or dated item excludes nothing, erring
 * toward refusal rather than hiding a human change.
 */
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
 * Never reuse it across deliveries. ETags below reduce quota, not freshness:
 * each conditional read revalidates with GitHub.
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
    /** Passed straight to `OrderingEvidenceOptions`; see that type for why. */
    readonly onUnknownOrdering?: (detail: string) => void;
}

/**
 * One delivery's live externals: grants resolved now — they gate every
 * intent — and ordering evidence read per item on demand. Call once per
 * delivery: the ordering memo inside must not outlive it.
 */
export async function liveExternalsForDelivery(
    { tokenSource, http, repository, onUnknownOrdering }: LiveExternalsOptions,
    payload: unknown,
): Promise<LiveExternalsOutcome> {
    const grants = await installationGrants(tokenSource);
    if (!grants.ok) return grants;
    const cause = causeFingerprintOf(payload);
    return {
        ok: true,
        facts: {
            installationGrants: grants.grants,
            latestHumanChangeAt: orderingEvidenceSource({
                http,
                repository,
                // Stryker disable next-line ConditionalExpression: spreading { cause: undefined } is runtime-identical; the guard serves exactOptionalPropertyTypes.
                ...(cause === undefined ? {} : { cause }),
                // Stryker disable next-line ConditionalExpression: as above — the guard serves exactOptionalPropertyTypes, not behaviour.
                ...(onUnknownOrdering === undefined ? {} : { onUnknownOrdering }),
            }),
            resolve: createResolverSource({
                http,
                repository,
            }),
        },
    };
}
