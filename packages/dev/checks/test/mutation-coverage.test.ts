/**
 * Every package that owns a Stryker config owns a real recursive source scope
 * and a numeric gate, and CI's matrix runs that exact package set. A scope or
 * matrix entry that drifts alone mutates less and still passes (D89's mutate
 * glob).
 *
 * `ci.yml` is read with a YAML parser, not sliced with regexes: a check whose
 * grip depends on where the line breaks fall is the fragility this file exists
 * to remove.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { parse } from "yaml";
import { normalizeRepoPath, repoRoot, repositoryFiles, workspacePackages } from "./repository.js";

interface StrykerConfig {
    readonly mutate: readonly string[];
    readonly reporters?: readonly string[];
    readonly incrementalFile?: string;
    readonly jsonReporter?: { readonly fileName?: string };
    readonly thresholds: { readonly break: unknown };
}

interface ConfiguredPackage {
    readonly name: string;
    readonly path: string;
    readonly config: StrykerConfig;
    readonly sources: readonly string[];
}

interface Job {
    readonly name?: string;
    readonly strategy?: {
        readonly matrix?: Readonly<Record<string, readonly string[] | undefined>>;
    };
    readonly steps?: readonly Step[];
}

interface Step {
    readonly id?: string;
    readonly uses?: string;
    readonly if?: string;
    readonly env?: Readonly<Record<string, string>>;
    readonly run?: string;
}

interface Workflow {
    readonly jobs?: Readonly<Record<string, Job | undefined>>;
}

function mutationJob(workflow: string): Job {
    const job = (parse(workflow) as Workflow).jobs?.mutation;
    if (job === undefined) throw new Error("the ci workflow has no mutation job");
    return job;
}

/** The matrix axis CI fans the job out over, in declaration order. */
function matrixPackages(job: Job): string[] {
    return [...(job.strategy?.matrix?.package ?? [])];
}

function runCommands(job: Job): string[] {
    return (job.steps ?? []).map(({ run }) => run ?? "");
}

/** The invocation CI fans out, before the flags that tune how it runs. */
const STRYKER_RUN =
    "pnpm --filter @hiero-hackers/automation-${{ matrix.package }} exec stryker run";

function strykerCommand(job: Job): string | undefined {
    return runCommands(job).find((run) => run.startsWith(STRYKER_RUN));
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

function coverageJob(workflow: string): Job {
    const job = (parse(workflow) as Workflow).jobs?.coverage;
    if (job === undefined) throw new Error("the ci workflow has no coverage job");
    return job;
}

const COVERAGE_RUN = "test:coverage";

function coverageCommand(job: Job): string | undefined {
    return runCommands(job).find((run) => run.includes(COVERAGE_RUN));
}

interface CoveragePackage {
    readonly name: string;
    readonly path: string;
    readonly script: string;
}

const tracked = repositoryFiles();
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

const coveragePackages: CoveragePackage[] = workspacePackages()
    .filter((packagePath) => {
        const manifestPath = join(repoRoot, packagePath, "package.json");
        const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
            scripts?: Record<string, string>;
        };
        return typeof manifest.scripts?.["test:coverage"] === "string";
    })
    .map((packagePath) => {
        const manifestPath = join(repoRoot, packagePath, "package.json");
        const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
            scripts?: Record<string, string>;
        };
        return {
            name: basename(packagePath),
            path: packagePath,
            script: manifest.scripts!["test:coverage"]!,
        };
    });

const workflowContent = readFileSync(join(repoRoot, ".github", "workflows", "ci.yml"), "utf8");
const mutation = mutationJob(workflowContent);
const coverage = coverageJob(workflowContent);

