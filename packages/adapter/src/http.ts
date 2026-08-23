/**
 * The one authenticated GitHub call path used by every adapter operation.
 *
 * This file deliberately owns the mechanics that would otherwise drift
 * between operations: request headers, timeouts, the bounded ETag cache,
 * rate-limit state, refusal of redirects, and the two retry-eligible
 * failure classes. Core owns the vocabulary for GitHub responses; this file
 * adds only the typed `notSent` result for a request refused locally. Which
 * token to send is `token.ts`. In order below: the chosen bounds, the
 * contract, the local judgements, the client.
 */

import { classifyFailure, type FailureClass } from "@hiero-hackers/automation-core";
import { isPastExpiry, type InstallationToken, type TokenSource } from "./token.js";

// ─── The chosen bounds ───────────────────────────────────────────────

/** The REST version this client has been checked against. */
export const GITHUB_API_VERSION = "2026-03-10";

/** Installation credentials never leave GitHub's public API origin. */
export const GITHUB_API_ORIGIN = "https://api.github.com";

/** A request gets this long per attempt unless the composition root chooses less. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

/** Full representations retained for conditional reads, least-recently-used. */
export const DEFAULT_ETAG_CACHE_ENTRIES = 1_000;

/** Retained bodies across all entries, in UTF-16 code units — close enough for a bound. */
export const DEFAULT_ETAG_CACHE_BYTES = 20 * 1024 * 1024;

/** A body larger than this is not worth retaining for a conditional re-read. */
export const DEFAULT_ETAG_CACHE_ENTRY_BYTES = 512 * 1024;

const DEFAULT_ACCEPT = "application/vnd.github+json";
const USER_AGENT = "hiero-hackers-sdk-automations";

// ─── The contract ────────────────────────────────────────────────────

/** The operation-specific part of a GitHub request. */
export interface GitHubRequest {
    readonly url: string;
    readonly method: "GET";
    readonly headers?: Readonly<Record<string, string>>;
}

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
    "disallowedMethod" | "disallowedOrigin" | "malformedUrl" | "invalidHeaders" | "brokenSeam";

/** Core owns response classes; the adapter adds only its pre-response refusal. */
export type GitHubHttpFailureClass =
    FailureClass | { readonly kind: "notSent"; readonly reason: NotSentReason };

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
    readonly timeoutMs?: number;
    /** Injection keeps timeout tests deterministic; production uses `AbortSignal.timeout`. */
    readonly timeoutSignal?: (milliseconds: number) => AbortSignal;
}

/** What every operation calls; see the file header for what it owns. */
export interface GitHubHttpClient {
    request(request: GitHubRequest): Promise<GitHubOutcome>;
    /** The last actual response, including a response that was retried. */
    latestRateLimit(): RateLimitSnapshot | null;
}

/** A retained body and the validator plus variant that make it reusable. */
interface CachedRepresentation {
    readonly etag: string;
    readonly variant: string;
    readonly body: string;
    readonly headers: Readonly<Record<string, string>>;
}

// ─── Local judgements ────────────────────────────────────────────────

function headersToRecord(headers: Headers): Record<string, string> {
    const record: Record<string, string> = {};
    headers.forEach((value, name) => {
        record[name.toLowerCase()] = value;
    });
    return record;
}

function rateLimitHeaders(headers: Readonly<Record<string, string>>): Record<string, string> {
    return Object.fromEntries(
        Object.entries(headers).filter(([name]) => name.startsWith("x-ratelimit-")),
    );
}

function representationHeaders(headers: Readonly<Record<string, string>>): Record<string, string> {
    const link = headers.link;
    return link === undefined ? {} : { link };
}

type GitHubApiUrl =
    | { readonly ok: true; readonly url: string }
    | { readonly ok: false; readonly refused: "malformedUrl" | "disallowedOrigin" };

function githubApiUrl(rawUrl: string): GitHubApiUrl {
    let url: URL;
    try {
        url = new URL(rawUrl);
    } catch {
        return { ok: false, refused: "malformedUrl" };
    }
    return url.origin === GITHUB_API_ORIGIN
        ? { ok: true, url: url.href }
        : { ok: false, refused: "disallowedOrigin" };
}

