/**
 * What intake decides at the entry gate. Each refusal is paired with the
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
import { intake, intakeDeclaration } from "./capability.js";
import {
    configEnabling,
    factsFor,
    OBSERVED_AT,
    REPOSITORY,
    webhookIssue,
} from "@hiero-hackers/automation-core/author/testing";

const ITEM = { kind: "issue", number: 11 } as const;

const announcing = configEnabling(["intake"], [intakeDeclaration], { intake: { announce: true } });
const silent = configEnabling(["intake"], [intakeDeclaration]);
const announcingView = projectCapabilityView(intakeDeclaration, announcing);
const quarantining = configEnabling(["intake"], [intakeDeclaration], {
    intake: { announce: true, unlockWhen: ["ready"], confirmUnlock: true },
});
const quarantineView = projectCapabilityView(intakeDeclaration, quarantining);

const issue = (
    state: Partial<WorkItemState<IssueMeaning>>,
    over: Parameters<typeof webhookIssue>[0] = {},
) =>
    factsFor(
        intakeDeclaration,
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
const conflicted = (...positions: readonly IssueMeaning[]) =>
    factsFor(
        intakeDeclaration,
        webhookIssue({
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
 * The engine's own handle over one record, answering intake's one resolver.
 * The default answer is "a person"; `asked` is the login each question named.
 */
function watch(record: Facts, actor: ResolverAnswer<boolean> = { ok: true, value: false }) {
    const asked: string[] = [];
    const source: ResolverSource = async (_query, input) => {
        asked.push((input as { readonly login: string }).login);
        return await Promise.resolve(actor as never);
    };
    const handle = handleFor(intakeDeclaration, record, source);
    return { platform: handle, handle, asked };
}

