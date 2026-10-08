/**
 * `parseConfigDocument` — the layer between a file and `parseConfig`.
 *
 * The rejection corpus stays IN-PACKAGE. Stryker's sandbox is `core/` and
 * nothing above it, so a corpus at the repository root is never copied: the
 * tests reading it run, pass, and kill no mutants. That is how this module
 * once scored 0.00%.
 */

import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
    parseConfigDocument,
    type ConfigError,
    type ConfigErrorCode,
} from "../../src/config/index.js";
// Not via the barrel: `lineOfPath` is the rule `line` is resolved by, and the
// only caller that matters is `parseConfigDocument` in the same file.
import { lineOfPath } from "../../src/config/document.js";
import {
    DOCUMENT_ADMISSIONS,
    DOCUMENT_REJECTIONS,
    expectRejection,
    UNBUILT_DESIGNS_YAML,
} from "./documents.js";

// Admissions carry a spec, which is what makes the settings-key,
// settings-value and required-meaning rules document-reachable (D84, C1).
const OPTIONS = { revision: "rev-test", knownCapabilities: DOCUMENT_ADMISSIONS };
const parse = (yaml: string) => parseConfigDocument(yaml, OPTIONS);

describe("every rejection the catalogue names is reachable", () => {
    /**
     * A mapped type over the union rather than a list — D76's rule applied to
     * a catalogue. Adding a member to `ConfigErrorCode` fails compilation here
     * until someone writes a document that reaches it, which is the only
     * mechanism that keeps a catalogue and its demonstrations in step without
     * a human remembering to.
     */
    const REQUIRED: { readonly [K in ConfigErrorCode]: true } = {
        documentUnparseable: true,
        duplicateKey: true,
        notAMapping: true,
        unknownKey: true,
        schemaVersionUnsupported: true,
        modeInvalid: true,
        capabilityNameInvalid: true,
        capabilityEnabledNotBoolean: true,
        capabilityUnknown: true,
        settingInvalid: true,
        meaningNotMappable: true,
        meaningRequired: true,
        labelInvalid: true,
        labelNotInjective: true,
        commandNotMappable: true,
        commandInvalid: true,
        commandNotInjective: true,
        skillNotMappable: true,
        skillInvalid: true,
        skillNotInjective: true,
        alertInvalid: true,
        alertNotInjective: true,
        principalNameInvalid: true,
        principalNotAString: true,
    };

    it("has at least one document for every code", () => {
        const covered = new Set(DOCUMENT_REJECTIONS.map((r) => r.code));
        expect(
            [...Object.keys(REQUIRED)].filter((c) => !covered.has(c as ConfigErrorCode)),
        ).toEqual([]);
    });

    it.each(DOCUMENT_REJECTIONS.map((r) => [`${r.code}: ${r.why}`, r] as const))(
        "%s",
        (_name, rejection) => {
            expectRejection(parse(rejection.yaml), rejection);
        },
    );
});

/** An ACCEPTANCE, which no rejection row can make: no version line is the current format. */
describe("a document that states no version", () => {
    it("is the current format, and needs nothing else to be whole", () => {
        for (const yaml of [`mode: observe\ncapabilities: {}\n`, `mode: observe\n`]) {
            const result = parse(yaml);
            expect(result.ok, yaml).toBe(true);
            if (result.ok) expect(result.config.schemaVersion).toBe(2);
        }
    });
});

describe("a document-level problem reports where it is", () => {
    /**
     * `ConfigError.path` is a dotted path into a mapping, and a file that never
     * became a mapping has none — so for these errors the POSITION is the whole
     * contract. A check run with neither path nor position can only paste a
     * paragraph, which is what D75 existed to stop.
     */
    it.each(
        DOCUMENT_REJECTIONS.filter(
            (r) =>
                !r.synthesised && (r.code === "documentUnparseable" || r.code === "duplicateKey"),
        ).map((r) => [r.why, r.yaml] as const),
    )("%s", (_why, yaml) => {
        const result = parse(yaml);
        expect(result.ok).toBe(false);
        if (result.ok) return;
        for (const error of result.errors) {
            expect(error.path).toBeNull();
            expect(error.message).toMatch(/line \d+, column \d+/);
        }
    });

    // Which line, not just that there is one, is pinned by the duplicate-key
    // row's `messageIncludes` in the corpus.

    /**
     * And they carry no `line`. The library's message already has the position
     * and a source excerpt, so a second copy is one fact twice (D77).
     */
    it.each(
        DOCUMENT_REJECTIONS.filter(
            (r) => r.code === "documentUnparseable" || r.code === "duplicateKey",
        ).map((r) => [r.why, r.yaml] as const),
    )("%s: no line field", (_why, yaml) => {
        const result = parse(yaml);
        expect(result.ok).toBe(false);
        if (result.ok) return;
        for (const error of result.errors) expect(error.line).toBeUndefined();
    });
});

