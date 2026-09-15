/**
 * The one authenticated GitHub call path every adapter operation uses.
 * It owns the mechanics that would otherwise drift between operations: headers,
 * timeouts, the bounded ETag cache, the bounded body read, rate-limit pacing,
 * refused redirects, and how long a failure is waited on before it is handed back (D20).
 */

import {
    classifyFailure,
    MAX_RATE_LIMIT_ATTEMPTS,
    parseSecondsHeader,
    retryAdvice,
    type FailureClass,
} from "@hiero-hackers/automation-core";
import { admit, missingGrants } from "./admission.js";
import type { Pool } from "./allowance.js";
import {
    allowanceFailure,
    bodyOf,
    brokenSeamFailure,
    DEFAULT_REQUEST_TIMEOUT_MS,
    GITHUB_API_VERSION,
    headersToRecord,
    isWrite,
    notSentFailure,
    transportFailure,
    USER_AGENT,
    type GitHubFailure,
    type GitHubHttpClient,
    type GitHubHttpClientOptions,
    type GitHubHttpFailureClass,
    type GitHubOutcome,
    type GitHubRequest,
    type RateLimitSnapshot,
} from "./contract.js";
import {
    isPastExpiry,
    isWellFormedTokenOutcome,
    type InstallationToken,
    type TokenOutcome,
} from "./token.js";
import { field, jsonRecordOf } from "./untrusted.js";

// ─── The chosen bounds ───────────────────────────────────────────────

/** Full representations retained for conditional reads, least-recently-used. */
export const DEFAULT_ETAG_CACHE_ENTRIES = 1_000;

/** Retained bodies across all entries, in UTF-16 code units — close enough for a bound. */
export const DEFAULT_ETAG_CACHE_BYTES = 20 * 1024 * 1024;

/** A body larger than this is not worth retaining for a conditional re-read. */
export const DEFAULT_ETAG_CACHE_ENTRY_BYTES = 512 * 1024;

/**
 * The largest response body this client will read.
 * Anything past it is abandoned mid-stream rather than buffered.
 */
export const MAX_RESPONSE_BODY_BYTES = 8 * DEFAULT_ETAG_CACHE_ENTRY_BYTES;

const DEFAULT_ACCEPT = "application/vnd.github+json";

/** Attempts per request on a rejected token: the first, then one fresh mint. */
const TOKEN_REFRESH_ATTEMPTS = 2;

/**
 * Attempts per request on weather, where core's backoff list would allow four.
 * The shell re-runs the whole delivery, so an in-request retry need only clear a blip.
 */
const TRANSIENT_ATTEMPTS = 2;

/**
 * Everything one `request()` may spend asleep, across all of its retries.
 * A longer wait returns at once rather than camping on a claimed delivery.
 */
export const MAX_RETRY_WAIT_MS = 30_000;

/**
 * How much of a backoff this package CHOSE is spent spreading it out.
 * Added only where the advice carries no wait signal of its own.
 */
const BACKOFF_JITTER_FRACTION = 0.25;

/**
 * Primary-budget requests held back rather than spent (threat model §2).
 * Under it this client stops as if already exhausted, countably in the shell.
 */
export const PRIMARY_BUDGET_RESERVE = 50;

/**
 * Experiment 6.4 tripped an unsignalled secondary limit near eighty writes a minute.
 * Per client instance, and it spaces CREATION only: a label call is not content.
 */
export const CONTENT_CREATION_SPACING_MS = 2_000;

/** Comments this client may create per hour, under GitHub's documented five hundred (F11). */
export const CONTENT_CREATION_HOURLY = 400;

const HOUR_MS = 60 * 60_000;

// ─── The retry policy ────────────────────────────────────────────────

/** The production pause between attempts, and the only real timer here. */
export const wait = (milliseconds: number): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, milliseconds));

/** What one request does about a failure it has just classified. */
type NextStep =
    | { readonly step: "return" }
    | { readonly step: "refreshToken" }
    | { readonly step: "wait"; readonly ms: number };

/** The class core can advise on; the adapter's own two are never retried. */
function responseClassOf(failure: GitHubHttpFailureClass): FailureClass | null {
    return failure.kind === "notSent" || failure.kind === "responseTooLarge" ? null : failure;
}

/**
 * Sends one request may make on this class, counting the first.
 * A class core refuses to retry never reaches its cap.
 */
function attemptCap(kind: FailureClass["kind"]): number {
    if (kind === "tokenExpired") return TOKEN_REFRESH_ATTEMPTS;
    if (kind === "transient") return TRANSIENT_ATTEMPTS;
    return MAX_RATE_LIMIT_ATTEMPTS;
}

