/**
 * The issue family, tested against what GitHub actually sent.
 *
 * The payloads live in the testkit — two packages needed them, which is this
 * repository's admission rule for shared test support — and they reach this
 * file through its export rather than a path, so they travel into Stryker's
 * sandbox with the dependency. What an `issues` delivery BECOMES is this
 * file's subject; the routing and the shared preamble are `events.test.ts`'s.
 *
 * Every capture is a real delivery from the 2026-08-07 capture session
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

describe("issues, through the real payloads", () => {
    it("opened: no position, open, unpaused, every group unread", () => {
        const o = observed("issues.opened.json");
        expect(o.kind).toBe("issue");
        /**
         * The repository, read literally off the capture rather than
         * compared against another reading of it. Everything downstream —
         * the report's subject, the idempotency key's first two fields —
         * takes this pair on trust, and every existing assertion about it
         * derived both sides from this same function (§9's standing rule:
         * a constant compared against itself proves nothing).
         */
        expect(o.repository).toEqual({ owner: "scrubbed-1", repo: "scrubbed-2" });
        expect(o.item).toEqual({ kind: "issue", number: 164 });
        expect(o.position).toEqual({
            kind: "position",
            state: { meaning: null, blocked: false, closedBy: null },
            ignored: [],
        });
        expect(o.observedAt.toISOString()).toBe("2026-08-06T23:09:54.000Z");
        /**
         * facts.md §2 — a webhook reads the projection and marks the rest.
         * Marking rather than inventing is the load-bearing half: an empty
         * assignee list here would be a lie the safety world could not tell
         * from a fact, and `inactivity` would judge a clock from it.
         */
        expect(o.trigger).toEqual({ kind: "event", event: "issues" });
        expect(o).toMatchObject({ locked: false, arrival: { kind: "opened" } });
        expect({ assignees: o.assignees, links: o.links }).toEqual({
            assignees: "unread",
            links: "unread",
        });
    });

    it("labeled: the mapped label becomes its meaning", () => {
        const o = observed("issues.labeled.json");
        expect(o.position).toMatchObject({
            kind: "position",
            state: { meaning: "awaitingTriage" },
        });
        expect(o).toMatchObject({
            locked: false,
            arrival: { kind: "label", meaning: "awaitingTriage" },
        });
    });

    /**
     * D35, on a real payload: closing did not strip the position label,
     * and the projection keeps BOTH facts — closed, and still at triage.
     * A normalizer that flattened closure into "no position" would have
     * erased exactly what reopen needs.
     */
    it("closed: closure recorded, position preserved", () => {
        const o = observed("issues.closed.json");
        expect(o.position).toEqual({
            kind: "position",
            state: {
                meaning: "awaitingTriage",
                blocked: false,
                closedBy: "closedByHuman",
            },
            ignored: [],
        });
    });

    /** The default spelling IS `status: triage` (D203), so the meaningless case spells the position another way. */
    it("a repository spelling the position differently sees the same delivery as meaningless", () => {
        const bare = configWith({ labels: { awaitingTriage: "position: triage" } });
        const o = observed("issues.labeled.json", bare);
        expect(o.position).toMatchObject({
            kind: "position",
            state: { meaning: null },
        });
    });
});

describe("shapes derived from the real ones", () => {
    /** Clone a fixture and edit its label set — shape stays GitHub's. */
    const withLabels = (names: readonly string[]): unknown => {
        const d = fixture("issues.labeled.json") as { issue: { labels: unknown[] } };
        d.issue.labels = names.map((name) => ({ name }));
        return d;
    };

    it("two own-flow positions project as a conflict, not a repair", () => {
        const result = normalizeDelivery(
            "issues",
            withLabels(["status: triage", "status: ready"]),
            config,
        );
        expect(result.kind).toBe("facts");
        if (result.kind !== "facts") return;
        expect(result.facts.position).toMatchObject({
            kind: "conflict",
            positions: ["awaitingTriage", "ready"],
        });
    });

    it("a cross-flow label is ignored diagnostics, never a conflict (D35)", () => {
        const result = normalizeDelivery(
            "issues",
            withLabels(["status: triage", "status: needs review"]),
            config,
        );
        expect(result.kind).toBe("facts");
        if (result.kind !== "facts") return;
        expect(result.facts.position).toMatchObject({
            kind: "position",
            state: { meaning: "awaitingTriage" },
            ignored: ["needsReview"],
        });
    });

    it("the blocked label pauses without occupying a position (D28)", () => {
        const result = normalizeDelivery("issues", withLabels(["status: blocked"]), config);
        expect(result.kind).toBe("facts");
        if (result.kind !== "facts") return;
        expect(result.facts.position).toMatchObject({
            kind: "position",
            state: { meaning: null, blocked: true },
        });
    });
});

