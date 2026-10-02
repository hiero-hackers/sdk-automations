/**
 * Test-only support shared by more than one package: the captured webhook
 * payloads, and the temp-dir helpers for tests that touch disk.
 *
 * Fixtures are module-mediated, never path-read from outside this package (D82).
 */

import { afterEach, beforeEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * One captured delivery, with the provenance that makes it evidence.
 * `synthetic: false` is a type-level claim the compiler enforces.
 */
export interface WebhookCapture {
    /** The fixture's filename, and the key `capture()` takes. */
    readonly name: string;
    /** The `X-GitHub-Event` header this delivery arrived under. */
    readonly event: string;
    /** The date the delivery was captured. */
    readonly capturedAt: string;
    /** The capture protocol that scrubbed and reviewed it. */
    readonly protocol: string;
    /** Every capture here is a real delivery GitHub sent. */
    readonly synthetic: false;
    /** The raw bytes, as the shell's socket would have received them. */
    bytes(): Buffer<ArrayBuffer>;
    /** The parsed payload, as the normalizer would be handed it. */
    json(): unknown;
}

const PROTOCOL = "7.1";

function makeCapture(name: string, capturedAt: string): WebhookCapture {
    // The naming scheme IS the header: `<event>.<action>.json`.
    const event = name.split(".")[0]!;
    const bytes = (): Buffer<ArrayBuffer> =>
        readFileSync(new URL(`../fixtures/${name}`, import.meta.url));
    return {
        name,
        event,
        capturedAt,
        protocol: PROTOCOL,
        synthetic: false,
        bytes,
        json: () => JSON.parse(bytes().toString("utf8")) as unknown,
    };
}

/**
 * Every capture, listed rather than discovered: a directory read would go
 * quietly empty.
 */
export const WEBHOOK_CAPTURES: readonly WebhookCapture[] = [
    { name: "issues.opened.json", capturedAt: "2026-08-07" },
    { name: "issues.labeled.json", capturedAt: "2026-08-07" },
    { name: "issues.closed.json", capturedAt: "2026-08-07" },
    { name: "pull_request.opened.json", capturedAt: "2026-08-07" },
    { name: "pull_request.closed.json", capturedAt: "2026-08-07" },
    { name: "issue_comment.created.json", capturedAt: "2026-10-02" },
].map(({ name, capturedAt }) => makeCapture(name, capturedAt));

/** One capture by filename. A typo names the alternatives rather than throwing ENOENT. */
export function capture(name: string): WebhookCapture {
    const found = WEBHOOK_CAPTURES.find((candidate) => candidate.name === name);
    if (found === undefined) {
        const available = WEBHOOK_CAPTURES.map((candidate) => candidate.name).join(", ");
        throw new Error(`no captured fixture named ${name}; available: ${available}`);
    }
    return found;
}

/**
 * Run `fn` against a fresh temporary directory and remove it afterwards, throw
 * or not. An async `fn` has the removal chained onto its result.
 */
export function withTempDir<T>(prefix: string, fn: (dir: string) => T): T {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    const remove = (): void => {
        rmSync(dir, { recursive: true, force: true });
    };

    let result: T;
    try {
        result = fn(dir);
    } catch (error) {
        remove();
        throw error;
    }

    // `.then` rather than `.finally`, so any thenable is handled.
    try {
        const thenable = result as PromiseLike<unknown> | undefined;
        if (typeof thenable?.then === "function") {
            return thenable.then(
                (value) => {
                    remove();
                    return value;
                },
                (error: unknown) => {
                    remove();
                    throw error;
                },
            ) as T;
        }
    } catch (error) {
        remove();
        throw error;
    }

    remove();
    return result;
}

/** A per-test temporary directory, and paths inside the CURRENT one. */
export interface TempDirHandle {
    readonly dir: string;
    file(name: string): string;
}

/**
 * Register the hooks for a fresh temporary directory per test. Call at a
 * suite's top level; read `dir` from inside a test or a hook.
 */
export function useTempDir(prefix: string): TempDirHandle {
    let current: string | undefined;

    beforeEach(() => {
        current = mkdtempSync(join(tmpdir(), prefix));
    });

    afterEach(() => {
        if (current !== undefined) rmSync(current, { recursive: true, force: true });
        current = undefined;
    });

    const currentDir = (): string => {
        if (current === undefined) {
            throw new Error(
                `useTempDir(${prefix}): no directory outside a test — read it from a test or a hook, not at module load`,
            );
        }
        return current;
    };

    return {
        get dir() {
            return currentDir();
        },
        file: (name) => join(currentDir(), name),
    };
}
