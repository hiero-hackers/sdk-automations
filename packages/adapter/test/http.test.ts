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
    lastPageFromLink,
    wait,
    CONTENT_CREATION_SPACING_MS,
    DEFAULT_ETAG_CACHE_BYTES,
    DEFAULT_ETAG_CACHE_ENTRIES,
    DEFAULT_ETAG_CACHE_ENTRY_BYTES,
    DEFAULT_REQUEST_TIMEOUT_MS,
    GITHUB_API_ORIGIN,
    GITHUB_API_VERSION,
    GITHUB_GRAPHQL_URL,
    MAX_RESPONSE_BODY_BYTES,
    MAX_RETRY_WAIT_MS,
    PRIMARY_BUDGET_RESERVE,
    type FetchLike,
    type GitHubHttpClient,
    type GitHubRequest,
} from "../src/http.js";
import {
    failure,
    githubRequest as request,
    httpHarness as harness,
    installationToken as token,
    responseScript,
    scriptedTokenSource as tokenSource,
    success,
    TEST_NOW as NOW,
    TEST_URL as URL,
    type ResponseStep,
} from "./harness.js";

const GRAPHQL_BODY = JSON.stringify({
    operationName: "LinkedIssues",
    query: 'query LinkedIssues { repository(owner: "o", name: "r") { id } }',
});
const GRAPHQL_TOKEN = {
    ...token("graphql-token"),
    grants: ["issues:read", "pull_requests:read"],
} as const;

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
        const signals: AbortSignal[] = [];
        const { client } = harness([new Error("socket closed"), success()], {
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

    it("posts GraphQL through the shared call path without caching its body", async () => {
        const { client, scripted } = harness(
            [
                success('{"data":{}}', { etag: '"graphql-result"' }),
                success('{"data":{}}', { etag: '"graphql-result"' }),
            ],
            { outcomes: [{ ok: true, token: GRAPHQL_TOKEN }] },
        );

        for (let call = 0; call < 2; call += 1) {
            expect(
                await client.request({
                    url: GITHUB_GRAPHQL_URL,
                    method: "POST",
                    body: GRAPHQL_BODY,
                }),
            ).toMatchObject({ ok: true, fromCache: false });
        }

        expect(scripted.calls).toHaveLength(2);
        for (const call of scripted.calls) {
            const headers = new Headers(call.init.headers);
            expect(call.url).toBe(GITHUB_GRAPHQL_URL);
            expect(call.init.method).toBe("POST");
            expect(call.init.body).toBe(GRAPHQL_BODY);
            expect(headers.get("content-type")).toBe("application/json");
            expect(headers.get("if-none-match")).toBeNull();
            expect(headers.get("authorization")).toBe("Bearer graphql-token");
        }
    });

    it("retries a read-only GraphQL query with the same body", async () => {
        const { client, scripted } = harness([new Error("socket closed"), success()], {
            outcomes: [{ ok: true, token: GRAPHQL_TOKEN }],
        });

        expect(
            await client.request({
                url: GITHUB_GRAPHQL_URL,
                method: "POST",
                body: GRAPHQL_BODY,
            }),
        ).toMatchObject({ ok: true });
        expect(scripted.calls.map((call) => call.init.body)).toEqual([GRAPHQL_BODY, GRAPHQL_BODY]);
    });

    it("checks refreshed-token grants before a GraphQL retry", async () => {
        const reduced = { ...token("reduced-token"), grants: ["issues:read"] } as const;
        const { client, scripted, tokens } = harness([new Error("socket closed"), success()], {
            outcomes: [
                { ok: true, token: GRAPHQL_TOKEN },
                { ok: true, token: reduced },
            ],
        });

        expect(
            await client.request({
                url: GITHUB_GRAPHQL_URL,
                method: "POST",
                body: GRAPHQL_BODY,
            }),
        ).toEqual({
            ok: false,
            failure: {
                kind: "permissionMissing",
                acceptedPermissions: "pull_requests:read",
            },
        });
        expect(tokens.calls()).toBe(2);
        expect(scripted.calls).toHaveLength(1);
    });

    it("checks GraphQL permissions before fetch", async () => {
        const denied = { ...token("denied-token"), grants: [] } as const;
        const { client, scripted } = harness([success()], {
            outcomes: [{ ok: true, token: denied }],
        });

        expect(
            await client.request({
                url: GITHUB_GRAPHQL_URL,
                method: "POST",
                body: GRAPHQL_BODY,
            }),
        ).toEqual({
            ok: false,
            failure: {
                kind: "permissionMissing",
                acceptedPermissions: "issues:read, pull_requests:read",
            },
        });
        expect(scripted.calls).toHaveLength(0);
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
            // Kept off the harness: the abort choreography IS this test.
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
        const { client, scripted } = harness([success()], {
            outcomes: [{ ok: false, failure: { kind: "installationSuspended" } }],
        });

        expect(await client.request(request())).toEqual({
            ok: false,
            failure: { kind: "installationSuspended" },
        });
        expect(scripted.calls).toHaveLength(0);
    });

    it("turns a token-source rejection into a typed value without calling fetch", async () => {
        const { client, scripted } = harness([success()], {
            outcomes: [new Error("broken token source")],
        });

        expect(await client.request(request())).toEqual({
            ok: false,
            failure: { kind: "notSent", reason: "brokenSeam", seam: "tokenSource" },
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
        const { client, scripted } = harness([success()], { outcomes: [outcome as never] });

        expect(await client.request(request())).toEqual({
            ok: false,
            failure: { kind: "notSent", reason: "brokenSeam", seam: "tokenSource" },
        });
        expect(scripted.calls).toHaveLength(0);
    });

    it("contains invalid caller headers without retrying or calling fetch", async () => {
        const { client, scripted, tokens } = harness([success()]);

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
        const { client, scripted, tokens } = harness([success()], {
            clock: () => {
                throw new Error("clock failed");
            },
        });

        expect(await client.request(request())).toEqual({
            ok: false,
            failure: { kind: "notSent", reason: "brokenSeam", seam: "clock" },
        });
        expect(tokens.calls()).toBe(1);
        expect(scripted.calls).toHaveLength(0);
    });

    it("contains an invalid token value as a broken seam before fetch", async () => {
        const { client, scripted, tokens } = harness([success()], {
            outcomes: [{ ok: true, token: token("line one\nline two") }],
        });

        expect(await client.request(request())).toEqual({
            ok: false,
            failure: { kind: "notSent", reason: "brokenSeam", seam: "tokenValue" },
        });
        expect(tokens.calls()).toBe(1);
        expect(scripted.calls).toHaveLength(0);
    });

    it("contains an invalid injected response shape as a broken seam", async () => {
        const { client, scripted } = harness([
            () =>
                Object.defineProperty({}, "headers", {
                    get: () => {
                        throw new Error("invalid response seam");
                    },
                }) as Response,
        ]);

        expect(await client.request(request())).toEqual({
            ok: false,
            failure: { kind: "notSent", reason: "brokenSeam", seam: "response" },
        });
        expect(scripted.calls).toHaveLength(1);
    });

    it("rejects cleartext and non-GitHub URLs before acquiring a token", async () => {
        const { client, scripted, tokens } = harness([success()]);

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
        const { client, scripted, tokens } = harness([success()]);
        const mutation = { url: URL, method: "DELETE" } as unknown as GitHubRequest;

        expect(await client.request(mutation)).toEqual({
            ok: false,
            failure: { kind: "notSent", reason: "disallowedMethod" },
        });
        expect(tokens.calls()).toBe(0);
        expect(scripted.calls).toHaveLength(0);
    });

    it("rejects POST outside GraphQL, malformed bodies, and mutations", async () => {
        const { client, scripted, tokens } = harness([success()]);
        const restPost = { url: URL, method: "POST", body: "{}" } as GitHubRequest;
        const invalidBodies: readonly unknown[] = [
            null,
            "{",
            JSON.stringify({ query: "query LinkedIssues { viewer { login } }" }),
            JSON.stringify({ operationName: "LinkedIssues", query: 42 }),
            JSON.stringify({
                operationName: "LinkedIssues",
                query: "prefix query LinkedIssues { viewer { login } }",
            }),
            JSON.stringify({
                operationName: "LinkedIssues",
                query: "mutation LinkedIssues { deleteIssue(input: {}) { clientMutationId } }",
            }),
        ];

        expect(await client.request(restPost)).toEqual({
            ok: false,
            failure: { kind: "notSent", reason: "disallowedMethod" },
        });
        for (const body of invalidBodies) {
            const request = { url: GITHUB_GRAPHQL_URL, method: "POST", body } as GitHubRequest;
            expect(await client.request(request)).toEqual({
                ok: false,
                failure: { kind: "notSent", reason: "invalidBody" },
            });
        }
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

    it("derives one variant regardless of header casing and order", async () => {
        // A quiet failure mode: a normalization change that splits the cache
        // raises rate usage on unchanged reads without failing anything.
        const { client, scripted } = harness([
            success("ranged", { etag: '"range"' }),
            new Response(null, { status: 304 }),
        ]);

        await client.request(request({ headers: { "X-Custom": "1", Range: "bytes=0-99" } }));
        const cached = await client.request(
            request({ headers: { range: "bytes=0-99", "x-custom": "1" } }),
        );

        expect(new Headers(scripted.calls[1]!.init.headers).get("if-none-match")).toBe('"range"');
        expect(cached).toMatchObject({ ok: true, fromCache: true, body: "ranged" });
    });

    it("normalizes the URL, so a spelled-out default port shares the entry", async () => {
        const { client, scripted } = harness([
            success("issue", { etag: '"v1"' }),
            new Response(null, { status: 304 }),
        ]);

        await client.request(request({ url: "https://api.github.com:443/repos/o/r/issues/1" }));
        const cached = await client.request(
            request({ url: "https://api.github.com/repos/o/r/issues/1" }),
        );

        expect(scripted.calls[0]!.url).toBe("https://api.github.com/repos/o/r/issues/1");
        expect(new Headers(scripted.calls[1]!.init.headers).get("if-none-match")).toBe('"v1"');
        expect(cached).toMatchObject({ ok: true, fromCache: true, body: "issue" });
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
        const { client, scripted } = harness([
            ...urls.map((_, index) => success(String(index + 1), { etag: `"${index + 1}"` })),
            new Response(null, { status: 304 }),
            success("overflow", { etag: '"overflow"' }),
            success("second again", { etag: '"second-2"' }),
        ]);

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
        const { client, scripted } = harness([
            ...urls.map((_, index) => success(body, { etag: `"${index}"` })),
            success("first again", { etag: '"first-2"' }),
        ]);

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
        const { client, scripted } = harness([
            ...urls.map((_, index) => success(body, { etag: `"${index}"` })),
            new Response(null, { status: 304 }),
        ]);

        for (const url of urls) await client.request(request({ url }));
        const oldest = await client.request(request({ url: urls[0]! }));

        expect(Number.isInteger(exactFill)).toBe(true);
        expect(new Headers(scripted.calls[exactFill]!.init.headers).get("if-none-match")).toBe(
            '"0"',
        );
        expect(oldest).toMatchObject({ ok: true, fromCache: true, body });
    });

    it("keeps the cache and rate snapshot coherent across overlapping requests", async () => {
        const deferred: Array<(response: Response) => void> = [];
        const calls: Array<{ readonly url: string; readonly init: RequestInit }> = [];
        const fetch: FetchLike = (input, init) => {
            calls.push({ url: String(input), init: init ?? {} });
            return new Promise((resolve) => deferred.push(resolve));
        };
        const client = createGitHubHttpClient({
            tokenSource: tokenSource([{ ok: true, token: token("t") }]).source,
            fetch,
            clock: () => NOW,
            timeoutSignal: () => new AbortController().signal,
        });
        const settle = () => new Promise((resolve) => setTimeout(resolve));

        const first = client.request(request());
        const second = client.request(request());
        await settle();

        // Both miss the cache; neither claims the other's in-flight validator.
        expect(calls).toHaveLength(2);
        expect(new Headers(calls[0]!.init.headers).get("if-none-match")).toBeNull();
        expect(new Headers(calls[1]!.init.headers).get("if-none-match")).toBeNull();

        // Completion out of order: the later start resolves first.
        deferred[1]!(success("second", { etag: '"second"', "x-ratelimit-used": "2" }));
        expect(await second).toMatchObject({ ok: true, body: "second", fromCache: false });
        deferred[0]!(success("first", { etag: '"first"', "x-ratelimit-used": "1" }));
        expect(await first).toMatchObject({ ok: true, body: "first", fromCache: false });

        // The last response to ARRIVE owns both the entry and the snapshot.
        expect(client.latestRateLimit()).toMatchObject({
            headers: { "x-ratelimit-used": "1" },
        });
        const third = client.request(request());
        await settle();
        expect(calls).toHaveLength(3);
        expect(new Headers(calls[2]!.init.headers).get("if-none-match")).toBe('"first"');
        deferred[2]!(new Response(null, { status: 304 }));
        expect(await third).toMatchObject({ ok: true, fromCache: true, body: "first" });
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
    /**
     * Deliberately overlaps core's own classification suite: these rows
     * prove the WIRING — a real response, through the real client, lands on
     * the expected catalogue row — not the classification logic itself.
     */
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
            // The reset is an hour out, far past the in-request wait ceiling,
            // so this returns at once with the instant an operator needs.
            name: "primary quota exhausted",
            response: failure(403, "API rate limit exceeded", {
                "x-ratelimit-remaining": "0",
                "x-ratelimit-reset": "1787310000",
            }),
            expected: { kind: "primaryExhausted", resetAt: "1787310000" },
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
            {
                outcomes: [
                    { ok: true, token: expired },
                    { ok: true, token: fresh },
                ],
            },
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
            {
                outcomes: [
                    { ok: true, token: first },
                    { ok: true, token: second },
                ],
            },
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
        const { client, scripted } = harness([failure(401, "Bad credentials"), success()], {
            outcomes: [{ ok: true, token: expired }],
            onInvalidate: () => {
                throw new Error("cache failed");
            },
        });

        expect(await client.request(request())).toEqual({
            ok: false,
            failure: { kind: "notSent", reason: "brokenSeam", seam: "invalidate" },
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
        const { client, scripted } = harness([success()], {
            timeoutSignal: () => {
                throw new Error("bad timeout factory");
            },
        });

        expect(await client.request(request())).toEqual({
            ok: false,
            failure: { kind: "notSent", reason: "brokenSeam", seam: "timeoutSignal" },
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

/** The epoch second the fixed test clock reads, the grammar GitHub resets in. */
const NOW_SECONDS = Math.floor(NOW.getTime() / 1000);

/** A primary-exhaustion response whose budget resets `seconds` from the clock. */
const exhausted = (seconds: number): Response =>
    failure(403, "API rate limit exceeded", {
        "x-ratelimit-remaining": "0",
        "x-ratelimit-reset": String(NOW_SECONDS + seconds),
    });

/**
 * What the client does with core's retry advice, which it used to discard.
 *
 * Every pause is recorded rather than taken, so an assertion here is the exact
 * instant the client would have waited to (D20).
 */
describe("waiting between attempts", () => {
    it("waits core's backoff before retrying weather", async () => {
        const { client, scripted, sleeps } = harness([failure(503, "down"), success("up")]);

        expect(await client.request(request())).toMatchObject({ ok: true, body: "up" });
        expect(sleeps).toEqual([500]);
        expect(scripted.calls).toHaveLength(2);
    });

    it("spreads a backoff we chose by a clock-derived amount", async () => {
        // 500 ms of advice, a quarter of it available to spread, and a clock
        // 73 ms off a round second: the same failure at a different instant
        // waits a different length, with no random source involved.
        const at = new Date(NOW.getTime() + 73);
        const { client, sleeps } = harness([failure(503, "down"), success("up")], {
            clock: () => at,
        });

        expect((await client.request(request())).ok).toBe(true);
        expect(sleeps).toEqual([573]);
    });

    it("waits an instant GitHub dictated exactly, and up to core's rate bound", async () => {
        const at = new Date(NOW.getTime() + 73);
        const { client, scripted, sleeps } = harness([() => exhausted(10)], { clock: () => at });

        expect(await client.request(request())).toMatchObject({
            ok: false,
            failure: { kind: "primaryExhausted" },
        });
        expect(sleeps).toEqual([10_000, 10_000]);
        expect(scripted.calls).toHaveLength(3);
    });

    it("bounds weather at two sends, whatever core's backoff list allows", async () => {
        const { client, scripted, sleeps } = harness([() => failure(503, "down")]);

        expect(await client.request(request())).toMatchObject({
            ok: false,
            failure: { kind: "transient" },
        });
        expect(scripted.calls).toHaveLength(2);
        expect(sleeps).toEqual([500]);
    });

    it("stops at the ceiling rather than starting a wait it cannot finish", async () => {
        const { client, scripted, sleeps } = harness([() => exhausted(20)]);

        expect(await client.request(request())).toMatchObject({
            ok: false,
            failure: { kind: "primaryExhausted" },
        });
        expect(sleeps).toEqual([20_000]);
        expect(sleeps.reduce((total, ms) => total + ms, 20_000)).toBeGreaterThan(MAX_RETRY_WAIT_MS);
        expect(scripted.calls).toHaveLength(2);
    });

    it("returns a wait that breaches the ceiling outright, having slept none of it", async () => {
        const { client, scripted, sleeps } = harness([exhausted(31)]);

        expect(await client.request(request())).toEqual({
            ok: false,
            status: 403,
            body: "API rate limit exceeded",
            headers: {
                "content-type": "text/plain;charset=UTF-8",
                "x-ratelimit-remaining": "0",
                "x-ratelimit-reset": String(NOW_SECONDS + 31),
            },
            failure: { kind: "primaryExhausted", resetAt: String(NOW_SECONDS + 31) },
        });
        expect(sleeps).toEqual([]);
        expect(scripted.calls).toHaveLength(1);
    });

    it("never sleeps on a secondary limit: core's floor is past the ceiling", async () => {
        const { client, scripted, sleeps } = harness([
            failure(403, BODY_PATTERNS.secondaryRateLimit.observed, { "retry-after": "5" }),
        ]);

        expect(await client.request(request())).toMatchObject({
            ok: false,
            failure: { kind: "secondaryLimit", retryAfterSeconds: 5 },
        });
        expect(sleeps).toEqual([]);
        expect(scripted.calls).toHaveLength(1);
    });

    it("never sleeps when nothing failed", async () => {
        const { client, sleeps } = harness([success()]);

        expect((await client.request(request())).ok).toBe(true);
        expect(sleeps).toEqual([]);
    });

    it("refreshes a rejected token without pausing first", async () => {
        const expired = token("expired", new Date(NOW.getTime() - 1));
        const { client, sleeps } = harness([failure(401, "Bad credentials"), success("fresh")], {
            outcomes: [
                { ok: true, token: expired },
                { ok: true, token: token("fresh") },
            ],
        });

        expect(await client.request(request())).toMatchObject({ ok: true, body: "fresh" });
        expect(sleeps).toEqual([]);
    });

    it("contains a sleep seam that rejects", async () => {
        const { client, scripted } = harness([failure(503, "down"), success("must not happen")], {
            sleep: () => Promise.reject(new Error("the timer is gone")),
        });

        expect(await client.request(request())).toEqual({
            ok: false,
            failure: { kind: "notSent", reason: "brokenSeam", seam: "sleep" },
        });
        expect(scripted.calls).toHaveLength(1);
    });

    it("contains a clock that breaks after the send", async () => {
        let reads = 0;
        const { client } = harness([failure(503, "down"), success("must not happen")], {
            clock: () => {
                reads += 1;
                if (reads > 1) throw new Error("the clock is gone");
                return NOW;
            },
        });

        expect(await client.request(request())).toEqual({
            ok: false,
            failure: { kind: "notSent", reason: "brokenSeam", seam: "clock" },
        });
    });

    it("pauses on the production timer by default", async () => {
        // A reset already reached advises a zero wait, so the real timer runs
        // without the suite waiting on anything.
        const scripted = responseScript([exhausted(0), success("after the reset")]);
        const client = createGitHubHttpClient({
            tokenSource: tokenSource([{ ok: true, token: token("t") }]).source,
            fetch: scripted.fetch,
            clock: () => NOW,
        });

        expect(await client.request(request())).toMatchObject({
            ok: true,
            body: "after the reset",
        });
        expect(scripted.calls).toHaveLength(2);
    });

    it("resolves the production pause only after the time has passed", async () => {
        const started = Date.now();
        await wait(20);

        expect(Date.now() - started).toBeGreaterThanOrEqual(15);
    });
});

describe("bounded body reads", () => {
    /** A response whose body arrives as `chunks` separate blocks of `size` bytes. */
    const streamed = (chunks: number, size: number): Response =>
        new Response(
            new ReadableStream({
                start(controller) {
                    for (let sent = 0; sent < chunks; sent += 1) {
                        controller.enqueue(new Uint8Array(size).fill(0x61));
                    }
                    controller.close();
                },
            }),
            { status: 200 },
        );

    it("reads a body that stops exactly at the bound", async () => {
        const { client } = harness([streamed(4, MAX_RESPONSE_BODY_BYTES / 4)]);

        const outcome = await client.request(request());
        expect(outcome.ok).toBe(true);
        if (outcome.ok) expect(outcome.body.length).toBe(MAX_RESPONSE_BODY_BYTES);
    });

    it("abandons a body one byte past the bound, and does not read it again", async () => {
        const { client, scripted, sleeps } = harness([
            () => streamed(1, MAX_RESPONSE_BODY_BYTES + 1),
        ]);

        expect(await client.request(request())).toMatchObject({
            ok: false,
            status: 200,
            failure: { kind: "responseTooLarge", limitBytes: MAX_RESPONSE_BODY_BYTES },
        });
        expect(scripted.calls).toHaveLength(1);
        expect(sleeps).toEqual([]);
    });

    it("decodes a character split across two chunks", async () => {
        const bytes = new TextEncoder().encode("héllo");
        const { client } = harness([
            new Response(
                new ReadableStream({
                    start(controller) {
                        controller.enqueue(bytes.slice(0, 2));
                        controller.enqueue(bytes.slice(2));
                        controller.close();
                    },
                }),
                { status: 200 },
            ),
        ]);

        expect(await client.request(request())).toMatchObject({ ok: true, body: "héllo" });
    });

    it("reads a bodyless response as empty text", async () => {
        const { client } = harness([new Response(null, { status: 204 })]);

        expect(await client.request(request())).toMatchObject({
            ok: true,
            status: 204,
            body: "",
        });
    });
});

/**
 * The rate snapshot's one consumer: a budget under the reserve is treated as
 * the exhaustion it is about to become, before a request spends any of it.
 */
describe("proactive pacing", () => {
    const spent = (remaining: string, resetSeconds: number): Response =>
        success("first", {
            "x-ratelimit-remaining": remaining,
            "x-ratelimit-reset": String(NOW_SECONDS + resetSeconds),
        });

    it("waits out a reset within reach before spending the reserve", async () => {
        const { client, scripted, sleeps } = harness([spent("49", 5), success("second")]);

        expect((await client.request(request())).ok).toBe(true);
        expect(await client.request(request())).toMatchObject({ ok: true, body: "second" });
        expect(sleeps).toEqual([5_000]);
        expect(scripted.calls).toHaveLength(2);
    });

    it("refuses to spend the reserve when the reset is out of reach", async () => {
        const { client, scripted, sleeps } = harness([
            spent("49", 600),
            success("must not happen"),
        ]);

        expect((await client.request(request())).ok).toBe(true);
        expect(await client.request(request())).toEqual({
            ok: false,
            failure: { kind: "primaryExhausted", resetAt: String(NOW_SECONDS + 600) },
        });
        expect(scripted.calls).toHaveLength(1);
        expect(sleeps).toEqual([]);
    });

    it("spends the budget while the reserve is still intact", async () => {
        const { client, scripted } = harness([
            spent(String(PRIMARY_BUDGET_RESERVE), 600),
            success("second"),
        ]);

        await client.request(request());
        expect(await client.request(request())).toMatchObject({ ok: true, body: "second" });
        expect(scripted.calls).toHaveLength(2);
    });

    it("does not pace on a count it could never recover from", async () => {
        const noReset = harness([
            success("first", { "x-ratelimit-remaining": "1" }),
            success("second"),
        ]);
        await noReset.client.request(request());
        expect(await noReset.client.request(request())).toMatchObject({
            ok: true,
            body: "second",
        });

        const unreadable = harness([spent("", 600), success("second")]);
        await unreadable.client.request(request());
        expect(await unreadable.client.request(request())).toMatchObject({
            ok: true,
            body: "second",
        });
    });

    it("paces once per request, not again before each retry", async () => {
        const { client, scripted, sleeps } = harness([
            spent("1", 5),
            failure(503, "down", {
                "x-ratelimit-remaining": "1",
                "x-ratelimit-reset": String(NOW_SECONDS + 5),
            }),
            success("done"),
        ]);

        expect((await client.request(request())).ok).toBe(true);
        expect(await client.request(request())).toMatchObject({ ok: true, body: "done" });
        expect(sleeps).toEqual([5_000, 500]);
        expect(scripted.calls).toHaveLength(3);
    });

    it("names the clock seam when it breaks while pacing", async () => {
        let reads = 0;
        const { client, scripted } = harness([spent("1", 5), success("second")], {
            clock: () => {
                reads += 1;
                if (reads > 1) throw new Error("the clock is gone");
                return NOW;
            },
        });
        await client.request(request());

        expect(await client.request(request())).toEqual({
            ok: false,
            failure: { kind: "notSent", reason: "brokenSeam", seam: "clock" },
        });
        expect(scripted.calls).toHaveLength(1);
    });

    it("names the sleep seam when the pacing pause breaks", async () => {
        const { client, scripted } = harness([spent("1", 5), success("second")], {
            sleep: () => Promise.reject(new Error("the timer is gone")),
        });
        await client.request(request());

        expect(await client.request(request())).toEqual({
            ok: false,
            failure: { kind: "notSent", reason: "brokenSeam", seam: "sleep" },
        });
        expect(scripted.calls).toHaveLength(1);
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
        const client = createGitHubHttpClient({
            tokenSource: tokenSource([{ ok: true, token: token("t") }]).source,
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

describe("lastPageFromLink, held directly", () => {
    it("reads a multi-digit last page with parameters after it", () => {
        expect(
            lastPageFromLink('<https://api.github.com/x?page=12&per_page=100>; rel="last"'),
        ).toBe(12);
    });

    it("tolerates a missing space before rel", () => {
        expect(lastPageFromLink('<https://api.github.com/x?page=3>;rel="last"')).toBe(3);
    });

    it.each([
        ["no header", undefined],
        ["no rel=last", '<https://api.github.com/x?page=2>; rel="next"'],
    ])("answers null for %s", (_label, link) => {
        expect(lastPageFromLink(link)).toBeNull();
    });
});

// ─── The write path ──────────────────────────────────────────────────

const ISSUE = `${GITHUB_API_ORIGIN}/repos/hiero-hackers/sdk-automations/issues/132`;
const REPO = `${GITHUB_API_ORIGIN}/repos/hiero-hackers/sdk-automations`;

const addLabel: GitHubRequest = {
    url: `${ISSUE}/labels`,
    method: "POST",
    body: JSON.stringify({ labels: ["status: stale"] }),
    idempotency: "idempotent",
};
const removeLabel: GitHubRequest = {
    url: `${ISSUE}/labels/status%3A%20stale`,
    method: "DELETE",
    idempotency: "idempotent",
};
const createComment: GitHubRequest = {
    url: `${ISSUE}/comments`,
    method: "POST",
    body: JSON.stringify({ body: "hello" }),
    idempotency: "nonIdempotent",
};
const updateComment: GitHubRequest = {
    url: `${REPO}/issues/comments/7788`,
    method: "PATCH",
    body: JSON.stringify({ body: "hello again" }),
    idempotency: "idempotent",
};

/** A refusal's reason, for the many shapes the gate must reject. */
function refusalOf(outcome: Awaited<ReturnType<GitHubHttpClient["request"]>>): string {
    if (outcome.ok) return "admitted";
    const failure = outcome.failure;
    return failure.kind === "notSent" ? failure.reason : failure.kind;
}

describe("the write gate", () => {
    it.each([
        ["add label", addLabel, "POST", `${ISSUE}/labels`],
        ["remove label", removeLabel, "DELETE", `${ISSUE}/labels/status%3A%20stale`],
        ["create comment", createComment, "POST", `${ISSUE}/comments`],
        ["update comment", updateComment, "PATCH", `${REPO}/issues/comments/7788`],
    ])("admits %s with its exact method, url and body", async (_label, write, method, url) => {
        const { client, scripted } = harness([success("{}")]);

        const outcome = await client.request(write);

        expect(outcome.ok).toBe(true);
        expect(scripted.calls).toHaveLength(1);
        expect(scripted.calls[0]!.url).toBe(url);
        expect(scripted.calls[0]!.init.method).toBe(method);
        expect(scripted.calls[0]!.init.redirect).toBe("manual");
        expect(scripted.calls[0]!.init.body).toBe("body" in write ? write.body : undefined);
    });

    it("declares a content type only where a body exists", async () => {
        const withBody = harness([success("{}")]);
        await withBody.client.request(addLabel);
        const noBody = harness([success("{}")]);
        await noBody.client.request(removeLabel);

        expect(new Headers(withBody.scripted.calls[0]!.init.headers).get("content-type")).toBe(
            "application/json",
        );
        expect(new Headers(noBody.scripted.calls[0]!.init.headers).get("content-type")).toBeNull();
        expect("body" in noBody.scripted.calls[0]!.init).toBe(false);
    });

    it.each([
        // A shape that is not one of the four, however plausible.
        ["remove every label", { url: `${ISSUE}/labels`, method: "DELETE" }],
        ["add a label by PATCH", { url: `${ISSUE}/labels`, method: "PATCH" }],
        ["comment by DELETE", { url: `${ISSUE}/comments`, method: "DELETE" }],
        ["patch an issue", { url: ISSUE, method: "PATCH" }],
        ["patch a repository comment list", { url: `${REPO}/issues/comments`, method: "PATCH" }],
        ["post to the issues collection", { url: `${REPO}/issues`, method: "POST" }],
        ["post to the item itself", { url: ISSUE, method: "POST" }],
        [
            "create a label under an id path",
            { url: `${REPO}/issues/comments/7/labels`, method: "POST" },
        ],
        ["assign a reviewer", { url: `${ISSUE}/assignees`, method: "POST" }],
        ["write outside /repos", { url: `${GITHUB_API_ORIGIN}/user/repos`, method: "POST" }],
        ["write at the GraphQL endpoint", { url: GITHUB_GRAPHQL_URL, method: "POST" }],
        ["a pull-request review", { url: `${REPO}/pulls/9/reviews`, method: "POST" }],
        // A shape that is right but spelled wrong.
        ["a query string", { url: `${ISSUE}/labels?force=1`, method: "POST" }],
        ["a fragment", { url: `${ISSUE}/labels#x`, method: "POST" }],
        ["a non-numeric item", { url: `${REPO}/issues/x/labels`, method: "POST" }],
        ["a zero-padded item", { url: `${REPO}/issues/007/labels`, method: "POST" }],
        ["a negative comment id", { url: `${REPO}/issues/comments/-7`, method: "PATCH" }],
        // Not the encoding `repoPath` writes: lower-case hex, and a byte
        // sequence no decoder can read.
        [
            "a non-canonical owner",
            { url: `${GITHUB_API_ORIGIN}/repos/a%2fb/r/issues/1/labels`, method: "POST" },
        ],
        ["an undecodable label name", { url: `${ISSUE}/labels/%zz`, method: "DELETE" }],
        ["an empty label name", { url: `${ISSUE}/labels/`, method: "DELETE" }],
        ["a nested label name", { url: `${ISSUE}/labels/a/b`, method: "DELETE" }],
    ])("refuses %s", async (_label, shape) => {
        const { client, scripted } = harness([success("{}")]);

        const outcome = await client.request({
            ...shape,
            method: shape.method as "POST" | "DELETE" | "PATCH",
            body: shape.method === "DELETE" ? undefined : "{}",
            idempotency: "idempotent",
        } as GitHubRequest);

        expect(refusalOf(outcome)).toBe("disallowedMethod");
        expect(scripted.calls).toHaveLength(0);
    });

    it("refuses a write to another origin before anything else", async () => {
        const { client, scripted } = harness([success("{}")]);

        const outcome = await client.request({
            url: "https://evil.example/repos/o/r/issues/1/labels",
            method: "POST",
            body: "{}",
            idempotency: "idempotent",
        });

        expect(refusalOf(outcome)).toBe("disallowedOrigin");
        expect(scripted.calls).toHaveLength(0);
    });

    it.each([
        ["a body where none belongs", { ...removeLabel, body: "{}" }],
        ["a missing body", { url: `${ISSUE}/labels`, method: "POST", idempotency: "idempotent" }],
        ["a body that is not JSON", { ...addLabel, body: "not json" }],
        ["a body that is a JSON array", { ...addLabel, body: "[1]" }],
        ["a body that is not a string at all", { ...addLabel, body: 12 }],
        ["an unknown idempotency", { ...addLabel, idempotency: "maybe" }],
    ])("refuses %s", async (_label, shape) => {
        const { client, scripted } = harness([success("{}")]);

        const outcome = await client.request(shape as GitHubRequest);

        expect(refusalOf(outcome)).toBe("invalidBody");
        expect(scripted.calls).toHaveLength(0);
    });

    it("still refuses a DELETE that declares no idempotency", async () => {
        const { client, scripted } = harness([success("{}")]);

        const outcome = await client.request({
            url: `${ISSUE}/labels/stale`,
            method: "DELETE",
        } as unknown as GitHubRequest);

        expect(refusalOf(outcome)).toBe("disallowedMethod");
        expect(scripted.calls).toHaveLength(0);
    });
});

describe("the write grant precheck", () => {
    it("refuses a write the installation cannot make, without sending", async () => {
        const { client, scripted } = harness([success("{}")], {
            outcomes: [{ ok: true, token: { ...token("read-only"), grants: ["issues:read"] } }],
        });

        const outcome = await client.request(addLabel);

        expect(outcome.ok).toBe(false);
        expect(outcome.ok ? null : outcome.failure).toEqual({
            kind: "permissionMissing",
            acceptedPermissions: "issues:write",
        });
        expect(scripted.calls).toHaveLength(0);
    });

    it("sends a write when the installation holds issues:write", async () => {
        const { client, scripted } = harness([success("{}")], {
            outcomes: [{ ok: true, token: { ...token("writer"), grants: ["issues:write"] } }],
        });

        expect((await client.request(addLabel)).ok).toBe(true);
        expect(scripted.calls).toHaveLength(1);
    });

    it("leaves the GraphQL read's own two-grant precheck alone", async () => {
        const { client, scripted } = harness([success("{}")], {
            outcomes: [{ ok: true, token: { ...token("g"), grants: ["issues:write"] } }],
        });

        const outcome = await client.request({
            url: GITHUB_GRAPHQL_URL,
            method: "POST",
            body: GRAPHQL_BODY,
        });

        expect(outcome.ok ? null : outcome.failure).toEqual({
            kind: "permissionMissing",
            acceptedPermissions: "pull_requests:read",
        });
        expect(scripted.calls).toHaveLength(0);
    });
});

describe("idempotency and in-client retries", () => {
    const FAILURES: ReadonlyArray<readonly [string, ResponseStep]> = [
        ["a dropped connection", new Error("socket hang up")],
        ["a 500", failure(500, "boom")],
        ["a 401 on a live token", failure(401, "Bad credentials")],
        [
            "a secondary limit",
            failure(403, "You have exceeded a secondary rate limit", {
                "x-ratelimit-remaining": "4909",
            }),
        ],
        [
            "a primary exhaustion",
            failure(403, "no", {
                "x-ratelimit-remaining": "0",
                "x-ratelimit-reset": String(Math.floor(NOW.getTime() / 1000) + 1),
            }),
        ],
    ];

    it.each(FAILURES)("sends a non-idempotent write exactly once on %s", async (_label, step) => {
        const { client, scripted, sleeps } = harness([step]);

        const outcome = await client.request(createComment);

        expect(outcome.ok).toBe(false);
        expect(scripted.calls).toHaveLength(1);
        expect(sleeps).toEqual([]);
    });

    it("still drops a rejected token for a non-idempotent write", async () => {
        const expired = { ...token("stale"), expiresAt: new Date(NOW.getTime() - 1) };
        const { client, tokens, scripted } = harness([failure(401, "Bad credentials")], {
            outcomes: [{ ok: true, token: expired }],
        });

        const outcome = await client.request(createComment);

        expect(outcome.ok ? null : outcome.failure).toEqual({ kind: "tokenExpired" });
        expect(tokens.invalidated).toHaveLength(1);
        expect(scripted.calls).toHaveLength(1);
    });

    it("retries an idempotent write like a read", async () => {
        const { client, scripted, sleeps } = harness([new Error("socket hang up")]);

        const outcome = await client.request(addLabel);

        expect(outcome.ok).toBe(false);
        expect(scripted.calls).toHaveLength(2);
        expect(sleeps).toHaveLength(1);
    });

    it("still paces a non-idempotent write before its first send", async () => {
        // Pacing is not a retry: it happens before anything is sent, so it
        // cannot duplicate an effect, and the zero-retry rule leaves it alone.
        const spent = success("read", {
            "x-ratelimit-remaining": "1",
            "x-ratelimit-reset": String(Math.floor(NOW.getTime() / 1000) + 2),
        });
        const { client, scripted, sleeps } = harness([spent, () => success("{}")]);
        await client.request(request());

        const outcome = await client.request(createComment);

        expect(outcome.ok).toBe(true);
        expect(sleeps).toEqual([2_000]);
        expect(scripted.calls).toHaveLength(2);
    });
});

describe("cache hygiene around a write", () => {
    const LIST = `${ISSUE}/comments?per_page=100&page=1`;
    const listed = (): ResponseStep =>
        success('[{"id":1}]', { etag: '"v1"', "content-type": "application/json" });
    /** A conditional read that reuses the validator, so a 304 proves the entry survived. */
    const conditional = (url: string, init: RequestInit): Response =>
        new Headers(init.headers).get("if-none-match") === '"v1"'
            ? new Response(null, { status: 304 })
            : success("[]", { etag: '"v2"' });

    it("drops the validators a landed write staled", async () => {
        const { client, scripted } = harness([listed(), success("{}"), conditional]);
        await client.request({ url: LIST, method: "GET" });

        await client.request(createComment);
        const reread = await client.request({ url: LIST, method: "GET" });

        expect(new Headers(scripted.calls[2]!.init.headers).get("if-none-match")).toBeNull();
        expect(reread.ok && reread.fromCache).toBe(false);
    });

    it("drops them for an outcome that may have landed but did not succeed", async () => {
        const { client, scripted } = harness([listed(), failure(500, "boom"), conditional]);
        await client.request({ url: LIST, method: "GET" });

        await client.request(createComment);
        await client.request({ url: LIST, method: "GET" });

        expect(new Headers(scripted.calls[2]!.init.headers).get("if-none-match")).toBeNull();
    });

    it("keeps them when the write was refused locally", async () => {
        const { client, scripted } = harness([listed(), conditional]);
        await client.request({ url: LIST, method: "GET" });

        const refusal = await client.request({ ...createComment, url: `${ISSUE}/comments?x=1` });
        const reread = await client.request({ url: LIST, method: "GET" });

        expect(refusalOf(refusal)).toBe("disallowedMethod");
        expect(new Headers(scripted.calls[1]!.init.headers).get("if-none-match")).toBe('"v1"');
        expect(reread.ok && reread.fromCache).toBe(true);
    });

    it("leaves a resource the write did not touch alone", async () => {
        const other = `${REPO}/issues/999/comments?per_page=100&page=1`;
        const { client, scripted } = harness([listed(), success("{}"), conditional]);
        await client.request({ url: other, method: "GET" });

        await client.request(createComment);
        await client.request({ url: other, method: "GET" });

        expect(new Headers(scripted.calls[2]!.init.headers).get("if-none-match")).toBe('"v1"');
    });
});

describe("content-creation pacing", () => {
    it("spaces a second comment creation and leaves other writes alone", async () => {
        const { client, sleeps } = harness([() => success("{}")]);

        await client.request(createComment);
        await client.request(addLabel);
        await client.request(createComment);

        expect(sleeps).toEqual([CONTENT_CREATION_SPACING_MS]);
    });

    it.each([
        ["the clock breaks before the first send", 0, "clock"],
        ["the clock breaks after the pause", 1, "clock"],
    ])("names the seam when %s", async (_label, goodReads, seam) => {
        let reads = 0;
        const { client, scripted } = harness([() => success("{}")], {
            clock: () => {
                reads += 1;
                if (reads > goodReads) throw new Error("clock");
                return NOW;
            },
        });

        const outcome = await client.request(createComment);

        expect(outcome.ok ? null : outcome.failure).toEqual({
            kind: "notSent",
            reason: "brokenSeam",
            seam,
        });
        expect(scripted.calls).toHaveLength(0);
    });

    it("names the sleep seam when the spacing pause breaks", async () => {
        const { client, scripted } = harness([() => success("{}")], {
            sleep: () => Promise.reject(new Error("sleep")),
        });
        await client.request(createComment);

        const outcome = await client.request(createComment);

        expect(outcome.ok ? null : outcome.failure).toEqual({
            kind: "notSent",
            reason: "brokenSeam",
            seam: "sleep",
        });
        expect(scripted.calls).toHaveLength(1);
    });

    it("holds the lane until a creation finishes, so two never overlap", async () => {
        const events: string[] = [];
        let release: (() => void) | undefined;
        const held = new Promise<void>((resolve) => {
            release = resolve;
        });
        const fetchLike: FetchLike = async () => {
            const index = events.filter((event) => event.startsWith("start")).length;
            events.push(`start${String(index)}`);
            if (index === 0) await held;
            events.push(`end${String(index)}`);
            return success("{}");
        };
        const client = createGitHubHttpClient({
            tokenSource: tokenSource([{ ok: true, token: token("t") }]).source,
            fetch: fetchLike,
            clock: () => NOW,
            sleep: () => Promise.resolve(),
        });

        const both = Promise.all([client.request(createComment), client.request(createComment)]);
        // Every microtask the second creation could have used to start.
        for (let flush = 0; flush < 20; flush += 1) await Promise.resolve();
        release!();
        const outcomes = await both;

        expect(events).toEqual(["start0", "end0", "start1", "end1"]);
        expect(outcomes.every((outcome) => outcome.ok)).toBe(true);
    });
});
