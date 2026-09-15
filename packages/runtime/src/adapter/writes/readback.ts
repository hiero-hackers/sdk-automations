/**
 * What GitHub says the item looks like now, and when "absent" may be believed.
 * A write is a promise; a read-back is the proof (`design/guides/write-operations.md`).
 * Presence is answered on FIRST sight; absence only after a second read a full gap
 * later, because a wrong "absent" duplicates a comment (D46). REST only — GraphQL
 * and search reads were never measured, and search indexing is known to lag.
 */

import type { ItemRef, RepositoryRef } from "@hiero-hackers/automation-core";
import type { Allowance } from "../client/allowance.js";
import {
    advertisesNextPage,
    describeFailure,
    lastPageFromLink,
    repoPath,
    type GitHubHttpClient,
} from "../client/contract.js";
import { readChangesRequested, readPullRequestActivity } from "../reads/facts.js";
import { readAssigneesOf } from "../reads/resolvers.js";
import { field, jsonArrayOf, jsonRecordOf } from "../client/untrusted.js";

// ─── The chosen bounds ───────────────────────────────────────────────

/**
 * The gap two reads must straddle before absence is believed.
 * Protocol 6.7 measured a p95 of 462 ms from write to visible; this is twice that.
 */
export const ABSENCE_CONFIRMATION_GAP_MS = 1_000;

const READ_BACK_PAGE_SIZE = 100;

/**
 * Pages one read-back will walk before it refuses to answer.
 * Past the cap it refuses rather than answering from a partial list.
 */
const MAX_READ_BACK_PAGES = 5;

// ─── What a read-back answers ────────────────────────────────────────

/**
 * Who this process is on GitHub, so it can recognise its own writing. Injected.
 * Two fields rather than one because either can go missing; either match is enough.
 */
export interface AppIdentity {
    readonly appId: string;
    readonly botLogin: string;
}

/** One comment, as the marker matcher needs it. */
export interface CommentFact {
    readonly id: number;
    readonly body: string;
    readonly authoredByApp: boolean;
}

/**
 * The item itself, as an apply-time re-gate reads it.
 * `merged` is not inferred from `closed` (D47); it and `draft` are `false` for an issue.
 */
export interface ItemFacts {
    readonly labels: readonly string[];
    readonly closed: boolean;
    readonly merged: boolean;
    readonly draft: boolean;
}

/** A read that answered, or the reason it established nothing. */
export type ReadBackOutcome<T> =
    { readonly ok: true; readonly value: T } | { readonly ok: false; readonly detail: string };

/** D46's three answers; `unknown` is not a soft "absent". */
export type Presence = "present" | "absent" | "unknown";

/** The four resources stage C reads, raw or as a presence. */
export interface ReadBack {
    comments(item: ItemRef): Promise<ReadBackOutcome<readonly CommentFact[]>>;
    labels(item: ItemRef): Promise<ReadBackOutcome<readonly string[]>>;
    /** The item's own current facts — one read, no presence rule involved. */
    item(item: ItemRef): Promise<ReadBackOutcome<ItemFacts>>;
    /** Its own read because it is its own call: the reviews list, not the item's body. */
    changesRequested(item: ItemRef): Promise<ReadBackOutcome<boolean>>;
    pullRequestActivity(
        item: ItemRef,
        working: string | undefined,
    ): Promise<ReadBackOutcome<Date | null>>;
    /** The logins on the item now; one read, because a released login cannot come back stale. */
    assignees(item: ItemRef): Promise<ReadBackOutcome<readonly string[]>>;
    /** Is a comment matching `matches` there? Absence obeys the gap above. */
    commentPresence(item: ItemRef, matches: (comment: CommentFact) => boolean): Promise<Presence>;
    /** Is this exact label name there? Absence obeys the gap above. */
    labelPresence(item: ItemRef, label: string): Promise<Presence>;
}

/**
 * Seams the composition root fills, none of them optional.
 * `clock` and `sleep` are REQUIRED: a default holds the gap to a clock nobody chose.
 */
