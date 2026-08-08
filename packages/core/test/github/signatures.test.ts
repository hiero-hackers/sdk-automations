/**
 * The verifier guards the most attacker-reachable line of the system, so its
 * tests are adversarial: every malformed shape must be a quiet `false`, and
 * the accept path must depend on every byte of body, secret, and header.
 */

import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { SIGNATURE_HEADER, signBody, verifyBody } from "../../src/github/index.js";

const SECRET = "test-webhook-secret";
const BODY = '{"action":"opened","number":7}';

describe("round trip", () => {
    it("accepts what signBody produced", () => {
        expect(verifyBody(SECRET, BODY, signBody(SECRET, BODY))).toBe(true);
    });

    it("the header constant is GitHub's, lowercase", () => {
        expect(SIGNATURE_HEADER).toBe("x-hub-signature-256");
    });

    it("signs bytes and text identically", () => {
        expect(signBody(SECRET, Buffer.from(BODY))).toBe(signBody(SECRET, BODY));
    });

    it("the signature carries the scheme prefix", () => {
        expect(signBody(SECRET, BODY)).toMatch(/^sha256=[0-9a-f]{64}$/);
    });
});

describe("every rejection is false, never a throw", () => {
    /**
     * Headers are built LAZILY, inside each test. A first draft computed
     * them at describe-time, and a mutant that broke `signBody` then crashed
     * COLLECTION — vitest reports "no tests", which Stryker counts as
     * survived rather than killed. A mutant must die on an assertion.
     */
    const CASES: readonly (readonly [string, () => string | undefined])[] = [
        ["absent header", () => undefined],
        ["empty header", () => ""],
        ["wrong scheme", () => signBody(SECRET, BODY).replace("sha256=", "sha1=")],
        ["truncated", () => signBody(SECRET, BODY).slice(0, -1)],
        ["extended", () => signBody(SECRET, BODY) + "0"],
        [
            "one hex digit off",
            () => {
                const valid = signBody(SECRET, BODY);
                return valid.slice(0, -1) + (valid.endsWith("0") ? "1" : "0");
            },
        ],
        ["not hex at all", () => "sha256=" + "z".repeat(64)],
    ];

    it.each(CASES)("%s", (_name, header) => {
        expect(verifyBody(SECRET, BODY, header())).toBe(false);
    });

    it("a different body is rejected", () => {
        expect(verifyBody(SECRET, BODY + " ", signBody(SECRET, BODY))).toBe(false);
    });

    it("a different secret is rejected", () => {
        expect(verifyBody("other-secret", BODY, signBody(SECRET, BODY))).toBe(false);
    });

    it("the signature is the body's HMAC, not a constant", () => {
        // Kills the mutant that empties the algorithm string: two bodies
        // must produce two different, correctly-sized digests.
        const a = signBody(SECRET, "a");
        const b = signBody(SECRET, "b");
        expect(a).not.toBe(b);
        expect(a).toMatch(/^sha256=[0-9a-f]{64}$/);
        expect(verifyBody(SECRET, "a", a)).toBe(true);
        expect(verifyBody(SECRET, "b", a)).toBe(false);
    });

    it("arbitrary header text never throws and never verifies", () => {
        fc.assert(
            fc.property(fc.string(), (header) => {
                expect(verifyBody(SECRET, BODY, header)).toBe(false);
            }),
            { numRuns: 300 },
        );
    });
});