/** Genuine transport weather — the one locally-made class worth a retry. */
function transportFailure(): GitHubFailure {
    return { ok: false, failure: { kind: "transient" } };
}

/** The request never left the process; retrying cannot help. */
function notSentFailure(reason: NotSentReason): GitHubFailure {
    return { ok: false, failure: { kind: "notSent", reason } };
}

function isRetriable(failure: GitHubHttpFailureClass): boolean {
    return failure.kind === "tokenExpired" || failure.kind === "transient";
}

// ─── The client ──────────────────────────────────────────────────────

export function createGitHubHttpClient({
    tokenSource,
    fetch: send = fetch,
    clock = () => new Date(),
    timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
    timeoutSignal = AbortSignal.timeout,
}: GitHubHttpClientOptions): GitHubHttpClient {
    const cache = new Map<string, CachedRepresentation>();
    let cacheBytes = 0;
    let latestRateLimit: RateLimitSnapshot | null = null;

    const removeEntry = (url: string): void => {
        const entry = cache.get(url);
        if (entry !== undefined) {
            cacheBytes -= entry.body.length;
            cache.delete(url);
        }
    };

    /** Insert as newest, then evict oldest-first until under both bounds. */
    const storeEntry = (url: string, entry: CachedRepresentation): void => {
        removeEntry(url);
        cache.set(url, entry);
        cacheBytes += entry.body.length;
        while (cache.size > DEFAULT_ETAG_CACHE_ENTRIES || cacheBytes > DEFAULT_ETAG_CACHE_BYTES) {
            // `size > a non-negative limit` proves an entry exists, and the
            // per-entry byte cap proves a one-entry cache is under the total.
            removeEntry(cache.keys().next().value as string);
        }
    };

    const rememberRateLimit = (
        url: string,
        status: number,
        headers: Readonly<Record<string, string>>,
    ): void => {
        latestRateLimit = { url, status, headers: rateLimitHeaders(headers) };
    };

    const sendOnce = async (
        request: GitHubRequest,
        token: InstallationToken,
    ): Promise<GitHubOutcome> => {
        let headers: Headers;
        try {
            headers = new Headers(request.headers);
        } catch {
            return notSentFailure("invalidHeaders");
        }
        const accept = headers.get("accept") ?? DEFAULT_ACCEPT;
        headers.set("accept", accept);
        // Controlled fields never select a representation. Delete any caller
        // values before deriving the variant, then install our own below.
        headers.delete("authorization");
        headers.delete("if-none-match");
        headers.delete("user-agent");
        headers.delete("x-github-api-version");
        const variant = JSON.stringify(headersToRecord(headers));
        try {
            headers.set("authorization", `Bearer ${token.value}`);
            headers.set("user-agent", USER_AGENT);
            headers.set("x-github-api-version", GITHUB_API_VERSION);
        } catch {
            return notSentFailure("brokenSeam");
        }

        const cached = cache.get(request.url);
        if (cached !== undefined && cached.variant === variant) {
            // Reading an entry makes it newest in the bounded LRU.
            cache.delete(request.url);
            cache.set(request.url, cached);
            headers.set("if-none-match", cached.etag);
        }

        // Capture the local age at send time. A later clock read could turn a
        // live request into a false `tokenExpired` diagnosis.
        let tokenPastExpiry: boolean;
        try {
            tokenPastExpiry = isPastExpiry(token, clock());
        } catch {
            return notSentFailure("brokenSeam");
        }
        // A throwing timeout factory is a wiring defect, not retriable weather.
        let signal: AbortSignal;
        try {
            signal = timeoutSignal(timeoutMs);
        } catch {
            return notSentFailure("brokenSeam");
        }
        const init: RequestInit = {
            method: "GET",
            headers,
            // Following is deliberately not delegated to fetch: hidden 3xx
            // calls would evade origin validation, rate tracking, failure
            // classification, and the two-attempt bound.
            redirect: "manual",
            signal,
        };

        let response: Response;
        try {
            response = await send(request.url, init);
        } catch {
            return transportFailure();
        }

        const responseHeaders = headersToRecord(response.headers);
        rememberRateLimit(request.url, response.status, responseHeaders);

        if (response.status === 304) {
            if (cached === undefined || cached.variant !== variant) {
                return {
                    ok: false,
                    status: response.status,
                    body: "",
                    headers: responseHeaders,
                    failure: { kind: "transient" },
                };
            }
            return {
                ok: true,
                status: response.status,
                body: cached.body,
                headers: { ...cached.headers, ...responseHeaders },
                fromCache: true,
            };
        }

        let body: string;
        try {
            body = await response.text();
        } catch {
            return {
                ok: false,
                status: response.status,
                headers: responseHeaders,
                failure: { kind: "transient" },
            };
        }

        if (response.ok) {
            // Only a 200 speaks about the representation; a 202 or 204 must
            // not evict a validator that is still good.
            if (response.status === 200) {
                const etag = response.headers.get("etag");
                if (etag !== null && body.length <= DEFAULT_ETAG_CACHE_ENTRY_BYTES) {
                    storeEntry(request.url, {
                        etag,
                        variant,
                        body,
                        headers: representationHeaders(responseHeaders),
                    });
                } else {
                    // A 200 with no retainable validator leaves any kept entry stale.
                    removeEntry(request.url);
                }
            }
            return {
                ok: true,
                status: response.status,
                body,
                headers: responseHeaders,
                fromCache: false,
            };
        }

        return {
            ok: false,
            status: response.status,
            body,
            headers: responseHeaders,
            failure: classifyFailure({
                status: response.status,
                body,
                headers: responseHeaders,
                tokenPastExpiry,
            }),
        };
    };

    return {
        async request(request): Promise<GitHubOutcome> {
            if (request.method !== "GET") return notSentFailure("disallowedMethod");
            const parsed = githubApiUrl(request.url);
            if (!parsed.ok) return notSentFailure(parsed.refused);
            const safeRequest = { ...request, url: parsed.url };
            let attempt = 0;
            while (true) {
                let tokenOutcome;
                try {
                    tokenOutcome = await tokenSource.current();
                    if (
                        typeof tokenOutcome !== "object" ||
                        tokenOutcome === null ||
                        typeof tokenOutcome.ok !== "boolean" ||
                        (tokenOutcome.ok
                            ? typeof tokenOutcome.token !== "object" ||
                              tokenOutcome.token === null ||
                              typeof tokenOutcome.token.value !== "string" ||
                              !(tokenOutcome.token.expiresAt instanceof Date) ||
                              !Number.isFinite(tokenOutcome.token.expiresAt.getTime()) ||
                              !Array.isArray(tokenOutcome.token.grants)
                            : typeof tokenOutcome.failure !== "object" ||
                              tokenOutcome.failure === null ||
                              typeof tokenOutcome.failure.kind !== "string")
                    ) {
                        return notSentFailure("brokenSeam");
                    }
                } catch {
                    // `current()` promises not to throw.
                    return notSentFailure("brokenSeam");
                }
                if (!tokenOutcome.ok) return tokenOutcome;

                let outcome: GitHubOutcome;
                try {
                    outcome = await sendOnce(safeRequest, tokenOutcome.token);
                } catch {
                    // `sendOnce()` contains expected transport failures itself.
                    // Anything escaping it is a broken local seam, never weather.
                    return notSentFailure("brokenSeam");
                }
                if (outcome.ok || !isRetriable(outcome.failure)) return outcome;
                if (outcome.failure.kind === "tokenExpired") {
                    try {
                        tokenSource.invalidate(tokenOutcome.token);
                    } catch {
                        return notSentFailure("brokenSeam");
                    }
                }
                if (attempt === 1) return outcome;
                attempt += 1;
            }
        },
        latestRateLimit(): RateLimitSnapshot | null {
            if (latestRateLimit === null) return null;
            return {
                ...latestRateLimit,
                headers: { ...latestRateLimit.headers },
            };
        },
    };
}
