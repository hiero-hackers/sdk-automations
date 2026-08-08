import { describe, it, expect } from "vitest";
import {
    createRegistry,
    validateDeclaration,
    type CapabilityDeclaration,
} from "../../src/capability/index.js";
import { parseConfig } from "../../src/config/index.js";

const prQuality: CapabilityDeclaration = {
    name: "prQuality",
    triggers: [{ kind: "event", event: "pull_request" }],
    configKeys: ["checks"],
    observations: ["pullRequestUpdated"],
    resolvers: [],
    intents: [
        {
            name: "postManagedComment",
            idempotencyClass: "nonIdempotent",
            requiredPermissions: ["issues:write"],
        },
        {
            name: "applyMappedLabel",
            idempotencyClass: "idempotent",
            requiredPermissions: ["issues:write"],
        },
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
            intents: [
                {
                    name: "gate",
                    idempotencyClass: "idempotent",
                    requiredPermissions: ["checks:write"],
                },
            ],
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

    it("fails closed when an operation's idempotency class contradicts the catalogue", () => {
        const result = createRegistry([
            {
                ...prQuality,
                intents: [
                    {
                        name: "postManagedComment",
                        idempotencyClass: "idempotent",
                        requiredPermissions: ["issues:write"],
                    },
                ],
            },
        ]);
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.errors.join()).toContain("the platform owns this fact");
        }
    });

    it("fails closed when an intent omits its operation-owned permission", () => {
        const result = createRegistry([
            {
                ...prQuality,
                intents: [
                    {
                        name: "applyMappedLabel",
                        idempotencyClass: "idempotent",
                        requiredPermissions: [],
                    },
                ],
            },
        ]);
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.errors.join()).toContain('must require "issues:write"');
        }
    });

    it("fails closed on names outside the closed catalogues", () => {
        const result = createRegistry([
            {
                ...prQuality,
                observations: ["unknownObservation"],
                resolvers: ["unknownResolver"],
                intents: [
                    {
                        name: "unknownOperation",
                        idempotencyClass: "idempotent",
                        requiredPermissions: [],
                    },
                ],
            },
        ]);
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.errors.join()).toContain("unknownObservation");
            expect(result.errors.join()).toContain("unknownResolver");
            expect(result.errors.join()).toContain("unknownOperation");
        }
    });

    it("registry names feed parseConfig: the 6.3 escape (enabled unknown capability) is now rejected", () => {
        const result = createRegistry([prQuality]);
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const rejected = parseConfig(
            { schemaVersion: 1, capabilities: { checksGate: { enabled: true } } },
            { revision: "rev-test", knownCapabilities: result.registry.names },
        );
        expect(rejected.ok).toBe(false);

        const accepted = parseConfig(
            { schemaVersion: 1, capabilities: { prQuality: { enabled: true } } },
            { revision: "rev-test", knownCapabilities: result.registry.names },
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
            { revision: "rev-test", knownCapabilities: result.registry.names },
        );
        expect(config.ok).toBe(true);

        // ...but the capability can never activate.
        expect(result.registry.activeNames).not.toContain("prQuality");
        expect(result.registry.names).toContain("prQuality");
    });

    it("get() returns the declaration configuration validation will interrogate", () => {
        const result = createRegistry([prQuality]);
        if (!result.ok) throw new Error("registry should build");
        expect(result.registry.get("prQuality")?.intents[0]?.idempotencyClass).toBe(
            "nonIdempotent",
        );
        expect(result.registry.get("missing")).toBeUndefined();
    });

    // Mutation-testing survivors, now pinned:
    it("a live capability appears in activeNames — the positive case, not just retired-absence", () => {
        const result = createRegistry([prQuality]);
        if (!result.ok) throw new Error("registry should build");
        expect(result.registry.activeNames).toEqual(["prQuality"]);
    });

    it("duplicate registry names are named in the error", () => {
        const result = createRegistry([prQuality, prQuality]);
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.errors.join()).toContain('duplicate capability name "prQuality"');
        }
    });

    it("permission grants are anchored at BOTH ends — junk around a valid grant is junk", () => {
        // Without ^, "X issues:write" matches its trailing substring;
        // without $, "issues:writeEverything" matches its prefix.
        for (const grant of ["X issues:write", "issues:writeEverything"]) {
            const errors = validateDeclaration({
                ...prQuality,
                permissions: { repository: [grant as never], organization: [] },
                intents: [],
            });
            expect(errors.join()).toContain("scope:level form");
        }
    });

    it("errors name the capability they belong to", () => {
        const errors = validateDeclaration({ ...prQuality, triggers: [] });
        expect(errors.join()).toContain(`capability "prQuality": at least one trigger`);
    });

    it("ANY schedule trigger among mixed triggers demands operationalNeeds.schedule", () => {
        // `some`, not `every`: one schedule trigger alongside event
        // triggers still requires the declared operational need.
        const errors = validateDeclaration({
            ...prQuality,
            triggers: [
                { kind: "event", event: "pull_request.opened" },
                { kind: "schedule", description: "nightly sweep" },
            ],
            operationalNeeds: { ...prQuality.operationalNeeds, schedule: false },
        });
        expect(errors.join()).toContain("operationalNeeds.schedule is false");
    });
});

