/**
 * The workspace dependency graph follows the layer policy. The graph is
 * written down twice: manifests are read here, source imports by
 * dependency-cruiser against `.dependency-cruiser.cjs`, for which this file is
 * the enforcement gate. A forbidden edge breaks no build and a rule that
 * stopped firing looks identical to a clean tree, so the real tree and a
 * fixture tree of deliberate violations are both cruised.
 */

import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, posix, resolve } from "node:path";
import { cruise } from "dependency-cruiser";
import type { ICruiseOptions, ICruiseResult, IConfiguration } from "dependency-cruiser";
import { describe, expect, it } from "vitest";
import { normalizeRepoPath, repoRoot, trackedFiles, workspacePackages } from "./repository.js";

/** Part of the edge: `testkit` is legal from `devDependencies` and nowhere else. */
type Section = "dependencies" | "devDependencies" | "optionalDependencies" | "peerDependencies";

type Dependency = readonly [specifier: string, reference: string, section: Section];

interface WorkspacePackage {
    readonly directory: string;
    readonly name: string;
    readonly dependencies: readonly Dependency[];
}

interface Edge {
    readonly importer: WorkspacePackage;
    readonly imported: WorkspacePackage;
    readonly file: string;
    readonly section: Section;
}

interface Violation {
    readonly importer: string;
    readonly imported: string;
    readonly file: string;
    readonly rule: string;
}

interface Manifest {
    readonly name?: unknown;
    readonly dependencies?: Readonly<Record<string, string>>;
    readonly devDependencies?: Readonly<Record<string, string>>;
    readonly optionalDependencies?: Readonly<Record<string, string>>;
    readonly peerDependencies?: Readonly<Record<string, string>>;
}

/** Layer policy, not a copied workspace list. D93 owns shell -> probes. */
const ALLOWED: Readonly<Record<string, ReadonlySet<string>>> = {
    core: new Set(),
    store: new Set(["core"]),
    adapter: new Set(["core"]),
    shell: new Set(["core", "store", "probes", "adapter"]),
    probes: new Set(["core"]),
    checks: new Set(["core"]),
    lab: new Set(["core"]),
    // A leaf on purpose: a builder here would need core, and core's tests need
    // the testkit — the cycle this empty set refuses in advance.
    testkit: new Set(),
};
const NON_PRODUCTION = new Set(["checks", "lab", "probes", "testkit"]);

/**
 * Test-only in two directions, each half checked where it is written down: a
 * manifest may name it only from `devDependencies` (here), and a source file
 * may import it only from a `test/` path (the cruiser's `testkit-is-test-only`).
 */
const TESTKIT = "testkit";

function role(workspacePackage: WorkspacePackage): string {
    return posix.basename(workspacePackage.directory);
}

const SECTIONS: readonly Section[] = [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
    "peerDependencies",
];

function manifestDependencies(manifest: Manifest): Dependency[] {
    return SECTIONS.flatMap((section) =>
        Object.entries(manifest[section] ?? {}).map(([specifier, reference]): Dependency => [
            specifier,
            reference,
            section,
        ]),
    );
}

function loadPackages(directories: readonly string[]): WorkspacePackage[] {
    return directories.map((directory) => {
        const manifest = JSON.parse(
            readFileSync(join(repoRoot, directory, "package.json"), "utf8"),
        ) as Manifest;
        if (typeof manifest.name !== "string") {
            throw new Error(`${directory}/package.json has no package name`);
        }
        return {
            directory: normalizeRepoPath(directory).replace(/\/$/, ""),
            name: manifest.name,
            dependencies: manifestDependencies(manifest),
        };
    });
}

function packageContaining(
    path: string,
    packages: readonly WorkspacePackage[],
): WorkspacePackage | undefined {
    return packages.find(
        (candidate) => path === candidate.directory || path.startsWith(`${candidate.directory}/`),
    );
}

function dependencyTarget(
    importer: WorkspacePackage,
    [specifier, reference]: Dependency,
    packages: readonly WorkspacePackage[],
): WorkspacePackage | undefined {
    const protocol = /^(workspace|link|file):(.*)$/.exec(reference);
    if (protocol === null) {
        return packages.find(({ name }) => name === specifier);
    }
    const target = protocol[2]!;
    if (protocol[1] !== "workspace" || target.startsWith(".")) {
        const path = normalizeRepoPath(resolve(repoRoot, importer.directory, target));
        return packageContaining(posix.relative(normalizeRepoPath(repoRoot), path), packages);
    }
    return (
        packages.find(({ name }) => target === name || target.startsWith(`${name}@`)) ??
        packages.find(({ name }) => name === specifier)
    );
}

