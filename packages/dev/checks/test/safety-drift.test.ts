/**
 * `design/contracts/safety.md` is the engine's contract, and a contract nothing
 * reads is a proposal wearing one's name. Its refusal and record-only tables
 * are GENERATED from `generated.ts`'s catalogues, and this holds the file to
 * them: an undocumented code, an invented row and a stale meaning are the same
 * defect seen from three sides, and comparing whole blocks catches all three
 * where a code list caught only the first.
 *
 * No runtime arrays exist for those unions, so each catalogue is a mapped type
 * over `SafetyRefusalCode` and `RecordOnlyCode` — a new code fails to COMPILE
 * in the generator until its row follows (D76). One invariant per file (D89).
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readGeneratedBlock, renderSafetyCodeTables } from "./generated.js";
import { normalizeNewlines, repoRoot } from "./repository.js";

const DOC = join(repoRoot, "design", "contracts", "safety.md");

describe("contracts/safety.md holds the verdict tables the code generates", () => {
    const doc = normalizeNewlines(readFileSync(DOC, "utf8"));

    it("every generated block is what the file holds", () => {
        for (const { name, markdown } of renderSafetyCodeTables()) {
            expect(readGeneratedBlock(doc, name), `run \`pnpm contracts\` — ${name}`).toEqual(
                markdown,
            );
        }
    });

    it("proves the check can fail", () => {
        // Negative control: a table trimmed to one row must not satisfy the
        // catalogue, a missing marker pair must read as absent rather than as
        // agreement, and the refusal block must still be the long one — a
        // renderer that returned nothing would pass every comparison above.
        const [refusals, recordOnly] = renderSafetyCodeTables();
        const forged =
            "<!-- generated: refusal-codes -->\n| Code |\n|---|\n| `killSwitch` |\n<!-- /generated -->";
        expect(readGeneratedBlock(forged, "refusal-codes")).not.toEqual(refusals?.markdown);
        expect(readGeneratedBlock(forged, "record-only-codes")).toBeNull();
        expect(refusals?.markdown.split("\n").length).toBeGreaterThan(20);
        expect(recordOnly?.markdown.split("\n")).toHaveLength(5);
    });
});
