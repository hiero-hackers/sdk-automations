import { describe, it, expect } from "vitest";
import { parseConfig, NO_CONFIG } from "../../src/config/index.js";

describe("parseConfig (design/config/schema.md)", () => {
    it("no configuration yields the safe default — observe mode, nothing enabled (§2.2)", () => {
        for (const raw of [undefined, null]) {
            const result = parseConfig(raw, { revision: "rev-test", knownCapabilities: [] });
            /**
             * The safe default still carries the revision it was read at
             * (D77): "there was no file at this commit" is a fact worth
             * keeping, and an operator report that cannot say WHEN nothing
             * was found is not evidence of anything.
             */
            expect(result).toEqual({
                ok: true,
                config: { ...NO_CONFIG, revision: "rev-test" },
            });
        }
        // Assert NO_CONFIG's literal shape, not just against itself —
        // a mutation of the constant must fail HERE, not vanish into
        // both sides of the equality above.
        expect(NO_CONFIG.mode).toBe("observe");
        expect(Object.keys(NO_CONFIG.capabilities)).toHaveLength(0);
        expect(Object.keys(NO_CONFIG.principals)).toHaveLength(0);
        expect(NO_CONFIG.mappings).toEqual({ labels: {} });
        expect(NO_CONFIG.schemaVersion).toBe(1);
    });

    it("accepts the documented candidate shape (§3)", () => {
        const result = parseConfig(
            {
                schemaVersion: 1,
                mode: "observe",
                capabilities: {
                    prQuality: {
                        enabled: true,
                        settings: { checks: { dco: true, mergeConflict: true } },
                    },
                    assignment: { enabled: false, settings: { maxOpenAssignments: 2 } },
                },
                mappings: {
                    labels: {
                        ready: "status: ready for dev",
                        inProgress: "status: in progress",
                    },
                },
                principals: { maintainerTeam: "hiero-sdk-cpp-maintainers" },
            },
            { revision: "rev-test", knownCapabilities: ["prQuality", "assignment"] },
        );
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.config.capabilities.prQuality?.enabled).toBe(true);
            expect(result.config.capabilities.assignment?.enabled).toBe(false);
            expect(result.config.mappings.labels.ready).toBe("status: ready for dev");
        }
    });

    it("rejects unknown top-level keys (§2.7 — misspellings must not silently change behavior)", () => {
        const result = parseConfig(
            { schemaVersion: 1, mode: "observe", capabilties: {} },
            { revision: "rev-test", knownCapabilities: [] },
        );
        expect(result.ok).toBe(false);
        if (!result.ok)
            expect(result.errors.map((e) => e.message).join()).toContain(
                'unknown key "capabilties"',
            );
    });

    it("rejects unknown capability keys and unknown mapping meanings", () => {
        const result = parseConfig(
            {
                schemaVersion: 1,
                capabilities: { intake: { enable: true } },
                mappings: { labels: { readyForDev: "status: ready" } },
            },
            { revision: "rev-test", knownCapabilities: [] },
        );
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.errors.map((e) => e.message).join()).toContain('unknown key "enable"');
            expect(result.errors.map((e) => e.message).join()).toContain(
                '"readyForDev" is not a mappable meaning',
            );
        }
    });

    it("fails closed: one error yields no config at all (§2.6)", () => {
        const result = parseConfig(
            {
                schemaVersion: 1,
                mode: "actively", // invalid
                capabilities: { prQuality: { enabled: true } }, // valid
            },
            { revision: "rev-test", knownCapabilities: [] },
        );
        expect(result.ok).toBe(false);
        // The message lists the legal modes, readably separated.
        if (!result.ok)
            expect(result.errors.map((e) => e.message).join()).toContain(
                "disabled, observe, dry-run, active",
            );
        // No partially-applied config object exists on the failure arm.
        expect("config" in result).toBe(false);
    });

    it("rejects unknown keys under mappings", () => {
        const result = parseConfig(
            {
                schemaVersion: 1,
                mappings: { fields: {} },
            },
            { revision: "rev-test", knownCapabilities: [] },
        );
        expect(result.ok).toBe(false);
        if (!result.ok)
            expect(result.errors.map((e) => e.message).join()).toContain(
                'mappings: unknown key "fields"',
            );
    });

    it("only boolean true enables a capability — truthiness is not consent (§2.4)", () => {
        for (const enabled of [1, "true", "yes"]) {
            const result = parseConfig(
                {
                    schemaVersion: 1,
                    capabilities: { intake: { enabled } },
                },
                { revision: "rev-test", knownCapabilities: ["intake"] },
            );
            expect(result.ok).toBe(false);
        }
        const omitted = parseConfig(
            {
                schemaVersion: 1,
                capabilities: { intake: { settings: {} } },
            },
            { revision: "rev-test", knownCapabilities: ["intake"] },
        );
        expect(omitted.ok).toBe(true);
        if (omitted.ok) expect(omitted.config.capabilities.intake?.enabled).toBe(false);
    });

    it("rejects a wrong or missing schemaVersion", () => {
        expect(
            parseConfig({ mode: "observe" }, { revision: "rev-test", knownCapabilities: [] }).ok,
        ).toBe(false);
        expect(
            parseConfig({ schemaVersion: 2 }, { revision: "rev-test", knownCapabilities: [] }).ok,
        ).toBe(false);
    });

    it("rejects empty label mappings", () => {
        const result = parseConfig(
            {
                schemaVersion: 1,
                mappings: { labels: { ready: "  " } },
            },
            { revision: "rev-test", knownCapabilities: [] },
        );
        expect(result.ok).toBe(false);
    });

    // FINDING(config-label-injectivity)
    it("rejects two meanings mapped to one label — label→meaning must be unambiguous (§3)", () => {
        const result = parseConfig(
            {
                schemaVersion: 1,
                mappings: {
                    labels: {
                        ready: "status: wip",
                        inProgress: "status: wip",
                    },
                },
            },
            { revision: "rev-test", knownCapabilities: [] },
        );
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.errors.map((e) => e.message).join()).toContain('"status: wip"');
            expect(result.errors.map((e) => e.message).join()).toContain("injective");
        }
    });

    it("injectivity applies across entities too — the strict reading, pending D34", () => {
        const result = parseConfig(
            {
                schemaVersion: 1,
                mappings: {
                    labels: {
                        ready: "attention",
                        needsReview: "attention",
                    },
                },
            },
            { revision: "rev-test", knownCapabilities: [] },
        );
        expect(result.ok).toBe(false);
    });
});