function violation(edge: Edge, rule: string): Violation {
    return {
        importer: edge.importer.name,
        imported: edge.imported.name,
        file: edge.file,
        rule,
    };
}

/**
 * Edges INTO the testkit skip the layer table: every package's tests may reach
 * it, so asking ALLOWED would mean naming every package there.
 */
function testkitViolation(edge: Edge): Violation | undefined {
    return edge.section === "devDependencies"
        ? undefined
        : violation(edge, "testkit is test-only; declare it under devDependencies");
}

function directionViolation(edge: Edge): Violation | undefined {
    const importerRole = role(edge.importer);
    const importedRole = role(edge.imported);
    const allowed = ALLOWED[importerRole];
    if (allowed === undefined) {
        return violation(
            edge,
            `unknown workspace role '${importerRole}' requires an architecture decision`,
        );
    }
    if (importedRole === TESTKIT) return testkitViolation(edge);
    if (
        !NON_PRODUCTION.has(importerRole) &&
        (importedRole === "checks" || importedRole === "lab")
    ) {
        return violation(edge, "production packages cannot import checks or lab");
    }
    if (allowed.has(importedRole)) return undefined;
    return violation(
        edge,
        `${importerRole} may import only ${[...allowed].join(", ") || "external packages"}`,
    );
}

/**
 * Hand-written because no import scanner opens a `package.json`, and a
 * declared-but-unimported edge is the kind that survives a refactor unnoticed.
 */
function manifestViolations(packages: readonly WorkspacePackage[]): Violation[] {
    if (new Set(packages.map(({ name }) => name)).size !== packages.length) {
        throw new Error("workspace package names must be unique");
    }
    const violations: Violation[] = [];
    for (const importer of packages) {
        for (const dependency of importer.dependencies) {
            const imported = dependencyTarget(importer, dependency, packages);
            const file = `${importer.directory}/package.json`;
            if (dependency[1].startsWith("workspace:") && imported === undefined) {
                violations.push({
                    importer: importer.name,
                    imported: dependency[1],
                    file,
                    rule: "workspace dependency target cannot be resolved",
                });
                continue;
            }
            if (imported === undefined) continue;
            const edge: Edge = { importer, imported, file, section: dependency[2] };
            const direction = directionViolation(edge);
            if (direction !== undefined) violations.push(direction);
            if (dependency[0] !== imported.name) {
                violations.push(
                    violation(
                        edge,
                        "local workspace aliases are forbidden; use the canonical package export",
                    ),
                );
            }
        }
    }
    return violations;
}

function messages(violations: readonly Violation[]): string[] {
    return violations.map(
        ({ file, importer, imported, rule }) => `${file}: ${importer} -> ${imported}: ${rule}`,
    );
}

const packages = loadPackages(workspacePackages());
const packageName = (wantedRole: string): string => {
    const found = packages.find((candidate) => role(candidate) === wantedRole);
    if (found === undefined) throw new Error(`workspace has no ${wantedRole}`);
    return found.name;
};

