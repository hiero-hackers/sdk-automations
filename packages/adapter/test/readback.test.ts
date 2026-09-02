/**
 * The proof half of a write: what GitHub says now, and D46's rule about when
 * "absent" may be believed.
 *
 * No test waits. The gap is pinned through the injected clock and sleep, which
 * is the only way a one-second rule can be asserted rather than trusted.
 */

import { describe, expect, it } from "vitest";
import { ABSENCE_CONFIRMATION_GAP_MS } from "../src/readback.js";
import {
    failure,
    readBackHarness as harness,
    success,
    TEST_APP_IDENTITY as IDENTITY,
    TEST_ITEM as ITEM,
    TEST_NOW as NOW,
    type ResponseStep,
} from "./harness.js";

const ISSUE = "https://api.github.com/repos/hiero-hackers/sdk-automations/issues/132";

const listed =
    (body: string, headers?: HeadersInit): ResponseStep =>
    () =>
        success(body, headers);

/** A comment authored by the App, named the way GitHub names it. */
const appComment = (id: number, body: string): Record<string, unknown> => ({
    id,
    body,
    user: { login: IDENTITY.botLogin, type: "Bot" },
    performed_via_github_app: { id: Number(IDENTITY.appId) },
});

const humanComment = (id: number, body: string): Record<string, unknown> => ({
    id,
    body,
    user: { login: "sophie", type: "User" },
});

describe("reading an item's comments", () => {
    it("returns raw bodies, page-sized and page-numbered", async () => {
        const { readBack, scripted } = harness([listed(JSON.stringify([humanComment(1, "hi")]))]);

        const outcome = await readBack.comments(ITEM);

        expect(outcome).toEqual({ ok: true, value: [{ id: 1, body: "hi", authoredByApp: false }] });
        expect(scripted.calls[0]!.url).toBe(`${ISSUE}/comments?per_page=100&page=1`);
    });

    it("recognises the App by the app id GitHub records on the comment", async () => {
        const comment = { ...appComment(2, "marker"), user: { login: "someone", type: "User" } };
        const { readBack } = harness([listed(JSON.stringify([comment]))]);

        const outcome = await readBack.comments(ITEM);

        expect(outcome.ok && outcome.value[0]!.authoredByApp).toBe(true);
    });

    it("recognises the App by its bot login when no app id is recorded", async () => {
        const comment = { id: 3, body: "marker", user: { login: IDENTITY.botLogin, type: "Bot" } };
        const { readBack } = harness([listed(JSON.stringify([comment]))]);

        const outcome = await readBack.comments(ITEM);

        expect(outcome.ok && outcome.value[0]!.authoredByApp).toBe(true);
    });

    it.each([
        ["a person", { id: 4, body: "x", user: { login: "sophie", type: "User" } }],
        ["another App", { id: 5, body: "x", user: { login: "other[bot]", type: "Bot" } }],
        [
            "another App's id",
            {
                id: 6,
                body: "x",
                user: { login: "o", type: "User" },
                performed_via_github_app: { id: 42 },
            },
        ],
        [
            "an app id sent as a string",
            { id: 7, body: "x", performed_via_github_app: { id: "123456" } },
        ],
    ])("does not claim a comment written by %s", async (_label, comment) => {
        const { readBack } = harness([listed(JSON.stringify([comment]))]);

        const outcome = await readBack.comments(ITEM);

        expect(outcome.ok && outcome.value[0]!.authoredByApp).toBe(false);
    });

    it.each([
        ["a missing body", '[{"id":1}]'],
        ["a missing id", '[{"body":"x"}]'],
        ["an unsafe id", `[{"id":${String(Number.MAX_SAFE_INTEGER)}0,"body":"x"}]`],
        ["a body that is not an array", '{"id":1}'],
    ])("refuses the whole read on %s", async (_label, body) => {
        const { readBack } = harness([listed(body)]);

        expect((await readBack.comments(ITEM)).ok).toBe(false);
    });

    it("names GitHub's refusal rather than answering an empty list", async () => {
        const { readBack } = harness([failure(403, "This installation is currently suspended.")]);

        const outcome = await readBack.comments(ITEM);

        expect(outcome.ok).toBe(false);
        expect(outcome.ok ? "" : outcome.detail).toContain("installationSuspended");
    });
});

describe("reading an item's labels", () => {
    it("returns the current names", async () => {
        const { readBack, scripted } = harness([listed('[{"name":"status: stale"}]')]);

        const outcome = await readBack.labels(ITEM);

        expect(outcome).toEqual({ ok: true, value: ["status: stale"] });
        expect(scripted.calls[0]!.url).toBe(`${ISSUE}/labels?per_page=100&page=1`);
    });

    it.each([
        ["a nameless label", "[{}]"],
        ["an empty name", '[{"name":""}]'],
    ])("refuses the whole read on %s", async (_label, body) => {
        const { readBack } = harness([listed(body)]);

        expect((await readBack.labels(ITEM)).ok).toBe(false);
    });
});