describe("intake", () => {
    it("Issue opened by a bot", async () => {
        const record = factsFor(intakeDeclaration, webhookIssue({ author: "renovate[bot]" }));
        const { platform, handle, asked } = watch(record, { ok: true, value: true });

        expect(await intake.evaluate(record, announcingView, platform)).toEqual([]);
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
        await expect(intake.evaluate(record, announcingView, platform)).rejects.toBeDefined();
        expect(handle.skipped).toBe(true);
        expect(handle.explanations).toEqual([
            {
                capability: "intake",
                summary: "Skipped: the isAutomationActor resolver could not answer.",
                detail: ["resolver reason: rateLimited", "secondary rate limit"],
            },
        ]);
    });

    it("names both positions of a conflicted item, and repairs neither (D35)", async () => {
        const record = conflicted("ready", "inProgress");
        const { platform, handle } = watch(record);

        expect(await intake.evaluate(record, announcingView, platform)).toEqual([]);
        expect(handle.explanations).toEqual([
            {
                capability: "intake",
                summary: "Skipped: the item holds more than one workflow position.",
                detail: [
                    "conflicting: ready, inProgress",
                    "a conflict is reported, never repaired (D35)",
                ],
            },
        ]);
    });

    /** D84: the meaning intake requires is the parser's business, never a delivery's. */
    /** D203: a file that never maps `awaitingTriage` triages on the default spelling. */
    it("triages a repository that never mapped awaitingTriage, on its default spelling", () => {
        const file = (labels: Readonly<Record<string, string>>) =>
            parseConfig(
                {
                    schemaVersion: 2,
                    capabilities: { intake: { enabled: true, announce: true } },
                    mappings: { labels },
                },
                { revision: "rev-1", knownCapabilities: [intakeDeclaration] },
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

    it("leaves an issue that already holds a position, silently", async () => {
        const record = issue({ meaning: "inProgress" });
        const { platform, handle } = watch(record);

        expect(await intake.evaluate(record, announcingView, platform)).toEqual([]);
        expect(handle.explanations).toEqual([]);
    });

    /** Both requests in full: one occasion, but the announcement claims only openness. */
    it("asks for the label and the announcement, in that order, on their own claims", async () => {
        const occasion = { cause: "issueWithoutPosition", observedAt: OBSERVED_AT };
        const claim = { meaningsPresent: [], meaningsAbsent: ["awaitingTriage"], closed: false };
        const announceClaim = { meaningsPresent: [], meaningsAbsent: [], closed: false };
        const record = issue({});

        expect(await intake.evaluate(record, announcingView, watch(record).platform)).toEqual([
            {
                capability: "intake",
                repository: REPOSITORY,
                item: ITEM,
                operation: "applyMappedLabel",
                // The map's answer: `[*] → awaitingTriage` for `intakeObserved` (D78).
                desired: { meaning: "awaitingTriage", cause: "intakeObserved" },
                claims: claim,
                cause: occasion,
                explanation: {
                    capability: "intake",
                    summary: "Placed the new issue in triage.",
                    detail: [],
                },
                grace: null,
                idempotencyKey: expect.any(String),
            },
            {
                capability: "intake",
                repository: REPOSITORY,
                item: ITEM,
                operation: "postManagedComment",
                desired: {
                    kind: "notice",
                    topic: "welcome",
                    body: "Thanks for opening this. It has been placed in the triage queue.",
                },
                claims: announceClaim,
                cause: occasion,
                explanation: {
                    capability: "intake",
                    summary: "Announced the triage placement.",
                    detail: [],
                },
                grace: null,
                idempotencyKey: expect.any(String),
            },
        ]);
    });

    it("triages without announcing when announce is not configured", async () => {
        const record = issue({});
        const intents = await intake.evaluate(
            record,
            projectCapabilityView(intakeDeclaration, silent),
            watch(record).platform,
        );
        expect(intents.map((intent) => intent.operation)).toEqual(["applyMappedLabel"]);
    });

    it("welcomes before locking a newly opened issue", async () => {
        const record = issue({});
        const intents = await intake.evaluate(record, quarantineView, watch(record).platform);

        expect(intents.map((intent) => intent.operation)).toEqual([
            "applyMappedLabel",
            "postManagedComment",
            "lockIssue",
        ]);
        expect(intents[1]?.desired).toEqual({
            kind: "notice",
            topic: "welcome",
            body: "Thanks for opening this. It has been placed in the triage queue and locked until a maintainer reviews it.",
        });
        expect(intents[2]?.desired).toEqual({
            reason: "the issue is waiting for maintainer review",
        });
    });

    it("unlocks and confirms the approval meaning that arrived", async () => {
        const record = issue(
            { meaning: "ready" },
            {
                arrival: { kind: "label", meaning: "ready" },
                locked: true,
            },
        );
        const intents = await intake.evaluate(record, quarantineView, watch(record).platform);

        expect(intents.map((intent) => intent.operation)).toEqual([
            "unlockIssue",
            "postManagedComment",
        ]);
        expect(intents.map((intent) => intent.desired)).toEqual([
            { reason: "a maintainer approved the issue" },
            {
                kind: "notice",
                topic: "approval",
                body: "This issue was approved and is now open for discussion.",
            },
        ]);
    });

    it("confirms an approval that arrived before intake could lock", async () => {
        const record = issue(
            { meaning: "ready" },
            {
                arrival: { kind: "label", meaning: "ready" },
                locked: false,
            },
        );

        expect(
            (await intake.evaluate(record, quarantineView, watch(record).platform)).map(
                (intent) => intent.operation,
            ),
        ).toEqual(["postManagedComment"]);
    });

    it("does not re-triage or re-lock a human label removal", async () => {
        const record = issue(
            {},
            {
                arrival: null,
                locked: false,
            },
        );

        expect(await intake.evaluate(record, quarantineView, watch(record).platform)).toEqual([]);
    });

    it("ignores a labeled event that did not add an approval meaning", async () => {
        const record = issue(
            { meaning: "ready" },
            {
                arrival: { kind: "label", meaning: "blocked" },
                locked: true,
            },
        );

        expect(await intake.evaluate(record, quarantineView, watch(record).platform)).toEqual([]);
    });

    it("does not accept an approval label from an automation", async () => {
        const record = issue(
            { meaning: "ready" },
            {
                actor: { login: "triage-bot[bot]" },
                arrival: { kind: "label", meaning: "ready" },
                locked: true,
            },
        );
        const { platform, asked } = watch(record, { ok: true, value: true });

        expect(await intake.evaluate(record, quarantineView, platform)).toEqual([]);
        expect(asked).toEqual(["triage-bot[bot]"]);
    });
});