describe("direct capability admission", () => {
    const available = ["prQuality", "assignment"];

    it("rejects an unknown capability and lists available names", () => {
        const result = parseConfig(
            { schemaVersion: 1, capabilities: { checksGate: { enabled: true } } },
            { revision: "rev-test", knownCapabilities: available },
        );
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.errors.map((e) => e.message).join()).toContain('"checksGate"');
            expect(result.errors.map((e) => e.message).join()).toContain("not available");
            expect(result.errors.map((e) => e.message).join()).toContain("assignment, prQuality");
        }
    });

    it("an empty available set says 'none' rather than showing a blank list", () => {
        const result = parseConfig(
            { schemaVersion: 1, capabilities: { prQuality: { enabled: true } } },
            { revision: "rev-test", knownCapabilities: [] },
        );
        expect(result.ok).toBe(false);
        if (!result.ok)
            expect(result.errors.map((e) => e.message).join()).toContain("available: none");
    });

    it("rejects a disabled unknown capability instead of retaining a tombstone", () => {
        const result = parseConfig(
            {
                schemaVersion: 1,
                capabilities: { removedProbe: { enabled: false, settings: { old: 1 } } },
            },
            { revision: "rev-test", knownCapabilities: available },
        );
        expect(result).toMatchObject({
            ok: false,
            errors: [{ code: "capabilityUnknown", path: "capabilities.removedProbe" }],
        });
    });

    /**
     * An empty direct list rejects every capability. `knownCapabilities` is
     * required, so omission remains a compile error and `[]` a stated choice.
     */
    it("an empty direct list fails closed", () => {
        const result = parseConfig(
            {
                schemaVersion: 1,
                capabilities: { checksGate: { enabled: true } },
            },
            { revision: "rev-test", knownCapabilities: [] },
        );
        expect(result.ok).toBe(false);
        if (!result.ok)
            expect(result.errors.map((e) => e.message).join()).toContain("(available: none)");
    });

    it("an unknown-capability rejection fails closed like every other error (§2.6)", () => {
        const result = parseConfig(
            {
                schemaVersion: 1,
                capabilities: {
                    prQuality: { enabled: true }, // valid
                    checksGate: { enabled: true }, // not shipped
                },
            },
            { revision: "rev-test", knownCapabilities: available },
        );
        expect(result.ok).toBe(false);
        expect("config" in result).toBe(false);
    });
});

