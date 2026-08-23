/**
 * Fixtures below are the ACTUAL bodies and headers observed in the
 * stage-three runs (evidence logs, 2026-07-23) — the classifier is
 * tested against what GitHub really sent, not paraphrases.
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
    BODY_PATTERNS,
    classifyFailure,
    retryAdvice,
    MAX_RATE_LIMIT_ATTEMPTS,
    MAX_TOKEN_REFRESH_ATTEMPTS,
    type FailureClass,
} from "../../src/github/failures.js";
import { MAX_AUTOMATIC_RATE_LIMIT_WAIT_SECONDS } from "../../src/github/rate-limits.js";

const observed = {
    permissionMissing: {
        status: 403,
        body: "Resource not accessible by integration - https://docs.github.com/rest/checks/runs#list-check-runs-for-a-git-reference",
        headers: { "x-accepted-github-permissions": "checks=read" },
    },
    suspended: {
        status: 403,
        body: "This GitHub App installation is currently suspended. - https://docs.github.com/rest",
        headers: {},
    },
    secondaryLimit: {
        status: 403,
        body: '{"message":"You have exceeded a secondary rate limit and have been temporarily blocked from content creation. Please retry your request again later."}',
        headers: { "x-ratelimit-remaining": "4909" },
    },
    validation: {
        status: 422,
        body: 'Validation Failed: {"message":"title can\'t be blank","value":null,"resource":"Issue","field":"title","code":"invalid"}',
        headers: {},
    },
    notInstalled: { status: 404, body: "Not Found", headers: {} },
} as const;

describe("classifyFailure (the matrix failure catalogue, executable)", () => {
    it("distinguishes the four observed 403s from each other", () => {
        expect(classifyFailure(observed.permissionMissing)).toEqual({
            kind: "permissionMissing",
            acceptedPermissions: "checks=read",
        });
        expect(classifyFailure(observed.suspended).kind).toBe("installationSuspended");
        expect(classifyFailure(observed.secondaryLimit).kind).toBe("secondaryLimit");
        expect(
            classifyFailure({
                status: 403,
                body: "API rate limit exceeded",
                headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1784838989" },
            }),
        ).toEqual({ kind: "primaryExhausted", resetAt: "1784838989" });
    });

    it("secondary limit wins over the permissions header — its body marker is the only reliable signal (6.4)", () => {
        const both = {
            ...observed.secondaryLimit,
            headers: { "x-accepted-github-permissions": "issues=write" },
        };
        expect(classifyFailure(both).kind).toBe("secondaryLimit");
    });

    it("401 splits on LOCAL token age, never the body — an expired token returns the same body as a wrong key (probe `…T21-52-06-572Z#1`)", () => {
        const observedExpiredBody =
            '{"message":"Bad credentials","documentation_url":"https://docs.github.com/rest","status":"401"}';
        expect(
            classifyFailure({
                status: 401,
                body: observedExpiredBody,
                headers: {},
                tokenPastExpiry: true,
            }).kind,
        ).toBe("tokenExpired");
        expect(classifyFailure({ status: 401, body: observedExpiredBody, headers: {} }).kind).toBe(
            "badCredentials",
        );
    });

    it("an unrecognized 403 admits ignorance instead of fabricating a diagnosis", () => {
        // A reworded suspension body must NOT be reported as a
        // permission problem — it degrades into a visible unknown
        // carrying the evidence verbatim.
        const reworded = {
            status: 403,
            body: "This installation has been suspended by the account owner.",
            headers: {},
        };
        expect(classifyFailure(reworded)).toEqual({
            kind: "forbiddenUnrecognized",
            bodySnippet: "This installation has been suspended by the account owner.",
        });
        expect(retryAdvice(classifyFailure(reworded), 0, 0)).toEqual({
            action: "doNotRetry",
            surfaceTo: "operator",
        });
    });

    it("the ignorance snippet is bounded — a huge body cannot flood a report", () => {
        const huge = { status: 403, body: "x".repeat(10_000), headers: {} };
        const classified = classifyFailure(huge);
        expect(classified.kind).toBe("forbiddenUnrecognized");
        if (classified.kind === "forbiddenUnrecognized") {
            expect(classified.bodySnippet).toHaveLength(200);
        }
    });

    it("404 is one class on purpose: existence is hidden, not-installed and nonexistent are indistinguishable (6.6 probe)", () => {
        expect(classifyFailure(observed.notInstalled).kind).toBe("notFoundOrNotInstalled");
    });

    it("non-error 299, 408, and server errors classify as transient — the bounded-retry bucket", () => {
        for (const status of [299, 408, 500, 502, 503]) {
            expect(classifyFailure({ status, body: "", headers: {} })).toEqual({
                kind: "transient",
            });
        }
    });

    it.each([400, 405, 406, 410, 412, 415, 451])(
        "classifies deterministic client response %i without calling it weather",
        (status) => {
            const failure = classifyFailure({ status, body: "request rejected", headers: {} });
            expect(failure).toEqual({ kind: "clientError", status });
            expect(retryAdvice(failure, 0, 0)).toEqual({
                action: "doNotRetry",
                surfaceTo: "operator",
            });
        },
    );

    it.each([
        [300, false],
        [301, true],
        [302, false],
        [307, false],
        [308, true],
    ] as const)("classifies redirect %i through the response vocabulary", (status, permanent) => {
        expect(
            classifyFailure({
                status,
                body: "",
                headers: { location: "https://api.github.com/repos/o/renamed" },
            }),
        ).toEqual({
            kind: "redirected",
            status,
            location: "https://api.github.com/repos/o/renamed",
            permanent,
        });
    });

    it("does not invent a location for a locationless redirect", () => {
        const failure = classifyFailure({ status: 308, body: "", headers: {} });
        expect(failure).toEqual({ kind: "redirected", status: 308, permanent: true });
        expect("location" in failure).toBe(false);
    });

    it("does not misclassify a cache-validation 304 as a redirect", () => {
        expect(classifyFailure({ status: 304, body: "", headers: {} })).toEqual({
            kind: "transient",
        });
    });

    it("429 is rate-limited and preserves Retry-After instead of retrying as a 500", () => {
        const failure = classifyFailure({
            status: 429,
            body: "rate limited",
            headers: { "retry-after": "120" },
        });
        expect(failure).toEqual({
            kind: "secondaryLimit",
            retryAfterSeconds: 120,
        });
        expect(retryAdvice(failure, 0, 0)).toEqual({
            action: "retryAfterMs",
            ms: 120_000,
        });
    });

    it("a primary exhaustion arriving as 429 still follows the reset header", () => {
        const failure = classifyFailure({
            status: 429,
            body: "API rate limit exceeded",
            headers: {
                "retry-after": "120",
                "x-ratelimit-remaining": "0",
                "x-ratelimit-reset": "1000",
            },
        });
        expect(failure).toEqual({
            kind: "primaryExhausted",
            resetAt: "1000",
        });
        expect(retryAdvice(failure, 0, 400)).toEqual({
            action: "retryAfterMs",
            ms: 600_000,
        });
    });

    it.each([
        [undefined, { kind: "secondaryLimit" }],
        ["0", { kind: "secondaryLimit", retryAfterSeconds: 0 }],
    ] as const)("handles Retry-After boundary %s explicitly", (value, expected) => {
        expect(
            classifyFailure({
                status: 429,
                body: "rate limited",
                headers: { "retry-after": value },
            }),
        ).toEqual(expected);
    });

    it.each(["", "-1", "not-a-number", "1.5"])(
        "fails closed for malformed Retry-After value %j",
        (value) => {
            const failure = classifyFailure({
                status: 429,
                body: "rate limited",
                headers: { "retry-after": value },
            });
            expect(failure).toEqual({
                kind: "rateLimitResponseUnusable",
                headerName: "retry-after",
                headerValue: value,
                reason: "invalid",
            });
            expect(retryAdvice(failure, 0, 0)).toEqual({
                action: "doNotRetry",
                surfaceTo: "operator",
            });
        },
    );

    it("surfaces Retry-After values beyond the automatic-wait bound instead of shortening them", () => {
        const value = String(MAX_AUTOMATIC_RATE_LIMIT_WAIT_SECONDS + 1);
        const failure = classifyFailure({
            status: 429,
            body: "rate limited",
            headers: { "retry-after": value },
        });
        expect(failure).toEqual({
            kind: "rateLimitResponseUnusable",
            headerName: "retry-after",
            headerValue: value,
            reason: "aboveAutomaticLimit",
        });
        expect(retryAdvice(failure, 0, 0)).toEqual({
            action: "doNotRetry",
            surfaceTo: "operator",
        });
    });

    it("accepts the exact automatic Retry-After boundary", () => {
        const failure = classifyFailure({
            status: 429,
            body: "rate limited",
            headers: {
                "retry-after": String(MAX_AUTOMATIC_RATE_LIMIT_WAIT_SECONDS),
            },
        });
        expect(failure).toEqual({
            kind: "secondaryLimit",
            retryAfterSeconds: MAX_AUTOMATIC_RATE_LIMIT_WAIT_SECONDS,
        });
        expect(retryAdvice(failure, 0, 0)).toEqual({
            action: "retryAfterMs",
            ms: MAX_AUTOMATIC_RATE_LIMIT_WAIT_SECONDS * 1000,
        });
    });

    it("422 with structured errors[] is maintainer-facing", () => {
        expect(classifyFailure(observed.validation).kind).toBe("validationError");
        expect(retryAdvice({ kind: "validationError" }, 0, 0)).toEqual({
            action: "doNotRetry",
            surfaceTo: "maintainer",
        });
    });
});

describe("retryAdvice (bounded, evidence-derived)", () => {
    it("secondary limit waits the documented one-minute floor — there is no header to trust", () => {
        expect(retryAdvice({ kind: "secondaryLimit" }, 0, 0)).toEqual({
            action: "retryAfterMs",
            ms: 60_000,
        });
    });

    it("Retry-After zero still observes the one-minute secondary-limit floor", () => {
        expect(retryAdvice({ kind: "secondaryLimit", retryAfterSeconds: 0 }, 0, 0)).toEqual({
            action: "retryAfterMs",
            ms: 60_000,
        });
    });

    it("primary exhaustion waits for the reset epoch", () => {
        const advice = retryAdvice({ kind: "primaryExhausted", resetAt: "1000" }, 0, 400);
        expect(advice).toEqual({ action: "retryAfterMs", ms: 600_000 });
    });

    it.each([undefined, "", "not-a-number"])(
        "fails closed when the primary reset header is unusable: %j",
        (resetAt) => {
            expect(retryAdvice({ kind: "primaryExhausted", resetAt }, 0, 0)).toEqual({
                action: "doNotRetry",
                surfaceTo: "operator",
            });
        },
    );

    it("surfaces a primary reset beyond the automatic-wait bound", () => {
        expect(
            retryAdvice(
                {
                    kind: "primaryExhausted",
                    resetAt: String(MAX_AUTOMATIC_RATE_LIMIT_WAIT_SECONDS + 1),
                },
                0,
                0,
            ),
        ).toEqual({
            action: "doNotRetry",
            surfaceTo: "operator",
        });
    });

    it("accepts a primary reset at the exact automatic-wait boundary", () => {
        expect(
            retryAdvice(
                {
                    kind: "primaryExhausted",
                    resetAt: String(MAX_AUTOMATIC_RATE_LIMIT_WAIT_SECONDS),
                },
                0,
                0,
            ),
        ).toEqual({
            action: "retryAfterMs",
            ms: MAX_AUTOMATIC_RATE_LIMIT_WAIT_SECONDS * 1000,
        });
    });

    it("a rate limit that survives the attempt bound stops waiting and surfaces — pacing is a design problem, not a wait problem", () => {
        for (const failure of [
            { kind: "secondaryLimit" },
            { kind: "primaryExhausted", resetAt: "1000" },
        ] as const) {
            // The last allowed attempt still waits…
            expect(retryAdvice(failure, MAX_RATE_LIMIT_ATTEMPTS - 1, 0).action).toBe(
                "retryAfterMs",
            );
            // …one past the bound surfaces to the operator.
            expect(retryAdvice(failure, MAX_RATE_LIMIT_ATTEMPTS, 0)).toEqual({
                action: "doNotRetry",
                surfaceTo: "operator",
            });
        }
    });

    it("transient failures back off boundedly, then surface to the operator", () => {
        const waits = [0, 1, 2, 3].map((attempt) => retryAdvice({ kind: "transient" }, attempt, 0));
        expect(waits.slice(0, 3).map((w) => (w.action === "retryAfterMs" ? w.ms : -1))).toEqual([
            500, 2_000, 8_000,
        ]);
        expect(waits[3]).toEqual({ action: "doNotRetry", surfaceTo: "operator" });
    });

    it("expired tokens refresh within their own bound, then surface", () => {
        expect(retryAdvice({ kind: "tokenExpired" }, 0, 0)).toEqual({
            action: "refreshTokenAndRetry",
        });
        expect(retryAdvice({ kind: "tokenExpired" }, MAX_TOKEN_REFRESH_ATTEMPTS, 0)).toEqual({
            action: "doNotRetry",
            surfaceTo: "operator",
        });
    });

    it("every failure class has advice — the switch is exhaustive by type", () => {
        const kinds: FailureClass[] = [
            { kind: "tokenExpired" },
            { kind: "badCredentials" },
            { kind: "permissionMissing", acceptedPermissions: "" },
            { kind: "installationSuspended" },
            { kind: "forbiddenUnrecognized", bodySnippet: "" },
            {
                kind: "rateLimitResponseUnusable",
                headerName: "retry-after",
                headerValue: "",
                reason: "invalid",
            },
            { kind: "secondaryLimit" },
            { kind: "primaryExhausted", resetAt: undefined },
            { kind: "notFoundOrNotInstalled" },
            { kind: "validationError" },
            { kind: "redirected", status: 301, permanent: true },
            { kind: "clientError", status: 400 },
            { kind: "transient" },
        ];
        for (const failure of kinds) {
            expect(retryAdvice(failure, 0, 0).action).toBeTruthy();
        }
    });

    it("never advises retrying a redirect or deterministic client response", () => {
        expect(retryAdvice({ kind: "redirected", status: 301, permanent: true }, 0, 0)).toEqual({
            action: "doNotRetry",
            surfaceTo: "operator",
        });
        expect(retryAdvice({ kind: "clientError", status: 410 }, 0, 0)).toEqual({
            action: "doNotRetry",
            surfaceTo: "operator",
        });
    });
});

/**
 * Property-based tests (fast-check): randomized inputs with a fixed seed —
 * deterministic runs, shrinking to minimal counterexamples on failure.
 * They state the PROPERTIES the fixtures above cannot: that classification
 * is total, and closed over the documented 403 classes.
 */
