/**
 * `docs/examples/` is documentation that runs.
 *
 * The examples in `design/config/schema.md` §3 were correct when checked — and
 * correct by nobody's doing. No code had ever read YAML, so a documented file
 * could stop parsing and the only signal would be a maintainer's confusion.
 *
 * An ARTIFACT test, the same genre as `citations.test.ts`: it reads the
 * repository, and it is deliberately not where `document.ts` earns its
 * coverage. Stryker's sandbox is `core/` and nothing above it, so nothing here
 * can kill a mutant — the rejection corpus lives in `documents.ts` for exactly
 * that reason. What this file checks is that the SHIPPED examples still mean
 * what they say.
 */

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseConfigDocument } from "@hiero-hackers/automation-core";

const examplesDir = fileURLToPath(new URL("../../../docs/examples/", import.meta.url));

/** The direct capability list these schema examples are read against. */
const KNOWN = ["assignment", "intake", "prQuality"];

const parse = (file: string) =>
    parseConfigDocument(readFileSync(join(examplesDir, file), "utf8"), {
        revision: file,
        knownCapabilities: KNOWN,
    });

const files = readdirSync(examplesDir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".yml"))
    .map((e) => e.name);

describe("the shipped examples", () => {
    /**
     * A glob matching nothing passes every loop below in silence — the same
     * asymmetry that let `stryker.config.json` stop mutating three modules.
     */
    it("finds the examples at all", () => {
        expect(files.sort()).toEqual([
            "active.yml",
            "empty.yml",
            "minimal.yml",
            "observe-only.yml",
        ]);
    });

    it.each(files)("%s parses", (file) => {
        const result = parse(file);
        expect(result.ok ? [] : result.errors.map((e) => `${e.code} @ ${e.path}`)).toEqual([]);
    });

    it("the file with nothing in it is a repository in observe", () => {
        const empty = parse("empty.yml");
        expect(empty.ok && empty.config.mode).toBe("observe");
    });

    it("retains active in Core's configuration vocabulary", () => {
        const observe = parse("observe-only.yml");
        const active = parse("active.yml");
        expect(observe.ok && active.ok).toBe(true);
        if (!observe.ok || !active.ok) return;

        expect(observe.config.mode).toBe("observe");
        expect(active.config.mode).toBe("active");
        for (const [meaning, label] of Object.entries(observe.config.mappings.labels)) {
            expect(active.config.mappings.labels).toHaveProperty(meaning, label);
        }
    });

    it("a known capability may be configured while disabled", () => {
        const active = parse("active.yml");
        expect(active.ok).toBe(true);
        if (!active.ok) return;
        expect(active.config.capabilities.assignment).toMatchObject({ enabled: false });
    });

    /**
     * The README describes each example. A file added without a row is a file
     * nobody will read, and a row without a file is a promise.
     */
    it("every example is described in the README", () => {
        const readme = readFileSync(join(examplesDir, "README.md"), "utf8");
        for (const file of files) expect(readme).toContain(`\`${file}\``);
    });
});
