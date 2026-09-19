/**
 * The fact table: which kind carries which group, and whether a producer left
 * one unread. Both readings must agree with the shapes, kind by kind.
 */

import { describe, expect, it } from "vitest";
import {
    carriesFactGroup,
    FACT_GROUPS,
    factGroupUnread,
    UNREAD,
    type IssueFacts,
    type PullRequestFacts,
} from "../src/catalogue.js";

const AT = new Date("2026-09-09T00:00:00.000Z");
const REPO = { owner: "o", repo: "r" } as const;
const POSITION = {
    kind: "position",
    state: { meaning: null, blocked: false, closedBy: null },
    ignored: [],
} as const;

const issue: IssueFacts = {
    kind: "issue",
    repository: REPO,
    item: { kind: "issue", number: 1 },
    observedAt: AT,
    trigger: { kind: "sweep" },
    author: "opener",
    actor: null,
    locked: false,
    arrival: null,
    position: POSITION,
    alerts: { carried: [], arrived: [] },
    assignees: [],
    links: UNREAD,
    command: UNREAD,
};
const pullRequest: PullRequestFacts = {
    kind: "pullRequest",
    repository: REPO,
    item: { kind: "pullRequest", number: 2 },
    observedAt: AT,
    trigger: { kind: "event", event: "pull_request" },
    author: "opener",
    actor: null,
    position: POSITION,
    alerts: { carried: [], arrived: [] },
    assignees: UNREAD,
    links: { issues: [] },
    review: UNREAD,
    readiness: UNREAD,
};

describe("which kind carries which group", () => {
    it("each kind carries its own groups and no other kind's", () => {
        expect(FACT_GROUPS.filter((group) => carriesFactGroup("issue", group))).toEqual([
            "assignees",
            "links",
            "command",
        ]);
        expect(FACT_GROUPS.filter((group) => carriesFactGroup("pullRequest", group))).toEqual([
            "assignees",
            "links",
            "review",
            "readiness",
        ]);
    });
});

describe("whether a producer left a group unread", () => {
    it("reads each group of an issue record", () => {
        expect(FACT_GROUPS.map((group) => factGroupUnread(issue, group))).toEqual([
            false,
            true,
            false,
            false,
            true,
        ]);
    });

    it("reads each group of a pull-request record", () => {
        expect(FACT_GROUPS.map((group) => factGroupUnread(pullRequest, group))).toEqual([
            true,
            false,
            true,
            true,
            false,
        ]);
    });

    it("never reports a group the kind does not carry as unread", () => {
        expect(factGroupUnread(issue, "review")).toBe(false);
    });
});