const SEED = 20260725;

describe("classifyFailure properties", () => {
    const observation = fc.record(
        {
            status: fc.integer({ min: 100, max: 599 }),
            body: fc.string({ maxLength: 500 }),
            headers: fc.dictionary(fc.stringMatching(/^[a-z][a-z-]{0,25}$/), fc.string(), {
                maxKeys: 6,
            }),
            tokenPastExpiry: fc.boolean(),
        },
        { requiredKeys: ["status", "body", "headers"] },
    );

    it("is total, and every 403 lands in a documented 403 class with evidence", () => {
        const FORBIDDEN_KINDS = new Set([
            "secondaryLimit",
            "primaryExhausted",
            "rateLimitResponseUnusable",
            "permissionMissing",
            "installationSuspended",
            "forbiddenUnrecognized",
        ]);
        fc.assert(
            fc.property(observation, (o) => {
                const failure = classifyFailure(o); // must not throw
                if (o.status === 403) {
                    expect(FORBIDDEN_KINDS.has(failure.kind)).toBe(true);
                    if (failure.kind === "forbiddenUnrecognized") {
                        // Ignorance always carries bounded evidence.
                        expect(failure.bodySnippet).toBe(o.body.slice(0, 200));
                    }
                }
                if (o.status === 401) {
                    expect(failure.kind).toBe(
                        o.tokenPastExpiry === true ? "tokenExpired" : "badCredentials",
                    );
                }
            }),
            { seed: SEED, numRuns: 500 },
        );
    });
});

