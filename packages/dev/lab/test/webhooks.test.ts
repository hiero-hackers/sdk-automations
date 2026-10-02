/**
 * The events pass offline: scripted installation and App requesters, a temporary pending
 * directory, no waiting. The pure helpers are held on their own first.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EVENT_SHAPES, type EventShape } from "../src/probes/events.js";
import {
    deliveriesOf,
    fieldDrift,
    itemNumberOf,
    matches,
    probeWebhooks,
    type Outcome,
    type Requester,
} from "../src/probes/webhooks.js";

const shape = (name: string): EventShape => {
    const found = EVENT_SHAPES.find((held) => held.name === name);
    if (found === undefined) throw new Error(`no shape ${name}`);
    return found;
};

const ISSUE = 7;
const PULL = 42;
const AT = "2026-10-02T00:00:00Z";
const LATER = "2999-01-01T00:00:00.000Z";

const repository = { owner: { login: "owner-sandbox" }, name: "sandbox" };
const sender = { login: "owner-sandbox" };
const issuePayload = (
    action: string,
    extra: Record<string, unknown> = {},
): Record<string, unknown> => ({
    action,
    repository,
    sender,
    issue: {
        number: ISSUE,
        state: "open",
        locked: false,
        user: sender,
        labels: [],
        updated_at: AT,
    },
    ...extra,
});
const pullPayload = (action: string): Record<string, unknown> => ({
    action,
    repository,
    sender,
    pull_request: {
        number: PULL,
        state: "open",
        merged: false,
        draft: false,
        user: sender,
        labels: [],
        updated_at: AT,
    },
});
const PAYLOADS: Readonly<Record<string, Record<string, unknown>>> = {
    "issues.opened": issuePayload("opened"),
    "issues.labeled": issuePayload("labeled", { label: { name: "conformance-probe" } }),
    "issue_comment.created": issuePayload("created", {
        comment: { body: "hi", user: sender, created_at: AT },
    }),
    "issues.closed": issuePayload("closed"),
    "pull_request.closed": pullPayload("closed"),
    "pull_request.opened": pullPayload("reopened"),
};

const answer = (status: number, body: unknown): Outcome => ({
    ok: true,
    sent: { status, headers: {}, body: JSON.stringify(body) },
});

/** The installation side: every provocation accepted, the opened issue numbered. */
const installation =
    (log: string[]): Requester =>
    (step, path, method) => {
        log.push(`${method} ${path}`);
        return Promise.resolve(
            step === "webhook-open-issue" ? answer(201, { number: ISSUE }) : answer(200, {}),
        );
    };

/** The App side: a log listing one delivery per shape, each fetchable by id. */
const app =
    (payloads: Readonly<Record<string, unknown>> = PAYLOADS, deliveredAt = LATER): Requester =>
    (_step, path) => {
        if (path.startsWith("/app/hook/deliveries?")) {
            return Promise.resolve(
                answer(
                    200,
                    EVENT_SHAPES.map((held, index) => ({
                        id: index + 1,
                        event: held.event,
                        action: held.action,
                        delivered_at: deliveredAt,
                    })),
                ),
            );
        }
        const id = Number(path.split("/").at(-1));
        const held = EVENT_SHAPES[id - 1];
        return Promise.resolve(
            held === undefined
                ? answer(404, {})
                : answer(200, { request: { payload: payloads[held.name] } }),
        );
    };

let pendingDir: string;
beforeEach(() => {
    pendingDir = mkdtempSync(join(tmpdir(), "webhooks-test-"));
});
afterEach(() => {
    rmSync(pendingDir, { recursive: true, force: true });
});

const run = (
    over: { asApp?: Requester; eventsPullRequest?: number | null } = {},
    log: string[] = [],
) =>
    probeWebhooks({
        owner: "owner-sandbox",
        repo: "sandbox",
        eventsPullRequest: over.eventsPullRequest === undefined ? PULL : over.eventsPullRequest,
        asInstallation: installation(log),
        asApp: over.asApp ?? app(),
        wait: () => Promise.resolve(),
        pendingDir,
    });

