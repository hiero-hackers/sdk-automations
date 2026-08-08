/**
 * The planner after D92 3(c): translation and batch integrity only. The
 * screens, the safety engine, and the destructive gate that used to run
 * here are core's — `decide()` owns them, and core's engine suite tests
 * them. What this file pins is everything that remains genuinely the
 * planner's: adapter-command shapes, plan identity, and the three refusals
 * only the translation layer can see.
 */

import { describe, expect, it } from "vitest";
import { planApproved, plannerFindings, PLANNER_REFUSAL_CODES } from "../src/index.js";
import {
    intentFactory,
    parseConfig,
    type AnyIntent,
    type RepositoryConfig,
} from "@hiero-hackers/automation-core";

const REPO = { owner: "hiero-hackers", repo: "sandbox" } as const;
const AT = new Date("2026-08-07T03:00:00Z");

function configWith(labels: Record<string, string>): RepositoryConfig {
    const result = parseConfig(
        {
            schemaVersion: 1,
            mode: "active",
            capabilities: { intake: { enabled: true } },
            mappings: { labels },
        },
        { revision: "rev-plan-1", knownCapabilities: ["intake"] },
    );
    if (!result.ok) throw new Error("config must parse");
    return result.config;
}
const config = configWith({ awaitingTriage: "status: triage", ready: "status: ready" });

const make = intentFactory("intake", {
    repository: REPO,
    item: { kind: "issue", number: 11 },
    observedAt: AT,
});

const labelIntent = (): AnyIntent =>
    make({
        operation: "applyMappedLabel",
        actionClass: "reversibleStateChange",
        desired: { meaning: "awaitingTriage", cause: "intakeObserved" },
        cause: "issueWithoutPosition",
        explain: { summary: "triage" },
    });
const commentIntent = (): AnyIntent =>
    make({
        operation: "postManagedComment",
        actionClass: "humanFacingOutput",
        desired: { marker: "<!-- m -->", body: "hello" },
        cause: "issueWithoutPosition",
        explain: { summary: "announce" },
    });
const unassignIntent = (): AnyIntent =>
    make({
        operation: "unassign",
        actionClass: "reversibleStateChange",
        desired: { login: "contributor" },
        cause: "reclaim",
        explain: { summary: "reclaim" },
    });

const inputs = { repository: REPO, config };

describe("translation shapes — safety.md §2.6's exact item and value", () => {
    it("a label intent translates meaning AND configured label, read back by label", () => {
        const { plans, refusals } = planApproved([labelIntent()], inputs);
        expect(refusals).toEqual([]);
        expect(plans).toHaveLength(1);
        const call = plans[0]!.calls[0]!;
        expect(call).toMatchObject({
            seq: 1,
            idempotencyClass: "idempotent",
            command: {
                operation: "applyMappedLabel",
                desired: { meaning: "awaitingTriage", label: "status: triage" },
                readBack: { kind: "mappedLabel" },
                configurationRevision: "rev-plan-1",
            },
        });
        // The adapter gets the full configured vocabulary for its swap logic.
        expect(call.command.configuredLabels).toEqual([
            { meaning: "awaitingTriage", label: "status: triage" },
            { meaning: "ready", label: "status: ready" },
        ]);
    });

    it("a comment intent is non-idempotent and reads back by marker", () => {
        const { plans } = planApproved([commentIntent()], inputs);
        expect(plans[0]!.calls[0]).toMatchObject({
            idempotencyClass: "nonIdempotent",
            command: {
                operation: "postManagedComment",
                desired: { marker: "<!-- m -->", body: "hello" },
                readBack: { kind: "managedCommentMarker" },
            },
        });
    });

    it("an unassign reads back by assignee absence", () => {
        const { plans } = planApproved([unassignIntent()], inputs);
        expect(plans[0]!.calls[0]).toMatchObject({
            idempotencyClass: "idempotent",
            command: {
                operation: "unassign",
                desired: { login: "contributor" },
                readBack: { kind: "assigneeAbsent" },
            },
        });
    });

    it("the intent's expected facts ride into the command for the act-time recheck", () => {
        const claiming = make({
            operation: "applyMappedLabel",
            actionClass: "reversibleStateChange",
            desired: { meaning: "awaitingTriage", cause: "intakeObserved" },
            cause: "c",
            expected: { meaningsAbsent: ["awaitingTriage"], closed: false },
            explain: { summary: "s" },
        });
        const { plans } = planApproved([claiming], inputs);
        expect(plans[0]!.calls[0]!.command.expected).toEqual({
            meaningsPresent: [],
            meaningsAbsent: ["awaitingTriage"],
            closed: false,
        });
    });
});

describe("plan identity", () => {
    it("one intent, one plan; the effect id IS the idempotency key", () => {
        const a = labelIntent();
        const b = commentIntent();
        const { plans } = planApproved([a, b], inputs);
        expect(plans.map((p) => p.effectId)).toEqual([a.idempotencyKey, b.idempotencyKey]);
        expect(plans.every((p) => p.revision === "rev-plan-1")).toBe(true);
    });
});

describe("the three refusals only this layer can see", () => {
    it("a duplicate idempotency key refuses the second intent, not the first", () => {
        const original = labelIntent();
        const duplicate = { ...commentIntent(), idempotencyKey: original.idempotencyKey };
        const { plans, refusals } = planApproved([original, duplicate], inputs);
        expect(plans).toHaveLength(1);
        expect(refusals).toEqual([expect.objectContaining({ code: "duplicateIdempotencyKey" })]);
    });

    it("an unmapped meaning has no command, so no plan", () => {
        const bare = { repository: REPO, config: configWith({}) };
        const { plans, refusals } = planApproved([labelIntent()], bare);
        expect(plans).toEqual([]);
        expect(refusals).toEqual([expect.objectContaining({ code: "mappedLabelMissing" })]);
    });

    it("a mixed-repository batch plans nothing at all", () => {
        const stray = {
            ...labelIntent(),
            repository: { owner: "elsewhere", repo: "other" },
        };
        const { plans, refusals } = planApproved([labelIntent(), stray], inputs);
        expect(plans).toEqual([]);
        expect(refusals).toHaveLength(2);
        expect(refusals.every((r) => r.code === "mixedRepositoryBatch")).toBe(true);
    });
});

describe("planner refusals as findings", () => {
    it("every code is a problem — nothing here is the system working", () => {
        const original = labelIntent();
        const duplicate = { ...commentIntent(), idempotencyKey: original.idempotencyKey };
        const { refusals } = planApproved([original, duplicate], inputs);
        const findings = plannerFindings(refusals);
        expect(findings).toHaveLength(1);
        expect(findings[0]).toMatchObject({
            severity: "problem",
            code: "duplicateIdempotencyKey",
            subject: { kind: "effect", capability: "intake" },
        });
    });

    it("a mixed batch is a repository-level problem", () => {
        const stray = {
            ...labelIntent(),
            repository: { owner: "elsewhere", repo: "other" },
        };
        const { refusals } = planApproved([stray], inputs);
        const findings = plannerFindings(refusals);
        expect(findings[0]).toMatchObject({
            severity: "problem",
            subject: { kind: "repository" },
        });
    });

    it("the code list is closed and covered", () => {
        expect([...PLANNER_REFUSAL_CODES].sort()).toEqual([
            "duplicateIdempotencyKey",
            "mappedLabelMissing",
            "mixedRepositoryBatch",
        ]);
    });
});
