/**
 * Several `docs/` tables restate closed vocabularies the code owns — one fact
 * in two places, aimed at a reader who cannot run the compiler that would catch
 * the drift (D83). This file locks the identifier columns and severity groups
 * it names below; explanatory and behavior prose remains review-owned. Where
 * no runtime array exists, a mapped type makes a new code fail to compile until
 * the corresponding documented vocabulary follows (D76).
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
    MAPPABLE_MEANINGS,
    REPOSITORY_MODES,
    TOP_LEVEL_KEYS,
    type ConfigErrorCode,
} from "@hiero-hackers/automation-core";
import type { RecordOnlyCode, SafetyRefusalCode } from "@hiero-hackers/automation-core";
import { verdictFinding, type Severity } from "@hiero-hackers/automation-core";
import { docsDir, exampleFiles, normalizeNewlines, repoRoot } from "./repository.js";

const page = (name: string): string => normalizeNewlines(readFileSync(join(docsDir, name), "utf8"));

/**
 * The kinds of record the shell persists for one delivery. `ShellRecord` is a
 * private union rather than an exported vocabulary, so there is nothing to
 * import: this reads the declaration's text, the way every repository check
 * reads another package's file (D85).
 */
function shellRecordKinds(): string[] {
    const source = normalizeNewlines(
        readFileSync(join(repoRoot, "packages/shell/src/processor.ts"), "utf8"),
    );
    const union = source.split("type ShellRecord =")[1]?.split("\n\n")[0] ?? "";
    return [...union.matchAll(/readonly kind: "([A-Za-z]+)"/g)].map((m) => m[1]!);
}

/** The first backtick-quoted token of each table row in one `## section`. */
function tableCodes(markdown: string, heading: string): string[] {
    const section = markdown.split(/^## /m).find((s) => s.startsWith(heading));
    expect(section, `section "${heading}" exists`).toBeDefined();
    return [...(section ?? "").matchAll(/^\|\s*`([^`\r\n]+)`\s*\|/gm)].map((m) => m[1]!);
}

/** Every backtick-quoted token in a section, for the non-table list. */
function inlineCodes(markdown: string, heading: string): string[] {
    const section = markdown.split(/^## /m).find((s) => s.startsWith(heading));
    expect(section, `section "${heading}" exists`).toBeDefined();
    return [...(section ?? "").matchAll(/`([^`\r\n]+)`/g)].map((m) => m[1]!);
}

describe("documentation parsing", () => {
    it.each(["\n", "\r\n"])("reads tables with %j line endings", (newline) => {
        const markdown = [
            "## Codes",
            "",
            "| Code | Meaning |",
            "| --- | --- |",
            "| `first` | one |",
            "| `second` | two |",
            "| `invented_2` | three |",
            "",
            "## Next",
        ].join(newline);
        expect(tableCodes(normalizeNewlines(markdown), "Codes")).toEqual([
            "first",
            "second",
            "invented_2",
        ]);
    });
});

describe("docs/quickstart.md", () => {
    /**
     * The wording is deliberately unpinned: what is locked is that both entry
     * pages HAVE a banner and that the two agree, so a rewrite lands in both.
     */
    it("carries a banner identical to the index's", () => {
        const banner = (name: string) =>
            page(name)
                .split("\n")
                .filter((l) => l.startsWith(">"))
                .join("\n");
        expect(banner("quickstart.md")).not.toBe("");
        expect(banner("quickstart.md")).toEqual(banner("README.md"));
    });

    it("the index links to every other page", () => {
        const index = page("README.md");
        for (const target of ["quickstart.md", "configuration.md", "troubleshooting.md"]) {
            expect(index).toContain(`(${target})`);
        }
    });

    /**
     * Both directions: a tested example nobody is pointed at is dead weight,
     * and a link to a renamed file is a 404 in the most-read page.
     */
    it("offers every tested example, and links no phantom ones", () => {
        const quickstart = page("quickstart.md");
        const shipped = exampleFiles();
        const linked = [...quickstart.matchAll(/\]\(examples\/([a-z-]+\.yml)\)/g)]
            .map((m) => m[1]!)
            .sort();
        expect(linked).toEqual(shipped);
    });

    it("its mode table is the mode union, in ladder order", () => {
        expect(tableCodes(page("quickstart.md"), "Choosing a mode")).toEqual([...REPOSITORY_MODES]);
    });
});

