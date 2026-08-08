/**
 * Conformance of the runtime boundary itself (`packages/core/src/capability/`), and
 * the subset of contract.md §8's kit that needs no adapter.
 */

import { describe, expect, it } from "vitest";
import {
    checkAgainstCatalogue,
    createRegistry,
    declareCapability,
    idempotencyOf,
    projectCapabilityView,
    screenIntent,
    validateDeclaration,
    type AnyIntent,
} from "@hiero-hackers/automation-core";
import { inactivity, intake, prQuality } from "../src/index.js";
import { configEnabling } from "./world.js";

const ALL = [prQuality, intake, inactivity];
const NAMES = ALL.map((c) => c.declaration.name);

describe("declarations", () => {
    it("every probe declaration is valid and catalogue-consistent", () => {
        for (const c of ALL) {
            expect(validateDeclaration(c.declaration)).toEqual([]);
            expect(checkAgainstCatalogue(c.declaration)).toEqual([]);
        }
    });

    it("the three probes build one registry", () => {
        const result = createRegistry(ALL.map((c) => c.declaration));
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect([...result.registry.activeNames].sort()).toEqual([...NAMES].sort());
        }
    });

    /**
     * FINDING(runtime-idempotency-declared-not-checked) as a test: the
     * declaration layer alone accepts this, and the executor would then
     * blind-retry a comment create — experiment 6.5's duplication.
     */
    it("registry construction reaches the catalogue check for a structurally valid liar", () => {
        const liar = declareCapability({
            name: "liar",
            triggers: [{ kind: "event", event: "issues" }],
            configKeys: [],
            observations: ["issueUpdated"],
            resolvers: [],
            intents: [
                {
                    name: "postManagedComment",
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

        expect(validateDeclaration(liar)).toEqual([]);
        const registry = createRegistry([liar]);
        expect(registry.ok).toBe(false);
        const errors = registry.ok ? [] : registry.errors;
        expect(errors).toHaveLength(1);
        expect(errors[0]).toContain("the platform owns this fact");
        // And the executor never reads the declared value anyway.
        expect(idempotencyOf("postManagedComment")).toBe("nonIdempotent");
    });
});

describe("configuration isolation (contract.md §6)", () => {
    const config = configEnabling(NAMES, NAMES, {
        intake: { announce: true, secretKnob: "not declared" },
    });

    it("projects only the capability's declared config keys", () => {
        const view = projectCapabilityView(intake.declaration, config);
        expect(view.settings).toEqual({ announce: true });
        expect("secretKnob" in view.settings).toBe(false);
    });

    it("never hands a capability another capability's block", () => {
        const view = projectCapabilityView(prQuality.declaration, config);
        expect(view.settings).toEqual({});
    });

    /**
     * §6's actual sentence, as a test rather than a hope: a capability
     * refers to internal meanings, never repository label strings. The
     * view reports availability and nothing else.
     */
    it("reports mapped meanings without ever exposing a label string", () => {
        const view = projectCapabilityView(intake.declaration, config);
        expect([...view.mappedMeanings].sort()).toEqual([
            "awaitingTriage",
            "blocked",
            "inProgress",
        ]);
        expect(JSON.stringify(view)).not.toContain("status: triage");
    });
});

describe("intent screening", () => {
    const base = {
        capability: "intake",
        repository: { owner: "o", repo: "r" },
        item: { kind: "issue", number: 1 },
        expected: { meaningsPresent: [], meaningsAbsent: [], closed: false },
        cause: { cause: "c", observedAt: new Date("2026-08-03T00:00:00.000Z") },
        explanation: { capability: "intake", summary: "s", detail: [] },
        idempotencyKey: "k",
    } as const;

    it("refuses an intent the capability did not declare", () => {
        const intent = {
            ...base,
            operation: "unassign",
            actionClass: "reversibleStateChange",
            desired: { login: "someone" },
        } as AnyIntent;
        const screen = screenIntent(intent, intake.declaration);
        expect(screen).toMatchObject({ ok: false, code: "undeclaredIntent" });
    });

    it("refuses an intent attributed to another capability", () => {
        const intent = {
            ...base,
            capability: "prQuality",
            operation: "applyMappedLabel",
            actionClass: "reversibleStateChange",
            desired: { meaning: "awaitingTriage", cause: "intakeObserved" },
        } as AnyIntent;
        expect(screenIntent(intent, intake.declaration)).toMatchObject({
            ok: false,
            code: "foreignCapability",
        });
    });

    /** FINDING(runtime-action-class-floor). */
    it("refuses a write that understates its own risk class", () => {
        const intent = {
            ...base,
            operation: "applyMappedLabel",
            actionClass: "observation",
            desired: { meaning: "awaitingTriage", cause: "intakeObserved" },
        } as AnyIntent;
        expect(screenIntent(intent, intake.declaration)).toMatchObject({
            ok: false,
            code: "actionClassBelowFloor",
        });
    });

    /**
     * The screen permits stricter; the safety engine may still refuse it.
     * `immediatePreventive` is exactly that case — D54 gives it no
     * explanation/reversal gate, so `evaluateWrite` answers
     * `preventiveGateUnavailable`. The two layers disagreeing in this
     * direction is safe and intended: the screen bounds what a capability
     * may CLAIM, the gate decides what may HAPPEN. A capability declaring
     * this class today ships nothing.
     */
    it("accepts a stricter class than the floor", () => {
        const intent = {
            ...base,
            operation: "applyMappedLabel",
            actionClass: "immediatePreventive",
            desired: { meaning: "awaitingTriage", cause: "intakeObserved" },
        } as AnyIntent;
        expect(screenIntent(intent, intake.declaration)).toEqual({ ok: true });
    });

    /** FINDING(runtime-destructive-intent-has-no-warning), both directions. */
    it("refuses a destructive intent with no warning record", () => {
        const intent = {
            ...base,
            capability: "inactivity",
            operation: "unassign",
            actionClass: "clockTriggeredDestructive",
            desired: { login: "someone" },
        } as AnyIntent;
        expect(screenIntent(intent, inactivity.declaration)).toMatchObject({
            ok: false,
            code: "destructiveWithoutWarning",
        });
    });

    it("refuses a warning record attached to a non-destructive intent", () => {
        const intent = {
            ...base,
            capability: "inactivity",
            operation: "unassign",
            actionClass: "reversibleStateChange",
            destructive: {
                warnedAt: new Date("2026-07-01T00:00:00.000Z"),
                gracePeriodDays: 7,
                earliestActionAt: new Date("2026-07-08T00:00:00.000Z"),
                cancelledBy: "activity",
                reversesWith: "reassigning",
                qualifyingActivitySinceWarning: false,
                warnedCause: "c",
                warnedCauseObservedAt: new Date("2026-07-01T00:00:00.000Z"),
            },
            desired: { login: "someone" },
        } as AnyIntent;
        expect(screenIntent(intent, inactivity.declaration)).toMatchObject({
            ok: false,
            code: "warningWithoutDestructive",
        });
    });
});
