/**
 * References resolve: cited paths exist, named files exist, cited decision
 * rows exist. Three describes, one theme — a reference that points at
 * nothing breaks nothing, so only a test can see it.
 * Split from repo-artifacts.test.ts (D89).
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { normalizeRepoPath, repoRoot, trackedFiles, workspacePackages } from "./helpers.js";

/**
 * A citation that points at a file which no longer exists breaks nothing.
 * No test fails, no build breaks, no reader is warned — the reference simply
 * becomes a lie, and the register's whole method is that a row cites the code
 * proving it. Fifty-one such citations exist today, and the directory
 * reorganisation is about to move most of the files they name.
 *
 * Same class as the mutate glob: silent when wrong, so it needs a test rather
 * than care.
 */
describe("documents cite files that exist", () => {
    const docs = trackedFiles()
        .filter((rel) => rel.endsWith(".md"))
        .map((rel) => ({ doc: rel, text: readFileSync(join(repoRoot, rel), "utf8") }));

    // Package alternation from the workspace file, not a literal: the day
    // shell/ arrived, a hardcoded list left every `shell/src/…` and
    // `lab/src/…` citation silently unchecked — the mutate-glob failure in
    // yet another coat, caught in the same file that documents the last one.
    const PATH = new RegExp(
        String.raw`\b((?:${workspacePackages().join("|")})\/(?:src|test)\/[A-Za-z0-9._/-]+\.ts)\b`,
        "g",
    );

    /**
     * The blind spot the audit/planning consolidation exposed: sixteen
     * documents cited `audit/…` and `planning/…` paths, the directories
     * moved, and this suite stayed green — the regex above knows only
     * TypeScript. Now that the top level is closed (every knowledge file
     * lives under design/, docs/ or examples/), repo-rooted document paths
     * are checkable with the same rigour as source paths.
     */
    // Exactly the top-level knowledge roots. `examples` left this list when
    // it moved under docs/ (D97): a bare `examples/x.yml` is no longer a
    // repo-rooted path, it is a docs-RELATIVE link, and claiming otherwise
    // made this check report four links that resolve perfectly. Relative
    // targets are `links.test.ts`'s job; `docs/examples/…` still matches here.
    const DOC_PATH = /\b((?:design|docs)\/[A-Za-z0-9._/-]+\.(?:md|yml))\b/g;

    it("finds documents and citations to check", () => {
        expect(docs.length).toBeGreaterThan(5);
        const total = docs.reduce((n, d) => n + [...d.text.matchAll(PATH)].length, 0);
        expect(total).toBeGreaterThan(20);
    });

    it("every cited source path resolves to a real file", () => {
        const dangling: string[] = [];
        for (const { doc, text } of docs) {
            for (const match of text.matchAll(PATH)) {
                const cited = match[1]!;
                if (!existsSync(join(repoRoot, cited))) {
                    dangling.push(`${doc} -> ${cited}`);
                }
            }
        }
        expect(dangling).toEqual([]);
    });

    it("every cited document path resolves to a real file", () => {
        const dangling: string[] = [];
        for (const { doc, text } of docs) {
            for (const match of text.matchAll(DOC_PATH)) {
                const cited = match[1]!;
                if (!existsSync(join(repoRoot, cited))) {
                    dangling.push(`${doc} -> ${cited}`);
                }
            }
        }
        expect([...new Set(dangling)]).toEqual([]);
    });

    it("proves the check can fail", () => {
        // Negative control, both directions: the matcher must find a path and
        // the existence check must reject one that is not there.
        const fake = "see `packages/core/src/nonexistent.ts` and `design/audit/nope.md`";
        expect([...fake.matchAll(PATH)].map((m) => m[1])).toEqual([
            "packages/core/src/nonexistent.ts",
        ]);
        expect([...fake.matchAll(DOC_PATH)].map((m) => m[1])).toEqual(["design/audit/nope.md"]);
        expect(existsSync(join(repoRoot, "packages/core/src/nonexistent.ts"))).toBe(false);
        expect(existsSync(join(repoRoot, "design/audit/nope.md"))).toBe(false);
        expect(existsSync(join(repoRoot, "packages/core/src/index.ts"))).toBe(true);
        expect(existsSync(join(repoRoot, "design/audit/services.md"))).toBe(true);
    });
});

/**
 * The blind spot in the check above, found the hard way: it validates
 * `packages/core/src/….ts` PATHS, and the architecture diagram in `packages/core/README.md`
 * named six files as bare mermaid labels — `taxonomy.ts`, `config.ts` and
 * the rest. The directory reorganisation deleted every one of them and the
 * diagram sailed through, still describing a package that no longer existed.
 *
 * Diagrams are where a visual reader looks first, so a stale one misleads
 * more than a stale sentence. This matches on the FILENAME rather than the
 * path — deliberately lenient, because a document may reasonably mention a
 * file without siting it, and the failure worth catching is a name that
 * refers to nothing at all.
 */
