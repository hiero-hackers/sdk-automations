/**
 * The shared call path, exercised without a credential or a network.
 *
 * Response scripts count attempts because retry bounds, conditional reads,
 * and "do not call again" are the behaviour under test here.
 */

import { BODY_PATTERNS, type FailureClass } from "@hiero-hackers/automation-core";
import { describe, expect, it } from "vitest";
import {
    createGitHubHttpClient,
    DEFAULT_ETAG_CACHE_BYTES,
    DEFAULT_ETAG_CACHE_ENTRIES,
    DEFAULT_ETAG_CACHE_ENTRY_BYTES,
    DEFAULT_REQUEST_TIMEOUT_MS,
    GITHUB_API_ORIGIN,
    GITHUB_API_VERSION,
    type FetchLike,
    type GitHubRequest,
} from "../src/http.js";
import type { InstallationToken, TokenOutcome, TokenSource } from "../src/token.js";

const NOW = new Date("2026-08-21T10:00:00.000Z");
const URL = "https://api.github.com/repos/hiero-hackers/sdk-automations/issues/132";

function token(value: string, expiresAt = new Date(NOW.getTime() + 3_600_000)): InstallationToken {
    return { value, expiresAt, grants: ["issues:write"] };
}

function tokenSource(outcomes: readonly TokenOutcome[]) {
    const invalidated: InstallationToken[] = [];
    let calls = 0;
    const source: TokenSource = {
        current: () => {
            const outcome = outcomes[Math.min(calls, outcomes.length - 1)];
            calls += 1;
            return Promise.resolve(outcome!);
        },
        invalidate: (rejected) => invalidated.push(rejected),
    };
    return { source, invalidated, calls: () => calls };
}

type ResponseStep = Response | Error | ((url: string, init: RequestInit) => Response);

function responseScript(steps: readonly ResponseStep[]) {
    const calls: Array<{ readonly url: string; readonly init: RequestInit }> = [];
    const fetch: FetchLike = (input, init) => {
        const url = String(input);
        const given = init ?? {};
        calls.push({ url, init: given });
        const step = steps[Math.min(calls.length - 1, steps.length - 1)]!;
        if (step instanceof Error) return Promise.reject(step);
        return Promise.resolve(typeof step === "function" ? step(url, given) : step);
    };
    return { fetch, calls };
}

function success(body = '{"ok":true}', headers?: HeadersInit): Response {
    return new Response(body, headers === undefined ? { status: 200 } : { status: 200, headers });
}

function failure(status: number, body: string, headers?: HeadersInit): Response {
    return new Response(body, headers === undefined ? { status } : { status, headers });
}

function request(
    overrides: {
        readonly url?: string;
        readonly headers?: Readonly<Record<string, string>>;
    } = {},
): GitHubRequest {
    return { url: URL, method: "GET", ...overrides };
}

function harness(
    steps: readonly ResponseStep[],
    outcomes: readonly TokenOutcome[] = [{ ok: true, token: token("installation-token") }],
) {
    const scripted = responseScript(steps);
    const tokens = tokenSource(outcomes);
    const timeoutCalls: number[] = [];
    const client = createGitHubHttpClient({
        tokenSource: tokens.source,
        fetch: scripted.fetch,
        clock: () => NOW,
        timeoutSignal: (milliseconds) => {
            timeoutCalls.push(milliseconds);
            return AbortSignal.abort("test timeout signal");
        },
    });
    return { client, scripted, tokens, timeoutCalls };
}

