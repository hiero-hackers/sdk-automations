/**
 * The capability runtime boundary, tested from inside its own package.
 *
 * These assertions existed before, in `packages/probes/test/boundary.test.ts` — and
 * only there. `probes/` is deliberately disposable and its README gives the
 * procedure for deleting it once stage four names a real capability, so the
 * boundary's only tests were scheduled for deletion along with the scaffold
 * that happened to exercise them. The 2026-08-05 mutation run made it
 * visible: `runtime.ts` scored 0.00 with 98 uncovered mutants, because
 * Stryker runs this package's suite and this package tested none of it.
 *
 * The probe suites stay. They test the boundary in COMPOSITION — a real
 * capability, the planner, the store. This file tests it in ISOLATION, which
 * is what has to survive the probes being deleted.
 */

import { describe, expect, it } from "vitest";
import {
    declareCapability,
    deriveIdempotencyKey,
    idempotencyOf,
    intentFactoryFor,
    INTENT_OPERATIONS,
    projectCapabilityView,
    screenIntent,
    type AnyIntent,
} from "../../src/index.js";
import { configWith } from "../config/builders.js";

const declaration = declareCapability({
    name: "fixture",
    triggers: [{ kind: "event", event: "issues" }],
    configKeys: ["announce"],
    requiredMeanings: [],
    observations: ["issueUpdated"],
    resolvers: ["linkedIssues"],
    intents: ["applyMappedLabel", "unassign"],
    operationalNeeds: {
        schedule: false,
        durableState: "none",
        crossItemCoordination: false,
        externalDelivery: false,
    },
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
        expected: { meaningsPresent: [], meaningsAbsent: [], closed: false },
        desired: { meaning: "awaitingTriage", cause: "intakeObserved" },
        cause: { cause: "someCause", observedAt: AT },
        explanation: { capability: "fixture", summary: "s", detail: [] },
        ...over,
    } as unknown as Omit<AnyIntent, "idempotencyKey"> & { readonly idempotencyKey?: string };
    return {
        ...base,
        idempotencyKey: base.idempotencyKey ?? deriveIdempotencyKey(base),
    } as AnyIntent;
};

describe("the operation catalogue owns platform facts", () => {
    /** Operation-owned facts cannot be restated by a capability. */
    it("pins the idempotency class of every operation", () => {
        expect(idempotencyOf("postManagedComment")).toBe("nonIdempotent");
        expect(idempotencyOf("applyMappedLabel")).toBe("idempotent");
        expect(idempotencyOf("unassign")).toBe("idempotent");
    });

    it("pins the action-class floor and required permission of every operation", () => {
        expect(INTENT_OPERATIONS.postManagedComment).toEqual({
            idempotencyClass: "nonIdempotent",
            actionClassFloor: "humanFacingOutput",
            permission: "issues:write",
        });
        for (const op of ["applyMappedLabel", "unassign"] as const) {
            expect(INTENT_OPERATIONS[op]).toEqual({
                idempotencyClass: "idempotent",
                actionClassFloor: "reversibleStateChange",
                permission: "issues:write",
            });
        }
    });
});

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

    it("refuses foreign, undeclared, and malformed intents with distinct reasons", () => {
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

    /**
     * The key is the store's `effect_id` (D65), and the screen exists for the
     * same reason the others do: a capability is ordinary code that can be
     * built from `unknown`, so the boundary re-derives rather than trusting
     * what came back. A capability free to name its own key could merge two
     * effects into one, or split a redelivery into two comments.
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
            expected: { closed: false },
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
                expected: {
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
                    expected: { meaningsPresent: ["ready"], meaningsAbsent: [], closed: false },
                }),
                declaration,
                position(),
            ),
        ).toEqual({ ok: true });
        expect(
            screenIntent(
                intent({
                    expected: { meaningsPresent: [], meaningsAbsent: ["ready"], closed: false },
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
                null,
            ),
        ).toEqual({ ok: true });
    });
});

describe("deriveIdempotencyKey", () => {
    const base = {
        capability: "fixture",
        repository: { owner: "o", repo: "r" },
        item: { kind: "issue", number: 1 },
        operation: "applyMappedLabel",
        cause: { cause: "someCause", observedAt: AT },
    } as const;

    it("is stable across independent derivations of the same occasion", () => {
        expect(deriveIdempotencyKey(base)).toBe(deriveIdempotencyKey(base));
    });

    it("distinguishes every identifying field", () => {
        const variants = [
            { ...base, capability: "other" },
            { ...base, repository: { owner: "o2", repo: "r" } },
            { ...base, repository: { owner: "o", repo: "r2" } },
            { ...base, item: { kind: "pullRequest", number: 1 } as const },
            { ...base, item: { kind: "issue", number: 2 } as const },
            { ...base, cause: { cause: "otherCause", observedAt: AT } },
            { ...base, cause: { cause: "someCause", observedAt: new Date(AT.getTime() + 1) } },
        ];
        const keys = new Set(variants.map(deriveIdempotencyKey));
        expect(keys.size).toBe(variants.length);
        expect(keys.has(deriveIdempotencyKey(base))).toBe(false);
    });

    /**
     * FINDING(runtime-idempotency-key-underived): the encoding must not let
     * a field boundary move. A delimiter join makes capability "a b" with
     * repo "c" collide with capability "a" and repo "b c"; two distinct
     * effects become one and the store cannot tell.
     */
    it("does not let a field boundary shift between fields", () => {
        const a = deriveIdempotencyKey({
            ...base,
            capability: "a b",
            repository: { owner: "c", repo: "r" },
        });
        const b = deriveIdempotencyKey({
            ...base,
            capability: "a",
            repository: { owner: "b c", repo: "r" },
        });
        expect(a).not.toBe(b);
    });

    it("produces a key with no control characters", () => {
        // A NUL-delimited key made the whole source file read as binary to
        // grep and diff; the encoding stays printable on purpose.
        expect(deriveIdempotencyKey(base)).not.toMatch(/[\u0000-\u001f]/);
    });
});

describe("projectCapabilityView (contract.md §2)", () => {
    const config = configWith({
        capabilities: ["fixture", "other"],
        settings: {
            fixture: { announce: true, undeclared: "leak" },
            other: { secret: "theirs" },
        },
        labels: { awaitingTriage: "status: triage", blocked: "blocked" },
    });

    it("passes through only the capability's declared config keys", () => {
        const view = projectCapabilityView(declaration, config);
        expect(view.settings).toEqual({ announce: true });
    });

    it("never exposes another capability's configuration", () => {
        expect(JSON.stringify(projectCapabilityView(declaration, config))).not.toContain("theirs");
    });

    /** D71 — availability of a meaning, never the repository's word for it. */
    it("reports mapped meanings without exposing a label string", () => {
        const view = projectCapabilityView(declaration, config);
        expect([...view.mappedMeanings].sort()).toEqual(["awaitingTriage", "blocked"]);
        expect(JSON.stringify(view)).not.toContain("status: triage");
    });

    it("reports no mapped meanings when the repository mapped none", () => {
        const bare = configWith({ mode: "observe", known: ["fixture"] });
        const view = projectCapabilityView(declaration, bare);
        expect(view.mappedMeanings).toEqual([]);
        expect(view.settings).toEqual({});
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
