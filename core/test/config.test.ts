import { describe, it, expect } from "vitest";
import { parseConfig, NO_CONFIG } from "../src/config.js";

describe("parseConfig (design/config/schema.md)", () => {
    it("no configuration yields the safe default — observe mode, nothing enabled (§2.2)", () => {
        for (const raw of [undefined, null]) {
            const result = parseConfig(raw);
            expect(result).toEqual({ ok: true, config: NO_CONFIG });
        }
        expect(NO_CONFIG.mode).toBe("observe");
        expect(Object.keys(NO_CONFIG.capabilities)).toHaveLength(0);
    });

    it("accepts the documented candidate shape (§3)", () => {
        const result = parseConfig({
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
        });
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.config.capabilities.prQuality?.enabled).toBe(true);
            expect(result.config.capabilities.assignment?.enabled).toBe(false);
            expect(result.config.mappings.labels.ready).toBe("status: ready for dev");
        }
    });

    it("rejects unknown top-level keys (§2.7 — misspellings must not silently change behavior)", () => {
        const result = parseConfig({ schemaVersion: 1, mode: "observe", capabilties: {} });
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.errors.join()).toContain('unknown key "capabilties"');
    });

    it("rejects unknown capability keys and unknown mapping meanings", () => {
        const result = parseConfig({
            schemaVersion: 1,
            capabilities: { intake: { enable: true } },
            mappings: { labels: { readyForDev: "status: ready" } },
        });
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.errors.join()).toContain('unknown key "enable"');
            expect(result.errors.join()).toContain('"readyForDev" is not a mappable meaning');
        }
    });

    it("fails closed: one error yields no config at all (§2.6)", () => {
        const result = parseConfig({
            schemaVersion: 1,
            mode: "actively", // invalid
            capabilities: { prQuality: { enabled: true } }, // valid
        });
        expect(result.ok).toBe(false);
        // No partially-applied config object exists on the failure arm.
        expect("config" in result).toBe(false);
    });

    it("only boolean true enables a capability — truthiness is not consent (§2.4)", () => {
        for (const enabled of [1, "true", "yes"]) {
            const result = parseConfig({
                schemaVersion: 1,
                capabilities: { intake: { enabled } },
            });
            expect(result.ok).toBe(false);
        }
        const omitted = parseConfig({
            schemaVersion: 1,
            capabilities: { intake: { settings: {} } },
        });
        expect(omitted.ok).toBe(true);
        if (omitted.ok) expect(omitted.config.capabilities.intake?.enabled).toBe(false);
    });

    it("rejects a wrong or missing schemaVersion", () => {
        expect(parseConfig({ mode: "observe" }).ok).toBe(false);
        expect(parseConfig({ schemaVersion: 2 }).ok).toBe(false);
    });

    it("rejects empty label mappings", () => {
        const result = parseConfig({
            schemaVersion: 1,
            mappings: { labels: { ready: "  " } },
        });
        expect(result.ok).toBe(false);
    });
});

describe("capability registry (FINDING(config-capability-registry-gap), experiment 6.3)", () => {
    const registry = ["prQuality", "assignment"];

    it("rejects an enabled capability outside the registry, naming it and the registry", () => {
        const result = parseConfig(
            { schemaVersion: 1, capabilities: { checksGate: { enabled: true } } },
            { knownCapabilities: registry },
        );
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.errors.join()).toContain('"checksGate"');
            expect(result.errors.join()).toContain("capability registry");
        }
    });

    it("keeps a disabled unknown capability dormant — removing a shipped capability must not break configs that still mention it", () => {
        const result = parseConfig(
            { schemaVersion: 1, capabilities: { retired: { enabled: false, settings: { old: 1 } } } },
            { knownCapabilities: registry },
        );
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.config.capabilities.retired?.enabled).toBe(false);
    });

    it("without a registry the 6.3-observed contract is unchanged: unknown enabled capabilities pass", () => {
        const result = parseConfig({
            schemaVersion: 1,
            capabilities: { checksGate: { enabled: true } },
        });
        expect(result.ok).toBe(true);
    });

    it("a registry rejection fails closed like every other error (§2.6)", () => {
        const result = parseConfig(
            {
                schemaVersion: 1,
                capabilities: {
                    prQuality: { enabled: true }, // valid
                    checksGate: { enabled: true }, // not shipped
                },
            },
            { knownCapabilities: registry },
        );
        expect(result.ok).toBe(false);
        expect("config" in result).toBe(false);
    });
});