describe("docs/configuration.md", () => {
    const doc = page("configuration.md");

    /** Both pages state the exact scope of their locks and disclaim prose coverage. */
    it("states the scope and limit of its drift checks, as does troubleshooting", () => {
        const promises = {
            "configuration.md":
                "The test suite locks this page's closed vocabularies—top-level keys, modes, meanings, and rejection\ncodes—against the code on every commit. Explanatory behavior still requires review.",
            "troubleshooting.md":
                "The test suite locks the code membership and severity grouping on this page against the implementation\non every commit. The plain-language explanations still require review.",
        } as const;
        const unscoped = /every table.{0,80}(code-derived|locked|against the code)/is;

        for (const [name, promise] of Object.entries(promises)) {
            expect(page(name), name).toContain(promise);
            expect(page(name), name).not.toMatch(unscoped);
        }
        expect(unscoped.test("Every table is code-derived and locked against the code.")).toBe(
            true,
        );
    });

    /**
     * The tree claims to be "the entire shape" and is the first thing on the
     * page, so both the claim and its stated count are held to the key list.
     */
    it("the at-a-glance tree shows every key, and states the true count", () => {
        const glance = doc.split("## The file at a glance")[1]?.split(/^## /m)[0] ?? "";
        for (const key of TOP_LEVEL_KEYS) {
            expect(glance, `tree shows ${key}`).toContain(`${key}:`);
        }
        expect(glance).toContain(`${TOP_LEVEL_KEYS.length} top-level keys`);
    });

    // A reference guide's characteristic failure is INCOMPLETENESS, so the
    // definition list is held to the key list the unknown-key rule uses.
    it("defines every top-level key, and invents none", () => {
        const defined = [...doc.matchAll(/^### `([a-zA-Z]+)`$/gm)].map((m) => m[1]!);
        expect(defined).toEqual([...TOP_LEVEL_KEYS]);
    });

    it("gives every key a type and a default, or says it is required", () => {
        for (const key of TOP_LEVEL_KEYS) {
            const section = doc.split(`### \`${key}\``)[1] ?? "";
            const table = section.split("\n\n")[1] ?? "";
            expect(table, `${key} has a definition table`).toContain("| Type |");
            expect(table, `${key} states required-or-default`).toMatch(/\| (Required|Default) \|/);
        }
    });

    it("its mode table matches the modes, and the ladder is in order", () => {
        const ladder = doc.split("| Mode | Reads |")[1]?.split("\n\n")[0] ?? "";
        expect([...ladder.matchAll(/^\| `([a-z-]+)` \|/gm)].map((m) => m[1])).toEqual([
            ...REPOSITORY_MODES,
        ]);
    });

    it("its meanings table is the meanings union, exactly", () => {
        expect(tableCodes(doc, "Label mappings")).toEqual([...MAPPABLE_MEANINGS]);
    });

    /** `ConfigErrorCode` has no runtime array, so the catalogue is a mapped type (D76). */
    it("its error table is the error catalogue, exactly", () => {
        const CATALOGUE: { readonly [K in ConfigErrorCode]: true } = {
            documentUnparseable: true,
            duplicateKey: true,
            notAMapping: true,
            unknownKey: true,
            schemaVersionUnsupported: true,
            modeInvalid: true,
            capabilityNameInvalid: true,
            capabilityEnabledNotBoolean: true,
            capabilityUnknown: true,
            meaningNotMappable: true,
            meaningRequired: true,
            labelInvalid: true,
            labelNotInjective: true,
            principalNotAString: true,
        };
        expect(tableCodes(doc, "Every way the file can be wrong").sort()).toEqual(
            Object.keys(CATALOGUE).sort(),
        );
    });
});

describe("docs/troubleshooting.md", () => {
    const doc = page("troubleshooting.md");
    const onPurpose = tableCodes(doc, "It did nothing on purpose");
    const needsYou = tableCodes(doc, "It needs something from you");
    const defects = inlineCodes(doc, "It should never happen");

    it("covers every refusal and record-only code, and invents none", () => {
        const EVERY_CODE: {
            readonly [K in SafetyRefusalCode | RecordOnlyCode]: true;
        } = {
            killSwitch: true,
            wrongEntryPoint: true,
            preventiveGateUnavailable: true,
            capabilityDisabled: true,
            permissionMissing: true,
            itemBlocked: true,
            itemClosed: true,
            preconditionStale: true,
            newerHumanChange: true,
            humanOrderingUnknown: true,
            invalidTimestamp: true,
            modeDisabled: true,
            wrongActionClass: true,
            noWarning: true,
            warningRequestMismatch: true,
            invalidDestructivePlan: true,
            graceBelowFloor: true,
            graceRunning: true,
            activityCancelled: true,
            observation: true,
            modeRecordsOnly: true,
        };
        expect([...onPurpose, ...needsYou, ...defects].sort()).toEqual(
            Object.keys(EVERY_CODE).sort(),
        );
    });

    /**
     * The page's grouping is a claim about SEVERITY, and `report/convert.ts`
     * is the authority — so ask it rather than restate its table here.
     */
    const severityOf = (code: string): Severity => {
        const RECORD_ONLY: readonly RecordOnlyCode[] = ["observation", "modeRecordsOnly"];
        const verdict = RECORD_ONLY.includes(code as RecordOnlyCode)
            ? ({ outcome: "record-only", code, reason: "r" } as const)
            : ({ outcome: "refuse", code, reason: "r" } as const);
        return verdictFinding(verdict as Parameters<typeof verdictFinding>[0], {
            kind: "repository",
        }).severity;
    };

    it("'on purpose' rows are all notices — the system working", () => {
        expect(onPurpose.length).toBeGreaterThan(0);
        for (const code of onPurpose) expect(`${code}:${severityOf(code)}`).toBe(`${code}:notice`);
    });

    /**
     * A record kind is not a verdict code, so it reaches none of the tables
     * above and nothing else would notice a new one arriving undocumented —
     * which is how `modeUnsupported` shipped with nowhere to look it up.
     * `decision` is the ordinary outcome and stays out: a reader consults this
     * page only when the App recorded something INSTEAD of deciding.
     */
    it("covers every shell record that is not a decision, and invents none", () => {
        const kinds = shellRecordKinds();
        expect(kinds, "the record union parsed").toContain("decision");
        expect(tableCodes(doc, "It never got as far as deciding").sort()).toEqual(
            kinds.filter((kind) => kind !== "decision").sort(),
        );
    });

    it("'needs you' and 'never happen' rows are all problems", () => {
        expect(needsYou.length).toBeGreaterThan(0);
        expect(defects.length).toBeGreaterThan(0);
        for (const code of [...needsYou, ...defects]) {
            expect(`${code}:${severityOf(code)}`).toBe(`${code}:problem`);
        }
    });
});
