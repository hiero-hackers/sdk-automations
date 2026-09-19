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
import { Ajv2020, type ErrorObject } from "ajv/dist/2020.js";
import { parse as parseYaml } from "yaml";
import { MAPPING_SECTION_KEYS, parseConfigDocument } from "@hiero-hackers/automation-core";
import { declaredCapabilityNames, shippedCapabilities } from "./capabilities.js";
import { SCHEMA_PATH } from "./editor-schema.js";
import { admittedCapabilities, parseExample, snapshotPath, snapshotText } from "./examples.js";
import { docsDir, exampleFiles, normalizeNewlines, repoRoot } from "./repository.js";

const examplesDir = join(docsDir, "examples");

/** The declarations the parser judges a document against (`examples.ts`). */
const KNOWN = admittedCapabilities();

const parseText = (text: string, revision: string) =>
    parseConfigDocument(text, { revision, knownCapabilities: KNOWN });

const parse = parseExample;

const files = exampleFiles();

describe("the shipped examples", () => {
    /** A directory read that finds nothing passes every loop below in silence. */
    it("finds the examples at all", () => {
        expect(files.sort()).toEqual([
            "active.yml",
            "empty.yml",
            "full.yml",
            "inactivity.yml",
            "minimal.yml",
            "observe-only.yml",
        ]);
    });

    /** A derivation that finds nothing admits nothing, and silently. */
    it("reads the admitted capability list off the shipped capabilities", () => {
        expect(KNOWN.length).toBeGreaterThan(0);
        expect(KNOWN.map(({ name }) => name)).toEqual(declaredCapabilityNames());
    });

    /**
     * The declarations are read out of source text, so an expression that
     * matched nothing would admit every capability with no settings keys and
     * no required mappings — and every check below would pass in silence.
     * `intake` is the capability that has both, so it is the one worth pinning.
     */
    it("reads each capability's declared settings keys and required mappings", () => {
        const intake = KNOWN.find(({ name }) => name === "intake");
        expect(Object.keys(intake?.settings ?? {})).toEqual([
            "announce",
            "unlockWhen",
            "confirmUnlock",
        ]);
        expect(intake?.requiredMappings).toEqual({ labels: ["awaitingTriage"] });
    });

    /**
     * The negative control for the list above: a name outside it is refused,
     * so a future example that configures an unshipped capability fails here
     * rather than in a maintainer's repository.
     *
     * The name has to be one NO capability will ever have (D8). This control
     * named `assignment` — a real design, unshipped on the day it was written —
     * and shipping that capability would have broken the test proving unknown
     * names are refused, which is a negative control that expires the moment it
     * matters.
     */
    it("refuses a capability the shell does not ship", () => {
        const invented = parseText(
            "schemaVersion: 1\ncapabilities:\n  neverShipped:\n    enabled: false\n",
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
    /** D203: the meaning a capability requires is mapped by default, so the file parses. */
    it("accepts an enabled capability on the default spelling of the meaning it requires", () => {
        const unmapped = parseText(
            "schemaVersion: 1\ncapabilities:\n  intake:\n    enabled: true\n",
            "unmapped",
        );
        expect(unmapped.ok ? unmapped.config.mappings.labels.awaitingTriage : unmapped.errors).toBe(
            "status: triage",
        );
    });

    it("refuses a settings key no capability declares", () => {
        const typo = parseText(
            "schemaVersion: 1\ncapabilities:\n  intake:\n    enabled: false\n    annouce: true\n",
            "typo",
        );
        expect(typo.ok ? [] : typo.errors.map((e) => `${e.code} @ ${e.path}`)).toEqual([
            "unknownKey @ capabilities.intake.annouce",
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
        // Both carry every meaning: one spells `ready` its own way, the other runs on defaults.
        expect(Object.keys(active.config.mappings.labels)).toEqual(
            Object.keys(observe.config.mappings.labels),
        );
    });

    it("a shipped capability may be configured while disabled", () => {
        const active = parse("active.yml");
        expect(active.ok).toBe(true);
        if (!active.ok) return;
        expect(active.config.capabilities.inactivity).toMatchObject({ enabled: false });
    });

    /**
     * The one example that shows everything: every shipped capability switched
     * on, every mapping family filled. A capability the registry gains and
     * this file does not is a capability the documentation never shows
     * configured — and the file's own comment claims completeness.
     */
    it("full.yml enables every shipped capability and fills every mapping family", () => {
        const full = parse("full.yml");
        expect(full.ok).toBe(true);
        if (!full.ok) return;
        const enabled = Object.entries(full.config.capabilities)
            .filter(([, block]) => block.enabled)
            .map(([name]) => name)
            .sort();
        expect(enabled).toEqual(KNOWN.map(({ name }) => name));
        for (const family of MAPPING_SECTION_KEYS) {
            expect(Object.keys(full.config.mappings[family]), family).not.toEqual([]);
        }
        expect(Object.keys(full.config.principals)).not.toEqual([]);
    });

    /**
     * The schedule-driven example enables nothing a webhook drives — a SUBSET,
     * not the whole scheduled list. Equality made the second capability on the
     * schedule a change to this file and to the example's own prose, which is
     * the opposite of what the example is showing: it is one repository's
     * choice, not the roster.
     */
    it("inactivity.yml enables only capabilities the schedule drives", () => {
        const scheduled = shippedCapabilities()
            .filter(({ triggers }) => triggers.every((t) => t.kind === "schedule"))
            .map(({ name }) => name);
        const example = parse("inactivity.yml");
        expect(example.ok).toBe(true);
        if (!example.ok) return;
        const enabled = Object.entries(example.config.capabilities)
            .filter(([, block]) => block.enabled)
            .map(([name]) => name);
        // An example that enabled nothing would satisfy any subset claim.
        expect(enabled).not.toEqual([]);
        expect(enabled.filter((name) => !scheduled.includes(name))).toEqual([]);
    });

    /**
     * The quickstart's own blocks are complete documents a reader is told to
     * copy, so they are held to the parser the same way the files are — a
     * setup that stopped parsing would surface only as a maintainer's
     * `configRejected` record.
     */
    it("every configuration block in the quickstart parses", () => {
        const quickstart = normalizeNewlines(readFileSync(join(docsDir, "quickstart.md"), "utf8"));
        const blocks = [...quickstart.matchAll(/```yaml\n([\s\S]*?)```/g)].map((m) => m[1]!);
        expect(blocks.length).toBeGreaterThan(1);
        for (const [i, block] of blocks.entries()) {
            const result = parseText(block, `quickstart block ${String(i + 1)}`);
            expect(
                result.ok ? [] : result.errors.map((e) => `${e.code} @ ${e.path}`),
                `quickstart block ${String(i + 1)}`,
            ).toEqual([]);
        }
    });

    /** A file with no README row is one nobody will read; a row with no file is a promise. */
    it("every example is described in the README", () => {
        const readme = readFileSync(join(examplesDir, "README.md"), "utf8");
        for (const file of files) expect(readme).toContain(`\`${file}\``);
    });
});

/**
 * The editor schema accepts what the parser accepts.
 *
 * `docs.test.ts` holds the schema FILE to what the specs generate; this is the
 * other half, and the only one that could catch a generated schema that is
 * valid JSON Schema and wrong — a capability's settings rendered as the wrong
 * type, an `additionalProperties` a level too high. A maintainer whose editor
 * underlines a documented example has been told a lie by the file we ship.
 *
 * `ajv` through its 2020-12 entry point, because the schema declares that
 * draft. A real validator rather than a hand-rolled walk: the point of the
 * check is that the SAME software the maintainer's editor runs agrees.
 */
describe("the editor schema accepts the shipped examples", () => {
    const schema = JSON.parse(readFileSync(join(repoRoot, SCHEMA_PATH), "utf8")) as object;
    const validate = new Ajv2020({ allErrors: true }).compile(schema);

    /** Every failure at once, as an editor would underline them. */
    const failures = (document: unknown): string[] =>
        validate(document)
            ? []
            : (validate.errors ?? []).map(
                  (e: ErrorObject) => `${e.instancePath || "/"} ${e.message ?? ""}`,
              );

    const documentIn = (file: string): unknown =>
        parseYaml(readFileSync(join(examplesDir, file), "utf8"));

    /**
     * A file of nothing but comments parses to `null`, which is the parser's
     * no-configuration path rather than a document to check (`parse.ts`). It
     * is named here so the skip cannot go silent.
     */
    it("is one empty example, which has no document to check", () => {
        expect(files.filter((file) => documentIn(file) === null)).toEqual(["empty.yml"]);
    });

    it.each(files)("%s satisfies the schema", (file) => {
        const document = documentIn(file);
        if (document === null) return;
        expect(failures(document), file).toEqual([]);
    });

    /**
     * The negative control, and the exact mistake the schema exists for: one
     * transposition in a settings key. `annouce:` was a working file that did
     * the opposite of what it said until D84 made it an error at parse — an
     * editor should say so before the file is ever pushed.
     */
    it("refuses a settings key no capability declares", () => {
        const typo = documentIn("full.yml") as {
            capabilities: { intake: Record<string, unknown> };
        };
        typo.capabilities.intake = { enabled: true, annouce: true };
        expect(failures(typo).join(" ")).toContain("/capabilities/intake");
    });
});

/**
 * The value-level pin the configuration migration (C1, C2) is held to: each
 * example as the `RepositoryConfig` it parses to today, committed.
 *
 * The checks above say a file still parses; these say it parses to the same
 * VALUE — defaults applied, families filled, revision stamped. A later phase
 * that changes how a file parses must change these files deliberately and say
 * what changed; an accidental change turns up here as a diff rather than as a
 * maintainer's repository behaving differently.
 *
 * The repair is `pnpm contracts`, which rewrites these the same way it
 * rewrites every other generated artifact (`examples.ts`, `generated.ts`).
 * The text compared here is the runner's own, so the two cannot disagree
 * about an indent and no `vitest -u` is needed to repair one.
 */
describe("the shipped examples parse to the value they parsed to", () => {
    it.each(files)("%s parses to its committed value", async (file) => {
        const result = parse(file);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        await expect(
            snapshotText(result.config),
            `${file} parses to a different value than its committed pin — if the change is meant, run \`pnpm contracts\` to rewrite the pin`,
        ).toMatchFileSnapshot(join(repoRoot, snapshotPath(file)));
    });
});
