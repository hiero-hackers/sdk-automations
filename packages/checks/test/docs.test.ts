/**
 * `docs/` is written for maintainers who will not read much — three pages,
 * mostly tables. Every one of those tables restates a closed vocabulary the
 * code owns, which is one fact in two places: exactly the defect class D53
 * through D82 spent this repository removing, except this copy lies to a
 * maintainer instead of a compiler.
 *
 * So the tables are locked. Each vocabulary here is a mapped type over the
 * union (D76's rule), meaning this file fails to COMPILE when a code is
 * added, and the assertions fail when the docs table does not follow. Both
 * directions: a docs row naming a code that does not exist fails too.
 *
 * Artifact genre — reads the repository, like the citation invariants in this package.
 */

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
    MAPPABLE_MEANINGS,
    REPOSITORY_MODES,
    TOP_LEVEL_KEYS,
    type ConfigErrorCode,
} from "@hiero-hackers/automation-core";
import type { RecordOnlyCode, SafetyRefusalCode } from "@hiero-hackers/automation-core";
import { verdictFinding, type Severity } from "@hiero-hackers/automation-core";
import { normalizeNewlines } from "./helpers.js";

const page = (name: string): string =>
    normalizeNewlines(
        readFileSync(fileURLToPath(new URL(`../../../docs/${name}`, import.meta.url)), "utf8"),
    );

/** The first backtick-quoted token of each table row in one `## section`. */
function tableCodes(markdown: string, heading: string): string[] {
    const section = markdown.split(/^## /m).find((s) => s.startsWith(heading));
    expect(section, `section "${heading}" exists`).toBeDefined();
    return [...(section ?? "").matchAll(/^\|\s*`([a-zA-Z-]+)`\s*\|/gm)].map((m) => m[1]!);
}

/** Every backtick-quoted token in a section, for the non-table list. */
function inlineCodes(markdown: string, heading: string): string[] {
    const section = markdown.split(/^## /m).find((s) => s.startsWith(heading));
    expect(section, `section "${heading}" exists`).toBeDefined();
    return [...(section ?? "").matchAll(/`([a-zA-Z]+)`/g)].map((m) => m[1]!);
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
            "",
            "## Next",
        ].join(newline);
        expect(tableCodes(normalizeNewlines(markdown), "Codes")).toEqual(["first", "second"]);
    });
});

describe("docs/quickstart.md", () => {
    /**
     * Both are entry points — one is what GitHub renders when you open
     * `docs/`, the other is the link you would send someone — so both carry
     * the "not installable yet" banner, and prose duplicated across two files
     * is prose free to drift. Asserted identical rather than deleted from one,
     * because deleting it from either lets a reader arrive without it.
     */
    it("carries the development notice, in the same words as the index", () => {
        const banner = (name: string) =>
            page(name)
                .split("\n")
                .filter((l) => l.startsWith(">"))
                .join("\n");
        expect(banner("quickstart.md")).toContain("not yet installable");
        expect(banner("quickstart.md")).toEqual(banner("README.md"));
    });

    it("the index links to every other page", () => {
        const index = page("README.md");
        for (const target of ["quickstart.md", "configuration.md", "troubleshooting.md"]) {
            expect(index).toContain(`(${target})`);
        }
    });

    /**
     * The examples are the copy-and-paste path, so the quickstart must offer
     * every one of them: a tested file nobody is pointed at is dead weight,
     * and a link to a file that was renamed is a 404 in the one page most
     * people read. Both directions, like every other lock here.
     */
    it("offers every tested example, and links no phantom ones", () => {
        const quickstart = page("quickstart.md");
        const shipped = readdirSync(
            fileURLToPath(new URL("../../../docs/examples/", import.meta.url)),
        )
            .filter((f) => f.endsWith(".yml"))
            .sort();
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

    /**
     * Both reference pages promise that their tables are asserted against
     * the code. This is that assertion noticing itself: if the sentence is
     * ever reworded or dropped, the suite says so — a page cannot carry the
     * promise without also carrying the checks, because they arrive together.
     */
    it("carries the provenance promise, as does troubleshooting", () => {
        for (const name of ["configuration.md", "troubleshooting.md"]) {
            expect(page(name)).toContain("asserted against the code by the test suite");
        }
    });

    /**
     * A reference guide's characteristic failure is not being wrong, it is
     * being INCOMPLETE — a key nobody documented, discovered by a maintainer
     * when the App rejects their file. So the definition list is held to the
     * key list the unknown-key rule uses, in both directions.
     */
    /**
     * The at-a-glance tree claims to be "the entire shape". A tree missing a
     * key would be believed — it is the first thing on the page — so the
     * claim is held to the key list, and the stated count to its length.
     */
    it("the at-a-glance tree shows every key, and states the true count", () => {
        const glance = doc.split("## The file at a glance")[1]?.split(/^## /m)[0] ?? "";
        for (const key of TOP_LEVEL_KEYS) {
            expect(glance, `tree shows ${key}`).toContain(`${key}:`);
        }
        expect(glance).toContain(`${TOP_LEVEL_KEYS.length} top-level keys`);
    });

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

    /**
     * `ConfigErrorCode` has no runtime array to compare against, so the list
     * below is a mapped type over the union: adding a code fails compilation
     * here until the docs row exists, which is the lock working as intended.
     */
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
     * The page's grouping is a claim about SEVERITY, and the classification
     * table in `report/convert.ts` is the authority — so ask it. A code
     * filed under "on purpose" that the platform classifies as a problem is
     * the docs telling a maintainer to relax about something that needs them.
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

    it("'needs you' and 'never happen' rows are all problems", () => {
        expect(needsYou.length).toBeGreaterThan(0);
        expect(defects.length).toBeGreaterThan(0);
        for (const code of [...needsYou, ...defects]) {
            expect(`${code}:${severityOf(code)}`).toBe(`${code}:problem`);
        }
    });
});