describe("request shaping", () => {
    it("owns authentication, API version, defaults, and the timeout signal", async () => {
        const { client, scripted, timeoutCalls } = harness([success()]);

        const result = await client.request(
            request({
                headers: {
                    authorization: "Bearer caller-must-not-win",
                    "x-github-api-version": "old",
                    "if-none-match": '"caller-must-not-win"',
                    accept: "application/vnd.github.raw+json",
                },
            }),
        );

        expect(result.ok).toBe(true);
        expect(scripted.calls).toHaveLength(1);
        const headers = new Headers(scripted.calls[0]!.init.headers);
        expect(headers.get("authorization")).toBe("Bearer installation-token");
        expect(headers.get("x-github-api-version")).toBe(GITHUB_API_VERSION);
        expect(GITHUB_API_VERSION).toBe("2026-03-10");
        expect(headers.get("accept")).toBe("application/vnd.github.raw+json");
        expect(headers.get("if-none-match")).toBeNull();
        expect(headers.get("user-agent")).toBe("hiero-hackers-sdk-automations");
        expect(scripted.calls[0]!.init.method).toBe("GET");
        expect(scripted.calls[0]!.init.redirect).toBe("manual");
        expect("body" in scripted.calls[0]!.init).toBe(false);
        expect(scripted.calls[0]!.init.signal).toBeInstanceOf(AbortSignal);
        expect(timeoutCalls).toEqual([DEFAULT_REQUEST_TIMEOUT_MS]);
    });

    it("uses the configured timeout and creates a signal for each retry", async () => {
        const scripted = responseScript([new Error("socket closed"), success()]);
        const tokens = tokenSource([{ ok: true, token: token("t") }]);
        const signals: AbortSignal[] = [];
        const client = createGitHubHttpClient({
            tokenSource: tokens.source,
            fetch: scripted.fetch,
            clock: () => NOW,
            timeoutMs: 321,
            timeoutSignal: () => {
                const signal = new AbortController().signal;
                signals.push(signal);
                return signal;
            },
        });

        expect((await client.request(request())).ok).toBe(true);
        expect(signals).toHaveLength(2);
        expect(signals[0]).not.toBe(signals[1]);
    });

    it("turns an observed timeout abort into one bounded transport retry", async () => {
        let fetchCalls = 0;
        const fetch: FetchLike = (_input, init) => {
            fetchCalls += 1;
            return new Promise((_resolve, reject) => {
                const signal = init?.signal;
                if (signal?.aborted === true) {
                    reject(signal.reason);
                    return;
                }
                signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
            });
        };
        const client = createGitHubHttpClient({
            tokenSource: tokenSource([{ ok: true, token: token("t") }]).source,
            fetch,
            clock: () => NOW,
            timeoutSignal: () => {
                const controller = new AbortController();
                queueMicrotask(() =>
                    controller.abort(new DOMException("timed out", "TimeoutError")),
                );
                return controller.signal;
            },
        });

        expect(await client.request(request())).toEqual({
            ok: false,
            failure: { kind: "transient" },
        });
        expect(fetchCalls).toBe(2);
    });

    it("uses the production clock and AbortSignal timeout defaults", async () => {
        const scripted = responseScript([success()]);
        const tokens = tokenSource([{ ok: true, token: token("t", new Date("2099-01-01")) }]);
        const client = createGitHubHttpClient({
            tokenSource: tokens.source,
            fetch: scripted.fetch,
        });

        expect((await client.request(request())).ok).toBe(true);
        expect(scripted.calls[0]!.init.signal).toBeInstanceOf(AbortSignal);
        expect(new Headers(scripted.calls[0]!.init.headers).get("accept")).toBe(
            "application/vnd.github+json",
        );
    });

    it("returns a typed token-source failure without calling fetch", async () => {
        const { client, scripted } = harness(
            [success()],
            [{ ok: false, failure: { kind: "installationSuspended" } }],
        );

        expect(await client.request(request())).toEqual({
            ok: false,
            failure: { kind: "installationSuspended" },
        });
        expect(scripted.calls).toHaveLength(0);
    });

    it("turns a token-source rejection into a typed value without calling fetch", async () => {
        const scripted = responseScript([success()]);
        const source: TokenSource = {
            current: () => Promise.reject(new Error("broken token source")),
            invalidate: () => undefined,
        };
        const client = createGitHubHttpClient({ tokenSource: source, fetch: scripted.fetch });

        expect(await client.request(request())).toEqual({
            ok: false,
            failure: { kind: "notSent", reason: "brokenSeam" },
        });
        expect(scripted.calls).toHaveLength(0);
    });

    it.each([
        ["undefined", undefined],
        ["null", null],
        ["a missing discriminator", {}],
        ["a non-boolean discriminator", { ok: "yes" }],
        ["a null token", { ok: true, token: null }],
        ["a non-object token", { ok: true, token: "token" }],
        ["a non-string token value", { ok: true, token: { ...token("t"), value: 1 } }],
        ["a non-Date expiry", { ok: true, token: { ...token("t"), expiresAt: "later" } }],
        ["an invalid Date expiry", { ok: true, token: token("t", new Date(Number.NaN)) }],
        ["non-array grants", { ok: true, token: { ...token("t"), grants: {} } }],
        ["a null failure", { ok: false, failure: null }],
        ["a non-object failure", { ok: false, failure: "transient" }],
        ["a missing failure kind", { ok: false, failure: {} }],
        ["a non-string failure kind", { ok: false, failure: { kind: 1 } }],
    ])("contains malformed resolved token outcome: %s", async (_label, outcome) => {
        const scripted = responseScript([success()]);
        const source: TokenSource = {
            current: () => Promise.resolve(outcome as never),
            invalidate: () => undefined,
        };
        const client = createGitHubHttpClient({ tokenSource: source, fetch: scripted.fetch });

        expect(await client.request(request())).toEqual({
            ok: false,
            failure: { kind: "notSent", reason: "brokenSeam" },
        });
        expect(scripted.calls).toHaveLength(0);
    });

    it("contains invalid caller headers without retrying or calling fetch", async () => {
        const scripted = responseScript([success()]);
        const tokens = tokenSource([{ ok: true, token: token("t") }]);
        const client = createGitHubHttpClient({
            tokenSource: tokens.source,
            fetch: scripted.fetch,
        });

        expect(
            await client.request(request({ headers: { "x-invalid": "line one\nline two" } })),
        ).toEqual({
            ok: false,
            failure: { kind: "notSent", reason: "invalidHeaders" },
        });
        expect(tokens.calls()).toBe(1);
        expect(scripted.calls).toHaveLength(0);
    });

    it("contains a throwing clock as a broken seam without retrying", async () => {
        const scripted = responseScript([success()]);
        const tokens = tokenSource([{ ok: true, token: token("t") }]);
        const client = createGitHubHttpClient({
            tokenSource: tokens.source,
            fetch: scripted.fetch,
            clock: () => {
                throw new Error("clock failed");
            },
        });

        expect(await client.request(request())).toEqual({
            ok: false,
            failure: { kind: "notSent", reason: "brokenSeam" },
        });
        expect(tokens.calls()).toBe(1);
        expect(scripted.calls).toHaveLength(0);
    });

    it("contains an invalid token value as a broken seam before fetch", async () => {
        const scripted = responseScript([success()]);
        const tokens = tokenSource([{ ok: true, token: token("line one\nline two") }]);
        const client = createGitHubHttpClient({
            tokenSource: tokens.source,
            fetch: scripted.fetch,
            clock: () => NOW,
        });

        expect(await client.request(request())).toEqual({
            ok: false,
            failure: { kind: "notSent", reason: "brokenSeam" },
        });
        expect(tokens.calls()).toBe(1);
        expect(scripted.calls).toHaveLength(0);
    });

    it("contains an invalid injected response shape as a broken seam", async () => {
        let fetchCalls = 0;
        const client = createGitHubHttpClient({
            tokenSource: tokenSource([{ ok: true, token: token("t") }]).source,
            fetch: () => {
                fetchCalls += 1;
                return Promise.resolve(
                    Object.defineProperty({}, "headers", {
                        get: () => {
                            throw new Error("invalid response seam");
                        },
                    }) as Response,
                );
            },
            clock: () => NOW,
        });

        expect(await client.request(request())).toEqual({
            ok: false,
            failure: { kind: "notSent", reason: "brokenSeam" },
        });
        expect(fetchCalls).toBe(1);
    });

    it("rejects cleartext and non-GitHub URLs before acquiring a token", async () => {
        const scripted = responseScript([success()]);
        const tokens = tokenSource([{ ok: true, token: token("must-not-leak") }]);
        const client = createGitHubHttpClient({
            tokenSource: tokens.source,
            fetch: scripted.fetch,
        });

        for (const [url, reason] of [
            ["http://api.github.com/repos/hiero-hackers/sdk-automations", "disallowedOrigin"],
            ["https://api.github.com.attacker.example/steal", "disallowedOrigin"],
            ["not a URL", "malformedUrl"],
        ] as const) {
            expect(await client.request(request({ url }))).toEqual({
                ok: false,
                failure: { kind: "notSent", reason },
            });
        }
        expect(GITHUB_API_ORIGIN).toBe("https://api.github.com");
        expect(tokens.calls()).toBe(0);
        expect(scripted.calls).toHaveLength(0);
    });

    it("refuses to follow redirects and names the refusal instead of retrying", async () => {
        const { client, scripted } = harness([
            new Response(null, {
                status: 302,
                headers: { location: "https://attacker.example/steal" },
            }),
            success("must not happen"),
        ]);

        expect(await client.request(request())).toMatchObject({
            ok: false,
            status: 302,
            body: "",
            failure: {
                kind: "redirected",
                status: 302,
                location: "https://attacker.example/steal",
                permanent: false,
            },
        });
        expect(scripted.calls).toHaveLength(1);
        expect(scripted.calls[0]!.init.redirect).toBe("manual");
    });

    it("marks a 301 as a permanent fact carrying the new location", async () => {
        const moved = "https://api.github.com/repos/hiero-hackers/renamed/issues/132";
        const { client, scripted } = harness([
            new Response(null, { status: 301, headers: { location: moved } }),
            success("must not happen"),
        ]);

        expect(await client.request(request())).toMatchObject({
            ok: false,
            failure: { kind: "redirected", status: 301, location: moved, permanent: true },
        });
        expect(scripted.calls).toHaveLength(1);
    });

    it("classifies a locationless redirect without inventing a destination", async () => {
        const { client } = harness([new Response(null, { status: 308 })]);

        const outcome = await client.request(request());

        expect(outcome).toMatchObject({
            ok: false,
            failure: { kind: "redirected", status: 308, permanent: true },
        });
        if (!outcome.ok && outcome.failure.kind === "redirected") {
            expect("location" in outcome.failure).toBe(false);
        }
    });

    it("rejects mutation methods before acquiring a token", async () => {
        const scripted = responseScript([success()]);
        const tokens = tokenSource([{ ok: true, token: token("must-not-be-used") }]);
        const client = createGitHubHttpClient({
            tokenSource: tokens.source,
            fetch: scripted.fetch,
        });
        const mutation = { url: URL, method: "DELETE" } as unknown as GitHubRequest;

        expect(await client.request(mutation)).toEqual({
            ok: false,
            failure: { kind: "notSent", reason: "disallowedMethod" },
        });
        expect(tokens.calls()).toBe(0);
        expect(scripted.calls).toHaveLength(0);
    });
});

