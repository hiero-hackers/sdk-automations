import { describe, expect, it, vi } from "vitest";
import { type Answer, type Call } from "../src/github.js";
import { CONFIG_PATH, createSandbox } from "../src/action/sandbox.js";

vi.mock("node:timers/promises", () => ({ setTimeout: () => Promise.resolve() }));

const ORIGINAL = "mode: observe\n";

const answer = (status: number, body: unknown = {}): Answer => ({ status, body, date: null });

/** A blob's sha is its content, as git's is. */
const shown = (text: string): Answer =>
    answer(200, { sha: `blob:${text}`, content: Buffer.from(text).toString("base64") });

/** One sandbox whose config reads show the file before each write for `lag` reads after it. */
function sandboxWithLag() {
    let current = ORIGINAL;
    let previous = ORIGINAL;
    let staleReads = 0;
    const github = { lag: 0 };
    const call: Call = async (method, path, options) => {
        if (path === "/repos/me/sandbox") return answer(200, { default_branch: "main" });
        if (path.includes("/actions/variables/")) return answer(404);
        if (!path.endsWith(`/contents/${CONFIG_PATH}`)) return answer(404);
        if (method === "PUT") {
            const content = (options?.body as { content: string }).content;
            previous = current;
            current = Buffer.from(content, "base64").toString("utf8");
            staleReads = github.lag;
            return answer(200);
        }
        if (staleReads > 0) {
            staleReads--;
            return shown(previous);
        }
        return shown(current);
    };
    return { sandbox: createSandbox(call, "me", "sandbox"), github };
}

describe("the sandbox's config read-back", () => {
    it("accepts a write and a restore that GitHub shows a moment late", async () => {
        const { sandbox, github } = sandboxWithLag();
        await sandbox.inspect();
        github.lag = 2;

        expect(await sandbox.switchConfig("mode: active\n", "arm")).toBe("blob:mode: active\n");
        expect(await sandbox.restore()).toEqual([]);
    });

    it("still reports a restore that never reads back", async () => {
        const { sandbox, github } = sandboxWithLag();
        await sandbox.inspect();
        await sandbox.switchConfig("mode: active\n", "arm");
        github.lag = Number.POSITIVE_INFINITY;

        expect(await sandbox.restore()).toEqual([
            `restore ${CONFIG_PATH} on the default branch: ${CONFIG_PATH} reads back as blob:mode: active\n`,
        ]);
    });
});
