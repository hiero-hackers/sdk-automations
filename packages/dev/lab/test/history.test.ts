/**
 * The history puller's cuts: what an item held at an instant, and what it is allowed to keep.
 * The GitHub reads themselves are exercised by pulling; these are the rules applied to them.
 */

import { describe, expect, it } from "vitest";
import { asOf, blankProse, draftAt, heldAt, pullAt } from "../src/history.js";

const at = Date.parse("2026-11-05T21:20:00Z");
const before = "2026-11-05T20:00:00Z";
const later = "2026-11-06T00:00:00Z";

describe("cutting at an instant", () => {
    it("keeps what happened by then and drops what came later or carries no date", () => {
        const kept = asOf([{ created_at: before }, { created_at: later }, { event: "x" }], at);
        expect(kept).toEqual([{ created_at: before }]);
    });

    it("replays assignments in order, so a later release is undone", () => {
        const login = (entry: Record<string, unknown>) =>
            (entry["assignee"] as { login?: string } | undefined)?.login;
        const timeline = [
            { event: "assigned", assignee: { login: "ada" } },
            { event: "assigned", assignee: { login: "bo" } },
            { event: "unassigned", assignee: { login: "ada" } },
        ];
        expect(heldAt(timeline, "assigned", "unassigned", login)).toEqual(["bo"]);
    });

    it("reads a pull request marked ready since as a draft then", () => {
        expect(draftAt(false, [{ event: "ready_for_review" }])).toBe(true);
        expect(draftAt(true, [{ event: "convert_to_draft" }])).toBe(false);
        expect(draftAt(true, [])).toBe(true);
    });

    it("refuses a pull request force-pushed since, whose commits then are gone", () => {
        expect(pullAt({ draft: false }, [{ event: "head_ref_force_pushed" }])).toHaveProperty(
            "unfaithful",
        );
    });

    it("reads one merged since as open and mergeable then", () => {
        const merged = { state: "closed", merged: true, mergeable: null, draft: false };
        expect(pullAt(merged, [{ event: "merged" }, { event: "closed" }])).toMatchObject({
            state: "open",
            merged: false,
            mergeable: true,
        });
    });
});

describe("what a pulled history keeps", () => {
    it("blanks titles and bodies but keeps a leading command", () => {
        expect(blankProse({ title: "Fix it", body: "long story" })).toEqual({
            title: "scrubbed-title",
            body: "scrubbed-body",
        });
        expect(blankProse({ body: "/working\nstill on it" })).toEqual({ body: "/working" });
    });

    it("blanks a git author's name and keeps a commit's subject and sign-off", () => {
        const commit = {
            author: { name: "Ada Lovelace", email: "ada@example.com" },
            message: "fix: a thing\n\nlong reason\n\nSigned-off-by: Ada Lovelace <ada@example.com>",
        };
        const kept = blankProse(commit) as typeof commit;
        expect(kept.author.name).toBe("scrubbed-name");
        expect(kept.message).toBe(
            "fix: a thing\n\nSigned-off-by: scrubbed-name <scrubbed@example.invalid>",
        );
    });

    it("keeps the Action's own comment whole, since the next run reads its marker", () => {
        const own = {
            user: { login: "github-actions[bot]" },
            body: "<!-- hiero-automation:{} --> Hi",
        };
        expect(blankProse(own)).toEqual(own);
    });
});
