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
    checkAgainstCatalogue,
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
    intents: [
        {
            name: "applyMappedLabel",
            idempotencyClass: "idempotent",
            requiredPermissions: ["issues:write"],
        },
        {
            name: "unassign",
            idempotencyClass: "idempotent",
            requiredPermissions: ["issues:write"],
        },
    ],
    permissions: { repository: ["issues:write"], organization: [] },
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
        actionClass: "reversibleStateChange",
        expected: { meaningsPresent: [], meaningsAbsent: [], closed: false },
        desired: { meaning: "awaitingTriage", cause: "intakeObserved" },
        cause: { cause: "someCause", observedAt: AT },
        explanation: { capability: "fixture", summary: "s", detail: [] },
        idempotencyKey: "k",
        ...over,
    }) as AnyIntent;

const destructiveDetail = {
    warnedAt: AT,
    gracePeriodDays: 7,
    earliestActionAt: new Date("2026-08-12T09:00:00.000Z"),
    cancelledBy: "activity",
    reversesWith: "reassigning",
    qualifyingActivitySinceWarning: false,
    warnedCause: "someCause",
    warnedCauseObservedAt: AT,
};

describe("the operation catalogue owns what the declaration may only restate", () => {
    /**
     * D62. If these values are not pinned here, a declaration is free to
     * disagree with the platform and the executor picks its retry rule from
     * the wrong one — 6.5's demonstrated comment duplication.
     */
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

    it("rejects a declaration whose idempotency class contradicts the catalogue", () => {
        const liar = declareCapability({
            ...declaration,
            intents: [
                {
                    name: "postManagedComment",
                    idempotencyClass: "idempotent",
                    requiredPermissions: ["issues:write"],
                },
            ],
        });
        const errors = checkAgainstCatalogue(liar);
        expect(errors).toHaveLength(1);
        expect(errors[0]).toContain("the platform owns this fact");
    });

    it("rejects a declaration whose intent omits the operation's permission", () => {
        const under = declareCapability({
            ...declaration,
            intents: [
                {
                    name: "applyMappedLabel",
                    idempotencyClass: "idempotent",
                    requiredPermissions: [],
                },
            ],
        });
        expect(checkAgainstCatalogue(under)[0]).toContain('must require "issues:write"');
    });

    it("accepts a declaration that agrees with the catalogue", () => {
        expect(checkAgainstCatalogue(declaration)).toEqual([]);
    });
});

