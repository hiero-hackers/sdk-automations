/**
 * Every package that owns a Stryker config owns a real recursive source
 * scope and a numeric gate, and CI runs that exact package set. This is the
 * repository-level lock against a config or matrix entry drifting alone.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { normalizeRepoPath, repoRoot, trackedFiles, workspacePackages } from "./helpers.js";

interface StrykerConfig {
    readonly mutate: readonly string[];
    readonly thresholds: { readonly break: unknown };
}

interface ConfiguredPackage {
    readonly name: string;
    readonly path: string;
    readonly config: StrykerConfig;
    readonly sources: readonly string[];
}

function globToRegExp(glob: string): RegExp {
    let body = "";
    for (let i = 0; i < glob.length; i++) {
        const char = glob[i]!;
        if (char === "*") {
            if (glob[i + 1] === "*") {
                if (glob[i + 2] === "/") {
                    body += "(?:[^/]+/)*";
                    i += 2;
                } else {
                    body += ".*";
                    i += 1;
                }
            } else {
                body += "[^/]*";
            }
        } else if (char === "?") {
            body += "[^/]";
        } else {
            body += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
        }
    }
    return new RegExp(`^${body}$`);
}

function unmatchedSources(sources: readonly string[], mutate: readonly string[]): string[] {
    const patterns = mutate.map(globToRegExp);
    return sources.filter((source) => !patterns.some((pattern) => pattern.test(source)));
}

function matrixDrift(
    configured: readonly string[],
    matrix: readonly string[],
): { missing: string[]; extra: string[] } {
    const configuredSet = new Set(configured);
    const matrixSet = new Set(matrix);
    return {
        missing: configured.filter((name) => !matrixSet.has(name)).sort(),
        extra: matrix.filter((name) => !configuredSet.has(name)).sort(),
    };
}

const tracked = trackedFiles();
const trackedSet = new Set(tracked);
const configuredPackages: ConfiguredPackage[] = workspacePackages()
    .filter((packagePath) => trackedSet.has(`${packagePath}/stryker.config.json`))
    .map((packagePath) => {
        const configPath = `${packagePath}/stryker.config.json`;
        const config = JSON.parse(
            readFileSync(join(repoRoot, configPath), "utf8"),
        ) as StrykerConfig;
        const prefix = `${packagePath}/`;
        const sources = tracked
            .filter((path) => path.startsWith(`${prefix}src/`) && path.endsWith(".ts"))
            .map((path) => normalizeRepoPath(path.slice(prefix.length)));
        return { name: basename(packagePath), path: packagePath, config, sources };
    });

const ci = readFileSync(join(repoRoot, ".github", "workflows", "ci.yml"), "utf8");
const mutationJob =
    /\n  mutation:\s*\n([\s\S]*?)(?=\n  [a-zA-Z0-9_-]+:\s*\n|$)/.exec(ci)?.[1] ?? "";
const mutationMatrix =
    /\bpackage:\s*\[([^\]]+)\]/
        .exec(mutationJob)?.[1]
        ?.split(",")
        .map((name) => name.trim())
        .filter(Boolean) ?? [];

describe("mutation policy stays complete across packages and CI", () => {
    it("discovers every configured workspace package", () => {
        expect(configuredPackages.map(({ name }) => name).sort()).toEqual([
            "core",
            "shell",
            "store",
        ]);
    });

    it("mutates every tracked TypeScript source recursively", () => {
        for (const subject of configuredPackages) {
            expect(subject.config.mutate, subject.path).toEqual(["src/**/*.ts"]);
            expect(subject.sources.length, subject.path).toBeGreaterThan(0);
            expect(unmatchedSources(subject.sources, subject.config.mutate), subject.path).toEqual(
                [],
            );
        }
    });

    it("sets a numeric break threshold in every package policy", () => {
        for (const subject of configuredPackages) {
            expect(typeof subject.config.thresholds.break, subject.path).toBe("number");
        }
    });

    it("runs every configured package independently in the mutation matrix", () => {
        expect(mutationJob).toContain("name: mutation testing (${{ matrix.package }})");
        expect(mutationJob).toContain(
            "pnpm --filter @hiero-hackers/automation-${{ matrix.package }} exec stryker run",
        );
        expect(
            matrixDrift(
                configuredPackages.map(({ name }) => name),
                mutationMatrix,
            ),
        ).toEqual({ missing: [], extra: [] });
    });

    it("proves misspelled scopes and CI paths fail in both directions", () => {
        const recursive = globToRegExp("src/**/*.ts");
        expect(recursive.test("src/store.ts")).toBe(true);
        expect(recursive.test("src/github/deep/file.ts")).toBe(true);
        expect(recursive.test("test/store.test.ts")).toBe(false);
        expect(unmatchedSources(["src/store.ts", "src/nested/file.ts"], ["src/*.ts"])).toEqual([
            "src/nested/file.ts",
        ]);
        expect(matrixDrift(["core", "shell", "store"], ["core", "shell", "stroe"])).toEqual({
            missing: ["store"],
            extra: ["stroe"],
        });
    });
});
