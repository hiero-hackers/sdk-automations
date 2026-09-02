/**
 * `world.ts`'s derivation, tested before anything composes it (D92 phase 1):
 * if these two functions are wrong, the engine inherits a lie — the same lie
 * the old API let shells assert, now with one owner to fix.
 */

import { describe, expect, it } from "vitest";
import {
    deriveWorld,
    expectedHolds,
    observedMeaningsOf,
    projectIssueObservation,
    projectPrObservation,
} from "../../src/index.js";

const project = projectIssueObservation;

describe("observedMeaningsOf reassembles what projection split", () => {
    it("a bare item observes nothing", () => {
        expect(observedMeaningsOf(project({ closedBy: null, meanings: [] }))).toEqual([]);
    });

    it("position + blocked + cross-flow reassemble, in vocabulary order", () => {
        const projection = project({
            closedBy: null,
            meanings: ["needsReview", "blocked", "ready"],
        });
        expect(observedMeaningsOf(projection)).toEqual(["ready", "needsReview", "blocked"]);
    });

    it("a conflict's positions all survive the reassembly", () => {
        const projection = project({
            closedBy: null,
            meanings: ["awaitingTriage", "inProgress", "blocked"],
        });
        expect(projection.kind).toBe("conflict");
        expect(observedMeaningsOf(projection)).toEqual(["awaitingTriage", "inProgress", "blocked"]);
    });

    /**
     * A conflict that is NOT paused. Every conflict above carried `blocked`,
     * so a reassembly that simply asserted the pause on the conflict branch
     * looked identical — and it is not: `blocked` is what the safety
     * engine's `itemBlocked` rule reads, so an invented pause silences every
     * capability on an item nobody paused.
     */
    it("a conflicted item that nobody paused does not read as paused", () => {
        const projection = project({
            closedBy: null,
            meanings: ["awaitingTriage", "inProgress"],
        });
        expect(projection.kind).toBe("conflict");
        expect(observedMeaningsOf(projection)).toEqual(["awaitingTriage", "inProgress"]);
    });

    it("round-trips: any observed meaning set survives project → reassemble", () => {
        for (const meanings of [
            ["ready"],
            ["blocked"],
            ["ready", "needsRevision"],
            ["awaitingTriage", "ready", "readyToMerge", "blocked"],
        ] as const) {
            const projection = project({ closedBy: null, meanings: [...meanings] });
            expect(new Set(observedMeaningsOf(projection))).toEqual(new Set(meanings));
        }
    });
});

describe("expectedHolds — the claim against the world", () => {
    const at = (meanings: readonly ("ready" | "blocked" | "needsReview")[]) =>
        project({ closedBy: null, meanings: [...meanings] });

    it("a vacuous claim always holds", () => {
        expect(
            expectedHolds({ meaningsPresent: [], meaningsAbsent: [], closed: null }, at(["ready"])),
        ).toBe(true);
    });

    it("present must be present", () => {
        const expected = { meaningsPresent: ["ready"], meaningsAbsent: [], closed: null } as const;
        expect(expectedHolds(expected, at(["ready"]))).toBe(true);
        expect(expectedHolds(expected, at([]))).toBe(false);
    });

    it("absent must be absent — the intake case", () => {
        const expected = {
            meaningsPresent: [],
            meaningsAbsent: ["awaitingTriage"],
            closed: false,
        } as const;
        expect(expectedHolds(expected, project({ closedBy: null, meanings: [] }))).toBe(true);
        expect(
            expectedHolds(expected, project({ closedBy: null, meanings: ["awaitingTriage"] })),
        ).toBe(false);
    });

    it("the closed claim reads both projection branches (the closureOf trap)", () => {
        const wantsOpen = { meaningsPresent: [], meaningsAbsent: [], closed: false } as const;
        expect(expectedHolds(wantsOpen, project({ closedBy: "closedByHuman", meanings: [] }))).toBe(
            false,
        );
        // The conflict branch carries closure at the top level — a
        // position-only reading would call this open.
        const conflicted = project({
            closedBy: "closedByHuman",
            meanings: ["awaitingTriage", "ready"],
        });
        expect(conflicted.kind).toBe("conflict");
        expect(expectedHolds(wantsOpen, conflicted)).toBe(false);
        expect(
            expectedHolds({ meaningsPresent: [], meaningsAbsent: [], closed: true }, conflicted),
        ).toBe(true);
    });

    it("cross-flow noise neither satisfies nor violates an own-flow claim wrongly", () => {
        const projection = projectPrObservation({
            closedBy: null,
            meanings: ["needsReview", "awaitingTriage"],
        });
        expect(
            expectedHolds(
                { meaningsPresent: ["needsReview"], meaningsAbsent: [], closed: false },
                projection,
            ),
        ).toBe(true);
        // A claim about the OTHER flow's meaning still reads the truth:
        // awaitingTriage is observably there (in `ignored`), so claiming
        // its absence fails — the engine does not pretend noise away.
        expect(
            expectedHolds(
                { meaningsPresent: [], meaningsAbsent: ["awaitingTriage"], closed: false },
                projection,
            ),
        ).toBe(false);
    });
});

