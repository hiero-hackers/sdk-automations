import { describe, expect, it } from "vitest";
import {
    validateCapabilityDeclarations,
    type CapabilityDeclaration,
} from "../../src/capability/index.js";

const declaration: CapabilityDeclaration = {
    name: "prQuality",
    triggers: [{ kind: "event", event: "pull_request" }],
    configKeys: ["checks"],
    requiredMeanings: ["needsReview"],
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
                requiredMeanings: ["almostReady", "almostReady"],
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
        // Every error names the declaration it came from. With two bad
        // declarations in one list, an unattributed error tells a maintainer
        // that SOMETHING is wrong and not which capability to open.
        expect(errors.join("\n")).toContain('capability "PR-Quality": at least one trigger');
        expect(errors.join("\n")).toContain(
            'capability "PR-Quality": observation "unknownObservation" is not in the observation catalogue',
        );
        /**
         * Attribution is also what makes the schedule check a check. The
         * mismatch belongs to `scheduled`, which declares a schedule trigger
         * among two; `PR-Quality` declares no triggers at all and must not be
         * accused of one. A quantifier slip over the trigger list moves the
         * error from the first capability to the second and leaves the
         * unattributed fragment above passing.
         */
        expect(errors.join("\n")).toContain(
            'capability "scheduled": declares a schedule trigger but operationalNeeds.schedule is false',
        );
        expect(errors.join("\n")).not.toContain(
            'capability "PR-Quality": declares a schedule trigger',
        );
        expect(errors.join("\n")).toContain('duplicate configKeys entry "checks"');
        expect(errors.join("\n")).toContain('duplicate requiredMeanings entry "almostReady"');
        /**
         * D84 — a meaning no repository may map is a requirement no repository
         * can satisfy, so the catalogue check covers `requiredMeanings` the
         * way it already covered observations, resolvers, and intents.
         */
        expect(errors.join("\n")).toContain(
            'capability "PR-Quality": required meaning "almostReady" is not a mappable meaning',
        );
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
            "requiredMeanings",
            "resolvers",
            "triggers",
        ]);
    });
});
