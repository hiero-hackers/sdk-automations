import { describe, expect, it } from "vitest";
import {
    driftOf,
    missingFields,
    outgrewOnePage,
    paginationDrift,
    resolves,
    segmentsOf,
    type Sent,
    weather,
} from "../src/probes/drift.js";
import type { Pagination, Shape } from "../src/probes/reads.js";

const NEXT = '<https://api.github.com/x?page=2>; rel="next"';
const NEXT_AND_LAST = `${NEXT}, <https://api.github.com/x?page=9>; rel="last"`;
const LAST = '<https://api.github.com/x?page=9>; rel="last"';

describe("paginationDrift", () => {
    const cases: readonly [Pagination, string | undefined, string | null][] = [
        ["next-only", NEXT, null],
        ["next-only", undefined, null],
        ["next-only", NEXT_AND_LAST, "pagination: next-only → last-named"],
        ["next-only", LAST, "pagination: next-only → last-named"],
        ["last-named", NEXT_AND_LAST, null],
        ["last-named", LAST, null],
        ["last-named", NEXT, "pagination: last-named → next-only"],
        ["none", undefined, null],
        ["none", NEXT_AND_LAST, null],
    ];
    it.each(cases)("%s against %s says %s", (recorded, link, expected) => {
        expect(paginationDrift(recorded, link)).toBe(expected);
    });
});

describe("outgrewOnePage", () => {
    const cases: readonly [Pagination, string | undefined, boolean][] = [
        ["none", NEXT, true],
        ["none", LAST, true],
        ["none", NEXT_AND_LAST, true],
        ["none", undefined, false],
        ["none", '<https://api.github.com/x>; rel="prev"', false],
        ["next-only", NEXT, false],
        ["last-named", NEXT_AND_LAST, false],
    ];
    it.each(cases)("%s against %s is %s", (recorded, link, expected) => {
        expect(outgrewOnePage(recorded, link)).toBe(expected);
    });
});

describe("weather", () => {
    const cases: readonly [number, boolean][] = [
        [500, true],
        [502, true],
        [503, true],
        [429, true],
        [200, false],
        [304, false],
        [403, false],
        [404, false],
        [499, false],
    ];
    it.each(cases)("status %s is %s", (status, expected) => {
        expect(weather(status)).toBe(expected);
    });
});

describe("segmentsOf", () => {
    const cases: readonly [string, readonly string[]][] = [
        ["number", ["number"]],
        ["user.login", ["user", "login"]],
        ["labels[].name", ["labels", "[]", "name"]],
        ["[]", ["[]"]],
        ["a[].b[].c", ["a", "[]", "b", "[]", "c"]],
        ["a..b", ["a", "b"]],
        ["", []],
    ];
    it.each(cases)("%j splits to %j", (path, expected) => {
        expect(segmentsOf(path)).toEqual(expected);
    });
    it("never leaves an empty segment or a glued `[]`", () => {
        expect(segmentsOf("labels[].name")).not.toContain("");
        expect(segmentsOf("labels[].name")).not.toContain("labels[]");
    });
});

describe("resolves", () => {
    const body = { a: { b: 1, n: null }, list: [{ x: 1 }, { y: 2 }], none: [] };
    const cases: readonly [string, readonly string[], boolean][] = [
        ["nothing left to walk", [], true],
        ["a present key", ["a"], true],
        ["a nested key", ["a", "b"], true],
        ["a key holding null", ["a", "n"], true],
        ["an absent key", ["z"], false],
        ["an absent nested key", ["a", "c"], false],
        ["a key under a scalar", ["a", "b", "c"], false],
        ["a key only an object's prototype has", ["toString"], false],
        ["an array walked where one is held", ["list", "[]"], true],
        ["a key some entry carries", ["list", "[]", "y"], true],
        ["a key no entry carries", ["list", "[]", "z"], false],
        ["an array walked where an object is held", ["a", "[]"], false],
        ["any path under an empty array", ["none", "[]", "anything", "at", "all"], true],
    ];
    it.each(cases)("%s", (_name, segments, expected) => {
        expect(resolves(body, segments)).toBe(expected);
    });
    it("walks a bare array body with a leading `[]`", () => {
        expect(resolves([{ number: 1 }], ["[]", "number"])).toBe(true);
        expect(resolves([{ number: 1 }], ["number"])).toBe(false);
    });
});

