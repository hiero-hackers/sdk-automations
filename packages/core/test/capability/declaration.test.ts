import { describe, expect, it } from "vitest";
import {
    validateCapabilityDeclarations,
    type CapabilityDeclaration,
} from "../../src/capability/index.js";

const declaration: CapabilityDeclaration = {
    name: "prQuality",
    triggers: [{ kind: "event", event: "pull_request" }],
    configKeys: ["checks"],
    observations: ["pullRequestUpdated"],
    resolvers: ["linkedIssues"],
    intents: ["postManagedComment", "applyMappedLabel"],
    operationalNeeds: {
        schedule: false,
        durableState: "required",
        crossItemCoordination: false,
        externalDelivery: false,
    },
};

describe("validateCapabilityDeclarations", () => {
    it("accepts a valid direct declaration set", () => {
        expect(validateCapabilityDeclarations([declaration])).toEqual([]);
    });

    it("rejects duplicate declaration names with the boot-boundary error", () => {
        expect(validateCapabilityDeclarations([declaration, declaration])).toContain(
            'duplicate capability name "prQuality"',
        );
    });

    it("returns every structural, duplicate-entry, and catalogue-name error", () => {
        const errors = validateCapabilityDeclarations([
            {
                ...declaration,
                name: "PR-Quality",
                triggers: [],
                configKeys: ["checks", "checks"],
                observations: ["unknownObservation", "unknownObservation"],
                resolvers: ["unknownResolver", "unknownResolver"],
                intents: ["unknownOperation", "unknownOperation"],
            },
            {
                ...declaration,
                name: "scheduled",
                triggers: [
                    { kind: "event", event: "issues" },
                    { kind: "schedule", description: "daily" },
                ],
                operationalNeeds: { ...declaration.operationalNeeds, schedule: false },
            },
        ]);

        expect(errors.join("\n")).toContain("camelCase configuration key");
        expect(errors.join("\n")).toContain("at least one trigger");
        expect(errors.join("\n")).toContain('duplicate configKeys entry "checks"');
        expect(errors.join("\n")).toContain('duplicate observations entry "unknownObservation"');
        expect(errors.join("\n")).toContain('duplicate resolvers entry "unknownResolver"');
        expect(errors.join("\n")).toContain('duplicate intents entry "unknownOperation"');
        expect(errors.join("\n")).toContain('observation "unknownObservation"');
        expect(errors.join("\n")).toContain('resolver "unknownResolver"');
        expect(errors.join("\n")).toContain('intent "unknownOperation"');
        expect(errors.join("\n")).toContain("operationalNeeds.schedule is false");
    });

    it("keeps operation facts out of the declaration shape", () => {
        expect(declaration.intents).toEqual(["postManagedComment", "applyMappedLabel"]);
        expect(Object.keys(declaration).sort()).toEqual([
            "configKeys",
            "intents",
            "name",
            "observations",
            "operationalNeeds",
            "resolvers",
            "triggers",
        ]);
    });
});