describe("a rejection with a path carries the line that path sits on", () => {
    /** The errors one document produces, in the order `parse.ts` emits them. */
    const errorsOf = (yaml: string): readonly ConfigError[] => {
        const result = parse(yaml);
        expect(result.ok).toBe(false);
        return result.ok ? [] : result.errors;
    };

    it("a wrong-typed mode points at the mode: line", () => {
        const [error] = errorsOf(`schemaVersion: 2\nmode: sideways\ncapabilities: {}\n`);
        expect(error?.code).toBe("modeInvalid");
        expect(error?.line).toBe(2);
    });

    it("an unknown top-level key points at itself", () => {
        const [error] = errorsOf(`schemaVersion: 2\nmode: observe\ncapabilties: {}\n`);
        expect(error?.code).toBe("unknownKey");
        expect(error?.line).toBe(3);
    });

    /**
     * The point of the walk. A path three levels down resolves to the key at
     * the bottom of it — `annouce:` — and not to the block it lives in, which
     * is what a maintainer fixing a typo needs the annotation on (D84).
     */
    it("an unknown setting points at the setting, not at its block", () => {
        const [error] = errorsOf(
            `schemaVersion: 2\nmode: observe\ncapabilities:\n  triageQueue:\n    enabled: true\n` +
                `    annouce: true\nmappings:\n  labels:\n    awaitingTriage: "status: triage"\n`,
        );
        expect(error?.path).toBe("capabilities.triageQueue.annouce");
        expect(error?.line).toBe(6);
    });

    /**
     * A required mapping is the one error whose path names something the
     * document does NOT contain, so it is the nearest-ancestor rule's only
     * document-reachable demonstration: the deepest node the walk reaches.
     */
    const NEEDS_WORKING = `schemaVersion: 2\ncapabilities:\n  tracker:\n    enabled: true\n`;

    it("a required mapping lands on commands: when the family is there", () => {
        const [error] = errorsOf(`${NEEDS_WORKING}mappings:\n  commands:\n    assign: "/assign"\n`);
        expect(error?.path).toBe("mappings.commands.working");
        expect(error?.line).toBe(6);
    });

    it("a required mapping lands on mappings: when there is no commands:", () => {
        const [error] = errorsOf(`${NEEDS_WORKING}mappings:\n  alerts:\n    critical: "P0"\n`);
        expect(error?.path).toBe("mappings.commands.working");
        expect(error?.line).toBe(5);
    });

    it("a required mapping has no line at all when there is no mappings:", () => {
        const [error] = errorsOf(NEEDS_WORKING);
        expect(error?.path).toBe("mappings.commands.working");
        expect(error?.line).toBeUndefined();
    });

    it("a document that never became a mapping has no line", () => {
        const [error] = errorsOf(`just a string\n`);
        expect(error?.code).toBe("notAMapping");
        expect(error?.path).toBeNull();
        expect(error?.line).toBeUndefined();
    });

    /**
     * A pair's line is its KEY's line. A value can begin further down — an
     * indented scalar, a block scalar, a nested block — and the key is the
     * character a maintainer came to fix.
     */
    it("a value sitting below its key reports the key's line", () => {
        const [error] = errorsOf(`schemaVersion: 2\nmode:\n  sideways\ncapabilities: {}\n`);
        expect(error?.code).toBe("modeInvalid");
        expect(error?.line).toBe(2);
    });

    it("a block scalar reports the key's line", () => {
        const [error] = errorsOf(`schemaVersion: 2\nmode: |\n  observe\ncapabilities: {}\n`);
        expect(error?.code).toBe("modeInvalid");
        expect(error?.line).toBe(2);
    });

    /**
     * A configuration file authored on Windows is an ordinary file. The
     * counter counts line BREAKS, so a two-character one must not shift every
     * line below it.
     */
    it("Windows line endings do not drift", () => {
        const [error] = errorsOf(
            `schemaVersion: 2\r\nmode: observe\r\ncapabilities:\r\n  triageQueue:\r\n    enabled: yes please\r\n`,
        );
        expect(error?.path).toBe("capabilities.triageQueue.enabled");
        expect(error?.line).toBe(5);
    });

    /**
     * The same claim at the size a maintainer reaches by reading the design
     * pages: six unbuilt blocks pasted from `design/guides/capabilities/`,
     * and six lines back — one per block, in the order the file writes them,
     * each at its own key's line however deep the block under it goes.
     */
    it("a file of unbuilt designs comes back one readable line per block", () => {
        const errors = errorsOf(UNBUILT_DESIGNS_YAML);
        expect(errors.map((e) => [e.path, e.line])).toEqual([
            ["capabilities.advancement", 4],
            ["capabilities.assignment", 34],
            ["capabilities.merged", 45],
            ["capabilities.notifications", 47],
            ["capabilities.onboarding", 54],
            ["capabilities.reviews", 56],
        ]);
    });

    it("every error of a document with three mistakes is placed", () => {
        const errors = errorsOf(
            `schemaVersion: 3\nmode: sideways\ncapabilties: {}\ncapabilities: {}\n`,
        );
        expect(errors.map((e) => [e.path, e.line])).toEqual([
            ["capabilties", 3],
            ["schemaVersion", 1],
            ["mode", 2],
        ]);
    });
});

