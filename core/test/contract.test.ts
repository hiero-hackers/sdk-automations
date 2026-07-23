import { describe, it, expect } from "vitest";
import {
    createRegistry,
    validateDeclaration,
    type CapabilityDeclaration,
} from "../src/contract.js";
import { parseConfig } from "../src/config.js";

const prQuality: CapabilityDeclaration = {
    name: "prQuality",
    triggers: [{ kind: "event", event: "pull_request" }],
    configKeys: ["checks"],
    observations: ["prSnapshot"],
    resolvers: [],
    intents: [
        { name: "postSummaryComment", idempotencyClass: "nonIdempotent", requiredPermissions: ["issues:write"] },
        { name: "applyStatusLabel", idempotencyClass: "idempotent", requiredPermissions: ["issues:write"] },
    ],
    permissions: {
        repository: ["issues:write", "pull_requests:read"],
        organization: [],
    },
    operationalNeeds: {
        schedule: false,
        durableState: "required",
        crossItemCoordination: false,
        externalDelivery: false,
    },
};

describe("validateDeclaration (design/modules/contract.md §1 + D23 amendments)", () => {
    it("accepts a well-formed declaration", () => {
        expect(validateDeclaration(prQuality)).toEqual([]);
    });

    it("rejects an intent requiring a permission its capability does not declare", () => {
        const errors = validateDeclaration({
            ...prQuality,
            intents: [{ name: "gate", idempotencyClass: "idempotent", requiredPermissions: ["checks:write"] }],
        });
        expect(errors.join()).toContain('"checks:write"');
        expect(errors.join()).toContain("cannot exceed");
    });

    it("rejects a triggerless capability — dead code cannot be declared", () => {
        const errors = validateDeclaration({ ...prQuality, triggers: [] });
        expect(errors.join()).toContain("at least one trigger");
    });

    it("a schedule trigger must be matched by operationalNeeds.schedule", () => {
        const errors = validateDeclaration({
            ...prQuality,
            triggers: [{ kind: "schedule", description: "daily sweep" }],
        });
        expect(errors.join()).toContain("operationalNeeds.schedule is false");
    });

    it("rejects malformed permission grants and non-config-key names", () => {
        const errors = validateDeclaration({
            ...prQuality,
            name: "PR-Quality",
            permissions: { repository: ["Issues:Write" as never], organization: [] },
            intents: [],
        });
        expect(errors.join()).toContain("camelCase configuration key");
        expect(errors.join()).toContain("scope:level form");
    });

    it("rejects duplicate intent names and config keys", () => {
        const errors = validateDeclaration({
            ...prQuality,
            configKeys: ["checks", "checks"],
            intents: [
                { name: "x", idempotencyClass: "idempotent", requiredPermissions: [] },
                { name: "x", idempotencyClass: "idempotent", requiredPermissions: [] },
            ],
        });
        expect(errors.join()).toContain('duplicate configKeys entry "checks"');
        expect(errors.join()).toContain('duplicate intents entry "x"');
    });
});

describe("createRegistry → parseConfig (FINDING(config-capability-registry-gap) closed end-to-end)", () => {
    it("fails closed on duplicate names or any invalid declaration", () => {
        expect(createRegistry([prQuality, prQuality]).ok).toBe(false);
        expect(createRegistry([{ ...prQuality, triggers: [] }]).ok).toBe(false);
    });

    it("registry names feed parseConfig: the 6.3 escape (enabled unknown capability) is now rejected", () => {
        const result = createRegistry([prQuality]);
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const rejected = parseConfig(
            { schemaVersion: 1, capabilities: { checksGate: { enabled: true } } },
            { knownCapabilities: result.registry.names },
        );
        expect(rejected.ok).toBe(false);

        const accepted = parseConfig(
            { schemaVersion: 1, capabilities: { prQuality: { enabled: true } } },
            { knownCapabilities: result.registry.names },
        );
        expect(accepted.ok).toBe(true);
    });

    it("retirement is a tombstone, not a deletion: enabled-retired configs stay valid but never activate", () => {
        const result = createRegistry([{ ...prQuality, retired: true }]);
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        // The repository that enabled it does NOT drop to observe...
        const config = parseConfig(
            { schemaVersion: 1, capabilities: { prQuality: { enabled: true } } },
            { knownCapabilities: result.registry.names },
        );
        expect(config.ok).toBe(true);

        // ...but the capability can never activate.
        expect(result.registry.activeNames).not.toContain("prQuality");
        expect(result.registry.names).toContain("prQuality");
    });

    it("get() returns the declaration configuration validation will interrogate", () => {
        const result = createRegistry([prQuality]);
        if (!result.ok) throw new Error("registry should build");
        expect(result.registry.get("prQuality")?.intents[0]?.idempotencyClass).toBe("nonIdempotent");
        expect(result.registry.get("missing")).toBeUndefined();
    });
});