/**
 * The exhaustive sweep, where the examples above check cases: it
 * enumerates the full input space and asserts the PROPERTY —
 * `retryAdvice` always terminates in bounded advice.
 */
describe("retryAdvice: bounded for every class and attempt", () => {
    const classes: FailureClass[] = [
        { kind: "tokenExpired" },
        { kind: "badCredentials" },
        { kind: "permissionMissing", acceptedPermissions: "" },
        { kind: "installationSuspended" },
        { kind: "forbiddenUnrecognized", bodySnippet: "" },
        {
            kind: "rateLimitResponseUnusable",
            headerName: "retry-after",
            headerValue: "",
            reason: "invalid",
        },
        { kind: "secondaryLimit" },
        { kind: "primaryExhausted", resetAt: "1000" },
        { kind: "primaryExhausted", resetAt: undefined },
        { kind: "notFoundOrNotInstalled" },
        { kind: "validationError" },
        { kind: "redirected", status: 302, permanent: false },
        { kind: "clientError", status: 400 },
        { kind: "transient" },
    ];

    it("every class × attempts 0..5 yields valid advice, and waits always end", () => {
        for (const failure of classes) {
            for (let attempt = 0; attempt <= 5; attempt++) {
                const advice = retryAdvice(failure, attempt, 0);
                if (advice.action === "retryAfterMs") {
                    expect(advice.ms).toBeGreaterThanOrEqual(0);
                    expect(Number.isFinite(advice.ms)).toBe(true);
                }
            }
            // Past the bound, no advised-wait class waits forever.
            const late = retryAdvice(
                failure,
                Math.max(MAX_RATE_LIMIT_ATTEMPTS, MAX_TOKEN_REFRESH_ATTEMPTS) + 1,
                0,
            );
            if (
                failure.kind === "tokenExpired" ||
                failure.kind === "secondaryLimit" ||
                failure.kind === "primaryExhausted" ||
                failure.kind === "transient"
            ) {
                expect(late.action).toBe("doNotRetry");
            }
        }
    });
});

