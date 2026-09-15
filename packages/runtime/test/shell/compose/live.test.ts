/**
 * The live fill's two allowances (D192): the sweep's share of each of GitHub's
 * pools, and the webhook lane's rest. The subject is which handle a seam set
 * spends — held seams are the lane's, and a seam set built for the sweep is the
 * sweep's — so the composition is driven through a scripted `fetch` rather than
 * asserted on. Everything else about this file is `compose/main.test.ts`.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { writeFileSync } from "node:fs";
import { useTempDir } from "@hiero-hackers/automation-testkit";
import { liveGitHub, type LiveOptions } from "../../../src/shell/compose/live.js";
import type { ShellOptions } from "../../../src/shell/compose/shell.js";

const REPOSITORY = { owner: "hiero-hackers", repo: "sdk-automations" } as const;

/** GitHub's own limit for this installation, small enough to spend in a test. */
const POOL_LIMIT = 10;
const RESET_SECONDS = 1_787_300_060;

/** The one config file every read below answers with, as GitHub's contents route carries it. */
const CONFIG_FILE = JSON.stringify({
    type: "file",
    encoding: "base64",
    sha: "a".repeat(40),
    content: Buffer.from("schemaVersion: 2\nmode: observe\n").toString("base64"),
});

const temp = useTempDir("shell-live-");

afterEach(() => {
    vi.unstubAllGlobals();
});

/** A GitHub that mints one token and answers every read, counting what reached it. */
function scriptedGitHub(): { readonly reads: () => number } {
    let reads = 0;
    vi.stubGlobal("fetch", (input: string | URL) => {
        const url = String(input);
        if (url.includes("/access_tokens")) {
            return Promise.resolve(
                new Response(
                    JSON.stringify({
                        token: "installation-token",
                        expires_at: "2099-01-01T00:00:00Z",
                        permissions: { contents: "read", issues: "write", metadata: "read" },
                    }),
                    { status: 201 },
                ),
            );
        }
        reads += 1;
        return Promise.resolve(
            new Response(CONFIG_FILE, {
                status: 200,
                headers: {
                    "x-ratelimit-limit": String(POOL_LIMIT),
                    "x-ratelimit-remaining": String(POOL_LIMIT),
                    "x-ratelimit-reset": String(RESET_SECONDS),
                    "x-ratelimit-resource": "core",
                },
            }),
        );
    });
    return { reads: () => reads };
}

/** The live fill over a real private key, with the sweep holding `share` of each pool. */
function live(share: number) {
    const privateKeyPath = temp.file("app.pem");
    writeFileSync(
        privateKeyPath,
        generateKeyPairSync("rsa", {
            modulusLength: 2048,
            publicKeyEncoding: { type: "spki", format: "pem" },
            privateKeyEncoding: { type: "pkcs8", format: "pem" },
        }).privateKey,
    );
    const options: LiveOptions = {
        credentials: { appId: "123456", installationId: "789", privateKeyPath },
        writes: null,
        killSwitchActive: false,
        clock: () => new Date("2026-09-15T10:00:00.000Z"),
        share,
        contentCreationHourly: null,
        knownCapabilities: [],
        ownWrites: () => () => [],
        log: () => {},
    };
    return liveGitHub(options);
}

/** Read the configuration `times` over, which is one core request each. */
async function loadOver(source: { load: () => Promise<unknown> }, times: number): Promise<void> {
    for (let read = 0; read < times; read += 1) await source.load();
}

describe("the two allowances one process holds", () => {
    it("gives the sweep its share of each pool and the webhook lane the rest", () => {
        const built = live(0.4);

        expect(built.sweepAllowance.standing()).toMatchObject([
            { pool: "core", allowed: 2_000 },
            { pool: "graphql", allowed: 2_000 },
        ]);
        expect(built.deliveryAllowance.standing()).toMatchObject([
            { pool: "core", allowed: 3_000 },
            { pool: "graphql", allowed: 3_000 },
        ]);
    });

    it("refuses the lane's reads past its share, and leaves the sweep's untouched", async () => {
        const github = scriptedGitHub();
        const built = live(0.4);

        // Six of GitHub's ten are the lane's; the seventh and eighth never leave.
        await loadOver(built.seamsFor(REPOSITORY).configSource, 8);

        expect(github.reads()).toBe(6);
        expect(built.deliveryAllowance.spent()).toMatchObject({ core: 6 });
        expect(built.deliveryAllowance.exhausted()).toBe("core");
        expect(built.deliveryAllowance.lastRefusal()).toEqual({
            lane: "core",
            resetAt: new Date(RESET_SECONDS * 1_000).toISOString(),
        });
        expect(built.sweepAllowance.spent()).toMatchObject({ core: 0 });
        expect(built.sweepAllowance.exhausted()).toBeNull();
    });

    /** The sweep's handle goes back in the way `compose/shell.ts` hands it back. */
    it("charges a seam set built for the sweep to the sweep's own allowance", async () => {
        const github = scriptedGitHub();
        const built = live(0.4);
        // Through the seam the shell fills, which is where the handle really goes back in.
        const seams: ShellOptions["seams"] = built.seamsFor;
        const sweeping = seams(REPOSITORY, built.sweepAllowance);

        await loadOver(sweeping.configSource, 6);

        // Four of GitHub's ten are the sweep's, and the lane's six are still there.
        expect(github.reads()).toBe(4);
        expect(built.sweepAllowance.spent()).toMatchObject({ core: 4 });
        expect(built.deliveryAllowance.spent()).toMatchObject({ core: 0 });
        expect(built.deliveryAllowance.exhausted()).toBeNull();
    });
});
