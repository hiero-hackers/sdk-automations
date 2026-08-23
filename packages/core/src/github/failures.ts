/**
 * A failed GitHub call, from response to next action.
 *
 * The body regexes are DATED SNAPSHOTS, not contract. When GitHub rewords a
 * message the match fails and the response degrades to
 * `forbiddenUnrecognized` rather than being confidently misdiagnosed. Green
 * tests here mean the fixtures still agree with themselves
 * (`FINDING(failures-prose-snapshot)`, D40 — see [README.md](README.md) for
 * the re-probe obligation).
 *
 * The retry bounds in the last section are chosen, not observed, which by
 * this directory's inclusion test argues for a different home. They stay
 * because the advice is welded to the observation: the one-minute floor
 * exists only because the 403 secondary limit carries no wait signal at all
 * (`FINDING(secondary-limit-no-wait-signal)`). Splitting them would put the
 * measurement and the number it forced in separate files.
 */

import { MAX_AUTOMATIC_RATE_LIMIT_WAIT_SECONDS, parseSecondsHeader } from "./rate-limits.js";

// ─── What arrived ────────────────────────────────────────────────────

/**
 * The inputs classification needs — transport-agnostic.
 *
 * `tokenPastExpiry` is whether the caller's token was already past its
 * minted `expires_at` when the request was sent. It is required for correct
 * 401 classification. An expired installation token returns the same body as
 * a wrong key (`"Bad credentials"`, observed 2026-07-23, citation
 * `…T21-52-06-572Z#1`), so only this local fact tells them apart.
 */
export interface FailureObservation {
    readonly status: number;
    readonly body: string;
    readonly headers: Readonly<Record<string, string | undefined>>;
    readonly tokenPastExpiry?: boolean;
}

/** What a failed response turned out to be. */
export type FailureClass =
    /** 401; token past its 1 h TTL (6.1). */
    | { readonly kind: "tokenExpired" }
    /** 401 without the expiry marker — wrong or revoked credentials. */
    | { readonly kind: "badCredentials" }
    /** 403 naming the wanted grant — `x-accepted-github-permissions` (6.1). Private repos only; public reads succeed without the grant. */
    | { readonly kind: "permissionMissing"; readonly acceptedPermissions: string }
    /** 403, body names suspension, and the permissions header is absent (6.1). */
    | { readonly kind: "installationSuspended" }
    /** 403/429 secondary limit. Write-path evidence only (6.4, FINDING(secondary-limit-no-wait-signal), REPROBE(secondary-limit-read-path)). */
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
    /** A 403 matching NO observed shape — carries the body verbatim, so a reworded message surfaces rather than being misdiagnosed (D40). */
    | { readonly kind: "forbiddenUnrecognized"; readonly bodySnippet: string }
    /** 404: not found OR App not installed there — GitHub hides existence (6.6 probe), the two are indistinguishable. */
    | { readonly kind: "notFoundOrNotInstalled" }
    /** 422 with structured `errors[]` — maintainer-showable verbatim (6.4). */
    | { readonly kind: "validationError" }
    /** A 3xx the client refused to follow; 301/308 are permanent, so the remedy is `location`, never a retry. */
    | {
          readonly kind: "redirected";
          readonly status: number;
          readonly location?: string;
          readonly permanent: boolean;
      }
    /** An otherwise-unclassified 4xx. Repeating the same request cannot repair it. */
    | { readonly kind: "clientError"; readonly status: number }
    /** A transport failure, request timeout, 408, or 5xx worth a bounded retry. */
    | { readonly kind: "transient" };

// ─── The perishable surface ──────────────────────────────────────────

/**
 * Every place this module reads GitHub's prose.
 *
 * D40's quarterly re-probe is entirely about these two patterns. The rest of
 * the file is logic over status codes and headers, which do not reword
 * themselves. They sit here rather than inside `classifyFailure` because the
 * re-probe is a specific editing task — find the pattern, compare it against
 * what GitHub says now, change it. It should not require reading a classifier
 * at nesting depth five.
 *
 * `observed` is the text each pattern was written against, and it is not
 * decoration. `failures.test.ts` asserts every pattern still matches its own
 * sample, so editing one without the other fails rather than drifting.
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

// ─── Classification ──────────────────────────────────────────────────

/** Read one failed response into exactly one class. */
export function classifyFailure(o: FailureObservation): FailureClass {
    const body = o.body;
    // 304 is a conditional-read result, not a redirect. A transport with no
    // matching cached representation treats it as transient below.
    if (o.status >= 300 && o.status < 400 && o.status !== 304) {
        const location = o.headers.location;
        return {
            kind: "redirected",
            status: o.status,
            permanent: o.status === 301 || o.status === 308,
            ...(location === undefined ? {} : { location }),
        };
    }
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
        return { kind: "forbiddenUnrecognized", bodySnippet: body.slice(0, 200) };
    }
    if (o.status === 404) return { kind: "notFoundOrNotInstalled" };
    if (o.status === 422) return { kind: "validationError" };
    if (o.status >= 400 && o.status < 500 && o.status !== 408) {
        return { kind: "clientError", status: o.status };
    }
    return { kind: "transient" };
}

// ─── What to do next ─────────────────────────────────────────────────

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
        case "redirected":
        case "clientError":
            return { action: "doNotRetry", surfaceTo: "operator" };
    }
}
