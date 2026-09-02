/**
 * `design/contracts/config-schema.md` is locked to the vocabularies the code owns,
 * the same bargain doc-drift makes for the taxonomy: a spec a check reads is a
 * contract, a spec nothing reads is a proposal wearing one's name. Three
 * closed vocabularies are exact in both directions: §3's top-level-key table,
 * §4's modes, and §6's rejection codes. Illustrative YAML remains the examples
 * suite's concern. One invariant per file (D89).
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
    REPOSITORY_MODES,
    TOP_LEVEL_KEYS,
    type ConfigErrorCode,
} from "@hiero-hackers/automation-core";
import { repoRoot } from "./repository.js";

const DOC = join(repoRoot, "design", "contracts", "config-schema.md");

const ERROR_CODES: { readonly [K in ConfigErrorCode]: true } = {
    documentUnparseable: true,
    duplicateKey: true,
    notAMapping: true,
    unknownKey: true,
    schemaVersionUnsupported: true,
    modeInvalid: true,
    capabilityNameInvalid: true,
    capabilityEnabledNotBoolean: true,
    capabilityUnknown: true,
    meaningNotMappable: true,
    meaningRequired: true,
    labelInvalid: true,
    labelNotInjective: true,
    principalNotAString: true,
};

/** The first backtick-quoted token of each row in one `## section`'s table. */
export function tableCodes(markdown: string, heading: string): string[] {
    const section = markdown.split(/^## /m).find((s) => s.startsWith(heading));
    expect(section, `section "${heading}" exists`).toBeDefined();
    return [...(section ?? "").matchAll(/^\|\s*`([^`\r\n]+)`\s*\|/gm)].map((m) => m[1]!);
}

describe("contracts/config-schema.md matches the vocabularies the code owns", () => {
    const doc = readFileSync(DOC, "utf8");

    it("the modes table lists exactly the repository modes, in order", () => {
        expect(tableCodes(doc, "4. Repository modes")).toEqual([...REPOSITORY_MODES]);
    });

    it("the schema table lists exactly the accepted top-level keys, in order", () => {
        expect(tableCodes(doc, "3. Schema shape")).toEqual([...TOP_LEVEL_KEYS]);
    });

    it("the rejection table is the configuration error catalogue, exactly", () => {
        expect(tableCodes(doc, "6. Rejection codes").sort()).toEqual(
            Object.keys(ERROR_CODES).sort(),
        );
    });

    it("proves the check can fail", () => {
        const forged = "## 4. Repository modes\n\n| Mode |\n|---|\n| `disabled` |\n| `observe` |\n";
        expect(tableCodes(`# x\n\n${forged}`, "4. Repository modes")).not.toEqual([
            ...REPOSITORY_MODES,
        ]);
        expect(
            tableCodes(
                "## 3. Schema shape\n\n| Key |\n|---|\n| `schemaVersion` |\n| `invented_2` |",
                "3. Schema shape",
            ),
        ).not.toEqual([...TOP_LEVEL_KEYS]);
        expect(
            tableCodes(
                "## 6. Rejection codes\n\n| Code |\n|---|\n| `unknownKey` |",
                "6. Rejection codes",
            ),
        ).not.toEqual(Object.keys(ERROR_CODES));
    });
});
