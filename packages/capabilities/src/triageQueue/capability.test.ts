/**
 * What triageQueue decides at the entry gate. Each refusal is paired with the
 * input that does produce a label intent.
 */

import { describe, expect, it } from "vitest";
import {
    handleFor,
    parseConfig,
    projectCapabilityView,
    type Facts,
    type IssueMeaning,
    type Projection,
    type ResolverAnswer,
    type ResolverSource,
    type WorkItemState,
} from "@hiero-hackers/automation-core";
import { triageQueue, triageQueueDeclaration } from "./capability.js";
import {
    configEnabling,
    factsFor,
    OBSERVED_AT,
    REPOSITORY,
    webhookIssue,
} from "@hiero-hackers/automation-core/author/testing";

const ITEM = { kind: "issue", number: 11 } as const;

const announcing = configEnabling(["triageQueue"], [triageQueueDeclaration], {
    triageQueue: { welcome: true },
});
const silent = configEnabling(["triageQueue"], [triageQueueDeclaration]);
const silentView = projectCapabilityView(triageQueueDeclaration, silent);
const announcingView = projectCapabilityView(triageQueueDeclaration, announcing);
const quarantining = configEnabling(["triageQueue"], [triageQueueDeclaration], {
    triageQueue: { welcome: true, lockUntilTriaged: true, confirmUnlock: true },
});
const quarantineView = projectCapabilityView(triageQueueDeclaration, quarantining);
const lockingOnly = configEnabling(["triageQueue"], [triageQueueDeclaration], {
    triageQueue: { lockUntilTriaged: true },
});
const lockingView = projectCapabilityView(triageQueueDeclaration, lockingOnly);
const advisory = configEnabling(
    ["triageQueue"],
    [triageQueueDeclaration],
    { triageQueue: { requirements: { skill: true } } },
    { skills: { beginner: "skill: beginner", advanced: "skill: advanced" } },
);
const advisoryView = projectCapabilityView(triageQueueDeclaration, advisory);

const issue = (
    state: Partial<WorkItemState<IssueMeaning>>,
    over: Parameters<typeof webhookIssue>[0] = {},
) =>
    factsFor(
        triageQueueDeclaration,
        webhookIssue({
            ...over,
            item: ITEM,
            position: {
                kind: "position",
                state: { meaning: null, blocked: false, closedBy: null, ...state },
                ignored: [],
            } satisfies Projection<IssueMeaning>,
        }),
    );

/** The same issue, seen holding more than one position at once. */
const conflicted = (
    positions: readonly IssueMeaning[],
    over: Parameters<typeof webhookIssue>[0] = {},
) =>
    factsFor(
        triageQueueDeclaration,
        webhookIssue({
            ...over,
            item: ITEM,
            position: {
                kind: "conflict",
                positions,
                blocked: false,
                closedBy: null,
                ignored: [],
            } satisfies Projection<IssueMeaning>,
        }),
    );

/**
 * The engine's own handle over one record, answering triageQueue's one resolver.
 * The default answer is "a person"; `asked` is the login each question named.
 */
function watch(record: Facts, actor: ResolverAnswer<boolean> = { ok: true, value: false }) {
    const asked: string[] = [];
    const source: ResolverSource = async (_query, input) => {
        asked.push((input as { readonly login: string }).login);
        return await Promise.resolve(actor as never);
    };
    const handle = handleFor(triageQueueDeclaration, record, source);
    return { platform: handle, handle, asked };
}

