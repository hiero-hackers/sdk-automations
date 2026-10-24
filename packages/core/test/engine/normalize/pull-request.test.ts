/**
 * The pull-request family, tested against what GitHub actually sent.
 *
 * The payloads live in the testkit — two packages needed them, which is this
 * repository's admission rule for shared test support — and they reach this
 * file through its export rather than a path, so they travel into Stryker's
 * sandbox with the dependency. What a `pull_request` delivery BECOMES is
 * this file's subject; the routing and the shared preamble, including the
 * `mergedMissing` refusal's place in the code table, are `events.test.ts`'s.
 *
 * Every capture is a real delivery from the 2026-10-24 capture session
 * (protocol 7.1), scrubbed and human-reviewed. No payload here was written
 * by hand, and that is the point: the assumptions worth testing are the ones
 * GitHub gets to falsify.
 */

import { describe, expect, it } from "vitest";
import { capture } from "@hiero-hackers/automation-testkit";
import { normalizeDelivery, type RepositoryConfig } from "../../../src/index.js";
import { configWith } from "../../config/builders.js";

const fixture = (name: string): unknown => capture(name).json();

/** The capture-session sandbox's mapping — matches the labels provoked. */
const config = configWith({
    labels: {
        awaitingTriage: "status: triage",
        ready: "status: ready",
        needsReview: "status: needs review",
        blocked: "status: blocked",
    },
});

const observed = (name: string, cfg: RepositoryConfig = config) => {
    const subject = capture(name);
    const result = normalizeDelivery(subject.event, subject.json(), cfg);
    expect(result.kind, `${name} should normalize`).toBe("facts");
    if (result.kind !== "facts") throw new Error("unreachable");
    return result.facts;
};

describe("pull requests, through the real payloads", () => {
    it("opened: no position, open, every group unread", () => {
        const o = observed("pull_request.opened.json");
        expect(o.kind).toBe("pullRequest");
        expect(o.item).toEqual({ kind: "pullRequest", number: 38 });
        expect(o.position).toMatchObject({
            kind: "position",
            state: { meaning: null, closedBy: null },
        });
        /**
         * facts.md §2 — `review` included, which is why `inactivity` is
         * skipped on a delivery rather than reading a draft flag nobody read.
         */
        expect(o.trigger).toEqual({ kind: "event", event: "pull_request" });
        if (o.kind !== "pullRequest") throw new Error("unreachable");
        expect({
            assignees: o.assignees,
            links: o.links,
            review: o.review,
        }).toEqual({
            assignees: "unread",
            links: "unread",
            review: "unread",
        });
    });

    it("closed-by-merge reads as merged, not closedByHuman (D47)", () => {
        const o = observed("pull_request.closed.json");
        expect(o.position).toMatchObject({
            kind: "position",
            state: { closedBy: "merged" },
        });
    });

    /**
     * The other closed pull request. Both captures are decided by `merged`
     * alone — one true, one absent-and-open — so the branch that reads
     * `state` on a pull request had never run, and D47's whole point is that
     * the two closures stay distinguishable: progression credits a merge and
     * must not credit an abandonment.
     */
    it("closed WITHOUT merging reads as closedByHuman, not merged (D47)", () => {
        const abandoned = fixture("pull_request.closed.json") as {
            pull_request: { merged: boolean; state: string };
        };
        abandoned.pull_request.merged = false;
        abandoned.pull_request.state = "closed";
        const result = normalizeDelivery("pull_request", abandoned, config);
        expect(result.kind).toBe("facts");
        if (result.kind !== "facts") return;
        expect(result.facts.position).toMatchObject({
            kind: "position",
            state: { closedBy: "closedByHuman" },
        });
    });
});
