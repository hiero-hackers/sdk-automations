/**
 * The failure catalogue as executable classification — the
 * `design/operations/endpoint-permission-matrix.md` failure table
 * turned into one pure function, because the stage-three evidence
 * showed the classes are distinguishable only by reading bodies and
 * headers together (a status code alone conflates four different
 * 403s). Every rule cites the run that observed it.
 *
 * The adapter owns retry policy explicitly (Octokit's default plugins
 * are disabled — 6.4); `retryAdvice` below is that policy's pure core.
 */

/** The inputs classification needs — transport-agnostic. */
export interface FailureObservation {
    readonly status: number;
    readonly body: string;
    readonly headers: Readonly<Record<string, string | undefined>>;
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
    | { readonly kind: "secondaryLimit" }
    /** Primary quota exhausted: `x-ratelimit-remaining: 0`. */
    | { readonly kind: "primaryExhausted"; readonly resetAt: string | undefined }
    /** 404: not found OR App not installed there — GitHub hides existence (6.6 probe), the two are indistinguishable. */
    | { readonly kind: "notFoundOrNotInstalled" }
    /** 422 with structured `errors[]` — maintainer-showable verbatim (6.4). */
    | { readonly kind: "validationError" }
    /** 5xx and everything else worth one bounded retry. */
    | { readonly kind: "transient" };

export function classifyFailure(o: FailureObservation): FailureClass {
    const body = o.body;
    if (o.status === 401) {
        // Distinguisher per GitHub's documented expiry body; observed
        // shape to be pinned by the 6.1 expired-token probe.
        return /token.*expired/i.test(body)
            ? { kind: "tokenExpired" }
            : { kind: "badCredentials" };
    }
    if (o.status === 403) {
        if (/secondary rate limit/i.test(body)) return { kind: "secondaryLimit" };
        if (o.headers["x-ratelimit-remaining"] === "0") {
            return { kind: "primaryExhausted", resetAt: o.headers["x-ratelimit-reset"] };
        }
        const accepted = o.headers["x-accepted-github-permissions"];
        if (accepted !== undefined) {
            return { kind: "permissionMissing", acceptedPermissions: accepted };
        }
        if (/installation is currently suspended/i.test(body)) {
            return { kind: "installationSuspended" };
        }
        // A 403 matching no observed shape: treat as forbidden-like
        // permission failure with nothing to name.
        return { kind: "permissionMissing", acceptedPermissions: "" };
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
 * Bounded, evidence-derived retry policy:
 * - secondary limit: GitHub's documented one-minute floor — no header
 *   exists to trust (6.4);
 * - primary exhaustion: wait for the reset epoch;
 * - transient: bounded exponential backoff, attempt-indexed;
 * - everything else is not a retry problem — it is a diagnosis, and
 *   blind retries after unclear results are exactly what D24's
 *   recovery loop exists to prevent.
 */
export function retryAdvice(
    failure: FailureClass,
    attempt: number,
    nowEpochSeconds: number,
): RetryAdvice {
    const BACKOFF_MS = [500, 2_000, 8_000] as const;
    switch (failure.kind) {
        case "tokenExpired":
            return { action: "refreshTokenAndRetry" };
        case "secondaryLimit":
            return { action: "retryAfterMs", ms: 60_000 };
        case "primaryExhausted": {
            const reset = Number(failure.resetAt ?? Number.NaN);
            const waitMs = Number.isFinite(reset)
                ? Math.max(0, reset - nowEpochSeconds) * 1000
                : 60_000;
            return { action: "retryAfterMs", ms: waitMs };
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
        case "notFoundOrNotInstalled":
            return { action: "doNotRetry", surfaceTo: "operator" };
    }
}
