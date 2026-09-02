/**
 * `design/contracts/contract.md` §1 shows the declaration a capability writes,
 * and it sat in `guides/` for a month describing fields the code had renamed
 * and a permissions block D62 had deleted — a sketch nothing compared to the
 * type it claimed to describe. The mapped types below are the comparison: a
 * field added to `CapabilityDeclaration` fails to COMPILE here until this file
 * lists it, and then fails the assertion until the document does too (D76, D89).
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { CapabilityDeclaration, OperationalNeeds } from "@hiero-hackers/automation-core";
import { repoRoot } from "./repository.js";

const DOC = join(repoRoot, "design", "contracts", "contract.md");

/** Exhaustive over the type — adding a field breaks compilation here first. */
const DECLARATION_FIELDS: Record<keyof CapabilityDeclaration, true> = {
    name: true,
    triggers: true,
    configKeys: true,
    requiredMeanings: true,
    observations: true,
    resolvers: true,
    intents: true,
    operationalNeeds: true,
};

const NEEDS_FIELDS: Record<keyof OperationalNeeds, true> = {
    schedule: true,
    durableState: true,
    crossItemCoordination: true,
    externalDelivery: true,
};

/** The property names declared in one `interface X { … }` block of a fenced ts sample. */
export function interfaceFields(markdown: string, name: string): string[] {
    const block = new RegExp(`interface ${name} \\{([^}]*)\\}`).exec(markdown);
    expect(block, `interface ${name} appears in the document`).not.toBeNull();
    return [...(block?.[1] ?? "").matchAll(/^\s*readonly\s+([A-Za-z]+)\??:/gm)].map((m) => m[1]!);
}

describe("contract.md §1 matches the declaration the code accepts", () => {
    const doc = readFileSync(DOC, "utf8");

    it("lists exactly the declaration's fields, in order", () => {
        expect(interfaceFields(doc, "CapabilityDeclaration")).toEqual(
            Object.keys(DECLARATION_FIELDS),
        );
    });

    it("lists exactly the operational needs", () => {
        expect(interfaceFields(doc, "OperationalNeeds")).toEqual(Object.keys(NEEDS_FIELDS));
    });

    it("does not reintroduce a declared permissions block", () => {
        // D62: permissions come from INTENT_OPERATIONS. A declaration that could
        // state them could also widen them, which is the whole reason they left.
        expect(interfaceFields(doc, "CapabilityDeclaration")).not.toContain("permissions");
    });

    it("proves the check can fail", () => {
        const forged = "interface CapabilityDeclaration {\n  readonly name: string;\n}";
        expect(interfaceFields(forged, "CapabilityDeclaration")).toEqual(["name"]);
        expect(interfaceFields(forged, "CapabilityDeclaration")).not.toEqual(
            Object.keys(DECLARATION_FIELDS),
        );
    });
});
