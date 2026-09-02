import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { asDeliveryGuid, asDeliveryRecordId } from "../../src/github/ids.js";

/**
 * Property-based tests (fast-check): randomized inputs with a fixed seed —
 * deterministic runs, shrinking to minimal counterexamples on failure.
 * They state the PROPERTY the examples below cannot: that accepted
 * identifiers round-trip unchanged over a generated input space.
 */
const SEED = 20260725;

describe("asDeliveryRecordId properties", () => {
    it("accepts exactly digit strings, and accepted values round-trip unchanged", () => {
        fc.assert(
            fc.property(fc.string({ maxLength: 40 }), (s) => {
                const id = asDeliveryRecordId(s);
                expect(id !== undefined).toBe(/^\d+$/.test(s));
                if (id !== undefined) expect(id).toBe(s); // opaque: never normalized
            }),
            { seed: SEED, numRuns: 500 },
        );
        // And digit strings beyond 2^53 — the whole point — are preserved.
        fc.assert(
            fc.property(fc.stringMatching(/^[1-9]\d{18,24}$/), (s) => {
                expect(asDeliveryRecordId(s)).toBe(s);
            }),
            { seed: SEED, numRuns: 200 },
        );
    });
});

describe("delivery identifier separation (experiment 6.2)", () => {
    it("accepts the X-GitHub-Delivery GUID used to deduplicate webhook deliveries", () => {
        const guid = "0b989ba4-242f-11e5-81e1-c7b6966d2516";
        expect(asDeliveryGuid(guid)).toBe(guid);
        expect(asDeliveryRecordId(guid)).toBeUndefined();
    });

    it("rejects an uppercased GUID: a case-variant would be a second delivery, not a duplicate", () => {
        expect(asDeliveryGuid("0B989BA4-242F-11E5-81E1-C7B6966D2516")).toBeUndefined();
        expect(asDeliveryGuid("0b989ba4-242f-11e5-81e1-c7b6966d251A")).toBeUndefined();
    });

    it("accepts a >2^53 digit string unchanged", () => {
        const raw = "3832900504397021184"; // a real observed id; > Number.MAX_SAFE_INTEGER
        expect(asDeliveryRecordId(raw)).toBe(raw);
        expect(asDeliveryGuid(raw)).toBeUndefined();
    });

    it("rejects the corrupted forms a number round-trip produces", () => {
        for (const bad of [
            "3.832900504397021e18",
            "3832900504397021000.0",
            "",
            "  ",
            "12a4",
            "-5",
        ]) {
            expect(asDeliveryRecordId(bad)).toBeUndefined();
        }
    });

    it("a numeric delivery id is a compile error, not a runtime bug", () => {
        // @ts-expect-error — DeliveryRecordId construction requires a string
        expect(asDeliveryRecordId(3832900504397021184)).toBeUndefined();
    });

    it("rejects coercible objects and strings with GUID prefixes or suffixes", () => {
        const guid = "0b989ba4-242f-11e5-81e1-c7b6966d2516";
        expect(
            // @ts-expect-error — runtime callers may still violate the boundary
            asDeliveryGuid({ toString: () => guid }),
        ).toBeUndefined();
        expect(asDeliveryGuid(`prefix-${guid}`)).toBeUndefined();
        expect(asDeliveryGuid(`${guid}-suffix`)).toBeUndefined();
    });
});
