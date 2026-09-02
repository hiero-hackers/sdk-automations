/**
 * What GitHub says the item looks like now, and when "absent" may be believed.
 *
 * A write is a promise; a read-back is the proof (`design/guides/effects.md`).
 * Two resources are read here because those are the two stage C confirms: an
 * item's comments, for marker matching, and an item's current labels.
 *
 * The freshness rule is D46's, and it is asymmetric on purpose. Presence is
 * answered on FIRST sight, because a visible effect is a landed effect.
 * Absence is answered only after a second read at least a second later,
 * because "absent" triggers a re-send and a wrong "absent" duplicates a
 * comment. Protocol 6.7 saw no staleness in forty trials — the second read is
 * insurance at one API call, spent only on the rare recovery path.
 *
 * REST only. GraphQL and search reads were never measured, and search indexing
 * is known to lag, so neither may answer a freshness question here.
 */

import type { ItemRef, RepositoryRef } from "@hiero-hackers/automation-core";
import { describeFailure, lastPageFromLink, repoPath, type GitHubHttpClient } from "./http.js";
import { field, jsonArrayOf } from "./untrusted.js";

// ─── The chosen bounds ───────────────────────────────────────────────

/**
 * The gap two reads must straddle before absence is believed.
 *
 * Protocol 6.7 measured a p95 of 462 ms from write to visible, on forty trials
 * where every write was already visible on the first read. One second is
 * roughly twice that p95: enough to be evidence, cheap enough to spend inside
 * a claimed delivery.
 */
export const ABSENCE_CONFIRMATION_GAP_MS = 1_000;

const READ_BACK_PAGE_SIZE = 100;

/**
 * Pages one read-back will walk before it refuses to answer.
 *
 * Five hundred comments is far past anything this platform should be matching
 * a marker in while holding a claim. Past the cap the read refuses rather than
 * answering from a partial list — a marker missing from four of six pages is
 * not an absence.
 */
const MAX_READ_BACK_PAGES = 5;

// ─── What a read-back answers ────────────────────────────────────────

/**
 * Who this process is on GitHub, so it can recognise its own writing.
 *
 * Injected, because nothing on the write path can supply it. The mint response
 * carries `token`, `expires_at` and `permissions` and no identity at all (see
 * `mint.ts`), and `GET /app` authenticates with the App assertion rather than
 * an installation token — the same constraint that gave minting its own POST.
 * Both fields come from the one App registration the composition root already
 * holds: `appId` is `AppCredentials.appId`, and `botLogin` is the installation's
 * `"<slug>[bot]"` login.
 *
 * Two fields rather than one because either can go missing.
 * `performed_via_github_app` is not a field this project has ever probed on the
 * comments endpoint, and a login is one rename away from wrong. Either match
 * is enough, deliberately: a FALSE "not ours" on our own marker is what makes
 * a capability write a second comment (6.5), and `[bot]` logins are reserved,
 * so being generous about recognising ourselves cannot mistake a person.
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

/** A read that answered, or the reason it established nothing. */
export type ReadBackOutcome<T> =
    { readonly ok: true; readonly value: T } | { readonly ok: false; readonly detail: string };

/**
 * D46's three answers. `unknown` is not a soft "absent": it means the rule was
 * not satisfied, and a caller that treats it as absence has skipped the rule.
 */
export type Presence = "present" | "absent" | "unknown";

/** The two resources stage C confirms, read raw or read as a presence. */
export interface ReadBack {
    comments(item: ItemRef): Promise<ReadBackOutcome<readonly CommentFact[]>>;
    labels(item: ItemRef): Promise<ReadBackOutcome<readonly string[]>>;
    /** Is a comment matching `matches` there? Absence obeys the gap above. */
    commentPresence(item: ItemRef, matches: (comment: CommentFact) => boolean): Promise<Presence>;
    /** Is this exact label name there? Absence obeys the gap above. */
    labelPresence(item: ItemRef, label: string): Promise<Presence>;
}

/**
 * Seams the composition root fills, none of them optional.
 *
 * `clock` and `sleep` are injected for the reason `http.ts`'s are: a suite
 * that waited a real second per absence would take minutes and prove nothing
 * the recorded pause does not prove instantly. They are REQUIRED rather than
 * defaulted because the gap is the rule this file exists for, and a default is
 * a way to hold that rule to a clock nobody chose. Production fills `sleep`
 * with `wait`, which the package exports for exactly this.
 */
export interface ReadBackOptions {
    readonly http: GitHubHttpClient;
    readonly repository: RepositoryRef;
    readonly identity: AppIdentity;
    readonly clock: () => Date;
    readonly sleep: (milliseconds: number) => Promise<void>;
}

// ─── Reading the bytes ───────────────────────────────────────────────

/**
 * Was this comment written by THIS App?
 *
 * Either signal is enough; see `AppIdentity` for why. GitHub sends the App id
 * as a number and this package holds it as a string, so the comparison is made
 * on the string spelling rather than by coercing the configured value.
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

// ─── The read-back ───────────────────────────────────────────────────

export function createReadBack({
    http,
    repository,
    identity,
    clock,
    sleep,
}: ReadBackOptions): ReadBack {
    /**
     * Every page of one list, or the reason the list is incomplete.
     *
     * Incomplete is a refusal, never a shorter list: a presence question
     * answered from four of six pages is a wrong "absent" waiting to happen.
     * Page one names the last page in its `link` header; a next page with no
     * named last means the walk cannot be bounded, so it refuses too.
     */
    const readList = async (base: string): Promise<ReadBackOutcome<readonly unknown[]>> => {
        const entries: unknown[] = [];
        let lastPage = 1;
        for (let page = 1; page <= lastPage; page += 1) {
            const outcome = await http.request({
                url: `${base}?per_page=${String(READ_BACK_PAGE_SIZE)}&page=${String(page)}`,
                method: "GET",
            });
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
            if (page > 1) continue;
            const link = outcome.headers.link;
            const named = lastPageFromLink(link);
            if (named === null) {
                if (link !== undefined && link.includes('rel="next"')) {
                    return {
                        ok: false,
                        detail: "GitHub advertised a next page without naming the last",
                    };
                }
                continue;
            }
            if (named > MAX_READ_BACK_PAGES) {
                return {
                    ok: false,
                    detail: `the list is longer than ${String(MAX_READ_BACK_PAGES)} pages`,
                };
            }
            lastPage = named;
        }
        return { ok: true, value: entries };
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
     * D46 over one predicate: present on first sight, absent only after a
     * second read the clock agrees was a full gap later.
     *
     * The clock is consulted AFTER the pause as well as before it, and a gap
     * the clock does not confirm answers `unknown`. A sleep seam that returns
     * early is the failure this catches, and it is not hypothetical — every
     * test in this package injects one.
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

    return {
        comments,
        labels,
        commentPresence: (item, matches) => presenceOf(() => comments(item), matches),
        // Exact names. GitHub stores the case a label was created with, and
        // this asks about the managed name the platform itself wrote (D4).
        labelPresence: (item, label) =>
            presenceOf(
                () => labels(item),
                (name) => name === label,
            ),
    };
}
