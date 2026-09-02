/**
 * The one authenticated GitHub call path used by every adapter operation.
 *
 * This file deliberately owns the mechanics that would otherwise drift
 * between operations: request headers, timeouts, the bounded ETag cache, the
 * bounded body read, rate-limit state and the pacing it feeds, refusal of
 * redirects, and how long a failure is waited on before it is handed back.
 * Waiting is this file's job because nothing below it may hold a claimed
 * delivery, and nothing above it can see a `retry-after` (D20).
 *
 * Core owns the vocabulary for GitHub responses and the retry advice for
 * each class; this file adds the two results core cannot have — a request
 * refused locally, and a response too large to read — plus the bounds a
 * process holding a claim needs. Which token to send is `token.ts`.
 *
 * Writes travel the same path behind a per-endpoint allowlist: the four
 * operations the endpoint matrix confirmed, matched by path shape, and
 * nothing else. What each answer MEANS is `writes.ts`; this file only decides
 * whether a write may be sent, how often it may be sent again, and what its
 * success makes untrustworthy in the cache.
 *
 * In order below: the chosen bounds, the contract, the local judgements, the
 * retry policy, the representation cache, the client.
 */

import {
    classifyFailure,
    MAX_RATE_LIMIT_ATTEMPTS,
    parseSecondsHeader,
    retryAdvice,
    type FailureClass,
    type PermissionGrant,
} from "@hiero-hackers/automation-core";
import {
    isPastExpiry,
    isWellFormedTokenOutcome,
    type InstallationToken,
    type TokenOutcome,
    type TokenSource,
} from "./token.js";
import { jsonRecordOf } from "./untrusted.js";

// ─── The chosen bounds ───────────────────────────────────────────────

/** The REST version this client has been checked against. */
export const GITHUB_API_VERSION = "2026-03-10";

/** Installation credentials never leave GitHub's public API origin. */
export const GITHUB_API_ORIGIN = "https://api.github.com";

/** The only POST target: GitHub's read-only GraphQL query endpoint. */
export const GITHUB_GRAPHQL_URL = `${GITHUB_API_ORIGIN}/graphql`;

/** A request gets this long per attempt unless the composition root chooses less. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

/** Full representations retained for conditional reads, least-recently-used. */
export const DEFAULT_ETAG_CACHE_ENTRIES = 1_000;

/** Retained bodies across all entries, in UTF-16 code units — close enough for a bound. */
export const DEFAULT_ETAG_CACHE_BYTES = 20 * 1024 * 1024;

/** A body larger than this is not worth retaining for a conditional re-read. */
export const DEFAULT_ETAG_CACHE_ENTRY_BYTES = 512 * 1024;

/**
 * The largest response body this client will read.
 *
 * Eight times the per-entry cache bound above: a body too large to retain is
 * still read whole and classified, and anything past this is abandoned
 * mid-stream rather than buffered. The largest response any operation here
 * asks for is a hundred-entry timeline page.
 */
export const MAX_RESPONSE_BODY_BYTES = 8 * DEFAULT_ETAG_CACHE_ENTRY_BYTES;

/** Sent on every request this package makes, the mint's POST included. */
export const USER_AGENT = "hiero-hackers-sdk-automations";

const DEFAULT_ACCEPT = "application/vnd.github+json";

/** Attempts per request on a rejected token: the first, then one fresh mint. */
const TOKEN_REFRESH_ATTEMPTS = 2;

/**
 * Attempts per request on weather, where core's backoff list would allow four.
 *
 * The shell already re-runs the whole delivery up to five times with its own
 * doubling backoff, so an in-request retry only has to clear a blip a second
 * send clears. Further attempts duplicate that machinery while holding a claim.
 */
const TRANSIENT_ATTEMPTS = 2;

/**
 * Everything one `request()` may spend asleep, across all of its retries.
 *
 * The caller sits inside a claimed delivery, and a claim older than the
 * shell's `STALE_CLAIM_MINUTES` (15) is presumed dead and taken over. Thirty
 * seconds is three percent of that window: long enough for the one wait worth
 * taking in process — a primary budget whose reset is already seconds away —
 * and far too short for a secondary limit's sixty-second floor or a distant
 * reset. Those return at once, into the shell's counted-attempt retry and
 * dead-letter machinery, rather than camping on the claim.
 *
 * Per request rather than per delivery, because a wait long enough to matter
 * ends the delivery's reading anyway: every caller in this package returns on
 * its first failed request.
 */