describe("conditional reads", () => {
    it("caches an ETag per URL and returns the cached representation on 304", async () => {
        const { client, scripted } = harness([
            success('{"number":132}', { etag: '"issue-v1"', link: "<next>; rel=next" }),
            new Response(null, { status: 304, headers: { "x-ratelimit-used": "12" } }),
        ]);

        const first = await client.request(request());
        const second = await client.request(request());

        expect(first).toMatchObject({
            ok: true,
            status: 200,
            body: '{"number":132}',
            fromCache: false,
        });
        expect(second).toMatchObject({
            ok: true,
            status: 304,
            body: '{"number":132}',
            fromCache: true,
        });
        expect(new Headers(scripted.calls[0]!.init.headers).get("if-none-match")).toBeNull();
        expect(new Headers(scripted.calls[1]!.init.headers).get("if-none-match")).toBe(
            '"issue-v1"',
        );
        if (second.ok) expect(second.headers.link).toBe("<next>; rel=next");
    });

    it("keeps URL caches separate", async () => {
        const other = `${URL}/comments`;
        const { client, scripted } = harness([
            success("one", { etag: '"one"' }),
            success("other", { etag: '"other"' }),
            new Response(null, { status: 304 }),
        ]);

        await client.request(request());
        await client.request(request({ url: other }));
        const cached = await client.request(request());

        expect(new Headers(scripted.calls[1]!.init.headers).get("if-none-match")).toBeNull();
        expect(new Headers(scripted.calls[2]!.init.headers).get("if-none-match")).toBe('"one"');
        expect(cached).toMatchObject({ ok: true, fromCache: true, body: "one" });
    });

    it("does not reuse an ETag for a different representation", async () => {
        const { client, scripted } = harness([
            success("json", { etag: '"json"' }),
            success("raw", { etag: '"raw"' }),
        ]);

        await client.request(request());
        await client.request(request({ headers: { accept: "application/vnd.github.raw+json" } }));

        expect(new Headers(scripted.calls[1]!.init.headers).get("if-none-match")).toBeNull();
    });

    it("does not let caller-supplied controlled headers split the representation cache", async () => {
        const { client, scripted } = harness([
            success("one", { etag: '"one"' }),
            new Response(null, { status: 304 }),
        ]);

        await client.request(
            request({
                headers: {
                    authorization: "Bearer caller",
                    "if-none-match": '"caller"',
                    "user-agent": "caller",
                    "x-github-api-version": "caller",
                },
            }),
        );
        const cached = await client.request(request());

        expect(new Headers(scripted.calls[1]!.init.headers).get("if-none-match")).toBe('"one"');
        expect(cached).toMatchObject({ ok: true, fromCache: true, body: "one" });
        if (cached.ok) expect(Object.hasOwn(cached.headers, "link")).toBe(false);
    });

    it("rejects a 304 for a representation whose Accept value changed", async () => {
        const { client, scripted } = harness([
            success("json", { etag: '"json"' }),
            new Response(null, { status: 304 }),
            new Response(null, { status: 304 }),
        ]);

        await client.request(request());
        const outcome = await client.request(
            request({ headers: { accept: "application/vnd.github.raw+json" } }),
        );

        expect(outcome).toMatchObject({ ok: false, failure: { kind: "transient" } });
        expect(scripted.calls).toHaveLength(3);
    });

    it("drops a stale validator when a later representation has no ETag", async () => {
        const { client, scripted } = harness([
            success("one", { etag: '"one"' }),
            success("two"),
            success("three"),
        ]);

        await client.request(request());
        await client.request(request());
        await client.request(request());

        expect(new Headers(scripted.calls[1]!.init.headers).get("if-none-match")).toBe('"one"');
        expect(new Headers(scripted.calls[2]!.init.headers).get("if-none-match")).toBeNull();
    });

    it("does not cache a 206 partial response", async () => {
        const { client, scripted } = harness([
            new Response("partial", { status: 206, headers: { etag: '"partial"' } }),
            new Response("partial again", { status: 206, headers: { etag: '"partial-2"' } }),
        ]);
        const ranged = request({ headers: { range: "bytes=0-99" } });

        await client.request(ranged);
        await client.request(ranged);

        expect(new Headers(scripted.calls[1]!.init.headers).get("if-none-match")).toBeNull();
    });

    it("keys representations by caller headers, not only URL and Accept", async () => {
        const { client, scripted } = harness([
            success("ranged", { etag: '"range"' }),
            success("default", { etag: '"default"' }),
        ]);

        await client.request(request({ headers: { range: "bytes=0-99" } }));
        await client.request(request());

        expect(new Headers(scripted.calls[1]!.init.headers).get("if-none-match")).toBeNull();
    });

    it("bounds the ETag cache and evicts the least-recently-used URL", async () => {
        const urls = Array.from(
            { length: DEFAULT_ETAG_CACHE_ENTRIES },
            (_, index) => `${GITHUB_API_ORIGIN}/repos/o/r/issues/${index + 1}`,
        );
        const first = urls[0]!;
        const second = urls[1]!;
        const overflow = `${GITHUB_API_ORIGIN}/repos/o/r/issues/overflow`;
        const scripted = responseScript([
            ...urls.map((_, index) => success(String(index + 1), { etag: `"${index + 1}"` })),
            new Response(null, { status: 304 }),
            success("overflow", { etag: '"overflow"' }),
            success("second again", { etag: '"second-2"' }),
        ]);
        const tokens = tokenSource([{ ok: true, token: token("t") }]);
        const client = createGitHubHttpClient({
            tokenSource: tokens.source,
            fetch: scripted.fetch,
            clock: () => NOW,
        });

        for (const url of urls) await client.request(request({ url }));
        await client.request(request({ url: first })); // touch first; second is now oldest
        await client.request(request({ url: overflow })); // evict second
        await client.request(request({ url: second }));

        expect(
            new Headers(scripted.calls[DEFAULT_ETAG_CACHE_ENTRIES]!.init.headers).get(
                "if-none-match",
            ),
        ).toBe('"1"');
        expect(
            new Headers(scripted.calls[DEFAULT_ETAG_CACHE_ENTRIES + 2]!.init.headers).get(
                "if-none-match",
            ),
        ).toBeNull();
        expect(DEFAULT_ETAG_CACHE_ENTRIES).toBe(1_000);
    });

    it("does not let a 202 evict a still-valid validator", async () => {
        const { client, scripted } = harness([
            success("stats", { etag: '"v1"' }),
            new Response("computing", { status: 202 }),
            new Response(null, { status: 304 }),
        ]);

        await client.request(request());
        const accepted = await client.request(request());
        const cached = await client.request(request());

        expect(accepted).toMatchObject({ ok: true, status: 202, fromCache: false });
        expect(new Headers(scripted.calls[2]!.init.headers).get("if-none-match")).toBe('"v1"');
        expect(cached).toMatchObject({ ok: true, fromCache: true, body: "stats" });
    });

    it("does not retain a body larger than the per-entry byte cap", async () => {
        const oversized = "x".repeat(DEFAULT_ETAG_CACHE_ENTRY_BYTES + 1);
        const { client, scripted } = harness([
            success("small", { etag: '"small"' }),
            success(oversized, { etag: '"big"' }),
            success("after", { etag: '"after"' }),
        ]);

        await client.request(request());
        await client.request(request());
        await client.request(request());

        expect(new Headers(scripted.calls[1]!.init.headers).get("if-none-match")).toBe('"small"');
        // The stale validator is gone, and the giant body was not retained.
        expect(new Headers(scripted.calls[2]!.init.headers).get("if-none-match")).toBeNull();
    });

    it("bounds the cache in bytes as well as entries", async () => {
        const body = "x".repeat(DEFAULT_ETAG_CACHE_ENTRY_BYTES);
        const fill = Math.floor(DEFAULT_ETAG_CACHE_BYTES / DEFAULT_ETAG_CACHE_ENTRY_BYTES) + 1;
        const urls = Array.from(
            { length: fill },
            (_, index) => `${GITHUB_API_ORIGIN}/repos/o/r/contents/${index}`,
        );
        const scripted = responseScript([
            ...urls.map((_, index) => success(body, { etag: `"${index}"` })),
            success("first again", { etag: '"first-2"' }),
        ]);
        const tokens = tokenSource([{ ok: true, token: token("t") }]);
        const client = createGitHubHttpClient({
            tokenSource: tokens.source,
            fetch: scripted.fetch,
            clock: () => NOW,
        });

        for (const url of urls) await client.request(request({ url }));
        await client.request(request({ url: urls[0]! }));

        // The byte bound evicted the oldest URL long before the entry bound.
        expect(fill).toBeLessThan(DEFAULT_ETAG_CACHE_ENTRIES);
        expect(new Headers(scripted.calls[fill]!.init.headers).get("if-none-match")).toBeNull();
        expect(DEFAULT_ETAG_CACHE_BYTES).toBe(20 * 1024 * 1024);
        expect(DEFAULT_ETAG_CACHE_ENTRY_BYTES).toBe(512 * 1024);
    });

    it("retains the oldest representation at the exact entry and total byte limits", async () => {
        const body = "x".repeat(DEFAULT_ETAG_CACHE_ENTRY_BYTES);
        const exactFill = DEFAULT_ETAG_CACHE_BYTES / DEFAULT_ETAG_CACHE_ENTRY_BYTES;
        const urls = Array.from(
            { length: exactFill },
            (_, index) => `${GITHUB_API_ORIGIN}/repos/o/r/contents/exact-${index}`,
        );
        const scripted = responseScript([
            ...urls.map((_, index) => success(body, { etag: `"${index}"` })),
            new Response(null, { status: 304 }),
        ]);
        const client = createGitHubHttpClient({
            tokenSource: tokenSource([{ ok: true, token: token("t") }]).source,
            fetch: scripted.fetch,
            clock: () => NOW,
        });

        for (const url of urls) await client.request(request({ url }));
        const oldest = await client.request(request({ url: urls[0]! }));

        expect(Number.isInteger(exactFill)).toBe(true);
        expect(new Headers(scripted.calls[exactFill]!.init.headers).get("if-none-match")).toBe(
            '"0"',
        );
        expect(oldest).toMatchObject({ ok: true, fromCache: true, body });
    });

    it("treats an impossible cacheless 304 as transient and still bounds the retry", async () => {
        const { client, scripted } = harness([
            new Response(null, { status: 304 }),
            new Response(null, { status: 304 }),
        ]);

        expect(await client.request(request())).toEqual({
            ok: false,
            status: 304,
            body: "",
            headers: {},
            failure: { kind: "transient" },
        });
        expect(scripted.calls).toHaveLength(2);
    });
});

