/**
 * What an approved effect becomes, and what survives in the journal row.
 *
 * Two claims, and everything here serves one of them. The plan for a label
 * move is add-then-remove, in that order, and it is one call when there is no
 * position to displace. And a row round-trips: the bytes written are the bytes
 * a resend reads, while bytes nobody wrote answer `null` rather than a
 * half-built call.
 */

import { describe, expect, it } from "vitest";
import {
    operationOf,
    parseJournaledCall,
    planFor,
    renderManagedBody,
    serializeCall,
    type EffectCall,
} from "../src/effects.js";
import {
    commentEffect,
    configFor,
    ITEM,
    labelEffect,
    markerOf,
    MERGE_LABEL,
    READY_LABEL,
    REVIEW_LABEL,
    TRIAGE_LABEL,
} from "./effect-harness.js";

const config = configFor();

describe("planning a managed comment", () => {
    it("is one call, whose body opens with the marker the platform minted", () => {
        const effect = commentEffect({ body: "Thanks for opening this." });

        const plan = planFor(effect, config);

        expect(plan).toEqual({
            ok: true,
            calls: [
                {
                    verb: "postComment",
                    kind: "summary",
                    body: `${markerOf(effect)}\n\nThanks for opening this.`,
                },
            ],
        });
    });

    it("carries the purpose the capability asked for, not a default", () => {
        const plan = planFor(commentEffect({ kind: "warning" }), config);

        expect(plan.ok && plan.calls[0]).toMatchObject({ verb: "postComment", kind: "warning" });
    });

    it("refuses an effect with no identity to post under", () => {
        const plan = planFor(commentEffect({ withIdentity: false }), config);

        expect(plan).toEqual({
            ok: false,
            code: "identityMissing",
            detail: "the approved effect carries no managed-comment identity to post under",
        });
    });

    it("renders the marker first and the content as its own block", () => {
        expect(renderManagedBody("<!-- m -->", "body")).toBe("<!-- m -->\n\nbody");
    });
});

describe("planning a label move", () => {
    it("adds the target and then removes the position it displaces, in that order", () => {
        const plan = planFor(
            labelEffect({ meaning: "ready", displacing: "awaitingTriage" }),
            config,
        );

        expect(plan).toEqual({
            ok: true,
            calls: [
                { verb: "addLabel", label: READY_LABEL },
                { verb: "removeLabel", label: TRIAGE_LABEL },
            ],
        });
    });

    it("is one call when the item held no position to displace", () => {
        const plan = planFor(labelEffect({ meaning: "ready" }), config);

        expect(plan).toEqual({ ok: true, calls: [{ verb: "addLabel", label: READY_LABEL }] });
    });

    it("is one call when the claimed position is the one being moved to", () => {
        const plan = planFor(labelEffect({ meaning: "ready", displacing: "ready" }), config);

        expect(plan).toEqual({ ok: true, calls: [{ verb: "addLabel", label: READY_LABEL }] });
    });

    /**
     * `blocked` is a pause flag rather than a position (D28), and a
     * pull-request meaning on an issue is another flow's (D35). Displacing
     * either would remove a label this move has no business touching.
     */
    it("displaces only an own-flow position, never a pause or another flow's", () => {
        const effect = labelEffect({ meaning: "ready", displacing: "awaitingTriage" });
        const widened = {
            ...effect,
            intent: {
                ...effect.intent,
                expected: {
                    meaningsPresent: ["blocked", "needsReview", "awaitingTriage"],
                    meaningsAbsent: [],
                    closed: null,
                },
            },
        } as typeof effect;

        const plan = planFor(widened, config);

        expect(plan).toEqual({
            ok: true,
            calls: [
                { verb: "addLabel", label: READY_LABEL },
                { verb: "removeLabel", label: TRIAGE_LABEL },
            ],
        });
    });

    it("reads a pull request's own flow, not an issue's", () => {
        const pr = { kind: "pullRequest", number: 9 } as const;

        expect(
            planFor(
                labelEffect({ item: pr, meaning: "needsReview", displacing: "readyToMerge" }),
                config,
            ),
        ).toEqual({
            ok: true,
            calls: [
                { verb: "addLabel", label: REVIEW_LABEL },
                { verb: "removeLabel", label: MERGE_LABEL },
            ],
        });
    });

    it("never displaces an issue position from a pull request", () => {
        const pr = { kind: "pullRequest", number: 9 } as const;

        expect(
            planFor(
                labelEffect({ item: pr, meaning: "needsReview", displacing: "awaitingTriage" }),
                config,
            ),
        ).toEqual({ ok: true, calls: [{ verb: "addLabel", label: REVIEW_LABEL }] });
    });

    it("refuses when the repository maps no label to the target meaning", () => {
        const plan = planFor(labelEffect({ meaning: "inProgress" }), config);

        expect(plan).toEqual({
            ok: false,
            code: "labelUnmapped",
            detail: "the repository maps no label to inProgress",
        });
    });

    it("refuses when the repository maps no label to the position being displaced", () => {
        const plan = planFor(labelEffect({ meaning: "ready", displacing: "inProgress" }), config);

        expect(plan).toEqual({
            ok: false,
            code: "labelUnmapped",
            detail: "the repository maps no label to the displaced position inProgress",
        });
    });
});