export interface ReadBackOptions {
    readonly http: GitHubHttpClient;
    readonly repository: RepositoryRef;
    /** What these reads are charged to; unset spends from no lane (D192). */
    readonly allowance?: Allowance;
    readonly identity: AppIdentity;
    readonly clock: () => Date;
    readonly sleep: (milliseconds: number) => Promise<void>;
}

// ─── Reading the bytes ───────────────────────────────────────────────

/**
 * Was this comment written by THIS App? Either signal is enough.
 * GitHub sends the App id as a number; the comparison is made on the string spelling.
 */
function authoredByApp(entry: unknown, identity: AppIdentity): boolean {
    const viaAppId = field(field(entry, "performed_via_github_app"), "id");
    if (typeof viaAppId === "number" && String(viaAppId) === identity.appId) return true;
    const user = field(entry, "user");
    return field(user, "type") === "Bot" && field(user, "login") === identity.botLogin;
}

/** One comment as this file reports it, or `null` when it cannot be read. */
function commentFactOf(entry: unknown, identity: AppIdentity): CommentFact | null {
    const id = field(entry, "id");
    const body = field(entry, "body");
    if (typeof id !== "number" || !Number.isSafeInteger(id) || typeof body !== "string") {
        return null;
    }
    return { id, body, authoredByApp: authoredByApp(entry, identity) };
}

/** One label's name, or `null` when the entry does not carry one. */
function labelNameOf(entry: unknown): string | null {
    const name = field(entry, "name");
    return typeof name === "string" && name.length > 0 ? name : null;
}

/**
 * One item's facts, or `null` when the body does not carry all of them.
 * Whole or nothing. `merged` and `draft` are read only for a pull request, and required there.
 */
function itemFactsOf(body: string, kind: ItemRef["kind"]): ItemFacts | null {
    const record = jsonRecordOf(body);
    if (record === null) return null;
    const state = field(record, "state");
    if (state !== "open" && state !== "closed") return null;
    const entries = field(record, "labels");
    if (!Array.isArray(entries)) return null;
    const labels: string[] = [];
    for (const entry of entries) {
        const name = labelNameOf(entry);
        if (name === null) return null;
        labels.push(name);
    }
    const closed = state === "closed";
    if (kind === "issue") return { labels, closed, merged: false, draft: false };
    const merged = field(record, "merged");
    const draft = field(record, "draft");
    return typeof merged === "boolean" && typeof draft === "boolean"
        ? { labels, closed, merged, draft }
        : null;
}

// ─── The read-back ───────────────────────────────────────────────────