describe("the pure helpers", () => {
    it("lists only rows with an id, an event and a delivery instant", () => {
        const body = `[
            { "id": 3845977048082325504, "event": "issues", "action": "opened", "delivered_at": "${AT}" },
            { "id": 2, "event": "ping", "action": null, "delivered_at": "${AT}" },
            { "id": true, "event": "issues", "action": "opened", "delivered_at": "${AT}" },
            { "id": 4, "event": "issues" }
        ]`;
        expect(deliveriesOf(body).map((held) => held.id)).toEqual(["3845977048082325504", "2"]);
        expect(deliveriesOf("not json")).toEqual([]);
    });

    it("matches a delivery by event, action and the run's start", () => {
        const opened = shape("issues.opened");
        const delivery = { id: "1", event: "issues", action: "opened", deliveredAt: LATER };
        expect(matches(delivery, opened, AT)).toBe(true);
        expect(matches({ ...delivery, action: "closed" }, opened, AT)).toBe(false);
        expect(matches({ ...delivery, event: "pull_request" }, opened, AT)).toBe(false);
        expect(matches({ ...delivery, deliveredAt: "2000-01-01T00:00:00.000Z" }, opened, AT)).toBe(
            false,
        );
    });

    it("reads the item number where the event keeps it", () => {
        expect(itemNumberOf(shape("issues.opened"), issuePayload("opened"))).toBe(ISSUE);
        expect(itemNumberOf(shape("pull_request.closed"), pullPayload("closed"))).toBe(PULL);
        expect(itemNumberOf(shape("pull_request.closed"), issuePayload("opened"))).toBeNull();
        expect(itemNumberOf(shape("issues.opened"), "nothing")).toBeNull();
    });

    it("names every missing path and a disagreeing action", () => {
        const opened = shape("issues.opened");
        expect(fieldDrift(opened, issuePayload("opened"))).toEqual([]);
        const { locked: _locked, ...rest } = issuePayload("opened")["issue"] as Record<
            string,
            unknown
        >;
        expect(fieldDrift(opened, { ...issuePayload("opened"), issue: rest })).toEqual([
            "field issue.locked: missing",
        ]);
        expect(fieldDrift(opened, issuePayload("edited"))).toEqual(["action: opened → edited"]);
    });
});

describe("the events pass", () => {
    it("provokes every shape in order, reads each delivery back and keeps it for review", async () => {
        const log: string[] = [];
        const results = await run({}, log);
        expect(results).toEqual(EVENT_SHAPES.map(({ name }) => ({ name, ok: true })));
        expect(log).toEqual([
            "POST /repos/owner-sandbox/sandbox/issues",
            "POST /repos/owner-sandbox/sandbox/labels",
            "POST /repos/owner-sandbox/sandbox/issues/7/labels",
            "POST /repos/owner-sandbox/sandbox/issues/7/comments",
            "PATCH /repos/owner-sandbox/sandbox/issues/7",
            "PATCH /repos/owner-sandbox/sandbox/pulls/42",
            "PATCH /repos/owner-sandbox/sandbox/pulls/42",
        ]);
        expect(readdirSync(pendingDir).sort()).toEqual([
            "issue_comment.created.json",
            "issues.closed.json",
            "issues.labeled.json",
            "issues.opened.json",
            "pull_request.closed.json",
            "pull_request.reopened.json",
        ]);
        const kept = JSON.parse(readFileSync(join(pendingDir, "issues.opened.json"), "utf8")) as {
            issue: { number: number; user: { login: string } };
        };
        expect(kept.issue.number).toBe(ISSUE);
        expect(kept.issue.user.login).toMatch(/^scrubbed-\d+$/);
    });

    it("leaves the pull-request shapes unreadable when no pull request is pinned", async () => {
        const results = await run({ eventsPullRequest: null });
        expect(results.filter((held) => held.ok).map((held) => held.name)).toEqual([
            "issues.opened",
            "issues.labeled",
            "issue_comment.created",
            "issues.closed",
        ]);
        expect(results.at(-1)?.unreadable).toContain("SANDBOX_EVENTS_PR");
    });

    it("reports a delivery that never reached the App's log", async () => {
        const results = await run({ asApp: app(PAYLOADS, "2000-01-01T00:00:00.000Z") });
        expect(results.every((held) => !held.ok)).toBe(true);
        expect(results[0]?.unreadable).toBe(
            "no issues.opened delivery for #7 reached the App's log",
        );
        expect(readdirSync(pendingDir)).toEqual([]);
    });

    it("reports the paths a delivery lacks as drift", async () => {
        const { draft: _draft, ...rest } = pullPayload("closed")["pull_request"] as Record<
            string,
            unknown
        >;
        const results = await run({
            asApp: app({
                ...PAYLOADS,
                "pull_request.closed": { ...pullPayload("closed"), pull_request: rest },
            }),
        });
        expect(results.find((held) => held.name === "pull_request.closed")).toEqual({
            name: "pull_request.closed",
            ok: false,
            drift: ["field pull_request.draft: missing"],
        });
    });
});
