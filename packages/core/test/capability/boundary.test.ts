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
    INTENT_OPERATIONS,
    parseConfig,
    projectCapabilityView,
    screenIntent,
    type AnyIntent,
} from "../../src/index.js";

const declaration = declareCapability({
    name: "fixture",
    triggers: [{ kind: "event", event: "issues" }],
    configKeys: ["announce"],
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

const intent = (over: Record<string, unknown> = {}): AnyIntent =>
    ({
        capability: "fixture",
        repository: { owner: "o", repo: "r" },
        item: { kind: "issue", number: 1 },
        operation: "applyMappedLabel",
        expected: { meaningsPresent: [], meaningsAbsent: [], closed: false },
        desired: { meaning: "awaitingTriage", cause: "intakeObserved" },
        cause: { cause: "someCause", observedAt: AT },
        explanation: { capability: "fixture", summary: "s", detail: [] },
        idempotencyKey: "k",
        ...over,
    }) as AnyIntent;

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
                    desired: { marker: "<!-- m -->", body: "b" },
                }),
                declaration,
                position(),
            ),
            screenIntent(
                intent({ cause: { cause: "c", observedAt: new Date(Number.NaN) } }),
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

    it("refuses a mapped-label intent when authoritative position is unavailable", () => {
        expect(screenIntent(intent(), declaration, null)).toEqual({
            ok: false,
            code: "authoritativePositionUnavailable",
            reason: "the authoritative current position is unavailable",
        });
    });

    it("uses an observed conflict even when the capability claims a clean state", () => {
        expect(
            screenIntent(
                intent({
                    expected: {
                        meaningsPresent: [],
                        meaningsAbsent: ["ready", "inProgress"],
                        closed: false,
                    },
                }),
                declaration,
                conflict,
            ),
        ).toMatchObject({ ok: false, code: "positionConflict" });
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

describe("projectCapabilityView (contract.md §6)", () => {
    const config = (() => {
        const result = parseConfig(
            {
                schemaVersion: 1,
                mode: "active",
                capabilities: {
                    fixture: {
                        enabled: true,
                        settings: { announce: true, undeclared: "leak" },
                    },
                    other: { enabled: true, settings: { secret: "theirs" } },
                },
                mappings: { labels: { awaitingTriage: "status: triage", blocked: "blocked" } },
                principals: {},
            },
            { revision: "rev-test", knownCapabilities: ["fixture", "other"] },
        );
        if (!result.ok) throw new Error(result.errors.map((e) => e.message).join("; "));
        return result.config;
    })();

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
        const bare = parseConfig(
            {
                schemaVersion: 1,
                mode: "observe",
                capabilities: {},
                mappings: { labels: {} },
                principals: {},
            },
            { revision: "rev-test", knownCapabilities: ["fixture"] },
        );
        if (!bare.ok) throw new Error("fixture config invalid");
        const view = projectCapabilityView(declaration, bare.config);
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
        if (!wrongCause.ok) expect(wrongCause.reason).toContain("issue-flow cause");
    });

    it("refuses a capability-written pause", () => {
        expect(
            screenIntent(
                intent({ desired: { meaning: "blocked", cause: "intakeObserved" } }),
                declaration,
                issuePosition(),
            ),
        ).toMatchObject({ ok: false, code: "pauseNotCapabilityWritable" });
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
