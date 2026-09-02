/**
 * `design/contracts/safety.md` is the engine's contract, and a contract nothing
 * reads is a proposal wearing one's name. Its refusal and record-only tables
 * are held to their code unions in both directions: an undocumented code and
 * an invented row are the same defect seen from either side. No runtime arrays
 * exist for those unions, so each catalogue is a mapped type — a new code
 * fails to COMPILE until the row follows (D76). One invariant per file (D89).
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { RecordOnlyCode, SafetyRefusalCode } from "@hiero-hackers/automation-core";
import { normalizeNewlines, repoRoot } from "./repository.js";

const DOC = join(repoRoot, "design", "contracts", "safety.md");

/** The first backtick-quoted token of each row in one `## section`'s table. */
function tableCodes(markdown: string, heading: string): string[] {
    const section = markdown.split(/^## /m).find((s) => s.startsWith(heading));
    expect(section, `section "${heading}" exists`).toBeDefined();
    return [...(section ?? "").matchAll(/^\|\s*`([^`\r\n]+)`\s*\|/gm)].map((m) => m[1]!);
}

const REFUSAL_CODES: { readonly [K in SafetyRefusalCode]: true } = {
    killSwitch: true,
    wrongEntryPoint: true,
    preventiveGateUnavailable: true,
    capabilityDisabled: true,
    permissionMissing: true,
    itemBlocked: true,
    itemClosed: true,
    preconditionStale: true,
    newerHumanChange: true,
    humanOrderingUnknown: true,
    invalidTimestamp: true,
    modeDisabled: true,
    wrongActionClass: true,
    noWarning: true,
    warningRequestMismatch: true,
    invalidDestructivePlan: true,
    graceBelowFloor: true,
    graceRunning: true,
    activityCancelled: true,
};

const RECORD_ONLY_CODES: { readonly [K in RecordOnlyCode]: true } = {
    observation: true,
    modeRecordsOnly: true,
};

describe("contracts/safety.md matches the safety engine's refusal vocabulary", () => {
    const doc = normalizeNewlines(readFileSync(DOC, "utf8"));

    it("its refusal table is the refusal catalogue, exactly", () => {
        expect(tableCodes(doc, "3. Refusal codes").sort()).toEqual(
            Object.keys(REFUSAL_CODES).sort(),
        );
    });

    it("its record-only table is the record-only catalogue, exactly", () => {
        expect(tableCodes(doc, "4. Record-only codes").sort()).toEqual(
            Object.keys(RECORD_ONLY_CODES).sort(),
        );
    });

    it("proves the check can fail", () => {
        // Both directions: a short table must not satisfy the catalogue, and
        // the parser must still be finding rows rather than returning nothing.
        const forged = "## 3. Refusal codes\n\n| Code |\n|---|\n| `killSwitch` |\n";
        expect(tableCodes(`# x\n\n${forged}`, "3. Refusal codes")).toEqual(["killSwitch"]);
        expect(tableCodes(`# x\n\n${forged}`, "3. Refusal codes").sort()).not.toEqual(
            Object.keys(REFUSAL_CODES).sort(),
        );
        expect(tableCodes(doc, "3. Refusal codes").length).toBeGreaterThan(10);
        expect(
            tableCodes(
                "## 4. Record-only codes\n\n| Code |\n|---|\n| `observation` |\n| `invented_2` |",
                "4. Record-only codes",
            ),
        ).not.toEqual(Object.keys(RECORD_ONLY_CODES));
    });
});
