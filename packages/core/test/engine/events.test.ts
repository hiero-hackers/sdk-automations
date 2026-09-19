/**
 * The normalizer's routing and its shared preamble, tested against what
 * GitHub actually sent.
 *
 * The payloads live in the testkit now — two packages needed them, which is
 * this repository's admission rule for shared test support — and they reach
 * this file through its export rather than a path, so they travel into
 * Stryker's sandbox with the dependency. Which family a delivery reaches,
 * and how the preamble refuses one it cannot read, is this file's subject;
 * what each family MAKES of a delivery it accepts belongs to the family's
 * own suite in `normalize/`.
 *
 * Every capture is a real delivery from the 2026-08-07 capture session
 * (protocol 7.1), scrubbed and human-reviewed. No payload here was written
 * by hand, and that is the point: the assumptions worth testing are the ones
 * GitHub gets to falsify.
 */

import { describe, expect, it } from "vitest";
import { WEBHOOK_CAPTURES } from "@hiero-hackers/automation-testkit";
import { normalizeDelivery, repositoryNamedBy } from "../../src/index.js";
import { configWith } from "../config/builders.js";

/** The capture-session sandbox's mapping — matches the labels provoked. */
const config = configWith({
    labels: {
        awaitingTriage: "status: triage",
        ready: "status: ready",
        needsReview: "status: needs review",
        blocked: "status: blocked",
    },
});

describe("every captured fixture normalizes", () => {
    it("the capture set is present and non-empty", () => {
        // Vacuity guard: an empty set would pass the `it.each` below in
        // silence, which is the whole reason this assertion exists.
        expect(WEBHOOK_CAPTURES.length).toBeGreaterThanOrEqual(5);
    });

    it.each(WEBHOOK_CAPTURES.map((subject) => [subject.name, subject] as const))(
        "%s",
        (_name, subject) => {
            const result = normalizeDelivery(subject.event, subject.json(), config);
            expect(result.kind).toBe("facts");
        },
    );
});

