/**
 * Property-based tests for the timestamp boundary — the store's `<=`
 * comparisons are string comparisons, so the load-bearing property is:
 * over ALL accepted timestamps, lexicographic order ≡ chronological
 * order. Fixed seed: deterministic runs, shrinking on failure.
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { assertUtcInstant } from "../src/store.js";

const SEED = 20260725;

// Arbitrary instants across a wide range, at millisecond precision.
const instant = fc
    .integer({ min: 0, max: 4102444800000 }) // 1970 → 2100
    .map((ms) => new Date(ms).toISOString());

describe("assertUtcInstant properties", () => {
    it("accepts every Date.toISOString() output", () => {
        fc.assert(
            fc.property(instant, (iso) => {
                assertUtcInstant(iso, "t"); // must not throw
            }),
            { seed: SEED, numRuns: 500 },
        );
    });

    it("lexicographic order ≡ chronological order over accepted pairs", () => {
        fc.assert(
            fc.property(instant, instant, (a, b) => {
                assertUtcInstant(a, "a");
                assertUtcInstant(b, "b");
                expect(a <= b).toBe(Date.parse(a) <= Date.parse(b));
                expect(a === b).toBe(Date.parse(a) === Date.parse(b));
            }),
            { seed: SEED, numRuns: 1000 },
        );
    });

    it("rejects every non-canonical string — offsets, seconds-only, prose, junk", () => {
        const nonCanonical = fc.oneof(
            // Seconds-only Z (the mixed-precision hazard).
            fc
                .integer({ min: 0, max: 4102444800000 })
                .map((ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z")),
            // Offset forms.
            fc
                .integer({ min: 0, max: 4102444800000 })
                .map((ms) => new Date(ms).toISOString().replace("Z", "+01:00")),
            // Arbitrary strings that are not the canonical shape.
            fc
                .string({ maxLength: 40 })
                .filter((s) => !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(s)),
        );
        fc.assert(
            fc.property(nonCanonical, (bad) => {
                expect(() => assertUtcInstant(bad, "t")).toThrow(TypeError);
            }),
            { seed: SEED, numRuns: 500 },
        );
    });
});