describe("audit findings, pinned (D57-D58)", () => {
    const base = {
        triggers: [{ kind: "event", event: "issues.opened" }],
        configKeys: [],
        observations: [],
        resolvers: [],
        operationalNeeds: {
            schedule: false,
            durableState: "none",
            crossItemCoordination: false,
            externalDelivery: false,
        },
    } as const;

    /**
     * D57 — the declared set is repository AND organization grants. It
     * used to be repository only, so an org-scoped intent was rejected
     * with "which the capability does not declare" even though the
     * capability declared it. `progression` needs org-wide data, so this
     * would have blocked a real capability.
     */
    it("an intent may require a grant declared under organization", () => {
        const declaration = {
            ...base,
            name: "progression",
            intents: [
                {
                    name: "creditContributor",
                    idempotencyClass: "idempotent",
                    requiredPermissions: ["members:read"],
                },
            ],
            permissions: { repository: ["issues:write"], organization: ["members:read"] },
        } as CapabilityDeclaration;
        expect(validateDeclaration(declaration)).toEqual([]);
    });

    it("an intent still cannot require a grant declared NOWHERE", () => {
        const declaration = {
            ...base,
            name: "overreach",
            intents: [
                {
                    name: "doTooMuch",
                    idempotencyClass: "idempotent",
                    requiredPermissions: ["administration:write"],
                },
            ],
            permissions: { repository: ["issues:write"], organization: ["members:read"] },
        } as CapabilityDeclaration;
        expect(validateDeclaration(declaration).join()).toContain("does not declare");
    });

    /**
     * D58 — the tombstone rule was documentation only: `get` returned a
     * retired declaration ready to run. Now reporting returns metadata
     * only and the sole declaration lookup fails closed.
     */
    it("get hides a retired capability while describe reports metadata only", () => {
        const result = createRegistry([
            {
                ...base,
                name: "live",
                intents: [],
                permissions: { repository: [], organization: [] },
            },
            {
                ...base,
                name: "old",
                retired: true,
                intents: [],
                permissions: { repository: [], organization: [] },
            },
        ] as CapabilityDeclaration[]);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const { registry } = result;

        // Configuration validity is unchanged — retirement is not breaking.
        expect(registry.names).toContain("old");
        expect(registry.activeNames).not.toContain("old");

        // The reporting path can name it but cannot expose an activatable declaration.
        expect(registry.describe("old")).toEqual({ name: "old", retired: true });
        expect(registry.describe("neverExisted")).toBeUndefined();
        // The only declaration lookup refuses to hand a retired capability over.
        expect(registry.get("old")).toBeUndefined();
        expect(registry.get("live")?.name).toBe("live");
        expect(registry.get("neverExisted")).toBeUndefined();
    });
});
