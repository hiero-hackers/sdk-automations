/**
 * The issue-comment family: what a `/assign` in a comment becomes.
 *
 * PROVENANCE, stated because this file cannot make the claim its siblings do.
 * `issues.test.ts` and `pull-request.test.ts` run on real captured deliveries,
 * and `events.ts` asks every family module to be built that way. There is no
 * captured `issue_comment` delivery in the testkit, and capturing one means
 * calling GitHub — which this session may not do. So the deliveries below are
 * HALF real: the `repository` and `issue` objects are lifted verbatim from the
 * `issues.opened.json` capture, and only the `action` and `comment` keys are
 * written by hand, from GitHub's documented shape. That is a standing
 * obligation, not a style choice — the family joins the capture set on the next
 * capture session (protocol 7.1), and until it does, this file is evidence of a
 * SHAPE rather than of GitHub's bytes.
 */

import { describe, expect, it } from "vitest";
import { capture } from "@hiero-hackers/automation-testkit";
import { normalizeDelivery, UNREAD, type RepositoryConfig } from "../../../src/index.js";
import { configWith } from "../../config/builders.js";

/** The capture-session sandbox's mapping, plus the two command words. */
const config = configWith({
    labels: { awaitingTriage: "status: triage", ready: "status: ready" },
    commands: { assign: "/assign", unassign: "/unassign" },
});

const AT = "2026-08-07T11:22:33Z";

/** One delivery: the capture's real repository and issue, plus a comment. */
function delivery(
    body: string,
    over: {
        readonly action?: string;
        readonly comment?: unknown;
        readonly pull?: boolean;
        readonly closed?: boolean;
    } = {},
): unknown {
    const opened = capture("issues.opened.json").json() as Record<string, unknown>;
    const issue = { ...(opened["issue"] as Record<string, unknown>) };
    if (over.pull === true) issue["pull_request"] = { url: "https://api.github.com/x" };
    if (over.closed === true) issue["state"] = "closed";
    return {
        action: over.action ?? "created",
        repository: opened["repository"],
        issue,
        comment:
            over.comment === undefined
                ? { body, created_at: AT, user: { login: "alice" } }
                : over.comment,
    };
}

const read = (payload: unknown, cfg: RepositoryConfig = config) =>
    normalizeDelivery("issue_comment", payload, cfg);

const factsOf = (payload: unknown, cfg: RepositoryConfig = config) => {
    const result = read(payload, cfg);
    expect(result.kind, "the delivery should normalize").toBe("facts");
    if (result.kind !== "facts") throw new Error("unreachable");
    if (result.facts.kind !== "issue") throw new Error("unreachable");
    return result.facts;
};

describe("what an issue comment becomes", () => {
    it("a created comment carrying the mapped word: the command, its author, its instant", () => {
        const facts = factsOf(delivery("/assign"));

        expect(facts.command).toEqual({
            command: "assign",
            by: "alice",
            at: new Date(AT),
        });
        expect(facts.trigger).toEqual({
            kind: "event",
            event: "issue_comment",
        });
        // The command is the ONE group this producer reads.
        expect(facts.assignees).toBe(UNREAD);
        expect(facts.links).toBe(UNREAD);
    });

    it("the capability sees the meaning, never the repository's spelling", () => {
        const taken = configWith({ commands: { assign: "/take" } });

        expect(factsOf(delivery("/take"), taken).command).toMatchObject({ command: "assign" });
        // And the platform's own name is not a command unless mapped to one.
        expect(factsOf(delivery("/assign"), taken).command).toBeNull();
    });

    it("an ordinary comment: read, and carrying no command", () => {
        expect(factsOf(delivery("thanks, I'll take a look this week")).command).toBeNull();
    });

    it("an edited comment is never executed", () => {
        expect(factsOf(delivery("/assign", { action: "edited" })).command).toBeNull();
        expect(factsOf(delivery("/assign", { action: "deleted" })).command).toBeNull();
    });

    it("a command must begin a line: quoting one does not execute it", () => {
        expect(factsOf(delivery("> /assign\n\nI think you meant to type that")).command).toBeNull();
        expect(factsOf(delivery("you could try /assign here")).command).toBeNull();
        expect(factsOf(delivery("hello\n  /assign  \nthanks")).command).toMatchObject({
            command: "assign",
        });
    });

    it("case and trailing words do not defeat the word", () => {
        expect(factsOf(delivery("/UNASSIGN @bob")).command).toMatchObject({
            command: "unassign",
            by: "alice",
        });
    });

    it("a comment on a pull request is consumed and unreadable, not ignored", () => {
        // The payload carries no `merged`, and closure is exactly what
        // `merged` decides (D47) — so no honest pull-request record can be
        // made. `ignored` would be the wrong word: that is the system working
        // on traffic which is not workflow traffic, and this IS workflow
        // traffic on an event we consume, arriving in a shape we cannot read.
        expect(read(delivery("/assign", { pull: true }))).toMatchObject({
            kind: "malformed",
            code: "commentUnreadable",
        });
    });

    it("a comment whose shape is not GitHub's is malformed, loudly", () => {
        for (const comment of [
            undefined,
            "a string",
            { created_at: AT, user: { login: "alice" } },
            { body: "/assign", user: { login: "alice" } },
            { body: "/assign", created_at: "not a date", user: { login: "alice" } },
            { body: "/assign", created_at: AT },
            { body: "/assign", created_at: AT, user: { login: "" } },
            { body: "/assign", created_at: AT, user: { login: 7 } },
        ]) {
            expect(read(delivery("/assign", { comment: comment ?? null }))).toMatchObject({
                kind: "malformed",
                code: "commentUnreadable",
            });
        }
    });

    it("a command on a closed issue is still read: the projection says it is closed", () => {
        const facts = factsOf(delivery("/assign", { closed: true }));

        expect(facts.command).toMatchObject({ command: "assign" });
        expect(facts.position).toMatchObject({ state: { closedBy: "closedByHuman" } });
    });

    it("a repository that mapped no command word has no commands at all", () => {
        expect(factsOf(delivery("/assign"), configWith({})).command).toBeNull();
    });
});
