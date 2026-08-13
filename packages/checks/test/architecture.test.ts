/**
 * The workspace dependency graph is architecture, not package-manager trivia.
 * Membership comes from pnpm; TypeScript's AST supplies the import edges.
 */

import { readFileSync } from "node:fs";
import { dirname, join, posix, resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { normalizeRepoPath, repoRoot, trackedFiles, workspacePackages } from "./helpers.js";

type Dependency = readonly [specifier: string, reference: string];

interface WorkspacePackage {
    readonly directory: string;
    readonly name: string;
    readonly dependencies: readonly Dependency[];
}

interface SourceFile {
    readonly path: string;
    readonly text: string;
}

interface Edge {
    readonly importer: WorkspacePackage;
    readonly imported: WorkspacePackage;
    readonly file: string;
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

const SOURCE_FILE = /\.(?:[cm]?[jt]sx?)$/;

/** Layer policy, not a copied workspace list. D93 owns shell -> probes. */
const ALLOWED: Readonly<Record<string, ReadonlySet<string>>> = {
    core: new Set(),
    store: new Set(["core"]),
    shell: new Set(["core", "store", "probes"]),
};
const NON_PRODUCTION = new Set(["checks", "lab", "probes"]);

function role(workspacePackage: WorkspacePackage): string {
    return posix.basename(workspacePackage.directory);
}

function manifestDependencies(manifest: Manifest): Dependency[] {
    return [
        manifest.dependencies,
        manifest.devDependencies,
        manifest.optionalDependencies,
        manifest.peerDependencies,
    ].flatMap((section) => Object.entries(section ?? {}));
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

function moduleSpecifiers(source: SourceFile): string[] {
    const syntax = ts.createSourceFile(source.path, source.text, ts.ScriptTarget.Latest, true);
    const specifiers: string[] = [];
    const add = (node: ts.Expression | undefined): void => {
        if (node !== undefined && ts.isStringLiteralLike(node)) {
            specifiers.push(node.text);
        }
    };

    function visit(node: ts.Node): void {
        if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
            add(node.moduleSpecifier);
        } else if (
            ts.isImportEqualsDeclaration(node) &&
            ts.isExternalModuleReference(node.moduleReference)
        ) {
            add(node.moduleReference.expression);
        } else if (
            ts.isImportTypeNode(node) &&
            ts.isLiteralTypeNode(node.argument) &&
            ts.isStringLiteralLike(node.argument.literal)
        ) {
            specifiers.push(node.argument.literal.text);
        } else if (
            ts.isCallExpression(node) &&
            (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
                (ts.isIdentifier(node.expression) && node.expression.text === "require"))
        ) {
            add(node.arguments[0]);
        }
        ts.forEachChild(node, visit);
    }
    visit(syntax);
    return specifiers;
}

function packageContaining(
    path: string,
    packages: readonly WorkspacePackage[],
): WorkspacePackage | undefined {
    return packages.find(
        (candidate) => path === candidate.directory || path.startsWith(`${candidate.directory}/`),
    );
}

function packageNamed(
    specifier: string,
    packages: readonly WorkspacePackage[],
): WorkspacePackage | undefined {
    return packages.find(
        (candidate) => specifier === candidate.name || specifier.startsWith(`${candidate.name}/`),
    );
}

function relativePackage(
    sourcePath: string,
    specifier: string,
    packages: readonly WorkspacePackage[],
): WorkspacePackage | undefined {
    if (!specifier.startsWith(".")) return undefined;
    const target = normalizeRepoPath(resolve(repoRoot, dirname(sourcePath), specifier));
    return packageContaining(posix.relative(normalizeRepoPath(repoRoot), target), packages);
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

function directionViolation(edge: Edge): Violation | undefined {
    const importerRole = role(edge.importer);
    const importedRole = role(edge.imported);
    if (
        !NON_PRODUCTION.has(importerRole) &&
        (importedRole === "checks" || importedRole === "lab")
    ) {
        return {
            importer: edge.importer.name,
            imported: edge.imported.name,
            file: edge.file,
            rule: "production packages cannot import checks or lab",
        };
    }
    const allowed = ALLOWED[importerRole];
    if (allowed === undefined || allowed.has(importedRole)) return undefined;
    return {
        importer: edge.importer.name,
        imported: edge.imported.name,
        file: edge.file,
        rule: `${importerRole} may import only ${[...allowed].join(", ") || "external packages"}`,
    };
}

function cycleViolations(edges: readonly Edge[]): Violation[] {
    const outgoing = new Map<string, Edge[]>();
    for (const edge of edges) {
        const current = outgoing.get(edge.importer.name) ?? [];
        current.push(edge);
        outgoing.set(edge.importer.name, current);
    }
    const done = new Set<string>();
    const active: string[] = [];
    const violations: Violation[] = [];

    function visit(name: string): void {
        if (done.has(name)) return;
        active.push(name);
        for (const edge of outgoing.get(name) ?? []) {
            const start = active.indexOf(edge.imported.name);
            if (start !== -1) {
                violations.push({
                    importer: edge.importer.name,
                    imported: edge.imported.name,
                    file: edge.file,
                    rule: `dependency cycle: ${[...active.slice(start), edge.imported.name].join(" -> ")}`,
                });
            } else {
                visit(edge.imported.name);
            }
        }
        active.pop();
        done.add(name);
    }
    for (const name of outgoing.keys()) visit(name);
    return violations;
}

function architectureViolations(
    packages: readonly WorkspacePackage[],
    sources: readonly SourceFile[],
): Violation[] {
    if (new Set(packages.map(({ name }) => name)).size !== packages.length) {
        throw new Error("workspace package names must be unique");
    }
    const edges: Edge[] = [];
    const violations: Violation[] = [];
    const inspectEdge = (edge: Edge): void => {
        edges.push(edge);
        const violation = directionViolation(edge);
        if (violation !== undefined) violations.push(violation);
    };

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
            inspectEdge({ importer, imported, file });
            if (dependency[0] !== imported.name) {
                violations.push({
                    importer: importer.name,
                    imported: imported.name,
                    file,
                    rule: "local workspace aliases are forbidden; use the canonical package export",
                });
            }
        }
    }

    for (const source of sources) {
        const importer = packageContaining(source.path, packages);
        if (importer === undefined) continue;
        for (const specifier of moduleSpecifiers(source)) {
            const named = packageNamed(specifier, packages);
            const relative = relativePackage(source.path, specifier, packages);
            const imported = named ?? relative;
            if (imported === undefined || imported === importer) continue;
            inspectEdge({ importer, imported, file: source.path });
            // The canonical package root is the public boundary. Subpaths and
            // relative escapes are deep imports even if a future exports map
            // could make one resolvable.
            if (relative !== undefined || specifier !== imported.name) {
                violations.push({
                    importer: importer.name,
                    imported: imported.name,
                    file: source.path,
                    rule: "cross-package imports must use a public package export",
                });
            }
        }
    }
    return [...violations, ...cycleViolations(edges)];
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
const source = (wantedRole: string, text: string): SourceFile => ({
    path: `packages/${wantedRole}/src/example.ts`,
    text,
});

describe("the workspace dependency graph preserves package ownership", () => {
    it("accepts the real graph discovered from pnpm-workspace.yaml", () => {
        const sources = trackedFiles()
            .filter((path) => SOURCE_FILE.test(path))
            .map((path) => ({
                path,
                text: readFileSync(join(repoRoot, path), "utf8"),
            }));
        expect(packages.length).toBeGreaterThan(0);
        expect(messages(architectureViolations(packages, sources))).toEqual([]);
    });

    it("detects every forbidden production direction", () => {
        const withCoreStore = packages.map((candidate) =>
            role(candidate) === "core"
                ? {
                      ...candidate,
                      dependencies: [
                          ...candidate.dependencies,
                          [packageName("store"), "workspace:*"] as const,
                      ],
                  }
                : candidate,
        );
        const actual = messages(
            architectureViolations(withCoreStore, [
                source("store", `import "${packageName("shell")}";`),
                source("shell", `import("${packageName("checks")}");`),
                source("shell", `require("${packageName("lab")}");`),
            ]),
        );
        for (const [from, to] of [
            ["core", "store"],
            ["store", "shell"],
            ["shell", "checks"],
            ["shell", "lab"],
        ]) {
            expect(actual).toEqual(
                expect.arrayContaining([
                    expect.stringContaining(`${packageName(from!)} -> ${packageName(to!)}`),
                ]),
            );
        }
    });

    it("detects named and relative deep imports", () => {
        const actual = messages(
            architectureViolations(packages, [
                source("shell", `import "${packageName("core")}/private";`),
                source("probes", 'import "../../core/src/private.js";'),
            ]),
        );
        expect(actual.filter((message) => message.includes("public package export"))).toHaveLength(
            2,
        );
        expect(actual).toEqual(
            expect.arrayContaining([
                expect.stringContaining("packages/shell/src/example.ts"),
                expect.stringContaining("packages/probes/src/example.ts"),
            ]),
        );
    });

    it("rejects local aliases while retaining their hidden graph edges", () => {
        const aliased = packages.map((candidate) =>
            role(candidate) === "core"
                ? {
                      ...candidate,
                      dependencies: [
                          ...candidate.dependencies,
                          ["store-workspace-alias", `workspace:${packageName("store")}@*`] as const,
                          ["store-link-alias", "link:../store"] as const,
                          ["store-file-alias", "file:../store"] as const,
                      ],
                  }
                : candidate,
        );
        const actual = messages(architectureViolations(aliased, []));
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

    it("detects cycles between otherwise unrestricted packages", () => {
        const actual = messages(
            architectureViolations(packages, [
                source("checks", `import "${packageName("lab")}";`),
                source("lab", `import "${packageName("checks")}";`),
            ]),
        );
        expect(actual).toEqual(
            expect.arrayContaining([
                expect.stringMatching(
                    /packages\/(?:checks|lab)\/src\/example\.ts: .*dependency cycle:/,
                ),
            ]),
        );
    });
});