/**
 * The two readings a `labeled` delivery adds: WHO sent it, and WHICH alert
 * arrived. Both are read off the real capture, whose `action` is `labeled`,
 * whose `label.name` is `status: triage`, and whose sender is a person.
 *
 * The config here maps `status: triage` as an ALERT and spells the position
 * another way — the only way a repository can carry both, since the two
 * families share GitHub's label namespace and the parser refuses the overlap
 * (the position's default spelling included, D203).
 */
describe("the actor and the alerts a delivery carries", () => {
    const alerting = configWith({
        labels: { awaitingTriage: "position: triage" },
        alerts: { triage: "status: triage" },
    });

    const withPayload = (over: Record<string, unknown>): unknown => ({
        ...(fixture("issues.labeled.json") as Record<string, unknown>),
        ...over,
    });

    it("reads the sender as the actor", () => {
        expect(observed("issues.labeled.json").actor).toEqual({ login: "scrubbed-1" });
    });

    it("carries an alert the item holds, and says it arrived on a labeled delivery", () => {
        const o = normalizeDelivery("issues", fixture("issues.labeled.json"), alerting);
        expect(o.kind).toBe("facts");
        if (o.kind !== "facts") return;
        expect(o.facts.alerts).toEqual({ carried: ["triage"], arrived: ["triage"] });
    });

    it("carries the alert but says nothing arrived when the action is not labeled", () => {
        const o = normalizeDelivery("issues", withPayload({ action: "edited" }), alerting);
        expect(o.kind).toBe("facts");
        if (o.kind !== "facts") return;
        expect(o.facts.alerts).toEqual({ carried: ["triage"], arrived: [] });
    });

    /** A payload disagreeing with itself: the added label is not on the item. */
    it("refuses to say an alert arrived that the item does not carry", () => {
        const o = normalizeDelivery(
            "issues",
            withPayload({ label: { name: "Security" } }),
            configWith({
                labels: { awaitingTriage: "position: triage" },
                alerts: { triage: "status: triage", security: "Security" },
            }),
        );
        expect(o.kind).toBe("facts");
        if (o.kind !== "facts") return;
        expect(o.facts.alerts).toEqual({ carried: ["triage"], arrived: [] });
    });

    it.each([
        ["an unreadable label", { label: { name: 7 } }],
        ["no label at all", { label: undefined }],
        ["a label that is not a record", { label: "status: triage" }],
    ])("says nothing arrived for %s", (_why, over) => {
        const o = normalizeDelivery("issues", withPayload(over), alerting);
        expect(o.kind).toBe("facts");
        if (o.kind !== "facts") return;
        expect(o.facts.alerts.arrived).toEqual([]);
    });

    it.each([
        ["no sender", { sender: undefined }],
        ["a sender that is not a record", { sender: "scrubbed-1" }],
        ["a login that is not a string", { sender: { login: 7 } }],
    ])("reads a null actor for %s, without refusing the delivery", (_why, over) => {
        const o = normalizeDelivery("issues", withPayload(over), alerting);
        expect(o.kind).toBe("facts");
        if (o.kind !== "facts") return;
        expect(o.facts.actor).toBeNull();
        // Still a readable delivery about a readable item.
        expect(o.facts.item).toEqual({ kind: "issue", number: 164 });
    });
});
