/**
 * What prQuality decides, and what it refuses to decide when the platform
 * could not answer it: an undetermined resolver answer is never read as "no
 * linked issue". Every silence is paired with the input that does produce a
 * comment, so a probe that had simply stopped working would fail here.
 *
 * One module's own branches. `boundary.test.ts` holds the conformance claims
 * and `engine-matrix.test.ts` the composition of all three probes.
 */

import { describe, expect, it } from "vitest";
import {
    parseConfig,
    projectCapabilityView,
    type ObservationCatalogue,
    type ObservationProjection,
    type PlatformHandle,
    type PrMeaning,
    type StructuredExplanation,
    type WorkItemState,
} from "@hiero-hackers/automation-core";
import { prQuality, type PrQualityDeclaration } from "../src/index.js";
import { configEnabling } from "./world.js";

const AT = new Date("2026-08-03T09:00:00.000Z");
const REPO = { owner: "hiero-hackers", repo: "sandbox" } as const;
const ITEM = { kind: "pullRequest", number: 12 } as const;

const view = (settings: Readonly<Record<string, unknown>>) =>
    projectCapabilityView(
        prQuality.declaration,
        configEnabling(["prQuality"], ["prQuality"], { prQuality: settings }),
    );

const pullRequest = (
    state: Partial<WorkItemState<PrMeaning>>,
): ObservationCatalogue["pullRequestUpdated"] => ({
    kind: "pullRequestUpdated",
    repository: REPO,
    item: ITEM,
    position: {
        kind: "position",
        state: { meaning: null, blocked: false, closedBy: null, ...state },
        ignored: [],
    } satisfies ObservationProjection<PrMeaning>,
    observedAt: AT,
});

/** A handle carrying one resolver answer, and holding what the probe explained. */
function watch(resolve: PlatformHandle<PrQualityDeclaration>["resolve"]): {
    readonly platform: PlatformHandle<PrQualityDeclaration>;
    readonly explained: StructuredExplanation[];
} {
    const explained: StructuredExplanation[] = [];
    return {
        platform: {
            resolve,
            explain: (explanation) => {
                explained.push(explanation);
            },
        },
        explained,
    };
}

const noneFound = watch(async () => ({ ok: true, value: [] }));

describe("prQuality", () => {
    it("reads an unanswerable resolver as unknown, never as no linked issue", async () => {
        const failed = watch(async () => ({
            ok: false,
            reason: "rateLimited",
            detail: "secondary rate limit on this installation",
        }));
        const open = pullRequest({});

        expect(await prQuality.evaluate(open, view({}), failed.platform)).toEqual([]);
        // The reason is the report's whole account of the silence, so it is stated in full.
        expect(failed.explained).toEqual([
            {
                capability: "prQuality",
                summary: "Skipped: the linked-issue resolver could not answer.",
                detail: [
                    "resolver reason: rateLimited",
                    "secondary rate limit on this installation",
                ],
            },
        ]);

        // The same pull request, answered: the silence above was the failure.
        expect(await prQuality.evaluate(open, view({}), noneFound.platform)).toHaveLength(1);
        expect(noneFound.explained).toEqual([]);
    });

    it("says nothing about a pull request that already links an issue", async () => {
        const linked = watch(async () => ({ ok: true, value: [{ kind: "issue", number: 11 }] }));
        expect(await prQuality.evaluate(pullRequest({}), view({}), linked.platform)).toEqual([]);
    });

    it("says nothing about a merged pull request, and never asks", async () => {
        const unreachable = watch(async () => {
            throw new Error("closure is read before the resolver");
        });
        expect(
            await prQuality.evaluate(
                pullRequest({ closedBy: "merged" }),
                view({}),
                unreachable.platform,
            ),
        ).toEqual([]);
    });

    it("asks the linkedIssues resolver, once, about the pull request it was given", async () => {
        const asked: { query: string; input: unknown }[] = [];
        const recording = watch(async (query, input) => {
            asked.push({ query, input });
            return { ok: true, value: [] };
        });

        await prQuality.evaluate(pullRequest({}), view({}), recording.platform);

        expect(asked).toEqual([{ query: "linkedIssues", input: { item: ITEM } }]);
    });

    /**
     * The whole request, pinned: everything an adapter would act on, plus the
     * claim the engine checks before it may. `expected.closed` is the one
     * field that must be `false` rather than absent — an omitted claim is
     * vacuous, and this comment must not land on a closed pull request.
     */
    it("asks for one managed comment on the observed pull request, claiming it is open", async () => {
        expect(await prQuality.evaluate(pullRequest({}), view({}), noneFound.platform)).toEqual([
            {
                capability: "prQuality",
                repository: REPO,
                item: ITEM,
                operation: "postManagedComment",
                desired: {
                    kind: "summary",
                    body: "This pull request does not reference an issue. Adding a closing reference keeps the issue and the pull request in step.",
                },
                expected: { meaningsPresent: [], meaningsAbsent: [], closed: false },
                cause: { cause: "pullRequestWithoutLinkedIssue", observedAt: AT },
                explanation: {
                    capability: "prQuality",
                    summary: "No linked issue found on this pull request.",
                    detail: ["checked via the linkedIssues resolver"],
                },
                idempotencyKey: expect.any(String),
            },
        ]);
    });

    /**
     * D125 removed the marker from the configuration surface, and the D84
     * machinery is what makes that removal load-bearing rather than polite: a
     * file still setting one is refused before the shell ever constructs the
     * capability. The `enabled: false` block is deliberate — an unknown key is
     * a document defect, so it is refused whether or not anyone runs it.
     */
    it("refuses a configuration that still supplies a marker", () => {
        const result = parseConfig(
            {
                schemaVersion: 1,
                capabilities: { prQuality: { enabled: false, settings: { marker: "<!-- x -->" } } },
            },
            {
                revision: "rev-marker",
                knownCapabilities: [
                    {
                        name: prQuality.declaration.name,
                        configKeys: prQuality.declaration.configKeys,
                        requiredMeanings: prQuality.declaration.requiredMeanings,
                    },
                ],
            },
        );
        expect(result.ok ? [] : result.errors.map((e) => `${e.code} @ ${e.path}`)).toEqual([
            "unknownKey @ capabilities.prQuality.settings.marker",
        ]);
    });

    /** The negative control: the declaration admits nothing at all now. */
    it("declares no settings keys for a repository to supply", () => {
        expect(prQuality.declaration.configKeys).toEqual([]);
    });
});
