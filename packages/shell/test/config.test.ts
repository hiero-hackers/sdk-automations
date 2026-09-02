/**
 * Where the repository's configuration file lives, and how its revision is
 * derived from the exact bytes — content addressing, so two loads of the
 * same text agree and an edit is always a new revision.
 */

import { describe, expect, it } from "vitest";
import { withTempDir } from "@hiero-hackers/automation-testkit";
import { chmodSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_PATH, fileConfigSource } from "../src/config.js";

describe("configuration source", () => {
    it("owns the repository path and content-addresses exact text", async () => {
        expect(CONFIG_PATH).toBe("automations.yml");
        // Returned, not fired and forgotten: withTempDir chains the removal
        // onto the promise, so the directory outlives the load it feeds.
        await withTempDir("shell-config-", async (directory) => {
            const path = join(directory, CONFIG_PATH);
            writeFileSync(path, "mode: observe\n");

            await expect(fileConfigSource(path).load()).resolves.toEqual({
                ok: true,
                document: { revision: "sha256:d7c5e99c8a84", text: "mode: observe\n" },
            });
        });
    });

    it("drops a leading BOM, matching the live source's decode", async () => {
        await withTempDir("shell-config-", async (directory) => {
            const path = join(directory, CONFIG_PATH);
            writeFileSync(path, "\uFEFFmode: observe\n");

            await expect(fileConfigSource(path).load()).resolves.toEqual({
                ok: true,
                document: { revision: "sha256:d7c5e99c8a84", text: "mode: observe\n" },
            });
        });
    });

    /**
     * Only the LEADING one. A U+FEFF anywhere else is a zero-width no-break
     * space in the operator's own bytes \u2014 content, not an encoding artefact \u2014
     * and the live source's decode leaves it alone too. Deleting it would
     * hand the parser a document GitHub never held.
     */
    it("keeps a BOM that is not the first character", async () => {
        await withTempDir("shell-config-", async (directory) => {
            const path = join(directory, CONFIG_PATH);
            const text = "mode: observe # a\uFEFFb\n";
            writeFileSync(path, text);

            await expect(fileConfigSource(path).load()).resolves.toMatchObject({
                ok: true,
                document: { text },
            });
        });
    });

    it("maps only an absent file to the no-config document", async () => {
        await withTempDir("shell-config-", async (directory) => {
            await expect(fileConfigSource(join(directory, "missing.yml")).load()).resolves.toEqual({
                ok: true,
                document: { revision: "sha256:absent", text: "" },
            });
        });
        // An unrecognised filesystem failure is transient, typed, never a throw.
        await expect(fileConfigSource("\0").load()).resolves.toMatchObject({
            ok: false,
            permanent: false,
        });
    });

    /**
     * The bug this guards: a misconfigured path used to read as weather, so
     * the delivery released its claim and asked the same broken path forever.
     * Permanent instead — the processor completes it as a rejection that says
     * what is wrong, which is the only thing that reaches an operator.
     */
    describe("a path no retry can fix is permanent", () => {
        const failureFor = async (build: (directory: string) => string) =>
            withTempDir("shell-config-", async (directory) =>
                fileConfigSource(build(directory)).load(),
            );

        it("classifies a directory at the config path (EISDIR)", async () => {
            const outcome = await failureFor((directory) => directory);
            expect(outcome).toMatchObject({ ok: false, permanent: true });
            // The message names the problem; a bare "unreadable" would not.
            expect(outcome).toMatchObject({ detail: expect.stringContaining("EISDIR") as string });
        });

        it("classifies a non-directory component in the path (ENOTDIR)", async () => {
            const outcome = await failureFor((directory) => {
                const file = join(directory, "not-a-directory");
                writeFileSync(file, "");
                return join(file, CONFIG_PATH);
            });
            expect(outcome).toMatchObject({ ok: false, permanent: true });
        });

        it("classifies a symlink loop (ELOOP)", async () => {
            const outcome = await failureFor((directory) => {
                const first = join(directory, "loop-a");
                const second = join(directory, "loop-b");
                symlinkSync(second, first);
                symlinkSync(first, second);
                return first;
            });
            expect(outcome).toMatchObject({ ok: false, permanent: true });
        });

        // Root reads through mode bits, so the errno never arrives there.
        it.skipIf(process.getuid?.() === 0)("classifies an unreadable file (EACCES)", async () => {
            await withTempDir("shell-config-", async (directory) => {
                const path = join(directory, CONFIG_PATH);
                writeFileSync(path, "mode: observe\n");
                chmodSync(path, 0o000);
                try {
                    await expect(fileConfigSource(path).load()).resolves.toMatchObject({
                        ok: false,
                        permanent: true,
                    });
                } finally {
                    chmodSync(path, 0o600);
                }
            });
        });

        it("leaves a readable file and a plain absence alone", async () => {
            // The classification must not have swallowed the two good paths.
            await withTempDir("shell-config-", async (directory) => {
                const path = join(directory, CONFIG_PATH);
                writeFileSync(path, "mode: observe\n");
                await expect(fileConfigSource(path).load()).resolves.toMatchObject({ ok: true });
                await expect(
                    fileConfigSource(join(directory, "missing.yml")).load(),
                ).resolves.toMatchObject({ ok: true });
            });
        });
    });
});
