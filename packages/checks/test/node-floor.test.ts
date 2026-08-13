/**
 * Every workspace package declares the same `engines.node` floor, and the
 * README badge shows that same value. Nothing broke when three packages
 * were missing the field — the gap was only findable by reading all seven
 * `package.json` files side by side, which does not scale. New invariant,
 * new file (D89).
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

    it("proves the check can fail", () => {
        // A package with no engines field: caught by the "declares" check.
        expect(engineNode('{"name": "x"}')).toBeUndefined();
        // A package that disagrees with the rest: caught by the "identical" check.
        expect(engineNode('{"engines": {"node": ">=24"}}')).not.toBe(">=23.4");
        // A badge that drifted from the packages: caught by the "README" check.
        const drifted = "[![Node](https://img.shields.io/badge/node-%3E%3D24-blue)](package.json)";
        expect(badgeNodeVersion(drifted)).not.toBe(">=23.4");
    });
});
