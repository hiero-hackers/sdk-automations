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
import { CAPABILITIES, inactivity, intake, prDashboard } from "../src/index.js";
import { INACTIVITY_SETTINGS } from "../src/inactivity/settings.js";
import { INTAKE_SETTINGS } from "../src/intake/settings.js";
import { PR_DASHBOARD_SETTINGS } from "../src/prDashboard/settings.js";
import { configEnabling } from "@hiero-hackers/automation-core/author/testing";

// Derived, not listed: the isolation claim below covers a capability the day
// it joins the registry, with no edit here. The three pinned shapes are the
// suite's other half and are named one by one on purpose.
const ALL = CAPABILITIES;
const NAMES = ALL.map((c) => c.declaration.name);
const DECLARATIONS = ALL.map((c) => c.declaration);

/**
 * A declaration is the whole of what the platform will let a capability see,
 * ask and write, so each is pinned as a literal rather than sampled. The
 * three below are pinned because they are deliberately unalike — event and
 * schedule triggers, one empty resolver list, one `durableState: "required"`,
 * one non-empty `requiredMappings`, and one that needs every fact group where
 * the other two need none — and only the full shapes side by side show that.
 * They are named rather than walked for that reason; the registry walk is the
 * `declarations` block below.
 */
describe("declared shape", () => {
    it("prDashboard declares an event and a schedule trigger, five resolvers, a comment and a label", () => {
        expect(prDashboard.declaration).toEqual({
            name: "prDashboard",
            triggers: [
                { kind: "event", event: "pull_request" },
                { kind: "schedule", description: "hourly recheck of every open pull request" },
            ],
            settings: PR_DASHBOARD_SETTINGS,
            requiredMappings: {},
            labels: ["needsRevision", "needsReview"],
            facts: ["pullRequest"],
            needs: ["readiness"],
            resolvers: [
                "isAutomationActor",
                "linkedIssues",
                "commitAttestations",
                "mergeability",
                "assigneesOf",
            ],
            intents: ["postManagedComment", "applyMappedLabel"],
        });
    });

    /**
     * The only probe that requires a meaning, and the one D84 is about: this
     * list is what makes enabling intake without `awaitingTriage` a file
     * error instead of a runtime silence.
     */
    it("intake declares its actor lookup, writes, and required meaning", () => {
        expect(intake.declaration).toEqual({
            name: "intake",
            triggers: [{ kind: "event", event: "issues" }],
            settings: INTAKE_SETTINGS,
            requiredMappings: { labels: ["awaitingTriage"] },
            labels: ["awaitingTriage"],
            facts: ["issue"],
            needs: [],
            resolvers: ["isAutomationActor"],
            intents: ["applyMappedLabel", "postManagedComment", "lockIssue", "unlockIssue"],
        });
    });

    it("inactivity is the only probe declaring a schedule and durable state", () => {
        expect(inactivity.declaration).toEqual({
            name: "inactivity",
            triggers: [{ kind: "schedule", description: "hourly stale-assignment sweep" }],
            settings: INACTIVITY_SETTINGS,
            requiredMappings: {},
            labels: [],
            facts: ["issue", "pullRequest"],
            needs: ["assignees", "links", "review", "readiness"],
            resolvers: ["isAutomationActor"],
            intents: ["postManagedComment", "releaseAssignment", "closePullRequest"],
        });
    });
    /**
     * The spec IS the settings schema, so the keys a maintainer may write are
     * the keys the parser hands back — every one of them, and nothing else.
     *
     * Walked rather than listed, unlike the three shapes above. A capability's
     * first key is a change to its own folder, its own tests and the report
     * that renders every enabled capability's settings; a list here would make
     * it a change to this file too, in a suite that has no opinion about which
     * keys any capability should have.
     */
    it("declares the settings keys each repository may write", () => {
        const config = configEnabling(NAMES, DECLARATIONS);
        for (const { declaration } of ALL) {
            expect(
                Object.keys(config.capabilities[declaration.name]?.settings ?? {}),
                declaration.name,
            ).toEqual(Object.keys(declaration.settings));
        }
        // Two controls: a walk over four empty specs would assert nothing, and
        // a key no spec declares is refused rather than carried through.
        expect(ALL.some(({ declaration }) => Object.keys(declaration.settings).length > 0)).toBe(
            true,
        );
        expect(() =>
            configEnabling(NAMES, DECLARATIONS, { [NAMES[0]!]: { notASetting: true } }),
        ).toThrow(/notASetting/);
    });
});

