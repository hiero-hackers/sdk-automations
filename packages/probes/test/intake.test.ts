/**
 * What intake decides at the entry gate. Two facts it may not assume: that
 * the repository has mapped `awaitingTriage` (contract.md §2), and that an
 * issue carrying no position is one it should still be placed in. Each
 * refusal is paired with the input that does produce a label intent.
 *
 * One module's own branches. `boundary.test.ts` holds the conformance claims
 * and `engine-matrix.test.ts` the composition of all three probes, where the
 * conflict reported here travels on into a dry-run report.
 */

import { describe, expect, it } from "vitest";
import {
    projectCapabilityView,
    type IssueMeaning,
    type ObservationCatalogue,
    type ObservationProjection,
    type PlatformHandle,
    type StructuredExplanation,
    type WorkItemState,
} from "@hiero-hackers/automation-core";
import { intake, type IntakeDeclaration } from "../src/index.js";
import { configEnabling } from "./world.js";

const AT = new Date("2026-08-03T09:00:00.000Z");
const REPO = { owner: "hiero-hackers", repo: "sandbox" } as const;
const ITEM = { kind: "issue", number: 11 } as const;

const announcing = configEnabling(["intake"], ["intake"], { intake: { announce: true } });
const silent = configEnabling(["intake"], ["intake"]);
/** The same repository, having mapped no meanings at all. */
const unmapped = { ...announcing, mappings: { labels: {} } };

const issue = (
    state: Partial<WorkItemState<IssueMeaning>>,
): ObservationCatalogue["issueUpdated"] => ({
    kind: "issueUpdated",
    repository: REPO,
    item: ITEM,
    position: {
        kind: "position",
        state: { meaning: null, blocked: false, closedBy: null, ...state },
        ignored: [],
    } satisfies ObservationProjection<IssueMeaning>,
    observedAt: AT,
});

/** The same issue, seen holding more than one position at once. */
const conflicted = (
    ...positions: readonly IssueMeaning[]
): ObservationCatalogue["issueUpdated"] => ({
    kind: "issueUpdated",
    repository: REPO,
    item: ITEM,
    position: {
        kind: "conflict",
        positions,
        blocked: false,
        closedBy: null,
        ignored: [],
    } satisfies ObservationProjection<IssueMeaning>,
    observedAt: AT,
});

/** Declaring no resolvers, intake can only be handed a handle that records. */
function watch(): {
    readonly platform: PlatformHandle<IntakeDeclaration>;
    readonly explained: StructuredExplanation[];
} {
    const explained: StructuredExplanation[] = [];
    return {
        platform: {
            resolve: async () => {
                throw new Error("intake declares no resolvers");
            },
            explain: (explanation) => {
                explained.push(explanation);
            },
        },
        explained,
    };
}

describe("intake", () => {
    it("names both positions of a conflicted item, and repairs neither (D35)", async () => {
        const { platform, explained } = watch();

        expect(
            await intake.evaluate(
                conflicted("ready", "inProgress"),
                projectCapabilityView(intake.declaration, announcing),
                platform,
            ),
        ).toEqual([]);
        expect(explained).toEqual([
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

    it("will not triage a repository that has not mapped awaitingTriage", async () => {
        const { platform, explained } = watch();
        const fresh = issue({});

        expect(
            await intake.evaluate(
                fresh,
                projectCapabilityView(intake.declaration, unmapped),
                platform,
            ),
        ).toEqual([]);
        expect(explained).toEqual([
            {
                capability: "intake",
                summary: "Skipped: this repository has not mapped awaitingTriage.",
                detail: ["intake cannot triage without a mapped triage meaning"],
            },
        ]);

        // The same issue in a repository that mapped it: the silence was the mapping.
        expect(
            await intake.evaluate(
                fresh,
                projectCapabilityView(intake.declaration, announcing),
                platform,
            ),
        ).toHaveLength(2);
    });

    it("leaves an issue that already holds a position, silently", async () => {
        const { platform, explained } = watch();
        expect(
            await intake.evaluate(
                issue({ meaning: "inProgress" }),
                projectCapabilityView(intake.declaration, announcing),
                platform,
            ),
        ).toEqual([]);
        expect(explained).toEqual([]);
    });

    it("leaves a closed issue alone", async () => {
        expect(
            await intake.evaluate(
                issue({ closedBy: "closedByHuman" }),
                projectCapabilityView(intake.declaration, announcing),
                watch().platform,
            ),
        ).toEqual([]);
    });

    /**
     * Both requests in full. The pair shares one occasion, but NOT one
     * claim: the label claims the meaning absent, while the announcement
     * claims only openness — its own sibling puts the label there first,
     * so an absence claim would refuse the announcement OF the label it
     * just applied at any apply-time re-gate (8.2 pre-flight, 2026-09-02).
     */
    it("asks for the label and the announcement, in that order, on their own claims", async () => {
        const occasion = { cause: "issueWithoutPosition", observedAt: AT };
        const claim = { meaningsPresent: [], meaningsAbsent: ["awaitingTriage"], closed: false };
        const announceClaim = { meaningsPresent: [], meaningsAbsent: [], closed: false };

        expect(
            await intake.evaluate(
                issue({}),
                projectCapabilityView(intake.declaration, announcing),
                watch().platform,
            ),
        ).toEqual([
            {
                capability: "intake",
                repository: REPO,
                item: ITEM,
                operation: "applyMappedLabel",
                desired: { meaning: "awaitingTriage", cause: "intakeObserved" },
                expected: claim,
                cause: occasion,
                explanation: {
                    capability: "intake",
                    summary: "New issue placed in triage.",
                    detail: ["the issue carried no mapped workflow meaning"],
                },
                idempotencyKey: expect.any(String),
            },
            {
                capability: "intake",
                repository: REPO,
                item: ITEM,
                operation: "postManagedComment",
                desired: {
                    kind: "notice",
                    body: "Thanks for opening this. It has been placed in the triage queue.",
                },
                expected: announceClaim,
                cause: occasion,
                explanation: {
                    capability: "intake",
                    summary: "Announced the triage placement.",
                    detail: ["announce is enabled for this repository"],
                },
                idempotencyKey: expect.any(String),
            },
        ]);
    });

    it("triages without announcing when announce is not configured", async () => {
        const intents = await intake.evaluate(
            issue({}),
            projectCapabilityView(intake.declaration, silent),
            watch().platform,
        );
        expect(intents.map((intent) => intent.operation)).toEqual(["applyMappedLabel"]);
    });
});
