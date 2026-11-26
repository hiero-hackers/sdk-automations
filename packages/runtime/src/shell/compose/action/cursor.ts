/**
 * The sweep's cursor between Action runs: one file the workflow's cache carries from one scheduled
 * run to the next, because the run's store is gone at exit (D248).
 */

import { readFileSync, writeFileSync } from "node:fs";
import type { ShellEvent } from "../../log.js";

/** The cursor a previous run left, or why the file could not say. */
export type CursorRead =
    | { readonly ok: true; readonly resumeAfter: number | null }
    | { readonly ok: false; readonly detail: string };

function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/** The cursor a file's text spells, or `undefined` when it spells none. */
function cursorIn(text: string): number | null | undefined {
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        return undefined;
    }
    if (typeof parsed !== "object" || parsed === null) return undefined;
    const value = (parsed as { readonly resumeAfter?: unknown }).resumeAfter;
    if (value === null) return null;
    return typeof value === "number" && Number.isSafeInteger(value) && value > 0
        ? value
        : undefined;
}

/** An absent file is a first pass; an unreadable one is reported, and the caller starts over. */
export function readCursor(path: string): CursorRead {
    let text: string;
    try {
        text = readFileSync(path, "utf8");
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT")
            return { ok: true, resumeAfter: null };
        return {
            ok: false,
            detail: `the sweep cursor ${path} could not be read: ${messageOf(error)}`,
        };
    }
    const resumeAfter = cursorIn(text);
    return resumeAfter === undefined
        ? { ok: false, detail: `the sweep cursor ${path} holds no cursor` }
        : { ok: true, resumeAfter };
}

/** Write where the run's firing left the cursor; the failure to write, or `null`. */
export function keepCursor(path: string, events: readonly ShellEvent[]): string | null {
    const finished = [...events].reverse().find((event) => event.event === "sweepFinished");
    // No firing finished, so the file keeps the cursor it was restored with.
    if (finished?.event !== "sweepFinished") return null;
    try {
        writeFileSync(path, `${JSON.stringify({ resumeAfter: finished.resumeAfter })}\n`);
        return null;
    } catch (error) {
        return `the sweep cursor ${path} could not be written: ${messageOf(error)}`;
    }
}
