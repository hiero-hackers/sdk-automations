/**
 * Pure decision logic for incremental mutation testing cache invalidation.
 *
 * Stryker tracks changes in mutated source files and direct test specs, but
 * does not reliably detect changes in imported test helpers, shared fixtures,
 * package configuration, or workspace dependencies.
 *
 * This module determines whether a given package must force a full mutation
 * run or may safely reuse cached incremental evidence.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));

function workspacePackages(): string[] {
    const yaml = readFileSync(join(repoRoot, "pnpm-workspace.yaml"), "utf8");
    return yaml
        .split(/\r?\n/)
        .map((line) => /^\s*-\s*(.+?)\s*$/.exec(line)?.[1])
        .filter((name): name is string => name !== undefined);
}

export interface PackageDependencies {
    readonly dependencies: readonly string[];
    readonly consumesTestkit: boolean;
}

export type WorkspaceDependencyMap = Readonly<Record<string, PackageDependencies>>;

const GLOBAL_INVALIDATION_FILES = new Set([
    "pnpm-lock.yaml",
    "package.json",
    "pnpm-workspace.yaml",
    "tsconfig.json",
]);

/** Repository directories a package's tests read from outside the package. */
const TEST_INPUTS: Readonly<Record<string, readonly string[]>> = {
    capabilities: ["docs/examples/"],
};

export function discoverWorkspaceDependencies(
    workspaceDirs: readonly string[] = workspacePackages(),
    rootDir: string = repoRoot,
): WorkspaceDependencyMap {
    const map: Record<string, PackageDependencies> = {};
    for (const dir of workspaceDirs) {
        const pkgRole = dir.split("/").pop()!;
        const manifestPath = join(rootDir, dir, "package.json");
        if (!existsSync(manifestPath)) continue;
        const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
            dependencies?: Record<string, string>;
            devDependencies?: Record<string, string>;
        };
        const allDeps = {
            ...manifest.dependencies,
            ...manifest.devDependencies,
        };
        const internalDeps: string[] = [];
        let consumesTestkit = false;
        for (const depName of Object.keys(allDeps)) {
            if (depName === "@hiero-hackers/automation-testkit") {
                consumesTestkit = true;
            } else if (depName.startsWith("@hiero-hackers/automation-")) {
                const targetRole = depName.replace("@hiero-hackers/automation-", "");
                if (targetRole !== pkgRole) {
                    internalDeps.push(targetRole);
                }
            }
        }
        map[pkgRole] = {
            dependencies: internalDeps.sort(),
            consumesTestkit,
        };
    }
    return map;
}

export interface MutationDecision {
    readonly force: boolean;
    readonly reason?: string;
}

export function shouldForceMutation(
    packageName: string,
    changedFiles: readonly string[],
    workspaceDeps: WorkspaceDependencyMap = discoverWorkspaceDependencies(),
): MutationDecision {
    const pkgDeps = workspaceDeps[packageName] ?? { dependencies: [], consumesTestkit: false };
    const prefix = `packages/${packageName}/`;
    const srcPrefix = `${prefix}src/`;
    const testPrefix = `${prefix}test/`;

    for (const rawFile of changedFiles) {
        const file = rawFile.replaceAll("\\", "/");

        // 1. Root toolchain, lockfile, or workspace configuration changes
        if (GLOBAL_INVALIDATION_FILES.has(file)) {
            return {
                force: true,
                reason: `global dependency or configuration file changed: ${file}`,
            };
        }

        // 2. Shared testkit changes affect all packages consuming testkit
        if (file.startsWith("packages/dev/testkit/")) {
            if (pkgDeps.consumesTestkit) {
                return {
                    force: true,
                    reason: `shared testkit changed: ${file}`,
                };
            }
        }

        // 3. Workspace dependency changes affect dependent packages
        for (const dep of pkgDeps.dependencies) {
            if (file.startsWith(`packages/${dep}/`) || file.startsWith(`packages/dev/${dep}/`)) {
                return {
                    force: true,
                    reason: `workspace dependency '${dep}' changed: ${file}`,
                };
            }
        }

        // 4. Changes within the package itself
        if (file.startsWith(prefix)) {
            // Mutated source files: Stryker tracks them reliably
            if (file.startsWith(srcPrefix) && file.endsWith(".ts")) {
                continue;
            }
            // Direct test specs: Stryker tracks them reliably
            if (file.startsWith(testPrefix) && file.endsWith(".test.ts")) {
                continue;
            }
            // Any other file in the package (helper, fixture, stryker/vitest/tsconfig/package config)
            return {
                force: true,
                reason: `package-local helper, fixture, or configuration changed: ${file}`,
            };
        }

        // 5. Repository files the package's tests read
        if (TEST_INPUTS[packageName]?.some((dir) => file.startsWith(dir))) {
            return {
                force: true,
                reason: `test input outside the package changed: ${file}`,
            };
        }

        // 6. Documentation, lab, checks, or unrelated workspace packages
        // do not force a full mutation run on this package.
    }

    return { force: false };
}

export function gitChangedFiles(baseRef?: string): string[] {
    const ref = baseRef && baseRef.trim().length > 0 ? baseRef : "origin/main";
    try {
        // Tree against tree: a seed newer than HEAD's base is no ancestor of it, and a
        // merge-base diff would skip what changed between the two.
        const output = execFileSync("git", ["diff", "--name-only", ref, "HEAD"], {
            cwd: repoRoot,
            encoding: "utf8",
        });
        return output
            .split("\n")
            .map((l) => l.trim())
            .filter((l) => l.length > 0);
    } catch {
        // git has already written its own reason to the inherited stderr.
        console.error(`[mutation-invalidation] git diff against ${ref} failed`);
        return [];
    }
}

// CLI entry point for CI steps:
// node --experimental-strip-types packages/dev/checks/test/mutation-invalidation.ts <package> [baseRef]
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    const pkg = process.argv[2];
    const baseRef = process.argv[3];
    if (!pkg) {
        console.error("Usage: mutation-invalidation.ts <package> [baseRef]");
        process.exit(1);
    }
    const changed = gitChangedFiles(baseRef);
    // If git changed files is empty (e.g. unknown diff base), fail-safe to force
    if (changed.length === 0) {
        console.error(`[mutation-invalidation] ${pkg}: forcing full run (no changed files found)`);
        console.log(" --force");
        process.exit(0);
    }
    const decision = shouldForceMutation(pkg, changed);
    if (decision.force) {
        console.error(`[mutation-invalidation] ${pkg}: forcing full run (${decision.reason})`);
        console.log(" --force");
    } else {
        console.error(`[mutation-invalidation] ${pkg}: eligible for incremental run`);
        console.log("");
    }
}