describe("triageQueue", () => {
    it("Issue opened by a bot", async () => {
        const record = factsFor(triageQueueDeclaration, webhookIssue({ author: "renovate[bot]" }));
        const { platform, handle, asked } = watch(record, { ok: true, value: true });

        expect(await triageQueue.evaluate(record, announcingView, platform)).toEqual([]);
        // The AUTHOR, not the actor: the guard asks who opened the issue.
        expect(asked).toEqual(["renovate[bot]"]);
        // Silence, not a report: a machine's issue is not a problem.
        expect(handle.explanations).toEqual([]);
    });

    it("stops, and says so, when nobody can answer who opened the issue", async () => {
        const record = issue({});
        const { platform, handle } = watch(record, {
            ok: false,
            reason: "rateLimited",
            detail: "secondary rate limit",
        });

        // The platform ends the evaluation; nothing comes back to be gated.
        await expect(triageQueue.evaluate(record, announcingView, platform)).rejects.toBeDefined();
        expect(handle.skipped).toBe(true);
        expect(handle.explanations).toEqual([
            {
                capability: "triageQueue",
                summary: "Skipped: the isAutomationActor resolver could not answer.",
                detail: ["resolver reason: rateLimited", "secondary rate limit"],
            },
        ]);
    });

    it("names both positions of a conflicted item, and repairs neither (D35)", async () => {
        const record = conflicted(["ready", "inProgress"]);
        const { platform, handle } = watch(record);

        expect(await triageQueue.evaluate(record, announcingView, platform)).toEqual([]);
        expect(handle.explanations).toEqual([
            {
                capability: "triageQueue",
                summary: "Skipped: the item holds more than one workflow position.",
                detail: [
                    "conflicting: ready, inProgress",
                    "a conflict is reported, never repaired (D35)",
                ],
            },
        ]);
    });

    /** D84: the meaning triageQueue requires is the parser's business, never a delivery's. */
    /** D203: a file that never maps `awaitingTriage` triages on the default spelling. */
    it("triages a repository that never mapped awaitingTriage, on its default spelling", () => {
        const file = (labels: Readonly<Record<string, string>>) =>
            parseConfig(
                {
                    schemaVersion: 2,
                    capabilities: { triageQueue: { enabled: true, welcome: true } },
                    mappings: { labels },
                },
                { revision: "rev-1", knownCapabilities: [triageQueueDeclaration] },
            );

        const defaulted = file({ ready: "status: ready for dev" });
        expect(defaulted.ok ? defaulted.config.mappings.labels.awaitingTriage : null).toBe(
            "status: triage",
        );
        const spelled = file({ awaitingTriage: "triage: new" });
        expect(spelled.ok ? spelled.config.mappings.labels.awaitingTriage : null).toBe(
            "triage: new",
        );
    });

    /** An issue template applied the triage label itself: the gate still welcomes and locks. */
    it("welcomes and locks an issue a template already labelled awaitingTriage", async () => {
        const record = issue({ meaning: "awaitingTriage" });
        const intents = await triageQueue.evaluate(record, quarantineView, watch(record).platform);

        expect(intents.map((intent) => intent.operation)).toEqual([
            "postManagedComment",
            "lockIssue",
        ]);
    });

    it("leaves a template-labelled issue alone when neither welcome nor lock is asked", async () => {
        const record = issue({ meaning: "awaitingTriage" });

        expect(
            await triageQueue.evaluate(
                record,
                projectCapabilityView(triageQueueDeclaration, silent),
                watch(record).platform,
            ),
        ).toEqual([]);
    });

    it("leaves an issue that already holds a position, silently", async () => {
        const record = issue({ meaning: "inProgress" });
        const { platform, handle } = watch(record);

        expect(await triageQueue.evaluate(record, announcingView, platform)).toEqual([]);
        expect(handle.explanations).toEqual([]);
    });

    it.each([
        [[], "- [ ] Skill level — the team sets one skill label"],
        [["beginner"], "- [x] Skill level — beginner"],
        [
            ["beginner", "advanced"],
            "- [ ] Skill level — more than one skill label; the team keeps one",
        ],
    ] as const)(
        "welcomes with the checklist row for skills %j, even with welcome off",
        async (skills, row) => {
            const record = issue({}, { skills: [...skills] });
            const intents = await triageQueue.evaluate(
                record,
                advisoryView,
                watch(record).platform,
            );

            expect(intents.map((intent) => intent.operation)).toEqual([
                "applyMappedLabel",
                "postManagedComment",
            ]);
            expect(intents[1]?.desired).toMatchObject({
                topic: "welcome",
                body: expect.stringContaining(`\n\nTriage checklist:\n${row}`),
            });
        },
    );

    /** The skill label may come from anyone; the issue must still be a person's. */
    it.each([
        ["added", ["beginner"], "- [x] Skill level — beginner"],
        ["removed", [], "- [ ] Skill level — the team sets one skill label"],
    ] as const)(
        "rewrites the welcome when a skill label is %s while awaiting triage",
        async (change, skills, row) => {
            const record = issue(
                { meaning: "awaitingTriage" },
                {
                    actor: { login: "triage-bot[bot]" },
                    skills: [...skills],
                    arrival: { kind: "label", change, meaning: null, skill: "beginner" },
                },
            );
            const { platform, asked } = watch(record);

            expect(await triageQueue.evaluate(record, advisoryView, platform)).toEqual([
                expect.objectContaining({
                    operation: "postManagedComment",
                    cause: { cause: "triageChecklistChanged", observedAt: OBSERVED_AT },
                    desired: expect.objectContaining({ body: expect.stringContaining(row) }),
                }),
            ]);
            expect(asked).toEqual(["opener"]);
        },
    );

    it("never gains a welcome through a skill label when a bot opened the issue", async () => {
        const record = issue(
            { meaning: "awaitingTriage" },
            {
                author: "renovate[bot]",
                skills: ["beginner"],
                arrival: { kind: "label", change: "added", meaning: null, skill: "beginner" },
            },
        );
        const { platform, asked } = watch(record, { ok: true, value: true });

        expect(await triageQueue.evaluate(record, advisoryView, platform)).toEqual([]);
        expect(asked).toEqual(["renovate[bot]"]);
    });

    it("leaves a skill label alone off the gate, without a requirement, or on an unmapped label", async () => {
        const skilled = {
            skills: ["beginner"],
            arrival: { kind: "label", change: "added", meaning: null, skill: "beginner" },
        } as const;
        const cases = [
            [issue({ meaning: "awaitingTriage" }, skilled), silentView],
            [issue({ meaning: "ready" }, skilled), advisoryView],
            [conflicted(["awaitingTriage", "ready"], skilled), advisoryView],
            [
                issue(
                    { meaning: "awaitingTriage" },
                    { arrival: { kind: "label", change: "added", meaning: null, skill: null } },
                ),
                advisoryView,
            ],
        ] as const;

        for (const [record, view] of cases) {
            const { platform, asked } = watch(record);
            expect(await triageQueue.evaluate(record, view, platform)).toEqual([]);
            expect(asked).toEqual([]);
        }
    });

    it("refuses the skill requirement when the file maps no skill tier", () => {
        const result = parseConfig(
            {
                schemaVersion: 2,
                capabilities: { triageQueue: { enabled: true, requirements: { skill: true } } },
            },
            { revision: "rev-1", knownCapabilities: [triageQueueDeclaration] },
        );

        expect(result.ok).toBe(false);
        expect(result.ok ? [] : result.errors.map((error) => error.message)).toEqual([
            expect.stringContaining("needs at least one entry under mappings.skills"),
        ]);
    });

    /** Both requests in full: one occasion, but the announcement claims only openness. */
    it("asks for the label and the announcement, in that order, on their own claims", async () => {
        const occasion = { cause: "issueWithoutPosition", observedAt: OBSERVED_AT };
        const claim = { meaningsPresent: [], meaningsAbsent: ["awaitingTriage"], closed: false };
        const announceClaim = { meaningsPresent: [], meaningsAbsent: [], closed: false };
        const record = issue({});

        expect(await triageQueue.evaluate(record, announcingView, watch(record).platform)).toEqual([
            {
                capability: "triageQueue",
                repository: REPOSITORY,
                item: ITEM,
                operation: "applyMappedLabel",
                // The map's answer: `[*] → awaitingTriage` for `intakeObserved` (D78).
                desired: { meaning: "awaitingTriage", cause: "intakeObserved" },
                claims: claim,
                cause: occasion,
                explanation: {
                    capability: "triageQueue",
                    summary: "Placed the new issue in triage.",
                    detail: [],
                },
                grace: null,
                idempotencyKey: expect.any(String),
            },
            {
                capability: "triageQueue",
                repository: REPOSITORY,
                item: ITEM,
                operation: "postManagedComment",
                desired: {
                    kind: "notice",
                    topic: "welcome",
                    body: "👋 Hi @opener — thanks for opening this issue. It is in the triage queue; the team will triage it and follow up here.",
                },
                claims: announceClaim,
                cause: occasion,
                explanation: {
                    capability: "triageQueue",
                    summary: "Welcomed the author and said the issue awaits triage.",
                    detail: [],
                },
                grace: null,
                idempotencyKey: expect.any(String),
            },
        ]);
    });

    it("triages without a welcome when welcome is not configured", async () => {
        const record = issue({});
        const intents = await triageQueue.evaluate(
            record,
            projectCapabilityView(triageQueueDeclaration, silent),
            watch(record).platform,
        );
        expect(intents.map((intent) => intent.operation)).toEqual(["applyMappedLabel"]);
    });

    it("welcomes before locking a newly opened issue", async () => {
        const record = issue({});
        const intents = await triageQueue.evaluate(record, quarantineView, watch(record).platform);

        expect(intents.map((intent) => intent.operation)).toEqual([
            "applyMappedLabel",
            "postManagedComment",
            "lockIssue",
        ]);
        expect(intents[1]?.desired).toEqual({
            kind: "notice",
            topic: "welcome",
            body: "👋 Hi @opener — thanks for opening this issue. It is in the triage queue, and the conversation is locked until the team has triaged it. You do not need to do anything: the lock lifts when the issue is marked ready, and we will follow up here.",
        });
        expect(intents[2]?.desired).toEqual({
            reason: "the issue is waiting for triage",
        });
    });

    /** A lock without a word about why is the one outcome an author resents. */
    it("welcomes a locked issue even when welcome is off", async () => {
        const record = issue({});
        const intents = await triageQueue.evaluate(record, lockingView, watch(record).platform);

        expect(intents.map((intent) => intent.operation)).toEqual([
            "applyMappedLabel",
            "postManagedComment",
            "lockIssue",
        ]);
    });

    it("unlocks and confirms when a person marks the issue ready", async () => {
        const record = issue(
            { meaning: "ready" },
            {
                arrival: { kind: "label", change: "added", meaning: "ready", skill: null },
                locked: true,
            },
        );
        const intents = await triageQueue.evaluate(record, quarantineView, watch(record).platform);

        expect(intents.map((intent) => intent.operation)).toEqual([
            "unlockIssue",
            "postManagedComment",
        ]);
        expect(intents.map((intent) => intent.desired)).toEqual([
            { reason: "a person marked the issue ready" },
            {
                kind: "notice",
                topic: "unlock",
                body: "✅ Hi @opener — this issue has been triaged and marked ready. The conversation is open again.",
            },
        ]);
    });

    it("unlocks without confirming when confirmUnlock is off", async () => {
        const record = issue(
            { meaning: "ready" },
            {
                arrival: { kind: "label", change: "added", meaning: "ready", skill: null },
                locked: true,
            },
        );

        expect(
            (await triageQueue.evaluate(record, lockingView, watch(record).platform)).map(
                (intent) => intent.operation,
            ),
        ).toEqual(["unlockIssue"]);
    });

    /**
     * The usual way triage completes: `ready` goes on while the triage label
     * is still there. The map reports the conflict; the release stands.
     */
    it("unlocks a conflicted item — the release does not wait for the stale triage label", async () => {
        const record = conflicted(["awaitingTriage", "ready"], {
            arrival: { kind: "label", change: "added", meaning: "ready", skill: null },
            locked: true,
        });
        const { platform, handle } = watch(record);

        expect(
            (await triageQueue.evaluate(record, quarantineView, platform)).map(
                (intent) => intent.operation,
            ),
        ).toEqual(["unlockIssue", "postManagedComment"]);
        expect(handle.explanations).toEqual([]);
    });

    it("unlocks after the stale triage label is removed from a ready issue", async () => {
        const record = issue(
            { meaning: "ready" },
            {
                arrival: {
                    kind: "label",
                    change: "removed",
                    meaning: "awaitingTriage",
                    skill: null,
                },
                locked: true,
            },
        );

        expect(
            (await triageQueue.evaluate(record, quarantineView, watch(record).platform)).map(
                (intent) => intent.operation,
            ),
        ).toEqual(["unlockIssue", "postManagedComment"]);
    });

    it("confirms a ready label that arrived before triageQueue could lock", async () => {
        const record = issue(
            { meaning: "ready" },
            {
                arrival: { kind: "label", change: "added", meaning: "ready", skill: null },
                locked: false,
            },
        );

        const intents = await triageQueue.evaluate(record, quarantineView, watch(record).platform);

        expect(intents.map((intent) => intent.operation)).toEqual(["postManagedComment"]);
        // Nothing was locked, so the confirmation does not claim to have opened anything.
        expect(intents.map((intent) => intent.desired)).toEqual([
            {
                kind: "notice",
                topic: "unlock",
                body: "✅ Hi @opener — this issue has been triaged and marked ready.",
            },
        ]);
    });

    /** A lock the repository never asked for is a human's, and stays. */
    it("leaves a locked issue alone when lockUntilTriaged is off", async () => {
        const record = issue(
            { meaning: "ready" },
            {
                arrival: { kind: "label", change: "added", meaning: "ready", skill: null },
                locked: true,
            },
        );

        expect(await triageQueue.evaluate(record, announcingView, watch(record).platform)).toEqual(
            [],
        );
    });

    it("does not re-triage or re-lock a human label removal", async () => {
        const record = issue({}, { arrival: null, locked: false });

        expect(await triageQueue.evaluate(record, quarantineView, watch(record).platform)).toEqual(
            [],
        );
    });

    it("ignores a label that did not complete triage, without asking who sent it", async () => {
        const record = issue(
            { meaning: "ready" },
            {
                arrival: { kind: "label", change: "added", meaning: "blocked", skill: null },
                locked: true,
            },
        );
        const { platform, asked } = watch(record);

        expect(await triageQueue.evaluate(record, quarantineView, platform)).toEqual([]);
        expect(asked).toEqual([]);
    });

    it("ignores a label arrival nobody sent", async () => {
        const record = issue(
            { meaning: "ready" },
            {
                actor: null,
                arrival: { kind: "label", change: "added", meaning: "ready", skill: null },
                locked: true,
            },
        );

        expect(await triageQueue.evaluate(record, quarantineView, watch(record).platform)).toEqual(
            [],
        );
    });

    it("does not accept a ready label from an automation", async () => {
        const record = issue(
            { meaning: "ready" },
            {
                actor: { login: "triage-bot[bot]" },
                arrival: { kind: "label", change: "added", meaning: "ready", skill: null },
                locked: true,
            },
        );
        const { platform, asked } = watch(record, { ok: true, value: true });

        expect(await triageQueue.evaluate(record, quarantineView, platform)).toEqual([]);
        expect(asked).toEqual(["triage-bot[bot]"]);
    });
});
