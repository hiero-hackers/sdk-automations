/**
 * The guard kit's one helper — `design/guides/capability-kits.md` §2.
 *
 * Three claims, each tested as a claim rather than as a shape: a skip reaches
 * the operator surface exactly once, it goes under the capability's own name
 * with the detail it was handed, and it hands its caller an empty list to
 * return. The other two stops need no helper and so have no test here — a
 * silent stop is `return []` and a refusal is an ordinary intent.
 *
 * The handle here is a fixture, not a capability. `packages/capabilities`
 * tests what each capability's own guards decide.
 */

import { describe, expect, it } from "vitest";
import {
    declareCapability,
    spec,
    skipped,
    type PlatformHandle,
    type StructuredExplanation,
} from "../../src/index.js";

const fixture = declareCapability({
    name: "fixture",
    triggers: [{ kind: "event", event: "issues" }],
    settings: spec({}),
    requiredMappings: {},
    facts: ["issue"],
    needs: [],
    resolvers: [],
    intents: ["applyMappedLabel", "postManagedComment"],
});

/** A handle that records what it was told, and refuses to be resolved through. */
function watch(): {
    readonly platform: PlatformHandle<typeof fixture>;
    readonly explained: StructuredExplanation[];
} {
    const explained: StructuredExplanation[] = [];
    return {
        platform: {
            resolve: async () => {
                throw new Error("the fixture declares no resolvers");
            },
            ask: async () => {
                throw new Error("the fixture declares no resolvers");
            },
            intent: () => {
                throw new Error("the fixture builds no intents");
            },
            skip: () => [],
            explain: (explanation) => {
                explained.push(explanation);
            },
            exempt: () => {
                throw new Error("the guards exempt nothing");
            },
        },
        explained,
    };
}

describe("skipped", () => {
    it("explains once, under the capability's name, with however much detail it was given", () => {
        const { platform, explained } = watch();

        skipped(
            platform,
            "inactivity",
            "Skipped: the resolver could not answer.",
            "reason: rateLimited",
            "the cautious reading is the only safe one (D51)",
        );

        expect(explained).toEqual([
            {
                capability: "inactivity",
                summary: "Skipped: the resolver could not answer.",
                detail: ["reason: rateLimited", "the cautious reading is the only safe one (D51)"],
            },
        ]);
    });

    /**
     * The mutant this kills is the one that drops the detail: a summary with
     * no supporting facts is an operator note nobody can act on, and the empty
     * list is what a skip with nothing to add must still carry.
     */
    it("explains with an empty detail list when it was given none", () => {
        const { platform, explained } = watch();

        skipped(platform, "triageQueue", "Skipped: nothing to do.");

        expect(explained).toEqual([
            { capability: "triageQueue", summary: "Skipped: nothing to do.", detail: [] },
        ]);
    });

    /**
     * `return skipped(…)` is the whole idiom, so the empty list is the claim:
     * a skip that returned anything else would have a capability writing on
     * the way out of a stop.
     */
    it("returns an empty list for its caller to return", () => {
        const { platform } = watch();

        expect(skipped(platform, fixture.name, "Skipped: nothing to do.")).toEqual([]);
    });
});