describe("missingFields", () => {
    const cases: readonly [string, string, readonly string[], readonly string[]][] = [
        ["every field present", '{"number":1,"user":{"login":"a"}}', ["number", "user.login"], []],
        ["a field absent", '{"number":1,"user":{}}', ["number", "user.login"], ["user.login"]],
        ["every field absent", "{}", ["number", "state"], ["number", "state"]],
        ["a body that is not JSON", "<html>", ["number"], ["number"]],
        ["no fields recorded", "{}", [], []],
        ["an optional path absent", '{"number":1}', ["number", "milestone?"], []],
        ["an optional path present", '{"number":1,"milestone":null}', ["milestone?"], []],
        ["a required twin of that path absent", '{"number":1}', ["milestone"], ["milestone"]],
        [
            "an array walked, an entry carrying it",
            '{"labels":[{"name":"x"}]}',
            ["labels[].name"],
            [],
        ],
        [
            "an array walked, no entry carrying it",
            '{"labels":[{"id":1}]}',
            ["labels[].name"],
            ["labels[].name"],
        ],
        ["an empty array under a walked path", '{"labels":[]}', ["labels[].name"], []],
        ["an array body, an entry carrying it", '[{"number":1}]', ["number"], []],
        ["an array body, no entry carrying it", '[{"id":1}]', ["number"], ["number"]],
        ["an empty array body", "[]", ["number", "user.login"], []],
        [
            "a walked path whose parent is not an array",
            '{"labels":"x"}',
            ["labels[].name"],
            ["labels[].name"],
        ],
    ];
    it.each(cases)("%s", (_name, body, fields, expected) => {
        expect(missingFields(body, fields)).toEqual(expected);
    });
});

describe("driftOf", () => {
    const shape: Shape = {
        status: 200,
        permission: "issues:read",
        headers: ["etag"],
        pagination: "next-only",
        conditional: "none",
        fields: ["number", "user.login"],
    };
    const clean: Sent = {
        status: 200,
        headers: {
            etag: '"abc"',
            link: NEXT,
            "x-accepted-github-permissions": "issues=read; pull_requests=read",
        },
        body: '{"number":1,"user":{"login":"a"}}',
    };
    const without = (name: string): Record<string, string> => {
        const { [name]: _dropped, ...rest } = clean.headers;
        return rest;
    };

    const cases: readonly [string, Sent, readonly string[]][] = [
        ["no drift", clean, []],
        ["a status that moved", { ...clean, status: 404 }, ["status: 200 → 404"]],
        [
            "a permission the header no longer offers",
            {
                ...clean,
                headers: { ...clean.headers, "x-accepted-github-permissions": "contents=read" },
            },
            ["permission: issues:read → contents=read"],
        ],
        [
            "a permission header that is absent",
            { ...clean, headers: without("x-accepted-github-permissions") },
            [],
        ],
        [
            "a header that went absent",
            { ...clean, headers: without("etag") },
            ["headers: etag → absent"],
        ],
        [
            "a link header that now names last",
            { ...clean, headers: { ...clean.headers, link: NEXT_AND_LAST } },
            ["pagination: next-only → last-named"],
        ],
        [
            "a field that went absent",
            { ...clean, body: '{"number":1,"user":{}}' },
            ["fields: user.login → absent"],
        ],
        [
            "every property drifting at once, in a fixed order",
            {
                status: 500,
                headers: { link: NEXT_AND_LAST, "x-accepted-github-permissions": "contents=read" },
                body: "{}",
            },
            [
                "status: 200 → 500",
                "permission: issues:read → contents=read",
                "headers: etag → absent",
                "pagination: next-only → last-named",
                "fields: number → absent",
                "fields: user.login → absent",
            ],
        ],
    ];
    it.each(cases)("%s", (_name, sent, expected) => {
        expect(driftOf(shape, sent)).toEqual(expected);
    });
});
