/**
 * `configAtHead` — the read behind the pull-request configuration report.
 *
 * Three confirmed endpoints in one answer, and the economy is part of the
 * contract: a pull request that leaves `sdk-automations.yml` alone costs the files
 * list and nothing else. The other subject running through the file is what the
 * arm refuses to guess. A file list it could not walk to the end of, a head
 * commit it could not read, and a 404 the list did not explain are all
 * `unavailable` — "the file is not in there" and "nobody read the rest" are
 * different answers (`design/contracts/catalogue.md`).
 *
 * Absence is the ONE case the list explains: a pull request whose own file list
 * says `removed` gets the parser's no-file result, never a 404 read as consent.
 */

import { describe, expect, it } from "vitest";
import {
    ABSENT_CONFIG_REVISION,
    flag,
    NO_CONFIG,
    spec,
    type AdmittedCapability,
    type ConfigAtHead,
    type ResolverAnswer,
    type ResolverSource,
} from "@hiero-hackers/automation-core";
import {
    CONFIRMED_RESOLVER_READS,
    createResolverSource,
} from "../../../src/adapter/reads/resolvers.js";
import { httpHarness, installationToken, success, type ResponseStep } from "../harness.js";

const REPOSITORY = { owner: "Hiero-Hackers", repo: "SDK-Automations" } as const;
const PULL = { kind: "pullRequest", number: 34 } as const;
const HEAD = "0123456789abcdef0123456789abcdef01234567";
const REPO_URL = "https://api.github.com/repos/Hiero-Hackers/SDK-Automations";

/**
 * The declarations a proposed document is judged against.
 *
 * Written here rather than imported: `packages/runtime/test/adapter/` may not
 * reach into the capabilities package (`.dependency-cruiser.cjs`), and this arm
 * should be tested against a list it controls anyway — what it must do with a
 * declaration is the same whichever capability supplied it.
 */
const KNOWN: readonly AdmittedCapability[] = [
    {
        name: "triageQueue",
        settings: spec({ announce: flag({ default: false, doc: "Say so in a comment." }) }),
        requiredMappings: { labels: ["awaitingTriage"] },
    },
];

function source(steps: readonly ResponseStep[]) {
    const harness = httpHarness(steps, {
        outcomes: [{ ok: true, token: installationToken("resolver-token") }],
    });
    return {
        resolve: createResolverSource({
            http: harness.client,
            repository: REPOSITORY,
            config: NO_CONFIG,
            knownCapabilities: KNOWN,
        }),
        urls: () => harness.scripted.calls.map((call) => call.url),
    };
}

const ask = (resolve: ResolverSource): Promise<ResolverAnswer<ConfigAtHead>> =>
    resolve("configAtHead", { item: PULL });

const fileEntry = (over: Record<string, unknown> = {}) => ({
    filename: "sdk-automations.yml",
    status: "modified",
    ...over,
});

/** A contents response, exactly as the config source's decoder reads one. */
const contents = (text: string) =>
    success(
        JSON.stringify({
            sha: "a".repeat(40),
            type: "file",
            encoding: "base64",
            content: Buffer.from(text, "utf8").toString("base64"),
        }),
    );

/**
 * A `Response` body is a one-shot stream, so every step is BUILT per test
 * rather than shared: a reused fixture is consumed by whichever test ran first
 * and arrives empty at the next one.
 */
const pullRequest = () => success(JSON.stringify({ number: 34, head: { sha: HEAD } }));

const PROPOSED = `schemaVersion: 2
mode: active
capabilities:
  triageQueue:
    enabled: true
    announce: true
mappings:
  labels:
    awaitingTriage: "status: triage"
`;

