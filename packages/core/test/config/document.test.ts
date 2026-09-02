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
import { parseConfigDocument, type ConfigErrorCode } from "../../src/config/index.js";
import { DOCUMENT_ADMISSIONS, DOCUMENT_REJECTIONS, expectRejection } from "./documents.js";

// Declared rather than named: a name-only admission cannot reach the
// settings-key or required-meaning rules, and both are document-reachable (D84).
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
        meaningNotMappable: true,
        meaningRequired: true,
        labelInvalid: true,
        labelNotInjective: true,
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
    it("a document using aliases within the budget still resolves them", () => {
        const modest = `x: &x observe\nschemaVersion: 1\nmode: *x\ncapabilities: {}\n`;
        const result = parse(modest);
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.errors.map((e) => e.code)).toEqual(["unknownKey"]);
    });
});