describe("classification and bounded retry", () => {
    const catalogue: ReadonlyArray<{
        readonly name: string;
        readonly response: Response;
        readonly expected: FailureClass;
    }> = [
        {
            name: "permission missing",
            response: failure(403, "Resource not accessible by integration", {
                "x-accepted-github-permissions": "issues=write",
            }),
            expected: { kind: "permissionMissing", acceptedPermissions: "issues=write" },
        },
        {
            name: "installation suspended",
            response: failure(403, BODY_PATTERNS.installationSuspended.observed),
            expected: { kind: "installationSuspended" },
        },
        {
            name: "repository outside the installation",
            response: failure(404, "Not Found"),
            expected: { kind: "notFoundOrNotInstalled" },
        },
        {
            name: "secondary limit",
            response: failure(403, BODY_PATTERNS.secondaryRateLimit.observed, {
                "x-ratelimit-remaining": "4909",
            }),
            expected: { kind: "secondaryLimit" },
        },
        {
            name: "validation error",
            response: failure(422, '{"message":"Validation Failed","errors":[]}'),
            expected: { kind: "validationError" },
        },
        {
            // A 401 on a LIVE token is a wrong or revoked key — no refresh
            // can mint a better one, so it must not be retried.
            name: "bad credentials",
            response: failure(401, "Bad credentials"),
            expected: { kind: "badCredentials" },
        },
        {
            // Returns at once with the reset instant; a retry would spend
            // requests the window no longer has.
            name: "primary quota exhausted",
            response: failure(403, "API rate limit exceeded", {
                "x-ratelimit-remaining": "0",
                "x-ratelimit-reset": "1787300000",
            }),
            expected: { kind: "primaryExhausted", resetAt: "1787300000" },
        },
        {
            name: "rate-limit wait beyond the automatic ceiling",
            response: failure(429, "rate limited", { "retry-after": "7200" }),
            expected: {
                kind: "rateLimitResponseUnusable",
                headerName: "retry-after",
                headerValue: "7200",
                reason: "aboveAutomaticLimit",
            },
        },
    ];

    for (const fixture of catalogue) {
        it(`replays the ${fixture.name} catalogue row`, async () => {
            const { client, scripted } = harness([fixture.response]);
            expect(await client.request(request())).toMatchObject({
                ok: false,
                failure: fixture.expected,
            });
            expect(scripted.calls).toHaveLength(1);
        });
    }

    it("does not retry an otherwise-unclassified deterministic 4xx", async () => {
        const { client, scripted } = harness([
            failure(410, "API version retired"),
            success("must not happen"),
        ]);

        expect(await client.request(request())).toMatchObject({
            ok: false,
            status: 410,
            failure: { kind: "clientError", status: 410 },
        });
        expect(scripted.calls).toHaveLength(1);
    });

    it("uses local token age for the expired-token row, refreshes, and retries once", async () => {
        const expired = token("expired", new Date(NOW.getTime() - 1));
        const fresh = token("fresh");
        const { client, scripted, tokens } = harness(
            [failure(401, "Bad credentials"), success("fresh response")],
            [
                { ok: true, token: expired },
                { ok: true, token: fresh },
            ],
        );

        expect(await client.request(request())).toMatchObject({ ok: true, body: "fresh response" });
        expect(tokens.invalidated).toEqual([expired]);
        expect(new Headers(scripted.calls[1]!.init.headers).get("authorization")).toBe(
            "Bearer fresh",
        );
    });

    it("returns a second expired-token response instead of retrying forever", async () => {
        const first = token("expired-1", new Date(NOW.getTime() - 1));
        const second = token("expired-2", new Date(NOW.getTime() - 1));
        const { client, scripted, tokens } = harness(
            [failure(401, "Bad credentials"), failure(401, "Bad credentials")],
            [
                { ok: true, token: first },
                { ok: true, token: second },
            ],
        );

        expect(await client.request(request())).toMatchObject({
            ok: false,
            failure: { kind: "tokenExpired" },
        });
        expect(scripted.calls).toHaveLength(2);
        expect(tokens.invalidated).toEqual([first, second]);
    });

    it("contains an invalidation failure instead of reusing the rejected token", async () => {
        const expired = token("expired", new Date(NOW.getTime() - 1));
        const scripted = responseScript([failure(401, "Bad credentials"), success()]);
        const source: TokenSource = {
            current: () => Promise.resolve({ ok: true, token: expired }),
            invalidate: () => {
                throw new Error("cache failed");
            },
        };
        const client = createGitHubHttpClient({
            tokenSource: source,
            fetch: scripted.fetch,
            clock: () => NOW,
        });

        expect(await client.request(request())).toEqual({
            ok: false,
            failure: { kind: "notSent", reason: "brokenSeam" },
        });
        expect(scripted.calls).toHaveLength(1);
    });

    it("retries one transient response and one transport failure, but no more", async () => {
        const responseRetry = harness([failure(503, "down"), success("up")]);
        expect(await responseRetry.client.request(request())).toMatchObject({
            ok: true,
            body: "up",
        });
        expect(responseRetry.scripted.calls).toHaveLength(2);
        expect(responseRetry.tokens.invalidated).toEqual([]);

        const transportRetry = harness([new Error("reset"), new Error("still reset")]);
        expect(await transportRetry.client.request(request())).toEqual({
            ok: false,
            failure: { kind: "transient" },
        });
        expect(transportRetry.scripted.calls).toHaveLength(2);
        expect(transportRetry.tokens.invalidated).toEqual([]);
    });

    it("bounds retries when reading a response body fails", async () => {
        const brokenBody = () =>
            new Response(
                new ReadableStream({
                    pull(controller) {
                        controller.error(new Error("body interrupted"));
                    },
                }),
                { status: 200 },
            );
        const { client, scripted } = harness([brokenBody(), brokenBody()]);

        expect(await client.request(request())).toMatchObject({
            ok: false,
            status: 200,
            headers: {},
            failure: { kind: "transient" },
        });
        expect(scripted.calls).toHaveLength(2);
    });

    it("contains failures thrown by injected request machinery", async () => {
        const scripted = responseScript([success()]);
        const tokens = tokenSource([{ ok: true, token: token("t") }]);
        const client = createGitHubHttpClient({
            tokenSource: tokens.source,
            fetch: scripted.fetch,
            timeoutSignal: () => {
                throw new Error("bad timeout factory");
            },
        });

        expect(await client.request(request())).toEqual({
            ok: false,
            failure: { kind: "notSent", reason: "brokenSeam" },
        });
        expect(scripted.calls).toHaveLength(0);
    });

    it("never retries a secondary limit, even when retry-after is present", async () => {
        const { client, scripted } = harness([
            failure(403, BODY_PATTERNS.secondaryRateLimit.observed, { "retry-after": "60" }),
            success("must not happen"),
        ]);

        expect(await client.request(request())).toMatchObject({
            ok: false,
            failure: { kind: "secondaryLimit", retryAfterSeconds: 60 },
        });
        expect(scripted.calls).toHaveLength(1);
    });

    it("does not turn an empty retry-after header into an immediate retry", async () => {
        const { client, scripted } = harness([
            failure(429, "rate limited", { "retry-after": "" }),
            success("must not happen"),
        ]);

        expect(await client.request(request())).toMatchObject({
            ok: false,
            failure: {
                kind: "rateLimitResponseUnusable",
                headerName: "retry-after",
                headerValue: "",
                reason: "invalid",
            },
        });
        expect(scripted.calls).toHaveLength(1);
    });

    it("degrades reworded prose instead of confidently misclassifying it", async () => {
        const body = "This installation has been paused by its owner.";
        const { client } = harness([failure(403, body)]);

        expect(await client.request(request())).toMatchObject({
            ok: false,
            failure: { kind: "forbiddenUnrecognized", bodySnippet: body },
        });
    });
});

