/**
 * The four verbs and the word each GitHub answer becomes.
 *
 * The mapping is the whole surface a capability sees, so every class gets a
 * row here — including the two ambiguous ones, which answer differently for an
 * idempotent verb than for the comment create.
 */

import { describe, expect, it } from "vitest";
import { MAX_RESPONSE_BODY_BYTES } from "../src/http.js";
import { LABEL_ABSENT, type WriteResult } from "../src/writes.js";
import {
    failure,
    installationToken as token,
    success,
    writeHarness as harness,
    TEST_ITEM as ITEM,
    TEST_NOW as NOW,
    type ResponseStep,
} from "./harness.js";

const ISSUE = "https://api.github.com/repos/hiero-hackers/sdk-automations/issues/132";
const REPO = "https://api.github.com/repos/hiero-hackers/sdk-automations";

/** A body one byte past the bound, so the read is abandoned mid-stream. */
const oversized = (): Response =>
    new Response(
        new ReadableStream({
            start(controller) {
                controller.enqueue(new Uint8Array(MAX_RESPONSE_BODY_BYTES + 1).fill(0x61));
                controller.close();
            },
        }),
        { status: 200 },
    );

describe("the verbs name their endpoints", () => {
    it("adds one named label, and names it in the body", async () => {
        const { verbs, scripted } = harness([success("[]")]);

        expect(await verbs.addLabel(ITEM, "status: stale")).toEqual({ outcome: "applied" });
        expect(scripted.calls[0]!.url).toBe(`${ISSUE}/labels`);
        expect(scripted.calls[0]!.init.method).toBe("POST");
        expect(scripted.calls[0]!.init.body).toBe('{"labels":["status: stale"]}');
    });

    it("removes exactly the label it was given, encoded once (D4)", async () => {
        const { verbs, scripted } = harness([success("[]")]);

        expect(await verbs.removeLabel(ITEM, "status: stale")).toEqual({ outcome: "applied" });
        expect(scripted.calls[0]!.url).toBe(`${ISSUE}/labels/status%3A%20stale`);
        expect(scripted.calls[0]!.init.method).toBe("DELETE");
        expect("body" in scripted.calls[0]!.init).toBe(false);
    });

    it("has no way to ask for a prefix removal (D4)", async () => {
        const { verbs, scripted } = harness([success("[]")]);

        // The nearest thing a caller could try is a name with a trailing
        // slash, which encodes into ONE segment rather than opening a path.
        expect(await verbs.removeLabel(ITEM, "status: ")).toEqual({ outcome: "applied" });
        expect(scripted.calls[0]!.url).toBe(`${ISSUE}/labels/status%3A%20`);
    });

    it("creates a comment", async () => {
        const { verbs, scripted } = harness([new Response("{}", { status: 201 })]);

        expect(await verbs.createComment(ITEM, "hello")).toEqual({ outcome: "applied" });
        expect(scripted.calls[0]!.url).toBe(`${ISSUE}/comments`);
        expect(scripted.calls[0]!.init.method).toBe("POST");
        expect(scripted.calls[0]!.init.body).toBe('{"body":"hello"}');
    });

    it("updates a comment by id, on the repository's comment path", async () => {
        const { verbs, scripted } = harness([success("{}")]);

        expect(await verbs.updateComment(7788, "again")).toEqual({ outcome: "applied" });
        expect(scripted.calls[0]!.url).toBe(`${REPO}/issues/comments/7788`);
        expect(scripted.calls[0]!.init.method).toBe("PATCH");
        expect(scripted.calls[0]!.init.body).toBe('{"body":"again"}');
    });

    it("turns a call the gate refuses into forbidden, unsent", async () => {
        const { verbs, scripted } = harness([success("{}")]);

        const result = await verbs.updateComment(-7, "no");

        expect(result.outcome).toBe("forbidden");
        expect(scripted.calls).toHaveLength(0);
    });
});

describe("the ambiguous 404", () => {
    it("reads a removal of an absent label as already", async () => {
        const { verbs } = harness([failure(404, '{"message":"Label does not exist"}')]);

        expect(await verbs.removeLabel(ITEM, "gone")).toEqual({ outcome: "already" });
    });

    it("refuses to read a plain 404 as already", async () => {
        const { verbs } = harness([failure(404, '{"message":"Not Found"}')]);

        const result = await verbs.removeLabel(ITEM, "gone");

        expect(result.outcome).toBe("forbidden");
        expect(result.outcome === "forbidden" ? result.detail : "").toContain("404");
    });

    it("never reads a 404 as already at the other three endpoints", async () => {
        const body = '{"message":"Label does not exist"}';
        const add = harness([failure(404, body)]);
        const comment = harness([failure(404, body)]);
        const update = harness([failure(404, body)]);

        expect((await add.verbs.addLabel(ITEM, "x")).outcome).toBe("forbidden");
        expect((await comment.verbs.createComment(ITEM, "x")).outcome).toBe("forbidden");
        expect((await update.verbs.updateComment(7, "x")).outcome).toBe("forbidden");
    });

    it("still matches the prose it was written against", () => {
        expect(LABEL_ABSENT.pattern.test(LABEL_ABSENT.documented)).toBe(true);
    });
});