describe("documents name files that exist", () => {
    const sourceNames = new Set<string>();
    // Every workspace package, from the workspace file — a hardcoded list
    // here silently un-resolved every filename in checks/ and lab/ the day
    // those packages arrived, the mutate-glob failure in a new coat.
    for (const pkg of workspacePackages()) {
        for (const dir of ["src", "test"]) {
            try {
                for (const rel of readdirSync(join(repoRoot, pkg, dir), {
                    recursive: true,
                }) as string[]) {
                    const normalized = normalizeRepoPath(rel);
                    if (normalized.endsWith(".ts")) {
                        sourceNames.add(normalized.split("/").pop()!);
                    }
                }
            } catch {
                // a package need not have both directories
            }
        }
    }

    const docs = trackedFiles().filter((rel) => rel.endsWith(".md"));

    const NAME = /(?<![\w/.-])([a-z][a-z0-9-]*\.ts)(?![\w-])/g;

    /**
     * Files a document names DELIBERATELY before they exist — `github/`'s
     * README lists what the adapter will bring. The list cleans itself up:
     * the test below fails if an entry starts existing, so a planned file
     * arriving forces the exemption to be deleted rather than lingering as
     * a permanent hole in the check.
     */
    // events.ts arrived 2026-08-07 (the slice) and left this list, as designed;
    // the planned subscription list took the name subscriptions.ts when the
    // normalizer moved to engine/ and freed then re-shadowed the old name.
    const PLANNED = new Set(["endpoints.ts", "subscriptions.ts"]);

    it("no planned filename has quietly started existing", () => {
        const arrived = [...PLANNED].filter((name) => sourceNames.has(name));
        expect(arrived).toEqual([]);
    });

    it("knows the source filenames and finds names to check", () => {
        expect(sourceNames.size).toBeGreaterThan(15);
        expect(docs.length).toBeGreaterThan(5);
    });

    it("every bare source filename in a document resolves to a real file", () => {
        const unknown: string[] = [];
        for (const doc of docs) {
            const text = readFileSync(join(repoRoot, doc), "utf8");
            // D108 is an immutable historical record of a source split whose
            // extracted file has since been deleted. Keep that row verbatim;
            // active documentation remains subject to the filename check.
            const activeText =
                doc === "design/decisions.md" ? text.replace(/^\| D108 \|.*$/m, "") : text;
            for (const match of activeText.matchAll(NAME)) {
                const name = match[1]!;
                if (!sourceNames.has(name) && !PLANNED.has(name)) {
                    unknown.push(`${doc} -> ${name}`);
                }
            }
        }
        expect([...new Set(unknown)]).toEqual([]);
    });

    it("proves the check can fail", () => {
        expect(sourceNames.has("write.ts")).toBe(true);
        expect(sourceNames.has("taxonomy.ts")).toBe(false);
        expect([..."see `taxonomy.ts` and `write.ts`".matchAll(NAME)].map((m) => m[1])).toEqual([
            "taxonomy.ts",
            "write.ts",
        ]);
    });
});

/**
 * The sixth invariant, added because the fifth did not catch its own author.
 *
 * `D77` was cited three times in `core/src` before the register row existed.
 * The citation checks above validate file PATHS and FILENAMES; a decision id
 * is neither, so code could point at a row nobody had written. That is the
 * register's method inverted — a decision cites the code proving it, and here
 * the code cited a decision proving nothing.
 */
describe("code cites decisions that exist", () => {
    const register = readFileSync(join(repoRoot, "design", "decisions.md"), "utf8");
    const recorded = new Set([...register.matchAll(/^\| (D\d+) \|/gm)].map((m) => m[1]!));

    const sources: { file: string; text: string }[] = [];
    // Every workspace package, same reason as the filename check above: a
    // hardcoded trio left probes', lab's and then shell's D-citations
    // pointing at rows nobody had verified exist.
    for (const pkg of workspacePackages()) {
        let rels: string[];
        try {
            rels = readdirSync(join(repoRoot, pkg, "src"), {
                recursive: true,
            }) as string[];
        } catch {
            continue; // a package need not have src/
        }
        for (const rawRel of rels) {
            const rel = normalizeRepoPath(rawRel);
            if (rel.endsWith(".ts")) {
                sources.push({
                    file: `${pkg}/src/${rel}`,
                    text: readFileSync(join(repoRoot, pkg, "src", rel), "utf8"),
                });
            }
        }
    }

    it("knows the register's rows and finds citations to check", () => {
        expect(recorded.size).toBeGreaterThan(50);
        const cited = sources.flatMap((s) => [...s.text.matchAll(/\bD\d+\b/g)]);
        expect(cited.length).toBeGreaterThan(20);
    });

    it("every decision id cited in source appears in the register", () => {
        const dangling: string[] = [];
        for (const { file, text } of sources) {
            for (const m of text.matchAll(/\bD\d+\b/g)) {
                if (!recorded.has(m[0])) dangling.push(`${file} -> ${m[0]}`);
            }
        }
        expect([...new Set(dangling)]).toEqual([]);
    });

    it("proves the check can fail", () => {
        expect(recorded.has("D77")).toBe(true);
        expect(recorded.has("D9999")).toBe(false);
    });
});
