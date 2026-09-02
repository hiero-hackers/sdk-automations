/**
 * Conformance of the runtime boundary itself (`packages/core/src/capability/`), and
 * the contract.md §5 checks that need no adapter.
 */

import { describe, expect, it } from "vitest";
import {
    deriveIdempotencyKey,
    idempotencyOf,
    projectCapabilityView,
    screenIntent,
    validateCapabilityDeclarations,
    type AnyIntent,
} from "@hiero-hackers/automation-core";
import { inactivity, intake, prQuality } from "../src/index.js";
import { configEnabling } from "./world.js";

const ALL = [prQuality, intake, inactivity];
const NAMES = ALL.map((c) => c.declaration.name);

/**
 * A declaration is the whole of what the platform will let a capability see,
 * ask and write, so each is pinned as a literal rather than sampled. The
 * triad is also deliberately unalike — event and schedule triggers, one
 * empty resolver list, one `durableState: "required"`, one non-empty
 * `requiredMeanings` — and only the full shapes side by side show that.
 */
describe("declared shape", () => {
    it("prQuality declares one event trigger, one resolver, and one comment", () => {
        expect(prQuality.declaration).toEqual({
            name: "prQuality",
            triggers: [{ kind: "event", event: "pull_request" }],
            configKeys: [],
            requiredMeanings: [],
            observations: ["pullRequestUpdated"],
            resolvers: ["linkedIssues"],
            intents: ["postManagedComment"],
            operationalNeeds: {
                schedule: false,
                durableState: "none",
                crossItemCoordination: false,
                externalDelivery: false,
            },
        });
    });

    /**
     * The only probe that requires a meaning, and the one D84 is about: this
     * list is what makes enabling intake without `awaitingTriage` a file
     * error instead of a runtime silence.
     */
    it("intake declares no resolver, two intents from one observation, and one required meaning", () => {
        expect(intake.declaration).toEqual({
            name: "intake",
            triggers: [{ kind: "event", event: "issues" }],
            configKeys: ["announce"],
            requiredMeanings: ["awaitingTriage"],
            observations: ["issueUpdated"],
            resolvers: [],
            intents: ["applyMappedLabel", "postManagedComment"],
            operationalNeeds: {
                schedule: false,
                durableState: "none",
                crossItemCoordination: false,
                externalDelivery: false,
            },
        });
    });

    it("inactivity is the only probe declaring a schedule and durable state", () => {
        expect(inactivity.declaration).toEqual({
            name: "inactivity",
            triggers: [{ kind: "schedule", description: "daily stale-assignment sweep" }],
            configKeys: ["gracePeriodDays"],
            requiredMeanings: [],
            observations: ["staleItemsDue"],
            resolvers: ["isAutomationActor"],
            intents: ["postManagedComment", "unassign"],
            operationalNeeds: {
                schedule: true,
                durableState: "required",
                crossItemCoordination: false,
                externalDelivery: false,
            },
        });
    });
});

describe("declarations", () => {
    it("admits the three direct probe declarations together", () => {
        expect(validateCapabilityDeclarations(ALL.map(({ declaration }) => declaration))).toEqual(
            [],
        );
    });

    it("uses the same direct names as configuration", () => {
        expect([...NAMES].sort()).toEqual(["inactivity", "intake", "prQuality"]);
    });

    it("keeps idempotency in the platform catalogue, not declarations", () => {
        expect(idempotencyOf("postManagedComment")).toBe("nonIdempotent");
        expect(idempotencyOf("applyMappedLabel")).toBe("idempotent");
        expect(idempotencyOf("unassign")).toBe("idempotent");
    });
});

describe("configuration isolation (contract.md §2)", () => {
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
    } as const;
    /**
     * The candidate under test, keyed the way the platform keys it. A literal
     * key would be refused by the idempotency screen before any of the
     * screens below it ever ran.
     */
    const candidate = (over: Record<string, unknown>): AnyIntent => {
        const draft = { ...base, ...over } as unknown as Parameters<typeof deriveIdempotencyKey>[0];
        return { ...draft, idempotencyKey: deriveIdempotencyKey(draft) } as AnyIntent;
    };
    const position = {
        kind: "position" as const,
        state: { meaning: null, blocked: false, closedBy: null },
        ignored: [],
    };

    it("refuses an intent the capability did not declare", () => {
        const undeclared = candidate({ operation: "unassign", desired: { login: "someone" } });
        expect(screenIntent(undeclared, intake.declaration, position)).toMatchObject({
            ok: false,
            code: "undeclaredIntent",
        });
    });

    it("refuses an intent attributed to another capability", () => {
        const foreign = candidate({
            capability: "prQuality",
            operation: "applyMappedLabel",
            desired: { meaning: "awaitingTriage", cause: "intakeObserved" },
        });
        expect(screenIntent(foreign, intake.declaration, position)).toMatchObject({
            ok: false,
            code: "foreignCapability",
        });
    });

    it("refuses a label transition when authoritative position is unavailable", () => {
        const unprojected = candidate({
            operation: "applyMappedLabel",
            desired: { meaning: "awaitingTriage", cause: "intakeObserved" },
        });
        expect(screenIntent(unprojected, intake.declaration, null)).toMatchObject({
            ok: false,
            code: "authoritativePositionUnavailable",
        });
    });
});
