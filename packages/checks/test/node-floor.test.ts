/**
 * The Node floor is one fact, restated in five places: every workspace
 * package's `engines.node`, the README badge, the CI test-job matrix,
 * CONTRIBUTING's setup prose, and the `@types/node` policy comment in
 * `dependabot.yml`. Nothing here hardcodes the expected number — the
 * packages' own agreement IS the fact, and every other location is read
 * back and held to it, the same shape as `enumerations.test.ts` (D76).
 * New surfaces added onto the original invariant rather than a second
 * file for the same fact (D89, per #90).
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot, workspacePackages } from "./helpers.js";

/** The `engines.node` value a package.json declares, or undefined if absent. */
function engineNode(packageJsonText: string): string | undefined {
    return (JSON.parse(packageJsonText) as { engines?: { node?: string } }).engines?.node;
}

/** The version the README's shields.io Node badge shows, decoded from its URL. */
function badgeNodeVersion(readmeText: string): string | undefined {
    const match = /badge\/node-([^-]+)-blue/.exec(readmeText);
    return match ? decodeURIComponent(match[1]!) : undefined;
}

/** The bare major version a `>=N` (or `>=N.N`) engines range names. */
function bareVersion(range: string): string {
    return range.replace(/^>=/, "");
}

/** The `node:` values in ci.yml's `test` job matrix, e.g. `[24, 25]` → `["24", "25"]`. */
function ciMatrixNodeVersions(ciYamlText: string): string[] {
    const match = /node:\s*\[\s*([\d,\s]+)\]/.exec(ciYamlText);
    return match ? match[1]!.split(",").map((n) => n.trim()) : [];
}

/** The version CONTRIBUTING's setup paragraph names as the floor ("Node N or newer"). */
function contributingFloorVersion(contributingText: string): string | undefined {
    return /Node (\d+(?:\.\d+)?) or newer/.exec(contributingText)?.[1];
}

/** The version dependabot's `@types/node` policy comment names as the floor. */
function dependabotFloorVersion(dependabotText: string): string | undefined {
    return /CI's floor are both Node (\d+(?:\.\d+)?)/.exec(dependabotText)?.[1];
}

/** Each workspace package's declared value, keyed by its `pnpm-workspace.yaml` entry. */
function declaredNodeFloors(): Map<string, string | undefined> {
    const floors = new Map<string, string | undefined>();
    for (const pkg of workspacePackages()) {
        const text = readFileSync(join(repoRoot, pkg, "package.json"), "utf8");
        floors.set(pkg, engineNode(text));
    }
    return floors;
}

describe("every workspace package declares the same Node floor", () => {
    it("has workspace packages to check", () => {
        expect(workspacePackages().length).toBeGreaterThan(0);
    });

    it("every package declares engines.node", () => {
        const missing = [...declaredNodeFloors()]
            .filter(([, value]) => value === undefined)
            .map(([pkg]) => pkg);
        expect(missing).toEqual([]);
    });

    it("every declared value is identical", () => {
        expect(new Set(declaredNodeFloors().values()).size).toBe(1);
    });

    it("the README badge shows the same value", () => {
        const readme = readFileSync(join(repoRoot, "README.md"), "utf8");
        const [declared] = declaredNodeFloors().values();
        expect(badgeNodeVersion(readme)).toBe(declared);
    });

    it("the CI matrix actually tests the floor", () => {
        const ci = readFileSync(join(repoRoot, ".github", "workflows", "ci.yml"), "utf8");
        const [declared] = declaredNodeFloors().values();
        const tested = ciMatrixNodeVersions(ci).map(Number);
        expect(tested.length).toBeGreaterThan(0);
        expect(Math.min(...tested)).toBe(Number(bareVersion(declared!)));
    });

    it("CONTRIBUTING states the same floor", () => {
        const contributing = readFileSync(join(repoRoot, "CONTRIBUTING.md"), "utf8");
        const [declared] = declaredNodeFloors().values();
        expect(contributingFloorVersion(contributing)).toBe(bareVersion(declared!));
    });

    it("dependabot's @types/node policy comment states the same floor", () => {
        const dependabot = readFileSync(join(repoRoot, ".github", "dependabot.yml"), "utf8");
        const [declared] = declaredNodeFloors().values();
        expect(dependabotFloorVersion(dependabot)).toBe(bareVersion(declared!));
    });

    it("proves the check can fail", () => {
        // A package with no engines field: caught by the "declares" check.
        expect(engineNode('{"name": "x"}')).toBeUndefined();
        // A package that disagrees with the rest: caught by the "identical" check.
        expect(engineNode('{"engines": {"node": ">=23.4"}}')).not.toBe(">=24");
        // A badge that drifted from the packages: caught by the "README" check.
        const staleBadge =
            "[![Node](https://img.shields.io/badge/node-%3E%3D23.4-blue)](package.json)";
        expect(badgeNodeVersion(staleBadge)).not.toBe(">=24");
        // A matrix that never tests the floor: caught by the "CI matrix" check.
        expect(Math.min(...ciMatrixNodeVersions("node: [25, 26]").map(Number))).not.toBe(24);
        // Prose that names a different number: caught by the "CONTRIBUTING" check.
        expect(contributingFloorVersion("Node 23.4 or newer.")).not.toBe("24");
        // A comment left stating the old floor: caught by the "dependabot" check.
        expect(dependabotFloorVersion("engines.node and CI's floor are both Node 23.")).not.toBe(
            "24",
        );
    });
});