describe("audit findings, pinned (D55-D56)", () => {
    /**
     * D55 — GitHub treats label names case-insensitively for uniqueness,
     * so exact-string injectivity let two meanings share ONE real label,
     * reintroducing the label→meaning ambiguity D34 exists to prevent.
     */
    it.each([
        ["case", "status: ready", "Status: Ready"],
        ["surrounding space", "status: ready", "  status: ready  "],
        ["both", "Status: Ready", " status: ready "],
    ])("rejects two meanings whose labels differ only in %s", (_name, a, b) => {
        const result = parseConfig(
            {
                schemaVersion: 1,
                mappings: { labels: { ready: a, needsReview: b } },
            },
            { revision: "rev-test", knownCapabilities: [] },
        );
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.errors.map((e) => e.message).join()).toContain("injective");
            expect(result.errors.map((e) => e.message).join()).toContain(
                "GitHub treats as the same label",
            );
        }
    });

    it("genuinely distinct labels still pass, with their spelling preserved", () => {
        const result = parseConfig(
            {
                schemaVersion: 1,
                mappings: {
                    labels: { ready: "Status: Ready", needsReview: "status: needs review" },
                },
            },
            { revision: "rev-test", knownCapabilities: [] },
        );
        expect(result.ok).toBe(true);
        // The original casing is what the App must write to GitHub.
        if (result.ok) expect(result.config.mappings.labels.ready).toBe("Status: Ready");
    });

    // D56 — absent defaults; present-but-empty is an error.
    it("an absent mode defaults to observe", () => {
        const result = parseConfig(
            { schemaVersion: 1 },
            { revision: "rev-test", knownCapabilities: [] },
        );
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.config.mode).toBe("observe");
    });

    it.each([null, ""])(
        "a present but empty mode (%s) is rejected, not silently chosen",
        (mode) => {
            const result = parseConfig(
                { schemaVersion: 1, mode },
                { revision: "rev-test", knownCapabilities: [] },
            );
            expect(result.ok).toBe(false);
        },
    );

    it("rejects inherited configuration properties instead of activating them", () => {
        const raw = Object.assign(Object.create({ mode: "active" }), { schemaVersion: 1 });
        const result = parseConfig(raw, { revision: "rev-test", knownCapabilities: [] });
        expect(result.ok).toBe(false);
        if (!result.ok) {
            // The CODE is the contract; the wording is not (D75).
            expect(result.errors).toEqual([
                expect.objectContaining({ code: "notAMapping", path: null }),
            ]);
        }
    });
});

describe("every error names its kind and its place (D75)", () => {
    /**
     * The path is what lets a check run annotate a line instead of pasting a
     * paragraph, so it is contract and is asserted here. The MESSAGE is not —
     * same convention `safety.test.ts` holds over verdict reasons.
     */
    const only = (raw: unknown, known: readonly string[] = ["intake"]) => {
        const result = parseConfig(raw, { revision: "r", knownCapabilities: known });
        if (result.ok) throw new Error("expected the document to be rejected");
        return result.errors;
    };

    const base = {
        schemaVersion: 1,
        mode: "active",
        capabilities: {},
        mappings: { labels: {} },
        principals: {},
    };

    it.each([
        ["top-level key", { ...base, stray: 1 }, "unknownKey", "stray"],
        [
            "schema version",
            { ...base, schemaVersion: 2 },
            "schemaVersionUnsupported",
            "schemaVersion",
        ],
        ["mode", { ...base, mode: "sideways" }, "modeInvalid", "mode"],
        ["capabilities shape", { ...base, capabilities: 3 }, "notAMapping", "capabilities"],
        [
            "capability name",
            { ...base, capabilities: { "not-camel": { enabled: true } } },
            "capabilityNameInvalid",
            "capabilities.not-camel",
        ],
        [
            "capability key",
            { ...base, capabilities: { intake: { enabled: true, stray: 1 } } },
            "unknownKey",
            "capabilities.intake.stray",
        ],
        [
            "enabled type",
            { ...base, capabilities: { intake: { enabled: "yes" } } },
            "capabilityEnabledNotBoolean",
            "capabilities.intake.enabled",
        ],
        [
            "unknown capability",
            { ...base, capabilities: { ghost: { enabled: true } } },
            "capabilityUnknown",
            "capabilities.ghost",
        ],
        [
            "mappable meaning",
            { ...base, mappings: { labels: { nonsense: "x" } } },
            "meaningNotMappable",
            "mappings.labels.nonsense",
        ],
        [
            "label value",
            { ...base, mappings: { labels: { ready: "  " } } },
            "labelInvalid",
            "mappings.labels.ready",
        ],
        [
            "injectivity",
            { ...base, mappings: { labels: { ready: "x", inProgress: "x" } } },
            "labelNotInjective",
            "mappings.labels.inProgress",
        ],
        [
            "principal type",
            { ...base, principals: { reviewer: 3 } },
            "principalNotAString",
            "principals.reviewer",
        ],
    ])("%s", (_name, raw, code, path) => {
        const errors = only(raw);
        const match = errors.find((e) => e.code === code);
        expect(match, `no ${code} among ${errors.map((e) => e.code).join(", ")}`).toBeDefined();
        expect(match!.path).toBe(path);
        expect(match!.message.length).toBeGreaterThan(0);
    });

    it("a whole-document problem has no path to point at", () => {
        const [e] = only("not a mapping at all");
        expect(e).toMatchObject({ code: "notAMapping", path: null });
    });
});

describe("NO_CONFIG is inert all the way down", () => {
    it("carries the empty revision — the parser stamps the real one", () => {
        // `parseConfig` spreads NO_CONFIG and overwrites `revision` from its
        // options, so this literal is only ever visible to code that uses
        // NO_CONFIG directly — which must be able to tell it from any parsed
        // configuration, and "" is that sentinel.
        expect(NO_CONFIG.revision).toBe("");
    });
});
