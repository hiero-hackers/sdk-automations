/**
 * Every file in a package's test tree answers to a name a maintainer can
 * find. One invariant per file (D89).
 *
 * The rule has two clauses, both the same rule. A spec carries the name of
 * the module it holds to account: `test/<path>/<name>.test.ts` exists only
 * if `src/<path>/<name>.ts` does. A test that specs no single module — a
 * composition walk, a property sweep over a whole package — is REGISTERED
 * below with the question it answers, listed rather than discovered, so the
 * next unmirrored file is a decision and not a drift. And no file under
 * test/ is named by kind: `helpers.ts` tells a reader nothing they didn't
 * already have to know (the rule the source tree already lives by).
 *
 * Registrations expire: an entry whose mirror module appears is rejected —
 * the mirror wins — and an entry whose file is gone is rejected as stale.
 * Packages without a `src/` are exempt from mirroring; that is the shape of
 * `checks/` itself (D85), where every file IS an invariant rather than a
 * module's spec.
 *
 * One-way on purpose: a src module without a same-named spec is not an
 * offence. Whether its behaviour dies in a sibling's suite is mutation
 * coverage's question, not naming's.
 */

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeRepoPath, repoRoot, workspacePackages } from "./repository.js";

/**
 * The composition tests: every spec that answers for more than one module,
 * with the question it answers. An entry is an assertion, so adding one is
 * the same act as naming a file — it should survive review on its wording.
 */
const COMPOSITIONS: ReadonlyMap<string, string> = new Map([
    [
        "packages/core/test/scenario.test.ts",
        "one synthetic story through every core module in composition",
    ],
    [
        "packages/core/test/slice.test.ts",
        "a delivery GitHub actually sent, through the whole pure pipeline",
    ],
    [
        "packages/core/test/config/adversarial.test.ts",
        "claims over ANY parsed input — never throws, no key silently lost",
    ],
    [
        "packages/probes/test/boundary.test.ts",
        "conformance of core's runtime boundary, over all three probes",
    ],
    [
        "packages/probes/test/engine-matrix.test.ts",
        "P3 isolation for every capability subset, measured through decide()",
    ],
    [
        "packages/store/test/delivery-intake.test.ts",
        "the intake half of Store's delivery lifecycle",
    ],
    [
        "packages/store/test/delivery-finalization.test.ts",
        "the finalization half of Store's delivery lifecycle",
    ],
    [
        "packages/store/test/interleaving.test.ts",
        "the store against its reference model, hundreds of seeded histories",
    ],
    [
        "packages/store/test/delivery-interleaving.test.ts",
        "the delivery lifecycle against its reference model, seeded histories",
    ],
    ["packages/store/test/properties.test.ts", "property invariants across the whole store"],
    [
        "packages/dev/testkit/test/testkit.test.ts",
        "the package's single barrel, specced under the package's own name",
    ],
]);

/**
 * Names that describe what a file IS instead of what it answers. The list is
 * the same offence catalogue the source tree bans at directory level.
 */
const KIND_NAMES = new Set([
    "helpers",
    "helper",
    "utils",
    "util",
    "lib",
    "common",
    "shared",
    "misc",
]);

interface TestFile {
    /** Repo-relative path, the key COMPOSITIONS uses. */
    readonly repoPath: string;
    /** Path inside the package's test/, mirroring src/'s layout. */
    readonly withinTest: string;
    readonly packageDir: string;
}

function testFiles(): TestFile[] {
    const found: TestFile[] = [];
    for (const packageDir of workspacePackages()) {
        const testDir = join(repoRoot, packageDir, "test");
        if (!existsSync(testDir)) continue;
        const entries = readdirSync(testDir, { recursive: true }) as string[];
        for (const entry of entries) {
            const withinTest = normalizeRepoPath(entry);
            if (!withinTest.endsWith(".ts")) continue;
            found.push({
                repoPath: `${packageDir}/test/${withinTest}`,
                withinTest,
                packageDir,
            });
        }
    }
    return found;
}

describe("every test file answers to a findable name", () => {
    const files = testFiles();
    const specs = files.filter((file) => file.withinTest.endsWith(".test.ts"));

    it("finds the workspace's test files", () => {
        // A walk that silently returned nothing makes every check below vacuous.
        expect(specs.length).toBeGreaterThan(25);
    });

    it("a spec mirrors its module, or is registered with the question it answers", () => {
        const offenders: string[] = [];
        for (const spec of specs) {
            const srcDir = join(repoRoot, spec.packageDir, "src");
            if (!existsSync(srcDir)) continue;
            const mirrored = join(srcDir, spec.withinTest.replace(/\.test\.ts$/, ".ts"));
            if (existsSync(mirrored)) continue;
            if (COMPOSITIONS.has(spec.repoPath)) continue;
            offenders.push(`${spec.repoPath} (no src mirror; register it here or rename it)`);
        }
        expect(offenders).toEqual([]);
    });

    it("every registration names a file that still exists", () => {
        const stale = [...COMPOSITIONS.keys()].filter(
            (repoPath) => !existsSync(join(repoRoot, repoPath)),
        );
        expect(stale).toEqual([]);
    });

    it("no registration shadows a mirror that now exists", () => {
        // The mirror wins: once src/<name>.ts appears, the entry is expired
        // and the file is that module's spec, not a composition.
        const expired = [...COMPOSITIONS.keys()].filter((repoPath) => {
            const spec = specs.find((candidate) => candidate.repoPath === repoPath);
            if (spec === undefined) return false;
            const mirrored = join(
                repoRoot,
                spec.packageDir,
                "src",
                spec.withinTest.replace(/\.test\.ts$/, ".ts"),
            );
            return existsSync(mirrored);
        });
        expect(expired).toEqual([]);
    });

    it("no file under test/ is named by kind", () => {
        const offenders = files
            .map((file) => file.repoPath)
            .filter((repoPath) => {
                const base = repoPath
                    .split("/")
                    .pop()!
                    .replace(/\.test\.ts$|\.ts$/, "");
                return KIND_NAMES.has(base);
            });
        expect(offenders).toEqual([]);
    });

    it("proves the detectors can fail", () => {
        // Negative control: a kind-name and an unmirrored, unregistered spec
        // must both be things the predicates above would actually flag.
        expect(KIND_NAMES.has("helpers")).toBe(true);
        expect(COMPOSITIONS.has("packages/core/test/unregistered.test.ts")).toBe(false);
        expect(existsSync(join(repoRoot, "packages/core/src/unregistered.ts"))).toBe(false);
    });
});