describe("configAtHead", () => {
    it("is a read the endpoint matrix has confirmed", () => {
        expect(CONFIRMED_RESOLVER_READS).toContain("configAtHead");
    });

    it("refuses an input that does not name a pull request", async () => {
        const { resolve, urls } = source([success("[]")]);

        expect(await resolve("configAtHead", { item: { kind: "issue", number: 3 } })).toMatchObject(
            { ok: false, reason: "unavailable" },
        );
        expect(urls()).toEqual([]);
    });

    it("answers an untouched file from the file list alone, and reads nothing else", async () => {
        const { resolve, urls } = source([
            success(JSON.stringify([{ filename: "src/a.ts", status: "added" }])),
        ]);

        expect(await ask(resolve)).toEqual({ ok: true, value: { touched: false } });
        expect(urls()).toEqual([`${REPO_URL}/pulls/34/files?per_page=100&page=1`]);
    });

    it("walks the file list to the page the configuration sits on", async () => {
        const { resolve, urls } = source([
            success(JSON.stringify([{ filename: "src/a.ts", status: "added" }]), {
                link: `<${REPO_URL}/pulls/34/files?per_page=100&page=2>; rel="last"`,
            }),
            success(JSON.stringify([fileEntry()])),
            pullRequest(),
            contents(PROPOSED),
        ]);

        const answer = await ask(resolve);

        expect(answer.ok && answer.value.touched).toBe(true);
        expect(urls()).toHaveLength(4);
    });

    it("walks on through next-only headers, the shape cursor pagination sends", async () => {
        const { resolve, urls } = source([
            success(JSON.stringify([{ filename: "src/a.ts", status: "added" }]), {
                link: `<${REPO_URL}/pulls/34/files?after=c1>; rel="next"`,
            }),
            success(JSON.stringify([{ filename: "src/b.ts", status: "added" }]), {
                link: `<${REPO_URL}/pulls/34/files?after=c2>; rel="next"`,
            }),
            success(JSON.stringify([fileEntry()]), {
                link: `<${REPO_URL}/pulls/34/files?page=2>; rel="prev"`,
            }),
            pullRequest(),
            contents(PROPOSED),
        ]);

        const answer = await ask(resolve);

        expect(answer.ok && answer.value.touched).toBe(true);
        expect(urls()).toHaveLength(5);
    });

    it("refuses a next-only list that runs past the walk", async () => {
        // A step that BUILDS its response: it is replayed for every page, and a
        // `Response` body reads once.
        const { resolve, urls } = source([
            () =>
                success(JSON.stringify([{ filename: "src/a.ts", status: "added" }]), {
                    link: `<${REPO_URL}/pulls/34/files?after=c>; rel="next"`,
                }),
        ]);

        expect(await ask(resolve)).toMatchObject({
            ok: false,
            reason: "unavailable",
            detail: expect.stringContaining("exceeded 10 pages"),
        });
        expect(urls()).toHaveLength(10);
    });

    it("refuses a list longer than the walk rather than calling the file untouched", async () => {
        // A step that BUILDS its response, because this one is replayed for
        // every page after the first and a `Response` body reads once.
        const { resolve, urls } = source([
            () =>
                success(JSON.stringify([{ filename: "src/a.ts", status: "added" }]), {
                    link: `<${REPO_URL}/pulls/34/files?per_page=100&page=11>; rel="last"`,
                }),
        ]);

        expect(await ask(resolve)).toMatchObject({
            ok: false,
            reason: "unavailable",
            detail: expect.stringContaining("exceeded 10 pages"),
        });
        expect(urls()).toHaveLength(10);
    });

    it.each([
        ["a body that is not a list", "{}"],
        ["an entry with no filename", JSON.stringify([{ status: "added" }])],
        ["an entry with no status", JSON.stringify([{ filename: "sdk-automations.yml" }])],
    ])("refuses %s", async (_what, body) => {
        const { resolve } = source([success(body)]);

        expect(await ask(resolve)).toMatchObject({ ok: false, reason: "unavailable" });
    });

    it("reads the proposed file at the head commit and parses it against the shipped list", async () => {
        const { resolve, urls } = source([
            success(JSON.stringify([fileEntry()])),
            pullRequest(),
            contents(PROPOSED),
        ]);

        const answer = await ask(resolve);

        expect(answer).toMatchObject({
            ok: true,
            value: {
                touched: true,
                result: { ok: true, config: { mode: "active" } },
            },
        });
        // The settings resolved against the spec that admitted them.
        expect(
            answer.ok && answer.value.touched && answer.value.result.ok
                ? answer.value.result.config.capabilities["triageQueue"]
                : null,
        ).toEqual({ enabled: true, settings: { announce: true } });
        expect(urls()[2]).toBe(`${REPO_URL}/contents/sdk-automations.yml?ref=${HEAD}`);
    });

    it("carries a rejection back as the parser's own errors, not as a failure", async () => {
        const { resolve } = source([
            success(JSON.stringify([fileEntry()])),
            pullRequest(),
            contents("schemaVersion: 2\ncapabilities:\n  triageQueue:\n    enabled: yes please\n"),
        ]);

        const answer = await ask(resolve);

        expect(answer.ok && answer.value.touched && answer.value.result.ok).toBe(false);
        expect(
            answer.ok && answer.value.touched && !answer.value.result.ok
                ? answer.value.result.errors.map((error) => error.code)
                : [],
        ).toEqual(["capabilityEnabledNotBoolean"]);
    });

    it.each([
        ["a deletion", fileEntry({ status: "removed" })],
        [
            "a rename away from the path",
            {
                filename: "renamed.yml",
                status: "renamed",
                previous_filename: "sdk-automations.yml",
            },
        ],
    ])("reads %s as the parser's no-file result, and reads no file", async (_what, entry) => {
        const { resolve, urls } = source([success(JSON.stringify([entry]))]);

        expect(await ask(resolve)).toEqual({
            ok: true,
            value: {
                touched: true,
                revision: ABSENT_CONFIG_REVISION,
                result: { ok: true, config: { ...NO_CONFIG, revision: ABSENT_CONFIG_REVISION } },
            },
        });
        expect(urls()).toHaveLength(1);
    });

    it.each([
        [
            "an answer about a different pull request",
            JSON.stringify({ number: 9, head: { sha: HEAD } }),
        ],
        ["a body that is not an object", "[]"],
        ["no head commit at all", JSON.stringify({ number: 34 })],
        ["a head sha that is not one", JSON.stringify({ number: 34, head: { sha: "../../etc" } })],
    ])("refuses %s", async (_what, body) => {
        const { resolve, urls } = source([success(JSON.stringify([fileEntry()])), success(body)]);

        expect(await ask(resolve)).toMatchObject({ ok: false, reason: "unavailable" });
        expect(urls()).toHaveLength(2);
    });

    it("carries a refused file-list call through as the resolver's own failure", async () => {
        const { resolve } = source([new Response("no", { status: 403 })]);

        expect(await ask(resolve)).toMatchObject({ ok: false });
    });

    it("refuses a file the list said was there and the contents read could not give", async () => {
        const { resolve } = source([
            success(JSON.stringify([fileEntry()])),
            pullRequest(),
            new Response("{}", { status: 404 }),
        ]);

        expect(await ask(resolve)).toMatchObject({ ok: false });
    });

    it.each([
        ["a shape that is not GitHub's", success("{}")],
        [
            "content it will not serve inline",
            success(JSON.stringify({ sha: "a".repeat(40), type: "file", encoding: "none" })),
        ],
    ])("refuses %s", async (_what, step) => {
        const { resolve } = source([success(JSON.stringify([fileEntry()])), pullRequest(), step]);

        expect(await ask(resolve)).toMatchObject({ ok: false, reason: "unavailable" });
    });
});
