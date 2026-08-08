/**
 * GitHub's failure responses, classified — and the bounded retry advice that
 * follows from each.
 *
 * The body regexes are DATED SNAPSHOTS, not contract: when GitHub rewords a
 * message the match fails and the response degrades to
 * `forbiddenUnrecognized` rather than being confidently misdiagnosed. Green
 * tests here mean the fixtures still agree with themselves
 * (`FINDING(failures-prose-snapshot)`, D40 — see this directory's README for
 * the re-probe obligation).
 */

import { MAX_AUTOMATIC_RATE_LIMIT_WAIT_SECONDS, parseSecondsHeader } from "./rate-limits.js";

/** The inputs classification needs — transport-agnostic. */
export interface FailureObservation {
    readonly status: number;
    readonly body: string;
    readonly headers: Readonly<Record<string, string | undefined>>;
    /**
     * Whether the caller's token was already past its minted
     * `expires_at` when the request was sent. REQUIRED for correct 401
     * classification: an expired installation token returns the exact
     * same body as a wrong key (`"Bad credentials"` — observed
     * 2026-07-23, citation `…T21-52-06-572Z#1`), so expiry is
     * distinguishable ONLY by this local fact, never by the response.
     */
    readonly tokenPastExpiry?: boolean;
}

export type FailureClass =
    /** 401; token past its 1 h TTL (6.1). */
    | { readonly kind: "tokenExpired" }
    /** 401 without the expiry marker — wrong or revoked credentials. */
    | { readonly kind: "badCredentials" }
    /** 403 naming the wanted grant — `x-accepted-github-permissions` (6.1). Private repos only; public reads succeed without the grant. */
    | { readonly kind: "permissionMissing"; readonly acceptedPermissions: string }
    /** 403, body names suspension, and the permissions header is absent (6.1). */
    | { readonly kind: "installationSuspended" }
    /** 403 secondary limit: body prose only — no `retry-after`, primary quota untouched (6.4, FINDING(secondary-limit-no-wait-signal)). */
    | {
          readonly kind: "secondaryLimit";
          readonly retryAfterSeconds?: number;
      }
    /** Primary quota exhausted: `x-ratelimit-remaining: 0`. */
    | { readonly kind: "primaryExhausted"; readonly resetAt: string | undefined }
    /** A rate-limit response carried a malformed or unsupported wait signal. */
    | {
          readonly kind: "rateLimitResponseUnusable";
          readonly headerName: "retry-after";
          readonly headerValue: string;
          readonly reason: "invalid" | "aboveAutomaticLimit";
      }
    /**
     * A 403 matching NO observed shape — explicit ignorance carrying
     * the evidence, so a reworded GitHub body surfaces instead of
     * being misdiagnosed (D40).
     */
    | { readonly kind: "forbiddenUnrecognized"; readonly bodySnippet: string }
    /** 404: not found OR App not installed there — GitHub hides existence (6.6 probe), the two are indistinguishable. */
    | { readonly kind: "notFoundOrNotInstalled" }
    /** 422 with structured `errors[]` — maintainer-showable verbatim (6.4). */
    | { readonly kind: "validationError" }
    /** 5xx and everything else worth one bounded retry. */
    | { readonly kind: "transient" };

/**
 * The PERISHABLE SURFACE — every place this module reads GitHub's prose.
 *
 * Two patterns, and D40's quarterly re-probe is entirely about these: the
 * rest of this file is logic over status codes and headers, which do not
 * reword themselves. They are lifted out of `classifyFailure` because the
 * re-probe is a specific editing task — find the pattern, compare it against
 * what GitHub says now, change it — and it should not require reading a
 * classifier at nesting depth five to perform.
 *
 * `observed` is the text the pattern was written against. It is not
 * decoration: `failures.test.ts` asserts every pattern still matches its own
 * sample, so editing one without the other fails rather than drifting
 * silently — which is the whole failure mode of `FINDING(failures-prose-snapshot)`.
 */
export const BODY_PATTERNS = {
    secondaryRateLimit: {
        pattern: /secondary rate limit/i,
        observed:
            "You have exceeded a secondary rate limit. Please wait a few minutes before you try again.",
        probedAt: "2026-07-23",
        experiment: "6.4",
    },
    installationSuspended: {
        pattern: /installation is currently suspended/i,
        observed: "This installation is currently suspended. Please contact an organization owner.",
        probedAt: "2026-07-23",
        experiment: "6.1",
    },
} as const;

