/**
 * The capture lock: every listed webhook capture is tracked, parses, and names the event and
 * action it carries; every normalised event has a capture or is named as awaiting one; and no
 * capture outlives the freshness window. One invariant per `it` (D89).
 */

import { describe, expect, it } from "vitest";
import { WEBHOOK_CAPTURES, type WebhookCapture } from "@hiero-hackers/automation-testkit";
import { repositoryFiles } from "./repository.js";

/** Older evidence is a red check: nobody re-captured, so the fixtures describe a past GitHub. */
const CAPTURE_FRESHNESS_DAYS = 90;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const FIXTURES = "packages/dev/testkit/fixtures";

const NORMALIZE_DIR = "packages/core/src/engine/normalize";

/** Files in the normaliser directory that are not one event's normaliser. */
const NOT_AN_EVENT = new Set(["payload.ts", "verdict.ts", "index.ts"]);

/** Events with a normaliser and no capture yet; delete the entry when the capture lands. */
const AWAITING_CAPTURE = new Map<string, string>();

/** Every failure message ends with this, so a red check says what to run. */
const ADVICE =
    "run `pnpm lab:probe` (packages/dev/lab), review evidence/pending/, promote the capture (protocol 7.1)";

/** `issue-comment.ts` is the normaliser of the `issue_comment` event. */
function eventOfModule(fileName: string): string {
    return fileName.replace(/\.ts$/, "").replaceAll("-", "_");
}

/** `issues.opened.json` names the action `opened`. */
function actionOf(fileName: string): string | undefined {
    return fileName.split(".")[1];
}

/** Whether a capture dated `capturedAt` is no older than `days` at `now`. */
function isFresh(capturedAt: string, now: Date, days: number): boolean {
    const captured = Date.parse(capturedAt);
    return Number.isFinite(captured) && (now.getTime() - captured) / MS_PER_DAY <= days;
}

function ageInDays(capturedAt: string, now: Date): number {
    return Math.floor((now.getTime() - Date.parse(capturedAt)) / MS_PER_DAY);
}

/** The parsed payload, or `null` when it is not a JSON object. */
function payloadOf(subject: WebhookCapture): Record<string, unknown> | null {
    const held = subject.json();
    return typeof held === "object" && held !== null ? (held as Record<string, unknown>) : null;
}

/** The events that have a normaliser, read from the directory listing. */
function normalisedEvents(files: readonly string[]): string[] {
    const prefix = `${NORMALIZE_DIR}/`;
    return files
        .filter((path) => path.startsWith(prefix) && path.endsWith(".ts"))
        .map((path) => path.slice(prefix.length))
        .filter((fileName) => !fileName.includes("/") && !NOT_AN_EVENT.has(fileName))
        .map(eventOfModule)
        .sort();
}

const capturedEvents = new Set(WEBHOOK_CAPTURES.map((subject) => subject.event));

describe("the captured webhook fixtures hold their invariants", () => {
    const files = repositoryFiles();
    const events = normalisedEvents(files);

    it("every listed capture is tracked and parses as an object", () => {
        expect(WEBHOOK_CAPTURES.length, `no captures listed: ${ADVICE}`).toBeGreaterThan(0);
        for (const subject of WEBHOOK_CAPTURES) {
            expect(files, `${subject.name} is not tracked: ${ADVICE}`).toContain(
                `${FIXTURES}/${subject.name}`,
            );
            expect(
                payloadOf(subject),
                `${subject.name} is not a JSON object: ${ADVICE}`,
            ).not.toBeNull();
        }
    });

    it("a capture's filename names the event and action its payload carries", () => {
        for (const subject of WEBHOOK_CAPTURES) {
            expect(
                subject.event,
                `${subject.name} is named for another event than it declares: ${ADVICE}`,
            ).toBe(subject.name.split(".")[0]);
            expect(
                payloadOf(subject)?.action,
                `${subject.name} carries another action than its name: ${ADVICE}`,
            ).toBe(actionOf(subject.name));
        }
    });

    it("every normalised event has a capture, or is named as awaiting one", () => {
        expect(
            events.length,
            `no normalisers found in ${NORMALIZE_DIR}: ${ADVICE}`,
        ).toBeGreaterThan(0);
        const unnamed = events.filter(
            (event) => !capturedEvents.has(event) && !AWAITING_CAPTURE.has(event),
        );
        const landed = [...AWAITING_CAPTURE.keys()].filter((event) => capturedEvents.has(event));
        expect(unnamed, `events with neither a capture nor an awaiting entry: ${ADVICE}`).toEqual(
            [],
        );
        expect(landed, `awaiting entries whose capture has landed; delete them: ${ADVICE}`).toEqual(
            [],
        );
    });

    it("every capture's event has a normaliser", () => {
        const orphaned = [...capturedEvents].filter((event) => !events.includes(event));
        expect(orphaned, `captures of an event no normaliser reads: ${ADVICE}`).toEqual([]);
    });

    it("no capture is older than the freshness window", () => {
        const now = new Date();
        const stale = WEBHOOK_CAPTURES.filter(
            (subject) => !isFresh(subject.capturedAt, now, CAPTURE_FRESHNESS_DAYS),
        ).map(
            (subject) =>
                `${subject.name} (${subject.capturedAt}, ${ageInDays(subject.capturedAt, now)} days old)`,
        );
        expect(stale, `captures older than ${CAPTURE_FRESHNESS_DAYS} days: ${ADVICE}`).toEqual([]);
    });

    it("proves the helpers fail in both directions", () => {
        const now = new Date("2026-10-02T00:00:00Z");
        const daysBefore = (days: number): string =>
            new Date(now.getTime() - days * MS_PER_DAY).toISOString().slice(0, 10);

        expect(eventOfModule("issue-comment.ts")).toBe("issue_comment");
        expect(eventOfModule("issues.ts")).toBe("issues");
        expect(eventOfModule("pull-request.ts")).toBe("pull_request");
        expect(eventOfModule("pull-request.ts")).not.toBe("pull-request");

        expect(actionOf("issues.opened.json")).toBe("opened");
        expect(actionOf("issues.opened.json")).not.toBe("issues");
        expect(actionOf("pull_request.closed.json")).toBe("closed");

        expect(isFresh(daysBefore(89), now, CAPTURE_FRESHNESS_DAYS)).toBe(true);
        expect(isFresh(daysBefore(91), now, CAPTURE_FRESHNESS_DAYS)).toBe(false);
        expect(isFresh("not a date", now, CAPTURE_FRESHNESS_DAYS)).toBe(false);

        expect(
            normalisedEvents([
                `${NORMALIZE_DIR}/issues.ts`,
                `${NORMALIZE_DIR}/payload.ts`,
                `${NORMALIZE_DIR}/nested/deep.ts`,
                "elsewhere/pull-request.ts",
            ]),
        ).toEqual(["issues"]);
    });
});