describe("deriveWorld authoritative preconditions", () => {
    const emptyClaims = { meaningsPresent: [], meaningsAbsent: [], closed: null } as const;

    it("refuses to establish or invent facts without a projection", () => {
        expect(deriveWorld(null, emptyClaims)).toMatchObject({
            observedMeanings: [],
            preconditionHolds: false,
        });
    });

    it("refuses to establish a precondition from a conflicted projection", () => {
        const conflicted = project({
            closedBy: null,
            meanings: ["awaitingTriage", "inProgress"],
        });
        expect(conflicted.kind).toBe("conflict");
        expect(deriveWorld(conflicted, emptyClaims).preconditionHolds).toBe(false);
    });

    it("carries the observation's own meanings, not an empty world", () => {
        // The other half of the derived world, and the half the rules
        // actually read: `itemBlocked` refuses on `observedMeanings`, so a
        // world that answered `[]` for every projection would quietly unpause
        // every paused item.
        const paused = project({ closedBy: null, meanings: ["ready", "blocked"] });
        expect(deriveWorld(paused, emptyClaims).observedMeanings).toEqual(["ready", "blocked"]);
    });

    /**
     * The fact the `itemClosed` rule reads. It is derived from the
     * observation, never from `claims.closed` — the claim defaults to `null`,
     * so a world that took closure from the capability would report every
     * silent capability's target as open.
     */
    it("carries the observed closure, from either projection branch", () => {
        expect(
            deriveWorld(project({ closedBy: "merged", meanings: [] }), emptyClaims).closure,
        ).toBe("merged");
        const conflicted = project({
            closedBy: "closedByHuman",
            meanings: ["awaitingTriage", "inProgress"],
        });
        expect(conflicted.kind).toBe("conflict");
        expect(deriveWorld(conflicted, emptyClaims).closure).toBe("closedByHuman");
        expect(
            deriveWorld(project({ closedBy: null, meanings: [] }), emptyClaims).closure,
        ).toBeNull();
    });

    it("invents no closure without a projection, and cannot be reached with one", () => {
        const world = deriveWorld(null, emptyClaims);
        expect(world.closure).toBeNull();
        // The pair is what makes `null` honest rather than a claim of
        // openness: no projection means the preflight refuses
        // `preconditionStale` before any rule reads `closure`.
        expect(world.preconditionHolds).toBe(false);
    });

    it("checks requested facts against a clean authoritative projection", () => {
        const clean = project({ closedBy: null, meanings: ["ready"] });
        expect(deriveWorld(clean, emptyClaims).preconditionHolds).toBe(true);
        expect(
            deriveWorld(clean, { meaningsPresent: [], meaningsAbsent: ["ready"], closed: null })
                .preconditionHolds,
        ).toBe(false);
    });
});
