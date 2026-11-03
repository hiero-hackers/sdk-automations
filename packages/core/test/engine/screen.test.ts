/**
 * The screens the engine runs on everything `evaluate` returns: attribution,
 * the derived key, the grace terms, and the workflow map (D175).
 */

import { describe, expect, it } from "vitest";
import {
    CLOSURE_CAUSES,
    declareCapability,
    deriveIdempotencyKey,
    flag,
    intentFactoryFor,
    ISSUE_CAUSES,
    PR_CAUSES,
    spec,
    type AnyIntent,
} from "../../src/index.js";
import { screenIntent } from "../../src/engine/invoke.js";

const FIXTURE = {
    name: "fixture",
    triggers: [{ kind: "event", event: "issues" }],
    settings: spec({ announce: flag({ default: false }) }),
    requiredMappings: {},
    facts: ["issue"],
    needs: [],
    resolvers: ["linkedIssues"],
    intents: ["applyMappedLabel", "unassign"],
} as const;

/** Owns every automatic edge, so the screens below reach the transition map. */
const declaration = declareCapability({
    ...FIXTURE,
    moves: [...ISSUE_CAUSES, ...PR_CAUSES].filter(
        (cause) => !CLOSURE_CAUSES.some((closing) => closing === cause),
    ),
});

const AT = new Date("2026-08-05T09:00:00.000Z");

/**
 * A well-formed intent, overridable field by field. The key is DERIVED from
 * whatever the overrides produced, so every screen below is exercised against
 * an intent the platform would accept — a literal key would refuse them all
 * at `idempotencyKeyMismatch` instead. Pass `idempotencyKey` to test that
 * screen itself.
 */
const intent = (over: Record<string, unknown> = {}): AnyIntent => {
    const base = {
        capability: "fixture",
        repository: { owner: "o", repo: "r" },
        item: { kind: "issue", number: 1 },
        operation: "applyMappedLabel",
        claims: { meaningsPresent: [], meaningsAbsent: [], closed: false },
        desired: { meaning: "awaitingTriage", cause: "intakeObserved" },
        cause: { cause: "someCause", observedAt: AT },
        explanation: { capability: "fixture", summary: "s", detail: [] },
        grace: null,
        ...over,
    } as unknown as Omit<AnyIntent, "idempotencyKey"> & { readonly idempotencyKey?: string };
    return {
        ...base,
        idempotencyKey: base.idempotencyKey ?? deriveIdempotencyKey(base),
    } as AnyIntent;
};

