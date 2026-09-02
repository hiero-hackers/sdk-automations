/**
 * What the stale sweep decides about one assignment: warn on the first
 * sighting, reclaim on the second, and nothing at all whenever the reclaim
 * would be destructive on an undetermined fact — a bot's assignment, or an
 * actor lookup that could not answer.
 *
 * One module's own branches. `boundary.test.ts` holds the conformance claims;
 * `engine-matrix.test.ts` runs the warn through `decide()`, where the gate
 * refuses an unprojected sweep before any report could show what it asked for.
 */

import { describe, expect, it } from "vitest";
import {
    projectCapabilityView,
    type ObservationCatalogue,
    type PlatformHandle,
} from "@hiero-hackers/automation-core";
import { inactivity, type InactivityDeclaration } from "../src/index.js";
import { configEnabling } from "./world.js";

const AT = new Date("2026-08-03T09:00:00.000Z");
const WARNED_AT = new Date("2026-07-27T09:00:00.000Z");
const REPO = { owner: "hiero-hackers", repo: "sandbox" } as const;
const ITEM = { kind: "issue", number: 13 } as const;

/** A repository that configured no grace period, so the probe reads its own. */
const view = projectCapabilityView(
    inactivity.declaration,
    configEnabling(["inactivity"], ["inactivity"]),
);

/** The same repository, having set a grace period of its own. */
const patient = projectCapabilityView(
    inactivity.declaration,
    configEnabling(["inactivity"], ["inactivity"], { inactivity: { gracePeriodDays: 21 } }),
);

type StaleEntry = ObservationCatalogue["staleItemsDue"]["items"][number];

const sweep = (...items: StaleEntry[]): ObservationCatalogue["staleItemsDue"] => ({
    kind: "staleItemsDue",
    repository: REPO,
    items,
    observedAt: AT,
});

const assigned = (warnedAt: Date | null): StaleEntry => ({
    item: ITEM,
    assignee: "contributor",
    lastHumanActivityAt: new Date("2026-07-01T00:00:00.000Z"),
    warnedAt,
});

/** Inactivity speaks through its intents, so any skip explanation is a failure. */
const handle = (
    resolve: PlatformHandle<InactivityDeclaration>["resolve"],
): PlatformHandle<InactivityDeclaration> => ({
    resolve,
    explain: () => {
        throw new Error("inactivity explains through its intents, never a skip");
    },
});

const answering = (
    answer: Awaited<ReturnType<PlatformHandle<InactivityDeclaration>["resolve"]>>,
): PlatformHandle<InactivityDeclaration> => handle(async () => answer);

const human = answering({ ok: true, value: false });

describe("inactivity", () => {
    /**
     * The warning in full. The body names the deadline it will act on, so the
     * grace period appears twice — once to the assignee, once in the report —
     * and both readings must come from the same number.
     */
    it("warns on the first sighting, at its own grace period", async () => {
        expect(await inactivity.evaluate(sweep(assigned(null)), view, human)).toEqual([
            {
                capability: "inactivity",
                repository: REPO,
                item: ITEM,
                operation: "postManagedComment",
                desired: {
                    kind: "warning",
                    body: "This has been assigned to @contributor without activity for a while. It will be unassigned in 7 days unless there is a comment or a commit.",
                },
                expected: { meaningsPresent: [], meaningsAbsent: [], closed: false },
                cause: { cause: "assignmentWentStale", observedAt: AT },
                explanation: {
                    capability: "inactivity",
                    summary: "Warned before reclaiming a stale assignment.",
                    detail: ["grace period 7 days"],
                },
                idempotencyKey: expect.any(String),
            },
        ]);
    });

    it("counts the repository's grace period wherever it states one", async () => {
        const intents = await inactivity.evaluate(sweep(assigned(null)), patient, human);

        expect(intents[0]?.desired).toEqual({
            kind: "warning",
            body: "This has been assigned to @contributor without activity for a while. It will be unassigned in 21 days unless there is a comment or a commit.",
        });
        expect(intents[0]?.explanation.detail).toEqual(["grace period 21 days"]);
    });

    it("reclaims on the second sighting, dated at the warning", async () => {
        const intents = await inactivity.evaluate(sweep(assigned(WARNED_AT)), view, human);

        expect(intents).toEqual([
            {
                capability: "inactivity",
                repository: REPO,
                item: ITEM,
                operation: "unassign",
                desired: { login: "contributor" },
                expected: { meaningsPresent: [], meaningsAbsent: [], closed: false },
                cause: { cause: "assignmentWentStale", observedAt: WARNED_AT },
                explanation: {
                    capability: "inactivity",
                    summary: "Reclaimed a stale assignment after the grace period.",
                    detail: ["warned at 2026-07-27T09:00:00.000Z", "grace period 7 days"],
                },
                idempotencyKey: expect.any(String),
            },
        ]);
        // Dating it at the sweep would restart the grace period on every run.
        expect(intents[0]?.cause.observedAt).not.toEqual(AT);
    });

    it("asks the actor resolver about the assignee it is about to reclaim from", async () => {
        const asked: { query: string; input: unknown }[] = [];
        const recording = handle(async (query, input) => {
            asked.push({ query, input });
            return { ok: true, value: false };
        });

        await inactivity.evaluate(sweep(assigned(WARNED_AT)), view, recording);

        expect(asked).toEqual([{ query: "isAutomationActor", input: { login: "contributor" } }]);
    });

    it("never reclaims from a bot, warned or not", async () => {
        const bot = answering({ ok: true, value: true });
        expect(
            await inactivity.evaluate(sweep(assigned(null), assigned(WARNED_AT)), view, bot),
        ).toEqual([]);
    });

    it("does nothing when it cannot tell whether the assignee is a bot", async () => {
        const undetermined = answering({
            ok: false,
            reason: "unavailable",
            detail: "the actor lookup is not wired up",
        });
        expect(
            await inactivity.evaluate(
                sweep(assigned(null), assigned(WARNED_AT)),
                view,
                undetermined,
            ),
        ).toEqual([]);
    });

    it("skips an unassigned item without asking about it", async () => {
        const unreachable = handle(async () => {
            throw new Error("an unassigned item has no actor to ask about");
        });
        const idle: StaleEntry = { ...assigned(null), assignee: null };
        expect(await inactivity.evaluate(sweep(idle), view, unreachable)).toEqual([]);
    });
});
