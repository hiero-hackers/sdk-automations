/**
 * `design/guides/capability-kits.md` §3 holds the constructor table the
 * settings vocabulary generates.
 *
 * The table was a hand copy of the constructors, and a constructor whose
 * reader changed what an absent key means left the guide saying the old thing
 * — the drift `catalogue-drift.test.ts` exists for, one layer down. Two of the
 * three columns are now derived, and the third is a reviewed sentence in
 * `generated.ts` (D76).
 *
 * One invariant per file (D89).
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readGeneratedBlock, renderConstructorTable } from "./generated.js";
import { normalizeNewlines, repoRoot } from "./repository.js";

const DOC = join(repoRoot, "design", "guides", "capability-kits.md");

describe("capability-kits.md holds the constructor table the vocabulary generates", () => {
    const doc = normalizeNewlines(readFileSync(DOC, "utf8"));

    it("every generated block is what the file holds", () => {
        for (const { name, markdown } of renderConstructorTable()) {
            expect(readGeneratedBlock(doc, name), `run \`pnpm contracts\` — ${name}`).toEqual(
                markdown,
            );
        }
    });

    /**
     * The table's rows are FORMS, not constructors: two of the eight answer
     * differently depending on what they were given, and a row averaging them
     * would be true of neither. So the row count is the check that no form was
     * lost, and the eight kinds are the check that no constructor was.
     */
    it("shows every constructor, at least one row each", () => {
        const [constructors] = renderConstructorTable();
        const rows = [...(constructors?.markdown ?? "").matchAll(/^\| `([a-zA-Z]+)\(/gm)].map(
            (m) => m[1]!,
        );
        expect(new Set(rows).size).toBe(8);
        expect(rows.length).toBeGreaterThan(8);
    });

    it("proves the check can fail", () => {
        const [constructors] = renderConstructorTable();
        const forged = `<!-- generated: constructors -->\n| Constructor |\n|---|\n| \`invented()\` |\n<!-- /generated -->`;
        expect(readGeneratedBlock(forged, "constructors")).not.toEqual(constructors?.markdown);
        expect(readGeneratedBlock("# no markers here", "constructors")).toBeNull();
        expect(renderConstructorTable().map(({ name }) => name)).toEqual(["constructors"]);
    });
});