describe("screenIntent", () => {
    const position = (meaning: "ready" | "needsReview" | null = null) => ({
        kind: "position" as const,
        state: { meaning, blocked: false, closedBy: null },
        ignored: [],
    });
    const conflict = {
        kind: "conflict" as const,
        positions: ["ready", "inProgress"] as const,
        blocked: false,
        closedBy: null,
        ignored: [],
    };

    it("accepts a well-formed intent against an authoritative position", () => {
        expect(screenIntent(intent(), declaration, position())).toEqual({ ok: true });
    });

    it("refuses foreign, undeclared, and undated intents with distinct reasons", () => {
        const candidates = [
            screenIntent(intent({ capability: "other" }), declaration, position()),
            screenIntent(
                intent({
                    operation: "postManagedComment",
                    desired: { kind: "summary", body: "b" },
                }),
                declaration,
                position(),
            ),
            // An explicit key, because deriving one from this cause is what
            // the screen order exists to avoid: `toISOString()` throws on an
            // invalid date, so `invalidCause` must answer first.
            screenIntent(
                intent({
                    cause: { cause: "c", observedAt: new Date(Number.NaN) },
                    idempotencyKey: "k",
                }),
                declaration,
                position(),
            ),
        ];
        expect(candidates.map((candidate) => (candidate.ok ? null : candidate.code))).toEqual([
            "foreignCapability",
            "undeclaredIntent",
            "invalidCause",
        ]);
        for (const candidate of candidates) {
            expect(candidate.ok).toBe(false);
            if (!candidate.ok) expect(candidate.reason.length).toBeGreaterThan(0);
        }
    });

    /** `labels` bounds what a capability may set, so a position has only its declared writers. */
    it("refuses a position the capability did not declare", () => {
        const readyOnly = declareCapability({ ...FIXTURE, moves: ["triageCompleted"] });
        expect(screenIntent(intent(), readyOnly, position())).toMatchObject({
            ok: false,
            code: "undeclaredMeaning",
            reason: expect.stringContaining('"awaitingTriage"'),
        });
    });

    /** Ownership is per edge: a position's writer along one cause does not own its other edges (D243). */
    it("refuses an edge into a declared position that the capability does not own", () => {
        const triage = declareCapability({ ...FIXTURE, moves: ["triageCompleted"] });
        const reclaim = intent({ desired: { meaning: "ready", cause: "reclaimCompleted" } });
        expect(screenIntent(reclaim, triage, position())).toMatchObject({
            ok: false,
            code: "undeclaredCause",
            reason: expect.stringContaining('"reclaimCompleted"'),
        });
    });

    /**
     * The key is the store's `effect_id` (D65), so the boundary re-derives it:
     * a capability free to name its own key could merge two effects into one,
     * or split a redelivery into two comments.
     */
    it("refuses an intent whose idempotency key is not the derived one", () => {
        const screen = screenIntent(intent({ idempotencyKey: "k" }), declaration, position());
        expect(screen).toMatchObject({ ok: false, code: "idempotencyKeyMismatch" });
        if (!screen.ok) expect(screen.reason.length).toBeGreaterThan(0);
    });

    /** A key derived from a DIFFERENT occasion is as wrong as an invented one. */
    it("refuses a key derived from another occasion", () => {
        const elsewhere = deriveIdempotencyKey({
            capability: "fixture",
            repository: { owner: "o", repo: "r" },
            item: { kind: "issue", number: 2 },
            operation: "applyMappedLabel",
            cause: { cause: "someCause", observedAt: AT },
        });
        expect(
            screenIntent(intent({ idempotencyKey: elsewhere }), declaration, position()),
        ).toMatchObject({ ok: false, code: "idempotencyKeyMismatch" });
    });

    it("passes an intent the factory built, key and all", () => {
        const built = intentFactoryFor(declaration, {
            repository: { owner: "o", repo: "r" },
            item: { kind: "issue", number: 1 },
            observedAt: AT,
        })({
            operation: "applyMappedLabel",
            desired: { meaning: "awaitingTriage", cause: "intakeObserved" },
            cause: "someCause",
            claims: { closed: false },
            explain: { summary: "s" },
        });
        expect(screenIntent(built, declaration, position())).toEqual({ ok: true });
    });

    it("refuses a mapped-label intent when authoritative position is unavailable", () => {
        expect(screenIntent(intent(), declaration, null)).toEqual({
            ok: false,
            code: "authoritativePositionUnavailable",
            reason: "the authoritative current position is unavailable",
        });
    });

    it("uses an observed conflict even when the capability claims a clean state", () => {
        const screen = screenIntent(
            intent({
                claims: {
                    meaningsPresent: [],
                    meaningsAbsent: ["ready", "inProgress"],
                    closed: false,
                },
            }),
            declaration,
            conflict,
        );
        expect(screen).toMatchObject({ ok: false, code: "positionConflict" });
        // The refusal names WHICH positions collided: "the item is
        // confused" is not something a maintainer can act on, and the
        // conjunction is what makes two of them read as two.
        if (!screen.ok) expect(screen.reason).toContain("ready and inProgress");
    });

    it("does not let a claimed current position replace the observed position", () => {
        expect(
            screenIntent(
                intent({
                    claims: { meaningsPresent: ["ready"], meaningsAbsent: [], closed: false },
                }),
                declaration,
                position(),
            ),
        ).toEqual({ ok: true });
        expect(
            screenIntent(
                intent({
                    claims: { meaningsPresent: [], meaningsAbsent: ["ready"], closed: false },
                    desired: { meaning: "inProgress", cause: "contributorAssigned" },
                }),
                declaration,
                position("ready"),
            ),
        ).toEqual({ ok: true });
    });

    it("leaves non-transition operations to the safety gate", () => {
        expect(
            screenIntent(
                intent({ operation: "unassign", desired: { login: "someone" } }),
                declaration,
                position(),
            ),
        ).toEqual({ ok: true });
    });
});

/** The claim vocabulary: a mode the compiler admits passes the screen; the ladder judges it (D209). */
describe("the pull-request mode claim", () => {
    const position = {
        kind: "position" as const,
        state: { meaning: null, blocked: false, closedBy: null },
        ignored: [],
    };
    const claiming = (mode: unknown) =>
        intent({
            claims: {
                meaningsPresent: [],
                meaningsAbsent: [],
                closed: false,
                pullRequestMode: mode,
            },
        });

    it("accepts either native mode", () => {
        expect(screenIntent(claiming("draft"), declaration, position)).toEqual({ ok: true });
        expect(screenIntent(claiming("changesRequested"), declaration, position)).toEqual({
            ok: true,
        });
    });
});

