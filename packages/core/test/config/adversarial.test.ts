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
import { parseConfig } from "../../src/config/index.js";

describe("hostile keys survive as data, never as prototype", () => {
    /**
     * `constructor` is valid camelCase, so it may legitimately be a
     * capability. What must NEVER happen is an inherited member
     * masquerading as configuration when the name is absent.
     */
    it("Object.prototype member names are ordinary keys, and absent lookups are undefined", () => {
        const result = parseConfig(
            {
                schemaVersion: 1,
                capabilities: { constructor: { enabled: false } },
            },
            { revision: "rev-test", knownCapabilities: ["constructor"] },
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
     * Principal names are not pattern-checked, so `__proto__` is ACCEPTED
     * here — which makes this the one place the assignment hole is reachable
     * on a success path. It must land as an own property and leave the
     * prototype alone: never pollution, never loss.
     */
    it("a __proto__ principal survives as an own property", () => {
        const raw = JSON.parse('{"schemaVersion":1,"principals":{"__proto__":"team-x"}}');
        const result = parseConfig(raw, { revision: "rev-test", knownCapabilities: [] });
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(
                Object.prototype.hasOwnProperty.call(result.config.principals, "__proto__"),
            ).toBe(true);
            expect(Object.entries(result.config.principals)).toEqual([["__proto__", "team-x"]]);
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
                { schemaVersion: 1, capabilities: { [name]: { enabled: false } } },
                { revision: "rev-test", knownCapabilities: ["intake"] },
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
                schemaVersion: 1,
                capabilities: { intake: { enabled: false, settings: { toString: 1 } } },
            },
            {
                revision: "rev-test",
                knownCapabilities: [
                    { name: "intake", configKeys: ["announce"], requiredMeanings: [] },
                ],
            },
        );
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.errors.map((e) => e.path)).toEqual([
                "capabilities.intake.settings.toString",
            ]);
        }
    });

    /**
     * And once more for the label table the required-meaning check reads: an
     * unmapped meaning must look unmapped, not inherited-and-therefore-present.
     */
    it("an inherited member does not satisfy a required meaning", () => {
        const result = parseConfig(
            JSON.parse(
                '{"schemaVersion":1,"capabilities":{"intake":{"enabled":true}},"mappings":{"labels":{}}}',
            ),
            {
                revision: "rev-test",
                knownCapabilities: [
                    {
                        name: "intake",
                        configKeys: [],
                        requiredMeanings: ["awaitingTriage"],
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
                schemaVersion: 1,
                capabilities: { prQuality: { enabled: true } },
                principals: { maintainerTeam: "t" },
            },
            { revision: "rev-test", knownCapabilities: ["prQuality"] },
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
        [{ schemaVersion: 1 }],
        { schemaVersion: "1" },
        { schemaVersion: 1, mode: 42 },
        { schemaVersion: 1, capabilities: [] },
        { schemaVersion: 1, capabilities: { a: [] } },
        { schemaVersion: 1, capabilities: { a: { enabled: {}, settings: [] } } },
        { schemaVersion: 1, mappings: [] },
        { schemaVersion: 1, mappings: { labels: [] } },
        { schemaVersion: 1, mappings: { labels: { ready: 7 } } },
        { schemaVersion: 1, mappings: { labels: { ready: null } } },
        { schemaVersion: 1, principals: "team" },
        { schemaVersion: 1, principals: { a: { nested: true } } },
        // Deep nesting in the opaque settings blob stays opaque.
        {
            schemaVersion: 1,
            capabilities: {
                a: { enabled: false, settings: { deep: { deeper: { deepest: [[[{}]]] } } } },
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

    it("accepted entries are exactly the validated entries — nothing vanishes, nothing appears", () => {
        const result = parseConfig(
            {
                schemaVersion: 1,
                capabilities: {
                    prQuality: { enabled: true },
                    assignment: { enabled: false },
                },
                principals: { a: "x", b: "y" },
            },
            { revision: "rev-test", knownCapabilities: ["prQuality", "assignment"] },
        );
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(Object.keys(result.config.capabilities).sort()).toEqual([
                "assignment",
                "prQuality",
            ]);
            expect(Object.keys(result.config.principals).sort()).toEqual(["a", "b"]);
        }
    });
});