describe("workspace manifests declare the allowed dependency directions", () => {
    it("accepts the real manifests discovered from pnpm-workspace.yaml", () => {
        expect(packages.length).toBeGreaterThan(0);
        expect(messages(manifestViolations(packages))).toEqual([]);
    });

    it("detects every forbidden production direction", () => {
        const declare = (wantedRole: string, target: string): WorkspacePackage[] =>
            packages.map((candidate) =>
                role(candidate) === wantedRole
                    ? {
                          ...candidate,
                          dependencies: [
                              ...candidate.dependencies,
                              [packageName(target), "workspace:*", "dependencies"] as const,
                          ],
                      }
                    : candidate,
            );
        for (const [from, to] of [
            ["core", "store"],
            ["store", "shell"],
            ["shell", "checks"],
            ["shell", "lab"],
        ]) {
            expect(messages(manifestViolations(declare(from!, to!)))).toEqual(
                expect.arrayContaining([
                    expect.stringContaining(`${packageName(from!)} -> ${packageName(to!)}`),
                ]),
            );
        }
    });

    it("rejects local aliases while retaining their hidden graph edges", () => {
        const aliased = packages.map((candidate) =>
            role(candidate) === "core"
                ? {
                      ...candidate,
                      dependencies: [
                          ...candidate.dependencies,
                          [
                              "store-workspace-alias",
                              `workspace:${packageName("store")}@*`,
                              "dependencies",
                          ] as const,
                          ["store-link-alias", "link:../store", "dependencies"] as const,
                          ["store-file-alias", "file:../store", "dependencies"] as const,
                      ],
                  }
                : candidate,
        );
        const actual = messages(manifestViolations(aliased));
        expect(
            actual.filter((message) => message.includes("workspace aliases are forbidden")),
        ).toHaveLength(3);
        expect(
            actual.filter((message) =>
                message.includes(
                    `${packageName("core")} -> ${packageName("store")}: core may import only external packages`,
                ),
            ),
        ).toHaveLength(3);
    });

    it("detects a workspace dependency that resolves to no package", () => {
        const dangling = packages.map((candidate) =>
            role(candidate) === "shell"
                ? {
                      ...candidate,
                      dependencies: [
                          ...candidate.dependencies,
                          [
                              "@hiero-hackers/automation-gone",
                              "workspace:*",
                              "dependencies",
                          ] as const,
                      ],
                  }
                : candidate,
        );
        expect(messages(manifestViolations(dangling))).toEqual([
            `packages/shell/package.json: ${packageName("shell")} -> workspace:*: workspace dependency target cannot be resolved`,
        ]);
    });

    it("detects a testkit dependency declared outside devDependencies", () => {
        const asRuntime = packages.map((candidate) =>
            role(candidate) === "shell"
                ? {
                      ...candidate,
                      dependencies: [
                          ...candidate.dependencies.filter(
                              ([specifier]) => specifier !== packageName("testkit"),
                          ),
                          [packageName("testkit"), "workspace:*", "dependencies"] as const,
                      ],
                  }
                : candidate,
        );
        expect(messages(manifestViolations(asRuntime))).toEqual([
            `packages/shell/package.json: ${packageName("shell")} -> ${packageName("testkit")}: testkit is test-only; declare it under devDependencies`,
        ]);
    });

    it("rejects an unknown workspace role participating in internal dependencies", () => {
        const unknownRolePackage: WorkspacePackage = {
            directory: "packages/unknown-role",
            name: "@hiero-hackers/automation-unknown-role",
            dependencies: [[packageName("core"), "workspace:*", "dependencies"] as const],
        };
        expect(messages(manifestViolations([...packages, unknownRolePackage]))).toEqual([
            `packages/unknown-role/package.json: @hiero-hackers/automation-unknown-role -> ${packageName("core")}: unknown workspace role 'unknown-role' requires an architecture decision`,
        ]);
    });
});

/**
 * The rule set lives at the repository root so a direct `depcruise` run and
 * this gate cannot disagree about what may import what.
 */
const configuration = createRequire(import.meta.url)(
    join(repoRoot, ".dependency-cruiser.cjs"),
) as IConfiguration;

const cruiseOptions = (baseDir: string): ICruiseOptions => ({
    ...configuration.options,
    ruleSet: { forbidden: configuration.forbidden ?? [] },
    validate: true,
    baseDir,
});

async function cruiseViolations(roots: readonly string[], baseDir: string): Promise<string[]> {
    const { output } = await cruise([...roots], cruiseOptions(baseDir));
    if (typeof output === "string") throw new Error("expected a cruise result, not a report");
    return (output as ICruiseResult).summary.violations.map(
        ({ rule, from, to }) => `${rule.name}: ${from} -> ${to}`,
    );
}

/**
 * Roots from the workspace file, because a hard-coded array is a test that
 * needs editing to stay correct. `packages/dev/lab/harness/` is deliberately
 * absent: local-only, gitignored, not a workspace member, so CI never sees it
 * and cruising it could only fail on the machines doing the work — the
 * disagreement D95 removed from `pnpm lint`. Its relative reach into core is
 * a consequence of not being a member, and the layer policy does not govern it.
 */
const cruiseRoots = workspacePackages()
    .flatMap((directory) => [`${directory}/src`, `${directory}/test`])
    .filter((directory) => existsSync(join(repoRoot, directory)));

const FIXTURES = "test/fixtures/architecture";

