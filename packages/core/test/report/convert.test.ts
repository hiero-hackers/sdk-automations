/**
 * The classification table is the whole point of this module, so it is what
 * these tests pin.
 *
 * The property that matters is not "every refusal produces a finding" — that
 * is trivially true. It is that a refusal which represents the system WORKING
 * is not reported as a problem. An operator surface that cries problem on a
 * disabled capability is one nobody reads, and then the handful of real
 * problems are invisible.
 */

import { describe, expect, it } from "vitest";
import {
    configFindings,
    explanationFinding,
    groupBy,
    problems,
    screenFinding,
    verdictFinding,
    type Finding,
    type Report,
    type Subject,
} from "../../src/report/index.js";
import { parseConfig } from "../../src/config/index.js";
import type { SafetyVerdict } from "../../src/safety/index.js";

const item: Subject = {
    kind: "item",
    capability: "intake",
    item: { kind: "issue", number: 7 },
};

const refuse = (code: string): SafetyVerdict =>
    ({ outcome: "refuse", code, reason: `refused: ${code}` }) as SafetyVerdict;

describe("a refusal is not automatically a problem", () => {
    it.each([
        "killSwitch",
        "capabilityDisabled",
        "modeDisabled",
        "itemBlocked",
        "graceRunning",
        "activityCancelled",
        "newerHumanChange",
        "preconditionStale",
    ])("%s is a notice — the system working, not failing", (code) => {
        expect(verdictFinding(refuse(code), item).severity).toBe("notice");
    });

    it.each([
        "permissionMissing",
        "humanOrderingUnknown",
        "wrongEntryPoint",
        "preventiveGateUnavailable",
        "invalidTimestamp",
        "wrongActionClass",
        "noWarning",
        "warningRequestMismatch",
        "invalidDestructivePlan",
        "graceBelowFloor",
    ])("%s is a problem — a human must act", (code) => {
        expect(verdictFinding(refuse(code), item).severity).toBe("problem");
    });

    it("applies and record-onlys are never problems", () => {
        expect(verdictFinding({ outcome: "apply" }, item).severity).toBe("info");
        expect(
            verdictFinding(
                { outcome: "record-only", code: "modeRecordsOnly", reason: "dry-run" },
                item,
            ).severity,
        ).toBe("notice");
    });

    /**
     * The table is exhaustive by type, but a mapping can still be wrong in
     * bulk: if every refusal were marked `problem`, every test above except
     * the notice cases would still pass. This asserts the split exists.
     */
    it("classifies both ways, so the table is doing work", () => {
        const severities = new Set(
            ["killSwitch", "permissionMissing"].map(
                (c) => verdictFinding(refuse(c), item).severity,
            ),
        );
        expect([...severities].sort()).toEqual(["notice", "problem"]);
    });
});

describe("screens and explanations", () => {
    it("a passing screen is info, and says so", () => {
        const f = screenFinding({ ok: true }, item);
        expect(f).toMatchObject({ severity: "info", code: "screened" });
        expect(f.summary.length).toBeGreaterThan(0);
    });

    it("a failed screen is always a problem — there is no benign screen failure", () => {
        expect(
            screenFinding({ ok: false, code: "undeclaredIntent", reason: "not declared" }, item)
                .severity,
        ).toBe("problem");
    });

    it("a capability's explanation carries no severity of its own", () => {
        const f = explanationFinding(
            { capability: "intake", summary: "Placed in triage.", detail: ["no position"] },
            item,
        );
        expect(f.severity).toBe("info");
        expect(f.code).toBe("capabilityExplained");
        expect(f.detail).toEqual(["no position"]);
    });
});