export const MAX_RETRY_WAIT_MS = 30_000;

/**
 * How much of a backoff this package CHOSE is spent spreading it out.
 *
 * Jitter is added only where the advice carries no wait signal of its own. An
 * instant GitHub dictated is the same for every worker and waiting past it is
 * already required; a chosen constant fires every worker that failed together
 * back in lockstep. The spread comes from the clock rather than a random
 * source, so a wait stays reproducible in a report and is still decorrelated:
 * two workers that fail on different milliseconds wait different amounts.
 */
const BACKOFF_JITTER_FRACTION = 0.25;

/**
 * Primary-budget requests held back rather than spent.
 *
 * The shared rate budget is a protected asset, and one repository must not be
 * able to make every installation unavailable (threat model §2). One percent
 * of GitHub's hourly five thousand. Under it this client stops as if already
 * exhausted, so work ends countably in the shell's retry machinery instead of
 * at the hard wall, halfway through a delivery.
 */
export const PRIMARY_BUDGET_RESERVE = 50;

const LINKED_ISSUES_GRANTS: readonly PermissionGrant[] = ["issues:read", "pull_requests:read"];

/** Every admitted write is an issue-surface write; nothing weaker allows one. */
const WRITE_GRANT: PermissionGrant = "issues:write";

/**
 * The smallest gap between two comment creations this client will leave.
 *
 * Experiment 6.4 tripped an UNSIGNALLED secondary limit at roughly eighty
 * writes a minute (~71 at concurrency 20, no `retry-after`), and core's advice
 * for a limit with no wait signal is a sixty-second floor — so tripping it
 * costs a minute and returns nothing to wait on. Two seconds is thirty a
 * minute, under forty percent of the observed threshold, and a delivery that
 * writes a handful of comments never notices it. The number is a floor to stay
 * far below, not a target to approach.
 *
 * Two honest limits. It is per client instance, so a second process doubles
 * the real rate. And it spaces CREATION only: 6.4 measured content creation,
 * and a label call is not content.
 */
export const CONTENT_CREATION_SPACING_MS = 2_000;

// ─── The contract ────────────────────────────────────────────────────

/** The operation-specific part of a GitHub request. */
interface GitHubGetRequest {
    readonly url: string;
    readonly method: "GET";
    readonly headers?: Readonly<Record<string, string>>;
}

interface GitHubGraphqlRequest {
    readonly url: string;
    readonly method: "POST";
    readonly body: string;
    readonly headers?: Readonly<Record<string, string>>;
}

/**
 * Whether sending this write twice could change the world twice.
 *
 * The CALLER declares it. Nothing in a method or a URL says it: a POST that
 * adds a label already present is a no-op, and a POST that creates a comment
 * is not, and the two are the same verb at neighbouring paths.
 */
export type WriteIdempotency = "idempotent" | "nonIdempotent";

/** The four write operations the endpoint matrix confirmed, by path shape. */
export type WriteEndpoint = "addLabel" | "removeLabel" | "createComment" | "updateComment";

/**
 * A REST write at one of those four endpoints.
 *
 * `idempotency` is what marks a request as a write at all — the other two arms
 * do not declare it — so a DELETE or PATCH that forgets it is refused as a
 * disallowed method rather than sent unexamined.
 *
 * D4 is enforced by the SHAPE of the allowlist, not by a check: the only
 * removal admitted is `DELETE …/labels/{name}`, which names one label. GitHub's
 * remove-every-label endpoint (the same path without `{name}`) matches nothing
 * here, so "remove by prefix" cannot be expressed through this client.
 */
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
    | "brokenSeam";

/**
 * The injected seam a `brokenSeam` refusal names as the one that failed.
 *
 * A seam failure is rare and hard to reproduce, so the one report an
 * operator gets must say which piece of wiring broke.
 */
export type BrokenSeam =
    "tokenSource" | "clock" | "timeoutSignal" | "tokenValue" | "invalidate" | "response" | "sleep";

/**
 * Core owns the response classes; the adapter adds the two it cannot have.
 *
 * `notSent` is a request refused before it left the process.
 * `responseTooLarge` is the opposite end: a response that arrived and was
 * abandoned at `MAX_RESPONSE_BODY_BYTES`. Neither is ever retried — the
 * refusal is deterministic, and a re-read returns the same bytes.
 */
