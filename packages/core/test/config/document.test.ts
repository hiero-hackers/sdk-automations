/**
 * `parseConfigDocument` — the layer between a file and `parseConfig`.
 *
 * In-package on purpose. The rejection corpus lived at the repository root as
 * `examples/config/invalid/*.yml` and scored this module at 0.00% mutation:
 * Stryker's sandbox is `core/` and nothing above it, so those files were never
 * copied and the tests reading them killed nothing. They ran, they passed, and
 * they measured nothing — the same silent-skip shape as the `src/*.ts` mutate
 * glob that stopped covering three modules when they moved into a directory.
 */

import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { parseConfigDocument, type ConfigErrorCode } from "../../src/config/index.js";
import { REJECTIONS } from "./documents.js";

const OPTIONS = { revision: "rev-test", knownCapabilities: ["intake", "prQuality"] };
const parse = (yaml: string) => parseConfigDocument(yaml, OPTIONS);

const codesOf = (yaml: string): ConfigErrorCode[] => {
    const result = parse(yaml);
    return result.ok ? [] : [...new Set(result.errors.map((e) => e.code))];
};

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
        labelInvalid: true,
        labelNotInjective: true,
        principalNotAString: true,
    };

    it("has at least one document for every code", () => {
        const covered = new Set(REJECTIONS.map((r) => r.code));
        expect(
            [...Object.keys(REQUIRED)].filter((c) => !covered.has(c as ConfigErrorCode)),
        ).toEqual([]);
    });

    it.each(REJECTIONS.map((r) => [`${r.code}: ${r.why}`, r] as const))(
        "%s",
        (_name, rejection) => {
            expect(codesOf(rejection.yaml)).toEqual([rejection.code]);
        },
    );

    it("every rejection explains itself", () => {
        for (const { yaml } of REJECTIONS) {
            const result = parse(yaml);
            expect(result.ok).toBe(false);
            if (result.ok) continue;
            // The wording is never asserted, only that there is some — the
            // convention `safety.test.ts` set and the reason messages can be
            // rewritten without touching a test.
            for (const error of result.errors) expect(error.message.length).toBeGreaterThan(0);
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
        REJECTIONS.filter(
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

    it("names the line a duplicate key was found on", () => {
        const result = parse(`schemaVersion: 1\nmode: observe\nmode: active\ncapabilities: {}\n`);
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.errors[0]?.message).toContain("line 3");
    });

    /**
     * The budget is a decision, so it is pinned. Without this the number could
     * be deleted and only the extreme document would still be caught.
     */
    it("refuses at our budget, not the library's much larger default", () => {
        const twenty = `a: &a observe\nb: [${Array.from({ length: 20 }, () => "*a").join(",")}]\n`;
        expect(codesOf(twenty)).toEqual(["documentUnparseable"]);
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

    it("the alias budget refuses rather than throwing", () => {
        const bomb =
            `a: &a [x,x,x,x,x,x,x,x,x,x]\n` +
            `b: &b [*a,*a,*a,*a,*a,*a,*a,*a,*a,*a]\n` +
            `c: [*b,*b,*b,*b,*b,*b,*b,*b,*b,*b]\n`;
        expect(codesOf(bomb)).toEqual(["documentUnparseable"]);
        // A document using aliases WITHIN the budget is still accepted — the
        // limit bounds expansion, it does not ban a YAML feature outright.
        const modest = `x: &x observe\nschemaVersion: 1\nmode: *x\ncapabilities: {}\n`;
        const result = parse(modest);
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.errors.map((e) => e.code)).toEqual(["unknownKey"]);
    });
});