describe("screenIntent", () => {
    it("accepts a well-formed intent", () => {
        expect(screenIntent(intent(), declaration)).toEqual({ ok: true });
    });

    it("refuses an intent attributed to another capability", () => {
        expect(screenIntent(intent({ capability: "other" }), declaration)).toMatchObject({
            ok: false,
            code: "foreignCapability",
        });
    });

    it("refuses an operation the capability did not declare", () => {
        expect(
            screenIntent(
                intent({
                    operation: "postManagedComment",
                    actionClass: "humanFacingOutput",
                    desired: { marker: "<!-- m -->", body: "b" },
                }),
                declaration,
            ),
        ).toMatchObject({ ok: false, code: "undeclaredIntent" });
    });

    /**
     * D63's floor, in both directions. The `below` case is what pins
     * ACTION_CLASS_RANK: with an empty rank map every lookup is `undefined`,
     * `undefined < undefined` is false, and an understated write would sail
     * through — so this assertion is the one that makes the ranking real.
     */
    it("refuses a write that understates its risk class", () => {
        expect(
            screenIntent(intent({ actionClass: "humanFacingOutput" }), declaration),
        ).toMatchObject({ ok: false, code: "actionClassBelowFloor" });
        expect(screenIntent(intent({ actionClass: "observation" }), declaration)).toMatchObject({
            ok: false,
            code: "actionClassBelowFloor",
        });
    });

    it("accepts a stricter class than the floor", () => {
        // Permitted by the screen; `evaluateWrite` still refuses
        // `immediatePreventive` for want of a gate (D54). The screen bounds
        // what may be CLAIMED, the safety engine what may HAPPEN.
        expect(screenIntent(intent({ actionClass: "immediatePreventive" }), declaration)).toEqual({
            ok: true,
        });
    });

    it("refuses an intent whose cause carries an invalid timestamp", () => {
        expect(
            screenIntent(
                intent({ cause: { cause: "c", observedAt: new Date(Number.NaN) } }),
                declaration,
            ),
        ).toMatchObject({ ok: false, code: "invalidCause" });
    });

    /** D64, both directions — the reverse check is the dangerous one. */
    it("refuses a destructive intent carrying no warning record", () => {
        expect(
            screenIntent(
                intent({
                    operation: "unassign",
                    actionClass: "clockTriggeredDestructive",
                    desired: { login: "someone" },
                }),
                declaration,
            ),
        ).toMatchObject({ ok: false, code: "destructiveWithoutWarning" });
    });

    it("refuses a warning record attached to a non-destructive intent", () => {
        expect(
            screenIntent(
                intent({
                    operation: "unassign",
                    actionClass: "reversibleStateChange",
                    desired: { login: "someone" },
                    destructive: destructiveDetail,
                }),
                declaration,
            ),
        ).toMatchObject({ ok: false, code: "warningWithoutDestructive" });
    });

    /**
     * The same invariant `safety.test.ts` holds over its verdicts: `code` is
     * machine-readable contract and asserted exactly; `reason` is prose for
     * humans and asserted only to be PRESENT. A refusal that cannot say why
     * is a refusal an operator cannot act on — but pinning the wording would
     * make human-facing text a breaking change.
     */
    it("every refusal carries a non-empty human reason", () => {
        const refusals = [
            intent({ capability: "other" }),
            intent({
                operation: "postManagedComment",
                actionClass: "humanFacingOutput",
                desired: { marker: "<!-- m -->", body: "b" },
            }),
            intent({ actionClass: "observation" }),
            intent({ cause: { cause: "c", observedAt: new Date(Number.NaN) } }),
            intent({
                operation: "unassign",
                actionClass: "clockTriggeredDestructive",
                desired: { login: "someone" },
            }),
            intent({
                operation: "unassign",
                actionClass: "reversibleStateChange",
                desired: { login: "someone" },
                destructive: destructiveDetail,
            }),
        ];
        const seen = new Set<string>();
        for (const candidate of refusals) {
            const screen = screenIntent(candidate, declaration);
            expect(screen.ok).toBe(false);
            if (!screen.ok) {
                expect(screen.reason.length).toBeGreaterThan(0);
                expect(screen.code.length).toBeGreaterThan(0);
                seen.add(screen.code);
            }
        }
        // Every refusal path reports a DISTINCT code — a shared code would
        // make two different defects indistinguishable to an operator.
        expect(seen.size).toBe(refusals.length);
    });

    it("accepts a destructive intent that carries its warning", () => {
        expect(
            screenIntent(
                intent({
                    operation: "unassign",
                    actionClass: "clockTriggeredDestructive",
                    desired: { login: "someone" },
                    destructive: destructiveDetail,
                }),
                declaration,
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

describe("the map is enforced (D78)", () => {
    const move = (over: Record<string, unknown> = {}): AnyIntent =>
        intent({
            operation: "applyMappedLabel",
            actionClass: "reversibleStateChange",
            desired: { meaning: "awaitingTriage", cause: "intakeObserved" },
            ...over,
        });

    /**
     * The case that motivated all of this: `readyToMerge` is a pull-request
     * position. Nothing used to stop a capability writing it onto an issue —
     * the screen checked the operation was declared, safety checked permission
     * and mode, and the tables that knew better had no caller.
     */
    it("refuses a pull-request position on an issue", () => {
        expect(
            screenIntent(
                move({ desired: { meaning: "readyToMerge", cause: "intakeObserved" } }),
                declaration,
            ),
        ).toMatchObject({ ok: false, code: "meaningWrongEntity" });
    });

    it("accepts a documented edge", () => {
        expect(screenIntent(move(), declaration)).toEqual({ ok: true });
    });

    /**
     * A foreign-flow CAUSE, distinct from a foreign-flow meaning: the meaning
     * is a legal issue position, but the cause belongs to the pull-request
     * flow. Before D90 a cast slid this into the edge lookup; the predicate
     * now refuses it by name, and this walks that branch — the predicate unit
     * tests alone leave it uncovered.
     */
    it("refuses an issue move driven by a pull-request cause", () => {
        const screen = screenIntent(
            move({ desired: { meaning: "awaitingTriage", cause: "checksPassed" } }),
            declaration,
        );
        expect(screen).toMatchObject({ ok: false, code: "transitionNotOnMap" });
        if (!screen.ok) expect(screen.reason).toContain("issue-flow");
    });

    it("refuses a move the profile does not document", () => {
        // ready → inProgress is an edge, but not for `intakeObserved`.
        const screen = screenIntent(
            move({
                expected: { meaningsPresent: ["ready"], meaningsAbsent: [], closed: false },
                desired: { meaning: "inProgress", cause: "intakeObserved" },
            }),
            declaration,
        );
        expect(screen).toMatchObject({ ok: false, code: "transitionNotOnMap" });
        if (!screen.ok) expect(screen.reason).toContain("ready");
    });

    it("accepts that same move under the cause the map names for it", () => {
        expect(
            screenIntent(
                move({
                    expected: { meaningsPresent: ["ready"], meaningsAbsent: [], closed: false },
                    desired: { meaning: "inProgress", cause: "contributorAssigned" },
                }),
                declaration,
            ),
        ).toEqual({ ok: true });
    });

    /**
     * A cross-entity label is noise to preserve, not a position (D35). It must
     * not be mistaken for the `from` the capability is moving away from.
     */
    it("ignores a stray cross-flow label when reading the current position", () => {
        expect(
            screenIntent(
                move({
                    expected: {
                        meaningsPresent: ["needsReview"],
                        meaningsAbsent: [],
                        closed: false,
                    },
                }),
                declaration,
            ),
        ).toEqual({ ok: true });
    });

    it("leaves non-moving operations alone — a comment is not a transition", () => {
        expect(
            screenIntent(
                intent({
                    operation: "unassign",
                    actionClass: "reversibleStateChange",
                    desired: { login: "someone" },
                }),
                declaration,
            ),
        ).toEqual({ ok: true });
    });
});

describe("what the map check must NOT break", () => {
    /**
     * `blocked` is an orthogonal pause flag, not a position (D28). It is
     * mappable, it applies to issues and pull requests alike, and applying it
     * moves nothing — so there is no edge to check.
     *
     * The first version of the screen refused it as `meaningWrongEntity`,
     * which would have broken every capability that blocks an item. This test
     * exists because that bug shipped in the first draft and passed every
     * other test in the suite.
     */
    it("refuses a capability-written pause, and not as a wrong entity (D79)", () => {
        for (const kind of ["issue", "pullRequest"] as const) {
            const screen = screenIntent(
                intent({
                    item: { kind, number: 1 },
                    operation: "applyMappedLabel",
                    actionClass: "reversibleStateChange",
                    desired: { meaning: "blocked", cause: "intakeObserved" },
                }),
                declaration,
            );
            // The CODE is the point. Refusing it as `meaningWrongEntity`
            // would tell a maintainer they got the entity wrong, when what
            // they actually did was try to withhold an item from every other
            // capability.
            expect(screen, `on a ${kind}`).toMatchObject({
                ok: false,
                code: "pauseNotCapabilityWritable",
            });
        }
    });

    /**
     * The refusal must be about pausing, not about positions: `blocked` is
     * legal on both entity kinds and would pass an entity check. If this ever
     * starts reporting `meaningWrongEntity`, the two rules have been reordered
     * and the reason a maintainer sees has silently become false.
     */
    it("reaches the pause rule before the entity rule", () => {
        const screen = screenIntent(
            intent({
                item: { kind: "pullRequest", number: 1 },
                operation: "applyMappedLabel",
                actionClass: "reversibleStateChange",
                desired: { meaning: "blocked", cause: "intakeObserved" },
            }),
            declaration,
        );
        expect(screen.ok).toBe(false);
        if (!screen.ok) expect(screen.code).not.toBe("meaningWrongEntity");
    });

    /**
     * Two own-flow positions is a conflict, and the projection refuses to
     * produce one (D35). Silently treating it as "no position" would check
     * the `[*] → to` edge — the wrong one — and could let a move through.
     */
    it("refuses a conflicted position rather than checking the wrong edge", () => {
        const screen = screenIntent(
            intent({
                operation: "applyMappedLabel",
                actionClass: "reversibleStateChange",
                expected: {
                    meaningsPresent: ["ready", "inProgress"],
                    meaningsAbsent: [],
                    closed: false,
                },
                desired: { meaning: "awaitingTriage", cause: "intakeObserved" },
            }),
            declaration,
        );
        expect(screen).toMatchObject({ ok: false, code: "positionConflict" });
    });
});

describe("the map is enforced on both flows, not just issues", () => {
    it("refuses a pull-request move driven by an issue cause", () => {
        const screen = screenIntent(
            intent({
                item: { kind: "pullRequest", number: 9 },
                operation: "applyMappedLabel",
                actionClass: "reversibleStateChange",
                desired: { meaning: "needsReview", cause: "triageCompleted" },
            }),
            declaration,
        );
        expect(screen).toMatchObject({ ok: false, code: "transitionNotOnMap" });
        if (!screen.ok) expect(screen.reason).toContain("pull-request-flow");
    });

    /**
     * Every test above uses an issue, so `canTransitionPr` was never reached
     * and half the profile went unexercised — the mutation gate caught it.
     * The pull-request flow has its own edges and its own causes, and a check
     * that only ever ran on one of them proves very little.
     */
    const pr = (over: Record<string, unknown> = {}): AnyIntent =>
        intent({
            item: { kind: "pullRequest", number: 9 },
            operation: "applyMappedLabel",
            actionClass: "reversibleStateChange",
            ...over,
        });

    it("accepts a documented pull-request edge", () => {
        expect(
            screenIntent(
                pr({
                    expected: {
                        meaningsPresent: ["needsReview"],
                        meaningsAbsent: [],
                        closed: false,
                    },
                    desired: { meaning: "readyToMerge", cause: "reviewPolicySatisfied" },
                }),
                declaration,
            ),
        ).toEqual({ ok: true });
    });

    it("refuses a pull-request move the profile does not document", () => {
        const screen = screenIntent(
            pr({
                expected: {
                    meaningsPresent: ["needsReview"],
                    meaningsAbsent: [],
                    closed: false,
                },
                desired: { meaning: "readyToMerge", cause: "revisionResolved" },
            }),
            declaration,
        );
        expect(screen).toMatchObject({ ok: false, code: "transitionNotOnMap" });
        if (!screen.ok) expect(screen.reason).toContain("needsReview");
    });

    it("names the right entity when an issue position lands on a pull request", () => {
        const screen = screenIntent(
            pr({ desired: { meaning: "ready", cause: "triageCompleted" } }),
            declaration,
        );
        expect(screen).toMatchObject({ ok: false, code: "meaningWrongEntity" });
        if (!screen.ok) expect(screen.reason).toContain("pull request");
    });

    it("says 'no position' rather than nothing when moving from nowhere", () => {
        const screen = screenIntent(
            pr({ desired: { meaning: "readyToMerge", cause: "checksPassed" } }),
            declaration,
        );
        expect(screen.ok).toBe(false);
        if (!screen.ok) expect(screen.reason).toContain("no position");
    });
});