export function classifyFailure(o: FailureObservation): FailureClass {
    const body = o.body;
    if (o.status === 401) {
        // The 6.1 probe falsified body-based detection: an expired
        // token and a wrong key both return "Bad credentials". Local
        // token age is the only distinguisher.
        return o.tokenPastExpiry === true ? { kind: "tokenExpired" } : { kind: "badCredentials" };
    }
    if (o.status === 403 || o.status === 429) {
        // Both primary and secondary exhaustion can arrive as 403 or
        // 429. GitHub's documented primary signal therefore takes
        // precedence over status alone.
        if (o.headers["x-ratelimit-remaining"] === "0") {
            return { kind: "primaryExhausted", resetAt: o.headers["x-ratelimit-reset"] };
        }
        if (BODY_PATTERNS.secondaryRateLimit.pattern.test(body) || o.status === 429) {
            const retryAfter = parseSecondsHeader(o.headers["retry-after"]);
            switch (retryAfter.kind) {
                case "missing":
                    return { kind: "secondaryLimit" };
                case "invalid":
                    return {
                        kind: "rateLimitResponseUnusable",
                        headerName: "retry-after",
                        headerValue: retryAfter.rawValue,
                        reason: "invalid",
                    };
                case "valid":
                    return retryAfter.seconds > MAX_AUTOMATIC_RATE_LIMIT_WAIT_SECONDS
                        ? {
                              kind: "rateLimitResponseUnusable",
                              headerName: "retry-after",
                              headerValue: String(retryAfter.seconds),
                              reason: "aboveAutomaticLimit",
                          }
                        : {
                              kind: "secondaryLimit",
                              retryAfterSeconds: retryAfter.seconds,
                          };
            }
        }
        const accepted = o.headers["x-accepted-github-permissions"];
        if (accepted !== undefined) {
            return { kind: "permissionMissing", acceptedPermissions: accepted };
        }
        if (BODY_PATTERNS.installationSuspended.pattern.test(body)) {
            return { kind: "installationSuspended" };
        }
        // No observed shape matched — say so, carrying the evidence.
        return { kind: "forbiddenUnrecognized", bodySnippet: body.slice(0, 200) };
    }
    if (o.status === 404) return { kind: "notFoundOrNotInstalled" };
    if (o.status === 422) return { kind: "validationError" };
    return { kind: "transient" };
}

/** What the caller should do next — the retry policy's pure half. */
export type RetryAdvice =
    | { readonly action: "retryAfterMs"; readonly ms: number }
    | { readonly action: "refreshTokenAndRetry" }
    | { readonly action: "doNotRetry"; readonly surfaceTo: "maintainer" | "operator" };

/**
 * A limit that survives this many full waits is a pacing-design
 * problem for an operator, not a wait problem (6.4).
 */
export const MAX_RATE_LIMIT_ATTEMPTS = 3;

/** Token minting is an authentication concern, not a pacing concern. */
export const MAX_TOKEN_REFRESH_ATTEMPTS = 3;

/**
 * Bounded retry advice. The caller supplies the attempt count because retry
 * bounds must survive a restart — a counter that resets with the process is
 * not a bound (D42, D24).
 */
export function retryAdvice(
    failure: FailureClass,
    attempt: number,
    nowEpochSeconds: number,
): RetryAdvice {
    const BACKOFF_MS = [500, 2_000, 8_000] as const;
    switch (failure.kind) {
        case "tokenExpired":
            return attempt >= MAX_TOKEN_REFRESH_ATTEMPTS
                ? { action: "doNotRetry", surfaceTo: "operator" }
                : { action: "refreshTokenAndRetry" };
        case "secondaryLimit":
            return attempt >= MAX_RATE_LIMIT_ATTEMPTS
                ? { action: "doNotRetry", surfaceTo: "operator" }
                : {
                      action: "retryAfterMs",
                      ms: Math.max(60_000, (failure.retryAfterSeconds ?? 0) * 1000),
                  };
        case "primaryExhausted": {
            if (attempt >= MAX_RATE_LIMIT_ATTEMPTS) {
                return { action: "doNotRetry", surfaceTo: "operator" };
            }
            const reset = parseSecondsHeader(failure.resetAt);
            if (reset.kind !== "valid" || !Number.isFinite(nowEpochSeconds)) {
                return { action: "doNotRetry", surfaceTo: "operator" };
            }
            const waitSeconds = Math.max(0, reset.seconds - nowEpochSeconds);
            return waitSeconds > MAX_AUTOMATIC_RATE_LIMIT_WAIT_SECONDS
                ? { action: "doNotRetry", surfaceTo: "operator" }
                : { action: "retryAfterMs", ms: waitSeconds * 1000 };
        }
        case "transient": {
            const ms = BACKOFF_MS[attempt];
            return ms === undefined
                ? { action: "doNotRetry", surfaceTo: "operator" }
                : { action: "retryAfterMs", ms };
        }
        case "validationError":
            return { action: "doNotRetry", surfaceTo: "maintainer" };
        case "badCredentials":
        case "permissionMissing":
        case "installationSuspended":
        case "forbiddenUnrecognized":
        case "rateLimitResponseUnusable":
        case "notFoundOrNotInstalled":
            return { action: "doNotRetry", surfaceTo: "operator" };
    }
}
