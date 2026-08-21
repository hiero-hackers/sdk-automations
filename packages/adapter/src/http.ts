/**
 * The one authenticated GitHub call path used by every adapter operation.
 *
 * This file deliberately owns the mechanics that would otherwise drift
 * between operations: request headers, timeouts, ETags, rate-limit state,
 * failure classification, and the two retry-eligible failure classes.
 */

import { classifyFailure, type FailureClass } from "@hiero-hackers/automation-core";
import { isPastExpiry, type InstallationToken, type TokenSource } from "./token.js";

/** The REST version this client has been checked against. */
export const GITHUB_API_VERSION = "2026-03-10";

/** Installation credentials never leave GitHub's public API origin. */
export const GITHUB_API_ORIGIN = "https://api.github.com";

/** A request gets this long per attempt unless the composition root chooses less. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

/** Full representations retained for conditional reads, least-recently-used. */
export const DEFAULT_ETAG_CACHE_ENTRIES = 1_000;

const DEFAULT_ACCEPT = "application/vnd.github+json";
const USER_AGENT = "hiero-hackers-sdk-automations";

/** The operation-specific part of a GitHub request. */
export interface GitHubRequest {
    readonly url: string;
    readonly method: "GET";
    readonly headers?: Readonly<Record<string, string>>;
}

export interface GitHubSuccess {
    readonly ok: true;
    readonly status: number;
    readonly body: string;
    readonly headers: Readonly<Record<string, string>>;
    readonly fromCache: boolean;
}

export interface GitHubFailure {
    readonly ok: false;
    readonly failure: FailureClass;
    readonly status?: number;
    readonly body?: string;
    readonly headers?: Readonly<Record<string, string>>;
}

export type GitHubOutcome = GitHubSuccess | GitHubFailure;

export interface RateLimitSnapshot {
    readonly url: string;
    readonly status: number;
    readonly headers: Readonly<Record<string, string>>;
}

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface GitHubHttpClientOptions {
    readonly tokenSource: TokenSource;
    readonly fetch?: FetchLike;
    readonly clock?: () => Date;
    readonly timeoutMs?: number;
    /** Injection keeps timeout tests deterministic; production uses `AbortSignal.timeout`. */
    readonly timeoutSignal?: (milliseconds: number) => AbortSignal;
}

export interface GitHubHttpClient {
    request(request: GitHubRequest): Promise<GitHubOutcome>;
    /** The last actual response, including a response that was retried. */
    latestRateLimit(): RateLimitSnapshot | null;
}

interface CachedRepresentation {
    readonly etag: string;
    readonly variant: string;
    readonly body: string;
    readonly headers: Readonly<Record<string, string>>;
}

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

function githubApiUrl(rawUrl: string): string | null {
    try {
        const url = new URL(rawUrl);
        return url.origin === GITHUB_API_ORIGIN ? url.href : null;
    } catch {
        return null;
    }
}

function transportFailure(): GitHubFailure {
    return { ok: false, failure: { kind: "transient" } };
}

function isRetriable(failure: FailureClass): boolean {
    return failure.kind === "tokenExpired" || failure.kind === "transient";
}

export function createGitHubHttpClient({
    tokenSource,
    fetch: send = fetch,
    clock = () => new Date(),
    timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
    timeoutSignal = AbortSignal.timeout,
}: GitHubHttpClientOptions): GitHubHttpClient {
    const cache = new Map<string, CachedRepresentation>();
    let latestRateLimit: RateLimitSnapshot | null = null;

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
        const headers = new Headers(request.headers);
        const accept = headers.get("accept") ?? DEFAULT_ACCEPT;
        headers.set("accept", accept);
        // Controlled fields never select a representation. Delete any caller
        // values before deriving the variant, then install our own below.
        headers.delete("authorization");
        headers.delete("if-none-match");
        headers.delete("user-agent");
        headers.delete("x-github-api-version");
        const variant = JSON.stringify(headersToRecord(headers));
        headers.set("authorization", `Bearer ${token.value}`);
        headers.set("user-agent", USER_AGENT);
        headers.set("x-github-api-version", GITHUB_API_VERSION);

        const cached = cache.get(request.url);
        if (cached !== undefined && cached.variant === variant) {
            // Reading an entry makes it newest in the bounded LRU.
            cache.delete(request.url);
            cache.set(request.url, cached);
            headers.set("if-none-match", cached.etag);
        }

        // Capture the local age at send time. A later clock read could turn a
        // live request into a false `tokenExpired` diagnosis.
        const tokenPastExpiry = isPastExpiry(token, clock());
        const init: RequestInit = {
            method: "GET",
            headers,
            // Following is deliberately not delegated to fetch: hidden 3xx
            // calls would evade origin validation, rate tracking, failure
            // classification, and the two-attempt bound.
            redirect: "manual",
            signal: timeoutSignal(timeoutMs),
        };

        // `request()` contains a rejected transport call together with every
        // other injected failure, and applies the same one-retry bound.
        const response = await send(request.url, init);

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
            return transportFailure();
        }

        if (response.ok) {
            const etag = response.status === 200 ? response.headers.get("etag") : null;
            if (etag === null) {
                cache.delete(request.url);
            } else {
                cache.delete(request.url);
                cache.set(request.url, {
                    etag,
                    variant,
                    body,
                    headers: representationHeaders(responseHeaders),
                });
                if (cache.size > DEFAULT_ETAG_CACHE_ENTRIES) {
                    // `size > a non-negative limit` proves an entry exists.
                    const oldest = cache.keys().next().value as string;
                    cache.delete(oldest);
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
            if (request.method !== "GET") return transportFailure();
            const url = githubApiUrl(request.url);
            if (url === null) return transportFailure();
            const safeRequest = { ...request, url };
            let attempt = 0;
            while (true) {
                let tokenOutcome;
                try {
                    tokenOutcome = await tokenSource.current();
                } catch {
                    return transportFailure();
                }
                if (!tokenOutcome.ok) return tokenOutcome;

                let outcome: GitHubOutcome;
                try {
                    outcome = await sendOnce(safeRequest, tokenOutcome.token);
                } catch {
                    outcome = transportFailure();
                }
                if (outcome.ok || !isRetriable(outcome.failure)) return outcome;
                if (outcome.failure.kind === "tokenExpired") {
                    try {
                        tokenSource.invalidate(tokenOutcome.token);
                    } catch {
                        return transportFailure();
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
