/**
 * Adversarial-input tests for parseConfig: the config file is
 * repository-controlled content, so hostile keys and absurd shapes are
 * inputs, not edge cases. Two properties under attack:
 *  - "Pure; never throws" holds for ANY already-parsed value;
 *  - nothing validated ever silently vanishes from the result
 *    (the `__proto__` assignment hole: a plain `obj[key] = value`
 *    both pollutes the prototype and loses the entry).
 */
import { describe, it, expect } from "vitest";
import { parseConfig } from "../../src/config/index.js";

describe("hostile keys (the __proto__ hole)", () => {
    it("rejects a capability named __proto__ instead of losing it after validation", () => {
        // Before the fix this passed validation, vanished from the
        // result, AND replaced the capabilities object's prototype.
        const raw = JSON.parse('{"schemaVersion":1,"capabilities":{"__proto__":{"enabled":true}}}');
        const result = parseConfig(raw, { revision: "rev-test", knownCapabilities: [] });
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.errors.map((e) => e.message).join()).toContain(
                "not a valid configuration key",
            );
        }
    });

    it.each(["a.b", "kebab-case", "PascalCase", "_private", ""])(
        "rejects capability key %j — not a shippable capability name",
        (name) => {
            const result = parseConfig(
                {
                    schemaVersion: 1,
                    capabilities: { [name]: { enabled: false } },
                },
                { revision: "rev-test", knownCapabilities: [] },
            );
            expect(result.ok).toBe(false);
        },
    );

    it("Object.prototype member names are ordinary keys, and absent lookups are undefined", () => {
        // `constructor` is valid camelCase — it may exist as config.
        // What must NEVER happen is an inherited member masquerading
        // as configuration when the name is absent.
        const result = parseConfig(
            {
                schemaVersion: 1,
                capabilities: { constructor: { enabled: false } },
            },
            { revision: "rev-test", knownCapabilities: [] },
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

    it("a __proto__ principal survives as an own property — never pollution, never loss", () => {
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

    it("__proto__ as a top-level or mapping key is an ordinary rejected unknown key", () => {
        const top = parseConfig(JSON.parse('{"schemaVersion":1,"__proto__":{"mode":"active"}}'), {
            revision: "rev-test",
            knownCapabilities: [],
        });
        expect(top.ok).toBe(false);
        const mapping = parseConfig(
            JSON.parse('{"schemaVersion":1,"mappings":{"labels":{"__proto__":"x"}}}'),
            { revision: "rev-test", knownCapabilities: [] },
        );
        expect(mapping.ok).toBe(false);
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

    it("rejects null nested mappings instead of treating them as objects", () => {
        const result = parseConfig(
            {
                schemaVersion: 1,
                capabilities: { assignment: null },
            },
            { revision: "rev-test", knownCapabilities: [] },
        );
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.errors.map((e) => e.message).join()).toContain(
                'capability "assignment" must be a mapping',
            );
        }
    });

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

    it("non-mapping shapes are rejected with their NAMED error, not incidentally", () => {
        // Each wrong shape must trip its own guard — not fall through
        // to whatever later check happens to also fail.
        const cases: readonly [unknown, string][] = [
            ["a string", "configuration must be a mapping"],
            [[], "configuration must be a mapping"],
            [{ schemaVersion: 1, capabilities: [] }, "capabilities must be a mapping"],
            [{ schemaVersion: 1, capabilities: { a: [] } }, 'capability "a" must be a mapping'],
            [
                { schemaVersion: 1, capabilities: { a: { settings: [] } } },
                "settings must be a mapping",
            ],
            [{ schemaVersion: 1, mappings: [] }, "mappings must be a mapping"],
            [{ schemaVersion: 1, mappings: { labels: [] } }, "mappings.labels must be a mapping"],
            [{ schemaVersion: 1, principals: [] }, "principals must be a mapping"],
            [{ schemaVersion: 1, principals: { a: 1 } }, "principals.a: must be a string"],
        ];
        for (const [raw, message] of cases) {
            const result = parseConfig(raw, { revision: "rev-test", knownCapabilities: [] });
            expect(result.ok).toBe(false);
            if (!result.ok) expect(result.errors.map((e) => e.message).join()).toContain(message);
        }
    });

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
