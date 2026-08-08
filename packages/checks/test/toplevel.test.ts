/**
 * The top level holds `packages/` and two knowledge roots — D86's
 * sentence, tightened by D95 and D97. Split from repo-artifacts.test.ts (D89).
 *
 * The allowed package root is DERIVED from the workspace file rather than
 * spelled `packages`: the rule is "a directory is where workspace packages
 * live, or it is a named knowledge root", which stays true whether the
 * packages sit under one prefix or at the top level.
 */

import { describe, expect, it } from "vitest";
import { trackedFiles, workspacePackages } from "./helpers.js";

/** The first segment of every workspace entry — today, just `packages`. */
export function packageRoots(entries: readonly string[]): Set<string> {
    return new Set(entries.map((entry) => entry.split("/", 1)[0]!));
}

function topLevelOffenders(
    files: readonly string[],
    packages: ReadonlySet<string>,
    knowledge: ReadonlySet<string>,
): string[] {
    const roots = new Set(
        files.filter((path) => path.includes("/")).map((path) => path.split("/", 1)[0]!),
    );
    return [...roots].filter(
        (name) => !name.startsWith(".") && !packages.has(name) && !knowledge.has(name),
    );
}

/**
 * The consolidation's real product is a sentence: a top-level directory
 * holds workspace packages, or it is one of two knowledge roots —
 * design/ (internal why) and docs/ (users, including the executable
 * examples). audit/ and planning/ existed because no such rule did; this
 * keeps the next five packages from re-growing the clutter.
 */
describe("the top level holds packages and two knowledge roots", () => {
    const KNOWLEDGE = new Set(["design", "docs"]);

    it("every top-level directory is a package root or a named root", () => {
        const packages = packageRoots(workspacePackages());
        expect(topLevelOffenders(trackedFiles(), packages, KNOWLEDGE)).toEqual([]);
    });

    it("the package root is read from the workspace file, not assumed", () => {
        // Guards the derivation: if the workspace file stopped listing
        // paths, this set would go empty and the check above would start
        // flagging the packages themselves rather than going vacuous.
        expect(packageRoots(workspacePackages())).toEqual(new Set(["packages"]));
        expect(packageRoots(["core", "store"])).toEqual(new Set(["core", "store"]));
    });

    it("proves the rule can fail", () => {
        // audit/ was a real offender until 2026-08-06; assert the predicate
        // would still flag it rather than having gone vacuous.
        const packages = packageRoots(workspacePackages());
        expect(
            topLevelOffenders(
                ["audit/report.md", "planning/plan.md", "output/result.json"],
                packages,
                KNOWLEDGE,
            ),
        ).toEqual(["audit", "planning", "output"]);
    });
});