describe("what the normalizer refuses, and how", () => {
    it("a foreign event is ignored — the system working, not failing", () => {
        expect(normalizeDelivery("push", {}, config)).toEqual({
            kind: "ignored",
            event: "push",
        });
        expect(normalizeDelivery("ping", { zen: "ok" }, config)).toMatchObject({
            kind: "ignored",
        });
    });

    /**
     * One case per code, plus shape VARIANTS sharing a code: a mutant that
     * disables an inner guard makes the variant crash instead of answering
     * `malformed`, so every guard is load-bearing even where codes coincide.
     */
    it.each([
        ["payloadNotObject", "issues", null],
        ["repositoryUnreadable", "issues", {}],
        ["repositoryUnreadable", "issues", { repository: { name: "r" } }],
        ["repositoryUnreadable", "issues", { repository: { owner: { login: 42 }, name: "r" } }],
        ["repositoryUnreadable", "issues", { repository: { owner: { login: "o" }, name: 42 } }],
        ["itemMissing", "issues", { repository: { owner: { login: "o" }, name: "r" } }],
        [
            "numberMissing",
            "issues",
            { repository: { owner: { login: "o" }, name: "r" }, issue: {} },
        ],
        [
            "labelsUnreadable",
            "issues",
            {
                repository: { owner: { login: "o" }, name: "r" },
                issue: { number: 1, labels: [{ nope: true }], updated_at: "2026-08-07T00:00:00Z" },
            },
        ],
        [
            "labelsUnreadable",
            "issues",
            {
                repository: { owner: { login: "o" }, name: "r" },
                issue: { number: 1, labels: "nope", updated_at: "2026-08-07T00:00:00Z" },
            },
        ],
        // No `labels` key at all. The array guard is what turns this into a
        // verdict; without it the walk is over `undefined` and the shell
        // gets an exception where the contract promises a result.
        [
            "labelsUnreadable",
            "issues",
            {
                repository: { owner: { login: "o" }, name: "r" },
                issue: { number: 1, updated_at: "2026-08-07T00:00:00Z" },
            },
        ],
        [
            "timestampUnreadable",
            "issues",
            {
                repository: { owner: { login: "o" }, name: "r" },
                issue: { number: 1, labels: [], updated_at: "not a date" },
            },
        ],
        [
            "timestampUnreadable",
            "issues",
            {
                repository: { owner: { login: "o" }, name: "r" },
                issue: { number: 1, labels: [], updated_at: 42 },
            },
        ],
        // The preamble reads the author before any family runs, so a payload
        // with no readable opener refuses whole. There is no honest `unread`
        // for it: an item nobody opened does not exist.
        [
            "authorUnreadable",
            "issues",
            {
                repository: { owner: { login: "o" }, name: "r" },
                issue: { number: 1, labels: [], updated_at: "2026-08-07T00:00:00Z" },
            },
        ],
        [
            "authorUnreadable",
            "issues",
            {
                repository: { owner: { login: "o" }, name: "r" },
                issue: {
                    number: 1,
                    labels: [],
                    updated_at: "2026-08-07T00:00:00Z",
                    user: { login: "" },
                },
            },
        ],
        [
            "actionUnreadable",
            "issues",
            {
                repository: { owner: { login: "o" }, name: "r" },
                issue: {
                    number: 1,
                    labels: [],
                    updated_at: "2026-08-07T00:00:00Z",
                    user: { login: "opener" },
                    locked: false,
                },
            },
        ],
        [
            "lockedMissing",
            "issues",
            {
                action: "opened",
                repository: { owner: { login: "o" }, name: "r" },
                issue: {
                    number: 1,
                    labels: [],
                    updated_at: "2026-08-07T00:00:00Z",
                    user: { login: "opener" },
                },
            },
        ],
        [
            "mergedMissing",
            "pull_request",
            {
                action: "opened",
                repository: { owner: { login: "o" }, name: "r" },
                pull_request: {
                    number: 1,
                    labels: [],
                    updated_at: "2026-08-07T00:00:00Z",
                    user: { login: "opener" },
                },
            },
        ],
        // `draft: false` invented for a payload that did not say is the lie
        // that posts "ready for review" on a draft.
        [
            "draftMissing",
            "pull_request",
            {
                action: "opened",
                repository: { owner: { login: "o" }, name: "r" },
                pull_request: {
                    number: 1,
                    labels: [],
                    updated_at: "2026-08-07T00:00:00Z",
                    user: { login: "opener" },
                    merged: false,
                },
            },
        ],
        // A comment on a PULL REQUEST is consumed and unreadable, not ignored:
        // the payload carries no `merged`, and closure is what `merged`
        // decides (D47).
        [
            "commentUnreadable",
            "issue_comment",
            {
                repository: { owner: { login: "o" }, name: "r" },
                action: "created",
                issue: {
                    number: 1,
                    labels: [],
                    updated_at: "2026-08-07T00:00:00Z",
                    user: { login: "opener" },
                    pull_request: { url: "https://api.github.com/…" },
                },
                comment: {
                    body: "/assign",
                    user: { login: "alice" },
                    created_at: "2026-08-07T00:00:00Z",
                },
            },
        ],
        [
            "commentUnreadable",
            "issue_comment",
            {
                repository: { owner: { login: "o" }, name: "r" },
                action: "created",
                issue: {
                    number: 1,
                    labels: [],
                    updated_at: "2026-08-07T00:00:00Z",
                    user: { login: "opener" },
                },
                comment: { body: "/assign", user: { login: "alice" } },
            },
        ],
    ] as const)("malformed: %s", (code, event, payload) => {
        const result = normalizeDelivery(event, payload, config);
        expect(result.kind).toBe("malformed");
        if (result.kind !== "malformed") return;
        expect(result.code).toBe(code);
        expect(result.detail.length).toBeGreaterThan(0);
    });
});

describe("the repository a payload names", () => {
    it("reads owner and name, and reads nothing from a shape that is not GitHub's", () => {
        expect(repositoryNamedBy({ repository: { owner: { login: "o" }, name: "r" } })).toEqual({
            owner: "o",
            repo: "r",
        });
        expect(repositoryNamedBy({ repository: { name: "r" } })).toBeNull();
        expect(repositoryNamedBy("not an object")).toBeNull();
    });
});
