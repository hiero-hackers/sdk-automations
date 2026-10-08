/**
 * What SURVIVES a hostile input, and that nothing throws on the way.
 *
 * The config file is repository-controlled content, so hostile keys and
 * absurd shapes are inputs rather than edge cases. The rejections they
 * produce now live in the corpus (`documents.ts`) alongside every other
 * rejection; what stays here is the two claims a corpus row cannot make,
 * because neither is about one input reaching one code:
 *  - "pure; never throws" holds for ANY already-parsed value, including the
 *    ones that are perfectly fine;
 *  - nothing validated ever silently vanishes from — or appears in — the
 *    result (the `__proto__` assignment hole: a plain `obj[key] = value`
 *    both pollutes the prototype and loses the entry).
 */
import { describe, it, expect } from "vitest";
import { flag, spec } from "../../src/capability/index.js";
import { addressManagedComment } from "../../src/intents/index.js";
import { parseConfig } from "../../src/config/index.js";
import { admitting } from "./builders.js";

describe("hostile keys survive as data, never as prototype", () => {
    /**
     * `constructor` is valid camelCase, so it may legitimately be a
     * capability. What must NEVER happen is an inherited member
     * masquerading as configuration when the name is absent.
     */
    it("Object.prototype member names are ordinary keys, and absent lookups are undefined", () => {
        const result = parseConfig(
            {
                schemaVersion: 2,
                capabilities: { constructor: { enabled: false } },
            },
            { revision: "rev-test", knownCapabilities: admitting(["constructor"]) },
        );
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.config.capabilities.constructor).toEqual({
                enabled: false,
                settings: {},
            });
            expect(result.config.capabilities.hasOwnProperty).toBeUndefined();
            expect(result.config.capabilities.toString).toBeUndefined();
        }
    });

    /**
     * Principal names are pattern-checked now, so `__proto__` is REFUSED here
     * as it is under `capabilities` and `mappings.alerts` — the hole is closed
     * at the name rather than survived at the assignment.
     *
     * The second half is what keeps `cleanRecord` load-bearing under a name
     * the pattern DOES admit: the record has no prototype, so a lookup nobody
     * set reads `undefined` rather than an inherited member.
     */
    it("a __proto__ principal is refused, and a legal one lands on a bare record", () => {
        const raw = JSON.parse('{"schemaVersion":2,"principals":{"__proto__":"team-x"}}');
        const result = parseConfig(raw, { revision: "rev-test", knownCapabilities: [] });
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.errors.map((e) => [e.code, e.path])).toEqual([
                ["principalNameInvalid", "principals.__proto__"],
            ]);
        }

        const legal = parseConfig(
            { schemaVersion: 2, principals: { maintainerTeam: "team-x" } },
            { revision: "rev-test", knownCapabilities: [] },
        );
        expect(legal.ok).toBe(true);
        if (legal.ok) {
            expect(Object.entries(legal.config.principals)).toEqual([["maintainerTeam", "team-x"]]);
            expect(Object.getPrototypeOf(legal.config.principals)).toBeNull();
            expect(legal.config.principals.toString).toBeUndefined();
        }
    });

    /**
     * D84 built one new record: the admission lookup. A plain object there
     * would answer `constructor` and `toString` for capabilities nobody
     * admitted — turning `capabilityUnknown` off for exactly the names an
     * attacker would pick — so it is a `Map`, and this is what says so.
     */
    it("an inherited name is not an admitted capability", () => {
        for (const name of ["constructor", "toString", "hasOwnProperty"]) {
            const result = parseConfig(
                { schemaVersion: 2, capabilities: { [name]: { enabled: false } } },
                { revision: "rev-test", knownCapabilities: admitting(["triageQueue"]) },
            );
            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.errors.map((e) => e.code)).toEqual(["capabilityUnknown"]);
            }
        }
    });

    /**
     * The same question one level down, for the declared-settings lookup: an
     * inherited member name must not read as a declared key, or `toString:`
     * would be the one settings typo that passes.
     */
    it("an inherited name is not a declared settings key", () => {
        const result = parseConfig(
            {
                schemaVersion: 2,
                capabilities: { triageQueue: { enabled: false, toString: 1 } },
            },
            {
                revision: "rev-test",
                knownCapabilities: [
                    {
                        name: "triageQueue",
                        settings: spec({ announce: flag({ default: false }) }),
                        requiredMappings: {},
                    },
                ],
            },
        );
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.errors.map((e) => e.path)).toEqual(["capabilities.triageQueue.toString"]);
        }
    });

    /**
     * And once more for the mapping table the required-meaning check reads: an
     * unmapped meaning must look unmapped, not inherited-and-therefore-present.
     * Commands, because every label meaning has a default (D203).
     */
    it("an inherited member does not satisfy a required meaning", () => {
        const result = parseConfig(
            JSON.parse(
                '{"schemaVersion":2,"capabilities":{"tracker":{"enabled":true}},"mappings":{"commands":{}}}',
            ),
            {
                revision: "rev-test",
                knownCapabilities: [
                    {
                        name: "tracker",
                        settings: spec({}),
                        requiredMappings: { commands: ["working"] },
                    },
                ],
            },
        );
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.errors.map((e) => e.code)).toEqual(["meaningRequired"]);
    });

    it("returned records are null-prototype — nothing inherited, ever", () => {
        const result = parseConfig(
            {
                schemaVersion: 2,
                capabilities: { prDashboard: { enabled: true } },
                principals: { maintainerTeam: "t" },
            },
            { revision: "rev-test", knownCapabilities: admitting(["prDashboard"]) },
        );
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(Object.getPrototypeOf(result.config.capabilities)).toBe(null);
            expect(Object.getPrototypeOf(result.config.principals)).toBe(null);
        }
    });
});

