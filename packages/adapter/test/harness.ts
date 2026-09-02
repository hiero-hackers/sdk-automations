/**
 * The doubles every adapter suite drives: one test epoch, lazily built App
 * credentials, scripted GitHub responses, a scripted token source, and the
 * two harnesses that wire them into the real implementations.
 *
 * Fixtures are built lazily inside tests, never at module or collection
 * time: an eagerly built fixture turns a mutant that breaks signing into a
 * collection crash, which vitest reports as "no tests" and Stryker scores
 * as survived (D89). In order below: time and tokens, credentials, scripted
 * GitHub, the harnesses.
 */

import type { ItemRef, RepositoryRef } from "@hiero-hackers/automation-core";
import { generateKeyPairSync } from "node:crypto";
import { expect } from "vitest";
import { createGitHubHttpClient, type FetchLike, type GitHubRequest } from "../src/http.js";
import type { AppCredentials } from "../src/jwt.js";
import { createReadBack, type AppIdentity, type ReadBack } from "../src/readback.js";
import {
    createTokenSource,
    type InstallationToken,
    type TokenOutcome,
    type TokenSource,
} from "../src/token.js";
import { createWriteVerbs, type WriteVerbs } from "../src/writes.js";

// ─── Time and tokens ─────────────────────────────────────────────────

/** The instant every suite's fixed or hand-moved clock starts at. */
export const TEST_NOW = new Date("2026-08-21T10:00:00.000Z");

export const HOUR_MS = 3_600_000;

/** A token that outlives any test, unless the test says otherwise. */
export function installationToken(
    value: string,
    expiresAt = new Date(TEST_NOW.getTime() + HOUR_MS),
): InstallationToken {
    return { value, expiresAt, grants: ["issues:write"] };
}

// ─── Credentials ─────────────────────────────────────────────────────

let keys: { publicKey: string; privateKey: string } | undefined;

