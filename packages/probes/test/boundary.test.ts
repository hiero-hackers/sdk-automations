/**
 * Conformance of the runtime boundary itself (`packages/core/src/capability/`), and
 * the subset of contract.md §8's kit that needs no adapter.
 */

import { describe, expect, it } from "vitest";
import {
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
    const position = {
        kind: "position" as const,
        state: { meaning: null, blocked: false, closedBy: null },
        ignored: [],
    };

    it("refuses an intent the capability did not declare", () => {
        const candidate = {
            ...base,
            operation: "unassign",
            desired: { login: "someone" },
        } as AnyIntent;
        expect(screenIntent(candidate, intake.declaration, position)).toMatchObject({
            ok: false,
            code: "undeclaredIntent",
        });
    });

    it("refuses an intent attributed to another capability", () => {
        const candidate = {
            ...base,
            capability: "prQuality",
            operation: "applyMappedLabel",
            desired: { meaning: "awaitingTriage", cause: "intakeObserved" },
        } as AnyIntent;
        expect(screenIntent(candidate, intake.declaration, position)).toMatchObject({
            ok: false,
            code: "foreignCapability",
        });
    });

    it("refuses a label transition when authoritative position is unavailable", () => {
        const candidate = {
            ...base,
            operation: "applyMappedLabel",
            desired: { meaning: "awaitingTriage", cause: "intakeObserved" },
        } as AnyIntent;
        expect(screenIntent(candidate, intake.declaration, null)).toMatchObject({
            ok: false,
            code: "authoritativePositionUnavailable",
        });
    });
});
