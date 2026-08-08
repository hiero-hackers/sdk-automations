import { describe, it, expect } from "vitest";
import { asDeliveryGuid, asDeliveryRecordId } from "../../src/github/ids.js";

describe("delivery identifier separation (experiment 6.2)", () => {
    it("accepts the X-GitHub-Delivery GUID used to deduplicate webhook deliveries", () => {
        const guid = "0b989ba4-242f-11e5-81e1-c7b6966d2516";
        expect(asDeliveryGuid(guid)).toBe(guid);
        expect(asDeliveryRecordId(guid)).toBeUndefined();
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