describe("declarations", () => {
    /** The count is the negative control: an empty registry admits in silence. */
    it("admits every registered declaration together", () => {
        expect(NAMES.length).toBeGreaterThanOrEqual(4);
        expect(validateCapabilityDeclarations(ALL.map(({ declaration }) => declaration))).toEqual(
            [],
        );
    });

    /**
     * A declaration's name IS its configuration key, so the registry walked
     * here is the same list a maintainer writes blocks for — and
     * `configEnabling` throws rather than returning on a document the parser
     * refuses, which is what makes this an assertion and not a formality.
     */
    it("uses the same names as configuration", () => {
        expect(Object.keys(configEnabling(NAMES, DECLARATIONS).capabilities).sort()).toEqual(
            [...NAMES].sort(),
        );
    });

    it("keeps idempotency in the platform catalogue, not declarations", () => {
        expect(idempotencyOf("postManagedComment")).toBe("nonIdempotent");
        expect(idempotencyOf("applyMappedLabel")).toBe("idempotent");
        expect(idempotencyOf("unassign")).toBe("idempotent");
        expect(idempotencyOf("releaseAssignment")).toBe("idempotent");
        expect(idempotencyOf("closePullRequest")).toBe("idempotent");
    });
});

describe("configuration isolation (contract.md §2)", () => {
    const config = configEnabling(
        NAMES,
        DECLARATIONS,
        { intake: { announce: true } },
        {
            labels: {
                awaitingTriage: "status: triage",
                inProgress: "status: in progress",
                blocked: "blocked",
            },
            commands: { assign: "/take-it" },
            skills: { beginner: "skill: beginner" },
        },
    );

    it("projects the capability's own settings, as the parser resolved them", () => {
        const view = projectCapabilityView(intake.declaration, config);
        expect(view.settings).toEqual({
            announce: true,
            unlockWhen: [],
            confirmUnlock: false,
        });
    });

    /**
     * A key outside the spec never reaches the view because it never reaches a
     * configuration: the parser refuses the file (D84). Pinned here as the
     * other half of the isolation claim — the view drops nothing, because
     * there is nothing left to drop.
     */
    it("refuses an undeclared key rather than dropping it on the way in", () => {
        expect(() =>
            configEnabling(NAMES, DECLARATIONS, { intake: { secretKnob: "not declared" } }),
        ).toThrow(/unknown setting "secretKnob"/);
    });

    /**
     * `intake`'s `announce: true` is the block above, and this repository
     * wrote nothing under `prDashboard` — so what arrives is prDashboard's own
     * spec at its own defaults, with its neighbour's answer nowhere in it.
     */
    it("never hands a capability another capability's block", () => {
        const view = projectCapabilityView(prDashboard.declaration, config);
        expect(view.settings).toEqual({
            checks: {
                dcoSignoff: { enabled: false },
                gpgSignature: { enabled: false },
                mergeConflicts: { enabled: false },
                linkedIssues: { enabled: false },
            },
            applyLabels: [],
        });
    });

    /**
     * §6's actual sentence, as a test rather than a hope: a capability
     * refers to internal meanings, never repository spellings. The view
     * reports availability, family by family, and nothing else — a command
     * word leaks the same way a label does, so every family is checked here.
     * The OPEN family is empty for this repository and still present:
     * "mapped nothing" and "has no such family" are not the same absence.
     */
    it("reports mapped names without ever exposing a spelling", () => {
        const view = projectCapabilityView(intake.declaration, config);
        expect(view.mapped).toEqual({
            // The three the file spelled and the four at their defaults, in the table's order (D203).
            labels: [
                "awaitingTriage",
                "ready",
                "inProgress",
                "needsReview",
                "needsRevision",
                "readyToMerge",
                "blocked",
            ],
            commands: ["assign"],
            skills: ["beginner"],
            alerts: [],
        });
        for (const spelling of ["status: triage", "/take-it", "skill: beginner"]) {
            expect(JSON.stringify(view)).not.toContain(spelling);
        }
    });
});

describe("intent screening", () => {
    const base = {
        capability: "intake",
        repository: { owner: "o", repo: "r" },
        item: { kind: "issue", number: 1 },
        claims: { meaningsPresent: [], meaningsAbsent: [], closed: false },
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
            capability: "prDashboard",
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
