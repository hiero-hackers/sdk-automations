/**
 * The shapes and spellings every GitHub exchange in this package speaks.
 * Nothing here judges a request or sends one.
 */

import type { FailureClass } from "@hiero-hackers/automation-core";
import type { Allowance, Lane } from "./allowance.js";
import type { TokenSource } from "./token.js";

// ─── The shared constants ────────────────────────────────────────────

/** The REST version this client has been checked against. */
export const GITHUB_API_VERSION = "2026-03-10";

/** Installation credentials never leave GitHub's public API origin. */
export const GITHUB_API_ORIGIN = "https://api.github.com";

/** The only POST target: GitHub's read-only GraphQL query endpoint. */
export const GITHUB_GRAPHQL_URL = `${GITHUB_API_ORIGIN}/graphql`;

/** A request gets this long per attempt unless the composition root chooses less. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

/** Sent on every request this package makes, the mint's POST included. */
export const USER_AGENT = "hiero-hackers-sdk-automations";

// ─── The request vocabulary ──────────────────────────────────────────

interface GitHubGetRequest {
    readonly url: string;
    readonly method: "GET";
    readonly headers?: Readonly<Record<string, string>>;
}

export interface GitHubGraphqlRequest {
    readonly url: string;
    readonly method: "POST";
    readonly body: string;
    readonly headers?: Readonly<Record<string, string>>;
}

/** The CALLER declares it; nothing in a method or a URL says it. */
export type WriteIdempotency = "idempotent" | "nonIdempotent";

/** `idempotency` is what marks a request as a write at all. */
export interface GitHubWriteRequest {
    readonly url: string;
    readonly method: "POST" | "DELETE" | "PATCH";
    readonly body?: string;
    readonly headers?: Readonly<Record<string, string>>;
    readonly idempotency: WriteIdempotency;
}

/** REST reads, the one admitted GraphQL POST, or an admitted REST write. */
export type GitHubRequest = GitHubGetRequest | GitHubGraphqlRequest | GitHubWriteRequest;

/** A usable response, whether GitHub sent the body or the cache held it. */
export interface GitHubSuccess {
    readonly ok: true;
    readonly status: number;
    readonly body: string;
    readonly headers: Readonly<Record<string, string>>;
    readonly fromCache: boolean;
}

/** A classified failure; response fields are absent when nothing was sent. */
export interface GitHubFailure {
    readonly ok: false;
    readonly failure: GitHubHttpFailureClass;
    readonly status?: number;
    readonly body?: string;
    readonly headers?: Readonly<Record<string, string>>;
}

/** Why the adapter refused or could not construct a request locally. */
export type NotSentReason =
    | "disallowedMethod"
    | "disallowedOrigin"
    | "malformedUrl"
    | "invalidHeaders"
    | "invalidBody"
    | "allowanceExhausted"
    | "contentCreationCeiling"
    | "brokenSeam";

/** The injected seam a `brokenSeam` refusal names as the one that failed. */
export type BrokenSeam =
    "tokenSource" | "clock" | "timeoutSignal" | "tokenValue" | "invalidate" | "response" | "sleep";

/** Core owns the response classes; the adapter adds the two it cannot have. */
export type GitHubHttpFailureClass =
    | FailureClass
    | { readonly kind: "responseTooLarge"; readonly limitBytes: number }
    | {
          readonly kind: "notSent";
          readonly reason: Exclude<NotSentReason, "brokenSeam" | "allowanceExhausted">;
      }
    | { readonly kind: "notSent"; readonly reason: "allowanceExhausted"; readonly lane: Lane }
    | { readonly kind: "notSent"; readonly reason: "brokenSeam"; readonly seam: BrokenSeam };

/** What one call to `request()` resolves to — it never throws. */
export type GitHubOutcome = GitHubSuccess | GitHubFailure;

/** The `x-ratelimit-*` headers of the most recent actual response. */
export interface RateLimitSnapshot {
    readonly url: string;
    readonly status: number;
    readonly headers: Readonly<Record<string, string>>;
}