describe("configuration findings", () => {
    const known = ["intake"];

    it("a valid configuration reports its mode", () => {
        const result = parseConfig(
            {
                schemaVersion: 1,
                mode: "dry-run",
                capabilities: {},
                mappings: { labels: {} },
                principals: {},
            },
            { revision: "rev-test", knownCapabilities: known },
        );
        const [f] = configFindings(result);
        expect(f).toMatchObject({ severity: "info", code: "configValid" });
        expect(f!.summary).toContain("dry-run");
    });

    /**
     * This test used to assert the opposite, and was written to FAIL when
     * D75 landed. It has: every configuration error now carries its own code
     * and the dotted path it came from, so D38's report can group by kind,
     * count, and annotate a line instead of pasting a paragraph.
     */
    it("each kind of configuration error reports its own code and path", () => {
        const result = parseConfig(
            { schemaVersion: 2, mode: "sideways", nope: 1 },
            { revision: "rev-test", knownCapabilities: known },
        );
        const found = configFindings(result);
        expect(found.length).toBeGreaterThan(1);
        expect(new Set(found.map((f) => f.code))).toEqual(
            new Set(["schemaVersionUnsupported", "modeInvalid", "unknownKey"]),
        );
        expect(found.every((f) => f.severity === "problem")).toBe(true);

        // A path is what lets a check run annotate a line.
        const bySubject = found.map((f) =>
            f.subject.kind === "configuration" ? f.subject.path : null,
        );
        expect(bySubject).toContain("mode");
        expect(bySubject).toContain("schemaVersion");
        expect(bySubject).toContain("nope");
    });

    it("a report groups configuration errors by kind — the thing prose could not do", () => {
        const result = parseConfig(
            {
                schemaVersion: 1,
                mode: "active",
                nope: 1,
                alsoNope: 2,
                mappings: { labels: { awaitingTriage: "x", ready: "x" } },
            },
            { revision: "rev-test", knownCapabilities: known },
        );
        const found = configFindings(result);
        const byCode = new Map<string, number>();
        for (const f of found) byCode.set(f.code, (byCode.get(f.code) ?? 0) + 1);
        expect(byCode.get("unknownKey")).toBe(2);
        expect(byCode.get("labelNotInjective")).toBe(1);
    });
});

describe("a report is read by filtering, not by structure", () => {
    const findings: Finding[] = [
        verdictFinding(refuse("capabilityDisabled"), item),
        verdictFinding(refuse("permissionMissing"), item),
        verdictFinding({ outcome: "apply" }, item),
    ];
    const report: Report = {
        revision: "rev-1",
        mode: "active",
        repository: { owner: "o", repo: "r" },
        findings,
    };

    it("the operator surface is one filter", () => {
        expect(problems(report).map((f) => f.code)).toEqual(["permissionMissing"]);
    });

    it("grouping preserves the order decisions were made in", () => {
        const grouped = groupBy(report, (f) => f.severity);
        expect(grouped.map(([k]) => k)).toEqual(["notice", "problem", "info"]);
    });

    it("grouping collects every finding into exactly one bucket", () => {
        const grouped = groupBy(report, (f) => f.severity);
        expect(grouped.flatMap(([, fs]) => fs)).toHaveLength(findings.length);
        expect(grouped.find(([k]) => k === "notice")![1]).toHaveLength(1);
    });

    it("groups by subject too — the config report and operator surface differ only here", () => {
        const grouped = groupBy(report, (f) => f.subject.kind);
        expect(grouped).toHaveLength(1);
        expect(grouped[0]![0]).toBe("item");
    });

    it("an empty report has no problems and no groups", () => {
        const empty: Report = { ...report, findings: [] };
        expect(problems(empty)).toEqual([]);
        expect(groupBy(empty, (f) => f.severity)).toEqual([]);
    });

    it("a finding built without detail carries an empty list, never undefined", () => {
        const f = verdictFinding({ outcome: "apply" }, item);
        expect(f.detail).toEqual([]);
        expect(f.summary.length).toBeGreaterThan(0);
        expect(f.code).toBe("applied");
    });

    it("an explanation's detail survives into the finding unchanged", () => {
        const f = explanationFinding(
            { capability: "intake", summary: "s", detail: ["a", "b"] },
            item,
        );
        expect(f.detail).toEqual(["a", "b"]);
    });
});
