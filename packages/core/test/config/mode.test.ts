import { describe, expect, it } from "vitest";
import {
    anyCapabilityActive,
    effectiveMode,
    loweredTo,
    NO_CONFIG,
    type CapabilityConfig,
    type RepositoryConfig,
    type RepositoryMode,
} from "../../src/config/index.js";
import { configWith } from "./builders.js";

/** A configuration no parser built, for the rules that must hold without one. */
function byHand(
    mode: RepositoryMode,
    capabilities: Readonly<Record<string, CapabilityConfig>>,
): RepositoryConfig {
    return { ...NO_CONFIG, mode, capabilities };
}

describe("effectiveMode", () => {
    const config = configWith({
        mode: "active",
        capabilities: ["triageQueue", "prDashboard"],
        modes: { triageQueue: "dry-run" },
    });

    it("is the block's mode where the block stated one", () => {
        expect(effectiveMode(config, "triageQueue")).toEqual({ mode: "dry-run", source: "stated" });
    });

    it("is the file's mode where the block is silent", () => {
        expect(effectiveMode(config, "prDashboard")).toEqual({
            mode: "active",
            source: "inherited",
        });
    });

    it("is the file's mode for a capability with no block at all", () => {
        expect(effectiveMode(config, "inactivity")).toEqual({
            mode: "active",
            source: "inherited",
        });
    });

    it("never lets a block above the file win, even in a configuration built by hand", () => {
        const escaped = byHand("dry-run", {
            triageQueue: { enabled: true, mode: "active", settings: {} },
        });
        expect(effectiveMode(escaped, "triageQueue")).toEqual({
            mode: "dry-run",
            source: "inherited",
        });
    });

    it("keeps a stated mode equal to the file's as stated", () => {
        const pinned = configWith({
            mode: "dry-run",
            capabilities: ["triageQueue"],
            modes: { triageQueue: "dry-run" },
        });
        expect(effectiveMode(pinned, "triageQueue").source).toBe("stated");
    });
});

describe("anyCapabilityActive", () => {
    it("is true when an enabled capability inherits active", () => {
        expect(anyCapabilityActive(configWith({ capabilities: ["triageQueue"] }))).toBe(true);
    });

    it("is true when one enabled capability states active beside one held back", () => {
        const config = configWith({
            capabilities: ["triageQueue", "prDashboard"],
            modes: { triageQueue: "active", prDashboard: "observe" },
        });
        expect(anyCapabilityActive(config)).toBe(true);
    });

    it("is false under an active file when every enabled block states less", () => {
        const config = configWith({
            capabilities: ["triageQueue", "prDashboard"],
            modes: { triageQueue: "dry-run", prDashboard: "observe" },
        });
        expect(anyCapabilityActive(config)).toBe(false);
    });

    it("is false when the only active block is switched off", () => {
        expect(
            anyCapabilityActive(configWith({ capabilities: ["triageQueue"], enabled: false })),
        ).toBe(false);
    });

    it("is false under an active file that enables nothing", () => {
        expect(anyCapabilityActive(configWith({ mode: "active" }))).toBe(false);
    });

    it("is false under a dry-run file, whatever a hand-built block says", () => {
        const escaped = byHand("dry-run", {
            triageQueue: { enabled: true, mode: "active", settings: {} },
        });
        expect(anyCapabilityActive(escaped)).toBe(false);
    });
});

describe("loweredTo", () => {
    const config = configWith({
        mode: "active",
        capabilities: ["triageQueue", "prDashboard", "inactivity"],
        modes: { triageQueue: "active", prDashboard: "observe" },
    });
    const lowered = loweredTo(config, "dry-run");

    it("lowers the file and every stated mode above the ceiling", () => {
        expect(lowered.mode).toBe("dry-run");
        expect(lowered.capabilities.triageQueue?.mode).toBe("dry-run");
        expect(anyCapabilityActive(lowered)).toBe(false);
    });

    it("leaves a stated mode already below the ceiling, and a silent block silent", () => {
        expect(lowered.capabilities.prDashboard?.mode).toBe("observe");
        expect(Object.hasOwn(lowered.capabilities.inactivity ?? {}, "mode")).toBe(false);
    });

    it("leaves a file already below the ceiling where it was", () => {
        expect(loweredTo(configWith({ mode: "observe" }), "dry-run").mode).toBe("observe");
    });

    it("changes nothing else, and not the configuration it was given", () => {
        expect(lowered.capabilities.triageQueue?.enabled).toBe(true);
        expect(lowered.revision).toBe(config.revision);
        expect(config.mode).toBe("active");
        expect(config.capabilities.triageQueue?.mode).toBe("active");
    });

    it("keeps a missing name missing, as the parser's record does", () => {
        expect(lowered.capabilities["constructor"]).toBeUndefined();
    });
});