/**
 * The walk on its own, because no path `parseConfig` produces today indexes a
 * sequence: `mappings` families and capability blocks are mappings all the way
 * down, and a family whose value is a sequence is rejected before anything
 * descends into it. The sequence branch and the walk's refusals therefore have
 * no document to reach them through, and a rule with a branch nobody has run
 * is a rule nobody has checked.
 */
describe("the walk from a dotted path to a line", () => {
    const SEQUENCE = `a:\n  - x\n  - y: 1\n    z: 2\n`;

    it("a segment of digits indexes a sequence", () => {
        expect(lineOfPath(SEQUENCE, "a.0")).toBe(2);
        expect(lineOfPath(SEQUENCE, "a.1")).toBe(3);
        expect(lineOfPath(SEQUENCE, "a.1.z")).toBe(4);
    });

    it("an index past the end stops at the sequence's own key", () => {
        expect(lineOfPath(SEQUENCE, "a.7")).toBe(1);
    });

    it("a name where a sequence expects an index stops at the key", () => {
        expect(lineOfPath(SEQUENCE, "a.first")).toBe(1);
    });

    it("a sequence item with no position of its own stops the walk", () => {
        // `!!pairs` composes bare pairs, which are not nodes and have no range.
        expect(lineOfPath(`a: !!pairs [ b: 1 ]\n`, "a.0")).toBe(1);
    });

    it("a path continuing past a scalar stops at the scalar's key", () => {
        expect(lineOfPath(`x: 1\nmode: observe\n`, "mode.deeper.still")).toBe(2);
    });

    it("a key that is not a scalar is not a key any path can name", () => {
        expect(lineOfPath(`? [a, b]\n: v\n`, "a")).toBeUndefined();
    });

    it("a document with no part of the path has no line", () => {
        expect(lineOfPath(`mode: observe\n`, "mappings.labels.ready")).toBeUndefined();
        expect(lineOfPath(`just a string\n`, "mode")).toBeUndefined();
        expect(lineOfPath(``, "mode")).toBeUndefined();
    });

    it("a key containing a dot cannot be addressed, and stops the walk", () => {
        expect(lineOfPath(`mappings:\n  alerts:\n    a.b: x\n`, "mappings.alerts.a.b")).toBe(2);
    });
});

describe("no document, however hostile, escapes as an exception", () => {
    /**
     * The property that matters, and the one the alias budget broke: every
     * rejection is a VALUE. A configuration file arrives in a pull request
     * from anyone, so a document that throws is a crash in the shell rather
     * than a finding in a report.
     */
    it("arbitrary text produces a result, never a throw", () => {
        fc.assert(
            fc.property(fc.string(), (text) => {
                expect(() => parse(text)).not.toThrow();
            }),
            { numRuns: 500 },
        );
    });

    it("arbitrary YAML-shaped text produces a result, never a throw", () => {
        const line = fc
            .tuple(
                fc.constantFrom("", "  ", "\t", "- ", "  - "),
                fc.constantFrom(
                    "schemaVersion",
                    "mode",
                    "capabilities",
                    "labels",
                    "a",
                    "__proto__",
                    "*x",
                    "&x",
                ),
                fc.constantFrom(":", ": ", ":", ": |", ": >", ""),
                fc.constantFrom("1", "observe", "{}", "[", '"', "null", "true", ""),
            )
            .map(([indent, key, sep, value]) => `${indent}${key}${sep}${value}`);

        fc.assert(
            fc.property(fc.array(line, { maxLength: 8 }), (lines) => {
                expect(() => parse(lines.join("\n"))).not.toThrow();
            }),
            { numRuns: 500 },
        );
    });

    it("an empty document is a repository in observe, exactly like no file", () => {
        for (const text of ["", "\n", "# just a comment\n", "---\n"]) {
            const result = parse(text);
            expect(result.ok && result.config.mode).toBe("observe");
        }
    });

    /**
     * The corpus cannot make this claim: every row in it is a rejection, and
     * what matters here is the rejection that did NOT happen. The limit
     * bounds expansion, it does not ban a YAML feature — the alias resolves,
     * and the only complaint is the anchor's own top-level key.
     */
    it("a document that aliases itself is unparseable, never a throw", () => {
        const result = parse("schemaVersion:\n  &x\n  - *x\n");
        expect(!result.ok && result.errors.map((error) => error.code)).toEqual([
            "documentUnparseable",
        ]);
    });

    it("a document using aliases within the budget still resolves them", () => {
        const modest = `x: &x observe\nschemaVersion: 2\nmode: *x\ncapabilities: {}\n`;
        const result = parse(modest);
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.errors.map((e) => e.code)).toEqual(["unknownKey"]);
    });
});
