/**
 * The shipped `docs/examples/` files still parse, through the entry point the
 * shell uses (D82) and against the capability list the shell actually admits.
 * A documented example that stopped parsing — or that names a capability
 * nobody ships — would surface only as a maintainer's confusion.
 *
 * A repository check, not coverage: Stryker's sandbox is `core/`, so nothing
 * here can kill a mutant and the rejection corpus lives in core (D82, D85).
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseConfigDocument, type AdmittedCapability } from "@hiero-hackers/automation-core";
import { docsDir, exampleFiles, normalizeNewlines, repoRoot, sourceFiles } from "./repository.js";

const examplesDir = join(docsDir, "examples");

const read = (path: string) => normalizeNewlines(readFileSync(join(repoRoot, path), "utf8"));

/** The quoted names in one flat `field: [...]` list of a declaration. */
function declaredList(text: string, field: string): string[] {
    const body = new RegExp(`${field}: \\[([^\\]]*)\\]`).exec(text)?.[1] ?? "";
    return [...body.matchAll(/"([A-Za-z]+)"/g)].map((m) => m[1]!);
}

/**
 * Each probe's wiring identifier and everything the parser judges a document
 * against: its name, the settings keys it declares, and the meanings it
 * requires (D84).
 */
function probeDeclarations(): {
    readonly binding: string;
    readonly name: string;
    readonly configKeys: string[];
    readonly requiredMeanings: string[];
}[] {
    return sourceFiles(["src"])
        .filter((path) => path.startsWith("packages/probes/src/") && !path.endsWith("/index.ts"))
        .map((path) => {
            const text = read(path);
            const name = /declareCapability\(\{\s*name: "([A-Za-z]+)"/.exec(text)?.[1];
            const binding = /export const ([A-Za-z]+): Capability</.exec(text)?.[1];
            expect({ path, named: name !== undefined, bound: binding !== undefined }).toEqual({
                path,
                named: true,
                bound: true,
            });
            return {
                binding: binding!,
                name: name!,
                configKeys: declaredList(text, "configKeys"),
                requiredMeanings: declaredList(text, "requiredMeanings"),
            };
        });
}

/** The identifiers `createShell` is handed at the composition root. */
function wiredBindings(): string[] {
    const main = read("packages/shell/src/main.ts");
    const list = main.split("capabilities: [")[1]?.split("]")[0] ?? "";
    return [...list.matchAll(/toEngine\(([A-Za-z]+)\)/g)].map((m) => m[1]!);
}

/**
 * The capabilities the shipped shell admits — the probe declarations `main.ts`
 * wires, which is the same list the parser fails closed against with
 * `capabilityUnknown`. Read as text because this package depends on core's
 * barrel and nothing downstream of it (D85), so the probes are a file to open
 * rather than an import.
 *
 * A hand-typed literal here was the defect: it named `assignment`, which no
 * probe declares, so an example the real shell would reject parsed clean.
 *
 * Admitted as DECLARATIONS rather than names, so the examples are held to the
 * two rules a name alone cannot reach: a settings key no capability declares,
 * and an enabled capability missing a meaning it needs (D84).
 */
function shippedCapabilities(): AdmittedCapability[] {
    const byBinding = new Map(probeDeclarations().map((probe) => [probe.binding, probe]));
    return wiredBindings()
        .map((binding) => {
            const probe = byBinding.get(binding);
            expect(probe, `${binding} is a probe declaration main.ts can wire`).toBeDefined();
            return {
                name: probe!.name,
                configKeys: probe!.configKeys,
                requiredMeanings: probe!.requiredMeanings as AdmittedCapability["requiredMeanings"],
            };
        })
        .sort((a, b) => a.name.localeCompare(b.name));
}

const KNOWN = shippedCapabilities();

const parseText = (text: string, revision: string) =>
    parseConfigDocument(text, { revision, knownCapabilities: KNOWN });

const parse = (file: string) => parseText(readFileSync(join(examplesDir, file), "utf8"), file);

const files = exampleFiles();

describe("the shipped examples", () => {
    /** A directory read that finds nothing passes every loop below in silence. */
    it("finds the examples at all", () => {
        expect(files.sort()).toEqual([
            "active.yml",
            "empty.yml",
            "minimal.yml",
            "observe-only.yml",
        ]);
    });

    /** A derivation that finds nothing admits nothing, and silently. */
    it("reads the admitted capability list off the shipped probes", () => {
        expect(KNOWN.length).toBeGreaterThan(0);
        expect(KNOWN.map(({ name }) => name)).toEqual(
            probeDeclarations()
                .map(({ name }) => name)
                .sort(),
        );
    });

    /**
     * The declarations are read out of source text, so an expression that
     * matched nothing would admit every capability with no settings keys and
     * no required meanings — and every check below would pass in silence.
     * `intake` is the probe that has both, so it is the one worth pinning.
     */
    it("reads each probe's declared settings keys and required meanings", () => {
        expect(KNOWN.find(({ name }) => name === "intake")).toEqual({
            name: "intake",
            configKeys: ["announce"],
            requiredMeanings: ["awaitingTriage"],
        });
    });

    /**
     * The negative control for the list above: a name outside it is refused,
     * so a future example that configures an unshipped capability fails here
     * rather than in a maintainer's repository.
     */
    it("refuses a capability the shell does not ship", () => {
        const invented = parseText(
            "schemaVersion: 1\ncapabilities:\n  assignment:\n    enabled: false\n",
            "invented",
        );
        expect(invented.ok ? [] : invented.errors.map((e) => e.code)).toEqual([
            "capabilityUnknown",
        ]);
    });

    /**
     * The negative controls for the two rules D84 added. Without them an
     * example could quietly stop exercising either — `observe-only.yml`
     * enables `intake`, so dropping its `awaitingTriage` line is a one-word
     * edit away from a documented file the real shell refuses to parse.
     */
    it("refuses an enabled capability missing a meaning it requires", () => {
        const unmapped = parseText(
            "schemaVersion: 1\ncapabilities:\n  intake:\n    enabled: true\n",
            "unmapped",
        );
        expect(unmapped.ok ? [] : unmapped.errors.map((e) => `${e.code} @ ${e.path}`)).toEqual([
            "meaningRequired @ mappings.labels.awaitingTriage",
        ]);
    });

    it("refuses a settings key no capability declares", () => {
        const typo = parseText(
            "schemaVersion: 1\ncapabilities:\n  intake:\n    enabled: false\n    settings:\n      annouce: true\n",
            "typo",
        );
        expect(typo.ok ? [] : typo.errors.map((e) => `${e.code} @ ${e.path}`)).toEqual([
            "unknownKey @ capabilities.intake.settings.annouce",
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

    it("a shipped capability may be configured while disabled", () => {
        const active = parse("active.yml");
        expect(active.ok).toBe(true);
        if (!active.ok) return;
        expect(active.config.capabilities.inactivity).toMatchObject({ enabled: false });
    });

    /** A file with no README row is one nobody will read; a row with no file is a promise. */
    it("every example is described in the README", () => {
        const readme = readFileSync(join(examplesDir, "README.md"), "utf8");
        for (const file of files) expect(readme).toContain(`\`${file}\``);
    });
});
