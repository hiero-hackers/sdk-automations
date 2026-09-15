/**
 * The column a stored read is written to and read back from: every group of
 * both kinds through the round trip, the sentinel included, bytes nobody can
 * read answering nothing, and whether a read still answers what a repository
 * needs. The rule that decides when one is reused is the driver's, in
 * `sweep.test.ts`.
 */

import { describe, expect, it } from "vitest";
import { UNREAD } from "@hiero-hackers/automation-core";
import {
    decodeSnapshot,
    encodeSnapshot,
    snapshotAnswers,
    type SnapshotFacts,
} from "../../src/store/snapshots.js";

const ISSUE = { kind: "issue", number: 12 } as const;

const CLOCKS = [
    {
        login: "ada",
        assignedAt: new Date("2026-08-01T00:00:00.000Z"),
        lastWorkingAt: new Date("2026-08-02T00:00:00.000Z"),
    },
    { login: "grace", assignedAt: new Date("2026-08-03T00:00:00.000Z"), lastWorkingAt: null },
];

/** Every group a pull request's read fills, each carrying an instant. */
const PULL_REQUEST: SnapshotFacts = {
    kind: "pullRequest",
    groups: ["assignees", "links", "review", "readiness"],
    assignees: CLOCKS,
    links: { issues: [{ item: ISSUE, assignees: CLOCKS }] },
    review: {
        changesRequested: true,
        reapableSince: {
            needsRevision: new Date("2026-08-04T00:00:00.000Z"),
            changesRequested: new Date("2026-08-05T00:00:00.000Z"),
            draft: new Date("2026-08-06T00:00:00.000Z"),
        },
        lastCommitAt: new Date("2026-08-07T00:00:00.000Z"),
    },
    readiness: { draft: false },
    closes: [ISSUE],
};

const ISSUE_READ: SnapshotFacts = { kind: "issue", groups: ["assignees"], assignees: CLOCKS };

const roundTrip = (facts: SnapshotFacts): SnapshotFacts | null =>
    decodeSnapshot(encodeSnapshot(facts));

describe("a read written and read back", () => {
    it("returns every group of a pull request, instants and all", () => {
        expect(roundTrip(PULL_REQUEST)).toEqual(PULL_REQUEST);
    });

    it("returns an issue's own group, and its empty clocks", () => {
        expect(roundTrip(ISSUE_READ)).toEqual(ISSUE_READ);
        expect(roundTrip({ ...ISSUE_READ, assignees: [] })).toEqual({
            ...ISSUE_READ,
            assignees: [],
        });
    });

    /** A group nobody read stays a group nobody read: the sentinel is a value here too. */
    it("returns the sentinel for every group that carried it", () => {
        const unread: SnapshotFacts = {
            kind: "pullRequest",
            groups: [],
            assignees: UNREAD,
            links: UNREAD,
            review: UNREAD,
            readiness: UNREAD,
            closes: UNREAD,
        };

        expect(roundTrip(unread)).toEqual(unread);
        expect(roundTrip({ ...ISSUE_READ, assignees: UNREAD })).toEqual({
            ...ISSUE_READ,
            assignees: UNREAD,
        });
    });

    /** An instant is written as its ISO spelling, which is what makes a column readable by eye. */
    it("writes the instants as ISO strings", () => {
        expect(encodeSnapshot(ISSUE_READ)).toContain('"assignedAt":"2026-08-01T00:00:00.000Z"');
    });
});

describe("bytes no read wrote", () => {
    it.each([
        ["not JSON at all", "{"],
        ["not an object", "[1, 2]"],
        ["a kind nobody reads", '{"kind":"discussion","groups":[]}'],
        ["a group name nobody declares", '{"kind":"issue","groups":["mood"],"assignees":[]}'],
        ["groups that are not a list", '{"kind":"issue","groups":"assignees","assignees":[]}'],
        ["a clock with no login", '{"kind":"issue","groups":[],"assignees":[{"assignedAt":"x"}]}'],
        [
            "an undated clock",
            '{"kind":"issue","groups":[],"assignees":[{"login":"ada","assignedAt":"whenever"}]}',
        ],
        [
            "a reset that is neither an instant nor absent",
            '{"kind":"issue","groups":[],"assignees":[{"login":"ada","assignedAt":"2026-08-01T00:00:00.000Z","lastWorkingAt":"soon"}]}',
        ],
        ["a pull request missing a group", '{"kind":"pullRequest","groups":[],"assignees":[]}'],
    ])("answers nothing for %s", (_shape, stored) => {
        expect(decodeSnapshot(stored)).toBeNull();
    });

    it.each([
        ["a link with no item", { links: { issues: [{ assignees: [] }] } }],
        ["links that are not a list", { links: { issues: {} } }],
        ["a review with no verdict", { review: { reapableSince: {} } }],
        [
            "a review missing a mode",
            {
                review: {
                    changesRequested: false,
                    reapableSince: { needsRevision: "2026-08-04T00:00:00.000Z" },
                    lastCommitAt: null,
                },
            },
        ],
        ["a readiness that is not a flag", { readiness: { draft: "no" } }],
        ["a closing reference with no number", { closes: [{ kind: "issue" }] }],
    ])("answers nothing for %s", (_shape, broken) => {
        const stored = JSON.stringify({ ...JSON.parse(encodeSnapshot(PULL_REQUEST)), ...broken });

        expect(decodeSnapshot(stored)).toBeNull();
    });
});

describe("whether a stored read still answers", () => {
    it("answers the set it was read with", () => {
        expect(snapshotAnswers(PULL_REQUEST, ["assignees", "links", "review", "readiness"])).toBe(
            true,
        );
        expect(snapshotAnswers(ISSUE_READ, ["assignees"])).toBe(true);
    });

    /** The enabled set moved, so what the read left out is a gap nobody can see (D195, D193). */
    it("answers nothing for a set that is not the one it was read with", () => {
        expect(snapshotAnswers(ISSUE_READ, ["assignees", "links"])).toBe(false);
        expect(snapshotAnswers(PULL_REQUEST, ["assignees"])).toBe(false);
    });

    /** A read that failed is not an answer to keep for a day; the item is read again. */
    it("answers nothing when a group it was read with went unread", () => {
        expect(snapshotAnswers({ ...ISSUE_READ, assignees: UNREAD }, ["assignees"])).toBe(false);
        expect(
            snapshotAnswers({ ...PULL_REQUEST, review: UNREAD }, [
                "assignees",
                "links",
                "review",
                "readiness",
            ]),
        ).toBe(false);
    });

    it("keeps answering when a group nobody needs went unread", () => {
        expect(snapshotAnswers({ ...ISSUE_READ, groups: [], assignees: UNREAD }, [])).toBe(true);
    });
});