describe("mutation policy stays complete across packages and CI", () => {
    it("discovers every configured workspace package", () => {
        expect(configuredPackages.map(({ name }) => name).sort()).toEqual([
            "capabilities",
            "core",
            "runtime",
        ]);
    });

    /**
     * Two facts: the scope is EXACTLY the recursive glob, and the package has
     * sources for it to reach. Glob semantics are not reimplemented here. A
     * package whose specs sit beside their modules (`capabilities`, since R1 of
     * the code-structure migration) may exclude exactly those specs, and nothing
     * else — a spec is not a source, and mutating one proves nothing.
     */
    it("mutates every tracked TypeScript source recursively", () => {
        for (const subject of configuredPackages) {
            const [scope, ...exclusions] = subject.config.mutate;
            expect(scope, subject.path).toBe("src/**/*.ts");
            expect(exclusions, subject.path).toSatisfy(
                (rest: readonly string[]) =>
                    rest.length === 0 || (rest.length === 1 && rest[0] === "!src/**/*.test.ts"),
            );
            expect(subject.sources.length, subject.path).toBeGreaterThan(0);
        }
    });

    it("sets a numeric break threshold in every package policy", () => {
        for (const subject of configuredPackages) {
            expect(typeof subject.config.thresholds.break, subject.path).toBe("number");
        }
    });

    it("runs every configured package independently in the mutation matrix", () => {
        expect(mutation.name).toBe("mutation testing (${{ matrix.package }})");
        expect(strykerCommand(mutation), "no stryker run step in the mutation job").toBeDefined();
        // Only that the run is incremental, not how the `--force` on main is
        // spelled: pinning the GitHub expression would make a rewording of the
        // conditional read as a policy change.
        expect(strykerCommand(mutation)).toContain("--incremental");
        expect(
            matrixDrift(
                configuredPackages.map(({ name }) => name),
                matrixPackages(mutation),
            ),
        ).toEqual({ missing: [], extra: [] });
    });

    it("diffs a pull request from the main commit its restored seed was built from", () => {
        const steps = mutation.steps ?? [];
        const seed = steps.find(({ id }) => id === "seed");
        const invalidation = steps.find(({ run }) => run?.includes("mutation-invalidation.ts"));
        expect(seed?.uses).toMatch(/^actions\/cache\/restore@/);
        expect(invalidation?.env?.["SEED_KEY"]).toBe("${{ steps.seed.outputs.cache-matched-key }}");
        expect(invalidation?.run).toContain('"${SEED_KEY##*-}"');
    });

    it("keeps the store score at 96 in the runtime matrix row", () => {
        const runtime = configuredPackages.find(({ name }) => name === "runtime");
        expect(runtime?.config.reporters).toContain("json");
        expect(runtime?.config.incrementalFile).toBe("reports/stryker-incremental.json");
        expect(runtime?.config.jsonReporter?.fileName).toBe("reports/stryker-report.json");
        expect(runtime?.config.jsonReporter?.fileName).not.toBe(runtime?.config.incrementalFile);
        expect(mutation.steps).toContainEqual({
            if: "matrix.package == 'runtime'",
            run: "node --experimental-strip-types packages/dev/checks/test/store-mutation-threshold.ts packages/runtime/reports/stryker-report.json src/store/ 96",
        });
    });

    it("proves misspelled scopes fail in both directions, and reformatting does not", () => {
        expect(
            matrixDrift(["capabilities", "core", "runtime"], ["capabilities", "core", "rutnime"]),
        ).toEqual({
            missing: ["runtime"],
            extra: ["rutnime"],
        });
        // The same matrix as a block sequence, keys reordered, run command
        // folded: the old `package:\s*\[([^\]]+)\]` slice read nothing here
        // and reported the empty result as drift-free.
        const reformatted = mutationJob(
            [
                "jobs:",
                "  mutation:",
                "    strategy:",
                "      matrix:",
                "        package:",
                "          - capabilities",
                "          - core",
                "          - runtime",
                "    name: mutation testing (${{ matrix.package }})",
                "    steps:",
                "      - run: >-",
                "          pnpm --filter",
                "          @hiero-hackers/automation-${{ matrix.package }} exec stryker run",
                "          --incremental",
                "",
            ].join("\n"),
        );
        expect(matrixPackages(reformatted)).toEqual(matrixPackages(mutation));
        expect(reformatted.name).toBe(mutation.name);
        expect(strykerCommand(reformatted)).toContain("--incremental");
    });
});

describe("coverage policy stays complete across packages and CI", () => {
    it("discovers every package owning a test:coverage script", () => {
        expect(coveragePackages.map(({ name }) => name).sort()).toEqual([
            "capabilities",
            "core",
            "runtime",
        ]);
    });

    it("runs every coverage-configured package in the coverage matrix", () => {
        expect(coverage.name).toBe("line coverage (${{ matrix.package }})");
        expect(
            coverageCommand(coverage),
            "no test:coverage run step in coverage job",
        ).toBeDefined();
        expect(
            matrixDrift(
                coveragePackages.map(({ name }) => name),
                matrixPackages(coverage),
            ),
        ).toEqual({ missing: [], extra: [] });
    });

    it("proves missing, extra, or misspelled coverage matrix packages fail", () => {
        const configured = coveragePackages.map(({ name }) => name);
        expect(matrixDrift(configured, ["core", "runtime"])).toEqual({
            missing: ["capabilities"],
            extra: [],
        });
        expect(matrixDrift(configured, ["capabilities", "core", "runtime", "checks"])).toEqual({
            missing: [],
            extra: ["checks"],
        });
        expect(matrixDrift(configured, ["capabilities", "core", "rutnime"])).toEqual({
            missing: ["runtime"],
            extra: ["rutnime"],
        });
    });
});
