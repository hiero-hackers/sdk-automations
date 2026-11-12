/**
 * The world's departures from a plain store, each as GitHub answers it: a paged list, a locked
 * conversation, a transferred item, a label named under another case, and a lost write reply.
 */

import { describe, expect, it } from "vitest";
import { createWorld, githubScript, UPDATED, type GitHubScript } from "../src/index.js";

const now = (): Date => new Date(UPDATED);
const REPO = "/repos/scrubbed-1/scrubbed-2";

function github(world: ReturnType<typeof createWorld>, script: Partial<GitHubScript> = {}) {
    const { answer, calls } = githubScript({ now, config: () => "", world, ...script });
    const send = (method: string, route: string, body: unknown = null, query = "") =>
        answer({
            method,
            path: `${REPO}${route}`,
            ifNoneMatch: null,
            body: body === null ? "" : JSON.stringify(body),
            query,
        });
    return { send, calls };
}

const comment = (id: number) => ({
    id,
    body: String(id),
    user: { login: "ada", type: "User" as const },
    created_at: UPDATED,
    updated_at: UPDATED,
});

describe("the world, where it answers as GitHub does", () => {
    it("pages a list by the query, linking the next and the last page", () => {
        const comments = Array.from({ length: 250 }, (_, at) => comment(at + 1));
        const world = createWorld({ now, items: [{ number: 12, author: "ada", comments }] });
        const { send } = github(world);

        const second = send("GET", "/issues/12/comments", null, "?per_page=100&page=2");
        const third = send("GET", "/issues/12/comments", null, "?per_page=100&page=3");

        expect((JSON.parse(second.body ?? "") as unknown[]).length).toBe(100);
        expect(second.headers["link"]).toContain('page=3>; rel="last"');
        expect((JSON.parse(third.body ?? "") as unknown[]).length).toBe(50);
        expect(third.headers["link"]).toBeUndefined();
    });

    it("refuses a comment on a locked conversation", () => {
        const world = createWorld({ now, items: [{ number: 12, author: "ada", locked: true }] });

        expect(github(world).send("POST", "/issues/12/comments", { body: "hi" }).status).toBe(403);
        expect(world.items.get(12)?.comments).toEqual([]);
    });

    it("answers 301 for every route to a transferred item, and lists it no more", () => {
        const world = createWorld({ now, items: [{ number: 12, author: "ada" }] });
        const { send } = github(world);
        world.transfer(12);

        expect(send("GET", "/issues/12").status).toBe(301);
        expect(send("POST", "/issues/12/comments", { body: "hi" }).status).toBe(301);
        expect(JSON.parse(send("GET", "/issues").body ?? "")).toEqual([]);
    });

    it("adds a label named under another case as the repository spells it", () => {
        const world = createWorld({
            now,
            items: [{ number: 12, author: "ada" }],
            labels: ["Status: Triage"],
        });
        const { send } = github(world);

        expect(send("GET", `/labels/${encodeURIComponent("status: triage")}`).status).toBe(200);
        send("POST", "/issues/12/labels", { labels: ["status: triage"] });

        expect(world.items.get(12)?.labels).toEqual(["Status: Triage"]);
        expect([...world.labels]).toEqual(["Status: Triage"]);
    });

    it("applies a write whose reply it loses, answering 502", () => {
        const world = createWorld({ now, items: [{ number: 12, author: "ada" }] });
        const { send } = github(world, { losesWriteReply: () => true });

        expect(send("POST", "/issues/12/comments", { body: "hi" }).status).toBe(502);
        expect(world.items.get(12)?.comments.map(({ body }) => body)).toEqual(["hi"]);
    });
});