describe("never throws, for any already-parsed shape", () => {
    const hostile: unknown[] = [
        undefined,
        null,
        0,
        -1,
        Number.NaN,
        "a string",
        true,
        [],
        [1, 2, 3],
        [{ schemaVersion: 2 }],
        { schemaVersion: "1" },
        { schemaVersion: 2, mode: 42 },
        { schemaVersion: 2, capabilities: [] },
        { schemaVersion: 2, capabilities: { a: [] } },
        { schemaVersion: 2, capabilities: { a: { enabled: {}, settings: [] } } },
        { schemaVersion: 2, mappings: [] },
        { schemaVersion: 2, mappings: { labels: [] } },
        { schemaVersion: 2, mappings: { labels: { ready: 7 } } },
        { schemaVersion: 2, mappings: { labels: { ready: null } } },
        { schemaVersion: 2, principals: "team" },
        { schemaVersion: 2, principals: { a: { nested: true } } },
        // Deep nesting in an undeclared setting stays opaque.
        {
            schemaVersion: 2,
            capabilities: {
                a: { enabled: false, deep: { deeper: { deepest: [[[{}]]] } } },
            },
        },
        // Many keys — no quadratic surprise, no throw.
        Object.fromEntries(Array.from({ length: 2000 }, (_, i) => [`k${String(i)}`, i])),
    ];

    /**
     * Totality, not classification: several of these are ACCEPTED, and the
     * claim is only that every one of them comes back as a value. That is
     * why the list is not corpus rows — a row names a code, and half of
     * these have none.
     */
    it.each(hostile.map((value, i) => [i, value]))(
        "shape #%i returns a verdict instead of throwing",
        (_i, value) => {
            const result = parseConfig(value, { revision: "rev-test", knownCapabilities: [] });
            expect(typeof result.ok).toBe("boolean");
            if (!result.ok) {
                expect(result.errors.length).toBeGreaterThan(0);
                // Every error is a sentence, not an empty placeholder.
                for (const { message: error } of result.errors)
                    expect(error.length).toBeGreaterThan(0);
            }
        },
    );

    /**
     * A principal is a handle or a team slug, and the parser judges neither:
     * it takes any non-empty name and hands it on exactly as written. The one
     * place a name becomes a mention (`addressManagedComment`) writes an `@`
     * in front of it and nothing else, so a bare login and an `org/team` slug
     * are the same question to the platform and the repository's own to get
     * right.
     */
    it.each([
        ["a bare login", "alice"],
        ["an org/team slug", "hiero-hackers/maintainers"],
        ["a name the platform has no opinion about", "Maintainers (EU)"],
    ])("a principal that is %s is kept exactly as written", (_why, handle) => {
        const result = parseConfig(
            { schemaVersion: 2, principals: { maintainerTeam: handle } },
            { revision: "rev-test", knownCapabilities: [] },
        );
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.config.principals.maintainerTeam).toBe(handle);
            expect(addressManagedComment("body", "maintainerTeam", result.config.principals)).toBe(
                `@${handle} — body`,
            );
        }
    });

    /**
     * A label is whatever GitHub would accept and the parser does not ask: the
     * only rules are non-empty and injective under the fold. So these parse —
     * and the one place a spelling reaches a comment body renders it through
     * `inert()`, which is `configReport`'s own suite's claim, not this one's.
     */
    it.each([
        ["a label of 256 characters", "a".repeat(256)],
        ["a label with a newline in it", "line one\nline two"],
        ["a label that is a wildcard", "*"],
        ["a label that reads as a mention", "@everyone"],
        ["a label shaped like the App's own marker", "<!-- hiero-automation:v2 -->"],
    ])("%s is the repository's business, and is kept as written", (_why, spelling) => {
        const result = parseConfig(
            { schemaVersion: 2, mappings: { labels: { ready: spelling } } },
            { revision: "rev-test", knownCapabilities: [] },
        );
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.config.mappings.labels.ready).toBe(spelling);
    });

    /**
     * One label namespace, and a command is not in it. The injectivity rules
     * span `labels`, `skills` and `alerts` because those three are all real
     * GitHub labels; a command is text a contributor types in a comment, so
     * the same word under both is two different things with one spelling and
     * nothing to read back wrongly.
     */
    it("the same word may be a label and a command", () => {
        const result = parseConfig(
            {
                schemaVersion: 2,
                mappings: { labels: { ready: "/assign" }, commands: { assign: "/assign" } },
            },
            { revision: "rev-test", knownCapabilities: [] },
        );
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.config.mappings.labels.ready).toBe("/assign");
            expect(result.config.mappings.commands.assign).toBe("/assign");
        }
    });

    /**
     * A bare slash is a command: the rule is a leading `/`, and a spelling
     * that is only that is odd rather than wrong. It is also typeable, which
     * is the whole test a command spelling has to pass.
     */
    it("a command that is only a slash is accepted", () => {
        const result = parseConfig(
            { schemaVersion: 2, mappings: { commands: { assign: "/" } } },
            { revision: "rev-test", knownCapabilities: [] },
        );
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.config.mappings.commands.assign).toBe("/");
    });

    it("accepted entries are exactly the validated entries — nothing vanishes, nothing appears", () => {
        const result = parseConfig(
            {
                schemaVersion: 2,
                capabilities: {
                    prDashboard: { enabled: true },
                    assignment: { enabled: false },
                },
                principals: { a: "x", b: "y" },
            },
            { revision: "rev-test", knownCapabilities: admitting(["prDashboard", "assignment"]) },
        );
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(Object.keys(result.config.capabilities).sort()).toEqual([
                "assignment",
                "prDashboard",
            ]);
            expect(Object.keys(result.config.principals).sort()).toEqual(["a", "b"]);
        }
    });
});