/** The shape of `fetch`, named so tests can script it. */
export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/** Seams the composition root supplies; only the token source is required. */
export interface GitHubHttpClientOptions {
    readonly tokenSource: TokenSource;
    readonly fetch?: FetchLike;
    readonly clock?: () => Date;
    readonly sleep?: (milliseconds: number) => Promise<void>;
    readonly timeoutMs?: number;
    /** Injection keeps timeout tests deterministic; production uses `AbortSignal.timeout`. */
    readonly timeoutSignal?: (milliseconds: number) => AbortSignal;
    /** Comments both lanes may create per hour; the default is `CONTENT_CREATION_HOURLY`. */
    readonly contentCreationHourly?: number;
}

/** What every operation calls. */
export interface GitHubHttpClient {
    /** Charged to `allowance`, in GitHub's units, after the response (D192). */
    request(request: GitHubRequest, allowance?: Allowance): Promise<GitHubOutcome>;
    /** The last actual response, including a response that was retried. */
    latestRateLimit(): RateLimitSnapshot | null;
}

// ─── The spellings ───────────────────────────────────────────────────

/** The one spelling of a repository's API path: owner and repo encoded identically. */
export function repoPath(repository: { readonly owner: string; readonly repo: string }): string {
    return (
        `${GITHUB_API_ORIGIN}/repos/${encodeURIComponent(repository.owner)}` +
        `/${encodeURIComponent(repository.repo)}`
    );
}

/** Lower-cased header record, the shape core's classifier reads. */
export function headersToRecord(headers: Headers): Record<string, string> {
    const record: Record<string, string> = {};
    headers.forEach((value, name) => {
        record[name.toLowerCase()] = value;
    });
    return record;
}

/** The page `rel="last"` names, or `null` when absent. Not a completeness claim. */
export function lastPageFromLink(link: string | undefined): number | null {
    // Stryker disable next-line ConditionalExpression: exec stringifies undefined and misses; the guard is for readers.
    if (link === undefined) return null;
    const match = /[?&]page=(\d+)[^>]*>;\s*rel="last"/.exec(link);
    return match === null ? null : Number(match[1]);
}

/** A cursor-paginated list carries `rel="next"` and no `rel="last"`; ask this, not the above. */
export function advertisesNextPage(link: string | undefined): boolean {
    return link !== undefined && link.includes('rel="next"');
}

/** Does this request declare itself a write? Only the write arm may. */
export function isWrite(request: GitHubRequest): request is GitHubWriteRequest {
    return "idempotency" in request;
}

/** The body a request carries, or `undefined` when it carries none. */
export function bodyOf(request: GitHubRequest): string | undefined {
    if (!("body" in request)) return undefined;
    return typeof request.body === "string" ? request.body : undefined;
}

// ─── The failures ────────────────────────────────────────────────────

/** Genuine transport weather — the one locally-made class worth a retry. */
export function transportFailure(): GitHubFailure {
    return { ok: false, failure: { kind: "transient" } };
}

/** The request never left the process; retrying cannot help. */
export function notSentFailure(
    reason: Exclude<NotSentReason, "brokenSeam" | "allowanceExhausted">,
): GitHubFailure {
    return { ok: false, failure: { kind: "notSent", reason } };
}

/** This lane's share of GitHub's limit is spent; the request was not sent. */
export function allowanceFailure(lane: Lane): GitHubFailure {
    return { ok: false, failure: { kind: "notSent", reason: "allowanceExhausted", lane } };
}

/** A wiring defect in the named injected seam — never weather, never retried. */
export function brokenSeamFailure(seam: BrokenSeam): GitHubFailure {
    return { ok: false, failure: { kind: "notSent", reason: "brokenSeam", seam } };
}

/** One line naming a failure, with the detail the adapter's own classes carry. */
export function describeFailure(failure: GitHubHttpFailureClass): string {
    if (failure.kind === "responseTooLarge") {
        return `responseTooLarge (over ${String(failure.limitBytes)} bytes)`;
    }
    if (failure.kind !== "notSent") return failure.kind;
    if (failure.reason === "brokenSeam") return `notSent (broken seam: ${failure.seam})`;
    return failure.reason === "allowanceExhausted"
        ? `notSent (allowanceExhausted: ${failure.lane})`
        : `notSent (${failure.reason})`;
}
