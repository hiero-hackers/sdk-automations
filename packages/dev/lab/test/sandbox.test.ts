import { describe, expect, it, vi } from "vitest";
import { type Answer, type Call } from "../src/github.js";
import { ARM_VARIABLE, CONFIG_PATH, createSandbox, REF_VARIABLE } from "../src/action/sandbox.js";

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

/** One sandbox whose ARM_WRITES reads show the value before each write for `lag` reads after it. */
function variableWithLag() {
    let current = "false";
    let previous = "false";
    let staleReads = 0;
    const github = { lag: 0 };
    const call: Call = async (method, path, options) => {
        if (method === "POST") return answer(409);
        if (!path.endsWith(`/actions/variables/${ARM_VARIABLE}`)) return answer(404);
        if (method === "PATCH") {
            previous = current;
            current = (options?.body as { value: string }).value;
            staleReads = github.lag;
            return answer(204);
        }
        if (staleReads > 0) {
            staleReads--;
            return answer(200, { value: previous });
        }
        return answer(200, { value: current });
    };
    return { sandbox: createSandbox(call, "me", "sandbox"), github, held: () => current };
}

describe("the sandbox's variable read-back", () => {
    it("accepts a set and a restore that GitHub shows only on the fifth try", async () => {
        const { sandbox, github } = variableWithLag();
        github.lag = 4;

        await sandbox.setVariable(ARM_VARIABLE, "true");
        expect(await sandbox.restore()).toEqual([]);
    });

    it("still halts on a variable that reads back only after the five tries", async () => {
        const { sandbox, github } = variableWithLag();
        github.lag = 5;

        await expect(sandbox.setVariable(ARM_VARIABLE, "true")).rejects.toThrow(
            `${ARM_VARIABLE} does not read back`,
        );
    });

    it("writes the restore even when a lagging read already shows it", async () => {
        const { sandbox, github, held } = variableWithLag();
        github.lag = Number.POSITIVE_INFINITY;
        await expect(sandbox.setVariable(ARM_VARIABLE, "true")).rejects.toThrow();

        await sandbox.restore();
        expect(held()).toBe("false");
    });
});

/** One sandbox whose variables read as written, answered as GitHub answers and as `accept` allows. */
function variableStore() {
    const held = new Map<string, string>();
    const reply = (method: string, path: string, body?: { name: string; value: string }) => {
        const name = body?.name ?? path.split("/").at(-1) ?? "";
        const exists = held.has(name);
        if (method === "GET") return exists ? answer(200, { value: held.get(name) }) : answer(404);
        if (method === "POST" && !path.endsWith("/actions/variables")) return answer(404);
        if (method === "POST" && exists) return answer(409);
        if (method !== "POST" && !exists) return answer(404);
        if (method === "DELETE") held.delete(name);
        else if (body !== undefined) held.set(name, body.value);
        return answer(method === "POST" ? 201 : 204);
    };
    const call: Call = async (method, path, options) => {
        const answered = reply(method, path, options?.body as { name: string; value: string });
        if (!(options?.accept ?? [200]).includes(answered.status)) throw new Error("not accepted");
        return answered;
    };
    return { sandbox: createSandbox(call, "me", "sandbox"), held };
}

describe("the sandbox's variable writes", () => {
    it("creates a variable the sandbox lacks", async () => {
        const { sandbox, held } = variableStore();

        await sandbox.setVariable(REF_VARIABLE, "abc");
        expect(held.get(REF_VARIABLE)).toBe("abc");
    });

    it("updates a variable the sandbox has", async () => {
        const { sandbox, held } = variableStore();
        await sandbox.setVariable(REF_VARIABLE, "abc");

        await sandbox.setVariable(REF_VARIABLE, "def");
        expect(held.get(REF_VARIABLE)).toBe("def");
    });

    it("deletes on restore a variable the sandbox lacked", async () => {
        const { sandbox, held } = variableStore();
        await sandbox.setVariable(REF_VARIABLE, "abc");

        expect(await sandbox.restore()).toEqual([]);
        expect(held.has(REF_VARIABLE)).toBe(false);
    });

    it("restores to unset a variable already gone", async () => {
        const { sandbox, held } = variableStore();
        await sandbox.setVariable(REF_VARIABLE, "abc");
        held.delete(REF_VARIABLE);

        expect(await sandbox.restore()).toEqual([]);
    });

    it("restores ARM_WRITES to false even when it read true before the run", async () => {
        const { sandbox, held } = variableStore();
        held.set(ARM_VARIABLE, "true");
        await sandbox.setVariable(ARM_VARIABLE, "true");

        await sandbox.restore();
        expect(held.get(ARM_VARIABLE)).toBe("false");
    });
});