describe("the perishable surface keeps its own evidence", () => {
    /**
     * `FINDING(failures-prose-snapshot)`, D40: these two patterns are the only
     * place this module reads GitHub's wording, and they go stale silently —
     * a reworded message stops matching, the response degrades to
     * `forbiddenUnrecognized`, and every test still passes because the
     * fixtures agree with themselves.
     *
     * Nothing here can detect that GitHub has changed. What it CAN detect is
     * the near-miss: a pattern edited without its recorded sample, or a sample
     * updated without the pattern. That is the drift a human introduces during
     * the quarterly re-probe, and it is the half that is catchable.
     */
    it("every pattern still matches the text it was written against", () => {
        for (const [name, entry] of Object.entries(BODY_PATTERNS)) {
            expect(
                entry.pattern.test(entry.observed),
                `${name}: the pattern no longer matches its own recorded sample`,
            ).toBe(true);
        }
    });

    it("every pattern records when and where it was probed", () => {
        for (const [name, entry] of Object.entries(BODY_PATTERNS)) {
            expect(entry.probedAt, `${name} has no probe date`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
            expect(entry.experiment.length, `${name} names no experiment`).toBeGreaterThan(0);
            expect(entry.observed.length).toBeGreaterThan(20);
        }
    });

    /**
     * The classifier must actually use them. A table nothing reads would pass
     * every assertion above while the real regexes rotted inline.
     */
    it("the classifier routes through the table, not a private copy", () => {
        expect(
            classifyFailure({
                status: 403,
                body: BODY_PATTERNS.secondaryRateLimit.observed,
                headers: {},
            }),
        ).toMatchObject({ kind: "secondaryLimit" });
        expect(
            classifyFailure({
                status: 403,
                body: BODY_PATTERNS.installationSuspended.observed,
                headers: {},
            }),
        ).toMatchObject({ kind: "installationSuspended" });
    });

    it("prose it has never seen degrades to unrecognised, carrying the evidence", () => {
        const result = classifyFailure({
            status: 403,
            body: "Some wording GitHub has not used before.",
            headers: {},
        });
        expect(result.kind).toBe("forbiddenUnrecognized");
    });
});