/**
 * May this request be sent again inside one `request()` call?
 * A NON-IDEMPOTENT write gets zero of any class; recovery is the read-back layer's (D46).
 */
function mayRetryInClient(request: GitHubRequest): boolean {
    return !isWrite(request) || request.idempotency === "idempotent";
}

/** The spread added to a chosen backoff; see `BACKOFF_JITTER_FRACTION`. */
function jitterMs(kind: FailureClass["kind"], advisedMs: number, now: Date): number {
    if (kind !== "transient") return 0;
    const span = Math.floor(advisedMs * BACKOFF_JITTER_FRACTION);
    return span < 1 ? 0 : now.getTime() % span;
}

/**
 * What to do about `failure` after `attempt` earlier failures of this request.
 * A wait that would breach the ceiling returns the failure WITHOUT sleeping first.
 */
function nextStep(failure: FailureClass, attempt: number, now: Date, waitedMs: number): NextStep {
    if (attempt + 1 >= attemptCap(failure.kind)) return { step: "return" };
    const advice = retryAdvice(failure, attempt, Math.floor(now.getTime() / 1000));
    if (advice.action === "doNotRetry") return { step: "return" };
    if (advice.action === "refreshTokenAndRetry") return { step: "refreshToken" };
    const ms = advice.ms + jitterMs(failure.kind, advice.ms, now);
    return waitedMs + ms > MAX_RETRY_WAIT_MS ? { step: "return" } : { step: "wait", ms };
}

// ─── The representation cache ────────────────────────────────────────

/** A retained body and the validator plus variant that make it reusable. */
interface CachedRepresentation {
    readonly etag: string;
    readonly variant: string;
    readonly body: string;
    readonly headers: Readonly<Record<string, string>>;
}

/** The bounded, least-recently-used store of reusable representations. */
interface RepresentationCache {
    /** The entry for this URL under this variant, made newest by the read. */
    lookup(url: string, variant: string): CachedRepresentation | undefined;
    store(url: string, entry: CachedRepresentation): void;
    remove(url: string): void;
    /** That URL and its query-string variants — one resource read many ways. */
    removeResource(url: string): void;
}

function createRepresentationCache(): RepresentationCache {
    const entries = new Map<string, CachedRepresentation>();
    let retainedBytes = 0;

    const remove = (url: string): void => {
        const entry = entries.get(url);
        if (entry !== undefined) {
            retainedBytes -= entry.body.length;
            entries.delete(url);
        }
    };

    return {
        lookup(url: string, variant: string): CachedRepresentation | undefined {
            const entry = entries.get(url);
            // Reading an entry makes it newest in the bounded LRU.

            if (entry === undefined || entry.variant !== variant) return undefined;
            entries.delete(url);
            entries.set(url, entry);
            return entry;
        },
        /** Insert as newest, then evict oldest-first until under both bounds. */
        store(url: string, entry: CachedRepresentation): void {
            remove(url);
            entries.set(url, entry);
            retainedBytes += entry.body.length;
            while (
                entries.size > DEFAULT_ETAG_CACHE_ENTRIES ||
                retainedBytes > DEFAULT_ETAG_CACHE_BYTES
            ) {
                // `size > a non-negative limit` proves an entry exists.

                remove(entries.keys().next().value as string);
            }
        },
        remove,
        removeResource(url: string): void {
            for (const key of [...entries.keys()]) {
                if (key === url || key.startsWith(`${url}?`)) remove(key);
            }
        },
    };
}

function representationHeaders(headers: Readonly<Record<string, string>>): Record<string, string> {
    const link = headers.link;
    return link === undefined ? {} : { link };
}

function rateLimitHeaders(headers: Readonly<Record<string, string>>): Record<string, string> {
    return Object.fromEntries(
        Object.entries(headers).filter(([name]) => name.startsWith("x-ratelimit-")),
    );
}

// ─── The pools ───────────────────────────────────────────────────────

/** Which pool a request is aimed at; only the admitted GraphQL POST leaves core. */
function poolOf(request: GitHubRequest): Pool {
    return !isWrite(request) && request.method === "POST" ? "graphql" : "core";
}

/** The pool a response names, or the one the request was aimed at (F9). */
function chargedPool(headers: Readonly<Record<string, string>>, aimedAt: Pool): Pool {
    const resource = headers["x-ratelimit-resource"];
    if (resource === "graphql") return "graphql";
    return resource === "core" ? "core" : aimedAt;
}