describe("planning an unassign", () => {
    it("is one call, planned like any other so the dispatch stays one shape", () => {
        const effect = labelEffect();
        const unassign = {
            ...effect,
            intent: {
                ...effect.intent,
                operation: "unassign",
                desired: { login: "sophie" },
            },
        } as unknown as typeof effect;

        expect(planFor(unassign, config)).toEqual({
            ok: true,
            calls: [{ verb: "unassign", login: "sophie" }],
        });
    });
});

describe("the operation a call belongs to", () => {
    it.each([
        [{ verb: "postComment", kind: "summary", body: "b" }, "postManagedComment"],
        [{ verb: "addLabel", label: "l" }, "applyMappedLabel"],
        [{ verb: "removeLabel", label: "l" }, "applyMappedLabel"],
        [{ verb: "unassign", login: "sophie" }, "unassign"],
    ] as [EffectCall, string][])("reads %o as %s", (call, operation) => {
        expect(operationOf(call)).toBe(operation);
    });
});

describe("the journal row", () => {
    const rowFor = (call: EffectCall): string =>
        serializeCall({ capability: "intake", item: ITEM, call });

    /** The exact bytes, because a resend reads them and a reader greps them. */
    it("spells a comment call one way", () => {
        expect(rowFor({ verb: "postComment", kind: "summary", body: "hello" })).toBe(
            '{"capability":"intake","item":{"kind":"issue","number":164},' +
                '"verb":"postComment","kind":"summary","body":"hello"}',
        );
    });

    it("spells a label call one way", () => {
        expect(rowFor({ verb: "removeLabel", label: TRIAGE_LABEL })).toBe(
            '{"capability":"intake","item":{"kind":"issue","number":164},' +
                '"verb":"removeLabel","label":"status: triage"}',
        );
    });

    it("spells an unassign one way", () => {
        expect(rowFor({ verb: "unassign", login: "sophie" })).toBe(
            '{"capability":"intake","item":{"kind":"issue","number":164},' +
                '"verb":"unassign","login":"sophie"}',
        );
    });

    it.each([
        [{ verb: "postComment", kind: "notice", body: "b" }],
        [{ verb: "addLabel", label: READY_LABEL }],
        [{ verb: "removeLabel", label: TRIAGE_LABEL }],
        [{ verb: "unassign", login: "sophie" }],
    ] as [EffectCall][])("round-trips %o", (call) => {
        expect(parseJournaledCall(rowFor(call))).toEqual({
            capability: "intake",
            item: ITEM,
            call,
        });
    });

    it("round-trips a pull request's number and kind", () => {
        const item = { kind: "pullRequest", number: 7 } as const;
        const row = serializeCall({
            capability: "intake",
            item,
            call: { verb: "addLabel", label: READY_LABEL },
        });

        expect(parseJournaledCall(row)).toEqual({
            capability: "intake",
            item,
            call: { verb: "addLabel", label: READY_LABEL },
        });
    });

    it.each([
        ["bytes that are not JSON", "not json"],
        ["a JSON array", "[]"],
        ["a JSON scalar", '"row"'],
        ["no capability", '{"item":{"kind":"issue","number":1},"verb":"addLabel","label":"l"}'],
        [
            "an empty capability",
            '{"capability":"","item":{"kind":"issue","number":1},"verb":"addLabel","label":"l"}',
        ],
        ["no item", '{"capability":"intake","verb":"addLabel","label":"l"}'],
        [
            "an entity kind nothing declares",
            '{"capability":"intake","item":{"kind":"discussion","number":1},"verb":"addLabel","label":"l"}',
        ],
        [
            "an item number that is not whole",
            '{"capability":"intake","item":{"kind":"issue","number":1.5},"verb":"addLabel","label":"l"}',
        ],
        [
            "an item number below one",
            '{"capability":"intake","item":{"kind":"issue","number":0},"verb":"addLabel","label":"l"}',
        ],
        [
            "a verb nothing sends",
            '{"capability":"intake","item":{"kind":"issue","number":1},"verb":"closeIssue"}',
        ],
        [
            "a label call with no label",
            '{"capability":"intake","item":{"kind":"issue","number":1},"verb":"addLabel"}',
        ],
        [
            "a comment call with no body",
            '{"capability":"intake","item":{"kind":"issue","number":1},"verb":"postComment","kind":"summary"}',
        ],
        [
            "a comment purpose the catalogue does not hold",
            '{"capability":"intake","item":{"kind":"issue","number":1},"verb":"postComment","kind":"gossip","body":"b"}',
        ],
        [
            "an unassign with no login",
            '{"capability":"intake","item":{"kind":"issue","number":1},"verb":"unassign","login":""}',
        ],
    ])("reads %s as no call at all", (_label, row) => {
        expect(parseJournaledCall(row)).toBeNull();
    });

    /**
     * A plain property read walks the prototype chain, so a row naming
     * `__proto__` would otherwise answer with values GitHub never sent and
     * this platform never wrote.
     */
    it("reads own properties only", () => {
        const row = JSON.stringify(JSON.parse('{"__proto__":{"capability":"intake"}}'));

        expect(parseJournaledCall(row)).toBeNull();
    });
});