/** One RSA pair per process, generated on first use — never at collection. */
export function keyPair(): { publicKey: string; privateKey: string } {
    keys ??= generateKeyPairSync("rsa", {
        modulusLength: 2048,
        publicKeyEncoding: { type: "spki", format: "pem" },
        privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    return keys;
}

/** The App identity every suite signs and mints as. */
export function credentials(): AppCredentials {
    return { appId: "123456", privateKeyPem: keyPair().privateKey, installationId: "789" };
}

// ─── Scripted GitHub ─────────────────────────────────────────────────

/** The URL most tests read; tests where the URL is the point pass their own. */
export const TEST_URL = "https://api.github.com/repos/hiero-hackers/sdk-automations/issues/132";

/** The same item as `TEST_URL`, for the surfaces that name it rather than spell it. */
export const TEST_REPOSITORY: RepositoryRef = { owner: "hiero-hackers", repo: "sdk-automations" };

export const TEST_ITEM: ItemRef = { kind: "issue", number: 132 };

/** The App a read-back suite recognises its own writing as. */
export const TEST_APP_IDENTITY: AppIdentity = { appId: "123456", botLogin: "hiero-hackers[bot]" };

/** One scripted reply: a response, a thrown transport error, or a probe. */
export type ResponseStep = Response | Error | ((url: string, init: RequestInit) => Response);

/** A fetch replaying `steps` — the last one repeats — that records each call. */
export function responseScript(steps: readonly ResponseStep[]) {
    const calls: Array<{ readonly url: string; readonly init: RequestInit }> = [];
    const fetch: FetchLike = (input, init) => {
        const url = String(input);
        const given = init ?? {};
        calls.push({ url, init: given });
        const step = steps[Math.min(calls.length - 1, steps.length - 1)]!;
        if (step instanceof Error) return Promise.reject(step);
        return Promise.resolve(typeof step === "function" ? step(url, given) : step);
    };
    return { fetch, calls };
}

export function success(body = '{"ok":true}', headers?: HeadersInit): Response {
    return new Response(body, headers === undefined ? { status: 200 } : { status: 200, headers });
}

export function failure(status: number, body: string, headers?: HeadersInit): Response {
    return new Response(body, headers === undefined ? { status } : { status, headers });
}

/** A well-formed GET for `TEST_URL`, with the parts under test overridden. */
export function githubRequest(
    overrides: {
        readonly url?: string;
        readonly headers?: Readonly<Record<string, string>>;
    } = {},
): GitHubRequest {
    return { url: TEST_URL, method: "GET", ...overrides };
}

/**
 * A token source replaying `steps` — the last one repeats, an `Error` step
 * rejects — that records what it was asked to invalidate.
 */
export function scriptedTokenSource(
    steps: ReadonlyArray<TokenOutcome | Error>,
    onInvalidate?: (rejected: InstallationToken) => void,
) {
    const invalidated: InstallationToken[] = [];
    let calls = 0;
    const source: TokenSource = {
        current: () => {
            const step = steps[Math.min(calls, steps.length - 1)]!;
            calls += 1;
            return step instanceof Error ? Promise.reject(step) : Promise.resolve(step);
        },
        invalidate: onInvalidate ?? ((rejected) => invalidated.push(rejected)),
    };
    return { source, invalidated, calls: () => calls };
}

// ─── The harnesses ───────────────────────────────────────────────────

/**
 * Seams an http test overrides; everything omitted gets a quiet default.
 *
 * `sleep` is for a test whose point is what happens DURING a pause — a
 * throwing seam, or a probe of client state mid-wait. Every pause is recorded
 * whether or not this is supplied, so the usual test reads `sleeps` and lets
 * the default return instantly.
 */
export interface HttpHarnessOptions {
    readonly outcomes?: ReadonlyArray<TokenOutcome | Error>;
    readonly onInvalidate?: (rejected: InstallationToken) => void;
    readonly clock?: () => Date;
    readonly sleep?: (milliseconds: number) => Promise<void>;
    readonly timeoutMs?: number;
    readonly timeoutSignal?: (milliseconds: number) => AbortSignal;
}

/** The real client over scripted GitHub, scripted tokens, and a fixed clock. */
export function httpHarness(steps: readonly ResponseStep[], options: HttpHarnessOptions = {}) {
    const scripted = responseScript(steps);
    const tokens = scriptedTokenSource(
        options.outcomes ?? [{ ok: true, token: installationToken("installation-token") }],
        options.onInvalidate,
    );
    const timeoutCalls: number[] = [];
    const sleeps: number[] = [];
    const client = createGitHubHttpClient({
        tokenSource: tokens.source,
        fetch: scripted.fetch,
        clock: options.clock ?? (() => TEST_NOW),
        sleep: (milliseconds) => {
            sleeps.push(milliseconds);
            return options.sleep === undefined ? Promise.resolve() : options.sleep(milliseconds);
        },
        ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
        timeoutSignal:
            options.timeoutSignal ??
            ((milliseconds) => {
                timeoutCalls.push(milliseconds);
                return AbortSignal.abort("test timeout signal");
            }),
    });
    return { client, scripted, tokens, timeoutCalls, sleeps };
}

/** The real write verbs over the http harness above. */
export function writeHarness(steps: readonly ResponseStep[], options: HttpHarnessOptions = {}) {
    const http = httpHarness(steps, options);
    const verbs: WriteVerbs = createWriteVerbs({
        http: http.client,
        repository: TEST_REPOSITORY,
    });
    return { ...http, verbs };
}

/** Seams a read-back test overrides; `sleep` replaces the clock's own advance. */
export interface ReadBackHarnessOptions {
    readonly identity?: AppIdentity;
    readonly clock?: () => Date;
    readonly sleep?: (milliseconds: number) => Promise<void>;
}

/**
 * The real read-back over scripted GitHub, with a clock the default sleep
 * MOVES — so an absence confirmation records its pause instead of taking one.
 * A test whose point is a gap that did not really pass supplies its own sleep.
 */
export function readBackHarness(
    steps: readonly ResponseStep[],
    options: ReadBackHarnessOptions = {},
) {
    const http = httpHarness(steps);
    let now = TEST_NOW;
    const sleeps: number[] = [];
    const readBack: ReadBack = createReadBack({
        http: http.client,
        repository: TEST_REPOSITORY,
        identity: options.identity ?? TEST_APP_IDENTITY,
        clock: options.clock ?? (() => now),
        sleep: (milliseconds) => {
            sleeps.push(milliseconds);
            if (options.sleep !== undefined) return options.sleep(milliseconds);
            now = new Date(now.getTime() + milliseconds);
            return Promise.resolve();
        },
    });
    return { readBack, scripted: http.scripted, sleeps };
}

/** The real token source over counted mints and a clock moved by hand. */
export function tokenHarness(outcomes: readonly TokenOutcome[], start = TEST_NOW) {
    let now = start;
    const assertions: string[] = [];
    const source = createTokenSource({
        credentials: credentials(),
        clock: () => now,
        mint: (assertion, given) => {
            // The source hands over its own credentials, so a mint can never
            // authenticate as an installation the source does not believe in.
            expect(given.installationId).toBe("789");
            assertions.push(assertion);
            const outcome = outcomes[Math.min(assertions.length - 1, outcomes.length - 1)];
            return Promise.resolve(outcome!);
        },
    });
    return {
        source,
        assertions,
        advance: (ms: number) => {
            now = new Date(now.getTime() + ms);
        },
    };
}