describe("authoritative transition-map screening", () => {
    const issuePosition = (meaning: "ready" | null = null) => ({
        kind: "position" as const,
        state: { meaning, blocked: false, closedBy: null },
        ignored: [],
    });
    const pullRequestPosition = (meaning: "needsReview" | null = null) => ({
        kind: "position" as const,
        state: { meaning, blocked: false, closedBy: null },
        ignored: [],
    });

    it("refuses wrong-flow desired and observed positions", () => {
        const wrongDesired = screenIntent(
            intent({ desired: { meaning: "readyToMerge", cause: "intakeObserved" } }),
            declaration,
            issuePosition(),
        );
        expect(wrongDesired).toMatchObject({ ok: false, code: "meaningWrongEntity" });
        if (!wrongDesired.ok) expect(wrongDesired.reason).toContain("issue position");

        const wrongObserved = screenIntent(
            intent({ desired: { meaning: "awaitingTriage", cause: "intakeObserved" } }),
            declaration,
            pullRequestPosition("needsReview"),
        );
        expect(wrongObserved).toMatchObject({ ok: false, code: "meaningWrongEntity" });
        if (!wrongObserved.ok) expect(wrongObserved.reason).toContain("issue position");
    });

    /**
     * The same two refusals from the pull-request side. The screen has two
     * entity branches and every wrong-flow test above entered the issue one,
     * so the pull-request guards — and the half of the sentence that says
     * "a pull request" — had never run at all.
     */
    it("refuses wrong-flow desired and observed positions on a pull request too", () => {
        const wrongDesired = screenIntent(
            intent({
                item: { kind: "pullRequest", number: 9 },
                desired: { meaning: "ready", cause: "checksPassed" },
            }),
            declaration,
            pullRequestPosition(),
        );
        expect(wrongDesired).toMatchObject({ ok: false, code: "meaningWrongEntity" });
        if (!wrongDesired.ok) {
            expect(wrongDesired.reason).toContain("not a pull request position");
            expect(wrongDesired.reason).toContain("ready");
        }

        const wrongObserved = screenIntent(
            intent({
                item: { kind: "pullRequest", number: 9 },
                desired: { meaning: "needsReview", cause: "checksPassed" },
            }),
            declaration,
            {
                kind: "position" as const,
                // A human's issue label on a pull request: observable, and
                // not a position this flow can move from.
                state: { meaning: "awaitingTriage" as const, blocked: false, closedBy: null },
                ignored: [],
            },
        );
        expect(wrongObserved).toMatchObject({ ok: false, code: "meaningWrongEntity" });
        if (!wrongObserved.ok) {
            expect(wrongObserved.reason).toContain("awaitingTriage");
            expect(wrongObserved.reason).toContain("not a pull request position");
        }
    });

    it("refuses an undocumented issue edge from the observed position", () => {
        const screen = screenIntent(
            intent({ desired: { meaning: "inProgress", cause: "intakeObserved" } }),
            declaration,
            issuePosition("ready"),
        );
        expect(screen).toMatchObject({ ok: false, code: "transitionNotOnMap" });
        if (!screen.ok) expect(screen.reason).toContain("ready");
    });

    it("refuses a pull-request cause on an issue", () => {
        const wrongCause = screenIntent(
            intent({ desired: { meaning: "awaitingTriage", cause: "reviewPolicySatisfied" } }),
            declaration,
            issuePosition(),
        );
        expect(wrongCause).toMatchObject({ ok: false, code: "transitionNotOnMap" });
        if (!wrongCause.ok) {
            expect(wrongCause.reason).toContain("issue-flow cause");
            // An item at no position says so. The alternative renders as a
            // move that starts nowhere, which reads as a missing word.
            expect(wrongCause.reason).toContain("no position → awaitingTriage");
        }
    });

    it("refuses a capability-written pause", () => {
        const screen = screenIntent(
            intent({ desired: { meaning: "blocked", cause: "intakeObserved" } }),
            declaration,
            issuePosition(),
        );
        expect(screen).toMatchObject({ ok: false, code: "pauseNotCapabilityWritable" });
        // D79 is the whole content of this refusal: a capability that reads
        // only the code learns nothing about who may pause an item.
        if (!screen.ok) expect(screen.reason).toContain("only a human may set");
    });

    it("enforces pull-request causes and edges", () => {
        const pullRequestIntent = intent({
            item: { kind: "pullRequest", number: 9 },
            desired: { meaning: "readyToMerge", cause: "reviewPolicySatisfied" },
        });
        expect(
            screenIntent(pullRequestIntent, declaration, pullRequestPosition("needsReview")),
        ).toEqual({ ok: true });

        const wrongCause = screenIntent(
            intent({
                item: { kind: "pullRequest", number: 9 },
                desired: { meaning: "needsReview", cause: "triageCompleted" },
            }),
            declaration,
            pullRequestPosition(),
        );
        expect(wrongCause).toMatchObject({ ok: false, code: "transitionNotOnMap" });
        if (!wrongCause.ok) expect(wrongCause.reason).toContain("pull-request-flow cause");
    });
});