describe("a list longer than one page", () => {
    /** Page one names the last page; later pages carry the rest. */
    const paged =
        (lastPage: number): ResponseStep =>
        (url) => {
            const page = Number(/[?&]page=(\d+)/.exec(url)?.[1] ?? "1");
            const link = `<${ISSUE}/labels?page=${String(lastPage)}>; rel="last"`;
            return success(`[{"name":"p${String(page)}"}]`, page === 1 ? { link } : {});
        };

    it("walks every page page one named", async () => {
        const { readBack, scripted } = harness([paged(3)]);

        expect(await readBack.labels(ITEM)).toEqual({ ok: true, value: ["p1", "p2", "p3"] });
        expect(scripted.calls).toHaveLength(3);
    });

    it("refuses a list longer than the cap rather than answering from part of it", async () => {
        const { readBack, scripted } = harness([paged(6)]);

        const outcome = await readBack.labels(ITEM);

        expect(outcome.ok).toBe(false);
        expect(outcome.ok ? "" : outcome.detail).toContain("longer than 5 pages");
        expect(scripted.calls).toHaveLength(1);
    });

    it("refuses a next page GitHub would not name the end of", async () => {
        const { readBack } = harness([
            listed("[]", { link: `<${ISSUE}/labels?page=2>; rel="next"` }),
        ]);

        const outcome = await readBack.labels(ITEM);

        expect(outcome.ok).toBe(false);
        expect(outcome.ok ? "" : outcome.detail).toContain("without naming the last");
    });
});

/**
 * D46: presence on first sight, absence only after two reads a full gap
 * apart. The asymmetry is the point — a wrong "absent" duplicates.
 */
describe("the freshness rule", () => {
    const marker = '[{"id":1,"body":"<!-- hiero -->","user":{"login":"h[bot]","type":"Bot"}}]';

    it("answers present on the first sight, with one read", async () => {
        const { readBack, scripted, sleeps } = harness([listed(marker)]);

        const presence = await readBack.commentPresence(ITEM, (comment) =>
            comment.body.includes("hiero"),
        );

        expect(presence).toBe("present");
        expect(scripted.calls).toHaveLength(1);
        expect(sleeps).toEqual([]);
    });

    it("answers absent only after a second read a full second later", async () => {
        const { readBack, scripted, sleeps } = harness([listed("[]")]);

        const presence = await readBack.commentPresence(ITEM, () => true);

        expect(presence).toBe("absent");
        expect(scripted.calls).toHaveLength(2);
        expect(sleeps).toEqual([ABSENCE_CONFIRMATION_GAP_MS]);
        expect(ABSENCE_CONFIRMATION_GAP_MS).toBe(1_000);
    });

    it("answers present when only the second read sees it", async () => {
        const { readBack, sleeps } = harness([listed("[]"), listed(marker)]);

        const presence = await readBack.commentPresence(ITEM, (comment) =>
            comment.body.includes("hiero"),
        );

        expect(presence).toBe("present");
        expect(sleeps).toEqual([ABSENCE_CONFIRMATION_GAP_MS]);
    });

    it("refuses to call it absent when the clock says no second passed", async () => {
        // A sleep seam that returns without time passing: the pause happened,
        // the gap did not, and the rule is about the gap.
        const { readBack, scripted } = harness([listed("[]")], {
            sleep: () => Promise.resolve(),
            clock: () => NOW,
        });

        expect(await readBack.commentPresence(ITEM, () => true)).toBe("unknown");
        expect(scripted.calls).toHaveLength(2);
    });

    it.each([
        ["the first read", [failure(500, "boom")] as readonly ResponseStep[], 0],
        ["the second read", [listed("[]"), failure(500, "boom")] as readonly ResponseStep[], 1],
    ])("answers unknown when GitHub refuses %s", async (_label, steps, expectedSleeps) => {
        const { readBack, sleeps } = harness(steps);

        expect(await readBack.commentPresence(ITEM, () => true)).toBe("unknown");
        expect(sleeps).toHaveLength(expectedSleeps);
    });

    it("answers unknown when the clock seam breaks", async () => {
        let reads = 0;
        const { readBack } = harness([listed("[]")], {
            clock: () => {
                reads += 1;
                if (reads > 1) throw new Error("clock");
                return NOW;
            },
        });

        expect(await readBack.commentPresence(ITEM, () => true)).toBe("unknown");
    });

    it("answers unknown when the first clock read breaks", async () => {
        const { readBack, sleeps } = harness([listed("[]")], {
            clock: () => {
                throw new Error("clock");
            },
        });

        expect(await readBack.commentPresence(ITEM, () => true)).toBe("unknown");
        expect(sleeps).toEqual([]);
    });

    it("answers unknown when the sleep seam breaks", async () => {
        const { readBack, scripted } = harness([listed("[]")], {
            sleep: () => Promise.reject(new Error("sleep")),
        });

        expect(await readBack.commentPresence(ITEM, () => true)).toBe("unknown");
        expect(scripted.calls).toHaveLength(1);
    });

    it("holds a label to the same rule, by exact name", async () => {
        const there = harness([listed('[{"name":"status: stale"}]')]);
        const cased = harness([listed('[{"name":"Status: Stale"}]')]);

        expect(await there.readBack.labelPresence(ITEM, "status: stale")).toBe("present");
        expect(await cased.readBack.labelPresence(ITEM, "status: stale")).toBe("absent");
        expect(cased.sleeps).toEqual([ABSENCE_CONFIRMATION_GAP_MS]);
    });
});
