/**
 * Every exported const array derives its union — D76's invariant, the answer
 * to the fifth sighting of one fact stored twice.
 * Split from repo-artifacts.test.ts (D89).
 */

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { normalizeRepoPath, repoRoot } from "./helpers.js";

/**
 * The fifth sighting of "one fact, two places" (D76) was `REPOSITORY_MODES`
 * as a const array beside a hand-written `RepositoryMode` union in another
 * file — four strings duplicated, with a cast covering the seam. It was found
 * by reading, which is not a method that scales. This finds the next one.
 */
describe("enumerations are declared once", () => {
    const sources = (
        readdirSync(join(repoRoot, "packages", "core", "src"), {
            recursive: true,
        }) as string[]
    )
        .filter((rel) => rel.endsWith(".ts"))
        .map((rel) => ({
            file: `src/${normalizeRepoPath(rel)}`,
            text: readFileSync(join(repoRoot, "packages", "core", "src", rel), "utf8"),
        }));

    it("finds the core sources", () => {
        expect(sources.length).toBeGreaterThan(5);
    });

    it("every exported const array has a union derived from it", () => {
        const orphans: string[] = [];
        for (const { file, text } of sources) {
            for (const match of text.matchAll(/export const ([A-Z][A-Z0-9_]*) = \[/g)) {
                const name = match[1]!;
                // The union must be derived, in the same file, from this array.
                if (!text.includes(`(typeof ${name})[number]`)) {
                    orphans.push(`${file}: ${name}`);
                }
            }
        }
        expect(orphans).toEqual([]);
    });

    it("proves the check can fail", () => {
        // Negative control: the detector must reject a const array with no
        // derived union, or the assertion above means nothing.
        const fake = 'export const COLOURS = ["red", "blue"] as const;';
        const found = [...fake.matchAll(/export const ([A-Z][A-Z0-9_]*) = \[/g)];
        expect(found).toHaveLength(1);
        expect(fake.includes("(typeof COLOURS)[number]")).toBe(false);
    });
});