describe("source imports follow the layer policy, checked by dependency-cruiser", () => {
    // Cruising every workspace root outlasts the 5s default while the other
    // packages' suites run in parallel under `pnpm -r test`.
    it("accepts the real tree", { timeout: 30_000 }, async () => {
        expect(cruiseRoots.length).toBeGreaterThan(5);
        expect(await cruiseViolations(cruiseRoots, repoRoot)).toEqual([]);
    });

    /**
     * Negative control. The fixture tree mirrors `packages/<role>/src/` so the
     * same path regexes apply with only the base directory differing — which
     * is also the proof the rules are about layers, not about this checkout.
     */
    it("fires every rule against a tree of deliberate violations", async () => {
        const fixtureRoot = join(repoRoot, "packages/dev/checks", FIXTURES);
        const fired = new Set(
            (await cruiseViolations(["packages"], fixtureRoot)).map(
                (message) => message.split(":")[0]!,
            ),
        );
        expect([...fired].sort()).toEqual([
            "adapter-imported-at-shell-main-only",
            "adapter-imports-core-only",
            "core-and-probes-stay-pure",
            "core-imports-no-internal-package",
            "no-circular",
            "no-import-past-the-barrel",
            "not-to-unresolvable",
            "production-imports-no-checks-or-lab",
            "shell-imports-core-store-probes-adapter",
            "store-imports-core-only",
            "testkit-imports-no-internal-package",
            "testkit-is-test-only",
        ]);
    });

    it("allows only the shell composition root to import the adapter", async () => {
        const fixtureRoot = join(repoRoot, "packages/dev/checks", FIXTURES);
        const violations = await cruiseViolations(["packages"], fixtureRoot);
        expect(
            violations
                .filter((message) => message.startsWith("adapter-imported-at-shell-main-only:"))
                .sort(),
        ).toEqual(
            [
                "adapter-imported-at-shell-main-only: packages/core/src/imports-adapter.ts -> packages/adapter/src/index.ts",
                "adapter-imported-at-shell-main-only: packages/shell/src/imports-adapter.ts -> packages/adapter/src/index.ts",
            ].sort(),
        );
    });

    it("keeps the fixture tree out of the real cruise", async () => {
        // The fixtures live under `packages/dev/checks/test/`, which IS a cruise
        // root: if the config's exclude stopped matching them, the test above
        // would report violations against files that are meant to have them.
        const scanned = await cruise(cruiseRoots, cruiseOptions(repoRoot));
        const result = scanned.output as ICruiseResult;
        expect(result.modules.length).toBeGreaterThan(50);
        expect(result.modules.filter(({ source }) => source.includes(FIXTURES))).toEqual([]);
    });
});

/**
 * The hole every import scanner has, dependency-cruiser included:
 * `import.meta.resolve` takes the same specifier an import does but is a
 * FUNCTION CALL, so a module can turn a package name into a directory and walk
 * past its barrel leaving no edge for any rule above to forbid.
 */
const RESOLVE_REACH = /import\.meta\.resolve\(\s*["'`]@hiero-hackers\//;

/**
 * The one exemption: it transpiles core's `github/ids.ts` into a scratch
 * directory so a `node:worker_threads` contender can import it. An exact set
 * rather than an empty one, so the array empties itself when it stops.
 */
const RESOLVE_REACH_ALLOWED: readonly string[] = ["packages/store/test/worker-build.ts"];

function resolveReaches(sources: readonly { path: string; text: string }[]): string[] {
    return sources
        .filter(({ text }) => RESOLVE_REACH.test(text))
        .map(({ path }) => path)
        .sort();
}

describe("no new module reaches into another package by resolving its specifier", () => {
    it("finds import.meta.resolve of a workspace package nowhere else", () => {
        const sources = trackedFiles()
            .filter((path) => path.endsWith(".ts"))
            .map((path) => ({ path, text: readFileSync(join(repoRoot, path), "utf8") }));
        expect(sources.length).toBeGreaterThan(20);
        expect(resolveReaches(sources)).toEqual([...RESOLVE_REACH_ALLOWED].sort());
    });

    it("proves the check can fail", () => {
        // The specifier is assembled rather than written out, so this file —
        // which `trackedFiles()` also reads — does not report itself.
        const scope = "@hiero-hackers";
        expect(
            resolveReaches([
                {
                    path: "packages/shell/src/reach.ts",
                    text: `const core = import.meta.resolve("${scope}/automation-core");`,
                },
                { path: "packages/shell/src/fine.ts", text: 'import.meta.resolve("./local.js");' },
            ]),
        ).toEqual(["packages/shell/src/reach.ts"]);
    });
});
