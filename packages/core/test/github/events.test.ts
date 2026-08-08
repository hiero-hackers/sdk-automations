/**
 * The normalizer, tested against what GitHub actually sent.
 *
 * Every fixture under `fixtures/` is a real delivery from the 2026-08-07
 * capture session (protocol 7.1), scrubbed and human-reviewed. No payload
 * here was written by hand, and that is the point: the assumptions worth
 * testing are the ones GitHub gets to falsify.
 */

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { normalizeDelivery, parseConfig, type RepositoryConfig } from "../../src/index.js";

const fixturesDir = fileURLToPath(new URL("fixtures/", import.meta.url));
const fixture = (name: string): unknown =>
    JSON.parse(readFileSync(join(fixturesDir, name), "utf8"));
/** The event header, recoverable from the fixture naming scheme. */
const eventOf = (name: string): string => name.split(".")[0]!;

function configWith(labels: Record<string, string>): RepositoryConfig {
    const result = parseConfig(
        { schemaVersion: 1, mode: "active", capabilities: {}, mappings: { labels } },
        { revision: "rev-test", knownCapabilities: [] },
    );
    if (!result.ok) throw new Error(result.errors.map((e) => e.code).join(","));
    return result.config;
}

/** The capture-session sandbox's mapping — matches the labels provoked. */
const config = configWith({
    awaitingTriage: "status: triage",
    ready: "status: ready",
    needsReview: "status: needs review",
    blocked: "status: blocked",
});

const observed = (name: string, cfg: RepositoryConfig = config) => {
    const result = normalizeDelivery(eventOf(name), fixture(name), cfg);
    expect(result.kind, `${name} should normalize`).toBe("observation");
    if (result.kind !== "observation") throw new Error("unreachable");
    return result.observation;
};

describe("every captured fixture normalizes", () => {
    it("the fixture directory is present and non-empty", () => {
        const files = readdirSync(fixturesDir).filter((f) => f.endsWith(".json"));
        expect(files.length).toBeGreaterThanOrEqual(5);
    });

    it.each(readdirSync(fixturesDir).filter((f) => f.endsWith(".json")))("%s", (name) => {
        const result = normalizeDelivery(eventOf(name), fixture(name), config);
        expect(result.kind).toBe("observation");
    });
});

describe("issues, through the real payloads", () => {
    it("opened: no position, open, unpaused", () => {
        const o = observed("issues.opened.json");
        expect(o.kind).toBe("issueUpdated");
        expect(o.item).toEqual({ kind: "issue", number: 164 });
        expect(o.position).toEqual({
            kind: "position",
            state: { meaning: null, blocked: false, closedBy: null },
            ignored: [],
        });
        expect(o.observedAt.toISOString()).toBe("2026-08-06T23:09:54.000Z");
    });

    it("labeled: the mapped label becomes its meaning", () => {
        const o = observed("issues.labeled.json");
        expect(o.position).toMatchObject({
            kind: "position",
            state: { meaning: "awaitingTriage" },
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

    it("an unmapped repository sees the same delivery as meaningless", () => {
        const bare = configWith({});
        const o = observed("issues.labeled.json", bare);
        expect(o.position).toMatchObject({
            kind: "position",
            state: { meaning: null },
        });
    });
});

describe("pull requests, through the real payloads", () => {
    it("opened: no position, open", () => {
        const o = observed("pull_request.opened.json");
        expect(o.kind).toBe("pullRequestUpdated");
        expect(o.item).toEqual({ kind: "pullRequest", number: 165 });
        expect(o.position).toMatchObject({
            kind: "position",
            state: { meaning: null, closedBy: null },
        });
    });

    it("closed-by-merge reads as merged, not closedByHuman (D47)", () => {
        const o = observed("pull_request.closed.json");
        expect(o.position).toMatchObject({
            kind: "position",
            state: { closedBy: "merged" },
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
        expect(result.kind).toBe("observation");
        if (result.kind !== "observation") return;
        expect(result.observation.position).toMatchObject({
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
        expect(result.kind).toBe("observation");
        if (result.kind !== "observation") return;
        expect(result.observation.position).toMatchObject({
            kind: "position",
            state: { meaning: "awaitingTriage" },
            ignored: ["needsReview"],
        });
    });

    it("the blocked label pauses without occupying a position (D28)", () => {
        const result = normalizeDelivery("issues", withLabels(["status: blocked"]), config);
        expect(result.kind).toBe("observation");
        if (result.kind !== "observation") return;
        expect(result.observation.position).toMatchObject({
            kind: "position",
            state: { meaning: null, blocked: true },
        });
    });
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
        [
            "mergedMissing",
            "pull_request",
            {
                repository: { owner: { login: "o" }, name: "r" },
                pull_request: { number: 1, labels: [], updated_at: "2026-08-07T00:00:00Z" },
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