describe("rate awareness", () => {
    it("starts empty before any response arrives", () => {
        const { client } = harness([success()]);
        expect(client.latestRateLimit()).toBeNull();
    });

    it("tracks every x-ratelimit header from the latest response", async () => {
        const { client } = harness([
            failure(503, "retry", {
                "x-ratelimit-limit": "5000",
                "x-ratelimit-remaining": "4999",
                "x-ratelimit-used": "1",
                "x-ratelimit-reset": "1787300000",
                "x-ratelimit-resource": "core",
                "x-ratelimit-custom": "future-field",
            }),
            success("done", {
                "x-ratelimit-limit": "5000",
                "x-ratelimit-remaining": "4998",
                "x-ratelimit-used": "2",
                "x-ratelimit-reset": "1787300000",
                "x-ratelimit-resource": "core",
            }),
        ]);

        await client.request(request());

        expect(client.latestRateLimit()).toEqual({
            url: URL,
            status: 200,
            headers: {
                "x-ratelimit-limit": "5000",
                "x-ratelimit-remaining": "4998",
                "x-ratelimit-reset": "1787300000",
                "x-ratelimit-resource": "core",
                "x-ratelimit-used": "2",
            },
        });
    });

    it("does not replay stale rate headers from the cached 200 on a 304", async () => {
        const { client } = harness([
            success("cached", {
                etag: '"v1"',
                link: "<next>; rel=next",
                "x-ratelimit-remaining": "4999",
            }),
            new Response(null, {
                status: 304,
                headers: { "x-ratelimit-used": "1" },
            }),
        ]);

        await client.request(request());
        const cached = await client.request(request());

        expect(cached).toMatchObject({
            ok: true,
            fromCache: true,
            headers: {
                link: "<next>; rel=next",
                "x-ratelimit-used": "1",
            },
        });
        if (cached.ok) expect(cached.headers["x-ratelimit-remaining"]).toBeUndefined();
    });

    it("records a failed attempt before issuing its retry", async () => {
        const scripted = responseScript([
            failure(503, "retry", { "x-ratelimit-remaining": "41" }),
            () => {
                expect(client.latestRateLimit()).toEqual({
                    url: URL,
                    status: 503,
                    headers: { "x-ratelimit-remaining": "41" },
                });
                return success("done", { "x-ratelimit-remaining": "40" });
            },
        ]);
        const tokens = tokenSource([{ ok: true, token: token("t") }]);
        const client = createGitHubHttpClient({
            tokenSource: tokens.source,
            fetch: scripted.fetch,
            clock: () => NOW,
        });

        expect((await client.request(request())).ok).toBe(true);
    });

    it("does not expose mutable rate-limit state", async () => {
        const { client } = harness([success("done", { "x-ratelimit-remaining": "40" })]);
        await client.request(request());
        const snapshot = client.latestRateLimit()!;
        (snapshot.headers as Record<string, string>)["x-ratelimit-remaining"] = "0";

        expect(client.latestRateLimit()!.headers["x-ratelimit-remaining"]).toBe("40");
    });
});