/** The points a GraphQL body reports for itself, or `null` where it reports none. */
function pointsIn(body: string): number | null {
    const cost = field(field(field(jsonRecordOf(body), "data"), "rateLimit"), "cost");
    return typeof cost === "number" && Number.isInteger(cost) && cost > 0 ? cost : null;
}

// ─── The client ──────────────────────────────────────────────────────

/**
 * The response body as text, or `null` when it passed the bound.
 * Read chunk by chunk: a length checked after the fact has already cost the memory.
 */
async function boundedText(response: Response): Promise<string | null> {
    const stream = response.body;
    if (stream === null) return "";
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let text = "";
    let bytes = 0;
    for (;;) {
        const chunk = await reader.read();
        if (chunk.done) return text + decoder.decode();
        bytes += chunk.value.length;
        if (bytes > MAX_RESPONSE_BODY_BYTES) {
            try {
                await reader.cancel();
            } catch {
                // The bound is what matters here, not a tidy close.
            }
            return null;
        }
        text += decoder.decode(chunk.value, { stream: true });
    }
}

/** Ready-to-send headers and the variant they select, or the refusal. */
type PreparedHeaders =
    | { readonly ok: true; readonly headers: Headers; readonly variant: string }
    | { readonly ok: false; readonly refusal: GitHubFailure };

/**
 * The operation's headers with the controlled fields installed.
 * Controlled fields never select a representation: caller values are deleted first.
 */
function prepareHeaders(request: GitHubRequest, token: InstallationToken): PreparedHeaders {
    let headers: Headers;
    try {
        headers = new Headers(request.headers);
    } catch {
        return { ok: false, refusal: notSentFailure("invalidHeaders") };
    }
    headers.set("accept", headers.get("accept") ?? DEFAULT_ACCEPT);
    headers.delete("authorization");
    headers.delete("if-none-match");
    headers.delete("user-agent");
    headers.delete("x-github-api-version");
    // A content type describes a body; the label removal is a DELETE with none.

    if (bodyOf(request) !== undefined) {
        headers.delete("content-length");
        headers.set("content-type", "application/json");
    }
    const variant = JSON.stringify(headersToRecord(headers));
    try {
        headers.set("authorization", `Bearer ${token.value}`);
        headers.set("user-agent", USER_AGENT);
        headers.set("x-github-api-version", GITHUB_API_VERSION);
    } catch {
        // Only the token value can make this throw.

        return { ok: false, refusal: brokenSeamFailure("tokenValue") };
    }
    return { ok: true, headers, variant };
}

/** A settled promise's value discarded — both arms of "that one finished". */
const settled = (): undefined => undefined;