export type GitHubHttpFailureClass =
    | FailureClass
    | { readonly kind: "responseTooLarge"; readonly limitBytes: number }
    | { readonly kind: "notSent"; readonly reason: Exclude<NotSentReason, "brokenSeam"> }
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

/** The production pause between attempts, and the only real timer here. */
export const wait = (milliseconds: number): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, milliseconds));

/**
 * Seams the composition root supplies; only the token source is required.
 *
 * `sleep` is injected for the same reason `clock` is: a suite that waited the
 * advised delays would take minutes and prove nothing the recorded pauses do
 * not prove instantly.
 */
export interface GitHubHttpClientOptions {
    readonly tokenSource: TokenSource;
    readonly fetch?: FetchLike;
    readonly clock?: () => Date;
    readonly sleep?: (milliseconds: number) => Promise<void>;
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

/** The one spelling of a repository's API path — owner and repo encoded
 * once, identically, for every operation that names one. */
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

/**
 * The page `rel="last"` names in a `link` header, or `null` when absent.
 * That does NOT imply a complete response. Pagination is this client's vocabulary —
 * the cache retains `link` on stored representations for exactly this read.
 */
export function lastPageFromLink(link: string | undefined): number | null {
    // Stryker disable next-line ConditionalExpression: exec stringifies undefined and misses; the guard is for readers.
    if (link === undefined) return null;
    const match = /[?&]page=(\d+)[^>]*>;\s*rel="last"/.exec(link);
    return match === null ? null : Number(match[1]);
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
    | { readonly ok: true; readonly url: URL }
    | { readonly ok: false; readonly refused: "malformedUrl" | "disallowedOrigin" };

function githubApiUrl(rawUrl: string): GitHubApiUrl {
    let url: URL;
    try {
        url = new URL(rawUrl);
    } catch {
        return { ok: false, refused: "malformedUrl" };
    }
    return url.origin === GITHUB_API_ORIGIN
        ? { ok: true, url }
        : { ok: false, refused: "disallowedOrigin" };
}

/** Does this request declare itself a write? Only the write arm may. */
function isWrite(request: GitHubRequest): request is GitHubWriteRequest {
    return "idempotency" in request;
}

/** The body a request carries, or `undefined` when it carries none. */
function bodyOf(request: GitHubRequest): string | undefined {
    if (!("body" in request)) return undefined;
    return typeof request.body === "string" ? request.body : undefined;
}

/** Genuine transport weather — the one locally-made class worth a retry. */
function transportFailure(): GitHubFailure {
    return { ok: false, failure: { kind: "transient" } };
}

/** The request never left the process; retrying cannot help. */
function notSentFailure(reason: Exclude<NotSentReason, "brokenSeam">): GitHubFailure {
    return { ok: false, failure: { kind: "notSent", reason } };
}

/** A wiring defect in the named injected seam — never weather, never retried. */
function brokenSeamFailure(seam: BrokenSeam): GitHubFailure {
    return { ok: false, failure: { kind: "notSent", reason: "brokenSeam", seam } };
}

/**
 * One line naming a failure, with the detail the adapter's own classes carry.
 *
 * Every seam this package fills answers in core's vocabulary, and none of
 * those vocabularies has room for a `brokenSeam` name or a byte limit. The
 * kind alone tells an operator a request failed; this tells them what to fix.
 */
export function describeFailure(failure: GitHubHttpFailureClass): string {
    if (failure.kind === "responseTooLarge") {
        return `responseTooLarge (over ${String(failure.limitBytes)} bytes)`;
    }
    if (failure.kind !== "notSent") return failure.kind;
    return failure.reason === "brokenSeam"
        ? `notSent (broken seam: ${failure.seam})`
        : `notSent (${failure.reason})`;
}

/**
 * One path segment spelled the way `repoPath` spells one: non-empty, and
 * unchanged by a decode-then-encode round trip.
 *
 * Matching a write URL structurally means matching what this package itself
 * builds. A segment that does not round-trip was double-encoded, or carries a
 * character `encodeURIComponent` never emits — either way it is not ours, and
 * a gate that accepted it would be matching a path shape nobody wrote.
 */
function isEncodedSegment(segment: string | undefined): boolean {
    if (segment === undefined || segment.length === 0) return false;
    try {
        return encodeURIComponent(decodeURIComponent(segment)) === segment;
    } catch {
        return false;
    }
}

/** A positive decimal item id, in the one spelling GitHub's paths use. */
function isNumberSegment(segment: string | undefined): boolean {
    return segment !== undefined && /^[1-9][0-9]*$/.test(segment);
}

/**
 * The write endpoint this method and path ARE, or `null` for anything else.
 *
 * Structural, not textual: the path is split into segments, the literals must
 * be literal, and every variable segment must be a number or a
 * `repoPath`-encoded name. A query string or fragment disqualifies a write
 * outright — none of the four takes one, and a parameter is how an admitted
 * shape would grow a second meaning.
 */
function writeEndpointOf(method: string, url: URL): WriteEndpoint | null {
    if (url.search !== "" || url.hash !== "") return null;
    const [repos, owner, repo, issues, ...rest] = url.pathname.split("/").slice(1);
    if (repos !== "repos" || issues !== "issues") return null;
    if (!isEncodedSegment(owner) || !isEncodedSegment(repo)) return null;

    // `PATCH …/issues/comments/{id}` is the one shape that does not name an
    // item number; it is checked first so the number check below can be shared.
    if (method === "PATCH") {
        return rest[0] === "comments" && isNumberSegment(rest[1]) && rest.length === 2
            ? "updateComment"
            : null;
    }
    if (!isNumberSegment(rest[0])) return null;
    if (method === "POST" && rest.length === 2) {
        if (rest[1] === "labels") return "addLabel";
        return rest[1] === "comments" ? "createComment" : null;
    }
    if (method === "DELETE") {
        return rest[1] === "labels" && isEncodedSegment(rest[2]) && rest.length === 3
            ? "removeLabel"
            : null;
    }
    return null;
}

/**
 * Cache keys a landed write makes untrustworthy.
 *
 * Keys are whole hrefs, so this returns RESOURCE prefixes and the cache drops
 * each one's query-string variants too (`…/comments` and
 * `…/comments?per_page=100&page=1` are one resource read two ways).
 *
 * What it cannot reach, and neither can any honest version of it. A list page
 * that merely CONTAINS the item — `…/issues?labels=…` — is a different
 * resource under a filter this cannot enumerate. `PATCH …/issues/comments/{id}`
 * does not name its parent issue, so the issue's comment list survives an
 * edit. And the cache is per client instance: another process holds its own.
 */
function invalidatedBy(endpoint: WriteEndpoint, url: URL): readonly string[] {
    if (endpoint === "updateComment") return [`${GITHUB_API_ORIGIN}${url.pathname}`];
    // The other three all hang off `/repos/{o}/{r}/issues/{n}`, which is the
    // first five segments of a path the matcher has already proved.
    const item = `${GITHUB_API_ORIGIN}${url.pathname.split("/").slice(0, 6).join("/")}`;
    const list = endpoint === "createComment" ? "comments" : "labels";
    // The timeline carries both a label event and a comment event, so every
    // one of the three stales it.
    return [item, `${item}/${list}`, `${item}/timeline`];
}

/** What admitting a write learned, for the policy and the cache above. */
interface AdmittedWrite {
    readonly endpoint: WriteEndpoint;
    readonly invalidates: readonly string[];
}

/** A request as it may be sent, or the refusal that stops it here. */
type AdmittedRequest =
    | {
          readonly ok: true;
          readonly request: GitHubRequest;
          readonly write: AdmittedWrite | null;
      }
    | { readonly ok: false; readonly refusal: GitHubFailure };

const refused = (reason: Exclude<NotSentReason, "brokenSeam">): AdmittedRequest => ({
    ok: false,
    refusal: notSentFailure(reason),
});

/**
 * The one GraphQL query this package may POST, checked before it is sent.
 * Nothing else may reach `/graphql`, and this operation may reach nothing else.
 */
function admitGraphql(request: GitHubGraphqlRequest, url: URL): AdmittedRequest {
    if (url.href !== GITHUB_GRAPHQL_URL) return refused("disallowedMethod");
    if (typeof request.body !== "string") return refused("invalidBody");
    try {
        const body = JSON.parse(request.body) as Record<string, unknown>;
        if (
            body.operationName !== "LinkedIssues" ||
            typeof body.query !== "string" ||
            !/^\s*query\s+LinkedIssues(?:\s|\()/.test(body.query)
        ) {
            return refused("invalidBody");
        }
    } catch {
        return refused("invalidBody");
    }
    return { ok: true, request: { ...request, url: url.href }, write: null };
}

/**
 * A write against the per-endpoint allowlist.
 *
 * The body rule is per endpoint rather than per method, because the four
 * endpoints disagree: three carry a JSON object and the label removal carries
 * nothing. A body where none belongs is refused rather than dropped — sending
 * a request the caller did not write is worse than not sending it.
 */
function admitWrite(request: GitHubWriteRequest, url: URL): AdmittedRequest {
    const endpoint = writeEndpointOf(request.method, url);
    if (endpoint === null) return refused("disallowedMethod");
    // Unreachable through the type, and the retry policy reads this field.
    // A declaration that is neither word is a malformed request, not a write.
    if (request.idempotency !== "idempotent" && request.idempotency !== "nonIdempotent") {
        return refused("invalidBody");
    }
    const body = bodyOf(request);
    if (endpoint === "removeLabel") {
        if (body !== undefined) return refused("invalidBody");
    } else {
        if (body === undefined || jsonRecordOf(body) === null) return refused("invalidBody");
    }
    return {
        ok: true,
        request: { ...request, url: url.href },
        write: { endpoint, invalidates: invalidatedBy(endpoint, url) },
    };
}

/**
 * The gate every request passes before a token is acquired: the admitted
 * methods, the pinned origin, the one GraphQL query this package may POST, and
 * the four write endpoints the matrix confirmed.
 *
 * It runs first so a refusal never costs a mint, and it normalises the URL so
 * everything downstream — the cache key included — sees one spelling.
 */
function admit(request: GitHubRequest): AdmittedRequest {
    const write = isWrite(request);
    if (!write && request.method !== "GET" && request.method !== "POST") {
        return refused("disallowedMethod");
    }
    const parsed = githubApiUrl(request.url);
    if (!parsed.ok) return refused(parsed.refused);
    if (write) return admitWrite(request, parsed.url);
    if (request.method === "POST") return admitGraphql(request, parsed.url);
    return { ok: true, request: { ...request, url: parsed.url.href }, write: null };
}

/**
 * The response body as text, or `null` when it passed the bound.
 *
 * Read chunk by chunk rather than through `response.text()`: the bound has to
 * stop an oversized body from being buffered, and a length checked after the
 * fact has already cost the memory it was meant to refuse. The decoder is
 * driven in streaming mode so a multi-byte character split across two chunks
 * survives.
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

function hasReadGrant(token: InstallationToken, required: PermissionGrant): boolean {
    const write = `${required.slice(0, -4)}write`;
    return token.grants.some((grant) => grant === required || grant === write);
}

/**
 * Grants this request needs and the token does not carry.
 *
 * The read-side precheck (D123) is the pattern; what differs is what counts as
 * enough. A read is satisfied by the matching write grant, because write
 * implies read. A write is satisfied by nothing weaker than itself, so the
 * check is equality and the accepted permission it reports is the exact grant
 * an installation would have to add.
 */
function missingGrants(
    request: GitHubRequest,
    token: InstallationToken,
): readonly PermissionGrant[] {
    if (isWrite(request)) {
        return token.grants.some((grant) => grant === WRITE_GRANT) ? [] : [WRITE_GRANT];
    }
    if (request.method !== "POST") return [];
    return LINKED_ISSUES_GRANTS.filter((grant) => !hasReadGrant(token, grant));
}

/** Ready-to-send headers and the variant they select, or the refusal. */
type PreparedHeaders =
    | { readonly ok: true; readonly headers: Headers; readonly variant: string }
    | { readonly ok: false; readonly refusal: GitHubFailure };

/**
 * The operation's headers with the controlled fields installed.
 *
 * Controlled fields never select a representation: caller values for them
 * are deleted before the variant is derived, then ours are installed.
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
    // A content type describes a body. The label removal is a DELETE with
    // none, and declaring one there would describe nothing.
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
        // Our two constants are known-good header values; only the token
        // value can make this throw.
        return { ok: false, refusal: brokenSeamFailure("tokenValue") };
    }
    return { ok: true, headers, variant };
}

// ─── The retry policy ────────────────────────────────────────────────

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
 *
 * The rate classes get core's bound, which was measured: a limit surviving
 * three full waits is a pacing problem for an operator, not a wait problem.
 * The other two are this file's, and both are tighter than core's — see their
 * constants for why a process holding a claim spends less than a caller with
 * no deadline. A class core refuses to retry never reaches its cap.
 */
function attemptCap(kind: FailureClass["kind"]): number {
    if (kind === "tokenExpired") return TOKEN_REFRESH_ATTEMPTS;
    if (kind === "transient") return TRANSIENT_ATTEMPTS;
    return MAX_RATE_LIMIT_ATTEMPTS;
}

/**
 * May this request be sent again inside one `request()` call?
 *
 * Reads and idempotent writes retry under the caps above. A NON-IDEMPOTENT
 * write gets zero in-client retries of any class, and the exception list is
 * empty on purpose.
 *
 * The tempting version keeps the classes that prove nothing happened — a 401,
 * a rate limit — and drops only the ambiguous ones. It is wrong in the way
 * that matters. The dangerous class is `transient`, which covers a timeout and
 * a dropped socket, and those are exactly the failures where GitHub may have
 * applied the change and lost the answer on the way back. Experiment 6.5
 * turned that into a duplicated comment on the first attempt at a blind retry.
 * A per-class exemption also has to stay right forever: the day a new class
 * lands in `classifyFailure`, a list of safe ones silently admits it.
 *
 * So the rule is one rule with no arms. A failure returns immediately, with
 * its class intact, to the journal and read-back layer above — which owns
 * recovery because it is the only layer that can look at GitHub and see
 * whether the effect landed (D46).
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
 * What to do about `failure` after `attempt` earlier failures of this request,
 * given the `waitedMs` the request has already spent asleep.
 *
 * The delay is core's; what this adds is the two bounds a process holding a
 * claim needs. A wait that would breach the ceiling returns the failure
 * WITHOUT sleeping first: a partial wait spends the claim and still fails.
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
            if (entry === undefined || entry.variant !== variant) return undefined;
            // Reading an entry makes it newest in the bounded LRU.
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
                // `size > a non-negative limit` proves an entry exists, and the
                // per-entry byte cap proves a one-entry cache is under the total.
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

// ─── The client ──────────────────────────────────────────────────────

/** A settled promise's value discarded — both arms of "that one finished". */
const settled = (): undefined => undefined;

export function createGitHubHttpClient({
    tokenSource,
    fetch: send = fetch,
    clock = () => new Date(),
    sleep = wait,
    timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
    timeoutSignal = AbortSignal.timeout,
}: GitHubHttpClientOptions): GitHubHttpClient {
    const cache = createRepresentationCache();
    let latestRateLimit: RateLimitSnapshot | null = null;

    const rememberRateLimit = (
        url: string,
        status: number,
        headers: Readonly<Record<string, string>>,
    ): void => {
        latestRateLimit = { url, status, headers: rateLimitHeaders(headers) };
    };

    /**
     * The exhaustion the NEXT request should assume, from what the last
     * response said — the one consumer of the rate snapshot.
     *
     * `remaining` is parsed with the seconds parser because GitHub spells it
     * with the same whole-number grammar, and permissive coercion would turn
     * a malformed count into a confident zero. A count with no usable reset is
     * ignored: pacing on it could never expire, and would wedge the client
     * behind a response it has stopped sending.
     */
    const pacingClass = (): FailureClass | null => {
        if (latestRateLimit === null) return null;
        const remaining = parseSecondsHeader(latestRateLimit.headers["x-ratelimit-remaining"]);
        const resetAt = latestRateLimit.headers["x-ratelimit-reset"];
        if (remaining.kind !== "valid" || remaining.seconds >= PRIMARY_BUDGET_RESERVE) return null;
        return parseSecondsHeader(resetAt).kind === "valid"
            ? { kind: "primaryExhausted", resetAt }
            : null;
    };

    const sendOnce = async (
        request: GitHubRequest,
        token: InstallationToken,
    ): Promise<GitHubOutcome> => {
        const prepared = prepareHeaders(request, token);
        if (!prepared.ok) return prepared.refusal;
        const { headers, variant } = prepared;
        const requestBody = bodyOf(request);

        // A write is never a GET, so it never carries a validator.
        const cached = request.method === "GET" ? cache.lookup(request.url, variant) : undefined;
        if (cached !== undefined) headers.set("if-none-match", cached.etag);

        // Capture the local age at send time. A later clock read could turn a
        // live request into a false `tokenExpired` diagnosis.
        let tokenPastExpiry: boolean;
        try {
            tokenPastExpiry = isPastExpiry(token, clock());
        } catch {
            return brokenSeamFailure("clock");
        }
        // A throwing timeout factory is a wiring defect, not retriable weather.
        let signal: AbortSignal;
        try {
            signal = timeoutSignal(timeoutMs);
        } catch {
            return brokenSeamFailure("timeoutSignal");
        }
        const init: RequestInit = {
            method: request.method,
            headers,
            // Following is deliberately not delegated to fetch: hidden 3xx
            // calls would evade origin validation, rate tracking, failure
            // classification, and the two-attempt bound.
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
        rememberRateLimit(request.url, response.status, responseHeaders);

        if (response.status === 304) {
            // A 304 with nothing to reuse: the entry was evicted mid-flight,
            // or the server misbehaved. Either way a full re-read fixes it.
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
            // Only a 200 speaks about the representation; a 202 or 204 must
            // not evict a validator that is still good.
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
     * The content-creation lane: one comment creation at a time, spaced by at
     * least `CONTENT_CREATION_SPACING_MS`.
     *
     * The lane holds until the request FINISHES, not until the spacing wait
     * ends, so two creations never overlap in flight — a burst is what 6.4
     * tripped, and spacing alone would still let a burst leave together.
     *
     * The wait is not retry budget: it happens before anything is sent, so it
     * cannot spend a claim on a failure, and it is bounded by the spacing
     * itself rather than by `MAX_RETRY_WAIT_MS`.
     */
    let creationLane: Promise<void> = Promise.resolve();
    let lastCreationAt: number | null = null;

    /** Wait out this creation's turn, or name the seam that broke. */
    const spaceCreation = async (): Promise<GitHubFailure | null> => {
        let startedAt: number;
        try {
            startedAt = clock().getTime();
        } catch {
            return brokenSeamFailure("clock");
        }
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
        // The lane tracks completion, not success: a failure is this request's
        // outcome, and must not wedge the next creation either way.
        creationLane = run.then(settled, settled);
        return run;
    };

    return {
        async request(request): Promise<GitHubOutcome> {
            const admitted = admit(request);
            if (!admitted.ok) return admitted.refusal;
            const safeRequest = admitted.request;
            const write = admitted.write;
            const retriable = mayRetryInClient(safeRequest);

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
                // Pacing runs once, before the first send: inside a request the
                // server's own advice already governs, and a retry that paused
                // twice would spend the ceiling on one failure. It is not a
                // retry, so a non-idempotent write waits here like anything else.
                const paced = pacingClass();
                if (paced !== null) {
                    const step = move(paced, 0);
                    if (step === "brokenClock") return brokenSeamFailure("clock");
                    if (step.step !== "wait") return { ok: false, failure: paced };
                    const broken = await rest(step.ms);
                    if (broken !== null) return broken;
                }

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
                    const missing = missingGrants(safeRequest, tokenOutcome.token);
                    if (missing.length > 0) {
                        return {
                            ok: false,
                            failure: {
                                kind: "permissionMissing",
                                acceptedPermissions: missing.join(", "),
                            },
                        };
                    }

                    let outcome: GitHubOutcome;
                    try {
                        outcome = await sendOnce(safeRequest, tokenOutcome.token);
                    } catch {
                        // `sendOnce()` contains expected transport failures itself;
                        // what escapes it is a response object that broke mid-read.
                        return brokenSeamFailure("response");
                    }
                    if (outcome.ok) return outcome;
                    const responseClass = responseClassOf(outcome.failure);
                    if (responseClass === null) return outcome;
                    // A rejected token is dropped even on the final attempt, so
                    // the next `request()` starts on a fresh mint.
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

            // Drop the validators a landed write staled — see `invalidatedBy`.
            // The test is "may have reached GitHub", not "succeeded": an
            // ambiguous outcome is exactly when a read-back runs next, and a
            // 304 answered from a PRE-write body would let it conclude
            // "absent" about a change that landed. That is the duplicate D46
            // exists to prevent, so the one full re-read is the price.
            if (write !== null && (outcome.ok || outcome.failure.kind !== "notSent")) {
                for (const url of write.invalidates) cache.removeResource(url);
            }
            return outcome;
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
