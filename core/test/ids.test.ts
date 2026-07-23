import { describe, it, expect } from "vitest";
import { asDeliveryId } from "../src/ids.js";

describe("DeliveryId (FINDING(delivery-id-precision), experiment 6.2)", () => {
    it("accepts a >2^53 digit string unchanged", () => {
        const raw = "3832900504397021184"; // a real observed id; > Number.MAX_SAFE_INTEGER
        expect(asDeliveryId(raw)).toBe(raw);
    });

    it("rejects the corrupted forms a number round-trip produces", () => {
        for (const bad of ["3.832900504397021e18", "3832900504397021000.0", "", "  ", "12a4", "-5"]) {
            expect(asDeliveryId(bad)).toBeUndefined();
        }
    });

    it("a numeric delivery id is a compile error, not a runtime bug", () => {
        // @ts-expect-error — DeliveryId construction requires a string
        asDeliveryId(3832900504397021184);
    });
});