export function createGitHubHttpClient({
    tokenSource,
    fetch: send = fetch,
    clock = () => new Date(),
    sleep = wait,
    timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
    timeoutSignal = AbortSignal.timeout,
    contentCreationHourly = CONTENT_CREATION_HOURLY,
}: GitHubHttpClientOptions): GitHubHttpClient {
    const cache = createRepresentationCache();
    /** One slot per `x-ratelimit-resource`: a GraphQL answer says nothing about core (F9). */
    const slots = new Map<string, RateLimitSnapshot>();
    let latestResource: string | null = null;

    const rememberRateLimit = (
        resource: string,
        url: string,
        status: number,
        headers: Readonly<Record<string, string>>,
    ): void => {
        slots.set(resource, { url, status, headers: rateLimitHeaders(headers) });
        latestResource = resource;
    };

    /**
     * The exhaustion the next request on this pool should assume — the slots' one consumer.
     * A count with no usable reset is ignored: pacing on it could never expire.
     */
    const pacingClass = (pool: Pool): FailureClass | null => {
        const slot = slots.get(pool);
        if (slot === undefined) return null;
        const remaining = parseSecondsHeader(slot.headers["x-ratelimit-remaining"]);
        const resetAt = slot.headers["x-ratelimit-reset"];
        if (remaining.kind !== "valid" || remaining.seconds >= PRIMARY_BUDGET_RESERVE) return null;
        return parseSecondsHeader(resetAt).kind === "valid"
            ? { kind: "primaryExhausted", resetAt }
            : null;
    };

    const sendOnce = async (
        request: GitHubRequest,
        token: InstallationToken,
        pool: Pool,
    ): Promise<GitHubOutcome> => {
        const prepared = prepareHeaders(request, token);
        if (!prepared.ok) return prepared.refusal;
        const { headers, variant } = prepared;
        const requestBody = bodyOf(request);

        // A write is never a GET, so it never carries a validator.

        const cached = request.method === "GET" ? cache.lookup(request.url, variant) : undefined;
        if (cached !== undefined) headers.set("if-none-match", cached.etag);

        // Capture the local age at send time; a later clock read could diagnose a false expiry.

        let tokenPastExpiry: boolean;
        try {
            tokenPastExpiry = isPastExpiry(token, clock());
        } catch {
            return brokenSeamFailure("clock");
        }
        let signal: AbortSignal;
        try {
            signal = timeoutSignal(timeoutMs);
        } catch {
            return brokenSeamFailure("timeoutSignal");
        }
        const init: RequestInit = {
            method: request.method,
            headers,
            // Following is not delegated to fetch: a hidden 3xx would evade every check here.

            redirect: "manual",
            signal,
            ...(requestBody === undefined ? {} : { body: requestBody }),
        };

        let response: Response;
        try {
            response = await send(request.url, init);
        } catch {
            return transportFailure();
        }

        const responseHeaders = headersToRecord(response.headers);
        rememberRateLimit(
            chargedPool(responseHeaders, pool),
            request.url,
            response.status,
            responseHeaders,
        );

        if (response.status === 304) {
            // A 304 with nothing to reuse: a full re-read fixes it.

            if (cached === undefined) {
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

        let read: string | null;
        try {
            read = await boundedText(response);
        } catch {
            return {
                ok: false,
                status: response.status,
                headers: responseHeaders,
                failure: { kind: "transient" },
            };
        }
        if (read === null) {
            return {
                ok: false,
                status: response.status,
                headers: responseHeaders,
                failure: { kind: "responseTooLarge", limitBytes: MAX_RESPONSE_BODY_BYTES },
            };
        }
        const body = read;

        if (response.ok) {
            // Only a 200 speaks about the representation.

            if (response.status === 200 && request.method === "GET") {
                const etag = response.headers.get("etag");
                if (etag !== null && body.length <= DEFAULT_ETAG_CACHE_ENTRY_BYTES) {
                    cache.store(request.url, {
                        etag,
                        variant,
                        body,
                        headers: representationHeaders(responseHeaders),
                    });
                } else {
                    // A 200 with no retainable validator leaves any kept entry stale.

                    cache.remove(request.url);
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

    /**
     * The content-creation lane: one comment creation at a time, spaced by the constant above.
     * The lane holds until the request FINISHES, so two creations never overlap in flight.
     */
    let creationLane: Promise<void> = Promise.resolve();
    let lastCreationAt: number | null = null;
    /** The hour both lanes share, anchored at its own first creation (F11). */
    let creationHourFrom: number | null = null;
    let createdThisHour = 0;

    /** Take this hour's next creation slot, or answer that the hour is full. */
    const takeCreationSlot = (at: number): boolean => {
        if (creationHourFrom === null || at - creationHourFrom >= HOUR_MS) {
            creationHourFrom = at;
            createdThisHour = 0;
        }
        if (createdThisHour >= contentCreationHourly) return false;
        createdThisHour += 1;
        return true;
    };

    /** Wait out this creation's turn, or name what stops it. */
    const spaceCreation = async (): Promise<GitHubFailure | null> => {
        let startedAt: number;
        try {
            startedAt = clock().getTime();
        } catch {
            return brokenSeamFailure("clock");
        }
        if (!takeCreationSlot(startedAt)) return notSentFailure("contentCreationCeiling");
        const due = lastCreationAt === null ? 0 : lastCreationAt + CONTENT_CREATION_SPACING_MS;
        if (due > startedAt) {
            try {
                await sleep(due - startedAt);
            } catch {
                return brokenSeamFailure("sleep");
            }
        }
        try {
            lastCreationAt = clock().getTime();
        } catch {
            return brokenSeamFailure("clock");
        }
        return null;
    };

    const throughCreationLane = (work: () => Promise<GitHubOutcome>): Promise<GitHubOutcome> => {
        const run = creationLane.then(async (): Promise<GitHubOutcome> => {
            const broken = await spaceCreation();
            return broken ?? work();
        });
        // The lane tracks completion, not success.

        creationLane = run.then(settled, settled);
        return run;
    };

    return {
        async request(request, allowance): Promise<GitHubOutcome> {
            const admitted = admit(request);
            if (!admitted.ok) return admitted.refusal;
            const safeRequest = admitted.request;
            const write = admitted.write;
            const retriable = mayRetryInClient(safeRequest);
            const pool = poolOf(safeRequest);

            /** What GitHub charged for this exchange, taken from the response it answered with. */
            const charge = (outcome: GitHubOutcome): void => {
                if (allowance === undefined || outcome.status === undefined) return;
                const headers = outcome.headers ?? {};
                const charged = chargedPool(headers, pool);
                // The window is read before the charge: a rolled window starts at this one.

                allowance.observed(charged, headers);
                allowance.charge({
                    pool: charged,
                    mutation: write !== null,
                    status: outcome.status,
                    points: charged === "graphql" ? pointsIn(outcome.body ?? "") : null,
                });
            };

            let waitedMs = 0;
            /** This request's next move, or the broken clock that ends it. */
            const move = (failure: FailureClass, attempt: number): NextStep | "brokenClock" => {
                let now: Date;
                try {
                    now = clock();
                } catch {
                    return "brokenClock";
                }
                return nextStep(failure, attempt, now, waitedMs);
            };
            /** Pause, spending the wait from this request's own ceiling. */
            const rest = async (ms: number): Promise<GitHubFailure | null> => {
                waitedMs += ms;
                try {
                    await sleep(ms);
                } catch {
                    return brokenSeamFailure("sleep");
                }
                return null;
            };

            /** Pace, then send until this request's own policy says stop. */
            const deliver = async (): Promise<GitHubOutcome> => {
                // Pacing runs once, before the first send; it is not a retry.

                const paced = pacingClass(pool);
                if (paced !== null) {
                    const step = move(paced, 0);
                    if (step === "brokenClock") return brokenSeamFailure("clock");
                    if (step.step !== "wait") return { ok: false, failure: paced };
                    const broken = await rest(step.ms);
                    if (broken !== null) return broken;
                }

                let previous: GitHubOutcome | null = null;
                for (let attempt = 0; ; attempt += 1) {
                    let tokenOutcome: TokenOutcome;
                    try {
                        tokenOutcome = await tokenSource.current();
                        if (!isWellFormedTokenOutcome(tokenOutcome)) {
                            return brokenSeamFailure("tokenSource");
                        }
                    } catch {
                        // `current()` promises not to throw.
                        return brokenSeamFailure("tokenSource");
                    }
                    if (!tokenOutcome.ok) return tokenOutcome;
                    const missing = missingGrants(admitted.reads, write, tokenOutcome.token);
                    if (missing.length > 0) {
                        return {
                            ok: false,
                            failure: {
                                kind: "permissionMissing",
                                acceptedPermissions: missing.join(", "),
                            },
                        };
                    }

                    const refusing = allowance?.refuses(pool, write !== null) ?? null;
                    if (refusing !== null) {
                        allowance?.refused(refusing);
                        return previous ?? allowanceFailure(refusing);
                    }

                    let outcome: GitHubOutcome;
                    try {
                        outcome = await sendOnce(safeRequest, tokenOutcome.token, pool);
                    } catch {
                        // What escapes `sendOnce()` is a response object that broke mid-read.

                        return brokenSeamFailure("response");
                    }
                    charge(outcome);
                    previous = outcome;
                    if (outcome.ok) return outcome;
                    const responseClass = responseClassOf(outcome.failure);
                    if (responseClass === null) return outcome;
                    // A rejected token is dropped even on the final attempt.

                    if (responseClass.kind === "tokenExpired") {
                        try {
                            tokenSource.invalidate(tokenOutcome.token);
                        } catch {
                            return brokenSeamFailure("invalidate");
                        }
                    }
                    if (!retriable) return outcome;
                    const step = move(responseClass, attempt);
                    if (step === "brokenClock") return brokenSeamFailure("clock");
                    if (step.step === "return") return outcome;
                    if (step.step === "wait") {
                        const broken = await rest(step.ms);
                        if (broken !== null) return broken;
                    }
                }
            };

            const outcome =
                write?.endpoint === "createComment"
                    ? await throughCreationLane(deliver)
                    : await deliver();

            // Drop the validators a landed write staled; the test is "may have reached
            // GitHub", not "succeeded" — a 304 from a pre-write body would hide it (D46).

            if (write !== null && (outcome.ok || outcome.failure.kind !== "notSent")) {
                for (const url of write.invalidates) cache.removeResource(url);
            }
            return outcome;
        },
        latestRateLimit(): RateLimitSnapshot | null {
            const latest = latestResource === null ? undefined : slots.get(latestResource);
            return latest === undefined ? null : { ...latest, headers: { ...latest.headers } };
        },
    };
}
