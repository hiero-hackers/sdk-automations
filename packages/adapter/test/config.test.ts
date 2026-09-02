/**
 * The live configuration source: typed outcomes and corroborated absence,
 * driven through the REAL client via the shared harness. Bodies are
 * SYNTHETIC, shaped from GitHub's documented contents format.
 */

import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import { ABSENT_CONFIG_REVISION, CONFIG_PATH, revisionOf } from "@hiero-hackers/automation-core";
import { githubConfigSource } from "../src/config.js";
import { failure, httpHarness as harness, success } from "./harness.js";

const SHA = "0123456789abcdef0123456789abcdef01234567";
const REPOSITORY = { owner: "hiero-hackers", repo: "sdk-automations" };
const REPO_URL = "https://api.github.com/repos/hiero-hackers/sdk-automations";
const CONFIG_URL = `${REPO_URL}/contents/${CONFIG_PATH}`;

function fileBody(text: string, overrides: Readonly<Record<string, unknown>> = {}): string {
    return JSON.stringify({
        type: "file",
        encoding: "base64",
        content: Buffer.from(text).toString("base64"),
        sha: SHA,
        ...overrides,
    });
}

function source(steps: Parameters<typeof harness>[0]) {
    const built = harness(steps);
    const configSource = githubConfigSource({ client: built.client, repository: REPOSITORY });
    return { load: () => configSource.load(), scripted: built.scripted };
}

describe("the live configuration source", () => {
    it("reads a committed file and records its content hash", async () => {
        const { load, scripted } = source([success(fileBody("mode: observe\n"))]);

        await expect(load()).resolves.toEqual({
            ok: true,
            document: { revision: revisionOf("mode: observe\n"), text: "mode: observe\n" },
        });
        expect(scripted.calls).toHaveLength(1);
        expect(scripted.calls[0]!.url).toBe(CONFIG_URL);
        expect(new URL(scripted.calls[0]!.url).search).toBe("");
    });

    it("replays the cached representation on a 304", async () => {
        const { load, scripted } = source([
            success(fileBody("mode: observe\n"), { etag: '"v1"' }),
            new Response(null, { status: 304 }),
        ]);

        await load();
        await expect(load()).resolves.toMatchObject({
            ok: true,
            document: { revision: revisionOf("mode: observe\n"), text: "mode: observe\n" },
        });
        expect(scripted.calls).toHaveLength(2);
    });

    it("preserves UTF-8 text from GitHub's line-wrapped base64", async () => {
        const text = "mode: observe\n# café ☕\n";
        const encoded = Buffer.from(text).toString("base64");
        const body = fileBody("", { content: `${encoded.slice(0, 8)}\n${encoded.slice(8)}\r\n` });
        const { load } = source([success(body)]);

        await expect(load()).resolves.toEqual({
            ok: true,
            document: { revision: revisionOf(text), text },
        });
    });

    it("drops a leading BOM, matching the local source", async () => {
        const { load } = source([success(fileBody("\uFEFFmode: observe\n"))]);

        await expect(load()).resolves.toEqual({
            ok: true,
            document: { revision: revisionOf("mode: observe\n"), text: "mode: observe\n" },
        });
    });

    it("corroborates a 404 into absence only when the repository answers", async () => {
        const { load, scripted } = source([failure(404, "Not Found"), success('{"id":1}')]);

        await expect(load()).resolves.toEqual({
            ok: true,
            document: { revision: ABSENT_CONFIG_REVISION, text: "" },
        });
        expect(scripted.calls.map((call) => call.url)).toEqual([CONFIG_URL, REPO_URL]);
    });

    it("corroborates only a 404 — a 403 never asks the repository", async () => {
        const { load, scripted } = source([failure(403, "forbidden"), success('{"id":1}')]);

        await expect(load()).resolves.toMatchObject({
            ok: false,
            permanent: false,
            detail: expect.stringContaining("config read failed") as string,
        });
        expect(scripted.calls).toHaveLength(1);
    });

    it("treats a 404 with an invisible repository as access, not absence", async () => {
        const { load, scripted } = source([failure(404, "Not Found"), failure(404, "Not Found")]);

        await expect(load()).resolves.toMatchObject({
            ok: false,
            permanent: false,
            detail: expect.stringContaining("access, not absence") as string,
        });
        expect(scripted.calls).toHaveLength(2);
    });

    it.each([
        ["a transport failure", [new Error("reset"), new Error("still reset")]],
        ["a 403", [failure(403, "forbidden")]],
        ["a 500", [failure(500, "boom"), failure(500, "boom")]],
    ] as const)("answers transient for %s, never absence", async (_label, steps) => {
        const { load } = source([...steps]);

        await expect(load()).resolves.toMatchObject({ ok: false, permanent: false });
    });

    it.each([
        ["a directory", fileBody("", { type: "dir" })],
        ["an oversized file's encoding none", fileBody("", { encoding: "none", content: "" })],
        ["a non-string content", fileBody("", { content: 7 })],
        ["invalid base64", fileBody("", { content: "%%%=" })],
        ["non-canonical base64", fileBody("", { content: "AB==" })],
        ["invalid UTF-8", fileBody("", { content: "/w==" })],
    ])("marks %s as a permanent defect naming the blob", async (_label, body) => {
        const { load } = source([success(body)]);

        const outcome = await load();
        expect(outcome).toMatchObject({ ok: false, permanent: true, revision: `git:${SHA}` });
        if (!outcome.ok) expect(outcome.detail.length).toBeGreaterThan(10);
    });

    it.each([
        ["invalid JSON", "{"],
        ["a non-object body", "[]"],
        ["a malformed sha", fileBody("", { sha: "not-a-sha" })],
        ["a numeric sha", fileBody("", { sha: 123 })],
        ["a sha with trailing junk", fileBody("", { sha: `${SHA}x` })],
        ["a sha with leading junk", fileBody("", { sha: `x${SHA}` })],
        ["a 64-char non-hex sha", fileBody("", { sha: "z".repeat(64) })],
        ["a single-hex-char sha", fileBody("", { sha: "a" })],
    ])("treats %s as an unrecognized shape, transient", async (_label, body) => {
        const { load } = source([success(body)]);

        await expect(load()).resolves.toMatchObject({
            ok: false,
            permanent: false,
            detail: expect.stringContaining("unrecognized") as string,
        });
    });

    it("re-corroborates absence on every load, so a first commit binds at once", async () => {
        const built = harness([
            failure(404, "Not Found"),
            success('{"id":1}'),
            success(fileBody("schemaVersion: 1\n")),
        ]);
        const src = githubConfigSource({ client: built.client, repository: REPOSITORY });

        await expect(src.load()).resolves.toEqual({
            ok: true,
            document: { revision: ABSENT_CONFIG_REVISION, text: "" },
        });
        const second = await src.load();
        expect(second.ok).toBe(true);
        if (second.ok) {
            expect(second.document.text).toBe("schemaVersion: 1\n");
        }
        expect(built.scripted.calls).toHaveLength(3);
    });

    it("encodes repository names as path components", async () => {
        const built = harness([success(fileBody(""))]);
        await githubConfigSource({
            client: built.client,
            repository: { owner: "owner/name", repo: "repo?ref=attacker" },
        }).load();

        expect(built.scripted.calls[0]!.url).toBe(
            `https://api.github.com/repos/owner%2Fname/repo%3Fref%3Dattacker/contents/${CONFIG_PATH}`,
        );
    });
});