describe("every other class becomes one word", () => {
    const rows: ReadonlyArray<readonly [string, ResponseStep, WriteResult["outcome"], string]> = [
        [
            "a missing permission",
            failure(403, "Resource not accessible by integration", {
                "x-accepted-github-permissions": "issues=write",
            }),
            "forbidden",
            "issues=write",
        ],
        [
            "a suspended installation",
            failure(403, "This installation is currently suspended."),
            "forbidden",
            "suspended",
        ],
        [
            "an unrecognised 403",
            failure(403, "Something new GitHub started saying"),
            "forbidden",
            "Something new",
        ],
        ["bad credentials", failure(401, "Bad credentials"), "forbidden", "credentials"],
        [
            "a primary exhaustion",
            failure(403, "no", {
                "x-ratelimit-remaining": "0",
                "x-ratelimit-reset": "9999999999",
            }),
            "retryLater",
            "resets at 9999999999",
        ],
        [
            "a primary exhaustion with no reset",
            failure(403, "no", { "x-ratelimit-remaining": "0" }),
            "retryLater",
            "an instant GitHub did not report",
        ],
        [
            "a secondary limit with no signal",
            failure(403, "You have exceeded a secondary rate limit", {
                "x-ratelimit-remaining": "4909",
            }),
            "retryLater",
            "no retry-after",
        ],
        [
            "a secondary limit with a signal",
            failure(429, "slow down", { "x-ratelimit-remaining": "4909", "retry-after": "30" }),
            "retryLater",
            "retry-after 30s",
        ],
        [
            "an unusable wait signal",
            failure(429, "slow down", { "x-ratelimit-remaining": "4909", "retry-after": "soon" }),
            "retryLater",
            "invalid",
        ],
        ["a validation error", failure(422, '{"errors":[]}'), "conflict", "invalid"],
        ["an unclassified 4xx", failure(410, "Gone"), "conflict", "410"],
        [
            "a redirect",
            failure(301, "", { location: "https://api.github.com/repos/o/new/issues/1/labels" }),
            "conflict",
            "repos/o/new",
        ],
        ["a redirect with no location", failure(302, ""), "conflict", "undisclosed"],
    ];

    it.each(rows)("reads %s as %s", async (_label, step, outcome, detail) => {
        const { verbs } = harness([step]);

        const result = await verbs.addLabel(ITEM, "x");

        expect(result.outcome).toBe(outcome);
        expect("detail" in result ? result.detail : "").toContain(detail);
    });

    it("reads an expired token as retryLater, once it has been dropped", async () => {
        const expired = { ...token("stale"), expiresAt: new Date(NOW.getTime() - 1) };
        const { verbs, tokens } = harness([failure(401, "Bad credentials")], {
            outcomes: [{ ok: true, token: expired }],
        });

        const result = await verbs.createComment(ITEM, "x");

        expect(result.outcome).toBe("retryLater");
        expect(tokens.invalidated).toHaveLength(1);
    });
});

/**
 * The rule the matrix states and 6.5 paid for: `unknown` is reserved for a
 * write that may have landed and must not be re-sent blindly.
 */
describe("an ambiguous outcome answers by idempotency", () => {
    /** Fresh each time: a `Response` body may be read once, and these retry. */
    const AMBIGUOUS: ReadonlyArray<readonly [string, () => ResponseStep]> = [
        ["a dropped connection", () => new Error("socket hang up")],
        ["a 500", () => () => failure(500, "boom")],
        ["a response too large to read", () => () => oversized()],
    ];

    it.each(AMBIGUOUS)("is unknown for a comment create after %s", async (_label, step) => {
        const { verbs } = harness([step()]);

        const result = await verbs.createComment(ITEM, "x");

        expect(result.outcome).toBe("unknown");
        expect(result.outcome === "unknown" ? result.detail : "").toContain(
            "may already have landed",
        );
    });

    it.each(AMBIGUOUS)("is retryLater for an idempotent write after %s", async (_label, step) => {
        const add = harness([step()]);
        const remove = harness([step()]);
        const update = harness([step()]);

        expect((await add.verbs.addLabel(ITEM, "x")).outcome).toBe("retryLater");
        expect((await remove.verbs.removeLabel(ITEM, "x")).outcome).toBe("retryLater");
        expect((await update.verbs.updateComment(7, "x")).outcome).toBe("retryLater");
    });
});
