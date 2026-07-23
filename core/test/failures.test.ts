/**
 * Fixtures below are the ACTUAL bodies and headers observed in the
 * stage-three runs (evidence logs, 2026-07-23) — the classifier is
 * tested against what GitHub really sent, not paraphrases.
 */
import { describe, it, expect } from "vitest";
import { classifyFailure, retryAdvice, type FailureClass } from "../src/failures.js";

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
            classifyFailure({ status: 403, body: "API rate limit exceeded", headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1784838989" } }),
        ).toEqual({ kind: "primaryExhausted", resetAt: "1784838989" });
    });

    it("secondary limit wins over the permissions header — its body marker is the only reliable signal (6.4)", () => {
        const both = { ...observed.secondaryLimit, headers: { "x-accepted-github-permissions": "issues=write" } };
        expect(classifyFailure(both).kind).toBe("secondaryLimit");
    });

    it("401 splits on LOCAL token age, never the body — an expired token returns the same body as a wrong key (probe `…T21-52-06-572Z#1`)", () => {
        const observedExpiredBody = '{"message":"Bad credentials","documentation_url":"https://docs.github.com/rest","status":"401"}';
        expect(classifyFailure({ status: 401, body: observedExpiredBody, headers: {}, tokenPastExpiry: true }).kind).toBe("tokenExpired");
        expect(classifyFailure({ status: 401, body: observedExpiredBody, headers: {} }).kind).toBe("badCredentials");
    });

    it("404 is one class on purpose: existence is hidden, not-installed and nonexistent are indistinguishable (6.6 probe)", () => {
        expect(classifyFailure(observed.notInstalled).kind).toBe("notFoundOrNotInstalled");
    });

    it("422 with structured errors[] is maintainer-facing", () => {
        expect(classifyFailure(observed.validation).kind).toBe("validationError");
        expect(retryAdvice({ kind: "validationError" }, 0, 0)).toEqual({ action: "doNotRetry", surfaceTo: "maintainer" });
    });
});

describe("retryAdvice (bounded, evidence-derived)", () => {
    it("secondary limit waits the documented one-minute floor — there is no header to trust", () => {
        expect(retryAdvice({ kind: "secondaryLimit" }, 0, 0)).toEqual({ action: "retryAfterMs", ms: 60_000 });
    });

    it("primary exhaustion waits for the reset epoch", () => {
        const advice = retryAdvice({ kind: "primaryExhausted", resetAt: "1000" }, 0, 400);
        expect(advice).toEqual({ action: "retryAfterMs", ms: 600_000 });
    });

    it("transient failures back off boundedly, then surface to the operator", () => {
        const waits = [0, 1, 2, 3].map((attempt) => retryAdvice({ kind: "transient" }, attempt, 0));
        expect(waits.slice(0, 3).map((w) => (w.action === "retryAfterMs" ? w.ms : -1))).toEqual([500, 2_000, 8_000]);
        expect(waits[3]).toEqual({ action: "doNotRetry", surfaceTo: "operator" });
    });

    it("expired tokens are refresh-and-retry, never surfaced as errors", () => {
        expect(retryAdvice({ kind: "tokenExpired" }, 0, 0)).toEqual({ action: "refreshTokenAndRetry" });
    });

    it("every failure class has advice — the switch is exhaustive by type", () => {
        const kinds: FailureClass[] = [
            { kind: "tokenExpired" },
            { kind: "badCredentials" },
            { kind: "permissionMissing", acceptedPermissions: "" },
            { kind: "installationSuspended" },
            { kind: "secondaryLimit" },
            { kind: "primaryExhausted", resetAt: undefined },
            { kind: "notFoundOrNotInstalled" },
            { kind: "validationError" },
            { kind: "transient" },
        ];
        for (const failure of kinds) {
            expect(retryAdvice(failure, 0, 0).action).toBeTruthy();
        }
    });
});
