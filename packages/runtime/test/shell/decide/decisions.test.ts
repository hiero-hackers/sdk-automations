/**
 * Which rows one decided pass writes: one per item finding, one per skip or capability problem
 * on the item it decided, and none for a finding about the repository or the producer.
 */

import { describe, expect, it } from "vitest";
import type { Finding } from "@hiero-hackers/automation-core";
import { decisionsOf, SKIPPED, type DecidedPass } from "../../../src/shell/decide/decisions.js";

const REPOSITORY = { owner: "o", repo: "r" } as const;
const ITEM = { kind: "issue", number: 7 } as const;
const AT = "2026-08-07T10:00:00.000Z";

const onCapability = { kind: "capability", capability: "triageQueue" } as const;

const skip = (detail: readonly string[]): Finding => ({
    severity: "info",
    code: "capabilityExplained",
    summary: "Skipped: nothing applies.",
    detail,
    subject: onCapability,
});
const unread: Finding = {
    severity: "info",
    code: "factsUnread",
    summary: "needs links",
    detail: [],
    subject: onCapability,
};
const failed: Finding = {
    severity: "problem",
    code: "capabilityFailed",
    summary: '"triageQueue" failed during evaluation: boom',
    detail: [],
    subject: onCapability,
};
const ignored: Finding = {
    severity: "info",
    code: "deliveryIgnored",
    summary: "no facts",
    detail: [],
    subject: { kind: "repository" },
};
const recorded: Finding = {
    severity: "notice",
    code: "modeRecordsOnly",
    summary: "recorded only",
    detail: ["dcoSignoff: pass"],
    subject: { kind: "item", capability: "triageQueue", item: ITEM },
};

const pass = (findings: readonly Finding[], item: DecidedPass["item"] = ITEM): DecidedPass => ({
    passId: "pass-1",
    source: "webhook",
    sourceId: "pass-1",
    repository: REPOSITORY,
    item,
    at: AT,
    report: { revision: "rev", mode: "dry-run", repository: REPOSITORY, findings },
    effects: [],
});

const shape = ({
    item,
    capability,
    verdict,
    code,
    detail,
    effectId,
}: ReturnType<typeof decisionsOf>[number]) =>
    [item, capability, verdict, code, detail, effectId] as const;

describe("the rows one pass writes", () => {
    it("writes each item finding with its lines folded into the reason, in report order", () => {
        const rows = decisionsOf(pass([skip(["a: 1", "b: 2"]), recorded]));
        expect(rows.map(shape)).toEqual([
            [ITEM, "triageQueue", "info", SKIPPED, "Skipped: nothing applies. (a: 1; b: 2)", null],
            [
                ITEM,
                "triageQueue",
                "notice",
                "modeRecordsOnly",
                "recorded only (dcoSignoff: pass)",
                null,
            ],
        ]);
        expect(rows[0]).toMatchObject({
            passId: "pass-1",
            source: "webhook",
            repository: REPOSITORY,
            at: AT,
        });
    });

    it("keeps the reason alone when the skip carries no lines", () => {
        expect(decisionsOf(pass([skip([])])).map((row) => row.detail)).toEqual([
            "Skipped: nothing applies.",
        ]);
    });

    it("writes a capability's problem on the item too, under its own code", () => {
        expect(decisionsOf(pass([failed])).map(shape)).toEqual([
            [
                ITEM,
                "triageQueue",
                "problem",
                "capabilityFailed",
                '"triageQueue" failed during evaluation: boom',
                null,
            ],
        ]);
    });

    it("writes nothing on the capability for a pass that named no item", () => {
        expect(decisionsOf(pass([skip(["a: 1"]), failed], null))).toEqual([]);
    });

    it("writes nothing for a finding about the repository or the producer", () => {
        expect(decisionsOf(pass([unread, ignored]))).toEqual([]);
    });
});