export function createReadBack({
    http,
    repository,
    identity,
    clock,
    sleep,
    allowance,
}: ReadBackOptions): ReadBack {
    /** The shape the sibling readers take: this client, this repository, this lane. */
    const reads = { http, repository, ...(allowance === undefined ? {} : { allowance }) };

    /**
     * Every page of one list, or the reason the list is incomplete.
     * Incomplete is a refusal, never a shorter list.
     */
    const readList = async (base: string): Promise<ReadBackOutcome<readonly unknown[]>> => {
        const entries: unknown[] = [];
        let lastPage = 1;
        for (let page = 1; page <= MAX_READ_BACK_PAGES; page += 1) {
            const outcome = await http.request(
                {
                    url: `${base}?per_page=${String(READ_BACK_PAGE_SIZE)}&page=${String(page)}`,
                    method: "GET",
                },
                allowance,
            );
            if (!outcome.ok) {
                return {
                    ok: false,
                    detail: `GitHub refused the read: ${describeFailure(outcome.failure)}`,
                };
            }
            const parsed = jsonArrayOf(outcome.body);
            if (parsed === null) {
                return { ok: false, detail: "GitHub's list body was not a JSON array" };
            }
            entries.push(...parsed);
            const link = outcome.headers.link;
            if (page === 1) {
                const named = lastPageFromLink(link);
                if (named !== null && named > MAX_READ_BACK_PAGES) {
                    return {
                        ok: false,
                        detail: `the list is longer than ${String(MAX_READ_BACK_PAGES)} pages`,
                    };
                }
                lastPage = named ?? lastPage;
            }
            if (page >= lastPage && !advertisesNextPage(link)) return { ok: true, value: entries };
        }
        return {
            ok: false,
            detail: `the list is longer than ${String(MAX_READ_BACK_PAGES)} pages`,
        };
    };

    /** A list read and mapped, refusing whole rather than dropping an entry. */
    const readMapped = async <T>(
        base: string,
        readOne: (entry: unknown) => T | null,
        what: string,
    ): Promise<ReadBackOutcome<readonly T[]>> => {
        const raw = await readList(base);
        if (!raw.ok) return raw;
        const values: T[] = [];
        for (const entry of raw.value) {
            const value = readOne(entry);
            if (value === null)
                return { ok: false, detail: `GitHub returned an unreadable ${what}` };
            values.push(value);
        }
        return { ok: true, value: values };
    };

    const issuePath = (item: ItemRef): string =>
        `${repoPath(repository)}/issues/${String(item.number)}`;

    const comments = (item: ItemRef): Promise<ReadBackOutcome<readonly CommentFact[]>> =>
        readMapped(
            `${issuePath(item)}/comments`,
            (entry) => commentFactOf(entry, identity),
            "comment",
        );

    const labels = (item: ItemRef): Promise<ReadBackOutcome<readonly string[]>> =>
        readMapped(`${issuePath(item)}/labels`, labelNameOf, "label");

    /**
     * The item, from the endpoint that reports its own kind.
     * `/issues/{n}` answers a pull request without `merged`, which is what this establishes.
     */
    const readItem = async (item: ItemRef): Promise<ReadBackOutcome<ItemFacts>> => {
        const resource = item.kind === "issue" ? "issues" : "pulls";
        const outcome = await http.request(
            {
                url: `${repoPath(repository)}/${resource}/${String(item.number)}`,
                method: "GET",
            },
            allowance,
        );
        if (!outcome.ok) {
            return {
                ok: false,
                detail: `GitHub refused the read: ${describeFailure(outcome.failure)}`,
            };
        }
        const facts = itemFactsOf(outcome.body, item.kind);
        return facts === null
            ? { ok: false, detail: "GitHub returned an unreadable item" }
            : { ok: true, value: facts };
    };

    /**
     * D46 over one predicate: present on first sight, absent only after a full gap.
     * The clock is consulted after the pause as well as before; an unconfirmed gap is `unknown`.
     */
    const presenceOf = async <T>(
        read: () => Promise<ReadBackOutcome<readonly T[]>>,
        matches: (value: T) => boolean,
    ): Promise<Presence> => {
        const first = await read();
        if (!first.ok) return "unknown";
        if (first.value.some(matches)) return "present";

        let firstAt: number;
        try {
            firstAt = clock().getTime();
        } catch {
            return "unknown";
        }
        try {
            await sleep(ABSENCE_CONFIRMATION_GAP_MS);
        } catch {
            return "unknown";
        }
        const second = await read();
        if (!second.ok) return "unknown";
        if (second.value.some(matches)) return "present";
        let secondAt: number;
        try {
            secondAt = clock().getTime();
        } catch {
            return "unknown";
        }
        return secondAt - firstAt >= ABSENCE_CONFIRMATION_GAP_MS ? "absent" : "unknown";
    };

    /**
     * The reviews list, folded by the SWEEP's reader rather than by a second one here.
     * `false` for an issue is the fact, not a guess: it has no review decision to lift.
     */
    const changesRequestedOn = async (item: ItemRef): Promise<ReadBackOutcome<boolean>> =>
        item.kind === "pullRequest"
            ? await readChangesRequested(reads, item.number)
            : { ok: true, value: false };

    return {
        comments,
        labels,
        item: readItem,
        changesRequested: changesRequestedOn,
        pullRequestActivity: (item, working) =>
            item.kind === "pullRequest"
                ? readPullRequestActivity(reads, item.number, working)
                : Promise.resolve({ ok: true, value: null }),
        // The resolvers' reader, not a second one: assignees arrive whole on the item (6.9).

        assignees: (item) => readAssigneesOf(reads, item.number),
        commentPresence: (item, matches) => presenceOf(() => comments(item), matches),
        // Exact names: this asks about the managed name the platform itself wrote (D4).

        labelPresence: (item, label) =>
            presenceOf(
                () => labels(item),
                (name) => name === label,
            ),
    };
}
