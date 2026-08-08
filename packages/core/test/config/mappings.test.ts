/**
 * The reverse lookup is the normalizer's first dependency (the vertical
 * slice), and its contract is mostly about what it REFUSES to find: an
 * unmapped label answers null, never a guess — that is the blast-radius
 * promise docs/configuration.md makes to maintainers, tested here.
 */

import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
    MAPPABLE_MEANINGS,
    meaningOfLabel,
    meaningsOfLabels,
    parseConfig,
    type RepositoryConfig,
} from "../../src/config/index.js";

function configWith(labels: Record<string, string>): RepositoryConfig {
    const result = parseConfig(
        { schemaVersion: 1, mode: "active", capabilities: {}, mappings: { labels } },
        { revision: "rev-test", knownCapabilities: [] },
    );
    if (!result.ok) throw new Error(result.errors.map((e) => e.code).join(","));
    return result.config;
}

const config = configWith({
    awaitingTriage: "status: triage",
    ready: "Status: Ready for Dev",
    blocked: "status: blocked",
});

describe("meaningOfLabel", () => {
    it("finds a mapped label exactly as written", () => {
        expect(meaningOfLabel(config, "status: triage")).toBe("awaitingTriage");
    });

    it("judges sameness the way the validator does — trimmed, case-insensitive (D55)", () => {
        expect(meaningOfLabel(config, "  STATUS: TRIAGE  ")).toBe("awaitingTriage");
        expect(meaningOfLabel(config, "status: ready for dev")).toBe("ready");
    });

    it("answers null for anything unmapped — never a guess", () => {
        expect(meaningOfLabel(config, "status: triag")).toBeNull();
        expect(meaningOfLabel(config, "bug")).toBeNull();
        expect(meaningOfLabel(config, "")).toBeNull();
        expect(meaningOfLabel(config, "   ")).toBeNull();
    });

    it("folds DOWNWARD, pinned on the one character class where it matters", () => {
        // 'ß'.toUpperCase() is 'SS': an upper-folding implementation would
        // match these, a lower-folding one must not. This is also the pin
        // that keeps the shared fold in step with the validator's collision
        // judgment — the two must never diverge.
        const de = configWith({ ready: "straße" });
        expect(meaningOfLabel(de, "STRASSE")).toBeNull();
        expect(meaningOfLabel(de, "STRAßE")).toBe("ready");
    });

    it("an empty mapping finds nothing at all", () => {
        const bare = configWith({});
        expect(meaningOfLabel(bare, "status: triage")).toBeNull();
    });
});

describe("meaningsOfLabels", () => {
    it("translates a delivery's label list, dropping the unmapped", () => {
        expect(meaningsOfLabels(config, ["bug", "status: triage", "status: blocked"])).toEqual([
            "awaitingTriage",
            "blocked",
        ]);
    });

    it("normalizes independently of input order and duplication", () => {
        const a = meaningsOfLabels(config, ["status: blocked", "status: triage"]);
        const b = meaningsOfLabels(config, ["status: triage", "STATUS: BLOCKED", "status: triage"]);
        expect(a).toEqual(b);
        expect(a).toEqual(["awaitingTriage", "blocked"]);
    });

    it("orders by the platform vocabulary, not the wire", () => {
        // `blocked` is last in MAPPABLE_MEANINGS; wherever it arrives, it sorts last.
        expect(meaningsOfLabels(config, ["status: blocked", "status: ready for dev"])).toEqual([
            "ready",
            "blocked",
        ]);
    });

    it("round-trips every mapped meaning through its own label", () => {
        const everything = configWith(
            Object.fromEntries(MAPPABLE_MEANINGS.map((m) => [m, `lbl ${m}`])),
        );
        const labels = MAPPABLE_MEANINGS.map((m) => `lbl ${m}`);
        expect(meaningsOfLabels(everything, labels)).toEqual([...MAPPABLE_MEANINGS]);
    });

    it("never invents a meaning from arbitrary wire labels", () => {
        fc.assert(
            fc.property(fc.array(fc.string(), { maxLength: 12 }), (labels) => {
                const found = meaningsOfLabels(config, labels);
                for (const meaning of found) {
                    // Everything found must trace to a genuinely matching label.
                    const mapped = config.mappings.labels[meaning];
                    expect(mapped).toBeDefined();
                    expect(
                        labels.some((l) => l.trim().toLowerCase() === mapped!.trim().toLowerCase()),
                    ).toBe(true);
                }
            }),
            { numRuns: 300 },
        );
    });
});
