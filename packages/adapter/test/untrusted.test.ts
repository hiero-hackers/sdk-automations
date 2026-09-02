/**
 * The total readers for GitHub's bytes, held directly: bad shape answers
 * null or undefined, never a throw — including the shapes that only a
 * direct test can distinguish (the flows above them mask the difference).
 */

import { describe, expect, it } from "vitest";
import { field, jsonArrayOf, jsonRecordOf } from "../src/untrusted.js";

describe("field", () => {
    it("reads a property from an object", () => {
        expect(field({ a: 1 }, "a")).toBe(1);
    });

    it.each([
        ["null", null],
        ["undefined", undefined],
        ["a number", 7],
        ["a string", "x"],
    ])("answers undefined for %s without throwing", (_label, value) => {
        expect(field(value, "a")).toBeUndefined();
    });

    it.each(["__proto__", "constructor", "toString", "hasOwnProperty", "valueOf"])(
        "answers undefined for the inherited key %s",
        (name) => {
            // Each of these is truthy on a plain object's prototype, so an
            // unguarded read hands a caller a value GitHub never sent.
            expect(field({ a: 1 }, name)).toBeUndefined();
        },
    );

    it("answers undefined for an inherited key an ancestor defined", () => {
        const parent = { inherited: "from the prototype" };
        expect(field(Object.create(parent) as object, "inherited")).toBeUndefined();
    });

    it("still reads a key the payload itself carries under a prototype name", () => {
        // JSON.parse defines `__proto__` as an OWN property, so this one was
        // genuinely in the bytes and the reader must not hide it.
        const record = jsonRecordOf('{"__proto__":{"a":1},"constructor":"c"}');
        expect(field(record, "__proto__")).toEqual({ a: 1 });
        expect(field(record, "constructor")).toBe("c");
    });

    it("reads own properties whose value is falsy or undefined", () => {
        expect(field({ a: 0 }, "a")).toBe(0);
        expect(field({ a: undefined }, "a")).toBeUndefined();
    });
});

describe("jsonRecordOf", () => {
    it("answers the object a JSON object body carries", () => {
        expect(jsonRecordOf('{"a":1}')).toEqual({ a: 1 });
    });

    it.each([
        ["unparsable text", "not json"],
        ["a JSON string", '"x"'],
        ["a JSON number", "7"],
        ["a JSON array", "[1]"],
        ["a JSON null", "null"],
    ])("answers null for %s", (_label, body) => {
        expect(jsonRecordOf(body)).toBeNull();
    });
});

describe("jsonArrayOf", () => {
    it("answers the array a JSON array body carries", () => {
        expect(jsonArrayOf("[1,2]")).toEqual([1, 2]);
    });

    it.each([
        ["unparsable text", "not json"],
        ["a JSON object", '{"a":1}'],
        ["a JSON string", '"x"'],
        ["a JSON null", "null"],
    ])("answers null for %s", (_label, body) => {
        expect(jsonArrayOf(body)).toBeNull();
    });
});
